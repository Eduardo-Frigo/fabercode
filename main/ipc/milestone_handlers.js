function registerMilestoneHandlers(dependencies = {}) {
  const {
    authorizeProjectRoot,
    milestoneService,
    milestoneGitStatusService,
    milestoneValidationService,
    registerIpcHandler,
    appendAuditEvent = () => {},
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Milestones IPC dependency missing: ${name}`);
  }

  requireDependency('authorizeProjectRoot', authorizeProjectRoot);
  requireDependency('milestoneService', milestoneService);
  requireDependency('milestoneGitStatusService', milestoneGitStatusService);
  requireDependency('milestoneValidationService', milestoneValidationService);
  requireDependency('registerIpcHandler', registerIpcHandler);

  registerIpcHandler('milestones:list', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return { ok: true, milestones: milestoneService.listMilestones(auth.rootPath) };
  });

  registerIpcHandler('milestones:get', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    const list = milestoneService.listMilestones(auth.rootPath);
    const m = list.find((x) => x.id === payload.milestoneId);
    if (!m) return { ok: false, message: 'Milestone not found' };
    return { ok: true, milestone: m };
  });

  registerIpcHandler('milestones:update-status', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return milestoneService.updateMilestoneStatus(auth.rootPath, payload.milestoneId || '', payload.status || '');
  });

  registerIpcHandler('milestones:update-task', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return milestoneService.updateMilestoneTask(
      auth.rootPath,
      payload.milestoneId || '',
      payload.taskId || '',
      payload.task || {}
    );
  });

  registerIpcHandler('milestones:link-commit', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    const commitHash = payload && payload.commit && typeof payload.commit.hash === 'string'
      ? payload.commit.hash
      : '';
    return milestoneGitStatusService.linkExistingMilestoneCommit(
      auth.rootPath,
      payload.milestoneId || '',
      commitHash,
    );
  });

  registerIpcHandler('milestones:complete-after-validation', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return milestoneValidationService.completeMilestoneFromJob(
      auth.rootPath,
      payload.milestoneId || '',
      payload.jobId || '',
    );
  });

  registerIpcHandler('milestones:git-status', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    return milestoneGitStatusService.getMilestoneGitStatus(auth.rootPath, payload.milestoneId || '');
  });

  registerIpcHandler('milestones:render', (_, payload = {}) => {
    const auth = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!auth.ok) return auth;
    const result = milestoneService.renderMilestones(auth.rootPath);
    if (result.ok) {
      appendAuditEvent('milestones.rendered', {
        rootPath: auth.rootPath,
      });
    }
    return result;
  });
}

module.exports = {
  registerMilestoneHandlers,
};
