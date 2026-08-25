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
  CANARY_EDIT_LIFECYCLE_STATES,
  CANARY_EDIT_MUTATION_FRONTIERS,
  createCanaryEditLifecycle,
} = require('../main/agent_runtime/canary_edit_lifecycle');
const {
  CANARY_PROMOTION_REQUEST_VERSION,
  CANARY_PROMOTION_RECEIPT_VERSION,
  CANARY_PROMOTION_REVERT_RECEIPT_VERSION,
  assertCanaryPromotionReceipt,
  assertCanaryPromotionRequest,
  assertCanaryPromotionRevertReceipt,
  createCanaryPromotionReceipt,
  createCanaryPromotionRequest,
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

function fixture(overrides = {}) {
  const binding = createCapabilityDelegationBinding({
    projectId: 'project-promotion-a',
    canonicalRootPath: '/workspace/project-promotion-a',
    realRootPath: '/workspace/project-promotion-a',
    sessionId: 'session-promotion-a',
    jobId: 'job-promotion-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-promotion-a',
    binding,
    sourceRootIdentityDigest: digest('b'),
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: '/private/staging/promotion-a',
    workspaceRealRootPath: '/private/staging/promotion-a',
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
    requestId: 'canary-promotion-request-a',
    checkpoint,
    workspaceRequest,
    workspaceLease,
  });
  const writeReceipt = createCanaryStagingWriteReceipt({
    session,
    actionDigest: digest('e'),
    writeSetDigest: digest('f'),
    changedPaths: ['src/app.js', 'src/styles.css'],
    stagingWritten: true,
    sourceMutated: false,
  });
  const sourceSnapshot = Object.freeze({
    checkpointDigest: checkpoint.checkpointDigest,
    sourceRootIdentityDigest: session.sourceRootIdentityDigest,
    sourceStateDigest: digest('1'),
    branchHeadDigest: digest('2'),
    gitIndexDigest: digest('3'),
    userDirtyDigest: digest('4'),
    ...overrides.sourceSnapshot,
  });
  const rootMutation = Object.freeze({
    canonicalRootPath: binding.canonicalRootPath,
    ownerJobId: binding.jobId,
    activeOtherMutatingJobs: 0,
    ...overrides.rootMutation,
  });
  const requestInput = {
    promotionId: overrides.promotionId || 'canary-promotion-a',
    session,
    writeReceipt,
    checkpoint,
    workspaceRequest,
    sourceSnapshot,
    rootMutation,
  };
  const promotionRequest = createCanaryPromotionRequest(requestInput);
  return {
    binding,
    checkpoint,
    promotionRequest,
    requestInput,
    rootMutation,
    session,
    sourceSnapshot,
    workspaceRequest,
    writeReceipt,
  };
}

assert.strictEqual(CANARY_PROMOTION_REQUEST_VERSION, 'canary-promotion-request.v2');
assert.strictEqual(CANARY_PROMOTION_RECEIPT_VERSION, 'canary-promotion-receipt.v1');
assert.strictEqual(
  CANARY_PROMOTION_REVERT_RECEIPT_VERSION,
  'canary-promotion-revert-receipt.v1'
);

const current = fixture();
assert.deepStrictEqual(current.promotionRequest, {
  version: CANARY_PROMOTION_REQUEST_VERSION,
  promotionId: 'canary-promotion-a',
  requestId: current.session.requestId,
  stagingId: current.session.stagingId,
  projectId: current.binding.projectId,
  jobId: current.binding.jobId,
  checkpointDigest: current.checkpoint.checkpointDigest,
  sourceRootPath: current.binding.canonicalRootPath,
  sourceRealRootPath: current.binding.realRootPath,
  sourceRootIdentityDigest: current.session.sourceRootIdentityDigest,
  workspaceAuthorityDigest: current.session.workspaceAuthorityDigest,
  workspaceRootIdentityDigest: current.session.workspaceRootIdentityDigest,
  workspaceRootPath: current.session.workspaceRootPath,
  workspaceRealRootPath: current.session.workspaceRealRootPath,
  actionDigest: current.writeReceipt.actionDigest,
  writeSetDigest: current.writeReceipt.writeSetDigest,
  changedPaths: ['src/app.js', 'src/styles.css'],
  sourceStateDigest: current.sourceSnapshot.sourceStateDigest,
  branchHeadDigest: current.sourceSnapshot.branchHeadDigest,
  gitIndexDigest: current.sourceSnapshot.gitIndexDigest,
  userDirtyDigest: current.sourceSnapshot.userDirtyDigest,
  rootMutationExclusive: true,
});
assertDeepFrozen(current.promotionRequest);
assert.deepStrictEqual(
  assertCanaryPromotionRequest(current.promotionRequest, current.requestInput),
  current.promotionRequest
);
assert.throws(
  () => createCanaryPromotionReceipt({
    request: Object.freeze({
      ...current.promotionRequest,
      workspaceRootPath: current.promotionRequest.sourceRootPath,
    }),
    sourceAfterDigest: digest('5'),
    inversePatchDigest: digest('6'),
    branchHeadAfterDigest: current.promotionRequest.branchHeadDigest,
    gitIndexAfterDigest: current.promotionRequest.gitIndexDigest,
    userDirtyAfterDigest: current.promotionRequest.userDirtyDigest,
    conflictChecked: true,
    sourceMutated: true,
    promotionApplied: true,
  }),
  /promotion request|root|workspace/i
);

const promotionReceipt = createCanaryPromotionReceipt({
  request: current.promotionRequest,
  sourceAfterDigest: digest('5'),
  inversePatchDigest: digest('6'),
  branchHeadAfterDigest: current.promotionRequest.branchHeadDigest,
  gitIndexAfterDigest: current.promotionRequest.gitIndexDigest,
  userDirtyAfterDigest: current.promotionRequest.userDirtyDigest,
  conflictChecked: true,
  sourceMutated: true,
  promotionApplied: true,
});
assert.deepStrictEqual(promotionReceipt, {
  version: CANARY_PROMOTION_RECEIPT_VERSION,
  promotionId: current.promotionRequest.promotionId,
  requestId: current.promotionRequest.requestId,
  stagingId: current.promotionRequest.stagingId,
  projectId: current.promotionRequest.projectId,
  jobId: current.promotionRequest.jobId,
  checkpointDigest: current.promotionRequest.checkpointDigest,
  sourceBeforeDigest: current.promotionRequest.sourceStateDigest,
  sourceAfterDigest: digest('5'),
  inversePatchDigest: digest('6'),
  writeSetDigest: current.promotionRequest.writeSetDigest,
  changedPaths: ['src/app.js', 'src/styles.css'],
  branchHeadBeforeDigest: current.promotionRequest.branchHeadDigest,
  branchHeadAfterDigest: current.promotionRequest.branchHeadDigest,
  gitIndexBeforeDigest: current.promotionRequest.gitIndexDigest,
  gitIndexAfterDigest: current.promotionRequest.gitIndexDigest,
  userDirtyBeforeDigest: current.promotionRequest.userDirtyDigest,
  userDirtyAfterDigest: current.promotionRequest.userDirtyDigest,
  conflictChecked: true,
  sourceMutated: true,
  promotionApplied: true,
});
assertDeepFrozen(promotionReceipt);
assert.deepStrictEqual(
  assertCanaryPromotionReceipt(promotionReceipt, current.promotionRequest),
  promotionReceipt
);

const revertReceipt = createCanaryPromotionRevertReceipt({
  request: current.promotionRequest,
  promotionReceipt,
  sourceRestoredDigest: current.promotionRequest.sourceStateDigest,
  branchHeadAfterDigest: current.promotionRequest.branchHeadDigest,
  gitIndexAfterDigest: current.promotionRequest.gitIndexDigest,
  userDirtyAfterDigest: current.promotionRequest.userDirtyDigest,
  inversePatchApplied: true,
  sourceRestored: true,
});
assert.strictEqual(revertReceipt.version, CANARY_PROMOTION_REVERT_RECEIPT_VERSION);
assert.strictEqual(revertReceipt.promotionId, current.promotionRequest.promotionId);
assert.strictEqual(revertReceipt.inversePatchDigest, promotionReceipt.inversePatchDigest);
assert.strictEqual(revertReceipt.sourceRestoredDigest, current.promotionRequest.sourceStateDigest);
assert.strictEqual(revertReceipt.inversePatchApplied, true);
assert.strictEqual(revertReceipt.sourceRestored, true);
assert.deepStrictEqual(revertReceipt.lifecycleReceipt, {
  schemaVersion: 'canary-edit-cleanup-receipt.v1',
  jobId: current.binding.jobId,
  stagingId: current.session.stagingId,
  disposition: 'reverted',
  clean: true,
});
assertDeepFrozen(revertReceipt);
assert.deepStrictEqual(
  assertCanaryPromotionRevertReceipt(revertReceipt, {
    request: current.promotionRequest,
    promotionReceipt,
  }),
  revertReceipt
);

const lifecycle = createCanaryEditLifecycle({
  jobId: current.binding.jobId,
  stagingId: current.session.stagingId,
});
lifecycle.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING });
lifecycle.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.SOURCE });
assert.strictEqual(lifecycle.requestFallback({ reason: 'promotion_failed' }).ok, false);
assert.strictEqual(lifecycle.confirmCleanup(revertReceipt.lifecycleReceipt).ok, true);
assert.strictEqual(lifecycle.startLegacy().ok, true);
assert.strictEqual(lifecycle.snapshot().state, CANARY_EDIT_LIFECYCLE_STATES.LEGACY_STARTED);

for (const requestOverride of [
  {
    rootMutation: {
      canonicalRootPath: current.binding.canonicalRootPath,
      ownerJobId: current.binding.jobId,
      activeOtherMutatingJobs: 1,
    },
  },
  {
    rootMutation: {
      canonicalRootPath: current.binding.canonicalRootPath,
      ownerJobId: 'other-job',
      activeOtherMutatingJobs: 0,
    },
  },
  {
    sourceSnapshot: {
      ...current.sourceSnapshot,
      checkpointDigest: digest('9'),
    },
  },
  {
    sourceSnapshot: {
      ...current.sourceSnapshot,
      sourceRootIdentityDigest: digest('8'),
    },
  },
]) {
  assert.throws(
    () => createCanaryPromotionRequest({
      ...current.requestInput,
      ...requestOverride,
      rootMutation: requestOverride.rootMutation
        ? Object.freeze(requestOverride.rootMutation)
        : current.rootMutation,
      sourceSnapshot: requestOverride.sourceSnapshot
        ? Object.freeze(requestOverride.sourceSnapshot)
        : current.sourceSnapshot,
    }),
    /promotion|checkpoint|exclusive|identity/i
  );
}

for (const receiptOverride of [
  { sourceAfterDigest: current.promotionRequest.sourceStateDigest },
  { branchHeadAfterDigest: digest('7') },
  { gitIndexAfterDigest: digest('7') },
  { userDirtyAfterDigest: digest('7') },
  { conflictChecked: false },
  { sourceMutated: false },
  { promotionApplied: false },
]) {
  assert.throws(
    () => createCanaryPromotionReceipt({
      request: current.promotionRequest,
      sourceAfterDigest: digest('5'),
      inversePatchDigest: digest('6'),
      branchHeadAfterDigest: current.promotionRequest.branchHeadDigest,
      gitIndexAfterDigest: current.promotionRequest.gitIndexDigest,
      userDirtyAfterDigest: current.promotionRequest.userDirtyDigest,
      conflictChecked: true,
      sourceMutated: true,
      promotionApplied: true,
      ...receiptOverride,
    }),
    /promotion receipt|preserve|source/i
  );
}

for (const revertOverride of [
  { sourceRestoredDigest: digest('7') },
  { branchHeadAfterDigest: digest('7') },
  { gitIndexAfterDigest: digest('7') },
  { userDirtyAfterDigest: digest('7') },
  { inversePatchApplied: false },
  { sourceRestored: false },
]) {
  assert.throws(
    () => createCanaryPromotionRevertReceipt({
      request: current.promotionRequest,
      promotionReceipt,
      sourceRestoredDigest: current.promotionRequest.sourceStateDigest,
      branchHeadAfterDigest: current.promotionRequest.branchHeadDigest,
      gitIndexAfterDigest: current.promotionRequest.gitIndexDigest,
      userDirtyAfterDigest: current.promotionRequest.userDirtyDigest,
      inversePatchApplied: true,
      sourceRestored: true,
      ...revertOverride,
    }),
    /revert receipt|restore|preserve|inverse/i
  );
}

assert.throws(
  () => assertCanaryPromotionReceipt(
    Object.freeze({ ...promotionReceipt, jobId: 'other-job' }),
    current.promotionRequest
  ),
  /promotion receipt/i
);
assert.throws(
  () => assertCanaryPromotionRevertReceipt(
    Object.freeze({ ...revertReceipt, sourceRestored: false }),
    { request: current.promotionRequest, promotionReceipt }
  ),
  /revert receipt/i
);

let getterCalls = 0;
const accessorInput = { ...current.requestInput };
Object.defineProperty(accessorInput, 'promotionId', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 'canary-promotion-accessor';
  },
});
assert.throws(() => createCanaryPromotionRequest(accessorInput), /promotion request/i);
assert.strictEqual(getterCalls, 0);
assert.throws(
  () => createCanaryPromotionRequest(new Proxy(current.requestInput, {})),
  /promotion request/i
);

console.log('canary promotion contract tests passed');
