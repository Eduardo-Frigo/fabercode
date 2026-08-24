'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  PROJECT_ROOT_READER_VERSION,
} = require('../main/capabilities/project_root_authority_contract');
const {
  AGENTIC_DOMAIN_READ_BROKER_FACTORY_VERSION,
  AGENTIC_DOMAIN_READ_ROUTE_VERSION,
  createAgenticDomainReadBrokerFactory,
} = require('../main/services/agentic_domain_read_broker_factory');

const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

const binding = createCapabilityDelegationBinding({
  projectId: 'project-a',
  canonicalRootPath: '/projects/a',
  realRootPath: '/private/projects/a',
  sessionId: 'session-a',
  jobId: 'job-a',
  kernelId: 'kernel-a',
  submissionDigest: sha256('submission-a'),
});

function frozenPayload(value) {
  return Object.freeze(value);
}

function request(capability, action, payload = {}) {
  return Object.freeze({
    capability,
    action,
    payload: frozenPayload(payload),
  });
}

function createHarness() {
  const state = {
    active: true,
    audits: [],
    effectChecks: 0,
    inspections: [],
    lifecycleChecks: 0,
    lists: [],
    reads: [],
    requestIds: 0,
    rootChecks: 0,
  };
  const contents = new Map([
    ['README.md', Buffer.from('# Faber\nconteúdo longo', 'utf8')],
    ['src/app.js', Buffer.from("module.exports = 'ok';\n", 'utf8')],
    ['.env', Buffer.from('API_TOKEN=secret', 'utf8')],
    ['.faber/application-map.json', Buffer.from(JSON.stringify({
      schemaVersion: 'application-map-v2',
      revision: 7,
      nodes: [{ id: 'runtime', title: 'Runtime' }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: '2026-08-24T12:00:00.000Z',
    }), 'utf8')],
    ['.faber/milestones.json', Buffer.from(JSON.stringify({
      schemaVersion: 'milestones-v2',
      revision: 4,
      sourceMapRevision: 7,
      renderedAt: '2026-08-24T12:10:00.000Z',
      updatedAt: '2026-08-24T12:10:00.000Z',
      milestones: [{
        id: 'milestone-3',
        number: 3,
        title: 'Ferramentas de domínio',
        status: 'active',
        tasks: [],
      }],
    }), 'utf8')],
  ]);
  const directories = new Map([
    ['', [
      { name: '.env', kind: 'file' },
      { name: '.faber', kind: 'directory' },
      { name: '.git', kind: 'directory' },
      { name: 'README.md', kind: 'file' },
      { name: 'src', kind: 'directory' },
    ]],
    ['src', [{ name: 'app.js', kind: 'file' }]],
  ]);

  const projectRootReader = Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list(input) {
      state.lists.push(input);
      const available = directories.get(input.relativePath) || [];
      const entries = available.slice(0, input.maxEntries).map((entry) => Object.freeze(entry));
      return Promise.resolve(Object.freeze({
        entries: Object.freeze(entries),
        truncated: available.length > input.maxEntries,
      }));
    },
    readFile(input) {
      state.reads.push(input);
      const content = contents.get(input.relativePath);
      if (!content) {
        return Promise.resolve(Object.freeze({
          found: false,
          contentBase64: null,
          contentDigest: null,
        }));
      }
      const returned = content.subarray(0, input.maxBytes);
      return Promise.resolve(Object.freeze({
        found: true,
        contentBase64: returned.toString('base64'),
        contentDigest: sha256(returned),
      }));
    },
    inspectEntry(input) {
      state.inspections.push(input);
      const content = contents.get(input.relativePath);
      if (!content) {
        return Promise.resolve(Object.freeze({
          found: false,
          kind: null,
          bytes: null,
          mode: null,
          mtimeMs: null,
          contentDigest: null,
          linkTarget: null,
          entryIdentityDigest: null,
        }));
      }
      return Promise.resolve(Object.freeze({
        found: true,
        kind: 'file',
        bytes: content.length,
        mode: 0o644,
        mtimeMs: 1_777_000_000_000,
        contentDigest: sha256(content),
        linkTarget: null,
        entryIdentityDigest: sha256(`entry:${input.relativePath}`),
      }));
    },
  });

  const factory = createAgenticDomainReadBrokerFactory({
    authorizeLifecycle(candidate) {
      state.lifecycleChecks += 1;
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    authorizeRoot(input) {
      state.rootChecks += 1;
      return state.active
        ? Object.freeze({
          ok: true,
          authorized: true,
          projectId: input.projectId,
          rootPath: input.rootPath,
          canonicalRootPath: input.rootPath,
          realRootPath: binding.realRootPath,
        })
        : Object.freeze({ authorized: false });
    },
    authorizeEffectFrontier(candidate) {
      state.effectChecks += 1;
      return state.active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    audit(event) {
      state.audits.push(event);
    },
    requestIdFactory() {
      state.requestIds += 1;
      return `domain-read-${state.requestIds}`;
    },
  });
  const route = factory.createRoute(Object.freeze({ binding, projectRootReader }));
  return { contents, factory, route, state };
}

async function run() {
  const harness = createHarness();
  assert.strictEqual(Object.isFrozen(harness.factory), true);
  assert.strictEqual(
    harness.factory.diagnostics().version,
    AGENTIC_DOMAIN_READ_BROKER_FACTORY_VERSION
  );
  assert.strictEqual(Object.isFrozen(harness.route), true);
  assert.deepStrictEqual(Reflect.ownKeys(harness.route), [
    'version',
    'execute',
    'diagnostics',
  ]);
  assert.strictEqual(harness.route.version, AGENTIC_DOMAIN_READ_ROUTE_VERSION);
  assert.strictEqual(JSON.stringify(harness.route).includes('/projects/a'), false);
  assert.strictEqual(JSON.stringify(harness.route).includes('submissionDigest'), false);

  const tree = await harness.route.execute(request(
    'filesystem',
    'project_tree',
    { maxEntries: 50 }
  ));
  assert.strictEqual(tree.status, 'completed');
  assert.strictEqual(tree.decision, 'allow');
  assert.deepStrictEqual(tree.output.entries, [
    { path: 'README.md', kind: 'file' },
    { path: 'src', kind: 'directory' },
    { path: 'src/app.js', kind: 'file' },
  ]);
  assert.strictEqual(tree.output.truncated, false);
  assert.strictEqual(JSON.stringify(tree.output).includes('.faber'), false);
  assert.strictEqual(JSON.stringify(tree.output).includes('.git'), false);
  assert.strictEqual(JSON.stringify(tree.output).includes('.env'), false);

  const file = await harness.route.execute(request(
    'filesystem',
    'read_file',
    { path: 'README.md', maxBytes: 8 }
  ));
  assert.strictEqual(file.status, 'completed');
  assert.strictEqual(file.output.ok, true);
  assert.strictEqual(file.output.path, 'README.md');
  assert.strictEqual(file.output.content, '# Faber\n');
  assert.strictEqual(file.output.encoding, 'utf8');
  assert.strictEqual(file.output.bytes, harness.contents.get('README.md').length);
  assert.strictEqual(file.output.returnedBytes, 8);
  assert.strictEqual(file.output.truncated, true);
  assert.strictEqual(file.output.revision, sha256(harness.contents.get('README.md')));
  assert.strictEqual(Object.isFrozen(file.output), true);

  const readsBeforeProtectedFile = harness.state.reads.length;
  const protectedFile = await harness.route.execute(request(
    'filesystem',
    'read_file',
    { path: '.env', maxBytes: 100 }
  ));
  assert.strictEqual(protectedFile.status, 'denied');
  assert.strictEqual(protectedFile.error.code, 'PROTECTED_PROJECT_PATH');
  assert.strictEqual(harness.state.reads.length, readsBeforeProtectedFile);

  const map = await harness.route.execute(request('application_map', 'read'));
  assert.strictEqual(map.status, 'completed');
  assert.strictEqual(map.output.ok, true);
  assert.strictEqual(map.output.found, true);
  assert.strictEqual(map.output.format, 'application-map-v2');
  assert.strictEqual(map.output.map.revision, 7);
  assert.strictEqual(
    map.output.revision,
    sha256(harness.contents.get('.faber/application-map.json'))
  );

  const milestones = await harness.route.execute(request('milestones', 'read'));
  assert.strictEqual(milestones.status, 'completed');
  assert.strictEqual(milestones.output.ok, true);
  assert.strictEqual(milestones.output.found, true);
  assert.strictEqual(milestones.output.format, 'milestones-v2');
  assert.strictEqual(milestones.output.sourceMapRevision, 7);
  assert.strictEqual(milestones.output.milestones[0].status, 'active');
  assert.strictEqual(
    milestones.output.revision,
    sha256(harness.contents.get('.faber/milestones.json'))
  );

  const oldMapRevision = map.output.revision;
  harness.contents.set('.faber/application-map.json', Buffer.from(JSON.stringify({
    schemaVersion: 'application-map-v2',
    revision: 8,
    nodes: [{ id: 'runtime', title: 'Runtime atualizado' }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: '2026-08-24T13:00:00.000Z',
  }), 'utf8'));
  const changedMap = await harness.route.execute(request('application_map', 'read'));
  assert.notStrictEqual(changedMap.output.revision, oldMapRevision);
  assert.strictEqual(changedMap.output.map.revision, 8);

  const unsupportedGit = await harness.route.execute(request('git', 'status'));
  assert.strictEqual(unsupportedGit.status, 'denied');
  assert.strictEqual(unsupportedGit.error.code, 'CAPABILITY_NOT_ALLOWED');

  const readsBeforeRevocation = harness.state.reads.length;
  harness.state.active = false;
  const revoked = await harness.route.execute(request(
    'filesystem',
    'read_file',
    { path: 'src/app.js', maxBytes: 100 }
  ));
  assert.strictEqual(revoked.status, 'denied');
  assert.strictEqual(revoked.error.code, 'PROJECT_SCOPE_INVALID');
  assert.strictEqual(harness.state.reads.length, readsBeforeRevocation);

  assert(harness.state.lifecycleChecks >= 12);
  assert(harness.state.rootChecks >= 12);
  assert(harness.state.effectChecks >= 5);
  assert.strictEqual(JSON.stringify(harness.state.audits).includes('/projects/a'), false);
  assert.strictEqual(JSON.stringify(harness.state.audits).includes('/private/projects/a'), false);
  assert.deepStrictEqual(harness.route.diagnostics(), Object.freeze({
    version: AGENTIC_DOMAIN_READ_ROUTE_VERSION,
    requests: 8,
    completed: 5,
    denied: 3,
    failed: 0,
    capabilities: Object.freeze([
      'filesystem.project_tree',
      'filesystem.read_file',
      'application_map.read',
      'milestones.read',
    ]),
    authorityBoundary: 'job_binding',
  }));
  assert.deepStrictEqual(harness.factory.diagnostics(), Object.freeze({
    version: AGENTIC_DOMAIN_READ_BROKER_FACTORY_VERSION,
    routesCreated: 1,
    totalRequests: 8,
    capabilities: Object.freeze([
      'filesystem.project_tree',
      'filesystem.read_file',
      'application_map.read',
      'milestones.read',
    ]),
    authorityBoundary: 'main_process_only',
  }));

  let getterCalls = 0;
  const hostilePayload = {};
  Object.defineProperty(hostilePayload, 'path', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'README.md';
    },
  });
  await assert.rejects(
    harness.route.execute(Object.freeze({
      capability: 'filesystem',
      action: 'read_file',
      payload: Object.freeze(hostilePayload),
    })),
    TypeError
  );
  assert.strictEqual(getterCalls, 0);

  console.log('agentic-domain-read-broker-factory.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
