const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createExternalMcpBridgeService } = require('../main/services/external_mcp_bridge_service');
const { createExternalMcpTransportFactory } = require('../main/services/external_mcp_transport_factory_service');

function getToolNames(discovery) {
  return discovery && discovery.data && Array.isArray(discovery.data.tools)
    ? discovery.data.tools.map((tool) => tool.name)
    : [];
}

async function callFirstSafeTool(bridge, toolNames, projectSession, allowedRoot, samplePath) {
  const candidates = [
    { name: 'list_allowed_directories', args: {} },
    { name: 'list_directory', args: { path: allowedRoot } },
    { name: 'directory_tree', args: { path: allowedRoot } },
    { name: 'read_text_file', args: { path: samplePath } },
    { name: 'read_file', args: { path: samplePath } },
  ];
  const candidate = candidates.find((entry) => toolNames.includes(entry.name));
  assert.ok(candidate, `Servidor MCP oficial sem tool segura esperada. Tools: ${toolNames.join(', ')}`);
  return bridge.callTool({
    serverId: 'official-filesystem',
    toolName: candidate.name,
    arguments: candidate.args,
    projectSession,
  });
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-mcp-third-party-'));
  const allowedRoot = path.join(tempRoot, 'allowed');
  const samplePath = path.join(allowedRoot, 'sample.txt');
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.writeFileSync(samplePath, 'Faber third-party MCP smoke sample.\n', 'utf8');

  const bridge = createExternalMcpBridgeService({
    servers: [
      {
        id: 'official-filesystem',
        name: 'Official MCP Filesystem',
        transport: 'stdio',
        command: process.env.EXTERNAL_MCP_THIRD_PARTY_COMMAND || 'npx',
        args: process.env.EXTERNAL_MCP_THIRD_PARTY_ARGS
          ? JSON.parse(process.env.EXTERNAL_MCP_THIRD_PARTY_ARGS)
          : ['-y', '@modelcontextprotocol/server-filesystem', allowedRoot],
        trust: 'approved',
        permission: 'read',
        blockedTools: ['write_file', 'edit_file', 'create_directory', 'move_file'],
        requestTimeoutMs: 120000,
      },
    ],
    transportFactory: createExternalMcpTransportFactory(),
    now: () => '2026-05-27T18:00:00.000Z',
  });

  const projectSession = {
    rootPath: allowedRoot,
    projectId: 'third-party-mcp-smoke',
    projectName: 'Third Party MCP Smoke',
  };

  try {
    const discovery = await bridge.discoverTools({
      serverId: 'official-filesystem',
      projectSession,
      refresh: true,
    });
    assert.strictEqual(
      discovery.ok,
      true,
      discovery && discovery.message ? discovery.message : 'Falha no discovery do servidor MCP oficial.'
    );
    const toolNames = getToolNames(discovery);
    assert.ok(toolNames.length > 0, 'Servidor MCP oficial nao retornou tools.');

    const safeCall = await callFirstSafeTool(bridge, toolNames, projectSession, allowedRoot, samplePath);
    assert.strictEqual(
      safeCall.ok,
      true,
      safeCall && safeCall.message ? safeCall.message : 'Falha ao chamar tool segura do servidor MCP oficial.'
    );

    const blockedWriteTool = ['write_file', 'edit_file', 'create_directory', 'move_file']
      .find((toolName) => toolNames.includes(toolName));
    if (blockedWriteTool) {
      const blocked = await bridge.callTool({
        serverId: 'official-filesystem',
        toolName: blockedWriteTool,
        arguments: { path: path.join(allowedRoot, 'blocked.txt'), content: 'blocked' },
        projectSession,
      });
      assert.strictEqual(blocked.ok, false);
      assert.ok(blocked.errors.includes('tool_blocked_by_policy'));
      assert.strictEqual(fs.existsSync(path.join(allowedRoot, 'blocked.txt')), false);
    }

    console.log(`external-mcp-third-party-smoke.test.js: ok (${toolNames.length} tools)`);
  } finally {
    bridge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
