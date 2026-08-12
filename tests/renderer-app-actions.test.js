const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app_actions.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function loadModule() {
  const sandbox = {
    console,
    document: {
      body: { classList: { contains: () => false } },
      getElementById: () => null,
    },
    window: {},
  };
  vm.runInNewContext(source, sandbox, { filename: 'renderer/app_actions.js' });
  return sandbox.window.FaberAppActions;
}

function createHarness({ cancelJob, executePlan, plan } = {}) {
  const moduleApi = loadModule();
  const calls = {
    appendMessage: [],
    cancelJob: [],
    clearPending: 0,
    executePlan: [],
    learnWithCortex: [],
    sendAssistantMessage: [],
    showPending: [],
    startJobPolling: [],
    prepareNewConversation: 0,
  };
  const state = {
    activeJobId: null,
    attachments: [],
    cortexLearningByProject: {},
    knowledgeRuntimeStatusByProject: {},
    lastAssistantMeta: null,
    lastJobContext: null,
    lastQualityReport: null,
    nextSteps: [],
    pendingAction: null,
    pendingActionJobId: null,
    selectedProjectId: 'project-1',
    selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/project' },
    uiMode: 'default',
  };
  const inputEl = { value: 'Implemente a mudança' };
  const api = {
    appendAuditEvent: async () => ({ ok: true }),
    cancelJob: async (payload) => {
      calls.cancelJob.push(payload);
      return cancelJob
        ? cancelJob(payload)
        : { ok: true, job: { id: payload.jobId, status: 'cancelled' } };
    },
    executePlan: async (payload) => {
      calls.executePlan.push(payload);
      return executePlan ? executePlan(payload) : { ok: true, modifiedFiles: [] };
    },
    learnWithCortex: async (payload) => {
      calls.learnWithCortex.push(payload);
      return { ok: true, learning: {}, message: 'Memória atualizada.' };
    },
    sendAssistantMessage: async (payload) => {
      calls.sendAssistantMessage.push(payload);
      return plan;
    },
  };
  const controller = moduleApi.createAppActionsController({
    api,
    callbacks: {
      appendMessage: (...args) => calls.appendMessage.push(args),
      clearPending: () => {
        calls.clearPending += 1;
        state.pendingAction = null;
      },
      ensureActiveConversationForSend: async () => null,
      ensureSelectedProjectInfoReady: async () => true,
      getRecentConversationMessagesForPersona: () => [],
      hidePersonaThinkingIndicator: () => {},
      pollJob: async () => null,
      prepareNewConversationForProject: async () => {
        calls.prepareNewConversation += 1;
      },
      renderAttachments: () => {},
      renderNextSteps: () => {},
      resetTextareaHeight: () => {},
      showPending: (text, action) => {
        calls.showPending.push({ text, action });
        state.pendingAction = action;
      },
      showPersonaThinkingIndicator: () => null,
      startJobPolling: (jobId) => calls.startJobPolling.push(jobId),
      stopJobPolling: () => {},
      updateStatus: () => {},
      watchLatestProjectJob: () => () => {},
    },
    elements: { inputEl },
    formatters: {
      buildExecutionOutcomeAssistantMessage: () => '',
      isManualRetryMessage: () => false,
      shouldSuppressInterimAssistantPlanMessage: () => false,
    },
    state,
  });
  return { api, calls, controller, inputEl, state };
}

async function run() {
  const execution = deferred();
  let executionCount = 0;
  const firstAction = {
    jobId: 'model-controlled-job-id',
    rootPath: '/workspace/project',
    targetFile: 'src/app.js',
    type: 'implement',
  };
  const harness = createHarness({
    executePlan: () => {
      executionCount += 1;
      if (executionCount === 1) return execution.promise;
      return { ok: true, modifiedFiles: [] };
    },
    plan: {
      ok: true,
      jobId: 'job-authorized-1',
      action: firstAction,
      meta: { autoExecute: true },
      response: 'Plano pronto.',
    },
  });

  await harness.controller.onSend();
  assert.strictEqual(harness.calls.executePlan.length, 0, 'model autoExecute must never execute');
  assert.strictEqual(harness.state.pendingAction, firstAction);
  assert.strictEqual(harness.state.pendingActionJobId, 'job-authorized-1');

  const sendGate = deferred();
  const doubleSend = createHarness({ plan: sendGate.promise });
  const firstSend = doubleSend.controller.onSend();
  for (let attempt = 0; attempt < 12 && doubleSend.calls.sendAssistantMessage.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  doubleSend.inputEl.value = 'Segunda submissão concorrente';
  await doubleSend.controller.onSend();
  assert.strictEqual(doubleSend.calls.sendAssistantMessage.length, 1, 'double send must create one planning request');
  sendGate.resolve({ ok: true, response: 'Sem ação.' });
  await firstSend;

  const firstConfirmation = harness.controller.onConfirm();
  const duplicateConfirmation = harness.controller.onConfirm();
  await duplicateConfirmation;
  assert.strictEqual(JSON.stringify(harness.calls.executePlan), JSON.stringify([{ jobId: 'job-authorized-1' }]));

  const replacementAction = { rootPath: '/workspace/project', targetFile: 'src/new.js' };
  harness.state.pendingAction = replacementAction;
  harness.state.pendingActionJobId = 'job-authorized-2';
  execution.resolve({ ok: true, modifiedFiles: ['src/app.js'] });
  await firstConfirmation;

  assert.strictEqual(harness.state.pendingAction, replacementAction, 'old completion must not clear a newer pending action');
  assert.strictEqual(harness.state.pendingActionJobId, 'job-authorized-2');
  await harness.controller.onConfirm();
  assert.strictEqual(JSON.stringify(harness.calls.executePlan[1]), JSON.stringify({ jobId: 'job-authorized-2' }));
  assert.strictEqual(harness.state.pendingAction, null);
  assert.strictEqual(harness.state.pendingActionJobId, null);

  const missingJob = createHarness({
    plan: {
      ok: true,
      action: { rootPath: '/workspace/project', type: 'implement' },
      meta: { autoExecute: true },
    },
  });
  await missingJob.controller.onSend();
  assert.strictEqual(missingJob.calls.showPending.length, 0);
  assert.strictEqual(missingJob.calls.executePlan.length, 0);
  assert.strictEqual(missingJob.state.pendingAction, null);
  assert.strictEqual(missingJob.state.pendingActionJobId, null);

  missingJob.state.pendingAction = { rootPath: '/workspace/project', jobId: 'forged-job' };
  missingJob.state.pendingActionJobId = null;
  await missingJob.controller.onConfirm();
  assert.strictEqual(missingJob.calls.executePlan.length, 0, 'action.jobId must never authorize execution');
  assert.strictEqual(missingJob.state.pendingAction, null);

  const cancellation = createHarness();
  cancellation.state.pendingAction = { jobId: 'forged-job', targetFile: 'src/app.js' };
  cancellation.state.pendingActionJobId = 'job-authorized-cancel';
  await cancellation.controller.onCancel();
  assert.strictEqual(
    JSON.stringify(cancellation.calls.cancelJob),
    JSON.stringify([{ jobId: 'job-authorized-cancel' }])
  );
  assert.strictEqual(cancellation.state.pendingActionJobId, null);

  for (const cancelJob of [
    async () => ({ ok: false, message: 'Cancel denied.' }),
    async () => { throw new Error('Cancel unavailable.'); },
  ]) {
    const failedCancellation = createHarness({ cancelJob });
    const action = { targetFile: 'src/preserved.js' };
    failedCancellation.state.pendingAction = action;
    failedCancellation.state.pendingActionJobId = 'job-preserved';
    failedCancellation.state.activeJobId = 'job-unrelated';
    await failedCancellation.controller.onCancel();
    assert.strictEqual(failedCancellation.state.pendingAction, action);
    assert.strictEqual(failedCancellation.state.pendingActionJobId, 'job-preserved');
    assert.strictEqual(failedCancellation.state.activeJobId, 'job-unrelated');
    assert.strictEqual(failedCancellation.calls.clearPending, 0);
    assert.strictEqual(
      failedCancellation.calls.appendMessage.some((entry) => String(entry[1]).includes('Nenhum arquivo foi alterado')),
      false
    );
    await failedCancellation.controller.onNewConversation();
    assert.strictEqual(failedCancellation.calls.prepareNewConversation, 0);
  }

  const newConversation = createHarness();
  newConversation.state.pendingAction = { targetFile: 'src/pending.js' };
  newConversation.state.pendingActionJobId = 'job-new-conversation';
  await newConversation.controller.onNewConversation();
  assert.strictEqual(
    JSON.stringify(newConversation.calls.cancelJob),
    JSON.stringify([{ jobId: 'job-new-conversation' }]),
  );
  assert.strictEqual(newConversation.calls.prepareNewConversation, 1);

  const invalidCancellation = createHarness();
  invalidCancellation.state.pendingAction = { jobId: 'model-forged-job' };
  invalidCancellation.state.pendingActionJobId = null;
  invalidCancellation.state.activeJobId = 'job-unrelated';
  await invalidCancellation.controller.onCancel();
  assert.strictEqual(invalidCancellation.calls.cancelJob.length, 0);
  assert.strictEqual(invalidCancellation.state.pendingAction, null);
  assert.strictEqual(invalidCancellation.state.activeJobId, 'job-unrelated');

  const cortex = createHarness();
  cortex.state.uiMode = 'cortex';
  cortex.inputEl.value = 'Lembre desta decisão';
  await cortex.controller.onSend();
  assert.strictEqual(cortex.calls.learnWithCortex.length, 1);
  assert.strictEqual(cortex.calls.executePlan.length, 0);

  assert.strictEqual(source.includes('meta.autoExecute'), false);
  assert.strictEqual(source.includes('pendingAction.jobId'), false);
  assert.strictEqual(source.includes('Ação cancelada. Nenhum arquivo foi alterado.'), false);
  console.log('renderer-app-actions.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
