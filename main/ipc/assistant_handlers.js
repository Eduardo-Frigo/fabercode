function registerAssistantHandlers(dependencies = {}) {
  const {
    harnessRouter,
    registerIpcHandler,
  } = dependencies;

  if (!harnessRouter) {
    throw new Error('Assistant IPC dependency missing: harnessRouter');
  }
  if (typeof registerIpcHandler !== 'function') {
    throw new Error('Assistant IPC dependency missing: registerIpcHandler');
  }
  for (const method of ['plan', 'message', 'execute']) {
    if (typeof harnessRouter[method] !== 'function') {
      throw new Error(`Assistant IPC harness router missing method: ${method}`);
    }
  }

  registerIpcHandler('assistant:plan', async (_, payload) => harnessRouter.plan(payload));
  registerIpcHandler('assistant:message', async (_, payload) => harnessRouter.message(payload));
  registerIpcHandler(
    'assistant:execute',
    async (_, action, projectInfo) => harnessRouter.execute(action, projectInfo)
  );
}

module.exports = {
  registerAssistantHandlers,
};
