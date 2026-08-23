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
  PORTABLE_ISOLATION_HELPER_BUILD_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
} = require(
  '../capabilities/portable_isolation_helper_distribution_attestation_contract'
);
const {
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
  assertPortableIsolationHelperPrivateFrame,
} = require('../capabilities/portable_isolation_helper_private_transport_contract');

const PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION =
  'portable-isolation-helper-utility-wire.v1';
const PORTABLE_ISOLATION_HELPER_RUNTIME_VERSION =
  'portable-isolation-helper-runtime.v1';

const OPTION_KEYS = Object.freeze([
  'utilityProcess',
  'channelBindingDigest',
  'runtimeBinding',
  'timeoutMs',
]);
const PROCESS_METHODS = Object.freeze(['on', 'removeListener', 'postMessage', 'kill']);
const FORBIDDEN_PROCESS_KEYS = Object.freeze([
  'binaryPath',
  'executablePath',
  'helperPath',
  'providerPath',
]);
const WIRE_KEYS = Object.freeze([
  'version',
  'kind',
  'channelBindingDigest',
  'helperRuntimeVersion',
  'frame',
  'processTreeTerminated',
  'orphaned',
  'reasonCode',
]);
const WIRE_KEYS_BY_KIND = Object.freeze({
  bound: Object.freeze([
    'version', 'kind', 'channelBindingDigest', 'helperRuntimeVersion',
  ]),
  response: Object.freeze([
    'version', 'kind', 'channelBindingDigest', 'frame',
  ]),
  abort_receipt: Object.freeze([
    'version', 'kind', 'channelBindingDigest',
    'processTreeTerminated', 'orphaned',
  ]),
  dispose_ready: Object.freeze([
    'version', 'kind', 'channelBindingDigest', 'orphaned',
  ]),
  fault: Object.freeze([
    'version', 'kind', 'channelBindingDigest', 'reasonCode',
  ]),
});
const CLIENT_ABORT_KEYS = Object.freeze([
  'version', 'reasonCode', 'channelBindingDigest',
]);
const RUNTIME_BINDING_KEYS = Object.freeze([
  'helperId', 'helperBuildId', 'bundleIdentityDigest', 'platform',
]);
const RUNTIME_PLATFORM_KEYS = Object.freeze([
  'os', 'architecture', 'signatureVerification',
]);
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const MIN_TIMEOUT_MS = 10;
const MAX_TIMEOUT_MS = 30_000;
const CONFIRMED_ABORT_RECEIPT = Object.freeze({
  version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
  aborted: true,
  processTreeTerminated: true,
  orphaned: 0,
});

class PortableIsolationHelperUtilityChannelError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperUtilityChannelError';
    this.code = code;
  }
}

function channelError(code) {
  return new PortableIsolationHelperUtilityChannelError(code);
}

function exactDataFields(value, allowedKeys, requiredKeys, code) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) throw channelError(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw channelError(code);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    throw channelError(code);
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      throw channelError(code);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw channelError(code);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function optionFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) throw channelError('UTILITY_CHANNEL_OPTIONS_INVALID');
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw channelError('UTILITY_CHANNEL_OPTIONS_INVALID');
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))) {
    throw channelError('UTILITY_CHANNEL_OPTIONS_INVALID');
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      throw channelError('UTILITY_CHANNEL_OPTIONS_INVALID');
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw channelError('UTILITY_CHANNEL_OPTIONS_INVALID');
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function captureMethod(receiver, name) {
  let current = receiver;
  for (let depth = 0; current && depth < 12; depth += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, name);
    } catch (error) {
      absorbNativePromise(error);
      return null;
    }
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
        || util.types.isProxy(descriptor.value)) return null;
      return Object.freeze({ receiver, method: descriptor.value });
    }
    try {
      current = Object.getPrototypeOf(current);
    } catch (error) {
      absorbNativePromise(error);
      return null;
    }
  }
  return null;
}

function normalizeUtilityProcess(value) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    throw channelError('UTILITY_CHANNEL_PROCESS_INVALID');
  }
  for (const key of FORBIDDEN_PROCESS_KEYS) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      throw channelError('UTILITY_CHANNEL_PROCESS_INVALID');
    }
    if (descriptor) throw channelError('UTILITY_CHANNEL_PROCESS_INVALID');
  }
  const captured = {};
  for (const methodName of PROCESS_METHODS) {
    const method = captureMethod(value, methodName);
    if (!method) throw channelError('UTILITY_CHANNEL_PROCESS_INVALID');
    captured[methodName] = method;
  }
  return Object.freeze(captured);
}

function safeDigest(value, code) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw channelError(code);
  return value;
}

function safeReasonCode(value, code) {
  if (typeof value !== 'string' || !SAFE_REASON_CODE.test(value)) {
    throw channelError(code);
  }
  return value;
}

function normalizeTimeout(value) {
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS
    || value > MAX_TIMEOUT_MS || Object.is(value, -0)) {
    throw channelError('UTILITY_CHANNEL_OPTIONS_INVALID');
  }
  return value;
}

function normalizeRuntimeBinding(value) {
  const fields = exactDataFields(
    value,
    RUNTIME_BINDING_KEYS,
    RUNTIME_BINDING_KEYS,
    'UTILITY_CHANNEL_OPTIONS_INVALID'
  );
  const platform = exactDataFields(
    fields.get('platform'),
    RUNTIME_PLATFORM_KEYS,
    RUNTIME_PLATFORM_KEYS,
    'UTILITY_CHANNEL_OPTIONS_INVALID'
  );
  if (fields.get('helperId') !== PORTABLE_ISOLATION_HELPER_BUNDLE_ID
    || fields.get('helperBuildId') !== PORTABLE_ISOLATION_HELPER_BUILD_ID
    || typeof fields.get('bundleIdentityDigest') !== 'string'
    || !DIGEST.test(fields.get('bundleIdentityDigest'))
    || !SUPPORTED_PLATFORMS.has(platform.get('os'))
    || !SUPPORTED_ARCHITECTURES.has(platform.get('architecture'))
    || platform.get('signatureVerification') !== 'platform_verified') {
    throw channelError('UTILITY_CHANNEL_OPTIONS_INVALID');
  }
  return immutableSnapshot({
    helperId: fields.get('helperId'),
    helperBuildId: fields.get('helperBuildId'),
    bundleIdentityDigest: fields.get('bundleIdentityDigest'),
    platform: {
      os: platform.get('os'),
      architecture: platform.get('architecture'),
      signatureVerification: platform.get('signatureVerification'),
    },
  });
}

function invoke(captured, args) {
  return Reflect.apply(captured.method, captured.receiver, args);
}

function wireMessage(kind, channelBindingDigest, extra = {}) {
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
    kind,
    channelBindingDigest,
    ...extra,
  });
}

function normalizeIncomingMessage(value, channelBindingDigest) {
  const fields = exactDataFields(
    value,
    WIRE_KEYS,
    ['version', 'kind', 'channelBindingDigest'],
    'UTILITY_CHANNEL_MESSAGE_REJECTED'
  );
  if (fields.get('version') !== PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION
    || fields.get('channelBindingDigest') !== channelBindingDigest
    || typeof fields.get('kind') !== 'string'
    || !Object.hasOwn(WIRE_KEYS_BY_KIND, fields.get('kind'))) {
    throw channelError('UTILITY_CHANNEL_MESSAGE_REJECTED');
  }
  const expectedKeys = WIRE_KEYS_BY_KIND[fields.get('kind')];
  if (fields.size !== expectedKeys.length
    || [...fields.keys()].some((key) => !expectedKeys.includes(key))) {
    throw channelError('UTILITY_CHANNEL_MESSAGE_REJECTED');
  }
  return fields;
}

function normalizeRequestFrame(value, channelBindingDigest) {
  const fields = exactDataFields(
    value,
    [
      'version', 'direction', 'sequence', 'channelBindingDigest',
      'requestPayloadDigest', 'payloadEncoding', 'payloadBytes',
      'payloadDigest', 'payloadBase64',
    ],
    [
      'version', 'direction', 'sequence', 'channelBindingDigest',
      'requestPayloadDigest', 'payloadEncoding', 'payloadBytes',
      'payloadDigest', 'payloadBase64',
    ],
    'UTILITY_CHANNEL_FRAME_INVALID'
  );
  try {
    assertPortableIsolationHelperPrivateFrame(value, {
      direction: 'request',
      sequence: fields.get('sequence'),
      channelBindingDigest,
    });
  } catch (error) {
    absorbNativePromise(error);
    throw channelError('UTILITY_CHANNEL_FRAME_INVALID');
  }
  if (!Object.isFrozen(value)) throw channelError('UTILITY_CHANNEL_FRAME_INVALID');
  return value;
}

function normalizeAbortRequest(value, channelBindingDigest) {
  const fields = exactDataFields(
    value,
    CLIENT_ABORT_KEYS,
    CLIENT_ABORT_KEYS,
    'UTILITY_CHANNEL_ABORT_INVALID'
  );
  if (fields.get('version')
      !== PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_REQUEST_VERSION
    || fields.get('channelBindingDigest') !== channelBindingDigest) {
    throw channelError('UTILITY_CHANNEL_ABORT_INVALID');
  }
  return safeReasonCode(fields.get('reasonCode'), 'UTILITY_CHANNEL_ABORT_INVALID');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return Object.freeze({ promise, resolve, reject });
}

function rejected(error) {
  return Promise.reject(error);
}

function openPortableIsolationHelperUtilityChannel(options = {}) {
  let fields;
  let endpoint;
  let channelBindingDigest;
  let timeoutMs;
  let runtimeBinding;
  try {
    fields = optionFields(options);
    endpoint = normalizeUtilityProcess(fields.get('utilityProcess'));
    channelBindingDigest = safeDigest(
      fields.get('channelBindingDigest'),
      'UTILITY_CHANNEL_OPTIONS_INVALID'
    );
    runtimeBinding = normalizeRuntimeBinding(fields.get('runtimeBinding'));
    timeoutMs = normalizeTimeout(fields.get('timeoutMs'));
  } catch (error) {
    absorbNativePromise(error);
    return rejected(error instanceof PortableIsolationHelperUtilityChannelError
      ? error
      : channelError('UTILITY_CHANNEL_OPTIONS_INVALID'));
  }

  let state = 'opening';
  let terminalCode = null;
  let killed = false;
  let openTimer = null;
  let exchangePending = null;
  let abortPending = null;
  let disposePending = null;
  let disposeReceipt = null;
  let disposeReady = false;
  let attachedListeners = [];
  const opened = deferred();

  function clearPendingTimer(pending) {
    if (pending && pending.timer) clearTimeout(pending.timer);
  }

  function removeListeners() {
    if (attachedListeners.length === 0) return;
    const listeners = attachedListeners;
    attachedListeners = [];
    for (const [eventName, listener] of listeners) {
      try {
        invoke(endpoint.removeListener, [eventName, listener]);
      } catch (error) {
        absorbNativePromise(error);
      }
    }
  }

  function safeKill() {
    if (killed) return;
    killed = true;
    try {
      const result = invoke(endpoint.kill, []);
      preflightDataGraph(result);
    } catch (error) {
      absorbNativePromise(error);
    }
  }

  function rejectPending(pending, code) {
    if (!pending) return;
    clearPendingTimer(pending);
    pending.reject(channelError(code));
  }

  function failTerminal(code, { kill = true } = {}) {
    if (state === 'closed' || state === 'faulted') return;
    terminalCode = terminalCode || code;
    state = 'faulted';
    if (openTimer) clearTimeout(openTimer);
    openTimer = null;
    opened.reject(channelError(terminalCode));
    rejectPending(exchangePending, terminalCode);
    rejectPending(abortPending, terminalCode);
    rejectPending(disposePending, terminalCode);
    exchangePending = null;
    abortPending = null;
    disposePending = null;
    if (kill) safeKill();
    removeListeners();
  }

  function post(message, failureCode) {
    try {
      const result = invoke(endpoint.postMessage, [message]);
      if (util.types.isPromise(result)) {
        absorbNativePromise(result);
        throw channelError(failureCode);
      }
      return true;
    } catch (error) {
      absorbNativePromise(error);
      failTerminal(failureCode);
      return false;
    }
  }

  function operationPending(code) {
    const pending = deferred();
    const timer = setTimeout(() => {
      if (state === 'faulted' || state === 'closed') return;
      failTerminal(code);
    }, timeoutMs);
    return {
      promise: pending.promise,
      resolve: pending.resolve,
      reject: pending.reject,
      timer,
    };
  }

  function onSpawn() {
    if (state !== 'opening') return;
    state = 'binding';
    post(
      wireMessage('bind', channelBindingDigest, { runtimeBinding }),
      'UTILITY_CHANNEL_OPEN_FAILED'
    );
  }

  function acceptBound(fields) {
    if (state !== 'binding'
      || fields.get('helperRuntimeVersion')
        !== PORTABLE_ISOLATION_HELPER_RUNTIME_VERSION) {
      throw channelError('UTILITY_CHANNEL_MESSAGE_REJECTED');
    }
    if (openTimer) clearTimeout(openTimer);
    openTimer = null;
    state = 'active';
    opened.resolve(createChannel());
  }

  function acceptResponse(fields) {
    if (state !== 'active' || !exchangePending) {
      throw channelError('UTILITY_CHANNEL_MESSAGE_REJECTED');
    }
    const pending = exchangePending;
    let responseFrame;
    try {
      responseFrame = immutableSnapshot(fields.get('frame'));
      assertPortableIsolationHelperPrivateFrame(responseFrame, {
        direction: 'response',
        sequence: pending.requestFrame.sequence,
        channelBindingDigest,
        requestPayloadDigest: pending.requestFrame.payloadDigest,
      });
    } catch (error) {
      absorbNativePromise(error);
      throw channelError('UTILITY_CHANNEL_MESSAGE_REJECTED');
    }
    exchangePending = null;
    clearPendingTimer(pending);
    pending.resolve(responseFrame);
  }

  function acceptAbortReceipt(fields) {
    if (!['aborting', 'disposing'].includes(state) || !abortPending
      || fields.get('processTreeTerminated') !== true
      || fields.get('orphaned') !== 0) {
      throw channelError('UTILITY_CHANNEL_MESSAGE_REJECTED');
    }
    const pending = abortPending;
    abortPending = null;
    clearPendingTimer(pending);
    if (state === 'aborting') state = 'aborted';
    pending.resolve(CONFIRMED_ABORT_RECEIPT);
  }

  function acceptDisposeReady(fields) {
    if (state !== 'disposing' || !disposePending
      || fields.get('orphaned') !== 0) {
      throw channelError('UTILITY_CHANNEL_CLOSE_FAILED');
    }
    disposeReady = true;
  }

  function onMessage(value) {
    if (state === 'closed' || state === 'faulted') return;
    try {
      const fields = normalizeIncomingMessage(value, channelBindingDigest);
      switch (fields.get('kind')) {
        case 'bound':
          acceptBound(fields);
          break;
        case 'response':
          acceptResponse(fields);
          break;
        case 'abort_receipt':
          acceptAbortReceipt(fields);
          break;
        case 'dispose_ready':
          acceptDisposeReady(fields);
          break;
        case 'fault':
          safeReasonCode(fields.get('reasonCode'), 'UTILITY_CHANNEL_MESSAGE_REJECTED');
          throw channelError('UTILITY_CHANNEL_HELPER_FAULT');
        default:
          throw channelError('UTILITY_CHANNEL_MESSAGE_REJECTED');
      }
    } catch (error) {
      absorbNativePromise(error);
      const code = error instanceof PortableIsolationHelperUtilityChannelError
        ? error.code
        : 'UTILITY_CHANNEL_MESSAGE_REJECTED';
      failTerminal(code === 'UTILITY_CHANNEL_CLOSE_FAILED'
        ? code
        : (code === 'UTILITY_CHANNEL_HELPER_FAULT'
          ? code
          : 'UTILITY_CHANNEL_MESSAGE_REJECTED'));
    }
  }

  function onExit(code) {
    if (state === 'closed' || state === 'faulted') return;
    if (state === 'disposing' && disposePending && disposeReady && code === 0) {
      if (abortPending) {
        const pendingAbort = abortPending;
        abortPending = null;
        clearPendingTimer(pendingAbort);
        pendingAbort.resolve(CONFIRMED_ABORT_RECEIPT);
      }
      const pending = disposePending;
      disposePending = null;
      clearPendingTimer(pending);
      state = 'closed';
      disposeReceipt = Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
        closed: true,
        helperExited: true,
        orphaned: 0,
      });
      pending.resolve(disposeReceipt);
      removeListeners();
      return;
    }
    failTerminal(
      state === 'disposing'
        ? 'UTILITY_CHANNEL_CLOSE_FAILED'
        : 'UTILITY_CHANNEL_EXITED',
      { kill: false }
    );
  }

  function onError() {
    failTerminal('UTILITY_CHANNEL_PROCESS_ERROR');
  }

  function exchange(value) {
    if (state === 'faulted') return rejected(channelError(terminalCode));
    if (state !== 'active') return rejected(channelError('UTILITY_CHANNEL_CLOSED'));
    if (exchangePending) return rejected(channelError('UTILITY_CHANNEL_BUSY'));
    let requestFrame;
    try {
      requestFrame = normalizeRequestFrame(value, channelBindingDigest);
    } catch (error) {
      absorbNativePromise(error);
      return rejected(error);
    }
    const pending = operationPending('UTILITY_CHANNEL_EXCHANGE_TIMEOUT');
    pending.requestFrame = requestFrame;
    exchangePending = pending;
    if (!post(
      wireMessage('exchange', channelBindingDigest, { frame: requestFrame }),
      'UTILITY_CHANNEL_EXCHANGE_FAILED'
    )) return pending.promise;
    return pending.promise;
  }

  function abort(value) {
    if (state === 'faulted') return rejected(channelError(terminalCode));
    if (abortPending) return abortPending.promise;
    if (!['active', 'aborted'].includes(state)) {
      return rejected(channelError('UTILITY_CHANNEL_CLOSED'));
    }
    if (state === 'aborted') {
      return Promise.resolve(CONFIRMED_ABORT_RECEIPT);
    }
    let reasonCode;
    try {
      reasonCode = normalizeAbortRequest(value, channelBindingDigest);
    } catch (error) {
      absorbNativePromise(error);
      return rejected(error);
    }
    if (exchangePending) {
      const pending = exchangePending;
      exchangePending = null;
      clearPendingTimer(pending);
      pending.reject(channelError('UTILITY_CHANNEL_ABORTED'));
    }
    state = 'aborting';
    const pending = operationPending('UTILITY_CHANNEL_ABORT_TIMEOUT');
    abortPending = pending;
    if (!post(
      wireMessage('abort', channelBindingDigest, { reasonCode }),
      'UTILITY_CHANNEL_ABORT_FAILED'
    )) return pending.promise;
    return pending.promise;
  }

  function dispose() {
    if (disposeReceipt) return Promise.resolve(disposeReceipt);
    if (disposePending) return disposePending.promise;
    if (state === 'faulted') return rejected(channelError(terminalCode));
    if (state === 'closed') return Promise.resolve(disposeReceipt);
    if (!['active', 'aborted', 'aborting'].includes(state)) {
      return rejected(channelError('UTILITY_CHANNEL_CLOSE_FAILED'));
    }
    if (exchangePending) {
      const pending = exchangePending;
      exchangePending = null;
      clearPendingTimer(pending);
      pending.reject(channelError('UTILITY_CHANNEL_CLOSED'));
    }
    state = 'disposing';
    const pending = operationPending('UTILITY_CHANNEL_CLOSE_FAILED');
    disposePending = pending;
    if (!post(
      wireMessage('dispose', channelBindingDigest),
      'UTILITY_CHANNEL_CLOSE_FAILED'
    )) return pending.promise;
    return pending.promise;
  }

  let channel = null;
  function createChannel() {
    if (channel) return channel;
    channel = Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
      exchange,
      abort,
      dispose,
    });
    return channel;
  }

  try {
    openTimer = setTimeout(() => {
      failTerminal('UTILITY_CHANNEL_OPEN_TIMEOUT');
    }, timeoutMs);
    for (const [eventName, listener] of [
      ['message', onMessage],
      ['exit', onExit],
      ['error', onError],
      ['spawn', onSpawn],
    ]) {
      invoke(endpoint.on, [eventName, listener]);
      attachedListeners.push([eventName, listener]);
    }
  } catch (error) {
    absorbNativePromise(error);
    failTerminal('UTILITY_CHANNEL_PROCESS_INVALID');
    return opened.promise;
  }
  return opened.promise;
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_RUNTIME_VERSION,
  PORTABLE_ISOLATION_HELPER_UTILITY_WIRE_VERSION,
  PortableIsolationHelperUtilityChannelError,
  openPortableIsolationHelperUtilityChannel,
};
