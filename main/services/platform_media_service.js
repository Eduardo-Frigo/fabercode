function createPlatformMediaService(dependencies = {}) {
  const {
    accountService = null,
    localAssetService = null,
    getLocalPexelsApiKey = () => '',
  } = dependencies;

  function getPexelsSource() {
    const platformKey = accountService && typeof accountService.getPlatformPexelsApiKey === 'function'
      ? String(accountService.getPlatformPexelsApiKey() || '').trim()
      : '';
    const currentSession = accountService && typeof accountService.getCurrentSession === 'function'
      ? accountService.getCurrentSession()
      : null;
    if (platformKey && currentSession) return { source: 'platform', hasKey: true, requiresSignIn: false };

    const localKey = String(getLocalPexelsApiKey() || '').trim();
    if (localKey) return { source: 'local', hasKey: true, requiresSignIn: false };

    return { source: 'none', hasKey: false, requiresSignIn: Boolean(platformKey && !currentSession) };
  }

  async function resolveBlueprintMediaAssets(options = {}) {
    if (!localAssetService || typeof localAssetService.resolveBlueprintMediaAssets !== 'function') {
      return {
        provider: 'pexels',
        hero: null,
        query: '',
        preference: 'photo',
        status: 'unavailable',
        source: 'none',
      };
    }
    const source = getPexelsSource();
    const assets = await localAssetService.resolveBlueprintMediaAssets(options);
    return {
      ...assets,
      source: source.source,
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
