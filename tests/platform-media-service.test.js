const assert = require('assert');
const { createPlatformMediaService } = require('../main/services/platform_media_service');

async function run() {
  const calls = [];
  const localAssetService = {
    resolveBlueprintMediaAssets: async (options) => {
      calls.push(options);
      return {
        provider: 'pexels',
        hero: { kind: 'photo', src: 'https://images.example.test/hero.jpg' },
        query: 'law office consultation',
        preference: 'photo',
        status: 'ready',
      };
    },
  };

  const noKey = createPlatformMediaService({
    getLocalPexelsApiKey: () => '',
    localAssetService,
    platformMediaEndpoint: 'https://unused.example.test/media',
    accountService: { getPlatformPexelsApiKey: () => 'unused-platform-key' },
  });
  assert.deepStrictEqual(noKey.getStatus().providers.pexels, {
    source: 'none', hasKey: false, requiresSignIn: false, transport: 'none',
  });
  const missing = await noKey.resolveBlueprintMediaAssets({ userMessage: 'site para advogado' });
  assert.strictEqual(missing.status, 'missing_key');
  assert.strictEqual(calls.length, 0);

  const ownKey = createPlatformMediaService({
    getLocalPexelsApiKey: () => 'user-owned-key',
    localAssetService,
  });
  assert.deepStrictEqual(ownKey.getStatus().providers.pexels, {
    source: 'local', hasKey: true, requiresSignIn: false, transport: 'local-key',
  });
  const options = { userMessage: 'site para advogado' };
  const assets = await ownKey.resolveBlueprintMediaAssets(options);
  assert.strictEqual(assets.status, 'ready');
  assert.strictEqual(assets.source, 'local');
  assert.strictEqual(assets.transport, 'local-key');
  assert.deepStrictEqual(calls, [options]);

  const unavailable = createPlatformMediaService({ getLocalPexelsApiKey: () => 'key' });
  assert.strictEqual((await unavailable.resolveBlueprintMediaAssets()).status, 'unavailable');
  console.log('platform-media-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
