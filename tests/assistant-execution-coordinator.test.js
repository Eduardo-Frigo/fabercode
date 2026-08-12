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
  hooks = {},
} = {}) {
  const jobs = new Map();
  const calls = {
    actionDigests: [],
    boundActions: [],
    executions: [],
    failures: [],
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
      if (typeof hooks.revokeExact === 'function') {
        return hooks.revokeExact({ baseAuthorityService, coordinator, input });
      }
      return baseAuthorityService.revokeExact(input);
    },
    clear() {
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
      authorityContext: { mustNotLeak: true },
    };
  };

  coordinator = createAssistantExecutionCoordinator({
    authorityService,
    bindActionToProject,
    bindJobActionDigest,
    createActionDigest: digestAction,
    createAuthorizedAssistantJob,
    executeAction: executeOverride || defaultExecute,
    maxActiveJobs,
    onAuthorityRevoked(jobId, reason) {
      calls.revocations.push({ jobId, reason });
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
      requestedMode: 'ask_each',
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

async function createRetryWaitingJob(
  harness,
  suffix = 'retry',
  { status = 'retry_pending', phase = 'persona_plan', nextRetryAt = null } = {},
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
  ));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.jobId, jobId);
  assert.strictEqual(Object.hasOwn(result, 'authorityContext'), false);
  assert.deepStrictEqual(result.nested, { safe: 'visible' });
  assert.strictEqual(harness.coordinator.diagnostics().activeJobs, 1);
  return jobId;
}

async function run() {
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
      requestedMode: 'delegate_task',
      approvalMode: 'delegate_task',
      jobId: 'job-input-forged',
      submissionId: 'submission-input-forged',
    },
  ));
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.jobId, createdJobId);
  assert.strictEqual(Object.hasOwn(plan, 'submissionId'), false);
  assert.strictEqual(Object.hasOwn(plan, 'authorityContext'), false);
  assert.strictEqual(Object.hasOwn(plan.meta, 'autoExecute'), false);
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
  assert.strictEqual(concurrent.coordinator.onJobTerminal({ jobId: resultB.jobId, status: 'failed' }).revoked, true);
  assert.strictEqual(concurrent.coordinator.diagnostics().activeJobs, 0);

  // Map chat is conversation-only: it needs no project binding and can never
  // manufacture a job or return an executable action.
  const map = createHarness();
  let mapCreateResult;
  const mapMessage = await map.coordinator.coordinatePlanning({
    operation: 'map_message',
    payload: { isMapChat: true },
    kernelId: 'kernel-map',
    invoke: async () => {
      mapCreateResult = createJob(map.coordinator, 'map');
      return { ok: true, jobId: 'job-forged', response: 'Mapa analisado.' };
    },
  });
  assert.strictEqual(mapCreateResult.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.MAP_JOB_FORBIDDEN);
  assert.strictEqual(mapMessage.ok, true);
  assert.strictEqual(mapMessage.response, 'Mapa analisado.');
  assert.strictEqual(Object.hasOwn(mapMessage, 'jobId'), false);
  assert.strictEqual(map.coordinator.diagnostics().activeJobs, 0);
  assert.strictEqual(map.authorityService.diagnostics().activeSubmissions, 0);
  const mapAction = await map.coordinator.coordinatePlanning({
    operation: 'message',
    payload: { isMapChat: true, projectInfo: { rootPath: '/workspace/root-only' } },
    kernelId: 'kernel-map',
    invoke: async () => ({ ok: true, action: { type: 'write_files' } }),
  });
  assert.strictEqual(mapAction.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.MAP_ACTION_FORBIDDEN);

  // A second execute cannot enter while the first is in flight. Revocation
  // during that flight blocks the stale output and every replay.
  const executionGate = deferred();
  let executionStarted = 0;
  let executionEffects = 0;
  let racedSignal = null;
  const raced = createHarness({
    async executeAction(action, projectInfo, context) {
      executionStarted += 1;
      racedSignal = context.signal;
      await executionGate.promise;
      if (context.signal.aborted) throw new Error('aborted before effect');
      executionEffects += 1;
      return { ok: true, stale: true };
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

  const conflictingMode = await basic.coordinator.coordinatePlanning(planningInput(
    project('project-a'),
    async () => ({ ok: true }),
    { requestedMode: 'ask_each', approvalMode: 'delegate_task' },
  ));
  assert.strictEqual(conflictingMode.code, ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);

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

  // Retry is main-only and reconstructs the planner payload exclusively from
  // the persisted authority request. A no-action retry remains retained only
  // while the durable job is still explicitly retryable.
  const retryHarness = createHarness();
  const retryJobId = await createRetryWaitingJob(retryHarness, 'retry-authoritative');
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
    requestedMode: 'ask_each',
    jobId: retryJobId,
  });
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
  assert.strictEqual(finalRetry.action.rootPath, '/workspace/project-a');
  assert.strictEqual(finalRetry.action.executionCommand.root_path, '/workspace/project-a');
  assert.strictEqual(Object.hasOwn(finalRetry.action, 'jobId'), false);
  assert.deepStrictEqual(finalRetryPayload, retryPayload);
  const finalExecution = await retryHarness.coordinator.execute({ jobId: retryJobId });
  assert.strictEqual(finalExecution.ok, true);
  assert.strictEqual(retryHarness.calls.executions.length, 1);
  assert.strictEqual(retryHarness.calls.executions[0].action.files[0].path, 'src/retry.js');

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

  console.log('assistant-execution-coordinator.test.js: all checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
