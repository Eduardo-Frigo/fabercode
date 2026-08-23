'use strict';

const crypto = require('crypto');
const path = require('path');
const util = require('util');

const {
  preflightDataGraph,
} = require('../capabilities/execution_workspace_contract');
const {
  createPortableIsolationHelperLaunchRequest,
} = require('../capabilities/portable_isolation_helper_launcher_contract');
const {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
} = require('../runtime/execution_isolation_runtime_config');
const {
  createPortableIsolationHelperReleaseSignatureVerifier,
} = require('../security/portable_isolation_helper_release_trust');
const {
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
  createExecutionIsolationProviderSelection,
} = require('./execution_isolation_provider_factory');
const {
  createPortableIsolationHelperClient,
} = require('./portable_isolation_helper_client');
const {
  createPortableIsolationHelperHostLauncher,
} = require('./portable_isolation_helper_host_launcher');
const {
  createPortableIsolationHelperPrivateTransport,
} = require('./portable_isolation_helper_private_transport');
const {
  createPortableIsolationHelperProviderAdapter,
} = require('./portable_isolation_helper_provider_adapter');

const PORTABLE_ISOLATION_HELPER_ACTIVATION_RUNTIME_VERSION =
  'portable-isolation-helper-activation-runtime.v1';
const PORTABLE_ISOLATION_HELPER_ACTIVATION_DISPOSE_RECEIPT_VERSION =
  'portable-isolation-helper-activation-dispose-receipt.v1';

const OPTION_KEYS = Object.freeze([
  'config',
  'resourcesPath',
  'packaged',
  'platform',
  'architecture',
  'applicationVersion',
  'electronVersion',
  'createSignatureVerifier',
  'forkUtilityProcess',
  'channelTimeoutMs',
]);
const PRODUCTION_OPTION_KEYS = Object.freeze(
  OPTION_KEYS.filter((key) => key !== 'createSignatureVerifier')
);
const CONFIG_KEYS = Object.freeze(['version', 'mode', 'killSwitch']);
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64']);
const SAFE_VERSION = /^[0-9]+[.][0-9]+[.][0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const LAUNCH_REQUEST_ID = 'portable-main-activation-1';
const CLIENT_ID = 'faber-main-runtime';

class PortableIsolationHelperActivationRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableIsolationHelperActivationRuntimeError';
    this.code = code;
  }
}

function activationError(code) {
  return new PortableIsolationHelperActivationRuntimeError(code);
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // Never consult a userland thenable fallback.
  }
  return true;
}

function exactOwnDataFields(value, allowedKeys, requiredKeys, code) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) throw activationError(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw activationError(code);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    throw activationError(code);
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      absorbNativePromise(error);
      throw activationError(code);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      throw activationError(code);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeConfig(value) {
  const fields = exactOwnDataFields(
    value,
    CONFIG_KEYS,
    CONFIG_KEYS,
    'ACTIVATION_OPTIONS_INVALID'
  );
  if (fields.get('version') !== EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION
    || !['disabled', 'enabled'].includes(fields.get('mode'))
    || typeof fields.get('killSwitch') !== 'boolean') {
    throw activationError('ACTIVATION_OPTIONS_INVALID');
  }
  return Object.freeze({
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode: fields.get('mode'),
    killSwitch: fields.get('killSwitch'),
  });
}

function normalizeResourcesPath(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.includes('\0') || !path.isAbsolute(value)) {
    throw activationError('ACTIVATION_OPTIONS_INVALID');
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw activationError('ACTIVATION_OPTIONS_INVALID');
  }
  return resolved;
}

function normalizeVersion(value) {
  if (typeof value !== 'string' || !SAFE_VERSION.test(value)) {
    throw activationError('ACTIVATION_OPTIONS_INVALID');
  }
  return value;
}

function normalizeOptions(value, { production = false } = {}) {
  const allowedKeys = production ? PRODUCTION_OPTION_KEYS : OPTION_KEYS;
  const fields = exactOwnDataFields(
    value,
    allowedKeys,
    allowedKeys,
    'ACTIVATION_OPTIONS_INVALID'
  );
  const createSignatureVerifier = production
    ? createPortableIsolationHelperReleaseSignatureVerifier
    : fields.get('createSignatureVerifier');
  const forkUtilityProcess = fields.get('forkUtilityProcess');
  if (typeof fields.get('packaged') !== 'boolean'
    || !SUPPORTED_PLATFORMS.has(fields.get('platform'))
    || !SUPPORTED_ARCHITECTURES.has(fields.get('architecture'))
    || typeof createSignatureVerifier !== 'function'
    || util.types.isProxy(createSignatureVerifier)
    || typeof forkUtilityProcess !== 'function'
    || util.types.isProxy(forkUtilityProcess)
    || !Number.isSafeInteger(fields.get('channelTimeoutMs'))
    || fields.get('channelTimeoutMs') < 10
    || fields.get('channelTimeoutMs') > 30_000
    || Object.is(fields.get('channelTimeoutMs'), -0)) {
    throw activationError('ACTIVATION_OPTIONS_INVALID');
  }
  return Object.freeze({
    config: normalizeConfig(fields.get('config')),
    resourcesPath: normalizeResourcesPath(fields.get('resourcesPath')),
    packaged: fields.get('packaged'),
    platform: fields.get('platform'),
    architecture: fields.get('architecture'),
    applicationVersion: normalizeVersion(fields.get('applicationVersion')),
    electronVersion: normalizeVersion(fields.get('electronVersion')),
    createSignatureVerifier,
    forkUtilityProcess,
    channelTimeoutMs: fields.get('channelTimeoutMs'),
  });
}

function safeErrorCode(value, fallback = 'ACTIVATION_FAILED') {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return fallback;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, 'code');
  } catch {
    return fallback;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'string'
    || !SAFE_REASON_CODE.test(descriptor.value)) return fallback;
  return descriptor.value;
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

function captureMethod(receiver, name) {
  if (!receiver || typeof receiver !== 'object' || util.types.isProxy(receiver)) {
    return null;
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(receiver, name);
  } catch {
    return null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || util.types.isProxy(descriptor.value)) return null;
  return Object.freeze({ receiver, method: descriptor.value });
}

function invokeCaptured(captured, args = []) {
  if (!captured) return Promise.resolve(Object.freeze({ ok: true, value: null }));
  let raw;
  try {
    raw = Reflect.apply(captured.method, captured.receiver, args);
  } catch (error) {
    absorbNativePromise(error);
    return Promise.resolve(Object.freeze({ ok: false, value: null }));
  }
  return settledOutcome(raw);
}

function selectionDiagnostics(selection) {
  if (!selection || typeof selection !== 'object' || util.types.isProxy(selection)) {
    return null;
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(selection, 'diagnostics');
  } catch {
    return null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
  const value = descriptor.value;
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) return null;
  const status = Object.getOwnPropertyDescriptor(value, 'status');
  const reasonCode = Object.getOwnPropertyDescriptor(value, 'reasonCode');
  if (!status || !reasonCode
    || !Object.hasOwn(status, 'value') || !Object.hasOwn(reasonCode, 'value')
    || !['unsupported', 'enforced'].includes(status.value)
    || typeof reasonCode.value !== 'string'
    || !SAFE_REASON_CODE.test(reasonCode.value)) return null;
  return Object.freeze({ status: status.value, reasonCode: reasonCode.value });
}

function createPortableIsolationHelperActivationRuntimeFromNormalized(normalized) {
  let state = 'idle';
  let selection = null;
  let selectionStatus = null;
  let activationBlockReason = null;
  let helperLaunched = false;
  let cleanupConfirmed = true;
  let launcher = null;
  let transport = null;
  let client = null;
  let adapter = null;
  let startPromise = null;
  let cleanupPromise = null;
  let disposePromise = null;
  let disposeReceipt = null;

  function setSelection(value) {
    selection = value;
    const detail = selectionDiagnostics(value);
    selectionStatus = detail ? detail.status : 'unsupported';
    return detail;
  }

  function unsupportedSelection() {
    return createExecutionIsolationProviderSelection({
      config: normalized.config,
    });
  }

  function blockedByRuntimeConfig() {
    const detail = setSelection(unsupportedSelection());
    activationBlockReason = detail ? detail.reasonCode : 'ACTIVATION_FAILED';
    cleanupConfirmed = true;
    state = 'blocked';
    return selection;
  }

  function randomClientNonce() {
    try {
      return crypto.randomBytes(32).toString('hex');
    } catch (error) {
      absorbNativePromise(error);
      throw activationError('ACTIVATION_RANDOMNESS_UNAVAILABLE');
    }
  }

  function cleanupResources() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = Promise.resolve().then(async () => {
      let confirmed = true;
      const selectionDispose = captureMethod(selection, 'dispose');
      const selectionOutcome = await invokeCaptured(selectionDispose);
      if (selectionDispose && (
        !selectionOutcome.ok
        || !selectionOutcome.value
        || selectionOutcome.value.ok !== true
        || selectionOutcome.value.disposed !== true
      )) confirmed = false;

      let lifecycleKind = null;
      let lifecycleOutcome = Object.freeze({ ok: true, value: null });
      if (adapter) {
        lifecycleKind = 'adapter';
        lifecycleOutcome = await invokeCaptured(captureMethod(adapter, 'dispose'));
        if (!lifecycleOutcome.ok) confirmed = false;
      } else if (client) {
        lifecycleKind = 'client';
        lifecycleOutcome = await invokeCaptured(captureMethod(client, 'dispose'));
        if (!lifecycleOutcome.ok) confirmed = false;
      } else if (transport) {
        lifecycleKind = 'transport';
        lifecycleOutcome = await invokeCaptured(captureMethod(transport, 'dispose'));
        if (!lifecycleOutcome.ok) confirmed = false;
      }

      const launcherOutcome = await invokeCaptured(captureMethod(launcher, 'dispose'));
      if (!launcherOutcome.ok) confirmed = false;
      if (helperLaunched) {
        const lifecycleReceipt = lifecycleOutcome.value;
        const launcherReceipt = launcherOutcome.value;
        let lifecycleConfirmed = lifecycleKind === null;
        if (lifecycleKind === 'adapter' || lifecycleKind === 'client') {
          lifecycleConfirmed = lifecycleReceipt
            && lifecycleReceipt.disposed === true
            && lifecycleReceipt.helperShutdownConfirmed === true
            && lifecycleReceipt.transportClosed === true;
        } else if (lifecycleKind === 'transport') {
          lifecycleConfirmed = lifecycleReceipt
            && lifecycleReceipt.closed === true;
        }
        const launcherConfirmed = launcherReceipt
          && launcherReceipt.disposed === true
          && launcherReceipt.channelClosed === true;
        if (!lifecycleConfirmed || !launcherConfirmed) confirmed = false;
      }
      cleanupConfirmed = confirmed;
      return confirmed;
    });
    return cleanupPromise;
  }

  function failClosed(error) {
    activationBlockReason = safeErrorCode(error);
    state = 'quarantining';
    return cleanupResources().then(() => {
      setSelection(unsupportedSelection());
      state = 'blocked';
      return selection;
    });
  }

  function activate() {
    if (normalized.config.mode !== 'enabled' || normalized.config.killSwitch) {
      return Promise.resolve(blockedByRuntimeConfig());
    }
    state = 'starting';
    cleanupConfirmed = false;
    return Promise.resolve().then(async () => {
      let signatureVerifier;
      try {
        signatureVerifier = Reflect.apply(
          normalized.createSignatureVerifier,
          undefined,
          []
        );
      } catch (error) {
        throw error;
      }
      if (util.types.isPromise(signatureVerifier)) {
        absorbNativePromise(signatureVerifier);
        throw activationError('ACTIVATION_SIGNATURE_VERIFIER_INVALID');
      }
      launcher = createPortableIsolationHelperHostLauncher({
        resourcesPath: normalized.resourcesPath,
        packaged: normalized.packaged,
        platform: normalized.platform,
        architecture: normalized.architecture,
        applicationVersion: normalized.applicationVersion,
        electronVersion: normalized.electronVersion,
        signatureVerifier,
        forkUtilityProcess: normalized.forkUtilityProcess,
        channelTimeoutMs: normalized.channelTimeoutMs,
      });
      const descriptor = await launcher.inspect();
      const launchRequest = createPortableIsolationHelperLaunchRequest({
        requestId: LAUNCH_REQUEST_ID,
        bundle: descriptor,
      });
      const launchResult = await launcher.launch(launchRequest);
      helperLaunched = true;
      transport = createPortableIsolationHelperPrivateTransport({
        channel: launchResult.channel,
        launchRequest,
        launchReceipt: launchResult.launchReceipt,
      });
      client = createPortableIsolationHelperClient({
        transport,
        handshake: {
          clientId: CLIENT_ID,
          clientNonce: randomClientNonce(),
          expectedBundleIdentityDigest: descriptor.bundleIdentityDigest,
          providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
          attestationVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
        },
      });
      adapter = createPortableIsolationHelperProviderAdapter({ client });
      const candidate = await adapter.connect();
      const activatedSelection = createExecutionIsolationProviderSelection({
        config: normalized.config,
        providerFactory: () => candidate.provider,
      });
      const detail = setSelection(activatedSelection);
      if (!detail || detail.status !== 'enforced') {
        throw activationError('ACTIVATION_PROVIDER_REJECTED');
      }
      activationBlockReason = null;
      state = 'active';
      return selection;
    }).catch(failClosed);
  }

  function start() {
    if (startPromise) return startPromise;
    if (disposePromise || state === 'disposed') {
      if (!selection) setSelection(unsupportedSelection());
      return Promise.resolve(selection);
    }
    startPromise = activate();
    return startPromise;
  }

  function diagnostics() {
    return Object.freeze({
      version: PORTABLE_ISOLATION_HELPER_ACTIVATION_RUNTIME_VERSION,
      state,
      mode: normalized.config.mode,
      killSwitch: normalized.config.killSwitch,
      selectionStatus,
      activationBlockReason,
      helperLaunched,
      cleanupConfirmed,
    });
  }

  function dispose() {
    if (disposePromise) return disposePromise;
    if (disposeReceipt) return Promise.resolve(disposeReceipt);
    state = 'disposing';
    const pendingStart = startPromise;
    disposePromise = Promise.resolve().then(async () => {
      if (pendingStart) await settledOutcome(pendingStart);
      const confirmed = await cleanupResources();
      state = 'disposed';
      disposeReceipt = Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_ACTIVATION_DISPOSE_RECEIPT_VERSION,
        disposed: true,
        zeroOrphanShutdownConfirmed: confirmed,
      });
      return disposeReceipt;
    });
    return disposePromise;
  }

  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_ACTIVATION_RUNTIME_VERSION,
    start,
    diagnostics,
    dispose,
  });
}

function createPortableIsolationHelperActivationRuntime(options = {}) {
  return createPortableIsolationHelperActivationRuntimeFromNormalized(
    normalizeOptions(options)
  );
}

function createProductionPortableIsolationHelperActivationRuntime(options = {}) {
  return createPortableIsolationHelperActivationRuntimeFromNormalized(
    normalizeOptions(options, { production: true })
  );
}

module.exports = {
  PORTABLE_ISOLATION_HELPER_ACTIVATION_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_ACTIVATION_RUNTIME_VERSION,
  PortableIsolationHelperActivationRuntimeError,
  createPortableIsolationHelperActivationRuntime,
  createProductionPortableIsolationHelperActivationRuntime,
};
