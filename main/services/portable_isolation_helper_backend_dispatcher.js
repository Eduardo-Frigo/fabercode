'use strict';

const util = require('util');

const {
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  absorbNativePromise,
  assertExecutionWorkspaceAcquireRequest,
  assertExecutionWorkspaceBackend,
  assertExecutionWorkspaceDiscardReceipt,
  assertExecutionWorkspaceDiscardRequest,
  assertExecutionWorkspaceLease,
  assertExecutionWorkspaceProbeResult,
  createExecutionWorkspaceDiscardRequest,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  assertProjectRootAuthorityAcquireRequest,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityCloseReceipt,
  assertProjectRootAuthorityLease,
  assertProjectRootAuthorityProbeResult,
  assertProjectRootEntryInspectionResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  assertProjectRootReader,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
} = require('../capabilities/project_root_authority_contract');
const {
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  TERMINAL_EXECUTION_STATUSES,
  assertProcessSupervisorBackend,
  assertProcessSupervisorDisposeReceipt,
  assertProcessSupervisorExecReceipt,
  assertProcessSupervisorExecRequest,
  assertProcessSupervisorProbeResult,
  assertProcessSupervisorReadResult,
  assertProcessSupervisorStopReceipt,
  assertProcessSupervisorWaitResult,
  normalizeReadRequest,
  normalizeStopRequest,
  normalizeWaitRequest,
} = require('../capabilities/process_supervisor_contract');
const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  createPortableIsolationHelperShutdownReceipt,
} = require('../capabilities/portable_isolation_helper_protocol');
const {
  createPortableIsolationHelperRootLeaseDescriptor,
} = require('../capabilities/portable_isolation_helper_backend_contract');
const {
  PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION,
  isPortableIsolationHelperRuntimeOperationError,
} = require('./portable_isolation_helper_runtime_session');

const PORTABLE_ISOLATION_HELPER_BACKEND_DISPATCHER_VERSION =
  'portable-isolation-helper-backend-dispatcher.v1';
const PORTABLE_ISOLATION_HELPER_BACKEND_ACTIVATION_RECEIPT_VERSION =
  'portable-isolation-helper-backend-activation-receipt.v1';

const OPTION_KEYS = Object.freeze([
  'executionWorkspaceBackend',
  'projectRootAuthorityBackend',
  'processSupervisorBackend',
]);
const DISPATCH_KEYS = Object.freeze([
  'version',
  'operation',
  'backendId',
  'input',
]);
const ROOT_CONTEXT_KEYS = Object.freeze([
  'leaseId',
  'authorityDigest',
  'request',
]);
const DISPOSE_KEYS = Object.freeze(['reasonCode']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const WORKSPACE_OPERATIONS = new Set([
  PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
  PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_DISCARD,
]);
const ROOT_OPERATIONS = new Set([
  PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE,
  PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
  PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_READ_FILE,
  PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_INSPECT_ENTRY,
  PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_CLOSE,
]);
const PROCESS_OPERATIONS = new Set([
  PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
  PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
  PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT,
  PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP,
]);
const DISPATCH_OPERATIONS = new Set([
  ...WORKSPACE_OPERATIONS,
  ...ROOT_OPERATIONS,
  ...PROCESS_OPERATIONS,
]);

class PortableIsolationHelperBackendDispatcherError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperBackendDispatcherError';
    this.code = code;
  }
}

function dispatcherError(code) {
  return new PortableIsolationHelperBackendDispatcherError(code);
}

function fail(code) {
  throw dispatcherError(code);
}

function exactOwnDataFields(value, allowedKeys, requiredKeys, code) {
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

function inspectDataGraph(value, code) {
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

function captureOwnMethod(receiver, name, code) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(receiver, name);
  } catch (error) {
    absorbNativePromise(error);
    fail(code);
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) fail(code);
  return Object.freeze({ receiver, method: descriptor.value });
}

function captureBackend(value, assertBackend, methodNames, code) {
  let backend;
  try {
    backend = assertBackend(value);
  } catch (error) {
    absorbNativePromise(error);
    fail(code);
  }
  const captured = {
    id: backend.id,
    receiver: backend,
  };
  for (const name of methodNames) {
    captured[name] = captureOwnMethod(backend, name, code);
  }
  return Object.freeze(captured);
}

function normalizeOptions(value) {
  const code = 'BACKEND_DISPATCHER_OPTIONS_INVALID';
  const fields = exactOwnDataFields(value, OPTION_KEYS, OPTION_KEYS, code);
  const workspace = captureBackend(
    fields.get('executionWorkspaceBackend'),
    assertExecutionWorkspaceBackend,
    ['probe', 'acquire', 'discard', 'dispose'],
    code
  );
  const root = captureBackend(
    fields.get('projectRootAuthorityBackend'),
    assertProjectRootAuthorityBackend,
    ['probe', 'acquire', 'dispose'],
    code
  );
  const process = captureBackend(
    fields.get('processSupervisorBackend'),
    assertProcessSupervisorBackend,
    ['probe', 'exec', 'read', 'wait', 'stop', 'dispose'],
    code
  );
  if (new Set([workspace.id, root.id, process.id]).size !== 3) fail(code);
  return Object.freeze({ workspace, root, process });
}

function settledCall(captured, args) {
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, args);
  } catch (error) {
    absorbNativePromise(error);
    return Promise.resolve(Object.freeze({ ok: false, value: error }));
  }
  if (!util.types.isPromise(raw)) {
    return Promise.resolve(Object.freeze({ ok: true, value: raw }));
  }
  return new Promise((resolve) => {
    const fulfilled = (value) => resolve(Object.freeze({ ok: true, value }));
    const rejected = (error) => {
      absorbNativePromise(error);
      resolve(Object.freeze({ ok: false, value: error }));
    };
    try {
      Reflect.apply(Promise.prototype.then, raw, [fulfilled, rejected]);
    } catch (error) {
      absorbNativePromise(error);
      resolve(Object.freeze({ ok: false, value: error }));
    }
  });
}

function normalizeDispatchRequest(value) {
  const code = 'BACKEND_DISPATCH_REQUEST_INVALID';
  inspectDataGraph(value, code);
  const fields = exactOwnDataFields(value, DISPATCH_KEYS, DISPATCH_KEYS, code);
  const operation = fields.get('operation');
  const backendId = fields.get('backendId');
  if (fields.get('version')
      !== PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION
    || !DISPATCH_OPERATIONS.has(operation)
    || typeof backendId !== 'string'
    || !SAFE_IDENTIFIER.test(backendId)) fail(code);
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION,
    operation,
    backendId,
    input: fields.get('input'),
  });
}

function normalizeRootContext(value) {
  const code = 'BACKEND_DISPATCH_REQUEST_INVALID';
  inspectDataGraph(value, code);
  const fields = exactOwnDataFields(
    value,
    ROOT_CONTEXT_KEYS,
    ROOT_CONTEXT_KEYS,
    code
  );
  if (typeof fields.get('leaseId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('leaseId'))
    || typeof fields.get('authorityDigest') !== 'string'
    || !DIGEST.test(fields.get('authorityDigest'))) fail(code);
  return Object.freeze({
    leaseId: fields.get('leaseId'),
    authorityDigest: fields.get('authorityDigest'),
    request: fields.get('request'),
  });
}

function assertGenericDisposeReceipt(value) {
  const code = 'BACKEND_DISPATCHER_SHUTDOWN_FAILED';
  inspectDataGraph(value, code);
  const fields = exactOwnDataFields(value, ['ok', 'disposed'], ['ok', 'disposed'], code);
  if (fields.get('ok') !== true || fields.get('disposed') !== true) fail(code);
  return Object.freeze({ ok: true, disposed: true });
}

function createPortableIsolationHelperBackendDispatcher(options = {}) {
  const backends = normalizeOptions(options);
  let state = 'idle';
  let activationPromise = null;
  let activationReceipt = null;
  let disposePromise = null;
  let disposeReceipt = null;
  let backendCalls = 0;
  let exchanges = 0;
  const workspaces = new Map();
  const rootLeases = new Map();
  const processes = new Map();

  function invoke(captured, args) {
    backendCalls += 1;
    return settledCall(captured, args);
  }

  function rejected(code, quarantine = false) {
    if (quarantine && !['closed', 'disposing'].includes(state)) {
      state = 'quarantined';
    }
    return Promise.reject(dispatcherError(code));
  }

  function probe(captured, requiredGuarantees, assertProbe, enforcedState) {
    const context = Object.freeze({ requiredGuarantees });
    return invoke(captured.probe, [context]).then((outcome) => {
      if (!outcome.ok) fail('BACKEND_DISPATCHER_ACTIVATION_FAILED');
      let result;
      try {
        result = assertProbe(outcome.value);
      } catch (error) {
        absorbNativePromise(error);
        fail('BACKEND_DISPATCHER_ACTIVATION_FAILED');
      }
      if (result.state !== enforcedState
        || !requiredGuarantees.every((entry) => result.guarantees.includes(entry))) {
        fail('BACKEND_DISPATCHER_ACTIVATION_FAILED');
      }
      return result;
    });
  }

  function activate() {
    if (activationReceipt) return Promise.resolve(activationReceipt);
    if (activationPromise) return activationPromise;
    if (state !== 'idle') {
      return rejected('BACKEND_DISPATCHER_ACTIVATION_FAILED');
    }
    state = 'activating';
    activationPromise = Promise.all([
      probe(
        backends.workspace,
        EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
        assertExecutionWorkspaceProbeResult,
        EXECUTION_WORKSPACE_STATES.ENFORCED
      ),
      probe(
        backends.root,
        PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
        assertProjectRootAuthorityProbeResult,
        PROJECT_ROOT_AUTHORITY_STATES.ENFORCED
      ),
      probe(
        backends.process,
        PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
        assertProcessSupervisorProbeResult,
        PROCESS_SUPERVISOR_STATES.ENFORCED
      ),
    ]).then(
      () => {
        if (state !== 'activating') {
          throw dispatcherError('BACKEND_DISPATCHER_ACTIVATION_FAILED');
        }
        activationReceipt = Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_BACKEND_ACTIVATION_RECEIPT_VERSION,
          active: true,
          executionWorkspaceBackendId: backends.workspace.id,
          projectRootAuthorityBackendId: backends.root.id,
          processSupervisorBackendId: backends.process.id,
        });
        state = 'active';
        return activationReceipt;
      },
      (error) => {
        absorbNativePromise(error);
        state = 'quarantined';
        throw dispatcherError('BACKEND_DISPATCHER_ACTIVATION_FAILED');
      }
    );
    return activationPromise;
  }

  function expectedBackendId(operation) {
    if (WORKSPACE_OPERATIONS.has(operation)) return backends.workspace.id;
    if (ROOT_OPERATIONS.has(operation)) return backends.root.id;
    if (PROCESS_OPERATIONS.has(operation)) return backends.process.id;
    return null;
  }

  function outcomeValue(outcome) {
    if (!outcome.ok) throw outcome.value;
    return outcome.value;
  }

  function workspaceAcquire(input) {
    const request = assertExecutionWorkspaceAcquireRequest(input);
    if (workspaces.has(request.leaseId)) fail('BACKEND_DISPATCH_REQUEST_INVALID');
    return invoke(backends.workspace.acquire, [request]).then((outcome) => {
      const lease = assertExecutionWorkspaceLease(outcomeValue(outcome), request);
      workspaces.set(request.leaseId, Object.freeze({ request, lease }));
      return lease;
    });
  }

  function workspaceDiscard(input) {
    const request = assertExecutionWorkspaceDiscardRequest(input);
    const record = workspaces.get(request.leaseId);
    const ownsActiveProcess = [...processes.values()].some((processRecordEntry) => (
      !processRecordEntry.terminal
      && processRecordEntry.request.workspaceLeaseId === request.leaseId
    ));
    if (!record
      || record.lease.jobId !== request.jobId
      || record.lease.workspaceAuthorityDigest !== request.workspaceAuthorityDigest
      || record.lease.workspaceRootIdentityDigest
        !== request.workspaceRootIdentityDigest) {
      fail('BACKEND_DISPATCH_REQUEST_INVALID');
    }
    if (ownsActiveProcess) fail('BACKEND_DISPATCH_REQUEST_INVALID');
    return invoke(backends.workspace.discard, [request]).then((outcome) => {
      const receipt = assertExecutionWorkspaceDiscardReceipt(
        outcomeValue(outcome),
        request
      );
      workspaces.delete(request.leaseId);
      return receipt;
    });
  }

  function captureRootLease(lease, request) {
    const normalized = assertProjectRootAuthorityLease(lease, request);
    const reader = assertProjectRootReader(normalized.reader);
    return Object.freeze({
      request,
      lease: normalized,
      list: captureOwnMethod(reader, 'list', 'BACKEND_DISPATCH_FAILED'),
      readFile: captureOwnMethod(reader, 'readFile', 'BACKEND_DISPATCH_FAILED'),
      inspectEntry: captureOwnMethod(
        reader,
        'inspectEntry',
        'BACKEND_DISPATCH_FAILED'
      ),
      close: captureOwnMethod(normalized, 'close', 'BACKEND_DISPATCH_FAILED'),
    });
  }

  function rootAcquire(input) {
    const request = assertProjectRootAuthorityAcquireRequest(input);
    if (rootLeases.has(request.leaseId)) fail('BACKEND_DISPATCH_REQUEST_INVALID');
    return invoke(backends.root.acquire, [request]).then((outcome) => {
      const record = captureRootLease(outcomeValue(outcome), request);
      rootLeases.set(request.leaseId, record);
      return createPortableIsolationHelperRootLeaseDescriptor({
        leaseId: record.lease.leaseId,
        jobId: record.lease.jobId,
        projectId: record.lease.projectId,
        purpose: record.lease.purpose,
        physicalRootIdentityDigest: record.lease.physicalRootIdentityDigest,
        authorityDigest: record.lease.authorityDigest,
      });
    });
  }

  function rootRecord(context) {
    const record = rootLeases.get(context.leaseId);
    if (!record || record.request.authorityDigest !== context.authorityDigest) {
      fail('BACKEND_DISPATCH_REQUEST_INVALID');
    }
    return record;
  }

  function rootList(input) {
    const context = normalizeRootContext(input);
    const record = rootRecord(context);
    const request = createProjectRootListRequest(context.request);
    return invoke(record.list, [request]).then((outcome) => (
      assertProjectRootListResult(outcomeValue(outcome), request)
    ));
  }

  function rootReadFile(input) {
    const context = normalizeRootContext(input);
    const record = rootRecord(context);
    const request = createProjectRootReadFileRequest(context.request);
    return invoke(record.readFile, [request]).then((outcome) => (
      assertProjectRootReadFileResult(outcomeValue(outcome), request)
    ));
  }

  function rootInspectEntry(input) {
    const context = normalizeRootContext(input);
    const record = rootRecord(context);
    const request = createProjectRootEntryInspectionRequest(context.request);
    return invoke(record.inspectEntry, [request]).then((outcome) => (
      assertProjectRootEntryInspectionResult(outcomeValue(outcome), request)
    ));
  }

  function rootClose(input) {
    const context = normalizeRootContext(input);
    const record = rootRecord(context);
    const request = assertProjectRootAuthorityAcquireRequest(context.request);
    if (request.leaseId !== record.request.leaseId
      || request.authorityDigest !== record.request.authorityDigest) {
      fail('BACKEND_DISPATCH_REQUEST_INVALID');
    }
    return invoke(record.close, []).then((outcome) => {
      const receipt = assertProjectRootAuthorityCloseReceipt(
        outcomeValue(outcome),
        record.request
      );
      rootLeases.delete(record.request.leaseId);
      return receipt;
    });
  }

  function processRecord(request) {
    const record = processes.get(request.executionId);
    if (!record
      || record.request.jobId !== request.jobId
      || record.request.workspaceAuthorityDigest
        !== request.workspaceAuthorityDigest) {
      fail('BACKEND_DISPATCH_REQUEST_INVALID');
    }
    return record;
  }

  function updateProcess(record, result) {
    record.status = result.status;
    record.revision = result.revision;
    record.terminal = TERMINAL_EXECUTION_STATUSES.has(result.status);
    return result;
  }

  function workspaceForProcess(request) {
    const record = workspaces.get(request.workspaceLeaseId);
    if (!record
      || record.lease.jobId !== request.jobId
      || record.lease.workspaceAuthorityDigest
        !== request.workspaceAuthorityDigest
      || record.lease.workspaceRootIdentityDigest
        !== request.workspaceRootIdentityDigest
      || record.lease.workspaceRootPath !== request.sandboxRequest.rootPath
      || record.lease.workspaceRealRootPath
        !== request.sandboxRequest.realRootPath) {
      fail('BACKEND_DISPATCH_REQUEST_INVALID');
    }
    return record;
  }

  function processExec(input) {
    const request = assertProcessSupervisorExecRequest(input);
    if (processes.has(request.executionId)) fail('BACKEND_DISPATCH_REQUEST_INVALID');
    workspaceForProcess(request);
    return invoke(backends.process.exec, [request]).then((outcome) => {
      const receipt = assertProcessSupervisorExecReceipt(
        outcomeValue(outcome),
        request
      );
      processes.set(request.executionId, {
        request,
        status: receipt.status,
        revision: receipt.revision,
        terminal: TERMINAL_EXECUTION_STATUSES.has(receipt.status),
      });
      return receipt;
    });
  }

  function processRead(input) {
    const request = normalizeReadRequest(input);
    const record = processRecord(request);
    return invoke(backends.process.read, [request]).then((outcome) => (
      updateProcess(
        record,
        assertProcessSupervisorReadResult(outcomeValue(outcome), request)
      )
    ));
  }

  function processWait(input) {
    const request = normalizeWaitRequest(input);
    const record = processRecord(request);
    return invoke(backends.process.wait, [request]).then((outcome) => (
      updateProcess(
        record,
        assertProcessSupervisorWaitResult(outcomeValue(outcome), request)
      )
    ));
  }

  function processStop(input) {
    const request = normalizeStopRequest(input);
    const record = processRecord(request);
    return invoke(backends.process.stop, [request]).then((outcome) => (
      updateProcess(
        record,
        assertProcessSupervisorStopReceipt(outcomeValue(outcome), request)
      )
    ));
  }

  function perform(request) {
    switch (request.operation) {
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE:
        return workspaceAcquire(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_DISCARD:
        return workspaceDiscard(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE:
        return rootAcquire(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST:
        return rootList(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_READ_FILE:
        return rootReadFile(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_INSPECT_ENTRY:
        return rootInspectEntry(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_CLOSE:
        return rootClose(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC:
        return processExec(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ:
        return processRead(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT:
        return processWait(request.input);
      case PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP:
        return processStop(request.input);
      default:
        return rejected('BACKEND_DISPATCH_REQUEST_INVALID', true);
    }
  }

  function dispatch(value) {
    let request;
    try {
      request = normalizeDispatchRequest(value);
    } catch (error) {
      absorbNativePromise(error);
      return rejected('BACKEND_DISPATCH_REQUEST_INVALID', true);
    }
    if (state === 'busy') {
      return rejected('BACKEND_DISPATCH_REENTRANT', true);
    }
    if (state === 'closed') return rejected('BACKEND_DISPATCHER_CLOSED');
    if (state !== 'active') return rejected('BACKEND_DISPATCHER_NOT_ACTIVE');
    if (request.backendId !== expectedBackendId(request.operation)) {
      return rejected('BACKEND_DISPATCH_BACKEND_MISMATCH', true);
    }
    state = 'busy';
    let operationPromise;
    try {
      operationPromise = perform(request);
    } catch (error) {
      operationPromise = Promise.reject(error);
    }
    return operationPromise.then(
      (result) => {
        if (state !== 'busy') {
          state = 'quarantined';
          throw dispatcherError('BACKEND_DISPATCH_REENTRANT');
        }
        exchanges += 1;
        state = 'active';
        return result;
      },
      (error) => {
        const expected = isPortableIsolationHelperRuntimeOperationError(error);
        if (state === 'busy') state = expected ? 'active' : 'quarantined';
        if (expected) throw error;
        absorbNativePromise(error);
        throw dispatcherError('BACKEND_DISPATCH_FAILED');
      }
    );
  }

  function attempt(captured, args, validate, onSuccess) {
    return invoke(captured, args).then((outcome) => {
      if (!outcome.ok) return false;
      let result;
      try {
        result = validate(outcome.value);
      } catch (error) {
        absorbNativePromise(error);
        return false;
      }
      try {
        onSuccess(result);
      } catch (error) {
        absorbNativePromise(error);
        return false;
      }
      return true;
    });
  }

  function disposeWorkspaceRecord(record) {
    let request;
    try {
      request = createExecutionWorkspaceDiscardRequest({
        request: record.request,
        lease: record.lease,
      });
    } catch (error) {
      absorbNativePromise(error);
      return Promise.resolve(false);
    }
    return attempt(
      backends.workspace.discard,
      [request],
      (value) => assertExecutionWorkspaceDiscardReceipt(value, request),
      () => workspaces.delete(record.request.leaseId)
    );
  }

  function disposeRootRecord(record) {
    return attempt(
      record.close,
      [],
      (value) => assertProjectRootAuthorityCloseReceipt(value, record.request),
      () => rootLeases.delete(record.request.leaseId)
    );
  }

  function normalizeDisposeInput(value) {
    const code = 'BACKEND_DISPATCHER_SHUTDOWN_INVALID';
    inspectDataGraph(value, code);
    const fields = exactOwnDataFields(value, DISPOSE_KEYS, DISPOSE_KEYS, code);
    if (fields.get('reasonCode') !== 'APPLICATION_SHUTDOWN') fail(code);
    return Object.freeze({ reasonCode: 'APPLICATION_SHUTDOWN' });
  }

  function dispose(value) {
    try {
      normalizeDisposeInput(value);
    } catch (error) {
      absorbNativePromise(error);
      return rejected('BACKEND_DISPATCHER_SHUTDOWN_INVALID', true);
    }
    if (disposeReceipt) return Promise.resolve(disposeReceipt);
    if (disposePromise) return disposePromise;
    if (['activating', 'busy', 'disposing'].includes(state)) {
      return rejected('BACKEND_DISPATCHER_SHUTDOWN_FAILED', true);
    }
    if (state === 'closed') return rejected('BACKEND_DISPATCHER_CLOSED');
    state = 'disposing';
    let cleanupSucceeded = true;

    disposePromise = attempt(
      backends.process.dispose,
      [],
      assertProcessSupervisorDisposeReceipt,
      () => processes.clear()
    ).then((processDisposed) => {
      cleanupSucceeded = cleanupSucceeded && processDisposed;
      return Promise.all([...rootLeases.values()].map(disposeRootRecord));
    }).then((rootResults) => {
      cleanupSucceeded = cleanupSucceeded
        && rootResults.every((result) => result === true);
      return Promise.all([...workspaces.values()].map(disposeWorkspaceRecord));
    }).then((workspaceResults) => {
      cleanupSucceeded = cleanupSucceeded
        && workspaceResults.every((result) => result === true);
      return attempt(
        backends.root.dispose,
        [],
        assertGenericDisposeReceipt,
        () => undefined
      );
    }).then((rootDisposed) => {
      cleanupSucceeded = cleanupSucceeded && rootDisposed;
      return attempt(
        backends.workspace.dispose,
        [],
        assertGenericDisposeReceipt,
        () => undefined
      );
    }).then((workspaceDisposed) => {
      cleanupSucceeded = cleanupSucceeded && workspaceDisposed;
      if (!cleanupSucceeded || workspaces.size !== 0
        || rootLeases.size !== 0 || processes.size !== 0) {
        state = 'quarantined';
        throw dispatcherError('BACKEND_DISPATCHER_SHUTDOWN_FAILED');
      }
      disposeReceipt = createPortableIsolationHelperShutdownReceipt({
        activeWorkspaces: 0,
        activeRootLeases: 0,
        activeProcesses: 0,
        orphaned: 0,
      });
      state = 'closed';
      return disposeReceipt;
    }, (error) => {
      absorbNativePromise(error);
      state = 'quarantined';
      throw dispatcherError('BACKEND_DISPATCHER_SHUTDOWN_FAILED');
    });
    return disposePromise;
  }

  function activeProcessCount() {
    let count = 0;
    for (const record of processes.values()) {
      if (!record.terminal) count += 1;
    }
    return count;
  }

  function diagnostics() {
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_BACKEND_DISPATCHER_VERSION,
      state,
      backendCalls,
      exchanges,
      activeWorkspaces: workspaces.size,
      activeRootLeases: rootLeases.size,
      activeProcesses: activeProcessCount(),
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_BACKEND_DISPATCHER_VERSION,
    activate,
    dispatch,
    dispose,
    diagnostics,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_BACKEND_ACTIVATION_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_BACKEND_DISPATCHER_VERSION,
  PortableIsolationHelperBackendDispatcherError,
  createPortableIsolationHelperBackendDispatcher,
};
