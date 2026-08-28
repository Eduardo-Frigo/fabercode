'use strict';

const assert = require('assert');

const {
  DEFAULT_LIVE_CORPUS_MODEL_CANDIDATES,
  createApplicationCreationLiveCorpusModelResolver,
  selectKnownResponsesModel,
} = require('../main/services/application_creation_live_corpus_model_resolver');

function createPolicy() {
  return {
    resolveOfficialProviderDestination(input) {
      assert.deepStrictEqual(input, {
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      });
      return {
        providerId: 'openai',
        providerOrigin: 'https://api.openai.com',
        baseUrl: 'https://api.openai.com/v1',
      };
    },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.strictEqual(error && error.code, code);
    return true;
  });
}

async function run() {
  assert.deepStrictEqual(DEFAULT_LIVE_CORPUS_MODEL_CANDIDATES.slice(0, 3), [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ]);
  assert.strictEqual(
    selectKnownResponsesModel(
      ['gpt-5-codex', 'gpt-5.4', 'gpt-4.1'],
      'gpt-5-codex',
      ['gpt-5.4', 'gpt-4.1']
    ),
    'gpt-5.4'
  );
  assert.strictEqual(
    selectKnownResponsesModel(['gpt-5.4', 'gpt-4.1'], 'gpt-5.4', ['gpt-5.4']),
    'gpt-5.4'
  );
  assert.strictEqual(
    selectKnownResponsesModel(
      ['gpt-5.4-2026-07-01', 'gpt-5.4-2026-08-01', 'gpt-4.1'],
      'missing-model',
      ['gpt-5.4', 'gpt-4.1']
    ),
    'gpt-5.4-2026-08-01'
  );
  assert.strictEqual(
    selectKnownResponsesModel(['text-embedding-3-large'], 'missing-model', ['gpt-5.4']),
    ''
  );

  const calls = [];
  const metrics = { requests: 0, discoveryRequests: 0 };
  const resolver = createApplicationCreationLiveCorpusModelResolver({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: [{ id: 'gpt-5-codex' }, { id: 'gpt-4.1' }, { id: 'gpt-5.4' }] };
        },
      };
    },
  });
  const resolved = await resolver.resolve({
    apiKey: 'protected-test-key',
    baseUrl: 'https://api.openai.com/v1',
    configuredModel: 'gpt-5-codex',
    policy: createPolicy(),
    metrics,
  });
  assert.deepStrictEqual(resolved, {
    configuredModel: 'gpt-5-codex',
    model: 'gpt-5.4',
    usedConfiguredModel: false,
    providerOrigin: 'https://api.openai.com',
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.openai.com/v1/models');
  assert.strictEqual(calls[0].options.method, 'GET');
  assert.strictEqual(calls[0].options.redirect, 'error');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer protected-test-key');
  assert.deepStrictEqual(metrics, { requests: 1, discoveryRequests: 1 });

  const unavailable = createApplicationCreationLiveCorpusModelResolver({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { data: [{ id: 'text-embedding-3-large' }] }; },
    }),
  });
  await expectCode(unavailable.resolve({
    apiKey: 'protected-test-key',
    baseUrl: 'https://api.openai.com/v1',
    configuredModel: 'missing-model',
    policy: createPolicy(),
  }), 'LIVE_CORPUS_MODEL_UNAVAILABLE');

  const failed = createApplicationCreationLiveCorpusModelResolver({
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  await expectCode(failed.resolve({
    apiKey: 'protected-test-key',
    baseUrl: 'https://api.openai.com/v1',
    configuredModel: 'gpt-5.4',
    policy: createPolicy(),
  }), 'LIVE_CORPUS_MODEL_DISCOVERY_FAILED');

  console.log('application-creation-live-corpus-model-resolver.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
