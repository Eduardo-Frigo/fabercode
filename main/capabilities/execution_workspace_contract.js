'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('./capability_delegation_contracts');
const {
  areEquivalentPortablePaths,
  isPathInsideProjectRoot,
  isPortableAbsolutePath,
} = require('./sandbox_backend_contract');

const EXECUTION_WORKSPACE_BACKEND_VERSION = 'execution-workspace-backend.v1';
const EXECUTION_WORKSPACE_PROBE_VERSION = 'execution-workspace-probe.v1';
const EXECUTION_WORKSPACE_ACQUIRE_REQUEST_VERSION = 'execution-workspace-acquire-request.v1';
const EXECUTION_WORKSPACE_AUTHORITY_VERSION = 'execution-workspace-authority.v1';
const EXECUTION_WORKSPACE_LEASE_VERSION = 'execution-workspace-lease.v1';
const EXECUTION_WORKSPACE_DISCARD_REQUEST_VERSION = 'execution-workspace-discard-request.v1';
const EXECUTION_WORKSPACE_DISCARD_RECEIPT_VERSION = 'execution-workspace-discard-receipt.v1';

const EXECUTION_WORKSPACE_STATES = Object.freeze({
  ENFORCED: 'enforced',
  UNAVAILABLE: 'unavailable',
});

const EXECUTION_WORKSPACE_GUARANTEES = Object.freeze({
  EXCLUSIVE_SOURCE_BINDING: 'exclusive_source_binding',
  PRIVATE_WORKSPACE_ROOT: 'private_workspace_root',
  SOURCE_ROOT_NOT_MUTATED: 'source_root_not_mutated',
  ROLLBACK_BY_DISCARD: 'rollback_by_discard',
  PHYSICAL_SOURCE_IDENTITY: 'physical_source_identity',
  PHYSICAL_WORKSPACE_IDENTITY: 'physical_workspace_identity',
});

const EXECUTION_WORKSPACE_REQUIRED_GUARANTEES = Object.freeze([
  EXECUTION_WORKSPACE_GUARANTEES.EXCLUSIVE_SOURCE_BINDING,
  EXECUTION_WORKSPACE_GUARANTEES.PRIVATE_WORKSPACE_ROOT,
  EXECUTION_WORKSPACE_GUARANTEES.SOURCE_ROOT_NOT_MUTATED,
  EXECUTION_WORKSPACE_GUARANTEES.ROLLBACK_BY_DISCARD,
  EXECUTION_WORKSPACE_GUARANTEES.PHYSICAL_SOURCE_IDENTITY,
  EXECUTION_WORKSPACE_GUARANTEES.PHYSICAL_WORKSPACE_IDENTITY,
]);

const SUPPORTED_STATES = new Set(Object.values(EXECUTION_WORKSPACE_STATES));
const SUPPORTED_GUARANTEES = new Set(Object.values(EXECUTION_WORKSPACE_GUARANTEES));
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const MAX_PORTABLE_PATH_BYTES = 4096;
const DATA_GRAPH_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxProperties: 200_000,
});

class ExecutionWorkspaceUnavailableError extends Error {
  constructor(message = 'No enforced execution workspace backend is available.') {
    super(message);
    this.name = 'ExecutionWorkspaceUnavailableError';
    this.code = 'WORKSPACE_UNAVAILABLE';
  }
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // Native Promise species metadata may itself be poisoned. Never consult
    // userland `.then` as a fallback.
  }
  return true;
}

function preflightDataGraph(root) {
  const seen = new Set();
  const stack = [{ value: root, depth: 0 }];
  let bounded = true;
  let inspectable = true;
  let hasNativePromise = false;
  let nodes = 0;
  let properties = 0;

  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    if (absorbNativePromise(value)) {
      hasNativePromise = true;
      continue;
    }
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    nodes += 1;
    if (nodes > DATA_GRAPH_LIMITS.maxNodes || depth > DATA_GRAPH_LIMITS.maxDepth) {
      bounded = false;
    }
    if (util.types.isProxy(value)) {
      inspectable = false;
      continue;
    }
    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch (error) {
      absorbNativePromise(error);
      inspectable = false;
      continue;
    }
    properties += keys.length;
    if (properties > DATA_GRAPH_LIMITS.maxProperties) bounded = false;

    for (const key of keys) {
      if (typeof key !== 'string') inspectable = false;
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch (error) {
        absorbNativePromise(error);
        inspectable = false;
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        inspectable = false;
        continue;
      }
      if (absorbNativePromise(descriptor.value)) {
        hasNativePromise = true;
        continue;
      }
      if (descriptor.value
        && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
        stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    }
  }
  return Object.freeze({ bounded, hasNativePromise, inspectable });
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;

  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function normalizeIdentityDigest(value, fieldName) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a SHA-256 digest`);
  return normalizeDigest(value, fieldName);
}

function authorityDigest({ leaseId, binding, sourceRootIdentityDigest }) {
  // This is an unkeyed correlation/binding digest inside the main-owned
  // registry. It is never an authenticator or a provider attestation.
  const core = {
    version: EXECUTION_WORKSPACE_AUTHORITY_VERSION,
    leaseId,
    binding: {
      projectId: binding.projectId,
      canonicalRootPath: binding.canonicalRootPath,
      realRootPath: binding.realRootPath,
      sessionId: binding.sessionId,
      jobId: binding.jobId,
      kernelId: binding.kernelId,
      submissionDigest: binding.submissionDigest,
    },
    sourceRootIdentityDigest,
  };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex')}`;
}

function pathStyle(value) {
  if (typeof value !== 'string') return null;
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) return 'windows';
  if (value.startsWith('/')) return 'posix';
  return null;
}

function isBoundedPortablePath(value) {
  return isPortableAbsolutePath(value)
    && Buffer.byteLength(value, 'utf8') <= MAX_PORTABLE_PATH_BYTES;
}

function portablePathsOverlap(left, right) {
  return areEquivalentPortablePaths(left, right)
    || isPathInsideProjectRoot(left, right)
    || isPathInsideProjectRoot(right, left);
}

function createExecutionWorkspaceAcquireRequest(input = {}) {
  const fields = exactDataFields(
    input,
    ['leaseId', 'binding', 'sourceRootIdentityDigest'],
    ['leaseId', 'binding', 'sourceRootIdentityDigest']
  );
  if (!fields) throw new TypeError('Invalid execution workspace acquire request data');
  let leaseId;
  let binding;
  let sourceRootIdentityDigest;
  try {
    leaseId = normalizeIdentifier(fields.get('leaseId'), 'leaseId');
    binding = createCapabilityDelegationBinding(fields.get('binding'));
    if (!isBoundedPortablePath(binding.canonicalRootPath)
      || !isBoundedPortablePath(binding.realRootPath)) {
      throw new TypeError('binding roots exceed the hard path bound');
    }
    sourceRootIdentityDigest = normalizeIdentityDigest(
      fields.get('sourceRootIdentityDigest'),
      'sourceRootIdentityDigest'
    );
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Invalid execution workspace acquire request');
  }
  return Object.freeze({
    version: EXECUTION_WORKSPACE_ACQUIRE_REQUEST_VERSION,
    leaseId,
    binding,
    sourceRootIdentityDigest,
    workspaceAuthorityDigest: authorityDigest({ leaseId, binding, sourceRootIdentityDigest }),
  });
}

function assertExecutionWorkspaceAcquireRequest(value) {
  const fields = exactDataFields(value, [
    'version',
    'leaseId',
    'binding',
    'sourceRootIdentityDigest',
    'workspaceAuthorityDigest',
  ]);
  if (!fields || fields.get('version') !== EXECUTION_WORKSPACE_ACQUIRE_REQUEST_VERSION) {
    throw new TypeError('Invalid execution workspace acquire request');
  }
  const canonical = createExecutionWorkspaceAcquireRequest({
    leaseId: fields.get('leaseId'),
    binding: fields.get('binding'),
    sourceRootIdentityDigest: fields.get('sourceRootIdentityDigest'),
  });
  if (fields.get('workspaceAuthorityDigest') !== canonical.workspaceAuthorityDigest) {
    throw new TypeError('Invalid execution workspace acquire request authority');
  }
  return canonical;
}

function normalizeGuarantees(value) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('Execution workspace guarantees must be a dense array');
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError('Execution workspace guarantees must be a dense array');
  }
  const present = new Set();
  for (const key of keys) {
    const guarantee = Object.getOwnPropertyDescriptor(value, key).value;
    if (!SUPPORTED_GUARANTEES.has(guarantee)) {
      throw new TypeError('Unsupported execution workspace guarantee');
    }
    if (present.has(guarantee)) {
      throw new TypeError('Execution workspace probe contains a duplicate guarantee');
    }
    present.add(guarantee);
  }
  return Object.freeze(EXECUTION_WORKSPACE_REQUIRED_GUARANTEES.filter((entry) => present.has(entry)));
}

function createExecutionWorkspaceProbeResult(input = {}) {
  const fields = exactDataFields(
    input,
    ['state', 'guarantees', 'reasonCode'],
    ['state', 'guarantees']
  );
  if (!fields) throw new TypeError('Invalid execution workspace probe result');
  const state = fields.get('state');
  if (!SUPPORTED_STATES.has(state)) throw new TypeError('Invalid execution workspace probe state');
  const guarantees = normalizeGuarantees(fields.get('guarantees'));
  const reasonCode = fields.has('reasonCode') ? fields.get('reasonCode') : null;
  if (state === EXECUTION_WORKSPACE_STATES.ENFORCED && reasonCode !== null) {
    throw new TypeError('Enforced execution workspace probe reasonCode must be null');
  }
  if (state === EXECUTION_WORKSPACE_STATES.ENFORCED
    && !EXECUTION_WORKSPACE_REQUIRED_GUARANTEES.every((entry) => guarantees.includes(entry))) {
    throw new TypeError('Enforced execution workspace probe is missing a required guarantee');
  }
  if (state === EXECUTION_WORKSPACE_STATES.UNAVAILABLE
    && (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode))) {
    throw new TypeError('Unavailable execution workspace probe requires a safe reasonCode');
  }
  return Object.freeze({
    version: EXECUTION_WORKSPACE_PROBE_VERSION,
    state,
    guarantees,
    reasonCode,
  });
}

function assertExecutionWorkspaceProbeResult(value) {
  const fields = exactDataFields(value, ['version', 'state', 'guarantees', 'reasonCode']);
  if (!fields || fields.get('version') !== EXECUTION_WORKSPACE_PROBE_VERSION) {
    throw new TypeError('Invalid execution workspace probe result');
  }
  return createExecutionWorkspaceProbeResult({
    state: fields.get('state'),
    guarantees: fields.get('guarantees'),
    reasonCode: fields.get('reasonCode'),
  });
}

function createExecutionWorkspaceLease(input = {}) {
  const fields = exactDataFields(input, [
    'request',
    'workspaceRootPath',
    'workspaceRealRootPath',
    'workspaceRootIdentityDigest',
  ]);
  if (!fields) throw new TypeError('Invalid execution workspace lease data');
  let request;
  let workspaceRootIdentityDigest;
  try {
    request = assertExecutionWorkspaceAcquireRequest(fields.get('request'));
    workspaceRootIdentityDigest = normalizeIdentityDigest(
      fields.get('workspaceRootIdentityDigest'),
      'workspaceRootIdentityDigest'
    );
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Invalid execution workspace lease authority');
  }
  const workspaceRootPath = fields.get('workspaceRootPath');
  const workspaceRealRootPath = fields.get('workspaceRealRootPath');
  if (!isBoundedPortablePath(workspaceRootPath)
    || !isBoundedPortablePath(workspaceRealRootPath)
    || pathStyle(workspaceRootPath) !== pathStyle(request.binding.canonicalRootPath)
    || pathStyle(workspaceRealRootPath) !== pathStyle(request.binding.realRootPath)
    || workspaceRootIdentityDigest === request.sourceRootIdentityDigest
    || [request.binding.canonicalRootPath, request.binding.realRootPath].some((sourcePath) => (
      [workspaceRootPath, workspaceRealRootPath].some((workspacePath) => (
        pathStyle(sourcePath) === pathStyle(workspacePath)
          && portablePathsOverlap(sourcePath, workspacePath)
      ))
    ))) {
    throw new TypeError('Invalid execution workspace lease root disjunction');
  }
  return Object.freeze({
    version: EXECUTION_WORKSPACE_LEASE_VERSION,
    leaseId: request.leaseId,
    jobId: request.binding.jobId,
    sourceRootIdentityDigest: request.sourceRootIdentityDigest,
    workspaceAuthorityDigest: request.workspaceAuthorityDigest,
    workspaceRootIdentityDigest,
    workspaceRootPath,
    workspaceRealRootPath,
  });
}

function assertExecutionWorkspaceLease(value, expectedRequest) {
  const canonicalRequest = assertExecutionWorkspaceAcquireRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'version',
    'leaseId',
    'jobId',
    'sourceRootIdentityDigest',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
    'workspaceRootPath',
    'workspaceRealRootPath',
  ]);
  if (!fields || fields.get('version') !== EXECUTION_WORKSPACE_LEASE_VERSION) {
    throw new TypeError('Invalid execution workspace lease');
  }
  const canonical = createExecutionWorkspaceLease({
    request: canonicalRequest,
    workspaceRootIdentityDigest: fields.get('workspaceRootIdentityDigest'),
    workspaceRootPath: fields.get('workspaceRootPath'),
    workspaceRealRootPath: fields.get('workspaceRealRootPath'),
  });
  for (const key of Reflect.ownKeys(canonical)) {
    if (fields.get(key) !== canonical[key]) throw new TypeError('Invalid execution workspace lease binding');
  }
  return canonical;
}

function createExecutionWorkspaceDiscardRequest(input = {}) {
  const fields = exactDataFields(input, ['request', 'lease']);
  if (!fields) throw new TypeError('Invalid execution workspace discard request data');
  const request = assertExecutionWorkspaceAcquireRequest(fields.get('request'));
  const lease = assertExecutionWorkspaceLease(fields.get('lease'), request);
  return Object.freeze({
    version: EXECUTION_WORKSPACE_DISCARD_REQUEST_VERSION,
    leaseId: lease.leaseId,
    jobId: lease.jobId,
    sourceRootIdentityDigest: lease.sourceRootIdentityDigest,
    workspaceAuthorityDigest: lease.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: lease.workspaceRootIdentityDigest,
  });
}

function assertExecutionWorkspaceDiscardRequest(value) {
  const fields = exactDataFields(value, [
    'version',
    'leaseId',
    'jobId',
    'sourceRootIdentityDigest',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
  ]);
  if (!fields || fields.get('version') !== EXECUTION_WORKSPACE_DISCARD_REQUEST_VERSION) {
    throw new TypeError('Invalid execution workspace discard request');
  }
  const leaseId = normalizeIdentifier(fields.get('leaseId'), 'leaseId');
  const jobId = normalizeIdentifier(fields.get('jobId'), 'jobId');
  const digests = {};
  for (const key of [
    'sourceRootIdentityDigest',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
  ]) digests[key] = normalizeIdentityDigest(fields.get(key), key);
  return Object.freeze({
    version: EXECUTION_WORKSPACE_DISCARD_REQUEST_VERSION,
    leaseId,
    jobId,
    sourceRootIdentityDigest: digests.sourceRootIdentityDigest,
    workspaceAuthorityDigest: digests.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: digests.workspaceRootIdentityDigest,
  });
}

function createExecutionWorkspaceDiscardReceipt(input = {}) {
  const fields = exactDataFields(input, ['request', 'discarded']);
  if (!fields) throw new TypeError('Invalid execution workspace discard receipt data');
  const request = assertExecutionWorkspaceDiscardRequest(fields.get('request'));
  if (fields.get('discarded') !== true) {
    throw new TypeError('Execution workspace discard receipt must confirm physical discard');
  }
  return Object.freeze({
    version: EXECUTION_WORKSPACE_DISCARD_RECEIPT_VERSION,
    leaseId: request.leaseId,
    workspaceAuthorityDigest: request.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: request.workspaceRootIdentityDigest,
    discarded: true,
  });
}

function assertExecutionWorkspaceDiscardReceipt(value, expectedRequest) {
  const canonicalRequest = assertExecutionWorkspaceDiscardRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'version',
    'leaseId',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
    'discarded',
  ]);
  if (!fields || fields.get('version') !== EXECUTION_WORKSPACE_DISCARD_RECEIPT_VERSION
    || fields.get('leaseId') !== canonicalRequest.leaseId
    || fields.get('workspaceAuthorityDigest') !== canonicalRequest.workspaceAuthorityDigest
    || fields.get('workspaceRootIdentityDigest') !== canonicalRequest.workspaceRootIdentityDigest
    || fields.get('discarded') !== true) {
    throw new TypeError('Invalid execution workspace discard receipt');
  }
  return createExecutionWorkspaceDiscardReceipt({
    request: canonicalRequest,
    discarded: true,
  });
}

function assertExecutionWorkspaceBackend(value) {
  const fields = exactDataFields(value, [
    'version',
    'id',
    'probe',
    'acquire',
    'discard',
    'dispose',
  ]);
  if (!fields
    || fields.get('version') !== EXECUTION_WORKSPACE_BACKEND_VERSION
    || typeof fields.get('id') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('id'))
    || ['probe', 'acquire', 'discard', 'dispose'].some((name) => (
      typeof fields.get(name) !== 'function'
      || util.types.isProxy(fields.get(name))
      || Reflect.ownKeys(fields.get(name)).some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(fields.get(name), key);
        return typeof key !== 'string'
          || (descriptor && descriptor.enumerable === true)
          || !descriptor
          || !Object.hasOwn(descriptor, 'value');
      })
    ))) {
    throw new TypeError('Invalid execution workspace backend');
  }
  return Object.freeze({
    version: fields.get('version'),
    id: fields.get('id'),
    probe: fields.get('probe'),
    acquire: fields.get('acquire'),
    discard: fields.get('discard'),
    dispose: fields.get('dispose'),
  });
}

function createUnsupportedExecutionWorkspaceBackend(options = {}) {
  const fields = exactDataFields(options, ['id', 'reasonCode'], []);
  if (!fields) throw new TypeError('Invalid unsupported execution workspace configuration data');
  const id = fields.has('id') ? fields.get('id') : 'unsupported-execution-workspace';
  const reasonCode = fields.has('reasonCode')
    ? fields.get('reasonCode')
    : 'WORKSPACE_PROVIDER_UNAVAILABLE';
  normalizeIdentifier(id, 'backend id');
  if (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)) {
    throw new TypeError('Unsupported execution workspace reasonCode is invalid');
  }
  const unavailable = () => {
    throw new ExecutionWorkspaceUnavailableError(reasonCode);
  };
  return Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id,
    probe(input) {
      preflightDataGraph(input);
      return createExecutionWorkspaceProbeResult({
        state: EXECUTION_WORKSPACE_STATES.UNAVAILABLE,
        guarantees: [],
        reasonCode,
      });
    },
    acquire(input) {
      preflightDataGraph(input);
      return unavailable();
    },
    discard(input) {
      preflightDataGraph(input);
      return unavailable();
    },
    dispose(input) {
      preflightDataGraph(input);
      return Object.freeze({ ok: true, disposed: true });
    },
  });
}

module.exports = {
  EXECUTION_WORKSPACE_ACQUIRE_REQUEST_VERSION,
  EXECUTION_WORKSPACE_AUTHORITY_VERSION,
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_DISCARD_RECEIPT_VERSION,
  EXECUTION_WORKSPACE_DISCARD_REQUEST_VERSION,
  EXECUTION_WORKSPACE_GUARANTEES,
  EXECUTION_WORKSPACE_LEASE_VERSION,
  EXECUTION_WORKSPACE_PROBE_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  ExecutionWorkspaceUnavailableError,
  absorbNativePromise,
  assertExecutionWorkspaceAcquireRequest,
  assertExecutionWorkspaceBackend,
  assertExecutionWorkspaceDiscardReceipt,
  assertExecutionWorkspaceDiscardRequest,
  assertExecutionWorkspaceLease,
  assertExecutionWorkspaceProbeResult,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceLease,
  createExecutionWorkspaceProbeResult,
  createUnsupportedExecutionWorkspaceBackend,
  portablePathsOverlap,
  preflightDataGraph,
};
