'use strict';

const {
  immutableSnapshot,
} = require('../capabilities/capability_delegation_contracts');
const {
  assertPortableIsolationHelperShutdownReceipt,
} = require('../capabilities/portable_isolation_helper_protocol');
const {
  assertPortableIsolationHelperPrivateFrame,
  createPortableIsolationHelperPrivateFrame,
} = require('../capabilities/portable_isolation_helper_private_transport_contract');
const {
  createPortableIsolationHelperPhysicalRuntime,
} = require('../services/portable_isolation_helper_physical_runtime');

const WIRE_VERSION = 'portable-isolation-helper-utility-wire.v1';
const RUNTIME_VERSION = 'portable-isolation-helper-runtime.v1';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const INBOUND_KEYS = Object.freeze([
  'version',
  'kind',
  'channelBindingDigest',
  'frame',
  'reasonCode',
  'runtimeBinding',
]);
const INBOUND_KEYS_BY_KIND = Object.freeze({
  bind: Object.freeze([
    'version', 'kind', 'channelBindingDigest', 'runtimeBinding',
  ]),
  exchange: Object.freeze(['version', 'kind', 'channelBindingDigest', 'frame']),
  abort: Object.freeze(['version', 'kind', 'channelBindingDigest', 'reasonCode']),
  dispose: Object.freeze(['version', 'kind', 'channelBindingDigest']),
});
const RUNTIME_BINDING_KEYS = Object.freeze([
  'helperId', 'helperBuildId', 'bundleIdentityDigest', 'platform',
]);
const RUNTIME_PLATFORM_KEYS = Object.freeze([
  'os', 'architecture', 'signatureVerification',
]);

let state = 'unbound';
let channelBindingDigest = null;
let exiting = false;
let operationPending = false;
let runtime = null;
let shutdownReceipt = null;
let terminationPromise = null;

class PortableIsolationHelperUtilityRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperUtilityRuntimeError';
    this.code = code;
  }
}

function exactFields(value, allowedKeys, requiredKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
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
    } catch {
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

function eventData(value) {
  if (!value || typeof value !== 'object') return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, 'data');
  } catch {
    return null;
  }
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : null;
}

function runtimeError(code) {
  return new PortableIsolationHelperUtilityRuntimeError(code);
}

function normalizeRuntimeBinding(value) {
  const fields = exactFields(value, RUNTIME_BINDING_KEYS, RUNTIME_BINDING_KEYS);
  if (!fields) throw runtimeError('WIRE_BIND_REJECTED');
  const platform = exactFields(
    fields.get('platform'),
    RUNTIME_PLATFORM_KEYS,
    RUNTIME_PLATFORM_KEYS
  );
  if (!platform || typeof fields.get('helperId') !== 'string'
    || typeof fields.get('helperBuildId') !== 'string'
    || typeof fields.get('bundleIdentityDigest') !== 'string'
    || !DIGEST.test(fields.get('bundleIdentityDigest'))
    || typeof platform.get('os') !== 'string'
    || typeof platform.get('architecture') !== 'string'
    || platform.get('signatureVerification') !== 'platform_verified') {
    throw runtimeError('WIRE_BIND_REJECTED');
  }
  try {
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
  } catch {
    throw runtimeError('WIRE_BIND_REJECTED');
  }
}

function wireMessage(kind, extra = {}) {
  return Object.freeze({
    version: WIRE_VERSION,
    kind,
    channelBindingDigest,
    ...extra,
  });
}

function send(kind, extra) {
  if (!process.parentPort || exiting) return false;
  try {
    process.parentPort.postMessage(wireMessage(kind, extra));
    return true;
  } catch {
    return false;
  }
}

function terminate(exitCode = 1) {
  if (exiting) return;
  exiting = true;
  setImmediate(() => process.exit(exitCode));
}

function assertZeroAuthority(value) {
  let receipt;
  try {
    receipt = assertPortableIsolationHelperShutdownReceipt(value);
  } catch {
    throw runtimeError('HELPER_CLEANUP_FAILED');
  }
  if (receipt.activeWorkspaces !== 0 || receipt.activeRootLeases !== 0
    || receipt.activeProcesses !== 0 || receipt.orphaned !== 0) {
    throw runtimeError('HELPER_CLEANUP_FAILED');
  }
  return receipt;
}

function failClosed(reasonCode) {
  if (terminationPromise) return terminationPromise;
  const safeReasonCode = SAFE_REASON_CODE.test(reasonCode)
    ? reasonCode
    : 'HELPER_RUNTIME_FAILED';
  state = 'faulting';
  terminationPromise = Promise.resolve().then(async () => {
    let reportedReasonCode = safeReasonCode;
    if (runtime && !shutdownReceipt) {
      try {
        shutdownReceipt = assertZeroAuthority(await runtime.quarantine({
          reasonCode: safeReasonCode,
        }));
      } catch {
        reportedReasonCode = 'HELPER_CLEANUP_FAILED';
      }
    }
    state = 'faulted';
    if (channelBindingDigest) send('fault', { reasonCode: reportedReasonCode });
    terminate(1);
  }).catch(() => {
    state = 'faulted';
    terminate(1);
  });
  return terminationPromise;
}

function errorReason(error, fallback) {
  if (error instanceof PortableIsolationHelperUtilityRuntimeError
    && SAFE_REASON_CODE.test(error.code)) return error.code;
  return fallback;
}

function normalizeInbound(value) {
  const base = exactFields(
    value,
    INBOUND_KEYS,
    ['version', 'kind', 'channelBindingDigest']
  );
  if (!base || base.get('version') !== WIRE_VERSION
    || typeof base.get('kind') !== 'string'
    || !Object.hasOwn(INBOUND_KEYS_BY_KIND, base.get('kind'))
    || typeof base.get('channelBindingDigest') !== 'string'
    || !DIGEST.test(base.get('channelBindingDigest'))) return null;
  const expectedKeys = INBOUND_KEYS_BY_KIND[base.get('kind')];
  if (base.size !== expectedKeys.length
    || [...base.keys()].some((key) => !expectedKeys.includes(key))) return null;
  if (base.get('kind') === 'abort'
    && (typeof base.get('reasonCode') !== 'string'
      || !SAFE_REASON_CODE.test(base.get('reasonCode')))) return null;
  return base;
}

async function handleBind(fields) {
  if (state !== 'unbound') throw runtimeError('WIRE_BIND_REPLAY');
  channelBindingDigest = fields.get('channelBindingDigest');
  state = 'activating';
  try {
    runtime = createPortableIsolationHelperPhysicalRuntime({
      runtimeBinding: normalizeRuntimeBinding(fields.get('runtimeBinding')),
    });
    await runtime.activate();
  } catch {
    throw runtimeError('HELPER_RUNTIME_ACTIVATION_FAILED');
  }
  if (state !== 'activating') throw runtimeError('WIRE_BIND_REJECTED');
  state = 'active';
  if (!send('bound', { helperRuntimeVersion: RUNTIME_VERSION })) {
    throw runtimeError('WIRE_SEND_FAILED');
  }
}

async function handleExchange(fields) {
  if (state !== 'active' || !runtime) {
    throw runtimeError('WIRE_EXCHANGE_REJECTED');
  }
  let requestFrame;
  let requestPayload;
  try {
    requestFrame = immutableSnapshot(fields.get('frame'));
    requestPayload = assertPortableIsolationHelperPrivateFrame(requestFrame, {
      direction: 'request',
      sequence: requestFrame.sequence,
      channelBindingDigest,
    });
  } catch {
    throw runtimeError('WIRE_FRAME_REJECTED');
  }
  let responsePayload;
  try {
    responsePayload = await runtime.accept(requestPayload);
  } catch {
    throw runtimeError('HELPER_RUNTIME_REQUEST_FAILED');
  }
  let responseFrame;
  try {
    responseFrame = createPortableIsolationHelperPrivateFrame({
      direction: 'response',
      sequence: requestFrame.sequence,
      channelBindingDigest,
      requestPayloadDigest: requestFrame.payloadDigest,
      payload: responsePayload,
    });
  } catch {
    throw runtimeError('WIRE_FRAME_REJECTED');
  }
  if (!send('response', { frame: responseFrame })) {
    throw runtimeError('WIRE_SEND_FAILED');
  }
}

async function handleAbort(fields) {
  if (!['active', 'aborted'].includes(state) || !runtime) {
    throw runtimeError('WIRE_ABORT_REJECTED');
  }
  if (!shutdownReceipt) {
    state = 'aborting';
    try {
      shutdownReceipt = assertZeroAuthority(await runtime.quarantine({
        reasonCode: fields.get('reasonCode'),
      }));
    } catch {
      throw runtimeError('HELPER_CLEANUP_FAILED');
    }
    state = 'aborted';
  }
  if (!send('abort_receipt', {
    processTreeTerminated: true,
    orphaned: 0,
  })) throw runtimeError('WIRE_SEND_FAILED');
}

async function handleDispose() {
  if (!['active', 'aborted'].includes(state) || !runtime) {
    throw runtimeError('WIRE_DISPOSE_REJECTED');
  }
  state = 'disposing';
  if (!shutdownReceipt) {
    try {
      shutdownReceipt = assertZeroAuthority(await runtime.dispose({
        reasonCode: 'APPLICATION_SHUTDOWN',
      }));
    } catch {
      throw runtimeError('HELPER_CLEANUP_FAILED');
    }
  }
  if (!send('dispose_ready', { orphaned: 0 })) {
    throw runtimeError('WIRE_SEND_FAILED');
  }
  state = 'closed';
  terminate(0);
}

async function dispatchMessage(fields) {
  switch (fields.get('kind')) {
    case 'bind':
      await handleBind(fields);
      return;
    case 'exchange':
      await handleExchange(fields);
      return;
    case 'abort':
      await handleAbort(fields);
      return;
    case 'dispose':
      await handleDispose();
      return;
    default:
      throw runtimeError('WIRE_MESSAGE_REJECTED');
  }
}

function handleMessage(messageEvent) {
  if (exiting) return;
  const fields = normalizeInbound(eventData(messageEvent));
  if (!fields) {
    void failClosed('WIRE_MESSAGE_REJECTED');
    return;
  }
  if (fields.get('kind') !== 'bind'
    && fields.get('channelBindingDigest') !== channelBindingDigest) {
    void failClosed('WIRE_BINDING_MISMATCH');
    return;
  }
  if (operationPending) {
    void failClosed('WIRE_REENTRANT');
    return;
  }
  operationPending = true;
  void Promise.resolve().then(() => dispatchMessage(fields)).then(
    () => { operationPending = false; },
    (error) => {
      operationPending = false;
      return failClosed(errorReason(error, 'HELPER_RUNTIME_FAILED'));
    }
  ).catch(() => terminate(1));
}

if (!process.parentPort
  || typeof process.parentPort.on !== 'function'
  || typeof process.parentPort.postMessage !== 'function') {
  process.exitCode = 1;
} else {
  process.parentPort.on('message', handleMessage);
}
