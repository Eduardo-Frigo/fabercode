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
  'ai_settings_controller.js',
  'ai_settings.js',
].map((fileName) => ({
  fileName,
  source: fs.readFileSync(path.join(rendererDir, fileName), 'utf8'),
}));
const sandbox = { window: {} };
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

console.log('renderer-ai-settings.test.js: ok');
