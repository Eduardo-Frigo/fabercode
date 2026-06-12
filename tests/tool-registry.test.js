const assert = require('assert');

const { createCapabilityTools } = require('../cortex/tools/capability_tools');
const { createToolRegistry } = require('../cortex/tools/registry');

function run() {
  const registry = createToolRegistry();
  registry.register({
    name: 'demo.echo',
    description: 'Ecoa payload de teste.',
    permission: 'read',
    inputSchema: { type: 'object' },
    handler: (input) => ({ ok: true, input }),
  });

  assert.strictEqual(registry.list().length, 1);
  assert.strictEqual(registry.get('demo.echo').permission, 'read');
  assert.deepStrictEqual(registry.execute('demo.echo', { value: 1 }), { ok: true, input: { value: 1 } });
  assert.strictEqual(registry.execute('missing.tool', {}).ok, false);
  assert.throws(() => registry.register({ name: 'demo.echo', handler: () => ({ ok: true }) }), /duplicada/);

  const capabilityRegistry = createToolRegistry();
  for (const tool of createCapabilityTools({
    listCapabilities: () => [{ capability: 'filesystem' }],
    executeCapability: (input) => ({ ok: true, input }),
  })) {
    capabilityRegistry.register(tool);
  }
  assert.strictEqual(capabilityRegistry.list().length, 2);
  assert.deepStrictEqual(capabilityRegistry.execute('faber.capabilities.list', {}), {
    ok: true,
    capabilities: [{ capability: 'filesystem' }],
  });
  assert.deepStrictEqual(capabilityRegistry.execute('faber.capabilities.execute', { capability: 'filesystem' }), {
    ok: true,
    input: { capability: 'filesystem' },
  });

  console.log('tool-registry.test.js: ok');
}

run();
