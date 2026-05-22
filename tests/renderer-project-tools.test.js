const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools.js'), 'utf8');
const sandbox = {
  window: {
    confirm: () => true,
  },
};
sandbox.window.window = sandbox.window;

vm.runInNewContext(source, sandbox, { filename: 'project_tools.js' });

const tools = sandbox.window.FaberProjectTools;
assert.ok(tools, 'FaberProjectTools should be registered');

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
assert.match(unauthenticatedPlan, /Nada foi publicado ainda/);

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
