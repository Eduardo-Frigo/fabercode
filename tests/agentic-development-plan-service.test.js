const assert = require('assert');

const {
  buildAgenticDevelopmentPlan,
  inferPlanTraits,
} = require('../cortex/orchestration/agentic_development_plan_service');

const projectGraph = {
  version: 1,
  summary: { issues: 3, missingStoreMembers: 1, incompletePersistence: 2 },
  persistence: {
    required: true,
    signals: ['prisma_schema', 'postgres_provider'],
    missing: ['docker_compose', 'db_check'],
  },
  issues: [
    {
      id: 'missing_store_contract_member',
      file: 'app/page.tsx',
      relatedFile: 'src/store/mrp_store.ts',
      detail: 'app/page.tsx usa store.snapshot, mas src/store/mrp_store.ts nao declara snapshot.',
    },
  ],
};

const traits = inferPlanTraits({
  userMessage: 'Corrija erro runtime e implemente Postgres real com Prisma.',
  executionIntent: 'diagnostic_repair',
  projectGraph,
});
assert.strictEqual(traits.persistenceRequired, true);
assert.strictEqual(traits.repairMode, true);
assert.strictEqual(traits.graphIssueCount, 3);

const plan = buildAgenticDevelopmentPlan({
  userMessage:
    'Repare o app atual com Postgres, Prisma, Playwright, smoke visual e persistencia apos reload.',
  executionIntent: 'diagnostic_repair',
  acceptanceMatrix: {
    items: [
      { criterion: 'Build deve passar.' },
      { criterion: 'Persistencia deve sobreviver ao reload.' },
    ],
  },
  projectGraph,
});

assert.strictEqual(plan.version, 1);
assert.strictEqual(plan.mode, 'diagnostic_repair');
assert.ok(plan.architecture.boundaries.includes('server/API/persistence'));
assert.ok(plan.architecture.dataFlow.includes('PrismaClient'));
assert.ok(plan.stages.some((stage) => stage.id === 'observe_contracts'));
assert.ok(plan.stages.some((stage) => stage.id === 'patch_contracts_first'));
assert.ok(plan.stages.some((stage) => stage.id === 'real_persistence_gate'));
assert.ok(plan.stages.some((stage) => stage.id === 'browser_evidence'));
assert.ok(plan.stages.some((stage) => stage.validation.includes('rollback_on_failure')));
assert.strictEqual(plan.acceptanceItems.length, 2);
assert.strictEqual(plan.graphIssues[0].id, 'missing_store_contract_member');

const realtimePlan = buildAgenticDevelopmentPlan({
  userMessage: 'Crie editor colaborativo em tempo real com websocket e multiplas abas.',
  executionIntent: 'init_project',
});
assert.ok(realtimePlan.stages.some((stage) => stage.id === 'realtime_runtime'));

console.log('agentic-development-plan-service.test.js: ok');
