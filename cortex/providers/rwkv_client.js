function buildRwkvPromptFromMessages(messages = []) {
  const parts = [];
  for (const msg of messages || []) {
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || 'user').toUpperCase();
    const content = String(msg.content || '').trim();
    if (!content) continue;
    parts.push(`[${role}]\n${content}`);
  }
  return parts.join('\n');
}

function createRwkvProviderClient(dependencies = {}) {
  const {
    AI_REQUEST_TIMEOUT_MS = 420000,
    MEMPALACE_PYTHON_BIN,
    RWKV_CUDA_ON = '0',
    RWKV_JIT_ON = '0',
    RWKV_MAX_NEW_TOKENS = 80,
    RWKV_MODEL_PATH,
    RWKV_PROVIDER_SCRIPT,
    RWKV_STRATEGY = 'cpu fp16',
    RWKV_TEMPERATURE = 0.2,
    RWKV_TOKENIZER_PATH,
    RWKV_TOP_P = 0.9,
    RWKV_V7_ON = '0',
    extractJsonFromMixedText,
    runCommand,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`RWKV provider dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('MEMPALACE_PYTHON_BIN', MEMPALACE_PYTHON_BIN);
    requireDependency('RWKV_MODEL_PATH', RWKV_MODEL_PATH);
    requireDependency('RWKV_PROVIDER_SCRIPT', RWKV_PROVIDER_SCRIPT);
    requireDependency('RWKV_STRATEGY', RWKV_STRATEGY);
    requireDependency('RWKV_TOKENIZER_PATH', RWKV_TOKENIZER_PATH);
    requireDependency('extractJsonFromMixedText', extractJsonFromMixedText);
    requireDependency('runCommand', runCommand);
  }

  async function callRwkvProviderChat(messages, timeoutMs = AI_REQUEST_TIMEOUT_MS, requestOptions = {}) {
    assertReady();
    const prompt = buildRwkvPromptFromMessages(messages);
    if (!prompt) throw new Error('Prompt vazio para RWKV.');

    const requestedPredict =
      requestOptions && requestOptions.options && Number.isFinite(Number(requestOptions.options.num_predict))
        ? Number(requestOptions.options.num_predict)
        : RWKV_MAX_NEW_TOKENS;

    const maxTokens = Number.isFinite(Number(RWKV_MAX_NEW_TOKENS)) ? Number(RWKV_MAX_NEW_TOKENS) : 80;
    const rwkvMaxNewTokens = Math.max(24, Math.min(maxTokens, Math.floor(requestedPredict)));

    const command = await runCommand(
      MEMPALACE_PYTHON_BIN,
      [
        RWKV_PROVIDER_SCRIPT,
        '--action',
        'eval',
        '--prompt',
        prompt,
        '--model-path',
        RWKV_MODEL_PATH,
        '--tokenizer-path',
        RWKV_TOKENIZER_PATH,
        '--strategy',
        RWKV_STRATEGY,
        '--max-new-tokens',
        String(rwkvMaxNewTokens),
        '--temperature',
        String(RWKV_TEMPERATURE),
        '--top-p',
        String(RWKV_TOP_P),
      ],
      {
        timeoutMs,
        env: {
          RWKV_V7_ON,
          RWKV_JIT_ON,
          RWKV_CUDA_ON,
        },
      }
    );

    if (!command.ok) {
      const codeText = command.code === null || command.code === undefined ? 'null' : String(command.code);
      const signalText = command.signal ? ` signal=${command.signal}` : '';
      const timeoutText = command.timedOut ? ' timedOut=true' : '';
      throw new Error(`RWKV provider falhou (code=${codeText}${signalText}${timeoutText}): ${(command.stderr || '').trim()}`);
    }

    const parsed = extractJsonFromMixedText(command.stdout);
    if (!parsed || parsed.ok !== true) {
      throw new Error(`RWKV provider retornou payload inválido: ${(command.stdout || '').trim().slice(0, 600)}`);
    }

    const text = String(parsed.generated_text || '').trim();
    if (!text) {
      throw new Error('RWKV provider não retornou texto gerado.');
    }

    return text;
  }

  return {
    buildRwkvPromptFromMessages,
    callRwkvProviderChat,
  };
}

module.exports = {
  buildRwkvPromptFromMessages,
  createRwkvProviderClient,
};
