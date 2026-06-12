const assert = require('assert');

const {
  createCortexMemorySyncService,
} = require('../cortex/memory/cortex_memory_sync_service');

async function run() {
  const auditEvents = [];
  const service = createCortexMemorySyncService({
    appendAuditEvent: (type, payload) => auditEvents.push({ type, payload }),
    clipText: (value, max = 4000) => String(value || '').slice(0, max),
    persistCortexMemoryToMempalace: async (_projectInfo, entry) => ({
      ok: true,
      available: true,
      drawerId: `drawer-${entry.topic}`,
    }),
    indexCortexMemoryInRag: async (_projectInfo, entry) => ({
      ok: true,
      available: true,
      provider: 'r2r',
      documentId: `rag-${entry.topic}`,
    }),
  });

  const entry = service.buildCortexMemoryEntry({
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Faber Project' },
    topic: 'Deploy',
    userMessage: 'Guardar regra de deploy.',
    attachmentLearning: [{ name: 'deploy.md', path: '/tmp/deploy.md', summary: 'Usar Vercel quando solicitado.' }],
  });

  assert.strictEqual(entry.type, 'cortex_memory');
  assert.strictEqual(entry.topic, 'deploy');
  assert.strictEqual(entry.projectName, 'Faber Project');
  assert.ok(entry.content.includes('topic:deploy'));
  assert.ok(entry.content.includes('deploy.md'));

  const synced = await service.syncCortexMemory({
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/Faber Project' },
    topic: 'Deploy',
    userMessage: 'Guardar regra de deploy.',
    attachmentLearning: [{ name: 'deploy.md', path: '/tmp/deploy.md', summary: 'Usar Vercel quando solicitado.' }],
  });

  assert.strictEqual(synced.entry.topic, 'deploy');
  assert.strictEqual(synced.mempalace.ok, true);
  assert.strictEqual(synced.rag.ok, true);
  assert.strictEqual(auditEvents.length, 1);
  assert.strictEqual(auditEvents[0].type, 'cortex.memory_sync');
  assert.deepStrictEqual(auditEvents[0].payload.documents, ['deploy.md']);
  assert.strictEqual(auditEvents[0].payload.mempalace.id, 'drawer-deploy');
  assert.strictEqual(auditEvents[0].payload.rag.id, 'rag-deploy');

  const resilient = createCortexMemorySyncService({
    appendAuditEvent: (type, payload) => auditEvents.push({ type, payload }),
    persistCortexMemoryToMempalace: async () => {
      throw new Error('mempalace offline');
    },
    indexCortexMemoryInRag: async () => ({ ok: false, available: true, reason: 'r2r_ingest_endpoint_missing' }),
  });

  const fallback = await resilient.syncCortexMemory({
    projectId: 'project-2',
    projectInfo: { rootPath: '/tmp/Outro Projeto' },
    topic: '',
    userMessage: 'Regra sem tópico.',
  });

  assert.strictEqual(fallback.entry.topic, 'geral');
  assert.strictEqual(fallback.mempalace.reason, 'mempalace_exception');
  assert.strictEqual(fallback.rag.reason, 'r2r_ingest_endpoint_missing');
  assert.strictEqual(auditEvents.length, 2);

  console.log('cortex-memory-sync-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
