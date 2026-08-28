const assert = require('assert');

const {
  createAgenticToolLoopService,
} = require('../main/services/agentic_tool_loop_service');

function createRoute() {
  return {
    decision: 'execute',
    productRoute: {
      capability: 'create_project',
      executionIntent: 'init_project',
      mode: 'faber_blueprint',
      projectState: 'empty_project',
    },
  };
}

function createService(overrides = {}) {
  return createAgenticToolLoopService({
    executeCapability: async () => ({ ok: true }),
    executeTool: async () => ({ ok: true, modifiedFiles: [] }),
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async () => ({ responseId: 'unused', text: '', toolCalls: [] }),
    maxSteps: 3,
    ...overrides,
  });
}

async function run() {
  let genericPrompt = '';
  let genericTools = [];
  let genericBlueprintCalls = 0;
  const genericService = createService({
    applyOptionalBlueprintScaffold: async () => {
      genericBlueprintCalls += 1;
      return { ok: true, modifiedFiles: ['app/page.tsx'] };
    },
    requestModelTurn: async ({ systemPrompt, tools }) => {
      genericPrompt = systemPrompt;
      genericTools = tools;
      return {
        responseId: 'generic-finish',
        text: '',
        toolCalls: [{
          callId: 'generic-finish-call',
          name: 'finish_task',
          input: { status: 'success', summary: 'nenhum scaffold autorizado' },
        }],
      };
    },
  });
  const genericPlan = genericService.buildExecutionPlan({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'Crie uma aplicação Next.js completa.',
    routeDecision: createRoute(),
  });
  await genericService.executeAction(
    genericPlan.action,
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-generic-create' },
  );
  assert.match(genericPrompt, /blueprint do Faber não é um caminho obrigatório/i);
  assert.strictEqual(
    genericTools.some((tool) => tool.name === 'apply_faber_blueprint_scaffold'),
    false,
    'upstream blueprint metadata must not expose the optional scaffold tool',
  );
  assert.strictEqual(genericBlueprintCalls, 0);

  let explicitPrompt = '';
  let explicitTools = [];
  let explicitBlueprintCalls = 0;
  let explicitTurn = 0;
  const explicitService = createService({
    applyOptionalBlueprintScaffold: async (input) => {
      explicitBlueprintCalls += 1;
      assert.strictEqual(input.userMessage, 'Use o blueprint do Faber como scaffold inicial.');
      assert.strictEqual(input.creationProfile.scaffold.explicitlyRequested, true);
      return {
        ok: true,
        status: 'completed',
        message: 'dados internos que não devem chegar ao modelo',
        modifiedFiles: ['app/page.tsx', 'package.json'],
      };
    },
    requestModelTurn: async ({ systemPrompt, tools, toolResults }) => {
      explicitTurn += 1;
      explicitPrompt = systemPrompt;
      explicitTools = tools;
      if (explicitTurn === 1) {
        return {
          responseId: 'explicit-scaffold',
          text: '',
          toolCalls: [
            { callId: 'scaffold-1', name: 'apply_faber_blueprint_scaffold', input: {} },
            { callId: 'scaffold-2', name: 'apply_faber_blueprint_scaffold', input: {} },
          ],
        };
      }
      assert.strictEqual(toolResults.length, 2);
      assert.match(toolResults[0].output, /Scaffold opcional do Faber aplicado/);
      assert.doesNotMatch(toolResults[0].output, /dados internos/);
      assert.match(toolResults[1].output, /já foi utilizado/i);
      return {
        responseId: 'explicit-finish',
        text: '',
        toolCalls: [{
          callId: 'explicit-finish-call',
          name: 'finish_task',
          input: { status: 'success', summary: 'scaffold adaptado' },
        }],
      };
    },
  });
  const explicitPlan = explicitService.buildExecutionPlan({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'Use o blueprint do Faber como scaffold inicial.',
    routeDecision: createRoute(),
  });
  const explicitResult = await explicitService.executeAction(
    explicitPlan.action,
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-explicit-create' },
  );
  assert.strictEqual(explicitResult.ok, true);
  assert.strictEqual(explicitBlueprintCalls, 1, 'the optional scaffold may execute at most once');
  assert.deepStrictEqual(explicitResult.modifiedFiles.sort(), ['app/page.tsx', 'package.json']);
  assert.match(explicitPrompt, /apply_faber_blueprint_scaffold/);
  assert.ok(explicitTools.some((tool) => tool.name === 'apply_faber_blueprint_scaffold'));

  console.log('agentic-create-blueprint-tool.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
