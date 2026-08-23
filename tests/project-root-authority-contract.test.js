'use strict';

const assert = require('assert');

const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_READER_VERSION,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityLease,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootAuthorityProbeResult,
  createUnsupportedProjectRootAuthorityBackend,
} = require('../main/capabilities/project_root_authority_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding(overrides = {}) {
  return {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/project-a',
    realRootPath: '/private/workspace/project-a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'legacy',
    submissionDigest: digest('a'),
    ...overrides,
  };
}

function reader(overrides = {}) {
  return Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    inspectEntry() {
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
    list() {
      return Object.freeze({
        entries: Object.freeze([]),
        truncated: false,
      });
    },
    readFile() {
      return Object.freeze({
        found: false,
        contentBase64: null,
        contentDigest: null,
      });
    },
    ...overrides,
  });
}

async function main() {

const request = createProjectRootAuthorityAcquireRequest({
  leaseId: 'root-lease-a',
  binding: binding(),
  expectedPhysicalRootIdentityDigest: digest('b'),
  purpose: 'project_scan',
});

assert.strictEqual(request.binding.realRootPath, '/private/workspace/project-a');
assert.strictEqual(request.expectedPhysicalRootIdentityDigest, digest('b'));
assert.strictEqual(request.purpose, 'project_scan');
assert.ok(Object.isFrozen(request));

const enforcedProbe = createProjectRootAuthorityProbeResult({
  state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
  guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
});
assert.deepStrictEqual(
  enforcedProbe.guarantees,
  Object.freeze([
    PROJECT_ROOT_AUTHORITY_GUARANTEES.PINNED_PHYSICAL_ROOT,
    PROJECT_ROOT_AUTHORITY_GUARANTEES.HANDLE_RELATIVE_READ,
    PROJECT_ROOT_AUTHORITY_GUARANTEES.HANDLE_RELATIVE_INSPECT,
    PROJECT_ROOT_AUTHORITY_GUARANTEES.NO_SYMLINK_TRAVERSAL,
    PROJECT_ROOT_AUTHORITY_GUARANTEES.NO_PATHNAME_REOPEN,
    PROJECT_ROOT_AUTHORITY_GUARANTEES.AUTHENTICATED_CLOSE,
  ])
);

assert.throws(
  () => createProjectRootAuthorityProbeResult({
    state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
    guarantees: [PROJECT_ROOT_AUTHORITY_GUARANTEES.PINNED_PHYSICAL_ROOT],
  }),
  /guarantee/i
);

const rootReader = reader();
const lease = assertProjectRootAuthorityLease(Object.freeze({
  version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  leaseId: request.leaseId,
  jobId: request.binding.jobId,
  projectId: request.binding.projectId,
  purpose: request.purpose,
  physicalRootIdentityDigest: request.expectedPhysicalRootIdentityDigest,
  authorityDigest: request.authorityDigest,
  reader: rootReader,
  close() {
    return createProjectRootAuthorityCloseReceipt({ request, closed: true });
  },
}), request);
assert.strictEqual(lease.reader, rootReader);
assert.ok(Object.isFrozen(lease));

assert.throws(
  () => assertProjectRootAuthorityLease(Object.freeze({
    ...lease,
    physicalRootIdentityDigest: digest('c'),
  }), request),
  /identity|binding/i
);

const asyncCloseLease = assertProjectRootAuthorityLease(Object.freeze({
    ...lease,
    close: async () => createProjectRootAuthorityCloseReceipt({ request, closed: true }),
}), request);
assert.strictEqual((await asyncCloseLease.close()).closed, true);

const backend = assertProjectRootAuthorityBackend(Object.freeze({
  version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  id: 'test-project-root-authority',
  probe() { return enforcedProbe; },
  async acquire() { return lease; },
  async dispose() { return Object.freeze({ ok: true, disposed: true }); },
}));
assert.strictEqual(backend.id, 'test-project-root-authority');
assert.strictEqual(await backend.acquire(request), lease);

assert.throws(
  () => assertProjectRootAuthorityBackend(Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: 'async-probe-project-root-authority',
    async probe() { return enforcedProbe; },
    async acquire() { return lease; },
    async dispose() { return Object.freeze({ ok: true, disposed: true }); },
  })),
  /probe|function/i
);

const unsupported = createUnsupportedProjectRootAuthorityBackend();
assert.strictEqual(
  unsupported.probe().state,
  PROJECT_ROOT_AUTHORITY_STATES.UNAVAILABLE
);
await assert.rejects(unsupported.acquire(request), /unavailable/i);
assert.deepStrictEqual(await unsupported.dispose(), { ok: true, disposed: true });

assert.throws(
  () => createProjectRootAuthorityAcquireRequest({
    leaseId: 'root-lease-a',
    binding: binding(),
    expectedPhysicalRootIdentityDigest: digest('b'),
    purpose: 'unknown',
  }),
  /purpose/i
);

assert.throws(
  () => createProjectRootAuthorityAcquireRequest({
    leaseId: 'root-lease-a',
    binding: binding(),
    expectedPhysicalRootIdentityDigest: digest('b'),
    purpose: 'project_scan',
    extra: true,
  }),
  /invalid/i
);

console.log('project-root-authority-contract.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
