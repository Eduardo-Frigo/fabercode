'use strict';

const path = require('path');
const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../agent_runtime/canary_rollout_selector');
const {
  DEFAULT_ON_ROLLOUT_POLICY_VERSION,
  DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION,
} = require('../agent_runtime/default_on_rollout_policy');
const {
  HARNESS_RUNTIME_CONFIG_VERSION,
} = require('../agent_runtime/harness_runtime_config');

const DEFAULT_ON_CANARY_ROLLOUT_POLICY_ADAPTER_VERSION =
  'default-on-canary-rollout-policy-adapter.v1';
const OPTION_KEYS = Object.freeze([
  'runtimeConfig',
  'rolloutPolicy',
  'authorizeProjectBinding',
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
const POLICY_KEYS = Object.freeze(['version', 'capture', 'get', 'diagnostics']);
const SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'policyVersion',
  'jobId',
  'projectId',
  'canonicalRootPath',
  'selectedKernel',
  'reason',
  'flags',
  'releaseGate',
  'policyDigest',
]);
const FLAG_KEYS = Object.freeze([
  'configuredMode',
  'killSwitch',
  'projectPin',
  'allowlisted',
  'approvedCohort',
]);
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VALID_ENTRY_TYPES = new Set(['directory', 'symlink']);

const SELECTED_FACTS = Object.freeze({
  killSwitch: false,
  projectPin: 'canary',
  allowlisted: true,
  internal: true,
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
});
const DENIED_FACTS = Object.freeze({
  killSwitch: true,
  projectPin: 'legacy',
  allowlisted: false,
  internal: false,
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
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  return value;
}

function normalizeRuntimeConfig(value) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)
    || value.schemaVersion !== HARNESS_RUNTIME_CONFIG_VERSION
    || typeof value.killSwitch !== 'boolean'
    || typeof value.configuredMode !== 'string') return null;
  return Object.freeze({
    active: value.configuredMode === 'on' && value.killSwitch === false,
    configuredMode: value.configuredMode,
  });
}

function captureRolloutPolicy(value) {
  const fields = exactDataFields(value, POLICY_KEYS, { frozen: true });
  if (!fields || fields.get('version') !== DEFAULT_ON_ROLLOUT_POLICY_VERSION) {
    throw new TypeError('rolloutPolicy must be the default-on policy port');
  }
  return Object.freeze({
    receiver: value,
    get: inspectableSynchronousFunction(
      fields.get('get'),
      'rolloutPolicy.get'
    ),
  });
}

function normalizeBinding(value) {
  const fields = exactDataFields(value, BINDING_KEYS, { frozen: true });
  if (!fields) return null;
  let normalized;
  try {
    normalized = createCapabilityDelegationBinding(Object.fromEntries(
      BINDING_KEYS.map((key) => [key, fields.get(key)])
    ));
  } catch {
    return null;
  }
  return BINDING_KEYS.every((key) => normalized[key] === fields.get(key))
    ? normalized : null;
}

function validSnapshot(value, binding) {
  const fields = exactDataFields(value, SNAPSHOT_KEYS, { frozen: true });
  const flags = fields && exactDataFields(
    fields.get('flags'),
    FLAG_KEYS,
    { frozen: true }
  );
  return Boolean(fields && flags
    && fields.get('schemaVersion') === DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION
    && fields.get('policyVersion') === DEFAULT_ON_ROLLOUT_POLICY_VERSION
    && fields.get('jobId') === binding.jobId
    && fields.get('projectId') === binding.projectId
    && fields.get('canonicalRootPath') === binding.canonicalRootPath
    && fields.get('selectedKernel') === 'v2'
    && SHA256_DIGEST.test(fields.get('policyDigest'))
    && flags.get('configuredMode') === 'on'
    && flags.get('killSwitch') === false);
}

function validPhysicalRootIdentity(value) {
  const fields = exactDataFields(
    value,
    ['device', 'inode', 'entryDevice', 'entryInode', 'entryType']
  );
  return Boolean(fields && VALID_ENTRY_TYPES.has(fields.get('entryType'))
    && ['device', 'inode', 'entryDevice', 'entryInode'].every((key) => (
      typeof fields.get(key) === 'string'
      && Boolean(fields.get(key))
      && !fields.get(key).includes('\0')
    )));
}

function authorizationMatches(value, binding) {
  const fields = exactDataFields(value, [
    'ok',
    'authorized',
    'projectId',
    'rootPath',
    'canonicalRootPath',
    'realRootPath',
    'physicalRootIdentity',
  ]);
  return Boolean(fields
    && fields.get('ok') === true
    && fields.get('authorized') === true
    && fields.get('projectId') === binding.projectId
    && fields.get('rootPath') === binding.canonicalRootPath
    && fields.get('canonicalRootPath') === binding.canonicalRootPath
    && fields.get('realRootPath') === binding.realRootPath
    && path.isAbsolute(fields.get('realRootPath'))
    && validPhysicalRootIdentity(fields.get('physicalRootIdentity')));
}

function createDefaultOnCanaryRolloutPolicyAdapter(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS);
  if (!fields) {
    throw new TypeError('Invalid default-on canary rollout policy adapter options');
  }
  const runtimeConfig = normalizeRuntimeConfig(fields.get('runtimeConfig'));
  if (!runtimeConfig) {
    throw new TypeError('Invalid default-on canary rollout runtimeConfig');
  }
  const rolloutPolicy = captureRolloutPolicy(fields.get('rolloutPolicy'));
  const authorizeProjectBinding = inspectableSynchronousFunction(
    fields.get('authorizeProjectBinding'),
    'authorizeProjectBinding'
  );
  const diagnosticsSnapshot = Object.freeze({
    version: DEFAULT_ON_CANARY_ROLLOUT_POLICY_ADAPTER_VERSION,
    runtimeMode: runtimeConfig.configuredMode,
    snapshotMode: 'job_bound_immutable',
    authorizationMode: 'exact_project_root_revalidation',
    failureMode: 'deny',
  });

  function inspect(value) {
    const binding = normalizeBinding(value);
    if (!runtimeConfig.active || !binding) return DENIED_FACTS;
    let snapshot;
    try {
      snapshot = Reflect.apply(rolloutPolicy.get, rolloutPolicy.receiver, [
        binding.jobId,
      ]);
    } catch {
      return DENIED_FACTS;
    }
    if (util.types.isPromise(snapshot) || !validSnapshot(snapshot, binding)) {
      return DENIED_FACTS;
    }
    let authorization;
    try {
      authorization = Reflect.apply(authorizeProjectBinding, undefined, [
        binding.projectId,
        binding.canonicalRootPath,
      ]);
    } catch {
      return DENIED_FACTS;
    }
    if (util.types.isPromise(authorization)) {
      try {
        Reflect.apply(Promise.prototype.then, authorization, [() => {}, () => {}]);
      } catch { /* invalid asynchronous authorization remains denied */ }
      return DENIED_FACTS;
    }
    return authorizationMatches(authorization, binding)
      ? SELECTED_FACTS : DENIED_FACTS;
  }

  function diagnostics() {
    return diagnosticsSnapshot;
  }

  return Object.freeze({
    version: DEFAULT_ON_CANARY_ROLLOUT_POLICY_ADAPTER_VERSION,
    inspect,
    diagnostics,
  });
}

module.exports = {
  DEFAULT_ON_CANARY_ROLLOUT_POLICY_ADAPTER_VERSION,
  createDefaultOnCanaryRolloutPolicyAdapter,
};
