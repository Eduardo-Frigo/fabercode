'use strict';

const {
  PROJECT_CAPABILITY_EFFECTS,
  PROJECT_CAPABILITY_KINDS,
  createProjectCapabilityDescriptor,
} = require('../capabilities/project_capability_contracts');
const {
  CapabilityEffectClassifier,
} = require('../capabilities/capability_effect_classifier');
const {
  CapabilityPolicyService,
} = require('../capabilities/capability_policy_service');
const {
  createPendingApprovalStore,
} = require('../capabilities/pending_approval_store');
const {
  createProjectCapabilityBroker,
} = require('../capabilities/project_capability_broker');
const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');

const AGENTIC_DELETE_BROKER_FACTORY_VERSION = 'agentic-delete-broker-factory.v1';
const DELETE_DESCRIPTOR_VERSION = 'agentic-delete-descriptor.v1';
const OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'audit',
  'now',
]);
const CREATE_KEYS = Object.freeze([
  'binding',
  'capability',
  'action',
  'effects',
  'requiresApproval',
  'adapter',
  'approvalReviewer',
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
const DELETE_EFFECTS = Object.freeze([
  PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE,
  PROJECT_CAPABILITY_EFFECTS.DESTRUCTIVE,
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainDataRecord(value, allowedKeys, requiredKeys, fieldName) {
  if (!isRecord(value)) throw new TypeError(`${fieldName} must be a plain data record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${fieldName} must be a plain data record`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) {
    throw new TypeError(`${fieldName} contains unsupported fields`);
  }
  if (requiredKeys.some((key) => !keys.includes(key))) {
    throw new TypeError(`${fieldName} is missing required fields`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain enumerable data properties only`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${fieldName} must not contain undefined`);
  }
  return value;
}

function dataValue(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function isPromiseLike(value) {
  return Boolean(value)
    && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function';
}

function sameBinding(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function normalizeLifecycleAuthorization(raw, expectedBinding) {
  if (isPromiseLike(raw) || !isRecord(raw) || dataValue(raw, 'authorized') !== true) return null;
  const candidate = dataValue(raw, 'binding');
  if (candidate === undefined) return null;
  try {
    const binding = createCapabilityDelegationBinding(candidate);
    return sameBinding(binding, expectedBinding) ? binding : null;
  } catch {
    return null;
  }
}

function normalizeRootAuthorization(raw, expectedBinding) {
  if (isPromiseLike(raw) || !isRecord(raw)) return null;
  if (dataValue(raw, 'authorized') !== true
    || (Object.hasOwn(raw, 'ok') && dataValue(raw, 'ok') !== true)) return null;
  if (dataValue(raw, 'projectId') !== expectedBinding.projectId) return null;
  const canonicalRootPath = dataValue(raw, 'canonicalRootPath') || dataValue(raw, 'rootPath');
  if (canonicalRootPath !== expectedBinding.canonicalRootPath
    || dataValue(raw, 'realRootPath') !== expectedBinding.realRootPath) return null;
  return Object.freeze({
    authorized: true,
    projectId: expectedBinding.projectId,
    canonicalRootPath: expectedBinding.canonicalRootPath,
    rootPath: expectedBinding.canonicalRootPath,
    realRootPath: expectedBinding.realRootPath,
  });
}

function sessionMatchesBinding(session, binding) {
  return isRecord(session)
    && dataValue(session, 'projectId') === binding.projectId
    && dataValue(session, 'sessionId') === binding.sessionId
    && dataValue(session, 'jobId') === binding.jobId
    && dataValue(session, 'rootPath') === binding.canonicalRootPath
    && dataValue(session, 'realRootPath') === binding.realRootPath;
}

function createAgenticDeleteBrokerFactory(options = {}) {
  assertPlainDataRecord(options, OPTION_KEYS, [
    'authorizeLifecycle',
    'authorizeRoot',
    'authorizeEffectFrontier',
  ], 'agentic delete broker factory options');
  const authorizeLifecycle = dataValue(options, 'authorizeLifecycle');
  const authorizeRoot = dataValue(options, 'authorizeRoot');
  const authorizeEffectFrontier = dataValue(options, 'authorizeEffectFrontier');
  const audit = Object.hasOwn(options, 'audit') ? dataValue(options, 'audit') : () => {};
  const now = Object.hasOwn(options, 'now') ? dataValue(options, 'now') : () => Date.now();
  for (const [name, callback] of [
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['audit', audit],
    ['now', now],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }

  let brokersCreated = 0;

  function createBroker(input = {}) {
    assertPlainDataRecord(input, CREATE_KEYS, CREATE_KEYS, 'agentic delete broker input');
    const binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
    if (dataValue(input, 'capability') !== 'filesystem'
      || dataValue(input, 'action') !== 'delete_paths'
      || dataValue(input, 'requiresApproval') !== true) {
      throw new TypeError('The delete routing broker accepts filesystem.delete_paths only');
    }
    const effects = dataValue(input, 'effects');
    if (!Array.isArray(effects)
      || Object.getPrototypeOf(effects) !== Array.prototype
      || effects.length !== DELETE_EFFECTS.length
      || effects.some((effect, index) => effect !== DELETE_EFFECTS[index])) {
      throw new TypeError('The delete routing broker requires the exact destructive effect set');
    }
    const adapter = dataValue(input, 'adapter');
    const approvalReviewer = dataValue(input, 'approvalReviewer');
    if (!isRecord(adapter) || typeof adapter.execute !== 'function') {
      throw new TypeError('The delete routing adapter is invalid');
    }
    if (!isRecord(approvalReviewer) || typeof approvalReviewer.verifyDecision !== 'function') {
      throw new TypeError('The delete routing approval reviewer is invalid');
    }

    function rootAuthorization() {
      let raw;
      try {
        raw = authorizeRoot({
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
        });
      } catch {
        return null;
      }
      return normalizeRootAuthorization(raw, binding);
    }

    function lifecycleAuthorization() {
      let raw;
      try { raw = authorizeLifecycle(binding); } catch { return null; }
      return normalizeLifecycleAuthorization(raw, binding);
    }

    function authorizeSession(session) {
      if (!sessionMatchesBinding(session, binding)) return Object.freeze({ authorized: false });
      // Physical authorization happens first. Lifecycle is read last so a
      // main-owned revocation cannot interleave before returning to the broker.
      if (!rootAuthorization() || !lifecycleAuthorization()) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    function authorizeEffect(session) {
      if (!sessionMatchesBinding(session, binding)) return Object.freeze({ authorized: false });
      let raw;
      try { raw = authorizeEffectFrontier(binding); } catch { return Object.freeze({ authorized: false }); }
      if (!normalizeLifecycleAuthorization(raw, binding)) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({ authorized: true, projectSession: session });
    }

    const descriptor = createProjectCapabilityDescriptor({
      capability: 'filesystem',
      action: 'delete_paths',
      version: DELETE_DESCRIPTOR_VERSION,
      kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
      effects: DELETE_EFFECTS,
      requiresApproval: true,
      risk: 'critical',
      adapter,
    });
    const pendingApprovalStore = createPendingApprovalStore({
      now,
      authorizeRoot({ projectId, rootPath }) {
        if (projectId !== binding.projectId || rootPath !== binding.canonicalRootPath) {
          return Object.freeze({ authorized: false });
        }
        return rootAuthorization() || Object.freeze({ authorized: false });
      },
    });
    const broker = createProjectCapabilityBroker({
      authorizeProjectSession: authorizeSession,
      authorizeProjectEffect: authorizeEffect,
      descriptorResolver: Object.freeze({
        resolve(capability, action) {
          return capability === 'filesystem' && action === 'delete_paths' ? descriptor : null;
        },
      }),
      classifier: new CapabilityEffectClassifier(),
      policy: new CapabilityPolicyService(),
      grantStore: Object.freeze({
        inspect() { return Object.freeze({ authorized: false, reason: 'fresh_approval_required' }); },
        consume() { return Object.freeze({ authorized: false, reason: 'fresh_approval_required' }); },
      }),
      pendingApprovalStore,
      approvalReviewer,
      sandboxRegistry: Object.freeze({
        select() { throw new Error('Delete routing must never select a process sandbox'); },
      }),
      buildSandboxEnvironment() {
        throw new Error('Delete routing must never build a process environment');
      },
      audit: Object.freeze({
        record(event) { return audit(event); },
      }),
      now,
    });
    brokersCreated += 1;
    return broker;
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_DELETE_BROKER_FACTORY_VERSION,
      brokersCreated,
      capability: 'filesystem',
      action: 'delete_paths',
      freshApprovalRequired: true,
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({ createBroker, diagnostics });
}

module.exports = {
  AGENTIC_DELETE_BROKER_FACTORY_VERSION,
  DELETE_DESCRIPTOR_VERSION,
  createAgenticDeleteBrokerFactory,
};
