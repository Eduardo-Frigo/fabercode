const assert = require('assert');

const {
  ACTIVE_MEMORY_SCHEMA_VERSION,
  createActiveMemoryService,
  isActiveMemoryContinuationMessage,
  summarizeActiveMemory,
} = require('../cortex/memory/active_memory_service');

async function run() {
  const auditEvents = [];
  const service = createActiveMemoryService({
    appendAuditEvent: (type, payload) => auditEvents.push({ type, payload }),
    buildCortexPromptContext: () => ({
      available: true,
      selectedCount: 2,
      contextText: '[persona] Preferir tom direto.\n[executor] Manter arquitetura modular.',
    }),
    buildMempalacePlannerContext: async () => ({
      ok: true,
      available: true,
      contextText: 'MemPalace lembra que o projeto usa Next.js com Tailwind.',
    }),
    buildMempalaceCortexCore: async () => ({
      ok: true,
      available: true,
      layers: { wake_up: 'Wake-up do projeto: landing premium.' },
      kg: { facts: [] },
      graph: {},
    }),
    buildProjectEvolutionContext: () => '[app/page.tsx]\nexport default function Page() {}',
    buildRagPlannerContext: async () => ({
      ok: true,
      available: true,
      provider: 'r2r',
      contextText: 'RAG recuperou guia de edicao incremental.',
      refsCount: 1,
    }),
    clipText: (value, max = 4000) => String(value || '').slice(0, max),
    extractIntentTerms: () => ['landing', 'tailwind', 'premium'],
    formatMempalaceCoreForPrompt: () => 'core: Wake-up do projeto',
    getCortexLearning: () => ({
      ok: true,
      learning: {
        persona: ['Usuario prefere respostas diretas e sem excesso de detalhe.'],
        executor: ['Projeto deve manter arquitetura modular e editar apenas arquivos alvo.'],
        events: [{ type: 'cortex.note', topic: 'design', summary: 'Paleta premium ja validada.' }],
      },
    }),
    getRuntimeProfileSettings: () => ({ memoryContextChars: 1600, profile: 'padrao' }),
    now: () => '2026-05-26T12:00:00.000Z',
  });

  assert.strictEqual(isActiveMemoryContinuationMessage('segue com isso'), true);

  const activeMemory = await service.buildActiveMemoryContext({
    projectId: 'project-1',
    projectInfo: {
      id: 'project-1',
      rootPath: '/tmp/Faber Active',
      stacks: ['Next.js', 'Tailwind CSS'],
      files: ['app/page.tsx'],
      totalFiles: 1,
    },
    userMessage: 'Segue com isso usando o contexto da memoria',
    attachments: [{ name: 'brief.md', type: 'text/markdown' }],
    conversationMessages: [{ role: 'user', text: 'Criar landing premium' }],
    userId: 'user-1',
    conversationId: 'conversation-1',
    jobId: 'job-1',
    stage: 'test',
  });

  assert.strictEqual(activeMemory.schemaVersion, ACTIVE_MEMORY_SCHEMA_VERSION);
  assert.strictEqual(activeMemory.current.continuationIntent, true);
  assert.strictEqual(activeMemory.user.available, true);
  assert.strictEqual(activeMemory.project.available, true);
  assert.ok(activeMemory.decision.routeContextText.includes('Memoria de usuario'));
  assert.ok(activeMemory.decision.briefingContextText.includes('Mensagem atual'));
  assert.ok(activeMemory.decision.editContextText.includes('app/page.tsx'));
  assert.strictEqual(activeMemory.project.mempalace.ok, true);
  assert.strictEqual(activeMemory.project.rag.ok, true);
  assert.strictEqual(activeMemory.scope.userId, 'user-1');
  assert.strictEqual(activeMemory.scope.projectId, 'project-1');
  assert.strictEqual(activeMemory.scope.conversationId, 'conversation-1');
  assert.strictEqual(activeMemory.scope.jobId, 'job-1');
  assert.strictEqual(activeMemory.validity.generatedAt, '2026-05-26T12:00:00.000Z');
  assert.strictEqual(activeMemory.validity.expired, false);
  assert.ok(activeMemory.validity.expiresAt);
  assert.ok(activeMemory.citations.length >= 4);
  assert.ok(activeMemory.citations.some((citation) => citation.sourceType === 'user_memory'));
  assert.ok(activeMemory.citations.some((citation) => citation.source === 'mempalace'));
  assert.ok(activeMemory.citations.some((citation) => citation.source === 'rag'));
  assert.ok(activeMemory.citations.every((citation) => citation.confidenceScore !== undefined));
  assert.ok(activeMemory.citations.every((citation) => citation.scope));
  assert.ok(activeMemory.provenance);
  assert.strictEqual(activeMemory.provenance.schemaVersion, 'memory-provenance-v1');
  assert.ok(activeMemory.provenance.used.length >= 4);
  assert.ok(activeMemory.provenance.confidence.average >= 0);
  assert.strictEqual(activeMemory.retrieval.reason, 'current_message_requested_memory_continuation');
  assert.strictEqual(activeMemory.retrieval.citationsCount, activeMemory.citations.length);

  const summary = summarizeActiveMemory(activeMemory);
  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.continuationIntent, true);
  assert.strictEqual(summary.scope.projectId, 'project-1');
  assert.strictEqual(summary.citationsCount, activeMemory.citations.length);
  assert.strictEqual(summary.retrievalReason, 'current_message_requested_memory_continuation');
  assert.strictEqual(summary.project.rag, 'ok');
  assert.strictEqual(summary.provenance.usedCount, activeMemory.provenance.used.length);
  assert.strictEqual(auditEvents[0].type, 'cortex.active_memory_built');

  const rebuiltFromExpiredHint = await service.buildActiveMemoryContext({
    projectId: 'project-1',
    projectInfo: {
      id: 'project-1',
      rootPath: '/tmp/Faber Active',
      stacks: ['Next.js'],
      files: [],
      totalFiles: 0,
    },
    userMessage: 'Usar memoria ativa neste projeto',
    contextHint: {
      activeMemory: {
        ...activeMemory,
        validity: {
          ...activeMemory.validity,
          expiresAt: '2026-05-26T11:59:59.000Z',
        },
      },
    },
    userId: 'user-1',
    conversationId: 'conversation-1',
    stage: 'test',
  });
  assert.notStrictEqual(rebuiltFromExpiredHint, activeMemory);
  assert.strictEqual(rebuiltFromExpiredHint.validity.expired, false);
  assert.ok(auditEvents.some((event) => event.type === 'cortex.active_memory_context_hint_ignored'));

  console.log('active-memory-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
