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

  {
    const switchCalls = [];
    const switchState = {
      activeConversationByProject: {},
      activeJobId: 'job-active',
      automataContractLedger: [],
      automataContractSummary: null,
      expandedProjects: {},
      nextSteps: [],
      pendingAction: { targetFile: 'src/pending.js' },
      pendingActionJobId: 'job-pending',
      projectConversations: {},
      projects: [
        { id: 'project-1', name: 'One', rootPath: '/workspace/one' },
        { id: 'project-2', name: 'Two', rootPath: '/workspace/two' },
      ],
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
      uiMode: 'default',
    };
    const switchController = factory({
      api: {
        cancelJob: async (payload) => {
          switchCalls.push(['cancel', payload]);
          return { ok: true, job: { id: payload.jobId, status: 'cancelled' } };
        },
        getMempalaceStatus: async () => null,
        scanProject: async (rootPath) => ({
          ok: true,
          info: { id: 'project-2', rootPath, totalFiles: 1 },
          nextSteps: [],
        }),
      },
      callbacks: {
        clearPending: () => {
          switchState.pendingAction = null;
          switchState.pendingActionJobId = null;
        },
      },
      state: switchState,
    });
    await switchController.selectProject('project-2');
    assert.strictEqual(JSON.stringify(switchCalls[0]), JSON.stringify(['cancel', { jobId: 'job-pending' }]));
    assert.strictEqual(switchState.selectedProjectId, 'project-2');
    assert.strictEqual(switchState.pendingAction, null);
    assert.strictEqual(switchState.pendingActionJobId, null);

    const deniedState = {
      ...switchState,
      activeJobId: null,
      pendingAction: { targetFile: 'src/preserved.js' },
      pendingActionJobId: 'job-cancel-denied',
      selectedProjectId: 'project-1',
      selectedProjectInfo: { id: 'project-1', rootPath: '/workspace/one' },
    };
    const deniedController = factory({
      api: {
        cancelJob: async () => ({ ok: false, message: 'Cancel denied.' }),
        scanProject: async () => {
          throw new Error('project scan must not run after cancellation failure');
        },
      },
      state: deniedState,
    });
    await deniedController.selectProject('project-2');
    assert.strictEqual(deniedState.selectedProjectId, 'project-1');
    assert.strictEqual(deniedState.pendingActionJobId, 'job-cancel-denied');
  }

  console.log('renderer-app-projects.test.js: ok');
})();
