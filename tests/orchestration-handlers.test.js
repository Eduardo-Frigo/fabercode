const assert = require('assert');

const { registerOrchestrationHandlers } = require('../main/ipc/orchestration_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

async function run() {
  const calls = [];
  const state = {
    conversationsByProject: {
      'project-1': [{ id: 'conversation-1', title: 'A' }],
    },
    auditTrail: [
      { id: 'audit-1', type: 'first' },
      { id: 'audit-2', type: 'second' },
    ],
  };
  const { handlers, registerIpcHandler } = createHandlerMap();

  const dependencies = {
    MAX_CONVERSATION_MESSAGES: 3,
    addConversationEntry: (projectId, title, meta) => {
      calls.push(['addConversationEntry', projectId, title, meta]);
      return { ok: true, conversation: { id: 'new-conv', title } };
    },
    addConversationMessage: (projectId, conversationId, role, text, meta) => {
      calls.push(['addConversationMessage', projectId, conversationId, role, text, meta]);
      return { ok: true, message: { id: 'message-1', role, text } };
    },
    appendAuditEvent: (type, payload) => {
      calls.push(['appendAuditEvent', type, payload]);
      return { id: 'audit-new', type, payload };
    },
    cancelAssistantJob: async (input) => {
      calls.push(['cancelAssistantJob', input]);
      return {
        ok: true,
        job: {
          id: input.jobId,
          status: 'cancelled',
          authorityContext: { sessionId: 'cancel-session-secret' },
          realRootPath: '/private/cancel-root',
        },
      };
    },
    rollbackCanaryJob: async (input) => {
      calls.push(['rollbackCanaryJob', input]);
      return {
        ok: true,
        idempotent: false,
        rollback: {
          promotionId: 'canary-promotion-1',
          reconciliationId: 'canary-reconciliation-1',
          sourceRestored: true,
        },
        job: {
          id: input.jobId,
          status: 'completed',
          canaryRollback: {
            status: 'completed',
            sourceRestored: true,
          },
          authorityContext: { sessionId: 'rollback-session-secret' },
          canonicalRootPath: '/private/rollback-root',
        },
      };
    },
    getJobById: (jobId) => ({
      ok: true,
      job: {
        id: jobId,
        authorityContext: {
          sessionId: 'session-secret',
          kernelId: 'kernel-secret',
          submissionDigest: `sha256:${'a'.repeat(64)}`,
        },
      },
    }),
    listConversationMessages: (conversationId, limit) => {
      calls.push(['listConversationMessages', conversationId, limit]);
      return { ok: true, messages: [{ id: 'message-1' }] };
    },
    listJobs: ({ projectId, limit }) => {
      calls.push(['listJobs', projectId, limit]);
      return {
        ok: true,
        jobs: [{
          id: 'job-1',
          projectId,
          authorityContext: { sessionId: 'session-secret' },
          realRootPath: '/private/real-root',
        }],
      };
    },
    readOrchestrationState: () => state,
    registerIpcHandler,
    renameConversationEntry: (projectId, conversationId, title) => {
      calls.push(['renameConversationEntry', projectId, conversationId, title]);
      return { ok: true, conversation: { id: conversationId, title } };
    },
    deleteConversationEntry: (projectId, conversationId) => {
      calls.push(['deleteConversationEntry', projectId, conversationId]);
      return { ok: true, conversations: [] };
    },
    retryAssistantJob: async (input) => {
      calls.push(['retryAssistantJob', input]);
      return {
        ok: true,
        job: {
          id: input.jobId,
          phase: 'persona_plan',
          actionDigest: `sha256:${'b'.repeat(64)}`,
          canonicalRootPath: '/private/retry-root',
        },
      };
    },
  };

  assert.throws(
    () => registerOrchestrationHandlers({ ...dependencies, cancelAssistantJob: null }),
    /cancelAssistantJob/
  );
  assert.throws(
    () => registerOrchestrationHandlers({ ...dependencies, rollbackCanaryJob: null }),
    /rollbackCanaryJob/
  );
  assert.throws(
    () => registerOrchestrationHandlers({ ...dependencies, retryAssistantJob: 'not-a-function' }),
    /retryAssistantJob/
  );
  registerOrchestrationHandlers(dependencies);

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'orchestration:audit:append',
    'orchestration:audit:list',
    'orchestration:conversation:add',
    'orchestration:conversation:delete',
    'orchestration:conversation:message:add',
    'orchestration:conversation:messages:list',
    'orchestration:conversation:rename',
    'orchestration:conversations:list',
    'orchestration:jobs:cancel',
    'orchestration:jobs:get',
    'orchestration:jobs:list',
    'orchestration:jobs:retry',
    'orchestration:jobs:rollback-canary',
  ]);

  assert.deepStrictEqual(handlers['orchestration:conversations:list'](), {
    ok: true,
    conversationsByProject: state.conversationsByProject,
  });

  assert.deepStrictEqual(handlers['orchestration:audit:list'](null, 1), {
    ok: true,
    auditTrail: [state.auditTrail[0]],
  });

  assert.strictEqual(handlers['orchestration:audit:append'](null, '', {}).ok, false);
  assert.strictEqual(handlers['orchestration:audit:append'](null, 'manual', { a: 1 }).event.type, 'manual');

  const publicJob = handlers['orchestration:jobs:get'](null, { jobId: 'job-1' }).job;
  assert.deepStrictEqual(publicJob, { id: 'job-1' });
  const publicJobs = handlers['orchestration:jobs:list'](null, {
    projectId: 'project-1',
    limit: 2,
  }).jobs;
  assert.deepStrictEqual(publicJobs, [{ id: 'job-1', projectId: 'project-1' }]);
  assert.strictEqual(JSON.stringify({ publicJob, publicJobs }).includes('session-secret'), false);

  assert.strictEqual(handlers['orchestration:conversation:add'](null, {
    projectId: 'project-1',
    title: 'Nova',
    meta: { source: 'test' },
  }).ok, true);

  assert.strictEqual(handlers['orchestration:conversation:rename'](null, {
    projectId: 'project-1',
    conversationId: 'conversation-1',
    title: 'B',
  }).conversation.title, 'B');

  assert.strictEqual(handlers['orchestration:conversation:delete'](null, {
    projectId: 'project-1',
    conversationId: 'conversation-1',
  }).ok, true);

  assert.strictEqual(handlers['orchestration:conversation:messages:list'](null, {
    conversationId: 'conversation-1',
    limit: 99,
  }).ok, true);

  assert.strictEqual(handlers['orchestration:conversation:message:add'](null, {
    projectId: 'project-1',
    conversationId: 'conversation-1',
    role: 'user',
    text: 'Olá',
  }).message.text, 'Olá');

  assert.strictEqual(handlers['orchestration:jobs:list'](null, { projectId: 'project-1', limit: 5 }).jobs.length, 1);
  assert.strictEqual(handlers['orchestration:jobs:get'](null, { jobId: 'job-1' }).job.id, 'job-1');
  const cancelPayload = { jobId: 'job-1' };
  const cancelResult = await handlers['orchestration:jobs:cancel'](null, cancelPayload);
  assert.deepStrictEqual(cancelResult, {
    ok: true,
    job: { id: 'job-1', status: 'cancelled' },
  });
  const cancelCalls = calls.filter((call) => call[0] === 'cancelAssistantJob');
  assert.strictEqual(cancelCalls.length, 1);
  assert.deepStrictEqual(cancelCalls[0][1], { jobId: 'job-1' });
  assert.notStrictEqual(cancelCalls[0][1], cancelPayload);

  const rollbackPayload = { jobId: 'job-1' };
  const rollbackResult = await handlers['orchestration:jobs:rollback-canary'](
    null,
    rollbackPayload
  );
  assert.deepStrictEqual(rollbackResult, {
    ok: true,
    idempotent: false,
    rollback: {
      promotionId: 'canary-promotion-1',
      reconciliationId: 'canary-reconciliation-1',
      sourceRestored: true,
    },
    job: {
      id: 'job-1',
      status: 'completed',
      canaryRollback: {
        status: 'completed',
        sourceRestored: true,
      },
    },
  });
  const rollbackCalls = calls.filter((call) => call[0] === 'rollbackCanaryJob');
  assert.strictEqual(rollbackCalls.length, 1);
  assert.deepStrictEqual(rollbackCalls[0][1], { jobId: 'job-1' });
  assert.notStrictEqual(rollbackCalls[0][1], rollbackPayload);

  const retryPayload = { jobId: 'job-1' };
  const retryResult = await handlers['orchestration:jobs:retry'](null, retryPayload);
  assert.deepStrictEqual(retryResult, {
    ok: true,
    job: { id: 'job-1', phase: 'persona_plan' },
  });
  const retryCalls = calls.filter((call) => call[0] === 'retryAssistantJob');
  assert.strictEqual(retryCalls.length, 1);
  assert.deepStrictEqual(retryCalls[0][1], { jobId: 'job-1' });
  assert.notStrictEqual(retryCalls[0][1], retryPayload);
  assert.strictEqual(
    JSON.stringify({ cancelResult, rollbackResult, retryResult }).includes('/private/'),
    false
  );

  const invalidInput = { ok: false, code: 'orchestration_ipc_invalid_input' };
  const coordinatedCallsBeforeInvalid = calls.filter(
    (call) => call[0] === 'cancelAssistantJob'
      || call[0] === 'rollbackCanaryJob'
      || call[0] === 'retryAssistantJob'
  ).length;
  for (const channel of [
    'orchestration:jobs:cancel',
    'orchestration:jobs:rollback-canary',
    'orchestration:jobs:retry',
  ]) {
    assert.deepStrictEqual(await handlers[channel](null), invalidInput);
    assert.deepStrictEqual(await handlers[channel](null, { jobId: 'job-1' }, {}), invalidInput);
    assert.deepStrictEqual(await handlers[channel](null, null), invalidInput);
    assert.deepStrictEqual(await handlers[channel](null, []), invalidInput);
    assert.deepStrictEqual(await handlers[channel](null, {}), invalidInput);
    assert.deepStrictEqual(
      await handlers[channel](null, { jobId: 'job-1', phase: 'execute_pending' }),
      invalidInput
    );
    assert.deepStrictEqual(
      await handlers[channel](null, Object.create({ jobId: 'job-1' })),
      invalidInput
    );

    let getterReads = 0;
    const accessorPayload = {};
    Object.defineProperty(accessorPayload, 'jobId', {
      enumerable: true,
      get() {
        getterReads += 1;
        return 'job-1';
      },
    });
    assert.deepStrictEqual(await handlers[channel](null, accessorPayload), invalidInput);
    assert.strictEqual(getterReads, 0);

    const symbolPayload = { jobId: 'job-1' };
    symbolPayload[Symbol('hostile')] = true;
    assert.deepStrictEqual(await handlers[channel](null, symbolPayload), invalidInput);
  }
  assert.strictEqual(
    calls.filter((call) => call[0] === 'cancelAssistantJob'
      || call[0] === 'rollbackCanaryJob'
      || call[0] === 'retryAssistantJob').length,
    coordinatedCallsBeforeInvalid
  );

  const cancelFailure = new Error('cancel authority unavailable');
  const rollbackFailure = new Error('rollback authority unavailable');
  const retryFailure = new Error('retry authority unavailable');
  const rejectedMap = createHandlerMap();
  registerOrchestrationHandlers({
    ...dependencies,
    cancelAssistantJob: () => { throw cancelFailure; },
    registerIpcHandler: rejectedMap.registerIpcHandler,
    rollbackCanaryJob: async () => { throw rollbackFailure; },
    retryAssistantJob: async () => { throw retryFailure; },
  });
  await assert.rejects(
    rejectedMap.handlers['orchestration:jobs:cancel'](null, { jobId: 'job-1' }),
    (error) => error === cancelFailure
  );
  await assert.rejects(
    rejectedMap.handlers['orchestration:jobs:rollback-canary'](
      null,
      { jobId: 'job-1' }
    ),
    (error) => error === rollbackFailure
  );
  await assert.rejects(
    rejectedMap.handlers['orchestration:jobs:retry'](null, { jobId: 'job-1' }),
    (error) => error === retryFailure
  );

  console.log('orchestration-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
