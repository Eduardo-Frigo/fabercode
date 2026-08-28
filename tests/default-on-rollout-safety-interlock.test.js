'use strict';

const assert = require('assert');

const {
  DEFAULT_ON_ROLLOUT_SAFETY_EVENTS,
  DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
  DEFAULT_ON_ROLLOUT_SAFETY_TRIP_RECEIPT_SCHEMA_VERSION,
  classifyDefaultOnCanarySafetyEvent,
  createDefaultOnRolloutSafetyInterlock,
} = require('../main/agent_runtime/default_on_rollout_safety_interlock');

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function registration(jobId, digestCharacter = 'a') {
  return Object.freeze({
    jobId,
    projectId: 'project-safety-a',
    canonicalRootPath: '/workspace/project-safety-a',
    policyDigest: digest(digestCharacter),
  });
}

function tripInput(overrides = {}) {
  return Object.freeze({
    event: DEFAULT_ON_ROLLOUT_SAFETY_EVENTS.ROOT_ESCAPE,
    sourceJobId: 'job-safety-a',
    evidenceDigest: digest('e'),
    ...overrides,
  });
}

function createFixture({ failures = false, deferredClose = false } = {}) {
  const events = [];
  let releaseClose = null;
  let closeCalls = 0;
  const interlock = createDefaultOnRolloutSafetyInterlock({
    cancelJob(input) {
      events.push(Object.freeze({ type: 'cancel', input }));
      if (failures && input.jobId === 'job-safety-a') {
        throw new Error('private cancellation failure');
      }
      return Object.freeze({
        ok: true,
        revoked: input.jobId === 'job-safety-b',
        deferred: input.jobId !== 'job-safety-b',
      });
    },
    closeBrowserJob(input) {
      events.push(Object.freeze({ type: 'browser', input }));
      return failures
        ? Object.freeze({ ok: false, closed: 0 })
        : Object.freeze({ ok: true, closed: 1 });
    },
    closeRuntime() {
      closeCalls += 1;
      events.push(Object.freeze({ type: 'runtime' }));
      if (failures) return Promise.reject(new Error('private runtime failure'));
      if (deferredClose) {
        return new Promise((resolve) => {
          releaseClose = () => resolve(Object.freeze({
            closed: true,
            drained: true,
            clientClosed: true,
          }));
        });
      }
      return Promise.resolve(Object.freeze({
        closed: true,
        drained: true,
        clientClosed: true,
      }));
    },
    audit(type, payload) {
      events.push(Object.freeze({ type: 'audit', auditType: type, payload }));
      return undefined;
    },
  });
  return {
    events,
    interlock,
    get closeCalls() { return closeCalls; },
    releaseClose() {
      if (!releaseClose) throw new Error('close was not started');
      releaseClose();
    },
  };
}

function testConstructionAndRegistrationAreExactAndFailClosed() {
  const fixture = createFixture();
  assert.strictEqual(
    DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
    'default-on-rollout-safety-interlock.v1'
  );
  assert.strictEqual(
    DEFAULT_ON_ROLLOUT_SAFETY_TRIP_RECEIPT_SCHEMA_VERSION,
    'default-on-rollout-safety-trip-receipt.v1'
  );
  assert.deepStrictEqual(Reflect.ownKeys(fixture.interlock), [
    'version', 'begin', 'finish', 'trip', 'diagnostics',
  ]);
  assert.strictEqual(Object.isFrozen(fixture.interlock), true);
  assert.strictEqual(Object.hasOwn(fixture.interlock, 'reset'), false);

  const first = fixture.interlock.begin(registration('job-safety-a'));
  const replay = fixture.interlock.begin(registration('job-safety-a'));
  assert.deepStrictEqual(first, {
    ok: true,
    allowed: true,
    idempotent: false,
    jobId: 'job-safety-a',
    reason: 'registered',
  });
  assert.deepStrictEqual(replay, {
    ...first,
    idempotent: true,
    reason: 'already_registered',
  });
  assert.throws(
    () => fixture.interlock.begin(registration('job-safety-a', 'b')),
    /conflict/i
  );
  assert.strictEqual(fixture.interlock.diagnostics().activeJobs, 1);
  assert.deepStrictEqual(
    fixture.interlock.finish(Object.freeze({
      jobId: 'job-safety-a',
      policyDigest: digest('a'),
    })),
    Object.freeze({ ok: true, finished: true, jobId: 'job-safety-a' })
  );
}

function testOnlyConfirmedUnsafeCanaryFailuresTripTheRollout() {
  assert.strictEqual(
    classifyDefaultOnCanarySafetyEvent(
      'CANARY_TRANSACTIONAL_STAGING_PROMOTION_AMBIGUOUS'
    ),
    DEFAULT_ON_ROLLOUT_SAFETY_EVENTS.USER_CHANGE_OVERWRITE
  );
  assert.strictEqual(
    classifyDefaultOnCanarySafetyEvent(
      'CANARY_TRANSACTIONAL_STAGING_REVERT_FAILED'
    ),
    DEFAULT_ON_ROLLOUT_SAFETY_EVENTS.USER_CHANGE_OVERWRITE
  );
  for (const ordinaryFailure of [
    'CANARY_TRANSACTIONAL_STAGING_OPEN_FAILED',
    'CANARY_TRANSACTIONAL_STAGING_ROLLOUT_INTERRUPTED',
    'CANARY_EDIT_RUNNER_CANARY_EXECUTION_FAILED',
    'private failure',
    null,
  ]) {
    assert.strictEqual(
      classifyDefaultOnCanarySafetyEvent(ordinaryFailure),
      null
    );
  }
}

async function testTripBlocksNewJobsBeforeCleanupAndCancelsExactActiveJobs() {
  const fixture = createFixture({ deferredClose: true });
  fixture.interlock.begin(registration('job-safety-a', 'a'));
  fixture.interlock.begin(registration('job-safety-b', 'b'));

  const pending = fixture.interlock.trip(tripInput());
  assert.strictEqual(fixture.interlock.diagnostics().state, 'tripped');
  assert.deepStrictEqual(
    fixture.interlock.begin(registration('job-safety-c', 'c')),
    Object.freeze({
      ok: true,
      allowed: false,
      idempotent: false,
      jobId: 'job-safety-c',
      reason: 'interlock_tripped',
    })
  );
  assert.deepStrictEqual(
    fixture.events.filter((event) => event.type !== 'audit').map((event) => event.type),
    ['cancel', 'browser', 'cancel', 'browser', 'runtime']
  );

  fixture.releaseClose();
  const receipt = await pending;
  assert.deepStrictEqual(receipt, {
    schemaVersion: DEFAULT_ON_ROLLOUT_SAFETY_TRIP_RECEIPT_SCHEMA_VERSION,
    ok: true,
    tripped: true,
    event: DEFAULT_ON_ROLLOUT_SAFETY_EVENTS.ROOT_ESCAPE,
    evidenceDigest: digest('e'),
    activeJobs: 2,
    cancelledJobs: 2,
    browserJobsClosed: 2,
    runtimeClosed: true,
    restartMode: 'legacy_new_job',
    broadResetUsed: false,
  });
  assert.strictEqual(Object.isFrozen(receipt), true);
  assert.strictEqual(fixture.closeCalls, 1);
  assert.strictEqual(
    fixture.events.filter((event) => event.type === 'cancel')[0]
      .input.reason,
    'default_on_rollout_safety_trip'
  );
  assert.deepStrictEqual(
    fixture.events.filter((event) => event.type === 'browser')[0].input,
    Object.freeze({ jobId: 'job-safety-a' })
  );

  const replay = await fixture.interlock.trip(tripInput({
    event: DEFAULT_ON_ROLLOUT_SAFETY_EVENTS.SECRET_EXPOSURE,
    evidenceDigest: digest('f'),
  }));
  assert.strictEqual(replay, receipt);
  assert.strictEqual(fixture.closeCalls, 1);
}

async function testCleanupFailureNeverReopensTheInterlock() {
  const fixture = createFixture({ failures: true });
  fixture.interlock.begin(registration('job-safety-a'));
  const receipt = await fixture.interlock.trip(tripInput());
  assert.strictEqual(receipt.ok, false);
  assert.strictEqual(receipt.tripped, true);
  assert.strictEqual(receipt.cancelledJobs, 0);
  assert.strictEqual(receipt.browserJobsClosed, 0);
  assert.strictEqual(receipt.runtimeClosed, false);
  assert.strictEqual(fixture.interlock.diagnostics().state, 'tripped');
  assert.strictEqual(
    fixture.interlock.begin(registration('job-safety-b', 'b')).allowed,
    false
  );
}

async function testUnknownSafetyEventIsRejectedWithoutTripping() {
  const fixture = createFixture();
  await assert.rejects(
    fixture.interlock.trip(tripInput({ event: 'unknown_safety_event' })),
    /invalid safety trip input/i
  );
  assert.strictEqual(fixture.interlock.diagnostics().state, 'armed');
  assert.strictEqual(fixture.closeCalls, 0);
}

async function main() {
  testConstructionAndRegistrationAreExactAndFailClosed();
  testOnlyConfirmedUnsafeCanaryFailuresTripTheRollout();
  await testTripBlocksNewJobsBeforeCleanupAndCancelsExactActiveJobs();
  await testCleanupFailureNeverReopensTheInterlock();
  await testUnknownSafetyEventIsRejectedWithoutTripping();
  console.log('default-on-rollout-safety-interlock.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
