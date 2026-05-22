let state;
let conversationController = null;
let projectController = null;
let jobController = null;
let actionController = null;
let eventsController = null;
let preferencesController = null;

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
  { globalName: 'FaberJobProgress', methods: ['createJobProgressController'] },
  { globalName: 'FaberPanelLayout', methods: ['createPanelLayoutController'] },
  { globalName: 'FaberAutomataContracts', methods: ['createAutomataContractsController', 'statusLabel'] },
  { globalName: 'FaberProjectTools', methods: ['createProjectToolsController', 'formatGithubPublishPlan', 'formatPreviewStartFailure', 'inferGithubRepoNameFromProject'] },
  { globalName: 'FaberProjectFileEditor', methods: ['createProjectFileEditorController'] },
  { globalName: 'FaberProjectFileTree', methods: ['createProjectFileTreeController'] },
  { globalName: 'FaberProjectSidebar', methods: ['createProjectSidebarController', 'normalizeProjectItems'] },
  { globalName: 'FaberProjectStateModal', methods: ['createProjectStateModalController'] },
  { globalName: 'FaberProjectTerminal', methods: ['createProjectTerminalController'] },
  { globalName: 'FaberWelcomeProjectModal', methods: ['createWelcomeProjectModalController'] },
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
      onStatusChange: (status, unlocked) => {
        state.accountStatus = status || null;
        state.accountUnlocked = Boolean(unlocked);
        applyAccountPreferences(status && status.user ? status.user : null);
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
      onOpenFile: async (relativePath) => {
        if (projectFileEditorController) await projectFileEditorController.open(relativePath);
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
        showModificationAlert,
        showPending,
        showPersonaThinkingIndicator,
        startJobPolling,
        stopJobPolling,
        updateStatus,
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
  const hasChatContent = chatLogEl.children.length > 0;
  const hasPendingAction = pendingActionEl && !pendingActionEl.classList.contains('hidden');
  const hasJobProgress = Boolean(jobProgressController && jobProgressController.isVisible());
  return !hasChatContent && !hasPendingAction && !hasJobProgress;
}

function renderWelcomePanel() {
  if (!welcomePanelEl || !chatLogEl) return;
  const visible = shouldShowWelcomePanel();
  welcomePanelEl.classList.toggle('hidden', !visible);
  chatLogEl.classList.toggle('chat-log--welcome-hidden', visible);
  if (panelCenterEl) {
    panelCenterEl.classList.toggle('panel-center--welcome', visible);
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

function getRecentConversationMessagesForPersona(limit = 10) {
  const conversationId = getActiveConversationId(state.selectedProjectId);
  if (!conversationId) return [];
  const messages = state.conversationMessagesById[conversationId] || [];
  return messages
    .slice(Math.max(0, messages.length - limit))
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      text: String(message.text || '').slice(0, 1200),
      createdAt: message.createdAt || null,
    }))
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

function setActiveConversation(projectId, conversationId) {
  if (conversationController) conversationController.setActiveConversation(projectId, conversationId);
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

function appendMessage(role, text, options = {}) {
  if (conversationController) conversationController.appendMessage(role, text, options);
}

function renderChatForActiveConversation() {
  if (conversationController) conversationController.renderChatForActiveConversation();
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

function updateStatus(text) {
  statusPillEl.textContent = text;
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
  if (centerTitleEl) {
    centerTitleEl.textContent = cortexActive ? t('rulesMemory') : t('contextConversation');
  }
  if (rightPanelTitleEl) {
    rightPanelTitleEl.textContent = cortexActive ? t('rulesMemory') : t('files');
  }
  if (cortexLearningBoxEl) {
    cortexLearningBoxEl.classList.toggle('hidden', !cortexActive);
  }
  if (document.body) {
    document.body.classList.toggle('mode-cortex', cortexActive);
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
  return projectController ? projectController.summarizeProject(info) : 'Nenhum projeto selecionado.';
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

async function selectProject(projectId) {
  if (projectController) await projectController.selectProject(projectId);
}

function clearPending() {
  state.pendingAction = null;
  pendingActionEl.classList.add('hidden');
  pendingTextEl.textContent = '';
  renderWelcomePanel();
}

function showPending(text, action) {
  state.pendingAction = action;
  pendingTextEl.textContent = text;
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
  if (eventsController) eventsController.bindEvents();
}

async function bootstrap() {
  if (panelLayoutController) panelLayoutController.initialize();
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
  if (automataContractsController) {
    state.automataContractSummary = await automataContractsController.refreshSummary();
  }

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
