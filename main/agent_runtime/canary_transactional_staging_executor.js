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
  assertExecutionWorkspaceAcquireRequest,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
} = require('./canary_edit_action_classifier');
const {
  CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  CANARY_EDIT_ADMISSION_POLICY_VERSION,
} = require('./canary_edit_admission_policy');
const {
  CANARY_EDIT_LIFECYCLE_CODES,
  CANARY_EDIT_MUTATION_FRONTIERS,
  createCanaryEditLifecycle,
} = require('./canary_edit_lifecycle');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
  CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
} = require('./canary_edit_runner');
const {
  CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_PROMOTION_SINK_VERSION,
} = require('./canary_manual_rollback_service');
const {
  CANARY_PROMOTION_CONTROLLER_REASONS,
  CANARY_PROMOTION_CONTROLLER_VERSION,
  CANARY_PROMOTION_TRANSACTION_VERSION,
  CanaryPromotionControllerError,
} = require('./canary_promotion_controller');
const {
  CANARY_PROMOTION_REQUEST_VERSION,
  CANARY_PROMOTION_REVERT_RECEIPT_VERSION,
  assertCanaryPromotionReceipt,
  assertCanaryPromotionRequest,
  assertCanaryPromotionRevertReceipt,
  createCanaryPromotionRequest,
} = require('./canary_promotion_contract');
const {
  CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_SELECTOR_VERSION,
} = require('./canary_rollout_selector');
const {
  assertCanaryStagingDiscardReceipt,
  assertCanaryStagingSession,
  assertCanaryStagingWriteReceipt,
} = require('./canary_staging_contract');
const {
  HARNESS_OPERATIONS,
  HARNESS_RESULT_SCHEMA_VERSION,
  assertHarnessRequest,
  createHarnessResult,
} = require('./harness_contracts');

const CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION =
  'canary-transactional-staging-executor.v1';
const CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION =
  'canary-transactional-staging-open-outcome.v1';
const CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION =
  'canary-transactional-staging-edit-outcome.v1';
const CANARY_TRANSACTIONAL_STAGING_RESULT_DIAGNOSTICS_SCHEMA_VERSION =
  'canary-transactional-staging-result-diagnostics.v1';

const CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS = Object.freeze({
  CLEANUP_FAILED: 'CANARY_TRANSACTIONAL_STAGING_CLEANUP_FAILED',
  INVALID_INPUT: 'CANARY_TRANSACTIONAL_STAGING_INVALID_INPUT',
  OPEN_FAILED: 'CANARY_TRANSACTIONAL_STAGING_OPEN_FAILED',
  PROMOTION_AMBIGUOUS: 'CANARY_TRANSACTIONAL_STAGING_PROMOTION_AMBIGUOUS',
  REVERT_FAILED: 'CANARY_TRANSACTIONAL_STAGING_REVERT_FAILED',
});

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const AUTHORITY_BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const OPTION_KEYS = Object.freeze([
  'kernelId',
  'workspaceSessionPort',
  'canaryEditor',
  'promotionController',
  'promotionSink',
]);
const WORKSPACE_PORT_KEYS = Object.freeze([
  'version',
  'open',
  'discard',
  'diagnostics',
]);
const WORKSPACE_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'workspaceIsolation',
  'sourceMutation',
  'discardMode',
]);
const EDITOR_PORT_KEYS = Object.freeze([
  'version',
  'kernelId',
  'execute',
  'diagnostics',
]);
const EDITOR_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'kernelId',
  'workspaceMode',
  'sourceMutation',
  'settlementMode',
  'networkMode',
  'installMode',
]);
const PROMOTION_CONTROLLER_KEYS = Object.freeze([
  'version',
  'promote',
  'revert',
  'diagnostics',
]);
const PROMOTION_CONTROLLER_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'backendVersion',
  'promotionContract',
  'revertContract',
]);
const PROMOTION_SINK_KEYS = Object.freeze([
  'version',
  'record',
  'cancel',
]);
const GRANT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'actionClassification',
  'rolloutDecision',
  'admissionDecision',
]);
const ACTION_CLASSIFICATION_KEYS = Object.freeze([
  'schemaVersion',
  'classifierVersion',
  'eligible',
  'reason',
  'editProfile',
  'summary',
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
const OPEN_OUTCOME_KEYS = Object.freeze([
  'schemaVersion',
  'ok',
  'session',
  'checkpoint',
  'workspaceRequest',
  'actionDigest',
  'promotionId',
  'sourceSnapshot',
  'rootMutation',
]);
const SOURCE_SNAPSHOT_KEYS = Object.freeze([
  'checkpointDigest',
  'sourceRootIdentityDigest',
  'sourceStateDigest',
  'branchHeadDigest',
  'gitIndexDigest',
  'userDirtyDigest',
]);
const ROOT_MUTATION_KEYS = Object.freeze([
  'canonicalRootPath',
  'ownerJobId',
  'activeOtherMutatingJobs',
]);
const EDIT_OUTCOME_KEYS = Object.freeze([
  'schemaVersion',
  'ok',
  'writeReceipt',
  'result',
]);
const RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'kernelId',
  'output',
  'diagnostics',
]);
const DISCARD_OUTCOME_KEYS = Object.freeze([
  'receipt',
  'workspaceDiscardRequest',
]);
const TRANSACTION_KEYS = Object.freeze(['version', 'request', 'receipt']);

class CanaryTransactionalStagingExecutorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryTransactionalStagingExecutorError';
    this.code = code;
  }
}

function executorError(code) {
  return new CanaryTransactionalStagingExecutorError(code);
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

function captureSynchronousDiagnostics(port, expectedKeys, fieldName) {
  let diagnostics;
  try {
    diagnostics = Reflect.apply(port.diagnostics, port.receiver, []);
  } catch {
    throw new TypeError(fieldName + '.diagnostics failed');
  }
  if (util.types.isPromise(diagnostics)) {
    try {
      Reflect.apply(Promise.prototype.then, diagnostics, [() => {}, () => {}]);
    } catch {
      // Promise diagnostics are rejected regardless of observation behavior.
    }
    throw new TypeError(fieldName + '.diagnostics must be synchronous');
  }
  const fields = exactDataFields(diagnostics, expectedKeys, { frozen: true });
  if (!fields || fields.get('version') !== port.version) {
    throw new TypeError(fieldName + '.diagnostics is invalid');
  }
  return fields;
}

function captureWorkspaceSessionPort(value) {
  const fields = exactDataFields(value, WORKSPACE_PORT_KEYS, { frozen: true });
  if (!fields || typeof fields.get('version') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('version'))) {
    throw new TypeError('workspaceSessionPort must be a frozen versioned port');
  }
  const port = Object.freeze({
    receiver: value,
    version: fields.get('version'),
    open: inspectableFunction(fields.get('open'), 'workspaceSessionPort.open'),
    discard: inspectableFunction(
      fields.get('discard'),
      'workspaceSessionPort.discard'
    ),
    diagnostics: inspectableFunction(
      fields.get('diagnostics'),
      'workspaceSessionPort.diagnostics'
    ),
  });
  const diagnostics = captureSynchronousDiagnostics(
    port,
    WORKSPACE_DIAGNOSTIC_KEYS,
    'workspaceSessionPort'
  );
  if (diagnostics.get('workspaceIsolation') !== 'per_job_staging'
    || diagnostics.get('sourceMutation') !== 'forbidden'
    || diagnostics.get('discardMode') !== 'verified') {
    throw new TypeError('workspaceSessionPort must enforce verified per-job staging');
  }
  return port;
}

function captureCanaryEditor(value, kernelId) {
  const fields = exactDataFields(value, EDITOR_PORT_KEYS, { frozen: true });
  if (!fields || typeof fields.get('version') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('version'))
    || fields.get('kernelId') !== kernelId) {
    throw new TypeError('canaryEditor must be a frozen versioned kernel port');
  }
  const port = Object.freeze({
    receiver: value,
    version: fields.get('version'),
    kernelId: fields.get('kernelId'),
    execute: inspectableFunction(fields.get('execute'), 'canaryEditor.execute'),
    diagnostics: inspectableFunction(
      fields.get('diagnostics'),
      'canaryEditor.diagnostics'
    ),
  });
  const diagnostics = captureSynchronousDiagnostics(
    port,
    EDITOR_DIAGNOSTIC_KEYS,
    'canaryEditor'
  );
  if (diagnostics.get('kernelId') !== kernelId
    || diagnostics.get('workspaceMode') !== 'provided_session_only'
    || diagnostics.get('sourceMutation') !== 'forbidden'
    || diagnostics.get('settlementMode') !== 'terminal'
    || diagnostics.get('networkMode') !== 'disabled'
    || diagnostics.get('installMode') !== 'disabled') {
    throw new TypeError('canaryEditor must be terminal and staging-only');
  }
  return port;
}

function capturePromotionController(value) {
  const fields = exactDataFields(
    value,
    PROMOTION_CONTROLLER_KEYS,
    { frozen: true }
  );
  if (!fields
    || fields.get('version') !== CANARY_PROMOTION_CONTROLLER_VERSION) {
    throw new TypeError('promotionController must be the guarded controller');
  }
  const port = Object.freeze({
    receiver: value,
    version: fields.get('version'),
    promote: inspectableFunction(
      fields.get('promote'),
      'promotionController.promote'
    ),
    revert: inspectableFunction(
      fields.get('revert'),
      'promotionController.revert'
    ),
    diagnostics: inspectableFunction(
      fields.get('diagnostics'),
      'promotionController.diagnostics'
    ),
  });
  const diagnostics = captureSynchronousDiagnostics(
    port,
    PROMOTION_CONTROLLER_DIAGNOSTIC_KEYS,
    'promotionController'
  );
  if (typeof diagnostics.get('backendVersion') !== 'string'
    || !SAFE_IDENTIFIER.test(diagnostics.get('backendVersion'))
    || diagnostics.get('promotionContract') !== CANARY_PROMOTION_REQUEST_VERSION
    || diagnostics.get('revertContract')
      !== CANARY_PROMOTION_REVERT_RECEIPT_VERSION) {
    throw new TypeError('promotionController diagnostics are invalid');
  }
  return port;
}

function capturePromotionSink(value) {
  const fields = exactDataFields(
    value,
    PROMOTION_SINK_KEYS,
    { frozen: true }
  );
  if (!fields
    || fields.get('version') !== CANARY_MANUAL_ROLLBACK_PROMOTION_SINK_VERSION) {
    throw new TypeError('promotionSink must be the manual rollback sink');
  }
  return Object.freeze({
    receiver: value,
    version: fields.get('version'),
    record: inspectableFunction(fields.get('record'), 'promotionSink.record'),
    cancel: inspectableFunction(fields.get('cancel'), 'promotionSink.cancel'),
  });
}

function captureDependencies(options) {
  const fields = exactDataFields(options, OPTION_KEYS);
  const kernelId = fields && fields.get('kernelId');
  if (!fields || typeof kernelId !== 'string' || !SAFE_IDENTIFIER.test(kernelId)) {
    throw new TypeError('Invalid canary transactional staging executor options');
  }
  return Object.freeze({
    kernelId,
    workspaceSessionPort: captureWorkspaceSessionPort(
      fields.get('workspaceSessionPort')
    ),
    canaryEditor: captureCanaryEditor(fields.get('canaryEditor'), kernelId),
    promotionController: capturePromotionController(
      fields.get('promotionController')
    ),
    promotionSink: capturePromotionSink(fields.get('promotionSink')),
  });
}

function bindingsMatch(left, right) {
  return AUTHORITY_BINDING_KEYS.every((key) => left[key] === right[key]);
}

function readRequestAuthority(request) {
  const context = ownDataValue(request, 'executionContext', { enumerable: true });
  if (!context || typeof context !== 'object' || !Object.isFrozen(context)
    || util.types.isProxy(context)) return null;
  const rawBinding = ownDataValue(context, 'authorityBinding', { enumerable: false });
  if (!rawBinding || !Object.isFrozen(rawBinding)) return null;
  let binding;
  try {
    binding = createCapabilityDelegationBinding(rawBinding);
  } catch {
    return null;
  }
  if (!bindingsMatch(binding, rawBinding)
    || ownDataValue(context, 'jobId', { enumerable: true }) !== binding.jobId) {
    return null;
  }
  const projectInfo = ownDataValue(request, 'projectInfo', { enumerable: true });
  const projectPreflight = preflightDataGraph(projectInfo);
  if (!projectPreflight.bounded || projectPreflight.hasNativePromise
    || !projectPreflight.inspectable || !projectInfo
    || typeof projectInfo !== 'object' || Array.isArray(projectInfo)
    || util.types.isProxy(projectInfo) || !Object.isFrozen(projectInfo)) return null;
  const projectId = ownDataValue(projectInfo, 'id', { enumerable: true })
    || ownDataValue(projectInfo, 'projectId', { enumerable: true });
  const projectIdAlias = ownDataValue(projectInfo, 'projectId', {
    enumerable: true,
  });
  const rootPath = ownDataValue(projectInfo, 'rootPath', { enumerable: true });
  if (projectId !== binding.projectId
    || projectIdAlias !== null && projectIdAlias !== binding.projectId
    || !areEquivalentPortablePaths(rootPath, binding.canonicalRootPath)) return null;
  return binding;
}

function validateGrant(value, request) {
  const fields = exactDataFields(value, GRANT_KEYS, { frozen: true });
  const classification = fields && exactDataFields(
    fields.get('actionClassification'),
    ACTION_CLASSIFICATION_KEYS,
    { frozen: true }
  );
  const rollout = fields && exactDataFields(
    fields.get('rolloutDecision'),
    ROLLOUT_DECISION_KEYS,
    { frozen: true }
  );
  const admission = fields && exactDataFields(
    fields.get('admissionDecision'),
    ADMISSION_DECISION_KEYS,
    { frozen: true }
  );
  return Boolean(fields && classification && rollout && admission
    && fields.get('schemaVersion')
      === CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION
    && fields.get('requestId') === request.requestId
    && classification.get('schemaVersion')
      === CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION
    && classification.get('classifierVersion')
      === CANARY_EDIT_ACTION_CLASSIFIER_VERSION
    && classification.get('eligible') === true
    && rollout.get('schemaVersion') === CANARY_ROLLOUT_DECISION_SCHEMA_VERSION
    && rollout.get('selectorVersion') === CANARY_ROLLOUT_SELECTOR_VERSION
    && rollout.get('selected') === true
    && admission.get('schemaVersion')
      === CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION
    && admission.get('policyVersion') === CANARY_EDIT_ADMISSION_POLICY_VERSION
    && admission.get('eligible') === true);
}

function validateInput(request, grant) {
  try {
    assertHarnessRequest(request);
    if (!Object.isFrozen(request) || request.operation !== HARNESS_OPERATIONS.EXECUTE
      || !validateGrant(grant, request)) throw new TypeError('invalid input');
  } catch {
    throw executorError(CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.INVALID_INPUT);
  }
  const authorityBinding = readRequestAuthority(request);
  if (!authorityBinding) {
    throw executorError(CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.INVALID_INPUT);
  }
  return authorityBinding;
}

function callNativePort(port, methodName, args) {
  let pending;
  try {
    pending = Reflect.apply(port[methodName], port.receiver, args);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.reject(new TypeError('port call failed'));
  }
  if (!util.types.isPromise(pending)) {
    preflightDataGraph(pending);
    return Promise.reject(new TypeError('port call must return a native Promise'));
  }
  return new Promise((resolve, reject) => {
    const rejected = (error) => {
      preflightDataGraph(error);
      reject(new TypeError('port promise rejected'));
    };
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, rejected]);
    } catch (error) {
      rejected(error);
    }
  });
}

function callPromotionController(port, methodName, args) {
  let pending;
  try {
    pending = Reflect.apply(port[methodName], port.receiver, args);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.reject(new TypeError('promotion controller call failed'));
  }
  if (!util.types.isPromise(pending)) {
    preflightDataGraph(pending);
    return Promise.reject(new TypeError(
      'promotion controller must return a native Promise'
    ));
  }
  return new Promise((resolve, reject) => {
    const rejected = (error) => {
      preflightDataGraph(error);
      reject(error instanceof CanaryPromotionControllerError
        ? error
        : new TypeError('promotion controller rejected'));
    };
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, rejected]);
    } catch (error) {
      rejected(error);
    }
  });
}

function normalizeSourceSnapshot(value, session) {
  const fields = exactDataFields(value, SOURCE_SNAPSHOT_KEYS, { frozen: true });
  if (!fields) return null;
  const snapshot = {};
  try {
    for (const key of SOURCE_SNAPSHOT_KEYS) {
      snapshot[key] = normalizeDigest(fields.get(key), key);
    }
  } catch {
    return null;
  }
  if (snapshot.checkpointDigest !== session.checkpointDigest
    || snapshot.sourceRootIdentityDigest !== session.sourceRootIdentityDigest) {
    return null;
  }
  return Object.freeze(snapshot);
}

function normalizeRootMutation(value, session) {
  const fields = exactDataFields(value, ROOT_MUTATION_KEYS, { frozen: true });
  if (!fields || !areEquivalentPortablePaths(
    fields.get('canonicalRootPath'),
    session.sourceRootPath
  ) || fields.get('ownerJobId') !== session.jobId
    || fields.get('activeOtherMutatingJobs') !== 0
    || Object.is(fields.get('activeOtherMutatingJobs'), -0)) return null;
  return Object.freeze({
    canonicalRootPath: fields.get('canonicalRootPath'),
    ownerJobId: fields.get('ownerJobId'),
    activeOtherMutatingJobs: 0,
  });
}

function normalizeOpenOutcome(value, request, authorityBinding) {
  const fields = exactDataFields(value, OPEN_OUTCOME_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION
    || fields.get('ok') !== true
    || typeof fields.get('promotionId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('promotionId'))) return null;
  let workspaceRequest;
  let session;
  let actionDigest;
  try {
    workspaceRequest = assertExecutionWorkspaceAcquireRequest(
      fields.get('workspaceRequest')
    );
    session = assertCanaryStagingSession(fields.get('session'), {
      requestId: request.requestId,
      checkpoint: fields.get('checkpoint'),
      workspaceRequest,
    });
    actionDigest = normalizeDigest(fields.get('actionDigest'), 'actionDigest');
  } catch {
    return null;
  }
  const sourceSnapshot = normalizeSourceSnapshot(
    fields.get('sourceSnapshot'),
    session
  );
  const rootMutation = normalizeRootMutation(fields.get('rootMutation'), session);
  if (!sourceSnapshot || !rootMutation
    || !bindingsMatch(workspaceRequest.binding, authorityBinding)) return null;
  return Object.freeze({
    actionDigest,
    checkpoint: fields.get('checkpoint'),
    promotionId: fields.get('promotionId'),
    rootMutation,
    session,
    sourceSnapshot,
    workspaceRequest,
  });
}

function isDeepFrozenData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || seen.has(value)
    || util.types.isProxy(value) || util.types.isPromise(value)
    || !Object.isFrozen(value)) return false;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null
    && prototype !== Array.prototype) return false;
  seen.add(value);
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !isDeepFrozenData(descriptor.value, seen)) return false;
  }
  return true;
}

function normalizeEditOutcome(value, request, kernelId, opened) {
  const fields = exactDataFields(value, EDIT_OUTCOME_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION
    || fields.get('ok') !== true) return null;
  let writeReceipt;
  try {
    writeReceipt = assertCanaryStagingWriteReceipt(
      fields.get('writeReceipt'),
      opened.session
    );
  } catch {
    return null;
  }
  const resultFields = exactDataFields(
    fields.get('result'),
    RESULT_KEYS,
    { frozen: true }
  );
  if (writeReceipt.actionDigest !== opened.actionDigest
    || !resultFields
    || resultFields.get('schemaVersion') !== HARNESS_RESULT_SCHEMA_VERSION
    || resultFields.get('requestId') !== request.requestId
    || resultFields.get('operation') !== HARNESS_OPERATIONS.EXECUTE
    || resultFields.get('kernelId') !== kernelId
    || resultFields.get('diagnostics') !== null
    || !isDeepFrozenData(resultFields.get('output'))) return null;
  return Object.freeze({
    result: fields.get('result'),
    writeReceipt,
  });
}

function normalizeDiscardOutcome(value, session) {
  const fields = exactDataFields(value, DISCARD_OUTCOME_KEYS, { frozen: true });
  if (!fields) return null;
  try {
    return assertCanaryStagingDiscardReceipt(fields.get('receipt'), {
      session,
      workspaceDiscardRequest: fields.get('workspaceDiscardRequest'),
    });
  } catch {
    return null;
  }
}

function normalizePromotionTransaction(value, promotionInput) {
  const fields = exactDataFields(value, TRANSACTION_KEYS, { frozen: true });
  if (!fields || fields.get('version') !== CANARY_PROMOTION_TRANSACTION_VERSION) {
    return null;
  }
  try {
    const request = assertCanaryPromotionRequest(
      fields.get('request'),
      promotionInput
    );
    const receipt = assertCanaryPromotionReceipt(fields.get('receipt'), request);
    return Object.freeze({
      version: CANARY_PROMOTION_TRANSACTION_VERSION,
      request,
      receipt,
    });
  } catch {
    return null;
  }
}

function fallbackSignal(request, authorityBinding, opened, frontier, reason, receipt) {
  return Object.freeze({
    schemaVersion: CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
    status: 'fallback_ready',
    requestId: request.requestId,
    jobId: authorityBinding.jobId,
    stagingId: opened.session.stagingId,
    mutationFrontier: frontier,
    reason,
    cleanupReceipt: receipt,
  });
}

function isPreWritePromotionRejection(error) {
  return error instanceof CanaryPromotionControllerError
    && [
      CANARY_PROMOTION_CONTROLLER_REASONS.INVALID_INPUT,
      CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_FAILED,
    ].includes(error.code);
}

function callPromotionSink(port, methodName, value) {
  let result;
  try {
    result = Reflect.apply(port[methodName], port.receiver, [value]);
  } catch {
    throw executorError(
      CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
    );
  }
  if (util.types.isPromise(result)) {
    try {
      Reflect.apply(Promise.prototype.then, result, [() => {}, () => {}]);
    } catch {
      // Any asynchronous sink is rejected regardless of observation behavior.
    }
    throw executorError(
      CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
    );
  }
  if (result !== undefined) {
    throw executorError(
      CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
    );
  }
}

function createCanaryTransactionalStagingExecutor(options = {}) {
  const dependencies = captureDependencies(options);

  function diagnostics() {
    return Object.freeze({
      version: CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
      kernelId: dependencies.kernelId,
      workspaceIsolation: 'per_job_staging',
      networkMode: 'disabled',
      installMode: 'disabled',
      promotionMode: 'explicit_checkpointed',
    });
  }

  async function settleStagingFallback({
    request,
    authorityBinding,
    opened,
    lifecycle,
    reason,
  }) {
    const fallback = lifecycle.requestFallback({ reason });
    if (fallback.ok
      || fallback.code !== CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED) {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.CLEANUP_FAILED
      );
    }
    let discardValue;
    try {
      discardValue = await callNativePort(
        dependencies.workspaceSessionPort,
        'discard',
        [opened.session]
      );
    } catch {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.CLEANUP_FAILED
      );
    }
    const discardReceipt = normalizeDiscardOutcome(
      discardValue,
      opened.session
    );
    if (!discardReceipt) {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.CLEANUP_FAILED
      );
    }
    const cleanup = lifecycle.confirmCleanup(discardReceipt.lifecycleReceipt);
    if (!cleanup.ok
      || cleanup.code !== CANARY_EDIT_LIFECYCLE_CODES.FALLBACK_READY) {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.CLEANUP_FAILED
      );
    }
    return fallbackSignal(
      request,
      authorityBinding,
      opened,
      CANARY_EDIT_MUTATION_FRONTIERS.STAGING,
      reason,
      discardReceipt.lifecycleReceipt
    );
  }

  async function settleSourceFallback({
    request,
    authorityBinding,
    opened,
    lifecycle,
    transaction,
    reason,
    promotionRegistered = false,
  }) {
    const fallback = lifecycle.requestFallback({ reason });
    if (fallback.ok
      || fallback.code !== CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED) {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
      );
    }
    let value;
    try {
      value = await callPromotionController(
        dependencies.promotionController,
        'revert',
        [Object.freeze({ transaction, reason })]
      );
    } catch {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
      );
    }
    let revertReceipt;
    try {
      revertReceipt = assertCanaryPromotionRevertReceipt(value, {
        request: transaction.request,
        promotionReceipt: transaction.receipt,
      });
    } catch {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
      );
    }
    const cleanup = lifecycle.confirmCleanup(revertReceipt.lifecycleReceipt);
    if (!cleanup.ok
      || cleanup.code !== CANARY_EDIT_LIFECYCLE_CODES.FALLBACK_READY) {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
      );
    }
    if (promotionRegistered) {
      try {
        callPromotionSink(
          dependencies.promotionSink,
          'cancel',
          Object.freeze({
            promotionId: transaction.request.promotionId,
            reason: 'automatic_revert_before_completion',
          })
        );
      } catch {
        throw executorError(
          CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
        );
      }
    }
    return fallbackSignal(
      request,
      authorityBinding,
      opened,
      CANARY_EDIT_MUTATION_FRONTIERS.SOURCE,
      reason,
      revertReceipt.lifecycleReceipt
    );
  }

  async function execute(request, grant) {
    const authorityBinding = validateInput(request, grant);
    let openedValue;
    try {
      openedValue = await callNativePort(
        dependencies.workspaceSessionPort,
        'open',
        [request, grant]
      );
    } catch {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.OPEN_FAILED
      );
    }
    const opened = normalizeOpenOutcome(openedValue, request, authorityBinding);
    if (!opened) {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.OPEN_FAILED
      );
    }
    const lifecycle = createCanaryEditLifecycle({
      jobId: authorityBinding.jobId,
      stagingId: opened.session.stagingId,
    });
    const stagingWrite = lifecycle.noteWrite({
      scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING,
    });
    if (!stagingWrite.ok) {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.CLEANUP_FAILED
      );
    }

    let editOutcome = null;
    try {
      const value = await callNativePort(
        dependencies.canaryEditor,
        'execute',
        [request, grant, opened.session]
      );
      editOutcome = normalizeEditOutcome(
        value,
        request,
        dependencies.kernelId,
        opened
      );
    } catch {
      editOutcome = null;
    }
    if (!editOutcome) {
      return settleStagingFallback({
        request,
        authorityBinding,
        opened,
        lifecycle,
        reason: 'canary_execution_failed',
      });
    }

    const promotionInput = Object.freeze({
      promotionId: opened.promotionId,
      session: opened.session,
      writeReceipt: editOutcome.writeReceipt,
      checkpoint: opened.checkpoint,
      workspaceRequest: opened.workspaceRequest,
      sourceSnapshot: opened.sourceSnapshot,
      rootMutation: opened.rootMutation,
    });
    try {
      createCanaryPromotionRequest(promotionInput);
    } catch {
      return settleStagingFallback({
        request,
        authorityBinding,
        opened,
        lifecycle,
        reason: 'promotion_rejected',
      });
    }
    let transactionValue;
    try {
      transactionValue = await callPromotionController(
        dependencies.promotionController,
        'promote',
        [promotionInput]
      );
    } catch (error) {
      if (isPreWritePromotionRejection(error)) {
        return settleStagingFallback({
          request,
          authorityBinding,
          opened,
          lifecycle,
          reason: 'promotion_rejected',
        });
      }
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.PROMOTION_AMBIGUOUS
      );
    }
    const transaction = normalizePromotionTransaction(
      transactionValue,
      promotionInput
    );
    if (!transaction) {
      throw executorError(
        CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.PROMOTION_AMBIGUOUS
      );
    }
    const sourceWrite = lifecycle.noteWrite({
      scope: CANARY_EDIT_MUTATION_FRONTIERS.SOURCE,
    });
    if (!sourceWrite.ok) {
      return settleSourceFallback({
        request,
        authorityBinding,
        opened,
        lifecycle,
        transaction,
        reason: 'source_frontier_invalid',
      });
    }

    try {
      callPromotionSink(
        dependencies.promotionSink,
        'record',
        Object.freeze({
          schemaVersion:
            CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
          rolloutStage: grant.rolloutDecision.rolloutStage,
          transaction,
        })
      );
    } catch {
      return settleSourceFallback({
        request,
        authorityBinding,
        opened,
        lifecycle,
        transaction,
        reason: 'rollback_registration_failed',
      });
    }

    let discardReceipt = null;
    try {
      const discardValue = await callNativePort(
        dependencies.workspaceSessionPort,
        'discard',
        [opened.session]
      );
      discardReceipt = normalizeDiscardOutcome(discardValue, opened.session);
    } catch {
      discardReceipt = null;
    }
    if (!discardReceipt) {
      return settleSourceFallback({
        request,
        authorityBinding,
        opened,
        lifecycle,
        transaction,
        reason: 'post_promotion_cleanup_failed',
        promotionRegistered: true,
      });
    }
    const completed = lifecycle.completeCanary();
    if (!completed.ok
      || completed.code !== CANARY_EDIT_LIFECYCLE_CODES.CANARY_COMPLETED) {
      return settleSourceFallback({
        request,
        authorityBinding,
        opened,
        lifecycle,
        transaction,
        reason: 'canary_completion_failed',
        promotionRegistered: true,
      });
    }
    return createHarnessResult({
      requestId: request.requestId,
      operation: HARNESS_OPERATIONS.EXECUTE,
      kernelId: dependencies.kernelId,
      output: editOutcome.result.output,
      diagnostics: Object.freeze({
        schemaVersion:
          CANARY_TRANSACTIONAL_STAGING_RESULT_DIAGNOSTICS_SCHEMA_VERSION,
        executorVersion: CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
        promotionId: transaction.receipt.promotionId,
        stagingId: transaction.receipt.stagingId,
        checkpointDigest: transaction.receipt.checkpointDigest,
        writeSetDigest: transaction.receipt.writeSetDigest,
        sourceBeforeDigest: transaction.receipt.sourceBeforeDigest,
        sourceAfterDigest: transaction.receipt.sourceAfterDigest,
        changedPaths: Object.freeze([...transaction.receipt.changedPaths]),
        stagingDiscarded: true,
      }),
    });
  }

  return Object.freeze({
    version: CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
    kernelId: dependencies.kernelId,
    execute,
    diagnostics,
  });
}

module.exports = {
  CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
  CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS,
  CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
  CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
  CANARY_TRANSACTIONAL_STAGING_RESULT_DIAGNOSTICS_SCHEMA_VERSION,
  CanaryTransactionalStagingExecutorError,
  createCanaryTransactionalStagingExecutor,
};
