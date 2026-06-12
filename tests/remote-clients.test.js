const assert = require('assert');

const {
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
} = require('../cortex/providers/remote_clients');

class FakeAbortController {
  constructor() {
    this.signal = {};
    this.aborted = false;
  }

  abort() {
    this.aborted = true;
  }
}

function createResponse({ ok = true, status = 200, json = {}, text = '', retryAfter = '' }) {
  return {
    ok,
    status,
    headers: {
      get: (name) => (String(name || '').toLowerCase() === 'retry-after' ? retryAfter : ''),
    },
    json: async () => json,
    text: async () => text,
  };
}

function createHarness(overrides = {}) {
  const calls = [];
  const responses = [];
  const cooldowns = [];
  const cleared = [];
  const throttled = [];

  const clients = createRemoteProviderClients({
    AI_REQUEST_TIMEOUT_MS: 1000,
    GEMINI_API_BASE_URL: 'https://gemini.test/v1beta',
    GEMINI_MIN_REQUEST_INTERVAL_MS: 0,
    OPENAI_API_BASE_URL: 'https://openai.test/v1',
    OPENAI_MIN_REQUEST_INTERVAL_MS: 0,
    RWKV_TEMPERATURE: 0.2,
    RWKV_TOP_P: 0.9,
    SAMBANOVA_API_BASE_URL: 'https://samba.test/v1',
    SAMBANOVA_MIN_REQUEST_INTERVAL_MS: 0,
    abortController: FakeAbortController,
    applyProviderCooldownFromReason: (provider, reason) => cooldowns.push({ provider, reason }),
    clearProviderCooldown: (provider) => cleared.push(provider),
    clearTimeoutFn: () => {},
    delayMs: async () => {},
    enforceProviderCooldown: async (provider) => throttled.push(['cooldown', provider]),
    enforceProviderRequestsPerMinute: async (provider) => throttled.push(['rpm', provider]),
    fetchFn: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      if (!responses.length) throw new Error('Resposta fake ausente.');
      return responses.shift();
    },
    getEffectiveGeminiApiKey: () => 'gemini-key',
    getEffectiveGeminiModel: () => 'gemini-default',
    getEffectiveOpenAiApiKey: () => 'openai-key',
    getEffectiveOpenAiModel: () => 'gpt-test',
    getEffectiveSambaNovaApiKey: () => 'samba-key',
    getEffectiveSambaNovaModel: () => 'samba-default',
    getSelectedCustomApiProfile: () => ({
      id: 'deep',
      providerName: 'DeepSeek',
      apiKey: 'deep-key',
      model: 'deepseek-chat',
      website: 'https://deep.test/v1/chat/completions',
    }),
    nowMs: () => 1000,
    resolveCustomApiEndpoint: (profile) => profile.website,
    resolveCustomProviderKind: (providerName) => {
      const text = String(providerName || '').toLowerCase();
      if (text.includes('deepseek')) return 'deepseek';
      if (text.includes('openai')) return 'openai';
      if (text.includes('samba')) return 'sambanova';
      if (text.includes('gemini')) return 'gemini';
      return 'custom';
    },
    sanitizeOpenAiModelName: (value) => String(value || '').replace(/\s+/g, ''),
    sanitizeSambaNovaModelName: (value) => String(value || '').replace(/\s+/g, ''),
    setTimeoutFn: () => 1,
    ...overrides,
  });

  return { calls, cleared, clients, cooldowns, responses, throttled };
}

async function run() {
  const flushEventLoop = () => new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(normalizeProviderKey('Google Gemini'), 'gemini');
  assert.strictEqual(normalizeProviderKey('SambaNova'), 'sambanova');
  assert.strictEqual(normalizeProviderKey('OpenAI'), 'openai');
  assert.strictEqual(normalizeProviderKey('DeepSeek'), null);
  assert.strictEqual(resolveOpenAiBaseUrl('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1');
  assert.strictEqual(shouldUseOpenAiResponsesApi('gpt-5-codex'), true);
  assert.strictEqual(shouldUseOpenAiResponsesApi('gpt-5.4-mini'), true);
  assert.strictEqual(shouldUseOpenAiResponsesApi('o3-mini'), true);
  assert.strictEqual(shouldUseOpenAiResponsesApi('gpt-4.1'), false);
  assert.strictEqual(extractOpenAiResponsesText({ output_text: ' Codex OK ' }), 'Codex OK');
  assert.strictEqual(extractOpenAiResponsesText({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: { value: ' Nested Codex OK ' } }] },
    ],
  }), 'Nested Codex OK');
  assert.deepStrictEqual(normalizeMessagesForOpenAiResponses([
    { role: 'system', content: 'S' },
    { role: 'user', content: 'Olá' },
  ]), {
    instructions: 'S',
    input: 'Olá',
  });
  assert.strictEqual(resolveNumPredict({ runtimeBudget: { generationOptions: { num_predict: 1800 } } }), 1800);
  assert.strictEqual(resolveNumPredict({ options: { num_predict: 12 } }), 32);
  assert.deepStrictEqual(resolveOpenAiTextFormat({ options: { response_format: { type: 'json_schema', name: 'plan' } } }), {
    type: 'json_schema',
    name: 'plan',
  });
  assert.strictEqual(resolveOpenAiTextVerbosity({ options: { text_verbosity: 'LOW' } }), 'low');
  assert.strictEqual(resolveOpenAiTextVerbosity({ options: { text_verbosity: 'low' } }, 'gpt-5-codex'), 'medium');
  assert.deepStrictEqual(normalizeChatMessagesForCompletion([
    { role: 'developer', content: 'x' },
    { role: 'assistant', content: ' y ' },
    { role: 'user', content: '' },
  ]), [
    { role: 'user', content: 'x' },
    { role: 'assistant', content: 'y' },
  ]);
  assert.strictEqual(buildGeminiPromptFromMessages([{ role: 'system', content: 'A' }]), '[SYSTEM]\nA');

  const gemini = createHarness();
  gemini.responses.push(createResponse({
    json: { candidates: [{ content: { parts: [{ text: ' Gemini OK ' }] } }] },
  }));
  const geminiText = await gemini.clients.callGeminiChat('gemini-pro', [{ role: 'user', content: 'Olá' }], 1000, {
    options: { num_predict: 1200 },
  });
  assert.strictEqual(geminiText, 'Gemini OK');
  assert.ok(gemini.calls[0].url.includes('/models/gemini-pro:generateContent?key=gemini-key'));
  assert.strictEqual(gemini.calls[0].body.generationConfig.maxOutputTokens, 1200);
  assert.strictEqual(gemini.calls[0].body.contents[0].parts[0].text, '[USER]\nOlá');
  assert.ok(gemini.cleared.includes('gemini'));

  const samba = createHarness();
  samba.responses.push(createResponse({
    json: { choices: [{ message: { content: ' Samba OK ' } }] },
  }));
  const sambaText = await samba.clients.callSambaNovaChat(' samba model ', [{ role: 'system', content: 'S' }], 1000, {
    options: { num_predict: 12 },
  });
  assert.strictEqual(sambaText, 'Samba OK');
  assert.strictEqual(samba.calls[0].url, 'https://samba.test/v1/chat/completions');
  assert.strictEqual(samba.calls[0].options.headers.Authorization, 'Bearer samba-key');
  assert.strictEqual(samba.calls[0].body.model, 'sambamodel');
  assert.strictEqual(samba.calls[0].body.max_tokens, 32);
  assert.deepStrictEqual(samba.calls[0].body.messages, [{ role: 'system', content: 'S' }]);

  const openai = createHarness();
  openai.responses.push(createResponse({
    json: { choices: [{ message: { content: ' OpenAI OK ' } }] },
  }));
  const openaiText = await openai.clients.callOpenAiChat(' gpt test ', [{ role: 'user', content: 'Olá' }], 1000, {
    options: { num_predict: 700 },
  });
  assert.strictEqual(openaiText, 'OpenAI OK');
  assert.strictEqual(openai.calls[0].url, 'https://openai.test/v1/chat/completions');
  assert.strictEqual(openai.calls[0].options.headers.Authorization, 'Bearer openai-key');
  assert.strictEqual(openai.calls[0].body.model, 'gpttest');
  assert.strictEqual(openai.calls[0].body.max_tokens, 700);
  assert.deepStrictEqual(openai.calls[0].body.messages, [{ role: 'user', content: 'Olá' }]);
  assert.strictEqual(openai.calls[0].body.response_format, undefined);

  const openaiJson = createHarness();
  openaiJson.responses.push(createResponse({
    json: { choices: [{ message: { content: ' {\"summary\":\"ok\",\"operations\":[]} ' } }] },
  }));
  await openaiJson.clients.callOpenAiChat('gpt-4.1', [{ role: 'user', content: 'JSON' }], 1000, {
    options: { response_format: { type: 'json_schema', name: 'plan', schema: { type: 'object' } } },
  });
  assert.deepStrictEqual(openaiJson.calls[0].body.response_format, {
    type: 'json_schema',
    name: 'plan',
    schema: { type: 'object' },
  });

  const openaiLong = createHarness();
  openaiLong.responses.push(createResponse({
    json: { choices: [{ message: { content: ' OpenAI long OK ' } }] },
  }));
  await openaiLong.clients.callOpenAiChat('gpt-long', [{ role: 'user', content: 'Projeto complexo' }], 1000, {
    options: { num_predict: 9000 },
  });
  assert.strictEqual(openaiLong.calls[0].body.max_tokens, 8192);

  const openaiCodex = createHarness();
  openaiCodex.responses.push(createResponse({
    json: { output_text: ' Codex OK ' },
  }));
  const openaiCodexText = await openaiCodex.clients.callOpenAiChat('gpt-5-codex', [
    { role: 'system', content: 'Você edita código.' },
    { role: 'user', content: 'Olá' },
  ], 1000, {
    options: { num_predict: 700 },
  });
  assert.strictEqual(openaiCodexText, 'Codex OK');
  assert.strictEqual(openaiCodex.calls[0].url, 'https://openai.test/v1/responses');
  assert.strictEqual(openaiCodex.calls[0].options.headers.Authorization, 'Bearer openai-key');
  assert.strictEqual(openaiCodex.calls[0].body.model, 'gpt-5-codex');
  assert.strictEqual(openaiCodex.calls[0].body.max_output_tokens, 4096);
  assert.deepStrictEqual(openaiCodex.calls[0].body.reasoning, { effort: 'low' });
  assert.strictEqual(openaiCodex.calls[0].body.instructions, 'Você edita código.');
  assert.strictEqual(openaiCodex.calls[0].body.input, 'Olá');

  const openaiCodexStructured = createHarness();
  openaiCodexStructured.responses.push(createResponse({
    json: { output_text: '{"summary":"ok","operations":[]}' },
  }));
  await openaiCodexStructured.clients.callOpenAiChat('gpt-5-codex', [
    { role: 'user', content: 'Gere JSON' },
  ], 1000, {
    options: {
      response_format: { type: 'json_schema', name: 'operation_plan', schema: { type: 'object' } },
      text_verbosity: 'low',
    },
  });
  assert.deepStrictEqual(openaiCodexStructured.calls[0].body.text, {
    format: { type: 'json_schema', name: 'operation_plan', schema: { type: 'object' } },
    verbosity: 'medium',
  });

  const openaiCodexExplicitMinimal = createHarness();
  openaiCodexExplicitMinimal.responses.push(createResponse({
    json: { output_text: ' Codex explicit OK ' },
  }));
  await openaiCodexExplicitMinimal.clients.callOpenAiChat('gpt-5-codex', [
    { role: 'user', content: 'Olá' },
  ], 1000, {
    reasoning: { effort: 'minimal' },
  });
  assert.deepStrictEqual(openaiCodexExplicitMinimal.calls[0].body.reasoning, { effort: 'low' });

  const openaiCodexLargeBudget = createHarness();
  openaiCodexLargeBudget.responses.push(createResponse({
    json: { output_text: ' Codex large OK ' },
  }));
  await openaiCodexLargeBudget.clients.callOpenAiChat('gpt-5-codex', [
    { role: 'user', content: 'Gere um app complexo.' },
  ], 1000, {
    options: { num_predict: 20000 },
  });
  assert.strictEqual(openaiCodexLargeBudget.calls[0].url, 'https://openai.test/v1/responses');
  assert.strictEqual(openaiCodexLargeBudget.calls[0].body.max_output_tokens, 20000);

  const openaiCodexCappedBudget = createHarness();
  openaiCodexCappedBudget.responses.push(createResponse({
    json: { output_text: ' Codex capped OK ' },
  }));
  await openaiCodexCappedBudget.clients.callOpenAiChat('gpt-5-codex', [
    { role: 'user', content: 'Gere um app enorme.' },
  ], 1000, {
    options: { num_predict: 90000 },
  });
  assert.strictEqual(openaiCodexCappedBudget.calls[0].body.max_output_tokens, 65536);

  const openaiCodexIncomplete = createHarness();
  openaiCodexIncomplete.responses.push(createResponse({
    json: {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'reasoning', summary: [] }],
    },
  }));
  await assert.rejects(
    () => openaiCodexIncomplete.clients.callOpenAiChat('gpt-5-codex', [
      { role: 'user', content: 'Gere um app complexo.' },
    ], 1000, {
      options: { num_predict: 20000 },
    }),
    /status=incomplete; reason=max_output_tokens; output=reasoning; max_output_tokens=20000/
  );

  const queuedCalls = [];
  let releaseFirstQueuedCall = () => {};
  const firstQueuedCallReleased = new Promise((resolve) => {
    releaseFirstQueuedCall = resolve;
  });
  let activeQueuedCalls = 0;
  let maxActiveQueuedCalls = 0;
  const queuedOpenAi = createHarness({
    fetchFn: async (url, options) => {
      activeQueuedCalls += 1;
      maxActiveQueuedCalls = Math.max(maxActiveQueuedCalls, activeQueuedCalls);
      queuedCalls.push({ url, body: JSON.parse(options.body) });
      if (queuedCalls.length === 1) {
        await firstQueuedCallReleased;
      }
      activeQueuedCalls -= 1;
      return createResponse({ json: { choices: [{ message: { content: ' queued ok ' } }] } });
    },
  });
  const firstQueued = queuedOpenAi.clients.callOpenAiChat('gpt-4.1', [{ role: 'user', content: 'Primeira' }]);
  await flushEventLoop();
  assert.strictEqual(queuedCalls.length, 1);
  const secondQueued = queuedOpenAi.clients.callOpenAiChat('gpt-4.1', [{ role: 'user', content: 'Segunda' }]);
  await flushEventLoop();
  assert.strictEqual(queuedCalls.length, 1);
  releaseFirstQueuedCall();
  await Promise.all([firstQueued, secondQueued]);
  assert.strictEqual(queuedCalls.length, 2);
  assert.strictEqual(maxActiveQueuedCalls, 1);
  assert.strictEqual(queuedCalls[0].body.messages[0].content, 'Primeira');
  assert.strictEqual(queuedCalls[1].body.messages[0].content, 'Segunda');

  const custom = createHarness();
  custom.responses.push(createResponse({
    json: { choices: [{ message: { content: [{ text: 'Custom OK' }] } }] },
  }));
  const customText = await custom.clients.callCustomProviderChat('custom:deep', 'fallback', [{ role: 'user', content: 'Ping' }], 1000, {
    runtimeBudget: { generationOptions: { num_predict: 1800 } },
  });
  assert.strictEqual(customText, 'Custom OK');
  assert.strictEqual(custom.calls[0].url, 'https://deep.test/v1/chat/completions');
  assert.strictEqual(custom.calls[0].body.model, 'deepseek-chat');
  assert.strictEqual(custom.calls[0].body.max_tokens, 1800);

  const failure = createHarness();
  failure.responses.push(createResponse({
    ok: false,
    status: 429,
    text: 'too many requests',
    retryAfter: '2',
  }));
  await assert.rejects(
    () => failure.clients.callGeminiChat('gemini-pro', [{ role: 'user', content: 'Olá' }]),
    /Gemini HTTP 429/
  );
  assert.ok(failure.cooldowns.some((entry) => entry.provider === 'gemini' && entry.reason.includes('retry-after:2')));

  console.log('remote-clients.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
