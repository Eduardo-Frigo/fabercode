'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  createExecutionWorkspaceAcquireRequest,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  createProjectRootPhysicalIdentityDigest,
} = require('../capabilities/project_root_authority_contract');
const {
  areEquivalentPortablePaths,
} = require('../capabilities/sandbox_backend_contract');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
  classifyCanaryEditAction,
} = require('../agent_runtime/canary_edit_action_classifier');
const {
  CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  CANARY_EDIT_ADMISSION_POLICY_VERSION,
} = require('../agent_runtime/canary_edit_admission_policy');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
} = require('../agent_runtime/canary_edit_runner');
const {
  CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_SELECTOR_VERSION,
} = require('../agent_runtime/canary_rollout_selector');
const {
  assertCanaryStagingSession,
  createCanaryStagingWriteReceipt,
} = require('../agent_runtime/canary_staging_contract');
const {
  MAX_WRITE_SET_ENTRIES,
  createCanaryStagingWriteSetDigest,
} = require('../agent_runtime/canary_staging_write_set_contract');
const {
  CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
} = require('../agent_runtime/canary_transactional_staging_executor');
const {
  HARNESS_OPERATIONS,
  assertHarnessRequest,
  createHarnessResult,
} = require('../agent_runtime/harness_contracts');
const {
  createActionDigest,
} = require('./assistant_job_authority_service');

const CANARY_LOCAL_STAGING_EDITOR_ADAPTER_VERSION =
  'canary-local-staging-editor-adapter.v1';
const DEFAULT_MAX_SETTLED_SESSIONS = 4096;
const HARD_MAX_SETTLED_SESSIONS = 100_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const COPY_BUFFER_BYTES = 64 * 1024;
const TEMP_FILE_ATTEMPTS = 8;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const HASH = /^(?:sha256:)?[a-f0-9]{64}$/i;
const PROTECTED_PATH = /(?:^|\/)(?:\.git|\.faber|node_modules|\.env(?:\..*)?)(?:\/|$)/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPTION_KEYS = Object.freeze(['kernelId', 'maxSettledSessions']);
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const GRANT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'actionClassification',
  'rolloutDecision',
  'admissionDecision',
]);
const CLASSIFICATION_KEYS = Object.freeze([
  'schemaVersion',
  'classifierVersion',
  'eligible',
  'reason',
  'editProfile',
  'summary',
]);
const ROLLOUT_KEYS = Object.freeze([
  'schemaVersion',
  'selectorVersion',
  'selected',
  'reason',
  'rolloutStage',
  'thresholdBasisPoints',
  'cohortBasisPoints',
]);
const ADMISSION_KEYS = Object.freeze([
  'schemaVersion',
  'policyVersion',
  'eligible',
  'reason',
  'prerequisites',
]);
const SESSION_KEYS = Object.freeze([
  'version',
  'requestId',
  'stagingId',
  'projectId',
  'jobId',
  'checkpointDigest',
  'sourceRootPath',
  'sourceRealRootPath',
  'sourceRootIdentityDigest',
  'workspaceAuthorityDigest',
  'workspaceRootIdentityDigest',
  'workspaceRootPath',
  'workspaceRealRootPath',
]);

const CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS = Object.freeze({
  CAPACITY_EXCEEDED: 'CANARY_LOCAL_EDITOR_CAPACITY_EXCEEDED',
  INVALID_INPUT: 'CANARY_LOCAL_EDITOR_INVALID_INPUT',
  NO_CHANGES: 'CANARY_LOCAL_EDITOR_NO_CHANGES',
  PRECONDITION_FAILED: 'CANARY_LOCAL_EDITOR_PRECONDITION_FAILED',
  REPLAY_MISMATCH: 'CANARY_LOCAL_EDITOR_REPLAY_MISMATCH',
  WORKSPACE_CHANGED: 'CANARY_LOCAL_EDITOR_WORKSPACE_CHANGED',
  WRITE_FAILED: 'CANARY_LOCAL_EDITOR_WRITE_FAILED',
});

class CanaryLocalStagingEditorAdapterError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryLocalStagingEditorAdapterError';
    this.code = code;
  }
}

function editorError(code) {
  return new CanaryLocalStagingEditorAdapterError(code);
}

function fail(code) {
  throw editorError(code);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { return false; }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, allowedKeys = null, requiredKeys = null, {
  frozen = false,
  exact = false,
  preflight = true,
} = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  if (preflight) {
    const inspection = preflightDataGraph(value);
    if (!inspection.bounded || inspection.hasNativePromise
      || !inspection.inspectable) return null;
  }
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { return null; }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || allowedKeys && !allowedKeys.includes(key))
    || exact && allowedKeys && keys.length !== allowedKeys.length
    || requiredKeys && requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function ownDataValue(value, key, enumerable = null) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return null;
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { return null; }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || descriptor.value === undefined
    || enumerable !== null && descriptor.enumerable !== enumerable) return null;
  return descriptor.value;
}

function denseDataArray(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const output = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) return null;
    output.push(descriptor.value);
  }
  return output;
}

function isDeepFrozenData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || util.types.isPromise(value) || !Object.isFrozen(value)) return false;
  if (seen.has(value)) return false;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null
    && prototype !== Array.prototype) return false;
  seen.add(value);
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !isDeepFrozenData(descriptor.value, seen)) return false;
  }
  return true;
}

function bindingsMatch(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function readRequestAuthority(request, expectedKernelId) {
  const inspection = preflightDataGraph(request);
  if (!inspection.bounded || inspection.hasNativePromise || !inspection.inspectable
    || !request || typeof request !== 'object' || util.types.isProxy(request)
    || !Object.isFrozen(request)) return null;
  try {
    assertHarnessRequest(request);
  } catch {
    return null;
  }
  if (ownDataValue(request, 'operation', true) !== HARNESS_OPERATIONS.EXECUTE) {
    return null;
  }
  const action = ownDataValue(request, 'action', true);
  if (!isDeepFrozenData(action)) return null;
  const context = ownDataValue(request, 'executionContext', true);
  if (!context || typeof context !== 'object' || util.types.isProxy(context)
    || !Object.isFrozen(context)) return null;
  const rawBinding = ownDataValue(context, 'authorityBinding', false);
  const bindingFields = dataFields(
    rawBinding,
    BINDING_KEYS,
    BINDING_KEYS,
    { frozen: true, exact: true }
  );
  if (!bindingFields) return null;
  let binding;
  try {
    binding = createCapabilityDelegationBinding(Object.fromEntries(
      BINDING_KEYS.map((key) => [key, bindingFields.get(key)])
    ));
  } catch {
    return null;
  }
  if (binding.kernelId !== expectedKernelId
    || ownDataValue(context, 'jobId', true) !== binding.jobId) return null;
  const projectInfo = ownDataValue(request, 'projectInfo', true);
  if (!projectInfo || typeof projectInfo !== 'object'
    || util.types.isProxy(projectInfo) || !Object.isFrozen(projectInfo)) return null;
  const projectId = ownDataValue(projectInfo, 'id', true)
    || ownDataValue(projectInfo, 'projectId', true);
  const projectIdAlias = ownDataValue(projectInfo, 'projectId', true);
  const rootPath = ownDataValue(projectInfo, 'rootPath', true);
  if (projectId !== binding.projectId
    || projectIdAlias !== null && projectIdAlias !== binding.projectId
    || !areEquivalentPortablePaths(rootPath, binding.canonicalRootPath)) return null;
  return Object.freeze({ action, binding });
}

function validGrant(value, requestId, action) {
  const fields = dataFields(value, GRANT_KEYS, GRANT_KEYS, {
    frozen: true,
    exact: true,
  });
  const classification = fields && dataFields(
    fields.get('actionClassification'),
    CLASSIFICATION_KEYS,
    CLASSIFICATION_KEYS,
    { frozen: true, exact: true }
  );
  const rollout = fields && dataFields(
    fields.get('rolloutDecision'),
    ROLLOUT_KEYS,
    ROLLOUT_KEYS,
    { frozen: true, exact: true }
  );
  const admission = fields && dataFields(
    fields.get('admissionDecision'),
    ADMISSION_KEYS,
    ADMISSION_KEYS,
    { frozen: true, exact: true }
  );
  if (!fields || !classification || !rollout || !admission
    || fields.get('schemaVersion')
      !== CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION
    || fields.get('requestId') !== requestId
    || classification.get('schemaVersion')
      !== CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION
    || classification.get('classifierVersion')
      !== CANARY_EDIT_ACTION_CLASSIFIER_VERSION
    || classification.get('eligible') !== true
    || rollout.get('schemaVersion') !== CANARY_ROLLOUT_DECISION_SCHEMA_VERSION
    || rollout.get('selectorVersion') !== CANARY_ROLLOUT_SELECTOR_VERSION
    || rollout.get('selected') !== true
    || admission.get('schemaVersion')
      !== CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION
    || admission.get('policyVersion') !== CANARY_EDIT_ADMISSION_POLICY_VERSION
    || admission.get('eligible') !== true) return false;
  try {
    const expected = classifyCanaryEditAction(action);
    return expected.eligible === true
      && canonicalSha256Digest(fields.get('actionClassification'))
        === canonicalSha256Digest(expected);
  } catch {
    return false;
  }
}

function normalizeSession(value, requestId, binding) {
  const fields = dataFields(value, SESSION_KEYS, SESSION_KEYS, {
    frozen: true,
    exact: true,
  });
  if (!fields || fields.get('requestId') !== requestId
    || fields.get('projectId') !== binding.projectId
    || fields.get('jobId') !== binding.jobId) return null;
  try {
    const workspaceRequest = createExecutionWorkspaceAcquireRequest({
      leaseId: fields.get('stagingId'),
      binding,
      sourceRootIdentityDigest: fields.get('sourceRootIdentityDigest'),
    });
    const checkpoint = Object.freeze({
      checkpointDigest: fields.get('checkpointDigest'),
      checkpointVerified: true,
      projectId: binding.projectId,
      canonicalRootPath: binding.canonicalRootPath,
      jobId: binding.jobId,
    });
    return assertCanaryStagingSession(value, {
      requestId,
      checkpoint,
      workspaceRequest,
    });
  } catch {
    return null;
  }
}

function canonicalRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > 4096) return null;
  const portable = value.replace(/\\/g, '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)
    || portable.startsWith('//') || PROTECTED_PATH.test(portable)) return null;
  return portable.split('/').some((component) => !component
    || component === '.' || component === '..') ? null : portable;
}

function normalizedActionType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,79}$/.test(normalized) ? normalized : null;
}

function expectedHash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) return null;
  return value.toLowerCase().startsWith('sha256:')
    ? value.toLowerCase()
    : `sha256:${value.toLowerCase()}`;
}

function patchOperation(fields, names = {}) {
  const relativePath = canonicalRelativePath(
    fields.get(names.path || 'targetFile')
  );
  const hash = expectedHash(fields.get(names.hash || 'previousContentHash'));
  const content = fields.get(names.content || 'nextContent');
  if (!relativePath || !hash || typeof content !== 'string'
    || content.includes('\0')) return null;
  return Object.freeze({
    type: 'patch',
    path: relativePath,
    expectedHash: hash,
    content,
  });
}

function batchOperations(value) {
  const operations = denseDataArray(value);
  if (!operations || operations.length < 1
    || operations.length > MAX_WRITE_SET_ENTRIES) return null;
  const output = [];
  for (const operation of operations) {
    const fields = dataFields(
      operation,
      ['op', 'path', 'content'],
      ['op', 'path'],
      { frozen: true }
    );
    const type = fields && normalizedActionType(fields.get('op'));
    const relativePath = fields && canonicalRelativePath(fields.get('path'));
    if (!fields || !relativePath
      || !['mkdir', 'write_file', 'append_file'].includes(type)) return null;
    const content = fields.get('content');
    if (type === 'mkdir') {
      if (fields.has('content')) return null;
    } else if (typeof content !== 'string' || content.includes('\0')) {
      return null;
    }
    output.push(Object.freeze({
      type,
      path: relativePath,
      content: type === 'mkdir' ? null : content,
    }));
  }
  return Object.freeze(output);
}

function actionPlan(action, session) {
  const fields = dataFields(action, null, null, { frozen: true });
  if (!fields) return null;
  const requestedRoot = fields.get('rootPath');
  if (requestedRoot !== undefined && requestedRoot !== null
    && !areEquivalentPortablePaths(requestedRoot, session.sourceRootPath)) return null;
  if (fields.has('executionCommand')) {
    const command = dataFields(
      fields.get('executionCommand'),
      ['protocol', 'task_type', 'root_path', 'target_file',
        'previous_content_hash', 'next_content', 'operations'],
      ['task_type'],
      { frozen: true }
    );
    if (!command) return null;
    const commandRoot = command.get('root_path');
    if (commandRoot !== undefined && commandRoot !== null
      && !areEquivalentPortablePaths(commandRoot, session.sourceRootPath)) return null;
    const type = normalizedActionType(command.get('task_type'));
    if (type === 'apply_file_patch') {
      const operation = patchOperation(command, {
        path: 'target_file',
        hash: 'previous_content_hash',
        content: 'next_content',
      });
      return operation ? Object.freeze([operation]) : null;
    }
    if (type === 'execute_operation_batch') {
      return batchOperations(command.get('operations'));
    }
    return null;
  }
  const type = normalizedActionType(fields.get('type'));
  if (type === 'apply_file_patch') {
    const operation = patchOperation(fields);
    return operation ? Object.freeze([operation]) : null;
  }
  if (type === 'edit_file_fuzzy') {
    const relativePath = canonicalRelativePath(fields.get('targetFile'));
    const targetContent = fields.get('targetContent');
    const replacementContent = fields.get('replacementContent');
    if (!relativePath || typeof targetContent !== 'string' || !targetContent
      || targetContent.includes('\0') || typeof replacementContent !== 'string'
      || replacementContent.includes('\0')) return null;
    return Object.freeze([Object.freeze({
      type: 'fuzzy',
      path: relativePath,
      targetContent,
      replacementContent,
    })]);
  }
  if (type === 'operation_batch' || type === 'execute_operation_batch') {
    return batchOperations(fields.get('operations'));
  }
  return null;
}

function normalizeExecution(request, grant, sessionValue, kernelId) {
  const authority = readRequestAuthority(request, kernelId);
  const requestId = ownDataValue(request, 'requestId', true);
  if (!authority || typeof requestId !== 'string'
    || !validGrant(grant, requestId, authority.action)) {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.INVALID_INPUT);
  }
  const session = normalizeSession(sessionValue, requestId, authority.binding);
  const plan = session && actionPlan(authority.action, session);
  if (!session || !plan) {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.INVALID_INPUT);
  }
  let actionDigest;
  try { actionDigest = createActionDigest(authority.action); } catch {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.INVALID_INPUT);
  }
  return Object.freeze({
    actionDigest,
    binding: authority.binding,
    fingerprint: canonicalSha256Digest({
      schemaVersion: 'canary-local-editor-execution.v1',
      requestId,
      actionDigest,
      stagingId: session.stagingId,
      checkpointDigest: session.checkpointDigest,
      workspaceAuthorityDigest: session.workspaceAuthorityDigest,
      workspaceRootIdentityDigest: session.workspaceRootIdentityDigest,
    }),
    plan,
    request,
    requestId,
    session,
  });
}

function errorCode(error) {
  if (!error || typeof error !== 'object' || util.types.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : null;
}

function statKind(stat) {
  try {
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isDirectory()) return 'directory';
    if (stat.isFile()) return 'file';
  } catch {
    return 'unknown';
  }
  return 'other';
}

function statSnapshot(stat) {
  try {
    return Object.freeze({
      kind: statKind(stat),
      device: String(stat.dev),
      inode: String(stat.ino),
      mode: String(stat.mode),
      size: String(stat.size),
      modifiedNanoseconds: String(stat.mtimeNs),
      changedNanoseconds: String(stat.ctimeNs),
    });
  } catch {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.kind === right.kind
    && left.device === right.device && left.inode === right.inode);
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.mode === right.mode && left.size === right.size
    && left.modifiedNanoseconds === right.modifiedNanoseconds
    && left.changedNanoseconds === right.changedNanoseconds;
}

function localPathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return path.sep === '\\' ? normalized.toLowerCase() : normalized;
}

function sameLocalPath(left, right) {
  return localPathKey(left) === localPathKey(right);
}

function isStrictlyInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return Boolean(relative) && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function physicalIdentityDigest(entry, target) {
  try {
    return createProjectRootPhysicalIdentityDigest({
      device: target.device,
      inode: target.inode,
      entryDevice: entry.device,
      entryInode: entry.inode,
      entryType: entry.kind,
    });
  } catch {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
}

function captureWorkspaceRoot(session) {
  try {
    const entryBefore = statSnapshot(fs.lstatSync(
      session.workspaceRootPath,
      { bigint: true }
    ));
    const targetBefore = statSnapshot(fs.statSync(
      session.workspaceRootPath,
      { bigint: true }
    ));
    const realPath = fs.realpathSync(session.workspaceRootPath);
    const entryAfter = statSnapshot(fs.lstatSync(
      session.workspaceRootPath,
      { bigint: true }
    ));
    const targetAfter = statSnapshot(fs.statSync(
      session.workspaceRootPath,
      { bigint: true }
    ));
    if (entryAfter.kind !== 'directory' || targetAfter.kind !== 'directory'
      || !sameSnapshot(entryBefore, entryAfter)
      || !sameSnapshot(targetBefore, targetAfter)
      || !sameIdentity(entryAfter, targetAfter)
      || !sameLocalPath(realPath, session.workspaceRealRootPath)
      || physicalIdentityDigest(entryAfter, targetAfter)
        !== session.workspaceRootIdentityDigest) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
    }
    return Object.freeze({
      path: session.workspaceRootPath,
      realPath,
      identity: entryAfter,
      identityDigest: session.workspaceRootIdentityDigest,
    });
  } catch (error) {
    if (error instanceof CanaryLocalStagingEditorAdapterError) throw error;
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
}

function assertWorkspaceRoot(root) {
  try {
    const entry = statSnapshot(fs.lstatSync(root.path, { bigint: true }));
    const target = statSnapshot(fs.statSync(root.path, { bigint: true }));
    if (entry.kind !== 'directory' || target.kind !== 'directory'
      || !sameIdentity(entry, root.identity) || !sameIdentity(entry, target)
      || !sameLocalPath(fs.realpathSync(root.path), root.realPath)
      || physicalIdentityDigest(entry, target) !== root.identityDigest) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
    }
  } catch (error) {
    if (error instanceof CanaryLocalStagingEditorAdapterError) throw error;
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
}

function lstatOrNull(location) {
  try { return statSnapshot(fs.lstatSync(location, { bigint: true })); } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
}

function locateTarget(root, relativePath) {
  assertWorkspaceRoot(root);
  const components = relativePath.split('/');
  let parentPath = root.path;
  let parentIdentity = root.identity;
  for (let index = 0; index < components.length - 1; index += 1) {
    const candidate = path.join(parentPath, components[index]);
    if (!isStrictlyInside(root.path, candidate)) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    const before = lstatOrNull(candidate);
    if (!before || before.kind !== 'directory') {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    let realPath;
    try { realPath = fs.realpathSync(candidate); } catch {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    const after = lstatOrNull(candidate);
    if (!after || !sameSnapshot(before, after)
      || !isStrictlyInside(root.realPath, realPath)) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    parentPath = candidate;
    parentIdentity = after;
  }
  const targetPath = path.join(parentPath, components[components.length - 1]);
  if (!isStrictlyInside(root.path, targetPath)) {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
  }
  const target = lstatOrNull(targetPath);
  assertWorkspaceRoot(root);
  return Object.freeze({
    parentPath,
    parentIdentity,
    targetPath,
    target,
  });
}

function permissionMode(snapshot) {
  try { return Number(BigInt(snapshot.mode) & 0o777n); } catch {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
}

function bytesDigest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function readAnchoredFile(root, relativePath) {
  const located = locateTarget(root, relativePath);
  if (!located.target || located.target.kind !== 'file') {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
  }
  if (typeof fs.constants.O_NOFOLLOW !== 'number') {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      located.targetPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    );
    const opened = statSnapshot(fs.fstatSync(descriptor, { bigint: true }));
    const size = Number(BigInt(opened.size));
    if (opened.kind !== 'file' || !sameSnapshot(opened, located.target)
      || !Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (!Number.isSafeInteger(read) || read <= 0) {
        fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
      }
      offset += read;
    }
    const finalHandle = statSnapshot(fs.fstatSync(descriptor, { bigint: true }));
    const finalPath = lstatOrNull(located.targetPath);
    if (!sameSnapshot(opened, finalHandle) || !finalPath
      || !sameSnapshot(opened, finalPath)) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    assertWorkspaceRoot(root);
    return Object.freeze({
      bytes,
      contentDigest: bytesDigest(bytes),
      mode: permissionMode(opened),
      snapshot: opened,
    });
  } catch (error) {
    if (error instanceof CanaryLocalStagingEditorAdapterError) throw error;
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* staging will be discarded */ }
    }
  }
}

function targetStillMatches(location, expected) {
  const current = lstatOrNull(location);
  return expected === null ? current === null
    : current !== null && sameSnapshot(current, expected);
}

function removeTemporaryFile(root, location, parentPath, parentIdentity) {
  assertWorkspaceRoot(root);
  const parent = lstatOrNull(parentPath);
  if (!parent || parent.kind !== 'directory'
    || !sameIdentity(parent, parentIdentity)) {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
  const current = lstatOrNull(location);
  if (!current) return;
  if (current.kind !== 'file') {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
  }
  try { fs.unlinkSync(location); } catch {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
  }
}

function atomicWrite(root, relativePath, bytes, expected, mode) {
  const located = locateTarget(root, relativePath);
  if (!targetStillMatches(located.targetPath, expected)
    || located.target && located.target.kind !== 'file') {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
  }
  if (typeof fs.constants.O_NOFOLLOW !== 'number') {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
  }
  let descriptor = null;
  let temporaryPath = null;
  try {
    for (let attempt = 0; attempt < TEMP_FILE_ATTEMPTS; attempt += 1) {
      temporaryPath = path.join(
        located.parentPath,
        `.faber-canary-${crypto.randomBytes(12).toString('hex')}.tmp`
      );
      try {
        descriptor = fs.openSync(
          temporaryPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT
            | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
          0o600
        );
        break;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
    }
    if (descriptor === null || !temporaryPath) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
    }
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null
      );
      if (!Number.isSafeInteger(written) || written <= 0) {
        fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
      }
      offset += written;
    }
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    assertWorkspaceRoot(root);
    const currentParent = lstatOrNull(located.parentPath);
    if (!currentParent || !sameIdentity(currentParent, located.parentIdentity)
      || !targetStillMatches(located.targetPath, expected)) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WORKSPACE_CHANGED);
    }
    fs.renameSync(temporaryPath, located.targetPath);
    temporaryPath = null;
    const written = readAnchoredFile(root, relativePath);
    if (written.contentDigest !== bytesDigest(bytes) || written.mode !== mode) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
    }
    return written;
  } catch (error) {
    if (error instanceof CanaryLocalStagingEditorAdapterError) throw error;
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* staging will be discarded */ }
    }
    if (temporaryPath) removeTemporaryFile(
      root,
      temporaryPath,
      located.parentPath,
      located.parentIdentity
    );
  }
}

function createDirectory(root, relativePath) {
  const located = locateTarget(root, relativePath);
  if (located.target) {
    if (located.target.kind !== 'directory') {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    return false;
  }
  try {
    fs.mkdirSync(located.targetPath, { mode: 0o700 });
  } catch {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
  }
  const created = locateTarget(root, relativePath).target;
  if (!created || created.kind !== 'directory') {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
  }
  return true;
}

function sameBytes(left, right) {
  return left.length === right.length && left.equals(right);
}

function applyFileBytes(root, relativePath, nextBytes, { requireExisting = false } = {}) {
  const located = locateTarget(root, relativePath);
  if (located.target && located.target.kind !== 'file'
    || requireExisting && !located.target) {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
  }
  const existing = located.target ? readAnchoredFile(root, relativePath) : null;
  if (existing && sameBytes(existing.bytes, nextBytes)) return false;
  atomicWrite(
    root,
    relativePath,
    nextBytes,
    existing ? existing.snapshot : null,
    existing ? existing.mode : 0o600
  );
  return true;
}

function applyOperation(root, operation) {
  if (operation.type === 'mkdir') return createDirectory(root, operation.path);
  if (operation.type === 'patch') {
    const existing = readAnchoredFile(root, operation.path);
    if (existing.contentDigest !== operation.expectedHash) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    const nextBytes = Buffer.from(operation.content, 'utf8');
    if (sameBytes(existing.bytes, nextBytes)) return false;
    atomicWrite(
      root,
      operation.path,
      nextBytes,
      existing.snapshot,
      existing.mode
    );
    return true;
  }
  if (operation.type === 'fuzzy') {
    const existing = readAnchoredFile(root, operation.path);
    const text = existing.bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(existing.bytes)) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    const first = text.indexOf(operation.targetContent);
    if (first < 0 || first !== text.lastIndexOf(operation.targetContent)) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    const next = `${text.slice(0, first)}${operation.replacementContent}`
      + text.slice(first + operation.targetContent.length);
    const nextBytes = Buffer.from(next, 'utf8');
    if (sameBytes(existing.bytes, nextBytes)) return false;
    atomicWrite(
      root,
      operation.path,
      nextBytes,
      existing.snapshot,
      existing.mode
    );
    return true;
  }
  if (operation.type === 'write_file') {
    return applyFileBytes(root, operation.path, Buffer.from(operation.content, 'utf8'));
  }
  if (operation.type === 'append_file') {
    const located = locateTarget(root, operation.path);
    if (located.target && located.target.kind !== 'file') {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    const existing = located.target ? readAnchoredFile(root, operation.path) : null;
    const appended = Buffer.from(operation.content, 'utf8');
    const finalBytes = existing
      ? Buffer.concat([existing.bytes, appended])
      : appended;
    if (finalBytes.length > MAX_FILE_BYTES) {
      fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.PRECONDITION_FAILED);
    }
    if (existing && appended.length === 0) return false;
    atomicWrite(
      root,
      operation.path,
      finalBytes,
      existing ? existing.snapshot : null,
      existing ? existing.mode : 0o600
    );
    return true;
  }
  fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.INVALID_INPUT);
}

function writeSetEntry(root, relativePath) {
  const located = locateTarget(root, relativePath);
  if (!located.target) {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
  }
  if (located.target.kind === 'directory') {
    return Object.freeze({
      path: relativePath,
      kind: 'directory',
      mode: permissionMode(located.target),
      bytes: null,
      contentDigest: null,
    });
  }
  if (located.target.kind === 'file') {
    const file = readAnchoredFile(root, relativePath);
    return Object.freeze({
      path: relativePath,
      kind: 'file',
      mode: file.mode,
      bytes: file.bytes.length,
      contentDigest: file.contentDigest,
    });
  }
  fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
}

function performExecution(context, kernelId) {
  const root = captureWorkspaceRoot(context.session);
  const changed = new Set();
  for (const operation of context.plan) {
    if (applyOperation(root, operation)) changed.add(operation.path);
  }
  if (changed.size < 1) {
    fail(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.NO_CHANGES);
  }
  const changedPaths = Object.freeze([...changed].sort());
  const entries = Object.freeze(changedPaths.map((relativePath) => (
    writeSetEntry(root, relativePath)
  )));
  assertWorkspaceRoot(root);
  const writeSetDigest = createCanaryStagingWriteSetDigest(entries);
  const writeReceipt = createCanaryStagingWriteReceipt({
    session: context.session,
    actionDigest: context.actionDigest,
    writeSetDigest,
    changedPaths,
    stagingWritten: true,
    sourceMutated: false,
  });
  const output = Object.freeze({
    status: 'completed',
    mutationScope: 'staging',
    changedPaths,
    writeSetDigest,
  });
  const result = createHarnessResult({
    requestId: context.requestId,
    operation: HARNESS_OPERATIONS.EXECUTE,
    kernelId,
    output,
    diagnostics: null,
  });
  return Object.freeze({
    schemaVersion: CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
    ok: true,
    writeReceipt,
    result,
  });
}

function normalizeOptions(options) {
  const fields = dataFields(options, OPTION_KEYS, ['kernelId']);
  const kernelId = fields && fields.get('kernelId');
  const maxSettledSessions = fields && fields.has('maxSettledSessions')
    ? fields.get('maxSettledSessions')
    : DEFAULT_MAX_SETTLED_SESSIONS;
  if (!fields || typeof kernelId !== 'string' || !SAFE_IDENTIFIER.test(kernelId)
    || !Number.isSafeInteger(maxSettledSessions) || maxSettledSessions < 1
    || maxSettledSessions > HARD_MAX_SETTLED_SESSIONS) {
    throw new TypeError('Invalid canary local staging editor options or kernelId');
  }
  return Object.freeze({ kernelId, maxSettledSessions });
}

function createCanaryLocalStagingEditorAdapter(options = {}) {
  const config = normalizeOptions(options);
  const settlements = new Map();

  function diagnostics() {
    return Object.freeze({
      version: CANARY_LOCAL_STAGING_EDITOR_ADAPTER_VERSION,
      kernelId: config.kernelId,
      workspaceMode: 'provided_session_only',
      sourceMutation: 'forbidden',
      settlementMode: 'terminal',
      networkMode: 'disabled',
      installMode: 'disabled',
    });
  }

  function execute(request, grant, sessionValue) {
    let context;
    try {
      context = normalizeExecution(request, grant, sessionValue, config.kernelId);
    } catch (error) {
      return Promise.reject(error instanceof CanaryLocalStagingEditorAdapterError
        ? error
        : editorError(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.INVALID_INPUT));
    }
    const existing = settlements.get(context.session.stagingId);
    if (existing) {
      return existing.fingerprint === context.fingerprint
        ? existing.promise
        : Promise.reject(editorError(
          CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.REPLAY_MISMATCH
        ));
    }
    if (settlements.size >= config.maxSettledSessions) {
      return Promise.reject(editorError(
        CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.CAPACITY_EXCEEDED
      ));
    }
    const promise = Promise.resolve().then(() => {
      try {
        return performExecution(context, config.kernelId);
      } catch (error) {
        if (error instanceof CanaryLocalStagingEditorAdapterError) throw error;
        throw editorError(CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS.WRITE_FAILED);
      }
    });
    settlements.set(context.session.stagingId, Object.freeze({
      fingerprint: context.fingerprint,
      promise,
    }));
    return promise;
  }

  return Object.freeze({
    version: CANARY_LOCAL_STAGING_EDITOR_ADAPTER_VERSION,
    kernelId: config.kernelId,
    execute,
    diagnostics,
  });
}

module.exports = {
  CANARY_LOCAL_STAGING_EDITOR_ADAPTER_REASONS,
  CANARY_LOCAL_STAGING_EDITOR_ADAPTER_VERSION,
  CanaryLocalStagingEditorAdapterError,
  createCanaryLocalStagingEditorAdapter,
};
