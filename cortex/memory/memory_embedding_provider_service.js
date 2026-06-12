const {
  DEFAULT_VECTOR_DIMENSIONS,
  MEMORY_EMBEDDING_SCHEMA_VERSION,
  createMemoryEmbedding,
} = require('./memory_embedding_service');

const MEMORY_EMBEDDING_PROVIDER_SCHEMA_VERSION = 'memory-embedding-provider-v1';
const DEFAULT_REMOTE_TIMEOUT_MS = 12000;

function normalizeProviderName(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['openai', 'openai_compatible', 'http', 'remote'].includes(normalized)) return normalized;
  return 'local';
}

function normalizeVector(vector = [], dimensions = 0) {
  const values = Array.isArray(vector) ? vector.map((item) => Number(item || 0)) : [];
  const clipped = dimensions > 0 ? values.slice(0, dimensions) : values;
  const magnitude = Math.sqrt(clipped.reduce((sum, item) => sum + item * item, 0));
  if (!magnitude) return clipped;
  return clipped.map((item) => Number((item / magnitude).toFixed(6)));
}

function withTimeout(promise, timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`embedding_timeout_${timeoutMs}ms`)), Math.max(1, Number(timeoutMs || 1)));
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function parseRemoteEmbeddingResponse(payload = {}) {
  if (Array.isArray(payload.embedding)) return [payload.embedding];
  if (Array.isArray(payload.embeddings)) return payload.embeddings;
  if (Array.isArray(payload.data)) {
    return payload.data
      .map((entry) => (entry && Array.isArray(entry.embedding) ? entry.embedding : null))
      .filter(Boolean);
  }
  return [];
}

function buildOpenAiEmbeddingEndpoint(baseUrl = '') {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (/\/embeddings$/i.test(clean)) return clean;
  if (/\/v1$/i.test(clean)) return `${clean}/embeddings`;
  return `${clean}/v1/embeddings`;
}

function normalizeDimensions(value = DEFAULT_VECTOR_DIMENSIONS) {
  const parsed = Number(value || DEFAULT_VECTOR_DIMENSIONS);
  if (!Number.isFinite(parsed)) return DEFAULT_VECTOR_DIMENSIONS;
  return Math.max(32, Math.min(4096, Math.round(parsed)));
}

function normalizeTimeoutMs(value = DEFAULT_REMOTE_TIMEOUT_MS) {
  const parsed = Number(value || DEFAULT_REMOTE_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_REMOTE_TIMEOUT_MS;
  return Math.max(500, Math.min(120000, Math.round(parsed)));
}

function createMemoryEmbeddingProviderService(dependencies = {}) {
  const {
    config = {},
    fetchFn = null,
    localEmbed = createMemoryEmbedding,
    now = () => new Date().toISOString(),
  } = dependencies;

  const provider = normalizeProviderName(config.provider || config.type);
  const model = String(config.model || (provider === 'local' ? 'faber-local-hash-semantic-v1' : 'text-embedding-3-small')).trim();
  const dimensions = normalizeDimensions(config.dimensions || DEFAULT_VECTOR_DIMENSIONS);
  const endpoint = provider === 'openai' || provider === 'openai_compatible'
    ? buildOpenAiEmbeddingEndpoint(config.endpoint || config.baseUrl || 'https://api.openai.com/v1')
    : String(config.endpoint || '').trim();
  const apiKey = String(config.apiKey || '').trim();
  const timeoutMs = normalizeTimeoutMs(config.timeoutMs || DEFAULT_REMOTE_TIMEOUT_MS);
  const allowFallback = config.allowFallback !== false;

  function localEmbedding(text = '', reason = '') {
    const embedding = localEmbed(text, { dimensions: Math.min(dimensions, 512) });
    return {
      ...embedding,
      schemaVersion: MEMORY_EMBEDDING_SCHEMA_VERSION,
      providerSchemaVersion: MEMORY_EMBEDDING_PROVIDER_SCHEMA_VERSION,
      provider: 'local',
      fallback: Boolean(reason),
      fallbackReason: reason || '',
      generatedAt: now(),
    };
  }

  function getStatus() {
    const remoteConfigured = Boolean(fetchFn && endpoint && (provider === 'http' || provider === 'remote' || apiKey || config.allowAnonymous === true));
    return {
      ok: provider === 'local' || remoteConfigured || allowFallback,
      ready: provider === 'local' || remoteConfigured,
      schemaVersion: MEMORY_EMBEDDING_PROVIDER_SCHEMA_VERSION,
      provider,
      model,
      endpoint: endpoint || null,
      dimensions,
      fallbackProvider: allowFallback ? 'local' : null,
      reason: provider === 'local'
        ? 'local_embedding_ready'
        : remoteConfigured
          ? 'remote_embedding_ready'
          : 'remote_embedding_not_configured',
    };
  }

  async function embedRemote(input = []) {
    if (typeof fetchFn !== 'function') throw new Error('embedding_fetch_unavailable');
    if (!endpoint) throw new Error('embedding_endpoint_missing');
    if (!apiKey && config.allowAnonymous !== true) throw new Error('embedding_api_key_missing');

    const headers = {
      'content-type': 'application/json',
      ...(config.headers && typeof config.headers === 'object' ? config.headers : {}),
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const body = {
      model,
      input,
    };
    if (provider === 'openai' || provider === 'openai_compatible') {
      body.dimensions = dimensions;
    }

    const response = await withTimeout(fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }), timeoutMs);
    if (!response || response.ok === false) {
      const status = response && response.status ? `_${response.status}` : '';
      throw new Error(`embedding_remote_failed${status}`);
    }
    const payload = typeof response.json === 'function' ? await response.json() : response;
    const vectors = parseRemoteEmbeddingResponse(payload);
    if (!vectors.length) throw new Error('embedding_remote_empty_response');
    return vectors;
  }

  async function embedMany(texts = []) {
    const input = (Array.isArray(texts) ? texts : [texts]).map((text) => String(text || ''));
    if (provider === 'local') return input.map((text) => localEmbedding(text));
    try {
      const vectors = await embedRemote(input);
      return input.map((text, index) => {
        const vector = normalizeVector(vectors[index] || vectors[0] || [], dimensions);
        if (!vector.length) return localEmbedding(text, 'remote_vector_empty');
        return {
          schemaVersion: MEMORY_EMBEDDING_SCHEMA_VERSION,
          providerSchemaVersion: MEMORY_EMBEDDING_PROVIDER_SCHEMA_VERSION,
          provider,
          model,
          dimensions: vector.length,
          tokens: [],
          vector,
          fallback: false,
          generatedAt: now(),
        };
      });
    } catch (error) {
      if (!allowFallback) throw error;
      return input.map((text) => localEmbedding(text, error.message || 'remote_embedding_failed'));
    }
  }

  async function embedText(text = '') {
    const [embedding] = await embedMany([text]);
    return embedding;
  }

  return {
    embedMany,
    embedText,
    getStatus,
  };
}

module.exports = {
  MEMORY_EMBEDDING_PROVIDER_SCHEMA_VERSION,
  buildOpenAiEmbeddingEndpoint,
  createMemoryEmbeddingProviderService,
  normalizeDimensions,
  normalizeProviderName,
  normalizeTimeoutMs,
  normalizeVector,
  parseRemoteEmbeddingResponse,
};
