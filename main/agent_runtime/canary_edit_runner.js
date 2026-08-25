'use strict';

const util = require('util');

const { assertAgentKernel } = require('./agent_kernel');
const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  areEquivalentPortablePaths,
} = require('../capabilities/sandbox_backend_contract');
const {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
  classifyCanaryEditAction,
} = require('./canary_edit_action_classifier');
const {
  CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  CANARY_EDIT_ADMISSION_POLICY_VERSION,
  evaluateCanaryEditAdmission,
} = require('./canary_edit_admission_policy');
const {
  CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_SELECTOR_VERSION,
} = require('./canary_rollout_selector');
const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
} = require('./harness_contracts');

const CANARY_EDIT_RUNNER_VERSION = 'canary-edit-runner.v1';
const CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION =
  'canary-edit-execution-grant.v1';

const CANARY_EDIT_RUNNER_REASONS = Object.freeze({
  CANARY_EXECUTION_FAILED: 'CANARY_EDIT_RUNNER_CANARY_EXECUTION_FAILED',
  CANARY_INVALID_RESULT: 'CANARY_EDIT_RUNNER_CANARY_INVALID_RESULT',
  INVALID_REQUEST: 'CANARY_EDIT_RUNNER_INVALID_REQUEST',
  LEGACY_INVALID_RESULT: 'CANARY_EDIT_RUNNER_LEGACY_INVALID_RESULT',
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'kernelId',
  'output',
  'diagnostics',
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
const FACT_KEYS = Object.freeze([
  'projectAuthorized',
  'checkpoint',
  'rootMutation',
  'rollout',
]);
const ROLLOUT_FACT_KEYS = Object.freeze([
  'killSwitch',
  'projectPin',
  'allowlisted',
  'internal',
  'rolloutStage',
]);
const ROLLOUT_DECISION_KEYS = Object.freeze([
  'schemaVersion',
  'selectorVersion',
  'selected',
  'reason',
  'rolloutStage',
  'thresholdBasisPoints',
  'cohortBasisPoints',
]);
const ADMISSION_DECISION_KEYS = Object.freeze([
  'schemaVersion',
  'policyVersion',
  'eligible',
  'reason',
  'prerequisites',
]);
const STAGED_EXECUTOR_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'kernelId',
  'workspaceIsolation',
  'networkMode',
  'installMode',
  'promotionMode',
]);

class CanaryEditRunnerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryEditRunnerError';
    this.code = code;
  }
}

function runnerError(code) {
  return new CanaryEditRunnerError(code);
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // A malformed native Promise is still rejected by the caller fail-closed.
  }
  return true;
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

function dataFields(value, {
  allowedKeys = null,
  requiredKeys = null,
  exact = false,
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
    || allowedKeys && !allowedKeys.includes(key))) return null;
  if (exact && allowedKeys && keys.length !== allowedKeys.length) return null;
  if (requiredKeys && requiredKeys.some((key) => !keys.includes(key))) return null;
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

function bindingsMatch(left, right) {
  return AUTHORITY_BINDING_KEYS.every((key) => left[key] === right[key]);
}

function captureAuthoritativeKernel(value) {
  try {
    assertAgentKernel(value);
  } catch {
    throw new TypeError('authoritativeKernel must implement AgentKernel');
  }
  if (typeof value.id !== 'string' || !SAFE_IDENTIFIER.test(value.id)
    || !Array.isArray(value.capabilities)
    || !value.capabilities.includes(HARNESS_OPERATIONS.EXECUTE)) {
    throw new TypeError('authoritativeKernel must support execute');
  }
  return Object.freeze({
    receiver: value,
    id: value.id,
    execute: inspectableFunction(value.execute, 'authoritativeKernel.execute'),
  });
}

function captureAdmissionFactsProvider(value) {
  const fields = dataFields(value, {
    allowedKeys: ['version', 'inspect'],
    requiredKeys: ['version', 'inspect'],
    exact: true,
    frozen: true,
  });
  if (!fields || typeof fields.get('version') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('version'))) {
    throw new TypeError('admissionFactsProvider must be a frozen versioned port');
  }
  return Object.freeze({
    receiver: value,
    version: fields.get('version'),
    inspect: inspectableFunction(
      fields.get('inspect'),
      'admissionFactsProvider.inspect'
    ),
  });
}

function captureRolloutSelector(value) {
  const fields = dataFields(value, {
    allowedKeys: ['version', 'select', 'diagnostics'],
    requiredKeys: ['version', 'select', 'diagnostics'],
    exact: true,
    frozen: true,
  });
  if (!fields || fields.get('version') !== CANARY_ROLLOUT_SELECTOR_VERSION) {
    throw new TypeError('rolloutSelector must implement the pinned selector version');
  }
  return Object.freeze({
    receiver: value,
    version: fields.get('version'),
    select: inspectableFunction(fields.get('select'), 'rolloutSelector.select'),
  });
}

function readStagedExecutorDiagnostics(port) {
  let diagnostics;
  try {
    diagnostics = Reflect.apply(port.diagnostics, port.receiver, []);
  } catch {
    throw new TypeError('stagedCanaryExecutor.diagnostics failed');
  }
  if (absorbNativePromise(diagnostics)) {
    throw new TypeError('stagedCanaryExecutor.diagnostics must be synchronous');
  }
  const fields = dataFields(diagnostics, {
    allowedKeys: STAGED_EXECUTOR_DIAGNOSTIC_KEYS,
    requiredKeys: STAGED_EXECUTOR_DIAGNOSTIC_KEYS,
    exact: true,
    frozen: true,
  });
  if (!fields
    || fields.get('version') !== port.version
    || fields.get('kernelId') !== port.kernelId
    || fields.get('workspaceIsolation') !== 'per_job_staging'
    || fields.get('networkMode') !== 'disabled'
    || fields.get('installMode') !== 'disabled'
    || fields.get('promotionMode') !== 'explicit_checkpointed') {
    throw new TypeError(
      'stagedCanaryExecutor must enforce per-job staging isolation with explicit promotion'
    );
  }
  return diagnostics;
}

function captureStagedCanaryExecutor(value, authoritativeKernelId) {
  const fields = dataFields(value, {
    allowedKeys: ['version', 'kernelId', 'execute', 'diagnostics'],
    requiredKeys: ['version', 'kernelId', 'execute', 'diagnostics'],
    exact: true,
    frozen: true,
  });
  if (!fields
    || typeof fields.get('version') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('version'))
    || typeof fields.get('kernelId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('kernelId'))
    || fields.get('kernelId') === authoritativeKernelId) {
    throw new TypeError(
      'stagedCanaryExecutor must be a frozen versioned port with a distinct kernel id'
    );
  }
  const port = Object.freeze({
    receiver: value,
    version: fields.get('version'),
    kernelId: fields.get('kernelId'),
    execute: inspectableFunction(
      fields.get('execute'),
      'stagedCanaryExecutor.execute'
    ),
    diagnostics: inspectableFunction(
      fields.get('diagnostics'),
      'stagedCanaryExecutor.diagnostics'
    ),
  });
  readStagedExecutorDiagnostics(port);
  return port;
}

function captureDependencies(options) {
  const fields = dataFields(options, {
    allowedKeys: [
      'authoritativeKernel',
      'admissionFactsProvider',
      'rolloutSelector',
      'stagedCanaryExecutor',
    ],
    requiredKeys: [
      'authoritativeKernel',
      'admissionFactsProvider',
      'rolloutSelector',
      'stagedCanaryExecutor',
    ],
    exact: true,
  });
  if (!fields) throw new TypeError('Invalid canary edit runner options');
  const authoritativeKernel = captureAuthoritativeKernel(
    fields.get('authoritativeKernel')
  );
  return Object.freeze({
    authoritativeKernel,
    admissionFactsProvider: captureAdmissionFactsProvider(
      fields.get('admissionFactsProvider')
    ),
    rolloutSelector: captureRolloutSelector(fields.get('rolloutSelector')),
    stagedCanaryExecutor: captureStagedCanaryExecutor(
      fields.get('stagedCanaryExecutor'),
      authoritativeKernel.id
    ),
  });
}

function validateExecuteRequest(value) {
  try {
    assertHarnessRequest(value);
    if (!Object.isFrozen(value) || value.operation !== HARNESS_OPERATIONS.EXECUTE) {
      throw new TypeError('execute request required');
    }
  } catch {
    throw runnerError(CANARY_EDIT_RUNNER_REASONS.INVALID_REQUEST);
  }
  return value;
}

function readRequestAuthority(request) {
  const executionContext = ownDataValue(request, 'executionContext', {
    enumerable: true,
  });
  if (!isPlainRecord(executionContext) || !Object.isFrozen(executionContext)) return null;
  const rawBinding = ownDataValue(executionContext, 'authorityBinding', {
    enumerable: false,
  });
  if (!rawBinding || !Object.isFrozen(rawBinding)) return null;
  let authorityBinding;
  try {
    authorityBinding = createCapabilityDelegationBinding(rawBinding);
  } catch {
    return null;
  }
  if (!bindingsMatch(authorityBinding, rawBinding)
    || ownDataValue(executionContext, 'jobId', { enumerable: true })
      !== authorityBinding.jobId) return null;

  const projectInfo = ownDataValue(request, 'projectInfo', { enumerable: true });
  const projectFields = dataFields(projectInfo, { frozen: true });
  if (!projectFields || !projectFields.has('rootPath')) return null;
  const projectId = projectFields.has('id')
    ? projectFields.get('id')
    : projectFields.get('projectId');
  if (projectId !== authorityBinding.projectId
    || projectFields.has('projectId')
      && projectFields.get('projectId') !== authorityBinding.projectId
    || !areEquivalentPortablePaths(
      projectFields.get('rootPath'),
      authorityBinding.canonicalRootPath
    )) return null;
  return authorityBinding;
}

function inspectFacts(port, request, classification) {
  let value;
  try {
    value = Reflect.apply(port.inspect, port.receiver, [request, classification]);
  } catch {
    return null;
  }
  if (absorbNativePromise(value)) return null;
  const fields = dataFields(value, {
    allowedKeys: FACT_KEYS,
    requiredKeys: FACT_KEYS,
    exact: true,
    frozen: true,
  });
  const rolloutFields = fields && dataFields(fields.get('rollout'), {
    allowedKeys: ROLLOUT_FACT_KEYS,
    requiredKeys: ROLLOUT_FACT_KEYS,
    exact: true,
    frozen: true,
  });
  if (!fields || !rolloutFields
    || typeof fields.get('projectAuthorized') !== 'boolean') return null;
  return Object.freeze({ fields, rolloutFields });
}

function selectRollout(port, authorityBinding, rolloutFields) {
  const input = Object.freeze({
    killSwitch: rolloutFields.get('killSwitch'),
    configuredMode: 'canary',
    projectId: authorityBinding.projectId,
    projectPin: rolloutFields.get('projectPin'),
    allowlisted: rolloutFields.get('allowlisted'),
    internal: rolloutFields.get('internal'),
    rolloutStage: rolloutFields.get('rolloutStage'),
  });
  let decision;
  try {
    decision = Reflect.apply(port.select, port.receiver, [input]);
  } catch {
    return null;
  }
  if (absorbNativePromise(decision)) return null;
  const fields = dataFields(decision, {
    allowedKeys: ROLLOUT_DECISION_KEYS,
    requiredKeys: ROLLOUT_DECISION_KEYS,
    exact: true,
    frozen: true,
  });
  if (!fields
    || fields.get('schemaVersion') !== CANARY_ROLLOUT_DECISION_SCHEMA_VERSION
    || fields.get('selectorVersion') !== CANARY_ROLLOUT_SELECTOR_VERSION
    || typeof fields.get('selected') !== 'boolean'
    || typeof fields.get('reason') !== 'string') return null;
  return decision;
}

function decideAdmission(authorityBinding, classification, factsSnapshot) {
  const factsFields = factsSnapshot.fields;
  const decision = evaluateCanaryEditAdmission(Object.freeze({
    runtimeMode: 'canary',
    projectAuthorization: Object.freeze({
      authorized: factsFields.get('projectAuthorized'),
      binding: authorityBinding,
    }),
    editProfile: classification.editProfile,
    checkpoint: factsFields.get('checkpoint'),
    rootMutation: factsFields.get('rootMutation'),
  }));
  const fields = dataFields(decision, {
    allowedKeys: ADMISSION_DECISION_KEYS,
    requiredKeys: ADMISSION_DECISION_KEYS,
    exact: true,
    frozen: true,
  });
  if (!fields
    || fields.get('schemaVersion') !== CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION
    || fields.get('policyVersion') !== CANARY_EDIT_ADMISSION_POLICY_VERSION
    || typeof fields.get('eligible') !== 'boolean'
    || typeof fields.get('reason') !== 'string') return null;
  return decision;
}

function validateKernelResult(value, request, kernelId, reason) {
  const fields = dataFields(value, {
    allowedKeys: RESULT_KEYS,
    requiredKeys: RESULT_KEYS,
    exact: true,
    frozen: true,
  });
  if (!fields
    || fields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
    || fields.get('requestId') !== request.requestId
    || fields.get('operation') !== HARNESS_OPERATIONS.EXECUTE
    || fields.get('kernelId') !== kernelId) {
    throw runnerError(reason);
  }
  return value;
}

function callNativeAsync(port, method, args, fieldName) {
  let pending;
  try {
    pending = Reflect.apply(method, port.receiver, args);
  } catch (error) {
    return Promise.reject(error);
  }
  if (!util.types.isPromise(pending)) {
    absorbNativePromise(pending);
    return Promise.reject(new TypeError(fieldName + ' must return a native Promise'));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function createCanaryEditRunner(options = {}) {
  const dependencies = captureDependencies(options);
  let requests = 0;
  let canaryCompleted = 0;
  let legacyFallbacks = 0;
  let actionDenied = 0;
  let factsDenied = 0;
  let rolloutDenied = 0;
  let admissionDenied = 0;
  let canaryFailed = 0;
  let lastDecisionReason = null;

  function diagnostics() {
    return Object.freeze({
      version: CANARY_EDIT_RUNNER_VERSION,
      authoritativeKernelId: dependencies.authoritativeKernel.id,
      canaryKernelId: dependencies.stagedCanaryExecutor.kernelId,
      requests,
      canaryCompleted,
      legacyFallbacks,
      actionDenied,
      factsDenied,
      rolloutDenied,
      admissionDenied,
      canaryFailed,
      lastDecisionReason,
    });
  }

  async function fallbackToLegacy(request, reason) {
    legacyFallbacks += 1;
    lastDecisionReason = reason;
    const result = await callNativeAsync(
      dependencies.authoritativeKernel,
      dependencies.authoritativeKernel.execute,
      [request],
      'authoritativeKernel.execute'
    );
    return validateKernelResult(
      result,
      request,
      dependencies.authoritativeKernel.id,
      CANARY_EDIT_RUNNER_REASONS.LEGACY_INVALID_RESULT
    );
  }

  async function execute(value) {
    const request = validateExecuteRequest(value);
    requests += 1;
    const actionValue = ownDataValue(request, 'action', { enumerable: true });
    const classification = classifyCanaryEditAction(actionValue);
    if (classification.schemaVersion
        !== CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION
      || classification.classifierVersion !== CANARY_EDIT_ACTION_CLASSIFIER_VERSION
      || classification.eligible !== true) {
      actionDenied += 1;
      return fallbackToLegacy(request, classification.reason || 'action_invalid');
    }

    const authorityBinding = readRequestAuthority(request);
    if (!authorityBinding) {
      factsDenied += 1;
      return fallbackToLegacy(request, 'authority_unavailable');
    }
    const factsSnapshot = inspectFacts(
      dependencies.admissionFactsProvider,
      request,
      classification
    );
    if (!factsSnapshot) {
      factsDenied += 1;
      return fallbackToLegacy(request, 'facts_unavailable');
    }

    const rolloutDecision = selectRollout(
      dependencies.rolloutSelector,
      authorityBinding,
      factsSnapshot.rolloutFields
    );
    if (!rolloutDecision || rolloutDecision.selected !== true) {
      rolloutDenied += 1;
      return fallbackToLegacy(
        request,
        rolloutDecision ? rolloutDecision.reason : 'rollout_invalid'
      );
    }

    const admissionDecision = decideAdmission(
      authorityBinding,
      classification,
      factsSnapshot
    );
    if (!admissionDecision || admissionDecision.eligible !== true) {
      admissionDenied += 1;
      return fallbackToLegacy(
        request,
        admissionDecision ? admissionDecision.reason : 'admission_invalid'
      );
    }

    const grant = Object.freeze({
      schemaVersion: CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
      requestId: request.requestId,
      actionClassification: classification,
      rolloutDecision,
      admissionDecision,
    });
    let result;
    try {
      result = await callNativeAsync(
        dependencies.stagedCanaryExecutor,
        dependencies.stagedCanaryExecutor.execute,
        [request, grant],
        'stagedCanaryExecutor.execute'
      );
    } catch {
      canaryFailed += 1;
      lastDecisionReason = 'canary_failed';
      throw runnerError(CANARY_EDIT_RUNNER_REASONS.CANARY_EXECUTION_FAILED);
    }
    try {
      validateKernelResult(
        result,
        request,
        dependencies.stagedCanaryExecutor.kernelId,
        CANARY_EDIT_RUNNER_REASONS.CANARY_INVALID_RESULT
      );
    } catch {
      canaryFailed += 1;
      lastDecisionReason = 'canary_invalid_result';
      throw runnerError(CANARY_EDIT_RUNNER_REASONS.CANARY_INVALID_RESULT);
    }
    canaryCompleted += 1;
    lastDecisionReason = 'canary_completed';
    return result;
  }

  return Object.freeze({
    version: CANARY_EDIT_RUNNER_VERSION,
    execute,
    diagnostics,
  });
}

module.exports = {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
  CANARY_EDIT_RUNNER_REASONS,
  CANARY_EDIT_RUNNER_VERSION,
  CanaryEditRunnerError,
  createCanaryEditRunner,
};
