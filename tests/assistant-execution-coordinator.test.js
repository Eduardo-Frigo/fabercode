'use strict';

const assert = require('assert');

const {
  createAssistantExecutionCoordinator,
  ASSISTANT_EXECUTION_COORDINATOR_REASONS,
} = require('../main/agent_runtime/assistant_execution_coordinator');
const {
  createActionDigest,
  createAssistantJobAuthorityService,
} = require('../main/services/assistant_job_authority_service');
const {
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
} = require('../main/services/execution_isolation_authorized_job_executor');

function sequenceFactory(prefix) {
  let sequence = 0;
  return () => `${prefix}_${String(++sequence).padStart(24, '0')}`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function project(id) {
  return {
    id,
    rootPath: `/workspace/${id}`,
    name: `Project ${id}`,
  };
}

function createHarness({
  maxActiveJobs = 8,
  executeAction: executeOverride = null,
  createAuthorizedJobExecutor = null,
  hooks = {},
} = {}) {
  const jobs = new Map();
  const calls = {
    actionDigests: [],
    authorityClears: [],
    authorityRevocations: [],
    boundActions: [],
    cancellationRequests: [],
    cleanupConfirmations: [],
    cleanupFailures: [],
    executions: [],
    failures: [],
    lifecycleReleases: [],
    pendingApprovalRecoveries: [],
    releaseOrder: [],
    retryEligibilityInspections: [],
    retryAuthorizations: [],
    revocations: [],
  };
  let jobSequence = 0;

  let coordinator = null;
  const baseAuthorityService = createAssistantJobAuthorityService({
    authorizeProjectBinding(projectId, rootPath) {
      if (rootPath !== `/workspace/${projectId}`) return { authorized: false };
      const identitySuffix = projectId === 'project-a' ? '1' : '2';
      return {
        authorized: true,
        projectId,
        canonicalRootPath: rootPath,
        realRootPath: `/real${rootPath}`,
        physicalRootIdentity: {
          device: '1',
          inode: identitySuffix,
          entryDevice: '1',
          entryInode: identitySuffix,
          entryType: 'directory',
        },
        authorizedContext: { source: 'test-main', projectId },
      };
    },
    getJobById(jobId) {
      return jobs.has(jobId)
        ? { ok: true, job: jobs.get(jobId) }
        : { ok: false, code: 'job_not_found' };
    },
    now: (() => {
      let now = 1_000;
      return () => ++now;
    })(),
    sessionIdFactory: sequenceFactory('session'),
    submissionIdFactory: sequenceFactory('submission'),
    maxActiveSubmissions: 64,
    maxActiveSessions: 64,
  });

  function createAuthorizedAssistantJob(input) {
    const id = `job-${++jobSequence}`;
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
    if (typeof hooks.onCreateAuthorizedJob === 'function') {
      hooks.onCreateAuthorizedJob({ coordinator, input, job });
    }
    return { ok: true, job };
  }

  function bindJobActionDigest(jobId, actionDigest) {
    const job = jobs.get(jobId);
    if (!job) return { ok: false, code: 'job_not_found' };
    if (job.authorityContext.actionDigest && job.authorityContext.actionDigest !== actionDigest) {
      return { ok: false, code: 'action_digest_conflict' };
    }
    job.authorityContext = { ...job.authorityContext, actionDigest };
    if (typeof hooks.onBindJobActionDigest === 'function') {
      hooks.onBindJobActionDigest({ actionDigest, coordinator, job, jobId });
    }
    return { ok: true, job };
  }

  function persistPendingApprovalRecovery(jobId, recovery) {
    const job = jobs.get(jobId);
    calls.pendingApprovalRecoveries.push({ jobId, recovery });
    if (typeof hooks.onPersistPendingApprovalRecovery === 'function') {
      const overridden = hooks.onPersistPendingApprovalRecovery({
        coordinator, job, jobId, recovery,
      });
      if (overridden !== undefined) return overridden;
    }
    if (!job) return { ok: false, code: 'job_not_found' };
    job.pendingApprovalRecovery = recovery;
    return { ok: true, job };
  }

  function bindActionToProject(action, projectInfo) {
    calls.boundActions.push({ action, projectInfo });
    if (typeof hooks.onBindActionToProject === 'function') {
      hooks.onBindActionToProject({ action, coordinator, projectInfo });
    }
    const output = { ...action, rootPath: projectInfo.rootPath };
    if (action.executionCommand && typeof action.executionCommand === 'object') {
      output.executionCommand = {
        ...action.executionCommand,
        root_path: projectInfo.rootPath,
      };
    }
    return output;
  }

  function digestAction(action) {
    calls.actionDigests.push(action);
    if (typeof hooks.onCreateActionDigest === 'function') {
      hooks.onCreateActionDigest({ action, coordinator });
    }
    return createActionDigest(action);
  }

  const authorityService = {
    ...baseAuthorityService,
    authorizeExecute(input) {
      if (typeof hooks.onAuthorizeExecute === 'function') {
          hooks.onAuthorizeExecute({ coordinator, input });
      }
      return baseAuthorityService.authorizeExecute(input);
    },
    authorizeRetry(input) {
      calls.retryAuthorizations.push(input);
      if (typeof hooks.onAuthorizeRetry === 'function') {
        const overridden = hooks.onAuthorizeRetry({ baseAuthorityService, coordinator, input });
        if (overridden !== undefined) return overridden;
      }
      return baseAuthorityService.authorizeRetry(input);
    },
    inspectRetryEligibility(input) {
      calls.retryEligibilityInspections.push(input);
      if (typeof hooks.onInspectRetryEligibility === 'function') {
        const overridden = hooks.onInspectRetryEligibility({ baseAuthorityService, coordinator, input });
        if (overridden !== undefined) return overridden;
      }
      return baseAuthorityService.inspectRetryEligibility(input);
    },
    revokeExact(input) {
      calls.authorityRevocations.push(input);
      calls.releaseOrder.push({ type: 'authority_revoke', binding: input });
      if (typeof hooks.revokeExact === 'function') {
        return hooks.revokeExact({ baseAuthorityService, coordinator, input });
      }
      return baseAuthorityService.revokeExact(input);
    },
    clear() {
      calls.authorityClears.push(true);
      calls.releaseOrder.push({ type: 'authority_clear' });
      if (typeof hooks.clearAuthority === 'function') {
        return hooks.clearAuthority({ baseAuthorityService, coordinator });
      }
      return baseAuthorityService.clear();
    },
  };

  const defaultExecute = async (action, projectInfo, context) => {
    calls.executions.push({ action, projectInfo, context });
    return {
      ok: true,
      modifiedFiles: ['src/app.js'],
      rootPath: '/private/project-root',
      nested: { root_path: '/private/nested-root', safe: 'visible' },
      authorityBinding: context.authorityBinding,
      authorityContext: { mustNotLeak: true },
    };
  };

  coordinator = createAssistantExecutionCoordinator({
    authorityService,
    bindActionToProject,
    bindJobActionDigest,
    persistPendingApprovalRecovery,
    getAuthorizedJobById(jobId) {
      return jobs.has(jobId)
        ? { ok: true, job: jobs.get(jobId) }
        : { ok: false, code: 'job_not_found' };
    },
    restoreAuthorizedProject(binding) {
      const current = project(binding.projectId);
      return binding.canonicalRootPath === current.rootPath
        ? { ok: true, projectInfo: current }
        : { ok: false, code: 'project_not_authorized' };
    },
    createActionDigest: digestAction,
    createAuthorizedAssistantJob,
    ...(createAuthorizedJobExecutor
      ? { createAuthorizedJobExecutor }
      : {}),
    executeAction: executeOverride || defaultExecute,
    maxActiveJobs,
    ...(hooks.omitBeforeAuthorityRelease === true
      ? {}
      : {
        beforeAuthorityRelease(input) {
          calls.lifecycleReleases.push(input);
          calls.releaseOrder.push({ type: 'release_barrier', input });
          if (typeof hooks.beforeAuthorityRelease === 'function') {
            return hooks.beforeAuthorityRelease({
              baseAuthorityService,
              coordinator,
              input,
              jobs,
            });
          }
          return { ok: true };
        },
      }),
    onAuthorityRevoked(jobId, reason) {
      calls.revocations.push({ jobId, reason });
      calls.releaseOrder.push({ type: 'legacy_callback', jobId, reason });
    },
    ...(typeof hooks.onCancellationRequested === 'function'
      ? {
        onCancellationRequested(jobId, reason) {
          calls.cancellationRequests.push({ jobId, reason });
          calls.releaseOrder.push({ type: 'cancellation_requested', jobId, reason });
          return hooks.onCancellationRequested({ coordinator, jobId, jobs, reason });
        },
      }
      : {}),
    onExecutionCleanupConfirmed(input) {
      calls.cleanupConfirmations.push(input);
      calls.releaseOrder.push({ type: 'cleanup_confirmed', input });
      if (typeof hooks.onExecutionCleanupConfirmed === 'function') {
        return hooks.onExecutionCleanupConfirmed({ coordinator, input, jobs });
      }
      return { ok: true };
    },
    onExecutionCleanupFailed(input) {
      calls.cleanupFailures.push(input);
      if (typeof hooks.onExecutionCleanupFailed === 'function') {
        return hooks.onExecutionCleanupFailed({ coordinator, input, jobs });
      }
      return { ok: true };
    },
    onPlanningFailure(jobId, reason) {
      calls.failures.push({ jobId, reason });
    },
  });

  return { authorityService, calls, coordinator, jobs };
}

function planningInput(projectInfo, invoke, overrides = {}) {
  return {
    operation: 'plan',
    payload: {
      projectInfo,
      userMessage: 'Crie a aplicação',
      attachments: [],
      approvalMode: 'ask_each',
      ...overrides,
    },
    kernelId: 'kernel-a',
    invoke,
  };
}

function createJob(coordinator, suffix = '') {
  return coordinator.createPlanningJob({
    userMessage: `Mensagem efetiva interna ${suffix}`,
    attachments: [{ name: 'internal.txt', type: 'text/plain', size: 8, path: '/tmp/internal.txt' }],
    mode: 'build',
  });
}

async function createReadyJob(harness, suffix = 'ready') {
  let jobId;
  const planned = await harness.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      const created = createJob(harness.coordinator, suffix);
      assert.strictEqual(created.ok, true);
      jobId = created.job.id;
      harness.jobs.get(jobId).phase = 'awaiting_user_confirmation';
      return { ok: true, action: { type: 'write_files', files: [] } };
    },
  ));
  assert.strictEqual(planned.ok, true);
  return jobId;
}

async function createRetryWaitingJob(
  harness,
  suffix = 'retry',
  {
    status = 'retry_pending',
    phase = 'persona_plan',
    nextRetryAt = null,
    approvalMode = 'ask_each',
  } = {},
) {
  let jobId;
  const result = await harness.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      const created = createJob(harness.coordinator, suffix);
      assert.strictEqual(created.ok, true);
      jobId = created.job.id;
      const job = harness.jobs.get(jobId);
      job.status = status;
      job.phase = phase;
      job.retryState = { retryable: true, nextRetryAt };
      return {
        ok: true,
        response: 'retry scheduled',
        jobId: 'job-forged-by-planner',
        authorityContext: { mustNotLeak: true },
        nested: { actionDigest: `sha256:${'f'.repeat(64)}`, safe: 'visible' },
      };
    },
    { approvalMode },
  ));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.jobId, jobId);
  assert.strictEqual(Object.hasOwn(result, 'authorityContext'), false);
  assert.deepStrictEqual(result.nested, { safe: 'visible' });
  assert.strictEqual(harness.coordinator.diagnostics().activeJobs, 1);
  return jobId;
}

async function testExactRootMutationObservation() {
  const gates = new Map();
  const entered = new Map();
  const bindings = new Map();
  const observations = new Map();
  let harness;
  harness = createHarness({
    executeAction: async (_action, _projectInfo, context) => {
      bindings.set(context.jobId, context.authorityBinding);
      observations.set(
        context.jobId,
        harness.coordinator.inspectRootMutation(context.authorityBinding)
      );
      entered.get(context.jobId).resolve();
      await gates.get(context.jobId).promise;
      return { ok: true, modifiedFiles: ['src/app.js'] };
    },
  });
  assert.strictEqual(
    typeof harness.coordinator.inspectRootMutation,
    'function'
  );
  const firstJobId = await createReadyJob(harness, 'root-observer-first');
  const secondJobId = await createReadyJob(harness, 'root-observer-second');
  for (const jobId of [firstJobId, secondJobId]) {
    gates.set(jobId, deferred());
    entered.set(jobId, deferred());
  }

  const firstExecution = harness.coordinator.execute({ jobId: firstJobId });
  await entered.get(firstJobId).promise;
  assert.deepStrictEqual(observations.get(firstJobId), {
    canonicalRootPath: '/workspace/project-a',
    ownerJobId: firstJobId,
    activeOtherMutatingJobs: 0,
  });

  const secondExecution = harness.coordinator.execute({ jobId: secondJobId });
  await entered.get(secondJobId).promise;
  assert.deepStrictEqual(observations.get(secondJobId), {
    canonicalRootPath: '/workspace/project-a',
    ownerJobId: secondJobId,
    activeOtherMutatingJobs: 1,
  });
  const firstConcurrentObservation = harness.coordinator.inspectRootMutation(
    bindings.get(firstJobId)
  );
  assert.deepStrictEqual(firstConcurrentObservation, {
    canonicalRootPath: '/workspace/project-a',
    ownerJobId: firstJobId,
    activeOtherMutatingJobs: 1,
  });
  assert.strictEqual(Object.isFrozen(firstConcurrentObservation), true);

  gates.get(firstJobId).resolve();
  assert.strictEqual((await firstExecution).ok, true);
  assert.deepStrictEqual(
    harness.coordinator.inspectRootMutation(bindings.get(secondJobId)),
    {
      canonicalRootPath: '/workspace/project-a',
      ownerJobId: secondJobId,
      activeOtherMutatingJobs: 0,
    }
  );
  assert.deepStrictEqual(
    harness.coordinator.inspectRootMutation(Object.freeze({
      ...bindings.get(secondJobId),
      jobId: 'job-not-owned-by-coordinator',
    })),
    {
      canonicalRootPath: '/workspace/project-a',
      ownerJobId: 'job-not-owned-by-coordinator',
      activeOtherMutatingJobs: 1,
    }
  );

  gates.get(secondJobId).resolve();
  assert.strictEqual((await secondExecution).ok, true);
  assert.strictEqual(
    harness.coordinator.inspectRootMutation(bindings.get(secondJobId))
      .activeOtherMutatingJobs,
    1
  );
  assert.throws(
    () => harness.coordinator.inspectRootMutation(Object.freeze({})),
    /binding|root mutation/i
  );
}

async function run() {
  await testExactRootMutationObservation();
  assert.throws(
    () => createHarness({ createAuthorizedJobExecutor: {} }),
    /createAuthorizedJobExecutor must be a function when supplied/,
  );

  // Planning creates authority late, replaces forged ids/roots, and binds the
  // main-generated root into the exact action digest.
  const basic = createHarness();
  const forgedProject = {
    ...project('project-a'),
    projectId: 'project-attacker',
    canonicalRootPath: '/workspace/attacker',
    realRootPath: '/real/workspace/attacker',
    authorityContext: { forged: true },
    physicalRootIdentity: { inode: 'forged' },
    metadata: {
      safe: 'visible',
      realRootPath: '/nested/attacker',
      consentHandle: 'nested-secret',
    },
  };
  const proposedAction = {
    type: 'write_files',
    rootPath: '/workspace/attacker',
    root_path: '/workspace/attacker',
    jobId: 'job-forged',
    projectId: 'project-attacker',
    kernelId: 'kernel-attacker',
    files: [{ path: 'src/app.js', content: 'original' }],
    executionCommand: {
      protocol: 'faber-exec-v2',
      task_type: 'apply_file_patch',
      root_path: '/workspace/attacker',
    },
  };
  let createdJobId;
  let receivedPlanningPayload;
  const plan = await basic.coordinator.coordinatePlanning(planningInput(
    forgedProject,
    async (safePayload) => {
      receivedPlanningPayload = safePayload;
      await Promise.resolve();
      const created = createJob(basic.coordinator, 'A');
      assert.strictEqual(created.ok, true);
      createdJobId = created.job.id;
      basic.jobs.get(createdJobId).phase = 'awaiting_user_confirmation';
      return {
        ok: true,
        jobId: 'job-forged',
        submissionId: 'submission-forged',
        authorityContext: { forged: true },
        meta: {
          autoExecute: true,
          approvalMode: 'ask_each',
          requestedMode: 'ask_each',
          planner: 'test',
          nested: {
            consentHandle: 'secret-consent',
            grantId: 'secret-grant',
            requestDigest: `sha256:${'a'.repeat(64)}`,
            approvalProof: 'secret-proof',
            safe: 'visible',
          },
        },
        action: proposedAction,
      };
    },
    {
      approvalMode: 'delegate_task',
      jobId: 'job-input-forged',
      submissionId: 'submission-input-forged',
    },
  ));
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.jobId, createdJobId);
  assert.strictEqual(createdJobId, 'job-1');
  const rejectedJobIds = ['job:1', 'legacy-job', 'job-a:b', `job-${'a'.repeat(181)}`];
  for (const rejectedJobId of rejectedJobIds) {
    assert.deepStrictEqual(
      basic.coordinator.onJobTerminal({ jobId: rejectedJobId, status: 'cancelled' }),
      {
        ok: false,
        code: ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT,
        message: 'A operação foi rejeitada pelo coordenador.',
      },
    );
  }
  assert.strictEqual(Object.hasOwn(plan, 'submissionId'), false);
  assert.strictEqual(Object.hasOwn(plan, 'authorityContext'), false);
  assert.strictEqual(Object.hasOwn(plan.meta, 'autoExecute'), false);
  assert.strictEqual(Object.hasOwn(plan.meta, 'approvalMode'), false);
  assert.strictEqual(Object.hasOwn(plan.meta, 'requestedMode'), false);
  assert.strictEqual(plan.meta.planner, 'test');
  assert.deepStrictEqual(plan.meta.nested, { safe: 'visible' });
  for (const field of ['approvalMode', 'jobId', 'requestedMode', 'submissionId']) {
    assert.strictEqual(Object.hasOwn(receivedPlanningPayload, field), false);
  }
  assert.deepStrictEqual(receivedPlanningPayload.projectInfo, {
    ...project('project-a'),
    projectId: 'project-a',
    metadata: { safe: 'visible' },
  });
  assert.strictEqual(Object.hasOwn(plan.action, 'jobId'), false);
  assert.strictEqual(plan.action.rootPath, '/workspace/project-a');
  assert.strictEqual(plan.action.executionCommand.root_path, '/workspace/project-a');
  assert.strictEqual(basic.calls.boundActions[0].action.rootPath, undefined);
  assert.strictEqual(basic.calls.boundActions[0].action.root_path, undefined);
  assert.strictEqual(basic.calls.boundActions[0].action.jobId, undefined);
  assert.strictEqual(basic.calls.boundActions[0].action.projectId, undefined);
  assert.strictEqual(basic.calls.boundActions[0].action.kernelId, undefined);
  assert.deepStrictEqual(basic.calls.boundActions[0].projectInfo, {
    id: 'project-a',
    projectId: 'project-a',
    rootPath: '/workspace/project-a',
    name: 'Project project-a',
    metadata: { safe: 'visible' },
  });
  assert.strictEqual(basic.calls.actionDigests[0].rootPath, '/workspace/project-a');
  assert.strictEqual(basic.calls.actionDigests[0].executionCommand.root_path, '/workspace/project-a');
  assert.strictEqual(basic.jobs.get(createdJobId).request.userMessage, 'Crie a aplicação');
  assert.deepStrictEqual(basic.jobs.get(createdJobId).request.attachments, []);
  assert.strictEqual(basic.calls.pendingApprovalRecoveries.length, 1);
  const pendingRecovery = basic.calls.pendingApprovalRecoveries[0];
  assert.strictEqual(pendingRecovery.jobId, createdJobId);
  assert.strictEqual(pendingRecovery.recovery.schemaVersion, 'assistant-pending-approval-recovery.v1');
  assert.strictEqual(pendingRecovery.recovery.requestedMode, 'delegate_task');
  assert.strictEqual(pendingRecovery.recovery.actionDigest, basic.jobs.get(createdJobId).authorityContext.actionDigest);
  assert.strictEqual(pendingRecovery.recovery.action.rootPath, '/workspace/project-a');
  assert.strictEqual(Object.isFrozen(pendingRecovery.recovery), true);
  assert.strictEqual(Object.isFrozen(pendingRecovery.recovery.action), true);

  const restart = createHarness();
  const restartedJobId = await createReadyJob(restart, 'restart');
  const restartRecovery = restart.jobs.get(restartedJobId).pendingApprovalRecovery;
  assert.strictEqual(restart.coordinator.clear().ok, true);
  assert.strictEqual(restart.coordinator.diagnostics().activeJobs, 0);
  for (const rejectedJobId of rejectedJobIds) {
    assert.deepStrictEqual(
      restart.coordinator.restorePendingApproval({
        jobId: rejectedJobId,
        recovery: restartRecovery,
      }),
      {
        ok: false,
        code: ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT,
        message: 'A operação foi rejeitada pelo coordenador.',
      },
    );
  }
  assert.deepStrictEqual(
    restart.coordinator.restorePendingApproval({
      jobId: restartedJobId,
      recovery: { ...restartRecovery, actionDigest: `sha256:${'f'.repeat(64)}` },
    }),
    {
      ok: false,
      code: ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_DIGEST_MISMATCH,
      message: 'A operação foi rejeitada pelo coordenador.',
    }
  );
  const restored = restart.coordinator.restorePendingApproval({
    jobId: restartedJobId,
    recovery: restartRecovery,
  });
  assert.strictEqual(restored.ok, true);
  assert.strictEqual(restored.restored, true);
  assert.strictEqual(restored.idempotent, false);
  assert.strictEqual(restored.job.id, restartedJobId);
  assert.strictEqual(restart.coordinator.diagnostics().readyJobs, 1);
  assert.strictEqual(
    restart.coordinator.restorePendingApproval({
      jobId: restartedJobId,
      recovery: restartRecovery,
    }).idempotent,
    true
  );
  assert.strictEqual((await restart.coordinator.execute({ jobId: restartedJobId })).ok, true);

  proposedAction.files[0].content = 'mutated-after-plan';
  proposedAction.rootPath = '/workspace/project-b';
  const executed = await basic.coordinator.execute({ jobId: createdJobId });
  assert.strictEqual(executed.ok, true);
  assert.deepStrictEqual(executed.modifiedFiles, ['src/app.js']);
  assert.deepStrictEqual(executed.nested, { safe: 'visible' });
  assert.strictEqual(Object.hasOwn(executed, 'rootPath'), false);
  assert.strictEqual(Object.hasOwn(executed, 'authorityContext'), false);
  assert.strictEqual(basic.calls.executions.length, 1);
  assert.strictEqual(basic.calls.executions[0].action.files[0].content, 'original');
  assert.strictEqual(basic.calls.executions[0].action.rootPath, '/workspace/project-a');
  assert.deepStrictEqual(basic.calls.executions[0].projectInfo, {
    ...project('project-a'),
    projectId: 'project-a',
    metadata: { safe: 'visible' },
  });
  for (const field of ['authorityContext', 'canonicalRootPath', 'physicalRootIdentity', 'realRootPath']) {
    assert.strictEqual(Object.hasOwn(basic.calls.executions[0].projectInfo, field), false);
  }
  assert.strictEqual(basic.calls.executions[0].context.jobId, createdJobId);
  assert.strictEqual(basic.calls.executions[0].context.requestedMode, 'delegate_task');
  assert.strictEqual(basic.calls.executions[0].context.signal instanceof AbortSignal, true);
  assert.strictEqual(basic.calls.executions[0].context.signal.aborted, false);
  assert.strictEqual(Object.isFrozen(basic.calls.executions[0].context), true);
  assert.strictEqual(Object.isFrozen(basic.calls.executions[0].context.authorityBinding), true);
  assert.strictEqual(
    basic.calls.executions[0].context.authorityBinding,
    basic.calls.lifecycleReleases[0].binding,
  );
  assert.deepStrictEqual(
    Object.keys(basic.calls.executions[0].context).sort(),
    ['jobId', 'requestedMode', 'signal'],
  );
  assert.strictEqual(Object.hasOwn(executed, 'authorityBinding'), false);
  assert.deepStrictEqual(basic.calls.lifecycleReleases.map((release) => ({
    reason: release.reason,
    terminalStatus: release.terminalStatus,
  })), [{ reason: 'job_terminal', terminalStatus: 'completed' }]);
  assert.deepStrictEqual(basic.calls.releaseOrder.map((entry) => entry.type), [
    'release_barrier',
    'legacy_callback',
    'authority_revoke',
  ]);
  assert.strictEqual(basic.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(
    (await basic.coordinator.execute({ jobId: createdJobId })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_NOT_FOUND,
  );
  assert.strictEqual(
    (await basic.coordinator.execute({ jobId: createdJobId, action: proposedAction })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT,
  );
  assert.strictEqual(
    createJob(basic.coordinator).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.NO_PLANNING_SCOPE,
  );

  // The job-owned sandbox executor is created only after exact execution
  // authorization, reaches the runtime through a private context field, and
  // closes before every broader lifecycle release.
  const isolatedEvents = [];
  let isolatedExecutor = null;
  let isolatedExecutionContext = null;
  let isolatedFactoryBinding = null;
  const isolated = createHarness({
    createAuthorizedJobExecutor(input) {
      isolatedEvents.push('executor_create');
      assert.strictEqual(Object.isFrozen(input), true);
      assert.deepStrictEqual(Object.keys(input), ['binding']);
      assert.strictEqual(Object.isFrozen(input.binding), true);
      isolatedFactoryBinding = input.binding;
      isolatedExecutor = Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        read() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        wait() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        stop() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        close() {
          isolatedEvents.push('executor_close');
          return Promise.resolve(Object.freeze({
            version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
            ok: true,
            closed: true,
            sessionClosed: false,
          }));
        },
        diagnostics() {
          return Object.freeze({ state: 'ready' });
        },
      });
      return isolatedExecutor;
    },
    executeAction: async (action, projectInfo, context) => {
      isolatedEvents.push('execute_action');
      isolatedExecutionContext = context;
      return { ok: true, isolated: true };
    },
    hooks: {
      onAuthorizeExecute() {
        isolatedEvents.push('authorize_execute');
      },
      beforeAuthorityRelease() {
        isolatedEvents.push('release_barrier');
        return { ok: true };
      },
      revokeExact({ baseAuthorityService, input }) {
        isolatedEvents.push('authority_revoke');
        return baseAuthorityService.revokeExact(input);
      },
    },
  });
  const isolatedJobId = await createReadyJob(isolated, 'isolated-resource');
  const isolatedResult = await isolated.coordinator.execute({ jobId: isolatedJobId });
  assert.deepStrictEqual(isolatedResult, { ok: true, isolated: true });
  assert.strictEqual(isolatedExecutionContext.authorityBinding, isolatedFactoryBinding);
  assert.strictEqual(isolatedExecutionContext.sandboxExecutor, isolatedExecutor);
  assert.deepStrictEqual(
    Object.getOwnPropertyDescriptor(isolatedExecutionContext, 'sandboxExecutor'),
    {
      configurable: false,
      enumerable: false,
      value: isolatedExecutor,
      writable: false,
    },
  );
  assert.deepStrictEqual(
    Object.keys(isolatedExecutionContext).sort(),
    ['jobId', 'requestedMode', 'signal'],
  );
  assert.deepStrictEqual(isolatedEvents, [
    'authorize_execute',
    'executor_create',
    'execute_action',
    'executor_close',
    'release_barrier',
    'authority_revoke',
  ]);

  // Cancellation at the async frontier after executor creation closes the
  // resource immediately and fences executeAction from starting with stale
  // authority.
  let frontierExecutions = 0;
  let frontierCloseCalls = 0;
  const frontierCancellation = createHarness({
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() {
          return Promise.reject(new Error('stale executor must not run'));
        },
        read() {
          return Promise.reject(new Error('stale executor must not run'));
        },
        wait() {
          return Promise.reject(new Error('stale executor must not run'));
        },
        stop() {
          return Promise.reject(new Error('stale executor must not run'));
        },
        close() {
          frontierCloseCalls += 1;
          return Promise.resolve(Object.freeze({
            version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
            ok: true,
            closed: true,
            sessionClosed: false,
          }));
        },
        diagnostics() {
          return Object.freeze({ state: 'ready' });
        },
      });
    },
    executeAction: async () => {
      frontierExecutions += 1;
      return { ok: true, stale: true };
    },
  });
  const frontierJobId = await createReadyJob(
    frontierCancellation,
    'isolated-frontier-cancellation',
  );
  const frontierExecution = frontierCancellation.coordinator.execute({
    jobId: frontierJobId,
  });
  assert.deepStrictEqual(
    frontierCancellation.coordinator.revokeJob({ jobId: frontierJobId }),
    { ok: true, revoked: false, deferred: true },
  );
  assert.strictEqual(frontierCloseCalls, 1);
  assert.strictEqual(
    (await frontierExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.strictEqual(frontierExecutions, 0);
  assert.strictEqual(frontierCancellation.calls.authorityRevocations.length, 1);
  assert.strictEqual(frontierCancellation.coordinator.diagnostics().activeJobs, 0);

  // Once cancellation has closed the executor, the broader job authority still
  // drains until executeAction unwinds; repeated cancellation and clear cannot
  // bypass that remaining runtime frontier.
  const activeActionStarted = deferred();
  const activeActionGate = deferred();
  let activeCancellationSignal = null;
  const activeCancellation = createHarness({
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        read() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        wait() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        stop() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        close() {
          return Promise.resolve(Object.freeze({
            version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
            ok: true,
            closed: true,
            sessionClosed: false,
          }));
        },
        diagnostics() {
          return Object.freeze({ state: 'active' });
        },
      });
    },
    executeAction: async (action, projectInfo, context) => {
      activeCancellationSignal = context.signal;
      activeActionStarted.resolve();
      await activeActionGate.promise;
      return { ok: true, stale: true };
    },
  });
  const activeCancellationJobId = await createReadyJob(
    activeCancellation,
    'isolated-active-cancellation',
  );
  const activeCancellationExecution = activeCancellation.coordinator.execute({
    jobId: activeCancellationJobId,
  });
  await activeActionStarted.promise;
  assert.deepStrictEqual(
    activeCancellation.coordinator.revokeJob({ jobId: activeCancellationJobId }),
    { ok: true, revoked: false, deferred: true },
  );
  assert.strictEqual(activeCancellationSignal.aborted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(
    activeCancellation.coordinator.revokeJob({ jobId: activeCancellationJobId }).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_NOT_FOUND,
  );
  assert.strictEqual(activeCancellation.calls.authorityRevocations.length, 1);
  assert.deepStrictEqual(activeCancellation.coordinator.clear(), { ok: true, cleared: 0 });
  activeActionGate.resolve();
  assert.strictEqual(
    (await activeCancellationExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.strictEqual(activeCancellation.calls.authorityRevocations.length, 1);

  // Cancellation while resource cleanup is pending is deferred. No release
  // barrier or authority revocation may overtake the confirmed executor close.
  const closeStarted = deferred();
  const closeGate = deferred();
  const drainEvents = [];
  let drainingSignal = null;
  const draining = createHarness({
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        read() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        wait() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        stop() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        close() {
          drainEvents.push('executor_close_started');
          closeStarted.resolve();
          return closeGate.promise.then((receipt) => {
            drainEvents.push('executor_close_confirmed');
            return receipt;
          });
        },
        diagnostics() {
          return Object.freeze({ state: 'closing' });
        },
      });
    },
    executeAction: async (action, projectInfo, context) => {
      drainingSignal = context.signal;
      return { ok: true, stale: true };
    },
    hooks: {
      beforeAuthorityRelease() {
        drainEvents.push('release_barrier');
        return { ok: true };
      },
      revokeExact({ baseAuthorityService, input }) {
        drainEvents.push('authority_revoke');
        return baseAuthorityService.revokeExact(input);
      },
      onExecutionCleanupConfirmed() {
        drainEvents.push('cleanup_confirmed');
        return { ok: true };
      },
    },
  });
  const drainingJobId = await createReadyJob(draining, 'isolated-drain');
  const drainingExecution = draining.coordinator.execute({ jobId: drainingJobId });
  await closeStarted.promise;
  assert.deepStrictEqual(draining.coordinator.revokeJob({ jobId: drainingJobId }), {
    ok: true,
    revoked: false,
    deferred: true,
  });
  assert.strictEqual(drainingSignal.aborted, true);
  assert.strictEqual(
    draining.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING,
  );
  assert.strictEqual(draining.calls.lifecycleReleases.length, 0);
  assert.strictEqual(draining.calls.authorityRevocations.length, 0);
  assert.strictEqual(draining.calls.cleanupConfirmations.length, 0);
  closeGate.resolve(Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
    ok: true,
    closed: true,
    sessionClosed: false,
  }));
  assert.strictEqual(
    (await drainingExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.deepStrictEqual(drainEvents, [
    'executor_close_started',
    'executor_close_confirmed',
    'release_barrier',
    'authority_revoke',
    'cleanup_confirmed',
  ]);
  assert.deepStrictEqual(draining.calls.cleanupConfirmations, [Object.freeze({
    jobId: drainingJobId,
    terminalStatus: 'completed',
    executorClosed: true,
    processTreeTerminated: true,
    workspaceRolledBack: true,
    rootReleased: true,
    authorityRevoked: true,
  })]);
  assert.strictEqual(draining.coordinator.diagnostics().activeJobs, 0);

  // Durable non-cancellation terminal outcomes win the race with lifecycle
  // clear. Each active executor is drained, but the coordinator must neither
  // persist a cancellation request nor rewrite the cleanup proof to cancelled.
  for (const terminalStatus of ['completed', 'failed', 'blocked', 'runtime_interrupted']) {
    const terminalActionStarted = deferred();
    const terminalActionGate = deferred();
    const terminalCloseGate = deferred();
    let terminalCloseCalls = 0;
    let terminalSignal = null;
    const terminalDrain = createHarness({
      createAuthorizedJobExecutor() {
        return Object.freeze({
          version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
          execute() { return Promise.reject(new Error('not exercised')); },
          read() { return Promise.reject(new Error('not exercised')); },
          wait() { return Promise.reject(new Error('not exercised')); },
          stop() { return Promise.reject(new Error('not exercised')); },
          close() {
            terminalCloseCalls += 1;
            return terminalCloseGate.promise;
          },
          diagnostics() { return Object.freeze({ state: 'active' }); },
        });
      },
      executeAction: async (_action, _projectInfo, context) => {
        terminalSignal = context.signal;
        terminalActionStarted.resolve();
        await terminalActionGate.promise;
        return { ok: terminalStatus !== 'failed' };
      },
      hooks: {
        onCancellationRequested() { return { ok: true }; },
      },
    });
    const terminalJobId = await createReadyJob(
      terminalDrain,
      `active-terminal-drain-${terminalStatus}`,
    );
    const terminalExecution = terminalDrain.coordinator.execute({ jobId: terminalJobId });
    await terminalActionStarted.promise;
    assert.deepStrictEqual(
      terminalDrain.coordinator.onJobTerminal({ jobId: terminalJobId, status: terminalStatus }),
      { ok: true, revoked: false, deferred: true, idempotent: false },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(terminalCloseCalls, 1, `${terminalStatus} must start executor drain`);
    assert.strictEqual(terminalSignal.aborted, true);
    assert.strictEqual(
      terminalDrain.coordinator.clear().code,
      ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING,
    );
    assert.deepStrictEqual(
      terminalDrain.calls.cancellationRequests,
      [],
      `${terminalStatus} must not be persisted as cancellation`,
    );
    terminalCloseGate.resolve(Object.freeze({
      version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
      ok: true,
      closed: true,
      sessionClosed: false,
    }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(terminalDrain.calls.cleanupConfirmations, [Object.freeze({
      jobId: terminalJobId,
      terminalStatus,
      executorClosed: true,
      processTreeTerminated: true,
      workspaceRolledBack: true,
      rootReleased: true,
      authorityRevoked: true,
    })]);
    assert.strictEqual(terminalDrain.coordinator.diagnostics().activeJobs, 0);
    assert.strictEqual(terminalDrain.coordinator.diagnostics().authorityHealthy, true);
    terminalActionGate.resolve();
    assert.strictEqual(
      (await terminalExecution).code,
      ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
    );
    assert.deepStrictEqual(terminalDrain.coordinator.clear(), { ok: true, cleared: 0 });
    assert.strictEqual(terminalDrain.coordinator.diagnostics().clearPending, false);
  }

  // Explicit cancellation keeps the distinct contract: one durable request,
  // an active-executor drain and a cancelled cleanup receipt.
  const terminalCancelActionStarted = deferred();
  const terminalCancelActionGate = deferred();
  const terminalCancelCloseGate = deferred();
  const terminalCancel = createHarness({
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() { return Promise.reject(new Error('not exercised')); },
        read() { return Promise.reject(new Error('not exercised')); },
        wait() { return Promise.reject(new Error('not exercised')); },
        stop() { return Promise.reject(new Error('not exercised')); },
        close() { return terminalCancelCloseGate.promise; },
        diagnostics() { return Object.freeze({ state: 'active' }); },
      });
    },
    executeAction: async () => {
      terminalCancelActionStarted.resolve();
      await terminalCancelActionGate.promise;
      return { ok: true, stale: true };
    },
    hooks: {
      onCancellationRequested() { return { ok: true }; },
    },
  });
  const terminalCancelJobId = await createReadyJob(terminalCancel, 'active-terminal-cancel');
  const terminalCancelExecution = terminalCancel.coordinator.execute({
    jobId: terminalCancelJobId,
  });
  await terminalCancelActionStarted.promise;
  assert.deepStrictEqual(
    terminalCancel.coordinator.onJobTerminal({
      jobId: terminalCancelJobId,
      status: 'cancelled',
    }),
    { ok: true, revoked: false, deferred: true, idempotent: false },
  );
  assert.strictEqual(terminalCancel.calls.cancellationRequests.length, 1);
  assert.strictEqual(
    terminalCancel.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING,
  );
  assert.strictEqual(terminalCancel.calls.cancellationRequests.length, 1);
  terminalCancelCloseGate.resolve(Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
    ok: true,
    closed: true,
    sessionClosed: false,
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(terminalCancel.calls.cleanupConfirmations.length, 1);
  assert.strictEqual(
    terminalCancel.calls.cleanupConfirmations[0].terminalStatus,
    'cancelled',
  );
  assert.strictEqual(terminalCancel.coordinator.diagnostics().authorityHealthy, true);
  terminalCancelActionGate.resolve();
  assert.strictEqual(
    (await terminalCancelExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.deepStrictEqual(terminalCancel.coordinator.clear(), { ok: true, cleared: 0 });

  // Once clear has requested cancellation for an execution that is still
  // draining, all new job admissions remain closed until a later clear can
  // finish the complete authority cleanup.
  const latchCloseStarted = deferred();
  const latchCloseGate = deferred();
  const clearLatch = createHarness({
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() { return Promise.reject(new Error('not exercised')); },
        read() { return Promise.reject(new Error('not exercised')); },
        wait() { return Promise.reject(new Error('not exercised')); },
        stop() { return Promise.reject(new Error('not exercised')); },
        close() {
          latchCloseStarted.resolve();
          return latchCloseGate.promise;
        },
        diagnostics() { return Object.freeze({ state: 'closing' }); },
      });
    },
    executeAction: async () => ({ ok: true, stale: true }),
    hooks: {
      onCancellationRequested() { return { ok: true }; },
    },
  });
  const latchExecutingJobId = await createReadyJob(clearLatch, 'clear-latch-executing');
  const latchReadyJobId = await createReadyJob(clearLatch, 'clear-latch-ready');
  const latchExecution = clearLatch.coordinator.execute({ jobId: latchExecutingJobId });
  await latchCloseStarted.promise;
  assert.strictEqual(
    clearLatch.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING,
  );
  assert.strictEqual(clearLatch.calls.cancellationRequests.length, 1);
  let latchPlanningInvocations = 0;
  assert.strictEqual(
    (await clearLatch.coordinator.coordinatePlanning(planningInput(
      project('project-a'),
      async () => {
        latchPlanningInvocations += 1;
        return { ok: true };
      },
    ))).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING,
  );
  assert.strictEqual(latchPlanningInvocations, 0);
  assert.strictEqual(
    (await clearLatch.coordinator.retry({
      jobId: 'job-missing',
      kernelId: 'kernel-a',
      invoke: async () => ({ ok: true }),
    })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING,
  );
  assert.strictEqual(
    clearLatch.coordinator.restorePendingApproval({}).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING,
  );
  assert.strictEqual(
    (await clearLatch.coordinator.execute({ jobId: latchReadyJobId })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING,
  );
  assert.strictEqual(clearLatch.coordinator.diagnostics().clearPending, true);
  latchCloseGate.resolve(Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
    ok: true,
    closed: true,
    sessionClosed: false,
  }));
  assert.strictEqual(
    (await latchExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.strictEqual(clearLatch.coordinator.diagnostics().clearPending, true);
  assert.deepStrictEqual(clearLatch.coordinator.clear(), { ok: true, cleared: 1 });
  assert.strictEqual(clearLatch.calls.cancellationRequests.length, 1);
  assert.strictEqual(clearLatch.calls.cleanupConfirmations[0].terminalStatus, 'completed');
  assert.strictEqual(clearLatch.coordinator.diagnostics().clearPending, false);

  const detachedActionStarted = deferred();
  const detachedActionGate = deferred();
  const detachedCleanup = createHarness({
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() { return Promise.reject(new Error('not exercised')); },
        read() { return Promise.reject(new Error('not exercised')); },
        wait() { return Promise.reject(new Error('not exercised')); },
        stop() { return Promise.reject(new Error('not exercised')); },
        close() {
          return Promise.resolve(Object.freeze({
            version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
            ok: true,
            closed: true,
            sessionClosed: false,
          }));
        },
        diagnostics() { return Object.freeze({ state: 'active' }); },
      });
    },
    executeAction: async () => {
      detachedActionStarted.resolve();
      await detachedActionGate.promise;
      return { ok: true, stale: true };
    },
  });
  const detachedCleanupJobId = await createReadyJob(
    detachedCleanup,
    'isolated-detached-cleanup',
  );
  const detachedExecution = detachedCleanup.coordinator.execute({
    jobId: detachedCleanupJobId,
  });
  await detachedActionStarted.promise;
  assert.deepStrictEqual(
    detachedCleanup.coordinator.revokeJob({ jobId: detachedCleanupJobId }),
    { ok: true, revoked: false, deferred: true },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(detachedCleanup.calls.cleanupConfirmations.length, 1);
  assert.strictEqual(detachedCleanup.coordinator.diagnostics().activeJobs, 0);
  detachedActionGate.resolve();
  assert.strictEqual(
    (await detachedExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );

  const failedCancelStarted = deferred();
  const failedCancelGate = deferred();
  const failedCancellation = createHarness({
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() { return Promise.reject(new Error('not exercised')); },
        read() { return Promise.reject(new Error('not exercised')); },
        wait() { return Promise.reject(new Error('not exercised')); },
        stop() { return Promise.reject(new Error('not exercised')); },
        close() {
          return Promise.resolve(Object.freeze({
            version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
            ok: false,
            closed: false,
            sessionClosed: false,
          }));
        },
        diagnostics() { return Object.freeze({ state: 'quarantined' }); },
      });
    },
    executeAction: async () => {
      failedCancelStarted.resolve();
      await failedCancelGate.promise;
      return { ok: true };
    },
  });
  const failedCancellationJobId = await createReadyJob(
    failedCancellation,
    'isolated-cancel-cleanup-failure',
  );
  const failedCancellationExecution = failedCancellation.coordinator.execute({
    jobId: failedCancellationJobId,
  });
  await failedCancelStarted.promise;
  assert.deepStrictEqual(
    failedCancellation.coordinator.revokeJob({ jobId: failedCancellationJobId }),
    { ok: true, revoked: false, deferred: true },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(failedCancellation.calls.cleanupConfirmations.length, 0);
  assert.deepStrictEqual(failedCancellation.calls.cleanupFailures, [Object.freeze({
    jobId: failedCancellationJobId,
    terminalStatus: 'cancelled',
    reason: ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
  })]);
  failedCancelGate.resolve();
  assert.strictEqual(
    (await failedCancellationExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );

  // A malformed close receipt quarantines the lifecycle: broader authority is
  // retained and the coordinator becomes unhealthy instead of claiming cleanup.
  const closeFailure = createHarness({
    createAuthorizedJobExecutor() {
      return Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
        execute() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        read() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        wait() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        stop() {
          return Promise.reject(new Error('not exercised by this lifecycle test'));
        },
        close() {
          return Promise.resolve(Object.freeze({
            version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
            ok: false,
            closed: false,
            sessionClosed: false,
          }));
        },
        diagnostics() {
          return Object.freeze({ state: 'quarantined' });
        },
      });
    },
    executeAction: async () => ({ ok: true }),
  });
  const closeFailureJobId = await createReadyJob(closeFailure, 'isolated-close-failure');
  assert.strictEqual(
    (await closeFailure.coordinator.execute({ jobId: closeFailureJobId })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
  );
  assert.strictEqual(closeFailure.calls.lifecycleReleases.length, 0);
  assert.strictEqual(closeFailure.calls.authorityRevocations.length, 0);
  assert.strictEqual(closeFailure.coordinator.diagnostics().activeJobs, 1);
  assert.strictEqual(closeFailure.coordinator.diagnostics().authorityHealthy, false);

  // An async factory violates the synchronous authority frontier. Its native
  // rejection is absorbed, no runtime effect starts, and the unused binding is
  // still released through the normal barrier.
  let asyncFactoryExecutions = 0;
  const asyncFactory = createHarness({
    createAuthorizedJobExecutor: async () => {
      throw new Error('async factory is forbidden');
    },
    executeAction: async () => {
      asyncFactoryExecutions += 1;
      return { ok: true };
    },
  });
  const asyncFactoryJobId = await createReadyJob(asyncFactory, 'async-executor-factory');
  assert.strictEqual(
    (await asyncFactory.coordinator.execute({ jobId: asyncFactoryJobId })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_RESOURCE_FAILED,
  );
  assert.strictEqual(asyncFactoryExecutions, 0);
  assert.strictEqual(asyncFactory.calls.lifecycleReleases.length, 1);
  assert.strictEqual(asyncFactory.calls.authorityRevocations.length, 1);
  assert.strictEqual(asyncFactory.coordinator.diagnostics().activeJobs, 0);

  // AsyncLocalStorage keeps concurrent projects isolated even when the planner
  // creates jobs after interleaved awaits.
  const concurrent = createHarness();
  const gateA = deferred();
  const gateB = deferred();
  const planA = concurrent.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      await gateA.promise;
      const created = createJob(concurrent.coordinator, 'A');
      return {
        ok: true,
        jobId: 'forged-a',
        createdId: created.job.id,
        response: 'A',
        action: { type: 'write_files', files: [] },
      };
    },
  ));
  const planB = concurrent.coordinator.coordinatePlanning(planningInput(
    project('project-b'),
    async () => {
      await gateB.promise;
      const created = createJob(concurrent.coordinator, 'B');
      return {
        ok: true,
        jobId: 'forged-b',
        createdId: created.job.id,
        response: 'B',
        action: { type: 'write_files', files: [] },
      };
    },
  ));
  gateB.resolve();
  await Promise.resolve();
  gateA.resolve();
  const [resultA, resultB] = await Promise.all([planA, planB]);
  assert.strictEqual(concurrent.jobs.get(resultA.jobId).projectId, 'project-a');
  assert.strictEqual(concurrent.jobs.get(resultA.jobId).rootPath, '/workspace/project-a');
  assert.strictEqual(concurrent.jobs.get(resultB.jobId).projectId, 'project-b');
  assert.strictEqual(concurrent.jobs.get(resultB.jobId).rootPath, '/workspace/project-b');
  assert.strictEqual(resultA.jobId, resultA.createdId);
  assert.strictEqual(resultB.jobId, resultB.createdId);
  assert.strictEqual(concurrent.coordinator.onJobTerminal({ jobId: resultA.jobId, status: 'cancelled' }).revoked, true);
  assert.strictEqual(concurrent.coordinator.onJobTerminal({ jobId: resultA.jobId, status: 'cancelled' }).idempotent, true);
  assert.strictEqual(concurrent.coordinator.onJobTerminal({ jobId: resultB.jobId, status: 'blocked' }).revoked, true);
  assert.strictEqual(concurrent.coordinator.diagnostics().activeJobs, 0);

  // Map chat is conversation-only: it needs no project binding and can never
  // manufacture a job or return an executable action.
  const map = createHarness();
  let mapCreateResult;
  let mapPlanningPayload;
  const mapMessage = await map.coordinator.coordinatePlanning({
    operation: 'map_message',
    payload: { isMapChat: true, approvalMode: 'not_a_public_mode' },
    kernelId: 'kernel-map',
    invoke: async (payload) => {
      mapPlanningPayload = payload;
      mapCreateResult = createJob(map.coordinator, 'map');
      return { ok: true, jobId: 'job-forged', response: 'Mapa analisado.' };
    },
  });
  assert.strictEqual(mapCreateResult.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.MAP_JOB_FORBIDDEN);
  assert.strictEqual(mapMessage.ok, true);
  assert.strictEqual(mapMessage.response, 'Mapa analisado.');
  assert.strictEqual(Object.hasOwn(mapMessage, 'jobId'), false);
  assert.strictEqual(Object.hasOwn(mapPlanningPayload, 'approvalMode'), false);
  assert.strictEqual(Object.hasOwn(mapPlanningPayload, 'requestedMode'), false);
  assert.strictEqual(map.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(map.authorityService.diagnostics().activeSubmissions, 0);
  const mapAction = await map.coordinator.coordinatePlanning({
    operation: 'message',
    payload: { isMapChat: true, projectInfo: { rootPath: '/workspace/root-only' } },
    kernelId: 'kernel-map',
    invoke: async () => ({ ok: true, action: { type: 'write_files' } }),
  });
  assert.strictEqual(mapAction.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.MAP_ACTION_FORBIDDEN);
  assert.strictEqual((await map.coordinator.coordinatePlanning({
    operation: 'map_message',
    payload: { isMapChat: true, requestedMode: 'ask_each' },
    kernelId: 'kernel-map',
    invoke: async () => ({ ok: true }),
  })).code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);

  // A second execute cannot enter while the first is in flight. Revocation
  // during that flight blocks the stale output and every replay.
  const executionGate = deferred();
  let executionStarted = 0;
  let executionEffects = 0;
  let racedSignal = null;
  let releaseObservedAbortedSignal = false;
  const raced = createHarness({
    async executeAction(action, projectInfo, context) {
      executionStarted += 1;
      racedSignal = context.signal;
      await executionGate.promise;
      if (context.signal.aborted) throw new Error('aborted before effect');
      executionEffects += 1;
      return { ok: true, stale: true };
    },
    hooks: {
      beforeAuthorityRelease() {
        releaseObservedAbortedSignal = racedSignal.aborted;
        return { ok: true };
      },
    },
  });
  let racedJobId;
  await raced.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    const created = createJob(raced.coordinator, 'race');
    racedJobId = created.job.id;
    raced.jobs.get(racedJobId).phase = 'awaiting_user_confirmation';
    return { ok: true, action: { type: 'write_files', files: [] } };
  }));
  const firstExecution = raced.coordinator.execute({ jobId: racedJobId });
  await Promise.resolve();
  assert.strictEqual(executionStarted, 1);
  assert.strictEqual(
    (await raced.coordinator.execute({ jobId: racedJobId })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_ALREADY_STARTED,
  );
  assert.strictEqual(raced.coordinator.revokeJob({ jobId: racedJobId }).revoked, true);
  assert.strictEqual(racedSignal.aborted, true);
  assert.strictEqual(releaseObservedAbortedSignal, true);
  executionGate.resolve();
  assert.strictEqual(
    (await firstExecution).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.strictEqual(
    (await raced.coordinator.execute({ jobId: racedJobId })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_NOT_FOUND,
  );
  assert.strictEqual(executionStarted, 1);
  assert.strictEqual(executionEffects, 0);

  // Re-entrant dependency callbacks cannot clear/revoke the coordinator and
  // then let stale authority be published or reach executeAction.
  const reentrantBind = createHarness({
    hooks: {
      onBindActionToProject({ coordinator }) {
        coordinator.clear();
      },
    },
  });
  const reentrantBindResult = await reentrantBind.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      const created = createJob(reentrantBind.coordinator, 'reentrant-bind');
      reentrantBind.jobs.get(created.job.id).phase = 'awaiting_user_confirmation';
      return { ok: true, action: { type: 'write_files', files: [] } };
    },
  ));
  assert.strictEqual(reentrantBindResult.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
  assert.strictEqual(reentrantBind.coordinator.diagnostics().activeJobs, 0);

  const reentrantCreate = createHarness({
    hooks: {
      onCreateAuthorizedJob({ coordinator }) {
        coordinator.clear();
      },
    },
  });
  const reentrantCreateResult = await reentrantCreate.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      const created = createJob(reentrantCreate.coordinator, 'reentrant-create');
      return { ok: created.ok, response: 'must not publish' };
    },
  ));
  assert.strictEqual(reentrantCreateResult.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
  assert.strictEqual(reentrantCreate.coordinator.diagnostics().activeJobs, 0);

  let authorizeRaceEffects = 0;
  const authorizeRace = createHarness({
    executeAction: async () => {
      authorizeRaceEffects += 1;
      return { ok: true };
    },
    hooks: {
      onAuthorizeExecute({ coordinator, input }) {
        coordinator.revokeJob({ jobId: input.binding.jobId });
      },
    },
  });
  let authorizeRaceJobId;
  await authorizeRace.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    const created = createJob(authorizeRace.coordinator, 'authorize-race');
    authorizeRaceJobId = created.job.id;
    authorizeRace.jobs.get(authorizeRaceJobId).phase = 'awaiting_user_confirmation';
    return { ok: true, action: { type: 'write_files', files: [] } };
  }));
  assert.strictEqual(
    (await authorizeRace.coordinator.execute({ jobId: authorizeRaceJobId })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.strictEqual(authorizeRaceEffects, 0);

  // A durable completed callback may arrive from the job store while the
  // executor is still unwinding; it is deferred so a successful effect is not
  // mislabeled as stale or cancelled.
  let terminalHarness;
  let terminalCallback;
  terminalHarness = createHarness({
    executeAction: async (action, projectInfo, context) => {
      terminalHarness.jobs.get(context.jobId).status = 'completed';
      terminalCallback = terminalHarness.coordinator.onJobTerminal({
        jobId: context.jobId,
        status: 'completed',
      });
      return { ok: true, completedDuringExecute: true };
    },
  });
  let terminalJobId;
  await terminalHarness.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    const created = createJob(terminalHarness.coordinator, 'terminal-callback');
    terminalJobId = created.job.id;
    terminalHarness.jobs.get(terminalJobId).phase = 'awaiting_user_confirmation';
    return { ok: true, action: { type: 'write_files', files: [] } };
  }));
  const terminalExecution = await terminalHarness.coordinator.execute({ jobId: terminalJobId });
  assert.deepStrictEqual(terminalCallback, {
    ok: true,
    revoked: false,
    deferred: true,
    idempotent: false,
  });
  assert.strictEqual(terminalExecution.ok, true);
  assert.strictEqual(terminalExecution.completedDuringExecute, true);
  assert.strictEqual(terminalHarness.calls.lifecycleReleases.length, 1);
  assert.strictEqual(terminalHarness.calls.lifecycleReleases[0].terminalStatus, 'completed');
  assert.strictEqual(terminalHarness.coordinator.diagnostics().activeJobs, 0);

  // A durable failure emitted by the executor is also deferred until its
  // detailed result returns, so the job is terminal without replacing useful
  // diagnostics with a generic stale-authority response.
  let failedTerminalHarness;
  let failedTerminalCallback;
  failedTerminalHarness = createHarness({
    executeAction: async (action, projectInfo, context) => {
      failedTerminalHarness.jobs.get(context.jobId).status = 'failed';
      failedTerminalCallback = failedTerminalHarness.coordinator.onJobTerminal({
        jobId: context.jobId,
        status: 'failed',
      });
      return { ok: false, code: 'project_authorization_failed', message: 'Projeto revogado.' };
    },
  });
  let failedTerminalJobId;
  await failedTerminalHarness.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    const created = createJob(failedTerminalHarness.coordinator, 'failed-terminal-callback');
    failedTerminalJobId = created.job.id;
    failedTerminalHarness.jobs.get(failedTerminalJobId).phase = 'awaiting_user_confirmation';
    return { ok: true, action: { type: 'write_files', files: [] } };
  }));
  const failedTerminalExecution = await failedTerminalHarness.coordinator.execute({
    jobId: failedTerminalJobId,
  });
  assert.deepStrictEqual(failedTerminalCallback, {
    ok: true,
    revoked: false,
    deferred: true,
    idempotent: false,
  });
  assert.strictEqual(failedTerminalExecution.ok, false);
  assert.strictEqual(failedTerminalExecution.code, 'project_authorization_failed');
  assert.strictEqual(failedTerminalExecution.message, 'Projeto revogado.');
  assert.strictEqual(failedTerminalHarness.calls.lifecycleReleases.length, 1);
  assert.strictEqual(failedTerminalHarness.calls.lifecycleReleases[0].terminalStatus, 'failed');
  assert.strictEqual(failedTerminalHarness.coordinator.diagnostics().activeJobs, 0);

  // A trusted durable completion may be observed reentrantly while planning is
  // still returning a legitimate user-facing response. It closes execution
  // authority without converting that response into a retry or planning error.
  const awaitingInput = createHarness();
  let awaitingInputJobId;
  let awaitingInputTerminalCallback;
  const awaitingInputResult = await awaitingInput.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      const created = createJob(awaitingInput.coordinator, 'awaiting-input');
      awaitingInputJobId = created.job.id;
      const durableJob = awaitingInput.jobs.get(awaitingInputJobId);
      durableJob.status = 'completed';
      durableJob.phase = 'awaiting_user_input';
      durableJob.retryState = { retryable: false, nextRetryAt: null };
      awaitingInputTerminalCallback = awaitingInput.coordinator.onJobTerminal({
        jobId: awaitingInputJobId,
        status: 'completed',
      });
      return {
        ok: true,
        response: 'Qual plataforma devo usar?',
        action: null,
        meta: { planner: 'cortex_runtime', reason: 'cortex_briefing_clarification_needed' },
      };
    },
  ));
  assert.deepStrictEqual(awaitingInputTerminalCallback, {
    ok: true,
    revoked: false,
    deferred: true,
    idempotent: false,
  });
  assert.strictEqual(awaitingInputResult.ok, true);
  assert.strictEqual(awaitingInputResult.response, 'Qual plataforma devo usar?');
  assert.strictEqual(awaitingInputResult.jobId, awaitingInputJobId);
  assert.strictEqual(awaitingInput.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(awaitingInput.authorityService.diagnostics().activeSubmissions, 0);
  assert.strictEqual(awaitingInput.calls.lifecycleReleases[0].terminalStatus, 'completed');
  assert.deepStrictEqual(awaitingInput.calls.failures, []);
  assert.deepStrictEqual(awaitingInput.calls.revocations, [{
    jobId: awaitingInputJobId,
    reason: 'job_terminal',
  }]);

  const terminalActionConflict = createHarness();
  let terminalActionJobId;
  const terminalActionResult = await terminalActionConflict.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      const created = createJob(terminalActionConflict.coordinator, 'terminal-action-conflict');
      terminalActionJobId = created.job.id;
      terminalActionConflict.jobs.get(terminalActionJobId).status = 'completed';
      terminalActionConflict.coordinator.onJobTerminal({
        jobId: terminalActionJobId,
        status: 'completed',
      });
      return {
        ok: true,
        response: 'stale executable output',
        action: { type: 'write_files', files: [{ path: 'stale.js', content: 'blocked' }] },
      };
    },
  ));
  assert.strictEqual(
    terminalActionResult.code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.strictEqual(terminalActionConflict.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(terminalActionConflict.calls.boundActions.length, 0);
  assert.strictEqual(terminalActionConflict.calls.executions.length, 0);

  let throwingAuthorizeEffects = 0;
  const throwingAuthorize = createHarness({
    executeAction: async () => {
      throwingAuthorizeEffects += 1;
      return { ok: true };
    },
    hooks: {
      onAuthorizeExecute() {
        throw new Error('injected authorization failure');
      },
    },
  });
  let throwingAuthorizeJobId;
  await throwingAuthorize.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    const created = createJob(throwingAuthorize.coordinator, 'throw-authorize');
    throwingAuthorizeJobId = created.job.id;
    throwingAuthorize.jobs.get(throwingAuthorizeJobId).phase = 'awaiting_user_confirmation';
    return { ok: true, action: { type: 'write_files', files: [] } };
  }));
  assert.strictEqual(
    (await throwingAuthorize.coordinator.execute({ jobId: throwingAuthorizeJobId })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_NOT_AUTHORIZED,
  );
  assert.strictEqual(throwingAuthorizeEffects, 0);

  const legacyMode = await basic.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => ({ ok: true }),
    { requestedMode: 'delegate_task', approvalMode: 'delegate_task' },
  ));
  assert.strictEqual(legacyMode.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);

  for (const approvalMode of ['', 'ask_each ', 'always', true, null, Symbol('mode')]) {
    const invalidMode = await basic.coordinator.coordinatePlanning(planningInput(
      project('project-a'),
      async () => ({ ok: true }),
      { approvalMode },
    ));
    assert.strictEqual(invalidMode.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
  }

  let modeGetterReads = 0;
  const accessorModePayload = {
    projectInfo: project('project-a'),
    userMessage: 'hostile mode',
    attachments: [],
  };
  Object.defineProperty(accessorModePayload, 'approvalMode', {
    enumerable: true,
    get() { modeGetterReads += 1; return 'delegate_task'; },
  });
  assert.strictEqual((await basic.coordinator.coordinatePlanning({
    operation: 'plan',
    payload: accessorModePayload,
    kernelId: 'kernel-a',
    invoke: async () => ({ ok: true }),
  })).code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
  assert.strictEqual(modeGetterReads, 0);

  const symbolModeInput = planningInput(
    project('project-a'),
    async () => ({ ok: true }),
  );
  symbolModeInput.payload[Symbol('mode')] = 'delegate_task';
  assert.strictEqual(
    (await basic.coordinator.coordinatePlanning(symbolModeInput)).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT,
  );

  const defaultMode = createHarness();
  let defaultModeJobId;
  const defaultModePlan = await defaultMode.coordinator.coordinatePlanning({
    operation: 'plan',
    payload: {
      projectInfo: project('project-a'),
      userMessage: 'default mode',
      attachments: [],
    },
    kernelId: 'kernel-a',
    invoke: async () => {
      const created = createJob(defaultMode.coordinator, 'default-mode');
      defaultModeJobId = created.job.id;
      defaultMode.jobs.get(defaultModeJobId).phase = 'awaiting_user_confirmation';
      return { ok: true, action: { type: 'write_files', files: [] } };
    },
  });
  assert.strictEqual(defaultModePlan.ok, true);
  assert.strictEqual((await defaultMode.coordinator.execute({ jobId: defaultModeJobId })).ok, true);
  assert.strictEqual(defaultMode.calls.executions[0].context.requestedMode, 'ask_each');

  // A created planning job without an action is terminally cleaned instead of
  // consuming coordinator capacity forever.
  const noAction = createHarness({ maxActiveJobs: 1 });
  const noActionResult = await noAction.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      const created = createJob(noAction.coordinator, 'no-action');
      assert.strictEqual(created.ok, true);
      return {
        ok: true,
        response: 'no executable action',
        awaitingUserInput: true,
        meta: { reason: 'awaiting_user_input', executionAuthority: true },
      };
    },
  ));
  assert.strictEqual(noActionResult.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.PLANNING_JOB_NO_ACTION);
  assert.strictEqual(noAction.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(noAction.authorityService.diagnostics().activeSubmissions, 0);
  assert.deepStrictEqual(noAction.calls.failures, [{
    jobId: 'job-1',
    reason: ASSISTANT_EXECUTION_COORDINATOR_REASONS.PLANNING_JOB_NO_ACTION,
  }]);

  // Planning invocations themselves are bounded even before a job exists.
  const pendingScope = createHarness({ maxActiveJobs: 1 });
  const pendingScopeGate = deferred();
  const firstPendingScope = pendingScope.coordinator.coordinatePlanning({
    operation: 'map_message',
    payload: { isMapChat: true },
    kernelId: 'kernel-map',
    invoke: async () => {
      await pendingScopeGate.promise;
      return { ok: true, response: 'done' };
    },
  });
  await Promise.resolve();
  assert.strictEqual(pendingScope.coordinator.diagnostics().activePlanningScopes, 1);
  const secondPendingScope = await pendingScope.coordinator.coordinatePlanning({
    operation: 'map_message',
    payload: { isMapChat: true },
    kernelId: 'kernel-map',
    invoke: async () => ({ ok: true }),
  });
  assert.strictEqual(secondPendingScope.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.CAPACITY_EXCEEDED);
  pendingScopeGate.resolve();
  assert.strictEqual((await firstPendingScope).ok, true);
  assert.strictEqual(pendingScope.coordinator.diagnostics().activePlanningScopes, 0);

  // Capacity is bounded and terminal cleanup returns the slot.
  const bounded = createHarness({ maxActiveJobs: 1 });
  let firstBoundedJob;
  await bounded.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    firstBoundedJob = createJob(bounded.coordinator, 'bounded-1').job.id;
    return { ok: true, response: 'pending', action: { type: 'write_files', files: [] } };
  }));
  let capacityResult;
  await bounded.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    capacityResult = createJob(bounded.coordinator, 'bounded-2');
    return { ok: true, response: 'capacity checked' };
  }));
  assert.strictEqual(capacityResult.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.CAPACITY_EXCEEDED);
  assert.strictEqual(bounded.coordinator.onJobTerminal({ jobId: firstBoundedJob, status: 'cancelled' }).revoked, true);
  let replacement;
  await bounded.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    replacement = createJob(bounded.coordinator, 'bounded-3');
    return { ok: true, response: 'replacement', action: { type: 'write_files', files: [] } };
  }));
  assert.strictEqual(replacement.ok, true);
  bounded.coordinator.onJobTerminal({ jobId: replacement.job.id, status: 'completed' });
  assert.strictEqual(bounded.coordinator.diagnostics().activeJobs, 0);

  // Planner failures revoke partially-created authority and release capacity.
  const failed = createHarness({ maxActiveJobs: 1 });
  const failedResult = await failed.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => {
      const created = createJob(failed.coordinator, 'failed');
      assert.strictEqual(created.ok, true);
      throw new Error('planner failed');
    },
  ));
  assert.strictEqual(failedResult.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.PLANNING_FAILED);
  assert.strictEqual(failed.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(failed.authorityService.diagnostics().activeSubmissions, 0);

  // Cleanup failures never claim success. Local records are discarded, the
  // authority is poisoned, and every future submission is denied fail-closed.
  const revokeFault = createHarness({
    hooks: {
      revokeExact() {
        return { ok: false, revoked: false, reason: 'injected_cleanup_failure' };
      },
    },
  });
  let revokeFaultJobId;
  await revokeFault.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    const created = createJob(revokeFault.coordinator, 'revoke-fault');
    revokeFaultJobId = created.job.id;
    return { ok: true, action: { type: 'write_files', files: [] } };
  }));
  assert.strictEqual(
    revokeFault.coordinator.revokeJob({ jobId: revokeFaultJobId }).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
  );
  assert.strictEqual(revokeFault.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(revokeFault.coordinator.diagnostics().authorityHealthy, false);
  assert.strictEqual(
    (await revokeFault.coordinator.coordinatePlanning(planningInput(
      project('project-a'),
      async () => ({ ok: true }),
    ))).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY,
  );
  assert.strictEqual((await revokeFault.coordinator.coordinatePlanning({
    operation: 'map_message',
    payload: { isMapChat: true },
    kernelId: 'kernel-map',
    invoke: async () => ({ ok: true, response: 'map remains conversation-only' }),
  })).ok, true);

  const clearFault = createHarness({
    hooks: {
      clearAuthority() {
        throw new Error('injected clear failure');
      },
    },
  });
  await clearFault.coordinator.coordinatePlanning(planningInput(project('project-a'), async () => {
    const created = createJob(clearFault.coordinator, 'clear-fault');
    return { ok: created.ok, action: { type: 'write_files', files: [] } };
  }));
  assert.strictEqual(
    clearFault.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
  );
  assert.strictEqual(clearFault.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(clearFault.coordinator.diagnostics().authorityHealthy, false);
  assert.strictEqual(
    clearFault.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY,
  );
  assert.strictEqual(
    (await clearFault.coordinator.coordinatePlanning(planningInput(
      project('project-a'),
      async () => ({ ok: true }),
    ))).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY,
  );

  // The main-owned release barrier is a strict synchronous transaction
  // boundary. A throw, thenable, denial, or over-broad response preserves both
  // the local record and remote authority while poisoning future work.
  const invalidReleaseResults = [
    () => { throw new Error('injected release failure'); },
    () => Promise.resolve({ ok: true }),
    () => ({ ok: false }),
    () => ({ ok: true, extra: 'not allowed' }),
  ];
  for (const [index, invalidRelease] of invalidReleaseResults.entries()) {
    let observedBinding = null;
    const releaseFault = createHarness({
      hooks: {
        beforeAuthorityRelease({ baseAuthorityService, coordinator, input }) {
          assert.deepStrictEqual(Object.keys(input).sort(), [
            'binding',
            'reason',
            'terminalStatus',
          ]);
          assert.strictEqual(Object.isFrozen(input), true);
          assert.strictEqual(Object.isFrozen(input.binding), true);
          assert.strictEqual(coordinator.diagnostics().activeJobs, 1);
          assert.strictEqual(baseAuthorityService.diagnostics().activeSubmissions, 1);
          observedBinding = input.binding;
          return invalidRelease();
        },
      },
    });
    const releaseFaultJobId = await createReadyJob(releaseFault, `release-fault-${index}`);
    const releaseFaultResult = releaseFault.coordinator.onJobTerminal({
      jobId: releaseFaultJobId,
      status: 'cancelled',
    });
    assert.strictEqual(
      releaseFaultResult.code,
      ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
    );
    assert.strictEqual(releaseFault.calls.lifecycleReleases.length, 1);
    assert.strictEqual(releaseFault.calls.lifecycleReleases[0].terminalStatus, 'cancelled');
    assert.strictEqual(releaseFault.calls.lifecycleReleases[0].reason, 'job_terminal');
    assert.strictEqual(releaseFault.calls.authorityRevocations.length, 0);
    assert.strictEqual(releaseFault.calls.revocations.length, 0);
    assert.strictEqual(releaseFault.coordinator.diagnostics().activeJobs, 1);
    assert.strictEqual(releaseFault.coordinator.diagnostics().authorityHealthy, false);
    assert.strictEqual(releaseFault.authorityService.diagnostics().activeSubmissions, 1);
    assert.strictEqual(
      releaseFault.authorityService.authorizeLifecycle(observedBinding).authorized,
      true,
    );
    assert.strictEqual(
      releaseFault.coordinator.onJobTerminal({
        jobId: releaseFaultJobId,
        status: 'cancelled',
      }).code,
      ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY,
    );
  }

  // Clear prepares every record through the release barrier before deleting
  // local state or invoking the authority service. A later preparation failure
  // leaves the complete record set and authority map intact.
  let clearReleaseCount = 0;
  const clearReleaseFault = createHarness({
    hooks: {
      beforeAuthorityRelease() {
        clearReleaseCount += 1;
        return clearReleaseCount === 1 ? { ok: true } : { ok: false };
      },
    },
  });
  await createReadyJob(clearReleaseFault, 'clear-release-fault-a');
  await createReadyJob(clearReleaseFault, 'clear-release-fault-b');
  assert.strictEqual(clearReleaseFault.coordinator.diagnostics().activeJobs, 2);
  assert.strictEqual(
    clearReleaseFault.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
  );
  assert.strictEqual(clearReleaseCount, 2);
  assert.strictEqual(clearReleaseFault.coordinator.diagnostics().activeJobs, 2);
  assert.strictEqual(clearReleaseFault.coordinator.diagnostics().authorityHealthy, false);
  assert.strictEqual(clearReleaseFault.authorityService.diagnostics().activeSubmissions, 2);
  assert.strictEqual(clearReleaseFault.calls.authorityClears.length, 0);
  assert.strictEqual(clearReleaseFault.calls.authorityRevocations.length, 0);
  assert.strictEqual(clearReleaseFault.calls.revocations.length, 0);

  const cancellationRequestFault = createHarness({
    hooks: {
      onCancellationRequested() { return { ok: false }; },
    },
  });
  await createReadyJob(cancellationRequestFault, 'cancellation-request-fault-a');
  await createReadyJob(cancellationRequestFault, 'cancellation-request-fault-b');
  assert.strictEqual(
    cancellationRequestFault.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
  );
  assert.strictEqual(cancellationRequestFault.calls.cancellationRequests.length, 1);
  assert.strictEqual(cancellationRequestFault.calls.lifecycleReleases.length, 0);
  assert.strictEqual(cancellationRequestFault.calls.authorityClears.length, 0);
  assert.strictEqual(cancellationRequestFault.coordinator.diagnostics().activeJobs, 2);

  const cancellationRequestSuccess = createHarness({
    hooks: {
      onCancellationRequested() { return { ok: true }; },
    },
  });
  await createReadyJob(cancellationRequestSuccess, 'cancellation-request-success-a');
  await createReadyJob(cancellationRequestSuccess, 'cancellation-request-success-b');
  assert.deepStrictEqual(
    cancellationRequestSuccess.coordinator.clear(),
    { ok: true, cleared: 2 },
  );
  assert.strictEqual(cancellationRequestSuccess.calls.cancellationRequests.length, 2);
  assert.deepStrictEqual(
    cancellationRequestSuccess.calls.releaseOrder.slice(0, 2).map((entry) => entry.type),
    ['cancellation_requested', 'cancellation_requested'],
  );

  const clearReleaseSuccess = createHarness();
  const clearReleaseSuccessJobA = await createReadyJob(
    clearReleaseSuccess,
    'clear-release-success-a',
  );
  const clearReleaseSuccessJobB = await createReadyJob(
    clearReleaseSuccess,
    'clear-release-success-b',
  );
  assert.deepStrictEqual(clearReleaseSuccess.coordinator.clear(), { ok: true, cleared: 2 });
  assert.deepStrictEqual(
    clearReleaseSuccess.calls.lifecycleReleases.map((release) => release.terminalStatus),
    [null, null],
  );
  assert.deepStrictEqual(clearReleaseSuccess.calls.releaseOrder.map((entry) => entry.type), [
    'release_barrier',
    'release_barrier',
    'legacy_callback',
    'legacy_callback',
    'authority_clear',
    'cleanup_confirmed',
    'cleanup_confirmed',
  ]);
  assert.deepStrictEqual(
    clearReleaseSuccess.calls.cleanupConfirmations.map((proof) => proof.jobId),
    [clearReleaseSuccessJobA, clearReleaseSuccessJobB],
  );
  assert.strictEqual(
    clearReleaseSuccess.calls.releaseOrder.findIndex((entry) => entry.type === 'cleanup_confirmed')
      > clearReleaseSuccess.calls.releaseOrder.findIndex((entry) => entry.type === 'authority_clear'),
    true,
  );
  assert.strictEqual(clearReleaseSuccess.coordinator.diagnostics().activeJobs, 0);

  let refusedClearConfirmationCount = 0;
  const refusedClearConfirmation = createHarness({
    hooks: {
      onExecutionCleanupConfirmed() {
        refusedClearConfirmationCount += 1;
        return { ok: refusedClearConfirmationCount !== 1 };
      },
    },
  });
  await createReadyJob(refusedClearConfirmation, 'refused-clear-confirmation-a');
  await createReadyJob(refusedClearConfirmation, 'refused-clear-confirmation-b');
  assert.strictEqual(
    refusedClearConfirmation.coordinator.clear().code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
  );
  assert.strictEqual(refusedClearConfirmation.calls.authorityClears.length, 1);
  assert.strictEqual(refusedClearConfirmation.calls.cleanupConfirmations.length, 2);
  assert.strictEqual(refusedClearConfirmation.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(refusedClearConfirmation.coordinator.diagnostics().authorityHealthy, false);
  assert.strictEqual(refusedClearConfirmation.coordinator.diagnostics().clearPending, true);

  const interruptedRelease = createHarness();
  const interruptedReleaseJobId = await createReadyJob(
    interruptedRelease,
    'runtime-interrupted-release',
  );
  assert.strictEqual(interruptedRelease.coordinator.onJobTerminal({
    jobId: interruptedReleaseJobId,
    status: 'runtime_interrupted',
  }).revoked, true);
  assert.strictEqual(
    interruptedRelease.calls.lifecycleReleases[0].terminalStatus,
    'runtime_interrupted',
  );

  // Lifecycle callbacks cannot recursively consume the same or another
  // authority record while a release barrier is open.
  let reentrantReleaseJobId;
  const reentrantRelease = createHarness({
    hooks: {
      beforeAuthorityRelease({ coordinator }) {
        const nested = coordinator.revokeJob({ jobId: reentrantReleaseJobId });
        assert.strictEqual(
          nested.code,
          ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
        );
        return { ok: true };
      },
    },
  });
  reentrantReleaseJobId = await createReadyJob(reentrantRelease, 'reentrant-release');
  assert.strictEqual(
    reentrantRelease.coordinator.revokeJob({ jobId: reentrantReleaseJobId }).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED,
  );
  assert.strictEqual(reentrantRelease.coordinator.diagnostics().activeJobs, 1);
  assert.strictEqual(reentrantRelease.coordinator.diagnostics().authorityHealthy, false);
  assert.strictEqual(reentrantRelease.calls.authorityRevocations.length, 0);

  // The barrier remains optional for isolated legacy callers; production can
  // require it at composition time without breaking the coordinator API.
  const legacyReleaseCompatibility = createHarness({
    hooks: { omitBeforeAuthorityRelease: true },
  });
  const legacyReleaseJobId = await createReadyJob(
    legacyReleaseCompatibility,
    'legacy-release-compatibility',
  );
  assert.strictEqual(
    legacyReleaseCompatibility.coordinator.revokeJob({ jobId: legacyReleaseJobId }).revoked,
    true,
  );
  assert.strictEqual(legacyReleaseCompatibility.calls.lifecycleReleases.length, 0);
  assert.strictEqual(legacyReleaseCompatibility.calls.authorityRevocations.length, 1);

  // Retry is main-only and reconstructs the planner payload exclusively from
  // the persisted authority request. A no-action retry remains retained only
  // while the durable job is still explicitly retryable.
  const retryHarness = createHarness();
  const retryJobId = await createRetryWaitingJob(
    retryHarness,
    'retry-authoritative',
    { approvalMode: 'delegate_task' },
  );
  const persistedRetryRequest = retryHarness.jobs.get(retryJobId).request;
  assert.strictEqual(
    (await retryHarness.coordinator.retry({
      jobId: retryJobId,
      kernelId: 'kernel-a',
      invoke: async () => ({ ok: true }),
      userMessage: 'renderer forgery',
    })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT,
  );
  assert.strictEqual(retryHarness.calls.retryEligibilityInspections.length, 1);
  assert.strictEqual(retryHarness.calls.retryAuthorizations.length, 0);

  let retryPayload;
  let projectedRetryJob;
  const retainedRetry = await retryHarness.coordinator.retry({
    jobId: retryJobId,
    kernelId: 'kernel-a',
    invoke: async (payload) => {
      retryPayload = payload;
      projectedRetryJob = retryHarness.coordinator.createPlanningJob({
        userMessage: 'planner-forged-message',
        attachments: [{ name: 'forged.txt', type: 'text/plain', size: 1, path: '/tmp/forged.txt' }],
        jobId: retryJobId,
        projectId: 'project-a',
        rootPath: '/workspace/project-a',
      });
      retryHarness.jobs.get(retryJobId).status = 'retry_pending';
      retryHarness.jobs.get(retryJobId).retryState = { retryable: true };
      return {
        ok: true,
        jobId: 'job-forged',
        response: 'retry again',
        authorityContext: { hidden: true },
        nested: { submissionDigest: `sha256:${'1'.repeat(64)}`, visible: true },
      };
    },
  });
  assert.strictEqual(retainedRetry.ok, true);
  assert.strictEqual(retainedRetry.jobId, retryJobId);
  assert.strictEqual(Object.hasOwn(retainedRetry, 'authorityContext'), false);
  assert.deepStrictEqual(retainedRetry.nested, { visible: true });
  assert.deepStrictEqual(retryPayload, {
    projectInfo: {
      id: 'project-a',
      projectId: 'project-a',
      rootPath: '/workspace/project-a',
      name: 'Project project-a',
    },
    userMessage: persistedRetryRequest.userMessage,
    attachments: persistedRetryRequest.attachments,
    jobId: retryJobId,
  });
  assert.strictEqual(Object.hasOwn(retryPayload, 'approvalMode'), false);
  assert.strictEqual(Object.hasOwn(retryPayload, 'requestedMode'), false);
  assert.strictEqual(projectedRetryJob.ok, true);
  assert.strictEqual(projectedRetryJob.reused, true);
  assert.strictEqual(projectedRetryJob.idempotent, true);
  assert.strictEqual(projectedRetryJob.job.id, retryJobId);
  assert.strictEqual(retryHarness.jobs.size, 1);
  assert.strictEqual(retryHarness.coordinator.diagnostics().activeJobs, 1);

  let finalRetryPayload;
  const finalRetry = await retryHarness.coordinator.retry({
    jobId: retryJobId,
    kernelId: 'kernel-a',
    invoke: async (payload) => {
      finalRetryPayload = payload;
      const projected = retryHarness.coordinator.createPlanningJob({
        requestedJobId: retryJobId,
        userMessage: 'ignored internal message',
      });
      assert.strictEqual(projected.job.id, retryJobId);
      retryHarness.jobs.get(retryJobId).status = 'running';
      retryHarness.jobs.get(retryJobId).phase = 'awaiting_user_confirmation';
      return {
        ok: true,
        jobId: 'job-attacker',
        approvalMode: 'ask_each',
        requestedMode: 'ask_each',
        meta: { approvalMode: 'ask_each', requestedMode: 'ask_each' },
        response: 'ready',
        action: {
          type: 'write_files',
          jobId: 'job-attacker',
          rootPath: '/workspace/attacker',
          root_path: '/workspace/attacker',
          files: [{ path: 'src/retry.js', content: 'ready' }],
          executionCommand: {
            protocol: 'faber-exec-v2',
            task_type: 'apply_file_patch',
            root_path: '/workspace/attacker',
          },
        },
        binding: { hidden: true },
      };
    },
  });
  assert.strictEqual(finalRetry.ok, true);
  assert.strictEqual(finalRetry.jobId, retryJobId);
  assert.strictEqual(Object.hasOwn(finalRetry, 'binding'), false);
  assert.strictEqual(Object.hasOwn(finalRetry, 'approvalMode'), false);
  assert.strictEqual(Object.hasOwn(finalRetry, 'requestedMode'), false);
  assert.deepStrictEqual(finalRetry.meta, {});
  assert.strictEqual(finalRetry.action.rootPath, '/workspace/project-a');
  assert.strictEqual(finalRetry.action.executionCommand.root_path, '/workspace/project-a');
  assert.strictEqual(Object.hasOwn(finalRetry.action, 'jobId'), false);
  assert.deepStrictEqual(finalRetryPayload, retryPayload);
  const finalExecution = await retryHarness.coordinator.execute({ jobId: retryJobId });
  assert.strictEqual(finalExecution.ok, true);
  assert.strictEqual(retryHarness.calls.executions.length, 1);
  assert.strictEqual(retryHarness.calls.executions[0].action.files[0].path, 'src/retry.js');
  assert.strictEqual(retryHarness.calls.executions[0].context.requestedMode, 'delegate_task');

  const pausedRetry = createHarness();
  const pausedRetryJobId = await createRetryWaitingJob(
    pausedRetry,
    'retry-paused',
    { status: 'paused_memory_pressure', phase: 'paused_memory_pressure' },
  );
  const pausedRetryResult = await pausedRetry.coordinator.retry({
    jobId: pausedRetryJobId,
    kernelId: 'kernel-a',
    invoke: async () => ({
      ok: true,
      action: { type: 'write_files', files: [{ path: 'src/resumed.js', content: 'ok' }] },
    }),
  });
  assert.strictEqual(pausedRetryResult.ok, true);
  assert.strictEqual(pausedRetryResult.jobId, pausedRetryJobId);

  // Only one retry may plan at a time. Revocation while invoke is pending
  // fences the stale result and prevents a later action from becoming ready.
  const retryRace = createHarness();
  const retryRaceJobId = await createRetryWaitingJob(retryRace, 'retry-race');
  const retryRaceGate = deferred();
  let retryInvocations = 0;
  const firstRetry = retryRace.coordinator.retry({
    jobId: retryRaceJobId,
    kernelId: 'kernel-a',
    invoke: async () => {
      retryInvocations += 1;
      await retryRaceGate.promise;
      return { ok: true, action: { type: 'write_files', files: [] } };
    },
  });
  await Promise.resolve();
  assert.strictEqual(
    (await retryRace.coordinator.retry({
      jobId: retryRaceJobId,
      kernelId: 'kernel-a',
      invoke: async () => {
        retryInvocations += 1;
        return { ok: true };
      },
    })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_ALREADY_STARTED,
  );
  assert.strictEqual(retryInvocations, 1);
  assert.strictEqual(retryRace.coordinator.revokeJob({ jobId: retryRaceJobId }).revoked, true);
  retryRaceGate.resolve();
  assert.strictEqual((await firstRetry).code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
  assert.strictEqual(retryRace.coordinator.diagnostics().activeJobs, 0);

  const terminalRetry = createHarness();
  const terminalRetryJobId = await createRetryWaitingJob(terminalRetry, 'retry-terminal');
  const terminalRetryGate = deferred();
  const terminalRetryResult = terminalRetry.coordinator.retry({
    jobId: terminalRetryJobId,
    kernelId: 'kernel-a',
    invoke: async () => {
      await terminalRetryGate.promise;
      return { ok: true, action: { type: 'write_files', files: [] } };
    },
  });
  await Promise.resolve();
  assert.strictEqual(
    terminalRetry.coordinator.onJobTerminal({
      jobId: terminalRetryJobId,
      status: 'cancelled',
    }).revoked,
    true,
  );
  terminalRetryGate.resolve();
  assert.strictEqual(
    (await terminalRetryResult).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
  );
  assert.strictEqual(terminalRetry.coordinator.diagnostics().activeJobs, 0);

  const notDueRetry = createHarness();
  const notDueRetryJobId = await createRetryWaitingJob(
    notDueRetry,
    'retry-not-due',
    { nextRetryAt: '2099-01-01T00:00:00.000Z' },
  );
  assert.strictEqual(notDueRetry.calls.retryEligibilityInspections.length, 1);
  assert.strictEqual(notDueRetry.calls.retryAuthorizations.length, 0);
  let notDueInvocations = 0;
  assert.strictEqual(
    (await notDueRetry.coordinator.retry({
      jobId: notDueRetryJobId,
      kernelId: 'kernel-a',
      invoke: async () => { notDueInvocations += 1; },
    })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_DUE,
  );
  assert.strictEqual(notDueInvocations, 0);
  assert.strictEqual(notDueRetry.coordinator.diagnostics().activeJobs, 1);
  notDueRetry.jobs.get(notDueRetryJobId).retryState.nextRetryAt = null;
  const nowDueRetry = await notDueRetry.coordinator.retry({
    jobId: notDueRetryJobId,
    kernelId: 'kernel-a',
    invoke: async () => {
      notDueInvocations += 1;
      notDueRetry.jobs.get(notDueRetryJobId).status = 'running';
      notDueRetry.jobs.get(notDueRetryJobId).phase = 'awaiting_user_confirmation';
      return { ok: true, action: { type: 'write_files', files: [] } };
    },
  });
  assert.strictEqual(nowDueRetry.ok, true);
  assert.strictEqual(notDueInvocations, 1);

  // A wrong kernel or a denial from the authoritative retry service invokes
  // no planner and destroys unusable local authority fail-closed.
  let denySubsequentRetry = false;
  const deniedRetry = createHarness({
    hooks: {
      onAuthorizeRetry() {
        return denySubsequentRetry
          ? { authorized: false, reason: 'next_retry_not_reached' }
          : undefined;
      },
    },
  });
  const deniedRetryJobId = await createRetryWaitingJob(deniedRetry, 'retry-denied');
  denySubsequentRetry = true;
  let deniedRetryInvocations = 0;
  assert.strictEqual(
    (await deniedRetry.coordinator.retry({
      jobId: deniedRetryJobId,
      kernelId: 'kernel-attacker',
      invoke: async () => { deniedRetryInvocations += 1; },
    })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED,
  );
  assert.strictEqual(deniedRetryInvocations, 0);
  assert.strictEqual(
    (await deniedRetry.coordinator.retry({
      jobId: deniedRetryJobId,
      kernelId: 'kernel-a',
      invoke: async () => { deniedRetryInvocations += 1; },
    })).code,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED,
  );
  assert.strictEqual(deniedRetryInvocations, 0);
  assert.strictEqual(deniedRetry.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(deniedRetry.calls.lifecycleReleases.length, 1);
  assert.strictEqual(deniedRetry.calls.lifecycleReleases[0].terminalStatus, null);
  assert.strictEqual(
    deniedRetry.calls.lifecycleReleases[0].reason,
    ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED,
  );

  console.log('assistant-execution-coordinator.test.js: all checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
