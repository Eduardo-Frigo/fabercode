function sanitizeInterfaceLanguage(rawValue) {
  const value = String(rawValue || '').trim();
  const allowed = new Set(['pt-BR', 'en-US', 'es-ES']);
  return allowed.has(value) ? value : 'pt-BR';
}

function sanitizeInterfaceTheme(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  return value === 'light' ? 'light' : 'dark';
}

function sanitizePanelFontScale(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return 100;
  return Math.min(120, Math.max(90, Math.round(value / 5) * 5));
}

function registerAiHandlers(dependencies = {}) {
  const {
    AI_PROVIDER_ENV,
    AI_PROVIDER_OPTIONS,
    GEMINI_API_KEY,
    OPENAI_API_BASE_URL,
    OPENAI_API_KEY,
    PEXELS_API_KEY = '',
    SAMBANOVA_API_BASE_URL,
    SAMBANOVA_API_KEY,
    appendAuditEvent,
    getAiRuntimeStatus,
    getEffectiveGeminiApiKey,
    getEffectiveGeminiModel,
    getEffectiveOpenAiApiKey,
    getEffectiveOpenAiModel,
    getEffectivePexelsApiKey,
    getEffectiveSambaNovaApiKey,
    getEffectiveSambaNovaModel,
    maskApiKeyTail,
    normalizeAiProviderName,
    readAiRuntimeSettings,
    registerIpcHandler,
    sanitizeCustomApiProfiles,
    sanitizeGeminiModelName,
    sanitizeOpenAiModelName,
    sanitizeSambaNovaModelName,
    setSelectedAiProvider,
    writeAiRuntimeSettings,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`AI IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('AI_PROVIDER_ENV', AI_PROVIDER_ENV);
    requireDependency('AI_PROVIDER_OPTIONS', AI_PROVIDER_OPTIONS);
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('getAiRuntimeStatus', getAiRuntimeStatus);
    requireDependency('getEffectiveGeminiApiKey', getEffectiveGeminiApiKey);
    requireDependency('getEffectiveGeminiModel', getEffectiveGeminiModel);
    requireDependency('getEffectiveOpenAiApiKey', getEffectiveOpenAiApiKey);
    requireDependency('getEffectiveOpenAiModel', getEffectiveOpenAiModel);
    requireDependency('getEffectivePexelsApiKey', getEffectivePexelsApiKey);
    requireDependency('getEffectiveSambaNovaApiKey', getEffectiveSambaNovaApiKey);
    requireDependency('getEffectiveSambaNovaModel', getEffectiveSambaNovaModel);
    requireDependency('maskApiKeyTail', maskApiKeyTail);
    requireDependency('normalizeAiProviderName', normalizeAiProviderName);
    requireDependency('readAiRuntimeSettings', readAiRuntimeSettings);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('sanitizeCustomApiProfiles', sanitizeCustomApiProfiles);
    requireDependency('sanitizeGeminiModelName', sanitizeGeminiModelName);
    requireDependency('sanitizeOpenAiModelName', sanitizeOpenAiModelName);
    requireDependency('sanitizeSambaNovaModelName', sanitizeSambaNovaModelName);
    requireDependency('setSelectedAiProvider', setSelectedAiProvider);
    requireDependency('writeAiRuntimeSettings', writeAiRuntimeSettings);
  }

  function customApisForView(customApis) {
    return sanitizeCustomApiProfiles(customApis || []).map((item) => ({
      id: item.id,
      providerName: item.providerName,
      model: item.model,
      apiLabel: item.apiLabel,
      website: item.website,
      hasKey: Boolean(String(item.apiKey || '').trim()),
      keyMasked: maskApiKeyTail(String(item.apiKey || '').trim()),
    }));
  }

  function buildSettingsResponse(settings) {
    const localGeminiKey = String(settings.geminiApiKey || '').trim();
    const localOpenAiKey = String(settings.openaiApiKey || '').trim();
    const localPexelsKey = String(settings.pexelsApiKey || '').trim();
    const effectiveGeminiKey = getEffectiveGeminiApiKey();
    const effectiveOpenAiKey = getEffectiveOpenAiApiKey();
    const effectivePexelsKey = getEffectivePexelsApiKey();
    const effectiveSambaNovaKey = getEffectiveSambaNovaApiKey();

    return {
      ok: true,
      provider: settings.selectedProvider || AI_PROVIDER_ENV,
      providerOptions: AI_PROVIDER_OPTIONS,
      interfaceLanguage: sanitizeInterfaceLanguage(settings.interfaceLanguage),
      interfaceTheme: sanitizeInterfaceTheme(settings.interfaceTheme),
      panelFontScale: sanitizePanelFontScale(settings.panelFontScale),
      welcomeQuoteLastAuthor: String(settings.welcomeQuoteLastAuthor || '').trim(),
      disabledBuiltInProviders: Array.isArray(settings.disabledBuiltInProviders)
        ? settings.disabledBuiltInProviders
        : [],
      openai: {
        hasKey: Boolean(effectiveOpenAiKey),
        keyMasked: maskApiKeyTail(effectiveOpenAiKey),
        keySource: localOpenAiKey ? 'settings' : OPENAI_API_KEY ? 'env' : 'none',
        model: getEffectiveOpenAiModel(),
        apiLabel: String(settings.openaiApiLabel || '').trim(),
        baseUrl: OPENAI_API_BASE_URL,
      },
      gemini: {
        hasKey: Boolean(effectiveGeminiKey),
        keyMasked: maskApiKeyTail(effectiveGeminiKey),
        keySource: localGeminiKey ? 'settings' : GEMINI_API_KEY ? 'env' : 'none',
        model: getEffectiveGeminiModel(),
        apiLabel: String(settings.geminiApiLabel || '').trim(),
      },
      sambanova: {
        hasKey: Boolean(effectiveSambaNovaKey),
        keyMasked: maskApiKeyTail(effectiveSambaNovaKey),
        keySource: String(settings.sambanovaApiKey || '').trim() ? 'settings' : SAMBANOVA_API_KEY ? 'env' : 'none',
        model: getEffectiveSambaNovaModel(),
        apiLabel: String(settings.sambanovaApiLabel || '').trim(),
        baseUrl: SAMBANOVA_API_BASE_URL,
      },
      mediaAssets: {
        pexels: {
          hasKey: Boolean(effectivePexelsKey),
          keyMasked: maskApiKeyTail(effectivePexelsKey),
          keySource: localPexelsKey ? 'settings' : PEXELS_API_KEY ? 'env' : 'none',
          website: 'https://www.pexels.com/api/',
        },
      },
      customApis: customApisForView(settings.customApis || []),
    };
  }

  assertReady();

  registerIpcHandler('ai:settings:get', async () => {
    return buildSettingsResponse(readAiRuntimeSettings());
  });

  registerIpcHandler('ai:settings:save', async (_, payload) => {
    const currentSettings = readAiRuntimeSettings();
    const provider = normalizeAiProviderName(
      payload && payload.provider ? payload.provider : currentSettings.selectedProvider || AI_PROVIDER_ENV
    );
    const next = {
      selectedProvider: provider,
    };

    if (payload && Object.prototype.hasOwnProperty.call(payload, 'geminiApiKey')) {
      next.geminiApiKey = payload.geminiApiKey;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'openaiApiKey')) {
      next.openaiApiKey = payload.openaiApiKey;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'openaiModel')) {
      next.openaiModel = sanitizeOpenAiModelName(payload.openaiModel);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'openaiApiLabel')) {
      next.openaiApiLabel = String(payload.openaiApiLabel || '').trim();
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'pexelsApiKey')) {
      next.pexelsApiKey = payload.pexelsApiKey;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'geminiModel')) {
      next.geminiModel = sanitizeGeminiModelName(payload.geminiModel);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'geminiApiLabel')) {
      next.geminiApiLabel = String(payload.geminiApiLabel || '').trim();
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'sambanovaApiKey')) {
      next.sambanovaApiKey = payload.sambanovaApiKey;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'sambanovaModel')) {
      next.sambanovaModel = sanitizeSambaNovaModelName(payload.sambanovaModel);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'sambanovaApiLabel')) {
      next.sambanovaApiLabel = String(payload.sambanovaApiLabel || '').trim();
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'customApis')) {
      next.customApis = payload.customApis;
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'disabledBuiltInProviders')) {
      next.disabledBuiltInProviders = Array.isArray(payload.disabledBuiltInProviders)
        ? payload.disabledBuiltInProviders
        : [];
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'interfaceLanguage')) {
      next.interfaceLanguage = sanitizeInterfaceLanguage(payload.interfaceLanguage);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'interfaceTheme')) {
      next.interfaceTheme = sanitizeInterfaceTheme(payload.interfaceTheme);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'panelFontScale')) {
      next.panelFontScale = sanitizePanelFontScale(payload.panelFontScale);
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'welcomeQuoteLastAuthor')) {
      next.welcomeQuoteLastAuthor = String(payload.welcomeQuoteLastAuthor || '').trim();
    }

    const saved = writeAiRuntimeSettings(next);
    const customApis = customApisForView(saved.customApis || []);

    appendAuditEvent('ai.settings_saved', {
      provider: saved.selectedProvider,
      openaiKeyConfigured: Boolean(getEffectiveOpenAiApiKey()),
      openaiKeySource: saved.openaiApiKey ? 'settings' : OPENAI_API_KEY ? 'env' : 'none',
      openaiModel: getEffectiveOpenAiModel(),
      pexelsKeyConfigured: Boolean(getEffectivePexelsApiKey()),
      pexelsKeySource: saved.pexelsApiKey ? 'settings' : PEXELS_API_KEY ? 'env' : 'none',
      geminiKeyConfigured: Boolean(getEffectiveGeminiApiKey()),
      geminiKeySource: saved.geminiApiKey ? 'settings' : GEMINI_API_KEY ? 'env' : 'none',
      geminiModel: getEffectiveGeminiModel(),
      sambanovaModel: getEffectiveSambaNovaModel(),
      geminiApiLabel: String(saved.geminiApiLabel || '').trim(),
      sambanovaApiLabel: String(saved.sambanovaApiLabel || '').trim(),
      customApisCount: customApis.length,
      interfaceLanguage: sanitizeInterfaceLanguage(saved.interfaceLanguage),
      interfaceTheme: sanitizeInterfaceTheme(saved.interfaceTheme),
      panelFontScale: sanitizePanelFontScale(saved.panelFontScale),
    });

    return buildSettingsResponse(saved);
  });

  registerIpcHandler('ai:provider:get', async () => {
    const settings = readAiRuntimeSettings();
    return {
      ok: true,
      provider: settings.selectedProvider,
      providerOptions: AI_PROVIDER_OPTIONS,
      hasGeminiApiKey: Boolean(getEffectiveGeminiApiKey()),
      hasOpenAiApiKey: Boolean(getEffectiveOpenAiApiKey()),
      geminiModel: getEffectiveGeminiModel(),
      openaiModel: getEffectiveOpenAiModel(),
      sambanovaModel: getEffectiveSambaNovaModel(),
    };
  });

  registerIpcHandler('ai:provider:set', async (_, payload) => {
    const provider = normalizeAiProviderName(payload && payload.provider ? payload.provider : AI_PROVIDER_ENV);
    const saved = setSelectedAiProvider(provider);
    appendAuditEvent('ai.provider_set', { provider: saved.selectedProvider });
    return {
      ok: true,
      provider: saved.selectedProvider,
      providerOptions: AI_PROVIDER_OPTIONS,
      hasGeminiApiKey: Boolean(getEffectiveGeminiApiKey()),
      hasOpenAiApiKey: Boolean(getEffectiveOpenAiApiKey()),
      geminiModel: getEffectiveGeminiModel(),
      openaiModel: getEffectiveOpenAiModel(),
      sambanovaModel: getEffectiveSambaNovaModel(),
    };
  });

  registerIpcHandler('ai:status', async () => {
    return getAiRuntimeStatus();
  });
}

module.exports = {
  registerAiHandlers,
};
