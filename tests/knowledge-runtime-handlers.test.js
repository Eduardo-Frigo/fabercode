const assert = require('assert');

const { registerKnowledgeRuntimeHandlers } = require('../main/ipc/knowledge_runtime_handlers');

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

  registerKnowledgeRuntimeHandlers({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    getKnowledgeRuntimeStatus: async (input) => {
      calls.push(['status', input.projectId, input.projectInfo.rootPath]);
      return { ok: true, mode: 'integrated' };
    },
    listMemoryEvidence: async (input) => {
      calls.push(['ledger', input.projectInfo.rootPath, input.jobId || '', input.limit || 0]);
      return { ok: true, entries: [{ action: 'build_active_memory' }] };
    },
    normalizeAuthorizedProjectInfo: (projectInfo) => {
      if (!projectInfo || projectInfo.rootPath !== '/allowed') {
        return { ok: false, message: 'Projeto não autorizado.' };
      }
      return { ok: true, projectInfo };
    },
    registerIpcHandler,
    runMemoryLifecycleOperation: async (input) => {
      calls.push(['lifecycle', input.action, input.projectInfo.rootPath]);
      return { ok: true, action: input.action, message: 'ok' };
    },
    searchKnowledge: async (input) => {
      calls.push(['search', input.query, input.projectInfo.rootPath, input.nResults]);
      return { ok: true, hasResults: true, mempalace: { ok: true }, rag: { ok: true } };
    },
  });

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'knowledge:memory-ledger:list',
    'knowledge:runtime:lifecycle',
    'knowledge:runtime:search',
    'knowledge:runtime:status',
  ]);

  const status = await handlers['knowledge:runtime:status'](null, {
    projectId: 'project-1',
    projectInfo: { rootPath: '/allowed' },
  });
  assert.strictEqual(status.ok, true);
  assert.deepStrictEqual(calls[0], ['status', 'project-1', '/allowed']);

  const denied = await handlers['knowledge:runtime:status'](null, {
    projectId: 'project-1',
    projectInfo: { rootPath: '/denied' },
  });
  assert.strictEqual(denied.ok, false);

  const search = await handlers['knowledge:runtime:search'](null, {
    query: 'deploy',
    projectInfo: { rootPath: '/allowed' },
    nResults: 3,
  });
  assert.strictEqual(search.ok, true);
  assert.deepStrictEqual(calls[calls.length - 1], ['search', 'deploy', '/allowed', 3]);
  assert.strictEqual(audit[0].type, 'knowledge.search_ok');
  assert.strictEqual(audit[0].payload.rootPath, '/allowed');

  const ledger = await handlers['knowledge:memory-ledger:list'](null, {
    projectInfo: { rootPath: '/allowed' },
    jobId: 'job-1',
    limit: 4,
  });
  assert.strictEqual(ledger.ok, true);
  assert.deepStrictEqual(calls[calls.length - 1], ['ledger', '/allowed', 'job-1', 4]);

  const lifecycle = await handlers['knowledge:runtime:lifecycle'](null, {
    projectInfo: { rootPath: '/allowed' },
    action: 'reindex',
  });
  assert.strictEqual(lifecycle.ok, true);
  assert.deepStrictEqual(calls[calls.length - 1], ['lifecycle', 'reindex', '/allowed']);
  assert.strictEqual(audit[audit.length - 1].type, 'knowledge.lifecycle_ok');

  console.log('knowledge-runtime-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
