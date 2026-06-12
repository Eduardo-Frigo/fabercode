const assert = require('assert');

const {
  buildAcceptanceMatrixFromBriefing,
  buildEvidenceForCriterion,
  needsPersistenceEvidence,
} = require('../cortex/orchestration/acceptance_matrix_service');

function run() {
  assert.strictEqual(needsPersistenceEvidence('usar Postgres com Prisma e seed'), true);
  assert.strictEqual(needsPersistenceEvidence('ajustar apenas copy do botao'), false);

  assert.deepStrictEqual(
    buildEvidenceForCriterion('Layout mobile deve ficar correto', 'smoke visual'),
    ['diff', 'command:playwright', 'screenshot:desktop', 'screenshot:mobile', 'command:npm run build', 'command:npm test']
  );

  const matrix = buildAcceptanceMatrixFromBriefing({
    acceptanceCriteria: [
      'BOM multinivel deve recalcular MRP pelo fluxo do usuario',
      'Dados devem persistir apos reload usando Postgres e Prisma',
    ],
    userMessage: 'Criar Forge MRP com Docker/Postgres, migration, seed, Playwright e smoke visual.',
    executionIntent: 'edit_project',
  });

  assert.strictEqual(matrix.version, 1);
  assert.strictEqual(matrix.status, 'pending');
  assert.ok(matrix.items.length >= 7);
  assert.ok(matrix.items.every((item) => item.status === 'pending'));
  assert.ok(matrix.items.some((item) => item.evidence.includes('command:npm run build')));
  assert.ok(matrix.items.some((item) => item.evidence.includes('command:npm test')));
  assert.ok(matrix.items.some((item) => item.evidence.includes('command:playwright')));
  assert.ok(matrix.items.some((item) => item.evidence.includes('screenshot:desktop')));
  assert.ok(matrix.items.some((item) => item.evidence.includes('screenshot:mobile')));
  assert.ok(matrix.items.some((item) => item.evidence.includes('docker_postgres')));
  assert.ok(matrix.items.some((item) => item.evidence.includes('prisma_migration')));
  assert.ok(matrix.items.some((item) => item.evidence.includes('prisma_seed')));
  assert.ok(matrix.items.some((item) => item.evidence.includes('db_connection_test')));

  const ids = new Set(matrix.items.map((item) => item.id));
  assert.strictEqual(ids.size, matrix.items.length);
  assert.strictEqual(matrix.summary.total, matrix.items.length);
  assert.strictEqual(matrix.summary.pending, matrix.items.length);

  console.log('acceptance-matrix-service.test.js: ok');
}

run();
