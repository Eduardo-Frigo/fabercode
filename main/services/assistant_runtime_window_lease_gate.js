'use strict';

const util = require('util');

const LIFECYCLE_RESULT_KEYS = Object.freeze([
  'ok',
  'status',
  'code',
  'deferred',
  'idempotent',
]);

function opaqueToken() {
  return Object.freeze(Object.create(null));
}

function isOpaqueIdentity(value) {
  const kind = typeof value;
  return (kind === 'object' && value !== null)
    || kind === 'function'
    || kind === 'symbol';
}

function inspectDataRecord(value, { requireFrozen = false } = {}) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || util.types.isProxy(value) || util.types.isPromise(value)
      || (requireFrozen && !Object.isFrozen(value))) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const fields = new Map();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
        return null;
      }
      fields.set(key, descriptor.value);
    }
    return fields;
  } catch {
    return null;
  }
}

function hasExactKeys(fields, expected) {
  if (!fields || fields.size !== expected.length) return false;
  return expected.every((key) => fields.has(key));
}

function isExactCompletedResult(fields, idempotent = false) {
  return hasExactKeys(fields, LIFECYCLE_RESULT_KEYS)
    && fields.get('ok') === true
    && fields.get('status') === 'completed'
    && fields.get('code') === null
    && fields.get('deferred') === false
    && fields.get('idempotent') === idempotent;
}

function isDeferredResult(fields, idempotent = false) {
  return hasExactKeys(fields, LIFECYCLE_RESULT_KEYS)
    && fields.get('ok') === true
    && fields.get('status') === 'deferred'
    && typeof fields.get('code') === 'string'
    && fields.get('code').length > 0
    && fields.get('deferred') === true
    && fields.get('idempotent') === idempotent;
}

function isIdempotentContinuation(fields) {
  return isExactCompletedResult(fields, true)
    || isDeferredResult(fields, true);
}

function cleanupDiagnosticsAreHealthy(value) {
  const fields = inspectDataRecord(value, { requireFrozen: true });
  if (!fields || !fields.has('active')
    || !fields.has('failedJobs')
    || !fields.has('unresolvedCleanupFailures')) {
    return Object.freeze({ ok: false, code: 'lifecycle_diagnostics_invalid' });
  }
  if (fields.get('active') !== false) {
    return Object.freeze({ ok: false, code: 'lifecycle_diagnostics_invalid' });
  }
  const failedJobs = fields.get('failedJobs');
  const unresolvedCleanupFailures = fields.get('unresolvedCleanupFailures');
  if (!Number.isSafeInteger(failedJobs) || failedJobs < 0
    || !Number.isSafeInteger(unresolvedCleanupFailures)
    || unresolvedCleanupFailures < 0) {
    return Object.freeze({ ok: false, code: 'lifecycle_diagnostics_invalid' });
  }
  if (failedJobs !== 0 || unresolvedCleanupFailures !== 0) {
    return Object.freeze({ ok: false, code: 'lifecycle_cleanup_unresolved' });
  }
  return Object.freeze({ ok: true, code: null });
}

function stateResult({ ok, status, code = null, idempotent = false }) {
  return Object.freeze({ ok, status, code, idempotent });
}

function beginResult({ ok, status, code = null, epochToken = null }) {
  return Object.freeze({
    ok,
    status,
    code,
    epochToken,
    idempotent: false,
  });
}

function leaseResult({ ok, status, code = null, leaseToken = null, idempotent = false }) {
  return Object.freeze({
    ok,
    status,
    code,
    leaseToken,
    idempotent,
  });
}

function createAssistantRuntimeWindowLeaseGate() {
  let state = 'idle';
  let epochToken = null;
  let windowToken = null;
  let candidateToken = null;
  let leaseToken = null;

  function invalidate(nextState) {
    state = nextState;
    epochToken = null;
    windowToken = null;
    candidateToken = null;
    leaseToken = null;
  }

  function beginClear(nextWindowToken) {
    // Invalidation deliberately precedes validation: even a malformed new
    // lifecycle boundary cannot leave an older document capability alive.
    invalidate('clearing');
    if (!isOpaqueIdentity(nextWindowToken)) {
      state = 'failed';
      return beginResult({
        ok: false,
        status: state,
        code: 'window_token_invalid',
      });
    }
    epochToken = opaqueToken();
    windowToken = nextWindowToken;
    return beginResult({
      ok: true,
      status: state,
      epochToken,
    });
  }

  function didFinish(targetEpochToken, targetWindowToken, nextCandidateToken) {
    if (!isOpaqueIdentity(targetEpochToken)
      || !isOpaqueIdentity(targetWindowToken)
      || !isOpaqueIdentity(nextCandidateToken)) {
      return stateResult({
        ok: false,
        status: state,
        code: 'document_candidate_invalid',
      });
    }
    if (targetEpochToken !== epochToken || targetWindowToken !== windowToken) {
      return stateResult({
        ok: false,
        status: state,
        code: 'document_candidate_stale',
        idempotent: true,
      });
    }
    if (state === 'failed') {
      return stateResult({
        ok: true,
        status: state,
        idempotent: true,
      });
    }
    if (state !== 'clearing' && state !== 'ready') {
      return stateResult({
        ok: false,
        status: state,
        code: 'document_candidate_not_accepted',
      });
    }
    if (candidateToken === nextCandidateToken) {
      return stateResult({ ok: true, status: state, idempotent: true });
    }
    if (candidateToken !== null) {
      state = 'failed';
      candidateToken = null;
      leaseToken = null;
      return stateResult({
        ok: false,
        status: state,
        code: 'document_candidate_conflict',
      });
    }
    candidateToken = nextCandidateToken;
    leaseToken = null;
    return stateResult({ ok: true, status: state });
  }

  function concludeClear(targetEpochToken, lifecycleResult, lifecycleDiagnostics) {
    if (!isOpaqueIdentity(targetEpochToken)) {
      return stateResult({
        ok: false,
        status: state,
        code: 'lifecycle_epoch_invalid',
      });
    }
    if (targetEpochToken !== epochToken) {
      return stateResult({ ok: true, status: state, idempotent: true });
    }
    if (state === 'failed' || state === 'ready') {
      return stateResult({ ok: true, status: state, idempotent: true });
    }
    if (state !== 'clearing') {
      return stateResult({
        ok: false,
        status: state,
        code: 'lifecycle_epoch_not_clearing',
      });
    }

    const fields = inspectDataRecord(lifecycleResult, { requireFrozen: true });
    if (isIdempotentContinuation(fields)) {
      return stateResult({ ok: true, status: state, idempotent: true });
    }
    if (isDeferredResult(fields)) {
      return stateResult({ ok: true, status: state });
    }
    if (!isExactCompletedResult(fields)) {
      state = 'failed';
      leaseToken = null;
      return stateResult({
        ok: false,
        status: state,
        code: 'lifecycle_clear_failed',
      });
    }

    const cleanupHealth = cleanupDiagnosticsAreHealthy(lifecycleDiagnostics);
    if (!cleanupHealth.ok) {
      state = 'failed';
      leaseToken = null;
      return stateResult({
        ok: false,
        status: state,
        code: cleanupHealth.code,
      });
    }
    state = 'ready';
    return stateResult({ ok: true, status: state });
  }

  function exactReadyCandidate(
    targetEpochToken,
    targetWindowToken,
    targetCandidateToken
  ) {
    return state === 'ready'
      && targetEpochToken === epochToken
      && targetWindowToken === windowToken
      && targetCandidateToken === candidateToken
      && candidateToken !== null;
  }

  function issueLease(targetEpochToken, targetWindowToken, targetCandidateToken) {
    if (!isOpaqueIdentity(targetEpochToken)
      || !isOpaqueIdentity(targetWindowToken)
      || !isOpaqueIdentity(targetCandidateToken)
      || !exactReadyCandidate(
        targetEpochToken,
        targetWindowToken,
        targetCandidateToken
      )) {
      return leaseResult({
        ok: false,
        status: state,
        code: 'window_lease_denied',
      });
    }
    const idempotent = leaseToken !== null;
    if (!leaseToken) leaseToken = opaqueToken();
    return leaseResult({
      ok: true,
      status: state,
      leaseToken,
      idempotent,
    });
  }

  function consumeLease(targetEpochToken, targetWindowToken, targetCandidateToken) {
    if (!isOpaqueIdentity(targetEpochToken)
      || !isOpaqueIdentity(targetWindowToken)
      || !isOpaqueIdentity(targetCandidateToken)
      || !exactReadyCandidate(
        targetEpochToken,
        targetWindowToken,
        targetCandidateToken
      )
      || leaseToken === null) {
      return leaseResult({
        ok: false,
        status: state,
        code: 'window_lease_denied',
      });
    }
    return leaseResult({
      ok: true,
      status: state,
      leaseToken,
      idempotent: true,
    });
  }

  function diagnostics() {
    return Object.freeze({
      state,
      hasEpoch: epochToken !== null,
      hasWindow: windowToken !== null,
      hasCandidate: candidateToken !== null,
      hasLease: leaseToken !== null,
    });
  }

  return Object.freeze({
    beginClear,
    didFinish,
    concludeClear,
    issueLease,
    consumeLease,
    diagnostics,
  });
}

module.exports = {
  createAssistantRuntimeWindowLeaseGate,
};
