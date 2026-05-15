const assert = require('assert');

const { registerAiHandlers } = require('../main/ipc/ai_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

function normalizeAiProviderName(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) return 'rwkv';
  if (normalized.startsWith('custom:')) return normalized;
  if (normalized === 'gemini' || normalized === 'google' || normalized.includes('gemini')) return 'gemini';
  if (normalized === 'sambanova' || normalized.replace(/\s+/g, '') === 'sambanova' || normalized.includes('samba')) return 'sambanova';
  if (normalized === 'mock' || normalized.includes('mock')) return 'mock';
  if (normalized === 'rwkv' || normalized.includes('rwkv') || normalized === 'local') return 'rwkv';
  return 'rwkv';
}

function sanitizeModelName(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  return value.replace(/\s+/g, '');
}

function maskApiKeyTail(value, visibleTail = 4) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= visibleTail) return '*'.repeat(text.length);
  return '*'.repeat(Math.max(0, text.length - visibleTail)) + text.slice(-visibleTail);
}

function sanitizeCustomApiProfiles(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list
    .map((entry, idx) => {
      const item = entry && typeof entry === 'object' ? entry : {};
      const providerName = String(item.providerName || item.provider || '').trim();
      const idBase = String(item.id || '').trim() || `${providerName || 'api'}-${idx + 1}`;
      return {
        id: idBase.replace(/\s+/g, '-').toLowerCase(),
        providerName,
        apiKey: String(item.apiKey || '').trim(),
        model: String(item.model || '').trim(),
        apiLabel: String(item.apiLabel || '').trim(),
        website: String(item.website || '').trim(),
      };
    })
    .filter((item) => item.providerName || item.apiKey || item.model || item.apiLabel || item.website);
}

async function run() {
  let settings = {
    selectedProvider: 'rwkv',
    interfaceLanguage: 'pt-BR',
    geminiApiKey: '',
    geminiModel: '',
    geminiApiLabel: '',
    sambanovaApiKey: '',
    sambanovaModel: '',
    sambanovaApiLabel: '',
    disabledBuiltInProviders: [],
    customApis: [
      {
        id: 'openai-main',
        providerName: 'OpenAI compatible',
        apiKey: 'custom-secret-1234',
        model: 'model-a',
        apiLabel: 'Custom',
        website: 'https://api.example.test/v1/chat/completions',
      },
    ],
  };
  const audit = [];
  const { handlers, registerIpcHandler } = createHandlerMap();

  const deps = {
    AI_PROVIDER_ENV: 'rwkv',
    AI_PROVIDER_OPTIONS: ['mock', 'rwkv', 'gemini', 'sambanova'],
    GEMINI_API_KEY: 'env-gemini-9999',
    SAMBANOVA_API_BASE_URL: 'https://api.sambanova.ai/v1',
    SAMBANOVA_API_KEY: '',
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    getAiRuntimeStatus: async () => ({ ok: true, provider: settings.selectedProvider, ready: true }),
    getEffectiveGeminiApiKey: () => settings.geminiApiKey || 'env-gemini-9999',
    getEffectiveGeminiModel: () => settings.geminiModel || 'gemini-default',
    getEffectiveSambaNovaApiKey: () => settings.sambanovaApiKey || '',
    getEffectiveSambaNovaModel: () => settings.sambanovaModel || 'samba-default',
    maskApiKeyTail,
    normalizeAiProviderName,
    readAiRuntimeSettings: () => ({ ...settings, customApis: sanitizeCustomApiProfiles(settings.customApis) }),
    registerIpcHandler,
    sanitizeCustomApiProfiles,
    sanitizeGeminiModelName: sanitizeModelName,
    sanitizeSambaNovaModelName: sanitizeModelName,
    setSelectedAiProvider: (provider) => {
      settings = { ...settings, selectedProvider: normalizeAiProviderName(provider) };
      return settings;
    },
    writeAiRuntimeSettings: (next) => {
      settings = {
        ...settings,
        ...next,
        selectedProvider: normalizeAiProviderName(next.selectedProvider || settings.selectedProvider),
        customApis: Object.prototype.hasOwnProperty.call(next, 'customApis')
          ? sanitizeCustomApiProfiles(next.customApis)
          : settings.customApis,
      };
      return settings;
    },
  };

  registerAiHandlers(deps);

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'ai:provider:get',
    'ai:provider:set',
    'ai:settings:get',
    'ai:settings:save',
    'ai:status',
  ]);

  const initialSettings = await handlers['ai:settings:get']();
  assert.strictEqual(initialSettings.ok, true);
  assert.strictEqual(initialSettings.provider, 'rwkv');
  assert.strictEqual(initialSettings.interfaceLanguage, 'pt-BR');
  assert.strictEqual(initialSettings.gemini.keySource, 'env');
  assert.deepStrictEqual(initialSettings.disabledBuiltInProviders, []);
  assert.strictEqual(initialSettings.customApis[0].hasKey, true);
  assert.strictEqual(initialSettings.customApis[0].keyMasked, '**************1234');

  const saved = await handlers['ai:settings:save'](null, {
    provider: 'google',
    interfaceLanguage: 'es-ES',
    geminiApiKey: 'local-gemini-0000',
    geminiModel: ' gemini model ',
    geminiApiLabel: ' Local Gemini ',
    sambanovaModel: ' samba model ',
    disabledBuiltInProviders: ['sambanova'],
    customApis: [{ providerName: 'DeepSeek', apiKey: 'deepseek-secret-8888', model: 'deepseek-chat' }],
  });

  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.provider, 'gemini');
  assert.strictEqual(saved.interfaceLanguage, 'es-ES');
  assert.strictEqual(saved.gemini.keySource, 'settings');
  assert.strictEqual(saved.gemini.model, 'geminimodel');
  assert.strictEqual(saved.sambanova.model, 'sambamodel');
  assert.deepStrictEqual(saved.disabledBuiltInProviders, ['sambanova']);
  assert.strictEqual(saved.customApis[0].id, 'deepseek-1');
  assert.strictEqual(saved.customApis[0].hasKey, true);
  assert.ok(audit.some((event) => event.type === 'ai.settings_saved' && event.payload.customApisCount === 1));
  assert.ok(audit.some((event) => event.type === 'ai.settings_saved' && event.payload.interfaceLanguage === 'es-ES'));

  const providerGet = await handlers['ai:provider:get']();
  assert.strictEqual(providerGet.provider, 'gemini');
  assert.strictEqual(providerGet.hasGeminiApiKey, true);

  const providerSet = await handlers['ai:provider:set'](null, { provider: 'Samba Nova' });
  assert.strictEqual(providerSet.ok, true);
  assert.strictEqual(providerSet.provider, 'sambanova');
  assert.ok(audit.some((event) => event.type === 'ai.provider_set' && event.payload.provider === 'sambanova'));

  const status = await handlers['ai:status']();
  assert.deepStrictEqual(status, { ok: true, provider: 'sambanova', ready: true });

  console.log('ai-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
