'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  assertExecutionWorkspaceAcquireRequest,
  assertExecutionWorkspaceLease,
} = require('../capabilities/execution_workspace_contract');
const {
  MAX_LIST_ENTRIES,
  MAX_READ_BYTES,
  PROJECT_ROOT_ENTRY_KINDS,
  assertProjectRootAuthorityLease,
  assertProjectRootEntryInspectionResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
} = require('../capabilities/project_root_authority_contract');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
  classifyCanaryEditAction,
} = require('../agent_runtime/canary_edit_action_classifier');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
} = require('../agent_runtime/canary_edit_runner');
const {
  CANARY_SOURCE_BRANCH_STATE_SCHEMA_VERSION,
  CANARY_SOURCE_CHECKPOINT_SCHEMA_VERSION,
  CANARY_SOURCE_INDEX_STATE_SCHEMA_VERSION,
  CANARY_SOURCE_SNAPSHOT_PROVIDER_DIAGNOSTICS,
  CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
  CANARY_SOURCE_TREE_SCHEMA_VERSION,
  CANARY_SOURCE_USER_STATE_SCHEMA_VERSION,
} = require('../agent_runtime/canary_source_snapshot_contract');
const {
  HARNESS_OPERATIONS,
  HARNESS_REQUEST_SCHEMA_VERSION,
} = require('../agent_runtime/harness_contracts');
const CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS = Object.freeze({
  GIT_STATE_UNSAFE: 'CANARY_SOURCE_SNAPSHOT_GIT_STATE_UNSAFE',
  INVALID_INPUT: 'CANARY_SOURCE_SNAPSHOT_INVALID_INPUT',
  PRECONDITION_FAILED: 'CANARY_SOURCE_SNAPSHOT_PRECONDITION_FAILED',
  READER_FAILED: 'CANARY_SOURCE_SNAPSHOT_READER_FAILED',
  TREE_LIMIT_EXCEEDED: 'CANARY_SOURCE_SNAPSHOT_TREE_LIMIT_EXCEEDED',
});

const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_ENTRIES_PER_DIRECTORY = 10_000;
const HARD_MAX_ENTRIES = 250_000;
const SMALL_GIT_FILE_BYTES = 4096;
const SAFE_REF = /^refs\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const SAFE_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const INPUT_KEYS = Object.freeze([
  'request',
  'grant',
  'binding',
  'actionDigest',
  'rootLease',
  'workspaceRequest',
  'workspaceLease',
]);
const OPTION_KEYS = Object.freeze(['maxEntries', 'maxEntriesPerDirectory']);
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
const GIT_TRANSITION_MARKERS = Object.freeze([
  '.git/index.lock',
  '.git/HEAD.lock',
  '.git/MERGE_HEAD',
  '.git/CHERRY_PICK_HEAD',
  '.git/REVERT_HEAD',
  '.git/BISECT_LOG',
  '.git/rebase-apply',
  '.git/rebase-merge',
  '.git/sequencer',
  '.git/commondir',
]);

class CanarySourceSnapshotProviderError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanarySourceSnapshotProviderError';
    this.code = code;
  }
}

function providerError(code) {
  return new CanarySourceSnapshotProviderError(code);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, allowedKeys = null, requiredKeys = null, {
  frozen = false,
  exact = false,
} = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key)
    || allowedKeys && !allowedKeys.includes(key))
    || exact && allowedKeys && keys.length !== allowedKeys.length
    || requiredKeys && requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
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
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
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

function bindingsMatch(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function normalizeOptions(options) {
  const fields = dataFields(options, OPTION_KEYS, [], { exact: false });
  if (!fields) throw new TypeError('Invalid canary source snapshot provider options');
  const maxEntries = fields.has('maxEntries')
    ? fields.get('maxEntries')
    : DEFAULT_MAX_ENTRIES;
  const maxEntriesPerDirectory = fields.has('maxEntriesPerDirectory')
    ? fields.get('maxEntriesPerDirectory')
    : DEFAULT_MAX_ENTRIES_PER_DIRECTORY;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1
    || maxEntries > HARD_MAX_ENTRIES
    || !Number.isSafeInteger(maxEntriesPerDirectory)
    || maxEntriesPerDirectory < 1
    || maxEntriesPerDirectory > MAX_LIST_ENTRIES) {
    throw new TypeError('Canary source snapshot maxEntries options are invalid');
  }
  return Object.freeze({ maxEntries, maxEntriesPerDirectory });
}

function canonicalBinding(value) {
  const fields = dataFields(value, BINDING_KEYS, BINDING_KEYS, {
    frozen: true,
    exact: true,
  });
  if (!fields) return null;
  const snapshot = Object.fromEntries(
    BINDING_KEYS.map((key) => [key, fields.get(key)])
  );
  try {
    return createCapabilityDelegationBinding(snapshot);
  } catch {
    return null;
  }
}

function requestAuthorityMatches(request, binding) {
  const context = ownDataValue(request, 'executionContext', true);
  if (!context || typeof context !== 'object' || !Object.isFrozen(context)
    || util.types.isProxy(context)
    || ownDataValue(context, 'jobId', true) !== binding.jobId) return false;
  const requestBinding = canonicalBinding(
    ownDataValue(context, 'authorityBinding', false)
  );
  if (!requestBinding || !bindingsMatch(requestBinding, binding)) return false;
  const projectInfo = ownDataValue(request, 'projectInfo', true);
  if (!projectInfo || typeof projectInfo !== 'object'
    || !Object.isFrozen(projectInfo) || util.types.isProxy(projectInfo)) return false;
  const projectId = ownDataValue(projectInfo, 'id', true)
    || ownDataValue(projectInfo, 'projectId', true);
  const projectIdAlias = ownDataValue(projectInfo, 'projectId', true);
  const rootPath = ownDataValue(projectInfo, 'rootPath', true);
  const canonicalRoot = binding.canonicalRootPath;
  return projectId === binding.projectId
    && (projectIdAlias === null || projectIdAlias === binding.projectId)
    && rootPath === canonicalRoot;
}

function classificationMatches(value, action) {
  const fields = dataFields(
    value,
    CLASSIFICATION_KEYS,
    CLASSIFICATION_KEYS,
    { frozen: true, exact: true }
  );
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION
    || fields.get('classifierVersion') !== CANARY_EDIT_ACTION_CLASSIFIER_VERSION
    || fields.get('eligible') !== true) return false;
  let expected;
  try {
    expected = classifyCanaryEditAction(action);
    return expected.eligible === true
      && canonicalSha256Digest(value) === canonicalSha256Digest(expected);
  } catch {
    return false;
  }
}

function normalizeGrant(value, requestId, action) {
  const fields = dataFields(value, GRANT_KEYS, GRANT_KEYS, {
    frozen: true,
    exact: true,
  });
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION
    || fields.get('requestId') !== requestId
    || !classificationMatches(fields.get('actionClassification'), action)) return null;
  return Object.freeze({ classification: fields.get('actionClassification') });
}

function normalizeInput(value) {
  const fields = dataFields(value, INPUT_KEYS, INPUT_KEYS, {
    frozen: true,
    exact: true,
  });
  if (!fields) return null;
  const request = fields.get('request');
  const requestId = ownDataValue(request, 'requestId', true);
  const action = ownDataValue(request, 'action', true);
  if (!request || typeof request !== 'object' || !Object.isFrozen(request)
    || util.types.isProxy(request)
    || ownDataValue(request, 'schemaVersion', true) !== HARNESS_REQUEST_SCHEMA_VERSION
    || ownDataValue(request, 'operation', true) !== HARNESS_OPERATIONS.EXECUTE
    || typeof requestId !== 'string' || !requestId
    || !action || typeof action !== 'object') return null;
  const binding = canonicalBinding(fields.get('binding'));
  const grant = normalizeGrant(fields.get('grant'), requestId, action);
  let actionDigest;
  let workspaceRequest;
  let workspaceLease;
  if (!binding || !grant || !requestAuthorityMatches(request, binding)) return null;
  try {
    actionDigest = normalizeDigest(fields.get('actionDigest'), 'actionDigest');
    workspaceRequest = assertExecutionWorkspaceAcquireRequest(
      fields.get('workspaceRequest')
    );
    workspaceLease = assertExecutionWorkspaceLease(
      fields.get('workspaceLease'),
      workspaceRequest
    );
  } catch {
    return null;
  }
  if (!bindingsMatch(workspaceRequest.binding, binding)) return null;
  const rootLeaseId = ownDataValue(fields.get('rootLease'), 'leaseId', true);
  let rootRequest;
  let rootLease;
  try {
    rootRequest = createProjectRootAuthorityAcquireRequest({
      leaseId: rootLeaseId,
      binding,
      expectedPhysicalRootIdentityDigest:
        workspaceRequest.sourceRootIdentityDigest,
      purpose: 'execution',
    });
    rootLease = assertProjectRootAuthorityLease(
      fields.get('rootLease'),
      rootRequest
    );
  } catch {
    return null;
  }
  if (rootLease.physicalRootIdentityDigest
      !== workspaceRequest.sourceRootIdentityDigest) return null;
  return Object.freeze({
    action,
    actionDigest,
    binding,
    grant,
    request,
    requestId,
    rootLease,
    workspaceLease,
    workspaceRequest,
  });
}

function normalizedActionType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,79}$/.test(normalized) ? normalized : null;
}

function canonicalRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  const portable = value.replace(/\\/g, '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)
    || portable.startsWith('//')) return null;
  const components = portable.split('/');
  return components.some((component) => !component
    || component === '.' || component === '..')
    ? null
    : portable;
}

function normalizeExpectedHash(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().startsWith('sha256:')
    ? value.toLowerCase()
    : `sha256:${value.toLowerCase()}`;
  return /^sha256:[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function patchPlan(fields, names = {}) {
  const path = canonicalRelativePath(fields.get(names.target || 'targetFile'));
  const expectedHash = normalizeExpectedHash(
    fields.get(names.hash || 'previousContentHash')
  );
  if (!path || !expectedHash) return null;
  return Object.freeze({
    targets: Object.freeze([path]),
    preconditions: Object.freeze([
      Object.freeze({ type: 'content_digest', path, expectedHash }),
    ]),
  });
}

function fuzzyPlan(fields) {
  const path = canonicalRelativePath(fields.get('targetFile'));
  const targetContent = fields.get('targetContent');
  if (!path || typeof targetContent !== 'string' || !targetContent) return null;
  return Object.freeze({
    targets: Object.freeze([path]),
    preconditions: Object.freeze([
      Object.freeze({ type: 'contains_text', path, targetContent }),
    ]),
  });
}

function operationPlan(value) {
  const operations = denseDataArray(value);
  if (!operations || operations.length < 1) return null;
  const targets = [];
  const preconditions = [];
  for (const operation of operations) {
    const fields = dataFields(operation, ['op', 'path', 'content'], ['op', 'path']);
    const type = fields && normalizedActionType(fields.get('op'));
    const path = fields && canonicalRelativePath(fields.get('path'));
    if (!fields || !path || !['mkdir', 'write_file', 'append_file'].includes(type)) {
      return null;
    }
    targets.push(path);
    preconditions.push(Object.freeze({
      type: type === 'mkdir' ? 'directory_or_absent' : 'file_or_absent',
      path,
    }));
  }
  return Object.freeze({
    targets: Object.freeze([...new Set(targets)].sort()),
    preconditions: Object.freeze(preconditions),
  });
}

function extractActionPlan(action) {
  const fields = dataFields(action);
  if (!fields) return null;
  if (fields.has('executionCommand')) {
    const command = dataFields(fields.get('executionCommand'));
    const taskType = command && normalizedActionType(command.get('task_type'));
    if (taskType === 'apply_file_patch') {
      return patchPlan(command, {
        target: 'target_file',
        hash: 'previous_content_hash',
      });
    }
    if (taskType === 'execute_operation_batch') {
      return operationPlan(command.get('operations'));
    }
    return null;
  }
  const type = normalizedActionType(fields.get('type'));
  if (type === 'apply_file_patch') return patchPlan(fields);
  if (type === 'edit_file_fuzzy') return fuzzyPlan(fields);
  if (type === 'operation_batch' || type === 'execute_operation_batch') {
    return operationPlan(fields.get('operations'));
  }
  return null;
}

function captureReader(rootLease) {
  const reader = rootLease.reader;
  const captured = { receiver: reader };
  for (const methodName of ['list', 'inspectEntry', 'readFile']) {
    const method = ownDataValue(reader, methodName, true);
    if (typeof method !== 'function' || util.types.isProxy(method)
      || util.types.isGeneratorFunction(method)) return null;
    captured[methodName] = method;
  }
  return Object.freeze(captured);
}

function callReader(reader, methodName, request, normalize) {
  let pending;
  try {
    pending = Reflect.apply(reader[methodName], reader.receiver, [request]);
  } catch {
    return Promise.reject(providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
    ));
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
    ));
  }
  return new Promise((resolve, reject) => {
    const fulfilled = (value) => {
      try {
        resolve(normalize(value, request));
      } catch {
        reject(providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
        ));
      }
    };
    const rejected = () => reject(providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
    ));
    try {
      Reflect.apply(Promise.prototype.then, pending, [fulfilled, rejected]);
    } catch {
      rejected();
    }
  });
}

function listDirectory(reader, relativePath, maxEntries) {
  let request;
  try {
    request = createProjectRootListRequest({ relativePath, maxEntries });
  } catch {
    return Promise.reject(providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
    ));
  }
  return callReader(
    reader,
    'list',
    request,
    assertProjectRootListResult
  );
}

function inspectEntry(reader, relativePath) {
  let request;
  try {
    request = createProjectRootEntryInspectionRequest({ relativePath });
  } catch {
    return Promise.reject(providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
    ));
  }
  return callReader(
    reader,
    'inspectEntry',
    request,
    assertProjectRootEntryInspectionResult
  );
}

function readFile(reader, relativePath, maxBytes) {
  let request;
  try {
    request = createProjectRootReadFileRequest({ relativePath, maxBytes });
  } catch {
    return Promise.reject(providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
    ));
  }
  return callReader(
    reader,
    'readFile',
    request,
    assertProjectRootReadFileResult
  );
}

function joinRelative(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function canonicalTreeEntry(relativePath, inspection) {
  const base = {
    path: relativePath,
    kind: inspection.kind,
    mode: inspection.mode,
  };
  if (inspection.kind === PROJECT_ROOT_ENTRY_KINDS.FILE) {
    return Object.freeze({
      ...base,
      bytes: inspection.bytes,
      contentDigest: inspection.contentDigest,
    });
  }
  if (inspection.kind === PROJECT_ROOT_ENTRY_KINDS.SYMLINK) {
    return Object.freeze({
      ...base,
      bytes: inspection.bytes,
      contentDigest: inspection.contentDigest,
      linkTarget: inspection.linkTarget,
    });
  }
  if (inspection.kind === PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
    return Object.freeze(base);
  }
  throw providerError(
    CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
  );
}

async function scanSourceTree(reader, limits) {
  const queue = [''];
  const entries = [];
  const byPath = new Map();
  let gitEntry = null;
  let observed = 0;
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const directory = queue[queueIndex];
    const listing = await listDirectory(
      reader,
      directory,
      limits.maxEntriesPerDirectory
    );
    if (listing.truncated) {
      throw providerError(
        CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.TREE_LIMIT_EXCEEDED
      );
    }
    const sorted = [...listing.entries].sort((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ));
    for (const listed of sorted) {
      observed += 1;
      if (observed > limits.maxEntries) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.TREE_LIMIT_EXCEEDED
        );
      }
      const relativePath = joinRelative(directory, listed.name);
      const inspection = await inspectEntry(reader, relativePath);
      if (!inspection.found || inspection.kind !== listed.kind) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.READER_FAILED
        );
      }
      if (directory === '' && listed.name === '.git') {
        gitEntry = inspection;
        continue;
      }
      const entry = canonicalTreeEntry(relativePath, inspection);
      entries.push(entry);
      byPath.set(relativePath, entry);
      if (inspection.kind === PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
        queue.push(relativePath);
      }
    }
  }
  entries.sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
  return Object.freeze({
    entries: Object.freeze(entries),
    byPath,
    gitEntry,
  });
}

async function readSmallGitFile(reader, relativePath, inspection) {
  if (!inspection.found || inspection.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
    || inspection.bytes < 1 || inspection.bytes > SMALL_GIT_FILE_BYTES) {
    throw providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
    );
  }
  const read = await readFile(reader, relativePath, inspection.bytes);
  if (!read.found || read.contentDigest !== inspection.contentDigest) {
    throw providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
    );
  }
  const bytes = Buffer.from(read.contentBase64, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes) || text.includes('\0')) {
    throw providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
    );
  }
  return Object.freeze({ text, contentDigest: inspection.contentDigest });
}

async function optionalGitEntry(reader, relativePath) {
  const inspection = await inspectEntry(reader, relativePath);
  return inspection.found ? inspection : null;
}

function metadataDigest(inspection, schemaVersion, state) {
  return canonicalSha256Digest(inspection
    ? {
      schemaVersion,
      state,
      bytes: inspection.bytes,
      mode: inspection.mode,
      contentDigest: inspection.contentDigest,
    }
    : { schemaVersion, state: 'absent' });
}

async function inspectGitState(reader, gitEntry) {
  if (!gitEntry) {
    return Object.freeze({
      branchHeadDigest: canonicalSha256Digest({
        schemaVersion: CANARY_SOURCE_BRANCH_STATE_SCHEMA_VERSION,
        state: 'absent',
      }),
      gitIndexDigest: canonicalSha256Digest({
        schemaVersion: CANARY_SOURCE_INDEX_STATE_SCHEMA_VERSION,
        state: 'absent',
      }),
    });
  }
  if (gitEntry.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
    throw providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
    );
  }
  for (const marker of GIT_TRANSITION_MARKERS) {
    if (await optionalGitEntry(reader, marker)) {
      throw providerError(
        CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
      );
    }
  }
  const headInspection = await optionalGitEntry(reader, '.git/HEAD');
  if (!headInspection) {
    throw providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
    );
  }
  const head = await readSmallGitFile(reader, '.git/HEAD', headInspection);
  const headValue = head.text.trim();
  let headState;
  if (headValue.startsWith('ref: ')) {
    const ref = headValue.slice(5);
    if (!SAFE_REF.test(ref) || ref.split('/').some((part) => (
      part === '.' || part === '..' || part.endsWith('.lock')
    ))) {
      throw providerError(
        CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
      );
    }
    const refPath = `.git/${ref}`;
    const refInspection = await optionalGitEntry(reader, refPath);
    let refObjectId = null;
    let refContentDigest = null;
    if (refInspection) {
      const refFile = await readSmallGitFile(reader, refPath, refInspection);
      refObjectId = refFile.text.trim();
      refContentDigest = refFile.contentDigest;
      if (!SAFE_OBJECT_ID.test(refObjectId)) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
        );
      }
    }
    headState = Object.freeze({
      mode: 'symbolic',
      ref,
      objectId: refObjectId,
      refContentDigest,
    });
  } else {
    if (!SAFE_OBJECT_ID.test(headValue)) {
      throw providerError(
        CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
      );
    }
    headState = Object.freeze({
      mode: 'detached',
      ref: null,
      objectId: headValue,
      refContentDigest: null,
    });
  }
  const packedRefs = await optionalGitEntry(reader, '.git/packed-refs');
  if (packedRefs && packedRefs.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE) {
    throw providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
    );
  }
  const index = await optionalGitEntry(reader, '.git/index');
  if (index && index.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE) {
    throw providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.GIT_STATE_UNSAFE
    );
  }
  return Object.freeze({
    branchHeadDigest: canonicalSha256Digest({
      schemaVersion: CANARY_SOURCE_BRANCH_STATE_SCHEMA_VERSION,
      state: 'present',
      headContentDigest: head.contentDigest,
      headState,
      packedRefsDigest: packedRefs ? packedRefs.contentDigest : null,
    }),
    gitIndexDigest: metadataDigest(
      index,
      CANARY_SOURCE_INDEX_STATE_SCHEMA_VERSION,
      'present'
    ),
  });
}

async function verifyPreconditions(reader, plan, tree) {
  for (const precondition of plan.preconditions) {
    const entry = tree.byPath.get(precondition.path) || null;
    if (precondition.type === 'content_digest') {
      if (!entry || entry.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
        || entry.contentDigest !== precondition.expectedHash) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
        );
      }
      continue;
    }
    if (precondition.type === 'contains_text') {
      if (!entry || entry.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
        || entry.bytes < 1 || entry.bytes > MAX_READ_BYTES) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
        );
      }
      const read = await readFile(reader, precondition.path, entry.bytes);
      if (!read.found || read.contentDigest !== entry.contentDigest) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
        );
      }
      const bytes = Buffer.from(read.contentBase64, 'base64');
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)
        || !text.includes(precondition.targetContent)) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
        );
      }
      continue;
    }
    if (precondition.type === 'directory_or_absent') {
      if (entry && entry.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
        );
      }
      continue;
    }
    if (precondition.type === 'file_or_absent') {
      if (entry && entry.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE) {
        throw providerError(
          CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
        );
      }
      continue;
    }
    throw providerError(
      CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.PRECONDITION_FAILED
    );
  }
}

function snapshotOutput(context, plan, tree, gitState) {
  const sourceRootIdentityDigest =
    context.workspaceRequest.sourceRootIdentityDigest;
  const sourceStateDigest = canonicalSha256Digest({
    schemaVersion: CANARY_SOURCE_TREE_SCHEMA_VERSION,
    sourceRootIdentityDigest,
    entries: tree.entries,
  });
  const planned = new Set(plan.targets);
  const userEntries = Object.freeze(
    tree.entries.filter((entry) => !planned.has(entry.path))
  );
  const userDirtyDigest = canonicalSha256Digest({
    schemaVersion: CANARY_SOURCE_USER_STATE_SCHEMA_VERSION,
    sourceRootIdentityDigest,
    gitIndexDigest: gitState.gitIndexDigest,
    authorizedPaths: plan.targets,
    entries: userEntries,
  });
  const checkpointDigest = canonicalSha256Digest({
    schemaVersion: CANARY_SOURCE_CHECKPOINT_SCHEMA_VERSION,
    projectId: context.binding.projectId,
    jobId: context.binding.jobId,
    actionDigest: context.actionDigest,
    sourceRootIdentityDigest,
    workspaceAuthorityDigest: context.workspaceRequest.workspaceAuthorityDigest,
    sourceStateDigest,
    branchHeadDigest: gitState.branchHeadDigest,
    gitIndexDigest: gitState.gitIndexDigest,
    userDirtyDigest,
  });
  const checkpoint = Object.freeze({
    checkpointDigest,
    checkpointVerified: true,
    projectId: context.binding.projectId,
    canonicalRootPath: context.binding.canonicalRootPath,
    jobId: context.binding.jobId,
  });
  const sourceSnapshot = Object.freeze({
    checkpointDigest,
    sourceRootIdentityDigest,
    sourceStateDigest,
    branchHeadDigest: gitState.branchHeadDigest,
    gitIndexDigest: gitState.gitIndexDigest,
    userDirtyDigest,
  });
  const rootMutation = Object.freeze({
    canonicalRootPath: context.binding.canonicalRootPath,
    ownerJobId: context.binding.jobId,
    activeOtherMutatingJobs: 0,
  });
  return Object.freeze({ checkpoint, sourceSnapshot, rootMutation });
}

function createCanarySourceSnapshotProvider(options = {}) {
  const limits = normalizeOptions(options);

  function diagnostics() {
    return CANARY_SOURCE_SNAPSHOT_PROVIDER_DIAGNOSTICS;
  }

  async function inspect(input) {
    const context = normalizeInput(input);
    if (!context) {
      throw providerError(CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.INVALID_INPUT);
    }
    const plan = extractActionPlan(context.action);
    const reader = captureReader(context.rootLease);
    if (!plan || !reader) {
      throw providerError(CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS.INVALID_INPUT);
    }
    const tree = await scanSourceTree(reader, limits);
    await verifyPreconditions(reader, plan, tree);
    const gitState = await inspectGitState(reader, tree.gitEntry);
    return snapshotOutput(context, plan, tree, gitState);
  }

  return Object.freeze({
    version: CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
    inspect,
    diagnostics,
  });
}

module.exports = {
  CANARY_SOURCE_SNAPSHOT_PROVIDER_REASONS,
  CANARY_SOURCE_SNAPSHOT_PROVIDER_VERSION,
  CanarySourceSnapshotProviderError,
  createCanarySourceSnapshotProvider,
};
