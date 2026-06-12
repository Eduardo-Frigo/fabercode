const MEMORY_EMBEDDING_SCHEMA_VERSION = 'memory-embedding-v1';
const DEFAULT_VECTOR_DIMENSIONS = 128;

const SEMANTIC_ALIASES = {
  api: ['endpoint', 'integracao', 'integracao', 'request', 'http'],
  arquitetura: ['modular', 'boundary', 'servico', 'contrato', 'estrutura'],
  auditavel: ['provenance', 'ledger', 'evidencia', 'rastreavel', 'explicavel'],
  autenticado: ['privado', 'token', 'authorization', 'bearer', 'segredo'],
  briefing: ['contexto', 'pedido', 'escopo', 'requisito'],
  codigo: ['code', 'implementacao', 'arquivo', 'patch', 'modulo'],
  componente: ['ui', 'interface', 'controle', 'painel'],
  contexto: ['memoria', 'briefing', 'historico', 'frame'],
  deploy: ['publicacao', 'vercel', 'producao', 'release'],
  diagnostico: ['debug', 'observabilidade', 'status', 'evidencia'],
  documento: ['arquivo', 'pdf', 'markdown', 'referencia'],
  editar: ['alterar', 'atualizar', 'corrigir', 'patch'],
  esquecer: ['apagar', 'remover', 'deletar', 'forget', 'delete'],
  expirar: ['validade', 'ttl', 'vencimento', 'desativar'],
  indexar: ['embedding', 'vetor', 'rag', 'reindexar', 'busca'],
  memoria: ['contexto', 'cortex', 'mempalace', 'rag', 'lembranca'],
  mempalace: ['palace', 'drawer', 'wing', 'kg', 'graph'],
  promover: ['fixar', 'aprovar', 'estabilizar', 'promote'],
  rag: ['busca', 'retrieval', 'embedding', 'vetor', 'documento'],
  ranking: ['score', 'ordenacao', 'relevancia', 'similaridade'],
  semantico: ['embedding', 'vetorial', 'similaridade', 'conceito'],
  ui: ['ux', 'interface', 'painel', 'visual'],
};

function normalizeEmbeddingText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashToken(token = '') {
  let hash = 2166136261;
  const text = String(token || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function tokenizeForEmbedding(value = '') {
  const normalized = normalizeEmbeddingText(value);
  if (!normalized) return [];
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 180);
  return Array.from(new Set(tokens));
}

function stemLight(token = '') {
  return String(token || '')
    .replace(/(oes|ões|mente|acao|acao|ções|coes|s)$/u, '')
    .replace(/(ando|endo|indo)$/u, '')
    .slice(0, 24);
}

function collectCharNgrams(token = '') {
  const clean = String(token || '').replace(/_/g, '');
  if (clean.length < 5) return [];
  const grams = [];
  for (let index = 0; index <= clean.length - 3; index += 1) {
    grams.push(clean.slice(index, index + 3));
  }
  return grams.slice(0, 12);
}

function expandSemanticTokens(tokens = []) {
  const expanded = [];
  const seen = new Set();
  const add = (token, weight = 1) => {
    const normalized = normalizeEmbeddingText(token);
    if (!normalized || normalized.length < 3) return;
    const key = `${normalized}:${weight}`;
    if (seen.has(key)) return;
    seen.add(key);
    expanded.push({ token: normalized, weight });
  };

  tokens.forEach((token) => {
    const base = normalizeEmbeddingText(token);
    if (!base) return;
    add(base, 1);
    const stem = stemLight(base);
    if (stem && stem !== base && stem.length >= 3) add(stem, 0.72);
    collectCharNgrams(base).forEach((gram) => add(`char:${gram}`, 0.28));
    const aliases = SEMANTIC_ALIASES[base] || SEMANTIC_ALIASES[stem] || [];
    aliases.forEach((alias) => add(alias, 0.62));
  });

  return expanded;
}

function createMemoryEmbedding(value = '', options = {}) {
  const dimensions = Math.max(32, Math.min(512, Number(options.dimensions || DEFAULT_VECTOR_DIMENSIONS)));
  const vector = Array(dimensions).fill(0);
  const semanticTokens = expandSemanticTokens(tokenizeForEmbedding(value));

  semanticTokens.forEach(({ token, weight }) => {
    const hash = hashToken(token);
    const index = hash % dimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign * weight;
  });

  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  const normalized = magnitude > 0
    ? vector.map((item) => Number((item / magnitude).toFixed(6)))
    : vector;

  return {
    schemaVersion: MEMORY_EMBEDDING_SCHEMA_VERSION,
    model: 'faber-local-hash-semantic-v1',
    dimensions,
    tokens: semanticTokens.map((item) => item.token).slice(0, 120),
    vector: normalized,
  };
}

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) return 0;
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  for (let index = 0; index < length; index += 1) {
    const a = Number(left[index] || 0);
    const b = Number(right[index] || 0);
    dot += a * b;
    leftMag += a * a;
    rightMag += b * b;
  }
  if (!leftMag || !rightMag) return 0;
  const raw = dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag));
  return Number(Math.max(0, Math.min(1, raw)).toFixed(4));
}

function compareMemorySemantics(query = '', text = '', options = {}) {
  const queryEmbedding =
    options.queryEmbedding && Array.isArray(options.queryEmbedding.vector)
      ? options.queryEmbedding
      : createMemoryEmbedding(query, options);
  const textEmbedding =
    options.textEmbedding && Array.isArray(options.textEmbedding.vector)
      ? options.textEmbedding
      : createMemoryEmbedding(text, options);
  const similarity = cosineSimilarity(queryEmbedding.vector, textEmbedding.vector);
  const queryTokens = new Set(queryEmbedding.tokens || []);
  const matchedConcepts = (textEmbedding.tokens || []).filter((token) => queryTokens.has(token)).slice(0, 24);

  return {
    schemaVersion: MEMORY_EMBEDDING_SCHEMA_VERSION,
    model: queryEmbedding.model || 'faber-local-hash-semantic-v1',
    dimensions: queryEmbedding.dimensions || DEFAULT_VECTOR_DIMENSIONS,
    similarity,
    confidenceScore: similarity,
    matchedConcepts,
  };
}

module.exports = {
  DEFAULT_VECTOR_DIMENSIONS,
  MEMORY_EMBEDDING_SCHEMA_VERSION,
  compareMemorySemantics,
  cosineSimilarity,
  createMemoryEmbedding,
  expandSemanticTokens,
  normalizeEmbeddingText,
  tokenizeForEmbedding,
};
