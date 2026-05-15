function registerKnowledgeRuntimeHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    getKnowledgeRuntimeStatus,
    normalizeAuthorizedProjectInfo,
    registerIpcHandler,
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
}

module.exports = {
  registerKnowledgeRuntimeHandlers,
};
