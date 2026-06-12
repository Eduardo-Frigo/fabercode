const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createExternalMcpServerRegistryService } = require('../main/services/external_mcp_server_registry_service');

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-mcp-registry-'));
  try {
    const service = createExternalMcpServerRegistryService({
      fs,
      path,
      getUserDataPath: () => tempRoot,
      now: () => '2026-05-27T17:00:00.000Z',
      protectSecret: (value) => `locked:${value}`,
      unprotectSecret: (value) => String(value || '').replace(/^locked:/, ''),
    });

    const empty = service.listServers();
    assert.strictEqual(empty.ok, true);
    assert.deepStrictEqual(empty.servers, []);

    const saved = service.upsertServer({
      name: 'Fixture Visual MCP',
      transport: 'stdio',
      command: process.execPath,
      args: ['tests/fixtures/external_mcp_stdio_visual_server.js'],
      env: 'MCP_TOKEN=secret-token',
      trust: 'approved',
      permission: 'write',
      allowedTools: 'visual.capture',
      blockedTools: ['filesystem.write'],
      riskPolicy: {
        maxRiskLevel: 'medium',
        allowedPermissions: ['read', 'write'],
        blockedRiskLevels: ['critical'],
        requireExplicitAllowForHighRisk: true,
      },
      scopePolicy: {
        allowedDirectories: ['.faber'],
        blockedDirectories: ['.git'],
        allowExternalNetwork: false,
        allowedNetworkHosts: ['localhost', '127.0.0.1'],
        blockedNetworkHosts: ['danger.example'],
      },
      injectProjectSessionArgument: true,
    });
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.server.id, 'fixture_visual_mcp');
    assert.strictEqual(saved.server.ready, true);
    assert.strictEqual(saved.server.env.MCP_TOKEN.endsWith('oken'), true);
    assert.strictEqual(saved.server.env.MCP_TOKEN.includes('secret-token'), false);

    const raw = service.listServers({ includeSecrets: true });
    assert.strictEqual(raw.servers[0].env.MCP_TOKEN, 'secret-token');
    const storedAfterEnv = JSON.parse(fs.readFileSync(path.join(tempRoot, 'external-mcp-servers.json'), 'utf8'));
    assert.strictEqual(storedAfterEnv.servers[0].env.MCP_TOKEN, 'locked:secret-token');
    assert.deepStrictEqual(raw.servers[0].allowedTools, ['visual.capture']);
    assert.strictEqual(raw.servers[0].riskPolicy.maxRiskLevel, 'medium');
    assert.strictEqual(raw.servers[0].riskPolicy.requireExplicitAllowForHighRisk, true);
    assert.deepStrictEqual(raw.servers[0].scopePolicy.allowedDirectories, ['.faber']);
    assert.deepStrictEqual(raw.servers[0].scopePolicy.blockedNetworkHosts, ['danger.example']);
    assert.strictEqual(raw.servers[0].injectProjectSessionArgument, true);

    const updated = service.upsertServer({
      id: 'fixture_visual_mcp',
      name: 'Fixture Visual MCP',
      transport: 'http',
      endpoint: 'https://mcp.example.test/rpc',
      headers: 'Authorization=Bearer real-token',
      trust: 'untrusted',
      allowedTools: ['demo.echo'],
    });
    assert.strictEqual(updated.ok, true);
    assert.strictEqual(updated.servers.length, 1);
    assert.strictEqual(updated.server.transport, 'http');
    assert.strictEqual(updated.server.headers.Authorization.includes('real-token'), false);
    assert.strictEqual(service.listServers({ includeSecrets: true }).servers[0].headers.Authorization, 'Bearer real-token');
    const storedAfterHeader = JSON.parse(fs.readFileSync(path.join(tempRoot, 'external-mcp-servers.json'), 'utf8'));
    assert.strictEqual(storedAfterHeader.servers[0].headers.Authorization, 'locked:Bearer real-token');

    service.upsertServer({
      id: 'fixture_visual_mcp',
      name: 'Fixture Visual MCP',
      transport: 'http',
      endpoint: 'https://mcp.example.test/rpc',
      headers: updated.server.headers,
      trust: 'approved',
    });
    assert.strictEqual(service.listServers({ includeSecrets: true }).servers[0].headers.Authorization, 'Bearer real-token');

    const removed = service.removeServer('fixture_visual_mcp');
    assert.strictEqual(removed.ok, true);
    assert.strictEqual(removed.servers.length, 0);

    console.log('external-mcp-server-registry-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
