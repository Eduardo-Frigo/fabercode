'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  assertExecutionWorkspaceBackend,
  assertExecutionWorkspaceDiscardReceipt,
  assertExecutionWorkspaceLease,
  assertExecutionWorkspaceProbeResult,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardRequest,
} = require('../main/capabilities/execution_workspace_contract');
const {
  createProjectRootPhysicalIdentityDigest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  createExecutionWorkspaceRegistry,
} = require('../main/capabilities/execution_workspace_registry');
const {
  PORTABLE_EXECUTION_WORKSPACE_BACKEND_VERSION,
  PortableExecutionWorkspaceBackendError,
  createPortableExecutionWorkspaceBackend,
} = require('../main/services/portable_isolation_helper_execution_workspace_backend');

assert.strictEqual(
  PORTABLE_EXECUTION_WORKSPACE_BACKEND_VERSION,
  'portable-execution-workspace-backend.v1'
);
assert.strictEqual(typeof PortableExecutionWorkspaceBackendError, 'function');
assert.strictEqual(typeof createPortableExecutionWorkspaceBackend, 'function');

const digest = (character) => `sha256:${character.repeat(64)}`;

function entryType(stat) {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isDirectory()) return 'directory';
  return 'other';
}

function physicalRoot(rootPath) {
  const entryBefore = fs.lstatSync(rootPath);
  const targetBefore = fs.statSync(rootPath);
  const realRootPath = fs.realpathSync(rootPath);
  const entryAfter = fs.lstatSync(rootPath);
  const targetAfter = fs.statSync(rootPath);
  assert.strictEqual(String(entryBefore.dev), String(entryAfter.dev));
  assert.strictEqual(String(entryBefore.ino), String(entryAfter.ino));
  assert.strictEqual(String(targetBefore.dev), String(targetAfter.dev));
  assert.strictEqual(String(targetBefore.ino), String(targetAfter.ino));
  return Object.freeze({
    realRootPath,
    digest: createProjectRootPhysicalIdentityDigest({
      device: String(targetAfter.dev),
      inode: String(targetAfter.ino),
      entryDevice: String(entryAfter.dev),
      entryInode: String(entryAfter.ino),
      entryType: entryType(entryAfter),
    }),
  });
}

function requestFor(rootPath, suffix, overrides = {}) {
  const identity = physicalRoot(rootPath);
  return createExecutionWorkspaceAcquireRequest({
    leaseId: `workspace-lease-${suffix}`,
    binding: {
      projectId: `project-${suffix}`,
      canonicalRootPath: rootPath,
      realRootPath: identity.realRootPath,
      sessionId: `session-${suffix}`,
      jobId: `job-${suffix}`,
      kernelId: 'portable-helper',
      submissionDigest: digest('a'),
    },
    sourceRootIdentityDigest: identity.digest,
    ...overrides,
  });
}

function assertBackendError(code) {
  return (error) => {
    assert.ok(error instanceof PortableExecutionWorkspaceBackendError);
    assert.strictEqual(error.code, code);
    assert.strictEqual(error.message, code);
    return true;
  };
}

function maybeCreateDirectorySymlink(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (process.platform === 'win32'
      && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error && error.code)) return false;
    throw error;
  }
}

function removeTree(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Test-only cleanup after assertions have already captured the failure.
  }
}

async function run() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-portable-workspace-test-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outsideRoot = path.join(fixtureRoot, 'outside');
  const sourceAlias = path.join(fixtureRoot, 'source-alias');
  const workspacePaths = [];
  const backends = [];
  fs.mkdirSync(path.join(sourceRoot, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.git'), { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'README.md'), 'source-state\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'nested', 'data.txt'), 'nested-state\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, '.git', 'index'), 'index-state\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'run.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const outsideSecret = path.join(outsideRoot, 'secret.txt');
  fs.writeFileSync(outsideSecret, 'outside-secret\n', 'utf8');
  const internalLinkCreated = maybeCreateDirectorySymlink('nested', path.join(sourceRoot, 'nested-link'));

  try {
    let optionTrapCount = 0;
    const hostileOptions = new Proxy({}, {
      getPrototypeOf() {
        optionTrapCount += 1;
        throw new Error('must not run');
      },
      ownKeys() {
        optionTrapCount += 1;
        throw new Error('must not run');
      },
    });
    assert.throws(
      () => createPortableExecutionWorkspaceBackend(hostileOptions),
      assertBackendError('WORKSPACE_BACKEND_OPTIONS_INVALID')
    );
    assert.strictEqual(optionTrapCount, 0);
    assert.throws(
      () => createPortableExecutionWorkspaceBackend({ extra: true }),
      assertBackendError('WORKSPACE_BACKEND_OPTIONS_INVALID')
    );

    const backend = createPortableExecutionWorkspaceBackend();
    backends.push(backend);
    assert.deepStrictEqual(Reflect.ownKeys(backend), [
      'version',
      'id',
      'probe',
      'acquire',
      'discard',
      'dispose',
    ]);
    assert.strictEqual(backend.version, EXECUTION_WORKSPACE_BACKEND_VERSION);
    assert.strictEqual(backend.id, 'portable-physical-execution-workspace');
    assert.strictEqual(Object.isFrozen(backend), true);
    assert.deepStrictEqual(assertExecutionWorkspaceBackend(backend), backend);

    let probeTrapCount = 0;
    const probe = assertExecutionWorkspaceProbeResult(backend.probe(new Proxy({}, {
      get() {
        probeTrapCount += 1;
        throw new Error('must not run');
      },
      ownKeys() {
        probeTrapCount += 1;
        throw new Error('must not run');
      },
    })));
    assert.strictEqual(probeTrapCount, 0);
    assert.strictEqual(probe.state, EXECUTION_WORKSPACE_STATES.ENFORCED);
    assert.deepStrictEqual(probe.guarantees, EXECUTION_WORKSPACE_REQUIRED_GUARANTEES);

    const request = requestFor(sourceRoot, 'primary');
    const lease = assertExecutionWorkspaceLease(backend.acquire(request), request);
    workspacePaths.push(lease.workspaceRootPath);
    assert.notStrictEqual(lease.workspaceRootIdentityDigest, request.sourceRootIdentityDigest);
    assert.strictEqual(fs.realpathSync(lease.workspaceRootPath), lease.workspaceRealRootPath);
    assert.strictEqual(fs.readFileSync(path.join(lease.workspaceRootPath, 'README.md'), 'utf8'), 'source-state\n');
    assert.strictEqual(fs.readFileSync(path.join(lease.workspaceRootPath, 'nested', 'data.txt'), 'utf8'), 'nested-state\n');
    assert.strictEqual(fs.readFileSync(path.join(lease.workspaceRootPath, '.git', 'index'), 'utf8'), 'index-state\n');
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(lease.workspaceRootPath).mode & 0o777, 0o700);
      assert.strictEqual(fs.statSync(path.join(lease.workspaceRootPath, 'run.sh')).mode & 0o111, 0o111);
    }
    if (internalLinkCreated) {
      const copiedLink = path.join(lease.workspaceRootPath, 'nested-link');
      assert.strictEqual(fs.lstatSync(copiedLink).isSymbolicLink(), true);
      assert.strictEqual(fs.realpathSync(copiedLink), path.join(lease.workspaceRealRootPath, 'nested'));
    }

    fs.writeFileSync(path.join(lease.workspaceRootPath, 'README.md'), 'workspace-state\n', 'utf8');
    assert.strictEqual(fs.readFileSync(path.join(sourceRoot, 'README.md'), 'utf8'), 'source-state\n');
    const workspaceEscapeLink = path.join(lease.workspaceRootPath, 'discard-must-not-follow');
    const escapeLinkCreated = maybeCreateDirectorySymlink(outsideRoot, workspaceEscapeLink);
    const discardRequest = createExecutionWorkspaceDiscardRequest({ request, lease });
    const discardReceipt = assertExecutionWorkspaceDiscardReceipt(
      backend.discard(discardRequest),
      discardRequest
    );
    assert.strictEqual(discardReceipt.discarded, true);
    assert.strictEqual(fs.existsSync(lease.workspaceRootPath), false);
    assert.strictEqual(fs.readFileSync(outsideSecret, 'utf8'), 'outside-secret\n');
    if (escapeLinkCreated) {
      assert.strictEqual(fs.existsSync(workspaceEscapeLink), false);
    }

    fs.writeFileSync(path.join(sourceRoot, 'created-after-first-snapshot.js'), 'fresh-state\n');
    const refreshedRequest = requestFor(sourceRoot, 'refreshed-snapshot');
    const refreshedLease = assertExecutionWorkspaceLease(
      backend.acquire(refreshedRequest),
      refreshedRequest
    );
    workspacePaths.push(refreshedLease.workspaceRootPath);
    assert.strictEqual(
      fs.readFileSync(
        path.join(refreshedLease.workspaceRootPath, 'created-after-first-snapshot.js'),
        'utf8'
      ),
      'fresh-state\n'
    );
    const refreshedDiscardRequest = createExecutionWorkspaceDiscardRequest({
      request: refreshedRequest,
      lease: refreshedLease,
    });
    assert.strictEqual(
      assertExecutionWorkspaceDiscardReceipt(
        backend.discard(refreshedDiscardRequest),
        refreshedDiscardRequest
      ).discarded,
      true
    );

    const mismatchedRequest = requestFor(sourceRoot, 'mismatch', {
      sourceRootIdentityDigest: digest('f'),
    });
    assert.throws(
      () => backend.acquire(mismatchedRequest),
      assertBackendError('WORKSPACE_SOURCE_IDENTITY_MISMATCH')
    );

    const externalLink = path.join(sourceRoot, 'external-link');
    const externalLinkCreated = maybeCreateDirectorySymlink(outsideRoot, externalLink);
    if (externalLinkCreated) {
      const externalRequest = requestFor(sourceRoot, 'external-link');
      assert.throws(
        () => backend.acquire(externalRequest),
        assertBackendError('WORKSPACE_SOURCE_LINK_ESCAPE')
      );
      assert.strictEqual(fs.readFileSync(outsideSecret, 'utf8'), 'outside-secret\n');
      fs.unlinkSync(externalLink);
    }

    if (process.platform !== 'win32') {
      const chainedLink = path.join(sourceRoot, '00-chained-external-link');
      const chainedHop = path.join(sourceRoot, '99-chained-external-hop');
      fs.symlinkSync('99-chained-external-hop', chainedLink);
      fs.symlinkSync('../outside', chainedHop);
      const chainedRequest = requestFor(sourceRoot, 'chained-external-link');
      const originalLstatSync = fs.lstatSync;
      let outsideLstatCount = 0;
      fs.lstatSync = function observedLstatSync(location, ...args) {
        if (typeof location === 'string') {
          const resolved = path.resolve(location);
          const relative = path.relative(outsideRoot, resolved);
          if (relative === ''
            || (relative !== '..'
              && !relative.startsWith(`..${path.sep}`)
              && !path.isAbsolute(relative))) {
            outsideLstatCount += 1;
          }
        }
        return Reflect.apply(originalLstatSync, fs, [location, ...args]);
      };
      try {
        assert.throws(
          () => backend.acquire(chainedRequest),
          assertBackendError('WORKSPACE_SOURCE_LINK_ESCAPE')
        );
      } finally {
        fs.lstatSync = originalLstatSync;
      }
      assert.strictEqual(
        outsideLstatCount,
        0,
        'a chained link escape must be rejected before inspecting the outside target'
      );
      fs.unlinkSync(chainedLink);
      fs.unlinkSync(chainedHop);
    }

    const replacementRequest = requestFor(sourceRoot, 'replacement');
    const replacementLease = backend.acquire(replacementRequest);
    workspacePaths.push(replacementLease.workspaceRootPath);
    assert.throws(
      () => backend.acquire(replacementRequest),
      assertBackendError('WORKSPACE_LEASE_ALREADY_ACTIVE')
    );
    const movedWorkspace = `${replacementLease.workspaceRootPath}-moved`;
    workspacePaths.push(movedWorkspace);
    fs.renameSync(replacementLease.workspaceRootPath, movedWorkspace);
    fs.mkdirSync(replacementLease.workspaceRootPath, { mode: 0o700 });
    fs.writeFileSync(path.join(replacementLease.workspaceRootPath, 'replacement.txt'), 'keep\n');
    const replacementDiscard = createExecutionWorkspaceDiscardRequest({
      request: replacementRequest,
      lease: replacementLease,
    });
    assert.throws(
      () => backend.discard(replacementDiscard),
      assertBackendError('WORKSPACE_PHYSICAL_IDENTITY_CHANGED')
    );
    assert.strictEqual(
      fs.readFileSync(path.join(replacementLease.workspaceRootPath, 'replacement.txt'), 'utf8'),
      'keep\n'
    );
    assert.strictEqual(fs.existsSync(movedWorkspace), true);
    removeTree(replacementLease.workspaceRootPath);
    removeTree(movedWorkspace);

    const aliasCreated = maybeCreateDirectorySymlink(sourceRoot, sourceAlias);
    if (aliasCreated) {
      const aliasBackend = createPortableExecutionWorkspaceBackend();
      backends.push(aliasBackend);
      assert.strictEqual(aliasBackend.probe().state, EXECUTION_WORKSPACE_STATES.ENFORCED);
      const ownerRequest = requestFor(sourceRoot, 'source-owner');
      const ownerLease = aliasBackend.acquire(ownerRequest);
      workspacePaths.push(ownerLease.workspaceRootPath);
      const aliasRequest = requestFor(sourceAlias, 'source-alias');
      assert.throws(
        () => aliasBackend.acquire(aliasRequest),
        assertBackendError('WORKSPACE_SOURCE_ALREADY_ACTIVE')
      );
      const ownerDiscard = createExecutionWorkspaceDiscardRequest({
        request: ownerRequest,
        lease: ownerLease,
      });
      aliasBackend.discard(ownerDiscard);
      assert.strictEqual(fs.existsSync(ownerLease.workspaceRootPath), false);

      const aliasLease = aliasBackend.acquire(aliasRequest);
      workspacePaths.push(aliasLease.workspaceRootPath);
      assert.strictEqual(
        fs.readFileSync(path.join(aliasLease.workspaceRootPath, 'README.md'), 'utf8'),
        'source-state\n'
      );
      const aliasDiscard = createExecutionWorkspaceDiscardRequest({
        request: aliasRequest,
        lease: aliasLease,
      });
      aliasBackend.discard(aliasDiscard);
      assert.deepStrictEqual(aliasBackend.dispose(), { ok: true, disposed: true });
      fs.unlinkSync(sourceAlias);
    }

    assert.deepStrictEqual(backend.dispose(), { ok: true, disposed: true });
    assert.deepStrictEqual(backend.dispose(), { ok: true, disposed: true });
    const disposedProbe = backend.probe();
    assert.strictEqual(disposedProbe.state, EXECUTION_WORKSPACE_STATES.UNAVAILABLE);
    assert.strictEqual(disposedProbe.reasonCode, 'WORKSPACE_BACKEND_DISPOSED');

    const cleanupBackend = createPortableExecutionWorkspaceBackend();
    backends.push(cleanupBackend);
    assert.strictEqual(cleanupBackend.probe().state, EXECUTION_WORKSPACE_STATES.ENFORCED);
    const cleanupRequest = requestFor(sourceRoot, 'dispose-active');
    const cleanupLease = cleanupBackend.acquire(cleanupRequest);
    workspacePaths.push(cleanupLease.workspaceRootPath);
    const cleanupEscapeCreated = maybeCreateDirectorySymlink(
      outsideRoot,
      path.join(cleanupLease.workspaceRootPath, 'outside-link')
    );
    assert.deepStrictEqual(cleanupBackend.dispose(), { ok: true, disposed: true });
    assert.strictEqual(fs.existsSync(cleanupLease.workspaceRootPath), false);
    assert.strictEqual(fs.readFileSync(outsideSecret, 'utf8'), 'outside-secret\n');
    assert.strictEqual(cleanupEscapeCreated ? fs.existsSync(outsideSecret) : true, true);

    const registryBackend = createPortableExecutionWorkspaceBackend();
    backends.push(registryBackend);
    const registry = createExecutionWorkspaceRegistry({
      backend: registryBackend,
      leaseIdFactory: () => 'workspace-lease-registry',
      maxActiveWorkspaces: 1,
    });
    const registryIdentity = physicalRoot(sourceRoot);
    const registryBinding = {
      projectId: 'project-registry',
      canonicalRootPath: sourceRoot,
      realRootPath: registryIdentity.realRootPath,
      sessionId: 'session-registry',
      jobId: 'job-registry',
      kernelId: 'portable-helper',
      submissionDigest: digest('b'),
    };
    const registryAcquired = await registry.acquire({
      binding: registryBinding,
      sourceRootIdentityDigest: registryIdentity.digest,
    });
    assert.strictEqual(registryAcquired.ok, true);
    workspacePaths.push(registryAcquired.lease.workspaceRootPath);
    assert.strictEqual(
      fs.readFileSync(
        path.join(registryAcquired.lease.workspaceRootPath, 'README.md'),
        'utf8'
      ),
      'source-state\n'
    );
    assert.deepStrictEqual(
      await registry.rollback({
        binding: registryBinding,
        leaseId: registryAcquired.lease.leaseId,
      }),
      { ok: true, rolledBack: true, idempotent: false }
    );
    assert.strictEqual(fs.existsSync(registryAcquired.lease.workspaceRootPath), false);
    assert.deepStrictEqual(await registry.dispose(), {
      ok: true,
      disposed: true,
      quarantined: 0,
    });

    const source = fs.readFileSync(
      path.join(__dirname, '../main/services/portable_isolation_helper_execution_workspace_backend.js'),
      'utf8'
    );
    const utilityEntry = fs.readFileSync(
      path.join(__dirname, '../main/portable_isolation_helper/utility_entry.js'),
      'utf8'
    );
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    assert.match(source, /createProjectRootPhysicalIdentityDigest/);
    assert.match(source, /O_EXCL/);
    assert.match(source, /WORKSPACE_SOURCE_LINK_ESCAPE/);
    assert.match(source, /WORKSPACE_PHYSICAL_IDENTITY_CHANGED/);
    assert.match(source, /mode:\s*0o700|chmodSync\([^\n]+0o700/);
    assert.doesNotMatch(source, /fs\.rmSync/);
    assert.doesNotMatch(source, /require\(['"](?:child_process|electron|net|tls|http|https)['"]\)|process\.env|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(/);
    assert.doesNotMatch(utilityEntry, /portable_isolation_helper_execution_workspace_backend/);
    assert.doesNotMatch(mainSource, /portable_isolation_helper_execution_workspace_backend/);
  } finally {
    for (const backend of backends) {
      try { backend.dispose(); } catch { /* test cleanup continues below */ }
    }
    for (const workspacePath of workspacePaths) removeTree(workspacePath);
    removeTree(fixtureRoot);
  }
}

run().then(() => {
  console.log('portable execution workspace backend tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
