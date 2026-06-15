const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMilestoneService } = require('../main/services/milestone_service');
const { createMilestoneGitStatusService } = require('../main/services/milestone_git_status_service');

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-milestone-test-'));
  
  try {
    const milestoneService = createMilestoneService({ fs, path });

    // Test listMilestones (should load defaults when empty)
    const initialList = milestoneService.listMilestones(tempRoot);
    assert.strictEqual(initialList.length, 5);
    assert.strictEqual(initialList[0].title, 'Foundation');
    assert.strictEqual(initialList[0].status, 'ready');

    // Test updateMilestoneStatus
    const updateRes = milestoneService.updateMilestoneStatus(tempRoot, 'milestone-1', 'active');
    assert.strictEqual(updateRes.ok, true);
    assert.strictEqual(updateRes.milestone.status, 'active');
    assert.ok(updateRes.milestone.startedAt);

    // Test updateMilestoneTask
    const taskUpdateRes = milestoneService.updateMilestoneTask(tempRoot, 'milestone-1', 'task-1-1', { status: 'done' });
    assert.strictEqual(taskUpdateRes.ok, true);
    assert.strictEqual(taskUpdateRes.task.status, 'done');

    const listAfterUpdate = milestoneService.listMilestones(tempRoot);
    assert.strictEqual(listAfterUpdate[0].tasks.find(t => t.id === 'task-1-1').status, 'done');

    // Test linkMilestoneCommit
    const commitRecord = { hash: 'abcdef123456', message: 'feat: init foundation', createdAt: new Date().toISOString() };
    const linkRes = milestoneService.linkMilestoneCommit(tempRoot, 'milestone-1', commitRecord);
    assert.strictEqual(linkRes.ok, true);
    assert.strictEqual(linkRes.milestone.commits.length, 1);
    assert.strictEqual(linkRes.milestone.commits[0].hash, 'abcdef123456');

    // Test renderMilestones
    const renderRes = milestoneService.renderMilestones(tempRoot);
    assert.strictEqual(renderRes.ok, true);

    const readmePath = path.join(tempRoot, 'docs', 'milestones', 'README.md');
    const milestone1Path = path.join(tempRoot, 'docs', 'milestones', 'milestone-01-foundation.md');

    assert.strictEqual(fs.existsSync(readmePath), true);
    assert.strictEqual(fs.existsSync(milestone1Path), true);

    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.ok(readmeContent.includes('Milestone 1'));

    const milestone1Content = fs.readFileSync(milestone1Path, 'utf8');
    assert.ok(milestone1Content.includes('Status: **active**'));
    assert.ok(milestone1Content.includes('[x] **Configurar repositório Git e estrutura de diretórios**'));

    // Test Git Status Service Mocked
    const mockGitService = {
      getProjectGitWorktree: async () => {
        return {
          isGitRepo: true,
          branch: 'main',
          entries: [
            { path: 'package.json', status: 'modified' },
            { path: 'src/index.js', status: 'untracked' }
          ]
        };
      }
    };
    
    // Add related files to milestone tasks
    milestoneService.updateMilestoneTask(tempRoot, 'milestone-1', 'task-1-1', { relatedFiles: ['package.json'] });
    
    const milestoneGitStatusService = createMilestoneGitStatusService({
      gitService: mockGitService,
      milestoneService
    });

    const gitStatusRes = await milestoneGitStatusService.getMilestoneGitStatus(tempRoot, 'milestone-1');
    assert.strictEqual(gitStatusRes.ok, true);
    assert.deepStrictEqual(gitStatusRes.matchedModified, ['package.json']);
    assert.deepStrictEqual(gitStatusRes.otherModified, ['src/index.js']);

  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

run()
  .then(() => {
    console.log('milestone-service.test.js: ok');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
