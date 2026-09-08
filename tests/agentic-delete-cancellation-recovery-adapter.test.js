'use strict';

const assert = require('assert');

const {
  createAgenticDeleteCancellationRecoveryAdapter,
} = require('../main/services/agentic_delete_cancellation_recovery_adapter');

const JOB_ID = 'job-cancellation-recovery-adapter';

function job({ status = 'running', phase = 'cancelling' } = {}) {
  return Object.freeze({ id: JOB_ID, status, phase });
}

function recoveryResult(overrides = {}) {
  return Object.freeze({
    schemaVersion: 'agentic-delete-recovery-result.v1',
    ok: true,
    status: 'completed',
    disposition: 'rollback',
    errorCode: null,
    idempotent: false,
    ...overrides,
  });
}

const canonicalRecoveryFailed = Object.freeze({
  schemaVersion: 'agentic-delete-recovery-result.v1',
  ok: false,
  status: 'failed',
  disposition: 'rollback',
  errorCode: 'RECOVERY_FAILED',
  idempotent: false,
});

assert.throws(
  () => createAgenticDeleteCancellationRecoveryAdapter(),
  /options/i
);
for (const missing of [
  'getAuthorizedJobById',
  'recoverJob',
  'markJobCancelledAfterCleanup',
]) {
  const options = {
    getAuthorizedJobById() {},
    recoverJob() {},
    markJobCancelledAfterCleanup() {},
  };
  delete options[missing];
  assert.throws(
    () => createAgenticDeleteCancellationRecoveryAdapter(options),
    new RegExp(missing)
  );
}

// A cancelling job is only finalized after exact rollback success proves cleanup.
{
  const calls = [];
  const recovered = recoveryResult();
  const adapter = createAgenticDeleteCancellationRecoveryAdapter({
    getAuthorizedJobById(jobId) {
      calls.push(['get', jobId]);
      return Object.freeze({ ok: true, job: job() });
    },
    recoverJob(input) {
      assert.strictEqual(Object.isFrozen(input), true);
      assert.deepStrictEqual(input, { jobId: JOB_ID });
      calls.push(['recover', input.jobId]);
      return recovered;
    },
    markJobCancelledAfterCleanup(jobId, receipt) {
      assert.strictEqual(Object.isFrozen(receipt), true);
      assert.deepStrictEqual(Reflect.ownKeys(receipt), [
        'schemaVersion',
        'jobId',
        'cleanupCompleted',
      ]);
      assert.deepStrictEqual(receipt, {
        schemaVersion: 'assistant-job-execution-cleanup-receipt.v1',
        jobId: JOB_ID,
        cleanupCompleted: true,
      });
      calls.push(['confirm', jobId]);
      return Object.freeze({ ok: true });
    },
  });

  assert.strictEqual(Object.isFrozen(adapter), true);
  assert.deepStrictEqual(Reflect.ownKeys(adapter), ['recoverJob']);
  assert.strictEqual(adapter.recoverJob(Object.freeze({ jobId: JOB_ID })), recovered);
  assert.deepStrictEqual(calls, [
    ['get', JOB_ID],
    ['recover', JOB_ID],
    ['confirm', JOB_ID],
  ]);
}

// A persisted cleanup failure is still cancellation recovery and must be confirmed.
{
  let confirmations = 0;
  const recovered = recoveryResult();
  const adapter = createAgenticDeleteCancellationRecoveryAdapter({
    getAuthorizedJobById: () => Object.freeze({
      ok: true,
      job: job({ status: 'failed', phase: 'execution_cleanup_failed' }),
    }),
    recoverJob: () => recovered,
    markJobCancelledAfterCleanup(jobId, receipt) {
      confirmations += 1;
      assert.strictEqual(jobId, JOB_ID);
      assert.deepStrictEqual(receipt, {
        schemaVersion: 'assistant-job-execution-cleanup-receipt.v1',
        jobId: JOB_ID,
        cleanupCompleted: true,
      });
      return Object.freeze({ ok: true });
    },
  });
  assert.strictEqual(adapter.recoverJob(Object.freeze({ jobId: JOB_ID })), recovered);
  assert.strictEqual(confirmations, 1);
}

// A legacy cancelled job without a receipt must be sealed after rollback recovery.
{
  let confirmations = 0;
  const recovered = recoveryResult();
  const adapter = createAgenticDeleteCancellationRecoveryAdapter({
    getAuthorizedJobById: () => Object.freeze({
      ok: true,
      job: job({ status: 'cancelled', phase: 'cancelled' }),
    }),
    recoverJob: () => recovered,
    markJobCancelledAfterCleanup(jobId, receipt) {
      confirmations += 1;
      assert.strictEqual(jobId, JOB_ID);
      assert.deepStrictEqual(receipt, {
        schemaVersion: 'assistant-job-execution-cleanup-receipt.v1',
        jobId: JOB_ID,
        cleanupCompleted: true,
      });
      return Object.freeze({ ok: true });
    },
  });
  assert.strictEqual(adapter.recoverJob(Object.freeze({ jobId: JOB_ID })), recovered);
  assert.strictEqual(confirmations, 1);
}

// A rejected or throwing confirmation cannot leak the prior recovery success.
for (const confirm of [
  () => Object.freeze({ ok: false, code: 'execution_cleanup_not_requested' }),
  () => { throw new Error('confirmation failed'); },
]) {
  let confirmations = 0;
  const adapter = createAgenticDeleteCancellationRecoveryAdapter({
    getAuthorizedJobById: () => Object.freeze({ ok: true, job: job() }),
    recoverJob: () => recoveryResult(),
    markJobCancelledAfterCleanup(jobId, receipt) {
      confirmations += 1;
      assert.strictEqual(jobId, JOB_ID);
      assert.strictEqual(Object.isFrozen(receipt), true);
      return confirm();
    },
  });
  const result = adapter.recoverJob(Object.freeze({ jobId: JOB_ID }));
  assert.strictEqual(Object.isFrozen(result), true);
  assert.deepStrictEqual(result, canonicalRecoveryFailed);
  assert.strictEqual(confirmations, 1);
}

// Failed recovery never confirms cancellation cleanup.
{
  let confirmations = 0;
  const failed = recoveryResult({
    ok: false,
    status: 'failed',
    errorCode: 'RECOVERY_FAILED',
  });
  const adapter = createAgenticDeleteCancellationRecoveryAdapter({
    getAuthorizedJobById: () => Object.freeze({ ok: true, job: job() }),
    recoverJob: () => failed,
    markJobCancelledAfterCleanup() {
      confirmations += 1;
      return Object.freeze({ ok: true });
    },
  });
  assert.strictEqual(adapter.recoverJob(Object.freeze({ jobId: JOB_ID })), failed);
  assert.strictEqual(confirmations, 0);
}

// Jobs outside running/cancelling are forwarded without cancellation confirmation.
{
  let confirmations = 0;
  const forwarded = recoveryResult();
  const adapter = createAgenticDeleteCancellationRecoveryAdapter({
    getAuthorizedJobById: () => Object.freeze({
      ok: true,
      job: job({ status: 'failed', phase: 'execute_failed' }),
    }),
    recoverJob: () => forwarded,
    markJobCancelledAfterCleanup() {
      confirmations += 1;
      return Object.freeze({ ok: true });
    },
  });
  assert.strictEqual(adapter.recoverJob(Object.freeze({ jobId: JOB_ID })), forwarded);
  assert.strictEqual(confirmations, 0);
}

console.log('agentic delete cancellation recovery adapter tests passed');
