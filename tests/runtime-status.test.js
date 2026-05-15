const assert = require('assert');

const { createAiRuntimeStatusService } = require('../cortex/providers/runtime_status');

function maskApiKeyTail(value, visibleTail = 4) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= visibleTail) return '*'.repeat(text.length);
  return '*'.repeat(Math.max(0, text.length - visibleTail)) + text.slice(-visibleTail);
}

function extractJsonFromMixedText(value) {
  const text = String(value || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return JSON.parse(text.slice(start, end + 1));
}

function createService(overrides = {}) {
  const state = {
    selectedProvider: 'mock',
    settings: {
      geminiApiKey: '',
      geminiApiLabel: '',
      sambanovaApiKey: '',
      sambanovaApiLabel: '',
    },
    ...overrides.state,
  };

  const service = createAiRuntimeStatusService({
    AI_PROVIDER_OPTIONS: ['mock', 'rwkv', 'gemini', 'sambanova'],
    CORTEX_RAG_ENABLED: true,
    CORTEX_RAG_PROVIDER: 'r2r',
    CORTEX_RENDER_RUNTIME_VERSION: 'runtime.v1',
    GEMINI_API_KEY: '',
    LOADED_ENV_PATHS: ['/tmp/.env'],
    MEMPALACE_PYTHON_BIN: 'python3',
    PERSONA_MODEL_BRAIN: 'rwkv-local',
    R2R_BASE_URL: 'http://127.0.0.1:7272',
    R2R_SEARCH_LIMIT: 6,
    R2R_TIMEOUT_MS: 12000,
    RWKV_CUDA_ON: '0',
    RWKV_ENABLED: true,
    RWKV_JIT_ON: '0',
    RWKV_MODEL_PATH: '/models/rwkv',
    RWKV_PROVIDER_SCRIPT: '/provider.py',
    RWKV_STRATEGY: 'cpu fp16',
    RWKV_TOKENIZER_PATH: '/models/tokenizer.json',
    RWKV_V7_ON: '0',
    SAMBANOVA_API_BASE_URL: 'https://api.sambanova.ai/v1',
    SAMBANOVA_API_KEY: '',
    extractJsonFromMixedText,
    getCortexRuntimeBudget: async () => ({ profile: 'rapido', maxActiveModels: 1 }),
    getEffectiveGeminiApiKey: () => state.settings.geminiApiKey || '',
    getEffectiveGeminiModel: () => 'gemini-default',
    getEffectiveSambaNovaApiKey: () => state.settings.sambanovaApiKey || '',
    getEffectiveSambaNovaModel: () => 'samba-default',
    getRuntimeProfileSettings: () => ({ profile: 'rapido' }),
    getSelectedAiProvider: () => state.selectedProvider,
    getSelectedCustomApiProfile: () => state.customProfile || null,
    maskApiKeyTail,
    os: { totalmem: () => 8 * 1024 * 1024 * 1024 },
    readAiRuntimeSettings: () => state.settings,
    resolveCustomApiEndpoint: (profile) => profile.website || '',
    resolveCustomProviderKind: (providerName) => {
      const value = String(providerName || '').toLowerCase();
      if (value.includes('gemini')) return 'gemini';
      if (value.includes('samba')) return 'sambanova';
      return 'custom';
    },
    runCommand: async () => ({
      ok: true,
      stdout: 'log {"ok": true, "model_exists": true, "tokenizer_exists": false, "env": {"RWKV": "test"}}',
    }),
    ...overrides.dependencies,
  });

  return { service, state };
}

async function run() {
  const mock = createService({ state: { selectedProvider: 'mock' } });
  const mockStatus = await mock.service.getStatus();
  assert.strictEqual(mockStatus.ready, true);
  assert.strictEqual(mockStatus.strategy, 'deterministic-mock');
  assert.deepStrictEqual(mockStatus.envPathsLoaded, ['/tmp/.env']);

  const gemini = createService({ state: { selectedProvider: 'gemini' } });
  const geminiStatus = await gemini.service.getStatus();
  assert.strictEqual(geminiStatus.ready, false);
  assert.strictEqual(geminiStatus.reason, 'gemini_api_key_missing');
  assert.strictEqual(geminiStatus.gemini.keySource, 'none');

  const custom = createService({
    state: {
      selectedProvider: 'custom:deep',
      customProfile: {
        id: 'deep',
        providerName: 'Custom HTTP',
        apiKey: 'custom-secret-9999',
        model: 'deepseek-chat',
        apiLabel: 'DeepSeek',
        website: 'https://api.example.test/v1/chat/completions',
      },
    },
  });
  const customStatus = await custom.service.getStatus();
  assert.strictEqual(customStatus.ready, true);
  assert.strictEqual(customStatus.configuredModel, 'deepseek-chat');
  assert.strictEqual(customStatus.customProvider.keyMasked, '**************9999');

  const rwkv = createService({ state: { selectedProvider: 'rwkv' } });
  const rwkvStatus = await rwkv.service.getStatus();
  assert.strictEqual(rwkvStatus.reachable, true);
  assert.strictEqual(rwkvStatus.ready, false);
  assert.strictEqual(rwkvStatus.reason, 'rwkv_tokenizer_missing');
  assert.strictEqual(rwkvStatus.rwkv.modelExists, true);

  console.log('runtime-status.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
