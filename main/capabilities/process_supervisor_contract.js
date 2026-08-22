'use strict';

const util = require('util');

const {
  EXECUTION_WORKSPACE_LEASE_VERSION,
  preflightDataGraph,
} = require('./execution_workspace_contract');
const {
  assertSandboxExecutionRequest,
  isPortableAbsolutePath,
} = require('./sandbox_backend_contract');

const PROCESS_SUPERVISOR_BACKEND_VERSION = 'process-supervisor-backend.v1';
const PROCESS_SUPERVISOR_PROBE_VERSION = 'process-supervisor-probe.v1';
const PROCESS_SUPERVISOR_EXEC_REQUEST_VERSION = 'process-supervisor-exec-request.v1';
const PROCESS_SUPERVISOR_EXEC_RECEIPT_VERSION = 'process-supervisor-exec-receipt.v1';
const PROCESS_SUPERVISOR_READ_REQUEST_VERSION = 'process-supervisor-read-request.v1';
const PROCESS_SUPERVISOR_READ_RESULT_VERSION = 'process-supervisor-read-result.v1';
const PROCESS_SUPERVISOR_WAIT_REQUEST_VERSION = 'process-supervisor-wait-request.v1';
const PROCESS_SUPERVISOR_WAIT_RESULT_VERSION = 'process-supervisor-wait-result.v1';
const PROCESS_SUPERVISOR_STOP_REQUEST_VERSION = 'process-supervisor-stop-request.v1';
const PROCESS_SUPERVISOR_STOP_RECEIPT_VERSION = 'process-supervisor-stop-receipt.v1';

const PROCESS_SUPERVISOR_STATES = Object.freeze({
  ENFORCED: 'enforced',
  UNAVAILABLE: 'unavailable',
});

const PROCESS_EXECUTION_STATUSES = Object.freeze({
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  STOPPED: 'stopped',
  TIMED_OUT: 'timed_out',
});

const PROCESS_SUPERVISOR_GUARANTEES = Object.freeze({
  WORKSPACE_ROOT_BOUND: 'workspace_root_bound',
  PHYSICAL_CWD_REVALIDATION: 'physical_cwd_revalidation',
  NETWORK_DEFAULT_DENY: 'network_default_deny',
  PROCESS_TREE_TERMINATION: 'process_tree_termination',
  BOUNDED_CURSOR_OUTPUT: 'bounded_cursor_output',
  ORPHAN_REAPING: 'orphan_reaping',
  EXECUTION_IDENTITY_BINDING: 'execution_identity_binding',
});

const PROCESS_SUPERVISOR_REQUIRED_GUARANTEES = Object.freeze([
  PROCESS_SUPERVISOR_GUARANTEES.WORKSPACE_ROOT_BOUND,
  PROCESS_SUPERVISOR_GUARANTEES.PHYSICAL_CWD_REVALIDATION,
  PROCESS_SUPERVISOR_GUARANTEES.NETWORK_DEFAULT_DENY,
  PROCESS_SUPERVISOR_GUARANTEES.PROCESS_TREE_TERMINATION,
  PROCESS_SUPERVISOR_GUARANTEES.BOUNDED_CURSOR_OUTPUT,
  PROCESS_SUPERVISOR_GUARANTEES.ORPHAN_REAPING,
  PROCESS_SUPERVISOR_GUARANTEES.EXECUTION_IDENTITY_BINDING,
]);

const PROCESS_OUTPUT_STREAMS = Object.freeze({
  STDERR: 'stderr',
  STDOUT: 'stdout',
  SYSTEM: 'system',
});

const SUPPORTED_PROBE_STATES = new Set(Object.values(PROCESS_SUPERVISOR_STATES));
const SUPPORTED_EXECUTION_STATUSES = new Set(Object.values(PROCESS_EXECUTION_STATUSES));
const TERMINAL_EXECUTION_STATUSES = new Set([
  PROCESS_EXECUTION_STATUSES.SUCCEEDED,
  PROCESS_EXECUTION_STATUSES.FAILED,
  PROCESS_EXECUTION_STATUSES.STOPPED,
  PROCESS_EXECUTION_STATUSES.TIMED_OUT,
]);
const SUPPORTED_GUARANTEES = new Set(Object.values(PROCESS_SUPERVISOR_GUARANTEES));
const SUPPORTED_OUTPUT_STREAMS = new Set(Object.values(PROCESS_OUTPUT_STREAMS));
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const SAFE_SIGNAL = /^[A-Z][A-Z0-9_]{0,31}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_WAIT_MS = 60_000;
const MAX_OUTPUT_CHUNKS = 16_384;

class ProcessSupervisorUnavailableError extends Error {
  constructor(message = 'No enforced process supervisor backend is available.') {
    super(message);
    this.name = 'ProcessSupervisorUnavailableError';
    this.code = 'PROCESS_SUPERVISOR_UNAVAILABLE';
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

function denseDataValues(value, fieldName, maximum = MAX_OUTPUT_CHUNKS) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new TypeError(`${fieldName} must be a bounded dense array`);
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be a bounded dense array`);
  }
  return keys.map((key) => Object.getOwnPropertyDescriptor(value, key).value);
}

function safeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function safeDigest(value, fieldName) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new TypeError(`${fieldName} must be a canonical SHA-256 digest`);
  }
  return value;
}

function safeInteger(value, fieldName, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum
    || Object.is(value, -0)) {
    throw new TypeError(`${fieldName} must be a bounded non-negative integer`);
  }
  return value;
}

function normalizeWorkspaceLease(value) {
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
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== EXECUTION_WORKSPACE_LEASE_VERSION
    || !isPortableAbsolutePath(fields.get('workspaceRootPath'))
    || !isPortableAbsolutePath(fields.get('workspaceRealRootPath'))) {
    throw new TypeError('Invalid execution workspace lease for process supervision');
  }
  safeIdentifier(fields.get('leaseId'), 'workspace leaseId');
  safeIdentifier(fields.get('jobId'), 'workspace jobId');
  safeDigest(fields.get('sourceRootIdentityDigest'), 'sourceRootIdentityDigest');
  safeDigest(fields.get('workspaceAuthorityDigest'), 'workspaceAuthorityDigest');
  safeDigest(fields.get('workspaceRootIdentityDigest'), 'workspaceRootIdentityDigest');
  return value;
}

function normalizeSandboxRequest(value) {
  const fields = exactDataFields(value, [
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
  if (!fields || !Object.isFrozen(value)) {
    throw new TypeError('Invalid sandbox request data for process supervision');
  }
  const command = fields.get('command');
  const commandFields = command && command.kind === 'executable'
    ? exactDataFields(command, ['kind', 'executable', 'args'])
    : exactDataFields(command, ['kind', 'text', 'shellPath'], ['kind', 'text']);
  let envKeys;
  try { envKeys = Reflect.ownKeys(fields.get('env')); } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Invalid sandbox environment data');
  }
  if (!commandFields
    || !exactDataFields(fields.get('env'), envKeys, envKeys)
    || !Object.isFrozen(command)
    || !Object.isFrozen(fields.get('env'))
    || !Object.isFrozen(fields.get('requiredFeatures'))
    || !Object.isFrozen(fields.get('tempRoots'))
    || !Object.isFrozen(fields.get('cacheRoots'))) {
    throw new TypeError('Sandbox request authority must be exact frozen data');
  }
  denseDataValues(fields.get('requiredFeatures'), 'sandbox requiredFeatures', 32);
  denseDataValues(fields.get('tempRoots'), 'sandbox tempRoots', 1_024);
  denseDataValues(fields.get('cacheRoots'), 'sandbox cacheRoots', 1_024);
  if (command.kind === 'executable') {
    denseDataValues(command.args, 'sandbox command args', 100_000);
    if (!Object.isFrozen(command.args)) {
      throw new TypeError('Sandbox command args must be frozen');
    }
  }
  try {
    assertSandboxExecutionRequest(value);
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Invalid sandbox request for process supervision');
  }
  if (value.tempRoots.length !== 0 || value.cacheRoots.length !== 0) {
    throw new TypeError('External temp/cache roots require a separate authority');
  }
  return value;
}

function normalizeExecRequestFields(value) {
  const fields = exactDataFields(value, [
    'version',
    'executionId',
    'jobId',
    'workspaceLeaseId',
    'workspaceAuthorityDigest',
    'workspaceRootIdentityDigest',
    'sandboxRequest',
  ]);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_EXEC_REQUEST_VERSION) {
    throw new TypeError('Invalid process supervisor exec request');
  }
  const sandboxRequest = normalizeSandboxRequest(fields.get('sandboxRequest'));
  const executionId = safeIdentifier(fields.get('executionId'), 'executionId');
  if (sandboxRequest.executionId !== executionId) {
    throw new TypeError('Process execution identity is not bound to its sandbox request');
  }
  return Object.freeze({
    executionId,
    jobId: safeIdentifier(fields.get('jobId'), 'jobId'),
    workspaceLeaseId: safeIdentifier(fields.get('workspaceLeaseId'), 'workspaceLeaseId'),
    workspaceAuthorityDigest: safeDigest(
      fields.get('workspaceAuthorityDigest'),
      'workspaceAuthorityDigest'
    ),
    workspaceRootIdentityDigest: safeDigest(
      fields.get('workspaceRootIdentityDigest'),
      'workspaceRootIdentityDigest'
    ),
    sandboxRequest,
  });
}

function createProcessSupervisorExecRequest(input = {}) {
  const fields = exactDataFields(input, ['workspaceLease', 'sandboxRequest']);
  if (!fields) throw new TypeError('Invalid process supervisor exec request data');
  const workspaceLease = normalizeWorkspaceLease(fields.get('workspaceLease'));
  const sandboxRequest = normalizeSandboxRequest(fields.get('sandboxRequest'));
  if (sandboxRequest.rootPath !== workspaceLease.workspaceRootPath
    || sandboxRequest.realRootPath !== workspaceLease.workspaceRealRootPath) {
    throw new TypeError('Process sandbox root must equal the isolated workspace root');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_EXEC_REQUEST_VERSION,
    executionId: safeIdentifier(sandboxRequest.executionId, 'executionId'),
    jobId: workspaceLease.jobId,
    workspaceLeaseId: workspaceLease.leaseId,
    workspaceAuthorityDigest: workspaceLease.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: workspaceLease.workspaceRootIdentityDigest,
    sandboxRequest,
  });
}

function assertProcessSupervisorExecRequest(value) {
  const normalized = normalizeExecRequestFields(value);
  return Object.freeze({
    version: PROCESS_SUPERVISOR_EXEC_REQUEST_VERSION,
    executionId: normalized.executionId,
    jobId: normalized.jobId,
    workspaceLeaseId: normalized.workspaceLeaseId,
    workspaceAuthorityDigest: normalized.workspaceAuthorityDigest,
    workspaceRootIdentityDigest: normalized.workspaceRootIdentityDigest,
    sandboxRequest: normalized.sandboxRequest,
  });
}

function normalizeGuarantees(value) {
  const values = denseDataValues(value, 'process supervisor guarantees', 32);
  const seen = new Set();
  for (const guarantee of values) {
    if (!SUPPORTED_GUARANTEES.has(guarantee) || seen.has(guarantee)) {
      throw new TypeError('Invalid process supervisor guarantee');
    }
    seen.add(guarantee);
  }
  return Object.freeze(PROCESS_SUPERVISOR_REQUIRED_GUARANTEES.filter(
    (guarantee) => seen.has(guarantee)
  ));
}

function createProcessSupervisorProbeResult(input = {}) {
  const fields = exactDataFields(input, ['state', 'guarantees', 'reasonCode'], [
    'state',
    'guarantees',
  ]);
  if (!fields) throw new TypeError('Invalid process supervisor probe data');
  const state = fields.get('state');
  if (!SUPPORTED_PROBE_STATES.has(state)) {
    throw new TypeError('Invalid process supervisor probe state');
  }
  const guarantees = normalizeGuarantees(fields.get('guarantees'));
  const reasonCode = fields.has('reasonCode') ? fields.get('reasonCode') : null;
  if (state === PROCESS_SUPERVISOR_STATES.ENFORCED
    && (!PROCESS_SUPERVISOR_REQUIRED_GUARANTEES.every(
      (guarantee) => guarantees.includes(guarantee)
    ) || reasonCode !== null)) {
    throw new TypeError('Enforced process supervisor is missing a required guarantee');
  }
  if (state === PROCESS_SUPERVISOR_STATES.UNAVAILABLE
    && (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode))) {
    throw new TypeError('Unavailable process supervisor requires a safe reasonCode');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_PROBE_VERSION,
    state,
    guarantees,
    reasonCode,
  });
}

function assertProcessSupervisorProbeResult(value) {
  const fields = exactDataFields(value, ['version', 'state', 'guarantees', 'reasonCode']);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_PROBE_VERSION) {
    throw new TypeError('Invalid process supervisor probe result');
  }
  return createProcessSupervisorProbeResult({
    state: fields.get('state'),
    guarantees: fields.get('guarantees'),
    reasonCode: fields.get('reasonCode'),
  });
}

function normalizeSnapshot(input, { minimumRevision = 1, terminalOnly = false } = {}) {
  const status = input.status;
  if (!SUPPORTED_EXECUTION_STATUSES.has(status)
    || (terminalOnly && !TERMINAL_EXECUTION_STATUSES.has(status))) {
    throw new TypeError('Invalid process execution status');
  }
  const revision = safeInteger(input.revision, 'revision', { minimum: minimumRevision });
  const availableFromCursor = safeInteger(
    input.availableFromCursor,
    'availableFromCursor'
  );
  const outputCursor = safeInteger(input.outputCursor, 'outputCursor');
  if (availableFromCursor > outputCursor) {
    throw new TypeError('Process output cursor availability is invalid');
  }
  const exitCode = input.exitCode === undefined ? null : input.exitCode;
  const signal = input.signal === undefined ? null : input.signal;
  const timedOut = input.timedOut === undefined ? false : input.timedOut;
  const stopped = input.stopped === undefined ? false : input.stopped;
  if (exitCode !== null && (!Number.isSafeInteger(exitCode) || exitCode < 0
    || Object.is(exitCode, -0))) {
    throw new TypeError('Invalid process exitCode');
  }
  if (signal !== null && (typeof signal !== 'string' || !SAFE_SIGNAL.test(signal))) {
    throw new TypeError('Invalid process signal');
  }
  if (typeof timedOut !== 'boolean' || typeof stopped !== 'boolean') {
    throw new TypeError('Invalid process terminal flags');
  }
  if (status === PROCESS_EXECUTION_STATUSES.RUNNING
    && (exitCode !== null || signal !== null || timedOut || stopped)) {
    throw new TypeError('Running process cannot expose terminal fields');
  }
  if (status === PROCESS_EXECUTION_STATUSES.SUCCEEDED
    && (exitCode !== 0 || signal !== null || timedOut || stopped)) {
    throw new TypeError('Succeeded process must have exitCode 0');
  }
  if (status === PROCESS_EXECUTION_STATUSES.FAILED
    && ((exitCode === null && signal === null) || exitCode === 0 || timedOut || stopped)) {
    throw new TypeError('Failed process requires a non-zero exit or signal');
  }
  if (status === PROCESS_EXECUTION_STATUSES.STOPPED && (!stopped || timedOut)) {
    throw new TypeError('Stopped process must confirm explicit stop');
  }
  if (status === PROCESS_EXECUTION_STATUSES.TIMED_OUT && (!timedOut || stopped)) {
    throw new TypeError('Timed-out process must confirm its timeout');
  }
  return Object.freeze({
    status,
    revision,
    exitCode,
    signal,
    timedOut,
    stopped,
    availableFromCursor,
    outputCursor,
  });
}

function receiptInputFields(input, extraKeys = [], requiredExtraKeys = []) {
  return exactDataFields(input, [
    'request',
    'status',
    'revision',
    'exitCode',
    'signal',
    'timedOut',
    'stopped',
    'availableFromCursor',
    'outputCursor',
    ...extraKeys,
  ], [
    'request',
    'status',
    'revision',
    'availableFromCursor',
    'outputCursor',
    ...requiredExtraKeys,
  ]);
}

function snapshotFromFields(fields, options) {
  return normalizeSnapshot({
    status: fields.get('status'),
    revision: fields.get('revision'),
    exitCode: fields.has('exitCode') ? fields.get('exitCode') : null,
    signal: fields.has('signal') ? fields.get('signal') : null,
    timedOut: fields.has('timedOut') ? fields.get('timedOut') : false,
    stopped: fields.has('stopped') ? fields.get('stopped') : false,
    availableFromCursor: fields.get('availableFromCursor'),
    outputCursor: fields.get('outputCursor'),
  }, options);
}

function createProcessSupervisorExecReceipt(input = {}) {
  const fields = receiptInputFields(input);
  if (!fields) throw new TypeError('Invalid process supervisor exec receipt data');
  const request = assertProcessSupervisorExecRequest(fields.get('request'));
  const snapshot = snapshotFromFields(fields);
  return Object.freeze({
    version: PROCESS_SUPERVISOR_EXEC_RECEIPT_VERSION,
    executionId: request.executionId,
    ...snapshot,
  });
}

function assertProcessSupervisorExecReceipt(value, expectedRequest) {
  const request = assertProcessSupervisorExecRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'version',
    'executionId',
    'status',
    'revision',
    'exitCode',
    'signal',
    'timedOut',
    'stopped',
    'availableFromCursor',
    'outputCursor',
  ]);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_EXEC_RECEIPT_VERSION
    || fields.get('executionId') !== request.executionId) {
    throw new TypeError('Invalid process supervisor exec receipt');
  }
  return createProcessSupervisorExecReceipt({
    request,
    status: fields.get('status'),
    revision: fields.get('revision'),
    exitCode: fields.get('exitCode'),
    signal: fields.get('signal'),
    timedOut: fields.get('timedOut'),
    stopped: fields.get('stopped'),
    availableFromCursor: fields.get('availableFromCursor'),
    outputCursor: fields.get('outputCursor'),
  });
}

function authorityRequestFields(input, operationKeys) {
  const fields = exactDataFields(input, ['request', ...operationKeys]);
  if (!fields) throw new TypeError('Invalid process supervisor authority request data');
  return Object.freeze({
    fields,
    request: assertProcessSupervisorExecRequest(fields.get('request')),
  });
}

function createProcessSupervisorReadRequest(input = {}) {
  const { fields, request } = authorityRequestFields(input, ['cursor', 'maxBytes']);
  return Object.freeze({
    version: PROCESS_SUPERVISOR_READ_REQUEST_VERSION,
    executionId: request.executionId,
    jobId: request.jobId,
    workspaceAuthorityDigest: request.workspaceAuthorityDigest,
    cursor: safeInteger(fields.get('cursor'), 'cursor'),
    maxBytes: safeInteger(fields.get('maxBytes'), 'maxBytes', {
      minimum: 1,
      maximum: MAX_READ_BYTES,
    }),
  });
}

function normalizeReadRequest(value) {
  const fields = exactDataFields(value, [
    'version',
    'executionId',
    'jobId',
    'workspaceAuthorityDigest',
    'cursor',
    'maxBytes',
  ]);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_READ_REQUEST_VERSION) {
    throw new TypeError('Invalid process supervisor read request');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_READ_REQUEST_VERSION,
    executionId: safeIdentifier(fields.get('executionId'), 'executionId'),
    jobId: safeIdentifier(fields.get('jobId'), 'jobId'),
    workspaceAuthorityDigest: safeDigest(
      fields.get('workspaceAuthorityDigest'),
      'workspaceAuthorityDigest'
    ),
    cursor: safeInteger(fields.get('cursor'), 'cursor'),
    maxBytes: safeInteger(fields.get('maxBytes'), 'maxBytes', {
      minimum: 1,
      maximum: MAX_READ_BYTES,
    }),
  });
}

function createProcessSupervisorReadResult(input = {}) {
  const fields = exactDataFields(input, [
    'request',
    'status',
    'revision',
    'exitCode',
    'signal',
    'timedOut',
    'stopped',
    'availableFromCursor',
    'outputCursor',
    'chunks',
    'eof',
  ], [
    'request',
    'status',
    'revision',
    'availableFromCursor',
    'outputCursor',
    'chunks',
    'eof',
  ]);
  if (!fields) throw new TypeError('Invalid process supervisor read result data');
  const request = normalizeReadRequest(fields.get('request'));
  const snapshot = normalizeSnapshot({
    status: fields.get('status'),
    revision: fields.get('revision'),
    exitCode: fields.has('exitCode') ? fields.get('exitCode') : null,
    signal: fields.has('signal') ? fields.get('signal') : null,
    timedOut: fields.has('timedOut') ? fields.get('timedOut') : false,
    stopped: fields.has('stopped') ? fields.get('stopped') : false,
    availableFromCursor: fields.get('availableFromCursor'),
    outputCursor: fields.get('outputCursor'),
  });
  const availableFromCursor = safeInteger(
    fields.get('availableFromCursor'),
    'availableFromCursor'
  );
  const outputCursor = safeInteger(fields.get('outputCursor'), 'outputCursor');
  if (availableFromCursor > outputCursor) {
    throw new TypeError('Invalid process output availability cursor');
  }
  const truncated = request.cursor < availableFromCursor;
  let expectedCursor = Math.max(request.cursor, availableFromCursor);
  let totalBytes = 0;
  const chunks = denseDataValues(fields.get('chunks'), 'process output chunks').map(
    (chunk, index) => {
      const chunkFields = exactDataFields(
        chunk,
        ['startCursor', 'endCursor', 'stream', 'text']
      );
      if (!chunkFields) throw new TypeError(`Invalid process output chunk ${index}`);
      const startCursor = safeInteger(chunkFields.get('startCursor'), 'chunk.startCursor');
      const endCursor = safeInteger(chunkFields.get('endCursor'), 'chunk.endCursor');
      const stream = chunkFields.get('stream');
      const text = chunkFields.get('text');
      const bytes = typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : -1;
      if (startCursor !== expectedCursor || endCursor <= startCursor
        || endCursor - startCursor !== bytes || !SUPPORTED_OUTPUT_STREAMS.has(stream)) {
        throw new TypeError('Invalid process output cursor, bytes, or stream');
      }
      totalBytes += bytes;
      if (totalBytes > request.maxBytes) {
        throw new TypeError('Process output exceeded the requested byte bound');
      }
      expectedCursor = endCursor;
      return Object.freeze({ startCursor, endCursor, stream, text });
    }
  );
  const nextCursor = expectedCursor;
  const eof = fields.get('eof');
  if (nextCursor > outputCursor || typeof eof !== 'boolean'
    || (eof && (!TERMINAL_EXECUTION_STATUSES.has(snapshot.status) || nextCursor !== outputCursor))) {
    throw new TypeError('Invalid process output cursor or eof state');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_READ_RESULT_VERSION,
    executionId: request.executionId,
    ...snapshot,
    cursor: request.cursor,
    availableFromCursor,
    nextCursor,
    outputCursor,
    truncated,
    chunks: Object.freeze(chunks),
    eof,
  });
}

function assertProcessSupervisorReadResult(value, expectedRequest) {
  const request = normalizeReadRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'version',
    'executionId',
    'status',
    'revision',
    'exitCode',
    'signal',
    'timedOut',
    'stopped',
    'cursor',
    'availableFromCursor',
    'nextCursor',
    'outputCursor',
    'truncated',
    'chunks',
    'eof',
  ]);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_READ_RESULT_VERSION
    || fields.get('executionId') !== request.executionId
    || fields.get('cursor') !== request.cursor) {
    throw new TypeError('Invalid process supervisor read result');
  }
  const canonical = createProcessSupervisorReadResult({
    request,
    status: fields.get('status'),
    revision: fields.get('revision'),
    exitCode: fields.get('exitCode'),
    signal: fields.get('signal'),
    timedOut: fields.get('timedOut'),
    stopped: fields.get('stopped'),
    availableFromCursor: fields.get('availableFromCursor'),
    outputCursor: fields.get('outputCursor'),
    chunks: fields.get('chunks'),
    eof: fields.get('eof'),
  });
  if (fields.get('nextCursor') !== canonical.nextCursor
    || fields.get('truncated') !== canonical.truncated) {
    throw new TypeError('Invalid process supervisor read cursor derivation');
  }
  return canonical;
}

function createProcessSupervisorWaitRequest(input = {}) {
  const { fields, request } = authorityRequestFields(input, ['afterRevision', 'timeoutMs']);
  return Object.freeze({
    version: PROCESS_SUPERVISOR_WAIT_REQUEST_VERSION,
    executionId: request.executionId,
    jobId: request.jobId,
    workspaceAuthorityDigest: request.workspaceAuthorityDigest,
    afterRevision: safeInteger(fields.get('afterRevision'), 'afterRevision'),
    timeoutMs: safeInteger(fields.get('timeoutMs'), 'timeoutMs', {
      minimum: 1,
      maximum: MAX_WAIT_MS,
    }),
  });
}

function normalizeWaitRequest(value) {
  const fields = exactDataFields(value, [
    'version',
    'executionId',
    'jobId',
    'workspaceAuthorityDigest',
    'afterRevision',
    'timeoutMs',
  ]);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_WAIT_REQUEST_VERSION) {
    throw new TypeError('Invalid process supervisor wait request');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_WAIT_REQUEST_VERSION,
    executionId: safeIdentifier(fields.get('executionId'), 'executionId'),
    jobId: safeIdentifier(fields.get('jobId'), 'jobId'),
    workspaceAuthorityDigest: safeDigest(
      fields.get('workspaceAuthorityDigest'),
      'workspaceAuthorityDigest'
    ),
    afterRevision: safeInteger(fields.get('afterRevision'), 'afterRevision'),
    timeoutMs: safeInteger(fields.get('timeoutMs'), 'timeoutMs', {
      minimum: 1,
      maximum: MAX_WAIT_MS,
    }),
  });
}

function createProcessSupervisorWaitResult(input = {}) {
  const fields = receiptInputFields(input, ['changed'], ['changed']);
  if (!fields) throw new TypeError('Invalid process supervisor wait result data');
  const request = normalizeWaitRequest(fields.get('request'));
  const snapshot = snapshotFromFields(fields);
  const changed = fields.get('changed');
  if (typeof changed !== 'boolean' || snapshot.revision < request.afterRevision
    || changed !== (snapshot.revision > request.afterRevision)) {
    throw new TypeError('Invalid process wait revision or changed state');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_WAIT_RESULT_VERSION,
    executionId: request.executionId,
    ...snapshot,
    changed,
  });
}

function assertProcessSupervisorWaitResult(value, expectedRequest) {
  const request = normalizeWaitRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'version',
    'executionId',
    'status',
    'revision',
    'exitCode',
    'signal',
    'timedOut',
    'stopped',
    'availableFromCursor',
    'outputCursor',
    'changed',
  ]);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_WAIT_RESULT_VERSION
    || fields.get('executionId') !== request.executionId) {
    throw new TypeError('Invalid process supervisor wait result');
  }
  return createProcessSupervisorWaitResult({
    request,
    status: fields.get('status'),
    revision: fields.get('revision'),
    exitCode: fields.get('exitCode'),
    signal: fields.get('signal'),
    timedOut: fields.get('timedOut'),
    stopped: fields.get('stopped'),
    availableFromCursor: fields.get('availableFromCursor'),
    outputCursor: fields.get('outputCursor'),
    changed: fields.get('changed'),
  });
}

function createProcessSupervisorStopRequest(input = {}) {
  const { fields, request } = authorityRequestFields(
    input,
    ['expectedRevision', 'reasonCode']
  );
  const reasonCode = fields.get('reasonCode');
  if (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)) {
    throw new TypeError('Invalid process stop reasonCode');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_STOP_REQUEST_VERSION,
    executionId: request.executionId,
    jobId: request.jobId,
    workspaceAuthorityDigest: request.workspaceAuthorityDigest,
    expectedRevision: safeInteger(fields.get('expectedRevision'), 'expectedRevision', {
      minimum: 1,
    }),
    reasonCode,
  });
}

function normalizeStopRequest(value) {
  const fields = exactDataFields(value, [
    'version',
    'executionId',
    'jobId',
    'workspaceAuthorityDigest',
    'expectedRevision',
    'reasonCode',
  ]);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_STOP_REQUEST_VERSION
    || typeof fields.get('reasonCode') !== 'string'
    || !SAFE_REASON_CODE.test(fields.get('reasonCode'))) {
    throw new TypeError('Invalid process supervisor stop request');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_STOP_REQUEST_VERSION,
    executionId: safeIdentifier(fields.get('executionId'), 'executionId'),
    jobId: safeIdentifier(fields.get('jobId'), 'jobId'),
    workspaceAuthorityDigest: safeDigest(
      fields.get('workspaceAuthorityDigest'),
      'workspaceAuthorityDigest'
    ),
    expectedRevision: safeInteger(fields.get('expectedRevision'), 'expectedRevision', {
      minimum: 1,
    }),
    reasonCode: fields.get('reasonCode'),
  });
}

function createProcessSupervisorStopReceipt(input = {}) {
  const fields = receiptInputFields(
    input,
    ['treeTerminated', 'idempotent'],
    ['treeTerminated', 'idempotent']
  );
  if (!fields) throw new TypeError('Invalid process supervisor stop receipt data');
  const request = normalizeStopRequest(fields.get('request'));
  const snapshot = snapshotFromFields(fields, { terminalOnly: true });
  const treeTerminated = fields.get('treeTerminated');
  const idempotent = fields.get('idempotent');
  if (treeTerminated !== true || typeof idempotent !== 'boolean'
    || snapshot.revision < request.expectedRevision
    || (!idempotent && snapshot.revision <= request.expectedRevision)) {
    throw new TypeError('Process tree termination receipt is invalid');
  }
  return Object.freeze({
    version: PROCESS_SUPERVISOR_STOP_RECEIPT_VERSION,
    executionId: request.executionId,
    ...snapshot,
    treeTerminated: true,
    idempotent,
  });
}

function assertProcessSupervisorStopReceipt(value, expectedRequest) {
  const request = normalizeStopRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'version',
    'executionId',
    'status',
    'revision',
    'exitCode',
    'signal',
    'timedOut',
    'stopped',
    'availableFromCursor',
    'outputCursor',
    'treeTerminated',
    'idempotent',
  ]);
  if (!fields || fields.get('version') !== PROCESS_SUPERVISOR_STOP_RECEIPT_VERSION
    || fields.get('executionId') !== request.executionId) {
    throw new TypeError('Invalid process supervisor stop receipt');
  }
  return createProcessSupervisorStopReceipt({
    request,
    status: fields.get('status'),
    revision: fields.get('revision'),
    exitCode: fields.get('exitCode'),
    signal: fields.get('signal'),
    timedOut: fields.get('timedOut'),
    stopped: fields.get('stopped'),
    availableFromCursor: fields.get('availableFromCursor'),
    outputCursor: fields.get('outputCursor'),
    treeTerminated: fields.get('treeTerminated'),
    idempotent: fields.get('idempotent'),
  });
}

function createProcessSupervisorDisposeReceipt(input = {}) {
  const fields = exactDataFields(input, ['orphaned']);
  if (!fields || fields.get('orphaned') !== 0) {
    throw new TypeError('Process supervisor disposal cannot retain orphan processes');
  }
  return Object.freeze({ ok: true, disposed: true, orphaned: 0 });
}

function assertProcessSupervisorDisposeReceipt(value) {
  const fields = exactDataFields(value, ['ok', 'disposed', 'orphaned']);
  if (!fields || fields.get('ok') !== true || fields.get('disposed') !== true
    || fields.get('orphaned') !== 0) {
    throw new TypeError('Invalid process supervisor dispose receipt');
  }
  return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
}

function assertBackendMethod(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  let keys;
  try { keys = Reflect.ownKeys(value); } catch (error) {
    preflightDataGraph(error);
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'string' || !descriptor
      || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable === true;
  })) {
    throw new TypeError(`${fieldName} must not carry enumerable authority`);
  }
  return value;
}

function assertProcessSupervisorBackend(value) {
  const fields = exactDataFields(value, [
    'version',
    'id',
    'probe',
    'exec',
    'read',
    'wait',
    'stop',
    'dispose',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== PROCESS_SUPERVISOR_BACKEND_VERSION) {
    throw new TypeError('Invalid process supervisor backend');
  }
  safeIdentifier(fields.get('id'), 'process supervisor backend id');
  for (const method of ['probe', 'exec', 'read', 'wait', 'stop', 'dispose']) {
    assertBackendMethod(fields.get(method), `process supervisor backend.${method}`);
  }
  return value;
}

function createUnsupportedProcessSupervisorBackend(options = {}) {
  const fields = exactDataFields(options, ['id', 'reasonCode'], []);
  if (!fields) throw new TypeError('Invalid unsupported process supervisor options');
  const id = fields.has('id') ? fields.get('id') : 'unsupported-process-supervisor';
  const reasonCode = fields.has('reasonCode')
    ? fields.get('reasonCode')
    : 'PROCESS_SUPERVISOR_PROVIDER_UNAVAILABLE';
  safeIdentifier(id, 'process supervisor backend id');
  if (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)) {
    throw new TypeError('Invalid unsupported process supervisor reasonCode');
  }
  const unavailable = (input) => {
    preflightDataGraph(input);
    throw new ProcessSupervisorUnavailableError(reasonCode);
  };
  return Object.freeze({
    version: PROCESS_SUPERVISOR_BACKEND_VERSION,
    id,
    async probe(input) {
      preflightDataGraph(input);
      return createProcessSupervisorProbeResult({
        state: PROCESS_SUPERVISOR_STATES.UNAVAILABLE,
        guarantees: [],
        reasonCode,
      });
    },
    async exec(input) { return unavailable(input); },
    async read(input) { return unavailable(input); },
    async wait(input) { return unavailable(input); },
    async stop(input) { return unavailable(input); },
    async dispose(input) {
      preflightDataGraph(input);
      return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    },
  });
}

module.exports = {
  MAX_READ_BYTES,
  MAX_WAIT_MS,
  PROCESS_EXECUTION_STATUSES,
  PROCESS_OUTPUT_STREAMS,
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_EXEC_RECEIPT_VERSION,
  PROCESS_SUPERVISOR_EXEC_REQUEST_VERSION,
  PROCESS_SUPERVISOR_GUARANTEES,
  PROCESS_SUPERVISOR_PROBE_VERSION,
  PROCESS_SUPERVISOR_READ_REQUEST_VERSION,
  PROCESS_SUPERVISOR_READ_RESULT_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  PROCESS_SUPERVISOR_STOP_RECEIPT_VERSION,
  PROCESS_SUPERVISOR_STOP_REQUEST_VERSION,
  PROCESS_SUPERVISOR_WAIT_REQUEST_VERSION,
  PROCESS_SUPERVISOR_WAIT_RESULT_VERSION,
  ProcessSupervisorUnavailableError,
  TERMINAL_EXECUTION_STATUSES,
  assertProcessSupervisorBackend,
  assertProcessSupervisorDisposeReceipt,
  assertProcessSupervisorExecReceipt,
  assertProcessSupervisorExecRequest,
  assertProcessSupervisorProbeResult,
  assertProcessSupervisorReadResult,
  assertProcessSupervisorStopReceipt,
  assertProcessSupervisorWaitResult,
  createProcessSupervisorDisposeReceipt,
  createProcessSupervisorExecReceipt,
  createProcessSupervisorExecRequest,
  createProcessSupervisorProbeResult,
  createProcessSupervisorReadRequest,
  createProcessSupervisorReadResult,
  createProcessSupervisorStopReceipt,
  createProcessSupervisorStopRequest,
  createProcessSupervisorWaitRequest,
  createProcessSupervisorWaitResult,
  createUnsupportedProcessSupervisorBackend,
  normalizeReadRequest,
  normalizeStopRequest,
  normalizeWaitRequest,
};
