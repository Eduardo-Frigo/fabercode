const EXTERNAL_MCP_PRESET_REGISTRY_SCHEMA_VERSION = 'faber-external-mcp-preset-registry-v1';

const BUILTIN_EXTERNAL_MCP_PRESETS = [
  {
    id: 'official-filesystem',
    name: 'Official Filesystem MCP',
    description: 'Servidor oficial de filesystem via stdio, escopado ao projeto e com escrita bloqueada por padrão.',
    server: {
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem'],
      trust: 'untrusted',
      permission: 'write',
      allowedTools: ['list_directory', 'read_file', 'search_files', 'get_file_info', 'directory_tree'],
      blockedTools: ['write_file', 'edit_file', 'create_directory', 'move_file'],
      riskPolicy: {
        maxRiskLevel: 'medium',
        allowedPermissions: ['read'],
        blockedRiskLevels: ['critical', 'high'],
        requireExplicitAllowForHighRisk: true,
      },
      scopePolicy: {
        enforceProjectRoot: true,
        allowedDirectories: ['.'],
        blockedDirectories: ['.git', 'node_modules', '.next'],
        allowExternalNetwork: false,
        allowedNetworkHosts: ['localhost', '127.0.0.1', '::1'],
      },
      injectProjectSessionArgument: false,
    },
  },
  {
    id: 'deepwiki-public',
    name: 'DeepWiki Public MCP',
    description: 'Endpoint publico HTTP/SSE para leitura de documentacao de repositorios publicos sem credenciais.',
    server: {
      transport: 'http',
      endpoint: 'https://mcp.deepwiki.com/mcp',
      trust: 'untrusted',
      permission: 'read',
      allowedTools: ['read_wiki_structure', 'read_wiki_contents', 'ask_question'],
      blockedTools: [],
      riskPolicy: {
        maxRiskLevel: 'medium',
        allowedPermissions: ['read'],
        blockedRiskLevels: ['critical', 'high'],
        requireExplicitAllowForHighRisk: true,
      },
      scopePolicy: {
        enforceProjectRoot: true,
        allowedDirectories: ['.'],
        blockedDirectories: ['.git', 'node_modules', '.next'],
        allowExternalNetwork: true,
        allowedNetworkHosts: ['mcp.deepwiki.com'],
        blockedNetworkHosts: [],
      },
      injectProjectSessionArgument: false,
    },
  },
  {
    id: 'playwright-browser',
    name: 'Playwright Browser MCP',
    description: 'Preset para automacao visual/browser via Playwright MCP, mantido em alto controle de risco.',
    server: {
      transport: 'stdio',
      command: 'npx',
      args: ['@playwright/mcp@latest'],
      trust: 'untrusted',
      permission: 'write',
      allowedTools: [],
      blockedTools: ['browser_file_upload', 'browser_press_key'],
      riskPolicy: {
        maxRiskLevel: 'high',
        allowedPermissions: ['read', 'write'],
        blockedRiskLevels: ['critical'],
        requireExplicitAllowForHighRisk: true,
      },
      scopePolicy: {
        enforceProjectRoot: true,
        allowedDirectories: ['.faber', 'src', 'app', 'public'],
        blockedDirectories: ['.git', 'node_modules', '.next'],
        allowExternalNetwork: false,
        allowedNetworkHosts: ['localhost', '127.0.0.1', '::1'],
        blockedNetworkHosts: [],
      },
      injectProjectSessionArgument: false,
    },
  },
  {
    id: 'github-readonly',
    name: 'GitHub MCP Read-only',
    description: 'Preset para GitHub MCP com token via env e permissao local de leitura por padrao.',
    server: {
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: 'cole-token-aqui',
      },
      trust: 'untrusted',
      permission: 'read',
      allowedTools: [],
      blockedTools: ['create_repository', 'push_files', 'create_issue', 'create_pull_request'],
      riskPolicy: {
        maxRiskLevel: 'medium',
        allowedPermissions: ['read'],
        blockedRiskLevels: ['critical', 'high'],
        requireExplicitAllowForHighRisk: true,
      },
      scopePolicy: {
        enforceProjectRoot: true,
        allowedDirectories: ['.'],
        blockedDirectories: ['.git', 'node_modules', '.next'],
        allowExternalNetwork: true,
        allowedNetworkHosts: ['api.github.com', 'github.com'],
        blockedNetworkHosts: [],
      },
      injectProjectSessionArgument: false,
    },
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePresetId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createExternalMcpPresetRegistryService(dependencies = {}) {
  const {
    presets = BUILTIN_EXTERNAL_MCP_PRESETS,
    now = () => new Date().toISOString(),
  } = dependencies;

  function listPresets() {
    return {
      ok: true,
      schemaVersion: EXTERNAL_MCP_PRESET_REGISTRY_SCHEMA_VERSION,
      updatedAt: now(),
      presets: presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        transport: preset.server && preset.server.transport ? preset.server.transport : 'stdio',
        permission: preset.server && preset.server.permission ? preset.server.permission : 'read',
        requiresSecrets: Boolean(preset.server && preset.server.env && Object.keys(preset.server.env).length),
      })),
    };
  }

  function getPreset(presetId = '') {
    const id = normalizePresetId(presetId);
    const preset = presets.find((entry) => entry.id === id) || null;
    if (!preset) return { ok: false, message: 'Preset MCP não encontrado.' };
    return { ok: true, preset: clone(preset) };
  }

  function buildServerFromPreset(presetId = '', overrides = {}) {
    const found = getPreset(presetId);
    if (!found.ok) return found;
    const preset = found.preset;
    const server = {
      ...(preset.server || {}),
      ...(overrides || {}),
      id: overrides.id || preset.id,
      name: overrides.name || preset.name,
      description: overrides.description || preset.description,
      presetId: preset.id,
    };
    return {
      ok: true,
      schemaVersion: EXTERNAL_MCP_PRESET_REGISTRY_SCHEMA_VERSION,
      preset,
      server,
    };
  }

  return {
    buildServerFromPreset,
    getPreset,
    listPresets,
  };
}

module.exports = {
  BUILTIN_EXTERNAL_MCP_PRESETS,
  EXTERNAL_MCP_PRESET_REGISTRY_SCHEMA_VERSION,
  createExternalMcpPresetRegistryService,
  normalizePresetId,
};
