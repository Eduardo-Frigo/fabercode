'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  absorbNativePromise,
  preflightDataGraph,
} = require('./execution_workspace_contract');
const {
  immutableSnapshot,
} = require('./capability_delegation_contracts');
const {
  PORTABLE_ISOLATION_HELPER_LIMITS,
} = require('./portable_isolation_helper_protocol');

const PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION =
  'portable-isolation-helper-private-channel.v1';
const PORTABLE_ISOLATION_HELPER_PRIVATE_FRAME_VERSION =
  'portable-isolation-helper-private-frame.v1';
const PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_REQUEST_VERSION =
  'portable-isolation-helper-private-channel-abort-request.v1';
const PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION =
  'portable-isolation-helper-private-channel-abort-receipt.v1';
const PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION =
  'portable-isolation-helper-private-channel-dispose-receipt.v1';

const FRAME_INPUT_KEYS = Object.freeze([
  'direction',
  'sequence',
  'channelBindingDigest',
  'requestPayloadDigest',
  'payload',
]);
const FRAME_KEYS = Object.freeze([
  'version',
  'direction',
  'sequence',
  'channelBindingDigest',
  'requestPayloadDigest',
  'payloadEncoding',
  'payloadBytes',
  'payloadDigest',
  'payloadBase64',
]);
const EXPECTATION_KEYS = Object.freeze([
  'direction',
  'sequence',
  'channelBindingDigest',
  'requestPayloadDigest',
]);
const DIRECTIONS = new Set(['request', 'response']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UTF8_DECODER = new util.TextDecoder('utf-8', { fatal: true });
const MAX_BASE64_CHARACTERS = 4 * Math.ceil(
  PORTABLE_ISOLATION_HELPER_LIMITS.maxMessageBytes / 3
);

class PortableIsolationHelperPrivateTransportContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperPrivateTransportContractError';
    this.code = code;
  }
}

function frameError(code) {
  return new PortableIsolationHelperPrivateTransportContractError(code);
}

function fail(code) {
  throw frameError(code);
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail('PRIVATE_FRAME_INVALID');
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    fail('PRIVATE_FRAME_INVALID');
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    fail('PRIVATE_FRAME_INVALID');
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      fail('PRIVATE_FRAME_INVALID');
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      fail('PRIVATE_FRAME_INVALID');
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail('PRIVATE_FRAME_INVALID');
  }
  return value;
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1
    || value > PORTABLE_ISOLATION_HELPER_LIMITS.maxExchanges
    || Object.is(value, -0)) {
    fail('PRIVATE_FRAME_INVALID');
  }
  return value;
}

function payloadDigest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function snapshotPayload(value) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail('PRIVATE_FRAME_INVALID');
  try {
    return immutableSnapshot(value);
  } catch (error) {
    absorbNativePromise(error);
    fail('PRIVATE_FRAME_INVALID');
  }
}

function encodePayload(value) {
  const payload = snapshotPayload(value);
  let json;
  try {
    json = JSON.stringify(payload);
  } catch (error) {
    absorbNativePromise(error);
    fail('PRIVATE_FRAME_INVALID');
  }
  const bytes = Buffer.from(json, 'utf8');
  if (bytes.length < 1 || bytes.length > PORTABLE_ISOLATION_HELPER_LIMITS.maxMessageBytes) {
    fail('PRIVATE_FRAME_LIMIT_EXCEEDED');
  }
  return Object.freeze({
    payload,
    bytes,
    digest: payloadDigest(bytes),
  });
}

function createPortableIsolationHelperPrivateFrame(input = {}) {
  const fields = exactDataFields(
    input,
    FRAME_INPUT_KEYS,
    ['direction', 'sequence', 'channelBindingDigest', 'payload']
  );
  const direction = fields.get('direction');
  if (!DIRECTIONS.has(direction)) fail('PRIVATE_FRAME_INVALID');
  const encoded = encodePayload(fields.get('payload'));
  let requestPayloadDigest;
  if (direction === 'request') {
    if (fields.has('requestPayloadDigest')) fail('PRIVATE_FRAME_INVALID');
    requestPayloadDigest = encoded.digest;
  } else {
    if (!fields.has('requestPayloadDigest')) fail('PRIVATE_FRAME_INVALID');
    requestPayloadDigest = safeDigest(fields.get('requestPayloadDigest'));
  }
  return immutableSnapshot({
    version: PORTABLE_ISOLATION_HELPER_PRIVATE_FRAME_VERSION,
    direction,
    sequence: safeSequence(fields.get('sequence')),
    channelBindingDigest: safeDigest(fields.get('channelBindingDigest')),
    requestPayloadDigest,
    payloadEncoding: 'base64',
    payloadBytes: encoded.bytes.length,
    payloadDigest: encoded.digest,
    payloadBase64: encoded.bytes.toString('base64'),
  });
}

function normalizeExpectation(value) {
  const fields = exactDataFields(
    value,
    EXPECTATION_KEYS,
    ['direction', 'sequence', 'channelBindingDigest']
  );
  const direction = fields.get('direction');
  if (!DIRECTIONS.has(direction)) fail('PRIVATE_FRAME_INVALID');
  if (direction === 'request' && fields.has('requestPayloadDigest')) {
    fail('PRIVATE_FRAME_INVALID');
  }
  if (direction === 'response' && !fields.has('requestPayloadDigest')) {
    fail('PRIVATE_FRAME_INVALID');
  }
  return Object.freeze({
    direction,
    sequence: safeSequence(fields.get('sequence')),
    channelBindingDigest: safeDigest(fields.get('channelBindingDigest')),
    requestPayloadDigest: fields.has('requestPayloadDigest')
      ? safeDigest(fields.get('requestPayloadDigest'))
      : null,
  });
}

function assertPortableIsolationHelperPrivateFrame(value, expectedValue) {
  const expected = normalizeExpectation(expectedValue);
  const fields = exactDataFields(value, FRAME_KEYS);
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_PRIVATE_FRAME_VERSION
    || !DIRECTIONS.has(fields.get('direction'))
    || fields.get('payloadEncoding') !== 'base64') {
    fail('PRIVATE_FRAME_INVALID');
  }
  const sequence = safeSequence(fields.get('sequence'));
  const channelBindingDigest = safeDigest(fields.get('channelBindingDigest'));
  const requestPayloadDigest = safeDigest(fields.get('requestPayloadDigest'));
  const declaredPayloadDigest = safeDigest(fields.get('payloadDigest'));
  if (fields.get('direction') !== expected.direction
    || sequence !== expected.sequence
    || channelBindingDigest !== expected.channelBindingDigest
    || (expected.direction === 'response'
      && requestPayloadDigest !== expected.requestPayloadDigest)) {
    fail('PRIVATE_FRAME_CORRELATION_MISMATCH');
  }
  const declaredPayloadBytes = fields.get('payloadBytes');
  const encodedPayload = fields.get('payloadBase64');
  if (!Number.isSafeInteger(declaredPayloadBytes)
    || declaredPayloadBytes < 1
    || declaredPayloadBytes > PORTABLE_ISOLATION_HELPER_LIMITS.maxMessageBytes
    || Object.is(declaredPayloadBytes, -0)
    || typeof encodedPayload !== 'string') {
    fail('PRIVATE_FRAME_INVALID');
  }
  if (encodedPayload.length > MAX_BASE64_CHARACTERS) {
    fail('PRIVATE_FRAME_LIMIT_EXCEEDED');
  }
  if (encodedPayload.length !== 4 * Math.ceil(declaredPayloadBytes / 3)
    || !CANONICAL_BASE64.test(encodedPayload)) {
    fail('PRIVATE_FRAME_INVALID');
  }
  let bytes;
  try {
    bytes = Buffer.from(encodedPayload, 'base64');
  } catch (error) {
    absorbNativePromise(error);
    fail('PRIVATE_FRAME_INVALID');
  }
  if (bytes.length !== declaredPayloadBytes
    || bytes.toString('base64') !== encodedPayload) {
    fail('PRIVATE_FRAME_INVALID');
  }
  const actualPayloadDigest = payloadDigest(bytes);
  if (declaredPayloadDigest !== actualPayloadDigest
    || (expected.direction === 'request'
      && requestPayloadDigest !== actualPayloadDigest)) {
    fail('PRIVATE_FRAME_DIGEST_MISMATCH');
  }
  let json;
  let parsed;
  try {
    json = UTF8_DECODER.decode(bytes);
    parsed = JSON.parse(json);
  } catch (error) {
    absorbNativePromise(error);
    fail('PRIVATE_FRAME_INVALID');
  }
  const payload = snapshotPayload(parsed);
  if (JSON.stringify(payload) !== json) fail('PRIVATE_FRAME_INVALID');
  return payload;
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_ABORT_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_CHANNEL_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_FRAME_VERSION,
  PortableIsolationHelperPrivateTransportContractError,
  assertPortableIsolationHelperPrivateFrame,
  createPortableIsolationHelperPrivateFrame,
};
