function registerPreviewHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    authorizeProjectRoot,
    normalizePreviewOpenUrl,
    registerIpcHandler,
    scanProject,
    shell,
    startProjectPreview,
    stopProjectPreview,
    getProjectPreviewRuntimeStatus,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Preview IPC dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('authorizeProjectRoot', authorizeProjectRoot);
    requireDependency('normalizePreviewOpenUrl', normalizePreviewOpenUrl);
    requireDependency('registerIpcHandler', registerIpcHandler);
    requireDependency('scanProject', scanProject);
    requireDependency('shell', shell);
    requireDependency('startProjectPreview', startProjectPreview);
    requireDependency('stopProjectPreview', stopProjectPreview);
    requireDependency('getProjectPreviewRuntimeStatus', getProjectPreviewRuntimeStatus);
  }

  assertReady();

  registerIpcHandler('project:preview:start', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return { ...authorization, session: null };
    try {
      const info = scanProject(authorization.rootPath);
      const result = await startProjectPreview(info, payload && payload.options ? payload.options : {});
      appendAuditEvent('project.preview_started', {
        rootPath: authorization.rootPath,
        ok: Boolean(result && result.ok),
        mode: result && result.session ? result.session.mode : '',
        url: result && result.session ? result.session.url : '',
      });
      if (
        result &&
        result.ok &&
        payload &&
        payload.open === true &&
        result.session &&
        result.session.url &&
        result.session.status === 'ready'
      ) {
        const previewUrl = normalizePreviewOpenUrl(result.session.url);
        if (!previewUrl.ok) {
          return { ...previewUrl, info, session: result.session };
        }
        await shell.openExternal(previewUrl.url);
      }
      return { ok: Boolean(result && result.ok), info, ...result };
    } catch (error) {
      appendAuditEvent('project.preview_start_failed', { rootPath: authorization.rootPath, message: error.message });
      return { ok: false, message: `Falha ao iniciar preview: ${error.message}`, session: null };
    }
  });

  registerIpcHandler('project:preview:stop', async (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return authorization;
    try {
      const result = await stopProjectPreview({ rootPath: authorization.rootPath });
      appendAuditEvent('project.preview_stopped', {
        rootPath: authorization.rootPath,
        stopped: Boolean(result && result.stopped),
      });
      return result;
    } catch (error) {
      appendAuditEvent('project.preview_stop_failed', { rootPath: authorization.rootPath, message: error.message });
      return { ok: false, message: `Falha ao interromper preview: ${error.message}` };
    }
  });

  registerIpcHandler('project:preview:runtime-status', (_, payload) => {
    const authorization = authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
    if (!authorization.ok) return authorization;
    return getProjectPreviewRuntimeStatus({ rootPath: authorization.rootPath });
  });
}

module.exports = {
  registerPreviewHandlers,
};
