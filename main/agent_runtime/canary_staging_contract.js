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
  assertExecutionWorkspaceDiscardReceipt,
  assertExecutionWorkspaceDiscardRequest,
  assertExecutionWorkspaceLease,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceLease,
  portablePathsOverlap,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
} = require('./canary_edit_lifecycle');

const CANARY_STAGING_SESSION_VERSION = 'canary-staging-session.v1';
const CANARY_STAGING_WRITE_RECEIPT_VERSION = 'canary-staging-write-receipt.v1';
const CANARY_STAGING_DISCARD_RECEIPT_VERSION =
  'canary-staging-discard-receipt.v1';

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const MAX_REQUEST_ID_BYTES = 4096;
const MAX_PATH_BYTES = 4096;
const MAX_CHANGED_PATHS = 32;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SESSION_INPUT_KEYS = Object.freeze([
  'requestId',
  'checkpoint',
  'workspaceRequest',
  'workspaceLease',
]);
const SESSION_ASSERTION_KEYS = Object.freeze([
  'requestId',
  'checkpoint',
  'workspaceRequest',
]);
const CHECKPOINT_KEYS = Object.freeze([
  'checkpointDigest',
  'checkpointVerified',
  'projectId',
  'canonicalRootPath',
  'jobId',
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
const WRITE_INPUT_KEYS = Object.freeze([
  'session',
  'actionDigest',
  'writeSetDigest',
  'changedPaths',
  'stagingWritten',
  'sourceMutated',
]);
const WRITE_RECEIPT_KEYS = Object.freeze([
  'version',
  'requestId',
  'stagingId',
  'jobId',
  'checkpointDigest',
  'workspaceAuthorityDigest',
  'workspaceRootIdentityDigest',
  'actionDigest',
  'writeSetDigest',
  'changedPaths',
  'stagingWritten',
  'sourceMutated',
]);
const DISCARD_INPUT_KEYS = Object.freeze([
  'session',
  'workspaceDiscardRequest',
  'workspaceDiscardReceipt',
]);
const DISCARD_ASSERTION_KEYS = Object.freeze([
  'session',
  'workspaceDiscardRequest',
]);
const DISCARD_RECEIPT_KEYS = Object.freeze([
  'version',
  'requestId',
  'stagingId',
  'jobId',
  'checkpointDigest',
  'workspaceAuthorityDigest',
  'workspaceRootIdentityDigest',
  'disposition',
  'clean',
  'lifecycleReceipt',
]);
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

function boundedRequestId(value) {
  return typeof value === 'string' && value.trim().length > 0
    && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') <= MAX_REQUEST_ID_BYTES;
}

function safeIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value);
}

function normalizedDigest(value, fieldName) {
  try {
    return normalizeDigest(value, fieldName);
  } catch {
    return null;
  }
}

function boundedPortablePath(value) {
  return isPortableAbsolutePath(value)
    && Buffer.byteLength(value, 'utf8') <= MAX_PATH_BYTES;
}

function normalizeCheckpoint(value, workspaceRequest) {
  const fields = exactDataFields(value, CHECKPOINT_KEYS, { frozen: true });
  const binding = workspaceRequest.binding;
  const checkpointDigest = fields
    ? normalizedDigest(fields.get('checkpointDigest'), 'checkpointDigest')
    : null;
  if (!fields || !checkpointDigest
    || fields.get('checkpointVerified') !== true
    || fields.get('projectId') !== binding.projectId
    || fields.get('jobId') !== binding.jobId
    || !areEquivalentPortablePaths(
      fields.get('canonicalRootPath'),
      binding.canonicalRootPath
    )) {
    throw new TypeError('Canary staging checkpoint does not match workspace binding');
  }
  return Object.freeze({ checkpointDigest });
}

function structuredSession(value) {
  const fields = exactDataFields(value, SESSION_KEYS, { frozen: true });
  if (!fields
    || fields.get('version') !== CANARY_STAGING_SESSION_VERSION
    || !boundedRequestId(fields.get('requestId'))
    || !safeIdentifier(fields.get('stagingId'))
    || !safeIdentifier(fields.get('projectId'))
    || !safeIdentifier(fields.get('jobId'))
    || !normalizedDigest(fields.get('checkpointDigest'), 'checkpointDigest')
    || !boundedPortablePath(fields.get('sourceRootPath'))
    || !boundedPortablePath(fields.get('sourceRealRootPath'))
    || !normalizedDigest(
      fields.get('sourceRootIdentityDigest'),
      'sourceRootIdentityDigest'
    )
    || !normalizedDigest(
      fields.get('workspaceAuthorityDigest'),
      'workspaceAuthorityDigest'
    )
    || !normalizedDigest(
      fields.get('workspaceRootIdentityDigest'),
      'workspaceRootIdentityDigest'
    )
    || !boundedPortablePath(fields.get('workspaceRootPath'))
    || !boundedPortablePath(fields.get('workspaceRealRootPath'))
    || fields.get('sourceRootIdentityDigest')
      === fields.get('workspaceRootIdentityDigest')
    || [fields.get('sourceRootPath'), fields.get('sourceRealRootPath')].some(
      (sourcePath) => [
        fields.get('workspaceRootPath'),
        fields.get('workspaceRealRootPath'),
      ].some((workspacePath) => portablePathsOverlap(sourcePath, workspacePath))
    )) {
    throw new TypeError('Invalid canary staging session');
  }
  return value;
}

function createCanaryStagingSession(input = {}) {
  const fields = exactDataFields(input, SESSION_INPUT_KEYS);
  if (!fields || !boundedRequestId(fields.get('requestId'))) {
    throw new TypeError('Invalid canary staging session input');
  }
  let workspaceRequest;
  let workspaceLease;
  try {
    workspaceRequest = assertExecutionWorkspaceAcquireRequest(
      fields.get('workspaceRequest')
    );
    workspaceLease = assertExecutionWorkspaceLease(
      fields.get('workspaceLease'),
      workspaceRequest
    );
  } catch {
    throw new TypeError('Invalid canary staging workspace authority');
  }
  const checkpoint = normalizeCheckpoint(fields.get('checkpoint'), workspaceRequest);
  return Object.freeze({
    version: CANARY_STAGING_SESSION_VERSION,
    requestId: fields.get('requestId'),
    stagingId: workspaceLease.leaseId,
    projectId: workspaceRequest.binding.projectId,
    jobId: workspaceRequest.binding.jobId,
    checkpointDigest: checkpoint.checkpointDigest,
    sourceRootPath: workspaceRequest.binding.canonicalRootPath,
    sourceRealRootPath: workspaceRequest.binding.realRootPath,
    sourceRootIdentityDigest: workspaceLease.sourceRootIdentityDigest,
    workspaceAuthorityDigest: workspaceLease.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: workspaceLease.workspaceRootIdentityDigest,
    workspaceRootPath: workspaceLease.workspaceRootPath,
    workspaceRealRootPath: workspaceLease.workspaceRealRootPath,
  });
}

function assertCanaryStagingSession(value, expected = {}) {
  const expectedFields = exactDataFields(expected, SESSION_ASSERTION_KEYS);
  const sessionFields = exactDataFields(value, SESSION_KEYS, { frozen: true });
  if (!expectedFields || !sessionFields
    || sessionFields.get('version') !== CANARY_STAGING_SESSION_VERSION) {
    throw new TypeError('Invalid canary staging session assertion');
  }
  let workspaceRequest;
  let reconstructedLease;
  try {
    workspaceRequest = assertExecutionWorkspaceAcquireRequest(
      expectedFields.get('workspaceRequest')
    );
    reconstructedLease = createExecutionWorkspaceLease({
      request: workspaceRequest,
      workspaceRootPath: sessionFields.get('workspaceRootPath'),
      workspaceRealRootPath: sessionFields.get('workspaceRealRootPath'),
      workspaceRootIdentityDigest: sessionFields.get('workspaceRootIdentityDigest'),
    });
  } catch {
    throw new TypeError('Invalid canary staging session workspace assertion');
  }
  const canonical = createCanaryStagingSession({
    requestId: expectedFields.get('requestId'),
    checkpoint: expectedFields.get('checkpoint'),
    workspaceRequest,
    workspaceLease: reconstructedLease,
  });
  if (SESSION_KEYS.some((key) => sessionFields.get(key) !== canonical[key])) {
    throw new TypeError('Canary staging session does not match expected authority');
  }
  return canonical;
}

function safeRelativeChangedPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')
    || value.includes('\\')
    || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES
    || value.startsWith('/') || /^[A-Za-z]:\//.test(value)
    || value.startsWith('//')) return false;
  const components = value.split('/');
  return components.every((component) => component
    && component !== '.' && component !== '..');
}

function normalizeChangedPaths(value, { frozen = false } = {}) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || frozen && !Object.isFrozen(value)
    || value.length < 1 || value.length > MAX_CHANGED_PATHS) {
    throw new TypeError('Canary staging changedPaths must be a bounded dense array');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    throw new TypeError('Canary staging changedPaths must be dense');
  }
  const output = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const changedPath = descriptor && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : null;
    if (!safeRelativeChangedPath(changedPath)
      || output.length > 0 && changedPath <= output[output.length - 1]) {
      throw new TypeError(
        'Canary staging changedPaths must be unique canonical sorted paths'
      );
    }
    output.push(changedPath);
  }
  return Object.freeze(output);
}

function createCanaryStagingWriteReceipt(input = {}) {
  const fields = exactDataFields(input, WRITE_INPUT_KEYS);
  if (!fields || fields.get('stagingWritten') !== true
    || fields.get('sourceMutated') !== false) {
    throw new TypeError('Invalid canary staging write receipt input');
  }
  const session = structuredSession(fields.get('session'));
  const actionDigest = normalizedDigest(fields.get('actionDigest'), 'actionDigest');
  const writeSetDigest = normalizedDigest(
    fields.get('writeSetDigest'),
    'writeSetDigest'
  );
  if (!actionDigest || !writeSetDigest) {
    throw new TypeError('Invalid canary staging write receipt digests');
  }
  const changedPaths = normalizeChangedPaths(fields.get('changedPaths'));
  return Object.freeze({
    version: CANARY_STAGING_WRITE_RECEIPT_VERSION,
    requestId: session.requestId,
    stagingId: session.stagingId,
    jobId: session.jobId,
    checkpointDigest: session.checkpointDigest,
    workspaceAuthorityDigest: session.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: session.workspaceRootIdentityDigest,
    actionDigest,
    writeSetDigest,
    changedPaths,
    stagingWritten: true,
    sourceMutated: false,
  });
}

function assertCanaryStagingWriteReceipt(value, expectedSession) {
  const session = structuredSession(expectedSession);
  const fields = exactDataFields(value, WRITE_RECEIPT_KEYS, { frozen: true });
  if (!fields || fields.get('version') !== CANARY_STAGING_WRITE_RECEIPT_VERSION
    || !Object.isFrozen(fields.get('changedPaths'))) {
    throw new TypeError('Invalid canary staging write receipt');
  }
  let canonical;
  try {
    canonical = createCanaryStagingWriteReceipt({
      session,
      actionDigest: fields.get('actionDigest'),
      writeSetDigest: fields.get('writeSetDigest'),
      changedPaths: fields.get('changedPaths'),
      stagingWritten: fields.get('stagingWritten'),
      sourceMutated: fields.get('sourceMutated'),
    });
  } catch {
    throw new TypeError('Invalid canary staging write receipt');
  }
  if (WRITE_RECEIPT_KEYS.some((key) => {
    if (key === 'changedPaths') {
      return fields.get(key).length !== canonical.changedPaths.length
        || fields.get(key).some((entry, index) => entry !== canonical.changedPaths[index]);
    }
    return fields.get(key) !== canonical[key];
  })) {
    throw new TypeError('Canary staging write receipt does not match session');
  }
  return canonical;
}

function workspaceDiscardMatchesSession(request, session) {
  return request.leaseId === session.stagingId
    && request.jobId === session.jobId
    && request.sourceRootIdentityDigest === session.sourceRootIdentityDigest
    && request.workspaceAuthorityDigest === session.workspaceAuthorityDigest
    && request.workspaceRootIdentityDigest === session.workspaceRootIdentityDigest;
}

function createCanaryStagingDiscardReceipt(input = {}) {
  const fields = exactDataFields(input, DISCARD_INPUT_KEYS);
  if (!fields) throw new TypeError('Invalid canary staging discard receipt input');
  const session = structuredSession(fields.get('session'));
  let workspaceDiscardRequest;
  try {
    workspaceDiscardRequest = assertExecutionWorkspaceDiscardRequest(
      fields.get('workspaceDiscardRequest')
    );
    assertExecutionWorkspaceDiscardReceipt(
      fields.get('workspaceDiscardReceipt'),
      workspaceDiscardRequest
    );
  } catch {
    throw new TypeError('Invalid canary staging workspace discard proof');
  }
  if (!workspaceDiscardMatchesSession(workspaceDiscardRequest, session)) {
    throw new TypeError('Canary staging discard proof does not match session');
  }
  const lifecycleReceipt = Object.freeze({
    schemaVersion: CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
    jobId: session.jobId,
    stagingId: session.stagingId,
    disposition: 'discarded',
    clean: true,
  });
  return Object.freeze({
    version: CANARY_STAGING_DISCARD_RECEIPT_VERSION,
    requestId: session.requestId,
    stagingId: session.stagingId,
    jobId: session.jobId,
    checkpointDigest: session.checkpointDigest,
    workspaceAuthorityDigest: session.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: session.workspaceRootIdentityDigest,
    disposition: 'discarded',
    clean: true,
    lifecycleReceipt,
  });
}

function assertCanaryStagingDiscardReceipt(value, expected = {}) {
  const expectedFields = exactDataFields(expected, DISCARD_ASSERTION_KEYS);
  const fields = exactDataFields(value, DISCARD_RECEIPT_KEYS, { frozen: true });
  if (!expectedFields || !fields
    || fields.get('version') !== CANARY_STAGING_DISCARD_RECEIPT_VERSION) {
    throw new TypeError('Invalid canary staging discard receipt');
  }
  const session = structuredSession(expectedFields.get('session'));
  let workspaceDiscardRequest;
  let canonical;
  try {
    workspaceDiscardRequest = assertExecutionWorkspaceDiscardRequest(
      expectedFields.get('workspaceDiscardRequest')
    );
    canonical = createCanaryStagingDiscardReceipt({
      session,
      workspaceDiscardRequest,
      workspaceDiscardReceipt: createExecutionWorkspaceDiscardReceipt({
        request: workspaceDiscardRequest,
        discarded: true,
      }),
    });
  } catch {
    throw new TypeError('Invalid canary staging discard receipt authority');
  }
  const lifecycleFields = exactDataFields(
    fields.get('lifecycleReceipt'),
    LIFECYCLE_RECEIPT_KEYS,
    { frozen: true }
  );
  if (!lifecycleFields || DISCARD_RECEIPT_KEYS.some((key) => {
    if (key === 'lifecycleReceipt') {
      return LIFECYCLE_RECEIPT_KEYS.some(
        (entry) => lifecycleFields.get(entry) !== canonical.lifecycleReceipt[entry]
      );
    }
    return fields.get(key) !== canonical[key];
  })) {
    throw new TypeError('Canary staging discard receipt does not match session');
  }
  return canonical;
}

module.exports = {
  CANARY_STAGING_DISCARD_RECEIPT_VERSION,
  CANARY_STAGING_SESSION_VERSION,
  CANARY_STAGING_WRITE_RECEIPT_VERSION,
  assertCanaryStagingDiscardReceipt,
  assertCanaryStagingSession,
  assertCanaryStagingWriteReceipt,
  createCanaryStagingDiscardReceipt,
  createCanaryStagingSession,
  createCanaryStagingWriteReceipt,
};
