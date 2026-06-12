const EXTERNAL_MCP_SERVER_REGISTRY_SCHEMA_VERSION = 'faber-external-mcp-server-registry-v1';
const {
  normalizeRiskPolicy,
  normalizeScopePolicy,
} = require('./external_mcp_tool_policy_service');

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
  if (Array.isArray(value)) return value.map((entry) => normalizeText(entry)).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
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

function parseRecordText(value = '') {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0) return acc;
      const key = normalizeText(entry.slice(0, separatorIndex));
      if (!key) return acc;
      acc[key] = entry.slice(separatorIndex + 1).trim();
      return acc;
    }, {});
}

function normalizeSecretRecord(value = {}) {
  if (typeof value === 'string') return parseRecordText(value);
  return normalizeRecord(value);
}

function maskSecret(value = '') {
  const text = String(value || '');
  if (!text) return '';
  const tail = text.slice(-4);
  return `${'*'.repeat(Math.max(4, Math.min(12, text.length)))}${tail}`;
}

function maskRecord(record = {}) {
  return Object.keys(record || {}).reduce((acc, key) => {
    acc[key] = maskSecret(record[key]);
    return acc;
  }, {});
}

function isMaskedSecret(value = '') {
  return /^\*{4,}.+/.test(String(value || ''));
}

function mergeSecretRecord(nextRecord = {}, previousRecord = {}) {
  const next = normalizeSecretRecord(nextRecord);
  const previous = normalizeSecretRecord(previousRecord);
  return Object.keys(next).reduce((acc, key) => {
    acc[key] = isMaskedSecret(next[key]) && previous[key] ? previous[key] : next[key];
    return acc;
  }, {});
}

function normalizeTransport(value = '') {
  const normalized = normalizeId(value);
  if (normalized === 'http' || normalized === 'sse' || normalized === 'stdio') return normalized;
  return 'stdio';
}

function normalizeTrust(value = '') {
  const normalized = normalizeId(value);
  return normalized === 'approved' ? 'approved' : 'untrusted';
}

function normalizePermission(value = '') {
  const normalized = normalizeId(value);
  if (normalized === 'write') return 'write';
  return 'read';
}

function sanitizeServer(input = {}, fallbackIndex = 0, previousServer = null) {
  const transport = normalizeTransport(input.transport || input.transportKind || input.type);
  const name = normalizeText(input.name || input.label || input.id) || `MCP externo ${fallbackIndex + 1}`;
  const id = normalizeId(input.id || name) || `mcp_server_${fallbackIndex + 1}`;
  const server = {
    id,
    name,
    description: normalizeText(input.description),
    presetId: normalizeId(input.presetId || input.preset),
    enabled: input.enabled !== false,
    trust: normalizeTrust(input.trust || input.trustLevel),
    permission: normalizePermission(input.permission),
    transport,
    protocolVersion: normalizeText(input.protocolVersion) || '2025-06-18',
    command: '',
    args: [],
    cwd: '',
    env: {},
    endpoint: '',
    headers: {},
    requestTimeoutMs: Math.max(500, Math.min(120000, Number(input.requestTimeoutMs || input.timeoutMs || 8000) || 8000)),
    allowedTools: normalizeList(input.allowedTools),
    blockedTools: normalizeList(input.blockedTools),
    riskPolicy: normalizeRiskPolicy(input.riskPolicy || {}),
    scopePolicy: normalizeScopePolicy(input.scopePolicy || {}),
    requiresProjectSession: input.requiresProjectSession !== false,
    injectProjectSessionArgument: input.injectProjectSessionArgument === true,
  };

  if (transport === 'stdio') {
    server.command = normalizeText(input.command);
    server.args = normalizeList(input.args);
    server.cwd = normalizeText(input.cwd);
    server.env = mergeSecretRecord(input.env, previousServer && previousServer.transport === 'stdio' ? previousServer.env : {});
  } else {
    server.endpoint = normalizeText(input.endpoint || input.url);
    server.headers = mergeSecretRecord(input.headers, previousServer && previousServer.transport !== 'stdio' ? previousServer.headers : {});
  }

  return server;
}

function publicServerView(server = {}) {
  const transport = normalizeTransport(server.transport);
  return {
    ...server,
    env: transport === 'stdio' ? maskRecord(server.env || {}) : {},
    headers: transport === 'stdio' ? {} : maskRecord(server.headers || {}),
    hasEnv: Boolean(server.env && Object.keys(server.env).length),
    hasHeaders: Boolean(server.headers && Object.keys(server.headers).length),
    ready: transport === 'stdio'
      ? Boolean(server.command)
      : Boolean(server.endpoint),
  };
}

function createExternalMcpServerRegistryService(dependencies = {}) {
  const {
    fs,
    path,
    getUserDataPath,
    storeFileName = 'external-mcp-servers.json',
    now = () => new Date().toISOString(),
    protectSecret = (value) => String(value || ''),
    unprotectSecret = (value) => String(value || ''),
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`External MCP server registry dependency missing: ${name}`);
  }

  function getStorePath() {
    requireDependency('fs', fs);
    requireDependency('path', path);
    requireDependency('getUserDataPath', getUserDataPath);
    const root = getUserDataPath();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    return path.join(root, storeFileName);
  }

  function transformSecretRecord(record = {}, transformer = (value) => value) {
    return Object.keys(record || {}).reduce((acc, key) => {
      acc[key] = transformer(String(record[key] || ''));
      return acc;
    }, {});
  }

  function unprotectServerSecrets(server = {}) {
    const transport = normalizeTransport(server.transport);
    return {
      ...server,
      env: transport === 'stdio' ? transformSecretRecord(server.env || {}, unprotectSecret) : {},
      headers: transport === 'stdio' ? {} : transformSecretRecord(server.headers || {}, unprotectSecret),
    };
  }

  function protectServerSecrets(server = {}) {
    const transport = normalizeTransport(server.transport);
    return {
      ...server,
      env: transport === 'stdio' ? transformSecretRecord(server.env || {}, protectSecret) : {},
      headers: transport === 'stdio' ? {} : transformSecretRecord(server.headers || {}, protectSecret),
    };
  }

  function readRawStore() {
    const storePath = getStorePath();
    if (!fs.existsSync(storePath)) {
      return {
        schemaVersion: EXTERNAL_MCP_SERVER_REGISTRY_SCHEMA_VERSION,
        updatedAt: now(),
        servers: [],
      };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      const servers = Array.isArray(parsed && parsed.servers) ? parsed.servers : [];
      return {
        schemaVersion: EXTERNAL_MCP_SERVER_REGISTRY_SCHEMA_VERSION,
        updatedAt: normalizeText(parsed && parsed.updatedAt) || now(),
        servers: servers.map((server, index) => sanitizeServer(unprotectServerSecrets(server), index)),
      };
    } catch {
      return {
        schemaVersion: EXTERNAL_MCP_SERVER_REGISTRY_SCHEMA_VERSION,
        updatedAt: now(),
        servers: [],
      };
    }
  }

  function writeRawStore(servers = []) {
    const storePath = getStorePath();
    const normalizedServers = servers.map((server, index) => sanitizeServer(server, index));
    const persistedStore = {
      schemaVersion: EXTERNAL_MCP_SERVER_REGISTRY_SCHEMA_VERSION,
      updatedAt: now(),
      servers: normalizedServers.map(protectServerSecrets),
    };
    fs.writeFileSync(storePath, JSON.stringify(persistedStore, null, 2), 'utf8');
    return {
      ...persistedStore,
      servers: normalizedServers,
    };
  }

  function listServers({ includeSecrets = false } = {}) {
    const store = readRawStore();
    return {
      ok: true,
      schemaVersion: store.schemaVersion,
      updatedAt: store.updatedAt,
      servers: includeSecrets ? store.servers : store.servers.map(publicServerView),
    };
  }

  function upsertServer(input = {}) {
    const store = readRawStore();
    const nextId = normalizeId(input.id || input.name || input.label);
    const previousServer = store.servers.find((server) => server.id === nextId) || null;
    const nextServer = sanitizeServer(input, store.servers.length, previousServer);
    const index = store.servers.findIndex((server) => server.id === nextServer.id);
    const servers = index >= 0
      ? store.servers.map((server, serverIndex) => (serverIndex === index ? nextServer : server))
      : [...store.servers, nextServer];
    const saved = writeRawStore(servers);
    return {
      ok: true,
      server: publicServerView(nextServer),
      servers: saved.servers.map(publicServerView),
      updatedAt: saved.updatedAt,
    };
  }

  function removeServer(serverId = '') {
    const id = normalizeId(serverId);
    if (!id) return { ok: false, message: 'Servidor MCP externo sem id.' };
    const store = readRawStore();
    const servers = store.servers.filter((server) => server.id !== id);
    const removed = servers.length !== store.servers.length;
    const saved = writeRawStore(servers);
    return {
      ok: removed,
      removed,
      servers: saved.servers.map(publicServerView),
      message: removed ? 'Servidor MCP externo removido.' : 'Servidor MCP externo não encontrado.',
      updatedAt: saved.updatedAt,
    };
  }

  function getServer(serverId = '', { includeSecrets = false } = {}) {
    const id = normalizeId(serverId);
    const store = readRawStore();
    const server = store.servers.find((entry) => entry.id === id) || null;
    if (!server) return { ok: false, message: 'Servidor MCP externo não encontrado.' };
    return { ok: true, server: includeSecrets ? server : publicServerView(server) };
  }

  return {
    getServer,
    listServers,
    removeServer,
    sanitizeServer,
    upsertServer,
  };
}

module.exports = {
  EXTERNAL_MCP_SERVER_REGISTRY_SCHEMA_VERSION,
  createExternalMcpServerRegistryService,
  sanitizeExternalMcpServer: sanitizeServer,
};
