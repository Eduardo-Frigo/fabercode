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

  registerOrchestrationHandlers({
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
    appendJobEvent: (jobId, type, payload) => {
      calls.push(['appendJobEvent', jobId, type, payload]);
      return { ok: true };
    },
    abortActiveJobExecution: (jobId, reason) => {
      calls.push(['abortActiveJobExecution', jobId, reason]);
      return { ok: true, aborted: true, reason };
    },
    getJobById: (jobId) => ({ ok: true, job: { id: jobId } }),
    listConversationMessages: (conversationId, limit) => {
      calls.push(['listConversationMessages', conversationId, limit]);
      return { ok: true, messages: [{ id: 'message-1' }] };
    },
    listJobs: ({ projectId, limit }) => {
      calls.push(['listJobs', projectId, limit]);
      return { ok: true, jobs: [{ id: 'job-1', projectId }] };
    },
    markJobCancelled: (jobId, reason) => {
      calls.push(['markJobCancelled', jobId, reason]);
      return { ok: true, job: { id: jobId, status: 'cancelled' } };
    },
    markJobPhase: (jobId, phase, payload) => {
      calls.push(['markJobPhase', jobId, phase, payload]);
      return { ok: true, job: { id: jobId, phase } };
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
  });

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
  const cancelResult = handlers['orchestration:jobs:cancel'](null, { jobId: 'job-1' });
  assert.strictEqual(cancelResult.job.status, 'cancelled');
  assert.strictEqual(cancelResult.job.executionAbort.aborted, true);
  assert.ok(calls.some((call) => call[0] === 'abortActiveJobExecution' && call[1] === 'job-1'));
  assert.strictEqual(handlers['orchestration:jobs:cancel'](null, {}).ok, false);
  assert.strictEqual(handlers['orchestration:jobs:retry'](null, { jobId: 'job-1', phase: 'execute_pending' }).job.phase, 'execute_pending');
  assert.ok(calls.some((call) => call[0] === 'appendJobEvent' && call[2] === 'job.retry_requested'));

  console.log('orchestration-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
