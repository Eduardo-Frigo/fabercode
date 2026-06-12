const MEMORY_PROVENANCE_SCHEMA_VERSION = 'memory-provenance-v1';

const {
  compareMemorySemantics,
  createMemoryEmbedding,
} = require('./memory_embedding_service');

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipText(value = '', max = 900) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function tokenize(value = '') {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 4)
    )
  ).slice(0, 64);
}

function ngrams(tokens = [], size = 2) {
  if (!Array.isArray(tokens) || tokens.length < size) return [];
  const out = [];
  for (let index = 0; index <= tokens.length - size; index += 1) {
    out.push(tokens.slice(index, index + size).join(' '));
  }
  return out;
}

function scoreMemoryCandidate(query = '', text = '', options = {}) {
  const queryTokens = tokenize(query);
  const textTokens = tokenize(text);
  const textSet = new Set(textTokens);
  const matchedTerms = queryTokens.filter((term) => textSet.has(term));
  const queryBigrams = ngrams(queryTokens, 2);
  const textBigramSet = new Set(ngrams(textTokens, 2));
  const matchedBigrams = queryBigrams.filter((item) => textBigramSet.has(item));
  const recencyBoost = Math.max(0, Math.min(1, Number(options.recency || 0))) * 0.08;
  const sourceBoost = String(options.sourceType || '').includes('project') ? 0.04 : 0;
  const semanticSignal =
    queryTokens.length > 0
      ? matchedTerms.length / Math.max(1, queryTokens.length)
      : 0;
  const phraseSignal =
    queryBigrams.length > 0
      ? matchedBigrams.length / Math.max(1, queryBigrams.length)
      : 0;
  const semantic = query
    ? compareMemorySemantics(query, text, {
        queryEmbedding: options.queryEmbedding,
        textEmbedding: options.textEmbedding,
      })
    : {
        similarity: 0,
        model: 'faber-local-hash-semantic-v1',
        dimensions: 128,
        matchedConcepts: [],
      };
  const promotionBoost = options.promoted ? 0.08 : 0;
  const confidenceScore = Math.max(
    0,
    Math.min(
      1,
      (semantic.similarity * 0.58) +
        (semanticSignal * 0.28) +
        (phraseSignal * 0.08) +
        recencyBoost +
        sourceBoost +
        promotionBoost
    )
  );
  const score = Number((confidenceScore * 100).toFixed(2));

  return {
    score,
    confidenceScore: Number(confidenceScore.toFixed(4)),
    matchedTerms,
    matchedPhrases: matchedBigrams,
    semanticSimilarity: Number((semantic.similarity || 0).toFixed(4)),
    matchedConcepts: semantic.matchedConcepts || [],
    vectorModel: semantic.model || 'faber-local-hash-semantic-v1',
    vectorDimensions: Number(semantic.dimensions || 128),
    rankingSignals: {
      semantic: Number((semantic.similarity || 0).toFixed(4)),
      lexical: Number(semanticSignal.toFixed(4)),
      phrase: Number(phraseSignal.toFixed(4)),
      recencyBoost: Number(recencyBoost.toFixed(4)),
      sourceBoost: Number(sourceBoost.toFixed(4)),
      promotionBoost: Number(promotionBoost.toFixed(4)),
    },
  };
}

function normalizeSourceId(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);
}

function citationKey(item = {}) {
  const sourceType = normalizeSourceId(item.sourceType || item.source || 'memory');
  const sourceId = normalizeSourceId(item.sourceId || item.documentId || item.id || '');
  const preview = normalizeText(item.preview || item.excerpt || item.text || '').slice(0, 160);
  return `${sourceType}:${sourceId || preview}`;
}

function normalizeMemoryCitation(citation = {}, context = {}) {
  const source = String(citation.source || context.source || 'memory').trim() || 'memory';
  const sourceType = String(citation.sourceType || source || 'memory').trim() || 'memory';
  const preview = clipText(
    citation.preview || citation.excerpt || citation.text || citation.contextText || '',
    900
  );
  const scoring = scoreMemoryCandidate(context.query || '', preview, {
    recency: citation.recency || context.recency || 0,
    sourceType,
  });
  const confidenceScore = Number.isFinite(Number(citation.confidenceScore))
    ? Math.max(0, Math.min(1, Number(citation.confidenceScore)))
    : scoring.confidenceScore;

  return {
    schemaVersion: MEMORY_PROVENANCE_SCHEMA_VERSION,
    source,
    sourceType,
    sourceId: String(citation.sourceId || citation.documentId || citation.id || citationKey(citation)).trim(),
    document: citation.document || citation.fileName || citation.path || null,
    title: String(citation.title || citation.document || source).trim(),
    excerpt: preview,
    preview,
    reason: String(citation.reason || context.reason || 'retrieved_for_current_request').trim(),
    score: Number.isFinite(Number(citation.score)) ? Number(citation.score) : scoring.score,
    confidenceScore: Number(confidenceScore.toFixed(4)),
    matchedTerms: Array.isArray(citation.matchedTerms) ? citation.matchedTerms : scoring.matchedTerms,
    matchedPhrases: Array.isArray(citation.matchedPhrases) ? citation.matchedPhrases : scoring.matchedPhrases,
    semanticSimilarity: Number.isFinite(Number(citation.semanticSimilarity))
      ? Math.max(0, Math.min(1, Number(citation.semanticSimilarity)))
      : scoring.semanticSimilarity,
    matchedConcepts: Array.isArray(citation.matchedConcepts) ? citation.matchedConcepts : scoring.matchedConcepts,
    vectorModel: citation.vectorModel || scoring.vectorModel,
    vectorDimensions: Number(citation.vectorDimensions || scoring.vectorDimensions || 128),
    rankingSignals: citation.rankingSignals || scoring.rankingSignals || null,
    retrievedAt: citation.retrievedAt || context.timestamp || new Date().toISOString(),
    scope: citation.scope || context.scope || null,
    validity: citation.validity || context.validity || null,
    expiresAt:
      citation.expiresAt ||
      (citation.validity && citation.validity.expiresAt) ||
      (context.validity && context.validity.expiresAt) ||
      null,
    used: citation.used !== undefined ? Boolean(citation.used) : true,
    blocked: Boolean(citation.blocked),
    blockedReason: citation.blockedReason || '',
  };
}

function normalizeMemoryProvenanceCitations(citations = [], context = {}) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(citations) ? citations : []).forEach((citation) => {
    const item = normalizeMemoryCitation(citation, context);
    const key = citationKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    normalized.push(item);
  });
  return normalized
    .sort((a, b) => {
      if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
      return String(a.title || '').localeCompare(String(b.title || ''));
    })
    .slice(0, 40);
}

function rankMemoryCandidates(candidates = [], query = '', options = {}) {
  const minConfidence = Number.isFinite(Number(options.minConfidence))
    ? Number(options.minConfidence)
    : 0.08;
  const maxUsed = Math.max(1, Number(options.limit || 8));
  const seen = new Set();
  const queryEmbedding =
    query && options.queryEmbedding && Array.isArray(options.queryEmbedding.vector)
      ? options.queryEmbedding
      : query
        ? createMemoryEmbedding(query)
        : null;
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const text = candidate && typeof candidate === 'object'
        ? candidate.text || candidate.summary || candidate.content || candidate.preview || ''
        : String(candidate || '');
      const scoring = scoreMemoryCandidate(query, text, {
        queryEmbedding,
        textEmbedding: candidate && candidate.embedding ? candidate.embedding : null,
        recency: 1 / Math.max(1, index + 1),
        sourceType: candidate && candidate.sourceType,
        promoted: Boolean(candidate && candidate.promoted),
      });
      return {
        ...(candidate && typeof candidate === 'object' ? candidate : { text }),
        text: clipText(text, 900),
        score: scoring.score,
        confidenceScore: scoring.confidenceScore,
        matchedTerms: scoring.matchedTerms,
        matchedPhrases: scoring.matchedPhrases,
        semanticSimilarity: scoring.semanticSimilarity,
        matchedConcepts: scoring.matchedConcepts,
        vectorModel: scoring.vectorModel,
        vectorDimensions: scoring.vectorDimensions,
        rankingSignals: scoring.rankingSignals,
        provenanceKey: citationKey({
          sourceType: candidate && candidate.sourceType,
          sourceId: candidate && candidate.sourceId,
          preview: text,
        }),
      };
    })
    .filter((candidate) => candidate.text)
    .filter((candidate) => {
      if (!candidate.provenanceKey || seen.has(candidate.provenanceKey)) return false;
      seen.add(candidate.provenanceKey);
      return true;
    })
    .sort((a, b) => {
      if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
      return Number(b.recency || 0) - Number(a.recency || 0);
    });

  const used = ranked
    .filter((candidate) => candidate.confidenceScore >= minConfidence || !query)
    .slice(0, maxUsed)
    .map((candidate) => ({ ...candidate, used: true, blocked: false, blockedReason: '' }));
  const usedKeys = new Set(used.map((candidate) => candidate.provenanceKey));
  const blocked = ranked
    .filter((candidate) => !usedKeys.has(candidate.provenanceKey))
    .slice(0, 30)
    .map((candidate) => ({
      ...candidate,
      used: false,
      blocked: true,
      blockedReason:
        candidate.confidenceScore < minConfidence
          ? 'below_confidence_threshold'
          : 'deduped_or_outside_limit',
    }));

  return { used, blocked, candidates: ranked };
}

async function rankMemoryCandidatesWithProvider(candidates = [], query = '', options = {}) {
  const provider = options.embeddingProvider || null;
  if (!provider || typeof provider.embedMany !== 'function') {
    return rankMemoryCandidates(candidates, query, options);
  }

  const sourceCandidates = Array.isArray(candidates) ? candidates : [];
  const texts = sourceCandidates.map((candidate) => {
    if (candidate && typeof candidate === 'object') {
      return candidate.text || candidate.summary || candidate.content || candidate.preview || '';
    }
    return String(candidate || '');
  });

  try {
    const embeddings = await provider.embedMany([query || '', ...texts]);
    const queryEmbedding = embeddings[0] || null;
    const enriched = sourceCandidates.map((candidate, index) => ({
      ...(candidate && typeof candidate === 'object' ? candidate : { text: texts[index] }),
      embedding: embeddings[index + 1] || (candidate && candidate.embedding) || null,
    }));
    return rankMemoryCandidates(enriched, query, {
      ...options,
      queryEmbedding,
    });
  } catch {
    return rankMemoryCandidates(candidates, query, options);
  }
}

function buildMemoryProvenanceReport({
  query = '',
  scope = null,
  validity = null,
  citations = [],
  candidateBuckets = {},
  sourceStatus = {},
  decision = {},
  timestamp = new Date().toISOString(),
} = {}) {
  const normalizedCitations = normalizeMemoryProvenanceCitations(citations, {
    query,
    scope,
    validity,
    timestamp,
  });
  const used = normalizedCitations.filter((citation) => !citation.blocked && citation.used !== false);
  const blocked = normalizedCitations.filter((citation) => citation.blocked || citation.used === false);
  return {
    schemaVersion: MEMORY_PROVENANCE_SCHEMA_VERSION,
    generatedAt: timestamp,
    query: clipText(query, 1200),
    scope,
    validity,
    sourceStatus,
    candidates: {
      total: normalizedCitations.length,
      user: Number(candidateBuckets.user || 0),
      project: Number(candidateBuckets.project || 0),
      external: Math.max(0, normalizedCitations.length - Number(candidateBuckets.user || 0) - Number(candidateBuckets.project || 0)),
    },
    used,
    blocked,
    confidence: {
      max: used.length ? Math.max(...used.map((item) => Number(item.confidenceScore || 0))) : 0,
      average: used.length
        ? Number((used.reduce((sum, item) => sum + Number(item.confidenceScore || 0), 0) / used.length).toFixed(4))
        : 0,
      semanticAverage: used.length
        ? Number((used.reduce((sum, item) => sum + Number(item.semanticSimilarity || 0), 0) / used.length).toFixed(4))
        : 0,
    },
    decision: {
      routeContextAvailable: Boolean(decision.routeContextText),
      briefingContextAvailable: Boolean(decision.briefingContextText),
      editContextAvailable: Boolean(decision.editContextText),
    },
  };
}

module.exports = {
  MEMORY_PROVENANCE_SCHEMA_VERSION,
  buildMemoryProvenanceReport,
  normalizeMemoryCitation,
  normalizeMemoryProvenanceCitations,
  rankMemoryCandidates,
  rankMemoryCandidatesWithProvider,
  scoreMemoryCandidate,
};
