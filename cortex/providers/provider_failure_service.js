const PROVIDER_FAILURE_SCHEMA_VERSION = 'provider-failure-v1';

function clipProviderFailureText(value = '', max = 800) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function normalizeProviderLabel(provider = '') {
  const value = String(provider || '').trim();
  const normalized = value.toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.startsWith('custom:')) return normalized;
  if (normalized.includes('openai') || normalized === 'oai') return 'openai';
  if (normalized.includes('gemini') || normalized.includes('google')) return 'gemini';
  if (normalized.includes('sambanova') || normalized.includes('samba')) return 'sambanova';
  if (normalized.includes('rwkv') || normalized === 'local') return 'rwkv';
  if (normalized.includes('mock')) return 'mock';
  return normalized;
}

function getErrorMessage(error = null) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error.aiProviderFailure && error.aiProviderFailure.technicalMessage) {
    return error.aiProviderFailure.technicalMessage;
  }
  if (error.providerFailure && error.providerFailure.technicalMessage) {
    return error.providerFailure.technicalMessage;
  }
  if (error.message) return String(error.message);
  return String(error || '');
}

function inferHttpStatus(message = '') {
  const match = String(message || '').match(/\bHTTP\s+(\d{3})\b|\bstatus\s+(\d{3})\b|\b(4\d{2}|5\d{2})\b/i);
  if (!match) return null;
  const value = Number(match[1] || match[2] || match[3]);
  return Number.isFinite(value) ? value : null;
}

function classifyProviderFailure(error = null, fallbackProvider = '') {
  if (error && error.aiProviderFailure && typeof error.aiProviderFailure === 'object') {
    return {
      code: error.aiProviderFailure.code || 'provider_error',
      category: error.aiProviderFailure.category || 'unknown',
      retryable: Boolean(error.aiProviderFailure.retryable),
      httpStatus: error.aiProviderFailure.httpStatus || null,
    };
  }

  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();
  const provider = normalizeProviderLabel(fallbackProvider);
  const httpStatus = inferHttpStatus(message);

  if (/api[_\s-]?key.*missing|key.*missing|sem chave|nao configurad|não configurad/.test(normalized)) {
    return { code: `${provider}_api_key_missing`, category: 'configuration', retryable: false, httpStatus };
  }
  if (/endpoint.*unconfigured|endpoint.*missing|sem endpoint|endpoint valido|endpoint válido/.test(normalized)) {
    return { code: `${provider}_endpoint_missing`, category: 'configuration', retryable: false, httpStatus };
  }
  if (/model.*unconfigured|model.*missing|modelo.*configur|modelo.*valido|modelo.*válido/.test(normalized)) {
    return { code: `${provider}_model_missing`, category: 'configuration', retryable: false, httpStatus };
  }
  if (/401|403|unauthorized|forbidden|invalid api key|invalid_api_key|permission|permiss[aã]o|sem permiss/.test(normalized)) {
    return { code: `${provider}_auth_failed`, category: 'auth', retryable: false, httpStatus };
  }
  if (/429|rate.?limit|too many requests|quota|insufficient_quota|retry-after/.test(normalized)) {
    return { code: `${provider}_rate_limited`, category: 'rate_limit', retryable: true, httpStatus };
  }
  if (/timeout|timed\s*out|timedout|aborted|aborterror|abort|tempo limite|sigterm|sigkill/.test(normalized)) {
    return { code: `${provider}_timeout`, category: 'timeout', retryable: true, httpStatus };
  }
  if (/econnrefused|enotfound|etimedout|econnreset|network|fetch failed|socket|dns|getaddrinfo/.test(normalized)) {
    return { code: `${provider}_network_error`, category: 'network', retryable: true, httpStatus };
  }
  if (httpStatus && httpStatus >= 500) {
    return { code: `${provider}_server_error`, category: 'remote_server', retryable: true, httpStatus };
  }
  if (/status=incomplete|max_output_tokens|output token|limite de saida|limite de saída/.test(normalized)) {
    return { code: `${provider}_output_limit`, category: 'output_limit', retryable: true, httpStatus };
  }
  if (/nao retornou texto gerado|não retornou texto gerado|empty response|blank response|sem texto gerado/.test(normalized)) {
    return { code: `${provider}_empty_response`, category: 'empty_response', retryable: false, httpStatus };
  }
  if (/invalid json|json invalido|json inválido|fora do formato|invalid output|payload invalido|payload inválido/.test(normalized)) {
    return { code: `${provider}_invalid_output`, category: 'invalid_output', retryable: false, httpStatus };
  }
  if (/provider.*missing|handler.*missing|registry.*missing|desativado|disabled/.test(normalized)) {
    return { code: `${provider}_provider_unavailable`, category: 'configuration', retryable: false, httpStatus };
  }

  return { code: `${provider}_provider_error`, category: 'unknown', retryable: false, httpStatus };
}

function buildProviderFailureUserMessage(failure = {}) {
  const provider = normalizeProviderLabel(failure.provider || '');
  const display = provider === 'openai'
    ? 'OpenAI'
    : provider === 'gemini'
      ? 'Gemini'
      : provider === 'sambanova'
        ? 'SambaNova'
        : provider === 'rwkv'
          ? 'RWKV Local'
          : provider.startsWith('custom:')
            ? 'API custom'
            : 'provedor selecionado';

  if (failure.category === 'configuration') {
    return `${display} não está pronto para esta chamada. Revise chave, modelo ou endpoint nas configurações de IA.`;
  }
  if (failure.category === 'auth') {
    return `${display} recusou a conexão. A chave pode estar inválida, revogada ou sem permissão para o modelo selecionado.`;
  }
  if (failure.category === 'rate_limit') {
    return `${display} recusou a conexão por limite de uso. Aguarde a janela liberar ou troque de provedor.`;
  }
  if (failure.category === 'timeout' || failure.category === 'network') {
    return `${display} não concluiu a resposta nesta tentativa. Não iniciei execução falsa; tente novamente ou use outro provedor.`;
  }
  if (failure.category === 'output_limit') {
    return `${display} usou todo o limite de saída antes de entregar um plano. A execução foi preservada sem alterar arquivos; tente novamente com um provedor/modelo mais amplo ou reduza o escopo desta rodada.`;
  }
  if (failure.category === 'empty_response' || failure.category === 'invalid_output') {
    return `${display} respondeu sem um plano utilizável. Não iniciei execução nem alterei arquivos.`;
  }
  return `${display} falhou ao responder nesta tentativa. Não iniciei execução falsa nem alterei arquivos.`;
}

function createProviderFailure(provider = '', error = null, overrides = {}) {
  const base = classifyProviderFailure(error, provider);
  const technicalMessage = clipProviderFailureText(
    overrides.technicalMessage || getErrorMessage(error) || overrides.message || base.code,
    1000
  );
  const failure = {
    schemaVersion: PROVIDER_FAILURE_SCHEMA_VERSION,
    ok: false,
    providerUnavailable: true,
    controlled: true,
    provider: normalizeProviderLabel(overrides.provider || provider),
    code: overrides.code || base.code,
    category: overrides.category || base.category,
    retryable: Object.prototype.hasOwnProperty.call(overrides, 'retryable')
      ? Boolean(overrides.retryable)
      : Boolean(base.retryable),
    httpStatus: overrides.httpStatus || base.httpStatus || null,
    message: technicalMessage,
    technicalMessage,
    userMessage: overrides.userMessage || '',
    source: overrides.source || 'provider_runtime',
  };
  failure.reason = overrides.reason || `${failure.code}:${technicalMessage}`;
  if (!failure.userMessage) failure.userMessage = buildProviderFailureUserMessage(failure);
  return failure;
}

function normalizeProviderFailure(error = null, fallbackProvider = 'unknown', overrides = {}) {
  if (
    error &&
    typeof error === 'object' &&
    error.schemaVersion === PROVIDER_FAILURE_SCHEMA_VERSION &&
    error.code
  ) {
    return {
      ...error,
      ...overrides,
    };
  }
  if (error && error.aiProviderFailure && typeof error.aiProviderFailure === 'object') {
    return {
      ...createProviderFailure(
        error.aiProviderFailure.provider || fallbackProvider,
        error.aiProviderFailure.technicalMessage || error.aiProviderFailure.message || error,
        error.aiProviderFailure
      ),
      ...overrides,
    };
  }
  if (error && error.providerFailure && typeof error.providerFailure === 'object') {
    return {
      ...createProviderFailure(
        error.providerFailure.provider || fallbackProvider,
        error.providerFailure.technicalMessage || error.providerFailure.message || error,
        error.providerFailure
      ),
      ...overrides,
    };
  }
  return createProviderFailure(fallbackProvider, error, overrides);
}

function toProviderFailureError(provider = '', error = null, overrides = {}) {
  const failure = normalizeProviderFailure(error, provider, overrides);
  const wrapped = error instanceof Error
    ? error
    : new Error(failure.technicalMessage || failure.code);
  wrapped.name = 'AiProviderFailureError';
  wrapped.aiProviderFailure = failure;
  wrapped.providerFailure = failure;
  wrapped.providerUnavailable = true;
  wrapped.retryable = failure.retryable;
  return wrapped;
}

function buildProviderFailureReason(failureOrError = null, prefix = 'provider_error', fallbackProvider = 'unknown') {
  const failure = normalizeProviderFailure(failureOrError, fallbackProvider);
  return `${prefix}:${failure.code}:${failure.technicalMessage}`;
}

module.exports = {
  PROVIDER_FAILURE_SCHEMA_VERSION,
  buildProviderFailureReason,
  buildProviderFailureUserMessage,
  classifyProviderFailure,
  createProviderFailure,
  normalizeProviderFailure,
  normalizeProviderLabel,
  toProviderFailureError,
};
