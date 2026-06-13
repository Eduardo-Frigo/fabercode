const assert = require('assert');

const {
  buildCortexBriefingClarificationResponse,
  buildDefaultScaffoldPrompt,
  createCortexBriefingService,
  normalizeBrainSiteSpec,
  shouldAskCortexBriefingClarification,
  shouldUseDefaultScaffoldConfiguration,
} = require('../cortex/orchestration/briefing_service');

function clipText(value, max = 4000) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max) : text;
}

function tryParseJsonObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function run() {
  assert.strictEqual(shouldUseDefaultScaffoldConfiguration('pode seguir no padrão'), true);
  assert.strictEqual(shouldUseDefaultScaffoldConfiguration('pode fazer placeholder de qualquer coisa'), true);
  assert.strictEqual(shouldUseDefaultScaffoldConfiguration('placeholder rápido'), true);
  assert.strictEqual(shouldUseDefaultScaffoldConfiguration('você decide as cores e textos'), true);
  assert.strictEqual(shouldUseDefaultScaffoldConfiguration('criar site completo'), false);
  const defaultPrompt = buildDefaultScaffoldPrompt('padrão', { lastScaffoldPrompt: 'site para clínica veterinária em LAMP' });
  assert.ok(defaultPrompt.includes('veterinário'));
  assert.ok(defaultPrompt.includes('index.php'));
  assert.ok(defaultPrompt.includes('não pedir novas clarificações'));

  const legalDefaultPrompt = buildDefaultScaffoldPrompt('placeholder rápido', { lastScaffoldPrompt: 'site para advogado em Next.js com Tailwind' });
  assert.ok(legalDefaultPrompt.includes('advocacia'));
  assert.strictEqual(legalDefaultPrompt.includes('veterinária'), false);

  const clarification = buildCortexBriefingClarificationResponse('criar site', 1, ['Pergunta A?', 'Pergunta B?']);
  assert.ok(clarification.includes('Ainda falta uma decisão'));
  assert.ok(clarification.includes('Pergunta A?'));
  assert.ok(clarification.includes('Pode responder do seu jeito'));
  assert.strictEqual(clarification.includes('Escolha um caminho curto'), false);
  assert.strictEqual(clarification.includes('composição modular'), false);
  assert.strictEqual(clarification.includes('CTA principal'), false);
  assert.strictEqual(clarification.includes('padrão institucional premium'), false);

  assert.strictEqual(
    shouldAskCortexBriefingClarification('criar site', {}, { hasScaffoldIntent: () => true }),
    true
  );
  assert.strictEqual(
    shouldAskCortexBriefingClarification(
      'pode fazer placeholder de qualquer coisa',
      { awaitingScaffoldClarification: true },
      { hasScaffoldIntent: () => false }
    ),
    false
  );
  assert.strictEqual(
    shouldAskCortexBriefingClarification(
      'criar site institucional em LAMP com placeholder rápido',
      {},
      { hasScaffoldIntent: () => true }
    ),
    false
  );
  assert.strictEqual(
    shouldAskCortexBriefingClarification(
      'next.js, queria um site azul e offwhite para um advogado',
      {},
      { hasScaffoldIntent: () => true }
    ),
    false
  );
  assert.strictEqual(
    shouldAskCortexBriefingClarification(
      'Atualize o README',
      {},
      { hasScaffoldIntent: () => false }
    ),
    false
  );
  assert.strictEqual(
    shouldAskCortexBriefingClarification(
      'O que é necessário corrigir para a visualização funcionar?',
      { awaitingScaffoldClarification: true },
      { hasScaffoldIntent: () => false }
    ),
    false
  );
  assert.strictEqual(
    shouldAskCortexBriefingClarification(
      'O que é necessário corrigir para a visualização funcionar?',
      { awaitingScaffoldClarification: true },
      { hasScaffoldIntent: () => true }
    ),
    false
  );
  assert.strictEqual(
    shouldAskCortexBriefingClarification(
      'Oi, quero criar um site de múltiplas páginas para uma escola de gestão consciente, estou anexando um arquivo com a paleta de cores da marca',
      {},
      { hasScaffoldIntent: () => true }
    ),
    false
  );
  const tremnDefaultPrompt = buildDefaultScaffoldPrompt('pode seguir', {
    lastScaffoldPrompt:
      'Criar site institucional multipágina para Tremn — Escola de Gestão Consciente. Páginas obrigatórias: Início, A Escola, Premissas, Jornada, Conteúdos e Contato. Paleta Pantone P 1-1 C dominante.',
  });
  assert.ok(tremnDefaultPrompt.includes('Tremn'));
  assert.ok(tremnDefaultPrompt.includes('Páginas obrigatórias'));

  const platformSpec = normalizeBrainSiteSpec(
    {
      brandName: 'Faber',
      header: { menuItems: ['Início', 'Painel'] },
      pages: [{ title: 'Painel', sections: [{ title: 'Resumo', cta: 'Abrir' }] }],
    },
    'criar plataforma com dashboard'
  );
  assert.strictEqual(platformSpec.siteType, 'platform');
  assert.strictEqual(platformSpec.menuItems.length, 2);
  assert.strictEqual(platformSpec.pages[0].slug, 'index');
  assert.strictEqual(platformSpec.pages[0].sections[0].ctaLabel, 'Abrir');

  const defaultSpec = normalizeBrainSiteSpec({ siteType: 'modular_site' }, 'criar site');
  assert.strictEqual(defaultSpec.siteType, 'modular_site');
  assert.strictEqual(defaultSpec.pages[0].sections.length, 4);

  const providerCalls = [];
  const service = createCortexBriefingService({
    BRAIN_BRIEFING_TIMEOUT_MS: 1234,
    PERSONA_MODEL_BRAIN: 'brain-model',
    buildAttachmentsPromptContext: async () => 'attachment text',
    buildDiagnosticsPromptContext: () => 'diagnostics text',
    buildLocalProjectDiagnostics: () => ({ htmlFilesWithoutStylesheet: ['index.html'] }),
    buildProjectEvolutionContext: () => 'project files text',
    callPersonaProviderChat: async (model, messages, timeoutMs, requestOptions) => {
      providerCalls.push({ model, messages, timeoutMs, requestOptions });
      return JSON.stringify({
        brief: 'Brief final',
        acceptanceCriteria: ['Critério A', ''],
        risks: ['Risco A'],
        suggestedPasses: ['render_operations'],
        needsClarification: true,
        clarificationQuestions: ['Qual CTA?'],
        siteSpec: {
          siteType: 'modular_site',
          brandName: 'Marca',
          pages: [{ slug: 'home', title: 'Home', sections: [{ id: 'hero', title: 'Hero' }] }],
        },
      });
    },
    clipText,
    formatLocalProjectDiagnosticsForPrompt: () => 'local diagnostics text',
    formatMempalaceCoreForPrompt: () => 'mempalace core text',
    getRuntimeProfileSettings: () => ({ brainSampleFilesLimit: 2 }),
    hasScaffoldIntent: () => true,
    sanitizeAssistantText: (text, fallback) => String(text || fallback),
    tryParseJsonObject,
  });

  assert.strictEqual(service.shouldAskCortexBriefingClarification('criar site', {}), true);
  const result = await service.requestCortexBrainBriefing({
    projectInfo: {
      rootPath: '/tmp/project',
      stacks: ['Electron'],
      totalFiles: 3,
      counters: { js: 2 },
      files: ['main.js', 'renderer/app.js', 'README.md'],
    },
    userMessage: 'criar site completo',
    attachments: [{ name: 'brief.md', type: 'text/markdown' }],
    mempalaceContext: { contextText: 'memory text' },
    mempalaceCore: { ok: true },
    ragContext: { provider: 'r2r', contextText: 'rag text' },
    cortexContext: { available: true, contextText: 'cortex text' },
    activeMemory: {
      schemaVersion: 'active-memory-v1',
      decision: {
        briefingContextText: 'Memoria ativa: usuario prefere estrutura modular e projeto usa Tailwind.',
      },
    },
    runtimeBudget: {
      maxPromptCharsPerPass: 7000,
      generationOptions: { num_predict: 900 },
    },
    latestDiagnostics: { issues: [] },
  });

  assert.strictEqual(result.brief, 'Brief final');
  assert.strictEqual(result.acceptanceCriteria.length, 1);
  assert.strictEqual(result.needsClarification, true);
  assert.strictEqual(result.clarificationQuestions[0], 'Qual CTA?');
  assert.strictEqual(result.briefSpec.brandName, 'Marca');
  assert.strictEqual(providerCalls[0].model, 'brain-model');
  assert.strictEqual(providerCalls[0].timeoutMs, 1234);
  assert.strictEqual(providerCalls[0].requestOptions.options.num_predict, 700);
  assert.ok(providerCalls[0].messages[1].content.includes('attachment text'));
  assert.ok(providerCalls[0].messages[1].content.includes('project files text'));
  assert.ok(providerCalls[0].messages[1].content.includes('mempalace core text'));
  assert.ok(providerCalls[0].messages[1].content.includes('Memoria ativa: usuario prefere estrutura modular'));

  const defaultsResult = await service.requestCortexBrainBriefing({
    projectInfo: {
      rootPath: '/tmp/project',
      stacks: ['LAMP'],
      totalFiles: 0,
      counters: {},
      files: [],
    },
    userMessage: 'pode fazer placeholder de qualquer coisa',
    attachments: [],
    runtimeBudget: {
      maxPromptCharsPerPass: 7000,
      generationOptions: { num_predict: 900 },
    },
  });

  assert.strictEqual(defaultsResult.needsClarification, false);
  assert.deepStrictEqual(defaultsResult.clarificationQuestions, []);
  assert.strictEqual(defaultsResult.raw, 'deterministic_defaults_briefing');
  assert.strictEqual(providerCalls.length, 1);

  const fallbackService = createCortexBriefingService({
    callPersonaProviderChat: async () => 'texto não json',
    getRuntimeProfileSettings: () => ({ brainSampleFilesLimit: 1 }),
    sanitizeAssistantText: (text) => `sanitized:${text}`,
    tryParseJsonObject,
  });
  const fallback = await fallbackService.requestCortexBrainBriefing({
    projectInfo: { rootPath: '/tmp/project', files: [] },
    userMessage: 'criar site',
    runtimeBudget: { maxPromptCharsPerPass: 1000, generationOptions: {} },
  });
  assert.ok(fallback.brief.includes('sanitized:Briefing normalizado localmente pelo Cortex'));
  assert.strictEqual(fallback.raw, 'texto não json');
  assert.strictEqual(fallback.suggestedPasses[0], 'render_operations');
  assert.strictEqual(fallback.needsClarification, false);

  const providerFailureFallbackService = createCortexBriefingService({
    callPersonaProviderChat: async () => {
      throw new Error('OpenAI não retornou texto gerado.');
    },
    getRuntimeProfileSettings: () => ({ brainSampleFilesLimit: 1 }),
    tryParseJsonObject,
  });
  const providerFailureFallback = await providerFailureFallbackService.requestCortexBrainBriefing({
    projectInfo: { rootPath: '/tmp/project', files: [] },
    userMessage: 'next.js, queria um site azul e offwhite para um advogado',
    runtimeBudget: { maxPromptCharsPerPass: 1000, generationOptions: {} },
  });
  assert.strictEqual(providerFailureFallback.providerFallback, true);
  assert.strictEqual(providerFailureFallback.providerFailure.code, 'persona_briefing_empty_response');
  assert.strictEqual(providerFailureFallback.providerFailure.retryable, false);
  assert.strictEqual(providerFailureFallback.needsClarification, false);
  assert.strictEqual(providerFailureFallback.suggestedPasses[0], 'render_operations');
  assert.ok(providerFailureFallback.raw.includes('provider_error:persona_briefing_empty_response:OpenAI não retornou texto gerado.'));

  const tremnProviderFailureFallback = await providerFailureFallbackService.requestCortexBrainBriefing({
    projectInfo: { rootPath: '/tmp/project', files: [] },
    userMessage: [
      'Criar um novo projeto web estático institucional para Tremn — Escola de Gestão Consciente.',
      'Use somente este briefing atual. Não é SaaS, não é dashboard e não é landing page única.',
      'Rotas obrigatórias: Início, A Escola, Premissas, Jornada, Conteúdos e Contato.',
      'Fonte Assistant nos títulos e Inter nos textos. Paleta Pantone P 1-1 C dominante.',
    ].join(' '),
    runtimeBudget: { maxPromptCharsPerPass: 3000, generationOptions: {} },
  });
  assert.strictEqual(tremnProviderFailureFallback.providerFallback, true);
  assert.strictEqual(tremnProviderFailureFallback.briefSpec.brandName, 'Tremn — Escola de Gestão Consciente');
  assert.strictEqual(tremnProviderFailureFallback.briefSpec.pages.length, 6);
  assert.ok(tremnProviderFailureFallback.acceptanceCriteria.some((criterion) => criterion.includes('Tremn')));

  console.log('briefing-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
