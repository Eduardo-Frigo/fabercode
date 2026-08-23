'use strict';

const assert = require('assert');

const {
  EXECUTION_WORKSPACE_REGISTRY_VERSION,
} = require('../main/capabilities/execution_workspace_registry');
const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_READER_VERSION,
  createProjectRootAuthorityAcquireRequest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  createProcessSupervisorProbeResult,
} = require('../main/capabilities/process_supervisor_contract');
const {
  EXECUTION_ISOLATION_JOB_SESSION_DISPOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_REASONS,
  EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_VERSION,
  createExecutionIsolationJobSessionService,
} = require('../main/services/execution_isolation_job_session_service');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding(jobId = 'job-a', projectId = 'project-a') {
  return Object.freeze({
    projectId,
    canonicalRootPath: `/workspace/source-${projectId}`,
    realRootPath: `/private/workspace/source-${projectId}`,
    sessionId: 'session-a',
    jobId,
    kernelId: 'legacy',
    submissionDigest: digest('a'),
  });
}

function reader() {
  return Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list() { return Promise.resolve(Object.freeze({ entries: [], truncated: false })); },
    readFile() {
      return Promise.resolve(Object.freeze({
        found: false,
        contentBase64: null,
        contentDigest: null,
      }));
    },
    inspectEntry() {
      return Promise.resolve(Object.freeze({
        found: false,
        kind: null,
        bytes: null,
        mode: null,
        mtimeMs: null,
        contentDigest: null,
        linkTarget: null,
        entryIdentityDigest: null,
      }));
    },
  });
}

function dependencyHarness({
  processAvailable = true,
  rootDenied = false,
  workspaceDenied = false,
  rootReleaseFails = false,
  workspaceRollbackFails = false,
} = {}) {
  const state = {
    events: [],
    rootAcquires: 0,
    rootReleases: 0,
    workspaceAcquires: 0,
    workspaceRollbacks: 0,
    processProbes: 0,
  };
  const rootLeases = new Map();
  const workspaceLeases = new Map();

  const executionWorkspaceRegistry = Object.freeze({
    version: EXECUTION_WORKSPACE_REGISTRY_VERSION,
    acquire(input) {
      state.events.push(`workspace:acquire:${input.binding.jobId}`);
      state.workspaceAcquires += 1;
      if (workspaceDenied) {
        return Promise.resolve(Object.freeze({
          ok: false,
          code: 'WORKSPACE_UNAVAILABLE',
        }));
      }
      const request = createExecutionWorkspaceAcquireRequest({
        leaseId: `workspace-${input.binding.jobId}`,
        binding: input.binding,
        sourceRootIdentityDigest: input.sourceRootIdentityDigest,
      });
      const lease = createExecutionWorkspaceLease({
        request,
        workspaceRootPath: `/workspace/faber-jobs/${input.binding.jobId}`,
        workspaceRealRootPath: `/private/workspace/faber-jobs/${input.binding.jobId}`,
        workspaceRootIdentityDigest: digest(input.binding.jobId === 'job-a' ? 'c' : 'd'),
      });
      workspaceLeases.set(input.binding.jobId, lease);
      return Promise.resolve(Object.freeze({ ok: true, lease, idempotent: false }));
    },
    rollback(input) {
      state.events.push(`workspace:rollback:${input.binding.jobId}`);
      state.workspaceRollbacks += 1;
      if (workspaceRollbackFails) {
        return Promise.resolve(Object.freeze({
          ok: false,
          code: 'WORKSPACE_ROLLBACK_FAILED',
        }));
      }
      workspaceLeases.delete(input.binding.jobId);
      return Promise.resolve(Object.freeze({
        ok: true,
        rolledBack: true,
        idempotent: false,
      }));
    },
    diagnostics() {
      return Object.freeze({
        version: EXECUTION_WORKSPACE_REGISTRY_VERSION,
        active: workspaceLeases.size,
      });
    },
    dispose() {
      return Promise.resolve(Object.freeze({ ok: true, disposed: true, quarantined: 0 }));
    },
  });

  const projectRootAuthorityRegistry = Object.freeze({
    acquire(input) {
      state.events.push(`root:acquire:${input.binding.jobId}`);
      state.rootAcquires += 1;
      if (rootDenied) {
        return Promise.resolve(Object.freeze({
          ok: false,
          code: 'PROJECT_ROOT_AUTHORITY_UNAVAILABLE',
        }));
      }
      const request = createProjectRootAuthorityAcquireRequest({
        leaseId: `root-${input.binding.jobId}`,
        binding: input.binding,
        expectedPhysicalRootIdentityDigest: input.expectedPhysicalRootIdentityDigest,
        purpose: input.purpose,
      });
      const lease = Object.freeze({
        version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
        leaseId: request.leaseId,
        jobId: request.binding.jobId,
        projectId: request.binding.projectId,
        purpose: request.purpose,
        physicalRootIdentityDigest: request.expectedPhysicalRootIdentityDigest,
        authorityDigest: request.authorityDigest,
        reader: reader(),
        close() { return Promise.resolve(Object.freeze({ closed: true })); },
      });
      rootLeases.set(input.binding.jobId, lease);
      return Promise.resolve(Object.freeze({ ok: true, lease, idempotent: false }));
    },
    diagnostics() {
      return Object.freeze({ active: rootLeases.size });
    },
    dispose() {
      return Promise.resolve(Object.freeze({ ok: true, disposed: true, quarantined: 0 }));
    },
    release(input) {
      state.events.push(`root:release:${input.binding.jobId}`);
      state.rootReleases += 1;
      if (rootReleaseFails) {
        return Promise.resolve(Object.freeze({
          ok: false,
          code: 'PROJECT_ROOT_CLOSE_FAILED',
        }));
      }
      rootLeases.delete(input.binding.jobId);
      return Promise.resolve(Object.freeze({
        ok: true,
        closed: true,
        idempotent: false,
      }));
    },
  });

  const processProbe = createProcessSupervisorProbeResult({
    state: processAvailable
      ? PROCESS_SUPERVISOR_STATES.ENFORCED
      : PROCESS_SUPERVISOR_STATES.UNAVAILABLE,
    guarantees: processAvailable ? PROCESS_SUPERVISOR_REQUIRED_GUARANTEES : [],
    ...(processAvailable ? {} : { reasonCode: 'PROCESS_PROVIDER_UNAVAILABLE' }),
  });
  const processSupervisor = Object.freeze({
    version: 'process-supervisor.v1',
    probe() {
      state.events.push('process:probe');
      state.processProbes += 1;
      return Promise.resolve(processProbe);
    },
    exec() { throw new Error('job sessions do not execute processes yet'); },
    read() { throw new Error('job sessions do not read processes yet'); },
    wait() { throw new Error('job sessions do not wait for processes yet'); },
    stop() { throw new Error('job sessions do not stop processes yet'); },
    diagnostics() {
      return Object.freeze({
        version: 'process-supervisor.v1',
        backendState: processProbe.state,
      });
    },
    dispose() {
      return Promise.resolve(Object.freeze({
        ok: true,
        disposed: true,
        quarantined: 0,
        orphaned: 0,
      }));
    },
  });

  return Object.freeze({
    state,
    executionWorkspaceRegistry,
    projectRootAuthorityRegistry,
    processSupervisor,
  });
}

function createService(harness, overrides = {}) {
  return createExecutionIsolationJobSessionService({
    executionWorkspaceRegistry: harness.executionWorkspaceRegistry,
    projectRootAuthorityRegistry: harness.projectRootAuthorityRegistry,
    processSupervisor: harness.processSupervisor,
    ...overrides,
  });
}

async function main() {
  const successHarness = dependencyHarness();
  const service = createService(successHarness);
  assert.strictEqual(Object.isFrozen(service), true);
  assert.strictEqual(service.version, EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION);
  assert.deepStrictEqual(Reflect.ownKeys(service), [
    'version',
    'open',
    'close',
    'diagnostics',
    'dispose',
  ]);

  const openInput = Object.freeze({
    binding: binding(),
    sourceRootIdentityDigest: digest('b'),
  });
  const opened = await service.open(openInput);
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(opened.idempotent, false);
  assert.strictEqual(Object.isFrozen(opened.session), true);
  assert.strictEqual(opened.session.version, EXECUTION_ISOLATION_JOB_SESSION_VERSION);
  assert.deepStrictEqual(Reflect.ownKeys(opened.session), [
    'version',
    'jobId',
    'projectId',
    'diagnostics',
    'close',
  ]);
  assert.strictEqual(
    JSON.stringify(opened.session).includes('/workspace/'),
    false,
    'session facade must not disclose source or private workspace paths'
  );
  assert.deepStrictEqual(successHarness.state.events, [
    'process:probe',
    'root:acquire:job-a',
    'workspace:acquire:job-a',
  ]);

  const reopened = await service.open(openInput);
  assert.strictEqual(reopened.ok, true);
  assert.strictEqual(reopened.idempotent, true);
  assert.strictEqual(reopened.session, opened.session);
  assert.strictEqual(successHarness.state.processProbes, 1);
  assert.strictEqual(service.diagnostics().active, 1);

  const closeReceipt = await opened.session.close();
  assert.deepStrictEqual(closeReceipt, {
    ok: true,
    closed: true,
    workspaceRolledBack: true,
    rootReleased: true,
  });
  assert.strictEqual(await opened.session.close(), closeReceipt);
  assert.deepStrictEqual(successHarness.state.events.slice(-2), [
    'workspace:rollback:job-a',
    'root:release:job-a',
  ]);
  assert.strictEqual(service.diagnostics().active, 0);
  assert.strictEqual(service.diagnostics().closed, 1);
  assert.strictEqual(
    (await service.open(openInput)).code,
    EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_CLOSED
  );
  assert.deepStrictEqual(await service.dispose(), {
    version: EXECUTION_ISOLATION_JOB_SESSION_DISPOSE_RECEIPT_VERSION,
    ok: true,
    disposed: true,
    active: 0,
    closed: 1,
    quarantined: 0,
  });

  const closeDuringOpenHarness = dependencyHarness();
  const closeDuringOpenService = createService(closeDuringOpenHarness);
  const closeDuringOpenPromise = closeDuringOpenService.open(openInput);
  const racingClosePromise = closeDuringOpenService.close(Object.freeze({
    binding: openInput.binding,
  }));
  assert.deepStrictEqual(await closeDuringOpenPromise, {
    ok: false,
    code: EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_CLOSED,
  });
  assert.deepStrictEqual(await racingClosePromise, {
    ok: true,
    closed: true,
    workspaceRolledBack: true,
    rootReleased: true,
  });
  assert.deepStrictEqual(await closeDuringOpenService.open(openInput), {
    ok: false,
    code: EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_CLOSED,
  });
  assert.strictEqual(closeDuringOpenService.diagnostics().active, 0);
  assert.strictEqual((await closeDuringOpenService.dispose()).ok, true);

  const workspaceFailureHarness = dependencyHarness({ workspaceDenied: true });
  const workspaceFailureService = createService(workspaceFailureHarness);
  const workspaceFailure = await workspaceFailureService.open(openInput);
  assert.deepStrictEqual(workspaceFailure, {
    ok: false,
    code: EXECUTION_ISOLATION_JOB_SESSION_REASONS.WORKSPACE_ACQUIRE_FAILED,
  });
  assert.deepStrictEqual(workspaceFailureHarness.state.events, [
    'process:probe',
    'root:acquire:job-a',
    'workspace:acquire:job-a',
    'root:release:job-a',
  ]);
  await workspaceFailureService.dispose();

  const rootFailureHarness = dependencyHarness({ rootDenied: true });
  const rootFailure = await createService(rootFailureHarness).open(openInput);
  assert.strictEqual(
    rootFailure.code,
    EXECUTION_ISOLATION_JOB_SESSION_REASONS.ROOT_ACQUIRE_FAILED
  );
  assert.deepStrictEqual(rootFailureHarness.state.events, [
    'process:probe',
    'root:acquire:job-a',
  ]);

  const unavailableHarness = dependencyHarness({ processAvailable: false });
  const unavailable = await createService(unavailableHarness).open(openInput);
  assert.strictEqual(
    unavailable.code,
    EXECUTION_ISOLATION_JOB_SESSION_REASONS.PROCESS_UNAVAILABLE
  );
  assert.deepStrictEqual(unavailableHarness.state.events, ['process:probe']);

  const cleanupFailureHarness = dependencyHarness({
    workspaceRollbackFails: true,
  });
  const cleanupFailureService = createService(cleanupFailureHarness);
  const cleanupOpened = await cleanupFailureService.open(openInput);
  assert.strictEqual(cleanupOpened.ok, true);
  const cleanupReceipt = await cleanupOpened.session.close();
  assert.strictEqual(cleanupReceipt.ok, false);
  assert.strictEqual(cleanupFailureService.diagnostics().quarantined, 1);
  assert.strictEqual((await cleanupFailureService.dispose()).ok, false);

  const rootCleanupFailureHarness = dependencyHarness({ rootReleaseFails: true });
  const rootCleanupFailureService = createService(rootCleanupFailureHarness);
  const rootCleanupOpened = await rootCleanupFailureService.open(openInput);
  assert.strictEqual(rootCleanupOpened.ok, true);
  assert.deepStrictEqual(await rootCleanupOpened.session.close(), {
    ok: false,
    closed: false,
    workspaceRolledBack: true,
    rootReleased: false,
  });
  assert.strictEqual(rootCleanupFailureService.diagnostics().quarantined, 1);
  assert.strictEqual((await rootCleanupFailureService.dispose()).ok, false);

  const drainingHarness = dependencyHarness();
  const drainingService = createService(drainingHarness, { maxActiveSessions: 2 });
  const firstOpen = await drainingService.open(openInput);
  const secondOpen = await drainingService.open(Object.freeze({
    binding: binding('job-b', 'project-b'),
    sourceRootIdentityDigest: digest('e'),
  }));
  assert.strictEqual(firstOpen.ok, true);
  assert.strictEqual(secondOpen.ok, true);
  assert.strictEqual((await drainingService.open(Object.freeze({
    binding: binding('job-a', 'project-mismatch'),
    sourceRootIdentityDigest: digest('b'),
  }))).code, EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_MISMATCH);
  assert.strictEqual((await drainingService.open(Object.freeze({
    binding: binding('job-c', 'project-c'),
    sourceRootIdentityDigest: digest('f'),
  }))).code, EXECUTION_ISOLATION_JOB_SESSION_REASONS.CAPACITY_EXCEEDED);
  const drainingReceipt = await drainingService.dispose();
  assert.strictEqual(drainingReceipt.ok, true);
  assert.strictEqual(drainingReceipt.active, 0);
  assert.strictEqual(drainingReceipt.closed, 2);
  assert.strictEqual(drainingHarness.state.workspaceRollbacks, 2);
  assert.strictEqual(drainingHarness.state.rootReleases, 2);

  assert.deepStrictEqual(await service.close({ binding: binding('missing-job') }), {
    ok: false,
    code: EXECUTION_ISOLATION_JOB_SESSION_REASONS.SESSION_NOT_FOUND,
  });
  assert.deepStrictEqual(await service.open({}), {
    ok: false,
    code: EXECUTION_ISOLATION_JOB_SESSION_REASONS.INVALID_INPUT,
  });
  assert.throws(
    () => createService(dependencyHarness(), { ambientAuthority: true }),
    /options/i
  );

  assert.strictEqual(PROCESS_SUPERVISOR_BACKEND_VERSION, 'process-supervisor-backend.v1');
  console.log('execution isolation job session service tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
