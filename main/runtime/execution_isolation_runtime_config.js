'use strict';

const util = require('util');

const EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION =
  'execution-isolation-runtime-config.v1';

const MODE_ENV_KEY = 'FABER_EXECUTION_ISOLATION_MODE';
const KILL_SWITCH_ENV_KEY = 'FABER_EXECUTION_ISOLATION_KILL_SWITCH';
const HARNESS_MODE_ENV_KEY = 'FABER_HARNESS_V2_MODE';
const HARNESS_KILL_SWITCH_ENV_KEY = 'FABER_HARNESS_V2_KILL_SWITCH';
const MODES = new Set(['disabled', 'enabled']);
const ISOLATION_CAPABLE_HARNESS_MODES = new Set(['canary', 'on']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const HARNESS_FALSE_VALUES = new Set(['', ...FALSE_VALUES]);
const DATA_GRAPH_LIMITS = Object.freeze({
  maxDepth: 16,
  maxNodes: 10_000,
  maxProperties: 100_000,
});

const DEFAULT_CONFIG = Object.freeze({
  version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
  mode: 'disabled',
  killSwitch: true,
});

function absorbNativePromise(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
    return true;
  } catch {
    return false;
  }
}

function preflightDataGraph(root) {
  const seen = new Set();
  const stack = [{ depth: 0, value: root }];
  let bounded = true;
  let hasNativePromise = false;
  let inspectable = true;
  let nodeCount = 0;
  let propertyCount = 0;

  while (stack.length > 0) {
    const { depth, value } = stack.pop();
    if (absorbNativePromise(value)) {
      hasNativePromise = true;
      continue;
    }
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    nodeCount += 1;
    if (nodeCount > DATA_GRAPH_LIMITS.maxNodes || depth > DATA_GRAPH_LIMITS.maxDepth) {
      bounded = false;
      continue;
    }
    if (util.types.isProxy(value)) {
      inspectable = false;
      continue;
    }

    let keys;
    try { keys = Reflect.ownKeys(value); } catch (error) {
      absorbNativePromise(error);
      inspectable = false;
      continue;
    }
    propertyCount += keys.length;
    const mayDescend = propertyCount <= DATA_GRAPH_LIMITS.maxProperties;
    if (!mayDescend) bounded = false;
    for (const key of keys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
        absorbNativePromise(error);
        inspectable = false;
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        inspectable = false;
        continue;
      }
      if (absorbNativePromise(descriptor.value)) {
        hasNativePromise = true;
      } else if (mayDescend && descriptor.value
        && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
        stack.push({ depth: depth + 1, value: descriptor.value });
      }
    }
  }

  return { bounded, hasNativePromise, inspectable };
}

function exactDataRecord(value, allowedKeys) {
  const preflight = preflightDataGraph(value);
  if (preflight.hasNativePromise || !preflight.bounded || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)) return null;

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) return null;

  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function environmentDataRecord(value) {
  const preflight = preflightDataGraph(value);
  if (preflight.hasNativePromise || !preflight.bounded || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)) return null;

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    return null;
  }
  const isHostEnvironment = value === process.env;
  if ((!isHostEnvironment && prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')) return null;

  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeMode(value) {
  if (value === undefined || value === null || value === '') return 'disabled';
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return MODES.has(normalized) ? normalized : null;
}

function normalizeKillSwitch(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return true;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return true;
}

function harnessEnablesPortableIsolation(envFields) {
  if (envFields.has(MODE_ENV_KEY) || envFields.has(KILL_SWITCH_ENV_KEY)) {
    return false;
  }

  const rawMode = envFields.get(HARNESS_MODE_ENV_KEY);
  if (typeof rawMode !== 'string'
    || !ISOLATION_CAPABLE_HARNESS_MODES.has(rawMode.trim().toLowerCase())) {
    return false;
  }

  const rawKillSwitch = envFields.get(HARNESS_KILL_SWITCH_ENV_KEY);
  if (rawKillSwitch === undefined || rawKillSwitch === null) return true;
  if (typeof rawKillSwitch === 'boolean') return rawKillSwitch === false;
  if (typeof rawKillSwitch !== 'string') return false;
  const normalizedKillSwitch = rawKillSwitch.trim().toLowerCase();
  if (TRUE_VALUES.has(normalizedKillSwitch)) return false;
  if (HARNESS_FALSE_VALUES.has(normalizedKillSwitch)) return true;
  return false;
}

function createExecutionIsolationRuntimeConfig(options = {}) {
  const optionFields = exactDataRecord(options, ['env']);
  if (!optionFields) return DEFAULT_CONFIG;
  const env = optionFields.has('env') ? optionFields.get('env') : process.env;
  const envFields = environmentDataRecord(env);
  if (!envFields) return DEFAULT_CONFIG;

  const inheritHarnessActivation = harnessEnablesPortableIsolation(envFields);
  const mode = inheritHarnessActivation
    ? 'enabled'
    : normalizeMode(envFields.get(MODE_ENV_KEY));
  const killSwitch = inheritHarnessActivation
    ? false
    : normalizeKillSwitch(envFields.get(KILL_SWITCH_ENV_KEY));
  if (!mode) return DEFAULT_CONFIG;

  return Object.freeze({
    version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
    mode,
    killSwitch,
  });
}

module.exports = {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
  createExecutionIsolationRuntimeConfig,
};
