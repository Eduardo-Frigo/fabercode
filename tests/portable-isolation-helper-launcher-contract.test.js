'use strict';

const assert = require('assert');

const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  PORTABLE_ISOLATION_HELPER_BUNDLE_DESCRIPTOR_VERSION,
  PORTABLE_ISOLATION_HELPER_LAUNCH_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_LAUNCH_REQUEST_VERSION,
  assertPortableIsolationHelperBundleDescriptor,
  assertPortableIsolationHelperLaunchReceipt,
  assertPortableIsolationHelperLaunchRequest,
  createPortableIsolationHelperBundleDescriptor,
  createPortableIsolationHelperLaunchReceipt,
  createPortableIsolationHelperLaunchRequest,
} = require('../main/capabilities/portable_isolation_helper_launcher_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;

function expectCode(action, code) {
  assert.throws(action, (error) => error && error.code === code);
}

function exactKeys(value, expected) {
  assert.deepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function bundleInput(overrides = {}) {
  return {
    bundleId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-build-1',
    bundleIdentityDigest: digest('a'),
    platform: {
      os: 'darwin',
      architecture: 'arm64',
      signatureVerification: 'platform_verified',
      signatureIdentityDigest: digest('b'),
    },
    ...overrides,
  };
}

const bundle = createPortableIsolationHelperBundleDescriptor(bundleInput());
assert.strictEqual(bundle.version, PORTABLE_ISOLATION_HELPER_BUNDLE_DESCRIPTOR_VERSION);
assert.strictEqual(bundle.distribution, 'application_bundle');
assert.strictEqual(bundle.transport, 'private_framed');
assert.strictEqual(bundle.platform.signatureVerification, 'platform_verified');
assert.ok(Object.isFrozen(bundle));
assert.ok(Object.isFrozen(bundle.platform));
exactKeys(bundle, [
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
const { descriptorDigest, ...bundleCore } = bundle;
assert.strictEqual(descriptorDigest, canonicalSha256Digest(bundleCore));
assert.deepStrictEqual(assertPortableIsolationHelperBundleDescriptor(bundle), bundle);

const launchRequest = createPortableIsolationHelperLaunchRequest({
  requestId: 'portable-launch-1',
  bundle,
});
assert.strictEqual(launchRequest.version, PORTABLE_ISOLATION_HELPER_LAUNCH_REQUEST_VERSION);
assert.strictEqual(launchRequest.kind, 'launch_request');
assert.ok(Object.isFrozen(launchRequest));
assert.ok(Object.isFrozen(launchRequest.platform));
exactKeys(launchRequest, [
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
const { requestDigest, ...requestCore } = launchRequest;
assert.strictEqual(requestDigest, canonicalSha256Digest(requestCore));
assert.deepStrictEqual(assertPortableIsolationHelperLaunchRequest(launchRequest), launchRequest);

const launchReceipt = createPortableIsolationHelperLaunchReceipt({
  request: launchRequest,
  channelBindingDigest: digest('c'),
});
assert.strictEqual(launchReceipt.version, PORTABLE_ISOLATION_HELPER_LAUNCH_RECEIPT_VERSION);
assert.strictEqual(launchReceipt.kind, 'launch_receipt');
assert.strictEqual(launchReceipt.accepted, true);
assert.ok(Object.isFrozen(launchReceipt));
assert.ok(Object.isFrozen(launchReceipt.platform));
exactKeys(launchReceipt, [
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
const { receiptDigest, ...receiptCore } = launchReceipt;
assert.strictEqual(receiptDigest, canonicalSha256Digest(receiptCore));
assert.deepStrictEqual(
  assertPortableIsolationHelperLaunchReceipt(launchReceipt, launchRequest),
  launchReceipt
);

const serializedAuthorityData = JSON.stringify({ bundle, launchRequest, launchReceipt });
for (const forbiddenName of [
  'binaryPath',
  'executablePath',
  'helperPath',
  'providerPath',
  'command',
  'args',
  'env',
]) {
  assert.strictEqual(serializedAuthorityData.includes(forbiddenName), false);
}

for (const platform of [
  {
    os: 'linux',
    architecture: 'x64',
    signatureVerification: 'platform_verified',
    signatureIdentityDigest: digest('d'),
  },
  {
    os: 'win32',
    architecture: 'arm64',
    signatureVerification: 'platform_verified',
    signatureIdentityDigest: digest('e'),
  },
]) {
  const portableBundle = createPortableIsolationHelperBundleDescriptor(
    bundleInput({ platform })
  );
  assert.deepStrictEqual(portableBundle.platform, Object.freeze({ ...platform }));
}

expectCode(
  () => createPortableIsolationHelperBundleDescriptor(bundleInput({
    platform: {
      ...bundleInput().platform,
      signatureVerification: 'unverified',
    },
  })),
  'LAUNCH_BUNDLE_INVALID'
);
expectCode(
  () => createPortableIsolationHelperBundleDescriptor({
    ...bundleInput(),
    executablePath: '/tmp/injected-helper',
  }),
  'LAUNCH_DATA_INVALID'
);
expectCode(
  () => createPortableIsolationHelperBundleDescriptor(bundleInput({
    platform: { ...bundleInput().platform, os: 'freebsd' },
  })),
  'LAUNCH_BUNDLE_INVALID'
);
expectCode(
  () => createPortableIsolationHelperBundleDescriptor(bundleInput({
    bundleIdentityDigest: digest('A'),
  })),
  'LAUNCH_BUNDLE_INVALID'
);

const tamperedDescriptor = Object.freeze({
  ...bundle,
  helperBuildId: 'portable-helper-build-tampered',
});
expectCode(
  () => assertPortableIsolationHelperBundleDescriptor(tamperedDescriptor),
  'LAUNCH_DIGEST_MISMATCH'
);
const tamperedRequest = Object.freeze({
  ...launchRequest,
  bundleIdentityDigest: digest('d'),
});
expectCode(
  () => assertPortableIsolationHelperLaunchRequest(tamperedRequest),
  'LAUNCH_DIGEST_MISMATCH'
);
const mismatchedReceipt = Object.freeze({
  ...launchReceipt,
  requestId: 'portable-launch-2',
});
expectCode(
  () => assertPortableIsolationHelperLaunchReceipt(mismatchedReceipt, launchRequest),
  'LAUNCH_RECEIPT_MISMATCH'
);
const tamperedReceipt = Object.freeze({
  ...launchReceipt,
  channelBindingDigest: digest('e'),
});
expectCode(
  () => assertPortableIsolationHelperLaunchReceipt(tamperedReceipt, launchRequest),
  'LAUNCH_DIGEST_MISMATCH'
);

let getterTouched = false;
const accessorInput = bundleInput();
Object.defineProperty(accessorInput, 'bundleId', {
  enumerable: true,
  get() {
    getterTouched = true;
    return 'forbidden';
  },
});
expectCode(
  () => createPortableIsolationHelperBundleDescriptor(accessorInput),
  'LAUNCH_DATA_INVALID'
);
assert.strictEqual(getterTouched, false);

const rejectedDigest = Promise.reject(new Error('secret rejection'));
expectCode(
  () => createPortableIsolationHelperBundleDescriptor(bundleInput({
    bundleIdentityDigest: rejectedDigest,
  })),
  'LAUNCH_DATA_INVALID'
);

const hostile = new Proxy({}, {
  ownKeys() {
    throw new Error('secret proxy failure');
  },
});
expectCode(
  () => createPortableIsolationHelperBundleDescriptor(hostile),
  'LAUNCH_DATA_INVALID'
);

console.log('portable isolation helper launcher contract tests passed');
