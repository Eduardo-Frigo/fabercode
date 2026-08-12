const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const rendererDir = path.join(rootDir, 'renderer');
const indexHtml = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
const progressiveSource = fs.readFileSync(path.join(rendererDir, 'progressive_disclosure.js'), 'utf8');
const mapCanvasSource = fs.readFileSync(path.join(rendererDir, 'application_map_canvas.js'), 'utf8');
const applicationMapSource = fs.readFileSync(path.join(rendererDir, 'application_map.js'), 'utf8');
const milestonesSource = fs.readFileSync(path.join(rendererDir, 'milestones_panel.js'), 'utf8');
const projectSidebarSource = fs.readFileSync(path.join(rendererDir, 'project_sidebar.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
const tutorialRenderStart = applicationMapSource.indexOf('generateTutorialRenderDraftHandler = async');
const tutorialRenderEnd = applicationMapSource.indexOf('async function sendRenderChatMessage', tutorialRenderStart);
const tutorialRenderSource = applicationMapSource.slice(tutorialRenderStart, tutorialRenderEnd);
const tutorialDevelopmentStart = appSource.indexOf('async function simulateTutorialDevelopmentConversation');
const tutorialDevelopmentEnd = appSource.indexOf('function appendChangeCard', tutorialDevelopmentStart);
const tutorialDevelopmentSource = appSource.slice(tutorialDevelopmentStart, tutorialDevelopmentEnd);
const conversationSelectionStart = appSource.indexOf('onSelectConversation: async');
const conversationSelectionEnd = appSource.indexOf('onRenameProject:', conversationSelectionStart);
const conversationSelectionSource = appSource.slice(conversationSelectionStart, conversationSelectionEnd);

const rendererScripts = [...indexHtml.matchAll(/<script\s+src="(\.\/[^"]+\.js)"><\/script>/g)].map(
  (match) => match[1]
);
const lightThemeIcons = [
  'brain-light.svg',
  'archive-light.svg',
  'bin-light.svg',
  'settings-light.svg',
];

assert.ok(conversationSelectionStart >= 0 && conversationSelectionEnd > conversationSelectionStart);
assert.ok(
  conversationSelectionSource.indexOf("resetApprovalMode('conversation_switch')")
    < conversationSelectionSource.indexOf('await loadConversationMessages(conversation.id)'),
  'conversation switches must reset the task approval preference before awaiting message loading',
);
const accountStatusStart = appSource.indexOf('onStatusChange: (status, unlocked) =>');
const accountStatusEnd = appSource.indexOf('    })\n  : null;', accountStatusStart);
const accountStatusSource = appSource.slice(accountStatusStart, accountStatusEnd);
assert.ok(accountStatusStart >= 0 && accountStatusEnd > accountStatusStart);
assert.match(accountStatusSource, /previousIdentity\s*!==\s*nextIdentity/);
assert.match(accountStatusSource, /resetForAccountContextChange\('account_context_change'\)/);

const expectedModules = [
  {
    script: './bootstrap_guard.js',
    globalName: 'FaberBootstrapGuard',
    methods: ['getMissingRendererModules', 'requireRendererModules', 'showFatalBootError'],
  },
  {
    script: './app_state.js',
    globalName: 'FaberAppState',
    methods: ['createInitialRendererState'],
  },
  {
    script: './app_formatters.js',
    globalName: 'FaberAppFormatters',
    methods: [
      'buildDiagnosticsContextHint',
      'buildExecutionOutcomeAssistantMessage',
      'buildJobContextForPersona',
      'buildTerminalJobMessage',
      'formatAiRuntimeMessage',
      'formatDiffPreviewForChat',
      'formatMempalaceRuntimeMessage',
      'isManualRetryMessage',
      'parseProviderHttpStatusFromReason',
      'shouldSuppressInterimAssistantPlanMessage',
    ],
  },
  {
    script: './app_conversations.js',
    globalName: 'FaberAppConversations',
    methods: ['createAppConversationController'],
  },
  {
    script: './app_projects.js',
    globalName: 'FaberAppProjects',
    methods: ['createAppProjectController'],
  },
  {
    script: './app_jobs.js',
    globalName: 'FaberAppJobs',
    methods: ['createAppJobController'],
  },
  {
    script: './app_actions.js',
    globalName: 'FaberAppActions',
    methods: ['createAppActionsController'],
  },
  {
    script: './app_events.js',
    globalName: 'FaberAppEvents',
    methods: ['createAppEventsController'],
  },
  {
    script: './startup_preloader.js',
    globalName: 'FaberStartupPreloader',
    methods: ['createStartupPreloaderController'],
  },
  {
    script: './i18n.js',
    globalName: 'FaberI18n',
    methods: ['createI18nController'],
  },
  {
    script: './tutorial_copy.js',
    globalName: 'FaberTutorialCopy',
    methods: ['normalizeLocale', 'translate', 'translateHtml', 'translatePhrase', 'value'],
  },
  {
    script: './ui_appearance.js',
    globalName: 'FaberUiAppearance',
    methods: ['createUiAppearanceController', 'normalizeInterfaceTheme', 'normalizePanelFontScale'],
  },
  {
    script: './app_preferences.js',
    globalName: 'FaberAppPreferences',
    methods: ['createAppPreferencesController'],
  },
  {
    script: './account_gate.js',
    globalName: 'FaberAccountGate',
    methods: ['createAccountGateController', 'hasPlatformMedia', 'isSignedIn'],
  },
  {
    script: './ai_settings_support.js',
    globalName: 'FaberAiSettingsSupport',
    methods: [
      'buildComposerProviderOptionsFromSettings',
      'buildModelPresetOptions',
      'humanizeProviderName',
      'maskTail',
      'normalizeCustomProviderName',
      'normalizeDisabledBuiltInProviders',
      'normalizeInterfaceLanguage',
      'normalizeInterfaceTheme',
      'normalizeKnownProvider',
      'normalizePanelFontScale',
      'providerDocsUrl',
      'providerStatusLabel',
    ],
  },
  {
    script: './ai_settings_controller.js',
    globalName: 'FaberAiSettingsController',
    methods: ['createAiSettingsController'],
  },
  {
    script: './ai_settings_draft.js',
    globalName: 'FaberAiSettingsDraft',
    methods: [
      'buildAiSettingsApiRows',
      'createAiSettingsDraft',
      'isBuiltInProviderDisabled',
      'setBuiltInProviderDisabled',
    ],
  },
  {
    script: './ai_settings_elements.js',
    globalName: 'FaberAiSettingsElements',
    methods: ['getAiSettingsElements'],
  },
  {
    script: './ai_settings_account_panel.js',
    globalName: 'FaberAiSettingsAccountPanel',
    methods: ['createAiSettingsAccountPanel'],
  },
  {
    script: './ai_settings.js',
    globalName: 'FaberAiSettings',
    methods: [
      'buildComposerProviderOptionsFromSettings',
      'buildModelPresetOptions',
      'createAiSettingsController',
      'normalizeKnownProvider',
      'providerStatusLabel',
      'normalizeInterfaceLanguage',
      'normalizeInterfaceTheme',
      'normalizePanelFontScale',
    ],
  },
  { script: './chat_composer.js', globalName: 'FaberChatComposer', methods: ['createChatComposerController'] },
  {
    script: './composer_approval_mode.js',
    globalName: 'FaberComposerApprovalMode',
    methods: ['normalizeApprovalMode', 'createComposerApprovalModeController'],
  },
  { script: './cortex_controller.js', globalName: 'FaberCortex', methods: ['createCortexController', 'normalizeCortexTopic'] },
  { script: './inline_input_dialog.js', globalName: 'FaberInlineInputDialog', methods: ['createInlineInputDialogController'] },
  {
    script: './ux_state_model.js',
    globalName: 'FaberUxStateModel',
    methods: ['buildJobProgressPresentation', 'buildStatusPresentation', 'inferUxToneFromText', 'mapJobPhaseLabel', 'normalizeUxTone'],
  },
  { script: './job_progress.js', globalName: 'FaberJobProgress', methods: ['createJobProgressController'] },
  {
    script: './workspace_layout_preferences.js',
    globalName: 'FaberWorkspaceLayoutPreferences',
    methods: [
      'createWorkspaceLayoutPreferenceController',
      'normalizePanelSlot',
      'normalizeTerminalDock',
      'normalizeToolPlacements',
      'normalizeWorkspaceLayoutPreferences',
      'normalizeWorkspaceMode',
    ],
  },
  {
    script: './workspace_layout_builder.js',
    globalName: 'FaberWorkspaceLayoutBuilder',
    methods: [
      'buildWorkspacePreset',
      'createWorkspaceLayoutBuilder',
      'deriveControlsFromPlacements',
      'normalizeToolPlacements',
      'syncControlsFromPlacements',
    ],
  },
  {
    script: './workspace_layout_runtime.js',
    globalName: 'FaberWorkspaceLayoutRuntime',
    methods: ['createWorkspaceLayoutRuntimeController'],
  },
  { script: './panel_layout.js', globalName: 'FaberPanelLayout', methods: ['createPanelLayoutController'] },
  {
    script: './automata_contracts.js',
    globalName: 'FaberAutomataContracts',
    methods: ['createAutomataContractsController', 'statusLabel'],
  },
  {
    script: './project_tools_support.js',
    globalName: 'FaberProjectToolsSupport',
    methods: [
      'buildGitWorktreeViewModel',
      'buildTerminalPreviewCommand',
      'compactDiffLine',
      'formatGitEntryStatus',
      'formatGithubAuthGuidance',
      'formatGithubPublishPlan',
      'formatPreviewStartFailure',
      'getGithubAuthCommand',
      'inferGithubRepoNameFromProject',
    ],
  },
  {
    script: './project_tools_git.js',
    globalName: 'FaberProjectToolsGit',
    methods: ['createProjectGitTool'],
  },
  {
    script: './project_tools_github_deploy.js',
    globalName: 'FaberProjectToolsGithubDeploy',
    methods: ['createProjectGithubDeployTool'],
  },
  {
    script: './project_tools.js',
    globalName: 'FaberProjectTools',
    methods: [
      'createProjectToolsController',
      'formatGithubPublishPlan',
      'formatPreviewStartFailure',
      'inferGithubRepoNameFromProject',
    ],
  },
  {
    script: './tutorial_welcome_project.js',
    globalName: 'FaberTutorialWelcomeProject',
    methods: ['createWelcomeProjectBatches', 'normalizeWelcomeName'],
  },
  {
    script: './hover_tooltips.js',
    globalName: 'FaberHoverTooltips',
    methods: ['createHoverTooltipController', 'initHoverTooltips'],
  },
  {
    script: './project_sidebar.js',
    globalName: 'FaberProjectSidebar',
    methods: ['createProjectSidebarController', 'normalizeProjectItems'],
  },
  { script: './project_state_modal.js', globalName: 'FaberProjectStateModal', methods: ['createProjectStateModalController'] },
  { script: './project_file_editor.js', globalName: 'FaberProjectFileEditor', methods: ['createProjectFileEditorController'] },
  { script: './project_file_tree.js', globalName: 'FaberProjectFileTree', methods: ['createProjectFileTreeController'] },
  { script: './project_terminal.js', globalName: 'FaberProjectTerminal', methods: ['createProjectTerminalController'] },
  { script: './welcome_project_modal.js', globalName: 'FaberWelcomeProjectModal', methods: ['createWelcomeProjectModalController'] },
  { script: './welcome_quotes.js', globalName: 'FaberWelcomeQuotes', methods: ['applyWelcomeQuote', 'getWelcomeQuote', 'setLastAuthor'] },
];

const appScriptIndex = rendererScripts.indexOf('./app.js');
assert.ok(appScriptIndex >= 0, 'app.js must be loaded by renderer/index.html');
assert.ok(
  rendererScripts.indexOf('./app_state.js') < appScriptIndex,
  'app_state.js must load before app.js so renderer state is initialized from a module'
);
assert.ok(
  rendererScripts.indexOf('./app_formatters.js') < appScriptIndex,
  'app_formatters.js must load before app.js so pure renderer message formatting stays outside the app shell'
);
for (const script of ['./app_conversations.js', './app_projects.js', './app_jobs.js', './app_actions.js', './app_events.js']) {
  assert.ok(
    rendererScripts.indexOf(script) < appScriptIndex,
    `${script} must load before app.js so renderer shell composition can inject it`
  );
}
assert.ok(
  rendererScripts.indexOf('./app_preferences.js') < appScriptIndex,
  'app_preferences.js must load before app.js so interface preferences stay outside the app shell'
);
assert.ok(
  rendererScripts.indexOf('./startup_preloader.js') < appScriptIndex,
  'startup_preloader.js must load before app.js so boot progress is controlled outside the app shell'
);
assert.ok(
  rendererScripts.indexOf('./i18n.js') < appScriptIndex,
  'i18n.js must load before app.js so static UI copy is available during boot'
);
assert.ok(
  rendererScripts.indexOf('./tutorial_copy.js') < rendererScripts.indexOf('./progressive_disclosure.js'),
  'tutorial_copy.js must load before progressive_disclosure.js so every guided step can be localized'
);
assert.ok(
  rendererScripts.indexOf('./tutorial_welcome_project.js') < rendererScripts.indexOf('./progressive_disclosure.js'),
  'tutorial_welcome_project.js must load before progressive_disclosure.js so the generated files are deterministic'
);
assert.ok(
  rendererScripts.indexOf('./hover_tooltips.js') < rendererScripts.indexOf('./progressive_disclosure.js'),
  'hover_tooltips.js must load before progressive_disclosure.js so tutorial mode can suppress normal tooltips'
);
assert.ok(
  rendererScripts.indexOf('./ui_appearance.js') < rendererScripts.indexOf('./ai_settings.js'),
  'ui_appearance.js must load before ai_settings.js so settings can reuse appearance normalizers'
);
assert.ok(
  rendererScripts.indexOf('./ai_settings_support.js') < rendererScripts.indexOf('./ai_settings_draft.js'),
  'ai_settings_support.js must load before ai_settings_draft.js'
);
assert.ok(
  rendererScripts.indexOf('./ai_settings_draft.js') < rendererScripts.indexOf('./ai_settings_controller.js'),
  'ai_settings_draft.js must load before ai_settings_controller.js'
);
assert.ok(
  rendererScripts.indexOf('./ai_settings_elements.js') < rendererScripts.indexOf('./ai_settings_controller.js'),
  'ai_settings_elements.js must load before ai_settings_controller.js'
);
assert.ok(
  rendererScripts.indexOf('./ai_settings_account_panel.js') < rendererScripts.indexOf('./ai_settings_controller.js'),
  'ai_settings_account_panel.js must load before ai_settings_controller.js'
);
assert.ok(
  rendererScripts.indexOf('./ai_settings_controller.js') < rendererScripts.indexOf('./ai_settings.js'),
  'ai_settings_controller.js must load before the ai_settings facade'
);
assert.ok(
  rendererScripts.indexOf('./account_gate.js') < appScriptIndex,
  'account_gate.js must load before app.js so the login gate can fail closed'
);
assert.ok(
  rendererScripts.indexOf('./workspace_layout_preferences.js') < appScriptIndex,
  'workspace_layout_preferences.js must load before app.js so workspace preferences can be applied during boot'
);
assert.ok(
  rendererScripts.indexOf('./workspace_layout_preferences.js') < rendererScripts.indexOf('./workspace_layout_builder.js'),
  'workspace_layout_preferences.js must load before workspace_layout_builder.js so builder can reuse preference normalizers'
);
assert.ok(
  rendererScripts.indexOf('./workspace_layout_builder.js') < rendererScripts.indexOf('./ai_settings_controller.js'),
  'workspace_layout_builder.js must load before ai_settings_controller.js so settings only orchestrates layout editing'
);
assert.ok(
  rendererScripts.indexOf('./workspace_layout_runtime.js') < appScriptIndex,
  'workspace_layout_runtime.js must load before app.js so saved layout preferences can move real workspace regions during boot'
);
assert.ok(
  rendererScripts.indexOf('./workspace_layout_builder.js') < rendererScripts.indexOf('./workspace_layout_runtime.js'),
  'workspace_layout_runtime.js must load after workspace_layout_builder.js so workspace composition modules stay ordered'
);
assert.ok(
  rendererScripts.indexOf('./project_tools_support.js') < rendererScripts.indexOf('./project_tools_git.js'),
  'project_tools_git.js must load after project_tools_support.js so Git UI can reuse pure tool helpers'
);
assert.ok(
  rendererScripts.indexOf('./project_tools_support.js') < rendererScripts.indexOf('./project_tools_github_deploy.js'),
  'project_tools_github_deploy.js must load after project_tools_support.js so deploy UI can reuse GitHub guidance helpers'
);
assert.ok(
  rendererScripts.indexOf('./project_tools_github_deploy.js') < rendererScripts.indexOf('./project_tools_git.js'),
  'project_tools_git.js must load after project_tools_github_deploy.js so the Git renderer can compose Deploy separately'
);
assert.ok(
  rendererScripts.indexOf('./project_tools_git.js') < rendererScripts.indexOf('./project_tools.js'),
  'project_tools.js must load after project_tools_git.js so the tools controller can compose the Git renderer'
);

for (const moduleDef of expectedModules) {
  const scriptIndex = rendererScripts.indexOf(moduleDef.script);
  assert.ok(scriptIndex >= 0, `${moduleDef.script} must be loaded by renderer/index.html`);
  assert.ok(scriptIndex < appScriptIndex, `${moduleDef.script} must load before app.js`);
  assert.ok(fs.existsSync(path.join(rendererDir, moduleDef.script.replace('./', ''))), `${moduleDef.script} must exist`);

  const source = fs.readFileSync(path.join(rendererDir, moduleDef.script.replace('./', '')), 'utf8');
  assert.match(source, new RegExp(`window\\.${moduleDef.globalName}\\s*=`), `${moduleDef.globalName} must be registered on window`);

  for (const method of moduleDef.methods) {
    assert.ok(source.includes(method), `${moduleDef.globalName}.${method} must be exported by ${moduleDef.script}`);
  }
}

assert.ok(appSource.includes('REQUIRED_RENDERER_MODULES'), 'app.js must declare required renderer modules');
assert.ok(
  appSource.includes('window.FaberBootstrapGuard.requireRendererModules(REQUIRED_RENDERER_MODULES)'),
  'app.js must enforce the renderer module contract during boot'
);
assert.ok(mainSource.includes('acceptFirstMouse: true'), 'macOS window must accept the first project action click');
assert.ok(appSource.includes('closeApis:'), 'tutorial actions must expose a non-persistent API modal close');
assert.ok(
  progressiveSource.includes("targets: ['#ai-settings-cancel']"),
  'API tutorial must discard its draft instead of persisting the fake provider'
);
assert.ok(
  !progressiveSource.includes("targets: ['#cortex-modal-close', '#cortex-modal-backdrop']"),
  'Cortex tutorial must never raise the full backdrop above the dialog'
);
assert.ok(
  progressiveSource.includes('disableSpotlight: true'),
  'Cortex close step must avoid the full-screen spotlight'
);
assert.ok(mapCanvasSource.includes('function focusNodes('), 'application map must support deterministic node framing');
assert.ok(
  applicationMapSource.includes('let setMapSidePanelMode = () => {};'),
  'map side-panel reset must remain available outside init() when a selected project is deleted'
);
assert.ok(
  progressiveSource.includes('canvas.focusNodes([tutorialWelcomeNodeId, tutorialDesignSystemNodeId]'),
  'map tutorial must frame both Markdown nodes automatically'
);
assert.ok(
  progressiveSource.includes('refreshSidebarTutorialGuide();'),
  'sidebar tutorial must refresh its guide immediately after moving the demo project'
);
assert.ok(
  progressiveSource.includes('disableHighlight: () => !hasTutorialReadyProject()'),
  'new-project tutorial target must use only the spotlight contour'
);
assert.ok(
  progressiveSource.includes('tutorialMapBuildStage = `architecture-${kind}-edit`;')
    && progressiveSource.includes("'architecture-content-review': 'development-ready'")
    && progressiveSource.includes('focusTutorialMapNodeForEditing(nodeId);'),
  'each architecture Markdown must be opened for review before the map becomes ready'
);
assert.ok(
  progressiveSource.includes('function startElementCursorTracking(')
    && progressiveSource.includes('trackTarget: true')
    && progressiveSource.includes("elements.tutorialCursor.style.transitionDuration = '0ms';"),
  'map tutorial cursor must remain attached to its target while the canvas moves'
);
assert.ok(
  progressiveSource.includes('if (tutorialMapCreationPending)')
    && progressiveSource.includes("'map-intro', 'map-build'")
    && progressiveSource.includes('scheduleAutoAdvance(step.id, 240);')
    && progressiveSource.includes(": translate('next')"),
  'map tutorial must advance automatically after map build and present the support action as Next'
);
assert.ok(
  progressiveSource.includes('function prepareMapIntroForAdvance()')
    && progressiveSource.includes('elements.tutorialNext.disabled = false;')
    && progressiveSource.includes("if (step && step.id === 'map-intro' && !step.canAdvance())")
    && progressiveSource.includes("if (step.id === 'map-build' && !tutorialUserName)")
    && progressiveSource.includes('closeTutorialContextForAdvance();')
    && !progressiveSource.includes('if (step && !step.canAdvance()) return;'),
  'Next must navigate every tutorial step while keeping the user name as the only required input'
);
assert.ok(
  progressiveSource.includes('const RIGHT_PANEL_TOOL_GUIDES = RIGHT_PANEL_TOOL_SELECTORS.map')
    && progressiveSource.includes("tutorialValue('rightTools', [])")
    && progressiveSource.includes("tutorialMapChatStage = 'expand-right'"),
  'map chat tutorial must expand and introduce the right-panel tools before opening chat'
);
assert.ok(
  progressiveSource.includes("tutorialText('documents.gap.title'")
    && progressiveSource.includes("targets: ['#btn-map-chat-add-gap']")
    && progressiveSource.includes("tutorialMapChatStage = 'adjustment-complete'")
    && progressiveSource.includes("step.id === 'map-chat' && tutorialMapChatStage === 'adjustment-complete'"),
  'simulated map chat must guide a contextual action, apply the missing-information node, and advance'
);
assert.ok(
  applicationMapSource.includes('prepareTutorialMapHistory: () => (')
    && applicationMapSource.includes('generateTutorialRenderDraft: () => (')
    && applicationMapSource.includes("addGapButton.id = 'btn-map-chat-add-gap'"),
  'map tutorial must persist history and expose its local render workflow'
);
assert.ok(
  tutorialRenderStart >= 0
    && tutorialRenderEnd > tutorialRenderStart
    && !tutorialRenderSource.includes('sendAssistantMessage'),
  'tutorial render workflow must never call an AI provider'
);
assert.ok(
  progressiveSource.includes("targets: ['#btn-map-render-save']")
    && progressiveSource.includes("targets: ['#btn-project-milestones']")
    && progressiveSource.includes("targets: ['.milestone-item:first-child .milestone-card']")
    && progressiveSource.includes('const target = getTutorialCreatedProjectConversationSelector();')
    && progressiveSource.includes("tutorialMapAnalysisStage = 'project-chat'"),
  'tutorial must guide saving, opening milestones, reviewing Milestone 1, and using the project conversation action'
);
assert.ok(
  progressiveSource.includes("tutorialText('development.prompt')")
    && progressiveSource.includes("id: 'development-chat'")
    && progressiveSource.includes('actions.simulateTutorialDevelopmentConversation'),
  'development tutorial must compose and emulate the requested Milestone 1 conversation'
);
assert.ok(
  tutorialDevelopmentStart >= 0
    && tutorialDevelopmentEnd > tutorialDevelopmentStart
    && !tutorialDevelopmentSource.includes('sendAssistantMessage'),
  'tutorial development conversation must never call an AI provider'
);
assert.ok(
  appSource.includes('simulateTutorialDevelopmentBatch')
    && appSource.includes("new CustomEvent('faber:tutorial-files-written'")
    && progressiveSource.includes("window.addEventListener('faber:tutorial-git-action'")
    && progressiveSource.includes("window.addEventListener('faber:project-preview-started'")
    && progressiveSource.includes('.project-tree-row.file.has-diff'),
  'tutorial must create files locally, react to real Git actions, review a diff, and finish through a real preview'
);
assert.ok(
  !milestonesSource.includes('milestone-development-chat-btn')
    && !appSource.includes('onOpenDevelopmentChat:')
    && appSource.includes('revealProjectConversationButton:')
    && projectSidebarSource.includes("new CustomEvent('faber:project-conversation-prepared'")
    && progressiveSource.includes("window.addEventListener('faber:project-conversation-prepared'"),
  'tutorial must use the existing project + action without adding controls to normal milestones'
);
assert.ok(
  progressiveSource.includes("tutorialMapAnalysisStage = 'history-loading'")
    && progressiveSource.includes('tutorialMapHistoryPreparing = true;')
    && progressiveSource.includes('hideLabel: true')
    && progressiveSource.includes('disableSpotlight: true'),
  'tutorial cursor must wait for async panels and avoid stacked labels or contours on real controls'
);

const appearanceSource = fs.readFileSync(path.join(rendererDir, 'ui_appearance.js'), 'utf8');
for (const iconName of lightThemeIcons) {
  assert.ok(
    fs.existsSync(path.join(rendererDir, 'assets', 'icons', iconName)),
    `light theme icon ${iconName} must exist`
  );
  assert.ok(appearanceSource.includes(`./assets/icons/${iconName}`), `ui_appearance.js must reference ${iconName}`);
}

for (const moduleDef of expectedModules.filter((moduleDef) =>
  moduleDef.globalName !== 'FaberBootstrapGuard' &&
  moduleDef.globalName !== 'FaberAiSettingsSupport' &&
  moduleDef.globalName !== 'FaberAiSettingsDraft' &&
  moduleDef.globalName !== 'FaberAiSettingsElements' &&
  moduleDef.globalName !== 'FaberAiSettingsAccountPanel' &&
  moduleDef.globalName !== 'FaberAiSettingsController' &&
  moduleDef.globalName !== 'FaberHoverTooltips'
)) {
  assert.ok(appSource.includes(`globalName: '${moduleDef.globalName}'`), `${moduleDef.globalName} must be required by app.js`);
}

console.log('renderer-module-contract.test.js: ok');
