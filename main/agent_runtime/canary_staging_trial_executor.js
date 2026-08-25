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
  assertHarnessRequest,
} = require('./harness_contracts');

const CANARY_STAGING_TRIAL_EXECUTOR_VERSION =
  'canary-staging-trial-executor.v1';
const CANARY_STAGING_OPEN_OUTCOME_SCHEMA_VERSION =
  'canary-staging-open-outcome.v1';
const CANARY_STAGING_EDIT_OUTCOME_SCHEMA_VERSION =
  'canary-staging-edit-outcome.v1';

const CANARY_STAGING_TRIAL_EXECUTOR_REASONS = Object.freeze({
  CLEANUP_FAILED: 'CANARY_STAGING_TRIAL_CLEANUP_FAILED',
  INVALID_INPUT: 'CANARY_STAGING_TRIAL_INVALID_INPUT',
  OPEN_FAILED: 'CANARY_STAGING_TRIAL_OPEN_FAILED',
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
]);
const EDIT_OUTCOME_KEYS = Object.freeze([
  'schemaVersion',
  'ok',
  'writeReceipt',
]);
const DISCARD_OUTCOME_KEYS = Object.freeze([
  'receipt',
  'workspaceDiscardRequest',
]);

class CanaryStagingTrialExecutorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryStagingTrialExecutorError';
    this.code = code;
  }
}

function trialError(code) {
  return new CanaryStagingTrialExecutorError(code);
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
      // The port is rejected regardless of Promise observation behavior.
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

function captureDependencies(options) {
  const fields = exactDataFields(options, OPTION_KEYS);
  const kernelId = fields && fields.get('kernelId');
  if (!fields || typeof kernelId !== 'string' || !SAFE_IDENTIFIER.test(kernelId)) {
    throw new TypeError('Invalid canary staging trial executor options');
  }
  return Object.freeze({
    kernelId,
    workspaceSessionPort: captureWorkspaceSessionPort(
      fields.get('workspaceSessionPort')
    ),
    canaryEditor: captureCanaryEditor(fields.get('canaryEditor'), kernelId),
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
    || ownDataValue(context, 'jobId', { enumerable: true }) !== binding.jobId) return null;
  const projectInfo = ownDataValue(request, 'projectInfo', { enumerable: true });
  const projectPreflight = preflightDataGraph(projectInfo);
  if (!projectPreflight.bounded || projectPreflight.hasNativePromise
    || !projectPreflight.inspectable || !projectInfo || typeof projectInfo !== 'object'
    || Array.isArray(projectInfo) || util.types.isProxy(projectInfo)
    || !Object.isFrozen(projectInfo)) return null;
  const projectId = ownDataValue(projectInfo, 'id', { enumerable: true })
    || ownDataValue(projectInfo, 'projectId', { enumerable: true });
  const projectIdAlias = ownDataValue(projectInfo, 'projectId', { enumerable: true });
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
    && classification.get('classifierVersion') === CANARY_EDIT_ACTION_CLASSIFIER_VERSION
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
    throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.INVALID_INPUT);
  }
  const authorityBinding = readRequestAuthority(request);
  if (!authorityBinding) {
    throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.INVALID_INPUT);
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

function normalizeOpenOutcome(value, request, authorityBinding) {
  const fields = exactDataFields(value, OPEN_OUTCOME_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion') !== CANARY_STAGING_OPEN_OUTCOME_SCHEMA_VERSION
    || fields.get('ok') !== true) return null;
  let workspaceRequest;
  try {
    workspaceRequest = assertExecutionWorkspaceAcquireRequest(
      fields.get('workspaceRequest')
    );
    assertCanaryStagingSession(fields.get('session'), {
      requestId: request.requestId,
      checkpoint: fields.get('checkpoint'),
      workspaceRequest,
    });
  } catch {
    return null;
  }
  let actionDigest;
  try {
    actionDigest = normalizeDigest(fields.get('actionDigest'), 'actionDigest');
  } catch {
    return null;
  }
  if (!bindingsMatch(workspaceRequest.binding, authorityBinding)) return null;
  return Object.freeze({
    actionDigest,
    session: fields.get('session'),
  });
}

function normalizeEditOutcome(value, session, actionDigest) {
  const fields = exactDataFields(value, EDIT_OUTCOME_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion') !== CANARY_STAGING_EDIT_OUTCOME_SCHEMA_VERSION
    || fields.get('ok') !== true) return null;
  let writeReceipt;
  try {
    writeReceipt = assertCanaryStagingWriteReceipt(
      fields.get('writeReceipt'),
      session
    );
  } catch {
    return null;
  }
  return writeReceipt.actionDigest === actionDigest ? writeReceipt : null;
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

function createCanaryStagingTrialExecutor(options = {}) {
  const dependencies = captureDependencies(options);

  function diagnostics() {
    return Object.freeze({
      version: CANARY_STAGING_TRIAL_EXECUTOR_VERSION,
      kernelId: dependencies.kernelId,
      workspaceIsolation: 'per_job_staging',
      networkMode: 'disabled',
      installMode: 'disabled',
      promotionMode: 'explicit_checkpointed',
    });
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
      throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.OPEN_FAILED);
    }
    const opened = normalizeOpenOutcome(openedValue, request, authorityBinding);
    if (!opened) {
      throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.OPEN_FAILED);
    }

    const lifecycle = createCanaryEditLifecycle({
      jobId: authorityBinding.jobId,
      stagingId: opened.session.stagingId,
    });
    const writeFrontier = lifecycle.noteWrite({
      scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING,
    });
    if (!writeFrontier.ok) {
      throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.CLEANUP_FAILED);
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
        opened.session,
        opened.actionDigest
      );
    } catch {
      editOutcome = null;
    }
    const fallbackReason = editOutcome
      ? 'promotion_unavailable'
      : 'canary_execution_failed';
    const fallback = lifecycle.requestFallback({ reason: fallbackReason });
    if (fallback.ok
      || fallback.code !== CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED) {
      throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.CLEANUP_FAILED);
    }

    let discardValue;
    try {
      discardValue = await callNativePort(
        dependencies.workspaceSessionPort,
        'discard',
        [opened.session]
      );
    } catch {
      throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.CLEANUP_FAILED);
    }
    const discardReceipt = normalizeDiscardOutcome(
      discardValue,
      opened.session
    );
    if (!discardReceipt) {
      throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.CLEANUP_FAILED);
    }
    const cleanup = lifecycle.confirmCleanup(discardReceipt.lifecycleReceipt);
    if (!cleanup.ok
      || cleanup.code !== CANARY_EDIT_LIFECYCLE_CODES.FALLBACK_READY) {
      throw trialError(CANARY_STAGING_TRIAL_EXECUTOR_REASONS.CLEANUP_FAILED);
    }
    return Object.freeze({
      schemaVersion: CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
      status: 'fallback_ready',
      requestId: request.requestId,
      jobId: authorityBinding.jobId,
      stagingId: opened.session.stagingId,
      mutationFrontier: CANARY_EDIT_MUTATION_FRONTIERS.STAGING,
      reason: fallbackReason,
      cleanupReceipt: discardReceipt.lifecycleReceipt,
    });
  }

  return Object.freeze({
    version: CANARY_STAGING_TRIAL_EXECUTOR_VERSION,
    kernelId: dependencies.kernelId,
    execute,
    diagnostics,
  });
}

module.exports = {
  CANARY_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
  CANARY_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
  CANARY_STAGING_TRIAL_EXECUTOR_REASONS,
  CANARY_STAGING_TRIAL_EXECUTOR_VERSION,
  CanaryStagingTrialExecutorError,
  createCanaryStagingTrialExecutor,
};
