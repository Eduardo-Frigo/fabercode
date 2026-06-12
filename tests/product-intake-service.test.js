const assert = require('assert');

const {
  PRODUCT_INTAKE_SCHEMA_VERSION,
  buildProductIntake,
  normalizeIntakeText,
} = require('../cortex/orchestration/product_intake_service');

function projectInfo(overrides = {}) {
  return {
    rootPath: '/tmp/faber-intake',
    files: [],
    totalFiles: 0,
    ...overrides,
  };
}

function run() {
  assert.strictEqual(normalizeIntakeText('next js emultiplas páginas'), 'nextjs multiplas paginas');

  const simpleNext = buildProductIntake({
    projectInfo: projectInfo({ files: ['.faber/project.json'], totalFiles: 1 }),
    userMessage: 'Oi, gera um site pra mim em next.js, com múltiplas páginas e no topo do body um hero com video no fundo',
  });
  assert.strictEqual(simpleNext.schemaVersion, PRODUCT_INTAKE_SCHEMA_VERSION);
  assert.strictEqual(simpleNext.project.projectState, 'metadata_only_project');
  assert.strictEqual(simpleNext.canonical.action, 'create_project');
  assert.strictEqual(simpleNext.canonical.executionIntent, 'init_project');
  assert.strictEqual(simpleNext.signals.scaffoldIntent, true);
  assert.strictEqual(simpleNext.signals.enoughForInitialCreate, true);

  const stackOnlyAnswer = buildProductIntake({
    projectInfo: projectInfo({ files: ['.faber/project.json'], totalFiles: 1 }),
    userMessage: 'Quero criar em next.js',
  });
  assert.strictEqual(stackOnlyAnswer.canonical.action, 'create_project');
  assert.strictEqual(stackOnlyAnswer.canonical.executionIntent, 'init_project');
  assert.strictEqual(stackOnlyAnswer.signals.knownProjectStack, true);

  const pendingBriefing = buildProductIntake({
    projectInfo: projectInfo({ files: ['.faber/project.json'], totalFiles: 1 }),
    userMessage: 'Vamos criar uma aplicação em next.js completa, vou passar o briefing completo na sequência',
  });
  assert.strictEqual(pendingBriefing.canonical.action, 'conversation');
  assert.strictEqual(pendingBriefing.canonical.executionIntent, 'conversation');
  assert.strictEqual(pendingBriefing.signals.pendingBriefing, true);
  assert.strictEqual(pendingBriefing.signals.scaffoldIntent, false);

  const shortComplexApp = buildProductIntake({
    projectInfo: projectInfo({ files: ['.faber/project.json'], totalFiles: 1 }),
    userMessage: 'Quero criar um MRP em Next.js para manufatura',
  });
  assert.strictEqual(shortComplexApp.canonical.action, 'conversation');
  assert.strictEqual(shortComplexApp.canonical.executionIntent, 'conversation');
  assert.strictEqual(shortComplexApp.signals.complexApplication, true);
  assert.strictEqual(shortComplexApp.signals.requiresComplexBriefing, true);
  assert.strictEqual(shortComplexApp.signals.scaffoldIntent, false);

  const complexAppWithAutonomy = buildProductIntake({
    projectInfo: projectInfo({ files: ['.faber/project.json'], totalFiles: 1 }),
    userMessage: [
      'Crie um MRP em Next.js com React e Tailwind.',
      'Pode usar arquitetura livre/MCP e assumir decisões técnicas.',
      'Preciso de BOM, estoque, ordens de produção, cálculo determinístico de necessidades, audit log e testes unitários.',
    ].join(' '),
  });
  assert.strictEqual(complexAppWithAutonomy.canonical.action, 'create_project');
  assert.strictEqual(complexAppWithAutonomy.canonical.executionIntent, 'init_project');
  assert.strictEqual(complexAppWithAutonomy.signals.complexApplication, true);
  assert.strictEqual(complexAppWithAutonomy.signals.mcpFreedomAllowed, true);
  assert.strictEqual(complexAppWithAutonomy.signals.guidedArchitecturePreferred, true);
  assert.strictEqual(complexAppWithAutonomy.signals.scaffoldIntent, true);

  const complexAppWithFullBrief = buildProductIntake({
    projectInfo: projectInfo({ files: ['.faber/project.json'], totalFiles: 1 }),
    userMessage: [
      'Segue o briefing completo: criar Forge MRP em Next.js com React e Tailwind.',
      'Escopo MVP com módulos de itens, BOM, estoque auditável, ordens de produção e dashboard operacional.',
      'Modelo de dados com entidades Item, BillOfMaterial, StockLedgerEntry e ProductionOrder.',
      'Regras de negócio: cálculo determinístico de necessidades, máquina de estados para ordens e audit log imutável.',
      'Telas, rotas, formulários, tabelas e testes unitários para validar os fluxos principais.',
    ].join(' '),
  });
  assert.strictEqual(complexAppWithFullBrief.canonical.action, 'create_project');
  assert.strictEqual(complexAppWithFullBrief.canonical.executionIntent, 'init_project');
  assert.strictEqual(complexAppWithFullBrief.signals.complexApplication, true);
  assert.strictEqual(complexAppWithFullBrief.signals.complexBriefSufficient, true);
  assert.strictEqual(complexAppWithFullBrief.signals.requiresComplexBriefing, false);
  assert.strictEqual(complexAppWithFullBrief.signals.guidedArchitecturePreferred, true);

  const visualEditorBrief = buildProductIntake({
    projectInfo: projectInfo(),
    userMessage: [
      'Crie um editor visual simples para montar layouts.',
      'Deve ter canvas, painel de camadas, biblioteca de componentes, inspetor de propriedades, seleção de elemento, arrastar e soltar simulado, undo/redo, exportação JSON e estado local.',
    ].join(' '),
  });
  assert.strictEqual(visualEditorBrief.canonical.action, 'create_project');
  assert.strictEqual(visualEditorBrief.canonical.executionIntent, 'init_project');
  assert.strictEqual(visualEditorBrief.signals.complexApplication, true);
  assert.strictEqual(visualEditorBrief.signals.complexBriefSufficient, true);
  assert.strictEqual(visualEditorBrief.signals.guidedArchitecturePreferred, true);

  const dataExplorerBrief = buildProductIntake({
    projectInfo: projectInfo(),
    userMessage: [
      'Crie um app de dados para explorar um CSV de vendas.',
      'Deve importar dados de exemplo, mostrar tabela com colunas, filtros por região e categoria, busca textual, ordenação, métricas agregadas, gráfico simples e estado vazio.',
    ].join(' '),
  });
  assert.strictEqual(dataExplorerBrief.canonical.action, 'create_project');
  assert.strictEqual(dataExplorerBrief.canonical.executionIntent, 'init_project');
  assert.strictEqual(dataExplorerBrief.signals.complexApplication, true);
  assert.strictEqual(dataExplorerBrief.signals.complexBriefSufficient, true);
  assert.strictEqual(dataExplorerBrief.signals.guidedArchitecturePreferred, true);

  const detailedMiniCrmBrief = buildProductIntake({
    projectInfo: projectInfo(),
    userMessage: [
      'Crie uma ferramenta SaaS simples de mini CRM.',
      'Deve permitir cadastrar leads com nome, empresa, e-mail, estágio, valor potencial e próxima ação.',
      'Deve listar leads, filtrar por estágio, mostrar resumo do pipeline e permitir editar/remover leads localmente.',
    ].join(' '),
  });
  assert.strictEqual(detailedMiniCrmBrief.canonical.action, 'create_project');
  assert.strictEqual(detailedMiniCrmBrief.canonical.executionIntent, 'init_project');
  assert.strictEqual(detailedMiniCrmBrief.signals.complexApplication, true);
  assert.strictEqual(detailedMiniCrmBrief.signals.complexBriefSufficient, true);
  assert.strictEqual(detailedMiniCrmBrief.signals.guidedArchitecturePreferred, true);

  const previewDiagnosticQuestion = buildProductIntake({
    projectInfo: projectInfo({ files: ['package.json', 'app/page.tsx'], totalFiles: 2 }),
    userMessage: 'O que é necessário corrigir para a visualização funcionar?',
  });
  assert.strictEqual(previewDiagnosticQuestion.canonical.action, 'diagnostic_repair');
  assert.strictEqual(previewDiagnosticQuestion.canonical.executionIntent, 'diagnose_project');
  assert.strictEqual(previewDiagnosticQuestion.signals.diagnosticIntent, true);

  const typoInstitutional = buildProductIntake({
    projectInfo: projectInfo(),
    userMessage: 'oi, quero criar um site institucional d emultiplas páginas, poderia me ajudar?',
  });
  assert.strictEqual(typoInstitutional.canonical.action, 'create_project');
  assert.strictEqual(typoInstitutional.canonical.executionIntent, 'init_project');
  assert.strictEqual(typoInstitutional.signals.siteOrAppSurface, true);

  const conversationalBuilder = buildProductIntake({
    projectInfo: projectInfo(),
    userMessage: 'me ajuda a montar uma home bonita com hero, menu, formulário e mobile bom',
  });
  assert.strictEqual(conversationalBuilder.canonical.action, 'create_project');
  assert.strictEqual(conversationalBuilder.canonical.executionIntent, 'init_project');

  const existingEdit = buildProductIntake({
    projectInfo: projectInfo({ files: ['app/page.tsx', 'app/globals.css'], totalFiles: 2 }),
    userMessage: 'troque a cor do botão principal e ajuste o texto do CTA',
  });
  assert.strictEqual(existingEdit.canonical.action, 'edit_project');
  assert.strictEqual(existingEdit.canonical.executionIntent, 'edit_project');

  const existingHeroEditWithStaleContext = buildProductIntake({
    projectInfo: projectInfo({ files: ['index.html', 'style.css', 'script.js'], totalFiles: 3 }),
    userMessage: 'Precisamos ajustar o hero do topo do body, colocar um vídeo de abelhas voando e mudar o blend da camada branca',
    contextText: 'Recrie do zero este projeto como site institucional multipágina em HTML, CSS e JavaScript.',
  });
  assert.strictEqual(existingHeroEditWithStaleContext.canonical.action, 'edit_project');
  assert.strictEqual(existingHeroEditWithStaleContext.canonical.executionIntent, 'edit_project');
  assert.strictEqual(existingHeroEditWithStaleContext.signals.scaffoldIntent, false);
  assert.strictEqual(existingHeroEditWithStaleContext.signals.currentEditOverridesContextScaffold, true);

  const visualEditWithNegatedCreateTerms = buildProductIntake({
    projectInfo: projectInfo({ files: ['package.json', 'app/page.tsx', 'app/layout.tsx', 'app/globals.css'], totalFiles: 4 }),
    userMessage: [
      'Corrija a alteração visual anterior no THE FORGE.',
      'Restaure metadata.title para "Forge MRP" e o H1 lateral para "Control Room".',
      'Troque somente a tipografia para IBM Plex Sans via next/font/google e IBM Plex Mono em números, SKUs e códigos.',
      'Não mude regras de negócio, não reorganize arquivos, não recrie o projeto, não altere arquitetura, não crie .env e não mexa em Prisma.',
      'Aplique no projeto atual e valide build/test/preview real.',
    ].join(' '),
  });
  assert.strictEqual(visualEditWithNegatedCreateTerms.canonical.action, 'edit_project');
  assert.strictEqual(visualEditWithNegatedCreateTerms.canonical.executionIntent, 'edit_project');
  assert.strictEqual(visualEditWithNegatedCreateTerms.signals.scaffoldIntent, false);
  assert.strictEqual(visualEditWithNegatedCreateTerms.signals.explicitRebuild, false);
  assert.strictEqual(visualEditWithNegatedCreateTerms.signals.currentEditOverridesContextScaffold, true);

  const forgeRepairWithValidationCommands = buildProductIntake({
    projectInfo: projectInfo({ files: ['package.json', 'app/page.tsx', 'src/store/mrp_store.ts', 'tests/mrp.test.ts'], totalFiles: 21 }),
    userMessage: [
      'No projeto ativo THE FORGE, repare o erro real atual como agente de desenvolvimento, nao como blueprint.',
      'npm run build falha em app/page.tsx:45: Property snapshot does not exist on type ForgeMrpState.',
      'Preview/runtime falha com TypeError: Cannot read properties of undefined reading items em app/page.tsx:55.',
      'Rode npm run build, npm test e Playwright depois da correcao.',
    ].join(' '),
  });
  assert.strictEqual(forgeRepairWithValidationCommands.canonical.action, 'diagnostic_repair');
  assert.strictEqual(forgeRepairWithValidationCommands.canonical.executionIntent, 'diagnose_project');
  assert.strictEqual(forgeRepairWithValidationCommands.signals.toolIntent, true);
  assert.strictEqual(forgeRepairWithValidationCommands.signals.repairDiagnosticIntent, true);

  const existingRebuild = buildProductIntake({
    projectInfo: projectInfo({ files: ['index.html', 'style.css', 'script.js'], totalFiles: 3 }),
    userMessage: 'Recrie do zero este projeto como site institucional multipágina em HTML, CSS e JavaScript',
  });
  assert.strictEqual(existingRebuild.canonical.action, 'create_project');
  assert.strictEqual(existingRebuild.canonical.executionIntent, 'init_project');
  assert.strictEqual(existingRebuild.signals.explicitRebuild, true);
  assert.strictEqual(existingRebuild.signals.scaffoldIntent, true);

  const visualReview = buildProductIntake({
    projectInfo: projectInfo({ files: ['index.html', 'style.css'], totalFiles: 2 }),
    userMessage: 'valide visualmente esses prints e rode smoke visual com screenshot',
  });
  assert.strictEqual(visualReview.canonical.action, 'visual_review');
  assert.strictEqual(visualReview.canonical.executionIntent, 'visual_review');

  const visualCorrectionWithAttachment = buildProductIntake({
    projectInfo: projectInfo({ files: ['index.html', 'style.css'], totalFiles: 2 }),
    userMessage: 'na segunda sessão do body o degradê do fundo precisa estar full width, está limitado como pode ver no anexo',
  });
  assert.strictEqual(visualCorrectionWithAttachment.canonical.action, 'edit_project');
  assert.strictEqual(visualCorrectionWithAttachment.canonical.executionIntent, 'edit_project');
  assert.strictEqual(visualCorrectionWithAttachment.signals.visualReviewIntent, false);

  const explicitClassPatchAfterVisualDiagnostic = buildProductIntake({
    projectInfo: projectInfo({ files: ['package.json', 'app/page.tsx', 'app/globals.css'], totalFiles: 3 }),
    userMessage: [
      'No projeto ativo THE FORGE, faça apenas uma edição pontual em app/page.tsx.',
      'Não use blueprint nem recrie arquivos.',
      'Troque classes Tailwind existentes para corrigir mobile.',
      'No wrapper principal use w-full max-w-full min-w-0 e ajuste o header da tabela.',
    ].join(' '),
    contextText: 'Falha anterior em diagnóstico de preview e screenshot mobile.',
  });
  assert.strictEqual(explicitClassPatchAfterVisualDiagnostic.canonical.action, 'edit_project');
  assert.strictEqual(explicitClassPatchAfterVisualDiagnostic.canonical.executionIntent, 'edit_project');
  assert.strictEqual(explicitClassPatchAfterVisualDiagnostic.signals.diagnosticIntent, false);
  assert.strictEqual(explicitClassPatchAfterVisualDiagnostic.signals.explicitFilePatchIntent, true);

  const longCreateBrief = buildProductIntake({
    projectInfo: projectInfo(),
    userMessage: [
      'Criar um site institucional claro para Tremn Escola de Gestão Consciente.',
      'A home deve ter hero com vídeo, header, footer, menu mobile, contato, CTA, premissas, jornada, paleta e tipografia.',
      'Também deve ter páginas internas, formulário, responsivo, visual humano e nada de dashboard SaaS antigo.',
    ].join(' '),
  });
  assert.strictEqual(longCreateBrief.canonical.action, 'create_project');
  assert.strictEqual(longCreateBrief.canonical.executionIntent, 'init_project');
  assert.strictEqual(longCreateBrief.signals.visualReviewIntent, false);

  console.log('product-intake-service.test.js: ok');
}

run();
