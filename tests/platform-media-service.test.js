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

  const remoteCalls = [];
  const remote = createPlatformMediaService({
    accountService: {
      getCurrentSession: () => ({ id: 'session-token-1', user: { email: 'owner@example.com' } }),
      getPlatformPexelsApiKey: () => '',
    },
    fetchFn: async (url, options = {}) => {
      remoteCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            media: {
              provider: 'pexels',
              hero: { kind: 'photo', src: 'https://platform.example.test/hero.jpg' },
              query: 'hotel boutique',
              preference: 'photo',
              status: 'ready',
            },
          };
        },
      };
    },
    getLocalPexelsApiKey: () => '',
    localAssetService,
    platformMediaEndpoint: 'https://platform.example.test/api/media/blueprint',
  });

  assert.deepStrictEqual(remote.getStatus().providers.pexels, {
    source: 'platform',
    hasKey: true,
    requiresSignIn: false,
    transport: 'endpoint',
  });
  const remoteAssets = await remote.resolveBlueprintMediaAssets({ userMessage: 'site para hotel' });
  assert.strictEqual(remoteAssets.source, 'platform');
  assert.strictEqual(remoteAssets.transport, 'endpoint');
  assert.strictEqual(remoteAssets.status, 'ready');
  assert.strictEqual(remoteCalls.length, 1);
  assert.strictEqual(remoteCalls[0].url, 'https://platform.example.test/api/media/blueprint');
  assert.strictEqual(remoteCalls[0].options.headers.Authorization, 'Bearer session-token-1');
  assert.deepStrictEqual(JSON.parse(remoteCalls[0].options.body), { userMessage: 'site para hotel' });
  assert.strictEqual(calls.length, 0);

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
    transport: 'local-key',
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
  const blockedAssets = await signInRequired.resolveBlueprintMediaAssets({ userMessage: 'site para arquitetura' });
  assert.strictEqual(blockedAssets.status, 'missing_key');
  assert.strictEqual(blockedAssets.source, 'none');
  assert.strictEqual(blockedAssets.requiresSignIn, true);
  assert.strictEqual(calls.length, 1);

  console.log('platform-media-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
