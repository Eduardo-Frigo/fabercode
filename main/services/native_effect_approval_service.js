'use strict';

const crypto = require('crypto');

const {
  DEFAULT_DELEGATION_CONSTRAINTS,
  createCapabilityDelegationBinding,
  createCapabilityDelegationImpact,
  immutableSnapshot,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  canonicalSha256Digest,
  createTransactionalDeleteImpact,
  createTransactionalDeletePublicRequest,
} = require('../capabilities/transactional_delete_contracts');

const NATIVE_EFFECT_APPROVAL_SERVICE_VERSION = 'native-effect-approval-service.v1';
const DEFAULT_EFFECT_DECISION_TTL_MS = 60 * 1000;
const MAX_EFFECT_DECISION_TTL_MS = 5 * 60 * 1000;
const HARD_MAX_APPROVAL_RECORDS = 10_000;
const HARD_MAX_PENDING_DIALOGS = 1_024;
const HARD_MAX_DISPLAY_PATHS = 64;
const MAX_DISPLAY_PATH_LENGTH = 512;
const MAX_DIALOG_PATH_TEXT_LENGTH = 4_096;
const DIALOG_ALLOW_RESPONSE = 1;

const DEFAULT_NATIVE_EFFECT_APPROVAL_CAPS = Object.freeze({
  maxPendingDialogs: 64,
  maxDecisionRecords: 1_024,
  maxDisplayPaths: 36,
  maxFilesPerDecision: DEFAULT_DELEGATION_CONSTRAINTS.maxFilesPerDecision,
  maxBytesPerDecision: DEFAULT_DELEGATION_CONSTRAINTS.maxBytesPerDecision,
  maxDirectoriesPerDecision: DEFAULT_DELEGATION_CONSTRAINTS.maxDirectoriesPerDecision,
});

const NATIVE_EFFECT_APPROVAL_REASONS = Object.freeze({
  APPROVED: 'native_effect_approved',
  BUSY: 'native_effect_busy',
  CANCELED: 'native_effect_canceled',
  CAPACITY_EXCEEDED: 'native_effect_capacity_exceeded',
  CLEARED: 'native_effect_cleared',
  CLOCK_INVALID: 'native_effect_clock_invalid',
  DENIED: 'native_effect_denied',
  DIALOG_FAILED: 'native_effect_dialog_failed',
  EXPIRED: 'native_effect_expired',
  INVALID_INPUT: 'native_effect_invalid_input',
  LIFECYCLE_INVALIDATED: 'native_effect_lifecycle_invalidated',
  MISMATCH: 'native_effect_mismatch',
  NOT_FOUND: 'native_effect_not_found',
  REPLAYED: 'native_effect_replayed',
  REVOKED: 'native_effect_revoked',
  ROOT_INVALIDATED: 'native_effect_root_invalidated',
  WINDOW_INVALIDATED: 'native_effect_window_invalidated',
});

const FIXED_EFFECT_APPROVAL_DIALOG = Object.freeze({
  type: 'warning',
  title: 'Confirmar exclusão',
  message: 'Permitir que a IA exclua os itens listados?',
  buttons: Object.freeze(['Cancelar', 'Permitir exclusão']),
  defaultId: 0,
  cancelId: 0,
  noLink: true,
});

const OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'getWindowLease',
  'now',
  'caps',
  'decisionTtlMs',
  'decisionIdFactory',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEffectFrontier',
  'getWindowLease',
]);
const CAPS_KEYS = Object.freeze(Object.keys(DEFAULT_NATIVE_EFFECT_APPROVAL_CAPS));
const DECISION_INPUT_KEYS = Object.freeze([
  'binding',
  'requestDigest',
  'impactDigest',
  'checkpointDigest',
  'impact',
  'displayPaths',
  'pathStyle',
  'caseSensitive',
  'projectLabel',
  'actorId',
  'windowLease',
]);
const CANCEL_JOB_KEYS = Object.freeze(['binding', 'reason']);
const BINDING_FIELDS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/;
const UNSAFE_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

function isPlainDataRecord(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) return false;
  if (requiredKeys.some((key) => !keys.includes(key))) return false;
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return false;
    }
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return false;
    }
    if (descriptor.value === undefined) return false;
  }
  return true;
}

function dataProperty(value, key) {
  return Object.getOwnPropertyDescriptor(value, key).value;
}

function isOpaqueLease(value) {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function');
}

function bindingsMatch(left, right) {
  return BINDING_FIELDS.every((field) => left[field] === right[field]);
}

function normalizePositiveBound(value, fieldName, hardMaximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardMaximum) {
    throw new TypeError(`${fieldName} must be a positive safe integer at most ${hardMaximum}`);
  }
  return value;
}

function normalizeCaps(value) {
  if (value === undefined) return DEFAULT_NATIVE_EFFECT_APPROVAL_CAPS;
  if (!isPlainDataRecord(value, CAPS_KEYS, [])) {
    throw new TypeError('caps must be a plain data record');
  }
  const complete = { ...DEFAULT_NATIVE_EFFECT_APPROVAL_CAPS };
  for (const key of Reflect.ownKeys(value)) complete[key] = dataProperty(value, key);
  normalizePositiveBound(
    complete.maxPendingDialogs,
    'caps.maxPendingDialogs',
    HARD_MAX_PENDING_DIALOGS
  );
  normalizePositiveBound(
    complete.maxDecisionRecords,
    'caps.maxDecisionRecords',
    HARD_MAX_APPROVAL_RECORDS
  );
  normalizePositiveBound(
    complete.maxDisplayPaths,
    'caps.maxDisplayPaths',
    HARD_MAX_DISPLAY_PATHS
  );
  normalizePositiveBound(
    complete.maxFilesPerDecision,
    'caps.maxFilesPerDecision',
    DEFAULT_DELEGATION_CONSTRAINTS.maxFilesPerDecision
  );
  normalizePositiveBound(
    complete.maxBytesPerDecision,
    'caps.maxBytesPerDecision',
    DEFAULT_DELEGATION_CONSTRAINTS.maxBytesPerDecision
  );
  normalizePositiveBound(
    complete.maxDirectoriesPerDecision,
    'caps.maxDirectoriesPerDecision',
    DEFAULT_DELEGATION_CONSTRAINTS.maxDirectoriesPerDecision
  );
  return Object.freeze(complete);
}

function normalizeTtl(value) {
  const ttl = value === undefined ? DEFAULT_EFFECT_DECISION_TTL_MS : value;
  return normalizePositiveBound(ttl, 'decisionTtlMs', MAX_EFFECT_DECISION_TTL_MS);
}

function normalizeIdentifier(value, fieldName) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a safe identifier`);
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return normalized;
}

function normalizeReason(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return SAFE_REASON_PATTERN.test(normalized) ? normalized : fallback;
}

function normalizeProjectLabel(value) {
  if (typeof value !== 'string') throw new TypeError('projectLabel must be a string');
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return normalized || 'projeto atual';
}

function denseArrayValues(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be a dense array`);
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${fieldName} must be a dense array`);
  }
  const valueKeys = keys.filter((key) => key !== 'length');
  if (valueKeys.length !== value.length
    || valueKeys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be a dense array`);
  }
  const result = [];
  for (const key of valueKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain data properties only`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function normalizeDisplayPaths(value, pathStyle, caseSensitive, impact, caps, requestDigest) {
  const values = denseArrayValues(value, 'displayPaths');
  if (!values.length || values.length > caps.maxDisplayPaths) {
    throw new TypeError(`displayPaths must contain 1..${caps.maxDisplayPaths} paths`);
  }
  if (values.length > impact.files + impact.directories) {
    throw new TypeError('displayPaths must not exceed the verified impact target count');
  }
  let totalLength = 0;
  for (const entry of values) {
    if (typeof entry !== 'string'
      || !entry
      || entry.length > MAX_DISPLAY_PATH_LENGTH
      || UNSAFE_DISPLAY_CHARACTERS.test(entry)) {
      throw new TypeError('displayPaths contains an unsafe path');
    }
    totalLength += entry.length;
    if (totalLength > MAX_DIALOG_PATH_TEXT_LENGTH) {
      throw new TypeError('displayPaths exceeds the safe dialog text limit');
    }
  }
  const request = createTransactionalDeletePublicRequest(
    { paths: values },
    { pathStyle, caseSensitive }
  );
  const displayedRequestDigest = canonicalSha256Digest({
    pathStyle,
    caseSensitive,
    request,
  });
  if (displayedRequestDigest !== requestDigest) {
    throw new TypeError('displayPaths must exactly match the approved delete request');
  }
  return request.paths;
}

function normalizeDecisionInput(input, caps) {
  if (!isPlainDataRecord(input, DECISION_INPUT_KEYS)) {
    throw new TypeError('decision input must be a plain data record');
  }
  const binding = createCapabilityDelegationBinding(dataProperty(input, 'binding'));
  const impact = createTransactionalDeleteImpact(dataProperty(input, 'impact'));
  if (impact.files > caps.maxFilesPerDecision
    || impact.bytes > caps.maxBytesPerDecision
    || impact.directories > caps.maxDirectoriesPerDecision) {
    throw new TypeError('impact exceeds the native approval caps');
  }
  const windowLease = dataProperty(input, 'windowLease');
  if (!isOpaqueLease(windowLease)) throw new TypeError('windowLease must be opaque');
  const pathStyle = dataProperty(input, 'pathStyle');
  const caseSensitive = dataProperty(input, 'caseSensitive');
  const requestDigest = normalizeDigest(dataProperty(input, 'requestDigest'), 'requestDigest');
  const impactDigest = normalizeDigest(dataProperty(input, 'impactDigest'), 'impactDigest');
  if (canonicalSha256Digest(impact) !== impactDigest) {
    throw new TypeError('impact must exactly match impactDigest');
  }
  return Object.freeze({
    binding,
    requestDigest,
    impactDigest,
    checkpointDigest: normalizeDigest(
      dataProperty(input, 'checkpointDigest'),
      'checkpointDigest'
    ),
    impact,
    displayPaths: normalizeDisplayPaths(
      dataProperty(input, 'displayPaths'),
      pathStyle,
      caseSensitive,
      impact,
      caps,
      requestDigest
    ),
    pathStyle,
    caseSensitive,
    projectLabel: normalizeProjectLabel(dataProperty(input, 'projectLabel')),
    actorId: normalizeIdentifier(dataProperty(input, 'actorId'), 'actorId'),
    windowLease,
  });
}

function normalizeCancelInput(input) {
  if (!isPlainDataRecord(input, CANCEL_JOB_KEYS, ['binding'])) {
    throw new TypeError('cancelJob input must be a plain data record');
  }
  return Object.freeze({
    binding: createCapabilityDelegationBinding(dataProperty(input, 'binding')),
    reason: normalizeReason(
      Object.hasOwn(input, 'reason') ? dataProperty(input, 'reason') : undefined,
      NATIVE_EFFECT_APPROVAL_REASONS.CANCELED
    ),
  });
}

function publicDecision(ok, approved, reason) {
  return Object.freeze({ ok, approved, reason });
}

function approved() {
  return publicDecision(true, true, NATIVE_EFFECT_APPROVAL_REASONS.APPROVED);
}

function denied(reason, ok = false) {
  return publicDecision(ok, false, reason);
}

function nativeDialogAllowed(value) {
  if (!isPlainDataRecord(value, ['response', 'checkboxChecked'], ['response'])) return false;
  const response = dataProperty(value, 'response');
  if (Object.hasOwn(value, 'checkboxChecked')
    && typeof dataProperty(value, 'checkboxChecked') !== 'boolean') return false;
  return Number.isSafeInteger(response) && response === DIALOG_ALLOW_RESPONSE;
}

function createDialogPayload(input) {
  const listedPaths = input.displayPaths.map((entry) => `\u2022 ${JSON.stringify(entry)}`).join('\n');
  const { files, bytes, directories } = input.impact;
  return Object.freeze({
    ...FIXED_EFFECT_APPROVAL_DIALOG,
    detail: [
      `Projeto: ${input.projectLabel}`,
      '',
      listedPaths,
      '',
      `Impacto verificado: ${files} arquivo(s), ${directories} diret\u00f3rio(s), ${bytes} byte(s).`,
      'A aprova\u00e7\u00e3o vale apenas para esta opera\u00e7\u00e3o e para o checkpoint atual.',
    ].join('\n'),
  });
}

function awaitDialogOrAbort(dialogPromise, signal) {
  if (signal.aborted) {
    return Promise.resolve(Object.freeze({ aborted: true, value: null }));
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish(Object.freeze({ aborted: true, value: null }));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(dialogPromise).then(
      (value) => finish(Object.freeze({ aborted: false, value })),
      (error) => finish(Object.freeze({ aborted: false, error, value: null }))
    );
  });
}

function defaultDecisionIdFactory() {
  return `native-effect-decision_${crypto.randomUUID()}`;
}

function createNativeEffectApprovalService(options = {}) {
  if (!isPlainDataRecord(options, OPTION_KEYS, REQUIRED_OPTION_KEYS)) {
    throw new TypeError('Native effect approval options must be a plain data record');
  }
  const showNativeDialog = dataProperty(options, 'showNativeDialog');
  const authorizeLifecycle = dataProperty(options, 'authorizeLifecycle');
  const authorizeRoot = dataProperty(options, 'authorizeRoot');
  const authorizeEffectFrontier = dataProperty(options, 'authorizeEffectFrontier');
  const getWindowLease = dataProperty(options, 'getWindowLease');
  const now = Object.hasOwn(options, 'now') ? dataProperty(options, 'now') : () => Date.now();
  const caps = normalizeCaps(Object.hasOwn(options, 'caps') ? dataProperty(options, 'caps') : undefined);
  const decisionTtlMs = normalizeTtl(
    Object.hasOwn(options, 'decisionTtlMs') ? dataProperty(options, 'decisionTtlMs') : undefined
  );
  const decisionIdFactory = Object.hasOwn(options, 'decisionIdFactory')
    ? dataProperty(options, 'decisionIdFactory')
    : defaultDecisionIdFactory;
  for (const [name, callback] of [
    ['showNativeDialog', showNativeDialog],
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
    ['getWindowLease', getWindowLease],
    ['now', now],
    ['decisionIdFactory', decisionIdFactory],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }

  const pendingByTask = new Map();
  const activeByTask = new Map();
  const recordsByExact = new Map();
  const recordsById = new Map();
  const leaseIds = new WeakMap();
  const invalidatedLeases = new WeakSet();
  let nextLeaseId = 1;
  let invalidatedLeaseCount = 0;
  let generation = 0;
  let cancelSerial = 0;
  let authorityHealthy = true;
  let lastObservedAt = -1;
  let externalCallbackActive = false;
  let normalizationActive = false;
  let consumeMutationActive = false;

  function leaseId(lease) {
    let id = leaseIds.get(lease);
    if (id !== undefined) return id;
    if (!Number.isSafeInteger(nextLeaseId)) {
      markAuthorityUnhealthy(NATIVE_EFFECT_APPROVAL_REASONS.CAPACITY_EXCEEDED);
      return 0;
    }
    id = nextLeaseId;
    nextLeaseId += 1;
    leaseIds.set(lease, id);
    return id;
  }

  function taskKey(input) {
    const binding = input.binding;
    return JSON.stringify([
      leaseId(input.windowLease),
      binding.projectId,
      binding.sessionId,
      binding.jobId,
      binding.kernelId,
    ]);
  }

  function exactKey(input) {
    return JSON.stringify({
      lease: leaseId(input.windowLease),
      binding: input.binding,
      requestDigest: input.requestDigest,
      impactDigest: input.impactDigest,
      checkpointDigest: input.checkpointDigest,
      impact: input.impact,
      displayPaths: input.displayPaths,
      pathStyle: input.pathStyle,
      caseSensitive: input.caseSensitive,
      projectLabel: input.projectLabel,
      actorId: input.actorId,
    });
  }

  function invokeExternal(callback, args = [], { snapshot = false } = {}) {
    if (externalCallbackActive) return Object.freeze({ ok: false, value: null });
    externalCallbackActive = true;
    try {
      const raw = callback(...args);
      if (raw && typeof raw.then === 'function') {
        return Object.freeze({ ok: false, value: null });
      }
      return Object.freeze({
        ok: true,
        value: snapshot ? immutableSnapshot(raw) : raw,
      });
    } catch {
      return Object.freeze({ ok: false, value: null });
    } finally {
      externalCallbackActive = false;
    }
  }

  function markAuthorityUnhealthy(reason = NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID) {
    if (!authorityHealthy) return;
    authorityHealthy = false;
    generation += 1;
    for (const operation of pendingByTask.values()) {
      operation.invalidated = true;
      operation.reason = reason;
      operation.publicReason = reason;
      if (!operation.abortController.signal.aborted) operation.abortController.abort();
    }
    for (const record of activeByTask.values()) {
      record.status = 'revoked';
      record.revocationReason = reason;
    }
    activeByTask.clear();
  }

  function readNow() {
    if (externalCallbackActive) {
      markAuthorityUnhealthy();
      return null;
    }
    let value;
    let callbackValid = true;
    externalCallbackActive = true;
    try {
      const raw = now();
      if (raw && typeof raw.then === 'function') callbackValid = false;
      value = raw instanceof Date ? Date.prototype.getTime.call(raw) : raw;
    } catch {
      callbackValid = false;
      value = null;
    } finally {
      externalCallbackActive = false;
    }
    if (!callbackValid) {
      markAuthorityUnhealthy();
      return null;
    }
    if (!Number.isSafeInteger(value)
      || value < 0
      || Object.is(value, -0)
      || value < lastObservedAt) {
      markAuthorityUnhealthy();
      return null;
    }
    lastObservedAt = value;
    return value;
  }

  function removeRecord(record) {
    if (activeByTask.get(record.taskKey) === record) activeByTask.delete(record.taskKey);
    if (recordsByExact.get(record.exactKey) === record) recordsByExact.delete(record.exactKey);
    if (recordsById.get(record.decisionId) === record) recordsById.delete(record.decisionId);
  }

  function purgeExpiredRecords(checkedAt) {
    for (const record of recordsByExact.values()) {
      if (checkedAt >= record.expiresAt) removeRecord(record);
    }
  }

  function operationIsCurrent(operation) {
    return authorityHealthy
      && !operation.invalidated
      && operation.generation === generation
      && pendingByTask.get(operation.taskKey) === operation;
  }

  function attemptIsCurrent(record, attemptGeneration) {
    return authorityHealthy
      && generation === attemptGeneration
      && record.status === 'active'
      && activeByTask.get(record.taskKey) === record
      && recordsByExact.get(record.exactKey) === record
      && recordsById.get(record.decisionId) === record;
  }

  function windowLeaseIsCurrent(windowLease, currentCheck) {
    if (!authorityHealthy || invalidatedLeases.has(windowLease) || !currentCheck()) return false;
    const result = invokeExternal(getWindowLease);
    if (!result.ok || !isOpaqueLease(result.value)) return false;
    return result.value === windowLease
      && !invalidatedLeases.has(windowLease)
      && authorityHealthy
      && currentCheck();
  }

  function lifecycleIsAuthorized(binding, currentCheck) {
    if (!currentCheck()) return false;
    const result = invokeExternal(authorizeLifecycle, [binding], { snapshot: true });
    if (!result.ok || !currentCheck()) return false;
    const authorization = result.value;
    if (!authorization || authorization.authorized !== true || !authorization.binding) return false;
    let authorizedBinding;
    try {
      authorizedBinding = createCapabilityDelegationBinding(authorization.binding);
    } catch {
      return false;
    }
    return bindingsMatch(authorizedBinding, binding) && currentCheck();
  }

  function rootIsAuthorized(binding, currentCheck) {
    if (!currentCheck()) return false;
    const result = invokeExternal(authorizeRoot, [binding], { snapshot: true });
    if (!result.ok || !currentCheck()) return false;
    const authorization = result.value;
    if (!authorization || authorization.authorized !== true) return false;
    if (authorization.binding !== undefined) {
      let authorizedBinding;
      try {
        authorizedBinding = createCapabilityDelegationBinding(authorization.binding);
      } catch {
        return false;
      }
      return bindingsMatch(authorizedBinding, binding) && currentCheck();
    }
    return authorization.projectId === binding.projectId
      && authorization.canonicalRootPath === binding.canonicalRootPath
      && authorization.realRootPath === binding.realRootPath
      && currentCheck();
  }

  function validateFrontier(input, currentCheck) {
    if (!windowLeaseIsCurrent(input.windowLease, currentCheck)) {
      return NATIVE_EFFECT_APPROVAL_REASONS.WINDOW_INVALIDATED;
    }
    if (!lifecycleIsAuthorized(input.binding, currentCheck)) {
      return NATIVE_EFFECT_APPROVAL_REASONS.LIFECYCLE_INVALIDATED;
    }
    if (!rootIsAuthorized(input.binding, currentCheck)) {
      return NATIVE_EFFECT_APPROVAL_REASONS.ROOT_INVALIDATED;
    }
    // Root authorization is an external callback and may race lifecycle or
    // document revocation. Repeat the full authority tuple after it so a
    // mutation observed by any later callback cannot authorize the effect.
    if (!windowLeaseIsCurrent(input.windowLease, currentCheck)) {
      return NATIVE_EFFECT_APPROVAL_REASONS.WINDOW_INVALIDATED;
    }
    if (!lifecycleIsAuthorized(input.binding, currentCheck)) {
      return NATIVE_EFFECT_APPROVAL_REASONS.LIFECYCLE_INVALIDATED;
    }
    if (!rootIsAuthorized(input.binding, currentCheck)) {
      return NATIVE_EFFECT_APPROVAL_REASONS.ROOT_INVALIDATED;
    }
    return currentCheck() ? '' : NATIVE_EFFECT_APPROVAL_REASONS.REVOKED;
  }

  function finalEffectFrontierIsAuthorized(input, currentCheck) {
    if (!currentCheck()) return false;
    const candidate = Object.freeze({
      binding: input.binding,
      windowLease: input.windowLease,
      requestDigest: input.requestDigest,
      impactDigest: input.impactDigest,
      checkpointDigest: input.checkpointDigest,
    });
    const result = invokeExternal(authorizeEffectFrontier, [candidate]);
    if (!result.ok || !currentCheck()) return false;
    const authorization = result.value;
    if (!isPlainDataRecord(
      authorization,
      ['authorized', 'binding', 'windowLease'],
      ['authorized', 'binding', 'windowLease']
    ) || dataProperty(authorization, 'authorized') !== true) return false;
    let authorizedBinding;
    try {
      authorizedBinding = createCapabilityDelegationBinding(
        dataProperty(authorization, 'binding')
      );
    } catch {
      return false;
    }
    return bindingsMatch(authorizedBinding, input.binding)
      && dataProperty(authorization, 'windowLease') === input.windowLease
      && currentCheck();
  }

  function normalizePublicInput(input) {
    if (normalizationActive || externalCallbackActive || consumeMutationActive) return null;
    normalizationActive = true;
    try {
      return normalizeDecisionInput(input, caps);
    } catch {
      return null;
    } finally {
      normalizationActive = false;
    }
  }

  function normalizePublicCancelInput(input) {
    if (normalizationActive) return null;
    normalizationActive = true;
    try {
      return normalizeCancelInput(input);
    } catch {
      return null;
    } finally {
      normalizationActive = false;
    }
  }

  function invokeDialog(operation) {
    if (externalCallbackActive) {
      return Promise.reject(new TypeError('native dialog reentrancy is not allowed'));
    }
    externalCallbackActive = true;
    try {
      const value = showNativeDialog(
        createDialogPayload(operation.input),
        Object.freeze({ signal: operation.abortController.signal })
      );
      if (value
        && typeof value.then === 'function'
        && !(value instanceof Promise)) {
        throw new TypeError('showNativeDialog must return plain data or a native Promise');
      }
      return Promise.resolve(value);
    } catch (error) {
      return Promise.reject(error);
    } finally {
      externalCallbackActive = false;
    }
  }

  function reserveDecisionId() {
    const result = invokeExternal(decisionIdFactory);
    if (!result.ok) return '';
    let decisionId;
    try {
      decisionId = normalizeIdentifier(result.value, 'decisionId');
    } catch {
      return '';
    }
    return recordsById.has(decisionId) ? '' : decisionId;
  }

  async function runRequest(operation) {
    try {
      const currentCheck = () => operationIsCurrent(operation);
      const firstCheckedAt = readNow();
      if (firstCheckedAt === null) {
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
      }
      purgeExpiredRecords(firstCheckedAt);
      if (!currentCheck()) {
        return denied(operation.publicReason || NATIVE_EFFECT_APPROVAL_REASONS.REVOKED);
      }
      const firstFrontierFailure = validateFrontier(operation.input, currentCheck);
      if (firstFrontierFailure) return denied(firstFrontierFailure);

      let dialogAttempt;
      try {
        dialogAttempt = await awaitDialogOrAbort(
          invokeDialog(operation),
          operation.abortController.signal
        );
      } catch {
        dialogAttempt = Object.freeze({ error: true, aborted: false, value: null });
      }
      if (dialogAttempt.aborted || !currentCheck()) {
        return denied(operation.publicReason || NATIVE_EFFECT_APPROVAL_REASONS.CANCELED);
      }
      if (dialogAttempt.error) return denied(NATIVE_EFFECT_APPROVAL_REASONS.DIALOG_FAILED);

      const afterDialogFailure = validateFrontier(operation.input, currentCheck);
      if (afterDialogFailure) return denied(afterDialogFailure);
      let safeDialogResult;
      externalCallbackActive = true;
      try {
        safeDialogResult = immutableSnapshot(dialogAttempt.value);
      } catch {
        safeDialogResult = null;
      } finally {
        externalCallbackActive = false;
      }
      if (!currentCheck()) {
        return denied(operation.publicReason || NATIVE_EFFECT_APPROVAL_REASONS.REVOKED);
      }
      if (!nativeDialogAllowed(safeDialogResult)) {
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.DENIED, true);
      }

      if (recordsByExact.size >= caps.maxDecisionRecords) {
        const capacityCheckedAt = readNow();
        if (capacityCheckedAt === null) {
          return denied(NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
        }
        purgeExpiredRecords(capacityCheckedAt);
      }
      if (!currentCheck() || recordsByExact.size >= caps.maxDecisionRecords) {
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.CAPACITY_EXCEEDED);
      }
      const existingForTask = activeByTask.get(operation.taskKey);
      if (existingForTask) {
        return denied(existingForTask.exactKey === operation.exactKey
          ? NATIVE_EFFECT_APPROVAL_REASONS.BUSY
          : NATIVE_EFFECT_APPROVAL_REASONS.MISMATCH);
      }
      const decisionId = reserveDecisionId();
      if (!decisionId || !currentCheck()) {
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.CAPACITY_EXCEEDED);
      }
      const issuedAt = readNow();
      if (issuedAt === null) return denied(NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
      if (issuedAt > Number.MAX_SAFE_INTEGER - decisionTtlMs) {
        markAuthorityUnhealthy();
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
      }

      // This is the last injected-callback frontier. Publication below is
      // synchronous, and no caller-controlled code runs before the record is visible.
      const finalFrontierFailure = validateFrontier(operation.input, currentCheck);
      if (finalFrontierFailure) return denied(finalFrontierFailure);
      if (recordsByExact.has(operation.exactKey) || activeByTask.has(operation.taskKey)) {
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.BUSY);
      }
      const record = {
        actorId: operation.input.actorId,
        binding: operation.input.binding,
        decisionId,
        exactKey: operation.exactKey,
        expiresAt: issuedAt + decisionTtlMs,
        impact: operation.input.impact,
        issuedAt,
        revocationReason: '',
        status: 'active',
        taskKey: operation.taskKey,
        windowLease: operation.input.windowLease,
      };
      recordsByExact.set(record.exactKey, record);
      recordsById.set(record.decisionId, record);
      activeByTask.set(record.taskKey, record);
      return approved();
    } finally {
      if (pendingByTask.get(operation.taskKey) === operation) {
        pendingByTask.delete(operation.taskKey);
      }
    }
  }

  function requestDecision(input = {}) {
    const normalized = normalizePublicInput(input);
    if (!normalized) {
      return Promise.resolve(denied(NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT));
    }
    const requestTaskKey = taskKey(normalized);
    const requestExactKey = exactKey(normalized);
    if (!authorityHealthy) {
      return Promise.resolve(denied(NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID));
    }
    const pending = pendingByTask.get(requestTaskKey);
    if (pending) {
      if (pending.exactKey === requestExactKey) return pending.promise;
      return Promise.resolve(denied(NATIVE_EFFECT_APPROVAL_REASONS.BUSY));
    }
    const admissionGeneration = generation;
    const admissionCancelSerial = cancelSerial;
    const admissionCheckedAt = readNow();
    if (admissionCheckedAt === null) {
      return Promise.resolve(denied(NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID));
    }
    purgeExpiredRecords(admissionCheckedAt);
    if (!authorityHealthy
      || generation !== admissionGeneration
      || cancelSerial !== admissionCancelSerial) {
      return Promise.resolve(denied(authorityHealthy
        ? NATIVE_EFFECT_APPROVAL_REASONS.REVOKED
        : NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID));
    }
    const active = activeByTask.get(requestTaskKey);
    if (active) {
      if (active.exactKey === requestExactKey && active.status === 'active') {
        return Promise.resolve(approved());
      }
      return Promise.resolve(denied(NATIVE_EFFECT_APPROVAL_REASONS.BUSY));
    }
    const prior = recordsByExact.get(requestExactKey);
    if (prior) {
      return Promise.resolve(denied(prior.status === 'consumed'
        ? NATIVE_EFFECT_APPROVAL_REASONS.REPLAYED
        : NATIVE_EFFECT_APPROVAL_REASONS.REVOKED));
    }
    if (recordsByExact.size >= caps.maxDecisionRecords) {
      return Promise.resolve(denied(NATIVE_EFFECT_APPROVAL_REASONS.CAPACITY_EXCEEDED));
    }
    if (pendingByTask.size >= caps.maxPendingDialogs) {
      return Promise.resolve(denied(NATIVE_EFFECT_APPROVAL_REASONS.BUSY));
    }
    const operation = {
      abortController: new AbortController(),
      exactKey: requestExactKey,
      generation,
      input: normalized,
      invalidated: false,
      promise: null,
      publicReason: '',
      reason: '',
      taskKey: requestTaskKey,
    };
    operation.promise = Promise.resolve().then(() => runRequest(operation));
    pendingByTask.set(requestTaskKey, operation);
    return operation.promise;
  }

  function consumeDecision(input = {}) {
    const normalized = normalizePublicInput(input);
    if (!normalized) return denied(NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT);
    if (consumeMutationActive || externalCallbackActive || !authorityHealthy) {
      return denied(authorityHealthy
        ? NATIVE_EFFECT_APPROVAL_REASONS.BUSY
        : NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
    }
    consumeMutationActive = true;
    const attemptGeneration = generation;
    try {
      const requestTaskKey = taskKey(normalized);
      const requestExactKey = exactKey(normalized);
      const exactRecord = recordsByExact.get(requestExactKey);
      if (exactRecord && exactRecord.status === 'consumed') {
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.REPLAYED);
      }
      if (exactRecord && exactRecord.status === 'revoked') {
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.REVOKED);
      }
      const record = activeByTask.get(requestTaskKey);
      if (!record) return denied(NATIVE_EFFECT_APPROVAL_REASONS.NOT_FOUND);
      if (record.exactKey !== requestExactKey || record !== exactRecord) {
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.MISMATCH);
      }
      const currentCheck = () => attemptIsCurrent(record, attemptGeneration);
      const checkedAt = readNow();
      if (checkedAt === null) return denied(NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
      if (checkedAt >= record.expiresAt) {
        removeRecord(record);
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.EXPIRED);
      }
      const frontierFailure = validateFrontier(normalized, currentCheck);
      if (frontierFailure) {
        if (record.status === 'active') {
          record.status = 'revoked';
          record.revocationReason = frontierFailure;
          if (activeByTask.get(record.taskKey) === record) activeByTask.delete(record.taskKey);
        }
        return denied(frontierFailure);
      }
      const finalCheckedAt = readNow();
      if (finalCheckedAt === null) return denied(NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
      if (!currentCheck()) return denied(NATIVE_EFFECT_APPROVAL_REASONS.REVOKED);
      if (finalCheckedAt >= record.expiresAt) {
        removeRecord(record);
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.EXPIRED);
      }

      // This combined, main-owned frontier is the last external callback. It
      // must atomically validate the document lease, lifecycle and physical
      // project binding. No clock read, audit, promise or callback may occur
      // between it and publication of the one-shot consumption below.
      if (!finalEffectFrontierIsAuthorized(normalized, currentCheck)) {
        if (record.status === 'active') {
          record.status = 'revoked';
          record.revocationReason = NATIVE_EFFECT_APPROVAL_REASONS.LIFECYCLE_INVALIDATED;
          if (activeByTask.get(record.taskKey) === record) activeByTask.delete(record.taskKey);
        }
        return denied(NATIVE_EFFECT_APPROVAL_REASONS.LIFECYCLE_INVALIDATED);
      }

      // One-shot publication is the final synchronous frontier. The trusted
      // executor must begin the destructive effect before yielding again.
      record.status = 'consumed';
      activeByTask.delete(record.taskKey);
      return approved();
    } finally {
      consumeMutationActive = false;
    }
  }

  function invalidateOperation(operation, reason, publicReason = reason) {
    operation.invalidated = true;
    operation.reason = reason;
    operation.publicReason = publicReason;
    if (!operation.abortController.signal.aborted) operation.abortController.abort();
  }

  function cancelJob(input = {}) {
    const normalized = normalizePublicCancelInput(input);
    if (!normalized) return Object.freeze({ ok: false, canceled: 0, revoked: 0 });
    cancelSerial += 1;
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      if (!bindingsMatch(operation.input.binding, normalized.binding)) continue;
      invalidateOperation(
        operation,
        normalized.reason,
        NATIVE_EFFECT_APPROVAL_REASONS.CANCELED
      );
      canceled += 1;
    }
    for (const record of recordsByExact.values()) {
      if (record.status !== 'active' || !bindingsMatch(record.binding, normalized.binding)) continue;
      record.status = 'revoked';
      record.revocationReason = normalized.reason;
      if (activeByTask.get(record.taskKey) === record) activeByTask.delete(record.taskKey);
      revoked += 1;
    }
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function invalidateWindow(reasonInput) {
    const reason = normalizeReason(reasonInput, NATIVE_EFFECT_APPROVAL_REASONS.WINDOW_INVALIDATED);
    generation += 1;
    let currentLease = null;
    const current = invokeExternal(getWindowLease);
    if (current.ok && isOpaqueLease(current.value)) currentLease = current.value;
    const leases = new Set();
    if (currentLease) leases.add(currentLease);
    for (const operation of pendingByTask.values()) leases.add(operation.input.windowLease);
    for (const record of recordsByExact.values()) leases.add(record.windowLease);
    for (const lease of leases) {
      if (!invalidatedLeases.has(lease)) {
        invalidatedLeases.add(lease);
        invalidatedLeaseCount += 1;
      }
    }
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      invalidateOperation(
        operation,
        reason,
        NATIVE_EFFECT_APPROVAL_REASONS.WINDOW_INVALIDATED
      );
      canceled += 1;
    }
    for (const record of recordsByExact.values()) {
      if (record.status !== 'active') continue;
      record.status = 'revoked';
      record.revocationReason = reason;
      if (activeByTask.get(record.taskKey) === record) activeByTask.delete(record.taskKey);
      revoked += 1;
    }
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function clear() {
    generation += 1;
    const canceled = pendingByTask.size;
    const revoked = activeByTask.size;
    const leases = new Set();
    const current = invokeExternal(getWindowLease);
    if (current.ok && isOpaqueLease(current.value)) leases.add(current.value);
    for (const operation of pendingByTask.values()) {
      leases.add(operation.input.windowLease);
      invalidateOperation(operation, NATIVE_EFFECT_APPROVAL_REASONS.CLEARED);
    }
    for (const record of recordsByExact.values()) leases.add(record.windowLease);
    for (const lease of leases) {
      if (!invalidatedLeases.has(lease)) {
        invalidatedLeases.add(lease);
        invalidatedLeaseCount += 1;
      }
    }
    pendingByTask.clear();
    activeByTask.clear();
    recordsByExact.clear();
    recordsById.clear();
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function diagnostics() {
    if (!externalCallbackActive && !normalizationActive && !consumeMutationActive && authorityHealthy) {
      const checkedAt = readNow();
      if (checkedAt !== null) purgeExpiredRecords(checkedAt);
    }
    return Object.freeze({
      version: NATIVE_EFFECT_APPROVAL_SERVICE_VERSION,
      pendingDialogs: pendingByTask.size,
      activeDecisions: activeByTask.size,
      decisionRecords: recordsByExact.size,
      maxPendingDialogs: caps.maxPendingDialogs,
      maxDecisionRecords: caps.maxDecisionRecords,
      decisionTtlMs,
      invalidatedWindowLeases: invalidatedLeaseCount,
      authorityHealthy,
      defaultDecision: 'deny',
      persistence: 'process_local',
      authorityBoundary: 'main_process_only',
    });
  }

  return Object.freeze({
    requestDecision,
    consumeDecision,
    cancelJob,
    invalidateWindow,
    clear,
    diagnostics,
  });
}

class NativeEffectApprovalService {
  constructor(options = {}) {
    Object.assign(this, createNativeEffectApprovalService(options));
    Object.freeze(this);
  }
}

module.exports = {
  DEFAULT_EFFECT_DECISION_TTL_MS,
  DEFAULT_NATIVE_EFFECT_APPROVAL_CAPS,
  FIXED_EFFECT_APPROVAL_DIALOG,
  HARD_MAX_APPROVAL_RECORDS,
  HARD_MAX_DISPLAY_PATHS,
  HARD_MAX_PENDING_DIALOGS,
  MAX_EFFECT_DECISION_TTL_MS,
  NATIVE_EFFECT_APPROVAL_REASONS,
  NATIVE_EFFECT_APPROVAL_SERVICE_VERSION,
  NativeEffectApprovalService,
  createNativeEffectApprovalService,
};
