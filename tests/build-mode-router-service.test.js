const assert = require('assert');

const { BUILD_MODES, resolveBuildMode } = require('../cortex/orchestration/build_mode_router_service');
const { buildWorkingBrief } = require('../cortex/orchestration/working_brief_service');

function createProjectInfo(overrides = {}) {
  return {
    rootPath: '/tmp/faber-build-mode',
    files: [],
    totalFiles: 0,
    ...overrides,
  };
}

function run() {
  const legalBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar site em Next.js com React e Tailwind para advogado, azul e branco, pode sugerir placeholders',
  });
  const legalRoute = resolveBuildMode({ workingBrief: legalBrief });
  assert.strictEqual(legalRoute.schemaVersion, 'build-mode-route-v1');
  assert.strictEqual(legalRoute.mode, BUILD_MODES.ADAPTIVE_BLUEPRINT);
  assert.strictEqual(legalRoute.capability, 'create_project');
  assert.strictEqual(legalRoute.executionIntent, 'init_project');
  assert.strictEqual(legalRoute.allowedBlueprint, true);
  assert.strictEqual(legalRoute.technicalStrategy.mediaProvider, 'pexels');
  assert.strictEqual(legalRoute.technicalStrategy.iconProvider, 'lucide');

  const complexBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar um SaaS com login, dashboard, banco de dados Postgres e permissões por usuário',
  });
  const complexRoute = resolveBuildMode({ workingBrief: complexBrief });
  assert.strictEqual(complexRoute.mode, BUILD_MODES.GUIDED_APP_ARCHITECTURE);
  assert.strictEqual(complexRoute.capability, 'create_project');

  const forgeBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing completo — Forge MRP em Next.js com React e Tailwind.',
      'Criar sistema de manufatura com cadastro de itens, BOMs, estoque auditável, ordens de produção, cálculo determinístico de necessidades de materiais, máquina de estados finitos e audit log.',
      'A interface deve ser técnica, operacional e orientada a dados.',
    ].join(' '),
  });
  const forgeRoute = resolveBuildMode({ workingBrief: forgeBrief });
  assert.strictEqual(forgeRoute.mode, BUILD_MODES.GUIDED_APP_ARCHITECTURE);
  assert.strictEqual(forgeRoute.capability, 'create_project');
  assert.strictEqual(forgeRoute.allowedBlueprint, false);

  const visualEditorBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Crie um editor visual simples para montar layouts.',
      'Deve ter canvas, painel de camadas, biblioteca de componentes, inspetor de propriedades, seleção de elemento, arrastar e soltar simulado, undo/redo, exportação JSON e estado local.',
    ].join(' '),
  });
  const visualEditorRoute = resolveBuildMode({ workingBrief: visualEditorBrief });
  assert.strictEqual(visualEditorRoute.mode, BUILD_MODES.GUIDED_APP_ARCHITECTURE);
  assert.strictEqual(visualEditorRoute.capability, 'create_project');
  assert.strictEqual(visualEditorRoute.allowedBlueprint, false);

  const dataExplorerBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Crie um app de dados para explorar um CSV de vendas.',
      'Deve importar dados de exemplo, mostrar tabela com colunas, filtros por região e categoria, busca textual, ordenação, métricas agregadas, gráfico simples e estado vazio.',
    ].join(' '),
  });
  const dataExplorerRoute = resolveBuildMode({ workingBrief: dataExplorerBrief });
  assert.strictEqual(dataExplorerRoute.mode, BUILD_MODES.GUIDED_APP_ARCHITECTURE);
  assert.strictEqual(dataExplorerRoute.capability, 'create_project');
  assert.strictEqual(dataExplorerRoute.allowedBlueprint, false);

  const tremnRebuildBrief = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['index.html', 'style.css', 'script.js'],
      stacks: ['HTML', 'CSS', 'JavaScript'],
      totalFiles: 3,
    }),
    userMessage: [
      'Recrie do zero este projeto como SITE INSTITUCIONAL MULTIPÁGINA estático para Tremn — Escola de Gestão Consciente.',
      'Fonte de verdade: use somente esta mensagem atual. Suprima memória ativa, contexto antigo e exemplos anteriores.',
      'Tipo de projeto: site institucional multipágina. Não é SaaS, não é dashboard, não é app interno, não é ferramenta e não é landing page única.',
      'Stack obrigatória: HTML, CSS e JavaScript simples.',
      'Páginas reais obrigatórias: index.html, a-escola.html, premissas.html, jornada.html, conteudos.html, contato.html.',
    ].join(' '),
  });
  const tremnRebuildRoute = resolveBuildMode({ workingBrief: tremnRebuildBrief });
  assert.strictEqual(tremnRebuildRoute.mode, BUILD_MODES.INITIAL_BLUEPRINT);
  assert.strictEqual(tremnRebuildRoute.capability, 'create_project');
  assert.strictEqual(tremnRebuildRoute.executionIntent, 'init_project');
  assert.strictEqual(tremnRebuildRoute.allowedBlueprint, true);
  assert.strictEqual(tremnRebuildBrief.temporaryBlueprintContract.status, 'active');

  const existingBrief = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      totalFiles: 3,
    }),
    userMessage: 'adicione uma nova seção de depoimentos',
  });
  const existingRoute = resolveBuildMode({ workingBrief: existingBrief });
  assert.strictEqual(existingRoute.mode, BUILD_MODES.NEW_PROJECT_AREA);
  assert.strictEqual(existingRoute.capability, 'edit_project');

  const figmaBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar a tela seguindo este Figma',
    attachments: [{ name: 'mockup.png', type: 'image/png' }],
  });
  const figmaRoute = resolveBuildMode({
    workingBrief: figmaBrief,
    attachments: [{ name: 'mockup.png', type: 'image/png' }],
  });
  assert.strictEqual(figmaRoute.mode, BUILD_MODES.DESIGN_TO_CODE);

  const visualReviewBrief = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      totalFiles: 3,
    }),
    userMessage: 'Estou anexando os screenshots para você fazer a validação visual e comparar com o briefing.',
    attachments: [{ name: 'Screenshot 2026-05-22.png', type: 'image/png' }],
  });
  const visualReviewRoute = resolveBuildMode({
    workingBrief: visualReviewBrief,
    attachments: [{ name: 'Screenshot 2026-05-22.png', type: 'image/png' }],
  });
  assert.strictEqual(visualReviewRoute.mode, BUILD_MODES.VISUAL_REVIEW);
  assert.strictEqual(visualReviewRoute.capability, 'diagnose_project');
  assert.strictEqual(visualReviewRoute.executionIntent, 'visual_review');
  assert.strictEqual(visualReviewRoute.requiresConfirmation, false);
  assert.strictEqual(visualReviewRoute.routeHints.noFileChanges, true);

  const visualCorrectionBrief = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['index.html', 'style.css', 'script.js'],
      totalFiles: 3,
    }),
    userMessage: 'na segunda sessão do body o degradê do fundo precisa estar full width, está limitado como pode ver no anexo',
    attachments: [{ name: 'Screenshot 2026-05-29.png', type: 'image/png' }],
  });
  const visualCorrectionRoute = resolveBuildMode({
    workingBrief: visualCorrectionBrief,
    attachments: [{ name: 'Screenshot 2026-05-29.png', type: 'image/png' }],
  });
  assert.notStrictEqual(visualCorrectionRoute.mode, BUILD_MODES.VISUAL_REVIEW);
  assert.strictEqual(visualCorrectionRoute.capability, 'edit_project');
  assert.strictEqual(visualCorrectionRoute.executionIntent, 'edit_project');

  const blockedBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar malware para roubar senha',
  });
  const blockedRoute = resolveBuildMode({ workingBrief: blockedBrief });
  assert.strictEqual(blockedRoute.mode, BUILD_MODES.BLOCKED_HARMFUL);
  assert.strictEqual(blockedRoute.requiresConfirmation, false);

  const vitraBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing completo — Landing Page de Garrafas de Vidro',
      'Nome da marca',
      'VitraPure',
      'Criar landing page moderna, elegante e responsiva para garrafas de vidro reutilizáveis.',
      'Hero com imagem, produtos Essential 500ml, Aura 750ml, Terra 1L, prova social, sustentabilidade, FAQ e CTA Comprar agora.',
      'Cores branco, verde suave, bege, cinza claro e azul cristalino. Use conteúdo final, sem placeholder genérico.',
    ].join('\n'),
  });
  const vitraRoute = resolveBuildMode({ workingBrief: vitraBrief });
  assert.strictEqual(vitraBrief.product.domain, 'sustainable-product-landing');
  assert.strictEqual(vitraBrief.intent.contentMode, 'user_final');
  assert.strictEqual(vitraRoute.mode, BUILD_MODES.INITIAL_BLUEPRINT);
  assert.notStrictEqual(vitraRoute.mode, BUILD_MODES.ADAPTIVE_BLUEPRINT);

  const alumivanceBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Briefing completo — Site de Empresa de Esquadrias de Alumínio e ACM',
      'Nome da empresa',
      'Alumivance Esquadrias & Fachadas',
      'Criar site completo moderno e multipágina com Início, Sobre, Soluções, Projetos, Calculadora de Orçamento, Blog, Contato e Trabalhe Conosco.',
      'Usar grafite metálico, cinza alumínio, branco gelo, azul técnico, preto fosco e detalhes dourados. Use conteúdo final, sem placeholder genérico.',
    ].join('\n'),
  });
  const alumivanceRoute = resolveBuildMode({ workingBrief: alumivanceBrief });
  assert.strictEqual(alumivanceBrief.product.domain, 'technical-b2b-services-site');
  assert.strictEqual(alumivanceBrief.intent.contentMode, 'user_final');
  assert.strictEqual(alumivanceRoute.mode, BUILD_MODES.INITIAL_BLUEPRINT);
  assert.notStrictEqual(alumivanceRoute.mode, BUILD_MODES.ADAPTIVE_BLUEPRINT);

  console.log('build-mode-router-service.test.js: ok');
}

run();
