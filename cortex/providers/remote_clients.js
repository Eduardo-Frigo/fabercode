function normalizeProviderKey(provider) {
  const raw = String(provider || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes('openai') || raw === 'oai') return 'openai';
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

function resolveOpenAiBaseUrl(baseUrl = 'https://api.openai.com/v1') {
  const value = String(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  if (value.endsWith('/chat/completions')) return value.slice(0, -'/chat/completions'.length);
  if (value.endsWith('/responses')) return value.slice(0, -'/responses'.length);
  return value;
}

function shouldUseOpenAiResponsesApi(model = '') {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return false;
  return /\bcodex\b/.test(normalized) || /^gpt-5(?:[.\-]|$)/.test(normalized) || /^o[134](?:[.\-]|$)/.test(normalized);
}

function summarizeOpenAiResponsesShape(data = {}, maxTokens = null) {
  const status = typeof data.status === 'string' && data.status.trim() ? data.status.trim() : '';
  const incompleteReason =
    data.incomplete_details && typeof data.incomplete_details.reason === 'string'
      ? data.incomplete_details.reason.trim()
      : '';
  const output = Array.isArray(data.output) ? data.output : [];
  const outputTypes = output
    .map((item) => String((item && item.type) || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const parts = [];
  if (status) parts.push(`status=${status}`);
  if (incompleteReason) parts.push(`reason=${incompleteReason}`);
  if (outputTypes.length) parts.push(`output=${outputTypes.join(',')}`);
  if (Number.isFinite(Number(maxTokens))) parts.push(`max_output_tokens=${Number(maxTokens)}`);
  return parts.join('; ');
}

function resolveOpenAiResponsesReasoningEffort(model = '', requestOptions = {}) {
  const normalizedModel = String(model || '').toLowerCase();
  const isCodexModel = /\bcodex\b/.test(normalizedModel);
  const normalizeEffortForModel = (value) => {
    const effort = String(value || '').trim().toLowerCase();
    if (!effort) return '';
    if (isCodexModel && effort === 'none') {
      return 'low';
    }
    if (isCodexModel && effort === 'minimal') return 'low';
    return effort;
  };
  const explicit =
    requestOptions && requestOptions.reasoning && requestOptions.reasoning.effort
      ? String(requestOptions.reasoning.effort).trim()
      : requestOptions && requestOptions.options && requestOptions.options.reasoning_effort
        ? String(requestOptions.options.reasoning_effort).trim()
        : '';
  if (explicit) return normalizeEffortForModel(explicit);

  if (isCodexModel) return 'low';
  if (/gpt-5-pro/.test(normalizedModel)) return 'high';
  if (/gpt-5\.1/.test(normalizedModel)) return 'low';
  if (/gpt-5|o[134]/.test(normalizedModel)) return 'minimal';
  return '';
}

function resolveOpenAiTextFormat(requestOptions = {}) {
  const options = requestOptions && requestOptions.options && typeof requestOptions.options === 'object'
    ? requestOptions.options
    : {};
  const format =
    requestOptions.responseFormat ||
    requestOptions.response_format ||
    requestOptions.textFormat ||
    requestOptions.text_format ||
    options.responseFormat ||
    options.response_format ||
    options.textFormat ||
    options.text_format ||
    null;
  return format && typeof format === 'object' && !Array.isArray(format) ? format : null;
}

function resolveOpenAiTextVerbosity(requestOptions = {}, model = '') {
  const options = requestOptions && requestOptions.options && typeof requestOptions.options === 'object'
    ? requestOptions.options
    : {};
  const raw =
    requestOptions.textVerbosity ||
    requestOptions.text_verbosity ||
    options.textVerbosity ||
    options.text_verbosity ||
    '';
  const value = String(raw || '').trim().toLowerCase();
  if (!['low', 'medium', 'high'].includes(value)) return '';
  const normalizedModel = String(model || '').toLowerCase();
  if (/\bcodex\b/.test(normalizedModel)) return 'medium';
  return value;
}

function buildOpenAiResponsesTextConfig(requestOptions = {}, model = '') {
  const format = resolveOpenAiTextFormat(requestOptions);
  const verbosity = resolveOpenAiTextVerbosity(requestOptions, model);
  const text = {};
  if (format) text.format = format;
  if (verbosity) text.verbosity = verbosity;
  return Object.keys(text).length ? text : null;
}

function normalizeMessagesForOpenAiResponses(messages = []) {
  const normalizedMessages = normalizeChatMessagesForCompletion(messages);
  const instructions = normalizedMessages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
    .trim();
  const inputMessages = normalizedMessages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }));

  return {
    instructions,
    input: inputMessages.length === 1 && inputMessages[0].role === 'user'
      ? inputMessages[0].content
      : inputMessages,
  };
}

function extractOpenAiResponsesText(data = {}) {
  const directText = typeof data.output_text === 'string' ? data.output_text.trim() : '';
  if (directText) return directText;

  function collectTextFragments(value, fragments = []) {
    if (!value) return fragments;
    if (typeof value === 'string') {
      fragments.push(value);
      return fragments;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectTextFragments(item, fragments));
      return fragments;
    }
    if (typeof value !== 'object') return fragments;

    if (typeof value.output_text === 'string') fragments.push(value.output_text);
    if (typeof value.text === 'string') {
      fragments.push(value.text);
    } else if (value.text && typeof value.text.value === 'string') {
      fragments.push(value.text.value);
    }
    if (typeof value.content === 'string') {
      fragments.push(value.content);
    } else if (Array.isArray(value.content)) {
      collectTextFragments(value.content, fragments);
    }
    return fragments;
  }

  const output = Array.isArray(data.output) ? data.output : [];
  const text = collectTextFragments(output, [])
    .filter(Boolean)
    .join('\n')
    .trim();
  return text;
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

function normalizeProviderQueueKey(provider) {
  const normalized = normalizeProviderKey(provider);
  if (normalized) return normalized;
  const raw = String(provider || '').trim().toLowerCase();
  return raw || 'custom';
}

function createRemoteProviderClients(dependencies = {}) {
  const {
    AI_REQUEST_TIMEOUT_MS = 420000,
    GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta',
    GEMINI_MIN_REQUEST_INTERVAL_MS = 0,
    OPENAI_API_BASE_URL = 'https://api.openai.com/v1',
    OPENAI_MIN_REQUEST_INTERVAL_MS = 0,
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
    getEffectiveOpenAiApiKey = () => '',
    getEffectiveOpenAiModel = () => '',
    getEffectiveSambaNovaApiKey,
    getEffectiveSambaNovaModel,
    getSelectedCustomApiProfile,
    nowMs = () => Date.now(),
    resolveCustomApiEndpoint,
    resolveCustomProviderKind,
    sanitizeOpenAiModelName = (value) => String(value || '').replace(/\s+/g, ''),
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
  let lastOpenAiRequestAtMs = 0;
  let lastSambaNovaRequestAtMs = 0;
  const providerRequestQueues = new Map();

  async function withProviderRequestQueue(provider, task) {
    const key = normalizeProviderQueueKey(provider);
    const previous = providerRequestQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const idleTail = current.catch(() => undefined);
    providerRequestQueues.set(key, idleTail);
    try {
      return await current;
    } finally {
      if (providerRequestQueues.get(key) === idleTail) {
        providerRequestQueues.delete(key);
      }
    }
  }

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

  async function throttleOpenAiRequest() {
    await enforceProviderCooldown('openai');
    const elapsedSinceLastCall = nowMs() - lastOpenAiRequestAtMs;
    const minInterval = Math.max(0, Number(OPENAI_MIN_REQUEST_INTERVAL_MS) || 0);
    if (minInterval > 0 && elapsedSinceLastCall < minInterval) {
      await delayMs(minInterval - elapsedSinceLastCall);
    }
    await enforceProviderRequestsPerMinute('openai');
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

    return withProviderRequestQueue(providerKey || providerLabel, async () => {
      if (providerKey === 'sambanova') {
        await throttleSambaNovaRequest();
      } else if (providerKey === 'openai') {
        await throttleOpenAiRequest();
      } else {
        await enforceProviderCooldown(providerKey);
      }

      const controller = new abortController();
      const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
      const providerMaxTokens = providerKey === 'openai' ? 8192 : 4096;
      const maxTokens = resolveNumPredict(requestOptions, { fallback: 256, min: 32, max: providerMaxTokens });

      try {
        if (providerKey === 'sambanova') {
          lastSambaNovaRequestAtMs = nowMs();
        } else if (providerKey === 'openai') {
          lastOpenAiRequestAtMs = nowMs();
        }
        const requestBody = {
          model: String(model).trim(),
          messages: normalizedMessages,
          temperature: Number.isFinite(RWKV_TEMPERATURE) ? RWKV_TEMPERATURE : 0.2,
          top_p: Number.isFinite(RWKV_TOP_P) ? RWKV_TOP_P : 0.9,
          max_tokens: maxTokens,
        };
        const responseFormat = providerKey === 'openai' ? resolveOpenAiTextFormat(requestOptions) : null;
        if (responseFormat) requestBody.response_format = responseFormat;

        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
          },
          body: JSON.stringify(requestBody),
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
    });
  }

  async function callOpenAiResponses({
    endpoint,
    apiKey,
    model,
    messages,
    timeoutMs = AI_REQUEST_TIMEOUT_MS,
    requestOptions = {},
    providerLabel = 'OpenAI',
  }) {
    assertReady();
    if (!endpoint) throw new Error(`${providerLabel} endpoint_unconfigured: informe um endpoint válido.`);
    if (!apiKey) throw new Error(`${providerLabel} api_key_missing: configure a API key.`);
    if (!model) throw new Error(`${providerLabel} model_unconfigured: configure um modelo válido.`);

    const normalizedMessages = normalizeChatMessagesForCompletion(messages);
    if (!normalizedMessages.length) throw new Error(`Prompt vazio para ${providerLabel}.`);

    return withProviderRequestQueue('openai', async () => {
      await throttleOpenAiRequest();

      const controller = new abortController();
      const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
      const maxTokens = resolveNumPredict(requestOptions, { fallback: 4096, min: 4096, max: 65536 });
      const responseInput = normalizeMessagesForOpenAiResponses(normalizedMessages);
      const body = {
        model: String(model).trim(),
        input: responseInput.input,
        max_output_tokens: maxTokens,
      };
      if (responseInput.instructions) body.instructions = responseInput.instructions;
      const reasoningEffort = resolveOpenAiResponsesReasoningEffort(model, requestOptions);
      if (reasoningEffort) body.reasoning = { effort: reasoningEffort };
      const textConfig = buildOpenAiResponsesTextConfig(requestOptions, model);
      if (textConfig) body.text = textConfig;

      try {
        lastOpenAiRequestAtMs = nowMs();
        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryAfter = response.headers.get('retry-after');
          const responseBody = await response.text().catch(() => '');
          const clipped = String(responseBody || '').replace(/\s+/g, ' ').slice(0, 260);
          const retryAfterText = retryAfter ? ' (retry-after:' + retryAfter + ')' : '';
          const reason = `${providerLabel} HTTP ${response.status}${retryAfterText}${clipped ? ': ' + clipped : ''}`;
          applyProviderCooldownFromReason('openai', reason, 1);
          throw new Error(reason);
        }

        const data = await response.json();
        const text = extractOpenAiResponsesText(data);
        if (!text) {
          const responseShape = summarizeOpenAiResponsesShape(data, maxTokens);
          throw new Error(
            `${providerLabel} não retornou texto gerado${responseShape ? ' (' + responseShape + ')' : ''}.`
          );
        }
        clearProviderCooldown('openai');
        return text;
      } catch (error) {
        applyProviderCooldownFromReason('openai', error && error.message ? error.message : String(error || ''), 1);
        throw error;
      } finally {
        clearTimeoutFn(timeout);
      }
    });
  }

  async function callGeminiChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
    assertReady();
    const geminiApiKey = getEffectiveGeminiApiKey();
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY não configurada para uso da API Gemini.');
    }

    const prompt = buildGeminiPromptFromMessages(messages);
    if (!prompt) throw new Error('Prompt vazio para Gemini.');

    return withProviderRequestQueue('gemini', async () => {
      await throttleGeminiRequest();
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
    });
  }

  async function callSambaNovaChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
    assertReady();
    const apiKey = getEffectiveSambaNovaApiKey();

    if (!apiKey) {
      throw new Error('SAMBANOVA_API_KEY não configurada para uso da API SambaNova.');
    }

    const normalizedMessages = normalizeChatMessagesForCompletion(messages);
    if (!normalizedMessages.length) throw new Error('Prompt vazio para SambaNova.');

    const effectiveModel = sanitizeSambaNovaModelName(model || getEffectiveSambaNovaModel());
    if (!effectiveModel) {
      throw new Error('SambaNova model_unconfigured: defina um modelo válido nas Configurações de IA.');
    }

    return withProviderRequestQueue('sambanova', async () => {
      await throttleSambaNovaRequest();
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
    });
  }

  async function callOpenAiChat(model, messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
    assertReady();
    const apiKey = getEffectiveOpenAiApiKey();
    const effectiveModel = sanitizeOpenAiModelName(model || getEffectiveOpenAiModel());
    const baseUrl = resolveOpenAiBaseUrl(OPENAI_API_BASE_URL);

    if (shouldUseOpenAiResponsesApi(effectiveModel)) {
      const responsesEndpoint = baseUrl.endsWith('/responses') ? baseUrl : baseUrl + '/responses';
      return callOpenAiResponses({
        endpoint: responsesEndpoint,
        apiKey,
        model: effectiveModel,
        messages,
        timeoutMs,
        requestOptions,
        providerLabel: 'OpenAI',
      });
    }

    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

    return callOpenAiCompatibleChat({
      endpoint,
      apiKey,
      model: effectiveModel,
      messages,
      timeoutMs,
      requestOptions,
      providerLabel: 'OpenAI',
    });
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
    callOpenAiChat,
    callOpenAiCompatibleChat,
    callSambaNovaChat,
    normalizeChatMessagesForCompletion,
  };
}

module.exports = {
    buildGeminiPromptFromMessages,
    createRemoteProviderClients,
    extractOpenAiResponsesText,
    normalizeChatMessagesForCompletion,
    normalizeMessagesForOpenAiResponses,
    normalizeProviderKey,
    resolveOpenAiBaseUrl,
    resolveOpenAiTextFormat,
    resolveOpenAiTextVerbosity,
    resolveNumPredict,
    shouldUseOpenAiResponsesApi,
    summarizeOpenAiResponsesShape,
  };
