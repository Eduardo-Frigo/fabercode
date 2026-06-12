const assert = require('assert');

const {
  BLUEPRINT_LAYOUT_PIECE_INVENTORY,
  createProjectBlueprintService,
} = require('../cortex/orchestration/project_blueprint_service');
const { inferBlueprintBrand } = require('../cortex/orchestration/project_blueprint_brand_service');
const {
  buildAtelierCatalogNextPage,
  buildConsumerProductCatalogNextPage,
  buildTechnicalB2BLeadNextPage,
} = require('../cortex/orchestration/project_blueprint_next_page_renderers');
const { buildDomainRouteOperations } = require('../cortex/orchestration/project_blueprint_next_route_pages');
const { validateProjectBlueprintContract } = require('../cortex/orchestration/project_blueprint_contract_validation_service');
const { createWorkingBriefService } = require('../cortex/orchestration/working_brief_service');
const { findCssImportOrderViolation } = require('../cortex/orchestration/css_operation_safety');
const { createStackRegistryService } = require('../main/services/stack_registry_service');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

function isNextBlueprint(result) {
  return Boolean(result && result.ok && result.raw === 'project_blueprint:next-tailwind');
}

function readOperation(result, relPath) {
  return (result.action.operations.find((operation) => operation.path === relPath) || {}).content || '';
}

function assertResponsiveNavigationContract(result, label = 'blueprint') {
  if (!isNextBlueprint(result)) return;
  const navigationContract = result.action.blueprint.moduleContract.visualContracts.responsiveNavigation;
  assert.strictEqual(navigationContract.schemaVersion, 'blueprint-responsive-navigation-v1', `${label}: missing responsive navigation contract`);
  assert.strictEqual(navigationContract.mobileNavigation, 'hamburger', `${label}: mobile nav must be hamburger`);
  assert.strictEqual(navigationContract.mobileUntil, 'lg', `${label}: mobile nav must stay active until lg`);
  assert.strictEqual(navigationContract.desktopNavigation, 'inline_links', `${label}: desktop nav must be inline links`);
  assert.strictEqual(navigationContract.desktopFrom, 'lg', `${label}: desktop nav must start at lg`);
  assert.strictEqual(navigationContract.hamburgerPlacement, 'header_right_absolute', `${label}: hamburger must be pinned inside header`);

  const pageFiles = result.action.operations
    .filter((operation) => /^app\/(?:[^/]+\/)?page\.tsx$/.test(operation.path))
    .filter((operation) => /Abrir menu de navegação|Navegação principal mobile|BlueprintResponsiveHeader/.test(operation.content || ''));

  assert.ok(pageFiles.length >= 1, `${label}: expected at least one responsive header page`);
  for (const operation of pageFiles) {
    const content = operation.content || '';
    assert.ok(content.includes('lg:hidden'), `${label}:${operation.path}: hamburger must use lg:hidden`);
    assert.ok(content.includes('lg:flex'), `${label}:${operation.path}: desktop nav must use lg:flex`);
    assert.ok(content.includes('absolute right-5'), `${label}:${operation.path}: hamburger must be fixed to the right side of the header`);
    assert.ok(content.includes('max-w-[calc(100vw-7.5rem)]'), `${label}:${operation.path}: brand must reserve mobile space for hamburger`);
    assert.strictEqual(content.includes('md:hidden'), false, `${label}:${operation.path}: header must not switch at md`);
  }
}

function run() {
  const service = createProjectBlueprintService();
  const generatedBlueprints = [];
  const buildProjectBlueprintOperationBatch = service.buildProjectBlueprintOperationBatch;
  service.buildProjectBlueprintOperationBatch = function buildAndTrackBlueprint(options = {}) {
    const result = buildProjectBlueprintOperationBatch.call(service, options);
    if (isNextBlueprint(result)) {
      const label = options && options.projectInfo && options.projectInfo.rootPath
        ? options.projectInfo.rootPath
        : options && options.userMessage
          ? String(options.userMessage).slice(0, 80)
          : 'next-blueprint';
      generatedBlueprints.push({ label, result });
    }
    return result;
  };
  const workingBriefService = createWorkingBriefService();
  assert.strictEqual(inferBlueprintBrand('site para estufas comerciais'), 'Estufas Protegidas');
  assert.strictEqual(inferBlueprintBrand('briefing neutro', { brandFallback: 'Marca Contratada' }), 'Marca Contratada');
  assert.strictEqual(typeof buildAtelierCatalogNextPage, 'function');
  assert.strictEqual(typeof buildConsumerProductCatalogNextPage, 'function');
  assert.strictEqual(typeof buildTechnicalB2BLeadNextPage, 'function');
  assert.strictEqual(typeof buildDomainRouteOperations, 'function');

  const lamp = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-lamp' },
    userMessage: 'criar site institucional em LAMP com placeholder rápido',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(lamp.ok, true);
  assert.strictEqual(lamp.raw, 'project_blueprint:lamp');
  assert.strictEqual(lamp.action.generatedBy, 'project_blueprint_service');
  assert.deepStrictEqual(lamp.action.operations.map((operation) => operation.path), [
    'index.php',
    'style.css',
    'script.js',
  ]);

  const next = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-next' },
    userMessage: 'criar página institucional em Next.js com React e Tailwind usando placeholders',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(next.ok, true);
  assert.strictEqual(next.raw, 'project_blueprint:next-tailwind');
  assert.ok(next.action.operations.some((operation) => operation.path === 'package.json'));
  assert.ok(next.action.operations.some((operation) => operation.path === '.nvmrc'));
  assert.ok(next.action.operations.some((operation) => operation.path === 'app/layout.tsx'));
  assert.ok(next.action.operations.some((operation) => operation.path === 'app/page.tsx'));
  assert.ok(next.action.operations.some((operation) => operation.path === 'app/globals.css'));
  assert.ok(next.action.operations.find((operation) => operation.path === 'package.json').content.includes('"next"'));
  assert.ok(next.action.operations.find((operation) => operation.path === 'package.json').content.includes('next dev --webpack'));
  assert.ok(next.action.operations.find((operation) => operation.path === 'next.config.mjs').content.includes('turbopack'));
  assert.strictEqual(next.action.operations.find((operation) => operation.path === '.nvmrc').content, '24.15.0\n');
  assert.strictEqual(next.action.blueprint.layoutRecipe.id, 'modular-starter');
  assert.ok(next.action.blueprint.layoutRecipe.composition.inventory.heroes.includes('full-bleed-media'));
  assert.ok(next.action.blueprint.layoutRecipe.composition.inventory.bodySections.includes('collection-grid'));
  assert.ok(BLUEPRINT_LAYOUT_PIECE_INVENTORY.headers.includes('atelier-minimal'));
  assert.ok(next.action.summary.includes('composição modular'));
  assert.strictEqual(next.action.summary.includes('estrutura institucional'), false);
  const modularGuidance = service.buildProjectBlueprintPromptGuidance({
    userMessage: 'criar página institucional em Next.js com React e Tailwind usando placeholders',
    executionIntent: 'init_project',
  });
  assert.ok(modularGuidance.includes('Diretrizes de composição modular'));
  assert.ok(modularGuidance.includes('header, hero, seções do body e footer'));
  const nextLayout = next.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  assert.ok(nextLayout.includes('suppressHydrationWarning'));
  assert.ok(nextLayout.includes('fonts.googleapis.com'));
  const nextGlobals = next.action.operations.find((operation) => operation.path === 'app/globals.css').content;
  assert.ok(nextGlobals.includes('@import "tailwindcss"'));
  assert.strictEqual(nextGlobals.includes('fonts.googleapis.com'), false);
  assert.strictEqual(findCssImportOrderViolation(nextGlobals), null);

  const blueWhiteNext = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-blue-white' },
    userMessage: [
      'Quero criar um site em next.js, com react e tailwind.',
      'O site é para um advogado, quero ele com cor azul e branco.',
      'Use uma tipografia do Google e placeholders.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(blueWhiteNext.ok, true);
  const blueWhiteGlobals = blueWhiteNext.action.operations.find((operation) => operation.path === 'app/globals.css').content;
  assert.ok(blueWhiteGlobals.includes('--color-bg: #ffffff;'));
  assert.ok(blueWhiteGlobals.includes('--color-accent: #3240a8;'));
  assert.strictEqual(blueWhiteGlobals.includes('fonts.googleapis.com'), false);
  const blueWhiteLayout = blueWhiteNext.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  assert.ok(blueWhiteLayout.includes('fonts.googleapis.com'));
  assert.strictEqual(findCssImportOrderViolation(blueWhiteGlobals), null);
  assert.strictEqual(blueWhiteNext.action.blueprint.theme.accent, '#3240a8');
  assert.deepStrictEqual(blueWhiteNext.action.blueprint.icons.names, [
    'scale',
    'documentText',
    'shieldCheck',
  ]);

  const mediaNext = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-media' },
    userMessage: 'criar página institucional em Next.js com React e Tailwind usando placeholders para advogado',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    mediaAssets: {
      hero: {
        kind: 'photo',
        provider: 'pexels',
        query: 'law office consultation',
        src: 'https://images.pexels.com/photos/123/office.jpeg',
        alt: 'Law office consultation',
        attribution: 'Foto de Jane Creator no Pexels',
        sourceUrl: 'https://www.pexels.com/photo/sample-123/',
      },
    },
  });
  const mediaPage = mediaNext.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(mediaPage.includes('heroMedia'));
  assert.ok(mediaPage.includes('https://images.pexels.com/photos/123/office.jpeg'));
  assert.ok(mediaPage.includes('Foto de Jane Creator no Pexels'));
  assert.ok(mediaPage.includes('BlueprintResponsiveHeader'));
  assert.ok(mediaPage.includes('Navegação principal mobile'));
  assert.ok(mediaPage.includes('lg:hidden'));
  assert.ok(mediaPage.includes('w-64 max-w-[calc(100vw-2rem)]'));
  assert.ok(mediaPage.includes('<summary'));
  assert.strictEqual(mediaNext.action.blueprint.media.provider, 'pexels');

  const photoLabBrief = [
    'Briefing completo — Site para Laboratório Fotográfico',
    'Nome fictício do negócio',
    'Lumen Lab Fotográfico',
    'Criar site cinematográfico para laboratório fotográfico especializado em revelação de filmes, digitalização profissional, impressão fine art, restauração fotográfica, ampliações, negativos e atendimento para fotógrafos.',
    'Usar fundo escuro elegante, âmbar, hero full width com vídeo, serviços, portfólio, processo, orçamento, depoimentos e contato.',
  ].join('\n');
  const photoLabWorkingBrief = workingBriefService.buildWorkingBrief({
    userMessage: photoLabBrief,
    contextText: 'smoke antigo sobre escultura em madeira para artista, ateliê e galeria.',
  });
  const photoLabSite = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-photo-lab' },
    userMessage: photoLabBrief,
    contextText: 'smoke antigo sobre escultura em madeira para artista, ateliê e galeria.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: photoLabWorkingBrief,
    mediaAssets: {
      hero: {
        kind: 'video',
        provider: 'pexels',
        query: 'darkroom film development photo lab fine art printing negatives',
        src: 'https://videos.pexels.com/video-files/photo-lab.mp4',
        poster: 'https://images.pexels.com/photos/photo-lab.jpeg',
        alt: 'Laboratório fotográfico com negativos e luz de darkroom',
        attribution: 'Vídeo de Photo Lab no Pexels',
      },
    },
  });
  assert.strictEqual(photoLabSite.ok, true);
  assert.strictEqual(photoLabSite.action.blueprint.briefingContract.domain, 'photo-lab');
  assert.strictEqual(photoLabSite.action.blueprint.layoutRecipe.id, 'photographic-lab-site');
  assert.strictEqual(photoLabSite.action.blueprint.visualGrammar.id, 'sensory-immersive-story');
  assert.strictEqual(photoLabSite.action.blueprint.coverageContract.status, 'passed');
  const photoLabPage = photoLabSite.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  const photoLabGlobals = photoLabSite.action.operations.find((operation) => operation.path === 'app/globals.css').content;
  assert.ok(photoLabPage.includes('Lumen Lab Fotográfico'));
  assert.ok(photoLabPage.includes('Transformamos imagens em memória, arte e permanência.'));
  assert.ok(photoLabPage.includes('Revelação de filmes'));
  assert.ok(photoLabPage.includes('Digitalização profissional'));
  assert.ok(photoLabPage.includes('Impressão Fine Art'));
  assert.ok(photoLabPage.includes('Restauração fotográfica'));
  assert.ok(photoLabPage.includes('Enviar arquivos'));
  assert.ok(photoLabPage.includes('sensory-immersive-story'));
  assert.ok(photoLabGlobals.includes('--color-bg: #111111;'));
  assert.ok(photoLabGlobals.includes('--color-accent: #c98b3c;'));
  assert.strictEqual(/Faber Projeto|Atendimento placeholder premium|Este bloco usa texto placeholder|Uma presença digital clara/.test(photoLabPage), false);
  assert.strictEqual(/Ateliê Madeira Viva|escultura em madeira|talha manual/.test(photoLabPage), false);

  const ipFullWidthNext = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-ip-lawyer' },
    userMessage: [
      'Quero criar um site em Next.js para um escritório de advocacia especializado em direito de propriedade intelectual.',
      'Quero uma hero com imagem full width ou destaque visual forte.',
      'Áreas: marcas, patentes, direitos autorais, contratos de tecnologia e proteção de software.',
      'Use placeholders, FAQ, método de trabalho e contato.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    mediaAssets: {
      hero: {
        kind: 'photo',
        provider: 'pexels',
        query: 'intellectual property law office',
        src: 'https://images.pexels.com/photos/456/ip-law.jpeg',
        alt: 'Intellectual property law office',
        attribution: 'Foto de IP Creator no Pexels',
      },
    },
  });
  assert.strictEqual(ipFullWidthNext.ok, true);
  assert.strictEqual(ipFullWidthNext.action.blueprint.layoutVariant, 'full_bleed_media');
  assert.strictEqual(ipFullWidthNext.action.blueprint.layoutRecipe.id, 'immersive-story');
  assert.strictEqual(ipFullWidthNext.action.blueprint.layoutRecipe.hero, 'full-bleed-media');
  const ipFullWidthPage = ipFullWidthNext.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(ipFullWidthPage.includes('fullBleedHero'));
  assert.ok(ipFullWidthPage.includes('Soluções completas em propriedade intelectual'));
  assert.ok(ipFullWidthPage.includes('Registro de marcas'));
  assert.ok(ipFullWidthPage.includes('Redação de pedido de patente'));
  assert.ok(ipFullWidthPage.includes('Proteção internacional'));
  assert.ok(ipFullWidthPage.includes('Método de trabalho'));
  assert.ok(ipFullWidthPage.includes('FAQ'));
  assert.ok(ipFullWidthPage.includes('absolute inset-0 z-0 h-full w-full object-cover'));
  assert.ok(ipFullWidthPage.includes('absolute inset-0 z-[1] bg-[rgba(12,18,24,0.64)]'));
  assert.ok(ipFullWidthPage.includes('relative z-10 mx-auto'));
  assert.ok(!ipFullWidthPage.includes('-z-20'));

  const aureaBrief = [
    'Briefing — Landing Page Institucional',
    'Escritório de Patentes: Aurea IP & Patentes',
    'Criar landing page sofisticada, confiável e internacional para registro de patentes, marcas, desenhos industriais, modelos de utilidade, busca de anterioridade, INPI e proteção internacional.',
    'A estrutura deve incluir hero com vídeo full width, apresentação, especialista, serviços, atuação global, processo, diferenciais, chamada final, contato e footer escuro.',
  ].join('\n');
  const aureaWorkingBrief = workingBriefService.buildWorkingBrief({
    userMessage: aureaBrief,
    contextText: 'smoke antigo: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea para espaços com identidade.',
  });
  const aureaLanding = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-aurea-ip' },
    userMessage: aureaBrief,
    contextText: 'smoke antigo: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea para espaços com identidade.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: aureaWorkingBrief,
    mediaAssets: {
      hero: {
        kind: 'video',
        provider: 'pexels',
        query: 'patent law intellectual property office technology documents',
        src: 'https://videos.pexels.com/video-files/ip-office.mp4',
        poster: 'https://images.pexels.com/photos/ip-office.jpeg',
        alt: 'Documentos técnicos e estratégia de propriedade intelectual',
        attribution: 'Vídeo de IP no Pexels',
      },
    },
  });
  assert.strictEqual(aureaLanding.ok, true);
  assert.strictEqual(aureaLanding.action.blueprint.briefingContract.domain, 'intellectual-property');
  assert.strictEqual(aureaLanding.action.blueprint.layoutRecipe.id, 'immersive-story');
  assert.strictEqual(aureaLanding.action.blueprint.layoutRecipe.hero, 'full-bleed-media');
  const aureaLayout = aureaLanding.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  const aureaPage = aureaLanding.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(aureaLayout.includes('Aurea IP & Patentes'));
  assert.ok(aureaPage.includes('Aurea IP & Patentes'));
  assert.ok(aureaPage.includes('Proteção estratégica para ideias que movem o futuro.'));
  assert.ok(aureaPage.includes('Busca de anterioridade'));
  assert.ok(aureaPage.includes('Proteção internacional'));
  assert.ok(aureaPage.includes('Tipo de proteção'));
  assert.strictEqual(aureaPage.includes('Escritório Faber Advocacia'), false);
  assert.strictEqual(aureaPage.includes('Studio Habitat'), false);
  assert.strictEqual(aureaPage.includes('Helena Duarte Arquitetura'), false);
  assert.strictEqual(aureaPage.includes('placeholder contextual'), false);
  assert.strictEqual(aureaPage.includes('Este conteúdo é definitivo?'), false);

  const lineaBrief = [
    'Briefing — Site Completo',
    'Empresa: Linea Bosco Revestimentos',
    'Criar site completo elegante para pisos de madeira, painéis ripados, decks, revestimentos naturais, acabamentos arquitetônicos, projetos, inspirações e orçamento.',
    'A experiência visual deve valorizar madeira natural, paginações, carvalho, nogueira, cumaru, freijó, tauari e ipê.',
  ].join('\n');
  const lineaWorkingBrief = workingBriefService.buildWorkingBrief({
    userMessage: lineaBrief,
    contextText: 'smoke antigo: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea.',
  });
  const lineaSite = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-linea-bosco' },
    userMessage: lineaBrief,
    contextText: 'smoke antigo: Studio Habitat, Helena Duarte Arquitetura e arquitetura contemporânea.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: lineaWorkingBrief,
  });
  assert.strictEqual(lineaSite.ok, true);
  assert.strictEqual(lineaSite.action.blueprint.briefingContract.domain, 'wood-finishes');
  assert.strictEqual(lineaSite.action.blueprint.layoutRecipe.id, 'portfolio-gallery');
  assert.strictEqual(lineaSite.action.blueprint.coverageContract.status, 'passed');
  [
    'app/sobre/page.tsx',
    'app/servicos/page.tsx',
    'app/produtos/page.tsx',
    'app/pisos/page.tsx',
    'app/paineis/page.tsx',
    'app/decks/page.tsx',
    'app/projetos/page.tsx',
    'app/inspiracoes/page.tsx',
    'app/contato/page.tsx',
  ].forEach((relPath) => {
    assert.ok(lineaSite.action.operations.some((operation) => operation.path === relPath), `missing route ${relPath}`);
  });
  const lineaLayout = lineaSite.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  const lineaPage = lineaSite.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(lineaLayout.includes('Linea Bosco Revestimentos'));
  assert.ok(lineaPage.includes('Linea Bosco Revestimentos'));
  assert.ok(lineaPage.includes('Pisos de Madeira'));
  assert.ok(lineaPage.includes('Painéis Ripados'));
  assert.ok(lineaPage.includes('Decks e Áreas Externas'));
  assert.ok(lineaPage.includes('Texturas que aproximam natureza e arquitetura'));
  assert.ok(lineaPage.includes('Produto de interesse'));
  assert.strictEqual(lineaPage.includes('Studio Habitat'), false);
  assert.strictEqual(lineaPage.includes('Helena Duarte Arquitetura'), false);
  assert.strictEqual(lineaPage.includes('Arquitetura contemporânea para espaços com identidade'), false);

  const vitraPureBrief = [
    'Briefing completo — Landing Page de Garrafas de Vidro',
    'Nome da marca',
    'VitraPure',
    'Slogan: Beba melhor. Viva leve. Reduza o plástico.',
    'Criar landing page moderna, elegante e responsiva para garrafas de vidro reutilizáveis e sustentáveis.',
    'Estrutura obrigatória: hero, benefícios, sobre o produto, produtos, comparação, sustentabilidade, prova social, oferta, garantia, FAQ, chamada final e footer.',
    'Produtos: VitraPure Essential 500ml, VitraPure Aura 750ml e VitraPure Terra 1L.',
    'Use conteúdo específico final, sem placeholder genérico.',
  ].join('\n');
  const vitraPureWorkingBrief = workingBriefService.buildWorkingBrief({
    userMessage: vitraPureBrief,
    contextText: 'conversa antiga sobre Atelier Couro Faber, bolsas, pastas e couro artesanal.',
  });
  const vitraPureLanding = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-vitrapure' },
    userMessage: vitraPureBrief,
    contextText: 'conversa antiga sobre Atelier Couro Faber, bolsas, pastas e couro artesanal.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: vitraPureWorkingBrief,
  });
  assert.strictEqual(vitraPureLanding.ok, true);
  assert.strictEqual(vitraPureLanding.action.blueprint.briefingContract.domain, 'sustainable-product-landing');
  assert.strictEqual(vitraPureLanding.action.blueprint.layoutRecipe.id, 'consumer-product-catalog-landing');
  assert.strictEqual(vitraPureLanding.action.blueprint.visualGrammar.id, 'consumer-product-mosaic');
  assert.strictEqual(vitraPureLanding.action.blueprint.moduleContract.slots.visualGrammar, 'consumer-product-mosaic');
  assert.strictEqual(vitraPureLanding.action.blueprint.coverageContract.status, 'passed');
  const vitraPureLayout = vitraPureLanding.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  const vitraPurePage = vitraPureLanding.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(vitraPureLayout.includes('VitraPure'));
  assert.ok(vitraPurePage.includes('Sua água mais pura, sua rotina mais sustentável.'));
  assert.ok(vitraPurePage.includes('data-visual-grammar="consumer-product-mosaic"'));
  assert.ok(vitraPurePage.includes('Livre de BPA'));
  assert.ok(vitraPurePage.includes('VitraPure Essential 500ml'));
  assert.ok(vitraPurePage.includes('VitraPure Aura 750ml'));
  assert.ok(vitraPurePage.includes('VitraPure Terra 1L'));
  assert.ok(vitraPurePage.includes('Comprar agora'));
  assert.ok(vitraPurePage.includes('Menos plástico. Mais consciência.'));
  assert.strictEqual(vitraPurePage.includes('Atelier Couro Faber'), false);
  assert.strictEqual(vitraPurePage.includes('Helena Duarte Arquitetura'), false);
  assert.strictEqual(vitraPurePage.includes('Studio Habitat'), false);

  const alumivanceBrief = [
    'Briefing completo — Site de Empresa de Esquadrias de Alumínio e ACM',
    'Nome da empresa',
    'Alumivance Esquadrias & Fachadas',
    'Criar site institucional completo, moderno, responsivo e multipágina para empresa de esquadrias de alumínio, fachadas em ACM, pele de vidro, guarda-corpos, brises metálicos e portões.',
    'Páginas: Início, Sobre a Alumivance, Soluções, Projetos, Calculadora de Orçamento, Blog, Contato e Trabalhe Conosco.',
    'A calculadora deve usar a fórmula: área em m² × valor base da solução × multiplicador do acabamento × multiplicador do vidro.',
    'Use conteúdo específico final, sem placeholder genérico.',
  ].join('\n');
  const alumivanceWorkingBrief = workingBriefService.buildWorkingBrief({
    userMessage: alumivanceBrief,
    contextText: 'smoke antigo com Helena Duarte Arquitetura e Studio Habitat.',
  });
  const alumivanceSite = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-alumivance' },
    userMessage: alumivanceBrief,
    contextText: 'smoke antigo com Helena Duarte Arquitetura e Studio Habitat.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: alumivanceWorkingBrief,
  });
  assert.strictEqual(alumivanceSite.ok, true);
  assert.strictEqual(alumivanceSite.action.blueprint.briefingContract.domain, 'technical-b2b-services-site');
  assert.strictEqual(alumivanceSite.action.blueprint.layoutRecipe.id, 'technical-b2b-lead-site');
  assert.strictEqual(alumivanceSite.action.blueprint.visualGrammar.id, 'technical-b2b-systems');
  assert.strictEqual(alumivanceSite.action.blueprint.moduleContract.slots.visualGrammar, 'technical-b2b-systems');
  assert.notStrictEqual(
    alumivanceSite.action.blueprint.visualGrammar.id,
    vitraPureLanding.action.blueprint.visualGrammar.id
  );
  assert.strictEqual(alumivanceSite.action.blueprint.coverageContract.status, 'passed');
  [
    'app/sobre/page.tsx',
    'app/solucoes/page.tsx',
    'app/projetos/page.tsx',
    'app/calculadora/page.tsx',
    'app/blog/page.tsx',
    'app/contato/page.tsx',
    'app/trabalhe-conosco/page.tsx',
  ].forEach((relPath) => {
    assert.ok(alumivanceSite.action.operations.some((operation) => operation.path === relPath), `missing route ${relPath}`);
  });
  const alumivanceLayout = alumivanceSite.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  const alumivancePage = alumivanceSite.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  const alumivanceCalculator = alumivanceSite.action.operations.find((operation) => operation.path === 'app/calculadora/page.tsx').content;
  assert.ok(alumivanceLayout.includes('Alumivance Esquadrias & Fachadas'));
  assert.ok(alumivancePage.includes('data-visual-grammar="technical-b2b-systems"'));
  assert.ok(alumivancePage.includes('Esquadrias de alumínio'));
  assert.ok(alumivancePage.includes('Fachadas em ACM'));
  assert.ok(alumivancePage.includes('Pele de vidro'));
  assert.ok(alumivancePage.includes('Calculadora de Orçamento'));
  assert.ok(alumivancePage.includes("'/solucoes'"));
  assert.ok(alumivancePage.includes("'/calculadora'"));
  assert.ok(alumivanceCalculator.includes('"use client"'));
  assert.ok(alumivanceCalculator.includes('useState'));
  assert.ok(alumivanceCalculator.includes('baseValues'));
  assert.ok(alumivanceCalculator.includes('finishMultipliers'));
  assert.ok(alumivanceCalculator.includes('glassMultipliers'));
  assert.ok(alumivanceCalculator.includes('areaValue * base * finishMultiplier * glassMultiplier'));
  assert.ok(alumivanceCalculator.includes('Enviar para análise técnica'));
  assert.strictEqual(alumivancePage.includes('Helena Duarte'), false);
  assert.strictEqual(alumivancePage.includes('Helena Duarte Arquitetura'), false);
  assert.strictEqual(alumivancePage.includes('Studio Habitat'), false);
  assert.strictEqual(alumivancePage.includes('Atelier Couro Faber'), false);

  const wineBrief = [
    'Briefing completo — Landing Page de Vinhos',
    'Nome da marca',
    'Vinícola de Teste',
    'Criar landing page para vinhos artesanais premium, vinícola boutique, kit degustação, rótulos, terroir, uvas selecionadas, colheita manual, barricas, harmonização, prova social, oferta especial e formulário de captura.',
    'A página deve transmitir sofisticação, tradição, natureza, exclusividade e prazer.',
    'Use conteúdo específico final, sem placeholder genérico.',
  ].join('\n');
  const wineWorkingBrief = workingBriefService.buildWorkingBrief({
    userMessage: wineBrief,
    contextText: 'smoke antigo sobre Linea Bosco, pisos de madeira, carvalho, nogueira e decks.',
  });
  const wineLanding = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-wine' },
    userMessage: wineBrief,
    contextText: 'smoke antigo sobre Linea Bosco, pisos de madeira, carvalho, nogueira e decks.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: wineWorkingBrief,
  });
  assert.strictEqual(wineLanding.ok, true);
  assert.strictEqual(wineLanding.action.blueprint.briefingContract.domain, 'premium-wine-landing');
  assert.strictEqual(wineLanding.action.blueprint.layoutRecipe.id, 'wine-sensory-landing');
  assert.strictEqual(wineLanding.action.blueprint.visualGrammar.id, 'wine-sensory-cellar');
  assert.strictEqual(wineLanding.action.blueprint.moduleContract.slots.visualGrammar, 'wine-sensory-cellar');
  assert.strictEqual(wineLanding.action.blueprint.coverageContract.status, 'passed');
  const winePage = wineLanding.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(winePage.includes('data-visual-grammar="wine-sensory-cellar"'));
  assert.ok(winePage.includes('Kit Degustação'));
  assert.ok(winePage.includes('Rótulo Tinto Reserva'));
  assert.ok(winePage.includes('Harmonize cada rótulo'));
  assert.ok(winePage.includes('Quero degustar agora'));
  assert.strictEqual(winePage.includes('Madeira natural para projetos'), false);
  assert.strictEqual(winePage.includes('pisos de madeira'), false);
  assert.strictEqual(winePage.includes('Linea Bosco'), false);

  const constructionBrief = [
    'Faça um site completo com múltiplas páginas do tema materiais de construção.',
    'Nome da empresa',
    'Constrular Prime',
    'Quero múltiplas páginas e informações do sobre da empresa.',
    'Precisa de produtos, serviços, orçamento, contato, cimento, areia, brita, argamassa, tijolos, telhas, hidráulica, elétrica, ferramentas, tintas, entrega programada e lista de materiais.',
    'Use conteúdo específico final, sem placeholder genérico.',
  ].join('\n');
  const constructionWorkingBrief = workingBriefService.buildWorkingBrief({
    userMessage: constructionBrief,
    contextText: 'smoke antigo sobre vinhos, VitraPure e esquadrias de alumínio.',
  });
  const constructionSite = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-construction-materials' },
    userMessage: constructionBrief,
    contextText: 'smoke antigo sobre vinhos, VitraPure e esquadrias de alumínio.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: constructionWorkingBrief,
  });
  assert.strictEqual(constructionSite.ok, true);
  assert.strictEqual(constructionSite.action.blueprint.briefingContract.domain, 'construction-materials-site');
  assert.strictEqual(constructionSite.action.blueprint.layoutRecipe.id, 'construction-materials-store-site');
  assert.strictEqual(constructionSite.action.blueprint.visualGrammar.id, 'construction-retail-yard');
  assert.strictEqual(constructionSite.action.blueprint.moduleContract.slots.visualGrammar, 'construction-retail-yard');
  assert.strictEqual(constructionSite.action.blueprint.coverageContract.status, 'passed');
  [
    'app/sobre/page.tsx',
    'app/produtos/page.tsx',
    'app/servicos/page.tsx',
    'app/orcamento/page.tsx',
    'app/blog/page.tsx',
    'app/contato/page.tsx',
  ].forEach((relPath) => {
    assert.ok(constructionSite.action.operations.some((operation) => operation.path === relPath), `missing route ${relPath}`);
  });
  const constructionPage = constructionSite.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(constructionPage.includes('data-visual-grammar="construction-retail-yard"'));
  assert.ok(constructionPage.includes('Categorias de materiais'));
  assert.ok(constructionPage.includes('Cimento, areia e brita'));
  assert.ok(constructionPage.includes('Enviar lista de materiais'));
  assert.ok(constructionPage.includes("'/orcamento'"));
  assert.notStrictEqual(constructionSite.action.blueprint.visualGrammar.id, wineLanding.action.blueprint.visualGrammar.id);
  assert.notStrictEqual(constructionSite.action.blueprint.visualGrammar.id, alumivanceSite.action.blueprint.visualGrammar.id);
  assert.strictEqual(constructionPage.includes('vinícola boutique'), false);
  assert.strictEqual(constructionPage.includes('Esquadrias de alumínio e fachadas em ACM'), false);

  const greenhouseNext = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-greenhouses' },
    userMessage: [
      'Criar landing page em Next.js para venda de estufas agrícolas, residenciais e comerciais.',
      'O hero deve ser full width com vídeo, verde profundo, off-white, modelos de estufas, FAQ e formulário de orçamento.',
      'A conversa antiga falava de Clínica Sorriso, mas este projeto é para cultivo protegido, viveiros e produtores rurais.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    mediaAssets: {
      hero: {
        kind: 'video',
        provider: 'pexels',
        query: 'modern greenhouse farming protected cultivation vegetables',
        src: 'https://videos.pexels.com/video-files/greenhouse.mp4',
        poster: 'https://images.pexels.com/photos/greenhouse.jpeg',
        alt: 'Estufa moderna com cultivo protegido',
        attribution: 'Vídeo de Faber no Pexels',
      },
    },
  });
  assert.strictEqual(greenhouseNext.ok, true);
  assert.strictEqual(greenhouseNext.action.blueprint.briefingContract.domain, 'greenhouses');
  assert.strictEqual(greenhouseNext.action.blueprint.layoutVariant, 'full_bleed_media');
  assert.strictEqual(greenhouseNext.action.blueprint.layoutRecipe.id, 'agri-commercial-landing');
  assert.strictEqual(greenhouseNext.action.blueprint.layoutRecipe.hero, 'full-bleed-media');
  assert.strictEqual(greenhouseNext.action.blueprint.moduleContract.schemaVersion, 'blueprint-module-contract-v1');
  assert.strictEqual(greenhouseNext.action.blueprint.moduleContract.commitPolicy.ledger, 'automata_contract_ledger');
  assert.ok(greenhouseNext.action.blueprint.layoutRecipe.composition.inventory.bodySections.includes('calculator'));
  assert.deepStrictEqual(greenhouseNext.action.blueprint.icons.names, [
    'leaf',
    'shieldCheck',
    'droplet',
  ]);
  assert.strictEqual(greenhouseNext.action.blueprint.theme.accent, '#1f5a3d');
  assert.strictEqual(greenhouseNext.action.blueprint.theme.background, '#fcf7e3');
  assert.strictEqual(greenhouseNext.action.blueprint.media.kind, 'video');
  assert.strictEqual(greenhouseNext.action.blueprint.media.query, 'modern greenhouse farming protected cultivation vegetables');
  const greenhouseLayout = greenhouseNext.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  const greenhousePage = greenhouseNext.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(greenhouseLayout.includes('Estufas Protegidas'));
  assert.ok(greenhousePage.includes('Estufas sob medida para produzir mais'));
  assert.ok(greenhousePage.includes('Estufa Agrícola Tipo Túnel'));
  assert.ok(greenhousePage.includes('Estufa Multitúnel'));
  assert.ok(greenhousePage.includes('Receber meu orçamento'));
  assert.ok(greenhousePage.includes('WhatsApp'));
  assert.strictEqual(greenhousePage.includes('Clínica Sorriso'), false);
  assert.strictEqual(greenhousePage.includes('Uma presença digital clara'), false);

  const importLanding = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-import-services' },
    userMessage: [
      'Briefing Completo — Landing Page de Importação.',
      'Criar landing page Next.js para consultoria em importação de produtos, cotação internacional, fornecedores, documentação e logística internacional.',
      'Precisa ter hero, CTA Solicitar cotação, WhatsApp, serviços, processo, tipos de importação, diferenciais, prova social, formulário com produto que deseja importar, país de origem, quantidade estimada, objetivo da importação, FAQ e footer.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(importLanding.ok, true);
  assert.strictEqual(importLanding.action.blueprint.briefingContract.domain, 'import-services');
  assert.strictEqual(importLanding.action.blueprint.layoutRecipe.id, 'import-service-landing');
  assert.strictEqual(importLanding.action.blueprint.coverageContract.status, 'passed');
  assert.strictEqual(importLanding.action.blueprint.sectionManifest.schemaVersion, 'project-blueprint-manifest-v1');
  assert.ok(importLanding.action.blueprint.sectionManifest.sectionIds.includes('footer'));
  assert.ok(importLanding.action.blueprint.sectionManifest.sectionIds.includes('differentials'));
  assert.strictEqual(importLanding.action.blueprint.sectionManifest.pageIds.includes('/sobre'), false);
  assert.strictEqual(importLanding.action.blueprint.visualGrammar.id, 'trade-logistics-command');
  assert.strictEqual(importLanding.action.blueprint.moduleContract.slots.visualGrammar, 'trade-logistics-command');
  assert.strictEqual(importLanding.action.blueprint.coverageContract.requirements.required.differentials, true);
  assert.strictEqual(importLanding.action.blueprint.coverageContract.evaluation.covered.differentials, true);
  const importPage = importLanding.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(importPage.includes('data-visual-grammar="trade-logistics-command"'));
  assert.strictEqual(importPage.includes('null as const'), false);
  assert.ok(importPage.includes('const heroMedia: BlueprintHeroMedia | null = null;'));
  assert.ok(importPage.includes('BlueprintResponsiveHeader'));
  assert.ok(importPage.includes('Navegação principal mobile'));
  assert.ok(importPage.includes('lg:hidden'));
  assert.ok(importPage.includes('w-64 max-w-[calc(100vw-2rem)]'));
  assert.ok(importPage.includes('function HeroMedia'));
  assert.ok(importPage.includes('Porto, contêineres e operação internacional'));
  assert.ok(importPage.includes('overflow-x-hidden'));
  assert.ok(importPage.includes('break-words'));
  assert.ok(importPage.includes('Importe produtos com segurança'));
  assert.ok(importPage.includes('Comércio exterior'));
  assert.ok(importPage.includes('desembaraço aduaneiro') || importPage.includes('Desembaraço aduaneiro'));
  assert.ok(importPage.includes('Serviços de importação'));
  assert.ok(importPage.includes('Tipos de importação atendidos'));
  assert.ok(importPage.includes('Diferenciais da empresa'));
  assert.ok(importPage.includes('Produto que deseja importar'));
  assert.ok(importPage.includes('País de origem'));
  assert.ok(importPage.includes('Quantidade estimada'));
  assert.ok(importPage.includes('Objetivo da importação'));
  assert.ok(importPage.includes('Falar no WhatsApp'));
  assert.strictEqual(importPage.includes('Atendimento placeholder premium'), false);
  assert.strictEqual(importPage.includes('Faber Projeto'), false);

  const architectureBrief = [
    'Briefing Completo — Site de Arquitetura.',
    'Desenvolver site completo em Next.js para Helena Duarte Arquitetura, Arq. Helena Duarte.',
    'Precisa ter hero com vídeo full width, sobre, serviços, projetos/cases, processo, insights, contato, depoimentos, diferenciais e formulário.',
    'Além do hero, precisa de vídeo no corpo da página para mostrar processo e detalhes dos projetos.',
  ].join(' ');
  const architectureWorkingBrief = workingBriefService.buildWorkingBrief({
    userMessage: architectureBrief,
    contextText: 'conversa antiga sobre importação e Clínica Sorriso',
  });
  const architectureSite = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-helena-duarte' },
    userMessage: architectureBrief,
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: architectureWorkingBrief,
    mediaAssets: {
      hero: {
        kind: 'video',
        provider: 'pexels',
        query: 'luxury contemporary architecture interiors design studio',
        src: 'https://videos.pexels.com/video-files/architecture.mp4',
        poster: 'https://images.pexels.com/photos/architecture.jpeg',
        alt: 'Arquitetura contemporânea',
        attribution: 'Vídeo de Faber no Pexels',
      },
    },
  });
  assert.strictEqual(architectureSite.ok, true);
  assert.strictEqual(architectureSite.action.blueprint.briefingContract.domain, 'architecture');
  assert.strictEqual(architectureSite.action.blueprint.layoutRecipe.id, 'architecture-studio-site');
  assert.strictEqual(architectureSite.action.blueprint.visualGrammar.id, 'editorial-portfolio-statement');
  assert.strictEqual(architectureSite.action.blueprint.moduleContract.slots.visualGrammar, 'editorial-portfolio-statement');
  assert.strictEqual(architectureSite.action.blueprint.coverageContract.status, 'passed');
  assert.strictEqual(architectureSite.action.blueprint.sectionManifest.source, 'briefing_spec');
  assert.ok(architectureSite.action.blueprint.sectionManifest.sectionIds.includes('differentials'));
  assert.ok(architectureSite.action.blueprint.sectionManifest.coverage.videoSection);
  assert.ok(architectureSite.action.blueprint.sectionManifest.pageIds.includes('/sobre'));
  assert.ok(architectureSite.action.blueprint.sectionManifest.pageIds.includes('/contato'));
  assert.strictEqual(architectureSite.action.blueprint.coverageContract.requirements.required.videoSection, true);
  assert.strictEqual(architectureSite.action.blueprint.coverageContract.evaluation.covered.videoSection, true);
  assert.strictEqual(architectureSite.action.blueprint.coverageContract.evaluation.covered.differentials, true);
  [
    'app/sobre/page.tsx',
    'app/servicos/page.tsx',
    'app/projetos/page.tsx',
    'app/processo/page.tsx',
    'app/insights/page.tsx',
    'app/contato/page.tsx',
  ].forEach((relPath) => {
    assert.ok(architectureSite.action.operations.some((operation) => operation.path === relPath), `missing ${relPath}`);
  });
  const architectureLayout = architectureSite.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  const architecturePage = architectureSite.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(architectureLayout.includes('Helena Duarte Arquitetura'));
  assert.ok(architecturePage.includes('data-visual-grammar="editorial-portfolio-statement"'));
  assert.ok(architecturePage.includes('Arquitetura contemporânea para espaços com identidade'));
  assert.ok(architecturePage.includes('Projetos selecionados'));
  assert.ok(architecturePage.includes('Por que escolher o Helena Duarte Arquitetura'));
  assert.ok(architecturePage.includes('Insights de Arquitetura'));
  assert.ok(architecturePage.includes("'/projetos'"));
  assert.ok(architecturePage.includes("'/insights'"));
  assert.ok(architecturePage.includes("routeHref('/processo'"));
  assert.ok(architecturePage.includes('<video'));
  assert.strictEqual(architecturePage.includes('Studio Habitat'), false);
  assert.strictEqual(architecturePage.includes('Atendimento placeholder premium'), false);

  const chocolateNext = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-chocolate' },
    userMessage: [
      'Criar landing page em Next.js para chocolate artesanal, premium e sensorial.',
      'Hero com vídeo full width de chocolate derretendo, cacau, bombons e chamada Comprar agora.',
      'Paleta marrom chocolate #3B1F14, cacau escuro #1E0F0A, creme #F7E7CE, dourado suave #C89B5A e branco quente #FFF8F0.',
      'Tipografia Playfair Display nos títulos e Inter nos textos.',
      'A conversa antiga falava de bolsas e couro, mas este projeto é para chocolate.',
    ].join(' '),
    contextText: 'conversa antiga sobre Atelier Couro Faber, bolsas, pastas e artefatos de couro artesanal',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    mediaAssets: {
      hero: {
        kind: 'video',
        provider: 'pexels',
        query: 'artisan chocolate melting cocoa premium dessert',
        src: 'https://videos.pexels.com/video-files/chocolate.mp4',
        poster: 'https://images.pexels.com/photos/chocolate.jpeg',
        alt: 'Chocolate derretendo em close-up',
        attribution: 'Vídeo de Faber no Pexels',
      },
    },
  });
  assert.strictEqual(chocolateNext.ok, true);
  assert.strictEqual(chocolateNext.action.blueprint.briefingContract.domain, 'chocolate');
  assert.strictEqual(chocolateNext.action.blueprint.layoutVariant, 'full_bleed_media');
  assert.strictEqual(chocolateNext.action.blueprint.layoutRecipe.id, 'sensory-chocolate-landing');
  assert.strictEqual(chocolateNext.action.blueprint.visualGrammar.id, 'sensory-immersive-story');
  assert.strictEqual(chocolateNext.action.blueprint.moduleContract.slots.visualGrammar, 'sensory-immersive-story');
  assert.strictEqual(chocolateNext.action.blueprint.layoutRecipe.hero, 'full-bleed-media');
  assert.deepStrictEqual(chocolateNext.action.blueprint.icons.names, [
    'sparkles',
    'gift',
    'heartPulse',
  ]);
  assert.strictEqual(chocolateNext.action.blueprint.theme.accent, '#3b1f14');
  assert.strictEqual(chocolateNext.action.blueprint.theme.background, '#f7e7ce');
  assert.strictEqual(chocolateNext.action.blueprint.media.kind, 'video');
  const chocolateLayout = chocolateNext.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  const chocolatePage = chocolateNext.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  const chocolateGlobals = chocolateNext.action.operations.find((operation) => operation.path === 'app/globals.css').content;
  assert.ok(chocolateLayout.includes('Maison Cacao'));
  assert.ok(chocolatePage.includes('data-visual-grammar="sensory-immersive-story"'));
  assert.ok(chocolatePage.includes('BlueprintResponsiveHeader'));
  assert.ok(chocolatePage.includes('Navegação principal mobile'));
  assert.ok(chocolatePage.includes('lg:hidden'));
  assert.ok(chocolatePage.includes('w-64 max-w-[calc(100vw-2rem)]'));
  assert.ok(chocolatePage.includes('Chocolate feito para ser sentido.'));
  assert.ok(chocolatePage.includes('Veja como nasce o nosso chocolate'));
  assert.ok(chocolatePage.includes('Chocolate 70% Cacau'));
  assert.ok(chocolatePage.includes('Chocolate com Avelãs'));
  assert.ok(chocolatePage.includes('Bombons Especiais'));
  assert.ok(chocolatePage.includes('Comprar agora'));
  assert.ok(chocolatePage.includes('testimonials.map'));
  assert.ok(chocolatePage.includes('Instagram'));
  assert.ok(chocolatePage.includes('© 2026'));
  assert.strictEqual(chocolatePage.includes('copy contextual'), false);
  assert.strictEqual(chocolatePage.includes('O conteúdo do site é definitivo?'), false);
  assert.strictEqual(chocolatePage.includes('Bolsas de couro'), false);
  assert.strictEqual(chocolatePage.includes('Atelier Couro Faber'), false);
  assert.ok(chocolateGlobals.includes('--color-bg: #f7e7ce;'));
  assert.ok(chocolateGlobals.includes('--color-ink: #1e0f0a;'));
  assert.ok(chocolateGlobals.includes('overflow-wrap: anywhere;'));
  assert.ok(chocolateGlobals.includes('min-width: 0;'));

  const chocolateNoMedia = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-cacau-nobre-no-media' },
    userMessage: [
      'Briefing — Landing page de chocolate artesanal premium.',
      'Nome do produto: Cacau Nobre Atelier.',
      'Criar uma landing page sensorial com catálogo de chocolates, bombons especiais, processo artesanal, depoimentos, FAQ e compra por contato.',
      'Não reaproveitar marcas de conversas antigas.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(chocolateNoMedia.ok, true);
  assert.strictEqual(chocolateNoMedia.action.blueprint.briefingContract.domain, 'chocolate');
  assert.strictEqual(chocolateNoMedia.action.blueprint.coverageContract.status, 'passed');
  assert.strictEqual(chocolateNoMedia.action.blueprint.coverageContract.evaluation.covered.productsStore, true);
  assert.strictEqual(chocolateNoMedia.action.blueprint.coverageContract.evaluation.covered.testimonialDepth, true);
  const chocolateNoMediaPage = chocolateNoMedia.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(chocolateNoMediaPage.includes('Cacau Nobre Atelier'));
  assert.ok(chocolateNoMediaPage.includes('const heroMedia: BlueprintHeroMedia | null = null;'));
  assert.ok(chocolateNoMediaPage.includes('BlueprintResponsiveHeader'));
  assert.ok(chocolateNoMediaPage.includes('Navegação principal mobile'));
  assert.strictEqual(chocolateNoMediaPage.includes('null as const'), false);
  assert.strictEqual(chocolateNoMediaPage.includes('maisoncacao'), false);
  assert.ok(chocolateNoMediaPage.includes('contato@cacaunobreatelier.com.br'));
  assert.ok(chocolateNoMediaPage.includes('id="produtos"'));
  assert.ok(chocolateNoMediaPage.includes('testimonials.map'));
  assert.ok(chocolateNoMediaPage.includes('overflow-x-hidden'));
  assert.ok(chocolateNoMediaPage.includes('break-words'));
  assert.strictEqual(chocolateNoMediaPage.includes('copy contextual'), false);

  const leatherNext = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-leather' },
    userMessage: [
      'Quero criar uma landing page em Next.js para uma empresa que vende artefatos de couro, como bolsas e pastas.',
      'As cores da marca são vermelho marsala e um tom claro de apoio quase branco, amarelo alaranjado.',
      'Quero conteúdo sobre qualidade, longevidade do couro e produção artesanal, com visual europeu.',
      'Use placeholders e depois ajusto.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(leatherNext.ok, true);
  assert.strictEqual(leatherNext.action.blueprint.briefingContract.domain, 'leather-goods');
  assert.strictEqual(leatherNext.action.blueprint.layoutVariant, 'atelier_catalog');
  assert.strictEqual(leatherNext.action.blueprint.layoutRecipe.id, 'artisan-commerce');
  assert.strictEqual(leatherNext.action.blueprint.visualGrammar.id, 'atelier-catalog-studio');
  assert.strictEqual(leatherNext.action.blueprint.moduleContract.slots.visualGrammar, 'atelier-catalog-studio');
  assert.deepStrictEqual(leatherNext.action.blueprint.layoutRecipe.bodySections, [
    'collection-grid',
    'material-story',
    'craft-process',
    'care-faq',
    'contact',
  ]);
  assert.strictEqual(leatherNext.action.blueprint.theme.accent, '#8f3447');
  assert.strictEqual(leatherNext.action.blueprint.theme.background, '#fcf7e3');
  assert.deepStrictEqual(leatherNext.action.blueprint.icons.names, [
    'briefcase',
    'sparkles',
    'shieldCheck',
  ]);
  const leatherLayout = leatherNext.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  const leatherPage = leatherNext.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(leatherLayout.includes('Atelier Couro Faber'));
  assert.ok(leatherPage.includes('layoutRecipe'));
  assert.ok(leatherPage.includes('data-visual-grammar="atelier-catalog-studio"'));
  assert.ok(leatherPage.includes('Peças de couro feitas para atravessar anos.'));
  assert.ok(leatherPage.includes('Bolsas de couro'));
  assert.ok(leatherPage.includes('Pastas e office'));
  assert.ok(leatherPage.includes('Processo artesanal'));
  assert.ok(leatherPage.includes('Matéria-prima'));
  assert.strictEqual(leatherPage.includes('Uma presença digital clara'), false);
  assert.strictEqual(leatherPage.includes('Faber Projeto'), false);

  const leatherProductWithoutExplicitStack = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-leather-product' },
    userMessage: [
      'Eu quero criar uma landing page de produto para artefatos de couro, com hero em video no topo em uma rua europeia bonita.',
      'Preciso de sessoes sobre qualidade, trabalho artesanal, produtos com 3 ou 4 bolsas, offwhite e marsala.',
      'O site precisa ficar bom no mobile.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(leatherProductWithoutExplicitStack.ok, true);
  assert.strictEqual(leatherProductWithoutExplicitStack.raw, 'project_blueprint:next-tailwind');
  assert.strictEqual(leatherProductWithoutExplicitStack.action.targetFile, 'app/page.tsx');
  assert.strictEqual(leatherProductWithoutExplicitStack.action.blueprint.layoutRecipe.id, 'artisan-commerce');
  assert.strictEqual(service.shouldPreferProjectBlueprint({
    projectInfo: { rootPath: '/tmp/faber-leather-product' },
    userMessage: 'criar uma landing page de produto para artefatos de couro com bolsas artesanais, marsala e offwhite',
    executionIntent: 'init_project',
  }), true);

  const leatherLamp = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-leather-lamp' },
    userMessage: 'criar uma landing page LAMP/PHP para artefatos de couro com produtos, qualidade artesanal, marsala e offwhite',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(leatherLamp.ok, true);
  assert.strictEqual(leatherLamp.raw, 'project_blueprint:lamp');
  assert.deepStrictEqual(leatherLamp.action.operations.map((operation) => operation.path), [
    'index.php',
    'style.css',
    'script.js',
  ]);
  assert.strictEqual(leatherLamp.action.operations.some((operation) => operation.path === 'index.html'), false);

  const autonomousWhales = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-whales' },
    userMessage: [
      'Criar um site institucional com placeholders sobre baleias jubarte.',
      'Stack sugerida: static-web.',
      'paleta baseada em #1f6f9f; tipografia profissional.',
      'Usar imagem Pexels coerente com oceano, baleias jubarte, orientação landscape e tons alinhados à cor principal.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    force: true,
  });
  assert.strictEqual(autonomousWhales.ok, true);
  assert.strictEqual(autonomousWhales.raw, 'project_blueprint:static-web');
  assert.strictEqual(autonomousWhales.action.blueprint.briefingContract.domain, 'humpback-whales');
  assert.deepStrictEqual(autonomousWhales.action.blueprint.icons.names, [
    'waves',
    'compass',
    'globeAlt',
  ]);
  const whaleHtml = autonomousWhales.action.operations.find((operation) => operation.path === 'index.html').content;
  const whaleCss = autonomousWhales.action.operations.find((operation) => operation.path === 'style.css').content;
  assert.ok(whaleHtml.includes('Baleias jubarte'));
  assert.ok(whaleHtml.includes('Conservação marinha'));
  assert.ok(whaleCss.includes('--accent: #1f6f9f;'));

  const saasTool = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-saas-tool' },
    userMessage: [
      'Criar uma landing page completa em Next.js para um SaaS de gestão de equipes.',
      'Precisa mostrar dashboard, módulos, automações, workflow, planos, depoimentos, FAQ e formulário para demo.',
      'O foco é uma primeira versão completa que o usuário só ajusta depois com textos e imagens finais.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(saasTool.ok, true);
  assert.strictEqual(saasTool.action.blueprint.briefingContract.domain, 'saas-tool');
  assert.strictEqual(saasTool.action.blueprint.layoutRecipe.id, 'saas-tool-landing');
  assert.strictEqual(saasTool.action.blueprint.visualGrammar.id, 'saas-tool-workspace');
  assert.strictEqual(saasTool.action.blueprint.coverageContract.status, 'passed');
  const saasPage = saasTool.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(saasPage.includes('data-visual-grammar="saas-tool-workspace"'));
  assert.ok(saasPage.includes('Dashboard executivo'));
  assert.ok(saasPage.includes('Pipeline de trabalho'));
  assert.ok(saasPage.includes('Agendar demo'));
  assert.ok(saasPage.includes('Solicitar demo'));
  assert.ok(saasPage.includes('testimonials.map'));
  assert.strictEqual(saasPage.includes('Atendimento placeholder premium'), false);

  const editorialHub = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-editorial-hub' },
    userMessage: [
      'Criar um site completo em Next.js para uma revista digital e portal de conteúdo editorial.',
      'Precisa ter editorias, artigos, destaques, guias, newsletter, depoimentos, FAQ e contato.',
      'A primeira versão deve sair completa para trocar textos e imagens depois.',
    ].join(' '),
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(editorialHub.ok, true);
  assert.strictEqual(editorialHub.action.blueprint.briefingContract.domain, 'editorial-content');
  assert.strictEqual(editorialHub.action.blueprint.layoutRecipe.id, 'editorial-content-hub');
  assert.strictEqual(editorialHub.action.blueprint.visualGrammar.id, 'editorial-content-hub');
  assert.strictEqual(editorialHub.action.blueprint.coverageContract.status, 'passed');
  const editorialPage = editorialHub.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  assert.ok(editorialPage.includes('data-visual-grammar="editorial-content-hub"'));
  assert.ok(editorialPage.includes('Editorias'));
  assert.ok(editorialPage.includes('Artigos recentes'));
  assert.ok(editorialPage.includes('Assinar newsletter'));
  assert.ok(editorialPage.includes('blogPosts.map'));
  assert.strictEqual(editorialPage.includes('Atendimento placeholder premium'), false);

  const legalNext = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-lawyer' },
    userMessage: 'criar site institucional em Next.js com React e Tailwind para advogado empresarial usando placeholders',
    contextText: 'conversa antiga sobre dentista e Clínica Sorriso',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(legalNext.ok, true);
  const legalPage = legalNext.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  const legalLayout = legalNext.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  assert.ok(legalLayout.includes('Escritório Faber Advocacia'));
  assert.ok(legalPage.includes('advocacia'));
  assert.ok(legalPage.includes('consulta jurídica'));
  assert.ok(legalPage.includes('serviceIcons'));
  assert.ok(legalPage.includes('"scale"'));
  assert.strictEqual(legalPage.includes('Clínica Sorriso'), false);

  const contextualLamp = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-context-lamp' },
    userMessage: 'faz com placeholders',
    contextText: 'Pedido consolidado: criar site institucional em LAMP para advogado.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    force: true,
  });
  assert.deepStrictEqual(contextualLamp.action.operations.map((operation) => operation.path), [
    'index.php',
    'style.css',
    'script.js',
  ]);
  assert.ok(contextualLamp.action.operations.find((operation) => operation.path === 'index.php').content.includes('advocacia'));
  assert.ok(contextualLamp.action.operations.find((operation) => operation.path === 'index.php').content.includes('service-icon'));

  assert.strictEqual(service.hasRequiredProjectBlueprintFiles({
    operations: next.action.operations,
    userMessage: 'Next.js com Tailwind',
  }), true);

  const figmaSpecific = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-figma' },
    userMessage: 'criar página institucional em Next.js seguindo este Figma específico com Tailwind',
    attachments: [{ name: 'layout.png' }],
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(figmaSpecific, null);
  assert.strictEqual(service.shouldPreferProjectBlueprint({
    userMessage: 'criar página institucional em Next.js seguindo este Figma específico com Tailwind',
    attachments: [{ name: 'layout.png' }],
    executionIntent: 'init_project',
  }), false);
  const paletteOnlyWorkingBrief = workingBriefService.buildWorkingBrief({
    projectInfo: { rootPath: '/tmp/faber-palette-only', files: [], totalFiles: 0 },
    userMessage:
      'Oi, quero criar um site de múltiplas páginas para uma escola de gestão consciente, estou anexando um arquivo com a paleta de cores da marca',
    attachments: [{ name: 'Screenshot 2026-05-28 at 19.03.20.png', type: 'image/png' }],
  });
  assert.strictEqual(service.shouldPreferProjectBlueprint({
    userMessage:
      'Oi, quero criar um site de múltiplas páginas para uma escola de gestão consciente, estou anexando um arquivo com a paleta de cores da marca',
    attachments: [{ name: 'Screenshot 2026-05-28 at 19.03.20.png', type: 'image/png' }],
    executionIntent: 'init_project',
    workingBrief: paletteOnlyWorkingBrief,
  }), true);
  assert.strictEqual(service.shouldPreferProjectBlueprint({
    userMessage: [
      'Quero criar um site em next.js, com react e tailwind.',
      'O site é para um advogado, quero azul e branco, mas pode sugerir o design system.',
      'Use tudo em placeholder e depois ajusto quando tiver algo para visualizar.',
    ].join(' '),
    attachments: [],
    executionIntent: 'init_project',
  }), true);
  assert.strictEqual(service.shouldPreferProjectBlueprint({
    userMessage: 'criar site em Next.js seguindo o design system existente de referência',
    attachments: [],
    executionIntent: 'init_project',
  }), false);
  assert.strictEqual(service.shouldUseProjectBlueprintFallback({
    userMessage: 'criar página institucional em Next.js seguindo este Figma específico com Tailwind',
    attachments: [{ name: 'layout.png' }],
    executionIntent: 'init_project',
  }), false);

  assert.ok(generatedBlueprints.length >= 20, 'project blueprint suite should exercise all current Next blueprint families');
  generatedBlueprints.forEach(({ label, result }) => assertResponsiveNavigationContract(result, label));

  const invalidHeaderOperations = next.action.operations.map((operation) => operation.path === 'app/page.tsx'
    ? {
        ...operation,
        content: operation.content
          .replace(/lg:hidden/g, 'md:hidden')
          .replace(/lg:flex/g, 'md:flex'),
      }
    : operation);
  const invalidHeaderValidation = validateProjectBlueprintContract({
    stack: 'next-tailwind',
    operations: invalidHeaderOperations,
    moduleContract: next.action.blueprint.moduleContract,
    coverageContract: next.action.blueprint.coverageContract,
  });
  assert.strictEqual(invalidHeaderValidation.ok, false);
  assert.strictEqual(invalidHeaderValidation.gate, 'block');
  assert.ok(invalidHeaderValidation.issues.some((issue) => issue.id === 'responsive_header_invalid'));

  const tremnBriefing = [
    'Criar um novo projeto web estático institucional para Tremn — Escola de Gestão Consciente.',
    'Importante: este projeto não é SaaS, não é dashboard, não é CRM, não é landing page de software, não é consultoria genérica e não deve usar conteúdo de projetos anteriores.',
    'O visitante deve entender o que é a Escola, por que ela existe, para quem ela é, quais são suas premissas, como funciona a jornada e como entrar em contato.',
    'Páginas obrigatórias: Início, A Escola, Premissas, Jornada, Conteúdos e Contato.',
    'Header desktop: logo à esquerda, links Início, A Escola, Premissas, Jornada, Conteúdos, Contato e botão Quero conhecer.',
    'Mobile: menu hambúrguer em tela cheia com fundo Pantone P 179-16 C, links grandes e botão em dourado.',
    'Home: hero com título "Uma nova consciência para uma nova forma de gerir.", botões Conheça a Escola e Ver premissas, As 5 premissas e chamada final.',
    'Premissas: Ir além da mera existência; Crenças e conhecimentos são degraus; A verdadeira transformação é interna; Responsabilidade é consciência em ação; Novos níveis de consciência criam novas soluções.',
    'Jornada: Perceber, Questionar, Interiorizar, Responsabilizar-se, Transformar.',
    'Conteúdos: artigos/reflexões sobre liderança consciente, autoconhecimento, sustentabilidade, cultura organizacional, futuro do trabalho, tecnologia e humanidade.',
    'Contato: formulário com Nome, E-mail, WhatsApp, Empresa, Cargo, Interesse e Mensagem.',
    'Cores obrigatórias e únicas: Pantone P 14-16 C, P 10-7 C, Pantone P 20-2 C, Pantone P 179-16 C e Pantone P 1-1 C.',
    'Tipografias obrigatórias: Assistant para títulos e Inter para textos.',
    'Não usar Dashboard executivo, Pipeline de trabalho, Automação de rotinas, Serviços, Depoimentos ou Agendar demo.',
  ].join(' ');
  const tremnWorkingBrief = workingBriefService.buildWorkingBrief({
    projectInfo: { rootPath: '/tmp/faber-tremn', files: [], totalFiles: 0 },
    userMessage: tremnBriefing,
    contextText: 'tentativa antiga: SaaS operacional para equipes, Dashboard executivo, Pipeline de trabalho e Agendar demo.',
  });
  const tremnSite = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-tremn' },
    userMessage: tremnBriefing,
    contextText: 'tentativa antiga: SaaS operacional para equipes, Dashboard executivo, Pipeline de trabalho e Agendar demo.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    workingBrief: tremnWorkingBrief,
    force: true,
  });
  assert.strictEqual(tremnSite.ok, true);
  assert.strictEqual(tremnSite.raw, 'project_blueprint:static-web');
  assert.deepStrictEqual(tremnSite.action.operations.map((operation) => operation.path), [
    'index.html',
    'a-escola.html',
    'premissas.html',
    'jornada.html',
    'conteudos.html',
    'contato.html',
    'style.css',
    'script.js',
  ]);
  assert.strictEqual(tremnSite.action.blueprint.briefingContract.domain, 'temporary-tremn-escola-de-gestao-consciente');
  const tremnTempCheck = tremnSite.action.blueprint.contractValidation.checks.find((check) => check.id === 'temporary_blueprint_contract');
  assert.strictEqual(tremnTempCheck.status, 'passed');
  assert.deepStrictEqual(tremnTempCheck.requiredPages, ['/', '/a-escola', '/premissas', '/jornada', '/conteudos', '/contato']);
  const tremnIndex = readOperation(tremnSite, 'index.html');
  const tremnCss = readOperation(tremnSite, 'style.css');
  const tremnAllContent = tremnSite.action.operations.map((operation) => operation.content || '').join('\n');
  assert.ok(tremnIndex.includes('Uma nova consciência para uma nova forma de gerir.'));
  assert.ok(tremnIndex.includes('Conheça a Escola'));
  assert.ok(tremnIndex.includes('Ver premissas'));
  assert.ok(tremnIndex.includes('A Escola'));
  assert.ok(readOperation(tremnSite, 'a-escola.html').includes('O mundo mudou. A gestão também precisa mudar.'));
  assert.ok(readOperation(tremnSite, 'premissas.html').includes('Responsabilidade é consciência em ação'));
  assert.ok(readOperation(tremnSite, 'jornada.html').includes('Perceber'));
  assert.ok(readOperation(tremnSite, 'conteudos.html').includes('Reflexões para uma nova gestão'));
  assert.ok(readOperation(tremnSite, 'contato.html').includes('Vamos conversar sobre uma nova forma de gerir?'));
  assert.ok(tremnCss.includes('family=Assistant'));
  assert.ok(tremnCss.includes('family=Inter'));
  assert.ok(tremnCss.includes('--accent: #f0be43;'));
  assert.ok(tremnCss.includes('--ink: #2d2a29;'));
  assert.ok(tremnCss.includes('--bg: #f8f7f2;'));
  assert.ok(tremnCss.includes('--muted: rgba(45, 42, 41, 0.72);'));
  assert.ok(tremnCss.includes('color: var(--bg);'));
  assert.ok(tremnCss.includes('html { scroll-behavior: smooth; overflow-x: hidden; }'));
  assert.ok(tremnCss.includes('.brand { flex: 1 1 auto;'));
  assert.ok(tremnCss.includes('overflow-wrap: anywhere;'));
  assert.ok(tremnCss.includes('.menu-toggle { display: none; flex: 0 0 44px;'));
  assert.ok(tremnCss.includes('.section, .inner-hero { max-width: 100%; padding-left: 24px; padding-right: 24px; }'));
  assert.ok(tremnCss.includes('.inner-hero h1, .section h2 { font-size: clamp(30px, 8.4vw, 34px); line-height: 1.12; overflow-wrap: anywhere; }'));
  assert.ok(tremnCss.includes('.categories span { flex: 1 1 100%; text-align: center; }'));
  assert.strictEqual(/#fff\b|255,255,255|#66706d|100,36,46/.test(tremnCss), false);
  assert.ok(tremnAllContent.includes("document.body.classList.toggle('menu-open', open);"));
  assert.ok(tremnAllContent.includes("document.body.classList.remove('menu-open');"));
  assert.strictEqual(/SaaS operacional|Dashboard executivo|Pipeline de trabalho|Automação de rotinas|Agendar demo|Serviços|Depoimentos/.test(tremnAllContent), false);

  const stackRegistry = createStackRegistryService({
    pluginProfiles: [
      {
        id: 'astro',
        label: 'Astro',
        aliases: ['astro'],
        detect: {
          packageDependencies: ['astro'],
          fileExtensions: ['.astro'],
        },
        blueprint: {
          targetFile: 'src/pages/index.astro',
          requiredFiles: ['package.json', 'src/pages/index.astro'],
          promptGuidance: ['Para Astro, gerar package.json e src/pages/index.astro como baseline inicial.'],
          operations: [
            {
              op: 'write_file',
              path: 'package.json',
              content: '{\n  "private": true,\n  "name": "{{brandSlug}}",\n  "scripts": { "dev": "astro dev", "build": "astro build" },\n  "dependencies": { "astro": "^5.0.0" }\n}\n',
            },
            {
              op: 'write_file',
              path: 'src/pages/index.astro',
              content: '---\nconst brand = {{brandJson}};\n---\n<main><h1>{brand}</h1><p>Placeholder institucional Astro.</p></main>\n',
            },
            {
              op: 'write_file',
              path: '../unsafe.txt',
              content: 'nao deve entrar',
            },
          ],
        },
      },
    ],
  });
  const pluginService = createProjectBlueprintService({ stackRegistry });
  const astro = pluginService.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-astro' },
    userMessage: 'criar site institucional em Astro com placeholders',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });

  assert.strictEqual(astro.ok, true);
  assert.strictEqual(astro.raw, 'project_blueprint:astro');
  assert.strictEqual(astro.action.targetFile, 'src/pages/index.astro');
  assert.deepStrictEqual(astro.action.operations.map((operation) => operation.path), [
    'package.json',
    'src/pages/index.astro',
  ]);
  assert.ok(astro.action.operations.find((operation) => operation.path === 'package.json').content.includes('"name": "faber-projeto"'));
  assert.strictEqual(pluginService.hasRequiredProjectBlueprintFiles({
    operations: astro.action.operations,
    userMessage: 'site institucional em Astro',
  }), true);
  assert.ok(pluginService.buildProjectBlueprintPromptGuidance({
    userMessage: 'site institucional em Astro com placeholders',
    executionIntent: 'init_project',
  }).includes('Para Astro'));

  console.log('project-blueprint-service.test.js: ok');
}

run();
