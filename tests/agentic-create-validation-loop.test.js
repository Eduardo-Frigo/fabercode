const assert = require('assert');

const {
  AGENTIC_PROCESS_EXECUTION_POLICIES,
  createAgenticToolLoopService,
} = require('../main/services/agentic_tool_loop_service');

function createRoute() {
  return {
    decision: 'execute',
    productRoute: {
      capability: 'create_project',
      executionIntent: 'init_project',
      mode: 'agentic',
      projectState: 'empty_project',
    },
  };
}

async function run() {
  let turnNumber = 0;
  let inspectionCalls = 0;
  const modelRequests = [];
  const service = createAgenticToolLoopService({
    executeCapability: async () => ({ ok: true }),
    executeTool: async (name, input) => {
      if (name === 'automata.execute_operation_batch') {
        return {
          ok: true,
          status: 'completed',
          modifiedFiles: input.operations.map((operation) => operation.path),
        };
      }
      if (name === 'automata.edit_file_fuzzy') {
        return {
          ok: true,
          status: 'completed',
          modifiedFiles: [input.targetFile],
        };
      }
      return { ok: true, status: 'completed', modifiedFiles: [] };
    },
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    inspectProjectValidation: async (input) => {
      inspectionCalls += 1;
      assert.strictEqual(input.userMessage, 'Crie uma aplicação Next.js com backend.');
      assert.strictEqual(input.creationProfile.executionMode, 'unified_agentic_loop');
      if (inspectionCalls === 1) {
        return {
          ok: true,
          staticReady: false,
          processValidationPending: true,
          staticChecks: [{
            id: 'next_entry',
            label: 'Entrada Next.js',
            status: 'failed',
            required: true,
            detail: 'app/page.tsx ainda não exporta uma página válida.',
          }],
          pendingCommands: [{
            id: 'node_build',
            label: 'Build',
            commandText: 'npm run build',
            required: true,
            blockedBy: ['next_entry'],
          }],
          warnings: [],
          rootPath: '/private/secret/workspace',
        };
      }
      return {
        ok: true,
        staticReady: true,
        processValidationPending: true,
        staticChecks: [{
          id: 'next_entry',
          label: 'Entrada Next.js',
          status: 'passed',
          required: true,
          detail: 'Entrada Next.js encontrada.',
        }],
        pendingCommands: [{
          id: 'node_build',
          label: 'Build',
          commandText: 'npm run build',
          required: true,
          blockedBy: [],
        }],
        warnings: ['Preview continua pendente até o sandbox portátil.'],
        rootPath: '/private/secret/workspace',
      };
    },
    requestModelTurn: async (request) => {
      turnNumber += 1;
      modelRequests.push(request);
      if (turnNumber === 1) {
        assert.ok(request.tools.some((tool) => tool.name === 'inspect_project_validation'));
        assert.match(request.systemPrompt, /inspeção adaptativa/i);
        return {
          responseId: 'turn-1',
          text: '',
          toolCalls: [{
            callId: 'write-initial',
            name: 'write_file',
            input: { path: 'app/page.tsx', content: 'export default function Page() {}' },
          }],
        };
      }
      if (turnNumber === 2) {
        return {
          responseId: 'turn-2',
          text: '',
          toolCalls: [{
            callId: 'finish-without-inspection',
            name: 'finish_task',
            input: { status: 'success', summary: 'tentativa sem inspeção' },
          }],
        };
      }
      if (turnNumber === 3) {
        assert.match(request.toolResults[0].output, /inspeção.*obrigatória/i);
        return {
          responseId: 'turn-3',
          text: '',
          toolCalls: [{ callId: 'inspect-failing', name: 'inspect_project_validation', input: {} }],
        };
      }
      if (turnNumber === 4) {
        assert.match(request.toolResults[0].output, /next_entry/);
        assert.match(request.toolResults[0].output, /staticReady.*false/);
        assert.doesNotMatch(request.toolResults[0].output, /private\/secret/);
        return {
          responseId: 'turn-4',
          text: '',
          toolCalls: [{
            callId: 'finish-with-failing-inspection',
            name: 'finish_task',
            input: { status: 'success', summary: 'tentativa com falha estática' },
          }],
        };
      }
      if (turnNumber === 5) {
        assert.match(request.toolResults[0].output, /falhas estáticas/i);
        return {
          responseId: 'turn-5',
          text: '',
          toolCalls: [{
            callId: 'repair-entry',
            name: 'edit_file_fuzzy',
            input: {
              path: 'app/page.tsx',
              targetContent: 'export default function Page() {}',
              replacementContent: 'export default function Page() { return <main />; }',
            },
          }],
        };
      }
      if (turnNumber === 6) {
        return {
          responseId: 'turn-6',
          text: '',
          toolCalls: [{
            callId: 'finish-with-stale-inspection',
            name: 'finish_task',
            input: { status: 'success', summary: 'tentativa após nova edição' },
          }],
        };
      }
      if (turnNumber === 7) {
        assert.match(request.toolResults[0].output, /obsoleta/i);
        return {
          responseId: 'turn-7',
          text: '',
          toolCalls: [{ callId: 'inspect-passing', name: 'inspect_project_validation', input: {} }],
        };
      }
      assert.strictEqual(turnNumber, 8);
      assert.match(request.toolResults[0].output, /staticReady.*true/);
      return {
        responseId: 'turn-8',
        text: '',
        toolCalls: [{
          callId: 'finish-validated',
          name: 'finish_task',
          input: { status: 'success', summary: 'criação estaticamente pronta' },
        }],
      };
    },
    maxSteps: 10,
  });

  const plan = service.buildExecutionPlan({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'Crie uma aplicação Next.js com backend.',
    routeDecision: createRoute(),
  });
  const result = await service.executeAction(
    plan.action,
    { id: 'project-1', rootPath: '/tmp/project' },
    { processExecutionPolicy: AGENTIC_PROCESS_EXECUTION_POLICIES.SUSPENDED },
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(turnNumber, 8);
  assert.strictEqual(inspectionCalls, 2);
  assert.deepStrictEqual(result.modifiedFiles, ['app/page.tsx']);
  assert.strictEqual(result.creationInspection.staticReady, true);
  assert.strictEqual(result.creationInspection.processValidationPending, true);
  assert.strictEqual(result.creationInspection.mutationRevision, 2);
  assert.ok(result.toolRuns.filter((entry) => entry.toolName === 'finish_task' && !entry.ok).length >= 3);
  assert.strictEqual(modelRequests.length, 8);

  console.log('agentic-create-validation-loop.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
