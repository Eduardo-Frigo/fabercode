'use strict';

const util = require('util');

const {
  preflightDataGraph,
} = require('./execution_workspace_contract');
const {
  immutableSnapshot,
} = require('./capability_delegation_contracts');

const PORTABLE_ISOLATION_BACKEND_CONTRACT_VERSION =
  'portable-isolation-backend-contract.v1';
const PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION =
  'portable-isolation-backend-request.v1';
const PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION =
  'portable-isolation-backend-response.v1';
const PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION =
  'portable-isolation-root-lease-descriptor.v1';

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REQUEST_INPUT_KEYS = Object.freeze(['backendId', 'input']);
const REQUEST_KEYS = Object.freeze(['version', 'backendId', 'input']);
const RESPONSE_INPUT_KEYS = Object.freeze(['backendId', 'result']);
const RESPONSE_KEYS = Object.freeze(['version', 'backendId', 'result']);
const ROOT_DESCRIPTOR_INPUT_KEYS = Object.freeze([
  'leaseId',
  'jobId',
  'projectId',
  'purpose',
  'physicalRootIdentityDigest',
  'authorityDigest',
]);
const ROOT_DESCRIPTOR_KEYS = Object.freeze([
  'version',
  ...ROOT_DESCRIPTOR_INPUT_KEYS,
]);

class PortableIsolationHelperBackendContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperBackendContractError';
    this.code = code;
  }
}

function fail(code) {
  throw new PortableIsolationHelperBackendContractError(code);
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // Never invoke a userland thenable fallback.
  }
  return true;
}

function observeDataGraph(value, code) {
  let preflight;
  try {
    preflight = preflightDataGraph(value);
  } catch (error) {
    absorbNativePromise(error);
    fail(code);
  }
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable) {
    fail(code);
  }
}

function exactDataFields(value, allowedKeys, requiredKeys, code) {
  observeDataGraph(value, code);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    fail(code);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) fail(code);
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      fail(code);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      fail(code);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function safeIdentifier(value, code) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) fail(code);
  return value;
}

function safeDigest(value, code) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(code);
  return value;
}

function snapshotRecord(value, code) {
  observeDataGraph(value, code);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail(code);
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch (error) {
    absorbNativePromise(error);
    fail(code);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  try {
    return immutableSnapshot(value);
  } catch (error) {
    absorbNativePromise(error);
    fail(code);
  }
}

function normalizeBackendRequest(value, inputShape) {
  const code = 'BACKEND_REQUEST_INVALID';
  const fields = exactDataFields(
    value,
    inputShape ? REQUEST_INPUT_KEYS : REQUEST_KEYS,
    inputShape ? REQUEST_INPUT_KEYS : REQUEST_KEYS,
    code
  );
  if (!inputShape
    && fields.get('version') !== PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION) {
    fail(code);
  }
  return Object.freeze({
    version: PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION,
    backendId: safeIdentifier(fields.get('backendId'), code),
    input: snapshotRecord(fields.get('input'), code),
  });
}

function createPortableIsolationHelperBackendRequest(input = {}) {
  return normalizeBackendRequest(input, true);
}

function assertPortableIsolationHelperBackendRequest(value) {
  return normalizeBackendRequest(value, false);
}

function normalizeBackendResponse(value, inputShape) {
  const code = 'BACKEND_RESPONSE_INVALID';
  const fields = exactDataFields(
    value,
    inputShape ? RESPONSE_INPUT_KEYS : RESPONSE_KEYS,
    inputShape ? RESPONSE_INPUT_KEYS : RESPONSE_KEYS,
    code
  );
  if (!inputShape
    && fields.get('version') !== PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION) {
    fail(code);
  }
  return Object.freeze({
    version: PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
    backendId: safeIdentifier(fields.get('backendId'), code),
    result: snapshotRecord(fields.get('result'), code),
  });
}

function createPortableIsolationHelperBackendResponse(input = {}) {
  return normalizeBackendResponse(input, true);
}

function assertPortableIsolationHelperBackendResponse(value) {
  return normalizeBackendResponse(value, false);
}

function normalizedRootLeaseDescriptor(value, inputShape) {
  const code = 'ROOT_LEASE_DESCRIPTOR_INVALID';
  const fields = exactDataFields(
    value,
    inputShape ? ROOT_DESCRIPTOR_INPUT_KEYS : ROOT_DESCRIPTOR_KEYS,
    inputShape ? ROOT_DESCRIPTOR_INPUT_KEYS : ROOT_DESCRIPTOR_KEYS,
    code
  );
  if (!inputShape && fields.get('version')
    !== PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION) fail(code);
  return Object.freeze({
    version: PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION,
    leaseId: safeIdentifier(fields.get('leaseId'), code),
    jobId: safeIdentifier(fields.get('jobId'), code),
    projectId: safeIdentifier(fields.get('projectId'), code),
    purpose: safeIdentifier(fields.get('purpose'), code),
    physicalRootIdentityDigest: safeDigest(
      fields.get('physicalRootIdentityDigest'),
      code
    ),
    authorityDigest: safeDigest(fields.get('authorityDigest'), code),
  });
}

function createPortableIsolationHelperRootLeaseDescriptor(input = {}) {
  return normalizedRootLeaseDescriptor(input, true);
}

function assertPortableIsolationHelperRootLeaseDescriptor(value) {
  return normalizedRootLeaseDescriptor(value, false);
}

module.exports = {
  PORTABLE_ISOLATION_BACKEND_CONTRACT_VERSION,
  PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION,
  PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
  PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION,
  PortableIsolationHelperBackendContractError,
  assertPortableIsolationHelperBackendRequest,
  assertPortableIsolationHelperBackendResponse,
  assertPortableIsolationHelperRootLeaseDescriptor,
  createPortableIsolationHelperBackendRequest,
  createPortableIsolationHelperBackendResponse,
  createPortableIsolationHelperRootLeaseDescriptor,
};
