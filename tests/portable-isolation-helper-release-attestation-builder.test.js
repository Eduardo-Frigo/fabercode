'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  immutableSnapshot,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
} = require('../main/capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  createPortableIsolationHelperDistributionTrustedKey,
  createPortableIsolationHelperPlatformSignatureVerifier,
} = require('../main/services/portable_isolation_helper_distribution_verifier');
const {
  PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_BUILDER_VERSION,
  PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_RESULT_VERSION,
  PortableIsolationHelperReleaseAttestationBuildError,
  createPortableIsolationHelperReleaseAttestationBuilder,
} = require('../build/portable_isolation_helper_release_attestation_builder');

function exactKeys(value, expected) {
  assert.deepStrictEqual(Object.keys(value).sort(), [...expected].sort());
  assert.ok(Object.isFrozen(value));
}

function keyMaterial(keyId = 'faber-portable-helper-release-2026-01') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const privateKeyDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  return Object.freeze({
    privateKeyPkcs8DerBase64: privateKeyDer.toString('base64'),
    trustedKey: createPortableIsolationHelperDistributionTrustedKey({
      keyId,
      platform: 'darwin',
      architecture: 'arm64',
      publicKeySpkiDerBase64: publicKeyDer.toString('base64'),
    }),
  });
}

function signRequest(keys, overrides = {}) {
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION,
    applicationId: 'com.faber.code',
    applicationVersion: '0.1.3',
    electronVersion: '42.1.0',
    bundleId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-runtime-1',
    platform: 'darwin',
    architecture: 'arm64',
    resourceName: 'utility_entry.js',
    resourceBytes: Buffer.from("'use strict';\n// packaged helper\n", 'utf8'),
    keyId: keys.trustedKey.keyId,
    privateKeyPkcs8DerBase64: keys.privateKeyPkcs8DerBase64,
    ...overrides,
  });
}

function expectCode(action, code) {
  assert.throws(
    action,
    (error) => error instanceof PortableIsolationHelperReleaseAttestationBuildError
      && error.code === code
      && !error.message.includes('PRIVATE KEY')
      && !error.message.includes('MII')
  );
}

(async () => {
  const keys = keyMaterial();
  const builder = createPortableIsolationHelperReleaseAttestationBuilder({
    trustedKeys: Object.freeze([keys.trustedKey]),
  });
  exactKeys(builder, ['version', 'sign']);
  assert.strictEqual(
    builder.version,
    PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_BUILDER_VERSION
  );

  const mutableResource = Buffer.from("'use strict';\n// packaged helper\n", 'utf8');
  const input = signRequest(keys, { resourceBytes: mutableResource });
  const result = builder.sign(input);
  exactKeys(result, [
    'version',
    'resourceDigest',
    'publicKeyDigest',
    'attestation',
    'serializedAttestation',
  ]);
  assert.strictEqual(
    result.version,
    PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_RESULT_VERSION
  );
  assert.match(result.resourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(result.publicKeyDigest, keys.trustedKey.publicKeyDigest);
  assert.strictEqual(result.attestation.manifest.resourceDigest, result.resourceDigest);
  assert.strictEqual(result.attestation.manifest.resourceBytes, mutableResource.length);
  assert.strictEqual(result.attestation.manifest.keyId, keys.trustedKey.keyId);
  assert.strictEqual(result.attestation.manifest.platform, 'darwin');
  assert.strictEqual(result.attestation.manifest.architecture, 'arm64');
  assert.ok(Object.isFrozen(result.attestation));
  assert.ok(Object.isFrozen(result.attestation.manifest));
  assert.strictEqual(
    result.serializedAttestation,
    `${JSON.stringify(immutableSnapshot(result.attestation))}\n`
  );
  assert.ok(Buffer.byteLength(result.serializedAttestation, 'utf8') < 32 * 1024);
  assert.strictEqual(
    JSON.stringify(result).includes(keys.privateKeyPkcs8DerBase64),
    false
  );

  const verifier = createPortableIsolationHelperPlatformSignatureVerifier({
    trustedKeys: Object.freeze([keys.trustedKey]),
  });
  const verificationReceipt = await verifier.verify(Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
    distribution: 'application_bundle',
    applicationId: 'com.faber.code',
    applicationVersion: '0.1.3',
    electronVersion: '42.1.0',
    bundleId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-runtime-1',
    platform: 'darwin',
    architecture: 'arm64',
    resourcePath: '/Applications/Faber Code.app/Contents/Resources/portable-isolation-helper/utility_entry.js',
    resourceName: 'utility_entry.js',
    resourceDigest: result.resourceDigest,
    resourceBytes: mutableResource.length,
    attestation: result.attestation,
  }));
  assert.strictEqual(verificationReceipt.verified, true);

  const originalDigest = result.resourceDigest;
  mutableResource.fill(0);
  assert.strictEqual(result.resourceDigest, originalDigest);
  assert.notStrictEqual(
    result.resourceDigest,
    `sha256:${crypto.createHash('sha256').update(mutableResource).digest('hex')}`
  );

  const wrongKeys = keyMaterial('faber-portable-helper-release-wrong');
  expectCode(
    () => builder.sign(signRequest(keys, {
      privateKeyPkcs8DerBase64: wrongKeys.privateKeyPkcs8DerBase64,
    })),
    'RELEASE_PRIVATE_KEY_REJECTED'
  );
  expectCode(
    () => builder.sign(signRequest(keys, { keyId: 'faber-release-unknown' })),
    'RELEASE_TRUST_REJECTED'
  );
  expectCode(
    () => builder.sign(signRequest(keys, { platform: 'linux' })),
    'RELEASE_TRUST_REJECTED'
  );
  expectCode(
    () => builder.sign(signRequest(keys, { resourceBytes: Buffer.alloc(0) })),
    'RELEASE_SIGN_REQUEST_INVALID'
  );
  expectCode(
    () => builder.sign(Object.freeze({
      ...signRequest(keys),
      unexpected: true,
    })),
    'RELEASE_SIGN_REQUEST_INVALID'
  );

  const { privateKey: rsaPrivateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  expectCode(
    () => builder.sign(signRequest(keys, {
      privateKeyPkcs8DerBase64: rsaPrivateKey.export({
        format: 'der',
        type: 'pkcs8',
      }).toString('base64'),
    })),
    'RELEASE_PRIVATE_KEY_REJECTED'
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
  expectCode(
    () => createPortableIsolationHelperReleaseAttestationBuilder(hostileOptions),
    'RELEASE_BUILDER_OPTIONS_INVALID'
  );
  assert.strictEqual(getterTouched, false);

  let requestGetterTouched = false;
  const hostileRequest = {};
  Object.defineProperty(hostileRequest, 'privateKeyPkcs8DerBase64', {
    enumerable: true,
    get() {
      requestGetterTouched = true;
      return keys.privateKeyPkcs8DerBase64;
    },
  });
  expectCode(
    () => builder.sign(hostileRequest),
    'RELEASE_SIGN_REQUEST_INVALID'
  );
  assert.strictEqual(requestGetterTouched, false);

  const source = fs.readFileSync(path.join(
    __dirname,
    '..',
    'build',
    'portable_isolation_helper_release_attestation_builder.js'
  ), 'utf8');
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(|\bspawn\s*\(|\bexecFile\s*\(/
  );
  assert.match(source, /crypto\.createPrivateKey/);
  assert.match(source, /asymmetricKeyType !== 'ed25519'/);
  assert.match(source, /privateKeyBytes\.fill\(0\)/);
  assert.match(source, /crypto\.sign/);
  assert.match(source, /createPortableIsolationHelperDistributionManifest/);
  assert.match(source, /createPortableIsolationHelperDistributionAttestation/);
  assert.doesNotMatch(
    source,
    /console\.|privateKeyPkcs8DerBase64\s*[:,]\s*(?:result|receipt|output)/
  );

  console.log('portable isolation helper release attestation builder tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
