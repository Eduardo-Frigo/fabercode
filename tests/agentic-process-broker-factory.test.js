'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  SANDBOX_A1_REQUIRED_FEATURES,
  SANDBOX_BACKEND_SCHEMA_VERSION,
  SANDBOX_BACKEND_SECURITY_MODEL,
  createSandboxProbeResult,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  createSandboxBackendRegistry,
} = require('../main/capabilities/sandbox_backend_registry');
const {
  AGENTIC_PROCESS_BROKER_FACTORY_VERSION,
  AGENTIC_PROCESS_ROUTE_VERSION,
  createAgenticProcessBrokerFactory,
} = require('../main/services/agentic_process_broker_factory');

const binding = createCapabilityDelegationBinding({
  projectId: 'project-a',
  canonicalRootPath: '/projects/a',
  realRootPath: '/private/projects/a',
  sessionId: 'session-a',
  jobId: 'job-a',
  kernelId: 'kernel-a',
  submissionDigest: `sha256:${'a'.repeat(64)}`,
});

function createHarness() {
  const state = {
    active: true,
    backendExecutions: 0,
    executorCalls: [],
    lifecycleChecks: 0,
    rootChecks: 0,
    effectChecks: 0,
    audits: [],
    requestIds: 0,
  };
  const selectionOnlyBackend = Object.freeze({
    schemaVersion: SANDBOX_BACKEND_SCHEMA_VERSION,
    securityModel: SANDBOX_BACKEND_SECURITY_MODEL,
    id: 'selection-proof-only',
    probe() {
      return createSandboxProbeResult({
        state: 'enforced',
        features: SANDBOX_A1_REQUIRED_FEATURES,
      });
    },
    async execute() {
      state.backendExecutions += 1;
      return Object.freeze({ status: 'bypassed' });
    },
    async terminate() {
      return Object.freeze({ ok: true });
    },
  });
  const sandboxRegistry = createSandboxBackendRegistry({
    backends: [selectionOnlyBackend],
  });
  const sandboxExecutor = Object.freeze({
    execute(sandboxRequest, executionContext) {
      state.executorCalls.push(Object.freeze({ sandboxRequest, executionContext }));
      return Promise.resolve(Object.freeze({
        schemaVersion: 'process-supervisor.exec-receipt.v1',
        status: 'running',
        revision: 1,
        exitCode: null,
        signal: null,
        timedOut: false,
        stopped: false,
        availableFromCursor: 0,
        outputCursor: 0,
      }));
    },
  });
  const factory = createAgenticProcessBrokerFactory({
    authorizeLifecycle(candidate) {
      state.lifecycleChecks += 1;
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    authorizeRoot(input) {
      state.rootChecks += 1;
      return state.active
        ? Object.freeze({
          ok: true,
          authorized: true,
          projectId: input.projectId,
          rootPath: input.rootPath,
          canonicalRootPath: input.rootPath,
          realRootPath: binding.realRootPath,
        })
        : Object.freeze({ authorized: false });
    },
    authorizeEffectFrontier(candidate) {
      state.effectChecks += 1;
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    sandboxRegistry,
    requestIdFactory() {
      state.requestIds += 1;
      return `agentic-process-request-${state.requestIds}`;
    },
    audit(event) {
      state.audits.push(event);
    },
  });
  return { factory, sandboxExecutor, state };
}

(async () => {
  const harness = createHarness();
  assert.strictEqual(Object.isFrozen(harness.factory), true);
  assert.strictEqual(
    harness.factory.diagnostics().version,
    AGENTIC_PROCESS_BROKER_FACTORY_VERSION
  );

  const route = harness.factory.createRoute({
    binding,
    sandboxExecutor: harness.sandboxExecutor,
  });
  assert.strictEqual(Object.isFrozen(route), true);
  assert.deepStrictEqual(Reflect.ownKeys(route), ['version', 'execute', 'diagnostics']);
  assert.strictEqual(route.version, AGENTIC_PROCESS_ROUTE_VERSION);
  assert.strictEqual(JSON.stringify(route).includes('/projects/a'), false);
  assert.strictEqual(JSON.stringify(route).includes('submissionDigest'), false);

  const result = await route.execute({
    command: 'npm',
    args: ['test', '--', '--runInBand'],
    timeoutMs: 120_000,
  });
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.decision, 'allow');
  assert.strictEqual(harness.state.backendExecutions, 0);
  assert.strictEqual(harness.state.executorCalls.length, 1);
  assert(harness.state.lifecycleChecks >= 3);
  assert(harness.state.rootChecks >= 3);
  assert(harness.state.effectChecks >= 1);
  assert(harness.state.audits.some((event) => event.event === 'capability_execution_started'));

  const [{ sandboxRequest, executionContext }] = harness.state.executorCalls;
  assert.strictEqual(Object.isFrozen(sandboxRequest), true);
  assert.strictEqual(Object.isFrozen(executionContext), true);
  assert.strictEqual(sandboxRequest.requestId, 'agentic-process-request-1');
  assert.strictEqual(sandboxRequest.rootPath, binding.canonicalRootPath);
  assert.strictEqual(sandboxRequest.realRootPath, binding.realRootPath);
  assert.strictEqual(sandboxRequest.cwd, binding.canonicalRootPath);
  assert.strictEqual(sandboxRequest.cwdRealPath, binding.realRootPath);
  assert.deepStrictEqual(sandboxRequest.command, {
    kind: 'executable',
    executable: 'npm',
    args: ['test', '--', '--runInBand'],
  });
  assert.deepStrictEqual(sandboxRequest.env, {});
  assert.strictEqual(sandboxRequest.networkMode, 'disabled');
  assert.deepStrictEqual(sandboxRequest.tempRoots, []);
  assert.deepStrictEqual(sandboxRequest.cacheRoots, []);
  assert.deepStrictEqual(executionContext.principal, {
    kind: 'agent',
    kernelId: binding.kernelId,
  });
  assert.strictEqual(executionContext.projectSession.jobId, binding.jobId);
  assert.deepStrictEqual(executionContext.effects, ['process_execute']);
  assert.match(executionContext.requestDigest, /^[a-f0-9]{64}$/);
  assert.strictEqual(
    route.diagnostics().requests,
    1
  );

  for (const invalid of [
    { command: 'npm test', args: 'not-an-array', timeoutMs: 1000 },
    { command: '', args: [], timeoutMs: 1000 },
    { command: 'npm', args: new Array(1), timeoutMs: 1000 },
    { command: 'npm', args: [], timeoutMs: 999 },
    { command: 'npm', args: [], timeoutMs: 1000, env: { SECRET: 'x' } },
  ]) {
    await assert.rejects(route.execute(invalid), TypeError);
  }
  assert.strictEqual(harness.state.executorCalls.length, 1);

  let commandGetterCalls = 0;
  const hostileInput = {};
  Object.defineProperty(hostileInput, 'command', {
    enumerable: true,
    get() {
      commandGetterCalls += 1;
      return 'npm';
    },
  });
  Object.defineProperty(hostileInput, 'args', {
    enumerable: true,
    value: [],
  });
  Object.defineProperty(hostileInput, 'timeoutMs', {
    enumerable: true,
    value: 1000,
  });
  await assert.rejects(route.execute(hostileInput), TypeError);
  assert.strictEqual(commandGetterCalls, 0);

  harness.state.active = false;
  const revoked = await route.execute({ command: 'npm', args: ['test'], timeoutMs: 10_000 });
  assert.strictEqual(revoked.status, 'denied');
  assert.strictEqual(harness.state.executorCalls.length, 1);

  assert.throws(
    () => harness.factory.createRoute({
      binding,
      sandboxExecutor: { execute() {} },
    }),
    TypeError
  );
  assert.throws(
    () => harness.factory.createRoute({
      binding,
      sandboxExecutor: Object.freeze({ execute() {} }),
      unexpected: true,
    }),
    /unsupported fields/i
  );

  console.log('agentic-process-broker-factory.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
