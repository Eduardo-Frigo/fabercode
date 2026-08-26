const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApplicationMapRenderService } = require('../main/services/application_map_render_service');
const { createApplicationMapService } = require('../main/services/application_map_service');
const { createProjectGitService } = require('../main/services/git_service');
const { createMapChatSessionService } = require('../main/services/map_chat_session_service');
const { createMilestoneGitStatusService } = require('../main/services/milestone_git_status_service');
const { createMilestoneService } = require('../main/services/milestone_service');
const { createMilestoneValidationService } = require('../main/services/milestone_validation_service');

function git(rootPath, args) {
  return childProcess.execFileSync('git', ['-C', rootPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runCommand(bin, args, options = {}) {
  return new Promise((resolve) => {
    childProcess.execFile(
      bin,
      args,
      { timeout: options.timeoutMs || 5_000 },
      (error, stdout, stderr) => resolve({
        ok: !error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      }),
    );
  });
}

async function run() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-phase6-flow-'));
  try {
    const mapService = createApplicationMapService({ fs, path });
    const renderService = createApplicationMapRenderService({
      fs,
      path,
      mapService,
    });
    const milestoneService = createMilestoneService({ fs, path });

    const assetsIndexPath = path.join(rootPath, '.faber', 'map-assets-index.json');
    const assetPath = path.join(rootPath, 'Map assets', 'references', 'brand.png');
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.mkdirSync(path.dirname(assetsIndexPath), { recursive: true });
    fs.writeFileSync(assetPath, 'phase-6-asset', 'utf8');
    fs.writeFileSync(assetsIndexPath, JSON.stringify([{
      id: 'asset-phase-6',
      originalName: 'brand.png',
      projectRelativePath: 'Map assets/references/brand.png',
      kind: 'references',
      importedAt: '2026-08-25T15:00:00.000Z',
    }], null, 2), 'utf8');
    const assetsIndexBytes = fs.readFileSync(assetsIndexPath, 'utf8');

    const map = {
      nodes: [{
        id: 'node-foundation',
        type: 'group',
        title: 'Foundation',
        position: { x: 80, y: 120 },
      }, {
        id: 'node-brand',
        type: 'image',
        title: 'Brand reference',
        parentId: 'node-foundation',
        assetId: 'Map assets/references/brand.png',
        position: { x: 180, y: 220 },
      }],
      edges: [{
        id: 'edge-foundation-brand',
        sourceNodeId: 'node-foundation',
        targetNodeId: 'node-brand',
        type: 'contains',
      }],
      viewport: { x: -120, y: 64 },
      zoom: 1.25,
    };
    assert.strictEqual(mapService.saveMap(rootPath, map).ok, true);
    const mapAfterRoundTrip = mapService.getMap(rootPath);
    assert.deepStrictEqual(mapAfterRoundTrip.nodes, map.nodes);
    assert.deepStrictEqual(mapAfterRoundTrip.edges, map.edges);
    assert.deepStrictEqual(mapAfterRoundTrip.viewport, map.viewport);
    assert.strictEqual(mapAfterRoundTrip.zoom, map.zoom);
    assert.strictEqual(fs.readFileSync(assetsIndexPath, 'utf8'), assetsIndexBytes);

    const mapPath = path.join(rootPath, '.faber', 'application-map.json');
    const mapBytesBeforeChat = fs.readFileSync(mapPath, 'utf8');
    const persistedChatMessages = [];
    let mapChatRuntimePayload = null;
    const mapChatSessionService = createMapChatSessionService({
      applicationMapService: mapService,
      assistantRuntime: {
        async message(payload) {
          mapChatRuntimePayload = payload;
          return { ok: true, response: 'The map is ready for review.', action: null };
        },
      },
      authorizeProjectBinding(projectId, candidateRootPath) {
        return {
          ok: true,
          authorized: projectId === 'project-phase-6' && candidateRootPath === rootPath,
          projectId,
          rootPath: candidateRootPath,
          canonicalRootPath: candidateRootPath,
        };
      },
      conversationStore: {
        readOrchestrationState() {
          return {
            conversationsByProject: {
              'project-phase-6': [{
                id: 'conversation-phase-6',
                source: 'map_chat',
              }],
            },
          };
        },
        listConversationMessages(conversationId) {
          return { ok: true, conversationId, messages: [] };
        },
        addConversationMessage(projectId, conversationId, role, text, meta) {
          persistedChatMessages.push({ projectId, conversationId, role, text, meta });
          return { ok: true };
        },
      },
      milestoneService,
    });
    const mapChatResult = await mapChatSessionService.sendMessage({
      projectId: 'project-phase-6',
      rootPath,
      conversationId: 'conversation-phase-6',
      userMessage: 'Review the current map without changing it.',
      locale: 'en-US',
    });
    assert.strictEqual(mapChatResult.ok, true);
    assert.strictEqual(mapChatRuntimePayload.contextHint.access, 'read_only');
    assert.deepStrictEqual(mapChatRuntimePayload.contextHint.applicationMap.viewport, {
      x: map.viewport.x,
      y: map.viewport.y,
      zoom: map.zoom,
    });
    assert.deepStrictEqual(
      mapChatRuntimePayload.contextHint.applicationMap.assetReferences,
      ['Map assets/references/brand.png'],
    );
    assert.strictEqual(persistedChatMessages.length, 2);
    assert.strictEqual(fs.readFileSync(mapPath, 'utf8'), mapBytesBeforeChat);

    const renderedMap = renderService.renderMap(rootPath);
    assert.strictEqual(renderedMap.ok, true);
    const mapDocsPath = path.join(renderedMap.docsPath, 'application-map.json');
    assert.strictEqual(fs.existsSync(mapDocsPath), true);

    const milestones = [{
      id: 'milestone-phase-6',
      number: 1,
      title: 'Validated flow',
      summary: 'Prove the complete Map to Git flow.',
      status: 'planned',
      tasks: [{
        id: 'task-phase-6',
        title: 'Validate the flow',
        status: 'done',
      }],
      acceptanceCriteria: 'Map state survives and the real commit is linked.',
      validationCommands: 'npm test',
      references: [{ path: 'docs/application-map/README.md' }],
      commits: [],
      notes: '',
    }];
    assert.strictEqual(milestoneService.saveMilestones(rootPath, milestones).ok, true);
    assert.strictEqual(milestoneService.renderMilestones(rootPath).ok, true);
    const activated = milestoneService.updateMilestoneStatus(
      rootPath,
      'milestone-phase-6',
      'active',
    );
    assert.strictEqual(activated.ok, true);

    const startedAtMs = Date.parse(activated.milestone.startedAt);
    const jobCreatedAt = new Date(startedAtMs + 1_000).toISOString();
    const validatedAt = new Date(startedAtMs + 2_000).toISOString();
    const validationFields = {
      processExecutionPerformed: true,
      validationPending: false,
      validationVerified: true,
    };
    const authorizedJob = {
      id: 'job-phase-6-validated',
      rootPath,
      status: 'completed',
      phase: 'done',
      createdAt: jobCreatedAt,
      updatedAt: validatedAt,
      checkpoints: {
        execute_result: {
          savedAt: validatedAt,
          data: { ok: true, ...validationFields },
        },
      },
      events: [{
        id: 'event-phase-6-completed',
        type: 'job.completed',
        createdAt: validatedAt,
        payload: validationFields,
      }],
    };
    const validationService = createMilestoneValidationService({
      getAuthorizedJobById: (jobId) => (
        jobId === authorizedJob.id
          ? { ok: true, job: authorizedJob }
          : { ok: false, code: 'job_not_found' }
      ),
      milestoneService,
    });
    const completed = validationService.completeActiveMilestoneFromJob(
      rootPath,
      authorizedJob.id,
    );
    assert.strictEqual(completed.ok, true);
    assert.strictEqual(completed.milestone.status, 'done');
    assert.match(
      completed.milestone.completionEvidence.validationDigest,
      /^sha256:[a-f0-9]{64}$/,
    );

    git(rootPath, ['init']);
    git(rootPath, ['config', 'user.name', 'Faber Phase 6']);
    git(rootPath, ['config', 'user.email', 'phase6@faber.local']);
    fs.writeFileSync(path.join(rootPath, 'README.md'), '# Phase 6 flow\n', 'utf8');
    git(rootPath, ['add', '.']);
    git(rootPath, ['commit', '-m', 'test: prove phase 6 flow']);
    const commitHash = git(rootPath, ['rev-parse', 'HEAD']);

    const gitService = createProjectGitService({ runCommand });
    const milestoneGitStatusService = createMilestoneGitStatusService({
      gitService,
      milestoneService,
    });
    const linked = await milestoneGitStatusService.linkExistingMilestoneCommit(
      rootPath,
      'milestone-phase-6',
      commitHash,
    );
    assert.strictEqual(linked.ok, true);
    assert.strictEqual(linked.milestone.commits.length, 1);
    assert.strictEqual(linked.milestone.commits[0].hash, commitHash);
    assert.strictEqual(
      linked.milestone.commits[0].message,
      'test: prove phase 6 flow',
    );

    assert.strictEqual(milestoneService.renderMilestones(rootPath).ok, true);
    const milestoneDoc = fs.readFileSync(
      path.join(rootPath, 'docs', 'milestones', 'milestone-01-validated-flow.md'),
      'utf8',
    );
    assert.match(milestoneDoc, /Status: \*\*done\*\*/);
    assert.match(milestoneDoc, new RegExp(commitHash.slice(0, 7)));
    assert.deepStrictEqual(mapService.getMap(rootPath), mapAfterRoundTrip);
    assert.strictEqual(fs.readFileSync(assetsIndexPath, 'utf8'), assetsIndexBytes);

    console.log('phase6-map-to-git-flow.test.js: ok');
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
