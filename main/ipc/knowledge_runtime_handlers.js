function registerKnowledgeRuntimeHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    getKnowledgeRuntimeStatus,
    listMemoryEvidence,
    normalizeAuthorizedProjectInfo,
    registerIpcHandler,
    runMemoryLifecycleOperation,
    searchKnowledge,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Knowledge runtime IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('getKnowledgeRuntimeStatus', getKnowledgeRuntimeStatus);
    requireDependency('normalizeAuthorizedProjectInfo', normalizeAuthorizedProjectInfo);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('searchKnowledge', searchKnowledge);
  }

  assertReady();

  registerIpcHandler('knowledge:runtime:status', async (_, payload) => {
    const { projectId, projectInfo } = payload || {};
    const project = normalizeAuthorizedProjectInfo(projectInfo || null);
    if (!project.ok) return project;
    return getKnowledgeRuntimeStatus({
      projectId,
      projectInfo: project.projectInfo,
    });
  });

  registerIpcHandler('knowledge:runtime:search', async (_, payload) => {
    const { query, projectInfo, nResults } = payload || {};
    const project = normalizeAuthorizedProjectInfo(projectInfo || null);
    if (!project.ok) return project;
    const result = await searchKnowledge({
      query,
      projectInfo: project.projectInfo,
      nResults,
    });
    appendAuditEvent(result.ok ? 'knowledge.search_ok' : 'knowledge.search_failed', {
      rootPath: project.projectInfo.rootPath,
      querySize: String(query || '').length,
      mempalace: result.mempalace && (result.mempalace.reason || (result.mempalace.ok ? 'ok' : 'unknown')),
      rag: result.rag && (result.rag.reason || (result.rag.ok ? 'ok' : 'unknown')),
    });
    return result;
  });

  if (typeof listMemoryEvidence === 'function') {
    registerIpcHandler('knowledge:memory-ledger:list', async (_, payload) => {
      const { projectInfo, jobId, limit } = payload || {};
      const project = normalizeAuthorizedProjectInfo(projectInfo || null);
      if (!project.ok) return project;
      return listMemoryEvidence({
        projectInfo: project.projectInfo,
        jobId,
        limit,
      });
    });
  }

  if (typeof runMemoryLifecycleOperation === 'function') {
    registerIpcHandler('knowledge:runtime:lifecycle', async (_, payload) => {
      const { projectInfo } = payload || {};
      const project = normalizeAuthorizedProjectInfo(projectInfo || null);
      if (!project.ok) return project;
      const result = await runMemoryLifecycleOperation({
        ...(payload || {}),
        projectInfo: project.projectInfo,
      });
      appendAuditEvent(result.ok ? 'knowledge.lifecycle_ok' : 'knowledge.lifecycle_failed', {
        rootPath: project.projectInfo.rootPath,
        action: payload && payload.action ? payload.action : 'status',
        message: result.message || result.reason || null,
      });
      return result;
    });
  }
}

module.exports = {
  registerKnowledgeRuntimeHandlers,
};
