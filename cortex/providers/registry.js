function createProviderRegistry(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    callCustomProviderChat,
    callGeminiChat,
    callMockPersonaProviderChat,
    callRwkvProviderChat,
    callSambaNovaChat,
    getEffectiveGeminiModel = () => '',
    getEffectiveSambaNovaModel = () => '',
    getSelectedAiProvider = () => 'rwkv',
    rwkvEnabled = true,
  } = dependencies;

  async function withAudit(provider, handler) {
    try {
      return await handler();
    } catch (error) {
      appendAuditEvent('ai.provider_error', {
        provider,
        message: error && error.message ? error.message : String(error || ''),
      });
      throw error;
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

    if (selectedProvider === 'sambanova') {
      return withAudit('sambanova', () =>
        callSambaNovaChat(getEffectiveSambaNovaModel() || model, messages, timeoutMs, requestOptions)
      );
    }

    if (String(selectedProvider).startsWith('custom:')) {
      if (typeof callCustomProviderChat !== 'function') {
        throw new Error('custom_api_registry_missing: provider custom sem handler registrado.');
      }
      return withAudit(selectedProvider, () =>
        callCustomProviderChat(selectedProvider, model, messages, timeoutMs, requestOptions)
      );
    }

    if (!rwkvEnabled) {
      throw new Error('RWKV está desativado e o provedor local selecionado exige RWKV ativo.');
    }

    return withAudit('rwkv', () => callRwkvProviderChat(messages, timeoutMs, requestOptions));
  }

  return { chat };
}

module.exports = {
  createProviderRegistry,
};
