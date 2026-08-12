'use strict';

const crypto = require('crypto');

const {
  areEquivalentPortablePaths,
  isPortableAbsolutePath,
} = require('./sandbox_backend_contract');
const {
  CAPABILITY_DELEGATION_EFFECTS,
  CAPABILITY_DELEGATION_MODES,
  CAPABILITY_DELEGATION_STATUSES,
  DEFAULT_DELEGATION_TTL_MS,
  MAX_DELEGATION_TTL_MS,
  createCapabilityDelegationAllowedEffects,
  createCapabilityDelegationAuditSummary,
  createCapabilityDelegationBinding,
  createCapabilityDelegationConstraints,
  createCapabilityDelegationDecisionRequest,
  createCapabilityDelegationPrincipal,
  createTaskDelegationDecisionRecord,
  createTaskDelegationRecord,
  immutableSnapshot,
  normalizeReasonCode,
} = require('./capability_delegation_contracts');

const TASK_DELEGATION_STORE_VERSION = 'task-delegation-store.v1';
const DEFAULT_MAX_IN_FLIGHT_ISSUANCES = 64;
const MAX_IN_FLIGHT_ISSUANCES = 1_024;

const TASK_DELEGATION_REASONS = Object.freeze({
  ASK_EACH_SELECTED: 'ask_each_selected',
  AUTHORIZED: 'delegation_authorized',
  CAPACITY_EXCEEDED: 'delegation_capacity_exceeded',
  CHECKPOINT_REQUIRED: 'delegation_checkpoint_required',
  CONSENT_INVALID: 'delegation_consent_invalid',
  CONTEXT_MISMATCH: 'delegation_context_mismatch',
  DECISION_REPLAYED: 'delegation_decision_replayed',
  EFFECT_NOT_ALLOWED: 'delegation_effect_not_allowed',
  EXPIRED: 'delegation_expired',
  INVALID_REQUEST: 'delegation_invalid_request',
  ISSUED: 'delegation_issued',
  LIFECYCLE_INVALIDATED: 'delegation_lifecycle_invalidated',
  NOT_FOUND: 'delegation_not_found',
  PER_DECISION_BUDGET_EXCEEDED: 'delegation_per_decision_budget_exceeded',
  REVOKED: 'delegation_revoked',
  TASK_ALREADY_DELEGATED: 'task_already_delegated',
  TASK_BUDGET_EXCEEDED: 'delegation_task_budget_exceeded',
});

function defaultDelegationIdFactory() {
  return `delegation_${crypto.randomUUID()}`;
}

function defaultDecisionIdFactory() {
  return `delegated-decision_${crypto.randomUUID()}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNow(value) {
  const raw = typeof value === 'function' ? value() : value;
  const milliseconds = raw instanceof Date ? raw.getTime() : Number(raw);
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || Object.is(milliseconds, -0)) {
    throw new TypeError('now() must return a non-negative finite timestamp');
  }
  return milliseconds;
}

function normalizePositiveSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function normalizeRequiredText(value, fieldName) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a non-empty string`);
  const normalized = value.trim();
  if (!normalized || normalized.includes('\0')) throw new TypeError(`${fieldName} must be a non-empty string`);
  return normalized;
}

function hasExactKeys(value, allowedKeys) {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
    if (!allowedKeys.includes(key) || value[key] === undefined) return false;
  }
  return true;
}

function mutableRecordFromSnapshot(snapshot) {
  return {
    delegationId: snapshot.delegationId,
    principal: snapshot.principal,
    binding: snapshot.binding,
    allowedEffects: snapshot.allowedEffects,
    constraints: snapshot.constraints,
    issuedAt: snapshot.issuedAt,
    expiresAt: snapshot.expiresAt,
    status: snapshot.status,
    revokedAt: snapshot.revokedAt,
    revocationReason: snapshot.revocationReason,
    consumedFiles: snapshot.consumedFiles,
    consumedBytes: snapshot.consumedBytes,
    consumedDirectories: snapshot.consumedDirectories,
    decisionCount: snapshot.decisionCount,
    decisionKeys: new Set(),
  };
}

function snapshotDelegation(record) {
  return createTaskDelegationRecord({
    delegationId: record.delegationId,
    principal: record.principal,
    binding: record.binding,
    allowedEffects: record.allowedEffects,
    constraints: record.constraints,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    status: record.status,
    revokedAt: record.revokedAt,
    revocationReason: record.revocationReason,
    consumedFiles: record.consumedFiles,
    consumedBytes: record.consumedBytes,
    consumedDirectories: record.consumedDirectories,
    decisionCount: record.decisionCount,
  });
}

function taskKey(binding) {
  return [
    binding.projectId,
    binding.sessionId,
    binding.jobId,
    binding.kernelId,
  ].join('\u001f');
}

function decisionKey(request) {
  return [request.effect, request.requestDigest].join('\u001f');
}

function createTaskDelegationStore(options = {}) {
  const {
    now = () => Date.now(),
    delegationIdFactory = defaultDelegationIdFactory,
    decisionIdFactory = defaultDecisionIdFactory,
    consentAuthority,
    authorizeRoot,
    authorizeLifecycle,
    defaultTtlMs = DEFAULT_DELEGATION_TTL_MS,
    maxTtlMs = MAX_DELEGATION_TTL_MS,
    maxRecords = 5_000,
    maxDecisionRecords = 50_000,
    maxInFlightIssuances = DEFAULT_MAX_IN_FLIGHT_ISSUANCES,
  } = options;

  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof delegationIdFactory !== 'function') throw new TypeError('delegationIdFactory must be a function');
  if (typeof decisionIdFactory !== 'function') throw new TypeError('decisionIdFactory must be a function');
  if (!consentAuthority
    || typeof consentAuthority.inspect !== 'function'
    || typeof consentAuthority.consume !== 'function'
    || typeof consentAuthority.cancel !== 'function'
    || typeof consentAuthority.cancelWhere !== 'function'
    || typeof consentAuthority.clear !== 'function') {
    throw new TypeError(
      'consentAuthority.inspect, consume, cancel, cancelWhere and clear must be functions'
    );
  }
  if (typeof authorizeRoot !== 'function') throw new TypeError('authorizeRoot must be a function');
  if (typeof authorizeLifecycle !== 'function') {
    throw new TypeError('authorizeLifecycle must be a function');
  }
  normalizePositiveSafeInteger(defaultTtlMs, 'defaultTtlMs');
  normalizePositiveSafeInteger(maxTtlMs, 'maxTtlMs');
  if (defaultTtlMs > maxTtlMs || maxTtlMs > MAX_DELEGATION_TTL_MS) {
    throw new TypeError(`TTL must not exceed ${MAX_DELEGATION_TTL_MS}ms`);
  }
  normalizePositiveSafeInteger(maxRecords, 'maxRecords');
  normalizePositiveSafeInteger(maxDecisionRecords, 'maxDecisionRecords');
  normalizePositiveSafeInteger(maxInFlightIssuances, 'maxInFlightIssuances');
  if (maxInFlightIssuances > MAX_IN_FLIGHT_ISSUANCES) {
    throw new TypeError(`maxInFlightIssuances must not exceed ${MAX_IN_FLIGHT_ISSUANCES}`);
  }

  const delegations = new Map();
  const activeByTask = new Map();
  const decisions = new Map();
  const inFlightIssuances = new Map();
  let decisionMutationActive = false;
  let consentAuthorityHealthy = true;

  function resolveRoot(binding) {
    let authorization;
    try {
      authorization = authorizeRoot({
        projectId: binding.projectId,
        rootPath: binding.canonicalRootPath,
      });
    } catch {
      return null;
    }
    if (authorization && typeof authorization.then === 'function') return null;
    let safeAuthorization;
    try {
      safeAuthorization = immutableSnapshot(authorization);
    } catch {
      return null;
    }
    if (!isRecord(safeAuthorization)
      || (safeAuthorization.authorized !== true && safeAuthorization.ok !== true)) return null;
    if (safeAuthorization.projectId !== undefined
      && safeAuthorization.projectId !== binding.projectId) return null;
    const canonicalRootPath = String(
      safeAuthorization.canonicalRootPath || safeAuthorization.rootPath || ''
    ).trim();
    const realRootPath = String(safeAuthorization.realRootPath || '').trim();
    if (!isPortableAbsolutePath(canonicalRootPath) || !isPortableAbsolutePath(realRootPath)) return null;
    if (!areEquivalentPortablePaths(canonicalRootPath, binding.canonicalRootPath)
      || !areEquivalentPortablePaths(realRootPath, binding.realRootPath)) return null;
    return Object.freeze({ canonicalRootPath, realRootPath });
  }

  function resolveLifecycle(binding) {
    let authorization;
    try {
      authorization = authorizeLifecycle(binding);
    } catch {
      return false;
    }
    if (authorization && typeof authorization.then === 'function') return false;
    let safeAuthorization;
    try {
      safeAuthorization = immutableSnapshot(authorization);
    } catch {
      return false;
    }
    if (!isRecord(safeAuthorization)
      || safeAuthorization.authorized !== true
      || !Object.hasOwn(safeAuthorization, 'binding')) return false;
    let authorizedBinding;
    try {
      authorizedBinding = createCapabilityDelegationBinding(safeAuthorization.binding);
    } catch {
      return false;
    }
    return bindingsMatch(authorizedBinding, binding);
  }

  function registerInFlightIssuance() {
    if (inFlightIssuances.size >= maxInFlightIssuances) return null;
    const token = Object.freeze({});
    const flight = { binding: null, invalidated: false };
    inFlightIssuances.set(token, flight);
    return Object.freeze({ token, flight });
  }

  function bindInFlightIssuance(registration, binding) {
    if (inFlightIssuances.get(registration.token) !== registration.flight) return false;
    registration.flight.binding = binding;
    return !registration.flight.invalidated;
  }

  function releaseInFlightIssuance(registration) {
    if (registration) inFlightIssuances.delete(registration.token);
  }

  function issuanceIsCurrent(registration) {
    return Boolean(registration
      && inFlightIssuances.get(registration.token) === registration.flight
      && !registration.flight.invalidated);
  }

  function issuanceLifecycleAuthorized(registration) {
    if (!registration
      || inFlightIssuances.get(registration.token) !== registration.flight
      || registration.flight.invalidated
      || !registration.flight.binding) return false;
    const authorized = resolveLifecycle(registration.flight.binding);
    return authorized
      && inFlightIssuances.get(registration.token) === registration.flight
      && !registration.flight.invalidated;
  }

  function invalidateInFlightWhere(predicate) {
    let invalidated = 0;
    for (const flight of inFlightIssuances.values()) {
      if (flight.invalidated || !predicate(flight.binding)) continue;
      flight.invalidated = true;
      invalidated += 1;
    }
    return invalidated;
  }

  function invokeConsentAuthorityMutation(methodName, input) {
    const method = consentAuthority[methodName];
    let result;
    try {
      result = input === undefined
        ? method.call(consentAuthority)
        : method.call(consentAuthority, input);
      if (result && typeof result.then === 'function') throw new TypeError('async mutation is not allowed');
      const safeResult = immutableSnapshot(result);
      if (!isRecord(safeResult) || safeResult.ok !== true) {
        throw new TypeError('invalid consent authority mutation result');
      }
    } catch {
      consentAuthorityHealthy = false;
      return Object.freeze({ ok: false, supported: true });
    }
    return Object.freeze({ ok: true, supported: true });
  }

  function markExpired(record, checkedAt) {
    if (record.status === CAPABILITY_DELEGATION_STATUSES.ACTIVE
      && checkedAt >= record.expiresAt) {
      record.status = CAPABILITY_DELEGATION_STATUSES.EXPIRED;
      activeByTask.delete(taskKey(record.binding));
      record.decisionKeys.clear();
      removeDecisionRecordsFor(record.delegationId);
    }
  }

  function removeDecisionRecordsFor(delegationId) {
    for (const [decisionId, decision] of decisions) {
      if (decision.delegationId === delegationId) decisions.delete(decisionId);
    }
  }

  function purge(options = {}) {
    if (!hasExactKeys(options, ['expired', 'terminal'])) {
      return Object.freeze({
        ok: false,
        purged: 0,
        remaining: delegations.size,
        decisionRecords: decisions.size,
      });
    }
    const expired = options.expired === undefined ? true : options.expired;
    const terminal = options.terminal === undefined ? true : options.terminal;
    if (typeof expired !== 'boolean' || typeof terminal !== 'boolean') {
      return Object.freeze({
        ok: false,
        purged: 0,
        remaining: delegations.size,
        decisionRecords: decisions.size,
      });
    }
    const checkedAt = normalizeNow(now);
    let purged = 0;
    for (const [delegationId, record] of delegations) {
      markExpired(record, checkedAt);
      const isExpired = record.status === CAPABILITY_DELEGATION_STATUSES.EXPIRED;
      const isTerminal = record.status === CAPABILITY_DELEGATION_STATUSES.REVOKED;
      if ((!expired || !isExpired) && (!terminal || !isTerminal)) continue;
      delegations.delete(delegationId);
      activeByTask.delete(taskKey(record.binding));
      removeDecisionRecordsFor(delegationId);
      purged += 1;
    }
    return Object.freeze({
      ok: true,
      purged,
      remaining: delegations.size,
      decisionRecords: decisions.size,
    });
  }

  function hasDelegationCapacity() {
    if (delegations.size < maxRecords) return true;
    purge();
    return delegations.size < maxRecords;
  }

  function normalizeTtl(ttlMs) {
    const normalized = ttlMs === undefined ? defaultTtlMs : ttlMs;
    if (!Number.isSafeInteger(normalized)
      || normalized <= 0
      || normalized > maxTtlMs
      || normalized > MAX_DELEGATION_TTL_MS) {
      throw new TypeError(`Delegation ttlMs must be positive and at most ${maxTtlMs}`);
    }
    return normalized;
  }

  function normalizeConsent(consent) {
    const consentKeys = ['mode', 'principal', 'binding', 'allowedEffects', 'constraints', 'ttlMs'];
    if (!hasExactKeys(consent, consentKeys)) {
      throw new TypeError('Trusted consent must be a plain data record');
    }
    if (consent.mode === CAPABILITY_DELEGATION_MODES.ASK_EACH) {
      if (Object.keys(consent).length !== 1) {
        throw new TypeError('ask_each consent must not carry delegation authority');
      }
      return Object.freeze({ mode: CAPABILITY_DELEGATION_MODES.ASK_EACH });
    }
    if (consent.mode !== CAPABILITY_DELEGATION_MODES.DELEGATE_TASK) {
      throw new TypeError('Unsupported delegation consent mode');
    }
    for (const field of ['principal', 'binding', 'allowedEffects', 'constraints']) {
      if (!Object.hasOwn(consent, field)) throw new TypeError(`Trusted consent is missing ${field}`);
    }
    return Object.freeze({
      mode: CAPABILITY_DELEGATION_MODES.DELEGATE_TASK,
      principal: createCapabilityDelegationPrincipal(consent.principal),
      binding: createCapabilityDelegationBinding(consent.binding),
      allowedEffects: createCapabilityDelegationAllowedEffects(consent.allowedEffects),
      constraints: createCapabilityDelegationConstraints(consent.constraints),
      ttlMs: normalizeTtl(consent.ttlMs),
    });
  }

  function normalizeConsentEnvelope(envelope, stateField) {
    const safeEnvelope = immutableSnapshot(envelope);
    if (!hasExactKeys(safeEnvelope, [stateField, 'consent'])
      || Object.keys(safeEnvelope).length !== 2
      || safeEnvelope[stateField] !== true) {
      throw new TypeError('Trusted consent authority returned an invalid envelope');
    }
    return normalizeConsent(safeEnvelope.consent);
  }

  function issueFailure(reason) {
    return Object.freeze({
      ok: false,
      issued: false,
      reason,
      delegation: null,
      audit: createCapabilityDelegationAuditSummary('capability_delegation_not_issued', {
        status: 'denied',
        reason,
      }),
    });
  }

  async function issueFromTrustedConsent(input = {}) {
    if (!hasExactKeys(input, ['consentHandle'])
      || Object.keys(input).length !== 1
      || typeof input.consentHandle !== 'string'
      || !input.consentHandle.trim()) {
      return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
    }
    if (!consentAuthorityHealthy) {
      return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
    }
    if (!hasDelegationCapacity()) return issueFailure(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
    const registration = registerInFlightIssuance();
    if (!registration) return issueFailure(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);

    try {
      let inspectedConsent;
      try {
        const inspected = await consentAuthority.inspect(input.consentHandle);
        inspectedConsent = normalizeConsentEnvelope(inspected, 'available');
      } catch {
        return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
      }
      if (!issuanceIsCurrent(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }
      if (inspectedConsent.mode === CAPABILITY_DELEGATION_MODES.ASK_EACH) {
        return Object.freeze({
          ok: true,
          issued: false,
          reason: TASK_DELEGATION_REASONS.ASK_EACH_SELECTED,
          delegation: null,
          audit: createCapabilityDelegationAuditSummary('capability_delegation_not_issued', {
            status: 'not_issued',
            reason: TASK_DELEGATION_REASONS.ASK_EACH_SELECTED,
          }),
        });
      }
      if (!bindInFlightIssuance(registration, inspectedConsent.binding)
        || !issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }

      const inspectedRoot = resolveRoot(inspectedConsent.binding);
      if (!issuanceIsCurrent(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }
      if (!inspectedRoot) return issueFailure(TASK_DELEGATION_REASONS.CONTEXT_MISMATCH);
      if (!issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }
      if (!hasDelegationCapacity()) return issueFailure(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
      if (!issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }

      const key = taskKey(inspectedConsent.binding);
      const existingId = activeByTask.get(key);
      if (existingId) {
        const existing = delegations.get(existingId);
        if (existing) {
          let checkedAt;
          try {
            checkedAt = normalizeNow(now);
          } catch {
            return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
          }
          if (!issuanceLifecycleAuthorized(registration)) {
            return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
          }
          markExpired(existing, checkedAt);
          if (existing.status === CAPABILITY_DELEGATION_STATUSES.ACTIVE) {
            const canceledDuplicate = invokeConsentAuthorityMutation(
              'cancel',
              input.consentHandle
            );
            if (!canceledDuplicate.ok) {
              return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
            }
            return issueFailure(TASK_DELEGATION_REASONS.TASK_ALREADY_DELEGATED);
          }
        }
      }

      let consumedConsent;
      try {
        const consumed = await consentAuthority.consume(input.consentHandle);
        consumedConsent = normalizeConsentEnvelope(consumed, 'consumed');
      } catch {
        return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
      }
      if (!issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }
      if (JSON.stringify(consumedConsent) !== JSON.stringify(inspectedConsent)) {
        return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
      }

      const consumedRoot = resolveRoot(consumedConsent.binding);
      if (!issuanceIsCurrent(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }
      if (!consumedRoot) return issueFailure(TASK_DELEGATION_REASONS.CONTEXT_MISMATCH);
      if (!issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }
      if (!hasDelegationCapacity()) return issueFailure(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
      if (!issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }

      const concurrentId = activeByTask.get(key);
      if (concurrentId) {
        const concurrent = delegations.get(concurrentId);
        if (concurrent) {
          let checkedAt;
          try {
            checkedAt = normalizeNow(now);
          } catch {
            return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
          }
          if (!issuanceLifecycleAuthorized(registration)) {
            return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
          }
          markExpired(concurrent, checkedAt);
          if (concurrent.status === CAPABILITY_DELEGATION_STATUSES.ACTIVE) {
            return issueFailure(TASK_DELEGATION_REASONS.TASK_ALREADY_DELEGATED);
          }
        }
      }

      let issuedAt;
      try {
        issuedAt = normalizeNow(now);
      } catch {
        return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
      }
      if (!issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }

      let candidateDelegationId;
      try {
        candidateDelegationId = delegationIdFactory();
      } catch {
        return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
      }
      if (!issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }

      const finalRoot = resolveRoot(consumedConsent.binding);
      if (!issuanceIsCurrent(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }
      if (!finalRoot) return issueFailure(TASK_DELEGATION_REASONS.CONTEXT_MISMATCH);
      if (delegations.size >= maxRecords) {
        return issueFailure(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
      }
      const finalConcurrentId = activeByTask.get(key);
      if (finalConcurrentId) {
        const finalConcurrent = delegations.get(finalConcurrentId);
        if (finalConcurrent && finalConcurrent.status === CAPABILITY_DELEGATION_STATUSES.ACTIVE) {
          return issueFailure(TASK_DELEGATION_REASONS.TASK_ALREADY_DELEGATED);
        }
      }

      let snapshot;
      try {
        snapshot = createTaskDelegationRecord({
          delegationId: candidateDelegationId,
          principal: consumedConsent.principal,
          binding: consumedConsent.binding,
          allowedEffects: consumedConsent.allowedEffects,
          constraints: consumedConsent.constraints,
          issuedAt,
          expiresAt: issuedAt + consumedConsent.ttlMs,
          status: CAPABILITY_DELEGATION_STATUSES.ACTIVE,
          revokedAt: null,
          revocationReason: '',
          consumedFiles: 0,
          consumedBytes: 0,
          consumedDirectories: 0,
          decisionCount: 0,
        });
      } catch {
        return issueFailure(TASK_DELEGATION_REASONS.CONSENT_INVALID);
      }
      if (delegations.has(snapshot.delegationId)) {
        return issueFailure(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
      }

      // This is the final lifecycle frontier. No injected callback may run
      // after it and before publishing the delegation.
      if (!issuanceLifecycleAuthorized(registration)) {
        return issueFailure(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
      }
      if (delegations.size >= maxRecords) {
        return issueFailure(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
      }
      const publishConcurrentId = activeByTask.get(key);
      if (publishConcurrentId) {
        const publishConcurrent = delegations.get(publishConcurrentId);
        if (publishConcurrent && publishConcurrent.status === CAPABILITY_DELEGATION_STATUSES.ACTIVE) {
          return issueFailure(TASK_DELEGATION_REASONS.TASK_ALREADY_DELEGATED);
        }
      }
      const record = mutableRecordFromSnapshot(snapshot);
      delegations.set(record.delegationId, record);
      activeByTask.set(key, record.delegationId);
      return Object.freeze({
        ok: true,
        issued: true,
        reason: TASK_DELEGATION_REASONS.ISSUED,
        delegation: snapshot,
        audit: createCapabilityDelegationAuditSummary('capability_delegation_issued', {
          delegationId: record.delegationId,
          projectId: record.binding.projectId,
          sessionId: record.binding.sessionId,
          jobId: record.binding.jobId,
          kernelId: record.binding.kernelId,
          status: record.status,
          effect: CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE,
        }),
      });
    } finally {
      releaseInFlightIssuance(registration);
    }
  }

  function denied(reason, record = null) {
    return Object.freeze({
      ok: false,
      authorized: false,
      reason,
      delegation: record ? snapshotDelegation(record) : null,
      decision: null,
      audit: createCapabilityDelegationAuditSummary('capability_delegation_decision_denied', {
        ...(record ? {
          delegationId: record.delegationId,
          projectId: record.binding.projectId,
          sessionId: record.binding.sessionId,
          jobId: record.binding.jobId,
          kernelId: record.binding.kernelId,
        } : {}),
        status: 'denied',
        reason,
        effect: CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE,
      }),
    });
  }

  function bindingsMatch(left, right) {
    return left.projectId === right.projectId
      && left.sessionId === right.sessionId
      && left.jobId === right.jobId
      && left.kernelId === right.kernelId
      && left.submissionDigest === right.submissionDigest
      && areEquivalentPortablePaths(left.canonicalRootPath, right.canonicalRootPath)
      && areEquivalentPortablePaths(left.realRootPath, right.realRootPath);
  }

  function exceedsPerDecisionBudget(record, impact) {
    return impact.files > record.constraints.maxFilesPerDecision
      || impact.bytes > record.constraints.maxBytesPerDecision
      || impact.directories > record.constraints.maxDirectoriesPerDecision;
  }

  function exceedsTaskBudget(record, impact) {
    return record.consumedFiles + impact.files > record.constraints.maxFilesTotal
      || record.consumedBytes + impact.bytes > record.constraints.maxBytesTotal
      || record.consumedDirectories + impact.directories > record.constraints.maxDirectoriesTotal;
  }

  function evaluateDecision(input, { requireCheckpoint = false } = {}) {
    let request;
    try {
      request = createCapabilityDelegationDecisionRequest(input, { requireCheckpoint });
    } catch {
      return { denied: denied(
        requireCheckpoint
          ? TASK_DELEGATION_REASONS.CHECKPOINT_REQUIRED
          : TASK_DELEGATION_REASONS.INVALID_REQUEST
      ) };
    }
    const id = activeByTask.get(taskKey(request.binding));
    const record = id ? delegations.get(id) : null;
    if (!record) return { denied: denied(TASK_DELEGATION_REASONS.NOT_FOUND) };
    const checkedAt = normalizeNow(now);
    markExpired(record, checkedAt);
    if (record.status === CAPABILITY_DELEGATION_STATUSES.EXPIRED) {
      return { denied: denied(TASK_DELEGATION_REASONS.EXPIRED, record) };
    }
    if (record.status === CAPABILITY_DELEGATION_STATUSES.REVOKED) {
      return { denied: denied(TASK_DELEGATION_REASONS.REVOKED, record) };
    }
    if (!bindingsMatch(record.binding, request.binding)) {
      return { denied: denied(TASK_DELEGATION_REASONS.CONTEXT_MISMATCH, record) };
    }
    const authorizedRoot = resolveRoot(request.binding);
    markExpired(record, checkedAt);
    if (record.status === CAPABILITY_DELEGATION_STATUSES.EXPIRED) {
      return { denied: denied(TASK_DELEGATION_REASONS.EXPIRED, record) };
    }
    if (record.status === CAPABILITY_DELEGATION_STATUSES.REVOKED) {
      return { denied: denied(TASK_DELEGATION_REASONS.REVOKED, record) };
    }
    if (!authorizedRoot
      || delegations.get(record.delegationId) !== record
      || activeByTask.get(taskKey(request.binding)) !== record.delegationId
      || !bindingsMatch(record.binding, request.binding)) {
      return { denied: denied(TASK_DELEGATION_REASONS.CONTEXT_MISMATCH, record) };
    }
    if (!resolveLifecycle(request.binding)) {
      return { denied: denied(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED, record) };
    }
    if (record.status === CAPABILITY_DELEGATION_STATUSES.EXPIRED) {
      return { denied: denied(TASK_DELEGATION_REASONS.EXPIRED, record) };
    }
    if (record.status === CAPABILITY_DELEGATION_STATUSES.REVOKED) {
      return { denied: denied(TASK_DELEGATION_REASONS.REVOKED, record) };
    }
    if (delegations.get(record.delegationId) !== record
      || activeByTask.get(taskKey(request.binding)) !== record.delegationId
      || !bindingsMatch(record.binding, request.binding)) {
      return { denied: denied(TASK_DELEGATION_REASONS.CONTEXT_MISMATCH, record) };
    }
    if (!record.allowedEffects.includes(request.effect)) {
      return { denied: denied(TASK_DELEGATION_REASONS.EFFECT_NOT_ALLOWED, record) };
    }
    if (exceedsPerDecisionBudget(record, request.impact)) {
      return { denied: denied(TASK_DELEGATION_REASONS.PER_DECISION_BUDGET_EXCEEDED, record) };
    }
    if (exceedsTaskBudget(record, request.impact)) {
      return { denied: denied(TASK_DELEGATION_REASONS.TASK_BUDGET_EXCEEDED, record) };
    }
    return { request, record, checkedAt };
  }

  function inspectDecision(input = {}) {
    const evaluated = evaluateDecision(input, { requireCheckpoint: false });
    if (evaluated.denied) return evaluated.denied;
    return Object.freeze({
      ok: true,
      authorized: true,
      reason: TASK_DELEGATION_REASONS.AUTHORIZED,
      delegation: snapshotDelegation(evaluated.record),
      decision: null,
      audit: createCapabilityDelegationAuditSummary('capability_delegation_decision_inspected', {
        delegationId: evaluated.record.delegationId,
        projectId: evaluated.record.binding.projectId,
        sessionId: evaluated.record.binding.sessionId,
        jobId: evaluated.record.binding.jobId,
        kernelId: evaluated.record.binding.kernelId,
        status: 'eligible',
        effect: evaluated.request.effect,
        impact: evaluated.request.impact,
      }),
    });
  }

  // This is the final authorization frontier, not a bearer-token mint. The
  // trusted executor must call it immediately before the effect and must not
  // await or yield between an authorized result and starting that effect.
  function consumeDecision(input = {}) {
    if (decisionMutationActive) return denied(TASK_DELEGATION_REASONS.INVALID_REQUEST);
    decisionMutationActive = true;
    try {
      if (decisions.size >= maxDecisionRecords) purge();
      const evaluated = evaluateDecision(input, { requireCheckpoint: true });
      if (evaluated.denied) return evaluated.denied;
      const { request, record } = evaluated;
      const key = decisionKey(request);
      if (record.decisionKeys.has(key)) {
        return denied(TASK_DELEGATION_REASONS.DECISION_REPLAYED, record);
      }
      if (decisions.size >= maxDecisionRecords) {
        return denied(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED, record);
      }

      let candidateDecisionId;
      try {
        candidateDecisionId = decisionIdFactory();
      } catch {
        return denied(TASK_DELEGATION_REASONS.INVALID_REQUEST, record);
      }

      // All injected callbacks run before the final state validation. They may
      // re-enter other store methods, so nothing below the lifecycle check may
      // invoke external code before the decision is published.
      const finalRoot = resolveRoot(request.binding);
      const finalCheckedAt = normalizeNow(now);
      markExpired(record, finalCheckedAt);
      if (record.status === CAPABILITY_DELEGATION_STATUSES.EXPIRED) {
        return denied(TASK_DELEGATION_REASONS.EXPIRED, record);
      }
      if (record.status === CAPABILITY_DELEGATION_STATUSES.REVOKED) {
        return denied(TASK_DELEGATION_REASONS.REVOKED, record);
      }
      if (!finalRoot
        || delegations.get(record.delegationId) !== record
        || activeByTask.get(taskKey(request.binding)) !== record.delegationId
        || !bindingsMatch(record.binding, request.binding)) {
        return denied(TASK_DELEGATION_REASONS.CONTEXT_MISMATCH, record);
      }
      const finalLifecycle = resolveLifecycle(request.binding);
      if (record.status === CAPABILITY_DELEGATION_STATUSES.EXPIRED) {
        return denied(TASK_DELEGATION_REASONS.EXPIRED, record);
      }
      if (record.status === CAPABILITY_DELEGATION_STATUSES.REVOKED) {
        return denied(TASK_DELEGATION_REASONS.REVOKED, record);
      }
      if (!finalLifecycle) {
        return denied(TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED, record);
      }
      if (delegations.get(record.delegationId) !== record
        || activeByTask.get(taskKey(request.binding)) !== record.delegationId
        || !bindingsMatch(record.binding, request.binding)) {
        return denied(TASK_DELEGATION_REASONS.CONTEXT_MISMATCH, record);
      }
      if (record.decisionKeys.has(key)) {
        return denied(TASK_DELEGATION_REASONS.DECISION_REPLAYED, record);
      }
      if (decisions.size >= maxDecisionRecords) {
        return denied(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED, record);
      }
      if (exceedsPerDecisionBudget(record, request.impact)) {
        return denied(TASK_DELEGATION_REASONS.PER_DECISION_BUDGET_EXCEEDED, record);
      }
      if (exceedsTaskBudget(record, request.impact)) {
        return denied(TASK_DELEGATION_REASONS.TASK_BUDGET_EXCEEDED, record);
      }

      let decision;
      try {
        decision = createTaskDelegationDecisionRecord({
          decisionId: candidateDecisionId,
          delegationId: record.delegationId,
          requestDigest: request.requestDigest,
          impactDigest: request.impactDigest,
          checkpointDigest: request.checkpointDigest,
          impact: request.impact,
          authorizedAt: finalCheckedAt,
        });
      } catch {
        return denied(TASK_DELEGATION_REASONS.INVALID_REQUEST, record);
      }
      if (decisions.has(decision.decisionId)) {
        return denied(TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED, record);
      }

      // Replay marking, budget consumption and decision publication are one
      // synchronous, non-reentrant critical section.
      record.decisionKeys.add(key);
      record.consumedFiles += request.impact.files;
      record.consumedBytes += request.impact.bytes;
      record.consumedDirectories += request.impact.directories;
      record.decisionCount += 1;
      decisions.set(decision.decisionId, decision);

      return Object.freeze({
        ok: true,
        authorized: true,
        reason: TASK_DELEGATION_REASONS.AUTHORIZED,
        delegation: snapshotDelegation(record),
        decision,
        audit: createCapabilityDelegationAuditSummary('capability_delegation_decision_authorized', {
          delegationId: record.delegationId,
          decisionId: decision.decisionId,
          projectId: record.binding.projectId,
          sessionId: record.binding.sessionId,
          jobId: record.binding.jobId,
          kernelId: record.binding.kernelId,
          status: decision.status,
          effect: decision.effect,
          impact: decision.impact,
        }),
      });
    } finally {
      decisionMutationActive = false;
    }
  }

  function normalizeRevokeOptions(options) {
    if (!hasExactKeys(options, ['reason'])) {
      throw new TypeError('revoke options must be a plain data record');
    }
    const reason = Object.hasOwn(options, 'reason')
      ? normalizeReasonCode(options.reason, 'reason')
      : 'revoked_by_user';
    return Object.freeze({ reason });
  }

  function revoke(delegationId, options = {}) {
    const normalizedOptions = normalizeRevokeOptions(options);
    const id = typeof delegationId === 'string' ? delegationId.trim() : '';
    const record = id ? delegations.get(id) : null;
    if (!record) return denied(TASK_DELEGATION_REASONS.NOT_FOUND);
    markExpired(record, normalizeNow(now));
    if (record.status === CAPABILITY_DELEGATION_STATUSES.EXPIRED) {
      return denied(TASK_DELEGATION_REASONS.EXPIRED, record);
    }
    if (record.status === CAPABILITY_DELEGATION_STATUSES.REVOKED) {
      return denied(TASK_DELEGATION_REASONS.REVOKED, record);
    }
    const reason = normalizedOptions.reason;
    const invalidatedIssuances = invalidateInFlightWhere((flightBinding) => (
      Boolean(flightBinding) && bindingsMatch(flightBinding, record.binding)
    ));
    // Publish the terminal state before consulting the injected clock so a
    // reentrant callback cannot consume one last decision during revocation.
    record.status = CAPABILITY_DELEGATION_STATUSES.REVOKED;
    record.revokedAt = record.issuedAt;
    record.revocationReason = reason;
    activeByTask.delete(taskKey(record.binding));
    record.decisionKeys.clear();
    removeDecisionRecordsFor(record.delegationId);
    const consentMutation = invokeConsentAuthorityMutation('cancelWhere', Object.freeze({
      projectId: record.binding.projectId,
      sessionId: record.binding.sessionId,
      jobId: record.binding.jobId,
      kernelId: record.binding.kernelId,
    }));
    record.revokedAt = normalizeNow(now);
    return Object.freeze({
      ok: consentMutation.ok,
      revoked: true,
      invalidatedIssuances,
      reason: TASK_DELEGATION_REASONS.REVOKED,
      delegation: snapshotDelegation(record),
      audit: createCapabilityDelegationAuditSummary('capability_delegation_revoked', {
        delegationId: record.delegationId,
        projectId: record.binding.projectId,
        sessionId: record.binding.sessionId,
        jobId: record.binding.jobId,
        kernelId: record.binding.kernelId,
        status: record.status,
        reason: TASK_DELEGATION_REASONS.REVOKED,
      }),
    });
  }

  function revokeBinding(candidateBinding, options = {}) {
    const normalizedOptions = normalizeRevokeOptions(options);
    let normalizedBinding;
    try {
      normalizedBinding = createCapabilityDelegationBinding(candidateBinding);
    } catch {
      return Object.freeze({
        ok: false,
        revoked: 0,
        invalidatedIssuances: 0,
        delegationIds: Object.freeze([]),
      });
    }
    const invalidatedIssuances = invalidateInFlightWhere((flightBinding) => (
      Boolean(flightBinding) && bindingsMatch(flightBinding, normalizedBinding)
    ));
    const consentMutation = invokeConsentAuthorityMutation('cancelWhere', Object.freeze({
      projectId: normalizedBinding.projectId,
      sessionId: normalizedBinding.sessionId,
      jobId: normalizedBinding.jobId,
      kernelId: normalizedBinding.kernelId,
    }));
    const delegationIds = [];
    let mutationsOk = consentMutation.ok;
    const id = activeByTask.get(taskKey(normalizedBinding));
    const record = id ? delegations.get(id) : null;
    if (record
      && record.status === CAPABILITY_DELEGATION_STATUSES.ACTIVE
      && bindingsMatch(record.binding, normalizedBinding)) {
      const result = revoke(record.delegationId, normalizedOptions);
      if (result.ok !== true) mutationsOk = false;
      if (result.revoked) delegationIds.push(record.delegationId);
    }
    return Object.freeze({
      ok: mutationsOk,
      revoked: delegationIds.length,
      invalidatedIssuances,
      delegationIds: Object.freeze(delegationIds),
    });
  }

  function revokeWhere(filters = {}, options = {}) {
    if (!hasExactKeys(filters, ['projectId', 'sessionId', 'jobId', 'kernelId'])) {
      return Object.freeze({
        ok: false,
        revoked: 0,
        invalidatedIssuances: 0,
        delegationIds: Object.freeze([]),
      });
    }
    const normalizedOptions = normalizeRevokeOptions(options);
    const normalizedFilters = {};
    for (const field of ['projectId', 'sessionId', 'jobId', 'kernelId']) {
      if (filters[field] !== undefined) normalizedFilters[field] = normalizeRequiredText(filters[field], field);
    }
    if (!Object.keys(normalizedFilters).length) {
      return Object.freeze({
        ok: false,
        revoked: 0,
        invalidatedIssuances: 0,
        delegationIds: Object.freeze([]),
      });
    }
    const matchesFilters = (candidateBinding) => Boolean(candidateBinding)
      && !Object.entries(normalizedFilters)
        .some(([field, value]) => candidateBinding[field] !== value);
    const invalidatedIssuances = invalidateInFlightWhere(matchesFilters);
    const consentMutation = invokeConsentAuthorityMutation(
      'cancelWhere',
      Object.freeze({ ...normalizedFilters })
    );
    const delegationIds = [];
    let mutationsOk = consentMutation.ok;
    for (const record of delegations.values()) {
      if (record.status !== CAPABILITY_DELEGATION_STATUSES.ACTIVE) continue;
      if (!matchesFilters(record.binding)) continue;
      const result = revoke(record.delegationId, normalizedOptions);
      if (result.ok !== true) mutationsOk = false;
      if (result.revoked) delegationIds.push(record.delegationId);
    }
    return Object.freeze({
      ok: mutationsOk,
      revoked: delegationIds.length,
      invalidatedIssuances,
      delegationIds: Object.freeze(delegationIds),
    });
  }

  function get(delegationId) {
    const id = typeof delegationId === 'string' ? delegationId.trim() : '';
    const record = id ? delegations.get(id) : null;
    if (!record) return null;
    markExpired(record, normalizeNow(now));
    return snapshotDelegation(record);
  }

  function list(filters = {}) {
    if (!hasExactKeys(filters, ['projectId', 'sessionId', 'jobId'])) return Object.freeze([]);
    const safeFilters = {};
    try {
      for (const field of ['projectId', 'sessionId', 'jobId']) {
        if (Object.hasOwn(filters, field)) {
          safeFilters[field] = normalizeRequiredText(filters[field], field);
        }
      }
    } catch {
      return Object.freeze([]);
    }
    return Object.freeze(Array.from(delegations.values())
      .filter((record) => !safeFilters.projectId || record.binding.projectId === safeFilters.projectId)
      .filter((record) => !safeFilters.sessionId || record.binding.sessionId === safeFilters.sessionId)
      .filter((record) => !safeFilters.jobId || record.binding.jobId === safeFilters.jobId)
      .map((record) => {
        markExpired(record, normalizeNow(now));
        return snapshotDelegation(record);
      }));
  }

  function diagnostics() {
    return Object.freeze({
      version: TASK_DELEGATION_STORE_VERSION,
      delegations: delegations.size,
      activeDelegations: activeByTask.size,
      decisionRecords: decisions.size,
      defaultTtlMs,
      maxTtlMs,
      maxRecords,
      maxDecisionRecords,
      inFlightIssuances: inFlightIssuances.size,
      maxInFlightIssuances,
      consentAuthorityHealthy,
      persistence: 'process_local',
      authorityBoundary: 'main_process_only',
    });
  }

  function clear() {
    const invalidatedIssuances = invalidateInFlightWhere(() => true);
    const cleared = delegations.size;
    const clearedDecisions = decisions.size;
    delegations.clear();
    activeByTask.clear();
    decisions.clear();
    const consentMutation = invokeConsentAuthorityMutation('clear');
    return Object.freeze({
      ok: consentMutation.ok,
      cleared,
      clearedDecisions,
      invalidatedIssuances,
    });
  }

  return Object.freeze({
    clear,
    consumeDecision,
    diagnostics,
    get,
    inspectDecision,
    issueFromTrustedConsent,
    list,
    purge,
    revoke,
    revokeBinding,
    revokeWhere,
  });
}

class TaskDelegationStore {
  constructor(options = {}) {
    Object.assign(this, createTaskDelegationStore(options));
    Object.freeze(this);
  }
}

module.exports = {
  TASK_DELEGATION_REASONS,
  TASK_DELEGATION_STORE_VERSION,
  TaskDelegationStore,
  createTaskDelegationStore,
};
