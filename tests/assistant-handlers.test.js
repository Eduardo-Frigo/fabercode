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
    /harnessRouter/
  );
  assert.throws(
    () => registerAssistantHandlers({ harnessRouter: {} }),
    /registerIpcHandler/
  );

  const calls = [];
  const planPayload = { projectInfo: { rootPath: '/tmp/project' }, userMessage: 'planejar' };
  const messagePayload = { projectInfo: { rootPath: '/tmp/project' }, isMapChat: true };
  const action = { type: 'operation_batch', operations: [] };
  const projectInfo = { rootPath: '/tmp/project' };
  const planResult = { ok: true, action: null };
  const messageResult = { ok: true, response: 'ok' };
  const executeResult = { ok: false, modifiedFiles: ['src/app.js'] };
  const harnessRouter = {
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
  registerAssistantHandlers({ harnessRouter, registerIpcHandler });

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
  assert.strictEqual(await handlers['assistant:execute'](null, action, projectInfo), executeResult);
  assert.deepStrictEqual(calls, [
    ['plan', planPayload],
    ['message', messagePayload],
    ['execute', action, projectInfo],
  ]);

  const rejection = new Error('kernel unavailable');
  const rejectedMap = createHandlerMap();
  registerAssistantHandlers({
    harnessRouter: {
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

  console.log('assistant-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
