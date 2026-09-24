'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  immutableSnapshot,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
  assertPortableIsolationHelperDistributionAttestation,
} = require('../main/capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  createPortableIsolationHelperDistributionTrustedKey,
  createPortableIsolationHelperPlatformSignatureVerifier,
} = require('../main/services/portable_isolation_helper_distribution_verifier');
const {
  PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_STATE,
  PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_VERSION,
  PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS,
  createPortableIsolationHelperReleaseSignatureVerifier,
} = require('../main/security/portable_isolation_helper_release_trust');
const afterPackModule = require('../build/portable_isolation_helper_after_pack');
const {
  FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV,
  FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV,
  PORTABLE_ISOLATION_HELPER_AFTER_PACK_HOOK_VERSION,
  PORTABLE_ISOLATION_HELPER_AFTER_PACK_RECEIPT_VERSION,
  PortableIsolationHelperAfterPackError,
  createPortableIsolationHelperAfterPackHook,
} = afterPackModule;

const PROJECT_ROOT_PATH = path.resolve(__dirname, '..');
const UTILITY_ENTRY_SOURCE_PATH = path.join(
  PROJECT_ROOT_PATH,
  'main/portable_isolation_helper/utility_entry.js'
);
const tempDirectories = [];

function tempDirectory() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-helper-after-pack-'));
  tempDirectories.push(value);
  return value;
}

function keyMaterial(keyId = 'faber-portable-helper-release-2026-01') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return Object.freeze({
    keyId,
    privateKeyPkcs8DerBase64: privateKey.export({
      format: 'der',
      type: 'pkcs8',
    }).toString('base64'),
    trustedKey: createPortableIsolationHelperDistributionTrustedKey({
      keyId,
      platform: 'darwin',
      architecture: 'arm64',
      publicKeySpkiDerBase64: publicKey.export({
        format: 'der',
        type: 'spki',
      }).toString('base64'),
    }),
  });
}

function fixture() {
  const root = tempDirectory();
  const appOutDir = path.join(root, 'out');
  const resourcesPath = path.join(appOutDir, 'resources');
  const bundleDirectory = path.join(resourcesPath, 'portable-isolation-helper');
  const resourcePath = path.join(bundleDirectory, 'utility_entry.js');
  const attestationPath = path.join(bundleDirectory, 'distribution_attestation.json');
  fs.mkdirSync(bundleDirectory, { recursive: true });
  fs.copyFileSync(UTILITY_ENTRY_SOURCE_PATH, resourcePath);
  fs.writeFileSync(
    attestationPath,
    '{"status":"unconfigured_release_attestation"}\n',
    'utf8'
  );
  const context = Object.freeze({
    appOutDir,
    electronPlatformName: 'darwin',
    arch: 3,
    packager: Object.freeze({
      projectDir: PROJECT_ROOT_PATH,
      appInfo: Object.freeze({
        id: 'com.faber.code',
        version: '0.1.3',
      }),
      info: Object.freeze({
        framework: Object.freeze({ version: '42.1.0' }),
      }),
      getResourcesDir(value) {
        assert.strictEqual(value, appOutDir);
        return resourcesPath;
      },
    }),
  });
  return {
    root,
    appOutDir,
    resourcesPath,
    bundleDirectory,
    resourcePath,
    attestationPath,
    context,
  };
}

function environment(keys, overrides = {}) {
  return Object.freeze({
    [FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV]: keys.keyId,
    [FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV]:
      keys.privateKeyPkcs8DerBase64,
    ...overrides,
  });
}

function electronBuilderShapedContext(packed) {
  class AppInfo {
    constructor() {
      this.version = '0.1.3';
    }

    get id() {
      return 'com.faber.code';
    }
  }

  class PlatformPackager {
    constructor() {
      this.appInfo = new AppInfo();
      this.info = Object.freeze({
        framework: Object.freeze({ version: '42.1.0' }),
      });
    }

    get projectDir() {
      return PROJECT_ROOT_PATH;
    }

    getResourcesDir(value) {
      assert.strictEqual(value, packed.appOutDir);
      return packed.resourcesPath;
    }
  }

  return Object.freeze({
    ...packed.context,
    packager: Object.freeze(new PlatformPackager()),
  });
}

async function expectCode(action, code) {
  await assert.rejects(
    Promise.resolve().then(action),
    (error) => error instanceof PortableIsolationHelperAfterPackError
      && error.code === code
      && !error.message.includes(os.tmpdir())
      && !error.message.includes('PRIVATE KEY')
  );
}

(async () => {
  try {
    assert.strictEqual(
      PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_VERSION,
      'portable-isolation-helper-release-trust.v1'
    );
    assert.strictEqual(PORTABLE_ISOLATION_HELPER_RELEASE_TRUST_STATE, 'configured');
    assert.ok(Object.isFrozen(PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS));
    assert.strictEqual(PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS.length, 39);
    assert.deepStrictEqual(
      PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS.map((key) =>
        `${key.keyId.split('-release-')[1].split('-')[0]}/${key.platform}/${key.architecture}`
      ).sort(),
      [
        'v0.2.0/darwin/arm64', 'v0.2.0/linux/arm64', 'v0.2.0/win32/arm64',
        'v1.0.0/darwin/arm64', 'v1.0.0/darwin/x64',
        'v1.0.0/linux/arm64', 'v1.0.0/linux/x64',
        'v1.0.0/win32/arm64', 'v1.0.0/win32/x64',
        'v1.0.1/darwin/arm64', 'v1.0.1/darwin/x64',
        'v1.0.1/linux/arm64', 'v1.0.1/linux/x64',
        'v1.0.1/win32/arm64', 'v1.0.1/win32/x64',
        'v1.0.2/darwin/arm64', 'v1.0.2/darwin/x64',
        'v1.0.2/linux/arm64', 'v1.0.2/linux/x64',
        'v1.0.2/win32/arm64', 'v1.0.2/win32/x64',
        'v1.0.3/darwin/arm64', 'v1.0.3/darwin/x64',
        'v1.0.3/linux/arm64', 'v1.0.3/linux/x64',
        'v1.0.3/win32/arm64', 'v1.0.3/win32/x64',
        'v1.0.4/darwin/arm64', 'v1.0.4/darwin/x64',
        'v1.0.4/linux/arm64', 'v1.0.4/linux/x64',
        'v1.0.4/win32/arm64', 'v1.0.4/win32/x64',
        'v1.0.5/darwin/arm64', 'v1.0.5/darwin/x64',
        'v1.0.5/linux/arm64', 'v1.0.5/linux/x64',
        'v1.0.5/win32/arm64', 'v1.0.5/win32/x64',
      ]
    );
    const releaseKeyIds = new Set();
    for (const trustedKey of PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS) {
      assert.ok(Object.isFrozen(trustedKey));
      assert.strictEqual(
        trustedKey.version,
        'portable-isolation-helper-distribution-trusted-key.v1'
      );
      assert.strictEqual(trustedKey.algorithm, 'ed25519');
      assert.match(trustedKey.keyId, /^faber-portable-helper-release-v(?:0\.2\.0|1\.0\.[012345])-/);
      assert.match(trustedKey.publicKeySpkiDerBase64, /^[A-Za-z0-9+/]+={0,2}$/);
      assert.match(trustedKey.publicKeyDigest, /^sha256:[a-f0-9]{64}$/);
      releaseKeyIds.add(trustedKey.keyId);
    }
    assert.strictEqual(releaseKeyIds.size, 39);
    const releaseVerifier = createPortableIsolationHelperReleaseSignatureVerifier();
    assert.ok(Object.isFrozen(releaseVerifier));

    const keys = keyMaterial();
    const hook = createPortableIsolationHelperAfterPackHook({
      trustedKeys: Object.freeze([keys.trustedKey]),
      environment: environment(keys),
    });
    assert.ok(Object.isFrozen(hook));
    assert.deepStrictEqual(Object.keys(hook).sort(), ['afterPack', 'version']);
    assert.strictEqual(hook.version, PORTABLE_ISOLATION_HELPER_AFTER_PACK_HOOK_VERSION);

    const packed = fixture();
    const receipt = await hook.afterPack(packed.context);
    assert.ok(Object.isFrozen(receipt));
    assert.deepStrictEqual(Object.keys(receipt).sort(), [
      'version',
      'signed',
      'applicationId',
      'applicationVersion',
      'electronVersion',
      'platform',
      'architecture',
      'keyId',
      'resourceDigest',
      'manifestDigest',
      'publicKeyDigest',
    ].sort());
    assert.strictEqual(receipt.version, PORTABLE_ISOLATION_HELPER_AFTER_PACK_RECEIPT_VERSION);
    assert.strictEqual(receipt.signed, true);
    assert.strictEqual(receipt.applicationId, 'com.faber.code');
    assert.strictEqual(receipt.applicationVersion, '0.1.3');
    assert.strictEqual(receipt.electronVersion, '42.1.0');
    assert.strictEqual(receipt.platform, 'darwin');
    assert.strictEqual(receipt.architecture, 'arm64');
    assert.strictEqual(receipt.keyId, keys.keyId);
    assert.strictEqual(receipt.publicKeyDigest, keys.trustedKey.publicKeyDigest);
    assert.strictEqual(
      JSON.stringify(receipt).includes(keys.privateKeyPkcs8DerBase64),
      false
    );

    const serialized = fs.readFileSync(packed.attestationPath, 'utf8');
    const snapshot = immutableSnapshot(JSON.parse(serialized));
    const attestation = assertPortableIsolationHelperDistributionAttestation(snapshot);
    assert.strictEqual(serialized, `${JSON.stringify(attestation)}\n`);
    assert.strictEqual(attestation.manifest.resourceDigest, receipt.resourceDigest);
    assert.strictEqual(attestation.manifest.keyId, keys.keyId);
    assert.strictEqual(attestation.manifest.platform, 'darwin');
    assert.strictEqual(attestation.manifest.architecture, 'arm64');
    assert.strictEqual(attestation.manifestDigest, receipt.manifestDigest);
    assert.strictEqual(serialized.includes(keys.privateKeyPkcs8DerBase64), false);
    const attestationStat = fs.lstatSync(packed.attestationPath);
    assert.strictEqual(attestationStat.isFile(), true);
    assert.strictEqual(attestationStat.isSymbolicLink(), false);
    assert.strictEqual(attestationStat.nlink, 1);

    const resourceBytes = fs.readFileSync(packed.resourcePath);
    const resourceSource = resourceBytes.toString('utf8');
    assert.ok(resourceBytes.length > 300 * 1024 && resourceBytes.length < 1024 * 1024);
    assert.match(resourceSource, /const __faberFactories = Object\.freeze/);
    assert.match(resourceSource, /portable-execution-workspace-backend\.v1/);
    assert.match(resourceSource, /portable-project-root-authority-backend\.v1/);
    assert.match(resourceSource, /portable-process-supervisor-backend\.v1/);
    assert.strictEqual(resourceSource.includes(PROJECT_ROOT_PATH), false);
    assert.strictEqual(
      `sha256:${crypto.createHash('sha256').update(resourceBytes).digest('hex')}`,
      receipt.resourceDigest
    );
    const verifier = createPortableIsolationHelperPlatformSignatureVerifier({
      trustedKeys: Object.freeze([keys.trustedKey]),
    });
    const verification = await verifier.verify(Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
      distribution: 'application_bundle',
      applicationId: 'com.faber.code',
      applicationVersion: '0.1.3',
      electronVersion: '42.1.0',
      bundleId: 'faber-portable-isolation-helper',
      helperBuildId: 'portable-helper-runtime-1',
      platform: 'darwin',
      architecture: 'arm64',
      resourcePath: packed.resourcePath,
      resourceName: 'utility_entry.js',
      resourceDigest: receipt.resourceDigest,
      resourceBytes: resourceBytes.length,
      attestation,
    }));
    assert.strictEqual(verification.verified, true);

    const builderShapedFixture = fixture();
    const builderShapedReceipt = await hook.afterPack(
      electronBuilderShapedContext(builderShapedFixture)
    );
    assert.strictEqual(builderShapedReceipt.signed, true);
    assert.strictEqual(builderShapedReceipt.resourceDigest.startsWith('sha256:'), true);

    const wrongKeys = keyMaterial('faber-portable-helper-release-wrong');
    const wrongPrivateKeyFixture = fixture();
    const placeholder = fs.readFileSync(wrongPrivateKeyFixture.attestationPath, 'utf8');
    const sourcePlaceholder = fs.readFileSync(
      wrongPrivateKeyFixture.resourcePath,
      'utf8'
    );
    const wrongPrivateKeyHook = createPortableIsolationHelperAfterPackHook({
      trustedKeys: Object.freeze([keys.trustedKey]),
      environment: environment(keys, {
        [FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV]:
          wrongKeys.privateKeyPkcs8DerBase64,
      }),
    });
    await expectCode(
      () => wrongPrivateKeyHook.afterPack(wrongPrivateKeyFixture.context),
      'RELEASE_PRIVATE_KEY_REJECTED'
    );
    assert.strictEqual(
      fs.readFileSync(wrongPrivateKeyFixture.attestationPath, 'utf8'),
      placeholder
    );
    assert.strictEqual(
      fs.readFileSync(wrongPrivateKeyFixture.resourcePath, 'utf8'),
      sourcePlaceholder
    );

    const missingSecretFixture = fixture();
    const missingSecretHook = createPortableIsolationHelperAfterPackHook({
      trustedKeys: Object.freeze([keys.trustedKey]),
      environment: Object.freeze({}),
    });
    await expectCode(
      () => missingSecretHook.afterPack(missingSecretFixture.context),
      'RELEASE_SIGNING_KEY_UNAVAILABLE'
    );
    assert.strictEqual(
      fs.readFileSync(missingSecretFixture.attestationPath, 'utf8'),
      placeholder
    );
    assert.strictEqual(
      fs.readFileSync(missingSecretFixture.resourcePath, 'utf8'),
      sourcePlaceholder
    );

    const tamperedSourceFixture = fixture();
    fs.appendFileSync(tamperedSourceFixture.resourcePath, '// swapped packaging input\n');
    await expectCode(
      () => hook.afterPack(tamperedSourceFixture.context),
      'RELEASE_RESOURCE_INVALID'
    );
    assert.strictEqual(
      fs.readFileSync(tamperedSourceFixture.attestationPath, 'utf8'),
      placeholder
    );

    const symlinkFixture = fixture();
    const helperTarget = path.join(symlinkFixture.bundleDirectory, 'helper-target.js');
    fs.renameSync(symlinkFixture.resourcePath, helperTarget);
    fs.symlinkSync(helperTarget, symlinkFixture.resourcePath);
    await expectCode(
      () => hook.afterPack(symlinkFixture.context),
      'RELEASE_RESOURCE_INVALID'
    );

    const attestationSymlinkFixture = fixture();
    const attestationTarget = path.join(
      attestationSymlinkFixture.bundleDirectory,
      'attestation-target.json'
    );
    fs.renameSync(attestationSymlinkFixture.attestationPath, attestationTarget);
    fs.symlinkSync(attestationTarget, attestationSymlinkFixture.attestationPath);
    await expectCode(
      () => hook.afterPack(attestationSymlinkFixture.context),
      'RELEASE_RESOURCE_INVALID'
    );

    const resourcesSymlinkFixture = fixture();
    const relocatedResources = path.join(
      resourcesSymlinkFixture.root,
      'relocated-resources'
    );
    fs.renameSync(resourcesSymlinkFixture.resourcesPath, relocatedResources);
    fs.symlinkSync(relocatedResources, resourcesSymlinkFixture.resourcesPath, 'dir');
    await expectCode(
      () => hook.afterPack(resourcesSymlinkFixture.context),
      'RELEASE_RESOURCE_INVALID'
    );

    const bundleSymlinkFixture = fixture();
    const relocatedBundle = path.join(
      bundleSymlinkFixture.resourcesPath,
      'relocated-helper-bundle'
    );
    fs.renameSync(bundleSymlinkFixture.bundleDirectory, relocatedBundle);
    fs.symlinkSync(relocatedBundle, bundleSymlinkFixture.bundleDirectory, 'dir');
    await expectCode(
      () => hook.afterPack(bundleSymlinkFixture.context),
      'RELEASE_RESOURCE_INVALID'
    );

    const unsupportedArchitectureFixture = fixture();
    await expectCode(
      () => hook.afterPack(Object.freeze({
        ...unsupportedArchitectureFixture.context,
        arch: 4,
      })),
      'RELEASE_PACK_CONTEXT_INVALID'
    );

    const escapedResourcesFixture = fixture();
    const outsideResources = path.join(escapedResourcesFixture.root, 'outside');
    fs.mkdirSync(outsideResources);
    await expectCode(
      () => hook.afterPack(Object.freeze({
        ...escapedResourcesFixture.context,
        packager: Object.freeze({
          ...escapedResourcesFixture.context.packager,
          getResourcesDir() {
            return outsideResources;
          },
        }),
      })),
      'RELEASE_PACK_CONTEXT_INVALID'
    );

    assert.strictEqual(typeof afterPackModule.default, 'function');
    const packageJson = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'package.json'),
      'utf8'
    ));
    assert.strictEqual(
      packageJson.build.afterPack,
      'build/portable_isolation_helper_after_pack.js'
    );

    const hookSource = fs.readFileSync(path.join(
      __dirname,
      '..',
      'build',
      'portable_isolation_helper_after_pack.js'
    ), 'utf8');
    assert.doesNotMatch(
      hookSource,
      /require\(['"](?:electron|child_process|net|tls|http|https|worker_threads|module)['"]\)|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(/
    );
    assert.match(hookSource, /packager\.getResourcesDir/);
    assert.match(hookSource, /packager\.projectDir/);
    assert.match(hookSource, /fs\.constants\.O_NOFOLLOW/);
    assert.match(hookSource, /fs\.constants\.O_EXCL/);
    assert.match(hookSource, /fs\.fsyncSync/);
    assert.match(hookSource, /fs\.renameSync/);
    assert.match(
      hookSource,
      /FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_PKCS8_DER_BASE64/
    );
    assert.match(hookSource, /createPortableIsolationHelperBundleBuilder/);
    assert.doesNotMatch(hookSource, /console\.|PRIVATE_KEY.*(?:message|error)/);

    const trustSource = fs.readFileSync(path.join(
      __dirname,
      '..',
      'main',
      'security',
      'portable_isolation_helper_release_trust.js'
    ), 'utf8');
    assert.doesNotMatch(
      trustSource,
      /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\b__dirname\b|\bimport\s*\(/
    );
    assert.doesNotMatch(
      trustSource,
      /PRIVATE KEY|privateKey|FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY/
    );

    console.log('portable isolation helper afterPack tests passed');
  } finally {
    for (const directory of tempDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
