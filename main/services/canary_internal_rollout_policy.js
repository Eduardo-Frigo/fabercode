'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../agent_runtime/canary_rollout_selector');
const {
  HARNESS_RUNTIME_CONFIG_VERSION,
  HARNESS_RUNTIME_MODES,
} = require('../agent_runtime/harness_runtime_config');

const CANARY_INTERNAL_ROLLOUT_POLICY_VERSION =
  'canary-internal-rollout-policy.v1';

const OPTION_KEYS = Object.freeze([
  'runtimeConfig',
  'authorizeProjectBinding',
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
const RUNTIME_DIAGNOSTIC_KEYS = Object.freeze([
  'source',
  'requestedValue',
  'requestedMode',
  'configuredMode',
  'killSwitch',
  'fallbackReason',
  'warnings',
]);
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const PROJECT_AUTHORIZATION_KEYS = Object.freeze([
  'ok',
  'authorized',
  'projectId',
  'canonicalRootPath',
  'rootPath',
  'realRootPath',
  'physicalRootIdentity',
]);
const PHYSICAL_ROOT_IDENTITY_KEYS = Object.freeze([
  'device',
  'inode',
  'entryDevice',
  'entryInode',
  'entryType',
]);
const VALID_ENTRY_TYPES = new Set(['directory', 'symlink']);
const VALID_DIAGNOSTIC_SOURCES = new Set(['default', 'env']);
const VALID_FALLBACK_REASONS = new Set([
  null,
  'default',
  'invalid_mode',
  'kill_switch',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const CANARY_INTERNAL_ROLLOUT_POLICY_DIAGNOSTICS = Object.freeze({
  version: CANARY_INTERNAL_ROLLOUT_POLICY_VERSION,
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  allowlistMode: 'authorized_project_binding',
  projectPinMode: 'legacy_outside_canary',
  failureMode: 'deny',
});

const SELECTED_INTERNAL_FACTS = Object.freeze({
  killSwitch: false,
  projectPin: null,
  allowlisted: true,
  internal: true,
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
});

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

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
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
  let keys;
  try {
    Function.prototype.toString.call(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  if (keys.some((key) => {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return true;
    }
    return typeof key !== 'string' || !descriptor
      || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable === true;
  })) {
    throw new TypeError(`${fieldName} must not carry enumerable authority`);
  }
  return value;
}

function denseFrozenWarnings(value) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value)) return false;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (keys[index] !== key) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string'
      || !descriptor.value || descriptor.value.includes('\0')) return false;
  }
  return true;
}

function normalizeRuntimeConfig(value) {
  const fields = exactDataFields(value, RUNTIME_CONFIG_KEYS, { frozen: true });
  if (!fields || fields.get('schemaVersion') !== HARNESS_RUNTIME_CONFIG_VERSION
    || !HARNESS_RUNTIME_MODES.includes(fields.get('requestedMode'))
    || !HARNESS_RUNTIME_MODES.includes(fields.get('configuredMode'))
    || typeof fields.get('killSwitch') !== 'boolean') return null;
  const requestedMode = fields.get('requestedMode');
  const configuredMode = fields.get('configuredMode');
  const killSwitch = fields.get('killSwitch');
  const expectedConfiguredMode = killSwitch ? 'legacy' : requestedMode;
  const expectedPrimaryKernel = configuredMode === 'legacy'
    || configuredMode === 'shadow' ? 'legacy' : 'v2';
  const expectedShadowKernel = configuredMode === 'shadow' ? 'v2' : null;
  if (configuredMode !== expectedConfiguredMode
    || fields.get('configuredPrimaryKernel') !== expectedPrimaryKernel
    || fields.get('configuredShadowKernel') !== expectedShadowKernel) return null;

  const diagnostics = exactDataFields(
    fields.get('diagnostics'),
    RUNTIME_DIAGNOSTIC_KEYS,
    { frozen: true }
  );
  if (!diagnostics
    || !VALID_DIAGNOSTIC_SOURCES.has(diagnostics.get('source'))
    || diagnostics.get('requestedMode') !== requestedMode
    || diagnostics.get('configuredMode') !== configuredMode
    || diagnostics.get('killSwitch') !== killSwitch
    || !VALID_FALLBACK_REASONS.has(diagnostics.get('fallbackReason'))
    || !denseFrozenWarnings(diagnostics.get('warnings'))) return null;
  const requestedValue = diagnostics.get('requestedValue');
  if (requestedValue !== null
    && (!HARNESS_RUNTIME_MODES.includes(requestedValue)
      || requestedValue !== requestedMode)) return null;
  if (killSwitch && diagnostics.get('fallbackReason') !== 'kill_switch') {
    return null;
  }
  return Object.freeze({ configuredMode, killSwitch });
}

function normalizeBinding(value) {
  const fields = exactDataFields(value, BINDING_KEYS, { frozen: true });
  if (!fields) return null;
  const snapshot = Object.fromEntries(
    BINDING_KEYS.map((key) => [key, fields.get(key)])
  );
  let binding;
  try {
    binding = createCapabilityDelegationBinding(snapshot);
  } catch {
    return null;
  }
  return BINDING_KEYS.every((key) => binding[key] === fields.get(key))
    ? binding : null;
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // This synchronous policy denies native promises even when observation fails.
  }
  return true;
}

function validPhysicalRootIdentity(value) {
  const fields = exactDataFields(value, PHYSICAL_ROOT_IDENTITY_KEYS);
  if (!fields || !VALID_ENTRY_TYPES.has(fields.get('entryType'))) return false;
  return PHYSICAL_ROOT_IDENTITY_KEYS
    .filter((key) => key !== 'entryType')
    .every((key) => typeof fields.get(key) === 'string'
      && Boolean(fields.get(key)) && !fields.get(key).includes('\0'));
}

function authorizationMatches(value, binding) {
  const fields = exactDataFields(value, PROJECT_AUTHORIZATION_KEYS);
  return Boolean(
    fields
    && fields.get('ok') === true
    && fields.get('authorized') === true
    && fields.get('projectId') === binding.projectId
    && fields.get('canonicalRootPath') === binding.canonicalRootPath
    && fields.get('rootPath') === binding.canonicalRootPath
    && fields.get('realRootPath') === binding.realRootPath
    && validPhysicalRootIdentity(fields.get('physicalRootIdentity'))
  );
}

function createDeniedFacts(runtimeConfig) {
  const canaryActive = runtimeConfig.configuredMode === 'canary'
    && runtimeConfig.killSwitch === false;
  return Object.freeze({
    killSwitch: runtimeConfig.killSwitch,
    projectPin: canaryActive ? null : 'legacy',
    allowlisted: false,
    internal: false,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  });
}

function createCanaryInternalRolloutPolicy(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS);
  if (!fields) {
    throw new TypeError('Invalid canary internal rollout policy options');
  }
  const runtimeConfig = normalizeRuntimeConfig(fields.get('runtimeConfig'));
  if (!runtimeConfig) {
    throw new TypeError('Invalid canary internal rollout policy runtimeConfig');
  }
  const authorizeProjectBinding = inspectableSynchronousFunction(
    fields.get('authorizeProjectBinding'),
    'authorizeProjectBinding'
  );
  const canaryActive = runtimeConfig.configuredMode === 'canary'
    && runtimeConfig.killSwitch === false;
  const deniedFacts = createDeniedFacts(runtimeConfig);

  function diagnostics() {
    return CANARY_INTERNAL_ROLLOUT_POLICY_DIAGNOSTICS;
  }

  function inspect(inputBinding) {
    const binding = normalizeBinding(inputBinding);
    if (!canaryActive || !binding) return deniedFacts;
    let authorization;
    try {
      authorization = Reflect.apply(authorizeProjectBinding, undefined, [
        binding.projectId,
        binding.canonicalRootPath,
      ]);
    } catch {
      return deniedFacts;
    }
    if (absorbNativePromise(authorization)
      || !authorizationMatches(authorization, binding)) return deniedFacts;
    return SELECTED_INTERNAL_FACTS;
  }

  return Object.freeze({
    version: CANARY_INTERNAL_ROLLOUT_POLICY_VERSION,
    inspect,
    diagnostics,
  });
}

module.exports = {
  CANARY_INTERNAL_ROLLOUT_POLICY_VERSION,
  createCanaryInternalRolloutPolicy,
};
