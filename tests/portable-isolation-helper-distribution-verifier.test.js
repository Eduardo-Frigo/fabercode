'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_ATTESTATION_VERSION,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_MANIFEST_VERSION,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
  assertPortableIsolationHelperDistributionAttestation,
  createPortableIsolationHelperDistributionAttestation,
  createPortableIsolationHelperDistributionManifest,
  portableIsolationHelperDistributionSigningPayload,
} = require('../main/capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION_TRUSTED_KEY_VERSION,
  PortableIsolationHelperDistributionVerifierError,
  createPortableIsolationHelperDistributionTrustedKey,
  createPortableIsolationHelperPlatformSignatureVerifier,
} = require('../main/services/portable_isolation_helper_distribution_verifier');

const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function exactKeys(value, expected) {
  assert.deepStrictEqual(Object.keys(value).sort(), [...expected].sort());
  assert.ok(Object.isFrozen(value));
}

function keyMaterial(keyId = 'faber-release-test-1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey,
    trustedKey: createPortableIsolationHelperDistributionTrustedKey({
      keyId,
      platform: 'darwin',
      architecture: 'arm64',
      publicKeySpkiDerBase64: publicKeyDer.toString('base64'),
    }),
  };
}

function manifest(overrides = {}) {
  return createPortableIsolationHelperDistributionManifest({
    applicationId: 'com.faber.code',
    applicationVersion: '0.1.3',
    electronVersion: '42.1.0',
    bundleId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-runtime-1',
    platform: 'darwin',
    architecture: 'arm64',
    resourceName: 'utility_entry.js',
    resourceDigest: sha256(Buffer.from('signed helper fixture', 'utf8')),
    resourceBytes: Buffer.byteLength('signed helper fixture'),
    keyId: 'faber-release-test-1',
    ...overrides,
  });
}

function signedAttestation(value, privateKey) {
  const signature = crypto.sign(
    null,
    Buffer.from(portableIsolationHelperDistributionSigningPayload(value), 'utf8'),
    privateKey
  );
  return createPortableIsolationHelperDistributionAttestation({
    manifest: value,
    signatureBase64: signature.toString('base64'),
  });
}

function request(attestation, overrides = {}) {
  const value = attestation.manifest;
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
    distribution: 'application_bundle',
    applicationId: value.applicationId,
    applicationVersion: value.applicationVersion,
    electronVersion: value.electronVersion,
    bundleId: value.bundleId,
    helperBuildId: value.helperBuildId,
    platform: value.platform,
    architecture: value.architecture,
    resourcePath: '/Applications/Faber Code.app/Contents/Resources/portable-isolation-helper/utility_entry.js',
    resourceName: value.resourceName,
    resourceDigest: value.resourceDigest,
    resourceBytes: value.resourceBytes,
    attestation,
    ...overrides,
  });
}

async function expectRejectCode(value, code) {
  await assert.rejects(
    Promise.resolve().then(() => value()),
    (error) => error instanceof PortableIsolationHelperDistributionVerifierError
      && error.code === code
      && !error.message.includes('/Applications/')
  );
}

(async () => {
  const keys = keyMaterial();
  exactKeys(keys.trustedKey, [
    'version', 'keyId', 'algorithm', 'platform', 'architecture',
    'publicKeySpkiDerBase64', 'publicKeyDigest',
  ]);
  assert.strictEqual(
    keys.trustedKey.version,
    PORTABLE_ISOLATION_HELPER_DISTRIBUTION_TRUSTED_KEY_VERSION
  );
  assert.strictEqual(
    keys.trustedKey.algorithm,
    PORTABLE_ISOLATION_HELPER_DISTRIBUTION_SIGNATURE_ALGORITHM
  );

  const signedManifest = manifest();
  exactKeys(signedManifest, [
    'version', 'distribution', 'applicationId', 'applicationVersion',
    'electronVersion', 'bundleId', 'helperBuildId', 'platform', 'architecture',
    'resourceName', 'resourceDigest', 'resourceBytes', 'keyId',
  ]);
  assert.strictEqual(
    signedManifest.version,
    PORTABLE_ISOLATION_HELPER_DISTRIBUTION_MANIFEST_VERSION
  );
  const signingPayload = portableIsolationHelperDistributionSigningPayload(signedManifest);
  assert.strictEqual(typeof signingPayload, 'string');
  assert.strictEqual(signingPayload, portableIsolationHelperDistributionSigningPayload(
    Object.freeze({ ...signedManifest })
  ));

  const attestation = signedAttestation(signedManifest, keys.privateKey);
  exactKeys(attestation, [
    'version', 'algorithm', 'manifest', 'manifestDigest', 'signatureBase64',
  ]);
  assert.strictEqual(
    attestation.version,
    PORTABLE_ISOLATION_HELPER_DISTRIBUTION_ATTESTATION_VERSION
  );
  assert.strictEqual(attestation.manifest, signedManifest);
  assert.strictEqual(
    assertPortableIsolationHelperDistributionAttestation(attestation),
    attestation
  );

  const verifier = createPortableIsolationHelperPlatformSignatureVerifier({
    trustedKeys: Object.freeze([keys.trustedKey]),
  });
  exactKeys(verifier, ['version', 'verify']);
  assert.strictEqual(
    verifier.version,
    PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION
  );
  const receipt = await verifier.verify(request(attestation));
  exactKeys(receipt, [
    'version', 'verified', 'distribution', 'platform', 'architecture',
    'resourceDigest', 'signatureIdentityDigest',
  ]);
  assert.strictEqual(receipt.version, PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION);
  assert.strictEqual(receipt.verified, true);
  assert.strictEqual(receipt.distribution, 'application_bundle');
  assert.strictEqual(receipt.platform, 'darwin');
  assert.strictEqual(receipt.architecture, 'arm64');
  assert.strictEqual(receipt.resourceDigest, signedManifest.resourceDigest);
  assert.match(receipt.signatureIdentityDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(await verifier.verify(request(attestation)), receipt);

  await expectRejectCode(
    () => verifier.verify(request(attestation, { resourceDigest: sha256('tampered') })),
    'DISTRIBUTION_ATTESTATION_MISMATCH'
  );

  const signatureBytes = Buffer.from(attestation.signatureBase64, 'base64');
  signatureBytes[0] ^= 0xff;
  const tamperedSignature = Object.freeze({
    ...attestation,
    signatureBase64: signatureBytes.toString('base64'),
  });
  await expectRejectCode(
    () => verifier.verify(request(tamperedSignature)),
    'DISTRIBUTION_SIGNATURE_REJECTED'
  );

  const otherKey = keyMaterial('faber-release-test-2');
  const untrustedAttestation = signedAttestation(
    manifest({ keyId: otherKey.trustedKey.keyId }),
    otherKey.privateKey
  );
  await expectRejectCode(
    () => verifier.verify(request(untrustedAttestation)),
    'DISTRIBUTION_TRUST_REJECTED'
  );

  const wrongPlatformKey = createPortableIsolationHelperDistributionTrustedKey({
    keyId: 'faber-release-linux-1',
    platform: 'linux',
    architecture: 'arm64',
    publicKeySpkiDerBase64: keys.trustedKey.publicKeySpkiDerBase64,
  });
  const wrongPlatformVerifier = createPortableIsolationHelperPlatformSignatureVerifier({
    trustedKeys: Object.freeze([wrongPlatformKey]),
  });
  await expectRejectCode(
    () => wrongPlatformVerifier.verify(request(attestation)),
    'DISTRIBUTION_TRUST_REJECTED'
  );

  assert.throws(
    () => createPortableIsolationHelperPlatformSignatureVerifier({
      trustedKeys: [keys.trustedKey],
    }),
    (error) => error instanceof PortableIsolationHelperDistributionVerifierError
      && error.code === 'DISTRIBUTION_VERIFIER_OPTIONS_INVALID'
  );
  assert.throws(
    () => createPortableIsolationHelperPlatformSignatureVerifier({
      trustedKeys: Object.freeze([keys.trustedKey, keys.trustedKey]),
    }),
    (error) => error instanceof PortableIsolationHelperDistributionVerifierError
      && error.code === 'DISTRIBUTION_VERIFIER_OPTIONS_INVALID'
  );

  const { publicKey: rsaPublicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  assert.throws(
    () => createPortableIsolationHelperDistributionTrustedKey({
      keyId: 'faber-rsa-rejected',
      platform: 'darwin',
      architecture: 'arm64',
      publicKeySpkiDerBase64: rsaPublicKey.export({
        format: 'der',
        type: 'spki',
      }).toString('base64'),
    }),
    (error) => error instanceof PortableIsolationHelperDistributionVerifierError
      && error.code === 'DISTRIBUTION_TRUST_KEY_INVALID'
  );

  let getterTouched = false;
  const hostileOptions = {};
  Object.defineProperty(hostileOptions, 'trustedKeys', {
    enumerable: true,
    get() {
      getterTouched = true;
      return Object.freeze([keys.trustedKey]);
    },
  });
  assert.throws(
    () => createPortableIsolationHelperPlatformSignatureVerifier(hostileOptions),
    (error) => error instanceof PortableIsolationHelperDistributionVerifierError
      && error.code === 'DISTRIBUTION_VERIFIER_OPTIONS_INVALID'
  );
  assert.strictEqual(getterTouched, false);

  for (const invalid of [
    Object.freeze({ ...attestation, algorithm: 'rsa-sha256' }),
    Object.freeze({ ...attestation, manifestDigest: sha256('wrong') }),
    Object.freeze({ ...attestation, signatureBase64: 'not-base64' }),
  ]) {
    assert.throws(
      () => assertPortableIsolationHelperDistributionAttestation(invalid),
      /attestation/i
    );
  }

  const contractSource = fs.readFileSync(path.join(
    __dirname,
    '..',
    'main',
    'capabilities',
    'portable_isolation_helper_distribution_attestation_contract.js'
  ), 'utf8');
  const verifierSource = fs.readFileSync(path.join(
    __dirname,
    '..',
    'main',
    'services',
    'portable_isolation_helper_distribution_verifier.js'
  ), 'utf8');
  assert.doesNotMatch(
    `${contractSource}\n${verifierSource}`,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bipcRenderer\b|\bipcMain\b|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|\bspawn\s*\(|\bexecFile\s*\(/
  );
  assert.match(verifierSource, /crypto\.verify/);
  assert.match(verifierSource, /asymmetricKeyType !== 'ed25519'/);
  assert.match(verifierSource, /canonicalSha256Digest/);

  console.log('portable isolation helper distribution verifier tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
