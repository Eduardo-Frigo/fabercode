'use strict';

const {
  createPortableIsolationHelperPlatformSignatureVerifier,
} = require('../services/portable_isolation_helper_distribution_verifier');

const PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_VERSION =
  'portable-isolation-helper-release-trust.v1';
const PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_STATE = 'unconfigured';
const PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS = Object.freeze([]);

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
