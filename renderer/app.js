window.faberConfirm = function(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('faber-confirm-modal');
    const text = document.getElementById('faber-confirm-text');
    const btnNo = document.getElementById('faber-confirm-no');
    const btnYes = document.getElementById('faber-confirm-yes');
    const backdrop = document.getElementById('faber-confirm-backdrop');
    if (!modal || !text || !btnNo || !btnYes) {
      resolve(window.confirm(message));
      return;
    }

    text.textContent = message;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
      try {
        btnYes.focus({ preventScroll: true });
      } catch (_) {
        btnYes.focus();
      }
    }, 0);

    const cleanup = (result) => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      btnNo.removeEventListener('click', onNo);
      btnYes.removeEventListener('click', onYes);
      if (backdrop) backdrop.removeEventListener('click', onNo);
      document.removeEventListener('keydown', onKeydown);
      resolve(result);
    };

    const onNo = () => cleanup(false);
    const onYes = () => cleanup(true);
    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        cleanup(true);
      }
    };

    btnNo.addEventListener('click', onNo);
    btnYes.addEventListener('click', onYes);
    if (backdrop) backdrop.addEventListener('click', onNo);
    document.addEventListener('keydown', onKeydown);
  });
};

window.faberAlert = function(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('faber-confirm-modal');
    const text = document.getElementById('faber-confirm-text');
    const btnNo = document.getElementById('faber-confirm-no');
    const btnYes = document.getElementById('faber-confirm-yes');
    const backdrop = document.getElementById('faber-confirm-backdrop');
    
    if (!modal || !text || !btnYes) {
      window.alert(message);
      resolve();
      return;
    }

    text.textContent = message;
    if (btnNo) btnNo.style.display = 'none';
    btnYes.textContent = 'OK';
    
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
      try {
        btnYes.focus({ preventScroll: true });
      } catch (_) {
        btnYes.focus();
      }
    }, 0);

    const cleanup = () => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      if (btnNo) btnNo.style.display = '';
      btnYes.textContent = 'Confirmar';
      btnYes.removeEventListener('click', onYes);
      if (backdrop) backdrop.removeEventListener('click', onYes);
      document.removeEventListener('keydown', onKeydown);
      resolve();
    };

    const onYes = () => cleanup();
    const onKeydown = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') onYes();
    };

    btnYes.addEventListener('click', onYes);
    if (backdrop) backdrop.addEventListener('click', onYes);
    document.addEventListener('keydown', onKeydown);
  });
};

let state;
let conversationController = null;
let projectController = null;
let jobController = null;
let actionController = null;
let eventsController = null;
let preferencesController = null;
let welcomePanelWasVisible = false;
let welcomePanelAnimationFrame = null;

const appDragRegionEl = document.getElementById('app-drag-region');
const appShellEl = document.querySelector('.app-shell');
const panelCenterEl = document.querySelector('.panel-center');
const projectsListEl = document.getElementById('projects-list');
const chatLogEl = document.getElementById('chat-log');
const welcomePanelEl = document.getElementById('welcome-panel');
const pendingActionEl = document.getElementById('pending-action');
const pendingTextEl = document.getElementById('pending-text');
const inputEl = document.getElementById('user-input');
const statusPillEl = document.getElementById('status-pill');
const nextStepsListEl = document.getElementById('next-steps-list');
const projectsSearchEl = document.getElementById('projects-search');
const newConversationBtnEl = document.getElementById('btn-new-conversation');
const cortexModeBtnEl = document.getElementById('btn-cortex-mode');
const centerTitleEl = document.getElementById('center-title');
const rightPanelTitleEl = document.getElementById('right-panel-title');
const incrementalModeBadgeEl = document.getElementById('incremental-mode-badge');
const cortexLearningBoxEl = document.getElementById('cortex-learning-box');
const projectSettingsBtnEl = document.getElementById('btn-project-settings');
const projectGitBtnEl = document.getElementById('btn-project-git');
const projectPreviewBtnEl = document.getElementById('btn-project-deploy');
const projectContextMenuEl = document.getElementById('project-context-menu');
const projectRailLightboxEl = document.getElementById('project-rail-lightbox');
const projectRailLightboxListEl = document.getElementById('project-rail-lightbox-list');
const projectRailLightboxCloseEl = document.getElementById('project-rail-lightbox-close');
const projectRailLightboxBackdropEl = document.getElementById('project-rail-lightbox-backdrop');

const REQUIRED_RENDERER_MODULES = [
  { globalName: 'FaberAppState', methods: ['createInitialRendererState'] },
  { globalName: 'FaberAppConversations', methods: ['createAppConversationController'] },
  { globalName: 'FaberAppProjects', methods: ['createAppProjectController'] },
  { globalName: 'FaberAppJobs', methods: ['createAppJobController'] },
  { globalName: 'FaberAppActions', methods: ['createAppActionsController'] },
  { globalName: 'FaberAppEvents', methods: ['createAppEventsController'] },
  { globalName: 'FaberAppFormatters', methods: ['buildDiagnosticsContextHint', 'buildExecutionOutcomeAssistantMessage', 'buildJobContextForPersona', 'buildTerminalJobMessage', 'formatAiRuntimeMessage', 'formatDiffPreviewForChat', 'formatMempalaceRuntimeMessage', 'isManualRetryMessage', 'parseProviderHttpStatusFromReason', 'shouldSuppressInterimAssistantPlanMessage'] },
  { globalName: 'FaberStartupPreloader', methods: ['createStartupPreloaderController'] },
  { globalName: 'FaberI18n', methods: ['createI18nController'] },
  { globalName: 'FaberUiAppearance', methods: ['createUiAppearanceController', 'normalizeInterfaceTheme', 'normalizePanelFontScale'] },
  { globalName: 'FaberAppPreferences', methods: ['createAppPreferencesController'] },
  { globalName: 'FaberAccountGate', methods: ['createAccountGateController', 'hasPlatformMedia', 'isSignedIn'] },
  { globalName: 'FaberAiSettings', methods: ['buildComposerProviderOptionsFromSettings', 'buildModelPresetOptions', 'createAiSettingsController', 'normalizeKnownProvider', 'providerStatusLabel', 'normalizeInterfaceLanguage', 'normalizeInterfaceTheme', 'normalizePanelFontScale'] },
  { globalName: 'FaberChatComposer', methods: ['createChatComposerController'] },
  { globalName: 'FaberCortex', methods: ['createCortexController', 'normalizeCortexTopic'] },
  { globalName: 'FaberInlineInputDialog', methods: ['createInlineInputDialogController'] },
  { globalName: 'FaberUxStateModel', methods: ['buildJobProgressPresentation', 'buildStatusPresentation', 'inferUxToneFromText', 'mapJobPhaseLabel', 'normalizeUxTone'] },
  { globalName: 'FaberJobProgress', methods: ['createJobProgressController'] },
  { globalName: 'FaberWorkspaceLayoutPreferences', methods: ['createWorkspaceLayoutPreferenceController', 'normalizeToolPlacements', 'normalizeWorkspaceLayoutPreferences', 'normalizeWorkspaceMode'] },
  { globalName: 'FaberWorkspaceLayoutBuilder', methods: ['createWorkspaceLayoutBuilder', 'deriveControlsFromPlacements', 'syncControlsFromPlacements'] },
  { globalName: 'FaberWorkspaceLayoutRuntime', methods: ['createWorkspaceLayoutRuntimeController'] },
  { globalName: 'FaberPanelLayout', methods: ['createPanelLayoutController'] },
  { globalName: 'FaberAutomataContracts', methods: ['createAutomataContractsController', 'statusLabel'] },
  { globalName: 'FaberProjectToolsSupport', methods: ['buildGitWorktreeViewModel', 'buildTerminalPreviewCommand', 'formatGithubPublishPlan', 'formatPreviewStartFailure', 'inferGithubRepoNameFromProject'] },
  { globalName: 'FaberProjectToolsGithubDeploy', methods: ['createProjectGithubDeployTool'] },
  { globalName: 'FaberProjectToolsGit', methods: ['createProjectGitTool'] },
  { globalName: 'FaberProjectTools', methods: ['createProjectToolsController', 'formatGithubPublishPlan', 'formatPreviewStartFailure', 'inferGithubRepoNameFromProject'] },
  { globalName: 'FaberProjectFileEditor', methods: ['createProjectFileEditorController'] },
  { globalName: 'FaberProjectFileTree', methods: ['createProjectFileTreeController'] },
  { globalName: 'FaberProjectSidebar', methods: ['createProjectSidebarController', 'normalizeProjectItems'] },
  { globalName: 'FaberProjectStateModal', methods: ['createProjectStateModalController'] },
  { globalName: 'FaberProjectTerminal', methods: ['createProjectTerminalController'] },
  { globalName: 'FaberWelcomeProjectModal', methods: ['createWelcomeProjectModalController'] },
  { globalName: 'FaberWelcomeQuotes', methods: ['applyWelcomeQuote', 'getWelcomeQuote', 'setLastAuthor'] },
];

if (!window.FaberBootstrapGuard || typeof window.FaberBootstrapGuard.requireRendererModules !== 'function') {
  throw new Error('Renderer incompleto: FaberBootstrapGuard ausente.');
}
window.FaberBootstrapGuard.requireRendererModules(REQUIRED_RENDERER_MODULES);

const {
  buildDiagnosticsContextHint,
  buildExecutionOutcomeAssistantMessage,
  buildJobContextForPersona,
  buildTerminalJobMessage,
  formatAiRuntimeMessage,
  formatDiffPreviewForChat,
  formatMempalaceRuntimeMessage,
  isManualRetryMessage,
  shouldSuppressInterimAssistantPlanMessage,
} = window.FaberAppFormatters;

state = window.FaberAppState.createInitialRendererState();

const panelLayoutController = window.FaberPanelLayout
  ? window.FaberPanelLayout.createPanelLayoutController({ appShell: appShellEl })
  : null;
const workspaceLayoutRuntimeController = window.FaberWorkspaceLayoutRuntime
  ? window.FaberWorkspaceLayoutRuntime.createWorkspaceLayoutRuntimeController({ documentRef: document })
  : null;
const workspaceLayoutController = window.FaberWorkspaceLayoutPreferences
  ? window.FaberWorkspaceLayoutPreferences.createWorkspaceLayoutPreferenceController({
      appShell: appShellEl,
      layoutRuntimeController: workspaceLayoutRuntimeController,
      onLayoutChanged: () => requestChatScrollToBottom(),
      panelLayoutController,
      state,
    })
  : null;
const inlineInputDialogController = window.FaberInlineInputDialog
  ? window.FaberInlineInputDialog.createInlineInputDialogController()
  : null;
const jobProgressController = window.FaberJobProgress
  ? window.FaberJobProgress.createJobProgressController({
      updateStatus,
      onVisibilityChange: renderWelcomePanel,
    })
  : null;
const chatController = window.FaberChatComposer
  ? window.FaberChatComposer.createChatComposerController({
      api: window.localcodeApi,
      getProjectInfo: () => state.selectedProjectInfo,
      getAttachments: () => state.attachments,
      setAttachments: (attachments) => {
        state.attachments = Array.isArray(attachments) ? attachments : [];
      },
      onVisibilityChange: renderWelcomePanel,
      openFile: async (relativePath, options = {}) => {
        if (projectFileEditorController) await projectFileEditorController.open(relativePath, options);
      },
    })
  : null;
conversationController = window.FaberAppConversations
  ? window.FaberAppConversations.createAppConversationController({
      api: window.localcodeApi,
      chatController,
      hidePersonaThinkingIndicator,
      renderMessageBubble,
      renderProjects,
      renderWelcomePanel,
      state,
    })
  : null;
const automataContractsController = window.FaberAutomataContracts
  ? window.FaberAutomataContracts.createAutomataContractsController({
      api: window.localcodeApi,
      appendMessage,
      getProjectId: () => state.selectedProjectId,
      getProjectInfo: () => state.selectedProjectInfo,
      updateStatus,
      onVisibilityChange: renderWelcomePanel,
    })
  : null;
const applicationMapController = window.FaberApplicationMap
  ? window.FaberApplicationMap.createApplicationMapController({
      api: window.localcodeApi,
      getSelectedProjectId: () => state.selectedProjectId,
      getSelectedProjectInfo: () => state.selectedProjectInfo,
      appendMessage,
      getTerminalController: () => projectTerminalController,
    })
  : null;
const milestonesPanelController = window.FaberMilestonesPanel
  ? window.FaberMilestonesPanel.createMilestonesPanelController({
      api: window.localcodeApi,
      getSelectedProjectId: () => state.selectedProjectId,
      getSelectedProjectInfo: () => state.selectedProjectInfo,
      appendMessage,
      updateStatus,
      getTerminalController: () => projectTerminalController,
    })
  : null;
jobController = window.FaberAppJobs
  ? window.FaberAppJobs.createAppJobController({
      api: window.localcodeApi,
      automataContractsController,
      callbacks: {
        appendMessage,
        buildJobContextForPersona,
        buildPersonaRequestContextHint,
        buildTerminalJobMessage,
        getRecentConversationMessagesForPersona,
        hidePersonaThinkingIndicator,
        shouldSuppressInterimAssistantPlanMessage,
        showPending,
        showPersonaThinkingIndicator,
        updateStatus,
      },
      jobProgressController,
      state,
    })
  : null;
const uiAppearanceController = window.FaberUiAppearance
  ? window.FaberUiAppearance.createUiAppearanceController({
      state,
      renderWelcomePanel,
    })
  : null;
const projectTerminalController = window.FaberProjectTerminal
  ? window.FaberProjectTerminal.createProjectTerminalController({
      api: window.localcodeApi,
      getProjectId: () => state.selectedProjectId,
      getProjectInfo: () => state.selectedProjectInfo,
      getProjects: () => state.projects,
      ensureProjectReady: ensureSelectedProjectInfoReady,
      getWorkspacePreferences: () => workspaceLayoutController
        ? workspaceLayoutController.getPreferences()
        : state.workspaceLayoutPreferences,
      applyWorkspacePreferences: (preferences, options) => {
        if (workspaceLayoutController) {
          workspaceLayoutController.updatePreferences(preferences, options);
        } else {
          state.workspaceLayoutPreferences = preferences;
        }
      },
      notify: (message) => appendMessage('assistant', message, { persistToConversation: false }),
    })
  : null;
const projectToolsController = window.FaberProjectTools
  ? window.FaberProjectTools.createProjectToolsController({
      api: window.localcodeApi,
      getProjects: () => state.projects,
      getSelectedProjectId: () => state.selectedProjectId,
      getSelectedProjectInfo: () => state.selectedProjectInfo,
      requestTextInput: requestTextInputDialog,
      appendMessage,
      confirmAction: window.faberConfirm,
      openFile: async (relativePath, options = {}) => {
        if (projectFileEditorController) await projectFileEditorController.open(relativePath, options);
      },
      refreshFileTree: async () => {
        if (projectFileTreeController) await projectFileTreeController.refresh();
      },
      refreshProjects: loadProjects,
      selectProject,
      updateStatus,
      terminalController: projectTerminalController,
    })
  : null;
const aiSettingsController = window.FaberAiSettings
  ? window.FaberAiSettings.createAiSettingsController({
      api: window.localcodeApi,
      t,
      getSelectedProvider: () => state.selectedAiProvider,
      setSelectedProvider: (provider) => {
        state.selectedAiProvider = normalizeKnownProvider(provider);
      },
      getInterfaceLanguage: () => state.interfaceLanguage,
      applyInterfaceLanguage,
      getInterfaceTheme: () => state.interfaceTheme,
      getPanelFontScale: () => state.panelFontScale,
      getWorkspacePreferences: () => workspaceLayoutController
        ? workspaceLayoutController.getPreferences()
        : state.workspaceLayoutPreferences,
      applyWorkspacePreferences: (preferences, options) => {
        if (workspaceLayoutController) {
          workspaceLayoutController.updatePreferences(preferences, options);
        } else {
          state.workspaceLayoutPreferences = preferences;
        }
      },
      applyAppearanceSettings,
      updateStatus,
      notify: (message) => appendMessage('assistant', message, { persistToConversation: false }),
      refreshAiStatus: async () => {
        try {
          state.aiRuntimeStatus = await window.localcodeApi.getAiStatus();
        } catch {
          state.aiRuntimeStatus = null;
        }
      },
    })
  : null;
const accountGateController = window.FaberAccountGate
  ? window.FaberAccountGate.createAccountGateController({
      api: window.localcodeApi,
      notify: (message) => appendMessage('assistant', message, { persistToConversation: false }),
      getInterfaceLanguage: () => state.interfaceLanguage,
      onLanguagePreferenceSelected: (locale) => {
        applyInterfaceLanguage(locale, { rerender: false });
      },
      onThemePreferenceSelected: (theme) => {
        applyAppearanceSettings({
          interfaceTheme: theme,
          panelFontScale: state.panelFontScale,
        }, { rerender: false });
      },
      onWorkspacePreferenceSelected: (mode) => {
        if (workspaceLayoutController) {
          workspaceLayoutController.updatePreferences({ mode }, { persist: true, applyPreset: true });
        }
      },
      onStatusChange: (status, unlocked) => {
        state.accountStatus = status || null;
        state.accountUnlocked = Boolean(unlocked);
        applyAccountPreferences(status && status.user ? status.user : null);
        if (workspaceLayoutController) {
          workspaceLayoutController.maybeShowOnboarding({ accountUnlocked: state.accountUnlocked });
        }
      },
    })
  : null;
const cortexController = window.FaberCortex
  ? window.FaberCortex.createCortexController({
      api: window.localcodeApi,
      t,
      getProjectId: () => state.selectedProjectId,
      getProjectInfo: () => state.selectedProjectInfo,
      getInterfaceLanguage: () => state.interfaceLanguage,
      ensureProjectReady: ensureSelectedProjectInfoReady,
      setUiMode,
      updateStatus,
      getLearning: (projectId = state.selectedProjectId) => state.cortexLearningByProject[projectId] || null,
      setLearning: (projectId, learning) => {
        if (projectId) state.cortexLearningByProject[projectId] = learning;
      },
      getRuntimeStatus: (projectId = state.selectedProjectId) => state.knowledgeRuntimeStatusByProject[projectId] || null,
      setRuntimeStatus: (projectId, status) => {
        if (projectId) state.knowledgeRuntimeStatusByProject[projectId] = status;
      },
      getAttachments: () => state.cortexAttachments,
      setAttachments: (attachments) => {
        state.cortexAttachments = Array.isArray(attachments) ? attachments : [];
      },
      getSelectedTopic: () => state.cortexSelectedTopic,
      setSelectedTopic: (topic) => {
        state.cortexSelectedTopic = window.FaberCortex.normalizeCortexTopic(topic);
      },
      requestTextInput: requestTextInputDialog,
    })
  : null;
const projectSidebarController = window.FaberProjectSidebar
  ? window.FaberProjectSidebar.createProjectSidebarController({
      listEl: projectsListEl,
      searchEl: projectsSearchEl,
      contextMenuEl: projectContextMenuEl,
      railLightboxEl: projectRailLightboxEl,
      railMenuListEl: projectRailLightboxListEl,
      railMenuCloseEl: projectRailLightboxCloseEl,
      railMenuBackdropEl: projectRailLightboxBackdropEl,
      getProjects: () => state.projects,
      getSearchQuery: () => state.projectSearchQuery,
      setSearchQuery: (query) => {
        state.projectSearchQuery = query || '';
      },
      getSelectedProjectId: () => state.selectedProjectId,
      getExpandedProjects: () => state.expandedProjects,
      setProjectExpanded: (projectId, expanded) => {
        state.expandedProjects[projectId] = Boolean(expanded);
      },
      getConversations: (projectId) => state.projectConversations[projectId] || [],
      ensureConversationState: ensureConversationStateForProject,
      getActiveConversationId,
      onSelectProject: selectProject,
      shouldResyncProject: (projectId) =>
        state.selectedProjectId !== projectId ||
        !state.selectedProjectInfo ||
        !state.selectedProjectInfo.rootPath ||
        !projectFileTreeController ||
        !projectFileTreeController.hasRows(),
      onRefreshSelectedProjectFiles: async () => {
        if (projectFileTreeController) await projectFileTreeController.refresh();
      },
      onPrepareNewConversation: prepareNewConversationForProject,
      onSelectConversation: async (projectId, conversation) => {
        if (!conversation || !conversation.id) return;
        if (state.selectedProjectId !== projectId) await selectProject(projectId);
        setActiveConversation(projectId, conversation.id);
        await loadConversationMessages(conversation.id);
        state.lastAssistantMeta = null;
        clearPending();
        renderProjects();
        renderChatForActiveConversation();
        // Muda o painel central para o chat sem fechar o painel lateral do mapa
        const chatRegion = document.getElementById('workspace-chat-region');
        const mapRegion = document.getElementById('workspace-map-region');
        const tabChat = document.getElementById('btn-tab-chat');
        const tabMap = document.getElementById('btn-tab-map');
        if (chatRegion) chatRegion.classList.remove('hidden');
        if (mapRegion) mapRegion.classList.add('hidden');
        if (tabChat) tabChat.classList.add('active');
        if (tabMap) tabMap.classList.remove('active');
      },
      onRenameProject: async (projectId, currentName) => {
        const nextName = await requestProjectRename(projectId, currentName);
        if (!nextName) return;
        const result = await window.localcodeApi.renameProject({ id: projectId, name: nextName });
        if (!result || !result.ok) {
          appendMessage('assistant', (result && result.message) || 'Falha ao renomear projeto.', { persistToConversation: false });
          return;
        }
        state.projects = normalizeProjectItems(result.projects);
        renderProjects();
        if (state.selectedProjectId === projectId && state.selectedProjectInfo) {
          updateStatus(`Projeto ativo: ${nextName}`);
        }
      },
      onRenameConversation: requestConversationRename,
      onContextAction: runProjectContextAction,
    })
  : null;
const projectStateModalController = window.FaberProjectStateModal
  ? window.FaberProjectStateModal.createProjectStateModalController({
      api: window.localcodeApi,
      refreshProjects: loadProjects,
      notify: (message) => appendMessage('assistant', message, { persistToConversation: false }),
    })
  : null;
const welcomeProjectModalController = window.FaberWelcomeProjectModal
  ? window.FaberWelcomeProjectModal.createWelcomeProjectModalController({
      t,
      getProjects: () => state.projects,
      getSelectedProjectId: () => state.selectedProjectId,
      onStartProject: async (projectId) => {
        await prepareNewConversationForProject(projectId);
        renderWelcomePanel();
        setTimeout(() => {
          if (inputEl) inputEl.focus();
        }, 0);
      },
      onCreateProject: async () => {
        await onAddProject();
        renderWelcomePanel();
      },
      onClose: renderWelcomePanel,
    })
  : null;
let projectFileTreeController = null;
const projectFileEditorController = window.FaberProjectFileEditor
  ? window.FaberProjectFileEditor.createProjectFileEditorController({
      api: window.localcodeApi,
      getProjectInfo: () => state.selectedProjectInfo,
      onSaved: async () => {
        if (projectFileTreeController) await projectFileTreeController.refresh();
      },
      notify: (message) => appendMessage('assistant', message, { persistToConversation: false }),
    })
  : null;
projectFileTreeController = window.FaberProjectFileTree
  ? window.FaberProjectFileTree.createProjectFileTreeController({
      api: window.localcodeApi,
      getProjectInfo: () => state.selectedProjectInfo,
      ensureProjectReady: ensureSelectedProjectInfoReady,
      beforeRender: renderIncrementalModeBadge,
      onOpenFile: async (relativePath, options = {}) => {
        if (projectFileEditorController) await projectFileEditorController.open(relativePath, options);
      },
      requestFileRename: async ({ currentName }) => requestTextInputDialog({
        title: 'Renomear arquivo',
        initialValue: currentName,
        placeholder: 'Novo nome do arquivo',
      }),
      notify: (message) => appendMessage('assistant', message, { persistToConversation: false }),
    })
  : null;
projectController = window.FaberAppProjects
  ? window.FaberAppProjects.createAppProjectController({
      api: window.localcodeApi,
      callbacks: {
        appendMessage,
        clearPending,
        ensureConversationStateForProject,
        getActiveConversationId,
        hideJobProgress,
        loadConversationMessages,
        refreshCortexLearningPanel,
        renderChatForActiveConversation,
        renderNextSteps,
        renderSystemNotice,
        renderWelcomePanel,
        stopJobPolling,
        updateStatus,
      },
      controllers: {
        automataContractsController,
        chatController,
        inlineInputDialogController,
        projectFileEditorController,
        projectFileTreeController,
        projectSidebarController,
        projectStateModalController,
        projectTerminalController,
        applicationMapController,
        milestonesPanelController,
      },
      elements: { incrementalModeBadgeEl },
      state,
      t,
    })
  : null;
actionController = window.FaberAppActions
  ? window.FaberAppActions.createAppActionsController({
      api: window.localcodeApi,
      automataContractsController,
      callbacks: {
        appendChangeCard,
        appendMessage,
        buildPersonaRequestContextHint,
        clearPending,
        clearTransientChatNotices,
        ensureActiveConversationForSend,
        ensureSelectedProjectInfoReady,
        getRecentConversationMessagesForPersona,
        hideJobProgress,
        hidePersonaThinkingIndicator,
        normalizeProjectItems,
        openWelcomeProjectModal,
        pollJob,
        prepareNewConversationForProject,
        renderAttachments,
        renderCortexLearning,
        renderCortexRuntimeStatus,
        renderJobProgress,
        renderNextSteps,
        renderProjects,
        resetTextareaHeight,
        selectProject,
        showChangeSummary,
        showModificationAlert,
        showPending,
        showPersonaThinkingIndicator,
        startJobPolling,
        stopJobPolling,
        updateStatus,
        watchLatestProjectJob,
      },
      controllers: {
        accountGateController,
        aiSettingsController,
        cortexController,
        projectFileTreeController,
        projectToolsController,
      },
      elements: { inputEl },
      formatters: {
        buildExecutionOutcomeAssistantMessage,
        isManualRetryMessage,
        shouldSuppressInterimAssistantPlanMessage,
      },
      state,
      t,
    })
  : null;
eventsController = window.FaberAppEvents
  ? window.FaberAppEvents.createAppEventsController({
      api: window.localcodeApi,
      callbacks: {
        closeAiSettingsModal,
        closeCortexModal,
        closeProjectStateModal,
        closeWelcomeProjectModal,
        hideProjectContextMenu,
        onAddProject,
        onCancel,
        onConfirm,
        onNewConversation,
        onProjectGitClick,
        onProjectPreviewClick,
        onSend,
        openAiSettingsModal,
        openCortexModal,
      },
      controllers: {
        accountGateController,
        aiSettingsController,
        automataContractsController,
        chatController,
        cortexController,
        projectFileEditorController,
        projectFileTreeController,
        projectSidebarController,
        projectStateModalController,
        projectTerminalController,
        welcomeProjectModalController,
        workspaceLayoutController,
      },
      elements: {
        appDragRegionEl,
        appShellEl,
        cortexModeBtnEl,
        inputEl,
        newConversationBtnEl,
        projectGitBtnEl,
        projectPreviewBtnEl,
        projectSettingsBtnEl,
      },
    })
  : null;
const startupPreloaderController = window.FaberStartupPreloader.createStartupPreloaderController({
  element: document.getElementById('startup-preloader'),
  minVisibleMs: 3000,
});

const i18nController = window.FaberI18n
  ? window.FaberI18n.createI18nController({
      getLocale: () => state.interfaceLanguage,
    })
  : null;

preferencesController = window.FaberAppPreferences
  ? window.FaberAppPreferences.createAppPreferencesController({
      callbacks: {
        applyStaticTranslations,
        refreshAiSettingsCurrentLine,
        renderAiSettingsApiList,
        renderCortexLearning,
        renderNextSteps,
        renderWelcomePanel,
        setUiMode,
      },
      inputEl,
      normalizeInterfaceLanguage,
      state,
      translate: t,
      uiAppearanceController,
    })
  : null;

function t(key, fallback = '') {
  return i18nController ? i18nController.translate(key, fallback) : fallback || key;
}

function applyStaticTranslations() {
  if (i18nController) i18nController.applyStaticTranslations();
}

function applyAppearanceSettings(settings = {}, options = {}) {
  if (preferencesController) return preferencesController.applyAppearanceSettings(settings, options);
  return {
    interfaceTheme: state.interfaceTheme,
    panelFontScale: state.panelFontScale,
  };
}

function applyInterfaceLanguage(locale, options = {}) {
  if (preferencesController) preferencesController.applyInterfaceLanguage(locale, options);
}

function applyAccountPreferences(user = null) {
  if (preferencesController) preferencesController.applyAccountPreferences(user);
}

function hideStartupPreloader() {
  startupPreloaderController.hide();
}


function resetTextareaHeight() {
  if (chatController) chatController.resetTextareaHeight();
}

function autoResizeTextarea() {
  if (chatController) chatController.autoResizeTextarea();
}

function renderAttachments() {
  if (chatController) chatController.renderAttachments();
}

function renderMessageBubble(role, text) {
  return chatController ? chatController.renderMessageBubble(role, text) : null;
}

function requestChatScrollToBottom() {
  if (chatController && typeof chatController.scrollToBottom === 'function' && chatController.hasMessages()) {
    chatController.scrollToBottom();
  }
}

function renderSystemNotice(text) {
  if (chatController && typeof chatController.renderSystemNotice === 'function') {
    return chatController.renderSystemNotice(text);
  }
  return renderMessageBubble('system', text);
}

function clearTransientChatNotices() {
  if (chatController && typeof chatController.clearSystemNotices === 'function') {
    chatController.clearSystemNotices();
  }
}

function shouldShowWelcomePanel() {
  if (!welcomePanelEl || !chatLogEl) return false;
  if (state.uiMode === 'cortex') return false;
  const tabMap = document.getElementById('btn-tab-map');
  if (tabMap && tabMap.classList.contains('active')) return false;
  const hasChatContent = chatLogEl.children.length > 0;
  const hasPendingAction = pendingActionEl && !pendingActionEl.classList.contains('hidden');
  const hasJobProgress = Boolean(jobProgressController && jobProgressController.isVisible());
  return !hasChatContent && !hasPendingAction && !hasJobProgress;
}

function renderWelcomePanel() {
  if (!welcomePanelEl || !chatLogEl) return;
  const visible = shouldShowWelcomePanel();
  const becameVisible = visible && !welcomePanelWasVisible;
  welcomePanelWasVisible = visible;
  welcomePanelEl.classList.toggle('hidden', !visible);
  chatLogEl.classList.toggle('chat-log--welcome-hidden', visible);
  if (panelCenterEl) {
    panelCenterEl.classList.toggle('panel-center--welcome', visible);
  }
  if (visible) {
    restartWelcomeIntroAnimation(becameVisible);
  } else {
    welcomePanelEl.classList.remove('welcome-panel--animate');
  }
  if (visible && window.FaberWelcomeQuotes) {
    const quote = window.FaberWelcomeQuotes.applyWelcomeQuote({
      locale: state.interfaceLanguage,
      forceReplay: becameVisible,
    });
    if (quote && becameVisible) persistWelcomeQuoteHistory(quote.author);
  }
  renderCenterTitle();
}

function restartWelcomeIntroAnimation(forceRestart = false) {
  if (!welcomePanelEl) return;
  if (!forceRestart) {
    welcomePanelEl.classList.add('welcome-panel--animate');
    return;
  }
  welcomePanelEl.classList.remove('welcome-panel--animate');
  if (welcomePanelAnimationFrame) {
    cancelAnimationFrame(welcomePanelAnimationFrame);
    welcomePanelAnimationFrame = null;
  }
  welcomePanelAnimationFrame = requestAnimationFrame(() => {
    welcomePanelEl.classList.add('welcome-panel--animate');
    welcomePanelAnimationFrame = null;
  });
}

async function hydrateWelcomeQuoteHistoryFromSettings() {
  if (!window.FaberWelcomeQuotes || !window.localcodeApi || !window.localcodeApi.getAiSettings) return;
  try {
    const settings = await window.localcodeApi.getAiSettings();
    if (settings && settings.ok && typeof window.FaberWelcomeQuotes.setLastAuthor === 'function') {
      window.FaberWelcomeQuotes.setLastAuthor(settings.welcomeQuoteLastAuthor || '', { clearSession: true });
    }
  } catch {
    // Local storage remains the fallback when runtime settings are unavailable.
  }
}

async function persistWelcomeQuoteHistory(author) {
  const normalizedAuthor = String(author || '').trim();
  if (!normalizedAuthor || !window.localcodeApi || !window.localcodeApi.saveAiSettings) return;
  try {
    await window.localcodeApi.saveAiSettings({ welcomeQuoteLastAuthor: normalizedAuthor });
  } catch {
    // Non-critical; the next launch can still rely on localStorage when available.
  }
}

function closeWelcomeProjectModal() {
  if (welcomeProjectModalController) welcomeProjectModalController.close();
}

function openWelcomeProjectModal() {
  if (welcomeProjectModalController) welcomeProjectModalController.open();
}

function showPersonaThinkingIndicator() {
  return chatController ? chatController.showThinkingIndicator() : null;
}

function hidePersonaThinkingIndicator() {
  if (chatController) chatController.hideThinkingIndicator();
}

const PERSONA_RECENT_USER_MESSAGE_CHAR_LIMIT = 12000;
const PERSONA_RECENT_ASSISTANT_MESSAGE_CHAR_LIMIT = 2200;

function getRecentConversationMessagesForPersona(limit = 10) {
  const conversationId = getActiveConversationId(state.selectedProjectId);
  if (!conversationId) return [];
  const messages = state.conversationMessagesById[conversationId] || [];
  return messages
    .slice(Math.max(0, messages.length - limit))
    .map((message) => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const textLimit =
        role === 'user'
          ? PERSONA_RECENT_USER_MESSAGE_CHAR_LIMIT
          : PERSONA_RECENT_ASSISTANT_MESSAGE_CHAR_LIMIT;
      return {
        role,
        text: String(message.text || '').slice(0, textLimit),
        createdAt: message.createdAt || null,
      };
    })
    .filter((message) => message.text.trim());
}

function buildPersonaRequestContextHint(extra = {}) {
  return {
    awaitingTechnicalPdfConfirmation: Boolean(
      state.lastAssistantMeta && state.lastAssistantMeta.awaitingTechnicalPdfConfirmation
    ),
    awaitingScaffoldClarification: Boolean(
      state.lastAssistantMeta && state.lastAssistantMeta.awaitingScaffoldClarification
    ),
    scaffoldClarificationAttempts:
      state.lastAssistantMeta && Number.isFinite(state.lastAssistantMeta.scaffoldClarificationAttempts)
        ? Number(state.lastAssistantMeta.scaffoldClarificationAttempts)
        : 0,
    personaPlanAttempts:
      state.lastAssistantMeta && Number.isFinite(state.lastAssistantMeta.personaPlanAttempts)
        ? Number(state.lastAssistantMeta.personaPlanAttempts)
        : 0,
    personaPlanStartedAt:
      state.lastAssistantMeta && typeof state.lastAssistantMeta.personaPlanStartedAt === 'string'
        ? state.lastAssistantMeta.personaPlanStartedAt
        : null,
    lastPlanner: state.lastAssistantMeta && state.lastAssistantMeta.planner ? state.lastAssistantMeta.planner : null,
    lastIntent: state.lastAssistantMeta && state.lastAssistantMeta.intent ? state.lastAssistantMeta.intent : null,
    lastReason: state.lastAssistantMeta && state.lastAssistantMeta.reason ? state.lastAssistantMeta.reason : null,
    lastHadAction: Boolean(state.lastAssistantMeta && state.lastAssistantMeta.lastHadAction),
    lastScaffoldPrompt:
      state.lastAssistantMeta && typeof state.lastAssistantMeta.lastScaffoldPrompt === 'string'
        ? state.lastAssistantMeta.lastScaffoldPrompt
        : null,
    latestDiagnostics: buildDiagnosticsContextHint(state.lastQualityReport),
    lastJobContext: state.lastJobContext,
    ...extra,
  };
}

function getActiveConversationId(projectId) {
  return conversationController ? conversationController.getActiveConversationId(projectId) : null;
}

function getActiveConversationTitle() {
  const conversation = getActiveConversation();
  return String((conversation && conversation.title) || '').trim();
}

function getActiveConversation() {
  const projectId = state.selectedProjectId;
  const conversationId = getActiveConversationId(projectId);
  if (!projectId || !conversationId) return null;
  const conversations = state.projectConversations[projectId] || [];
  return conversations.find((item) => item && item.id === conversationId) || null;
}

function renderCenterTitle() {
  if (!centerTitleEl) return;
  const cortexActive = state.uiMode === 'cortex';
  const title = cortexActive ? t('rulesMemory') : getActiveConversationTitle();
  const hasTitle = Boolean(title);
  const editable = hasTitle && !cortexActive && Boolean(getActiveConversation());
  centerTitleEl.classList.remove('center-title--editing');
  centerTitleEl.textContent = hasTitle ? title : '';
  centerTitleEl.title = hasTitle ? title : '';
  centerTitleEl.classList.toggle('center-title-hidden', !hasTitle);
  centerTitleEl.classList.toggle('center-title--editable', editable);
  centerTitleEl.setAttribute('aria-hidden', hasTitle ? 'false' : 'true');
  if (editable) {
    centerTitleEl.tabIndex = 0;
    centerTitleEl.setAttribute('role', 'button');
    centerTitleEl.setAttribute('aria-label', `Editar título da conversa: ${title}`);
  } else {
    centerTitleEl.removeAttribute('tabindex');
    centerTitleEl.removeAttribute('role');
    centerTitleEl.removeAttribute('aria-label');
  }
  if (panelCenterEl) panelCenterEl.classList.toggle('panel-center--has-title', hasTitle);
}

function setActiveConversation(projectId, conversationId) {
  if (conversationController) conversationController.setActiveConversation(projectId, conversationId);
  renderCenterTitle();
}

function ensureConversationMessagesBucket(conversationId) {
  if (conversationController) conversationController.ensureConversationMessagesBucket(conversationId);
}

async function loadConversationMessages(conversationId) {
  return conversationController ? conversationController.loadConversationMessages(conversationId) : [];
}

async function persistConversationMessage(role, text) {
  if (conversationController) await conversationController.persistConversationMessage(role, text);
}

function appendMessage(role, text, attachments = [], options = {}) {
  if (conversationController) conversationController.appendMessage(role, text, attachments, options);
}

function renderChatForActiveConversation() {
  if (conversationController) conversationController.renderChatForActiveConversation();
  renderCenterTitle();
}

function ensureProjectConversationBucket(projectId) {
  if (conversationController) conversationController.ensureProjectConversationBucket(projectId);
}

function ensureConversationStateForProject(projectId) {
  if (conversationController) conversationController.ensureConversationStateForProject(projectId);
}

async function addConversationForProject(projectId, text) {
  return conversationController ? conversationController.addConversationForProject(projectId, text) : null;
}

async function ensureActiveConversationForSend(initialUserMessage) {
  return conversationController ? conversationController.ensureActiveConversationForSend(initialUserMessage) : null;
}

function appendChangeCard(action, result) {
  if (chatController) chatController.appendChangeCard(action, result);
}

function showChangeSummary(action, result) {
  if (chatController && typeof chatController.showChangeSummary === 'function') {
    chatController.showChangeSummary(action, result);
  }
}

function updateStatus(text) {
  if (!statusPillEl) return;
  const presentation = window.FaberUxStateModel
    ? window.FaberUxStateModel.buildStatusPresentation(text)
    : {
        label: String(text || '').trim() || 'Aguardando',
        tone: 'neutral',
        busy: false,
        ariaLabel: String(text || '').trim() || 'Aguardando',
      };
  statusPillEl.textContent = presentation.label;
  statusPillEl.dataset.uxTone = presentation.tone;
  statusPillEl.setAttribute('aria-busy', presentation.busy ? 'true' : 'false');
  statusPillEl.setAttribute('aria-label', presentation.ariaLabel || presentation.label);
}

function stopJobPolling() {
  if (jobController) jobController.stopJobPolling();
}

function hideJobProgress() {
  if (jobController) jobController.hideJobProgress();
}

function renderJobProgress(job) {
  if (jobController) jobController.renderJobProgress(job);
}

async function maybeAutoRetryPendingJob(job) {
  if (jobController) await jobController.maybeAutoRetryPendingJob(job);
}

async function pollJob(jobId) {
  return jobController ? jobController.pollJob(jobId) : null;
}

function startJobPolling(jobId) {
  if (jobController) jobController.startJobPolling(jobId);
}

function watchLatestProjectJob(request) {
  return jobController && typeof jobController.watchLatestProjectJob === 'function'
    ? jobController.watchLatestProjectJob(request)
    : () => {};
}

function renderNextSteps() {
  nextStepsListEl.innerHTML = '';
  const steps = state.nextSteps.length
    ? state.nextSteps
    : [t('selectProjectNextSteps')];

  for (const step of steps) {
    const li = document.createElement('li');
    li.textContent = step;
    nextStepsListEl.appendChild(li);
  }
}

function setUiMode(mode) {
  state.uiMode = mode === 'cortex' ? 'cortex' : 'default';
  const cortexActive = state.uiMode === 'cortex';
  if (cortexModeBtnEl) {
    cortexModeBtnEl.classList.toggle('active', cortexActive);
  }
  renderCenterTitle();
  if (rightPanelTitleEl) {
    rightPanelTitleEl.textContent = cortexActive ? t('rulesMemory') : t('files');
  }
  if (cortexLearningBoxEl) {
    cortexLearningBoxEl.classList.toggle('hidden', !cortexActive);
  }
  if (document.body) {
    document.body.classList.toggle('mode-cortex', cortexActive);
    if (cortexActive) {
      document.body.classList.remove('mode-milestones');
      document.body.classList.remove('mode-map-chat');
      document.body.classList.remove('mode-map-render');
      document.body.classList.remove('mode-git');
      document.body.classList.remove('mode-terminal');
      const milestonesBtn = document.getElementById('btn-project-milestones');
      if (milestonesBtn) milestonesBtn.classList.remove('active');
      const mapAiBtn = document.getElementById('btn-map-ai');
      if (mapAiBtn) mapAiBtn.classList.remove('active');
      const gitBtn = document.getElementById('btn-project-git');
      if (gitBtn) gitBtn.classList.remove('active');
      const terminalBtn = document.getElementById('btn-project-terminal');
      if (terminalBtn) terminalBtn.classList.remove('active');

      if (projectTerminalController) {
        projectTerminalController.closePanel();
      }
    }
  }

  const filesBtn = document.getElementById('btn-project-files');
  if (filesBtn) {
    const otherModeActive = document.body
      ? document.body.classList.contains('mode-git')
        || document.body.classList.contains('mode-terminal')
        || document.body.classList.contains('mode-milestones')
        || document.body.classList.contains('mode-map-chat')
        || document.body.classList.contains('mode-map-render')
      : false;
    filesBtn.classList.toggle('active', !cortexActive && !otherModeActive);
  }

  if (inputEl) {
    inputEl.placeholder = cortexActive
      ? t('cortexComposerPlaceholder')
      : t('composerPlaceholder');
  }

  renderIncrementalModeBadge();
  renderWelcomePanel();
}

function renderCortexLearning(learning) {
  if (cortexController) cortexController.renderLearning(learning);
}

function renderCortexRuntimeStatus(status) {
  if (cortexController) cortexController.renderRuntimeStatus(status);
}

async function refreshKnowledgeRuntimeStatus() {
  return cortexController ? cortexController.refreshKnowledgeRuntimeStatus() : null;
}

async function openCortexModal() {
  if (cortexController) await cortexController.openModal();
}

function closeCortexModal() {
  if (cortexController) cortexController.closeModal();
}

async function refreshCortexLearningPanel() {
  if (cortexController) await cortexController.refreshLearningPanel();
}

function summarizeProject(info) {
  return projectController ? projectController.summarizeProject(info) : window.t ? window.t('noProjectSelected', 'Nenhum projeto selecionado.') : 'Nenhum projeto selecionado.';
}

function normalizeProjectItems(rawProjects) {
  return projectController ? projectController.normalizeProjectItems(rawProjects) : [];
}

function clearSelectionState() {
  if (projectController) projectController.clearSelectionState();
}

function reconcileSelectionAfterProjectListUpdate() {
  if (projectController) projectController.reconcileSelectionAfterProjectListUpdate();
}

function hideProjectContextMenu() {
  if (projectController) projectController.hideProjectContextMenu();
}

function requestTextInputDialog(options = {}) {
  return projectController ? projectController.requestTextInputDialog(options) : Promise.resolve(null);
}

async function requestProjectRename(projectId, currentName = 'Projeto') {
  return projectController ? projectController.requestProjectRename(projectId, currentName) : null;
}

async function requestConversationRename(projectId, conversation) {
  if (projectController) await projectController.requestConversationRename(projectId, conversation);
  renderCenterTitle();
}

async function saveConversationTitle(projectId, conversation, nextTitle) {
  if (projectController && typeof projectController.renameConversation === 'function') {
    await projectController.renameConversation(projectId, conversation, nextTitle);
  } else if (conversation) {
    conversation.title = String(nextTitle || '').trim();
    renderProjects();
  }
  renderCenterTitle();
}

function editActiveConversationTitle() {
  const projectId = state.selectedProjectId;
  const conversation = getActiveConversation();
  if (!projectId || !conversation || state.uiMode === 'cortex') return;
  const currentTitle = String(conversation.title || 'Conversa').trim();
  centerTitleEl.classList.add('center-title--editing');
  centerTitleEl.classList.remove('center-title--editable');
  centerTitleEl.textContent = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'center-title-input';
  input.value = currentTitle;
  input.placeholder = 'Título da conversa';
  input.setAttribute('aria-label', 'Título da conversa');
  centerTitleEl.appendChild(input);

  let closed = false;
  let committing = false;

  function closeEditor() {
    closed = true;
    renderCenterTitle();
  }

  async function commitEditor() {
    if (closed || committing) return;
    committing = true;
    const nextTitle = input.value.trim();
    input.disabled = true;
    if (!nextTitle || nextTitle === currentTitle) {
      closeEditor();
      return;
    }
    await saveConversationTitle(projectId, conversation, nextTitle);
    closed = true;
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEditor();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEditor();
    }
  });
  input.addEventListener('blur', () => {
    commitEditor();
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

async function prepareNewConversationForProject(projectId) {
  if (projectController) await projectController.prepareNewConversationForProject(projectId);
}

function closeProjectStateModal() {
  if (projectController) projectController.closeProjectStateModal();
}

async function runProjectContextAction(action, projectId) {
  if (projectController) await projectController.runProjectContextAction(action, projectId);
}

function renderProjects() {
  if (projectController) projectController.renderProjects();
  renderCenterTitle();
}

async function loadProjects() {
  if (projectController) await projectController.loadProjects();
}

function renderIncrementalModeBadge() {
  if (projectController) projectController.renderIncrementalModeBadge();
}

async function ensureSelectedProjectInfoReady(options = {}) {
  return projectController ? projectController.ensureSelectedProjectInfoReady(options) : false;
}

async function selectProject(projectId, options = {}) {
  if (projectController) await projectController.selectProject(projectId, options);
}

function clearPending() {
  state.pendingAction = null;
  pendingActionEl.classList.add('hidden');
  pendingActionEl.removeAttribute('data-ux-tone');
  pendingTextEl.textContent = '';
  renderWelcomePanel();
}

function showPending(text, action) {
  state.pendingAction = action;
  pendingTextEl.textContent = text;
  pendingActionEl.dataset.uxTone = 'warning';
  pendingActionEl.classList.remove('hidden');
  renderWelcomePanel();
}

function showModificationAlert(message) {
  if (chatController) chatController.showModificationAlert(message);
}

async function applyComposerProviderBeforeSend() {
  if (actionController) await actionController.applyComposerProviderBeforeSend();
}

async function ensureAccountUnlockedForProductUse() {
  return actionController ? actionController.ensureAccountUnlockedForProductUse() : true;
}

async function onSend() {
  if (actionController) await actionController.onSend();
}

async function onConfirm() {
  if (actionController) await actionController.onConfirm();
}

async function onCancel() {
  if (actionController) await actionController.onCancel();
}

async function onNewConversation() {
  if (actionController) await actionController.onNewConversation();
}

async function onAddProject() {
  if (actionController) await actionController.onAddProject();
}

async function onProjectGitClick() {
  if (actionController) await actionController.onProjectGitClick();
}

async function onProjectPreviewClick() {
  if (actionController) await actionController.onProjectPreviewClick();
}

function normalizeKnownProvider(rawValue) {
  return window.FaberAiSettings
    ? window.FaberAiSettings.normalizeKnownProvider(rawValue)
    : 'rwkv';
}

function normalizeInterfaceLanguage(rawValue) {
  return window.FaberAiSettings
    ? window.FaberAiSettings.normalizeInterfaceLanguage(rawValue)
    : 'pt-BR';
}

function refreshAiSettingsCurrentLine() {
  if (aiSettingsController) aiSettingsController.refreshCurrentLine();
}

function renderAiSettingsApiList() {
  if (aiSettingsController) aiSettingsController.renderApiList();
}

async function openAiSettingsModal() {
  if (aiSettingsController) await aiSettingsController.open();
}

function closeAiSettingsModal() {
  if (aiSettingsController) aiSettingsController.close();
}

function bindEvents() {
  bindCenterTitleEvents();
  if (eventsController) eventsController.bindEvents();
}

function bindCenterTitleEvents() {
  if (!centerTitleEl || centerTitleEl.dataset.renameBound === '1') return;
  centerTitleEl.dataset.renameBound = '1';
  centerTitleEl.addEventListener('click', (event) => {
    if (!centerTitleEl.classList.contains('center-title--editable')) return;
    event.preventDefault();
    editActiveConversationTitle();
  });
  centerTitleEl.addEventListener('keydown', (event) => {
    if (!centerTitleEl.classList.contains('center-title--editable')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    editActiveConversationTitle();
  });
}

async function setupAppUpdater() {
  const updateContainer = document.getElementById('update-action-container');
  const updateBtn = document.getElementById('btn-app-update');
  if (!updateContainer || !updateBtn) return;

  updateBtn.addEventListener('click', async () => {
    if (updateBtn.disabled) return;
    const confirm = await window.faberConfirm('Deseja baixar e instalar a atualização do Faber Code agora? A aplicação será reiniciada após a instalação.');
    if (!confirm) return;

    try {
      updateBtn.disabled = true;
      const textSpan = updateBtn.querySelector('.update-text');
      if (textSpan) textSpan.textContent = 'Baixando...';
      const result = await window.localcodeApi.installUpdate({ downloadUrl });
      if (result && !result.ok) {
        await window.faberAlert('Erro ao instalar atualização: ' + result.message);
        updateBtn.disabled = false;
        if (textSpan) textSpan.textContent = 'Update';
      }
    } catch (err) {
      console.error(err);
      await window.faberAlert('Falha ao processar atualização.');
      updateBtn.disabled = false;
      const textSpan = updateBtn.querySelector('.update-text');
      if (textSpan) textSpan.textContent = 'Update';
    }
  });

  try {
    const result = await window.localcodeApi.checkForUpdates();
    if (result && result.available) {
      updateContainer.classList.remove('hidden');
      updateBtn.dataset.version = result.latestVersion;
      updateBtn.dataset.downloadUrl = result.downloadUrl;
    } else {
      updateContainer.classList.add('hidden');
    }
  } catch (err) {
    console.error('Erro ao verificar atualizações:', err);
    updateContainer.classList.add('hidden');
  }
}

async function bootstrap() {
  if (panelLayoutController) panelLayoutController.initialize();
  if (workspaceLayoutController) workspaceLayoutController.initialize();
  bindEvents();
  applyAppearanceSettings({ interfaceTheme: state.interfaceTheme, panelFontScale: state.panelFontScale }, { rerender: false });
  applyInterfaceLanguage(state.interfaceLanguage, { rerender: false });
  setUiMode('default');
  hideJobProgress();
  resetTextareaHeight();
  await loadProjects();
  renderNextSteps();
  renderAttachments();
  if (projectFileTreeController) projectFileTreeController.render();
  if (projectTerminalController) projectTerminalController.render();
  await setupAppUpdater();
  if (automataContractsController) {
    state.automataContractSummary = await automataContractsController.refreshSummary();
  }
  if (applicationMapController) applicationMapController.init();
  if (milestonesPanelController) milestonesPanelController.init();

  try {
    state.aiRuntimeStatus = await window.localcodeApi.getAiStatus();
    state.selectedAiProvider =
      state.aiRuntimeStatus && state.aiRuntimeStatus.provider
        ? String(state.aiRuntimeStatus.provider)
        : state.selectedAiProvider;
  } catch {
    state.aiRuntimeStatus = null;
  }

  if (aiSettingsController) await aiSettingsController.loadInitialSettings();
  await hydrateWelcomeQuoteHistoryFromSettings();
  if (accountGateController) await accountGateController.refresh();

  state.mempalaceStatus = null;

  renderWelcomePanel();
}

let __bootFinished = false;
const __preloaderWatchdog = startupPreloaderController.startWatchdog({
  timeoutMs: 3000,
  isFinished: () => __bootFinished === true,
  onTimeout: () => {
    console.warn('[bootstrap] watchdog: ocultando preloader por timeout');
  },
});

bootstrap()
  .catch((error) => {
    console.error('[bootstrap] erro:', error);
  })
  .finally(() => {
    __bootFinished = true;
    clearTimeout(__preloaderWatchdog);
    hideStartupPreloader();
  });
