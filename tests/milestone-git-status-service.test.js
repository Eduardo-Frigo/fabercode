const assert = require('assert');

const { createMilestoneGitStatusService } = require('../main/services/milestone_git_status_service');

async function run() {
  const linked = [];
  const realHash = 'a'.repeat(40);
  const gitService = {
    getProjectGitWorktree: async () => ({
      ok: true,
      isGitRepo: true,
      branch: 'main',
      entries: [{ path: 'src/index.js', status: 'modified' }],
      latest: null,
    }),
    resolveProjectGitCommit: async (_rootPath, hash) => (
      hash === realHash
        ? {
            ok: true,
            isGitRepo: true,
            commit: {
              hash: realHash,
              message: 'feat: validated milestone',
              createdAt: '2026-08-25T15:00:00-03:00',
            },
          }
        : { ok: false, code: 'git_commit_not_found' }
    ),
  };
  const milestoneService = {
    listMilestones: () => [{
      id: 'milestone-6',
      relatedFiles: ['src/index.js'],
      tasks: [],
    }],
    linkVerifiedCommit: (rootPath, milestoneId, commit) => {
      linked.push({ rootPath, milestoneId, commit });
      return { ok: true, milestoneId, commit };
    },
  };
  const service = createMilestoneGitStatusService({ gitService, milestoneService });

  const status = await service.getMilestoneGitStatus('/project', 'milestone-6');
  assert.strictEqual(status.ok, true);
  assert.deepStrictEqual(status.matchedModified, ['src/index.js']);

  const missing = await service.linkExistingMilestoneCommit(
    '/project',
    'milestone-6',
    'f'.repeat(40),
  );
  assert.deepStrictEqual(missing, { ok: false, code: 'git_commit_not_found' });
  assert.deepStrictEqual(linked, []);

  const linkedResult = await service.linkExistingMilestoneCommit(
    '/project',
    'milestone-6',
    realHash,
  );
  assert.strictEqual(linkedResult.ok, true);
  assert.strictEqual(linked.length, 1);
  assert.deepStrictEqual(linked[0], {
    rootPath: '/project',
    milestoneId: 'milestone-6',
    commit: {
      hash: realHash,
      message: 'feat: validated milestone',
      createdAt: '2026-08-25T15:00:00-03:00',
    },
  });

  console.log('milestone-git-status-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
