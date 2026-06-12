const assert = require('assert');

const { createCortexRepairValidationService } = require('../cortex/orchestration/repair_validation_service');

function createValidation({ ready = false, score = 40, coreChecksPassed = false } = {}) {
  return {
    ready,
    score,
    coreChecksPassed,
    checks: {
      operations: true,
      files: true,
      runnableEntry: true,
      patchFirst: true,
    },
    missingRequiredFiles: [],
    missingRequiredDirs: [],
    minScore: 55,
  };
}

function createWorkGraph() {
  return {
    id: 'work-graph-test',
    currentPassId: 'render-pass',
    passes: [],
    validationResults: [],
  };
}

function createHarness(overrides = {}) {
  let passSequence = 0;
  const checkpoints = [];
  const statuses = [];

  const dependencies = {
    CORTEX_VALIDATION_REPAIR_STALL_LIMIT: 1,
    buildOperationBatchDiffPreview: (operations = []) =>
      operations.map((operation) => `${operation.op}:${operation.path}`).join('\n'),
    buildOperationBatchFingerprint: (operations = []) =>
      JSON.stringify(operations.map((operation) => [operation.op, operation.path, operation.content || ''])),
    checkpointCortexRuntime: (jobId, workGraph, runtimeBudget, extra) => {
      checkpoints.push({ jobId, workGraphId: workGraph.id, maxRepairPasses: runtimeBudget.maxRepairPasses, extra });
    },
    createRenderPass: (input) => ({
      id: `repair-pass-${++passSequence}`,
      status: 'pending',
      ...input,
    }),
    evaluateExecutionReadiness: ({ operations = [] }) => {
      const hasStylesheet = operations.some((operation) => operation.path === 'style.css');
      return hasStylesheet
        ? createValidation({ ready: true, score: 100, coreChecksPassed: true })
        : createValidation({ ready: false, score: 50, coreChecksPassed: false });
    },
    hasValidationCoverageImproved: (previous, next) =>
      Boolean(next && next.ready && !(previous && previous.ready)) ||
      Number(next && next.score || 0) > Number(previous && previous.score || 0),
    mergeOperationBatches: (baseOperations = [], incomingOperations = []) => [
      ...baseOperations,
      ...incomingOperations,
    ],
    requestEngineOperationBatchAction: async () => ({
      ok: true,
      action: {
        operations: [
          { op: 'write_file', path: 'style.css', content: 'body { color: #111; }' },
        ],
      },
    }),
    setPassStatus: (workGraph, passId, status, meta = {}) => {
      const pass = workGraph.passes.find((entry) => entry.id === passId);
      if (pass) {
        pass.status = status;
        pass.meta = meta;
      }
      statuses.push({ passId, status, meta });
    },
    ...overrides,
  };

  return {
    checkpoints,
    service: createCortexRepairValidationService(dependencies),
    statuses,
  };
}

async function run() {
  {
    const workGraph = createWorkGraph();
    const initialValidation = createValidation({ ready: false, score: 50, coreChecksPassed: false });
    const enginePlan = {
      ok: true,
      action: {
        operations: [
          { op: 'write_file', path: 'index.html', content: '<main>FAQ e contato</main>' },
        ],
      },
    };
    const { checkpoints, service, statuses } = createHarness({
      requestEngineOperationBatchAction: async ({ repairContext, workGraph: receivedWorkGraph }) => {
        assert.strictEqual(repairContext.failedCoverage, initialValidation);
        assert.deepStrictEqual(repairContext.failedOperations, [{ op: 'write_file', path: 'index.html' }]);
        assert.strictEqual(receivedWorkGraph.currentPassId, 'repair-pass-1');
        return {
          ok: true,
          action: {
            operations: [
              { op: 'write_file', path: 'style.css', content: 'body { color: #111; }' },
            ],
          },
        };
      },
    });

    const result = await service.runRepairValidationLoop({
      projectInfo: { rootPath: '/tmp/faber-project' },
      userMessage: 'corrigir FAQ e contato',
      attachments: [],
      mempalaceContext: { contextText: 'memory' },
      mempalaceCore: { ok: true },
      ragContext: { contextText: 'rag' },
      cortexContext: { contextText: 'cortex' },
      workGraph,
      renderPass: { id: 'render-pass' },
      enginePlan,
      validation: initialValidation,
      runtimeBudget: { maxRepairPasses: 2, generationOptions: { num_predict: 256 } },
      latestDiagnostics: { issues: [] },
      executionIntent: 'edit_project',
      jobId: 'job-1',
    });

    assert.strictEqual(result.validation.ready, true);
    assert.strictEqual(result.enginePlan.action.operations.length, 2);
    assert.ok(result.enginePlan.action.diffPreview.includes('write_file:style.css'));
    assert.strictEqual(result.patchFirstGuardrailHit, false);
    assert.strictEqual(workGraph.validationResults.length, 1);
    assert.strictEqual(workGraph.passes[0].status, 'completed');
    assert.strictEqual(workGraph.passes[0].maxTokens, 256);
    assert.deepStrictEqual(workGraph.passes[0].inputRefs, ['render-pass', 'validation.failed_checks']);
    assert.strictEqual(statuses[0].status, 'running');
    assert.strictEqual(statuses[1].status, 'completed');
    assert.strictEqual(checkpoints[0].extra.stage, 'validation_repair_started');
  }

  {
    const workGraph = createWorkGraph();
    const initialValidation = createValidation({ ready: false, score: 50, coreChecksPassed: false });
    const { service } = createHarness({
      requestEngineOperationBatchAction: async () => ({
        ok: false,
        message: 'Plano rejeitado no modo edit_project pelo guardrail patch-first.',
      }),
    });

    const result = await service.runRepairValidationLoop({
      projectInfo: { rootPath: '/tmp/faber-project' },
      userMessage: 'corrigir layout atual',
      workGraph,
      renderPass: { id: 'render-pass' },
      enginePlan: {
        ok: true,
        action: {
          operations: [
            { op: 'write_file', path: 'index.html', content: '<main>Atual</main>' },
          ],
        },
      },
      validation: initialValidation,
      runtimeBudget: { maxRepairPasses: 1, generationOptions: { num_predict: 128 } },
      executionIntent: 'edit_project',
    });

    assert.strictEqual(result.validation, initialValidation);
    assert.strictEqual(result.patchFirstGuardrailHit, true);
    assert.ok(result.patchFirstGuardrailMessage.includes('patch-first'));
    assert.strictEqual(workGraph.validationResults.length, 0);
    assert.strictEqual(workGraph.passes[0].status, 'failed');
  }

  {
    const workGraph = createWorkGraph();
    let repairCalls = 0;
    const { service, statuses } = createHarness({
      CORTEX_VALIDATION_REPAIR_STALL_LIMIT: 3,
      evaluateExecutionReadiness: () => createValidation({ ready: false, score: 50, coreChecksPassed: false }),
      mergeOperationBatches: (baseOperations = []) => baseOperations.slice(),
      requestEngineOperationBatchAction: async () => {
        repairCalls += 1;
        return {
          ok: true,
          action: {
            operations: [
              { op: 'write_file', path: 'index.html', content: '<main>mesmo conteudo</main>' },
            ],
          },
        };
      },
    });

    const result = await service.runRepairValidationLoop({
      projectInfo: { rootPath: '/tmp/faber-project' },
      userMessage: 'corrigir sem repetir',
      workGraph,
      renderPass: { id: 'render-pass' },
      enginePlan: {
        ok: true,
        action: {
          operations: [
            { op: 'write_file', path: 'index.html', content: '<main>mesmo conteudo</main>' },
          ],
        },
      },
      validation: createValidation({ ready: false, score: 50, coreChecksPassed: false }),
      runtimeBudget: { maxRepairPasses: 3, generationOptions: { num_predict: 128 } },
      executionIntent: 'edit_project',
    });

    assert.strictEqual(result.validation.ready, false);
    assert.strictEqual(repairCalls, 1);
    assert.strictEqual(workGraph.passes.length, 1);
    assert.ok(statuses.some((entry) => String(entry.meta.message || '').includes('repetiu o mesmo lote')));
  }

  {
    const workGraph = createWorkGraph();
    const outputLimitError = new Error('OpenAI não retornou texto gerado (status=incomplete; reason=max_output_tokens; output=reasoning; max_output_tokens=4096).');
    const { service, statuses } = createHarness({
      requestEngineOperationBatchAction: async () => {
        throw outputLimitError;
      },
    });

    const initialValidation = createValidation({ ready: false, score: 53, coreChecksPassed: false });
    const result = await service.runRepairValidationLoop({
      projectInfo: { rootPath: '/tmp/faber-project' },
      userMessage: 'corrigir app existente',
      workGraph,
      renderPass: { id: 'render-pass' },
      enginePlan: {
        ok: true,
        action: {
          operations: [
            { op: 'write_file', path: 'app/page.tsx', content: 'instrucoes textuais' },
          ],
        },
      },
      validation: initialValidation,
      runtimeBudget: { maxRepairPasses: 1, generationOptions: { num_predict: 4096 } },
      executionIntent: 'edit_project',
    });

    assert.strictEqual(result.validation, initialValidation);
    assert.strictEqual(workGraph.passes[0].status, 'failed');
    assert.strictEqual(statuses[1].meta.providerFailure.code, 'persona_engine_output_limit');
    assert.strictEqual(statuses[1].meta.providerFailure.category, 'output_limit');
  }

  console.log('repair-validation-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
