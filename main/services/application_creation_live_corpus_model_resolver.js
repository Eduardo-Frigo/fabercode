'use strict';

const DEFAULT_LIVE_CORPUS_MODEL_CANDIDATES = Object.freeze([
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5',
  'gpt-4.1',
]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeModelId(value = '') {
  const model = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(model) ? model : '';
}

function selectKnownResponsesModel(availableModelIds, configuredModel, candidates) {
  const available = new Set(
    Array.from(availableModelIds || [], normalizeModelId).filter(Boolean)
  );
  const knownCandidates = Array.from(candidates || [], normalizeModelId).filter(Boolean);
  const configured = normalizeModelId(configuredModel);
  const configuredIsKnown = knownCandidates.some((candidate) => (
    configured === candidate
      || (configured.startsWith(`${candidate}-`)
        && /^\d{4}-\d{2}-\d{2}$/.test(configured.slice(candidate.length + 1)))
  ));
  if (configuredIsKnown && available.has(configured)) return configured;

  for (const candidate of knownCandidates) {
    if (available.has(candidate)) return candidate;
    const dated = [...available]
      .filter((model) => {
        if (!model.startsWith(`${candidate}-`)) return false;
        const suffix = model.slice(candidate.length + 1);
        return /^\d{4}-\d{2}-\d{2}$/.test(suffix);
      })
      .sort()
      .reverse();
    if (dated.length) return dated[0];
  }
  return '';
}

function createApplicationCreationLiveCorpusModelResolver(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('live corpus model resolver dependency missing: fetchImpl');
  }

  async function resolve(options = {}) {
    const policy = options.policy;
    if (!policy || typeof policy.resolveOfficialProviderDestination !== 'function') {
      throw new Error('live corpus model resolver dependency missing: policy');
    }
    const destination = policy.resolveOfficialProviderDestination({
      providerId: 'openai',
      baseUrl: options.baseUrl,
    });
    const apiKey = String(options.apiKey || '').trim();
    if (!apiKey) {
      throw codedError(
        'LIVE_CORPUS_PROVIDER_CREDENTIAL_MISSING',
        'A credencial do provedor configurado não está disponível.'
      );
    }
    const configuredModel = normalizeModelId(options.configuredModel);
    const candidates = Object.freeze(
      Array.from(options.candidates || DEFAULT_LIVE_CORPUS_MODEL_CANDIDATES, normalizeModelId)
        .filter(Boolean)
    );
    const metrics = options.metrics && typeof options.metrics === 'object'
      ? options.metrics
      : {};
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 30_000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      metrics.requests = (Number(metrics.requests) || 0) + 1;
      metrics.discoveryRequests = (Number(metrics.discoveryRequests) || 0) + 1;
      response = await fetchImpl(`${destination.baseUrl}/models`, {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } catch (error) {
      throw codedError(
        'LIVE_CORPUS_MODEL_DISCOVERY_FAILED',
        error && error.name === 'AbortError'
          ? 'A descoberta de modelos oficiais excedeu o tempo limite.'
          : 'A descoberta de modelos oficiais falhou.'
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response || !response.ok) {
      const status = response && Number(response.status);
      throw codedError(
        'LIVE_CORPUS_MODEL_DISCOVERY_FAILED',
        `A descoberta de modelos oficiais respondeu HTTP ${Number.isFinite(status) ? status : 'desconhecido'}.`
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw codedError(
        'LIVE_CORPUS_MODEL_DISCOVERY_INVALID',
        'A descoberta de modelos oficiais retornou JSON inválido.'
      );
    }
    const availableModelIds = Array.isArray(payload && payload.data)
      ? payload.data.map((entry) => entry && entry.id).filter(Boolean)
      : [];
    const model = selectKnownResponsesModel(
      availableModelIds,
      configuredModel,
      candidates
    );
    if (!model) {
      throw codedError(
        'LIVE_CORPUS_MODEL_UNAVAILABLE',
        'Nenhum modelo conhecido e compatível com Responses/tool calling está disponível na conta configurada.'
      );
    }
    return Object.freeze({
      configuredModel,
      model,
      usedConfiguredModel: Boolean(configuredModel && model === configuredModel),
      providerOrigin: destination.providerOrigin,
    });
  }

  return Object.freeze({ resolve });
}

module.exports = {
  DEFAULT_LIVE_CORPUS_MODEL_CANDIDATES,
  createApplicationCreationLiveCorpusModelResolver,
  normalizeModelId,
  selectKnownResponsesModel,
};
