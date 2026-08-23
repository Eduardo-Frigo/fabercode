'use strict';

const util = require('util');

const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  assertExecutionWorkspaceAcquireRequest,
  assertExecutionWorkspaceBackend,
  assertExecutionWorkspaceDiscardReceipt,
  assertExecutionWorkspaceDiscardRequest,
  assertExecutionWorkspaceLease,
  createExecutionWorkspaceProbeResult,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_READER_VERSION,
  assertProjectRootAuthorityAcquireRequest,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityCloseReceipt,
  assertProjectRootAuthorityLease,
  assertProjectRootEntryInspectionResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  createProjectRootAuthorityProbeResult,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
} = require('../capabilities/project_root_authority_contract');
const {
  PROCESS_EXECUTION_STATUSES,
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  assertProcessSupervisorBackend,
  assertProcessSupervisorExecReceipt,
  assertProcessSupervisorExecRequest,
  assertProcessSupervisorReadResult,
  assertProcessSupervisorStopReceipt,
  assertProcessSupervisorWaitResult,
  createProcessSupervisorDisposeReceipt,
  createProcessSupervisorProbeResult,
  createProcessSupervisorStopRequest,
  normalizeReadRequest,
  normalizeStopRequest,
  normalizeWaitRequest,
} = require('../capabilities/process_supervisor_contract');
const {
  immutableSnapshot,
} = require('../capabilities/capability_delegation_contracts');
const {
  PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION,
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION,
  PORTABLE_ISOLATION_HELPER_REQUIREMENTS,
  assertPortableIsolationHelperFailureReceipt,
} = require('../capabilities/portable_isolation_helper_protocol');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
} = require('./portable_isolation_helper_client');
const {
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
} = require('./execution_isolation_provider_factory');

const PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_VERSION =
  'portable-isolation-helper-provider-adapter.v1';
const PORTABLE_ISOLATION_HELPER_PROVIDER_CANDIDATE_VERSION =
  'portable-isolation-helper-provider-candidate.v2';
const PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_DISPOSE_RECEIPT_VERSION =
  'portable-isolation-helper-provider-adapter-dispose-receipt.v1';
const PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION =
  'portable-isolation-root-lease-descriptor.v1';
const PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION =
  'portable-isolation-backend-request.v1';
const PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION =
  'portable-isolation-backend-response.v1';

const MAX_QUEUED_EXCHANGES = 1_024;
const OPTION_KEYS = Object.freeze(['client']);
const CLIENT_KEYS = Object.freeze([
  'version',
  'connect',
  'exchange',
  'quarantine',
  'diagnostics',
  'dispose',
]);
const BACKEND_RESPONSE_KEYS = Object.freeze(['version', 'backendId', 'result']);
const ROOT_DESCRIPTOR_KEYS = Object.freeze([
  'version',
  'leaseId',
  'jobId',
  'projectId',
  'purpose',
  'physicalRootIdentityDigest',
  'authorityDigest',
]);
const CLIENT_DISPOSE_KEYS = Object.freeze([
  'version',
  'disposed',
  'helperShutdownConfirmed',
  'transportClosed',
]);
const HANDSHAKE_KEYS = Object.freeze([
  'accepted',
  'handshakeVersion',
  'protocolVersion',
  'helperId',
  'helperBuildId',
  'helperNonce',
  'sessionId',
  'bundleIdentityDigest',
  'providerVersion',
  'attestationVersion',
  'executionWorkspaceBackendVersion',
  'projectRootAuthorityBackendVersion',
  'processSupervisorBackendVersion',
  'executionWorkspaceBackendId',
  'projectRootAuthorityBackendId',
  'processSupervisorBackendId',
  'platform',
  'requirementsDigest',
  'capabilityDigest',
  'sessionBindingDigest',
]);
const PLATFORM_KEYS = Object.freeze(['os', 'architecture', 'signatureVerification']);
const HANDSHAKE_IDENTIFIER_KEYS = Object.freeze([
  'helperId',
  'helperBuildId',
  'sessionId',
  'executionWorkspaceBackendId',
  'projectRootAuthorityBackendId',
  'processSupervisorBackendId',
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const NONCE = /^[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_OS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const TERMINAL_STATUSES = new Set([
  PROCESS_EXECUTION_STATUSES.SUCCEEDED,
  PROCESS_EXECUTION_STATUSES.FAILED,
  PROCESS_EXECUTION_STATUSES.STOPPED,
  PROCESS_EXECUTION_STATUSES.TIMED_OUT,
]);

class PortableIsolationHelperProviderAdapterError extends Error {
  constructor(code, reasonCode = null, retryable = false) {
    super(code);
    this.name = 'PortableIsolationHelperProviderAdapterError';
    this.code = code;
    this.reasonCode = reasonCode;
    this.retryable = retryable;
  }
}

function adapterError(code, reasonCode = null, retryable = false) {
  return new PortableIsolationHelperProviderAdapterError(code, reasonCode, retryable);
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // Never invoke a userland `.then` fallback.
  }
  return true;
}

function exactDataFields(value, allowedKeys, requiredKeys, code) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) throw adapterError(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw adapterError(code);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) throw adapterError(code);
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      throw adapterError(code);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw adapterError(code);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function captureClient(value) {
  const fields = exactDataFields(value, CLIENT_KEYS, CLIENT_KEYS, 'ADAPTER_CLIENT_INVALID');
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_CLIENT_VERSION) {
    throw adapterError('ADAPTER_CLIENT_INVALID');
  }
  const captured = { receiver: value };
  for (const methodName of ['connect', 'exchange', 'quarantine', 'diagnostics', 'dispose']) {
    const method = fields.get(methodName);
    if (typeof method !== 'function' || util.types.isProxy(method)) {
      throw adapterError('ADAPTER_CLIENT_INVALID');
    }
    captured[methodName] = method;
  }
  return Object.freeze(captured);
}

function settledOutcome(value) {
  if (!util.types.isPromise(value)) {
    return Promise.resolve(Object.freeze({ ok: false, value: null }));
  }
  return new Promise((resolve) => {
    const onFulfilled = (result) => resolve(Object.freeze({ ok: true, value: result }));
    const onRejected = (reason) => {
      absorbNativePromise(reason);
      resolve(Object.freeze({ ok: false, value: null }));
    };
    try {
      Reflect.apply(Promise.prototype.then, value, [onFulfilled, onRejected]);
    } catch (error) {
      absorbNativePromise(error);
      resolve(Object.freeze({ ok: false, value: null }));
    }
  });
}

function normalizeHandshake(value) {
  const fields = exactDataFields(
    value,
    HANDSHAKE_KEYS,
    HANDSHAKE_KEYS,
    'ADAPTER_HANDSHAKE_INVALID'
  );
  const platformFields = exactDataFields(
    fields.get('platform'),
    PLATFORM_KEYS,
    PLATFORM_KEYS,
    'ADAPTER_HANDSHAKE_INVALID'
  );
  const platform = immutableSnapshot({
    os: platformFields.get('os'),
    architecture: platformFields.get('architecture'),
    signatureVerification: platformFields.get('signatureVerification'),
  });
  const identifiersValid = HANDSHAKE_IDENTIFIER_KEYS.every((key) => {
    const field = fields.get(key);
    return typeof field === 'string' && SAFE_IDENTIFIER.test(field);
  });
  const backendIds = new Set([
    fields.get('executionWorkspaceBackendId'),
    fields.get('projectRootAuthorityBackendId'),
    fields.get('processSupervisorBackendId'),
  ]);
  const requirementsDigest = canonicalSha256Digest(PORTABLE_ISOLATION_HELPER_REQUIREMENTS);
  if (fields.get('accepted') !== true
    || fields.get('handshakeVersion') !== PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION
    || fields.get('protocolVersion') !== PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION
    || fields.get('providerVersion') !== PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION
    || fields.get('attestationVersion') !== PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION
    || fields.get('executionWorkspaceBackendVersion') !== EXECUTION_WORKSPACE_BACKEND_VERSION
    || fields.get('projectRootAuthorityBackendVersion')
      !== PROJECT_ROOT_AUTHORITY_BACKEND_VERSION
    || fields.get('processSupervisorBackendVersion') !== PROCESS_SUPERVISOR_BACKEND_VERSION
    || !identifiersValid
    || backendIds.size !== 3
    || typeof fields.get('helperNonce') !== 'string'
    || !NONCE.test(fields.get('helperNonce'))
    || !SUPPORTED_OS.has(platform.os)
    || !SUPPORTED_ARCHITECTURES.has(platform.architecture)
    || platform.signatureVerification !== 'platform_verified'
    || fields.get('requirementsDigest') !== requirementsDigest
    || !['bundleIdentityDigest', 'capabilityDigest', 'sessionBindingDigest'].every((key) => {
      const field = fields.get(key);
      return typeof field === 'string' && DIGEST.test(field);
    })) {
    throw adapterError('ADAPTER_HANDSHAKE_INVALID');
  }
  const capabilityCore = {
    protocolVersion: PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION,
    helperId: fields.get('helperId'),
    helperBuildId: fields.get('helperBuildId'),
    bundleIdentityDigest: fields.get('bundleIdentityDigest'),
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    attestationVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
    executionWorkspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    processSupervisorBackendVersion: PROCESS_SUPERVISOR_BACKEND_VERSION,
    executionWorkspaceBackendId: fields.get('executionWorkspaceBackendId'),
    projectRootAuthorityBackendId: fields.get('projectRootAuthorityBackendId'),
    processSupervisorBackendId: fields.get('processSupervisorBackendId'),
    platform,
    requirementsDigest,
  };
  if (fields.get('capabilityDigest') !== canonicalSha256Digest(capabilityCore)) {
    throw adapterError('ADAPTER_HANDSHAKE_INVALID');
  }
  return immutableSnapshot({
    ...Object.fromEntries(fields),
    platform,
  });
}

function backendRequest(backendId, input) {
  return immutableSnapshot({
    version: PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION,
    backendId,
    input,
  });
}

function normalizeBackendResponse(value, expectedBackendId) {
  try {
    return Object.freeze({
      failure: assertPortableIsolationHelperFailureReceipt(value),
      result: null,
    });
  } catch (error) {
    preflightDataGraph(error);
  }
  const fields = exactDataFields(
    value,
    BACKEND_RESPONSE_KEYS,
    BACKEND_RESPONSE_KEYS,
    'ADAPTER_RESPONSE_INVALID'
  );
  if (fields.get('version') !== PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION
    || fields.get('backendId') !== expectedBackendId) {
    throw adapterError('ADAPTER_RESPONSE_INVALID');
  }
  return Object.freeze({ failure: null, result: fields.get('result') });
}

function normalizeRootDescriptor(value, request) {
  const fields = exactDataFields(
    value,
    ROOT_DESCRIPTOR_KEYS,
    ROOT_DESCRIPTOR_KEYS,
    'ADAPTER_RESPONSE_INVALID'
  );
  if (fields.get('version') !== PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION
    || fields.get('leaseId') !== request.leaseId
    || fields.get('jobId') !== request.binding.jobId
    || fields.get('projectId') !== request.binding.projectId
    || fields.get('purpose') !== request.purpose
    || fields.get('physicalRootIdentityDigest')
      !== request.expectedPhysicalRootIdentityDigest
    || fields.get('authorityDigest') !== request.authorityDigest) {
    throw adapterError('ADAPTER_RESPONSE_INVALID');
  }
  return immutableSnapshot(Object.fromEntries(fields));
}

function providerAttestation(handshake) {
  const core = {
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    buildId: handshake.helperBuildId,
    schemaVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
    workspaceBackendVersion: EXECUTION_WORKSPACE_BACKEND_VERSION,
    projectRootAuthorityBackendVersion: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    processSupervisorBackendVersion: PROCESS_SUPERVISOR_BACKEND_VERSION,
    workspaceBackendId: handshake.executionWorkspaceBackendId,
    projectRootAuthorityBackendId: handshake.projectRootAuthorityBackendId,
    processSupervisorBackendId: handshake.processSupervisorBackendId,
    sharedPhysicalRootAuthority: true,
    sourceIdentityCompareAndSwap: true,
    handleRelativeProjectAccess: true,
    privateWorkspaceMaterialization: true,
    rollbackByDiscard: true,
    workspaceBoundProcessExecution: true,
    networkDefaultDeny: true,
    processTreeTermination: true,
    zeroOrphanProcessDisposal: true,
  };
  return immutableSnapshot({
    schemaVersion: core.schemaVersion,
    workspaceBackendVersion: core.workspaceBackendVersion,
    projectRootAuthorityBackendVersion: core.projectRootAuthorityBackendVersion,
    processSupervisorBackendVersion: core.processSupervisorBackendVersion,
    workspaceBackendId: core.workspaceBackendId,
    projectRootAuthorityBackendId: core.projectRootAuthorityBackendId,
    processSupervisorBackendId: core.processSupervisorBackendId,
    sharedPhysicalRootAuthority: core.sharedPhysicalRootAuthority,
    sourceIdentityCompareAndSwap: core.sourceIdentityCompareAndSwap,
    handleRelativeProjectAccess: core.handleRelativeProjectAccess,
    privateWorkspaceMaterialization: core.privateWorkspaceMaterialization,
    rollbackByDiscard: core.rollbackByDiscard,
    workspaceBoundProcessExecution: core.workspaceBoundProcessExecution,
    networkDefaultDeny: core.networkDefaultDeny,
    processTreeTermination: core.processTreeTermination,
    zeroOrphanProcessDisposal: core.zeroOrphanProcessDisposal,
    attestationDigest: canonicalSha256Digest(core),
  });
}

function createPortableIsolationHelperProviderAdapter(options = {}) {
  const optionFields = exactDataFields(
    options,
    OPTION_KEYS,
    OPTION_KEYS,
    'ADAPTER_OPTIONS_INVALID'
  );
  const client = captureClient(optionFields.get('client'));

  let state = 'idle';
  let terminalErrorCode = null;
  let candidate = null;
  let connectPromise = null;
  let disposePromise = null;
  let disposeStarting = false;
  let disposeResult = null;
  let transportClosed = false;
  let clientCallDepth = 0;
  let deferredPoison = false;
  let deferredQuarantineReasonCode = null;
  let flushingDeferredPoison = false;
  let quarantineIssued = false;
  let inFlight = false;
  let exchanges = 0;
  const queue = [];
  const workspaceLeases = new Map();
  const rootLeases = new Map();
  const processRecords = new Map();
  const pendingWorkspaceOperations = new Set();
  const pendingRootOperations = new Set();
  const pendingProcessOperations = new Set();
  let workspaceReleased = false;
  let rootReleased = false;
  let processReleased = false;
  let processDisposePromise = null;
  let processDisposeResult = null;

  function flushDeferredPoison() {
    if (!deferredPoison || clientCallDepth > 0 || flushingDeferredPoison) return;
    flushingDeferredPoison = true;
    try {
      const reasonCode = deferredQuarantineReasonCode || 'ADAPTER_REENTRANCY';
      deferredPoison = false;
      deferredQuarantineReasonCode = null;
      quarantineClient(reasonCode);
      if (!disposePromise && !disposeStarting) observeDisposal(startDispose());
    } finally {
      flushingDeferredPoison = false;
    }
  }

  function invokeClient(methodName, args) {
    let raw;
    clientCallDepth += 1;
    try {
      raw = Reflect.apply(client[methodName], client.receiver, args);
    } catch (error) {
      absorbNativePromise(error);
      return Promise.resolve(Object.freeze({ ok: false, value: null }));
    } finally {
      clientCallDepth -= 1;
      if (clientCallDepth === 0) flushDeferredPoison();
    }
    return settledOutcome(raw);
  }

  function trackOperation(pendingOperations, promise) {
    pendingOperations.add(promise);
    return promise.then(
      (value) => {
        pendingOperations.delete(promise);
        return value;
      },
      (error) => {
        pendingOperations.delete(promise);
        throw error;
      }
    );
  }

  function rejectQueued(code) {
    while (queue.length > 0) queue.shift().reject(adapterError(code));
  }

  function quarantineClient(reasonCode) {
    if (clientCallDepth > 0 || quarantineIssued) return;
    quarantineIssued = true;
    clientCallDepth += 1;
    try {
      const result = Reflect.apply(client.quarantine, client.receiver, [{ reasonCode }]);
      if (absorbNativePromise(result)) return;
      preflightDataGraph(result);
    } catch (error) {
      absorbNativePromise(error);
    } finally {
      clientCallDepth -= 1;
      if (clientCallDepth === 0) flushDeferredPoison();
    }
  }

  function observeDisposal(promise) {
    try {
      Reflect.apply(Promise.prototype.then, promise, [() => undefined, () => undefined]);
    } catch {
      // The adapter already retains the safe disposal state.
    }
  }

  function poison(reasonCode, errorCode) {
    if (state === 'closed' || state === 'closed_unconfirmed') return;
    terminalErrorCode = terminalErrorCode || errorCode;
    state = 'quarantined';
    rejectQueued(terminalErrorCode);
    if (clientCallDepth > 0) {
      deferredPoison = true;
      deferredQuarantineReasonCode = deferredQuarantineReasonCode || reasonCode;
      return;
    }
    quarantineClient(reasonCode);
    if (!disposePromise && !disposeStarting) observeDisposal(startDispose());
  }

  function normalizeOperationInput(normalizer, value) {
    try {
      return normalizer(value);
    } catch (error) {
      absorbNativePromise(error);
      throw adapterError('ADAPTER_REQUEST_INVALID');
    }
  }

  function requireActiveFacet(released) {
    if (clientCallDepth > 0) {
      poison('ADAPTER_REENTRANCY', 'ADAPTER_REENTRANT');
      throw adapterError('ADAPTER_REENTRANT');
    }
    if (state !== 'active' || released) {
      throw adapterError(terminalErrorCode || 'ADAPTER_CLOSED');
    }
  }

  function enqueue(operation, backendId, input, validate) {
    if (state !== 'active') {
      return Promise.reject(adapterError(terminalErrorCode || 'ADAPTER_CLOSED'));
    }
    if (queue.length + (inFlight ? 1 : 0) >= MAX_QUEUED_EXCHANGES) {
      return Promise.reject(adapterError('ADAPTER_QUEUE_CAPACITY_EXCEEDED'));
    }
    let payload;
    try { payload = backendRequest(backendId, input); } catch (error) {
      absorbNativePromise(error);
      return Promise.reject(adapterError('ADAPTER_REQUEST_INVALID'));
    }
    const promise = new Promise((resolve, reject) => {
      queue.push(Object.freeze({ backendId, operation, payload, reject, resolve, validate }));
    });
    drainQueue();
    return promise;
  }

  function finishTask() {
    inFlight = false;
    drainQueue();
  }

  function drainQueue() {
    if (inFlight || queue.length === 0 || state !== 'active') return;
    const task = queue.shift();
    inFlight = true;
    const operationPromise = invokeClient('exchange', [{
      operation: task.operation,
      payload: task.payload,
    }]).then((outcome) => {
      if (state !== 'active') {
        throw adapterError(terminalErrorCode || 'ADAPTER_CLOSED');
      }
      if (!outcome.ok) {
        poison('CLIENT_EXCHANGE_REJECTED', 'ADAPTER_CLIENT_REJECTED');
        throw adapterError('ADAPTER_CLIENT_REJECTED');
      }
      let response;
      try {
        response = normalizeBackendResponse(outcome.value, task.backendId);
      } catch (error) {
        absorbNativePromise(error);
        poison('DOMAIN_RESPONSE_REJECTED', 'ADAPTER_RESPONSE_REJECTED');
        throw adapterError('ADAPTER_RESPONSE_REJECTED');
      }
      if (response.failure) {
        throw adapterError(
          'ADAPTER_OPERATION_FAILED',
          response.failure.reasonCode,
          response.failure.retryable
        );
      }
      try {
        const result = task.validate(response.result);
        exchanges += 1;
        return result;
      } catch (error) {
        absorbNativePromise(error);
        poison('DOMAIN_RESPONSE_REJECTED', 'ADAPTER_RESPONSE_REJECTED');
        throw adapterError('ADAPTER_RESPONSE_REJECTED');
      }
    });
    operationPromise.then(
      (value) => {
        task.resolve(value);
        finishTask();
      },
      (error) => {
        task.reject(error);
        finishTask();
      }
    );
  }

  function unavailableWorkspaceProbe() {
    return createExecutionWorkspaceProbeResult({
      state: EXECUTION_WORKSPACE_STATES.UNAVAILABLE,
      guarantees: [],
      reasonCode: 'PORTABLE_WORKSPACE_FACADE_RELEASED',
    });
  }

  function unavailableRootProbe() {
    return createProjectRootAuthorityProbeResult({
      state: PROJECT_ROOT_AUTHORITY_STATES.UNAVAILABLE,
      guarantees: [],
      reasonCode: 'PORTABLE_ROOT_FACADE_RELEASED',
    });
  }

  function unavailableProcessProbe() {
    return createProcessSupervisorProbeResult({
      state: PROCESS_SUPERVISOR_STATES.UNAVAILABLE,
      guarantees: [],
      reasonCode: 'PORTABLE_PROCESS_FACADE_RELEASED',
    });
  }

  function genericFacetDispose() {
    return Object.freeze({ ok: true, disposed: true });
  }

  function createWorkspaceBackend(handshake) {
    const enforcedProbe = createExecutionWorkspaceProbeResult({
      state: EXECUTION_WORKSPACE_STATES.ENFORCED,
      guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
    });
    const backend = Object.freeze({
      version: EXECUTION_WORKSPACE_BACKEND_VERSION,
      id: handshake.executionWorkspaceBackendId,
      probe(input) {
        preflightDataGraph(input);
        return state === 'active' && !workspaceReleased
          ? enforcedProbe
          : unavailableWorkspaceProbe();
      },
      acquire(input) {
        let request;
        try {
          requireActiveFacet(workspaceReleased);
          request = normalizeOperationInput(assertExecutionWorkspaceAcquireRequest, input);
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingWorkspaceOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
          backend.id,
          request,
          (result) => {
            const lease = assertExecutionWorkspaceLease(result, request);
            const existing = workspaceLeases.get(lease.leaseId);
            if (existing && existing.workspaceAuthorityDigest !== lease.workspaceAuthorityDigest) {
              throw adapterError('ADAPTER_RESPONSE_INVALID');
            }
            workspaceLeases.set(lease.leaseId, lease);
            return lease;
          }
        ));
      },
      discard(input) {
        let request;
        try {
          requireActiveFacet(workspaceReleased);
          request = normalizeOperationInput(assertExecutionWorkspaceDiscardRequest, input);
          const lease = workspaceLeases.get(request.leaseId);
          if (!lease
            || lease.workspaceAuthorityDigest !== request.workspaceAuthorityDigest
            || lease.workspaceRootIdentityDigest !== request.workspaceRootIdentityDigest) {
            throw adapterError('ADAPTER_LEASE_NOT_FOUND');
          }
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingWorkspaceOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_DISCARD,
          backend.id,
          request,
          (result) => {
            const receipt = assertExecutionWorkspaceDiscardReceipt(result, request);
            workspaceLeases.delete(request.leaseId);
            return receipt;
          }
        ));
      },
      dispose(input) {
        preflightDataGraph(input);
        if (pendingWorkspaceOperations.size > 0) {
          throw adapterError('ADAPTER_PENDING_WORKSPACE_OPERATIONS');
        }
        if (workspaceLeases.size > 0) throw adapterError('ADAPTER_LIVE_WORKSPACES');
        workspaceReleased = true;
        return genericFacetDispose();
      },
    });
    return assertExecutionWorkspaceBackend(backend);
  }

  function rootContext(record, request) {
    return immutableSnapshot({
      leaseId: record.request.leaseId,
      authorityDigest: record.request.authorityDigest,
      request,
    });
  }

  function createRootLease(record, backend) {
    const reader = Object.freeze({
      version: PROJECT_ROOT_READER_VERSION,
      list(input) {
        let request;
        try {
          requireActiveFacet(rootReleased);
          if (record.state !== 'active') throw adapterError('ADAPTER_LEASE_CLOSED');
          request = normalizeOperationInput(createProjectRootListRequest, input);
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingRootOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
          backend.id,
          rootContext(record, request),
          (result) => assertProjectRootListResult(result, request)
        ));
      },
      readFile(input) {
        let request;
        try {
          requireActiveFacet(rootReleased);
          if (record.state !== 'active') throw adapterError('ADAPTER_LEASE_CLOSED');
          request = normalizeOperationInput(createProjectRootReadFileRequest, input);
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingRootOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_READ_FILE,
          backend.id,
          rootContext(record, request),
          (result) => assertProjectRootReadFileResult(result, request)
        ));
      },
      inspectEntry(input) {
        let request;
        try {
          requireActiveFacet(rootReleased);
          if (record.state !== 'active') throw adapterError('ADAPTER_LEASE_CLOSED');
          request = normalizeOperationInput(createProjectRootEntryInspectionRequest, input);
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingRootOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_INSPECT_ENTRY,
          backend.id,
          rootContext(record, request),
          (result) => assertProjectRootEntryInspectionResult(result, request)
        ));
      },
    });
    const lease = Object.freeze({
      version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
      leaseId: record.request.leaseId,
      jobId: record.request.binding.jobId,
      projectId: record.request.binding.projectId,
      purpose: record.request.purpose,
      physicalRootIdentityDigest: record.request.expectedPhysicalRootIdentityDigest,
      authorityDigest: record.request.authorityDigest,
      reader,
      close() {
        if (record.closePromise) return record.closePromise;
        if (record.state === 'closed') return Promise.resolve(record.closeReceipt);
        try {
          requireActiveFacet(rootReleased);
          if (record.state !== 'active') throw adapterError('ADAPTER_LEASE_CLOSED');
        } catch (error) { return Promise.reject(error); }
        record.closePromise = trackOperation(pendingRootOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_CLOSE,
          backend.id,
          rootContext(record, record.request),
          (result) => {
            const receipt = assertProjectRootAuthorityCloseReceipt(result, record.request);
            record.state = 'closed';
            record.closeReceipt = receipt;
            rootLeases.delete(record.request.leaseId);
            return receipt;
          }
        ));
        return record.closePromise;
      },
    });
    return assertProjectRootAuthorityLease(lease, record.request);
  }

  function createRootBackend(handshake) {
    const enforcedProbe = createProjectRootAuthorityProbeResult({
      state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
      guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
    });
    const backend = Object.freeze({
      version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
      id: handshake.projectRootAuthorityBackendId,
      probe(input) {
        preflightDataGraph(input);
        return state === 'active' && !rootReleased ? enforcedProbe : unavailableRootProbe();
      },
      acquire(input) {
        let request;
        try {
          requireActiveFacet(rootReleased);
          request = normalizeOperationInput(assertProjectRootAuthorityAcquireRequest, input);
          const existing = rootLeases.get(request.leaseId);
          if (existing) {
            if (existing.request.authorityDigest !== request.authorityDigest) {
              throw adapterError('ADAPTER_LEASE_MISMATCH');
            }
            return Promise.resolve(existing.lease);
          }
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingRootOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE,
          backend.id,
          request,
          (result) => {
            const descriptor = normalizeRootDescriptor(result, request);
            const record = {
              closePromise: null,
              closeReceipt: null,
              descriptor,
              lease: null,
              request,
              state: 'active',
            };
            record.lease = createRootLease(record, backend);
            rootLeases.set(request.leaseId, record);
            return record.lease;
          }
        ));
      },
      dispose(input) {
        preflightDataGraph(input);
        if (pendingRootOperations.size > 0) {
          throw adapterError('ADAPTER_PENDING_ROOT_OPERATIONS');
        }
        if (rootLeases.size > 0) throw adapterError('ADAPTER_LIVE_ROOT_LEASES');
        rootReleased = true;
        return genericFacetDispose();
      },
    });
    return assertProjectRootAuthorityBackend(backend);
  }

  function assertProcessRecord(request) {
    const record = processRecords.get(request.executionId);
    if (!record || record.request.jobId !== request.jobId
      || record.request.workspaceAuthorityDigest !== request.workspaceAuthorityDigest) {
      throw adapterError('ADAPTER_EXECUTION_NOT_FOUND');
    }
    return record;
  }

  function updateProcessRecord(record, snapshot) {
    record.revision = snapshot.revision;
    record.status = snapshot.status;
    record.terminal = TERMINAL_STATUSES.has(snapshot.status);
    return snapshot;
  }

  function createProcessBackend(handshake) {
    const enforcedProbe = createProcessSupervisorProbeResult({
      state: PROCESS_SUPERVISOR_STATES.ENFORCED,
      guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
    });
    const backend = Object.freeze({
      version: PROCESS_SUPERVISOR_BACKEND_VERSION,
      id: handshake.processSupervisorBackendId,
      probe(input) {
        preflightDataGraph(input);
        return state === 'active' && !processReleased
          ? enforcedProbe
          : unavailableProcessProbe();
      },
      exec(input) {
        let request;
        try {
          requireActiveFacet(processReleased);
          request = normalizeOperationInput(assertProcessSupervisorExecRequest, input);
          if (processRecords.has(request.executionId)) {
            throw adapterError('ADAPTER_EXECUTION_EXISTS');
          }
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingProcessOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
          backend.id,
          request,
          (result) => {
            const receipt = assertProcessSupervisorExecReceipt(result, request);
            processRecords.set(request.executionId, {
              request,
              revision: receipt.revision,
              status: receipt.status,
              terminal: TERMINAL_STATUSES.has(receipt.status),
            });
            return receipt;
          }
        ));
      },
      read(input) {
        let request;
        let record;
        try {
          requireActiveFacet(processReleased);
          request = normalizeOperationInput(normalizeReadRequest, input);
          record = assertProcessRecord(request);
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingProcessOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
          backend.id,
          request,
          (result) => updateProcessRecord(
            record,
            assertProcessSupervisorReadResult(result, request)
          )
        ));
      },
      wait(input) {
        let request;
        let record;
        try {
          requireActiveFacet(processReleased);
          request = normalizeOperationInput(normalizeWaitRequest, input);
          record = assertProcessRecord(request);
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingProcessOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT,
          backend.id,
          request,
          (result) => updateProcessRecord(
            record,
            assertProcessSupervisorWaitResult(result, request)
          )
        ));
      },
      stop(input) {
        let request;
        let record;
        try {
          requireActiveFacet(processReleased);
          request = normalizeOperationInput(normalizeStopRequest, input);
          record = assertProcessRecord(request);
        } catch (error) { return Promise.reject(error); }
        return trackOperation(pendingProcessOperations, enqueue(
          PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP,
          backend.id,
          request,
          (result) => updateProcessRecord(
            record,
            assertProcessSupervisorStopReceipt(result, request)
          )
        ));
      },
      dispose(input) {
        preflightDataGraph(input);
        if (processDisposePromise) return processDisposePromise;
        if (processDisposeResult) return Promise.resolve(processDisposeResult);
        try { requireActiveFacet(processReleased); } catch (error) {
          return Promise.reject(error);
        }
        processReleased = true;
        const pendingOperations = [...pendingProcessOperations];
        processDisposePromise = Promise.allSettled(pendingOperations).then(() => {
          const stopPromises = [];
          for (const record of processRecords.values()) {
            if (record.terminal) continue;
            let request;
            try {
              request = createProcessSupervisorStopRequest({
                request: record.request,
                expectedRevision: record.revision,
                reasonCode: 'PROVIDER_DISPOSE',
              });
            } catch (error) {
              absorbNativePromise(error);
              poison('PROCESS_DISPOSE_REJECTED', 'ADAPTER_RESPONSE_REJECTED');
              throw adapterError('ADAPTER_RESPONSE_REJECTED');
            }
            stopPromises.push(enqueue(
              PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP,
              backend.id,
              request,
              (result) => updateProcessRecord(
                record,
                assertProcessSupervisorStopReceipt(result, request)
              )
            ));
          }
          return Promise.all(stopPromises);
        }).then(() => {
          processRecords.clear();
          processDisposeResult = createProcessSupervisorDisposeReceipt({ orphaned: 0 });
          return processDisposeResult;
        });
        return processDisposePromise;
      },
    });
    return assertProcessSupervisorBackend(backend);
  }

  function createCandidate(handshake) {
    const executionWorkspaceBackend = createWorkspaceBackend(handshake);
    const projectRootAuthorityBackend = createRootBackend(handshake);
    const processSupervisorBackend = createProcessBackend(handshake);
    const isolationAttestation = providerAttestation(handshake);
    const provider = Object.freeze({
      providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
      buildId: handshake.helperBuildId,
      executionWorkspaceBackend,
      projectRootAuthorityBackend,
      processSupervisorBackend,
      isolationAttestation,
      dispose,
    });
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_PROVIDER_CANDIDATE_VERSION,
      activationReady: true,
      activationBlockReason: null,
      provider,
      providerVersion: provider.providerVersion,
      buildId: provider.buildId,
      executionWorkspaceBackend: provider.executionWorkspaceBackend,
      projectRootAuthorityBackend: provider.projectRootAuthorityBackend,
      processSupervisorBackend: provider.processSupervisorBackend,
      isolationAttestation: provider.isolationAttestation,
      dispose: provider.dispose,
    });
  }

  function connect() {
    if (connectPromise) return connectPromise;
    if (clientCallDepth > 0) {
      poison('ADAPTER_REENTRANCY', 'ADAPTER_REENTRANT');
      return Promise.reject(adapterError('ADAPTER_REENTRANT'));
    }
    if (state !== 'idle') {
      return Promise.reject(adapterError(terminalErrorCode || 'ADAPTER_CLOSED'));
    }
    state = 'connecting';
    connectPromise = invokeClient('connect', []).then((outcome) => {
      if (state !== 'connecting') {
        throw adapterError(terminalErrorCode || 'ADAPTER_CLOSED');
      }
      if (!outcome.ok) {
        poison('CLIENT_CONNECT_REJECTED', 'ADAPTER_CLIENT_REJECTED');
        throw adapterError('ADAPTER_CLIENT_REJECTED');
      }
      let handshake;
      try {
        handshake = normalizeHandshake(outcome.value);
        candidate = createCandidate(handshake);
      } catch (error) {
        absorbNativePromise(error);
        poison('ADAPTER_HANDSHAKE_REJECTED', 'ADAPTER_HANDSHAKE_REJECTED');
        throw adapterError('ADAPTER_HANDSHAKE_REJECTED');
      }
      state = 'active';
      return candidate;
    });
    return connectPromise;
  }

  function normalizeClientDispose(value) {
    const fields = exactDataFields(
      value,
      CLIENT_DISPOSE_KEYS,
      CLIENT_DISPOSE_KEYS,
      'ADAPTER_SHUTDOWN_FAILED'
    );
    if (fields.get('version') !== PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION
      || fields.get('disposed') !== true
      || typeof fields.get('helperShutdownConfirmed') !== 'boolean'
      || fields.get('transportClosed') !== true) {
      throw adapterError('ADAPTER_SHUTDOWN_FAILED');
    }
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_DISPOSE_RECEIPT_VERSION,
      disposed: true,
      helperShutdownConfirmed: fields.get('helperShutdownConfirmed'),
      transportClosed: true,
    });
  }

  function startDispose() {
    if (disposePromise) return disposePromise;
    if (disposeStarting) {
      return Promise.reject(adapterError(terminalErrorCode || 'ADAPTER_CLOSED'));
    }
    disposeStarting = true;
    const hadCandidate = candidate !== null;
    const wasQuarantined = state === 'quarantined';
    if (!wasQuarantined) state = 'disposing';
    rejectQueued(terminalErrorCode || 'ADAPTER_CLOSED');
    let clientDisposeOutcome;
    try {
      clientDisposeOutcome = invokeClient('dispose', []);
    } finally {
      disposeStarting = false;
    }
    disposePromise = clientDisposeOutcome.then((outcome) => {
      if (!outcome.ok) {
        state = 'quarantined';
        terminalErrorCode = terminalErrorCode || 'ADAPTER_SHUTDOWN_FAILED';
        throw adapterError('ADAPTER_SHUTDOWN_FAILED');
      }
      try { disposeResult = normalizeClientDispose(outcome.value); } catch (error) {
        absorbNativePromise(error);
        state = 'quarantined';
        terminalErrorCode = terminalErrorCode || 'ADAPTER_SHUTDOWN_FAILED';
        throw adapterError('ADAPTER_SHUTDOWN_FAILED');
      }
      transportClosed = true;
      workspaceReleased = true;
      rootReleased = true;
      processReleased = true;
      workspaceLeases.clear();
      rootLeases.clear();
      processRecords.clear();
      state = disposeResult.helperShutdownConfirmed || !hadCandidate
        ? 'closed'
        : 'closed_unconfirmed';
      return disposeResult;
    });
    return disposePromise;
  }

  function dispose() {
    if (clientCallDepth > 0) {
      poison('ADAPTER_REENTRANCY', 'ADAPTER_REENTRANT');
      return Promise.reject(adapterError('ADAPTER_REENTRANT'));
    }
    return startDispose();
  }

  function diagnostics() {
    let activeProcesses = 0;
    for (const record of processRecords.values()) {
      if (!record.terminal) activeProcesses += 1;
    }
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_VERSION,
      state,
      queued: queue.length,
      inFlight,
      exchanges,
      activeWorkspaces: workspaceLeases.size,
      activeRootLeases: rootLeases.size,
      activeProcesses,
      transportClosed,
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_VERSION,
    connect,
    diagnostics,
    dispose,
  });
}

module.exports = {
  MAX_QUEUED_EXCHANGES,
  PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION,
  PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
  PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_VERSION,
  PORTABLE_ISOLATION_HELPER_PROVIDER_CANDIDATE_VERSION,
  PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION,
  PortableIsolationHelperProviderAdapterError,
  createPortableIsolationHelperProviderAdapter,
};
