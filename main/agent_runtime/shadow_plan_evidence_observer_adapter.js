'use strict';

const util = require('util');

const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('./harness_contracts');
const {
  SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
  SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION,
  createShadowPlanEvidenceSuite,
} = require('./shadow_plan_evidence_suite');
const {
  SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION,
} = require('./shadow_plan_semantic_comparator');

const SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_VERSION =
  'shadow-plan-evidence-observer-adapter.v1';
const SHADOW_PLAN_EVIDENCE_OBSERVATION_SCHEMA_VERSION =
  'shadow-plan-evidence-observation.v1';
const SHADOW_PLAN_EVIDENCE_CHECK_DEFINITION_SCHEMA_VERSION =
  'shadow-plan-evidence-check-definition.v1';
const SHADOW_PLAN_EVIDENCE_OBSERVER_CHECK_PORT_VERSION =
  'shadow-plan-evidence-observer-check-port.v1';
const SHADOW_PLAN_EVIDENCE_OBSERVER_SAFETY_PORT_VERSION =
  'shadow-plan-evidence-observer-safety-port.v1';

const SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS = Object.freeze({
  INVALID_OBSERVATION: 'SHADOW_PLAN_EVIDENCE_INVALID_OBSERVATION',
  INVALID_OPTIONS: 'SHADOW_PLAN_EVIDENCE_OBSERVER_INVALID_OPTIONS',
  OBSERVATION_FAILED: 'SHADOW_PLAN_EVIDENCE_OBSERVATION_FAILED',
  OBSERVATION_TIMEOUT: 'SHADOW_PLAN_EVIDENCE_OBSERVATION_TIMEOUT',
});

const MIN_TIMEOUT_MS = 10;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CHECKS = 32;
const MAX_EVIDENCE_PER_SECTION = 32;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const VALID_ROLES = new Set(['authoritative', 'shadow']);
const VALID_WORKSPACE_MODES = new Set(['read_only', 'disposable_copy']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'kernelId',
  'output',
  'diagnostics',
]);

class ShadowPlanEvidenceObserverAdapterError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ShadowPlanEvidenceObserverAdapterError';
    this.code = code;
    if (typeof details.causeCode === 'string'
      && /^[A-Z0-9_]{1,128}$/.test(details.causeCode)) {
      this.causeCode = details.causeCode;
    }
  }
}

function adapterError(code, details) {
  return new ShadowPlanEvidenceObserverAdapterError(code, details);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys, {
  frozen = false,
} = {}) {
  if (!isPlainRecord(value) || (frozen && !Object.isFrozen(value))) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseFrozenArray(value, fieldName, minimum, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || !Object.isFrozen(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum || value.length > maximum) {
    throw new TypeError(fieldName + ' must be a bounded frozen array');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(fieldName + ' must be dense');
  }
  return keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(fieldName + ' must contain data values');
    }
    return descriptor.value;
  });
}

function assertIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(fieldName + ' must be a safe identifier');
  }
  return value;
}

function assertTimeout(value, fieldName) {
  if (!Number.isSafeInteger(value)
    || value < MIN_TIMEOUT_MS
    || value > MAX_TIMEOUT_MS) {
    throw new TypeError(fieldName + ' is outside the bounded timeout range');
  }
  return value;
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

function captureObserver(value) {
  const fields = exactDataFields(value, ['version', 'observe'], undefined, {
    frozen: true,
  });
  if (!fields) throw new TypeError('observer must be a frozen port');
  return Object.freeze({
    receiver: value,
    version: assertIdentifier(fields.get('version'), 'observer.version'),
    observe: inspectableFunction(fields.get('observe'), 'observer.observe'),
  });
}

function captureCheckDefinition(value, index) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'id',
    'criterionId',
    'weightBasisPoints',
    'timeoutMs',
  ], undefined, { frozen: true });
  const weightBasisPoints = fields && fields.get('weightBasisPoints');
  if (!fields
    || fields.get('schemaVersion')
      !== SHADOW_PLAN_EVIDENCE_CHECK_DEFINITION_SCHEMA_VERSION
    || !Number.isSafeInteger(weightBasisPoints)
    || weightBasisPoints <= 0
    || weightBasisPoints > 10_000) {
    throw new TypeError('check definition ' + index + ' is invalid');
  }
  return Object.freeze({
    id: assertIdentifier(fields.get('id'), 'check definition id'),
    criterionId: assertIdentifier(
      fields.get('criterionId'),
      'check definition criterionId'
    ),
    weightBasisPoints,
    timeoutMs: assertTimeout(
      fields.get('timeoutMs'),
      'check definition timeoutMs'
    ),
  });
}

function captureCheckDefinitions(value) {
  return Object.freeze(denseFrozenArray(
    value,
    'check definitions',
    1,
    MAX_CHECKS
  ).map(captureCheckDefinition));
}

function inspectEvaluatorIdentity(value) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'role',
    'request',
    'result',
  ], undefined, { frozen: true });
  if (!fields
    || fields.get('schemaVersion')
      !== SHADOW_PLAN_SEMANTIC_EVALUATOR_INPUT_SCHEMA_VERSION
    || !VALID_ROLES.has(fields.get('role'))) {
    throw adapterError(
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OBSERVATION
    );
  }
  const request = fields.get('request');
  const result = fields.get('result');
  try {
    assertHarnessRequest(request);
  } catch {
    throw adapterError(
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OBSERVATION
    );
  }
  const resultFields = exactDataFields(
    result,
    RESULT_KEYS,
    RESULT_KEYS,
    { frozen: true }
  );
  if (!Object.isFrozen(request)
    || request.operation !== HARNESS_OPERATIONS.PLAN
    || !resultFields
    || resultFields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
    || resultFields.get('requestId') !== request.requestId
    || resultFields.get('operation') !== HARNESS_OPERATIONS.PLAN) {
    throw adapterError(
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OBSERVATION
    );
  }
  try {
    return Object.freeze({
      role: fields.get('role'),
      requestId: assertIdentifier(request.requestId, 'requestId'),
      kernelId: assertIdentifier(
        resultFields.get('kernelId'),
        'kernelId'
      ),
    });
  } catch {
    throw adapterError(
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OBSERVATION
    );
  }
}

function assertOpaqueEvidenceList(value, fieldName) {
  const items = denseFrozenArray(
    value,
    fieldName,
    1,
    MAX_EVIDENCE_PER_SECTION
  );
  for (const item of items) {
    const fields = exactDataFields(item, [
      'kind',
      'locator',
      'digest',
    ], undefined, { frozen: true });
    if (!fields
      || typeof fields.get('kind') !== 'string'
      || typeof fields.get('locator') !== 'string'
      || typeof fields.get('digest') !== 'string') {
      throw new TypeError(fieldName + ' is invalid');
    }
  }
  return value;
}

function inspectCheckReceipt(value, definition, index) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'checkId',
    'passed',
    'evidence',
  ], undefined, { frozen: true });
  if (!fields
    || fields.get('schemaVersion')
      !== SHADOW_PLAN_EVIDENCE_CHECK_RECEIPT_SCHEMA_VERSION
    || fields.get('checkId') !== definition.id
    || typeof fields.get('passed') !== 'boolean') {
    throw new TypeError('observation check ' + index + ' is invalid');
  }
  assertOpaqueEvidenceList(
    fields.get('evidence'),
    'observation check evidence'
  );
  return value;
}

function inspectSafetyReceipt(value) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'workspaceWrites',
    'unrelatedFilesChanged',
    'evidence',
  ], undefined, { frozen: true });
  const workspaceWrites = fields && fields.get('workspaceWrites');
  const unrelatedFilesChanged = fields
    && fields.get('unrelatedFilesChanged');
  if (!fields
    || fields.get('schemaVersion')
      !== SHADOW_PLAN_SAFETY_AUDIT_RECEIPT_SCHEMA_VERSION
    || !Number.isSafeInteger(workspaceWrites)
    || workspaceWrites < 0
    || !Number.isSafeInteger(unrelatedFilesChanged)
    || unrelatedFilesChanged < 0) {
    throw new TypeError('observation safety receipt is invalid');
  }
  assertOpaqueEvidenceList(
    fields.get('evidence'),
    'observation safety evidence'
  );
  return value;
}

function inspectObservation(value, {
  identity,
  observerVersion,
  workspaceMode,
  definitions,
}) {
  try {
    const fields = exactDataFields(value, [
      'schemaVersion',
      'observationId',
      'observerVersion',
      'workspaceMode',
      'role',
      'requestId',
      'kernelId',
      'checks',
      'safety',
    ], undefined, { frozen: true });
    if (!fields
      || fields.get('schemaVersion')
        !== SHADOW_PLAN_EVIDENCE_OBSERVATION_SCHEMA_VERSION
      || fields.get('observerVersion') !== observerVersion
      || fields.get('workspaceMode') !== workspaceMode
      || fields.get('role') !== identity.role
      || fields.get('requestId') !== identity.requestId
      || fields.get('kernelId') !== identity.kernelId) {
      throw new TypeError('observation identity is invalid');
    }
    assertIdentifier(fields.get('observationId'), 'observationId');
    const receipts = denseFrozenArray(
      fields.get('checks'),
      'observation checks',
      definitions.length,
      definitions.length
    ).map((receipt, index) => inspectCheckReceipt(
      receipt,
      definitions[index],
      index
    ));
    return Object.freeze({
      checks: Object.freeze(receipts),
      safety: inspectSafetyReceipt(fields.get('safety')),
    });
  } catch {
    throw adapterError(
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OBSERVATION
    );
  }
}

function safeCauseDetails(error) {
  let causeCode = null;
  if (error && (typeof error === 'object' || typeof error === 'function')
    && !util.types.isProxy(error)) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      if (descriptor && Object.hasOwn(descriptor, 'value')
        && typeof descriptor.value === 'string') {
        causeCode = descriptor.value;
      }
    } catch {
      causeCode = null;
    }
  }
  return Object.freeze({ causeCode });
}

function isAdapterError(value) {
  try {
    return value instanceof ShadowPlanEvidenceObserverAdapterError;
  } catch {
    return false;
  }
}

function normalizeObserverFailure(error) {
  if (isAdapterError(error)) return error;
  return adapterError(
    SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.OBSERVATION_FAILED,
    safeCauseDetails(error)
  );
}

function callObserverWithTimeout(observer, input, timeoutMs) {
  let pending;
  try {
    pending = Reflect.apply(observer.observe, observer.receiver, [input]);
  } catch (error) {
    return Promise.reject(normalizeObserverFailure(error));
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(adapterError(
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.OBSERVATION_FAILED
    ));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(adapterError(
        SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.OBSERVATION_TIMEOUT
      ));
    }, timeoutMs);
    try {
      Reflect.apply(Promise.prototype.then, pending, [
        (observation) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(observation);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(normalizeObserverFailure(error));
        },
      ]);
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(adapterError(
          SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.OBSERVATION_FAILED
        ));
      }
    }
  });
}

function createShadowPlanEvidenceObserverAdapter(options = {}) {
  let suiteId;
  let workspaceMode;
  let definitions;
  let safetyTimeoutMs;
  let observerTimeoutMs;
  let observer;
  try {
    const fields = exactDataFields(options, [
      'suiteId',
      'workspaceMode',
      'checks',
      'safetyTimeoutMs',
      'observerTimeoutMs',
      'observer',
    ]);
    if (!fields) throw new TypeError('observer adapter options are invalid');
    suiteId = assertIdentifier(fields.get('suiteId'), 'suiteId');
    workspaceMode = fields.get('workspaceMode');
    if (!VALID_WORKSPACE_MODES.has(workspaceMode)) {
      throw new TypeError('workspaceMode is invalid');
    }
    definitions = captureCheckDefinitions(fields.get('checks'));
    safetyTimeoutMs = assertTimeout(
      fields.get('safetyTimeoutMs'),
      'safetyTimeoutMs'
    );
    observerTimeoutMs = assertTimeout(
      fields.get('observerTimeoutMs'),
      'observerTimeoutMs'
    );
    if (observerTimeoutMs >= safetyTimeoutMs
      || definitions.some((definition) => (
        observerTimeoutMs >= definition.timeoutMs
      ))) {
      throw new TypeError('observer timeout must settle before suite timeouts');
    }
    observer = captureObserver(fields.get('observer'));
  } catch {
    throw adapterError(
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OPTIONS
    );
  }

  const activeByInput = new WeakMap();
  let observationAttempts = 0;
  let observations = 0;
  let observationRejections = 0;
  let observationTimeouts = 0;
  let activeObservations = 0;
  let lastObservationFailureCode = null;

  function acquireObservation(input) {
    const existing = activeByInput.get(input);
    if (existing) return existing;
    observationAttempts += 1;
    activeObservations += 1;
    let pending;
    try {
      const identity = inspectEvaluatorIdentity(input);
      pending = callObserverWithTimeout(
        observer,
        input,
        observerTimeoutMs
      ).then((value) => inspectObservation(value, {
        identity,
        observerVersion: observer.version,
        workspaceMode,
        definitions,
      }));
    } catch (error) {
      pending = Promise.reject(normalizeObserverFailure(error));
    }
    const tracked = pending.then(
      (value) => {
        observations += 1;
        lastObservationFailureCode = null;
        return value;
      },
      (error) => {
        const normalized = normalizeObserverFailure(error);
        observationRejections += 1;
        if (normalized.code
          === SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.OBSERVATION_TIMEOUT) {
          observationTimeouts += 1;
        }
        lastObservationFailureCode = normalized.code;
        throw normalized;
      }
    );
    activeByInput.set(input, tracked);
    return tracked;
  }

  function releaseObservation(input) {
    if (activeByInput.delete(input)) activeObservations -= 1;
  }

  const checks = Object.freeze(definitions.map((definition, index) => (
    Object.freeze({
      version: SHADOW_PLAN_EVIDENCE_OBSERVER_CHECK_PORT_VERSION,
      id: definition.id,
      criterionId: definition.criterionId,
      weightBasisPoints: definition.weightBasisPoints,
      timeoutMs: definition.timeoutMs,
      run(input) {
        return acquireObservation(input).then(
          (value) => value.checks[index]
        );
      },
    })
  )));
  const safetyAudit = Object.freeze({
    version: SHADOW_PLAN_EVIDENCE_OBSERVER_SAFETY_PORT_VERSION,
    timeoutMs: safetyTimeoutMs,
    run(input) {
      return acquireObservation(input)
        .then((value) => value.safety)
        .finally(() => releaseObservation(input));
    },
  });

  let suite;
  try {
    suite = createShadowPlanEvidenceSuite({
      suiteId,
      workspaceMode,
      checks,
      safetyAudit,
    });
  } catch {
    throw adapterError(
      SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS.INVALID_OPTIONS
    );
  }

  function diagnostics() {
    const suiteDiagnostics = suite.diagnostics();
    return Object.freeze({
      version: SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_VERSION,
      observerVersion: observer.version,
      suiteVersion: SHADOW_PLAN_EVIDENCE_SUITE_VERSION,
      suiteId,
      workspaceMode,
      checks: definitions.length,
      observationAttempts,
      observations,
      observationRejections,
      observationTimeouts,
      activeObservations,
      suiteAttempts: suiteDiagnostics.attempts,
      suiteEvaluations: suiteDiagnostics.evaluations,
      suiteRecords: suiteDiagnostics.records,
      suiteRejections: suiteDiagnostics.rejections,
      lastObservationFailureCode,
      lastSuiteFailureCode: suiteDiagnostics.lastFailureCode,
    });
  }

  return Object.freeze({
    version: SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_VERSION,
    suiteId,
    workspaceMode,
    grader: suite.grader,
    observe: suite.observe,
    diagnostics,
  });
}

module.exports = {
  SHADOW_PLAN_EVIDENCE_CHECK_DEFINITION_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_OBSERVATION_SCHEMA_VERSION,
  SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_REASONS,
  SHADOW_PLAN_EVIDENCE_OBSERVER_ADAPTER_VERSION,
  ShadowPlanEvidenceObserverAdapterError,
  createShadowPlanEvidenceObserverAdapter,
};
