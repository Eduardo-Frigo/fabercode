'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  areEquivalentPortablePaths,
} = require('../capabilities/sandbox_backend_contract');
const {
  MAX_WRITE_SET_ENTRIES,
} = require('../agent_runtime/canary_staging_write_set_contract');
const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('../agent_runtime/harness_contracts');
const {
  CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
  CANARY_TRANSACTIONAL_STAGING_RESULT_DIAGNOSTICS_SCHEMA_VERSION,
} = require('../agent_runtime/canary_transactional_staging_executor');

const CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_VERSION =
  'canary-edit-terminal-observer-adapter.v1';

const CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS = Object.freeze({
  COMPLETION_CALLBACK_FAILED:
    'CANARY_EDIT_TERMINAL_COMPLETION_CALLBACK_FAILED',
  FAILURE_CALLBACK_FAILED:
    'CANARY_EDIT_TERMINAL_FAILURE_CALLBACK_FAILED',
  INVALID_RESULT: 'CANARY_EDIT_TERMINAL_OBSERVER_INVALID_RESULT',
  RUNNER_REJECTED: 'CANARY_EDIT_TERMINAL_RUNNER_REJECTED',
});

const OPTION_KEYS = Object.freeze([
  'runner',
  'onCanaryCompleted',
  'onCanaryFailed',
]);
const RUNNER_KEYS = Object.freeze(['version', 'execute', 'diagnostics']);
const RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'kernelId',
  'output',
  'diagnostics',
]);
const OUTPUT_KEYS = Object.freeze([
  'status',
  'mutationScope',
  'changedPaths',
  'writeSetDigest',
]);
const RESULT_DIAGNOSTIC_KEYS = Object.freeze([
  'schemaVersion',
  'executorVersion',
  'promotionId',
  'stagingId',
  'checkpointDigest',
  'writeSetDigest',
  'sourceBeforeDigest',
  'sourceAfterDigest',
  'changedPaths',
  'stagingDiscarded',
]);
const AUTHORITY_BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const PROTECTED_PATH =
  /(?:^|\/)(?:\.git|\.faber|node_modules|\.env(?:\..*)?)(?:\/|$)/i;
const MAX_RELATIVE_PATH_BYTES = 4096;

class CanaryEditTerminalObserverAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryEditTerminalObserverAdapterError';
    this.code = code;
  }
}

function adapterError(code) {
  return new CanaryEditTerminalObserverAdapterError(code);
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

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
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

function ownDataValue(value, key, { enumerable = null } = {}) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || descriptor.value === undefined
    || enumerable !== null && descriptor.enumerable !== enumerable) return null;
  return descriptor.value;
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

function inspectRunnerDiagnostics(port) {
  let diagnostics;
  try {
    diagnostics = Reflect.apply(port.diagnostics, port.receiver, []);
  } catch {
    throw new TypeError('runner.diagnostics failed');
  }
  if (!isPlainRecord(diagnostics) || !Object.isFrozen(diagnostics)) {
    throw new TypeError('runner.diagnostics must return synchronous frozen data');
  }
  const fields = new Map();
  for (const key of Reflect.ownKeys(diagnostics)) {
    const descriptor = typeof key === 'string'
      ? Object.getOwnPropertyDescriptor(diagnostics, key)
      : null;
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !['string', 'number', 'boolean'].includes(typeof descriptor.value)
        && descriptor.value !== null) {
      throw new TypeError('runner.diagnostics must contain scalar data only');
    }
    fields.set(key, descriptor.value);
  }
  if (fields.get('version') !== port.version
    || fields.get('authoritativeKernelId') !== port.authoritativeKernelId
    || fields.get('canaryKernelId') !== port.canaryKernelId) {
    throw new TypeError('runner diagnostics identity changed');
  }
  return diagnostics;
}

function captureRunner(value) {
  const fields = exactDataFields(value, RUNNER_KEYS, { frozen: true });
  const version = fields && fields.get('version');
  if (!fields || typeof version !== 'string' || !SAFE_IDENTIFIER.test(version)) {
    throw new TypeError('runner must be a frozen versioned canary port');
  }
  const execute = inspectableFunction(fields.get('execute'), 'runner.execute');
  const diagnostics = inspectableFunction(
    fields.get('diagnostics'),
    'runner.diagnostics'
  );
  let initialDiagnostics;
  try {
    initialDiagnostics = Reflect.apply(diagnostics, value, []);
  } catch {
    throw new TypeError('runner.diagnostics failed');
  }
  if (!isPlainRecord(initialDiagnostics)
    || !Object.isFrozen(initialDiagnostics)) {
    throw new TypeError('runner.diagnostics must return synchronous frozen data');
  }
  const authoritativeKernelId = ownDataValue(
    initialDiagnostics,
    'authoritativeKernelId',
    { enumerable: true }
  );
  const canaryKernelId = ownDataValue(
    initialDiagnostics,
    'canaryKernelId',
    { enumerable: true }
  );
  if (ownDataValue(initialDiagnostics, 'version', { enumerable: true }) !== version
    || typeof authoritativeKernelId !== 'string'
    || !SAFE_IDENTIFIER.test(authoritativeKernelId)
    || typeof canaryKernelId !== 'string'
    || !SAFE_IDENTIFIER.test(canaryKernelId)
    || canaryKernelId === authoritativeKernelId) {
    throw new TypeError('runner diagnostics identity is invalid');
  }
  const port = Object.freeze({
    receiver: value,
    version,
    authoritativeKernelId,
    canaryKernelId,
    execute,
    diagnostics,
  });
  inspectRunnerDiagnostics(port);
  return port;
}

function captureDependencies(options) {
  const fields = exactDataFields(options, OPTION_KEYS);
  if (!fields) {
    throw new TypeError('Invalid canary edit terminal observer options');
  }
  let runner;
  let onCanaryCompleted;
  let onCanaryFailed;
  try {
    runner = captureRunner(fields.get('runner'));
    onCanaryCompleted = inspectableFunction(
      fields.get('onCanaryCompleted'),
      'onCanaryCompleted'
    );
    onCanaryFailed = inspectableFunction(
      fields.get('onCanaryFailed'),
      'onCanaryFailed'
    );
  } catch {
    throw new TypeError('Invalid canary edit terminal observer options');
  }
  return Object.freeze({ runner, onCanaryCompleted, onCanaryFailed });
}

function bindingsMatch(left, right) {
  return AUTHORITY_BINDING_KEYS.every((key) => left[key] === right[key]);
}

function inspectRequestIdentity(value) {
  try {
    assertHarnessRequest(value);
  } catch {
    return null;
  }
  if (!Object.isFrozen(value) || value.operation !== HARNESS_OPERATIONS.EXECUTE
    || typeof value.requestId !== 'string'
    || !SAFE_IDENTIFIER.test(value.requestId)) return null;
  const executionContext = ownDataValue(value, 'executionContext', {
    enumerable: true,
  });
  if (!isPlainRecord(executionContext) || !Object.isFrozen(executionContext)) {
    return null;
  }
  const rawBinding = ownDataValue(executionContext, 'authorityBinding', {
    enumerable: false,
  });
  if (!rawBinding || !Object.isFrozen(rawBinding)) return null;
  let binding;
  try {
    binding = createCapabilityDelegationBinding(rawBinding);
  } catch {
    return null;
  }
  if (!bindingsMatch(binding, rawBinding)
    || ownDataValue(executionContext, 'jobId', { enumerable: true })
      !== binding.jobId) return null;
  const projectInfo = ownDataValue(value, 'projectInfo', { enumerable: true });
  if (!isPlainRecord(projectInfo) || !Object.isFrozen(projectInfo)) return null;
  const id = ownDataValue(projectInfo, 'id', { enumerable: true });
  const projectIdAlias = ownDataValue(projectInfo, 'projectId', {
    enumerable: true,
  });
  const projectId = typeof id === 'string' ? id : projectIdAlias;
  const rootPath = ownDataValue(projectInfo, 'rootPath', { enumerable: true });
  if (projectId !== binding.projectId
    || projectIdAlias !== null && projectIdAlias !== binding.projectId
    || !areEquivalentPortablePaths(rootPath, binding.canonicalRootPath)) return null;
  return Object.freeze({
    jobId: binding.jobId,
    projectId: binding.projectId,
    requestId: value.requestId,
  });
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')
    || value.includes('\\')
    || Buffer.byteLength(value, 'utf8') > MAX_RELATIVE_PATH_BYTES
    || value.startsWith('/') || /^[A-Za-z]:\//.test(value)
    || value.startsWith('//') || PROTECTED_PATH.test(value)) return false;
  return value.split('/').every((component) => component
    && component !== '.' && component !== '..');
}

function inspectChangedPaths(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || !Object.isFrozen(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > MAX_WRITE_SET_ENTRIES) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const paths = [];
  let previous = null;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const relativePath = descriptor && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : null;
    if (!safeRelativePath(relativePath)
      || previous !== null && relativePath <= previous) return null;
    paths.push(relativePath);
    previous = relativePath;
  }
  return Object.freeze(paths);
}

function inspectCanaryOutcome(value) {
  const fields = exactDataFields(value, OUTPUT_KEYS, { frozen: true });
  if (!fields || fields.get('status') !== 'completed'
    || fields.get('mutationScope') !== 'staging') return null;
  const changedPaths = inspectChangedPaths(fields.get('changedPaths'));
  let writeSetDigest;
  try {
    writeSetDigest = normalizeDigest(
      fields.get('writeSetDigest'),
      'writeSetDigest'
    );
  } catch {
    return null;
  }
  if (!changedPaths || writeSetDigest !== fields.get('writeSetDigest')) {
    return null;
  }
  return Object.freeze({ changedPaths, writeSetDigest });
}

function inspectPromotionDiagnostics(value, outcome) {
  const fields = exactDataFields(
    value,
    RESULT_DIAGNOSTIC_KEYS,
    { frozen: true }
  );
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_TRANSACTIONAL_STAGING_RESULT_DIAGNOSTICS_SCHEMA_VERSION
    || fields.get('executorVersion')
      !== CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION
    || typeof fields.get('promotionId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('promotionId'))
    || typeof fields.get('stagingId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('stagingId'))
    || fields.get('stagingDiscarded') !== true) return null;
  let checkpointDigest;
  let writeSetDigest;
  let sourceBeforeDigest;
  let sourceAfterDigest;
  try {
    checkpointDigest = normalizeDigest(
      fields.get('checkpointDigest'),
      'checkpointDigest'
    );
    writeSetDigest = normalizeDigest(
      fields.get('writeSetDigest'),
      'writeSetDigest'
    );
    sourceBeforeDigest = normalizeDigest(
      fields.get('sourceBeforeDigest'),
      'sourceBeforeDigest'
    );
    sourceAfterDigest = normalizeDigest(
      fields.get('sourceAfterDigest'),
      'sourceAfterDigest'
    );
  } catch {
    return null;
  }
  const changedPaths = inspectChangedPaths(fields.get('changedPaths'));
  if (checkpointDigest !== fields.get('checkpointDigest')
    || writeSetDigest !== fields.get('writeSetDigest')
    || sourceBeforeDigest !== fields.get('sourceBeforeDigest')
    || sourceAfterDigest !== fields.get('sourceAfterDigest')
    || writeSetDigest !== outcome.writeSetDigest
    || !changedPaths
    || changedPaths.length !== outcome.changedPaths.length
    || changedPaths.some((pathValue, index) => (
      pathValue !== outcome.changedPaths[index]
    ))) return null;
  return Object.freeze({
    promotionId: fields.get('promotionId'),
  });
}

function inspectResult(value, request, dependencies) {
  const fields = exactDataFields(value, RESULT_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
    || fields.get('requestId') !== request.requestId
    || fields.get('operation') !== HARNESS_OPERATIONS.EXECUTE
    || ![
      dependencies.runner.authoritativeKernelId,
      dependencies.runner.canaryKernelId,
    ].includes(fields.get('kernelId'))) return null;
  return fields;
}

function callRunner(port, request) {
  let pending;
  try {
    pending = Reflect.apply(port.execute, port.receiver, [request]);
  } catch (error) {
    return Promise.reject(error);
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(new TypeError('runner.execute must return a native Promise'));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [
      () => undefined,
      () => undefined,
    ]);
  } catch {
    // The callback is still rejected as asynchronous by the observer contract.
  }
  return true;
}

function sanitizedFailureReason(error) {
  const code = ownDataValue(error, 'code');
  return typeof code === 'string' && SAFE_FAILURE_CODE.test(code)
    ? code
    : CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.RUNNER_REJECTED;
}

function createCanaryEditTerminalObserverAdapter(options = {}) {
  const dependencies = captureDependencies(options);
  let requests = 0;
  let canaryCompletions = 0;
  let canaryFailures = 0;
  let legacyFallbacks = 0;
  let observationFailures = 0;
  let lastObservationFailureCode = null;

  function recordObservationFailure(code) {
    observationFailures += 1;
    lastObservationFailureCode = code;
  }

  function callTerminalCallback(callback, observation, failureCode) {
    let result;
    try {
      result = Reflect.apply(callback, undefined, [observation]);
    } catch {
      recordObservationFailure(failureCode);
      return false;
    }
    if (absorbNativePromise(result)
      || ownDataValue(result, 'ok', { enumerable: true }) === false) {
      recordObservationFailure(failureCode);
      return false;
    }
    return true;
  }

  function observeFailure(identity, reason) {
    if (!identity) return false;
    return callTerminalCallback(
      dependencies.onCanaryFailed,
      Object.freeze({
        jobId: identity.jobId,
        projectId: identity.projectId,
        requestId: identity.requestId,
        reason,
      }),
      CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.FAILURE_CALLBACK_FAILED
    );
  }

  async function execute(request) {
    const identity = inspectRequestIdentity(request);
    requests += 1;
    let result;
    try {
      result = await callRunner(dependencies.runner, request);
    } catch (error) {
      canaryFailures += 1;
      observeFailure(identity, sanitizedFailureReason(error));
      throw error;
    }

    const resultFields = inspectResult(result, request, dependencies);
    if (!resultFields) {
      canaryFailures += 1;
      observeFailure(
        identity,
        CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.INVALID_RESULT
      );
      throw adapterError(
        CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.INVALID_RESULT
      );
    }
    if (resultFields.get('kernelId')
      === dependencies.runner.authoritativeKernelId) {
      legacyFallbacks += 1;
      return result;
    }

    const outcome = identity
      ? inspectCanaryOutcome(resultFields.get('output'))
      : null;
    const promotion = outcome
      ? inspectPromotionDiagnostics(resultFields.get('diagnostics'), outcome)
      : null;
    if (!outcome || !promotion) {
      canaryFailures += 1;
      observeFailure(
        identity,
        CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.INVALID_RESULT
      );
      throw adapterError(
        CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.INVALID_RESULT
      );
    }

    canaryCompletions += 1;
    callTerminalCallback(
      dependencies.onCanaryCompleted,
      Object.freeze({
        jobId: identity.jobId,
        projectId: identity.projectId,
        requestId: identity.requestId,
        promotionId: promotion.promotionId,
        changedPaths: outcome.changedPaths,
        writeSetDigest: outcome.writeSetDigest,
      }),
      CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS.COMPLETION_CALLBACK_FAILED
    );
    return result;
  }

  function canaryRunnerDiagnostics() {
    return inspectRunnerDiagnostics(dependencies.runner);
  }

  const canaryEditRunner = Object.freeze({
    version: dependencies.runner.version,
    execute,
    diagnostics: canaryRunnerDiagnostics,
  });

  function diagnostics() {
    return Object.freeze({
      version: CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_VERSION,
      runnerVersion: dependencies.runner.version,
      authoritativeKernelId: dependencies.runner.authoritativeKernelId,
      canaryKernelId: dependencies.runner.canaryKernelId,
      requests,
      canaryCompletions,
      canaryFailures,
      legacyFallbacks,
      observationFailures,
      lastObservationFailureCode,
    });
  }

  return Object.freeze({
    version: CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_VERSION,
    canaryEditRunner,
    diagnostics,
  });
}

module.exports = {
  CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_REASONS,
  CANARY_EDIT_TERMINAL_OBSERVER_ADAPTER_VERSION,
  CanaryEditTerminalObserverAdapterError,
  createCanaryEditTerminalObserverAdapter,
};
