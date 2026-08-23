'use strict';

const util = require('util');

const {
  absorbNativePromise,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  immutableSnapshot,
} = require('../capabilities/capability_delegation_contracts');
const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  assertPortableIsolationHelperHandshakeResponse,
  assertPortableIsolationHelperRequest,
  assertPortableIsolationHelperResponse,
} = require('../capabilities/portable_isolation_helper_protocol');
const {
  assertPortableIsolationHelperLaunchReceipt,
  assertPortableIsolationHelperLaunchRequest,
} = require('../capabilities/portable_isolation_helper_launcher_contract');
const {
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
  assertPortableIsolationHelperPrivateFrame,
  createPortableIsolationHelperPrivateFrame,
} = require('../capabilities/portable_isolation_helper_private_transport_contract');
const {
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
} = require('./portable_isolation_helper_client');

const OPTION_KEYS = Object.freeze(['channel', 'launchRequest', 'launchReceipt']);
const CHANNEL_KEYS = Object.freeze(['version', 'exchange', 'abort', 'dispose']);
const CLIENT_ABORT_KEYS = Object.freeze(['version', 'reasonCode']);
const CHANNEL_ABORT_RECEIPT_KEYS = Object.freeze([
  'version',
  'aborted',
  'processTreeTerminated',
  'orphaned',
]);
const CHANNEL_DISPOSE_RECEIPT_KEYS = Object.freeze([
  'version',
  'closed',
  'helperExited',
  'orphaned',
]);
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const CLIENT_ABORT_RECEIPT = Object.freeze({
  version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
  aborted: true,
});
const CLIENT_DISPOSE_RECEIPT = Object.freeze({
  version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
  closed: true,
});

class PortableIsolationHelperPrivateTransportError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperPrivateTransportError';
    this.code = code;
  }
}

function transportError(code) {
  return new PortableIsolationHelperPrivateTransportError(code);
}

function exactDataFields(value, allowedKeys, requiredKeys, code) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) throw transportError(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw transportError(code);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    throw transportError(code);
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      throw transportError(code);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw transportError(code);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeChannel(value) {
  const fields = exactDataFields(
    value,
    CHANNEL_KEYS,
    CHANNEL_KEYS,
    'PRIVATE_TRANSPORT_CHANNEL_INVALID'
  );
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION) {
    throw transportError('PRIVATE_TRANSPORT_CHANNEL_INVALID');
  }
  for (const name of ['exchange', 'abort', 'dispose']) {
    const method = fields.get(name);
    if (typeof method !== 'function' || util.types.isProxy(method)) {
      throw transportError('PRIVATE_TRANSPORT_CHANNEL_INVALID');
    }
  }
  return Object.freeze({
    receiver: value,
    exchange: fields.get('exchange'),
    abort: fields.get('abort'),
    dispose: fields.get('dispose'),
  });
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

function normalizeClientAbortRequest(value) {
  const fields = exactDataFields(
    value,
    CLIENT_ABORT_KEYS,
    CLIENT_ABORT_KEYS,
    'PRIVATE_TRANSPORT_ABORT_INVALID'
  );
  if (fields.get('version') !== PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION
    || typeof fields.get('reasonCode') !== 'string'
    || !SAFE_REASON_CODE.test(fields.get('reasonCode'))) {
    throw transportError('PRIVATE_TRANSPORT_ABORT_INVALID');
  }
  return fields.get('reasonCode');
}

function assertChannelAbortReceipt(value) {
  const fields = exactDataFields(
    value,
    CHANNEL_ABORT_RECEIPT_KEYS,
    CHANNEL_ABORT_RECEIPT_KEYS,
    'PRIVATE_TRANSPORT_ABORT_FAILED'
  );
  if (!Object.isFrozen(value)
    || fields.get('version')
      !== PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION
    || fields.get('aborted') !== true
    || fields.get('processTreeTerminated') !== true
    || fields.get('orphaned') !== 0) {
    throw transportError('PRIVATE_TRANSPORT_ABORT_FAILED');
  }
  return true;
}

function assertChannelDisposeReceipt(value) {
  const fields = exactDataFields(
    value,
    CHANNEL_DISPOSE_RECEIPT_KEYS,
    CHANNEL_DISPOSE_RECEIPT_KEYS,
    'PRIVATE_TRANSPORT_CLOSE_FAILED'
  );
  if (!Object.isFrozen(value)
    || fields.get('version')
      !== PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION
    || fields.get('closed') !== true
    || fields.get('helperExited') !== true
    || fields.get('orphaned') !== 0) {
    throw transportError('PRIVATE_TRANSPORT_CLOSE_FAILED');
  }
  return true;
}

function createPortableIsolationHelperPrivateTransport(options = {}) {
  const optionFields = exactDataFields(
    options,
    OPTION_KEYS,
    OPTION_KEYS,
    'PRIVATE_TRANSPORT_OPTIONS_INVALID'
  );
  let launchRequest;
  let launchReceipt;
  try {
    launchRequest = assertPortableIsolationHelperLaunchRequest(
      optionFields.get('launchRequest')
    );
    launchReceipt = assertPortableIsolationHelperLaunchReceipt(
      optionFields.get('launchReceipt'),
      launchRequest
    );
  } catch (error) {
    absorbNativePromise(error);
    throw transportError('PRIVATE_TRANSPORT_LAUNCH_INVALID');
  }
  const channel = normalizeChannel(optionFields.get('channel'));
  const channelBindingDigest = launchReceipt.channelBindingDigest;
  const expectedBundleIdentityDigest = launchReceipt.bundleIdentityDigest;

  let state = 'fresh';
  let frameSequence = 1;
  let exchangePending = false;
  let channelCallDepth = 0;
  let pendingAbortReason = null;
  let abortPromise = null;
  let pendingExchangeInterrupt = null;
  let abortConfirmed = false;
  let disposePromise = null;
  let disposeResult = null;

  function invokeChannel(methodName, args) {
    let raw;
    channelCallDepth += 1;
    try {
      raw = Reflect.apply(channel[methodName], channel.receiver, args);
    } catch (error) {
      absorbNativePromise(error);
      return Promise.resolve(Object.freeze({ ok: false, value: null }));
    } finally {
      channelCallDepth -= 1;
      if (channelCallDepth === 0 && pendingAbortReason) flushPendingAbort();
    }
    return settledOutcome(raw);
  }

  function channelAbortRequest(reasonCode) {
    return immutableSnapshot({
      version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_REQUEST_VERSION,
      reasonCode,
      channelBindingDigest,
    });
  }

  function beginAbort(reasonCode) {
    if (abortPromise) return abortPromise;
    if (channelCallDepth > 0) {
      pendingAbortReason = pendingAbortReason || reasonCode;
      return Promise.resolve(Object.freeze({ ok: false, pending: true }));
    }
    abortPromise = invokeChannel('abort', [channelAbortRequest(reasonCode)])
      .then((outcome) => {
        if (!outcome.ok) return Object.freeze({ ok: false, pending: false });
        try {
          assertChannelAbortReceipt(outcome.value);
          abortConfirmed = true;
          return Object.freeze({ ok: true, pending: false });
        } catch (error) {
          absorbNativePromise(error);
          return Object.freeze({ ok: false, pending: false });
        }
      });
    return abortPromise;
  }

  function flushPendingAbort() {
    if (!pendingAbortReason || channelCallDepth > 0 || abortPromise) return;
    const reasonCode = pendingAbortReason;
    pendingAbortReason = null;
    beginAbort(reasonCode);
  }

  function interruptExchange(code) {
    if (!pendingExchangeInterrupt) return;
    const pending = pendingExchangeInterrupt;
    pendingExchangeInterrupt = null;
    pending.resolve(Object.freeze({
      kind: 'interrupted',
      code,
    }));
  }

  function quarantine(reasonCode) {
    if (state === 'closed') return;
    state = 'quarantined';
    interruptExchange('PRIVATE_TRANSPORT_QUARANTINED');
    if (channelCallDepth > 0) {
      pendingAbortReason = pendingAbortReason || reasonCode;
    } else {
      beginAbort(reasonCode);
    }
  }

  function rejectQuarantined(code, reasonCode) {
    quarantine(reasonCode);
    return Promise.reject(transportError(code));
  }

  function rejectReentrantCall() {
    if (channelCallDepth < 1) return null;
    return rejectQuarantined(
      'PRIVATE_TRANSPORT_REENTRANT',
      'TRANSPORT_REENTRANCY'
    );
  }

  function normalizeProtocolRequest(value) {
    try {
      return assertPortableIsolationHelperRequest(value);
    } catch (error) {
      absorbNativePromise(error);
      return null;
    }
  }

  function exchange(value) {
    const reentrant = rejectReentrantCall();
    if (reentrant) return reentrant;
    if (disposePromise || state === 'closed' || state === 'shutdown_confirmed') {
      return Promise.reject(transportError('PRIVATE_TRANSPORT_CLOSED'));
    }
    if (state === 'quarantined') {
      return Promise.reject(transportError('PRIVATE_TRANSPORT_QUARANTINED'));
    }
    if (exchangePending || state === 'busy') {
      return Promise.reject(transportError('PRIVATE_TRANSPORT_BUSY'));
    }
    const request = normalizeProtocolRequest(value);
    if (!request) {
      return rejectQuarantined(
        'PRIVATE_TRANSPORT_REQUEST_INVALID',
        'REQUEST_INVALID'
      );
    }
    const isHandshake = request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE;
    if (state === 'fresh' && !isHandshake) {
      return rejectQuarantined(
        'PRIVATE_TRANSPORT_HANDSHAKE_REQUIRED',
        'HANDSHAKE_REQUIRED'
      );
    }
    if (state !== 'fresh' && isHandshake) {
      return rejectQuarantined(
        'PRIVATE_TRANSPORT_HANDSHAKE_REPLAY',
        'HANDSHAKE_REPLAY'
      );
    }
    if (isHandshake
      && request.payload.expectedBundleIdentityDigest !== expectedBundleIdentityDigest) {
      return rejectQuarantined(
        'PRIVATE_TRANSPORT_BUNDLE_MISMATCH',
        'BUNDLE_MISMATCH'
      );
    }

    let requestFrame;
    try {
      requestFrame = createPortableIsolationHelperPrivateFrame({
        direction: 'request',
        sequence: frameSequence,
        channelBindingDigest,
        payload: request,
      });
    } catch (error) {
      absorbNativePromise(error);
      return rejectQuarantined(
        'PRIVATE_TRANSPORT_FRAME_REJECTED',
        'FRAME_REJECTED'
      );
    }
    const currentFrameSequence = frameSequence;
    frameSequence += 1;
    exchangePending = true;
    state = 'busy';
    let resolveInterrupt;
    const interruptedOutcome = new Promise((resolve) => {
      resolveInterrupt = resolve;
    });
    const pendingInterrupt = Object.freeze({ resolve: resolveInterrupt });
    pendingExchangeInterrupt = pendingInterrupt;
    const channelOutcome = invokeChannel('exchange', [requestFrame]).then((outcome) => (
      Object.freeze({ kind: 'channel', outcome })
    ));
    if (state === 'quarantined') {
      pendingExchangeInterrupt = null;
      exchangePending = false;
      return Promise.reject(transportError('PRIVATE_TRANSPORT_QUARANTINED'));
    }

    return Promise.race([interruptedOutcome, channelOutcome]).then((settled) => {
      if (pendingExchangeInterrupt === pendingInterrupt) {
        pendingExchangeInterrupt = null;
      }
      exchangePending = false;
      if (settled.kind === 'interrupted') {
        throw transportError(settled.code);
      }
      const outcome = settled.outcome;
      if (state === 'quarantined') {
        throw transportError('PRIVATE_TRANSPORT_QUARANTINED');
      }
      if (state === 'closed' || disposePromise) {
        throw transportError('PRIVATE_TRANSPORT_CLOSED');
      }
      if (!outcome.ok) {
        return rejectQuarantined(
          'PRIVATE_TRANSPORT_EXCHANGE_FAILED',
          'EXCHANGE_FAILED'
        );
      }
      let response;
      try {
        const payload = assertPortableIsolationHelperPrivateFrame(outcome.value, {
          direction: 'response',
          sequence: currentFrameSequence,
          channelBindingDigest,
          requestPayloadDigest: requestFrame.payloadDigest,
        });
        response = isHandshake
          ? assertPortableIsolationHelperHandshakeResponse(payload, request)
          : assertPortableIsolationHelperResponse(payload, request);
      } catch (error) {
        absorbNativePromise(error);
        return rejectQuarantined(
          'PRIVATE_TRANSPORT_FRAME_REJECTED',
          'FRAME_REJECTED'
        );
      }
      state = request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE
        ? 'shutdown_confirmed'
        : 'active';
      return response;
    });
  }

  function abort(value) {
    let reasonCode;
    try {
      reasonCode = normalizeClientAbortRequest(value);
    } catch (error) {
      absorbNativePromise(error);
      return Promise.reject(error instanceof PortableIsolationHelperPrivateTransportError
        ? error
        : transportError('PRIVATE_TRANSPORT_ABORT_INVALID'));
    }
    const reentrant = rejectReentrantCall();
    if (reentrant) return reentrant;
    if (state === 'closed') {
      return abortConfirmed
        ? Promise.resolve(CLIENT_ABORT_RECEIPT)
        : Promise.reject(transportError('PRIVATE_TRANSPORT_CLOSED'));
    }
    quarantine(reasonCode);
    return beginAbort(reasonCode).then((outcome) => {
      if (!outcome.ok) throw transportError('PRIVATE_TRANSPORT_ABORT_FAILED');
      return CLIENT_ABORT_RECEIPT;
    });
  }

  function dispose() {
    const reentrant = rejectReentrantCall();
    if (reentrant) return reentrant;
    if (disposePromise) return disposePromise;
    if (state === 'closed') return Promise.resolve(disposeResult);
    const shouldAbort = state !== 'shutdown_confirmed';
    state = 'disposing';
    interruptExchange('PRIVATE_TRANSPORT_CLOSED');
    if (shouldAbort) beginAbort('TRANSPORT_DISPOSE');
    const closeOutcome = invokeChannel('dispose', []);
    // A confirmed helper exit with zero orphans is stronger than an abort
    // acknowledgement and must not be held open by a stuck abort channel.
    disposePromise = closeOutcome.then((close) => {
      if (!close.ok) {
        state = 'quarantined';
        throw transportError('PRIVATE_TRANSPORT_CLOSE_FAILED');
      }
      try {
        assertChannelDisposeReceipt(close.value);
      } catch (error) {
        absorbNativePromise(error);
        state = 'quarantined';
        throw transportError('PRIVATE_TRANSPORT_CLOSE_FAILED');
      }
      state = 'closed';
      exchangePending = false;
      disposeResult = CLIENT_DISPOSE_RECEIPT;
      return disposeResult;
    });
    return disposePromise;
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
    exchange,
    abort,
    dispose,
  });
}

module.exports = {
  PortableIsolationHelperPrivateTransportError,
  createPortableIsolationHelperPrivateTransport,
};
