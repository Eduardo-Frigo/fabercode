const assert = require('assert');

const { createProjectGitService } = require('../main/services/git_service');

function normalizeRelativePathForDiff(value) {
  return String(value || '').replace(/^\/+/, '').split('\\').join('/');
}

function mergeDiffStatsEntry(target, relPath, entry) {
  const normalized = normalizeRelativePathForDiff(relPath);
  if (!normalized || !entry) return;
  const previous = target[normalized] || { add: 0, del: 0 };
  target[normalized] = {
    add: Math.max(previous.add, Number(entry.add) || 0),
    del: Math.max(previous.del, Number(entry.del) || 0),
  };
}

async function run() {
  const calls = [];
  const runCommand = async (bin, args, options) => {
    calls.push({ bin, args, options });
    const key = args.slice(2).join(' ');
    if (key === 'rev-parse --is-inside-work-tree') return { ok: true, stdout: 'true\n' };
    if (key === 'remote get-url origin') return { ok: true, stdout: 'git@github.com:owner/repo.git\n' };
    if (key === 'rev-parse --abbrev-ref HEAD') return { ok: true, stdout: 'main\n' };
    if (key === 'log -1 --pretty=format:%H%n%s%n%cr') {
      return { ok: true, stdout: 'abc123\nInitial commit\n2 hours ago' };
    }
    if (key === 'diff --numstat --') return { ok: true, stdout: '3\t1\tsrc/app.js\n2\t0\tfile with space.txt\n' };
    if (key === 'diff --cached --numstat --') return { ok: true, stdout: '1\t4\tsrc/app.js\n' };
    if (key === 'ls-files --others --exclude-standard') return { ok: true, stdout: 'new.txt\n' };
    return { ok: false, stdout: '' };
  };

  const service = createProjectGitService({
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff,
    runCommand,
  });

  assert.strictEqual(service.normalizeGitRemoteUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo');
  assert.strictEqual(service.normalizeGitRemoteUrl('https://github.com/owner/repo.git'), 'https://github.com/owner/repo');

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
    'src/app.js': { add: 3, del: 4 },
    'file with space.txt': { add: 2, del: 0 },
    'new.txt': { add: 1, del: 0 },
  });

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
