function createPlatformMediaService(dependencies = {}) {
  const {
    localAssetService = null,
    getLocalPexelsApiKey = () => '',
  } = dependencies;

  function getPexelsSource() {
    const hasKey = Boolean(String(getLocalPexelsApiKey() || '').trim());
    return {
      source: hasKey ? 'local' : 'none',
      hasKey,
      requiresSignIn: false,
      transport: hasKey ? 'local-key' : 'none',
    };
  }

  function createEmptyResult(status = 'missing_key', source = 'none') {
    return {
      provider: 'pexels',
      hero: null,
      query: '',
      preference: 'photo',
      status,
      source,
      requiresSignIn: false,
    };
  }

  async function resolveBlueprintMediaAssets(options = {}) {
    const source = getPexelsSource();
    if (!source.hasKey) return createEmptyResult('missing_key');
    if (!localAssetService || typeof localAssetService.resolveBlueprintMediaAssets !== 'function') {
      return createEmptyResult('unavailable', source.source);
    }
    const assets = await localAssetService.resolveBlueprintMediaAssets(options);
    return {
      ...assets,
      source: source.source,
      requiresSignIn: false,
      transport: source.transport,
    };
  }

  function getStatus() {
    return { ok: true, providers: { pexels: getPexelsSource() } };
  }

  return { getStatus, resolveBlueprintMediaAssets };
}

module.exports = { createPlatformMediaService };
