'use strict';

const path = require('path');
const util = require('util');

const {
  CODEX_APP_SERVER_PINNED_CLI_VERSION,
  CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION,
} = require('../agent_runtime/codex_app_server_shadow_protocol');
const {
  HARNESS_RUNTIME_CONFIG_VERSION,
  HARNESS_RUNTIME_MODES,
} = require('../agent_runtime/harness_runtime_config');
const {
  CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS,
  CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION,
} = require('../runtime/codex_app_server_runtime_config');
const {
  createCodexAppServerStdioClient,
} = require('./codex_app_server_stdio_client');

const CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_VERSION =
  'codex-app-server-production-client-activation.v1';
const CODEX_APP_SERVER_PRODUCTION_CLIENT_SELECTION_SCHEMA_VERSION =
  'codex-app-server-production-client-selection.v1';

const CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES = Object.freeze({
  BLOCKED: 'blocked',
  DISABLED: 'disabled',
  IDLE: 'idle',
  READY: 'ready',
  STARTING: 'starting',
});

const CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS = Object.freeze({
  READY: 'ready',
  PENDING: 'pending',
  MODE_NOT_APP_SERVER: 'mode_not_app_server',
  CLIENT_CONSTRUCTION_FAILED: 'client_construction_failed',
  CLIENT_START_FAILED: 'client_start_failed',
  CLIENT_NOT_READY: 'client_not_ready',
  CLIENT_CLEANUP_FAILED: 'client_cleanup_failed',
});

const OPTION_KEYS = Object.freeze([
  'runtimeConfig',
  'adapterConfig',
  'cwd',
  'clientVersion',
  'environment',
  'clientFactory',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'runtimeConfig',
  'adapterConfig',
  'cwd',
  'clientVersion',
  'environment',
]);
const RUNTIME_CONFIG_KEYS = Object.freeze([
  'schemaVersion',
  'requestedMode',
  'configuredMode',
  'killSwitch',
  'configuredPrimaryKernel',
  'configuredShadowKernel',
  'diagnostics',
]);
const ADAPTER_CONFIG_KEYS = Object.freeze([
  'version',
  'requested',
  'enabled',
  'commandPath',
  'reason',
]);
const CLIENT_KEYS = Object.freeze([
  'close',
  'isolationProfile',
  'request',
  'start',
  'status',
  'subscribe',
]);
const START_RECEIPT_KEYS = Object.freeze([
  'ok',
  'clientVersion',
  'codexCliVersion',
  'initializeResult',
]);
const ISOLATION_PROFILE_KEYS = Object.freeze([
  'version',
  'complete',
  'disabledMcpServerNames',
]);
const VALID_ADAPTER_REASONS = new Set(
  Object.values(CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS)
);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, allowedKeys, requiredKeys = allowedKeys, {
  exact = true,
  frozen = false,
} = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (exact && keys.length !== allowedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function inspectableSynchronousFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isAsyncFunction(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(`${fieldName} must be an inspectable synchronous function`);
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  return value;
}

function normalizeRuntimeConfig(value) {
  const fields = dataFields(value, RUNTIME_CONFIG_KEYS, RUNTIME_CONFIG_KEYS, {
    frozen: true,
  });
  if (!fields || fields.get('schemaVersion') !== HARNESS_RUNTIME_CONFIG_VERSION
    || !HARNESS_RUNTIME_MODES.includes(fields.get('requestedMode'))
    || !HARNESS_RUNTIME_MODES.includes(fields.get('configuredMode'))
    || typeof fields.get('killSwitch') !== 'boolean') return null;
  const configuredMode = fields.get('configuredMode');
  const killSwitch = fields.get('killSwitch');
  const expectedMode = killSwitch ? 'legacy' : fields.get('requestedMode');
  const expectedPrimary = ['legacy', 'shadow'].includes(configuredMode)
    ? 'legacy' : 'v2';
  const expectedShadow = configuredMode === 'shadow' ? 'v2' : null;
  if (configuredMode !== expectedMode
    || fields.get('configuredPrimaryKernel') !== expectedPrimary
    || fields.get('configuredShadowKernel') !== expectedShadow) return null;
  return Object.freeze({ configuredMode, killSwitch });
}

function normalizeAdapterConfig(value) {
  const fields = dataFields(value, ADAPTER_CONFIG_KEYS, ADAPTER_CONFIG_KEYS, {
    frozen: true,
  });
  if (!fields || fields.get('version') !== CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION
    || typeof fields.get('requested') !== 'boolean'
    || typeof fields.get('enabled') !== 'boolean'
    || !VALID_ADAPTER_REASONS.has(fields.get('reason'))) return null;
  const requested = fields.get('requested');
  const enabled = fields.get('enabled');
  const commandPath = fields.get('commandPath');
  const reason = fields.get('reason');
  if (enabled && (!requested || reason !== CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.READY
      || typeof commandPath !== 'string' || !path.isAbsolute(commandPath)
      || !commandPath || commandPath.includes('\0'))
    || !enabled && commandPath !== null) return null;
  return Object.freeze({ requested, enabled, commandPath, reason });
}

function normalizeEnvironment(value) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  const output = {};
  for (const key of keys) {
    const descriptor = typeof key === 'string'
      ? Object.getOwnPropertyDescriptor(value, key) : null;
    if (!descriptor || !key || key.includes('=') || key.includes('\0')
      || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string'
      || descriptor.value.includes('\0')) return null;
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}

function captureClient(value) {
  const fields = dataFields(value, CLIENT_KEYS, CLIENT_KEYS, {
    frozen: true,
  });
  if (!fields) throw new TypeError('App Server client must be a frozen exact port');
  const client = { receiver: value };
  for (const key of CLIENT_KEYS) {
    client[key] = inspectableSynchronousFunction(
      fields.get(key),
      `client.${key}`
    );
  }
  return Object.freeze(client);
}

function callNativeAsync(port, methodName, args = []) {
  let pending;
  try {
    pending = Reflect.apply(port[methodName], port.receiver, args);
  } catch (error) {
    return Promise.reject(error);
  }
  if (!util.types.isPromise(pending)) {
    return Promise.reject(new TypeError(`${methodName} must return a native Promise`));
  }
  return new Promise((resolve, reject) => {
    try {
      Reflect.apply(Promise.prototype.then, pending, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

function readClientStatus(client) {
  let value;
  try {
    value = Reflect.apply(client.status, client.receiver, []);
  } catch {
    return Object.freeze({ state: 'unknown', verifiedCliVersion: null });
  }
  if (util.types.isPromise(value) || !isPlainRecord(value)
    || !Object.isFrozen(value)) {
    return Object.freeze({ state: 'unknown', verifiedCliVersion: null });
  }
  const stateDescriptor = Object.getOwnPropertyDescriptor(value, 'state');
  const versionDescriptor = Object.getOwnPropertyDescriptor(
    value,
    'verifiedCliVersion'
  );
  return Object.freeze({
    state: stateDescriptor && Object.hasOwn(stateDescriptor, 'value')
      && typeof stateDescriptor.value === 'string'
      ? stateDescriptor.value : 'unknown',
    verifiedCliVersion: versionDescriptor
      && Object.hasOwn(versionDescriptor, 'value')
      && typeof versionDescriptor.value === 'string'
      ? versionDescriptor.value : null,
  });
}

function validIsolationProfile(client) {
  let value;
  try {
    value = Reflect.apply(client.isolationProfile, client.receiver, []);
  } catch {
    return false;
  }
  const fields = dataFields(
    value,
    ISOLATION_PROFILE_KEYS,
    ISOLATION_PROFILE_KEYS,
    { frozen: true }
  );
  const names = fields ? fields.get('disabledMcpServerNames') : null;
  return Boolean(fields
    && fields.get('version') === CODEX_APP_SERVER_SHADOW_ISOLATION_PROFILE_VERSION
    && fields.get('complete') === true
    && Array.isArray(names) && Object.isFrozen(names));
}

function validStartReceipt(value, clientVersion) {
  const fields = dataFields(value, START_RECEIPT_KEYS, START_RECEIPT_KEYS, {
    frozen: true,
  });
  return Boolean(fields && fields.get('ok') === true
    && fields.get('clientVersion') === clientVersion
    && fields.get('codexCliVersion') === CODEX_APP_SERVER_PINNED_CLI_VERSION);
}

function confirmedClose(value) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)) return false;
  const closed = Object.getOwnPropertyDescriptor(value, 'closed');
  const exited = Object.getOwnPropertyDescriptor(value, 'exited');
  return Boolean(closed && Object.hasOwn(closed, 'value')
    && closed.value === true && exited && Object.hasOwn(exited, 'value')
    && exited.value === true);
}

function selection({ ready, reason, client, cleanupConfirmed }) {
  return Object.freeze({
    schemaVersion: CODEX_APP_SERVER_PRODUCTION_CLIENT_SELECTION_SCHEMA_VERSION,
    ready,
    reason,
    client,
    cleanupConfirmed,
  });
}

function createCodexAppServerProductionClientActivation(options = {}) {
  const fields = dataFields(options, OPTION_KEYS, REQUIRED_OPTION_KEYS, {
    exact: false,
  });
  if (!fields) {
    throw new TypeError('Invalid App Server production client activation options');
  }
  const runtimeConfig = normalizeRuntimeConfig(fields.get('runtimeConfig'));
  const adapterConfig = normalizeAdapterConfig(fields.get('adapterConfig'));
  const environment = normalizeEnvironment(fields.get('environment'));
  const cwd = fields.get('cwd');
  const clientVersion = fields.get('clientVersion');
  if (!runtimeConfig || !adapterConfig || !environment
    || typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0')
    || typeof clientVersion !== 'string' || !clientVersion.trim()
    || clientVersion !== clientVersion.trim() || clientVersion.includes('\0')
    || clientVersion.length > 128) {
    throw new TypeError('Invalid App Server production client activation options');
  }
  const clientFactory = inspectableSynchronousFunction(
    fields.has('clientFactory')
      ? fields.get('clientFactory') : createCodexAppServerStdioClient,
    'clientFactory'
  );
  const modeEligible = runtimeConfig.killSwitch === false
    && ['shadow', 'canary'].includes(runtimeConfig.configuredMode);
  const enabled = modeEligible && adapterConfig.enabled;
  let state = enabled
    ? CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.IDLE
    : CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.DISABLED;
  let reason = enabled
    ? CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS.PENDING
    : modeEligible
      ? adapterConfig.reason
      : CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS.MODE_NOT_APP_SERVER;
  let client = null;
  let startPromise = null;
  let cleanupConfirmed = null;

  function diagnostics() {
    const status = client ? readClientStatus(client) : { state: null };
    return Object.freeze({
      version: CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_VERSION,
      state,
      reason,
      configuredMode: runtimeConfig.configuredMode,
      adapterRequested: adapterConfig.requested,
      adapterEnabled: adapterConfig.enabled,
      adapterReason: adapterConfig.reason,
      clientState: status.state,
      cleanupConfirmed,
      pinnedCliVersion: CODEX_APP_SERVER_PINNED_CLI_VERSION,
    });
  }

  async function cleanupClient() {
    if (!client) return null;
    try {
      const receipt = await callNativeAsync(client, 'close');
      return confirmedClose(receipt);
    } catch {
      return false;
    }
  }

  async function performStart() {
    if (!enabled) {
      return selection({
        ready: false,
        reason,
        client: null,
        cleanupConfirmed: null,
      });
    }
    state = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.STARTING;
    const clientOptions = Object.freeze({
      codexCommand: adapterConfig.commandPath,
      cwd,
      clientVersion,
      environment,
    });
    let rawClient;
    try {
      rawClient = Reflect.apply(clientFactory, undefined, [clientOptions]);
      if (util.types.isPromise(rawClient)) {
        try {
          Reflect.apply(Promise.prototype.then, rawClient, [
            () => undefined,
            () => undefined,
          ]);
        } catch { /* async factories remain denied */ }
        throw new TypeError('clientFactory must be synchronous');
      }
      client = captureClient(rawClient);
    } catch {
      state = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.BLOCKED;
      reason = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS
        .CLIENT_CONSTRUCTION_FAILED;
      return selection({
        ready: false,
        reason,
        client: null,
        cleanupConfirmed: null,
      });
    }

    try {
      const receipt = await callNativeAsync(client, 'start');
      const status = readClientStatus(client);
      if (!validStartReceipt(receipt, clientVersion)
        || status.state !== 'ready'
        || status.verifiedCliVersion !== CODEX_APP_SERVER_PINNED_CLI_VERSION
        || !validIsolationProfile(client)) {
        reason = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS
          .CLIENT_NOT_READY;
        throw new TypeError('App Server client readiness is incomplete');
      }
      state = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.READY;
      reason = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS.READY;
      return selection({
        ready: true,
        reason,
        client: client.receiver,
        cleanupConfirmed: null,
      });
    } catch {
      if (reason !== CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS
        .CLIENT_NOT_READY) {
        reason = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS
          .CLIENT_START_FAILED;
      }
      cleanupConfirmed = await cleanupClient();
      if (cleanupConfirmed !== true) {
        reason = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS
          .CLIENT_CLEANUP_FAILED;
      }
      state = CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES.BLOCKED;
      return selection({
        ready: false,
        reason,
        client: null,
        cleanupConfirmed,
      });
    }
  }

  function start() {
    if (!startPromise) startPromise = performStart();
    return startPromise;
  }

  return Object.freeze({
    version: CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_VERSION,
    start,
    diagnostics,
  });
}

module.exports = {
  CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_REASONS,
  CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_STATES,
  CODEX_APP_SERVER_PRODUCTION_CLIENT_ACTIVATION_VERSION,
  CODEX_APP_SERVER_PRODUCTION_CLIENT_SELECTION_SCHEMA_VERSION,
  createCodexAppServerProductionClientActivation,
};
