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
const {
  createAssistantRuntimeLifecycleClearService,
} = require('../main/services/assistant_runtime_lifecycle_clear_service');

const digest = (character) => `sha256:${character.repeat(64)}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitForEvent(events, expected) {
  for (let attempt = 0; attempt < 20 && !events.includes(expected); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(events.includes(expected), `timed out waiting for ${expected}`);
}

function createHarness({
  acquireGate = null,
  executeAction: executeOverride = null,
  onCancellationRequested = undefined,
  onExecutionCleanupConfirmed = undefined,
  onExecutionCleanupFailed = undefined,
  refreshProjectFromRootLease: refreshOverride = null,
  releaseGate = null,
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
    async inspectEntry() {
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
      return Object.freeze({ entries: Object.freeze([]), truncated: false });
    },
    async readFile() {
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
    restorePendingApproval() {
      return Object.freeze({ authorized: false });
    },
  });

  const projectRootAuthority = Object.freeze({
    async acquire({ binding, expectedPhysicalRootIdentityDigest, purpose }) {
      events.push('root_acquire');
      assert.strictEqual(expectedPhysicalRootIdentityDigest, physicalRootIdentityDigest);
      assert.strictEqual(purpose, 'execution');
      if (acquireGate) await acquireGate.promise;
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
        async close() { throw new Error('coordinator must release through the authority registry'); },
      });
      return Object.freeze({ ok: true, lease: rootLease, idempotent: false });
    },
    async release({ binding, leaseId }) {
      events.push('root_release');
      assert.strictEqual(rootActive, true);
      assert.strictEqual(binding.jobId, rootLease.jobId);
      assert.strictEqual(leaseId, rootLease.leaseId);
      if (releaseGate) await releaseGate.promise;
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

  const refresh = refreshOverride || (async (projectInfo, lease) => {
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
    persistPendingApprovalRecovery() {
      return { ok: true };
    },
    getAuthorizedJobById(jobId) {
      return jobs.has(jobId)
        ? { ok: true, job: jobs.get(jobId) }
        : { ok: false, code: 'job_not_found' };
    },
    restoreAuthorizedProject(binding) {
      return binding.projectId === 'project-a'
        && binding.canonicalRootPath === '/workspace/project-a'
        ? { ok: true, projectInfo: { id: 'project-a', rootPath: '/workspace/project-a' } }
        : { ok: false };
    },
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
    onCancellationRequested,
    onExecutionCleanupConfirmed,
    onExecutionCleanupFailed,
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
    async refreshProjectFromRootLease() {
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

  const acquireGate = deferred();
  const pendingAcquire = createHarness({ acquireGate });
  const pendingAcquireJobId = await pendingAcquire.createReadyJob();
  const acquireExecution = pendingAcquire.coordinator.execute({ jobId: pendingAcquireJobId });
  await waitForEvent(pendingAcquire.events, 'root_acquire');
  assert.strictEqual(pendingAcquire.isRootActive(), false);
  assert.deepStrictEqual(pendingAcquire.coordinator.revokeJob({ jobId: pendingAcquireJobId }), {
    ok: true,
    revoked: false,
    deferred: true,
  });
  assert.strictEqual(
    pendingAcquire.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING
  );
  acquireGate.resolve();
  assert.strictEqual(
    (await acquireExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED
  );
  assert.strictEqual(pendingAcquire.isRootActive(), false);
  assert.deepStrictEqual(pendingAcquire.events.slice(-3), [
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

  const releaseGate = deferred();
  const pendingRelease = createHarness({ releaseGate });
  const pendingReleaseJobId = await pendingRelease.createReadyJob();
  const releaseExecution = pendingRelease.coordinator.execute({ jobId: pendingReleaseJobId });
  await waitForEvent(pendingRelease.events, 'root_release');
  assert.strictEqual(pendingRelease.isRootActive(), true);
  assert.deepStrictEqual(pendingRelease.coordinator.revokeJob({ jobId: pendingReleaseJobId }), {
    ok: true,
    revoked: false,
    deferred: true,
  });
  assert.strictEqual(
    pendingRelease.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING
  );
  assert.strictEqual(pendingRelease.events.includes('authority_revoke'), false);
  releaseGate.resolve();
  assert.strictEqual(
    (await releaseExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED
  );
  assert.strictEqual(pendingRelease.isRootActive(), false);
  assert.deepStrictEqual(pendingRelease.events.slice(-2), [
    'root_release',
    'authority_revoke',
  ]);

  const lifecycleReleaseGate = deferred();
  const cleanupProofs = [];
  const cleanupReceipts = [];
  const cancellationWrites = [];
  const continuationResults = [];
  const continuationErrors = [];
  let lifecycle = null;
  const rootLifecycle = createHarness({
    releaseGate: lifecycleReleaseGate,
    onCancellationRequested(jobId, reason) {
      const result = lifecycle.requestCancellation(jobId, reason);
      return { ok: result.ok };
    },
    onExecutionCleanupConfirmed(proof) {
      cleanupProofs.push(proof);
      const result = lifecycle.confirmExecutionCleanup(proof);
      return { ok: result.ok };
    },
    onExecutionCleanupFailed(failure) {
      const result = lifecycle.failExecutionCleanup(failure);
      return { ok: result.ok };
    },
  });
  lifecycle = createAssistantRuntimeLifecycleClearService({
    invalidateWindow() {
      return { ok: true };
    },
    clearPeripheralAuthority() {
      return { ok: true };
    },
    clearCoordinator() {
      return rootLifecycle.coordinator.clear();
    },
    clearDeleteRuntime() {
      return { ok: true };
    },
    markCancellationRequested(jobId, reason) {
      cancellationWrites.push({ jobId, reason });
      return { ok: true };
    },
    markCancelledAfterCleanup(jobId, receipt) {
      cleanupReceipts.push({ jobId, receipt });
      return { ok: true };
    },
    markExecutionCleanupFailed() {
      return { ok: true };
    },
    scheduleContinuation(continuation) {
      setImmediate(() => {
        try {
          continuationResults.push(continuation());
        } catch (error) {
          continuationErrors.push(error);
        }
      });
    },
  });
  const rootLifecycleJobId = await rootLifecycle.createReadyJob();
  const rootLifecycleExecution = rootLifecycle.coordinator.execute({
    jobId: rootLifecycleJobId,
  });
  await waitForEvent(rootLifecycle.events, 'root_release');
  const lifecycleClear = lifecycle.clear('window_reload');
  assert.strictEqual(lifecycleClear.ok, true);
  assert.strictEqual(lifecycleClear.status, 'deferred');
  assert.strictEqual(lifecycleClear.code, 'execution_draining');
  assert.deepStrictEqual(cancellationWrites, []);

  lifecycleReleaseGate.resolve();
  assert.strictEqual(
    (await rootLifecycleExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  for (let attempt = 0;
    attempt < 50 && (lifecycle.diagnostics().active
      || rootLifecycle.coordinator.diagnostics().activeJobs > 0);
    attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (continuationErrors.length > 0) throw continuationErrors[0];
  assert.strictEqual(cleanupProofs.length, 1);
  assert.strictEqual(cleanupProofs[0].terminalStatus, 'completed');
  assert.strictEqual(cleanupProofs[0].rootReleased, true);
  assert.deepStrictEqual(cleanupReceipts, []);
  assert.deepStrictEqual(cancellationWrites, []);
  assert.strictEqual(continuationResults.length, 1);
  assert.strictEqual(continuationResults[0].status, 'completed');
  assert.strictEqual(lifecycle.diagnostics().active, false);
  assert.strictEqual(lifecycle.diagnostics().drainOnlyOutcomes, 1);
  assert.strictEqual(lifecycle.diagnostics().completedSessions, 1);
  assert.strictEqual(rootLifecycle.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(rootLifecycle.coordinator.diagnostics().authorityHealthy, true);
  assert.strictEqual(rootLifecycle.isRootActive(), false);

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
