'use strict';

const ASSISTANT_RUNTIME_FACADE_VERSION = 'assistant-runtime-facade.v1';

const ASSISTANT_RUNTIME_FACADE_REASONS = Object.freeze({
  INVALID_INPUT: 'assistant_runtime_invalid_input',
  PROJECT_NOT_AUTHORIZED: 'assistant_runtime_project_not_authorized',
  PRODUCT_ACCESS_REQUIRED: 'assistant_runtime_product_access_required',
  RETRY_REQUIRES_RETRY_API: 'assistant_runtime_retry_requires_retry_api',
});
const PRODUCT_ACCESS_PRINCIPAL_KINDS = new Set(['account', 'local_development']);
const FORBIDDEN_IDENTITY_FIELDS = new Set(['principal', 'actorId', 'access', 'accessContext']);

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, fieldName) {
  if (!isPlainRecord(value)) throw new TypeError(`${fieldName} must be a plain data record`);
  const fields = new Map();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${fieldName} must not contain symbols`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function deny(code, message) {
  return Object.freeze({
    ok: false,
    code,
    message: String(message || 'A operação do assistente foi rejeitada.'),
  });
}

function isSynchronousResult(value) {
  return !(value && typeof value.then === 'function');
}

function createAssistantRuntimeFacade(options = {}) {
  const fields = dataFields(options, 'assistant runtime facade options');
  const coordinator = fields.get('coordinator');
  const harnessRouter = fields.get('harnessRouter');
  const authorizePlanningPayload = fields.get('authorizePlanningPayload');
  const authorizeProductAccess = fields.get('authorizeProductAccess');
  const kernelId = fields.get('kernelId');

  if (!coordinator || typeof coordinator !== 'object') {
    throw new TypeError('coordinator is required');
  }
  for (const method of ['coordinatePlanning', 'execute', 'retry']) {
    if (typeof coordinator[method] !== 'function') {
      throw new TypeError(`coordinator.${method} is required`);
    }
  }
  if (!harnessRouter || typeof harnessRouter !== 'object') {
    throw new TypeError('harnessRouter is required');
  }
  for (const method of ['getStatus', 'message', 'plan']) {
    if (typeof harnessRouter[method] !== 'function') {
      throw new TypeError(`harnessRouter.${method} is required`);
    }
  }
  if (typeof authorizePlanningPayload !== 'function') {
    throw new TypeError('authorizePlanningPayload is required');
  }
  if (typeof authorizeProductAccess !== 'function') {
    throw new TypeError('authorizeProductAccess is required');
  }
  if (typeof kernelId !== 'string' || !kernelId.trim() || kernelId !== kernelId.trim() || kernelId.includes('\0')) {
    throw new TypeError('kernelId is required');
  }

  function hasProductAccess(operation) {
    try {
      const principal = authorizeProductAccess(Object.freeze({ operation }));
      if (!isSynchronousResult(principal) || !Object.isFrozen(principal)) return false;
      const principalFields = dataFields(principal, 'product access principal');
      return principalFields.size === 2
        && principalFields.has('kind')
        && principalFields.has('actorId')
        && PRODUCT_ACCESS_PRINCIPAL_KINDS.has(principalFields.get('kind'))
        && typeof principalFields.get('actorId') === 'string'
        && /^[A-Za-z0-9._:@-]{1,256}$/.test(principalFields.get('actorId'));
    } catch {
      return false;
    }
  }

  function authorizePayload(operation, payload) {
    let payloadFields;
    try {
      payloadFields = dataFields(payload, `${operation} payload`);
    } catch {
      return deny(ASSISTANT_RUNTIME_FACADE_REASONS.INVALID_INPUT);
    }
    if (Array.from(payloadFields.keys()).some((key) => FORBIDDEN_IDENTITY_FIELDS.has(key))) {
      return deny(ASSISTANT_RUNTIME_FACADE_REASONS.INVALID_INPUT);
    }
    if (payloadFields.has('jobId')) {
      return deny(
        ASSISTANT_RUNTIME_FACADE_REASONS.RETRY_REQUIRES_RETRY_API,
        'Retentativas devem usar somente a API autoritativa de job.',
      );
    }

    let authorization;
    try {
      authorization = authorizePlanningPayload(Object.freeze({ operation, payload }));
      if (!isSynchronousResult(authorization)) throw new TypeError('authorization must be synchronous');
      const authorizationFields = dataFields(authorization, 'planning authorization result');
      if (authorizationFields.get('ok') !== true || !authorizationFields.has('payload')) {
        return deny(
          ASSISTANT_RUNTIME_FACADE_REASONS.PROJECT_NOT_AUTHORIZED,
          authorizationFields.has('message') ? authorizationFields.get('message') : undefined,
        );
      }
      dataFields(authorizationFields.get('payload'), 'authorized planning payload');
      return Object.freeze({ ok: true, payload: authorizationFields.get('payload') });
    } catch {
      return deny(ASSISTANT_RUNTIME_FACADE_REASONS.PROJECT_NOT_AUTHORIZED);
    }
  }

  async function coordinate(operation, payload, invoke) {
    if (!hasProductAccess(operation)) {
      return deny(
        ASSISTANT_RUNTIME_FACADE_REASONS.PRODUCT_ACCESS_REQUIRED,
        'Autenticação da conta ou modo local de desenvolvimento necessário.',
      );
    }
    const authorization = authorizePayload(operation, payload);
    if (!authorization.ok) return authorization;
    return coordinator.coordinatePlanning({
      operation,
      payload: authorization.payload,
      kernelId,
      invoke,
    });
  }

  function plan(payload) {
    return coordinate('plan', payload, (authorizedPayload) => harnessRouter.plan(authorizedPayload));
  }

  function message(payload) {
    let mapOnly = false;
    try {
      const payloadFields = dataFields(payload, 'message payload');
      mapOnly = payloadFields.get('isMapChat') === true;
    } catch {
      return Promise.resolve(deny(ASSISTANT_RUNTIME_FACADE_REASONS.INVALID_INPUT));
    }
    const operation = mapOnly ? 'map_message' : 'message';
    return coordinate(operation, payload, (authorizedPayload) => harnessRouter.message(authorizedPayload));
  }

  function execute(input) {
    if (!hasProductAccess('execute')) {
      return Promise.resolve(deny(
        ASSISTANT_RUNTIME_FACADE_REASONS.PRODUCT_ACCESS_REQUIRED,
        'Autenticação da conta ou modo local de desenvolvimento necessário.',
      ));
    }
    try {
      const inputFields = dataFields(input, 'execute input');
      if (inputFields.size !== 1 || !inputFields.has('jobId')) {
        throw new TypeError('execute accepts jobId only');
      }
    } catch {
      return Promise.resolve(deny(ASSISTANT_RUNTIME_FACADE_REASONS.INVALID_INPUT));
    }
    return coordinator.execute(input);
  }

  function retry(input) {
    if (!hasProductAccess('retry')) {
      return Promise.resolve(deny(
        ASSISTANT_RUNTIME_FACADE_REASONS.PRODUCT_ACCESS_REQUIRED,
        'Autenticação da conta ou modo local de desenvolvimento necessário.',
      ));
    }
    let inputFields;
    try {
      inputFields = dataFields(input, 'retry input');
      if (inputFields.size !== 1 || !inputFields.has('jobId')) {
        throw new TypeError('retry accepts jobId only');
      }
    } catch {
      return Promise.resolve(deny(ASSISTANT_RUNTIME_FACADE_REASONS.INVALID_INPUT));
    }
    return coordinator.retry({
      jobId: inputFields.get('jobId'),
      kernelId,
      invoke: (authorizedPayload) => harnessRouter.plan(authorizedPayload),
    });
  }

  function getStatus() {
    return harnessRouter.getStatus();
  }

  return Object.freeze({
    execute,
    getStatus,
    message,
    plan,
    retry,
  });
}

module.exports = {
  ASSISTANT_RUNTIME_FACADE_REASONS,
  ASSISTANT_RUNTIME_FACADE_VERSION,
  createAssistantRuntimeFacade,
};
