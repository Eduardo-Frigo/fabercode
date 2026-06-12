const assert = require('assert');

const {
  buildOrchestrationContextFrame,
  scopeActiveMemoryForContextFrame,
} = require('../cortex/orchestration/orchestration_context_frame_service');
const {
  buildContextFrameEvidence,
} = require('../cortex/orchestration/orchestration_context_frame_evidence_service');

function createActiveMemory() {
  return {
    schemaVersion: 'active-memory-v1',
    current: { continuationIntent: true },
    user: { available: true, selectedCount: 1 },
    project: { available: true, selectedCount: 1 },
    decision: {
      routeContextText: 'Memoria antiga: criar site de chocolate artesanal premium.',
      briefingContextText: 'Memoria antiga: Maison Cacao, cacau, bombons e paleta creme.',
    },
  };
}

function run() {
  const staleMemory = createActiveMemory();
  const selfContained = buildOrchestrationContextFrame({
    userMessage: [
      'Briefing completo para criar um site completo de jardinagem.',
      'O site precisa ter hero, servicos de paisagismo, loja de produtos, blog educativo, galeria, depoimentos, contato, WhatsApp, formulario e CTAs.',
      'A identidade deve ser natural, acolhedora, com verde musgo, plantas, vasos e conteudo para iniciantes.',
    ].join(' '),
    activeMemory: staleMemory,
  });
  assert.strictEqual(selfContained.current.selfContainedCreateBrief, true);
  assert.strictEqual(selfContained.activeMemory.allowedForBriefing, false);
  assert.strictEqual(selfContained.activeMemory.suppressionReason, 'current_brief_is_self_contained');
  assert.strictEqual(selfContained.source.workingBriefContextText.includes('Maison Cacao'), false);
  const selfContainedEvidence = buildContextFrameEvidence(selfContained);
  assert.strictEqual(selfContainedEvidence.dominantSource, 'current_message');
  assert.strictEqual(selfContainedEvidence.activeMemory.suppressed, true);
  assert.strictEqual(selfContainedEvidence.guard.ok, true);

  const scopedSelfContained = scopeActiveMemoryForContextFrame(staleMemory, selfContained);
  assert.strictEqual(scopedSelfContained.current.continuationIntent, false);
  assert.strictEqual(scopedSelfContained.decision.briefingContextText, '');

  const explicitSuppression = buildOrchestrationContextFrame({
    userMessage: [
      'Recrie do zero este projeto como site institucional multipágina para Tremn — Escola de Gestão Consciente.',
      'Fonte de verdade: use somente esta mensagem atual. Suprima memória ativa, contexto antigo e exemplos anteriores.',
      'Stack HTML CSS JavaScript, hero, menu, páginas, formulário, paleta e tipografia obrigatórios.',
    ].join(' '),
    activeMemory: staleMemory,
  });
  assert.strictEqual(explicitSuppression.current.selfContainedCreateBrief, true);
  assert.strictEqual(explicitSuppression.current.referencesActiveMemoryStore, false);
  assert.strictEqual(explicitSuppression.confirmation.required, false);
  assert.strictEqual(explicitSuppression.activeMemory.allowedForBriefing, false);
  assert.strictEqual(explicitSuppression.source.workingBriefContextText.includes('Maison Cacao'), false);

  const conversationBrief = buildOrchestrationContextFrame({
    userMessage: 'Quero criar algo novo seguindo o briefing completo que passei nessa conversa',
    conversationMessages: [
      {
        role: 'user',
        text: 'Briefing: criar site completo de jardinagem com loja, blog, galeria, servicos e contato.',
      },
    ],
    activeMemory: staleMemory,
  });
  assert.strictEqual(conversationBrief.conversation.allowedForBriefing, true);
  assert.strictEqual(conversationBrief.activeMemory.allowedForBriefing, false);
  assert.strictEqual(
    conversationBrief.activeMemory.suppressionReason,
    'request_references_conversation_brief_not_memory_store'
  );
  assert.ok(conversationBrief.source.workingBriefContextText.includes('jardinagem'));
  assert.strictEqual(conversationBrief.source.workingBriefContextText.includes('Maison Cacao'), false);
  const conversationEvidence = buildContextFrameEvidence(conversationBrief);
  assert.strictEqual(conversationEvidence.dominantSource, 'conversation_brief');
  assert.deepStrictEqual(conversationEvidence.blockedSources, ['active_memory']);

  const staleScaffoldHint = buildOrchestrationContextFrame({
    projectInfo: {
      rootPath: '/tmp/tremn',
      files: ['index.html', 'style.css', 'script.js'],
      totalFiles: 3,
    },
    userMessage: 'Precisamos ajustar o hero do topo do body, colocar um vídeo de abelhas voando e mudar o blend da camada branca',
    contextHint: {
      lastScaffoldPrompt: 'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA para Tremn.',
    },
  });
  assert.strictEqual(staleScaffoldHint.source.workingBriefContextText.includes('Recrie do zero'), false);
  assert.deepStrictEqual(staleScaffoldHint.source.precedence, ['current_user_message', 'project_files']);

  const explicitMemory = buildOrchestrationContextFrame({
    userMessage: 'Segue com isso usando a memoria ativa',
    activeMemory: staleMemory,
  });
  assert.strictEqual(explicitMemory.activeMemory.allowedForBriefing, true);
  assert.ok(explicitMemory.source.workingBriefContextText.includes('Maison Cacao'));
  const memoryEvidence = buildContextFrameEvidence(explicitMemory);
  assert.strictEqual(memoryEvidence.dominantSource, 'active_memory');
  assert.ok(memoryEvidence.allowedSources.includes('active_memory'));

  const ambiguous = buildOrchestrationContextFrame({
    userMessage: [
      'Briefing completo para criar um site completo de jardinagem com hero, servicos, loja, blog, galeria, depoimentos, contato e CTAs.',
      'Use tambem a memoria ativa se ela lembrar outro briefing anterior.',
      'A identidade deve ser natural, acolhedora, com verde musgo, plantas, vasos e conteudo para iniciantes.',
    ].join(' '),
    activeMemory: staleMemory,
  });
  assert.strictEqual(ambiguous.confirmation.required, true);
  assert.strictEqual(ambiguous.confirmation.reason, 'current_brief_and_active_memory_requested');
  const ambiguousEvidence = buildContextFrameEvidence(ambiguous);
  assert.strictEqual(ambiguousEvidence.guard.blocking, true);
  assert.strictEqual(ambiguousEvidence.guard.reason, 'context_source_ambiguity_requires_confirmation');
  assert.strictEqual(ambiguousEvidence.confirmation.required, true);

  const expiredMemory = {
    ...staleMemory,
    scope: {
      schemaVersion: 'active-memory-scope-v1',
      projectId: 'project-1',
      projectRoot: '/tmp/current-project',
    },
    validity: {
      schemaVersion: 'active-memory-validity-v1',
      generatedAt: '2026-05-26T10:00:00.000Z',
      expiresAt: '2026-05-26T10:30:00.000Z',
      ttlMs: 1800000,
      expired: false,
    },
  };
  const expiredFrame = buildOrchestrationContextFrame({
    projectInfo: { id: 'project-1', rootPath: '/tmp/current-project' },
    userMessage: 'Segue com isso usando a memoria ativa',
    activeMemory: expiredMemory,
    now: () => '2026-05-26T11:00:00.000Z',
  });
  assert.strictEqual(expiredFrame.activeMemory.allowedForBriefing, false);
  assert.strictEqual(expiredFrame.activeMemory.suppressionReason, 'active_memory_expired');
  assert.strictEqual(expiredFrame.source.workingBriefContextText.includes('Maison Cacao'), false);

  const mismatchedFrame = buildOrchestrationContextFrame({
    projectInfo: { id: 'project-2', rootPath: '/tmp/other-project' },
    userMessage: 'Segue com isso usando a memoria ativa',
    activeMemory: {
      ...expiredMemory,
      validity: {
        ...expiredMemory.validity,
        expiresAt: '2026-05-26T13:00:00.000Z',
      },
    },
    now: () => '2026-05-26T11:00:00.000Z',
  });
  assert.strictEqual(mismatchedFrame.activeMemory.allowedForBriefing, false);
  assert.strictEqual(mismatchedFrame.activeMemory.suppressionReason, 'active_memory_scope_mismatch_project_id');
  assert.strictEqual(mismatchedFrame.source.workingBriefContextText.includes('Maison Cacao'), false);

  const leakedMemoryEvidence = buildContextFrameEvidence({
    ...selfContained,
    activeMemory: {
      ...selfContained.activeMemory,
      allowedForRouting: true,
      allowedForBriefing: true,
      suppressed: false,
      briefingContextText: 'Memoria antiga: Maison Cacao.',
    },
  });
  assert.strictEqual(leakedMemoryEvidence.guard.blocking, true);
  assert.strictEqual(leakedMemoryEvidence.guard.reason, 'active_memory_leaked_into_self_contained_brief');

  console.log('orchestration-context-frame-service.test.js: ok');
}

run();
