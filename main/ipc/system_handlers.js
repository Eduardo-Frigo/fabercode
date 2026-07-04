function registerSystemHandlers(dependencies = {}) {
  const {
    appendAuditEvent = () => {},
    getHostRequirements,
    normalizeExternalUrl,
    registerIpcHandler,
    shell,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`System IPC dependency missing: ${name}`);
  }

  requireDependency('getHostRequirements', getHostRequirements);
  requireDependency('normalizeExternalUrl', normalizeExternalUrl);
  requireDependency('registerIpcHandler', registerIpcHandler);
  requireDependency('shell', shell);

  registerIpcHandler('system:host-requirements', async () => {
    try {
      return await getHostRequirements();
    } catch (error) {
      appendAuditEvent('system.host_requirements_failed', {
        message: error && error.message ? error.message : 'unknown_error',
      });
      return {
        ok: false,
        ready: false,
        requirements: [],
        message: error && error.message ? error.message : 'Nao foi possivel validar os requisitos locais.',
      };
    }
  });

  registerIpcHandler('system:open-external', async (_, payload = {}) => {
    const rawUrl = payload && payload.url ? String(payload.url) : '';
    const externalUrl = normalizeExternalUrl(rawUrl);
    if (!externalUrl.ok) return externalUrl;
    await shell.openExternal(externalUrl.url);
    appendAuditEvent('system.external_url_opened', { url: externalUrl.url });
    return { ok: true, opened: true, url: externalUrl.url };
  });
}

module.exports = {
  registerSystemHandlers,
};
