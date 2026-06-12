const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rendererDir = path.join(__dirname, '..', 'renderer');
const sources = [
  'ai_settings_support.js',
  'ai_settings_draft.js',
  'ai_settings_elements.js',
  'ai_settings_account_panel.js',
  'ai_settings_mcp_panel.js',
  'ai_settings_controller.js',
  'ai_settings.js',
].map((fileName) => ({
  fileName,
  source: fs.readFileSync(path.join(rendererDir, fileName), 'utf8'),
}));
class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this._textContent = '';
    this.title = '';
    this.classList = { add: () => {}, remove: () => {} };
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(_name, handler) {
    this.handler = handler;
  }

  get textContent() {
    return [this._textContent, ...this.children.map((child) => child.textContent || '')].join('');
  }

  set textContent(value) {
    this._textContent = String(value || '');
    this.children = [];
  }

  set innerHTML(value) {
    this.textContent = value;
  }
}

const sandbox = {
  document: {
    createElement: (tagName) => new FakeElement(tagName),
  },
  window: {},
};
sandbox.window.window = sandbox.window;

for (const item of sources) {
  vm.runInNewContext(item.source, sandbox, { filename: item.fileName });
}

const settings = sandbox.window.FaberAiSettings;
assert.ok(settings, 'FaberAiSettings should be registered');

assert.strictEqual(settings.normalizeKnownProvider('OpenAI'), 'openai');
assert.strictEqual(settings.normalizeKnownProvider('oai'), 'openai');
assert.strictEqual(settings.providerStatusLabel('openai'), 'OpenAI API');

const providerOptions = settings.buildComposerProviderOptionsFromSettings({
  disabledBuiltInProviders: [],
  customApis: [],
});
assert.ok(providerOptions.some((entry) => entry.value === 'openai' && entry.label === 'OpenAI API'));

const disabledOptions = settings.buildComposerProviderOptionsFromSettings({
  disabledBuiltInProviders: ['openai'],
  customApis: [],
});
assert.ok(!disabledOptions.some((entry) => entry.value === 'openai'));

const customOpenAiOptions = settings.buildComposerProviderOptionsFromSettings({
  disabledBuiltInProviders: ['openai'],
  customApis: [
    {
      id: 'openai-staging',
      providerName: 'OpenAI',
      apiLabel: 'Staging',
      model: 'gpt-test',
      hasKey: true,
      website: '',
    },
  ],
});
assert.ok(customOpenAiOptions.some((entry) => entry.value === 'custom:openai-staging'));

const openAiModelOptions = settings.buildModelPresetOptions('openai');
assert.strictEqual(openAiModelOptions[1].value, 'gpt-5-codex');
assert.ok(openAiModelOptions.some((entry) => entry.value === 'gpt-5.4-mini'));

const customCurrentModelOptions = settings.buildModelPresetOptions('openai', 'custom-code-model');
assert.ok(customCurrentModelOptions.some((entry) => entry.value === 'custom-code-model'));

(async () => {
  const elements = {
    mcpStatus: new FakeElement(),
    mcpPresetSelect: new FakeElement('select'),
    mcpPresetApply: new FakeElement('button'),
    mcpList: new FakeElement(),
    mcpId: new FakeElement('input'),
    mcpName: new FakeElement('input'),
    mcpTransport: new FakeElement('select'),
    mcpCommand: new FakeElement('input'),
    mcpEndpoint: new FakeElement('input'),
    mcpTimeout: new FakeElement('input'),
    mcpAllowed: new FakeElement('input'),
    mcpBlocked: new FakeElement('input'),
    mcpPermissions: new FakeElement('input'),
    mcpBlockedRisks: new FakeElement('input'),
    mcpMaxRisk: new FakeElement('select'),
    mcpAllowedDirectories: new FakeElement('input'),
    mcpBlockedDirectories: new FakeElement('input'),
    mcpAllowedNetworkHosts: new FakeElement('input'),
    mcpBlockedNetworkHosts: new FakeElement('input'),
    mcpEnv: new FakeElement('textarea'),
    mcpHeaders: new FakeElement('textarea'),
    mcpEnabled: new FakeElement('input'),
    mcpApproved: new FakeElement('input'),
    mcpHighRiskAllow: new FakeElement('input'),
    mcpInjectSession: new FakeElement('input'),
    mcpAllowExternalNetwork: new FakeElement('input'),
    mcpNew: new FakeElement('button'),
    mcpSave: new FakeElement('button'),
  };
  const panel = sandbox.window.FaberAiSettingsMcpPanel.createAiSettingsMcpPanel({
    api: {
      listExternalMcpPresets: async () => ({
        ok: true,
        presets: [{ id: 'deepwiki-public', name: 'DeepWiki Public MCP', description: 'docs', requiresSecrets: false }],
      }),
      listExternalMcpServers: async () => ({ ok: true, servers: [] }),
      applyExternalMcpPreset: async () => ({
        ok: true,
        server: {
          id: 'deepwiki-public',
          name: 'DeepWiki Public MCP',
          transport: 'http',
          endpoint: 'https://mcp.deepwiki.com/mcp',
          trust: 'untrusted',
          riskPolicy: { maxRiskLevel: 'medium' },
          scopePolicy: { allowedNetworkHosts: ['mcp.deepwiki.com'], allowExternalNetwork: true },
        },
      }),
    },
    elements,
  });
  panel.bindEvents();
  await panel.refresh();
  assert.match(elements.mcpPresetSelect.textContent, /DeepWiki Public MCP/);
  elements.mcpPresetSelect.value = 'deepwiki-public';
  await elements.mcpPresetApply.handler();
  assert.strictEqual(elements.mcpName.value, 'DeepWiki Public MCP');
  assert.strictEqual(elements.mcpEndpoint.value, 'https://mcp.deepwiki.com/mcp');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

console.log('renderer-ai-settings.test.js: ok');
