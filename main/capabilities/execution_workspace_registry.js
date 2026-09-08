'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  assertExecutionWorkspaceBackend,
  assertExecutionWorkspaceDiscardReceipt,
  assertExecutionWorkspaceLease,
  assertExecutionWorkspaceProbeResult,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardRequest,
  createUnsupportedExecutionWorkspaceBackend,
  portablePathsOverlap,
  preflightDataGraph,
} = require('./execution_workspace_contract');
const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('./capability_delegation_contracts');

const EXECUTION_WORKSPACE_REGISTRY_VERSION = 'execution-workspace-registry.v1';
const DEFAULT_MAX_ACTIVE_WORKSPACES = 64;
const HARD_MAX_ACTIVE_WORKSPACES = 1_024;
const LEASE_ID_ATTEMPTS = 4;
const SAFE_LEASE_ID = /^[A-Za-z0-9._:@-]{1,256}$/;

const EXECUTION_WORKSPACE_REGISTRY_REASONS = Object.freeze({
  BACKEND_REJECTED: 'WORKSPACE_BACKEND_REJECTED',
  CAPACITY_EXCEEDED: 'WORKSPACE_CAPACITY_EXCEEDED',
  DISPOSED: 'WORKSPACE_REGISTRY_DISPOSED',
  INVALID_REQUEST: 'WORKSPACE_INVALID_REQUEST',
  LEASE_DISCARDED: 'WORKSPACE_LEASE_DISCARDED',
  LEASE_ID_UNAVAILABLE: 'WORKSPACE_LEASE_ID_UNAVAILABLE',
  LEASE_MISMATCH: 'WORKSPACE_LEASE_MISMATCH',
  REENTRANT_CALL: 'WORKSPACE_REENTRANT_CALL',
  ROLLBACK_FAILED: 'WORKSPACE_ROLLBACK_FAILED',
  SOURCE_BUSY: 'WORKSPACE_SOURCE_BUSY',
  UNAVAILABLE: 'WORKSPACE_UNAVAILABLE',
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

function frozenResult(value) {
  return Object.freeze(value);
}

function denied(code) {
  return frozenResult({ ok: false, code });
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
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
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
  const fields = exactDataFields(value, ['binding', 'sourceRootIdentityDigest']);
  if (!fields) return null;
  try {
    return Object.freeze({
      binding: createCapabilityDelegationBinding(fields.get('binding')),
      sourceRootIdentityDigest: normalizeDigest(
        fields.get('sourceRootIdentityDigest'),
        'sourceRootIdentityDigest'
      ),
    });
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
}

function normalizeRollbackInput(value) {
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
  return left.sourceRootIdentityDigest === right.sourceRootIdentityDigest
    && bindingsMatch(left.binding, right.binding);
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return Object.freeze({ promise, resolve });
}

function defaultLeaseIdFactory() {
  return `workspace-lease-${crypto.randomUUID()}`;
}

function captureBackend(value) {
  const backend = assertExecutionWorkspaceBackend(value);
  const fields = new Map();
  for (const key of ['version', 'id', 'probe', 'acquire', 'discard', 'dispose']) {
    const descriptor = Object.getOwnPropertyDescriptor(backend, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Execution workspace backend must expose own data methods');
    }
    fields.set(key, descriptor.value);
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

function invokeBackend(receiver, method, args, normalizeResult, callState = null) {
  let raw;
  if (callState) callState.depth += 1;
  try {
    raw = Reflect.apply(method, receiver, args);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.reject(new TypeError('Execution workspace backend call failed'));
  } finally {
    if (callState) callState.depth -= 1;
  }

  const normalize = (value) => {
    try {
      return normalizeResult(value);
    } catch (error) {
      preflightDataGraph(error);
      throw new TypeError('Execution workspace backend returned invalid data');
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
      try {
        resolve(normalize(value));
      } catch (error) {
        reject(error);
      }
    };
    const onRejected = (error) => {
      preflightDataGraph(error);
      reject(new TypeError('Execution workspace backend promise rejected'));
    };
    try {
      Reflect.apply(Promise.prototype.then, raw, [onFulfilled, onRejected]);
    } catch (error) {
      preflightDataGraph(raw);
      preflightDataGraph(error);
      reject(new TypeError('Execution workspace backend promise was invalid'));
    }
  });
}

function createExecutionWorkspaceRegistry(options = {}) {
  const optionFields = exactDataFields(
    options,
    ['backend', 'leaseIdFactory', 'maxActiveWorkspaces'],
    []
  );
  if (!optionFields) throw new TypeError('Invalid execution workspace registry options');

  const backend = captureBackend(
    optionFields.has('backend')
      ? optionFields.get('backend')
      : createUnsupportedExecutionWorkspaceBackend()
  );
  const leaseIdFactory = optionFields.has('leaseIdFactory')
    ? optionFields.get('leaseIdFactory')
    : defaultLeaseIdFactory;
  const maxActiveWorkspaces = optionFields.has('maxActiveWorkspaces')
    ? optionFields.get('maxActiveWorkspaces')
    : DEFAULT_MAX_ACTIVE_WORKSPACES;
  if (typeof leaseIdFactory !== 'function' || util.types.isProxy(leaseIdFactory)) {
    throw new TypeError('Execution workspace leaseIdFactory must be a function');
  }
  if (!Number.isSafeInteger(maxActiveWorkspaces)
    || maxActiveWorkspaces <= 0
    || maxActiveWorkspaces > HARD_MAX_ACTIVE_WORKSPACES) {
    throw new TypeError('Execution workspace maxActiveWorkspaces is invalid');
  }

  const recordsByJobId = new Map();
  const ownersBySourceIdentity = new Map();
  const ownersByWorkspaceIdentity = new Map();
  const usedLeaseIds = new Set();
  const discardedBindingsByLeaseId = new Map();
  const backendCallState = { depth: 0 };
  let backendState = 'unprobed';
  let probePromise = null;
  let probeResult = null;
  let probeSettled = false;
  let discarded = 0;
  let disposed = false;
  let disposePromise = null;
  let disposeResult = null;

  function releaseReservation(record, { removeJob = true } = {}) {
    if (ownersBySourceIdentity.get(record.input.sourceRootIdentityDigest) === record) {
      ownersBySourceIdentity.delete(record.input.sourceRootIdentityDigest);
    }
    if (removeJob && recordsByJobId.get(record.input.binding.jobId) === record) {
      recordsByJobId.delete(record.input.binding.jobId);
    }
  }

  function recordSourcePaths(record) {
    return [record.input.binding.canonicalRootPath, record.input.binding.realRootPath];
  }

  function recordWorkspacePaths(record) {
    return record.lease
      ? [record.lease.workspaceRootPath, record.lease.workspaceRealRootPath]
      : [];
  }

  function pathSetsOverlap(leftPaths, rightPaths) {
    return leftPaths.some((left) => rightPaths.some((right) => (
      portablePathsOverlap(left, right)
    )));
  }

  function sourceConflicts(input) {
    if (ownersBySourceIdentity.has(input.sourceRootIdentityDigest)
      || ownersByWorkspaceIdentity.has(input.sourceRootIdentityDigest)) return true;
    const sourcePaths = [input.binding.canonicalRootPath, input.binding.realRootPath];
    for (const record of recordsByJobId.values()) {
      if (record.status === 'discarded' || record.status === 'released') continue;
      if (record.lease
        && record.lease.workspaceRootIdentityDigest === input.sourceRootIdentityDigest) return true;
      if (pathSetsOverlap(sourcePaths, recordSourcePaths(record))
        || pathSetsOverlap(sourcePaths, recordWorkspacePaths(record))) return true;
    }
    return false;
  }

  function workspaceConflicts(record, lease) {
    if (ownersBySourceIdentity.has(lease.workspaceRootIdentityDigest)
      || ownersByWorkspaceIdentity.has(lease.workspaceRootIdentityDigest)) return true;
    const workspacePaths = [lease.workspaceRootPath, lease.workspaceRealRootPath];
    for (const other of recordsByJobId.values()) {
      if (other === record || other.status === 'discarded' || other.status === 'released') continue;
      if (other.lease
        && other.lease.workspaceRootIdentityDigest === lease.workspaceRootIdentityDigest) return true;
      if (pathSetsOverlap(workspacePaths, recordSourcePaths(other))
        || pathSetsOverlap(workspacePaths, recordWorkspacePaths(other))) return true;
    }
    return false;
  }

  function claimWorkspace(record, lease) {
    if (workspaceConflicts(record, lease)) return false;
    ownersByWorkspaceIdentity.set(lease.workspaceRootIdentityDigest, record);
    return true;
  }

  function releaseWorkspaceClaim(record) {
    if (record.lease
      && ownersByWorkspaceIdentity.get(record.lease.workspaceRootIdentityDigest) === record) {
      ownersByWorkspaceIdentity.delete(record.lease.workspaceRootIdentityDigest);
    }
  }

  function reservationCount() {
    let count = 0;
    for (const record of recordsByJobId.values()) {
      if (record.status !== 'discarded' && record.status !== 'released') count += 1;
    }
    return count;
  }

  function allocateLeaseId() {
    for (let attempt = 0; attempt < LEASE_ID_ATTEMPTS; attempt += 1) {
      let candidate;
      try {
        candidate = Reflect.apply(leaseIdFactory, undefined, []);
      } catch (error) {
        preflightDataGraph(error);
        continue;
      }
      const preflight = preflightDataGraph(candidate);
      if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
        || typeof candidate !== 'string' || !SAFE_LEASE_ID.test(candidate)
        || usedLeaseIds.has(candidate)) continue;
      usedLeaseIds.add(candidate);
      return candidate;
    }
    return null;
  }

  function ensureProbe() {
    if (probePromise) return probePromise;

    // Publish the deferred before entering provider code. A synchronous provider
    // reentry must observe this one process-wide probe rather than start another.
    const deferred = createDeferred();
    probePromise = deferred.promise;
    invokeBackend(
      backend,
      backend.probe,
      [Object.freeze({ requiredGuarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES })],
      (value) => assertExecutionWorkspaceProbeResult(value),
      backendCallState
    ).then(
      (probe) => {
        backendState = probe.state;
        probeResult = probe;
        probeSettled = true;
        deferred.resolve(probe);
      },
      (error) => {
        preflightDataGraph(error);
        backendState = EXECUTION_WORKSPACE_STATES.UNAVAILABLE;
        probeResult = null;
        probeSettled = true;
        deferred.resolve(null);
      }
    ).catch((error) => {
      preflightDataGraph(error);
      backendState = EXECUTION_WORKSPACE_STATES.UNAVAILABLE;
      probeResult = null;
      probeSettled = true;
      deferred.resolve(null);
    });
    return probePromise;
  }

  function quarantine(record) {
    record.status = 'quarantined';
  }

  function beginAcquire(record) {
    queueMicrotask(() => {
      const acceptProbe = (probe) => {
        if (disposed) {
          record.status = 'released';
          releaseReservation(record);
          record.resolveAcquire(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.DISPOSED));
          return;
        }
        if (!probe || probe.state !== EXECUTION_WORKSPACE_STATES.ENFORCED) {
          record.status = 'released';
          releaseReservation(record);
          record.resolveAcquire(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.UNAVAILABLE));
          return;
        }
        record.providerStarted = true;
        invokeBackend(
          backend,
          backend.acquire,
          [record.request],
          (value) => assertExecutionWorkspaceLease(value, record.request),
          backendCallState
        ).then(
          (lease) => {
            record.lease = lease;
            if (!claimWorkspace(record, lease)) {
              quarantine(record);
              record.resolveAcquire(denied(
                EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED
              ));
              return;
            }
            record.status = 'active';
            record.resolveAcquire(disposed
              ? denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.DISPOSED)
              : frozenResult({ ok: true, lease }));
          },
          () => {
            quarantine(record);
            record.resolveAcquire(denied(
              EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED
            ));
          }
        ).catch((error) => {
          preflightDataGraph(error);
          quarantine(record);
          record.resolveAcquire(denied(
            EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED
          ));
        });
      };
      const rejectProbe = (error) => {
        preflightDataGraph(error);
        if (record.providerStarted) quarantine(record);
        else {
          record.status = 'released';
          releaseReservation(record);
        }
        record.resolveAcquire(denied(
          disposed
            ? EXECUTION_WORKSPACE_REGISTRY_REASONS.DISPOSED
            : record.providerStarted
            ? EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED
            : EXECUTION_WORKSPACE_REGISTRY_REASONS.UNAVAILABLE
        ));
      };
      if (probeSettled) {
        acceptProbe(probeResult);
      } else {
        ensureProbe().then(acceptProbe, rejectProbe);
      }
    });
  }

  function acquire(input) {
    const normalized = normalizeAcquireInput(input);
    if (!normalized) {
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.INVALID_REQUEST));
    }
    if (backendCallState.depth > 0) {
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.REENTRANT_CALL));
    }
    if (disposed) {
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.DISPOSED));
    }

    const existingJob = recordsByJobId.get(normalized.binding.jobId);
    if (existingJob) {
      if (!acquireInputsMatch(existingJob.input, normalized)) {
        return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.LEASE_MISMATCH));
      }
      switch (existingJob.status) {
        case 'allocating':
        case 'active':
          return existingJob.acquirePromise;
        case 'discarding':
          return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.SOURCE_BUSY));
        case 'quarantined':
          return Promise.resolve(denied(
            EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED
          ));
        case 'discarded':
          // A completed rollback is a tombstone for the old lease, not a
          // permanent ban on refreshing this job's source snapshot. The old
          // lease id can no longer match the replacement record.
          recordsByJobId.delete(normalized.binding.jobId);
          break;
        default:
          return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.UNAVAILABLE));
      }
    }

    if (sourceConflicts(normalized)) {
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.SOURCE_BUSY));
    }
    if (reservationCount() >= maxActiveWorkspaces) {
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.CAPACITY_EXCEEDED));
    }

    const deferred = createDeferred();
    const record = {
      input: normalized,
      request: null,
      lease: null,
      status: 'allocating',
      providerStarted: false,
      acquirePromise: deferred.promise,
      resolveAcquire: deferred.resolve,
      rollbackPromise: null,
    };
    recordsByJobId.set(normalized.binding.jobId, record);
    ownersBySourceIdentity.set(normalized.sourceRootIdentityDigest, record);

    const leaseId = allocateLeaseId();
    if (!leaseId) {
      record.status = 'released';
      releaseReservation(record);
      record.resolveAcquire(denied(
        EXECUTION_WORKSPACE_REGISTRY_REASONS.LEASE_ID_UNAVAILABLE
      ));
      return record.acquirePromise;
    }
    try {
      record.request = createExecutionWorkspaceAcquireRequest({
        leaseId,
        binding: normalized.binding,
        sourceRootIdentityDigest: normalized.sourceRootIdentityDigest,
      });
    } catch (error) {
      preflightDataGraph(error);
      record.status = 'released';
      releaseReservation(record);
      record.resolveAcquire(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.INVALID_REQUEST));
      return record.acquirePromise;
    }
    // Start the one process-wide probe only after this source/job reservation
    // exists. A synchronous probe settles before the queued provider acquire,
    // so a reentrant acquire still observes the reservation first.
    ensureProbe();
    beginAcquire(record);
    return record.acquirePromise;
  }

  function finishDiscard(record, result) {
    record.rollbackPromise = null;
    record.resolveRollback(result);
    record.resolveRollback = null;
  }

  function startDiscard(record) {
    const deferred = createDeferred();
    record.rollbackPromise = deferred.promise;
    record.resolveRollback = deferred.resolve;

    queueMicrotask(() => {
      record.acquirePromise.then(() => {
        if (record.status !== 'active' || !record.lease) {
          if (record.status !== 'released' && record.status !== 'discarded') quarantine(record);
          finishDiscard(record, denied(
            EXECUTION_WORKSPACE_REGISTRY_REASONS.ROLLBACK_FAILED
          ));
          return null;
        }
        record.status = 'discarding';
        let discardRequest;
        try {
          discardRequest = createExecutionWorkspaceDiscardRequest({
            request: record.request,
            lease: record.lease,
          });
        } catch (error) {
          preflightDataGraph(error);
          quarantine(record);
          finishDiscard(record, denied(
            EXECUTION_WORKSPACE_REGISTRY_REASONS.ROLLBACK_FAILED
          ));
          return null;
        }
        return invokeBackend(
          backend,
          backend.discard,
          [discardRequest],
          (value) => assertExecutionWorkspaceDiscardReceipt(value, discardRequest),
          backendCallState
        ).then(
          () => {
            record.status = 'discarded';
            discarded += 1;
            releaseWorkspaceClaim(record);
            discardedBindingsByLeaseId.set(
              record.request.leaseId,
              record.input.binding
            );
            record.lease = null;
            releaseReservation(record, { removeJob: false });
            finishDiscard(record, frozenResult({
              ok: true,
              rolledBack: true,
              idempotent: false,
            }));
          },
          () => {
            quarantine(record);
            finishDiscard(record, denied(
              EXECUTION_WORKSPACE_REGISTRY_REASONS.ROLLBACK_FAILED
            ));
          }
        );
      }).catch((error) => {
        preflightDataGraph(error);
        quarantine(record);
        finishDiscard(record, denied(
          EXECUTION_WORKSPACE_REGISTRY_REASONS.ROLLBACK_FAILED
        ));
      });
    });
    return record.rollbackPromise;
  }

  function rollback(input) {
    const normalized = normalizeRollbackInput(input);
    if (!normalized) {
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.INVALID_REQUEST));
    }
    if (backendCallState.depth > 0) {
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.REENTRANT_CALL));
    }
    if (disposed) {
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.DISPOSED));
    }
    const record = recordsByJobId.get(normalized.binding.jobId);
    if (!record || !bindingsMatch(record.input.binding, normalized.binding)
      || !record.request || record.request.leaseId !== normalized.leaseId) {
      const discardedBinding = discardedBindingsByLeaseId.get(normalized.leaseId);
      if (discardedBinding && bindingsMatch(discardedBinding, normalized.binding)) {
        return Promise.resolve(frozenResult({
          ok: true,
          rolledBack: true,
          idempotent: true,
        }));
      }
      return Promise.resolve(denied(EXECUTION_WORKSPACE_REGISTRY_REASONS.LEASE_MISMATCH));
    }
    if (record.status === 'discarded') {
      return Promise.resolve(frozenResult({
        ok: true,
        rolledBack: true,
        idempotent: true,
      }));
    }
    if (record.rollbackPromise) return record.rollbackPromise;
    return startDiscard(record);
  }

  function discardForDispose(record) {
    if (record.status === 'discarded' || record.status === 'released') {
      return Promise.resolve();
    }
    if (record.status === 'quarantined') return Promise.resolve();
    if (record.rollbackPromise) return record.rollbackPromise.then(() => undefined);
    return startDiscard(record).then(() => undefined);
  }

  function diagnostics() {
    const counts = {
      allocating: 0,
      active: 0,
      discarding: 0,
      quarantined: 0,
    };
    for (const record of recordsByJobId.values()) {
      if (Object.hasOwn(counts, record.status)) counts[record.status] += 1;
    }
    return frozenResult({
      version: EXECUTION_WORKSPACE_REGISTRY_VERSION,
      backendState,
      disposed,
      allocating: counts.allocating,
      active: counts.active,
      discarding: counts.discarding,
      quarantined: counts.quarantined,
      discarded,
      maxActiveWorkspaces,
    });
  }

  function dispose() {
    if (backendCallState.depth > 0) {
      return Promise.resolve(frozenResult({
        ok: false,
        disposed,
        quarantined: diagnostics().quarantined,
        code: EXECUTION_WORKSPACE_REGISTRY_REASONS.REENTRANT_CALL,
      }));
    }
    if (disposePromise) return disposePromise;
    if (disposeResult) return Promise.resolve(disposeResult);
    disposed = true;
    disposePromise = Promise.all([...recordsByJobId.values()].map(discardForDispose))
      .then(() => invokeBackend(
        backend,
        backend.dispose,
        [],
        (value) => {
          const preflight = preflightDataGraph(value);
          if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable) {
            throw new TypeError('Execution workspace backend dispose result is invalid');
          }
          return undefined;
        },
        backendCallState
      ))
      .then(
        () => {
          const quarantined = diagnostics().quarantined;
          disposeResult = frozenResult({
            ok: quarantined === 0,
            disposed: true,
            quarantined,
          });
          disposePromise = null;
          return disposeResult;
        },
        (error) => {
          preflightDataGraph(error);
          const quarantined = diagnostics().quarantined;
          disposeResult = frozenResult({ ok: false, disposed: true, quarantined });
          disposePromise = null;
          return disposeResult;
        }
      );
    return disposePromise;
  }

  return Object.freeze({
    version: EXECUTION_WORKSPACE_REGISTRY_VERSION,
    acquire,
    rollback,
    diagnostics,
    dispose,
  });
}

module.exports = {
  EXECUTION_WORKSPACE_REGISTRY_REASONS,
  EXECUTION_WORKSPACE_REGISTRY_VERSION,
  createExecutionWorkspaceRegistry,
};
