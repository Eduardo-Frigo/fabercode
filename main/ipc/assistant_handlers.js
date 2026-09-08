'use strict';

const ASSISTANT_IPC_ACCESS_DENIED = Object.freeze({
  ok: false,
  code: 'assistant_access_denied',
  message: 'Autenticação da conta ou modo local de desenvolvimento necessário.',
});
const ASSISTANT_IPC_INVALID_INPUT = Object.freeze({
  ok: false,
  code: 'assistant_ipc_invalid_input',
});
const FORBIDDEN_TOP_LEVEL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PRINCIPAL_ACTOR_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;

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

function isAuthorizedAssistantPrincipal(value) {
  if (!isPlainDataEnvelope(value, ['kind', 'actorId'])) return false;
  const kind = value.kind;
  return (kind === 'account' || kind === 'local_development')
    && typeof value.actorId === 'string'
    && PRINCIPAL_ACTOR_ID_PATTERN.test(value.actorId);
}

function registerAssistantHandlers(dependencies = {}) {
  const {
    assistantRuntime,
    authorizeAssistantAccess,
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
  if (typeof authorizeAssistantAccess !== 'function') {
    throw new Error('Assistant IPC dependency missing: authorizeAssistantAccess');
  }

  function hasAuthorizedAccess(event) {
    try {
      const result = authorizeAssistantAccess(event);
      if (result && typeof result.then === 'function') return false;
      return isAuthorizedAssistantPrincipal(result);
    } catch {
      return false;
    }
  }

  registerIpcHandler('assistant:plan', async (event, ...args) => {
    if (args.length !== 1 || !isPlainDataEnvelope(args[0])) {
      return ASSISTANT_IPC_INVALID_INPUT;
    }
    if (!hasAuthorizedAccess(event)) return ASSISTANT_IPC_ACCESS_DENIED;
    return assistantRuntime.plan(args[0]);
  });
  registerIpcHandler('assistant:message', async (event, ...args) => {
    if (args.length !== 1 || !isPlainDataEnvelope(args[0])) {
      return ASSISTANT_IPC_INVALID_INPUT;
    }
    if (!hasAuthorizedAccess(event)) return ASSISTANT_IPC_ACCESS_DENIED;
    return assistantRuntime.message(args[0]);
  });
  registerIpcHandler('assistant:execute', async (event, ...args) => {
    if (args.length !== 1 || !isPlainDataEnvelope(args[0], ['jobId'])) {
      return ASSISTANT_IPC_INVALID_INPUT;
    }
    if (!hasAuthorizedAccess(event)) return ASSISTANT_IPC_ACCESS_DENIED;
    return assistantRuntime.execute(args[0]);
  });
}

module.exports = {
  isAuthorizedAssistantPrincipal,
  registerAssistantHandlers,
};
