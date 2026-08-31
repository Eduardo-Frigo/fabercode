'use strict';

const crypto = require('crypto');

const {
  createProjectRootPhysicalIdentityDigest,
} = require('../capabilities/project_root_authority_contract');
const {
  isPortableAbsolutePath,
} = require('../capabilities/sandbox_backend_contract');

const ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION = 'assistant-job-authority.v1';
const ASSISTANT_JOB_AUTHORITY_SERVICE_VERSION = 'assistant-job-authority-service.v1';
const ASSISTANT_SUBMISSION_DIGEST_SCHEMA_VERSION = 'assistant-submission.v1';
const ASSISTANT_ACTION_DIGEST_SCHEMA_VERSION = 'assistant-action.v1';
const DEFAULT_MAX_ACTIVE_SUBMISSIONS = 1_024;
const DEFAULT_MAX_ACTIVE_SESSIONS = 1_024;
const HARD_MAX_ACTIVE_RECORDS = 10_000;
const ID_GENERATION_ATTEMPTS = 4;

const ASSISTANT_JOB_AUTHORITY_REASONS = Object.freeze({
  ACTION_ALREADY_BOUND: 'action_already_bound',
  ACTION_DIGEST_MISMATCH: 'action_digest_mismatch',
  AUTHORIZED: 'authorized',
  BUSY: 'authority_busy',
  CAPACITY_EXCEEDED: 'authority_capacity_exceeded',
  CLEARED: 'authority_cleared',
  CONTEXT_MISMATCH: 'authority_context_mismatch',
  ID_COLLISION: 'authority_id_collision',
  INVALID_INPUT: 'authority_invalid_input',
  JOB_ALREADY_BOUND: 'job_already_bound',
  JOB_NOT_BOUND: 'job_not_bound',
  JOB_NOT_FOUND: 'job_not_found',
  JOB_NOT_RETRYABLE: 'job_not_retryable',
  LIFECYCLE_INACTIVE: 'lifecycle_inactive',
  PROJECT_NOT_AUTHORIZED: 'project_not_authorized',
  REVOKED: 'authority_revoked',
});

const AUTHORITY_CONTEXT_KEYS = Object.freeze([
  'schemaVersion',
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'kernelId',
  'submissionDigest',
  'actionDigest',
]);
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const BEGIN_KEYS = Object.freeze(['projectId', 'rootPath', 'kernelId', 'request']);
const REQUEST_KEYS = Object.freeze(['userMessage', 'attachments']);
const ATTACHMENT_KEYS = Object.freeze(['name', 'type', 'size', 'path']);
const BIND_JOB_KEYS = Object.freeze(['submissionId', 'jobId']);
const BIND_ACTION_KEYS = Object.freeze(['binding', 'action']);
const RESTORE_PENDING_APPROVAL_KEYS = Object.freeze(['jobId']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'blocked', 'cancelled', 'runtime_interrupted']);
const ACTIVE_JOB_STATUSES = new Set(['running', 'retry_pending', 'paused_memory_pressure']);
const EXECUTABLE_JOB_PHASES = new Set(['awaiting_user_confirmation', 'execute_pending']);
const SECRET_KEY_PATTERN = /(secret|password|passphrase|token|api.?key|authorization|cookie|credential|private.?key)/i;
const SAFE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const SAFE_SESSION_ID_PATTERN = /^session_[A-Za-z0-9_-]{24,128}$/;
const SAFE_SUBMISSION_ID_PATTERN = /^submission_[A-Za-z0-9_-]{24,128}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PHYSICAL_ROOT_IDENTITY_KEYS = Object.freeze([
  'device',
  'inode',
  'entryDevice',
  'entryInode',
  'entryType',
]);

function defaultSessionIdFactory() {
  return `session_${crypto.randomBytes(32).toString('base64url')}`;
}

function defaultSubmissionIdFactory() {
  return `submission_${crypto.randomBytes(32).toString('base64url')}`;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataEntries(value) {
  const isArray = Array.isArray(value);
  const ownKeys = Reflect.ownKeys(value);
  const entries = [];
  for (const key of ownKeys) {
    if (isArray && key === 'length') continue;
    if (typeof key !== 'string') throw new TypeError('Authority values must not contain symbols');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Authority values must contain enumerable data properties only');
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function assertExactDataRecord(value, allowedKeys, fieldName, { requireAll = true } = {}) {
  if (!isPlainObject(value)) throw new TypeError(`${fieldName} must be a plain data record`);
  const entries = ownDataEntries(value);
  const keys = entries.map(([key]) => key);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw new TypeError(`${fieldName} contains unsupported fields`);
  }
  if (requireAll && (keys.length !== allowedKeys.length || allowedKeys.some((key) => !keys.includes(key)))) {
    throw new TypeError(`${fieldName} must contain exactly the required fields`);
  }
  return new Map(entries);
}

function canonicalizeJson(value, options = {}, state = { seen: new Set(), nodes: 0, stringBytes: 0 }, depth = 0) {
  if (depth > 32) throw new TypeError('Authority JSON exceeds the maximum depth');
  state.nodes += 1;
  if (state.nodes > 50_000) throw new TypeError('Authority JSON exceeds the maximum node count');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > 2 * 1024 * 1024) throw new TypeError('Authority JSON exceeds the string budget');
    if (value.includes('\0')) throw new TypeError('Authority JSON strings must not contain NUL');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('Authority JSON numbers must be finite and must not be negative zero');
    }
    return value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError('Authority JSON contains an unsupported value');
  }
  if (state.seen.has(value)) throw new TypeError('Authority JSON must not contain cycles');
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = ownDataEntries(value);
      if (entries.length !== value.length
        || entries.some(([key], index) => key !== String(index))) {
        throw new TypeError('Authority JSON arrays must be dense indexed arrays');
      }
      return entries.map(([, entry]) => canonicalizeJson(entry, options, state, depth + 1));
    }
    if (!isPlainObject(value)) throw new TypeError('Authority JSON objects must be plain data records');
    const output = {};
    for (const [key, entry] of ownDataEntries(value).sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ))) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`Authority JSON contains forbidden key: ${key}`);
      if (options.rejectSecretKeys && SECRET_KEY_PATTERN.test(key)) {
        throw new TypeError(`Authorized context contains secret-like field: ${key}`);
      }
      output[key] = canonicalizeJson(entry, options, state, depth + 1);
    }
    return output;
  } finally {
    state.seen.delete(value);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function immutableJson(value, options = {}) {
  return deepFreeze(canonicalizeJson(value, options));
}

function canonicalDigest(value) {
  const canonical = canonicalizeJson(value);
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')}`;
}

function normalizeText(value, fieldName, maximum = 512) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a non-empty string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\0')) {
    throw new TypeError(`${fieldName} must be a non-empty bounded string`);
  }
  return normalized;
}

function normalizeAbsolutePath(value, fieldName) {
  const normalized = normalizeText(value, fieldName, 32_768);
  if (!isPortableAbsolutePath(normalized)) throw new TypeError(`${fieldName} must be an absolute path`);
  return normalized;
}

function normalizeDigest(value, fieldName, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !SAFE_DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${fieldName} must be a canonical SHA-256 digest`);
  }
  return value;
}

function normalizePhysicalRootIdentity(value) {
  const fields = assertExactDataRecord(
    value,
    PHYSICAL_ROOT_IDENTITY_KEYS,
    'authorized physicalRootIdentity'
  );
  const snapshot = {};
  for (const field of PHYSICAL_ROOT_IDENTITY_KEYS) {
    snapshot[field] = normalizeText(fields.get(field), `physicalRootIdentity.${field}`, 256);
  }
  if (!['directory', 'symlink'].includes(snapshot.entryType)) {
    throw new TypeError('physicalRootIdentity.entryType is invalid');
  }
  return Object.freeze(snapshot);
}

function physicalRootIdentitiesMatch(left, right) {
  return PHYSICAL_ROOT_IDENTITY_KEYS.every((field) => left[field] === right[field]);
}

function normalizeAttachment(value, index) {
  const fields = assertExactDataRecord(value, ATTACHMENT_KEYS, `request.attachments[${index}]`, { requireAll: false });
  const size = fields.has('size') ? fields.get('size') : 0;
  if (!Number.isSafeInteger(size) || size < 0 || Object.is(size, -0)) {
    throw new TypeError(`request.attachments[${index}].size must be a non-negative safe integer`);
  }
  const type = fields.has('type') ? fields.get('type') : '';
  const attachmentPath = fields.has('path') ? fields.get('path') : '';
  if (typeof type !== 'string' || type.length > 512 || type.includes('\0')) {
    throw new TypeError(`request.attachments[${index}].type must be a bounded string`);
  }
  if (typeof attachmentPath !== 'string'
    || attachmentPath.length > 32_768
    || attachmentPath.includes('\0')) {
    throw new TypeError(`request.attachments[${index}].path must be a bounded string`);
  }
  return Object.freeze({
    name: normalizeText(fields.has('name') ? fields.get('name') : 'attachment', `request.attachments[${index}].name`, 1_024),
    type,
    size,
    path: attachmentPath,
  });
}

function normalizeRequest(value) {
  const fields = assertExactDataRecord(value, REQUEST_KEYS, 'request');
  const userMessage = fields.get('userMessage');
  if (typeof userMessage !== 'string' || userMessage.length > 2 * 1024 * 1024 || userMessage.includes('\0')) {
    throw new TypeError('request.userMessage must be a bounded string');
  }
  const attachments = fields.get('attachments');
  if (!Array.isArray(attachments) || attachments.length > 64) {
    throw new TypeError('request.attachments must be a bounded array');
  }
  ownDataEntries(attachments);
  const normalizedAttachments = attachments.map(normalizeAttachment);
  if (!userMessage.trim() && normalizedAttachments.length === 0) {
    throw new TypeError('request must contain a user message or attachment');
  }
  return deepFreeze({ userMessage, attachments: normalizedAttachments });
}

function createSubmissionDigest(request, authorizedContext) {
  return canonicalDigest({
    schemaVersion: ASSISTANT_SUBMISSION_DIGEST_SCHEMA_VERSION,
    userMessage: request.userMessage,
    attachments: request.attachments,
    authorizedContext,
  });
}

function createActionDigest(action) {
  return canonicalDigest({
    schemaVersion: ASSISTANT_ACTION_DIGEST_SCHEMA_VERSION,
    action: canonicalizeJson(action),
  });
}

function normalizeAuthorityContext(value) {
  const fields = assertExactDataRecord(value, AUTHORITY_CONTEXT_KEYS, 'authorityContext');
  if (fields.get('schemaVersion') !== ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION) {
    throw new TypeError('authorityContext schemaVersion is unsupported');
  }
  const sessionId = normalizeText(fields.get('sessionId'), 'authorityContext.sessionId', 160);
  if (!SAFE_SESSION_ID_PATTERN.test(sessionId)) throw new TypeError('authorityContext.sessionId is invalid');
  return Object.freeze({
    schemaVersion: ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION,
    projectId: normalizeText(fields.get('projectId'), 'authorityContext.projectId'),
    canonicalRootPath: normalizeAbsolutePath(fields.get('canonicalRootPath'), 'authorityContext.canonicalRootPath'),
    realRootPath: normalizeAbsolutePath(fields.get('realRootPath'), 'authorityContext.realRootPath'),
    sessionId,
    kernelId: normalizeText(fields.get('kernelId'), 'authorityContext.kernelId'),
    submissionDigest: normalizeDigest(fields.get('submissionDigest'), 'authorityContext.submissionDigest'),
    actionDigest: normalizeDigest(fields.get('actionDigest'), 'authorityContext.actionDigest', { nullable: true }),
  });
}

function normalizeBinding(value) {
  const fields = assertExactDataRecord(value, BINDING_KEYS, 'binding');
  const sessionId = normalizeText(fields.get('sessionId'), 'binding.sessionId', 160);
  const jobId = normalizeText(fields.get('jobId'), 'binding.jobId', 256);
  if (!SAFE_SESSION_ID_PATTERN.test(sessionId) || !SAFE_JOB_ID_PATTERN.test(jobId)) {
    throw new TypeError('binding contains an invalid sessionId or jobId');
  }
  return Object.freeze({
    projectId: normalizeText(fields.get('projectId'), 'binding.projectId'),
    canonicalRootPath: normalizeAbsolutePath(fields.get('canonicalRootPath'), 'binding.canonicalRootPath'),
    realRootPath: normalizeAbsolutePath(fields.get('realRootPath'), 'binding.realRootPath'),
    sessionId,
    jobId,
    kernelId: normalizeText(fields.get('kernelId'), 'binding.kernelId'),
    submissionDigest: normalizeDigest(fields.get('submissionDigest'), 'binding.submissionDigest'),
  });
}

function contextsMatch(left, right) {
  return AUTHORITY_CONTEXT_KEYS.every((field) => left[field] === right[field]);
}

function bindingsMatch(left, right) {
  return BINDING_KEYS.every((field) => left[field] === right[field]);
}

function bindingFromRecord(record) {
  if (!record.jobId) return null;
  return Object.freeze({
    projectId: record.context.projectId,
    canonicalRootPath: record.context.canonicalRootPath,
    realRootPath: record.context.realRootPath,
    sessionId: record.context.sessionId,
    jobId: record.jobId,
    kernelId: record.context.kernelId,
    submissionDigest: record.context.submissionDigest,
  });
}

function deny(reason) {
  return Object.freeze({ authorized: false, reason });
}

function allow(binding, extra = {}) {
  return Object.freeze({ authorized: true, reason: ASSISTANT_JOB_AUTHORITY_REASONS.AUTHORIZED, binding, ...extra });
}

function ineligibleRetry(reason) {
  return Object.freeze({ eligible: false, due: false, reason });
}

function createAssistantJobAuthorityService(options = {}) {
  if (!isPlainObject(options)) throw new TypeError('Assistant job authority options must be a plain data record');
  ownDataEntries(options);
  const {
    authorizeProjectBinding,
    getJobById,
    now = () => Date.now(),
    sessionIdFactory = defaultSessionIdFactory,
    submissionIdFactory = defaultSubmissionIdFactory,
    maxActiveSubmissions = DEFAULT_MAX_ACTIVE_SUBMISSIONS,
    maxActiveSessions = DEFAULT_MAX_ACTIVE_SESSIONS,
  } = options;
  if (typeof authorizeProjectBinding !== 'function') throw new TypeError('authorizeProjectBinding must be a function');
  if (typeof getJobById !== 'function') throw new TypeError('getJobById must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof sessionIdFactory !== 'function') throw new TypeError('sessionIdFactory must be a function');
  if (typeof submissionIdFactory !== 'function') throw new TypeError('submissionIdFactory must be a function');
  for (const [value, name] of [[maxActiveSubmissions, 'maxActiveSubmissions'], [maxActiveSessions, 'maxActiveSessions']]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > HARD_MAX_ACTIVE_RECORDS) {
      throw new TypeError(`${name} must be a positive safe integer at most ${HARD_MAX_ACTIVE_RECORDS}`);
    }
  }

  const submissions = new Map();
  const sessions = new Map();
  let generation = 0;
  let beginActive = false;
  let restoreActive = false;
  let lastObservedAt = -1;
  let clockHealthy = true;

  function poisonClock() {
    clockHealthy = false;
    generation += 1;
    for (const record of submissions.values()) {
      record.active = false;
      record.version += 1;
    }
    submissions.clear();
    sessions.clear();
  }

  function readNow() {
    if (!clockHealthy) throw new TypeError('Authority clock is not trustworthy');
    let raw;
    try {
      raw = now();
    } catch (error) {
      poisonClock();
      throw error;
    }
    const value = raw instanceof Date ? raw.getTime() : raw;
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0) || value < lastObservedAt) {
      poisonClock();
      throw new TypeError('now() must return a monotonic non-negative safe-integer timestamp');
    }
    lastObservedAt = value;
    return value;
  }

  function uniqueId(factory, pattern, map) {
    for (let attempt = 0; attempt < ID_GENERATION_ATTEMPTS; attempt += 1) {
      const value = factory();
      if (typeof value === 'string' && pattern.test(value) && !map.has(value)) return value;
    }
    return null;
  }

  function removeRecord(record) {
    if (!record || submissions.get(record.submissionId) !== record) return false;
    submissions.delete(record.submissionId);
    if (sessions.get(record.context.sessionId) === record.submissionId) sessions.delete(record.context.sessionId);
    record.active = false;
    record.version += 1;
    return true;
  }

  function activeRecordForBinding(binding) {
    const submissionId = sessions.get(binding.sessionId);
    const record = submissionId ? submissions.get(submissionId) : null;
    if (!record || !record.active || record.jobId !== binding.jobId) return null;
    const expected = bindingFromRecord(record);
    return expected && bindingsMatch(expected, binding) ? record : null;
  }

  function recordIsCurrent(record, observedGeneration, observedVersion) {
    return generation === observedGeneration
      && record.version === observedVersion
      && submissions.get(record.submissionId) === record
      && record.active;
  }

  function normalizeProjectAuthorization(authorization, expectedProjectId) {
    if (!isPlainObject(authorization)) return null;
    let data;
    try {
      data = new Map(ownDataEntries(authorization));
      if (data.get('authorized') !== true) return null;
      if (data.has('ok') && data.get('ok') !== true) return null;
      if (data.get('projectId') !== expectedProjectId) return null;
      return Object.freeze({
        projectId: expectedProjectId,
        canonicalRootPath: normalizeAbsolutePath(
          data.has('canonicalRootPath') ? data.get('canonicalRootPath') : data.get('rootPath'),
          'authorized canonicalRootPath'
        ),
        realRootPath: normalizeAbsolutePath(data.get('realRootPath'), 'authorized realRootPath'),
        physicalRootIdentity: normalizePhysicalRootIdentity(data.get('physicalRootIdentity')),
        authorizedContext: immutableJson(
          data.has('authorizedContext') ? data.get('authorizedContext') : null,
          { rejectSecretKeys: true }
        ),
      });
    } catch {
      return null;
    }
  }

  function reauthorizeProject(record) {
    const observedGeneration = generation;
    const observedVersion = record.version;
    let authorization;
    try {
      authorization = authorizeProjectBinding(
        record.context.projectId,
        record.context.canonicalRootPath
      );
    } catch {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.PROJECT_NOT_AUTHORIZED };
    }
    if (authorization && typeof authorization.then === 'function') {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.PROJECT_NOT_AUTHORIZED };
    }
    const normalized = normalizeProjectAuthorization(authorization, record.context.projectId);
    if (!recordIsCurrent(record, observedGeneration, observedVersion)) {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE };
    }
    if (!normalized
      || normalized.canonicalRootPath !== record.context.canonicalRootPath
      || normalized.realRootPath !== record.context.realRootPath
      || !physicalRootIdentitiesMatch(
        normalized.physicalRootIdentity,
        record.projectAuthorization.physicalRootIdentity
      )) {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.PROJECT_NOT_AUTHORIZED };
    }
    return { ok: true };
  }

  function readJob(record) {
    const observedGeneration = generation;
    const observedVersion = record.version;
    let result;
    try {
      result = getJobById(record.jobId);
    } catch {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND };
    }
    if (result && typeof result.then === 'function') {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND };
    }
    if (generation !== observedGeneration
      || record.version !== observedVersion
      || submissions.get(record.submissionId) !== record
      || !record.active) {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE };
    }
    if (!isPlainObject(result)) return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND };
    try {
      ownDataEntries(result);
    } catch {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND };
    }
    const resultJobDescriptor = Object.getOwnPropertyDescriptor(result, 'job');
    const resultOkDescriptor = Object.getOwnPropertyDescriptor(result, 'ok');
    if (!resultJobDescriptor || !Object.hasOwn(resultJobDescriptor, 'value')
      || !resultOkDescriptor || resultOkDescriptor.value !== true) {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND };
    }
    const job = resultJobDescriptor.value;
    if (!isPlainObject(job)) return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND };
    try {
      ownDataEntries(job);
      const values = {};
      for (const field of ['id', 'status', 'phase', 'projectId', 'rootPath', 'authorityContext', 'request', 'retryState']) {
        const descriptor = Object.getOwnPropertyDescriptor(job, field);
        values[field] = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      }
      return { ok: true, job, values };
    } catch {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH };
    }
  }

  function verifyPersistedJob(record, { allowUnpersistedAction = false } = {}) {
    const invalidate = (reason) => {
      removeRecord(record);
      return { ok: false, reason };
    };
    const observedGeneration = generation;
    const observedVersion = record.version;
    const found = readJob(record);
    if (!found.ok) return invalidate(found.reason);
    const { values } = found;
    if (values.id !== record.jobId
      || values.projectId !== record.context.projectId
      || values.rootPath !== record.context.canonicalRootPath) {
      return invalidate(ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH);
    }
    let persistedContext;
    try {
      persistedContext = normalizeAuthorityContext(values.authorityContext);
    } catch {
      return invalidate(ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH);
    }
    const exact = contextsMatch(persistedContext, record.context);
    const pendingActionMatch = allowUnpersistedAction
      && record.context.actionDigest !== null
      && persistedContext.actionDigest === null
      && AUTHORITY_CONTEXT_KEYS
        .filter((field) => field !== 'actionDigest')
        .every((field) => persistedContext[field] === record.context[field]);
    if (!exact && !pendingActionMatch) {
      return invalidate(ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH);
    }
    let persistedRequest;
    try {
      persistedRequest = normalizeRequest(values.request);
    } catch {
      return invalidate(ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH);
    }
    if (createSubmissionDigest(persistedRequest, record.authorizedContext) !== record.context.submissionDigest) {
      return invalidate(ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH);
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion)) {
      return { ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE };
    }
    const projectAuthorization = reauthorizeProject(record);
    if (!projectAuthorization.ok) return invalidate(projectAuthorization.reason);
    return { ok: true, ...found, persistedContext, persistedRequest };
  }

  function beginSubmission(input) {
    if (beginActive || restoreActive) return Object.freeze({ ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.BUSY });
    beginActive = true;
    const observedGeneration = generation;
    try {
      if (submissions.size >= maxActiveSubmissions || sessions.size >= maxActiveSessions) {
        return Object.freeze({ ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.CAPACITY_EXCEEDED });
      }
      const fields = assertExactDataRecord(input, BEGIN_KEYS, 'submission');
      const projectId = normalizeText(fields.get('projectId'), 'submission.projectId');
      const rootPath = normalizeAbsolutePath(fields.get('rootPath'), 'submission.rootPath');
      const kernelId = normalizeText(fields.get('kernelId'), 'submission.kernelId');
      const request = normalizeRequest(fields.get('request'));
      const checkedAt = readNow();
      const authorization = authorizeProjectBinding(projectId, rootPath);
      if (authorization && typeof authorization.then === 'function') {
        return Object.freeze({ ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.PROJECT_NOT_AUTHORIZED });
      }
      const projectAuthorization = normalizeProjectAuthorization(authorization, projectId);
      if (!projectAuthorization) {
        return Object.freeze({ ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.PROJECT_NOT_AUTHORIZED });
      }
      const { canonicalRootPath, realRootPath, authorizedContext } = projectAuthorization;
      if (generation !== observedGeneration || !clockHealthy) {
        return Object.freeze({ ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE });
      }
      const sessionId = uniqueId(sessionIdFactory, SAFE_SESSION_ID_PATTERN, sessions);
      const submissionId = uniqueId(submissionIdFactory, SAFE_SUBMISSION_ID_PATTERN, submissions);
      if (!sessionId || !submissionId || generation !== observedGeneration) {
        return Object.freeze({ ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.ID_COLLISION });
      }
      const context = Object.freeze({
        schemaVersion: ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION,
        projectId,
        canonicalRootPath,
        realRootPath,
        sessionId,
        kernelId,
        submissionDigest: createSubmissionDigest(request, authorizedContext),
        actionDigest: null,
      });
      const record = {
        submissionId,
        context,
        request,
        authorizedContext,
        projectAuthorization,
        jobId: null,
        createdAt: checkedAt,
        active: true,
        mutating: false,
        version: 0,
      };
      submissions.set(submissionId, record);
      sessions.set(sessionId, submissionId);
      return Object.freeze({ ok: true, submissionId, authorityContext: context });
    } catch {
      return Object.freeze({ ok: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT });
    } finally {
      beginActive = false;
    }
  }

  function restorePendingApproval(input) {
    if (beginActive || restoreActive) {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.BUSY);
    }
    restoreActive = true;
    let provisionalRecord = null;
    try {
      const fields = assertExactDataRecord(
        input,
        RESTORE_PENDING_APPROVAL_KEYS,
        'pending approval recovery'
      );
      const jobId = normalizeText(fields.get('jobId'), 'jobId', 256);
      if (!SAFE_JOB_ID_PATTERN.test(jobId)) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
      }

      const observedGeneration = generation;
      const rawResult = getJobById(jobId);
      if (rawResult && typeof rawResult.then === 'function') {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND);
      }
      if (!isPlainObject(rawResult)) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND);
      }
      const resultFields = new Map(ownDataEntries(rawResult));
      const job = resultFields.get('job');
      if (resultFields.get('ok') !== true || !isPlainObject(job)) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_FOUND);
      }
      ownDataEntries(job);
      const jobValue = (field) => {
        const descriptor = Object.getOwnPropertyDescriptor(job, field);
        return descriptor
          && descriptor.enumerable === true
          && Object.hasOwn(descriptor, 'value')
          ? descriptor.value
          : undefined;
      };
      if (jobValue('id') !== jobId
        || jobValue('status') !== 'running'
        || jobValue('phase') !== 'awaiting_user_confirmation') {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
      }

      const context = normalizeAuthorityContext(jobValue('authorityContext'));
      const request = normalizeRequest(jobValue('request'));
      if (context.actionDigest === null
        || jobValue('projectId') !== context.projectId
        || jobValue('rootPath') !== context.canonicalRootPath) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH);
      }

      const existingSubmissionId = sessions.get(context.sessionId);
      if (existingSubmissionId) {
        const existing = submissions.get(existingSubmissionId);
        if (!existing
          || !existing.active
          || existing.jobId !== jobId
          || !contextsMatch(existing.context, context)) {
          return deny(ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH);
        }
        const verifiedExisting = verifyPersistedJob(existing);
        if (!verifiedExisting.ok) return deny(verifiedExisting.reason);
        return allow(bindingFromRecord(existing), {
          authorityContext: existing.context,
          request: verifiedExisting.persistedRequest,
          restored: true,
          idempotent: true,
        });
      }
      if (submissions.size >= maxActiveSubmissions || sessions.size >= maxActiveSessions) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.CAPACITY_EXCEEDED);
      }

      const rawAuthorization = authorizeProjectBinding(
        context.projectId,
        context.canonicalRootPath
      );
      if (rawAuthorization && typeof rawAuthorization.then === 'function') {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.PROJECT_NOT_AUTHORIZED);
      }
      const projectAuthorization = normalizeProjectAuthorization(
        rawAuthorization,
        context.projectId
      );
      if (generation !== observedGeneration || !clockHealthy) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
      }
      if (!projectAuthorization
        || projectAuthorization.canonicalRootPath !== context.canonicalRootPath
        || projectAuthorization.realRootPath !== context.realRootPath
        || createSubmissionDigest(request, projectAuthorization.authorizedContext)
          !== context.submissionDigest) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.CONTEXT_MISMATCH);
      }

      const checkedAt = readNow();
      const submissionId = uniqueId(
        submissionIdFactory,
        SAFE_SUBMISSION_ID_PATTERN,
        submissions
      );
      if (!submissionId || generation !== observedGeneration) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.ID_COLLISION);
      }
      provisionalRecord = {
        submissionId,
        context,
        request,
        authorizedContext: projectAuthorization.authorizedContext,
        projectAuthorization,
        jobId,
        createdAt: checkedAt,
        active: true,
        mutating: false,
        version: 0,
      };
      submissions.set(submissionId, provisionalRecord);
      sessions.set(context.sessionId, submissionId);
      const verified = verifyPersistedJob(provisionalRecord);
      if (!verified.ok) return deny(verified.reason);
      return allow(bindingFromRecord(provisionalRecord), {
        authorityContext: context,
        request: verified.persistedRequest,
        restored: true,
        idempotent: false,
      });
    } catch {
      if (provisionalRecord && provisionalRecord.active) removeRecord(provisionalRecord);
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
    } finally {
      restoreActive = false;
    }
  }

  function bindJob(input) {
    try {
      const fields = assertExactDataRecord(input, BIND_JOB_KEYS, 'job binding');
      const submissionId = normalizeText(fields.get('submissionId'), 'submissionId', 160);
      const jobId = normalizeText(fields.get('jobId'), 'jobId', 256);
      if (!SAFE_SUBMISSION_ID_PATTERN.test(submissionId) || !SAFE_JOB_ID_PATTERN.test(jobId)) {
        return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
      }
      const record = submissions.get(submissionId);
      if (!record || !record.active) return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
      if (record.mutating) return deny(ASSISTANT_JOB_AUTHORITY_REASONS.BUSY);
      if (record.jobId && record.jobId !== jobId) return deny(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_ALREADY_BOUND);
      const previousJobId = record.jobId;
      record.mutating = true;
      try {
        record.jobId = jobId;
        const verified = verifyPersistedJob(record);
        if (!verified.ok) {
          record.jobId = previousJobId;
          return deny(verified.reason);
        }
        if (verified.persistedContext.actionDigest !== null) {
          record.jobId = previousJobId;
          return deny(ASSISTANT_JOB_AUTHORITY_REASONS.ACTION_ALREADY_BOUND);
        }
        record.version += 1;
        return allow(bindingFromRecord(record), { bound: true, idempotent: previousJobId === jobId });
      } finally {
        record.mutating = false;
      }
    } catch {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
    }
  }

  function authorizeLifecycle(inputBinding) {
    let binding;
    try {
      binding = normalizeBinding(inputBinding);
    } catch {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
    }
    const record = activeRecordForBinding(binding);
    if (!record) return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    const verified = verifyPersistedJob(record);
    if (!verified.ok) return deny(verified.reason);
    const status = typeof verified.values.status === 'string' ? verified.values.status : '';
    if (TERMINAL_JOB_STATUSES.has(status) || !ACTIVE_JOB_STATUSES.has(status)) {
      removeRecord(record);
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    }
    return allow(bindingFromRecord(record));
  }

  function bindAction(input) {
    try {
      const fields = assertExactDataRecord(input, BIND_ACTION_KEYS, 'action binding');
      const binding = normalizeBinding(fields.get('binding'));
      const record = activeRecordForBinding(binding);
      if (!record) return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
      if (record.mutating) return deny(ASSISTANT_JOB_AUTHORITY_REASONS.BUSY);
      record.mutating = true;
      try {
        const verified = verifyPersistedJob(record, { allowUnpersistedAction: true });
        if (!verified.ok) return deny(verified.reason);
        if (!ACTIVE_JOB_STATUSES.has(
          typeof verified.values.status === 'string' ? verified.values.status : ''
        )) {
          return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
        }
        const observedGeneration = generation;
        const observedVersion = record.version;
        const digest = createActionDigest(fields.get('action'));
        if (generation !== observedGeneration
          || record.version !== observedVersion
          || submissions.get(record.submissionId) !== record
          || !record.active) {
          return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
        }
        if (record.context.actionDigest && record.context.actionDigest !== digest) {
          return deny(ASSISTANT_JOB_AUTHORITY_REASONS.ACTION_DIGEST_MISMATCH);
        }
        if (verified.persistedContext.actionDigest
          && verified.persistedContext.actionDigest !== digest) {
          return deny(ASSISTANT_JOB_AUTHORITY_REASONS.ACTION_DIGEST_MISMATCH);
        }
        const idempotent = record.context.actionDigest === digest;
        if (!record.context.actionDigest) {
          record.context = Object.freeze({ ...record.context, actionDigest: digest });
          record.version += 1;
        }
        return allow(bindingFromRecord(record), {
          actionDigest: digest,
          authorityContext: record.context,
          bound: true,
          idempotent,
        });
      } finally {
        record.mutating = false;
      }
    } catch {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
    }
  }

  function inspectRetryEligibility(inputBinding) {
    let binding;
    try {
      binding = normalizeBinding(inputBinding);
    } catch {
      return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
    }
    const lifecycle = authorizeLifecycle(binding);
    if (!lifecycle.authorized) return ineligibleRetry(lifecycle.reason);
    const record = activeRecordForBinding(binding);
    const verified = record ? verifyPersistedJob(record) : null;
    if (!verified || !verified.ok) {
      return ineligibleRetry(
        verified ? verified.reason : ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE
      );
    }
    const status = typeof verified.values.status === 'string' ? verified.values.status : '';
    const phase = typeof verified.values.phase === 'string' ? verified.values.phase : '';
    const observedGeneration = generation;
    const observedVersion = record.version;
    if (!isPlainObject(verified.values.retryState)) {
      return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_RETRYABLE);
    }
    let retryableFlag;
    let nextRetryAt = null;
    let notBefore = null;
    try {
      ownDataEntries(verified.values.retryState);
      const retryableDescriptor = Object.getOwnPropertyDescriptor(verified.values.retryState, 'retryable');
      if (!retryableDescriptor
        || retryableDescriptor.enumerable !== true
        || !Object.hasOwn(retryableDescriptor, 'value')
        || typeof retryableDescriptor.value !== 'boolean') {
        return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_RETRYABLE);
      }
      retryableFlag = retryableDescriptor.value;
      const nextRetryAtDescriptor = Object.getOwnPropertyDescriptor(
        verified.values.retryState,
        'nextRetryAt'
      );
      if (nextRetryAtDescriptor) {
        if (nextRetryAtDescriptor.enumerable !== true
          || !Object.hasOwn(nextRetryAtDescriptor, 'value')) {
          return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_RETRYABLE);
        }
        const rawNextRetryAt = nextRetryAtDescriptor.value;
        if (rawNextRetryAt !== null) {
          if (typeof rawNextRetryAt !== 'string'
            || !rawNextRetryAt
            || rawNextRetryAt.length > 64
            || rawNextRetryAt.includes('\0')) {
            return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_RETRYABLE);
          }
          const parsedNextRetryAt = Date.parse(rawNextRetryAt);
          if (!Number.isSafeInteger(parsedNextRetryAt)
            || new Date(parsedNextRetryAt).toISOString() !== rawNextRetryAt) {
            return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_RETRYABLE);
          }
          nextRetryAt = parsedNextRetryAt;
          notBefore = rawNextRetryAt;
        }
      }
    } catch {
      return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_RETRYABLE);
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion)) {
      return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    }
    const supported = (status === 'retry_pending' && retryableFlag)
      || (status === 'paused_memory_pressure' && phase === 'paused_memory_pressure' && retryableFlag);
    if (!supported) return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_RETRYABLE);
    let checkedAt;
    try {
      checkedAt = readNow();
    } catch {
      return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion)) {
      return ineligibleRetry(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    }
    const due = nextRetryAt === null || checkedAt >= nextRetryAt;
    return Object.freeze({
      eligible: true,
      due,
      reason: due
        ? ASSISTANT_JOB_AUTHORITY_REASONS.AUTHORIZED
        : ASSISTANT_JOB_AUTHORITY_REASONS.JOB_NOT_RETRYABLE,
      binding: bindingFromRecord(record),
      request: verified.persistedRequest,
      notBefore,
    });
  }

  function authorizeRetry(inputBinding) {
    const inspection = inspectRetryEligibility(inputBinding);
    if (!inspection.eligible || !inspection.due) return deny(inspection.reason);
    return allow(inspection.binding, { request: inspection.request });
  }

  function authorizeExecute(input) {
    let fields;
    let binding;
    try {
      fields = assertExactDataRecord(input, BIND_ACTION_KEYS, 'execute authorization');
      binding = normalizeBinding(fields.get('binding'));
    } catch {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
    }
    const lifecycle = authorizeLifecycle(binding);
    if (!lifecycle.authorized) return lifecycle;
    const record = activeRecordForBinding(binding);
    const verified = record ? verifyPersistedJob(record) : null;
    if (!verified || !verified.ok) return deny(verified ? verified.reason : ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    if (verified.values.status !== 'running'
      || !EXECUTABLE_JOB_PHASES.has(
      typeof verified.values.phase === 'string' ? verified.values.phase : ''
      )) {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    }
    if (!record.context.actionDigest || verified.persistedContext.actionDigest !== record.context.actionDigest) {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.ACTION_ALREADY_BOUND);
    }
    let digest;
    try {
      digest = createActionDigest(fields.get('action'));
    } catch {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
    }
    if (digest !== record.context.actionDigest) {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.ACTION_DIGEST_MISMATCH);
    }
    const finalVerification = verifyPersistedJob(record);
    if (!finalVerification.ok
      || finalVerification.values.status !== 'running'
      || !EXECUTABLE_JOB_PHASES.has(
        typeof finalVerification.values.phase === 'string' ? finalVerification.values.phase : ''
      )) {
      return deny(finalVerification.ok
        ? ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE
        : finalVerification.reason);
    }
    return allow(bindingFromRecord(record), { actionDigest: digest });
  }

  function authorizeProjectRootLease(inputBinding) {
    let binding;
    try {
      binding = normalizeBinding(inputBinding);
    } catch {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT);
    }
    const lifecycle = authorizeLifecycle(binding);
    if (!lifecycle.authorized) return lifecycle;
    const record = activeRecordForBinding(binding);
    const verified = record ? verifyPersistedJob(record) : null;
    if (!verified || !verified.ok) {
      return deny(verified
        ? verified.reason
        : ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    }
    if (verified.values.status !== 'running'
      || !EXECUTABLE_JOB_PHASES.has(
        typeof verified.values.phase === 'string' ? verified.values.phase : ''
      )
      || !record.context.actionDigest
      || verified.persistedContext.actionDigest !== record.context.actionDigest) {
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE);
    }
    let physicalRootIdentityDigest;
    try {
      physicalRootIdentityDigest = createProjectRootPhysicalIdentityDigest(
        record.projectAuthorization.physicalRootIdentity
      );
    } catch {
      removeRecord(record);
      return deny(ASSISTANT_JOB_AUTHORITY_REASONS.PROJECT_NOT_AUTHORIZED);
    }
    return allow(bindingFromRecord(record), { physicalRootIdentityDigest });
  }

  function verifyActionDigest(input) {
    return authorizeExecute(input);
  }

  function revokeExact(inputBinding) {
    let binding;
    try {
      binding = normalizeBinding(inputBinding);
    } catch {
      return Object.freeze({ ok: false, revoked: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT });
    }
    const record = activeRecordForBinding(binding);
    if (!record) return Object.freeze({ ok: false, revoked: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE });
    removeRecord(record);
    return Object.freeze({ ok: true, revoked: true, reason: ASSISTANT_JOB_AUTHORITY_REASONS.REVOKED });
  }

  function revokeSubmission(submissionId) {
    if (typeof submissionId !== 'string' || !SAFE_SUBMISSION_ID_PATTERN.test(submissionId)) {
      return Object.freeze({ ok: false, revoked: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.INVALID_INPUT });
    }
    const record = submissions.get(submissionId);
    if (!record) return Object.freeze({ ok: false, revoked: false, reason: ASSISTANT_JOB_AUTHORITY_REASONS.LIFECYCLE_INACTIVE });
    removeRecord(record);
    return Object.freeze({ ok: true, revoked: true, reason: ASSISTANT_JOB_AUTHORITY_REASONS.REVOKED });
  }

  function snapshotForUi(submissionId) {
    const record = typeof submissionId === 'string' ? submissions.get(submissionId) : null;
    return Object.freeze({
      schemaVersion: ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION,
      active: Boolean(record && record.active),
      jobBound: Boolean(record && record.jobId),
      actionBound: Boolean(record && record.context.actionDigest),
    });
  }

  function clear() {
    const cleared = submissions.size;
    generation += 1;
    for (const record of submissions.values()) {
      record.active = false;
      record.version += 1;
    }
    submissions.clear();
    sessions.clear();
    return Object.freeze({ ok: true, cleared, reason: ASSISTANT_JOB_AUTHORITY_REASONS.CLEARED });
  }

  function diagnostics() {
    return Object.freeze({
      version: ASSISTANT_JOB_AUTHORITY_SERVICE_VERSION,
      schemaVersion: ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION,
      activeSubmissions: submissions.size,
      activeSessions: sessions.size,
      maxActiveSubmissions,
      maxActiveSessions,
      clockHealthy,
      persistence: 'process_local',
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({
    authorizeExecute,
    authorizeProjectRootLease,
    authorizeLifecycle,
    authorizeRetry,
    beginSubmission,
    bindAction,
    bindJob,
    clear,
    diagnostics,
    inspectRetryEligibility,
    revoke: revokeExact,
    revokeExact,
    revokeSubmission,
    restorePendingApproval,
    snapshotForUi,
    verifyActionDigest,
  });
}

class AssistantJobAuthorityService {
  constructor(options = {}) {
    Object.assign(this, createAssistantJobAuthorityService(options));
    Object.freeze(this);
  }
}

module.exports = {
  ASSISTANT_ACTION_DIGEST_SCHEMA_VERSION,
  ASSISTANT_JOB_AUTHORITY_REASONS,
  ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION,
  ASSISTANT_JOB_AUTHORITY_SERVICE_VERSION,
  ASSISTANT_SUBMISSION_DIGEST_SCHEMA_VERSION,
  AssistantJobAuthorityService,
  createActionDigest,
  createAssistantJobAuthorityService,
  createSubmissionDigest,
};
