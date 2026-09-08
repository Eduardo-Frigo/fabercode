const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const supportSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools_support.js'), 'utf8');
const deploySource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools_github_deploy.js'), 'utf8');
const gitSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools_git.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_tools.js'), 'utf8');
const dispatchedEvents = [];
const sandbox = {
  window: {
    confirm: () => true,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    dispatchEvent: (event) => dispatchedEvents.push(event),
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
  gitSource,
  /commitProjectGitFiles[\s\S]*linkCreatedCommitToActiveMilestone\(projectInfo, result\)/,
  'A created commit should enter the verified active-milestone linking flow'
);
assert.match(
  gitSource,
  /listMilestones[\s\S]*status === 'active'[\s\S]*linkMilestoneCommit[\s\S]*result\.latest\.hash/,
  'Milestone linking must use the real hash returned after commit creation'
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
  assert.ok(dispatchedEvents.some((event) => event.type === 'faber:project-preview-started'));

  const staticPreviewPayloads = [];
  const staticTerminalCommands = [];
  const staticController = tools.createProjectToolsController({
    api: {
      getProjectPreviewPlan: async () => ({
        ok: true,
        plan: {
          ok: true,
          ready: true,
          mode: 'static_server',
          port: 4173,
          url: 'http://127.0.0.1:4173/',
          commandText: '',
          steps: [],
          warnings: [],
        },
      }),
      startProjectPreview: async (payload) => {
        staticPreviewPayloads.push(payload);
        return {
          ok: true,
          session: {
            mode: 'static_server',
            status: 'ready',
            url: 'http://127.0.0.1:4173/',
          },
        };
      },
    },
    terminalController: {
      runProjectCommand: async (command) => {
        staticTerminalCommands.push(command);
        return { ok: true };
      },
    },
    getSelectedProjectInfo: () => ({ rootPath: '/tmp/faber-static-preview' }),
  });
  assert.strictEqual(await staticController.startPreview(), true);
  assert.strictEqual(staticTerminalCommands.length, 0);
  assert.strictEqual(staticPreviewPayloads.length, 1);
  assert.strictEqual(staticPreviewPayloads[0].open, true);

  const failedMessages = [];
  const failedController = tools.createProjectToolsController({
    api: {
      startProjectPreview: async () => {
        throw new Error('servidor indisponível');
      },
    },
    getSelectedProjectInfo: () => ({ rootPath: '/tmp/faber-preview-failure' }),
    appendMessage: (...args) => failedMessages.push(args),
  });
  const failed = await failedController.startPreview();
  assert.strictEqual(failed, false);
  assert.ok(failedMessages.some((entry) => String(entry[1]).includes('servidor indisponível')));
  assert.ok(dispatchedEvents.some((event) => (
    event.type === 'faber:project-preview-failed'
    && event.detail.rootPath === '/tmp/faber-preview-failure'
  )));

  function createPreviewSurfaceHarness(previewResult) {
    const elementsById = new Map();
    const delayedTimers = [];

    class FakeClassList {
      constructor() {
        this.values = new Set();
      }

      set(value) {
        this.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
      }

      add(...names) {
        names.forEach((name) => this.values.add(name));
      }

      remove(...names) {
        names.forEach((name) => this.values.delete(name));
      }

      contains(name) {
        return this.values.has(name);
      }
    }

    class FakeElement {
      constructor() {
        this.children = [];
        this.classList = new FakeClassList();
        this.dataset = {};
        this.style = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.textContent = '';
        this._id = '';
      }

      set id(value) {
        this._id = String(value || '');
        if (this._id) elementsById.set(this._id, this);
      }

      get id() {
        return this._id;
      }

      set className(value) {
        this.classList.set(value);
      }

      get className() {
        return [...this.classList.values].join(' ');
      }

      set innerHTML(value) {
        this.children = [];
        this.textContent = String(value || '');
      }

      append(...children) {
        children.forEach((child) => this.appendChild(child));
      }

      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      }

      setAttribute(name, value) {
        this.attributes.set(name, String(value));
      }

      getAttribute(name) {
        return this.attributes.get(name) || null;
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }
    }

    const document = {
      body: new FakeElement(),
      createElement: () => new FakeElement(),
      getElementById: (id) => elementsById.get(id) || null,
    };
    sandbox.document = document;
    sandbox.window.document = document;
    sandbox.setTimeout = (callback, delay) => {
      if (Number(delay) <= 120) {
        callback();
        return 1;
      }
      delayedTimers.push(callback);
      return delayedTimers.length + 1;
    };

    const controller = tools.createProjectToolsController({
      api: {
        startProjectPreview: async () => previewResult,
      },
      getSelectedProjectInfo: () => ({ rootPath: '/tmp/faber-preview-surface' }),
    });

    return {
      controller,
      delayedTimers,
      document,
    };
  }

  const completedSurface = createPreviewSurfaceHarness({
    ok: true,
    session: {
      mode: 'static_server',
      status: 'ready',
      url: 'http://127.0.0.1:4173/',
    },
  });
  assert.strictEqual(await completedSurface.controller.startPreview(), true);
  const completedRoot = completedSurface.document.getElementById('right-tool-lightbox');
  const completedBody = completedSurface.document.getElementById('right-tool-lightbox-body');
  assert.ok(completedRoot && !completedRoot.classList.contains('hidden'));
  assert.strictEqual(
    completedBody.children[0].children[2].textContent,
    '100% · visualização pronta'
  );
  assert.strictEqual(
    completedSurface.delayedTimers.length,
    1,
    'a successful preview should schedule the completed lightbox to close'
  );
  assert.strictEqual(await completedSurface.controller.startPreview(), true);
  assert.strictEqual(completedSurface.delayedTimers.length, 2);
  completedSurface.delayedTimers[0]();
  assert.ok(
    !completedRoot.classList.contains('hidden'),
    'a stale completion timer must not close a newer preview run'
  );
  completedSurface.delayedTimers[1]();
  assert.ok(
    completedRoot.classList.contains('hidden'),
    'the completed preview lightbox should close automatically after exposing its final state'
  );
  assert.strictEqual(completedRoot.getAttribute('aria-hidden'), 'true');
  assert.ok(!completedSurface.document.body.classList.contains('right-tool-lightbox-open'));

  const failedSurface = createPreviewSurfaceHarness({
    ok: false,
    message: 'preview bloqueado',
  });
  assert.strictEqual(await failedSurface.controller.startPreview(), false);
  const failedRoot = failedSurface.document.getElementById('right-tool-lightbox');
  assert.ok(
    failedRoot && !failedRoot.classList.contains('hidden'),
    'a failed preview must remain visible so the failure is not hidden'
  );
  assert.strictEqual(
    failedSurface.delayedTimers.length,
    0,
    'a failed preview must never schedule an automatic close'
  );
}

runAsyncAssertions()
  .then(() => {
    console.log('renderer-project-tools.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
