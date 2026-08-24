'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
} = require('../main/agent_runtime/context_pack_contracts');
const {
  PROJECT_ROOT_READER_VERSION,
} = require('../main/capabilities/project_root_authority_contract');
const {
  CONTEXT_PACK_PRODUCTION_SOURCE_READERS_VERSION,
  createContextPackProductionSourceReaders,
} = require('../main/services/context_pack_production_source_readers');

const digest = (character) => `sha256:${character.repeat(64)}`;
const bytesDigest = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function readResult(content) {
  if (content === null) {
    return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
  }
  const bytes = Buffer.from(content, 'utf8');
  return Object.freeze({
    found: true,
    contentBase64: bytes.toString('base64'),
    contentDigest: bytesDigest(bytes),
  });
}

async function run() {
  const files = new Map([
    ['AGENTS.md', '# Regras globais\n- Preserve contratos.'],
    ['src/AGENTS.md', '# Regras de src\n- Testes antes da implementação.'],
    ['package.json', '{"scripts":{"test":"node tests/run.js"}}'],
    ['src/index.js', "module.exports = 'ok';"],
  ]);
  const rootReadRequests = [];
  const projectRootReader = Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list: () => Promise.resolve(Object.freeze({ entries: Object.freeze([]), truncated: false })),
    inspectEntry: () => Promise.resolve(Object.freeze({
      found: false,
      kind: null,
      bytes: null,
      mode: null,
      mtimeMs: null,
      contentDigest: null,
      linkTarget: null,
      entryIdentityDigest: null,
    })),
    readFile(input) {
      rootReadRequests.push(input);
      return Promise.resolve(readResult(files.has(input.relativePath)
        ? files.get(input.relativePath)
        : null));
    },
  });

  const mutationCalls = [];
  const bundle = createContextPackProductionSourceReaders({
    applicationMapService: {
      readApplicationMapSnapshot: () => ({
        ok: true,
        found: true,
        map: {
          nodes: [
            { id: 'runtime', title: 'Agent Runtime' },
            { id: 'broker', title: 'Capability Broker' },
          ],
          edges: [{ id: 'edge-1', sourceNodeId: 'runtime', targetNodeId: 'broker' }],
          viewport: { x: 0, y: 0, zoom: 1 },
          updatedAt: '2026-08-24T13:10:00.000Z',
        },
        contentDigest: digest('a'),
      }),
      saveMap: () => mutationCalls.push('saveMap'),
    },
    milestoneService: {
      readMilestonesSnapshot: () => ({
        ok: true,
        found: true,
        format: 'rendered',
        renderedAt: '2026-08-24T13:00:00.000Z',
        source: 'application-map-render',
        milestones: [{
          id: 'milestone-3',
          number: 3,
          title: 'ContextPack',
          summary: 'Conectar contexto governado.',
          status: 'active',
          acceptanceCriteria: 'Toda memória possui provenance.',
          tasks: [
            { id: 'task-1', title: 'Criar leitores', status: 'done' },
            { id: 'task-2', title: 'Conectar runtime', status: 'pending' },
          ],
        }],
        contentDigest: digest('b'),
      }),
      saveMilestones: () => mutationCalls.push('saveMilestones'),
    },
    gitService: {
      getProjectGitWorktree: () => Promise.resolve({
        ok: true,
        isGitRepo: true,
        branch: 'feat/harness-v2',
        latest: { hash: '3fcabf4', subject: 'collect sources', relative: 'agora' },
        entries: [
          { path: 'src/index.js', status: 'modified', add: 4, del: 1, summary: 'Atualizou o runtime.' },
        ],
      }),
      stageProjectGitFiles: () => mutationCalls.push('stage'),
    },
    getActiveMemory: () => ({
      ok: true,
      validity: { expired: false, expiresAt: '2026-08-24T14:00:00.000Z' },
      citations: [{ source: 'cortex_learning.events', sourceId: 'memory-7' }],
      provenance: {
        schemaVersion: 'memory-provenance-v1',
        used: [{ source: 'cortex_learning.events', sourceId: 'memory-7' }],
      },
      decision: {
        briefingContextText: 'Preservar mapa, milestones, Files, Git e Execute.',
      },
    }),
    getConversation: () => ({
      revision: 'conversation-revision-4',
      messages: [
        { role: 'user', text: 'Pode commitar e continuar.' },
        { role: 'assistant', text: 'Checkpoint registrado; iniciando leitores.' },
      ],
    }),
    getProjectRootReader: () => projectRootReader,
  });

  assert.strictEqual(Object.isFrozen(bundle), true);
  assert.deepStrictEqual(Reflect.ownKeys(bundle), ['version', 'readers', 'diagnostics']);
  assert.strictEqual(bundle.version, CONTEXT_PACK_PRODUCTION_SOURCE_READERS_VERSION);
  assert.strictEqual(Object.isFrozen(bundle.readers), true);
  assert.strictEqual(bundle.readers.length, 7);

  const context = Object.freeze({
    authorityDigest: digest('d'),
    requestId: 'request-1',
    projectId: 'project-1',
    surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
    sourceScope: Object.freeze({
      projectId: 'project-1',
      rootPath: '/workspace/project',
      jobId: 'job-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      relativeCwd: 'src',
      relevantFiles: Object.freeze([
        'package.json',
        'src/index.js',
        '.env',
        '.faber/application-map.json',
        'private_context/memory.json',
        'src/private-key.pem',
        '.npmrc',
        'config/signing.key',
      ]),
    }),
  });
  const sections = await Promise.all(bundle.readers.map((reader) => reader.read(context)));
  const byId = new Map(sections.map((section) => [section.id, section]));
  assert.strictEqual(byId.size, 7);
  assert([...byId.values()].every((section) => section.state === CONTEXT_PACK_SECTION_STATES.AVAILABLE));
  assert(byId.get(CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP).summary.includes('2 nós'));
  assert(byId.get(CONTEXT_PACK_SECTION_IDS.MILESTONE).summary.includes('Milestone ativa 3:'));
  assert(byId.get(CONTEXT_PACK_SECTION_IDS.MILESTONE).summary.includes('Toda memória possui provenance'));
  assert(byId.get(CONTEXT_PACK_SECTION_IDS.GIT).summary.includes('src/index.js'));
  assert(byId.get(CONTEXT_PACK_SECTION_IDS.MEMORY).summary.includes('Preservar mapa'));
  assert.strictEqual(byId.get(CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS).citations.length, 2);
  assert.strictEqual(byId.get(CONTEXT_PACK_SECTION_IDS.FILES).citations.length, 2);
  assert(byId.get(CONTEXT_PACK_SECTION_IDS.CONVERSATION).summary.includes('Pode commitar'));
  assert.strictEqual(JSON.stringify(sections).includes('/workspace/project'), false);
  assert.deepStrictEqual(mutationCalls, []);
  assert.deepStrictEqual(
    new Set(rootReadRequests.map((request) => request.relativePath)),
    new Set(['AGENTS.md', 'src/AGENTS.md', 'package.json', 'src/index.js'])
  );
  assert(rootReadRequests.every((request) => Object.isFrozen(request)));
  assert.deepStrictEqual(bundle.diagnostics(), Object.freeze({
    version: CONTEXT_PACK_PRODUCTION_SOURCE_READERS_VERSION,
    reads: 7,
    failures: 0,
  }));

  const unavailableBundle = createContextPackProductionSourceReaders({
    applicationMapService: {
      readApplicationMapSnapshot: () => ({ ok: false, found: false }),
    },
    milestoneService: {
      readMilestonesSnapshot: () => ({
        ok: true,
        found: true,
        format: 'draft',
        milestones: [],
        contentDigest: digest('e'),
      }),
    },
    gitService: {
      getProjectGitWorktree: () => ({ ok: true, isGitRepo: false }),
    },
    getActiveMemory: () => ({
      ok: true,
      validity: { expired: true },
      citations: [{ source: 'memory' }],
      provenance: { schemaVersion: 'memory-provenance-v1', used: [] },
      decision: { briefingContextText: 'expirado' },
    }),
    getConversation: () => null,
    getProjectRootReader: () => projectRootReader,
  });
  const unavailableContext = Object.freeze({
    ...context,
    sourceScope: Object.freeze({
      ...context.sourceScope,
      conversationId: null,
      relativeCwd: '',
      relevantFiles: Object.freeze([]),
    }),
  });
  const unavailableSections = await Promise.all(
    unavailableBundle.readers.map((reader) => reader.read(unavailableContext))
  );
  const unavailableById = new Map(unavailableSections.map((section) => [section.id, section]));
  assert.strictEqual(
    unavailableById.get(CONTEXT_PACK_SECTION_IDS.APPLICATION_MAP).state,
    CONTEXT_PACK_SECTION_STATES.UNAVAILABLE
  );
  assert.strictEqual(
    unavailableById.get(CONTEXT_PACK_SECTION_IDS.MEMORY).state,
    CONTEXT_PACK_SECTION_STATES.UNAVAILABLE
  );
  for (const sectionId of [
    CONTEXT_PACK_SECTION_IDS.MILESTONE,
    CONTEXT_PACK_SECTION_IDS.GIT,
    CONTEXT_PACK_SECTION_IDS.FILES,
    CONTEXT_PACK_SECTION_IDS.CONVERSATION,
  ]) {
    assert.strictEqual(
      unavailableById.get(sectionId).state,
      CONTEXT_PACK_SECTION_STATES.EMPTY
    );
  }

  console.log('context-pack-production-readers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
