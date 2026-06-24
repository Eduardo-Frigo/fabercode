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
      loadConversationMessages = async () => [],
      refreshCortexLearningPanel = async () => {},
      renderChatForActiveConversation = () => {},
      renderNextSteps = () => {},
      renderSystemNotice = () => {},
      renderWelcomePanel = () => {},
      stopJobPolling = () => {},
      updateStatus = () => {},
      ensureConversationStateForProject = () => {},
    } = callbacks;

    function summarizeProject(info) {
      if (!info) return 'Nenhum projeto selecionado.';
    
      const c = info.counters;
      return [
        `Pasta: ${info.rootPath}`,
        `Stacks detectadas: ${info.stacks.join(', ')}`,
        `Arquivos lidos: ${info.totalFiles} (limite de análise: ${info.scannedLimit})`,
        `Tipos: TS=${c.ts}, TSX=${c.tsx}, JS=${c.js}, JSX=${c.jsx}, PHP=${c.php}, CSS/SCSS=${c.css}, MD=${c.md}, Outros=${c.other}`,
        '',
        'A IA já recebe esse inventário para decidir melhor o arquivo-alvo.',
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
    
    function clearSelectionState() {
      stopJobPolling();
      hideJobProgress();
      state.selectedProjectId = null;
      state.selectedProjectInfo = null;
      state.nextSteps = [];
      state.lastAssistantMeta = null;
      state.pendingAction = null;
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
      updateStatus('Aguardando projeto');
      renderWelcomePanel();
    }
    
    function reconcileSelectionAfterProjectListUpdate() {
      if (!state.selectedProjectId) return;
      const exists = state.projects.some((project) => project.id === state.selectedProjectId);
      if (!exists) {
        clearSelectionState();
      }
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
    
    async function requestProjectRename(projectId, currentName = 'Projeto') {
      const nextNameRaw = await requestTextInputDialog({
        title: 'Novo nome do projeto:',
        initialValue: currentName,
        placeholder: 'Nome do projeto',
      });
      if (!nextNameRaw || !nextNameRaw.trim()) return null;
      return nextNameRaw.trim();
    }
    
    async function renameConversation(projectId, conversation, nextTitleRaw) {
      if (!projectId || !conversation) return;
      const currentTitle = String(conversation.title || 'Conversa').trim();
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
        appendMessage('assistant', (result && result.message) || 'Falha ao renomear conversa.', { persistToConversation: false });
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
      const currentTitle = String(conversation.title || 'Conversa').trim();
      const nextTitle = await requestTextInputDialog({
        title: 'Renomear conversa:',
        initialValue: currentTitle,
        placeholder: 'Título da conversa',
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
      renderSystemNotice('Nova conversa preparada. Sua próxima mensagem abre um chat separado neste projeto.');
      renderWelcomePanel();
    }
    
    function closeProjectStateModal() {
      if (projectStateModalController) projectStateModalController.close();
    }
    
    async function runProjectContextAction(action, projectId) {
      if (!action || !projectId) return;
    
      if (action === 'rename') {
        const target = state.projects.find((project) => project.id === projectId);
        const currentName = target ? String(target.name || 'Projeto') : 'Projeto';
        const nextName = await requestProjectRename(projectId, currentName);
        if (!nextName) return;
        const result = await api.renameProject({ id: projectId, name: nextName });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || 'Falha ao renomear projeto.', { persistToConversation: false });
          return;
        }
        state.projects = normalizeProjectItems(result.projects);
        renderProjects();
        if (state.selectedProjectId === projectId && state.selectedProjectInfo) {
          updateStatus(`Projeto ativo: ${nextName}`);
        }
        return;
      }
    
      if (action === 'archive') {
        const result = await api.archiveProject({ id: projectId });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || 'Falha ao arquivar projeto.', { persistToConversation: false });
          return;
        }
        state.projects = normalizeProjectItems(result.projects);
        reconcileSelectionAfterProjectListUpdate();
        renderProjects();
        appendMessage('assistant', 'Projeto arquivado com sucesso.', { persistToConversation: false });
        return;
      }
    
      if (action === 'trash') {
        const result = await api.trashProject({ id: projectId });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || 'Falha ao mover projeto para a lixeira.', { persistToConversation: false });
          return;
        }
        state.projects = normalizeProjectItems(result.projects);
        reconcileSelectionAfterProjectListUpdate();
        renderProjects();
        appendMessage('assistant', 'Projeto movido para a lixeira.', { persistToConversation: false });
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
      reconcileSelectionAfterProjectListUpdate();
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
      incrementalModeBadgeEl.textContent = hasFiles ? 'Edição incremental ativa' : 'Modo criação inicial';
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
    
    async function selectProject(projectId, options = {}) {
      const previousProjectId = state.selectedProjectId;
      if (previousProjectId && previousProjectId !== projectId) {
        state.pendingAction = null;
        state.activeJobId = null;
        clearPending();
      }
      stopJobPolling();
      hideJobProgress();
      state.selectedProjectId = projectId;
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return;
    
      updateStatus('Analisando projeto...');
    
      const scan = await api.scanProject(project.rootPath);
      if (!scan.ok) {
        appendMessage('assistant', scan.message || 'Não consegui analisar essa pasta.');
        updateStatus('Erro na análise');
        return;
      }
    
      state.selectedProjectInfo = scan.info;
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
        await applicationMapController.loadProjectMap(project.id, options);
      }
      if (milestonesPanelController) {
        await milestonesPanelController.refresh();
      }
    
      try {
        state.mempalaceStatus = await api.getMempalaceStatus(state.selectedProjectInfo);
      } catch {
        state.mempalaceStatus = null;
      }
    
      updateStatus(`Projeto ativo: ${project.name}`);
      const activeConversationId = getActiveConversationId(project.id);
      if (activeConversationId) {
        await loadConversationMessages(activeConversationId);
      }
      await refreshCortexLearningPanel();
      renderChatForActiveConversation();
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
