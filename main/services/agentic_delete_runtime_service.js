'use strict';

const crypto = require('crypto');

const {
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  assertAnchoredFilesystemMutationBackend,
  assertAnchoredFilesystemMutationProbe,
  createUnsupportedAnchoredFilesystemMutationBackend,
} = require('../capabilities/anchored_filesystem_mutation_backend_contract');
const {
  CAPABILITY_DELEGATION_MODES,
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');
const {
  createTaskDelegationStore,
} = require('../capabilities/task_delegation_store');
const {
  createTrustedConsentAuthority,
} = require('../capabilities/trusted_consent_authority');
const {
  createAgenticDeleteBrokerFactory,
} = require('./agentic_delete_broker_factory');
const {
  createAgenticDeleteOrchestrator,
} = require('./agentic_delete_orchestrator');
const {
  createNativeEffectApprovalService,
} = require('./native_effect_approval_service');
const {
  createNativeTaskConsentService,
} = require('./native_task_consent_service');
const {
  createTransactionalFilesystemDeleteService,
} = require('./transactional_filesystem_delete_service');

const AGENTIC_DELETE_RUNTIME_SERVICE_VERSION = 'agentic-delete-runtime-service.v1';
const OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'getWindowLease',
  'getActorId',
  'showNativeDialog',
  'mutationBackend',
  'audit',
  'now',
  'requestIdFactory',
  'pathStyle',
  'caseSensitive',
  'fs',
  'path',
  'crypto',
  'durability',
  'journalAuthenticator',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'getWindowLease',
  'getActorId',
  'showNativeDialog',
  'pathStyle',
  'caseSensitive',
]);
const RELEASE_KEYS = Object.freeze(['binding', 'reason', 'terminalStatus']);
const EXECUTE_KEYS = Object.freeze([
  'binding',
  'requestedMode',
  'paths',
  'signal',
  'projectLabel',
]);
const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'runtime_interrupted',
]);
const SAFE_REASON = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/;

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

function confirmed(result) {
  return !isPromiseLike(result) && isRecord(result) && dataValue(result, 'ok') === true;
}

function normalizeReason(value, fallback = 'authority_released') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return SAFE_REASON.test(normalized) ? normalized : fallback;
}

function createAgenticDeleteRuntimeService(options = {}) {
  assertPlainDataRecord(options, OPTION_KEYS, REQUIRED_OPTION_KEYS, 'agentic delete runtime options');
  const authorizeLifecycle = dataValue(options, 'authorizeLifecycle');
  const authorizeRoot = dataValue(options, 'authorizeRoot');
  const authorizeEffectFrontier = dataValue(options, 'authorizeEffectFrontier');
  const getWindowLease = dataValue(options, 'getWindowLease');
  const getActorId = dataValue(options, 'getActorId');
  const showNativeDialog = dataValue(options, 'showNativeDialog');
  const now = Object.hasOwn(options, 'now') ? dataValue(options, 'now') : () => Date.now();
  const requestIdFactory = Object.hasOwn(options, 'requestIdFactory')
    ? dataValue(options, 'requestIdFactory')
    : () => `delete-route-${crypto.randomUUID()}`;
  const audit = Object.hasOwn(options, 'audit') ? dataValue(options, 'audit') : () => {};
  const pathStyle = dataValue(options, 'pathStyle');
  const caseSensitive = dataValue(options, 'caseSensitive');
  for (const [name, callback] of [
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['getWindowLease', getWindowLease],
    ['getActorId', getActorId],
    ['showNativeDialog', showNativeDialog],
    ['now', now],
    ['requestIdFactory', requestIdFactory],
    ['audit', audit],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }
  if (!['posix', 'windows'].includes(pathStyle)) throw new TypeError('pathStyle is invalid');
  if (typeof caseSensitive !== 'boolean') throw new TypeError('caseSensitive must be boolean');

  const mutationBackend = Object.hasOwn(options, 'mutationBackend')
    ? dataValue(options, 'mutationBackend')
    : createUnsupportedAnchoredFilesystemMutationBackend({});
  assertAnchoredFilesystemMutationBackend(mutationBackend);
  const mutationProbe = assertAnchoredFilesystemMutationProbe(mutationBackend.probe());

  function rootAuthorizer(input) {
    let binding = null;
    let projectId;
    let rootPath;
    try {
      if (isRecord(input) && Object.hasOwn(input, 'binding')) {
        binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
        projectId = binding.projectId;
        rootPath = binding.canonicalRootPath;
      } else if (isRecord(input) && Object.hasOwn(input, 'jobId')) {
        binding = createCapabilityDelegationBinding(input);
        projectId = binding.projectId;
        rootPath = binding.canonicalRootPath;
      } else if (isRecord(input)) {
        projectId = dataValue(input, 'projectId');
        rootPath = dataValue(input, 'rootPath') || dataValue(input, 'canonicalRootPath');
      }
      const raw = binding
        ? authorizeRoot(binding)
        : authorizeRoot({ projectId, rootPath });
      if (isPromiseLike(raw) || !isRecord(raw)) return Object.freeze({ authorized: false });
      if (dataValue(raw, 'authorized') !== true
        || (Object.hasOwn(raw, 'ok') && dataValue(raw, 'ok') !== true)) {
        return Object.freeze({ authorized: false });
      }
      const authorizedProjectId = dataValue(raw, 'projectId');
      const canonicalRootPath = dataValue(raw, 'canonicalRootPath') || dataValue(raw, 'rootPath');
      const realRootPath = dataValue(raw, 'realRootPath');
      if (authorizedProjectId !== projectId || canonicalRootPath !== rootPath
        || typeof realRootPath !== 'string' || !realRootPath) {
        return Object.freeze({ authorized: false });
      }
      if (binding && realRootPath !== binding.realRootPath) {
        return Object.freeze({ authorized: false });
      }
      return Object.freeze({
        ok: true,
        authorized: true,
        projectId: authorizedProjectId,
        rootPath: canonicalRootPath,
        canonicalRootPath,
        realRootPath,
      });
    } catch {
      return Object.freeze({ authorized: false });
    }
  }

  const trustedConsentAuthority = createTrustedConsentAuthority({ now });
  const taskDelegationStore = createTaskDelegationStore({
    now,
    consentAuthority: trustedConsentAuthority,
    authorizeRoot: rootAuthorizer,
    authorizeLifecycle,
  });
  const nativeTaskConsentService = createNativeTaskConsentService({
    showNativeDialog,
    trustedConsentAuthority,
    taskDelegationStore,
    authorizeLifecycle,
    getWindowLease,
    now,
  });
  const nativeEffectApprovalService = createNativeEffectApprovalService({
    showNativeDialog,
    authorizeLifecycle,
    authorizeRoot: rootAuthorizer,
    authorizeEffectFrontier,
    getWindowLease,
    now,
  });
  const transactionOptions = {
    authorizeLifecycle,
    authorizeRoot: rootAuthorizer,
    authorizeEffectFrontier,
    mutationBackend,
    now,
  };
  for (const key of ['fs', 'path', 'crypto', 'durability', 'journalAuthenticator']) {
    if (Object.hasOwn(options, key)) transactionOptions[key] = dataValue(options, key);
  }
  const transactionalDeleteService = createTransactionalFilesystemDeleteService(transactionOptions);
  const brokerFactory = createAgenticDeleteBrokerFactory({
    authorizeLifecycle,
    authorizeRoot: rootAuthorizer,
    authorizeEffectFrontier,
    audit,
    now,
  });
  const orchestrator = createAgenticDeleteOrchestrator({
    createBroker: brokerFactory.createBroker,
    transactionalDeleteService,
    nativeEffectApprovalService,
    nativeTaskConsentService,
    taskDelegationStore,
    authorizeLifecycle,
    authorizeRoot: rootAuthorizer,
    getWindowLease,
    getActorId,
    requestIdFactory,
    pathStyle,
    caseSensitive,
  });

  function executeDeletePaths(input = {}) {
    assertPlainDataRecord(input, EXECUTE_KEYS, [
      'binding',
      'requestedMode',
      'paths',
      'projectLabel',
    ], 'executeDeletePaths input');
    return orchestrator.executeDeletePaths(input);
  }

  function beforeAuthorityRelease(input = {}) {
    try {
      assertPlainDataRecord(input, RELEASE_KEYS, RELEASE_KEYS, 'authority release input');
      const binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
      const reason = normalizeReason(dataValue(input, 'reason'));
      const terminalStatus = dataValue(input, 'terminalStatus');
      if (terminalStatus !== null
        && (typeof terminalStatus !== 'string' || !TERMINAL_STATUSES.has(terminalStatus))) {
        return Object.freeze({ ok: false });
      }
      if (mutationProbe.state !== ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED) {
        const effectClear = nativeEffectApprovalService.clear();
        const taskClear = nativeTaskConsentService.clear();
        return Object.freeze({ ok: confirmed(effectClear) && confirmed(taskClear) });
      }
      let result;
      if (terminalStatus === null) {
        result = orchestrator.revokeJob({ binding, reason });
      } else {
        result = orchestrator.onJobTerminal({ binding, status: terminalStatus });
      }
      return Object.freeze({ ok: confirmed(result) });
    } catch {
      return Object.freeze({ ok: false });
    }
  }

  function invalidateWindow(reasonInput = 'window_invalidated') {
    const reason = normalizeReason(reasonInput, 'window_invalidated');
    const result = orchestrator.invalidateWindow(reason);
    return Object.freeze({ ok: confirmed(result) });
  }

  function clear() {
    // Job-bound checkpoints must already have passed beforeAuthorityRelease.
    // This clears only remaining process-local consent/decision state.
    let effectClear;
    let taskClear;
    try { effectClear = nativeEffectApprovalService.clear(); } catch { effectClear = null; }
    try { taskClear = nativeTaskConsentService.clear(); } catch { taskClear = null; }
    return Object.freeze({ ok: confirmed(effectClear) && confirmed(taskClear) });
  }

  function recoverProject(input) {
    return orchestrator.recoverProject(input);
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_DELETE_RUNTIME_SERVICE_VERSION,
      available: mutationProbe.state === ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED,
      backendId: mutationProbe.backendId,
      backendState: mutationProbe.state,
      backendReasonCode: mutationProbe.reasonCode,
      orchestrator: orchestrator.diagnostics(),
      broker: brokerFactory.diagnostics(),
      authorityBoundary: 'main_process_only',
      publicApprovalMode: Object.freeze([
        CAPABILITY_DELEGATION_MODES.ASK_EACH,
        CAPABILITY_DELEGATION_MODES.DELEGATE_TASK,
      ]),
    });
  }

  return Object.freeze({
    executeDeletePaths,
    beforeAuthorityRelease,
    invalidateWindow,
    clear,
    recoverProject,
    diagnostics,
  });
}

module.exports = {
  AGENTIC_DELETE_RUNTIME_SERVICE_VERSION,
  createAgenticDeleteRuntimeService,
};
