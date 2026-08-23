'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  immutableSnapshot,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
  PORTABLE_ISOLATION_HELPER_BUILD_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
  PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
  createPortableIsolationHelperDistributionAttestation,
  createPortableIsolationHelperDistributionManifest,
  portableIsolationHelperDistributionSigningPayload,
} = require('../main/capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  createPortableIsolationHelperPlatformSignatureVerifier,
} = require('../main/services/portable_isolation_helper_distribution_verifier');

const PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_BUILDER_VERSION =
  'portable-isolation-helper-release-attestation-builder.v1';
const PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION =
  'portable-isolation-helper-release-attestation-sign-request.v1';
const PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_RESULT_VERSION =
  'portable-isolation-helper-release-attestation-sign-result.v1';

const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const SAFE_VERSION = /^[0-9]+[.][0-9]+[.][0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_RESOURCE_BYTES = 1024 * 1024;
const MAX_PRIVATE_KEY_BYTES = 1024;
const OPTION_KEYS = Object.freeze(['trustedKeys']);
const SIGN_REQUEST_KEYS = Object.freeze([
  'version',
  'applicationId',
  'applicationVersion',
  'electronVersion',
  'bundleId',
  'helperBuildId',
  'platform',
  'architecture',
  'resourceName',
  'resourceBytes',
  'keyId',
  'privateKeyPkcs8DerBase64',
]);

class PortableIsolationHelperReleaseAttestationBuildError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperReleaseAttestationBuildError';
    this.code = code;
  }
}

function buildError(code) {
  return new PortableIsolationHelperReleaseAttestationBuildError(code);
}

function fail(code) {
  throw buildError(code);
}

function exactOwnDataFields(value, allowedKeys, requiredKeys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
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
    } catch {
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

function safeVersion(value, code) {
  if (typeof value !== 'string' || !SAFE_VERSION.test(value)) fail(code);
  return value;
}

function strictPrivateKeyBytes(value) {
  if (typeof value !== 'string' || !value || !BASE64.test(value)) {
    fail('RELEASE_PRIVATE_KEY_REJECTED');
  }
  let bytes;
  try {
    bytes = Buffer.from(value, 'base64');
  } catch {
    fail('RELEASE_PRIVATE_KEY_REJECTED');
  }
  if (!bytes.length || bytes.length > MAX_PRIVATE_KEY_BYTES
    || bytes.toString('base64') !== value) {
    bytes.fill(0);
    fail('RELEASE_PRIVATE_KEY_REJECTED');
  }
  return bytes;
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function normalizeOptions(value) {
  const fields = exactOwnDataFields(
    value,
    OPTION_KEYS,
    OPTION_KEYS,
    'RELEASE_BUILDER_OPTIONS_INVALID'
  );
  const trustedKeys = fields.get('trustedKeys');
  try {
    createPortableIsolationHelperPlatformSignatureVerifier({ trustedKeys });
  } catch {
    fail('RELEASE_BUILDER_OPTIONS_INVALID');
  }
  return Object.freeze({ trustedKeys });
}

function normalizeSignRequest(value) {
  const fields = exactOwnDataFields(
    value,
    SIGN_REQUEST_KEYS,
    SIGN_REQUEST_KEYS,
    'RELEASE_SIGN_REQUEST_INVALID'
  );
  if (!Object.isFrozen(value)
    || fields.get('version')
      !== PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION
    || fields.get('applicationId') !== PORTABLE_ISOLATION_HELPER_APPLICATION_ID
    || fields.get('bundleId') !== PORTABLE_ISOLATION_HELPER_BUNDLE_ID
    || fields.get('helperBuildId') !== PORTABLE_ISOLATION_HELPER_BUILD_ID
    || fields.get('resourceName') !== PORTABLE_ISOLATION_HELPER_RESOURCE_NAME
    || !SUPPORTED_PLATFORMS.has(fields.get('platform'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || !Buffer.isBuffer(fields.get('resourceBytes'))
    || fields.get('resourceBytes').length < 1
    || fields.get('resourceBytes').length > MAX_RESOURCE_BYTES) {
    fail('RELEASE_SIGN_REQUEST_INVALID');
  }
  safeVersion(fields.get('applicationVersion'), 'RELEASE_SIGN_REQUEST_INVALID');
  safeVersion(fields.get('electronVersion'), 'RELEASE_SIGN_REQUEST_INVALID');
  safeIdentifier(fields.get('keyId'), 'RELEASE_SIGN_REQUEST_INVALID');
  if (typeof fields.get('privateKeyPkcs8DerBase64') !== 'string') {
    fail('RELEASE_SIGN_REQUEST_INVALID');
  }
  return fields;
}

function matchingTrustedKey(trustedKeys, fields) {
  const trusted = trustedKeys.find((candidate) => (
    candidate.keyId === fields.get('keyId')
    && candidate.platform === fields.get('platform')
    && candidate.architecture === fields.get('architecture')
  ));
  if (!trusted) fail('RELEASE_TRUST_REJECTED');
  return trusted;
}

function privateKeyForTrustedRoot(encodedPrivateKey, trusted) {
  const privateKeyBytes = strictPrivateKeyBytes(encodedPrivateKey);
  let privateKey;
  let publicKeyDer;
  try {
    privateKey = crypto.createPrivateKey({
      key: privateKeyBytes,
      format: 'der',
      type: 'pkcs8',
    });
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      fail('RELEASE_PRIVATE_KEY_REJECTED');
    }
    const publicKey = crypto.createPublicKey(privateKey);
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      fail('RELEASE_PRIVATE_KEY_REJECTED');
    }
    publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  } catch (error) {
    if (error instanceof PortableIsolationHelperReleaseAttestationBuildError) {
      throw error;
    }
    fail('RELEASE_PRIVATE_KEY_REJECTED');
  } finally {
    privateKeyBytes.fill(0);
  }
  if (!Buffer.isBuffer(publicKeyDer)
    || publicKeyDer.toString('base64') !== trusted.publicKeySpkiDerBase64
    || sha256Bytes(publicKeyDer) !== trusted.publicKeyDigest) {
    fail('RELEASE_PRIVATE_KEY_REJECTED');
  }
  return privateKey;
}

function createPortableIsolationHelperReleaseAttestationBuilder(options = {}) {
  const normalized = normalizeOptions(options);

  function sign(value) {
    const fields = normalizeSignRequest(value);
    const trusted = matchingTrustedKey(normalized.trustedKeys, fields);
    const privateKey = privateKeyForTrustedRoot(
      fields.get('privateKeyPkcs8DerBase64'),
      trusted
    );
    const resourceBytes = Buffer.from(fields.get('resourceBytes'));
    let manifest;
    let signature;
    let attestation;
    try {
      manifest = createPortableIsolationHelperDistributionManifest({
        applicationId: fields.get('applicationId'),
        applicationVersion: fields.get('applicationVersion'),
        electronVersion: fields.get('electronVersion'),
        bundleId: fields.get('bundleId'),
        helperBuildId: fields.get('helperBuildId'),
        platform: fields.get('platform'),
        architecture: fields.get('architecture'),
        resourceName: fields.get('resourceName'),
        resourceDigest: sha256Bytes(resourceBytes),
        resourceBytes: resourceBytes.length,
        keyId: fields.get('keyId'),
      });
      signature = crypto.sign(
        null,
        Buffer.from(
          portableIsolationHelperDistributionSigningPayload(manifest),
          'utf8'
        ),
        privateKey
      );
      attestation = createPortableIsolationHelperDistributionAttestation({
        manifest,
        signatureBase64: signature.toString('base64'),
      });
    } catch (error) {
      if (error instanceof PortableIsolationHelperReleaseAttestationBuildError) {
        throw error;
      }
      fail('RELEASE_SIGNING_FAILED');
    } finally {
      resourceBytes.fill(0);
      if (Buffer.isBuffer(signature)) signature.fill(0);
    }
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_RESULT_VERSION,
      resourceDigest: manifest.resourceDigest,
      publicKeyDigest: trusted.publicKeyDigest,
      attestation,
      serializedAttestation: `${JSON.stringify(immutableSnapshot(attestation))}\n`,
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_BUILDER_VERSION,
    sign,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_BUILDER_VERSION,
  PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_RESULT_VERSION,
  PortableIsolationHelperReleaseAttestationBuildError,
  createPortableIsolationHelperReleaseAttestationBuilder,
};
