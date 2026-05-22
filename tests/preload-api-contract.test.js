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

  await assertInvoke('getProjectPreviewPlan', [{ rootPath: '/tmp/app' }], 'project:preview:plan');
  await assertInvoke('startProjectPreview', [{ rootPath: '/tmp/app', open: true }], 'project:preview:start');
  await assertInvoke('stopProjectPreview', [{ rootPath: '/tmp/app' }], 'project:preview:stop');
  await assertInvoke(
    'getProjectPreviewRuntimeStatus',
    [{ rootPath: '/tmp/app' }],
    'project:preview:runtime-status'
  );

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
  await assertInvoke('getGithubAuthStatus', [], 'project:github:auth-status');
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

  console.log('preload-api-contract.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
