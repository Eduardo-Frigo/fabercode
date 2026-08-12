'use strict';

const {
  isPortableAbsolutePath,
} = require('./sandbox_backend_contract');

const CAPABILITY_DELEGATION_CONTRACT_VERSION = 'capability-delegation.v1';
const CAPABILITY_DELEGATION_RECORD_SCHEMA_VERSION = 'capability-delegation.record.v1';
const CAPABILITY_DELEGATION_DECISION_SCHEMA_VERSION = 'capability-delegation.decision.v1';

const CAPABILITY_DELEGATION_MODES = Object.freeze({
  ASK_EACH: 'ask_each',
  DELEGATE_TASK: 'delegate_task',
});

const CAPABILITY_DELEGATION_SCOPES = Object.freeze({
  TASK: 'task',
});

const CAPABILITY_DELEGATION_AUTHORITY_KINDS = Object.freeze({
  USER_DELEGATED_AGENT: 'user_delegated_agent',
});

const CAPABILITY_DELEGATION_EFFECTS = Object.freeze({
  FILESYSTEM_DELETE: 'filesystem_delete',
});

const CAPABILITY_DELEGATION_STATUSES = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

const CAPABILITY_DELEGATION_DECISION_STATUSES = Object.freeze({
  AUTHORIZED: 'authorized',
});

const DEFAULT_DELEGATION_TTL_MS = 60 * 60 * 1000;
const MAX_DELEGATION_TTL_MS = 2 * 60 * 60 * 1000;

const HARD_MAX_DELEGATION_CONSTRAINTS = Object.freeze({
  maxFilesPerDecision: 32,
  maxBytesPerDecision: 16 * 1024 * 1024,
  maxDirectoriesPerDecision: 4,
  maxFilesTotal: 128,
  maxBytesTotal: 64 * 1024 * 1024,
  maxDirectoriesTotal: 16,
});

const DEFAULT_DELEGATION_CONSTRAINTS = Object.freeze({
  checkpointRequired: true,
  exactPathsOnly: true,
  rejectProtectedPaths: true,
  ...HARD_MAX_DELEGATION_CONSTRAINTS,
});

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DIGEST_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/i;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ownEnumerableDataKeys(value) {
  const arrayValue = Array.isArray(value);
  const keys = Object.keys(value);
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (arrayValue && key === 'length') continue;
    if (typeof key !== 'string') {
      throw new TypeError('Delegation values must not contain symbol keys');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Delegation values must contain enumerable data properties only');
    }
  }
  if (ownKeys.length !== keys.length + (arrayValue ? 1 : 0)) {
    throw new TypeError('Delegation values contain unsupported own properties');
  }
  return keys;
}

function assertPlainRecord(value, fieldName) {
  if (!isRecord(value)) throw new TypeError(`${fieldName} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${fieldName} must be a plain object`);
  }
  ownEnumerableDataKeys(value);
  return value;
}

function assertOnlyKeys(value, allowedKeys, fieldName) {
  const keys = ownEnumerableDataKeys(value);
  for (const key of keys) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new TypeError(`${fieldName} contains forbidden key: ${key}`);
    }
    if (!allowedKeys.includes(key)) {
      throw new TypeError(`${fieldName} contains unsupported field: ${key}`);
    }
    if (value[key] === undefined) {
      throw new TypeError(`${fieldName} must not contain undefined`);
    }
  }
  return keys;
}

function canonicalizeJsonSafe(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Object.is(value, -0)) throw new TypeError('Delegation values must not contain negative zero');
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError('Delegation values must be JSON-compatible');
  }
  if (ancestors.has(value)) throw new TypeError('Delegation values must not contain cycles');
  ancestors.add(value);

  if (Array.isArray(value)) {
    const keys = ownEnumerableDataKeys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError('Delegation arrays must be dense and contain only indexed values');
    }
    const result = value.map((entry) => canonicalizeJsonSafe(entry, ancestors));
    ancestors.delete(value);
    return result;
  }

  assertPlainRecord(value, 'Delegation object');
  const result = {};
  for (const key of ownEnumerableDataKeys(value).sort()) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new TypeError(`Delegation object contains forbidden key: ${key}`);
    }
    if (value[key] === undefined) throw new TypeError('Delegation values must not contain undefined');
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: canonicalizeJsonSafe(value[key], ancestors),
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

function immutableSnapshot(value) {
  return deepFreeze(canonicalizeJsonSafe(value));
}

function normalizeRequiredText(value, fieldName) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a non-empty string`);
  const normalized = value.trim();
  if (!normalized || normalized.includes('\0')) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return normalized;
}

function normalizeIdentifier(value, fieldName) {
  const normalized = normalizeRequiredText(value, fieldName);
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new TypeError(`${fieldName} contains unsupported characters`);
  }
  return normalized;
}

function normalizeDigest(value, fieldName) {
  const normalized = normalizeRequiredText(value, fieldName).toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new TypeError(`${fieldName} must be a SHA-256 digest`);
  }
  return `sha256:${normalized.replace(/^sha256:/, '')}`;
}

function normalizeReasonCode(value, fieldName) {
  const normalized = normalizeRequiredText(value, fieldName);
  if (!SAFE_REASON_CODE_PATTERN.test(normalized)) {
    throw new TypeError(`${fieldName} must be a safe reason code`);
  }
  return normalized;
}

function normalizeTimestamp(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || Object.is(normalized, -0)) {
    throw new TypeError(`${fieldName} must be a non-negative finite timestamp`);
  }
  return normalized;
}

function normalizePositiveSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function normalizeNonNegativeSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function createCapabilityDelegationPrincipal(input = {}) {
  assertPlainRecord(input, 'principal');
  assertOnlyKeys(input, ['kind', 'actorId'], 'principal');
  if (input.kind !== 'user_ui') {
    throw new TypeError('Delegation principal must be user_ui');
  }
  return Object.freeze({
    kind: 'user_ui',
    actorId: normalizeIdentifier(input.actorId, 'principal.actorId'),
  });
}

function createCapabilityDelegationBinding(input = {}) {
  assertPlainRecord(input, 'binding');
  assertOnlyKeys(input, [
    'projectId',
    'canonicalRootPath',
    'realRootPath',
    'sessionId',
    'jobId',
    'kernelId',
    'submissionDigest',
  ], 'binding');

  const canonicalRootPath = normalizeRequiredText(input.canonicalRootPath, 'binding.canonicalRootPath');
  const realRootPath = normalizeRequiredText(input.realRootPath, 'binding.realRootPath');
  if (!isPortableAbsolutePath(canonicalRootPath) || !isPortableAbsolutePath(realRootPath)) {
    throw new TypeError('Delegation roots must be portable absolute paths');
  }
  return Object.freeze({
    projectId: normalizeIdentifier(input.projectId, 'binding.projectId'),
    canonicalRootPath,
    realRootPath,
    sessionId: normalizeIdentifier(input.sessionId, 'binding.sessionId'),
    jobId: normalizeIdentifier(input.jobId, 'binding.jobId'),
    kernelId: normalizeIdentifier(input.kernelId, 'binding.kernelId'),
    submissionDigest: normalizeDigest(input.submissionDigest, 'binding.submissionDigest'),
  });
}

function createCapabilityDelegationAllowedEffects(input = [CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE]) {
  if (!Array.isArray(input)) throw new TypeError('allowedEffects must be an array');
  const keys = ownEnumerableDataKeys(input);
  if (keys.length !== input.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError('allowedEffects must be a dense array');
  }
  if (input.length !== 1 || input[0] !== CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE) {
    throw new TypeError('Task delegations may allow filesystem_delete only');
  }
  return Object.freeze([CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE]);
}

function createCapabilityDelegationConstraints(input = DEFAULT_DELEGATION_CONSTRAINTS) {
  assertPlainRecord(input, 'constraints');
  const fields = Object.keys(DEFAULT_DELEGATION_CONSTRAINTS);
  assertOnlyKeys(input, fields, 'constraints');
  const complete = { ...DEFAULT_DELEGATION_CONSTRAINTS, ...input };
  for (const field of ['checkpointRequired', 'exactPathsOnly', 'rejectProtectedPaths']) {
    if (complete[field] !== true) {
      throw new TypeError(`constraints.${field} must remain true`);
    }
  }
  for (const field of fields.filter((field) => field.startsWith('max'))) {
    normalizePositiveSafeInteger(complete[field], `constraints.${field}`);
    if (complete[field] > HARD_MAX_DELEGATION_CONSTRAINTS[field]) {
      throw new TypeError(`constraints.${field} exceeds the hard security cap`);
    }
  }
  if (complete.maxFilesTotal < complete.maxFilesPerDecision
    || complete.maxBytesTotal < complete.maxBytesPerDecision
    || complete.maxDirectoriesTotal < complete.maxDirectoriesPerDecision) {
    throw new TypeError('Cumulative delegation budgets must cover at least one decision');
  }
  return Object.freeze({
    checkpointRequired: true,
    exactPathsOnly: true,
    rejectProtectedPaths: true,
    maxFilesPerDecision: complete.maxFilesPerDecision,
    maxBytesPerDecision: complete.maxBytesPerDecision,
    maxDirectoriesPerDecision: complete.maxDirectoriesPerDecision,
    maxFilesTotal: complete.maxFilesTotal,
    maxBytesTotal: complete.maxBytesTotal,
    maxDirectoriesTotal: complete.maxDirectoriesTotal,
  });
}

function createCapabilityDelegationImpact(input = {}) {
  assertPlainRecord(input, 'impact');
  assertOnlyKeys(input, ['files', 'bytes', 'directories'], 'impact');
  const impact = {
    files: normalizeNonNegativeSafeInteger(input.files, 'impact.files'),
    bytes: normalizeNonNegativeSafeInteger(input.bytes, 'impact.bytes'),
    directories: normalizeNonNegativeSafeInteger(input.directories, 'impact.directories'),
  };
  if (impact.files === 0 && impact.directories === 0) {
    throw new TypeError('Deletion impact must include at least one file or directory');
  }
  return Object.freeze(impact);
}

function createCapabilityDelegationDecisionRequest(input = {}, { requireCheckpoint = false } = {}) {
  assertPlainRecord(input, 'decision request');
  assertOnlyKeys(input, [
    'binding',
    'effect',
    'requestDigest',
    'impactDigest',
    'checkpointDigest',
    'checkpointVerified',
    'exactPathsVerified',
    'protectedPathsRejected',
    'impact',
  ], 'decision request');
  if (input.effect !== CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE) {
    throw new TypeError('Delegated decisions may authorize filesystem_delete only');
  }
  const hasCheckpointDigest = input.checkpointDigest !== undefined;
  const hasCheckpointVerified = input.checkpointVerified !== undefined;
  if (hasCheckpointDigest !== hasCheckpointVerified) {
    throw new TypeError('checkpointDigest and checkpointVerified must be supplied together');
  }
  if (requireCheckpoint && (!hasCheckpointDigest || input.checkpointVerified !== true)) {
    throw new TypeError('A verified checkpoint is required to consume a delegated decision');
  }
  if (hasCheckpointVerified && input.checkpointVerified !== true) {
    throw new TypeError('checkpointVerified must be true when supplied');
  }
  const hasExactPathVerification = input.exactPathsVerified !== undefined;
  const hasProtectedPathVerification = input.protectedPathsRejected !== undefined;
  if (hasExactPathVerification && input.exactPathsVerified !== true) {
    throw new TypeError('exactPathsVerified must be true when supplied');
  }
  if (hasProtectedPathVerification && input.protectedPathsRejected !== true) {
    throw new TypeError('protectedPathsRejected must be true when supplied');
  }
  if (requireCheckpoint && (!hasExactPathVerification || !hasProtectedPathVerification)) {
    throw new TypeError('Exact-path and protected-path verification are required to consume a decision');
  }
  const request = {
    binding: createCapabilityDelegationBinding(input.binding),
    effect: CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE,
    requestDigest: normalizeDigest(input.requestDigest, 'requestDigest'),
    impactDigest: normalizeDigest(input.impactDigest, 'impactDigest'),
    impact: createCapabilityDelegationImpact(input.impact),
  };
  if (hasCheckpointDigest) {
    request.checkpointDigest = normalizeDigest(input.checkpointDigest, 'checkpointDigest');
    request.checkpointVerified = true;
  }
  if (hasExactPathVerification) request.exactPathsVerified = true;
  if (hasProtectedPathVerification) request.protectedPathsRejected = true;
  return deepFreeze(request);
}

function createTaskDelegationRecord(input = {}) {
  assertPlainRecord(input, 'delegation record');
  assertOnlyKeys(input, [
    'delegationId',
    'principal',
    'binding',
    'allowedEffects',
    'constraints',
    'issuedAt',
    'expiresAt',
    'status',
    'revokedAt',
    'revocationReason',
    'consumedFiles',
    'consumedBytes',
    'consumedDirectories',
    'decisionCount',
  ], 'delegation record');
  const issuedAt = normalizeTimestamp(input.issuedAt, 'issuedAt');
  const expiresAt = normalizeTimestamp(input.expiresAt, 'expiresAt');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_DELEGATION_TTL_MS) {
    throw new TypeError('Delegation expiry must be after issue and within the maximum TTL');
  }
  const status = input.status === undefined
    ? CAPABILITY_DELEGATION_STATUSES.ACTIVE
    : input.status;
  if (!Object.values(CAPABILITY_DELEGATION_STATUSES).includes(status)) {
    throw new TypeError('Unsupported delegation status');
  }
  const revokedAt = input.revokedAt === null ? null : normalizeTimestamp(input.revokedAt, 'revokedAt');
  if (status === CAPABILITY_DELEGATION_STATUSES.REVOKED && revokedAt === null) {
    throw new TypeError('Revoked delegations require revokedAt');
  }
  if (status !== CAPABILITY_DELEGATION_STATUSES.REVOKED && revokedAt !== null) {
    throw new TypeError('Only revoked delegations may contain revokedAt');
  }
  const constraints = createCapabilityDelegationConstraints(input.constraints);
  const consumedFiles = normalizeNonNegativeSafeInteger(input.consumedFiles, 'consumedFiles');
  const consumedBytes = normalizeNonNegativeSafeInteger(input.consumedBytes, 'consumedBytes');
  const consumedDirectories = normalizeNonNegativeSafeInteger(
    input.consumedDirectories,
    'consumedDirectories'
  );
  if (consumedFiles > constraints.maxFilesTotal
    || consumedBytes > constraints.maxBytesTotal
    || consumedDirectories > constraints.maxDirectoriesTotal) {
    throw new TypeError('Delegation consumed totals must not exceed cumulative constraints');
  }
  return deepFreeze({
    schemaVersion: CAPABILITY_DELEGATION_RECORD_SCHEMA_VERSION,
    contractVersion: CAPABILITY_DELEGATION_CONTRACT_VERSION,
    delegationId: normalizeIdentifier(input.delegationId, 'delegationId'),
    mode: CAPABILITY_DELEGATION_MODES.DELEGATE_TASK,
    scope: CAPABILITY_DELEGATION_SCOPES.TASK,
    authorityKind: CAPABILITY_DELEGATION_AUTHORITY_KINDS.USER_DELEGATED_AGENT,
    principal: createCapabilityDelegationPrincipal(input.principal),
    binding: createCapabilityDelegationBinding(input.binding),
    allowedEffects: createCapabilityDelegationAllowedEffects(input.allowedEffects),
    constraints,
    issuedAt,
    expiresAt,
    status,
    revokedAt,
    revocationReason: status === CAPABILITY_DELEGATION_STATUSES.REVOKED
      ? normalizeReasonCode(input.revocationReason, 'revocationReason')
      : '',
    consumedFiles,
    consumedBytes,
    consumedDirectories,
    decisionCount: normalizeNonNegativeSafeInteger(input.decisionCount, 'decisionCount'),
  });
}

function createTaskDelegationDecisionRecord(input = {}) {
  assertPlainRecord(input, 'delegation decision');
  assertOnlyKeys(input, [
    'decisionId',
    'delegationId',
    'requestDigest',
    'impactDigest',
    'checkpointDigest',
    'impact',
    'authorizedAt',
  ], 'delegation decision');
  return deepFreeze({
    schemaVersion: CAPABILITY_DELEGATION_DECISION_SCHEMA_VERSION,
    contractVersion: CAPABILITY_DELEGATION_CONTRACT_VERSION,
    decisionId: normalizeIdentifier(input.decisionId, 'decisionId'),
    delegationId: normalizeIdentifier(input.delegationId, 'delegationId'),
    authorityKind: CAPABILITY_DELEGATION_AUTHORITY_KINDS.USER_DELEGATED_AGENT,
    status: CAPABILITY_DELEGATION_DECISION_STATUSES.AUTHORIZED,
    effect: CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE,
    requestDigest: normalizeDigest(input.requestDigest, 'requestDigest'),
    impactDigest: normalizeDigest(input.impactDigest, 'impactDigest'),
    checkpointDigest: normalizeDigest(input.checkpointDigest, 'checkpointDigest'),
    checkpointVerified: true,
    impact: createCapabilityDelegationImpact(input.impact),
    authorizedAt: normalizeTimestamp(input.authorizedAt, 'authorizedAt'),
  });
}

function createCapabilityDelegationAuditSummary(event, input = {}) {
  const normalizedEvent = normalizeIdentifier(event, 'event');
  assertPlainRecord(input, 'audit input');
  const allowed = [
    'delegationId',
    'decisionId',
    'projectId',
    'sessionId',
    'jobId',
    'kernelId',
    'status',
    'reason',
    'effect',
    'impact',
  ];
  assertOnlyKeys(input, allowed, 'audit input');
  const summary = { event: normalizedEvent };
  for (const field of ['delegationId', 'decisionId', 'projectId', 'sessionId', 'jobId', 'kernelId']) {
    if (input[field] !== undefined) summary[field] = normalizeIdentifier(input[field], field);
  }
  for (const field of ['status', 'reason', 'effect']) {
    if (input[field] !== undefined) summary[field] = normalizeReasonCode(input[field], field);
  }
  if (input.impact !== undefined) summary.impact = createCapabilityDelegationImpact(input.impact);
  return deepFreeze(summary);
}

module.exports = {
  CAPABILITY_DELEGATION_AUTHORITY_KINDS,
  CAPABILITY_DELEGATION_CONTRACT_VERSION,
  CAPABILITY_DELEGATION_DECISION_SCHEMA_VERSION,
  CAPABILITY_DELEGATION_DECISION_STATUSES,
  CAPABILITY_DELEGATION_EFFECTS,
  CAPABILITY_DELEGATION_MODES,
  CAPABILITY_DELEGATION_RECORD_SCHEMA_VERSION,
  CAPABILITY_DELEGATION_SCOPES,
  CAPABILITY_DELEGATION_STATUSES,
  DEFAULT_DELEGATION_CONSTRAINTS,
  DEFAULT_DELEGATION_TTL_MS,
  HARD_MAX_DELEGATION_CONSTRAINTS,
  MAX_DELEGATION_TTL_MS,
  createCapabilityDelegationAllowedEffects,
  createCapabilityDelegationAuditSummary,
  createCapabilityDelegationBinding,
  createCapabilityDelegationConstraints,
  createCapabilityDelegationDecisionRequest,
  createCapabilityDelegationImpact,
  createCapabilityDelegationPrincipal,
  createTaskDelegationDecisionRecord,
  createTaskDelegationRecord,
  immutableSnapshot,
  normalizeDigest,
  normalizeReasonCode,
};
