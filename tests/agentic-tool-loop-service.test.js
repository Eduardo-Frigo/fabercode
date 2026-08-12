const assert = require('assert');

const {
  AGENTIC_EXECUTION_CANCELLED_CODE,
  AgenticExecutionCancelledError,
  createAgenticToolLoopService,
} = require('../main/services/agentic_tool_loop_service');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function assertCancelledError(error) {
  assert(error instanceof AgenticExecutionCancelledError);
  assert.strictEqual(error.name, 'AgenticExecutionCancelledError');
  assert.strictEqual(error.code, AGENTIC_EXECUTION_CANCELLED_CODE);
  assert.strictEqual(error.status, 'cancelled');
  assert.strictEqual(error.cancelled, true);
  assert.strictEqual(typeof error.phase, 'string');
  return true;
}

function buildAction(jobId, userMessage = 'inspecione o projeto') {
  return {
    type: 'agentic_tool_loop',
    userMessage,
    attachments: [],
    conversationMessages: [],
    jobId,
  };
}

function buildCancellationService(overrides = {}) {
  return createAgenticToolLoopService({
    appendJobEvent: () => {},
    executeCapability: async () => ({ ok: true }),
    executeTool: async () => ({ ok: true }),
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async () => ({ responseId: 'response', text: 'feito', toolCalls: [] }),
    setJobCheckpoint: () => {},
    shouldUseModel: () => true,
    maxSteps: 2,
    ...overrides,
  });
}

async function run() {
  const capabilityCalls = [];
  const toolCalls = [];
  const checkpoints = [];
  const events = [];

  const service = createAgenticToolLoopService({
    appendJobEvent: (jobId, type, payload) => events.push({ jobId, type, payload }),
    executeCapability: async (...args) => {
      assert.strictEqual(args.length, 1);
      const [input] = args;
      assert.strictEqual(Object.hasOwn(input, 'signal'), false);
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
    executeTool: async (...args) => {
      assert.strictEqual(args.length, 2);
      const [name, input] = args;
      toolCalls.push({ name, input });
      return {
        ok: true,
        message: 'Arquivo atualizado.',
        modifiedFiles: ['app/page.tsx'],
      };
    },
    getEffectiveOpenAiModel: () => 'gpt-5-codex',
    getSelectedAiProvider: () => 'openai',
    requestModelTurn: async (request) => {
      assert.strictEqual(Object.hasOwn(request, 'signal'), false);
      const { previousResponseId, toolResults } = request;
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

  // A signal already cancelled must fail closed before a model turn or local effect begins.
  const preAbortedController = new AbortController();
  preAbortedController.abort();
  let preAbortedModelCalls = 0;
  let preAbortedCapabilityCalls = 0;
  let preAbortedToolCalls = 0;
  const preAbortedService = buildCancellationService({
    executeCapability: async () => {
      preAbortedCapabilityCalls += 1;
      return { ok: true };
    },
    executeTool: async () => {
      preAbortedToolCalls += 1;
      return { ok: true };
    },
    requestModelTurn: async () => {
      preAbortedModelCalls += 1;
      return { responseId: 'must-not-run', text: '', toolCalls: [] };
    },
  });
  await assert.rejects(
    preAbortedService.executeAction(
      buildAction('job-pre-aborted'),
      { id: 'project-1', rootPath: '/tmp/project' },
      { jobId: 'job-pre-aborted', signal: preAbortedController.signal }
    ),
    assertCancelledError
  );
  assert.strictEqual(preAbortedModelCalls, 0);
  assert.strictEqual(preAbortedCapabilityCalls, 0);
  assert.strictEqual(preAbortedToolCalls, 0);

  // A model response arriving after cancellation must never release its proposed tools.
  const modelRaceController = new AbortController();
  const modelRaceTurn = createDeferred();
  let modelRaceSignal = null;
  let modelRaceCapabilityCalls = 0;
  let modelRaceToolCalls = 0;
  const modelRaceService = buildCancellationService({
    executeCapability: async () => {
      modelRaceCapabilityCalls += 1;
      return { ok: true };
    },
    executeTool: async () => {
      modelRaceToolCalls += 1;
      return { ok: true };
    },
    requestModelTurn: ({ signal }) => {
      modelRaceSignal = signal;
      return modelRaceTurn.promise;
    },
  });
  const modelRaceExecution = modelRaceService.executeAction(
    buildAction('job-model-race'),
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-model-race', signal: modelRaceController.signal }
  );
  assert.strictEqual(modelRaceSignal, modelRaceController.signal);
  modelRaceController.abort();
  await assert.rejects(modelRaceExecution, assertCancelledError);
  modelRaceTurn.resolve({
    responseId: 'late-response',
    text: '',
    toolCalls: [{ callId: 'late-tool', name: 'write_file', input: { path: 'late.js', content: '' } }],
  });
  await Promise.resolve();
  assert.strictEqual(modelRaceCapabilityCalls, 0);
  assert.strictEqual(modelRaceToolCalls, 0);

  // Cancellation during a tool waits for that in-flight effect to settle and fences every later call.
  const toolRaceController = new AbortController();
  const toolRaceResult = createDeferred();
  const toolRaceStarted = createDeferred();
  let toolRaceExecutionSettled = false;
  let toolRaceCalls = 0;
  let toolRaceCapabilityCalls = 0;
  const toolRaceService = buildCancellationService({
    executeCapability: async () => {
      toolRaceCapabilityCalls += 1;
      return { ok: true, message: 'must not run' };
    },
    executeTool: (name, input, invocationOptions) => {
      toolRaceCalls += 1;
      assert.strictEqual(name, 'automata.execute_operation_batch');
      assert.strictEqual(invocationOptions.signal, toolRaceController.signal);
      toolRaceStarted.resolve();
      return toolRaceResult.promise;
    },
    requestModelTurn: async ({ signal }) => {
      assert.strictEqual(signal, toolRaceController.signal);
      return {
        responseId: 'tool-race-response',
        text: '',
        toolCalls: [
          { callId: 'first-effect', name: 'write_file', input: { path: 'app/page.js', content: 'first' } },
          { callId: 'forbidden-next-effect', name: 'read_file', input: { path: 'app/page.js' } },
        ],
      };
    },
  });
  const toolRaceExecution = toolRaceService.executeAction(
    buildAction('job-tool-race', 'altere o arquivo'),
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-tool-race', signal: toolRaceController.signal }
  );
  toolRaceExecution.then(
    () => { toolRaceExecutionSettled = true; },
    () => { toolRaceExecutionSettled = true; }
  );
  await toolRaceStarted.promise;
  toolRaceController.abort();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(toolRaceExecutionSettled, false);
  assert.strictEqual(toolRaceCalls, 1);
  assert.strictEqual(toolRaceCapabilityCalls, 0);
  toolRaceResult.resolve({ ok: true, message: 'late effect settled', modifiedFiles: ['app/page.js'] });
  await assert.rejects(toolRaceExecution, assertCancelledError);
  assert.strictEqual(toolRaceCalls, 1);
  assert.strictEqual(toolRaceCapabilityCalls, 0);

  // The same settle-then-fence rule applies to capability invocations.
  const capabilityRaceController = new AbortController();
  const capabilityRaceResult = createDeferred();
  const capabilityRaceStarted = createDeferred();
  let capabilityRaceExecutionSettled = false;
  let capabilityRaceCalls = 0;
  let capabilityRaceToolCalls = 0;
  const capabilityRaceService = buildCancellationService({
    executeCapability: (input, invocationOptions) => {
      capabilityRaceCalls += 1;
      assert.strictEqual(input.signal, capabilityRaceController.signal);
      assert.strictEqual(invocationOptions.signal, capabilityRaceController.signal);
      capabilityRaceStarted.resolve();
      return capabilityRaceResult.promise;
    },
    executeTool: async () => {
      capabilityRaceToolCalls += 1;
      return { ok: true, message: 'must not run' };
    },
    requestModelTurn: async () => ({
      responseId: 'capability-race-response',
      text: '',
      toolCalls: [
        { callId: 'first-capability', name: 'read_file', input: { path: 'app/page.js' } },
        { callId: 'forbidden-next-tool', name: 'write_file', input: { path: 'app/page.js', content: 'late' } },
      ],
    }),
  });
  const capabilityRaceExecution = capabilityRaceService.executeAction(
    buildAction('job-capability-race'),
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-capability-race', signal: capabilityRaceController.signal }
  );
  capabilityRaceExecution.then(
    () => { capabilityRaceExecutionSettled = true; },
    () => { capabilityRaceExecutionSettled = true; }
  );
  await capabilityRaceStarted.promise;
  capabilityRaceController.abort();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(capabilityRaceExecutionSettled, false);
  assert.strictEqual(capabilityRaceCalls, 1);
  assert.strictEqual(capabilityRaceToolCalls, 0);
  capabilityRaceResult.resolve({ ok: true, message: 'late capability settled' });
  await assert.rejects(capabilityRaceExecution, assertCancelledError);
  assert.strictEqual(capabilityRaceCalls, 1);
  assert.strictEqual(capabilityRaceToolCalls, 0);

  console.log('agentic-tool-loop-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
