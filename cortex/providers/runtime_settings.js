function normalizeAiProviderName(rawValue) {
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase();
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

function sanitizeInterfaceLanguage(rawValue) {
  const value = String(rawValue || '').trim();
  const allowed = new Set(['pt-BR', 'en-US', 'es-ES']);
  return allowed.has(value) ? value : 'pt-BR';
}

function createAiRuntimeSettingsService(dependencies = {}) {
  const {
    aiProviderEnv = 'rwkv',
    fs,
    geminiApiKey = '',
    geminiModelBrain = '',
    getUserDataPath,
    path,
    protectSecret = (value) => String(value || '').trim(),
    sambanovaApiKey = '',
    sambanovaModelBrain = '',
    unprotectSecret = (value) => String(value || '').trim(),
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`AI runtime settings dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('fs', fs);
    requireDependency('getUserDataPath', getUserDataPath);
    requireDependency('path', path);
  }

  function getDefaultProvider() {
    return normalizeAiProviderName(aiProviderEnv || 'rwkv');
  }

  function getSafeFallbackProvider() {
    const fallback = getDefaultProvider();
    return fallback.startsWith('custom:') ? 'rwkv' : fallback;
  }

  function ensureStore() {
    assertReady();
    const storeDir = getUserDataPath();
    const storePath = path.join(storeDir, 'ai-runtime-settings.json');

    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }

    if (!fs.existsSync(storePath)) {
      fs.writeFileSync(
        storePath,
        JSON.stringify({ selectedProvider: getDefaultProvider() }, null, 2),
        'utf8'
      );
    }

    return storePath;
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
          apiKey: unprotectSecret(item.apiKey || ''),
          model: String(item.model || '').trim(),
          apiLabel: String(item.apiLabel || '').trim(),
          website: String(item.website || '').trim(),
        };
      })
      .filter((item) => item.providerName || item.apiKey || item.model || item.apiLabel || item.website);
  }

  function sanitizeDisabledBuiltInProviders(rawList) {
    const allowed = new Set(['gemini', 'sambanova']);
    const list = Array.isArray(rawList) ? rawList : [];
    return Array.from(
      new Set(
        list
          .map((item) => normalizeAiProviderName(item))
          .filter((item) => allowed.has(item))
      )
    );
  }

  function mergeCustomApisKeepingExistingKeys(currentApis, incomingApis) {
    const currentById = new Map((Array.isArray(currentApis) ? currentApis : []).map((item) => [String(item.id || ''), item]));
    return sanitizeCustomApiProfiles(incomingApis).map((item) => {
      const previous = currentById.get(String(item.id || '')) || null;
      if (previous && !String(item.apiKey || '').trim()) {
        return {
          ...item,
          apiKey: String(previous.apiKey || '').trim(),
        };
      }
      return item;
    });
  }

  function resolveSelectedProvider(selectedProvider, customApis = [], disabledBuiltInProviders = []) {
    const normalized = normalizeAiProviderName(selectedProvider || getDefaultProvider());
    const disabled = new Set(sanitizeDisabledBuiltInProviders(disabledBuiltInProviders));
    if (disabled.has(normalized)) return getSafeFallbackProvider();
    if (!normalized.startsWith('custom:')) return normalized;
    const customId = normalized.slice('custom:'.length);
    const exists = sanitizeCustomApiProfiles(customApis).some((item) => String(item.id || '').toLowerCase() === customId);
    return exists ? normalized : getSafeFallbackProvider();
  }

  function readSettings() {
    const storePath = ensureStore();
    try {
      const raw = fs.readFileSync(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      const customApis = sanitizeCustomApiProfiles(parsed && parsed.customApis);
      const disabledBuiltInProviders = sanitizeDisabledBuiltInProviders(parsed && parsed.disabledBuiltInProviders);
      return {
        selectedProvider: resolveSelectedProvider(
          parsed && parsed.selectedProvider ? parsed.selectedProvider : getDefaultProvider(),
          customApis,
          disabledBuiltInProviders
        ),
        interfaceLanguage: sanitizeInterfaceLanguage(parsed && parsed.interfaceLanguage),
        geminiApiKey: parsed && typeof parsed.geminiApiKey === 'string' ? unprotectSecret(parsed.geminiApiKey) : '',
        geminiModel: parsed && typeof parsed.geminiModel === 'string' ? parsed.geminiModel.trim() : '',
        geminiApiLabel: parsed && typeof parsed.geminiApiLabel === 'string' ? parsed.geminiApiLabel.trim() : '',
        sambanovaApiKey: parsed && typeof parsed.sambanovaApiKey === 'string' ? unprotectSecret(parsed.sambanovaApiKey) : '',
        sambanovaModel: parsed && typeof parsed.sambanovaModel === 'string' ? parsed.sambanovaModel.trim() : '',
        sambanovaApiLabel: parsed && typeof parsed.sambanovaApiLabel === 'string' ? parsed.sambanovaApiLabel.trim() : '',
        customApis,
        disabledBuiltInProviders,
      };
    } catch {
      return {
        selectedProvider: getDefaultProvider(),
        interfaceLanguage: 'pt-BR',
        geminiApiKey: '',
        geminiModel: '',
        geminiApiLabel: '',
        sambanovaApiKey: '',
        sambanovaModel: '',
        sambanovaApiLabel: '',
        customApis: [],
        disabledBuiltInProviders: [],
      };
    }
  }

  function writeSettings(settings = {}) {
    const storePath = ensureStore();
    const current = readSettings();
    const hasGeminiApiKey = Object.prototype.hasOwnProperty.call(settings, 'geminiApiKey');
    const hasGeminiModel = Object.prototype.hasOwnProperty.call(settings, 'geminiModel');
    const hasGeminiApiLabel = Object.prototype.hasOwnProperty.call(settings, 'geminiApiLabel');
    const hasSambaNovaApiKey = Object.prototype.hasOwnProperty.call(settings, 'sambanovaApiKey');
    const hasSambaNovaModel = Object.prototype.hasOwnProperty.call(settings, 'sambanovaModel');
    const hasSambaNovaApiLabel = Object.prototype.hasOwnProperty.call(settings, 'sambanovaApiLabel');
    const hasCustomApis = Object.prototype.hasOwnProperty.call(settings, 'customApis');
    const hasDisabledBuiltInProviders = Object.prototype.hasOwnProperty.call(settings, 'disabledBuiltInProviders');
    const hasInterfaceLanguage = Object.prototype.hasOwnProperty.call(settings, 'interfaceLanguage');
    const customApis = hasCustomApis
      ? mergeCustomApisKeepingExistingKeys(current.customApis || [], settings.customApis)
      : sanitizeCustomApiProfiles(current.customApis);
    const disabledBuiltInProviders = hasDisabledBuiltInProviders
      ? sanitizeDisabledBuiltInProviders(settings.disabledBuiltInProviders)
      : sanitizeDisabledBuiltInProviders(current.disabledBuiltInProviders);

    const next = {
      selectedProvider: resolveSelectedProvider(
        settings.selectedProvider || current.selectedProvider || getDefaultProvider(),
        customApis,
        disabledBuiltInProviders
      ),
      interfaceLanguage: hasInterfaceLanguage
        ? sanitizeInterfaceLanguage(settings.interfaceLanguage)
        : sanitizeInterfaceLanguage(current.interfaceLanguage),
      geminiApiKey: hasGeminiApiKey
        ? String(settings.geminiApiKey || '').trim()
        : String(current.geminiApiKey || '').trim(),
      geminiModel: hasGeminiModel
        ? String(settings.geminiModel || '').trim()
        : String(current.geminiModel || '').trim(),
      geminiApiLabel: hasGeminiApiLabel
        ? String(settings.geminiApiLabel || '').trim()
        : String(current.geminiApiLabel || '').trim(),
      sambanovaApiKey: hasSambaNovaApiKey
        ? String(settings.sambanovaApiKey || '').trim()
        : String(current.sambanovaApiKey || '').trim(),
      sambanovaModel: hasSambaNovaModel
        ? String(settings.sambanovaModel || '').trim()
        : String(current.sambanovaModel || '').trim(),
      sambanovaApiLabel: hasSambaNovaApiLabel
        ? String(settings.sambanovaApiLabel || '').trim()
        : String(current.sambanovaApiLabel || '').trim(),
      customApis,
      disabledBuiltInProviders,
    };

    const stored = {
      ...next,
      geminiApiKey: protectSecret(next.geminiApiKey),
      sambanovaApiKey: protectSecret(next.sambanovaApiKey),
      customApis: sanitizeCustomApiProfiles(next.customApis).map((item) => ({
        ...item,
        apiKey: protectSecret(item.apiKey),
      })),
    };

    fs.writeFileSync(storePath, JSON.stringify(stored, null, 2), 'utf8');
    return next;
  }

  function setSelectedProvider(provider) {
    return writeSettings({ selectedProvider: normalizeAiProviderName(provider) });
  }

  function getEffectiveGeminiApiKey() {
    const settings = readSettings();
    const localKey = String(settings.geminiApiKey || '').trim();
    if (localKey) return localKey;
    return String(geminiApiKey || '').trim();
  }

  function getEffectiveSambaNovaApiKey() {
    const settings = readSettings();
    const localKey = String(settings.sambanovaApiKey || '').trim();
    if (localKey) return localKey;
    return String(sambanovaApiKey || '').trim();
  }

  function getEffectiveGeminiModel() {
    const settings = readSettings();
    const selectedModel = sanitizeModelName(settings.geminiModel || '');
    return selectedModel || geminiModelBrain;
  }

  function getEffectiveSambaNovaModel() {
    const settings = readSettings();
    const selectedModel = sanitizeModelName(settings.sambanovaModel || '');
    return selectedModel || sambanovaModelBrain;
  }

  function listCustomApiProfiles() {
    const settings = readSettings();
    return sanitizeCustomApiProfiles(settings.customApis || []);
  }

  return {
    ensureStore,
    getEffectiveGeminiApiKey,
    getEffectiveGeminiModel,
    getEffectiveSambaNovaApiKey,
    getEffectiveSambaNovaModel,
    listCustomApiProfiles,
    mergeCustomApisKeepingExistingKeys,
    readSettings,
    resolveSelectedProvider,
    sanitizeDisabledBuiltInProviders,
    sanitizeInterfaceLanguage,
    sanitizeCustomApiProfiles,
    sanitizeGeminiModelName: sanitizeModelName,
    sanitizeSambaNovaModelName: sanitizeModelName,
    setSelectedProvider,
    writeSettings,
  };
}

module.exports = {
  createAiRuntimeSettingsService,
  normalizeAiProviderName,
  sanitizeInterfaceLanguage,
};
