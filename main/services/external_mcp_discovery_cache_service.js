const EXTERNAL_MCP_DISCOVERY_CACHE_SCHEMA_VERSION = 'faber-external-mcp-discovery-cache-v1';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeId(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeTool(tool = {}) {
  if (!tool || typeof tool !== 'object') return null;
  const name = normalizeText(tool.name);
  if (!name) return null;
  return {
    serverId: normalizeText(tool.serverId),
    serverName: normalizeText(tool.serverName),
    name,
    normalizedName: normalizeText(tool.normalizedName) || normalizeId(name),
    mcpToolName: normalizeText(tool.mcpToolName),
    description: normalizeText(tool.description),
    inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' },
    permission: normalizeText(tool.permission) || 'read',
    riskLevel: normalizeText(tool.riskLevel) || 'low',
    riskPolicy: tool.riskPolicy && typeof tool.riskPolicy === 'object' ? tool.riskPolicy : {},
    allowed: tool.allowed === true,
    blockedReason: normalizeText(tool.blockedReason),
  };
}

function normalizeEntry(entry = {}, serverId = '') {
  const id = normalizeId(entry.serverId || serverId);
  const tools = Array.isArray(entry.tools)
    ? entry.tools.map(normalizeTool).filter(Boolean)
    : [];
  return {
    serverId: id,
    toolCount: tools.length,
    cachedAt: normalizeText(entry.cachedAt),
    discoveredAt: normalizeText(entry.discoveredAt || entry.cachedAt),
    tools,
  };
}

function createExternalMcpDiscoveryCacheService(dependencies = {}) {
  const {
    fs,
    path,
    getUserDataPath,
    storeFileName = 'external-mcp-discovery-cache.json',
    now = () => new Date().toISOString(),
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`External MCP discovery cache dependency missing: ${name}`);
  }

  function getStorePath() {
    requireDependency('fs', fs);
    requireDependency('path', path);
    requireDependency('getUserDataPath', getUserDataPath);
    const root = getUserDataPath();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    return path.join(root, storeFileName);
  }

  function readRawStore() {
    const storePath = getStorePath();
    if (!fs.existsSync(storePath)) {
      return {
        schemaVersion: EXTERNAL_MCP_DISCOVERY_CACHE_SCHEMA_VERSION,
        updatedAt: now(),
        entries: {},
      };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const entries = parsed && parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)
        ? parsed.entries
        : {};
      return {
        schemaVersion: EXTERNAL_MCP_DISCOVERY_CACHE_SCHEMA_VERSION,
        updatedAt: normalizeText(parsed && parsed.updatedAt) || now(),
        entries: Object.keys(entries).reduce((acc, serverId) => {
          const entry = normalizeEntry(entries[serverId], serverId);
          if (entry.serverId) acc[entry.serverId] = entry;
          return acc;
        }, {}),
      };
    } catch {
      return {
        schemaVersion: EXTERNAL_MCP_DISCOVERY_CACHE_SCHEMA_VERSION,
        updatedAt: now(),
        entries: {},
      };
    }
  }

  function writeRawStore(entries = {}) {
    const storePath = getStorePath();
    const normalizedEntries = Object.keys(entries || {}).reduce((acc, serverId) => {
      const entry = normalizeEntry(entries[serverId], serverId);
      if (entry.serverId) acc[entry.serverId] = entry;
      return acc;
    }, {});
    const store = {
      schemaVersion: EXTERNAL_MCP_DISCOVERY_CACHE_SCHEMA_VERSION,
      updatedAt: now(),
      entries: normalizedEntries,
    };
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
    return store;
  }

  function getDiscovery(serverId = '') {
    const id = normalizeId(serverId);
    if (!id) return null;
    const store = readRawStore();
    return store.entries[id] || null;
  }

  function listDiscoveries() {
    const store = readRawStore();
    return {
      ok: true,
      schemaVersion: store.schemaVersion,
      updatedAt: store.updatedAt,
      discoveries: Object.values(store.entries),
    };
  }

  function setDiscovery(serverId = '', discovery = {}) {
    const id = normalizeId(serverId || discovery.serverId);
    if (!id) return { ok: false, message: 'Cache de discovery MCP sem serverId.' };
    const store = readRawStore();
    const tools = Array.isArray(discovery.tools) ? discovery.tools : [];
    const entry = normalizeEntry({
      serverId: id,
      cachedAt: now(),
      discoveredAt: normalizeText(discovery.discoveredAt) || now(),
      tools,
    }, id);
    const saved = writeRawStore({ ...store.entries, [id]: entry });
    return {
      ok: true,
      discovery: saved.entries[id],
      updatedAt: saved.updatedAt,
    };
  }

  function clearDiscovery(serverId = '') {
    const id = normalizeId(serverId);
    const store = readRawStore();
    if (!id) {
      const saved = writeRawStore({});
      return { ok: true, cleared: true, updatedAt: saved.updatedAt };
    }
    const nextEntries = { ...store.entries };
    const cleared = Boolean(nextEntries[id]);
    delete nextEntries[id];
    const saved = writeRawStore(nextEntries);
    return {
      ok: true,
      cleared,
      updatedAt: saved.updatedAt,
    };
  }

  function attachDiscoveryCache(servers = []) {
    const store = readRawStore();
    return (Array.isArray(servers) ? servers : []).map((server) => {
      const id = normalizeId(server && server.id);
      return {
        ...server,
        discoveryCache: id && store.entries[id] ? store.entries[id] : null,
      };
    });
  }

  return {
    attachDiscoveryCache,
    clearDiscovery,
    getDiscovery,
    listDiscoveries,
    setDiscovery,
  };
}

module.exports = {
  EXTERNAL_MCP_DISCOVERY_CACHE_SCHEMA_VERSION,
  createExternalMcpDiscoveryCacheService,
};
