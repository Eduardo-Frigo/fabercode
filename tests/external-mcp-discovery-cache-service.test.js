const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createExternalMcpDiscoveryCacheService,
} = require('../main/services/external_mcp_discovery_cache_service');

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-mcp-discovery-cache-'));
  try {
    const service = createExternalMcpDiscoveryCacheService({
      fs,
      path,
      getUserDataPath: () => tempRoot,
      now: () => '2026-05-27T20:20:00.000Z',
    });

    assert.deepStrictEqual(service.listDiscoveries().discoveries, []);

    const saved = service.setDiscovery('DeepWiki Public', {
      discoveredAt: '2026-05-27T20:00:00.000Z',
      tools: [
        {
          serverId: 'deepwiki_public',
          name: 'read_wiki_structure',
          description: 'Read public wiki structure.',
          permission: 'read',
          riskLevel: 'low',
          allowed: true,
        },
        {
          name: 'generate_wiki',
          permission: 'write',
          riskLevel: 'high',
          allowed: false,
          blockedReason: 'tool_not_allowed_by_policy',
        },
      ],
    });
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.discovery.serverId, 'deepwiki_public');
    assert.strictEqual(saved.discovery.toolCount, 2);

    const cached = service.getDiscovery('deepwiki_public');
    assert.strictEqual(cached.tools[0].normalizedName, 'read_wiki_structure');
    assert.strictEqual(cached.tools[1].blockedReason, 'tool_not_allowed_by_policy');

    const attached = service.attachDiscoveryCache([
      { id: 'deepwiki_public', name: 'DeepWiki' },
      { id: 'empty', name: 'Empty' },
    ]);
    assert.strictEqual(attached[0].discoveryCache.toolCount, 2);
    assert.strictEqual(attached[1].discoveryCache, null);

    const cleared = service.clearDiscovery('deepwiki_public');
    assert.strictEqual(cleared.ok, true);
    assert.strictEqual(cleared.cleared, true);
    assert.strictEqual(service.getDiscovery('deepwiki_public'), null);

    console.log('external-mcp-discovery-cache-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
