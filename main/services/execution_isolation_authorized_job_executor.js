'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  PROJECT_CAPABILITY_EFFECTS,
} = require('../capabilities/project_capability_contracts');
const {
  SANDBOX_NETWORK_MODES,
  assertSandboxExecutionRequest,
} = require('../capabilities/sandbox_backend_contract');
const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  EXECUTION_ISOLATION_JOB_SESSION_CLOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_VERSION,
} = require('./execution_isolation_job_session_service');

const EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION =
  'execution-isolation-authorized-job-executor.v3';
const EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION =
  'execution-isolation-authorized-job-executor-close-receipt.v1';

const EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS = Object.freeze({
  AUTHORITY_DENIED: 'EXECUTION_ISOLATION_JOB_AUTHORITY_DENIED',
  BROKER_REQUEST_INVALID: 'EXECUTION_ISOLATION_BROKER_REQUEST_INVALID',
  CLEANUP_FAILED: 'EXECUTION_ISOLATION_JOB_CLEANUP_FAILED',
  CLOSED: 'EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSED',
  EXECUTION_FAILED: 'EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTION_FAILED',
  MUTATION_REVISION_MISMATCH:
    'EXECUTION_ISOLATION_AUTHORIZED_JOB_MUTATION_REVISION_MISMATCH',
  PROCESS_NOT_FOUND: 'EXECUTION_ISOLATION_AUTHORIZED_PROCESS_NOT_FOUND',
  PROCESS_OPERATION_FAILED: 'EXECUTION_ISOLATION_AUTHORIZED_PROCESS_OPERATION_FAILED',
  PROCESS_REQUEST_INVALID: 'EXECUTION_ISOLATION_AUTHORIZED_PROCESS_REQUEST_INVALID',
  SESSION_OPEN_FAILED: 'EXECUTION_ISOLATION_AUTHORIZED_JOB_SESSION_OPEN_FAILED',
  SESSION_REFRESH_FAILED: 'EXECUTION_ISOLATION_AUTHORIZED_JOB_SESSION_REFRESH_FAILED',
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
const SANDBOX_REQUEST_KEYS = Object.freeze([
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
const BROKER_CONTEXT_KEYS = Object.freeze([
  'requestId',
  'principal',
  'projectSession',
  'capability',
  'action',
  'effects',
  'requestDigest',
  'mutationRevision',
]);
const BROKER_CONTEXT_REQUIRED_KEYS = Object.freeze([
  'requestId',
  'principal',
  'projectSession',
  'capability',
  'action',
  'effects',
  'requestDigest',
]);
const PROJECT_SESSION_KEYS = Object.freeze([
  'sessionId',
  'projectId',
  'rootPath',
  'realRootPath',
  'cwd',
  'cwdRealPath',
  'jobId',
  'projectName',
  'source',
  'createdAt',
]);
const PROJECT_SESSION_REQUIRED_KEYS = Object.freeze([
  'sessionId',
  'projectId',
  'rootPath',
  'realRootPath',
  'jobId',
]);
const BROKER_EXECUTION_ID = /^sandbox-exec:([a-f0-9]{64})$/;
const BROKER_GRANT_ID = /^sandbox-auth:([a-f0-9]{64})$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_WAIT_MS = 60_000;
const PROCESS_OPERATION_KEYS = Object.freeze({
  read: Object.freeze(['executionId', 'cursor', 'maxBytes']),
  wait: Object.freeze(['executionId', 'afterRevision', 'timeoutMs']),
  stop: Object.freeze(['executionId', 'expectedRevision', 'reasonCode']),
});

class ExecutionIsolationAuthorizedJobExecutorError extends Error {
  constructor(code) {
    super('Authorized isolated job execution was rejected.');
    this.name = 'ExecutionIsolationAuthorizedJobExecutorError';
    this.code = code;
  }
}

function failure(code) {
  return new ExecutionIsolationAuthorizedJobExecutorError(code);
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
  if (!descriptor || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) return null;
  return Object.freeze({ receiver, method: descriptor.value });
}

function exactDenseFrozenArray(value) {
  if (!Array.isArray(value) || !Object.isFrozen(value)
    || util.types.isProxy(value)) return false;
  let keys;
  try {
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch (error) {
    preflightDataGraph(error);
    return false;
  }
  return keys.length === value.length
    && keys.every((key, index) => key === String(index));
}

function safeText(value, maximum = 256) {
  return typeof value === 'string' && value.length > 0
    && value.length <= maximum && !value.includes('\0');
}

function bindingsMatch(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function normalizeBrokerExecution(sandboxRequest, brokerContext, binding) {
  const requestFields = exactOwnDataFields(sandboxRequest, SANDBOX_REQUEST_KEYS);
  const contextFields = exactOwnDataFields(
    brokerContext,
    BROKER_CONTEXT_KEYS,
    BROKER_CONTEXT_REQUIRED_KEYS
  );
  if (!requestFields || !contextFields
    || !Object.isFrozen(sandboxRequest) || !Object.isFrozen(brokerContext)
    || !Object.isFrozen(requestFields.get('command'))
    || !Object.isFrozen(requestFields.get('env'))
    || !exactDenseFrozenArray(requestFields.get('requiredFeatures'))
    || !exactDenseFrozenArray(requestFields.get('tempRoots'))
    || !exactDenseFrozenArray(requestFields.get('cacheRoots'))) {
    throw new TypeError('Broker execution must be exact frozen data');
  }
  try {
    assertSandboxExecutionRequest(sandboxRequest);
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Broker sandbox request is invalid');
  }

  const principal = contextFields.get('principal');
  const principalFields = exactOwnDataFields(principal, ['kind', 'kernelId']);
  const projectSession = contextFields.get('projectSession');
  const sessionFields = exactOwnDataFields(
    projectSession,
    PROJECT_SESSION_KEYS,
    PROJECT_SESSION_REQUIRED_KEYS
  );
  const effects = contextFields.get('effects');
  if (!principalFields || !sessionFields
    || !Object.isFrozen(principal) || !Object.isFrozen(projectSession)
    || !exactDenseFrozenArray(effects)
    || principalFields.get('kind') !== 'agent'
    || principalFields.get('kernelId') !== binding.kernelId
    || sessionFields.get('sessionId') !== binding.sessionId
    || sessionFields.get('projectId') !== binding.projectId
    || sessionFields.get('rootPath') !== binding.canonicalRootPath
    || sessionFields.get('realRootPath') !== binding.realRootPath
    || sessionFields.get('jobId') !== binding.jobId) {
    throw new TypeError('Broker context does not match the job authority');
  }
  if (sessionFields.has('cwd') !== sessionFields.has('cwdRealPath')) {
    throw new TypeError('Broker project cwd identity is incomplete');
  }
  const expectedCwd = sessionFields.has('cwd')
    ? sessionFields.get('cwd')
    : binding.canonicalRootPath;
  const expectedCwdRealPath = sessionFields.has('cwdRealPath')
    ? sessionFields.get('cwdRealPath')
    : binding.realRootPath;
  if (sandboxRequest.rootPath !== binding.canonicalRootPath
    || sandboxRequest.realRootPath !== binding.realRootPath
    || sandboxRequest.cwd !== expectedCwd
    || sandboxRequest.cwdRealPath !== expectedCwdRealPath
    || sandboxRequest.tempRoots.length !== 0
    || sandboxRequest.cacheRoots.length !== 0
    || contextFields.get('requestId') !== sandboxRequest.requestId
    || !safeText(contextFields.get('capability'))
    || !safeText(contextFields.get('action'))
    || !effects.includes(PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE)) {
    throw new TypeError('Broker sandbox request is outside the authorized job scope');
  }
  const executionMatch = BROKER_EXECUTION_ID.exec(sandboxRequest.executionId);
  const grantMatch = BROKER_GRANT_ID.exec(sandboxRequest.grantId);
  const requestDigest = contextFields.get('requestDigest');
  if (!executionMatch || !grantMatch
    || typeof requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(requestDigest)
    || executionMatch[1] !== grantMatch[1]
    || executionMatch[1] !== requestDigest) {
    throw new TypeError('Broker authorization identifiers do not match');
  }
  const allowsNetwork = effects.includes(PROJECT_CAPABILITY_EFFECTS.NETWORK_ACCESS);
  if ((sandboxRequest.networkMode === SANDBOX_NETWORK_MODES.APPROVED) !== allowsNetwork) {
    throw new TypeError('Broker network authorization does not match the request');
  }
  const mutationRevision = contextFields.has('mutationRevision')
    ? contextFields.get('mutationRevision')
    : 0;
  if (!Number.isSafeInteger(mutationRevision) || mutationRevision < 0
    || Object.is(mutationRevision, -0)) {
    throw new TypeError('Broker mutation revision is invalid');
  }
  return Object.freeze({ sandboxRequest, brokerContext, mutationRevision });
}

function normalizeAuthorityDecision(value, binding) {
  const fields = exactOwnDataFields(value, [
    'authorized',
    'reason',
    'binding',
    'physicalRootIdentityDigest',
  ]);
  if (!fields || !Object.isFrozen(value) || fields.get('authorized') !== true) return null;
  let authorizedBinding;
  let physicalRootIdentityDigest;
  try {
    authorizedBinding = createCapabilityDelegationBinding(fields.get('binding'));
    physicalRootIdentityDigest = normalizeDigest(
      fields.get('physicalRootIdentityDigest'),
      'physicalRootIdentityDigest'
    );
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  if (!bindingsMatch(authorizedBinding, binding)
    || physicalRootIdentityDigest !== fields.get('physicalRootIdentityDigest')) {
    return null;
  }
  return Object.freeze({ physicalRootIdentityDigest });
}

function captureDependencies(options) {
  const fields = exactOwnDataFields(options, [
    'binding',
    'authorityService',
    'jobSessionService',
  ]);
  if (!fields) {
    throw new TypeError('Invalid authorized job executor options');
  }
  let binding;
  try {
    binding = createCapabilityDelegationBinding(fields.get('binding'));
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Invalid authorized job executor binding');
  }
  const authorityService = fields.get('authorityService');
  const jobSessionService = fields.get('jobSessionService');
  if (!authorityService || typeof authorityService !== 'object'
    || !jobSessionService || typeof jobSessionService !== 'object'
    || util.types.isProxy(authorityService) || util.types.isProxy(jobSessionService)
    || !Object.isFrozen(authorityService) || !Object.isFrozen(jobSessionService)) {
    throw new TypeError('Authorized job executor dependencies must be frozen');
  }
  const sessionFields = exactOwnDataFields(jobSessionService, [
    'version',
    'open',
    'close',
    'diagnostics',
    'dispose',
  ]);
  const authorityAuthorize = captureOwnMethod(
    authorityService,
    'authorizeProjectRootLease'
  );
  const sessionOpen = captureOwnMethod(jobSessionService, 'open');
  const sessionClose = captureOwnMethod(jobSessionService, 'close');
  if (!sessionFields
    || sessionFields.get('version') !== EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION
    || !authorityAuthorize || !sessionOpen || !sessionClose) {
    throw new TypeError('Invalid authorized job executor dependencies');
  }
  return Object.freeze({ binding, authorityAuthorize, sessionOpen, sessionClose });
}

function invokeNative(captured, args) {
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, args);
  } catch (error) {
    preflightDataGraph(error);
    return Promise.resolve(Object.freeze({ ok: false, value: null }));
  }
  if (!util.types.isPromise(raw)) {
    preflightDataGraph(raw);
    return Promise.resolve(Object.freeze({ ok: false, value: null }));
  }
  return new Promise((resolve) => {
    const onFulfilled = (value) => resolve(Object.freeze({ ok: true, value }));
    const onRejected = (error) => {
      preflightDataGraph(error);
      resolve(Object.freeze({ ok: false, value: null }));
    };
    try {
      Reflect.apply(Promise.prototype.then, raw, [onFulfilled, onRejected]);
    } catch (error) {
      preflightDataGraph(error);
      resolve(Object.freeze({ ok: false, value: null }));
    }
  });
}

function consumeUnexpectedNativePromise(value) {
  try {
    Reflect.apply(Promise.prototype.then, value, [
      () => {},
      (error) => { preflightDataGraph(error); },
    ]);
  } catch (error) {
    preflightDataGraph(error);
  }
}

function normalizeOpenedSession(value, binding) {
  const fields = exactOwnDataFields(value, ['ok', 'session', 'idempotent']);
  if (!fields || !Object.isFrozen(value) || fields.get('ok') !== true
    || typeof fields.get('idempotent') !== 'boolean') return null;
  const session = fields.get('session');
  const sessionFields = exactOwnDataFields(session, [
    'version',
    'jobId',
    'projectId',
    'exec',
    'read',
    'wait',
    'stop',
    'diagnostics',
    'close',
  ]);
  const captured = session && Object.freeze({
    exec: captureOwnMethod(session, 'exec'),
    read: captureOwnMethod(session, 'read'),
    wait: captureOwnMethod(session, 'wait'),
    stop: captureOwnMethod(session, 'stop'),
  });
  if (!sessionFields || !Object.isFrozen(session)
    || sessionFields.get('version') !== EXECUTION_ISOLATION_JOB_SESSION_VERSION
    || sessionFields.get('jobId') !== binding.jobId
    || sessionFields.get('projectId') !== binding.projectId
    || !captured || Object.values(captured).some((entry) => !entry)) return null;
  return Object.freeze({ session, ...captured });
}

function successfulSessionClose(value) {
  const fields = exactOwnDataFields(value, [
    'version',
    'ok',
    'closed',
    'processesStopped',
    'workspaceRolledBack',
    'rootReleased',
  ]);
  return Boolean(fields && Object.isFrozen(value)
    && fields.get('version') === EXECUTION_ISOLATION_JOB_SESSION_CLOSE_RECEIPT_VERSION
    && fields.get('ok') === true
    && fields.get('closed') === true
    && fields.get('processesStopped') === true
    && fields.get('workspaceRolledBack') === true
    && fields.get('rootReleased') === true);
}

function ownDataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (error) {
    preflightDataGraph(error);
    return undefined;
  }
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function normalizeExecutionReceipt(value, expectedExecutionId) {
  const fields = exactOwnDataFields(value, ['ok', 'receipt']);
  if (!fields || !Object.isFrozen(value) || fields.get('ok') !== true) return null;
  const receipt = fields.get('receipt');
  const preflight = preflightDataGraph(receipt);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || util.types.isProxy(receipt) || !Object.isFrozen(receipt)
    || ownDataValue(receipt, 'executionId') !== expectedExecutionId) return null;
  return receipt;
}

function safeOperationInteger(value, {
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
} = {}) {
  return Number.isSafeInteger(value) && !Object.is(value, -0)
    && value >= minimum && value <= maximum;
}

function normalizeProcessOperationInput(operation, value) {
  const keys = PROCESS_OPERATION_KEYS[operation];
  const fields = keys && exactOwnDataFields(value, keys, keys);
  if (!fields || !Object.isFrozen(value)
    || !BROKER_EXECUTION_ID.test(fields.get('executionId'))) return null;
  if (operation === 'read'
    && (!safeOperationInteger(fields.get('cursor'))
      || !safeOperationInteger(fields.get('maxBytes'), {
        minimum: 1,
        maximum: MAX_READ_BYTES,
      }))) return null;
  if (operation === 'wait'
    && (!safeOperationInteger(fields.get('afterRevision'))
      || !safeOperationInteger(fields.get('timeoutMs'), {
        minimum: 1,
        maximum: MAX_WAIT_MS,
      }))) return null;
  if (operation === 'stop'
    && (!safeOperationInteger(fields.get('expectedRevision'), { minimum: 1 })
      || typeof fields.get('reasonCode') !== 'string'
      || !SAFE_REASON_CODE.test(fields.get('reasonCode')))) return null;
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, fields.get(key)])));
}

function normalizeProcessOperationResult(value, successField, executionId) {
  const fields = exactOwnDataFields(value, ['ok', successField]);
  if (!fields || !Object.isFrozen(value) || fields.get('ok') !== true) return null;
  const result = fields.get(successField);
  const preflight = preflightDataGraph(result);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !result || typeof result !== 'object' || Array.isArray(result)
    || util.types.isProxy(result) || !Object.isFrozen(result)
    || ownDataValue(result, 'executionId') !== executionId) return null;
  return result;
}

function createExecutionIsolationAuthorizedJobExecutor(options = {}) {
  const dependencies = captureDependencies(options);
  let state = 'ready';
  let authorityChecks = 0;
  let authorityCheckActive = false;
  let executions = 0;
  let reads = 0;
  let waits = 0;
  let stops = 0;
  const authorizedExecutionIds = new Set();
  let sessionRecord = null;
  let sessionRootIdentityDigest = null;
  let sessionMutationRevision = null;
  let sessionFailureCode = null;
  let openPromise = null;
  let openRootIdentityDigest = null;
  let openMutationRevision = null;
  let openedReservation = false;
  let closeRequested = false;
  let closePromise = null;
  let closeReceipt = null;

  function authorizeRoot() {
    if (authorityCheckActive) return null;
    authorityCheckActive = true;
    authorityChecks += 1;
    try {
      let raw;
      try {
        raw = Reflect.apply(
          dependencies.authorityAuthorize.method,
          dependencies.authorityAuthorize.receiver,
          [dependencies.binding]
        );
      } catch (error) {
        preflightDataGraph(error);
        return null;
      }
      if (util.types.isPromise(raw)) {
        consumeUnexpectedNativePromise(raw);
        preflightDataGraph(raw);
        return null;
      }
      return normalizeAuthorityDecision(raw, dependencies.binding);
    } finally {
      authorityCheckActive = false;
    }
  }

  async function closeOpenedSession() {
    if (!openedReservation) return true;
    const outcome = await invokeNative(dependencies.sessionClose, [Object.freeze({
      binding: dependencies.binding,
    })]);
    if (!outcome.ok || !successfulSessionClose(outcome.value)) return false;
    openedReservation = false;
    sessionRecord = null;
    sessionRootIdentityDigest = null;
    sessionMutationRevision = null;
    sessionFailureCode = null;
    authorizedExecutionIds.clear();
    return true;
  }

  function close() {
    if (closeReceipt) return Promise.resolve(closeReceipt);
    if (closePromise) return closePromise;
    closeRequested = true;
    state = 'closing';
    closePromise = Promise.resolve().then(async () => {
      if (openPromise) {
        try { await openPromise; } catch { /* open failures retain no usable facade */ }
      }
      const hadSession = openedReservation;
      const sessionClosed = await closeOpenedSession();
      const clean = !hadSession || sessionClosed;
      closeReceipt = Object.freeze({
        version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
        ok: clean,
        closed: clean,
        sessionClosed: hadSession && sessionClosed,
      });
      state = clean ? 'closed' : 'quarantined';
      closePromise = null;
      return closeReceipt;
    });
    return closePromise;
  }

  function ensureSession(sourceRootIdentityDigest, mutationRevision) {
    if (sessionRecord) {
      if (sessionRootIdentityDigest !== sourceRootIdentityDigest) {
        return Promise.resolve(Object.freeze({
          opened: null,
          code: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED,
        }));
      }
      if (mutationRevision < sessionMutationRevision) {
        return Promise.resolve(Object.freeze({
          opened: null,
          code: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS
            .MUTATION_REVISION_MISMATCH,
        }));
      }
      if (mutationRevision === sessionMutationRevision) {
        return Promise.resolve(Object.freeze({ opened: sessionRecord, code: null }));
      }
    }
    if (openPromise) {
      if (openRootIdentityDigest !== sourceRootIdentityDigest) {
        return Promise.resolve(Object.freeze({
          opened: null,
          code: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED,
        }));
      }
      if (mutationRevision < openMutationRevision) {
        return Promise.resolve(Object.freeze({
          opened: null,
          code: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS
            .MUTATION_REVISION_MISMATCH,
        }));
      }
      if (mutationRevision === openMutationRevision) return openPromise;
      return openPromise.then((result) => (
        result.opened
          ? ensureSession(sourceRootIdentityDigest, mutationRevision)
          : result
      ));
    }
    const refreshing = Boolean(sessionRecord);
    state = refreshing ? 'refreshing' : 'opening';
    openRootIdentityDigest = sourceRootIdentityDigest;
    openMutationRevision = mutationRevision;
    openPromise = Promise.resolve().then(async () => {
      const outcome = await invokeNative(dependencies.sessionOpen, [Object.freeze({
        binding: dependencies.binding,
        sourceRootIdentityDigest,
        mutationRevision,
      })]);
      if (!outcome.ok) {
        state = 'blocked';
        sessionFailureCode = refreshing
          ? EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_REFRESH_FAILED
          : EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_OPEN_FAILED;
        return Object.freeze({ opened: null, code: sessionFailureCode });
      }
      const opened = normalizeOpenedSession(outcome.value, dependencies.binding);
      if (!opened) {
        const fields = exactOwnDataFields(
          outcome.value,
          ['ok', 'session', 'idempotent'],
          ['ok']
        );
        if (fields && fields.get('ok') === true) {
          openedReservation = true;
          const cleaned = await closeOpenedSession();
          if (!cleaned) state = 'quarantined';
        }
        if (state !== 'quarantined') state = 'blocked';
        sessionFailureCode = state === 'quarantined'
          ? EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLEANUP_FAILED
          : refreshing
            ? EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_REFRESH_FAILED
            : EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_OPEN_FAILED;
        return Object.freeze({ opened: null, code: sessionFailureCode });
      }
      openedReservation = true;
      sessionRecord = opened;
      sessionRootIdentityDigest = sourceRootIdentityDigest;
      sessionMutationRevision = mutationRevision;
      sessionFailureCode = null;
      state = 'active';
      return Object.freeze({ opened, code: null });
    }).then((result) => {
      openPromise = null;
      openRootIdentityDigest = null;
      openMutationRevision = null;
      return result;
    }, (error) => {
      preflightDataGraph(error);
      openPromise = null;
      openRootIdentityDigest = null;
      openMutationRevision = null;
      state = 'blocked';
      sessionFailureCode = refreshing
        ? EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_REFRESH_FAILED
        : EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_OPEN_FAILED;
      return Object.freeze({ opened: null, code: sessionFailureCode });
    });
    return openPromise;
  }

  async function revokeAfterOpen(code) {
    const receipt = await close();
    if (!receipt.ok) throw failure(
      EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLEANUP_FAILED
    );
    throw failure(code);
  }

  function execute(sandboxRequest, brokerContext) {
    if (state === 'revoked') {
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
      ));
    }
    if (state === 'blocked') {
      return Promise.reject(failure(
        sessionFailureCode
          || EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_OPEN_FAILED
      ));
    }
    if (closeRequested || ['closed', 'closing', 'quarantined'].includes(state)) {
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED
      ));
    }
    let normalizedExecution;
    try {
      normalizedExecution = normalizeBrokerExecution(
        sandboxRequest,
        brokerContext,
        dependencies.binding
      );
    } catch (error) {
      preflightDataGraph(error);
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.BROKER_REQUEST_INVALID
      ));
    }
    const firstAuthorization = authorizeRoot();
    if (!firstAuthorization) {
      state = 'revoked';
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
      ));
    }
    if (closeRequested) {
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED
      ));
    }
    if (sessionRecord
      && sessionRootIdentityDigest !== firstAuthorization.physicalRootIdentityDigest) {
      return revokeAfterOpen(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
      );
    }
    const execInput = Object.freeze({
      sandboxRequest,
      mutationRevision: normalizedExecution.mutationRevision,
    });

    return ensureSession(
      firstAuthorization.physicalRootIdentityDigest,
      normalizedExecution.mutationRevision
    ).then(async (sessionOutcome) => {
      if (!sessionOutcome.opened) {
        throw failure(sessionOutcome.code
          || EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_OPEN_FAILED);
      }
      const opened = sessionOutcome.opened;
      if (closeRequested) {
        throw failure(EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED);
      }
      const finalAuthorization = authorizeRoot();
      if (!finalAuthorization
        || finalAuthorization.physicalRootIdentityDigest
          !== firstAuthorization.physicalRootIdentityDigest
        || finalAuthorization.physicalRootIdentityDigest
          !== sessionRootIdentityDigest) {
        return revokeAfterOpen(
          EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
        );
      }

      // This is the final effect frontier: no await or external callback occurs
      // between the synchronous job-authority check above and entering the
      // job-scoped session gateway below.
      let raw;
      try {
        raw = Reflect.apply(opened.exec.method, opened.exec.receiver, [execInput]);
      } catch (error) {
        preflightDataGraph(error);
        throw failure(
          EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.EXECUTION_FAILED
        );
      }
      if (!util.types.isPromise(raw)) {
        preflightDataGraph(raw);
        throw failure(
          EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.EXECUTION_FAILED
        );
      }
      const outcome = await new Promise((resolve) => {
        const onFulfilled = (value) => resolve(Object.freeze({ ok: true, value }));
        const onRejected = (error) => {
          preflightDataGraph(error);
          resolve(Object.freeze({ ok: false, value: null }));
        };
        try {
          Reflect.apply(Promise.prototype.then, raw, [onFulfilled, onRejected]);
        } catch (error) {
          preflightDataGraph(error);
          resolve(Object.freeze({ ok: false, value: null }));
        }
      });
      if (closeRequested) {
        throw failure(EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED);
      }
      const receipt = outcome.ok
        ? normalizeExecutionReceipt(outcome.value, sandboxRequest.executionId)
        : null;
      if (!receipt) {
        throw failure(
          EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.EXECUTION_FAILED
        );
      }
      executions += 1;
      authorizedExecutionIds.add(sandboxRequest.executionId);
      return receipt;
    });
  }

  function processOperation(operation, input, successField) {
    if (state === 'revoked') {
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
      ));
    }
    if (state === 'blocked') {
      return Promise.reject(failure(
        sessionFailureCode
          || EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_OPEN_FAILED
      ));
    }
    if (closeRequested || ['closed', 'closing', 'quarantined'].includes(state)) {
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED
      ));
    }
    const operationInput = normalizeProcessOperationInput(operation, input);
    if (!operationInput) {
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.PROCESS_REQUEST_INVALID
      ));
    }
    if (!sessionRecord || !authorizedExecutionIds.has(operationInput.executionId)) {
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.PROCESS_NOT_FOUND
      ));
    }
    const authorization = authorizeRoot();
    if (!authorization
      || authorization.physicalRootIdentityDigest !== sessionRootIdentityDigest) {
      return revokeAfterOpen(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
      );
    }
    if (closeRequested) {
      return Promise.reject(failure(
        EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED
      ));
    }

    // Final process-operation frontier: the synchronous root lease check above
    // is followed immediately by the captured job-session method.
    const outcomePromise = invokeNative(sessionRecord[operation], [operationInput]);
    return outcomePromise.then((outcome) => {
      if (closeRequested) {
        throw failure(EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED);
      }
      const result = outcome.ok
        ? normalizeProcessOperationResult(
          outcome.value,
          successField,
          operationInput.executionId
        )
        : null;
      if (!result) {
        throw failure(
          EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.PROCESS_OPERATION_FAILED
        );
      }
      if (operation === 'read') reads += 1;
      if (operation === 'wait') waits += 1;
      if (operation === 'stop') stops += 1;
      return result;
    });
  }

  function read(input) {
    return processOperation('read', input, 'result');
  }

  function wait(input) {
    return processOperation('wait', input, 'result');
  }

  function stop(input) {
    return processOperation('stop', input, 'receipt');
  }

  function diagnostics() {
    return Object.freeze({
      version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
      state,
      jobId: dependencies.binding.jobId,
      projectId: dependencies.binding.projectId,
      authorityChecks,
      executions,
      reads,
      waits,
      stops,
    });
  }

  return Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
    execute,
    read,
    wait,
    stop,
    close,
    diagnostics,
  });
}

module.exports = {
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS,
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
  ExecutionIsolationAuthorizedJobExecutorError,
  createExecutionIsolationAuthorizedJobExecutor,
};
