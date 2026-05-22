const assert = require('assert');

const {
  BLUEPRINT_LAYOUT_PIECE_INVENTORY,
  createProjectBlueprintService,
} = require('../cortex/orchestration/project_blueprint_service');
const { findCssImportOrderViolation } = require('../cortex/orchestration/css_operation_safety');
const { createStackRegistryService } = require('../main/services/stack_registry_service');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

function run() {
  const service = createProjectBlueprintService();

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
  assert.strictEqual(mediaNext.action.blueprint.media.provider, 'pexels');

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
  assert.ok(ipFullWidthPage.includes('Áreas de atuação'));
  assert.ok(ipFullWidthPage.includes('Marcas'));
  assert.ok(ipFullWidthPage.includes('Patentes'));
  assert.ok(ipFullWidthPage.includes('Tecnologia e software'));
  assert.ok(ipFullWidthPage.includes('Método de trabalho'));
  assert.ok(ipFullWidthPage.includes('FAQ'));
  assert.ok(ipFullWidthPage.includes('absolute inset-0 z-0 h-full w-full object-cover'));
  assert.ok(ipFullWidthPage.includes('absolute inset-0 z-[1] bg-[rgba(12,18,24,0.64)]'));
  assert.ok(ipFullWidthPage.includes('relative z-10 mx-auto'));
  assert.ok(!ipFullWidthPage.includes('-z-20'));

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
