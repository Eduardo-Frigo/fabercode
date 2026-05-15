function registerMempalaceHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    ensureMempalaceProjectIndexed,
    getMempalaceRuntimeStatus,
    normalizeAuthorizedProjectInfo,
    registerIpcHandler,
    searchMempalaceContext,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`MemPalace IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('ensureMempalaceProjectIndexed', ensureMempalaceProjectIndexed);
    requireDependency('getMempalaceRuntimeStatus', getMempalaceRuntimeStatus);
    requireDependency('normalizeAuthorizedProjectInfo', normalizeAuthorizedProjectInfo);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('searchMempalaceContext', searchMempalaceContext);
  }

  assertReady();

  registerIpcHandler('mempalace:status', async (_, projectInfo) => {
    const project = normalizeAuthorizedProjectInfo(projectInfo || null);
    if (!project.ok) return project;
    return getMempalaceRuntimeStatus(project.projectInfo);
  });

  registerIpcHandler('mempalace:index-project', async (_, projectInfo) => {
    const project = normalizeAuthorizedProjectInfo(projectInfo || null);
    if (!project.ok) return project;
    const result = await ensureMempalaceProjectIndexed(project.projectInfo);
    appendAuditEvent(result.ok ? 'mempalace.index_ok' : 'mempalace.index_failed', {
      rootPath: project.projectInfo.rootPath,
      wing: result.wing || null,
      step: result.step || null,
      message: result.message || null,
    });
    return result;
  });

  registerIpcHandler('mempalace:search', async (_, payload) => {
    const { query, projectInfo, nResults } = payload || {};
    const project = normalizeAuthorizedProjectInfo(projectInfo || null);
    if (!project.ok) return project;
    return searchMempalaceContext(query || '', project.projectInfo, Number(nResults) || 4);
  });
}

module.exports = {
  registerMempalaceHandlers,
};
