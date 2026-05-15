function normalizeProviderKey(provider) {
  const raw = String(provider || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes('sambanova')) return 'sambanova';
  if (raw.includes('gemini') || raw.includes('google')) return 'gemini';
  return null;
}

function normalizeChatMessagesForCompletion(messages = []) {
  return Array.isArray(messages)
    ? messages
        .map((msg) => {
          const role = String((msg && msg.role) || 'user').trim().toLowerCase();
          const content = String((msg && msg.content) || '').trim();
          if (!content) return null;
          return {
            role: role === 'assistant' || role === 'system' ? role : 'user',
            content,
          };
        })
        .filter(Boolean)
    : [];
}

function buildGeminiPromptFromMessages(messages = []) {
  return (messages || [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const role = String(entry.role || 'user').toUpperCase();
      const content = String(entry.content || '').trim();
      if (!content) return '';
      return '[' + role + ']\n' + content;
    })
    .filter(Boolean)
    .join('\n');
}

function resolveNumPredict(requestOptions = {}, { fallback = 256, min = 32, max = 4096 } = {}) {
  const direct = requestOptions && requestOptions.options
    ? Number(requestOptions.options.num_predict)
    : NaN;
  const fromBudget = requestOptions && requestOptions.runtimeBudget && requestOptions.runtimeBudget.generationOptions
    ? Number(requestOptions.runtimeBudget.generationOptions.num_predict)
    : NaN;
  const raw = Number.isFinite(direct) ? direct : Number.isFinite(fromBudget) ? fromBudget : fallback;
  return Math.max(min, Math.min(max, raw));
}

function createRemoteProviderClients(dependencies = {}) {
  const {
    AI_REQUEST_TIMEOUT_MS = 420000,
    GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta',
    GEMINI_MIN_REQUEST_INTERVAL_MS = 0,
    RWKV_TEMPERATURE = 0.2,
    RWKV_TOP_P = 0.9,
    SAMBANOVA_API_BASE_URL = 'https://api.sambanova.ai/v1',
    SAMBANOVA_MIN_REQUEST_INTERVAL_MS = 0,
    abortController = globalThis.AbortController,
    applyProviderCooldownFromReason = () => {},
    clearProviderCooldown = () => {},
    clearTimeoutFn = clearTimeout,
    delayMs = () => Promise.resolve(),
    enforceProviderCooldown = () => Promise.resolve(),
    enforceProviderRequestsPerMinute = () => Promise.resolve(),
    fetchFn = globalThis.fetch,
    getEffectiveGeminiApiKey,
    getEffectiveGeminiModel,
    getEffectiveSambaNovaApiKey,
    getEffectiveSambaNovaModel,
    getSelectedCustomApiProfile,
    nowMs = () => Date.now(),
    resolveCustomApiEndpoint,
    resolveCustomProviderKind,
    sanitizeSambaNovaModelName,
    setTimeoutFn = setTimeout,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Remote provider client dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('abortController', abortController);
    requireDependency('fetchFn', fetchFn);
    requireDependency('getEffectiveGeminiApiKey', getEffectiveGeminiApiKey);
    requireDependency('getEffectiveGeminiModel', getEffectiveGeminiModel);
    requireDependency('getEffectiveSambaNovaApiKey', getEffectiveSambaNovaApiKey);
    requireDependency('getEffectiveSambaNovaModel', getEffectiveSambaNovaModel);
    requireDependency('getSelectedCustomApiProfile', getSelectedCustomApiProfile);
    requireDependency('resolveCustomApiEndpoint', resolveCustomApiEndpoint);
    requireDependency('resolveCustomProviderKind', resolveCustomProviderKind);
    requireDependency('sanitizeSambaNovaModelName', sanitizeSambaNovaModelName);
  }

  let lastGeminiRequestAtMs = 0;
  let lastSambaNovaRequestAtMs = 0;

  async function throttleGeminiRequest() {
    await enforceProviderCooldown('gemini');
    const elapsedSinceLastCall = nowMs() - lastGeminiRequestAtMs;
    const minInterval = Math.max(0, Number(GEMINI_MIN_REQUEST_INTERVAL_MS) || 0);
    if (minInterval > 0 && elapsedSinceLastCall < minInterval) {
      await delayMs(minInterval - elapsedSinceLastCall);
    }
    await enforceProviderRequestsPerMinute('gemini');
  }

  async function throttleSambaNovaRequest() {
    await enforceProviderCooldown('sambanova');
    const elapsedSinceLastCall = nowMs() - lastSambaNovaRequestAtMs;
    const minInterval = Math.max(0, Number(SAMBANOVA_MIN_REQUEST_INTERVAL_MS) || 0);
    if (minInterval > 0 && elapsedSinceLastCall < minInterval) {
      await delayMs(minInterval - elapsedSinceLastCall);
    }
    await enforceProviderRequestsPerMinute('sambanova');
  }

  async function callOpenAiCompatibleChat({
    endpoint,
    apiKey,
    model,
    messages,
    timeoutMs = AI_REQUEST_TIMEOUT_MS,
    requestOptions = {},
    providerLabel = 'API',
  }) {
    assertReady();
    if (!endpoint) throw new Error(`${providerLabel} endpoint_unconfigured: informe um endpoint válido.`);
    if (!apiKey) throw new Error(`${providerLabel} api_key_missing: configure a API key.`);
    if (!model) throw new Error(`${providerLabel} model_unconfigured: configure um modelo válido.`);

    const normalizedMessages = normalizeChatMessagesForCompletion(messages);
    if (!normalizedMessages.length) throw new Error(`Prompt vazio para ${providerLabel}.`);
    const providerKey = normalizeProviderKey(providerLabel);

    if (providerKey === 'sambanova') {
      await throttleSambaNovaRequest();
    } else {
      await enforceProviderCooldown(providerKey);
    }

    const controller = new abortController();
    const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
    const maxTokens = resolveNumPredict(requestOptions, { fallback: 256, min: 32, max: 4096 });

    try {
      if (providerKey === 'sambanova') {
        lastSambaNovaRequestAtMs = nowMs();
      }
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: String(model).trim(),
          messages: normalizedMessages,
          temperature: Number.isFinite(RWKV_TEMPERATURE) ? RWKV_TEMPERATURE : 0.2,
          top_p: Number.isFinite(RWKV_TOP_P) ? RWKV_TOP_P : 0.9,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const body = await response.text().catch(() => '');
        const clipped = String(body || '').replace(/\s+/g, ' ').slice(0, 260);
        const retryAfterText = retryAfter ? ' (retry-after:' + retryAfter + ')' : '';
        const reason = `${providerLabel} HTTP ${response.status}${retryAfterText}${clipped ? ': ' + clipped : ''}`;
        applyProviderCooldownFromReason(providerKey, reason, 1);
        throw new Error(reason);
      }

      const data = await response.json();
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const first = choices[0] || null;
      const content = first && first.message ? first.message.content : '';
      const text =
        typeof content === 'string'
          ? content.trim()
          : Array.isArray(content)
            ? content
                .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
                .filter(Boolean)
                .join('\n')
                .trim()
            : '';

      if (!text) throw new Error(`${providerLabel} não retornou texto gerado.`);
      clearProviderCooldown(providerKey);
      return text;
    } catch (error) {
      applyProviderCooldownFromReason(providerKey, error && error.message ? error.message : String(error || ''), 1);
      throw error;
    } finally {
      clearTimeoutFn(timeout);
    }
  }

  async function callGeminiChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
    assertReady();
    const geminiApiKey = getEffectiveGeminiApiKey();
    await throttleGeminiRequest();
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY não configurada para uso da API Gemini.');
    }

    const prompt = buildGeminiPromptFromMessages(messages);
    if (!prompt) throw new Error('Prompt vazio para Gemini.');

    const controller = new abortController();
    const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
    const maxOutputTokens = resolveNumPredict(requestOptions, { fallback: 256, min: 32, max: 2048 });

    try {
      const endpoint =
        GEMINI_API_BASE_URL + '/models/' + encodeURIComponent(model || getEffectiveGeminiModel()) + ':generateContent?key=' + encodeURIComponent(geminiApiKey);

      lastGeminiRequestAtMs = nowMs();
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: Number.isFinite(RWKV_TEMPERATURE) ? RWKV_TEMPERATURE : 0.2,
            topP: Number.isFinite(RWKV_TOP_P) ? RWKV_TOP_P : 0.9,
            maxOutputTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const body = await response.text().catch(() => '');
        const clipped = String(body || '').replace(/\s+/g, ' ').slice(0, 220);
        const retryAfterText = retryAfter ? ' (retry-after:' + retryAfter + ')' : '';
        const reason = 'Gemini HTTP ' + response.status + retryAfterText + (clipped ? ': ' + clipped : '');
        applyProviderCooldownFromReason('gemini', reason, 1);
        throw new Error(reason);
      }

      const data = await response.json();
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const first = candidates[0] || null;
      const parts = first && first.content && Array.isArray(first.content.parts) ? first.content.parts : [];
      const text = parts
        .map((part) => String((part && part.text) || '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();

      if (!text) throw new Error('Gemini não retornou texto gerado.');
      clearProviderCooldown('gemini');
      return text;
    } catch (error) {
      applyProviderCooldownFromReason('gemini', error && error.message ? error.message : String(error || ''), 1);
      throw error;
    } finally {
      clearTimeoutFn(timeout);
    }
  }

  async function callSambaNovaChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
    assertReady();
    const apiKey = getEffectiveSambaNovaApiKey();
    await throttleSambaNovaRequest();

    if (!apiKey) {
      throw new Error('SAMBANOVA_API_KEY não configurada para uso da API SambaNova.');
    }

    const normalizedMessages = normalizeChatMessagesForCompletion(messages);
    if (!normalizedMessages.length) throw new Error('Prompt vazio para SambaNova.');

    const effectiveModel = sanitizeSambaNovaModelName(model || getEffectiveSambaNovaModel());
    if (!effectiveModel) {
      throw new Error('SambaNova model_unconfigured: defina um modelo válido nas Configurações de IA.');
    }

    const controller = new abortController();
    const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
    const maxTokens = resolveNumPredict(requestOptions, { fallback: 256, min: 32, max: 4096 });

    try {
      const baseUrl = String(SAMBANOVA_API_BASE_URL || 'https://api.sambanova.ai/v1').replace(/\/$/, '');
      const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

      lastSambaNovaRequestAtMs = nowMs();
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: effectiveModel,
          messages: normalizedMessages,
          temperature: Number.isFinite(RWKV_TEMPERATURE) ? RWKV_TEMPERATURE : 0.2,
          top_p: Number.isFinite(RWKV_TOP_P) ? RWKV_TOP_P : 0.9,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const body = await response.text().catch(() => '');
        const clipped = String(body || '').replace(/\s+/g, ' ').slice(0, 220);
        const retryAfterText = retryAfter ? ' (retry-after:' + retryAfter + ')' : '';
        const reason = 'SambaNova HTTP ' + response.status + retryAfterText + (clipped ? ': ' + clipped : '');
        applyProviderCooldownFromReason('sambanova', reason, 1);
        throw new Error(reason);
      }

      const data = await response.json();
      const choices = Array.isArray(data.choices) ? data.choices : [];
      const first = choices[0] || null;
      const content = first && first.message ? first.message.content : '';
      const text =
        typeof content === 'string'
          ? content.trim()
          : Array.isArray(content)
            ? content
                .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
                .filter(Boolean)
                .join('\n')
                .trim()
            : '';

      if (!text) throw new Error('SambaNova não retornou texto gerado.');
      clearProviderCooldown('sambanova');
      return text;
    } catch (error) {
      applyProviderCooldownFromReason('sambanova', error && error.message ? error.message : String(error || ''), 1);
      throw error;
    } finally {
      clearTimeoutFn(timeout);
    }
  }

  async function callCustomProviderChat(selectedProvider, model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
    assertReady();
    const profile = getSelectedCustomApiProfile(selectedProvider);
    if (!profile) {
      throw new Error('custom_api_profile_missing: perfil custom selecionado não encontrado.');
    }

    const providerKind = resolveCustomProviderKind(profile.providerName || '');
    const customModel = String(profile.model || model || '').trim();
    const customApiKey = String(profile.apiKey || '').trim();

    if (providerKind === 'gemini') {
      if (!customApiKey) throw new Error('Gemini API key não configurada no perfil custom.');
      const endpoint =
        GEMINI_API_BASE_URL + '/models/' + encodeURIComponent(customModel || getEffectiveGeminiModel()) + ':generateContent?key=' + encodeURIComponent(customApiKey);
      const prompt = buildGeminiPromptFromMessages(messages);
      if (!prompt) throw new Error('Prompt vazio para Gemini custom.');

      const controller = new abortController();
      const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
      const maxOutputTokens = resolveNumPredict(requestOptions, { fallback: 256, min: 32, max: 2048 });

      try {
        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: Number.isFinite(RWKV_TEMPERATURE) ? RWKV_TEMPERATURE : 0.2,
              topP: Number.isFinite(RWKV_TOP_P) ? RWKV_TOP_P : 0.9,
              maxOutputTokens,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryAfter = response.headers.get('retry-after');
          const body = await response.text().catch(() => '');
          const clipped = String(body || '').replace(/\s+/g, ' ').slice(0, 220);
          const retryAfterText = retryAfter ? ' (retry-after:' + retryAfter + ')' : '';
          throw new Error('Gemini HTTP ' + response.status + retryAfterText + (clipped ? ': ' + clipped : ''));
        }

        const data = await response.json();
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        const first = candidates[0] || null;
        const parts = first && first.content && Array.isArray(first.content.parts) ? first.content.parts : [];
        const text = parts
          .map((part) => String((part && part.text) || '').trim())
          .filter(Boolean)
          .join('\n')
          .trim();
        if (!text) throw new Error('Gemini custom não retornou texto gerado.');
        return text;
      } finally {
        clearTimeoutFn(timeout);
      }
    }

    if (providerKind === 'sambanova') {
      const effectiveModel = sanitizeSambaNovaModelName(customModel || getEffectiveSambaNovaModel());
      return callOpenAiCompatibleChat({
        endpoint: String(SAMBANOVA_API_BASE_URL || 'https://api.sambanova.ai/v1').replace(/\/$/, '') + '/chat/completions',
        apiKey: customApiKey,
        model: effectiveModel,
        messages,
        timeoutMs,
        requestOptions,
        providerLabel: 'SambaNova',
      });
    }

    if (providerKind === 'openai' || providerKind === 'deepseek' || providerKind === 'custom') {
      const endpoint = resolveCustomApiEndpoint(profile);
      const label = providerKind === 'openai' ? 'OpenAI' : providerKind === 'deepseek' ? 'DeepSeek' : (String(profile.providerName || 'Custom API').trim() || 'Custom API');
      return callOpenAiCompatibleChat({
        endpoint,
        apiKey: customApiKey,
        model: customModel,
        messages,
        timeoutMs,
        requestOptions,
        providerLabel: label,
      });
    }

    throw new Error('custom_api_provider_unsupported: provedor custom não suportado neste perfil.');
  }

  return {
    buildGeminiPromptFromMessages,
    callCustomProviderChat,
    callGeminiChat,
    callOpenAiCompatibleChat,
    callSambaNovaChat,
    normalizeChatMessagesForCompletion,
  };
}

module.exports = {
  buildGeminiPromptFromMessages,
  createRemoteProviderClients,
  normalizeChatMessagesForCompletion,
  normalizeProviderKey,
  resolveNumPredict,
};
