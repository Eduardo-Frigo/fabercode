'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const {
  PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
  PORTABLE_ISOLATION_HELPER_BUILD_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
  PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
} = require('../capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  createPortableIsolationHelperDistributionTrustedKey,
  createPortableIsolationHelperPlatformSignatureVerifier,
} = require('./portable_isolation_helper_distribution_verifier');

const PORTABLE_ISOLATION_HELPER_DEVELOPMENT_DISTRIBUTION_VERSION =
  'portable-isolation-helper-development-distribution.v1';
const PORTABLE_ISOLATION_HELPER_DEVELOPMENT_DISPOSE_RECEIPT_VERSION =
  'portable-isolation-helper-development-dispose-receipt.v1';
const RESOURCE_DIRECTORY_NAME = 'portable-isolation-helper';
const RESOURCE_ENTRY_NAME = 'utility_entry.js';
const RESOURCE_ATTESTATION_NAME = 'distribution_attestation.json';
const OPTION_KEYS = Object.freeze([
  'applicationVersion',
  'electronVersion',
  'platform',
  'architecture',
  'projectRootPath',
]);
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const SAFE_VERSION = /^[0-9]+[.][0-9]+[.][0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;

class PortableIsolationHelperDevelopmentDistributionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperDevelopmentDistributionError';
    this.code = code;
  }
}

function fail(code) {
  throw new PortableIsolationHelperDevelopmentDistributionError(code);
}

function exactOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail('DEVELOPMENT_DISTRIBUTION_OPTIONS_INVALID');
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail('DEVELOPMENT_DISTRIBUTION_OPTIONS_INVALID');
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))) {
    fail('DEVELOPMENT_DISTRIBUTION_OPTIONS_INVALID');
  }
  const fields = new Map();
  for (const key of OPTION_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      fail('DEVELOPMENT_DISTRIBUTION_OPTIONS_INVALID');
    }
    fields.set(key, descriptor.value);
  }
  const projectRootPath = fields.get('projectRootPath');
  if (!SAFE_VERSION.test(String(fields.get('applicationVersion') || ''))
    || !SAFE_VERSION.test(String(fields.get('electronVersion') || ''))
    || !SUPPORTED_PLATFORMS.has(fields.get('platform'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || typeof projectRootPath !== 'string'
    || !projectRootPath
    || projectRootPath !== projectRootPath.trim()
    || projectRootPath.includes('\0')
    || !path.isAbsolute(projectRootPath)
    || path.resolve(projectRootPath) === path.parse(projectRootPath).root) {
    fail('DEVELOPMENT_DISTRIBUTION_OPTIONS_INVALID');
  }
  return Object.freeze({
    applicationVersion: fields.get('applicationVersion'),
    electronVersion: fields.get('electronVersion'),
    platform: fields.get('platform'),
    architecture: fields.get('architecture'),
    projectRootPath: path.resolve(projectRootPath),
  });
}

function loadBuildOnlyDependencies() {
  const {
    createPortableIsolationHelperBundleBuilder,
  } = require('../../build/portable_isolation_helper_bundle_builder');
  const {
    PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION,
    createPortableIsolationHelperReleaseAttestationBuilder,
  } = require('../../build/portable_isolation_helper_release_attestation_builder');
  return Object.freeze({
    createPortableIsolationHelperBundleBuilder,
    createPortableIsolationHelperReleaseAttestationBuilder,
    signRequestVersion:
      PORTABLE_ISOLATION_HELPER_RELEASE_ATTESTATION_SIGN_REQUEST_VERSION,
  });
}

function syncDirectory(directoryPath) {
  let descriptor;
  try {
    const directoryFlag = typeof fs.constants.O_DIRECTORY === 'number'
      ? fs.constants.O_DIRECTORY
      : 0;
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY | directoryFlag);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeFixedFile(filePath, bytes) {
  let descriptor;
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number'
      ? fs.constants.O_NOFOLLOW
      : 0;
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function exactFileCanBeRemoved(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile()
      && !stat.isSymbolicLink()
      && Number(stat.nlink) === 1
      && fs.realpathSync(filePath) === filePath;
  } catch (error) {
    return Boolean(error && error.code === 'ENOENT');
  }
}

function exactDirectoryCanBeRemoved(directoryPath) {
  try {
    const stat = fs.lstatSync(directoryPath);
    return stat.isDirectory()
      && !stat.isSymbolicLink()
      && fs.realpathSync(directoryPath) === directoryPath;
  } catch (error) {
    return Boolean(error && error.code === 'ENOENT');
  }
}

function removeDevelopmentTree(paths) {
  let removed = true;
  for (const filePath of [paths.entryPath, paths.attestationPath]) {
    try {
      if (!exactFileCanBeRemoved(filePath)) {
        removed = false;
        continue;
      }
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      removed = false;
    }
  }
  for (const directoryPath of [paths.bundleDirectory, paths.resourcesPath]) {
    try {
      if (!exactDirectoryCanBeRemoved(directoryPath)) {
        removed = false;
        continue;
      }
      if (fs.existsSync(directoryPath)) fs.rmdirSync(directoryPath);
    } catch {
      removed = false;
    }
  }
  return removed;
}

function createResourcePaths() {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const resourcesPath = fs.mkdtempSync(
    path.join(temporaryRoot, 'faber-portable-helper-dev-')
  );
  fs.chmodSync(resourcesPath, 0o700);
  const bundleDirectory = path.join(resourcesPath, RESOURCE_DIRECTORY_NAME);
  fs.mkdirSync(bundleDirectory, { mode: 0o700 });
  return Object.freeze({
    resourcesPath,
    bundleDirectory,
    entryPath: path.join(bundleDirectory, RESOURCE_ENTRY_NAME),
    attestationPath: path.join(bundleDirectory, RESOURCE_ATTESTATION_NAME),
  });
}

function createPortableIsolationHelperDevelopmentDistribution(options = {}) {
  const normalized = exactOptions(options);
  const buildOnly = loadBuildOnlyDependencies();
  const paths = createResourcePaths();
  let privateKeyBytes = null;
  let resourceBytes = null;
  let encodedPrivateKey = '';

  try {
    const bundle = buildOnly.createPortableIsolationHelperBundleBuilder({
      projectRootPath: normalized.projectRootPath,
    }).build();
    resourceBytes = Buffer.from(bundle.bundleSource, 'utf8');

    let pair = crypto.generateKeyPairSync('ed25519');
    const publicKeyBytes = pair.publicKey.export({ format: 'der', type: 'spki' });
    privateKeyBytes = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
    encodedPrivateKey = privateKeyBytes.toString('base64');
    const keyId = `faber-development-${crypto.randomBytes(12).toString('hex')}`;
    const trustedKey = createPortableIsolationHelperDistributionTrustedKey({
      keyId,
      platform: normalized.platform,
      architecture: normalized.architecture,
      publicKeySpkiDerBase64: publicKeyBytes.toString('base64'),
    });
    pair = null;

    const trustedKeys = Object.freeze([trustedKey]);
    const signed = buildOnly.createPortableIsolationHelperReleaseAttestationBuilder({
      trustedKeys,
    }).sign(Object.freeze({
      version: buildOnly.signRequestVersion,
      applicationId: PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
      applicationVersion: normalized.applicationVersion,
      electronVersion: normalized.electronVersion,
      bundleId: PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
      helperBuildId: PORTABLE_ISOLATION_HELPER_BUILD_ID,
      platform: normalized.platform,
      architecture: normalized.architecture,
      resourceName: PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
      resourceBytes,
      keyId,
      privateKeyPkcs8DerBase64: encodedPrivateKey,
    }));
    const signatureVerifier = createPortableIsolationHelperPlatformSignatureVerifier({
      trustedKeys,
    });

    writeFixedFile(paths.entryPath, resourceBytes);
    writeFixedFile(
      paths.attestationPath,
      Buffer.from(signed.serializedAttestation, 'utf8')
    );
    syncDirectory(paths.bundleDirectory);
    syncDirectory(paths.resourcesPath);

    let disposeReceipt = null;
    function dispose() {
      if (disposeReceipt) return disposeReceipt;
      disposeReceipt = Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_DEVELOPMENT_DISPOSE_RECEIPT_VERSION,
        disposed: true,
        resourcesRemoved: removeDevelopmentTree(paths),
      });
      return disposeReceipt;
    }

    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_DEVELOPMENT_DISTRIBUTION_VERSION,
      resourcesPath: paths.resourcesPath,
      createSignatureVerifier: () => signatureVerifier,
      dispose,
    });
  } catch (error) {
    removeDevelopmentTree(paths);
    if (error instanceof PortableIsolationHelperDevelopmentDistributionError) {
      throw error;
    }
    fail('DEVELOPMENT_DISTRIBUTION_PREPARATION_FAILED');
  } finally {
    encodedPrivateKey = '';
    if (Buffer.isBuffer(privateKeyBytes)) privateKeyBytes.fill(0);
    if (Buffer.isBuffer(resourceBytes)) resourceBytes.fill(0);
  }
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_DEVELOPMENT_DISTRIBUTION_VERSION,
  PORTABLE_ISOLATION_HELPER_DEVELOPMENT_DISPOSE_RECEIPT_VERSION,
  PortableIsolationHelperDevelopmentDistributionError,
  createPortableIsolationHelperDevelopmentDistribution,
};
