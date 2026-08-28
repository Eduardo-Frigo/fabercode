'use strict';

const assert = require('assert');

const {
  createExecutionWorkspaceRegistry,
} = require('../main/capabilities/execution_workspace_registry');
const {
  createProjectRootAuthorityRegistry,
} = require('../main/capabilities/project_root_authority_registry');
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
  CANARY_EDIT_PRODUCTION_KERNEL_ID,
  CANARY_EDIT_PRODUCTION_RUNTIME_VERSION,
  createCanaryEditProductionRuntime,
} = require('../main/services/canary_edit_production_runtime');

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

function createFixture({
  mode = 'canary',
  rollbackRecords = Object.freeze([]),
  manualRegistrations = Object.freeze([]),
} = {}) {
  const calls = {
    authority: 0,
    close: 0,
    mutation: 0,
    manualJournalLoad: 0,
    promotionId: 0,
    rollout: 0,
    rollbackStoreLoad: 0,
    status: 0,
    terminalCompleted: 0,
    terminalFailed: 0,
  };
  const authoritativeKernel = createLegacyKernelAdapter({
    plan: async () => ({ ok: true, action: null }),
    message: async () => ({ ok: true, response: 'legacy' }),
    execute: async () => ({ ok: true, engine: 'legacy' }),
  });
  const authorityService = Object.freeze({
    authorizeExecute() {
      calls.authority += 1;
      throw new Error('must remain lazy until a request exists');
    },
    authorizeProjectRootLease() {
      calls.authority += 1;
      throw new Error('must remain lazy until a request exists');
    },
  });
  const client = Object.freeze({
    close() {
      calls.close += 1;
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
      return Object.freeze({ state: 'ready' });
    },
  });
  const evidenceJournal = Object.freeze({
    version: 'canary-rollout-evidence-journal.v2',
    load() {
      return Object.freeze({
        schemaVersion: 'canary-rollout-evidence-journal-snapshot.v2',
        events: Object.freeze([]),
      });
    },
    append() {
      return undefined;
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-rollout-evidence-journal.v2',
        records: 0,
      });
    },
  });
  const promotionRollbackStore = Object.freeze({
    version: 'canary-promotion-rollback-store.v1',
    load() {
      calls.rollbackStoreLoad += 1;
      return Object.freeze({
        schemaVersion: 'canary-promotion-rollback-store-snapshot.v1',
        records: rollbackRecords,
      });
    },
    prepare() { return undefined; },
    commit() { return undefined; },
    cancel() { return undefined; },
    settle() { return undefined; },
    diagnostics() {
      return Object.freeze({
        version: 'canary-promotion-rollback-store.v1',
        durability: 'private_user_data',
        stateModel: 'prepared_committed_settled',
      });
    },
  });
  const manualRollbackJournal = Object.freeze({
    version: 'canary-manual-rollback-journal.v1',
    load() {
      calls.manualJournalLoad += 1;
      return Object.freeze({
        schemaVersion: 'canary-manual-rollback-journal-snapshot.v1',
        registrations: manualRegistrations,
      });
    },
    append() { return undefined; },
    remove() { return undefined; },
    diagnostics() {
      return Object.freeze({
        version: 'canary-manual-rollback-journal.v1',
        durability: 'private_user_data',
        stateModel: 'registered_removed',
      });
    },
  });
  const runtime = createCanaryEditProductionRuntime({
    runtimeConfig: createHarnessRuntimeConfig({
      env: mode === 'legacy' ? {} : { FABER_HARNESS_V2_MODE: mode },
    }),
    adapterEnabled: true,
    authoritativeKernel,
    authorityService,
    projectRootAuthorityRegistry: createProjectRootAuthorityRegistry(),
    executionWorkspaceRegistry: createExecutionWorkspaceRegistry(),
    inspectRootMutation() {
      calls.mutation += 1;
      throw new Error('must remain lazy until a request exists');
    },
    inspectRollout() {
      calls.rollout += 1;
      throw new Error('must remain lazy until a request exists');
    },
    promotionIdFactory() {
      calls.promotionId += 1;
      throw new Error('must remain lazy until a request exists');
    },
    cohortSeed: 'canary-production-runtime-tests-v1',
    evidenceJournal,
    promotionRollbackStore,
    manualRollbackJournal,
    client,
    onCanaryCompleted() {
      calls.terminalCompleted += 1;
      return Object.freeze({ ok: true });
    },
    onCanaryFailed() {
      calls.terminalFailed += 1;
      return Object.freeze({ ok: true });
    },
    minimumCanaryJobs: 3,
    minimumBaselineJobs: 3,
  });
  return { calls, runtime };
}

async function testReadyRuntimeComposesOnlyProductionAdapters() {
  const fixture = createFixture();
  const { runtime } = fixture;
  assert.strictEqual(
    CANARY_EDIT_PRODUCTION_RUNTIME_VERSION,
    'canary-edit-production-runtime.v1'
  );
  assert.strictEqual(
    CANARY_EDIT_PRODUCTION_KERNEL_ID,
    'codex-app-server-canary'
  );
  assert.strictEqual(Object.isFrozen(runtime), true);
  assert.deepStrictEqual(Reflect.ownKeys(runtime), [
    'version',
    'canaryEditRunner',
    'evidenceSink',
    'reconciliationSink',
    'manualRollback',
    'snapshot',
    'advancement',
    'diagnostics',
    'close',
  ]);
  assert.strictEqual(runtime.version, CANARY_EDIT_PRODUCTION_RUNTIME_VERSION);
  assert.strictEqual(Object.isFrozen(runtime.canaryEditRunner), true);
  assert.strictEqual(Object.isFrozen(runtime.evidenceSink), true);
  assert.strictEqual(Object.isFrozen(runtime.reconciliationSink), true);
  assert.strictEqual(Object.isFrozen(runtime.manualRollback), true);

  const diagnostics = runtime.diagnostics();
  assert.deepStrictEqual(Reflect.ownKeys(diagnostics), [
    'version',
    'runtime',
    'admissionFactsProvider',
    'sourceSnapshotProvider',
    'workspaceSessionPort',
    'canaryEditor',
    'promotionBackend',
    'promotionRollbackStore',
    'manualRollbackJournal',
    'evidenceJournal',
    'terminalObserver',
  ]);
  assert.strictEqual(diagnostics.version, CANARY_EDIT_PRODUCTION_RUNTIME_VERSION);
  assert.strictEqual(diagnostics.runtime.state, 'ready');
  assert.strictEqual(diagnostics.runtime.canaryRunnerAvailable, true);
  assert.strictEqual(
    diagnostics.runtime.canaryKernelId,
    CANARY_EDIT_PRODUCTION_KERNEL_ID
  );
  assert.strictEqual(
    diagnostics.runtime.rolloutEvidenceObserver.version,
    'canary-rollout-evidence-observer-adapter.v1'
  );
  assert.strictEqual(
    diagnostics.admissionFactsProvider.version,
    'canary-admission-facts-provider.v1'
  );
  assert.strictEqual(
    diagnostics.sourceSnapshotProvider.version,
    'canary-source-snapshot-provider.v1'
  );
  assert.strictEqual(
    diagnostics.workspaceSessionPort.version,
    'canary-workspace-session-port-adapter.v1'
  );
  assert.strictEqual(
    diagnostics.canaryEditor.version,
    'canary-local-staging-editor-adapter.v1'
  );
  assert.strictEqual(
    diagnostics.canaryEditor.kernelId,
    CANARY_EDIT_PRODUCTION_KERNEL_ID
  );
  assert.strictEqual(
    diagnostics.promotionBackend.version,
    'canary-local-promotion-backend.v1'
  );
  assert.strictEqual(
    diagnostics.promotionRollbackStore.version,
    'canary-promotion-rollback-store.v1'
  );
  assert.strictEqual(
    diagnostics.manualRollbackJournal.version,
    'canary-manual-rollback-journal.v1'
  );
  assert.strictEqual(
    diagnostics.evidenceJournal.version,
    'canary-rollout-evidence-journal.v2'
  );
  assert.strictEqual(
    diagnostics.terminalObserver.version,
    'canary-edit-terminal-observer-adapter.v1'
  );
  assert.strictEqual(
    diagnostics.terminalObserver.canaryKernelId,
    CANARY_EDIT_PRODUCTION_KERNEL_ID
  );
  assertDeepFrozen(diagnostics);
  assert.deepStrictEqual(fixture.calls, {
    authority: 0,
    close: 0,
    mutation: 0,
    manualJournalLoad: 2,
    promotionId: 0,
    rollout: 0,
    rollbackStoreLoad: 2,
    status: 2,
    terminalCompleted: 0,
    terminalFailed: 0,
  });

  const snapshot = runtime.snapshot(CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.strictEqual(snapshot.gate.status, 'insufficient_data');
  assertDeepFrozen(snapshot);
  const firstClose = await runtime.close();
  const secondClose = await runtime.close();
  assert.strictEqual(firstClose, secondClose);
  assert.strictEqual(firstClose.ok, true);
  assert.strictEqual(firstClose.closed, true);
  assert.strictEqual(fixture.calls.close, 1);
}

async function testInactiveRuntimeStaysDisabled() {
  const fixture = createFixture({ mode: 'legacy' });
  assert.strictEqual(fixture.runtime.canaryEditRunner, null);
  assert.strictEqual(fixture.runtime.evidenceSink, null);
  assert.strictEqual(fixture.runtime.reconciliationSink, null);
  assert.strictEqual(fixture.runtime.manualRollback, null);
  const diagnostics = fixture.runtime.diagnostics();
  assert.strictEqual(diagnostics.runtime.state, 'disabled');
  assert.strictEqual(diagnostics.runtime.reason, 'mode_not_canary');
  assert.strictEqual(diagnostics.runtime.canaryRunnerAvailable, false);
  assert.strictEqual(diagnostics.terminalObserver, null);
  assert.strictEqual(fixture.calls.authority, 0);
  assert.strictEqual(fixture.calls.mutation, 0);
  assert.strictEqual(fixture.calls.rollout, 0);
  assert.strictEqual(fixture.calls.promotionId, 0);
  assert.strictEqual(fixture.calls.terminalCompleted, 0);
  assert.strictEqual(fixture.calls.terminalFailed, 0);
  await fixture.runtime.close();
  assert.strictEqual(fixture.calls.close, 0);
}

async function testDefaultOnComposesTheProductionRuntime() {
  const fixture = createFixture({ mode: 'on' });
  assert.strictEqual(fixture.runtime.diagnostics().runtime.state, 'ready');
  assert.strictEqual(
    fixture.runtime.diagnostics().runtime.configuredMode,
    'on'
  );
  assert.strictEqual(Object.isFrozen(fixture.runtime.canaryEditRunner), true);
  const receipt = await fixture.runtime.close();
  assert.strictEqual(receipt.ok, true);
}

function testInvalidAndHostileOptionsAreRejected() {
  assert.throws(
    () => createCanaryEditProductionRuntime({}),
    /production runtime options/i
  );
  const fixture = createFixture();
  assert.throws(
    () => createCanaryEditProductionRuntime({
      runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
      adapterEnabled: true,
      unexpected: fixture.runtime,
    }),
    /production runtime options/i
  );
  let traps = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'runtimeConfig', {
    enumerable: true,
    get() {
      traps += 1;
      throw new Error('must not execute');
    },
  });
  assert.throws(
    () => createCanaryEditProductionRuntime(hostile),
    /production runtime options/i
  );
  assert.strictEqual(traps, 0);
}

function rollbackAlignmentRecord(promotionId) {
  return Object.freeze({
    request: Object.freeze({ promotionId }),
  });
}

function manualAlignmentRegistration(promotionId) {
  return Object.freeze({
    transaction: Object.freeze({
      request: Object.freeze({ promotionId }),
    }),
  });
}

function testDurableRollbackStoresMustBeExactlyAligned() {
  assert.throws(
    () => createFixture({
      rollbackRecords: Object.freeze([
        rollbackAlignmentRecord('promotion-only-in-backend-store'),
      ]),
    }),
    /durable manual rollback registrations are misaligned/i
  );
  assert.throws(
    () => createFixture({
      manualRegistrations: Object.freeze([
        manualAlignmentRegistration('promotion-only-in-manual-journal'),
      ]),
    }),
    /durable manual rollback registrations are misaligned/i
  );
  assert.throws(
    () => createFixture({
      rollbackRecords: Object.freeze([
        rollbackAlignmentRecord('duplicated-promotion'),
        rollbackAlignmentRecord('duplicated-promotion'),
      ]),
      manualRegistrations: Object.freeze([
        manualAlignmentRegistration('duplicated-promotion'),
        manualAlignmentRegistration('duplicated-promotion'),
      ]),
    }),
    /durable manual rollback registrations are misaligned/i
  );
}

async function main() {
  await testReadyRuntimeComposesOnlyProductionAdapters();
  await testInactiveRuntimeStaysDisabled();
  await testDefaultOnComposesTheProductionRuntime();
  testInvalidAndHostileOptionsAreRejected();
  testDurableRollbackStoresMustBeExactlyAligned();
  console.log('canary-edit-production-runtime.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
