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

    const missingSnapshot = milestoneService.readMilestonesSnapshot(tempRoot);
    assert.deepStrictEqual(missingSnapshot, {
      ok: true,
      found: false,
      format: null,
      renderedAt: null,
      source: null,
      milestones: [],
      contentDigest: null,
    });
    assert.strictEqual(fs.existsSync(path.join(tempRoot, '.faber')), false);

    // Test listMilestones (should stay empty until render creates milestones)
    const initialList = milestoneService.listMilestones(tempRoot);
    assert.strictEqual(initialList.length, 0);
    assert.strictEqual(fs.existsSync(path.join(tempRoot, '.faber')), false);

    const emptyRenderRes = milestoneService.renderMilestones(tempRoot);
    assert.strictEqual(emptyRenderRes.ok, false);
    assert.strictEqual(fs.existsSync(path.join(tempRoot, 'docs', 'milestones', 'README.md')), false);

    const generatedMilestones = [
      {
        id: 'milestone-1',
        number: 1,
        title: 'Foundation',
        summary: 'Definição da stack inicial, estrutura de pastas e dependências básicas.',
        status: 'ready',
        tasks: [
          { id: 'task-1-1', title: 'Configurar repositório Git e estrutura de diretórios', status: 'pending' },
          { id: 'task-1-2', title: 'Definir e instalar dependências principais do projeto', status: 'pending' },
          { id: 'task-1-3', title: 'Criar configuração de build e script de desenvolvimento', status: 'pending' }
        ],
        acceptanceCriteria: 'Projeto inicia localmente sem erros e possui repositório git inicializado.',
        validationCommands: 'npm run build\nnpm test',
        commits: [],
        notes: ''
      }
    ];

    const saveInitial = milestoneService.saveMilestones(tempRoot, generatedMilestones);
    assert.strictEqual(saveInitial.ok, true);
    const draftSnapshot = milestoneService.readMilestonesSnapshot(tempRoot);
    assert.strictEqual(draftSnapshot.ok, true);
    assert.strictEqual(draftSnapshot.found, true);
    assert.strictEqual(draftSnapshot.format, 'draft');
    assert.deepStrictEqual(draftSnapshot.milestones, generatedMilestones);
    assert.match(draftSnapshot.contentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(milestoneService.listMilestones(tempRoot).length, 0);

    // Test renderMilestones
    const renderRes = milestoneService.renderMilestones(tempRoot);
    assert.strictEqual(renderRes.ok, true);

    const renderedList = milestoneService.listMilestones(tempRoot);
    assert.strictEqual(renderedList.length, 1);
    const renderedSnapshot = milestoneService.readMilestonesSnapshot(tempRoot);
    assert.strictEqual(renderedSnapshot.ok, true);
    assert.strictEqual(renderedSnapshot.found, true);
    assert.strictEqual(renderedSnapshot.format, 'rendered');
    assert.strictEqual(renderedSnapshot.renderedAt !== null, true);
    assert.deepStrictEqual(renderedSnapshot.milestones, renderedList);

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

    const finalRenderRes = milestoneService.renderMilestones(tempRoot);
    assert.strictEqual(finalRenderRes.ok, true);

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
