const assert = require('assert');
const crypto = require('crypto');

const {
  AGENTIC_EXECUTION_CANCELLED_CODE,
  AGENTIC_PROCESS_EXECUTION_POLICIES,
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
  const contextPackPromptProjection = Object.freeze({
    trustedPrompt: 'TRUSTED CONTEXTPACK PERMISSIONS',
    untrustedPrompt: 'UNTRUSTED CONTEXTPACK CONTENT',
  });

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
      assert.match(request.systemPrompt, /`\.faber\/\*\*` é um namespace privado/);
      assert.doesNotMatch(request.systemPrompt, /modificar.*`\.faber/i);
      assert.match(request.systemPrompt, /TRUSTED CONTEXTPACK PERMISSIONS/);
      assert.doesNotMatch(request.systemPrompt, /UNTRUSTED CONTEXTPACK CONTENT/);
      const conversationPrompt = request.conversationMessages
        .map((entry) => typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content))
        .join('\n');
      assert.match(conversationPrompt, /UNTRUSTED CONTEXTPACK CONTENT/);
      assert.doesNotMatch(conversationPrompt, /TRUSTED CONTEXTPACK PERMISSIONS/);
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
    { jobId: 'job-1', contextPackPromptProjection }
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.agentic, true);
  assert.match(result.message, /validações permanecem pendentes/i);
  assert.doesNotMatch(result.message, /alteração real no projeto/i);
  assert.deepStrictEqual(result.modifiedFiles, ['app/page.tsx']);
  assert.strictEqual(capabilityCalls.length, 1);
  assert.strictEqual(toolCalls.length, 1);
  assert.ok(checkpoints.some((entry) => entry.key === 'agentic_loop'));
  assert.ok(events.some((entry) => entry.type === 'job.agentic_tool_called'));
  const modelTurnCheckpoint = checkpoints.find(
    (entry) => entry.key === 'agentic_last_turn' && entry.data && entry.data.textPreview
  );
  assert(modelTurnCheckpoint);
  assert.match(modelTurnCheckpoint.data.textPreview, /conteúdo omitido/i);
  assert.match(modelTurnCheckpoint.data.textPreview, /Validações de processo permanecem pendentes/i);
  assert.doesNotMatch(modelTurnCheckpoint.data.textPreview, /Concluído com alteração real/i);

  // Until the portable sandbox exists, the model must not receive shell or
  // preview-capture capabilities. The prompt must not instruct it to call
  // tools that are deliberately absent from its surface.
  let suspendedSurfaceDefinitions = null;
  let suspendedSurfacePrompt = '';
  const suspendedSurfaceCapabilityCalls = [];
  const suspendedSurfaceToolCalls = [];
  let suspendedSurfaceTurn = 0;
  const suspendedSurfaceService = buildCancellationService({
    maxSteps: 3,
    executeCapability: async (request) => {
      suspendedSurfaceCapabilityCalls.push(request);
      return { ok: true, message: 'capability allowed' };
    },
    executeTool: async (name, input) => {
      suspendedSurfaceToolCalls.push({ name, input });
      return { ok: true, message: 'tool allowed' };
    },
    requestModelTurn: async ({ systemPrompt, tools, toolResults }) => {
      suspendedSurfaceTurn += 1;
      if (suspendedSurfaceTurn === 1) {
        suspendedSurfaceDefinitions = tools;
        suspendedSurfacePrompt = systemPrompt;
        return {
          responseId: 'suspended-surface-1',
          text: '',
          toolCalls: [
            {
              callId: 'forged-run-command',
              name: 'run_command',
              input: { command: 'npm test' },
            },
            {
              callId: 'forged-read-command-output',
              name: 'read_command_output',
              input: { cursor: 0, maxBytes: 1024 },
            },
            {
              callId: 'forged-wait-command',
              name: 'wait_command',
              input: { afterRevision: 1, timeoutMs: 1000 },
            },
            {
              callId: 'forged-stop-command',
              name: 'stop_command',
              input: { expectedRevision: 1 },
            },
            {
              callId: 'forged-preview-capture',
              name: 'preview_capture',
              input: { stopAfterCapture: true },
            },
            {
              callId: 'allowed-read-file',
              name: 'read_file',
              input: { path: 'package.json' },
            },
            {
              callId: 'allowed-search-text',
              name: 'search_text',
              input: { targetText: 'scripts' },
            },
          ],
        };
      }

      assert.strictEqual(toolResults.length, 7);
      assert.match(toolResults[0].output, /Tool desconhecida: run_command/);
      assert.match(toolResults[1].output, /Tool desconhecida: read_command_output/);
      assert.match(toolResults[2].output, /Tool desconhecida: wait_command/);
      assert.match(toolResults[3].output, /Tool desconhecida: stop_command/);
      assert.match(toolResults[4].output, /Tool desconhecida: preview_capture/);
      assert.match(toolResults[5].output, /capability allowed/);
      assert.match(toolResults[6].output, /tool allowed/);
      return {
        responseId: 'suspended-surface-2',
        text: '',
        toolCalls: [{
          callId: 'finish-suspended-surface',
          name: 'finish_task',
          input: { status: 'success', summary: 'inspeção concluída' },
        }],
      };
    },
  });

  const suspendedExecutionOptions = {
    jobId: 'job-suspended-surface',
    processExecutionPolicy: AGENTIC_PROCESS_EXECUTION_POLICIES.SUSPENDED,
  };
  let suspendedProcessCalls = 0;
  Object.defineProperty(suspendedExecutionOptions, 'executeProcess', {
    configurable: false,
    enumerable: false,
    value: async () => {
      suspendedProcessCalls += 1;
      return { ok: true };
    },
    writable: false,
  });
  for (const callbackName of ['readProcess', 'waitProcess', 'stopProcess']) {
    Object.defineProperty(suspendedExecutionOptions, callbackName, {
      configurable: false,
      enumerable: false,
      value: async () => {
        suspendedProcessCalls += 1;
        return { ok: true };
      },
      writable: false,
    });
  }
  const suspendedSurfaceResult = await suspendedSurfaceService.executeAction(
    buildAction('job-suspended-surface', 'verifique o estado atual'),
    { id: 'project-1', rootPath: '/tmp/project' },
    Object.freeze(suspendedExecutionOptions)
  );
  assert.strictEqual(suspendedSurfaceResult.ok, true);
  assert.match(suspendedSurfaceResult.message, /validações permanecem pendentes/i);
  assert.doesNotMatch(suspendedSurfaceResult.message, /inspeção concluída/i);
  assert(Array.isArray(suspendedSurfaceDefinitions));
  const suspendedSurfaceNames = suspendedSurfaceDefinitions.map((definition) => definition.name);
  assert.strictEqual(suspendedSurfaceNames.includes('run_command'), false);
  assert.strictEqual(suspendedSurfaceNames.includes('read_command_output'), false);
  assert.strictEqual(suspendedSurfaceNames.includes('wait_command'), false);
  assert.strictEqual(suspendedSurfaceNames.includes('stop_command'), false);
  assert.strictEqual(suspendedSurfaceNames.includes('preview_capture'), false);
  assert.strictEqual(suspendedSurfaceNames.includes('read_file'), true);
  assert.strictEqual(suspendedSurfaceNames.includes('search_text'), true);
  assert.strictEqual(suspendedSurfaceNames.includes('finish_task'), true);
  assert.doesNotMatch(suspendedSurfacePrompt, /run_command/);
  assert.doesNotMatch(suspendedSurfacePrompt, /preview_capture/);
  assert.doesNotMatch(suspendedSurfacePrompt, /comando(?:s)? (?:de )?terminal/i);
  assert.match(suspendedSurfacePrompt, /não executam lint, testes ou builds nem capturam preview/i);
  assert.match(suspendedSurfacePrompt, /Nunca afirme que essas validações foram executadas/i);
  assert.match(suspendedSurfacePrompt, /informe-as como pendentes para o usuário/i);
  assert.deepStrictEqual(
    suspendedSurfaceCapabilityCalls.map(({ capability, action }) => ({ capability, action })),
    [{ capability: 'filesystem', action: 'read_file' }]
  );
  assert.deepStrictEqual(
    suspendedSurfaceToolCalls.map(({ name }) => name),
    ['automata.search_text_in_files']
  );
  assert.strictEqual(suspendedProcessCalls, 0);

  // The broker-backed process callback is model-visible only under the exact
  // internal brokered policy. The callback receives bounded executable data
  // and the model receives only a sanitized process receipt.
  const processSignalController = new AbortController();
  const processCallbackSecret = '/private/workspace/job-authority/request-digest';
  const processCallbackRequests = [];
  let brokeredProcessDefinitions = null;
  let brokeredProcessPrompt = '';
  let brokeredProcessOutput = '';
  let brokeredControlOutputs = [];
  let brokeredProcessTurn = 0;
  const readProcessRequests = [];
  const waitProcessRequests = [];
  const stopProcessRequests = [];
  const brokeredProcessService = buildCancellationService({
    maxSteps: 3,
    requestModelTurn: async ({ systemPrompt, tools, toolResults }) => {
      brokeredProcessTurn += 1;
      if (brokeredProcessTurn === 1) {
        brokeredProcessDefinitions = tools;
        brokeredProcessPrompt = systemPrompt;
        return {
          responseId: 'brokered-process-1',
          text: '',
          toolCalls: [{
            callId: 'brokered-run-command',
            name: 'run_command',
            input: {
              command: 'npm',
              args: ['test', '--', '--runInBand'],
              timeoutMs: 120_000,
            },
          }],
        };
      }
      if (brokeredProcessTurn === 2) {
        brokeredProcessOutput = toolResults[0].output;
        return {
          responseId: 'brokered-process-2',
          text: '',
          toolCalls: [
            {
              callId: 'brokered-read-command-output',
              name: 'read_command_output',
              input: { cursor: 0, maxBytes: 4096 },
            },
            {
              callId: 'brokered-wait-command',
              name: 'wait_command',
              input: { afterRevision: 1, timeoutMs: 1000 },
            },
            {
              callId: 'brokered-stop-command',
              name: 'stop_command',
              input: { expectedRevision: 2 },
            },
          ],
        };
      }
      brokeredControlOutputs = toolResults.map((entry) => entry.output);
      return {
        responseId: 'brokered-process-3',
        text: '',
        toolCalls: [{
          callId: 'finish-brokered-process',
          name: 'finish_task',
          input: { status: 'success', summary: 'testes iniciados no sandbox' },
        }],
      };
    },
  });
  const brokeredProcessOptions = {
    jobId: 'job-brokered-process',
    signal: processSignalController.signal,
    processExecutionPolicy: AGENTIC_PROCESS_EXECUTION_POLICIES.BROKERED,
  };
  Object.defineProperty(brokeredProcessOptions, 'executeProcess', {
    configurable: false,
    enumerable: false,
    value: async (request) => {
      processCallbackRequests.push(request);
      assert.strictEqual(Object.isFrozen(request), true);
      assert.strictEqual(Object.isFrozen(request.args), true);
      assert.deepStrictEqual(Object.keys(request), [
        'command',
        'args',
        'timeoutMs',
        'signal',
      ]);
      assert.strictEqual(request.command, 'npm');
      assert.deepStrictEqual(request.args, ['test', '--', '--runInBand']);
      assert.strictEqual(request.timeoutMs, 120_000);
      assert.strictEqual(request.signal, processSignalController.signal);
      return Object.freeze({
        schemaVersion: 'project-capability.result.v1',
        requestId: processCallbackSecret,
        capability: 'process',
        action: 'run',
        decision: 'allow',
        status: 'completed',
        output: Object.freeze({
          status: 'running',
          revision: 1,
          exitCode: null,
          signal: null,
          timedOut: false,
          stopped: false,
          availableFromCursor: 0,
          outputCursor: 0,
          requestDigest: processCallbackSecret,
          binding: processCallbackSecret,
        }),
        error: null,
        policy: Object.freeze({
          decision: 'allow',
          reasonCode: processCallbackSecret,
        }),
        approval: null,
      });
    },
    writable: false,
  });
  Object.defineProperty(brokeredProcessOptions, 'readProcess', {
    configurable: false,
    enumerable: false,
    value: async (request) => {
      readProcessRequests.push(request);
      assert.strictEqual(Object.isFrozen(request), true);
      assert.deepStrictEqual(Object.keys(request), ['cursor', 'maxBytes']);
      return Object.freeze({
        version: 'process-supervisor-read-result.v1',
        executionId: processCallbackSecret,
        status: 'running',
        revision: 1,
        exitCode: null,
        signal: null,
        timedOut: false,
        stopped: false,
        cursor: request.cursor,
        availableFromCursor: 0,
        nextCursor: 5,
        outputCursor: 5,
        truncated: false,
        chunks: Object.freeze([Object.freeze({
          startCursor: 0,
          endCursor: 5,
          stream: 'stdout',
          text: 'pass\n',
        })]),
        eof: false,
      });
    },
    writable: false,
  });
  Object.defineProperty(brokeredProcessOptions, 'waitProcess', {
    configurable: false,
    enumerable: false,
    value: async (request) => {
      waitProcessRequests.push(request);
      assert.strictEqual(Object.isFrozen(request), true);
      assert.deepStrictEqual(Object.keys(request), ['afterRevision', 'timeoutMs']);
      return Object.freeze({
        version: 'process-supervisor-wait-result.v1',
        executionId: processCallbackSecret,
        status: 'succeeded',
        revision: 2,
        exitCode: 0,
        signal: null,
        timedOut: false,
        stopped: false,
        availableFromCursor: 0,
        outputCursor: 5,
        changed: true,
      });
    },
    writable: false,
  });
  Object.defineProperty(brokeredProcessOptions, 'stopProcess', {
    configurable: false,
    enumerable: false,
    value: async (request) => {
      stopProcessRequests.push(request);
      assert.strictEqual(Object.isFrozen(request), true);
      assert.deepStrictEqual(Object.keys(request), ['expectedRevision']);
      return Object.freeze({
        version: 'process-supervisor-stop-receipt.v1',
        executionId: processCallbackSecret,
        status: 'succeeded',
        revision: 2,
        exitCode: 0,
        signal: null,
        timedOut: false,
        stopped: false,
        availableFromCursor: 0,
        outputCursor: 5,
        treeTerminated: true,
        idempotent: true,
      });
    },
    writable: false,
  });
  const brokeredProcessResult = await brokeredProcessService.executeAction(
    buildAction('job-brokered-process', 'rode os testes'),
    { id: 'project-1', rootPath: '/tmp/project' },
    Object.freeze(brokeredProcessOptions)
  );
  assert.strictEqual(brokeredProcessResult.ok, true);
  assert.strictEqual(processCallbackRequests.length, 1);
  assert.deepStrictEqual(readProcessRequests, [Object.freeze({
    cursor: 0,
    maxBytes: 4096,
  })]);
  assert.deepStrictEqual(waitProcessRequests, [Object.freeze({
    afterRevision: 1,
    timeoutMs: 1000,
  })]);
  assert.deepStrictEqual(stopProcessRequests, [Object.freeze({
    expectedRevision: 2,
  })]);
  const runCommandDefinition = brokeredProcessDefinitions.find(
    (definition) => definition.name === 'run_command'
  );
  assert(runCommandDefinition);
  assert.strictEqual(runCommandDefinition.strict, true);
  assert.strictEqual(runCommandDefinition.parameters.additionalProperties, false);
  assert.deepStrictEqual(
    Object.keys(runCommandDefinition.parameters.properties),
    ['command', 'args', 'timeoutMs']
  );
  assert.deepStrictEqual(
    runCommandDefinition.parameters.required,
    ['command', 'args', 'timeoutMs']
  );
  assert.strictEqual(JSON.stringify(runCommandDefinition).includes('env'), false);
  assert.strictEqual(JSON.stringify(runCommandDefinition).includes('network'), false);
  assert.strictEqual(JSON.stringify(runCommandDefinition).includes('shell'), false);
  assert.match(brokeredProcessPrompt, /run_command/);
  for (const toolName of ['read_command_output', 'wait_command', 'stop_command']) {
    const definition = brokeredProcessDefinitions.find((entry) => entry.name === toolName);
    assert(definition);
    assert.strictEqual(definition.strict, true);
    assert.strictEqual(definition.parameters.additionalProperties, false);
    assert.match(brokeredProcessPrompt, new RegExp(toolName));
  }
  assert.strictEqual(brokeredProcessOutput.includes(processCallbackSecret), false);
  assert.strictEqual(brokeredProcessOutput.includes('requestDigest'), false);
  assert.strictEqual(brokeredProcessOutput.includes('binding'), false);
  assert.strictEqual(brokeredProcessOutput.includes('running'), true);
  assert.strictEqual(brokeredProcessOutput.includes('revision'), true);
  assert.strictEqual(brokeredControlOutputs.length, 3);
  assert(brokeredControlOutputs.every((output) => !output.includes(processCallbackSecret)));
  assert(brokeredControlOutputs.every((output) => !output.includes('executionId')));
  assert.strictEqual(brokeredControlOutputs[0].includes('pass\\n'), true);
  assert.strictEqual(brokeredControlOutputs[0].includes('nextCursor'), true);
  assert.strictEqual(brokeredControlOutputs[1].includes('changed'), true);
  assert.strictEqual(brokeredControlOutputs[2].includes('treeTerminated'), true);

  // Accessors and unsupported fields are rejected before fingerprinting or
  // crossing the private callback boundary.
  let hostileProcessGetterCalls = 0;
  let hostileProcessProxyTrapCalls = 0;
  let hostileProcessCallbackCalls = 0;
  let hostileProcessTurn = 0;
  const hostileProcessOutputs = [];
  const hostileProcessInput = {
    args: [],
    timeoutMs: 1_000,
  };
  Object.defineProperty(hostileProcessInput, 'command', {
    enumerable: true,
    get() {
      hostileProcessGetterCalls += 1;
      return 'npm';
    },
  });
  const hostileProcessProxy = new Proxy({
    command: 'npm',
    args: [],
    timeoutMs: 1_000,
  }, {
    getPrototypeOf() {
      hostileProcessProxyTrapCalls += 1;
      return Object.prototype;
    },
    ownKeys(target) {
      hostileProcessProxyTrapCalls += 1;
      return Reflect.ownKeys(target);
    },
  });
  const hostileProcessService = buildCancellationService({
    maxSteps: 4,
    requestModelTurn: async ({ toolResults }) => {
      hostileProcessTurn += 1;
      if (toolResults.length) hostileProcessOutputs.push(toolResults[0].output);
      if (hostileProcessTurn === 1) {
        return {
          responseId: 'hostile-process-1',
          text: '',
          toolCalls: [{
            callId: 'hostile-run-command',
            name: 'run_command',
            input: hostileProcessInput,
          }],
        };
      }
      if (hostileProcessTurn === 2) {
        return {
          responseId: 'hostile-process-2',
          text: '',
          toolCalls: [{
            callId: 'hostile-run-command-proxy',
            name: 'run_command',
            input: hostileProcessProxy,
          }],
        };
      }
      return {
        responseId: 'hostile-process-3',
        text: '',
        toolCalls: [{
          callId: 'finish-hostile-process',
          name: 'finish_task',
          input: { status: 'failure', summary: 'entrada hostil recusada' },
        }],
      };
    },
  });
  const hostileProcessOptions = {
    jobId: 'job-hostile-process',
    processExecutionPolicy: AGENTIC_PROCESS_EXECUTION_POLICIES.BROKERED,
  };
  Object.defineProperty(hostileProcessOptions, 'executeProcess', {
    configurable: false,
    enumerable: false,
    value: async () => {
      hostileProcessCallbackCalls += 1;
      return { ok: true };
    },
    writable: false,
  });
  const hostileProcessResult = await hostileProcessService.executeAction(
    buildAction('job-hostile-process'),
    { id: 'project-1', rootPath: '/tmp/project' },
    Object.freeze(hostileProcessOptions)
  );
  assert.strictEqual(hostileProcessResult.ok, false);
  assert.strictEqual(hostileProcessGetterCalls, 0);
  assert.strictEqual(hostileProcessProxyTrapCalls, 0);
  assert.strictEqual(hostileProcessCallbackCalls, 0);
  assert.strictEqual(hostileProcessOutputs.length, 2);
  assert(hostileProcessOutputs.every((output) => output.includes('RUN_COMMAND_INVALID_INPUT')));

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

  // The destructive tool is capability-shaped by main: without the private
  // callback it must not be advertised to the model at all.
  let absentDeleteDefinitions = null;
  const absentDeleteService = buildCancellationService({
    requestModelTurn: async ({ tools }) => {
      absentDeleteDefinitions = tools;
      return {
        responseId: 'delete-absent',
        text: '',
        toolCalls: [{
          callId: 'finish-without-delete',
          name: 'finish_task',
          input: { status: 'success', summary: 'inspeção concluída' },
        }],
      };
    },
  });
  const absentDeleteResult = await absentDeleteService.executeAction(
    buildAction('job-delete-absent', 'verifique o estado atual'),
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-delete-absent' }
  );
  assert.strictEqual(absentDeleteResult.ok, true);
  assert(Array.isArray(absentDeleteDefinitions));
  assert.strictEqual(
    absentDeleteDefinitions.filter((definition) => definition.name === 'delete_paths').length,
    0
  );

  // When main provides the callback, only exact public paths plus the same
  // AbortSignal cross the boundary. `reason` remains non-authoritative and is
  // deliberately not forwarded.
  const deleteSignalController = new AbortController();
  const deleteCallbackRequests = [];
  const callbackSecret = '/private/root/session-token/request-digest';
  let presentDeleteDefinitions = null;
  let sanitizedDeleteOutput = '';
  const deletePathsCallback = async (request) => {
    deleteCallbackRequests.push(request);
    assert.strictEqual(Object.isFrozen(request), true);
    assert.strictEqual(Object.isFrozen(request.paths), true);
    assert.deepStrictEqual(Object.keys(request), ['paths', 'signal']);
    assert.deepStrictEqual(request.paths, ['tmp/a.txt', 'tmp/b.txt']);
    assert.strictEqual(request.signal, deleteSignalController.signal);
    assert.strictEqual(Object.hasOwn(request, 'reason'), false);
    assert.strictEqual(Object.hasOwn(request, 'binding'), false);
    assert.strictEqual(Object.hasOwn(request, 'requestedMode'), false);
    assert.strictEqual(Object.hasOwn(request, 'requestDigest'), false);
    assert.strictEqual(Object.hasOwn(request, 'transactionHandle'), false);
    await Promise.resolve();
    return Object.freeze({
      schemaVersion: 'agentic-delete-result.v1',
      ok: true,
      status: 'completed',
      mode: 'ask_each',
      state: 'COMMITTED',
      impact: Object.freeze({ files: 2, bytes: 17, directories: 0 }),
      errorCode: null,
      message: callbackSecret,
      binding: callbackSecret,
      requestDigest: callbackSecret,
      transactionHandle: Object.freeze({ secret: callbackSecret }),
    });
  };
  let presentDeleteTurn = 0;
  const presentDeleteService = buildCancellationService({
    maxSteps: 3,
    requestModelTurn: async ({ tools, toolResults }) => {
      presentDeleteTurn += 1;
      if (presentDeleteTurn === 1) {
        presentDeleteDefinitions = tools;
        return {
          responseId: 'delete-present-1',
          text: '',
          toolCalls: [{
            callId: 'delete-exact-paths',
            name: 'delete_paths',
            input: {
              paths: ['tmp/a.txt', 'tmp/b.txt'],
              reason: 'remover artefatos temporários',
            },
          }],
        };
      }
      sanitizedDeleteOutput = toolResults[0].output;
      return {
        responseId: 'delete-present-2',
        text: '',
        toolCalls: [{
          callId: 'finish-after-delete',
          name: 'finish_task',
          input: { status: 'success', summary: 'arquivos removidos' },
        }],
      };
    },
  });
  const presentDeleteResult = await presentDeleteService.executeAction(
    buildAction('job-delete-present', 'remova os arquivos temporários'),
    { id: 'project-1', rootPath: '/tmp/project' },
    {
      jobId: 'job-delete-present',
      signal: deleteSignalController.signal,
      deletePaths: deletePathsCallback,
    }
  );
  assert.strictEqual(presentDeleteResult.ok, true);
  assert.deepStrictEqual(presentDeleteResult.modifiedFiles, ['tmp/a.txt', 'tmp/b.txt']);
  assert.strictEqual(deleteCallbackRequests.length, 1);
  const deleteDefinition = presentDeleteDefinitions.find((definition) => definition.name === 'delete_paths');
  assert(deleteDefinition);
  assert.strictEqual(deleteDefinition.strict, true);
  assert.strictEqual(deleteDefinition.parameters.additionalProperties, false);
  assert.strictEqual(deleteDefinition.parameters.properties.paths.type, 'array');
  assert.strictEqual(deleteDefinition.parameters.properties.paths.minItems, 1);
  assert.strictEqual(deleteDefinition.parameters.properties.paths.maxItems, 32);
  assert.strictEqual(deleteDefinition.parameters.properties.paths.items.type, 'string');
  assert.deepStrictEqual(deleteDefinition.parameters.properties.reason.type, ['string', 'null']);
  assert.strictEqual(JSON.stringify(deleteDefinition).includes('binding'), false);
  assert.strictEqual(JSON.stringify(deleteDefinition).includes('requestDigest'), false);
  assert.strictEqual(sanitizedDeleteOutput.includes(callbackSecret), false);
  assert.strictEqual(sanitizedDeleteOutput.includes('requestDigest'), false);
  assert.strictEqual(sanitizedDeleteOutput.includes('transactionHandle'), false);
  assert.strictEqual(sanitizedDeleteOutput.includes('COMMITTED'), true);

  // Rejected callback promises are reduced to a stable public error; their
  // exception text never reaches the model, job events, or final result.
  const callbackErrorSecret = 'authority-binding:private-root:digest-secret';
  let callbackErrorTurn = 0;
  let sanitizedCallbackErrorOutput = '';
  const callbackErrorService = buildCancellationService({
    requestModelTurn: async ({ toolResults }) => {
      callbackErrorTurn += 1;
      if (callbackErrorTurn === 1) {
        return {
          responseId: 'delete-error-1',
          text: '',
          toolCalls: [{
            callId: 'delete-error-call',
            name: 'delete_paths',
            input: { paths: ['tmp/error.txt'], reason: null },
          }],
        };
      }
      sanitizedCallbackErrorOutput = toolResults[0].output;
      return {
        responseId: 'delete-error-2',
        text: '',
        toolCalls: [{
          callId: 'delete-error-finish',
          name: 'finish_task',
          input: { status: 'failure', summary: 'exclusão recusada' },
        }],
      };
    },
  });
  const callbackErrorResult = await callbackErrorService.executeAction(
    buildAction('job-delete-error'),
    { id: 'project-1', rootPath: '/tmp/project' },
    {
      jobId: 'job-delete-error',
      deletePaths: async () => {
        await Promise.resolve();
        throw new Error(callbackErrorSecret);
      },
    }
  );
  assert.strictEqual(callbackErrorResult.ok, false);
  assert.strictEqual(callbackErrorResult.status, 'failed');
  assert.deepStrictEqual(callbackErrorResult.errors, ['agentic_finish_failure']);
  assert.match(callbackErrorResult.message, /encerrada como falha/i);
  assert.strictEqual(sanitizedCallbackErrorOutput.includes(callbackErrorSecret), false);
  assert.strictEqual(sanitizedCallbackErrorOutput.includes('DELETE_PATHS_OPERATION_FAILED'), true);
  assert.strictEqual(JSON.stringify(callbackErrorResult).includes(callbackErrorSecret), false);

  // Hostile accessors and sparse arrays fail before the private callback. No
  // accessor is evaluated while validating or fingerprinting the tool call.
  let hostilePathGetterCalls = 0;
  let hostileDeleteCallbackCalls = 0;
  const hostileInput = {};
  Object.defineProperty(hostileInput, 'paths', {
    enumerable: true,
    get() {
      hostilePathGetterCalls += 1;
      return ['must-not-run'];
    },
  });
  const sparsePaths = new Array(2);
  sparsePaths[1] = 'tmp/sparse.txt';
  let hostileTurn = 0;
  const hostileDeleteOutputs = [];
  const hostileDeleteService = buildCancellationService({
    maxSteps: 4,
    requestModelTurn: async ({ toolResults }) => {
      hostileTurn += 1;
      if (toolResults.length) hostileDeleteOutputs.push(toolResults[0].output);
      if (hostileTurn === 1) {
        return {
          responseId: 'delete-hostile-1',
          text: '',
          toolCalls: [{ callId: 'delete-hostile-accessor', name: 'delete_paths', input: hostileInput }],
        };
      }
      if (hostileTurn === 2) {
        return {
          responseId: 'delete-hostile-2',
          text: '',
          toolCalls: [{
            callId: 'delete-hostile-sparse',
            name: 'delete_paths',
            input: { paths: sparsePaths },
          }],
        };
      }
      return {
        responseId: 'delete-hostile-finish',
        text: '',
        toolCalls: [{
          callId: 'delete-hostile-finish-call',
          name: 'finish_task',
          input: { status: 'failure', summary: 'entrada inválida recusada' },
        }],
      };
    },
  });
  const hostileDeleteResult = await hostileDeleteService.executeAction(
    buildAction('job-delete-hostile'),
    { id: 'project-1', rootPath: '/tmp/project' },
    {
      jobId: 'job-delete-hostile',
      deletePaths: async () => {
        hostileDeleteCallbackCalls += 1;
        return { ok: true, status: 'completed' };
      },
    }
  );
  assert.strictEqual(hostileDeleteResult.ok, false);
  assert.strictEqual(hostileDeleteResult.status, 'failed');
  assert.deepStrictEqual(hostileDeleteResult.errors, ['agentic_finish_failure']);
  assert.strictEqual(hostilePathGetterCalls, 0);
  assert.strictEqual(hostileDeleteCallbackCalls, 0);
  assert.strictEqual(hostileDeleteOutputs.length, 2);
  assert(hostileDeleteOutputs.every((output) => output.includes('DELETE_PATHS_INVALID_INPUT')));

  // A custom array prototype cannot smuggle executable iteration behavior.
  let poisonedMapCalls = 0;
  const poisonedPaths = ['tmp/poisoned.txt'];
  Object.setPrototypeOf(poisonedPaths, {
    map() {
      poisonedMapCalls += 1;
      return ['tmp/changed.txt'];
    },
  });
  let poisonedTurn = 0;
  let poisonedCallbackCalls = 0;
  const poisonedDeleteService = buildCancellationService({
    requestModelTurn: async () => {
      poisonedTurn += 1;
      if (poisonedTurn === 1) {
        return {
          responseId: 'delete-poisoned-1',
          text: '',
          toolCalls: [{
            callId: 'delete-poisoned-array',
            name: 'delete_paths',
            input: { paths: poisonedPaths },
          }],
        };
      }
      return {
        responseId: 'delete-poisoned-2',
        text: '',
        toolCalls: [{
          callId: 'delete-poisoned-finish',
          name: 'finish_task',
          input: { status: 'failure', summary: 'array hostil recusado' },
        }],
      };
    },
  });
  await poisonedDeleteService.executeAction(
    buildAction('job-delete-poisoned'),
    { id: 'project-1', rootPath: '/tmp/project' },
    {
      jobId: 'job-delete-poisoned',
      deletePaths: async () => {
        poisonedCallbackCalls += 1;
        return { ok: true, status: 'completed' };
      },
    }
  );
  assert.strictEqual(poisonedMapCalls, 0);
  assert.strictEqual(poisonedCallbackCalls, 0);

  // Governed domain reads replace the legacy capability adapter only when
  // main injects the private job-bound route. Map and Milestones are absent
  // without that authority and never expose their private .faber paths.
  const domainReadCalls = [];
  let legacyDomainCapabilityCalls = 0;
  let domainReadTurn = 0;
  let domainReadDefinitions = null;
  const domainReadService = buildCancellationService({
    executeCapability: async () => {
      legacyDomainCapabilityCalls += 1;
      return { ok: false, message: 'legacy adapter must not receive governed reads' };
    },
    requestModelTurn: async ({ tools, toolResults }) => {
      domainReadTurn += 1;
      if (domainReadTurn === 1) {
        domainReadDefinitions = tools;
        return {
          responseId: 'domain-read-1',
          text: '',
          toolCalls: [
            { callId: 'domain-tree', name: 'project_tree', input: {} },
            {
              callId: 'domain-file',
              name: 'read_file',
              input: { path: 'README.md', maxChars: 1200 },
            },
            { callId: 'domain-map', name: 'read_application_map', input: {} },
            { callId: 'domain-milestones', name: 'read_milestones', input: {} },
          ],
        };
      }
      assert.strictEqual(toolResults.length, 4);
      const outputs = toolResults.map((entry) => JSON.parse(entry.output));
      assert.strictEqual(outputs.every((entry) => entry.ok === true), true);
      assert.strictEqual(outputs[0].data.entries[0].path, 'README.md');
      assert.strictEqual(outputs[1].data.revision, `sha256:${'a'.repeat(64)}`);
      assert.strictEqual(outputs[1].data.content, '# Faber');
      assert.strictEqual(outputs[2].data.map.revision, 8);
      assert.strictEqual(outputs[3].data.milestones[0].id, 'milestone-3');
      assert.strictEqual(JSON.stringify(outputs).includes('.faber/'), false);
      return {
        responseId: 'domain-read-2',
        text: '',
        toolCalls: [{
          callId: 'domain-finish',
          name: 'finish_task',
          input: { status: 'success', summary: 'domínios inspecionados' },
        }],
      };
    },
  });
  const domainReadOptions = { jobId: 'job-domain-read' };
  Object.defineProperty(domainReadOptions, 'readDomain', {
    configurable: false,
    enumerable: false,
    value: async (input) => {
      assert.strictEqual(Object.isFrozen(input), true);
      assert.strictEqual(Object.isFrozen(input.payload), true);
      domainReadCalls.push(input);
      const key = `${input.capability}.${input.action}`;
      const outputs = {
        'filesystem.project_tree': {
          ok: true,
          entries: [{ path: 'README.md', kind: 'file' }],
          truncated: false,
        },
        'filesystem.read_file': {
          ok: true,
          found: true,
          code: null,
          path: 'README.md',
          revision: `sha256:${'a'.repeat(64)}`,
          bytes: 7,
          returnedBytes: 7,
          encoding: 'utf8',
          truncated: false,
          content: '# Faber',
        },
        'application_map.read': {
          ok: true,
          found: true,
          code: null,
          format: 'application-map-v2',
          revision: `sha256:${'b'.repeat(64)}`,
          map: { revision: 8, nodes: [], edges: [], viewport: {} },
        },
        'milestones.read': {
          ok: true,
          found: true,
          code: null,
          format: 'milestones-v2',
          revision: `sha256:${'c'.repeat(64)}`,
          sourceMapRevision: 8,
          renderedAt: null,
          milestones: [{ id: 'milestone-3', status: 'active' }],
        },
      };
      return Object.freeze({
        status: 'completed',
        decision: 'allow',
        output: Object.freeze(outputs[key]),
        error: null,
      });
    },
    writable: false,
  });
  const governedDomainResult = await domainReadService.executeAction(
    buildAction('job-domain-read', 'inspecione o estado atual'),
    { id: 'project-1', rootPath: '/tmp/project' },
    Object.freeze(domainReadOptions)
  );
  assert.strictEqual(governedDomainResult.ok, true);
  assert.strictEqual(legacyDomainCapabilityCalls, 0);
  assert.deepStrictEqual(
    domainReadCalls.map((input) => `${input.capability}.${input.action}`),
    [
      'filesystem.project_tree',
      'filesystem.read_file',
      'application_map.read',
      'milestones.read',
    ]
  );
  assert.deepStrictEqual(domainReadCalls[0].payload, { maxEntries: 500 });
  assert.deepStrictEqual(domainReadCalls[1].payload, {
    path: 'README.md',
    maxBytes: 1200,
  });
  assert(domainReadDefinitions.some((tool) => tool.name === 'read_application_map'));
  assert(domainReadDefinitions.some((tool) => tool.name === 'read_milestones'));

  let absentDomainDefinitions = null;
  const absentDomainService = buildCancellationService({
    requestModelTurn: async ({ tools }) => {
      absentDomainDefinitions = tools;
      return {
        responseId: 'domain-absent',
        text: '',
        toolCalls: [{
          callId: 'domain-absent-finish',
          name: 'finish_task',
          input: { status: 'success', summary: 'sem rota privada' },
        }],
      };
    },
  });
  await absentDomainService.executeAction(
    buildAction('job-domain-absent', 'inspecione o estado atual'),
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-domain-absent' }
  );
  assert.strictEqual(
    absentDomainDefinitions.some((tool) => tool.name === 'read_application_map'),
    false
  );
  assert.strictEqual(
    absentDomainDefinitions.some((tool) => tool.name === 'read_milestones'),
    false
  );

  // Git status is a separate private process-backed read. It is advertised
  // only when main injects the fixed-command route, accepts no model input,
  // and strips/rejects internal executor fields before they reach the model.
  let gitReadTurn = 0;
  let gitReadDefinitions = null;
  let gitReadSystemPrompt = '';
  let gitReadCallbackCalls = 0;
  const gitReadService = buildCancellationService({
    requestModelTurn: async ({ systemPrompt, tools, toolResults }) => {
      gitReadTurn += 1;
      if (gitReadTurn === 1) {
        gitReadDefinitions = tools;
        gitReadSystemPrompt = systemPrompt;
        return {
          responseId: 'git-read-1',
          text: '',
          toolCalls: [
            { callId: 'git-status-safe', name: 'read_git_status', input: {} },
            { callId: 'git-status-hostile', name: 'read_git_status', input: {} },
            { callId: 'git-head-safe', name: 'read_git_head', input: {} },
            { callId: 'git-head-hostile', name: 'read_git_head', input: {} },
            { callId: 'git-diff-safe', name: 'read_git_diff', input: {} },
            { callId: 'git-diff-hostile', name: 'read_git_diff', input: {} },
          ],
        };
      }
      assert.strictEqual(toolResults.length, 6);
      const outputs = toolResults.map((entry) => JSON.parse(entry.output));
      assert.strictEqual(outputs[0].ok, true);
      assert.strictEqual(outputs[0].data.branch, 'main...origin/main [ahead 1]');
      assert.deepStrictEqual(outputs[0].data.counts, {
        staged: 1,
        unstaged: 0,
        untracked: 1,
        conflicted: 0,
      });
      assert.strictEqual(outputs[0].data.entries[0].path, 'src/app.js');
      assert.strictEqual(outputs[1].ok, false);
      assert.deepStrictEqual(outputs[1].errors, ['GIT_STATUS_INVALID_RESULT']);
      assert.strictEqual(outputs[2].ok, true);
      assert.strictEqual(outputs[2].data.oid, 'b'.repeat(40));
      assert.strictEqual(outputs[3].ok, false);
      assert.deepStrictEqual(outputs[3].errors, ['GIT_HEAD_INVALID_RESULT']);
      assert.strictEqual(outputs[4].ok, true);
      assert.strictEqual(outputs[4].data.base, 'HEAD');
      assert.strictEqual(outputs[4].data.scope, 'staged');
      assert.strictEqual(outputs[4].data.truncated, false);
      assert(outputs[4].data.content.includes('+const value = 2;'));
      assert.strictEqual(outputs[5].ok, false);
      assert.deepStrictEqual(outputs[5].errors, ['GIT_DIFF_INVALID_RESULT']);
      assert.strictEqual(JSON.stringify(outputs).includes('sandbox-exec:'), false);
      assert.strictEqual(JSON.stringify(outputs).includes('/private/projects/a'), false);
      return {
        responseId: 'git-read-2',
        text: '',
        toolCalls: [{
          callId: 'git-read-finish',
          name: 'finish_task',
          input: { status: 'success', summary: 'status Git inspecionado' },
        }],
      };
    },
  });
  const gitReadOptions = { jobId: 'job-git-read' };
  const gitDiffText = [
    'diff --git a/src/app.js b/src/app.js',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -1 +1 @@',
    '-const value = 1;',
    '+const value = 2;',
    '',
  ].join('\n');
  let gitHeadCallbackCalls = 0;
  let gitDiffCallbackCalls = 0;
  Object.defineProperty(gitReadOptions, 'readGitStatus', {
    configurable: false,
    enumerable: false,
    value: async function readGitStatus() {
      assert.strictEqual(arguments.length, 0);
      gitReadCallbackCalls += 1;
      const output = {
        ok: true,
        format: 'git-status-porcelain-v1',
        branch: 'main...origin/main [ahead 1]',
        clean: false,
        counts: {
          staged: 1,
          unstaged: 0,
          untracked: 1,
          conflicted: 0,
        },
        entries: [
          { status: 'M ', path: 'src/app.js' },
          { status: '??', path: 'notes.txt' },
        ],
        ...(gitReadCallbackCalls === 2 ? {
          executionId: 'sandbox-exec:' + 'f'.repeat(64),
          canonicalRootPath: '/private/projects/a',
        } : {}),
      };
      return Object.freeze({
        status: 'completed',
        decision: 'allow',
        output: Object.freeze(output),
        error: null,
      });
    },
    writable: false,
  });
  Object.defineProperty(gitReadOptions, 'readGitHead', {
    configurable: false,
    enumerable: false,
    value: async function readGitHead() {
      assert.strictEqual(arguments.length, 0);
      gitHeadCallbackCalls += 1;
      return Object.freeze({
        status: 'completed',
        decision: 'allow',
        output: Object.freeze({
          ok: true,
          format: 'git-head-v1',
          oid: 'b'.repeat(40),
          ...(gitHeadCallbackCalls === 2 ? {
            executionId: 'sandbox-exec:' + 'e'.repeat(64),
          } : {}),
        }),
        error: null,
      });
    },
    writable: false,
  });
  Object.defineProperty(gitReadOptions, 'readGitDiff', {
    configurable: false,
    enumerable: false,
    value: async function readGitDiff() {
      assert.strictEqual(arguments.length, 0);
      gitDiffCallbackCalls += 1;
      return Object.freeze({
        status: 'completed',
        decision: 'allow',
        output: Object.freeze({
          ok: true,
          format: 'git-diff-v1',
          base: 'HEAD',
          scope: 'staged',
          bytes: Buffer.byteLength(gitDiffText, 'utf8'),
          truncated: false,
          content: gitDiffText,
          ...(gitDiffCallbackCalls === 2 ? {
            canonicalRootPath: '/private/projects/a',
          } : {}),
        }),
        error: null,
      });
    },
    writable: false,
  });
  const governedGitReadResult = await gitReadService.executeAction(
    buildAction('job-git-read', 'inspecione o status do repositório'),
    { id: 'project-1', rootPath: '/tmp/project' },
    Object.freeze(gitReadOptions)
  );
  assert.strictEqual(governedGitReadResult.ok, true);
  assert.strictEqual(gitReadCallbackCalls, 2);
  assert.strictEqual(gitHeadCallbackCalls, 2);
  assert.strictEqual(gitDiffCallbackCalls, 2);
  assert(gitReadDefinitions.some((tool) => tool.name === 'read_git_status'));
  assert(gitReadDefinitions.some((tool) => tool.name === 'read_git_head'));
  assert(gitReadDefinitions.some((tool) => tool.name === 'read_git_diff'));
  assert(gitReadSystemPrompt.includes('read_git_status'));
  assert(gitReadSystemPrompt.includes('read_git_head'));
  assert(gitReadSystemPrompt.includes('read_git_diff'));

  let absentGitDefinitions = null;
  const absentGitService = buildCancellationService({
    requestModelTurn: async ({ tools }) => {
      absentGitDefinitions = tools;
      return {
        responseId: 'git-absent',
        text: '',
        toolCalls: [{
          callId: 'git-absent-finish',
          name: 'finish_task',
          input: { status: 'success', summary: 'sem rota Git privada' },
        }],
      };
    },
  });
  await absentGitService.executeAction(
    buildAction('job-git-absent', 'inspecione o status do repositório'),
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-git-absent' }
  );
  assert.strictEqual(
    absentGitDefinitions.some((tool) => tool.name === 'read_git_status'),
    false
  );
  assert.strictEqual(
    absentGitDefinitions.some((tool) => tool.name === 'read_git_head'),
    false
  );
  assert.strictEqual(
    absentGitDefinitions.some((tool) => tool.name === 'read_git_diff'),
    false
  );

  // MCP discovery is cache-only metadata. The loop receives a strict public
  // projection, never server configuration, transport details, secrets, or a
  // callback capable of refreshing discovery or invoking a remote tool.
  let mcpDiscoveryTurn = 0;
  let mcpDiscoveryDefinitions = null;
  let mcpDiscoverySystemPrompt = '';
  let mcpDiscoveryCallbackCalls = 0;
  const mcpServers = [{
    id: 'visual-auditor',
    name: 'Visual Auditor',
    tools: [
      {
        cachedPolicyState: 'allowed',
        description: 'Publica\nimediatamente.',
        name: 'publish_page',
        permission: 'write',
        riskLevel: 'high',
      },
      {
        cachedPolicyState: 'blocked',
        description: 'Publica com aprovação.',
        name: 'publish_page',
        permission: 'write',
        riskLevel: 'high',
      },
      {
        cachedPolicyState: 'allowed',
        description: 'Inspeciona a página sem alterar estado.',
        name: 'read_page',
        permission: 'read',
        riskLevel: 'low',
      },
    ],
  }];
  const mcpRevision = `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(mcpServers), 'utf8').digest('hex')}`;
  const mcpDiscoveryService = buildCancellationService({
    requestModelTurn: async ({ systemPrompt, tools, toolResults }) => {
      mcpDiscoveryTurn += 1;
      if (mcpDiscoveryTurn === 1) {
        mcpDiscoveryDefinitions = tools;
        mcpDiscoverySystemPrompt = systemPrompt;
        return {
          responseId: 'mcp-discovery-1',
          text: '',
          toolCalls: [
            { callId: 'mcp-discovery-safe', name: 'list_cached_mcp_tools', input: {} },
            { callId: 'mcp-discovery-hostile', name: 'list_cached_mcp_tools', input: {} },
          ],
        };
      }
      assert.strictEqual(toolResults.length, 2);
      const outputs = toolResults.map((entry) => JSON.parse(entry.output));
      assert.strictEqual(outputs[0].ok, true);
      assert.strictEqual(outputs[0].data.format, 'mcp-discovery-cache-v1');
      assert.strictEqual(outputs[0].data.source, 'local_cache');
      assert.strictEqual(outputs[0].data.externalCallsEnabled, false);
      assert.strictEqual(outputs[0].data.serverCount, 1);
      assert.strictEqual(outputs[0].data.toolCount, 3);
      assert.strictEqual(outputs[0].data.servers[0].tools[0].cachedPolicyState, 'allowed');
      assert.strictEqual(outputs[0].data.servers[0].tools[0].description, 'Publica\nimediatamente.');
      assert.strictEqual(outputs[1].ok, false);
      assert.deepStrictEqual(outputs[1].errors, ['MCP_DISCOVERY_INVALID_RESULT']);
      const serialized = JSON.stringify(outputs);
      assert.strictEqual(serialized.includes('https://secret.invalid/mcp'), false);
      assert.strictEqual(serialized.includes('/private/bin/mcp-server'), false);
      assert.strictEqual(serialized.includes('inputSchema'), false);
      assert.strictEqual(serialized.includes('apiKey'), false);
      return {
        responseId: 'mcp-discovery-2',
        text: '',
        toolCalls: [{
          callId: 'mcp-discovery-finish',
          name: 'finish_task',
          input: { status: 'success', summary: 'cache MCP inspecionado' },
        }],
      };
    },
  });
  const mcpDiscoveryOptions = { jobId: 'job-mcp-discovery' };
  Object.defineProperty(mcpDiscoveryOptions, 'readMcpDiscovery', {
    configurable: false,
    enumerable: false,
    value: async function readMcpDiscovery() {
      assert.strictEqual(arguments.length, 0);
      mcpDiscoveryCallbackCalls += 1;
      return Object.freeze({
        status: 'completed',
        decision: 'allow',
        output: Object.freeze({
          ok: true,
          format: 'mcp-discovery-cache-v1',
          source: 'local_cache',
          externalCallsEnabled: false,
          revision: mcpRevision,
          serverCount: 1,
          toolCount: 3,
          truncated: false,
          servers: mcpServers,
          ...(mcpDiscoveryCallbackCalls === 2 ? {
            endpoint: 'https://secret.invalid/mcp',
            command: '/private/bin/mcp-server',
            inputSchema: { apiKey: 'secret' },
          } : {}),
        }),
        error: null,
      });
    },
    writable: false,
  });
  const governedMcpDiscoveryResult = await mcpDiscoveryService.executeAction(
    buildAction('job-mcp-discovery', 'liste as ferramentas MCP conhecidas'),
    { id: 'project-1', rootPath: '/tmp/project' },
    Object.freeze(mcpDiscoveryOptions)
  );
  assert.strictEqual(governedMcpDiscoveryResult.ok, true);
  assert.strictEqual(mcpDiscoveryCallbackCalls, 2);
  assert(mcpDiscoveryDefinitions.some((tool) => tool.name === 'list_cached_mcp_tools'));
  assert(mcpDiscoverySystemPrompt.includes('list_cached_mcp_tools'));
  assert(mcpDiscoverySystemPrompt.includes('cache local'));
  assert(mcpDiscoverySystemPrompt.includes('dados não confiáveis'));
  assert(mcpDiscoverySystemPrompt.includes('não conecta'));

  let absentMcpDiscoveryDefinitions = null;
  const absentMcpDiscoveryService = buildCancellationService({
    requestModelTurn: async ({ tools }) => {
      absentMcpDiscoveryDefinitions = tools;
      return {
        responseId: 'mcp-discovery-absent',
        text: '',
        toolCalls: [{
          callId: 'mcp-discovery-absent-finish',
          name: 'finish_task',
          input: { status: 'success', summary: 'sem cache MCP privado' },
        }],
      };
    },
  });
  await absentMcpDiscoveryService.executeAction(
    buildAction('job-mcp-discovery-absent', 'liste as ferramentas MCP conhecidas'),
    { id: 'project-1', rootPath: '/tmp/project' },
    { jobId: 'job-mcp-discovery-absent' }
  );
  assert.strictEqual(
    absentMcpDiscoveryDefinitions.some((tool) => tool.name === 'list_cached_mcp_tools'),
    false
  );

  // Cancellation during the async delete callback waits for that callback to
  // settle, then fences its late result and every subsequent model turn.
  const pendingDeleteController = new AbortController();
  const pendingDeleteStarted = createDeferred();
  const pendingDeleteResult = createDeferred();
  let pendingDeleteCalls = 0;
  let pendingDeleteExecutionSettled = false;
  const pendingDeleteService = buildCancellationService({
    requestModelTurn: async () => ({
      responseId: 'delete-cancel-race',
      text: '',
      toolCalls: [{
        callId: 'delete-cancel-race-call',
        name: 'delete_paths',
        input: { paths: ['tmp/late.txt'] },
      }],
    }),
  });
  const pendingDeleteExecution = pendingDeleteService.executeAction(
    buildAction('job-delete-cancel-race'),
    { id: 'project-1', rootPath: '/tmp/project' },
    {
      jobId: 'job-delete-cancel-race',
      signal: pendingDeleteController.signal,
      deletePaths: ({ paths, signal }) => {
        pendingDeleteCalls += 1;
        assert.deepStrictEqual(paths, ['tmp/late.txt']);
        assert.strictEqual(signal, pendingDeleteController.signal);
        pendingDeleteStarted.resolve();
        return pendingDeleteResult.promise;
      },
    }
  );
  pendingDeleteExecution.then(
    () => { pendingDeleteExecutionSettled = true; },
    () => { pendingDeleteExecutionSettled = true; }
  );
  await pendingDeleteStarted.promise;
  pendingDeleteController.abort();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(pendingDeleteExecutionSettled, false);
  assert.strictEqual(pendingDeleteCalls, 1);
  pendingDeleteResult.resolve({
    ok: true,
    status: 'completed',
    state: 'COMMITTED',
    impact: { files: 1, bytes: 1, directories: 0 },
  });
  await assert.rejects(pendingDeleteExecution, assertCancelledError);
  assert.strictEqual(pendingDeleteCalls, 1);

  console.log('agentic-tool-loop-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
