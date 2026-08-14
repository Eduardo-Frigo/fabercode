'use strict';

const crypto = require('crypto');
const path = require('path');

const { isPortableAbsolutePath } = require('./sandbox_backend_contract');

const APPROVAL_DECISIONS = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
});

const APPROVAL_REASONS = Object.freeze({
  CREATED: 'approval_created',
  RESOLVED: 'approval_resolved',
  NOT_FOUND: 'approval_not_found',
  EXPIRED: 'approval_expired',
  DIGEST_MISMATCH: 'approval_digest_mismatch',
  REPLAYED: 'approval_replayed',
  CANCELLED: 'approval_cancelled',
  CONTEXT_MISMATCH: 'approval_context_mismatch',
  INVALID_DECISION: 'approval_invalid_decision',
});

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function defaultIdFactory() {
  return `approval_${crypto.randomUUID()}`;
}

function normalizeRequiredText(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${fieldName} must be a non-empty string`);
  return normalized;
}

function normalizeOptionalText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeNow(value) {
  const raw = typeof value === 'function' ? value() : value;
  const milliseconds = raw instanceof Date ? raw.getTime() : Number(raw);
  if (Number.isFinite(milliseconds)) return milliseconds;
  const parsed = Date.parse(String(raw || ''));
  if (!Number.isFinite(parsed)) throw new TypeError('now() must return a valid date or timestamp');
  return parsed;
}

function ownEnumerableDataKeys(value) {
  const arrayValue = Array.isArray(value);
  const keys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (arrayValue && key === 'length') continue;
    if (typeof key !== 'string') throw new TypeError('Values must not contain symbol keys');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Values must contain enumerable data properties only');
    }
  }
  if (ownKeys.length !== keys.length + (arrayValue ? 1 : 0)) {
    throw new TypeError('Values contain unsupported own properties');
  }
  return keys;
}

function canonicalize(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Object.is(value, -0)) throw new TypeError('Values must not contain negative zero');
    return value;
  }
  if (!value || typeof value !== 'object') throw new TypeError('Values must be JSON-compatible');
  if (ancestors.has(value)) throw new TypeError('Values must not contain cycles');
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError('Arrays must use the standard array prototype');
    }
    const keys = ownEnumerableDataKeys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError('Arrays must be dense and contain only indexed values');
    }
    const result = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      result.push(canonicalize(descriptor.value, ancestors));
    }
    ancestors.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Values must contain plain objects only');
  }
  const result = {};
  for (const key of ownEnumerableDataKeys(value).sort()) {
    if (DANGEROUS_KEYS.has(key)) throw new TypeError(`Unsafe object key: ${key}`);
    if (value[key] === undefined) throw new TypeError('Values must not contain undefined');
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: canonicalize(value[key], ancestors),
      writable: true,
    });
  }
  ancestors.delete(value);
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function normalizeSelector(selector) {
  if (typeof selector === 'string') return normalizeRequiredText(selector, 'selector');
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    throw new TypeError('selector must be a non-empty string or object');
  }
  const normalized = canonicalize(selector);
  if (!Object.keys(normalized).length) throw new TypeError('selector must not be empty');
  return deepFreeze(normalized);
}

function normalizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) return Object.freeze({});
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new TypeError('metadata must be a plain object');
  }
  return deepFreeze(canonicalize(metadata));
}

function isStrictAbsolutePath(value, platform) {
  if (platform === 'win32') {
    return isPortableAbsolutePath(value)
      && (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value));
  }
  return isPortableAbsolutePath(value) && path.posix.isAbsolute(value);
}

function normalizeDecision(decision) {
  const normalized = String(decision || '').trim().toLowerCase();
  if (normalized !== APPROVAL_DECISIONS.ALLOW && normalized !== APPROVAL_DECISIONS.DENY) {
    throw new TypeError('decision must be allow or deny');
  }
  return normalized;
}

function snapshot(record) {
  const { rootKey, ...publicRecord } = record;
  return deepFreeze(canonicalize(publicRecord));
}

function createPendingApprovalStore(options = {}) {
  const {
    now = () => Date.now(),
    idFactory = defaultIdFactory,
    authorizeRoot,
    defaultTtlMs = 2 * 60 * 1000,
    maxTtlMs = 10 * 60 * 1000,
    maxRecords = 5_000,
    platform = process.platform,
  } = options;

  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
  if (typeof authorizeRoot !== 'function') throw new TypeError('authorizeRoot must be a function');
  if (!Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0 || defaultTtlMs > maxTtlMs) {
    throw new TypeError('defaultTtlMs must be positive and no greater than maxTtlMs');
  }
  if (!Number.isSafeInteger(maxRecords) || maxRecords <= 0) {
    throw new TypeError('maxRecords must be a positive safe integer');
  }

  const approvals = new Map();
  const pathApi = platform === 'win32' ? path.win32 : path;

  function resolveRoot(projectId, rootPath) {
    const normalizedProjectId = normalizeRequiredText(projectId, 'projectId');
    const requestedRootPath = normalizeRequiredText(rootPath, 'rootPath');
    let authorization;
    try {
      authorization = authorizeRoot({ projectId: normalizedProjectId, rootPath: requestedRootPath });
    } catch (error) {
      const wrapped = new TypeError('rootPath must be an authorized project root');
      wrapped.cause = error;
      throw wrapped;
    }
    if (authorization && typeof authorization.then === 'function') {
      throw new TypeError('authorizeRoot must be synchronous');
    }
    if (!authorization
      || authorization.authorized !== true
      || (Object.hasOwn(authorization, 'ok') && authorization.ok !== true)) {
      throw new TypeError('rootPath must be an authorized project root');
    }
    if (authorization.projectId !== undefined && authorization.projectId !== normalizedProjectId) {
      throw new TypeError('authorizeRoot returned a different projectId');
    }
    const canonicalRootPath = normalizeRequiredText(
      authorization.canonicalRootPath || authorization.rootPath,
      'authorized canonical rootPath'
    );
    const realRootPath = normalizeRequiredText(authorization.realRootPath, 'authorized realRootPath');
    if (!isStrictAbsolutePath(canonicalRootPath, platform)
      || !isStrictAbsolutePath(realRootPath, platform)) {
      throw new TypeError('authorizeRoot must return absolute canonical and real root paths');
    }
    const normalizedCanonical = pathApi.normalize(canonicalRootPath);
    const normalizedReal = pathApi.normalize(realRootPath);
    return {
      rootPath: normalizedCanonical,
      realRootPath: normalizedReal,
      rootKey: platform === 'win32' ? normalizedReal.toLowerCase() : normalizedReal,
    };
  }

  function purge({ expired = true, terminal = true } = {}) {
    const checkedAt = normalizeNow(now);
    let purged = 0;
    let expiredCount = 0;
    let terminalCount = 0;
    for (const [approvalId, record] of approvals) {
      const isExpired = checkedAt >= record.expiresAt;
      const isTerminal = record.status !== 'pending';
      if ((!expired || !isExpired) && (!terminal || !isTerminal)) continue;
      approvals.delete(approvalId);
      purged += 1;
      if (isExpired) expiredCount += 1;
      else if (isTerminal) terminalCount += 1;
    }
    return Object.freeze({
      ok: true,
      purged,
      expired: expiredCount,
      terminal: terminalCount,
      remaining: approvals.size,
    });
  }

  function purgeExpired() {
    return purge({ expired: true, terminal: false });
  }

  function purgeTerminal() {
    return purge({ expired: false, terminal: true });
  }

  function normalizeTtl(ttlMs) {
    const normalized = ttlMs === undefined ? defaultTtlMs : Number(ttlMs);
    if (!Number.isFinite(normalized) || normalized <= 0 || normalized > maxTtlMs) {
      throw new TypeError(`ttlMs must be greater than zero and at most ${maxTtlMs}`);
    }
    return Math.floor(normalized);
  }

  function create(input = {}) {
    if (approvals.size >= maxRecords) purge();
    if (approvals.size >= maxRecords) throw new Error('Pending approval store capacity exceeded');
    const createdAt = normalizeNow(now);
    const ttlMs = normalizeTtl(input.ttlMs);
    const approvalId = normalizeRequiredText(input.approvalId || idFactory(), 'approvalId');
    if (approvals.has(approvalId)) throw new Error(`Duplicate approvalId: ${approvalId}`);
    const projectId = normalizeRequiredText(input.projectId, 'projectId');
    const root = resolveRoot(projectId, input.rootPath);
    const record = {
      approvalId,
      requestDigest: normalizeRequiredText(input.requestDigest, 'requestDigest'),
      projectId,
      rootPath: root.rootPath,
      realRootPath: root.realRootPath,
      rootKey: root.rootKey,
      sessionId: normalizeRequiredText(input.sessionId, 'sessionId'),
      jobId: normalizeOptionalText(input.jobId),
      selector: normalizeSelector(input.selector),
      createdAt,
      expiresAt: createdAt + ttlMs,
      status: 'pending',
      decision: null,
      resolvedAt: null,
      cancelledAt: null,
      metadata: normalizeMetadata(input.metadata),
    };
    approvals.set(approvalId, record);
    return Object.freeze({
      ok: true,
      reason: APPROVAL_REASONS.CREATED,
      approval: snapshot(record),
    });
  }

  function matchesContext(record, input = {}) {
    const projectId = normalizeOptionalText(input.projectId);
    if (record.projectId !== projectId) return false;
    if (record.sessionId !== normalizeOptionalText(input.sessionId)) return false;
    if (record.jobId && record.jobId !== normalizeOptionalText(input.jobId)) return false;
    try {
      if (record.rootKey !== resolveRoot(projectId, input.rootPath).rootKey) return false;
    } catch {
      return false;
    }
    return true;
  }

  function failed(reason, record = null) {
    return Object.freeze({
      ok: false,
      authorized: false,
      resolved: false,
      reason,
      approval: record ? snapshot(record) : null,
    });
  }

  function resolve(input = {}) {
    const approvalId = String(input.approvalId || '').trim();
    const record = approvalId ? approvals.get(approvalId) : null;
    if (!record) return failed(APPROVAL_REASONS.NOT_FOUND);
    if (record.status === 'cancelled') return failed(APPROVAL_REASONS.CANCELLED, record);
    if (record.status === 'resolved') return failed(APPROVAL_REASONS.REPLAYED, record);

    const resolvedAt = normalizeNow(now);
    if (resolvedAt >= record.expiresAt) {
      record.status = 'expired';
      return failed(APPROVAL_REASONS.EXPIRED, record);
    }
    if (record.status === 'expired') return failed(APPROVAL_REASONS.EXPIRED, record);
    if (String(input.requestDigest || '').trim() !== record.requestDigest) {
      return failed(APPROVAL_REASONS.DIGEST_MISMATCH, record);
    }
    if (!matchesContext(record, input)) return failed(APPROVAL_REASONS.CONTEXT_MISMATCH, record);

    let decision;
    try {
      decision = normalizeDecision(input.decision);
    } catch {
      return failed(APPROVAL_REASONS.INVALID_DECISION, record);
    }
    record.status = 'resolved';
    record.decision = decision;
    record.resolvedAt = resolvedAt;
    return Object.freeze({
      ok: true,
      authorized: decision === APPROVAL_DECISIONS.ALLOW,
      resolved: true,
      reason: APPROVAL_REASONS.RESOLVED,
      decision,
      approval: snapshot(record),
    });
  }

  function cancel(approvalId) {
    const record = approvals.get(String(approvalId || '').trim());
    if (!record) return failed(APPROVAL_REASONS.NOT_FOUND);
    if (record.status === 'expired') return failed(APPROVAL_REASONS.EXPIRED, record);
    if (record.status !== 'pending') {
      const reason = record.status === 'resolved' ? APPROVAL_REASONS.REPLAYED : APPROVAL_REASONS.CANCELLED;
      return failed(reason, record);
    }
    record.status = 'cancelled';
    record.cancelledAt = normalizeNow(now);
    return Object.freeze({
      ok: true,
      resolved: false,
      cancelled: true,
      reason: APPROVAL_REASONS.CANCELLED,
      approval: snapshot(record),
    });
  }

  function get(approvalId) {
    const record = approvals.get(String(approvalId || '').trim());
    return record ? snapshot(record) : null;
  }

  function list(filters = {}) {
    return Object.freeze(Array.from(approvals.values())
      .filter((record) => !filters.projectId || record.projectId === String(filters.projectId).trim())
      .filter((record) => !filters.sessionId || record.sessionId === String(filters.sessionId).trim())
      .filter((record) => !filters.jobId || record.jobId === String(filters.jobId).trim())
      .filter((record) => !filters.status || record.status === String(filters.status).trim())
      .map(snapshot));
  }

  function clear() {
    const cleared = approvals.size;
    approvals.clear();
    return Object.freeze({ ok: true, cleared });
  }

  return Object.freeze({
    cancel,
    clear,
    create,
    get,
    list,
    purge,
    purgeExpired,
    purgeTerminal,
    resolve,
  });
}

class PendingApprovalStore {
  constructor(options = {}) {
    const store = createPendingApprovalStore(options);
    Object.assign(this, store);
    Object.freeze(this);
  }
}

module.exports = {
  APPROVAL_DECISIONS,
  APPROVAL_REASONS,
  PendingApprovalStore,
  createPendingApprovalStore,
};
