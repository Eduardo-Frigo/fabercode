const {
  normalizeProviderFailure,
  toProviderFailureError,
} = require('./provider_failure_service');

function createProviderRegistry(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    callCustomProviderChat,
    callGeminiChat,
    callMockPersonaProviderChat,
    callOpenAiChat,
    callRwkvProviderChat,
    callSambaNovaChat,
    getEffectiveGeminiModel = () => '',
    getEffectiveOpenAiModel = () => '',
    getEffectiveSambaNovaModel = () => '',
    getSelectedAiProvider = () => 'rwkv',
    rwkvEnabled = true,
  } = dependencies;

  async function withAudit(provider, handler) {
    try {
      return await handler();
    } catch (error) {
      const wrappedError = toProviderFailureError(provider, error);
      const failure = normalizeProviderFailure(wrappedError, provider);
      appendAuditEvent('ai.provider_error', {
        provider,
        code: failure.code,
        category: failure.category,
        retryable: failure.retryable,
        httpStatus: failure.httpStatus,
        message: failure.technicalMessage,
      });
      throw wrappedError;
    }
  }

  async function chat(model, messages, timeoutMs, requestOptions = {}) {
    const selectedProvider = getSelectedAiProvider();

    if (selectedProvider === 'mock') {
      return withAudit('mock', () => callMockPersonaProviderChat(messages, timeoutMs, requestOptions));
    }

    if (selectedProvider === 'gemini') {
      return withAudit('gemini', () =>
        callGeminiChat(getEffectiveGeminiModel() || model, messages, timeoutMs, requestOptions)
      );
    }

    if (selectedProvider === 'openai') {
      return withAudit('openai', () => {
        if (typeof callOpenAiChat !== 'function') {
          throw new Error('openai_provider_missing: provedor OpenAI sem handler registrado.');
        }
        return callOpenAiChat(getEffectiveOpenAiModel() || model, messages, timeoutMs, requestOptions);
      });
    }

    if (selectedProvider === 'sambanova') {
      return withAudit('sambanova', () =>
        callSambaNovaChat(getEffectiveSambaNovaModel() || model, messages, timeoutMs, requestOptions)
      );
    }

    if (String(selectedProvider).startsWith('custom:')) {
      return withAudit(selectedProvider, () => {
        if (typeof callCustomProviderChat !== 'function') {
          throw new Error('custom_api_registry_missing: provider custom sem handler registrado.');
        }
        return callCustomProviderChat(selectedProvider, model, messages, timeoutMs, requestOptions);
      });
    }

    if (!rwkvEnabled) {
      return withAudit('rwkv', () => {
        throw new Error('RWKV está desativado e o provedor local selecionado exige RWKV ativo.');
      });
    }

    return withAudit('rwkv', () => callRwkvProviderChat(messages, timeoutMs, requestOptions));
  }

  return { chat };
}

module.exports = {
  createProviderRegistry,
};
