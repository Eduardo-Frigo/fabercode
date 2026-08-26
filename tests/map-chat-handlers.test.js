'use strict';

const assert = require('assert');

const { registerMapChatHandlers } = require('../main/ipc/map_chat_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler(channel, handler) {
      handlers[channel] = handler;
    },
  };
}

async function run() {
  assert.throws(
    () => registerMapChatHandlers(),
    /mapChatSessionService/,
  );
  assert.throws(
    () => registerMapChatHandlers({ mapChatSessionService: {} }),
    /registerIpcHandler/,
  );
  assert.throws(
    () => registerMapChatHandlers({
      mapChatSessionService: {},
      registerIpcHandler: () => {},
    }),
    /sendMessage/,
  );

  const calls = [];
  const result = Object.freeze({
    ok: true,
    conversationId: 'conversation-1',
    response: 'Mapa compreendido.',
  });
  const mapChatSessionService = {
    async analyze(payload) {
      calls.push(['analyze', payload]);
      return result;
    },
    async sendMessage(payload) {
      calls.push(['send', payload]);
      return result;
    },
    async analyzeRender(payload) {
      calls.push(['analyze-render', payload]);
      return result;
    },
    async sendRenderMessage(payload) {
      calls.push(['send-render', payload]);
      return result;
    },
  };
  const { handlers, registerIpcHandler } = createHandlerMap();
  registerMapChatHandlers({ mapChatSessionService, registerIpcHandler });
  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'application-map:chat:analyze',
    'application-map:chat:message',
    'application-map:render:analyze',
    'application-map:render:message',
  ]);

  const payload = {
    projectId: 'project-1',
    rootPath: '/workspace/project',
    conversationId: 'conversation-1',
    userMessage: 'Quais lacunas ainda existem?',
    locale: 'pt-BR',
  };
  assert.strictEqual(
    await handlers['application-map:chat:message'](null, payload),
    result,
  );
  assert.deepStrictEqual(calls, [['send', payload]]);

  const analyzePayload = {
    projectId: 'project-1',
    rootPath: '/workspace/project',
    conversationId: 'conversation-1',
    locale: 'pt-BR',
  };
  assert.strictEqual(
    await handlers['application-map:chat:analyze'](null, analyzePayload),
    result,
  );
  assert.deepStrictEqual(calls.at(-1), ['analyze', analyzePayload]);

  const renderAnalyzePayload = {
    ...analyzePayload,
    conversationId: 'render-conversation-1',
    userMessage: 'Gerar análise inicial.',
  };
  assert.strictEqual(
    await handlers['application-map:render:analyze'](null, renderAnalyzePayload),
    result,
  );
  const renderMessagePayload = {
    ...renderAnalyzePayload,
    attachments: [],
  };
  assert.strictEqual(
    await handlers['application-map:render:message'](null, renderMessagePayload),
    result,
  );

  // The service method is captured during registration.
  mapChatSessionService.sendMessage = async () => ({ ok: false, code: 'forged' });
  mapChatSessionService.analyze = async () => ({ ok: false, code: 'forged' });
  mapChatSessionService.analyzeRender = async () => ({ ok: false, code: 'forged' });
  mapChatSessionService.sendRenderMessage = async () => ({ ok: false, code: 'forged' });
  assert.strictEqual(
    await handlers['application-map:chat:message'](null, payload),
    result,
  );

  const invalidResult = { ok: false, code: 'map_chat_ipc_invalid_input' };
  const invalidInputs = [
    [],
    [payload, {}],
    [null],
    [[]],
    [{}],
    [{ ...payload, extraAuthority: true }],
    [{
      projectId: payload.projectId,
      rootPath: payload.rootPath,
      conversationId: payload.conversationId,
      userMessage: payload.userMessage,
    }],
    [Object.create({ ...payload })],
  ];
  for (const args of invalidInputs) {
    assert.deepStrictEqual(
      await handlers['application-map:chat:message'](null, ...args),
      invalidResult,
    );
  }
  assert.deepStrictEqual(
    await handlers['application-map:chat:analyze'](null, { ...analyzePayload, userMessage: 'forged' }),
    invalidResult,
  );
  assert.deepStrictEqual(
    await handlers['application-map:render:message'](null, {
      ...renderMessagePayload,
      attachments: [{ path: '/tmp/file' }],
    }),
    invalidResult,
  );

  let getterReads = 0;
  const accessorPayload = { ...payload };
  Object.defineProperty(accessorPayload, 'userMessage', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'não deve ser lido';
    },
  });
  assert.deepStrictEqual(
    await handlers['application-map:chat:message'](null, accessorPayload),
    invalidResult,
  );
  assert.strictEqual(getterReads, 0);

  const symbolPayload = { ...payload };
  symbolPayload[Symbol('hostile')] = true;
  assert.deepStrictEqual(
    await handlers['application-map:chat:message'](null, symbolPayload),
    invalidResult,
  );
  assert.strictEqual(calls.length, 5);

  const rejection = new Error('runtime unavailable');
  const rejected = createHandlerMap();
  registerMapChatHandlers({
    mapChatSessionService: {
      analyze: async () => { throw rejection; },
      analyzeRender: async () => { throw rejection; },
      sendMessage: async () => { throw rejection; },
      sendRenderMessage: async () => { throw rejection; },
    },
    registerIpcHandler: rejected.registerIpcHandler,
  });
  await assert.rejects(
    rejected.handlers['application-map:chat:message'](null, payload),
    (error) => error === rejection,
  );
  await assert.rejects(
    rejected.handlers['application-map:chat:analyze'](null, analyzePayload),
    (error) => error === rejection,
  );

  console.log('map-chat-handlers tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
