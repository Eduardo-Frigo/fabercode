const assert = require('assert');

const { createProductOrchestratorService } = require('../cortex/orchestration/product_orchestrator_service');
const { createProjectBlueprintService } = require('../cortex/orchestration/project_blueprint_service');

function createProjectInfo(overrides = {}) {
  return {
    id: 'project-1',
    rootPath: '/tmp/faber-product-route',
    files: [],
    stacks: [],
    totalFiles: 0,
    ...overrides,
  };
}

function createService(overrides = {}) {
  const blueprintService = createProjectBlueprintService();
  return createProductOrchestratorService({
    getSelectedAiProvider: () => 'openai',
    shouldPreferProjectBlueprint: blueprintService.shouldPreferProjectBlueprint,
    resolveExecutionIntent: (userMessage, contextHint, projectInfo) => {
      if (projectInfo && projectInfo.totalFiles > 0) return 'edit_project';
      return /criar|crie|gerar|gere|site|app|next|lamp/i.test(String(userMessage || ''))
        ? 'init_project'
        : 'edit_project';
    },
    extractRequestedTitle: (userMessage) => {
      const match = String(userMessage || '').match(/t[ií]tulo.*?"([^"]+)"/i);
      return match ? match[1] : '';
    },
    isThemeColorEditRequest: (userMessage) =>
      /troque|mude|altere|ajuste/i.test(String(userMessage || '')) &&
      /cor|cores|paleta|#[0-9a-f]{3,6}/i.test(String(userMessage || '')),
    isLiteralColorReplacementRequest: (userMessage) =>
      /altere|alterar|mude|troque|substitua/i.test(String(userMessage || '')) &&
      (String(userMessage || '').match(/#[0-9a-f]{3,6}\b/gi) || []).length >= 2,
    ...overrides,
  });
}

async function run() {
  const service = createService();

  const chat = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'oi',
  });
  assert.strictEqual(chat.decision, 'chat');
  assert.strictEqual(chat.meta.reason, 'small_talk_no_execution');
  assert.strictEqual(chat.meta.planner, 'product_orchestrator');

  const missingProject = await service.resolveProductRoute({
    projectInfo: null,
    userMessage: 'criar site em Next.js',
  });
  assert.strictEqual(missingProject.decision, 'clarify');
  assert.strictEqual(missingProject.meta.reason, 'missing_project_for_work');

  const blueprint = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero criar um site em next.js, com react e tailwind.',
      'O site é para um advogado, quero azul e branco, mas pode sugerir o design system.',
      'Use tudo em placeholder e depois ajusto quando tiver algo para visualizar.',
    ].join(' '),
    attachments: [],
  });
  assert.strictEqual(blueprint.decision, 'execute');
  assert.strictEqual(blueprint.meta.reason, 'adaptive_blueprint_create');
  assert.strictEqual(blueprint.productRoute.mode, 'adaptive_blueprint');
  assert.ok(blueprint.executionMessage.includes('advogado'));

  const greenhouseBlueprint = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero criar uma landing page em Next.js para venda de estufas agrícolas.',
      'Preciso de hero video full width, verde profundo, cultivo protegido, viveiros e orçamento.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes eu pedi algo para Clínica Sorriso.' },
      { role: 'assistant', text: 'A primeira versão ficou odontológica e genérica.' },
    ],
  });
  assert.strictEqual(greenhouseBlueprint.decision, 'execute');
  assert.strictEqual(greenhouseBlueprint.meta.reason, 'adaptive_blueprint_create');
  assert.strictEqual(greenhouseBlueprint.productRoute.mode, 'adaptive_blueprint');
  assert.strictEqual(greenhouseBlueprint.workingBrief.product.domain, 'greenhouses');
  assert.ok(greenhouseBlueprint.executionMessage.includes('estufas agrícolas'));
  assert.ok(greenhouseBlueprint.workingBrief.mediaIntent[0].query.includes('greenhouse farming'));

  const aquariumContinuation = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Acho que horário seria interessante, e uma CTA para comprar ingressos.',
      'Queria falar de passeios com guia para ver os pinguins, mapa e contato.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Queria fazer o site de um aquário' },
      {
        role: 'assistant',
        text: 'Legal. Pra iniciar um site de aquário em Next.js, posso gerar a estrutura inicial. Quais seções principais você quer?',
      },
      {
        role: 'user',
        text: 'Queria imagens, ícones, tom azul claro e uma fonte do Google como Manrope.',
      },
      {
        role: 'assistant',
        text: 'Perfeito, dá para criar um visual imersivo em Next.js com tons de azul claro e Manrope.',
      },
    ],
  });
  assert.strictEqual(aquariumContinuation.decision, 'execute');
  assert.strictEqual(aquariumContinuation.productRoute.mode, 'adaptive_blueprint');
  assert.strictEqual(aquariumContinuation.productRoute.executionIntent, 'init_project');
  assert.strictEqual(aquariumContinuation.workingBrief.product.domain, 'aquarium');
  assert.strictEqual(aquariumContinuation.workingBrief.style.typography.family, 'Manrope');

  const ambiguousCreate = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'quero criar um site',
  });
  assert.strictEqual(ambiguousCreate.decision, 'clarify');
  assert.strictEqual(ambiguousCreate.meta.reason, 'scaffold_needs_product_start');

  const existingEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/layout.tsx'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Altere o título da página para "Portal Faber"',
  });
  assert.strictEqual(existingEdit.decision, 'execute');
  assert.strictEqual(existingEdit.meta.reason, 'deterministic_edit_intent');
  assert.strictEqual(existingEdit.productRoute.mode, 'deterministic_patch');

  const existingThemeEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Troque as cores de verde para esse azul #3240a8',
    contextHint: {
      originalUserMessage: 'Quero criar um site em Next.js com React e Tailwind usando placeholders.',
    },
  });
  assert.strictEqual(existingThemeEdit.decision, 'execute');
  assert.strictEqual(existingThemeEdit.meta.reason, 'deterministic_edit_intent');
  assert.strictEqual(existingThemeEdit.productRoute.capability, 'edit_project');

  const existingLiteralColorEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Quero alterar as cores aonde for #257066 por um azul, a cor #4293c2',
  });
  assert.strictEqual(existingLiteralColorEdit.decision, 'execute');
  assert.strictEqual(existingLiteralColorEdit.meta.reason, 'deterministic_edit_intent');
  assert.strictEqual(existingLiteralColorEdit.productRoute.mode, 'deterministic_patch');

  const existingSemanticColorEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'queria trocar todos os textos em verde pra um azul suave',
  });
  assert.strictEqual(existingSemanticColorEdit.decision, 'execute');
  assert.strictEqual(existingSemanticColorEdit.meta.reason, 'build_mode_existing_project_edit');
  assert.strictEqual(existingSemanticColorEdit.productRoute.mode, 'existing_project_edit');

  const exploratoryExisting = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Não sei bem ainda o que eu quero',
  });
  assert.strictEqual(exploratoryExisting.decision, 'chat');
  assert.strictEqual(exploratoryExisting.meta.reason, 'exploratory_conversation_no_execution');
  assert.strictEqual(exploratoryExisting.productRoute.mode, 'exploratory_conversation');

  const search = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx'],
      totalFiles: 2,
    }),
    userMessage: 'procure o texto "Portal Faber" nos arquivos',
  });
  assert.strictEqual(search.decision, 'execute');
  assert.strictEqual(search.meta.reason, 'search_project_intent');
  assert.strictEqual(search.productRoute.capability, 'search_project');

  const diagnostic = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx'],
      totalFiles: 2,
    }),
    userMessage: 'diagnosticar erro de build e preparar correção',
  });
  assert.strictEqual(diagnostic.decision, 'execute');
  assert.strictEqual(diagnostic.meta.reason, 'build_mode_diagnostic_repair');
  assert.strictEqual(diagnostic.productRoute.capability, 'diagnose_project');
  assert.strictEqual(diagnostic.productRoute.executionIntent, 'diagnose_project');

  const toolAction = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json'],
      totalFiles: 1,
    }),
    userMessage: 'rode npm run build no terminal',
  });
  assert.strictEqual(toolAction.decision, 'execute');
  assert.strictEqual(toolAction.meta.reason, 'build_mode_tool_action');
  assert.strictEqual(toolAction.productRoute.capability, 'project_tools');
  assert.strictEqual(toolAction.productRoute.executionIntent, 'tool_action');

  const designToCode = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'crie a tela conforme a referência visual anexada',
    attachments: [{ name: 'hero-reference.png', type: 'image/png' }],
  });
  assert.strictEqual(designToCode.decision, 'execute');
  assert.strictEqual(designToCode.meta.reason, 'build_mode_design_to_code');
  assert.strictEqual(designToCode.productRoute.mode, 'design_to_code');

  const semantic = await service.resolveProductRoute({
    projectInfo: createProjectInfo({ files: ['README.md'], totalFiles: 1 }),
    userMessage: 'qual caminho de produto você recomenda?',
  });
  assert.strictEqual(semantic.delegateToPersona, true);
  assert.strictEqual(semantic.meta.reason, 'requires_persona_semantics');

  let aiRouterCalls = 0;
  const aiService = createService({
    requestAiProductRouteDecision: async () => {
      aiRouterCalls += 1;
      return {
        decision: 'execute',
        capability: 'edit_project',
        mode: 'cortex_incremental_edit',
        response: 'Vou preparar uma edição incremental.',
        executionMessage: 'ajustar a seção hero do projeto',
        confidence: 0.91,
      };
    },
  });
  const aiEdit = await aiService.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx'],
      totalFiles: 2,
    }),
    userMessage: 'melhore o hero para ficar mais profissional',
  });
  assert.strictEqual(aiRouterCalls, 0);
  assert.strictEqual(aiEdit.decision, 'execute');
  assert.strictEqual(aiEdit.meta.reason, 'build_mode_existing_project_edit');
  assert.strictEqual(aiEdit.executionMessage, 'melhore o hero para ficar mais profissional');

  const guardedService = createService({
    requestAiProductRouteDecision: async () => ({
      decision: 'execute',
      capability: 'create_project',
      response: 'Vou criar o projeto.',
      executionMessage: 'criar site em Next.js',
      confidence: 0.95,
    }),
  });
  const guardedMissingProject = await guardedService.resolveProductRoute({
    projectInfo: null,
    userMessage: 'criar site em Next.js',
  });
  assert.strictEqual(guardedMissingProject.decision, 'clarify');
  assert.strictEqual(guardedMissingProject.meta.reason, 'missing_project_for_work');

  const blueprintOverrideService = createService({
    requestAiProductRouteDecision: async () => ({
      decision: 'clarify',
      capability: 'create_project',
      response: 'Quais seções você quer?',
      confidence: 0.84,
    }),
  });
  const blueprintOverride = await blueprintOverrideService.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero criar um site em next.js, com react e tailwind.',
      'O site é para um advogado, pode sugerir o design system.',
      'Use placeholders.',
    ].join(' '),
  });
  assert.strictEqual(blueprintOverride.decision, 'execute');
  assert.strictEqual(blueprintOverride.meta.reason, 'adaptive_blueprint_create');
  assert.strictEqual(blueprintOverride.productRoute.mode, 'adaptive_blueprint');

  console.log('product-orchestrator-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
