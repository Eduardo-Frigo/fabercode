'use strict';

const assert = require('assert');
const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  CANARY_PROMOTION_TRANSACTION_VERSION,
  createCanaryPromotionController,
} = require('../main/agent_runtime/canary_promotion_controller');
const {
  createCanaryPromotionReceipt,
  createCanaryPromotionRevertReceipt,
} = require('../main/agent_runtime/canary_promotion_contract');
const {
  CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SINK_VERSION,
} = require('../main/agent_runtime/canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  createCanaryStagingSession,
  createCanaryStagingWriteReceipt,
} = require('../main/agent_runtime/canary_staging_contract');
const {
  CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_PROMOTION_SINK_VERSION,
  CANARY_MANUAL_ROLLBACK_RECEIPT_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_SERVICE_REASONS,
  CANARY_MANUAL_ROLLBACK_SERVICE_VERSION,
  createCanaryManualRollbackService,
} = require('../main/agent_runtime/canary_manual_rollback_service');
const {
  CANARY_MANUAL_ROLLBACK_JOURNAL_REMOVE_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
} = require('../main/agent_runtime/canary_manual_rollback_journal_contract');

function digest(character) {
  return 'sha256:' + character.repeat(64);
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

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function promotionInput() {
  const binding = createCapabilityDelegationBinding({
    projectId: 'project-manual-rollback-a',
    canonicalRootPath: '/workspace/project-manual-rollback-a',
    realRootPath: '/workspace/project-manual-rollback-a',
    sessionId: 'session-manual-rollback-a',
    jobId: 'job-manual-rollback-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-manual-rollback-a',
    binding,
    sourceRootIdentityDigest: digest('b'),
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: '/private/staging/manual-rollback-a',
    workspaceRealRootPath: '/private/staging/manual-rollback-a',
    workspaceRootIdentityDigest: digest('c'),
  });
  const checkpoint = Object.freeze({
    checkpointDigest: digest('d'),
    checkpointVerified: true,
    projectId: binding.projectId,
    canonicalRootPath: binding.canonicalRootPath,
    jobId: binding.jobId,
  });
  const session = createCanaryStagingSession({
    requestId: 'canary-manual-rollback-request-a',
    checkpoint,
    workspaceRequest,
    workspaceLease,
  });
  const writeReceipt = createCanaryStagingWriteReceipt({
    session,
    actionDigest: digest('e'),
    writeSetDigest: digest('f'),
    changedPaths: ['src/app.js'],
    stagingWritten: true,
    sourceMutated: false,
  });
  return Object.freeze({
    promotionId: 'canary-manual-rollback-promotion-a',
    session,
    writeReceipt,
    checkpoint,
    workspaceRequest,
    sourceSnapshot: Object.freeze({
      checkpointDigest: checkpoint.checkpointDigest,
      sourceRootIdentityDigest: session.sourceRootIdentityDigest,
      sourceStateDigest: digest('1'),
      branchHeadDigest: digest('2'),
      gitIndexDigest: digest('3'),
      userDirtyDigest: digest('4'),
    }),
    rootMutation: Object.freeze({
      canonicalRootPath: binding.canonicalRootPath,
      ownerJobId: binding.jobId,
      activeOtherMutatingJobs: 0,
    }),
  });
}

function createControllerFixture({ revertGate = null, revertFailure = null } = {}) {
  const calls = { promote: 0, revert: 0 };
  const backend = Object.freeze({
    version: 'canary-manual-rollback-backend.test.v1',
    promote(request) {
      calls.promote += 1;
      return Promise.resolve(createCanaryPromotionReceipt({
        request,
        sourceAfterDigest: digest('5'),
        inversePatchDigest: digest('6'),
        branchHeadAfterDigest: request.branchHeadDigest,
        gitIndexAfterDigest: request.gitIndexDigest,
        userDirtyAfterDigest: request.userDirtyDigest,
        conflictChecked: true,
        sourceMutated: true,
        promotionApplied: true,
      }));
    },
    revert(input) {
      calls.revert += 1;
      if (revertFailure && revertFailure.active) {
        return Promise.reject(new Error('private rollback failure'));
      }
      const receipt = createCanaryPromotionRevertReceipt({
        request: input.request,
        promotionReceipt: input.promotionReceipt,
        sourceRestoredDigest: input.request.sourceStateDigest,
        branchHeadAfterDigest: input.request.branchHeadDigest,
        gitIndexAfterDigest: input.request.gitIndexDigest,
        userDirtyAfterDigest: input.request.userDirtyDigest,
        inversePatchApplied: true,
        sourceRestored: true,
      });
      return revertGate
        ? revertGate.promise.then(() => receipt)
        : Promise.resolve(receipt);
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-manual-rollback-backend.test.v1',
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
  return {
    calls,
    controller: createCanaryPromotionController({ backend }),
  };
}

async function createTransaction(controller) {
  const transaction = await controller.promote(promotionInput());
  assert.strictEqual(transaction.version, CANARY_PROMOTION_TRANSACTION_VERSION);
  return transaction;
}

function registration(transaction) {
  return Object.freeze({
    schemaVersion:
      CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    transaction,
  });
}

function rollbackInput(transaction, overrides = {}) {
  return Object.freeze({
    jobId: transaction.request.jobId,
    projectId: transaction.request.projectId,
    promotionId: transaction.request.promotionId,
    reason: 'manual_user_rollback',
    ...overrides,
  });
}

function reconciliationFixture({ failFirst = false } = {}) {
  const calls = [];
  let remainingFailures = failFirst ? 1 : 0;
  return {
    calls,
    sink: Object.freeze({
      version: CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SINK_VERSION,
      record(value) {
        calls.push(value);
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error('private reconciliation persistence failure');
        }
        return undefined;
      },
    }),
  };
}

function registrationJournalFixture() {
  const active = new Map();
  const calls = { load: 0, append: [], remove: [] };
  const journal = Object.freeze({
    version: CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
    load() {
      calls.load += 1;
      return Object.freeze({
        schemaVersion:
          CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
        registrations: Object.freeze([...active.values()]),
      });
    },
    append(value) {
      calls.append.push(value);
      active.set(value.transaction.request.promotionId, value);
      return undefined;
    },
    remove(value) {
      calls.remove.push(value);
      assert.strictEqual(
        value.schemaVersion,
        CANARY_MANUAL_ROLLBACK_JOURNAL_REMOVE_SCHEMA_VERSION
      );
      active.delete(value.promotionId);
      return undefined;
    },
    diagnostics() {
      return Object.freeze({
        version: CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
        durability: 'private_user_data',
        stateModel: 'registered_removed',
      });
    },
  });
  return { active, calls, journal };
}

async function testVerifiedRollbackReconcilesOnce() {
  const controllerFixture = createControllerFixture();
  const transaction = await createTransaction(controllerFixture.controller);
  const reconciliation = reconciliationFixture();
  const registrationJournal = registrationJournalFixture();
  const service = createCanaryManualRollbackService({
    promotionController: controllerFixture.controller,
    reconciliationSink: reconciliation.sink,
    registrationJournal: registrationJournal.journal,
  });
  assert.strictEqual(CANARY_MANUAL_ROLLBACK_SERVICE_VERSION,
    'canary-manual-rollback-service.v1');
  assert.strictEqual(CANARY_MANUAL_ROLLBACK_PROMOTION_SINK_VERSION,
    'canary-manual-rollback-promotion-sink.v1');
  assert.strictEqual(CANARY_MANUAL_ROLLBACK_RECEIPT_SCHEMA_VERSION,
    'canary-manual-rollback-receipt.v1');
  assert.deepStrictEqual(Reflect.ownKeys(service), [
    'version', 'promotionSink', 'rollback', 'diagnostics',
  ]);
  assert.deepStrictEqual(Reflect.ownKeys(service.promotionSink), [
    'version', 'record', 'cancel',
  ]);
  assertDeepFrozen(service.promotionSink);

  assert.strictEqual(service.promotionSink.record(registration(transaction)), undefined);
  const pending = service.rollback(rollbackInput(transaction));
  assert.strictEqual(util.types.isPromise(pending), true);
  const receipt = await pending;
  assert.strictEqual(receipt.schemaVersion,
    CANARY_MANUAL_ROLLBACK_RECEIPT_SCHEMA_VERSION);
  assert.strictEqual(receipt.jobId, transaction.request.jobId);
  assert.strictEqual(receipt.projectId, transaction.request.projectId);
  assert.strictEqual(receipt.promotionId, transaction.request.promotionId);
  assert.strictEqual(receipt.rolloutStage, CANARY_ROLLOUT_STAGES.INTERNAL);
  assert.strictEqual(receipt.revertReceipt.inversePatchApplied, true);
  assert.strictEqual(receipt.revertReceipt.sourceRestored, true);
  assertDeepFrozen(receipt);
  assert.strictEqual(controllerFixture.calls.revert, 1);
  assert.strictEqual(reconciliation.calls.length, 1);
  assert.strictEqual(registrationJournal.calls.append.length, 1);
  assert.strictEqual(registrationJournal.calls.remove.length, 1);
  assert.strictEqual(registrationJournal.active.size, 0);
  assert.deepStrictEqual(reconciliation.calls[0], {
    schemaVersion: CANARY_ROLLOUT_EVIDENCE_RECONCILIATION_SCHEMA_VERSION,
    reconciliationId: receipt.reconciliationId,
    jobId: transaction.request.jobId,
    projectId: transaction.request.projectId,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    manualRollback: true,
    corrupted: false,
    dataLossIncident: false,
    securityIncident: false,
    duplicateExternalEffect: false,
  });
  assertDeepFrozen(reconciliation.calls[0]);
  assert.strictEqual(await service.rollback(rollbackInput(transaction)), receipt);
  assert.strictEqual(controllerFixture.calls.revert, 1);
  assert.strictEqual(reconciliation.calls.length, 1);
}

async function testConcurrentRollbackAndReconciliationRetryAreIdempotent() {
  const gate = deferred();
  const controllerFixture = createControllerFixture({ revertGate: gate });
  const transaction = await createTransaction(controllerFixture.controller);
  const reconciliation = reconciliationFixture({ failFirst: true });
  const registrationJournal = registrationJournalFixture();
  const service = createCanaryManualRollbackService({
    promotionController: controllerFixture.controller,
    reconciliationSink: reconciliation.sink,
    registrationJournal: registrationJournal.journal,
  });
  service.promotionSink.record(registration(transaction));
  const input = rollbackInput(transaction);
  const first = service.rollback(input);
  const second = service.rollback(input);
  assert.strictEqual(first, second);
  assert.strictEqual(controllerFixture.calls.revert, 1);
  gate.resolve();
  await assert.rejects(
    first,
    (error) => error.code
      === CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.RECONCILIATION_FAILED
  );
  assert.strictEqual(controllerFixture.calls.revert, 1);
  assert.strictEqual(reconciliation.calls.length, 1);
  const recovered = await service.rollback(input);
  assert.strictEqual(recovered.revertReceipt.sourceRestored, true);
  assert.strictEqual(controllerFixture.calls.revert, 1);
  assert.strictEqual(reconciliation.calls.length, 2);
}

async function testFailureCancelAndHostileTargetsFailClosed() {
  const revertFailure = { active: true };
  const controllerFixture = createControllerFixture({ revertFailure });
  const transaction = await createTransaction(controllerFixture.controller);
  const reconciliation = reconciliationFixture();
  const registrationJournal = registrationJournalFixture();
  const service = createCanaryManualRollbackService({
    promotionController: controllerFixture.controller,
    reconciliationSink: reconciliation.sink,
    registrationJournal: registrationJournal.journal,
  });
  const registered = registration(transaction);
  service.promotionSink.record(registered);
  assert.strictEqual(service.promotionSink.record(registered), undefined);
  await assert.rejects(
    service.rollback(rollbackInput(transaction)),
    (error) => error.code
      === CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.ROLLBACK_FAILED
  );
  assert.strictEqual(reconciliation.calls.length, 0);
  revertFailure.active = false;
  assert.strictEqual(
    (await service.rollback(rollbackInput(transaction))).revertReceipt.sourceRestored,
    true
  );

  const otherFixture = createControllerFixture();
  const otherTransaction = await createTransaction(otherFixture.controller);
  const otherRegistrationJournal = registrationJournalFixture();
  const otherService = createCanaryManualRollbackService({
    promotionController: otherFixture.controller,
    reconciliationSink: reconciliationFixture().sink,
    registrationJournal: otherRegistrationJournal.journal,
  });
  otherService.promotionSink.record(registration(otherTransaction));
  assert.strictEqual(otherService.promotionSink.cancel(Object.freeze({
    promotionId: otherTransaction.request.promotionId,
    reason: 'automatic_revert_before_completion',
  })), undefined);
  await assert.rejects(
    otherService.rollback(rollbackInput(otherTransaction)),
    (error) => error.code
      === CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.PROMOTION_NOT_FOUND
  );
  await assert.rejects(
    otherService.rollback(rollbackInput(otherTransaction, { jobId: 'other-job' })),
    (error) => error.code
      === CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.PROMOTION_NOT_FOUND
  );

  let traps = 0;
  const hostile = new Proxy({}, {
    ownKeys() { traps += 1; throw new Error('must not execute'); },
    get() { traps += 1; throw new Error('must not execute'); },
  });
  assert.throws(
    () => otherService.promotionSink.record(hostile),
    (error) => error.code
      === CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.INVALID_INPUT
  );
  assert.strictEqual(traps, 0);
  await assert.rejects(
    otherService.rollback(hostile),
    (error) => error.code
      === CANARY_MANUAL_ROLLBACK_SERVICE_REASONS.INVALID_INPUT
  );
  assert.strictEqual(traps, 0);
}

async function testRegistrationSurvivesServiceRestart() {
  const controllerFixture = createControllerFixture();
  const transaction = await createTransaction(controllerFixture.controller);
  const reconciliation = reconciliationFixture();
  const registrationJournal = registrationJournalFixture();
  const firstService = createCanaryManualRollbackService({
    promotionController: controllerFixture.controller,
    reconciliationSink: reconciliation.sink,
    registrationJournal: registrationJournal.journal,
  });
  firstService.promotionSink.record(registration(transaction));
  assert.strictEqual(registrationJournal.active.size, 1);

  const restartedService = createCanaryManualRollbackService({
    promotionController: controllerFixture.controller,
    reconciliationSink: reconciliation.sink,
    registrationJournal: registrationJournal.journal,
  });
  const receipt = await restartedService.rollback(rollbackInput(transaction));
  assert.strictEqual(receipt.revertReceipt.sourceRestored, true);
  assert.strictEqual(controllerFixture.calls.revert, 1);
  assert.strictEqual(registrationJournal.calls.load, 2);
  assert.strictEqual(registrationJournal.active.size, 0);
}

async function run() {
  await testVerifiedRollbackReconcilesOnce();
  await testConcurrentRollbackAndReconciliationRetryAreIdempotent();
  await testFailureCancelAndHostileTargetsFailClosed();
  await testRegistrationSurvivesServiceRestart();
  console.log('canary-manual-rollback-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
