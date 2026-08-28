'use strict';

const crypto = require('crypto');
const util = require('util');

const AGENTIC_MODEL_TOOL_RESULT_VERSION = 'agentic-model-tool-result.v1';
const CALL_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const MAX_TEXT_LENGTH = 16 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const SAFE_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const CONVERSATION_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;

function ownDataValue(record, key) {
  if (!record || (typeof record !== 'object' && typeof record !== 'function')
    || util.types.isProxy(record)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function exactPlainDataFields(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if ((prototype !== Object.prototype && prototype !== null)
      || keys.length !== expectedKeys.length
      || expectedKeys.some((key) => !keys.includes(key))
      || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))) {
      return null;
    }
    const fields = new Map();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
        return null;
      }
      fields.set(key, descriptor.value);
    }
    return fields;
  } catch {
    return null;
  }
}

function normalizeToolResult(item) {
  const callId = ownDataValue(item, 'callId') || ownDataValue(item, 'id');
  if (typeof callId !== 'string' || !CALL_ID_PATTERN.test(callId)) return null;
  const rawOutput = ownDataValue(item, 'output');
  const output = typeof rawOutput === 'string' ? rawOutput : '{}';
  if (output.length > MAX_TEXT_LENGTH || output.includes('\0')) return null;
  const evidence = normalizeVisual(ownDataValue(item, 'visual'));
  const visualEgress = evidence
    ? normalizeVisualEgress(ownDataValue(item, 'visualEgress'), evidence)
    : null;
  return Object.freeze({
    callId,
    output,
    visual: visualEgress ? evidence.visual : null,
    visualEgress,
  });
}

function normalizeVisual(value) {
  const fields = exactPlainDataFields(value, ['type', 'imageUrl', 'detail']);
  if (!fields || fields.get('type') !== 'input_image'
    || fields.get('detail') !== 'high'
    || typeof fields.get('imageUrl') !== 'string') return null;
  const imageUrl = fields.get('imageUrl');
  if (!imageUrl.startsWith(PNG_DATA_URL_PREFIX)) return null;
  const base64 = imageUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (base64.length < 4 || base64.length > MAX_BASE64_LENGTH
    || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  try {
    const decoded = Buffer.from(base64, 'base64');
    if (decoded.length < 1 || decoded.length > MAX_IMAGE_BYTES
      || decoded.toString('base64') !== base64) return null;
  } catch {
    return null;
  }
  const decoded = Buffer.from(base64, 'base64');
  return Object.freeze({
    visual: Object.freeze({ type: 'input_image', imageUrl, detail: 'high' }),
    payloadDigest: `sha256:${crypto.createHash('sha256').update(decoded).digest('hex')}`,
    mimeType: 'image/png',
    bytes: decoded.length,
  });
}

function normalizeVisualEgress(value, evidence) {
  const fields = exactPlainDataFields(
    value,
    ['receipt', 'payloadDigest', 'mimeType', 'bytes']
  );
  if (!fields
    || fields.get('payloadDigest') !== evidence.payloadDigest
    || fields.get('mimeType') !== evidence.mimeType
    || fields.get('bytes') !== evidence.bytes) return null;
  const receipt = fields.get('receipt');
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || util.types.isProxy(receipt) || !Object.isFrozen(receipt)) return null;
  try {
    if (Reflect.ownKeys(receipt).length !== 0) return null;
  } catch {
    return null;
  }
  return Object.freeze({
    receipt,
    payloadDigest: evidence.payloadDigest,
    mimeType: evidence.mimeType,
    bytes: evidence.bytes,
  });
}

function normalizeToolResults(toolResults) {
  if (!Array.isArray(toolResults) || util.types.isProxy(toolResults)) return [];
  const normalized = [];
  for (let index = 0; index < toolResults.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(toolResults, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
    const result = normalizeToolResult(descriptor.value);
    if (result) normalized.push(result);
  }
  return normalized;
}

function normalizeConversationImage(part) {
  const imageUrlValue = ownDataValue(part, 'image_url');
  const imageUrl = typeof imageUrlValue === 'string'
    ? imageUrlValue
    : ownDataValue(imageUrlValue, 'url');
  const detailValue = typeof imageUrlValue === 'object' && imageUrlValue
    ? ownDataValue(imageUrlValue, 'detail')
    : ownDataValue(part, 'detail');
  const detail = ['auto', 'low', 'high'].includes(detailValue) ? detailValue : 'auto';
  if (typeof imageUrl !== 'string' || imageUrl.length > MAX_BASE64_LENGTH + 64
    || !CONVERSATION_IMAGE_DATA_URL.test(imageUrl)) return null;
  return Object.freeze({
    type: 'input_image',
    image_url: imageUrl,
    detail,
  });
}

function normalizeConversationContent(rawContent, role) {
  if (typeof rawContent === 'string') {
    const text = rawContent.trim();
    if (!text) return [];
    return [Object.freeze({
      type: role === 'assistant' ? 'output_text' : 'input_text',
      text,
    })];
  }
  if (!Array.isArray(rawContent) || util.types.isProxy(rawContent)) return [];
  const content = [];
  for (let index = 0; index < rawContent.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(rawContent, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
    const part = descriptor.value;
    const type = ownDataValue(part, 'type');
    const textValue = ownDataValue(part, 'text');
    if (['text', 'input_text', 'output_text'].includes(type)
      && typeof textValue === 'string' && textValue.trim()) {
      content.push(Object.freeze({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: textValue.trim(),
      }));
      continue;
    }
    if (role !== 'assistant' && ['image_url', 'input_image'].includes(type)) {
      const image = normalizeConversationImage(part);
      if (image) content.push(image);
    }
  }
  return content;
}

function buildAgenticResponsesConversationInput(conversationMessages = []) {
  if (!Array.isArray(conversationMessages) || util.types.isProxy(conversationMessages)) {
    return Object.freeze([]);
  }
  const input = [];
  for (let index = 0; index < conversationMessages.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(conversationMessages, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
    const message = descriptor.value;
    const role = String(ownDataValue(message, 'role') || 'user').trim().toLowerCase() === 'assistant'
      ? 'assistant'
      : 'user';
    const content = normalizeConversationContent(ownDataValue(message, 'content'), role);
    if (!content.length) continue;
    input.push(Object.freeze({ role, content: Object.freeze(content) }));
  }
  return Object.freeze(input);
}

function normalizeProviderDestination(options) {
  const fields = exactPlainDataFields(
    options,
    ['providerId', 'providerOrigin', 'consumeVisualEgress']
  );
  if (!fields || typeof fields.get('providerId') !== 'string'
    || !SAFE_PROVIDER_ID_PATTERN.test(fields.get('providerId'))
    || typeof fields.get('providerOrigin') !== 'string'
    || typeof fields.get('consumeVisualEgress') !== 'function'
    || util.types.isProxy(fields.get('consumeVisualEgress'))) return null;
  let parsed;
  try {
    parsed = new URL(fields.get('providerOrigin'));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash
    || parsed.origin !== fields.get('providerOrigin')) return null;
  return Object.freeze({
    providerId: fields.get('providerId'),
    providerOrigin: parsed.origin,
    consumeVisualEgress: fields.get('consumeVisualEgress'),
  });
}

function consumeVisualEgress(result, destination) {
  if (!result.visual || !result.visualEgress || !destination) return false;
  const request = Object.freeze({
    callId: result.callId,
    receipt: result.visualEgress.receipt,
    providerId: destination.providerId,
    providerOrigin: destination.providerOrigin,
    payloadDigest: result.visualEgress.payloadDigest,
    mimeType: result.visualEgress.mimeType,
    bytes: result.visualEgress.bytes,
  });
  let raw;
  try {
    raw = destination.consumeVisualEgress(request);
  } catch {
    return false;
  }
  if (raw && typeof raw.then === 'function') return false;
  const fields = exactPlainDataFields(raw, ['ok', 'authorized', 'reason']);
  return Boolean(fields
    && fields.get('ok') === true
    && fields.get('authorized') === true
    && typeof fields.get('reason') === 'string');
}

function authorizedToolResults(toolResults, options) {
  const destination = normalizeProviderDestination(options);
  return normalizeToolResults(toolResults).map((result) => Object.freeze({
    ...result,
    visualAuthorized: consumeVisualEgress(result, destination),
  }));
}

function buildAgenticResponsesToolResultInput(toolResults = [], options = null) {
  return Object.freeze(authorizedToolResults(toolResults, options).map((result) => Object.freeze({
    type: 'function_call_output',
    call_id: result.callId,
    output: result.visualAuthorized
      ? Object.freeze([
          Object.freeze({ type: 'input_text', text: result.output }),
          Object.freeze({
            type: 'input_image',
            image_url: result.visual.imageUrl,
            detail: result.visual.detail,
          }),
        ])
      : result.output,
  })));
}

function buildAgenticChatCompletionToolResultMessages(toolResults = [], options = null) {
  const normalized = authorizedToolResults(toolResults, options);
  const messages = normalized.map((result) => Object.freeze({
    role: 'tool',
    tool_call_id: result.callId,
    content: result.output,
  }));
  for (const result of normalized) {
    if (!result.visualAuthorized) continue;
    messages.push(Object.freeze({
      role: 'user',
      content: Object.freeze([
        Object.freeze({
          type: 'text',
          text: `Evidência visual da chamada de ferramenta ${result.callId}.`,
        }),
        Object.freeze({
          type: 'image_url',
          image_url: Object.freeze({
            url: result.visual.imageUrl,
            detail: result.visual.detail,
          }),
        }),
      ]),
    }));
  }
  return Object.freeze(messages);
}

module.exports = {
  AGENTIC_MODEL_TOOL_RESULT_VERSION,
  buildAgenticChatCompletionToolResultMessages,
  buildAgenticResponsesConversationInput,
  buildAgenticResponsesToolResultInput,
};
