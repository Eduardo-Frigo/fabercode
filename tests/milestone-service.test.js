const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MILESTONE_LIFECYCLE_REASONS,
  MILESTONE_PROPOSAL_REASONS,
  createMilestoneService,
} = require('../main/services/milestone_service');
const {
  canonicalizeMapChatProposalPatch,
  computeMapChatProposalPatchDigest,
} = require('../main/services/map_chat_proposal_store');
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

    const milestoneBytesBeforeUnvalidatedDone = fs.readFileSync(
      path.join(tempRoot, '.faber', 'milestones.json'),
      'utf8',
    );
    assert.deepStrictEqual(
      milestoneService.updateMilestoneStatus(tempRoot, 'milestone-1', 'done'),
      { ok: false, code: MILESTONE_LIFECYCLE_REASONS.VALIDATION_REQUIRED },
    );
    assert.strictEqual(
      fs.readFileSync(path.join(tempRoot, '.faber', 'milestones.json'), 'utf8'),
      milestoneBytesBeforeUnvalidatedDone,
      'a renderer status request must not bypass validation',
    );
    assert.deepStrictEqual(
      milestoneService.updateMilestoneStatus(tempRoot, 'milestone-1', 'in_progress'),
      { ok: false, code: MILESTONE_LIFECYCLE_REASONS.INVALID_STATUS },
    );

    const secondMilestone = {
      id: 'milestone-2',
      number: 2,
      title: 'Release',
      summary: 'Publicar somente depois da fundação.',
      status: 'planned',
      tasks: [],
      acceptanceCriteria: 'Fundação validada.',
      validationCommands: 'npm test',
      commits: [],
    };
    milestoneService.saveMilestones(tempRoot, [
      ...milestoneService.listMilestones(tempRoot),
      secondMilestone,
    ]);
    assert.deepStrictEqual(
      milestoneService.updateMilestoneStatus(tempRoot, 'milestone-2', 'active'),
      { ok: false, code: MILESTONE_LIFECYCLE_REASONS.ACTIVE_CONFLICT },
    );

    // Test updateMilestoneTask
    const taskUpdateRes = milestoneService.updateMilestoneTask(tempRoot, 'milestone-1', 'task-1-1', { status: 'done' });
    assert.strictEqual(taskUpdateRes.ok, true);
    assert.strictEqual(taskUpdateRes.task.status, 'done');

    const listAfterUpdate = milestoneService.listMilestones(tempRoot);
    assert.strictEqual(listAfterUpdate[0].tasks.find(t => t.id === 'task-1-1').status, 'done');

    // Only a canonical record already verified against Git may be persisted.
    const commitRecord = {
      hash: 'a'.repeat(40),
      message: 'feat: init foundation',
      createdAt: new Date().toISOString(),
    };
    assert.deepStrictEqual(
      milestoneService.linkVerifiedCommit(tempRoot, 'milestone-1', {
        ...commitRecord,
        hash: 'abcdef123456',
      }),
      { ok: false, code: MILESTONE_LIFECYCLE_REASONS.INVALID_COMMIT },
    );
    const linkRes = milestoneService.linkVerifiedCommit(tempRoot, 'milestone-1', commitRecord);
    assert.strictEqual(linkRes.ok, true);
    assert.strictEqual(linkRes.milestone.commits.length, 1);
    assert.strictEqual(linkRes.milestone.commits[0].hash, commitRecord.hash);
    assert.strictEqual(
      milestoneService.linkVerifiedCommit(tempRoot, 'milestone-1', commitRecord).idempotent,
      true,
    );

    const activeMilestone = milestoneService.listMilestones(tempRoot)
      .find((milestone) => milestone.id === 'milestone-1');
    const completionReceipt = {
      jobId: 'job-validated-1',
      status: 'passed',
      validatedAt: new Date(Math.max(Date.now(), Date.parse(activeMilestone.startedAt) + 1)).toISOString(),
      validationDigest: 'sha256:' + 'b'.repeat(64),
    };
    const completion = milestoneService.completeMilestoneAfterValidation(
      tempRoot,
      'milestone-1',
      completionReceipt,
    );
    assert.strictEqual(completion.ok, true);
    assert.strictEqual(completion.milestone.status, 'done');
    assert.deepStrictEqual(completion.milestone.completionEvidence, completionReceipt);
    assert.strictEqual(
      milestoneService.completeMilestoneAfterValidation(
        tempRoot,
        'milestone-1',
        completionReceipt,
      ).idempotent,
      true,
    );

    const finalRenderRes = milestoneService.renderMilestones(tempRoot);
    assert.strictEqual(finalRenderRes.ok, true);

    const readmePath = path.join(tempRoot, 'docs', 'milestones', 'README.md');
    const milestone1Path = path.join(tempRoot, 'docs', 'milestones', 'milestone-01-foundation.md');

    assert.strictEqual(fs.existsSync(readmePath), true);
    assert.strictEqual(fs.existsSync(milestone1Path), true);

    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.ok(readmeContent.includes('Milestone 1'));

    const milestone1Content = fs.readFileSync(milestone1Path, 'utf8');
    assert.ok(milestone1Content.includes('Status: **done**'));
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

    const beforeProposal = milestoneService.readMilestonesSnapshot(tempRoot);
    const replacementMilestones = [{
      id: 'milestone-approved',
      number: 1,
      title: 'Approved Foundation',
      summary: 'Plano aprovado explicitamente.',
      status: 'planned',
      tasks: [{
        id: 'task-approved',
        title: 'Aplicar somente após aprovação',
        status: 'pending',
      }],
      acceptanceCriteria: 'A proposta aprovada é a única fonte da alteração.',
      validationCommands: 'npm test',
      references: [{ path: 'docs/application-map/README.md' }],
      commits: [],
      notes: '',
    }];
    const proposalPatch = canonicalizeMapChatProposalPatch({
      schemaVersion: 'milestone-replacement-patch.v1',
      operation: 'replace',
      milestones: replacementMilestones,
    });
    const proposalPatchDigest = computeMapChatProposalPatchDigest(proposalPatch);

    const staleProposal = milestoneService.applyApprovedProposal(tempRoot, {
      expectedDigest: 'sha256:' + '0'.repeat(64),
      patch: proposalPatch,
      patchDigest: proposalPatchDigest,
    });
    assert.deepStrictEqual(staleProposal, {
      ok: false,
      code: MILESTONE_PROPOSAL_REASONS.STALE_BASE,
    });
    assert.strictEqual(
      milestoneService.readMilestonesSnapshot(tempRoot).contentDigest,
      beforeProposal.contentDigest,
    );

    const forgedDigest = milestoneService.applyApprovedProposal(tempRoot, {
      expectedDigest: beforeProposal.contentDigest,
      patch: proposalPatch,
      patchDigest: 'sha256:' + 'f'.repeat(64),
    });
    assert.deepStrictEqual(forgedDigest, {
      ok: false,
      code: MILESTONE_PROPOSAL_REASONS.PATCH_DIGEST_MISMATCH,
    });

    const forgedCompletionPatch = canonicalizeMapChatProposalPatch({
      schemaVersion: 'milestone-replacement-patch.v1',
      operation: 'replace',
      milestones: [{
        ...replacementMilestones[0],
        status: 'done',
        completionEvidence: completionReceipt,
      }],
    });
    assert.deepStrictEqual(
      milestoneService.applyApprovedProposal(tempRoot, {
        expectedDigest: beforeProposal.contentDigest,
        patch: forgedCompletionPatch,
        patchDigest: computeMapChatProposalPatchDigest(forgedCompletionPatch),
      }),
      { ok: false, code: MILESTONE_PROPOSAL_REASONS.INVALID_INPUT },
    );

    const appliedProposal = milestoneService.applyApprovedProposal(tempRoot, {
      expectedDigest: beforeProposal.contentDigest,
      patch: proposalPatch,
      patchDigest: proposalPatchDigest,
    });
    assert.strictEqual(appliedProposal.ok, true);
    assert.match(appliedProposal.contentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.notStrictEqual(appliedProposal.contentDigest, beforeProposal.contentDigest);
    assert.deepStrictEqual(
      milestoneService.listMilestones(tempRoot),
      replacementMilestones,
    );
    assert.strictEqual(
      fs.readFileSync(
        path.join(tempRoot, 'docs', 'milestones', 'milestone-01-approved-foundation.md'),
        'utf8',
      ).includes('Aplicar somente após aprovação'),
      true,
    );

    assert.deepStrictEqual(
      milestoneService.applyApprovedProposal(tempRoot, {
        expectedDigest: beforeProposal.contentDigest,
        patch: proposalPatch,
        patchDigest: proposalPatchDigest,
      }),
      { ok: false, code: MILESTONE_PROPOSAL_REASONS.STALE_BASE },
      'an approved patch must not replay against its old base digest',
    );
    assert.deepStrictEqual(
      milestoneService.applyApprovedProposal(tempRoot, {
        expectedDigest: appliedProposal.contentDigest,
        patch: proposalPatch,
        patchDigest: proposalPatchDigest,
        extraAuthority: true,
      }),
      { ok: false, code: MILESTONE_PROPOSAL_REASONS.INVALID_INPUT },
    );

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
