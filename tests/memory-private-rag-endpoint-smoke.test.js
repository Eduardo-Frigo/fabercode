const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const path = require('path');

const {
  createMemoryContextAdapter,
} = require('../cortex/memory/context_adapter');

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function createPrivateRagServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const body = await readJson(req);
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    if (req.headers.authorization !== 'Bearer private-rag-token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (req.url === '/v3/retrieval/search') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        results: [
          {
            text: 'Memória privada autenticada sobre ranking vetorial e provenance.',
            metadata: { path: 'private/context.md', documentId: 'private-doc-1' },
            score: 0.97,
          },
        ],
      }));
      return;
    }
    if (req.url === '/v3/faber-cortex/documents') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ document_id: body.id || 'memory-private-1' }));
      return;
    }
    if (req.url === '/v3/faber-cortex/reindex') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobId: 'private-reindex-1' }));
      return;
    }
    if (req.url === '/v3/faber-cortex/delete') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ document_id: body.document_id || body.id }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  return { server, requests };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function run() {
  const { server, requests } = createPrivateRagServer();
  const port = await listen(server);
  try {
    const adapter = createMemoryContextAdapter({
      CORTEX_RAG_ENABLED: true,
      CORTEX_RAG_PROVIDER: 'r2r',
      R2R_API_KEY: 'private-rag-token',
      R2R_BASE_URL: `http://127.0.0.1:${port}`,
      R2R_CORTEX_INGEST_ENDPOINT: '/v3/faber-cortex/documents',
      R2R_CORTEX_REINDEX_ENDPOINT: '/v3/faber-cortex/reindex',
      R2R_CORTEX_DELETE_ENDPOINT: '/v3/faber-cortex/delete',
      R2R_SEARCH_LIMIT: 3,
      R2R_STATUS_TIMEOUT_MS: 2000,
      R2R_TIMEOUT_MS: 4000,
      crypto,
      fetchFn: fetch,
      path,
    });

    const projectInfo = { rootPath: '/tmp/Private Project', stacks: ['Node'] };
    const status = await adapter.getRagRuntimeStatus();
    assert.strictEqual(status.ready, true);
    assert.strictEqual(status.searchable, true);

    const search = await adapter.buildRagPlannerContext(projectInfo, 'ranking semantico privado', [], { memoryContextChars: 1600 });
    assert.strictEqual(search.ok, true);
    assert.strictEqual(search.refs[0].documentId, 'private-doc-1');

    const indexed = await adapter.indexCortexMemoryInRag(projectInfo, {
      id: 'memory-private-1',
      projectId: 'project-private',
      topic: 'codigo',
      content: 'Memória privada indexada com token.',
      status: 'promoted',
      promoted: true,
      lifecycleAction: 'promote',
    });
    assert.strictEqual(indexed.ok, true);

    const reindexed = await adapter.reindexRagProject(projectInfo, { projectId: 'project-private' });
    assert.strictEqual(reindexed.jobId, 'private-reindex-1');

    const forgotten = await adapter.forgetRagMemory({
      projectInfo,
      projectId: 'project-private',
      memoryId: 'memory-private-1',
      action: 'delete',
    });
    assert.strictEqual(forgotten.documentId, 'memory-private-1');
    assert.ok(requests.length >= 5);
    assert.ok(requests.every((request) => request.authorization === 'Bearer private-rag-token'));
    assert.ok(requests.some((request) => request.url === '/v3/faber-cortex/delete'));

    console.log('memory-private-rag-endpoint-smoke.test.js: ok');
  } finally {
    await close(server);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
