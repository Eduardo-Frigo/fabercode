'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MAX_ENTRY_INSPECTION_BYTES,
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_ENTRY_KINDS,
  PROJECT_ROOT_READER_VERSION,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityCloseReceipt,
  assertProjectRootAuthorityLease,
  assertProjectRootAuthorityProbeResult,
  assertProjectRootEntryInspectionResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootPhysicalIdentityDigest,
  createProjectRootReadFileRequest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  createProjectRootAuthorityRegistry,
} = require('../main/capabilities/project_root_authority_registry');
const {
  PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PortableProjectRootAuthorityBackendError,
  createPortableProjectRootAuthorityBackend,
} = require('../main/services/portable_isolation_helper_project_root_authority_backend');

assert.strictEqual(
  PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  'portable-project-root-authority-backend.v1'
);
assert.strictEqual(typeof PortableProjectRootAuthorityBackendError, 'function');
assert.strictEqual(typeof createPortableProjectRootAuthorityBackend, 'function');

const digest = (character) => `sha256:${character.repeat(64)}`;
const digestBytes = (bytes) => `sha256:${crypto.createHash('sha256')
  .update(bytes)
  .digest('hex')}`;

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

function bindingFor(rootPath, suffix) {
  const identity = physicalRoot(rootPath);
  return Object.freeze({
    identity,
    binding: {
      projectId: `project-${suffix}`,
      canonicalRootPath: rootPath,
      realRootPath: identity.realRootPath,
      sessionId: `session-${suffix}`,
      jobId: `job-${suffix}`,
      kernelId: 'portable-helper',
      submissionDigest: digest('a'),
    },
  });
}

function requestFor(rootPath, suffix, overrides = {}) {
  const root = bindingFor(rootPath, suffix);
  return createProjectRootAuthorityAcquireRequest({
    leaseId: `root-lease-${suffix}`,
    binding: root.binding,
    expectedPhysicalRootIdentityDigest: root.identity.digest,
    purpose: 'execution',
    ...overrides,
  });
}

function assertBackendError(code) {
  return (error) => {
    assert.ok(error instanceof PortableProjectRootAuthorityBackendError);
    assert.strictEqual(error.code, code);
    assert.strictEqual(error.message, code);
    return true;
  };
}

function maybeCreateSymlink(target, linkPath, type = 'file') {
  try {
    fs.symlinkSync(target, linkPath, process.platform === 'win32'
      ? (type === 'directory' ? 'junction' : 'file')
      : type);
    return true;
  } catch (error) {
    if (process.platform === 'win32'
      && ['EPERM', 'EACCES', 'UNKNOWN'].includes(error && error.code)) return false;
    throw error;
  }
}

function removeTree(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* test cleanup */ }
}

function pathWithin(parent, candidate) {
  const relative = path.relative(parent, path.resolve(candidate));
  return relative === '' || (relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative));
}

async function run() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-root-authority-test-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outsideRoot = path.join(fixtureRoot, 'outside');
  const sourceAlias = path.join(fixtureRoot, 'source-alias');
  const backends = [];
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  const appBytes = Buffer.from('console.log("snapshot");\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'src', 'app.js'), appBytes);
  fs.writeFileSync(path.join(sourceRoot, 'empty.txt'), Buffer.alloc(0));
  fs.writeFileSync(path.join(sourceRoot, 'README.md'), 'original\n', 'utf8');
  const largePath = path.join(sourceRoot, 'large.bin');
  fs.closeSync(fs.openSync(largePath, fs.constants.O_CREAT | fs.constants.O_WRONLY, 0o600));
  fs.truncateSync(largePath, MAX_ENTRY_INSPECTION_BYTES + 1);
  const outsideSecret = path.join(outsideRoot, 'secret.txt');
  fs.writeFileSync(outsideSecret, 'outside-secret\n', 'utf8');
  const internalLink = path.join(sourceRoot, 'app-link.js');
  const externalLink = path.join(sourceRoot, 'outside-link');
  const internalLinkCreated = maybeCreateSymlink('src/app.js', internalLink);
  const externalLinkCreated = maybeCreateSymlink(outsideSecret, externalLink);
  const aliasCreated = maybeCreateSymlink(sourceRoot, sourceAlias, 'dir');

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
      () => createPortableProjectRootAuthorityBackend(hostileOptions),
      assertBackendError('PROJECT_ROOT_BACKEND_OPTIONS_INVALID')
    );
    assert.strictEqual(optionTrapCount, 0);
    assert.throws(
      () => createPortableProjectRootAuthorityBackend({ extra: true }),
      assertBackendError('PROJECT_ROOT_BACKEND_OPTIONS_INVALID')
    );

    const createdPrivateRoots = [];
    const originalMkdtempSync = fs.mkdtempSync;
    fs.mkdtempSync = function observedMkdtempSync(prefix, ...args) {
      const created = Reflect.apply(originalMkdtempSync, fs, [prefix, ...args]);
      if (typeof prefix === 'string'
        && (prefix.includes('faber-portable-root-snapshots-')
          || prefix.includes('root-lease-'))) createdPrivateRoots.push(created);
      return created;
    };
    const backend = createPortableProjectRootAuthorityBackend();
    backends.push(backend);
    let probe;
    try {
      probe = assertProjectRootAuthorityProbeResult(backend.probe());
    } finally {
      fs.mkdtempSync = originalMkdtempSync;
    }
    assert.deepStrictEqual(Reflect.ownKeys(backend), [
      'version',
      'id',
      'probe',
      'acquire',
      'dispose',
    ]);
    assert.strictEqual(backend.version, PROJECT_ROOT_AUTHORITY_BACKEND_VERSION);
    assert.strictEqual(backend.id, 'portable-physical-project-root-authority');
    assert.strictEqual(Object.isFrozen(backend), true);
    assert.strictEqual(assertProjectRootAuthorityBackend(backend), backend);
    assert.strictEqual(probe.state, PROJECT_ROOT_AUTHORITY_STATES.ENFORCED);
    assert.deepStrictEqual(probe.guarantees, PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES);

    const failedCaptureBackend = createPortableProjectRootAuthorityBackend();
    backends.push(failedCaptureBackend);
    assert.strictEqual(
      failedCaptureBackend.probe().state,
      PROJECT_ROOT_AUTHORITY_STATES.ENFORCED
    );
    const failedCaptureRoots = [];
    const originalWriteSync = fs.writeSync;
    let archiveWriteCount = 0;
    fs.mkdtempSync = function observedFailedCaptureMkdtempSync(prefix, ...args) {
      const created = Reflect.apply(originalMkdtempSync, fs, [prefix, ...args]);
      if (typeof prefix === 'string' && prefix.includes('root-lease-')) {
        failedCaptureRoots.push(created);
      }
      return created;
    };
    fs.writeSync = function failSecondArchiveWrite(...args) {
      archiveWriteCount += 1;
      if (archiveWriteCount === 2) {
        const error = new Error('injected partial snapshot write failure');
        error.code = 'EIO';
        throw error;
      }
      return Reflect.apply(originalWriteSync, fs, args);
    };
    try {
      assert.throws(
        () => failedCaptureBackend.acquire(requestFor(sourceRoot, 'capture-failure')),
        assertBackendError('PROJECT_ROOT_SNAPSHOT_CAPTURE_FAILED')
      );
    } finally {
      fs.mkdtempSync = originalMkdtempSync;
      fs.writeSync = originalWriteSync;
    }
    assert.strictEqual(archiveWriteCount, 2);
    assert.ok(failedCaptureRoots.length >= 1);
    for (const failedCaptureRoot of failedCaptureRoots) {
      assert.strictEqual(fs.existsSync(failedCaptureRoot), false);
    }
    assert.strictEqual(
      failedCaptureBackend.probe().state,
      PROJECT_ROOT_AUTHORITY_STATES.ENFORCED
    );
    assert.deepStrictEqual(failedCaptureBackend.dispose(), {
      ok: true,
      disposed: true,
    });

    const request = requestFor(sourceRoot, 'primary');
    const originalFsMethods = {
      lstatSync: fs.lstatSync,
      openSync: fs.openSync,
      opendirSync: fs.opendirSync,
      realpathSync: fs.realpathSync,
      statSync: fs.statSync,
    };
    let outsidePathInspectionCount = 0;
    for (const methodName of Object.keys(originalFsMethods)) {
      fs[methodName] = function observedSourceMethod(location, ...args) {
        if (typeof location === 'string' && pathWithin(outsideRoot, location)) {
          outsidePathInspectionCount += 1;
        }
        return Reflect.apply(originalFsMethods[methodName], fs, [location, ...args]);
      };
    }
    fs.mkdtempSync = function observedLeaseMkdtempSync(prefix, ...args) {
      const created = Reflect.apply(originalMkdtempSync, fs, [prefix, ...args]);
      if (typeof prefix === 'string' && prefix.includes('root-lease-')) {
        createdPrivateRoots.push(created);
      }
      return created;
    };
    let lease;
    try {
      lease = assertProjectRootAuthorityLease(backend.acquire(request), request);
    } finally {
      fs.mkdtempSync = originalMkdtempSync;
      for (const [methodName, method] of Object.entries(originalFsMethods)) {
        fs[methodName] = method;
      }
    }
    assert.strictEqual(outsidePathInspectionCount, 0);
    assert.strictEqual(lease.reader.version, PROJECT_ROOT_READER_VERSION);
    assert.ok(createdPrivateRoots.length >= 2);
    const leasePrivateRoot = createdPrivateRoots[createdPrivateRoots.length - 1];
    assert.strictEqual(fs.statSync(leasePrivateRoot).isDirectory(), true);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(leasePrivateRoot).mode & 0o777, 0o700);
    }

    if (aliasCreated) {
      const aliasRequest = requestFor(sourceAlias, 'alias-busy');
      assert.throws(
        () => backend.acquire(aliasRequest),
        assertBackendError('PROJECT_ROOT_SOURCE_ALREADY_ACTIVE')
      );
    }
    const mismatch = requestFor(sourceRoot, 'mismatch', {
      expectedPhysicalRootIdentityDigest: digest('f'),
    });
    assert.throws(
      () => backend.acquire(mismatch),
      assertBackendError('PROJECT_ROOT_SOURCE_IDENTITY_MISMATCH')
    );

    const rootListRequest = createProjectRootListRequest({
      relativePath: '',
      maxEntries: 3,
    });
    const rootList = assertProjectRootListResult(
      lease.reader.list(rootListRequest),
      rootListRequest
    );
    assert.strictEqual(rootList.entries.length, 3);
    assert.strictEqual(rootList.truncated, true);
    assert.deepStrictEqual(
      rootList.entries.map((entry) => entry.name),
      [...rootList.entries.map((entry) => entry.name)].sort()
    );
    const fullListRequest = createProjectRootListRequest({
      relativePath: '',
      maxEntries: 20,
    });
    const fullList = lease.reader.list(fullListRequest);
    const kindsByName = new Map(fullList.entries.map((entry) => [entry.name, entry.kind]));
    assert.strictEqual(kindsByName.get('src'), PROJECT_ROOT_ENTRY_KINDS.DIRECTORY);
    assert.strictEqual(kindsByName.get('large.bin'), PROJECT_ROOT_ENTRY_KINDS.OTHER);
    if (internalLinkCreated) {
      assert.strictEqual(kindsByName.get('app-link.js'), PROJECT_ROOT_ENTRY_KINDS.SYMLINK);
    }
    if (externalLinkCreated) {
      assert.strictEqual(kindsByName.get('outside-link'), PROJECT_ROOT_ENTRY_KINDS.SYMLINK);
    }

    const nestedListRequest = createProjectRootListRequest({
      relativePath: 'src',
      maxEntries: 10,
    });
    assert.deepStrictEqual(lease.reader.list(nestedListRequest), {
      entries: [{ name: 'app.js', kind: PROJECT_ROOT_ENTRY_KINDS.FILE }],
      truncated: false,
    });
    if (internalLinkCreated) {
      assert.deepStrictEqual(lease.reader.list({
        relativePath: 'app-link.js',
        maxEntries: 10,
      }), { entries: [], truncated: false });
    }

    const readRequest = createProjectRootReadFileRequest({
      relativePath: 'src/app.js',
      maxBytes: 7,
    });
    const readResult = assertProjectRootReadFileResult(
      lease.reader.readFile(readRequest),
      readRequest
    );
    const expectedPrefix = appBytes.subarray(0, 7);
    assert.strictEqual(readResult.contentBase64, expectedPrefix.toString('base64'));
    assert.strictEqual(readResult.contentDigest, digestBytes(expectedPrefix));
    const emptyRequest = createProjectRootReadFileRequest({
      relativePath: 'empty.txt',
      maxBytes: 1,
    });
    const emptyResult = lease.reader.readFile(emptyRequest);
    assert.strictEqual(emptyResult.found, true);
    assert.strictEqual(emptyResult.contentBase64, '');
    assert.strictEqual(emptyResult.contentDigest, digestBytes(Buffer.alloc(0)));
    assert.deepStrictEqual(lease.reader.readFile({
      relativePath: 'missing.txt',
      maxBytes: 10,
    }), { found: false, contentBase64: null, contentDigest: null });
    assert.deepStrictEqual(lease.reader.readFile({
      relativePath: 'large.bin',
      maxBytes: 10,
    }), { found: false, contentBase64: null, contentDigest: null });
    if (externalLinkCreated) {
      assert.deepStrictEqual(lease.reader.readFile({
        relativePath: 'outside-link',
        maxBytes: 100,
      }), { found: false, contentBase64: null, contentDigest: null });
    }

    const inspectFileRequest = createProjectRootEntryInspectionRequest({
      relativePath: 'src/app.js',
    });
    const inspectedFile = assertProjectRootEntryInspectionResult(
      lease.reader.inspectEntry(inspectFileRequest),
      inspectFileRequest
    );
    assert.strictEqual(inspectedFile.kind, PROJECT_ROOT_ENTRY_KINDS.FILE);
    assert.strictEqual(inspectedFile.bytes, appBytes.length);
    assert.strictEqual(inspectedFile.contentDigest, digestBytes(appBytes));
    assert.match(inspectedFile.entryIdentityDigest, /^sha256:[a-f0-9]{64}$/);
    const inspectedDirectory = lease.reader.inspectEntry({ relativePath: 'src' });
    assert.strictEqual(inspectedDirectory.kind, PROJECT_ROOT_ENTRY_KINDS.DIRECTORY);
    assert.strictEqual(inspectedDirectory.bytes, 0);
    const inspectedLarge = lease.reader.inspectEntry({ relativePath: 'large.bin' });
    assert.strictEqual(inspectedLarge.kind, PROJECT_ROOT_ENTRY_KINDS.OTHER);
    if (externalLinkCreated) {
      const inspectedLink = lease.reader.inspectEntry({ relativePath: 'outside-link' });
      assert.strictEqual(inspectedLink.kind, PROJECT_ROOT_ENTRY_KINDS.SYMLINK);
      assert.strictEqual(inspectedLink.linkTarget, outsideSecret);
      assert.strictEqual(
        inspectedLink.contentDigest,
        digestBytes(Buffer.from(outsideSecret, 'utf8'))
      );
    }
    assert.deepStrictEqual(lease.reader.inspectEntry({ relativePath: 'missing.txt' }), {
      found: false,
      kind: null,
      bytes: null,
      mode: null,
      mtimeMs: null,
      contentDigest: null,
      linkTarget: null,
      entryIdentityDigest: null,
    });

    fs.writeFileSync(path.join(sourceRoot, 'README.md'), 'changed-after-acquire\n', 'utf8');
    const pathnameMethods = ['lstatSync', 'openSync', 'opendirSync', 'readlinkSync', 'realpathSync', 'statSync'];
    const savedPathnameMethods = Object.fromEntries(
      pathnameMethods.map((methodName) => [methodName, fs[methodName]])
    );
    for (const methodName of pathnameMethods) {
      fs[methodName] = function denySourceReopen(location, ...args) {
        if (typeof location === 'string' && pathWithin(sourceRoot, location)) {
          throw new Error('source pathname reopened');
        }
        return Reflect.apply(savedPathnameMethods[methodName], fs, [location, ...args]);
      };
    }
    try {
      const snapshotRead = lease.reader.readFile({
        relativePath: 'README.md',
        maxBytes: 100,
      });
      assert.strictEqual(
        Buffer.from(snapshotRead.contentBase64, 'base64').toString('utf8'),
        'original\n'
      );
      assert.strictEqual(lease.reader.list(fullListRequest).truncated, false);
      assert.strictEqual(
        lease.reader.inspectEntry(inspectFileRequest).contentDigest,
        digestBytes(appBytes)
      );
    } finally {
      for (const [methodName, method] of Object.entries(savedPathnameMethods)) {
        fs[methodName] = method;
      }
    }

    const closeReceipt = assertProjectRootAuthorityCloseReceipt(lease.close(), request);
    assert.strictEqual(closeReceipt.closed, true);
    assert.deepStrictEqual(lease.close(), closeReceipt);
    assert.strictEqual(fs.existsSync(leasePrivateRoot), false);
    assert.throws(
      () => lease.reader.readFile(readRequest),
      assertBackendError('PROJECT_ROOT_LEASE_CLOSED')
    );
    assert.deepStrictEqual(backend.dispose(), { ok: true, disposed: true });
    assert.deepStrictEqual(backend.dispose(), { ok: true, disposed: true });
    for (const privateRoot of createdPrivateRoots) {
      assert.strictEqual(fs.existsSync(privateRoot), false);
    }
    const disposedProbe = backend.probe();
    assert.strictEqual(disposedProbe.state, PROJECT_ROOT_AUTHORITY_STATES.UNAVAILABLE);
    assert.strictEqual(disposedProbe.reasonCode, 'PROJECT_ROOT_BACKEND_DISPOSED');

    const registryBackend = createPortableProjectRootAuthorityBackend();
    backends.push(registryBackend);
    const registry = createProjectRootAuthorityRegistry({
      backend: registryBackend,
      leaseIdFactory: () => 'root-lease-registry',
      maxActiveLeases: 1,
    });
    const registryRoot = bindingFor(sourceRoot, 'registry');
    const acquired = await registry.acquire({
      binding: registryRoot.binding,
      expectedPhysicalRootIdentityDigest: registryRoot.identity.digest,
      purpose: 'project_scan',
    });
    assert.strictEqual(acquired.ok, true);
    const registryRead = await acquired.lease.reader.readFile({
      relativePath: 'src/app.js',
      maxBytes: 1024,
    });
    assert.strictEqual(
      Buffer.from(registryRead.contentBase64, 'base64').toString('utf8'),
      appBytes.toString('utf8')
    );
    assert.deepStrictEqual(await registry.release({
      binding: registryRoot.binding,
      leaseId: acquired.lease.leaseId,
    }), { ok: true, closed: true, idempotent: false });
    assert.deepStrictEqual(await registry.dispose(), {
      ok: true,
      disposed: true,
      quarantined: 0,
    });

    const disposeBackend = createPortableProjectRootAuthorityBackend();
    backends.push(disposeBackend);
    assert.strictEqual(disposeBackend.probe().state, PROJECT_ROOT_AUTHORITY_STATES.ENFORCED);
    const disposeRequest = requestFor(sourceRoot, 'dispose-active');
    const disposeLease = disposeBackend.acquire(disposeRequest);
    assert.deepStrictEqual(disposeBackend.dispose(), { ok: true, disposed: true });
    assert.throws(
      () => disposeLease.reader.list({ relativePath: '', maxEntries: 10 }),
      assertBackendError('PROJECT_ROOT_LEASE_CLOSED')
    );

    const source = fs.readFileSync(
      path.join(__dirname, '../main/services/portable_isolation_helper_project_root_authority_backend.js'),
      'utf8'
    );
    const utilityEntry = fs.readFileSync(
      path.join(__dirname, '../main/portable_isolation_helper/utility_entry.js'),
      'utf8'
    );
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    const readerStart = source.indexOf('function createReader');
    const readerEnd = source.indexOf('function createLease', readerStart);
    assert.ok(readerStart >= 0 && readerEnd > readerStart);
    const readerSource = source.slice(readerStart, readerEnd);
    assert.match(source, /createProjectRootPhysicalIdentityDigest/);
    assert.match(source, /fs\.constants\.O_EXCL/);
    assert.match(source, /fs\.readSync/);
    assert.match(source, /PROJECT_ROOT_SOURCE_IDENTITY_MISMATCH/);
    assert.match(source, /PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED/);
    assert.doesNotMatch(readerSource, /lstatSync|openSync|opendirSync|readlinkSync|realpathSync|statSync/);
    assert.doesNotMatch(source, /fs\.rmSync/);
    assert.doesNotMatch(source, /require\(['"](?:child_process|electron|net|tls|http|https)['"]\)|process\.env|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(/);
    assert.doesNotMatch(utilityEntry, /portable_isolation_helper_project_root_authority_backend/);
    assert.doesNotMatch(mainSource, /portable_isolation_helper_project_root_authority_backend/);
  } finally {
    for (const backend of backends) {
      try { backend.dispose(); } catch { /* test cleanup continues */ }
    }
    removeTree(fixtureRoot);
  }
}

run().then(() => {
  console.log('portable project-root authority backend tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
