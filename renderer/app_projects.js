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
      stopJobPolling = () => {},
      updateStatus = () => {},
      resetApprovalMode = () => {},
      ensureConversationStateForProject = () => {},
    } = callbacks;

    let selectProjectSequence = 0;
    let contextChangeCancellation = null;

    function normalizeAssistantJobId(value) {
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    function currentAssistantJobId() {
      const pendingJobId = state.pendingAction
        ? normalizeAssistantJobId(state.pendingActionJobId)
        : null;
      return pendingJobId || normalizeAssistantJobId(state.activeJobId);
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
          .then(() => api.cancelJob({ jobId }))
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
        appendMessage(
          'assistant',
          (result && result.message)
            || t('projectSwitchCancellationFailed', 'Não troquei de projeto porque a tarefa ativa não pôde ser cancelada.'),
          { persistToConversation: false },
        );
        updateStatus(t('actionCancellationFailedStatus', 'Falha ao cancelar tarefa'));
        return false;
      }
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
      if (projectChanged && !previousProjectId) resetApprovalMode('project_switch');
      state.nextSteps = scan.nextSteps || [];
      state.expandedProjects[project.id] = true;
      ensureConversationStateForProject(project.id);
      renderProjects();
      renderNextSteps();
      if (projectFileTreeController) await projectFileTreeController.refresh();
      if (projectTerminalController && projectTerminalController.isOpen()) {
        await projectTerminalController.refresh();
      } else {
        if (projectTerminalController) projectTerminalController.render();
      }
      if (automataContractsController) {
        state.automataContractSummary = await automataContractsController.refreshSummary();
      }
      if (applicationMapController) {
        if (!options || options.initialTab !== 'map') {
          await applicationMapController.loadProjectMap(project.id, options);
        }
      }
      if (milestonesPanelController) {
        await milestonesPanelController.refresh();
      }
    
      try {
        state.mempalaceStatus = await api.getMempalaceStatus(state.selectedProjectInfo);
      } catch {
        state.mempalaceStatus = null;
      }
    
      updateStatus(`${t('activeProjectLabel', 'Projeto ativo')}: ${project.name}`);
      const activeConversationId = getActiveConversationId(project.id);
      if (activeConversationId) {
        await loadConversationMessages(activeConversationId);
      }
      await refreshCortexLearningPanel();
      renderChatForActiveConversation();
      if (options && options.initialTab === 'map') {
        await ensureMapTabVisible();
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
