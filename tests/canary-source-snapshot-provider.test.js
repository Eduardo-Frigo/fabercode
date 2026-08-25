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
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_ENTRY_KINDS,
  PROJECT_ROOT_READER_VERSION,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootPhysicalIdentityDigest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  createProjectRootAuthorityRegistry,
} = require('../main/capabilities/project_root_authority_registry');
const {
  classifyCanaryEditAction,
} = require('../main/agent_runtime/canary_edit_action_classifier');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_edit_runner');
const {
  createExecuteRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS,
  CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
  createCanarySourceSnapshotProvider,
} = require('../main/services/canary_source_snapshot_provider');
const {
  createPortableProjectRootAuthorityBackend,
} = require('../main/services/portable_isolation_helper_project_root_authority_backend');

const bytesDigest = (bytes) => `sha256:${crypto.createHash('sha256')
  .update(bytes)
  .digest('hex')}`;
const digest = (character) => `sha256:${character.repeat(64)}`;

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
      entryType: 'directory',
    }),
  });
}

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

function makeFixture({
  actionOverride = null,
  git = true,
  gitMarker = null,
  head = 'ref: refs/heads/main\n',
  index = 'index-v1',
  maxEntries = 100,
  maxEntriesPerDirectory = 20,
  previousHash = null,
  reverseListings = false,
  syncReader = false,
  target = 'target-v1',
  unrelated = 'notes-v1',
} = {}) {
  const events = [];
  const binding = createCapabilityDelegationBinding({
    projectId: 'project-source-snapshot-a',
    canonicalRootPath: '/workspace/project-source-snapshot-a',
    realRootPath: '/private/workspace/project-source-snapshot-a',
    sessionId: 'session-source-snapshot-a',
    jobId: 'job-source-snapshot-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const sourceRootIdentityDigest = digest('d');
  const action = deepFreeze(actionOverride || {
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: previousHash || bytesDigest(Buffer.from(target, 'utf8')),
    nextContent: 'module.exports = "next";\n',
  });
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
    { requestId: 'source-snapshot-request-a', executionContext }
  );
  const grant = Object.freeze({
    schemaVersion: CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
    requestId: request.requestId,
    actionClassification: classifyCanaryEditAction(action),
    rolloutDecision: Object.freeze({ selected: true }),
    admissionDecision: Object.freeze({ eligible: true }),
  });

  const directories = new Set(['', 'src']);
  const files = new Map([
    ['README.md', Buffer.from('readme-v1', 'utf8')],
    ['notes.txt', Buffer.from(unrelated, 'utf8')],
    ['src/app.js', Buffer.from(target, 'utf8')],
    ['src/keep.js', Buffer.from('keep-v1', 'utf8')],
  ]);
  const symlinks = new Map([['latest.js', 'src/app.js']]);
  if (git) {
    directories.add('.git');
    directories.add('.git/refs');
    directories.add('.git/refs/heads');
    files.set('.git/HEAD', Buffer.from(head, 'utf8'));
    files.set('.git/index', Buffer.from(index, 'utf8'));
    files.set('.git/refs/heads/main', Buffer.from(`${'1'.repeat(40)}\n`, 'utf8'));
    files.set('.git/packed-refs', Buffer.from(`# pack-refs\n${'2'.repeat(40)} refs/tags/v1\n`, 'utf8'));
    if (gitMarker) {
      if (gitMarker.endsWith('/')) directories.add(`.git/${gitMarker.slice(0, -1)}`);
      else files.set(`.git/${gitMarker}`, Buffer.from('active\n', 'utf8'));
    }
  }

  function kindAt(relativePath) {
    if (directories.has(relativePath)) return PROJECT_ROOT_ENTRY_KINDS.DIRECTORY;
    if (files.has(relativePath)) return PROJECT_ROOT_ENTRY_KINDS.FILE;
    if (symlinks.has(relativePath)) return PROJECT_ROOT_ENTRY_KINDS.SYMLINK;
    return null;
  }

  function inspection(relativePath) {
    const kind = kindAt(relativePath);
    if (!kind) {
      return Object.freeze({
        found: false,
        kind: null,
        bytes: null,
        mode: null,
        mtimeMs: null,
        contentDigest: null,
        linkTarget: null,
        entryIdentityDigest: null,
      });
    }
    let bytes = 0;
    let contentDigest = null;
    let linkTarget = null;
    if (kind === PROJECT_ROOT_ENTRY_KINDS.FILE) {
      const content = files.get(relativePath);
      bytes = content.length;
      contentDigest = bytesDigest(content);
    } else if (kind === PROJECT_ROOT_ENTRY_KINDS.SYMLINK) {
      linkTarget = symlinks.get(relativePath);
      const content = Buffer.from(linkTarget, 'utf8');
      bytes = content.length;
      contentDigest = bytesDigest(content);
    }
    return Object.freeze({
      found: true,
      kind,
      bytes,
      mode: kind === PROJECT_ROOT_ENTRY_KINDS.DIRECTORY ? 0o755 : 0o644,
      mtimeMs: 1,
      contentDigest,
      linkTarget,
      entryIdentityDigest: bytesDigest(Buffer.from(`identity:${relativePath}`, 'utf8')),
    });
  }

  function children(relativePath) {
    const prefix = relativePath ? `${relativePath}/` : '';
    const names = new Map();
    for (const candidate of [...directories, ...files.keys(), ...symlinks.keys()]) {
      if (!candidate || !candidate.startsWith(prefix)) continue;
      const remainder = candidate.slice(prefix.length);
      if (!remainder || remainder.includes('/')) continue;
      names.set(remainder, kindAt(candidate));
    }
    const output = [...names.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, kind]) => Object.freeze({ name, kind }));
    return reverseListings ? output.reverse() : output;
  }

  const listImpl = ({ relativePath, maxEntries: requestedMax }) => {
    events.push(`list:${relativePath}`);
    const available = children(relativePath);
    return Object.freeze({
      entries: Object.freeze(available.slice(0, requestedMax)),
      truncated: available.length > requestedMax,
    });
  };
  const inspectImpl = ({ relativePath }) => {
    events.push(`inspect:${relativePath}`);
    return inspection(relativePath);
  };
  const readImpl = ({ relativePath, maxBytes }) => {
    events.push(`read:${relativePath}`);
    const content = files.get(relativePath);
    if (!content) {
      return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
    }
    const selected = content.subarray(0, maxBytes);
    return Object.freeze({
      found: true,
      contentBase64: selected.toString('base64'),
      contentDigest: bytesDigest(selected),
    });
  };
  const reader = Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list: syncReader ? listImpl : async (input) => listImpl(input),
    inspectEntry: syncReader ? inspectImpl : async (input) => inspectImpl(input),
    readFile: syncReader ? readImpl : async (input) => readImpl(input),
  });
  const rootRequest = createProjectRootAuthorityAcquireRequest({
    leaseId: 'source-snapshot-root-lease-a',
    binding,
    expectedPhysicalRootIdentityDigest: sourceRootIdentityDigest,
    purpose: 'execution',
  });
  const rootLease = Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
    leaseId: rootRequest.leaseId,
    jobId: binding.jobId,
    projectId: binding.projectId,
    purpose: rootRequest.purpose,
    physicalRootIdentityDigest: sourceRootIdentityDigest,
    authorityDigest: rootRequest.authorityDigest,
    reader,
    close() {
      return Promise.resolve(Object.freeze({ closed: true }));
    },
  });
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: 'source-snapshot-workspace-lease-a',
    binding,
    sourceRootIdentityDigest,
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: '/workspace/.faber-canary/source-snapshot-a',
    workspaceRealRootPath: '/private/workspace/.faber-canary/source-snapshot-a',
    workspaceRootIdentityDigest: digest('e'),
  });
  const input = Object.freeze({
    request,
    grant,
    binding,
    actionDigest: digest('f'),
    rootLease,
    workspaceRequest,
    workspaceLease,
  });
  const provider = createCanarySourceSnapshotProvider({
    maxEntries,
    maxEntriesPerDirectory,
  });
  return { action, binding, events, input, provider, reader, request };
}

async function main() {
  const fixture = makeFixture();
  assert.deepStrictEqual(Reflect.ownKeys(fixture.provider), [
    'version',
    'inspect',
    'diagnostics',
  ]);
  assert.strictEqual(fixture.provider.version, CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION);
  assert.strictEqual(Object.isFrozen(fixture.provider), true);
  assert.deepStrictEqual(fixture.provider.diagnostics(), {
    version: CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
    rootReadMode: 'pinned_authority_reader',
    checkpointMode: 'verified',
    mutationObservation: 'exclusive_job',
  });

  const snapshot = await fixture.provider.inspect(fixture.input);
  assert.deepStrictEqual(Reflect.ownKeys(snapshot), [
    'checkpoint',
    'sourceSnapshot',
    'rootMutation',
  ]);
  assert.strictEqual(snapshot.checkpoint.checkpointVerified, true);
  assert.strictEqual(snapshot.checkpoint.projectId, fixture.binding.projectId);
  assert.strictEqual(snapshot.checkpoint.jobId, fixture.binding.jobId);
  assert.strictEqual(
    snapshot.checkpoint.checkpointDigest,
    snapshot.sourceSnapshot.checkpointDigest
  );
  for (const value of Object.values(snapshot.sourceSnapshot)) {
    assert.match(value, /^sha256:[a-f0-9]{64}$/);
  }
  assert.deepStrictEqual(snapshot.rootMutation, {
    canonicalRootPath: fixture.binding.canonicalRootPath,
    ownerJobId: fixture.binding.jobId,
    activeOtherMutatingJobs: 0,
  });
  assert.strictEqual(Object.isFrozen(snapshot), true);
  assert.ok(fixture.events.includes('list:'));
  assert.ok(fixture.events.includes('read:.git/HEAD'));

  const fuzzyFixture = makeFixture({
    actionOverride: {
      type: 'edit_file_fuzzy',
      targetFile: 'src/app.js',
      targetContent: 'target-v1',
      replacementContent: 'target-next',
    },
  });
  const fuzzy = await fuzzyFixture.provider.inspect(fuzzyFixture.input);
  assert.strictEqual(fuzzy.checkpoint.checkpointVerified, true);
  assert.ok(fuzzyFixture.events.includes('read:src/app.js'));

  const batchFixture = makeFixture({
    actionOverride: {
      type: 'operation_batch',
      operations: [
        { op: 'mkdir', path: 'generated' },
        { op: 'write_file', path: 'generated/result.js', content: 'ok\n' },
      ],
    },
  });
  assert.strictEqual(
    (await batchFixture.provider.inspect(batchFixture.input))
      .checkpoint.checkpointVerified,
    true
  );

  const commandFixture = makeFixture({
    actionOverride: {
      executionCommand: {
        protocol: 'faber-edit-v1',
        task_type: 'apply_file_patch',
        root_path: '/workspace/project-source-snapshot-a',
        target_file: 'src/app.js',
        previous_content_hash: bytesDigest(Buffer.from('target-v1', 'utf8')),
        next_content: 'module.exports = "command";\n',
      },
    },
  });
  assert.strictEqual(
    (await commandFixture.provider.inspect(commandFixture.input))
      .checkpoint.checkpointVerified,
    true
  );

  const reorderedFixture = makeFixture({ reverseListings: true });
  const reordered = await reorderedFixture.provider.inspect(reorderedFixture.input);
  assert.deepStrictEqual(reordered.sourceSnapshot, snapshot.sourceSnapshot);

  const changedTargetFixture = makeFixture({ target: 'target-v2' });
  const changedTarget = await changedTargetFixture.provider.inspect(
    changedTargetFixture.input
  );
  assert.notStrictEqual(
    changedTarget.sourceSnapshot.sourceStateDigest,
    snapshot.sourceSnapshot.sourceStateDigest
  );
  assert.strictEqual(
    changedTarget.sourceSnapshot.userDirtyDigest,
    snapshot.sourceSnapshot.userDirtyDigest,
    'the authorized target must not erase the user-owned tree proof'
  );

  const changedUserFixture = makeFixture({ unrelated: 'notes-v2' });
  const changedUser = await changedUserFixture.provider.inspect(changedUserFixture.input);
  assert.notStrictEqual(
    changedUser.sourceSnapshot.userDirtyDigest,
    snapshot.sourceSnapshot.userDirtyDigest
  );

  const changedIndexFixture = makeFixture({ index: 'index-v2' });
  const changedIndex = await changedIndexFixture.provider.inspect(changedIndexFixture.input);
  assert.notStrictEqual(
    changedIndex.sourceSnapshot.gitIndexDigest,
    snapshot.sourceSnapshot.gitIndexDigest
  );
  assert.strictEqual(
    changedIndex.sourceSnapshot.branchHeadDigest,
    snapshot.sourceSnapshot.branchHeadDigest
  );

  const detachedFixture = makeFixture({ head: `${'3'.repeat(40)}\n` });
  const detached = await detachedFixture.provider.inspect(detachedFixture.input);
  assert.notStrictEqual(
    detached.sourceSnapshot.branchHeadDigest,
    snapshot.sourceSnapshot.branchHeadDigest
  );

  const noGitFixture = makeFixture({ git: false });
  const noGit = await noGitFixture.provider.inspect(noGitFixture.input);
  assert.match(noGit.sourceSnapshot.branchHeadDigest, /^sha256:/);
  assert.match(noGit.sourceSnapshot.gitIndexDigest, /^sha256:/);

  const unsafeGitFixture = makeFixture({ gitMarker: 'index.lock' });
  await assert.rejects(
    unsafeGitFixture.provider.inspect(unsafeGitFixture.input),
    (error) => error.code === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
  );
  const rebasingFixture = makeFixture({ gitMarker: 'rebase-merge/' });
  await assert.rejects(
    rebasingFixture.provider.inspect(rebasingFixture.input),
    (error) => error.code === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
  );

  const mismatchedHashFixture = makeFixture({ previousHash: digest('0') });
  await assert.rejects(
    mismatchedHashFixture.provider.inspect(mismatchedHashFixture.input),
    (error) => error.code
      === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
  );

  const syncReaderFixture = makeFixture({ syncReader: true });
  await assert.rejects(
    syncReaderFixture.provider.inspect(syncReaderFixture.input),
    (error) => error.code === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
  );

  const boundedFixture = makeFixture({ maxEntries: 3 });
  await assert.rejects(
    boundedFixture.provider.inspect(boundedFixture.input),
    (error) => error.code
      === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.TREE_LIMIT_EXCEEDED
  );
  const truncatedFixture = makeFixture({ maxEntriesPerDirectory: 2 });
  await assert.rejects(
    truncatedFixture.provider.inspect(truncatedFixture.input),
    (error) => error.code
      === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.TREE_LIMIT_EXCEEDED
  );

  const wrongProjectRequest = Object.freeze({
    ...fixture.request,
    projectInfo: deepFreeze({
      id: 'project-source-snapshot-wrong',
      projectId: 'project-source-snapshot-wrong',
      rootPath: fixture.binding.canonicalRootPath,
    }),
  });
  await assert.rejects(
    fixture.provider.inspect(Object.freeze({
      ...fixture.input,
      request: wrongProjectRequest,
    })),
    (error) => error.code === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.INVALID_INPUT
  );

  const wrongBinding = createCapabilityDelegationBinding({
    ...fixture.binding,
    sessionId: 'session-source-snapshot-wrong',
  });
  const wrongContext = { jobId: wrongBinding.jobId };
  Object.defineProperty(wrongContext, 'authorityBinding', {
    enumerable: false,
    value: wrongBinding,
  });
  Object.freeze(wrongContext);
  const wrongContextRequest = Object.freeze({
    ...fixture.request,
    executionContext: wrongContext,
  });
  await assert.rejects(
    fixture.provider.inspect(Object.freeze({
      ...fixture.input,
      request: wrongContextRequest,
    })),
    (error) => error.code === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.INVALID_INPUT
  );

  const sourceRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'faber-canary-source-provider-'
  ));
  let realRegistry = null;
  let realAcquired = null;
  let realBinding = null;
  try {
    fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, '.git', 'refs', 'heads'), {
      recursive: true,
    });
    const sourceBytes = Buffer.from('module.exports = "original";\n', 'utf8');
    fs.writeFileSync(path.join(sourceRoot, 'src', 'app.js'), sourceBytes);
    fs.writeFileSync(path.join(sourceRoot, 'README.md'), 'real fixture\n');
    fs.writeFileSync(path.join(sourceRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(
      path.join(sourceRoot, '.git', 'refs', 'heads', 'main'),
      `${'4'.repeat(40)}\n`
    );
    fs.writeFileSync(path.join(sourceRoot, '.git', 'index'), 'sealed-index-v1');

    const identity = physicalRoot(sourceRoot);
    realBinding = createCapabilityDelegationBinding({
      projectId: 'project-source-snapshot-real',
      canonicalRootPath: sourceRoot,
      realRootPath: identity.realRootPath,
      sessionId: 'session-source-snapshot-real',
      jobId: 'job-source-snapshot-real',
      kernelId: 'codex-app-server-canary',
      submissionDigest: digest('7'),
    });
    const action = deepFreeze({
      type: 'apply_file_patch',
      targetFile: 'src/app.js',
      previousContentHash: bytesDigest(sourceBytes),
      nextContent: 'module.exports = "next";\n',
    });
    const executionContext = { jobId: realBinding.jobId };
    Object.defineProperty(executionContext, 'authorityBinding', {
      enumerable: false,
      value: realBinding,
    });
    Object.freeze(executionContext);
    const request = createExecuteRequest(
      action,
      deepFreeze({
        id: realBinding.projectId,
        projectId: realBinding.projectId,
        rootPath: realBinding.canonicalRootPath,
      }),
      { requestId: 'source-snapshot-request-real', executionContext }
    );
    const grant = Object.freeze({
      schemaVersion: CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
      requestId: request.requestId,
      actionClassification: classifyCanaryEditAction(action),
      rolloutDecision: Object.freeze({ selected: true }),
      admissionDecision: Object.freeze({ eligible: true }),
    });
    realRegistry = createProjectRootAuthorityRegistry({
      backend: createPortableProjectRootAuthorityBackend(),
      leaseIdFactory: () => 'source-snapshot-root-lease-real',
      maxActiveLeases: 1,
    });
    realAcquired = await realRegistry.acquire({
      binding: realBinding,
      expectedPhysicalRootIdentityDigest: identity.digest,
      purpose: 'execution',
    });
    assert.strictEqual(realAcquired.ok, true);
    const workspaceRequest = createExecutionWorkspaceAcquireRequest({
      leaseId: 'source-snapshot-workspace-lease-real',
      binding: realBinding,
      sourceRootIdentityDigest: identity.digest,
    });
    const workspacePath = path.join(
      os.tmpdir(),
      'faber-canary-source-provider-workspace-real'
    );
    const workspaceLease = createExecutionWorkspaceLease({
      request: workspaceRequest,
      workspaceRootPath: workspacePath,
      workspaceRealRootPath: workspacePath,
      workspaceRootIdentityDigest: digest('8'),
    });
    const realInput = Object.freeze({
      request,
      grant,
      binding: realBinding,
      actionDigest: digest('9'),
      rootLease: realAcquired.lease,
      workspaceRequest,
      workspaceLease,
    });
    const realSnapshot = await createCanarySourceSnapshotProvider().inspect(realInput);
    assert.strictEqual(realSnapshot.checkpoint.checkpointVerified, true);
    assert.strictEqual(
      realSnapshot.sourceSnapshot.sourceRootIdentityDigest,
      identity.digest
    );
    assert.match(realSnapshot.sourceSnapshot.sourceStateDigest, /^sha256:/);
  } finally {
    if (realRegistry && realAcquired && realAcquired.ok && realBinding) {
      await realRegistry.release({
        binding: realBinding,
        leaseId: realAcquired.lease.leaseId,
      });
    }
    if (realRegistry) await realRegistry.dispose();
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }

  let getterReads = 0;
  const hostileInput = {};
  for (const [key, value] of Object.entries(fixture.input)) {
    if (key !== 'request') hostileInput[key] = value;
  }
  Object.defineProperty(hostileInput, 'request', {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error('must not execute');
    },
  });
  Object.freeze(hostileInput);
  await assert.rejects(
    fixture.provider.inspect(hostileInput),
    (error) => error.code === CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.INVALID_INPUT
  );
  assert.strictEqual(getterReads, 0);

  assert.throws(
    () => createCanarySourceSnapshotProvider({ maxEntries: 0 }),
    /maxEntries|options/i
  );
  console.log('canary-source-snapshot-provider.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
