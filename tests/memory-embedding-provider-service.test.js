const assert = require('assert');

const {
  buildOpenAiEmbeddingEndpoint,
  createMemoryEmbeddingProviderService,
  normalizeDimensions,
  normalizeProviderName,
  normalizeTimeoutMs,
  parseRemoteEmbeddingResponse,
} = require('../cortex/memory/memory_embedding_provider_service');
const { DEFAULT_VECTOR_DIMENSIONS } = require('../cortex/memory/memory_embedding_service');
const {
  rankMemoryCandidatesWithProvider,
} = require('../cortex/memory/memory_provenance_service');

async function run() {
  assert.strictEqual(normalizeProviderName('openai'), 'openai');
  assert.strictEqual(normalizeProviderName('weird'), 'local');
  assert.strictEqual(normalizeDimensions('abc'), DEFAULT_VECTOR_DIMENSIONS);
  assert.strictEqual(normalizeDimensions(12), 32);
  assert.strictEqual(normalizeDimensions(9000), 4096);
  assert.strictEqual(normalizeTimeoutMs('abc'), 12000);
  assert.strictEqual(normalizeTimeoutMs(1), 500);
  assert.strictEqual(normalizeTimeoutMs(200000), 120000);
  assert.strictEqual(buildOpenAiEmbeddingEndpoint('https://api.openai.com/v1'), 'https://api.openai.com/v1/embeddings');
  assert.deepStrictEqual(parseRemoteEmbeddingResponse({ data: [{ embedding: [1, 0] }] }), [[1, 0]]);

  const calls = [];
  const provider = createMemoryEmbeddingProviderService({
    config: {
      provider: 'openai',
      endpoint: 'https://api.test/v1',
      apiKey: 'secret',
      model: 'remote-embedding',
      dimensions: 4,
      timeoutMs: 1000,
    },
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            data: [
              { embedding: [1, 0, 0, 0] },
              { embedding: [0.95, 0.05, 0, 0] },
              { embedding: [0, 1, 0, 0] },
            ],
          };
        },
      };
    },
    now: () => '2026-05-28T12:00:00.000Z',
  });

  const status = provider.getStatus();
  assert.strictEqual(status.ready, true);
  assert.strictEqual(status.provider, 'openai');

  const embeddings = await provider.embedMany(['query', 'near', 'far']);
  assert.strictEqual(embeddings[0].model, 'remote-embedding');
  assert.strictEqual(embeddings[0].provider, 'openai');
  assert.strictEqual(calls[0].url, 'https://api.test/v1/embeddings');
  assert.match(calls[0].options.headers.authorization, /Bearer secret/);

  const ranked = await rankMemoryCandidatesWithProvider([
    { sourceType: 'project_memory', sourceId: 'near', text: 'near' },
    { sourceType: 'project_memory', sourceId: 'far', text: 'far' },
  ], 'query', {
    embeddingProvider: provider,
    limit: 1,
    minConfidence: 0,
  });
  assert.strictEqual(ranked.used[0].sourceId, 'near');
  assert.strictEqual(ranked.used[0].vectorModel, 'remote-embedding');

  const fallbackProvider = createMemoryEmbeddingProviderService({
    config: {
      provider: 'openai',
      endpoint: 'https://api.test/v1',
      apiKey: 'secret',
      dimensions: 128,
    },
    fetchFn: async () => {
      throw new Error('network_down');
    },
  });
  const fallback = await fallbackProvider.embedText('memoria semantica');
  assert.strictEqual(fallback.provider, 'local');
  assert.strictEqual(fallback.fallback, true);
  assert.match(fallback.fallbackReason, /network_down/);

  const invalidConfigProvider = createMemoryEmbeddingProviderService({
    config: {
      provider: 'openai',
      dimensions: 'nope',
      timeoutMs: 'slow',
    },
  });
  const invalidStatus = invalidConfigProvider.getStatus();
  assert.strictEqual(invalidStatus.dimensions, DEFAULT_VECTOR_DIMENSIONS);
  const invalidFallback = await invalidConfigProvider.embedText('fallback com dimensao invalida');
  assert.strictEqual(invalidFallback.provider, 'local');
  assert.strictEqual(Number.isFinite(invalidFallback.dimensions), true);
  assert.strictEqual(invalidFallback.dimensions, DEFAULT_VECTOR_DIMENSIONS);

  console.log('memory-embedding-provider-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
