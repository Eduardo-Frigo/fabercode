const assert = require('assert');

const {
  compareMemorySemantics,
  cosineSimilarity,
  createMemoryEmbedding,
  expandSemanticTokens,
  tokenizeForEmbedding,
} = require('../cortex/memory/memory_embedding_service');

function run() {
  const tokens = tokenizeForEmbedding('Memória semântica com RAG e MemPalace');
  assert.ok(tokens.includes('memoria'));
  assert.ok(tokens.includes('semantica'));

  const expanded = expandSemanticTokens(['memoria', 'rag']);
  assert.ok(expanded.some((item) => item.token === 'contexto'));
  assert.ok(expanded.some((item) => item.token === 'embedding'));

  const query = createMemoryEmbedding('apagar memória indexada do RAG');
  const near = createMemoryEmbedding('delete de contexto vetorial no retrieval');
  const far = createMemoryEmbedding('paleta visual da landing page');
  assert.strictEqual(query.vector.length, 128);
  assert.ok(cosineSimilarity(query.vector, near.vector) > cosineSimilarity(query.vector, far.vector));

  const semantic = compareMemorySemantics('promover memoria auditavel', 'aprovar contexto com provenance e ledger');
  assert.ok(semantic.similarity > 0);
  assert.strictEqual(semantic.model, 'faber-local-hash-semantic-v1');

  console.log('memory-embedding-service.test.js: ok');
}

run();
