'use strict';

const util = require('util');

const CLEANUP_RECEIPT_VERSION = 'assistant-job-execution-cleanup-receipt.v1';
const SAFE_JOB_ID = /^job-[A-Za-z0-9._-]{1,180}$/;
const SAFE_REASON = /^[A-Za-z0-9._:-]{1,200}$/;
const DEPENDENCY_KEYS = Object.freeze([
  'invalidateWindow',
  'clearPeripheralAuthority',
  'clearCoordinator',
  'clearDeleteRuntime',
  'markCancellationRequested',
  'markCancelledAfterCleanup',
  'markExecutionCleanupFailed',
  'scheduleContinuation',
]);
const PROOF_KEYS = Object.freeze([
  'jobId',
  'terminalStatus',
  'executorClosed',
  'processTreeTerminated',
  'workspaceRolledBack',
  'rootReleased',
  'authorityRevoked',
]);
const FAILURE_KEYS = Object.freeze(['jobId', 'terminalStatus', 'reason']);
const DRAIN_ONLY_TERMINAL_STATUSES = Object.freeze(new Set([
  'completed',
  'failed',
  'blocked',
  'runtime_interrupted',
]));
const BENIGN_OUTCOME_CACHE_LIMIT = 4096;

function inspectDataRecord(value, { allowedKeys = null, requiredKeys = [] } = {}) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || util.types.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return null;
    if (allowedKeys && keys.some((key) => !allowedKeys.includes(key))) return null;
    if (requiredKeys.some((key) => !keys.includes(key))) return null;
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

function captureDependencies(options) {
  const fields = inspectDataRecord(options, {
    allowedKeys: DEPENDENCY_KEYS,
    requiredKeys: DEPENDENCY_KEYS,
  });
  const captured = {};
  for (const key of DEPENDENCY_KEYS) {
    const callback = fields && fields.get(key);
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${key} must be a function`);
    }
    captured[key] = callback;
  }
  return Object.freeze(captured);
}

function normalizeReason(value, fallback = null) {
  return typeof value === 'string' && SAFE_REASON.test(value) ? value : fallback;
}

function operationResult(raw, fallbackCode) {
  if (util.types.isPromise(raw)) return { ok: false, code: fallbackCode };
  const fields = inspectDataRecord(raw);
  if (!fields || fields.has('then') || typeof fields.get('ok') !== 'boolean') {
    return { ok: false, code: fallbackCode };
  }
  const code = normalizeReason(fields.get('code'), fallbackCode);
  return fields.get('ok') === true
    ? { ok: true, code: null }
    : { ok: false, code };
}

function publicResult({ ok, status, code = null, deferred = false, idempotent = false }) {
  return Object.freeze({ ok, status, code, deferred, idempotent });
}

function invalid(code) {
  return publicResult({ ok: false, status: 'failed', code });
}

function normalizeProof(value) {
  const fields = inspectDataRecord(value, {
    allowedKeys: PROOF_KEYS,
    requiredKeys: PROOF_KEYS,
  });
  if (!fields) return null;
  const jobId = fields.get('jobId');
  const terminalStatus = fields.get('terminalStatus');
  if (typeof jobId !== 'string' || !SAFE_JOB_ID.test(jobId)
    || (terminalStatus !== 'cancelled'
      && !DRAIN_ONLY_TERMINAL_STATUSES.has(terminalStatus))
    || fields.get('executorClosed') !== true
    || fields.get('processTreeTerminated') !== true
    || fields.get('workspaceRolledBack') !== true
    || fields.get('rootReleased') !== true
    || fields.get('authorityRevoked') !== true) {
    return null;
  }
  return Object.freeze({
    jobId,
    terminalStatus,
    drainOnly: terminalStatus !== 'cancelled',
  });
}

function normalizeFailure(value) {
  const fields = inspectDataRecord(value, {
    allowedKeys: FAILURE_KEYS,
    requiredKeys: ['jobId', 'reason'],
  });
  if (!fields) return null;
  const jobId = fields.get('jobId');
  const reason = normalizeReason(fields.get('reason'));
  const terminalStatus = fields.get('terminalStatus') === undefined
    ? 'cancelled'
    : fields.get('terminalStatus');
  if (typeof jobId !== 'string' || !SAFE_JOB_ID.test(jobId) || !reason
    || (terminalStatus !== 'cancelled'
      && !DRAIN_ONLY_TERMINAL_STATUSES.has(terminalStatus))) {
    return null;
  }
  return Object.freeze({
    jobId,
    terminalStatus,
    reason,
    drainOnly: terminalStatus !== 'cancelled',
  });
}

function createAssistantRuntimeLifecycleClearService(options = {}) {
  const dependencies = captureDependencies(options);
  const finalizedJobs = new Set();
  const failedJobs = new Map();
  const drainOnlyOutcomes = new Map();
  const unresolvedCleanupFailureJobIds = new Set();
  let finalizedJobEvictions = 0;
  let drainOnlyOutcomeEvictions = 0;
  let session = null;
  let completedSessions = 0;
  let failedSessions = 0;
  let deferredSessions = 0;

  // These two collections are replay accelerators, never sources of durable
  // authority. Receipt persistence is idempotent and drain-only outcomes do
  // not perform an external effect, so FIFO eviction is safe. Failure latches
  // intentionally use separate, unbounded collections below.
  function rememberFinalizedJob(jobId) {
    finalizedJobs.add(jobId);
    if (finalizedJobs.size <= BENIGN_OUTCOME_CACHE_LIMIT) return;
    const oldestJobId = finalizedJobs.values().next().value;
    finalizedJobs.delete(oldestJobId);
    finalizedJobEvictions += 1;
  }

  function rememberDrainOnlyOutcome(jobId, outcome) {
    drainOnlyOutcomes.set(jobId, outcome);
    if (drainOnlyOutcomes.size <= BENIGN_OUTCOME_CACHE_LIMIT) return;
    const oldestJobId = drainOnlyOutcomes.keys().next().value;
    drainOnlyOutcomes.delete(oldestJobId);
    drainOnlyOutcomeEvictions += 1;
  }

  function dependencyCall(callback, args, fallbackCode) {
    let raw;
    try {
      raw = callback(...args);
    } catch {
      return { ok: false, code: fallbackCode };
    }
    return operationResult(raw, fallbackCode);
  }

  function recordFailure(jobId, reason) {
    if (finalizedJobs.has(jobId)) return false;
    unresolvedCleanupFailureJobIds.add(jobId);
    if (failedJobs.get(jobId) === reason) return true;
    const result = dependencyCall(
      dependencies.markExecutionCleanupFailed,
      [jobId, reason],
      'execution_cleanup_failure_persistence_failed'
    );
    if (!result.ok) return false;
    failedJobs.set(jobId, reason);
    return true;
  }

  function failSession(target, reason) {
    const safeReason = normalizeReason(reason, 'lifecycle_clear_failed');
    for (const jobId of target.expectedJobIds) {
      if (!finalizedJobs.has(jobId)) recordFailure(jobId, safeReason);
    }
    target.phase = 'failed';
    if (session === target) session = null;
    failedSessions += 1;
    return invalid(safeReason);
  }

  function finalizeIfReady(target) {
    if (session !== target || !target.windowConfirmed || !target.coordinatorConfirmed
      || !target.peripheralConfirmed || !target.runtimeConfirmed) return null;
    for (const jobId of target.expectedJobIds) {
      if (!target.proofs.has(jobId)) return null;
    }

    let failureCode = null;
    for (const jobId of target.expectedJobIds) {
      if (finalizedJobs.has(jobId)) continue;
      const receipt = Object.freeze({
        schemaVersion: CLEANUP_RECEIPT_VERSION,
        jobId,
        cleanupCompleted: true,
      });
      const result = dependencyCall(
        dependencies.markCancelledAfterCleanup,
        [jobId, receipt],
        'execution_cleanup_receipt_persistence_failed'
      );
      if (result.ok) {
        rememberFinalizedJob(jobId);
      } else {
        failureCode = result.code;
        recordFailure(jobId, result.code);
      }
    }
    target.phase = failureCode ? 'failed' : 'completed';
    session = null;
    if (failureCode) {
      failedSessions += 1;
      return invalid(failureCode);
    }
    completedSessions += 1;
    return publicResult({ ok: true, status: 'completed' });
  }

  function schedule(target) {
    if (session !== target || target.continuationScheduled) return true;
    target.continuationScheduled = true;
    target.continuationGeneration += 1;
    const generation = target.continuationGeneration;
    const continuation = Object.freeze(() => {
      if (session !== target || target.continuationGeneration !== generation
        || !target.continuationScheduled) {
        return publicResult({
          ok: true,
          status: 'completed',
          idempotent: true,
        });
      }
      target.continuationScheduled = false;
      return advance(target);
    });
    try {
      dependencies.scheduleContinuation(continuation);
      return true;
    } catch {
      target.continuationScheduled = false;
      return false;
    }
  }

  function refreshAuthorityPerimeter(target, reason) {
    target.authorityPerimeterAttempted = true;
    target.phase = 'invalidating_window';
    const windowInvalidation = dependencyCall(
      dependencies.invalidateWindow,
      [reason],
      'window_invalidation_failed'
    );
    target.windowConfirmed = windowInvalidation.ok;
    let failureCode = windowInvalidation.ok ? null : windowInvalidation.code;

    target.phase = 'clearing_peripheral_authority';
    const peripheral = dependencyCall(
      dependencies.clearPeripheralAuthority,
      [reason],
      'peripheral_clear_failed'
    );
    target.peripheralConfirmed = peripheral.ok;
    if (!peripheral.ok && !failureCode) failureCode = peripheral.code;
    if (failureCode && !target.gateFailureCode) target.gateFailureCode = failureCode;
    return failureCode;
  }

  function advance(target) {
    if (session !== target) {
      return publicResult({ ok: true, status: 'completed', idempotent: true });
    }
    if (target.advancing) {
      return publicResult({
        ok: true,
        status: 'deferred',
        code: 'lifecycle_clear_in_progress',
        deferred: true,
        idempotent: true,
      });
    }
    target.advancing = true;
    if (!target.authorityPerimeterAttempted) {
      refreshAuthorityPerimeter(target, target.reason);
    }

    target.phase = 'clearing_coordinator';
    const coordinator = dependencyCall(
      dependencies.clearCoordinator,
      [],
      'coordinator_clear_failed'
    );
    if (!coordinator.ok && coordinator.code === 'execution_draining') {
      target.phase = 'execution_draining';
      target.advancing = false;
      deferredSessions += 1;
      return publicResult({
        ok: true,
        status: 'deferred',
        code: 'execution_draining',
        deferred: true,
      });
    }
    if (!coordinator.ok) {
      target.advancing = false;
      return failSession(target, coordinator.code);
    }
    target.coordinatorConfirmed = true;

    target.phase = 'clearing_delete_runtime';
    const runtime = dependencyCall(
      dependencies.clearDeleteRuntime,
      [],
      'runtime_clear_failed'
    );
    if (!runtime.ok) {
      target.advancing = false;
      return failSession(target, runtime.code);
    }
    target.runtimeConfirmed = true;
    if (target.gateFailureCode || target.cleanupFailureCode) {
      target.advancing = false;
      return failSession(target, target.gateFailureCode || target.cleanupFailureCode);
    }
    if (unresolvedCleanupFailureJobIds.size > 0) {
      target.advancing = false;
      return failSession(target, 'unresolved_cleanup_failure');
    }
    target.phase = 'awaiting_execution_cleanup_proofs';
    target.advancing = false;
    const finalized = finalizeIfReady(target);
    return finalized || publicResult({
      ok: true,
      status: 'deferred',
      code: 'awaiting_execution_cleanup_proofs',
      deferred: true,
    });
  }

  function clear(reason) {
    const safeReason = normalizeReason(reason);
    if (!safeReason) return invalid('lifecycle_clear_reason_invalid');
    if (session) {
      const target = session;
      const priorPhase = target.phase;
      const perimeterFailure = refreshAuthorityPerimeter(target, safeReason);
      if (session !== target) {
        return publicResult({ ok: true, status: 'completed', idempotent: true });
      }
      if (target.advancing) {
        return publicResult({
          ok: true,
          status: 'deferred',
          code: priorPhase,
          deferred: true,
          idempotent: true,
        });
      }
      if (priorPhase === 'execution_draining') {
        target.continuationGeneration += 1;
        target.continuationScheduled = false;
        return advance(target);
      }
      target.phase = priorPhase;
      if (perimeterFailure) return failSession(target, perimeterFailure);
      return publicResult({
        ok: true,
        status: 'deferred',
        code: priorPhase,
        deferred: true,
        idempotent: true,
      });
    }
    session = {
      reason: safeReason,
      phase: 'created',
      expectedJobIds: new Set(),
      proofs: new Map(),
      windowConfirmed: false,
      coordinatorConfirmed: false,
      peripheralConfirmed: false,
      runtimeConfirmed: false,
      authorityPerimeterAttempted: false,
      gateFailureCode: null,
      cleanupFailureCode: null,
      continuationScheduled: false,
      continuationGeneration: 0,
      advancing: false,
    };
    return advance(session);
  }

  function requestCancellation(jobId, reason) {
    const safeReason = normalizeReason(reason);
    if (typeof jobId !== 'string' || !SAFE_JOB_ID.test(jobId) || !safeReason) {
      return invalid('cancellation_request_invalid');
    }
    if (session && session.expectedJobIds.has(jobId)) {
      return publicResult({ ok: true, status: 'accepted', idempotent: true });
    }
    if (finalizedJobs.has(jobId) || failedJobs.has(jobId)
      || drainOnlyOutcomes.has(jobId)) {
      return invalid('job_already_settled');
    }
    const persistedReason = session ? session.reason : safeReason;
    const result = dependencyCall(
      dependencies.markCancellationRequested,
      [jobId, persistedReason],
      'cancellation_request_persistence_failed'
    );
    if (!result.ok) return invalid(result.code);
    if (session) session.expectedJobIds.add(jobId);
    return publicResult({ ok: true, status: 'accepted' });
  }

  function confirmExecutionCleanup(value) {
    const proof = normalizeProof(value);
    if (!proof) return invalid('execution_cleanup_proof_invalid');
    if (proof.drainOnly) {
      const existing = drainOnlyOutcomes.get(proof.jobId);
      if (existing) {
        if (existing.kind === 'proof'
          && existing.terminalStatus === proof.terminalStatus) {
          return publicResult({ ok: true, status: 'accepted', idempotent: true });
        }
        return invalid('execution_cleanup_outcome_conflict');
      }
      if (finalizedJobs.has(proof.jobId) || failedJobs.has(proof.jobId)
        || (session && session.proofs.has(proof.jobId))) {
        return invalid('execution_cleanup_outcome_conflict');
      }
      rememberDrainOnlyOutcome(proof.jobId, Object.freeze({
        kind: 'proof',
        terminalStatus: proof.terminalStatus,
      }));
      if (session) {
        const target = session;
        target.expectedJobIds.delete(proof.jobId);
        if (target.phase === 'execution_draining' && !schedule(target)) {
          return failSession(target, 'continuation_schedule_failed');
        }
        const finalized = finalizeIfReady(target);
        if (finalized) return finalized;
      }
      return publicResult({ ok: true, status: 'accepted' });
    }
    if (drainOnlyOutcomes.has(proof.jobId)) {
      return invalid('execution_cleanup_outcome_conflict');
    }
    if (finalizedJobs.has(proof.jobId)) {
      return publicResult({ ok: true, status: 'completed', idempotent: true });
    }
    if (failedJobs.has(proof.jobId)) return invalid('execution_cleanup_outcome_conflict');
    if (!session) {
      const receipt = Object.freeze({
        schemaVersion: CLEANUP_RECEIPT_VERSION,
        jobId: proof.jobId,
        cleanupCompleted: true,
      });
      const result = dependencyCall(
        dependencies.markCancelledAfterCleanup,
        [proof.jobId, receipt],
        'execution_cleanup_receipt_persistence_failed'
      );
      if (!result.ok) return invalid(result.code);
      rememberFinalizedJob(proof.jobId);
      return publicResult({ ok: true, status: 'completed' });
    }
    const target = session;
    if (!target.expectedJobIds.has(proof.jobId)) {
      return invalid('execution_cleanup_job_unexpected');
    }
    if (target.proofs.has(proof.jobId)) {
      return publicResult({ ok: true, status: 'accepted', idempotent: true });
    }
    target.proofs.set(proof.jobId, proof);
    if (target.phase === 'execution_draining' && !schedule(target)) {
      return failSession(target, 'continuation_schedule_failed');
    }
    const finalized = finalizeIfReady(target);
    return finalized || publicResult({ ok: true, status: 'accepted' });
  }

  function failExecutionCleanup(value) {
    const failure = normalizeFailure(value);
    if (!failure) return invalid('execution_cleanup_failure_invalid');
    if (failure.drainOnly) {
      const existing = drainOnlyOutcomes.get(failure.jobId);
      if (existing) {
        if (existing.kind === 'failure'
          && existing.terminalStatus === failure.terminalStatus
          && existing.reason === failure.reason) {
          return publicResult({ ok: true, status: 'failed', idempotent: true });
        }
        return invalid('execution_cleanup_outcome_conflict');
      }
      if (finalizedJobs.has(failure.jobId) || failedJobs.has(failure.jobId)
        || (session && session.proofs.has(failure.jobId))) {
        return invalid('execution_cleanup_outcome_conflict');
      }
      rememberDrainOnlyOutcome(failure.jobId, Object.freeze({
        kind: 'failure',
        terminalStatus: failure.terminalStatus,
        reason: failure.reason,
      }));
      unresolvedCleanupFailureJobIds.add(failure.jobId);
      if (session) {
        const target = session;
        target.expectedJobIds.delete(failure.jobId);
        target.cleanupFailureCode = target.cleanupFailureCode || failure.reason;
        if (target.phase === 'execution_draining' && !schedule(target)) {
          return failSession(target, 'continuation_schedule_failed');
        }
      }
      return publicResult({ ok: true, status: 'failed' });
    }
    if (drainOnlyOutcomes.has(failure.jobId)) {
      return invalid('execution_cleanup_outcome_conflict');
    }
    if (failedJobs.get(failure.jobId) === failure.reason) {
      return publicResult({ ok: true, status: 'failed', idempotent: true });
    }
    if (finalizedJobs.has(failure.jobId)) return invalid('execution_cleanup_outcome_conflict');
    if (session && !session.expectedJobIds.has(failure.jobId)) {
      return invalid('execution_cleanup_job_unexpected');
    }
    if (session && session.proofs.has(failure.jobId)) {
      return invalid('execution_cleanup_outcome_conflict');
    }
    if (!recordFailure(failure.jobId, failure.reason)) {
      return invalid('execution_cleanup_failure_persistence_failed');
    }
    if (session) {
      session.cleanupFailureCode = session.cleanupFailureCode || failure.reason;
      if (session.phase === 'execution_draining' && !schedule(session)) {
        return failSession(session, 'continuation_schedule_failed');
      }
    }
    return publicResult({ ok: true, status: 'failed' });
  }

  function diagnostics() {
    const active = session;
    return Object.freeze({
      active: Boolean(active),
      reason: active ? active.reason : null,
      phase: active ? active.phase : null,
      expectedJobs: active ? active.expectedJobIds.size : 0,
      bufferedProofs: active ? active.proofs.size : 0,
      continuationScheduled: Boolean(active && active.continuationScheduled),
      benignOutcomeCacheLimit: BENIGN_OUTCOME_CACHE_LIMIT,
      finalizedJobs: finalizedJobs.size,
      finalizedJobEvictions,
      drainOnlyOutcomes: drainOnlyOutcomes.size,
      drainOnlyOutcomeEvictions,
      failedJobs: failedJobs.size,
      unresolvedCleanupFailures: unresolvedCleanupFailureJobIds.size,
      completedSessions,
      failedSessions,
      deferredSessions,
    });
  }

  return Object.freeze({
    clear,
    requestCancellation,
    confirmExecutionCleanup,
    failExecutionCleanup,
    diagnostics,
  });
}

module.exports = {
  createAssistantRuntimeLifecycleClearService,
};
