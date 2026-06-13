const assert = require('assert');

const { createProductOrchestratorService } = require('../cortex/orchestration/product_orchestrator_service');
const { createProductPolicyGateService } = require('../cortex/orchestration/product_policy_gate_service');
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
    isBackgroundColorEditRequest: (userMessage) =>
      /fundo|background/i.test(String(userMessage || '')) &&
      /vermelh|azul|verde|preto|branco|#[0-9a-f]{3,6}/i.test(String(userMessage || '')) &&
      !/imagem|foto|video|overlay/i.test(String(userMessage || '')),
    isSecondaryCtaEditRequest: (userMessage) =>
      /cta|bot[aã]o|link/i.test(String(userMessage || '')) &&
      /secund[aá]ri|segund/i.test(String(userMessage || '')),
    isCardTextEditRequest: (userMessage) =>
      /card|cart[aã]o/i.test(String(userMessage || '')) &&
      /troque|mude|altere|atualize/i.test(String(userMessage || '')),
    isGridColumnsEditRequest: (userMessage) =>
      /grid|colunas|cards/i.test(String(userMessage || '')) &&
      /colunas|grid-cols/i.test(String(userMessage || '')),
    isSectionReorderRequest: (userMessage) =>
      /mova|reordene|coloque/i.test(String(userMessage || '')) &&
      /antes|depois|ap[oó]s/i.test(String(userMessage || '')),
    isHeadingColorEditRequest: (userMessage) =>
      /h1|t[ií]tulo|headline/i.test(String(userMessage || '')) &&
      /cor|azul|verde|vermelh|#[0-9a-f]{3,6}/i.test(String(userMessage || '')),
    isLiteralColorReplacementRequest: (userMessage) =>
      /altere|alterar|mude|troque|substitua/i.test(String(userMessage || '')) &&
      (String(userMessage || '').match(/#[0-9a-f]{3,6}\b/gi) || []).length >= 2,
    isTypographyEditRequest: (userMessage) =>
      /fonte|fontes|tipografia|tipografias|typography/i.test(String(userMessage || '')),
    isUnsupportedBackgroundMediaRequest: (userMessage) =>
      /(fundo|background|hero|topo)/i.test(String(userMessage || '')) &&
      /(imagem|foto|video|vídeo|midia|mídia|overlay|camada)/i.test(String(userMessage || '')),
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
  assert.strictEqual(greenhouseBlueprint.meta.reason, 'faber_blueprint_create');
  assert.strictEqual(greenhouseBlueprint.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(greenhouseBlueprint.meta.buildMode, 'initial_blueprint');
  assert.strictEqual(greenhouseBlueprint.meta.routeModeContract.productRouteMode, 'faber_blueprint');
  assert.strictEqual(greenhouseBlueprint.workingBrief.product.domain, 'greenhouses');
  assert.ok(greenhouseBlueprint.executionMessage.includes('estufas agrícolas'));
  assert.ok(greenhouseBlueprint.workingBrief.mediaIntent[0].query.includes('greenhouse farming'));

  const forgeMrpRoute = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing completo — Forge MRP em Next.js com React e Tailwind.',
      'Criar um sistema de manufatura com itens, BOMs, estoque auditável, ordens de produção, cálculo determinístico de necessidades, máquina de estados finitos e audit log.',
      'Preciso de interface operacional orientada a dados, não landing page.',
    ].join(' '),
  });
  assert.strictEqual(forgeMrpRoute.decision, 'execute');
  assert.strictEqual(forgeMrpRoute.productRoute.capability, 'create_project');
  assert.strictEqual(forgeMrpRoute.productRoute.mode, 'guided_app_architecture');
  assert.strictEqual(forgeMrpRoute.meta.reason, 'guided_app_architecture_create');
  assert.strictEqual(forgeMrpRoute.buildModeRoute.mode, 'guided_app_architecture');

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
  assert.ok(['adaptive_blueprint', 'faber_blueprint'].includes(aquariumContinuation.productRoute.mode));
  assert.strictEqual(aquariumContinuation.productRoute.executionIntent, 'init_project');
  assert.strictEqual(aquariumContinuation.workingBrief.product.domain, 'aquarium');
  assert.strictEqual(aquariumContinuation.workingBrief.style.typography.family, 'Manrope');

  const emptyProjectBriefingContinuation = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'Quero criar algo novo, seguindo o briefing completo que passei nessa conversa',
    conversationMessages: [
      {
        role: 'user',
        text: [
          'Briefing: site completo de jardinagem com serviços de paisagismo, loja de produtos, blog educativo, galeria e contato.',
          'A home deve ter banner principal, categorias de jardinagem, depoimentos, chamada para orçamento e conteúdo sobre plantas internas.',
        ].join(' '),
      },
      {
        role: 'assistant',
        text: 'Antes de criar uma nova base neste projeto, preciso confirmar se você quer gerar um projeto novo ou editar a estrutura atual.',
      },
      {
        role: 'user',
        text: 'Não quero editar nada, quero algo novo.',
      },
    ],
  });
  assert.strictEqual(emptyProjectBriefingContinuation.decision, 'execute');
  assert.strictEqual(emptyProjectBriefingContinuation.productRoute.capability, 'create_project');
  assert.strictEqual(emptyProjectBriefingContinuation.productRoute.executionIntent, 'init_project');
  assert.strictEqual(emptyProjectBriefingContinuation.workingBrief.product.domain, 'gardening');
  assert.strictEqual(emptyProjectBriefingContinuation.meta.routeScore.requiresClarification, false);

  const stackChoiceContinuation = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'Quero manter o Next.js com App Router.',
    conversationMessages: [
      {
        role: 'user',
        text: [
          'Quero criar uma aplicação colaborativa estilo editor em tempo real.',
          'Preciso de documentos, presença online, comentários, histórico versionado, autenticação, permissões, organizações e convites.',
          'Os módulos principais são editor colaborativo, árvore de páginas, painel administrativo, billing, gestão de usuários e auditoria.',
          'Quero persistência em banco relacional, regras críticas para conflitos de edição, autosave, permissões por papel e trilha de auditoria.',
          'Os fluxos operáveis precisam cobrir criar workspace, convidar equipe, editar documento, comentar, publicar e restaurar versão anterior.',
          'Também quero validações e testes esperados para colaboração, integridade de permissões, build, smoke e estabilidade do editor.',
        ].join(' '),
      },
      {
        role: 'assistant',
        text: 'Perfeito. Antes de gerar, quero confirmar a stack: seguimos com Next.js ou você prefere React + Vite?',
      },
    ],
  });
  assert.strictEqual(stackChoiceContinuation.decision, 'execute');
  assert.strictEqual(stackChoiceContinuation.productRoute.capability, 'create_project');
  assert.strictEqual(stackChoiceContinuation.productRoute.executionIntent, 'init_project');
  assert.strictEqual(stackChoiceContinuation.meta.routeScore.requiresClarification, false);
  assert.match(stackChoiceContinuation.executionMessage, /colaborativ|editor|document/i);

  const directStackChoiceContinuation = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'usa o React com Vite',
    conversationMessages: [
      {
        role: 'user',
        text: [
          'Quero criar uma aplicação colaborativa estilo editor em tempo real.',
          'Preciso de documentos, presença online, comentários, histórico versionado, autenticação, permissões, organizações e convites.',
          'Os módulos principais são editor colaborativo, árvore de páginas, painel administrativo, billing, gestão de usuários e auditoria.',
          'Quero persistência em banco relacional, regras críticas para conflitos de edição, autosave, permissões por papel e trilha de auditoria.',
          'Os fluxos operáveis precisam cobrir criar workspace, convidar equipe, editar documento, comentar, publicar e restaurar versão anterior.',
          'Também quero validações e testes esperados para colaboração, integridade de permissões, build, smoke e estabilidade do editor.',
        ].join(' '),
      },
      {
        role: 'assistant',
        text: 'Perfeito. Antes de gerar, quero confirmar a stack: seguimos com Next.js ou você prefere React + Vite?',
      },
    ],
  });
  assert.strictEqual(directStackChoiceContinuation.decision, 'execute');
  assert.strictEqual(directStackChoiceContinuation.productRoute.capability, 'create_project');
  assert.strictEqual(directStackChoiceContinuation.productRoute.executionIntent, 'init_project');
  assert.strictEqual(directStackChoiceContinuation.meta.routeScore.requiresClarification, false);
  assert.match(directStackChoiceContinuation.executionMessage, /colaborativ|editor|document/i);

  const indifferenceStackChoiceContinuation = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'tanto faz',
    conversationMessages: [
      {
        role: 'user',
        text: [
          'Quero criar uma aplicação colaborativa estilo editor em tempo real.',
          'Preciso de documentos, presença online, comentários, histórico versionado, autenticação, permissões, organizações e convites.',
          'Os módulos principais são editor colaborativo, árvore de páginas, painel administrativo, billing, gestão de usuários e auditoria.',
          'Quero persistência em banco relacional, regras críticas para conflitos de edição, autosave, permissões por papel e trilha de auditoria.',
          'Os fluxos operáveis precisam cobrir criar workspace, convidar equipe, editar documento, comentar, publicar e restaurar versão anterior.',
          'Também quero validações e testes esperados para colaboração, integridade de permissões, build, smoke e estabilidade do editor.',
        ].join(' '),
      },
      {
        role: 'assistant',
        text: 'Perfeito. Antes de gerar, quero confirmar a stack: seguimos com Next.js ou você prefere React + Vite?',
      },
    ],
  });
  assert.strictEqual(indifferenceStackChoiceContinuation.decision, 'execute');
  assert.strictEqual(indifferenceStackChoiceContinuation.productRoute.capability, 'create_project');
  assert.strictEqual(indifferenceStackChoiceContinuation.productRoute.executionIntent, 'init_project');
  assert.strictEqual(indifferenceStackChoiceContinuation.meta.routeScore.requiresClarification, false);
  assert.match(indifferenceStackChoiceContinuation.executionMessage, /colaborativ|editor|document/i);

  const perfectExecuteContinuation = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'Perfeito, pode executar',
    conversationMessages: [
      {
        role: 'user',
        text: 'Quero criar uma aplicação colaborativa estilo editor em tempo real.'
      },
      {
        role: 'assistant',
        text: 'Segue a proposta inicial. Stack: React + TypeScript + WebSocket...'
      }
    ]
  });
  assert.strictEqual(perfectExecuteContinuation.decision, 'execute');
  assert.strictEqual(perfectExecuteContinuation.productRoute.capability, 'create_project');
  assert.strictEqual(perfectExecuteContinuation.productRoute.executionIntent, 'init_project');

  const suggestedExecuteContinuation = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'Pode executar o que você sugeriu,',
    conversationMessages: [
      {
        role: 'user',
        text: 'Quero criar uma aplicação colaborativa estilo editor em tempo real.'
      },
      {
        role: 'assistant',
        text: 'Segue a proposta inicial. Stack: React + TypeScript + WebSocket...'
      }
    ]
  });
  assert.strictEqual(suggestedExecuteContinuation.decision, 'execute');
  assert.strictEqual(suggestedExecuteContinuation.productRoute.capability, 'create_project');
  assert.strictEqual(suggestedExecuteContinuation.productRoute.executionIntent, 'init_project');

  const followPlanContinuation = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'Vamos seguir seu plano',
    conversationMessages: [
      {
        role: 'user',
        text: 'Quero criar uma aplicação colaborativa estilo editor em tempo real.'
      },
      {
        role: 'assistant',
        text: 'Segue a proposta inicial. Stack: React + TypeScript + WebSocket...'
      }
    ]
  });
  assert.strictEqual(followPlanContinuation.decision, 'execute');
  assert.strictEqual(followPlanContinuation.productRoute.capability, 'create_project');
  assert.strictEqual(followPlanContinuation.productRoute.executionIntent, 'init_project');

  const longBriefingCreate = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Tudo sim, quero inclusive criar um site completo de jardinagem.',
      'O site deve ajudar o visitante a encontrar rapidamente informações sobre jardinagem, serviços, produtos e formas de contato.',
      'Também preciso de loja, blog, galeria, depoimentos, WhatsApp e formulário de orçamento.',
      'Exemplo de texto: Cuidar de plantas pode ser simples, prazeroso e transformar qualquer ambiente.',
    ].join(' '),
  });
  assert.strictEqual(longBriefingCreate.decision, 'execute');
  assert.strictEqual(longBriefingCreate.productRoute.capability, 'create_project');
  assert.ok(['adaptive_blueprint', 'faber_blueprint'].includes(longBriefingCreate.productRoute.mode));
  assert.notStrictEqual(longBriefingCreate.meta.reason, 'search_project_intent');
  assert.strictEqual(longBriefingCreate.workingBrief.product.domain, 'gardening');

  const defaultBlueprintService = createProjectBlueprintService();
  const defaultRouterService = createProductOrchestratorService({
    getSelectedAiProvider: () => 'deterministic',
    shouldPreferProjectBlueprint: defaultBlueprintService.shouldPreferProjectBlueprint,
  });
  const metadataOnlySimpleNextCreate = await defaultRouterService.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['.faber/project.json'],
      totalFiles: 1,
    }),
    userMessage: 'Oi, gera um site pra mim em next.js, com múltiplas páginas e no topo do body um hero com video no fundo',
  });
  assert.strictEqual(metadataOnlySimpleNextCreate.decision, 'execute');
  assert.strictEqual(metadataOnlySimpleNextCreate.productRoute.capability, 'create_project');
  assert.strictEqual(metadataOnlySimpleNextCreate.productRoute.executionIntent, 'init_project');
  assert.strictEqual(metadataOnlySimpleNextCreate.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(metadataOnlySimpleNextCreate.meta.reason, 'faber_blueprint_create');
  assert.strictEqual(metadataOnlySimpleNextCreate.workingBrief.intent.action, 'create_project');

  const metadataOnlyStackAnswerCreate = await defaultRouterService.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['.faber/project.json'],
      totalFiles: 1,
    }),
    userMessage: 'Quero criar em next.js',
  });
  assert.strictEqual(metadataOnlyStackAnswerCreate.decision, 'execute');
  assert.strictEqual(metadataOnlyStackAnswerCreate.productRoute.capability, 'create_project');
  assert.strictEqual(metadataOnlyStackAnswerCreate.productRoute.executionIntent, 'init_project');
  assert.strictEqual(metadataOnlyStackAnswerCreate.productRoute.mode, 'faber_blueprint');

  const waitForBriefingBeforeCreate = await defaultRouterService.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['.faber/project.json'],
      totalFiles: 1,
    }),
    userMessage: 'Vamos criar uma aplicação em next.js completa, vou passar o briefing completo na sequência',
  });
  assert.strictEqual(waitForBriefingBeforeCreate.decision, 'chat');
  assert.strictEqual(waitForBriefingBeforeCreate.meta.reason, 'pending_briefing_no_execution');
  assert.strictEqual(waitForBriefingBeforeCreate.productRoute.capability, 'conversation');
  assert.strictEqual(waitForBriefingBeforeCreate.productRoute.executionIntent, 'conversation');

  const shortComplexAppNeedsContract = await defaultRouterService.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['.faber/project.json'],
      totalFiles: 1,
    }),
    userMessage: 'Quero criar um MRP em Next.js para manufatura',
  });
  assert.strictEqual(shortComplexAppNeedsContract.decision, 'clarify');
  assert.strictEqual(shortComplexAppNeedsContract.meta.reason, 'complex_app_requires_briefing_contract');
  assert.strictEqual(shortComplexAppNeedsContract.productRoute.capability, 'create_project');
  assert.strictEqual(shortComplexAppNeedsContract.productRoute.mode, 'complex_app_contract_intake');
  assert.strictEqual(shortComplexAppNeedsContract.productRoute.executionIntent, 'conversation');

  const existingProjectRepairSkipsComplexContract = await defaultRouterService.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/layout.tsx', 'app/globals.css', 'prisma/schema.prisma'],
      stacks: ['Next.js', 'React', 'Tailwind CSS', 'Prisma'],
      totalFiles: 5,
    }),
    userMessage:
      'Reparo obrigatório: package.json, app/layout.tsx, app/page.tsx e app/globals.css contêm instruções textuais. Substitua por código real válido para Next/Tailwind/Vitest/Playwright, preservando domínio e services.',
  });
  assert.strictEqual(existingProjectRepairSkipsComplexContract.decision, 'execute');
  assert.notStrictEqual(existingProjectRepairSkipsComplexContract.meta.reason, 'complex_app_requires_briefing_contract');
  assert.strictEqual(existingProjectRepairSkipsComplexContract.productRoute.capability, 'edit_project');
  assert.strictEqual(existingProjectRepairSkipsComplexContract.productRoute.executionIntent, 'edit_project');

  const previewRepairQuestion = await defaultRouterService.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 4,
    }),
    userMessage: 'O que é necessário corrigir para a visualização funcionar?',
  });
  assert.strictEqual(previewRepairQuestion.decision, 'execute');
  assert.strictEqual(previewRepairQuestion.productRoute.capability, 'diagnose_project');
  assert.strictEqual(previewRepairQuestion.productRoute.executionIntent, 'diagnose_project');
  assert.notStrictEqual(previewRepairQuestion.meta.reason, 'project_conversation_no_execution');

  const selfContainedPhotoLabBrief = await defaultRouterService.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing completo — Site para Laboratório Fotográfico',
      'Nome fictício do negócio',
      'Lumen Lab Fotográfico',
      'A marca atua com revelação de filmes, digitalização profissional, impressão fine art, restauração fotográfica, ampliações e atendimento para fotógrafos profissionais.',
      'O site deve ter estética cinematográfica, editorial e premium, fundo escuro, âmbar, hero full width com vídeo, serviços, portfólio, processo, orçamento, depoimentos, rodapé e botão Enviar arquivos.',
    ].join('\n'),
    conversationMessages: [
      { role: 'user', text: 'Smoke antigo: escultura em madeira para artista, ateliê e galeria.' },
    ],
  });
  assert.strictEqual(selfContainedPhotoLabBrief.decision, 'execute');
  assert.strictEqual(selfContainedPhotoLabBrief.productRoute.capability, 'create_project');
  assert.strictEqual(selfContainedPhotoLabBrief.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(selfContainedPhotoLabBrief.productRoute.executionIntent, 'init_project');
  assert.strictEqual(selfContainedPhotoLabBrief.workingBrief.product.domain, 'photo-lab');
  assert.strictEqual(selfContainedPhotoLabBrief.workingBrief.product.brandFallback, 'Lumen Lab Fotográfico');
  assert.strictEqual(selfContainedPhotoLabBrief.workingBrief.contractEscalation.required, false);

  const unsupportedFinalBriefing = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing Completo — Site de Escola de Musica Experimental.',
      'Criar site completo com hero, professores, agenda, blog, galeria, depoimentos, contato e formulario.',
      'Use conteudo final, sem placeholder, com identidade visual editorial.',
    ].join(' '),
    conversationMessages: [
      { role: 'user', text: 'Antes o projeto era sobre jardinagem e Jardim Vivo.' },
    ],
  });
  assert.strictEqual(unsupportedFinalBriefing.decision, 'execute');
  assert.strictEqual(unsupportedFinalBriefing.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(unsupportedFinalBriefing.productRoute.executionIntent, 'init_project');
  assert.strictEqual(unsupportedFinalBriefing.workingBrief.source.memoryContextSuppressed, true);
  assert.strictEqual(unsupportedFinalBriefing.workingBrief.source.consolidated.includes('Jardim Vivo'), false);
  assert.ok(unsupportedFinalBriefing.workingBrief.product.domain.startsWith('temporary-'));
  assert.strictEqual(unsupportedFinalBriefing.workingBrief.temporaryBlueprintContract.status, 'active');
  assert.strictEqual(unsupportedFinalBriefing.workingBrief.contractEscalation.required, false);

  const conflictingFinalBriefing = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'Briefing completo: criar site final para chocolate artesanal premium e bolsas de couro, sem placeholder.',
  });
  assert.strictEqual(conflictingFinalBriefing.decision, 'execute');
  assert.strictEqual(conflictingFinalBriefing.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(conflictingFinalBriefing.productRoute.executionIntent, 'init_project');
  assert.strictEqual(conflictingFinalBriefing.workingBrief.contractEscalation.required, false);
  assert.strictEqual(conflictingFinalBriefing.workingBrief.contractEscalation.advisory, true);
  assert.strictEqual(conflictingFinalBriefing.workingBrief.contractEscalation.suggestedContract.type, 'suggest_blueprint');
  assert.strictEqual(conflictingFinalBriefing.workingBrief.contractEscalation.suggestedContract.status, 'advisory');

  const activeMemoryCreate = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'Segue com isso usando a memória',
    activeMemory: {
      schemaVersion: 'active-memory-v1',
      ok: true,
      current: {
        message: 'Segue com isso usando a memória',
        continuationIntent: true,
      },
      user: {
        available: true,
        selectedCount: 1,
        contextText: 'Memoria de usuario:\n- Usuario prefere visual premium e direto.',
      },
      project: {
        available: true,
        selectedCount: 1,
        contextText:
          'Memoria de projeto/Cortex:\n- Criar landing page em Next.js e Tailwind para chocolate artesanal premium com paleta creme e cacau.',
      },
      decision: {
        routeContextText:
          'Memoria ativa separada por fonte.\nMensagem atual: Segue com isso usando a memória\nMemoria de projeto/Cortex:\n- Criar landing page em Next.js e Tailwind para chocolate artesanal premium com paleta creme e cacau.',
        briefingContextText:
          'Memoria ativa separada por fonte.\nMensagem atual: Segue com isso usando a memória\nMemoria de usuario:\n- Usuario prefere visual premium.\nMemoria de projeto/Cortex:\n- Criar landing page em Next.js e Tailwind para chocolate artesanal premium com paleta creme e cacau.',
      },
    },
  });
  assert.strictEqual(activeMemoryCreate.decision, 'execute');
  assert.strictEqual(activeMemoryCreate.productRoute.executionIntent, 'init_project');
  assert.strictEqual(activeMemoryCreate.workingBrief.product.domain, 'chocolate');
  assert.strictEqual(activeMemoryCreate.meta.activeMemory.continuationIntent, true);
  assert.strictEqual(activeMemoryCreate.meta.contextFrame.dominantSource, 'active_memory');
  assert.strictEqual(activeMemoryCreate.meta.contextFrame.activeMemory.allowedForBriefing, true);

  const staleChocolateMemory = {
    schemaVersion: 'active-memory-v1',
    ok: true,
    current: {
      message: 'contexto antigo',
      continuationIntent: true,
    },
    user: {
      available: true,
      selectedCount: 1,
      contextText: 'Memoria de usuario: prefere visual premium.',
    },
    project: {
      available: true,
      selectedCount: 1,
      contextText: 'Memoria de projeto: site de chocolate artesanal premium.',
    },
    decision: {
      routeContextText: 'Memoria antiga: criar landing de chocolate artesanal premium.',
      briefingContextText: 'Memoria antiga: Maison Cacao, cacau, bombons, trufas e paleta creme.',
    },
  };

  const currentBriefBeatsStaleMemory = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing completo para criar um site completo de jardinagem.',
      'O site precisa apresentar servicos de paisagismo, loja de produtos, blog educativo, galeria, depoimentos, contato, WhatsApp, formulario de orcamento e CTAs.',
      'A identidade deve ser natural e acolhedora, com plantas, jardins, vasos, verde musgo e conteudo para iniciantes.',
    ].join(' '),
    activeMemory: staleChocolateMemory,
  });
  assert.strictEqual(currentBriefBeatsStaleMemory.decision, 'execute');
  assert.strictEqual(currentBriefBeatsStaleMemory.workingBrief.product.domain, 'gardening');
  assert.strictEqual(currentBriefBeatsStaleMemory.meta.activeMemory.continuationIntent, false);
  assert.strictEqual(currentBriefBeatsStaleMemory.workingBrief.source.consolidated.includes('Maison Cacao'), false);
  assert.strictEqual(currentBriefBeatsStaleMemory.meta.contextFrame.dominantSource, 'current_message');
  assert.strictEqual(currentBriefBeatsStaleMemory.meta.contextFrame.activeMemory.suppressed, true);
  assert.strictEqual(currentBriefBeatsStaleMemory.meta.contextFrame.guard.ok, true);

  const conversationBriefBeatsStaleMemory = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'Quero criar algo novo, seguindo o briefing completo que passei nessa conversa',
    conversationMessages: [
      {
        role: 'user',
        text: [
          'Briefing: site completo de jardinagem com servicos de paisagismo, loja de produtos, blog educativo, galeria, depoimentos e contato.',
          'A home deve ter banner principal, categorias de jardinagem, chamada para orcamento e conteudo sobre plantas internas.',
        ].join(' '),
      },
    ],
    activeMemory: staleChocolateMemory,
  });
  assert.strictEqual(conversationBriefBeatsStaleMemory.decision, 'execute');
  assert.strictEqual(conversationBriefBeatsStaleMemory.workingBrief.product.domain, 'gardening');
  assert.strictEqual(conversationBriefBeatsStaleMemory.meta.activeMemory.continuationIntent, false);
  assert.strictEqual(conversationBriefBeatsStaleMemory.workingBrief.source.consolidated.includes('Maison Cacao'), false);
  assert.strictEqual(conversationBriefBeatsStaleMemory.meta.contextFrame.dominantSource, 'conversation_brief');
  assert.strictEqual(conversationBriefBeatsStaleMemory.meta.contextFrame.activeMemory.suppressed, true);

  const policyGate = createProductPolicyGateService();
  const blockedContextLeak = policyGate.applyProductPolicyGate({
    provider: 'deterministic',
    facts: {
      hasProject: true,
      currentMessage: [
        'Briefing completo para criar um site completo de jardinagem.',
        'O site precisa de hero, serviços, loja, blog, galeria, contato e formulário.',
        'A identidade deve ser natural, verde e acolhedora para iniciantes.',
      ].join(' '),
      sourceMessage: 'Briefing completo para criar um site completo de jardinagem.',
      projectState: 'empty_project',
      executionIntent: 'init_project',
      signals: {
        scaffoldIntent: true,
        enoughForInitialCreate: true,
      },
      contextFrame: {
        schemaVersion: 'orchestration-context-frame-v1',
        current: {
          selfContainedCreateBrief: true,
          referencesConversationBrief: false,
          referencesActiveMemoryStore: false,
        },
        conversation: {
          available: false,
          allowedForBriefing: false,
        },
        activeMemory: {
          available: true,
          allowedForRouting: true,
          allowedForBriefing: true,
          suppressed: false,
          briefingContextText: 'Memoria antiga: Maison Cacao.',
        },
        source: {
          precedence: ['current_user_message', 'active_memory'],
        },
      },
    },
  });
  assert.strictEqual(blockedContextLeak.decision, 'clarify');
  assert.strictEqual(blockedContextLeak.meta.reason, 'context_frame_memory_leak_blocked');
  assert.strictEqual(blockedContextLeak.meta.contextFrame.guard.blocking, true);

  const ambiguousCreate = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'quero criar um site',
  });
  assert.strictEqual(ambiguousCreate.decision, 'execute');
  assert.strictEqual(ambiguousCreate.productRoute.capability, 'create_project');
  assert.strictEqual(ambiguousCreate.productRoute.executionIntent, 'init_project');
  assert.ok(['adaptive_blueprint', 'faber_blueprint'].includes(ambiguousCreate.productRoute.mode));

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

  const existingStructuredCloneRepair = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'lib/mrp.ts', '__tests__/mrp.test.ts'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage:
      'Corrija os testes Jest: ReferenceError structuredClone is not defined em lib/mrp.ts.',
  });
  assert.strictEqual(existingStructuredCloneRepair.decision, 'execute');
  assert.strictEqual(existingStructuredCloneRepair.meta.reason, 'deterministic_edit_intent');
  assert.strictEqual(existingStructuredCloneRepair.productRoute.mode, 'deterministic_patch');

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

  const existingBackgroundColorEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Quero deixar o background do site vermelho',
  });
  assert.strictEqual(existingBackgroundColorEdit.decision, 'execute');
  assert.strictEqual(existingBackgroundColorEdit.meta.reason, 'deterministic_edit_intent');
  assert.strictEqual(existingBackgroundColorEdit.productRoute.mode, 'deterministic_patch');

  const existingHeadingColorEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Troque a cor do H1 para #102a56',
  });
  assert.strictEqual(existingHeadingColorEdit.decision, 'execute');
  assert.strictEqual(existingHeadingColorEdit.meta.reason, 'deterministic_edit_intent');
  assert.strictEqual(existingHeadingColorEdit.productRoute.mode, 'deterministic_patch');

  const existingTypographyEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Troque as tipografias para Playfair Display nos títulos e Cormorant nos textos',
  });
  assert.strictEqual(existingTypographyEdit.decision, 'execute');
  assert.notStrictEqual(existingTypographyEdit.meta.reason, 'deterministic_edit_intent');
  assert.notStrictEqual(existingTypographyEdit.productRoute.mode, 'deterministic_patch');
  assert.ok(['cortex_incremental_edit', 'existing_project_edit'].includes(existingTypographyEdit.productRoute.mode));

  const existingNextFontVisualEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/layout.tsx', 'app/globals.css', 'tailwind.config.ts'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 5,
    }),
    userMessage:
      'Troque a tipografia principal para IBM Plex Sans via next/font/google, use IBM Plex Mono em SKUs e números, ajuste Tailwind e valide build/testes/preview real.',
  });
  assert.strictEqual(existingNextFontVisualEdit.decision, 'execute');
  assert.notStrictEqual(existingNextFontVisualEdit.meta.reason, 'deterministic_edit_intent');
  assert.notStrictEqual(existingNextFontVisualEdit.productRoute.mode, 'deterministic_patch');
  assert.ok(['cortex_incremental_edit', 'existing_project_edit'].includes(existingNextFontVisualEdit.productRoute.mode));

  const existingNextFontVisualEditWithNegatedScope = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/layout.tsx', 'app/globals.css', 'tailwind.config.ts'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 5,
    }),
    userMessage: [
      'Corrija a alteração visual anterior no THE FORGE.',
      'Restaure metadata.title para "Forge MRP" e o H1 lateral para "Control Room".',
      'Troque somente a tipografia: use IBM Plex Sans via next/font/google como fonte principal e IBM Plex Mono somente para números, SKUs e códigos.',
      'Não mude regras de negócio, não reorganize arquivos, não recrie o projeto, não altere arquitetura, não crie .env e não mexa em Prisma.',
      'Aplique no projeto atual e valide build/test/preview real.',
    ].join(' '),
  });
  assert.strictEqual(existingNextFontVisualEditWithNegatedScope.decision, 'execute');
  assert.notStrictEqual(existingNextFontVisualEditWithNegatedScope.productRoute.mode, 'requires_route_confirmation');
  assert.notStrictEqual(existingNextFontVisualEditWithNegatedScope.productRoute.mode, 'deterministic_patch');
  assert.ok(
    ['cortex_incremental_edit', 'existing_project_edit'].includes(
      existingNextFontVisualEditWithNegatedScope.productRoute.mode
    )
  );

  const existingStructuralEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Troque o texto do CTA secundário de Conhecer serviços para Ver planos',
  });
  assert.strictEqual(existingStructuralEdit.decision, 'execute');
  assert.strictEqual(existingStructuralEdit.meta.reason, 'deterministic_edit_intent');
  assert.strictEqual(existingStructuralEdit.productRoute.mode, 'deterministic_patch');

  const existingBackgroundMediaEdit = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Coloque uma imagem com overlay preto no fundo do topo',
  });
  assert.strictEqual(existingBackgroundMediaEdit.decision, 'execute');
  assert.strictEqual(existingBackgroundMediaEdit.meta.reason, 'build_mode_existing_project_edit');
  assert.strictEqual(existingBackgroundMediaEdit.productRoute.mode, 'existing_project_edit');

  const heroVideoOverlayProject = createProjectInfo({
      files: ['index.html', 'style.css', 'script.js'],
      stacks: ['HTML', 'CSS', 'JavaScript'],
      totalFiles: 3,
    });
  const heroVideoOverlayMessage =
    'Precisamos ajustar o hero do topo do body, colocar um vídeo de abelhas voando, sobre ele colocar uma camada branca e mudar o blend para cor';
  const heroVideoOverlayContext = {
    originalUserMessage: 'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA',
    lastScaffoldPrompt: 'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA',
  };
  const heroVideoOverlayConversation = [
    { role: 'user', content: 'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA' },
  ];
  const heroVideoOverlayFacts = service.buildProductFacts({
    projectInfo: heroVideoOverlayProject,
    userMessage: heroVideoOverlayMessage,
    contextHint: heroVideoOverlayContext,
    conversationMessages: heroVideoOverlayConversation,
  });
  assert.strictEqual(heroVideoOverlayFacts.signals.deterministicEdit, false);
  assert.strictEqual(heroVideoOverlayFacts.signals.unsupportedDeterministicVisualPatch, true);
  const existingHeroVideoOverlayEdit = await service.resolveProductRoute({
    projectInfo: heroVideoOverlayProject,
    userMessage: heroVideoOverlayMessage,
    contextHint: {
      ...heroVideoOverlayContext,
    },
    conversationMessages: heroVideoOverlayConversation,
  });
  assert.strictEqual(existingHeroVideoOverlayEdit.decision, 'execute');
  assert.strictEqual(existingHeroVideoOverlayEdit.meta.reason, 'build_mode_existing_project_edit');
  assert.strictEqual(existingHeroVideoOverlayEdit.productRoute.mode, 'existing_project_edit');

  const existingHeroEditWithStaleRebuildContext = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['index.html', 'style.css', 'script.js', 'a-escola.html'],
      stacks: ['HTML', 'CSS', 'JavaScript'],
      totalFiles: 4,
    }),
    userMessage: 'Precisamos ajustar o hero do topo do body, colocar um vídeo de abelhas voando e mudar o blend da camada branca',
    contextHint: {
      lastScaffoldPrompt: 'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA estático para Tremn.',
    },
    conversationMessages: [
      {
        role: 'user',
        text: 'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA estático para Tremn.',
      },
    ],
  });
  assert.strictEqual(existingHeroEditWithStaleRebuildContext.decision, 'execute');
  assert.strictEqual(existingHeroEditWithStaleRebuildContext.productRoute.capability, 'edit_project');
  assert.strictEqual(existingHeroEditWithStaleRebuildContext.productRoute.executionIntent, 'edit_project');
  assert.strictEqual(existingHeroEditWithStaleRebuildContext.productRoute.mode, 'existing_project_edit');
  assert.strictEqual(existingHeroEditWithStaleRebuildContext.meta.routeScore.top.capability, 'edit_project');
  assert.strictEqual(existingHeroEditWithStaleRebuildContext.executionMessage.includes('Recrie do zero'), false);
  assert.strictEqual(existingHeroEditWithStaleRebuildContext.workingBrief.intent.action, 'edit_project');
  assert.strictEqual(existingHeroEditWithStaleRebuildContext.workingBrief.source.consolidated.includes('Recrie do zero'), false);

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

  const existingCreateConflict = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Quero criar um novo app e melhorar o hero atual',
  });
  assert.strictEqual(existingCreateConflict.decision, 'clarify');
  assert.strictEqual(existingCreateConflict.meta.reason, 'route_score_conflict');
  assert.strictEqual(existingCreateConflict.productRoute.mode, 'requires_route_confirmation');
  assert.strictEqual(existingCreateConflict.meta.routeScore.requiresClarification, true);
  assert.strictEqual(existingCreateConflict.meta.routeScore.resolution.status, 'conflict');
  assert.deepStrictEqual(existingCreateConflict.meta.routeScore.resolution.candidates, ['create_project', 'edit_project']);

  const forgeDiagnosticRepair = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      rootPath: '/workspace/The Forge',
      files: [
        'package.json',
        'app/page.tsx',
        'src/store/mrp_store.ts',
        'src/services/use-cases/mrp_service.ts',
        'src/domain/mrp.ts',
        'tests/mrp.test.ts',
      ],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 21,
    }),
    userMessage: [
      'No projeto ativo THE FORGE, repare o erro real atual como agente de desenvolvimento, nao como blueprint.',
      'npm run build falha em app/page.tsx:45: Property snapshot does not exist on type ForgeMrpState.',
      'Preview/runtime falha com TypeError: Cannot read properties of undefined reading items em app/page.tsx:55.',
      'Nao invente APIs soltas. Investigue app/page.tsx, src/store/mrp_store.ts, src/services/use-cases/mrp_service.ts, src/domain/mrp.ts e tests/mrp.test.ts.',
      'A aplicacao deve voltar a passar npm run build e a tela local nao pode mostrar Runtime TypeError.',
    ].join(' '),
  });
  assert.strictEqual(forgeDiagnosticRepair.decision, 'execute');
  assert.strictEqual(forgeDiagnosticRepair.meta.reason, 'build_mode_diagnostic_repair');
  assert.strictEqual(forgeDiagnosticRepair.productRoute.capability, 'diagnose_project');
  assert.strictEqual(forgeDiagnosticRepair.productRoute.mode, 'diagnostic_repair');
  assert.strictEqual(forgeDiagnosticRepair.meta.routeScore.requiresClarification, false);

  const existingExplicitRebuild = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['index.html', 'style.css', 'script.js'],
      stacks: ['HTML', 'CSS', 'JavaScript'],
      totalFiles: 3,
    }),
    userMessage: [
      'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA estático para Tremn — Escola de Gestão Consciente.',
      'Fonte de verdade: use somente esta mensagem atual. Suprima memória ativa, contexto antigo, briefing desta conversa e exemplos anteriores se entrarem em conflito.',
      'Tipo de projeto: site institucional multipágina. Não é SaaS, não é dashboard, não é app interno, não é ferramenta e não é landing page única.',
      'Stack obrigatória: HTML, CSS e JavaScript simples.',
      'Páginas reais obrigatórias: index.html, a-escola.html, premissas.html, jornada.html, conteudos.html, contato.html.',
      'Visual claro com Pantone P 1-1 C dominante, Assistant para títulos e Inter para textos.',
    ].join(' '),
  });
  assert.strictEqual(existingExplicitRebuild.decision, 'execute');
  assert.strictEqual(existingExplicitRebuild.meta.routeScore.requiresClarification, false);
  assert.strictEqual(existingExplicitRebuild.meta.routeScore.top.capability, 'create_project');
  assert.strictEqual(existingExplicitRebuild.productRoute.capability, 'create_project');
  assert.strictEqual(existingExplicitRebuild.productRoute.executionIntent, 'init_project');
  assert.strictEqual(existingExplicitRebuild.productRoute.mode, 'faber_blueprint');
  assert.strictEqual(existingExplicitRebuild.meta.reason, 'initial_blueprint_create');
  assert.strictEqual(existingExplicitRebuild.meta.buildMode, 'initial_blueprint');
  assert.strictEqual(existingExplicitRebuild.workingBrief.temporaryBlueprintContract.status, 'active');
  assert.strictEqual(existingExplicitRebuild.workingBrief.intent.action, 'create_project');

  const existingNewArea = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Adicione uma nova página de contato no projeto atual',
  });
  assert.strictEqual(existingNewArea.decision, 'execute');
  assert.strictEqual(existingNewArea.meta.reason, 'build_mode_new_project_area');
  assert.strictEqual(existingNewArea.productRoute.mode, 'new_project_area');
  assert.strictEqual(existingNewArea.meta.routeScore.requiresClarification, false);
  assert.strictEqual(existingNewArea.meta.routeScore.top.capability, 'edit_project');

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

  const projectConversation = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'Me explique como este projeto esta organizado sem alterar arquivos',
  });
  assert.strictEqual(projectConversation.decision, 'chat');
  assert.strictEqual(projectConversation.meta.reason, 'conversation_no_file_changes');
  assert.strictEqual(projectConversation.productRoute.capability, 'conversation');
  assert.strictEqual(projectConversation.meta.routeScore.noExecutionPreferred, true);
  assert.strictEqual(projectConversation.meta.routeScore.top.capability, 'conversation');

  const readOnlyDiagnosticConversation = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage:
      'Diagnostique rapidamente o projeto atual sem alterar arquivos. Apenas confirme se o preview local está pronto e não escreva arquivos.',
  });
  assert.strictEqual(readOnlyDiagnosticConversation.decision, 'chat');
  assert.strictEqual(readOnlyDiagnosticConversation.meta.reason, 'conversation_no_file_changes');
  assert.strictEqual(readOnlyDiagnosticConversation.productRoute.capability, 'conversation');
  assert.strictEqual(readOnlyDiagnosticConversation.meta.routeScore.noExecutionPreferred, true);
  assert.strictEqual(readOnlyDiagnosticConversation.meta.routeScore.top.capability, 'conversation');

  const opinionConversation = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 3,
    }),
    userMessage: 'O que voce acha de mudar o hero para ficar mais premium?',
  });
  assert.strictEqual(opinionConversation.decision, 'chat');
  assert.strictEqual(opinionConversation.meta.reason, 'project_conversation_no_execution');
  assert.strictEqual(opinionConversation.productRoute.capability, 'conversation');
  assert.strictEqual(opinionConversation.meta.routeScore.noExecutionPreferred, true);
  assert.strictEqual(opinionConversation.meta.routeScore.top.capability, 'conversation');

  let noExecutionAiCalls = 0;
  const noExecutionAiService = createService({
    requestAiProductRouteDecision: async () => {
      noExecutionAiCalls += 1;
      return {
        decision: 'execute',
        capability: 'edit_project',
        response: 'Vou editar.',
        executionMessage: 'editar hero',
        confidence: 0.93,
      };
    },
  });
  const noExecutionAi = await noExecutionAiService.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      totalFiles: 3,
    }),
    userMessage: 'Me explique o hero atual sem mexer em nada',
  });
  assert.strictEqual(noExecutionAiCalls, 0);
  assert.strictEqual(noExecutionAi.decision, 'chat');
  assert.strictEqual(noExecutionAi.meta.reason, 'conversation_no_file_changes');
  assert.strictEqual(noExecutionAi.meta.routeScore.noExecutionPreferred, true);

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

  const visualReview = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      totalFiles: 3,
    }),
    userMessage: 'Estou anexando screenshots para você fazer a validação visual e comparar com o briefing.',
    attachments: [{ name: 'Screenshot 2026-05-22.png', type: 'image/png' }],
  });
  assert.strictEqual(visualReview.decision, 'chat');
  assert.strictEqual(visualReview.meta.reason, 'build_mode_visual_review');
  assert.strictEqual(visualReview.productRoute.capability, 'diagnose_project');
  assert.strictEqual(visualReview.productRoute.mode, 'visual_review');
  assert.strictEqual(visualReview.meta.noFileChanges, true);

  const visualCorrectionWithScreenshot = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['index.html', 'style.css', 'script.js'],
      stacks: ['HTML', 'CSS', 'JavaScript'],
      totalFiles: 3,
    }),
    userMessage: 'na segunda sessão do body o degradê do fundo precisa estar full width, está limitado como pode ver no anexo',
    attachments: [{ name: 'Screenshot 2026-05-29.png', type: 'image/png' }],
  });
  assert.strictEqual(visualCorrectionWithScreenshot.decision, 'execute');
  assert.strictEqual(visualCorrectionWithScreenshot.productRoute.capability, 'edit_project');
  assert.strictEqual(visualCorrectionWithScreenshot.productRoute.executionIntent, 'edit_project');
  assert.notStrictEqual(visualCorrectionWithScreenshot.productRoute.mode, 'visual_review');

  const semantic = await service.resolveProductRoute({
    projectInfo: createProjectInfo({ files: ['README.md'], totalFiles: 1 }),
    userMessage: 'qual caminho de produto você recomenda?',
  });
  assert.strictEqual(semantic.delegateToPersona, true);
  assert.strictEqual(semantic.meta.reason, 'requires_persona_semantics');

  const aiRouterFailureService = createService({
    requestAiProductRouteDecision: async () => {
      throw new Error('OpenAI HTTP 503: upstream overloaded');
    },
  });
  const aiRouterFailure = await aiRouterFailureService.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'qual caminho de produto você recomenda?',
  });
  assert.strictEqual(aiRouterFailure.delegateToPersona, true);
  assert.strictEqual(aiRouterFailure.meta.aiRouterReason, 'ai_product_route_provider_unavailable');
  assert.strictEqual(aiRouterFailure.meta.providerFailure.code, 'openai_server_error');
  assert.strictEqual(aiRouterFailure.meta.providerFailure.retryable, true);

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
  assert.strictEqual(aiRouterCalls, 1);
  assert.strictEqual(aiEdit.decision, 'execute');
  assert.strictEqual(aiEdit.meta.reason, 'ai_product_edit_accepted');
  assert.strictEqual(aiEdit.executionMessage, 'ajustar a seção hero do projeto');

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
  assert.strictEqual(guardedMissingProject.meta.reason, 'policy_gate_missing_project');

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
  assert.strictEqual(blueprintOverride.meta.buildMode, 'adaptive_blueprint');
  assert.strictEqual(blueprintOverride.meta.routeModeContract.buildMode, 'adaptive_blueprint');

  console.log('product-orchestrator-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
