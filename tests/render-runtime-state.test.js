const assert = require('assert');
const crypto = require('crypto');

const {
  CORTEX_RENDER_RUNTIME_VERSION,
  RENDER_PASS_VERSION,
  RUNTIME_BUDGET_VERSION,
  WORK_GRAPH_VERSION,
  buildOperationBatchFingerprint,
  createCortexRuntimeCheckpoint,
  createCortexWorkGraph,
  createRenderPass,
  setPassStatus,
} = require('../cortex/orchestration/render_runtime_state');

const fakeCrypto = {
  createHash: crypto.createHash,
  randomBytes: (size) => ({
    toString: () => (size === 3 ? 'a1b2c3' : 'd4e5f607'),
  }),
};

function run() {
  const renderPass = createRenderPass(
    {
      role: 'persona_executor',
      kind: 'render_operations',
      inputRefs: ['briefing-1'],
      outputContract: { operations: 'operation_batch' },
      maxTokens: 1200,
    },
    { crypto: fakeCrypto, now: () => 1234 }
  );

  assert.strictEqual(renderPass.kind, RENDER_PASS_VERSION);
  assert.strictEqual(renderPass.id, 'render_operations-1234-a1b2c3');
  assert.strictEqual(renderPass.status, 'pending');
  assert.strictEqual(renderPass.repairOf, null);

  const runtimeBudget = {
    kind: RUNTIME_BUDGET_VERSION,
    profile: 'balanceado',
    maxActiveModels: 1,
    maxPromptCharsPerPass: 7000,
    maxOperationsPerPass: 8,
    memoryState: { pressure: 'normal', freeMb: 4096 },
  };

  const workGraph = createCortexWorkGraph(
    {
      projectInfo: {
        rootPath: '/tmp/project',
        stacks: ['Electron', 'Node'],
        totalFiles: 42,
      },
      userMessage: 'Criar uma interface validada',
      attachments: [{ name: 'brief.md', type: 'text/markdown', size: 120 }],
      runtimeBudget,
      memory: { ok: true },
      mempalaceCore: {
        ok: true,
        wing: 'project',
        layers: { wake_up: 'contexto' },
        kg: { facts: [{ entity: 'project', facts: [] }] },
        graph: { tunnels: [{ a: 'x', b: 'y' }] },
      },
      cortex: { available: true, selectedCount: 3 },
      rag: { ok: true, provider: 'r2r', refsCount: 2 },
    },
    { crypto: fakeCrypto, now: () => 5678 }
  );

  assert.strictEqual(workGraph.kind, WORK_GRAPH_VERSION);
  assert.strictEqual(workGraph.id, 'wg-5678-d4e5f607');
  assert.strictEqual(workGraph.status, 'created');
  assert.strictEqual(workGraph.project.totalFiles, 42);
  assert.strictEqual(workGraph.attachments[0].type, 'text/markdown');
  assert.deepStrictEqual(workGraph.memoryRefs.rag, { provider: 'r2r', refsCount: 2 });
  assert.deepStrictEqual(workGraph.runtimeBudget, runtimeBudget);

  workGraph.passes.push(renderPass);
  const updated = setPassStatus(workGraph, renderPass.id, 'running', { started: true });
  assert.strictEqual(updated.status, 'running');
  assert.deepStrictEqual(updated.result, { started: true });
  assert.strictEqual(setPassStatus(workGraph, 'missing', 'failed'), null);

  const firstFingerprint = buildOperationBatchFingerprint([
    { op: 'write_file', path: 'index.html', content: '<main>v1</main>' },
  ]);
  const sameFingerprint = buildOperationBatchFingerprint([
    { op: 'write_file', path: 'index.html', content: '<main>v1</main>' },
  ]);
  const changedFingerprint = buildOperationBatchFingerprint([
    { op: 'write_file', path: 'index.html', content: '<main>v2</main>' },
  ]);
  assert.strictEqual(firstFingerprint, sameFingerprint);
  assert.notStrictEqual(firstFingerprint, changedFingerprint);

  const checkpoint = createCortexRuntimeCheckpoint(workGraph, runtimeBudget, { stage: 'created' });
  assert.strictEqual(checkpoint.runtime, CORTEX_RENDER_RUNTIME_VERSION);
  assert.strictEqual(checkpoint.workGraph.id, workGraph.id);
  assert.strictEqual(checkpoint.stage, 'created');

  console.log('render-runtime-state.test.js: ok');
}

run();
