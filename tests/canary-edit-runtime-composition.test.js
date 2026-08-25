'use strict';

const assert = require('assert');

const {
  CANARY_EDIT_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
  CANARY_EDIT_RUNTIME_COMPOSITION_REASONS,
  CANARY_EDIT_RUNTIME_COMPOSITION_STATES,
  CANARY_EDIT_RUNTIME_COMPOSITION_VERSION,
  createCanaryEditRuntimeComposition,
} = require('../main/agent_runtime/canary_edit_runtime_composition');
const {
  CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');
const {
  createLegacyKernelAdapter,
} = require('../main/agent_runtime/legacy_kernel_adapter');
const {
  HARNESS_OPERATIONS,
  createExecuteRequest,
} = require('../main/agent_runtime/harness_contracts');

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, reject, resolve };
}

function createClient({ closeFailure = null, state = 'ready' } = {}) {
  const calls = { close: 0, status: 0 };
  const client = Object.freeze({
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
    status() {
      calls.status += 1;
      return Object.freeze({ state });
    },
  });
  return { calls, client };
}

function createLegacyKernel({ executeDeferred = null } = {}) {
  return createLegacyKernelAdapter({
    plan: async () => ({ ok: true, response: 'legacy', action: null }),
    message: async () => ({ ok: true, response: 'legacy' }),
    execute: async () => {
      if (executeDeferred) return executeDeferred.promise;
      return { ok: true, engine: 'legacy' };
    },
  });
}

function createReadyOptions({
  clientFixture = createClient(),
  executeDeferred = null,
  options = {},
} = {}) {
  const calls = {
    edit: 0,
    facts: 0,
    open: 0,
    promote: 0,
  };
  const authoritativeKernel = createLegacyKernel({ executeDeferred });
  const admissionFactsProvider = Object.freeze({
    version: 'canary-runtime-facts.test.v1',
    inspect() {
      calls.facts += 1;
      throw new Error('not used by composition-only tests');
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-runtime-facts.test.v1',
        authorityMode: 'exact_job_action_root',
        checkpointMode: 'authority_bound',
        mutationObservation: 'external_exact',
        rolloutPolicy: 'external_exact',
        failureMode: 'deny',
      });
    },
  });
  const workspaceSessionPort = Object.freeze({
    version: 'canary-runtime-workspace.test.v1',
    open() {
      calls.open += 1;
      return Promise.reject(new Error('not used by composition-only tests'));
    },
    discard() {
      return Promise.reject(new Error('not used by composition-only tests'));
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-runtime-workspace.test.v1',
        workspaceIsolation: 'per_job_staging',
        sourceMutation: 'forbidden',
        discardMode: 'verified',
      });
    },
  });
  const canaryEditor = Object.freeze({
    version: 'canary-runtime-editor.test.v1',
    kernelId: 'codex-app-server-canary',
    execute() {
      calls.edit += 1;
      return Promise.reject(new Error('not used by composition-only tests'));
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-runtime-editor.test.v1',
        kernelId: 'codex-app-server-canary',
        workspaceMode: 'provided_session_only',
        sourceMutation: 'forbidden',
        settlementMode: 'terminal',
        networkMode: 'disabled',
        installMode: 'disabled',
      });
    },
  });
  const promotionBackend = Object.freeze({
    version: 'canary-runtime-promotion.test.v1',
    promote() {
      calls.promote += 1;
      return Promise.reject(new Error('not used by composition-only tests'));
    },
    revert() {
      return Promise.reject(new Error('not used by composition-only tests'));
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-runtime-promotion.test.v1',
        conflictCheck: 'required',
        inversePatch: 'job_scoped',
        rejectionFrontier: 'pre_write_only',
        settlementMode: 'terminal_receipt',
        branchMutation: 'forbidden',
        gitIndexMutation: 'forbidden',
        userDirtyMutation: 'forbidden',
      });
    },
  });
  const evidenceJournal = Object.freeze({
    version: 'canary-rollout-evidence-journal.v1',
    load() {
      return Object.freeze({
        schemaVersion: 'canary-rollout-evidence-journal-snapshot.v1',
        evidence: Object.freeze([]),
      });
    },
    append() {
      return undefined;
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-rollout-evidence-journal.v1',
        records: 0,
      });
    },
  });
  return {
    calls,
    clientFixture,
    options: {
      runtimeConfig: createHarnessRuntimeConfig({
        env: { FABER_HARNESS_V2_MODE: 'canary' },
      }),
      adapterEnabled: true,
      authoritativeKernel,
      admissionFactsProvider,
      cohortSeed: 'canary-runtime-composition-tests-v1',
      workspaceSessionPort,
      canaryEditor,
      promotionBackend,
      evidenceJournal,
      client: clientFixture.client,
      ...options,
    },
  };
}

function assertUnavailable(runtime, state, reason) {
  assert.strictEqual(runtime.canaryEditRunner, null);
  assert.strictEqual(runtime.evidenceSink, null);
  assert.strictEqual(runtime.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL), null);
  assert.strictEqual(runtime.advancement(CANARY_ROLLOUT_STAGES.INTERNAL), null);
  const diagnostics = runtime.diagnostics();
  assert.strictEqual(diagnostics.state, state);
  assert.strictEqual(diagnostics.reason, reason);
  assert.strictEqual(diagnostics.canaryRunnerAvailable, false);
  assert.strictEqual(diagnostics.canaryKernelId, null);
  assertDeepFrozen(diagnostics);
}

async function testInactiveAndKilledModesStayDisabled() {
  const disabled = createCanaryEditRuntimeComposition({
    runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
    adapterEnabled: true,
  });
  assertUnavailable(
    disabled,
    CANARY_EDIT_RUNTIME_COMPOSITION_STATES.DISABLED,
    CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.MODE_NOT_CANARY
  );

  const killed = createCanaryEditRuntimeComposition({
    runtimeConfig: createHarnessRuntimeConfig({
      env: {
        FABER_HARNESS_V2_MODE: 'canary',
        FABER_HARNESS_V2_KILL_SWITCH: 'true',
      },
    }),
    adapterEnabled: true,
  });
  assertUnavailable(
    killed,
    CANARY_EDIT_RUNTIME_COMPOSITION_STATES.DISABLED,
    CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.KILL_SWITCH
  );

  let getterCalls = 0;
  const invalid = {
    runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
    adapterEnabled: true,
  };
  Object.defineProperty(invalid, 'client', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not inspect accessor authority');
    },
  });
  assertUnavailable(
    createCanaryEditRuntimeComposition(invalid),
    CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
    CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.INVALID_OPTIONS
  );
  assert.strictEqual(getterCalls, 0);
}

async function testRequestedCanaryFailsClosedWithoutEveryAuthority() {
  const runtimeConfig = createHarnessRuntimeConfig({
    env: { FABER_HARNESS_V2_MODE: 'canary' },
  });
  const cases = [
    [{ runtimeConfig, adapterEnabled: false }, 'adapter_disabled'],
    [{ runtimeConfig, adapterEnabled: true }, 'authoritative_kernel_unavailable'],
  ];
  const fixture = createReadyOptions();
  const dependencyOrder = [
    ['authoritativeKernel', 'admission_facts_provider_unavailable'],
    ['admissionFactsProvider', 'cohort_seed_unavailable'],
    ['cohortSeed', 'workspace_session_unavailable'],
    ['workspaceSessionPort', 'canary_editor_unavailable'],
    ['canaryEditor', 'promotion_backend_unavailable'],
    ['promotionBackend', 'evidence_journal_unavailable'],
    ['evidenceJournal', 'client_unavailable'],
  ];
  const partial = { runtimeConfig, adapterEnabled: true };
  for (const [field, nextReason] of dependencyOrder) {
    partial[field] = fixture.options[field];
    cases.push([{ ...partial }, nextReason]);
  }
  for (const [options, reason] of cases) {
    const runtime = createCanaryEditRuntimeComposition(options);
    assertUnavailable(runtime, CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED, reason);
  }
  assert.strictEqual(fixture.calls.facts, 0);
  assert.strictEqual(fixture.calls.open, 0);
  assert.strictEqual(fixture.calls.edit, 0);
  assert.strictEqual(fixture.calls.promote, 0);
  assert.strictEqual(fixture.clientFixture.calls.close, 0);

  const idleClient = createClient({ state: 'idle' });
  const idleFixture = createReadyOptions({ clientFixture: idleClient });
  const idleRuntime = createCanaryEditRuntimeComposition(idleFixture.options);
  assertUnavailable(
    idleRuntime,
    CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
    CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.CLIENT_NOT_READY
  );

  let kernelGetterCalls = 0;
  const unsafeEditor = {
    version: fixture.options.canaryEditor.version,
    execute: fixture.options.canaryEditor.execute,
    diagnostics: fixture.options.canaryEditor.diagnostics,
  };
  Object.defineProperty(unsafeEditor, 'kernelId', {
    enumerable: true,
    get() {
      kernelGetterCalls += 1;
      throw new Error('must not invoke editor authority getter');
    },
  });
  Object.freeze(unsafeEditor);
  const unsafeRuntime = createCanaryEditRuntimeComposition({
    ...fixture.options,
    canaryEditor: unsafeEditor,
  });
  assertUnavailable(
    unsafeRuntime,
    CANARY_EDIT_RUNTIME_COMPOSITION_STATES.BLOCKED,
    CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.COMPOSITION_FAILED
  );
  assert.strictEqual(kernelGetterCalls, 0);
}

async function testReadyCompositionIsLazyAndOwnsEvidence() {
  const fixture = createReadyOptions();
  const runtime = createCanaryEditRuntimeComposition(fixture.options);
  assert.strictEqual(Object.isFrozen(runtime), true);
  assert.strictEqual(Object.isFrozen(runtime.canaryEditRunner), true);
  assert.strictEqual(Object.isFrozen(runtime.evidenceSink), true);
  assert.deepStrictEqual(runtime.diagnostics(), {
    version: CANARY_EDIT_RUNTIME_COMPOSITION_VERSION,
    state: CANARY_EDIT_RUNTIME_COMPOSITION_STATES.READY,
    reason: CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.READY,
    requestedMode: 'canary',
    configuredMode: 'canary',
    adapterEnabled: true,
    canaryRunnerAvailable: true,
    canaryKernelId: 'codex-app-server-canary',
    runnerVersion: 'canary-edit-runner.v1',
    executorVersion: 'canary-transactional-staging-executor.v1',
    ledgerVersion: 'canary-rollout-evidence-ledger.v1',
    journalVersion: 'canary-rollout-evidence-journal.v1',
    recoveredEvidence: 0,
    rolloutEvidenceObserver: {
      version: 'canary-rollout-evidence-observer-adapter.v1',
      evidenceSinkVersion: 'canary-rollout-evidence-sink.v1',
      runnerVersion: 'canary-edit-runner.v1',
      requests: 0,
      eligibleObservations: 0,
      ineligibleObservations: 0,
      baselineEvidence: 0,
      canaryEvidence: 0,
      conservativeFailures: 0,
      incompleteObservations: 0,
      evidenceRejections: 0,
      lastFailureCode: null,
    },
    clientState: 'ready',
    inFlightExecutions: 0,
    closing: false,
    closed: false,
    lastCloseFailureCode: null,
  });
  assertDeepFrozen(runtime.diagnostics());
  const initial = runtime.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.strictEqual(initial.gate.status, 'insufficient_data');
  runtime.evidenceSink.record(Object.freeze({
    schemaVersion: CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
    jobId: 'composition-baseline-1',
    projectId: 'composition-project-1',
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    route: 'baseline',
    eligible: true,
    terminal: true,
    succeeded: true,
    manualRollback: false,
    corrupted: false,
    dataLossIncident: false,
    securityIncident: false,
    duplicateExternalEffect: false,
  }));
  assert.strictEqual(
    runtime.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL).totals.baselineJobs,
    1
  );
  assert.strictEqual(
    runtime.advancement(CANARY_ROLLOUT_STAGES.INTERNAL).allowed,
    false
  );
  assert.strictEqual(fixture.calls.facts, 0);
  assert.strictEqual(fixture.calls.open, 0);
  assert.strictEqual(fixture.calls.edit, 0);
  assert.strictEqual(fixture.calls.promote, 0);

  const firstClose = runtime.close();
  const secondClose = runtime.close();
  assert.strictEqual(firstClose, secondClose);
  const receipt = await firstClose;
  assert.deepStrictEqual(receipt, {
    schemaVersion: CANARY_EDIT_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
    ok: true,
    closed: true,
    drained: true,
    clientClosed: true,
    lastFailureCode: null,
  });
  assert.strictEqual(fixture.clientFixture.calls.close, 1);
  assert.strictEqual(runtime.diagnostics().state, 'closed');
  assert.strictEqual(runtime.diagnostics().closed, true);
}

async function testCloseDrainsTrackedExecutionBeforeClient() {
  const pendingExecution = deferred();
  const fixture = createReadyOptions({ executeDeferred: pendingExecution });
  const runtime = createCanaryEditRuntimeComposition(fixture.options);
  const request = createExecuteRequest(
    Object.freeze({ type: 'run_command', command: 'npm test' }),
    Object.freeze({ id: 'project-a', rootPath: '/workspace/project-a' }),
    { requestId: 'composition-drain-a' }
  );
  const execution = runtime.canaryEditRunner.execute(request);
  assert.strictEqual(runtime.diagnostics().inFlightExecutions, 1);
  const closing = runtime.close();
  await Promise.resolve();
  assert.strictEqual(fixture.clientFixture.calls.close, 0);
  pendingExecution.resolve({ ok: true, engine: 'legacy' });
  const result = await execution;
  assert.strictEqual(result.operation, HARNESS_OPERATIONS.EXECUTE);
  const receipt = await closing;
  assert.strictEqual(receipt.drained, true);
  assert.strictEqual(receipt.clientClosed, true);
  assert.strictEqual(fixture.clientFixture.calls.close, 1);
  await assert.rejects(
    runtime.canaryEditRunner.execute(request),
    /closing|closed/
  );
}

async function testClientCloseFailureIsSanitizedAndTerminal() {
  const privateFailure = new Error('private client command and token');
  const clientFixture = createClient({ closeFailure: privateFailure });
  const fixture = createReadyOptions({ clientFixture });
  const runtime = createCanaryEditRuntimeComposition(fixture.options);
  const receipt = await runtime.close();
  assert.strictEqual(receipt.ok, false);
  assert.strictEqual(receipt.closed, true);
  assert.strictEqual(receipt.drained, true);
  assert.strictEqual(receipt.clientClosed, false);
  assert.strictEqual(
    receipt.lastFailureCode,
    CANARY_EDIT_RUNTIME_COMPOSITION_REASONS.CLIENT_CLOSE_FAILED
  );
  assert.doesNotMatch(JSON.stringify(receipt), /private client|token/i);
}

async function run() {
  assert.strictEqual(
    CANARY_EDIT_RUNTIME_COMPOSITION_VERSION,
    'canary-edit-runtime-composition.v1'
  );
  assert.strictEqual(
    CANARY_EDIT_RUNTIME_CLOSE_RECEIPT_SCHEMA_VERSION,
    'canary-edit-runtime-close-receipt.v1'
  );
  assertDeepFrozen(CANARY_EDIT_RUNTIME_COMPOSITION_REASONS);
  assertDeepFrozen(CANARY_EDIT_RUNTIME_COMPOSITION_STATES);
  await testInactiveAndKilledModesStayDisabled();
  await testRequestedCanaryFailsClosedWithoutEveryAuthority();
  await testReadyCompositionIsLazyAndOwnsEvidence();
  await testCloseDrainsTrackedExecutionBeforeClient();
  await testClientCloseFailureIsSanitizedAndTerminal();
  console.log('canary edit runtime composition tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
