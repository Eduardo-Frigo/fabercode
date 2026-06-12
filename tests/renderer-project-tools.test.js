const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const supportSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools_support.js'), 'utf8');
const deploySource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools_github_deploy.js'), 'utf8');
const gitSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools_git.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools.js'), 'utf8');
const sandbox = {
  window: {
    confirm: () => true,
  },
};
sandbox.window.window = sandbox.window;

vm.runInNewContext(supportSource, sandbox, { filename: 'project_tools_support.js' });
vm.runInNewContext(deploySource, sandbox, { filename: 'project_tools_github_deploy.js' });
vm.runInNewContext(gitSource, sandbox, { filename: 'project_tools_git.js' });
vm.runInNewContext(source, sandbox, { filename: 'project_tools.js' });

const tools = sandbox.window.FaberProjectTools;
const support = sandbox.window.FaberProjectToolsSupport;
const deployTools = sandbox.window.FaberProjectToolsGithubDeploy;
const gitTools = sandbox.window.FaberProjectToolsGit;
assert.ok(support, 'FaberProjectToolsSupport should be registered');
assert.ok(deployTools, 'FaberProjectToolsGithubDeploy should be registered');
assert.ok(gitTools, 'FaberProjectToolsGit should be registered');
assert.ok(tools, 'FaberProjectTools should be registered');
assert.strictEqual(typeof deployTools.createProjectGithubDeployTool, 'function');
assert.strictEqual(typeof gitTools.createProjectGitTool, 'function');
assert.strictEqual(tools.formatGithubPublishPlan, support.formatGithubPublishPlan);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(support.buildGitWorktreeViewModel({
    isGitRepo: true,
    latest: { hash: 'abc1234', subject: 'commit' },
    entries: [
      { path: 'novo.txt', status: 'untracked', unstaged: true, add: 2 },
      { path: 'editado.css', status: 'modified', unstaged: true, add: 4, del: 1 },
      { path: 'stage.js', status: 'staged', staged: true, add: 1, del: 3 },
    ],
  }))),
  {
    activeStep: 'untracked',
    entries: [
      { path: 'novo.txt', status: 'untracked', unstaged: true, add: 2 },
      { path: 'editado.css', status: 'modified', unstaged: true, add: 4, del: 1 },
      { path: 'stage.js', status: 'staged', staged: true, add: 1, del: 3 },
    ],
    hasCommit: true,
    latest: { hash: 'abc1234', subject: 'commit' },
    modifiedEntries: [{ path: 'editado.css', status: 'modified', unstaged: true, add: 4, del: 1 }],
    stagedEntries: [{ path: 'stage.js', status: 'staged', staged: true, add: 1, del: 3 }],
    totalAdd: 7,
    totalDel: 4,
    untrackedEntries: [{ path: 'novo.txt', status: 'untracked', unstaged: true, add: 2 }],
  }
);
assert.strictEqual(
  support.buildGitWorktreeViewModel({ isGitRepo: false, entries: [] }).activeStep,
  'repo'
);
assert.match(
  gitSource,
  /Untracked, Modified, Staged, Committed e Deploy/,
  'Git tool should expose the clean user-facing workflow order'
);
assert.match(
  gitSource,
  /'Untracked'[\s\S]*'Modified'[\s\S]*'Staged'[\s\S]*'Committed'[\s\S]*createDeployStep/,
  'Git panel should render status buckets before deploy'
);
assert.match(
  deploySource,
  /'5'[\s\S]*'Deploy'/,
  'Deploy step should live in the GitHub deploy renderer'
);
assert.match(
  gitSource,
  /right-tool-git-file-chip/,
  'Git panel should use compact file rows instead of heavy diff cards for the main flow'
);
assert.match(
  gitSource,
  /right-tool-git-step--collapsed/,
  'Git workflow steps should render collapsed until the user opens one'
);
assert.match(
  source,
  /FaberProjectToolsGit[\s\S]*createProjectGitTool[\s\S]*await gitTool\.renderGitTool\(\{ resetOpenStep: true \}\);/s,
  'Opening the Git tool from the rail should reset any previously expanded workflow step'
);
assert.match(
  gitSource,
  /FaberProjectToolsGithubDeploy[\s\S]*createProjectGithubDeployTool[\s\S]*githubDeployTool\.createDeployStep/s,
  'Git renderer should delegate GitHub and Deploy rendering to its own module'
);
assert.match(
  gitSource,
  /aria-expanded/,
  'Git workflow step headers should expose accordion state'
);
assert.match(
  gitSource,
  /Criar commit com selecionados/,
  'Staged step should make commit selection explicit'
);
assert.match(
  gitSource,
  /files: selectedFiles/,
  'Commit action should pass only selected staged files forward'
);
assert.match(
  deploySource,
  /Revisar publicação[\s\S]*Clonar \/ importar[\s\S]*Comandos manuais/,
  'GitHub deploy module should own publish, clone and manual command actions'
);
assert.match(
  gitSource,
  /right-tool-git-file-chip__summary/,
  'Git compact rows should surface binary diff limitations inline'
);

assert.strictEqual(
  tools.inferGithubRepoNameFromProject([{ id: 'p1', name: 'Meu Projeto' }], 'p1', { rootPath: '/tmp/fallback' }),
  'Meu-Projeto'
);
assert.strictEqual(
  tools.inferGithubRepoNameFromProject([], 'p1', { rootPath: '/tmp/faber demo' }),
  'faber demo'
);

const unauthenticatedPlan = tools.formatGithubPublishPlan({
  repoFullName: 'eduardo/demo',
  visibility: 'private',
  branch: 'main',
  ready: false,
  auth: { ghInstalled: true, authenticated: false },
  blockers: ['GitHub CLI (`gh`) não está autenticado.'],
  actions: [{ label: 'Inicializar Git' }],
});
assert.match(unauthenticatedPlan, /gh auth login/);
assert.match(unauthenticatedPlan, /--hostname github\.com --web/);
assert.match(unauthenticatedPlan, /login aberto no navegador/);
assert.match(unauthenticatedPlan, /Nada foi publicado ainda/);

assert.strictEqual(
  tools.getGithubAuthCommand({ ghInstalled: true, authenticated: false }),
  'gh auth login --hostname github.com --web'
);
assert.strictEqual(
  tools.getGithubAuthCommand({ ghInstalled: false, authenticated: false }),
  'brew install gh'
);
assert.match(
  tools.formatGithubAuthGuidance({ ok: true, ghInstalled: true, authenticated: false }).message,
  /navegador pode estar logado/
);
assert.match(
  tools.formatGithubAuthGuidance({ ok: true, ghInstalled: true, authenticated: true, username: 'demo-user' }).title,
  /@demo-user/
);

const readyPlan = tools.formatGithubPublishPlan({
  repoFullName: 'eduardo/demo',
  visibility: 'public',
  ready: true,
  actions: [{ label: 'Criar commit' }, { label: 'Enviar branch' }],
});
assert.match(readyPlan, /Tudo pronto para publicar/);
assert.match(readyPlan, /Criar commit > Enviar branch/);

const previewFailure = tools.formatPreviewStartFailure({
  message: 'Execução local bloqueada.',
  plan: {
    warnings: ['Dependências ausentes.'],
    blockers: ['Sem script dev.'],
    steps: [
      { status: 'manual', commandText: 'npm install' },
      { status: 'blocked', label: 'Iniciar servidor' },
    ],
  },
  session: { stderr: 'erro do servidor' },
});
assert.match(previewFailure, /Dependências ausentes/);
assert.match(previewFailure, /npm install/);
assert.match(previewFailure, /erro do servidor/);

assert.strictEqual(
  tools.buildTerminalPreviewCommand({
    commandText: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
    steps: [{ id: 'preview_dependencies', status: 'manual', commandText: 'npm install' }],
    warnings: [],
  }),
  'npm install && npm run dev -- --hostname 127.0.0.1 --port 3000'
);

async function runAsyncAssertions() {
  const terminalCommands = [];
  const previewPayloads = [];
  const messages = [];
  const statuses = [];
  const controller = tools.createProjectToolsController({
    api: {
      getProjectPreviewPlan: async () => ({
        ok: true,
        plan: {
          ok: true,
          ready: false,
          mode: 'server',
          port: 3000,
          url: 'http://127.0.0.1:3000/',
          commandText: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
          steps: [{ id: 'preview_dependencies', status: 'manual', commandText: 'npm install' }],
          warnings: [],
        },
      }),
      startProjectPreview: async (payload) => {
        previewPayloads.push(payload);
        return {
          ok: true,
          session: { status: 'ready', url: 'http://127.0.0.1:3000/' },
        };
      },
    },
    terminalController: {
      runProjectCommand: async (command) => {
        terminalCommands.push(command);
        return { ok: true, session: { id: 'terminal-1' } };
      },
    },
    getSelectedProjectInfo: () => ({ rootPath: '/tmp/faber-preview' }),
    appendMessage: (...args) => messages.push(args),
    updateStatus: (status) => statuses.push(status),
  });

  await controller.startPreview();
  assert.strictEqual(
    terminalCommands[0],
    'npm install && npm run dev -- --hostname 127.0.0.1 --port 3000'
  );
  assert.strictEqual(previewPayloads[0].options.attachToExistingServer, true);
  assert.strictEqual(previewPayloads[0].options.port, 3000);
  assert.ok(messages.some((entry) => String(entry[1]).includes('terminal interno')));
  assert.ok(statuses.includes('Execução local ativa'));
}

runAsyncAssertions()
  .then(() => {
    console.log('renderer-project-tools.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
