'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  createTransactionalFilesystemDeleteService,
} = require('../main/services/transactional_filesystem_delete_service');
const {
  createAnchoredMutationTestBackend,
} = require('./support/anchored_mutation_test_backend');

const journalSecret = Buffer.alloc(32, 0x6a);
const journalAuthenticator = Object.freeze({
  seal(_rootPath, value) {
    return `hmac-sha256:${crypto
      .createHmac('sha256', journalSecret)
      .update(canonicalSha256Digest(value), 'utf8')
      .digest('hex')}`;
  },
  verify(rootPath, value, tag) {
    if (typeof tag !== 'string') return false;
    const expected = this.seal(rootPath, value);
    return expected.length === tag.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(tag));
  },
});

function bindingFor(rootPath, suffix = 'a') {
  const realRootPath = fs.realpathSync(rootPath);
  return Object.freeze({
    projectId: `project-${suffix}`,
    canonicalRootPath: realRootPath,
    realRootPath,
    sessionId: `session-${suffix}`,
    jobId: `job-${suffix}`,
    kernelId: `kernel-${suffix}`,
    submissionDigest: `sha256:${suffix.repeat(64)}`,
  });
}

function createService({
  binding,
  mutationBackend,
  fsImpl = fs,
  transactionId,
  transactionIdFactory = null,
}) {
  return createTransactionalFilesystemDeleteService({
    fs: fsImpl,
    authorizeLifecycle(candidate) {
      return { authorized: true, binding: candidate };
    },
    authorizeRoot(candidate) {
      return {
        authorized: true,
        projectId: candidate.projectId,
        canonicalRootPath: candidate.canonicalRootPath,
        realRootPath: candidate.realRootPath,
      };
    },
    authorizeEffectFrontier(candidate) {
      return { authorized: true, binding: candidate };
    },
    journalAuthenticator,
    mutationBackend,
    transactionIdFactory: transactionIdFactory || (() => transactionId),
  });
}

function privatePathBlockingFs(rootPath, blockedCalls) {
  const privatePrefix = `${path.join(rootPath, '.faber')}${path.sep}`;
  const privateRoot = path.join(rootPath, '.faber');
  return new Proxy(fs, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const blocked = args.some((argument) => (
          typeof argument === 'string'
          && (argument === privateRoot || argument.startsWith(privatePrefix))
        ));
        if (blocked) {
          blockedCalls.push({ property: String(property), path: args.find((arg) => typeof arg === 'string') });
          const error = new Error('consumer attempted private pathname I/O');
          error.code = 'PRIVATE_PATHNAME_IO_BLOCKED';
          throw error;
        }
        return value.apply(target, args);
      };
    },
  });
}

function withProject(callback) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-namespace-bootstrap-'));
  try { callback(rootPath); } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

// Recovery bootstraps from a pinned read-only root capability and promotes the
// same authenticated chain into the mutable recovery session. The consumer's
// fs object is unable to address any `.faber` pathname.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'a');
  fs.writeFileSync(path.join(rootPath, 'recover-me.txt'), 'recover-me');
  const firstBackend = createAnchoredMutationTestBackend();
  const first = createService({
    binding,
    mutationBackend: firstBackend,
    transactionId: 'transaction-bootstrap-0001',
  });
  const prepared = first.prepare({
    binding,
    paths: ['recover-me.txt'],
    pathStyle: 'posix',
    caseSensitive: true,
  });
  assert.strictEqual(prepared.commit({
    decisionRequestDigest: `sha256:${'b'.repeat(64)}`,
    consumeDecision: () => ({ authorized: true }),
  }).state, 'COMMITTED');

  const blockedCalls = [];
  const events = [];
  const secondBackend = createAnchoredMutationTestBackend({
    onEvent: (event) => events.push(event),
  });
  const second = createService({
    binding,
    mutationBackend: secondBackend,
    fsImpl: privatePathBlockingFs(rootPath, blockedCalls),
    transactionId: 'transaction-bootstrap-0002',
  });
  assert.deepStrictEqual(second.recoverProject({ binding }), {
    ok: true,
    recovered: 0,
    retainedCommitted: 1,
    retainedUnknown: 0,
  });
  assert.strictEqual(events[0].type, 'root.open');
  assert(events.some((event) => event.type === 'session.openExisting'));
  assert.deepStrictEqual(second.rollbackJob({ binding, reason: 'test' }), {
    ok: true,
    purged: 0,
    rolledBack: 1,
    recoveryRequired: 0,
  });
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'recover-me.txt'), 'utf8'), 'recover-me');
  assert.deepStrictEqual(blockedCalls, []);
});

// Live prepare also opens the anchored mutation session before its first
// private write; all checkpoint/WAL effects are session-mediated.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'c');
  fs.writeFileSync(path.join(rootPath, 'delete-me.txt'), 'delete-me');
  const blockedCalls = [];
  const events = [];
  const backend = createAnchoredMutationTestBackend({
    onEvent: (event) => events.push(event),
  });
  const service = createService({
    binding,
    mutationBackend: backend,
    fsImpl: privatePathBlockingFs(rootPath, blockedCalls),
    transactionId: 'transaction-live-0000001',
  });
  const prepared = service.prepare({
    binding,
    paths: ['delete-me.txt'],
    pathStyle: 'posix',
    caseSensitive: true,
  });
  const firstWrite = events.findIndex((event) => event.type === 'namespace.write');
  const sessionOpen = events.findIndex((event) => event.type === 'session.prepare');
  assert(sessionOpen >= 0 && firstWrite > sessionOpen);
  assert.strictEqual(
    events[firstWrite].relativePath,
    'transactions/transaction-live-0000001/manifest.json',
    'the first private write must be the authenticated transaction manifest'
  );
  assert.strictEqual(prepared.abort({ reason: 'test' }).ok, true);
  assert.deepStrictEqual(blockedCalls, []);
});

// Unsupported remains harmless for an empty root and fail-closed when any
// private metadata already exists; it never mutates by pathname.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'd');
  const empty = createTransactionalFilesystemDeleteService({
    authorizeLifecycle: (candidate) => ({ authorized: true, binding: candidate }),
    authorizeRoot: (candidate) => ({
      authorized: true,
      projectId: candidate.projectId,
      canonicalRootPath: candidate.canonicalRootPath,
      realRootPath: candidate.realRootPath,
    }),
    authorizeEffectFrontier: (candidate) => ({ authorized: true, binding: candidate }),
  });
  assert.deepStrictEqual(empty.recoverProject({ binding }), {
    ok: true,
    recovered: 0,
    retainedCommitted: 0,
    retainedUnknown: 0,
  });
  fs.mkdirSync(path.join(rootPath, '.faber'));
  assert.deepStrictEqual(empty.recoverProject({ binding }), {
    ok: false,
    recovered: 0,
    retainedCommitted: 0,
    retainedUnknown: 1,
  });
});

// Construction probes exactly once and never executes an untrusted `then`
// accessor while rejecting synchronous trust-boundary results.
withProject((rootPath) => {
  const binding = bindingFor(rootPath, 'e');
  const base = createAnchoredMutationTestBackend();
  let probeCalls = 0;
  const countedBackend = Object.freeze({
    namespaceIoVersion: base.namespaceIoVersion,
    probe() { probeCalls += 1; return base.probe(); },
    prepare: base.prepare,
    openRootNamespace: base.openRootNamespace,
  });
  createService({
    binding,
    mutationBackend: countedBackend,
    transactionId: 'transaction-probe-000001',
  });
  assert.strictEqual(probeCalls, 1);

  const rejectedProbeBackend = Object.freeze({
    namespaceIoVersion: base.namespaceIoVersion,
    probe() { return Promise.reject(new Error('async probe rejected')); },
    prepare: base.prepare,
    openRootNamespace: base.openRootNamespace,
  });
  assert.throws(() => createService({
    binding,
    mutationBackend: rejectedProbeBackend,
    transactionId: 'transaction-rejected-0001',
  }), (error) => error && error.code === 'INVALID_OPTIONS');

  let thenGetterReads = 0;
  const hostileAuthorityResult = {};
  Object.defineProperty(hostileAuthorityResult, 'then', {
    enumerable: true,
    get() {
      thenGetterReads += 1;
      throw new Error('hostile then getter executed');
    },
  });
  const hostile = createTransactionalFilesystemDeleteService({
    authorizeLifecycle: () => hostileAuthorityResult,
    authorizeRoot: (candidate) => ({
      authorized: true,
      projectId: candidate.projectId,
      canonicalRootPath: candidate.canonicalRootPath,
      realRootPath: candidate.realRootPath,
    }),
    authorizeEffectFrontier: (candidate) => ({ authorized: true, binding: candidate }),
    journalAuthenticator,
    mutationBackend: base,
    transactionIdFactory: () => 'transaction-hostile-00001',
  });
  fs.writeFileSync(path.join(rootPath, 'hostile.txt'), 'hostile');
  assert.throws(() => hostile.prepare({
    binding,
    paths: ['hostile.txt'],
    pathStyle: 'posix',
    caseSensitive: true,
  }), (error) => error && error.code === 'LIFECYCLE_INVALIDATED');
  assert.strictEqual(thenGetterReads, 0);
});

for (const boundedCase of ['metadata', 'transaction-list', 'head-list']) {
  withProject((rootPath) => {
    const binding = bindingFor(rootPath, boundedCase === 'metadata' ? 'f' : '9');
    const transactionsPath = path.join(rootPath, '.faber', 'transactions');
    const headsPath = path.join(rootPath, '.faber', 'transaction-heads');
    fs.mkdirSync(transactionsPath, { recursive: true });
    fs.mkdirSync(headsPath, { recursive: true });
    if (boundedCase === 'metadata') {
      const transactionPath = path.join(transactionsPath, 'transaction-oversized-01');
      fs.mkdirSync(transactionPath);
      fs.writeFileSync(
        path.join(transactionPath, 'manifest.json'),
        Buffer.alloc((2 * 1024 * 1024) + 1, 0x20)
      );
    } else {
      const parent = boundedCase === 'transaction-list' ? transactionsPath : headsPath;
      const count = boundedCase === 'transaction-list' ? 193 : 513;
      for (let index = 0; index < count; index += 1) {
        fs.mkdirSync(path.join(parent, `entry-${String(index).padStart(12, '0')}`));
      }
    }
    const service = createService({
      binding,
      mutationBackend: createAnchoredMutationTestBackend(),
      transactionId: 'transaction-bounds-00001',
    });
    assert.deepStrictEqual(service.recoverProject({ binding }), {
      ok: false,
      recovered: 0,
      retainedCommitted: 0,
      retainedUnknown: 1,
    }, boundedCase);
  });
}

withProject((rootPath) => {
  const binding = bindingFor(rootPath, '8');
  const firstBackend = createAnchoredMutationTestBackend();
  let transactionSerial = 0;
  const first = createService({
    binding,
    mutationBackend: firstBackend,
    transactionIdFactory: () => (
      `transaction-cap-live-${String(transactionSerial += 1).padStart(6, '0')}`
    ),
  });
  for (let index = 0; index < 192; index += 1) {
    const relativePath = `capacity-${String(index).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(rootPath, relativePath), relativePath);
    const prepared = first.prepare({
      binding,
      paths: [relativePath],
      pathStyle: 'posix',
      caseSensitive: true,
    });
    assert.strictEqual(prepared.commit({
      decisionRequestDigest: `sha256:${'7'.repeat(64)}`,
      consumeDecision: () => ({ authorized: true }),
    }).state, 'COMMITTED');
  }

  const transactionsPath = path.join(rootPath, '.faber', 'transactions');
  assert.strictEqual(fs.readdirSync(transactionsPath).length, 192);
  fs.writeFileSync(path.join(rootPath, 'capacity-safe.txt'), 'capacity-safe');
  const restartEvents = [];
  const restarted = createService({
    binding,
    mutationBackend: createAnchoredMutationTestBackend({
      onEvent: (event) => restartEvents.push(event),
    }),
    transactionId: 'transaction-capacity-193',
  });
  const capacityEventStart = restartEvents.length;
  assert.throws(() => restarted.prepare({
    binding,
    paths: ['capacity-safe.txt'],
    pathStyle: 'posix',
    caseSensitive: true,
  }), (error) => error && error.code === 'TRANSACTION_CAPACITY_EXCEEDED');
  assert.strictEqual(fs.readFileSync(path.join(rootPath, 'capacity-safe.txt'), 'utf8'), 'capacity-safe');
  assert.strictEqual(fs.readdirSync(transactionsPath).length, 192);
  assert.strictEqual(
    restartEvents.slice(capacityEventStart).some((event) => (
      event.type === 'session.prepare' || event.type === 'namespace.write'
    )),
    false,
    'the 193rd transaction must be denied before session allocation or metadata writes'
  );
  assert.deepStrictEqual(restarted.recoverProject({ binding }), {
    ok: true,
    recovered: 0,
    retainedCommitted: 192,
    retainedUnknown: 0,
  });
});

console.log('transactional delete namespace bootstrap tests passed');
