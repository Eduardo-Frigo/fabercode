'use strict';

const util = require('util');

const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  CANARY_PROMOTION_REQUEST_VERSION,
  CANARY_PROMOTION_REVERT_RECEIPT_VERSION,
  CanaryPromotionBackendAmbiguousError,
  assertCanaryPromotionReceipt,
  assertCanaryPromotionRevertReceipt,
  createCanaryPromotionRequest,
} = require('./canary_promotion_contract');

const CANARY_PROMOTION_CONTROLLER_VERSION = 'canary-promotion-controller.v1';
const CANARY_PROMOTION_TRANSACTION_VERSION = 'canary-promotion-transaction.v1';

const CANARY_PROMOTION_CONTROLLER_REASONS = Object.freeze({
  INVALID_INPUT: 'CANARY_PROMOTION_CONTROLLER_INVALID_INPUT',
  PROMOTION_AMBIGUOUS: 'CANARY_PROMOTION_CONTROLLER_PROMOTION_AMBIGUOUS',
  PROMOTION_FAILED: 'CANARY_PROMOTION_CONTROLLER_PROMOTION_FAILED',
  PROMOTION_RECEIPT_INVALID:
    'CANARY_PROMOTION_CONTROLLER_PROMOTION_RECEIPT_INVALID',
  REVERT_FAILED: 'CANARY_PROMOTION_CONTROLLER_REVERT_FAILED',
  REVERT_RECEIPT_INVALID: 'CANARY_PROMOTION_CONTROLLER_REVERT_RECEIPT_INVALID',
});

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON = /^[a-z][a-z0-9_:-]{0,79}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPTION_KEYS = Object.freeze(['backend']);
const BACKEND_KEYS = Object.freeze([
  'version',
  'promote',
  'revert',
  'diagnostics',
]);
const BACKEND_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'conflictCheck',
  'inversePatch',
  'rejectionFrontier',
  'settlementMode',
  'branchMutation',
  'gitIndexMutation',
  'userDirtyMutation',
]);
const PROMOTION_INPUT_KEYS = Object.freeze([
  'promotionId',
  'session',
  'writeReceipt',
  'checkpoint',
  'workspaceRequest',
  'sourceSnapshot',
  'rootMutation',
]);
const TRANSACTION_KEYS = Object.freeze(['version', 'request', 'receipt']);
const REVERT_INPUT_KEYS = Object.freeze(['transaction', 'reason']);

class CanaryPromotionControllerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryPromotionControllerError';
    this.code = code;
  }
}

function controllerError(code) {
  return new CanaryPromotionControllerError(code);
}

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || frozen && !Object.isFrozen(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key)
      || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function inspectableFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  return value;
}

function captureBackend(value) {
  const fields = exactDataFields(value, BACKEND_KEYS, { frozen: true });
  if (!fields || typeof fields.get('version') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('version'))) {
    throw new TypeError('backend must be a frozen versioned promotion port');
  }
  const backend = Object.freeze({
    receiver: value,
    version: fields.get('version'),
    promote: inspectableFunction(fields.get('promote'), 'backend.promote'),
    revert: inspectableFunction(fields.get('revert'), 'backend.revert'),
    diagnostics: inspectableFunction(
      fields.get('diagnostics'),
      'backend.diagnostics'
    ),
  });
  let diagnostics;
  try {
    diagnostics = Reflect.apply(backend.diagnostics, backend.receiver, []);
  } catch {
    throw new TypeError('backend.diagnostics failed');
  }
  if (util.types.isPromise(diagnostics)) {
    try {
      Reflect.apply(Promise.prototype.then, diagnostics, [() => {}, () => {}]);
    } catch {
      // The backend is rejected regardless of Promise observation behavior.
    }
    throw new TypeError('backend.diagnostics must be synchronous');
  }
  const diagnosticFields = exactDataFields(
    diagnostics,
    BACKEND_DIAGNOSTIC_KEYS,
    { frozen: true }
  );
  if (!diagnosticFields
    || diagnosticFields.get('version') !== backend.version
    || diagnosticFields.get('conflictCheck') !== 'required'
    || diagnosticFields.get('inversePatch') !== 'job_scoped'
    || diagnosticFields.get('rejectionFrontier') !== 'pre_write_only'
    || diagnosticFields.get('settlementMode') !== 'terminal_receipt'
    || diagnosticFields.get('branchMutation') !== 'forbidden'
    || diagnosticFields.get('gitIndexMutation') !== 'forbidden'
    || diagnosticFields.get('userDirtyMutation') !== 'forbidden') {
    throw new TypeError(
      'backend must use conflict checks, job-scoped inverse patches, and preserve Git/user state'
    );
  }
  return backend;
}

function captureDependencies(options) {
  const fields = exactDataFields(options, OPTION_KEYS);
  if (!fields) throw new TypeError('Invalid canary promotion controller options');
  return Object.freeze({ backend: captureBackend(fields.get('backend')) });
}

function callNativeBackend(backend, methodName, args) {
  let pending;
  try {
    pending = Reflect.apply(backend[methodName], backend.receiver, args);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.reject(new TypeError('promotion backend call failed'));
  }
  if (!util.types.isPromise(pending)) {
    preflightDataGraph(pending);
    return Promise.reject(new TypeError('promotion backend must return a native Promise'));
  }
  return new Promise((resolve, reject) => {
    const rejected = (error) => {
      preflightDataGraph(error);
      reject(error instanceof CanaryPromotionBackendAmbiguousError
        ? new CanaryPromotionBackendAmbiguousError()
        : new TypeError('promotion backend rejected'));
    };
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, rejected]);
    } catch (error) {
      rejected(error);
    }
  });
}

function normalizePromotionInput(value) {
  const fields = exactDataFields(value, PROMOTION_INPUT_KEYS, { frozen: true });
  if (!fields) return null;
  try {
    return createCanaryPromotionRequest(Object.freeze(Object.fromEntries(
      PROMOTION_INPUT_KEYS.map((key) => [key, fields.get(key)])
    )));
  } catch {
    return null;
  }
}

function normalizeTransaction(value) {
  const fields = exactDataFields(value, TRANSACTION_KEYS, { frozen: true });
  if (!fields || fields.get('version') !== CANARY_PROMOTION_TRANSACTION_VERSION) {
    return null;
  }
  try {
    const receipt = assertCanaryPromotionReceipt(
      fields.get('receipt'),
      fields.get('request')
    );
    return Object.freeze({
      version: CANARY_PROMOTION_TRANSACTION_VERSION,
      request: fields.get('request'),
      receipt,
    });
  } catch {
    return null;
  }
}

function createCanaryPromotionController(options = {}) {
  const dependencies = captureDependencies(options);

  function diagnostics() {
    return Object.freeze({
      version: CANARY_PROMOTION_CONTROLLER_VERSION,
      backendVersion: dependencies.backend.version,
      promotionContract: CANARY_PROMOTION_REQUEST_VERSION,
      revertContract: CANARY_PROMOTION_REVERT_RECEIPT_VERSION,
    });
  }

  async function promote(input) {
    const request = normalizePromotionInput(input);
    if (!request) {
      throw controllerError(CANARY_PROMOTION_CONTROLLER_REASONS.INVALID_INPUT);
    }
    let value;
    try {
      value = await callNativeBackend(dependencies.backend, 'promote', [request]);
    } catch (error) {
      throw controllerError(error instanceof CanaryPromotionBackendAmbiguousError
        ? CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_AMBIGUOUS
        : CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_FAILED);
    }
    let receipt;
    try {
      receipt = assertCanaryPromotionReceipt(value, request);
    } catch {
      throw controllerError(
        CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_RECEIPT_INVALID
      );
    }
    return Object.freeze({
      version: CANARY_PROMOTION_TRANSACTION_VERSION,
      request,
      receipt,
    });
  }

  async function revert(input) {
    const fields = exactDataFields(input, REVERT_INPUT_KEYS, { frozen: true });
    const transaction = fields && normalizeTransaction(fields.get('transaction'));
    const reason = fields && fields.get('reason');
    if (!fields || !transaction || typeof reason !== 'string'
      || !SAFE_REASON.test(reason)) {
      throw controllerError(CANARY_PROMOTION_CONTROLLER_REASONS.INVALID_INPUT);
    }
    const backendInput = Object.freeze({
      request: transaction.request,
      promotionReceipt: transaction.receipt,
      reason,
    });
    let value;
    try {
      value = await callNativeBackend(
        dependencies.backend,
        'revert',
        [backendInput]
      );
    } catch {
      throw controllerError(CANARY_PROMOTION_CONTROLLER_REASONS.REVERT_FAILED);
    }
    try {
      return assertCanaryPromotionRevertReceipt(value, {
        request: transaction.request,
        promotionReceipt: transaction.receipt,
      });
    } catch {
      throw controllerError(
        CANARY_PROMOTION_CONTROLLER_REASONS.REVERT_RECEIPT_INVALID
      );
    }
  }

  return Object.freeze({
    version: CANARY_PROMOTION_CONTROLLER_VERSION,
    promote,
    revert,
    diagnostics,
  });
}

module.exports = {
  CANARY_PROMOTION_CONTROLLER_REASONS,
  CANARY_PROMOTION_CONTROLLER_VERSION,
  CANARY_PROMOTION_TRANSACTION_VERSION,
  CanaryPromotionControllerError,
  createCanaryPromotionController,
};
