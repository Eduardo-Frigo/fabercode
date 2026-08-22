'use strict';

const assert = require('assert');

const {
  ASSISTANT_EXECUTION_COORDINATOR_REASONS,
  createAssistantExecutionCoordinator,
} = require('../main/agent_runtime/assistant_execution_coordinator');
const {
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_READER_VERSION,
} = require('../main/capabilities/project_root_authority_contract');
const {
  createActionDigest,
} = require('../main/services/assistant_job_authority_service');

const digest = (character) => `sha256:${character.repeat(64)}`;

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createHarness({
  executeAction: executeOverride = null,
  refreshProjectFromRootLease: refreshOverride = null,
  releaseResult = null,
} = {}) {
  const events = [];
  const jobs = new Map();
  let jobSequence = 0;
  let rootActive = false;
  let coordinator;
  const physicalRootIdentityDigest = digest('b');
  const bindingFor = (jobId) => Object.freeze({
    projectId: 'project-a',
    canonicalRootPath: '/workspace/project-a',
    realRootPath: '/real/workspace/project-a',
    sessionId: 'session-a',
    jobId,
    kernelId: 'kernel-a',
    submissionDigest: digest('a'),
  });

  const rootReader = Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list() { return Object.freeze({ entries: Object.freeze([]), truncated: false }); },
    readFile() {
      return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
    },
  });
  let rootLease = null;

  const authorityService = Object.freeze({
    authorizeExecute({ binding, action }) {
      events.push('execute_authorize');
      return Object.freeze({
        authorized: true,
        binding,
        actionDigest: createActionDigest(action),
      });
    },
    authorizeProjectRootLease(binding) {
      events.push('root_authorize');
      return Object.freeze({
        authorized: true,
        binding,
        physicalRootIdentityDigest,
      });
    },
    authorizeRetry() { return Object.freeze({ authorized: false }); },
    beginSubmission() {
      return Object.freeze({
        ok: true,
        submissionId: 'submission-a',
        authorityContext: Object.freeze({
          schemaVersion: 'assistant-job-authority.v1',
          projectId: 'project-a',
          canonicalRootPath: '/workspace/project-a',
          realRootPath: '/real/workspace/project-a',
          sessionId: 'session-a',
          kernelId: 'kernel-a',
          submissionDigest: digest('a'),
          actionDigest: null,
        }),
      });
    },
    bindAction({ binding, action }) {
      return Object.freeze({
        authorized: true,
        binding,
        actionDigest: createActionDigest(action),
      });
    },
    bindJob({ jobId }) {
      return Object.freeze({ authorized: true, binding: bindingFor(jobId) });
    },
    clear() {
      events.push('authority_clear');
      return Object.freeze({ ok: true, cleared: true });
    },
    inspectRetryEligibility() { return Object.freeze({ eligible: false }); },
    revokeExact(binding) {
      events.push('authority_revoke');
      return Object.freeze({ ok: true, revoked: true, binding });
    },
    revokeSubmission() {
      return Object.freeze({ ok: true, revoked: true });
    },
  });

  const projectRootAuthority = Object.freeze({
    acquire({ binding, expectedPhysicalRootIdentityDigest, purpose }) {
      events.push('root_acquire');
      assert.strictEqual(expectedPhysicalRootIdentityDigest, physicalRootIdentityDigest);
      assert.strictEqual(purpose, 'execution');
      rootActive = true;
      rootLease = Object.freeze({
        version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
        leaseId: 'root-lease-a',
        jobId: binding.jobId,
        projectId: binding.projectId,
        purpose,
        physicalRootIdentityDigest,
        authorityDigest: digest('c'),
        reader: rootReader,
        close() { throw new Error('coordinator must release through the authority registry'); },
      });
      return Object.freeze({ ok: true, lease: rootLease, idempotent: false });
    },
    release({ binding, leaseId }) {
      events.push('root_release');
      assert.strictEqual(rootActive, true);
      assert.strictEqual(binding.jobId, rootLease.jobId);
      assert.strictEqual(leaseId, rootLease.leaseId);
      if (releaseResult) return releaseResult;
      rootActive = false;
      return Object.freeze({ ok: true, closed: true, idempotent: false });
    },
  });

  function createAuthorizedAssistantJob(input) {
    const job = {
      id: `job-${++jobSequence}`,
      status: 'running',
      phase: 'awaiting_user_confirmation',
      projectId: input.projectId,
      rootPath: input.rootPath,
      request: { userMessage: input.userMessage, attachments: input.attachments },
      retryState: { retryable: false },
      authorityContext: input.authorityContext,
    };
    jobs.set(job.id, job);
    return { ok: true, job };
  }

  function bindJobActionDigest(jobId, actionDigest) {
    const job = jobs.get(jobId);
    job.authorityContext = Object.freeze({ ...job.authorityContext, actionDigest });
    return { ok: true, job };
  }

  const refresh = refreshOverride || ((projectInfo, lease) => {
    events.push('scan');
    assert.strictEqual(rootActive, true);
    assert.strictEqual(lease, rootLease);
    return {
      ...projectInfo,
      totalFiles: 1,
      files: ['src/app.js'],
    };
  });
  const execute = executeOverride || (async (_action, projectInfo, context) => {
    events.push('execute');
    assert.strictEqual(rootActive, true);
    assert.strictEqual(projectInfo.totalFiles, 1);
    assert.deepStrictEqual(projectInfo.files, ['src/app.js']);
    assert.strictEqual(Object.keys(context).includes('projectRootLease'), false);
    assert.strictEqual(context.projectRootLease, rootLease);
    return { ok: true, modifiedFiles: ['src/app.js'] };
  });

  coordinator = createAssistantExecutionCoordinator({
    authorityService,
    projectRootAuthority,
    refreshProjectFromRootLease: refresh,
    createAuthorizedAssistantJob,
    bindJobActionDigest,
    bindActionToProject(action, projectInfo) {
      return { ...action, rootPath: projectInfo.rootPath };
    },
    createActionDigest,
    executeAction: execute,
    beforeAuthorityRelease() {
      events.push('release_barrier');
      assert.strictEqual(rootActive, true);
      return { ok: true };
    },
  });

  async function createReadyJob() {
    let jobId;
    const planned = await coordinator.coordinatePlanning({
      operation: 'plan',
      payload: {
        projectInfo: { id: 'project-a', rootPath: '/workspace/project-a', name: 'Project A' },
        userMessage: 'Implemente',
        attachments: [],
        approvalMode: 'ask_each',
      },
      kernelId: 'kernel-a',
      invoke: async () => {
        const created = coordinator.createPlanningJob({
          userMessage: 'pedido interno',
          attachments: [],
          mode: 'build',
        });
        assert.strictEqual(created.ok, true);
        jobId = created.job.id;
        return { ok: true, action: { type: 'write_files', files: [] } };
      },
    });
    assert.strictEqual(planned.ok, true);
    return jobId;
  }

  return {
    coordinator,
    createReadyJob,
    events,
    isRootActive: () => rootActive,
  };
}

async function run() {
  assert.throws(
    () => createAssistantExecutionCoordinator({
      authorityService: {},
      projectRootAuthority: {},
    }),
    /projectRootAuthority|authorityService/i
  );

  const basic = createHarness();
  const basicJobId = await basic.createReadyJob();
  const completed = await basic.coordinator.execute({ jobId: basicJobId });
  assert.deepStrictEqual(completed, { ok: true, modifiedFiles: ['src/app.js'] });
  assert.strictEqual(basic.isRootActive(), false);
  assert.deepStrictEqual(basic.events, [
    'execute_authorize',
    'root_authorize',
    'root_acquire',
    'scan',
    'execute',
    'release_barrier',
    'root_release',
    'authority_revoke',
  ]);

  const scanFailure = createHarness({
    refreshProjectFromRootLease() {
      scanFailure.events.push('scan');
      throw new Error('injected scan failure');
    },
  });
  const scanFailureJobId = await scanFailure.createReadyJob();
  const failedScan = await scanFailure.coordinator.execute({ jobId: scanFailureJobId });
  assert.strictEqual(
    failedScan.code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.PROJECT_ROOT_SCAN_FAILED
  );
  assert.strictEqual(scanFailure.isRootActive(), false);
  assert.deepStrictEqual(scanFailure.events.slice(-3), [
    'release_barrier',
    'root_release',
    'authority_revoke',
  ]);

  const gate = deferred();
  let pendingHarness;
  pendingHarness = createHarness({
    executeAction: async (_action, projectInfo, context) => {
      pendingHarness.events.push('execute');
      assert.strictEqual(projectInfo.totalFiles, 1);
      assert.ok(context.projectRootLease);
      return gate.promise;
    },
  });
  const pendingJobId = await pendingHarness.createReadyJob();
  const pendingExecution = pendingHarness.coordinator.execute({ jobId: pendingJobId });
  await Promise.resolve();
  assert.strictEqual(pendingHarness.isRootActive(), true);
  assert.deepStrictEqual(pendingHarness.coordinator.revokeJob({ jobId: pendingJobId }), {
    ok: true,
    revoked: false,
    deferred: true,
  });
  assert.strictEqual(
    pendingHarness.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING
  );
  assert.strictEqual(pendingHarness.isRootActive(), true);
  assert.strictEqual(pendingHarness.events.includes('authority_revoke'), false);
  gate.resolve({ ok: true, modifiedFiles: [] });
  assert.strictEqual(
    (await pendingExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED
  );
  assert.strictEqual(pendingHarness.isRootActive(), false);
  assert.deepStrictEqual(pendingHarness.events.slice(-3), [
    'release_barrier',
    'root_release',
    'authority_revoke',
  ]);

  const closeFailure = createHarness({
    releaseResult: Object.freeze({
      ok: false,
      code: 'PROJECT_ROOT_CLOSE_FAILED',
    }),
  });
  const closeFailureJobId = await closeFailure.createReadyJob();
  const failedClose = await closeFailure.coordinator.execute({ jobId: closeFailureJobId });
  assert.strictEqual(
    failedClose.code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED
  );
  assert.strictEqual(closeFailure.isRootActive(), true);
  assert.strictEqual(closeFailure.events.includes('authority_revoke'), false);
  assert.strictEqual(closeFailure.coordinator.diagnostics().authorityHealthy, false);

  console.log('assistant-execution-root-authority.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
