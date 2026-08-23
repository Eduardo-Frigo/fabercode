'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
  PORTABLE_ISOLATION_HELPER_BUILD_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
  PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
  assertPortableIsolationHelperDistributionAttestation,
  portableIsolationHelperDistributionSigningPayload,
} = require('../capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  absorbNativePromise,
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');

const PORTABLE_ISOLATION_HELPER_DISTRIBUTION_TRUSTED_KEY_VERSION =
  'portable-isolation-helper-distribution-trusted-key.v1';

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const MAX_TRUSTED_KEYS = 16;
const MAX_PUBLIC_KEY_BYTES = 1024;
const MAX_RECEIPT_CACHE_ENTRIES = 32;
const TRUSTED_KEY_INPUT_KEYS = Object.freeze([
  'keyId',
  'platform',
  'architecture',
  'publicKeySpkiDerBase64',
]);
const TRUSTED_KEY_KEYS = Object.freeze([
  'version',
  'keyId',
  'algorithm',
  'platform',
  'architecture',
  'publicKeySpkiDerBase64',
  'publicKeyDigest',
]);
const REQUEST_KEYS = Object.freeze([
  'version',
  'distribution',
  'applicationId',
  'applicationVersion',
  'electronVersion',
  'bundleId',
  'helperBuildId',
  'platform',
  'architecture',
  'resourcePath',
  'resourceName',
  'resourceDigest',
  'resourceBytes',
  'attestation',
]);

class PortableIsolationHelperDistributionVerifierError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperDistributionVerifierError';
    this.code = code;
  }
}

function verifierError(code) {
  return new PortableIsolationHelperDistributionVerifierError(code);
}

function fail(code) {
  throw verifierError(code);
}

function exactDataFields(value, allowedKeys, requiredKeys, code) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
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

function strictBase64(value, code) {
  if (typeof value !== 'string' || !value || !BASE64.test(value)) fail(code);
  let bytes;
  try {
    bytes = Buffer.from(value, 'base64');
  } catch (error) {
    absorbNativePromise(error);
    fail(code);
  }
  if (!bytes.length || bytes.length > MAX_PUBLIC_KEY_BYTES
    || bytes.toString('base64') !== value) fail(code);
  return bytes;
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function trustedKeyMaterial(fields, code) {
  const keyId = safeIdentifier(fields.get('keyId'), code);
  const platform = fields.get('platform');
  const architecture = fields.get('architecture');
  if (!SUPPORTED_PLATFORMS.has(platform)
    || !SUPPORTED_ARCHITECTURES.has(architecture)) fail(code);
  const der = strictBase64(fields.get('publicKeySpkiDerBase64'), code);
  let keyObject;
  let canonicalDer;
  try {
    keyObject = crypto.createPublicKey({
      key: der,
      format: 'der',
      type: 'spki',
    });
    if (keyObject.asymmetricKeyType !== 'ed25519') fail(code);
    canonicalDer = keyObject.export({ format: 'der', type: 'spki' });
  } catch (error) {
    absorbNativePromise(error);
    if (error instanceof PortableIsolationHelperDistributionVerifierError) throw error;
    fail(code);
  }
  if (!Buffer.isBuffer(canonicalDer)
    || canonicalDer.toString('base64') !== fields.get('publicKeySpkiDerBase64')) {
    fail(code);
  }
  return Object.freeze({
    keyId,
    platform,
    architecture,
    publicKeySpkiDerBase64: canonicalDer.toString('base64'),
    publicKeyDigest: sha256Bytes(canonicalDer),
    keyObject,
  });
}

function createPortableIsolationHelperDistributionTrustedKey(input = {}) {
  let material;
  try {
    const fields = exactDataFields(
      input,
      TRUSTED_KEY_INPUT_KEYS,
      TRUSTED_KEY_INPUT_KEYS,
      'DISTRIBUTION_TRUST_KEY_INVALID'
    );
    material = trustedKeyMaterial(fields, 'DISTRIBUTION_TRUST_KEY_INVALID');
  } catch (error) {
    absorbNativePromise(error);
    if (error instanceof PortableIsolationHelperDistributionVerifierError) throw error;
    fail('DISTRIBUTION_TRUST_KEY_INVALID');
  }
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_DISTRIBUTION_TRUSTED_KEY_VERSION,
    keyId: material.keyId,
    algorithm: PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM,
    platform: material.platform,
    architecture: material.architecture,
    publicKeySpkiDerBase64: material.publicKeySpkiDerBase64,
    publicKeyDigest: material.publicKeyDigest,
  });
}

function assertTrustedKey(value) {
  const fields = exactDataFields(
    value,
    TRUSTED_KEY_KEYS,
    TRUSTED_KEY_KEYS,
    'DISTRIBUTION_VERIFIER_OPTIONS_INVALID'
  );
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION_TRUSTED_KEY_VERSION
    || fields.get('algorithm') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM) {
    fail('DISTRIBUTION_VERIFIER_OPTIONS_INVALID');
  }
  const material = trustedKeyMaterial(fields, 'DISTRIBUTION_VERIFIER_OPTIONS_INVALID');
  if (safeDigest(fields.get('publicKeyDigest'), 'DISTRIBUTION_VERIFIER_OPTIONS_INVALID')
    !== material.publicKeyDigest) fail('DISTRIBUTION_VERIFIER_OPTIONS_INVALID');
  return material;
}

function normalizeTrustedKeys(value) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value)) fail('DISTRIBUTION_VERIFIER_OPTIONS_INVALID');
  const keys = Reflect.ownKeys(value);
  if (value.length < 1 || value.length > MAX_TRUSTED_KEYS
    || keys.length !== value.length + 1
    || keys[keys.length - 1] !== 'length'
    || keys.slice(0, -1).some((key, index) => key !== String(index))) {
    fail('DISTRIBUTION_VERIFIER_OPTIONS_INVALID');
  }
  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) fail('DISTRIBUTION_VERIFIER_OPTIONS_INVALID');
    const material = assertTrustedKey(descriptor.value);
    if (seen.has(material.keyId)) fail('DISTRIBUTION_VERIFIER_OPTIONS_INVALID');
    seen.add(material.keyId);
    normalized.push(material);
  }
  return Object.freeze(normalized);
}

function normalizedRequest(value) {
  const fields = exactDataFields(
    value,
    REQUEST_KEYS,
    REQUEST_KEYS,
    'DISTRIBUTION_REQUEST_INVALID'
  );
  if (!Object.isFrozen(value)
    || fields.get('version') !== PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION
    || fields.get('distribution') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION
    || fields.get('applicationId') !== PORTABLE_ISOLATION_HELPER_APPLICATION_ID
    || fields.get('bundleId') !== PORTABLE_ISOLATION_HELPER_BUNDLE_ID
    || fields.get('helperBuildId') !== PORTABLE_ISOLATION_HELPER_BUILD_ID
    || fields.get('resourceName') !== PORTABLE_ISOLATION_HELPER_RESOURCE_NAME
    || !SUPPORTED_PLATFORMS.has(fields.get('platform'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || typeof fields.get('applicationVersion') !== 'string'
    || typeof fields.get('electronVersion') !== 'string'
    || typeof fields.get('resourcePath') !== 'string'
    || !fields.get('resourcePath')
    || fields.get('resourcePath').length > 4096
    || fields.get('resourcePath').includes('\0')
    || (!fields.get('resourcePath').startsWith('/')
      && !/^[A-Za-z]:[\\/]/.test(fields.get('resourcePath'))
      && !fields.get('resourcePath').startsWith('\\\\'))
    || !Number.isSafeInteger(fields.get('resourceBytes'))
    || fields.get('resourceBytes') < 1
    || Object.is(fields.get('resourceBytes'), -0)) {
    fail('DISTRIBUTION_REQUEST_INVALID');
  }
  safeDigest(fields.get('resourceDigest'), 'DISTRIBUTION_REQUEST_INVALID');
  let attestation;
  try {
    attestation = assertPortableIsolationHelperDistributionAttestation(
      fields.get('attestation')
    );
  } catch (error) {
    absorbNativePromise(error);
    fail('DISTRIBUTION_REQUEST_INVALID');
  }
  return Object.freeze({ fields, attestation });
}

function requestMatchesManifest(fields, manifest) {
  return fields.get('distribution') === manifest.distribution
    && fields.get('applicationId') === manifest.applicationId
    && fields.get('applicationVersion') === manifest.applicationVersion
    && fields.get('electronVersion') === manifest.electronVersion
    && fields.get('bundleId') === manifest.bundleId
    && fields.get('helperBuildId') === manifest.helperBuildId
    && fields.get('platform') === manifest.platform
    && fields.get('architecture') === manifest.architecture
    && fields.get('resourceName') === manifest.resourceName
    && fields.get('resourceDigest') === manifest.resourceDigest
    && fields.get('resourceBytes') === manifest.resourceBytes;
}

function createPortableIsolationHelperPlatformSignatureVerifier(options = {}) {
  const fields = exactDataFields(
    options,
    ['trustedKeys'],
    ['trustedKeys'],
    'DISTRIBUTION_VERIFIER_OPTIONS_INVALID'
  );
  const trustedKeys = normalizeTrustedKeys(fields.get('trustedKeys'));
  const receipts = new Map();

  function verify(value) {
    const normalized = normalizedRequest(value);
    const requestFields = normalized.fields;
    const attestation = normalized.attestation;
    if (!requestMatchesManifest(requestFields, attestation.manifest)) {
      fail('DISTRIBUTION_ATTESTATION_MISMATCH');
    }
    const trusted = trustedKeys.find((candidate) => (
      candidate.keyId === attestation.manifest.keyId
      && candidate.platform === requestFields.get('platform')
      && candidate.architecture === requestFields.get('architecture')
    ));
    if (!trusted) fail('DISTRIBUTION_TRUST_REJECTED');

    const requestDigest = canonicalSha256Digest({
      version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
      distribution: requestFields.get('distribution'),
      applicationId: requestFields.get('applicationId'),
      applicationVersion: requestFields.get('applicationVersion'),
      electronVersion: requestFields.get('electronVersion'),
      bundleId: requestFields.get('bundleId'),
      helperBuildId: requestFields.get('helperBuildId'),
      platform: requestFields.get('platform'),
      architecture: requestFields.get('architecture'),
      resourcePath: requestFields.get('resourcePath'),
      resourceName: requestFields.get('resourceName'),
      resourceDigest: requestFields.get('resourceDigest'),
      resourceBytes: requestFields.get('resourceBytes'),
      attestation,
    });
    if (receipts.has(requestDigest)) return receipts.get(requestDigest);

    let verified = false;
    const signatureBytes = Buffer.from(attestation.signatureBase64, 'base64');
    try {
      verified = crypto.verify(
        null,
        Buffer.from(
          portableIsolationHelperDistributionSigningPayload(attestation.manifest),
          'utf8'
        ),
        trusted.keyObject,
        signatureBytes
      );
    } catch (error) {
      absorbNativePromise(error);
      fail('DISTRIBUTION_SIGNATURE_REJECTED');
    }
    if (verified !== true) fail('DISTRIBUTION_SIGNATURE_REJECTED');

    const receipt = Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
      verified: true,
      distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
      platform: requestFields.get('platform'),
      architecture: requestFields.get('architecture'),
      resourceDigest: requestFields.get('resourceDigest'),
      signatureIdentityDigest: canonicalSha256Digest({
        version: 'portable-isolation-helper-distribution-signature-identity.v1',
        keyId: trusted.keyId,
        publicKeyDigest: trusted.publicKeyDigest,
        platform: trusted.platform,
        architecture: trusted.architecture,
        manifestDigest: attestation.manifestDigest,
        signatureDigest: sha256Bytes(signatureBytes),
      }),
    });
    if (receipts.size >= MAX_RECEIPT_CACHE_ENTRIES) {
      receipts.delete(receipts.keys().next().value);
    }
    receipts.set(requestDigest, receipt);
    return receipt;
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
    verify,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_TRUSTED_KEY_VERSION,
  PortableIsolationHelperDistributionVerifierError,
  createPortableIsolationHelperDistributionTrustedKey,
  createPortableIsolationHelperPlatformSignatureVerifier,
};
