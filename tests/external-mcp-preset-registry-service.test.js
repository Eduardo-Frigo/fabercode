const assert = require('assert');

const {
  createExternalMcpPresetRegistryService,
  normalizePresetId,
} = require('../main/services/external_mcp_preset_registry_service');

function run() {
  const service = createExternalMcpPresetRegistryService({
    now: () => '2026-05-28T14:00:00.000Z',
  });

  assert.strictEqual(normalizePresetId('Official Filesystem'), 'official-filesystem');
  const listed = service.listPresets();
  assert.strictEqual(listed.ok, true);
  assert.ok(listed.presets.length >= 4);
  assert.ok(listed.presets.some((preset) => preset.id === 'deepwiki-public'));
  assert.ok(listed.presets.some((preset) => preset.requiresSecrets === true));

  const built = service.buildServerFromPreset('official-filesystem', {
    trust: 'approved',
  });
  assert.strictEqual(built.ok, true);
  assert.strictEqual(built.server.presetId, 'official-filesystem');
  assert.strictEqual(built.server.transport, 'stdio');
  assert.strictEqual(built.server.trust, 'approved');
  assert.ok(built.server.blockedTools.includes('write_file'));

  const missing = service.buildServerFromPreset('missing');
  assert.strictEqual(missing.ok, false);

  console.log('external-mcp-preset-registry-service.test.js: ok');
}

run();
