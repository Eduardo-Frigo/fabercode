function registerTerminalHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    authorizeProjectRoot,
    registerIpcHandler,
    terminalService,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Terminal IPC dependency missing: ${name}`);
  }

  requireDependency('appendAuditEvent', appendAuditEvent);
  requireDependency('authorizeProjectRoot', authorizeProjectRoot);
  requireDependency('registerIpcHandler', registerIpcHandler);
  requireDependency('terminalService', terminalService);

  function authorizePayloadRoot(payload) {
    return authorizeProjectRoot(payload && payload.rootPath ? String(payload.rootPath) : '');
  }

  function sendTerminalEvent(event, payload) {
    const sender = event && event.sender;
    if (!sender || typeof sender.send !== 'function') return;
    if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return;
    sender.send('project:terminal:event', payload);
  }

  registerIpcHandler('project:terminal:list', (_, payload) => {
    const authorization = authorizePayloadRoot(payload);
    if (!authorization.ok) return { ...authorization, sessions: [] };
    return terminalService.listSessions({
      rootPath: authorization.rootPath,
      realRootPath: authorization.realRootPath,
    });
  });

  registerIpcHandler('project:terminal:create', (_, payload) => {
    const authorization = authorizePayloadRoot(payload);
    if (!authorization.ok) return { ...authorization, session: null };
    const result = terminalService.createSession({
      rootPath: authorization.rootPath,
      realRootPath: authorization.realRootPath,
      name: payload && payload.name,
    });
    appendAuditEvent('project.terminal_created', {
      rootPath: authorization.rootPath,
      ok: Boolean(result && result.ok),
    });
    return result;
  });

  registerIpcHandler('project:terminal:run', (event, payload) => {
    const authorization = authorizePayloadRoot(payload);
    if (!authorization.ok) return { ...authorization, session: null };
    const result = terminalService.runCommand({
      rootPath: authorization.rootPath,
      sessionId: payload && payload.sessionId,
      command: payload && payload.command,
      sendEvent: (terminalEvent) => sendTerminalEvent(event, terminalEvent),
    });
    appendAuditEvent('project.terminal_command', {
      rootPath: authorization.rootPath,
      sessionId: payload && payload.sessionId,
      ok: Boolean(result && result.ok),
      started: Boolean(result && result.started),
    });
    return result;
  });

  registerIpcHandler('project:terminal:stop', (event, payload) => {
    const authorization = authorizePayloadRoot(payload);
    if (!authorization.ok) return { ...authorization, session: null };
    const result = terminalService.stopCommand({
      rootPath: authorization.rootPath,
      sessionId: payload && payload.sessionId,
      sendEvent: (terminalEvent) => sendTerminalEvent(event, terminalEvent),
    });
    appendAuditEvent('project.terminal_stopped', {
      rootPath: authorization.rootPath,
      sessionId: payload && payload.sessionId,
      stopped: Boolean(result && result.stopped),
    });
    return result;
  });

  registerIpcHandler('project:terminal:clear', (event, payload) => {
    const authorization = authorizePayloadRoot(payload);
    if (!authorization.ok) return { ...authorization, session: null };
    return terminalService.clearSession({
      rootPath: authorization.rootPath,
      sessionId: payload && payload.sessionId,
      sendEvent: (terminalEvent) => sendTerminalEvent(event, terminalEvent),
    });
  });

  registerIpcHandler('project:terminal:close', (_, payload) => {
    const authorization = authorizePayloadRoot(payload);
    if (!authorization.ok) return authorization;
    const result = terminalService.closeSession({
      rootPath: authorization.rootPath,
      sessionId: payload && payload.sessionId,
    });
    appendAuditEvent('project.terminal_closed', {
      rootPath: authorization.rootPath,
      sessionId: payload && payload.sessionId,
      closed: Boolean(result && result.closed),
    });
    return result;
  });
}

module.exports = {
  registerTerminalHandlers,
};
