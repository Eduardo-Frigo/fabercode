'use strict';

const util = require('util');

const {
  absorbNativePromise,
  preflightDataGraph,
} = require('./execution_workspace_contract');
const {
  immutableSnapshot,
} = require('./capability_delegation_contracts');
const {
  PORTABLE_ISOLATION_HELPER_REQUIREMENTS,
} = require('./portable_isolation_helper_protocol');
const {
  canonicalSha256Digest,
} = require('./transactional_delete_contracts');

const PORTABLE_ISOLATION_HELPER_BUNDLE_DESCRIPTOR_VERSION =
  'portable-isolation-helper-bundle-descriptor.v1';
const PORTABLE_ISOLATION_HELPER_LAUNCH_REQUEST_VERSION =
  'portable-isolation-helper-launch-request.v1';
const PORTABLE_ISOLATION_HELPER_LAUNCH_RECEIPT_VERSION =
  'portable-isolation-helper-launch-receipt.v1';

const PORTABLE_ISOLATION_HELPER_DISTRIBUTION = 'application_bundle';
const PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND = 'private_framed';

const REQUIREMENTS_DIGEST = canonicalSha256Digest(
  PORTABLE_ISOLATION_HELPER_REQUIREMENTS
);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_OS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);

const BUNDLE_INPUT_KEYS = Object.freeze([
  'bundleId',
  'helperBuildId',
  'bundleIdentityDigest',
  'platform',
]);
const BUNDLE_KEYS = Object.freeze([
  'version',
  'bundleId',
  'helperBuildId',
  'bundleIdentityDigest',
  'distribution',
  'platform',
  'transport',
  'requirementsDigest',
  'descriptorDigest',
]);
const PLATFORM_KEYS = Object.freeze([
  'os',
  'architecture',
  'signatureVerification',
  'signatureIdentityDigest',
]);
const LAUNCH_REQUEST_INPUT_KEYS = Object.freeze(['requestId', 'bundle']);
const LAUNCH_REQUEST_KEYS = Object.freeze([
  'version',
  'kind',
  'requestId',
  'bundleId',
  'helperBuildId',
  'bundleIdentityDigest',
  'descriptorDigest',
  'distribution',
  'platform',
  'transport',
  'requirementsDigest',
  'requestDigest',
]);
const LAUNCH_RECEIPT_INPUT_KEYS = Object.freeze([
  'request',
  'channelBindingDigest',
]);
const LAUNCH_RECEIPT_KEYS = Object.freeze([
  'version',
  'kind',
  'requestId',
  'accepted',
  'bundleId',
  'helperBuildId',
  'bundleIdentityDigest',
  'descriptorDigest',
  'distribution',
  'platform',
  'transport',
  'requirementsDigest',
  'requestDigest',
  'channelBindingDigest',
  'receiptDigest',
]);

class PortableIsolationHelperLauncherContractError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperLauncherContractError';
    this.code = code;
  }
}

function launchError(code) {
  return new PortableIsolationHelperLauncherContractError(code);
}

function fail(code) {
  throw launchError(code);
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) {
    fail('LAUNCH_DATA_INVALID');
  }
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    fail('LAUNCH_DATA_INVALID');
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    fail('LAUNCH_DATA_INVALID');
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      fail('LAUNCH_DATA_INVALID');
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      fail('LAUNCH_DATA_INVALID');
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

function normalizePlatform(value, code = 'LAUNCH_BUNDLE_INVALID') {
  let fields;
  try {
    fields = exactDataFields(value, PLATFORM_KEYS);
  } catch (error) {
    absorbNativePromise(error);
    if (error && error.code === 'LAUNCH_DATA_INVALID') fail(code);
    throw error;
  }
  if (!SUPPORTED_OS.has(fields.get('os'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || fields.get('signatureVerification') !== 'platform_verified') {
    fail(code);
  }
  return immutableSnapshot({
    os: fields.get('os'),
    architecture: fields.get('architecture'),
    signatureVerification: 'platform_verified',
    signatureIdentityDigest: safeDigest(fields.get('signatureIdentityDigest'), code),
  });
}

function createBundleCore(fields) {
  return immutableSnapshot({
    version: PORTABLE_ISOLATION_HELPER_BUNDLE_DESCRIPTOR_VERSION,
    bundleId: safeIdentifier(fields.get('bundleId'), 'LAUNCH_BUNDLE_INVALID'),
    helperBuildId: safeIdentifier(
      fields.get('helperBuildId'),
      'LAUNCH_BUNDLE_INVALID'
    ),
    bundleIdentityDigest: safeDigest(
      fields.get('bundleIdentityDigest'),
      'LAUNCH_BUNDLE_INVALID'
    ),
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    platform: normalizePlatform(fields.get('platform')),
    transport: PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
    requirementsDigest: REQUIREMENTS_DIGEST,
  });
}

function createPortableIsolationHelperBundleDescriptor(input = {}) {
  const fields = exactDataFields(input, BUNDLE_INPUT_KEYS);
  let core;
  try {
    core = createBundleCore(fields);
  } catch (error) {
    absorbNativePromise(error);
    if (error instanceof PortableIsolationHelperLauncherContractError) throw error;
    fail('LAUNCH_BUNDLE_INVALID');
  }
  return immutableSnapshot({
    ...core,
    descriptorDigest: canonicalSha256Digest(core),
  });
}

function assertPortableIsolationHelperBundleDescriptor(value) {
  const fields = exactDataFields(value, BUNDLE_KEYS);
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_BUNDLE_DESCRIPTOR_VERSION
    || fields.get('distribution') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION
    || fields.get('transport') !== PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND
    || fields.get('requirementsDigest') !== REQUIREMENTS_DIGEST) {
    fail('LAUNCH_BUNDLE_INVALID');
  }
  const core = createBundleCore(fields);
  const expectedDigest = canonicalSha256Digest(core);
  safeDigest(fields.get('descriptorDigest'), 'LAUNCH_BUNDLE_INVALID');
  if (fields.get('descriptorDigest') !== expectedDigest) {
    fail('LAUNCH_DIGEST_MISMATCH');
  }
  return immutableSnapshot({ ...core, descriptorDigest: expectedDigest });
}

function bundleCoreFromLaunchFields(fields) {
  return immutableSnapshot({
    version: PORTABLE_ISOLATION_HELPER_BUNDLE_DESCRIPTOR_VERSION,
    bundleId: fields.get('bundleId'),
    helperBuildId: fields.get('helperBuildId'),
    bundleIdentityDigest: fields.get('bundleIdentityDigest'),
    distribution: fields.get('distribution'),
    platform: fields.get('platform'),
    transport: fields.get('transport'),
    requirementsDigest: fields.get('requirementsDigest'),
  });
}

function createLaunchRequestCore(requestId, bundle) {
  return immutableSnapshot({
    version: PORTABLE_ISOLATION_HELPER_LAUNCH_REQUEST_VERSION,
    kind: 'launch_request',
    requestId: safeIdentifier(requestId, 'LAUNCH_REQUEST_INVALID'),
    bundleId: bundle.bundleId,
    helperBuildId: bundle.helperBuildId,
    bundleIdentityDigest: bundle.bundleIdentityDigest,
    descriptorDigest: bundle.descriptorDigest,
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    platform: bundle.platform,
    transport: PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
    requirementsDigest: REQUIREMENTS_DIGEST,
  });
}

function createPortableIsolationHelperLaunchRequest(input = {}) {
  const fields = exactDataFields(input, LAUNCH_REQUEST_INPUT_KEYS);
  let bundle;
  try {
    bundle = assertPortableIsolationHelperBundleDescriptor(fields.get('bundle'));
  } catch (error) {
    absorbNativePromise(error);
    if (error instanceof PortableIsolationHelperLauncherContractError) throw error;
    fail('LAUNCH_REQUEST_INVALID');
  }
  const core = createLaunchRequestCore(fields.get('requestId'), bundle);
  return immutableSnapshot({
    ...core,
    requestDigest: canonicalSha256Digest(core),
  });
}

function assertPortableIsolationHelperLaunchRequest(value) {
  const fields = exactDataFields(value, LAUNCH_REQUEST_KEYS);
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_LAUNCH_REQUEST_VERSION
    || fields.get('kind') !== 'launch_request'
    || fields.get('distribution') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION
    || fields.get('transport') !== PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND
    || fields.get('requirementsDigest') !== REQUIREMENTS_DIGEST) {
    fail('LAUNCH_REQUEST_INVALID');
  }
  safeIdentifier(fields.get('requestId'), 'LAUNCH_REQUEST_INVALID');
  safeIdentifier(fields.get('bundleId'), 'LAUNCH_REQUEST_INVALID');
  safeIdentifier(fields.get('helperBuildId'), 'LAUNCH_REQUEST_INVALID');
  safeDigest(fields.get('bundleIdentityDigest'), 'LAUNCH_REQUEST_INVALID');
  safeDigest(fields.get('descriptorDigest'), 'LAUNCH_REQUEST_INVALID');
  const platform = normalizePlatform(fields.get('platform'), 'LAUNCH_REQUEST_INVALID');
  const normalizedFields = new Map(fields);
  normalizedFields.set('platform', platform);
  const expectedDescriptorDigest = canonicalSha256Digest(
    bundleCoreFromLaunchFields(normalizedFields)
  );
  if (fields.get('descriptorDigest') !== expectedDescriptorDigest) {
    fail('LAUNCH_DIGEST_MISMATCH');
  }
  const core = immutableSnapshot({
    version: PORTABLE_ISOLATION_HELPER_LAUNCH_REQUEST_VERSION,
    kind: 'launch_request',
    requestId: fields.get('requestId'),
    bundleId: fields.get('bundleId'),
    helperBuildId: fields.get('helperBuildId'),
    bundleIdentityDigest: fields.get('bundleIdentityDigest'),
    descriptorDigest: fields.get('descriptorDigest'),
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    platform,
    transport: PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
    requirementsDigest: REQUIREMENTS_DIGEST,
  });
  safeDigest(fields.get('requestDigest'), 'LAUNCH_REQUEST_INVALID');
  const expectedRequestDigest = canonicalSha256Digest(core);
  if (fields.get('requestDigest') !== expectedRequestDigest) {
    fail('LAUNCH_DIGEST_MISMATCH');
  }
  return immutableSnapshot({ ...core, requestDigest: expectedRequestDigest });
}

function createLaunchReceiptCore(request, channelBindingDigest) {
  return immutableSnapshot({
    version: PORTABLE_ISOLATION_HELPER_LAUNCH_RECEIPT_VERSION,
    kind: 'launch_receipt',
    requestId: request.requestId,
    accepted: true,
    bundleId: request.bundleId,
    helperBuildId: request.helperBuildId,
    bundleIdentityDigest: request.bundleIdentityDigest,
    descriptorDigest: request.descriptorDigest,
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    platform: request.platform,
    transport: PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
    requirementsDigest: REQUIREMENTS_DIGEST,
    requestDigest: request.requestDigest,
    channelBindingDigest: safeDigest(
      channelBindingDigest,
      'LAUNCH_RECEIPT_INVALID'
    ),
  });
}

function createPortableIsolationHelperLaunchReceipt(input = {}) {
  const fields = exactDataFields(input, LAUNCH_RECEIPT_INPUT_KEYS);
  let request;
  try {
    request = assertPortableIsolationHelperLaunchRequest(fields.get('request'));
  } catch (error) {
    absorbNativePromise(error);
    if (error instanceof PortableIsolationHelperLauncherContractError) throw error;
    fail('LAUNCH_RECEIPT_INVALID');
  }
  const core = createLaunchReceiptCore(request, fields.get('channelBindingDigest'));
  return immutableSnapshot({
    ...core,
    receiptDigest: canonicalSha256Digest(core),
  });
}

function assertPortableIsolationHelperLaunchReceipt(value, expectedRequestValue) {
  const expectedRequest = assertPortableIsolationHelperLaunchRequest(
    expectedRequestValue
  );
  const fields = exactDataFields(value, LAUNCH_RECEIPT_KEYS);
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_LAUNCH_RECEIPT_VERSION
    || fields.get('kind') !== 'launch_receipt'
    || fields.get('accepted') !== true
    || fields.get('distribution') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION
    || fields.get('transport') !== PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND
    || fields.get('requirementsDigest') !== REQUIREMENTS_DIGEST) {
    fail('LAUNCH_RECEIPT_INVALID');
  }
  const platform = normalizePlatform(fields.get('platform'), 'LAUNCH_RECEIPT_INVALID');
  for (const [name, expected] of [
    ['requestId', expectedRequest.requestId],
    ['bundleId', expectedRequest.bundleId],
    ['helperBuildId', expectedRequest.helperBuildId],
    ['bundleIdentityDigest', expectedRequest.bundleIdentityDigest],
    ['descriptorDigest', expectedRequest.descriptorDigest],
    ['distribution', expectedRequest.distribution],
    ['transport', expectedRequest.transport],
    ['requirementsDigest', expectedRequest.requirementsDigest],
    ['requestDigest', expectedRequest.requestDigest],
  ]) {
    if (fields.get(name) !== expected) fail('LAUNCH_RECEIPT_MISMATCH');
  }
  if (canonicalSha256Digest(platform) !== canonicalSha256Digest(expectedRequest.platform)) {
    fail('LAUNCH_RECEIPT_MISMATCH');
  }
  const core = createLaunchReceiptCore(
    expectedRequest,
    fields.get('channelBindingDigest')
  );
  safeDigest(fields.get('receiptDigest'), 'LAUNCH_RECEIPT_INVALID');
  const expectedReceiptDigest = canonicalSha256Digest(core);
  if (fields.get('receiptDigest') !== expectedReceiptDigest) {
    fail('LAUNCH_DIGEST_MISMATCH');
  }
  return immutableSnapshot({ ...core, receiptDigest: expectedReceiptDigest });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_BUNDLE_DESCRIPTOR_VERSION,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
  PORTABLE_ISOLATION_HELPER_LAUNCH_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_LAUNCH_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
  PortableIsolationHelperLauncherContractError,
  assertPortableIsolationHelperBundleDescriptor,
  assertPortableIsolationHelperLaunchReceipt,
  assertPortableIsolationHelperLaunchRequest,
  createPortableIsolationHelperBundleDescriptor,
  createPortableIsolationHelperLaunchReceipt,
  createPortableIsolationHelperLaunchRequest,
};
