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

function buildBlueprint(service, scenario) {
  return service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: `/tmp/faber-element-system-${scenario.id}` },
    userMessage: scenario.userMessage,
    executionIntent: 'init_project',
    force: true,
    buildOperationBatchDiffPreview,
    mediaAssets: scenario.mediaAssets || {},
  });
}

function assertElementSystem(page, label) {
  assert.ok(page.includes('data-blueprint-element="responsive-header"'), `${label}: missing responsive header element marker`);
  assert.ok(page.includes('max-w-[calc(100vw-7.5rem)]'), `${label}: brand must reserve mobile hamburger space`);
  assert.ok(page.includes('max-h-[calc(100vh-5rem)]'), `${label}: mobile menu must cap height`);
  assert.ok(page.includes('overflow-y-auto'), `${label}: mobile menu must scroll safely`);
  assert.ok(page.includes('lg:hidden'), `${label}: hamburger must stay active through tablet`);
  assert.ok(page.includes('lg:flex'), `${label}: desktop nav must start at lg`);
  assert.strictEqual(page.includes('md:hidden'), false, `${label}: header must not switch at tablet width`);

  assert.ok(page.includes('<BlueprintIconBadge path='), `${label}: services/modules must use icon badge composition`);
  assert.ok(page.includes('data-blueprint-element="icon-badge"'), `${label}: icon badge primitive must be present`);
  assert.ok(page.includes('h-12 w-12'), `${label}: icons must have stable touch/visual dimensions`);

  assert.ok(page.includes('<BlueprintTestimonialProof testimonials='), `${label}: testimonials must use proof component`);
  assert.ok(page.includes('data-blueprint-element="testimonial-proof"'), `${label}: testimonial proof primitive must be present`);
  assert.ok(page.includes('md:col-span-2'), `${label}: testimonial layout must include featured proof on tablet/desktop`);

  assert.ok(page.includes('<BlueprintFooterUtility brand='), `${label}: footer must use utility grid component`);
  assert.ok(page.includes('data-blueprint-element="footer-utility-grid"'), `${label}: footer utility primitive must be present`);
  assert.ok(page.includes('md:grid-cols-[1.15fr_0.85fr]'), `${label}: footer must have tablet layout`);
  assert.ok(page.includes('lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]'), `${label}: footer must expand on desktop`);
}

function run() {
  const service = createProjectBlueprintService();
  const scenarios = [
    {
      id: 'generic',
      userMessage: 'Criar site institucional em Next.js para consultoria com servicos, icones, depoimentos, FAQ, contato e footer.',
    },
    {
      id: 'consumer-product',
      userMessage: 'Criar landing page em Next.js para garrafas de vidro sustentaveis com beneficios, produtos, prova social, FAQ e compra por contato.',
    },
    {
      id: 'trade-logistics',
      userMessage: 'Criar landing page em Next.js para importacoes com servicos, processo, guias, depoimentos, FAQ, formulario e footer.',
    },
    {
      id: 'saas-workspace',
      userMessage: 'Criar landing page em Next.js para SaaS de processos com dashboard, modulos, workflow, planos, depoimentos, FAQ e demo.',
    },
    {
      id: 'chocolate',
      userMessage: 'Criar landing page em Next.js para chocolate artesanal premium com hero full width, sabores, processo, depoimentos, FAQ e contato.',
      mediaAssets: {
        hero: {
          kind: 'photo',
          provider: 'local-smoke',
          query: 'artisan chocolate',
          src: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%201200%20800%22%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22%233b1f14%22/%3E%3C/svg%3E',
          alt: 'Chocolate artesanal',
        },
      },
    },
    {
      id: 'wine',
      userMessage: 'Criar landing page em Next.js para vinho premium com origem, rotulos, harmonizacao, depoimentos, oferta, FAQ e formulario.',
    },
  ];

  for (const scenario of scenarios) {
    const result = buildBlueprint(service, scenario);
    assert.ok(result && result.ok, `${scenario.id}: blueprint should build`);
    assert.strictEqual(result.raw, 'project_blueprint:next-tailwind', `${scenario.id}: expected Next blueprint`);
    assertElementSystem(readOperation(result, 'app/page.tsx'), scenario.id);
  }

  console.log(`blueprint-element-system.test.js: ok (${scenarios.length} element systems)`);
}

run();
