'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  assertExecutionWorkspaceLease,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  EXECUTION_WORKSPACE_REGISTRY_VERSION,
} = require('../capabilities/execution_workspace_registry');
const {
  assertProjectRootAuthorityLease,
  createProjectRootAuthorityAcquireRequest,
} = require('../capabilities/project_root_authority_contract');
const {
  PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION,
} = require('../capabilities/project_root_authority_registry');
const {
  areEquivalentPortablePaths,
} = require('../capabilities/sandbox_backend_contract');
const {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
} = require('../agent_runtime/canary_edit_action_classifier');
const {
  CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  CANARY_EDIT_ADMISSION_POLICY_VERSION,
} = require('../agent_runtime/canary_edit_admission_policy');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
} = require('../agent_runtime/canary_edit_runner');
const {
  CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_SELECTOR_VERSION,
} = require('../agent_runtime/canary_rollout_selector');
const {
  assertCanaryStagingSession,
  createCanaryStagingDiscardReceipt,
  createCanaryStagingSession,
} = require('../agent_runtime/canary_staging_contract');
const {
  CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
} = require('../agent_runtime/canary_transactional_staging_executor');
const {
  CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
} = require('../agent_runtime/canary_source_snapshot_contract');
const {
  HARNESS_OPERATIONS,
  HARNESS_REQUEST_SCHEMA_VERSION,
} = require('../agent_runtime/harness_contracts');

const CANARY_WORKSPACE_SESSION_PORT_ADAPTER_VERSION =
  'canary-workspace-session-port-adapter.v1';

const CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS = Object.freeze({
  AUTHORITY_DENIED: 'CANARY_WORKSPACE_AUTHORITY_DENIED',
  CLEANUP_FAILED: 'CANARY_WORKSPACE_CLEANUP_FAILED',
  INVALID_INPUT: 'CANARY_WORKSPACE_INVALID_INPUT',
  PROMOTION_ID_UNAVAILABLE: 'CANARY_WORKSPACE_PROMOTION_ID_UNAVAILABLE',
  QUARANTINED: 'CANARY_WORKSPACE_QUARANTINED',
  REENTRANT_CALL: 'CANARY_WORKSPACE_REENTRANT_CALL',
  ROOT_AUTHORITY_UNAVAILABLE: 'CANARY_WORKSPACE_ROOT_AUTHORITY_UNAVAILABLE',
  SESSION_MISMATCH: 'CANARY_WORKSPACE_SESSION_MISMATCH',
  SNAPSHOT_INVALID: 'CANARY_WORKSPACE_SNAPSHOT_INVALID',
  WORKSPACE_UNAVAILABLE: 'CANARY_WORKSPACE_UNAVAILABLE',
});

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PROMOTION_ID_ATTEMPTS = 4;
const OPTION_KEYS = Object.freeze([
  'authorityService',
  'projectRootAuthorityRegistry',
  'executionWorkspaceRegistry',
  'sourceSnapshotProvider',
  'promotionIdFactory',
]);
const REQUEST_KEYS = Object.freeze([
  'action',
  'projectInfo',
  'executionContext',
  'schemaVersion',
  'requestId',
  'operation',
  'contextPack',
]);
const REQUEST_REQUIRED_KEYS = Object.freeze([
  'action',
  'projectInfo',
  'executionContext',
  'schemaVersion',
  'requestId',
  'operation',
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
const CHECKPOINT_KEYS = Object.freeze([
  'checkpointDigest',
  'checkpointVerified',
  'projectId',
  'canonicalRootPath',
  'jobId',
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
const SNAPSHOT_OUTCOME_KEYS = Object.freeze([
  'checkpoint',
  'sourceSnapshot',
  'rootMutation',
]);
const SOURCE_PROVIDER_KEYS = Object.freeze([
  'version',
  'inspect',
  'diagnostics',
]);
const SOURCE_PROVIDER_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'rootReadMode',
  'checkpointMode',
  'mutationObservation',
]);

class CanaryWorkspaceSessionPortAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryWorkspaceSessionPortAdapterError';
    this.code = code;
  }
}

function adapterError(code) {
  return new CanaryWorkspaceSessionPortAdapterError(code);
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

function dataFields(value, allowedKeys, requiredKeys = allowedKeys, {
  frozen = false,
  preflight = true,
} = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  if (preflight) {
    const inspection = preflightDataGraph(value);
    if (!inspection.bounded || inspection.hasNativePromise
      || !inspection.inspectable) return null;
  }
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

function ownDataValue(value, key, enumerable = null) {
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

function inspectableFunction(value, fieldName, { synchronous = false } = {}) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)
    || synchronous && util.types.isAsyncFunction(value)) {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  return value;
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // A malformed native Promise remains invalid even if observation fails.
  }
  return true;
}

function bindingsMatch(left, right) {
  return AUTHORITY_BINDING_KEYS.every((key) => left[key] === right[key]);
}

function freezeDataGraph(value) {
  const inspection = preflightDataGraph(value);
  if (!inspection.bounded || inspection.hasNativePromise
    || !inspection.inspectable) return false;
  const visited = new Set();
  const visiting = new Set();
  const objects = [];

  function visit(entry) {
    if (entry === null || typeof entry === 'string'
      || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') {
      return Number.isFinite(entry) && !Object.is(entry, -0);
    }
    if (!entry || typeof entry !== 'object' || util.types.isProxy(entry)
      || util.types.isPromise(entry)) return false;
    if (visited.has(entry)) return true;
    if (visiting.has(entry)) return false;
    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(entry);
      keys = Reflect.ownKeys(entry);
    } catch {
      return false;
    }
    if (prototype !== Object.prototype && prototype !== null
      && prototype !== Array.prototype) return false;
    visiting.add(entry);
    for (const key of keys) {
      if (Array.isArray(entry) && key === 'length') continue;
      if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || !visit(descriptor.value)) return false;
    }
    visiting.delete(entry);
    visited.add(entry);
    objects.push(entry);
    return true;
  }

  if (!visit(value)) return false;
  try {
    for (const entry of objects) Object.freeze(entry);
  } catch {
    return false;
  }
  return true;
}

function isDeepFrozenData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (!value || typeof value !== 'object'
    || util.types.isProxy(value) || util.types.isPromise(value)
    || !Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
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

function readRequestAuthority(requestFields) {
  const context = requestFields.get('executionContext');
  if (!context || typeof context !== 'object' || !Object.isFrozen(context)
    || util.types.isProxy(context)) return null;
  const rawBinding = ownDataValue(context, 'authorityBinding', false);
  if (!rawBinding || !Object.isFrozen(rawBinding)) return null;
  let binding;
  try {
    binding = createCapabilityDelegationBinding(rawBinding);
  } catch {
    return null;
  }
  if (!bindingsMatch(binding, rawBinding)
    || ownDataValue(context, 'jobId', true) !== binding.jobId) return null;
  const projectInfo = requestFields.get('projectInfo');
  if (!projectInfo || typeof projectInfo !== 'object'
    || util.types.isProxy(projectInfo) || !Object.isFrozen(projectInfo)) return null;
  const projectId = ownDataValue(projectInfo, 'id', true)
    || ownDataValue(projectInfo, 'projectId', true);
  const projectIdAlias = ownDataValue(projectInfo, 'projectId', true);
  const rootPath = ownDataValue(projectInfo, 'rootPath', true);
  if (projectId !== binding.projectId
    || projectIdAlias !== null && projectIdAlias !== binding.projectId
    || !areEquivalentPortablePaths(rootPath, binding.canonicalRootPath)) return null;
  return binding;
}

function validateGrant(value, requestId) {
  const fields = dataFields(value, GRANT_KEYS, GRANT_KEYS, { frozen: true });
  const classification = fields && dataFields(
    fields.get('actionClassification'),
    ACTION_CLASSIFICATION_KEYS,
    ACTION_CLASSIFICATION_KEYS,
    { frozen: true }
  );
  const rollout = fields && dataFields(
    fields.get('rolloutDecision'),
    ROLLOUT_DECISION_KEYS,
    ROLLOUT_DECISION_KEYS,
    { frozen: true }
  );
  const admission = fields && dataFields(
    fields.get('admissionDecision'),
    ADMISSION_DECISION_KEYS,
    ADMISSION_DECISION_KEYS,
    { frozen: true }
  );
  return Boolean(fields && classification && rollout && admission
    && fields.get('schemaVersion')
      === CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION
    && fields.get('requestId') === requestId
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

function normalizeOpenInput(request, grant) {
  const fields = dataFields(
    request,
    REQUEST_KEYS,
    REQUEST_REQUIRED_KEYS,
    { frozen: true, preflight: false }
  );
  const requestId = fields && fields.get('requestId');
  const action = fields && fields.get('action');
  if (!fields
    || fields.get('schemaVersion') !== HARNESS_REQUEST_SCHEMA_VERSION
    || fields.get('operation') !== HARNESS_OPERATIONS.EXECUTE
    || typeof requestId !== 'string' || !requestId.trim()
    || requestId.includes('\0') || Buffer.byteLength(requestId, 'utf8') > 4096
    || !validateGrant(grant, requestId)) return null;
  const binding = readRequestAuthority(fields);
  if (!binding || !freezeDataGraph(action) || !isDeepFrozenData(action)) return null;
  return Object.freeze({ request, grant, requestId, action, binding });
}

function captureAuthorityService(value) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || !Object.isFrozen(value)) {
    throw new TypeError('authorityService must be a frozen authority');
  }
  return Object.freeze({
    receiver: value,
    authorizeExecute: inspectableFunction(
      ownDataValue(value, 'authorizeExecute'),
      'authorityService.authorizeExecute',
      { synchronous: true }
    ),
    authorizeProjectRootLease: inspectableFunction(
      ownDataValue(value, 'authorizeProjectRootLease'),
      'authorityService.authorizeProjectRootLease',
      { synchronous: true }
    ),
  });
}

function captureRegistry(value, {
  fieldName,
  version,
  keys,
  methods,
  versionInSurface = true,
}) {
  const fields = dataFields(value, keys, keys, { frozen: true });
  if (!fields || versionInSurface && fields.get('version') !== version) {
    throw new TypeError(`${fieldName} must be a frozen enforced registry`);
  }
  if (!versionInSurface) {
    const diagnosticsMethod = inspectableFunction(
      fields.get('diagnostics'),
      `${fieldName}.diagnostics`,
      { synchronous: true }
    );
    let diagnostics;
    try {
      diagnostics = Reflect.apply(diagnosticsMethod, value, []);
    } catch {
      throw new TypeError(`${fieldName}.diagnostics failed`);
    }
    if (absorbNativePromise(diagnostics)
      || !isPlainRecord(diagnostics) || !Object.isFrozen(diagnostics)
      || ownDataValue(diagnostics, 'version', true) !== version) {
      throw new TypeError(`${fieldName} diagnostics are invalid`);
    }
  }
  const captured = { receiver: value, version };
  for (const method of methods) {
    captured[method] = inspectableFunction(
      fields.get(method),
      `${fieldName}.${method}`
    );
  }
  return Object.freeze(captured);
}

function captureSourceSnapshotProvider(value) {
  const fields = dataFields(
    value,
    SOURCE_PROVIDER_KEYS,
    SOURCE_PROVIDER_KEYS,
    { frozen: true }
  );
  if (!fields
    || fields.get('version') !== CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION) {
    throw new TypeError('sourceSnapshotProvider must be a frozen verified provider');
  }
  const captured = Object.freeze({
    receiver: value,
    version: fields.get('version'),
    inspect: inspectableFunction(
      fields.get('inspect'),
      'sourceSnapshotProvider.inspect'
    ),
    diagnostics: inspectableFunction(
      fields.get('diagnostics'),
      'sourceSnapshotProvider.diagnostics',
      { synchronous: true }
    ),
  });
  let diagnostics;
  try {
    diagnostics = Reflect.apply(captured.diagnostics, captured.receiver, []);
  } catch {
    throw new TypeError('sourceSnapshotProvider.diagnostics failed');
  }
  if (absorbNativePromise(diagnostics)) {
    throw new TypeError('sourceSnapshotProvider.diagnostics must be synchronous');
  }
  const diagnosticFields = dataFields(
    diagnostics,
    SOURCE_PROVIDER_DIAGNOSTIC_KEYS,
    SOURCE_PROVIDER_DIAGNOSTIC_KEYS,
    { frozen: true }
  );
  if (!diagnosticFields
    || diagnosticFields.get('version') !== captured.version
    || diagnosticFields.get('rootReadMode') !== 'pinned_authority_reader'
    || diagnosticFields.get('checkpointMode') !== 'verified'
    || diagnosticFields.get('mutationObservation') !== 'exclusive_job') {
    throw new TypeError('sourceSnapshotProvider diagnostics are invalid');
  }
  return captured;
}

function captureDependencies(options) {
  const fields = dataFields(options, OPTION_KEYS, OPTION_KEYS);
  if (!fields) throw new TypeError('Invalid canary workspace session adapter options');
  const promotionIdFactory = inspectableFunction(
    fields.get('promotionIdFactory'),
    'promotionIdFactory',
    { synchronous: true }
  );
  return Object.freeze({
    authorityService: captureAuthorityService(fields.get('authorityService')),
    projectRootAuthorityRegistry: captureRegistry(
      fields.get('projectRootAuthorityRegistry'),
      {
        fieldName: 'projectRootAuthorityRegistry',
        version: PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION,
        keys: ['acquire', 'diagnostics', 'dispose', 'release'],
        methods: ['acquire', 'release'],
        versionInSurface: false,
      }
    ),
    executionWorkspaceRegistry: captureRegistry(
      fields.get('executionWorkspaceRegistry'),
      {
        fieldName: 'executionWorkspaceRegistry',
        version: EXECUTION_WORKSPACE_REGISTRY_VERSION,
        keys: ['version', 'acquire', 'rollback', 'diagnostics', 'dispose'],
        methods: ['acquire', 'rollback'],
      }
    ),
    sourceSnapshotProvider: captureSourceSnapshotProvider(
      fields.get('sourceSnapshotProvider')
    ),
    promotionIdFactory,
  });
}

function normalizeAuthorizedBinding(value, expectedBinding) {
  let binding;
  try {
    binding = createCapabilityDelegationBinding(value);
  } catch {
    return null;
  }
  return bindingsMatch(binding, expectedBinding) ? binding : null;
}

function normalizeExecuteAuthorization(value, expectedBinding) {
  const fields = dataFields(
    value,
    ['authorized', 'reason', 'binding', 'actionDigest'],
    ['authorized', 'reason', 'binding', 'actionDigest'],
    { frozen: true }
  );
  if (!fields || fields.get('authorized') !== true
    || typeof fields.get('reason') !== 'string'
    || !normalizeAuthorizedBinding(fields.get('binding'), expectedBinding)) return null;
  try {
    return Object.freeze({
      actionDigest: normalizeDigest(fields.get('actionDigest'), 'actionDigest'),
    });
  } catch {
    return null;
  }
}

function normalizeRootAuthorization(value, expectedBinding) {
  const fields = dataFields(
    value,
    ['authorized', 'reason', 'binding', 'physicalRootIdentityDigest'],
    ['authorized', 'reason', 'binding', 'physicalRootIdentityDigest'],
    { frozen: true }
  );
  if (!fields || fields.get('authorized') !== true
    || typeof fields.get('reason') !== 'string'
    || !normalizeAuthorizedBinding(fields.get('binding'), expectedBinding)) return null;
  try {
    return Object.freeze({
      physicalRootIdentityDigest: normalizeDigest(
        fields.get('physicalRootIdentityDigest'),
        'physicalRootIdentityDigest'
      ),
    });
  } catch {
    return null;
  }
}

function callNativePort(port, methodName, args, fieldName) {
  let pending;
  try {
    pending = Reflect.apply(port[methodName], port.receiver, args);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.reject(new TypeError(`${fieldName} failed`));
  }
  if (!util.types.isPromise(pending)) {
    preflightDataGraph(pending);
    return Promise.reject(new TypeError(`${fieldName} must return a native Promise`));
  }
  return new Promise((resolve, reject) => {
    const rejected = (error) => {
      preflightDataGraph(error);
      reject(new TypeError(`${fieldName} rejected`));
    };
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, rejected]);
    } catch (error) {
      rejected(error);
    }
  });
}

function createCanonicalCheckpoint(value, binding) {
  const fields = dataFields(value, CHECKPOINT_KEYS, CHECKPOINT_KEYS, {
    frozen: true,
  });
  let checkpointDigest;
  try {
    checkpointDigest = fields
      ? normalizeDigest(fields.get('checkpointDigest'), 'checkpointDigest')
      : null;
  } catch {
    return null;
  }
  if (!fields || !checkpointDigest
    || fields.get('checkpointVerified') !== true
    || fields.get('projectId') !== binding.projectId
    || fields.get('jobId') !== binding.jobId
    || !areEquivalentPortablePaths(
      fields.get('canonicalRootPath'),
      binding.canonicalRootPath
    )) return null;
  return Object.freeze({
    checkpointDigest,
    checkpointVerified: true,
    projectId: binding.projectId,
    canonicalRootPath: binding.canonicalRootPath,
    jobId: binding.jobId,
  });
}

function createCanonicalSourceSnapshot(value, checkpoint, sourceIdentity) {
  const fields = dataFields(
    value,
    SOURCE_SNAPSHOT_KEYS,
    SOURCE_SNAPSHOT_KEYS,
    { frozen: true }
  );
  if (!fields) return null;
  const snapshot = {};
  try {
    for (const key of SOURCE_SNAPSHOT_KEYS) {
      snapshot[key] = normalizeDigest(fields.get(key), key);
    }
  } catch {
    return null;
  }
  if (snapshot.checkpointDigest !== checkpoint.checkpointDigest
    || snapshot.sourceRootIdentityDigest !== sourceIdentity) return null;
  return Object.freeze(snapshot);
}

function createCanonicalRootMutation(value, binding) {
  const fields = dataFields(value, ROOT_MUTATION_KEYS, ROOT_MUTATION_KEYS, {
    frozen: true,
  });
  if (!fields || !areEquivalentPortablePaths(
    fields.get('canonicalRootPath'),
    binding.canonicalRootPath
  ) || fields.get('ownerJobId') !== binding.jobId
    || fields.get('activeOtherMutatingJobs') !== 0
    || Object.is(fields.get('activeOtherMutatingJobs'), -0)) return null;
  return Object.freeze({
    canonicalRootPath: binding.canonicalRootPath,
    ownerJobId: binding.jobId,
    activeOtherMutatingJobs: 0,
  });
}

function normalizeSnapshotOutcome(value, record) {
  const fields = dataFields(
    value,
    SNAPSHOT_OUTCOME_KEYS,
    SNAPSHOT_OUTCOME_KEYS,
    { frozen: true }
  );
  if (!fields) return null;
  const checkpoint = createCanonicalCheckpoint(
    fields.get('checkpoint'),
    record.binding
  );
  const sourceSnapshot = checkpoint && createCanonicalSourceSnapshot(
    fields.get('sourceSnapshot'),
    checkpoint,
    record.sourceRootIdentityDigest
  );
  const rootMutation = createCanonicalRootMutation(
    fields.get('rootMutation'),
    record.binding
  );
  if (!checkpoint || !sourceSnapshot || !rootMutation) return null;
  let session;
  try {
    session = createCanaryStagingSession({
      requestId: record.requestId,
      checkpoint,
      workspaceRequest: record.workspaceRequest,
      workspaceLease: record.workspaceLease,
    });
  } catch {
    return null;
  }
  return Object.freeze({ checkpoint, sourceSnapshot, rootMutation, session });
}

function normalizeRootAcquire(value, binding, sourceIdentity) {
  const fields = dataFields(value, ['ok', 'lease', 'idempotent'], [
    'ok',
    'lease',
    'idempotent',
  ], { frozen: true });
  if (!fields || fields.get('ok') !== true
    || typeof fields.get('idempotent') !== 'boolean') return null;
  const leaseId = ownDataValue(fields.get('lease'), 'leaseId', true);
  try {
    const request = createProjectRootAuthorityAcquireRequest({
      leaseId,
      binding,
      expectedPhysicalRootIdentityDigest: sourceIdentity,
      purpose: 'execution',
    });
    return Object.freeze({
      request,
      lease: assertProjectRootAuthorityLease(fields.get('lease'), request),
    });
  } catch {
    return null;
  }
}

function normalizeWorkspaceAcquire(value, binding, sourceIdentity) {
  const fields = dataFields(value, ['ok', 'lease'], ['ok', 'lease'], {
    frozen: true,
  });
  if (!fields || fields.get('ok') !== true) return null;
  const leaseId = ownDataValue(fields.get('lease'), 'leaseId', true);
  try {
    const request = createExecutionWorkspaceAcquireRequest({
      leaseId,
      binding,
      sourceRootIdentityDigest: sourceIdentity,
    });
    return Object.freeze({
      request,
      lease: assertExecutionWorkspaceLease(fields.get('lease'), request),
    });
  } catch {
    return null;
  }
}

function confirmedWorkspaceRollback(value) {
  const fields = dataFields(
    value,
    ['ok', 'rolledBack', 'idempotent'],
    ['ok', 'rolledBack', 'idempotent'],
    { frozen: true }
  );
  return Boolean(fields && fields.get('ok') === true
    && fields.get('rolledBack') === true
    && typeof fields.get('idempotent') === 'boolean');
}

function confirmedRootRelease(value) {
  const fields = dataFields(
    value,
    ['ok', 'closed', 'idempotent'],
    ['ok', 'closed', 'idempotent'],
    { frozen: true }
  );
  return Boolean(fields && fields.get('ok') === true
    && fields.get('closed') === true
    && typeof fields.get('idempotent') === 'boolean');
}

function createCanaryWorkspaceSessionPortAdapter(options = {}) {
  const dependencies = captureDependencies(options);
  const recordsByJobId = new Map();
  const usedPromotionIds = new Set();
  let callDepth = 0;
  let healthy = true;

  function diagnostics() {
    return Object.freeze({
      version: CANARY_WORKSPACE_SESSION_PORT_ADAPTER_VERSION,
      workspaceIsolation: 'per_job_staging',
      sourceMutation: 'forbidden',
      discardMode: 'verified',
    });
  }

  function reject(code) {
    return Promise.reject(adapterError(code));
  }

  function callSynchronous(receiver, method, args) {
    let value;
    callDepth += 1;
    try {
      value = Reflect.apply(method, receiver, args);
    } catch (error) {
      preflightDataGraph(error);
      return null;
    } finally {
      callDepth -= 1;
    }
    if (absorbNativePromise(value)) {
      return null;
    }
    return value;
  }

  function nextPromotionId(record) {
    const input = Object.freeze({
      requestId: record.requestId,
      jobId: record.binding.jobId,
      actionDigest: record.actionDigest,
    });
    for (let attempt = 0; attempt < PROMOTION_ID_ATTEMPTS; attempt += 1) {
      const candidate = callSynchronous(
        dependencies,
        dependencies.promotionIdFactory,
        [input]
      );
      if (typeof candidate === 'string' && SAFE_IDENTIFIER.test(candidate)
        && !usedPromotionIds.has(candidate)) {
        usedPromotionIds.add(candidate);
        return candidate;
      }
    }
    return null;
  }

  function quarantine(record) {
    healthy = false;
    if (record) record.state = 'quarantined';
  }

  async function cleanupAcquisitions(record) {
    let workspaceClean = record.workspaceLease === null;
    let rootClean = record.rootLease === null;
    if (record.workspaceLease) {
      try {
        const result = await callNativePort(
          dependencies.executionWorkspaceRegistry,
          'rollback',
          [Object.freeze({
            binding: record.binding,
            leaseId: record.workspaceLease.leaseId,
          })],
          'executionWorkspaceRegistry.rollback'
        );
        workspaceClean = confirmedWorkspaceRollback(result);
      } catch {
        workspaceClean = false;
      }
    }
    if (record.rootLease) {
      try {
        const result = await callNativePort(
          dependencies.projectRootAuthorityRegistry,
          'release',
          [Object.freeze({
            binding: record.binding,
            leaseId: record.rootLease.leaseId,
          })],
          'projectRootAuthorityRegistry.release'
        );
        rootClean = confirmedRootRelease(result);
      } catch {
        rootClean = false;
      }
    }
    return workspaceClean && rootClean;
  }

  async function rejectAfterCleanup(record, reason) {
    const clean = await cleanupAcquisitions(record);
    if (!clean) {
      quarantine(record);
      throw adapterError(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.CLEANUP_FAILED
      );
    }
    record.state = 'failed_clean';
    recordsByJobId.delete(record.binding.jobId);
    throw adapterError(reason);
  }

  async function performOpen(record) {
    let rootResult;
    try {
      rootResult = await callNativePort(
        dependencies.projectRootAuthorityRegistry,
        'acquire',
        [Object.freeze({
          binding: record.binding,
          expectedPhysicalRootIdentityDigest: record.sourceRootIdentityDigest,
          purpose: 'execution',
        })],
        'projectRootAuthorityRegistry.acquire'
      );
    } catch {
      recordsByJobId.delete(record.binding.jobId);
      throw adapterError(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.ROOT_AUTHORITY_UNAVAILABLE
      );
    }
    if (ownDataValue(rootResult, 'ok', true) !== true) {
      recordsByJobId.delete(record.binding.jobId);
      throw adapterError(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.ROOT_AUTHORITY_UNAVAILABLE
      );
    }
    const acquiredRoot = normalizeRootAcquire(
      rootResult,
      record.binding,
      record.sourceRootIdentityDigest
    );
    if (!acquiredRoot) {
      quarantine(record);
      throw adapterError(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.CLEANUP_FAILED
      );
    }
    record.rootRequest = acquiredRoot.request;
    record.rootLease = acquiredRoot.lease;

    let workspaceResult;
    try {
      workspaceResult = await callNativePort(
        dependencies.executionWorkspaceRegistry,
        'acquire',
        [Object.freeze({
          binding: record.binding,
          sourceRootIdentityDigest: record.sourceRootIdentityDigest,
        })],
        'executionWorkspaceRegistry.acquire'
      );
    } catch {
      return rejectAfterCleanup(
        record,
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.WORKSPACE_UNAVAILABLE
      );
    }
    if (ownDataValue(workspaceResult, 'ok', true) !== true) {
      return rejectAfterCleanup(
        record,
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.WORKSPACE_UNAVAILABLE
      );
    }
    const acquiredWorkspace = normalizeWorkspaceAcquire(
      workspaceResult,
      record.binding,
      record.sourceRootIdentityDigest
    );
    if (!acquiredWorkspace) {
      quarantine(record);
      throw adapterError(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.CLEANUP_FAILED
      );
    }
    record.workspaceRequest = acquiredWorkspace.request;
    record.workspaceLease = acquiredWorkspace.lease;

    let snapshotValue;
    try {
      snapshotValue = await callNativePort(
        dependencies.sourceSnapshotProvider,
        'inspect',
        [Object.freeze({
          request: record.request,
          grant: record.grant,
          binding: record.binding,
          actionDigest: record.actionDigest,
          rootLease: record.rootLease,
          workspaceRequest: record.workspaceRequest,
          workspaceLease: record.workspaceLease,
        })],
        'sourceSnapshotProvider.inspect'
      );
    } catch {
      return rejectAfterCleanup(
        record,
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SNAPSHOT_INVALID
      );
    }
    const snapshot = normalizeSnapshotOutcome(snapshotValue, record);
    if (!snapshot) {
      return rejectAfterCleanup(
        record,
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SNAPSHOT_INVALID
      );
    }
    record.checkpoint = snapshot.checkpoint;
    record.session = snapshot.session;
    record.sourceSnapshot = snapshot.sourceSnapshot;
    record.rootMutation = snapshot.rootMutation;
    record.state = 'opened';
    record.openOutcome = Object.freeze({
      schemaVersion: CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
      ok: true,
      session: record.session,
      checkpoint: record.checkpoint,
      workspaceRequest: record.workspaceRequest,
      actionDigest: record.actionDigest,
      promotionId: record.promotionId,
      sourceSnapshot: record.sourceSnapshot,
      rootMutation: record.rootMutation,
    });
    return record.openOutcome;
  }

  function open(request, grant) {
    if (!healthy) {
      return reject(CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.QUARANTINED);
    }
    if (callDepth > 0) {
      return reject(CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.REENTRANT_CALL);
    }
    const input = normalizeOpenInput(request, grant);
    if (!input) {
      return reject(CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.INVALID_INPUT);
    }
    const existing = recordsByJobId.get(input.binding.jobId);
    if (existing) {
      if (existing.request === request && existing.grant === grant
        && existing.openPromise
        && ['opening', 'opened'].includes(existing.state)) {
        return existing.openPromise;
      }
      return reject(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SESSION_MISMATCH
      );
    }
    const record = {
      action: input.action,
      actionDigest: null,
      binding: input.binding,
      checkpoint: null,
      discardOutcome: null,
      discardPromise: null,
      grant: input.grant,
      openOutcome: null,
      openPromise: null,
      promotionId: null,
      request: input.request,
      requestId: input.requestId,
      rootLease: null,
      rootMutation: null,
      rootRequest: null,
      session: null,
      sourceRootIdentityDigest: null,
      sourceSnapshot: null,
      state: 'authorizing',
      workspaceLease: null,
      workspaceRequest: null,
    };
    recordsByJobId.set(record.binding.jobId, record);
    const executeValue = callSynchronous(
      dependencies.authorityService.receiver,
      dependencies.authorityService.authorizeExecute,
      [Object.freeze({ binding: record.binding, action: record.action })]
    );
    const executeAuthorization = normalizeExecuteAuthorization(
      executeValue,
      record.binding
    );
    if (!executeAuthorization) {
      recordsByJobId.delete(record.binding.jobId);
      return reject(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.AUTHORITY_DENIED
      );
    }
    record.actionDigest = executeAuthorization.actionDigest;
    const rootValue = callSynchronous(
      dependencies.authorityService.receiver,
      dependencies.authorityService.authorizeProjectRootLease,
      [record.binding]
    );
    const rootAuthorization = normalizeRootAuthorization(
      rootValue,
      record.binding
    );
    if (!rootAuthorization) {
      recordsByJobId.delete(record.binding.jobId);
      return reject(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.AUTHORITY_DENIED
      );
    }
    record.sourceRootIdentityDigest =
      rootAuthorization.physicalRootIdentityDigest;
    record.promotionId = nextPromotionId(record);
    if (!record.promotionId) {
      recordsByJobId.delete(record.binding.jobId);
      return reject(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.PROMOTION_ID_UNAVAILABLE
      );
    }
    record.state = 'opening';
    record.openPromise = performOpen(record);
    return record.openPromise;
  }

  function locateDiscardRecord(session) {
    if (!session || typeof session !== 'object' || util.types.isProxy(session)
      || !Object.isFrozen(session)) return null;
    const jobId = ownDataValue(session, 'jobId', true);
    const record = typeof jobId === 'string' ? recordsByJobId.get(jobId) : null;
    if (!record || !record.session || record.state === 'opening') return null;
    try {
      assertCanaryStagingSession(session, {
        requestId: record.requestId,
        checkpoint: record.checkpoint,
        workspaceRequest: record.workspaceRequest,
      });
    } catch {
      return null;
    }
    return record;
  }

  async function performDiscard(record) {
    let workspaceDiscardRequest;
    try {
      workspaceDiscardRequest = createExecutionWorkspaceDiscardRequest({
        request: record.workspaceRequest,
        lease: record.workspaceLease,
      });
    } catch {
      quarantine(record);
      throw adapterError(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.CLEANUP_FAILED
      );
    }
    const clean = await cleanupAcquisitions(record);
    if (!clean) {
      quarantine(record);
      throw adapterError(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.CLEANUP_FAILED
      );
    }
    let outcome;
    try {
      const workspaceDiscardReceipt = createExecutionWorkspaceDiscardReceipt({
        request: workspaceDiscardRequest,
        discarded: true,
      });
      const receipt = createCanaryStagingDiscardReceipt({
        session: record.session,
        workspaceDiscardRequest,
        workspaceDiscardReceipt,
      });
      outcome = Object.freeze({ receipt, workspaceDiscardRequest });
    } catch {
      quarantine(record);
      throw adapterError(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.CLEANUP_FAILED
      );
    }
    record.discardOutcome = outcome;
    record.state = 'discarded';
    return outcome;
  }

  function discard(session) {
    if (callDepth > 0) {
      return reject(CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.REENTRANT_CALL);
    }
    const record = locateDiscardRecord(session);
    if (!record) {
      return reject(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SESSION_MISMATCH
      );
    }
    if (record.state === 'quarantined') {
      return reject(CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.QUARANTINED);
    }
    if (record.state === 'discarded') return Promise.resolve(record.discardOutcome);
    if (record.discardPromise) return record.discardPromise;
    if (record.state !== 'opened') {
      return reject(
        CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS.SESSION_MISMATCH
      );
    }
    record.state = 'discarding';
    record.discardPromise = performDiscard(record);
    return record.discardPromise;
  }

  return Object.freeze({
    version: CANARY_WORKSPACE_SESSION_PORT_ADAPTER_VERSION,
    open,
    discard,
    diagnostics,
  });
}

module.exports = {
  CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
  CANARY_WORKSPACE_SESSION_PORT_ADAPTER_REASONS,
  CANARY_WORKSPACE_SESSION_PORT_ADAPTER_VERSION,
  CanaryWorkspaceSessionPortAdapterError,
  createCanaryWorkspaceSessionPortAdapter,
};
