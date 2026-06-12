const assert = require('assert');
const path = require('path');

const {
  createCortexLearningPayloadService,
} = require('../main/services/cortex_learning_payload_service');

async function run() {
  const audit = [];
  const upserts = [];
  const service = createCortexLearningPayloadService({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    clipText: (value, max) => String(value || '').slice(0, max),
    extractAttachmentText: async () => 'Documento com decisão técnica.',
    path,
    syncKnowledgeFromCortex: async (input) => ({
      ok: true,
      message: 'sync ok',
      status: { mode: 'integrated' },
      mempalace: { ok: true },
      rag: { ok: true },
      input,
    }),
    upsertCortexLearning: (projectId, payload) => {
      upserts.push({ projectId, payload });
      return { ok: true, learning: { ...payload, updatedAt: 'now' } };
    },
    now: () => '2026-05-28T15:00:00.000Z',
  });

  const result = await service.processCortexLearningPayload({
    projectId: 'project-1',
    projectInfo: { rootPath: '/tmp/project' },
    userMessage: 'Manter arquitetura modular.',
    topic: 'codigo',
    attachments: [{ name: 'decisoes.md', path: '/tmp/decisoes.md' }],
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.message, 'sync ok');
  assert.strictEqual(upserts[0].payload.events.length, 2);
  assert.match(upserts[0].payload.persona.join(' '), /arquitetura modular/);
  assert.ok(audit.some((entry) => entry.type === 'cortex.learning_updated'));

  console.log('cortex-learning-payload-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
