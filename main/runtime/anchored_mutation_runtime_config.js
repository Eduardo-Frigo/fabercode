'use strict';

const util = require('util');

const ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION =
  'anchored-mutation-runtime-config.v1';

const MODE_ENV_KEY = 'FABER_ANCHORED_MUTATION_MODE';
const KILL_SWITCH_ENV_KEY = 'FABER_ANCHORED_MUTATION_KILL_SWITCH';
const MODES = new Set(['disabled', 'enabled']);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const DATA_GRAPH_LIMITS = Object.freeze({
  maxDepth: 16,
  maxNodes: 10_000,
  maxProperties: 100_000,
});

const DEFAULT_CONFIG = Object.freeze({
  version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
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

function createAnchoredMutationRuntimeConfig(options = {}) {
  const optionFields = exactDataRecord(options, ['env']);
  if (!optionFields) return DEFAULT_CONFIG;
  const env = optionFields.has('env') ? optionFields.get('env') : process.env;
  const envFields = environmentDataRecord(env);
  if (!envFields) return DEFAULT_CONFIG;

  const mode = normalizeMode(envFields.get(MODE_ENV_KEY));
  const killSwitch = normalizeKillSwitch(envFields.get(KILL_SWITCH_ENV_KEY));
  if (!mode) return DEFAULT_CONFIG;

  return Object.freeze({
    version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
    mode,
    killSwitch,
  });
}

module.exports = {
  ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
  createAnchoredMutationRuntimeConfig,
};
