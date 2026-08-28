'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  immutableSnapshot,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');

const AGENTIC_VISUAL_EGRESS_APPROVAL_SERVICE_VERSION =
  'agentic-visual-egress-approval-service.v1';
const DEFAULT_VISUAL_EGRESS_APPROVAL_TTL_MS = 60 * 1000;
const MAX_VISUAL_EGRESS_APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_VISUAL_EGRESS_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_VISUAL_EGRESS_DIALOGS = 64;
const DIALOG_ALLOW_RESPONSE = 1;

const VISUAL_EGRESS_APPROVAL_REASONS = Object.freeze({
  APPROVED: 'visual_egress_approved',
  BUSY: 'visual_egress_busy',
  CANCELED: 'visual_egress_canceled',
  CLEARED: 'visual_egress_cleared',
  CLOCK_INVALID: 'visual_egress_clock_invalid',
  CONSUMED: 'visual_egress_consumed',
  DENIED: 'visual_egress_denied',
  DIALOG_FAILED: 'visual_egress_dialog_failed',
  EXPIRED: 'visual_egress_expired',
  FRONTIER_INVALIDATED: 'visual_egress_frontier_invalidated',
  INVALID_INPUT: 'visual_egress_invalid_input',
  LIFECYCLE_INVALIDATED: 'visual_egress_lifecycle_invalidated',
  MISMATCH: 'visual_egress_mismatch',
  NOT_FOUND: 'visual_egress_not_found',
  REPLAYED: 'visual_egress_replayed',
  REVOKED: 'visual_egress_revoked',
  ROOT_INVALIDATED: 'visual_egress_root_invalidated',
  WINDOW_INVALIDATED: 'visual_egress_window_invalidated',
});

const FIXED_VISUAL_EGRESS_APPROVAL_DIALOG = Object.freeze({
  type: 'warning',
  title: 'Autorizar envio da captura',
  message: 'Permitir que esta captura seja enviada ao provedor de IA?',
  buttons: Object.freeze(['Cancelar', 'Permitir esta captura']),
  defaultId: 0,
  cancelId: 0,
  noLink: true,
});

const OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEgressFrontier',
  'getWindowLease',
  'now',
  'approvalTtlMs',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeEgressFrontier',
  'getWindowLease',
]);
const APPROVAL_INPUT_KEYS = Object.freeze([
  'binding',
  'windowLease',
  'providerId',
  'providerLabel',
  'providerOrigin',
  'payloadDigest',
  'mimeType',
  'bytes',
  'projectLabel',
]);
const CONSUME_INPUT_KEYS = Object.freeze([...APPROVAL_INPUT_KEYS, 'receipt']);
const CANCEL_INPUT_KEYS = Object.freeze(['binding']);
const BINDING_FIELDS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const SAFE_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const UNSAFE_DISPLAY_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

function isPlainDataRecord(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || util.types.isProxy(value)) {
    return false;
  }
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
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      return false;
    }
  }
  return true;
}

function dataProperty(value, key) {
  return Object.getOwnPropertyDescriptor(value, key).value;
}

function isOpaqueObject(value) {
  return Boolean(value)
    && (typeof value === 'object' || typeof value === 'function')
    && !util.types.isProxy(value);
}

function bindingsMatch(left, right) {
  return BINDING_FIELDS.every((field) => left[field] === right[field]);
}

function normalizeTtl(value) {
  const ttl = value === undefined ? DEFAULT_VISUAL_EGRESS_APPROVAL_TTL_MS : value;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_VISUAL_EGRESS_APPROVAL_TTL_MS) {
    throw new TypeError(
      `approvalTtlMs must be a positive safe integer at most ${MAX_VISUAL_EGRESS_APPROVAL_TTL_MS}`
    );
  }
  return ttl;
}

function normalizeProviderId(value) {
  if (typeof value !== 'string' || !SAFE_PROVIDER_ID_PATTERN.test(value)) {
    throw new TypeError('providerId must be a safe lowercase identifier');
  }
  return value;
}

function normalizeDisplayLabel(value, fieldName, maximumLength) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength
    || UNSAFE_DISPLAY_CHARACTERS.test(normalized)) {
    throw new TypeError(`${fieldName} must be safe display text`);
  }
  return normalized;
}

function normalizeProviderOrigin(value) {
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new TypeError('providerOrigin must be an exact HTTPS origin');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('providerOrigin must be an exact HTTPS origin');
  }
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== '/'
    || parsed.origin !== value) {
    throw new TypeError('providerOrigin must be an exact HTTPS origin');
  }
  return parsed.origin;
}

function normalizeImageBytes(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_VISUAL_EGRESS_IMAGE_BYTES) {
    throw new TypeError(`bytes must be between 1 and ${MAX_VISUAL_EGRESS_IMAGE_BYTES}`);
  }
  return value;
}

function normalizeApprovalInput(input) {
  if (!isPlainDataRecord(input, APPROVAL_INPUT_KEYS)) {
    throw new TypeError('approval input must be a plain data record');
  }
  const mimeType = dataProperty(input, 'mimeType');
  if (mimeType !== 'image/png') throw new TypeError('mimeType must be image/png');
  const windowLease = dataProperty(input, 'windowLease');
  if (!isOpaqueObject(windowLease)) throw new TypeError('windowLease must be opaque');
  return Object.freeze({
    binding: createCapabilityDelegationBinding(dataProperty(input, 'binding')),
    windowLease,
    providerId: normalizeProviderId(dataProperty(input, 'providerId')),
    providerLabel: normalizeDisplayLabel(
      dataProperty(input, 'providerLabel'),
      'providerLabel',
      96
    ),
    providerOrigin: normalizeProviderOrigin(dataProperty(input, 'providerOrigin')),
    payloadDigest: normalizeDigest(dataProperty(input, 'payloadDigest'), 'payloadDigest'),
    mimeType: 'image/png',
    bytes: normalizeImageBytes(dataProperty(input, 'bytes')),
    projectLabel: normalizeDisplayLabel(
      dataProperty(input, 'projectLabel'),
      'projectLabel',
      160
    ),
  });
}

function normalizeConsumeInput(input) {
  if (!isPlainDataRecord(input, CONSUME_INPUT_KEYS)) {
    throw new TypeError('consume input must be a plain data record');
  }
  const approvalFields = {};
  for (const key of APPROVAL_INPUT_KEYS) approvalFields[key] = dataProperty(input, key);
  const receipt = dataProperty(input, 'receipt');
  if (!isOpaqueObject(receipt)) throw new TypeError('receipt must be opaque');
  return Object.freeze({ ...normalizeApprovalInput(approvalFields), receipt });
}

function normalizeCancelInput(input) {
  if (!isPlainDataRecord(input, CANCEL_INPUT_KEYS)) {
    throw new TypeError('cancel input must be a plain data record');
  }
  return createCapabilityDelegationBinding(dataProperty(input, 'binding'));
}

function deniedRequest(reason, ok = false) {
  return Object.freeze({ ok, approved: false, reason });
}

function approvedRequest(receipt) {
  return Object.freeze({
    ok: true,
    approved: true,
    reason: VISUAL_EGRESS_APPROVAL_REASONS.APPROVED,
    receipt,
  });
}

function deniedConsumption(reason) {
  return Object.freeze({ ok: false, authorized: false, reason });
}

function authorizedConsumption() {
  return Object.freeze({
    ok: true,
    authorized: true,
    reason: VISUAL_EGRESS_APPROVAL_REASONS.CONSUMED,
  });
}

function nativeDialogAllowed(value) {
  if (!isPlainDataRecord(value, ['response', 'checkboxChecked'], ['response'])) return false;
  if (Object.hasOwn(value, 'checkboxChecked')
    && typeof dataProperty(value, 'checkboxChecked') !== 'boolean') return false;
  return dataProperty(value, 'response') === DIALOG_ALLOW_RESPONSE;
}

function formatByteCount(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function createDialogPayload(input) {
  return Object.freeze({
    ...FIXED_VISUAL_EGRESS_APPROVAL_DIALOG,
    detail: [
      `Projeto: ${input.projectLabel}`,
      `Provedor: ${input.providerLabel}`,
      `Destino: ${input.providerOrigin}`,
      `Conteúdo: PNG, ${formatByteCount(input.bytes)} bytes.`,
      '',
      'A autorização cobre somente esta tarefa e esta captura.',
      'Uma nova captura ou outro destino exigirá nova aprovação.',
    ].join('\n'),
  });
}

function awaitDialogOrAbort(dialogPromise, signal) {
  if (signal.aborted) {
    return Promise.resolve(Object.freeze({ aborted: true, value: null }));
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(Object.freeze({ aborted: true, value: null }));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(dialogPromise).then(
      (value) => finish(Object.freeze({ aborted: false, value })),
      (error) => finish(Object.freeze({ aborted: false, error, value: null }))
    );
  });
}

function createAgenticVisualEgressApprovalService(options = {}) {
  if (!isPlainDataRecord(options, OPTION_KEYS, REQUIRED_OPTION_KEYS)) {
    throw new TypeError('Visual egress approval options must be a plain data record');
  }
  const showNativeDialog = dataProperty(options, 'showNativeDialog');
  const authorizeLifecycle = dataProperty(options, 'authorizeLifecycle');
  const authorizeRoot = dataProperty(options, 'authorizeRoot');
  const authorizeEgressFrontier = dataProperty(options, 'authorizeEgressFrontier');
  const getWindowLease = dataProperty(options, 'getWindowLease');
  const now = Object.hasOwn(options, 'now') ? dataProperty(options, 'now') : () => Date.now();
  const approvalTtlMs = normalizeTtl(
    Object.hasOwn(options, 'approvalTtlMs')
      ? dataProperty(options, 'approvalTtlMs')
      : undefined
  );
  for (const [name, callback] of [
    ['showNativeDialog', showNativeDialog],
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEgressFrontier', authorizeEgressFrontier],
    ['getWindowLease', getWindowLease],
    ['now', now],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }

  const pendingByTask = new Map();
  const activeByTask = new Map();
  const recordsByReceipt = new WeakMap();
  const leaseIds = new WeakMap();
  const invalidatedLeases = new WeakSet();
  let nextLeaseId = 1;
  let generation = 0;
  let externalCallbackActive = false;
  let lastObservedAt = -1;
  let authorityHealthy = true;

  function leaseId(lease) {
    let id = leaseIds.get(lease);
    if (id !== undefined) return id;
    if (!Number.isSafeInteger(nextLeaseId)) return 0;
    id = nextLeaseId;
    nextLeaseId += 1;
    leaseIds.set(lease, id);
    return id;
  }

  function taskKey(input) {
    return JSON.stringify([
      leaseId(input.windowLease),
      input.binding.projectId,
      input.binding.sessionId,
      input.binding.jobId,
      input.binding.kernelId,
    ]);
  }

  function exactKey(input) {
    return JSON.stringify([
      taskKey(input),
      input.binding.canonicalRootPath,
      input.binding.realRootPath,
      input.binding.submissionDigest,
      input.providerId,
      input.providerLabel,
      input.providerOrigin,
      input.payloadDigest,
      input.mimeType,
      input.bytes,
      input.projectLabel,
    ]);
  }

  function invokeSync(callback, args = [], { snapshot = false } = {}) {
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

  function readNow() {
    const result = invokeSync(now);
    const value = result.ok && result.value instanceof Date
      ? Date.prototype.getTime.call(result.value)
      : result.value;
    if (!result.ok || !Number.isSafeInteger(value) || value < 0
      || Object.is(value, -0) || value < lastObservedAt) {
      authorityHealthy = false;
      generation += 1;
      return null;
    }
    lastObservedAt = value;
    return value;
  }

  function operationIsCurrent(operation) {
    return authorityHealthy
      && !operation.invalidated
      && operation.generation === generation
      && pendingByTask.get(operation.taskKey) === operation;
  }

  function recordIsCurrent(record) {
    return authorityHealthy
      && record.status === 'active'
      && record.generation === generation
      && activeByTask.get(record.taskKey) === record;
  }

  function snapshotAuthorization(callback, args) {
    const result = invokeSync(callback, args, { snapshot: true });
    return result.ok ? result.value : null;
  }

  function authorizationBindingMatches(value, binding) {
    if (!value || value.authorized !== true || value.binding === undefined) return false;
    try {
      return bindingsMatch(createCapabilityDelegationBinding(value.binding), binding);
    } catch {
      return false;
    }
  }

  function baseFrontierFailure(input, currentCheck) {
    if (!currentCheck() || invalidatedLeases.has(input.windowLease)) {
      return VISUAL_EGRESS_APPROVAL_REASONS.WINDOW_INVALIDATED;
    }
    const currentLease = invokeSync(getWindowLease);
    if (!currentLease.ok || currentLease.value !== input.windowLease || !currentCheck()) {
      return VISUAL_EGRESS_APPROVAL_REASONS.WINDOW_INVALIDATED;
    }
    const lifecycle = snapshotAuthorization(authorizeLifecycle, [input.binding]);
    if (!authorizationBindingMatches(lifecycle, input.binding) || !currentCheck()) {
      return VISUAL_EGRESS_APPROVAL_REASONS.LIFECYCLE_INVALIDATED;
    }
    const root = snapshotAuthorization(authorizeRoot, [input.binding]);
    if (!authorizationBindingMatches(root, input.binding) || !currentCheck()) {
      return VISUAL_EGRESS_APPROVAL_REASONS.ROOT_INVALIDATED;
    }
    const repeatedLease = invokeSync(getWindowLease);
    if (!repeatedLease.ok || repeatedLease.value !== input.windowLease
      || invalidatedLeases.has(input.windowLease) || !currentCheck()) {
      return VISUAL_EGRESS_APPROVAL_REASONS.WINDOW_INVALIDATED;
    }
    const repeatedLifecycle = snapshotAuthorization(authorizeLifecycle, [input.binding]);
    if (!authorizationBindingMatches(repeatedLifecycle, input.binding) || !currentCheck()) {
      return VISUAL_EGRESS_APPROVAL_REASONS.LIFECYCLE_INVALIDATED;
    }
    const repeatedRoot = snapshotAuthorization(authorizeRoot, [input.binding]);
    if (!authorizationBindingMatches(repeatedRoot, input.binding) || !currentCheck()) {
      return VISUAL_EGRESS_APPROVAL_REASONS.ROOT_INVALIDATED;
    }
    return currentCheck() ? '' : VISUAL_EGRESS_APPROVAL_REASONS.REVOKED;
  }

  function egressFrontierIsAuthorized(input, currentCheck) {
    if (!currentCheck()) return false;
    const candidate = Object.freeze({
      binding: input.binding,
      windowLease: input.windowLease,
      providerId: input.providerId,
      providerOrigin: input.providerOrigin,
      payloadDigest: input.payloadDigest,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
    const result = invokeSync(authorizeEgressFrontier, [candidate]);
    const authorization = result.ok ? result.value : null;
    if (!isPlainDataRecord(authorization, [
      'authorized',
      'binding',
      'windowLease',
      'providerOrigin',
      'payloadDigest',
    ])
      || dataProperty(authorization, 'authorized') !== true
      || dataProperty(authorization, 'windowLease') !== input.windowLease
      || dataProperty(authorization, 'providerOrigin') !== input.providerOrigin
      || dataProperty(authorization, 'payloadDigest') !== input.payloadDigest
      || !authorizationBindingMatches(Object.freeze({
        authorized: true,
        binding: dataProperty(authorization, 'binding'),
      }), input.binding)
      || !currentCheck()) {
      return false;
    }
    return true;
  }

  function invokeDialog(operation) {
    if (externalCallbackActive) {
      return Promise.reject(new TypeError('native dialog reentrancy is not allowed'));
    }
    externalCallbackActive = true;
    try {
      const result = showNativeDialog(
        createDialogPayload(operation.input),
        Object.freeze({ signal: operation.abortController.signal })
      );
      if (result && typeof result.then === 'function' && !(result instanceof Promise)) {
        throw new TypeError('showNativeDialog must return plain data or a native Promise');
      }
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    } finally {
      externalCallbackActive = false;
    }
  }

  function revokeRecord(record, reason) {
    if (record.status !== 'active') return false;
    record.status = 'revoked';
    record.reason = reason;
    if (activeByTask.get(record.taskKey) === record) activeByTask.delete(record.taskKey);
    return true;
  }

  async function runRequest(operation) {
    try {
      const currentCheck = () => operationIsCurrent(operation);
      const checkedAt = readNow();
      if (checkedAt === null) return deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.CLOCK_INVALID);
      const initialFailure = baseFrontierFailure(operation.input, currentCheck);
      if (initialFailure) return deniedRequest(initialFailure);

      const dialogAttempt = await awaitDialogOrAbort(
        invokeDialog(operation),
        operation.abortController.signal
      );
      if (dialogAttempt.aborted || !currentCheck()) {
        return deniedRequest(operation.reason || VISUAL_EGRESS_APPROVAL_REASONS.CANCELED);
      }
      if (dialogAttempt.error) {
        return deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.DIALOG_FAILED);
      }
      const afterDialogFailure = baseFrontierFailure(operation.input, currentCheck);
      if (afterDialogFailure) return deniedRequest(afterDialogFailure);

      let safeDialogResult;
      try {
        safeDialogResult = immutableSnapshot(dialogAttempt.value);
      } catch {
        safeDialogResult = null;
      }
      if (!currentCheck()) {
        return deniedRequest(operation.reason || VISUAL_EGRESS_APPROVAL_REASONS.REVOKED);
      }
      if (!nativeDialogAllowed(safeDialogResult)) {
        return deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.DENIED, true);
      }
      if (activeByTask.has(operation.taskKey) || !currentCheck()) {
        return deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.BUSY);
      }
      const issuedAt = readNow();
      if (issuedAt === null || issuedAt > Number.MAX_SAFE_INTEGER - approvalTtlMs) {
        return deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.CLOCK_INVALID);
      }
      const finalFailure = baseFrontierFailure(operation.input, currentCheck);
      if (finalFailure) return deniedRequest(finalFailure);

      const receipt = Object.freeze(Object.create(null));
      const record = {
        input: operation.input,
        taskKey: operation.taskKey,
        exactKey: operation.exactKey,
        receipt,
        status: 'active',
        reason: '',
        issuedAt,
        expiresAt: issuedAt + approvalTtlMs,
        generation,
      };
      recordsByReceipt.set(receipt, record);
      activeByTask.set(record.taskKey, record);
      return approvedRequest(receipt);
    } catch {
      return deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.DIALOG_FAILED);
    }
  }

  function requestApproval(rawInput) {
    let input;
    try {
      input = normalizeApprovalInput(rawInput);
    } catch {
      return Promise.resolve(deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.INVALID_INPUT));
    }
    if (!authorityHealthy) {
      return Promise.resolve(deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.REVOKED));
    }
    const normalizedTaskKey = taskKey(input);
    if (!normalizedTaskKey || pendingByTask.size >= MAX_PENDING_VISUAL_EGRESS_DIALOGS) {
      return Promise.resolve(deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.BUSY));
    }
    const normalizedExactKey = exactKey(input);
    const pending = pendingByTask.get(normalizedTaskKey);
    if (pending) {
      return pending.exactKey === normalizedExactKey
        ? pending.promise
        : Promise.resolve(deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.BUSY));
    }
    if (activeByTask.has(normalizedTaskKey)) {
      return Promise.resolve(deniedRequest(VISUAL_EGRESS_APPROVAL_REASONS.BUSY));
    }
    const operation = {
      input,
      taskKey: normalizedTaskKey,
      exactKey: normalizedExactKey,
      abortController: new AbortController(),
      invalidated: false,
      reason: '',
      generation,
      promise: null,
    };
    pendingByTask.set(normalizedTaskKey, operation);
    operation.promise = runRequest(operation).finally(() => {
      if (pendingByTask.get(normalizedTaskKey) === operation) {
        pendingByTask.delete(normalizedTaskKey);
      }
    });
    return operation.promise;
  }

  function consumeApproval(rawInput) {
    let input;
    try {
      input = normalizeConsumeInput(rawInput);
    } catch {
      return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.INVALID_INPUT);
    }
    const record = recordsByReceipt.get(input.receipt);
    if (!record) return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.NOT_FOUND);
    if (record.status === 'consumed') {
      return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.REPLAYED);
    }
    if (record.status !== 'active') {
      return deniedConsumption(record.reason || VISUAL_EGRESS_APPROVAL_REASONS.REVOKED);
    }
    if (record.exactKey !== exactKey(input)) {
      return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.MISMATCH);
    }
    const checkedAt = readNow();
    if (checkedAt === null) {
      revokeRecord(record, VISUAL_EGRESS_APPROVAL_REASONS.CLOCK_INVALID);
      return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.CLOCK_INVALID);
    }
    if (checkedAt >= record.expiresAt) {
      revokeRecord(record, VISUAL_EGRESS_APPROVAL_REASONS.EXPIRED);
      return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.EXPIRED);
    }
    const currentCheck = () => recordIsCurrent(record);
    const firstFailure = baseFrontierFailure(record.input, currentCheck);
    if (firstFailure) {
      revokeRecord(record, firstFailure);
      return deniedConsumption(firstFailure);
    }
    if (!egressFrontierIsAuthorized(record.input, currentCheck)) {
      revokeRecord(record, VISUAL_EGRESS_APPROVAL_REASONS.FRONTIER_INVALIDATED);
      return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.FRONTIER_INVALIDATED);
    }
    const repeatedFailure = baseFrontierFailure(record.input, currentCheck);
    if (repeatedFailure) {
      revokeRecord(record, repeatedFailure);
      return deniedConsumption(repeatedFailure);
    }
    if (!egressFrontierIsAuthorized(record.input, currentCheck)) {
      revokeRecord(record, VISUAL_EGRESS_APPROVAL_REASONS.FRONTIER_INVALIDATED);
      return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.FRONTIER_INVALIDATED);
    }
    if (!recordIsCurrent(record)) {
      revokeRecord(record, VISUAL_EGRESS_APPROVAL_REASONS.REVOKED);
      return deniedConsumption(VISUAL_EGRESS_APPROVAL_REASONS.REVOKED);
    }
    record.status = 'consumed';
    record.reason = VISUAL_EGRESS_APPROVAL_REASONS.REPLAYED;
    activeByTask.delete(record.taskKey);
    return authorizedConsumption();
  }

  function cancelJob(rawInput) {
    let binding;
    try {
      binding = normalizeCancelInput(rawInput);
    } catch {
      return Object.freeze({ ok: false, canceled: 0, revoked: 0 });
    }
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      if (!bindingsMatch(operation.input.binding, binding)) continue;
      operation.invalidated = true;
      operation.reason = VISUAL_EGRESS_APPROVAL_REASONS.CANCELED;
      if (!operation.abortController.signal.aborted) operation.abortController.abort();
      canceled += 1;
    }
    for (const record of activeByTask.values()) {
      if (!bindingsMatch(record.input.binding, binding)) continue;
      if (revokeRecord(record, VISUAL_EGRESS_APPROVAL_REASONS.REVOKED)) revoked += 1;
    }
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function invalidateWindow() {
    const current = invokeSync(getWindowLease);
    const lease = current.ok && isOpaqueObject(current.value) ? current.value : null;
    if (lease) invalidatedLeases.add(lease);
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      if (lease && operation.input.windowLease !== lease) continue;
      operation.invalidated = true;
      operation.reason = VISUAL_EGRESS_APPROVAL_REASONS.WINDOW_INVALIDATED;
      if (!operation.abortController.signal.aborted) operation.abortController.abort();
      canceled += 1;
    }
    for (const record of activeByTask.values()) {
      if (lease && record.input.windowLease !== lease) continue;
      if (revokeRecord(record, VISUAL_EGRESS_APPROVAL_REASONS.WINDOW_INVALIDATED)) revoked += 1;
    }
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function clear() {
    generation += 1;
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      operation.invalidated = true;
      operation.reason = VISUAL_EGRESS_APPROVAL_REASONS.CLEARED;
      if (!operation.abortController.signal.aborted) operation.abortController.abort();
      canceled += 1;
    }
    for (const record of activeByTask.values()) {
      if (revokeRecord(record, VISUAL_EGRESS_APPROVAL_REASONS.CLEARED)) revoked += 1;
    }
    pendingByTask.clear();
    activeByTask.clear();
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_VISUAL_EGRESS_APPROVAL_SERVICE_VERSION,
      authorityHealthy,
      pendingDialogs: pendingByTask.size,
      activeApprovals: activeByTask.size,
      ttlMs: approvalTtlMs,
    });
  }

  return Object.freeze({
    requestApproval,
    consumeApproval,
    cancelJob,
    invalidateWindow,
    clear,
    diagnostics,
  });
}

class AgenticVisualEgressApprovalService {
  constructor(options) {
    return createAgenticVisualEgressApprovalService(options);
  }
}

module.exports = {
  AGENTIC_VISUAL_EGRESS_APPROVAL_SERVICE_VERSION,
  DEFAULT_VISUAL_EGRESS_APPROVAL_TTL_MS,
  FIXED_VISUAL_EGRESS_APPROVAL_DIALOG,
  MAX_VISUAL_EGRESS_APPROVAL_TTL_MS,
  MAX_VISUAL_EGRESS_IMAGE_BYTES,
  VISUAL_EGRESS_APPROVAL_REASONS,
  AgenticVisualEgressApprovalService,
  createAgenticVisualEgressApprovalService,
};
