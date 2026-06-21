function registerOrchestrationHandlers(dependencies = {}) {
  const {
    MAX_CONVERSATION_MESSAGES = 200,
    addConversationEntry,
    addConversationMessage,
    appendAuditEvent,
    appendJobEvent,
    abortActiveJobExecution = () => ({ ok: true, aborted: false }),
    getJobById,
    listConversationMessages,
    listJobs,
    markJobCancelled,
    markJobPhase,
    readOrchestrationState,
    registerIpcHandler,
    renameConversationEntry,
    deleteConversationEntry,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Orchestration IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('addConversationEntry', addConversationEntry);
    requireDependency('addConversationMessage', addConversationMessage);
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('appendJobEvent', appendJobEvent);
    requireDependency('getJobById', getJobById);
    requireDependency('listConversationMessages', listConversationMessages);
    requireDependency('listJobs', listJobs);
    requireDependency('markJobCancelled', markJobCancelled);
    requireDependency('markJobPhase', markJobPhase);
    requireDependency('readOrchestrationState', readOrchestrationState);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('renameConversationEntry', renameConversationEntry);
  }

  assertReady();

  registerIpcHandler('orchestration:conversations:list', () => {
    const state = readOrchestrationState();
    return { ok: true, conversationsByProject: state.conversationsByProject };
  });

  registerIpcHandler('orchestration:conversation:add', (_, payload) => {
    const { projectId, title, meta } = payload || {};
    return addConversationEntry(projectId, title, meta || {});
  });

  registerIpcHandler('orchestration:conversation:rename', (_, payload) => {
    const { projectId, conversationId, title } = payload || {};
    return renameConversationEntry(projectId, conversationId, title);
  });

  registerIpcHandler('orchestration:conversation:delete', (_, payload) => {
    const { projectId, conversationId } = payload || {};
    return deleteConversationEntry(projectId, conversationId);
  });

  registerIpcHandler('orchestration:conversation:messages:list', (_, payload) => {
    const { conversationId, limit } = payload || {};
    return listConversationMessages(conversationId, Number(limit) || MAX_CONVERSATION_MESSAGES);
  });

  registerIpcHandler('orchestration:conversation:message:add', (_, payload) => {
    const { projectId, conversationId, role, text, meta } = payload || {};
    return addConversationMessage(projectId, conversationId, role, text, meta || {});
  });

  registerIpcHandler('orchestration:audit:list', (_, limit = 120) => {
    const state = readOrchestrationState();
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Number(limit))) : 120;
    return { ok: true, auditTrail: state.auditTrail.slice(0, safeLimit) };
  });

  registerIpcHandler('orchestration:audit:append', (_, type, payload) => {
    if (!type || typeof type !== 'string') {
      return { ok: false, message: 'Tipo de evento inválido.' };
    }
    const event = appendAuditEvent(type, payload || {});
    return { ok: true, event };
  });

  registerIpcHandler('orchestration:jobs:list', (_, payload) => {
    const { projectId = null, limit = 30 } = payload || {};
    return listJobs({ projectId, limit });
  });

  registerIpcHandler('orchestration:jobs:get', (_, payload) => {
    const { jobId } = payload || {};
    return getJobById(jobId);
  });

  registerIpcHandler('orchestration:jobs:cancel', (_, payload) => {
    const { jobId } = payload || {};
    if (!jobId) return { ok: false, message: 'jobId é obrigatório.' };
    const abortResult = abortActiveJobExecution(jobId, 'cancelled_by_user');
    const cancelResult = markJobCancelled(jobId, 'cancelled_by_user');
    if (cancelResult && cancelResult.ok && cancelResult.job) {
      cancelResult.job.executionAbort = {
        aborted: Boolean(abortResult && abortResult.aborted),
      };
    }
    return cancelResult;
  });

  registerIpcHandler('orchestration:jobs:retry', (_, payload) => {
    const { jobId, phase = 'persona_plan' } = payload || {};
    if (!jobId) return { ok: false, message: 'jobId é obrigatório.' };
    const result = markJobPhase(jobId, phase, { retryRequested: true });
    if (!result.ok) return result;
    appendJobEvent(jobId, 'job.retry_requested', { phase });
    return { ok: true, job: result.job };
  });
}

module.exports = {
  registerOrchestrationHandlers,
};
