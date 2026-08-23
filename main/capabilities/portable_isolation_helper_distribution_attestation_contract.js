'use strict';

const util = require('util');

const {
  immutableSnapshot,
} = require('./capability_delegation_contracts');
const {
  absorbNativePromise,
  preflightDataGraph,
} = require('./execution_workspace_contract');
const {
  canonicalSha256Digest,
} = require('./transactional_delete_contracts');

const PORTABLE_ISOLATION_HELPER_DISTRIBUTION_MANIFEST_VERSION =
  'portable-isolation-helper-distribution-manifest.v1';
const PORTABLE_ISOLATION_HELPER_DISTRIBUTION_ATTESTATION_VERSION =
  'portable-isolation-helper-distribution-attestation.v1';
const PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM = 'ed25519';
const PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION =
  'portable-isolation-helper-platform-signature-verifier.v1';
const PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION =
  'portable-isolation-helper-platform-signature-request.v1';
const PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION =
  'portable-isolation-helper-platform-signature-receipt.v1';

const PORTABLE_ISOLATION_HELPER_DISTRIBUTION = 'application_bundle';
const PORTABLE_ISOLATION_HELPER_APPLICATION_ID = 'com.faber.code';
const PORTABLE_ISOLATION_HELPER_BUNDLE_ID = 'faber-portable-isolation-helper';
const PORTABLE_ISOLATION_HELPER_BUILD_ID = 'portable-helper-bootstrap-1';
const PORTABLE_ISOLATION_HELPER_RESOURCE_NAME = 'utility_entry.js';
const SIGNING_DOMAIN = 'faber.portable-isolation-helper.distribution-signature.v1';

const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const SAFE_VERSION = /^[0-9]+[.][0-9]+[.][0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const MANIFEST_INPUT_KEYS = Object.freeze([
  'applicationId',
  'applicationVersion',
  'electronVersion',
  'bundleId',
  'helperBuildId',
  'platform',
  'architecture',
  'resourceName',
  'resourceDigest',
  'resourceBytes',
  'keyId',
]);
const MANIFEST_KEYS = Object.freeze([
  'version',
  'distribution',
  ...MANIFEST_INPUT_KEYS,
]);
const ATTESTATION_INPUT_KEYS = Object.freeze(['manifest', 'signatureBase64']);
const ATTESTATION_KEYS = Object.freeze([
  'version',
  'algorithm',
  'manifest',
  'manifestDigest',
  'signatureBase64',
]);

function invalid(label) {
  throw new TypeError(`Invalid portable isolation helper ${label}`);
}

function exactDataFields(value, allowedKeys, requiredKeys, label) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) invalid(label);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    invalid(label);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) invalid(label);
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      invalid(label);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      invalid(label);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function safeIdentifier(value, label) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) invalid(label);
  return value;
}

function safeVersion(value, label) {
  if (typeof value !== 'string' || !SAFE_VERSION.test(value)) invalid(label);
  return value;
}

function safeDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) invalid(label);
  return value;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || Object.is(value, -0)) invalid(label);
  return value;
}

function strictSignatureBase64(value, label) {
  if (typeof value !== 'string' || value.length !== 88 || !BASE64.test(value)) {
    invalid(label);
  }
  let bytes;
  try {
    bytes = Buffer.from(value, 'base64');
  } catch (error) {
    absorbNativePromise(error);
    invalid(label);
  }
  if (bytes.length !== 64 || bytes.toString('base64') !== value) invalid(label);
  return value;
}

function manifestValues(fields, label) {
  const applicationId = safeIdentifier(fields.get('applicationId'), label);
  const bundleId = safeIdentifier(fields.get('bundleId'), label);
  const helperBuildId = safeIdentifier(fields.get('helperBuildId'), label);
  const resourceName = safeIdentifier(fields.get('resourceName'), label);
  if (applicationId !== PORTABLE_ISOLATION_HELPER_APPLICATION_ID
    || bundleId !== PORTABLE_ISOLATION_HELPER_BUNDLE_ID
    || helperBuildId !== PORTABLE_ISOLATION_HELPER_BUILD_ID
    || resourceName !== PORTABLE_ISOLATION_HELPER_RESOURCE_NAME
    || !SUPPORTED_PLATFORMS.has(fields.get('platform'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))) {
    invalid(label);
  }
  return Object.freeze({
    applicationId,
    applicationVersion: safeVersion(fields.get('applicationVersion'), label),
    electronVersion: safeVersion(fields.get('electronVersion'), label),
    bundleId,
    helperBuildId,
    platform: fields.get('platform'),
    architecture: fields.get('architecture'),
    resourceName,
    resourceDigest: safeDigest(fields.get('resourceDigest'), label),
    resourceBytes: positiveSafeInteger(fields.get('resourceBytes'), label),
    keyId: safeIdentifier(fields.get('keyId'), label),
  });
}

function createPortableIsolationHelperDistributionManifest(input = {}) {
  const fields = exactDataFields(
    input,
    MANIFEST_INPUT_KEYS,
    MANIFEST_INPUT_KEYS,
    'distribution manifest'
  );
  const values = manifestValues(fields, 'distribution manifest');
  return immutableSnapshot({
    version: PORTABLE_ISOLATION_HELPER_DISTRIBUTION_MANIFEST_VERSION,
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    ...values,
  });
}

function assertPortableIsolationHelperDistributionManifest(value) {
  const fields = exactDataFields(
    value,
    MANIFEST_KEYS,
    MANIFEST_KEYS,
    'distribution manifest'
  );
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION_MANIFEST_VERSION
    || fields.get('distribution') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION) {
    invalid('distribution manifest');
  }
  manifestValues(fields, 'distribution manifest');
  return value;
}

function portableIsolationHelperDistributionSigningPayload(manifest) {
  const accepted = assertPortableIsolationHelperDistributionManifest(manifest);
  return JSON.stringify(immutableSnapshot({
    domain: SIGNING_DOMAIN,
    manifest: accepted,
  }));
}

function createPortableIsolationHelperDistributionAttestation(input = {}) {
  const fields = exactDataFields(
    input,
    ATTESTATION_INPUT_KEYS,
    ATTESTATION_INPUT_KEYS,
    'distribution attestation'
  );
  const manifest = assertPortableIsolationHelperDistributionManifest(fields.get('manifest'));
  const signatureBase64 = strictSignatureBase64(
    fields.get('signatureBase64'),
    'distribution attestation'
  );
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_DISTRIBUTION_ATTESTATION_VERSION,
    algorithm: PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM,
    manifest,
    manifestDigest: canonicalSha256Digest(manifest),
    signatureBase64,
  });
}

function assertPortableIsolationHelperDistributionAttestation(value) {
  const fields = exactDataFields(
    value,
    ATTESTATION_KEYS,
    ATTESTATION_KEYS,
    'distribution attestation'
  );
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION_ATTESTATION_VERSION
    || fields.get('algorithm') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM) {
    invalid('distribution attestation');
  }
  const manifest = assertPortableIsolationHelperDistributionManifest(fields.get('manifest'));
  const expectedDigest = canonicalSha256Digest(manifest);
  if (safeDigest(fields.get('manifestDigest'), 'distribution attestation')
    !== expectedDigest) {
    invalid('distribution attestation');
  }
  strictSignatureBase64(fields.get('signatureBase64'), 'distribution attestation');
  return value;
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
  PORTABLE_ISOLATION_HELPER_BUILD_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_ATTESTATION_VERSION,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_MANIFEST_VERSION,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
  PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
  assertPortableIsolationHelperDistributionAttestation,
  assertPortableIsolationHelperDistributionManifest,
  createPortableIsolationHelperDistributionAttestation,
  createPortableIsolationHelperDistributionManifest,
  portableIsolationHelperDistributionSigningPayload,
};
