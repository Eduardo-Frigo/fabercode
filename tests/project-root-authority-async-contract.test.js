'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_READER_VERSION,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityLease,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootAuthorityProbeResult,
} = require('../main/capabilities/project_root_authority_contract');
const {
  PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS,
  PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION,
  createProjectRootAuthorityRegistry,
} = require('../main/capabilities/project_root_authority_registry');

const digest = (character) => `sha256:${character.repeat(64)}`;
const bytesDigest = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function binding(jobId = 'job-a', overrides = {}) {
  return {
    projectId: overrides.projectId || `project-${jobId}`,
    canonicalRootPath: overrides.canonicalRootPath || `/workspace/${jobId}`,
    realRootPath: overrides.realRootPath || `/private/workspace/${jobId}`,
    sessionId: overrides.sessionId || `session-${jobId}`,
    jobId,
    kernelId: overrides.kernelId || 'legacy',
    submissionDigest: overrides.submissionDigest || digest('a'),
  };
}

function acquireInput(jobId = 'job-a', overrides = {}) {
  return {
    binding: overrides.binding || binding(jobId),
    expectedPhysicalRootIdentityDigest:
      overrides.expectedPhysicalRootIdentityDigest || digest('b'),
    purpose: overrides.purpose || 'execution',
  };
}

function deterministicLeaseIds() {
  let serial = 0;
  return () => `async-root-lease-${serial += 1}`;
}

function createAsyncBackend({
  acquireGate = null,
  readGate = null,
  onAcquire = null,
  onDispose = null,
} = {}) {
  const state = {
    acquires: 0,
    closes: 0,
    disposes: 0,
    events: [],
    reads: 0,
  };
  const backend = Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: 'async-project-root-authority',
    probe() {
      state.events.push('probe');
      return createProjectRootAuthorityProbeResult({
        state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
        guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
      });
    },
    async acquire(request) {
      state.acquires += 1;
      state.events.push(`acquire:${request.binding.jobId}`);
      if (typeof onAcquire === 'function') onAcquire(request, state);
      if (acquireGate) await acquireGate.promise;
      let closed = false;
      const reader = Object.freeze({
        version: PROJECT_ROOT_READER_VERSION,
        async inspectEntry() {
          if (closed) throw new Error('lease closed');
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
        },
        async list() {
          if (closed) throw new Error('lease closed');
          return Object.freeze({ entries: Object.freeze([]), truncated: false });
        },
        async readFile({ relativePath }) {
          if (closed) throw new Error('lease closed');
          state.reads += 1;
          state.events.push(`read:${relativePath}`);
          if (readGate) await readGate.promise;
          const bytes = Buffer.from('async root', 'utf8');
          return Object.freeze({
            found: true,
            contentBase64: bytes.toString('base64'),
            contentDigest: bytesDigest(bytes),
          });
        },
      });
      return Object.freeze({
        version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
        leaseId: request.leaseId,
        jobId: request.binding.jobId,
        projectId: request.binding.projectId,
        purpose: request.purpose,
        physicalRootIdentityDigest: request.expectedPhysicalRootIdentityDigest,
        authorityDigest: request.authorityDigest,
        reader,
        async close() {
          state.closes += 1;
          state.events.push(`close:${request.binding.jobId}`);
          closed = true;
          return createProjectRootAuthorityCloseReceipt({ request, closed: true });
        },
      });
    },
    async dispose() {
      state.disposes += 1;
      state.events.push('dispose');
      if (typeof onDispose === 'function') onDispose(state);
      return Object.freeze({ ok: true, disposed: true });
    },
  });
  return { backend, state };
}

async function main() {
  assert.strictEqual(
    PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    'project-root-authority-backend.v2'
  );
  assert.strictEqual(
    PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
    'project-root-authority-lease.v2'
  );
  assert.strictEqual(PROJECT_ROOT_READER_VERSION, 'project-root-reader.v3');
  assert.strictEqual(
    PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION,
    'project-root-authority-registry.v2'
  );

  const pendingAcquire = deferred();
  const readGate = deferred();
  const harness = createAsyncBackend({ acquireGate: pendingAcquire, readGate });
  assert.strictEqual(assertProjectRootAuthorityBackend(harness.backend), harness.backend);
  const registry = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
    maxActiveLeases: 2,
  });
  const firstAcquire = registry.acquire(acquireInput());
  const duplicateAcquire = registry.acquire(acquireInput());
  assert.strictEqual(firstAcquire instanceof Promise, true);
  assert.strictEqual(firstAcquire, duplicateAcquire);
  assert.strictEqual(harness.state.acquires, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.state.acquires, 1);
  assert.deepStrictEqual(await registry.acquire(acquireInput('job-b', {
    binding: binding('job-b', {
      projectId: 'project-b',
      canonicalRootPath: '/workspace/job-a/nested',
      realRootPath: '/private/workspace/job-a/nested',
    }),
  })), {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.ROOT_BUSY,
  });
  pendingAcquire.resolve();
  const acquired = await firstAcquire;
  assert.strictEqual(acquired.ok, true);
  assert.strictEqual(acquired.idempotent, false);
  assertProjectRootAuthorityLease(acquired.lease, createProjectRootAuthorityAcquireRequest({
    leaseId: acquired.lease.leaseId,
    binding: binding(),
    expectedPhysicalRootIdentityDigest: digest('b'),
    purpose: 'execution',
  }));
  const idempotent = await registry.acquire(acquireInput());
  assert.strictEqual(idempotent.lease, acquired.lease);
  assert.strictEqual(idempotent.idempotent, true);
  assert.strictEqual(harness.state.acquires, 1);

  const readPromise = acquired.lease.reader.readFile({
    relativePath: 'package.json',
    maxBytes: 1024,
  });
  assert.strictEqual(readPromise instanceof Promise, true);
  const releasePromise = registry.release({
    binding: binding(),
    leaseId: acquired.lease.leaseId,
  });
  assert.strictEqual(releasePromise instanceof Promise, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.state.closes, 0, 'close must wait for the active reader');
  readGate.resolve();
  assert.strictEqual((await readPromise).found, true);
  assert.deepStrictEqual(await releasePromise, {
    ok: true,
    closed: true,
    idempotent: false,
  });
  assert.strictEqual(harness.state.closes, 1);
  assert.deepStrictEqual(await registry.release({
    binding: binding(),
    leaseId: acquired.lease.leaseId,
  }), {
    ok: true,
    closed: true,
    idempotent: true,
  });
  await assert.rejects(
    acquired.lease.reader.list({ relativePath: '', maxEntries: 10 }),
    /closed|inactive|unhealthy/i
  );
  assert.strictEqual((await acquired.lease.close()).closed, true);
  assert.deepStrictEqual(await registry.dispose(), {
    ok: true,
    disposed: true,
    quarantined: 0,
  });
  assert.strictEqual(harness.state.disposes, 1);

  let reentrantRegistry;
  let nestedAcquire;
  const reentrantHarness = createAsyncBackend({
    onAcquire(request) {
      nestedAcquire = reentrantRegistry.acquire(acquireInput(request.binding.jobId));
    },
  });
  reentrantRegistry = createProjectRootAuthorityRegistry({
    backend: reentrantHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await reentrantRegistry.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await nestedAcquire, {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL,
  });
  await reentrantRegistry.dispose();

  const rejectedSecret = '/private/workspace/secret-root';
  const rejectedBackend = createAsyncBackend();
  const hostileBackend = Object.freeze({
    ...rejectedBackend.backend,
    async acquire() {
      throw new Error(rejectedSecret);
    },
  });
  const rejectedRegistry = createProjectRootAuthorityRegistry({
    backend: hostileBackend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.deepStrictEqual(await rejectedRegistry.acquire(acquireInput()), {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED,
  });
  assert.strictEqual(JSON.stringify(rejectedRegistry.diagnostics()).includes(rejectedSecret), false);
  await rejectedRegistry.dispose();

  const shutdownGate = deferred();
  const shutdownHarness = createAsyncBackend({ acquireGate: shutdownGate });
  const shutdownRegistry = createProjectRootAuthorityRegistry({
    backend: shutdownHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const acquireDuringShutdown = shutdownRegistry.acquire(acquireInput());
  await new Promise((resolve) => setImmediate(resolve));
  const shutdown = shutdownRegistry.dispose();
  shutdownGate.resolve();
  assert.deepStrictEqual(await acquireDuringShutdown, {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.DISPOSED,
  });
  assert.deepStrictEqual(await shutdown, {
    ok: true,
    disposed: true,
    quarantined: 0,
  });
  assert.strictEqual(shutdownHarness.state.closes, 1);
  assert.strictEqual(shutdownHarness.state.disposes, 1);

  console.log('project-root authority async contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
