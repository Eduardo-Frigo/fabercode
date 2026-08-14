'use strict';

const crypto = require('crypto');
const path = require('path');

const { isPortableAbsolutePath } = require('./sandbox_backend_contract');

const GRANT_SCOPES = Object.freeze({
  ONCE: 'once',
  JOB: 'job',
  SESSION: 'session',
  PROJECT: 'project',
});

const VALID_SCOPES = new Set(Object.values(GRANT_SCOPES));
const SCOPE_PRIORITY = Object.freeze({
  [GRANT_SCOPES.ONCE]: 0,
  [GRANT_SCOPES.JOB]: 1,
  [GRANT_SCOPES.SESSION]: 2,
  [GRANT_SCOPES.PROJECT]: 3,
});

const GRANT_REASONS = Object.freeze({
  AUTHORIZED: 'grant_authorized',
  NOT_FOUND: 'grant_not_found',
  EXPIRED: 'grant_expired',
  REVOKED: 'grant_revoked',
  CONSUMED: 'grant_consumed',
  DIGEST_MISMATCH: 'grant_digest_mismatch',
  CONTEXT_MISMATCH: 'grant_context_mismatch',
});

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function defaultIdFactory() {
  return `grant_${crypto.randomUUID()}`;
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

function normalizeTtl(ttlMs, defaultTtlMs, maxTtlMs) {
  const normalized = ttlMs === undefined ? defaultTtlMs : Number(ttlMs);
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > maxTtlMs) {
    throw new TypeError(`ttlMs must be greater than zero and at most ${maxTtlMs}`);
  }
  return Math.floor(normalized);
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
  if (typeof selector === 'string') {
    return normalizeRequiredText(selector, 'selector');
  }
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

function selectorKey(selector) {
  return typeof selector === 'string' ? `string:${selector}` : `object:${JSON.stringify(selector)}`;
}

function snapshot(record) {
  const { rootKey, selectorKey: ignoredSelectorKey, ...publicRecord } = record;
  return deepFreeze(canonicalize(publicRecord));
}

function createCapabilityGrantStore(options = {}) {
  const {
    now = () => Date.now(),
    idFactory = defaultIdFactory,
    authorizeRoot,
    defaultTtlMs = 5 * 60 * 1000,
    maxTtlMs = 24 * 60 * 60 * 1000,
    maxRecords = 10_000,
    platform = process.platform,
  } = options;

  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
  if (typeof authorizeRoot !== 'function') throw new TypeError('authorizeRoot must be a function');
  normalizeTtl(defaultTtlMs, defaultTtlMs, maxTtlMs);
  if (!Number.isSafeInteger(maxRecords) || maxRecords <= 0) {
    throw new TypeError('maxRecords must be a positive safe integer');
  }

  const grants = new Map();
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
    for (const [grantId, record] of grants) {
      const isExpired = checkedAt >= record.expiresAt;
      const isTerminal = record.revokedAt !== null || record.consumedAt !== null;
      if ((!expired || !isExpired) && (!terminal || !isTerminal)) continue;
      grants.delete(grantId);
      purged += 1;
      if (isExpired) expiredCount += 1;
      else if (isTerminal) terminalCount += 1;
    }
    return Object.freeze({
      ok: true,
      purged,
      expired: expiredCount,
      terminal: terminalCount,
      remaining: grants.size,
    });
  }

  function purgeExpired() {
    return purge({ expired: true, terminal: false });
  }

  function purgeTerminal() {
    return purge({ expired: false, terminal: true });
  }

  function createGrant(input = {}) {
    if (grants.size >= maxRecords) purge();
    if (grants.size >= maxRecords) throw new Error('Capability grant store capacity exceeded');
    const createdAt = normalizeNow(now);
    const ttlMs = normalizeTtl(input.ttlMs, defaultTtlMs, maxTtlMs);
    const scope = normalizeRequiredText(input.scope || GRANT_SCOPES.ONCE, 'scope').toLowerCase();
    if (!VALID_SCOPES.has(scope)) throw new TypeError(`Unsupported grant scope: ${scope}`);

    const grantId = normalizeRequiredText(input.grantId || idFactory(), 'grantId');
    if (grants.has(grantId)) throw new Error(`Duplicate grantId: ${grantId}`);

    const projectId = normalizeRequiredText(input.projectId, 'projectId');
    const sessionId = scope === GRANT_SCOPES.PROJECT
      ? normalizeOptionalText(input.sessionId)
      : normalizeRequiredText(input.sessionId, 'sessionId');
    const jobId = scope === GRANT_SCOPES.JOB
      ? normalizeRequiredText(input.jobId, 'jobId')
      : normalizeOptionalText(input.jobId);
    const requestDigest = scope === GRANT_SCOPES.ONCE
      ? normalizeRequiredText(input.requestDigest, 'requestDigest')
      : normalizeOptionalText(input.requestDigest);
    const root = resolveRoot(projectId, input.rootPath);
    const selector = normalizeSelector(input.selector);
    const record = {
      grantId,
      projectId,
      rootPath: root.rootPath,
      realRootPath: root.realRootPath,
      rootKey: root.rootKey,
      sessionId,
      jobId,
      requestDigest,
      selector,
      selectorKey: selectorKey(selector),
      scope,
      createdAt,
      expiresAt: createdAt + ttlMs,
      consumedAt: null,
      revokedAt: null,
      revocationReason: '',
      metadata: normalizeMetadata(input.metadata),
    };
    grants.set(grantId, record);
    return snapshot(record);
  }

  function normalizeQuery(input = {}) {
    const selector = normalizeSelector(input.selector);
    const projectId = normalizeRequiredText(input.projectId, 'projectId');
    const root = resolveRoot(projectId, input.rootPath);
    return {
      grantId: input.grantId ? normalizeRequiredText(input.grantId, 'grantId') : '',
      projectId,
      rootKey: root.rootKey,
      sessionId: normalizeOptionalText(input.sessionId),
      jobId: normalizeOptionalText(input.jobId),
      requestDigest: normalizeOptionalText(input.requestDigest),
      selectorKey: selectorKey(selector),
    };
  }

  function contextMatches(record, query) {
    if (record.projectId !== query.projectId || record.rootKey !== query.rootKey) return false;
    if (record.selectorKey !== query.selectorKey) return false;
    if (record.scope === GRANT_SCOPES.PROJECT) return true;
    if (!query.sessionId || record.sessionId !== query.sessionId) return false;
    if (record.scope === GRANT_SCOPES.SESSION) return true;
    if (record.scope === GRANT_SCOPES.JOB) return Boolean(query.jobId) && record.jobId === query.jobId;
    return true;
  }

  function denied(reason, grant = null) {
    return Object.freeze({
      ok: false,
      authorized: false,
      reason,
      grant: grant ? snapshot(grant) : null,
    });
  }

  function evaluateAuthorization(input = {}, { consumeOnce = false } = {}) {
    let query;
    try {
      query = normalizeQuery(input);
    } catch {
      return denied(GRANT_REASONS.CONTEXT_MISMATCH);
    }

    let candidates;
    if (query.grantId) {
      const exact = grants.get(query.grantId);
      if (!exact) return denied(GRANT_REASONS.NOT_FOUND);
      if (!contextMatches(exact, query)) return denied(GRANT_REASONS.CONTEXT_MISMATCH);
      candidates = [exact];
    } else {
      candidates = Array.from(grants.values())
        .filter((record) => contextMatches(record, query))
        .sort((left, right) => {
          const scopeDifference = SCOPE_PRIORITY[left.scope] - SCOPE_PRIORITY[right.scope];
          return scopeDifference || left.createdAt - right.createdAt;
        });
      if (!candidates.length) return denied(GRANT_REASONS.NOT_FOUND);
    }

    const checkedAt = normalizeNow(now);
    let firstTerminalFailure = null;
    for (const record of candidates) {
      let reason = '';
      if (record.scope === GRANT_SCOPES.ONCE && record.requestDigest !== query.requestDigest) {
        reason = GRANT_REASONS.DIGEST_MISMATCH;
      } else if (record.revokedAt !== null) reason = GRANT_REASONS.REVOKED;
      else if (record.consumedAt !== null) reason = GRANT_REASONS.CONSUMED;
      else if (checkedAt >= record.expiresAt) reason = GRANT_REASONS.EXPIRED;

      if (reason) {
        if (!firstTerminalFailure) firstTerminalFailure = { reason, record };
        continue;
      }

      if (consumeOnce && record.scope === GRANT_SCOPES.ONCE) record.consumedAt = checkedAt;
      return Object.freeze({
        ok: true,
        authorized: true,
        reason: GRANT_REASONS.AUTHORIZED,
        grant: snapshot(record),
      });
    }

    return denied(firstTerminalFailure.reason, firstTerminalFailure.record);
  }

  function inspect(input = {}) {
    return evaluateAuthorization(input, { consumeOnce: false });
  }

  function consume(input = {}) {
    return evaluateAuthorization(input, { consumeOnce: true });
  }

  function revoke(grantId, options = {}) {
    const id = String(grantId || '').trim();
    const record = id ? grants.get(id) : null;
    if (!record) return Object.freeze({ ok: false, revoked: false, reason: GRANT_REASONS.NOT_FOUND, grant: null });
    if (record.revokedAt !== null) {
      return Object.freeze({ ok: false, revoked: false, reason: GRANT_REASONS.REVOKED, grant: snapshot(record) });
    }
    if (record.consumedAt !== null) {
      return Object.freeze({ ok: false, revoked: false, reason: GRANT_REASONS.CONSUMED, grant: snapshot(record) });
    }
    record.revokedAt = normalizeNow(now);
    record.revocationReason = String(options.reason || '').trim();
    return Object.freeze({ ok: true, revoked: true, reason: GRANT_REASONS.REVOKED, grant: snapshot(record) });
  }

  function revokeWhere(filters = {}, options = {}) {
    const ids = [];
    for (const record of grants.values()) {
      if (filters.projectId && record.projectId !== String(filters.projectId).trim()) continue;
      if (filters.sessionId && record.sessionId !== String(filters.sessionId).trim()) continue;
      if (filters.jobId && record.jobId !== String(filters.jobId).trim()) continue;
      if (filters.scope && record.scope !== String(filters.scope).trim().toLowerCase()) continue;
      if (record.revokedAt !== null) continue;
      const result = revoke(record.grantId, options);
      if (result.revoked) ids.push(record.grantId);
    }
    return Object.freeze({ ok: true, revoked: ids.length, grantIds: Object.freeze(ids) });
  }

  function get(grantId) {
    const record = grants.get(String(grantId || '').trim());
    return record ? snapshot(record) : null;
  }

  function list(filters = {}) {
    return Object.freeze(Array.from(grants.values())
      .filter((record) => !filters.projectId || record.projectId === String(filters.projectId).trim())
      .filter((record) => !filters.sessionId || record.sessionId === String(filters.sessionId).trim())
      .filter((record) => !filters.jobId || record.jobId === String(filters.jobId).trim())
      .map(snapshot));
  }

  function clear() {
    const cleared = grants.size;
    grants.clear();
    return Object.freeze({ ok: true, cleared });
  }

  return Object.freeze({
    authorize: inspect,
    clear,
    consume,
    createGrant,
    get,
    issue: createGrant,
    inspect,
    list,
    purge,
    purgeExpired,
    purgeTerminal,
    revoke,
    revokeWhere,
  });
}

class CapabilityGrantStore {
  constructor(options = {}) {
    const store = createCapabilityGrantStore(options);
    Object.assign(this, store);
    Object.freeze(this);
  }
}

module.exports = {
  CapabilityGrantStore,
  GRANT_REASONS,
  GRANT_SCOPES,
  createCapabilityGrantStore,
};
