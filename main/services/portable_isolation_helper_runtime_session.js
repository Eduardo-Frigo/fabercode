'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  assertPortableIsolationHelperBackendRequest,
  createPortableIsolationHelperBackendResponse,
} = require('../capabilities/portable_isolation_helper_backend_contract');
const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  assertPortableIsolationHelperHandshakeRequest,
  assertPortableIsolationHelperRequest,
  assertPortableIsolationHelperShutdownReceipt,
  createPortableIsolationHelperFailureReceipt,
  createPortableIsolationHelperHandshakeResponse,
  createPortableIsolationHelperResponse,
} = require('../capabilities/portable_isolation_helper_protocol');
const {
  immutableSnapshot,
} = require('../capabilities/capability_delegation_contracts');

const PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION =
  'portable-isolation-helper-runtime-session.v1';
const PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION =
  'portable-isolation-helper-runtime-dispatch-request.v1';

const OPTION_KEYS = Object.freeze(['identity', 'dispatch', 'dispose']);
const IDENTITY_KEYS = Object.freeze([
  'helperId',
  'helperBuildId',
  'bundleIdentityDigest',
  'executionWorkspaceBackendId',
  'projectRootAuthorityBackendId',
  'processSupervisorBackendId',
  'platform',
]);
const PLATFORM_KEYS = Object.freeze(['os', 'architecture', 'signatureVerification']);
const DISPOSE_KEYS = Object.freeze(['reasonCode']);
const QUARANTINE_KEYS = Object.freeze(['reasonCode']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_OS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
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
const RUNTIME_OPERATION_ERRORS = new WeakSet();

class PortableIsolationHelperRuntimeSessionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperRuntimeSessionError';
    this.code = code;
  }
}

class PortableIsolationHelperRuntimeOperationError extends Error {
  constructor(reasonCode, retryable = false) {
    if (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)
      || typeof retryable !== 'boolean') {
      throw new PortableIsolationHelperRuntimeSessionError(
        'RUNTIME_OPERATION_ERROR_INVALID'
      );
    }
    super(reasonCode);
    this.name = 'PortableIsolationHelperRuntimeOperationError';
    this.reasonCode = reasonCode;
    this.retryable = retryable;
    RUNTIME_OPERATION_ERRORS.add(this);
    Object.freeze(this);
  }
}

function runtimeError(code) {
  return new PortableIsolationHelperRuntimeSessionError(code);
}

function fail(code) {
  throw runtimeError(code);
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // Never invoke a userland thenable fallback.
  }
  return true;
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

function safeIdentifier(value, code) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) fail(code);
  return value;
}

function safeDigest(value, code) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(code);
  return value;
}

function normalizePlatform(value) {
  const fields = exactOwnDataFields(
    value,
    PLATFORM_KEYS,
    PLATFORM_KEYS,
    'RUNTIME_IDENTITY_INVALID'
  );
  if (!SUPPORTED_OS.has(fields.get('os'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || fields.get('signatureVerification') !== 'platform_verified') {
    fail('RUNTIME_IDENTITY_INVALID');
  }
  return Object.freeze({
    os: fields.get('os'),
    architecture: fields.get('architecture'),
    signatureVerification: 'platform_verified',
  });
}

function normalizeIdentity(value) {
  const fields = exactOwnDataFields(
    value,
    IDENTITY_KEYS,
    IDENTITY_KEYS,
    'RUNTIME_IDENTITY_INVALID'
  );
  const identity = Object.freeze({
    helperId: safeIdentifier(fields.get('helperId'), 'RUNTIME_IDENTITY_INVALID'),
    helperBuildId: safeIdentifier(
      fields.get('helperBuildId'),
      'RUNTIME_IDENTITY_INVALID'
    ),
    bundleIdentityDigest: safeDigest(
      fields.get('bundleIdentityDigest'),
      'RUNTIME_IDENTITY_INVALID'
    ),
    executionWorkspaceBackendId: safeIdentifier(
      fields.get('executionWorkspaceBackendId'),
      'RUNTIME_IDENTITY_INVALID'
    ),
    projectRootAuthorityBackendId: safeIdentifier(
      fields.get('projectRootAuthorityBackendId'),
      'RUNTIME_IDENTITY_INVALID'
    ),
    processSupervisorBackendId: safeIdentifier(
      fields.get('processSupervisorBackendId'),
      'RUNTIME_IDENTITY_INVALID'
    ),
    platform: normalizePlatform(fields.get('platform')),
  });
  if (new Set([
    identity.executionWorkspaceBackendId,
    identity.projectRootAuthorityBackendId,
    identity.processSupervisorBackendId,
  ]).size !== 3) fail('RUNTIME_IDENTITY_INVALID');
  return identity;
}

function normalizeOptions(value) {
  const fields = exactOwnDataFields(
    value,
    OPTION_KEYS,
    OPTION_KEYS,
    'RUNTIME_OPTIONS_INVALID'
  );
  const dispatch = fields.get('dispatch');
  const dispose = fields.get('dispose');
  if (typeof dispatch !== 'function' || util.types.isProxy(dispatch)
    || typeof dispose !== 'function' || util.types.isProxy(dispose)) {
    fail('RUNTIME_OPTIONS_INVALID');
  }
  let identity;
  try {
    identity = normalizeIdentity(fields.get('identity'));
  } catch (error) {
    absorbNativePromise(error);
    if (error instanceof PortableIsolationHelperRuntimeSessionError) throw error;
    fail('RUNTIME_IDENTITY_INVALID');
  }
  return Object.freeze({ identity, dispatch, dispose });
}

function expectedBackendId(identity, operation) {
  if (WORKSPACE_OPERATIONS.has(operation)) {
    return identity.executionWorkspaceBackendId;
  }
  if (ROOT_OPERATIONS.has(operation)) {
    return identity.projectRootAuthorityBackendId;
  }
  if (PROCESS_OPERATIONS.has(operation)) {
    return identity.processSupervisorBackendId;
  }
  return null;
}

function settledCall(callback, input) {
  let raw;
  try {
    raw = Reflect.apply(callback, undefined, [input]);
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

function createPortableIsolationHelperRuntimeSession(options = {}) {
  const normalized = normalizeOptions(options);
  const helperNonce = crypto.randomBytes(32).toString('hex');
  const sessionId = `portable-session:${crypto.randomBytes(16).toString('hex')}`;
  let state = 'idle';
  let previousResponseDigest = null;
  let nextSequence = 0;
  let exchanges = 0;
  const usedRequestIds = new Set();

  function quarantineState() {
    if (state !== 'closed') state = 'quarantined';
  }

  function rejectWith(code, quarantine = false) {
    if (quarantine) quarantineState();
    return Promise.reject(runtimeError(code));
  }

  function complete(request, payload, nextState) {
    if (state !== 'busy') fail('RUNTIME_SESSION_QUARANTINED');
    let response;
    try {
      response = createPortableIsolationHelperResponse(request, payload);
    } catch (error) {
      absorbNativePromise(error);
      quarantineState();
      fail('RUNTIME_RESPONSE_REJECTED');
    }
    previousResponseDigest = response.responseDigest;
    nextSequence += 1;
    exchanges += 1;
    state = nextState;
    return response;
  }

  function failurePayload(error) {
    if (RUNTIME_OPERATION_ERRORS.has(error)) {
      return Object.freeze({
        payload: createPortableIsolationHelperFailureReceipt({
          reasonCode: error.reasonCode,
          retryable: error.retryable,
        }),
        nextState: 'active',
      });
    }
    absorbNativePromise(error);
    return Object.freeze({
      payload: createPortableIsolationHelperFailureReceipt({
        reasonCode: 'HELPER_OPERATION_FAILED',
        retryable: false,
      }),
      nextState: 'quarantined',
    });
  }

  function acceptHandshake(value) {
    let request;
    let response;
    try {
      request = assertPortableIsolationHelperHandshakeRequest(value);
      if (usedRequestIds.has(request.requestId)) fail('RUNTIME_REQUEST_REPLAY');
      response = createPortableIsolationHelperHandshakeResponse(request, {
        helperId: normalized.identity.helperId,
        helperBuildId: normalized.identity.helperBuildId,
        helperNonce,
        sessionId,
        bundleIdentityDigest: normalized.identity.bundleIdentityDigest,
        executionWorkspaceBackendId:
          normalized.identity.executionWorkspaceBackendId,
        projectRootAuthorityBackendId:
          normalized.identity.projectRootAuthorityBackendId,
        processSupervisorBackendId: normalized.identity.processSupervisorBackendId,
        platform: normalized.identity.platform,
      });
    } catch (error) {
      absorbNativePromise(error);
      quarantineState();
      throw runtimeError('RUNTIME_HANDSHAKE_REJECTED');
    }
    usedRequestIds.add(request.requestId);
    previousResponseDigest = response.responseDigest;
    nextSequence = 1;
    state = 'active';
    return Promise.resolve(response);
  }

  function validateSessionRequest(value) {
    let request;
    try {
      request = assertPortableIsolationHelperRequest(value);
    } catch (error) {
      absorbNativePromise(error);
      fail('RUNTIME_REQUEST_REJECTED');
    }
    if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE
      || request.sessionId !== sessionId
      || request.sequence !== nextSequence
      || request.previousResponseDigest !== previousResponseDigest) {
      fail('RUNTIME_REQUEST_REJECTED');
    }
    if (usedRequestIds.has(request.requestId)) fail('RUNTIME_REQUEST_REPLAY');
    return request;
  }

  function acceptDispose(request) {
    let fields;
    try {
      fields = exactOwnDataFields(
        request.payload,
        DISPOSE_KEYS,
        DISPOSE_KEYS,
        'RUNTIME_SHUTDOWN_REJECTED'
      );
    } catch (error) {
      absorbNativePromise(error);
      return rejectWith('RUNTIME_SHUTDOWN_REJECTED', true);
    }
    if (fields.get('reasonCode') !== 'APPLICATION_SHUTDOWN') {
      return rejectWith('RUNTIME_SHUTDOWN_REJECTED', true);
    }
    const disposeRequest = Object.freeze({
      reasonCode: fields.get('reasonCode'),
    });
    usedRequestIds.add(request.requestId);
    state = 'busy';
    return settledCall(normalized.dispose, disposeRequest).then((outcome) => {
      if (state !== 'busy') throw runtimeError('RUNTIME_SESSION_QUARANTINED');
      if (!outcome.ok) {
        quarantineState();
        throw runtimeError('RUNTIME_SHUTDOWN_FAILED');
      }
      let receipt;
      try {
        receipt = assertPortableIsolationHelperShutdownReceipt(outcome.value);
      } catch (error) {
        absorbNativePromise(error);
        quarantineState();
        throw runtimeError('RUNTIME_SHUTDOWN_FAILED');
      }
      return complete(request, receipt, 'closed');
    });
  }

  function acceptOperation(request) {
    let backendRequest;
    try {
      backendRequest = assertPortableIsolationHelperBackendRequest(request.payload);
    } catch (error) {
      absorbNativePromise(error);
      return rejectWith('RUNTIME_BACKEND_REQUEST_REJECTED', true);
    }
    const backendId = expectedBackendId(normalized.identity, request.operation);
    if (!backendId || backendRequest.backendId !== backendId) {
      return rejectWith('RUNTIME_BACKEND_MISMATCH', true);
    }
    const dispatchRequest = immutableSnapshot({
      version: PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION,
      operation: request.operation,
      backendId,
      input: backendRequest.input,
    });
    usedRequestIds.add(request.requestId);
    state = 'busy';
    return settledCall(normalized.dispatch, dispatchRequest).then((outcome) => {
      if (state !== 'busy') throw runtimeError('RUNTIME_SESSION_QUARANTINED');
      if (!outcome.ok) {
        const failure = failurePayload(outcome.value);
        return complete(request, failure.payload, failure.nextState);
      }
      let payload;
      try {
        payload = createPortableIsolationHelperBackendResponse({
          backendId,
          result: outcome.value,
        });
      } catch (error) {
        const failure = failurePayload(error);
        return complete(request, failure.payload, failure.nextState);
      }
      return complete(request, payload, 'active');
    });
  }

  function accept(value) {
    if (state === 'idle') return acceptHandshake(value);
    if (state === 'closed') return rejectWith('RUNTIME_SESSION_CLOSED');
    if (state === 'quarantined') {
      return rejectWith('RUNTIME_SESSION_QUARANTINED');
    }
    if (state === 'busy') {
      return rejectWith('RUNTIME_SESSION_REENTRANT', true);
    }
    let request;
    try {
      request = validateSessionRequest(value);
    } catch (error) {
      absorbNativePromise(error);
      const code = error instanceof PortableIsolationHelperRuntimeSessionError
        ? error.code
        : 'RUNTIME_REQUEST_REJECTED';
      return rejectWith(code, true);
    }
    if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
      return acceptDispose(request);
    }
    return acceptOperation(request);
  }

  function quarantine(input = {}) {
    const fields = exactOwnDataFields(
      input,
      QUARANTINE_KEYS,
      QUARANTINE_KEYS,
      'RUNTIME_QUARANTINE_INVALID'
    );
    const reasonCode = fields.get('reasonCode');
    if (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)) {
      fail('RUNTIME_QUARANTINE_INVALID');
    }
    if (state === 'closed') {
      return Object.freeze({ ok: false, quarantined: false });
    }
    quarantineState();
    return Object.freeze({ ok: true, quarantined: true });
  }

  function diagnostics() {
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION,
      state,
      nextSequence,
      exchanges,
      pending: state === 'busy',
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION,
    accept,
    quarantine,
    diagnostics,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION,
  PortableIsolationHelperRuntimeOperationError,
  PortableIsolationHelperRuntimeSessionError,
  createPortableIsolationHelperRuntimeSession,
};
