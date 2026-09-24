'use strict';

const {
  createPortableIsolationHelperPlatformSignatureVerifier,
} = require('../services/portable_isolation_helper_distribution_verifier');

const PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_VERSION =
  'portable-isolation-helper-release-trust.v1';
const PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_STATE = 'configured';
const PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS = Object.freeze([
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v0.2.0-darwin-arm64',
    algorithm: 'ed25519',
    platform: 'darwin',
    architecture: 'arm64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAOoC8d1cipvAQLPAPTq3r5ezj2seAuEVyopdvB5NEDWw=',
    publicKeyDigest:
      'sha256:0e95c3c71cdf46d8a89065bd00b966bc78557726238257daac10c4436f1d0d5a',
  }),
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v0.2.0-linux-arm64',
    algorithm: 'ed25519',
    platform: 'linux',
    architecture: 'arm64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAYVC1v2wekDW99yzeTT9n72cwXoPOeh8cFz8a5IRPTEo=',
    publicKeyDigest:
      'sha256:0da2aecb28e2c7d384700a7d19b4e7c9e67fc043720a0b6c4076a607dd091c47',
  }),
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v0.2.0-win32-arm64',
    algorithm: 'ed25519',
    platform: 'win32',
    architecture: 'arm64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAols72Wz8BBOy/DIEMWfkLsZ1AizZWaEMt2NDMoohJK0=',
    publicKeyDigest:
      'sha256:b9eb3ea511240fca02b0ba4ee9c406e1ddc4a7d6a36634cce7da1664206d9ded',
  }),
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v1.0.0-darwin-x64',
    algorithm: 'ed25519',
    platform: 'darwin',
    architecture: 'x64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAyDKCQSRmni4vQHrqKb3xReeivCISgSi5QeQfhUwl774=',
    publicKeyDigest:
      'sha256:d3b234500545d06a047c06cf31604b22e30ea2a6375c05dffe60781e2e1a8a07',
  }),
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v1.0.0-darwin-arm64',
    algorithm: 'ed25519',
    platform: 'darwin',
    architecture: 'arm64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAyDKCQSRmni4vQHrqKb3xReeivCISgSi5QeQfhUwl774=',
    publicKeyDigest:
      'sha256:d3b234500545d06a047c06cf31604b22e30ea2a6375c05dffe60781e2e1a8a07',
  }),
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v1.0.0-win32-x64',
    algorithm: 'ed25519',
    platform: 'win32',
    architecture: 'x64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAyDKCQSRmni4vQHrqKb3xReeivCISgSi5QeQfhUwl774=',
    publicKeyDigest:
      'sha256:d3b234500545d06a047c06cf31604b22e30ea2a6375c05dffe60781e2e1a8a07',
  }),
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v1.0.0-win32-arm64',
    algorithm: 'ed25519',
    platform: 'win32',
    architecture: 'arm64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAyDKCQSRmni4vQHrqKb3xReeivCISgSi5QeQfhUwl774=',
    publicKeyDigest:
      'sha256:d3b234500545d06a047c06cf31604b22e30ea2a6375c05dffe60781e2e1a8a07',
  }),
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v1.0.0-linux-x64',
    algorithm: 'ed25519',
    platform: 'linux',
    architecture: 'x64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAyDKCQSRmni4vQHrqKb3xReeivCISgSi5QeQfhUwl774=',
    publicKeyDigest:
      'sha256:d3b234500545d06a047c06cf31604b22e30ea2a6375c05dffe60781e2e1a8a07',
  }),
  Object.freeze({
    version: 'portable-isolation-helper-distribution-trusted-key.v1',
    keyId: 'faber-portable-helper-release-v1.0.0-linux-arm64',
    algorithm: 'ed25519',
    platform: 'linux',
    architecture: 'arm64',
    publicKeySpkiDerBase64:
      'MCowBQYDK2VwAyEAyDKCQSRmni4vQHrqKb3xReeivCISgSi5QeQfhUwl774=',
    publicKeyDigest:
      'sha256:d3b234500545d06a047c06cf31604b22e30ea2a6375c05dffe60781e2e1a8a07',
  }),
  ...['darwin', 'win32', 'linux'].flatMap((platform) =>
    ['x64', 'arm64'].map((architecture) => Object.freeze({
      version: 'portable-isolation-helper-distribution-trusted-key.v1',
      keyId: `faber-portable-helper-release-v1.0.1-${platform}-${architecture}`,
      algorithm: 'ed25519',
      platform,
      architecture,
      publicKeySpkiDerBase64:
        'MCowBQYDK2VwAyEAjVuXwRHjEMqWI4rrQc1FKDtmkWV2Su9O3f7/++BicHk=',
      publicKeyDigest:
        'sha256:2e20f69b61b0d5ee7988a4ac3089fec92aee04024e6bd8a26df74b587cf7bd2d',
    }))),
  ...['1.0.2', '1.0.3', '1.0.4', '1.0.5'].flatMap((releaseVersion) =>
    ['darwin', 'win32', 'linux'].flatMap((platform) =>
      ['x64', 'arm64'].map((architecture) => Object.freeze({
      version: 'portable-isolation-helper-distribution-trusted-key.v1',
      keyId: `faber-portable-helper-release-v${releaseVersion}-${platform}-${architecture}`,
      algorithm: 'ed25519',
      platform,
      architecture,
      publicKeySpkiDerBase64:
        'MCowBQYDK2VwAyEAjVuXwRHjEMqWI4rrQc1FKDtmkWV2Su9O3f7/++BicHk=',
      publicKeyDigest:
        'sha256:2e20f69b61b0d5ee7988a4ac3089fec92aee04024e6bd8a26df74b587cf7bd2d',
    })))),
]);

class PortableIsolationHelperReleaseTrustError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperReleaseTrustError';
    this.code = code;
  }
}

function createPortableIsolationHelperReleaseSignatureVerifier() {
  if (PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_STATE !== 'configured'
    || PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS.length === 0) {
    throw new PortableIsolationHelperReleaseTrustError(
      'RELEASE_TRUST_UNCONFIGURED'
    );
  }
  try {
    return createPortableIsolationHelperPlatformSignatureVerifier({
      trustedKeys: PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS,
    });
  } catch {
    throw new PortableIsolationHelperReleaseTrustError(
      'RELEASE_TRUST_INVALID'
    );
  }
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_STATE,
  PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_VERSION,
  PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS,
  PortableIsolationHelperReleaseTrustError,
  createPortableIsolationHelperReleaseSignatureVerifier,
};
