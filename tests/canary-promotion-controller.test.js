'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  CANARY_PROMOTION_CONTROLLER_REASONS,
  CANARY_PROMOTION_CONTROLLER_VERSION,
  CANARY_PROMOTION_TRANSACTION_VERSION,
  createCanaryPromotionController,
} = require('../main/agent_runtime/canary_promotion_controller');
const {
  CanaryPromotionBackendAmbiguousError,
  createCanaryPromotionReceipt,
  createCanaryPromotionRevertReceipt,
} = require('../main/agent_runtime/canary_promotion_contract');
const {
  createCanaryStagingSession,
  createCanaryStagingWriteReceipt,
} = require('../main/agent_runtime/canary_staging_contract');

function digest(character) {
  return 'sha256:' + character.repeat(64);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function promotionInput() {
  const binding = createCapabilityDelegationBinding({
    projectId: 'project-controller-a',
    canonicalRootPath: '/workspace/project-controller-a',
    realRootPath: '/workspace/project-controller-a',
    sessionId: 'session-controller-a',
    jobId: 'job-controller-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-controller-a',
    binding,
    sourceRootIdentityDigest: digest('b'),
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: '/private/staging/controller-a',
    workspaceRealRootPath: '/private/staging/controller-a',
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
    requestId: 'canary-controller-request-a',
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
    promotionId: 'canary-controller-promotion-a',
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

function createBackend({
  promoteRejection = null,
  revertRejection = null,
  synchronousPromote = false,
  synchronousRevert = false,
  mutatePromotionReceipt = null,
  mutateRevertReceipt = null,
  diagnosticOverrides = {},
} = {}) {
  const calls = { promote: [], revert: [] };
  const backend = Object.freeze({
    version: 'canary-promotion-backend.test.v1',
    promote(request) {
      calls.promote.push(request);
      if (promoteRejection) return Promise.reject(promoteRejection);
      let receipt = createCanaryPromotionReceipt({
        request,
        sourceAfterDigest: digest('5'),
        inversePatchDigest: digest('6'),
        branchHeadAfterDigest: request.branchHeadDigest,
        gitIndexAfterDigest: request.gitIndexDigest,
        userDirtyAfterDigest: request.userDirtyDigest,
        conflictChecked: true,
        sourceMutated: true,
        promotionApplied: true,
      });
      if (mutatePromotionReceipt) receipt = mutatePromotionReceipt(receipt);
      return synchronousPromote ? receipt : Promise.resolve(receipt);
    },
    revert(input) {
      calls.revert.push(input);
      if (revertRejection) return Promise.reject(revertRejection);
      let receipt = createCanaryPromotionRevertReceipt({
        request: input.request,
        promotionReceipt: input.promotionReceipt,
        sourceRestoredDigest: input.request.sourceStateDigest,
        branchHeadAfterDigest: input.request.branchHeadDigest,
        gitIndexAfterDigest: input.request.gitIndexDigest,
        userDirtyAfterDigest: input.request.userDirtyDigest,
        inversePatchApplied: true,
        sourceRestored: true,
      });
      if (mutateRevertReceipt) receipt = mutateRevertReceipt(receipt);
      return synchronousRevert ? receipt : Promise.resolve(receipt);
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-promotion-backend.test.v1',
        conflictCheck: 'required',
        inversePatch: 'job_scoped',
        rejectionFrontier: 'pre_write_only',
        settlementMode: 'terminal_receipt',
        branchMutation: 'forbidden',
        gitIndexMutation: 'forbidden',
        userDirtyMutation: 'forbidden',
        ...diagnosticOverrides,
      });
    },
  });
  return { backend, calls };
}

async function testPromotionAndRevertRoundTrip() {
  const backendFixture = createBackend();
  const controller = createCanaryPromotionController({
    backend: backendFixture.backend,
  });
  const input = promotionInput();
  const transaction = await controller.promote(input);
  assert.strictEqual(transaction.version, CANARY_PROMOTION_TRANSACTION_VERSION);
  assert.strictEqual(transaction.request.promotionId, input.promotionId);
  assert.strictEqual(transaction.receipt.promotionApplied, true);
  assert.strictEqual(transaction.receipt.sourceMutated, true);
  assert.strictEqual(backendFixture.calls.promote.length, 1);
  assert.strictEqual(backendFixture.calls.promote[0], transaction.request);
  assertDeepFrozen(transaction);

  const revertReceipt = await controller.revert(Object.freeze({
    transaction,
    reason: 'canary_result_invalid',
  }));
  assert.strictEqual(revertReceipt.sourceRestored, true);
  assert.strictEqual(revertReceipt.inversePatchApplied, true);
  assert.strictEqual(revertReceipt.lifecycleReceipt.disposition, 'reverted');
  assert.strictEqual(backendFixture.calls.revert.length, 1);
  assert.deepStrictEqual(backendFixture.calls.revert[0], {
    request: transaction.request,
    promotionReceipt: transaction.receipt,
    reason: 'canary_result_invalid',
  });
  assertDeepFrozen(backendFixture.calls.revert[0]);
  assertDeepFrozen(revertReceipt);
  assert.deepStrictEqual(controller.diagnostics(), {
    version: CANARY_PROMOTION_CONTROLLER_VERSION,
    backendVersion: 'canary-promotion-backend.test.v1',
    promotionContract: 'canary-promotion-request.v2',
    revertContract: 'canary-promotion-revert-receipt.v1',
  });
  assertDeepFrozen(controller.diagnostics());
}

async function testBackendFailuresAreSanitized() {
  const privatePromotionFailure = new Error('private source path and patch');
  privatePromotionFailure.code = 'PRIVATE_PROMOTION';
  const promotionBackend = createBackend({
    promoteRejection: privatePromotionFailure,
  });
  const promotionController = createCanaryPromotionController({
    backend: promotionBackend.backend,
  });
  await assert.rejects(
    promotionController.promote(promotionInput()),
    (error) => error.code === CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_FAILED
      && !/private source|patch/i.test(error.message)
  );

  const ambiguousBackend = createBackend({
    promoteRejection: new CanaryPromotionBackendAmbiguousError(),
  });
  const ambiguousController = createCanaryPromotionController({
    backend: ambiguousBackend.backend,
  });
  await assert.rejects(
    ambiguousController.promote(promotionInput()),
    (error) => error.code
      === CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_AMBIGUOUS
  );

  const revertBackend = createBackend({
    revertRejection: new Error('private inverse patch path'),
  });
  const revertController = createCanaryPromotionController({
    backend: revertBackend.backend,
  });
  const transaction = await revertController.promote(promotionInput());
  await assert.rejects(
    revertController.revert(Object.freeze({
      transaction,
      reason: 'canary_failed',
    })),
    (error) => error.code === CANARY_PROMOTION_CONTROLLER_REASONS.REVERT_FAILED
      && !/private inverse/i.test(error.message)
  );
}

async function testInvalidOrSynchronousReceiptsFailClosed() {
  const synchronousPromotion = createBackend({ synchronousPromote: true });
  const synchronousController = createCanaryPromotionController({
    backend: synchronousPromotion.backend,
  });
  await assert.rejects(
    synchronousController.promote(promotionInput()),
    (error) => error.code === CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_FAILED
  );

  const invalidPromotion = createBackend({
    mutatePromotionReceipt(receipt) {
      return Object.freeze({ ...receipt, gitIndexAfterDigest: digest('9') });
    },
  });
  const invalidPromotionController = createCanaryPromotionController({
    backend: invalidPromotion.backend,
  });
  await assert.rejects(
    invalidPromotionController.promote(promotionInput()),
    (error) => error.code
      === CANARY_PROMOTION_CONTROLLER_REASONS.PROMOTION_RECEIPT_INVALID
  );

  const synchronousRevert = createBackend({ synchronousRevert: true });
  const synchronousRevertController = createCanaryPromotionController({
    backend: synchronousRevert.backend,
  });
  const transaction = await synchronousRevertController.promote(promotionInput());
  await assert.rejects(
    synchronousRevertController.revert(Object.freeze({
      transaction,
      reason: 'canary_failed',
    })),
    (error) => error.code === CANARY_PROMOTION_CONTROLLER_REASONS.REVERT_FAILED
  );

  const invalidRevert = createBackend({
    mutateRevertReceipt(receipt) {
      return Object.freeze({ ...receipt, sourceRestored: false });
    },
  });
  const invalidRevertController = createCanaryPromotionController({
    backend: invalidRevert.backend,
  });
  const invalidRevertTransaction = await invalidRevertController.promote(
    promotionInput()
  );
  await assert.rejects(
    invalidRevertController.revert(Object.freeze({
      transaction: invalidRevertTransaction,
      reason: 'canary_failed',
    })),
    (error) => error.code
      === CANARY_PROMOTION_CONTROLLER_REASONS.REVERT_RECEIPT_INVALID
  );
}

function testConstructionRejectsUnsafeBackend() {
  const unsafe = createBackend({
    diagnosticOverrides: { inversePatch: 'workspace_reset' },
  });
  assert.throws(
    () => createCanaryPromotionController({ backend: unsafe.backend }),
    /inverse|backend|job_scoped/i
  );
  const normal = createBackend();
  assert.throws(
    () => createCanaryPromotionController({ backend: { ...normal.backend } }),
    /backend/
  );
}

async function testInvalidInputNeverCallsBackend() {
  const backendFixture = createBackend();
  const controller = createCanaryPromotionController({
    backend: backendFixture.backend,
  });
  await assert.rejects(
    controller.promote(Object.freeze({ ...promotionInput(), unexpected: true })),
    (error) => error.code === CANARY_PROMOTION_CONTROLLER_REASONS.INVALID_INPUT
  );
  await assert.rejects(
    controller.revert(Object.freeze({ transaction: null, reason: 'bad' })),
    (error) => error.code === CANARY_PROMOTION_CONTROLLER_REASONS.INVALID_INPUT
  );
  assert.strictEqual(backendFixture.calls.promote.length, 0);
  assert.strictEqual(backendFixture.calls.revert.length, 0);
}

async function run() {
  assert.strictEqual(
    CANARY_PROMOTION_CONTROLLER_VERSION,
    'canary-promotion-controller.v1'
  );
  assert.strictEqual(
    CANARY_PROMOTION_TRANSACTION_VERSION,
    'canary-promotion-transaction.v1'
  );
  assert.strictEqual(Object.isFrozen(CANARY_PROMOTION_CONTROLLER_REASONS), true);
  testConstructionRejectsUnsafeBackend();
  await testPromotionAndRevertRoundTrip();
  await testBackendFailuresAreSanitized();
  await testInvalidOrSynchronousReceiptsFailClosed();
  await testInvalidInputNeverCallsBackend();
  console.log('canary promotion controller tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
