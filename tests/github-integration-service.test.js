const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createGithubIntegrationService } = require('../main/services/github_integration_service');

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createProjectInfo(rootPath) {
  return {
    rootPath,
    totalFiles: 1,
    files: ['index.html'],
    stacks: ['Projeto generico'],
  };
}

function createRunCommand(resolver) {
  const calls = [];
  const runCommand = async (bin, args = [], options = {}) => {
    calls.push({ bin, args, options });
    const result = await resolver(bin, args, options, calls);
    return result || { ok: true, stdout: '', stderr: '' };
  };
  return { calls, runCommand };
}

function commandKey(bin, args = []) {
  return `${bin} ${args.join(' ')}`;
}

async function testAuthStatusParsesLoggedUser() {
  const { runCommand } = createRunCommand(async (bin, args) => {
    const key = commandKey(bin, args);
    if (key === 'gh --version') return { ok: true, stdout: 'gh version 2.0.0', stderr: '' };
    if (key === 'gh auth status --hostname github.com') {
      return { ok: true, stdout: '', stderr: 'Logged in to github.com account demo-user (/home/test/.config/gh/hosts.yml)' };
    }
    return { ok: false, stdout: '', stderr: '' };
  });
  const service = createGithubIntegrationService({ fs, path, runCommand });

  const status = await service.getGithubAuthStatus();
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.ghInstalled, true);
  assert.strictEqual(status.authenticated, true);
  assert.strictEqual(status.username, 'demo-user');
  assert.strictEqual(status.loginCommand.commandText, 'gh auth login --hostname github.com --web');
}

async function testMissingGhIsNonFatalStatus() {
  const service = createGithubIntegrationService({
    fs,
    path,
    runCommand: async () => ({ ok: false, code: 127, stdout: '', stderr: 'gh: command not found' }),
  });

  const status = await service.getGithubAuthStatus();
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.ghInstalled, false);
  assert.strictEqual(status.authenticated, false);
}

async function testFreshProjectPlanUsesGhRepoCreate(tempRoot) {
  const rootPath = path.join(tempRoot, 'fresh-project');
  writeFile(path.join(rootPath, 'index.html'), '<h1>ok</h1>');
  writeFile(path.join(rootPath, '.env'), 'SECRET=value\n');

  const { runCommand } = createRunCommand(async (bin, args) => {
    const key = commandKey(bin, args);
    if (key === 'gh --version') return { ok: true, stdout: 'gh version 2.0.0', stderr: '' };
    if (key === 'gh auth status --hostname github.com') return { ok: true, stdout: 'Logged in to github.com as eduardo', stderr: '' };
    if (key.endsWith('rev-parse --is-inside-work-tree')) return { ok: false, stdout: '', stderr: 'not a git repository' };
    return { ok: true, stdout: '', stderr: '' };
  });
  const service = createGithubIntegrationService({ fs, path, runCommand });

  const plan = await service.buildGithubPublishPlan(createProjectInfo(rootPath), {
    owner: 'eduardo',
    repoName: 'Meu Site!!',
    visibility: 'private',
  });

  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.repoFullName, 'eduardo/Meu-Site');
  assert.strictEqual(plan.visibility, 'private');
  assert.ok(plan.warnings.some((warning) => warning.includes('.env')));
  assert.ok(plan.actions.some((entry) => entry.id === 'git_init'));
  assert.ok(plan.actions.some((entry) => entry.id === 'gitignore_update'));
  const createAction = plan.actions.find((entry) => entry.id === 'github_repo_create');
  assert.ok(createAction);
  assert.ok(createAction.commandText.includes('gh repo create eduardo/Meu-Site --private'));
}

async function testExistingGithubRemoteDoesNotRequireGhForPlan(tempRoot) {
  const rootPath = path.join(tempRoot, 'existing-remote');
  writeFile(path.join(rootPath, 'index.html'), '<h1>ok</h1>');
  writeFile(path.join(rootPath, '.gitignore'), 'node_modules/\n.next/\ndist/\nbuild/\n.env\n.env.*\n!.env.example\n.DS_Store\n');

  const { runCommand } = createRunCommand(async (bin, args) => {
    const key = commandKey(bin, args);
    if (key === 'gh --version') return { ok: false, code: 127, stdout: '', stderr: 'gh: command not found' };
    if (key.endsWith('rev-parse --is-inside-work-tree')) return { ok: true, stdout: 'true\n', stderr: '' };
    if (key.endsWith('rev-parse --abbrev-ref HEAD')) return { ok: true, stdout: 'main\n', stderr: '' };
    if (key.endsWith('rev-parse --verify HEAD')) return { ok: true, stdout: 'abc\n', stderr: '' };
    if (key.endsWith('status --porcelain')) return { ok: true, stdout: '', stderr: '' };
    if (key.endsWith('remote get-url origin')) return { ok: true, stdout: 'git@github.com:owner/repo.git\n', stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  });
  const service = createGithubIntegrationService({ fs, path, runCommand });

  const plan = await service.buildGithubPublishPlan(createProjectInfo(rootPath));
  assert.strictEqual(plan.ready, true);
  assert.strictEqual(plan.needsRepoCreate, false);
  assert.strictEqual(plan.git.originGithubUrl, 'https://github.com/owner/repo');
  assert.ok(plan.actions.some((entry) => entry.id === 'git_push'));
  assert.ok(!plan.actions.some((entry) => entry.id === 'github_repo_create'));
}

async function testPlanBlocksWhenCreateNeedsAuth(tempRoot) {
  const rootPath = path.join(tempRoot, 'no-auth');
  writeFile(path.join(rootPath, 'index.html'), '<h1>ok</h1>');

  const { runCommand } = createRunCommand(async (bin, args) => {
    const key = commandKey(bin, args);
    if (key === 'gh --version') return { ok: true, stdout: 'gh version 2.0.0', stderr: '' };
    if (key === 'gh auth status --hostname github.com') return { ok: false, stdout: '', stderr: 'not logged in' };
    if (key.endsWith('rev-parse --is-inside-work-tree')) return { ok: false, stdout: '', stderr: 'not a git repository' };
    return { ok: true, stdout: '', stderr: '' };
  });
  const service = createGithubIntegrationService({ fs, path, runCommand });

  const plan = await service.buildGithubPublishPlan(createProjectInfo(rootPath));
  assert.strictEqual(plan.ready, false);
  assert.ok(plan.blockers.some((blocker) => blocker.includes('gh auth login --hostname github.com --web')));
}

async function testPublishPlanSanitizesOptionLikeGitArgs(tempRoot) {
  const rootPath = path.join(tempRoot, 'option-injection-guard');
  writeFile(path.join(rootPath, 'index.html'), '<h1>ok</h1>');

  const { runCommand } = createRunCommand(async (bin, args) => {
    const key = commandKey(bin, args);
    if (key === 'gh --version') return { ok: true, stdout: 'gh version 2.0.0', stderr: '' };
    if (key === 'gh auth status --hostname github.com') return { ok: true, stdout: 'Logged in to github.com as eduardo', stderr: '' };
    if (key.endsWith('rev-parse --is-inside-work-tree')) return { ok: true, stdout: 'true\n', stderr: '' };
    if (key.endsWith('rev-parse --abbrev-ref HEAD')) return { ok: true, stdout: 'main\n', stderr: '' };
    if (key.endsWith('rev-parse --verify HEAD')) return { ok: true, stdout: 'abc\n', stderr: '' };
    if (key.endsWith('status --porcelain')) return { ok: true, stdout: '', stderr: '' };
    if (key.endsWith('remote get-url origin')) return { ok: true, stdout: 'https://github.com/owner/repo.git\n', stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  });
  const service = createGithubIntegrationService({ fs, path, runCommand });

  const plan = await service.buildGithubPublishPlan(createProjectInfo(rootPath), {
    branch: '--upload-pack=/tmp/pwn',
    remoteName: '--exec=bad',
    owner: '--bad-owner-',
  });

  assert.strictEqual(plan.branch.startsWith('-'), false);
  assert.strictEqual(plan.remoteName.startsWith('-'), false);
  assert.strictEqual(plan.owner.startsWith('-'), false);
  const pushAction = plan.actions.find((entry) => entry.id === 'git_push');
  assert.ok(pushAction);
  assert.strictEqual(pushAction.command.args.includes('--upload-pack=/tmp/pwn'), false);
  assert.strictEqual(pushAction.command.args.includes('--exec=bad'), false);
}

async function testPublishPlanRejectsInaccessibleProject(tempRoot) {
  const rootPath = path.join(tempRoot, 'missing-project');
  const service = createGithubIntegrationService({
    fs,
    path,
    runCommand: async () => {
      throw new Error('runCommand should not be reached for inaccessible roots');
    },
  });

  const plan = await service.buildGithubPublishPlan(createProjectInfo(rootPath));
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.ready, false);
  assert.match(plan.message, /não encontrado/i);
}

async function testCloneRejectsFilesystemRootDestination(tempRoot) {
  const service = createGithubIntegrationService({
    fs,
    path,
    runCommand: async () => ({ ok: true, stdout: '', stderr: '' }),
  });

  const clone = await service.cloneGithubRepository({
    repoFullName: 'owner/repo',
    parentPath: path.parse(tempRoot).root,
  });
  assert.strictEqual(clone.ok, false);
  assert.match(clone.message, /raiz do filesystem/i);
}

async function testExecuteCreatesGitignoreCommitAndRepo(tempRoot) {
  const rootPath = path.join(tempRoot, 'execute-publish');
  writeFile(path.join(rootPath, 'index.html'), '<h1>ok</h1>');

  const { calls, runCommand } = createRunCommand(async (bin, args) => {
    const key = commandKey(bin, args);
    if (key === 'gh --version') return { ok: true, stdout: 'gh version 2.0.0', stderr: '' };
    if (key === 'gh auth status --hostname github.com') return { ok: true, stdout: 'Logged in to github.com as eduardo', stderr: '' };
    if (key.endsWith('rev-parse --is-inside-work-tree')) return { ok: false, stdout: '', stderr: 'not a git repository' };
    if (key.endsWith('status --porcelain')) return { ok: true, stdout: 'A  index.html\nA  .gitignore\n', stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  });
  const service = createGithubIntegrationService({ fs, path, runCommand });

  const report = await service.executeGithubPublish(createProjectInfo(rootPath), {
    owner: 'eduardo',
    repoName: 'demo-site',
    commitMessage: 'Primeiro commit',
  });

  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.repoUrl, 'https://github.com/eduardo/demo-site');
  const gitignore = fs.readFileSync(path.join(rootPath, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('node_modules/'));
  assert.ok(gitignore.includes('.env'));
  assert.ok(calls.some((call) => call.bin === 'git' && call.args.includes('init')));
  assert.ok(calls.some((call) => call.bin === 'git' && call.args.includes('commit') && call.args.includes('Primeiro commit')));
  assert.ok(calls.some((call) => call.bin === 'gh' && call.args.includes('repo') && call.args.includes('create') && call.args.includes('eduardo/demo-site')));
}

async function testListAndCloneRepositories(tempRoot) {
  const parentPath = path.join(tempRoot, 'github-clones');
  fs.mkdirSync(parentPath, { recursive: true });
  const { calls, runCommand } = createRunCommand(async (bin, args) => {
    const key = commandKey(bin, args);
    if (key === 'gh --version') return { ok: true, stdout: 'gh version 2.0.0', stderr: '' };
    if (key === 'gh auth status --hostname github.com') return { ok: true, stdout: 'Logged in to github.com as eduardo', stderr: '' };
    if (key.startsWith('gh repo list')) {
      return {
        ok: true,
        stdout: JSON.stringify([{
          name: 'demo-site',
          nameWithOwner: 'eduardo/demo-site',
          url: 'https://github.com/eduardo/demo-site',
          description: 'Site demo',
          visibility: 'PUBLIC',
          isPrivate: false,
          updatedAt: '2026-05-30T00:00:00Z',
        }]),
        stderr: '',
      };
    }
    if (key.startsWith('gh repo clone eduardo/demo-site')) return { ok: true, stdout: '', stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  });
  const service = createGithubIntegrationService({ fs, path, runCommand });

  const repos = await service.listGithubRepositories({ limit: 10 });
  assert.strictEqual(repos.ok, true);
  assert.strictEqual(repos.repositories[0].nameWithOwner, 'eduardo/demo-site');
  assert.strictEqual(repos.repositories[0].visibility, 'public');

  const clone = await service.cloneGithubRepository({ repoFullName: 'eduardo/demo-site', parentPath });
  assert.strictEqual(clone.ok, true);
  assert.strictEqual(clone.rootPath, path.join(parentPath, 'demo-site'));
  assert.ok(calls.some((call) => call.bin === 'gh' && call.args.includes('clone') && call.args.includes('eduardo/demo-site')));
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'github-integration-test-'));
  try {
    await testAuthStatusParsesLoggedUser();
    await testMissingGhIsNonFatalStatus();
    await testFreshProjectPlanUsesGhRepoCreate(tempRoot);
    await testExistingGithubRemoteDoesNotRequireGhForPlan(tempRoot);
    await testPlanBlocksWhenCreateNeedsAuth(tempRoot);
    await testPublishPlanSanitizesOptionLikeGitArgs(tempRoot);
    await testPublishPlanRejectsInaccessibleProject(tempRoot);
    await testCloneRejectsFilesystemRootDestination(tempRoot);
    await testExecuteCreatesGitignoreCommitAndRepo(tempRoot);
    await testListAndCloneRepositories(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('github-integration-service.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
