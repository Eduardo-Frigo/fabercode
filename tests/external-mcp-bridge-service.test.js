const assert = require('assert');

const { createExternalMcpBridgeService } = require('../main/services/external_mcp_bridge_service');

async function run() {
  const requests = [];
  const service = createExternalMcpBridgeService({
    now: () => '2026-05-27T15:00:00.000Z',
    servers: [
      {
        id: 'visual-auditor',
        name: 'Visual Auditor MCP',
        trust: 'approved',
        permission: 'write',
        allowedTools: ['visual.capture', 'dangerous.delete'],
        blockedTools: ['filesystem.write'],
        riskPolicy: {
          maxRiskLevel: 'high',
          blockedRiskLevels: ['critical'],
          allowedPermissions: ['read', 'write'],
          requireExplicitAllowForHighRisk: true,
        },
        injectProjectSessionArgument: true,
      },
      {
        id: 'untrusted-tools',
        name: 'Untrusted Tools',
        trust: 'untrusted',
        allowedTools: ['visual.capture'],
      },
    ],
    transports: {
      'visual-auditor': {
        request: async (method, params, context) => {
          requests.push({ method, params, context });
          if (method === 'initialize') {
            return {
              protocolVersion: '2025-06-18',
              serverInfo: { name: 'Visual Auditor MCP', version: '1.0.0' },
            };
          }
          if (method === 'tools/list') {
            return {
              tools: [
                {
                  name: 'visual.capture',
                  description: 'Captura screenshot e DOM metrics.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                    },
                  },
                  annotations: { permission: 'write' },
                },
                {
                  name: 'filesystem.write',
                  description: 'Escrita direta fora dos contratos Faber.',
                  inputSchema: { type: 'object' },
                  annotations: { permission: 'write' },
                },
                {
                  name: 'dangerous.delete',
                  description: 'Remove arquivos do projeto.',
                  inputSchema: { type: 'object' },
                  annotations: { permission: 'write', riskLevel: 'critical' },
                },
              ],
            };
          }
          if (method === 'tools/call') {
            assert.strictEqual(params.name, 'visual.capture');
            assert.strictEqual(params.arguments.projectSession.rootPath, '/tmp/faber-project');
            return {
              content: [
                { type: 'text', text: 'capture ok' },
                { type: 'image', mimeType: 'image/png', path: '/tmp/faber-external-mcp.png' },
              ],
              structuredContent: {
                domMetrics: [
                  {
                    label: 'desktop',
                    innerWidth: 1365,
                    hamburgerVisible: false,
                    desktopNavVisible: true,
                    hasHorizontalOverflow: false,
                  },
                ],
              },
              artifacts: ['/tmp/faber-external-mcp.png'],
            };
          }
          return { isError: true, content: [{ type: 'text', text: 'unknown method' }] };
        },
      },
      'untrusted-tools': {
        request: async (method) => {
          if (method === 'tools/list') return { tools: [{ name: 'visual.capture' }] };
          return {};
        },
      },
    },
  });

  const servers = service.listServers();
  assert.strictEqual(servers.length, 2);
  assert.strictEqual(servers[0].status, 'available');
  assert.strictEqual(servers[1].status, 'blocked');
  assert.strictEqual(servers[0].protocolVersion, '2025-06-18');

  const discovery = await service.discoverTools({
    serverId: 'visual-auditor',
    projectSession: { rootPath: '/tmp/faber-project', projectId: 'p1' },
  });
  assert.strictEqual(discovery.ok, true);
  assert.strictEqual(discovery.data.tools.length, 3);
  assert.strictEqual(discovery.data.tools.find((tool) => tool.name === 'visual.capture').allowed, true);
  const blockedTool = discovery.data.tools.find((tool) => tool.name === 'filesystem.write');
  assert.strictEqual(blockedTool.allowed, false);
  assert.strictEqual(blockedTool.blockedReason, 'tool_blocked_by_policy');
  const riskBlockedTool = discovery.data.tools.find((tool) => tool.name === 'dangerous.delete');
  assert.strictEqual(riskBlockedTool.allowed, false);
  assert.strictEqual(riskBlockedTool.riskLevel, 'critical');
  assert.strictEqual(riskBlockedTool.blockedReason, 'tool_risk_blocked_by_policy');
  assert.ok(requests.some((entry) => entry.method === 'initialize'));
  assert.ok(requests.some((entry) => entry.method === 'tools/list'));

  const cachedDiscovery = await service.discoverTools({
    serverId: 'visual-auditor',
    projectSession: { rootPath: '/tmp/faber-project', projectId: 'p1' },
  });
  assert.strictEqual(cachedDiscovery.ok, true);
  assert.strictEqual(cachedDiscovery.data.cached, true);

  const allDiscovery = await service.discoverTools({
    projectSession: { rootPath: '/tmp/faber-project', projectId: 'p1' },
    refresh: true,
  });
  assert.strictEqual(allDiscovery.ok, true);
  assert.strictEqual(allDiscovery.data.discoveries.length, 2);
  assert.strictEqual(allDiscovery.data.tools.some((tool) => tool.serverId === 'visual-auditor'), true);
  assert.strictEqual(allDiscovery.data.tools.some((tool) => tool.serverId === 'untrusted-tools' && tool.allowed === false), true);

  const call = await service.callTool({
    serverId: 'visual-auditor',
    toolName: 'visual.capture',
    arguments: { url: 'http://127.0.0.1:3000/' },
    projectSession: { rootPath: '/tmp/faber-project', projectId: 'p1', projectName: 'Projeto' },
  });
  assert.strictEqual(call.ok, true);
  assert.strictEqual(call.status, 'succeeded');
  assert.deepStrictEqual(call.artifacts, ['/tmp/faber-external-mcp.png']);
  assert.deepStrictEqual(call.data.result.contentTypes, ['text', 'image']);
  assert.strictEqual(call.data.result.structuredContent.domMetrics[0].desktopNavVisible, true);

  const scopeBlockedCall = await service.callTool({
    serverId: 'visual-auditor',
    toolName: 'visual.capture',
    arguments: { artifactPath: '/tmp/faber-outside.png' },
    projectSession: { rootPath: '/tmp/faber-project', projectId: 'p1' },
  });
  assert.strictEqual(scopeBlockedCall.ok, false);
  assert.strictEqual(scopeBlockedCall.status, 'blocked');
  assert.ok(scopeBlockedCall.errors.includes('external_mcp_directory_outside_project_root'));

  const blockedCall = await service.callTool({
    serverId: 'visual-auditor',
    toolName: 'filesystem.write',
    arguments: { path: 'index.html' },
    projectSession: { rootPath: '/tmp/faber-project' },
  });
  assert.strictEqual(blockedCall.ok, false);
  assert.strictEqual(blockedCall.status, 'blocked');
  assert.ok(blockedCall.errors.includes('tool_blocked_by_policy'));

  const riskBlockedCall = await service.callTool({
    serverId: 'visual-auditor',
    toolName: 'dangerous.delete',
    arguments: { path: 'index.html' },
    projectSession: { rootPath: '/tmp/faber-project' },
  });
  assert.strictEqual(riskBlockedCall.ok, false);
  assert.strictEqual(riskBlockedCall.status, 'blocked');
  assert.ok(riskBlockedCall.errors.includes('tool_risk_blocked_by_policy'));

  const missingSession = await service.callTool({
    serverId: 'visual-auditor',
    toolName: 'visual.capture',
  });
  assert.strictEqual(missingSession.ok, false);
  assert.ok(missingSession.errors.includes('external_mcp_project_session_required'));

  const unregistered = await service.discoverTools({
    serverId: 'unknown-server',
    projectSession: { rootPath: '/tmp/faber-project' },
  });
  assert.strictEqual(unregistered.ok, false);
  assert.ok(unregistered.errors.includes('external_mcp_server_not_registered'));

  console.log('external-mcp-bridge-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
