'use strict';

const assert = require('assert');

const {
  ASSISTANT_EXECUTION_COORDINATOR_REASONS,
  createAssistantExecutionCoordinator,
} = require('../main/agent_runtime/assistant_execution_coordinator');
const {
  createActionDigest,
  createAssistantJobAuthorityService,
} = require('../main/services/assistant_job_authority_service');
const {
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
} = require('../main/services/execution_isolation_authorized_job_executor');
const {
  createAssistantRuntimeLifecycleClearService,
} = require('../main/services/assistant_runtime_lifecycle_clear_service');

const PROJECT_ID = 'project-lifecycle-integration';
const PROJECT_ROOT = '/workspace/lifecycle-integration';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function sequenceFactory(prefix) {
  let sequence = 0;
  return () => prefix + '_' + String(++sequence).padStart(24, '0');
}

function project() {
  return {
    id: PROJECT_ID,
    name: 'Lifecycle integration',
    rootPath: PROJECT_ROOT,
  };
}

async function waitUntil(harness, predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (harness.continuationErrors.length > 0) {
      throw harness.continuationErrors[0];
    }
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(message);
}

function validCloseReceipt() {
  return Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
    ok: true,
    closed: true,
    sessionClosed: false,
  });
}

function createIntegratedHarness() {
  const jobs = new Map();
  const actionStarted = deferred();
  const actionGate = deferred();
  const closeStarted = deferred();
  const closeGate = deferred();
  const events = [];
  const cancellationCallbacks = [];
  const cancellationWrites = [];
  const cleanupFailureWrites = [];
  const cleanupProofs = [];
  const cleanupReceipts = [];
  const scheduledContinuations = [];
  const continuationResults = [];
  const continuationErrors = [];
  let closeCalls = 0;
  let jobSequence = 0;
  let coordinator;
  let lifecycle;

  const baseAuthorityService = createAssistantJobAuthorityService({
    authorizeProjectBinding(projectId, rootPath) {
      if (projectId !== PROJECT_ID || rootPath !== PROJECT_ROOT) {
        return { authorized: false };
      }
      return {
        authorized: true,
        projectId,
        canonicalRootPath: rootPath,
        realRootPath: '/real' + rootPath,
        physicalRootIdentity: {
          device: '1',
          inode: '1',
          entryDevice: '1',
          entryInode: '1',
          entryType: 'directory',
        },
        authorizedContext: { source: 'lifecycle-integration-test' },
      };
    },
    getJobById(jobId) {
      return jobs.has(jobId)
        ? { ok: true, job: jobs.get(jobId) }
        : { ok: false, code: 'job_not_found' };
    },
    now: (() => {
      let timestamp = 10_000;
      return () => ++timestamp;
    })(),
    sessionIdFactory: sequenceFactory('session'),
    submissionIdFactory: sequenceFactory('submission'),
    maxActiveSubmissions: 8,
    maxActiveSessions: 8,
  });

  const authorityService = {
    ...baseAuthorityService,
    clear() {
      events.push('authority_cleared');
      return baseAuthorityService.clear();
    },
    revokeExact(binding) {
      events.push('job_authority_revoked');
      return baseAuthorityService.revokeExact(binding);
    },
  };

  coordinator = createAssistantExecutionCoordinator({
    authorityService,
    createAuthorizedAssistantJob(input) {
      const id = 'job-' + String(++jobSequence);
      const job = {
        id,
        status: 'running',
        phase: 'persona_plan',
        projectId: input.projectId,
        rootPath: input.rootPath,
        mode: input.mode,
        request: {
          userMessage: input.userMessage,
          attachments: input.attachments,
        },
        retryState: { retryable: true },
        authorityContext: input.authorityContext,
      };
      jobs.set(id, job);
      return { ok: true, job };
    },
    bindJobActionDigest(jobId, actionDigest) {
      const job = jobs.get(jobId);
      if (!job) return { ok: false, code: 'job_not_found' };
      job.authorityContext = { ...job.authorityContext, actionDigest };
      return { ok: true, job };
    },
    persistPendingApprovalRecovery(jobId, recovery) {
      const job = jobs.get(jobId);
      if (!job) return { ok: false, code: 'job_not_found' };
      job.pendingApprovalRecovery = recovery;
      return { ok: true, job };
    },
    getAuthorizedJobById(jobId) {
      return jobs.has(jobId)
        ? { ok: true, job: jobs.get(jobId) }
        : { ok: false, code: 'job_not_found' };
    },
    bindActionToProject(action, projectInfo) {
      return { ...action, rootPath: projectInfo.rootPath };
    },
    createActionDigest,
    restoreAuthorizedProject(binding) {
      return binding.projectId === PROJECT_ID
        && binding.canonicalRootPath === PROJECT_ROOT
        ? { ok: true, projectInfo: project() }
        : { ok: false, code: 'project_not_authorized' };
    },
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() { return Promise.reject(new Error('not exercised')); },
        read() { return Promise.reject(new Error('not exercised')); },
        wait() { return Promise.reject(new Error('not exercised')); },
        stop() { return Promise.reject(new Error('not exercised')); },
        close() {
          closeCalls += 1;
          events.push('executor_close_started');
          closeStarted.resolve();
          return closeGate.promise.then((receipt) => {
            events.push('executor_close_confirmed');
            return receipt;
          });
        },
        diagnostics() { return Object.freeze({ state: 'active' }); },
      });
    },
    async executeAction(_action, _projectInfo, context) {
      events.push('action_started');
      actionStarted.resolve(context.signal);
      await actionGate.promise;
      events.push('action_unwound');
      return { ok: true, stale: true };
    },
    beforeAuthorityRelease(input) {
      events.push('release_barrier:' + input.terminalStatus);
      return { ok: true };
    },
    onCancellationRequested(jobId, reason) {
      cancellationCallbacks.push({ jobId, reason });
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
    invalidateWindow(reason) {
      events.push('window_invalidated:' + reason);
      return { ok: true };
    },
    clearPeripheralAuthority(reason) {
      events.push('peripheral_cleared:' + reason);
      return { ok: true };
    },
    clearCoordinator() {
      events.push('coordinator_clear_requested');
      return coordinator.clear();
    },
    clearDeleteRuntime() {
      events.push('delete_runtime_cleared');
      return { ok: true };
    },
    markCancellationRequested(jobId, reason) {
      cancellationWrites.push({ jobId, reason });
      events.push('cancellation_persisted');
      return { ok: true };
    },
    markCancelledAfterCleanup(jobId, receipt) {
      cleanupReceipts.push({ jobId, receipt });
      events.push('cleanup_receipt_persisted');
      return { ok: true };
    },
    markExecutionCleanupFailed(jobId, reason) {
      cleanupFailureWrites.push({ jobId, reason });
      return { ok: true };
    },
    scheduleContinuation(continuation) {
      scheduledContinuations.push(continuation);
      events.push('continuation_scheduled');
      setImmediate(() => {
        try {
          events.push('continuation_started');
          continuationResults.push(continuation());
        } catch (error) {
          continuationErrors.push(error);
        }
      });
    },
  });

  return {
    actionGate,
    actionStarted,
    authorityService,
    cancellationCallbacks,
    cancellationWrites,
    cleanupFailureWrites,
    cleanupProofs,
    cleanupReceipts,
    closeGate,
    closeStarted,
    continuationErrors,
    continuationResults,
    coordinator,
    events,
    get closeCalls() { return closeCalls; },
    jobs,
    lifecycle,
    scheduledContinuations,
  };
}

async function createReadyJob(harness, suffix) {
  let jobId = null;
  const result = await harness.coordinator.coordinatePlanning({
    operation: 'plan',
    payload: {
      projectInfo: project(),
      userMessage: 'Execute lifecycle integration ' + suffix,
      attachments: [],
      approvalMode: 'ask_each',
    },
    kernelId: 'kernel-lifecycle-integration',
    invoke: async () => {
      const created = harness.coordinator.createPlanningJob({
        userMessage: 'Internal lifecycle request ' + suffix,
        attachments: [],
        mode: 'build',
      });
      assert.strictEqual(created.ok, true);
      jobId = created.job.id;
      harness.jobs.get(jobId).phase = 'awaiting_user_confirmation';
      return {
        ok: true,
        action: { type: 'write_files', files: [] },
      };
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.jobId, jobId);
  return jobId;
}

function assertHealthyAuthority(harness) {
  const coordinator = harness.coordinator.diagnostics();
  const lifecycle = harness.lifecycle.diagnostics();
  const authority = harness.authorityService.diagnostics();
  assert.strictEqual(coordinator.activeJobs, 0);
  assert.strictEqual(coordinator.authorityHealthy, true);
  assert.strictEqual(coordinator.clearPending, false);
  assert.strictEqual(lifecycle.active, false);
  assert.strictEqual(lifecycle.failedJobs, 0);
  assert.strictEqual(lifecycle.unresolvedCleanupFailures, 0);
  assert.strictEqual(authority.activeSubmissions, 0);
  assert.strictEqual(authority.activeSessions, 0);
}

async function testCancelledExecutorPersistsOneReceiptAfterAsyncContinuation() {
  const harness = createIntegratedHarness();
  const jobId = await createReadyJob(harness, 'cancelled');
  const execution = harness.coordinator.execute({ jobId });
  const signal = await harness.actionStarted.promise;

  const clearing = harness.lifecycle.clear('window_reload');
  assert.strictEqual(clearing.ok, true);
  assert.strictEqual(clearing.status, 'deferred');
  assert.strictEqual(clearing.code, 'execution_draining');
  assert.strictEqual(signal.aborted, true);
  await harness.closeStarted.promise;
  assert.strictEqual(harness.closeCalls, 1);
  assert.deepStrictEqual(harness.cancellationCallbacks, [{
    jobId,
    reason: ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  }]);
  assert.deepStrictEqual(harness.cancellationWrites, [{
    jobId,
    reason: 'window_reload',
  }]);

  harness.closeGate.resolve(validCloseReceipt());
  await waitUntil(
    harness,
    () => harness.lifecycle.diagnostics().active === false
      && harness.coordinator.diagnostics().activeJobs === 0,
    'cancelled lifecycle clear did not finish',
  );

  assert.strictEqual(harness.scheduledContinuations.length, 1);
  assert.strictEqual(harness.continuationResults.length, 1);
  assert.strictEqual(harness.continuationResults[0].status, 'completed');
  assert.strictEqual(harness.cleanupProofs.length, 1);
  assert.strictEqual(harness.cleanupProofs[0].terminalStatus, 'cancelled');
  assert.deepStrictEqual(harness.cleanupReceipts, [{
    jobId,
    receipt: Object.freeze({
      schemaVersion: 'assistant-job-execution-cleanup-receipt.v1',
      jobId,
      cleanupCompleted: true,
    }),
  }]);
  assert.deepStrictEqual(harness.cleanupFailureWrites, []);
  assert.strictEqual(harness.lifecycle.diagnostics().completedSessions, 1);
  assert.ok(
    harness.events.indexOf('continuation_scheduled')
      < harness.events.indexOf('continuation_started'),
  );
  assertHealthyAuthority(harness);

  harness.actionGate.resolve();
  const result = await execution;
  assert.strictEqual(result.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
  assertHealthyAuthority(harness);
}

async function testCompletedExecutorDrainsWithoutCancellationOrReceipt() {
  const harness = createIntegratedHarness();
  const jobId = await createReadyJob(harness, 'completed');
  const execution = harness.coordinator.execute({ jobId });
  const signal = await harness.actionStarted.promise;

  assert.deepStrictEqual(
    harness.coordinator.onJobTerminal({ jobId, status: 'completed' }),
    { ok: true, revoked: false, deferred: true, idempotent: false },
  );
  assert.strictEqual(signal.aborted, true);
  await harness.closeStarted.promise;
  const clearing = harness.lifecycle.clear('window_reload');
  assert.strictEqual(clearing.ok, true);
  assert.strictEqual(clearing.status, 'deferred');
  assert.strictEqual(clearing.code, 'execution_draining');
  assert.deepStrictEqual(harness.cancellationCallbacks, []);
  assert.deepStrictEqual(harness.cancellationWrites, []);

  harness.closeGate.resolve(validCloseReceipt());
  await waitUntil(
    harness,
    () => harness.lifecycle.diagnostics().active === false
      && harness.coordinator.diagnostics().activeJobs === 0,
    'completed lifecycle drain did not finish',
  );

  assert.strictEqual(harness.closeCalls, 1);
  assert.strictEqual(harness.scheduledContinuations.length, 1);
  assert.strictEqual(harness.continuationResults.length, 1);
  assert.strictEqual(harness.continuationResults[0].status, 'completed');
  assert.strictEqual(harness.cleanupProofs.length, 1);
  assert.strictEqual(harness.cleanupProofs[0].terminalStatus, 'completed');
  assert.deepStrictEqual(harness.cleanupReceipts, []);
  assert.deepStrictEqual(harness.cleanupFailureWrites, []);
  assert.strictEqual(harness.lifecycle.diagnostics().drainOnlyOutcomes, 1);
  assert.strictEqual(harness.lifecycle.diagnostics().completedSessions, 1);
  assertHealthyAuthority(harness);

  harness.actionGate.resolve();
  const result = await execution;
  assert.strictEqual(result.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
  assertHealthyAuthority(harness);
}

async function run() {
  await testCancelledExecutorPersistsOneReceiptAfterAsyncContinuation();
  await testCompletedExecutorDrainsWithoutCancellationOrReceipt();
  console.log('assistant-runtime-lifecycle-integration.test.js: all checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
