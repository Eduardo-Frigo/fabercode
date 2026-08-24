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
  CONTEXT_PACK_PRODUCTION_RUNTIME_VERSION,
  createContextPackProductionRuntime,
} = require('../main/services/context_pack_production_runtime');

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
    ['AGENTS.md', '# Instruções\n- Preserve contratos.'],
    ['src/index.js', "module.exports = 'ok';"],
  ]);
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
    readFile(request) {
      return Promise.resolve(readResult(
        files.has(request.relativePath) ? files.get(request.relativePath) : null
      ));
    },
  });

  let authorizationCalls = 0;
  const runtime = createContextPackProductionRuntime({
    authorizeBinding(input) {
      authorizationCalls += 1;
      assert.strictEqual(input.binding.turnId, 'turn-1');
      return {
        authorized: true,
        authorityDigest: digest('a'),
        requestId: 'request-1',
        projectId: 'project-1',
        sourceScope: {
          projectId: 'project-1',
          rootPath: '/workspace/project',
          jobId: 'job-1',
          conversationId: 'conversation-1',
          userId: 'user-1',
          relativeCwd: '',
          relevantFiles: ['src/index.js'],
        },
        requestText: 'Continue a implementação do ContextPack.',
        permissionsText: 'Somente leitura contextual autorizada.',
      };
    },
    applicationMapService: {
      readApplicationMapSnapshot: () => ({
        ok: true,
        found: true,
        map: {
          nodes: [{ id: 'runtime', title: 'Agent Runtime' }],
          edges: [],
        },
        contentDigest: digest('b'),
      }),
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
          status: 'active',
          acceptanceCriteria: 'Contexto governado em todos os turnos.',
          tasks: [],
        }],
        contentDigest: digest('c'),
      }),
    },
    gitService: {
      getProjectGitWorktree: () => ({
        ok: true,
        isGitRepo: true,
        branch: 'feat/harness-v2',
        latest: { hash: '1b1225f', subject: 'context readers', relative: 'agora' },
        entries: [],
      }),
    },
    getActiveMemory: () => ({
      ok: true,
      validity: { expired: false },
      citations: [{ source: 'cortex_learning.events', sourceId: 'memory-1' }],
      provenance: {
        schemaVersion: 'memory-provenance-v1',
        used: [{ source: 'cortex_learning.events', sourceId: 'memory-1' }],
      },
      decision: { briefingContextText: 'Preservar a arquitetura do Harness v2.' },
    }),
    getConversation: () => ({
      revision: 'conversation-2',
      messages: [{ role: 'user', text: 'Pode commitar e continuar.' }],
    }),
    getProjectRootReader: () => projectRootReader,
    compilerOptions: {
      now: () => '2026-08-24T14:00:00.000Z',
      maxSummaryChars: 8_192,
      maxSectionSummaryChars: 2_048,
    },
  });

  assert.strictEqual(Object.isFrozen(runtime), true);
  assert.deepStrictEqual(Reflect.ownKeys(runtime), ['version', 'collect', 'diagnostics']);
  assert.strictEqual(runtime.version, CONTEXT_PACK_PRODUCTION_RUNTIME_VERSION);

  const manifest = await runtime.collect(Object.freeze({
    binding: Object.freeze({ turnId: 'turn-1' }),
    surface: CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE,
  }));
  assert.strictEqual(manifest.requestId, 'request-1');
  assert.strictEqual(manifest.projectId, 'project-1');
  assert.strictEqual(manifest.surface, CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE);
  assert.strictEqual(authorizationCalls, 2);
  assert(manifest.sections.every(
    (section) => section.state === CONTEXT_PACK_SECTION_STATES.AVAILABLE
  ));
  assert.strictEqual(JSON.stringify(manifest).includes('/workspace/project'), false);
  assert.strictEqual(
    manifest.sections.find((section) => section.id === CONTEXT_PACK_SECTION_IDS.MILESTONE)
      .summary.includes('Contexto governado'),
    true
  );

  const diagnostics = runtime.diagnostics();
  assert.strictEqual(Object.isFrozen(diagnostics), true);
  assert.deepStrictEqual(Reflect.ownKeys(diagnostics), [
    'version',
    'authorizer',
    'compiler',
    'readers',
    'collector',
  ]);
  assert.strictEqual(diagnostics.version, CONTEXT_PACK_PRODUCTION_RUNTIME_VERSION);
  assert.strictEqual(diagnostics.authorizer.authorizations, 2);
  assert.strictEqual(diagnostics.compiler.compilations, 1);
  assert.strictEqual(diagnostics.readers.reads, 7);
  assert.strictEqual(diagnostics.readers.failures, 0);
  assert.strictEqual(diagnostics.collector.collections, 1);
  assert.strictEqual(diagnostics.collector.sourceFailures, 0);
  assert.strictEqual(diagnostics.collector.lastPackId, manifest.packId);

  assert.throws(() => createContextPackProductionRuntime({
    authorizeBinding: () => ({}),
  }), TypeError);

  console.log('context-pack-production-runtime.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
