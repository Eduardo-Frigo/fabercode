'use strict';

const assert = require('assert');

const {
  createAssistantRuntimeLifecycleClearService,
} = require('../main/services/assistant_runtime_lifecycle_clear_service');

const JOB_ID = 'job-runtime-lifecycle-clear';
const REASON = 'renderer_navigation';

function cleanupProof(jobId = JOB_ID, terminalStatus = 'cancelled') {
  return Object.freeze({
    jobId,
    terminalStatus,
    executorClosed: true,
    processTreeTerminated: true,
    workspaceRolledBack: true,
    rootReleased: true,
    authorityRevoked: true,
  });
}

function createHarness(overrides = {}) {
  const calls = [];
  const receipts = [];
  const failures = [];
  const continuations = [];
  let service = null;
  const dependencies = {
    invalidateWindow(reason) {
      calls.push(['window', reason]);
      return Object.freeze({ ok: true });
    },
    clearPeripheralAuthority(reason) {
      calls.push(['peripheral', reason]);
      return Object.freeze({ ok: true });
    },
    clearCoordinator() {
      calls.push(['coordinator']);
      return Object.freeze({ ok: true, cleared: 0 });
    },
    clearDeleteRuntime() {
      calls.push(['runtime']);
      return Object.freeze({ ok: true });
    },
    markCancellationRequested(jobId, reason) {
      calls.push(['request', jobId, reason]);
      return Object.freeze({ ok: true });
    },
    markCancelledAfterCleanup(jobId, receipt) {
      calls.push(['receipt', jobId]);
      receipts.push(receipt);
      return Object.freeze({ ok: true });
    },
    markExecutionCleanupFailed(jobId, reason) {
      calls.push(['failure', jobId, reason]);
      failures.push({ jobId, reason });
      return Object.freeze({ ok: true });
    },
    scheduleContinuation(fn) {
      calls.push(['schedule']);
      continuations.push(fn);
    },
    ...overrides,
  };
  service = createAssistantRuntimeLifecycleClearService(dependencies);
  return {
    calls,
    continuations,
    failures,
    receipts,
    service,
    getService: () => service,
  };
}

assert.throws(
  () => createAssistantRuntimeLifecycleClearService(),
  /invalidateWindow/
);

// A synchronous lifecycle clear buffers its proof until every global clear gate succeeds.
{
  let harness;
  harness = createHarness({
    clearCoordinator() {
      const service = harness.getService();
      assert.strictEqual(
        service.requestCancellation(JOB_ID, 'coordinator_authority_revoked').ok,
        true
      );
      assert.strictEqual(service.confirmExecutionCleanup(cleanupProof()).ok, true);
      harness.calls.push(['coordinator']);
      assert.strictEqual(harness.receipts.length, 0);
      return Object.freeze({ ok: true, cleared: 1 });
    },
  });
  assert.strictEqual(Object.isFrozen(harness.service), true);
  assert.deepStrictEqual(Reflect.ownKeys(harness.service), [
    'clear',
    'requestCancellation',
    'confirmExecutionCleanup',
    'failExecutionCleanup',
    'diagnostics',
  ]);

  const result = harness.service.clear(REASON);
  assert.strictEqual(Object.isFrozen(result), true);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 'completed');
  assert.deepStrictEqual(harness.calls, [
    ['window', REASON],
    ['peripheral', REASON],
    ['request', JOB_ID, REASON],
    ['coordinator'],
    ['runtime'],
    ['receipt', JOB_ID],
  ]);
  assert.strictEqual(harness.receipts.length, 1);
  assert.strictEqual(Object.isFrozen(harness.receipts[0]), true);
  assert.deepStrictEqual(harness.receipts[0], {
    schemaVersion: 'assistant-job-execution-cleanup-receipt.v1',
    jobId: JOB_ID,
    cleanupCompleted: true,
  });
  assert.strictEqual(harness.failures.length, 0);
  assert.strictEqual(harness.service.diagnostics().active, false);
  const replay = harness.service.confirmExecutionCleanup(cleanupProof());
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.idempotent, true);
  assert.strictEqual(harness.receipts.length, 1);
}

// Peripheral failure also preserves coordinator revocation while blocking the receipt.
{
  let harness;
  harness = createHarness({
    clearPeripheralAuthority(reason) {
      harness.calls.push(['peripheral', reason]);
      return Object.freeze({ ok: false, code: 'peripheral_clear_failed' });
    },
    clearCoordinator() {
      const service = harness.getService();
      service.requestCancellation(JOB_ID, REASON);
      service.confirmExecutionCleanup(cleanupProof());
      harness.calls.push(['coordinator']);
      return Object.freeze({ ok: true, cleared: 1 });
    },
  });
  const result = harness.service.clear(REASON);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'peripheral_clear_failed');
  assert.strictEqual(harness.calls.some(([type]) => type === 'coordinator'), true);
  assert.strictEqual(harness.calls.some(([type]) => type === 'runtime'), true);
  assert.strictEqual(harness.receipts.length, 0);
  assert.deepStrictEqual(harness.failures, [{
    jobId: JOB_ID,
    reason: 'peripheral_clear_failed',
  }]);
}

// Outside lifecycle, cancellation request persists immediately with its own reason.
{
  const harness = createHarness();
  const result = harness.service.requestCancellation(JOB_ID, 'cancelled_by_user');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 'accepted');
  assert.deepStrictEqual(harness.calls, [
    ['request', JOB_ID, 'cancelled_by_user'],
  ]);
  assert.strictEqual(harness.service.diagnostics().active, false);
}

// Draining schedules one continuation and never clears runtime/peripherals before coordinator completion.
{
  let coordinatorCalls = 0;
  let harness;
  harness = createHarness({
    clearCoordinator() {
      coordinatorCalls += 1;
      if (coordinatorCalls === 1) {
        assert.strictEqual(
          harness.getService().requestCancellation(JOB_ID, REASON).ok,
          true
        );
        return Object.freeze({ ok: false, code: 'execution_draining' });
      }
      return Object.freeze({ ok: true, cleared: 1 });
    },
  });

  const deferred = harness.service.clear(REASON);
  assert.strictEqual(deferred.ok, true);
  assert.strictEqual(deferred.status, 'deferred');
  assert.strictEqual(harness.continuations.length, 0);
  assert.strictEqual(harness.calls.some(([type]) => type === 'runtime'), false);
  assert.strictEqual(
    harness.calls.filter(([type]) => type === 'window').length,
    1
  );
  assert.strictEqual(
    harness.calls.filter(([type]) => type === 'peripheral').length,
    1
  );

  const accepted = harness.service.confirmExecutionCleanup(cleanupProof());
  assert.strictEqual(accepted.ok, true);
  assert.strictEqual(harness.receipts.length, 0);
  assert.strictEqual(harness.continuations.length, 1);
  const duplicate = harness.service.confirmExecutionCleanup(cleanupProof());
  assert.strictEqual(duplicate.ok, true);
  assert.strictEqual(duplicate.idempotent, true);
  assert.strictEqual(harness.continuations.length, 1);

  harness.continuations.shift()();
  assert.strictEqual(coordinatorCalls, 2);
  assert.strictEqual(
    harness.calls.filter(([type]) => type === 'window').length,
    1
  );
  assert.strictEqual(
    harness.calls.filter(([type]) => type === 'peripheral').length,
    1
  );
  assert.strictEqual(harness.receipts.length, 1);
  assert.strictEqual(harness.service.diagnostics().active, false);
}

// Window invalidation failure blocks receipts but still attempts coordinator revocation and runtime cleanup.
{
  let harness;
  harness = createHarness({
    invalidateWindow(reason) {
      harness.calls.push(['window', reason]);
      return Object.freeze({ ok: false, code: 'window_invalidation_failed' });
    },
    clearCoordinator() {
      const service = harness.getService();
      service.requestCancellation(JOB_ID, REASON);
      service.confirmExecutionCleanup(cleanupProof());
      harness.calls.push(['coordinator']);
      return Object.freeze({ ok: true, cleared: 1 });
    },
  });
  const result = harness.service.clear(REASON);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'window_invalidation_failed');
  assert.strictEqual(harness.calls.some(([type]) => type === 'coordinator'), true);
  assert.strictEqual(harness.calls.some(([type]) => type === 'runtime'), true);
  assert.strictEqual(harness.receipts.length, 0);
  assert.deepStrictEqual(harness.failures, [{
    jobId: JOB_ID,
    reason: 'window_invalidation_failed',
  }]);
}

// A failed global gate records cleanup failure and never persists a receipt.
{
  let harness;
  let runtimeClears = 0;
  harness = createHarness({
    clearCoordinator() {
      const service = harness.getService();
      service.requestCancellation(JOB_ID, REASON);
      service.confirmExecutionCleanup(cleanupProof());
      return Object.freeze({ ok: true, cleared: 1 });
    },
    clearDeleteRuntime() {
      runtimeClears += 1;
      harness.calls.push(['runtime']);
      return runtimeClears === 1
        ? Object.freeze({ ok: false, code: 'runtime_clear_failed' })
        : Object.freeze({ ok: true });
    },
  });
  const result = harness.service.clear(REASON);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'runtime_clear_failed');
  assert.strictEqual(harness.receipts.length, 0);
  assert.deepStrictEqual(harness.failures, [{
    jobId: JOB_ID,
    reason: 'runtime_clear_failed',
  }]);
  assert.strictEqual(harness.service.diagnostics().unresolvedCleanupFailures, 1);
  const laterClear = harness.service.clear('renderer_destroyed');
  assert.strictEqual(laterClear.ok, false);
  assert.strictEqual(laterClear.code, 'unresolved_cleanup_failure');
  assert.strictEqual(
    harness.service.diagnostics().unresolvedCleanupFailures,
    1,
    'a later successful clear must not erase an unresolved cleanup failure'
  );
}

// The fail-closed latch survives failure to persist execution_cleanup_failed itself.
{
  let harness;
  harness = createHarness({
    clearCoordinator() {
      const service = harness.getService();
      service.requestCancellation(JOB_ID, REASON);
      service.confirmExecutionCleanup(cleanupProof());
      return Object.freeze({ ok: true, cleared: 1 });
    },
    clearDeleteRuntime() {
      return Object.freeze({ ok: false, code: 'runtime_clear_failed' });
    },
    markExecutionCleanupFailed() {
      return Object.freeze({
        ok: false,
        code: 'cleanup_failure_persistence_failed',
      });
    },
  });
  const result = harness.service.clear(REASON);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'runtime_clear_failed');
  const diagnostics = harness.service.diagnostics();
  assert.strictEqual(diagnostics.failedJobs, 0);
  assert.strictEqual(diagnostics.unresolvedCleanupFailures, 1);
}

// A continued attempt that is still draining waits for another new proof.
{
  const secondJobId = 'job-runtime-lifecycle-clear-2';
  let coordinatorCalls = 0;
  let harness;
  harness = createHarness({
    clearCoordinator() {
      coordinatorCalls += 1;
      if (coordinatorCalls === 1) {
        const service = harness.getService();
        service.requestCancellation(JOB_ID, REASON);
        service.requestCancellation(secondJobId, REASON);
      }
      return coordinatorCalls < 3
        ? Object.freeze({ ok: false, code: 'execution_draining' })
        : Object.freeze({ ok: true, cleared: 2 });
    },
  });

  harness.service.clear(REASON);
  harness.service.confirmExecutionCleanup(cleanupProof(JOB_ID));
  assert.strictEqual(harness.continuations.length, 1);
  harness.continuations.shift()();
  assert.strictEqual(coordinatorCalls, 2);
  assert.strictEqual(harness.continuations.length, 0);
  assert.strictEqual(harness.calls.some(([type]) => type === 'runtime'), false);

  harness.service.confirmExecutionCleanup(cleanupProof(secondJobId));
  assert.strictEqual(harness.continuations.length, 1);
  harness.continuations.shift()();
  assert.strictEqual(coordinatorCalls, 3);
  assert.strictEqual(harness.receipts.length, 2);
}

// Reentrant clear refreshes the perimeter but does not rerun settled global gates while awaiting proofs.
{
  let coordinatorCalls = 0;
  let harness;
  harness = createHarness({
    clearCoordinator() {
      coordinatorCalls += 1;
      if (coordinatorCalls === 1) {
        harness.getService().requestCancellation(JOB_ID, REASON);
      }
      return Object.freeze({ ok: true, cleared: 1 });
    },
  });
  const awaiting = harness.service.clear(REASON);
  assert.strictEqual(awaiting.status, 'deferred');
  assert.strictEqual(awaiting.code, 'awaiting_execution_cleanup_proofs');

  const reentrant = harness.service.clear('renderer_process_gone');
  assert.strictEqual(reentrant.ok, true);
  assert.strictEqual(reentrant.status, 'deferred');
  assert.strictEqual(coordinatorCalls, 1);
  assert.strictEqual(
    harness.calls.filter(([type]) => type === 'runtime').length,
    1
  );
  assert.deepStrictEqual(
    harness.calls.filter(([type]) => type === 'window'),
    [['window', REASON], ['window', 'renderer_process_gone']]
  );
  assert.deepStrictEqual(
    harness.calls.filter(([type]) => type === 'peripheral'),
    [['peripheral', REASON], ['peripheral', 'renderer_process_gone']]
  );
  assert.strictEqual(harness.receipts.length, 0);

  harness.service.confirmExecutionCleanup(cleanupProof());
  assert.strictEqual(harness.receipts.length, 1);
}

// A perimeter failure discovered by reentry fails closed without rerunning coordinator/runtime.
{
  let invalidations = 0;
  let coordinatorCalls = 0;
  let harness;
  harness = createHarness({
    invalidateWindow(reason) {
      invalidations += 1;
      harness.calls.push(['window', reason]);
      return invalidations === 1
        ? Object.freeze({ ok: true })
        : Object.freeze({ ok: false, code: 'window_revalidation_failed' });
    },
    clearCoordinator() {
      coordinatorCalls += 1;
      harness.getService().requestCancellation(JOB_ID, REASON);
      return Object.freeze({ ok: true, cleared: 1 });
    },
  });
  harness.service.clear(REASON);
  const failed = harness.service.clear('renderer_destroyed');
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.code, 'window_revalidation_failed');
  assert.strictEqual(coordinatorCalls, 1);
  assert.strictEqual(
    harness.calls.filter(([type]) => type === 'runtime').length,
    1
  );
  assert.strictEqual(harness.receipts.length, 0);
  assert.deepStrictEqual(harness.failures, [{
    jobId: JOB_ID,
    reason: 'window_revalidation_failed',
  }]);
}

// Reentry during draining performs one bounded coordinator attempt after refreshing the perimeter.
{
  let coordinatorCalls = 0;
  let harness;
  harness = createHarness({
    clearCoordinator() {
      coordinatorCalls += 1;
      if (coordinatorCalls === 1) {
        harness.getService().requestCancellation(JOB_ID, REASON);
      }
      return coordinatorCalls < 3
        ? Object.freeze({ ok: false, code: 'execution_draining' })
        : Object.freeze({ ok: true, cleared: 1 });
    },
  });
  harness.service.clear(REASON);
  const bounded = harness.service.clear('renderer_process_gone');
  assert.strictEqual(bounded.ok, true);
  assert.strictEqual(bounded.status, 'deferred');
  assert.strictEqual(coordinatorCalls, 2);
  assert.strictEqual(harness.continuations.length, 0);
  assert.strictEqual(harness.calls.some(([type]) => type === 'runtime'), false);

  harness.service.confirmExecutionCleanup(cleanupProof());
  assert.strictEqual(harness.continuations.length, 1);
  harness.continuations.shift()();
  assert.strictEqual(coordinatorCalls, 3);
  assert.strictEqual(harness.receipts.length, 1);
}

// A bounded reentry supersedes an already queued continuation without replaying cleanup.
{
  let coordinatorCalls = 0;
  let harness;
  harness = createHarness({
    clearCoordinator() {
      coordinatorCalls += 1;
      if (coordinatorCalls === 1) {
        harness.getService().requestCancellation(JOB_ID, REASON);
        return Object.freeze({ ok: false, code: 'execution_draining' });
      }
      return Object.freeze({ ok: true, cleared: 1 });
    },
  });
  harness.service.clear(REASON);
  harness.service.confirmExecutionCleanup(cleanupProof());
  assert.strictEqual(harness.continuations.length, 1);
  const staleContinuation = harness.continuations.shift();

  const completed = harness.service.clear('window_closed');
  assert.strictEqual(completed.ok, true);
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(coordinatorCalls, 2);
  assert.strictEqual(harness.receipts.length, 1);

  const staleReplay = staleContinuation();
  assert.strictEqual(staleReplay.ok, true);
  assert.strictEqual(staleReplay.idempotent, true);
  assert.strictEqual(coordinatorCalls, 2);
  assert.strictEqual(harness.receipts.length, 1);
}

// Outside a lifecycle session, an exact proof finalizes immediately.
{
  const harness = createHarness();
  const result = harness.service.confirmExecutionCleanup(cleanupProof());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(harness.receipts.length, 1);
  assert.deepStrictEqual(harness.calls, [['receipt', JOB_ID]]);
}

// Exact proof validation rejects incomplete, accessor-backed, and extra-key payloads.
for (const invalid of [
  { ...cleanupProof(), rootReleased: false },
  { ...cleanupProof(), extra: true },
  Object.defineProperty({}, 'jobId', { enumerable: true, get: () => JOB_ID }),
]) {
  const harness = createHarness();
  const result = harness.service.confirmExecutionCleanup(invalid);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'execution_cleanup_proof_invalid');
  assert.strictEqual(harness.receipts.length, 0);
}

// Explicit cleanup failure is idempotent inside a lifecycle session.
{
  let harness;
  harness = createHarness({
    clearCoordinator() {
      harness.getService().requestCancellation(JOB_ID, REASON);
      return Object.freeze({ ok: false, code: 'execution_draining' });
    },
  });
  harness.service.clear(REASON);
  assert.strictEqual(harness.continuations.length, 0);
  const failure = Object.freeze({
    jobId: JOB_ID,
    terminalStatus: 'cancelled',
    reason: 'authority_cleanup_failed',
  });
  assert.strictEqual(harness.service.failExecutionCleanup(failure).ok, true);
  assert.strictEqual(harness.continuations.length, 1);
  const replay = harness.service.failExecutionCleanup(failure);
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.idempotent, true);
  assert.strictEqual(harness.failures.length, 1);
  assert.strictEqual(harness.receipts.length, 0);
  assert.strictEqual(harness.service.diagnostics().unresolvedCleanupFailures, 1);
}

// Non-cancelled terminal proofs are drain-only signals during lifecycle draining.
for (const terminalStatus of ['completed', 'failed', 'blocked', 'runtime_interrupted']) {
  let coordinatorCalls = 0;
  let harness;
  harness = createHarness({
    clearCoordinator() {
      coordinatorCalls += 1;
      return coordinatorCalls === 1
        ? Object.freeze({ ok: false, code: 'execution_draining' })
        : Object.freeze({ ok: true, cleared: 1 });
    },
  });
  harness.service.clear(REASON);
  const proof = cleanupProof(JOB_ID, terminalStatus);
  const accepted = harness.service.confirmExecutionCleanup(proof);
  assert.strictEqual(accepted.ok, true);
  assert.strictEqual(accepted.status, 'accepted');
  assert.strictEqual(harness.continuations.length, 1);
  assert.strictEqual(harness.receipts.length, 0);
  assert.strictEqual(
    harness.calls.some(([type]) => type === 'request'),
    false
  );

  const replay = harness.service.confirmExecutionCleanup(proof);
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.idempotent, true);
  assert.strictEqual(harness.continuations.length, 1);

  harness.continuations.shift()();
  assert.strictEqual(coordinatorCalls, 2);
  assert.strictEqual(harness.receipts.length, 0);
}

// Outside lifecycle, drain-only proofs are accepted idempotently without receipts.
for (const terminalStatus of ['completed', 'failed', 'blocked', 'runtime_interrupted']) {
  const harness = createHarness();
  const proof = cleanupProof(JOB_ID, terminalStatus);
  const accepted = harness.service.confirmExecutionCleanup(proof);
  assert.strictEqual(accepted.ok, true);
  assert.strictEqual(accepted.status, 'accepted');
  assert.strictEqual(accepted.idempotent, false);
  const replay = harness.service.confirmExecutionCleanup(proof);
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.idempotent, true);
  assert.strictEqual(harness.receipts.length, 0);
  const lateCancellation = harness.service.requestCancellation(JOB_ID, REASON);
  assert.strictEqual(lateCancellation.ok, false);
  assert.strictEqual(lateCancellation.code, 'job_already_settled');
  assert.strictEqual(
    harness.calls.some(([type]) => type === 'request'),
    false
  );
}

// A non-cancelled terminal failure poisons cleanup without overwriting durable job state.
{
  let coordinatorCalls = 0;
  let harness;
  harness = createHarness({
    clearCoordinator() {
      coordinatorCalls += 1;
      return Object.freeze({ ok: false, code: 'execution_draining' });
    },
  });
  harness.service.clear(REASON);
  const failure = Object.freeze({
    jobId: JOB_ID,
    terminalStatus: 'failed',
    reason: 'authority_cleanup_failed',
  });
  const accepted = harness.service.failExecutionCleanup(failure);
  assert.strictEqual(accepted.ok, true);
  assert.strictEqual(harness.failures.length, 0);
  assert.strictEqual(harness.continuations.length, 1);
  assert.strictEqual(harness.service.diagnostics().unresolvedCleanupFailures, 1);

  const replay = harness.service.failExecutionCleanup(failure);
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.idempotent, true);
  assert.strictEqual(harness.failures.length, 0);
  assert.strictEqual(harness.continuations.length, 1);
  assert.strictEqual(harness.service.diagnostics().unresolvedCleanupFailures, 1);
}

// The same non-cancelled failure outside lifecycle only arms the latch.
{
  const harness = createHarness();
  const result = harness.service.failExecutionCleanup(Object.freeze({
    jobId: JOB_ID,
    terminalStatus: 'completed',
    reason: 'authority_cleanup_failed',
  }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(harness.failures.length, 0);
  assert.strictEqual(harness.service.diagnostics().unresolvedCleanupFailures, 1);
}

// Successful cancellation receipts are durable and idempotent, so their
// in-memory replay cache is bounded without duplicating the external effect
// after FIFO eviction.
{
  const durableReceipts = new Set();
  let receiptCalls = 0;
  let durableReceiptWrites = 0;
  const harness = createHarness({
    markCancelledAfterCleanup(jobId, receipt) {
      receiptCalls += 1;
      assert.strictEqual(receipt.jobId, jobId);
      const alreadyPersisted = durableReceipts.has(jobId);
      if (!alreadyPersisted) durableReceiptWrites += 1;
      durableReceipts.add(jobId);
      return Object.freeze({ ok: true, idempotent: alreadyPersisted });
    },
  });
  const initialDiagnostics = harness.service.diagnostics();
  const limit = initialDiagnostics.benignOutcomeCacheLimit;
  assert.strictEqual(Number.isSafeInteger(limit), true);
  assert.strictEqual(limit >= 1024, true);
  const total = limit + 1;

  for (let index = 0; index < total; index += 1) {
    const result = harness.service.confirmExecutionCleanup(
      cleanupProof(`job-bounded-finalized-${index}`)
    );
    assert.strictEqual(result.ok, true);
  }

  const saturated = harness.service.diagnostics();
  assert.strictEqual(saturated.finalizedJobs, limit);
  assert.strictEqual(saturated.finalizedJobEvictions, 1);
  assert.strictEqual(saturated.drainOnlyOutcomes, 0);
  assert.strictEqual(receiptCalls, total);
  assert.strictEqual(durableReceiptWrites, total);

  const evictedReplay = harness.service.confirmExecutionCleanup(
    cleanupProof('job-bounded-finalized-0')
  );
  assert.strictEqual(evictedReplay.ok, true);
  assert.strictEqual(evictedReplay.idempotent, false);
  assert.strictEqual(receiptCalls, total + 1);
  assert.strictEqual(
    durableReceiptWrites,
    total,
    'the idempotent receipt dependency must not duplicate durable state'
  );
  assert.strictEqual(harness.service.diagnostics().finalizedJobs, limit);
  assert.strictEqual(harness.service.diagnostics().finalizedJobEvictions, 2);

  const cachedReplay = harness.service.confirmExecutionCleanup(
    cleanupProof('job-bounded-finalized-0')
  );
  assert.strictEqual(cachedReplay.ok, true);
  assert.strictEqual(cachedReplay.idempotent, true);
  assert.strictEqual(receiptCalls, total + 1);
}

// Drain-only proofs have no persistence side effect. Evicting and observing
// one again is therefore safe while the cache remains strictly bounded.
{
  let externalEffects = 0;
  const countEffect = () => {
    externalEffects += 1;
    return Object.freeze({ ok: true });
  };
  const harness = createHarness({
    markCancellationRequested: countEffect,
    markCancelledAfterCleanup: countEffect,
    markExecutionCleanupFailed: countEffect,
  });
  const limit = harness.service.diagnostics().benignOutcomeCacheLimit;
  const total = limit + 1;

  for (let index = 0; index < total; index += 1) {
    const result = harness.service.confirmExecutionCleanup(
      cleanupProof(`job-bounded-drain-proof-${index}`, 'completed')
    );
    assert.strictEqual(result.ok, true);
  }

  const saturated = harness.service.diagnostics();
  assert.strictEqual(saturated.drainOnlyOutcomes, limit);
  assert.strictEqual(saturated.drainOnlyOutcomeEvictions, 1);
  assert.strictEqual(externalEffects, 0);

  const evictedReplay = harness.service.confirmExecutionCleanup(
    cleanupProof('job-bounded-drain-proof-0', 'completed')
  );
  assert.strictEqual(evictedReplay.ok, true);
  assert.strictEqual(evictedReplay.idempotent, false);
  assert.strictEqual(externalEffects, 0);
  assert.strictEqual(harness.service.diagnostics().drainOnlyOutcomes, limit);
  assert.strictEqual(harness.service.diagnostics().drainOnlyOutcomeEvictions, 2);

  const cachedReplay = harness.service.confirmExecutionCleanup(
    cleanupProof('job-bounded-drain-proof-0', 'completed')
  );
  assert.strictEqual(cachedReplay.ok, true);
  assert.strictEqual(cachedReplay.idempotent, true);
  assert.strictEqual(externalEffects, 0);
}

// A bounded drain-only outcome cache must never bound or erase the unresolved
// failure latch. Even failures whose descriptive cache entry was evicted keep
// all future lifecycle clears fail-closed.
{
  let failurePersistenceCalls = 0;
  const harness = createHarness({
    markExecutionCleanupFailed() {
      failurePersistenceCalls += 1;
      return Object.freeze({ ok: true });
    },
  });
  const limit = harness.service.diagnostics().benignOutcomeCacheLimit;
  const total = limit + 1;

  for (let index = 0; index < total; index += 1) {
    const result = harness.service.failExecutionCleanup(Object.freeze({
      jobId: `job-bounded-drain-failure-${index}`,
      terminalStatus: 'failed',
      reason: 'authority_cleanup_failed',
    }));
    assert.strictEqual(result.ok, true);
  }

  const saturated = harness.service.diagnostics();
  assert.strictEqual(saturated.drainOnlyOutcomes, limit);
  assert.strictEqual(saturated.drainOnlyOutcomeEvictions, 1);
  assert.strictEqual(saturated.failedJobs, 0);
  assert.strictEqual(saturated.unresolvedCleanupFailures, total);
  assert.strictEqual(failurePersistenceCalls, 0);

  const replay = harness.service.failExecutionCleanup(Object.freeze({
    jobId: 'job-bounded-drain-failure-0',
    terminalStatus: 'failed',
    reason: 'authority_cleanup_failed',
  }));
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.idempotent, false);
  assert.strictEqual(
    harness.service.diagnostics().unresolvedCleanupFailures,
    total
  );
  assert.strictEqual(failurePersistenceCalls, 0);

  const blocked = harness.service.clear('window_reloaded');
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, 'unresolved_cleanup_failure');
  assert.strictEqual(
    harness.service.diagnostics().unresolvedCleanupFailures,
    total
  );
}

console.log('assistant runtime lifecycle clear service tests passed');
