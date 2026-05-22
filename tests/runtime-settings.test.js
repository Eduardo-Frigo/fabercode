const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createAiRuntimeSettingsService,
  normalizeAiProviderName,
  sanitizeInterfaceLanguage,
  sanitizeOpenAiModelName,
  sanitizeInterfaceTheme,
  sanitizePanelFontScale,
} = require('../cortex/providers/runtime_settings');

function createSecretHarness() {
  return {
    protectSecret: (value) => {
      const text = String(value || '').trim();
      return text ? `locked:${text}` : '';
    },
    unprotectSecret: (value) => String(value || '').replace(/^locked:/, ''),
  };
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-runtime-settings-'));
  try {
    const secrets = createSecretHarness();
    const service = createAiRuntimeSettingsService({
      aiProviderEnv: 'mock',
      fs,
      geminiApiKey: 'env-gemini',
      geminiModelBrain: 'gemini-default',
      getUserDataPath: () => tempRoot,
      openaiApiKey: 'env-openai',
      openaiModelBrain: 'openai-default',
      path,
      pexelsApiKey: 'env-pexels',
      protectSecret: secrets.protectSecret,
      sambanovaApiKey: 'env-samba',
      sambanovaModelBrain: 'samba-default',
      unprotectSecret: secrets.unprotectSecret,
    });

    assert.strictEqual(normalizeAiProviderName('Google Gemini'), 'gemini');
    assert.strictEqual(normalizeAiProviderName('OpenAI'), 'openai');
    assert.strictEqual(normalizeAiProviderName('Samba Nova'), 'sambanova');
    assert.strictEqual(normalizeAiProviderName('custom:deepseek'), 'custom:deepseek');
    assert.strictEqual(sanitizeInterfaceLanguage('es-ES'), 'es-ES');
    assert.strictEqual(sanitizeInterfaceLanguage('fr-FR'), 'pt-BR');
    assert.strictEqual(sanitizeInterfaceTheme('light'), 'light');
    assert.strictEqual(sanitizeInterfaceTheme('solarized'), 'dark');
    assert.strictEqual(sanitizePanelFontScale(117), 115);
    assert.strictEqual(sanitizePanelFontScale(180), 120);
    assert.strictEqual(sanitizeOpenAiModelName(' gpt-5.3-codex '), 'gpt-5-codex');

    const initial = service.readSettings();
    assert.strictEqual(initial.selectedProvider, 'mock');
    assert.strictEqual(initial.interfaceLanguage, 'pt-BR');
    assert.strictEqual(initial.interfaceTheme, 'dark');
    assert.strictEqual(initial.panelFontScale, 100);
    assert.strictEqual(service.getEffectiveGeminiApiKey(), 'env-gemini');
    assert.strictEqual(service.getEffectiveGeminiModel(), 'gemini-default');
    assert.strictEqual(service.getEffectiveOpenAiApiKey(), 'env-openai');
    assert.strictEqual(service.getEffectiveOpenAiModel(), 'openai-default');
    assert.strictEqual(service.getEffectivePexelsApiKey(), 'env-pexels');

    const saved = service.writeSettings({
      selectedProvider: 'openai',
      openaiApiKey: 'local-openai',
      openaiModel: ' gpt model ',
      openaiApiLabel: ' Workbench ',
      pexelsApiKey: 'local-pexels',
      geminiApiKey: 'local-gemini',
      geminiModel: ' gemini model ',
      interfaceLanguage: 'en-US',
      interfaceTheme: 'light',
      panelFontScale: 113,
      sambanovaApiKey: 'local-samba',
      customApis: [
        {
          id: 'deepseek-main',
          providerName: 'DeepSeek',
          apiKey: 'custom-secret',
          model: 'deepseek-chat',
        },
      ],
    });

    assert.strictEqual(saved.selectedProvider, 'openai');
    assert.strictEqual(saved.interfaceLanguage, 'en-US');
    assert.strictEqual(saved.interfaceTheme, 'light');
    assert.strictEqual(saved.panelFontScale, 115);
    assert.strictEqual(service.getEffectiveGeminiApiKey(), 'local-gemini');
    assert.strictEqual(service.getEffectiveGeminiModel(), 'geminimodel');
    assert.strictEqual(service.getEffectiveOpenAiApiKey(), 'local-openai');
    assert.strictEqual(service.getEffectiveOpenAiModel(), 'gptmodel');
    assert.strictEqual(service.getEffectivePexelsApiKey(), 'local-pexels');
    assert.strictEqual(service.getEffectiveSambaNovaApiKey(), 'local-samba');

    service.writeSettings({
      openaiModel: 'gpt-5.3-codex',
    });
    assert.strictEqual(service.getEffectiveOpenAiModel(), 'gpt-5-codex');

    const storePath = path.join(tempRoot, 'ai-runtime-settings.json');
    const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.strictEqual(stored.interfaceLanguage, 'en-US');
    assert.strictEqual(stored.interfaceTheme, 'light');
    assert.strictEqual(stored.panelFontScale, 115);
    assert.strictEqual(stored.openaiApiKey, 'locked:local-openai');
    assert.strictEqual(stored.pexelsApiKey, 'locked:local-pexels');
    assert.strictEqual(stored.geminiApiKey, 'locked:local-gemini');
    assert.strictEqual(stored.sambanovaApiKey, 'locked:local-samba');
    assert.strictEqual(stored.customApis[0].apiKey, 'locked:custom-secret');

    service.writeSettings({
      customApis: [
        {
          id: 'deepseek-main',
          providerName: 'DeepSeek',
          apiKey: '',
          model: 'deepseek-coder',
        },
      ],
    });

    const customApis = service.listCustomApiProfiles();
    assert.strictEqual(customApis.length, 1);
    assert.strictEqual(customApis[0].apiKey, 'custom-secret');
    assert.strictEqual(customApis[0].model, 'deepseek-coder');

    const customSelected = service.writeSettings({
      selectedProvider: 'custom:deepseek-main',
    });
    assert.strictEqual(customSelected.selectedProvider, 'custom:deepseek-main');

    const customRemoved = service.writeSettings({
      selectedProvider: 'custom:deepseek-main',
      customApis: [],
    });
    assert.strictEqual(customRemoved.selectedProvider, 'mock');
    assert.strictEqual(customRemoved.customApis.length, 0);

    const selected = service.setSelectedProvider('local');
    assert.strictEqual(selected.selectedProvider, 'rwkv');

    const disabledGemini = service.writeSettings({
      selectedProvider: 'gemini',
      disabledBuiltInProviders: ['gemini'],
    });
    assert.strictEqual(disabledGemini.selectedProvider, 'mock');
    assert.deepStrictEqual(disabledGemini.disabledBuiltInProviders, ['gemini']);

    const reenabledGemini = service.writeSettings({
      selectedProvider: 'gemini',
      disabledBuiltInProviders: [],
    });
    assert.strictEqual(reenabledGemini.selectedProvider, 'gemini');
    assert.deepStrictEqual(reenabledGemini.disabledBuiltInProviders, []);

    const disabledOpenAi = service.writeSettings({
      selectedProvider: 'openai',
      disabledBuiltInProviders: ['openai'],
    });
    assert.strictEqual(disabledOpenAi.selectedProvider, 'mock');
    assert.deepStrictEqual(disabledOpenAi.disabledBuiltInProviders, ['openai']);

    const openAiDefaultService = createAiRuntimeSettingsService({
      aiProviderEnv: 'openai',
      fs,
      getUserDataPath: () => path.join(tempRoot, 'openai-default'),
      openaiApiKey: 'env-openai',
      openaiModelBrain: 'openai-default',
      path,
      protectSecret: secrets.protectSecret,
      unprotectSecret: secrets.unprotectSecret,
    });
    const disabledDefaultOpenAi = openAiDefaultService.writeSettings({
      selectedProvider: 'openai',
      disabledBuiltInProviders: ['openai'],
    });
    assert.strictEqual(disabledDefaultOpenAi.selectedProvider, 'rwkv');

    console.log('runtime-settings.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
