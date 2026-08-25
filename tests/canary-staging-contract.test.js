'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  CANARY_STAGING_DISCARD_RECEIPT_VERSION,
  CANARY_STAGING_SESSION_VERSION,
  CANARY_STAGING_WRITE_RECEIPT_VERSION,
  assertCanaryStagingDiscardReceipt,
  assertCanaryStagingSession,
  assertCanaryStagingWriteReceipt,
  createCanaryStagingDiscardReceipt,
  createCanaryStagingSession,
  createCanaryStagingWriteReceipt,
} = require('../main/agent_runtime/canary_staging_contract');
const {
  CANARY_EDIT_LIFECYCLE_STATES,
  CANARY_EDIT_MUTATION_FRONTIERS,
  createCanaryEditLifecycle,
} = require('../main/agent_runtime/canary_edit_lifecycle');

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
    projectId: 'project-staging-a',
    canonicalRootPath: '/workspace/project-staging-a',
    realRootPath: '/workspace/project-staging-a',
    sessionId: 'session-staging-a',
    jobId: 'job-staging-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
    ...overrides.binding,
  });
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: overrides.leaseId || 'workspace-lease-canary-a',
    binding,
    sourceRootIdentityDigest: overrides.sourceRootIdentityDigest || digest('b'),
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: overrides.workspaceRootPath || '/private/staging/canary-a',
    workspaceRealRootPath:
      overrides.workspaceRealRootPath || '/private/staging/canary-a',
    workspaceRootIdentityDigest: overrides.workspaceRootIdentityDigest || digest('c'),
  });
  const checkpoint = Object.freeze({
    checkpointDigest: overrides.checkpointDigest || digest('d'),
    checkpointVerified: true,
    projectId: binding.projectId,
    canonicalRootPath: binding.canonicalRootPath,
    jobId: binding.jobId,
    ...overrides.checkpoint,
  });
  const requestId = overrides.requestId || 'canary-staging-request-a';
  const session = createCanaryStagingSession({
    requestId,
    checkpoint,
    workspaceRequest,
    workspaceLease,
  });
  return {
    binding,
    checkpoint,
    requestId,
    session,
    workspaceLease,
    workspaceRequest,
  };
}

assert.strictEqual(CANARY_STAGING_SESSION_VERSION, 'canary-staging-session.v1');
assert.strictEqual(
  CANARY_STAGING_WRITE_RECEIPT_VERSION,
  'canary-staging-write-receipt.v1'
);
assert.strictEqual(
  CANARY_STAGING_DISCARD_RECEIPT_VERSION,
  'canary-staging-discard-receipt.v1'
);

const current = fixture();
assert.deepStrictEqual(current.session, {
  version: CANARY_STAGING_SESSION_VERSION,
  requestId: current.requestId,
  stagingId: current.workspaceLease.leaseId,
  projectId: current.binding.projectId,
  jobId: current.binding.jobId,
  checkpointDigest: current.checkpoint.checkpointDigest,
  sourceRootPath: current.binding.canonicalRootPath,
  sourceRealRootPath: current.binding.realRootPath,
  sourceRootIdentityDigest: current.workspaceLease.sourceRootIdentityDigest,
  workspaceAuthorityDigest: current.workspaceLease.workspaceAuthorityDigest,
  workspaceRootIdentityDigest: current.workspaceLease.workspaceRootIdentityDigest,
  workspaceRootPath: current.workspaceLease.workspaceRootPath,
  workspaceRealRootPath: current.workspaceLease.workspaceRealRootPath,
});
assertDeepFrozen(current.session);
assert.deepStrictEqual(
  assertCanaryStagingSession(current.session, {
    requestId: current.requestId,
    checkpoint: current.checkpoint,
    workspaceRequest: current.workspaceRequest,
  }),
  current.session
);

const writeReceipt = createCanaryStagingWriteReceipt({
  session: current.session,
  actionDigest: digest('e'),
  writeSetDigest: digest('f'),
  changedPaths: ['src/app.js', 'src/styles.css'],
  stagingWritten: true,
  sourceMutated: false,
});
assert.deepStrictEqual(writeReceipt, {
  version: CANARY_STAGING_WRITE_RECEIPT_VERSION,
  requestId: current.requestId,
  stagingId: current.session.stagingId,
  jobId: current.binding.jobId,
  checkpointDigest: current.checkpoint.checkpointDigest,
  workspaceAuthorityDigest: current.session.workspaceAuthorityDigest,
  workspaceRootIdentityDigest: current.session.workspaceRootIdentityDigest,
  actionDigest: digest('e'),
  writeSetDigest: digest('f'),
  changedPaths: ['src/app.js', 'src/styles.css'],
  stagingWritten: true,
  sourceMutated: false,
});
assertDeepFrozen(writeReceipt);
assert.deepStrictEqual(
  assertCanaryStagingWriteReceipt(writeReceipt, current.session),
  writeReceipt
);

const workspaceDiscardRequest = createExecutionWorkspaceDiscardRequest({
  request: current.workspaceRequest,
  lease: current.workspaceLease,
});
const workspaceDiscardReceipt = createExecutionWorkspaceDiscardReceipt({
  request: workspaceDiscardRequest,
  discarded: true,
});
const discardReceipt = createCanaryStagingDiscardReceipt({
  session: current.session,
  workspaceDiscardRequest,
  workspaceDiscardReceipt,
});
assert.strictEqual(discardReceipt.version, CANARY_STAGING_DISCARD_RECEIPT_VERSION);
assert.strictEqual(discardReceipt.requestId, current.requestId);
assert.strictEqual(discardReceipt.stagingId, current.session.stagingId);
assert.strictEqual(discardReceipt.disposition, 'discarded');
assert.strictEqual(discardReceipt.clean, true);
assert.deepStrictEqual(discardReceipt.lifecycleReceipt, {
  schemaVersion: 'canary-edit-cleanup-receipt.v1',
  jobId: current.binding.jobId,
  stagingId: current.session.stagingId,
  disposition: 'discarded',
  clean: true,
});
assertDeepFrozen(discardReceipt);
assert.deepStrictEqual(
  assertCanaryStagingDiscardReceipt(discardReceipt, {
    session: current.session,
    workspaceDiscardRequest,
  }),
  discardReceipt
);

const lifecycle = createCanaryEditLifecycle({
  jobId: current.binding.jobId,
  stagingId: current.session.stagingId,
});
assert.strictEqual(
  lifecycle.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING }).ok,
  true
);
assert.strictEqual(lifecycle.requestFallback({ reason: 'canary_failed' }).ok, false);
assert.strictEqual(lifecycle.confirmCleanup(discardReceipt.lifecycleReceipt).ok, true);
assert.strictEqual(lifecycle.startLegacy().ok, true);
assert.strictEqual(lifecycle.snapshot().state, CANARY_EDIT_LIFECYCLE_STATES.LEGACY_STARTED);

assert.throws(
  () => createCanaryStagingSession({
    requestId: current.requestId,
    checkpoint: Object.freeze({
      ...current.checkpoint,
      projectId: 'wrong-project',
    }),
    workspaceRequest: current.workspaceRequest,
    workspaceLease: current.workspaceLease,
  }),
  /checkpoint|binding/i
);
assert.throws(
  () => assertCanaryStagingSession(current.session, {
    requestId: 'wrong-request',
    checkpoint: current.checkpoint,
    workspaceRequest: current.workspaceRequest,
  }),
  /session|request/i
);

for (const changedPaths of [
  ['/absolute/path.js'],
  ['src/../outside.js'],
  ['src/app.js', 'src/app.js'],
  ['src/z.js', 'src/a.js'],
]) {
  assert.throws(
    () => createCanaryStagingWriteReceipt({
      session: current.session,
      actionDigest: digest('e'),
      writeSetDigest: digest('f'),
      changedPaths,
      stagingWritten: true,
      sourceMutated: false,
    }),
    /changedPaths|write receipt/i
  );
}
assert.throws(
  () => createCanaryStagingWriteReceipt({
    session: current.session,
    actionDigest: digest('e'),
    writeSetDigest: digest('f'),
    changedPaths: ['src/app.js'],
    stagingWritten: true,
    sourceMutated: true,
  }),
  /source|write receipt/i
);
assert.throws(
  () => assertCanaryStagingWriteReceipt(
    Object.freeze({ ...writeReceipt, requestId: 'wrong-request' }),
    current.session
  ),
  /write receipt/i
);

const other = fixture({
  requestId: 'other-request',
  leaseId: 'workspace-lease-canary-other',
  binding: {
    sessionId: 'session-staging-other',
    jobId: 'job-staging-other',
    submissionDigest: digest('1'),
  },
  sourceRootIdentityDigest: digest('2'),
  workspaceRootIdentityDigest: digest('3'),
  workspaceRootPath: '/private/staging/canary-other',
  workspaceRealRootPath: '/private/staging/canary-other',
  checkpointDigest: digest('4'),
});
assert.throws(
  () => createCanaryStagingDiscardReceipt({
    session: current.session,
    workspaceDiscardRequest: createExecutionWorkspaceDiscardRequest({
      request: other.workspaceRequest,
      lease: other.workspaceLease,
    }),
    workspaceDiscardReceipt: createExecutionWorkspaceDiscardReceipt({
      request: createExecutionWorkspaceDiscardRequest({
        request: other.workspaceRequest,
        lease: other.workspaceLease,
      }),
      discarded: true,
    }),
  }),
  /discard|session/i
);
assert.throws(
  () => assertCanaryStagingDiscardReceipt(
    Object.freeze({ ...discardReceipt, clean: false }),
    { session: current.session, workspaceDiscardRequest }
  ),
  /discard receipt/i
);

let getterCalls = 0;
const accessorSessionInput = {
  requestId: current.requestId,
  checkpoint: current.checkpoint,
  workspaceRequest: current.workspaceRequest,
};
Object.defineProperty(accessorSessionInput, 'workspaceLease', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return current.workspaceLease;
  },
});
assert.throws(
  () => createCanaryStagingSession(accessorSessionInput),
  /session/i
);
assert.strictEqual(getterCalls, 0);
assert.throws(
  () => createCanaryStagingSession(new Proxy({
    requestId: current.requestId,
    checkpoint: current.checkpoint,
    workspaceRequest: current.workspaceRequest,
    workspaceLease: current.workspaceLease,
  }, {})),
  /session/i
);

console.log('canary staging contract tests passed');
