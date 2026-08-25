'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
  evaluateCanaryEditAdmission,
} = require('../main/agent_runtime/canary_edit_admission_policy');
const {
  classifyCanaryEditAction,
} = require('../main/agent_runtime/canary_edit_action_classifier');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_edit_runner');
const {
  CANARY_ROLLOUT_STAGES,
  createCanaryRolloutSelector,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  createCanaryStagingSession,
} = require('../main/agent_runtime/canary_staging_contract');
const {
  createCanaryStagingWriteSetDigest,
} = require('../main/agent_runtime/canary_staging_write_set_contract');
const {
  CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_transactional_staging_executor');
const {
  HARNESS_RESULT_SCHEMA_VERSION,
  createExecuteRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  createActionDigest,
} = require('../main/services/assistant_job_authority_service');
const {
  CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS,
  CANARY_LOCAL_STAGING_EDITOR_ADAPTER_VERSION,
  createCanaryLocalStagingEditorAdapter,
} = require('../main/services/canary_local_staging_editor_adapter');
const {
  createPortableExecutionWorkspaceBackend,
} = require('../main/services/portable_isolation_helper_execution_workspace_backend');

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

function requestAndGrant({ action, binding, checkpoint, requestId }) {
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
  const rolloutDecision = createCanaryRolloutSelector({
    cohortSeed: 'canary-local-staging-editor-tests-v1',
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

function makeFixture(actionValue, { setup = null, editor = null } = {}) {
  fixtureSequence += 1;
  const suffix = String(fixtureSequence);
  const fixtureRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'faber-canary-local-editor-'
  ));
  const sourceRoot = path.join(fixtureRoot, 'source');
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'src', 'app.js'),
    'module.exports = "original";\n'
  );
  fs.writeFileSync(path.join(sourceRoot, 'notes.txt'), 'line-1\n');
  if (setup) setup({ fixtureRoot, sourceRoot });
  const identity = physicalRoot(sourceRoot);
  const binding = createCapabilityDelegationBinding({
    projectId: `project-local-editor-${suffix}`,
    canonicalRootPath: sourceRoot,
    realRootPath: identity.realRootPath,
    sessionId: `session-local-editor-${suffix}`,
    jobId: `job-local-editor-${suffix}`,
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: `workspace-local-editor-${suffix}`,
    binding,
    sourceRootIdentityDigest: identity.digest,
  });
  const backend = createPortableExecutionWorkspaceBackend();
  backend.probe();
  const workspaceLease = backend.acquire(workspaceRequest);
  const checkpoint = Object.freeze({
    checkpointDigest: digest('b'),
    checkpointVerified: true,
    projectId: binding.projectId,
    canonicalRootPath: binding.canonicalRootPath,
    jobId: binding.jobId,
  });
  const session = createCanaryStagingSession({
    requestId: `request-local-editor-${suffix}`,
    checkpoint,
    workspaceRequest,
    workspaceLease,
  });
  const action = deepFreeze(actionValue);
  const authorization = requestAndGrant({
    action,
    binding,
    checkpoint,
    requestId: session.requestId,
  });
  const stagingEditor = editor || createCanaryLocalStagingEditorAdapter({
    kernelId: binding.kernelId,
  });
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      backend.discard(createExecutionWorkspaceDiscardRequest({
        request: workspaceRequest,
        lease: workspaceLease,
      }));
    } finally {
      try { backend.dispose(); } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }
  }
  return Object.freeze({
    ...authorization,
    action,
    backend,
    binding,
    checkpoint,
    cleanup,
    editor: stagingEditor,
    session,
    sourceRoot,
    workspaceRequest,
    workspaceRoot: workspaceLease.workspaceRootPath,
  });
}

function patchAction(previous = 'module.exports = "original";\n') {
  return {
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: bytesDigest(Buffer.from(previous, 'utf8')),
    nextContent: 'module.exports = "next";\n',
  };
}

function assertEditorError(code) {
  return (error) => {
    assert.strictEqual(error && error.code, code);
    assert.strictEqual(error && error.message, code);
    return true;
  };
}

async function main() {
  const editor = createCanaryLocalStagingEditorAdapter({
    kernelId: 'codex-app-server-canary',
  });
  assert.deepStrictEqual(Reflect.ownKeys(editor), [
    'version',
    'kernelId',
    'execute',
    'diagnostics',
  ]);
  assert.strictEqual(editor.version, CANARY_LOCAL_STAGING_EDITOR_ADAPTER_VERSION);
  assert.strictEqual(editor.kernelId, 'codex-app-server-canary');
  assert.strictEqual(Object.isFrozen(editor), true);
  assert.deepStrictEqual(editor.diagnostics(), {
    version: CANARY_LOCAL_STAGING_EDITOR_ADAPTER_VERSION,
    kernelId: 'codex-app-server-canary',
    workspaceMode: 'provided_session_only',
    sourceMutation: 'forbidden',
    settlementMode: 'terminal',
    networkMode: 'disabled',
    installMode: 'disabled',
  });

  const patchFixture = makeFixture(patchAction(), { editor });
  try {
    const pending = patchFixture.editor.execute(
      patchFixture.request,
      patchFixture.grant,
      patchFixture.session
    );
    assert.strictEqual(require('util').types.isPromise(pending), true);
    const outcome = await pending;
    assert.strictEqual(
      outcome.schemaVersion,
      CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION
    );
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(outcome.writeReceipt.actionDigest, createActionDigest(
      patchFixture.action
    ));
    assert.deepStrictEqual(outcome.writeReceipt.changedPaths, ['src/app.js']);
    assert.strictEqual(outcome.writeReceipt.stagingWritten, true);
    assert.strictEqual(outcome.writeReceipt.sourceMutated, false);
    assert.strictEqual(outcome.result.schemaVersion, HARNESS_RESULT_SCHEMA_VERSION);
    assert.strictEqual(outcome.result.kernelId, patchFixture.binding.kernelId);
    assert.deepStrictEqual(outcome.result.output.changedPaths, ['src/app.js']);
    assert.strictEqual(
      fs.readFileSync(path.join(patchFixture.workspaceRoot, 'src', 'app.js'), 'utf8'),
      'module.exports = "next";\n'
    );
    assert.strictEqual(
      fs.readFileSync(path.join(patchFixture.sourceRoot, 'src', 'app.js'), 'utf8'),
      'module.exports = "original";\n'
    );
    const repeated = await patchFixture.editor.execute(
      patchFixture.request,
      patchFixture.grant,
      patchFixture.session
    );
    assert.deepStrictEqual(repeated, outcome);
    assert.strictEqual(
      fs.readFileSync(path.join(patchFixture.workspaceRoot, 'src', 'app.js'), 'utf8'),
      'module.exports = "next";\n'
    );
    const expectedWriteSetDigest = createCanaryStagingWriteSetDigest(
      Object.freeze([Object.freeze({
        path: 'src/app.js',
        kind: 'file',
        mode: fs.statSync(
          path.join(patchFixture.workspaceRoot, 'src', 'app.js')
        ).mode & 0o777,
        bytes: Buffer.byteLength('module.exports = "next";\n'),
        contentDigest: bytesDigest(Buffer.from('module.exports = "next";\n')),
      })])
    );
    assert.strictEqual(outcome.writeReceipt.writeSetDigest, expectedWriteSetDigest);

    const conflictingAction = deepFreeze({
      ...patchAction('module.exports = "next";\n'),
      nextContent: 'module.exports = "conflict";\n',
    });
    const conflicting = requestAndGrant({
      action: conflictingAction,
      binding: patchFixture.binding,
      checkpoint: patchFixture.checkpoint,
      requestId: patchFixture.session.requestId,
    });
    await assert.rejects(
      patchFixture.editor.execute(
        conflicting.request,
        conflicting.grant,
        patchFixture.session
      ),
      assertEditorError(
        CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.REPLAY_MISMATCH
      )
    );
  } finally {
    patchFixture.cleanup();
  }

  const fuzzyFixture = makeFixture({
    type: 'edit_file_fuzzy',
    targetFile: 'src/app.js',
    targetContent: '"original"',
    replacementContent: '"fuzzy"',
  });
  try {
    const fuzzy = await fuzzyFixture.editor.execute(
      fuzzyFixture.request,
      fuzzyFixture.grant,
      fuzzyFixture.session
    );
    assert.deepStrictEqual(fuzzy.writeReceipt.changedPaths, ['src/app.js']);
    assert.strictEqual(
      fs.readFileSync(path.join(fuzzyFixture.workspaceRoot, 'src', 'app.js'), 'utf8'),
      'module.exports = "fuzzy";\n'
    );
  } finally {
    fuzzyFixture.cleanup();
  }

  const ambiguousFuzzyFixture = makeFixture({
    type: 'edit_file_fuzzy',
    targetFile: 'notes.txt',
    targetContent: 'line',
    replacementContent: 'entry',
  }, {
    setup({ sourceRoot }) {
      fs.writeFileSync(path.join(sourceRoot, 'notes.txt'), 'line\nline\n');
    },
  });
  try {
    await assert.rejects(
      ambiguousFuzzyFixture.editor.execute(
        ambiguousFuzzyFixture.request,
        ambiguousFuzzyFixture.grant,
        ambiguousFuzzyFixture.session
      ),
      assertEditorError(
        CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED
      )
    );
    assert.strictEqual(fs.readFileSync(
      path.join(ambiguousFuzzyFixture.workspaceRoot, 'notes.txt'),
      'utf8'
    ), 'line\nline\n');
  } finally {
    ambiguousFuzzyFixture.cleanup();
  }

  const batchFixture = makeFixture({
    type: 'operation_batch',
    operations: [
      { op: 'mkdir', path: 'generated' },
      { op: 'write_file', path: 'generated/result.js', content: 'result\n' },
      { op: 'append_file', path: 'notes.txt', content: 'line-2\n' },
    ],
  });
  try {
    const batch = await batchFixture.editor.execute(
      batchFixture.request,
      batchFixture.grant,
      batchFixture.session
    );
    assert.deepStrictEqual(batch.writeReceipt.changedPaths, [
      'generated',
      'generated/result.js',
      'notes.txt',
    ]);
    assert.strictEqual(
      fs.readFileSync(path.join(batchFixture.workspaceRoot, 'generated', 'result.js'), 'utf8'),
      'result\n'
    );
    assert.strictEqual(
      fs.readFileSync(path.join(batchFixture.workspaceRoot, 'notes.txt'), 'utf8'),
      'line-1\nline-2\n'
    );
    assert.strictEqual(fs.readFileSync(
      path.join(batchFixture.sourceRoot, 'notes.txt'),
      'utf8'
    ), 'line-1\n');
    assert.deepStrictEqual(await batchFixture.editor.execute(
      batchFixture.request,
      batchFixture.grant,
      batchFixture.session
    ), batch);
    assert.strictEqual(
      fs.readFileSync(path.join(batchFixture.workspaceRoot, 'notes.txt'), 'utf8'),
      'line-1\nline-2\n',
      'replaying an append batch must not duplicate its external effect'
    );
  } finally {
    batchFixture.cleanup();
  }

  const commandFixture = makeFixture({
    executionCommand: {
      protocol: 'faber-edit-v1',
      task_type: 'apply_file_patch',
      root_path: null,
      target_file: 'src/app.js',
      previous_content_hash: bytesDigest(Buffer.from(
        'module.exports = "original";\n'
      )),
      next_content: 'module.exports = "command";\n',
    },
  });
  try {
    const command = await commandFixture.editor.execute(
      commandFixture.request,
      commandFixture.grant,
      commandFixture.session
    );
    assert.deepStrictEqual(command.writeReceipt.changedPaths, ['src/app.js']);
  } finally {
    commandFixture.cleanup();
  }

  const wrongRootFixture = makeFixture({
    executionCommand: {
      protocol: 'faber-edit-v1',
      task_type: 'apply_file_patch',
      root_path: '/wrong/project/root',
      target_file: 'src/app.js',
      previous_content_hash: bytesDigest(Buffer.from(
        'module.exports = "original";\n'
      )),
      next_content: 'module.exports = "wrong-root";\n',
    },
  });
  try {
    await assert.rejects(
      wrongRootFixture.editor.execute(
        wrongRootFixture.request,
        wrongRootFixture.grant,
        wrongRootFixture.session
      ),
      assertEditorError(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.INVALID_INPUT)
    );
  } finally {
    wrongRootFixture.cleanup();
  }

  const mismatchFixture = makeFixture(patchAction('wrong-content\n'));
  try {
    await assert.rejects(
      mismatchFixture.editor.execute(
        mismatchFixture.request,
        mismatchFixture.grant,
        mismatchFixture.session
      ),
      assertEditorError(
        CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED
      )
    );
    assert.strictEqual(fs.readFileSync(
      path.join(mismatchFixture.workspaceRoot, 'src', 'app.js'),
      'utf8'
    ), 'module.exports = "original";\n');
  } finally {
    mismatchFixture.cleanup();
  }

  let symlinkSupported = true;
  const symlinkFixture = makeFixture({
    type: 'apply_file_patch',
    targetFile: 'src/app-link.js',
    previousContentHash: bytesDigest(Buffer.from(
      'module.exports = "original";\n'
    )),
    nextContent: 'module.exports = "escaped";\n',
  }, {
    setup({ sourceRoot }) {
      try {
        fs.symlinkSync('app.js', path.join(sourceRoot, 'src', 'app-link.js'));
      } catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
          symlinkSupported = false;
          return;
        }
        throw error;
      }
    },
  });
  try {
    if (symlinkSupported) {
      await assert.rejects(
        symlinkFixture.editor.execute(
          symlinkFixture.request,
          symlinkFixture.grant,
          symlinkFixture.session
        ),
        assertEditorError(
          CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED
        )
      );
      assert.strictEqual(fs.readFileSync(
        path.join(symlinkFixture.sourceRoot, 'src', 'app.js'),
        'utf8'
      ), 'module.exports = "original";\n');
    }
  } finally {
    symlinkFixture.cleanup();
  }

  const hostileFixture = makeFixture(patchAction());
  try {
    let trapCount = 0;
    const hostileRequest = new Proxy({}, {
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
      hostileFixture.editor.execute(
        hostileRequest,
        hostileFixture.grant,
        hostileFixture.session
      ),
      assertEditorError(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.INVALID_INPUT)
    );
    assert.strictEqual(trapCount, 0);
  } finally {
    hostileFixture.cleanup();
  }

  assert.throws(
    () => createCanaryLocalStagingEditorAdapter({ kernelId: '' }),
    /kernelId|options/i
  );
  console.log('canary-local-staging-editor-adapter.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
