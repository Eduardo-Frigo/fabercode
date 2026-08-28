'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  buildAgenticChatCompletionToolResultMessages,
  buildAgenticResponsesConversationInput,
  buildAgenticResponsesToolResultInput,
} = require('../main/services/agentic_model_tool_result_service');

const pngBase64 = Buffer.from('multimodal-tool-png').toString('base64');
const pngBytes = Buffer.from(pngBase64, 'base64').length;
const pngDigest = `sha256:${crypto
  .createHash('sha256')
  .update(Buffer.from(pngBase64, 'base64'))
  .digest('hex')}`;
const receipt = Object.freeze(Object.create(null));
const visual = Object.freeze({
  type: 'input_image',
  imageUrl: `data:image/png;base64,${pngBase64}`,
  detail: 'high',
});
const visualEgress = Object.freeze({
  receipt,
  payloadDigest: pngDigest,
  mimeType: 'image/png',
  bytes: pngBytes,
});

function allowVisualEgress(calls) {
  return Object.freeze({
    providerId: 'openai',
    providerOrigin: 'https://api.openai.com',
    consumeVisualEgress(input) {
      calls.push(input);
      return Object.freeze({
        ok: true,
        authorized: true,
        reason: 'visual_egress_consumed',
      });
    },
  });
}

function testResponsesKeepsTextAndAddsTrueImageContent() {
  const consumptionCalls = [];
  const input = buildAgenticResponsesToolResultInput([
    Object.freeze({ callId: 'call-text', output: '{"ok":true}' }),
    Object.freeze({
      callId: 'call-image',
      output: '{"ok":true,"bytes":19}',
      visual,
      visualEgress,
    }),
  ], allowVisualEgress(consumptionCalls));

  assert.deepStrictEqual(input[0], {
    type: 'function_call_output',
    call_id: 'call-text',
    output: '{"ok":true}',
  });
  assert.deepStrictEqual(input[1], {
    type: 'function_call_output',
    call_id: 'call-image',
    output: [
      { type: 'input_text', text: '{"ok":true,"bytes":19}' },
      {
        type: 'input_image',
        image_url: `data:image/png;base64,${pngBase64}`,
        detail: 'high',
      },
    ],
  });
  assert.strictEqual(consumptionCalls.length, 1);
  assert.deepStrictEqual(consumptionCalls[0], {
    callId: 'call-image',
    receipt,
    providerId: 'openai',
    providerOrigin: 'https://api.openai.com',
    payloadDigest: pngDigest,
    mimeType: 'image/png',
    bytes: pngBytes,
  });
  assert(Object.isFrozen(consumptionCalls[0]));
  assert.strictEqual(JSON.stringify(input).includes('/tmp/'), false);
  assert.strictEqual(JSON.stringify(input).includes(pngDigest), false);
}

function testResponsesConversationPreservesStructuredUserContent() {
  const imageUrl = `data:image/png;base64,${pngBase64}`;
  const input = buildAgenticResponsesConversationInput([
    {
      role: 'assistant',
      content: 'Contexto anterior.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Crie a aplicação solicitada.' },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      ],
    },
  ]);

  assert.deepStrictEqual(input, [
    {
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Contexto anterior.' }],
    },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Crie a aplicação solicitada.' },
        { type: 'input_image', image_url: imageUrl, detail: 'high' },
      ],
    },
  ]);
  assert.strictEqual(JSON.stringify(input).includes('[object Object]'), false);
}

function testChatCompletionEmitsToolMessagesBeforeVisualEvidence() {
  const consumptionCalls = [];
  const messages = buildAgenticChatCompletionToolResultMessages([
    Object.freeze({ callId: 'call-text', output: 'texto' }),
    Object.freeze({ callId: 'call-image', output: 'captura', visual, visualEgress }),
  ], allowVisualEgress(consumptionCalls));

  assert.deepStrictEqual(messages.slice(0, 2), [
    { role: 'tool', tool_call_id: 'call-text', content: 'texto' },
    { role: 'tool', tool_call_id: 'call-image', content: 'captura' },
  ]);
  assert.deepStrictEqual(messages[2], {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Evidência visual da chamada de ferramenta call-image.',
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${pngBase64}`,
          detail: 'high',
        },
      },
    ],
  });
  assert.strictEqual(consumptionCalls.length, 1);
}

function testVisualWithoutConsumableApprovalFailsClosedToTextOnly() {
  const toolResults = [Object.freeze({
    callId: 'call-image',
    output: 'captura retida',
    visual,
    visualEgress,
  })];
  assert.deepStrictEqual(buildAgenticResponsesToolResultInput(toolResults), [{
    type: 'function_call_output',
    call_id: 'call-image',
    output: 'captura retida',
  }]);
  assert.deepStrictEqual(buildAgenticChatCompletionToolResultMessages(
    toolResults,
    {
      providerId: 'openai',
      providerOrigin: 'https://api.openai.com',
      consumeVisualEgress: () => ({
        ok: false,
        authorized: false,
        reason: 'visual_egress_replayed',
      }),
    }
  ), [{
    role: 'tool',
    tool_call_id: 'call-image',
    content: 'captura retida',
  }]);
  assert.deepStrictEqual(buildAgenticResponsesToolResultInput(toolResults, {
    providerId: 'openai',
    providerOrigin: 'https://other.example',
    consumeVisualEgress: () => ({ ok: false, authorized: false, reason: 'mismatch' }),
  }), [{
    type: 'function_call_output',
    call_id: 'call-image',
    output: 'captura retida',
  }]);
}

function testInvalidOrHostileVisualFailsClosedToTextOnly() {
  let getterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'visual', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  Object.defineProperties(hostile, {
    callId: { enumerable: true, value: 'call-hostile' },
    output: { enumerable: true, value: 'safe text' },
  });
  const malformed = Object.freeze({
    callId: 'call-malformed',
    output: 'safe fallback',
    visual: Object.freeze({
      type: 'input_image',
      imageUrl: 'file:///private/tmp/screenshot.png',
      detail: 'high',
    }),
  });

  assert.deepStrictEqual(buildAgenticResponsesToolResultInput([hostile, malformed]), [
    {
      type: 'function_call_output',
      call_id: 'call-hostile',
      output: 'safe text',
    },
    {
      type: 'function_call_output',
      call_id: 'call-malformed',
      output: 'safe fallback',
    },
  ]);
  assert.strictEqual(getterCalls, 0);
}

testResponsesKeepsTextAndAddsTrueImageContent();
testResponsesConversationPreservesStructuredUserContent();
testChatCompletionEmitsToolMessagesBeforeVisualEvidence();
testVisualWithoutConsumableApprovalFailsClosedToTextOnly();
testInvalidOrHostileVisualFailsClosedToTextOnly();
console.log('agentic-model-tool-result-service.test.js: ok');
