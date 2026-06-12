const { normalizeProjectSession } = require('../../cortex/capabilities/capability_result');
const {
  evaluateToolScopePolicy,
  evaluateToolPolicy,
  normalizeRiskPolicy,
  normalizeScopePolicy,
} = require('./external_mcp_tool_policy_service');

const EXTERNAL_MCP_BRIDGE_SCHEMA_VERSION = 'faber-external-mcp-bridge-v1';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeId(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeList(value = []) {
  return Array.isArray(value)
    ? value.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
}

function normalizeRecord(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.keys(value).reduce((acc, key) => {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) return acc;
    acc[normalizedKey] = String(value[key] || '');
    return acc;
  }, {});
}

function normalizeServerConfig(server = {}) {
  const id = normalizeId(server.id || server.name);
  return {
    id,
    name: normalizeText(server.name) || id,
    description: normalizeText(server.description),
    protocolVersion: normalizeText(server.protocolVersion),
    transport: normalizeText(server.transport || server.transportId || id),
    command: normalizeText(server.command),
    args: normalizeList(server.args),
    cwd: normalizeText(server.cwd),
    env: normalizeRecord(server.env),
    endpoint: normalizeText(server.endpoint || server.url),
    headers: normalizeRecord(server.headers),
    requestTimeoutMs: Number(server.requestTimeoutMs || server.timeoutMs || 0),
    enabled: server.enabled !== false,
    trust: normalizeId(server.trust || server.trustLevel || 'untrusted'),
    permission: normalizeId(server.permission || 'read') || 'read',
    allowedTools: normalizeList(server.allowedTools),
    blockedTools: normalizeList(server.blockedTools),
    riskPolicy: normalizeRiskPolicy(server.riskPolicy),
    scopePolicy: normalizeScopePolicy(server.scopePolicy),
    requiresProjectSession: server.requiresProjectSession !== false,
    injectProjectSessionArgument: server.injectProjectSessionArgument === true,
  };
}

function normalizeExternalTool(server, tool = {}) {
  const name = normalizeText(tool.name);
  const normalizedName = normalizeId(name);
  const allowedByList = !server.allowedTools.length || server.allowedTools.includes(name) || server.allowedTools.includes(normalizedName);
  const blockedByList = server.blockedTools.includes(name) || server.blockedTools.includes(normalizedName);
  const policy = evaluateToolPolicy({ server, tool, allowedByList, blockedByList });
  const allowed = Boolean(server.enabled && server.trust === 'approved' && allowedByList && policy.allowedByRiskPolicy);
  return {
    serverId: server.id,
    serverName: server.name,
    name,
    normalizedName,
    mcpToolName: name ? `external_mcp.${server.id}.${normalizedName}` : '',
    description: normalizeText(tool.description),
    inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' },
    permission: policy.permission,
    riskLevel: policy.riskLevel,
    riskPolicy: policy.riskPolicy,
    allowed,
    blockedReason: allowed
      ? ''
      : !server.enabled
        ? 'server_disabled'
        : server.trust !== 'approved'
          ? 'server_not_approved'
          : blockedByList
            ? 'tool_blocked_by_policy'
            : !allowedByList
              ? 'tool_not_allowed_by_policy'
              : policy.blockedReason || 'tool_unavailable',
  };
}

function extractToolsFromResponse(response = {}) {
  if (Array.isArray(response.tools)) return response.tools;
  if (response.result && Array.isArray(response.result.tools)) return response.result.tools;
  return [];
}

function extractArtifactsFromToolResult(result = {}) {
  const artifacts = [];
  const pushArtifact = (value) => {
    const text = normalizeText(value);
    if (text && !artifacts.includes(text)) artifacts.push(text);
  };
  if (Array.isArray(result.artifacts)) {
    result.artifacts.forEach(pushArtifact);
  }
  const content = Array.isArray(result.content)
    ? result.content
    : result.result && Array.isArray(result.result.content)
      ? result.result.content
      : [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    pushArtifact(item.path || item.artifactPath || item.uri || '');
  }
  return artifacts;
}

function summarizeToolResult(result = {}) {
  const content = Array.isArray(result.content)
    ? result.content
    : result.result && Array.isArray(result.result.content)
      ? result.result.content
      : [];
  return {
    isError: Boolean(result.isError || result.error),
    contentTypes: content.map((item) => normalizeText(item && item.type)).filter(Boolean),
    structuredContent: result.structuredContent || result.result && result.result.structuredContent || null,
    artifacts: extractArtifactsFromToolResult(result),
  };
}

function createExternalMcpBridgeService(dependencies = {}) {
  const {
    servers = [],
    transports = {},
    transportFactory = null,
    now = () => new Date().toISOString(),
  } = dependencies;

  const serverMap = new Map();
  for (const server of servers.map(normalizeServerConfig)) {
    if (!server.id) continue;
    if (serverMap.has(server.id)) throw new Error(`Servidor MCP externo duplicado: ${server.id}`);
    serverMap.set(server.id, server);
  }

  const discoveryCache = new Map();
  const initializedServers = new Set();
  const generatedTransports = new Map();

  function listServers() {
    return Array.from(serverMap.values()).map((server) => ({
      schemaVersion: EXTERNAL_MCP_BRIDGE_SCHEMA_VERSION,
      id: server.id,
      name: server.name,
      description: server.description,
      protocolVersion: server.protocolVersion || '2025-06-18',
      transport: server.transport,
      endpoint: server.endpoint || '',
      command: server.transport === 'stdio' && server.command ? server.command : '',
      enabled: server.enabled,
      trust: server.trust,
      permission: server.permission,
      allowedTools: server.allowedTools,
      blockedTools: server.blockedTools,
      riskPolicy: server.riskPolicy,
      scopePolicy: server.scopePolicy,
      requiresProjectSession: server.requiresProjectSession,
      injectProjectSessionArgument: server.injectProjectSessionArgument,
      status: server.enabled && server.trust === 'approved' ? 'available' : 'blocked',
    }));
  }

  function resolveServer(serverId = '') {
    const normalized = normalizeId(serverId);
    const server = serverMap.get(normalized);
    if (!server) {
      return { ok: false, status: 'blocked', message: `Servidor MCP externo não registrado: ${serverId || '<vazio>'}.`, errors: ['external_mcp_server_not_registered'] };
    }
    return { ok: true, server };
  }

  function resolveTransport(server) {
    const transport = transports[server.id] || transports[server.transport] || generatedTransports.get(server.id);
    if (!transport || typeof transport.request !== 'function') {
      if (transportFactory && typeof transportFactory.createTransport === 'function') {
        const generated = transportFactory.createTransport(server);
        if (generated && typeof generated.request === 'function') {
          generatedTransports.set(server.id, generated);
          return { ok: true, transport: generated };
        }
      }
      if (typeof transportFactory === 'function') {
        const generated = transportFactory(server);
        if (generated && typeof generated.request === 'function') {
          generatedTransports.set(server.id, generated);
          return { ok: true, transport: generated };
        }
      }
      return { ok: false, status: 'blocked', message: `Transporte MCP externo indisponível: ${server.id}.`, errors: ['external_mcp_transport_unavailable'] };
    }
    return { ok: true, transport };
  }

  function closeTransports() {
    const closed = [];
    const seen = new Set();
    for (const [id, transport] of generatedTransports.entries()) {
      if (!transport || seen.has(transport) || typeof transport.close !== 'function') continue;
      seen.add(transport);
      closed.push({ id, result: transport.close() });
    }
    for (const [id, transport] of Object.entries(transports || {})) {
      if (!transport || seen.has(transport) || typeof transport.close !== 'function') continue;
      seen.add(transport);
      closed.push({ id, result: transport.close() });
    }
    return { ok: true, closed };
  }

  async function initializeServer(server, transport, projectSession = {}) {
    if (initializedServers.has(server.id)) return { ok: true, skipped: true };
    const initialized = await transport.request('initialize', {
      protocolVersion: normalizeText(server.protocolVersion) || '2025-06-18',
      clientInfo: { name: 'Faber Code', version: EXTERNAL_MCP_BRIDGE_SCHEMA_VERSION },
      capabilities: { tools: {} },
      projectSession: normalizeProjectSession(projectSession),
    });
    if (initialized && initialized.error) {
      return {
        ok: false,
        status: 'failed',
        message: initialized.error.message || 'Falha no initialize do servidor MCP externo.',
        errors: ['external_mcp_initialize_failed'],
        data: { initialize: initialized },
      };
    }
    if (typeof transport.notify === 'function') {
      const notified = await transport.notify('notifications/initialized', {});
      if (notified && notified.error) {
        return {
          ok: false,
          status: 'failed',
          message: notified.error.message || 'Falha ao confirmar initialize do servidor MCP externo.',
          errors: ['external_mcp_initialized_notification_failed'],
          data: { notification: notified },
        };
      }
    }
    initializedServers.add(server.id);
    return { ok: true, data: { initialize: initialized || {} } };
  }

  async function discoverTools({ serverId, projectSession = {}, refresh = false } = {}) {
    if (!normalizeId(serverId)) {
      const discoveries = [];
      for (const server of serverMap.values()) {
        const discovery = await discoverTools({ serverId: server.id, projectSession, refresh });
        discoveries.push({
          serverId: server.id,
          ok: Boolean(discovery && discovery.ok),
          status: discovery && discovery.status ? discovery.status : '',
          message: discovery && discovery.message ? discovery.message : '',
          errors: discovery && Array.isArray(discovery.errors) ? discovery.errors : [],
          tools: discovery && discovery.data && Array.isArray(discovery.data.tools) ? discovery.data.tools : [],
        });
      }
      const failed = discoveries.filter((entry) => !entry.ok);
      return {
        ok: failed.length === 0,
        status: failed.length === 0 ? 'succeeded' : 'failed',
        message: failed.length === 0
          ? 'Tools MCP externas descobertas em todos os servidores configurados.'
          : 'Uma ou mais descobertas MCP externas falharam.',
        errors: failed.flatMap((entry) => entry.errors),
        artifacts: [],
        data: {
          schemaVersion: EXTERNAL_MCP_BRIDGE_SCHEMA_VERSION,
          servers: listServers(),
          discoveries,
          tools: discoveries.flatMap((entry) => entry.tools),
          discoveredAt: now(),
        },
      };
    }

    const resolved = resolveServer(serverId);
    if (!resolved.ok) return resolved;
    const { server } = resolved;
    const transportResult = resolveTransport(server);
    if (!transportResult.ok) return transportResult;
    const { transport } = transportResult;

    if (!refresh && discoveryCache.has(server.id)) {
      return {
        ok: true,
        status: 'succeeded',
        message: 'Tools MCP externas recuperadas do cache.',
        artifacts: [],
        data: {
          schemaVersion: EXTERNAL_MCP_BRIDGE_SCHEMA_VERSION,
          server: listServers().find((entry) => entry.id === server.id),
          tools: discoveryCache.get(server.id),
          cached: true,
          discoveredAt: now(),
        },
      };
    }

    const initialized = await initializeServer(server, transport, projectSession);
    if (!initialized.ok) return initialized;
    const listed = await transport.request('tools/list', {}, { projectSession: normalizeProjectSession(projectSession) });
    if (listed && listed.error) {
      return {
        ok: false,
        status: 'failed',
        message: listed.error.message || 'Falha ao listar tools MCP externas.',
        errors: ['external_mcp_tools_list_failed'],
        data: { response: listed },
      };
    }
    const tools = extractToolsFromResponse(listed).map((tool) => normalizeExternalTool(server, tool));
    discoveryCache.set(server.id, tools);
    return {
      ok: true,
      status: 'succeeded',
      message: 'Tools MCP externas descobertas.',
      artifacts: [],
      data: {
        schemaVersion: EXTERNAL_MCP_BRIDGE_SCHEMA_VERSION,
        server: listServers().find((entry) => entry.id === server.id),
        tools,
        cached: false,
        discoveredAt: now(),
      },
    };
  }

  async function callTool({ serverId, toolName, arguments: toolArguments = {}, projectSession = {} } = {}) {
    const resolved = resolveServer(serverId);
    if (!resolved.ok) return resolved;
    const { server } = resolved;
    if (server.requiresProjectSession && !normalizeText(projectSession.rootPath)) {
      return {
        ok: false,
        status: 'blocked',
        message: 'Tool MCP externa sem raiz de projeto autorizada.',
        errors: ['external_mcp_project_session_required'],
      };
    }
    const transportResult = resolveTransport(server);
    if (!transportResult.ok) return transportResult;
    const { transport } = transportResult;

    const discovery = await discoverTools({ serverId: server.id, projectSession });
    if (!discovery.ok) return discovery;
    const normalizedToolName = normalizeId(toolName);
    const tool = discovery.data.tools.find((entry) => entry.name === toolName || entry.normalizedName === normalizedToolName);
    if (!tool) {
      return {
        ok: false,
        status: 'blocked',
        message: `Tool MCP externa não descoberta: ${toolName || '<vazia>'}.`,
        errors: ['external_mcp_tool_not_discovered'],
        data: { availableTools: discovery.data.tools.map((entry) => entry.name) },
      };
    }
    if (!tool.allowed) {
      return {
        ok: false,
        status: 'blocked',
        message: `Tool MCP externa bloqueada por política: ${tool.name}.`,
        errors: [tool.blockedReason || 'external_mcp_tool_blocked'],
        data: { tool },
      };
    }

    const normalizedSession = normalizeProjectSession(projectSession);
    const externalArguments = toolArguments && typeof toolArguments === 'object' ? { ...toolArguments } : {};
    const scopeEvaluation = evaluateToolScopePolicy({
      server,
      tool,
      arguments: externalArguments,
      projectSession: normalizedSession,
    });
    if (!scopeEvaluation.allowed) {
      return {
        ok: false,
        status: 'blocked',
        message: `Tool MCP externa bloqueada por escopo: ${tool.name}.`,
        errors: [scopeEvaluation.blockedReason || 'external_mcp_scope_policy_blocked'],
        data: {
          tool,
          scopePolicy: scopeEvaluation.scopePolicy,
          violations: scopeEvaluation.violations,
        },
      };
    }
    if (server.injectProjectSessionArgument) externalArguments.projectSession = normalizedSession;
    const response = await transport.request('tools/call', {
      name: tool.name,
      arguments: externalArguments,
    }, { projectSession: normalizedSession, tool });
    const summary = summarizeToolResult(response || {});
    const failed = Boolean(response && (response.error || response.isError));
    return {
      ok: !failed,
      status: failed ? 'failed' : 'succeeded',
      message: failed
        ? response.error && response.error.message ? response.error.message : `Tool MCP externa falhou: ${tool.name}.`
        : `Tool MCP externa executada: ${tool.name}.`,
      artifacts: summary.artifacts,
      errors: failed ? ['external_mcp_tool_call_failed'] : [],
      data: {
        schemaVersion: EXTERNAL_MCP_BRIDGE_SCHEMA_VERSION,
        server: {
          id: server.id,
          name: server.name,
          transport: server.transport,
        },
        tool,
        result: summary,
        calledAt: now(),
      },
      result: response || {},
    };
  }

  return {
    callTool,
    close: closeTransports,
    discoverTools,
    listServers,
  };
}

module.exports = {
  EXTERNAL_MCP_BRIDGE_SCHEMA_VERSION,
  createExternalMcpBridgeService,
};
