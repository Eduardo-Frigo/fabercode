function createAiRuntimeStatusService(dependencies = {}) {
  const {
    AI_PROVIDER_OPTIONS,
    CORTEX_RAG_ENABLED,
    CORTEX_RAG_PROVIDER,
    CORTEX_RENDER_RUNTIME_VERSION,
    GEMINI_API_KEY = '',
    LOADED_ENV_PATHS = [],
    MEMPALACE_PYTHON_BIN,
    PERSONA_MODEL_BRAIN,
    R2R_BASE_URL,
    R2R_SEARCH_LIMIT,
    R2R_TIMEOUT_MS,
    RWKV_CUDA_ON = '0',
    RWKV_ENABLED,
    RWKV_JIT_ON = '0',
    RWKV_MODEL_PATH,
    RWKV_PROVIDER_SCRIPT,
    RWKV_STRATEGY,
    RWKV_TOKENIZER_PATH,
    RWKV_V7_ON,
    OPENAI_API_BASE_URL,
    OPENAI_API_KEY = '',
    SAMBANOVA_API_BASE_URL,
    SAMBANOVA_API_KEY = '',
    extractJsonFromMixedText,
    getCortexRuntimeBudget,
    getEffectiveGeminiApiKey,
    getEffectiveGeminiModel,
    getEffectiveOpenAiApiKey,
    getEffectiveOpenAiModel,
    getEffectiveSambaNovaApiKey,
    getEffectiveSambaNovaModel,
    getRuntimeProfileSettings,
    getSelectedAiProvider,
    getSelectedCustomApiProfile,
    maskApiKeyTail,
    os,
    readAiRuntimeSettings,
    resolveCustomApiEndpoint,
    resolveCustomProviderKind,
    runCommand,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`AI runtime status dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('AI_PROVIDER_OPTIONS', AI_PROVIDER_OPTIONS);
    requireDependency('extractJsonFromMixedText', extractJsonFromMixedText);
    requireDependency('getCortexRuntimeBudget', getCortexRuntimeBudget);
    requireDependency('getEffectiveGeminiApiKey', getEffectiveGeminiApiKey);
    requireDependency('getEffectiveGeminiModel', getEffectiveGeminiModel);
    requireDependency('getEffectiveOpenAiApiKey', getEffectiveOpenAiApiKey);
    requireDependency('getEffectiveOpenAiModel', getEffectiveOpenAiModel);
    requireDependency('getEffectiveSambaNovaApiKey', getEffectiveSambaNovaApiKey);
    requireDependency('getEffectiveSambaNovaModel', getEffectiveSambaNovaModel);
    requireDependency('getRuntimeProfileSettings', getRuntimeProfileSettings);
    requireDependency('getSelectedAiProvider', getSelectedAiProvider);
    requireDependency('getSelectedCustomApiProfile', getSelectedCustomApiProfile);
    requireDependency('maskApiKeyTail', maskApiKeyTail);
    requireDependency('os', os);
    requireDependency('readAiRuntimeSettings', readAiRuntimeSettings);
    requireDependency('resolveCustomApiEndpoint', resolveCustomApiEndpoint);
    requireDependency('resolveCustomProviderKind', resolveCustomProviderKind);
    requireDependency('runCommand', runCommand);
  }

  function getConfiguredModel(selectedProvider) {
    if (selectedProvider === 'openai') return getEffectiveOpenAiModel();
    if (selectedProvider === 'gemini') return getEffectiveGeminiModel();
    if (selectedProvider === 'sambanova') return getEffectiveSambaNovaModel();
    return PERSONA_MODEL_BRAIN;
  }

  async function getStatus() {
    assertReady();
    const runtimeSettings = getRuntimeProfileSettings();
    const runtimeBudget = await getCortexRuntimeBudget();
    const selectedProvider = getSelectedAiProvider();
    const configuredModel = getConfiguredModel(selectedProvider);

    const result = {
      ok: true,
      strategy: 'local-first',
      provider: selectedProvider,
      providerOptions: AI_PROVIDER_OPTIONS,
      cortexRuntime: CORTEX_RENDER_RUNTIME_VERSION,
      timeAsComputeProfile: runtimeSettings.profile,
      runtimeBudget,
      systemRamGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
      configuredModel,
      configuredModels: {
        persona_executor: configuredModel,
        persona_orchestrator: configuredModel,
      },
      rag: {
        enabled: Boolean(CORTEX_RAG_ENABLED),
        provider: CORTEX_RAG_PROVIDER,
        configured: CORTEX_RAG_PROVIDER !== 'r2r' ? false : Boolean(R2R_BASE_URL),
        baseUrl: CORTEX_RAG_PROVIDER === 'r2r' ? R2R_BASE_URL || null : null,
        searchLimit: Math.max(1, Math.min(20, Number.isFinite(Number(R2R_SEARCH_LIMIT)) ? Number(R2R_SEARCH_LIMIT) : 6)),
        timeoutMs: Math.max(1000, Number.isFinite(Number(R2R_TIMEOUT_MS)) ? Number(R2R_TIMEOUT_MS) : 12000),
      },
      envPathsLoaded: LOADED_ENV_PATHS,
      ready: false,
      reachable: false,
    };

    if (selectedProvider === 'mock') {
      result.strategy = 'deterministic-mock';
      result.configuredModel = 'mock-persona';
      result.configuredModels = {
        persona_executor: 'mock-persona',
        persona_orchestrator: 'mock-persona',
      };
      result.apiConfigured = true;
      result.reachable = true;
      result.ready = true;
      result.memoryGuard = {
        enabled: false,
        reason: 'mock_provider',
      };
      result.mock = {
        deterministic: true,
        consumesApi: false,
        supportsFailureFlags: ['[mock:invalid-json]', '[mock:provider-error]', '[mock:rate-limit]'],
      };
      return result;
    }

    if (selectedProvider === 'gemini') {
      const settings = readAiRuntimeSettings();
      const localKey = String(settings.geminiApiKey || '').trim();
      const effectiveKey = getEffectiveGeminiApiKey();
      result.apiConfigured = Boolean(effectiveKey);
      result.reachable = Boolean(effectiveKey);
      result.ready = Boolean(effectiveKey);
      result.memoryGuard = {
        enabled: false,
        reason: 'remote_provider',
      };
      result.gemini = {
        keySource: localKey ? 'settings' : GEMINI_API_KEY ? 'env' : 'none',
        keyMasked: maskApiKeyTail(effectiveKey),
        model: getEffectiveGeminiModel(),
        apiLabel: String(settings.geminiApiLabel || '').trim(),
      };
      if (!effectiveKey) {
        result.reason = 'gemini_api_key_missing';
      }
      return result;
    }

    if (selectedProvider === 'openai') {
      const settings = readAiRuntimeSettings();
      const localKey = String(settings.openaiApiKey || '').trim();
      const effectiveKey = getEffectiveOpenAiApiKey();
      result.apiConfigured = Boolean(effectiveKey);
      result.reachable = Boolean(effectiveKey);
      result.ready = Boolean(effectiveKey && getEffectiveOpenAiModel());
      result.memoryGuard = {
        enabled: false,
        reason: 'remote_provider',
      };
      result.openai = {
        keySource: localKey ? 'settings' : OPENAI_API_KEY ? 'env' : 'none',
        keyMasked: maskApiKeyTail(effectiveKey),
        model: getEffectiveOpenAiModel(),
        apiLabel: String(settings.openaiApiLabel || '').trim(),
        baseUrl: OPENAI_API_BASE_URL,
      };
      if (!effectiveKey) result.reason = 'openai_api_key_missing';
      else if (!getEffectiveOpenAiModel()) result.reason = 'openai_model_missing';
      return result;
    }

    if (selectedProvider === 'sambanova') {
      const settings = readAiRuntimeSettings();
      const localKey = String(settings.sambanovaApiKey || '').trim();
      const effectiveKey = getEffectiveSambaNovaApiKey();
      result.apiConfigured = Boolean(effectiveKey);
      result.reachable = Boolean(effectiveKey);
      result.ready = Boolean(effectiveKey);
      result.memoryGuard = {
        enabled: false,
        reason: 'remote_provider',
      };
      result.sambanova = {
        keySource: localKey ? 'settings' : SAMBANOVA_API_KEY ? 'env' : 'none',
        keyMasked: maskApiKeyTail(effectiveKey),
        model: getEffectiveSambaNovaModel(),
        apiLabel: String(settings.sambanovaApiLabel || '').trim(),
        baseUrl: SAMBANOVA_API_BASE_URL,
      };
      if (!effectiveKey) {
        result.reason = 'sambanova_api_key_missing';
      }
      return result;
    }

    if (String(selectedProvider).startsWith('custom:')) {
      const profile = getSelectedCustomApiProfile(selectedProvider);
      const providerKind = profile ? resolveCustomProviderKind(profile.providerName || '') : 'custom';
      const apiKey = profile ? String(profile.apiKey || '').trim() : '';
      const modelName = profile ? String(profile.model || '').trim() : '';
      const endpoint = profile ? resolveCustomApiEndpoint(profile) : '';

      result.apiConfigured = Boolean(apiKey && modelName);
      result.reachable = Boolean(apiKey && modelName && (providerKind === 'gemini' || providerKind === 'sambanova' || Boolean(endpoint)));
      result.ready = Boolean(result.reachable);
      result.memoryGuard = {
        enabled: false,
        reason: 'remote_provider',
      };
      result.configuredModel = modelName || null;
      result.configuredModels = {
        persona_executor: modelName || null,
        persona_orchestrator: modelName || null,
      };
      result.customProvider = {
        id: profile ? profile.id : null,
        providerKind,
        providerName: profile ? profile.providerName : null,
        apiLabel: profile ? profile.apiLabel : null,
        model: modelName || null,
        keyMasked: maskApiKeyTail(apiKey),
        endpoint: endpoint || null,
      };

      if (!profile) result.reason = 'custom_api_profile_missing';
      else if (!apiKey) result.reason = 'custom_api_key_missing';
      else if (!modelName) result.reason = 'custom_api_model_missing';
      else if (providerKind === 'custom' && !endpoint) result.reason = 'custom_api_endpoint_missing';

      return result;
    }

    const inspectCommand = await runCommand(
      MEMPALACE_PYTHON_BIN,
      [
        RWKV_PROVIDER_SCRIPT,
        '--action',
        'inspect',
        '--model-path',
        RWKV_MODEL_PATH,
        '--tokenizer-path',
        RWKV_TOKENIZER_PATH,
        '--strategy',
        RWKV_STRATEGY,
      ],
      {
        timeoutMs: 12000,
        env: {
          RWKV_V7_ON,
          RWKV_JIT_ON,
          RWKV_CUDA_ON,
        },
      }
    );

    if (!inspectCommand.ok) {
      result.reason = (inspectCommand.stderr || inspectCommand.message || 'rwkv_inspect_failed').trim();
      return result;
    }

    const inspectPayload = extractJsonFromMixedText(inspectCommand.stdout || '');
    if (!inspectPayload || inspectPayload.ok !== true) {
      result.reason = 'rwkv_inspect_payload_invalid';
      return result;
    }

    result.reachable = true;
    result.rwkv = {
      modelPath: RWKV_MODEL_PATH,
      tokenizerPath: RWKV_TOKENIZER_PATH,
      strategy: RWKV_STRATEGY,
      modelExists: Boolean(inspectPayload.model_exists),
      tokenizerExists: Boolean(inspectPayload.tokenizer_exists),
      env: inspectPayload.env || {},
    };
    result.ready = Boolean(RWKV_ENABLED && result.rwkv.modelExists && result.rwkv.tokenizerExists);
    if (!RWKV_ENABLED) result.reason = 'rwkv_disabled';
    if (!result.rwkv.modelExists) result.reason = 'rwkv_model_missing';
    if (!result.rwkv.tokenizerExists) result.reason = 'rwkv_tokenizer_missing';
    return result;
  }

  return {
    getStatus,
  };
}

module.exports = {
  createAiRuntimeStatusService,
};
