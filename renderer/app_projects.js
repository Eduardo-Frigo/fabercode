(function () {
  function createAppProjectController({
    api = {},
    callbacks = {},
    controllers = {},
    elements = {},
    state,
    t = (_key, fallback = '') => fallback,
  } = {}) {
    if (!state) throw new Error('Renderer incompleto: estado de projetos ausente.');

    const { incrementalModeBadgeEl } = elements;
    const {
      automataContractsController = null,
      chatController = null,
      inlineInputDialogController = null,
      projectFileEditorController = null,
      projectFileTreeController = null,
      projectSidebarController = null,
      projectStateModalController = null,
      projectTerminalController = null,
      applicationMapController = null,
      milestonesPanelController = null,
    } = controllers;
    const {
      appendMessage = () => {},
      clearPending = () => {},
      getActiveConversationId = () => null,
      hideJobProgress = () => {},
      invalidateSubmission = () => {},
      loadConversationMessages = async () => [],
      refreshCortexLearningPanel = async () => {},
      renderChatForActiveConversation = () => {},
      renderNextSteps = () => {},
      renderSystemNotice = () => {},
      renderWelcomePanel = () => {},
      startJobPolling = () => {},
      stopJobPolling = () => {},
      updateStatus = () => {},
      waitForCancellationPoll = (delayMs) => new Promise((resolve) => {
        window.setTimeout(resolve, delayMs);
      }),
      waitForCancellationResult = (pendingResult, timeoutMs) => new Promise((resolve) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(null);
        }, timeoutMs);
        Promise.resolve(pendingResult).then(
          (value) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(value);
          },
          () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(null);
          },
        );
      }),
      resetApprovalMode = () => {},
      ensureConversationStateForProject = () => {},
    } = callbacks;

    let selectProjectSequence = 0;
    let contextChangeCancellation = null;
    const cancellationPendingNoticeJobIds = new Set();
    const CANCELLATION_SETTLE_POLL_MS = 250;
    const CANCELLATION_SETTLE_MAX_POLLS = 20;
    const CANCELLATION_SETTLE_DEADLINE_MS = 5000;

    function normalizeAssistantJobId(value) {
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    function currentAssistantJobId() {
      const pendingJobId = state.pendingAction
        ? normalizeAssistantJobId(state.pendingActionJobId)
        : null;
      return pendingJobId || normalizeAssistantJobId(state.activeJobId);
    }

    function terminalAssistantJob(job, expectedJobId) {
      return Boolean(
        job
        && normalizeAssistantJobId(job.id) === expectedJobId
        && ['completed', 'failed', 'blocked', 'cancelled']
          .includes(String(job.status || '').toLowerCase())
      );
    }

    async function waitForAssistantJobTerminal(jobId, initialJob = null) {
      if (terminalAssistantJob(initialJob, jobId)) {
        cancellationPendingNoticeJobIds.delete(jobId);
        return true;
      }
      if (!api || typeof api.getJob !== 'function') return false;
      const deadlineAt = Date.now() + CANCELLATION_SETTLE_DEADLINE_MS;
      for (let attempt = 0; attempt < CANCELLATION_SETTLE_MAX_POLLS; attempt += 1) {
        try {
          const beforePollRemainingMs = deadlineAt - Date.now();
          if (beforePollRemainingMs <= 0) break;
          await waitForCancellationPoll(Math.min(
            CANCELLATION_SETTLE_POLL_MS,
            beforePollRemainingMs,
          ));
          const resultRemainingMs = deadlineAt - Date.now();
          if (resultRemainingMs <= 0) break;
          const response = await waitForCancellationResult(
            api.getJob({ jobId }),
            resultRemainingMs,
          );
          if (response && response.ok === true && terminalAssistantJob(response.job, jobId)) {
            cancellationPendingNoticeJobIds.delete(jobId);
            return true;
          }
        } catch {}
      }
      return false;
    }

    function activeJobPriority(job) {
      const status = String(job && job.status || '').toLowerCase();
      const phase = String(job && job.phase || '').toLowerCase();
      if (status === 'running' && phase === 'cancelling') return 0;
      if (status === 'running') return 1;
      if (status === 'retry_pending') return 2;
      return Number.POSITIVE_INFINITY;
    }

    function jobRecencyMs(job) {
      for (const value of [job && job.updatedAt, job && job.createdAt]) {
        const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
        if (Number.isFinite(parsed)) return parsed;
      }
      return 0;
    }

    function compareActiveJobs(left, right) {
      const priorityDelta = activeJobPriority(left) - activeJobPriority(right);
      if (priorityDelta) return priorityDelta;
      const recencyDelta = jobRecencyMs(right) - jobRecencyMs(left);
      if (recencyDelta) return recencyDelta;
      const leftId = normalizeAssistantJobId(left && left.id) || '';
      const rightId = normalizeAssistantJobId(right && right.id) || '';
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    }

    function projectSelectionIsCurrent(sequence, projectId, rootPath) {
      return selectProjectSequence === sequence
        && state.selectedProjectId === projectId
        && String(state.selectedProjectInfo && state.selectedProjectInfo.rootPath || '') === rootPath;
    }

    async function reattachActiveProjectJob(projectId, rootPath, selectionSequence) {
      if (!api || typeof api.listJobs !== 'function') return null;
      if (!projectSelectionIsCurrent(selectionSequence, projectId, rootPath)) return null;
      try {
        const response = await api.listJobs({ projectId, limit: 12 });
        if (!projectSelectionIsCurrent(selectionSequence, projectId, rootPath)) return null;
        const jobs = response && response.ok === true && Array.isArray(response.jobs)
          ? response.jobs
          : [];
        const activeJob = jobs
          .filter((job) => (
            normalizeAssistantJobId(job && job.id)
            && job.projectId === projectId
            && job.rootPath === rootPath
            && Number.isFinite(activeJobPriority(job))
          ))
          .sort(compareActiveJobs)[0];
        if (!activeJob) return null;
        if (!projectSelectionIsCurrent(selectionSequence, projectId, rootPath)) return null;
        startJobPolling(activeJob.id, activeJob);
        return activeJob.id;
      } catch {
        return null;
      }
    }

    async function cancelAssistantJobBeforeProjectSwitch(expectedJobId = currentAssistantJobId()) {
      const jobId = normalizeAssistantJobId(expectedJobId);
      if (!jobId) return true;
      if (!api || typeof api.cancelJob !== 'function') {
        appendMessage(
          'assistant',
          t('projectSwitchCancellationFailed', 'Não troquei de projeto porque a tarefa ativa não pôde ser cancelada.'),
          { persistToConversation: false },
        );
        updateStatus(t('actionCancellationFailedStatus', 'Falha ao cancelar tarefa'));
        return false;
      }

      if (!contextChangeCancellation || contextChangeCancellation.jobId !== jobId) {
        const promise = Promise.resolve()
          .then(async () => {
            const result = await api.cancelJob({ jobId });
            if (!result || result.ok !== true) return result;
            const terminal = await waitForAssistantJobTerminal(jobId, result.job || null);
            return terminal
              ? { ...result, ok: true }
              : {
                  ok: false,
                  code: 'cancellation_pending',
                  message: t(
                    'projectSwitchCancellationPending',
                    'A tarefa ainda está encerrando; aguarde a confirmação antes de trocar de contexto.'
                  ),
                };
          })
          .catch((error) => ({
            ok: false,
            message: error && error.message ? error.message : '',
          }));
        contextChangeCancellation = { jobId, promise };
        promise.finally(() => {
          if (contextChangeCancellation && contextChangeCancellation.promise === promise) {
            contextChangeCancellation = null;
          }
        });
      }

      const result = await contextChangeCancellation.promise;
      if (!result || result.ok !== true) {
        const message = (result && result.message)
          || t('projectSwitchCancellationFailed', 'Não troquei de projeto porque a tarefa ativa não pôde ser cancelada.');
        const cancellationPending = result && result.code === 'cancellation_pending';
        const alreadyNotified = cancellationPending
          && cancellationPendingNoticeJobIds.has(jobId);
        if (!alreadyNotified) {
          appendMessage('assistant', message, { persistToConversation: false });
          if (cancellationPending) {
            cancellationPendingNoticeJobIds.add(jobId);
            if (cancellationPendingNoticeJobIds.size > 256) {
              cancellationPendingNoticeJobIds.delete(
                cancellationPendingNoticeJobIds.values().next().value
              );
            }
          }
        }
        updateStatus(cancellationPending
          ? message
          : t('actionCancellationFailedStatus', 'Falha ao cancelar tarefa'));
        return false;
      }
      cancellationPendingNoticeJobIds.delete(jobId);
      return true;
    }

    async function drainAssistantJobsBeforeContextChange() {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (state.pendingAction && !normalizeAssistantJobId(state.pendingActionJobId)) {
          state.pendingAction = null;
          state.pendingActionJobId = null;
          clearPending();
        }
        const jobId = currentAssistantJobId();
        if (!jobId) return true;
        if (!(await cancelAssistantJobBeforeProjectSwitch(jobId))) return false;

        if (state.pendingAction && normalizeAssistantJobId(state.pendingActionJobId) === jobId) {
          state.pendingAction = null;
          state.pendingActionJobId = null;
          clearPending();
        }
        if (normalizeAssistantJobId(state.activeJobId) === jobId) state.activeJobId = null;
      }

      if (!currentAssistantJobId()) return true;
      appendMessage(
        'assistant',
        t('projectSwitchCancellationFailed', 'Não troquei de projeto porque a tarefa ativa não pôde ser cancelada.'),
        { persistToConversation: false },
      );
      updateStatus(t('actionCancellationFailedStatus', 'Falha ao cancelar tarefa'));
      return false;
    }

    function summarizeProject(info) {
      if (!info) return t('noProjectSelected', 'Nenhum projeto selecionado.');
    
      const c = info.counters;
      return [
        `${t('projectFolderLabel', 'Pasta')}: ${info.rootPath}`,
        `${t('detectedStacksLabel', 'Stacks detectadas')}: ${info.stacks.join(', ')}`,
        `${t('filesReadLabel', 'Arquivos lidos')}: ${info.totalFiles} (${t('analysisLimitLabel', 'limite de análise')}: ${info.scannedLimit})`,
        `${t('fileTypesLabel', 'Tipos')}: TS=${c.ts}, TSX=${c.tsx}, JS=${c.js}, JSX=${c.jsx}, PHP=${c.php}, CSS/SCSS=${c.css}, MD=${c.md}, ${t('otherFilesLabel', 'Outros')}=${c.other}`,
        '',
        t('aiInventoryHint', 'A IA já recebe esse inventário para decidir melhor o arquivo-alvo.'),
      ].join('\n');
    }
    
    
    function normalizeProjectItems(rawProjects) {
      return window.FaberProjectSidebar
        ? window.FaberProjectSidebar.normalizeProjectItems(rawProjects)
        : [];
    }

    function filterVisibleProjectConversations(conversations) {
      return Array.isArray(conversations)
        ? conversations.filter((conversation) => conversation && conversation.source !== 'map_chat' && conversation.source !== 'map_render')
        : [];
    }
    
    async function clearSelectionState() {
      invalidateSubmission('selection_cleared');
      if (!(await drainAssistantJobsBeforeContextChange())) return false;
      stopJobPolling();
      hideJobProgress();
      state.selectedProjectId = null;
      state.selectedProjectInfo = null;
      state.nextSteps = [];
      state.lastAssistantMeta = null;
      state.pendingAction = null;
      state.pendingActionJobId = null;
      state.automataContractSummary = null;
      state.automataContractLedger = [];
      renderNextSteps();
      if (projectFileTreeController) projectFileTreeController.clear();
      if (projectFileEditorController) projectFileEditorController.reset();
      if (projectTerminalController) projectTerminalController.resetForNoProject();
      if (automataContractsController) automataContractsController.reset();
      if (applicationMapController) applicationMapController.resetForNoProject();
      if (milestonesPanelController) milestonesPanelController.resetForNoProject();
      clearPending();
      if (chatController) chatController.clearMessages();
      updateStatus(t('waitingProject', 'Aguardando projeto'));
      renderWelcomePanel();
      resetApprovalMode('selection_cleared');
      return true;
    }
    
    async function reconcileSelectionAfterProjectListUpdate() {
      if (!state.selectedProjectId) return true;
      const exists = state.projects.some((project) => project.id === state.selectedProjectId);
      if (!exists) {
        return clearSelectionState();
      }
      return true;
    }
    
    function hideProjectContextMenu() {
      if (projectSidebarController) {
        projectSidebarController.hideContextMenu();
      }
    }
    
    function requestTextInputDialog({ title = 'Editar', initialValue = '', placeholder = '' } = {}) {
      return inlineInputDialogController
        ? inlineInputDialogController.requestText({ title, initialValue, placeholder })
        : Promise.resolve(null);
    }
    
    async function requestProjectRename(projectId, currentName = t('defaultProjectName', 'Projeto')) {
      const nextNameRaw = await requestTextInputDialog({
        title: t('renameProjectPrompt', 'Novo nome do projeto:'),
        initialValue: currentName,
        placeholder: t('projectNamePlaceholder', 'Nome do projeto'),
      });
      if (!nextNameRaw || !nextNameRaw.trim()) return null;
      return nextNameRaw.trim();
    }
    
    async function renameConversation(projectId, conversation, nextTitleRaw) {
      if (!projectId || !conversation) return;
      const currentTitle = String(conversation.title || t('defaultConversationName', 'Conversa')).trim();
      const normalized = String(nextTitleRaw || '').trim();
      if (!normalized || normalized === currentTitle) return;

      if (!api.renameConversation) {
        conversation.title = normalized;
        renderProjects();
        return { ok: true, conversation };
      }

      const result = await api.renameConversation({
        projectId,
        conversationId: conversation.id,
        title: normalized,
      });

      if (!result || !result.ok) {
        appendMessage('assistant', (result && result.message) || t('renameConversationFailed', 'Falha ao renomear conversa.'), { persistToConversation: false });
        return result || { ok: false };
      }

      state.projectConversations[projectId] = Array.isArray(result.conversations)
        ? filterVisibleProjectConversations(result.conversations)
        : state.projectConversations[projectId] || [];
      renderProjects();
      return result;
    }

    async function requestConversationRename(projectId, conversation) {
      if (!projectId || !conversation) return;
      const currentTitle = String(conversation.title || t('defaultConversationName', 'Conversa')).trim();
      const nextTitle = await requestTextInputDialog({
        title: t('renameConversationPrompt', 'Renomear conversa:'),
        initialValue: currentTitle,
        placeholder: t('conversationTitlePlaceholder', 'Título da conversa'),
      });
      return renameConversation(projectId, conversation, nextTitle);
    }
    
    async function prepareNewConversationForProject(projectId) {
      if (!projectId) return;
    
      if (state.selectedProjectId !== projectId) {
        await selectProject(projectId);
      }
    
      state.wantsNewConversationOnNextMessage = true;
      state.lastAssistantMeta = null;
      clearPending();
      hideJobProgress();
      if (chatController) chatController.clearMessages();

      // renderSystemNotice ANTES de mudar o tab: garante que o chat-log tenha conteúdo
      // para que o welcome panel não apareça por cima do chat vazio
      renderSystemNotice(t(
        'newConversationPrepared',
        'Nova conversa preparada. Sua próxima mensagem abre um chat separado neste projeto.',
      ));

      // Muda o painel central para o chat sem fechar o painel lateral do mapa
      // (não usamos switchTab pois ele chama setMapSidePanelMode(null) que fecha o painel "Perguntar à IA")
      const chatRegion = document.getElementById('workspace-chat-region');
      const mapRegion = document.getElementById('workspace-map-region');
      const tabChat = document.getElementById('btn-tab-chat');
      const tabMap = document.getElementById('btn-tab-map');
      if (chatRegion) chatRegion.classList.remove('hidden');
      if (mapRegion) mapRegion.classList.add('hidden');
      if (tabChat) tabChat.classList.add('active');
      if (tabMap) tabMap.classList.remove('active');
    }
    
    function closeProjectStateModal() {
      if (projectStateModalController) projectStateModalController.close();
    }
    
    async function runProjectContextAction(action, projectId) {
      if (!action || !projectId) return;

      const tutorialRuntime = window.FaberTutorialRuntime;
      if (tutorialRuntime && typeof tutorialRuntime.handleProjectContextAction === 'function') {
        const handledByTutorial = await tutorialRuntime.handleProjectContextAction(action, projectId);
        if (handledByTutorial) {
          renderProjects();
          return;
        }
      }
    
      if (action === 'rename') {
        const target = state.projects.find((project) => project.id === projectId);
        const defaultProjectName = t('defaultProjectName', 'Projeto');
        const currentName = target ? String(target.name || defaultProjectName) : defaultProjectName;
        const nextName = await requestProjectRename(projectId, currentName);
        if (!nextName) return;
        const result = await api.renameProject({ id: projectId, name: nextName });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || t('renameProjectFailed', 'Falha ao renomear projeto.'), { persistToConversation: false });
          return;
        }
        state.projects = normalizeProjectItems(result.projects);
        renderProjects();
        if (state.selectedProjectId === projectId && state.selectedProjectInfo) {
          updateStatus(`${t('activeProjectLabel', 'Projeto ativo')}: ${nextName}`);
        }
        return;
      }
    
      if (action === 'archive') {
        if (state.selectedProjectId === projectId) {
          invalidateSubmission('project_archive');
          if (!(await drainAssistantJobsBeforeContextChange())) return;
          resetApprovalMode('project_archive');
        }
        const result = await api.archiveProject({ id: projectId });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || t('archiveProjectFailed', 'Falha ao arquivar projeto.'), { persistToConversation: false });
          return;
        }
        state.projects = normalizeProjectItems(result.projects);
        await reconcileSelectionAfterProjectListUpdate();
        renderProjects();
        appendMessage('assistant', t('projectArchivedSuccess', 'Projeto arquivado com sucesso.'), { persistToConversation: false });
        return;
      }
    
      if (action === 'trash') {
        if (state.selectedProjectId === projectId) {
          invalidateSubmission('project_trash');
          if (!(await drainAssistantJobsBeforeContextChange())) return;
          resetApprovalMode('project_trash');
        }
        const result = await api.trashProject({ id: projectId });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || t('trashProjectFailed', 'Falha ao mover projeto para a lixeira.'), { persistToConversation: false });
          return;
        }
        state.projects = normalizeProjectItems(result.projects);
        await reconcileSelectionAfterProjectListUpdate();
        renderProjects();
        appendMessage('assistant', t('projectTrashedSuccess', 'Projeto movido para a lixeira.'), { persistToConversation: false });
      }
    }
    
    function renderProjects() {
      if (projectSidebarController) projectSidebarController.render();
    }
    
    async function loadProjects() {
      try {
        const rawProjects = await api.listProjects();
        console.info('[loadProjects] rawProjects =', rawProjects);
        state.projects = normalizeProjectItems(rawProjects);
      } catch (error) {
        console.error('Falha ao carregar projetos:', error);
        state.projects = [];
      }
    
      try {
        const persistedConversations = await api.listConversations();
        if (persistedConversations && persistedConversations.ok) {
          const rawConversationsByProject =
            persistedConversations.conversationsByProject &&
            typeof persistedConversations.conversationsByProject === 'object'
              ? persistedConversations.conversationsByProject
              : {};
          state.projectConversations = Object.fromEntries(
            Object.entries(rawConversationsByProject).map(([projectId, conversations]) => [
              projectId,
              filterVisibleProjectConversations(conversations),
            ])
          );
        } else {
          state.projectConversations = {};
        }
      } catch (error) {
        console.error('Falha ao carregar conversas:', error);
        state.projectConversations = {};
      }
    
      console.info('[loadProjects] state.projects =', state.projects);
      state.projects.forEach((project) => ensureConversationStateForProject(project.id));
      await reconcileSelectionAfterProjectListUpdate();
      renderProjects();
      renderWelcomePanel();
    }
    
    function renderIncrementalModeBadge() {
      if (!incrementalModeBadgeEl) return;
      const cortexActive = state.uiMode === 'cortex';
      if (cortexActive || !state.selectedProjectInfo || !state.selectedProjectInfo.rootPath) {
        incrementalModeBadgeEl.classList.add('hidden');
        incrementalModeBadgeEl.classList.remove('is-edit', 'is-init');
        incrementalModeBadgeEl.textContent = '';
        return;
      }
    
      const hasFiles = Number(state.selectedProjectInfo.totalFiles || 0) > 0;
      incrementalModeBadgeEl.classList.remove('hidden', 'is-edit', 'is-init');
      incrementalModeBadgeEl.classList.add(hasFiles ? 'is-edit' : 'is-init');
      incrementalModeBadgeEl.textContent = hasFiles
        ? t('incrementalEditingActive', 'Edição incremental ativa')
        : t('initialCreationMode', 'Modo criação inicial');
    }
    
    async function ensureSelectedProjectInfoReady(options = {}) {
      const forceRefresh = Boolean(options && options.forceRefresh);
      if (state.selectedProjectInfo && state.selectedProjectInfo.rootPath && !forceRefresh) return true;
      if (!state.selectedProjectId) return false;
    
      const project = Array.isArray(state.projects)
        ? state.projects.find((item) => item && item.id === state.selectedProjectId)
        : null;
      const rootPath = state.selectedProjectInfo && state.selectedProjectInfo.rootPath
        ? state.selectedProjectInfo.rootPath
        : (project && project.rootPath ? project.rootPath : '');
      if (!rootPath) return false;
    
      try {
        const scan = await api.scanProject(rootPath);
        if (!scan || !scan.ok || !scan.info) return false;
        state.selectedProjectInfo = scan.info;
        state.nextSteps = scan.nextSteps || state.nextSteps;
        renderNextSteps();
        renderIncrementalModeBadge();
        return true;
      } catch {
        return Boolean(state.selectedProjectInfo && state.selectedProjectInfo.rootPath && !forceRefresh);
      }
    }

    async function ensureMapTabVisible() {
      if (!applicationMapController || typeof applicationMapController.switchTab !== 'function') return;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        applicationMapController.switchTab('map');
        const tabMap = document.getElementById('btn-tab-map');
        if (tabMap && typeof tabMap.click === 'function') {
          tabMap.click();
        }
        await new Promise((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(resolve);
          });
        });
        const mapRegion = document.getElementById('workspace-map-region');
        const mapVisible = Boolean(
          tabMap
          && tabMap.classList.contains('active')
          && mapRegion
          && !mapRegion.classList.contains('hidden')
        );
        if (mapVisible) return;
        await new Promise((resolve) => window.setTimeout(resolve, 70));
      }
    }
    
    async function selectProject(projectId, options = {}) {
      const currentSequence = ++selectProjectSequence;

      const previousProjectId = state.selectedProjectId;
      const projectChanged = previousProjectId !== projectId;
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return false;
      if (previousProjectId && previousProjectId !== projectId) {
        invalidateSubmission('project_switch');
        const cancelled = await drainAssistantJobsBeforeContextChange();
        if (selectProjectSequence !== currentSequence || !cancelled) return false;
        resetApprovalMode('project_switch');
      }

      stopJobPolling();
      hideJobProgress();
    
      if (options && options.initialTab === 'map') {
        if (applicationMapController) {
          ensureMapTabVisible().catch(console.error);
          applicationMapController.loadProjectMap(project.id, { ...options, fallbackRootPath: project.rootPath }).catch(console.error);
        }
      }

      updateStatus(t('analyzingProject', 'Analisando projeto...'));
    
      const scan = await api.scanProject(project.rootPath);

      // Abortar caso o usuário tenha clicado novamente no mapa ou outro projeto
      if (selectProjectSequence !== currentSequence) return false;

      if (!scan.ok) {
        updateStatus(t('projectAnalysisError', 'Erro na análise'));
        return false;
      }

      if (projectChanged) {
        invalidateSubmission('project_switch_commit');
        const cancelled = await drainAssistantJobsBeforeContextChange();
        if (selectProjectSequence !== currentSequence || !cancelled) return false;
      }
    
      state.selectedProjectId = projectId;
      state.selectedProjectInfo = scan.info;
      const selectedRootPath = String(scan.info && scan.info.rootPath || '');
      if (projectChanged && !previousProjectId) resetApprovalMode('project_switch');
      state.nextSteps = scan.nextSteps || [];
      state.expandedProjects[project.id] = true;
      ensureConversationStateForProject(project.id);
      renderProjects();
      renderNextSteps();
      if (projectFileTreeController) await projectFileTreeController.refresh();
      if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
      if (projectTerminalController && projectTerminalController.isOpen()) {
        await projectTerminalController.refresh();
      } else {
        if (projectTerminalController) projectTerminalController.render();
      }
      if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
      if (automataContractsController) {
        const nextAutomataContractSummary = await automataContractsController.refreshSummary();
        if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
        state.automataContractSummary = nextAutomataContractSummary;
      }
      if (applicationMapController) {
        if (!options || options.initialTab !== 'map') {
          await applicationMapController.loadProjectMap(project.id, options);
          if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
        }
      }
      if (milestonesPanelController) {
        await milestonesPanelController.refresh();
        if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
      }
    
      let nextMempalaceStatus = null;
      try {
        nextMempalaceStatus = await api.getMempalaceStatus(scan.info);
      } catch {}
      if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
      state.mempalaceStatus = nextMempalaceStatus;
    
      updateStatus(`${t('activeProjectLabel', 'Projeto ativo')}: ${project.name}`);
      const activeConversationId = getActiveConversationId(project.id);
      if (activeConversationId) {
        await loadConversationMessages(activeConversationId);
        if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
      }
      await refreshCortexLearningPanel();
      if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
      renderChatForActiveConversation();
      await reattachActiveProjectJob(project.id, selectedRootPath, currentSequence);
      if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
      if (options && options.initialTab === 'map') {
        await ensureMapTabVisible();
        if (!projectSelectionIsCurrent(currentSequence, project.id, selectedRootPath)) return false;
      }
      return true;
    }

    return {
      clearSelectionState,
      closeProjectStateModal,
      ensureSelectedProjectInfoReady,
      hideProjectContextMenu,
      loadProjects,
      normalizeProjectItems,
      prepareNewConversationForProject,
      reconcileSelectionAfterProjectListUpdate,
      renderIncrementalModeBadge,
      renderProjects,
      requestConversationRename,
      renameConversation,
      requestProjectRename,
      requestTextInputDialog,
      runProjectContextAction,
      selectProject,
      summarizeProject,
    };
  }

  window.FaberAppProjects = {
    createAppProjectController,
  };
})();
