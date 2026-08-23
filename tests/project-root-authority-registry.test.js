'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_READER_VERSION,
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

function binding(jobId = 'job-a', overrides = {}) {
  return {
    projectId: overrides.projectId || 'project-a',
    canonicalRootPath: overrides.canonicalRootPath || '/workspace/project-a',
    realRootPath: overrides.realRootPath || '/private/workspace/project-a',
    sessionId: overrides.sessionId || `session-${jobId}`,
    jobId,
    kernelId: overrides.kernelId || 'legacy',
    submissionDigest: overrides.submissionDigest || digest('a'),
  };
}

function acquireInput(jobId = 'job-a', identity = digest('b'), overrides = {}) {
  return {
    binding: overrides.binding || binding(jobId),
    expectedPhysicalRootIdentityDigest: identity,
    purpose: overrides.purpose || 'project_scan',
  };
}

function deterministicLeaseIds() {
  let serial = 0;
  return () => `project-root-lease-${serial += 1}`;
}

function createBackend(overrides = {}) {
  const state = {
    acquires: 0,
    closes: 0,
    disposes: 0,
    events: [],
    probes: 0,
  };
  const files = new Map([
    ['package.json', Buffer.from('{"dependencies":{"next":"1"}}', 'utf8')],
  ]);
  const backend = Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: 'test-project-root-authority',
    probe() {
      state.probes += 1;
      state.events.push('probe');
      return createProjectRootAuthorityProbeResult({
        state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
        guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
      });
    },
    acquire(request) {
      state.acquires += 1;
      state.events.push(`acquire:${request.binding.jobId}`);
      let closed = false;
      const reader = Object.freeze({
        version: PROJECT_ROOT_READER_VERSION,
        inspectEntry({ relativePath }) {
          if (closed) throw Object.assign(new Error('closed'), { code: 'LEASE_CLOSED' });
          state.events.push(`inspect:${relativePath}`);
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
        list({ relativePath }) {
          if (closed) throw Object.assign(new Error('closed'), { code: 'LEASE_CLOSED' });
          state.events.push(`list:${relativePath}`);
          return Object.freeze({
            entries: Object.freeze(relativePath === ''
              ? [Object.freeze({ name: 'package.json', kind: 'file' })]
              : []),
            truncated: false,
          });
        },
        readFile({ relativePath }) {
          if (closed) throw Object.assign(new Error('closed'), { code: 'LEASE_CLOSED' });
          state.events.push(`read:${relativePath}`);
          const bytes = files.get(relativePath);
          return bytes
            ? Object.freeze({
              found: true,
              contentBase64: bytes.toString('base64'),
              contentDigest: bytesDigest(bytes),
            })
            : Object.freeze({ found: false, contentBase64: null, contentDigest: null });
        },
      });
      const lease = Object.freeze({
        version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
        leaseId: request.leaseId,
        jobId: request.binding.jobId,
        projectId: request.binding.projectId,
        purpose: request.purpose,
        physicalRootIdentityDigest: request.expectedPhysicalRootIdentityDigest,
        authorityDigest: request.authorityDigest,
        reader,
        close() {
          state.closes += 1;
          state.events.push(`close:${request.binding.jobId}`);
          closed = true;
          return createProjectRootAuthorityCloseReceipt({ request, closed: true });
        },
      });
      return typeof overrides.acquire === 'function'
        ? overrides.acquire(request, lease, state)
        : lease;
    },
    dispose() {
      state.disposes += 1;
      state.events.push('dispose');
      return typeof overrides.dispose === 'function'
        ? overrides.dispose(state)
        : Object.freeze({ ok: true, disposed: true });
    },
  });
  return { backend, state };
}

async function main() {

{
  const harness = createBackend();
  const authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
    maxActiveLeases: 4,
  });
  const acquired = await authority.acquire(acquireInput());
  assert.strictEqual(acquired.ok, true);
  assert.strictEqual(acquired.lease.leaseId, 'project-root-lease-1');
  assert.deepStrictEqual(await acquired.lease.reader.list({ relativePath: '', maxEntries: 20 }), {
    entries: [{ name: 'package.json', kind: 'file' }],
    truncated: false,
  });
  const read = await acquired.lease.reader.readFile({ relativePath: 'package.json', maxBytes: 1024 });
  assert.strictEqual(Buffer.from(read.contentBase64, 'base64').toString('utf8'), '{"dependencies":{"next":"1"}}');
  assert.strictEqual(harness.state.probes, 1);

  const duplicate = await authority.acquire(acquireInput());
  assert.strictEqual(duplicate.ok, true);
  assert.strictEqual(duplicate.lease, acquired.lease);
  assert.strictEqual(duplicate.idempotent, true);
  assert.strictEqual(harness.state.acquires, 1);

  const receipt = await acquired.lease.close();
  assert.strictEqual(receipt.closed, true);
  assert.deepStrictEqual(await authority.release({
    binding: binding(),
    leaseId: acquired.lease.leaseId,
  }), { ok: true, closed: true, idempotent: true });
  await assert.rejects(
    acquired.lease.reader.list({ relativePath: '', maxEntries: 20 }),
    /closed|inactive/i
  );
  assert.strictEqual(harness.state.closes, 1);
  assert.deepStrictEqual(authority.diagnostics(), {
    version: PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION,
    backendState: 'enforced',
    healthy: true,
    disposed: false,
    active: 0,
    closed: 1,
    quarantined: 0,
    maxActiveLeases: 4,
  });
}

{
  const harness = createBackend();
  const authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await authority.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await authority.acquire(acquireInput('job-b', digest('b'), {
    binding: binding('job-b', {
      projectId: 'project-b',
      canonicalRootPath: '/workspace/project-a/nested',
      realRootPath: '/private/workspace/project-a/nested',
    }),
  })), {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.ROOT_BUSY,
  });
  assert.strictEqual(harness.state.acquires, 1);
}

{
  const harness = createBackend();
  const authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
    maxActiveLeases: 1,
  });
  assert.strictEqual((await authority.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await authority.acquire(acquireInput('job-b', digest('c'), {
    binding: binding('job-b', {
      projectId: 'project-b',
      canonicalRootPath: '/workspace/project-b',
      realRootPath: '/private/workspace/project-b',
    }),
  })), {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CAPACITY_EXCEEDED,
  });
}

{
  const harness = createBackend({
    acquire(request, lease) {
      return Object.freeze({ ...lease, physicalRootIdentityDigest: digest('f') });
    },
  });
  const authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.deepStrictEqual(await authority.acquire(acquireInput()), {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED,
  });
  assert.strictEqual(authority.diagnostics().healthy, false);
}

{
  const harness = createBackend({
    acquire(request, lease) {
      return Object.freeze({
        ...lease,
        close() {
          return Object.freeze({ closed: true });
        },
      });
    },
  });
  const authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const acquired = await authority.acquire(acquireInput());
  assert.strictEqual(acquired.ok, true);
  assert.deepStrictEqual(await authority.release({
    binding: binding(),
    leaseId: acquired.lease.leaseId,
  }), {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CLOSE_FAILED,
  });
  assert.strictEqual(authority.diagnostics().healthy, false);
  assert.strictEqual(authority.diagnostics().quarantined, 1);
}

{
  const harness = createBackend({
    acquire(request, lease) {
      const invalidReader = Object.freeze({
        ...lease.reader,
        list() {
          return Object.freeze({
            entries: Object.freeze([{ name: '../escape', kind: 'file' }]),
            truncated: false,
          });
        },
      });
      return Object.freeze({ ...lease, reader: invalidReader });
    },
  });
  const authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const acquired = await authority.acquire(acquireInput());
  assert.strictEqual(acquired.ok, true);
  await assert.rejects(
    acquired.lease.reader.list({ relativePath: '', maxEntries: 20 }),
    /reader\.list|failed/i
  );
  assert.strictEqual(authority.diagnostics().healthy, false);
  assert.strictEqual(authority.diagnostics().quarantined, 1);
}

{
  let authority;
  let nested;
  const harness = createBackend({
    acquire(request, lease) {
      nested = authority.acquire(acquireInput(request.binding.jobId));
      return lease;
    },
  });
  authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await authority.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await nested, {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL,
  });
}

{
  const harness = createBackend();
  let authority;
  let nested;
  authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory() {
      nested = authority.acquire(acquireInput());
      return 'project-root-lease-reentrant-id';
    },
  });
  assert.strictEqual((await authority.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await nested, {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL,
  });
  assert.strictEqual(harness.state.acquires, 1);
}

{
  const harness = createBackend();
  const authority = createProjectRootAuthorityRegistry({
    backend: harness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await authority.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await authority.dispose(), {
    ok: true,
    disposed: true,
    quarantined: 0,
  });
  assert.deepStrictEqual(harness.state.events.slice(-2), ['close:job-a', 'dispose']);
  assert.deepStrictEqual(await authority.acquire(acquireInput()), {
    ok: false,
    code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.DISPOSED,
  });
}

console.log('project-root-authority-registry.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
