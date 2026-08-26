'use strict';

const MAP_CHAT_IPC_INVALID_INPUT = Object.freeze({
  ok: false,
  code: 'map_chat_ipc_invalid_input',
});
const PAYLOAD_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'userMessage',
  'locale',
]);
const ANALYZE_PAYLOAD_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'locale',
]);
const RENDER_ANALYZE_PAYLOAD_KEYS = PAYLOAD_KEYS;
const RENDER_MESSAGE_PAYLOAD_KEYS = Object.freeze([
  ...PAYLOAD_KEYS,
  'attachments',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isExactDataEnvelope(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))
      || expectedKeys.some((key) => !keys.includes(key))) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(
        descriptor
        && descriptor.enumerable === true
        && Object.hasOwn(descriptor, 'value')
        && descriptor.value !== undefined
      );
    });
  } catch {
    return false;
  }
}

function hasExactAttachmentEnvelopes(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > 8) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') return false;
    for (let index = 0; index < value.length; index += 1) {
      if (keys[index] !== String(index)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || !isExactDataEnvelope(descriptor.value, ['path', 'type', 'name'])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function registerMapChatHandlers(dependencies = {}) {
  const {
    mapChatSessionService,
    registerIpcHandler,
  } = dependencies;
  if (!mapChatSessionService) {
    throw new Error('Map Chat IPC dependency missing: mapChatSessionService');
  }
  if (typeof registerIpcHandler !== 'function') {
    throw new Error('Map Chat IPC dependency missing: registerIpcHandler');
  }
  const descriptor = Object.getOwnPropertyDescriptor(mapChatSessionService, 'sendMessage');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    throw new Error('Map Chat IPC service missing method: sendMessage');
  }
  const sendMessage = descriptor.value;
  const analyzeDescriptor = Object.getOwnPropertyDescriptor(mapChatSessionService, 'analyze');
  if (!analyzeDescriptor || !Object.hasOwn(analyzeDescriptor, 'value')
    || typeof analyzeDescriptor.value !== 'function') {
    throw new Error('Map Chat IPC service missing method: analyze');
  }
  const analyze = analyzeDescriptor.value;
  const analyzeRenderDescriptor = Object.getOwnPropertyDescriptor(
    mapChatSessionService,
    'analyzeRender',
  );
  if (!analyzeRenderDescriptor || !Object.hasOwn(analyzeRenderDescriptor, 'value')
    || typeof analyzeRenderDescriptor.value !== 'function') {
    throw new Error('Map Chat IPC service missing method: analyzeRender');
  }
  const analyzeRender = analyzeRenderDescriptor.value;
  const sendRenderMessageDescriptor = Object.getOwnPropertyDescriptor(
    mapChatSessionService,
    'sendRenderMessage',
  );
  if (!sendRenderMessageDescriptor || !Object.hasOwn(sendRenderMessageDescriptor, 'value')
    || typeof sendRenderMessageDescriptor.value !== 'function') {
    throw new Error('Map Chat IPC service missing method: sendRenderMessage');
  }
  const sendRenderMessage = sendRenderMessageDescriptor.value;

  registerIpcHandler('application-map:chat:message', async (_, ...args) => {
    if (args.length !== 1 || !isExactDataEnvelope(args[0], PAYLOAD_KEYS)) {
      return MAP_CHAT_IPC_INVALID_INPUT;
    }
    return Reflect.apply(sendMessage, mapChatSessionService, [args[0]]);
  });
  registerIpcHandler('application-map:chat:analyze', async (_, ...args) => {
    if (args.length !== 1 || !isExactDataEnvelope(args[0], ANALYZE_PAYLOAD_KEYS)) {
      return MAP_CHAT_IPC_INVALID_INPUT;
    }
    return Reflect.apply(analyze, mapChatSessionService, [args[0]]);
  });
  registerIpcHandler('application-map:render:analyze', async (_, ...args) => {
    if (args.length !== 1 || !isExactDataEnvelope(args[0], RENDER_ANALYZE_PAYLOAD_KEYS)) {
      return MAP_CHAT_IPC_INVALID_INPUT;
    }
    return Reflect.apply(analyzeRender, mapChatSessionService, [args[0]]);
  });
  registerIpcHandler('application-map:render:message', async (_, ...args) => {
    if (args.length !== 1 || !isExactDataEnvelope(args[0], RENDER_MESSAGE_PAYLOAD_KEYS)) {
      return MAP_CHAT_IPC_INVALID_INPUT;
    }
    const attachmentsDescriptor = Object.getOwnPropertyDescriptor(args[0], 'attachments');
    if (!attachmentsDescriptor
      || !hasExactAttachmentEnvelopes(attachmentsDescriptor.value)) {
      return MAP_CHAT_IPC_INVALID_INPUT;
    }
    return Reflect.apply(sendRenderMessage, mapChatSessionService, [args[0]]);
  });
}

module.exports = {
  registerMapChatHandlers,
};
