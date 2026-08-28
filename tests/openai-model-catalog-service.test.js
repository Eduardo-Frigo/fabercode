'use strict';

const assert = require('assert');

const {
  createOpenAiModelCatalogService,
  normalizeCatalogModels,
} = require('../main/services/openai_model_catalog_service');

class FakeAbortController {
  constructor() {
    this.signal = {};
  }

  abort() {}
}

async function run() {
  assert.deepStrictEqual(normalizeCatalogModels([
    { id: 'gpt-5.6-terra', created: 20, owned_by: 'openai', shutdown_date: null },
    { id: 'gpt-5.6-sol', created: 30, owned_by: 'openai', shutdown_date: null },
    { id: 'gpt-5.6-sol', created: 10, owned_by: 'duplicate' },
    { id: 'invalid model id', created: 40, owned_by: 'openai' },
  ]), [
    { id: 'gpt-5.6-sol', created: 30, ownedBy: 'openai', shutdownDate: null },
    { id: 'gpt-5.6-terra', created: 20, ownedBy: 'openai', shutdownDate: null },
  ]);

  const calls = [];
  const service = createOpenAiModelCatalogService({
    abortController: FakeAbortController,
    clearTimeoutFn: () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              { id: 'gpt-6-future', created: 60, owned_by: 'openai' },
              { id: 'gpt-5.6-sol', created: 50, owned_by: 'openai' },
              { id: 'gpt-5.6-terra', created: 40, owned_by: 'openai' },
            ],
          };
        },
      };
    },
    setTimeoutFn: () => 1,
  });

  const result = await service.list({
    apiKey: 'protected-test-key',
    baseUrl: 'https://api.openai.com/v1',
    timeoutMs: 5_000,
  });
  assert.deepStrictEqual(result.models.map((model) => model.id), [
    'gpt-6-future',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
  ]);
  assert.strictEqual(result.providerOrigin, 'https://api.openai.com');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.openai.com/v1/models');
  assert.strictEqual(calls[0].options.method, 'GET');
  assert.strictEqual(calls[0].options.redirect, 'error');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer protected-test-key');

  await assert.rejects(
    () => service.list({
      apiKey: 'protected-test-key',
      baseUrl: 'https://attacker.example/v1',
    }),
    (error) => error && error.code === 'OPENAI_MODEL_CATALOG_DESTINATION_REJECTED'
  );

  console.log('openai-model-catalog-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
