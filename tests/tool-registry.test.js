const assert = require('assert');

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

  console.log('tool-registry.test.js: ok');
}

run();
