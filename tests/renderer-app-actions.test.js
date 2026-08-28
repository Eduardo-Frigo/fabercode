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

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(message || 'condition was not reached');
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

function createHarness({
  approvalController = null,
  cancelJob,
  ensureActiveConversationForSend,
  executePlan,
  getActiveConversationId,
  plan,
  sendAssistantMessage,
} = {}) {
  const moduleApi = loadModule();
  const calls = {
    appendMessage: [],
    cancelJob: [],
    clearPending: 0,
    executePlan: [],
    learnWithCortex: [],
    sendAssistantMessage: [],
    showPending: [],
    updateStatus: [],
    startJobPolling: [],
    stopJobPolling: 0,
    hideJobProgress: 0,
    prepareNewConversation: 0,
    pollJob: [],
    approvalCapture: [],
    approvalFinish: [],
    approvalReset: [],
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
    composerApprovalMode: 'ask_each',
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
      return sendAssistantMessage ? sendAssistantMessage(payload) : plan;
    },
  };
  const composerApprovalModeController = approvalController || {
    captureSubmission: ({ uiMode }) => {
      calls.approvalCapture.push({ uiMode });
      return Object.freeze({ token: Object.freeze({}), approvalMode: state.composerApprovalMode });
    },
    finishSubmission: (snapshot, outcome) => {
      calls.approvalFinish.push({ snapshot, outcome });
      return true;
    },
    reset: (reason) => {
      calls.approvalReset.push(reason);
      state.composerApprovalMode = 'ask_each';
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
      ensureActiveConversationForSend: ensureActiveConversationForSend || (async () => null),
      ensureSelectedProjectInfoReady: async () => true,
      getActiveConversationId: getActiveConversationId || (() => null),
      getRecentConversationMessagesForPersona: () => [],
      hidePersonaThinkingIndicator: () => {},
      pollJob: async (jobId) => { calls.pollJob.push(jobId); },
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
      stopJobPolling: () => { calls.stopJobPolling += 1; },
      hideJobProgress: () => { calls.hideJobProgress += 1; },
      updateStatus: (message) => calls.updateStatus.push(message),
      watchLatestProjectJob: () => () => {},
    },
    controllers: { composerApprovalModeController },
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

  {
    const staleExecutionGate = deferred();
    const staleExecution = createHarness({
      executePlan: () => staleExecutionGate.promise,
    });
    staleExecution.state.pendingAction = {
      rootPath: '/workspace/project',
      targetFile: 'src/old-account.js',
    };
    staleExecution.state.pendingActionJobId = 'job-old-account-execution';
    const executionPromise = staleExecution.controller.onConfirm();
    await waitFor(() => staleExecution.calls.executePlan.length === 1, 'execution did not start');
    staleExecution.controller.resetForAccountContextChange('account_context_change');
    staleExecutionGate.resolve({
      ok: true,
      message: 'Resultado da conta anterior.',
      modifiedFiles: ['src/old-account.js'],
    });
    await executionPromise;
    assert.strictEqual(staleExecution.calls.pollJob.length, 0);
    assert.strictEqual(
      staleExecution.calls.appendMessage.some((entry) => entry[1] === 'Resultado da conta anterior.'),
      false,
      'an execution completion from a revoked account context must not render',
    );
  }

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

  const recoveryBlocked = createHarness({
    plan: {
      ok: false,
      code: 'assistant_recovery_required',
      message: 'A recuperação segura precisa ser concluída antes de novas ações.',
    },
  });
  await recoveryBlocked.controller.onSend();
  assert.strictEqual(
    recoveryBlocked.calls.appendMessage.some((entry) => (
      entry[0] === 'assistant'
      && entry[1] === 'A recuperação segura precisa ser concluída antes de novas ações.'
    )),
    true,
  );
  assert.strictEqual(
    recoveryBlocked.calls.updateStatus.at(-1),
    'A recuperação segura precisa ser concluída antes de novas ações.',
  );
  assert.strictEqual(
    recoveryBlocked.calls.updateStatus.includes('Nenhuma alteração foi preparada nesta rodada.'),
    false,
  );

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
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(cortex.calls.learnWithCortex[0], 'approvalMode'),
    false,
    'Cortex must never receive execution approval mode',
  );

  {
    const cortexGate = deferred();
    const staleCortex = createHarness();
    staleCortex.state.uiMode = 'cortex';
    staleCortex.api.learnWithCortex = async (payload) => {
      staleCortex.calls.learnWithCortex.push(payload);
      return cortexGate.promise;
    };
    const oldLearning = staleCortex.controller.onSend();
    await waitFor(() => staleCortex.calls.learnWithCortex.length === 1, 'Cortex learning did not start');
    staleCortex.controller.invalidateSubmission('cortex_context_change');
    cortexGate.resolve({ ok: true, learning: {}, message: 'Memória obsoleta.' });
    await oldLearning;
    assert.strictEqual(
      staleCortex.calls.appendMessage.some((entry) => entry[0] === 'assistant' && entry[1] === 'Memória obsoleta.'),
      false,
      'stale Cortex responses must not render in a new context',
    );
  }

  {
    const accountChange = createHarness();
    accountChange.state.activeJobId = 'job-old-account';
    accountChange.state.pendingAction = { targetFile: 'src/private.js' };
    accountChange.state.pendingActionJobId = 'job-old-account';
    accountChange.state.composerApprovalMode = 'delegate_task';
    accountChange.controller.resetForAccountContextChange('account_context_change');
    assert.strictEqual(accountChange.state.activeJobId, null);
    assert.strictEqual(accountChange.state.pendingAction, null);
    assert.strictEqual(accountChange.state.pendingActionJobId, null);
    assert.strictEqual(accountChange.state.composerApprovalMode, 'ask_each');
    assert.strictEqual(accountChange.calls.stopJobPolling, 1);
    assert.strictEqual(accountChange.calls.hideJobProgress, 1);
    assert.deepStrictEqual(accountChange.calls.approvalReset, ['account_context_change']);
  }

  {
    const delegated = createHarness({ plan: { ok: true, response: 'Tarefa aceita.' } });
    delegated.state.composerApprovalMode = 'delegate_task';
    await delegated.controller.onSend();
    assert.strictEqual(delegated.calls.sendAssistantMessage[0].approvalMode, 'delegate_task');
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(delegated.calls.sendAssistantMessage[0], 'requestedMode'),
      false,
    );
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(delegated.calls.approvalFinish.map((entry) => entry.outcome))),
      [{ accepted: true }],
    );
  }

  {
    const order = [];
    const finishOutcomes = [];
    const failedPreflight = createHarness({
      approvalController: {
        captureSubmission: () => {
          order.push('capture');
          return Object.freeze({ token: Object.freeze({}), approvalMode: 'delegate_task' });
        },
        finishSubmission: (_snapshot, outcome) => {
          finishOutcomes.push(outcome);
        },
        reset: () => order.push('reset'),
      },
      cancelJob: async () => {
        order.push('cancel');
        return { ok: false, message: 'Cancel denied.' };
      },
      plan: { ok: true, response: 'must not run' },
    });
    failedPreflight.state.pendingAction = { targetFile: 'src/preserved.js' };
    failedPreflight.state.pendingActionJobId = 'job-preflight';
    const originalInput = failedPreflight.inputEl.value;
    await failedPreflight.controller.onSend();
    assert.deepStrictEqual(order, ['capture', 'cancel'], 'mode snapshot must precede the first await');
    assert.strictEqual(failedPreflight.inputEl.value, originalInput);
    assert.strictEqual(failedPreflight.state.pendingActionJobId, 'job-preflight');
    assert.strictEqual(failedPreflight.calls.sendAssistantMessage.length, 0);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(finishOutcomes)), [{ accepted: false }]);
  }

  {
    let conversationId = null;
    const firstConversation = createHarness({
      ensureActiveConversationForSend: async () => {
        conversationId = 'conversation-created';
        return conversationId;
      },
      getActiveConversationId: () => conversationId,
      plan: {
        ok: true,
        jobId: 'job-first-conversation',
        action: { rootPath: '/workspace/project', targetFile: 'src/created.js' },
      },
    });
    await firstConversation.controller.onSend();
    assert.strictEqual(firstConversation.calls.cancelJob.length, 0, 'new conversation is part of the valid snapshot');
    assert.strictEqual(firstConversation.calls.showPending.length, 1);
    assert.strictEqual(firstConversation.state.pendingActionJobId, 'job-first-conversation');
  }

  {
    const firstPlan = deferred();
    const secondPlan = deferred();
    let requestCount = 0;
    const stale = createHarness({
      getActiveConversationId: () => 'conversation-1',
      sendAssistantMessage: () => {
        requestCount += 1;
        return requestCount === 1 ? firstPlan.promise : secondPlan.promise;
      },
    });

    const firstRequest = stale.controller.onSend();
    await waitFor(() => stale.calls.sendAssistantMessage.length === 1, 'first plan did not start');
    stale.controller.invalidateSubmission('test_context_change');
    stale.inputEl.value = 'Novo envio após mudar o contexto';
    const secondRequest = stale.controller.onSend();
    await waitFor(() => stale.calls.sendAssistantMessage.length === 2, 'second plan did not start');

    firstPlan.resolve({
      ok: true,
      jobId: 'job-stale',
      response: 'Resposta obsoleta.',
      action: { rootPath: '/workspace/project', targetFile: 'src/stale.js' },
    });
    await firstRequest;
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(stale.calls.cancelJob)),
      [{ jobId: 'job-stale' }],
      'stale authoritative job must be cancelled exactly once',
    );
    assert.strictEqual(stale.calls.showPending.length, 0);
    assert.strictEqual(stale.calls.startJobPolling.length, 0);
    assert.strictEqual(
      stale.calls.appendMessage.some((entry) => entry[0] === 'assistant' && entry[1] === 'Resposta obsoleta.'),
      false,
    );

    stale.inputEl.value = 'Terceiro envio concorrente';
    await stale.controller.onSend();
    assert.strictEqual(
      stale.calls.sendAssistantMessage.length,
      2,
      'old finally must not unlock the newer in-flight send',
    );
    secondPlan.resolve({ ok: true, response: 'Resposta atual.' });
    await secondRequest;
    assert.strictEqual(
      stale.calls.appendMessage.some((entry) => entry[0] === 'assistant' && entry[1] === 'Resposta atual.'),
      true,
    );
  }

  {
    const planGate = deferred();
    const conversationChange = createHarness({ plan: planGate.promise });
    conversationChange.state.composerApprovalMode = 'delegate_task';
    const oldRequest = conversationChange.controller.onSend();
    await waitFor(() => conversationChange.calls.sendAssistantMessage.length === 1, 'conversation plan did not start');
    await conversationChange.controller.onNewConversation();
    assert.strictEqual(conversationChange.calls.prepareNewConversation, 1);
    assert.deepStrictEqual(conversationChange.calls.approvalReset, ['new_conversation']);
    planGate.resolve({
      ok: true,
      jobId: 'job-old-conversation',
      response: 'Não renderizar.',
      action: { rootPath: '/workspace/project', targetFile: 'src/old.js' },
    });
    await oldRequest;
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(conversationChange.calls.cancelJob)),
      [{ jobId: 'job-old-conversation' }],
    );
    assert.strictEqual(conversationChange.calls.showPending.length, 0);
  }

  assert.strictEqual(source.includes('meta.autoExecute'), false);
  assert.strictEqual(source.includes('pendingAction.jobId'), false);
  assert.strictEqual(source.includes('requestedMode'), false);
  assert.strictEqual(source.includes('Ação cancelada. Nenhum arquivo foi alterado.'), false);
  console.log('renderer-app-actions.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
