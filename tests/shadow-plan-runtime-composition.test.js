'use strict';

const assert = require('assert');

const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');
const {
  createLegacyKernelAdapter,
} = require('../main/agent_runtime/legacy_kernel_adapter');
const {
  SHADOW_PLAN_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
  SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS,
  SHADOW_PLAN_RUNTIME_COMPOSITION_STATES,
  SHADOW_PLAN_RUNTIME_COMPOSITION_VERSION,
  createShadowPlanRuntimeComposition,
} = require('../main/agent_runtime/shadow_plan_runtime_composition');
const {
  createContextPackPromptProjector,
} = require('../main/services/context_pack_prompt_projection');
const {
  wrapUntrustedPromptSection,
} = require('../cortex/security/ai_trust_boundary');

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function createLegacyKernel() {
  return createLegacyKernelAdapter({
    plan: async () => ({ ok: true, response: 'legacy', action: null }),
    message: async () => ({ ok: true, response: 'legacy' }),
    execute: async () => ({ ok: true, modifiedFiles: [] }),
  });
}

function createClient({ closeFailure = null } = {}) {
  const calls = {
    close: 0,
    request: 0,
    start: 0,
    status: 0,
    subscribe: 0,
  };
  const client = Object.freeze({
    isolationProfile() {
      return Object.freeze({
        version: 'codex-app-server-shadow-isolation-profile.v1',
        complete: true,
        disabledMcpServerNames: Object.freeze([]),
      });
    },
    close() {
      calls.close += 1;
      if (closeFailure) return Promise.reject(closeFailure);
      return Promise.resolve(Object.freeze({
        ok: true,
        closed: true,
        processTerminated: false,
        forced: false,
        exited: true,
      }));
    },
    request() {
      calls.request += 1;
      return Promise.reject(new Error('not used by composition tests'));
    },
    start() {
      calls.start += 1;
      return Promise.resolve(Object.freeze({ ok: true }));
    },
    status() {
      calls.status += 1;
      return Object.freeze({
        version: 'test-client.v1',
        state: 'idle',
        pinnedCliVersion: '0.150.0-alpha.12.2',
        verifiedCliVersion: null,
        running: false,
        pendingRequests: 0,
        inboundNotifications: 0,
        stderrBytes: 0,
        lastFailureCode: null,
      });
    },
    subscribe() {
      calls.subscribe += 1;
      return Object.freeze(() => undefined);
    },
  });
  return { calls, client };
}

function createGrader() {
  return Object.freeze({
    version: 'trusted-shadow-evidence-grader.v1',
    grade() {
      return Promise.reject(new Error('not used by composition tests'));
    },
  });
}

function createReadyOptions(overrides = {}) {
  const clientFixture = overrides.clientFixture || createClient();
  return {
    clientFixture,
    options: {
      runtimeConfig: createHarnessRuntimeConfig({
        env: { FABER_HARNESS_V2_MODE: 'shadow' },
      }),
      adapterEnabled: true,
      authoritativeKernel: createLegacyKernel(),
      client: clientFixture.client,
      promptProjector: createContextPackPromptProjector({
        wrapUntrustedPromptSection,
      }),
      grader: createGrader(),
      requestIdFactory: (() => {
        let sequence = 0;
        return () => `composition-rpc-${sequence += 1}`;
      })(),
      ...overrides.options,
    },
  };
}

function assertUnavailable(runtime, state, reason) {
  assert.strictEqual(runtime.shadowPlanRunner, null);
  assert.strictEqual(runtime.snapshot(), null);
  const diagnostics = runtime.diagnostics();
  assert.strictEqual(diagnostics.state, state);
  assert.strictEqual(diagnostics.reason, reason);
  assert.strictEqual(diagnostics.shadowRunnerAvailable, false);
  assert.strictEqual(diagnostics.shadowKernelId, null);
  assertDeepFrozen(diagnostics);
}

async function testInactiveModesNeverInspectRuntimeAuthorities() {
  let authorityGetterCalls = 0;
  const legacyOptions = {
    runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
    adapterEnabled: true,
  };
  Object.defineProperty(legacyOptions, 'grader', {
    enumerable: true,
    get() {
      authorityGetterCalls += 1;
      throw new Error('inactive composition must not inspect grader authority');
    },
  });
  const invalidOptions = createShadowPlanRuntimeComposition(legacyOptions);
  assertUnavailable(
    invalidOptions,
    SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.INVALID_OPTIONS
  );
  assert.strictEqual(authorityGetterCalls, 0);

  const disabled = createShadowPlanRuntimeComposition({
    runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
    adapterEnabled: true,
  });
  assertUnavailable(
    disabled,
    SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.DISABLED,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.MODE_NOT_SHADOW
  );

  const killed = createShadowPlanRuntimeComposition({
    runtimeConfig: createHarnessRuntimeConfig({
      env: {
        FABER_HARNESS_V2_MODE: 'shadow',
        FABER_HARNESS_V2_KILL_SWITCH: 'true',
      },
    }),
    adapterEnabled: true,
  });
  assertUnavailable(
    killed,
    SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.DISABLED,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.KILL_SWITCH
  );
}

async function testRequestedShadowFailsClosedWithoutEveryAuthority() {
  const shadowConfig = createHarnessRuntimeConfig({
    env: { FABER_HARNESS_V2_MODE: 'shadow' },
  });
  const adapterDisabled = createShadowPlanRuntimeComposition({
    runtimeConfig: shadowConfig,
    adapterEnabled: false,
  });
  assertUnavailable(
    adapterDisabled,
    SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.ADAPTER_DISABLED
  );

  const missingKernel = createShadowPlanRuntimeComposition({
    runtimeConfig: shadowConfig,
    adapterEnabled: true,
  });
  assertUnavailable(
    missingKernel,
    SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.AUTHORITATIVE_KERNEL_UNAVAILABLE
  );

  const missingClient = createShadowPlanRuntimeComposition({
    runtimeConfig: shadowConfig,
    adapterEnabled: true,
    authoritativeKernel: createLegacyKernel(),
  });
  assertUnavailable(
    missingClient,
    SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.CLIENT_UNAVAILABLE
  );

  const clientFixture = createClient();
  const missingProjector = createShadowPlanRuntimeComposition({
    runtimeConfig: shadowConfig,
    adapterEnabled: true,
    authoritativeKernel: createLegacyKernel(),
    client: clientFixture.client,
  });
  assertUnavailable(
    missingProjector,
    SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.PROMPT_PROJECTOR_UNAVAILABLE
  );

  const missingGrader = createShadowPlanRuntimeComposition({
    runtimeConfig: shadowConfig,
    adapterEnabled: true,
    authoritativeKernel: createLegacyKernel(),
    client: clientFixture.client,
    promptProjector: createContextPackPromptProjector({
      wrapUntrustedPromptSection,
    }),
  });
  assertUnavailable(
    missingGrader,
    SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.BLOCKED,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.EVIDENCE_GRADER_UNAVAILABLE
  );
  assert.strictEqual(clientFixture.calls.start, 0);
  assert.strictEqual(clientFixture.calls.request, 0);
  assert.strictEqual(clientFixture.calls.subscribe, 0);
  assert.strictEqual(clientFixture.calls.close, 0);
}

async function testCompleteCompositionIsLazyAndLifecycleOwned() {
  const fixture = createReadyOptions();
  const runtime = createShadowPlanRuntimeComposition(fixture.options);
  assert.strictEqual(Object.isFrozen(runtime), true);
  assert.strictEqual(Object.isFrozen(runtime.shadowPlanRunner), true);
  assert.strictEqual(runtime.shadowPlanRunner.version, 'shadow-plan-runner.v1');
  assert.deepStrictEqual(runtime.diagnostics(), {
    version: SHADOW_PLAN_RUNTIME_COMPOSITION_VERSION,
    state: SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.READY,
    reason: SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.READY,
    requestedMode: 'shadow',
    configuredMode: 'shadow',
    adapterEnabled: true,
    shadowRunnerAvailable: true,
    shadowKernelId: 'codex-app-server-shadow',
    runnerVersion: 'shadow-plan-runner.v1',
    ledgerVersion: 'shadow-plan-evaluation-ledger.v1',
    clientState: 'idle',
    closing: false,
    closed: false,
    lastCloseFailureCode: null,
  });
  assertDeepFrozen(runtime.diagnostics());
  const snapshot = runtime.snapshot();
  assert.strictEqual(snapshot.totals.eligibleCases, 0);
  assert.strictEqual(snapshot.gate.status, 'insufficient_data');
  assertDeepFrozen(snapshot);
  assert.strictEqual(fixture.clientFixture.calls.start, 0);
  assert.strictEqual(fixture.clientFixture.calls.request, 0);
  assert.strictEqual(fixture.clientFixture.calls.subscribe, 0);

  const firstClose = runtime.close();
  const secondClose = runtime.close();
  assert.strictEqual(firstClose, secondClose);
  const closeReceipt = await firstClose;
  assert.deepStrictEqual(closeReceipt, {
    schemaVersion: SHADOW_PLAN_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
    ok: true,
    closed: true,
    drained: true,
    clientClosed: true,
    lastFailureCode: null,
  });
  assertDeepFrozen(closeReceipt);
  assert.strictEqual(fixture.clientFixture.calls.close, 1);
  assert.strictEqual(fixture.clientFixture.calls.start, 0);
  assert.strictEqual(runtime.diagnostics().state, SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.CLOSED);
  assert.strictEqual(runtime.diagnostics().reason, SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.CLOSED);
  assert.strictEqual(runtime.diagnostics().closed, true);
}

async function testClientCloseFailureIsSanitizedAndStillTerminal() {
  const privateFailure = new Error('private command path and provider output');
  privateFailure.code = 'PRIVATE_CLIENT_CLOSE_FAILURE';
  const clientFixture = createClient({ closeFailure: privateFailure });
  const fixture = createReadyOptions({ clientFixture });
  const runtime = createShadowPlanRuntimeComposition(fixture.options);
  const receipt = await runtime.close();
  assert.strictEqual(receipt.ok, false);
  assert.strictEqual(receipt.closed, true);
  assert.strictEqual(receipt.drained, true);
  assert.strictEqual(receipt.clientClosed, false);
  assert.strictEqual(
    receipt.lastFailureCode,
    SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS.CLIENT_CLOSE_FAILED
  );
  assert.strictEqual(runtime.diagnostics().state, SHADOW_PLAN_RUNTIME_COMPOSITION_STATES.CLOSED);
  assert.doesNotMatch(JSON.stringify(receipt), /private command|provider output/i);
  assert.doesNotMatch(JSON.stringify(runtime.diagnostics()), /private command|provider output/i);
}

async function run() {
  assert.strictEqual(
    SHADOW_PLAN_RUNTIME_COMPOSITION_VERSION,
    'shadow-plan-runtime-composition.v1'
  );
  assert.strictEqual(
    SHADOW_PLAN_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
    'shadow-plan-runtime-close-receipt.v1'
  );
  assertDeepFrozen(SHADOW_PLAN_RUNTIME_COMPOSITION_REASONS);
  assertDeepFrozen(SHADOW_PLAN_RUNTIME_COMPOSITION_STATES);

  await testInactiveModesNeverInspectRuntimeAuthorities();
  await testRequestedShadowFailsClosedWithoutEveryAuthority();
  await testCompleteCompositionIsLazyAndLifecycleOwned();
  await testClientCloseFailureIsSanitizedAndStillTerminal();
  console.log('shadow plan runtime composition tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
