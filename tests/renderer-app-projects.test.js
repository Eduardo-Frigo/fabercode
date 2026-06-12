const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app_projects.js'), 'utf8');
const sandbox = {
  console,
  window: {
    FaberProjectSidebar: {
      normalizeProjectItems: (items) => items,
    },
  },
};
sandbox.window.window = sandbox.window;
vm.runInNewContext(source, sandbox, { filename: 'app_projects.js' });

const factory = sandbox.window.FaberAppProjects.createAppProjectController;
assert.strictEqual(typeof factory, 'function');

(async () => {
  const calls = [];
  const state = {
    projectConversations: {
      'project-1': [{ id: 'conversation-1', title: 'Antigo' }],
    },
  };
  const controller = factory({
    api: {
      renameConversation: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          conversations: [{ id: payload.conversationId, title: payload.title }],
        };
      },
    },
    controllers: {
      projectSidebarController: { render: () => calls.push({ render: true }) },
    },
    state,
  });

  await controller.renameConversation(
    'project-1',
    state.projectConversations['project-1'][0],
    'Novo título'
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0])), {
    projectId: 'project-1',
    conversationId: 'conversation-1',
    title: 'Novo título',
  });
  assert.deepStrictEqual(state.projectConversations['project-1'], [
    { id: 'conversation-1', title: 'Novo título' },
  ]);
  assert.deepStrictEqual(calls[1], { render: true });

  {
    const localState = {
      projectConversations: {
        'project-1': [{ id: 'conversation-1', title: 'Antigo' }],
      },
    };
    const localController = factory({ api: {}, state: localState });
    await localController.renameConversation(
      'project-1',
      localState.projectConversations['project-1'][0],
      '  Local  '
    );
    assert.strictEqual(localState.projectConversations['project-1'][0].title, 'Local');
  }

  console.log('renderer-app-projects.test.js: ok');
})();
