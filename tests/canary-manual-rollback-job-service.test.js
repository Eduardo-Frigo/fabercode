'use strict';

const assert = require('assert');

const {
  CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS,
  CANARY_MANUAL_ROLLBACK_JOB_SERVICE_VERSION,
  createCanaryManualRollbackJobService,
} = require('../main/services/canary_manual_rollback_job_service');

const JOB_ID = 'job-canary-manual-rollback-1';
const PROJECT_ID = 'project-canary-manual-rollback-1';
const PROMOTION_ID = 'promotion-canary-manual-rollback-1';
const RECONCILIATION_ID = `rollback-${'a'.repeat(64)}`;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      assertDeepFrozen(descriptor.value, seen);
    }
  }
}

function completedJob({ rolledBack = false, canary = true } = {}) {
  const job = {
    id: JOB_ID,
    projectId: PROJECT_ID,
    status: 'completed',
    phase: 'done',
    events: [{
      type: 'job.completed',
      payload: canary
        ? { canary: true, canaryPromotionId: PROMOTION_ID }
        : { source: 'legacy' },
    }],
  };
  if (rolledBack) {
    job.canaryRollback = {
      status: 'completed',
      promotionId: PROMOTION_ID,
      reconciliationId: RECONCILIATION_ID,
      sourceRestored: true,
    };
  }
  return deepFreeze(job);
}

function rollbackReceipt(overrides = {}) {
  return deepFreeze({
    schemaVersion: 'canary-manual-rollback-receipt.v1',
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    promotionId: PROMOTION_ID,
    rolloutStage: 'internal',
    reconciliationId: RECONCILIATION_ID,
    revertReceipt: {
      promotionId: PROMOTION_ID,
      inversePatchApplied: true,
      sourceRestored: true,
    },
    ...overrides,
  });
}

function manualRollbackPort({ receipt = rollbackReceipt(), reject = null } = {}) {
  const calls = [];
  return {
    calls,
    port: Object.freeze({
      version: 'canary-manual-rollback-service.v1',
      rollback(input) {
        calls.push(input);
        return reject ? Promise.reject(reject) : Promise.resolve(receipt);
      },
      diagnostics() {
        return Object.freeze({
          version: 'canary-manual-rollback-service.v1',
        });
      },
    }),
  };
}

function createFixture({
  initialJob = completedJob(),
  manualPort = manualRollbackPort(),
  markerFailure = null,
  runtimeAvailable = true,
} = {}) {
  let job = initialJob;
  const calls = {
    audit: [],
    getJob: 0,
    getManualRollback: 0,
    mark: [],
  };
  const service = createCanaryManualRollbackJobService({
    getAuthorizedJobById(jobId) {
      calls.getJob += 1;
      return jobId === JOB_ID
        ? Object.freeze({ ok: true, job })
        : Object.freeze({ ok: false, code: 'job_not_found' });
    },
    getManualRollback() {
      calls.getManualRollback += 1;
      return runtimeAvailable ? manualPort.port : null;
    },
    markJobCanaryRolledBack(jobId, completion) {
      calls.mark.push(Object.freeze({ jobId, completion }));
      if (markerFailure) return markerFailure;
      job = deepFreeze({
        ...job,
        canaryRollback: {
          status: 'completed',
          ...completion,
        },
      });
      return Object.freeze({ ok: true, job, idempotent: false });
    },
    audit(type, payload) {
      calls.audit.push(Object.freeze({ type, payload }));
      return undefined;
    },
  });
  return { calls, manualPort, service };
}

async function testVerifiedRollbackByJobIdPersistsAReplaySafeReceipt() {
  const fixture = createFixture();
  assert.strictEqual(
    CANARY_MANUAL_ROLLBACK_JOB_SERVICE_VERSION,
    'canary-manual-rollback-job-service.v1'
  );
  assert.deepStrictEqual(Reflect.ownKeys(fixture.service), [
    'version', 'rollback', 'diagnostics',
  ]);
  assertDeepFrozen(fixture.service);

  const result = await fixture.service.rollback(Object.freeze({ jobId: JOB_ID }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.idempotent, false);
  assert.deepStrictEqual(result.rollback, {
    promotionId: PROMOTION_ID,
    reconciliationId: RECONCILIATION_ID,
    sourceRestored: true,
  });
  assert.strictEqual(result.job.canaryRollback.status, 'completed');
  assertDeepFrozen(result);
  assert.strictEqual(fixture.manualPort.calls.length, 1);
  assert.deepStrictEqual(fixture.manualPort.calls[0], {
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    promotionId: PROMOTION_ID,
    reason: 'manual_user_rollback',
  });
  assertDeepFrozen(fixture.manualPort.calls[0]);
  assert.strictEqual(fixture.calls.mark.length, 1);
  assert.deepStrictEqual(fixture.calls.mark[0].completion, result.rollback);
  assert.strictEqual(fixture.calls.audit.at(-1).type,
    'assistant.canary_manual_rollback_completed');
}

async function testPersistedCompletionIsIdempotentWithoutARuntime() {
  const fixture = createFixture({
    initialJob: completedJob({ rolledBack: true }),
    runtimeAvailable: false,
  });
  const result = await fixture.service.rollback(Object.freeze({ jobId: JOB_ID }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.idempotent, true);
  assert.strictEqual(fixture.calls.getManualRollback, 0);
  assert.strictEqual(fixture.calls.mark.length, 0);
  assert.strictEqual(fixture.manualPort.calls.length, 0);
}

async function testUnavailableInvalidAndFailedRollbackPathsFailClosed() {
  const nonCanary = createFixture({ initialJob: completedJob({ canary: false }) });
  assert.strictEqual(
    (await nonCanary.service.rollback(Object.freeze({ jobId: JOB_ID }))).code,
    CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.ROLLBACK_UNAVAILABLE
  );

  const noRuntime = createFixture({ runtimeAvailable: false });
  assert.strictEqual(
    (await noRuntime.service.rollback(Object.freeze({ jobId: JOB_ID }))).code,
    CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.RUNTIME_UNAVAILABLE
  );

  const rejected = createFixture({
    manualPort: manualRollbackPort({ reject: new Error('private failure') }),
  });
  assert.strictEqual(
    (await rejected.service.rollback(Object.freeze({ jobId: JOB_ID }))).code,
    CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.ROLLBACK_FAILED
  );

  const persistence = createFixture({
    markerFailure: Object.freeze({ ok: false, code: 'jobs_storage_unhealthy' }),
  });
  assert.strictEqual(
    (await persistence.service.rollback(Object.freeze({ jobId: JOB_ID }))).code,
    CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.STATE_PERSISTENCE_FAILED
  );

  let traps = 0;
  const hostile = new Proxy({}, {
    ownKeys() { traps += 1; throw new Error('must not execute'); },
    get() { traps += 1; throw new Error('must not execute'); },
  });
  assert.strictEqual(
    (await noRuntime.service.rollback(hostile)).code,
    CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.INVALID_INPUT
  );
  assert.strictEqual(traps, 0);
}

async function main() {
  await testVerifiedRollbackByJobIdPersistsAReplaySafeReceipt();
  await testPersistedCompletionIsIdempotentWithoutARuntime();
  await testUnavailableInvalidAndFailedRollbackPathsFailClosed();
  console.log('canary-manual-rollback-job-service.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
