'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const {
  PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
  PORTABLE_ISOLATION_HELPER_BUILD_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
  PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
} = require('../main/capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION,
  PortableIsolationHelperReleaseAttestationBuildError,
  createPortableIsolationHelperReleaseAttestationBuilder,
} = require('./portable_isolation_helper_release_attestation_builder');

const FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV =
  'FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID';
const FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV =
  'FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_PKCS8_DER_BASE64';
const PORTABLE_ISOLATION_HELPER_AFTER_PACK_HOOK_VERSION =
  'portable-isolation-helper-after-pack-hook.v1';
const PORTABLE_ISOLATION_HELPER_AFTER_PACK_RECEIPT_VERSION =
  'portable-isolation-helper-after-pack-receipt.v1';
const RESOURCE_DIRECTORY_NAME = 'portable-isolation-helper';
const DISTRIBUTION_ATTESTATION_NAME = 'distribution_attestation.json';
const UNCONFIGURED_ATTESTATION =
  '{"status":"unconfigured_release_attestation"}\n';
const MAX_RESOURCE_BYTES = 1024 * 1024;
const OPTION_KEYS = Object.freeze(['trustedKeys', 'environment']);
const ENVIRONMENT_KEYS = Object.freeze([
  FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV,
  FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV,
]);
const ARCHITECTURES = Object.freeze(new Map([
  [1, 'x64'],
  [3, 'arm64'],
]));
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);

class PortableIsolationHelperAfterPackError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperAfterPackError';
    this.code = code;
  }
}

function fail(code) {
  throw new PortableIsolationHelperAfterPackError(code);
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

function dataField(value, key, code) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) fail(code);
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    fail(code);
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || descriptor.value === undefined) fail(code);
  return descriptor.value;
}

function normalizeEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail('RELEASE_HOOK_OPTIONS_INVALID');
  const output = Object.create(null);
  for (const key of ENVIRONMENT_KEYS) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail('RELEASE_HOOK_OPTIONS_INVALID');
    }
    if (descriptor && !Object.hasOwn(descriptor, 'value')) {
      fail('RELEASE_HOOK_OPTIONS_INVALID');
    }
    output[key] = descriptor ? descriptor.value : undefined;
  }
  return Object.freeze(output);
}

function normalizeOptions(value) {
  const fields = exactOwnDataFields(
    value,
    OPTION_KEYS,
    OPTION_KEYS,
    'RELEASE_HOOK_OPTIONS_INVALID'
  );
  const environment = normalizeEnvironment(fields.get('environment'));
  let builder;
  try {
    builder = createPortableIsolationHelperReleaseAttestationBuilder({
      trustedKeys: fields.get('trustedKeys'),
    });
  } catch {
    fail('RELEASE_HOOK_OPTIONS_INVALID');
  }
  return Object.freeze({ builder, environment });
}

function containedPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizePackContext(context) {
  if (!context || typeof context !== 'object' || util.types.isProxy(context)) {
    fail('RELEASE_PACK_CONTEXT_INVALID');
  }
  const appOutDir = dataField(context, 'appOutDir', 'RELEASE_PACK_CONTEXT_INVALID');
  const platform = dataField(
    context,
    'electronPlatformName',
    'RELEASE_PACK_CONTEXT_INVALID'
  );
  const rawArchitecture = dataField(
    context,
    'arch',
    'RELEASE_PACK_CONTEXT_INVALID'
  );
  const packager = dataField(context, 'packager', 'RELEASE_PACK_CONTEXT_INVALID');
  if (typeof appOutDir !== 'string' || !path.isAbsolute(appOutDir)
    || !PLATFORMS.has(platform) || !ARCHITECTURES.has(rawArchitecture)
    || !packager || typeof packager !== 'object' || util.types.isProxy(packager)) {
    fail('RELEASE_PACK_CONTEXT_INVALID');
  }
  let resourcesPath;
  let applicationId;
  let applicationVersion;
  let electronVersion;
  try {
    if (typeof packager.getResourcesDir !== 'function') {
      fail('RELEASE_PACK_CONTEXT_INVALID');
    }
    resourcesPath = packager.getResourcesDir(appOutDir);
    applicationId = packager.appInfo.id;
    applicationVersion = packager.appInfo.version;
    electronVersion = packager.info.framework.version;
  } catch (error) {
    if (error instanceof PortableIsolationHelperAfterPackError) throw error;
    fail('RELEASE_PACK_CONTEXT_INVALID');
  }
  if (typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)
    || applicationId !== PORTABLE_ISOLATION_HELPER_APPLICATION_ID
    || typeof applicationVersion !== 'string'
    || typeof electronVersion !== 'string') fail('RELEASE_PACK_CONTEXT_INVALID');
  const normalizedAppOutDir = path.resolve(appOutDir);
  const normalizedResourcesPath = path.resolve(resourcesPath);
  if (!containedPath(normalizedAppOutDir, normalizedResourcesPath)) {
    fail('RELEASE_PACK_CONTEXT_INVALID');
  }
  return Object.freeze({
    appOutDir: normalizedAppOutDir,
    resourcesPath: normalizedResourcesPath,
    applicationId,
    applicationVersion,
    electronVersion,
    platform,
    architecture: ARCHITECTURES.get(rawArchitecture),
  });
}

function assertRegularSingleLink(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail('RELEASE_RESOURCE_INVALID');
  }
}

function assertRegularDirectory(stat) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('RELEASE_RESOURCE_INVALID');
  }
}

function inspectContainedDirectoryTree(parentPath, directoryPath) {
  if (!containedPath(parentPath, directoryPath)) {
    fail('RELEASE_RESOURCE_INVALID');
  }
  const relative = path.relative(parentPath, directoryPath);
  const locations = [parentPath];
  let cursor = parentPath;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    locations.push(cursor);
  }
  try {
    for (const location of locations) {
      assertRegularDirectory(fs.lstatSync(location));
    }
    const physicalParent = fs.realpathSync(parentPath);
    const physicalDirectory = fs.realpathSync(directoryPath);
    if (!containedPath(physicalParent, physicalDirectory)) {
      fail('RELEASE_RESOURCE_INVALID');
    }
  } catch (error) {
    if (error instanceof PortableIsolationHelperAfterPackError) throw error;
    fail('RELEASE_RESOURCE_INVALID');
  }
}

function inspectResource(resourcePath, expectedContent) {
  let before;
  let descriptor;
  let bytes;
  try {
    before = fs.lstatSync(resourcePath);
    assertRegularSingleLink(before);
    descriptor = fs.openSync(
      resourcePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    );
    const opened = fs.fstatSync(descriptor);
    assertRegularSingleLink(opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size < 1 || opened.size > MAX_RESOURCE_BYTES) {
      fail('RELEASE_RESOURCE_INVALID');
    }
    bytes = fs.readFileSync(descriptor);
  } catch (error) {
    if (error instanceof PortableIsolationHelperAfterPackError) throw error;
    fail('RELEASE_RESOURCE_INVALID');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== before.size
    || (expectedContent !== undefined && bytes.toString('utf8') !== expectedContent)) {
    if (Buffer.isBuffer(bytes)) bytes.fill(0);
    fail('RELEASE_RESOURCE_INVALID');
  }
  return Object.freeze({
    dev: before.dev,
    ino: before.ino,
    bytes,
  });
}

function assertUnchangedTarget(targetPath, inspected) {
  try {
    const current = fs.lstatSync(targetPath);
    assertRegularSingleLink(current);
    if (current.dev !== inspected.dev || current.ino !== inspected.ino) {
      fail('RELEASE_RESOURCE_INVALID');
    }
  } catch (error) {
    if (error instanceof PortableIsolationHelperAfterPackError) throw error;
    fail('RELEASE_RESOURCE_INVALID');
  }
}

function atomicReplace(targetPath, serialized, inspectedTarget) {
  const parent = path.dirname(targetPath);
  const temporaryPath = path.join(
    parent,
    `.distribution-attestation-${crypto.randomBytes(16).toString('hex')}.tmp`
  );
  let descriptor;
  let temporaryCreated = false;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
        | fs.constants.O_NOFOLLOW,
      0o600
    );
    temporaryCreated = true;
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertUnchangedTarget(targetPath, inspectedTarget);
    fs.renameSync(temporaryPath, targetPath);
    temporaryCreated = false;
  } catch (error) {
    if (error instanceof PortableIsolationHelperAfterPackError) throw error;
    fail('RELEASE_ATTESTATION_WRITE_FAILED');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
    if (temporaryCreated) {
      try { fs.unlinkSync(temporaryPath); } catch { /* best effort */ }
    }
  }
}

function signingCredentials(environment) {
  const keyId = environment[FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV];
  const encodedKey =
    environment[FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV];
  if (typeof keyId !== 'string' || !keyId
    || typeof encodedKey !== 'string' || !encodedKey) {
    fail('RELEASE_SIGNING_KEY_UNAVAILABLE');
  }
  return Object.freeze({ keyId, encodedKey });
}

function createPortableIsolationHelperAfterPackHook(options = {}) {
  const normalized = normalizeOptions(options);

  async function afterPack(context) {
    const pack = normalizePackContext(context);
    const bundlePath = path.join(
      pack.resourcesPath,
      RESOURCE_DIRECTORY_NAME
    );
    inspectContainedDirectoryTree(pack.appOutDir, pack.resourcesPath);
    inspectContainedDirectoryTree(pack.resourcesPath, bundlePath);
    const resourcePath = path.join(bundlePath, PORTABLE_ISOLATION_HELPER_RESOURCE_NAME);
    const attestationPath = path.join(bundlePath, DISTRIBUTION_ATTESTATION_NAME);
    if (!containedPath(pack.resourcesPath, resourcePath)
      || !containedPath(pack.resourcesPath, attestationPath)) {
      fail('RELEASE_RESOURCE_INVALID');
    }
    const resource = inspectResource(resourcePath);
    const target = inspectResource(attestationPath, UNCONFIGURED_ATTESTATION);
    let result;
    try {
      const credentials = signingCredentials(normalized.environment);
      result = normalized.builder.sign(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION,
        applicationId: pack.applicationId,
        applicationVersion: pack.applicationVersion,
        electronVersion: pack.electronVersion,
        bundleId: PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
        helperBuildId: PORTABLE_ISOLATION_HELPER_BUILD_ID,
        platform: pack.platform,
        architecture: pack.architecture,
        resourceName: PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
        resourceBytes: resource.bytes,
        keyId: credentials.keyId,
        privateKeyPkcs8DerBase64: credentials.encodedKey,
      }));
    } catch (error) {
      if (error instanceof PortableIsolationHelperAfterPackError) throw error;
      if (error instanceof PortableIsolationHelperReleaseAttestationBuildError) {
        fail(error.code);
      }
      fail('RELEASE_SIGNING_FAILED');
    } finally {
      resource.bytes.fill(0);
      target.bytes.fill(0);
    }
    atomicReplace(attestationPath, result.serializedAttestation, target);
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_AFTER_PACK_RECEIPT_VERSION,
      signed: true,
      applicationId: pack.applicationId,
      applicationVersion: pack.applicationVersion,
      electronVersion: pack.electronVersion,
      platform: pack.platform,
      architecture: pack.architecture,
      keyId: result.attestation.manifest.keyId,
      resourceDigest: result.resourceDigest,
      manifestDigest: result.attestation.manifestDigest,
      publicKeyDigest: result.publicKeyDigest,
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_AFTER_PACK_HOOK_VERSION,
    afterPack,
  });
}

async function portableIsolationHelperAfterPack(context) {
  const trust = require('../main/security/portable_isolation_helper_release_trust');
  trust.createPortableIsolationHelperReleaseSignatureVerifier();
  const environment = Object.freeze({
    [FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV]:
      process.env[FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV],
    [FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV]:
      process.env[FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV],
  });
  return createPortableIsolationHelperAfterPackHook({
    trustedKeys: trust.PORTABLE_ISOLATION_HELPER_RELEASE_TRUSTED_KEYS,
    environment,
  }).afterPack(context);
}

module.exports = portableIsolationHelperAfterPack;
module.exports.default = portableIsolationHelperAfterPack;
module.exports.FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV =
  FABER_PORTABLE_ISOLATION_HELPER_RELEASE_KEY_ID_ENV;
module.exports.FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV =
  FABER_PORTABLE_ISOLATION_HELPER_RELEASE_PRIVATE_KEY_ENV;
module.exports.PORTABLE_ISOLATION_HELPER_AFTER_PACK_HOOK_VERSION =
  PORTABLE_ISOLATION_HELPER_AFTER_PACK_HOOK_VERSION;
module.exports.PORTABLE_ISOLATION_HELPER_AFTER_PACK_RECEIPT_VERSION =
  PORTABLE_ISOLATION_HELPER_AFTER_PACK_RECEIPT_VERSION;
module.exports.PortableIsolationHelperAfterPackError =
  PortableIsolationHelperAfterPackError;
module.exports.createPortableIsolationHelperAfterPackHook =
  createPortableIsolationHelperAfterPackHook;
