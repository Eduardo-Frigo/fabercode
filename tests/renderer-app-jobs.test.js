const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app_jobs.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness(retryJob, options = {}) {
  const scheduledTimeouts = [];
  const scheduledIntervals = [];
  const sandbox = {
    clearInterval: () => {},
    clearTimeout: () => {},
    console,
    setInterval: (callback) => {
      scheduledIntervals.push(callback);
      return { type: 'interval', index: scheduledIntervals.length - 1 };
    },
    setTimeout: (callback) => {
      scheduledTimeouts.push(callback);
      return { type: 'timeout', index: scheduledTimeouts.length - 1 };
    },
    window: {},
  };
  vm.runInNewContext(source, sandbox, { filename: 'renderer/app_jobs.js' });
  const calls = {
    appendMessage: [],
    buildPlan: [],
    cancelJob: [],
    getJob: [],
    listJobs: [],
    contractPreviews: [],
    retryJob: [],
    showPending: [],
    startRender: [],
  };
  const state = {
    activeJobId: null,
    autoRetryInFlightByJob: {},
    autoRetryLastRunByJob: {},
    jobPollingTimer: null,
    jobTerminalNoticeById: {},
    lastInterimPlanSignatureByJob: {},
    pendingAction: null,
    pendingActionJobId: null,
    selectedProjectId: 'project-1',
    selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/project' },
  };
  const api = {
    buildPlan: async (payload) => {
      calls.buildPlan.push(payload);
      throw new Error('legacy planner retry must not run');
    },
    cancelJob: async (payload) => {
      calls.cancelJob.push(payload);
      return options.cancelJob ? options.cancelJob(payload) : { ok: true };
    },
    getJob: async (payload) => {
      calls.getJob.push(payload);
      return options.getJob ? options.getJob(payload) : { ok: false };
    },
    listJobs: async (payload) => {
      calls.listJobs.push(payload);
      return options.listJobs ? options.listJobs(payload) : { ok: true, jobs: [] };
    },
    retryJob: async (payload) => {
      calls.retryJob.push(payload);
      return retryJob(payload);
    },
  };
  const controller = sandbox.window.FaberAppJobs.createAppJobController({
    api,
    automataContractsController: {
      appendContractPreview: (value) => calls.contractPreviews.push(value),
    },
    callbacks: {
      appendMessage: (...args) => calls.appendMessage.push(args),
      buildJobContextForPersona: () => null,
      getActiveConversationId: options.getActiveConversationId || (() => 'conversation-1'),
      getSubmissionEpoch: options.getSubmissionEpoch || (() => 0),
      hidePersonaThinkingIndicator: () => {},
      showPending: (text, action) => {
        calls.showPending.push({ text, action });
        state.pendingAction = action;
      },
      showPersonaThinkingIndicator: () => null,
      updateStatus: () => {},
    },
    jobProgressController: {
      hide: () => {},
      render: (job) => calls.startRender.push(job),
    },
    state,
  });
  return { calls, controller, scheduledIntervals, scheduledTimeouts, state };
}

async function run() {
  const retry = deferred();
  const harness = createHarness(() => retry.promise);
  const retryJob = {
    id: 'job-retry-1',
    rootPath: '/workspace/project',
    retryState: { retryable: true, nextRetryAt: new Date(0).toISOString() },
    status: 'retry_pending',
  };
  Object.defineProperty(retryJob, 'request', {
    enumerable: true,
    get() {
      throw new Error('renderer must not reconstruct retry request');
    },
  });

  const firstRetry = harness.controller.maybeAutoRetryPendingJob(retryJob);
  const duplicateRetry = harness.controller.maybeAutoRetryPendingJob(retryJob);
  await duplicateRetry;
  assert.strictEqual(JSON.stringify(harness.calls.retryJob), JSON.stringify([{ jobId: 'job-retry-1' }]));
  assert.strictEqual(harness.calls.buildPlan.length, 0);

  const action = { rootPath: '/workspace/project', targetFile: 'src/retry.js' };
  retry.resolve({ ok: true, jobId: 'job-retry-1', action, meta: { autoExecute: true } });
  await firstRetry;
  assert.strictEqual(harness.state.pendingAction, action);
  assert.strictEqual(harness.state.pendingActionJobId, 'job-retry-1');

  const confusedDeputy = createHarness(async () => ({
    ok: true,
    jobId: 'different-job',
    action: { rootPath: '/workspace/project' },
  }));
  await confusedDeputy.controller.maybeAutoRetryPendingJob({
    id: 'job-retry-2',
    rootPath: '/workspace/project',
    retryState: { retryable: true },
    status: 'retry_pending',
  });
  assert.strictEqual(
    JSON.stringify(confusedDeputy.calls.retryJob),
    JSON.stringify([{ jobId: 'job-retry-2' }])
  );
  assert.strictEqual(confusedDeputy.calls.showPending.length, 0);
  assert.strictEqual(confusedDeputy.state.pendingActionJobId, null);
  assert.strictEqual(confusedDeputy.calls.appendMessage.length, 0);
  assert.strictEqual(confusedDeputy.calls.contractPreviews.length, 0);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(confusedDeputy.calls.cancelJob)),
    [{ jobId: 'different-job' }],
    'a mismatched retry job must be revoked best-effort',
  );

  const invalid = createHarness(async () => ({ ok: true }));
  await invalid.controller.maybeAutoRetryPendingJob({
    id: '',
    rootPath: '/workspace/project',
    status: 'retry_pending',
  });
  assert.strictEqual(invalid.calls.retryJob.length, 0);

  {
    let conversationId = 'conversation-1';
    const staleRetryGate = deferred();
    const staleRetry = createHarness(
      () => staleRetryGate.promise,
      {
        getActiveConversationId: () => conversationId,
      },
    );
    staleRetry.state.activeJobId = 'job-stale-retry';
    const retryPromise = staleRetry.controller.maybeAutoRetryPendingJob({
      id: 'job-stale-retry',
      projectId: 'project-1',
      rootPath: '/workspace/project',
      request: { userMessage: 'old request' },
      retryState: { retryable: true },
      status: 'retry_pending',
    });
    await Promise.resolve();
    conversationId = 'conversation-2';
    staleRetry.state.selectedProjectId = 'project-2';
    staleRetry.state.selectedProjectInfo = { id: 'project-2', rootPath: '/workspace/other' };
    staleRetry.state.activeJobId = null;
    staleRetryGate.resolve({
      ok: true,
      jobId: 'job-stale-retry',
      response: 'old response',
      action: { rootPath: '/workspace/project', targetFile: 'src/old.js' },
    });
    await retryPromise;
    assert.strictEqual(staleRetry.calls.showPending.length, 0);
    assert.strictEqual(staleRetry.calls.startRender.length, 0);
    assert.strictEqual(staleRetry.calls.appendMessage.length, 0);
    assert.strictEqual(staleRetry.state.pendingActionJobId, null);
    assert.strictEqual(staleRetry.state.activeJobId, null);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(staleRetry.calls.cancelJob)),
      [{ jobId: 'job-stale-retry' }],
    );
  }

  {
    const confusedPoll = createHarness(
      async () => ({ ok: false }),
      {
        getJob: async () => ({
          ok: true,
          job: {
            id: 'job-response-b',
            projectId: 'project-2',
            rootPath: '/workspace/other',
            status: 'completed',
          },
        }),
      },
    );
    confusedPoll.state.activeJobId = 'job-request-a';
    assert.strictEqual(await confusedPoll.controller.pollJob('job-request-a'), null);
    assert.strictEqual(confusedPoll.state.activeJobId, 'job-request-a');
    assert.strictEqual(confusedPoll.calls.startRender.length, 0);
    assert.strictEqual(confusedPoll.calls.appendMessage.length, 0);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(confusedPoll.calls.cancelJob)),
      [{ jobId: 'job-response-b' }],
    );
  }

  {
    let unrelatedSubmissionEpoch = 0;
    const stableJobGate = deferred();
    let jobReads = 0;
    const stableJob = createHarness(
      () => stableJobGate.promise,
      {
        cancelJob: async () => ({ ok: false }),
        getSubmissionEpoch: () => unrelatedSubmissionEpoch,
        getJob: async () => {
          jobReads += 1;
          return {
            ok: true,
            job: {
              id: 'job-stays-live',
              projectId: 'project-1',
              rootPath: '/workspace/project',
              status: 'running',
            },
          };
        },
      },
    );
    stableJob.state.activeJobId = 'job-stays-live';
    stableJob.state.jobPollingTimer = { type: 'interval' };
    const retryPromise = stableJob.controller.maybeAutoRetryPendingJob({
      id: 'job-stays-live',
      projectId: 'project-1',
      rootPath: '/workspace/project',
      retryState: { retryable: true },
      status: 'retry_pending',
    });
    await Promise.resolve();
    unrelatedSubmissionEpoch += 1;
    stableJobGate.resolve({ ok: true, jobId: 'job-stays-live' });
    await retryPromise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(stableJob.state.activeJobId, 'job-stays-live');
    assert.strictEqual(stableJob.calls.cancelJob.length, 0);
    assert.strictEqual(stableJob.scheduledIntervals.length, 1);
    const rendersBeforeTick = stableJob.calls.startRender.length;

    unrelatedSubmissionEpoch += 1;
    stableJob.scheduledIntervals[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(jobReads, 2, 'unrelated submission invalidation must not stop job polling');
    assert.strictEqual(stableJob.state.activeJobId, 'job-stays-live');
    assert.strictEqual(stableJob.calls.cancelJob.length, 0);
    assert.strictEqual(
      stableJob.calls.startRender.length,
      rendersBeforeTick + 1,
      'the valid job must keep rendering after an unrelated UI invalidation',
    );
  }

  {
    const stalePollGate = deferred();
    const stalePoll = createHarness(
      async () => ({ ok: false }),
      {
        getJob: () => stalePollGate.promise,
      },
    );
    stalePoll.state.activeJobId = 'job-stale-poll';
    const pollPromise = stalePoll.controller.pollJob('job-stale-poll');
    await Promise.resolve();
    stalePoll.state.selectedProjectId = 'project-2';
    stalePoll.state.selectedProjectInfo = { id: 'project-2', rootPath: '/workspace/other' };
    stalePoll.state.activeJobId = null;
    stalePollGate.resolve({
      ok: true,
      job: {
        id: 'job-stale-poll',
        projectId: 'project-1',
        rootPath: '/workspace/project',
        status: 'running',
      },
    });
    assert.strictEqual(await pollPromise, null);
    assert.strictEqual(stalePoll.calls.startRender.length, 0);
    assert.strictEqual(stalePoll.state.lastJobContext, undefined);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(stalePoll.calls.cancelJob)),
      [{ jobId: 'job-stale-poll' }],
    );
  }


  {
    const stoppedListGate = deferred();
    const stoppedWatch = createHarness(
      async () => ({ ok: false }),
      { listJobs: () => stoppedListGate.promise },
    );
    const stopWatching = stoppedWatch.controller.watchLatestProjectJob({
      projectId: 'project-1',
      rootPath: '/workspace/project',
      userMessage: 'live request',
    });
    const tickPromise = stoppedWatch.scheduledTimeouts[0]();
    await Promise.resolve();
    stopWatching();
    stoppedWatch.controller.startJobPolling('job-live');
    stoppedListGate.resolve({
      ok: true,
      jobs: [{
        id: 'job-live',
        projectId: 'project-1',
        rootPath: '/workspace/project',
        request: { userMessage: 'live request' },
        status: 'running',
      }],
    });
    await tickPromise;
    assert.strictEqual(stoppedWatch.state.activeJobId, 'job-live');
    assert.strictEqual(stoppedWatch.calls.cancelJob.length, 0);
  }

  {
    let submissionEpoch = 4;
    const uiModeListGate = deferred();
    const uiModeWatch = createHarness(
      async () => ({ ok: false }),
      {
        getSubmissionEpoch: () => submissionEpoch,
        listJobs: () => uiModeListGate.promise,
      },
    );
    uiModeWatch.controller.watchLatestProjectJob({
      projectId: 'project-1',
      rootPath: '/workspace/project',
      userMessage: 'mode-bound request',
    });
    const tickPromise = uiModeWatch.scheduledTimeouts[0]();
    await Promise.resolve();
    submissionEpoch += 1;
    uiModeListGate.resolve({
      ok: true,
      jobs: [{
        id: 'job-old-ui-mode',
        projectId: 'project-1',
        rootPath: '/workspace/project',
        request: { userMessage: 'mode-bound request' },
        status: 'running',
      }],
    });
    await tickPromise;
    assert.strictEqual(uiModeWatch.state.activeJobId, null);
    assert.strictEqual(uiModeWatch.calls.startRender.length, 0);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(uiModeWatch.calls.cancelJob)),
      [{ jobId: 'job-old-ui-mode' }],
    );
  }

  {
    let submissionEpoch = 9;
    const accountListGate = deferred();
    const accountWatch = createHarness(
      async () => ({ ok: false }),
      {
        getSubmissionEpoch: () => submissionEpoch,
        listJobs: () => accountListGate.promise,
      },
    );
    accountWatch.controller.watchLatestProjectJob({
      projectId: 'project-1',
      rootPath: '/workspace/project',
      userMessage: 'account-bound request',
    });
    const tickPromise = accountWatch.scheduledTimeouts[0]();
    await Promise.resolve();
    submissionEpoch += 1;
    accountListGate.resolve({
      ok: true,
      jobs: [{
        id: 'job-old-account',
        projectId: 'project-1',
        rootPath: '/workspace/project',
        request: { userMessage: 'account-bound request' },
        status: 'retry_pending',
      }],
    });
    await tickPromise;
    assert.strictEqual(accountWatch.state.activeJobId, null);
    assert.strictEqual(accountWatch.calls.startRender.length, 0);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(accountWatch.calls.cancelJob)),
      [{ jobId: 'job-old-account' }],
    );
  }

  {
    const staleListGate = deferred();
    const staleWatch = createHarness(
      async () => ({ ok: false }),
      {
        listJobs: () => staleListGate.promise,
      },
    );
    staleWatch.controller.watchLatestProjectJob({
      projectId: 'project-1',
      rootPath: '/workspace/project',
      userMessage: 'old request',
    });
    assert.strictEqual(staleWatch.scheduledTimeouts.length, 1);
    const tickPromise = staleWatch.scheduledTimeouts[0]();
    await Promise.resolve();
    staleWatch.state.selectedProjectId = 'project-2';
    staleWatch.state.selectedProjectInfo = { id: 'project-2', rootPath: '/workspace/other' };
    staleListGate.resolve({
      ok: true,
      jobs: [{
        id: 'job-stale-watch',
        projectId: 'project-1',
        rootPath: '/workspace/project',
        request: { userMessage: 'old request' },
        status: 'running',
      }],
    });
    await tickPromise;
    assert.strictEqual(staleWatch.state.activeJobId, null);
    assert.strictEqual(staleWatch.calls.startRender.length, 0);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(staleWatch.calls.cancelJob)),
      [{ jobId: 'job-stale-watch' }],
    );
  }

  assert.strictEqual(source.includes('api.buildPlan'), false);
  assert.strictEqual(source.includes('personaApprovedExecution'), false);
  assert.strictEqual(source.includes('personaRouteDecision'), false);
  console.log('renderer-app-jobs.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
