const assert = require('assert');

const { createPlatformMediaService } = require('../main/services/platform_media_service');

async function run() {
  const calls = [];
  const localAssetService = {
    resolveBlueprintMediaAssets: async (payload) => {
      calls.push(payload);
      return {
        provider: 'pexels',
        hero: { kind: 'photo', src: 'https://images.example.test/hero.jpg' },
        query: 'law office consultation',
        preference: 'photo',
        status: 'ready',
      };
    },
  };

  const platform = createPlatformMediaService({
    accountService: {
      getCurrentSession: () => ({ user: { email: 'owner@example.com' } }),
      getPlatformPexelsApiKey: () => 'platform-key',
    },
    getLocalPexelsApiKey: () => '',
    localAssetService,
  });

  assert.deepStrictEqual(platform.getStatus().providers.pexels, {
    source: 'platform',
    hasKey: true,
    requiresSignIn: false,
  });
  const assets = await platform.resolveBlueprintMediaAssets({ userMessage: 'site para advogado' });
  assert.strictEqual(assets.source, 'platform');
  assert.strictEqual(assets.status, 'ready');
  assert.strictEqual(calls.length, 1);

  const local = createPlatformMediaService({
    accountService: {
      getCurrentSession: () => null,
      getPlatformPexelsApiKey: () => '',
    },
    getLocalPexelsApiKey: () => 'local-key',
    localAssetService,
  });
  assert.strictEqual(local.getStatus().providers.pexels.source, 'local');

  const signInRequired = createPlatformMediaService({
    accountService: {
      getCurrentSession: () => null,
      getPlatformPexelsApiKey: () => 'platform-key',
    },
    getLocalPexelsApiKey: () => '',
    localAssetService,
  });
  assert.strictEqual(signInRequired.getStatus().providers.pexels.source, 'none');
  assert.strictEqual(signInRequired.getStatus().providers.pexels.requiresSignIn, true);

  console.log('platform-media-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
