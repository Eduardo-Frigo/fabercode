const assert = require('assert');

const {
  createKnowledgeRuntimeService,
} = require('../cortex/memory/knowledge_runtime_service');

async function run() {
  const auditEvents = [];
  const syncedInputs = [];
  const managedActions = [];
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
    getEmbeddingRuntimeStatus: () => ({
      ok: true,
      available: true,
      ready: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
    }),
    listCortexMemories: () => ({
      ok: true,
      memories: [{ id: 'memory-1', memoryId: 'memory-1', topic: 'codigo', text: 'Deploy Vercel', status: 'active' }],
      total: 1,
    }),
    manageCortexMemory: (input) => {
      managedActions.push(input.action);
      return {
        ok: true,
        action: input.action,
        memory: {
          id: input.memoryId,
          memoryId: input.memoryId,
          topic: input.topic || 'codigo',
          text: input.text || 'Deploy editado',
          status: input.action === 'expire' ? 'expired' : input.action === 'promote' ? 'promoted' : 'active',
          promoted: input.action === 'promote',
          scope: 'project',
        },
        learning: { events: [] },
      };
    },
    reindexMempalaceProject: async () => ({ ok: true, wing: 'project_alpha', step: 'mine' }),
    reindexRagProject: async () => ({ ok: true, provider: 'r2r', jobId: 'reindex-1' }),
    forgetMempalaceMemory: async () => ({ ok: true, id: 'memory-1' }),
    forgetRagMemory: async () => ({ ok: true, documentId: 'memory-1' }),
    syncCortexMemory: async (input) => {
      syncedInputs.push(input);
      return {
        ok: true,
        entry: { topic: 'codigo' },
        mempalace: { ok: true, available: true, drawerId: 'drawer-1' },
        rag: { ok: false, available: true, reason: 'r2r_ingest_endpoint_missing' },
      };
    },
    searchMempalaceContext: async () => ({
      ok: true,
      text: 'MemPalace result',
      refs: [{ sourceId: 'drawer-1', title: 'Drawer deploy', preview: 'MemPalace result' }],
    }),
    buildRagPlannerContext: async () => ({
      ok: true,
      provider: 'r2r',
      contextText: 'RAG result',
      refs: [{ documentId: 'doc-1', title: 'RAG deploy', preview: 'RAG result' }],
    }),
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
  assert.strictEqual(status.embedding.provider, 'openai');

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
  assert.strictEqual(search.provenance.schemaVersion, 'memory-provenance-v1');
  assert.ok(search.provenance.used.length >= 2);

  const reindex = await service.runMemoryLifecycleOperation({
    action: 'reindex',
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
  });
  assert.strictEqual(reindex.ok, true);
  assert.strictEqual(reindex.lifecycle.steps[0].id, 'reindex_mempalace');
  assert.strictEqual(reindex.lifecycle.steps[1].id, 'reindex_rag');

  const list = await service.runMemoryLifecycleOperation({
    action: 'list',
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
  });
  assert.strictEqual(list.ok, true);
  assert.strictEqual(list.memories.length, 1);

  const edit = await service.runMemoryLifecycleOperation({
    action: 'edit',
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
    memoryId: 'memory-1',
    text: 'Deploy editado',
    topic: 'deploy',
  });
  assert.strictEqual(edit.ok, true);
  assert.ok(managedActions.includes('edit'));
  assert.ok(syncedInputs.some((input) => input && input.memoryId === 'memory-1' && input.lifecycleAction === 'edit'));

  const promoted = await service.runMemoryLifecycleOperation({
    action: 'promote',
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
    memoryId: 'memory-1',
  });
  assert.strictEqual(promoted.ok, true);
  assert.strictEqual(promoted.memory.status, 'promoted');

  const expired = await service.runMemoryLifecycleOperation({
    action: 'expire',
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
    memoryId: 'memory-1',
  });
  assert.strictEqual(expired.ok, true);
  assert.strictEqual(expired.lifecycle.steps.some((step) => step.id === 'expire_rag_memory'), true);

  const deleted = await service.runMemoryLifecycleOperation({
    action: 'delete',
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
    memoryId: 'memory-1',
  });
  assert.strictEqual(deleted.ok, true);
  assert.strictEqual(deleted.lifecycle.steps.some((step) => step.id === 'delete_mempalace_memory'), true);

  const forget = await service.runMemoryLifecycleOperation({
    action: 'forget',
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Project Alpha' },
    memoryId: 'memory-1',
  });
  assert.strictEqual(forget.ok, true);
  assert.strictEqual(forget.lifecycle.steps[0].id, 'forget_mempalace');

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
