const { createExternalMcpBridgeService } = require('../services/external_mcp_bridge_service');
const { createExternalMcpTransportFactory } = require('../services/external_mcp_transport_factory_service');

function registerExternalMcpHandlers(dependencies = {}) {
  const {
    appendAuditEvent,
    authorizeProjectRoot,
    discoveryCacheService = null,
    presetRegistryService = null,
    registryService,
    registerIpcHandler,
    resetCapabilityRuntime = () => {},
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`External MCP IPC dependency missing: ${name}`);
  }

  function audit(type, payload = {}) {
    if (typeof appendAuditEvent === 'function') appendAuditEvent(type, payload);
  }

  function buildProjectSession(projectInfo = {}) {
    const rootPath = String(projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '').trim();
    if (!rootPath) return { ok: true, projectSession: {} };
    if (typeof authorizeProjectRoot !== 'function') {
      return { ok: false, message: 'Autorização de projeto indisponível para MCP externo.' };
    }
    const authorized = authorizeProjectRoot(rootPath);
    if (!authorized || !authorized.ok) return authorized;
    return {
      ok: true,
      projectSession: {
        rootPath: authorized.rootPath || rootPath,
        projectId: String(projectInfo.id || projectInfo.projectId || ''),
        projectName: String(projectInfo.name || projectInfo.projectName || ''),
        jobId: String(projectInfo.jobId || ''),
      },
    };
  }

  function createBridge() {
    const registry = registryService.listServers({ includeSecrets: true });
    return createExternalMcpBridgeService({
      servers: registry.servers || [],
      transportFactory: createExternalMcpTransportFactory(),
    });
  }

  function attachDiscoveryCache(servers = []) {
    if (!discoveryCacheService || typeof discoveryCacheService.attachDiscoveryCache !== 'function') return servers;
    return discoveryCacheService.attachDiscoveryCache(servers);
  }

  function listServersWithCache() {
    const listed = registryService.listServers();
    return {
      ...listed,
      servers: attachDiscoveryCache(listed.servers || []),
    };
  }

  function persistDiscovery(serverId = '', result = {}) {
    if (!discoveryCacheService || typeof discoveryCacheService.setDiscovery !== 'function') return null;
    if (!result || !result.ok || !result.data) return null;
    if (serverId && Array.isArray(result.data.tools)) {
      return discoveryCacheService.setDiscovery(serverId, {
        discoveredAt: result.data.discoveredAt,
        tools: result.data.tools,
      });
    }
    if (Array.isArray(result.data.discoveries)) {
      return result.data.discoveries
        .filter((entry) => entry && entry.ok && Array.isArray(entry.tools))
        .map((entry) => discoveryCacheService.setDiscovery(entry.serverId, {
          discoveredAt: result.data.discoveredAt,
          tools: entry.tools,
        }));
    }
    return null;
  }

  requireDependency('registryService', registryService);
  requireDependency('registerIpcHandler', registerIpcHandler);

  registerIpcHandler('external-mcp:servers:list', () => {
    return listServersWithCache();
  });

  if (presetRegistryService && typeof presetRegistryService.listPresets === 'function') {
    registerIpcHandler('external-mcp:presets:list', () => {
      return presetRegistryService.listPresets();
    });

    registerIpcHandler('external-mcp:presets:apply', (_, payload = {}) => {
      const built = presetRegistryService.buildServerFromPreset(payload.presetId || payload.id || '', payload.overrides || {});
      if (!built || !built.ok) return built;
      return {
        ...built,
        server: registryService.sanitizeServer(built.server),
      };
    });
  }

  registerIpcHandler('external-mcp:servers:save', (_, payload = {}) => {
    const saved = registryService.upsertServer(payload.server || payload);
    if (saved && saved.server && discoveryCacheService && typeof discoveryCacheService.clearDiscovery === 'function') {
      discoveryCacheService.clearDiscovery(saved.server.id);
    }
    resetCapabilityRuntime();
    audit('external_mcp.server_saved', {
      id: saved.server && saved.server.id,
      transport: saved.server && saved.server.transport,
      trust: saved.server && saved.server.trust,
      enabled: saved.server && saved.server.enabled,
    });
    return {
      ...saved,
      server: attachDiscoveryCache(saved.server ? [saved.server] : [])[0] || saved.server,
      servers: attachDiscoveryCache(saved.servers || []),
    };
  });

  registerIpcHandler('external-mcp:servers:remove', (_, payload = {}) => {
    const serverId = payload.serverId || payload.id || payload;
    const removed = registryService.removeServer(serverId);
    if (discoveryCacheService && typeof discoveryCacheService.clearDiscovery === 'function') {
      discoveryCacheService.clearDiscovery(serverId);
    }
    resetCapabilityRuntime();
    audit('external_mcp.server_removed', {
      id: serverId,
      removed: Boolean(removed.removed),
    });
    return {
      ...removed,
      servers: attachDiscoveryCache(removed.servers || []),
    };
  });

  registerIpcHandler('external-mcp:tools:discover', async (_, payload = {}) => {
    const session = buildProjectSession(payload.projectInfo || {});
    if (!session.ok) return session;
    const bridge = createBridge();
    try {
      const result = await bridge.discoverTools({
        serverId: payload.serverId || '',
        projectSession: session.projectSession,
        refresh: payload.refresh !== false,
      });
      persistDiscovery(payload.serverId || '', result);
      audit('external_mcp.tools_discovered', {
        serverId: payload.serverId || '',
        ok: Boolean(result.ok),
        toolCount: result && result.data && Array.isArray(result.data.tools) ? result.data.tools.length : 0,
      });
      return result;
    } finally {
      if (typeof bridge.close === 'function') bridge.close();
    }
  });

  registerIpcHandler('external-mcp:tools:call', async (_, payload = {}) => {
    const session = buildProjectSession(payload.projectInfo || {});
    if (!session.ok) return session;
    const bridge = createBridge();
    try {
      const result = await bridge.callTool({
        serverId: payload.serverId || '',
        toolName: payload.toolName || '',
        arguments: payload.arguments || payload.args || {},
        projectSession: session.projectSession,
      });
      audit('external_mcp.tool_called', {
        serverId: payload.serverId || '',
        toolName: payload.toolName || '',
        ok: Boolean(result.ok),
        artifactCount: Array.isArray(result.artifacts) ? result.artifacts.length : 0,
      });
      return result;
    } finally {
      if (typeof bridge.close === 'function') bridge.close();
    }
  });
}

module.exports = {
  registerExternalMcpHandlers,
};
