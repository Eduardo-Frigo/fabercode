const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createOrchestrationStateStore } = require('../cortex/orchestration/state_store');
const { createApplicationMapRenderService } = require('../main/services/application_map_render_service');
const { createApplicationMapService } = require('../main/services/application_map_service');
const { createMilestoneService } = require('../main/services/milestone_service');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'persistence');

// These assertions intentionally record current limitations. Replacing them must be
// an explicit persistence migration with compatibility coverage, not a silent change.
const KNOWN_BASELINE = Object.freeze({
  milestones: Object.freeze({
    draftArrayIsHiddenUntilRender: true,
  }),
  jobs: Object.freeze({
    listOrderComesFromJobOrder: true,
  }),
});

function readFixture(fileName) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function withTempRoot(prefix, callback) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertIsoTimestamp(value, message) {
  assert.strictEqual(typeof value, 'string', message);
  assert.strictEqual(new Date(value).toISOString(), value, message);
}

function assertObjectKeys(value, expectedKeys, message) {
  assert.deepStrictEqual(
    Object.keys(value).sort(),
    expectedKeys.slice().sort(),
    message
  );
}

function createStore(tempRoot) {
  return createOrchestrationStateStore({
    CORTEX_BRIEFING_MAX_RETRIES: 2,
    CORTEX_VALIDATION_MAX_RETRIES: 2,
    CORTEX_VALIDATION_STALL_LIMIT: 1,
    JOB_PROGRESS_MIN_DELTA: 1,
    JOB_RETRY_NO_PROGRESS_MS: 60000,
    JOB_RETRY_SAME_FINGERPRINT_LIMIT: 2,
    JOB_RETRY_SAME_REASON_LIMIT: 2,
    JOB_RETRY_STAGNATION_LIMIT: 3,
    JOB_SOFT_TIMEOUT_MS: 600000,
    MAX_AUDIT_EVENTS: 12,
    MAX_CONVERSATION_MESSAGES: 20,
    MAX_CORTEX_LEARNING_EVENTS: 20,
    MAX_JOB_EVENTS: 20,
    MAX_JOBS_STORED: 20,
    computeRetryBackoffMs: () => 1000,
    fs,
    getUserDataPath: () => tempRoot,
    isNonRetriableProviderReason: () => false,
    path,
  });
}

function testApplicationMapRendererV1() {
  const fixture = readFixture('application-map-renderer-v1.json');

  assertObjectKeys(fixture, ['nodes', 'edges', 'viewport', 'zoom', 'updatedAt']);
  assert.strictEqual(fixture.nodes.some((node) => node.type === 'group'), true);
  assert.strictEqual(fixture.nodes.some((node) => node.type === 'image' && node.assetId), true);
  assert.strictEqual(fixture.edges[0].sourcePort, 'right');

  withTempRoot('faber-persistence-map-', (tempRoot) => {
    const mapPath = path.join(tempRoot, '.faber', 'application-map.json');
    const assetsIndexPath = path.join(tempRoot, '.faber', 'map-assets-index.json');
    const assetsFixture = readFixture('map-assets-index-v1.json');
    writeJson(mapPath, fixture);
    writeJson(assetsIndexPath, assetsFixture);
    const assetsIndexBytes = fs.readFileSync(assetsIndexPath, 'utf8');

    const mapService = createApplicationMapService({ fs, path });
    const renderService = createApplicationMapRenderService({ fs, path, mapService });

    assert.deepStrictEqual(
      mapService.getMap(tempRoot),
      fixture,
      'application-map renderer v1 must remain readable without normalization'
    );

    const saved = mapService.saveMap(tempRoot, fixture);
    assert.strictEqual(saved.ok, true);
    assert.deepStrictEqual(saved.map.nodes, fixture.nodes);
    assert.deepStrictEqual(saved.map.edges, fixture.edges);
    assert.deepStrictEqual(saved.map.viewport, fixture.viewport);
    assert.strictEqual(saved.map.zoom, fixture.zoom);
    assertIsoTimestamp(saved.map.updatedAt, 'saveMap must persist an ISO updatedAt');
    assert.deepStrictEqual(mapService.getMap(tempRoot), saved.map);
    assert.strictEqual(
      saved.map.nodes.find((node) => node.id === 'map-node-brand-reference').assetId,
      'Map assets/references/brand-board.png',
      'renderer asset references must survive the map round-trip'
    );
    assert.strictEqual(
      fs.readFileSync(assetsIndexPath, 'utf8'),
      assetsIndexBytes,
      'saving the map must not rewrite its durable asset index'
    );

    const rendered = renderService.renderMap(tempRoot);
    assert.strictEqual(rendered.ok, true);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(rendered.docsPath, 'application-map.json'), 'utf8')),
      saved.map,
      'rendered raw map copy must match the canonical persisted map'
    );
  });
}

function testMapAssetsIndexV1() {
  const fixture = readFixture('map-assets-index-v1.json');

  assert.strictEqual(Array.isArray(fixture), true, 'map assets index v1 is a root array');
  assertObjectKeys(fixture[0], [
    'id',
    'originalName',
    'projectRelativePath',
    'kind',
    'importedAt',
  ]);

  withTempRoot('faber-persistence-assets-', (tempRoot) => {
    const indexPath = path.join(tempRoot, '.faber', 'map-assets-index.json');
    writeJson(indexPath, fixture);

    const mapService = createApplicationMapService({ fs, path });
    const imported = mapService.importAssetBase64(
      tempRoot,
      Buffer.from('persistence-contract').toString('base64'),
      'contract-reference.png',
      'references'
    );

    assert.strictEqual(imported.ok, true);
    assertObjectKeys(imported.asset, [
      'id',
      'originalName',
      'projectRelativePath',
      'kind',
      'importedAt',
    ]);
    assert.strictEqual(imported.asset.originalName, 'contract-reference.png');
    assert.strictEqual(imported.asset.projectRelativePath, 'Map assets/references/contract-reference.png');
    assert.strictEqual(imported.asset.kind, 'references');
    assertIsoTimestamp(imported.asset.importedAt, 'asset importedAt must remain an ISO timestamp');

    const persisted = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.deepStrictEqual(persisted.slice(0, fixture.length), fixture, 'existing asset records must not be rewritten');
    assert.deepStrictEqual(persisted[persisted.length - 1], imported.asset);
    assert.strictEqual(
      fs.existsSync(path.join(tempRoot, 'Map assets', 'references', 'contract-reference.png')),
      true
    );
  });
}

function testMilestonesDraftV1() {
  const fixture = readFixture('milestones-draft-v1.json');

  assert.strictEqual(Array.isArray(fixture), true, 'milestone draft v1 is a root array');
  assertObjectKeys(fixture[0], [
    'id',
    'number',
    'title',
    'summary',
    'status',
    'tasks',
    'acceptanceCriteria',
    'validationCommands',
    'commits',
    'notes',
    'references',
  ]);

  withTempRoot('faber-persistence-milestone-draft-', (tempRoot) => {
    const milestonePath = path.join(tempRoot, '.faber', 'milestones.json');
    writeJson(milestonePath, fixture);
    const service = createMilestoneService({ fs, path });

    assert.strictEqual(KNOWN_BASELINE.milestones.draftArrayIsHiddenUntilRender, true);
    assert.deepStrictEqual(
      service.listMilestones(tempRoot),
      [],
      'KNOWN_BASELINE: listMilestones currently hides an unrendered draft array'
    );

    const rendered = service.renderMilestones(tempRoot);
    assert.strictEqual(rendered.ok, true);

    const persisted = JSON.parse(fs.readFileSync(milestonePath, 'utf8'));
    assertObjectKeys(persisted, ['renderedAt', 'source', 'milestones']);
    assertIsoTimestamp(persisted.renderedAt, 'render must persist renderedAt');
    assert.strictEqual(persisted.source, 'application-map-render');
    assert.deepStrictEqual(persisted.milestones, fixture, 'render must preserve the complete draft payload');
    assert.deepStrictEqual(service.listMilestones(tempRoot), fixture, 'rendered draft must become listable');
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(rendered.docsPath, 'milestones.json'), 'utf8')),
      fixture,
      'rendered documentation must contain the same milestones'
    );
  });
}

function testMilestonesRenderedV1() {
  const fixture = readFixture('milestones-rendered-v1.json');

  assertObjectKeys(fixture, ['renderedAt', 'source', 'milestones']);
  assert.strictEqual(fixture.source, 'application-map-render');

  withTempRoot('faber-persistence-milestone-rendered-', (tempRoot) => {
    const milestonePath = path.join(tempRoot, '.faber', 'milestones.json');
    writeJson(milestonePath, fixture);
    const service = createMilestoneService({ fs, path });

    assert.deepStrictEqual(service.listMilestones(tempRoot), fixture.milestones);

    const saved = service.saveMilestones(tempRoot, fixture.milestones);
    assert.strictEqual(saved.ok, true);
    const persisted = JSON.parse(fs.readFileSync(milestonePath, 'utf8'));
    assert.strictEqual(persisted.renderedAt, fixture.renderedAt, 'save must retain renderedAt from the envelope');
    assert.strictEqual(persisted.source, fixture.source, 'save must retain the render source');
    assertIsoTimestamp(persisted.updatedAt, 'save must add an ISO updatedAt to a rendered envelope');
    assert.deepStrictEqual(persisted.milestones, fixture.milestones);
    assert.deepStrictEqual(service.listMilestones(tempRoot), fixture.milestones);
  });
}

function testOrchestrationV1() {
  const fixture = readFixture('orchestration-v1.json');

  assertObjectKeys(fixture, [
    'conversationsByProject',
    'messagesByConversation',
    'cortexLearningByProject',
    'auditTrail',
  ]);

  withTempRoot('faber-persistence-orchestration-', (tempRoot) => {
    const orchestrationPath = path.join(tempRoot, 'orchestration.json');
    writeJson(orchestrationPath, fixture);
    const store = createStore(tempRoot);

    const state = store.readOrchestrationState();
    assert.deepStrictEqual(state, fixture, 'orchestration v1 must read without data loss');

    store.writeOrchestrationState(state);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(orchestrationPath, 'utf8')),
      fixture,
      'orchestration v1 must survive a semantic read/write round-trip'
    );

    const mapMessages = store.listConversationMessages('conversation-map-v1', 20);
    assert.strictEqual(mapMessages.ok, true);
    assert.deepStrictEqual(mapMessages.messages, fixture.messagesByConversation['conversation-map-v1']);

    const learning = store.getCortexLearning('project-contract-v1');
    assert.strictEqual(learning.ok, true);
    assert.deepStrictEqual(learning.learning, fixture.cortexLearningByProject['project-contract-v1']);
    assert.deepStrictEqual(
      fixture.conversationsByProject['project-contract-v1'].map((conversation) => conversation.source),
      ['map_chat', 'map_render'],
      'map chat and map render conversation sources are part of orchestration v1'
    );
  });
}

function testJobsV1() {
  const fixture = readFixture('jobs-v1.json');

  assertObjectKeys(fixture, ['jobsById', 'jobOrder']);
  assert.deepStrictEqual(fixture.jobOrder, ['job-contract-running-v1', 'job-contract-completed-v1']);

  withTempRoot('faber-persistence-jobs-', (tempRoot) => {
    const jobsPath = path.join(tempRoot, 'jobs.json');
    writeJson(jobsPath, fixture);
    const store = createStore(tempRoot);

    const state = store.readJobsState();
    assert.deepStrictEqual(state, fixture, 'jobs v1 must read without data loss');

    store.writeJobsState(state);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(jobsPath, 'utf8')),
      fixture,
      'jobs v1 must survive a semantic read/write round-trip'
    );

    assert.strictEqual(KNOWN_BASELINE.jobs.listOrderComesFromJobOrder, true);
    const listed = store.listJobs({ limit: 20 });
    assert.deepStrictEqual(
      listed.jobs.map((job) => job.id),
      fixture.jobOrder,
      'KNOWN_BASELINE: listJobs order is defined by jobOrder'
    );
    assert.deepStrictEqual(
      store.listJobs({ projectId: 'project-contract-v1', limit: 20 }).jobs.map((job) => job.id),
      ['job-contract-running-v1']
    );
    assert.deepStrictEqual(
      store.getJobById('job-contract-running-v1').job,
      fixture.jobsById['job-contract-running-v1']
    );
  });
}

function run() {
  testApplicationMapRendererV1();
  testMapAssetsIndexV1();
  testMilestonesDraftV1();
  testMilestonesRenderedV1();
  testOrchestrationV1();
  testJobsV1();
  console.log('persistence-contracts.test.js: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
