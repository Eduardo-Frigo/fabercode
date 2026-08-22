'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PROJECT_ROOT_ENTRY_KINDS,
  PROJECT_ROOT_READER_VERSION,
} = require('../main/capabilities/project_root_authority_contract');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  createTransactionalFilesystemDeleteService,
} = require('../main/services/transactional_filesystem_delete_service');
const {
  createAnchoredMutationTestBackend,
} = require('./support/anchored_mutation_test_backend');

const digest = (character) => `sha256:${character.repeat(64)}`;
const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const secret = Buffer.alloc(32, 7);

const journalAuthenticator = Object.freeze({
  version: 'transactional-delete.hmac-sha256.v1',
  seal(_rootPath, value) {
    return `hmac-sha256:${crypto.createHmac('sha256', secret)
      .update(canonicalSha256Digest(value), 'utf8')
      .digest('hex')}`;
  },
  verify(rootPath, value, authenticationTag) {
    return authenticationTag === this.seal(rootPath, value);
  },
});

function binding(rootPath) {
  const realRootPath = fs.realpathSync(rootPath);
  return Object.freeze({
    projectId: 'project-root-reader',
    canonicalRootPath: realRootPath,
    realRootPath,
    sessionId: 'session-root-reader',
    jobId: 'job-root-reader',
    kernelId: 'legacy',
    submissionDigest: digest('a'),
  });
}

function safeAbsolute(rootPath, relativePath) {
  const components = relativePath.split('/');
  assert(components.every((component) => component && component !== '.' && component !== '..'));
  return path.join(rootPath, ...components);
}

function identityDigest(stat, kind) {
  return sha256(Buffer.from(JSON.stringify({
    device: String(stat.dev),
    inode: String(stat.ino),
    kind,
  }), 'utf8'));
}

function createRootReader(rootPath, events) {
  return Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    inspectEntry({ relativePath }) {
      events.push(`inspect:${relativePath}`);
      const absolutePath = safeAbsolute(rootPath, relativePath);
      let stat;
      try { stat = fs.lstatSync(absolutePath); } catch (error) {
        if (error && error.code === 'ENOENT') {
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
        throw error;
      }
      const mode = stat.mode & 0o7777;
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        return Object.freeze({
          found: true,
          kind: PROJECT_ROOT_ENTRY_KINDS.DIRECTORY,
          bytes: 0,
          mode,
          mtimeMs: stat.mtimeMs,
          contentDigest: null,
          linkTarget: null,
          entryIdentityDigest: identityDigest(stat, 'directory'),
        });
      }
      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(absolutePath);
        const bytes = Buffer.from(linkTarget, 'utf8');
        return Object.freeze({
          found: true,
          kind: PROJECT_ROOT_ENTRY_KINDS.SYMLINK,
          bytes: bytes.length,
          mode,
          mtimeMs: stat.mtimeMs,
          contentDigest: sha256(bytes),
          linkTarget,
          entryIdentityDigest: identityDigest(stat, 'symlink'),
        });
      }
      if (stat.isFile()) {
        const bytes = fs.readFileSync(absolutePath);
        return Object.freeze({
          found: true,
          kind: PROJECT_ROOT_ENTRY_KINDS.FILE,
          bytes: bytes.length,
          mode,
          mtimeMs: stat.mtimeMs,
          contentDigest: sha256(bytes),
          linkTarget: null,
          entryIdentityDigest: identityDigest(stat, 'file'),
        });
      }
      return Object.freeze({
        found: true,
        kind: PROJECT_ROOT_ENTRY_KINDS.OTHER,
        bytes: 0,
        mode,
        mtimeMs: stat.mtimeMs,
        contentDigest: null,
        linkTarget: null,
        entryIdentityDigest: identityDigest(stat, 'other'),
      });
    },
    list({ relativePath, maxEntries }) {
      events.push(`list:${relativePath}`);
      const absolutePath = safeAbsolute(rootPath, relativePath);
      const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => Object.freeze({
          name: entry.name,
          kind: entry.isSymbolicLink()
            ? PROJECT_ROOT_ENTRY_KINDS.SYMLINK
            : entry.isDirectory()
              ? PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
              : entry.isFile()
                ? PROJECT_ROOT_ENTRY_KINDS.FILE
                : PROJECT_ROOT_ENTRY_KINDS.OTHER,
        }));
      return Object.freeze({
        entries: Object.freeze(entries.slice(0, maxEntries)),
        truncated: entries.length > maxEntries,
      });
    },
    readFile({ relativePath, maxBytes }) {
      events.push(`read:${relativePath}`);
      const bytes = fs.readFileSync(safeAbsolute(rootPath, relativePath));
      if (bytes.length > maxBytes) {
        return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
      }
      return Object.freeze({
        found: true,
        contentBase64: bytes.toString('base64'),
        contentDigest: sha256(bytes),
      });
    },
  });
}

function guardedPathnameFs(events) {
  const guarded = Object.create(fs);
  for (const method of [
    'fstatSync',
    'lstatSync',
    'openSync',
    'readFileSync',
    'readlinkSync',
    'readdirSync',
    'realpathSync',
  ]) {
    Object.defineProperty(guarded, method, {
      configurable: false,
      enumerable: true,
      value() {
        events.push(`forbidden:${method}`);
        throw new Error(`transaction consumer reopened pathname through ${method}`);
      },
      writable: false,
    });
  }
  return guarded;
}

const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-root-reader-delete-'));
try {
  fs.mkdirSync(path.join(rootPath, 'src'));
  fs.writeFileSync(path.join(rootPath, 'src', 'old.txt'), 'anchored-content', 'utf8');
  const authorityBinding = binding(rootPath);
  const readerEvents = [];
  const forbiddenEvents = [];
  const rootReader = createRootReader(authorityBinding.realRootPath, readerEvents);
  let readerRequests = 0;
  let transactionSerial = 0;
  const service = createTransactionalFilesystemDeleteService({
    authorizeLifecycle(candidate) { return { authorized: true, binding: candidate }; },
    authorizeRoot(candidate) {
      return {
        authorized: true,
        projectId: candidate.projectId,
        canonicalRootPath: candidate.canonicalRootPath,
        realRootPath: candidate.realRootPath,
      };
    },
    authorizeEffectFrontier(candidate) { return { authorized: true, binding: candidate }; },
    getProjectRootReader(candidate) {
      readerRequests += 1;
      assert.deepStrictEqual(candidate, authorityBinding);
      return rootReader;
    },
    fs: guardedPathnameFs(forbiddenEvents),
    journalAuthenticator,
    mutationBackend: createAnchoredMutationTestBackend({
      fsImpl: fs,
      backendId: 'root-reader-anchored-backend',
    }),
    now: () => 1_725_000_000_000,
    transactionIdFactory() {
      transactionSerial += 1;
      return `root-reader-transaction-${transactionSerial}`;
    },
  });

  const prepared = service.prepare({
    binding: authorityBinding,
    paths: ['src'],
    pathStyle: 'posix',
    caseSensitive: true,
  });
  assert.deepStrictEqual(prepared.inspect().plan.impact, {
    schemaVersion: 'transactional-delete.impact.v1',
    contractVersion: 'transactional-delete.v1',
    files: 1,
    bytes: Buffer.byteLength('anchored-content', 'utf8'),
    directories: 1,
  });
  assert.strictEqual(prepared.verify().checkpointVerified, true);
  assert.strictEqual(prepared.abort({ reason: 'test_cleanup' }).ok, true);
  assert.strictEqual(readerRequests, 1, 'one retained reader must cover prepare, verify, and abort');
  assert(readerEvents.includes('inspect:src'));
  assert(readerEvents.includes('list:src'));
  assert(readerEvents.includes('inspect:src/old.txt'));
  assert.deepStrictEqual(forbiddenEvents, []);
} finally {
  fs.rmSync(rootPath, { recursive: true, force: true });
}

function createReaderBackedService(rootPathInput, getProjectRootReader, forbiddenEvents) {
  const authorityBinding = binding(rootPathInput);
  let transactionSerial = 0;
  return Object.freeze({
    binding: authorityBinding,
    service: createTransactionalFilesystemDeleteService({
      authorizeLifecycle(candidate) { return { authorized: true, binding: candidate }; },
      authorizeRoot(candidate) {
        return {
          authorized: true,
          projectId: candidate.projectId,
          canonicalRootPath: candidate.canonicalRootPath,
          realRootPath: candidate.realRootPath,
        };
      },
      authorizeEffectFrontier(candidate) { return { authorized: true, binding: candidate }; },
      getProjectRootReader,
      fs: guardedPathnameFs(forbiddenEvents),
      journalAuthenticator,
      mutationBackend: createAnchoredMutationTestBackend({
        fsImpl: fs,
        backendId: 'root-reader-adversarial-backend',
      }),
      now: () => 1_725_000_000_000,
      transactionIdFactory() {
        transactionSerial += 1;
        return `root-reader-adversarial-${transactionSerial}`;
      },
    }),
  });
}

function withAdversarialProject(callback) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-root-reader-adversarial-'));
  try {
    fs.mkdirSync(path.join(projectRoot, 'src'));
    fs.writeFileSync(path.join(projectRoot, 'src', 'victim.txt'), 'remain-safe', 'utf8');
    return callback(projectRoot);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

withAdversarialProject((projectRoot) => {
  const readerEvents = [];
  const forbiddenEvents = [];
  const rootReader = createRootReader(fs.realpathSync(projectRoot), readerEvents);
  const harness = createReaderBackedService(
    projectRoot,
    () => Promise.resolve(rootReader),
    forbiddenEvents
  );
  assert.throws(() => harness.service.prepare({
    binding: harness.binding,
    paths: ['src/victim.txt'],
    pathStyle: 'posix',
    caseSensitive: true,
  }), (error) => error.code === 'ROOT_INVALIDATED');
  assert.deepStrictEqual(readerEvents, []);
  assert.deepStrictEqual(forbiddenEvents, []);
  assert.strictEqual(
    fs.readFileSync(path.join(projectRoot, 'src', 'victim.txt'), 'utf8'),
    'remain-safe'
  );
});

withAdversarialProject((projectRoot) => {
  const readerEvents = [];
  const forbiddenEvents = [];
  const baseReader = createRootReader(fs.realpathSync(projectRoot), readerEvents);
  const asynchronousInspectionReader = Object.freeze({
    version: baseReader.version,
    inspectEntry(input) { return Promise.resolve(baseReader.inspectEntry(input)); },
    list: baseReader.list,
    readFile: baseReader.readFile,
  });
  const harness = createReaderBackedService(
    projectRoot,
    () => asynchronousInspectionReader,
    forbiddenEvents
  );
  assert.throws(() => harness.service.prepare({
    binding: harness.binding,
    paths: ['src/victim.txt'],
    pathStyle: 'posix',
    caseSensitive: true,
  }), (error) => error.code === 'ROOT_INVALIDATED');
  assert.deepStrictEqual(forbiddenEvents, []);
  assert.strictEqual(
    fs.readFileSync(path.join(projectRoot, 'src', 'victim.txt'), 'utf8'),
    'remain-safe'
  );
});

withAdversarialProject((projectRoot) => {
  const readerEvents = [];
  const forbiddenEvents = [];
  const baseReader = createRootReader(fs.realpathSync(projectRoot), readerEvents);
  let directoryInspections = 0;
  const racingDirectoryReader = Object.freeze({
    version: baseReader.version,
    inspectEntry(input) {
      const inspected = baseReader.inspectEntry(input);
      if (input.relativePath !== 'src') return inspected;
      directoryInspections += 1;
      return directoryInspections === 1
        ? inspected
        : Object.freeze({ ...inspected, mtimeMs: inspected.mtimeMs + 1 });
    },
    list: baseReader.list,
    readFile: baseReader.readFile,
  });
  const harness = createReaderBackedService(
    projectRoot,
    () => racingDirectoryReader,
    forbiddenEvents
  );
  assert.throws(() => harness.service.prepare({
    binding: harness.binding,
    paths: ['src'],
    pathStyle: 'posix',
    caseSensitive: true,
  }), (error) => error.code === 'TARGET_CHANGED');
  assert.strictEqual(directoryInspections, 2);
  assert.deepStrictEqual(forbiddenEvents, []);
  assert.strictEqual(
    fs.readFileSync(path.join(projectRoot, 'src', 'victim.txt'), 'utf8'),
    'remain-safe'
  );
});

console.log('transactional delete project-root reader tests passed');
