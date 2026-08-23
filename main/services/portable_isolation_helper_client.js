'use strict';

const util = require('util');

const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  immutableSnapshot,
} = require('../capabilities/capability_delegation_contracts');
const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  assertPortableIsolationHelperHandshakeResponse,
  createPortableIsolationHelperHandshakeRequest,
  createPortableIsolationHelperSessionController,
} = require('../capabilities/portable_isolation_helper_protocol');

const PORTABLE_ISOLATION_HELPER_CLIENT_VERSION =
  'portable-isolation-helper-client.v1';
const PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION =
  'portable-isolation-helper-transport.v1';
const PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION =
  'portable-isolation-helper-transport-abort-request.v1';
const PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION =
  'portable-isolation-helper-transport-abort-receipt.v1';
const PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION =
  'portable-isolation-helper-transport-dispose-receipt.v1';
const PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION =
  'portable-isolation-helper-client-dispose-receipt.v1';

const OPTION_KEYS = Object.freeze(['transport', 'handshake']);
const HANDSHAKE_KEYS = Object.freeze([
  'clientId',
  'clientNonce',
  'expectedBundleIdentityDigest',
  'providerVersion',
  'attestationVersion',
]);
const TRANSPORT_KEYS = Object.freeze(['version', 'exchange', 'abort', 'dispose']);
const EXCHANGE_KEYS = Object.freeze(['operation', 'payload']);
const QUARANTINE_KEYS = Object.freeze(['reasonCode']);
const ABORT_RECEIPT_KEYS = Object.freeze(['version', 'aborted']);
const DISPOSE_RECEIPT_KEYS = Object.freeze(['version', 'closed']);
const OPERATIONS = new Set(Object.values(PORTABLE_ISOLATION_HELPER_OPERATIONS));
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

class PortableIsolationHelperClientError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperClientError';
    this.code = code;
  }
}

function clientError(code) {
  return new PortableIsolationHelperClientError(code);
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // Never consult a userland `.then` when intrinsic observation is denied.
  }
  return true;
}

function exactDataFields(value, allowedKeys, requiredKeys, code) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) {
    throw clientError(code);
  }
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw clientError(code);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    throw clientError(code);
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      throw clientError(code);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw clientError(code);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeTransport(value) {
  const fields = exactDataFields(
    value,
    TRANSPORT_KEYS,
    TRANSPORT_KEYS,
    'CLIENT_TRANSPORT_INVALID'
  );
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION) {
    throw clientError('CLIENT_TRANSPORT_INVALID');
  }
  for (const methodName of ['exchange', 'abort', 'dispose']) {
    const method = fields.get(methodName);
    if (typeof method !== 'function' || util.types.isProxy(method)) {
      throw clientError('CLIENT_TRANSPORT_INVALID');
    }
  }
  return Object.freeze({
    receiver: value,
    exchange: fields.get('exchange'),
    abort: fields.get('abort'),
    dispose: fields.get('dispose'),
  });
}

function normalizeHandshake(value) {
  const fields = exactDataFields(
    value,
    HANDSHAKE_KEYS,
    HANDSHAKE_KEYS,
    'CLIENT_HANDSHAKE_INVALID'
  );
  const clientNonce = fields.get('clientNonce');
  try {
    return createPortableIsolationHelperHandshakeRequest({
      requestId: 'portable-handshake-1',
      clientId: fields.get('clientId'),
      clientNonce,
      expectedBundleIdentityDigest: fields.get('expectedBundleIdentityDigest'),
      providerVersion: fields.get('providerVersion'),
      attestationVersion: fields.get('attestationVersion'),
    });
  } catch (error) {
    absorbNativePromise(error);
    throw clientError('CLIENT_HANDSHAKE_INVALID');
  }
}

function normalizeExchangeInput(value) {
  const fields = exactDataFields(
    value,
    EXCHANGE_KEYS,
    EXCHANGE_KEYS,
    'CLIENT_REQUEST_INVALID'
  );
  const operation = fields.get('operation');
  if (typeof operation !== 'string' || !OPERATIONS.has(operation)
    || operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE
    || operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
    throw clientError('CLIENT_OPERATION_INVALID');
  }
  const payload = fields.get('payload');
  const payloadPreflight = preflightDataGraph(payload);
  if (!payloadPreflight.bounded || payloadPreflight.hasNativePromise
    || !payloadPreflight.inspectable || !payload || typeof payload !== 'object'
    || Array.isArray(payload) || util.types.isProxy(payload)) {
    throw clientError('CLIENT_REQUEST_INVALID');
  }
  let prototype;
  try {
    prototype = Object.getPrototypeOf(payload);
  } catch (error) {
    absorbNativePromise(error);
    throw clientError('CLIENT_REQUEST_INVALID');
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw clientError('CLIENT_REQUEST_INVALID');
  }
  try {
    return Object.freeze({
      operation,
      payload: immutableSnapshot(payload),
    });
  } catch (error) {
    absorbNativePromise(error);
    throw clientError('CLIENT_REQUEST_INVALID');
  }
}

function normalizeAbortReceipt(value) {
  const fields = exactDataFields(
    value,
    ABORT_RECEIPT_KEYS,
    ABORT_RECEIPT_KEYS,
    'CLIENT_TRANSPORT_INVALID'
  );
  if (fields.get('version') !== PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION
    || fields.get('aborted') !== true) {
    throw clientError('CLIENT_TRANSPORT_INVALID');
  }
  return true;
}

function normalizeDisposeReceipt(value) {
  const fields = exactDataFields(
    value,
    DISPOSE_RECEIPT_KEYS,
    DISPOSE_RECEIPT_KEYS,
    'CLIENT_TRANSPORT_CLOSE_FAILED'
  );
  if (fields.get('version') !== PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION
    || fields.get('closed') !== true) {
    throw clientError('CLIENT_TRANSPORT_CLOSE_FAILED');
  }
  return true;
}

function settledOutcome(value) {
  if (!util.types.isPromise(value)) {
    return Promise.resolve(Object.freeze({ ok: true, value }));
  }
  return new Promise((resolve) => {
    const fulfilled = (resolvedValue) => resolve(Object.freeze({
      ok: true,
      value: resolvedValue,
    }));
    const rejected = (reason) => {
      absorbNativePromise(reason);
      resolve(Object.freeze({ ok: false, value: null }));
    };
    try {
      Reflect.apply(Promise.prototype.then, value, [fulfilled, rejected]);
    } catch (error) {
      absorbNativePromise(error);
      resolve(Object.freeze({ ok: false, value: null }));
    }
  });
}

function createPortableIsolationHelperClient(options = {}) {
  const optionFields = exactDataFields(
    options,
    OPTION_KEYS,
    OPTION_KEYS,
    'CLIENT_OPTIONS_INVALID'
  );
  const transport = normalizeTransport(optionFields.get('transport'));
  const handshakeRequest = normalizeHandshake(optionFields.get('handshake'));

  let state = 'idle';
  let controller = null;
  let publicHandshake = null;
  let connectPromise = null;
  let operationPromise = null;
  let operationPending = false;
  let disposePromise = null;
  let disposeRequested = false;
  let disposeResult = null;
  let transportClosed = false;
  let transportClosePromise = null;
  let terminalErrorCode = null;
  let transportCallDepth = 0;
  let abortIssued = false;
  let pendingAbortRequest = null;

  function invokeTransport(methodName, args) {
    let raw;
    transportCallDepth += 1;
    try {
      raw = Reflect.apply(transport[methodName], transport.receiver, args);
    } catch (error) {
      absorbNativePromise(error);
      return Promise.resolve(Object.freeze({ ok: false, value: null }));
    } finally {
      transportCallDepth -= 1;
      if (transportCallDepth === 0 && pendingAbortRequest) flushPendingAbort();
    }
    return settledOutcome(raw);
  }

  function flushPendingAbort() {
    if (!pendingAbortRequest || transportCallDepth > 0) return;
    const request = pendingAbortRequest;
    pendingAbortRequest = null;
    invokeTransport('abort', [request]).then((outcome) => {
      if (!outcome.ok) return;
      try {
        normalizeAbortReceipt(outcome.value);
      } catch (error) {
        absorbNativePromise(error);
      }
    });
  }

  function issueAbort(reasonCode) {
    if (abortIssued) return;
    abortIssued = true;
    pendingAbortRequest = immutableSnapshot({
      version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
      reasonCode,
    });
    flushPendingAbort();
  }

  function quarantine(reasonCode, errorCode) {
    if (state === 'closed') return;
    terminalErrorCode = terminalErrorCode || errorCode;
    if (controller) {
      try {
        const controllerState = controller.diagnostics().state;
        if (controllerState !== 'quarantined' && controllerState !== 'closed') {
          controller.quarantine({ reasonCode });
        }
      } catch (error) {
        absorbNativePromise(error);
      }
    }
    state = 'quarantined';
    issueAbort(reasonCode);
  }

  function rejectReentrantCall() {
    if (transportCallDepth < 1) return null;
    quarantine('CLIENT_REENTRANCY', 'CLIENT_REENTRANT');
    return Promise.reject(clientError('CLIENT_REENTRANT'));
  }

  function connect() {
    const reentrant = rejectReentrantCall();
    if (reentrant) return reentrant;
    if (connectPromise) return connectPromise;
    if (disposeRequested || state === 'closed') {
      return Promise.reject(clientError('CLIENT_CLOSED'));
    }
    if (state === 'quarantined') {
      return Promise.reject(clientError(terminalErrorCode || 'CLIENT_QUARANTINED'));
    }

    state = 'connecting';
    const transportOutcome = invokeTransport('exchange', [handshakeRequest]);
    connectPromise = transportOutcome.then((outcome) => {
      if (disposeRequested || state === 'closed' || state === 'closed_unconfirmed') {
        throw clientError('CLIENT_CLOSED');
      }
      if (state !== 'connecting') {
        throw clientError(terminalErrorCode || 'CLIENT_QUARANTINED');
      }
      if (!outcome.ok) {
        quarantine('TRANSPORT_EXCHANGE_FAILED', 'CLIENT_TRANSPORT_FAILED');
        throw clientError('CLIENT_TRANSPORT_FAILED');
      }
      let handshakeResponse;
      try {
        handshakeResponse = assertPortableIsolationHelperHandshakeResponse(
          outcome.value,
          handshakeRequest
        );
        controller = createPortableIsolationHelperSessionController({
          handshakeRequest,
          handshakeResponse,
        });
      } catch (error) {
        absorbNativePromise(error);
        quarantine('HANDSHAKE_RESPONSE_REJECTED', 'CLIENT_HANDSHAKE_REJECTED');
        throw clientError('CLIENT_HANDSHAKE_REJECTED');
      }
      publicHandshake = handshakeResponse.payload;
      state = 'active';
      return publicHandshake;
    });
    return connectPromise;
  }

  function performExchange(input) {
    if (state === 'quarantined') {
      throw clientError(terminalErrorCode || 'CLIENT_QUARANTINED');
    }
    if (state !== 'active' || !controller) throw clientError('CLIENT_CLOSED');
    const sequence = controller.diagnostics().nextSequence;
    let request;
    try {
      request = controller.request({
        requestId: `portable-request:${handshakeRequest.payload.clientNonce}:${sequence}`,
        operation: input.operation,
        payload: input.payload,
      });
    } catch (error) {
      absorbNativePromise(error);
      if (controller.diagnostics().state === 'quarantined') {
        quarantine('REQUEST_REJECTED', 'CLIENT_REQUEST_REJECTED');
      }
      throw clientError('CLIENT_REQUEST_REJECTED');
    }
    state = 'busy';
    return invokeTransport('exchange', [request]).then((outcome) => {
      if (disposeRequested || state === 'closed' || state === 'closed_unconfirmed') {
        throw clientError('CLIENT_CLOSED');
      }
      if (state !== 'busy') {
        throw clientError(terminalErrorCode || 'CLIENT_QUARANTINED');
      }
      if (!outcome.ok) {
        quarantine('TRANSPORT_EXCHANGE_FAILED', 'CLIENT_TRANSPORT_FAILED');
        throw clientError('CLIENT_TRANSPORT_FAILED');
      }
      let response;
      try {
        response = controller.accept(outcome.value);
      } catch (error) {
        absorbNativePromise(error);
        quarantine('HELPER_RESPONSE_REJECTED', 'CLIENT_RESPONSE_REJECTED');
        throw clientError('CLIENT_RESPONSE_REJECTED');
      }
      state = 'active';
      return response.payload;
    });
  }

  function exchange(value) {
    let input;
    try {
      input = normalizeExchangeInput(value);
    } catch (error) {
      absorbNativePromise(error);
      return Promise.reject(error instanceof PortableIsolationHelperClientError
        ? error
        : clientError('CLIENT_REQUEST_INVALID'));
    }
    const reentrant = rejectReentrantCall();
    if (reentrant) return reentrant;
    if (disposeRequested || state === 'closed') {
      return Promise.reject(clientError('CLIENT_CLOSED'));
    }
    if (state === 'quarantined') {
      return Promise.reject(clientError(terminalErrorCode || 'CLIENT_QUARANTINED'));
    }
    if (operationPending || state === 'busy') {
      return Promise.reject(clientError('CLIENT_BUSY'));
    }

    operationPending = true;
    operationPromise = connect().then(() => performExchange(input));
    operationPromise = operationPromise.then(
      (result) => {
        operationPending = false;
        return result;
      },
      (error) => {
        operationPending = false;
        throw error;
      }
    );
    return operationPromise;
  }

  function disposalReceipt(helperShutdownConfirmed) {
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
      disposed: true,
      helperShutdownConfirmed,
      transportClosed: true,
    });
  }

  function closeTransport(helperShutdownConfirmed) {
    if (transportClosePromise) return transportClosePromise;
    transportClosePromise = invokeTransport('dispose', [])
      .then((outcome) => {
        if (!outcome.ok) {
          quarantine('TRANSPORT_CLOSE_FAILED', 'CLIENT_TRANSPORT_CLOSE_FAILED');
          throw clientError('CLIENT_TRANSPORT_CLOSE_FAILED');
        }
        try {
          normalizeDisposeReceipt(outcome.value);
        } catch (error) {
          absorbNativePromise(error);
          quarantine('TRANSPORT_CLOSE_FAILED', 'CLIENT_TRANSPORT_CLOSE_FAILED');
          throw clientError('CLIENT_TRANSPORT_CLOSE_FAILED');
        }
        transportClosed = true;
        const confirmed = helperShutdownConfirmed && state !== 'quarantined';
        state = confirmed || !controller ? 'closed' : 'closed_unconfirmed';
        disposeResult = disposalReceipt(confirmed);
        return disposeResult;
      });
    return transportClosePromise;
  }

  function performGracefulDisposal() {
    if (state === 'closed' || state === 'closed_unconfirmed') return Promise.resolve(disposeResult);
    if (state === 'quarantined' || !controller) return closeTransport(false);
    if (state !== 'active') {
      quarantine('CLIENT_LIFECYCLE_INVALID', 'CLIENT_QUARANTINED');
      return closeTransport(false);
    }

    state = 'disposing';
    const sequence = controller.diagnostics().nextSequence;
    let request;
    try {
      request = controller.request({
        requestId: `portable-request:${handshakeRequest.payload.clientNonce}:${sequence}`,
        operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE,
        payload: { reasonCode: 'APPLICATION_SHUTDOWN' },
      });
    } catch (error) {
      absorbNativePromise(error);
      quarantine('SHUTDOWN_REQUEST_REJECTED', 'CLIENT_RESPONSE_REJECTED');
      return closeTransport(false);
    }
    return invokeTransport('exchange', [request]).then((outcome) => {
      if (state === 'quarantined' || !outcome.ok) {
        if (state !== 'quarantined') {
          quarantine('SHUTDOWN_TRANSPORT_FAILED', 'CLIENT_TRANSPORT_FAILED');
        }
        return false;
      }
      try {
        controller.accept(outcome.value);
        return true;
      } catch (error) {
        absorbNativePromise(error);
        quarantine('SHUTDOWN_RESPONSE_REJECTED', 'CLIENT_RESPONSE_REJECTED');
        return false;
      }
    }).then((helperShutdownConfirmed) => closeTransport(helperShutdownConfirmed));
  }

  function dispose() {
    const reentrant = rejectReentrantCall();
    if (reentrant) return reentrant;
    if (disposePromise) return disposePromise;
    disposeRequested = true;
    if (operationPending || state === 'connecting' || state === 'busy') {
      operationPending = false;
      quarantine('DISPOSE_INTERRUPTED', 'CLIENT_CLOSED');
      disposePromise = closeTransport(false);
    } else {
      disposePromise = performGracefulDisposal();
    }
    return disposePromise;
  }

  function quarantineClient(value) {
    let fields;
    try {
      fields = exactDataFields(
        value,
        QUARANTINE_KEYS,
        QUARANTINE_KEYS,
        'CLIENT_QUARANTINE_INVALID'
      );
    } catch (error) {
      absorbNativePromise(error);
      throw error instanceof PortableIsolationHelperClientError
        ? error
        : clientError('CLIENT_QUARANTINE_INVALID');
    }
    const reasonCode = fields.get('reasonCode');
    if (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)) {
      throw clientError('CLIENT_QUARANTINE_INVALID');
    }
    if (transportCallDepth > 0) {
      quarantine('CLIENT_REENTRANCY', 'CLIENT_REENTRANT');
      throw clientError('CLIENT_REENTRANT');
    }
    if (state === 'closed' || state === 'closed_unconfirmed' || transportClosed) {
      return Object.freeze({ ok: false, quarantined: false });
    }
    quarantine(reasonCode, 'CLIENT_QUARANTINED');
    return Object.freeze({ ok: true, quarantined: true });
  }

  function diagnostics() {
    const session = controller ? controller.diagnostics() : null;
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
      state,
      nextSequence: session ? session.nextSequence : 1,
      exchanges: session ? session.exchanges : 0,
      pending: operationPending || state === 'connecting'
        || Boolean(session && session.pending),
      transportClosed,
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
    connect,
    exchange,
    quarantine: quarantineClient,
    diagnostics,
    dispose,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
  PortableIsolationHelperClientError,
  createPortableIsolationHelperClient,
};
