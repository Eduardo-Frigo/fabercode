const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createExternalMcpBridgeService } = require('../main/services/external_mcp_bridge_service');
const { createExternalMcpTransportFactory } = require('../main/services/external_mcp_transport_factory_service');

const DEEPWIKI_ENDPOINT = process.env.EXTERNAL_MCP_PUBLIC_ENDPOINT || 'https://mcp.deepwiki.com/mcp';
const DEEPWIKI_REPO = process.env.EXTERNAL_MCP_PUBLIC_REPO || 'modelcontextprotocol/servers';

function getTools(discovery) {
  return discovery && discovery.data && Array.isArray(discovery.data.tools) ? discovery.data.tools : [];
}

function getToolByName(tools, name) {
  return tools.find((tool) => tool.name === name || tool.normalizedName === name);
}

function buildReadWikiStructureArgs(tool) {
  const schema = tool && tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {};
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const propertyNames = Object.keys(properties);
  const args = {};
  const repoKey = propertyNames.find((key) => /^(repoName|repositoryName|repo|repository)$/i.test(key)) || 'repoName';
  args[repoKey] = DEEPWIKI_REPO;
  if (propertyNames.some((key) => /^owner$/i.test(key))) args.owner = DEEPWIKI_REPO.split('/')[0];
  if (propertyNames.some((key) => /^repo$/i.test(key))) args.repo = DEEPWIKI_REPO.split('/')[1];
  return args;
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-mcp-deepwiki-public-'));
  const bridge = createExternalMcpBridgeService({
    servers: [
      {
        id: 'deepwiki-public',
        name: 'DeepWiki Public MCP',
        transport: 'http',
        endpoint: DEEPWIKI_ENDPOINT,
        trust: 'approved',
        permission: 'read',
        allowedTools: ['read_wiki_structure', 'read_wiki_contents', 'ask_question'],
        blockedTools: [
          'generate_wiki',
          'devin_knowledge_manage',
          'devin_playbook_manage',
          'devin_schedule_manage',
        ],
        riskPolicy: {
          maxRiskLevel: 'medium',
          blockedRiskLevels: ['high', 'critical'],
          allowedPermissions: ['read'],
        },
        scopePolicy: {
          enforceProjectRoot: true,
          allowExternalNetwork: false,
          allowedNetworkHosts: ['localhost', '127.0.0.1', '::1'],
          blockedNetworkHosts: [],
        },
        requestTimeoutMs: 30000,
      },
    ],
    transportFactory: createExternalMcpTransportFactory(),
    now: () => '2026-05-27T20:40:00.000Z',
  });
  const projectSession = {
    rootPath: tempRoot,
    projectId: 'public-deepwiki-mcp-smoke',
    projectName: 'Public DeepWiki MCP Smoke',
  };

  try {
    const discovery = await bridge.discoverTools({
      serverId: 'deepwiki-public',
      projectSession,
      refresh: true,
    });
    assert.strictEqual(
      discovery.ok,
      true,
      discovery && discovery.message ? discovery.message : 'Falha no discovery DeepWiki publico.'
    );
    const tools = getTools(discovery);
    assert.ok(tools.length > 0, 'DeepWiki publico nao retornou tools.');
    const readStructure = getToolByName(tools, 'read_wiki_structure');
    assert.ok(readStructure, `DeepWiki publico sem read_wiki_structure. Tools: ${tools.map((tool) => tool.name).join(', ')}`);
    assert.strictEqual(readStructure.allowed, true);

    const call = await bridge.callTool({
      serverId: 'deepwiki-public',
      toolName: 'read_wiki_structure',
      arguments: buildReadWikiStructureArgs(readStructure),
      projectSession,
    });
    assert.strictEqual(
      call.ok,
      true,
      call && call.message ? call.message : 'Falha ao chamar read_wiki_structure no DeepWiki publico.'
    );
    assert.ok(call.data.result.contentTypes.includes('text') || call.data.result.structuredContent);

    const blockedNetwork = await bridge.callTool({
      serverId: 'deepwiki-public',
      toolName: 'read_wiki_structure',
      arguments: { ...buildReadWikiStructureArgs(readStructure), url: 'https://example.com/should-block' },
      projectSession,
    });
    assert.strictEqual(blockedNetwork.ok, false);
    assert.ok(blockedNetwork.errors.includes('external_mcp_network_host_not_allowed'));

    console.log(`external-mcp-public-deepwiki-smoke.test.js: ok (${tools.length} tools)`);
  } finally {
    bridge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
