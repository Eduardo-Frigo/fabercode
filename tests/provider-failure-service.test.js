const assert = require('assert');

const {
  buildProviderFailureReason,
  normalizeProviderFailure,
  toProviderFailureError,
} = require('../cortex/providers/provider_failure_service');
const { createProviderRegistry } = require('../cortex/providers/registry');

async function run() {
  const rateLimit = normalizeProviderFailure(
    new Error('OpenAI HTTP 429 (retry-after:10): too many requests'),
    'openai'
  );
  assert.strictEqual(rateLimit.code, 'openai_rate_limited');
  assert.strictEqual(rateLimit.category, 'rate_limit');
  assert.strictEqual(rateLimit.retryable, true);
  assert.strictEqual(rateLimit.httpStatus, 429);
  assert.match(rateLimit.userMessage, /limite/i);

  const empty = normalizeProviderFailure(new Error('OpenAI não retornou texto gerado.'), 'openai');
  assert.strictEqual(empty.code, 'openai_empty_response');
  assert.strictEqual(empty.category, 'empty_response');
  assert.strictEqual(empty.retryable, false);
  assert.match(buildProviderFailureReason(empty, 'ai_provider_error'), /^ai_provider_error:openai_empty_response:/);
  assert.match(
    buildProviderFailureReason({ ...empty, code: 'persona_briefing_empty_response' }, 'provider_error'),
    /^provider_error:persona_briefing_empty_response:/
  );

  const outputLimit = normalizeProviderFailure(
    new Error('OpenAI não retornou texto gerado (status=incomplete; reason=max_output_tokens; output=reasoning; max_output_tokens=8192).'),
    'openai'
  );
  assert.strictEqual(outputLimit.code, 'openai_output_limit');
  assert.strictEqual(outputLimit.category, 'output_limit');
  assert.strictEqual(outputLimit.retryable, true);
  assert.match(outputLimit.userMessage, /limite de saída/i);

  const wrapped = toProviderFailureError('gemini', new Error('Gemini HTTP 401: invalid api key'));
  assert.strictEqual(wrapped.name, 'AiProviderFailureError');
  assert.strictEqual(wrapped.providerUnavailable, true);
  assert.strictEqual(wrapped.aiProviderFailure.code, 'gemini_auth_failed');
  assert.strictEqual(wrapped.aiProviderFailure.retryable, false);

  const audit = [];
  const registry = createProviderRegistry({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    callOpenAiChat: async () => {
      throw new Error('OpenAI HTTP 503: upstream overloaded');
    },
    getEffectiveOpenAiModel: () => 'gpt-test',
    getSelectedAiProvider: () => 'openai',
  });

  await assert.rejects(
    () => registry.chat('fallback-model', [{ role: 'user', content: 'oi' }], 1000),
    (error) => {
      assert.strictEqual(error.providerUnavailable, true);
      assert.strictEqual(error.aiProviderFailure.code, 'openai_server_error');
      assert.strictEqual(error.aiProviderFailure.retryable, true);
      return true;
    }
  );
  assert.strictEqual(audit.length, 1);
  assert.strictEqual(audit[0].type, 'ai.provider_error');
  assert.strictEqual(audit[0].payload.code, 'openai_server_error');
  assert.strictEqual(audit[0].payload.category, 'remote_server');

  console.log('provider-failure-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
