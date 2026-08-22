'use strict';

const util = require('util');

const {
  PROCESS_EXECUTION_STATUSES,
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
  createProcessSupervisorProbeResult,
  createProcessSupervisorStopRequest,
  createUnsupportedProcessSupervisorBackend,
  normalizeReadRequest,
  normalizeStopRequest,
  normalizeWaitRequest,
} = require('../../capabilities/process_supervisor_contract');
const {
  preflightDataGraph,
} = require('../../capabilities/execution_workspace_contract');
const {
  canonicalSha256Digest,
} = require('../../capabilities/transactional_delete_contracts');

const PROCESS_SUPERVISOR_VERSION = 'process-supervisor.v1';
const DEFAULT_MAX_ACTIVE_EXECUTIONS = 16;
const HARD_MAX_ACTIVE_EXECUTIONS = 1_024;

const PROCESS_SUPERVISOR_REASONS = Object.freeze({
  AUTHORITY_MISMATCH: 'PROCESS_AUTHORITY_MISMATCH',
  BACKEND_REJECTED: 'PROCESS_BACKEND_REJECTED',
  CAPACITY_EXCEEDED: 'PROCESS_CAPACITY_EXCEEDED',
  DISPOSED: 'PROCESS_SUPERVISOR_DISPOSED',
  EXECUTION_CONFLICT: 'PROCESS_EXECUTION_CONFLICT',
  INVALID_REQUEST: 'PROCESS_INVALID_REQUEST',
  JOB_BUSY: 'PROCESS_JOB_BUSY',
  NOT_FOUND: 'PROCESS_EXECUTION_NOT_FOUND',
  REENTRANT_CALL: 'PROCESS_REENTRANT_CALL',
  REVISION_MISMATCH: 'PROCESS_REVISION_MISMATCH',
  STATE_REGRESSION: 'PROCESS_STATE_REGRESSION',
  UNAVAILABLE: 'PROCESS_SUPERVISOR_UNAVAILABLE',
});

class ProcessSupervisorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProcessSupervisorError';
    this.code = code;
  }
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

function captureBackend(value) {
  const backend = assertProcessSupervisorBackend(value);
  const captured = { receiver: backend };
  for (const name of ['probe', 'exec', 'read', 'wait', 'stop', 'dispose']) {
    const descriptor = Object.getOwnPropertyDescriptor(backend, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function') {
      throw new TypeError('Process supervisor backend methods must be own data fields');
    }
    captured[name] = descriptor.value;
  }
  return Object.freeze(captured);
}

function createProcessSupervisor(options = {}) {
  const optionFields = exactDataFields(options, ['backend', 'maxActiveExecutions'], []);
  if (!optionFields) throw new TypeError('Invalid process supervisor options');
  const backend = captureBackend(optionFields.has('backend')
    ? optionFields.get('backend')
    : createUnsupportedProcessSupervisorBackend());
  const maxActiveExecutions = optionFields.has('maxActiveExecutions')
    ? optionFields.get('maxActiveExecutions')
    : DEFAULT_MAX_ACTIVE_EXECUTIONS;
  if (!Number.isSafeInteger(maxActiveExecutions) || maxActiveExecutions < 1
    || maxActiveExecutions > HARD_MAX_ACTIVE_EXECUTIONS) {
    throw new TypeError('maxActiveExecutions must be a bounded positive integer');
  }

  const records = new Map();
  const activeByJob = new Map();
  let backendCallDepth = 0;
  let backendState = 'unprobed';
  let probePromise = null;
  let probeResult = null;
  let disposed = false;
  let disposePromise = null;
  let disposeResult = null;

  function error(code) {
    return new ProcessSupervisorError(code);
  }

  function rejected(code) {
    return Promise.reject(error(code));
  }

  function normalizeProviderResult(normalize, value) {
    try {
      return normalize(value);
    } catch (providerError) {
      preflightDataGraph(providerError);
      throw error(PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED);
    }
  }

  function invokeBackend(name, args, normalize) {
    let raw;
    backendCallDepth += 1;
    try {
      raw = Reflect.apply(backend[name], backend.receiver, args);
    } catch (providerError) {
      preflightDataGraph(providerError);
      backendCallDepth -= 1;
      return rejected(PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED);
    }
    backendCallDepth -= 1;

    if (!util.types.isPromise(raw)) {
      try {
        return Promise.resolve(normalizeProviderResult(normalize, raw));
      } catch (providerError) {
        return Promise.reject(providerError);
      }
    }

    return new Promise((resolve, reject) => {
      const onFulfilled = (value) => {
        try {
          resolve(normalizeProviderResult(normalize, value));
        } catch (providerError) {
          reject(providerError);
        }
      };
      const onRejected = (providerError) => {
        preflightDataGraph(providerError);
        reject(error(PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED));
      };
      try {
        Reflect.apply(Promise.prototype.then, raw, [onFulfilled, onRejected]);
      } catch (providerError) {
        preflightDataGraph(raw);
        preflightDataGraph(providerError);
        reject(error(PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED));
      }
    });
  }

  function unavailableProbe(reasonCode) {
    return createProcessSupervisorProbeResult({
      state: PROCESS_SUPERVISOR_STATES.UNAVAILABLE,
      guarantees: [],
      reasonCode,
    });
  }

  function ensureProbe() {
    if (probePromise) return probePromise;
    const context = Object.freeze({
      requiredGuarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
    });
    probePromise = invokeBackend(
      'probe',
      [context],
      assertProcessSupervisorProbeResult
    ).then(
      (result) => {
        probeResult = result;
        backendState = result.state;
        return result;
      },
      (providerError) => {
        preflightDataGraph(providerError);
        backendState = 'rejected';
        probeResult = unavailableProbe('PROCESS_SUPERVISOR_BACKEND_REJECTED');
        return probeResult;
      }
    );
    return probePromise;
  }

  function probe() {
    return ensureProbe();
  }

  function requestFingerprint(request) {
    return canonicalSha256Digest(request);
  }

  function activeRecordCount() {
    let count = 0;
    for (const record of records.values()) {
      if (['starting', 'running', 'quarantined'].includes(record.state)) count += 1;
    }
    return count;
  }

  function releaseJob(record) {
    if (activeByJob.get(record.request.jobId) === record) {
      activeByJob.delete(record.request.jobId);
    }
  }

  function removeStartingRecord(record) {
    if (records.get(record.request.executionId) === record && record.state === 'starting') {
      records.delete(record.request.executionId);
      releaseJob(record);
    }
  }

  function snapshotFromResult(result, previous = null) {
    return Object.freeze({
      status: result.status,
      revision: result.revision,
      exitCode: Object.hasOwn(result, 'exitCode')
        ? result.exitCode
        : previous ? previous.exitCode : null,
      signal: Object.hasOwn(result, 'signal')
        ? result.signal
        : previous ? previous.signal : null,
      timedOut: Object.hasOwn(result, 'timedOut')
        ? result.timedOut
        : previous ? previous.timedOut : false,
      stopped: Object.hasOwn(result, 'stopped')
        ? result.stopped
        : previous ? previous.stopped : false,
      availableFromCursor: result.availableFromCursor,
      outputCursor: result.outputCursor,
    });
  }

  function sameSnapshot(left, right) {
    return [
      'status',
      'revision',
      'exitCode',
      'signal',
      'timedOut',
      'stopped',
      'availableFromCursor',
      'outputCursor',
    ].every((key) => left[key] === right[key]);
  }

  function applySnapshot(record, result) {
    const previous = record.snapshot;
    const next = snapshotFromResult(result, previous);
    const regressed = previous && (
      next.revision < previous.revision
      || next.outputCursor < previous.outputCursor
      || next.availableFromCursor < previous.availableFromCursor
      || (TERMINAL_EXECUTION_STATUSES.has(previous.status) && next.status !== previous.status)
      || (next.revision === previous.revision && !sameSnapshot(next, previous))
    );
    if (regressed) {
      record.state = 'quarantined';
      throw error(PROCESS_SUPERVISOR_REASONS.STATE_REGRESSION);
    }
    record.snapshot = next;
    if (TERMINAL_EXECUTION_STATUSES.has(next.status)) {
      record.state = 'terminal';
      releaseJob(record);
    } else {
      record.state = 'running';
    }
    return result;
  }

  function quarantineOnBackendFailure(record, providerError) {
    if (providerError && providerError.code === PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED) {
      record.state = 'quarantined';
    }
    throw providerError;
  }

  function exec(input) {
    if (backendCallDepth > 0) return rejected(PROCESS_SUPERVISOR_REASONS.REENTRANT_CALL);
    if (disposed) return rejected(PROCESS_SUPERVISOR_REASONS.DISPOSED);
    let request;
    try { request = assertProcessSupervisorExecRequest(input); } catch (requestError) {
      preflightDataGraph(requestError);
      return rejected(PROCESS_SUPERVISOR_REASONS.INVALID_REQUEST);
    }
    const fingerprint = requestFingerprint(request);
    const existing = records.get(request.executionId);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? existing.execPromise
        : rejected(PROCESS_SUPERVISOR_REASONS.EXECUTION_CONFLICT);
    }
    if (activeByJob.has(request.jobId)) {
      return rejected(PROCESS_SUPERVISOR_REASONS.JOB_BUSY);
    }
    if (activeRecordCount() >= maxActiveExecutions) {
      return rejected(PROCESS_SUPERVISOR_REASONS.CAPACITY_EXCEEDED);
    }

    const record = {
      request,
      fingerprint,
      state: 'starting',
      snapshot: null,
      execPromise: null,
      providerStarted: false,
    };
    records.set(request.executionId, record);
    activeByJob.set(request.jobId, record);
    record.execPromise = ensureProbe()
      .then((backendProbe) => {
        if (disposed) throw error(PROCESS_SUPERVISOR_REASONS.DISPOSED);
        if (backendProbe.state !== PROCESS_SUPERVISOR_STATES.ENFORCED) {
          throw error(backendState === 'rejected'
            ? PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED
            : PROCESS_SUPERVISOR_REASONS.UNAVAILABLE);
        }
        record.providerStarted = true;
        return invokeBackend(
          'exec',
          [request],
          (value) => assertProcessSupervisorExecReceipt(value, request)
        );
      })
      .then((receipt) => applySnapshot(record, receipt))
      .catch((executionError) => {
        preflightDataGraph(executionError);
        if (record.providerStarted) {
          // Provider code may have created a process before returning an
          // invalid/rejected receipt. Retain the record so disposal cannot
          // falsely report a clean shutdown.
          record.state = 'quarantined';
        } else removeStartingRecord(record);
        throw executionError;
      });
    return record.execPromise;
  }

  function recordForAuthority(request) {
    const record = records.get(request.executionId);
    if (!record) throw error(PROCESS_SUPERVISOR_REASONS.NOT_FOUND);
    if (record.request.jobId !== request.jobId
      || record.request.workspaceAuthorityDigest !== request.workspaceAuthorityDigest) {
      throw error(PROCESS_SUPERVISOR_REASONS.AUTHORITY_MISMATCH);
    }
    return record;
  }

  function prepareOperation(input, normalize) {
    if (backendCallDepth > 0) {
      return Object.freeze({ failed: rejected(PROCESS_SUPERVISOR_REASONS.REENTRANT_CALL) });
    }
    if (disposed) {
      return Object.freeze({ failed: rejected(PROCESS_SUPERVISOR_REASONS.DISPOSED) });
    }
    let request;
    let record;
    try {
      request = normalize(input);
      record = recordForAuthority(request);
    } catch (requestError) {
      preflightDataGraph(requestError);
      const code = requestError && requestError.code
        ? requestError.code
        : PROCESS_SUPERVISOR_REASONS.INVALID_REQUEST;
      return Object.freeze({ failed: rejected(code) });
    }
    return Object.freeze({ request, record });
  }

  function read(input) {
    const prepared = prepareOperation(input, normalizeReadRequest);
    if (prepared.failed) return prepared.failed;
    const { request, record } = prepared;
    return record.execPromise
      .then(() => invokeBackend(
        'read',
        [request],
        (value) => assertProcessSupervisorReadResult(value, request)
      ))
      .then((result) => applySnapshot(record, result))
      .catch((providerError) => quarantineOnBackendFailure(record, providerError));
  }

  function wait(input) {
    const prepared = prepareOperation(input, normalizeWaitRequest);
    if (prepared.failed) return prepared.failed;
    const { request, record } = prepared;
    return record.execPromise
      .then(() => invokeBackend(
        'wait',
        [request],
        (value) => assertProcessSupervisorWaitResult(value, request)
      ))
      .then((result) => applySnapshot(record, result))
      .catch((providerError) => quarantineOnBackendFailure(record, providerError));
  }

  function stopRecord(record, request) {
    if (record.snapshot && request.expectedRevision !== record.snapshot.revision) {
      return rejected(PROCESS_SUPERVISOR_REASONS.REVISION_MISMATCH);
    }
    return invokeBackend(
      'stop',
      [request],
      (value) => assertProcessSupervisorStopReceipt(value, request)
    )
      .then((receipt) => applySnapshot(record, receipt))
      .catch((providerError) => quarantineOnBackendFailure(record, providerError));
  }

  function stop(input) {
    const prepared = prepareOperation(input, normalizeStopRequest);
    if (prepared.failed) return prepared.failed;
    const { request, record } = prepared;
    return record.execPromise.then(() => stopRecord(record, request));
  }

  function diagnostics() {
    const counts = { starting: 0, running: 0, terminal: 0, quarantined: 0 };
    for (const record of records.values()) {
      if (Object.hasOwn(counts, record.state)) counts[record.state] += 1;
    }
    return Object.freeze({
      version: PROCESS_SUPERVISOR_VERSION,
      backendState,
      disposed,
      starting: counts.starting,
      running: counts.running,
      terminal: counts.terminal,
      quarantined: counts.quarantined,
      maxActiveExecutions,
    });
  }

  function dispose() {
    if (backendCallDepth > 0) return rejected(PROCESS_SUPERVISOR_REASONS.REENTRANT_CALL);
    if (disposeResult) return Promise.resolve(disposeResult);
    if (disposePromise) return disposePromise;
    disposed = true;

    const pendingStops = [...records.values()].map((record) => (
      record.execPromise.catch(() => null).then(() => {
        if (!['running', 'quarantined'].includes(record.state) || !record.snapshot) return null;
        let request;
        try {
          request = createProcessSupervisorStopRequest({
            request: record.request,
            expectedRevision: record.snapshot.revision,
            reasonCode: 'SUPERVISOR_DISPOSED',
          });
        } catch (requestError) {
          preflightDataGraph(requestError);
          record.state = 'quarantined';
          return null;
        }
        return stopRecord(record, request).catch((stopError) => {
          preflightDataGraph(stopError);
          record.state = 'quarantined';
          return null;
        });
      })
    ));

    disposePromise = Promise.all(pendingStops)
      .then(() => invokeBackend(
        'dispose',
        [],
        assertProcessSupervisorDisposeReceipt
      ))
      .then(
        (receipt) => {
          const quarantined = diagnostics().quarantined;
          disposeResult = Object.freeze({
            ok: quarantined === 0 && receipt.orphaned === 0,
            disposed: true,
            quarantined,
            orphaned: receipt.orphaned,
          });
          disposePromise = null;
          return disposeResult;
        },
        (providerError) => {
          preflightDataGraph(providerError);
          const quarantined = diagnostics().quarantined;
          disposeResult = Object.freeze({
            ok: false,
            disposed: true,
            quarantined,
            orphaned: Math.max(1, quarantined),
          });
          disposePromise = null;
          return disposeResult;
        }
      );
    return disposePromise;
  }

  return Object.freeze({
    version: PROCESS_SUPERVISOR_VERSION,
    probe,
    exec,
    read,
    wait,
    stop,
    diagnostics,
    dispose,
  });
}

module.exports = {
  PROCESS_SUPERVISOR_REASONS,
  PROCESS_SUPERVISOR_VERSION,
  ProcessSupervisorError,
  createProcessSupervisor,
};
