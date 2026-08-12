'use strict';

const crypto = require('crypto');

const {
  CAPABILITY_DELEGATION_MODES,
  MAX_DELEGATION_TTL_MS,
  createCapabilityDelegationAllowedEffects,
  createCapabilityDelegationBinding,
  createCapabilityDelegationConstraints,
  createCapabilityDelegationPrincipal,
  immutableSnapshot,
} = require('./capability_delegation_contracts');

const TRUSTED_CONSENT_AUTHORITY_VERSION = 'trusted-consent-authority.v1';
const DEFAULT_CONSENT_HANDLE_TTL_MS = 60 * 1000;
const DEFAULT_MAX_CONSENT_HANDLE_TTL_MS = 5 * 60 * 1000;
const HARD_MAX_CONSENT_HANDLE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_CONSENT_HANDLES = 5_000;
const HANDLE_GENERATION_ATTEMPTS = 3;

const TRUSTED_CONSENT_REASONS = Object.freeze({
  CANCELED: 'trusted_consent_canceled',
  CAPACITY_EXCEEDED: 'trusted_consent_capacity_exceeded',
  HANDLE_COLLISION: 'trusted_consent_handle_collision',
  INVALID_INPUT: 'trusted_consent_invalid_input',
  ISSUED: 'trusted_consent_issued',
  NOT_FOUND: 'trusted_consent_not_found',
  REENTRANT_ISSUANCE: 'trusted_consent_reentrant_issuance',
  LIFECYCLE_INVALIDATED: 'trusted_consent_lifecycle_invalidated',
});

const ASK_EACH_CONSENT = Object.freeze({ mode: CAPABILITY_DELEGATION_MODES.ASK_EACH });
const SAFE_HANDLE_PATTERN = /^consent_[A-Za-z0-9_-]{32,128}$/;
const OPTION_KEYS = Object.freeze([
  'now',
  'handleFactory',
  'handleTtlMs',
  'maxHandleTtlMs',
  'maxRecords',
]);
const CONSENT_KEYS = Object.freeze([
  'mode',
  'principal',
  'binding',
  'allowedEffects',
  'constraints',
  'ttlMs',
]);
const CANCEL_FILTER_KEYS = Object.freeze([
  'projectId',
  'sessionId',
  'jobId',
  'kernelId',
]);

function defaultHandleFactory() {
  return `consent_${crypto.randomBytes(32).toString('base64url')}`;
}

function isPlainDataRecord(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return false;
    }
    if (descriptor.value === undefined) return false;
  }
  return true;
}

function normalizePositiveSafeInteger(value, fieldName, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${fieldName} must be a positive safe integer at most ${maximum}`);
  }
  return value;
}

function normalizeNow(now) {
  const raw = now();
  const value = raw instanceof Date ? raw.getTime() : raw;
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError('now() must return a non-negative safe-integer timestamp');
  }
  return value;
}

function normalizeHandle(value) {
  if (typeof value !== 'string' || !SAFE_HANDLE_PATTERN.test(value)) return '';
  return value;
}

function normalizeConsent(input) {
  const safeInput = immutableSnapshot(input);
  if (!isPlainDataRecord(safeInput, CONSENT_KEYS)
    || Object.keys(safeInput).length !== CONSENT_KEYS.length) {
    throw new TypeError('Native-confirmed consent must contain exactly the consent contract fields');
  }
  if (safeInput.mode !== CAPABILITY_DELEGATION_MODES.DELEGATE_TASK) {
    throw new TypeError('Native-confirmed consent may issue delegate_task authority only');
  }
  return Object.freeze({
    mode: CAPABILITY_DELEGATION_MODES.DELEGATE_TASK,
    principal: createCapabilityDelegationPrincipal(safeInput.principal),
    binding: createCapabilityDelegationBinding(safeInput.binding),
    allowedEffects: createCapabilityDelegationAllowedEffects(safeInput.allowedEffects),
    constraints: createCapabilityDelegationConstraints(safeInput.constraints),
    ttlMs: normalizePositiveSafeInteger(
      safeInput.ttlMs,
      'consent.ttlMs',
      MAX_DELEGATION_TTL_MS
    ),
  });
}

function consentKey(consent) {
  return JSON.stringify(consent);
}

function taskKey(binding) {
  return JSON.stringify([
    binding.projectId,
    binding.sessionId,
    binding.jobId,
    binding.kernelId,
  ]);
}

function normalizeCancelFilters(input) {
  const safeInput = immutableSnapshot(input);
  if (!isPlainDataRecord(safeInput, CANCEL_FILTER_KEYS)) {
    throw new TypeError('Trusted consent cancel filters must be a plain data record');
  }
  const filters = {};
  for (const field of CANCEL_FILTER_KEYS) {
    if (!Object.hasOwn(safeInput, field)) continue;
    if (typeof safeInput[field] !== 'string' || !safeInput[field].trim()) {
      throw new TypeError(`Trusted consent cancel filter ${field} must be a non-empty string`);
    }
    filters[field] = safeInput[field].trim();
  }
  if (!Object.keys(filters).length) {
    throw new TypeError('Trusted consent cancellation requires at least one binding filter');
  }
  return Object.freeze(filters);
}

function bindingMatchesFilters(binding, filters) {
  return Object.entries(filters).every(([field, value]) => binding[field] === value);
}

function unavailableEnvelope(stateField) {
  return Object.freeze({
    [stateField]: false,
    consent: ASK_EACH_CONSENT,
  });
}

function availableEnvelope(stateField, consent) {
  return Object.freeze({
    [stateField]: true,
    consent,
  });
}

function issueFailure(reason) {
  return Object.freeze({
    ok: false,
    issued: false,
    reason,
    consentHandle: null,
    expiresAt: null,
  });
}

function createTrustedConsentAuthority(options = {}) {
  if (!isPlainDataRecord(options, OPTION_KEYS)) {
    throw new TypeError('Trusted consent authority options must be a plain data record');
  }
  const now = Object.hasOwn(options, 'now') ? options.now : () => Date.now();
  const handleFactory = Object.hasOwn(options, 'handleFactory')
    ? options.handleFactory
    : defaultHandleFactory;
  const maxHandleTtlMs = Object.hasOwn(options, 'maxHandleTtlMs')
    ? options.maxHandleTtlMs
    : DEFAULT_MAX_CONSENT_HANDLE_TTL_MS;
  const handleTtlMs = Object.hasOwn(options, 'handleTtlMs')
    ? options.handleTtlMs
    : DEFAULT_CONSENT_HANDLE_TTL_MS;
  const maxRecords = Object.hasOwn(options, 'maxRecords')
    ? options.maxRecords
    : DEFAULT_MAX_CONSENT_HANDLES;

  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof handleFactory !== 'function') throw new TypeError('handleFactory must be a function');
  normalizePositiveSafeInteger(
    maxHandleTtlMs,
    'maxHandleTtlMs',
    HARD_MAX_CONSENT_HANDLE_TTL_MS
  );
  normalizePositiveSafeInteger(handleTtlMs, 'handleTtlMs', maxHandleTtlMs);
  normalizePositiveSafeInteger(maxRecords, 'maxRecords');

  const records = new Map();
  const pendingByTask = new Map();
  let activeIssuance = null;
  let lastObservedAt = -1;
  let clockHealthy = true;

  function poisonClock() {
    clockHealthy = false;
    if (activeIssuance) activeIssuance.invalidated = true;
    records.clear();
    pendingByTask.clear();
  }

  function readNow() {
    if (!clockHealthy) throw new TypeError('now() is not trustworthy');
    let observedAt;
    try {
      observedAt = normalizeNow(now);
    } catch (error) {
      poisonClock();
      throw error;
    }
    if (!clockHealthy) throw new TypeError('now() is not trustworthy');
    if (observedAt < lastObservedAt) {
      poisonClock();
      throw new TypeError('now() must not move backwards');
    }
    lastObservedAt = observedAt;
    return observedAt;
  }

  function deleteRecord(handle, expectedRecord = null) {
    const record = records.get(handle);
    if (!record || (expectedRecord && record !== expectedRecord)) return false;
    records.delete(handle);
    if (pendingByTask.get(record.taskKey) === handle) pendingByTask.delete(record.taskKey);
    return true;
  }

  function purgeExpiredAt(checkedAt) {
    let purged = 0;
    for (const [handle, record] of records) {
      if (checkedAt < record.expiresAt) continue;
      if (deleteRecord(handle, record)) purged += 1;
    }
    return purged;
  }

  function currentRecord(consentHandle, expectedConsent) {
    const handle = normalizeHandle(consentHandle);
    if (!handle) return null;
    const record = records.get(handle);
    if (!record) return null;
    let checkedAt;
    try {
      checkedAt = readNow();
    } catch {
      return null;
    }
    // Every injected callback is a reentrancy boundary. A nested cancellation,
    // clear or consumption must make the outer lookup fail closed.
    if (records.get(handle) !== record) return null;
    if (checkedAt >= record.expiresAt) {
      deleteRecord(handle, record);
      return null;
    }
    if (expectedConsent !== undefined) {
      let normalizedExpected;
      try {
        normalizedExpected = normalizeConsent(expectedConsent);
      } catch {
        return null;
      }
      if (records.get(handle) !== record) return null;
      if (consentKey(normalizedExpected) !== record.consentKey) return null;
    }
    return Object.freeze({ handle, record });
  }

  // This is deliberately a main-process trust-boundary entrypoint. It accepts
  // neither a renderer-controlled `confirmed` boolean nor a portable proof.
  // The future native-dialog adapter must call it only after the dialog has
  // returned an affirmative result in the same main-process control flow.
  function issueFromNativeConfirmation(input) {
    if (activeIssuance) return issueFailure(TRUSTED_CONSENT_REASONS.REENTRANT_ISSUANCE);
    const issuance = { binding: null, invalidated: false, taskKey: '' };
    activeIssuance = issuance;
    try {
      let consent;
      let issuedAt;
      try {
        consent = normalizeConsent(input);
        issuance.binding = consent.binding;
        issuance.taskKey = taskKey(consent.binding);
        issuedAt = readNow();
      } catch {
        return issueFailure(TRUSTED_CONSENT_REASONS.INVALID_INPUT);
      }
      if (issuance.invalidated) {
        return issueFailure(TRUSTED_CONSENT_REASONS.LIFECYCLE_INVALIDATED);
      }
      purgeExpiredAt(issuedAt);

      // There can be only one unconsumed native confirmation per task. A new
      // deliberate confirmation replaces the older handle, so stale control
      // flow cannot resurrect authority after the task is revoked.
      const previousHandle = pendingByTask.get(issuance.taskKey);
      if (previousHandle) deleteRecord(previousHandle);
      if (records.size >= maxRecords) {
        return issueFailure(TRUSTED_CONSENT_REASONS.CAPACITY_EXCEEDED);
      }

      let consentHandle = '';
      for (let attempt = 0; attempt < HANDLE_GENERATION_ATTEMPTS; attempt += 1) {
        let candidate;
        try {
          candidate = normalizeHandle(handleFactory());
        } catch {
          candidate = '';
        }
        if (issuance.invalidated) {
          return issueFailure(TRUSTED_CONSENT_REASONS.LIFECYCLE_INVALIDATED);
        }
        if (!candidate) return issueFailure(TRUSTED_CONSENT_REASONS.INVALID_INPUT);
        if (!records.has(candidate)) {
          consentHandle = candidate;
          break;
        }
      }
      if (!consentHandle) return issueFailure(TRUSTED_CONSENT_REASONS.HANDLE_COLLISION);
      if (issuedAt > Number.MAX_SAFE_INTEGER - handleTtlMs) {
        return issueFailure(TRUSTED_CONSENT_REASONS.INVALID_INPUT);
      }
      if (issuance.invalidated) {
        return issueFailure(TRUSTED_CONSENT_REASONS.LIFECYCLE_INVALIDATED);
      }
      const expiresAt = issuedAt + handleTtlMs;
      records.set(consentHandle, Object.freeze({
        consent,
        consentKey: consentKey(consent),
        expiresAt,
        taskKey: issuance.taskKey,
      }));
      pendingByTask.set(issuance.taskKey, consentHandle);
      return Object.freeze({
        ok: true,
        issued: true,
        reason: TRUSTED_CONSENT_REASONS.ISSUED,
        consentHandle,
        expiresAt,
      });
    } finally {
      activeIssuance = null;
    }
  }

  function inspect(consentHandle, expectedConsent) {
    const current = currentRecord(consentHandle, expectedConsent);
    if (!current) return unavailableEnvelope('available');
    return availableEnvelope('available', current.record.consent);
  }

  function consume(consentHandle, expectedConsent) {
    const current = currentRecord(consentHandle, expectedConsent);
    if (!current) return unavailableEnvelope('consumed');
    // Delete before returning the authority so a reentrant or subsequent call
    // cannot observe the handle as live.
    deleteRecord(current.handle, current.record);
    return availableEnvelope('consumed', current.record.consent);
  }

  function cancel(consentHandle) {
    const handle = normalizeHandle(consentHandle);
    if (!handle || !records.has(handle)) {
      return Object.freeze({
        ok: false,
        canceled: false,
        reason: TRUSTED_CONSENT_REASONS.NOT_FOUND,
      });
    }
    // Cancellation is a revocation path and must not depend on a healthy clock.
    // If the handle exists, remove it even when now() is temporarily invalid.
    deleteRecord(handle);
    return Object.freeze({
      ok: true,
      canceled: true,
      reason: TRUSTED_CONSENT_REASONS.CANCELED,
    });
  }

  function cancelWhere(input = {}) {
    let filters;
    try {
      filters = normalizeCancelFilters(input);
    } catch {
      return Object.freeze({ ok: false, canceled: 0 });
    }
    if (activeIssuance
      && (!activeIssuance.binding
        || bindingMatchesFilters(activeIssuance.binding, filters))) {
      activeIssuance.invalidated = true;
    }
    let canceled = 0;
    for (const [handle, record] of records) {
      if (!bindingMatchesFilters(record.consent.binding, filters)) continue;
      if (deleteRecord(handle, record)) canceled += 1;
    }
    return Object.freeze({ ok: true, canceled });
  }

  // Window/app lifecycle cleanup is deliberately independent of the clock.
  // A pending native consent handle must never survive a workspace reset.
  function clear() {
    const cleared = records.size;
    if (activeIssuance) activeIssuance.invalidated = true;
    records.clear();
    pendingByTask.clear();
    return Object.freeze({ ok: true, cleared });
  }

  function purge(purgeOptions = {}) {
    if (!isPlainDataRecord(purgeOptions, []) || Object.keys(purgeOptions).length !== 0) {
      return Object.freeze({ ok: false, purged: 0, remaining: records.size });
    }
    let checkedAt;
    try {
      checkedAt = readNow();
    } catch {
      return Object.freeze({ ok: false, purged: 0, remaining: records.size });
    }
    const purged = purgeExpiredAt(checkedAt);
    return Object.freeze({ ok: true, purged, remaining: records.size });
  }

  function diagnostics() {
    return Object.freeze({
      version: TRUSTED_CONSENT_AUTHORITY_VERSION,
      records: records.size,
      pendingTasks: pendingByTask.size,
      clockHealthy,
      handleTtlMs,
      maxHandleTtlMs,
      maxRecords,
      persistence: 'process_local',
      authorityBoundary: 'main_process_only',
      consumption: 'one_shot',
      nativeConfirmationRequired: true,
    });
  }

  return Object.freeze({
    cancel,
    cancelWhere,
    clear,
    consume,
    diagnostics,
    inspect,
    issueFromNativeConfirmation,
    purge,
  });
}

class TrustedConsentAuthority {
  constructor(options = {}) {
    Object.assign(this, createTrustedConsentAuthority(options));
    Object.freeze(this);
  }
}

module.exports = {
  DEFAULT_CONSENT_HANDLE_TTL_MS,
  DEFAULT_MAX_CONSENT_HANDLE_TTL_MS,
  HARD_MAX_CONSENT_HANDLE_TTL_MS,
  TRUSTED_CONSENT_AUTHORITY_VERSION,
  TRUSTED_CONSENT_REASONS,
  TrustedConsentAuthority,
  createTrustedConsentAuthority,
};
