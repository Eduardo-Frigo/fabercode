'use strict';

const assert = require('assert');

const { AgentKernel } = require('../main/agent_runtime/agent_kernel');
const {
  HARNESS_OPERATIONS,
  createHarnessResult,
} = require('../main/agent_runtime/harness_contracts');
const {
  createDefaultOnRolloutPolicy,
} = require('../main/agent_runtime/default_on_rollout_policy');
const {
  DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
} = require('../main/agent_runtime/default_on_rollout_safety_interlock');
const {
  createHarnessRouter,
} = require('../main/agent_runtime/harness_router');
const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');

class RecordingKernel extends AgentKernel {
  constructor(events) {
    super({
      id: 'legacy',
      version: 'default-on-legacy.v1',
      capabilities: Object.values(HARNESS_OPERATIONS),
    });
    this.events = events;
    this.calls = [];
  }

  result(operation, request) {
    this.events.push('legacy');
    this.calls.push(request);
    return createHarnessResult({
      requestId: request.requestId,
      operation,
      kernelId: this.id,
      output: { ok: true, route: 'legacy' },
    });
  }

  async plan(request) {
    return this.result(HARNESS_OPERATIONS.PLAN, request);
  }

  async message(request) {
    return this.result(HARNESS_OPERATIONS.MESSAGE, request);
  }

  async execute(request) {
    return this.result(HARNESS_OPERATIONS.EXECUTE, request);
  }
}

function createRunner(events) {
  const calls = [];
  return {
    calls,
    runner: Object.freeze({
      version: 'default-on-runner.v1',
      execute(request) {
        events.push('v2');
        calls.push(request);
        return Promise.resolve(createHarnessResult({
          requestId: request.requestId,
          operation: request.operation,
          kernelId: 'codex-app-server-v2',
          output: { ok: true, route: 'v2' },
        }));
      },
      diagnostics() {
        return Object.freeze({
          version: 'default-on-runner.v1',
          authoritativeKernelId: 'legacy',
          canaryKernelId: 'codex-app-server-v2',
          executions: calls.length,
          activeExecutions: 0,
        });
      },
    }),
  };
}

function readyPolicy() {
  return createDefaultOnRolloutPolicy({
    stableReleaseVersions: Object.freeze(['2.8.0', '2.9.0']),
  });
}

function createFixture({
  persist = null,
  resolveFacts = null,
  safetyAllowed = true,
} = {}) {
  const events = [];
  const checkpoints = [];
  const legacy = new RecordingKernel(events);
  const v2 = createRunner(events);
  let facts = Object.freeze({
    projectPin: null,
    allowlisted: true,
    approvedCohort: true,
  });
  let activeSafetyJobs = 0;
  const safetyInterlock = Object.freeze({
    version: DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
    begin(registration) {
      events.push('begin');
      assert.strictEqual(Object.isFrozen(registration), true);
      assert.deepStrictEqual(Reflect.ownKeys(registration), [
        'jobId', 'projectId', 'canonicalRootPath', 'policyDigest',
      ]);
      if (safetyAllowed) activeSafetyJobs += 1;
      return Object.freeze({
        ok: true,
        allowed: safetyAllowed,
        idempotent: false,
        jobId: registration.jobId,
        reason: safetyAllowed ? 'registered' : 'interlock_tripped',
      });
    },
    finish(completion) {
      events.push('finish');
      assert.strictEqual(Object.isFrozen(completion), true);
      activeSafetyJobs -= 1;
      return Object.freeze({
        ok: true,
        finished: true,
        jobId: completion.jobId,
      });
    },
    trip() {
      return Promise.resolve(Object.freeze({ ok: true, tripped: true }));
    },
    diagnostics() {
      return Object.freeze({
        version: DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
        state: safetyAllowed ? 'armed' : 'tripped',
        activeJobs: activeSafetyJobs,
      });
    },
  });
  const router = createHarnessRouter({
    canaryEditRunner: v2.runner,
    defaultOnRolloutPolicy: readyPolicy(),
    defaultOnSafetyInterlock: safetyInterlock,
    legacyKernel: legacy,
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'on' },
    }),
    requestIdFactory: (() => {
      let sequence = 0;
      return () => `default-on-${sequence += 1}`;
    })(),
    resolveDefaultOnRolloutFacts: resolveFacts || ((identity) => {
      events.push('resolve');
      assert.strictEqual(Object.isFrozen(identity), true);
      assert.deepStrictEqual(identity, {
        jobId: identity.jobId,
        projectId: 'project-default-on',
        rootPath: '/tmp/project-default-on',
      });
      return facts;
    }),
    persistDefaultOnRolloutSnapshot: persist || ((jobId, snapshot) => {
      events.push('persist');
      assert.strictEqual(Object.isFrozen(snapshot), true);
      checkpoints.push({ jobId, snapshot });
      return Object.freeze({ ok: true });
    }),
  });
  return {
    checkpoints,
    events,
    legacy,
    router,
    setFacts(value) {
      facts = Object.freeze(value);
    },
    v2,
  };
}

async function main() {
  const fixture = createFixture();
  const project = {
    id: 'project-default-on',
    rootPath: '/tmp/project-default-on',
  };

  const selected = await fixture.router.execute(
    { type: 'agentic_tool_loop' },
    project,
    Object.freeze({ jobId: 'job-default-on-1' })
  );
  assert.deepStrictEqual(selected, { ok: true, route: 'v2' });
  assert.deepStrictEqual(
    fixture.events,
    ['resolve', 'persist', 'begin', 'v2', 'finish']
  );
  assert.strictEqual(fixture.v2.calls.length, 1);
  assert.strictEqual(fixture.legacy.calls.length, 0);
  assert.strictEqual(fixture.checkpoints.length, 1);
  assert.strictEqual(fixture.checkpoints[0].jobId, 'job-default-on-1');
  assert.strictEqual(fixture.checkpoints[0].snapshot.selectedKernel, 'v2');
  assert.match(
    fixture.checkpoints[0].snapshot.policyDigest,
    /^sha256:[a-f0-9]{64}$/
  );

  const status = fixture.router.getStatus();
  assert.strictEqual(status.configuredMode, 'on');
  assert.strictEqual(status.effectiveMode, 'on');
  assert.strictEqual(status.activeKernelId, 'codex-app-server-v2');
  assert.strictEqual(status.reason, 'default_on_active');
  assert.strictEqual(status.fallbackActive, false);

  fixture.events.length = 0;
  fixture.setFacts({
    projectPin: null,
    allowlisted: false,
    approvedCohort: true,
  });
  const baseline = await fixture.router.execute(
    { type: 'agentic_tool_loop' },
    project,
    Object.freeze({ jobId: 'job-default-on-2' })
  );
  assert.deepStrictEqual(baseline, { ok: true, route: 'legacy' });
  assert.deepStrictEqual(fixture.events, ['resolve', 'persist', 'legacy']);
  assert.strictEqual(fixture.v2.calls.length, 1);
  assert.strictEqual(fixture.legacy.calls.length, 1);
  assert.strictEqual(fixture.checkpoints[1].snapshot.selectedKernel, 'legacy');
  assert.strictEqual(
    fixture.checkpoints[1].snapshot.reason,
    'not_allowlisted'
  );

  const blockedBySafety = createFixture({ safetyAllowed: false });
  await assert.rejects(
    blockedBySafety.router.execute(
      { type: 'agentic_tool_loop' },
      project,
      Object.freeze({ jobId: 'job-safety-tripped' })
    ),
    /safety interlock/i
  );
  assert.deepStrictEqual(
    blockedBySafety.events,
    ['resolve', 'persist', 'begin']
  );
  assert.strictEqual(blockedBySafety.v2.calls.length, 0);
  assert.strictEqual(blockedBySafety.legacy.calls.length, 0);

  fixture.events.length = 0;
  fixture.setFacts({
    projectPin: null,
    allowlisted: true,
    approvedCohort: true,
  });
  await fixture.router.execute(
    { type: 'agentic_tool_loop' },
    project,
    Object.freeze({ jobId: 'job-conflict' })
  );
  fixture.setFacts({
    projectPin: null,
    allowlisted: false,
    approvedCohort: true,
  });
  await assert.rejects(
    fixture.router.execute(
      { type: 'agentic_tool_loop' },
      project,
      Object.freeze({ jobId: 'job-conflict' })
    ),
    (error) => error && error.code === 'ROLLOUT_SNAPSHOT_CONFLICT'
  );
  assert.strictEqual(fixture.v2.calls.length, 2);
  assert.strictEqual(fixture.legacy.calls.length, 1);

  const failedPersistenceEvents = [];
  const failedPersistence = createFixture({
    persist() {
      failedPersistenceEvents.push('persist');
      return Object.freeze({ ok: false });
    },
  });
  await assert.rejects(
    failedPersistence.router.execute(
      { type: 'agentic_tool_loop' },
      project,
      Object.freeze({ jobId: 'job-persist-failed' })
    ),
    /rollout checkpoint/i
  );
  assert.deepStrictEqual(failedPersistenceEvents, ['persist']);
  assert.strictEqual(failedPersistence.v2.calls.length, 0);
  assert.strictEqual(failedPersistence.legacy.calls.length, 0);

  assert.throws(
    () => createFixture({ resolveFacts: async () => ({}) }),
    /resolveDefaultOnRolloutFacts|synchronous/i
  );

  const dormantEvents = [];
  const dormantLegacy = new RecordingKernel(dormantEvents);
  const dormantV2 = createRunner(dormantEvents);
  const dormant = createHarnessRouter({
    canaryEditRunner: dormantV2.runner,
    legacyKernel: dormantLegacy,
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'on' },
    }),
    requestIdFactory: () => 'default-on-dormant',
  });
  assert.deepStrictEqual(
    await dormant.execute(
      { type: 'agentic_tool_loop' },
      project,
      Object.freeze({ jobId: 'job-dormant' })
    ),
    { ok: true, route: 'legacy' }
  );
  assert.strictEqual(dormant.getStatus().effectiveMode, 'legacy');
  assert.strictEqual(dormant.getStatus().reason, 'phase_9_not_promoted');
  assert.deepStrictEqual(dormantEvents, ['legacy']);

  console.log('default-on-harness-router.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
