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

function createHarness(retryJob) {
  const sandbox = {
    clearInterval: () => {},
    clearTimeout: () => {},
    console,
    setInterval: () => ({ type: 'interval' }),
    setTimeout: () => ({ type: 'timeout' }),
    window: {},
  };
  vm.runInNewContext(source, sandbox, { filename: 'renderer/app_jobs.js' });
  const calls = { buildPlan: [], retryJob: [], showPending: [], startRender: [] };
  const state = {
    activeJobId: null,
    autoRetryInFlightByJob: {},
    autoRetryLastRunByJob: {},
    jobPollingTimer: null,
    jobTerminalNoticeById: {},
    lastInterimPlanSignatureByJob: {},
    pendingAction: null,
    pendingActionJobId: null,
    selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/project' },
  };
  const api = {
    buildPlan: async (payload) => {
      calls.buildPlan.push(payload);
      throw new Error('legacy planner retry must not run');
    },
    getJob: async () => ({ ok: false }),
    retryJob: async (payload) => {
      calls.retryJob.push(payload);
      return retryJob(payload);
    },
  };
  const controller = sandbox.window.FaberAppJobs.createAppJobController({
    api,
    callbacks: {
      appendMessage: () => {},
      buildJobContextForPersona: () => null,
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
  return { calls, controller, state };
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

  const invalid = createHarness(async () => ({ ok: true }));
  await invalid.controller.maybeAutoRetryPendingJob({
    id: '',
    rootPath: '/workspace/project',
    status: 'retry_pending',
  });
  assert.strictEqual(invalid.calls.retryJob.length, 0);

  assert.strictEqual(source.includes('api.buildPlan'), false);
  assert.strictEqual(source.includes('personaApprovedExecution'), false);
  assert.strictEqual(source.includes('personaRouteDecision'), false);
  console.log('renderer-app-jobs.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
