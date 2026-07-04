const assert = require('assert');

const { registerSystemHandlers } = require('../main/ipc/system_handlers');

async function run() {
  const handlers = {};
  const opened = [];
  const audit = [];

  registerSystemHandlers({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    getHostRequirements: async () => ({ ok: true, ready: false, requirements: [{ id: 'node', installed: false }] }),
    normalizeExternalUrl: (url) => url === 'https://nodejs.org/en/download'
      ? { ok: true, url }
      : { ok: false, message: 'blocked' },
    registerIpcHandler: (name, handler) => {
      handlers[name] = handler;
    },
    shell: {
      openExternal: async (url) => opened.push(url),
    },
  });

  assert.ok(handlers['system:host-requirements']);
  assert.ok(handlers['system:open-external']);

  const requirements = await handlers['system:host-requirements']();
  assert.strictEqual(requirements.ok, true);
  assert.strictEqual(requirements.ready, false);

  const openedResult = await handlers['system:open-external'](null, { url: 'https://nodejs.org/en/download' });
  assert.deepStrictEqual(opened, ['https://nodejs.org/en/download']);
  assert.strictEqual(openedResult.ok, true);
  assert.strictEqual(audit[0].type, 'system.external_url_opened');

  const blockedResult = await handlers['system:open-external'](null, { url: 'https://example.com' });
  assert.strictEqual(blockedResult.ok, false);

  console.log('system-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
