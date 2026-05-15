function registerGithubHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    authorizeProjectRoot,
    buildGithubPublishPlan,
    executeGithubPublish,
    getGithubAuthStatus,
    registerIpcHandler,
    scanProject,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`GitHub IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('authorizeProjectRoot', authorizeProjectRoot);
    requireDependency('buildGithubPublishPlan', buildGithubPublishPlan);
    requireDependency('executeGithubPublish', executeGithubPublish);
    requireDependency('getGithubAuthStatus', getGithubAuthStatus);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('scanProject', scanProject);
  }

  assertReady();

  registerIpcHandler('project:github:auth-status', async () => {
    try {
      const status = await getGithubAuthStatus();
      appendAuditEvent('project.github_auth_status_checked', {
        ghInstalled: Boolean(status && status.ghInstalled),
        authenticated: Boolean(status && status.authenticated),
        username: status && status.username ? status.username : '',
      });
      return { ok: true, status };
    } catch (error) {
      appendAuditEvent('project.github_auth_status_failed', { message: error.message });
      return { ok: false, message: `Falha ao consultar GitHub CLI: ${error.message}` };
    }
  });

  registerIpcHandler('project:github:publish-plan', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return { ...authorization, plan: null };
    try {
      const info = scanProject(authorization.rootPath);
      const plan = await buildGithubPublishPlan(info, payload && payload.options ? payload.options : {});
      appendAuditEvent('project.github_publish_plan_built', {
        rootPath: authorization.rootPath,
        ready: Boolean(plan && plan.ready),
        repoFullName: plan && plan.repoFullName ? plan.repoFullName : '',
        blockers: Array.isArray(plan && plan.blockers) ? plan.blockers.length : 0,
      });
      return { ok: true, info, plan };
    } catch (error) {
      appendAuditEvent('project.github_publish_plan_failed', { rootPath: authorization.rootPath, message: error.message });
      return { ok: false, message: `Falha ao planejar publicação GitHub: ${error.message}`, plan: null };
    }
  });

  registerIpcHandler('project:github:publish', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return { ...authorization, report: null };
    try {
      const info = scanProject(authorization.rootPath);
      const report = await executeGithubPublish(info, payload && payload.options ? payload.options : {});
      appendAuditEvent('project.github_publish_executed', {
        rootPath: authorization.rootPath,
        ok: Boolean(report && report.ok),
        repoUrl: report && report.repoUrl ? report.repoUrl : '',
      });
      return { ok: Boolean(report && report.ok), info, report, message: report && report.message ? report.message : '' };
    } catch (error) {
      appendAuditEvent('project.github_publish_failed', { rootPath: authorization.rootPath, message: error.message });
      return { ok: false, message: `Falha ao publicar no GitHub: ${error.message}`, report: null };
    }
  });
}

module.exports = {
  registerGithubHandlers,
};
