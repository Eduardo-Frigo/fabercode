'use strict';

const {
  CAPABILITY_DELEGATION_EFFECTS,
  CAPABILITY_DELEGATION_MODES,
  DEFAULT_DELEGATION_CONSTRAINTS,
  DEFAULT_DELEGATION_TTL_MS,
  createCapabilityDelegationBinding,
  createCapabilityDelegationConstraints,
  createCapabilityDelegationPrincipal,
  immutableSnapshot,
} = require('../capabilities/capability_delegation_contracts');

const NATIVE_TASK_CONSENT_SERVICE_VERSION = 'native-task-consent-service.v1';
const DEFAULT_MAX_PENDING_DIALOGS = 64;
const DEFAULT_MAX_ACTIVE_DELEGATIONS = 1_024;
const HARD_MAX_CONSENT_RECORDS = 10_000;

const NATIVE_TASK_CONSENT_REASONS = Object.freeze({
  ASK_EACH_SELECTED: 'ask_each_selected',
  BUSY: 'native_consent_busy',
  CLEARED: 'native_consent_cleared',
  DELEGATION_ISSUED: 'delegation_issued',
  DELEGATION_NOT_ISSUED: 'delegation_not_issued',
  DIALOG_FAILED: 'native_dialog_failed',
  INVALID_INPUT: 'native_consent_invalid_input',
  JOB_CANCELED: 'native_consent_job_canceled',
  LIFECYCLE_INVALIDATED: 'native_consent_lifecycle_invalidated',
  WINDOW_INVALIDATED: 'native_consent_window_invalidated',
});

const OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'trustedConsentAuthority',
  'taskDelegationStore',
  'authorizeLifecycle',
  'getWindowLease',
  'maxPendingDialogs',
  'maxActiveDelegations',
  'now',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'trustedConsentAuthority',
  'taskDelegationStore',
  'authorizeLifecycle',
  'getWindowLease',
]);
const ENSURE_KEYS = Object.freeze(['binding', 'actorId', 'windowLease', 'projectLabel']);
const CANCEL_KEYS = Object.freeze(['binding', 'reason']);
const BINDING_FIELDS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const SAFE_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/;
const DIALOG_ALLOW_RESPONSE = 1;

const FIXED_DIALOG = Object.freeze({
  type: 'question',
  title: 'Delegar decisões à IA nesta tarefa?',
  message: 'Permitir que a IA decida sobre exclusões de arquivos nesta tarefa?',
  buttons: Object.freeze(['Perguntar antes', 'IA decide nesta tarefa']),
  defaultId: 0,
  cancelId: 0,
  noLink: true,
});

function isPlainDataRecord(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) return false;
  if (requiredKeys.some((key) => !keys.includes(key))) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return false;
    }
    if (descriptor.value === undefined) return false;
  }
  return true;
}

function isOpaqueLease(value) {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function');
}

function normalizeReason(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return SAFE_REASON_PATTERN.test(normalized) ? normalized : fallback;
}

function normalizeBound(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > HARD_MAX_CONSENT_RECORDS) {
    throw new TypeError(`${fieldName} must be a positive safe integer at most ${HARD_MAX_CONSENT_RECORDS}`);
  }
  return value;
}

function normalizeProjectLabel(value) {
  if (value === undefined) return 'projeto atual';
  if (typeof value !== 'string') throw new TypeError('projectLabel must be a string');
  const normalized = value
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return normalized || 'projeto atual';
}

function bindingsMatch(left, right) {
  return BINDING_FIELDS.every((field) => left[field] === right[field]);
}

function taskIdentity(binding) {
  return [binding.projectId, binding.sessionId, binding.jobId, binding.kernelId].join('\u001f');
}

function askEach(reason, ok = true) {
  return Object.freeze({
    ok,
    mode: CAPABILITY_DELEGATION_MODES.ASK_EACH,
    delegated: false,
    reason,
  });
}

function delegated() {
  return Object.freeze({
    ok: true,
    mode: CAPABILITY_DELEGATION_MODES.DELEGATE_TASK,
    delegated: true,
    reason: NATIVE_TASK_CONSENT_REASONS.DELEGATION_ISSUED,
  });
}

function createDialogPayload(projectLabel) {
  return Object.freeze({
    ...FIXED_DIALOG,
    detail: `Projeto: ${projectLabel}\nA autorização vale somente para esta tarefa, exige checkpoint e mantém os limites de segurança para exclusões.`,
  });
}

function nativeDialogAllowed(value) {
  if (!isPlainDataRecord(value, ['response', 'checkboxChecked'], ['response'])) return false;
  const response = Object.getOwnPropertyDescriptor(value, 'response').value;
  if (Object.hasOwn(value, 'checkboxChecked')
    && typeof Object.getOwnPropertyDescriptor(value, 'checkboxChecked').value !== 'boolean') return false;
  return Number.isSafeInteger(response) && response === DIALOG_ALLOW_RESPONSE;
}

function awaitDialogOrAbort(dialogPromise, signal) {
  if (signal.aborted) return Promise.resolve(Object.freeze({ aborted: true, value: null }));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish(Object.freeze({ aborted: true, value: null }));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(dialogPromise).then(
      (value) => finish(Object.freeze({ aborted: false, value })),
      (error) => finish(Object.freeze({ aborted: false, error, value: null }))
    );
  });
}

function createNativeTaskConsentService(options = {}) {
  if (!isPlainDataRecord(options, OPTION_KEYS, REQUIRED_OPTION_KEYS)) {
    throw new TypeError('Native task consent options must be a plain data record');
  }
  const {
    showNativeDialog,
    trustedConsentAuthority,
    taskDelegationStore,
    authorizeLifecycle,
    getWindowLease,
    maxPendingDialogs = DEFAULT_MAX_PENDING_DIALOGS,
    maxActiveDelegations = DEFAULT_MAX_ACTIVE_DELEGATIONS,
    now = () => Date.now(),
  } = options;
  if (typeof showNativeDialog !== 'function') throw new TypeError('showNativeDialog must be a function');
  if (typeof authorizeLifecycle !== 'function') throw new TypeError('authorizeLifecycle must be a function');
  if (typeof getWindowLease !== 'function') throw new TypeError('getWindowLease must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!trustedConsentAuthority
    || typeof trustedConsentAuthority.issueFromNativeConfirmation !== 'function'
    || typeof trustedConsentAuthority.cancel !== 'function'
    || typeof trustedConsentAuthority.cancelWhere !== 'function'
    || typeof trustedConsentAuthority.clear !== 'function') {
    throw new TypeError('trustedConsentAuthority must provide issue, cancel, cancelWhere and clear');
  }
  if (!taskDelegationStore
    || typeof taskDelegationStore.issueFromTrustedConsent !== 'function'
    || typeof taskDelegationStore.get !== 'function'
    || typeof taskDelegationStore.revokeBinding !== 'function'
    || typeof taskDelegationStore.clear !== 'function') {
    throw new TypeError('taskDelegationStore must provide issue, get, revokeBinding and clear');
  }
  normalizeBound(maxPendingDialogs, 'maxPendingDialogs');
  normalizeBound(maxActiveDelegations, 'maxActiveDelegations');

  const pendingByKey = new Map();
  const activeByKey = new Map();
  const reservedActiveKeys = new Set();
  const leaseIds = new WeakMap();
  const invalidatedLeases = new WeakSet();
  let nextLeaseId = 1;
  let invalidatedLeaseCount = 0;
  let generation = 0;
  let authorityHealthy = true;
  let lastObservedAt = -1;

  function readNow() {
    let value;
    try {
      const raw = now();
      value = raw instanceof Date ? raw.getTime() : raw;
    } catch {
      markAuthorityUnhealthy();
      return null;
    }
    if (!Number.isSafeInteger(value)
      || value < 0
      || Object.is(value, -0)
      || value < lastObservedAt) {
      markAuthorityUnhealthy();
      return null;
    }
    lastObservedAt = value;
    return value;
  }

  function leaseId(lease) {
    let id = leaseIds.get(lease);
    if (!id) {
      id = nextLeaseId;
      nextLeaseId += 1;
      leaseIds.set(lease, id);
    }
    return id;
  }

  function operationKey(binding, lease) {
    return `${leaseId(lease)}\u001e${taskIdentity(binding)}`;
  }

  function leaseIsCurrent(operation) {
    if (operation.invalidated
      || generation !== operation.generation
      || invalidatedLeases.has(operation.windowLease)
      || pendingByKey.get(operation.key) !== operation) return false;
    let currentLease;
    try {
      currentLease = getWindowLease();
    } catch {
      return false;
    }
    return !(currentLease && typeof currentLease.then === 'function')
      && currentLease === operation.windowLease
      && !operation.invalidated
      && generation === operation.generation
      && pendingByKey.get(operation.key) === operation;
  }

  function windowLeaseIsCurrent(windowLease) {
    if (!authorityHealthy || invalidatedLeases.has(windowLease)) return false;
    let currentLease;
    try {
      currentLease = getWindowLease();
    } catch {
      return false;
    }
    return !(currentLease && typeof currentLease.then === 'function')
      && currentLease === windowLease
      && !invalidatedLeases.has(windowLease)
      && authorityHealthy;
  }

  function bindingLifecycleIsAuthorized(binding, windowLease, operation = null) {
    const frontierIsCurrent = () => operation
      ? leaseIsCurrent(operation)
      : windowLeaseIsCurrent(windowLease);
    if (!frontierIsCurrent()) return false;
    let authorization;
    try {
      authorization = authorizeLifecycle(binding);
      if (authorization && typeof authorization.then === 'function') return false;
      authorization = immutableSnapshot(authorization);
    } catch {
      return false;
    }
    if (!frontierIsCurrent()
      || !authorization
      || authorization.authorized !== true
      || !Object.hasOwn(authorization, 'binding')) return false;
    let authorizedBinding;
    try {
      authorizedBinding = createCapabilityDelegationBinding(authorization.binding);
    } catch {
      return false;
    }
    return bindingsMatch(authorizedBinding, binding) && frontierIsCurrent();
  }

  function lifecycleIsCurrent(operation) {
    return bindingLifecycleIsAuthorized(
      operation.binding,
      operation.windowLease,
      operation
    );
  }

  function markAuthorityUnhealthy() {
    authorityHealthy = false;
    for (const operation of pendingByKey.values()) {
      operation.invalidated = true;
      operation.reason = NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED;
      if (!operation.abortController.signal.aborted) operation.abortController.abort();
    }
  }

  function invokeMutation(target, methodName, args = []) {
    let safeResult;
    try {
      const result = target[methodName].apply(target, args);
      if (result && typeof result.then === 'function') throw new TypeError('async mutation is not allowed');
      safeResult = immutableSnapshot(result);
      if (!safeResult || safeResult.ok !== true) throw new TypeError('mutation was not confirmed');
      return Object.freeze({ ok: true, result: safeResult });
    } catch {
      markAuthorityUnhealthy();
      return Object.freeze({ ok: false, result: null });
    }
  }

  function cancelTrustedBinding(binding) {
    return invokeMutation(trustedConsentAuthority, 'cancelWhere', [Object.freeze({
        projectId: binding.projectId,
        sessionId: binding.sessionId,
        jobId: binding.jobId,
        kernelId: binding.kernelId,
      })]).ok;
  }

  function cancelIssuedHandle(consentHandle) {
    try {
      const result = trustedConsentAuthority.cancel(consentHandle);
      if (result && typeof result.then === 'function') throw new TypeError('async mutation is not allowed');
      const safeResult = immutableSnapshot(result);
      if (safeResult && safeResult.ok === true && safeResult.canceled === true) return true;
      // The store consumes successful handles before this finalizer. An exact
      // authority not-found response is therefore a valid proof of absence.
      if (safeResult
        && safeResult.ok === false
        && safeResult.canceled === false
        && safeResult.reason === 'trusted_consent_not_found') return true;
    } catch {
      // Binding-wide cancellation below remains the final absence proof.
    }
    return false;
  }

  function revokeDelegation(binding, reason) {
    return invokeMutation(taskDelegationStore, 'revokeBinding', [
      binding,
      Object.freeze({ reason }),
    ]).ok;
  }

  function invalidateOperation(operation, reason) {
    operation.invalidated = true;
    operation.reason = reason;
    if (!operation.abortController.signal.aborted) operation.abortController.abort();
  }

  function normalizeIssuedDelegation(result, expectedBinding, expectedActorId) {
    const safeResult = immutableSnapshot(result);
    if (!safeResult || safeResult.ok !== true || safeResult.issued !== true
      || !safeResult.delegation || typeof safeResult.delegation !== 'object') return null;
    const record = safeResult.delegation;
    const normalizedBinding = createCapabilityDelegationBinding(record.binding);
    const principal = createCapabilityDelegationPrincipal(record.principal);
    const constraints = createCapabilityDelegationConstraints(record.constraints);
    if (!bindingsMatch(normalizedBinding, expectedBinding)
      || principal.actorId !== expectedActorId
      || record.mode !== CAPABILITY_DELEGATION_MODES.DELEGATE_TASK
      || record.status !== 'active'
      || !Array.isArray(record.allowedEffects)
      || record.allowedEffects.length !== 1
      || record.allowedEffects[0] !== CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE
      || JSON.stringify(constraints) !== JSON.stringify(DEFAULT_DELEGATION_CONSTRAINTS)
      || typeof record.delegationId !== 'string'
      || !record.delegationId.trim()
      || !Number.isSafeInteger(record.issuedAt)
      || !Number.isSafeInteger(record.expiresAt)
      || record.expiresAt <= record.issuedAt
      || record.expiresAt - record.issuedAt !== DEFAULT_DELEGATION_TTL_MS) return null;
    return Object.freeze({
      delegationId: record.delegationId,
      expiresAt: record.expiresAt,
    });
  }

  function purgeExpiredActive() {
    if (!activeByKey.size) return true;
    const checkedAt = readNow();
    if (checkedAt === null) return false;
    for (const [key, active] of activeByKey) {
      if (checkedAt >= active.expiresAt) activeByKey.delete(key);
    }
    return authorityHealthy;
  }

  function validateActiveDelegation(key, active, binding, actorId, windowLease) {
    const activeIsCurrent = () => authorityHealthy && activeByKey.get(key) === active;
    if (!activeIsCurrent()
      || !bindingsMatch(active.binding, binding)
      || active.actorId !== actorId
      || active.windowLease !== windowLease
      || !bindingLifecycleIsAuthorized(binding, windowLease)) return false;
    if (!activeIsCurrent()) return false;
    let snapshot;
    try {
      const result = taskDelegationStore.get(active.delegationId);
      if (result && typeof result.then === 'function') return false;
      snapshot = immutableSnapshot(result);
    } catch {
      markAuthorityUnhealthy();
      return false;
    }
    if (!activeIsCurrent() || !bindingLifecycleIsAuthorized(binding, windowLease)) return false;
    let normalized;
    try {
      normalized = normalizeIssuedDelegation(
        { ok: true, issued: true, delegation: snapshot },
        binding,
        actorId
      );
    } catch {
      return false;
    }
    return Boolean(activeIsCurrent()
      && normalized
      && normalized.delegationId === active.delegationId
      && normalized.expiresAt === active.expiresAt
      && bindingLifecycleIsAuthorized(binding, windowLease)
      && activeIsCurrent());
  }

  async function runEnsure(operation, projectLabel) {
    let consentHandle = '';
    try {
      if (!lifecycleIsCurrent(operation)) {
        return askEach(NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED, false);
      }

      let dialogResult;
      try {
        const dialogAttempt = await awaitDialogOrAbort(showNativeDialog(
          createDialogPayload(projectLabel),
          Object.freeze({ signal: operation.abortController.signal })
        ), operation.abortController.signal);
        if (dialogAttempt.aborted) {
          return askEach(
            operation.reason || NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED,
            false
          );
        }
        if (dialogAttempt.error) throw dialogAttempt.error;
        dialogResult = dialogAttempt.value;
      } catch {
        if (!lifecycleIsCurrent(operation)) {
          return askEach(operation.reason || NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED, false);
        }
        return askEach(NATIVE_TASK_CONSENT_REASONS.DIALOG_FAILED);
      }

      // The native result is not authority by itself. Window ownership and the
      // exact persisted job lifecycle are revalidated after the await.
      if (!lifecycleIsCurrent(operation)) {
        return askEach(operation.reason || NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED, false);
      }
      let safeDialogResult;
      try {
        safeDialogResult = immutableSnapshot(dialogResult);
      } catch {
        safeDialogResult = null;
      }
      // Snapshotting a hostile return value is itself a reentrancy frontier.
      if (!lifecycleIsCurrent(operation)) {
        return askEach(operation.reason || NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED, false);
      }
      if (!nativeDialogAllowed(safeDialogResult)) {
        return askEach(NATIVE_TASK_CONSENT_REASONS.ASK_EACH_SELECTED);
      }
      if (activeByKey.size >= maxActiveDelegations && !activeByKey.has(operation.key)) {
        return askEach(NATIVE_TASK_CONSENT_REASONS.BUSY, false);
      }
      if (!activeByKey.has(operation.key)) {
        if (activeByKey.size + reservedActiveKeys.size >= maxActiveDelegations) {
          return askEach(NATIVE_TASK_CONSENT_REASONS.BUSY, false);
        }
        reservedActiveKeys.add(operation.key);
      }

      const consent = Object.freeze({
        mode: CAPABILITY_DELEGATION_MODES.DELEGATE_TASK,
        principal: createCapabilityDelegationPrincipal({
          kind: 'user_ui',
          actorId: operation.actorId,
        }),
        binding: operation.binding,
        allowedEffects: Object.freeze([CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE]),
        constraints: DEFAULT_DELEGATION_CONSTRAINTS,
        ttlMs: DEFAULT_DELEGATION_TTL_MS,
      });
      let issued;
      try {
        issued = immutableSnapshot(
          trustedConsentAuthority.issueFromNativeConfirmation(consent)
        );
      } catch {
        const cleaned = cancelTrustedBinding(operation.binding);
        if (!cleaned) markAuthorityUnhealthy();
        return askEach(NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED, false);
      }
      if (!lifecycleIsCurrent(operation)
        || !issued
        || issued.ok !== true
        || issued.issued !== true
        || typeof issued.consentHandle !== 'string'
        || !issued.consentHandle) {
        if (issued && typeof issued.consentHandle === 'string') consentHandle = issued.consentHandle;
        const cleaned = cancelTrustedBinding(operation.binding);
        if (!cleaned) markAuthorityUnhealthy();
        return askEach(operation.reason || NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED, false);
      }
      consentHandle = issued.consentHandle;

      let delegationResult;
      try {
        delegationResult = await taskDelegationStore.issueFromTrustedConsent({ consentHandle });
      } catch {
        revokeDelegation(operation.binding, NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED);
        return askEach(NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED, false);
      }
      if (!lifecycleIsCurrent(operation)) {
        revokeDelegation(
          operation.binding,
          operation.reason || NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED
        );
        return askEach(operation.reason || NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED, false);
      }
      let normalizedDelegation;
      try {
        normalizedDelegation = normalizeIssuedDelegation(
          delegationResult,
          operation.binding,
          operation.actorId
        );
      } catch {
        revokeDelegation(operation.binding, NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED);
        markAuthorityUnhealthy();
        return askEach(NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED, false);
      }
      // Result normalization is another reentrancy frontier. A forged result
      // cannot publish authority, even if it contains ok/issued booleans.
      if (!lifecycleIsCurrent(operation) || !normalizedDelegation) {
        revokeDelegation(operation.binding, NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED);
        if (!normalizedDelegation) markAuthorityUnhealthy();
        return askEach(NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED, false);
      }
      if (!lifecycleIsCurrent(operation)) {
        revokeDelegation(operation.binding, NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED);
        return askEach(NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED, false);
      }
      activeByKey.set(operation.key, Object.freeze({
        actorId: operation.actorId,
        binding: operation.binding,
        delegationId: normalizedDelegation.delegationId,
        expiresAt: normalizedDelegation.expiresAt,
        windowLease: operation.windowLease,
      }));
      return delegated();
    } finally {
      let handleCleanupConfirmed = true;
      if (consentHandle) {
        // A consumed handle is intentionally absent, so cancel(handle) may
        // report not_found. cancelWhere provides idempotent, task-scoped proof
        // that no unconsumed native confirmation remains.
        const canceledHandle = cancelIssuedHandle(consentHandle);
        if (!canceledHandle && !cancelTrustedBinding(operation.binding)) {
          markAuthorityUnhealthy();
          handleCleanupConfirmed = false;
        }
      }
      reservedActiveKeys.delete(operation.key);
      if (pendingByKey.get(operation.key) === operation) pendingByKey.delete(operation.key);
      if (!handleCleanupConfirmed) {
        revokeDelegation(
          operation.binding,
          NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED
        );
        activeByKey.delete(operation.key);
        return askEach(NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED, false);
      }
    }
  }

  function ensureTaskDelegation(input = {}) {
    let binding;
    let actorId;
    let windowLease;
    let projectLabel;
    try {
      if (!isPlainDataRecord(input, ENSURE_KEYS, ['binding', 'actorId', 'windowLease'])) {
        throw new TypeError('ensureTaskDelegation input must be a plain data record');
      }
      binding = createCapabilityDelegationBinding(
        Object.getOwnPropertyDescriptor(input, 'binding').value
      );
      actorId = createCapabilityDelegationPrincipal({
        kind: 'user_ui',
        actorId: Object.getOwnPropertyDescriptor(input, 'actorId').value,
      }).actorId;
      windowLease = Object.getOwnPropertyDescriptor(input, 'windowLease').value;
      if (!isOpaqueLease(windowLease) || invalidatedLeases.has(windowLease)) {
        throw new TypeError('windowLease must be a live opaque lease');
      }
      projectLabel = normalizeProjectLabel(Object.hasOwn(input, 'projectLabel')
        ? Object.getOwnPropertyDescriptor(input, 'projectLabel').value
        : undefined);
    } catch {
      return Promise.resolve(askEach(NATIVE_TASK_CONSENT_REASONS.INVALID_INPUT, false));
    }

    const key = operationKey(binding, windowLease);
    if (!purgeExpiredActive()) {
      return Promise.resolve(askEach(NATIVE_TASK_CONSENT_REASONS.BUSY, false));
    }
    const existing = pendingByKey.get(key);
    if (existing) {
      if (existing.actorId === actorId && bindingsMatch(existing.binding, binding)) {
        return existing.promise;
      }
      return Promise.resolve(askEach(NATIVE_TASK_CONSENT_REASONS.BUSY, false));
    }
    const active = activeByKey.get(key);
    if (active) {
      if (!bindingsMatch(active.binding, binding) || active.actorId !== actorId) {
        return Promise.resolve(askEach(NATIVE_TASK_CONSENT_REASONS.BUSY, false));
      }
      if (validateActiveDelegation(key, active, binding, actorId, windowLease)) {
        return Promise.resolve(delegated());
      }
      const revoked = revokeDelegation(
        binding,
        NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED
      );
      if (revoked) activeByKey.delete(key);
      return Promise.resolve(askEach(NATIVE_TASK_CONSENT_REASONS.DELEGATION_NOT_ISSUED, false));
    }
    if (!authorityHealthy
      || pendingByKey.size >= maxPendingDialogs
      || (activeByKey.size >= maxActiveDelegations && !activeByKey.has(key))) {
      return Promise.resolve(askEach(NATIVE_TASK_CONSENT_REASONS.BUSY, false));
    }
    const operation = {
      abortController: new AbortController(),
      actorId,
      binding,
      generation,
      invalidated: false,
      key,
      promise: null,
      reason: '',
      windowLease,
    };
    operation.promise = Promise.resolve().then(() => runEnsure(operation, projectLabel));
    pendingByKey.set(key, operation);
    return operation.promise;
  }

  function cancelJob(input = {}) {
    let binding;
    let reason;
    try {
      if (!isPlainDataRecord(input, CANCEL_KEYS, ['binding'])) {
        throw new TypeError('cancelJob input must be a plain data record');
      }
      binding = createCapabilityDelegationBinding(
        Object.getOwnPropertyDescriptor(input, 'binding').value
      );
      reason = normalizeReason(
        Object.hasOwn(input, 'reason')
          ? Object.getOwnPropertyDescriptor(input, 'reason').value
          : undefined,
        NATIVE_TASK_CONSENT_REASONS.JOB_CANCELED
      );
    } catch {
      return Object.freeze({ ok: false, canceled: 0, revoked: 0 });
    }
    let canceled = 0;
    for (const operation of pendingByKey.values()) {
      if (!bindingsMatch(operation.binding, binding)) continue;
      invalidateOperation(operation, reason);
      canceled += 1;
    }
    const trustedRevoked = cancelTrustedBinding(binding);
    const delegationRevoked = revokeDelegation(binding, reason);
    let revoked = 0;
    for (const [key, active] of activeByKey) {
      if (!bindingsMatch(active.binding, binding)) continue;
      if (delegationRevoked) {
        activeByKey.delete(key);
        revoked += 1;
      }
    }
    return Object.freeze({ ok: trustedRevoked && delegationRevoked, canceled, revoked });
  }

  function invalidateWindow(reasonInput) {
    const reason = normalizeReason(reasonInput, NATIVE_TASK_CONSENT_REASONS.WINDOW_INVALIDATED);
    generation += 1;
    let currentLease = null;
    try {
      currentLease = getWindowLease();
    } catch {
      currentLease = null;
    }
    const leases = new Set();
    if (isOpaqueLease(currentLease)) leases.add(currentLease);
    for (const operation of pendingByKey.values()) leases.add(operation.windowLease);
    for (const active of activeByKey.values()) leases.add(active.windowLease);
    for (const lease of leases) {
      if (!invalidatedLeases.has(lease)) {
        invalidatedLeases.add(lease);
        invalidatedLeaseCount += 1;
      }
    }
    let canceled = 0;
    const bindingsToRevoke = new Map();
    for (const operation of pendingByKey.values()) {
      invalidateOperation(operation, reason);
      bindingsToRevoke.set(JSON.stringify(operation.binding), operation.binding);
      canceled += 1;
    }
    for (const active of activeByKey.values()) {
      bindingsToRevoke.set(JSON.stringify(active.binding), active.binding);
    }
    let mutationsOk = true;
    const successfullyRevokedBindings = new Set();
    for (const [bindingKey, taskBinding] of bindingsToRevoke) {
      const trustedRevoked = cancelTrustedBinding(taskBinding);
      const delegationRevoked = revokeDelegation(taskBinding, reason);
      if (!trustedRevoked || !delegationRevoked) mutationsOk = false;
      if (delegationRevoked) successfullyRevokedBindings.add(bindingKey);
    }
    let revoked = 0;
    for (const [key, active] of activeByKey) {
      if (!successfullyRevokedBindings.has(JSON.stringify(active.binding))) continue;
      activeByKey.delete(key);
      revoked += 1;
    }
    return Object.freeze({ ok: mutationsOk, canceled, revoked });
  }

  function clear() {
    const canceled = pendingByKey.size;
    const revoked = activeByKey.size;
    generation += 1;
    let currentLease = null;
    try { currentLease = getWindowLease(); } catch { currentLease = null; }
    if (isOpaqueLease(currentLease) && !invalidatedLeases.has(currentLease)) {
      invalidatedLeases.add(currentLease);
      invalidatedLeaseCount += 1;
    }
    for (const operation of pendingByKey.values()) {
      if (!invalidatedLeases.has(operation.windowLease)) {
        invalidatedLeases.add(operation.windowLease);
        invalidatedLeaseCount += 1;
      }
      invalidateOperation(operation, NATIVE_TASK_CONSENT_REASONS.CLEARED);
    }
    pendingByKey.clear();
    reservedActiveKeys.clear();
    const trustedClear = invokeMutation(trustedConsentAuthority, 'clear');
    const delegationClear = invokeMutation(taskDelegationStore, 'clear');
    if (delegationClear.ok) activeByKey.clear();
    return Object.freeze({
      ok: trustedClear.ok && delegationClear.ok,
      canceled,
      revoked: delegationClear.ok ? revoked : 0,
    });
  }

  function diagnostics() {
    purgeExpiredActive();
    return Object.freeze({
      version: NATIVE_TASK_CONSENT_SERVICE_VERSION,
      pendingDialogs: pendingByKey.size,
      activeDelegations: activeByKey.size,
      maxPendingDialogs,
      maxActiveDelegations,
      invalidatedWindowLeases: invalidatedLeaseCount,
      authorityHealthy,
      defaultMode: CAPABILITY_DELEGATION_MODES.ASK_EACH,
      delegatedEffect: CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE,
      delegatedTtlMs: DEFAULT_DELEGATION_TTL_MS,
      persistence: 'process_local',
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({
    ensureTaskDelegation,
    invalidateWindow,
    cancelJob,
    clear,
    diagnostics,
  });
}

class NativeTaskConsentService {
  constructor(options = {}) {
    Object.assign(this, createNativeTaskConsentService(options));
    Object.freeze(this);
  }
}

module.exports = {
  DEFAULT_MAX_ACTIVE_DELEGATIONS,
  DEFAULT_MAX_PENDING_DIALOGS,
  FIXED_DIALOG,
  HARD_MAX_CONSENT_RECORDS,
  NATIVE_TASK_CONSENT_REASONS,
  NATIVE_TASK_CONSENT_SERVICE_VERSION,
  NativeTaskConsentService,
  createNativeTaskConsentService,
};
