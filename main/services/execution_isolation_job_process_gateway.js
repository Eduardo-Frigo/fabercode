'use strict';

const path = require('path');
const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  EXECUTION_WORKSPACE_LEASE_VERSION,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  assertSandboxExecutionRequest,
  createSandboxExecutionRequest,
  isPathInsideProjectRoot,
  isPortableAbsolutePath,
} = require('../capabilities/sandbox_backend_contract');
const {
  PROCESS_EXECUTION_STATUSES,
  assertProcessSupervisorExecReceipt,
  assertProcessSupervisorReadResult,
  assertProcessSupervisorStopReceipt,
  assertProcessSupervisorWaitResult,
  createProcessSupervisorExecRequest,
  createProcessSupervisorReadRequest,
  createProcessSupervisorStopRequest,
  createProcessSupervisorWaitRequest,
} = require('../capabilities/process_supervisor_contract');
const {
  PROCESS_SUPERVISOR_REASONS,
  PROCESS_SUPERVISOR_VERSION,
} = require('../agent_runtime/execution/process_supervisor');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');

const EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_VERSION =
  'execution-isolation-job-process-gateway.v1';
const EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_DISPOSE_RECEIPT_VERSION =
  'execution-isolation-job-process-gateway-dispose-receipt.v1';

const EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS = Object.freeze({
  DISPOSED: 'EXECUTION_ISOLATION_PROCESS_GATEWAY_DISPOSED',
  EXECUTION_MISMATCH: 'EXECUTION_ISOLATION_PROCESS_EXECUTION_MISMATCH',
  EXECUTION_NOT_FOUND: 'EXECUTION_ISOLATION_PROCESS_EXECUTION_NOT_FOUND',
  INVALID_INPUT: 'EXECUTION_ISOLATION_PROCESS_INVALID_INPUT',
  PROCESS_FAILED: 'EXECUTION_ISOLATION_PROCESS_OPERATION_FAILED',
});

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const TERMINAL_STATUSES = new Set([
  PROCESS_EXECUTION_STATUSES.SUCCEEDED,
  PROCESS_EXECUTION_STATUSES.FAILED,
  PROCESS_EXECUTION_STATUSES.STOPPED,
  PROCESS_EXECUTION_STATUSES.TIMED_OUT,
]);
const PROCESS_REASON_CODES = new Set(Object.values(PROCESS_SUPERVISOR_REASONS));
const CLEAN_EXEC_REJECTION_CODES = new Set([
  PROCESS_SUPERVISOR_REASONS.CAPACITY_EXCEEDED,
  PROCESS_SUPERVISOR_REASONS.DISPOSED,
  PROCESS_SUPERVISOR_REASONS.EXECUTION_CONFLICT,
  PROCESS_SUPERVISOR_REASONS.INVALID_REQUEST,
  PROCESS_SUPERVISOR_REASONS.JOB_BUSY,
  PROCESS_SUPERVISOR_REASONS.REENTRANT_CALL,
  PROCESS_SUPERVISOR_REASONS.UNAVAILABLE,
]);
const QUARANTINE_OPERATION_CODES = new Set([
  PROCESS_SUPERVISOR_REASONS.AUTHORITY_MISMATCH,
  PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED,
  PROCESS_SUPERVISOR_REASONS.DISPOSED,
  PROCESS_SUPERVISOR_REASONS.STATE_REGRESSION,
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.PROCESS_FAILED,
]);

function denied(code) {
  return Object.freeze({ ok: false, code });
}

function accepted(field, value) {
  return Object.freeze({ ok: true, [field]: value });
}

function exactOwnDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
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
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      return null;
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function captureOwnMethod(receiver, name) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(receiver, name);
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) return null;
  return Object.freeze({ receiver, method: descriptor.value });
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function normalizeWorkspaceLease(value, binding) {
  const fields = exactOwnDataFields(value, [
    'version',
    'leaseId',
    'jobId',
    'sourceRootIdentityDigest',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
    'workspaceRootPath',
    'workspaceRealRootPath',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== EXECUTION_WORKSPACE_LEASE_VERSION
    || fields.get('jobId') !== binding.jobId
    || !isPortableAbsolutePath(fields.get('workspaceRootPath'))
    || !isPortableAbsolutePath(fields.get('workspaceRealRootPath'))) {
    throw new TypeError('Invalid isolated workspace lease');
  }
  safeIdentifier(fields.get('leaseId'), 'workspace leaseId');
  for (const key of [
    'sourceRootIdentityDigest',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
  ]) {
    if (typeof fields.get(key) !== 'string' || !DIGEST.test(fields.get(key))) {
      throw new TypeError(`Invalid isolated workspace ${key}`);
    }
  }
  return value;
}

function captureDependencies(options) {
  const fields = exactOwnDataFields(options, [
    'binding',
    'workspaceLease',
    'processSupervisor',
  ]);
  if (!fields) {
    throw new TypeError('Invalid execution isolation job process gateway options');
  }
  let binding;
  try {
    binding = createCapabilityDelegationBinding(fields.get('binding'));
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Invalid execution isolation job process binding');
  }
  const workspaceLease = normalizeWorkspaceLease(fields.get('workspaceLease'), binding);
  const processSupervisor = fields.get('processSupervisor');
  const processFields = exactOwnDataFields(processSupervisor, [
    'version',
    'probe',
    'exec',
    'read',
    'wait',
    'stop',
    'diagnostics',
    'dispose',
  ]);
  if (!processFields || !Object.isFrozen(processSupervisor)
    || processFields.get('version') !== PROCESS_SUPERVISOR_VERSION) {
    throw new TypeError('Invalid execution isolation process supervisor');
  }
  const captured = {
    processExec: captureOwnMethod(processSupervisor, 'exec'),
    processRead: captureOwnMethod(processSupervisor, 'read'),
    processWait: captureOwnMethod(processSupervisor, 'wait'),
    processStop: captureOwnMethod(processSupervisor, 'stop'),
  };
  if (Object.values(captured).some((entry) => !entry)) {
    throw new TypeError('Invalid execution isolation process supervisor methods');
  }
  return Object.freeze({
    binding,
    workspaceLease,
    ...captured,
  });
}

function portablePathFlavor(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
    ? path.win32
    : path.posix;
}

function relativeInside(rootPath, candidatePath) {
  if (!isPathInsideProjectRoot(rootPath, candidatePath)) return null;
  const flavor = portablePathFlavor(rootPath);
  return Object.freeze({
    flavor,
    relative: flavor.relative(flavor.resolve(rootPath), flavor.resolve(candidatePath)),
  });
}

function normalizedRelative(descriptor) {
  if (descriptor.relative === '') return '';
  const normalized = descriptor.flavor.normalize(descriptor.relative);
  return descriptor.flavor === path.win32 ? normalized.toLowerCase() : normalized;
}

function pathAtRelative(rootPath, descriptor) {
  return descriptor.relative === ''
    ? rootPath
    : portablePathFlavor(rootPath).join(rootPath, descriptor.relative);
}

function workspaceBoundProcessRequest(dependencies, value) {
  const fields = exactOwnDataFields(value, [
    'schemaVersion',
    'executionId',
    'requestId',
    'grantId',
    'rootPath',
    'realRootPath',
    'cwd',
    'cwdRealPath',
    'command',
    'env',
    'requiredFeatures',
    'networkMode',
    'tempRoots',
    'cacheRoots',
    'timeoutMs',
  ]);
  if (!fields || !Object.isFrozen(value)
    || !Object.isFrozen(fields.get('command'))
    || !Object.isFrozen(fields.get('env'))
    || !Object.isFrozen(fields.get('requiredFeatures'))
    || !Object.isFrozen(fields.get('tempRoots'))
    || !Object.isFrozen(fields.get('cacheRoots'))) {
    throw new TypeError('Authorized sandbox request must be exact frozen data');
  }
  try {
    assertSandboxExecutionRequest(value);
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Invalid authorized sandbox request');
  }
  if (fields.get('rootPath') !== dependencies.binding.canonicalRootPath
    || fields.get('realRootPath') !== dependencies.binding.realRootPath
    || fields.get('tempRoots').length !== 0
    || fields.get('cacheRoots').length !== 0) {
    throw new TypeError('Sandbox request is not bound to the authorized source root');
  }

  const logicalRelative = relativeInside(fields.get('rootPath'), fields.get('cwd'));
  const physicalRelative = relativeInside(
    fields.get('realRootPath'),
    fields.get('cwdRealPath')
  );
  if (!logicalRelative || !physicalRelative
    || logicalRelative.flavor !== physicalRelative.flavor
    || normalizedRelative(logicalRelative) !== normalizedRelative(physicalRelative)
    || portablePathFlavor(dependencies.workspaceLease.workspaceRootPath)
      !== logicalRelative.flavor
    || portablePathFlavor(dependencies.workspaceLease.workspaceRealRootPath)
      !== physicalRelative.flavor) {
    throw new TypeError('Sandbox cwd is not consistently bound to the source root');
  }

  const sandboxRequest = createSandboxExecutionRequest({
    executionId: fields.get('executionId'),
    requestId: fields.get('requestId'),
    grantId: fields.get('grantId'),
    rootPath: dependencies.workspaceLease.workspaceRootPath,
    realRootPath: dependencies.workspaceLease.workspaceRealRootPath,
    cwd: pathAtRelative(
      dependencies.workspaceLease.workspaceRootPath,
      logicalRelative
    ),
    cwdRealPath: pathAtRelative(
      dependencies.workspaceLease.workspaceRealRootPath,
      physicalRelative
    ),
    command: fields.get('command'),
    env: fields.get('env'),
    requiredFeatures: fields.get('requiredFeatures'),
    networkMode: fields.get('networkMode'),
    tempRoots: [],
    cacheRoots: [],
    timeoutMs: fields.get('timeoutMs'),
  });
  return createProcessSupervisorExecRequest({
    workspaceLease: dependencies.workspaceLease,
    sandboxRequest,
  });
}

function processFailureCode(error) {
  preflightDataGraph(error);
  if (!error || (typeof error !== 'object' && typeof error !== 'function')
    || util.types.isProxy(error)) {
    return EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.PROCESS_FAILED;
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  } catch (inspectionError) {
    preflightDataGraph(inspectionError);
    return EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.PROCESS_FAILED;
  }
  return descriptor && Object.hasOwn(descriptor, 'value')
    && PROCESS_REASON_CODES.has(descriptor.value)
    ? descriptor.value
    : EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.PROCESS_FAILED;
}

function normalizedProcessOutcome(value, normalize) {
  try {
    return Object.freeze({ ok: true, value: normalize(value) });
  } catch (error) {
    preflightDataGraph(error);
    return Object.freeze({
      ok: false,
      code: EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.PROCESS_FAILED,
    });
  }
}

function invokeProcessCaptured(captured, args, normalize) {
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, args);
  } catch (error) {
    return Promise.resolve(Object.freeze({
      ok: false,
      code: processFailureCode(error),
    }));
  }
  if (!util.types.isPromise(raw)) {
    return Promise.resolve(normalizedProcessOutcome(raw, normalize));
  }
  return new Promise((resolve) => {
    const onFulfilled = (value) => resolve(normalizedProcessOutcome(value, normalize));
    const onRejected = (error) => resolve(Object.freeze({
      ok: false,
      code: processFailureCode(error),
    }));
    try {
      Reflect.apply(Promise.prototype.then, raw, [onFulfilled, onRejected]);
    } catch (error) {
      preflightDataGraph(raw);
      resolve(Object.freeze({
        ok: false,
        code: processFailureCode(error),
      }));
    }
  });
}

function createExecutionIsolationJobProcessGateway(options = {}) {
  const dependencies = captureDependencies(options);
  const executions = new Map();
  const pendingOperations = new Set();
  let state = 'ready';
  let disposeRequested = false;
  let disposePromise = null;
  let disposeReceipt = null;

  function updateSnapshot(execution, result) {
    execution.snapshot = result;
    execution.state = TERMINAL_STATUSES.has(result.status) ? 'terminal' : 'running';
    return result;
  }

  function trackOperation(operation) {
    pendingOperations.add(operation);
    const forget = () => pendingOperations.delete(operation);
    try {
      Reflect.apply(Promise.prototype.then, operation, [forget, forget]);
    } catch (error) {
      preflightDataGraph(error);
      pendingOperations.delete(operation);
    }
    return operation;
  }

  function exec(input) {
    if (disposeRequested || disposeReceipt) {
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.DISPOSED
      ));
    }
    const fields = exactOwnDataFields(input, ['sandboxRequest']);
    let request;
    let fingerprint;
    try {
      if (!fields) throw new TypeError('Invalid process execution input');
      request = workspaceBoundProcessRequest(
        dependencies,
        fields.get('sandboxRequest')
      );
      fingerprint = canonicalSha256Digest(request);
    } catch (error) {
      preflightDataGraph(error);
      return Promise.resolve(denied(
        EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.INVALID_INPUT
      ));
    }

    const existing = executions.get(request.executionId);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? existing.execPromise
        : Promise.resolve(denied(
          EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.EXECUTION_MISMATCH
        ));
    }

    const execution = {
      request,
      fingerprint,
      state: 'starting',
      snapshot: null,
      execPromise: null,
    };
    executions.set(request.executionId, execution);
    const operation = invokeProcessCaptured(
      dependencies.processExec,
      [request],
      (value) => assertProcessSupervisorExecReceipt(value, request)
    ).then((outcome) => {
      if (!outcome.ok) {
        if (CLEAN_EXEC_REJECTION_CODES.has(outcome.code)) {
          if (executions.get(request.executionId) === execution) {
            executions.delete(request.executionId);
          }
        } else {
          execution.state = 'quarantined';
          state = 'degraded';
        }
        return denied(outcome.code);
      }
      updateSnapshot(execution, outcome.value);
      return accepted('receipt', outcome.value);
    });
    execution.execPromise = operation;
    return trackOperation(operation);
  }

  function prepareOperation(input, operationKeys, createRequest) {
    if (disposeRequested || disposeReceipt) {
      return Object.freeze({
        failed: denied(EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.DISPOSED),
      });
    }
    const fields = exactOwnDataFields(input, ['executionId', ...operationKeys]);
    if (!fields) {
      return Object.freeze({
        failed: denied(EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.INVALID_INPUT),
      });
    }
    let executionId;
    try {
      executionId = safeIdentifier(fields.get('executionId'), 'executionId');
    } catch (error) {
      preflightDataGraph(error);
      return Object.freeze({
        failed: denied(EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.INVALID_INPUT),
      });
    }
    const execution = executions.get(executionId);
    if (!execution) {
      return Object.freeze({
        failed: denied(
          EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.EXECUTION_NOT_FOUND
        ),
      });
    }
    try {
      return Object.freeze({
        execution,
        request: createRequest(fields, execution.request),
      });
    } catch (error) {
      preflightDataGraph(error);
      return Object.freeze({
        failed: denied(EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.INVALID_INPUT),
      });
    }
  }

  function runOperation(prepared, captured, normalize, successField) {
    if (prepared.failed) return Promise.resolve(prepared.failed);
    const { execution, request } = prepared;
    const operation = invokeProcessCaptured(
      captured,
      [request],
      (value) => normalize(value, request)
    ).then((outcome) => {
      if (!outcome.ok) {
        if (QUARANTINE_OPERATION_CODES.has(outcome.code)) {
          execution.state = 'quarantined';
          state = 'degraded';
        }
        return denied(outcome.code);
      }
      updateSnapshot(execution, outcome.value);
      return accepted(successField, outcome.value);
    });
    return trackOperation(operation);
  }

  function read(input) {
    const prepared = prepareOperation(
      input,
      ['cursor', 'maxBytes'],
      (fields, request) => createProcessSupervisorReadRequest({
        request,
        cursor: fields.get('cursor'),
        maxBytes: fields.get('maxBytes'),
      })
    );
    return runOperation(
      prepared,
      dependencies.processRead,
      assertProcessSupervisorReadResult,
      'result'
    );
  }

  function wait(input) {
    const prepared = prepareOperation(
      input,
      ['afterRevision', 'timeoutMs'],
      (fields, request) => createProcessSupervisorWaitRequest({
        request,
        afterRevision: fields.get('afterRevision'),
        timeoutMs: fields.get('timeoutMs'),
      })
    );
    return runOperation(
      prepared,
      dependencies.processWait,
      assertProcessSupervisorWaitResult,
      'result'
    );
  }

  function stop(input) {
    const prepared = prepareOperation(
      input,
      ['expectedRevision', 'reasonCode'],
      (fields, request) => createProcessSupervisorStopRequest({
        request,
        expectedRevision: fields.get('expectedRevision'),
        reasonCode: fields.get('reasonCode'),
      })
    );
    return runOperation(
      prepared,
      dependencies.processStop,
      assertProcessSupervisorStopReceipt,
      'receipt'
    );
  }

  function diagnostics() {
    const counts = {
      starting: 0,
      running: 0,
      terminal: 0,
      quarantined: 0,
    };
    for (const execution of executions.values()) {
      if (Object.hasOwn(counts, execution.state)) counts[execution.state] += 1;
    }
    return Object.freeze({
      version: EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_VERSION,
      state,
      disposed: Boolean(disposeReceipt),
      active: counts.starting + counts.running + counts.quarantined,
      starting: counts.starting,
      running: counts.running,
      terminal: counts.terminal,
      quarantined: counts.quarantined,
    });
  }

  function dispose() {
    if (disposeReceipt) return Promise.resolve(disposeReceipt);
    if (disposePromise) return disposePromise;
    disposeRequested = true;
    state = 'disposing';
    disposePromise = Promise.resolve().then(async () => {
      await Promise.all([...pendingOperations]);
      for (const execution of executions.values()) {
        if (execution.state === 'terminal') continue;
        if (!execution.snapshot) {
          execution.state = 'quarantined';
          continue;
        }
        let request;
        try {
          request = createProcessSupervisorStopRequest({
            request: execution.request,
            expectedRevision: execution.snapshot.revision,
            reasonCode: 'SESSION_CLOSED',
          });
        } catch (error) {
          preflightDataGraph(error);
          execution.state = 'quarantined';
          continue;
        }
        const outcome = await invokeProcessCaptured(
          dependencies.processStop,
          [request],
          (value) => assertProcessSupervisorStopReceipt(value, request)
        );
        if (!outcome.ok) {
          execution.state = 'quarantined';
          continue;
        }
        updateSnapshot(execution, outcome.value);
      }

      const after = diagnostics();
      const clean = after.active === 0 && after.quarantined === 0;
      const receipt = Object.freeze({
        version: EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_DISPOSE_RECEIPT_VERSION,
        ok: clean,
        disposed: true,
        active: after.active,
        terminal: after.terminal,
        quarantined: after.quarantined,
      });
      if (clean) disposeReceipt = receipt;
      state = clean ? 'disposed' : 'degraded';
      disposePromise = null;
      return receipt;
    });
    return disposePromise;
  }

  return Object.freeze({
    version: EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_VERSION,
    exec,
    read,
    wait,
    stop,
    diagnostics,
    dispose,
  });
}

module.exports = {
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_DISPOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS,
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_VERSION,
  createExecutionIsolationJobProcessGateway,
};
