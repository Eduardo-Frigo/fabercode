const assert = require('assert');

const { registerMempalaceHandlers } = require('../main/ipc/mempalace_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

async function run() {
  const calls = [];
  const audit = [];
  const { handlers, registerIpcHandler } = createHandlerMap();

  registerMempalaceHandlers({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    ensureMempalaceProjectIndexed: async (projectInfo) => {
      calls.push(['index', projectInfo.rootPath]);
      return { ok: true, wing: 'project_alpha' };
    },
    getMempalaceRuntimeStatus: async (projectInfo) => {
      calls.push(['status', projectInfo.rootPath]);
      return { ok: true, available: true, ready: true };
    },
    normalizeAuthorizedProjectInfo: (projectInfo) => {
      if (!projectInfo || projectInfo.rootPath !== '/allowed') {
        return { ok: false, message: 'Projeto não autorizado.' };
      }
      return { ok: true, projectInfo };
    },
    registerIpcHandler,
    searchMempalaceContext: async (query, projectInfo, nResults) => {
      calls.push(['search', query, projectInfo.rootPath, nResults]);
      return { ok: true, text: 'memoria' };
    },
  });

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'mempalace:index-project',
    'mempalace:search',
    'mempalace:status',
  ]);

  const status = await handlers['mempalace:status'](null, { rootPath: '/allowed' });
  assert.strictEqual(status.ok, true);
  assert.deepStrictEqual(calls[0], ['status', '/allowed']);

  const denied = await handlers['mempalace:status'](null, { rootPath: '/denied' });
  assert.strictEqual(denied.ok, false);

  const indexed = await handlers['mempalace:index-project'](null, { rootPath: '/allowed' });
  assert.strictEqual(indexed.ok, true);
  assert.strictEqual(audit[0].type, 'mempalace.index_ok');
  assert.strictEqual(audit[0].payload.rootPath, '/allowed');

  const search = await handlers['mempalace:search'](null, {
    query: 'buscar',
    projectInfo: { rootPath: '/allowed' },
    nResults: 10,
  });
  assert.strictEqual(search.ok, true);
  assert.deepStrictEqual(calls[calls.length - 1], ['search', 'buscar', '/allowed', 10]);

  console.log('mempalace-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
