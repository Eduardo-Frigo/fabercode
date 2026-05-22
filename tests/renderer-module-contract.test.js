const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const rendererDir = path.join(rootDir, 'renderer');
const indexHtml = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');

const rendererScripts = [...indexHtml.matchAll(/<script\s+src="(\.\/[^"]+\.js)"><\/script>/g)].map(
  (match) => match[1]
);
const lightThemeIcons = [
  'brain-light.svg',
  'archive-light.svg',
  'bin-light.svg',
  'settings-light.svg',
];

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
  { script: './cortex_controller.js', globalName: 'FaberCortex', methods: ['createCortexController', 'normalizeCortexTopic'] },
  { script: './inline_input_dialog.js', globalName: 'FaberInlineInputDialog', methods: ['createInlineInputDialogController'] },
  { script: './job_progress.js', globalName: 'FaberJobProgress', methods: ['createJobProgressController'] },
  { script: './panel_layout.js', globalName: 'FaberPanelLayout', methods: ['createPanelLayoutController'] },
  {
    script: './automata_contracts.js',
    globalName: 'FaberAutomataContracts',
    methods: ['createAutomataContractsController', 'statusLabel'],
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
    script: './project_sidebar.js',
    globalName: 'FaberProjectSidebar',
    methods: ['createProjectSidebarController', 'normalizeProjectItems'],
  },
  { script: './project_state_modal.js', globalName: 'FaberProjectStateModal', methods: ['createProjectStateModalController'] },
  { script: './project_file_editor.js', globalName: 'FaberProjectFileEditor', methods: ['createProjectFileEditorController'] },
  { script: './project_file_tree.js', globalName: 'FaberProjectFileTree', methods: ['createProjectFileTreeController'] },
  { script: './project_terminal.js', globalName: 'FaberProjectTerminal', methods: ['createProjectTerminalController'] },
  { script: './welcome_project_modal.js', globalName: 'FaberWelcomeProjectModal', methods: ['createWelcomeProjectModalController'] },
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
  moduleDef.globalName !== 'FaberAiSettingsController'
)) {
  assert.ok(appSource.includes(`globalName: '${moduleDef.globalName}'`), `${moduleDef.globalName} must be required by app.js`);
}

console.log('renderer-module-contract.test.js: ok');
