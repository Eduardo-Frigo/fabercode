const assert = require('assert');

const {
  createProjectBlueprintService,
} = require('../cortex/orchestration/project_blueprint_service');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

function readOperation(result, relPath) {
  return (result.action.operations.find((operation) => operation.path === relPath) || {}).content || '';
}

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildBlueprint(service, scenario) {
  return service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: `/tmp/faber-briefing-adaptability-${scenario.id}` },
    userMessage: scenario.userMessage,
    executionIntent: 'init_project',
    force: true,
    buildOperationBatchDiffPreview,
    mediaAssets: scenario.mediaAssets || {},
  });
}

function assertResponsivePrimitiveContract(page, label) {
  assert.ok(page.includes('data-blueprint-element="responsive-header"'), `${label}: missing responsive header`);
  assert.ok(page.includes('max-h-[calc(100vh-5rem)]'), `${label}: mobile/tablet menu must be height capped`);
  assert.ok(page.includes('overflow-y-auto'), `${label}: mobile/tablet menu must scroll when needed`);
  assert.ok(page.includes('lg:hidden'), `${label}: hamburger must stay active through tablet`);
  assert.ok(page.includes('lg:flex'), `${label}: desktop nav must start at lg`);
  assert.strictEqual(page.includes('md:hidden'), false, `${label}: header must not hide hamburger at tablet`);

  assert.ok(page.includes('<BlueprintIconBadge path='), `${label}: icon/module areas must use icon primitive`);
  assert.ok(page.includes('data-blueprint-element="icon-badge"'), `${label}: icon marker missing`);
  assert.ok(page.includes('<BlueprintTestimonialProof testimonials='), `${label}: proof section must use testimonial primitive`);
  assert.ok(page.includes('data-blueprint-element="testimonial-proof"'), `${label}: testimonial marker missing`);
  assert.ok(page.includes('<BlueprintFooterUtility brand='), `${label}: footer must use utility primitive`);
  assert.ok(page.includes('data-blueprint-element="footer-utility-grid"'), `${label}: footer marker missing`);
}

function assertScenario(result, scenario) {
  assert.ok(result && result.ok, `${scenario.id}: blueprint should build`);
  assert.strictEqual(result.raw, 'project_blueprint:next-tailwind', `${scenario.id}: should use Next/Tailwind blueprint`);

  const blueprint = result.action.blueprint;
  const page = readOperation(result, 'app/page.tsx');
  const normalizedPage = normalize(page);
  const coverage = blueprint.coverageContract && blueprint.coverageContract.evaluation
    ? blueprint.coverageContract.evaluation
    : {};

  assert.strictEqual(blueprint.contractValidation.ok, true, `${scenario.id}: blueprint contract should pass`);
  assert.ok((coverage.score || 0) >= 92, `${scenario.id}: coverage score should stay high`);
  assert.deepStrictEqual(coverage.missing || [], [], `${scenario.id}: required coverage should not be missing`);
  assert.strictEqual(blueprint.briefingContract.domain, scenario.expectedDomain, `${scenario.id}: unexpected domain`);
  assert.strictEqual(blueprint.layoutRecipe.id, scenario.expectedRecipe, `${scenario.id}: unexpected layout recipe`);
  assert.strictEqual(blueprint.visualGrammar.id, scenario.expectedGrammar, `${scenario.id}: unexpected visual grammar`);
  assertResponsivePrimitiveContract(page, scenario.id);

  assert.ok(page.includes(scenario.expectedBrand), `${scenario.id}: expected brand should be preserved`);
  assert.strictEqual(/unknown/i.test(page), false, `${scenario.id}: generated page must not expose unknown copy`);

  for (const term of scenario.requiredTerms || []) {
    assert.ok(normalizedPage.includes(normalize(term)), `${scenario.id}: expected briefing term "${term}"`);
  }
  for (const term of scenario.forbiddenTerms || []) {
    assert.strictEqual(normalizedPage.includes(normalize(term)), false, `${scenario.id}: forbidden stale term "${term}"`);
  }
}

function run() {
  const service = createProjectBlueprintService();
  const scenarios = [
    {
      id: 'consulting_services',
      expectedBrand: 'Prisma Norte Consultoria',
      expectedDomain: '',
      expectedRecipe: 'modular-starter',
      expectedGrammar: 'modular-editorial-default',
      userMessage: 'Criar site institucional em Next.js para Prisma Norte Consultoria, consultoria operacional com servicos, metodo, depoimentos, FAQ e contato.',
      requiredTerms: ['consultoria', 'serviços', 'depoimentos', 'contato'],
    },
    {
      id: 'architecture_portfolio',
      expectedBrand: 'Helena Duarte Arquitetura',
      expectedDomain: 'architecture',
      expectedRecipe: 'architecture-studio-site',
      expectedGrammar: 'editorial-portfolio-statement',
      userMessage: 'Criar site completo em Next.js para Helena Duarte Arquitetura, portfolio de projetos, sobre, servicos, processo, blog, contato e footer.',
      requiredTerms: ['arquitetura', 'projetos', 'processo'],
    },
    {
      id: 'intellectual_property',
      expectedBrand: 'Aurea IP & Patentes',
      expectedDomain: 'intellectual-property',
      expectedRecipe: 'modular-starter',
      expectedGrammar: 'modular-editorial-default',
      userMessage: 'Criar landing page em Next.js para Aurea IP & Patentes, escritorio de propriedade intelectual com marcas, patentes, INPI, busca de anterioridade, protecao internacional, contato e footer.',
      requiredTerms: ['propriedade intelectual', 'patentes', 'INPI'],
    },
    {
      id: 'wood_finishes',
      expectedBrand: 'Linea Bosco Revestimentos',
      expectedDomain: 'wood-finishes',
      expectedRecipe: 'modular-starter',
      expectedGrammar: 'editorial-portfolio-statement',
      userMessage: 'Criar site em Next.js para Linea Bosco Revestimentos, pisos de madeira, paineis ripados, decks, projetos, inspiracoes e contato.',
      requiredTerms: ['madeira', 'projetos', 'contato'],
    },
    {
      id: 'sustainable_product',
      expectedBrand: 'VitraPure',
      expectedDomain: 'sustainable-product-landing',
      expectedRecipe: 'consumer-product-catalog-landing',
      expectedGrammar: 'consumer-product-mosaic',
      userMessage: 'Criar landing page em Next.js para VitraPure, garrafas de vidro sustentaveis, beneficios, produtos, sustentabilidade, prova social, FAQ e comprar agora.',
      requiredTerms: ['garrafas', 'sustentabilidade', 'modelos'],
    },
    {
      id: 'technical_b2b',
      expectedBrand: 'Alumivance Esquadrias e Fachadas',
      expectedDomain: 'technical-b2b-services-site',
      expectedRecipe: 'technical-b2b-lead-site',
      expectedGrammar: 'technical-b2b-systems',
      userMessage: 'Criar site em Next.js para Alumivance Esquadrias e Fachadas, esquadrias de aluminio, fachadas ACM, calculadora, processo, projetos e contato.',
      requiredTerms: ['esquadrias', 'fachadas', 'processo'],
    },
    {
      id: 'premium_wine',
      expectedBrand: 'Aurora di Vento',
      expectedDomain: 'premium-wine-landing',
      expectedRecipe: 'wine-sensory-landing',
      expectedGrammar: 'wine-sensory-cellar',
      userMessage: 'Criar landing page em Next.js para Aurora di Vento, vinhos artesanais premium com origem, rotulos, harmonizacao, degustacao, oferta e formulario VIP.',
      requiredTerms: ['vinhos', 'harmonização', 'degustação'],
    },
    {
      id: 'construction_store',
      expectedBrand: 'Constrular Prime',
      expectedDomain: 'construction-materials-site',
      expectedRecipe: 'construction-materials-store-site',
      expectedGrammar: 'construction-retail-yard',
      userMessage: 'Criar site em Next.js para Constrular Prime, loja de materiais de construcao com produtos, orcamento por lista, entrega, blog, FAQ e contato.',
      requiredTerms: ['materiais de construção', 'orçamento', 'produtos'],
    },
    {
      id: 'saas_workspace',
      expectedBrand: 'NexaFlow Desk',
      expectedDomain: 'saas-tool',
      expectedRecipe: 'saas-tool-landing',
      expectedGrammar: 'saas-tool-workspace',
      userMessage: 'Criar landing page em Next.js para NexaFlow Desk, SaaS operacional para equipes com dashboard, modulos, workflow, planos, prova social, FAQ e demo.',
      requiredTerms: ['dashboard', 'workflow', 'planos'],
    },
    {
      id: 'editorial_hub',
      expectedBrand: 'VoxLumen Revista',
      expectedDomain: 'editorial-content',
      expectedRecipe: 'editorial-content-hub',
      expectedGrammar: 'editorial-content-hub',
      userMessage: 'Criar portal editorial em Next.js para VoxLumen Revista com editorias, destaques, artigos, newsletter, prova social e contato.',
      requiredTerms: ['artigos', 'newsletter', 'editorias'],
    },
    {
      id: 'chocolate_sensory',
      expectedBrand: 'Cacau Nobre Atelier',
      expectedDomain: 'chocolate',
      expectedRecipe: 'sensory-chocolate-landing',
      expectedGrammar: 'sensory-immersive-story',
      userMessage: 'Criar landing page em Next.js para Cacau Nobre Atelier, chocolate artesanal premium com hero full width, sabores, processo, depoimentos, FAQ e comprar agora. A conversa antiga falava de bolsas de couro, mas este briefing atual e chocolate.',
      requiredTerms: ['chocolate', 'cacau', 'comprar agora'],
      forbiddenTerms: ['bolsas de couro'],
    },
    {
      id: 'trade_imports',
      expectedBrand: 'AtlasPort Importações',
      expectedDomain: 'import-services',
      expectedRecipe: 'import-service-landing',
      expectedGrammar: 'trade-logistics-command',
      userMessage: 'Criar landing page em Next.js para AtlasPort Importações, serviços de importação, fornecedores internacionais, desembaraço aduaneiro, guias, cotação e formulário.',
      requiredTerms: ['importação', 'cotação', 'fornecedores'],
    },
    {
      id: 'photo_lab',
      expectedBrand: 'Lumen Lab Fotográfico',
      expectedDomain: 'photo-lab',
      expectedRecipe: 'photographic-lab-site',
      expectedGrammar: 'sensory-immersive-story',
      userMessage: 'Criar site em Next.js para Lumen Lab Fotográfico, laboratório de revelação, digitalização de negativos, impressão fine art, restauração, portfolio e contato.',
      requiredTerms: ['digitalização', 'fine art', 'restauração'],
    },
    {
      id: 'garden_commerce',
      expectedBrand: 'Jardim Vivo',
      expectedDomain: 'gardening',
      expectedRecipe: 'garden-service-commerce',
      expectedGrammar: 'agri-commercial-system',
      userMessage: 'Criar site completo em Next.js para Jardim Vivo, jardinagem, paisagismo, loja de plantas, blog educativo, galeria e contato.',
      requiredTerms: ['jardinagem', 'plantas', 'galeria'],
    },
    {
      id: 'leather_atelier',
      expectedBrand: 'Couro Alto Atelier',
      expectedDomain: 'leather-goods',
      expectedRecipe: 'artisan-commerce',
      expectedGrammar: 'atelier-catalog-studio',
      userMessage: 'Criar landing page em Next.js para Couro Alto Atelier, artefatos de couro, bolsas, pastas, produção artesanal, qualidade, longevidade e contato.',
      requiredTerms: ['couro', 'bolsas', 'artesanal'],
    },
    {
      id: 'wood_sculpture',
      expectedBrand: 'Ateliê Madeira Viva',
      expectedDomain: 'wood-sculpture',
      expectedRecipe: 'wood-sculpture-atelier',
      expectedGrammar: 'modular-editorial-default',
      userMessage: 'Criar site em Next.js para Ateliê Madeira Viva, esculturas em madeira, obras autorais, processo, galeria, vídeo hero e contato.',
      requiredTerms: ['esculturas', 'madeira', 'obras'],
    },
    {
      id: 'veterinary_clinic',
      expectedBrand: 'Clínica Faber Vet',
      expectedDomain: 'veterinary',
      expectedRecipe: 'modular-starter',
      expectedGrammar: 'modular-editorial-default',
      userMessage: 'Criar site em Next.js para Clínica Faber Vet, veterinária com consultas, vacinas, banho e tosa, emergências, depoimentos e agendamento.',
      requiredTerms: ['veterinária', 'vacinas', 'agendamento'],
    },
    {
      id: 'dental_clinic',
      expectedBrand: 'Clínica Sorriso',
      expectedDomain: 'dental',
      expectedRecipe: 'modular-starter',
      expectedGrammar: 'modular-editorial-default',
      userMessage: 'Criar landing page em Next.js para Clínica Sorriso, odontologia estética, implantes, clareamento, avaliações, depoimentos e agendamento.',
      requiredTerms: ['odontologia', 'implantes', 'agendamento'],
    },
  ];

  const results = scenarios.map((scenario) => {
    const result = buildBlueprint(service, scenario);
    assertScenario(result, scenario);
    return {
      recipe: result.action.blueprint.layoutRecipe.id,
      grammar: result.action.blueprint.visualGrammar.id,
    };
  });

  const uniqueRecipes = new Set(results.map((result) => result.recipe));
  const uniqueGrammars = new Set(results.map((result) => result.grammar));
  assert.ok(uniqueRecipes.size >= 12, `expected broad recipe diversity, got ${uniqueRecipes.size}`);
  assert.ok(uniqueGrammars.size >= 10, `expected broad visual grammar diversity, got ${uniqueGrammars.size}`);

  console.log(`blueprint-briefing-adaptability.test.js: ok (${scenarios.length} briefings, ${uniqueRecipes.size} recipes, ${uniqueGrammars.size} visual grammars)`);
}

run();
