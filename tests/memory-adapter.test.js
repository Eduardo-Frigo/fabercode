const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createMemoryContextAdapter,
  normalizeWingSlug,
} = require('../cortex/memory/context_adapter');

class FakeAbortController {
  constructor() {
    this.signal = {};
  }

  abort() {}
}

function clipText(value, max = 4000) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function createFetchResponse({ ok = true, status = 200, body = {} }) {
  return {
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function createAdapter(tempRoot, options = {}) {
  const repoRoot = path.join(tempRoot, 'mempalace-develop');
  const calls = [];
  const fetchCalls = [];
  const fetchResponses = [];
  const adapter = createMemoryContextAdapter({
    CORTEX_RAG_ENABLED: options.ragEnabled !== false,
    CORTEX_RAG_PROVIDER: 'r2r',
    MEMPALACE_COMMAND_TIMEOUT_MS: 12000,
    MEMPALACE_PYTHON_BIN: 'python3',
    MEMPALACE_REPO_CANDIDATES: [repoRoot],
    R2R_API_KEY: 'r2r-key',
    R2R_BASE_URL: 'http://r2r.test',
    R2R_CORTEX_DELETE_ENDPOINT: options.ragDeleteEndpoint || '',
    R2R_CORTEX_INGEST_ENDPOINT: options.ragIngestEndpoint || '',
    R2R_CORTEX_REINDEX_ENDPOINT: options.ragReindexEndpoint || '',
    R2R_SEARCH_LIMIT: 4,
    R2R_TIMEOUT_MS: 5000,
    abortController: FakeAbortController,
    clearTimeoutFn: () => {},
    clipText,
    crypto,
    env: options.env || {},
    extractIntentTerms: (text) => String(text || '').toLowerCase().split(/\s+/).filter(Boolean),
    fetchFn: async (url, request) => {
      fetchCalls.push({ url, request, body: JSON.parse(request.body) });
      if (!fetchResponses.length) throw new Error('Resposta R2R fake ausente.');
      return fetchResponses.shift();
    },
    fs,
    getRuntimeProfileSettings: () => ({ memoryContextChars: 32 }),
    getUserDataPath: () => tempRoot,
    path,
    runCommand: async (bin, args, commandOptions) => {
      calls.push({ bin, args, options: commandOptions });
      if (args.includes('--version')) {
        return { ok: true, stdout: 'mempalace 1.0\n', stderr: '' };
      }
      if (args.includes('init')) {
        return { ok: true, stdout: 'init ok\n', stderr: '' };
      }
      if (args.includes('mine')) {
        return { ok: true, stdout: 'mine ok\n', stderr: '' };
      }
      if (args.includes('search')) {
        return { ok: true, stdout: 'memoria encontrada para o projeto\n', stderr: '' };
      }
      if (args.includes('-c')) {
        return {
          ok: true,
          stdout: JSON.stringify({
            ok: true,
            wing: 'project_alpha',
            layers: { wake_up: 'wake memory' },
            kg: { facts: [{ entity: 'alpha', facts: [['a', 'b', 'c']] }] },
            graph: { tunnels: [{ a: 'x', b: 'y' }], stats: { nodes: 2 } },
            drawer: { success: true, drawer_id: 'drawer-1' },
          }),
          stderr: '',
        };
      }
      return { ok: false, stdout: '', stderr: 'unexpected command' };
    },
    setTimeoutFn: () => 1,
  });
  return { adapter, calls, fetchCalls, fetchResponses, repoRoot };
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-memory-adapter-'));
  try {
    assert.strictEqual(normalizeWingSlug('Project Alpha!'), 'project_alpha');

    const missing = createAdapter(tempRoot);
    const missingStatus = await missing.adapter.getMempalaceRuntimeStatus({ rootPath: path.join(tempRoot, 'Project Alpha') });
    assert.strictEqual(missingStatus.available, false);
    assert.strictEqual(missingStatus.reason, 'repo_not_found');

    fs.mkdirSync(path.join(missing.repoRoot, 'mempalace'), { recursive: true });
    fs.writeFileSync(path.join(missing.repoRoot, 'mempalace', 'cli.py'), '# marker', 'utf8');

    const localOnlyCalls = [];
    const localOnlyAdapter = createMemoryContextAdapter({
      MEMPALACE_REPO_CANDIDATES: [missing.repoRoot],
      fs,
      getUserDataPath: () => tempRoot,
      path,
      runCommand: async (bin, args) => {
        localOnlyCalls.push({ bin, args });
        return { ok: true, stdout: 'mempalace local\n', stderr: '' };
      },
    });
    const localOnlyStatus = await localOnlyAdapter.getMempalaceRuntimeStatus({
      rootPath: path.join(tempRoot, 'Project Alpha'),
    });
    assert.strictEqual(localOnlyStatus.available, true);
    assert.strictEqual(localOnlyStatus.version, 'mempalace local');
    assert.strictEqual(localOnlyCalls.length, 1);

    const status = await missing.adapter.getMempalaceRuntimeStatus({ rootPath: path.join(tempRoot, 'Project Alpha') });
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.wing, 'project_alpha');
    assert.strictEqual(missing.calls[0].bin, 'python3');
    assert.strictEqual(missing.calls[0].options.env.MEMPALACE_PALACE_PATH, path.join(tempRoot, 'mempalace', 'palace'));

    const indexed = await missing.adapter.ensureMempalaceProjectIndexed({ rootPath: path.join(tempRoot, 'Project Alpha') });
    assert.strictEqual(indexed.ok, true);
    assert.strictEqual(indexed.wing, 'project_alpha');
    assert.ok(missing.calls.some((call) => call.args.includes('init')));
    assert.ok(missing.calls.some((call) => call.args.includes('mine')));

    const search = await missing.adapter.searchMempalaceContext('pedido', { rootPath: path.join(tempRoot, 'Project Alpha') }, 20);
    assert.strictEqual(search.ok, true);
    assert.strictEqual(search.wing, 'project_alpha');
    assert.ok(missing.calls.some((call) => call.args.includes('--results') && call.args.includes('8')));

    const planner = await missing.adapter.buildMempalacePlannerContext({ rootPath: path.join(tempRoot, 'Project Alpha') }, 'pedido');
    assert.strictEqual(planner.ok, true);
    assert.ok(planner.contextText.length <= 32);

    missing.fetchResponses.push(
      createFetchResponse({ ok: false, status: 404, body: 'missing' }),
      createFetchResponse({
        body: {
          results: [
            { text: 'conteudo útil para o plano', metadata: { path: 'src/app.js' }, score: 0.91 },
            { text: 'conteudo útil para o plano', metadata: { path: 'src/app.js' }, score: 0.91 },
          ],
        },
      })
    );
    const rag = await missing.adapter.buildRagPlannerContext(
      { rootPath: path.join(tempRoot, 'Project Alpha'), stacks: ['Node'] },
      'implementar busca',
      [{ name: 'brief.md', type: 'text/markdown' }],
      { memoryContextChars: 1200 }
    );
    assert.strictEqual(rag.ok, true);
    assert.strictEqual(rag.refsCount, 1);
    assert.strictEqual(rag.retrievalReason, 'r2r_hybrid_search_query');
    assert.strictEqual(rag.refs[0].path, 'src/app.js');
    assert.strictEqual(rag.refs[0].reason, 'r2r_hybrid_search_query');
    assert.strictEqual(missing.fetchCalls.length, 2);
    assert.strictEqual(missing.fetchCalls[0].url, 'http://r2r.test/v3/retrieval/search');
    assert.strictEqual(missing.fetchCalls[1].request.headers.Authorization, 'Bearer r2r-key');
    assert.ok(missing.fetchCalls[1].body.query.includes('Stack: Node'));

    missing.fetchResponses.push(createFetchResponse({ body: { results: [] } }));
    const ragStatus = await missing.adapter.getRagRuntimeStatus();
    assert.strictEqual(ragStatus.ready, true);
    assert.strictEqual(ragStatus.searchable, true);
    assert.strictEqual(ragStatus.reason, 'search_ready_ingest_missing');

    const core = await missing.adapter.buildMempalaceCortexCore(
      { rootPath: path.join(tempRoot, 'Project Alpha'), stacks: ['Node'] },
      'corrigir alpha',
      { memoryContextChars: 1200 }
    );
    assert.strictEqual(core.ok, true);
    assert.ok(missing.adapter.formatMempalaceCoreForPrompt(core, 500).includes('Wake-up/L1'));

    const persisted = await missing.adapter.persistCortexCheckpointToMempalace(
      { rootPath: path.join(tempRoot, 'Project Alpha') },
      { id: 'wg-1', status: 'ready', goal: 'testar', passes: [], artifacts: [], validationResults: [] },
      'ready'
    );
    assert.strictEqual(persisted.ok, true);
    assert.strictEqual(persisted.drawer.drawer_id, 'drawer-1');

    const memoryPersisted = await missing.adapter.persistCortexMemoryToMempalace(
      { rootPath: path.join(tempRoot, 'Project Alpha') },
      {
        id: 'memory-1',
        topic: 'design',
        projectName: 'Project Alpha',
        content: 'Preferir interface clara e objetiva.',
        documents: [{ name: 'guia.md', path: '/tmp/guia.md' }],
      }
    );
    assert.strictEqual(memoryPersisted.ok, true);
    assert.strictEqual(memoryPersisted.drawerId, 'drawer-1');

    const memoryForgotten = await missing.adapter.forgetMempalaceMemory({
      projectInfo: { rootPath: path.join(tempRoot, 'Project Alpha') },
      memoryId: 'memory-1',
      action: 'delete',
    });
    assert.strictEqual(memoryForgotten.ok, true);
    assert.strictEqual(memoryForgotten.drawerId, 'drawer-1');

    const ragMissingEndpoint = await missing.adapter.indexCortexMemoryInRag(
      { rootPath: path.join(tempRoot, 'Project Alpha') },
      { id: 'memory-rag-1', topic: 'codigo', content: 'Regra para RAG' }
    );
    assert.strictEqual(ragMissingEndpoint.ok, false);
    assert.strictEqual(ragMissingEndpoint.reason, 'r2r_ingest_endpoint_missing');

    const withRagIngest = createAdapter(tempRoot, { ragIngestEndpoint: '/v3/faber-cortex/documents' });
    withRagIngest.fetchResponses.push(createFetchResponse({ body: { document_id: 'doc-1' } }));
    const ragIndexed = await withRagIngest.adapter.indexCortexMemoryInRag(
      { rootPath: path.join(tempRoot, 'Project Alpha') },
      {
        id: 'memory-rag-2',
        topic: 'deploy',
        projectId: 'project-1',
        userId: 'user-1',
        conversationId: 'conversation-1',
        jobId: 'job-1',
        expiresAt: '2026-05-26T13:00:00.000Z',
        content: 'Deploy deve considerar Vercel.',
        documents: [{ name: 'deploy.md', path: '/tmp/deploy.md' }],
      }
    );
    assert.strictEqual(ragIndexed.ok, true);
    assert.strictEqual(ragIndexed.documentId, 'doc-1');
    assert.strictEqual(withRagIngest.fetchCalls[0].url, 'http://r2r.test/v3/faber-cortex/documents');
    assert.strictEqual(withRagIngest.fetchCalls[0].body.metadata.topic, 'deploy');
    assert.strictEqual(withRagIngest.fetchCalls[0].body.metadata.userId, 'user-1');
    assert.strictEqual(withRagIngest.fetchCalls[0].body.metadata.conversationId, 'conversation-1');
    assert.strictEqual(withRagIngest.fetchCalls[0].body.metadata.jobId, 'job-1');
    assert.strictEqual(withRagIngest.fetchCalls[0].body.metadata.expiresAt, '2026-05-26T13:00:00.000Z');
    assert.strictEqual(withRagIngest.fetchCalls[0].request.headers.Authorization, 'Bearer r2r-key');

    const withRagLifecycle = createAdapter(tempRoot, {
      ragReindexEndpoint: '/v3/faber-cortex/reindex',
      ragDeleteEndpoint: '/v3/faber-cortex/delete',
    });
    withRagLifecycle.fetchResponses.push(
      createFetchResponse({ body: { jobId: 'reindex-1' } }),
      createFetchResponse({ body: { document_id: 'memory-rag-2' } })
    );
    const ragReindexed = await withRagLifecycle.adapter.reindexRagProject(
      { rootPath: path.join(tempRoot, 'Project Alpha') },
      { projectId: 'project-1' }
    );
    assert.strictEqual(ragReindexed.ok, true);
    assert.strictEqual(ragReindexed.jobId, 'reindex-1');
    assert.strictEqual(withRagLifecycle.fetchCalls[0].request.headers.Authorization, 'Bearer r2r-key');

    const ragForgotten = await withRagLifecycle.adapter.forgetRagMemory({
      projectInfo: { rootPath: path.join(tempRoot, 'Project Alpha') },
      projectId: 'project-1',
      memoryId: 'memory-rag-2',
      action: 'delete',
    });
    assert.strictEqual(ragForgotten.ok, true);
    assert.strictEqual(ragForgotten.documentId, 'memory-rag-2');
    assert.strictEqual(withRagLifecycle.fetchCalls[1].url, 'http://r2r.test/v3/faber-cortex/delete');
    assert.strictEqual(withRagLifecycle.fetchCalls[1].body.metadata.projectId, 'project-1');

    console.log('memory-adapter.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
