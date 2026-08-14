'use strict';

const {
  CAPABILITY_DELEGATION_EFFECTS,
  CAPABILITY_DELEGATION_MODES,
  createCapabilityDelegationBinding,
  createCapabilityDelegationDecisionRequest,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  PROJECT_CAPABILITY_EFFECTS,
  createProjectCapabilityRequest,
} = require('../capabilities/project_capability_contracts');
const {
  TRANSACTIONAL_DELETE_PATH_STYLES,
  TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES,
  TRANSACTIONAL_DELETE_STATES,
  assertTransactionalDeletePlan,
  canonicalSha256Digest,
  createTransactionalDeletePublicRequest,
  createTransactionalDeletePublicResult,
} = require('../capabilities/transactional_delete_contracts');

const AGENTIC_DELETE_ORCHESTRATOR_VERSION = 'agentic-delete-orchestrator.v1';
const AGENTIC_DELETE_RESULT_VERSION = 'agentic-delete-result.v1';

const AGENTIC_DELETE_ERROR_CODES = Object.freeze({
  APPROVAL_DENIED: 'APPROVAL_DENIED',
  BROKER_DENIED: 'BROKER_DENIED',
  BROKER_FAILED: 'BROKER_FAILED',
  BROKER_FRESH_APPROVAL_REQUIRED: 'BROKER_FRESH_APPROVAL_REQUIRED',
  CONTEXT_INVALID: 'CONTEXT_INVALID',
  INVALID_REQUEST: 'INVALID_REQUEST',
  OPERATION_BUSY: 'OPERATION_BUSY',
  OPERATION_CANCELED: 'OPERATION_CANCELED',
  OPERATION_FAILED: 'OPERATION_FAILED',
  ROUTING_INVALID: 'ROUTING_INVALID',
});

const OPTION_KEYS = Object.freeze([
  'createBroker',
  'transactionalDeleteService',
  'nativeEffectApprovalService',
  'nativeTaskConsentService',
  'taskDelegationStore',
  'authorizeLifecycle',
  'authorizeRoot',
  'getWindowLease',
  'getActorId',
  'requestIdFactory',
  'pathStyle',
  'caseSensitive',
]);

const EXECUTE_KEYS = Object.freeze([
  'binding',
  'requestedMode',
  'paths',
  'signal',
  'projectLabel',
]);
const TERMINAL_KEYS = Object.freeze(['binding', 'status']);
const REVOKE_KEYS = Object.freeze(['binding', 'reason']);
const RECOVER_KEYS = Object.freeze(['binding']);
const BINDING_FIELDS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const VERIFICATION_FIELDS = Object.freeze([
  'effect',
  'binding',
  'deleteRequestDigest',
  'impactDigest',
  'checkpointDigest',
  'checkpointVerified',
  'exactPathsVerified',
  'protectedPathsRejected',
  'impact',
]);
const DECISION_FACT_FIELDS = Object.freeze([...VERIFICATION_FIELDS, 'requestDigest']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const TERMINAL_OUTCOMES = new Set([
  'success',
  'completed',
  'failed',
  'cancelled',
  'canceled',
  'runtime_interrupted',
  'interrupted',
]);
const PUBLIC_STATES = new Set(Object.values(TRANSACTIONAL_DELETE_STATES));
const CANCELLED_STEP = Object.freeze({ kind: 'canceled' });

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPromiseLike(value) {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function';
}

function assertPlainDataRecord(value, allowedKeys, requiredKeys, fieldName) {
  if (!isRecord(value)) throw new TypeError(`${fieldName} must be a plain data record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${fieldName} must be a plain data record`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) {
    throw new TypeError(`${fieldName} contains unsupported fields`);
  }
  if (requiredKeys.some((key) => !keys.includes(key))) {
    throw new TypeError(`${fieldName} is missing required fields`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${fieldName} must not contain undefined`);
  }
  return value;
}

function dataValue(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function dataBoolean(value, key) {
  if (!isRecord(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return Boolean(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === true);
}

function requireMethods(value, methods, fieldName) {
  if (!value || typeof value !== 'object') throw new TypeError(`${fieldName} is required`);
  for (const method of methods) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`${fieldName}.${method} must be a function`);
    }
  }
}

function sameBinding(left, right) {
  return BINDING_FIELDS.every((field) => left[field] === right[field]);
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function publicImpact(value) {
  if (!isRecord(value)) return null;
  const impact = {};
  for (const field of ['files', 'bytes', 'directories']) {
    const raw = dataValue(value, field);
    if (!Number.isSafeInteger(raw) || raw < 0 || Object.is(raw, -0)) return null;
    impact[field] = raw;
  }
  if (impact.files === 0 && impact.directories === 0) return null;
  return Object.freeze(impact);
}

function publicResult({ status, mode, state = null, impact = null, errorCode = null }) {
  const safeStatus = ['completed', 'denied', 'failed'].includes(status) ? status : 'failed';
  const safeMode = Object.values(CAPABILITY_DELEGATION_MODES).includes(mode)
    ? mode
    : CAPABILITY_DELEGATION_MODES.ASK_EACH;
  const safeState = PUBLIC_STATES.has(state) ? state : null;
  const safeImpact = publicImpact(impact);
  const safeError = errorCode === null
    ? null
    : (SAFE_ERROR_CODE.test(String(errorCode || ''))
      ? String(errorCode)
      : AGENTIC_DELETE_ERROR_CODES.OPERATION_FAILED);
  return Object.freeze({
    schemaVersion: AGENTIC_DELETE_RESULT_VERSION,
    ok: safeStatus === 'completed',
    status: safeStatus,
    mode: safeMode,
    state: safeState,
    impact: safeImpact,
    errorCode: safeStatus === 'completed' ? null : safeError,
  });
}

function denied(mode, errorCode, impact = null, state = null) {
  return publicResult({ status: 'denied', mode, state, impact, errorCode });
}

function failed(mode, errorCode, impact = null, state = null) {
  return publicResult({ status: 'failed', mode, state, impact, errorCode });
}

function normalizeReason(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return SAFE_REASON.test(normalized) ? normalized : fallback;
}

function normalizeActorId(value) {
  if (typeof value !== 'string') throw new TypeError('actorId must be a safe identifier');
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) throw new TypeError('actorId must be a safe identifier');
  return normalized;
}

function normalizeRequestId(value) {
  if (typeof value !== 'string') throw new TypeError('requestId must be a safe identifier');
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER.test(normalized)) throw new TypeError('requestId must be a safe identifier');
  return normalized;
}

function isAbortSignal(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  if (typeof AbortSignal === 'function' && value instanceof AbortSignal) return true;
  return false;
}

function opaqueLease(value) {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function');
}

function createAgenticDeleteOrchestrator(options = {}) {
  assertPlainDataRecord(options, OPTION_KEYS, OPTION_KEYS, 'orchestrator options');
  const createBroker = dataValue(options, 'createBroker');
  const transactionalDeleteService = dataValue(options, 'transactionalDeleteService');
  const nativeEffectApprovalService = dataValue(options, 'nativeEffectApprovalService');
  const nativeTaskConsentService = dataValue(options, 'nativeTaskConsentService');
  const taskDelegationStore = dataValue(options, 'taskDelegationStore');
  const authorizeLifecycle = dataValue(options, 'authorizeLifecycle');
  const authorizeRoot = dataValue(options, 'authorizeRoot');
  const getWindowLease = dataValue(options, 'getWindowLease');
  const getActorId = dataValue(options, 'getActorId');
  const requestIdFactory = dataValue(options, 'requestIdFactory');
  const pathStyle = dataValue(options, 'pathStyle');
  const caseSensitive = dataValue(options, 'caseSensitive');

  for (const [name, callback] of [
    ['createBroker', createBroker],
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['getWindowLease', getWindowLease],
    ['getActorId', getActorId],
    ['requestIdFactory', requestIdFactory],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }
  requireMethods(
    transactionalDeleteService,
    ['prepare', 'finalizeJob', 'rollbackJob', 'recoverProject', 'diagnostics'],
    'transactionalDeleteService'
  );
  requireMethods(
    nativeEffectApprovalService,
    ['requestDecision', 'consumeDecision', 'cancelJob', 'invalidateWindow', 'diagnostics'],
    'nativeEffectApprovalService'
  );
  requireMethods(
    nativeTaskConsentService,
    ['ensureTaskDelegation', 'cancelJob', 'invalidateWindow', 'diagnostics'],
    'nativeTaskConsentService'
  );
  requireMethods(
    taskDelegationStore,
    ['inspectDecision', 'consumeDecision', 'revokeBinding', 'diagnostics'],
    'taskDelegationStore'
  );
  if (!Object.values(TRANSACTIONAL_DELETE_PATH_STYLES).includes(pathStyle)) {
    throw new TypeError('pathStyle must be posix or windows');
  }
  if (typeof caseSensitive !== 'boolean') throw new TypeError('caseSensitive must be boolean');

  const activeByTask = new Map();
  let windowGeneration = 0;
  let completedOperations = 0;
  let deniedOperations = 0;
  let failedOperations = 0;

  function bindingKey(binding) {
    return canonicalSha256Digest(binding);
  }

  function validLifecycleResult(result, binding) {
    if (isPromiseLike(result) || !isRecord(result) || !dataBoolean(result, 'authorized')) return false;
    const candidate = dataValue(result, 'binding');
    if (candidate === undefined) return false;
    try {
      return sameBinding(createCapabilityDelegationBinding(candidate), binding);
    } catch {
      return false;
    }
  }

  function validRootResult(result, binding) {
    if (isPromiseLike(result) || !isRecord(result) || !dataBoolean(result, 'authorized')) return false;
    const candidate = dataValue(result, 'binding');
    if (candidate !== undefined) {
      try {
        return sameBinding(createCapabilityDelegationBinding(candidate), binding);
      } catch {
        return false;
      }
    }
    return dataValue(result, 'projectId') === binding.projectId
      && dataValue(result, 'canonicalRootPath') === binding.canonicalRootPath
      && dataValue(result, 'realRootPath') === binding.realRootPath;
  }

  function bindingAuthorized(binding) {
    try {
      if (!validLifecycleResult(authorizeLifecycle(binding), binding)) return false;
      if (!validRootResult(authorizeRoot(binding), binding)) return false;
      // A re-entrant root check can revoke lifecycle authority. Repeat the
      // lifecycle epoch check before publishing any operation state.
      return validLifecycleResult(authorizeLifecycle(binding), binding);
    } catch {
      return false;
    }
  }

  function currentWindowLease() {
    try {
      const lease = getWindowLease();
      if (isPromiseLike(lease) || !opaqueLease(lease)) return null;
      return lease;
    } catch {
      return null;
    }
  }

  function operationIsCurrent(operation) {
    if (operation.invalidated
      || operation.generation !== windowGeneration
      || (operation.signal && operation.signal.aborted)) return false;
    if (activeByTask.get(operation.key) !== operation) return false;
    if (!bindingAuthorized(operation.binding)) return false;
    const lease = currentWindowLease();
    if (lease !== operation.windowLease) return false;
    return !operation.invalidated
      && operation.generation === windowGeneration
      && activeByTask.get(operation.key) === operation;
  }

  function abortPrepared(operation) {
    if (!operation.prepared || operation.abortAttempted) return;
    operation.abortAttempted = true;
    try { operation.prepared.abort({ reason: operation.reason || 'operation_aborted' }); } catch {}
  }

  function invalidateOperation(operation, reason) {
    if (operation.invalidated) return;
    operation.invalidated = true;
    operation.reason = normalizeReason(reason, 'operation_canceled');
    abortPrepared(operation);
    operation.resolveCancellation(CANCELLED_STEP);
  }

  function cancelAuthorities(binding, reason) {
    let ok = true;
    try {
      const result = nativeEffectApprovalService.cancelJob({ binding, reason });
      if (!dataBoolean(result, 'ok')) ok = false;
    } catch { ok = false; }
    try {
      const result = nativeTaskConsentService.cancelJob({ binding, reason });
      if (!dataBoolean(result, 'ok')) ok = false;
    } catch { ok = false; }
    try {
      const result = taskDelegationStore.revokeBinding(binding, { reason });
      if (!dataBoolean(result, 'ok')) ok = false;
    } catch { ok = false; }
    return ok;
  }

  function cancelOperation(operation, reason) {
    invalidateOperation(operation, reason);
    if (!operation.authoritiesCanceled) {
      operation.authoritiesCanceled = true;
      cancelAuthorities(operation.binding, operation.reason);
    }
  }

  async function awaitStep(value, operation) {
    const settled = Promise.resolve(value).then(
      (resolved) => Object.freeze({ kind: 'value', value: resolved }),
      () => Object.freeze({ kind: 'error', value: null })
    );
    return Promise.race([settled, operation.cancellationPromise]);
  }

  function normalizeExecuteInput(input) {
    assertPlainDataRecord(
      input,
      EXECUTE_KEYS,
      ['binding', 'requestedMode', 'paths', 'projectLabel'],
      'executeDeletePaths input'
    );
    const binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
    const requestedMode = dataValue(input, 'requestedMode');
    if (!Object.values(CAPABILITY_DELEGATION_MODES).includes(requestedMode)) {
      throw new TypeError('requestedMode is unsupported');
    }
    const request = createTransactionalDeletePublicRequest(
      { paths: dataValue(input, 'paths') },
      { pathStyle, caseSensitive }
    );
    const signal = Object.hasOwn(input, 'signal') ? dataValue(input, 'signal') : null;
    if (!isAbortSignal(signal)) throw new TypeError('signal must be an AbortSignal or null');
    const projectLabel = dataValue(input, 'projectLabel');
    if (typeof projectLabel !== 'string') throw new TypeError('projectLabel must be a string');
    return Object.freeze({ binding, requestedMode, request, signal, projectLabel });
  }

  function normalizePlan(prepared, request) {
    if (!prepared || typeof prepared.inspect !== 'function'
      || typeof prepared.verify !== 'function'
      || typeof prepared.commit !== 'function'
      || typeof prepared.abort !== 'function') {
      throw new TypeError('transaction prepare returned an invalid handle');
    }
    const inspected = prepared.inspect();
    if (!isRecord(inspected)) throw new TypeError('transaction inspect returned invalid data');
    const plan = assertTransactionalDeletePlan(dataValue(inspected, 'plan'));
    if (!sameStringArray(plan.request.paths, request.paths)) {
      throw new TypeError('transaction plan changed the exact delete paths');
    }
    if (plan.pathStyle !== pathStyle || plan.caseSensitive !== caseSensitive) {
      throw new TypeError('transaction plan changed trusted filesystem semantics');
    }
    return plan;
  }

  function verificationFrom(raw, binding, plan) {
    assertPlainDataRecord(raw, VERIFICATION_FIELDS, VERIFICATION_FIELDS, 'transaction verification');
    if (dataValue(raw, 'effect') !== CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE) {
      throw new TypeError('transaction verification returned the wrong effect');
    }
    const verifiedBinding = createCapabilityDelegationBinding(dataValue(raw, 'binding'));
    if (!sameBinding(verifiedBinding, binding)) {
      throw new TypeError('transaction verification changed the binding');
    }
    const deleteRequestDigest = normalizeDigest(
      dataValue(raw, 'deleteRequestDigest'),
      'deleteRequestDigest'
    );
    const impactDigest = normalizeDigest(dataValue(raw, 'impactDigest'), 'impactDigest');
    const checkpointDigest = normalizeDigest(
      dataValue(raw, 'checkpointDigest'),
      'checkpointDigest'
    );
    if (deleteRequestDigest !== plan.requestDigest || impactDigest !== plan.impactDigest) {
      throw new TypeError('transaction verification digests do not match the plan');
    }
    for (const field of [
      'checkpointVerified',
      'exactPathsVerified',
      'protectedPathsRejected',
    ]) {
      if (dataValue(raw, field) !== true) throw new TypeError(`${field} must be true`);
    }
    const impact = publicImpact(dataValue(raw, 'impact'));
    const planImpact = publicImpact(plan.impact);
    if (!impact || !planImpact
      || canonicalSha256Digest(impact) !== canonicalSha256Digest(planImpact)) {
      throw new TypeError('transaction verification impact does not match the plan');
    }
    const delegationRequest = createCapabilityDelegationDecisionRequest({
      binding,
      effect: CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE,
      requestDigest: deleteRequestDigest,
      impactDigest,
      checkpointDigest,
      checkpointVerified: true,
      exactPathsVerified: true,
      protectedPathsRejected: true,
      impact,
    }, { requireCheckpoint: true });
    return Object.freeze({
      binding,
      deleteRequestDigest,
      impactDigest,
      checkpointDigest,
      impact,
      delegationRequest,
    });
  }

  function decisionFactsMatch(raw, expected, plan) {
    try {
      assertPlainDataRecord(raw, DECISION_FACT_FIELDS, DECISION_FACT_FIELDS, 'decision facts');
      if (normalizeDigest(dataValue(raw, 'requestDigest'), 'requestDigest')
        !== expected.deleteRequestDigest) return false;
      const selected = {};
      for (const field of VERIFICATION_FIELDS) selected[field] = dataValue(raw, field);
      const actual = verificationFrom(selected, expected.binding, plan);
      return actual.deleteRequestDigest === expected.deleteRequestDigest
        && actual.impactDigest === expected.impactDigest
        && actual.checkpointDigest === expected.checkpointDigest;
    } catch {
      return false;
    }
  }

  function nativeDecisionInput(operation, verification, plan, actorId) {
    return Object.freeze({
      binding: operation.binding,
      requestDigest: verification.deleteRequestDigest,
      impactDigest: verification.impactDigest,
      checkpointDigest: verification.checkpointDigest,
      impact: plan.impact,
      displayPaths: plan.request.paths,
      pathStyle,
      caseSensitive,
      projectLabel: operation.projectLabel,
      actorId,
      windowLease: operation.windowLease,
    });
  }

  function consumeIndividual(operation, verification, plan, input, facts) {
    if (!operationIsCurrent(operation) || !decisionFactsMatch(facts, verification, plan)) {
      return Object.freeze({ authorized: false });
    }
    let consumed;
    try { consumed = nativeEffectApprovalService.consumeDecision(input); } catch { consumed = null; }
    return Object.freeze({
      authorized: Boolean(dataBoolean(consumed, 'ok') && dataBoolean(consumed, 'approved')),
    });
  }

  function consumeDelegated(operation, verification, plan, facts) {
    if (!operationIsCurrent(operation) || !decisionFactsMatch(facts, verification, plan)) {
      return Object.freeze({ authorized: false });
    }
    let consumed;
    try { consumed = taskDelegationStore.consumeDecision(verification.delegationRequest); } catch {
      consumed = null;
    }
    return Object.freeze({
      authorized: Boolean(dataBoolean(consumed, 'ok') && dataBoolean(consumed, 'authorized')),
    });
  }

  function createRouting(operation, verification, plan, requestId) {
    const routingAttestation = Object.freeze(Object.create(null));
    const approvalReviewer = Object.freeze({
      verifyDecision(input) {
        const proof = isRecord(input) ? dataValue(input, 'proof') : null;
        const decision = isRecord(input) ? dataValue(input, 'decision') : null;
        const verified = proof === routingAttestation && decision === 'allow';
        return Object.freeze({ verified, decision: verified ? 'allow' : 'deny' });
      },
    });
    const adapter = Object.freeze({
      execute() {
        operation.adapterEntries += 1;
        if (operation.adapterEntries !== 1
          || typeof operation.consumeDecision !== 'function'
          || !operationIsCurrent(operation)) {
          invalidateOperation(operation, 'routing_invalid');
          return Object.freeze({
            ok: false,
            status: 'denied',
            state: TRANSACTIONAL_DELETE_STATES.PURGED,
            impact: verification.impact,
            errorCode: AGENTIC_DELETE_ERROR_CODES.ROUTING_INVALID,
          });
        }
        // The transactional service owns the destructive frontier. commit()
        // invokes consumeDecision synchronously and performs its first rename
        // before returning or yielding to this orchestrator.
        const outcome = operation.prepared.commit({
          decisionRequestDigest: verification.deleteRequestDigest,
          consumeDecision: operation.consumeDecision,
        });
        operation.effectOutcome = outcome;
        return outcome;
      },
    });
    const broker = createBroker(Object.freeze({
      binding: operation.binding,
      capability: 'filesystem',
      action: 'delete_paths',
      effects: Object.freeze([
        PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE,
        PROJECT_CAPABILITY_EFFECTS.DESTRUCTIVE,
      ]),
      requiresApproval: true,
      adapter,
      approvalReviewer,
    }));
    if (!broker || typeof broker.execute !== 'function'
      || typeof broker.approveAndExecute !== 'function') {
      throw new TypeError('createBroker returned an invalid broker');
    }
    const request = createProjectCapabilityRequest({
      requestId,
      principal: { kind: 'agent', kernelId: operation.binding.kernelId },
      projectSession: {
        sessionId: operation.binding.sessionId,
        projectId: operation.binding.projectId,
        rootPath: operation.binding.canonicalRootPath,
        realRootPath: operation.binding.realRootPath,
        jobId: operation.binding.jobId,
      },
      capability: 'filesystem',
      action: 'delete_paths',
      payload: Object.freeze({
        deleteRequestDigest: verification.deleteRequestDigest,
        impactDigest: verification.impactDigest,
        checkpointDigest: verification.checkpointDigest,
        planDigest: plan.planDigest,
      }),
      context: {
        origin: 'agentic_tool_loop',
        correlationId: operation.binding.jobId,
      },
    });
    return Object.freeze({ broker, request, routingAttestation });
  }

  function approvalIdFrom(result) {
    if (!isRecord(result) || dataValue(result, 'status') !== 'approval_required') return null;
    const approval = dataValue(result, 'approval');
    if (!isRecord(approval)) return null;
    const approvalId = dataValue(approval, 'approvalId');
    return typeof approvalId === 'string' && SAFE_IDENTIFIER.test(approvalId)
      ? approvalId
      : null;
  }

  async function requestIndividualAuthority(operation, verification, plan, actorId) {
    const input = nativeDecisionInput(operation, verification, plan, actorId);
    let requested;
    try { requested = nativeEffectApprovalService.requestDecision(input); } catch { requested = null; }
    const step = await awaitStep(requested, operation);
    if (step.kind !== 'value' || !operationIsCurrent(operation)) return false;
    if (!dataBoolean(step.value, 'ok') || !dataBoolean(step.value, 'approved')) return false;
    operation.mode = CAPABILITY_DELEGATION_MODES.ASK_EACH;
    operation.authorityKind = 'individual';
    operation.consumeDecision = (facts) => consumeIndividual(
      operation,
      verification,
      plan,
      input,
      facts
    );
    return true;
  }

  async function requestDelegatedAuthority(operation, verification, plan, actorId) {
    let ensured;
    try {
      ensured = nativeTaskConsentService.ensureTaskDelegation({
        binding: operation.binding,
        actorId,
        windowLease: operation.windowLease,
        projectLabel: operation.projectLabel,
      });
    } catch {
      ensured = null;
    }
    const step = await awaitStep(ensured, operation);
    if (step.kind !== 'value' || !operationIsCurrent(operation)) return false;
    const delegated = dataBoolean(step.value, 'ok')
      && dataBoolean(step.value, 'delegated')
      && dataValue(step.value, 'mode') === CAPABILITY_DELEGATION_MODES.DELEGATE_TASK;
    if (delegated) {
      let inspected;
      try { inspected = taskDelegationStore.inspectDecision(verification.delegationRequest); } catch {
        inspected = null;
      }
      if (dataBoolean(inspected, 'ok') && dataBoolean(inspected, 'authorized')
        && operationIsCurrent(operation)) {
        operation.mode = CAPABILITY_DELEGATION_MODES.DELEGATE_TASK;
        operation.authorityKind = 'delegated';
        operation.consumeDecision = (facts) => consumeDelegated(
          operation,
          verification,
          plan,
          facts
        );
        return true;
      }
    }
    // Delegation absence, expiry, or an explicit "ask each" choice does not
    // weaken policy. It falls back to an individual native decision only while
    // the exact task/window/root context remains current.
    if (!operationIsCurrent(operation)) return false;
    return requestIndividualAuthority(operation, verification, plan, actorId);
  }

  function sanitizeTransactionalOutcome(raw, mode) {
    try {
      if (!isRecord(raw)) throw new TypeError('missing transactional outcome');
      const status = dataValue(raw, 'status');
      const state = dataValue(raw, 'state');
      const impact = publicImpact(dataValue(raw, 'impact'));
      const errorCode = dataValue(raw, 'errorCode');
      if (!impact) throw new TypeError('invalid transactional impact');
      const validated = createTransactionalDeletePublicResult({
        status,
        state,
        impact,
        errorCode,
      });
      return publicResult({
        status: validated.status,
        mode,
        state: validated.state,
        impact: validated.impact,
        errorCode: validated.errorCode,
      });
    } catch {
      return failed(mode, AGENTIC_DELETE_ERROR_CODES.ROUTING_INVALID);
    }
  }

  async function executeDeletePaths(input = {}) {
    let normalized;
    try { normalized = normalizeExecuteInput(input); } catch {
      deniedOperations += 1;
      return denied(CAPABILITY_DELEGATION_MODES.ASK_EACH, AGENTIC_DELETE_ERROR_CODES.INVALID_REQUEST);
    }
    const key = bindingKey(normalized.binding);
    if (activeByTask.has(key)) {
      deniedOperations += 1;
      return denied(normalized.requestedMode, AGENTIC_DELETE_ERROR_CODES.OPERATION_BUSY);
    }
    if (normalized.signal && normalized.signal.aborted) {
      deniedOperations += 1;
      return denied(normalized.requestedMode, AGENTIC_DELETE_ERROR_CODES.OPERATION_CANCELED);
    }
    const lease = currentWindowLease();
    if (!lease || !bindingAuthorized(normalized.binding)) {
      deniedOperations += 1;
      return denied(normalized.requestedMode, AGENTIC_DELETE_ERROR_CODES.CONTEXT_INVALID);
    }
    let resolveCancellation;
    const cancellationPromise = new Promise((resolve) => { resolveCancellation = resolve; });
    const operation = {
      key,
      binding: normalized.binding,
      requestedMode: normalized.requestedMode,
      mode: normalized.requestedMode,
      request: normalized.request,
      signal: normalized.signal,
      projectLabel: normalized.projectLabel,
      windowLease: lease,
      generation: windowGeneration,
      invalidated: false,
      reason: '',
      prepared: null,
      abortAttempted: false,
      authoritiesCanceled: false,
      authorityKind: null,
      consumeDecision: null,
      adapterEntries: 0,
      effectOutcome: null,
      cancellationPromise,
      resolveCancellation,
      onAbort: null,
    };
    activeByTask.set(key, operation);
    if (operation.signal) {
      operation.onAbort = () => cancelOperation(operation, 'operation_canceled');
      try {
        operation.signal.addEventListener('abort', operation.onAbort, { once: true });
        if (operation.signal.aborted) operation.onAbort();
      } catch {
        invalidateOperation(operation, 'operation_canceled');
      }
    }

    let finalResult = null;
    let completed = false;
    const finish = (result) => {
      finalResult = result;
      return result;
    };
    try {
      if (!operationIsCurrent(operation)) {
        return finish(denied(operation.mode, AGENTIC_DELETE_ERROR_CODES.OPERATION_CANCELED));
      }
      operation.prepared = transactionalDeleteService.prepare({
        binding: operation.binding,
        paths: operation.request.paths,
        pathStyle,
        caseSensitive,
      });
      const plan = normalizePlan(operation.prepared, operation.request);
      const verification = verificationFrom(
        operation.prepared.verify(),
        operation.binding,
        plan
      );
      if (!operationIsCurrent(operation)) {
        return finish(denied(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.CONTEXT_INVALID,
          plan.impact
        ));
      }

      const actorId = normalizeActorId(getActorId(operation.binding));
      const requestId = normalizeRequestId(requestIdFactory(operation.binding));
      if (!operationIsCurrent(operation)) {
        return finish(denied(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.CONTEXT_INVALID,
          plan.impact
        ));
      }
      const routing = createRouting(operation, verification, plan, requestId);
      const initialStep = await awaitStep(routing.broker.execute(routing.request), operation);
      if (initialStep.kind === 'canceled') {
        return finish(denied(
          operation.mode,
          operation.adapterEntries > 0
            ? AGENTIC_DELETE_ERROR_CODES.BROKER_FRESH_APPROVAL_REQUIRED
            : AGENTIC_DELETE_ERROR_CODES.OPERATION_CANCELED,
          plan.impact
        ));
      }
      if (initialStep.kind !== 'value') {
        return finish(failed(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.BROKER_FAILED,
          plan.impact
        ));
      }
      const approvalId = approvalIdFrom(initialStep.value);
      if (!approvalId || operation.adapterEntries !== 0) {
        return finish(denied(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.BROKER_FRESH_APPROVAL_REQUIRED,
          plan.impact
        ));
      }

      const authorityReady = operation.requestedMode === CAPABILITY_DELEGATION_MODES.DELEGATE_TASK
        ? await requestDelegatedAuthority(operation, verification, plan, actorId)
        : await requestIndividualAuthority(operation, verification, plan, actorId);
      if (!authorityReady) {
        return finish(denied(
          operation.mode,
          operation.invalidated
            ? AGENTIC_DELETE_ERROR_CODES.OPERATION_CANCELED
            : AGENTIC_DELETE_ERROR_CODES.APPROVAL_DENIED,
          plan.impact
        ));
      }
      if (!operationIsCurrent(operation)) {
        return finish(denied(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.CONTEXT_INVALID,
          plan.impact
        ));
      }

      const approvedStep = await awaitStep(routing.broker.approveAndExecute(routing.request, {
        approvalId,
        decision: 'allow',
        proof: routing.routingAttestation,
      }), operation);
      if (approvedStep.kind === 'canceled') {
        return finish(denied(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.OPERATION_CANCELED,
          plan.impact
        ));
      }
      if (approvedStep.kind !== 'value') {
        return finish(failed(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.BROKER_FAILED,
          plan.impact
        ));
      }
      if (!operationIsCurrent(operation)) {
        return finish(denied(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.OPERATION_CANCELED,
          plan.impact
        ));
      }
      if (dataValue(approvedStep.value, 'status') !== 'completed'
        || operation.adapterEntries !== 1
        || !operation.effectOutcome) {
        return finish(denied(
          operation.mode,
          AGENTIC_DELETE_ERROR_CODES.BROKER_DENIED,
          plan.impact
        ));
      }
      finalResult = sanitizeTransactionalOutcome(operation.effectOutcome, operation.mode);
      completed = finalResult.status === TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.COMPLETED;
      return finalResult;
    } catch {
      return finish(failed(
        operation.mode,
        operation.prepared
          ? AGENTIC_DELETE_ERROR_CODES.OPERATION_FAILED
          : AGENTIC_DELETE_ERROR_CODES.INVALID_REQUEST
      ));
    } finally {
      if (!completed) {
        abortPrepared(operation);
        if (operation.authorityKind === 'individual' && !operation.authoritiesCanceled) {
          operation.authoritiesCanceled = true;
          try {
            nativeEffectApprovalService.cancelJob({
              binding: operation.binding,
              reason: 'operation_not_completed',
            });
          } catch {}
        }
      }
      if (operation.signal && operation.onAbort) {
        try { operation.signal.removeEventListener('abort', operation.onAbort); } catch {}
      }
      if (activeByTask.get(key) === operation) activeByTask.delete(key);
      if (completed) completedOperations += 1;
      else if (finalResult && finalResult.status === 'failed') failedOperations += 1;
      else deniedOperations += 1;
    }
  }

  function maintenanceCounts(raw, fields) {
    const result = { ok: dataBoolean(raw, 'ok') };
    for (const field of fields) {
      const value = isRecord(raw) ? dataValue(raw, field) : null;
      result[field] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    }
    return Object.freeze(result);
  }

  function invalidateBindingOperations(binding, reason) {
    let invalidated = 0;
    const key = bindingKey(binding);
    const operation = activeByTask.get(key);
    if (operation && sameBinding(operation.binding, binding)) {
      cancelOperation(operation, reason);
      invalidated += 1;
    }
    return invalidated;
  }

  function onJobTerminal(input = {}) {
    let binding;
    let status;
    try {
      assertPlainDataRecord(input, TERMINAL_KEYS, TERMINAL_KEYS, 'onJobTerminal input');
      binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
      status = dataValue(input, 'status');
      if (!TERMINAL_OUTCOMES.has(status)) throw new TypeError('unsupported terminal status');
    } catch {
      return Object.freeze({ ok: false, invalidated: 0, purged: 0, rolledBack: 0, recoveryRequired: 0 });
    }
    const invalidated = invalidateBindingOperations(binding, 'job_terminal');
    const authorityOk = cancelAuthorities(binding, 'job_terminal');
    let terminal;
    try { terminal = transactionalDeleteService.finalizeJob({ binding, outcome: status }); } catch {
      terminal = null;
    }
    const counts = maintenanceCounts(terminal, ['purged', 'rolledBack', 'recoveryRequired']);
    return Object.freeze({ ...counts, ok: counts.ok && authorityOk, invalidated });
  }

  function revokeJob(input = {}) {
    let binding;
    let reason;
    try {
      assertPlainDataRecord(input, REVOKE_KEYS, ['binding'], 'revokeJob input');
      binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
      reason = normalizeReason(
        Object.hasOwn(input, 'reason') ? dataValue(input, 'reason') : null,
        'job_revoked'
      );
    } catch {
      return Object.freeze({ ok: false, invalidated: 0, rolledBack: 0, recoveryRequired: 0 });
    }
    const invalidated = invalidateBindingOperations(binding, reason);
    const authorityOk = cancelAuthorities(binding, reason);
    let rolledBack;
    try { rolledBack = transactionalDeleteService.rollbackJob({ binding, reason }); } catch {
      rolledBack = null;
    }
    const counts = maintenanceCounts(rolledBack, ['rolledBack', 'recoveryRequired']);
    return Object.freeze({ ...counts, ok: counts.ok && authorityOk, invalidated });
  }

  function invalidateWindow(reasonInput) {
    const reason = normalizeReason(reasonInput, 'window_invalidated');
    windowGeneration += 1;
    const bindings = new Map();
    let invalidated = 0;
    for (const operation of activeByTask.values()) {
      bindings.set(operation.key, operation.binding);
      cancelOperation(operation, reason);
      invalidated += 1;
    }
    let ok = true;
    try {
      const result = nativeEffectApprovalService.invalidateWindow(reason);
      if (!dataBoolean(result, 'ok')) ok = false;
    } catch { ok = false; }
    try {
      const result = nativeTaskConsentService.invalidateWindow(reason);
      if (!dataBoolean(result, 'ok')) ok = false;
    } catch { ok = false; }
    let rolledBack = 0;
    let recoveryRequired = 0;
    for (const binding of bindings.values()) {
      try {
        const revoked = taskDelegationStore.revokeBinding(binding, { reason });
        if (!dataBoolean(revoked, 'ok')) ok = false;
      } catch { ok = false; }
      try {
        const result = transactionalDeleteService.rollbackJob({ binding, reason });
        const counts = maintenanceCounts(result, ['rolledBack', 'recoveryRequired']);
        if (!counts.ok) ok = false;
        rolledBack += counts.rolledBack;
        recoveryRequired += counts.recoveryRequired;
      } catch {
        ok = false;
        recoveryRequired += 1;
      }
    }
    return Object.freeze({ ok, invalidated, rolledBack, recoveryRequired });
  }

  function recoverProject(input = {}) {
    let binding;
    try {
      assertPlainDataRecord(input, RECOVER_KEYS, RECOVER_KEYS, 'recoverProject input');
      binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
      if (!bindingAuthorized(binding)) throw new TypeError('recovery context is invalid');
    } catch {
      return Object.freeze({
        ok: false,
        recovered: 0,
        retainedCommitted: 0,
        retainedUnknown: 0,
      });
    }
    let recovered;
    try { recovered = transactionalDeleteService.recoverProject({ binding }); } catch {
      recovered = null;
    }
    return maintenanceCounts(
      recovered,
      ['recovered', 'retainedCommitted', 'retainedUnknown']
    );
  }

  function diagnostics() {
    let transactional = null;
    try { transactional = transactionalDeleteService.diagnostics(); } catch { transactional = null; }
    const prepared = isRecord(transactional) ? dataValue(transactional, 'prepared') : 0;
    const committed = isRecord(transactional) ? dataValue(transactional, 'committed') : 0;
    const recoveryRequired = isRecord(transactional)
      ? dataValue(transactional, 'recoveryRequired')
      : 0;
    return Object.freeze({
      version: AGENTIC_DELETE_ORCHESTRATOR_VERSION,
      activeOperations: activeByTask.size,
      completedOperations,
      deniedOperations,
      failedOperations,
      windowGeneration,
      preparedTransactions: Number.isSafeInteger(prepared) && prepared >= 0 ? prepared : 0,
      committedTransactions: Number.isSafeInteger(committed) && committed >= 0 ? committed : 0,
      recoveryRequiredTransactions:
        Number.isSafeInteger(recoveryRequired) && recoveryRequired >= 0 ? recoveryRequired : 0,
      defaultMode: CAPABILITY_DELEGATION_MODES.ASK_EACH,
      retention: 'until_job_terminal',
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({
    executeDeletePaths,
    onJobTerminal,
    revokeJob,
    invalidateWindow,
    recoverProject,
    diagnostics,
  });
}

class AgenticDeleteOrchestrator {
  constructor(options = {}) {
    Object.assign(this, createAgenticDeleteOrchestrator(options));
    Object.freeze(this);
  }
}

module.exports = {
  AGENTIC_DELETE_ERROR_CODES,
  AGENTIC_DELETE_ORCHESTRATOR_VERSION,
  AGENTIC_DELETE_RESULT_VERSION,
  AgenticDeleteOrchestrator,
  createAgenticDeleteOrchestrator,
};
