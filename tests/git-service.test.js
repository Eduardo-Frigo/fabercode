const assert = require('assert');

const { createProjectGitService } = require('../main/services/git_service');

function normalizeRelativePathForDiff(value) {
  return String(value || '').replace(/^\/+/, '').split('\\').join('/');
}

function mergeDiffStatsEntry(target, relPath, entry) {
  const normalized = normalizeRelativePathForDiff(relPath);
  if (!normalized || !entry) return;
  const previous = target[normalized] || { add: 0, del: 0, binary: false };
  target[normalized] = {
    add: Math.max(previous.add, Number(entry.add) || 0),
    del: Math.max(previous.del, Number(entry.del) || 0),
    binary: Boolean(previous.binary || entry.binary),
  };
}

async function run() {
  const calls = [];
  const fakeFs = {
    openSync: (filePath) => filePath.endsWith('new-image.bin') ? 101 : 102,
    readSync: (fd, buffer) => {
      if (fd === 101) {
        buffer[0] = 0;
        buffer[1] = 159;
        buffer[2] = 146;
        return 3;
      }
      buffer.write('text', 0, 'utf8');
      return 4;
    },
    closeSync: () => {},
  };
  const runCommand = async (bin, args, options) => {
    calls.push({ bin, args, options });
    const key = args
      .slice(2)
      .filter((arg) => arg !== '-c' && arg !== 'core.quotepath=false')
      .join(' ');
    if (key === 'rev-parse --is-inside-work-tree') return { ok: true, stdout: 'true\n' };
    if (key === 'remote get-url origin') return { ok: true, stdout: 'git@github.com:owner/repo.git\n' };
    if (key === 'rev-parse --abbrev-ref HEAD') return { ok: true, stdout: 'main\n' };
    if (key === 'log -1 --pretty=format:%H%n%s%n%cr') {
      return { ok: true, stdout: 'abc123\nInitial commit\n2 hours ago' };
    }
    if (key === 'diff --numstat --') return { ok: true, stdout: '3\t1\tsrc/app.js\n2\t0\tfile with space.txt\n1\t0\tação-🌿.txt\n-\t-\timage.bin\n' };
    if (key === 'diff --cached --numstat --') return { ok: true, stdout: '1\t4\tsrc/app.js\n' };
    if (key === 'diff --unified=0 --') {
      return { ok: true, stdout: 'diff --git a/src/app.js b/src/app.js\n+++ b/src/app.js\n@@ -11,0 +12,2 @@\n+ok\n' };
    }
    if (key === 'diff --cached --unified=0 --') {
      return { ok: true, stdout: 'diff --git a/staged.css b/staged.css\n+++ b/staged.css\n@@ -2,0 +3,1 @@\n+ok\n' };
    }
    if (key === 'diff --unified=3 --') {
      return {
        ok: true,
        stdout: [
          'diff --git a/src/app.js b/src/app.js',
          '--- a/src/app.js',
          '+++ b/src/app.js',
          '@@ -9,6 +12,7 @@',
          ' const title = "Faber";',
          '-const overlay = 0.15;',
          '+const overlay = 0.75;',
          '+const video = "abelhas-novo.mp4";',
          ' render();',
          'diff --git a/ação-🌿.txt b/ação-🌿.txt',
          '--- a/ação-🌿.txt',
          '+++ b/ação-🌿.txt',
          '@@ -1,1 +1,2 @@',
          ' olá',
          '+novo',
          '',
        ].join('\n'),
      };
    }
    if (key === 'diff --cached --unified=3 --') {
      return {
        ok: true,
        stdout: [
          'diff --git a/staged.css b/staged.css',
          '--- a/staged.css',
          '+++ b/staged.css',
          '@@ -2,2 +3,3 @@',
          '-.hero { opacity: .15; }',
          '+.hero { opacity: .75; }',
          '',
        ].join('\n'),
      };
    }
    if (key === 'ls-files --others --exclude-standard') return { ok: true, stdout: 'new.txt\nnew-image.bin\n' };
    if (key === 'status --porcelain=v1') return { ok: true, stdout: ' M src/app.js\nA  staged.css\n M ação-🌿.txt\n M image.bin\n?? new.txt\n?? new-image.bin\n' };
    if (key === 'init') return { ok: true, stdout: 'Initialized empty Git repository\n' };
    if (key === 'add -- src/app.js new.txt') return { ok: true, stdout: '' };
    if (key === 'add -- --weird.js') return { ok: true, stdout: '' };
    if (key === 'diff --cached --name-only --') return { ok: true, stdout: 'staged.css\nextra.css\n' };
    if (key === 'reset -- extra.css') return { ok: true, stdout: '' };
    if (key === 'commit -m Ajusta UI') return { ok: true, stdout: '[main abc123] Ajusta UI\n' };
    if (key === 'commit -m Ajusta UI parcial') return { ok: true, stdout: '[main abc124] Ajusta UI parcial\n' };
    return { ok: false, stdout: '' };
  };

  const service = createProjectGitService({
    fs: fakeFs,
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff,
    runCommand,
  });

  assert.strictEqual(service.normalizeGitRemoteUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo');
  assert.strictEqual(service.normalizeGitRemoteUrl('https://github.com/owner/repo.git'), 'https://github.com/owner/repo');
  assert.strictEqual(service.parseDiffHunkFirstLine('@@ -11,0 +12,2 @@'), 12);
  assert.strictEqual(service.parsePorcelainStatusLine(' M src/app.js').status, 'modified');

  const status = await service.getProjectGitStatus('/tmp/project');
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.isGitRepo, true);
  assert.strictEqual(status.remoteUrl, 'https://github.com/owner/repo');
  assert.strictEqual(status.branch, 'main');
  assert.strictEqual(status.latest.hash, 'abc123');
  assert.strictEqual(status.latestUrl, 'https://github.com/owner/repo/commit/abc123');
  assert.strictEqual(status.actionsUrl, 'https://github.com/owner/repo/actions');
  assert.strictEqual(calls[0].options.timeoutMs, 1400);

  const diffStats = await service.collectGitDiffStats('/tmp/project');
  assert.deepStrictEqual(diffStats, {
    'src/app.js': { add: 3, del: 4, binary: false },
    'file with space.txt': { add: 2, del: 0, binary: false },
    'ação-🌿.txt': { add: 1, del: 0, binary: false },
    'image.bin': { add: 0, del: 0, binary: true },
    'new.txt': { add: 1, del: 0, binary: false },
    'new-image.bin': { add: 0, del: 0, binary: true },
  });

  const firstLines = await service.collectGitDiffFirstLines('/tmp/project');
  assert.deepStrictEqual(firstLines, {
    'src/app.js': 12,
    'staged.css': 3,
    'new.txt': 1,
    'new-image.bin': 1,
  });

  const diffHunks = await service.collectGitDiffHunks('/tmp/project');
  assert.strictEqual(diffHunks['src/app.js'][0].line, 12);
  assert.deepStrictEqual(diffHunks['src/app.js'][0].removed, ['const overlay = 0.15;']);
  assert.deepStrictEqual(diffHunks['src/app.js'][0].added, [
    'const overlay = 0.75;',
    'const video = "abelhas-novo.mp4";',
  ]);
  assert.match(diffHunks['src/app.js'][0].summary, /0\.15/);
  assert.strictEqual(diffHunks['new.txt'][0].summary, 'Arquivo novo no projeto');

  const worktree = await service.getProjectGitWorktree('/tmp/project');
  assert.strictEqual(worktree.ok, true);
  assert.strictEqual(worktree.entries.length, 6);
  assert.deepStrictEqual(
    worktree.entries.map((entry) => ({
      path: entry.path,
      status: entry.status,
      staged: entry.staged,
      unstaged: entry.unstaged,
      binary: entry.binary,
      firstLine: entry.firstLine,
      summary: entry.summary,
    })),
    [
      { path: 'src/app.js', status: 'modified', staged: false, unstaged: true, binary: false, firstLine: 12, summary: 'Alterou "const overlay = 0.15;" para "const overlay = 0.75;"' },
      { path: 'staged.css', status: 'staged', staged: true, unstaged: false, binary: false, firstLine: 3, summary: 'Alterou ".hero { opacity: .15; }" para ".hero { opacity: .75; }"' },
      { path: 'ação-🌿.txt', status: 'modified', staged: false, unstaged: true, binary: false, firstLine: 1, summary: 'Adicionou "novo"' },
      { path: 'image.bin', status: 'modified', staged: false, unstaged: true, binary: true, firstLine: 1, summary: 'Arquivo binário: diff textual indisponível.' },
      { path: 'new.txt', status: 'untracked', staged: false, unstaged: true, binary: false, firstLine: 1, summary: 'Arquivo novo no projeto' },
      { path: 'new-image.bin', status: 'untracked', staged: false, unstaged: true, binary: true, firstLine: 1, summary: 'Arquivo binário: diff textual indisponível.' },
    ]
  );

  const init = await service.initProjectGitRepository('/tmp/project');
  assert.strictEqual(init.ok, true);
  assert.strictEqual(init.initialized, true);

  const staged = await service.stageProjectGitFiles('/tmp/project', ['src/app.js', 'new.txt']);
  assert.strictEqual(staged.ok, true);
  assert.deepStrictEqual(staged.stagedFiles, ['src/app.js', 'new.txt']);

  const dashedPathStage = await service.stageProjectGitFiles('/tmp/project', ['--weird.js']);
  assert.strictEqual(dashedPathStage.ok, true);
  assert.deepStrictEqual(dashedPathStage.stagedFiles, ['--weird.js']);
  assert.ok(calls.some((call) => call.args.slice(2).join(' ') === 'add -- --weird.js'));

  const traversalStage = await service.stageProjectGitFiles('/tmp/project', ['../secret.txt']);
  assert.strictEqual(traversalStage.ok, false);
  assert.match(traversalStage.message, /Caminho Git inválido/);

  const absoluteStage = await service.stageProjectGitFiles('/tmp/project', ['/tmp/secret.txt']);
  assert.strictEqual(absoluteStage.ok, false);
  assert.match(absoluteStage.message, /Caminho Git inválido/);

  const commit = await service.commitProjectGitFiles('/tmp/project', 'Ajusta UI');
  assert.strictEqual(commit.ok, true);
  assert.strictEqual(commit.committed, true);

  const partialCommit = await service.commitProjectGitFiles('/tmp/project', 'Ajusta UI parcial', ['staged.css']);
  assert.strictEqual(partialCommit.ok, true);
  assert.deepStrictEqual(partialCommit.committedFiles, ['staged.css']);
  assert.deepStrictEqual(partialCommit.skippedFiles, ['extra.css']);
  assert.ok(calls.some((call) => call.args.slice(2).join(' ') === 'reset -- extra.css'));

  const traversalCommit = await service.commitProjectGitFiles('/tmp/project', 'Ajusta UI parcial', ['../secret.txt']);
  assert.strictEqual(traversalCommit.ok, false);
  assert.match(traversalCommit.message, /Caminho Git inválido/);

  const nonRepo = createProjectGitService({
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff,
    runCommand: async () => ({ ok: false, stdout: '' }),
  });
  const nonRepoStatus = await nonRepo.getProjectGitStatus('/tmp/nope');
  assert.strictEqual(nonRepoStatus.ok, true);
  assert.strictEqual(nonRepoStatus.isGitRepo, false);

  console.log('git-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
