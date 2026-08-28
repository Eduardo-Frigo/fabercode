'use strict';

const assert = require('assert');

const { AgentKernel } = require('../main/agent_runtime/agent_kernel');
const {
  HARNESS_OPERATIONS,
  HARNESS_REQUEST_SCHEMA_VERSION,
  createHarnessResult,
} = require('../main/agent_runtime/harness_contracts');
const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');
const { createHarnessRouter } = require('../main/agent_runtime/harness_router');

class RecordingLegacyKernel extends AgentKernel {
  constructor(outputs) {
    super({
      id: 'legacy',
      version: 'recording-legacy.v1',
      capabilities: Object.values(HARNESS_OPERATIONS),
    });
    this.calls = [];
    this.outputs = outputs;
    this.rejection = null;
    this.invalidResult = null;
  }

  run(operation, request) {
    this.calls.push([operation, request]);
    if (this.rejection) throw this.rejection;
    if (this.invalidResult) return this.invalidResult;
    return createHarnessResult({
      requestId: request.requestId,
      operation,
      kernelId: this.id,
      output: this.outputs[operation],
      diagnostics: this.getDiagnostics(),
    });
  }

  async plan(request) {
    return this.run(HARNESS_OPERATIONS.PLAN, request);
  }

  async message(request) {
    return this.run(HARNESS_OPERATIONS.MESSAGE, request);
  }

  async execute(request) {
    return this.run(HARNESS_OPERATIONS.EXECUTE, request);
  }
}

function createRecordingShadowPlanRunner(authoritativeKernel, {
  authoritativeKernelId = authoritativeKernel.id,
} = {}) {
  const calls = [];
  const runner = Object.freeze({
    version: 'recording-shadow-plan-runner.v1',
    plan(request) {
      calls.push(request);
      return authoritativeKernel.plan(request);
    },
    drain() {
      return Promise.resolve(this.diagnostics());
    },
    diagnostics() {
      return Object.freeze({
        version: 'recording-shadow-plan-runner.v1',
        authoritativeKernelId,
        shadowKernelId: 'codex-app-server-shadow',
        plans: calls.length,
        activeObservations: 0,
      });
    },
  });
  return { calls, runner };
}

function createRecordingCanaryEditRunner(authoritativeKernel, {
  authoritativeKernelId = authoritativeKernel.id,
  canaryKernelId = 'codex-app-server-canary',
  fallbackToLegacy = false,
  invalidResult = null,
  output = { ok: true, modifiedFiles: ['src/canary.js'] },
  rejection = null,
  synchronous = false,
} = {}) {
  const calls = [];
  const runner = Object.freeze({
    version: 'recording-canary-edit-runner.v1',
    execute(request) {
      calls.push(request);
      if (rejection) return Promise.reject(rejection);
      if (fallbackToLegacy) return authoritativeKernel.execute(request);
      const result = invalidResult || createHarnessResult({
        requestId: request.requestId,
        operation: request.operation,
        kernelId: canaryKernelId,
        output,
        diagnostics: { canary: true },
      });
      return synchronous ? result : Promise.resolve(result);
    },
    diagnostics() {
      return Object.freeze({
        version: 'recording-canary-edit-runner.v1',
        authoritativeKernelId,
        canaryKernelId,
        executions: calls.length,
        activeExecutions: 0,
      });
    },
  });
  return { calls, output, runner };
}

async function testShadowModeRoutesPlanOnly() {
  const outputs = {
    plan: { ok: true, action: { type: 'shadow-authoritative-plan' } },
    message: { ok: true, response: 'legacy message' },
    execute: { ok: true, modifiedFiles: [] },
  };
  const kernel = new RecordingLegacyKernel(outputs);
  const shadow = createRecordingShadowPlanRunner(kernel);
  let sequence = 0;
  const router = createHarnessRouter({
    legacyKernel: kernel,
    shadowPlanRunner: shadow.runner,
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'shadow' },
    }),
    requestIdFactory: () => `shadow-route-${sequence += 1}`,
  });

  assert.strictEqual(await router.plan({ userMessage: 'planejar' }), outputs.plan);
  assert.strictEqual(await router.message({ userMessage: 'conversar' }), outputs.message);
  assert.strictEqual(
    await router.execute({ type: 'noop' }, { rootPath: '/tmp/project' }),
    outputs.execute
  );
  assert.strictEqual(shadow.calls.length, 1);
  assert.strictEqual(shadow.calls[0].operation, HARNESS_OPERATIONS.PLAN);
  assert.strictEqual(shadow.calls[0].requestId, 'shadow-route-1');
  assert.deepStrictEqual(
    kernel.calls.map(([operation]) => operation),
    [HARNESS_OPERATIONS.PLAN, HARNESS_OPERATIONS.MESSAGE, HARNESS_OPERATIONS.EXECUTE]
  );

  const status = router.getStatus();
  assert.strictEqual(status.configuredMode, 'shadow');
  assert.strictEqual(status.effectiveMode, 'shadow');
  assert.strictEqual(status.activeKernelId, 'legacy');
  assert.strictEqual(status.shadowKernelId, 'codex-app-server-shadow');
  assert.strictEqual(status.fallbackActive, false);
  assert.strictEqual(status.reason, 'shadow_active');
  assert.deepStrictEqual(status.shadowKernel, {
    version: 'recording-shadow-plan-runner.v1',
    authoritativeKernelId: 'legacy',
    shadowKernelId: 'codex-app-server-shadow',
    plans: 1,
    activeObservations: 0,
  });

  const legacyKernel = new RecordingLegacyKernel(outputs);
  const dormantShadow = createRecordingShadowPlanRunner(legacyKernel);
  const legacyRouter = createHarnessRouter({
    legacyKernel,
    shadowPlanRunner: dormantShadow.runner,
    runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
    requestIdFactory: () => 'legacy-with-shadow-port',
  });
  assert.strictEqual(await legacyRouter.plan({}), outputs.plan);
  assert.strictEqual(dormantShadow.calls.length, 0);
  assert.strictEqual(legacyRouter.getStatus().shadowKernel, null);

  for (const mode of ['canary', 'on']) {
    const rolloutKernel = new RecordingLegacyKernel(outputs);
    const rolloutShadow = createRecordingShadowPlanRunner(rolloutKernel);
    const rolloutRouter = createHarnessRouter({
      legacyKernel: rolloutKernel,
      shadowPlanRunner: rolloutShadow.runner,
      runtimeConfig: createHarnessRuntimeConfig({
        env: { FABER_HARNESS_V2_MODE: mode },
      }),
      requestIdFactory: () => `not-promoted-${mode}`,
    });
    assert.strictEqual(await rolloutRouter.plan({}), outputs.plan);
    assert.strictEqual(rolloutShadow.calls.length, 0);
    assert.strictEqual(rolloutRouter.getStatus().effectiveMode, 'legacy');
  }

  const killedKernel = new RecordingLegacyKernel(outputs);
  const killedShadow = createRecordingShadowPlanRunner(killedKernel);
  const killedRouter = createHarnessRouter({
    legacyKernel: killedKernel,
    shadowPlanRunner: killedShadow.runner,
    runtimeConfig: createHarnessRuntimeConfig({
      env: {
        FABER_HARNESS_V2_MODE: 'shadow',
        FABER_HARNESS_V2_KILL_SWITCH: 'true',
      },
    }),
    requestIdFactory: () => 'shadow-killed',
  });
  assert.strictEqual(await killedRouter.plan({}), outputs.plan);
  assert.strictEqual(killedShadow.calls.length, 0);
  assert.strictEqual(killedRouter.getStatus().effectiveMode, 'legacy');
  assert.strictEqual(killedRouter.getStatus().reason, 'kill_switch');

  const unavailableRouter = createHarnessRouter({
    legacyKernel: new RecordingLegacyKernel(outputs),
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'shadow' },
    }),
    requestIdFactory: () => 'shadow-unavailable',
  });
  assert.strictEqual(unavailableRouter.getStatus().effectiveMode, 'legacy');
  assert.strictEqual(unavailableRouter.getStatus().fallbackActive, true);
  assert.strictEqual(unavailableRouter.getStatus().reason, 'shadow_runner_unavailable');

  const mismatchedShadow = createRecordingShadowPlanRunner(kernel, {
    authoritativeKernelId: 'other-legacy',
  });
  assert.throws(
    () => createHarnessRouter({
      legacyKernel: kernel,
      shadowPlanRunner: mismatchedShadow.runner,
      runtimeConfig: createHarnessRuntimeConfig({
        env: { FABER_HARNESS_V2_MODE: 'shadow' },
      }),
    }),
    /authoritativeKernelId/
  );
}

async function testCanaryModeRoutesExecuteOnly() {
  const outputs = {
    plan: { ok: true, action: { type: 'legacy-plan' } },
    message: { ok: true, response: 'legacy message' },
    execute: { ok: true, modifiedFiles: ['src/legacy.js'] },
  };
  const kernel = new RecordingLegacyKernel(outputs);
  const canary = createRecordingCanaryEditRunner(kernel);
  let sequence = 0;
  const router = createHarnessRouter({
    canaryEditRunner: canary.runner,
    legacyKernel: kernel,
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'canary' },
    }),
    requestIdFactory: () => `canary-route-${sequence += 1}`,
  });

  assert.strictEqual(await router.plan({ userMessage: 'planejar' }), outputs.plan);
  assert.strictEqual(await router.message({ userMessage: 'conversar' }), outputs.message);
  const executionContext = { jobId: 'job-canary-route' };
  assert.strictEqual(
    await router.execute(
      { type: 'apply_file_patch' },
      { rootPath: '/tmp/project' },
      executionContext
    ),
    canary.output
  );
  assert.deepStrictEqual(
    kernel.calls.map(([operation]) => operation),
    [HARNESS_OPERATIONS.PLAN, HARNESS_OPERATIONS.MESSAGE]
  );
  assert.strictEqual(canary.calls.length, 1);
  assert.strictEqual(canary.calls[0].operation, HARNESS_OPERATIONS.EXECUTE);
  assert.strictEqual(canary.calls[0].requestId, 'canary-route-3');
  assert.strictEqual(canary.calls[0].executionContext, executionContext);

  const status = router.getStatus();
  assert.strictEqual(status.configuredMode, 'canary');
  assert.strictEqual(status.effectiveMode, 'canary');
  assert.strictEqual(status.activeKernelId, 'codex-app-server-canary');
  assert.strictEqual(status.canaryKernelId, 'codex-app-server-canary');
  assert.strictEqual(status.shadowKernelId, null);
  assert.strictEqual(status.fallbackActive, false);
  assert.strictEqual(status.reason, 'canary_active');
  assert.deepStrictEqual(status.canaryKernel, {
    version: 'recording-canary-edit-runner.v1',
    authoritativeKernelId: 'legacy',
    canaryKernelId: 'codex-app-server-canary',
    executions: 1,
    activeExecutions: 0,
  });
  assert.strictEqual(status.shadowKernel, null);

  const fallbackKernel = new RecordingLegacyKernel(outputs);
  const fallback = createRecordingCanaryEditRunner(fallbackKernel, {
    fallbackToLegacy: true,
  });
  const fallbackRouter = createHarnessRouter({
    canaryEditRunner: fallback.runner,
    legacyKernel: fallbackKernel,
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'canary' },
    }),
    requestIdFactory: () => 'canary-clean-fallback',
  });
  assert.strictEqual(
    await fallbackRouter.execute({ type: 'noop' }, { rootPath: '/tmp/project' }),
    outputs.execute
  );
  assert.strictEqual(fallback.calls.length, 1);
  assert.strictEqual(fallbackKernel.calls.length, 1);

  const rejection = new Error('canary cleanup ambiguous');
  const rejectedKernel = new RecordingLegacyKernel(outputs);
  const rejected = createRecordingCanaryEditRunner(rejectedKernel, { rejection });
  const rejectedRouter = createHarnessRouter({
    canaryEditRunner: rejected.runner,
    legacyKernel: rejectedKernel,
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'canary' },
    }),
    requestIdFactory: () => 'canary-rejected',
  });
  await assert.rejects(
    rejectedRouter.execute({ type: 'noop' }, { rootPath: '/tmp/project' }),
    (error) => error === rejection
  );
  assert.strictEqual(
    rejectedKernel.calls.length,
    0,
    'the router must never invent a legacy fallback after an ambiguous canary rejection'
  );

  const synchronousKernel = new RecordingLegacyKernel(outputs);
  const synchronous = createRecordingCanaryEditRunner(synchronousKernel, {
    synchronous: true,
  });
  const synchronousRouter = createHarnessRouter({
    canaryEditRunner: synchronous.runner,
    legacyKernel: synchronousKernel,
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'canary' },
    }),
    requestIdFactory: () => 'canary-sync-invalid',
  });
  await assert.rejects(
    synchronousRouter.execute({ type: 'noop' }, { rootPath: '/tmp/project' }),
    /native Promise/
  );
  assert.strictEqual(synchronousKernel.calls.length, 0);

  const wrongKernel = new RecordingLegacyKernel(outputs);
  const wrongResult = createRecordingCanaryEditRunner(wrongKernel, {
    invalidResult: createHarnessResult({
      requestId: 'canary-wrong-kernel',
      operation: HARNESS_OPERATIONS.EXECUTE,
      kernelId: 'untrusted-kernel',
      output: {},
    }),
  });
  const wrongResultRouter = createHarnessRouter({
    canaryEditRunner: wrongResult.runner,
    legacyKernel: wrongKernel,
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'canary' },
    }),
    requestIdFactory: () => 'canary-wrong-kernel',
  });
  await assert.rejects(
    wrongResultRouter.execute({ type: 'noop' }, { rootPath: '/tmp/project' }),
    /kernel id/
  );
  assert.strictEqual(wrongKernel.calls.length, 0);

  const unavailable = createHarnessRouter({
    legacyKernel: new RecordingLegacyKernel(outputs),
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'canary' },
    }),
    requestIdFactory: () => 'canary-unavailable',
  });
  assert.strictEqual(unavailable.getStatus().effectiveMode, 'legacy');
  assert.strictEqual(unavailable.getStatus().fallbackActive, true);
  assert.strictEqual(unavailable.getStatus().reason, 'canary_runner_unavailable');

  for (const mode of ['legacy', 'shadow', 'on']) {
    const dormantKernel = new RecordingLegacyKernel(outputs);
    const dormant = createRecordingCanaryEditRunner(dormantKernel);
    const dormantRouter = createHarnessRouter({
      canaryEditRunner: dormant.runner,
      legacyKernel: dormantKernel,
      runtimeConfig: createHarnessRuntimeConfig({
        env: mode === 'legacy' ? {} : { FABER_HARNESS_V2_MODE: mode },
      }),
      requestIdFactory: () => `canary-dormant-${mode}`,
    });
    assert.strictEqual(
      await dormantRouter.execute({ type: 'noop' }, { rootPath: '/tmp/project' }),
      outputs.execute
    );
    assert.strictEqual(dormant.calls.length, 0);
    assert.strictEqual(dormantRouter.getStatus().canaryKernel, null);
  }

  const mismatched = createRecordingCanaryEditRunner(kernel, {
    authoritativeKernelId: 'other-legacy',
  });
  assert.throws(
    () => createHarnessRouter({
      canaryEditRunner: mismatched.runner,
      legacyKernel: kernel,
      runtimeConfig: createHarnessRuntimeConfig({
        env: { FABER_HARNESS_V2_MODE: 'canary' },
      }),
    }),
    /authoritativeKernelId/
  );
  assert.throws(
    () => createHarnessRouter({
      canaryEditRunner: Object.freeze({ ...canary.runner, unexpected: true }),
      legacyKernel: kernel,
    }),
    /canaryEditRunner/
  );
  assert.throws(
    () => createHarnessRouter({
      canaryEditRunner: { ...canary.runner },
      legacyKernel: kernel,
    }),
    /canaryEditRunner/
  );
}

async function run() {
  assert.throws(
    () => createHarnessRouter(),
    /Agent kernel/
  );

  const outputByOperation = {
    plan: { ok: true, action: { type: 'plan' } },
    message: { ok: true, response: 'resposta preservada' },
    execute: { ok: false, modifiedFiles: ['src/app.js'] },
  };
  const kernel = new RecordingLegacyKernel(outputByOperation);
  const requestIds = [
    'request-plan',
    'request-message',
    'request-execute',
    'request-rejection',
    'request-invalid-result',
  ];
  let requestIdCalls = 0;
  const onConfig = createHarnessRuntimeConfig({
    env: { FABER_HARNESS_V2_MODE: 'on' },
  });
  const router = createHarnessRouter({
    legacyKernel: kernel,
    runtimeConfig: onConfig,
    requestIdFactory: () => {
      const requestId = requestIds[requestIdCalls];
      requestIdCalls += 1;
      return requestId;
    },
  });

  const planPayload = {
    projectInfo: { rootPath: '/tmp/project' },
    userMessage: 'planejar',
  };
  const messagePayload = {
    projectInfo: { rootPath: '/tmp/project' },
    contextHint: 'texto sem normalização',
    isMapChat: true,
  };
  const action = { type: 'operation_batch', operations: [] };
  const projectInfo = { rootPath: '/tmp/project' };
  const abortController = new AbortController();
  const executionContext = {
    jobId: 'job-1',
    signal: abortController.signal,
  };

  assert.strictEqual(await router.plan(planPayload), outputByOperation.plan);
  assert.strictEqual(await router.message(messagePayload), outputByOperation.message);
  assert.strictEqual(
    await router.execute(action, projectInfo, executionContext),
    outputByOperation.execute
  );
  assert.strictEqual(requestIdCalls, 3);
  assert.strictEqual(kernel.calls.length, 3);

  const [planCall, messageCall, executeCall] = kernel.calls;
  assert.strictEqual(planCall[0], HARNESS_OPERATIONS.PLAN);
  assert.strictEqual(planCall[1].schemaVersion, HARNESS_REQUEST_SCHEMA_VERSION);
  assert.strictEqual(planCall[1].requestId, 'request-plan');
  assert.strictEqual(planCall[1].payload, planPayload);
  assert.strictEqual(messageCall[0], HARNESS_OPERATIONS.MESSAGE);
  assert.strictEqual(messageCall[1].requestId, 'request-message');
  assert.strictEqual(messageCall[1].payload, messagePayload);
  assert.strictEqual(executeCall[0], HARNESS_OPERATIONS.EXECUTE);
  assert.strictEqual(executeCall[1].requestId, 'request-execute');
  assert.strictEqual(executeCall[1].action, action);
  assert.strictEqual(executeCall[1].projectInfo, projectInfo);
  assert.strictEqual(executeCall[1].executionContext, executionContext);
  assert.strictEqual(executeCall[1].executionContext.signal, abortController.signal);

  const status = router.getStatus();
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.runtimeConfig, onConfig);
  assert.strictEqual(status.requestedMode, 'on');
  assert.strictEqual(status.configuredMode, 'on');
  assert.strictEqual(status.effectiveMode, 'legacy');
  assert.strictEqual(status.activeKernelId, 'legacy');
  assert.strictEqual(status.fallbackActive, true);
  assert.strictEqual(status.reason, 'phase_9_not_promoted');
  assert.strictEqual(status.kernel.id, 'legacy');
  assert.strictEqual(status.runtimeConfig.configuredPrimaryKernel, 'v2');
  assert.strictEqual(status.runtimeConfig.diagnostics.configuredMode, 'on');
  assert.strictEqual(Object.hasOwn(status.runtimeConfig.diagnostics, 'effectiveMode'), false);
  assert.strictEqual(Object.hasOwn(router, 'dispatch'), false);

  const rejection = new Error('kernel failed');
  kernel.rejection = rejection;
  await assert.rejects(
    router.execute(action, projectInfo, executionContext),
    (error) => error === rejection
  );
  kernel.rejection = null;

  kernel.invalidResult = {};
  await assert.rejects(
    router.message(messagePayload),
    /result schema/
  );
  kernel.invalidResult = null;

  const legacyConfig = createHarnessRuntimeConfig({ env: {} });
  const legacyKernel = new RecordingLegacyKernel(outputByOperation);
  const legacyRouter = createHarnessRouter({
    legacyKernel,
    runtimeConfig: legacyConfig,
    requestIdFactory: () => 'legacy-request',
  });
  assert.strictEqual(await legacyRouter.execute(action, projectInfo), outputByOperation.execute);
  const legacyExecuteRequest = legacyKernel.calls[0][1];
  assert.strictEqual(Object.hasOwn(legacyExecuteRequest, 'executionContext'), false);
  const legacyStatus = legacyRouter.getStatus();
  assert.strictEqual(legacyStatus.configuredMode, 'legacy');
  assert.strictEqual(legacyStatus.effectiveMode, 'legacy');
  assert.strictEqual(legacyStatus.fallbackActive, false);
  assert.strictEqual(legacyStatus.reason, 'legacy_default');

  for (const configuredMode of ['shadow', 'canary', 'on']) {
    const rolloutRouter = createHarnessRouter({
      legacyKernel: new RecordingLegacyKernel(outputByOperation),
      runtimeConfig: createHarnessRuntimeConfig({
        env: { FABER_HARNESS_V2_MODE: configuredMode },
      }),
      requestIdFactory: () => `rollout-${configuredMode}`,
    });
    const rolloutStatus = rolloutRouter.getStatus();
    assert.strictEqual(rolloutStatus.configuredMode, configuredMode);
    assert.strictEqual(rolloutStatus.runtimeConfig.diagnostics.configuredMode, configuredMode);
    assert.strictEqual(rolloutStatus.effectiveMode, 'legacy');
    assert.strictEqual(rolloutStatus.activeKernelId, 'legacy');
    assert.strictEqual(rolloutStatus.fallbackActive, true);
  }

  const killedRouter = createHarnessRouter({
    legacyKernel: new RecordingLegacyKernel(outputByOperation),
    runtimeConfig: createHarnessRuntimeConfig({
      env: {
        FABER_HARNESS_V2_MODE: 'on',
        FABER_HARNESS_V2_KILL_SWITCH: 'true',
      },
    }),
    requestIdFactory: () => 'killed-request',
  });
  const killedStatus = killedRouter.getStatus();
  assert.strictEqual(killedStatus.requestedMode, 'on');
  assert.strictEqual(killedStatus.configuredMode, 'legacy');
  assert.strictEqual(killedStatus.effectiveMode, 'legacy');
  assert.strictEqual(killedStatus.fallbackActive, true);
  assert.strictEqual(killedStatus.reason, 'kill_switch');

  const invalidModeRouter = createHarnessRouter({
    legacyKernel: new RecordingLegacyKernel(outputByOperation),
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'unsupported' },
    }),
    requestIdFactory: () => 'invalid-mode-request',
  });
  const invalidModeStatus = invalidModeRouter.getStatus();
  assert.strictEqual(invalidModeStatus.fallbackActive, true);
  assert.strictEqual(invalidModeStatus.reason, 'invalid_mode');

  const invalidConfigRouter = createHarnessRouter({
    legacyKernel: new RecordingLegacyKernel(outputByOperation),
    runtimeConfig: { mode: 'on' },
    requestIdFactory: () => 'safe-request',
  });
  const invalidConfigStatus = invalidConfigRouter.getStatus();
  assert.strictEqual(invalidConfigStatus.configuredMode, 'legacy');
  assert.strictEqual(invalidConfigStatus.effectiveMode, 'legacy');
  assert.strictEqual(invalidConfigStatus.runtimeConfig.diagnostics.fallbackReason, 'default');

  const structuralKernel = {
    id: 'legacy-structural',
    version: 'structural.v1',
    capabilities: ['plan', 'message', 'execute'],
    plan: async () => {},
    message: async () => {},
    execute: async () => {},
  };
  const structuralRouter = createHarnessRouter({
    legacyKernel: structuralKernel,
    runtimeConfig: legacyConfig,
    requestIdFactory: () => 'structural-request',
  });
  assert.deepStrictEqual(structuralRouter.getStatus().kernel, {
    id: 'legacy-structural',
    version: 'structural.v1',
    capabilities: ['plan', 'message', 'execute'],
  });

  assert.throws(
    () => createHarnessRouter({ legacyKernel: kernel, requestIdFactory: 'not-a-function' }),
    /requestIdFactory/
  );

  await testShadowModeRoutesPlanOnly();
  await testCanaryModeRoutesExecuteOnly();

  console.log('harness-router.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
