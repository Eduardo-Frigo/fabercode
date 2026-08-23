'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const {
  absorbNativePromise,
} = require('../capabilities/execution_workspace_contract');
const {
  PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
  PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
  assertPortableIsolationHelperLaunchRequest,
  createPortableIsolationHelperBundleDescriptor,
  createPortableIsolationHelperLaunchReceipt,
} = require('../capabilities/portable_isolation_helper_launcher_contract');
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
const PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_VERIFIER_VERSION =
  'portable-isolation-helper-platform-signature-verifier.v1';
const PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION =
  'portable-isolation-helper-platform-signature-request.v1';
const PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_RECEIPT_VERSION =
  'portable-isolation-helper-platform-signature-receipt.v1';

const BUNDLE_ID = 'faber-portable-isolation-helper';
const HELPER_BUILD_ID = 'portable-helper-bootstrap-1';
const RESOURCE_DIRECTORY_NAME = 'portable-isolation-helper';
const RESOURCE_ENTRY_NAME = 'utility_entry.js';
const SERVICE_NAME = 'Faber Portable Isolation Helper';
const MAX_RESOURCE_BYTES = 1024 * 1024;
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const OPTION_KEYS = Object.freeze([
  'resourcesPath',
  'packaged',
  'platform',
  'architecture',
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

function inspectResource(resourcesPath) {
  const bundleDirectory = path.join(resourcesPath, RESOURCE_DIRECTORY_NAME);
  const entryPath = path.join(bundleDirectory, RESOURCE_ENTRY_NAME);
  let rootRealPath;
  let bundleRealPath;
  let entryRealPath;
  let bundleStat;
  let entryStat;
  try {
    rootRealPath = fs.realpathSync(resourcesPath);
    bundleStat = fs.lstatSync(bundleDirectory);
    entryStat = fs.lstatSync(entryPath);
    bundleRealPath = fs.realpathSync(bundleDirectory);
    entryRealPath = fs.realpathSync(entryPath);
  } catch (error) {
    absorbNativePromise(error);
    throw hostError('HOST_RESOURCE_INVALID');
  }
  const expectedBundleRealPath = path.join(rootRealPath, RESOURCE_DIRECTORY_NAME);
  const expectedEntryRealPath = path.join(expectedBundleRealPath, RESOURCE_ENTRY_NAME);
  if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink()
    || !entryStat.isFile() || entryStat.isSymbolicLink()
    || Number(entryStat.nlink) !== 1
    || Number(entryStat.size) < 1
    || Number(entryStat.size) > MAX_RESOURCE_BYTES
    || bundleRealPath !== expectedBundleRealPath
    || entryRealPath !== expectedEntryRealPath
    || !pathWithin(rootRealPath, entryRealPath)) {
    throw hostError('HOST_RESOURCE_INVALID');
  }

  let descriptor;
  let before;
  let after;
  let bytes;
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number'
      ? fs.constants.O_NOFOLLOW
      : 0;
    descriptor = fs.openSync(entryPath, fs.constants.O_RDONLY | noFollow);
    before = fs.fstatSync(descriptor);
    bytes = fs.readFileSync(descriptor);
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
  const lstatIdentity = statIdentity(entryStat);
  const beforeIdentity = statIdentity(before);
  const afterIdentity = statIdentity(after);
  if (!sameIdentity(lstatIdentity, beforeIdentity)
    || !sameIdentity(beforeIdentity, afterIdentity)
    || !Buffer.isBuffer(bytes)
    || bytes.length !== beforeIdentity.size
    || bytes.length < 1
    || bytes.length > MAX_RESOURCE_BYTES) {
    throw hostError('HOST_RESOURCE_INVALID');
  }
  return Object.freeze({
    bundleDirectory,
    entryPath,
    resourceDigest: sha256Bytes(bytes),
    resourceBytes: bytes.length,
    identity: beforeIdentity,
  });
}

function sameResource(left, right) {
  return left.entryPath === right.entryPath
    && left.resourceDigest === right.resourceDigest
    && left.resourceBytes === right.resourceBytes
    && sameIdentity(left.identity, right.identity);
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

function signatureRequest(resource, platform, architecture) {
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_PLATFORM_SIGNATURE_REQUEST_VERSION,
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    bundleId: BUNDLE_ID,
    helperBuildId: HELPER_BUILD_ID,
    platform,
    architecture,
    resourcePath: resource.entryPath,
    resourceDigest: resource.resourceDigest,
    resourceBytes: resource.resourceBytes,
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

function bundleIdentityDigest(resource, signature, platform, architecture) {
  return canonicalSha256Digest({
    version: 'portable-isolation-helper-host-bundle-identity.v1',
    distribution: PORTABLE_ISOLATION_HELPER_DISTRIBUTION,
    transport: PORTABLE_ISOLATION_HELPER_PRIVATE_TRANSPORT_KIND,
    bundleId: BUNDLE_ID,
    helperBuildId: HELPER_BUILD_ID,
    platform,
    architecture,
    resourceDigest: resource.resourceDigest,
    resourceBytes: resource.resourceBytes,
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
      const request = signatureRequest(
        before,
        normalized.platform,
        normalized.architecture
      );
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
          bundleId: BUNDLE_ID,
          helperBuildId: HELPER_BUILD_ID,
          bundleIdentityDigest: bundleIdentityDigest(
            after,
            signature,
            normalized.platform,
            normalized.architecture
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
