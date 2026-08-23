'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const {
  absorbNativePromise,
} = require('../capabilities/execution_workspace_contract');
const {
  PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
  assertPortableIsolationHelperLaunchRequest,
  createPortableIsolationHelperBundleDescriptor,
  createPortableIsolationHelperLaunchReceipt,
} = require('../capabilities/portable_isolation_helper_launcher_contract');
const {
  PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
  PORTABLE_ISOLATION_HELPER_BUILD_ID,
  PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
  PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
  assertPortableIsolationHelperDistributionAttestation,
} = require('../capabilities/portable_isolation_helper_distribution_attestation_contract');
const {
  immutableSnapshot,
} = require('../capabilities/capability_delegation_contracts');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  openPortableIsolationHelperUtilityChannel,
} = require('./portable_isolation_helper_utility_channel');

const PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_VERSION =
  'portable-isolation-helper-host-launcher.v1';
const PORTABLE_ISOLATION_HELPER_HOST_LAUNCH_RESULT_VERSION =
  'portable-isolation-helper-host-launch-result.v1';
const PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_DISPOSE_RECEIPT_VERSION =
  'portable-isolation-helper-host-launcher-dispose-receipt.v1';

const RESOURCE_DIRECTORY_NAME = 'portable-isolation-helper';
const RESOURCE_ENTRY_NAME = 'utility_entry.js';
const RESOURCE_ATTESTATION_NAME = 'distribution_attestation.json';
const SERVICE_NAME = 'Faber Portable Isolation Helper';
const MAX_RESOURCE_BYTES = 1024 * 1024;
const MAX_ATTESTATION_BYTES = 32 * 1024;
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_VERSION = /^[0-9]+[.][0-9]+[.][0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;
const OPTION_KEYS = Object.freeze([
  'resourcesPath',
  'packaged',
  'platform',
  'architecture',
  'applicationVersion',
  'electronVersion',
  'signatureVerifier',
  'forkUtilityProcess',
  'channelTimeoutMs',
]);
const SIGNATURE_VERIFIER_KEYS = Object.freeze(['version', 'verify']);
const SIGNATURE_RECEIPT_KEYS = Object.freeze([
  'version',
  'verified',
  'distribution',
  'platform',
  'architecture',
  'resourceDigest',
  'signatureIdentityDigest',
]);

class PortableIsolationHelperHostLauncherError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperHostLauncherError';
    this.code = code;
  }
}

function hostError(code) {
  return new PortableIsolationHelperHostLauncherError(code);
}

function exactOwnFields(value, allowedKeys, requiredKeys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) throw hostError(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw hostError(code);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    throw hostError(code);
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      throw hostError(code);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw hostError(code);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function safeDigest(value, code) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw hostError(code);
  return value;
}

function normalizeResourcesPath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.includes('\0') || !path.isAbsolute(value)) {
    throw hostError('HOST_OPTIONS_INVALID');
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw hostError('HOST_OPTIONS_INVALID');
  }
  return resolved;
}

function normalizeSignatureVerifier(value) {
  const fields = exactOwnFields(
    value,
    SIGNATURE_VERIFIER_KEYS,
    SIGNATURE_VERIFIER_KEYS,
    'HOST_OPTIONS_INVALID'
  );
  if (!Object.isFrozen(value)
    || fields.get('version')
      !== PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION
    || typeof fields.get('verify') !== 'function'
    || util.types.isProxy(fields.get('verify'))) {
    throw hostError('HOST_OPTIONS_INVALID');
  }
  return Object.freeze({
    receiver: value,
    verify: fields.get('verify'),
  });
}

function normalizeVersion(value) {
  if (typeof value !== 'string' || !SAFE_VERSION.test(value)) {
    throw hostError('HOST_OPTIONS_INVALID');
  }
  return value;
}

function normalizeOptions(value) {
  const fields = exactOwnFields(
    value,
    OPTION_KEYS,
    OPTION_KEYS,
    'HOST_OPTIONS_INVALID'
  );
  if (typeof fields.get('packaged') !== 'boolean'
    || !SUPPORTED_PLATFORMS.has(fields.get('platform'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || typeof fields.get('forkUtilityProcess') !== 'function'
    || util.types.isProxy(fields.get('forkUtilityProcess'))
    || !Number.isSafeInteger(fields.get('channelTimeoutMs'))
    || fields.get('channelTimeoutMs') < 10
    || fields.get('channelTimeoutMs') > 30_000
    || Object.is(fields.get('channelTimeoutMs'), -0)) {
    throw hostError('HOST_OPTIONS_INVALID');
  }
  return Object.freeze({
    resourcesPath: normalizeResourcesPath(fields.get('resourcesPath')),
    packaged: fields.get('packaged'),
    platform: fields.get('platform'),
    architecture: fields.get('architecture'),
    applicationVersion: normalizeVersion(fields.get('applicationVersion')),
    electronVersion: normalizeVersion(fields.get('electronVersion')),
    signatureVerifier: normalizeSignatureVerifier(fields.get('signatureVerifier')),
    forkUtilityProcess: fields.get('forkUtilityProcess'),
    channelTimeoutMs: fields.get('channelTimeoutMs'),
  });
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function statIdentity(stat) {
  return Object.freeze({
    device: String(stat.dev),
    inode: String(stat.ino),
    mode: Number(stat.mode),
    links: Number(stat.nlink),
    size: Number(stat.size),
    uid: stat.uid === undefined ? '' : String(stat.uid),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
    birthtimeMs: Number(stat.birthtimeMs),
  });
}

function sameIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.links === right.links
    && left.size === right.size
    && left.uid === right.uid
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.birthtimeMs === right.birthtimeMs;
}

function pathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function inspectFixedFile({
  rootRealPath,
  bundleRealPath,
  bundleDirectory,
  fileName,
  maxBytes,
}) {
  const filePath = path.join(bundleDirectory, fileName);
  let fileRealPath;
  let fileStat;
  try {
    fileStat = fs.lstatSync(filePath);
    fileRealPath = fs.realpathSync(filePath);
  } catch (error) {
    absorbNativePromise(error);
    throw hostError('HOST_RESOURCE_INVALID');
  }
  const expectedRealPath = path.join(bundleRealPath, fileName);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()
    || Number(fileStat.nlink) !== 1
    || Number(fileStat.size) < 1
    || Number(fileStat.size) > maxBytes
    || fileRealPath !== expectedRealPath
    || !pathWithin(rootRealPath, fileRealPath)) {
    throw hostError('HOST_RESOURCE_INVALID');
  }

  let descriptor;
  let before;
  let after;
  let contents;
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number'
      ? fs.constants.O_NOFOLLOW
      : 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    before = fs.fstatSync(descriptor);
    contents = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor);
  } catch (error) {
    absorbNativePromise(error);
    throw hostError('HOST_RESOURCE_INVALID');
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        absorbNativePromise(error);
      }
    }
  }
  const lstatIdentity = statIdentity(fileStat);
  const beforeIdentity = statIdentity(before);
  const afterIdentity = statIdentity(after);
  if (!sameIdentity(lstatIdentity, beforeIdentity)
    || !sameIdentity(beforeIdentity, afterIdentity)
    || !Buffer.isBuffer(contents)
    || contents.length !== beforeIdentity.size
    || contents.length < 1
    || contents.length > maxBytes) {
    throw hostError('HOST_RESOURCE_INVALID');
  }
  return Object.freeze({
    filePath,
    digest: sha256Bytes(contents),
    bytes: contents.length,
    identity: beforeIdentity,
    contents,
  });
}

function parseDistributionAttestation(contents) {
  let json;
  let parsed;
  let attestation;
  try {
    json = new util.TextDecoder('utf-8', { fatal: true }).decode(contents);
    if (!json.endsWith('\n') || json.slice(0, -1).includes('\n')) {
      throw hostError('HOST_RESOURCE_INVALID');
    }
    parsed = JSON.parse(json.slice(0, -1));
    attestation = assertPortableIsolationHelperDistributionAttestation(
      immutableSnapshot(parsed)
    );
    if (`${JSON.stringify(attestation)}\n` !== json) {
      throw hostError('HOST_RESOURCE_INVALID');
    }
  } catch (error) {
    absorbNativePromise(error);
    if (error instanceof PortableIsolationHelperHostLauncherError) throw error;
    throw hostError('HOST_RESOURCE_INVALID');
  }
  return attestation;
}

function inspectResource(resourcesPath) {
  const bundleDirectory = path.join(resourcesPath, RESOURCE_DIRECTORY_NAME);
  let rootRealPath;
  let bundleRealPath;
  let bundleStat;
  try {
    rootRealPath = fs.realpathSync(resourcesPath);
    bundleStat = fs.lstatSync(bundleDirectory);
    bundleRealPath = fs.realpathSync(bundleDirectory);
  } catch (error) {
    absorbNativePromise(error);
    throw hostError('HOST_RESOURCE_INVALID');
  }
  const expectedBundleRealPath = path.join(rootRealPath, RESOURCE_DIRECTORY_NAME);
  if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink()
    || bundleRealPath !== expectedBundleRealPath
    || !pathWithin(rootRealPath, bundleRealPath)) {
    throw hostError('HOST_RESOURCE_INVALID');
  }
  const entry = inspectFixedFile({
    rootRealPath,
    bundleRealPath,
    bundleDirectory,
    fileName: RESOURCE_ENTRY_NAME,
    maxBytes: MAX_RESOURCE_BYTES,
  });
  const attestationFile = inspectFixedFile({
    rootRealPath,
    bundleRealPath,
    bundleDirectory,
    fileName: RESOURCE_ATTESTATION_NAME,
    maxBytes: MAX_ATTESTATION_BYTES,
  });
  const attestation = parseDistributionAttestation(attestationFile.contents);
  return Object.freeze({
    bundleDirectory,
    entryPath: entry.filePath,
    resourceDigest: entry.digest,
    resourceBytes: entry.bytes,
    identity: entry.identity,
    attestationPath: attestationFile.filePath,
    attestationDigest: attestationFile.digest,
    attestationBytes: attestationFile.bytes,
    attestationIdentity: attestationFile.identity,
    attestation,
  });
}

function sameResource(left, right) {
  return left.entryPath === right.entryPath
    && left.resourceDigest === right.resourceDigest
    && left.resourceBytes === right.resourceBytes
    && sameIdentity(left.identity, right.identity)
    && left.attestationPath === right.attestationPath
    && left.attestationDigest === right.attestationDigest
    && left.attestationBytes === right.attestationBytes
    && left.attestation.manifestDigest === right.attestation.manifestDigest
    && sameIdentity(left.attestationIdentity, right.attestationIdentity);
}

function settledOutcome(value) {
  if (!util.types.isPromise(value)) {
    return Promise.resolve(Object.freeze({ ok: true, value }));
  }
  return new Promise((resolve) => {
    const fulfilled = (resolvedValue) => resolve(Object.freeze({
      ok: true,
      value: resolvedValue,
    }));
    const rejected = (reason) => {
      absorbNativePromise(reason);
      resolve(Object.freeze({ ok: false, value: null }));
    };
    try {
      Reflect.apply(Promise.prototype.then, value, [fulfilled, rejected]);
    } catch (error) {
      absorbNativePromise(error);
      resolve(Object.freeze({ ok: false, value: null }));
    }
  });
}

function signatureRequest(resource, options) {
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    applicationId: PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
    applicationVersion: options.applicationVersion,
    electronVersion: options.electronVersion,
    bundleId: PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
    helperBuildId: PORTABLE_ISOLATION_HELPER_BUILD_ID,
    platform: options.platform,
    architecture: options.architecture,
    resourcePath: resource.entryPath,
    resourceName: PORTABLE_ISOLATION_HELPER_RESOURCE_NAME,
    resourceDigest: resource.resourceDigest,
    resourceBytes: resource.resourceBytes,
    attestation: resource.attestation,
  });
}

function normalizeSignatureReceipt(value, request) {
  const fields = exactOwnFields(
    value,
    SIGNATURE_RECEIPT_KEYS,
    SIGNATURE_RECEIPT_KEYS,
    'HOST_SIGNATURE_REJECTED'
  );
  if (!Object.isFrozen(value)
    || fields.get('version')
      !== PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION
    || fields.get('verified') !== true
    || fields.get('distribution') !== PORTABLE_ISOLATION_HELPER_DISTRIBUTION
    || fields.get('platform') !== request.platform
    || fields.get('architecture') !== request.architecture
    || fields.get('resourceDigest') !== request.resourceDigest) {
    throw hostError('HOST_SIGNATURE_REJECTED');
  }
  return Object.freeze({
    signatureIdentityDigest: safeDigest(
      fields.get('signatureIdentityDigest'),
      'HOST_SIGNATURE_REJECTED'
    ),
  });
}

function bundleIdentityDigest(resource, signature, options) {
  return canonicalSha256Digest({
    version: 'portable-isolation-helper-host-bundle-identity.v1',
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    transport: PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
    applicationId: PORTABLE_ISOLATION_HELPER_APPLICATION_ID,
    applicationVersion: options.applicationVersion,
    electronVersion: options.electronVersion,
    bundleId: PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
    helperBuildId: PORTABLE_ISOLATION_HELPER_BUILD_ID,
    platform: options.platform,
    architecture: options.architecture,
    resourceDigest: resource.resourceDigest,
    resourceBytes: resource.resourceBytes,
    attestationDigest: resource.attestationDigest,
    manifestDigest: resource.attestation.manifestDigest,
    signatureIdentityDigest: signature.signatureIdentityDigest,
  });
}

function launchRequestMatchesDescriptor(request, descriptor) {
  return request.bundleId === descriptor.bundleId
    && request.helperBuildId === descriptor.helperBuildId
    && request.bundleIdentityDigest === descriptor.bundleIdentityDigest
    && request.descriptorDigest === descriptor.descriptorDigest
    && request.distribution === descriptor.distribution
    && request.transport === descriptor.transport
    && request.requirementsDigest === descriptor.requirementsDigest
    && request.platform.os === descriptor.platform.os
    && request.platform.architecture === descriptor.platform.architecture
    && request.platform.signatureVerification
      === descriptor.platform.signatureVerification
    && request.platform.signatureIdentityDigest
      === descriptor.platform.signatureIdentityDigest;
}

function createPortableIsolationHelperHostLauncher(options = {}) {
  const normalized = normalizeOptions(options);
  let state = 'idle';
  let inspectionPromise = null;
  let descriptor = null;
  let inspectedResource = null;
  let signatureVerified = false;
  let launchUsed = false;
  let activeChannel = null;
  let launchPromise = null;
  let disposePromise = null;
  let channelClosePromise = null;
  let disposeResult = null;
  let disposeRequested = false;

  function inspect() {
    if (disposeRequested || state === 'disposed') {
      return Promise.reject(hostError('HOST_DISPOSED'));
    }
    if (!normalized.packaged) {
      state = 'quarantined';
      inspectionPromise = Promise.reject(hostError('HOST_PACKAGED_APP_REQUIRED'));
      return inspectionPromise;
    }
    if (inspectionPromise) return inspectionPromise;
    state = 'inspecting';
    inspectionPromise = Promise.resolve().then(() => {
      if (disposeRequested) throw hostError('HOST_DISPOSED');
      const before = inspectResource(normalized.resourcesPath);
      const request = signatureRequest(before, normalized);
      let rawReceipt;
      try {
        rawReceipt = Reflect.apply(
          normalized.signatureVerifier.verify,
          normalized.signatureVerifier.receiver,
          [request]
        );
      } catch (error) {
        absorbNativePromise(error);
        throw hostError('HOST_SIGNATURE_REJECTED');
      }
      return settledOutcome(rawReceipt).then((outcome) => {
        if (disposeRequested) throw hostError('HOST_DISPOSED');
        if (!outcome.ok) throw hostError('HOST_SIGNATURE_REJECTED');
        const signature = normalizeSignatureReceipt(outcome.value, request);
        const after = inspectResource(normalized.resourcesPath);
        if (disposeRequested) throw hostError('HOST_DISPOSED');
        if (!sameResource(before, after)) throw hostError('HOST_RESOURCE_CHANGED');
        inspectedResource = after;
        signatureVerified = true;
        descriptor = createPortableIsolationHelperBundleDescriptor({
          bundleId: PORTABLE_ISOLATION_HELPER_BUNDLE_ID,
          helperBuildId: PORTABLE_ISOLATION_HELPER_BUILD_ID,
          bundleIdentityDigest: bundleIdentityDigest(
            after,
            signature,
            normalized
          ),
          platform: {
            os: normalized.platform,
            architecture: normalized.architecture,
            signatureVerification: 'platform_verified',
            signatureIdentityDigest: signature.signatureIdentityDigest,
          },
        });
        state = disposeRequested ? 'disposed' : 'ready';
        if (disposeRequested) throw hostError('HOST_DISPOSED');
        return descriptor;
      });
    }).catch((error) => {
      state = disposeRequested ? 'disposed' : 'quarantined';
      if (error instanceof PortableIsolationHelperHostLauncherError) throw error;
      absorbNativePromise(error);
      throw hostError('HOST_INSPECTION_FAILED');
    });
    return inspectionPromise;
  }

  function randomChannelBindingDigest() {
    try {
      return `sha256:${crypto.randomBytes(32).toString('hex')}`;
    } catch (error) {
      absorbNativePromise(error);
      throw hostError('HOST_RANDOMNESS_UNAVAILABLE');
    }
  }

  function forkOptions(resource) {
    return {
      cwd: resource.bundleDirectory,
      env: {},
      execArgv: [],
      stdio: 'ignore',
      serviceName: SERVICE_NAME,
      allowLoadingUnsignedLibraries: false,
      disclaim: false,
    };
  }

  function finishDispose(channelClosed) {
    if (disposeResult) return disposeResult;
    activeChannel = null;
    state = 'disposed';
    disposeResult = Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_DISPOSE_RECEIPT_VERSION,
      disposed: true,
      channelClosed,
    });
    return disposeResult;
  }

  function closeActiveChannel() {
    if (disposeResult) return Promise.resolve(disposeResult);
    if (channelClosePromise) return channelClosePromise;
    const channel = activeChannel;
    if (!channel) return Promise.resolve(finishDispose(false));
    let raw;
    try {
      raw = Reflect.apply(channel.dispose, channel, []);
    } catch (error) {
      absorbNativePromise(error);
      state = 'quarantined';
      return Promise.reject(hostError('HOST_DISPOSE_FAILED'));
    }
    channelClosePromise = settledOutcome(raw).then((outcome) => {
      if (!outcome.ok || !outcome.value
        || outcome.value.closed !== true
        || outcome.value.helperExited !== true
        || outcome.value.orphaned !== 0) {
        state = 'quarantined';
        throw hostError('HOST_DISPOSE_FAILED');
      }
      return finishDispose(true);
    });
    return channelClosePromise;
  }

  function launch(requestValue) {
    if (launchUsed || launchPromise) {
      return Promise.reject(hostError('HOST_LAUNCH_ALREADY_USED'));
    }
    if (disposeRequested || state === 'disposed' || disposePromise) {
      return Promise.reject(hostError('HOST_DISPOSED'));
    }
    launchPromise = inspect().then(() => {
      if (disposeRequested) throw hostError('HOST_DISPOSED');
      let request;
      try {
        request = assertPortableIsolationHelperLaunchRequest(requestValue);
      } catch (error) {
        absorbNativePromise(error);
        launchPromise = null;
        throw hostError('HOST_LAUNCH_REQUEST_REJECTED');
      }
      if (!launchRequestMatchesDescriptor(request, descriptor)) {
        launchPromise = null;
        throw hostError('HOST_LAUNCH_REQUEST_REJECTED');
      }
      if (disposeRequested) throw hostError('HOST_DISPOSED');
      const currentResource = inspectResource(normalized.resourcesPath);
      if (!sameResource(inspectedResource, currentResource)) {
        state = 'quarantined';
        throw hostError('HOST_RESOURCE_CHANGED');
      }
      if (disposeRequested) throw hostError('HOST_DISPOSED');
      launchUsed = true;
      state = 'launching';
      const channelBindingDigest = randomChannelBindingDigest();
      const launchReceipt = createPortableIsolationHelperLaunchReceipt({
        request,
        channelBindingDigest,
      });
      let utilityProcess;
      try {
        utilityProcess = Reflect.apply(normalized.forkUtilityProcess, null, [
          currentResource.entryPath,
          [],
          forkOptions(currentResource),
        ]);
      } catch (error) {
        absorbNativePromise(error);
        state = 'quarantined';
        throw hostError('HOST_PROCESS_LAUNCH_FAILED');
      }
      if (util.types.isPromise(utilityProcess)) {
        absorbNativePromise(utilityProcess);
        state = 'quarantined';
        throw hostError('HOST_PROCESS_LAUNCH_FAILED');
      }
      return openPortableIsolationHelperUtilityChannel({
        utilityProcess,
        runtimeBinding: Object.freeze({
          helperId: descriptor.bundleId,
          helperBuildId: descriptor.helperBuildId,
          bundleIdentityDigest: descriptor.bundleIdentityDigest,
          platform: Object.freeze({
            os: descriptor.platform.os,
            architecture: descriptor.platform.architecture,
            signatureVerification:
              descriptor.platform.signatureVerification,
          }),
        }),
        channelBindingDigest,
        timeoutMs: normalized.channelTimeoutMs,
      }).then((channel) => {
        activeChannel = channel;
        if (disposeRequested) {
          state = 'disposing';
          return closeActiveChannel().then(() => {
            throw hostError('HOST_DISPOSED');
          });
        }
        state = 'active';
        return Object.freeze({
          version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCH_RESULT_VERSION,
          launchReceipt,
          channel,
        });
      }, (error) => {
        absorbNativePromise(error);
        state = disposeRequested ? 'disposing' : 'quarantined';
        if (disposeRequested) throw hostError('HOST_DISPOSED');
        throw hostError('HOST_CHANNEL_OPEN_FAILED');
      });
    });
    return launchPromise;
  }

  function dispose() {
    if (disposePromise) return disposePromise;
    if (disposeResult) return Promise.resolve(disposeResult);
    if (state === 'disposed') return Promise.resolve(disposeResult);
    disposeRequested = true;
    state = 'disposing';
    const inFlightLaunch = launchPromise;
    disposePromise = Promise.resolve().then(() => (
      inFlightLaunch ? settledOutcome(inFlightLaunch) : null
    )).then(() => (
      disposeResult || closeActiveChannel()
    ));
    return disposePromise;
  }

  function diagnostics() {
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_VERSION,
      state,
      inspected: Boolean(descriptor),
      signatureVerified,
      launched: launchUsed,
      activeChannel: Boolean(activeChannel),
    });
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_VERSION,
    inspect,
    launch,
    diagnostics,
    dispose,
  });
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_HOST_LAUNCHER_VERSION,
  PORTABLE_ISOLATION_HELPER_HOST_LAUNCH_RESULT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION,
  PortableIsolationHelperHostLauncherError,
  createPortableIsolationHelperHostLauncher,
};
