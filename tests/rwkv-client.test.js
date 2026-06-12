const assert = require('assert');

const {
  buildRwkvPromptFromMessages,
  createRwkvProviderClient,
} = require('../cortex/providers/rwkv_client');

function extractJsonFromMixedText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function createHarness(commandResult) {
  const calls = [];
  const client = createRwkvProviderClient({
    AI_REQUEST_TIMEOUT_MS: 999,
    MEMPALACE_PYTHON_BIN: 'python3',
    RWKV_CUDA_ON: '0',
    RWKV_JIT_ON: '0',
    RWKV_MAX_NEW_TOKENS: 80,
    RWKV_MODEL_PATH: '/models/rwkv',
    RWKV_PROVIDER_SCRIPT: '/provider.py',
    RWKV_STRATEGY: 'cpu fp16',
    RWKV_TEMPERATURE: 0.2,
    RWKV_TOKENIZER_PATH: '/models/tokenizer.json',
    RWKV_TOP_P: 0.9,
    RWKV_V7_ON: '1',
    extractJsonFromMixedText,
    runCommand: async (bin, args, options) => {
      calls.push({ bin, args, options });
      return commandResult;
    },
  });
  return { calls, client };
}

async function run() {
  assert.strictEqual(buildRwkvPromptFromMessages([
    { role: 'system', content: 'S' },
    { role: 'user', content: ' U ' },
    { role: 'assistant', content: '' },
  ]), '[SYSTEM]\nS\n[USER]\nU');

  const success = createHarness({
    ok: true,
    stdout: 'log line\n{"ok":true,"generated_text":"  resposta local  "}',
    stderr: '',
  });
  const text = await success.client.callRwkvProviderChat([
    { role: 'user', content: 'Olá' },
  ], 1234, {
    options: { num_predict: 120 },
  });
  assert.strictEqual(text, 'resposta local');
  assert.strictEqual(success.calls[0].bin, 'python3');
  assert.deepStrictEqual(success.calls[0].options.env, {
    RWKV_V7_ON: '1',
    RWKV_JIT_ON: '0',
    RWKV_CUDA_ON: '0',
  });
  assert.strictEqual(success.calls[0].options.timeoutMs, 1234);
  assert.ok(success.calls[0].args.includes('--action'));
  assert.ok(success.calls[0].args.includes('eval'));
  assert.ok(success.calls[0].args.includes('[USER]\nOlá'));
  assert.strictEqual(success.calls[0].args[success.calls[0].args.indexOf('--max-new-tokens') + 1], '80');

  const clampedMin = createHarness({
    ok: true,
    stdout: '{"ok":true,"generated_text":"ok"}',
    stderr: '',
  });
  await clampedMin.client.callRwkvProviderChat([{ role: 'user', content: 'x' }], 999, {
    options: { num_predict: 2 },
  });
  assert.strictEqual(clampedMin.calls[0].args[clampedMin.calls[0].args.indexOf('--max-new-tokens') + 1], '24');

  const failedCommand = createHarness({
    ok: false,
    code: null,
    signal: 'SIGKILL',
    timedOut: true,
    stdout: '',
    stderr: 'timeout',
  });
  await assert.rejects(
    () => failedCommand.client.callRwkvProviderChat([{ role: 'user', content: 'x' }]),
    /RWKV provider falhou \(code=null signal=SIGKILL timedOut=true\): timeout/
  );

  const invalidPayload = createHarness({
    ok: true,
    stdout: 'not json',
    stderr: '',
  });
  await assert.rejects(
    () => invalidPayload.client.callRwkvProviderChat([{ role: 'user', content: 'x' }]),
    /payload inválido/
  );

  const emptyText = createHarness({
    ok: true,
    stdout: '{"ok":true,"generated_text":"  "}',
    stderr: '',
  });
  await assert.rejects(
    () => emptyText.client.callRwkvProviderChat([{ role: 'user', content: 'x' }]),
    /não retornou texto/
  );

  await assert.rejects(
    () => success.client.callRwkvProviderChat([{ role: 'user', content: '   ' }]),
    /Prompt vazio para RWKV/
  );

  console.log('rwkv-client.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
