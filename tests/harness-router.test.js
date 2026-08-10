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

  assert.strictEqual(await router.plan(planPayload), outputByOperation.plan);
  assert.strictEqual(await router.message(messagePayload), outputByOperation.message);
  assert.strictEqual(await router.execute(action, projectInfo), outputByOperation.execute);
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

  const status = router.getStatus();
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.runtimeConfig, onConfig);
  assert.strictEqual(status.requestedMode, 'on');
  assert.strictEqual(status.configuredMode, 'on');
  assert.strictEqual(status.effectiveMode, 'legacy');
  assert.strictEqual(status.activeKernelId, 'legacy');
  assert.strictEqual(status.fallbackActive, true);
  assert.strictEqual(status.reason, 'phase_1_legacy_fallback');
  assert.strictEqual(status.kernel.id, 'legacy');
  assert.strictEqual(status.runtimeConfig.configuredPrimaryKernel, 'v2');
  assert.strictEqual(status.runtimeConfig.diagnostics.configuredMode, 'on');
  assert.strictEqual(Object.hasOwn(status.runtimeConfig.diagnostics, 'effectiveMode'), false);
  assert.strictEqual(Object.hasOwn(router, 'dispatch'), false);

  const rejection = new Error('kernel failed');
  kernel.rejection = rejection;
  await assert.rejects(
    router.message(messagePayload),
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
  const legacyRouter = createHarnessRouter({
    legacyKernel: new RecordingLegacyKernel(outputByOperation),
    runtimeConfig: legacyConfig,
    requestIdFactory: () => 'legacy-request',
  });
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

  console.log('harness-router.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
