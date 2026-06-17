const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerFileHandlers } = require('../main/ipc/file_handlers');
const { registerGithubHandlers } = require('../main/ipc/github_handlers');
const { registerPreviewHandlers } = require('../main/ipc/preview_handlers');
const { registerProjectHandlers } = require('../main/ipc/project_handlers');
const { normalizePreviewOpenUrl } = require('../main/security/url_policy');

function normalizeProjectRecord(project = {}) {
  return {
    id: project.id,
    name: project.name || 'Projeto',
    rootPath: project.rootPath || '',
    createdAt: project.createdAt || new Date().toISOString(),
    state: ['active', 'archived', 'deleted'].includes(project.state) ? project.state : 'active',
    summary: typeof project.summary === 'string' ? project.summary : '',
    archivedAt: project.archivedAt || null,
    deletedAt: project.deletedAt || null,
  };
}

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

function computeLineChangeStats(previous, next) {
  return {
    added: String(next || '').split('\n').length,
    removed: String(previous || '').split('\n').length,
  };
}

function mergeDiffStatsEntry(target, file, stats) {
  target[file] = stats;
}

async function runProjectHandlersTest(tempRoot) {
  const projectRoot = path.join(tempRoot, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });

  let projects = [];
  const audit = [];
  const openedUrls = [];
  const removedConversations = [];
  const committedPayloads = [];
  const previewRuntime = {
    status: null,
  };
  let previewStartUrl = 'file:///tmp/index.html';
  const { handlers, registerIpcHandler } = createHandlerMap();

  registerProjectHandlers({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    authorizeProjectRoot: (rootPath) =>
      path.resolve(String(rootPath || '')) === projectRoot
        ? { ok: true, rootPath: projectRoot }
        : { ok: false, message: 'Projeto não autorizado pelo teste.' },
    buildNextSteps: () => ['validar'],
    buildProjectPreviewPlan: () => ({ ok: true, ready: true, mode: 'file', stack: 'web_estatico' }),
    buildProjectVerificationPlan: () => ({ ok: true, steps: [], summary: { totalSteps: 0 } }),
    commitProjectGitFiles: async (rootPath, message, files) => {
      committedPayloads.push({ rootPath, message, files });
      return { ok: true, committed: true };
    },
    collectGitDiffFirstLines: async () => ({ 'git.js': 4 }),
    collectGitDiffStats: async () => ({ 'git.js': { added: 1, removed: 0 } }),
    collectProjectFilesTree: () => [{ path: 'src/index.js' }],
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [projectRoot] }),
    },
    fs,
    getProjectGitStatus: async () => ({
      ok: true,
      isGitRepo: true,
      latestUrl: 'https://github.com/example/repo/commit/abc',
      actionsUrl: 'https://github.com/example/repo/actions',
    }),
    getProjectGitWorktree: async () => ({
      ok: true,
      isGitRepo: true,
      entries: [{ path: 'git.js', status: 'modified', firstLine: 4 }],
      diffStats: { 'git.js': { add: 1, del: 0, firstLine: 4 } },
    }),
    getRuntimeDiffStats: () => ({ 'runtime.js': { added: 2, removed: 1 } }),
    initProjectGitRepository: async () => ({ ok: true, initialized: true }),
    mergeDiffStatsEntry,
    normalizeExternalUrl: (url) =>
      String(url || '').startsWith('https://github.com/')
        ? { ok: true, url }
        : { ok: false, message: 'URL rejeitada.' },
    normalizeProjectRecord,
    path,
    readProjectsByState: (state) => projects.filter((project) => project.state === state),
    readProjectsSnapshot: () => ({ projects: projects.map(normalizeProjectRecord) }),
    registerIpcHandler,
    removeProjectConversationHistory: (id) => removedConversations.push(id),
    runProjectVerification: async () => ({ ok: true, ready: true, summary: {} }),
    scanProject: (rootPath) => ({ rootPath, totalFiles: 1, stacks: ['Node'] }),
    shell: {
      openExternal: async (url) => openedUrls.push(url),
    },
    rollbackProjectGitFiles: async (_rootPath, files) => ({ ok: true, rolledBack: files }),
    stageProjectGitFiles: async (_rootPath, files) => ({ ok: true, stagedFiles: files }),
    unstageProjectGitFiles: async (_rootPath, files) => ({ ok: true, unstagedFiles: files }),
    writeProjectsSnapshot: (snapshot) => {
      projects = Array.isArray(snapshot && snapshot.projects) ? snapshot.projects.map(normalizeProjectRecord) : [];
    },
  });

  registerGithubHandlers({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    authorizeProjectRoot: (rootPath) =>
      path.resolve(String(rootPath || '')) === projectRoot
        ? { ok: true, rootPath: projectRoot }
        : { ok: false, message: 'Projeto não autorizado pelo teste.' },
    buildGithubPublishPlan: async () => ({ ok: true, ready: true, repoFullName: 'example/repo', blockers: [] }),
    cloneGithubRepository: async ({ repoFullName, parentPath }) => ({
      ok: true,
      repoFullName,
      rootPath: path.join(parentPath, 'repo'),
      repoUrl: 'https://github.com/example/repo',
    }),
    executeGithubPublish: async () => ({ ok: true, repoUrl: 'https://github.com/example/repo', message: 'publicado' }),
    getGithubAuthStatus: async () => ({ ok: true, ghInstalled: true, authenticated: true, username: 'example' }),
    listGithubRepositories: async () => ({
      ok: true,
      repositories: [{ nameWithOwner: 'example/repo', url: 'https://github.com/example/repo' }],
    }),
    path,
    registerIpcHandler,
    scanProject: (rootPath) => ({ rootPath, totalFiles: 1, stacks: ['Node'] }),
  });

  registerPreviewHandlers({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    authorizeProjectRoot: (rootPath) =>
      path.resolve(String(rootPath || '')) === projectRoot
        ? { ok: true, rootPath: projectRoot }
        : { ok: false, message: 'Projeto não autorizado pelo teste.' },
    getProjectPreviewRuntimeStatus: () => ({
      ok: true,
      running: Boolean(previewRuntime.status),
      session: previewRuntime.status,
    }),
    normalizePreviewOpenUrl,
    registerIpcHandler,
    scanProject: (rootPath) => ({ rootPath, totalFiles: 1, stacks: ['Node'] }),
    shell: {
      openExternal: async (url) => openedUrls.push(url),
    },
    startProjectPreview: async () => {
      previewRuntime.status = {
        id: 'preview-1',
        rootPath: projectRoot,
        mode: 'file',
        status: 'ready',
        url: previewStartUrl,
      };
      return { ok: true, started: true, session: previewRuntime.status };
    },
    stopProjectPreview: async () => {
      const stopped = Boolean(previewRuntime.status);
      previewRuntime.status = null;
      return { ok: true, stopped };
    },
  });

  assert.strictEqual(Object.keys(handlers).filter((channel) => channel.startsWith('project')).length, 32);

  const addResult = await handlers['projects:add']();
  assert.strictEqual(addResult.ok, true);
  assert.strictEqual(projects.length, 1);
  assert.strictEqual(projects[0].rootPath, projectRoot);

  const importedRoot = path.join(tempRoot, 'imported-project');
  fs.mkdirSync(importedRoot, { recursive: true });
  const importResult = handlers['projects:import-path'](null, {
    parentProjectRoot: projectRoot,
    rootPath: importedRoot,
  });
  assert.strictEqual(importResult.ok, true);
  assert.ok(projects.some((project) => project.rootPath === importedRoot));

  const scanResult = handlers['project:scan'](null, projectRoot);
  assert.strictEqual(scanResult.ok, true);
  assert.strictEqual(scanResult.info.rootPath, projectRoot);
  assert.strictEqual(scanResult.previewPlan.ok, true);
  assert.strictEqual(scanResult.verificationPlan.ok, true);

  const previewPlanResult = handlers['project:preview:plan'](null, { rootPath: projectRoot });
  assert.strictEqual(previewPlanResult.ok, true);
  assert.strictEqual(previewPlanResult.plan.ready, true);

  const previewStartResult = await handlers['project:preview:start'](null, { rootPath: projectRoot, open: true });
  assert.strictEqual(previewStartResult.ok, true);
  assert.strictEqual(previewStartResult.session.status, 'ready');
  assert.strictEqual(openedUrls[0], 'file:///tmp/index.html');

  const previewStatusResult = handlers['project:preview:runtime-status'](null, { rootPath: projectRoot });
  assert.strictEqual(previewStatusResult.ok, true);
  assert.strictEqual(previewStatusResult.running, true);

  const previewStopResult = await handlers['project:preview:stop'](null, { rootPath: projectRoot });
  assert.strictEqual(previewStopResult.ok, true);
  assert.strictEqual(previewStopResult.stopped, true);

  previewStartUrl = 'https://evil.test/preview';
  const blockedPreviewOpen = await handlers['project:preview:start'](null, { rootPath: projectRoot, open: true });
  assert.strictEqual(blockedPreviewOpen.ok, false);
  assert.strictEqual(openedUrls.includes('https://evil.test/preview'), false);
  await handlers['project:preview:stop'](null, { rootPath: projectRoot });
  previewStartUrl = 'file:///tmp/index.html';

  const verificationPlanResult = handlers['project:verify:plan'](null, { rootPath: projectRoot });
  assert.strictEqual(verificationPlanResult.ok, true);

  const verificationRunResult = await handlers['project:verify:run'](null, { rootPath: projectRoot });
  assert.strictEqual(verificationRunResult.ok, true);
  assert.strictEqual(verificationRunResult.report.ready, true);

  const githubAuthResult = await handlers['project:github:auth-status']();
  assert.strictEqual(githubAuthResult.ok, true);
  assert.strictEqual(githubAuthResult.status.authenticated, true);

  const githubReposResult = await handlers['project:github:list-repos'](null, { limit: 10 });
  assert.strictEqual(githubReposResult.ok, true);
  assert.strictEqual(githubReposResult.repositories[0].nameWithOwner, 'example/repo');

  const githubCloneResult = await handlers['project:github:clone'](null, {
    parentProjectRoot: projectRoot,
    repoFullName: 'example/repo',
  });
  assert.strictEqual(githubCloneResult.ok, true);
  assert.strictEqual(githubCloneResult.rootPath, path.join(tempRoot, 'repo'));

  const githubPlanResult = await handlers['project:github:publish-plan'](null, { rootPath: projectRoot });
  assert.strictEqual(githubPlanResult.ok, true);
  assert.strictEqual(githubPlanResult.plan.ready, true);

  const githubPublishResult = await handlers['project:github:publish'](null, { rootPath: projectRoot });
  assert.strictEqual(githubPublishResult.ok, true);
  assert.strictEqual(githubPublishResult.report.repoUrl, 'https://github.com/example/repo');

  const treeResult = await handlers['project:files-tree'](null, { rootPath: projectRoot });
  assert.strictEqual(treeResult.ok, true);
  assert.deepStrictEqual(Object.keys(treeResult.diffStats).sort(), ['git.js', 'runtime.js']);
  assert.strictEqual(treeResult.diffStats['git.js'].firstLine, 4);

  const worktreeResult = await handlers['project:git:worktree'](null, { rootPath: projectRoot });
  assert.strictEqual(worktreeResult.ok, true);
  assert.strictEqual(worktreeResult.entries[0].firstLine, 4);

  const initGitResult = await handlers['project:git:init'](null, { rootPath: projectRoot });
  assert.strictEqual(initGitResult.initialized, true);

  const stageGitResult = await handlers['project:git:stage'](null, { rootPath: projectRoot, files: ['git.js'] });
  assert.deepStrictEqual(stageGitResult.stagedFiles, ['git.js']);

  const unstageGitResult = await handlers['project:git:unstage'](null, { rootPath: projectRoot, files: ['git.js'] });
  assert.deepStrictEqual(unstageGitResult.unstagedFiles, ['git.js']);

  const commitGitResult = await handlers['project:git:commit'](null, { rootPath: projectRoot, message: 'Teste', files: ['git.js'] });
  assert.strictEqual(commitGitResult.committed, true);
  assert.deepStrictEqual(committedPayloads[0], { rootPath: projectRoot, message: 'Teste', files: ['git.js'] });

  const openResult = await handlers['project:git:open-latest'](null, { rootPath: projectRoot });
  assert.strictEqual(openResult.ok, true);
  assert.ok(openedUrls.includes('https://github.com/example/repo/commit/abc'));

  const invalidScan = handlers['project:scan'](null, path.join(tempRoot, 'other'));
  assert.strictEqual(invalidScan.ok, false);

  const removeResult = handlers['projects:remove'](null, projects[0].id);
  assert.strictEqual(removeResult.ok, true);
  assert.strictEqual(removedConversations.length, 1);
  assert.ok(audit.some((event) => event.type === 'project.added'));
}

async function runFileHandlersTest(tempRoot) {
  const projectRoot = path.join(tempRoot, 'files');
  fs.mkdirSync(projectRoot, { recursive: true });

  const audit = [];
  const ingested = [];
  const { handlers, registerIpcHandler } = createHandlerMap();

  registerFileHandlers({
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    computeLineChangeStats,
    fs,
    ingestRuntimeDiffStats: (rootPath, diffStats) => ingested.push({ rootPath, diffStats }),
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff: (value) => String(value || '').replace(/\\/g, '/'),
    path,
    registerIpcHandler,
    resolveAuthorizedProjectPath: (projectInfo, relativePath) => {
      const rootPath = path.resolve(projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '');
      const rel = String(relativePath || '').replace(/^\/+/, '');
      if (!rootPath || rel.includes('..')) return { ok: false, message: 'Caminho inválido.' };
      return {
        ok: true,
        rootPath,
        absolutePath: path.resolve(rootPath, rel),
        relativePath: rel,
      };
    },
    shell: {
      showItemInFolder: () => {},
      openPath: async () => '',
    },
  });

  assert.deepStrictEqual(Object.keys(handlers).sort(), ['file:preview-image', 'file:read', 'file:rename', 'file:reveal', 'file:write']);

  const projectInfo = { rootPath: projectRoot };
  const writeResult = handlers['file:write'](null, {
    projectInfo,
    relativePath: 'src/example.txt',
    content: 'hello',
  });
  assert.strictEqual(writeResult.ok, false);

  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  const secondWrite = handlers['file:write'](null, {
    projectInfo,
    relativePath: 'src/example.txt',
    content: 'hello',
  });
  assert.strictEqual(secondWrite.ok, true);
  assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'src', 'example.txt'), 'utf8'), 'hello');

  const readResult = handlers['file:read'](null, { projectInfo, relativePath: 'src/example.txt' });
  assert.strictEqual(readResult.ok, true);
  assert.strictEqual(readResult.content, 'hello');

  const imagePath = path.join(projectRoot, 'src', 'image.png');
  fs.writeFileSync(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'));
  const imageResult = handlers['file:preview-image'](null, { projectInfo, relativePath: 'src/image.png' });
  assert.strictEqual(imageResult.ok, true);
  assert.strictEqual(imageResult.mimeType, 'image/png');
  assert.ok(String(imageResult.dataUrl || '').startsWith('data:image/png;base64,'));

  const invalidRename = handlers['file:rename'](null, {
    projectInfo,
    relativePath: 'src/example.txt',
    nextName: '../bad.txt',
  });
  assert.strictEqual(invalidRename.ok, false);

  const renameResult = handlers['file:rename'](null, {
    projectInfo,
    relativePath: 'src/example.txt',
    nextName: 'renamed.txt',
  });
  assert.strictEqual(renameResult.ok, true);
  assert.strictEqual(renameResult.relativePath, 'src/renamed.txt');
  assert.strictEqual(ingested.length, 1);
  assert.ok(audit.some((event) => event.type === 'file.saved_from_lightbox'));
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-ipc-'));
  try {
    await runProjectHandlersTest(tempRoot);
    await runFileHandlersTest(tempRoot);
    console.log('ipc-handlers.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
