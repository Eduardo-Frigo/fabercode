const assert = require('assert');

const {
  createApplicationMapRenderPlanService,
} = require('../main/services/application_map_render_plan_service');

function createReadyFixture() {
  return {
    mapData: {
      nodes: [
        {
          id: 'group-frontend',
          type: 'group',
          title: 'Frontend e design system',
          description: 'Tradeoffs de backend e stack, security com auth e CSP, marca e logo.',
        },
        {
          id: 'node-dashboard',
          parentId: 'group-frontend',
          type: 'screen',
          title: 'Dashboard principal',
          description: 'Fluxo principal do produto.',
        },
      ],
      edges: [],
    },
    documents: [
      {
        path: 'docs/application-map/README.md',
        content: 'Stack, decisões, frontend, backend, testes e deploy.',
      },
      {
        path: 'docs/application-map/security.md',
        content: 'Security, auth, CSP, HSTS e rate limiting.',
      },
      {
        path: 'docs/application-map/design.md',
        content: 'Brand, marca, logo, cores e tipografia.',
      },
    ],
    combinedText: 'Tradeoffs de frontend e backend. Security com auth. Brand, marca e design system.',
  };
}

function findMilestone(milestones, titleFragment) {
  return milestones.find((milestone) => String(milestone.title).includes(titleFragment));
}

function run() {
  const service = createApplicationMapRenderPlanService({ now: () => 1724000000000 });

  const incomplete = service.buildRenderPlan({
    mapData: { nodes: [], edges: [] },
    documents: [],
    combinedText: '',
  });
  assert.strictEqual(incomplete.ok, true);
  assert.strictEqual(incomplete.ready, false);
  assert.deepStrictEqual(incomplete.checks.map((check) => check.id), [
    'docs',
    'tradeoffs',
    'security',
    'branding',
  ]);
  assert.deepStrictEqual(incomplete.missing.map((check) => check.id), [
    'docs',
    'tradeoffs',
    'security',
    'branding',
  ]);
  assert.strictEqual(incomplete.milestones.length, 6);
  assert.strictEqual(incomplete.milestones[0].title, 'Fechar lacunas da documentação');
  assert.strictEqual(incomplete.milestones[0].tasks.length, 4);

  const readyFixture = createReadyFixture();
  const readySnapshot = JSON.stringify(readyFixture);
  const ready = service.buildRenderPlan({
    ...readyFixture,
    copy: {
      renderFoundationTitle: 'Localized foundation',
      renderNodesConsidered: 'Localized nodes: {items}.',
    },
  });
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.ready, true);
  assert.deepStrictEqual(ready.missing, []);
  assert.strictEqual(ready.milestones.length, 5);
  assert.strictEqual(ready.milestones[0].title, 'Localized foundation');
  assert.match(ready.milestones[0].notes, /^Localized nodes:/);
  assert.ok(
    ready.milestones.every((milestone) => Array.isArray(milestone.references)),
    'every generated milestone must carry an explicit references collection',
  );
  assert.ok(
    ready.milestones.some((milestone) => milestone.references.some((reference) => reference.path === 'docs/application-map/README.md')),
    'the plan must preserve document-path provenance',
  );
  assert.strictEqual(JSON.stringify(readyFixture), readySnapshot, 'planning must not mutate source context');

  const refinementFixture = createReadyFixture();
  refinementFixture.combinedText += [
    'Executar pentest OWASP e corrigir vulnerabilidades.',
    'Adicionar observabilidade e logs de erro em produção.',
    'Validar o fluxo com usuários reais em um beta test.',
  ].join(' ');
  const previousMilestones = [
    {
      id: 'existing-foundation',
      number: 1,
      title: 'Preparar fundação técnica do projeto',
      summary: 'Resumo anterior.',
      status: 'planned',
      tasks: [{ id: 'existing-task', title: 'Preservar tarefa manual', status: 'pending' }],
      references: [{ path: 'docs/application-map/manual.md' }],
    },
  ];
  const previousSnapshot = JSON.stringify(previousMilestones);
  const refined = service.buildRenderPlan({
    ...refinementFixture,
    previousMilestones,
    requestText: 'Adicionar uma etapa de liberação e lançamento do projeto.',
  });

  assert.strictEqual(refined.ok, true);
  assert.strictEqual(refined.ready, true);
  assert.ok(findMilestone(refined.milestones, 'pentest'));
  assert.ok(findMilestone(refined.milestones, 'usuários reais'));
  const foundation = findMilestone(refined.milestones, 'fundação técnica');
  assert.ok(foundation.tasks.some((task) => task.title === 'Preservar tarefa manual'));
  const backend = findMilestone(refined.milestones, 'backend, dados');
  assert.strictEqual(backend.changeMarker.count, 3);
  const delivery = findMilestone(refined.milestones, 'segurança, testes');
  assert.strictEqual(delivery.changeMarker.count, 2);
  const release = findMilestone(refined.milestones, 'liberação e lançamento');
  assert.ok(release);
  assert.strictEqual(release.id, 'render-milestone-manual-release-1724000000000');
  assert.deepStrictEqual(
    refined.milestones.map((milestone) => milestone.number),
    refined.milestones.map((_, index) => index + 1),
  );
  assert.strictEqual(JSON.stringify(previousMilestones), previousSnapshot, 'merge must not mutate the prior draft');

  const defensive = service.buildRenderPlan(null);
  assert.strictEqual(defensive.ok, true);
  assert.strictEqual(defensive.ready, false);
  assert.ok(Array.isArray(defensive.milestones));

  console.log('application-map-render-plan-service.test.js: ok');
}

run();
