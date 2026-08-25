'use strict';

const ORCHESTRATION_IPC_INVALID_INPUT = Object.freeze({
  ok: false,
  code: 'orchestration_ipc_invalid_input',
});
const FORBIDDEN_TOP_LEVEL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function exactJobEnvelope(args) {
  if (args.length !== 1) return null;
  const value = args[0];
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== 'jobId' || FORBIDDEN_TOP_LEVEL_KEYS.has(keys[0])) {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'jobId');
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return null;
    }
    return Object.freeze({ jobId: descriptor.value });
  } catch {
    return null;
  }
}

function registerOrchestrationHandlers(dependencies = {}) {
  const {
    MAX_CONVERSATION_MESSAGES = 200,
    addConversationEntry,
    addConversationMessage,
    appendAuditEvent,
    cancelAssistantJob,
    getJobById,
    listConversationMessages,
    listJobs,
    readOrchestrationState,
    registerIpcHandler,
    renameConversationEntry,
    rollbackCanaryJob,
    retryAssistantJob,
    deleteConversationEntry,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Orchestration IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('addConversationEntry', addConversationEntry);
    requireDependency('addConversationMessage', addConversationMessage);
    requireDependency('appendAuditEvent', appendAuditEvent);
    if (typeof cancelAssistantJob !== 'function') {
      throw new Error('Orchestration IPC dependency missing: cancelAssistantJob');
    }
    requireDependency('getJobById', getJobById);
    requireDependency('listConversationMessages', listConversationMessages);
    requireDependency('listJobs', listJobs);
    requireDependency('readOrchestrationState', readOrchestrationState);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('renameConversationEntry', renameConversationEntry);
    if (typeof rollbackCanaryJob !== 'function') {
      throw new Error('Orchestration IPC dependency missing: rollbackCanaryJob');
    }
    if (typeof retryAssistantJob !== 'function') {
      throw new Error('Orchestration IPC dependency missing: retryAssistantJob');
    }
  }

  assertReady();

  const authorityOnlyJobFields = new Set([
    'authorityContext',
    'canonicalRootPath',
    'realRootPath',
    'sessionId',
    'kernelId',
    'submissionDigest',
    'actionDigest',
  ]);

  function publicJobSnapshot(job) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
    const snapshot = {};
    for (const key of Object.keys(job)) {
      if (authorityOnlyJobFields.has(key)) continue;
      snapshot[key] = job[key];
    }
    return snapshot;
  }

  function publicJobResult(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    const snapshot = { ...result };
    if (Object.hasOwn(snapshot, 'job')) snapshot.job = publicJobSnapshot(snapshot.job);
    if (Array.isArray(snapshot.jobs)) snapshot.jobs = snapshot.jobs.map(publicJobSnapshot).filter(Boolean);
    return snapshot;
  }

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
    return publicJobResult(listJobs({ projectId, limit }));
  });

  registerIpcHandler('orchestration:jobs:get', (_, payload) => {
    const { jobId } = payload || {};
    return publicJobResult(getJobById(jobId));
  });

  registerIpcHandler('orchestration:jobs:cancel', async (_, ...args) => {
    const envelope = exactJobEnvelope(args);
    if (!envelope) return ORCHESTRATION_IPC_INVALID_INPUT;
    return publicJobResult(await cancelAssistantJob(envelope));
  });

  registerIpcHandler('orchestration:jobs:rollback-canary', async (_, ...args) => {
    const envelope = exactJobEnvelope(args);
    if (!envelope) return ORCHESTRATION_IPC_INVALID_INPUT;
    return publicJobResult(await rollbackCanaryJob(envelope));
  });

  registerIpcHandler('orchestration:jobs:retry', async (_, ...args) => {
    const envelope = exactJobEnvelope(args);
    if (!envelope) return ORCHESTRATION_IPC_INVALID_INPUT;
    return publicJobResult(await retryAssistantJob(envelope));
  });
}

module.exports = {
  registerOrchestrationHandlers,
};
