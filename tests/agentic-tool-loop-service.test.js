const assert = require('assert');

const { createAgenticToolLoopService } = require('../main/services/agentic_tool_loop_service');

async function run() {
  const capabilityCalls = [];
  const toolCalls = [];
  const checkpoints = [];
  const events = [];

  const service = createAgenticToolLoopService({
    appendJobEvent: (jobId, type, payload) => events.push({ jobId, type, payload }),
    executeCapability: async (input) => {
      capabilityCalls.push(input);
      if (input.capability === 'filesystem' && input.action === 'read_file') {
        return {
          ok: true,
          message: 'Arquivo lido.',
          data: { content: 'export default function Home() { return null; }' },
        };
      }
      return { ok: true, message: `${input.capability}.${input.action}` };
    },
    executeTool: async (name, input) => {
      toolCalls.push({ name, input });
      return {
        ok: true,
        message: 'Arquivo atualizado.',
        modifiedFiles: ['app/page.tsx'],
      };
    },
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async ({ previousResponseId, toolResults }) => {
      if (!previousResponseId) {
        return {
          responseId: 'resp_1',
          text: '',
          toolCalls: [
            { callId: 'call_read', name: 'read_file', input: { path: 'app/page.tsx' } },
            {
              callId: 'call_write',
              name: 'write_file',
              input: { path: 'app/page.tsx', content: 'export default function Home() { return <main>ok</main>; }' },
            },
          ],
        };
      }
      assert.strictEqual(previousResponseId, 'resp_1');
      assert.strictEqual(Array.isArray(toolResults), true);
      assert.strictEqual(toolResults.length, 2);
      return {
        responseId: 'resp_2',
        text: 'Concluído com alteração real no projeto.',
        toolCalls: [],
      };
    },
    setJobCheckpoint: (jobId, key, data) => checkpoints.push({ jobId, key, data }),
    shouldUseModel: (model) => /gpt-5|codex/i.test(String(model || '')),
  });

  const plan = service.buildExecutionPlan({
    projectInfo: { id: 'project-1', rootPath: '/tmp/project' },
    userMessage: 'corrija isso',
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.action.type, 'agentic_tool_loop');
  assert.strictEqual(plan.meta.autoExecute, true);

  const result = await service.executeAction(
    {
      type: 'agentic_tool_loop',
      userMessage: 'corrija isso',
      attachments: [],
      conversationMessages: [],
      jobId: 'job-1',
    },
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-1' }
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.agentic, true);
  assert.strictEqual(result.message, 'Concluído com alteração real no projeto.');
  assert.deepStrictEqual(result.modifiedFiles, ['app/page.tsx']);
  assert.strictEqual(capabilityCalls.length, 1);
  assert.strictEqual(toolCalls.length, 1);
  assert.ok(checkpoints.some((entry) => entry.key === 'agentic_loop'));
  assert.ok(events.some((entry) => entry.type === 'job.agentic_tool_called'));

  // Test case for agentic_no_file_changes blocker
  const failingService = createAgenticToolLoopService({
    appendJobEvent: () => {},
    executeCapability: async () => ({ ok: true }),
    executeTool: async () => ({ ok: true }),
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async () => {
      return {
        responseId: 'resp_blocked_1',
        text: 'Não alterei nada pois o projeto já está correto.',
        toolCalls: [],
      };
    },
    setJobCheckpoint: () => {},
    shouldUseModel: () => true,
  });

  const blockedResult = await failingService.executeAction(
    {
      type: 'agentic_tool_loop',
      userMessage: 'criar arquivo de teste',
      attachments: [],
      conversationMessages: [],
      routeDecision: {
        productRoute: {
          capability: 'create_project',
          executionIntent: 'init_project',
        },
      },
      jobId: 'job-blocked-1',
    },
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-blocked-1' }
  );

  assert.strictEqual(blockedResult.ok, false);
  assert.strictEqual(blockedResult.status, 'blocked');
  assert.deepStrictEqual(blockedResult.errors, ['agentic_no_file_changes']);

  console.log('agentic-tool-loop-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
