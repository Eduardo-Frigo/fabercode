const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerExternalMcpHandlers } = require('../main/ipc/external_mcp_handlers');
const {
  createExternalMcpDiscoveryCacheService,
} = require('../main/services/external_mcp_discovery_cache_service');
const { createExternalMcpPresetRegistryService } = require('../main/services/external_mcp_preset_registry_service');
const { createExternalMcpServerRegistryService } = require('../main/services/external_mcp_server_registry_service');

function createHandlerMap() {
  const handlers = new Map();
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers.set(channel, handler);
    },
  };
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-mcp-handlers-'));
  const projectRoot = path.join(tempRoot, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const fixturePath = path.join(__dirname, 'fixtures', 'external_mcp_stdio_visual_server.js');
  const artifactPath = path.join(projectRoot, '.faber', 'external-mcp-artifacts', 'handler-capture.png');
  const auditCalls = [];
  let resetCount = 0;

  try {
    const registryService = createExternalMcpServerRegistryService({
      fs,
      path,
      getUserDataPath: () => path.join(tempRoot, 'userData'),
      now: () => '2026-05-27T17:20:00.000Z',
    });
    const discoveryCacheService = createExternalMcpDiscoveryCacheService({
      fs,
      path,
      getUserDataPath: () => path.join(tempRoot, 'userData'),
      now: () => '2026-05-27T17:21:00.000Z',
    });
    const { handlers, registerIpcHandler } = createHandlerMap();
    registerExternalMcpHandlers({
      appendAuditEvent: (type, payload) => auditCalls.push({ type, payload }),
      authorizeProjectRoot: (rootPath) => {
        const resolved = path.resolve(rootPath);
        if (resolved !== projectRoot) return { ok: false, message: 'unauthorized' };
        return { ok: true, rootPath: resolved };
      },
      discoveryCacheService,
      presetRegistryService: createExternalMcpPresetRegistryService(),
      registryService,
      registerIpcHandler,
      resetCapabilityRuntime: () => {
        resetCount += 1;
      },
    });

    assert.strictEqual(handlers.size, 7);
    const presets = await handlers.get('external-mcp:presets:list')();
    assert.ok(presets.presets.some((preset) => preset.id === 'official-filesystem'));
    const preset = await handlers.get('external-mcp:presets:apply')(null, { presetId: 'deepwiki-public' });
    assert.strictEqual(preset.ok, true);
    assert.strictEqual(preset.server.presetId, 'deepwiki-public');

    const saved = await handlers.get('external-mcp:servers:save')(null, {
      server: {
        id: 'visual-fixture',
        name: 'Visual Fixture',
        transport: 'stdio',
        command: process.execPath,
        args: [fixturePath],
        trust: 'approved',
        allowedTools: ['visual.capture'],
        blockedTools: ['filesystem.write'],
      },
    });
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(resetCount, 1);

    const list = await handlers.get('external-mcp:servers:list')();
    assert.strictEqual(list.servers.length, 1);
    assert.strictEqual(list.servers[0].ready, true);

    const discovery = await handlers.get('external-mcp:tools:discover')(null, {
      serverId: 'visual-fixture',
      projectInfo: { rootPath: projectRoot, id: 'project-1', name: 'Projeto' },
    });
    assert.strictEqual(discovery.ok, true);
    assert.strictEqual(discovery.data.tools.find((tool) => tool.name === 'visual.capture').allowed, true);
    const cachedList = await handlers.get('external-mcp:servers:list')();
    assert.strictEqual(cachedList.servers[0].discoveryCache.toolCount, 2);
    assert.strictEqual(cachedList.servers[0].discoveryCache.tools[0].serverId, 'visual-fixture');

    const call = await handlers.get('external-mcp:tools:call')(null, {
      serverId: 'visual-fixture',
      toolName: 'visual.capture',
      projectInfo: { rootPath: projectRoot, id: 'project-1', name: 'Projeto' },
      args: { artifactPath },
    });
    assert.strictEqual(call.ok, true);
    assert.deepStrictEqual(call.artifacts, [artifactPath]);
    assert.strictEqual(fs.existsSync(artifactPath), true);

    const blocked = await handlers.get('external-mcp:tools:call')(null, {
      serverId: 'visual-fixture',
      toolName: 'filesystem.write',
      projectInfo: { rootPath: projectRoot },
      arguments: { path: 'index.html' },
    });
    assert.strictEqual(blocked.ok, false);
    assert.ok(blocked.errors.includes('tool_blocked_by_policy'));

    const removed = await handlers.get('external-mcp:servers:remove')(null, { serverId: 'visual-fixture' });
    assert.strictEqual(removed.ok, true);
    assert.strictEqual(resetCount, 2);
    assert.strictEqual(discoveryCacheService.getDiscovery('visual-fixture'), null);
    assert.ok(auditCalls.some((entry) => entry.type === 'external_mcp.tool_called'));

    console.log('external-mcp-handlers.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
