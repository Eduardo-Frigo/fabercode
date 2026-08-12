const assert = require('assert');

const { registerAssistantHandlers } = require('../main/ipc/assistant_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

async function run() {
  assert.throws(
    () => registerAssistantHandlers(),
    /assistantRuntime/
  );
  assert.throws(
    () => registerAssistantHandlers({ assistantRuntime: {} }),
    /registerIpcHandler/
  );
  assert.throws(
    () => registerAssistantHandlers({ assistantRuntime: {}, registerIpcHandler: () => {} }),
    /runtime missing method: plan/
  );

  const calls = [];
  const planPayload = { projectInfo: { rootPath: '/tmp/project' }, userMessage: 'planejar' };
  const messagePayload = { projectInfo: { rootPath: '/tmp/project' }, isMapChat: true };
  const executePayload = { jobId: 'job-1' };
  const planResult = { ok: true, action: null };
  const messageResult = { ok: true, response: 'ok' };
  const executeResult = { ok: false, modifiedFiles: ['src/app.js'] };
  const assistantRuntime = {
    plan: async (payload) => {
      calls.push(['plan', payload]);
      return planResult;
    },
    message: async (payload) => {
      calls.push(['message', payload]);
      return messageResult;
    },
    execute: async (...args) => {
      calls.push(['execute', ...args]);
      return executeResult;
    },
  };
  const { handlers, registerIpcHandler } = createHandlerMap();
  registerAssistantHandlers({ assistantRuntime, registerIpcHandler });

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'assistant:execute',
    'assistant:message',
    'assistant:plan',
  ]);
  assert.strictEqual(Object.hasOwn(handlers, 'assistant:route'), false);
  assert.strictEqual(Object.hasOwn(handlers, 'job:cancel'), false);
  assert.strictEqual(Object.hasOwn(handlers, 'tools:list'), false);

  assert.strictEqual(await handlers['assistant:plan'](null, planPayload), planResult);
  assert.strictEqual(await handlers['assistant:message'](null, messagePayload), messageResult);
  assert.strictEqual(await handlers['assistant:execute'](null, executePayload), executeResult);
  assert.deepStrictEqual(calls, [
    ['plan', planPayload],
    ['message', messagePayload],
    ['execute', executePayload],
  ]);

  const invalidInput = { ok: false, code: 'assistant_ipc_invalid_input' };
  const callsBeforeInvalidInput = calls.length;
  for (const channel of ['assistant:plan', 'assistant:message']) {
    assert.deepStrictEqual(await handlers[channel](null), invalidInput);
    assert.deepStrictEqual(await handlers[channel](null, {}, {}), invalidInput);
    assert.deepStrictEqual(await handlers[channel](null, null), invalidInput);
    assert.deepStrictEqual(await handlers[channel](null, []), invalidInput);
    assert.deepStrictEqual(await handlers[channel](null, Object.create({ inherited: true })), invalidInput);

    let getterReads = 0;
    const accessorPayload = {};
    Object.defineProperty(accessorPayload, 'userMessage', {
      enumerable: true,
      get() {
        getterReads += 1;
        return 'não deve ser lido';
      },
    });
    assert.deepStrictEqual(await handlers[channel](null, accessorPayload), invalidInput);
    assert.strictEqual(getterReads, 0);

    const symbolPayload = {};
    symbolPayload[Symbol('hostile')] = true;
    assert.deepStrictEqual(await handlers[channel](null, symbolPayload), invalidInput);
  }

  assert.deepStrictEqual(await handlers['assistant:execute'](null), invalidInput);
  assert.deepStrictEqual(await handlers['assistant:execute'](null, executePayload, {}), invalidInput);
  assert.deepStrictEqual(await handlers['assistant:execute'](null, { jobId: 'job-1', action: {} }), invalidInput);
  assert.deepStrictEqual(await handlers['assistant:execute'](null, {}), invalidInput);
  assert.deepStrictEqual(await handlers['assistant:execute'](null, Object.create({ jobId: 'job-1' })), invalidInput);

  let jobIdGetterReads = 0;
  const accessorExecute = {};
  Object.defineProperty(accessorExecute, 'jobId', {
    enumerable: true,
    get() {
      jobIdGetterReads += 1;
      return 'job-1';
    },
  });
  assert.deepStrictEqual(await handlers['assistant:execute'](null, accessorExecute), invalidInput);
  assert.strictEqual(jobIdGetterReads, 0);

  const symbolExecute = { jobId: 'job-1' };
  symbolExecute[Symbol('hostile')] = true;
  assert.deepStrictEqual(await handlers['assistant:execute'](null, symbolExecute), invalidInput);
  assert.strictEqual(calls.length, callsBeforeInvalidInput);

  const rejection = new Error('kernel unavailable');
  const rejectedMap = createHandlerMap();
  registerAssistantHandlers({
    assistantRuntime: {
      plan: async () => { throw rejection; },
      message: async () => { throw rejection; },
      execute: async () => { throw rejection; },
    },
    registerIpcHandler: rejectedMap.registerIpcHandler,
  });
  await assert.rejects(
    rejectedMap.handlers['assistant:message'](null, messagePayload),
    (error) => error === rejection
  );
  await assert.rejects(
    rejectedMap.handlers['assistant:plan'](null, planPayload),
    (error) => error === rejection
  );
  await assert.rejects(
    rejectedMap.handlers['assistant:execute'](null, executePayload),
    (error) => error === rejection
  );

  console.log('assistant-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
