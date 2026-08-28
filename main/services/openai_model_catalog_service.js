'use strict';

const MAX_CATALOG_MODELS = 1_000;
const OFFICIAL_OPENAI_ORIGIN = 'https://api.openai.com';
const OFFICIAL_OPENAI_BASE_PATH = '/v1';

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeModelId(value = '') {
  const model = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(model) ? model : '';
}

function normalizeCatalogModels(rawModels = []) {
  const byId = new Map();
  const list = Array.isArray(rawModels) ? rawModels.slice(0, MAX_CATALOG_MODELS) : [];

  list.forEach((entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const id = normalizeModelId(item.id);
    if (!id) return;
    const createdValue = Number(item.created);
    const created = Number.isFinite(createdValue) && createdValue >= 0
      ? Math.trunc(createdValue)
      : 0;
    const existing = byId.get(id);
    if (existing && existing.created >= created) return;
    const shutdownDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.shutdown_date || ''))
      ? String(item.shutdown_date)
      : null;
    byId.set(id, {
      id,
      created,
      ownedBy: String(item.owned_by || '').trim().slice(0, 160),
      shutdownDate,
    });
  });

  return [...byId.values()].sort((left, right) => (
    right.created - left.created || left.id.localeCompare(right.id)
  ));
}

function resolveOfficialOpenAiBaseUrl(rawBaseUrl = '') {
  let parsed;
  try {
    parsed = new URL(String(rawBaseUrl || '').trim());
  } catch {
    throw codedError(
      'OPENAI_MODEL_CATALOG_DESTINATION_REJECTED',
      'A origem configurada para o catálogo OpenAI é inválida.'
    );
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  if (
    parsed.origin !== OFFICIAL_OPENAI_ORIGIN
    || normalizedPath !== OFFICIAL_OPENAI_BASE_PATH
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw codedError(
      'OPENAI_MODEL_CATALOG_DESTINATION_REJECTED',
      'A descoberta automática é limitada ao endpoint oficial da OpenAI.'
    );
  }
  return {
    baseUrl: OFFICIAL_OPENAI_ORIGIN + OFFICIAL_OPENAI_BASE_PATH,
    providerOrigin: OFFICIAL_OPENAI_ORIGIN,
  };
}

function createOpenAiModelCatalogService(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const AbortControllerImpl = dependencies.abortController || globalThis.AbortController;
  const setTimeoutFn = dependencies.setTimeoutFn || setTimeout;
  const clearTimeoutFn = dependencies.clearTimeoutFn || clearTimeout;

  if (typeof fetchImpl !== 'function') {
    throw new Error('OpenAI model catalog dependency missing: fetchImpl');
  }
  if (typeof AbortControllerImpl !== 'function') {
    throw new Error('OpenAI model catalog dependency missing: abortController');
  }

  async function list(options = {}) {
    const apiKey = String(options.apiKey || '').trim();
    if (!apiKey) {
      throw codedError(
        'OPENAI_MODEL_CATALOG_CREDENTIAL_MISSING',
        'Configure uma chave OpenAI antes de atualizar os modelos disponíveis.'
      );
    }
    const destination = resolveOfficialOpenAiBaseUrl(options.baseUrl);
    const controller = new AbortControllerImpl();
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 15_000);
    const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetchImpl(destination.baseUrl + '/models', {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw codedError(
        error && error.name === 'AbortError'
          ? 'OPENAI_MODEL_CATALOG_TIMEOUT'
          : 'OPENAI_MODEL_CATALOG_REQUEST_FAILED',
        error && error.name === 'AbortError'
          ? 'A atualização dos modelos excedeu o tempo limite.'
          : 'Não foi possível consultar os modelos disponíveis na OpenAI.'
      );
    } finally {
      clearTimeoutFn(timeout);
    }

    if (!response || !response.ok) {
      const status = response && Number(response.status);
      throw codedError(
        'OPENAI_MODEL_CATALOG_REQUEST_FAILED',
        'A OpenAI respondeu HTTP '
          + (Number.isFinite(status) ? status : 'desconhecido')
          + ' ao listar modelos.'
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw codedError(
        'OPENAI_MODEL_CATALOG_INVALID_RESPONSE',
        'A OpenAI retornou uma resposta de catálogo inválida.'
      );
    }
    if (!payload || !Array.isArray(payload.data)) {
      throw codedError(
        'OPENAI_MODEL_CATALOG_INVALID_RESPONSE',
        'A resposta da OpenAI não contém uma lista de modelos.'
      );
    }

    return Object.freeze({
      models: Object.freeze(normalizeCatalogModels(payload.data)),
      providerOrigin: destination.providerOrigin,
    });
  }

  return Object.freeze({ list });
}

module.exports = {
  MAX_CATALOG_MODELS,
  OFFICIAL_OPENAI_ORIGIN,
  createOpenAiModelCatalogService,
  normalizeCatalogModels,
  normalizeModelId,
  resolveOfficialOpenAiBaseUrl,
};
