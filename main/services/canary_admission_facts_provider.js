'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  areEquivalentPortablePaths,
} = require('../capabilities/sandbox_backend_contract');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION,
  CANARY_EDIT_ACTION_CLASSIFIER_VERSION,
  classifyCanaryEditAction,
} = require('../agent_runtime/canary_edit_action_classifier');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../agent_runtime/canary_rollout_selector');
const {
  HARNESS_OPERATIONS,
  assertHarnessRequest,
} = require('../agent_runtime/harness_contracts');
const {
  createActionDigest,
} = require('./assistant_job_authority_service');

const CANARY_ADMISSION_FACTS_PROVIDER_VERSION =
  'canary-admission-facts-provider.v1';
const CANARY_ADMISSION_FACTS_CHECKPOINT_SCHEMA_VERSION =
  'canary-admission-facts-checkpoint.v1';

const CANARY_ADMISSION_FACTS_PROVIDER_DIAGNOSTICS = Object.freeze({
  version: CANARY_ADMISSION_FACTS_PROVIDER_VERSION,
  authorityMode: 'exact_job_action_root',
  checkpointMode: 'authority_bound',
  mutationObservation: 'external_exact',
  rolloutPolicy: 'external_exact',
  failureMode: 'deny',
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPTION_KEYS = Object.freeze([
  'authorityService',
  'inspectRootMutation',
  'inspectRollout',
]);
const AUTHORITY_METHODS = Object.freeze([
  'authorizeExecute',
  'authorizeProjectRootLease',
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
const CLASSIFICATION_KEYS = Object.freeze([
  'schemaVersion',
  'classifierVersion',
  'eligible',
  'reason',
  'editProfile',
  'summary',
]);
const ROOT_MUTATION_KEYS = Object.freeze([
  'canonicalRootPath',
  'ownerJobId',
  'activeOtherMutatingJobs',
]);
const ROLLOUT_KEYS = Object.freeze([
  'killSwitch',
  'projectPin',
  'allowlisted',
  'internal',
  'rolloutStage',
]);
const VALID_PROJECT_PINS = new Set([null, 'legacy', 'canary']);
const VALID_ROLLOUT_STAGES = new Set(Object.values(CANARY_ROLLOUT_STAGES));
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { return false; }
  return prototype === Object.prototype || prototype === null;
}

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { return null; }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function ownDataValue(value, key, enumerable = null) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return null;
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch {
    return null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value')
    || descriptor.value === undefined
    || enumerable !== null && descriptor.enumerable !== enumerable) return null;
  return descriptor.value;
}

function inspectableFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  try { Function.prototype.toString.call(value); } catch {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  return value;
}

function captureAuthorityService(value) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || !Object.isFrozen(value)) {
    throw new TypeError('authorityService must be a frozen authority');
  }
  const captured = { receiver: value };
  for (const methodName of AUTHORITY_METHODS) {
    captured[methodName] = inspectableFunction(
      ownDataValue(value, methodName, true),
      `authorityService.${methodName}`
    );
  }
  return Object.freeze(captured);
}

function captureDependencies(options) {
  const fields = exactDataFields(options, OPTION_KEYS);
  if (!fields) {
    throw new TypeError('Invalid canary admission facts provider options');
  }
  return Object.freeze({
    authorityService: captureAuthorityService(fields.get('authorityService')),
    inspectRootMutation: inspectableFunction(
      fields.get('inspectRootMutation'),
      'inspectRootMutation'
    ),
    inspectRollout: inspectableFunction(
      fields.get('inspectRollout'),
      'inspectRollout'
    ),
  });
}

function bindingsMatch(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function normalizeBinding(value) {
  const fields = exactDataFields(value, BINDING_KEYS, { frozen: true });
  if (!fields) return null;
  try {
    const binding = createCapabilityDelegationBinding(Object.fromEntries(
      BINDING_KEYS.map((key) => [key, fields.get(key)])
    ));
    return bindingsMatch(binding, value) ? binding : null;
  } catch {
    return null;
  }
}

function deepFrozenData(value, seen = new Set()) {
  if (value === null || typeof value === 'string'
    || typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || util.types.isPromise(value) || !Object.isFrozen(value)
    || seen.has(value)) return false;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null
    && prototype !== Array.prototype) return false;
  seen.add(value);
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || !deepFrozenData(descriptor.value, seen)) return false;
  }
  return true;
}

function normalizeRequest(request, classification) {
  if (!request || typeof request !== 'object' || util.types.isProxy(request)
    || !Object.isFrozen(request)) {
    throw new TypeError('Invalid canary admission facts request');
  }
  try { assertHarnessRequest(request); } catch {
    throw new TypeError('Invalid canary admission facts request');
  }
  if (ownDataValue(request, 'operation', true) !== HARNESS_OPERATIONS.EXECUTE) {
    throw new TypeError('Invalid canary admission facts request operation');
  }
  const action = ownDataValue(request, 'action', true);
  const requestId = ownDataValue(request, 'requestId', true);
  if (!deepFrozenData(action) || typeof requestId !== 'string' || !requestId) {
    throw new TypeError('Invalid canary admission facts request action');
  }
  const context = ownDataValue(request, 'executionContext', true);
  const binding = context && normalizeBinding(
    ownDataValue(context, 'authorityBinding', false)
  );
  if (!context || typeof context !== 'object' || util.types.isProxy(context)
    || !Object.isFrozen(context) || !binding
    || ownDataValue(context, 'jobId', true) !== binding.jobId) {
    throw new TypeError('Invalid canary admission facts authority');
  }
  const projectInfo = ownDataValue(request, 'projectInfo', true);
  const projectId = ownDataValue(projectInfo, 'id', true)
    || ownDataValue(projectInfo, 'projectId', true);
  const projectIdAlias = ownDataValue(projectInfo, 'projectId', true);
  const rootPath = ownDataValue(projectInfo, 'rootPath', true);
  if (!projectInfo || typeof projectInfo !== 'object'
    || util.types.isProxy(projectInfo) || !Object.isFrozen(projectInfo)
    || projectId !== binding.projectId
    || projectIdAlias !== null && projectIdAlias !== binding.projectId
    || !areEquivalentPortablePaths(rootPath, binding.canonicalRootPath)) {
    throw new TypeError('Invalid canary admission facts project authority');
  }
  const classificationFields = exactDataFields(
    classification,
    CLASSIFICATION_KEYS,
    { frozen: true }
  );
  let expectedClassification;
  try { expectedClassification = classifyCanaryEditAction(action); } catch {
    expectedClassification = null;
  }
  if (!classificationFields || !expectedClassification
    || classificationFields.get('schemaVersion')
      !== CANARY_EDIT_ACTION_CLASSIFICATION_SCHEMA_VERSION
    || classificationFields.get('classifierVersion')
      !== CANARY_EDIT_ACTION_CLASSIFIER_VERSION
    || canonicalSha256Digest(classification)
      !== canonicalSha256Digest(expectedClassification)) {
    throw new TypeError('Invalid canary admission facts classification');
  }
  return Object.freeze({ action, binding, classification, requestId });
}

function absorbNativePromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
  } catch {
    // A malformed or rejected callback remains denied.
  }
  return true;
}

function callSynchronous(receiver, method, args) {
  let value;
  try { value = Reflect.apply(method, receiver, args); } catch {
    return Object.freeze({ ok: false, value: null });
  }
  if (absorbNativePromise(value)) {
    return Object.freeze({ ok: false, value: null });
  }
  return Object.freeze({ ok: true, value });
}

function authorizationFields(value) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)) return null;
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { return null; }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeExecuteAuthorization(value, context, expectedActionDigest) {
  const fields = authorizationFields(value);
  if (!fields || fields.get('authorized') !== true
    || typeof fields.get('reason') !== 'string'
    || fields.get('actionDigest') !== expectedActionDigest) return null;
  const binding = normalizeBinding(fields.get('binding'));
  return binding && bindingsMatch(binding, context.binding)
    ? Object.freeze({ actionDigest: expectedActionDigest }) : null;
}

function normalizeRootAuthorization(value, context) {
  const fields = authorizationFields(value);
  const physicalRootIdentityDigest = fields
    ? fields.get('physicalRootIdentityDigest') : null;
  if (!fields || fields.get('authorized') !== true
    || typeof fields.get('reason') !== 'string'
    || typeof physicalRootIdentityDigest !== 'string'
    || !DIGEST.test(physicalRootIdentityDigest)) return null;
  const binding = normalizeBinding(fields.get('binding'));
  return binding && bindingsMatch(binding, context.binding)
    ? Object.freeze({ physicalRootIdentityDigest }) : null;
}

function deniedRootMutation(binding) {
  return Object.freeze({
    canonicalRootPath: binding.canonicalRootPath,
    ownerJobId: binding.jobId,
    activeOtherMutatingJobs: 1,
  });
}

function normalizeRootMutation(value, binding) {
  const fields = exactDataFields(value, ROOT_MUTATION_KEYS, { frozen: true });
  const activeOtherMutatingJobs = fields
    ? fields.get('activeOtherMutatingJobs') : null;
  if (!fields
    || !areEquivalentPortablePaths(
      fields.get('canonicalRootPath'), binding.canonicalRootPath
    )
    || fields.get('ownerJobId') !== binding.jobId
    || !Number.isSafeInteger(activeOtherMutatingJobs)
    || activeOtherMutatingJobs < 0
    || Object.is(activeOtherMutatingJobs, -0)) return null;
  return Object.freeze({
    canonicalRootPath: binding.canonicalRootPath,
    ownerJobId: binding.jobId,
    activeOtherMutatingJobs,
  });
}

function deniedRollout() {
  return Object.freeze({
    killSwitch: true,
    projectPin: 'legacy',
    allowlisted: false,
    internal: false,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  });
}

function normalizeRollout(value) {
  const fields = exactDataFields(value, ROLLOUT_KEYS, { frozen: true });
  if (!fields || typeof fields.get('killSwitch') !== 'boolean'
    || !VALID_PROJECT_PINS.has(fields.get('projectPin'))
    || typeof fields.get('allowlisted') !== 'boolean'
    || typeof fields.get('internal') !== 'boolean'
    || !VALID_ROLLOUT_STAGES.has(fields.get('rolloutStage'))) return null;
  return Object.freeze({
    killSwitch: fields.get('killSwitch'),
    projectPin: fields.get('projectPin'),
    allowlisted: fields.get('allowlisted'),
    internal: fields.get('internal'),
    rolloutStage: fields.get('rolloutStage'),
  });
}

function createCanaryAdmissionFactsProvider(options = {}) {
  const dependencies = captureDependencies(options);

  function diagnostics() {
    return CANARY_ADMISSION_FACTS_PROVIDER_DIAGNOSTICS;
  }

  function inspect(request, classification) {
    const context = normalizeRequest(request, classification);
    let expectedActionDigest;
    try { expectedActionDigest = createActionDigest(context.action); } catch {
      throw new TypeError('Invalid canary admission facts action digest');
    }
    const executeCall = callSynchronous(
      dependencies.authorityService.receiver,
      dependencies.authorityService.authorizeExecute,
      [Object.freeze({ binding: context.binding, action: context.action })]
    );
    const rootCall = callSynchronous(
      dependencies.authorityService.receiver,
      dependencies.authorityService.authorizeProjectRootLease,
      [context.binding]
    );
    const executeAuthorization = executeCall.ok
      ? normalizeExecuteAuthorization(
        executeCall.value,
        context,
        expectedActionDigest
      ) : null;
    const rootAuthorization = rootCall.ok
      ? normalizeRootAuthorization(rootCall.value, context) : null;
    const projectAuthorized = Boolean(
      executeAuthorization && rootAuthorization
    );
    const rootMutationCall = callSynchronous(
      undefined,
      dependencies.inspectRootMutation,
      [context.binding]
    );
    const rootMutation = rootMutationCall.ok
      ? normalizeRootMutation(rootMutationCall.value, context.binding)
        || deniedRootMutation(context.binding)
      : deniedRootMutation(context.binding);
    const rolloutCall = callSynchronous(
      undefined,
      dependencies.inspectRollout,
      [context.binding]
    );
    const rollout = rolloutCall.ok
      ? normalizeRollout(rolloutCall.value) || deniedRollout()
      : deniedRollout();
    const checkpointDigest = canonicalSha256Digest({
      schemaVersion: CANARY_ADMISSION_FACTS_CHECKPOINT_SCHEMA_VERSION,
      requestId: context.requestId,
      projectId: context.binding.projectId,
      canonicalRootPath: context.binding.canonicalRootPath,
      realRootPath: context.binding.realRootPath,
      jobId: context.binding.jobId,
      sessionId: context.binding.sessionId,
      submissionDigest: context.binding.submissionDigest,
      actionDigest: expectedActionDigest,
      physicalRootIdentityDigest: rootAuthorization
        ? rootAuthorization.physicalRootIdentityDigest : null,
      projectAuthorized,
      classificationDigest: canonicalSha256Digest(context.classification),
    });
    return Object.freeze({
      projectAuthorized,
      checkpoint: Object.freeze({
        checkpointDigest,
        checkpointVerified: projectAuthorized,
        projectId: context.binding.projectId,
        canonicalRootPath: context.binding.canonicalRootPath,
        jobId: context.binding.jobId,
      }),
      rootMutation,
      rollout,
    });
  }

  return Object.freeze({
    version: CANARY_ADMISSION_FACTS_PROVIDER_VERSION,
    inspect,
    diagnostics,
  });
}

module.exports = {
  CANARY_ADMISSION_FACTS_CHECKPOINT_SCHEMA_VERSION,
  CANARY_ADMISSION_FACTS_PROVIDER_VERSION,
  createCanaryAdmissionFactsProvider,
};
