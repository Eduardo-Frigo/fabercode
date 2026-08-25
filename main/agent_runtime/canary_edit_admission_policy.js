'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  areEquivalentPortablePaths,
  isPortableAbsolutePath,
} = require('../capabilities/sandbox_backend_contract');
const {
  HARNESS_RUNTIME_MODES,
} = require('./harness_runtime_config');

const CANARY_EDIT_ADMISSION_POLICY_VERSION = 'canary-edit-admission-policy.v1';
const CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION =
  'canary-edit-admission-decision.v1';

const CANARY_EDIT_ADMISSION_REASONS = Object.freeze({
  ELIGIBLE: 'eligible',
  INVALID_INPUT: 'invalid_input',
  MODE_NOT_CANARY: 'mode_not_canary',
  PROJECT_NOT_AUTHORIZED: 'project_not_authorized',
  NOT_LOCAL_EDIT: 'not_local_edit',
  INSTALL_REQUESTED: 'install_requested',
  NETWORK_REQUESTED: 'network_requested',
  CHECKPOINT_INVALID: 'checkpoint_invalid',
  ROOT_MUTATION_NOT_EXCLUSIVE: 'root_mutation_not_exclusive',
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

const INPUT_KEYS = Object.freeze([
  'runtimeMode',
  'projectAuthorization',
  'editProfile',
  'checkpoint',
  'rootMutation',
]);
const PROJECT_AUTHORIZATION_KEYS = Object.freeze(['authorized', 'binding']);
const EDIT_PROFILE_KEYS = Object.freeze([
  'kind',
  'installRequested',
  'networkRequested',
]);
const CHECKPOINT_KEYS = Object.freeze([
  'checkpointDigest',
  'checkpointVerified',
  'projectId',
  'canonicalRootPath',
  'jobId',
]);
const ROOT_MUTATION_KEYS = Object.freeze([
  'canonicalRootPath',
  'ownerJobId',
  'activeOtherMutatingJobs',
]);

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

function exactDataFields(value, expectedKeys) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key)
      || !expectedKeys.includes(key))
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

function safeIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value);
}

function normalizeProjectAuthorization(value) {
  const fields = exactDataFields(value, PROJECT_AUTHORIZATION_KEYS);
  if (!fields || typeof fields.get('authorized') !== 'boolean') return null;
  let binding;
  try {
    binding = createCapabilityDelegationBinding(fields.get('binding'));
  } catch {
    return null;
  }
  return Object.freeze({
    authorized: fields.get('authorized'),
    binding,
  });
}

function normalizeEditProfile(value) {
  const fields = exactDataFields(value, EDIT_PROFILE_KEYS);
  if (!fields || !safeIdentifier(fields.get('kind'))
    || typeof fields.get('installRequested') !== 'boolean'
    || typeof fields.get('networkRequested') !== 'boolean') return null;
  return Object.freeze({
    kind: fields.get('kind'),
    installRequested: fields.get('installRequested'),
    networkRequested: fields.get('networkRequested'),
  });
}

function normalizeCheckpoint(value) {
  const fields = exactDataFields(value, CHECKPOINT_KEYS);
  if (!fields || !SHA256_DIGEST.test(fields.get('checkpointDigest'))
    || typeof fields.get('checkpointVerified') !== 'boolean'
    || !safeIdentifier(fields.get('projectId'))
    || !isPortableAbsolutePath(fields.get('canonicalRootPath'))
    || !safeIdentifier(fields.get('jobId'))) return null;
  return Object.freeze({
    checkpointDigest: fields.get('checkpointDigest'),
    checkpointVerified: fields.get('checkpointVerified'),
    projectId: fields.get('projectId'),
    canonicalRootPath: fields.get('canonicalRootPath'),
    jobId: fields.get('jobId'),
  });
}

function normalizeRootMutation(value) {
  const fields = exactDataFields(value, ROOT_MUTATION_KEYS);
  const activeOtherMutatingJobs = fields
    ? fields.get('activeOtherMutatingJobs')
    : null;
  if (!fields || !isPortableAbsolutePath(fields.get('canonicalRootPath'))
    || !safeIdentifier(fields.get('ownerJobId'))
    || !Number.isSafeInteger(activeOtherMutatingJobs)
    || activeOtherMutatingJobs < 0
    || Object.is(activeOtherMutatingJobs, -0)) return null;
  return Object.freeze({
    canonicalRootPath: fields.get('canonicalRootPath'),
    ownerJobId: fields.get('ownerJobId'),
    activeOtherMutatingJobs,
  });
}

function normalizeInput(value) {
  const fields = exactDataFields(value, INPUT_KEYS);
  if (!fields || !HARNESS_RUNTIME_MODES.includes(fields.get('runtimeMode'))) return null;
  const projectAuthorization = normalizeProjectAuthorization(
    fields.get('projectAuthorization')
  );
  const editProfile = normalizeEditProfile(fields.get('editProfile'));
  const checkpoint = normalizeCheckpoint(fields.get('checkpoint'));
  const rootMutation = normalizeRootMutation(fields.get('rootMutation'));
  if (!projectAuthorization || !editProfile || !checkpoint || !rootMutation) return null;
  return Object.freeze({
    runtimeMode: fields.get('runtimeMode'),
    projectAuthorization,
    editProfile,
    checkpoint,
    rootMutation,
  });
}

function frozenPrerequisites(values = {}) {
  return Object.freeze({
    canaryMode: values.canaryMode === true,
    projectAuthorized: values.projectAuthorized === true,
    localEdit: values.localEdit === true,
    installFree: values.installFree === true,
    networkFree: values.networkFree === true,
    checkpointValid: values.checkpointValid === true,
    rootMutationExclusive: values.rootMutationExclusive === true,
  });
}

function decision(eligible, reason, prerequisites) {
  return Object.freeze({
    schemaVersion: CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
    policyVersion: CANARY_EDIT_ADMISSION_POLICY_VERSION,
    eligible,
    reason,
    prerequisites,
  });
}

function invalidDecision() {
  return decision(
    false,
    CANARY_EDIT_ADMISSION_REASONS.INVALID_INPUT,
    frozenPrerequisites()
  );
}

function evaluateCanaryEditAdmission(input = {}) {
  const normalized = normalizeInput(input);
  if (!normalized) return invalidDecision();

  const binding = normalized.projectAuthorization.binding;
  const checkpoint = normalized.checkpoint;
  const rootMutation = normalized.rootMutation;
  const prerequisites = frozenPrerequisites({
    canaryMode: normalized.runtimeMode === 'canary',
    projectAuthorized: normalized.projectAuthorization.authorized,
    localEdit: normalized.editProfile.kind === 'local_edit',
    installFree: normalized.editProfile.installRequested === false,
    networkFree: normalized.editProfile.networkRequested === false,
    checkpointValid: checkpoint.checkpointVerified === true
      && checkpoint.projectId === binding.projectId
      && checkpoint.jobId === binding.jobId
      && areEquivalentPortablePaths(
        checkpoint.canonicalRootPath,
        binding.canonicalRootPath
      ),
    rootMutationExclusive: rootMutation.activeOtherMutatingJobs === 0
      && rootMutation.ownerJobId === binding.jobId
      && areEquivalentPortablePaths(
        rootMutation.canonicalRootPath,
        binding.canonicalRootPath
      ),
  });

  const checks = [
    ['canaryMode', CANARY_EDIT_ADMISSION_REASONS.MODE_NOT_CANARY],
    ['projectAuthorized', CANARY_EDIT_ADMISSION_REASONS.PROJECT_NOT_AUTHORIZED],
    ['localEdit', CANARY_EDIT_ADMISSION_REASONS.NOT_LOCAL_EDIT],
    ['installFree', CANARY_EDIT_ADMISSION_REASONS.INSTALL_REQUESTED],
    ['networkFree', CANARY_EDIT_ADMISSION_REASONS.NETWORK_REQUESTED],
    ['checkpointValid', CANARY_EDIT_ADMISSION_REASONS.CHECKPOINT_INVALID],
    [
      'rootMutationExclusive',
      CANARY_EDIT_ADMISSION_REASONS.ROOT_MUTATION_NOT_EXCLUSIVE,
    ],
  ];
  const failed = checks.find(([field]) => prerequisites[field] !== true);
  return failed
    ? decision(false, failed[1], prerequisites)
    : decision(true, CANARY_EDIT_ADMISSION_REASONS.ELIGIBLE, prerequisites);
}

module.exports = {
  CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  CANARY_EDIT_ADMISSION_POLICY_VERSION,
  CANARY_EDIT_ADMISSION_REASONS,
  evaluateCanaryEditAdmission,
};
