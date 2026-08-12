const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const calls = [];
const listeners = [];
const exposed = {};
const ipcRenderer = {
  invoke: (channel, ...args) => {
    calls.push({ type: 'invoke', channel, args });
    return Promise.resolve({ ok: true, channel, args });
  },
  on: (channel, listener) => {
    listeners.push({ channel, listener });
  },
  removeListener: (channel, listener) => {
    calls.push({ type: 'removeListener', channel, args: [listener] });
  },
};
const sandbox = {
  require: (moduleName) => {
    if (moduleName !== 'electron') return require(moduleName);
    return {
      contextBridge: {
        exposeInMainWorld: (name, api) => {
          exposed[name] = api;
        },
      },
      ipcRenderer,
    };
  },
};

vm.runInNewContext(source, sandbox, { filename: 'preload.js' });

const api = exposed.localcodeApi;
assert.ok(api, 'localcodeApi should be exposed through contextBridge');

const preservedFeatureFunctionNames = [
  // Cortex memory.
  'getCortexLearning',
  'learnWithCortex',
  'upsertCortexTopic',
  'renameCortexTopic',
  'getMempalaceStatus',
  'indexProjectInMempalace',
  'searchMempalace',
  'getKnowledgeRuntimeStatus',
  'searchKnowledgeRuntime',
  'listMemoryEvidence',
  'runKnowledgeMemoryLifecycle',
  // Files panel.
  'getProjectFilesTree',
  'revealFileInFolder',
  'readProjectFile',
  'previewProjectImage',
  'writeProjectFile',
  'renameProjectFile',
  // Git panel.
  'getProjectGitStatus',
  'getProjectGitWorktree',
  'getProjectGitCommits',
  'initProjectGitRepository',
  'stageProjectGitFiles',
  'unstageProjectGitFiles',
  'commitProjectGitFiles',
  'rollbackProjectGitFiles',
  'rollbackProjectGitToCommit',
  // Application map.
  'getApplicationMap',
  'saveApplicationMap',
  'upsertApplicationMapNode',
  'removeApplicationMapNode',
  'upsertApplicationMapEdge',
  'removeApplicationMapEdge',
  'importApplicationMapAsset',
  'renderApplicationMap',
  'getApplicationMapSummary',
  // Milestones.
  'listMilestones',
  'getMilestone',
  'saveMilestones',
  'updateMilestoneStatus',
  'updateMilestoneTask',
  'linkMilestoneCommit',
  'getMilestoneGitStatus',
  'renderMilestones',
  // Application-map chat and persisted conversations.
  'routePersonaRequest',
  'buildPlan',
  'sendAssistantMessage',
  'listConversations',
  'addConversation',
  'renameConversation',
  'deleteConversation',
  'listConversationMessages',
  'addConversationMessage',
  // Assistant execution and local project execution.
  'executePlan',
  'cancelJob',
  'retryJob',
  'getProjectPreviewPlan',
  'startProjectPreview',
  'stopProjectPreview',
  'getProjectPreviewRuntimeStatus',
  'listProjectTerminalSessions',
  'createProjectTerminalSession',
  'runProjectTerminalCommand',
  'stopProjectTerminalCommand',
  'clearProjectTerminalSession',
  'closeProjectTerminalSession',
];

for (const methodName of preservedFeatureFunctionNames) {
  assert.strictEqual(
    typeof api[methodName],
    'function',
    `${methodName} should remain exposed as a function`
  );
}

async function assertInvoke(methodName, args, expectedChannel, expectedArgs = args) {
  calls.length = 0;
  await api[methodName](...args);
  assert.deepStrictEqual(calls, [
    { type: 'invoke', channel: expectedChannel, args: expectedArgs },
  ]);
}

(async () => {
  await assertInvoke('getAccountStatus', [], 'account:status');
  await assertInvoke('startGoogleLogin', [{ openExternal: true }], 'account:google:start');
  await assertInvoke('completeGoogleLogin', [{ code: 'code', state: 'state' }], 'account:google:complete');
  await assertInvoke('startGithubAccountLogin', [{ openExternal: true }], 'account:github:start');
  await assertInvoke('completeGithubAccountLogin', [{ code: 'code', state: 'state' }], 'account:github:complete');
  await assertInvoke('startEmailLogin', [{ email: 'owner@example.com' }], 'account:email:start');
  await assertInvoke(
    'completeEmailLogin',
    [{ email: 'owner@example.com', code: '123456' }],
    'account:email:complete'
  );
  await assertInvoke(
    'signInWithPassword',
    [{ email: 'owner@example.com', password: 'password123' }],
    'account:password:sign-in'
  );
  await assertInvoke(
    'signUpWithPassword',
    [{
      name: 'Owner Example',
      email: 'owner@example.com',
      password: 'password123',
      themePreference: 'dark',
      languagePreference: 'pt-BR',
    }],
    'account:password:sign-up'
  );
  await assertInvoke('signOutAccount', [], 'account:sign-out');
  const accountEvents = [];
  const unsubscribeAccount = api.onAccountEvent((payload) => accountEvents.push(payload));
  assert.strictEqual(listeners.some((item) => item.channel === 'account:event'), true);
  const accountListener = listeners.find((item) => item.channel === 'account:event');
  accountListener.listener(null, { type: 'signed-in' });
  assert.deepStrictEqual(accountEvents, [{ type: 'signed-in' }]);
  calls.length = 0;
  unsubscribeAccount();
  assert.strictEqual(calls[0].type, 'removeListener');
  assert.strictEqual(calls[0].channel, 'account:event');

  await assertInvoke('importProjectPath', [{ rootPath: '/tmp/app' }], 'projects:import-path');
  await assertInvoke('getProjectPreviewPlan', [{ rootPath: '/tmp/app' }], 'project:preview:plan');
  await assertInvoke('listTools', [], 'tools:list');
  await assertInvoke('startProjectPreview', [{ rootPath: '/tmp/app', open: true }], 'project:preview:start');
  await assertInvoke('stopProjectPreview', [{ rootPath: '/tmp/app' }], 'project:preview:stop');
  await assertInvoke(
    'getProjectPreviewRuntimeStatus',
    [{ rootPath: '/tmp/app' }],
    'project:preview:runtime-status'
  );
  const selectedProjectInfo = { id: 'project-1', rootPath: '/tmp/app' };
  const assistantPayload = {
    projectInfo: selectedProjectInfo,
    userMessage: 'Build the application',
  };
  await assertInvoke('routePersonaRequest', [assistantPayload], 'assistant:route');
  await assertInvoke('buildPlan', [assistantPayload], 'assistant:plan');
  await assertInvoke(
    'executePlan',
    [{ jobId: 'job-1' }],
    'assistant:execute',
    [{ jobId: 'job-1' }]
  );
  await assertInvoke('cancelJob', [{ jobId: 'job-1' }], 'orchestration:jobs:cancel');
  await assertInvoke('retryJob', [{ jobId: 'job-1' }], 'orchestration:jobs:retry');
  assert.strictEqual((source.match(/\bcancelJob\s*:/g) || []).length, 1);
  assert.strictEqual(source.includes("ipcRenderer.invoke('job:cancel'"), false);

  await assertInvoke('listProjectTerminalSessions', [{ rootPath: '/tmp/app' }], 'project:terminal:list');
  await assertInvoke('createProjectTerminalSession', [{ rootPath: '/tmp/app' }], 'project:terminal:create');
  await assertInvoke(
    'runProjectTerminalCommand',
    [{ rootPath: '/tmp/app', sessionId: 't1', command: 'npm run dev' }],
    'project:terminal:run'
  );
  await assertInvoke(
    'stopProjectTerminalCommand',
    [{ rootPath: '/tmp/app', sessionId: 't1' }],
    'project:terminal:stop'
  );
  await assertInvoke(
    'clearProjectTerminalSession',
    [{ rootPath: '/tmp/app', sessionId: 't1' }],
    'project:terminal:clear'
  );
  await assertInvoke(
    'closeProjectTerminalSession',
    [{ rootPath: '/tmp/app', sessionId: 't1' }],
    'project:terminal:close'
  );

  const received = [];
  const unsubscribe = api.onProjectTerminalEvent((payload) => received.push(payload));
  const terminalListener = listeners.find((item) => item.channel === 'project:terminal:event');
  assert.ok(terminalListener);
  terminalListener.listener(null, { type: 'output', sessionId: 't1' });
  assert.deepStrictEqual(received, [{ type: 'output', sessionId: 't1' }]);
  calls.length = 0;
  unsubscribe();
  assert.strictEqual(calls[0].type, 'removeListener');
  assert.strictEqual(calls[0].channel, 'project:terminal:event');

  await assertInvoke('getProjectFilesTree', [{ rootPath: '/tmp/app' }], 'project:files-tree');
  await assertInvoke('revealFileInFolder', [{ projectInfo: {}, relativePath: 'src/app.js' }], 'file:reveal');
  await assertInvoke('readProjectFile', [{ projectInfo: {}, relativePath: 'src/app.js' }], 'file:read');
  await assertInvoke(
    'previewProjectImage',
    [{ projectInfo: {}, relativePath: 'src/image.png' }],
    'file:preview-image'
  );
  await assertInvoke(
    'writeProjectFile',
    [{ projectInfo: {}, relativePath: 'src/app.js', content: 'ok' }],
    'file:write'
  );
  await assertInvoke(
    'renameProjectFile',
    [{ projectInfo: {}, relativePath: 'src/app.js', nextName: 'main.js' }],
    'file:rename'
  );

  await assertInvoke('getProjectGitStatus', [{ rootPath: '/tmp/app' }], 'project:git:status');
  await assertInvoke('getProjectGitWorktree', [{ rootPath: '/tmp/app' }], 'project:git:worktree');
  await assertInvoke(
    'getProjectGitCommits',
    [{ rootPath: '/tmp/app', limit: 20 }],
    'project:git:commits'
  );
  await assertInvoke('initProjectGitRepository', [{ rootPath: '/tmp/app' }], 'project:git:init');
  await assertInvoke(
    'stageProjectGitFiles',
    [{ rootPath: '/tmp/app', files: ['src/app.js'] }],
    'project:git:stage'
  );
  await assertInvoke(
    'unstageProjectGitFiles',
    [{ rootPath: '/tmp/app', files: ['src/app.js'] }],
    'project:git:unstage'
  );
  await assertInvoke(
    'commitProjectGitFiles',
    [{ rootPath: '/tmp/app', message: 'Ajusta UI' }],
    'project:git:commit'
  );
  await assertInvoke(
    'rollbackProjectGitFiles',
    [{ rootPath: '/tmp/app', files: ['src/app.js'] }],
    'project:git:rollback'
  );
  await assertInvoke(
    'rollbackProjectGitToCommit',
    [{ rootPath: '/tmp/app', commitHash: 'abc1234' }],
    'project:git:rollback-to-commit'
  );
  await assertInvoke('getGithubAuthStatus', [], 'project:github:auth-status');
  await assertInvoke('listGithubRepositories', [{ limit: 20 }], 'project:github:list-repos');
  await assertInvoke(
    'cloneGithubRepository',
    [{ parentProjectRoot: '/tmp/app', repoFullName: 'owner/repo' }],
    'project:github:clone'
  );
  await assertInvoke('getGithubPublishPlan', [{ rootPath: '/tmp/app' }], 'project:github:publish-plan');
  await assertInvoke('publishProjectToGithub', [{ rootPath: '/tmp/app' }], 'project:github:publish');
  await assertInvoke('openProjectLatestVersion', [{ rootPath: '/tmp/app' }], 'project:git:open-latest');
  await assertInvoke('openProjectDeploy', [{ rootPath: '/tmp/app' }], 'project:deploy:open');

  await assertInvoke('listAutomataContracts', [{ projectId: 'project-1' }], 'automata:contracts:list');
  await assertInvoke('getAutomataContractSummary', [{ projectId: 'project-1' }], 'automata:contracts:summary');
  await assertInvoke(
    'suggestAutomataContract',
    [{ contract: { title: 'Novo contrato' } }],
    'automata:contracts:suggest'
  );
  await assertInvoke('stageAutomataContract', [{ id: 'ledger-1' }], 'automata:contracts:stage');
  await assertInvoke(
    'markAutomataContractTrial',
    [{ id: 'ledger-1', passed: true }],
    'automata:contracts:trial'
  );
  await assertInvoke('promoteAutomataContract', [{ id: 'ledger-1' }], 'automata:contracts:promote');
  await assertInvoke('rejectAutomataContract', [{ id: 'ledger-1' }], 'automata:contracts:reject');

  await assertInvoke('listExternalMcpServers', [], 'external-mcp:servers:list');
  await assertInvoke('listExternalMcpPresets', [], 'external-mcp:presets:list');
  await assertInvoke(
    'applyExternalMcpPreset',
    [{ presetId: 'official-filesystem' }],
    'external-mcp:presets:apply'
  );
  await assertInvoke(
    'saveExternalMcpServer',
    [{ server: { id: 'visual-auditor', name: 'Visual Auditor' } }],
    'external-mcp:servers:save'
  );
  await assertInvoke(
    'removeExternalMcpServer',
    [{ id: 'visual-auditor' }],
    'external-mcp:servers:remove'
  );
  await assertInvoke(
    'discoverExternalMcpTools',
    [{ serverId: 'visual-auditor', refresh: true }],
    'external-mcp:tools:discover'
  );
  await assertInvoke(
    'callExternalMcpTool',
    [{
      serverId: 'visual-auditor',
      toolName: 'visual.capture',
      args: { viewport: { width: 720, height: 405 } },
    }],
    'external-mcp:tools:call'
  );

  await assertInvoke('getMempalaceStatus', [{ rootPath: '/tmp/app' }], 'mempalace:status');
  await assertInvoke('indexProjectInMempalace', [{ rootPath: '/tmp/app' }], 'mempalace:index-project');
  await assertInvoke(
    'searchMempalace',
    [{ projectInfo: { rootPath: '/tmp/app' }, query: 'deploy' }],
    'mempalace:search'
  );
  await assertInvoke(
    'getKnowledgeRuntimeStatus',
    [{ projectId: 'project-1', projectInfo: { rootPath: '/tmp/app' } }],
    'knowledge:runtime:status'
  );
  await assertInvoke(
    'searchKnowledgeRuntime',
    [{ projectInfo: { rootPath: '/tmp/app' }, query: 'deploy' }],
    'knowledge:runtime:search'
  );
  await assertInvoke(
    'listMemoryEvidence',
    [{ projectInfo: { rootPath: '/tmp/app' }, jobId: 'job-1' }],
    'knowledge:memory-ledger:list'
  );
  await assertInvoke(
    'runKnowledgeMemoryLifecycle',
    [{ projectInfo: { rootPath: '/tmp/app' }, action: 'reindex' }],
    'knowledge:runtime:lifecycle'
  );
  await assertInvoke('getCortexLearning', [{ projectId: 'project-1' }], 'cortex:learning:get');
  await assertInvoke(
    'learnWithCortex',
    [{
      projectId: 'project-1',
      projectInfo: { rootPath: '/tmp/app' },
      userMessage: 'Use semantic design tokens.',
      attachments: [],
      topic: 'design',
    }],
    'cortex:learning:learn'
  );
  await assertInvoke(
    'upsertCortexTopic',
    [{ projectId: 'project-1', topic: { id: 'design', label: 'Design System' } }],
    'cortex:topic:upsert'
  );
  await assertInvoke(
    'renameCortexTopic',
    [{ projectId: 'project-1', topicId: 'design', label: 'UI e Experiencia' }],
    'cortex:topic:rename'
  );

  const mapPayload = { rootPath: '/tmp/app' };
  await assertInvoke('getApplicationMap', [mapPayload], 'application-map:get');
  await assertInvoke(
    'saveApplicationMap',
    [{ rootPath: '/tmp/app', map: { nodes: [], edges: [], viewport: {} } }],
    'application-map:save'
  );
  await assertInvoke(
    'upsertApplicationMapNode',
    [{ rootPath: '/tmp/app', node: { id: 'screen-home', type: 'screen' } }],
    'application-map:node:upsert'
  );
  await assertInvoke(
    'removeApplicationMapNode',
    [{ rootPath: '/tmp/app', nodeId: 'screen-home' }],
    'application-map:node:remove'
  );
  await assertInvoke(
    'upsertApplicationMapEdge',
    [{
      rootPath: '/tmp/app',
      edge: { id: 'edge-1', sourceNodeId: 'a', targetNodeId: 'b' },
    }],
    'application-map:edge:upsert'
  );
  await assertInvoke(
    'removeApplicationMapEdge',
    [{ rootPath: '/tmp/app', edgeId: 'edge-1' }],
    'application-map:edge:remove'
  );
  await assertInvoke(
    'importApplicationMapAsset',
    [{ rootPath: '/tmp/app', kind: 'image', sourcePath: '/tmp/reference.png' }],
    'application-map:asset:import'
  );
  await assertInvoke('renderApplicationMap', [mapPayload], 'application-map:render');
  await assertInvoke('getApplicationMapSummary', [mapPayload], 'application-map:summary');

  await assertInvoke('listMilestones', [mapPayload], 'milestones:list');
  await assertInvoke(
    'getMilestone',
    [{ rootPath: '/tmp/app', milestoneId: 'milestone-1' }],
    'milestones:get'
  );
  await assertInvoke(
    'saveMilestones',
    [{ rootPath: '/tmp/app', milestones: [{ id: 'milestone-1', tasks: [] }] }],
    'milestones:save'
  );
  await assertInvoke(
    'updateMilestoneStatus',
    [{ rootPath: '/tmp/app', milestoneId: 'milestone-1', status: 'active' }],
    'milestones:update-status'
  );
  await assertInvoke(
    'updateMilestoneTask',
    [{
      rootPath: '/tmp/app',
      milestoneId: 'milestone-1',
      taskId: 'task-1',
      task: { status: 'done' },
    }],
    'milestones:update-task'
  );
  await assertInvoke(
    'linkMilestoneCommit',
    [{ rootPath: '/tmp/app', milestoneId: 'milestone-1', commit: { hash: 'abc1234' } }],
    'milestones:link-commit'
  );
  await assertInvoke(
    'getMilestoneGitStatus',
    [{ rootPath: '/tmp/app', milestoneId: 'milestone-1' }],
    'milestones:git-status'
  );
  await assertInvoke('renderMilestones', [mapPayload], 'milestones:render');

  const mapChatPayload = {
    projectInfo: { rootPath: '/tmp/app' },
    userMessage: 'Quais partes do mapa ainda precisam de definição?',
    contextHint: 'Atue somente como assistente de modelagem.',
    conversationMessages: [],
    attachments: [],
    isMapChat: true,
  };
  await assertInvoke('sendAssistantMessage', [mapChatPayload], 'assistant:message');
  await assertInvoke('listConversations', [], 'orchestration:conversations:list');
  await assertInvoke(
    'addConversation',
    [{ projectId: 'project-1', title: 'Mapa', meta: { source: 'map_chat' } }],
    'orchestration:conversation:add'
  );
  await assertInvoke(
    'renameConversation',
    [{ projectId: 'project-1', conversationId: 'conversation-1', title: 'Mapa revisado' }],
    'orchestration:conversation:rename'
  );
  await assertInvoke(
    'deleteConversation',
    [{ projectId: 'project-1', conversationId: 'conversation-1' }],
    'orchestration:conversation:delete'
  );
  await assertInvoke(
    'listConversationMessages',
    [{ conversationId: 'conversation-1', limit: 200 }],
    'orchestration:conversation:messages:list'
  );
  await assertInvoke(
    'addConversationMessage',
    [{
      projectId: 'project-1',
      conversationId: 'conversation-1',
      role: 'user',
      text: 'Revisar mapa',
      attachments: [],
      meta: { mode: 'map_chat' },
    }],
    'orchestration:conversation:message:add'
  );

  console.log('preload-api-contract.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
