'use strict';

const util = require('util');

const {
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  areEquivalentPortablePaths,
  isPortableAbsolutePath,
} = require('../capabilities/sandbox_backend_contract');
const {
  assertExecutionWorkspaceAcquireRequest,
  portablePathsOverlap,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
} = require('./canary_edit_lifecycle');
const {
  assertCanaryStagingSession,
  assertCanaryStagingWriteReceipt,
} = require('./canary_staging_contract');

const CANARY_PROMOTION_REQUEST_VERSION = 'canary-promotion-request.v2';
const CANARY_PROMOTION_RECEIPT_VERSION = 'canary-promotion-receipt.v1';
const CANARY_PROMOTION_REVERT_RECEIPT_VERSION =
  'canary-promotion-revert-receipt.v1';

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const MAX_PATH_BYTES = 4096;
const MAX_CHANGED_PATHS = 32;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PROMOTION_REQUEST_INPUT_KEYS = Object.freeze([
  'promotionId',
  'session',
  'writeReceipt',
  'checkpoint',
  'workspaceRequest',
  'sourceSnapshot',
  'rootMutation',
]);
const SOURCE_SNAPSHOT_KEYS = Object.freeze([
  'checkpointDigest',
  'sourceRootIdentityDigest',
  'sourceStateDigest',
  'branchHeadDigest',
  'gitIndexDigest',
  'userDirtyDigest',
]);
const ROOT_MUTATION_KEYS = Object.freeze([
  'canonicalRootPath',
  'ownerJobId',
  'activeOtherMutatingJobs',
]);
const PROMOTION_REQUEST_KEYS = Object.freeze([
  'version',
  'promotionId',
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
  'actionDigest',
  'writeSetDigest',
  'changedPaths',
  'sourceStateDigest',
  'branchHeadDigest',
  'gitIndexDigest',
  'userDirtyDigest',
  'rootMutationExclusive',
]);
const PROMOTION_RECEIPT_INPUT_KEYS = Object.freeze([
  'request',
  'sourceAfterDigest',
  'inversePatchDigest',
  'branchHeadAfterDigest',
  'gitIndexAfterDigest',
  'userDirtyAfterDigest',
  'conflictChecked',
  'sourceMutated',
  'promotionApplied',
]);
const PROMOTION_RECEIPT_KEYS = Object.freeze([
  'version',
  'promotionId',
  'requestId',
  'stagingId',
  'projectId',
  'jobId',
  'checkpointDigest',
  'sourceBeforeDigest',
  'sourceAfterDigest',
  'inversePatchDigest',
  'writeSetDigest',
  'changedPaths',
  'branchHeadBeforeDigest',
  'branchHeadAfterDigest',
  'gitIndexBeforeDigest',
  'gitIndexAfterDigest',
  'userDirtyBeforeDigest',
  'userDirtyAfterDigest',
  'conflictChecked',
  'sourceMutated',
  'promotionApplied',
]);
const REVERT_RECEIPT_INPUT_KEYS = Object.freeze([
  'request',
  'promotionReceipt',
  'sourceRestoredDigest',
  'branchHeadAfterDigest',
  'gitIndexAfterDigest',
  'userDirtyAfterDigest',
  'inversePatchApplied',
  'sourceRestored',
]);
const REVERT_RECEIPT_KEYS = Object.freeze([
  'version',
  'promotionId',
  'requestId',
  'stagingId',
  'projectId',
  'jobId',
  'checkpointDigest',
  'inversePatchDigest',
  'sourceRestoredDigest',
  'branchHeadAfterDigest',
  'gitIndexAfterDigest',
  'userDirtyAfterDigest',
  'inversePatchApplied',
  'sourceRestored',
  'lifecycleReceipt',
]);
const REVERT_ASSERTION_KEYS = Object.freeze(['request', 'promotionReceipt']);
const LIFECYCLE_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'jobId',
  'stagingId',
  'disposition',
  'clean',
]);

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || frozen && !Object.isFrozen(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key)
      || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
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

function normalizedDigest(value, fieldName) {
  try {
    return normalizeDigest(value, fieldName);
  } catch {
    return null;
  }
}

function safeIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value);
}

function boundedAbsolutePath(value) {
  return isPortableAbsolutePath(value)
    && Buffer.byteLength(value, 'utf8') <= MAX_PATH_BYTES;
}

function canonicalChangedPaths(value, { frozen = false } = {}) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || frozen && !Object.isFrozen(value)
    || value.length < 1 || value.length > MAX_CHANGED_PATHS) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const output = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const changedPath = descriptor && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : null;
    if (typeof changedPath !== 'string' || !changedPath || changedPath.includes('\0')
      || changedPath.includes('\\') || changedPath.startsWith('/')
      || /^[A-Za-z]:\//.test(changedPath)
      || changedPath.split('/').some((part) => !part || part === '.' || part === '..')
      || output.length > 0 && changedPath <= output[output.length - 1]) return null;
    output.push(changedPath);
  }
  return Object.freeze(output);
}

function sameChangedPaths(left, right) {
  return left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function normalizeSourceSnapshot(value, session) {
  const fields = exactDataFields(value, SOURCE_SNAPSHOT_KEYS, { frozen: true });
  if (!fields) throw new TypeError('Invalid canary promotion source snapshot');
  const normalized = {};
  for (const key of SOURCE_SNAPSHOT_KEYS) {
    normalized[key] = normalizedDigest(fields.get(key), key);
    if (!normalized[key]) {
      throw new TypeError('Invalid canary promotion source snapshot digest');
    }
  }
  if (normalized.checkpointDigest !== session.checkpointDigest
    || normalized.sourceRootIdentityDigest !== session.sourceRootIdentityDigest) {
    throw new TypeError('Canary promotion snapshot identity does not match checkpoint');
  }
  return Object.freeze(normalized);
}

function assertExclusiveRootMutation(value, session) {
  const fields = exactDataFields(value, ROOT_MUTATION_KEYS, { frozen: true });
  if (!fields || !areEquivalentPortablePaths(
    fields.get('canonicalRootPath'),
    session.sourceRootPath
  ) || fields.get('ownerJobId') !== session.jobId
    || fields.get('activeOtherMutatingJobs') !== 0
    || Object.is(fields.get('activeOtherMutatingJobs'), -0)) {
    throw new TypeError('Canary promotion requires exclusive root mutation authority');
  }
}

function structuredPromotionRequest(value) {
  const fields = exactDataFields(value, PROMOTION_REQUEST_KEYS, { frozen: true });
  const changedPaths = fields
    ? canonicalChangedPaths(fields.get('changedPaths'), { frozen: true })
    : null;
  if (!fields || !changedPaths
    || fields.get('version') !== CANARY_PROMOTION_REQUEST_VERSION
    || !safeIdentifier(fields.get('promotionId'))
    || typeof fields.get('requestId') !== 'string' || !fields.get('requestId')
    || !safeIdentifier(fields.get('stagingId'))
    || !safeIdentifier(fields.get('projectId'))
    || !safeIdentifier(fields.get('jobId'))
    || !boundedAbsolutePath(fields.get('sourceRootPath'))
    || !boundedAbsolutePath(fields.get('sourceRealRootPath'))
    || !boundedAbsolutePath(fields.get('workspaceRootPath'))
    || !boundedAbsolutePath(fields.get('workspaceRealRootPath'))
    || fields.get('sourceRootIdentityDigest')
      === fields.get('workspaceRootIdentityDigest')
    || [fields.get('sourceRootPath'), fields.get('sourceRealRootPath')].some(
      (sourcePath) => [
        fields.get('workspaceRootPath'),
        fields.get('workspaceRealRootPath'),
      ].some((workspacePath) => portablePathsOverlap(sourcePath, workspacePath))
    )
    || fields.get('rootMutationExclusive') !== true) {
    throw new TypeError('Invalid canary promotion request');
  }
  for (const key of [
    'checkpointDigest',
    'sourceRootIdentityDigest',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
    'actionDigest',
    'writeSetDigest',
    'sourceStateDigest',
    'branchHeadDigest',
    'gitIndexDigest',
    'userDirtyDigest',
  ]) {
    if (!normalizedDigest(fields.get(key), key)) {
      throw new TypeError('Invalid canary promotion request digest');
    }
  }
  return Object.freeze({ value, fields, changedPaths });
}

function createCanaryPromotionRequest(input = {}) {
  const fields = exactDataFields(input, PROMOTION_REQUEST_INPUT_KEYS);
  const promotionId = fields && fields.get('promotionId');
  if (!fields || !safeIdentifier(promotionId)) {
    throw new TypeError('Invalid canary promotion request input');
  }
  let workspaceRequest;
  let session;
  let writeReceipt;
  try {
    workspaceRequest = assertExecutionWorkspaceAcquireRequest(
      fields.get('workspaceRequest')
    );
    session = assertCanaryStagingSession(fields.get('session'), {
      requestId: fields.get('session').requestId,
      checkpoint: fields.get('checkpoint'),
      workspaceRequest,
    });
    writeReceipt = assertCanaryStagingWriteReceipt(
      fields.get('writeReceipt'),
      session
    );
  } catch {
    throw new TypeError('Invalid canary promotion staging authority');
  }
  const sourceSnapshot = normalizeSourceSnapshot(fields.get('sourceSnapshot'), session);
  assertExclusiveRootMutation(fields.get('rootMutation'), session);
  return Object.freeze({
    version: CANARY_PROMOTION_REQUEST_VERSION,
    promotionId,
    requestId: session.requestId,
    stagingId: session.stagingId,
    projectId: session.projectId,
    jobId: session.jobId,
    checkpointDigest: session.checkpointDigest,
    sourceRootPath: session.sourceRootPath,
    sourceRealRootPath: session.sourceRealRootPath,
    sourceRootIdentityDigest: session.sourceRootIdentityDigest,
    workspaceAuthorityDigest: session.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: session.workspaceRootIdentityDigest,
    workspaceRootPath: session.workspaceRootPath,
    workspaceRealRootPath: session.workspaceRealRootPath,
    actionDigest: writeReceipt.actionDigest,
    writeSetDigest: writeReceipt.writeSetDigest,
    changedPaths: Object.freeze([...writeReceipt.changedPaths]),
    sourceStateDigest: sourceSnapshot.sourceStateDigest,
    branchHeadDigest: sourceSnapshot.branchHeadDigest,
    gitIndexDigest: sourceSnapshot.gitIndexDigest,
    userDirtyDigest: sourceSnapshot.userDirtyDigest,
    rootMutationExclusive: true,
  });
}

function assertCanaryPromotionRequest(value, expected = {}) {
  const fields = exactDataFields(value, PROMOTION_REQUEST_KEYS, { frozen: true });
  if (!fields || fields.get('version') !== CANARY_PROMOTION_REQUEST_VERSION) {
    throw new TypeError('Invalid canary promotion request');
  }
  let canonical;
  try {
    canonical = createCanaryPromotionRequest(expected);
  } catch {
    throw new TypeError('Invalid expected canary promotion request authority');
  }
  if (PROMOTION_REQUEST_KEYS.some((key) => key === 'changedPaths'
    ? !sameChangedPaths(fields.get(key), canonical.changedPaths)
    : fields.get(key) !== canonical[key])) {
    throw new TypeError('Canary promotion request does not match expected authority');
  }
  return canonical;
}

function createCanaryPromotionReceipt(input = {}) {
  const fields = exactDataFields(input, PROMOTION_RECEIPT_INPUT_KEYS);
  if (!fields) throw new TypeError('Invalid canary promotion receipt input');
  const request = structuredPromotionRequest(fields.get('request')).value;
  const sourceAfterDigest = normalizedDigest(
    fields.get('sourceAfterDigest'),
    'sourceAfterDigest'
  );
  const inversePatchDigest = normalizedDigest(
    fields.get('inversePatchDigest'),
    'inversePatchDigest'
  );
  if (!sourceAfterDigest || !inversePatchDigest
    || sourceAfterDigest === request.sourceStateDigest
    || fields.get('branchHeadAfterDigest') !== request.branchHeadDigest
    || fields.get('gitIndexAfterDigest') !== request.gitIndexDigest
    || fields.get('userDirtyAfterDigest') !== request.userDirtyDigest
    || fields.get('conflictChecked') !== true
    || fields.get('sourceMutated') !== true
    || fields.get('promotionApplied') !== true) {
    throw new TypeError(
      'Canary promotion receipt must prove source change and preserve branch, index, and user state'
    );
  }
  return Object.freeze({
    version: CANARY_PROMOTION_RECEIPT_VERSION,
    promotionId: request.promotionId,
    requestId: request.requestId,
    stagingId: request.stagingId,
    projectId: request.projectId,
    jobId: request.jobId,
    checkpointDigest: request.checkpointDigest,
    sourceBeforeDigest: request.sourceStateDigest,
    sourceAfterDigest,
    inversePatchDigest,
    writeSetDigest: request.writeSetDigest,
    changedPaths: Object.freeze([...request.changedPaths]),
    branchHeadBeforeDigest: request.branchHeadDigest,
    branchHeadAfterDigest: request.branchHeadDigest,
    gitIndexBeforeDigest: request.gitIndexDigest,
    gitIndexAfterDigest: request.gitIndexDigest,
    userDirtyBeforeDigest: request.userDirtyDigest,
    userDirtyAfterDigest: request.userDirtyDigest,
    conflictChecked: true,
    sourceMutated: true,
    promotionApplied: true,
  });
}

function assertCanaryPromotionReceipt(value, expectedRequest) {
  const request = structuredPromotionRequest(expectedRequest).value;
  const fields = exactDataFields(value, PROMOTION_RECEIPT_KEYS, { frozen: true });
  if (!fields || fields.get('version') !== CANARY_PROMOTION_RECEIPT_VERSION
    || !Object.isFrozen(fields.get('changedPaths'))) {
    throw new TypeError('Invalid canary promotion receipt');
  }
  let canonical;
  try {
    canonical = createCanaryPromotionReceipt({
      request,
      sourceAfterDigest: fields.get('sourceAfterDigest'),
      inversePatchDigest: fields.get('inversePatchDigest'),
      branchHeadAfterDigest: fields.get('branchHeadAfterDigest'),
      gitIndexAfterDigest: fields.get('gitIndexAfterDigest'),
      userDirtyAfterDigest: fields.get('userDirtyAfterDigest'),
      conflictChecked: fields.get('conflictChecked'),
      sourceMutated: fields.get('sourceMutated'),
      promotionApplied: fields.get('promotionApplied'),
    });
  } catch {
    throw new TypeError('Invalid canary promotion receipt');
  }
  if (PROMOTION_RECEIPT_KEYS.some((key) => key === 'changedPaths'
    ? !sameChangedPaths(fields.get(key), canonical.changedPaths)
    : fields.get(key) !== canonical[key])) {
    throw new TypeError('Canary promotion receipt does not match request');
  }
  return canonical;
}

function createCanaryPromotionRevertReceipt(input = {}) {
  const fields = exactDataFields(input, REVERT_RECEIPT_INPUT_KEYS);
  if (!fields) throw new TypeError('Invalid canary promotion revert receipt input');
  const request = structuredPromotionRequest(fields.get('request')).value;
  let promotionReceipt;
  try {
    promotionReceipt = assertCanaryPromotionReceipt(
      fields.get('promotionReceipt'),
      request
    );
  } catch {
    throw new TypeError('Invalid canary promotion receipt for revert');
  }
  if (fields.get('sourceRestoredDigest') !== request.sourceStateDigest
    || fields.get('branchHeadAfterDigest') !== request.branchHeadDigest
    || fields.get('gitIndexAfterDigest') !== request.gitIndexDigest
    || fields.get('userDirtyAfterDigest') !== request.userDirtyDigest
    || fields.get('inversePatchApplied') !== true
    || fields.get('sourceRestored') !== true) {
    throw new TypeError(
      'Canary revert receipt must restore source with the inverse patch and preserve user state'
    );
  }
  const lifecycleReceipt = Object.freeze({
    schemaVersion: CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
    jobId: request.jobId,
    stagingId: request.stagingId,
    disposition: 'reverted',
    clean: true,
  });
  return Object.freeze({
    version: CANARY_PROMOTION_REVERT_RECEIPT_VERSION,
    promotionId: request.promotionId,
    requestId: request.requestId,
    stagingId: request.stagingId,
    projectId: request.projectId,
    jobId: request.jobId,
    checkpointDigest: request.checkpointDigest,
    inversePatchDigest: promotionReceipt.inversePatchDigest,
    sourceRestoredDigest: request.sourceStateDigest,
    branchHeadAfterDigest: request.branchHeadDigest,
    gitIndexAfterDigest: request.gitIndexDigest,
    userDirtyAfterDigest: request.userDirtyDigest,
    inversePatchApplied: true,
    sourceRestored: true,
    lifecycleReceipt,
  });
}

function assertCanaryPromotionRevertReceipt(value, expected = {}) {
  const expectedFields = exactDataFields(expected, REVERT_ASSERTION_KEYS);
  const fields = exactDataFields(value, REVERT_RECEIPT_KEYS, { frozen: true });
  if (!expectedFields || !fields
    || fields.get('version') !== CANARY_PROMOTION_REVERT_RECEIPT_VERSION) {
    throw new TypeError('Invalid canary promotion revert receipt');
  }
  let canonical;
  try {
    const request = structuredPromotionRequest(expectedFields.get('request')).value;
    canonical = createCanaryPromotionRevertReceipt({
      request,
      promotionReceipt: expectedFields.get('promotionReceipt'),
      sourceRestoredDigest: fields.get('sourceRestoredDigest'),
      branchHeadAfterDigest: fields.get('branchHeadAfterDigest'),
      gitIndexAfterDigest: fields.get('gitIndexAfterDigest'),
      userDirtyAfterDigest: fields.get('userDirtyAfterDigest'),
      inversePatchApplied: fields.get('inversePatchApplied'),
      sourceRestored: fields.get('sourceRestored'),
    });
  } catch {
    throw new TypeError('Invalid canary promotion revert receipt');
  }
  const lifecycleFields = exactDataFields(
    fields.get('lifecycleReceipt'),
    LIFECYCLE_RECEIPT_KEYS,
    { frozen: true }
  );
  if (!lifecycleFields || REVERT_RECEIPT_KEYS.some((key) => {
    if (key === 'lifecycleReceipt') {
      return LIFECYCLE_RECEIPT_KEYS.some(
        (entry) => lifecycleFields.get(entry) !== canonical.lifecycleReceipt[entry]
      );
    }
    return fields.get(key) !== canonical[key];
  })) {
    throw new TypeError('Canary promotion revert receipt does not match promotion');
  }
  return canonical;
}

module.exports = {
  CANARY_PROMOTION_RECEIPT_VERSION,
  CANARY_PROMOTION_REQUEST_VERSION,
  CANARY_PROMOTION_REVERT_RECEIPT_VERSION,
  assertCanaryPromotionReceipt,
  assertCanaryPromotionRequest,
  assertCanaryPromotionRevertReceipt,
  createCanaryPromotionReceipt,
  createCanaryPromotionRequest,
  createCanaryPromotionRevertReceipt,
};
