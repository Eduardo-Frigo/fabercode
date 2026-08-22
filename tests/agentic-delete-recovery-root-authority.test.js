'use strict';

const assert = require('assert');

const {
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_READER_VERSION,
  createProjectRootPhysicalIdentityDigest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  RECOVERY_ERROR_CODES,
  createAgenticDeleteRecoveryService,
} = require('../main/services/agentic_delete_recovery_service');

const digest = (character) => `sha256:${character.repeat(64)}`;

function bindingFor(serial = 'a') {
  return Object.freeze({
    projectId: `project-${serial}`,
    canonicalRootPath: `/workspace/project-${serial}`,
    realRootPath: `/real/workspace/project-${serial}`,
    sessionId: `session_${serial.repeat(32)}`,
    jobId: `job-recovery-root-${serial}`,
    kernelId: `kernel-${serial}`,
    submissionDigest: digest(serial),
  });
}

function terminalJob(binding) {
  return Object.freeze({
    id: binding.jobId,
    projectId: binding.projectId,
    rootPath: binding.canonicalRootPath,
    status: 'failed',
    phase: 'runtime_interrupted',
    authorityContextStatus: 'bound',
    authorityContext: Object.freeze({
      schemaVersion: 'assistant-job-authority.v1',
      projectId: binding.projectId,
      canonicalRootPath: binding.canonicalRootPath,
      realRootPath: binding.realRootPath,
      sessionId: binding.sessionId,
      kernelId: binding.kernelId,
      submissionDigest: binding.submissionDigest,
      actionDigest: digest('f'),
    }),
  });
}

function createHarness({
  serial = 'a',
  acquireResult = null,
  releaseResult = null,
  runtimeFailure = false,
} = {}) {
  const binding = bindingFor(serial);
  const job = terminalJob(binding);
  const identity = Object.freeze({
    device: '1',
    inode: serial,
    entryDevice: '1',
    entryInode: serial,
    entryType: 'directory',
  });
  const physicalRootIdentityDigest = createProjectRootPhysicalIdentityDigest(identity);
  const events = [];
  let rootActive = false;
  let rootLease = null;
  let capturedAuthority = null;

  const reader = Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list() { throw new Error('recovery pin must not read through the scanner API'); },
    readFile() { throw new Error('recovery pin must not read through the scanner API'); },
  });

  const projectRootAuthority = Object.freeze({
    acquire(input) {
      events.push('root_acquire');
      assert.deepStrictEqual(input.binding, binding);
      assert.strictEqual(input.expectedPhysicalRootIdentityDigest, physicalRootIdentityDigest);
      assert.strictEqual(input.purpose, 'recovery');
      if (acquireResult) return acquireResult;
      rootActive = true;
      rootLease = Object.freeze({
        version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
        leaseId: `root-recovery-lease-${serial}`,
        jobId: binding.jobId,
        projectId: binding.projectId,
        purpose: 'recovery',
        physicalRootIdentityDigest,
        authorityDigest: digest('c'),
        reader,
        close() { throw new Error('recovery must release through the authority registry'); },
      });
      return Object.freeze({ ok: true, lease: rootLease, idempotent: false });
    },
    release(input) {
      events.push('root_release');
      assert.strictEqual(rootActive, true);
      assert.deepStrictEqual(input.binding, binding);
      assert.strictEqual(input.leaseId, rootLease.leaseId);
      assert.ok(capturedAuthority);
      assert.strictEqual(
        capturedAuthority.authorizeLifecycle(binding).authorized,
        true,
        'recovery authority must remain active until the root is closed'
      );
      if (releaseResult) return releaseResult;
      rootActive = false;
      return Object.freeze({ ok: true, closed: true, idempotent: false });
    },
  });

  const service = createAgenticDeleteRecoveryService({
    getAuthorizedJobById(jobId) {
      return jobId === binding.jobId
        ? Object.freeze({ ok: true, job })
        : Object.freeze({ ok: false });
    },
    authorizeProjectBinding(projectId, rootPath) {
      return Object.freeze({
        ok: true,
        authorized: projectId === binding.projectId
          && rootPath === binding.canonicalRootPath,
        projectId: binding.projectId,
        rootPath: binding.canonicalRootPath,
        canonicalRootPath: binding.canonicalRootPath,
        realRootPath: binding.realRootPath,
        physicalRootIdentity: identity,
      });
    },
    projectRootAuthority,
    createTransactionalRuntime(authority) {
      capturedAuthority = authority;
      events.push('runtime_create');
      if (runtimeFailure) throw new Error('injected runtime failure');
      return Object.freeze({
        recoverProject() {
          events.push('recover');
          assert.strictEqual(rootActive, true);
          return Object.freeze({
            ok: true,
            recovered: 0,
            retainedCommitted: 1,
            retainedUnknown: 0,
          });
        },
        rollbackJob() {
          events.push('rollback');
          assert.strictEqual(rootActive, true);
          return Object.freeze({
            ok: true,
            purged: 0,
            rolledBack: 1,
            recoveryRequired: 0,
          });
        },
        finalizeJob() { throw new Error('failed recovery must roll back'); },
      });
    },
    audit() {
      events.push('audit');
      assert.ok(capturedAuthority || acquireResult);
      if (capturedAuthority) {
        assert.strictEqual(
          capturedAuthority.authorizeLifecycle(binding).authorized,
          false,
          'recovery authority must be revoked before audit'
        );
      }
      assert.strictEqual(rootActive, Boolean(releaseResult));
    },
  });

  return {
    binding,
    events,
    isRootActive: () => rootActive,
    service,
  };
}

assert.throws(
  () => createAgenticDeleteRecoveryService({
    getAuthorizedJobById() {},
    authorizeProjectBinding() {},
    createTransactionalRuntime() {},
    projectRootAuthority: { acquire() {}, release() {} },
  }),
  /projectRootAuthority|frozen/i
);

const success = createHarness();
const recovered = success.service.recoverJob({ jobId: success.binding.jobId });
assert.deepStrictEqual(recovered, {
  schemaVersion: 'agentic-delete-recovery-result.v1',
  ok: true,
  status: 'completed',
  disposition: 'rollback',
  errorCode: null,
  idempotent: false,
});
assert.strictEqual(success.isRootActive(), false);
assert.deepStrictEqual(success.events, [
  'root_acquire',
  'runtime_create',
  'recover',
  'rollback',
  'root_release',
  'audit',
]);
assert.deepStrictEqual(
  success.service.recoverJob({ jobId: success.binding.jobId }),
  { ...recovered, idempotent: true }
);
assert.deepStrictEqual(success.events, [
  'root_acquire',
  'runtime_create',
  'recover',
  'rollback',
  'root_release',
  'audit',
]);

const runtimeFailure = createHarness({ serial: 'b', runtimeFailure: true });
const failedRuntime = runtimeFailure.service.recoverJob({ jobId: runtimeFailure.binding.jobId });
assert.strictEqual(failedRuntime.errorCode, RECOVERY_ERROR_CODES.RUNTIME_INVALID);
assert.strictEqual(runtimeFailure.isRootActive(), false);
assert.deepStrictEqual(runtimeFailure.events, [
  'root_acquire',
  'runtime_create',
  'root_release',
  'audit',
]);

const acquireDenied = createHarness({
  serial: 'c',
  acquireResult: Object.freeze({
    ok: false,
    code: 'PROJECT_ROOT_AUTHORITY_UNAVAILABLE',
  }),
});
const deniedAcquire = acquireDenied.service.recoverJob({ jobId: acquireDenied.binding.jobId });
assert.strictEqual(
  deniedAcquire.errorCode,
  RECOVERY_ERROR_CODES.PROJECT_ROOT_AUTHORITY_FAILED
);
assert.strictEqual(acquireDenied.isRootActive(), false);
assert.deepStrictEqual(acquireDenied.events, ['root_acquire', 'audit']);

const closeFailure = createHarness({
  serial: 'd',
  releaseResult: Object.freeze({
    ok: false,
    code: 'PROJECT_ROOT_CLOSE_FAILED',
  }),
});
const failedClose = closeFailure.service.recoverJob({ jobId: closeFailure.binding.jobId });
assert.strictEqual(failedClose.ok, false);
assert.strictEqual(
  failedClose.errorCode,
  RECOVERY_ERROR_CODES.PROJECT_ROOT_CLEANUP_FAILED
);
assert.strictEqual(closeFailure.isRootActive(), true);
assert.strictEqual(closeFailure.service.diagnostics().authorityHealthy, false);
assert.deepStrictEqual(closeFailure.events.slice(-2), ['root_release', 'audit']);
assert.strictEqual(
  closeFailure.service.recoverJob({ jobId: 'job-recovery-root-e' }).errorCode,
  RECOVERY_ERROR_CODES.AUTHORITY_UNHEALTHY
);

console.log('agentic-delete-recovery-root-authority.test.js: ok');
