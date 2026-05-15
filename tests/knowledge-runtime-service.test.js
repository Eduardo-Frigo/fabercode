const assert = require('assert');

const {
  createKnowledgeRuntimeService,
} = require('../cortex/memory/knowledge_runtime_service');

async function run() {
  const auditEvents = [];
  const service = createKnowledgeRuntimeService({
    appendAuditEvent: (type, payload) => auditEvents.push({ type, payload }),
    getCortexLearning: () => ({
      ok: true,
      learning: {
        persona: ['Falar com tom claro.'],
        executor: ['Editar apenas o solicitado.'],
        events: [
          { type: 'cortex.attachment_learned', topic: 'codigo', fileName: 'arquitetura.md' },
          { type: 'cortex.note', topic: 'deploy' },
        ],
        updatedAt: '2026-05-14T12:00:00.000Z',
      },
    }),
    getMempalaceRuntimeStatus: async () => ({
      ok: true,
      available: true,
      ready: true,
      wing: 'project_alpha',
    }),
    getRagRuntimeStatus: async () => ({
      ok: true,
      available: true,
      ready: true,
      searchable: true,
      provider: 'r2r',
    }),
    syncCortexMemory: async () => ({
      ok: true,
      entry: { topic: 'codigo' },
      mempalace: { ok: true, available: true, drawerId: 'drawer-1' },
      rag: { ok: false, available: true, reason: 'r2r_ingest_endpoint_missing' },
    }),
    searchMempalaceContext: async () => ({ ok: true, text: 'MemPalace result' }),
    buildRagPlannerContext: async () => ({ ok: true, contextText: 'RAG result' }),
  });

  const status = await service.getKnowledgeRuntimeStatus({
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
  });
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.mode, 'integrated');
  assert.strictEqual(status.cortex.rulesCount, 2);
  assert.strictEqual(status.cortex.documentsCount, 1);
  assert.strictEqual(status.mempalace.ready, true);
  assert.strictEqual(status.rag.ready, true);

  const sync = await service.syncKnowledgeFromCortex({
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
    topic: 'codigo',
  });
  assert.strictEqual(sync.ok, true);
  assert.ok(sync.message.includes('Memória registrada no Cortex'));
  assert.strictEqual(auditEvents[0].type, 'knowledge.runtime_sync');

  const search = await service.searchKnowledge({
    query: 'deploy',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
  });
  assert.strictEqual(search.ok, true);
  assert.strictEqual(search.hasResults, true);

  const localOnly = createKnowledgeRuntimeService({
    getCortexLearning: () => ({ ok: true, learning: null }),
    getMempalaceRuntimeStatus: async () => ({ ok: true, available: false, reason: 'repo_not_found' }),
    getRagRuntimeStatus: async () => ({ ok: true, available: true, ready: false, reason: 'r2r_request_error' }),
  });
  const localStatus = await localOnly.getKnowledgeRuntimeStatus({
    projectId: 'project-2',
    projectInfo: { rootPath: '/tmp/Project Beta' },
  });
  assert.strictEqual(localStatus.mode, 'local_only');
  assert.strictEqual(localStatus.ready, true);
  assert.strictEqual(localStatus.warnings.length, 2);

  console.log('knowledge-runtime-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
