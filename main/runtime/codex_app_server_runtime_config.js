'use strict';

const path = require('path');
const util = require('util');

const CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION =
  'codex-app-server-runtime-config.v1';

const CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS = Object.freeze({
  READY: 'ready',
  DEFAULT_DISABLED: 'default_disabled',
  EXPLICIT_DISABLED: 'explicit_disabled',
  INVALID_FLAG: 'invalid_flag',
  COMMAND_UNAVAILABLE: 'command_unavailable',
});

const ADAPTER_ENV_KEY = 'FABER_APP_SERVER_ADAPTER';
const COMMAND_ENV_KEY = 'FABER_CODEX_COMMAND';
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['', '0', 'false', 'no', 'off']);
const MAX_COMMAND_PATH_CHARS = 4096;

function config({ requested, enabled, commandPath, reason }) {
  return Object.freeze({
    version: CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION,
    requested,
    enabled,
    commandPath,
    reason,
  });
}

const DEFAULT_CONFIG = config({
  requested: false,
  enabled: false,
  commandPath: null,
  reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.DEFAULT_DISABLED,
});

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // Async configuration is always ignored at this synchronous boundary.
  }
  return true;
}

function plainRecord(value, { hostEnvironment = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || absorbNativePromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return hostEnvironment && value === process.env
    || prototype === Object.prototype || prototype === null;
}

function readOwnData(value, key) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return Object.freeze({ valid: false, present: false, value: undefined });
  }
  if (!descriptor) {
    return Object.freeze({ valid: true, present: false, value: undefined });
  }
  if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
    || absorbNativePromise(descriptor.value)) {
    return Object.freeze({ valid: false, present: true, value: undefined });
  }
  return Object.freeze({ valid: true, present: true, value: descriptor.value });
}

function readEnvironment(options) {
  if (!plainRecord(options)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(options);
  } catch {
    return null;
  }
  if (keys.some((key) => key !== 'env')) return null;
  if (keys.length === 0) return process.env;
  const env = readOwnData(options, 'env');
  return env.valid && env.present
    && plainRecord(env.value, { hostEnvironment: true })
    ? env.value : null;
}

function normalizeFlag(field) {
  if (!field.present) return 'missing';
  if (typeof field.value === 'boolean') return field.value;
  if (typeof field.value !== 'string') return null;
  const normalized = field.value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function normalizeCommandPath(field) {
  if (!field.present || typeof field.value !== 'string'
    || field.value !== field.value.trim() || !field.value
    || field.value.length > MAX_COMMAND_PATH_CHARS
    || field.value.includes('\0') || !path.isAbsolute(field.value)) return null;
  let parsed;
  try {
    parsed = path.parse(field.value);
  } catch {
    return null;
  }
  return field.value === parsed.root ? null : field.value;
}

function createCodexAppServerRuntimeConfig(options = {}) {
  const env = readEnvironment(options);
  if (!env) return DEFAULT_CONFIG;
  const flagField = readOwnData(env, ADAPTER_ENV_KEY);
  const commandField = readOwnData(env, COMMAND_ENV_KEY);
  if (!flagField.valid || !commandField.valid) return DEFAULT_CONFIG;
  const flag = normalizeFlag(flagField);
  if (flag === 'missing') return DEFAULT_CONFIG;
  if (flag === null) {
    return config({
      requested: false,
      enabled: false,
      commandPath: null,
      reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.INVALID_FLAG,
    });
  }
  if (flag === false) {
    return config({
      requested: false,
      enabled: false,
      commandPath: null,
      reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.EXPLICIT_DISABLED,
    });
  }
  const commandPath = normalizeCommandPath(commandField);
  if (!commandPath) {
    return config({
      requested: true,
      enabled: false,
      commandPath: null,
      reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.COMMAND_UNAVAILABLE,
    });
  }
  return config({
    requested: true,
    enabled: true,
    commandPath,
    reason: CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS.READY,
  });
}

module.exports = {
  CODEX_APP_SERVER_RUNTIME_CONFIG_REASONS,
  CODEX_APP_SERVER_RUNTIME_CONFIG_VERSION,
  createCodexAppServerRuntimeConfig,
};
