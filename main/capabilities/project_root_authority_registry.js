'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_READER_VERSION,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityCloseReceipt,
  assertProjectRootAuthorityLease,
  assertProjectRootAuthorityProbeResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
  createUnsupportedProjectRootAuthorityBackend,
} = require('./project_root_authority_contract');
const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('./capability_delegation_contracts');
const {
  portablePathsOverlap,
  preflightDataGraph,
} = require('./execution_workspace_contract');

const PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION = 'project-root-authority-registry.v1';
const DEFAULT_MAX_ACTIVE_LEASES = 64;
const HARD_MAX_ACTIVE_LEASES = 1_024;
const LEASE_ID_ATTEMPTS = 4;
const SAFE_LEASE_ID = /^[A-Za-z0-9._:@-]{1,256}$/;

const PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS = Object.freeze({
  AUTHORITY_UNHEALTHY: 'PROJECT_ROOT_AUTHORITY_UNHEALTHY',
  BACKEND_REJECTED: 'PROJECT_ROOT_BACKEND_REJECTED',
  CAPACITY_EXCEEDED: 'PROJECT_ROOT_CAPACITY_EXCEEDED',
  CLOSE_FAILED: 'PROJECT_ROOT_CLOSE_FAILED',
  DISPOSED: 'PROJECT_ROOT_AUTHORITY_DISPOSED',
  INVALID_REQUEST: 'PROJECT_ROOT_INVALID_REQUEST',
  LEASE_ID_UNAVAILABLE: 'PROJECT_ROOT_LEASE_ID_UNAVAILABLE',
  LEASE_MISMATCH: 'PROJECT_ROOT_LEASE_MISMATCH',
  LEASE_NOT_FOUND: 'PROJECT_ROOT_LEASE_NOT_FOUND',
  REENTRANT_CALL: 'PROJECT_ROOT_REENTRANT_CALL',
  ROOT_BUSY: 'PROJECT_ROOT_BUSY',
  UNAVAILABLE: 'PROJECT_ROOT_AUTHORITY_UNAVAILABLE',
});

const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);

function denied(code) {
  return Object.freeze({ ok: false, code });
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
    preflightDataGraph(error);
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      preflightDataGraph(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeAcquireInput(value) {
  const fields = exactDataFields(value, [
    'binding',
    'expectedPhysicalRootIdentityDigest',
    'purpose',
  ]);
  if (!fields) return null;
  try {
    const binding = createCapabilityDelegationBinding(fields.get('binding'));
    const expectedPhysicalRootIdentityDigest = normalizeDigest(
      fields.get('expectedPhysicalRootIdentityDigest'),
      'expectedPhysicalRootIdentityDigest'
    );
    const purpose = fields.get('purpose');
    const canonical = createProjectRootAuthorityAcquireRequest({
      leaseId: 'project-root-input-validation',
      binding,
      expectedPhysicalRootIdentityDigest,
      purpose,
    });
    return Object.freeze({
      binding,
      expectedPhysicalRootIdentityDigest,
      purpose: canonical.purpose,
    });
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
}

function normalizeReleaseInput(value) {
  const fields = exactDataFields(value, ['binding', 'leaseId']);
  if (!fields) return null;
  try {
    const binding = createCapabilityDelegationBinding(fields.get('binding'));
    const leaseId = fields.get('leaseId');
    if (typeof leaseId !== 'string' || !SAFE_LEASE_ID.test(leaseId)) return null;
    return Object.freeze({ binding, leaseId });
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
}

function bindingsMatch(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function acquireInputsMatch(left, right) {
  return bindingsMatch(left.binding, right.binding)
    && left.expectedPhysicalRootIdentityDigest === right.expectedPhysicalRootIdentityDigest
    && left.purpose === right.purpose;
}

function rootOverlaps(left, right) {
  return left.expectedPhysicalRootIdentityDigest === right.expectedPhysicalRootIdentityDigest
    || portablePathsOverlap(left.binding.canonicalRootPath, right.binding.canonicalRootPath)
    || portablePathsOverlap(left.binding.realRootPath, right.binding.realRootPath);
}

function defaultLeaseIdFactory() {
  return `project-root-lease-${crypto.randomUUID()}`;
}

function captureBackend(value) {
  const backend = assertProjectRootAuthorityBackend(value);
  const captured = {};
  for (const key of ['version', 'id', 'probe', 'acquire', 'dispose']) {
    const descriptor = Object.getOwnPropertyDescriptor(backend, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Project-root authority backend must expose own data methods');
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

function createProjectRootAuthorityRegistry(options = {}) {
  const optionFields = exactDataFields(
    options,
    ['backend', 'leaseIdFactory', 'maxActiveLeases'],
    []
  );
  if (!optionFields) throw new TypeError('Invalid project-root authority registry options');
  const backend = captureBackend(optionFields.has('backend')
    ? optionFields.get('backend')
    : createUnsupportedProjectRootAuthorityBackend());
  const leaseIdFactory = optionFields.has('leaseIdFactory')
    ? optionFields.get('leaseIdFactory')
    : defaultLeaseIdFactory;
  const maxActiveLeases = optionFields.has('maxActiveLeases')
    ? optionFields.get('maxActiveLeases')
    : DEFAULT_MAX_ACTIVE_LEASES;
  if (typeof leaseIdFactory !== 'function' || util.types.isProxy(leaseIdFactory)
    || util.types.isAsyncFunction(leaseIdFactory)
    || util.types.isGeneratorFunction(leaseIdFactory)) {
    throw new TypeError('Project-root authority leaseIdFactory must be synchronous');
  }
  if (!Number.isSafeInteger(maxActiveLeases) || maxActiveLeases < 1
    || maxActiveLeases > HARD_MAX_ACTIVE_LEASES) {
    throw new TypeError('Project-root authority maxActiveLeases is invalid');
  }

  const recordsByJobId = new Map();
  const closedByLeaseId = new Map();
  let backendProbe = null;
  let backendState = 'unknown';
  let callDepth = 0;
  let closedCount = 0;
  let disposed = false;
  let healthy = true;

  function invokeProvider(receiver, method, args, fieldName) {
    let value;
    callDepth += 1;
    try {
      value = Reflect.apply(method, receiver, args);
    } catch (error) {
      preflightDataGraph(error);
      throw error;
    } finally {
      callDepth -= 1;
    }
    if (util.types.isPromise(value)) {
      preflightDataGraph(value);
      throw new TypeError(`${fieldName} must be synchronous`);
    }
    return value;
  }

  function readBackendProbe() {
    if (backendProbe) return backendProbe;
    if (callDepth > 0) return null;
    try {
      backendProbe = assertProjectRootAuthorityProbeResult(
        invokeProvider(backend, backend.probe, [], 'backend.probe')
      );
      backendState = backendProbe.state;
      if (backendProbe.state === PROJECT_ROOT_AUTHORITY_STATES.ENFORCED
        && !PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES.every(
          (guarantee) => backendProbe.guarantees.includes(guarantee)
        )) {
        throw new TypeError('Project-root authority probe omitted guarantees');
      }
      return backendProbe;
    } catch (error) {
      preflightDataGraph(error);
      backendState = 'rejected';
      healthy = false;
      return null;
    }
  }

  function poisonRecord(record) {
    healthy = false;
    if (record && record.state !== 'closed') record.state = 'quarantined';
  }

  function assertRecordReadable(record) {
    if (!healthy || disposed || recordsByJobId.get(record.input.binding.jobId) !== record
      || record.state !== 'active') {
      const error = new Error('Project-root authority lease is closed or inactive');
      error.code = PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.AUTHORITY_UNHEALTHY;
      throw error;
    }
    if (callDepth > 0) {
      const error = new Error('Project-root authority rejected a reentrant reader call');
      error.code = PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL;
      throw error;
    }
  }

  function createReaderFacade(record, providerReader) {
    const listMethod = Object.getOwnPropertyDescriptor(providerReader, 'list').value;
    const readFileMethod = Object.getOwnPropertyDescriptor(providerReader, 'readFile').value;
    return Object.freeze({
      version: PROJECT_ROOT_READER_VERSION,
      list(input) {
        const request = createProjectRootListRequest(input);
        assertRecordReadable(record);
        let result;
        try {
          result = invokeProvider(providerReader, listMethod, [request], 'reader.list');
        } catch (error) {
          preflightDataGraph(error);
          throw error;
        }
        try {
          return assertProjectRootListResult(result, request);
        } catch (error) {
          poisonRecord(record);
          throw new TypeError('Project-root authority reader returned an invalid list result');
        }
      },
      readFile(input) {
        const request = createProjectRootReadFileRequest(input);
        assertRecordReadable(record);
        let result;
        try {
          result = invokeProvider(providerReader, readFileMethod, [request], 'reader.readFile');
        } catch (error) {
          preflightDataGraph(error);
          throw error;
        }
        try {
          return assertProjectRootReadFileResult(result, request);
        } catch (error) {
          poisonRecord(record);
          throw new TypeError('Project-root authority reader returned an invalid read result');
        }
      },
    });
  }

  function closeRecord(record) {
    if (record.state === 'closed') {
      return Object.freeze({ ok: true, receipt: record.closeReceipt, idempotent: true });
    }
    if (record.state !== 'active' || callDepth > 0) {
      return denied(callDepth > 0
        ? PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL
        : PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.AUTHORITY_UNHEALTHY);
    }
    let receipt;
    try {
      const result = invokeProvider(
        record.providerLease,
        record.providerClose,
        [],
        'lease.close'
      );
      receipt = assertProjectRootAuthorityCloseReceipt(result, record.request);
    } catch (error) {
      preflightDataGraph(error);
      poisonRecord(record);
      return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CLOSE_FAILED);
    }
    record.state = 'closed';
    record.closeReceipt = receipt;
    closedCount += 1;
    recordsByJobId.delete(record.input.binding.jobId);
    closedByLeaseId.set(record.request.leaseId, Object.freeze({
      binding: record.input.binding,
      receipt,
    }));
    return Object.freeze({ ok: true, receipt, idempotent: false });
  }

  function createLeaseFacade(record, providerLease) {
    const reader = createReaderFacade(record, providerLease.reader);
    const lease = Object.freeze({
      version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
      leaseId: record.request.leaseId,
      jobId: record.input.binding.jobId,
      projectId: record.input.binding.projectId,
      purpose: record.input.purpose,
      physicalRootIdentityDigest: record.input.expectedPhysicalRootIdentityDigest,
      authorityDigest: record.request.authorityDigest,
      reader,
      close() {
        const result = closeRecord(record);
        if (!result.ok) {
          const error = new Error('Project-root authority lease did not close');
          error.code = result.code;
          throw error;
        }
        return result.receipt;
      },
    });
    return assertProjectRootAuthorityLease(lease, record.request);
  }

  function nextLeaseId() {
    for (let attempt = 0; attempt < LEASE_ID_ATTEMPTS; attempt += 1) {
      let candidate;
      callDepth += 1;
      try { candidate = leaseIdFactory(); } catch (error) {
        preflightDataGraph(error);
        return null;
      } finally {
        callDepth -= 1;
      }
      if (util.types.isPromise(candidate)) {
        preflightDataGraph(candidate);
        return null;
      }
      if (typeof candidate === 'string' && SAFE_LEASE_ID.test(candidate)
        && !closedByLeaseId.has(candidate)
        && ![...recordsByJobId.values()].some(
          (record) => record.request && record.request.leaseId === candidate
        )) return candidate;
    }
    return null;
  }

  function acquire(input) {
    if (callDepth > 0) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL);
    if (disposed) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.DISPOSED);
    if (!healthy) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.AUTHORITY_UNHEALTHY);
    const normalized = normalizeAcquireInput(input);
    if (!normalized) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.INVALID_REQUEST);
    const existing = recordsByJobId.get(normalized.binding.jobId);
    if (existing) {
      if (existing.state === 'active' && acquireInputsMatch(existing.input, normalized)) {
        return Object.freeze({ ok: true, lease: existing.lease, idempotent: true });
      }
      return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_MISMATCH);
    }
    const occupied = [...recordsByJobId.values()].filter(
      (record) => record.state === 'active' || record.state === 'quarantined'
    );
    if (occupied.length >= maxActiveLeases) {
      return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CAPACITY_EXCEEDED);
    }
    if (occupied.some((record) => rootOverlaps(record.input, normalized))) {
      return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.ROOT_BUSY);
    }
    const probe = readBackendProbe();
    if (!probe) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED);
    if (probe.state !== PROJECT_ROOT_AUTHORITY_STATES.ENFORCED) {
      return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.UNAVAILABLE);
    }
    const leaseId = nextLeaseId();
    if (!leaseId) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_ID_UNAVAILABLE);
    const request = createProjectRootAuthorityAcquireRequest({
      leaseId,
      binding: normalized.binding,
      expectedPhysicalRootIdentityDigest: normalized.expectedPhysicalRootIdentityDigest,
      purpose: normalized.purpose,
    });
    let providerLease;
    try {
      providerLease = assertProjectRootAuthorityLease(
        invokeProvider(backend, backend.acquire, [request], 'backend.acquire'),
        request
      );
    } catch (error) {
      preflightDataGraph(error);
      healthy = false;
      return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED);
    }
    const record = {
      closeReceipt: null,
      input: normalized,
      lease: null,
      providerClose: Object.getOwnPropertyDescriptor(providerLease, 'close').value,
      providerLease,
      request,
      state: 'active',
    };
    try {
      record.lease = createLeaseFacade(record, providerLease);
    } catch (error) {
      preflightDataGraph(error);
      healthy = false;
      return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED);
    }
    recordsByJobId.set(normalized.binding.jobId, record);
    return Object.freeze({ ok: true, lease: record.lease, idempotent: false });
  }

  function release(input) {
    if (callDepth > 0) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL);
    const normalized = normalizeReleaseInput(input);
    if (!normalized) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.INVALID_REQUEST);
    const closed = closedByLeaseId.get(normalized.leaseId);
    if (closed) {
      if (!bindingsMatch(closed.binding, normalized.binding)) {
        return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_MISMATCH);
      }
      return Object.freeze({ ok: true, closed: true, idempotent: true });
    }
    const record = recordsByJobId.get(normalized.binding.jobId);
    if (!record) return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_NOT_FOUND);
    if (!bindingsMatch(record.input.binding, normalized.binding)
      || record.request.leaseId !== normalized.leaseId) {
      return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_MISMATCH);
    }
    const result = closeRecord(record);
    if (!result.ok) return result;
    return Object.freeze({ ok: true, closed: true, idempotent: result.idempotent });
  }

  function diagnostics() {
    let active = 0;
    let quarantined = 0;
    for (const record of recordsByJobId.values()) {
      if (record.state === 'active') active += 1;
      if (record.state === 'quarantined') quarantined += 1;
    }
    return Object.freeze({
      version: PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION,
      backendState,
      healthy,
      disposed,
      active,
      closed: closedCount,
      quarantined,
      maxActiveLeases,
    });
  }

  function dispose() {
    if (callDepth > 0) {
      return Object.freeze({
        ok: false,
        disposed: false,
        quarantined: diagnostics().quarantined,
        code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL,
      });
    }
    if (disposed) {
      return Object.freeze({
        ok: true,
        disposed: true,
        quarantined: diagnostics().quarantined,
      });
    }
    let failed = false;
    for (const record of [...recordsByJobId.values()]) {
      if (record.state === 'active' && !closeRecord(record).ok) failed = true;
    }
    let backendDisposed = false;
    try {
      const result = invokeProvider(backend, backend.dispose, [], 'backend.dispose');
      const fields = exactDataFields(result, ['ok', 'disposed']);
      backendDisposed = Boolean(fields
        && fields.get('ok') === true
        && fields.get('disposed') === true);
    } catch (error) {
      preflightDataGraph(error);
    }
    if (!backendDisposed) {
      healthy = false;
      failed = true;
    }
    disposed = backendDisposed;
    const quarantined = diagnostics().quarantined;
    if (failed || quarantined > 0) {
      return Object.freeze({
        ok: false,
        disposed,
        quarantined,
        code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CLOSE_FAILED,
      });
    }
    return Object.freeze({ ok: true, disposed: true, quarantined: 0 });
  }

  return Object.freeze({ acquire, diagnostics, dispose, release });
}

module.exports = {
  PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS,
  PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION,
  createProjectRootAuthorityRegistry,
};
