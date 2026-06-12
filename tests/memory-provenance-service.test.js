const assert = require('assert');

const {
  buildMemoryProvenanceReport,
  normalizeMemoryProvenanceCitations,
  rankMemoryCandidates,
  scoreMemoryCandidate,
} = require('../cortex/memory/memory_provenance_service');

function run() {
  const score = scoreMemoryCandidate(
    'landing premium tailwind',
    'Projeto usa landing premium em Next.js com Tailwind e componentes modulares.'
  );
  assert.ok(score.confidenceScore > 0.3);
  assert.ok(score.matchedTerms.includes('landing'));
  assert.ok(score.semanticSimilarity > 0);
  assert.strictEqual(score.vectorModel, 'faber-local-hash-semantic-v1');

  const ranked = rankMemoryCandidates(
    [
      { sourceType: 'project_memory', sourceId: 'a', text: 'landing premium com Tailwind' },
      { sourceType: 'project_memory', sourceId: 'a', text: 'landing premium com Tailwind' },
      { sourceType: 'user_memory', sourceId: 'b', text: 'prefere tom direto' },
    ],
    'landing premium tailwind',
    { limit: 2, minConfidence: 0.12 }
  );
  assert.strictEqual(ranked.candidates.length, 2);
  assert.strictEqual(ranked.used.length, 1);
  assert.strictEqual(ranked.blocked.length, 1);

  const citations = normalizeMemoryProvenanceCitations(
    [
      { source: 'rag', sourceType: 'rag', documentId: 'doc-1', title: 'Doc', preview: 'landing premium tailwind' },
      { source: 'rag', sourceType: 'rag', documentId: 'doc-1', title: 'Doc duplicado', preview: 'landing premium tailwind' },
      { source: 'mempalace', sourceId: 'drawer-1', title: 'Drawer', preview: 'arquitetura modular' },
    ],
    {
      query: 'landing premium tailwind',
      scope: { projectId: 'project-1' },
      validity: { expiresAt: '2099-01-01T00:00:00.000Z' },
      timestamp: '2026-05-27T12:00:00.000Z',
    }
  );
  assert.strictEqual(citations.length, 2);
  assert.ok(citations.every((citation) => citation.scope.projectId === 'project-1'));
  assert.ok(citations.every((citation) => citation.expiresAt));
  assert.ok(citations.every((citation) => citation.vectorDimensions >= 32));

  const report = buildMemoryProvenanceReport({
    query: 'landing premium tailwind',
    scope: { projectId: 'project-1' },
    validity: { expiresAt: '2099-01-01T00:00:00.000Z' },
    citations,
    candidateBuckets: { user: 1, project: 1 },
    decision: { briefingContextText: 'contexto', routeContextText: '' },
    timestamp: '2026-05-27T12:00:00.000Z',
  });
  assert.strictEqual(report.schemaVersion, 'memory-provenance-v1');
  assert.strictEqual(report.candidates.total, 2);
  assert.strictEqual(report.used.length, 2);
  assert.ok(report.confidence.average >= 0);
  assert.ok(report.confidence.semanticAverage >= 0);

  console.log('memory-provenance-service.test.js: ok');
}

run();
