'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const util = require('util');
const {
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_READER_VERSION,
} = require('../capabilities/project_root_authority_contract');

const ASSISTANT_EXECUTION_COORDINATOR_VERSION = 'assistant-execution-coordinator.v2';
const DEFAULT_MAX_ACTIVE_JOBS = 1_024;
const HARD_MAX_ACTIVE_JOBS = 10_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_JOB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;
const SAFE_ROOT_LEASE_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const SUPPORTED_PLANNING_OPERATIONS = new Set(['plan', 'message', 'map_message']);
const APPROVAL_MODES = new Set(['ask_each', 'delegate_task']);
const TERMINAL_RECORD_STATES = new Set(['executed', 'failed', 'revoked']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled', 'runtime_interrupted']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const AUTHORITY_BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const PRIVATE_OUTPUT_KEYS = new Set([
  'actionDigest',
  'approvalId',
  'approvalProof',
  'authorityBinding',
  'authorityContext',
  'binding',
  'canonicalRootPath',
  'checkpointDigest',
  'consentHandle',
  'decisionId',
  'delegationId',
  'grantId',
  'impactDigest',
  'kernelId',
  'physicalRootIdentity',
  'physicalRootIdentityDigest',
  'projectRootLease',
  'proof',
  'realRootPath',
  'requestDigest',
  'rootLease',
  'sessionId',
  'submissionDigest',
  'submissionId',
]);
const PRIVATE_EXECUTION_OUTPUT_KEYS = new Set([
  ...PRIVATE_OUTPUT_KEYS,
  'rootPath',
  'root_path',
]);
const ACTION_AUTHORITY_KEYS = new Set([
  ...PRIVATE_OUTPUT_KEYS,
  'jobId',
  'kernelId',
  'projectId',
  'projectInfo',
  'rootPath',
  'root_path',
]);
const BOUND_ACTION_PRIVATE_KEYS = new Set([
  ...PRIVATE_OUTPUT_KEYS,
  'jobId',
  'projectInfo',
]);
const PLANNING_PAYLOAD_PRIVATE_KEYS = new Set([
  ...PRIVATE_OUTPUT_KEYS,
  'approvalMode',
  'jobId',
  'requestedMode',
]);
const PLANNING_OUTPUT_PRIVATE_KEYS = new Set([
  ...PRIVATE_OUTPUT_KEYS,
  'approvalMode',
  'autoExecute',
  'requestedMode',
]);

const ASSISTANT_EXECUTION_COORDINATOR_REASONS = Object.freeze({
  ACTION_BIND_FAILED: 'action_bind_failed',
  ACTION_DIGEST_MISMATCH: 'action_digest_mismatch',
  ACTION_PERSIST_FAILED: 'action_persist_failed',
  AUTHORITY_BEGIN_FAILED: 'authority_begin_failed',
  AUTHORITY_BIND_FAILED: 'authority_bind_failed',
  AUTHORITY_CLEANUP_FAILED: 'authority_cleanup_failed',
  AUTHORITY_UNHEALTHY: 'authority_unhealthy',
  CAPACITY_EXCEEDED: 'coordinator_capacity_exceeded',
  EXECUTION_ALREADY_STARTED: 'execution_already_started',
  EXECUTION_DRAINING: 'execution_draining',
  EXECUTION_FAILED: 'execution_failed',
  EXECUTION_NOT_AUTHORIZED: 'execution_not_authorized',
  INVALID_INPUT: 'coordinator_invalid_input',
  JOB_ALREADY_CREATED: 'planning_job_already_created',
  JOB_CREATE_FAILED: 'job_create_failed',
  JOB_NOT_FOUND: 'coordinator_job_not_found',
  MAP_ACTION_FORBIDDEN: 'map_chat_action_forbidden',
  MAP_JOB_FORBIDDEN: 'map_chat_job_forbidden',
  NO_PLANNING_SCOPE: 'planning_scope_missing',
  OUTPUT_INVALID: 'planning_output_invalid',
  PLANNING_FAILED: 'planning_failed',
  PLANNING_JOB_NO_ACTION: 'planning_job_has_no_action',
  PROJECT_ROOT_AUTHORITY_FAILED: 'project_root_authority_failed',
  PROJECT_ROOT_SCAN_FAILED: 'project_root_scan_failed',
  RETRY_ALREADY_STARTED: 'retry_already_started',
  RETRY_NOT_AUTHORIZED: 'retry_not_authorized',
  RETRY_NOT_DUE: 'retry_not_due',
  REVOKED: 'coordinator_authority_revoked',
});

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataEntries(value, fieldName) {
  const isArray = Array.isArray(value);
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (isArray && key === 'length') continue;
    if (typeof key !== 'string') throw new TypeError(`${fieldName} must not contain symbols`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function dataFields(value, fieldName) {
  if (!isPlainRecord(value)) throw new TypeError(`${fieldName} must be a plain data record`);
  return new Map(ownDataEntries(value, fieldName));
}

function immutableJsonSnapshot(
  value,
  {
    stripKeys = null,
    maxDepth = 32,
    maxNodes = 50_000,
    maxStringBytes = 2 * 1024 * 1024,
  } = {},
  state = { nodes: 0, stringBytes: 0, seen: new Set() },
  depth = 0,
) {
  if (depth > maxDepth) throw new TypeError('JSON snapshot exceeds the maximum depth');
  state.nodes += 1;
  if (state.nodes > maxNodes) throw new TypeError('JSON snapshot exceeds the maximum node count');

  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('JSON snapshot strings must not contain NUL');
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > maxStringBytes) throw new TypeError('JSON snapshot exceeds its string budget');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('JSON snapshot numbers must be finite and not negative zero');
    }
    return value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new TypeError('JSON snapshot contains an unsupported value');
  }
  if (state.seen.has(value)) throw new TypeError('JSON snapshot must not contain cycles');
  state.seen.add(value);

  try {
    if (Array.isArray(value)) {
      const entries = ownDataEntries(value, 'JSON snapshot array');
      if (entries.length !== value.length
        || entries.some(([key], index) => key !== String(index))) {
        throw new TypeError('JSON snapshot arrays must be dense indexed arrays');
      }
      return Object.freeze(entries.map(([, entry]) => immutableJsonSnapshot(
        entry,
        { stripKeys, maxDepth, maxNodes, maxStringBytes },
        state,
        depth + 1,
      )));
    }

    if (!isPlainRecord(value)) throw new TypeError('JSON snapshot objects must be plain data records');
    const output = Object.create(null);
    for (const [key, entry] of ownDataEntries(value, 'JSON snapshot object')) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`JSON snapshot contains forbidden key: ${key}`);
      if (stripKeys && stripKeys.has(key)) continue;
      output[key] = immutableJsonSnapshot(
        entry,
        { stripKeys, maxDepth, maxNodes, maxStringBytes },
        state,
        depth + 1,
      );
    }
    return Object.freeze(output);
  } finally {
    state.seen.delete(value);
  }
}

function cloneForOutput(value) {
  if (Array.isArray(value)) return value.map(cloneForOutput);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) output[key] = cloneForOutput(entry);
  return output;
}

function normalizeIdentifier(value, fieldName, maximum = 256) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\0')) {
    throw new TypeError(`${fieldName} must be a bounded non-empty string`);
  }
  return normalized;
}

function normalizeJobId(value) {
  const jobId = normalizeIdentifier(value, 'jobId');
  if (!SAFE_JOB_ID_PATTERN.test(jobId)) throw new TypeError('jobId is invalid');
  return jobId;
}

function deny(code, message = 'A operação foi rejeitada pelo coordenador.') {
  return Object.freeze({ ok: false, code, message });
}

function isSynchronousResult(value) {
  return !(value && typeof value.then === 'function');
}

function observeNativeAsyncResult(value, fieldName) {
  if (!util.types.isPromise(value)) {
    return Promise.resolve(Object.freeze({ value }));
  }
  return new Promise((resolve, reject) => {
    const onFulfilled = (result) => resolve(Object.freeze({ value: result }));
    const onRejected = () => reject(new TypeError(`${fieldName} failed`));
    try {
      Reflect.apply(Promise.prototype.then, value, [onFulfilled, onRejected]);
    } catch {
      reject(new TypeError(`${fieldName} failed`));
    }
  });
}

function callBestEffort(callback, ...args) {
  if (typeof callback !== 'function') return;
  try {
    const result = callback(...args);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Cleanup/audit hooks must never restore or disclose authority.
  }
}

function readApprovalMode(payloadFields, { mapOnly = false } = {}) {
  if (payloadFields.has('requestedMode')) {
    throw new TypeError('requestedMode is not part of the public planning contract');
  }
  if (mapOnly) return null;
  const approvalMode = payloadFields.has('approvalMode')
    ? payloadFields.get('approvalMode')
    : 'ask_each';
  if (typeof approvalMode !== 'string' || !APPROVAL_MODES.has(approvalMode)) {
    throw new TypeError('approvalMode must be ask_each or delegate_task');
  }
  return approvalMode;
}

function readProjectIdentity(projectInfo) {
  const fields = dataFields(projectInfo, 'payload.projectInfo');
  const projectId = fields.has('id') ? fields.get('id') : fields.get('projectId');
  return Object.freeze({
    projectId: normalizeIdentifier(projectId, 'payload.projectInfo.id'),
    rootPath: normalizeIdentifier(fields.get('rootPath'), 'payload.projectInfo.rootPath', 32_768),
  });
}

function normalizeAttachment(value, index) {
  const fields = dataFields(value, `job.attachments[${index}]`);
  const size = fields.has('size') ? fields.get('size') : 0;
  if (!Number.isSafeInteger(size) || size < 0 || Object.is(size, -0)) {
    throw new TypeError(`job.attachments[${index}].size is invalid`);
  }
  const output = {
    name: fields.has('name') ? String(fields.get('name')) : 'attachment',
    type: fields.has('type') ? String(fields.get('type')) : '',
    size,
    path: fields.has('path') ? String(fields.get('path')) : '',
  };
  for (const [key, entry] of Object.entries(output)) {
    if (typeof entry === 'string' && (entry.includes('\0') || entry.length > 32_768)) {
      throw new TypeError(`job.attachments[${index}].${key} is invalid`);
    }
  }
  return Object.freeze(output);
}

function normalizeJobRequest(inputFields) {
  const userMessage = inputFields.has('userMessage') ? inputFields.get('userMessage') : '';
  if (typeof userMessage !== 'string' || userMessage.length > 2 * 1024 * 1024 || userMessage.includes('\0')) {
    throw new TypeError('job.userMessage is invalid');
  }
  const attachments = inputFields.has('attachments') ? inputFields.get('attachments') : [];
  if (!Array.isArray(attachments) || attachments.length > 64) {
    throw new TypeError('job.attachments must be a bounded array');
  }
  ownDataEntries(attachments, 'job.attachments');
  const normalizedAttachments = Object.freeze(attachments.map(normalizeAttachment));
  if (!userMessage.trim() && normalizedAttachments.length === 0) {
    throw new TypeError('job request must contain a message or attachment');
  }
  return Object.freeze({ userMessage, attachments: normalizedAttachments });
}

function projectJobForPlanner(job) {
  if (!isPlainRecord(job)) throw new TypeError('Created job must be a plain data record');
  const fields = new Map(ownDataEntries(job, 'created job'));
  const projected = {};
  for (const key of ['id', 'status', 'phase', 'createdAt', 'updatedAt', 'projectId', 'rootPath', 'mode']) {
    if (fields.has(key)) projected[key] = fields.get(key);
  }
  projected.id = normalizeJobId(projected.id);
  return Object.freeze(projected);
}

function buildProjectIdentitySnapshot(untrustedProject, { projectId, rootPath }) {
  const reserved = new Set([
    ...PRIVATE_OUTPUT_KEYS,
    'id',
    'kernelId',
    'projectId',
    'rootPath',
    'root_path',
  ]);
  const sanitizedProject = immutableJsonSnapshot(untrustedProject, { stripKeys: reserved });
  const output = Object.create(null);
  for (const [key, value] of ownDataEntries(sanitizedProject, 'projectInfo')) {
    output[key] = value;
  }
  output.id = projectId;
  output.projectId = projectId;
  output.rootPath = rootPath;
  return Object.freeze(output);
}

function buildAuthorizedProjectSnapshot(untrustedProject, authorityContext) {
  const authority = dataFields(authorityContext, 'authorityContext');
  return buildProjectIdentitySnapshot(untrustedProject, {
    projectId: normalizeIdentifier(authority.get('projectId'), 'authorityContext.projectId'),
    rootPath: normalizeIdentifier(
      authority.get('canonicalRootPath'),
      'authorityContext.canonicalRootPath',
      32_768,
    ),
  });
}

function authorityBindingsMatch(left, right) {
  try {
    const leftFields = dataFields(left, 'retry binding');
    const rightFields = dataFields(right, 'record binding');
    if (leftFields.size !== AUTHORITY_BINDING_KEYS.length
      || rightFields.size !== AUTHORITY_BINDING_KEYS.length) {
      return false;
    }
    return AUTHORITY_BINDING_KEYS.every((key) => (
      leftFields.has(key)
      && rightFields.has(key)
      && leftFields.get(key) === rightFields.get(key)
    ));
  } catch {
    return false;
  }
}

function immutableAuthorityBinding(value) {
  const fields = dataFields(value, 'authority binding');
  if (fields.size !== AUTHORITY_BINDING_KEYS.length
    || !AUTHORITY_BINDING_KEYS.every((key) => fields.has(key))) {
    throw new TypeError('authority binding must contain the exact binding fields');
  }
  const binding = {
    projectId: normalizeIdentifier(fields.get('projectId'), 'authority binding.projectId'),
    canonicalRootPath: normalizeIdentifier(
      fields.get('canonicalRootPath'),
      'authority binding.canonicalRootPath',
      32_768,
    ),
    realRootPath: normalizeIdentifier(
      fields.get('realRootPath'),
      'authority binding.realRootPath',
      32_768,
    ),
    sessionId: normalizeIdentifier(fields.get('sessionId'), 'authority binding.sessionId'),
    jobId: normalizeJobId(fields.get('jobId')),
    kernelId: normalizeIdentifier(fields.get('kernelId'), 'authority binding.kernelId'),
    submissionDigest: fields.get('submissionDigest'),
  };
  if (typeof binding.submissionDigest !== 'string'
    || !DIGEST_PATTERN.test(binding.submissionDigest)) {
    throw new TypeError('authority binding.submissionDigest is invalid');
  }
  for (const key of AUTHORITY_BINDING_KEYS) {
    if (binding[key] !== fields.get(key)) {
      throw new TypeError(`authority binding.${key} must already be canonical`);
    }
  }
  return Object.freeze(binding);
}

function createPrivateExecutionContext(record) {
  const context = {
    jobId: record.jobId,
    requestedMode: record.requestedMode,
    signal: record.abortController.signal,
  };
  Object.defineProperty(context, 'authorityBinding', {
    configurable: false,
    enumerable: false,
    value: record.binding,
    writable: false,
  });
  if (record.projectRootLease) {
    Object.defineProperty(context, 'projectRootLease', {
      configurable: false,
      enumerable: false,
      value: record.projectRootLease,
      writable: false,
    });
  }
  return Object.freeze(context);
}

function jobRequestsMatch(left, right) {
  if (!left || !right || left.userMessage !== right.userMessage) return false;
  if (!Array.isArray(left.attachments)
    || !Array.isArray(right.attachments)
    || left.attachments.length !== right.attachments.length) {
    return false;
  }
  return left.attachments.every((attachment, index) => {
    const expected = right.attachments[index];
    return attachment.name === expected.name
      && attachment.type === expected.type
      && attachment.size === expected.size
      && attachment.path === expected.path;
  });
}

function createAssistantExecutionCoordinator(options = {}) {
  const fields = dataFields(options, 'coordinator options');
  const authorityService = fields.get('authorityService');
  const createAuthorizedAssistantJob = fields.get('createAuthorizedAssistantJob');
  const bindJobActionDigest = fields.get('bindJobActionDigest');
  const bindActionToProject = fields.get('bindActionToProject');
  const createActionDigest = fields.get('createActionDigest');
  const executeAction = fields.get('executeAction');
  const projectRootAuthority = fields.get('projectRootAuthority');
  const refreshProjectFromRootLease = fields.get('refreshProjectFromRootLease');
  const beforeAuthorityRelease = fields.get('beforeAuthorityRelease');
  const onPlanningFailure = fields.get('onPlanningFailure');
  const onAuthorityRevoked = fields.get('onAuthorityRevoked');
  const maxActiveJobs = fields.has('maxActiveJobs') ? fields.get('maxActiveJobs') : DEFAULT_MAX_ACTIVE_JOBS;

  if (!authorityService || typeof authorityService !== 'object') {
    throw new TypeError('authorityService is required');
  }
  for (const method of [
    'authorizeExecute',
    'authorizeRetry',
    'beginSubmission',
    'bindAction',
    'bindJob',
    'clear',
    'inspectRetryEligibility',
    'revokeExact',
    'revokeSubmission',
  ]) {
    if (typeof authorityService[method] !== 'function') {
      throw new TypeError(`authorityService.${method} is required`);
    }
  }
  const hasProjectRootAuthority = fields.has('projectRootAuthority');
  const hasProjectRootRefresh = fields.has('refreshProjectFromRootLease');
  if (hasProjectRootAuthority !== hasProjectRootRefresh) {
    throw new TypeError(
      'projectRootAuthority and refreshProjectFromRootLease must be supplied together'
    );
  }
  const projectRootAuthorityEnabled = hasProjectRootAuthority && hasProjectRootRefresh;
  let acquireProjectRootLease = null;
  let releaseProjectRootLease = null;
  if (projectRootAuthorityEnabled) {
    if (typeof authorityService.authorizeProjectRootLease !== 'function') {
      throw new TypeError('authorityService.authorizeProjectRootLease is required');
    }
    if (!projectRootAuthority || typeof projectRootAuthority !== 'object'
      || !Object.isFrozen(projectRootAuthority)) {
      throw new TypeError('projectRootAuthority must be a frozen authority object');
    }
    const rootAuthorityFields = dataFields(projectRootAuthority, 'projectRootAuthority');
    acquireProjectRootLease = rootAuthorityFields.get('acquire');
    releaseProjectRootLease = rootAuthorityFields.get('release');
    if (typeof acquireProjectRootLease !== 'function'
      || typeof releaseProjectRootLease !== 'function') {
      throw new TypeError('projectRootAuthority.acquire and release are required');
    }
    if (typeof refreshProjectFromRootLease !== 'function') {
      throw new TypeError('refreshProjectFromRootLease must be a function');
    }
  }
  for (const [name, callback] of [
    ['createAuthorizedAssistantJob', createAuthorizedAssistantJob],
    ['bindJobActionDigest', bindJobActionDigest],
    ['bindActionToProject', bindActionToProject],
    ['createActionDigest', createActionDigest],
    ['executeAction', executeAction],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} is required`);
  }
  for (const [name, callback] of [
    ['beforeAuthorityRelease', beforeAuthorityRelease],
    ['onPlanningFailure', onPlanningFailure],
    ['onAuthorityRevoked', onAuthorityRevoked],
  ]) {
    if (callback !== undefined && typeof callback !== 'function') {
      throw new TypeError(`${name} must be a function when supplied`);
    }
  }
  if (!Number.isSafeInteger(maxActiveJobs)
    || maxActiveJobs <= 0
    || maxActiveJobs > HARD_MAX_ACTIVE_JOBS) {
    throw new TypeError(`maxActiveJobs must be between 1 and ${HARD_MAX_ACTIVE_JOBS}`);
  }

  const planningScopes = new AsyncLocalStorage();
  const recordsByJobId = new Map();
  let generation = 0;
  let activePlanningScopes = 0;
  let authorityHealthy = true;
  let authorityFailureReason = null;
  let clearing = false;
  let releaseBarrierActive = false;

  function markAuthorityUnhealthy(reason) {
    if (authorityHealthy) {
      authorityHealthy = false;
      authorityFailureReason = reason;
      generation += 1;
    }
    for (const record of recordsByJobId.values()) {
      if (record.abortController && !record.abortController.signal.aborted) {
        try {
          record.abortController.abort(reason);
        } catch {
          // Generation fencing still prevents stale execution from publishing.
        }
      }
    }
  }

  function cleanupConfirmed(result, { requireRevoked = false } = {}) {
    if (!isSynchronousResult(result) || !isPlainRecord(result)) return false;
    try {
      const resultFields = dataFields(result, 'authority cleanup result');
      if (resultFields.get('ok') === true) {
        return !requireRevoked || resultFields.get('revoked') === true;
      }
      return requireRevoked
        && resultFields.get('revoked') === false
        && resultFields.get('reason') === 'lifecycle_inactive';
    } catch {
      return false;
    }
  }

  function projectRootLifecycleActive(record) {
    return Boolean(
      projectRootAuthorityEnabled
      && record
      && (record.projectRootLeaseInUse
        || record.projectRootLease
        || record.projectRootReleaseInProgress)
    );
  }

  function deferProjectRootRevocation(record, terminalStatus = 'cancelled') {
    record.rootRevocationRequested = true;
    if (!record.terminalObserved) record.terminalObserved = terminalStatus;
    if (record.abortController && !record.abortController.signal.aborted) {
      try {
        record.abortController.abort(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      } catch {
        // The retained root lease and deferred cleanup remain authoritative.
      }
    }
  }

  function validateProjectRootLease(value, record, expectedPhysicalRootIdentityDigest) {
    if (!Object.isFrozen(value)) throw new TypeError('project-root lease must be frozen');
    const leaseFields = dataFields(value, 'project-root lease');
    const leaseKeys = [
      'version',
      'leaseId',
      'jobId',
      'projectId',
      'purpose',
      'physicalRootIdentityDigest',
      'authorityDigest',
      'reader',
      'close',
    ];
    if (leaseFields.size !== leaseKeys.length
      || leaseKeys.some((key) => !leaseFields.has(key))
      || leaseFields.get('version') !== PROJECT_ROOT_AUTHORITY_LEASE_VERSION
      || typeof leaseFields.get('leaseId') !== 'string'
      || !SAFE_ROOT_LEASE_ID_PATTERN.test(leaseFields.get('leaseId'))
      || leaseFields.get('jobId') !== record.binding.jobId
      || leaseFields.get('projectId') !== record.binding.projectId
      || leaseFields.get('purpose') !== 'execution'
      || leaseFields.get('physicalRootIdentityDigest') !== expectedPhysicalRootIdentityDigest
      || typeof leaseFields.get('authorityDigest') !== 'string'
      || !DIGEST_PATTERN.test(leaseFields.get('authorityDigest'))
      || typeof leaseFields.get('close') !== 'function') {
      throw new TypeError('project-root lease does not match execution authority');
    }
    const reader = leaseFields.get('reader');
    if (!reader || typeof reader !== 'object' || !Object.isFrozen(reader)) {
      throw new TypeError('project-root reader must be frozen');
    }
    const readerFields = dataFields(reader, 'project-root reader');
    if (readerFields.size !== 4
      || readerFields.get('version') !== PROJECT_ROOT_READER_VERSION
      || typeof readerFields.get('list') !== 'function'
      || typeof readerFields.get('readFile') !== 'function'
      || typeof readerFields.get('inspectEntry') !== 'function') {
      throw new TypeError('project-root reader is invalid');
    }
    return value;
  }

  function removeLocalRecord(record, reason) {
    if (!record || recordsByJobId.get(record.jobId) !== record) return false;
    recordsByJobId.delete(record.jobId);
    record.state = 'revoked';
    record.version += 1;
    if (record.abortController && !record.abortController.signal.aborted) {
      try {
        record.abortController.abort(reason);
      } catch {
        // Local revocation and generation fencing remain authoritative here.
      }
    }
    record.abortController = null;
    callBestEffort(onAuthorityRevoked, record.jobId, reason);
    return true;
  }

  function poisonAuthority(reason) {
    markAuthorityUnhealthy(reason);
  }

  function releaseBarrierConfirmed(record, reason, terminalStatus = null) {
    if (typeof beforeAuthorityRelease !== 'function') return true;
    if (!record
      || recordsByJobId.get(record.jobId) !== record
      || releaseBarrierActive
      || record.releaseInProgress === true
      || record.releasePrepared === true) {
      markAuthorityUnhealthy(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    if (terminalStatus !== null && !TERMINAL_JOB_STATUSES.has(terminalStatus)) {
      markAuthorityUnhealthy(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }

    releaseBarrierActive = true;
    record.releaseInProgress = true;
    const observedGeneration = generation;
    let result;
    try {
      if (record.abortController && !record.abortController.signal.aborted) {
        record.abortController.abort(reason);
      }
      if (!authorityHealthy
        || generation !== observedGeneration
        || recordsByJobId.get(record.jobId) !== record
        || record.releaseInProgress !== true) {
        throw new TypeError('release abort re-entered coordinator lifecycle');
      }
      result = beforeAuthorityRelease(Object.freeze({
        binding: record.binding,
        reason,
        terminalStatus,
      }));
      if (!isSynchronousResult(result)) {
        throw new TypeError('beforeAuthorityRelease must be synchronous');
      }
      const resultFields = dataFields(result, 'beforeAuthorityRelease result');
      if (resultFields.size !== 1 || resultFields.get('ok') !== true) {
        throw new TypeError('beforeAuthorityRelease must synchronously return { ok: true }');
      }
      if (!authorityHealthy
        || generation !== observedGeneration
        || recordsByJobId.get(record.jobId) !== record
        || record.releaseInProgress !== true) {
        throw new TypeError('beforeAuthorityRelease re-entered coordinator lifecycle');
      }
    } catch {
      record.releaseInProgress = false;
      releaseBarrierActive = false;
      markAuthorityUnhealthy(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    record.releaseInProgress = false;
    releaseBarrierActive = false;
    record.releasePrepared = true;
    return true;
  }

  function revokeBindingConfirmed(binding) {
    let result;
    try {
      result = authorityService.revokeExact(binding);
    } catch {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    if (!cleanupConfirmed(result, { requireRevoked: true })) {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    return true;
  }

  function releaseProjectRootLeaseConfirmed(record) {
    if (!record.projectRootLease) return record.projectRootLeaseInUse !== true;
    if (record.projectRootReleasePromise) return record.projectRootReleasePromise;
    if (!projectRootAuthorityEnabled
      || record.projectRootLeaseInUse
      || record.projectRootReleaseInProgress) {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    const lease = record.projectRootLease;
    const observedGeneration = generation;
    record.projectRootReleaseInProgress = true;
    let raw;
    try {
      raw = Reflect.apply(releaseProjectRootLease, projectRootAuthority, [{
        binding: record.binding,
        leaseId: lease.leaseId,
      }]);
    } catch {
      record.projectRootReleaseInProgress = false;
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    const rejectRelease = () => {
      record.projectRootReleaseInProgress = false;
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    };
    record.projectRootReleasePromise = observeNativeAsyncResult(
      raw,
      'project-root release'
    ).then(({ value: result }) => {
      try {
        if (!Object.isFrozen(result)) {
          throw new TypeError('project-root release must be frozen');
        }
        const resultFields = dataFields(result, 'project-root release result');
        if (resultFields.size !== 3
          || resultFields.get('ok') !== true
          || resultFields.get('closed') !== true
          || typeof resultFields.get('idempotent') !== 'boolean') {
          throw new TypeError('project-root release was not confirmed');
        }
        if (!authorityHealthy
          || generation !== observedGeneration
          || recordsByJobId.get(record.jobId) !== record
          || record.projectRootLease !== lease
          || record.projectRootReleaseInProgress !== true) {
          throw new TypeError('project-root release re-entered coordinator lifecycle');
        }
      } catch {
        return rejectRelease();
      }
      record.projectRootReleaseInProgress = false;
      record.projectRootLease = null;
      return true;
    }, rejectRelease);
    return record.projectRootReleasePromise;
  }

  function revokeSubmissionConfirmed(submissionId) {
    let result;
    try {
      result = authorityService.revokeSubmission(submissionId);
    } catch {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    if (!cleanupConfirmed(result, { requireRevoked: true })) {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    return true;
  }

  function removeRecord(record, reason, terminalStatus = null) {
    if (!authorityHealthy || clearing) return false;
    if (record && (record.projectRootLeaseInUse || record.projectRootReleaseInProgress)) {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    if (!releaseBarrierConfirmed(record, reason, terminalStatus)) return false;
    const rootReleased = releaseProjectRootLeaseConfirmed(record);
    if (!isSynchronousResult(rootReleased) || rootReleased !== true) {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    if (!removeLocalRecord(record, reason)) return false;
    return revokeBindingConfirmed(record.binding);
  }

  function failPlanningRecord(record, reason, terminalStatus = null) {
    if (!record || recordsByJobId.get(record.jobId) !== record) return true;
    const cleaned = removeRecord(record, reason, terminalStatus);
    callBestEffort(onPlanningFailure, record.jobId, reason);
    return cleaned;
  }

  async function removeExecutionRecord(record, reason, terminalStatus = null) {
    if (!authorityHealthy || clearing) return false;
    if (record && record.projectRootLeaseInUse) {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return false;
    }
    if (!releaseBarrierConfirmed(record, reason, terminalStatus)) return false;
    if (await releaseProjectRootLeaseConfirmed(record) !== true) return false;
    if (!removeLocalRecord(record, reason)) return false;
    return revokeBindingConfirmed(record.binding);
  }

  async function failExecutionRecord(record, reason, terminalStatus = null) {
    if (!record || recordsByJobId.get(record.jobId) !== record) return true;
    const cleaned = await removeExecutionRecord(record, reason, terminalStatus);
    callBestEffort(onPlanningFailure, record.jobId, reason);
    return cleaned;
  }

  function scopeIsCurrent(scope) {
    return Boolean(
      scope
      && scope.active
      && scope.generation === generation
      && !clearing
      && (scope.mapOnly || authorityHealthy)
    );
  }

  function recordIsCurrent(record, observedGeneration, observedVersion, expectedState) {
    return generation === observedGeneration
      && authorityHealthy
      && !clearing
      && recordsByJobId.get(record.jobId) === record
      && record.version === observedVersion
      && record.state === expectedState;
  }

  function queryRetryAuthority(record, expectedState, methodName, decisionField) {
    const observedGeneration = generation;
    const observedVersion = record.version;
    if (!recordIsCurrent(record, observedGeneration, observedVersion, expectedState)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }

    let authorization;
    try {
      authorization = authorityService[methodName](record.binding);
    } catch {
      authorization = null;
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion, expectedState)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }

    try {
      if (!isSynchronousResult(authorization)) {
        throw new TypeError('retry authority query must be synchronous');
      }
      const authorizationFields = dataFields(authorization, 'retry authorization');
      if (authorizationFields.get(decisionField) !== true
        || !authorityBindingsMatch(authorizationFields.get('binding'), record.binding)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
      }
      if (decisionField === 'eligible') {
        if (typeof authorizationFields.get('due') !== 'boolean'
          || !authorizationFields.has('notBefore')) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
        }
        const notBefore = authorizationFields.get('notBefore');
        if (notBefore !== null
          && (typeof notBefore !== 'string'
            || !notBefore
            || notBefore.length > 64
            || notBefore.includes('\0')
            || !Number.isSafeInteger(Date.parse(notBefore))
            || new Date(Date.parse(notBefore)).toISOString() !== notBefore)) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
        }
      }
      const request = normalizeJobRequest(dataFields(
        authorizationFields.get('request'),
        'retry authorization request',
      ));
      if (!jobRequestsMatch(request, record.authorityRequest)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
      }
      if (!recordIsCurrent(record, observedGeneration, observedVersion, expectedState)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      return Object.freeze({
        ok: true,
        request,
        ...(decisionField === 'eligible'
          ? {
            due: authorizationFields.get('due'),
            notBefore: authorizationFields.get('notBefore'),
          }
          : {}),
      });
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
    }
  }

  function authorizeRetryForRecord(record, expectedState) {
    return queryRetryAuthority(record, expectedState, 'authorizeRetry', 'authorized');
  }

  function inspectRetryEligibilityForRecord(record, expectedState) {
    return queryRetryAuthority(record, expectedState, 'inspectRetryEligibility', 'eligible');
  }

  function retainRecordForRetry(record) {
    const authorized = inspectRetryEligibilityForRecord(record, 'planning');
    if (!authorized.ok) return authorized;
    const observedGeneration = generation;
    const observedVersion = record.version;
    if (!recordIsCurrent(record, observedGeneration, observedVersion, 'planning')) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }
    record.authorityRequest = authorized.request;
    record.state = 'retry_waiting';
    record.version += 1;
    return Object.freeze({ ok: true });
  }

  function createPlanningJob(input = {}) {
    const scope = planningScopes.getStore();
    if (!authorityHealthy || clearing) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY);
    }
    if (!scope || !scope.active || scope.generation !== generation) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.NO_PLANNING_SCOPE);
    }
    if (scope.mapOnly) return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.MAP_JOB_FORBIDDEN);
    if (scope.retrying) {
      try {
        const inputFields = dataFields(input, 'retry planning job input');
        const record = scope.record;
        if (!recordIsCurrent(record, scope.generation, scope.recordVersion, 'planning')) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
        }
        for (const key of ['jobId', 'requestedJobId']) {
          if (inputFields.has(key) && inputFields.get(key) !== record.jobId) {
            return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
          }
        }
        if (inputFields.has('projectId')
          && inputFields.get('projectId') !== scope.projectIdentity.projectId) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
        }
        if (inputFields.has('rootPath')
          && inputFields.get('rootPath') !== scope.projectIdentity.rootPath) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
        }
        if (!recordIsCurrent(record, scope.generation, scope.recordVersion, 'planning')) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
        }
        return Object.freeze({
          ok: true,
          job: record.publicJob,
          idempotent: true,
          reused: true,
        });
      } catch {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
      }
    }
    if (scope.record || scope.creatingJob) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_ALREADY_CREATED);
    }
    if (recordsByJobId.size >= maxActiveJobs) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.CAPACITY_EXCEEDED);
    }

    scope.creatingJob = true;
    let submissionId = null;
    try {
      const inputFields = dataFields(input, 'planning job input');
      const request = scope.authorityRequest;
      if (inputFields.has('projectId')
        && inputFields.get('projectId') !== scope.projectIdentity.projectId) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
      }
      if (inputFields.has('rootPath')
        && inputFields.get('rootPath') !== scope.projectIdentity.rootPath) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
      }

      const started = authorityService.beginSubmission({
        projectId: scope.projectIdentity.projectId,
        rootPath: scope.projectIdentity.rootPath,
        kernelId: scope.kernelId,
        request,
      });
      let startedFields;
      try {
        if (!isSynchronousResult(started)) throw new TypeError('beginSubmission must be synchronous');
        startedFields = dataFields(started, 'beginSubmission result');
      } catch {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_BEGIN_FAILED);
      }
      if (startedFields.get('ok') !== true) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_BEGIN_FAILED);
      }
      submissionId = startedFields.get('submissionId');
      const authorityContext = startedFields.get('authorityContext');
      const authorizedProject = buildAuthorizedProjectSnapshot(scope.project, authorityContext);
      if (!scopeIsCurrent(scope)) {
        revokeSubmissionConfirmed(submissionId);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }

      const mode = inputFields.has('mode') ? inputFields.get('mode') : 'default';
      if (typeof mode !== 'string' || !mode.trim() || mode.length > 128 || mode.includes('\0')) {
        revokeSubmissionConfirmed(submissionId);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
      }
      const created = createAuthorizedAssistantJob({
        projectId: authorizedProject.projectId,
        rootPath: authorizedProject.rootPath,
        userMessage: request.userMessage,
        attachments: request.attachments,
        mode,
        authorityContext,
      });
      let createdFields;
      try {
        if (!isSynchronousResult(created)) throw new TypeError('job creation must be synchronous');
        createdFields = dataFields(created, 'job creation result');
      } catch {
        revokeSubmissionConfirmed(submissionId);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_CREATE_FAILED);
      }
      if (createdFields.get('ok') !== true || !createdFields.get('job')) {
        revokeSubmissionConfirmed(submissionId);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_CREATE_FAILED);
      }
      const publicJob = projectJobForPlanner(createdFields.get('job'));
      if (!scopeIsCurrent(scope)) {
        revokeSubmissionConfirmed(submissionId);
        callBestEffort(onPlanningFailure, publicJob.id, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      const bound = authorityService.bindJob({ submissionId, jobId: publicJob.id });
      let boundFields;
      try {
        if (!isSynchronousResult(bound)) throw new TypeError('job binding must be synchronous');
        boundFields = dataFields(bound, 'job binding result');
      } catch {
        revokeSubmissionConfirmed(submissionId);
        callBestEffort(onPlanningFailure, publicJob.id, ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_BIND_FAILED);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_BIND_FAILED);
      }
      if (boundFields.get('authorized') !== true || !boundFields.get('binding')) {
        revokeSubmissionConfirmed(submissionId);
        callBestEffort(onPlanningFailure, publicJob.id, ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_BIND_FAILED);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_BIND_FAILED);
      }
      let binding;
      try {
        binding = immutableAuthorityBinding(boundFields.get('binding'));
      } catch {
        revokeSubmissionConfirmed(submissionId);
        callBestEffort(onPlanningFailure, publicJob.id, ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_BIND_FAILED);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_BIND_FAILED);
      }
      if (!scopeIsCurrent(scope)) {
        revokeBindingConfirmed(binding);
        callBestEffort(onPlanningFailure, publicJob.id, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      if (recordsByJobId.has(publicJob.id) || recordsByJobId.size >= maxActiveJobs) {
        revokeBindingConfirmed(binding);
        callBestEffort(onPlanningFailure, publicJob.id, ASSISTANT_EXECUTION_COORDINATOR_REASONS.CAPACITY_EXCEEDED);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.CAPACITY_EXCEEDED);
      }

      const record = {
        jobId: publicJob.id,
        binding,
        action: null,
        actionDigest: null,
        authorityRequest: request,
        project: authorizedProject,
        publicJob,
        requestedMode: scope.requestedMode,
        state: 'planning',
        terminalObserved: null,
        version: 0,
        abortController: null,
        releaseInProgress: false,
        releasePrepared: false,
        projectRootLease: null,
        projectRootLeaseInUse: false,
        projectRootReleaseInProgress: false,
        projectRootReleasePromise: null,
        rootRevocationRequested: false,
      };
      if (!scopeIsCurrent(scope)) {
        revokeBindingConfirmed(binding);
        callBestEffort(onPlanningFailure, publicJob.id, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      recordsByJobId.set(record.jobId, record);
      scope.record = record;
      return Object.freeze({ ok: true, job: publicJob });
    } catch {
      if (submissionId) revokeSubmissionConfirmed(submissionId);
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
    } finally {
      scope.creatingJob = false;
    }
  }

  function bindPlannedAction(record, proposedAction) {
    try {
      const observedGeneration = generation;
      const observedVersion = record.version;
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'planning')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      const untrustedSnapshot = immutableJsonSnapshot(proposedAction, { stripKeys: ACTION_AUTHORITY_KEYS });
      if (!isPlainRecord(untrustedSnapshot)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_BIND_FAILED);
      }
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'planning')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      const rebound = bindActionToProject(
        cloneForOutput(untrustedSnapshot),
        cloneForOutput(record.project),
        record.binding,
      );
      if (!isSynchronousResult(rebound)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_BIND_FAILED);
      }
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'planning')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      // Untrusted planner roots are removed above; only the main-process binder may
      // put roots back into the digest-bound action snapshot.
      const action = immutableJsonSnapshot(rebound, { stripKeys: BOUND_ACTION_PRIVATE_KEYS });
      if (!isPlainRecord(action)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_BIND_FAILED);
      }
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'planning')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      const expectedDigest = createActionDigest(action);
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'planning')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      if (typeof expectedDigest !== 'string' || !DIGEST_PATTERN.test(expectedDigest)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_BIND_FAILED);
      }
      const bound = authorityService.bindAction({ binding: record.binding, action });
      let boundFields;
      try {
        if (!isSynchronousResult(bound)) throw new TypeError('action binding must be synchronous');
        boundFields = dataFields(bound, 'action binding result');
      } catch {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_BIND_FAILED);
      }
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'planning')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      if (boundFields.get('authorized') !== true) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_BIND_FAILED);
      }
      if (boundFields.get('actionDigest') !== expectedDigest) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_DIGEST_MISMATCH);
      }
      const persisted = bindJobActionDigest(record.jobId, expectedDigest);
      let persistedFields;
      try {
        if (!isSynchronousResult(persisted)) throw new TypeError('action persistence must be synchronous');
        persistedFields = dataFields(persisted, 'action persistence result');
      } catch {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_PERSIST_FAILED);
      }
      if (persistedFields.get('ok') !== true) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_PERSIST_FAILED);
      }
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'planning')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      record.action = action;
      record.actionDigest = expectedDigest;
      record.state = 'ready';
      record.version += 1;
      return Object.freeze({ ok: true, action });
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_BIND_FAILED);
    }
  }

  function sanitizePlanningOutput(output, scope) {
    if (!scopeIsCurrent(scope)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }
    let snapshot;
    try {
      snapshot = immutableJsonSnapshot(output, { stripKeys: PLANNING_OUTPUT_PRIVATE_KEYS });
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.OUTPUT_INVALID);
    }
    if (!scopeIsCurrent(scope)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }
    if (!isPlainRecord(snapshot)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.OUTPUT_INVALID);
    }
    const hasAction = Object.hasOwn(snapshot, 'action') && snapshot.action !== null;
    if (scope.mapOnly) {
      if (scope.record || hasAction) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.MAP_ACTION_FORBIDDEN);
      }
      const mapOutput = cloneForOutput(snapshot);
      delete mapOutput.jobId;
      return Object.freeze(mapOutput);
    }
    if (hasAction && !scope.record) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_BIND_FAILED);
    }
    if (scope.record && scope.record.terminalObserved === 'completed') {
      const terminalRecord = scope.record;
      if (hasAction) {
        if (!removeRecord(terminalRecord, 'job_terminal_conflict', null)) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
        }
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }

      const terminalResult = cloneForOutput(snapshot);
      terminalResult.jobId = terminalRecord.jobId;
      if (!removeRecord(terminalRecord, 'job_terminal', 'completed')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      return Object.freeze(terminalResult);
    }
    if (scope.record && !hasAction) {
      const retained = retainRecordForRetry(scope.record);
      if (!retained.ok) {
        if (retained.code === ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED) return retained;
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.PLANNING_JOB_NO_ACTION);
      }
    }

    const result = cloneForOutput(snapshot);
    if (!scope.record) {
      delete result.jobId;
      return Object.freeze(result);
    }
    result.jobId = scope.record.jobId;
    if (hasAction) {
      const actionBinding = bindPlannedAction(scope.record, snapshot.action);
      if (!actionBinding.ok) return actionBinding;
      result.action = cloneForOutput(actionBinding.action);
    }
    return Object.freeze(result);
  }

  async function retry(input = {}) {
    let jobId;
    let kernelId;
    let invoke;
    try {
      const inputFields = dataFields(input, 'retry input');
      if (inputFields.size !== 3
        || !inputFields.has('jobId')
        || !inputFields.has('kernelId')
        || !inputFields.has('invoke')) {
        throw new TypeError('retry accepts jobId, kernelId, and invoke only');
      }
      jobId = normalizeJobId(inputFields.get('jobId'));
      kernelId = normalizeIdentifier(inputFields.get('kernelId'), 'kernelId');
      invoke = inputFields.get('invoke');
      if (typeof invoke !== 'function') throw new TypeError('invoke must be a function');
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
    }

    if (!authorityHealthy || clearing) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY);
    }
    if (activePlanningScopes >= maxActiveJobs) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.CAPACITY_EXCEEDED);
    }
    const record = recordsByJobId.get(jobId);
    if (!record || record.state === 'revoked') {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_NOT_FOUND);
    }
    if (record.binding.kernelId !== kernelId) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
    }
    if (record.state === 'retry_authorizing' || record.state === 'planning') {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_ALREADY_STARTED);
    }
    if (record.state !== 'retry_waiting' || record.action || record.actionDigest) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
    }

    const inspection = inspectRetryEligibilityForRecord(record, 'retry_waiting');
    if (!inspection.ok) {
      if (inspection.code === ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED) return inspection;
      if (!failPlanningRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
    }
    if (!inspection.due) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_DUE);
    }

    record.state = 'retry_authorizing';
    record.version += 1;
    const authorized = authorizeRetryForRecord(record, 'retry_authorizing');
    if (!authorized.ok) {
      if (authorized.code === ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED) return authorized;
      if (!failPlanningRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.RETRY_NOT_AUTHORIZED);
    }

    const invocationPayload = immutableJsonSnapshot({
      projectInfo: cloneForOutput(record.project),
      userMessage: authorized.request.userMessage,
      attachments: cloneForOutput(authorized.request.attachments),
      jobId: record.jobId,
    });
    record.authorityRequest = authorized.request;
    record.state = 'planning';
    record.version += 1;
    const scope = {
      active: true,
      generation,
      operation: 'retry',
      kernelId,
      mapOnly: false,
      project: record.project,
      projectIdentity: Object.freeze({
        projectId: record.project.projectId,
        rootPath: record.project.rootPath,
      }),
      authorityRequest: authorized.request,
      requestedMode: record.requestedMode,
      record,
      recordVersion: record.version,
      retrying: true,
      creatingJob: false,
      invocationPayload,
    };

    activePlanningScopes += 1;
    return planningScopes.run(scope, async () => {
      try {
        const output = await invoke(cloneForOutput(scope.invocationPayload));
        if (!scope.active
          || !recordIsCurrent(record, scope.generation, scope.recordVersion, 'planning')) {
          if (recordsByJobId.get(record.jobId) === record
            && !failPlanningRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED)) {
            return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
          }
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
        }
        const sanitized = sanitizePlanningOutput(output, scope);
        if (sanitized && sanitized.ok === false && recordsByJobId.get(record.jobId) === record) {
          if (!failPlanningRecord(record, sanitized.code)) {
            return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
          }
        }
        return sanitized;
      } catch {
        if (!recordIsCurrent(record, scope.generation, scope.recordVersion, 'planning')) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
        }
        if (!failPlanningRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.PLANNING_FAILED)) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
        }
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.PLANNING_FAILED);
      } finally {
        scope.active = false;
        activePlanningScopes -= 1;
      }
    });
  }

  async function coordinatePlanning(input = {}) {
    if (activePlanningScopes >= maxActiveJobs) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.CAPACITY_EXCEEDED);
    }
    let operation;
    let payload;
    let kernelId;
    let invoke;
    let payloadFields;
    try {
      const fields = dataFields(input, 'planning coordination input');
      operation = normalizeIdentifier(fields.get('operation'), 'operation', 64);
      if (!SUPPORTED_PLANNING_OPERATIONS.has(operation)) throw new TypeError('Unsupported planning operation');
      payload = fields.get('payload');
      payloadFields = dataFields(payload, 'planning payload');
      kernelId = normalizeIdentifier(fields.get('kernelId'), 'kernelId');
      invoke = fields.get('invoke');
      if (typeof invoke !== 'function') throw new TypeError('invoke must be a function');
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
    }

    const mapOnly = operation === 'map_message' || payloadFields.get('isMapChat') === true;
    if ((!authorityHealthy || clearing) && !mapOnly) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY);
    }
    let project = null;
    let projectIdentity = null;
    let requestedMode = null;
    let authorityRequest = null;
    let invocationPayload;
    try {
      requestedMode = readApprovalMode(payloadFields, { mapOnly });
      if (!mapOnly) {
        project = immutableJsonSnapshot(payloadFields.get('projectInfo'));
        projectIdentity = readProjectIdentity(project);
        project = buildProjectIdentitySnapshot(project, projectIdentity);
        authorityRequest = normalizeJobRequest(payloadFields);
      }
      const untrustedInvocationPayload = immutableJsonSnapshot(payload, {
        stripKeys: PLANNING_PAYLOAD_PRIVATE_KEYS,
      });
      const projectedInvocationPayload = cloneForOutput(untrustedInvocationPayload);
      if (!mapOnly) projectedInvocationPayload.projectInfo = cloneForOutput(project);
      invocationPayload = immutableJsonSnapshot(projectedInvocationPayload);
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
    }

    const scope = {
      active: true,
      generation,
      operation,
      kernelId,
      mapOnly,
      project,
      projectIdentity,
      authorityRequest,
      requestedMode,
      record: null,
      creatingJob: false,
      invocationPayload,
    };

    activePlanningScopes += 1;
    return planningScopes.run(scope, async () => {
      try {
        const output = await invoke(cloneForOutput(scope.invocationPayload));
        if (!scope.active || scope.generation !== generation) {
          if (!failPlanningRecord(scope.record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED)) {
            return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
          }
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
        }
        const sanitized = sanitizePlanningOutput(output, scope);
        if (sanitized && sanitized.ok === false && scope.record) {
          if (!failPlanningRecord(scope.record, sanitized.code)) {
            return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
          }
        }
        return sanitized;
      } catch {
        if (!failPlanningRecord(scope.record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.PLANNING_FAILED)) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
        }
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.PLANNING_FAILED);
      } finally {
        scope.active = false;
        activePlanningScopes -= 1;
      }
    });
  }

  async function finishProjectRootPreparation(record, code, terminalStatus = 'failed') {
    record.projectRootLeaseInUse = false;
    if (!authorityHealthy || !await failExecutionRecord(record, code, terminalStatus)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    return deny(code);
  }

  async function prepareProjectRootExecution(record, observedGeneration, observedVersion) {
    if (!projectRootAuthorityEnabled) {
      return Object.freeze({ ok: true, project: record.project });
    }

    let authorization;
    try {
      authorization = authorityService.authorizeProjectRootLease(record.binding);
    } catch {
      return finishProjectRootPreparation(
        record,
        ASSISTANT_EXECUTION_COORDINATOR_REASONS.PROJECT_ROOT_AUTHORITY_FAILED,
      );
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }

    let physicalRootIdentityDigest;
    try {
      if (!isSynchronousResult(authorization) || !Object.isFrozen(authorization)) {
        throw new TypeError('project-root authorization must be synchronous and frozen');
      }
      const authorizationFields = dataFields(authorization, 'project-root authorization');
      physicalRootIdentityDigest = authorizationFields.get('physicalRootIdentityDigest');
      if (authorizationFields.get('authorized') !== true
        || !authorityBindingsMatch(authorizationFields.get('binding'), record.binding)
        || typeof physicalRootIdentityDigest !== 'string'
        || !DIGEST_PATTERN.test(physicalRootIdentityDigest)) {
        throw new TypeError('project-root authorization was denied or malformed');
      }
    } catch {
      return finishProjectRootPreparation(
        record,
        ASSISTANT_EXECUTION_COORDINATOR_REASONS.PROJECT_ROOT_AUTHORITY_FAILED,
      );
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }

    record.projectRootLeaseInUse = true;
    let acquired;
    try {
      const rawAcquire = Reflect.apply(acquireProjectRootLease, projectRootAuthority, [{
        binding: record.binding,
        expectedPhysicalRootIdentityDigest: physicalRootIdentityDigest,
        purpose: 'execution',
      }]);
      ({ value: acquired } = await observeNativeAsyncResult(
        rawAcquire,
        'project-root acquire'
      ));
    } catch {
      const code = record.rootRevocationRequested
        ? ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED
        : ASSISTANT_EXECUTION_COORDINATOR_REASONS.PROJECT_ROOT_AUTHORITY_FAILED;
      return finishProjectRootPreparation(
        record,
        code,
        code === ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED ? 'cancelled' : 'failed',
      );
    }

    let acquiredFields;
    try {
      if (!Object.isFrozen(acquired)) throw new TypeError('project-root acquire must be frozen');
      acquiredFields = dataFields(acquired, 'project-root acquire result');
    } catch {
      record.projectRootLeaseInUse = false;
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    if (acquiredFields.get('ok') !== true) {
      const code = record.rootRevocationRequested
        ? ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED
        : ASSISTANT_EXECUTION_COORDINATOR_REASONS.PROJECT_ROOT_AUTHORITY_FAILED;
      return finishProjectRootPreparation(
        record,
        code,
        code === ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED ? 'cancelled' : 'failed',
      );
    }
    try {
      if (acquiredFields.size !== 3
        || typeof acquiredFields.get('idempotent') !== 'boolean') {
        throw new TypeError('project-root acquire success was malformed');
      }
      record.projectRootLease = validateProjectRootLease(
        acquiredFields.get('lease'),
        record,
        physicalRootIdentityDigest,
      );
    } catch {
      record.projectRootLeaseInUse = false;
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
      record.projectRootLeaseInUse = false;
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    if (record.rootRevocationRequested) {
      return finishProjectRootPreparation(
        record,
        ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
        'cancelled',
      );
    }

    let refreshedProject;
    try {
      const rawRefresh = refreshProjectFromRootLease(
        cloneForOutput(record.project),
        record.projectRootLease,
      );
      ({ value: refreshedProject } = await observeNativeAsyncResult(
        rawRefresh,
        'refreshProjectFromRootLease'
      ));
      if (record.rootRevocationRequested) {
        return finishProjectRootPreparation(
          record,
          ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
          'cancelled',
        );
      }
      refreshedProject = buildProjectIdentitySnapshot(refreshedProject, {
        projectId: record.project.projectId,
        rootPath: record.project.rootPath,
      });
    } catch {
      return finishProjectRootPreparation(
        record,
        ASSISTANT_EXECUTION_COORDINATOR_REASONS.PROJECT_ROOT_SCAN_FAILED,
      );
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
      record.projectRootLeaseInUse = false;
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    return Object.freeze({ ok: true, project: refreshedProject });
  }

  async function execute(input = {}) {
    let jobId;
    try {
      const fields = dataFields(input, 'execute input');
      if (fields.size !== 1 || !fields.has('jobId')) throw new TypeError('execute accepts jobId only');
      jobId = normalizeJobId(fields.get('jobId'));
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
    }
    const record = recordsByJobId.get(jobId);
    if (!authorityHealthy || clearing) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY);
    }
    if (!record || record.state === 'revoked') {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_NOT_FOUND);
    }
    if (record.state !== 'ready') {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_ALREADY_STARTED);
    }

    record.state = 'executing';
    record.version += 1;
    record.abortController = new AbortController();
    const observedGeneration = generation;
    const observedVersion = record.version;
    let authorized;
    try {
      authorized = authorityService.authorizeExecute({
        binding: record.binding,
        action: record.action,
      });
    } catch {
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      if (!failPlanningRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_NOT_AUTHORIZED)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_NOT_AUTHORIZED);
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }
    let authorizationFields;
    try {
      if (!isSynchronousResult(authorized)) throw new TypeError('authorization must be synchronous');
      authorizationFields = dataFields(authorized, 'execute authorization');
    } catch {
      if (!failPlanningRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_NOT_AUTHORIZED)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_NOT_AUTHORIZED);
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }
    if (authorizationFields.get('authorized') !== true) {
      if (!failPlanningRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_NOT_AUTHORIZED)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_NOT_AUTHORIZED);
    }
    if (authorizationFields.get('actionDigest') !== record.actionDigest) {
      if (!failPlanningRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_DIGEST_MISMATCH)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.ACTION_DIGEST_MISMATCH);
    }
    if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }

    const preparedRoot = await prepareProjectRootExecution(
      record,
      observedGeneration,
      observedVersion,
    );
    if (!preparedRoot.ok) return preparedRoot;

    try {
      const output = await executeAction(
        cloneForOutput(record.action),
        cloneForOutput(preparedRoot.project),
        createPrivateExecutionContext(record),
      );
      record.projectRootLeaseInUse = false;
      if (generation !== observedGeneration
        || recordsByJobId.get(jobId) !== record
        || record.version !== observedVersion
        || record.state !== 'executing') {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      if (!projectRootAuthorityEnabled) {
        record.state = 'executed';
        record.version += 1;
        record.abortController = null;
      }
      let publicOutput;
      try {
        const sanitized = immutableJsonSnapshot(output, {
          stripKeys: PRIVATE_EXECUTION_OUTPUT_KEYS,
        });
        publicOutput = isPlainRecord(sanitized)
          ? cloneForOutput(sanitized)
          : deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.OUTPUT_INVALID);
      } catch {
        publicOutput = deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.OUTPUT_INVALID);
      }
      const terminalStatus = record.rootRevocationRequested
        ? (record.terminalObserved || 'cancelled')
        : (record.terminalObserved
          || (isPlainRecord(publicOutput) && publicOutput.ok === false ? 'failed' : 'completed'));
      const removalReason = record.rootRevocationRequested
        ? ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED
        : 'job_terminal';
      if (!await removeExecutionRecord(record, removalReason, terminalStatus)) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      if (record.rootRevocationRequested) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      return publicOutput;
    } catch {
      record.projectRootLeaseInUse = false;
      if (!recordIsCurrent(record, observedGeneration, observedVersion, 'executing')) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      const failureCode = record.rootRevocationRequested
        ? ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED
        : ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_FAILED;
      if (!await failExecutionRecord(
        record,
        failureCode,
        record.rootRevocationRequested ? (record.terminalObserved || 'cancelled') : 'failed',
      )) {
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
      return deny(failureCode);
    }
  }

  function revokeJob(input = {}) {
    let jobId;
    try {
      const fields = dataFields(input, 'revoke input');
      if (fields.size !== 1 || !fields.has('jobId')) throw new TypeError('revoke accepts jobId only');
      jobId = normalizeJobId(fields.get('jobId'));
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
    }
    const record = recordsByJobId.get(jobId);
    if (!authorityHealthy || clearing) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY);
    }
    if (!record || TERMINAL_RECORD_STATES.has(record.state)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.JOB_NOT_FOUND);
    }
    if (record.state === 'executing' && projectRootLifecycleActive(record)) {
      deferProjectRootRevocation(record, 'cancelled');
      return Object.freeze({ ok: true, revoked: false, deferred: true });
    }
    if (!removeRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    return Object.freeze({ ok: true, revoked: true });
  }

  function onJobTerminal(input = {}) {
    let jobId;
    let status;
    try {
      const fields = dataFields(input, 'terminal job input');
      if (fields.size !== 2 || !fields.has('jobId') || !fields.has('status')) {
        throw new TypeError('onJobTerminal accepts jobId and status only');
      }
      jobId = normalizeJobId(fields.get('jobId'));
      status = normalizeIdentifier(fields.get('status'), 'terminal job status', 64);
      if (!TERMINAL_JOB_STATUSES.has(status)) throw new TypeError('terminal job status is invalid');
    } catch {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.INVALID_INPUT);
    }
    const record = recordsByJobId.get(jobId);
    if (!authorityHealthy || clearing) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY);
    }
    if (!record) return Object.freeze({ ok: true, revoked: false, idempotent: true });
    const rootExecutionActive = record.state === 'executing'
      && projectRootLifecycleActive(record);
    const deferTerminal = (record.state === 'planning' && status === 'completed')
      || (record.state === 'executing' && ['completed', 'failed', 'cancelled'].includes(status))
      || rootExecutionActive;
    if (deferTerminal) {
      if (record.terminalObserved && record.terminalObserved !== status) {
        if (rootExecutionActive) {
          deferProjectRootRevocation(record, 'cancelled');
          return Object.freeze({ ok: true, revoked: false, deferred: true, idempotent: false });
        }
        if (!removeRecord(record, 'job_terminal_conflict', null)) {
          return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
        }
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
      }
      const idempotent = record.terminalObserved === status;
      if (rootExecutionActive && ['cancelled', 'runtime_interrupted'].includes(status)) {
        deferProjectRootRevocation(record, status);
      } else {
        record.terminalObserved = status;
      }
      return Object.freeze({ ok: true, revoked: false, deferred: true, idempotent });
    }
    if (!removeRecord(record, 'job_terminal', status)) {
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    return Object.freeze({ ok: true, revoked: true, idempotent: false });
  }

  function clear() {
    if (!authorityHealthy) return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY);
    if (clearing) return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_UNHEALTHY);
    const draining = [...recordsByJobId.values()].filter(projectRootLifecycleActive);
    if (draining.length > 0) {
      for (const record of draining) deferProjectRootRevocation(record, 'cancelled');
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.EXECUTION_DRAINING);
    }
    clearing = true;
    generation += 1;
    const records = [...recordsByJobId.values()];
    for (const record of records) {
      if (!releaseBarrierConfirmed(
        record,
        ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED,
        null,
      )) {
        clearing = false;
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
    }
    for (const record of records) {
      const rootReleased = releaseProjectRootLeaseConfirmed(record);
      if (!isSynchronousResult(rootReleased) || rootReleased !== true) {
        if (isSynchronousResult(rootReleased)) {
          poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
        }
        clearing = false;
        return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      }
    }
    for (const record of records) {
      removeLocalRecord(record, ASSISTANT_EXECUTION_COORDINATOR_REASONS.REVOKED);
    }
    let result;
    try {
      if (typeof authorityService.clear !== 'function') {
        throw new TypeError('authorityService.clear is required for coordinator clear');
      }
      result = authorityService.clear();
    } catch {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      clearing = false;
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    if (!cleanupConfirmed(result)) {
      poisonAuthority(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
      clearing = false;
      return deny(ASSISTANT_EXECUTION_COORDINATOR_REASONS.AUTHORITY_CLEANUP_FAILED);
    }
    clearing = false;
    return Object.freeze({ ok: true, cleared: records.length });
  }

  function diagnostics() {
    let readyJobs = 0;
    let executingJobs = 0;
    for (const record of recordsByJobId.values()) {
      if (record.state === 'ready') readyJobs += 1;
      if (record.state === 'executing') executingJobs += 1;
    }
    return Object.freeze({
      version: ASSISTANT_EXECUTION_COORDINATOR_VERSION,
      activeJobs: recordsByJobId.size,
      activePlanningScopes,
      authorityHealthy,
      authorityFailureReason,
      readyJobs,
      executingJobs,
      maxActiveJobs,
      authorityBoundary: 'main_process_only',
      persistence: 'process_local',
    });
  }

  return Object.freeze({
    clear,
    coordinatePlanning,
    createPlanningJob,
    diagnostics,
    execute,
    onJobTerminal,
    retry,
    revokeJob,
  });
}

module.exports = {
  ASSISTANT_EXECUTION_COORDINATOR_REASONS,
  ASSISTANT_EXECUTION_COORDINATOR_VERSION,
  createAssistantExecutionCoordinator,
};
