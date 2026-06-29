function createPlatformMediaService(dependencies = {}) {
  const {
    accountService = null,
    fetchFn = typeof fetch === 'function' ? fetch : null,
    localAssetService = null,
    getLocalPexelsApiKey = () => '',
    platformMediaEndpoint = '',
    timeoutMs = 8000,
  } = dependencies;

  function getCurrentSession() {
    return accountService && typeof accountService.getCurrentSession === 'function'
      ? accountService.getCurrentSession()
      : null;
  }

  function getPlatformKey() {
    return accountService && typeof accountService.getPlatformPexelsApiKey === 'function'
      ? String(accountService.getPlatformPexelsApiKey() || '').trim()
      : '';
  }

  function getPlatformEndpoint() {
    return String(platformMediaEndpoint || '').trim();
  }

  function createEmptyResult({ status = 'missing_key', source = 'none', requiresSignIn = false } = {}) {
    return {
      provider: 'pexels',
      hero: null,
      query: '',
      preference: 'photo',
      status,
      source,
      requiresSignIn,
    };
  }

  function getPexelsSource() {
    const platformEndpoint = getPlatformEndpoint();
    const platformKey = getPlatformKey();
    const currentSession = getCurrentSession();
    if (platformEndpoint && currentSession) {
      return { source: 'platform', hasKey: true, requiresSignIn: false, transport: 'endpoint' };
    }
    if (platformKey && currentSession) {
      return { source: 'platform', hasKey: true, requiresSignIn: false, transport: 'local-key' };
    }

    const localKey = String(getLocalPexelsApiKey() || '').trim();
    if (localKey) return { source: 'local', hasKey: true, requiresSignIn: false, transport: 'local-key' };

    return {
      source: 'none',
      hasKey: false,
      requiresSignIn: Boolean((platformEndpoint || platformKey) && !currentSession),
      transport: 'none',
    };
  }

  async function resolveRemotePlatformMediaAssets(options = {}) {
    const endpoint = getPlatformEndpoint();
    const session = getCurrentSession();
    const sessionToken = String(session && session.id ? session.id : '').trim();
    if (!endpoint || typeof fetchFn !== 'function' || !sessionToken) return null;

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options || {}),
        signal: controller ? controller.signal : undefined,
      });
      if (!response || !response.ok || typeof response.json !== 'function') {
        return createEmptyResult({ status: 'unavailable', source: 'platform', requiresSignIn: false });
      }
      const payload = await response.json();
      const media = payload && payload.media && typeof payload.media === 'object' ? payload.media : payload;
      if (!media || typeof media !== 'object') {
        return createEmptyResult({ status: 'unavailable', source: 'platform', requiresSignIn: false });
      }
      return {
        ...media,
        provider: media.provider || 'pexels',
        source: 'platform',
        requiresSignIn: false,
        transport: 'endpoint',
      };
    } catch {
      return createEmptyResult({ status: 'unavailable', source: 'platform', requiresSignIn: false });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function resolveBlueprintMediaAssets(options = {}) {
    const source = getPexelsSource();
    if (!source.hasKey) {
      return createEmptyResult({
        status: 'missing_key',
        source: source.source,
        requiresSignIn: source.requiresSignIn,
      });
    }
    if (source.transport === 'endpoint') {
      const remoteAssets = await resolveRemotePlatformMediaAssets(options);
      return remoteAssets || createEmptyResult({ status: 'unavailable', source: 'platform' });
    }
    if (!localAssetService || typeof localAssetService.resolveBlueprintMediaAssets !== 'function') {
      return createEmptyResult({ status: 'unavailable', source: source.source });
    }
    const assets = await localAssetService.resolveBlueprintMediaAssets(options);
    return {
      ...assets,
      source: source.source,
      requiresSignIn: source.requiresSignIn,
      transport: source.transport,
    };
  }

  function getStatus() {
    const pexels = getPexelsSource();
    return {
      ok: true,
      providers: {
        pexels,
      },
    };
  }

  return {
    getStatus,
    resolveBlueprintMediaAssets,
  };
}

module.exports = {
  createPlatformMediaService,
};
