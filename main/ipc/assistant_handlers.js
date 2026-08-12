'use strict';

const ASSISTANT_IPC_INVALID_INPUT = Object.freeze({
  ok: false,
  code: 'assistant_ipc_invalid_input',
});
const FORBIDDEN_TOP_LEVEL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainDataEnvelope(value, exactKeys = null) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;

    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || FORBIDDEN_TOP_LEVEL_KEYS.has(key))) {
      return false;
    }
    if (exactKeys && (
      keys.length !== exactKeys.length
      || exactKeys.some((key) => !keys.includes(key))
    )) {
      return false;
    }

    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(
        descriptor
        && descriptor.enumerable === true
        && Object.hasOwn(descriptor, 'value')
      );
    });
  } catch {
    return false;
  }
}

function registerAssistantHandlers(dependencies = {}) {
  const {
    assistantRuntime,
    registerIpcHandler,
  } = dependencies;

  if (!assistantRuntime) {
    throw new Error('Assistant IPC dependency missing: assistantRuntime');
  }
  if (typeof registerIpcHandler !== 'function') {
    throw new Error('Assistant IPC dependency missing: registerIpcHandler');
  }
  for (const method of ['plan', 'message', 'execute']) {
    if (typeof assistantRuntime[method] !== 'function') {
      throw new Error(`Assistant IPC runtime missing method: ${method}`);
    }
  }

  registerIpcHandler('assistant:plan', async (_, ...args) => {
    if (args.length !== 1 || !isPlainDataEnvelope(args[0])) {
      return ASSISTANT_IPC_INVALID_INPUT;
    }
    return assistantRuntime.plan(args[0]);
  });
  registerIpcHandler('assistant:message', async (_, ...args) => {
    if (args.length !== 1 || !isPlainDataEnvelope(args[0])) {
      return ASSISTANT_IPC_INVALID_INPUT;
    }
    return assistantRuntime.message(args[0]);
  });
  registerIpcHandler('assistant:execute', async (_, ...args) => {
    if (args.length !== 1 || !isPlainDataEnvelope(args[0], ['jobId'])) {
      return ASSISTANT_IPC_INVALID_INPUT;
    }
    return assistantRuntime.execute(args[0]);
  });
}

module.exports = {
  registerAssistantHandlers,
};
