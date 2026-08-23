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
  assertProjectRootEntryInspectionResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootEntryInspectionRequest,
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

const PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION = 'project-root-authority-registry.v2';
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

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return Object.freeze({ promise, resolve });
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
  let disposeRequested = false;
  let disposePromise = null;
  let disposeResult = null;
  let healthy = true;

  function invokeSynchronousProvider(receiver, method, args, fieldName) {
    let value;
    callDepth += 1;
    try {
      value = Reflect.apply(method, receiver, args);
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError(`${fieldName} failed`);
    } finally {
      callDepth -= 1;
    }
    if (util.types.isPromise(value)) {
      preflightDataGraph(value);
      throw new TypeError(`${fieldName} must remain synchronous`);
    }
    return value;
  }

  function invokeAsyncProvider(receiver, method, args, normalizeResult, fieldName) {
    let raw;
    callDepth += 1;
    try {
      raw = Reflect.apply(method, receiver, args);
    } catch (error) {
      preflightDataGraph(error);
      return Promise.reject(new TypeError(`${fieldName} failed`));
    } finally {
      callDepth -= 1;
    }

    const normalize = (value) => {
      try {
        return normalizeResult(value);
      } catch (error) {
        preflightDataGraph(error);
        throw new TypeError(`${fieldName} returned invalid data`);
      }
    };
    if (!util.types.isPromise(raw)) {
      try {
        return Promise.resolve(normalize(raw));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise((resolve, reject) => {
      const onFulfilled = (value) => {
        try { resolve(normalize(value)); } catch (error) { reject(error); }
      };
      const onRejected = (error) => {
        preflightDataGraph(error);
        reject(new TypeError(`${fieldName} promise rejected`));
      };
      try {
        Reflect.apply(Promise.prototype.then, raw, [onFulfilled, onRejected]);
      } catch (error) {
        preflightDataGraph(raw);
        preflightDataGraph(error);
        reject(new TypeError(`${fieldName} promise was invalid`));
      }
    });
  }

  function readBackendProbe() {
    if (backendProbe) return backendProbe;
    if (callDepth > 0) return null;
    try {
      backendProbe = assertProjectRootAuthorityProbeResult(
        invokeSynchronousProvider(backend, backend.probe, [], 'backend.probe')
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
    if (!healthy || disposeRequested || disposed
      || recordsByJobId.get(record.input.binding.jobId) !== record
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

  function beginReaderOperation(record, providerReader, method, request, normalize, label) {
    try { assertRecordReadable(record); } catch (error) { return Promise.reject(error); }
    const operation = invokeAsyncProvider(
      providerReader,
      method,
      [request],
      (value) => normalize(value, request),
      label
    );
    let tracked;
    tracked = operation.then(
      (value) => {
        record.pendingOperations.delete(tracked);
        return value;
      },
      (error) => {
        preflightDataGraph(error);
        record.pendingOperations.delete(tracked);
        poisonRecord(record);
        throw new TypeError(`Project-root authority ${label} failed`);
      }
    );
    record.pendingOperations.add(tracked);
    return tracked;
  }

  function createReaderFacade(record, providerReader) {
    const listMethod = Object.getOwnPropertyDescriptor(providerReader, 'list').value;
    const readFileMethod = Object.getOwnPropertyDescriptor(providerReader, 'readFile').value;
    const inspectEntryMethod = Object.getOwnPropertyDescriptor(providerReader, 'inspectEntry').value;
    return Object.freeze({
      version: PROJECT_ROOT_READER_VERSION,
      inspectEntry(input) {
        let request;
        try { request = createProjectRootEntryInspectionRequest(input); } catch (error) {
          preflightDataGraph(error);
          return Promise.reject(new TypeError('Invalid project-root inspection request'));
        }
        return beginReaderOperation(
          record,
          providerReader,
          inspectEntryMethod,
          request,
          assertProjectRootEntryInspectionResult,
          'reader.inspectEntry'
        );
      },
      list(input) {
        let request;
        try { request = createProjectRootListRequest(input); } catch (error) {
          preflightDataGraph(error);
          return Promise.reject(new TypeError('Invalid project-root list request'));
        }
        return beginReaderOperation(
          record,
          providerReader,
          listMethod,
          request,
          assertProjectRootListResult,
          'reader.list'
        );
      },
      readFile(input) {
        let request;
        try { request = createProjectRootReadFileRequest(input); } catch (error) {
          preflightDataGraph(error);
          return Promise.reject(new TypeError('Invalid project-root read request'));
        }
        return beginReaderOperation(
          record,
          providerReader,
          readFileMethod,
          request,
          assertProjectRootReadFileResult,
          'reader.readFile'
        );
      },
    });
  }

  function closeRecord(record) {
    if (record.state === 'closed') {
      return Promise.resolve(Object.freeze({
        ok: true,
        receipt: record.closeReceipt,
        idempotent: true,
      }));
    }
    if (record.closePromise) return record.closePromise;
    if (callDepth > 0) {
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL));
    }
    record.closeRequested = true;
    const deferred = createDeferred();
    record.closePromise = deferred.promise;
    queueMicrotask(() => {
      const acquisition = record.state === 'allocating'
        ? record.acquirePromise
        : Promise.resolve();
      acquisition.then(() => {
        if (!record.providerLease || !record.providerClose
          || !['active', 'quarantined', 'closing'].includes(record.state)) {
          return denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CLOSE_FAILED);
        }
        record.state = 'closing';
        return Promise.allSettled([...record.pendingOperations]).then(() => (
          invokeAsyncProvider(
            record.providerLease,
            record.providerClose,
            [],
            (value) => assertProjectRootAuthorityCloseReceipt(value, record.request),
            'lease.close'
          ).then((receipt) => Object.freeze({
            ok: true,
            receipt,
            idempotent: false,
          }))
        ));
      }).then(
        (result) => {
          if (!result.ok) {
            poisonRecord(record);
            deferred.resolve(result);
            return;
          }
          record.state = 'closed';
          record.closeReceipt = result.receipt;
          closedCount += 1;
          recordsByJobId.delete(record.input.binding.jobId);
          closedByLeaseId.set(record.request.leaseId, Object.freeze({
            binding: record.input.binding,
            receipt: result.receipt,
          }));
          deferred.resolve(result);
        },
        (error) => {
          preflightDataGraph(error);
          poisonRecord(record);
          deferred.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CLOSE_FAILED));
        }
      );
    });
    return record.closePromise;
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
        if (record.facadeClosePromise) return record.facadeClosePromise;
        record.facadeClosePromise = closeRecord(record).then((result) => {
          if (!result.ok) {
            const error = new Error('Project-root authority lease did not close');
            error.code = result.code;
            throw error;
          }
          return result.receipt;
        });
        return record.facadeClosePromise;
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

  function releaseUnstartedRecord(record) {
    record.state = 'released';
    if (recordsByJobId.get(record.input.binding.jobId) === record) {
      recordsByJobId.delete(record.input.binding.jobId);
    }
  }

  function beginAcquire(record) {
    queueMicrotask(() => {
      const probe = readBackendProbe();
      if (!probe) {
        releaseUnstartedRecord(record);
        record.resolveAcquire(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED));
        return;
      }
      if (probe.state !== PROJECT_ROOT_AUTHORITY_STATES.ENFORCED) {
        releaseUnstartedRecord(record);
        record.resolveAcquire(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.UNAVAILABLE));
        return;
      }
      record.providerStarted = true;
      invokeAsyncProvider(
        backend,
        backend.acquire,
        [record.request],
        (value) => assertProjectRootAuthorityLease(value, record.request),
        'backend.acquire'
      ).then(
        (providerLease) => {
          record.providerLease = providerLease;
          record.providerClose = Object.getOwnPropertyDescriptor(providerLease, 'close').value;
          try {
            record.lease = createLeaseFacade(record, providerLease);
          } catch (error) {
            preflightDataGraph(error);
            poisonRecord(record);
            record.resolveAcquire(denied(
              PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED
            ));
            return;
          }
          record.state = 'active';
          if (disposeRequested) {
            record.resolveAcquire(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.DISPOSED));
            closeRecord(record);
            return;
          }
          record.resolveAcquire(Object.freeze({
            ok: true,
            lease: record.lease,
            idempotent: false,
          }));
          if (record.closeRequested) closeRecord(record);
        },
        (error) => {
          preflightDataGraph(error);
          poisonRecord(record);
          record.resolveAcquire(denied(
            PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED
          ));
        }
      ).catch((error) => {
        preflightDataGraph(error);
        poisonRecord(record);
        record.resolveAcquire(denied(
          PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.BACKEND_REJECTED
        ));
      });
    });
  }

  function acquire(input) {
    const normalized = normalizeAcquireInput(input);
    if (!normalized) {
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.INVALID_REQUEST));
    }
    if (callDepth > 0) {
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL));
    }
    if (disposeRequested || disposed) {
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.DISPOSED));
    }
    if (!healthy) {
      return Promise.resolve(denied(
        PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.AUTHORITY_UNHEALTHY
      ));
    }
    const existing = recordsByJobId.get(normalized.binding.jobId);
    if (existing) {
      if (!acquireInputsMatch(existing.input, normalized)) {
        return Promise.resolve(denied(
          PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_MISMATCH
        ));
      }
      if (existing.state === 'allocating') return existing.acquirePromise;
      if (existing.state === 'active') {
        return Promise.resolve(Object.freeze({
          ok: true,
          lease: existing.lease,
          idempotent: true,
        }));
      }
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.ROOT_BUSY));
    }
    const occupied = [...recordsByJobId.values()].filter(
      (record) => ['allocating', 'active', 'closing', 'quarantined'].includes(record.state)
    );
    if (occupied.length >= maxActiveLeases) {
      return Promise.resolve(denied(
        PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CAPACITY_EXCEEDED
      ));
    }
    if (occupied.some((record) => rootOverlaps(record.input, normalized))) {
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.ROOT_BUSY));
    }
    const deferred = createDeferred();
    const record = {
      acquirePromise: deferred.promise,
      closePromise: null,
      closeReceipt: null,
      closeRequested: false,
      facadeClosePromise: null,
      input: normalized,
      lease: null,
      pendingOperations: new Set(),
      providerClose: null,
      providerLease: null,
      providerStarted: false,
      releasePromise: null,
      request: null,
      resolveAcquire: deferred.resolve,
      state: 'allocating',
    };
    recordsByJobId.set(normalized.binding.jobId, record);
    const leaseId = nextLeaseId();
    if (!leaseId) {
      releaseUnstartedRecord(record);
      record.resolveAcquire(denied(
        PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_ID_UNAVAILABLE
      ));
      return record.acquirePromise;
    }
    try {
      record.request = createProjectRootAuthorityAcquireRequest({
        leaseId,
        binding: normalized.binding,
        expectedPhysicalRootIdentityDigest: normalized.expectedPhysicalRootIdentityDigest,
        purpose: normalized.purpose,
      });
    } catch (error) {
      preflightDataGraph(error);
      releaseUnstartedRecord(record);
      record.resolveAcquire(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.INVALID_REQUEST));
      return record.acquirePromise;
    }
    beginAcquire(record);
    return record.acquirePromise;
  }

  function release(input) {
    const normalized = normalizeReleaseInput(input);
    if (!normalized) {
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.INVALID_REQUEST));
    }
    if (callDepth > 0) {
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL));
    }
    const closed = closedByLeaseId.get(normalized.leaseId);
    if (closed) {
      if (!bindingsMatch(closed.binding, normalized.binding)) {
        return Promise.resolve(denied(
          PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_MISMATCH
        ));
      }
      return Promise.resolve(Object.freeze({ ok: true, closed: true, idempotent: true }));
    }
    const record = recordsByJobId.get(normalized.binding.jobId);
    if (!record) {
      return Promise.resolve(denied(PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_NOT_FOUND));
    }
    if (!bindingsMatch(record.input.binding, normalized.binding)
      || !record.request || record.request.leaseId !== normalized.leaseId) {
      return Promise.resolve(denied(
        PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.LEASE_MISMATCH
      ));
    }
    if (record.releasePromise) return record.releasePromise;
    record.releasePromise = closeRecord(record).then((result) => (
      result.ok
        ? Object.freeze({ ok: true, closed: true, idempotent: result.idempotent })
        : result
    ));
    return record.releasePromise;
  }

  function diagnostics() {
    let active = 0;
    let quarantined = 0;
    for (const record of recordsByJobId.values()) {
      if (['allocating', 'active', 'closing'].includes(record.state)) active += 1;
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
      return Promise.resolve(Object.freeze({
        ok: false,
        disposed: false,
        quarantined: diagnostics().quarantined,
        code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.REENTRANT_CALL,
      }));
    }
    if (disposePromise) return disposePromise;
    if (disposeResult) return Promise.resolve(disposeResult);
    disposeRequested = true;
    const records = [...recordsByJobId.values()];
    disposePromise = Promise.all(records.map((record) => (
      closeRecord(record).then((result) => result.ok)
    ))).then((closedResults) => invokeAsyncProvider(
      backend,
      backend.dispose,
      [],
      (value) => {
        const fields = exactDataFields(value, ['ok', 'disposed']);
        if (!fields || fields.get('ok') !== true || fields.get('disposed') !== true) {
          throw new TypeError('Invalid backend dispose receipt');
        }
        return true;
      },
      'backend.dispose'
    ).then(
      () => {
        disposed = true;
        const quarantined = diagnostics().quarantined;
        const failed = closedResults.some((closed) => !closed) || quarantined > 0;
        disposeResult = failed
          ? Object.freeze({
            ok: false,
            disposed: true,
            quarantined,
            code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CLOSE_FAILED,
          })
          : Object.freeze({ ok: true, disposed: true, quarantined: 0 });
        disposePromise = null;
        return disposeResult;
      },
      (error) => {
        preflightDataGraph(error);
        healthy = false;
        const quarantined = diagnostics().quarantined;
        disposeResult = Object.freeze({
          ok: false,
          disposed: false,
          quarantined,
          code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CLOSE_FAILED,
        });
        disposePromise = null;
        return disposeResult;
      }
    )).catch((error) => {
      preflightDataGraph(error);
      healthy = false;
      const quarantined = diagnostics().quarantined;
      disposeResult = Object.freeze({
        ok: false,
        disposed: false,
        quarantined,
        code: PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS.CLOSE_FAILED,
      });
      disposePromise = null;
      return disposeResult;
    });
    return disposePromise;
  }

  return Object.freeze({ acquire, diagnostics, dispose, release });
}

module.exports = {
  PROJECT_ROOT_AUTHORITY_REGISTRY_REASONS,
  PROJECT_ROOT_AUTHORITY_REGISTRY_VERSION,
  createProjectRootAuthorityRegistry,
};
