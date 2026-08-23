'use strict';

const WIRE_VERSION = 'portable-isolation-helper-utility-wire.v1';
const BOOTSTRAP_VERSION = 'portable-isolation-helper-bootstrap.v1';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const INBOUND_KEYS = Object.freeze([
  'version',
  'kind',
  'channelBindingDigest',
  'frame',
  'reasonCode',
]);
const INBOUND_KEYS_BY_KIND = Object.freeze({
  bind: Object.freeze(['version', 'kind', 'channelBindingDigest']),
  exchange: Object.freeze(['version', 'kind', 'channelBindingDigest', 'frame']),
  abort: Object.freeze(['version', 'kind', 'channelBindingDigest', 'reasonCode']),
  dispose: Object.freeze(['version', 'kind', 'channelBindingDigest']),
});

let state = 'unbound';
let channelBindingDigest = null;
let exiting = false;

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

function rejectMessage(reasonCode) {
  if (channelBindingDigest && SAFE_REASON_CODE.test(reasonCode)) {
    send('fault', { reasonCode });
  }
  terminate(1);
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
  return base;
}

function handleBind(fields) {
  if (state !== 'unbound') return rejectMessage('WIRE_BIND_REPLAY');
  channelBindingDigest = fields.get('channelBindingDigest');
  state = 'active';
  if (!send('bound', { helperRuntimeVersion: BOOTSTRAP_VERSION })) terminate(1);
}

function handleExchange() {
  // The physical host exists before the isolation runtime by design. Until the
  // runtime checkpoint lands, every data request fails closed and the main side
  // quarantines this single-use helper.
  rejectMessage('HELPER_RUNTIME_UNAVAILABLE');
}

function handleAbort(fields) {
  if (!['active', 'aborted'].includes(state)
    || typeof fields.get('reasonCode') !== 'string'
    || !SAFE_REASON_CODE.test(fields.get('reasonCode'))) {
    rejectMessage('WIRE_ABORT_REJECTED');
    return;
  }
  state = 'aborted';
  if (!send('abort_receipt', {
    processTreeTerminated: true,
    orphaned: 0,
  })) terminate(1);
}

function handleDispose() {
  if (!['active', 'aborted'].includes(state)) {
    rejectMessage('WIRE_DISPOSE_REJECTED');
    return;
  }
  state = 'disposing';
  if (!send('dispose_ready', { orphaned: 0 })) {
    terminate(1);
    return;
  }
  terminate(0);
}

function handleMessage(messageEvent) {
  if (exiting) return;
  const fields = normalizeInbound(eventData(messageEvent));
  if (!fields) {
    rejectMessage('WIRE_MESSAGE_REJECTED');
    return;
  }
  if (fields.get('kind') !== 'bind'
    && fields.get('channelBindingDigest') !== channelBindingDigest) {
    rejectMessage('WIRE_BINDING_MISMATCH');
    return;
  }
  switch (fields.get('kind')) {
    case 'bind':
      handleBind(fields);
      break;
    case 'exchange':
      handleExchange(fields);
      break;
    case 'abort':
      handleAbort(fields);
      break;
    case 'dispose':
      handleDispose(fields);
      break;
    default:
      rejectMessage('WIRE_MESSAGE_REJECTED');
  }
}

if (!process.parentPort
  || typeof process.parentPort.on !== 'function'
  || typeof process.parentPort.postMessage !== 'function') {
  process.exitCode = 1;
} else {
  process.parentPort.on('message', handleMessage);
}
