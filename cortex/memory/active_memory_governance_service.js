const path = require('path');

const ACTIVE_MEMORY_SCOPE_SCHEMA_VERSION = 'active-memory-scope-v1';
const ACTIVE_MEMORY_VALIDITY_SCHEMA_VERSION = 'active-memory-validity-v1';
const ACTIVE_MEMORY_DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

function normalizeScopeText(value = '') {
  return String(value || '').trim();
}

function normalizeScopeId(value = '') {
  return normalizeScopeText(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeRootPath(value = '') {
  const raw = normalizeScopeText(value);
  return raw ? path.resolve(raw) : '';
}

function buildActiveMemoryScope(input = {}) {
  const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : {};
  const projectRoot = normalizeRootPath(input.projectRoot || projectInfo.rootPath || projectInfo.realRootPath || '');
  const projectId = normalizeScopeText(input.projectId || projectInfo.id || projectInfo.projectId || '');
  return {
    schemaVersion: ACTIVE_MEMORY_SCOPE_SCHEMA_VERSION,
    userId: normalizeScopeText(input.userId || projectInfo.userId || ''),
    projectId,
    projectRoot,
    conversationId: normalizeScopeText(input.conversationId || ''),
    jobId: normalizeScopeText(input.jobId || ''),
    stage: normalizeScopeText(input.stage || 'runtime'),
    source: normalizeScopeText(input.source || 'faber_active_memory'),
  };
}

function parseTimeMs(value) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

function toIso(value) {
  const time = typeof value === 'number' ? value : parseTimeMs(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function resolveNowMs(now = null) {
  if (typeof now === 'function') return resolveNowMs(now());
  if (now instanceof Date) return now.getTime();
  if (Number.isFinite(Number(now))) return Number(now);
  return parseTimeMs(now) || Date.now();
}

function buildActiveMemoryValidity(input = {}) {
  const nowMs = resolveNowMs(input.now);
  const ttlMs = Math.max(60 * 1000, Math.min(24 * 60 * 60 * 1000, Number(input.ttlMs || ACTIVE_MEMORY_DEFAULT_TTL_MS)));
  const generatedAtMs = parseTimeMs(input.generatedAt) || nowMs;
  const expiresAtMs = parseTimeMs(input.expiresAt) || generatedAtMs + ttlMs;
  return {
    schemaVersion: ACTIVE_MEMORY_VALIDITY_SCHEMA_VERSION,
    generatedAt: toIso(generatedAtMs),
    expiresAt: toIso(expiresAtMs),
    ttlMs,
    expired: nowMs > expiresAtMs,
  };
}

function readActiveMemoryValidity(activeMemory = null) {
  if (!activeMemory || typeof activeMemory !== 'object') return null;
  if (activeMemory.validity && typeof activeMemory.validity === 'object') return activeMemory.validity;
  if (activeMemory.expiresAt || activeMemory.validUntil || activeMemory.generatedAt) {
    return {
      schemaVersion: ACTIVE_MEMORY_VALIDITY_SCHEMA_VERSION,
      generatedAt: normalizeScopeText(activeMemory.generatedAt),
      expiresAt: normalizeScopeText(activeMemory.expiresAt || activeMemory.validUntil),
      ttlMs: Number(activeMemory.ttlMs || 0),
      expired: false,
    };
  }
  return null;
}

function isActiveMemoryExpired(activeMemory = null, now = null) {
  const validity = readActiveMemoryValidity(activeMemory);
  if (!validity) return false;
  if (validity.expired) return true;
  const expiresAtMs = parseTimeMs(validity.expiresAt);
  if (!expiresAtMs) return false;
  return resolveNowMs(now) > expiresAtMs;
}

function compareScopeField(memoryScope = {}, requestScope = {}, field = '') {
  const memoryValue = field === 'projectRoot'
    ? normalizeRootPath(memoryScope[field])
    : normalizeScopeText(memoryScope[field]);
  const requestValue = field === 'projectRoot'
    ? normalizeRootPath(requestScope[field])
    : normalizeScopeText(requestScope[field]);
  if (!memoryValue || !requestValue) return null;
  return memoryValue === requestValue ? null : field;
}

function findActiveMemoryScopeMismatch(activeMemory = null, requestScope = {}) {
  if (!activeMemory || typeof activeMemory !== 'object') return '';
  const memoryScope = activeMemory.scope && typeof activeMemory.scope === 'object' ? activeMemory.scope : null;
  if (!memoryScope) return '';
  const fields = ['userId', 'projectId', 'projectRoot', 'conversationId', 'jobId'];
  for (const field of fields) {
    const mismatch = compareScopeField(memoryScope, requestScope, field);
    if (mismatch) return mismatch;
  }
  return '';
}

function validateActiveMemoryForRequest(activeMemory = null, requestScope = {}, options = {}) {
  if (!activeMemory || typeof activeMemory !== 'object') {
    return { ok: false, reason: 'active_memory_missing', blocking: false };
  }
  if (isActiveMemoryExpired(activeMemory, options.now)) {
    return { ok: false, reason: 'active_memory_expired', blocking: true };
  }
  const mismatch = findActiveMemoryScopeMismatch(activeMemory, requestScope);
  if (mismatch) {
    return {
      ok: false,
      reason: `active_memory_scope_mismatch_${normalizeScopeId(mismatch)}`,
      blocking: true,
      mismatch,
    };
  }
  return { ok: true, reason: 'active_memory_valid_for_request', blocking: false };
}

function compactCitationPreview(value = '', max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function buildActiveMemoryCitation(input = {}) {
  const source = normalizeScopeText(input.source || 'unknown');
  const sourceType = normalizeScopeText(input.sourceType || source);
  const sourceId = normalizeScopeText(input.sourceId || input.id || '');
  const title = normalizeScopeText(input.title || input.label || sourceId || source);
  return {
    id: normalizeScopeId(input.id || `${sourceType}:${sourceId || title}`),
    source,
    sourceType,
    sourceId,
    title,
    path: normalizeScopeText(input.path || ''),
    score: Number.isFinite(Number(input.score)) ? Number(input.score) : null,
    reason: normalizeScopeText(input.reason || 'selected_for_current_request'),
    preview: compactCitationPreview(input.preview || input.text || input.content || ''),
  };
}

function normalizeActiveMemoryCitations(citations = []) {
  const normalized = [];
  const seen = new Set();
  for (const citation of Array.isArray(citations) ? citations : []) {
    const item = buildActiveMemoryCitation(citation);
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    normalized.push(item);
  }
  return normalized;
}

module.exports = {
  ACTIVE_MEMORY_DEFAULT_TTL_MS,
  ACTIVE_MEMORY_SCOPE_SCHEMA_VERSION,
  ACTIVE_MEMORY_VALIDITY_SCHEMA_VERSION,
  buildActiveMemoryCitation,
  buildActiveMemoryScope,
  buildActiveMemoryValidity,
  findActiveMemoryScopeMismatch,
  isActiveMemoryExpired,
  normalizeActiveMemoryCitations,
  validateActiveMemoryForRequest,
};
