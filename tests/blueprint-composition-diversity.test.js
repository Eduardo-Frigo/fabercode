const assert = require('assert');

const {
  createProjectBlueprintService,
} = require('../cortex/orchestration/project_blueprint_service');
const {
  VISUAL_GRAMMAR_CONTRACTS,
} = require('../cortex/orchestration/project_blueprint_visual_grammar');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

function readOperation(result, relPath) {
  return (result.action.operations.find((operation) => operation.path === relPath) || {}).content || '';
}

function dataHero(label = 'Faber visual smoke') {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000">',
    '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">',
    '<stop offset="0" stop-color="#07111f"/><stop offset="0.55" stop-color="#24506f"/><stop offset="1" stop-color="#c6a15b"/>',
    '</linearGradient></defs>',
    '<rect width="1600" height="1000" fill="url(#g)"/>',
    '<circle cx="1080" cy="350" r="260" fill="#ffffff" opacity="0.18"/>',
    '<rect x="900" y="190" width="360" height="520" rx="22" fill="#ffffff" opacity="0.16"/>',
    `<text x="900" y="800" fill="#fff" font-family="Inter,Arial" font-size="44" font-weight="800">${label}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function buildBlueprint(service, scenario) {
  return service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: `/tmp/faber-composition-${scenario.id}` },
    userMessage: scenario.userMessage,
    contextText: scenario.contextText || '',
    executionIntent: 'init_project',
    force: true,
    buildOperationBatchDiffPreview,
    mediaAssets: scenario.mediaAssets || {},
  });
}

function assertIncludesAll(content, markers, label) {
  for (const marker of markers) {
    assert.ok(content.includes(marker), `${label}: expected composition marker ${marker}`);
  }
}

function run() {
  const service = createProjectBlueprintService();
  const scenarios = [
    {
      id: 'default_editorial_split',
      composition: 'default-editorial-split',
      expectedGrammar: 'modular-editorial-default',
      userMessage: [
        'Criar site institucional em Next.js para consultoria estrategica.',
        'Usar estrutura profissional, servicos, metodo, depoimentos, FAQ e contato.',
      ].join(' '),
      markers: [
        'data-visual-grammar="modular-editorial-default"',
        'const fullBleedHero = layoutVariant ===',
        'services.map',
        'methodSteps.map',
      ],
    },
    {
      id: 'generic_full_bleed_top',
      composition: 'generic-full-bleed-top-media',
      expectedGrammar: 'sensory-immersive-story',
      expectedHero: 'full-bleed-media',
      userMessage: [
        'Criar landing page em Next.js para escritorio de propriedade intelectual.',
        'Hero com imagem full width no topo, marcas, patentes, protecao internacional, metodo e contato.',
      ].join(' '),
      mediaAssets: {
        hero: {
          kind: 'photo',
          provider: 'local-smoke',
          query: 'intellectual property office',
          src: dataHero('Propriedade intelectual'),
          alt: 'Composicao visual full width de propriedade intelectual',
          attribution: 'Imagem sintetica de smoke',
        },
      },
      markers: [
        'data-visual-grammar="sensory-immersive-story"',
        'relative isolate min-h-[84vh]',
        'absolute inset-0 z-0 h-full w-full object-cover',
        'absolute inset-0 z-[1] bg-[rgba(12,18,24,0.64)]',
        'max-w-xs break-words text-lg leading-8 text-white/80',
        'grid max-w-xs gap-3 sm:flex',
        'fixed bottom-5 left-5 right-5',
      ],
    },
    {
      id: 'consumer_product_mosaic',
      composition: 'commerce-product-mosaic',
      expectedGrammar: 'consumer-product-mosaic',
      userMessage: [
        'Criar landing page em Next.js para VitraPure, garrafas de vidro sustentaveis.',
        'Mostrar beneficios, modelos, sustentabilidade, depoimentos, FAQ e compra por contato.',
      ].join(' '),
      markers: [
        'data-visual-grammar="consumer-product-mosaic"',
        "href: '#beneficios'",
        "href: '#loja'",
        'border-l-4 border-[var(--color-accent)]',
        'lg:grid-cols-3',
      ],
    },
    {
      id: 'technical_b2b_systems',
      composition: 'technical-command-matrix',
      expectedGrammar: 'technical-b2b-systems',
      userMessage: [
        'Criar site em Next.js para Alumivance Esquadrias e Fachadas.',
        'Empresa tecnica B2B de esquadrias, fachadas em ACM, projetos, calculadora de orcamento, processo e contato.',
      ].join(' '),
      markers: [
        'data-visual-grammar="technical-b2b-systems"',
        "const servicesRoute = '/solucoes'",
        "const calculatorRoute = '/calculadora'",
        'lg:grid-cols-[0.64fr_1.36fr]',
        'Matriz técnica',
      ],
    },
    {
      id: 'wine_sensory_cellar',
      composition: 'wine-cellar-split',
      expectedGrammar: 'wine-sensory-cellar',
      userMessage: [
        'Criar landing page em Next.js para Aurora di Vento, vinhos premium.',
        'Mostrar origem, rotulos, harmonizacao, oferta, degustacao, FAQ e formulario VIP.',
      ].join(' '),
      markers: [
        'data-visual-grammar="wine-sensory-cellar"',
        "href: '#harmonizacao'",
        'aspect-[4/5] w-full object-cover md:aspect-[5/4]',
        'Origem',
      ],
    },
    {
      id: 'construction_retail_yard',
      composition: 'construction-retail-yard',
      expectedGrammar: 'construction-retail-yard',
      userMessage: [
        'Criar site em Next.js para Constrular Prime, loja de materiais de construcao.',
        'Mostrar produtos, servicos, orcamento por lista, entrega, blog, FAQ e contato.',
      ].join(' '),
      markers: [
        'data-visual-grammar="construction-retail-yard"',
        'ctaLabel="Enviar lista"',
        'md:grid-cols-2 lg:grid-cols-5',
        'Abrir produtos',
      ],
    },
    {
      id: 'editorial_portfolio_statement',
      composition: 'editorial-portfolio-statement-grid',
      expectedGrammar: 'editorial-portfolio-statement',
      userMessage: [
        'Criar site em Next.js para Linea Bosco Revestimentos em madeira.',
        'Precisa de portfolio, galeria, materiais, processo, projetos selecionados e contato.',
      ].join(' '),
      markers: [
        'data-visual-grammar="editorial-portfolio-statement"',
        'md:grid-cols-[0.95fr_1.05fr]',
        'routeHref(portfolioRoute)',
        'galleryItems.map',
      ],
    },
    {
      id: 'atelier_catalog_studio',
      composition: 'atelier-catalog-studio',
      expectedGrammar: 'atelier-catalog-studio',
      userMessage: [
        'Quero criar uma landing page em Next.js para uma empresa que vende artefatos de couro, como bolsas e pastas.',
        'As cores da marca sao vermelho marsala e um tom claro de apoio quase branco, amarelo alaranjado.',
        'Quero conteudo sobre qualidade, longevidade do couro e producao artesanal, com visual europeu.',
        'Use placeholders e depois ajusto.',
      ].join(' '),
      markers: [
        'data-visual-grammar="atelier-catalog-studio"',
        "href: '#colecoes'",
        "href: '#materiais'",
        'md:grid-cols-[0.72fr_1.28fr]',
        'Matéria-prima',
      ],
    },
    {
      id: 'agri_commercial_system',
      composition: 'agri-commercial-system',
      expectedGrammar: 'agri-commercial-system',
      userMessage: [
        'Crie um site completo de jardinagem com servicos de paisagismo, loja de produtos, blog educativo, galeria e contato.',
        'O conteudo deve falar de plantas internas, plantas para apartamento, vasos, substratos, fertilizantes e cuidados com plantas.',
      ].join(' '),
      markers: [
        'data-visual-grammar="agri-commercial-system"',
        "href={routeHref('/loja')}",
        'Imagem operacional pronta para cultivo, jardim ou campo.',
        'lg:grid-cols-[0.9fr_1.1fr]',
      ],
    },
    {
      id: 'trade_logistics_command',
      composition: 'trade-logistics-command-center',
      expectedGrammar: 'trade-logistics-command',
      userMessage: [
        'Criar landing page em Next.js para AtlasPort Importacoes.',
        'Servicos de importacao, fornecedores internacionais, custos, desembaraco aduaneiro, guias e cotacao.',
      ].join(' '),
      markers: [
        'data-visual-grammar="trade-logistics-command"',
        'Checklist de operação',
        'grid max-w-xs gap-3 sm:flex',
        'process.customs-timeline',
      ],
    },
    {
      id: 'saas_tool_workspace',
      composition: 'saas-dashboard-workspace',
      expectedGrammar: 'saas-tool-workspace',
      userMessage: [
        'Criar landing page em Next.js para NexaFlow Desk, ferramenta SaaS de processos e clientes.',
        'Mostrar produto, modulos, workflow, planos, prova social, FAQ e demo.',
      ].join(' '),
      markers: [
        'data-visual-grammar="saas-tool-workspace"',
        '<strong className="text-white">Workspace</strong>',
        'Dashboard executivo',
        'Pipeline de trabalho',
        'min-w-0 overflow-hidden rounded-lg',
      ],
    },
    {
      id: 'editorial_content_hub',
      composition: 'editorial-content-front-page',
      expectedGrammar: 'editorial-content-hub',
      userMessage: [
        'Criar portal editorial em Next.js para VoxLumen Revista.',
        'Mostrar destaques, editorias, artigos, rotina editorial, newsletter, prova e contato.',
      ].join(' '),
      markers: [
        'data-visual-grammar="editorial-content-hub"',
        'Edição atual',
        'md:col-span-2',
        "href: '/newsletter'",
      ],
    },
    {
      id: 'chocolate_full_bleed',
      composition: 'chocolate-immersive-full-screen',
      expectedGrammar: 'sensory-immersive-story',
      expectedHero: 'full-bleed-media',
      userMessage: [
        'Criar landing page em Next.js para chocolate artesanal premium e sensorial.',
        'Hero com video full width de chocolate derretendo, cacau, bombons, processo e chamada Comprar agora.',
      ].join(' '),
      mediaAssets: {
        hero: {
          kind: 'video',
          provider: 'pexels',
          query: 'artisan chocolate melting cocoa premium dessert',
          src: 'https://videos.pexels.com/video-files/chocolate-diversity-smoke.mp4',
          poster: 'https://images.pexels.com/photos/chocolate-diversity-smoke.jpeg',
          alt: 'Chocolate artesanal em movimento',
          attribution: 'Video de smoke no Pexels',
        },
      },
      markers: [
        'data-visual-grammar="sensory-immersive-story"',
        'tone="chocolate" position="fixed"',
        '<HeroMedia className="absolute inset-0 z-0 h-full w-full object-cover" />',
        'min-h-screen',
      ],
    },
  ];

  const results = scenarios.map((scenario) => {
    const result = buildBlueprint(service, scenario);
    assert.ok(result && result.ok, `${scenario.id}: blueprint should build`);
    assert.strictEqual(result.raw, 'project_blueprint:next-tailwind', `${scenario.id}: expected Next blueprint`);
    const blueprint = result.action.blueprint;
    const page = readOperation(result, 'app/page.tsx');
    assert.strictEqual(blueprint.visualGrammar.id, scenario.expectedGrammar, `${scenario.id}: visual grammar mismatch`);
    if (scenario.expectedHero) {
      assert.strictEqual(blueprint.layoutRecipe.hero, scenario.expectedHero, `${scenario.id}: hero contract mismatch`);
    }
    assertIncludesAll(page, scenario.markers, scenario.id);
    return {
      id: scenario.id,
      composition: scenario.composition,
      visualGrammar: blueprint.visualGrammar.id,
      hero: blueprint.layoutRecipe.hero,
      page,
    };
  });

  const requiredGrammarIds = Object.keys(VISUAL_GRAMMAR_CONTRACTS);
  const coveredGrammarIds = new Set(results.map((result) => result.visualGrammar));
  for (const grammarId of requiredGrammarIds) {
    assert.ok(coveredGrammarIds.has(grammarId), `missing visual grammar coverage: ${grammarId}`);
  }

  const compositionIds = new Set(results.map((result) => result.composition));
  assert.strictEqual(compositionIds.size, scenarios.length, 'each scenario must represent a distinct composition intent');
  assert.ok(results.some((result) => result.page.includes('absolute inset-0 z-0 h-full w-full object-cover')), 'matrix must include real top full-bleed hero media');
  assert.ok(results.some((result) => result.page.includes('dashboard-workspace-preview') || result.page.includes('Workspace</strong>')), 'matrix must include product workspace composition');
  assert.ok(results.some((result) => result.page.includes('operations-command-center') || result.page.includes('Checklist de operação')), 'matrix must include operational command composition');
  assert.ok(results.some((result) => result.page.includes('product-mosaic') || result.page.includes("href: '#loja'")), 'matrix must include commerce mosaic composition');

  console.log(`blueprint-composition-diversity.test.js: ok (${results.length} compositions, ${coveredGrammarIds.size} visual grammars)`);
}

run();
