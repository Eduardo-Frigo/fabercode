'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardRequest,
} = require('../main/capabilities/execution_workspace_contract');
const {
  createProjectRootPhysicalIdentityDigest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  createProjectRootAuthorityRegistry,
} = require('../main/capabilities/project_root_authority_registry');
const {
  evaluateCanaryEditAdmission,
} = require('../main/agent_runtime/canary_edit_admission_policy');
const {
  classifyCanaryEditAction,
} = require('../main/agent_runtime/canary_edit_action_classifier');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_edit_runner');
const {
  CanaryPromotionBackendAmbiguousError,
  assertCanaryPromotionReceipt,
  assertCanaryPromotionRevertReceipt,
  createCanaryPromotionRequest,
} = require('../main/agent_runtime/canary_promotion_contract');
const {
  CANARY_ROLLOUT_STAGES,
  createCanaryRolloutSelector,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  createCanaryStagingSession,
} = require('../main/agent_runtime/canary_staging_contract');
const {
  createExecuteRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  createActionDigest,
} = require('../main/services/assistant_job_authority_service');
const {
  CANARY_LOCAL_PROMOTION_BACKEND_REASONS,
  CANARY_LOCAL_PROMOTION_BACKEND_VERSION,
  createCanaryLocalPromotionBackend,
} = require('../main/services/canary_local_promotion_backend');
const {
  createCanaryLocalStagingEditorAdapter,
} = require('../main/services/canary_local_staging_editor_adapter');
const {
  createCanarySourceSnapshotProvider,
} = require('../main/services/canary_source_snapshot_provider');
const {
  createPortableExecutionWorkspaceBackend,
} = require('../main/services/portable_isolation_helper_execution_workspace_backend');
const {
  createPortableProjectRootAuthorityBackend,
} = require('../main/services/portable_isolation_helper_project_root_authority_backend');

const digest = (character) => `sha256:${character.repeat(64)}`;
const bytesDigest = (bytes) => `sha256:${crypto.createHash('sha256')
  .update(bytes)
  .digest('hex')}`;
let fixtureSequence = 0;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function physicalRoot(rootPath) {
  const entry = fs.lstatSync(rootPath);
  const target = fs.statSync(rootPath);
  return Object.freeze({
    realRootPath: fs.realpathSync(rootPath),
    digest: createProjectRootPhysicalIdentityDigest({
      device: String(target.dev),
      inode: String(target.ino),
      entryDevice: String(entry.dev),
      entryInode: String(entry.ino),
      entryType: entry.isSymbolicLink() ? 'symlink' : 'directory',
    }),
  });
}

function requestAndGrant({ action, binding }) {
  const requestId = `request-${binding.jobId}`;
  const executionContext = { jobId: binding.jobId };
  Object.defineProperty(executionContext, 'authorityBinding', {
    enumerable: false,
    value: binding,
  });
  Object.freeze(executionContext);
  const request = createExecuteRequest(
    action,
    deepFreeze({
      id: binding.projectId,
      projectId: binding.projectId,
      rootPath: binding.canonicalRootPath,
    }),
    { requestId, executionContext }
  );
  const classification = classifyCanaryEditAction(action);
  const checkpoint = Object.freeze({
    checkpointDigest: digest('8'),
    checkpointVerified: true,
    projectId: binding.projectId,
    canonicalRootPath: binding.canonicalRootPath,
    jobId: binding.jobId,
  });
  const rolloutDecision = createCanaryRolloutSelector({
    cohortSeed: 'canary-local-promotion-backend-tests-v1',
  }).select({
    killSwitch: false,
    configuredMode: 'canary',
    projectId: binding.projectId,
    projectPin: null,
    allowlisted: true,
    internal: true,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  });
  const admissionDecision = evaluateCanaryEditAdmission({
    runtimeMode: 'canary',
    projectAuthorization: Object.freeze({ authorized: true, binding }),
    editProfile: classification.editProfile,
    checkpoint,
    rootMutation: Object.freeze({
      canonicalRootPath: binding.canonicalRootPath,
      ownerJobId: binding.jobId,
      activeOtherMutatingJobs: 0,
    }),
  });
  return Object.freeze({
    request,
    grant: Object.freeze({
      schemaVersion: CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
      requestId,
      actionClassification: classification,
      rolloutDecision,
      admissionDecision,
    }),
  });
}

function defaultPatchAction() {
  const original = Buffer.from('module.exports = "original";\n', 'utf8');
  return {
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: bytesDigest(original),
    nextContent: 'module.exports = "promoted";\n',
  };
}

async function makeFixture(actionValue = defaultPatchAction(), { setup = null } = {}) {
  fixtureSequence += 1;
  const suffix = String(fixtureSequence);
  const fixtureRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'faber-canary-local-promotion-'
  ));
  const sourceRoot = path.join(fixtureRoot, 'source');
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.git', 'refs', 'heads'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(sourceRoot, 'src', 'app.js'),
    'module.exports = "original";\n'
  );
  fs.writeFileSync(path.join(sourceRoot, 'notes.txt'), 'note-original\n');
  fs.writeFileSync(path.join(sourceRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(
    path.join(sourceRoot, '.git', 'refs', 'heads', 'main'),
    `${'1'.repeat(40)}\n`
  );
  fs.writeFileSync(path.join(sourceRoot, '.git', 'index'), 'index-original\n');
  if (setup) setup({ fixtureRoot, sourceRoot });
  const identity = physicalRoot(sourceRoot);
  const binding = createCapabilityDelegationBinding({
    projectId: `project-local-promotion-${suffix}`,
    canonicalRootPath: sourceRoot,
    realRootPath: identity.realRootPath,
    sessionId: `session-local-promotion-${suffix}`,
    jobId: `job-local-promotion-${suffix}`,
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const action = deepFreeze(actionValue);
  const authorization = requestAndGrant({ action, binding });
  const rootRegistry = createProjectRootAuthorityRegistry({
    backend: createPortableProjectRootAuthorityBackend(),
    leaseIdFactory: () => `root-local-promotion-${suffix}`,
    maxActiveLeases: 1,
  });
  const rootAcquired = await rootRegistry.acquire({
    binding,
    expectedPhysicalRootIdentityDigest: identity.digest,
    purpose: 'execution',
  });
  assert.strictEqual(rootAcquired.ok, true);
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: `workspace-local-promotion-${suffix}`,
    binding,
    sourceRootIdentityDigest: identity.digest,
  });
  const workspaceBackend = createPortableExecutionWorkspaceBackend();
  workspaceBackend.probe();
  const workspaceLease = workspaceBackend.acquire(workspaceRequest);
  const snapshot = await createCanarySourceSnapshotProvider().inspect(
    Object.freeze({
      request: authorization.request,
      grant: authorization.grant,
      binding,
      actionDigest: createActionDigest(action),
      rootLease: rootAcquired.lease,
      workspaceRequest,
      workspaceLease,
    })
  );
  const session = createCanaryStagingSession({
    requestId: authorization.request.requestId,
    checkpoint: snapshot.checkpoint,
    workspaceRequest,
    workspaceLease,
  });
  const editor = createCanaryLocalStagingEditorAdapter({
    kernelId: binding.kernelId,
  });
  const editOutcome = await editor.execute(
    authorization.request,
    authorization.grant,
    session
  );
  const request = createCanaryPromotionRequest({
    promotionId: `promotion-local-${suffix}`,
    session,
    writeReceipt: editOutcome.writeReceipt,
    checkpoint: snapshot.checkpoint,
    workspaceRequest,
    sourceSnapshot: snapshot.sourceSnapshot,
    rootMutation: snapshot.rootMutation,
  });
  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      try {
        workspaceBackend.discard(createExecutionWorkspaceDiscardRequest({
          request: workspaceRequest,
          lease: workspaceLease,
        }));
      } finally {
        workspaceBackend.dispose();
      }
    } finally {
      try {
        await rootRegistry.release({
          binding,
          leaseId: rootAcquired.lease.leaseId,
        });
      } finally {
        await rootRegistry.dispose();
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }
  }
  return Object.freeze({
    ...authorization,
    action,
    binding,
    cleanup,
    editOutcome,
    fixtureRoot,
    request,
    session,
    snapshot,
    sourceRoot,
    workspaceRoot: workspaceLease.workspaceRootPath,
  });
}

function assertBackendError(code) {
  return (error) => {
    assert.strictEqual(error && error.code, code);
    assert.strictEqual(error && error.message, code);
    return true;
  };
}

async function testPatchPromotionAndRevert() {
  const fixture = await makeFixture();
  const backend = createCanaryLocalPromotionBackend();
  try {
    const pending = backend.promote(fixture.request);
    assert.strictEqual(util.types.isPromise(pending), true);
    const receipt = await pending;
    assert.deepStrictEqual(
      assertCanaryPromotionReceipt(receipt, fixture.request),
      receipt
    );
    assert.strictEqual(fs.readFileSync(
      path.join(fixture.sourceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "promoted";\n');
    assert.strictEqual(fs.readFileSync(
      path.join(fixture.sourceRoot, 'notes.txt'),
      'utf8'
    ), 'note-original\n');
    assert.strictEqual(fs.readFileSync(
      path.join(fixture.sourceRoot, '.git', 'index'),
      'utf8'
    ), 'index-original\n');
    assert.deepStrictEqual(await backend.promote(fixture.request), receipt);

    const revertInput = Object.freeze({
      request: fixture.request,
      promotionReceipt: receipt,
      reason: 'canary_result_invalid',
    });
    const reverted = await backend.revert(revertInput);
    assert.deepStrictEqual(
      assertCanaryPromotionRevertReceipt(reverted, {
        request: fixture.request,
        promotionReceipt: receipt,
      }),
      reverted
    );
    assert.strictEqual(fs.readFileSync(
      path.join(fixture.sourceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "original";\n');
    assert.strictEqual(fs.readFileSync(
      path.join(fixture.workspaceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "promoted";\n');
    assert.deepStrictEqual(await backend.revert(revertInput), reverted);
  } finally {
    await fixture.cleanup();
  }
}

async function testBatchRoundTrip() {
  const fixture = await makeFixture({
    type: 'operation_batch',
    operations: [
      { op: 'mkdir', path: 'generated' },
      { op: 'write_file', path: 'generated/result.js', content: 'result\n' },
      { op: 'append_file', path: 'notes.txt', content: 'note-promoted\n' },
    ],
  });
  const backend = createCanaryLocalPromotionBackend();
  try {
    const receipt = await backend.promote(fixture.request);
    assert.strictEqual(fs.readFileSync(
      path.join(fixture.sourceRoot, 'generated', 'result.js'),
      'utf8'
    ), 'result\n');
    assert.strictEqual(fs.readFileSync(
      path.join(fixture.sourceRoot, 'notes.txt'),
      'utf8'
    ), 'note-original\nnote-promoted\n');
    await backend.revert(Object.freeze({
      request: fixture.request,
      promotionReceipt: receipt,
      reason: 'batch_validation_failed',
    }));
    assert.strictEqual(fs.existsSync(
      path.join(fixture.sourceRoot, 'generated')
    ), false);
    assert.strictEqual(fs.readFileSync(
      path.join(fixture.sourceRoot, 'notes.txt'),
      'utf8'
    ), 'note-original\n');
  } finally {
    await fixture.cleanup();
  }
}

async function testPreWriteConflicts() {
  const sourceConflict = await makeFixture();
  const sourceBackend = createCanaryLocalPromotionBackend();
  try {
    fs.writeFileSync(path.join(sourceConflict.sourceRoot, 'notes.txt'), 'user-change\n');
    await assert.rejects(
      sourceBackend.promote(sourceConflict.request),
      assertBackendError(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT)
    );
    assert.strictEqual(fs.readFileSync(
      path.join(sourceConflict.sourceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "original";\n');
    assert.strictEqual(fs.readFileSync(
      path.join(sourceConflict.sourceRoot, 'notes.txt'),
      'utf8'
    ), 'user-change\n');
  } finally {
    await sourceConflict.cleanup();
  }

  const stagingConflict = await makeFixture();
  const stagingBackend = createCanaryLocalPromotionBackend();
  try {
    fs.writeFileSync(
      path.join(stagingConflict.workspaceRoot, 'src', 'app.js'),
      'tampered-staging\n'
    );
    await assert.rejects(
      stagingBackend.promote(stagingConflict.request),
      assertBackendError(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.STAGING_CONFLICT)
    );
    assert.strictEqual(fs.readFileSync(
      path.join(stagingConflict.sourceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "original";\n');
  } finally {
    await stagingConflict.cleanup();
  }

  const gitConflict = await makeFixture();
  const gitBackend = createCanaryLocalPromotionBackend();
  try {
    fs.writeFileSync(path.join(gitConflict.sourceRoot, '.git', 'index'), 'changed\n');
    await assert.rejects(
      gitBackend.promote(gitConflict.request),
      assertBackendError(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT)
    );
    assert.strictEqual(fs.readFileSync(
      path.join(gitConflict.sourceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "original";\n');
  } finally {
    await gitConflict.cleanup();
  }
}

async function testPostWriteFailureSettlesOrBecomesAmbiguous() {
  const action = {
    type: 'operation_batch',
    operations: [
      { op: 'write_file', path: 'src/app.js', content: 'app-promoted\n' },
      { op: 'write_file', path: 'notes.txt', content: 'notes-promoted\n' },
    ],
  };
  const recovered = await makeFixture(action);
  const recoveredBackend = createCanaryLocalPromotionBackend();
  const recoveredRealRoot = fs.realpathSync(recovered.sourceRoot);
  const originalRename = fs.renameSync;
  let sourceRenames = 0;
  fs.renameSync = function failSecondSourceRename(from, to, ...args) {
    if (typeof to === 'string' && to.startsWith(`${recoveredRealRoot}${path.sep}`)) {
      sourceRenames += 1;
      if (sourceRenames === 2) {
        const error = new Error('injected promotion write failure');
        error.code = 'EIO';
        throw error;
      }
    }
    return Reflect.apply(originalRename, fs, [from, to, ...args]);
  };
  try {
    await assert.rejects(
      recoveredBackend.promote(recovered.request),
      assertBackendError(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.WRITE_FAILED)
    );
  } finally {
    fs.renameSync = originalRename;
  }
  try {
    assert.strictEqual(fs.readFileSync(
      path.join(recovered.sourceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "original";\n');
    assert.strictEqual(fs.readFileSync(
      path.join(recovered.sourceRoot, 'notes.txt'),
      'utf8'
    ), 'note-original\n');
  } finally {
    await recovered.cleanup();
  }

  const ambiguous = await makeFixture(action);
  const ambiguousBackend = createCanaryLocalPromotionBackend();
  const ambiguousRealRoot = fs.realpathSync(ambiguous.sourceRoot);
  let ambiguousRenames = 0;
  fs.renameSync = function failWriteAndRollback(from, to, ...args) {
    if (typeof to === 'string' && to.startsWith(`${ambiguousRealRoot}${path.sep}`)) {
      ambiguousRenames += 1;
      if (ambiguousRenames >= 2) {
        const error = new Error('injected ambiguous promotion failure');
        error.code = 'EIO';
        throw error;
      }
    }
    return Reflect.apply(originalRename, fs, [from, to, ...args]);
  };
  try {
    await assert.rejects(
      ambiguousBackend.promote(ambiguous.request),
      (error) => error instanceof CanaryPromotionBackendAmbiguousError
    );
  } finally {
    fs.renameSync = originalRename;
  }
  try {
    await assert.rejects(
      ambiguousBackend.promote(ambiguous.request),
      (error) => error instanceof CanaryPromotionBackendAmbiguousError
    );
  } finally {
    await ambiguous.cleanup();
  }
}

async function testRevertFailureSettlesOrBecomesAmbiguous() {
  const action = {
    type: 'operation_batch',
    operations: [
      { op: 'write_file', path: 'src/app.js', content: 'app-promoted\n' },
      { op: 'write_file', path: 'notes.txt', content: 'notes-promoted\n' },
    ],
  };
  const recovered = await makeFixture(action);
  const recoveredBackend = createCanaryLocalPromotionBackend();
  const recoveredReceipt = await recoveredBackend.promote(recovered.request);
  const recoveredRevertInput = Object.freeze({
    request: recovered.request,
    promotionReceipt: recoveredReceipt,
    reason: 'injected_revert_failure',
  });
  const originalRename = fs.renameSync;
  const recoveredRealRoot = fs.realpathSync(recovered.sourceRoot);
  let recoveredRenames = 0;
  fs.renameSync = function failSecondRevertRename(from, to, ...args) {
    if (typeof to === 'string'
      && to.startsWith(`${recoveredRealRoot}${path.sep}`)) {
      recoveredRenames += 1;
      if (recoveredRenames === 2) {
        const error = new Error('injected revert write failure');
        error.code = 'EIO';
        throw error;
      }
    }
    return Reflect.apply(originalRename, fs, [from, to, ...args]);
  };
  try {
    await assert.rejects(
      recoveredBackend.revert(recoveredRevertInput),
      assertBackendError(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.REVERT_FAILED)
    );
  } finally {
    fs.renameSync = originalRename;
  }
  try {
    assert.strictEqual(fs.readFileSync(
      path.join(recovered.sourceRoot, 'src', 'app.js'),
      'utf8'
    ), 'app-promoted\n');
    assert.strictEqual(fs.readFileSync(
      path.join(recovered.sourceRoot, 'notes.txt'),
      'utf8'
    ), 'notes-promoted\n');
    await recoveredBackend.revert(recoveredRevertInput);
    assert.strictEqual(fs.readFileSync(
      path.join(recovered.sourceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "original";\n');
    assert.strictEqual(fs.readFileSync(
      path.join(recovered.sourceRoot, 'notes.txt'),
      'utf8'
    ), 'note-original\n');
  } finally {
    await recovered.cleanup();
  }

  const ambiguous = await makeFixture(action);
  const ambiguousBackend = createCanaryLocalPromotionBackend();
  const ambiguousReceipt = await ambiguousBackend.promote(ambiguous.request);
  const ambiguousRealRoot = fs.realpathSync(ambiguous.sourceRoot);
  let ambiguousRenames = 0;
  fs.renameSync = function failRevertAndReapply(from, to, ...args) {
    if (typeof to === 'string'
      && to.startsWith(`${ambiguousRealRoot}${path.sep}`)) {
      ambiguousRenames += 1;
      if (ambiguousRenames >= 2) {
        const error = new Error('injected ambiguous revert failure');
        error.code = 'EIO';
        throw error;
      }
    }
    return Reflect.apply(originalRename, fs, [from, to, ...args]);
  };
  try {
    await assert.rejects(
      ambiguousBackend.revert(Object.freeze({
        request: ambiguous.request,
        promotionReceipt: ambiguousReceipt,
        reason: 'injected_ambiguous_revert',
      })),
      (error) => error instanceof CanaryPromotionBackendAmbiguousError
    );
  } finally {
    fs.renameSync = originalRename;
    await ambiguous.cleanup();
  }
}

async function testHostileInputAndSurface() {
  const backend = createCanaryLocalPromotionBackend();
  assert.deepStrictEqual(Reflect.ownKeys(backend), [
    'version',
    'promote',
    'revert',
    'diagnostics',
  ]);
  assert.strictEqual(backend.version, CANARY_LOCAL_PROMOTION_BACKEND_VERSION);
  assert.strictEqual(Object.isFrozen(backend), true);
  assert.deepStrictEqual(backend.diagnostics(), {
    version: CANARY_LOCAL_PROMOTION_BACKEND_VERSION,
    conflictCheck: 'required',
    inversePatch: 'job_scoped',
    rejectionFrontier: 'pre_write_only',
    settlementMode: 'terminal_receipt',
    branchMutation: 'forbidden',
    gitIndexMutation: 'forbidden',
    userDirtyMutation: 'forbidden',
  });
  let trapCount = 0;
  const hostile = new Proxy({}, {
    get() {
      trapCount += 1;
      throw new Error('must not execute');
    },
    ownKeys() {
      trapCount += 1;
      throw new Error('must not execute');
    },
  });
  await assert.rejects(
    backend.promote(hostile),
    assertBackendError(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.INVALID_INPUT)
  );
  assert.strictEqual(trapCount, 0);
  assert.throws(
    () => createCanaryLocalPromotionBackend({ maxPromotions: 0 }),
    /maxPromotions|options/i
  );
}

async function main() {
  await testHostileInputAndSurface();
  await testPatchPromotionAndRevert();
  await testBatchRoundTrip();
  await testPreWriteConflicts();
  await testPostWriteFailureSettlesOrBecomesAmbiguous();
  await testRevertFailureSettlesOrBecomesAmbiguous();
  console.log('canary-local-promotion-backend.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
