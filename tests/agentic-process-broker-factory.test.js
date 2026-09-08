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
  AGENTIC_PROCESS_ROUTE_REASONS,
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

function createHarness({ factoryCreator = createAgenticProcessBrokerFactory } = {}) {
  const state = {
    active: true,
    backendExecutions: 0,
    executorCalls: [],
    readCalls: [],
    waitCalls: [],
    stopCalls: [],
    lifecycleChecks: 0,
    rootChecks: 0,
    effectChecks: 0,
    audits: [],
    rejectNextAudit: false,
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
        executionId: sandboxRequest.executionId,
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
    read(input) {
      state.readCalls.push(input);
      return Promise.resolve(Object.freeze({
        version: 'process-supervisor-read-result.v1',
        executionId: input.executionId,
        status: 'running',
        revision: 1,
        exitCode: null,
        signal: null,
        timedOut: false,
        stopped: false,
        cursor: input.cursor,
        availableFromCursor: 0,
        nextCursor: 5,
        outputCursor: 5,
        truncated: false,
        chunks: Object.freeze([Object.freeze({
          startCursor: 0,
          endCursor: 5,
          stream: 'stdout',
          text: 'pass\n',
        })]),
        eof: false,
      }));
    },
    wait(input) {
      state.waitCalls.push(input);
      return Promise.resolve(Object.freeze({
        version: 'process-supervisor-wait-result.v1',
        executionId: input.executionId,
        status: 'succeeded',
        revision: input.afterRevision + 1,
        exitCode: 0,
        signal: null,
        timedOut: false,
        stopped: false,
        availableFromCursor: 0,
        outputCursor: 5,
        changed: true,
      }));
    },
    stop(input) {
      state.stopCalls.push(input);
      return Promise.resolve(Object.freeze({
        version: 'process-supervisor-stop-receipt.v1',
        executionId: input.executionId,
        status: 'stopped',
        revision: input.expectedRevision + 1,
        exitCode: null,
        signal: 'SIGTERM',
        timedOut: false,
        stopped: true,
        availableFromCursor: 0,
        outputCursor: 5,
        treeTerminated: true,
        idempotent: false,
      }));
    },
  });
  const factory = factoryCreator({
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
      if (state.rejectNextAudit) {
        state.rejectNextAudit = false;
        return Promise.reject(new Error('injected audit rejection'));
      }
      return undefined;
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
  assert.deepStrictEqual(Reflect.ownKeys(route), [
    'version',
    'execute',
    'read',
    'wait',
    'stop',
    'diagnostics',
  ]);
  assert.strictEqual(route.version, AGENTIC_PROCESS_ROUTE_VERSION);
  assert.strictEqual(JSON.stringify(route).includes('/projects/a'), false);
  assert.strictEqual(JSON.stringify(route).includes('submissionDigest'), false);

  const result = await route.execute({
    command: 'npm',
    args: ['test', '--', '--runInBand'],
    timeoutMs: 120_000,
    mutationRevision: 0,
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
  assert.strictEqual(executionContext.mutationRevision, 0);
  assert.strictEqual(
    route.diagnostics().requests,
    1
  );

  const duplicateResult = await route.execute({
    command: 'npm',
    args: ['test', '--', '--runInBand'],
    timeoutMs: 120_000,
    mutationRevision: 0,
  });
  assert.strictEqual(
    duplicateResult,
    result,
    'an exact retry while the process is active must reuse the first authority-bound receipt'
  );
  assert.strictEqual(harness.state.executorCalls.length, 1);
  assert.strictEqual(harness.state.requestIds, 1);

  assert.deepStrictEqual(
    await route.execute({
      command: 'npm',
      args: ['test', '--', '--runInBand'],
      timeoutMs: 120_000,
      mutationRevision: 1,
    }),
    Object.freeze({
      ok: false,
      code: AGENTIC_PROCESS_ROUTE_REASONS.PROCESS_ALREADY_ACTIVE,
    })
  );

  assert.deepStrictEqual(
    await route.execute({
      command: 'npm',
      args: ['run', 'build'],
      timeoutMs: 120_000,
      mutationRevision: 0,
    }),
    Object.freeze({
      ok: false,
      code: AGENTIC_PROCESS_ROUTE_REASONS.PROCESS_ALREADY_ACTIVE,
    })
  );
  assert.strictEqual(harness.state.executorCalls.length, 1);

  const internalExecutionId = result.output.executionId;
  const readResult = await route.read({ cursor: 0, maxBytes: 4096 });
  assert.strictEqual(readResult.executionId, internalExecutionId);
  assert.strictEqual(readResult.chunks[0].text, 'pass\n');
  assert.deepStrictEqual(harness.state.readCalls, [Object.freeze({
    executionId: internalExecutionId,
    cursor: 0,
    maxBytes: 4096,
  })]);

  const waitResult = await route.wait({ afterRevision: 1, timeoutMs: 1000 });
  assert.strictEqual(waitResult.changed, true);
  assert.deepStrictEqual(harness.state.waitCalls, [Object.freeze({
    executionId: internalExecutionId,
    afterRevision: 1,
    timeoutMs: 1000,
  })]);

  const sequentialResult = await route.execute({
    command: 'npm',
    args: ['run', 'build'],
    timeoutMs: 120_000,
    mutationRevision: 1,
  });
  assert.strictEqual(sequentialResult.status, 'completed');
  assert.strictEqual(sequentialResult.decision, 'allow');
  assert.strictEqual(harness.state.executorCalls.length, 2);
  const sequentialExecutionId = sequentialResult.output.executionId;
  assert.notStrictEqual(sequentialExecutionId, internalExecutionId);
  assert.strictEqual(harness.state.executorCalls[1].executionContext.mutationRevision, 1);
  assert.notStrictEqual(
    harness.state.executorCalls[1].executionContext.requestDigest,
    executionContext.requestDigest
  );

  const stopResult = await route.stop({ expectedRevision: 1 });
  assert.strictEqual(stopResult.treeTerminated, true);
  assert.deepStrictEqual(harness.state.stopCalls, [Object.freeze({
    executionId: sequentialExecutionId,
    expectedRevision: 1,
    reasonCode: 'AGENTIC_PROCESS_STOP_REQUESTED',
  })]);
  assert.deepStrictEqual(route.diagnostics(), Object.freeze({
    version: AGENTIC_PROCESS_ROUTE_VERSION,
    capability: 'process',
    action: 'run',
    requests: 2,
    reads: 1,
    waits: 1,
    stops: 1,
    hasProcess: true,
    networkMode: 'disabled',
    authorityBoundary: 'job_binding',
  }));

  const emptyRoute = harness.factory.createRoute({
    binding,
    sandboxExecutor: harness.sandboxExecutor,
  });
  assert.deepStrictEqual(
    await emptyRoute.read({ cursor: 0, maxBytes: 1024 }),
    Object.freeze({
      ok: false,
      code: AGENTIC_PROCESS_ROUTE_REASONS.PROCESS_UNAVAILABLE,
    })
  );

  let readGetterCalls = 0;
  const hostileReadInput = { maxBytes: 1024 };
  Object.defineProperty(hostileReadInput, 'cursor', {
    enumerable: true,
    get() {
      readGetterCalls += 1;
      return 0;
    },
  });
  assert.throws(() => route.read(hostileReadInput), TypeError);
  assert.strictEqual(readGetterCalls, 0);

  let waitProxyTrapCalls = 0;
  const hostileWaitInput = new Proxy({
    afterRevision: 1,
    timeoutMs: 1000,
  }, {
    ownKeys(target) {
      waitProxyTrapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(() => route.wait(hostileWaitInput), TypeError);
  assert.strictEqual(waitProxyTrapCalls, 0);
  assert.strictEqual(harness.state.readCalls.length, 1);
  assert.strictEqual(harness.state.waitCalls.length, 1);

  const rejectedStartHarness = createHarness();
  const rejectedStartRoute = rejectedStartHarness.factory.createRoute({
    binding,
    sandboxExecutor: rejectedStartHarness.sandboxExecutor,
  });
  const retryInput = Object.freeze({
    command: 'npm',
    args: Object.freeze(['test']),
    timeoutMs: 10_000,
    mutationRevision: 0,
  });
  const capabilityBrokerPath = require.resolve('../main/capabilities/project_capability_broker');
  const processBrokerFactoryPath = require.resolve('../main/services/agentic_process_broker_factory');
  const capabilityBrokerModule = require(capabilityBrokerPath);
  const originalCreateProjectCapabilityBroker = capabilityBrokerModule.createProjectCapabilityBroker;
  let synchronousBrokerCalls = 0;
  let synchronousThrowFactoryCreator;
  try {
    capabilityBrokerModule.createProjectCapabilityBroker = () => Object.freeze({
      execute() {
        synchronousBrokerCalls += 1;
        if (synchronousBrokerCalls === 1) {
          throw new Error('injected synchronous broker execution failure');
        }
        return Promise.resolve(Object.freeze({
          status: 'completed',
          decision: 'allow',
          output: Object.freeze({
            executionId: `sandbox-exec:${'b'.repeat(64)}`,
            status: 'running',
          }),
        }));
      },
    });
    delete require.cache[processBrokerFactoryPath];
    ({ createAgenticProcessBrokerFactory: synchronousThrowFactoryCreator } = require(
      processBrokerFactoryPath
    ));
  } finally {
    capabilityBrokerModule.createProjectCapabilityBroker = originalCreateProjectCapabilityBroker;
    delete require.cache[processBrokerFactoryPath];
    require(processBrokerFactoryPath);
  }
  const synchronousThrowHarness = createHarness({
    factoryCreator: synchronousThrowFactoryCreator,
  });
  const synchronousThrowRoute = synchronousThrowHarness.factory.createRoute({
    binding,
    sandboxExecutor: synchronousThrowHarness.sandboxExecutor,
  });
  await assert.rejects(
    synchronousThrowRoute.execute(retryInput),
    /injected synchronous broker execution failure/
  );
  const retriedAfterSynchronousThrow = await synchronousThrowRoute.execute(retryInput);
  assert.strictEqual(retriedAfterSynchronousThrow.status, 'completed');
  assert.strictEqual(retriedAfterSynchronousThrow.decision, 'allow');
  assert.strictEqual(synchronousBrokerCalls, 2);

  rejectedStartHarness.state.active = false;
  rejectedStartHarness.state.rejectNextAudit = true;
  await assert.rejects(
    rejectedStartRoute.execute(retryInput),
    /injected audit rejection/
  );
  rejectedStartHarness.state.active = true;
  const retriedAfterRejection = await rejectedStartRoute.execute(retryInput);
  assert.strictEqual(retriedAfterRejection.status, 'completed');
  assert.strictEqual(retriedAfterRejection.decision, 'allow');
  assert.strictEqual(rejectedStartHarness.state.executorCalls.length, 1);

  for (const invalid of [
    { command: 'npm', args: [], timeoutMs: 1000 },
    { command: 'npm test', args: 'not-an-array', timeoutMs: 1000 },
    { command: '', args: [], timeoutMs: 1000, mutationRevision: 0 },
    { command: 'npm', args: new Array(1), timeoutMs: 1000, mutationRevision: 0 },
    { command: 'npm', args: [], timeoutMs: 999, mutationRevision: 0 },
    { command: 'npm', args: [], timeoutMs: 1000, mutationRevision: -1 },
    { command: 'npm', args: [], timeoutMs: 1000, mutationRevision: -0 },
    { command: 'npm', args: [], timeoutMs: 1000, mutationRevision: 0, env: { SECRET: 'x' } },
  ]) {
    await assert.rejects(route.execute(invalid), TypeError);
  }
  assert.strictEqual(harness.state.executorCalls.length, 2);

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
  Object.defineProperty(hostileInput, 'mutationRevision', {
    enumerable: true,
    value: 0,
  });
  await assert.rejects(route.execute(hostileInput), TypeError);
  assert.strictEqual(commandGetterCalls, 0);

  harness.state.active = false;
  const revoked = await route.execute({
    command: 'npm',
    args: ['test'],
    timeoutMs: 10_000,
    mutationRevision: 1,
  });
  assert.strictEqual(revoked.status, 'denied');
  assert.strictEqual(harness.state.executorCalls.length, 2);
  assert.deepStrictEqual(
    await route.wait({ afterRevision: 1, timeoutMs: 1000 }),
    Object.freeze({
      ok: false,
      code: AGENTIC_PROCESS_ROUTE_REASONS.AUTHORITY_DENIED,
    })
  );
  assert.strictEqual(harness.state.waitCalls.length, 1);

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
