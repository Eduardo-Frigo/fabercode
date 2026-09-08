'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');

const AGENTIC_VISUAL_CAPTURE_APPROVAL_SERVICE_VERSION =
  'agentic-visual-capture-approval-service.v1';
const DEFAULT_VISUAL_CAPTURE_APPROVAL_TTL_MS = 60 * 1000;
const MAX_VISUAL_CAPTURE_APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_VISUAL_CAPTURE_DIALOGS = 64;
const DIALOG_ALLOW_RESPONSE = 1;

const VISUAL_CAPTURE_APPROVAL_REASONS = Object.freeze({
  APPROVED: 'visual_capture_approved',
  BUSY: 'visual_capture_busy',
  CANCELED: 'visual_capture_canceled',
  CLEARED: 'visual_capture_cleared',
  CLOCK_INVALID: 'visual_capture_clock_invalid',
  CONSUMED: 'visual_capture_consumed',
  DENIED: 'visual_capture_denied',
  DIALOG_FAILED: 'visual_capture_dialog_failed',
  EVENT_PERSIST_FAILED: 'visual_capture_event_persist_failed',
  EXPIRED: 'visual_capture_expired',
  FRONTIER_INVALIDATED: 'visual_capture_frontier_invalidated',
  INVALID_INPUT: 'visual_capture_invalid_input',
  LIFECYCLE_INVALIDATED: 'visual_capture_lifecycle_invalidated',
  MISMATCH: 'visual_capture_mismatch',
  NOT_FOUND: 'visual_capture_not_found',
  REPLAYED: 'visual_capture_replayed',
  REVOKED: 'visual_capture_revoked',
  ROOT_INVALIDATED: 'visual_capture_root_invalidated',
  SIGNAL_INVALIDATED: 'visual_capture_signal_invalidated',
  WINDOW_INVALIDATED: 'visual_capture_window_invalidated',
});

const VISUAL_CAPTURE_APPROVAL_EVENTS = Object.freeze({
  REQUESTED: 'job.agentic_visual_capture_approval_requested',
  APPROVED: 'job.agentic_visual_capture_approval_approved',
  DENIED: 'job.agentic_visual_capture_approval_denied',
});

const FIXED_VISUAL_CAPTURE_APPROVAL_DIALOG = Object.freeze({
  type: 'warning',
  title: 'Autorizar captura visual',
  message: 'Permitir que a IA capture o viewport atual?',
  buttons: Object.freeze(['Cancelar', 'Capturar uma vez']),
  defaultId: 0,
  cancelId: 0,
  noLink: true,
});

const OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeCaptureFrontier',
  'getWindowLease',
  'recordJobEvent',
  'getSignal',
  'now',
  'approvalTtlMs',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeCaptureFrontier',
  'getWindowLease',
  'recordJobEvent',
  'getSignal',
]);
const APPROVAL_INPUT_KEYS = Object.freeze([
  'binding',
  'browserSessionId',
  'browserSessionSnapshotDigest',
  'callId',
  'invocationId',
  'requestDigest',
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
const SAFE_ID = /^[A-Za-z0-9._:@-]{1,256}$/;
const UNSAFE_DISPLAY_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

function isPlainDataRecord(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return false;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return false;
  return keys.every((key) => {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return false;
    }
    return Boolean(descriptor && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value') && descriptor.value !== undefined);
  });
}

function dataProperty(value, key) {
  return Object.getOwnPropertyDescriptor(value, key).value;
}

function safeDataValue(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')
    || util.types.isProxy(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function isOpaqueObject(value) {
  return Boolean(value)
    && (typeof value === 'object' || typeof value === 'function')
    && !util.types.isProxy(value);
}

function bindingsMatch(left, right) {
  return BINDING_FIELDS.every((field) => left[field] === right[field]);
}

function normalizeSafeId(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function normalizeProjectLabel(value) {
  if (typeof value !== 'string') throw new TypeError('projectLabel must be text');
  const normalized = value.trim();
  if (!normalized || normalized.length > 160
    || UNSAFE_DISPLAY_CHARACTERS.test(normalized)) {
    throw new TypeError('projectLabel must be safe display text');
  }
  return normalized;
}

function normalizeApprovalInput(raw, includeReceipt = false) {
  const keys = includeReceipt ? CONSUME_INPUT_KEYS : APPROVAL_INPUT_KEYS;
  if (!isPlainDataRecord(raw, keys, keys)) {
    throw new TypeError('Visual capture approval input is invalid');
  }
  const normalized = {
    binding: createCapabilityDelegationBinding(dataProperty(raw, 'binding')),
    browserSessionId: normalizeSafeId(
      dataProperty(raw, 'browserSessionId'),
      'browserSessionId'
    ),
    browserSessionSnapshotDigest: normalizeDigest(
      dataProperty(raw, 'browserSessionSnapshotDigest'),
      'browserSessionSnapshotDigest'
    ),
    callId: normalizeSafeId(dataProperty(raw, 'callId'), 'callId'),
    invocationId: normalizeSafeId(dataProperty(raw, 'invocationId'), 'invocationId'),
    requestDigest: normalizeDigest(dataProperty(raw, 'requestDigest'), 'requestDigest'),
    projectLabel: normalizeProjectLabel(dataProperty(raw, 'projectLabel')),
  };
  if (includeReceipt) {
    const receipt = dataProperty(raw, 'receipt');
    if (!isOpaqueObject(receipt)) throw new TypeError('receipt must be opaque');
    normalized.receipt = receipt;
  }
  return Object.freeze(normalized);
}

function normalizeCancelInput(raw) {
  if (!isPlainDataRecord(raw, CANCEL_INPUT_KEYS, CANCEL_INPUT_KEYS)) {
    throw new TypeError('Visual capture cancellation input is invalid');
  }
  return createCapabilityDelegationBinding(dataProperty(raw, 'binding'));
}

function deniedRequest(reason, ok = false) {
  return Object.freeze({ ok, approved: false, reason });
}

function approvedRequest(receipt) {
  return Object.freeze({
    ok: true,
    approved: true,
    reason: VISUAL_CAPTURE_APPROVAL_REASONS.APPROVED,
    receipt,
  });
}

function consumptionResult(authorized, reason) {
  return Object.freeze({ ok: authorized, authorized, reason });
}

function nativeDialogAllowed(value) {
  if (!isPlainDataRecord(value, ['response', 'checkboxChecked'], ['response'])) return false;
  if (Object.hasOwn(value, 'checkboxChecked')
    && typeof dataProperty(value, 'checkboxChecked') !== 'boolean') return false;
  return dataProperty(value, 'response') === DIALOG_ALLOW_RESPONSE;
}

function createDialogPayload(input) {
  return Object.freeze({
    ...FIXED_VISUAL_CAPTURE_APPROVAL_DIALOG,
    detail: [
      `Projeto: ${input.projectLabel}`,
      '',
      'Uma imagem do viewport atual será criada para esta tarefa.',
      'A autorização vale uma vez; uma nova captura exigirá outra aprovação.',
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

function createAgenticVisualCaptureApprovalService(options = {}) {
  if (!isPlainDataRecord(options, OPTION_KEYS, REQUIRED_OPTION_KEYS)) {
    throw new TypeError('Visual capture approval options must be a plain data record');
  }
  const showNativeDialog = dataProperty(options, 'showNativeDialog');
  const authorizeLifecycle = dataProperty(options, 'authorizeLifecycle');
  const authorizeRoot = dataProperty(options, 'authorizeRoot');
  const authorizeCaptureFrontier = dataProperty(options, 'authorizeCaptureFrontier');
  const getWindowLease = dataProperty(options, 'getWindowLease');
  const recordJobEvent = dataProperty(options, 'recordJobEvent');
  const getSignal = dataProperty(options, 'getSignal');
  const now = Object.hasOwn(options, 'now') ? dataProperty(options, 'now') : () => Date.now();
  const approvalTtlMs = Object.hasOwn(options, 'approvalTtlMs')
    ? dataProperty(options, 'approvalTtlMs')
    : DEFAULT_VISUAL_CAPTURE_APPROVAL_TTL_MS;
  for (const [name, callback] of [
    ['showNativeDialog', showNativeDialog],
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeCaptureFrontier', authorizeCaptureFrontier],
    ['getWindowLease', getWindowLease],
    ['recordJobEvent', recordJobEvent],
    ['getSignal', getSignal],
    ['now', now],
  ]) {
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${name} must be a trusted function`);
    }
  }
  if (!Number.isSafeInteger(approvalTtlMs) || approvalTtlMs <= 0
    || approvalTtlMs > MAX_VISUAL_CAPTURE_APPROVAL_TTL_MS) {
    throw new TypeError('approvalTtlMs is invalid');
  }

  const pendingByTask = new Map();
  const activeByTask = new Map();
  const recordsByReceipt = new WeakMap();
  const leaseIds = new WeakMap();
  let nextLeaseId = 1;
  let generation = 0;
  let lastObservedAt = -1;
  let durableEventFailures = 0;

  function leaseId(lease) {
    let id = leaseIds.get(lease);
    if (id !== undefined) return id;
    id = nextLeaseId;
    nextLeaseId += 1;
    leaseIds.set(lease, id);
    return id;
  }

  function readNow() {
    let value;
    try {
      value = now();
      if (value instanceof Date) value = Date.prototype.getTime.call(value);
    } catch {
      return null;
    }
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)
      || value < lastObservedAt) return null;
    lastObservedAt = value;
    return value;
  }

  function taskKey(input) {
    return JSON.stringify([
      input.binding.jobId,
      input.binding.sessionId,
      input.invocationId,
    ]);
  }

  function exactKey(input, windowLease) {
    return JSON.stringify([
      ...BINDING_FIELDS.map((field) => input.binding[field]),
      leaseId(windowLease),
      input.browserSessionId,
      input.browserSessionSnapshotDigest,
      input.callId,
      input.invocationId,
      input.requestDigest,
      input.projectLabel,
    ]);
  }

  function authorizationBindingMatches(value, binding) {
    const candidate = safeDataValue(value, 'binding');
    if (safeDataValue(value, 'authorized') !== true || candidate === undefined) return false;
    try {
      return bindingsMatch(createCapabilityDelegationBinding(candidate), binding);
    } catch {
      return false;
    }
  }

  function signalFor(binding) {
    try {
      const signal = getSignal(binding);
      if (!signal || typeof signal !== 'object' || util.types.isProxy(signal)
        || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function'
        || typeof signal.removeEventListener !== 'function'
        || (typeof AbortSignal === 'function' && !(signal instanceof AbortSignal))) {
        return null;
      }
      return signal;
    } catch {
      return null;
    }
  }

  function authorityFailure(input, windowLease, expectedSignal = null) {
    let currentLease;
    let lifecycle;
    let root;
    let frontier;
    try {
      currentLease = getWindowLease();
      if (currentLease !== windowLease) {
        return VISUAL_CAPTURE_APPROVAL_REASONS.WINDOW_INVALIDATED;
      }
      lifecycle = authorizeLifecycle(input.binding);
      if (!authorizationBindingMatches(lifecycle, input.binding)) {
        return VISUAL_CAPTURE_APPROVAL_REASONS.LIFECYCLE_INVALIDATED;
      }
      root = authorizeRoot(Object.freeze({
        projectId: input.binding.projectId,
        rootPath: input.binding.canonicalRootPath,
      }));
      const rootPath = safeDataValue(root, 'canonicalRootPath')
        || safeDataValue(root, 'rootPath');
      if (safeDataValue(root, 'authorized') !== true
        || safeDataValue(root, 'projectId') !== input.binding.projectId
        || rootPath !== input.binding.canonicalRootPath
        || safeDataValue(root, 'realRootPath') !== input.binding.realRootPath) {
        return VISUAL_CAPTURE_APPROVAL_REASONS.ROOT_INVALIDATED;
      }
      frontier = authorizeCaptureFrontier(Object.freeze({
        binding: input.binding,
        windowLease,
        browserSessionId: input.browserSessionId,
        browserSessionSnapshotDigest: input.browserSessionSnapshotDigest,
        callId: input.callId,
        invocationId: input.invocationId,
        requestDigest: input.requestDigest,
      }));
    } catch {
      return VISUAL_CAPTURE_APPROVAL_REASONS.FRONTIER_INVALIDATED;
    }
    if (!authorizationBindingMatches(frontier, input.binding)
      || safeDataValue(frontier, 'windowLease') !== windowLease
      || safeDataValue(frontier, 'browserSessionId') !== input.browserSessionId
      || safeDataValue(frontier, 'browserSessionSnapshotDigest')
        !== input.browserSessionSnapshotDigest
      || safeDataValue(frontier, 'callId') !== input.callId
      || safeDataValue(frontier, 'invocationId') !== input.invocationId
      || safeDataValue(frontier, 'requestDigest') !== input.requestDigest) {
      return VISUAL_CAPTURE_APPROVAL_REASONS.FRONTIER_INVALIDATED;
    }
    const signal = signalFor(input.binding);
    if (!signal || (expectedSignal && signal !== expectedSignal)) {
      return VISUAL_CAPTURE_APPROVAL_REASONS.SIGNAL_INVALIDATED;
    }
    return signal.aborted === true ? VISUAL_CAPTURE_APPROVAL_REASONS.CANCELED : '';
  }

  function safeEventReason(reason) {
    const normalized = String(reason || 'unknown');
    return normalized.startsWith('visual_capture_')
      ? normalized.slice('visual_capture_'.length)
      : normalized.replace(/[^a-z0-9_]/g, '').slice(0, 80) || 'unknown';
  }

  function recordEvent(input, type, reason) {
    const payload = Object.freeze({
      approvalScope: 'single_digest_bound_capture',
      reason: safeEventReason(reason),
    });
    try {
      const result = recordJobEvent(input.binding.jobId, type, payload);
      const persisted = !util.types.isPromise(result)
        && safeDataValue(result, 'ok') === true;
      if (!persisted) durableEventFailures += 1;
      return persisted;
    } catch {
      durableEventFailures += 1;
      return false;
    }
  }

  function recordDenied(input, reason) {
    return recordEvent(input, VISUAL_CAPTURE_APPROVAL_EVENTS.DENIED, reason);
  }

  function createOperationSignal() {
    return {
      controller: new AbortController(),
      externalSignal: null,
      onExternalAbort: null,
    };
  }

  function attachOperationSignal(operation) {
    const externalSignal = signalFor(operation.input.binding);
    operation.signalRecord.externalSignal = externalSignal;
    if (!externalSignal) return VISUAL_CAPTURE_APPROVAL_REASONS.SIGNAL_INVALIDATED;
    if (externalSignal.aborted === true) {
      return VISUAL_CAPTURE_APPROVAL_REASONS.CANCELED;
    }
    operation.signalRecord.onExternalAbort = () => {
      terminatePendingOperation(operation, VISUAL_CAPTURE_APPROVAL_REASONS.CANCELED);
    };
    externalSignal.addEventListener(
      'abort',
      operation.signalRecord.onExternalAbort,
      { once: true }
    );
    return '';
  }

  function detachOperationSignal(signalRecord) {
    if (signalRecord.externalSignal && signalRecord.onExternalAbort
      && typeof signalRecord.externalSignal.removeEventListener === 'function') {
      signalRecord.externalSignal.removeEventListener('abort', signalRecord.onExternalAbort);
    }
  }

  function revokeRecord(record, reason) {
    if (record.status !== 'active') return false;
    record.status = 'revoked';
    record.reason = reason;
    if (activeByTask.get(record.taskKey) === record) activeByTask.delete(record.taskKey);
    return true;
  }

  function activeRecordIsCurrent(record, input = record.input) {
    return Boolean(record)
      && record.status === 'active'
      && record.generation === generation
      && record.exactKey === exactKey(input, record.windowLease)
      && activeByTask.get(record.taskKey) === record;
  }

  function revokeRecordWithEvent(record, reason) {
    if (!revokeRecord(record, reason)) return false;
    recordDenied(record.input, reason);
    return true;
  }

  function retireStaleActiveRecord(normalizedTaskKey) {
    const record = activeByTask.get(normalizedTaskKey);
    if (!record) return null;
    if (!activeRecordIsCurrent(record)) {
      activeByTask.delete(normalizedTaskKey);
      return null;
    }
    const checkedAt = readNow();
    if (!activeRecordIsCurrent(record)) return null;
    if (checkedAt === null) {
      revokeRecordWithEvent(record, VISUAL_CAPTURE_APPROVAL_REASONS.CLOCK_INVALID);
      return null;
    }
    if (checkedAt >= record.expiresAt) {
      revokeRecordWithEvent(record, VISUAL_CAPTURE_APPROVAL_REASONS.EXPIRED);
      return null;
    }
    const failure = authorityFailure(
      record.input,
      record.windowLease,
      record.signal
    );
    if (!activeRecordIsCurrent(record)) return null;
    if (failure) {
      revokeRecordWithEvent(record, failure);
      return null;
    }
    return record;
  }

  function pendingOperationIsCurrent(operation) {
    return Boolean(operation)
      && !operation.terminalReason
      && operation.generation === generation
      && pendingByTask.get(operation.taskKey) === operation;
  }

  function recordPendingDenial(operation) {
    if (!operation.requestedPersisted || operation.deniedRecorded) return;
    operation.deniedRecorded = true;
    operation.deniedPersisted = recordDenied(
      operation.input,
      operation.terminalReason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
    );
  }

  function terminatePendingOperation(operation, reason) {
    if (!operation.terminalReason) {
      operation.terminalReason = reason;
      operation.signalRecord.controller.abort();
    }
    recordPendingDenial(operation);
    return operation.terminalReason;
  }

  function deniedPendingResult(operation, fallbackReason, ok = false) {
    const reason = terminatePendingOperation(operation, fallbackReason);
    return deniedRequest(reason, ok && reason === fallbackReason);
  }

  function finishPendingOperation(operation, result) {
    if (operation.settled) return;
    operation.settled = true;
    if (pendingByTask.get(operation.taskKey) === operation) {
      pendingByTask.delete(operation.taskKey);
    }
    detachOperationSignal(operation.signalRecord);
    operation.resolve(result);
  }

  async function runApproval(operation) {
    const signal = operation.signalRecord.controller.signal;
    if (!pendingOperationIsCurrent(operation) || signal.aborted) {
      return deniedPendingResult(
        operation,
        operation.terminalReason || VISUAL_CAPTURE_APPROVAL_REASONS.CANCELED
      );
    }
    const initialFailure = authorityFailure(
      operation.input,
      operation.windowLease,
      operation.signalRecord.externalSignal
    );
    if (!pendingOperationIsCurrent(operation)) {
      return deniedPendingResult(
        operation,
        operation.terminalReason || initialFailure || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (initialFailure) return deniedPendingResult(operation, initialFailure);
    let rawDialog;
    try {
      rawDialog = showNativeDialog(
        createDialogPayload(operation.input),
        Object.freeze({ signal })
      );
      if (rawDialog && typeof rawDialog.then === 'function'
        && !util.types.isPromise(rawDialog)) {
        throw new TypeError('showNativeDialog returned an untrusted thenable');
      }
    } catch {
      return deniedPendingResult(
        operation,
        VISUAL_CAPTURE_APPROVAL_REASONS.DIALOG_FAILED
      );
    }
    if (!pendingOperationIsCurrent(operation)) {
      return deniedPendingResult(
        operation,
        operation.terminalReason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    const attempt = await awaitDialogOrAbort(rawDialog, signal);
    if (!pendingOperationIsCurrent(operation) || attempt.aborted || signal.aborted) {
      return deniedPendingResult(
        operation,
        operation.terminalReason || VISUAL_CAPTURE_APPROVAL_REASONS.CANCELED
      );
    }
    if (attempt.error) {
      return deniedPendingResult(
        operation,
        VISUAL_CAPTURE_APPROVAL_REASONS.DIALOG_FAILED
      );
    }
    const afterDialogFailure = authorityFailure(
      operation.input,
      operation.windowLease,
      operation.signalRecord.externalSignal
    );
    if (!pendingOperationIsCurrent(operation)) {
      return deniedPendingResult(
        operation,
        operation.terminalReason || afterDialogFailure
          || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (afterDialogFailure) return deniedPendingResult(operation, afterDialogFailure);
    if (!nativeDialogAllowed(attempt.value)) {
      return deniedPendingResult(
        operation,
        VISUAL_CAPTURE_APPROVAL_REASONS.DENIED,
        true
      );
    }
    const issuedAt = readNow();
    if (!pendingOperationIsCurrent(operation)) {
      return deniedPendingResult(
        operation,
        operation.terminalReason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (issuedAt === null || issuedAt > Number.MAX_SAFE_INTEGER - approvalTtlMs) {
      return deniedPendingResult(
        operation,
        VISUAL_CAPTURE_APPROVAL_REASONS.CLOCK_INVALID
      );
    }
    const finalFailure = authorityFailure(
      operation.input,
      operation.windowLease,
      operation.signalRecord.externalSignal
    );
    if (!pendingOperationIsCurrent(operation)) {
      return deniedPendingResult(
        operation,
        operation.terminalReason || finalFailure || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (finalFailure) return deniedPendingResult(operation, finalFailure);
    if (activeByTask.has(operation.taskKey)) {
      return deniedPendingResult(operation, VISUAL_CAPTURE_APPROVAL_REASONS.BUSY);
    }
    const receipt = Object.freeze(Object.create(null));
    const record = {
      input: operation.input,
      windowLease: operation.windowLease,
      exactKey: operation.exactKey,
      taskKey: operation.taskKey,
      receipt,
      signal: operation.signalRecord.externalSignal,
      status: 'active',
      reason: '',
      expiresAt: issuedAt + approvalTtlMs,
      generation,
    };
    recordsByReceipt.set(receipt, record);
    activeByTask.set(record.taskKey, record);
    return approvedRequest(receipt);
  }

  function requestApproval(rawInput) {
    let input;
    try {
      input = normalizeApprovalInput(rawInput);
    } catch {
      return Promise.resolve(deniedRequest(VISUAL_CAPTURE_APPROVAL_REASONS.INVALID_INPUT));
    }
    let windowLease;
    try {
      windowLease = getWindowLease();
    } catch {
      windowLease = null;
    }
    if (!isOpaqueObject(windowLease)) {
      return Promise.resolve(deniedRequest(VISUAL_CAPTURE_APPROVAL_REASONS.WINDOW_INVALIDATED));
    }
    const normalizedTaskKey = taskKey(input);
    const normalizedExactKey = exactKey(input, windowLease);
    const pending = pendingByTask.get(normalizedTaskKey);
    if (pending) {
      if (pending.exactKey === normalizedExactKey) return pending.promise;
      if (!recordEvent(
        input,
        VISUAL_CAPTURE_APPROVAL_EVENTS.REQUESTED,
        'pending_user_decision'
      )) {
        return Promise.resolve(deniedRequest(
          VISUAL_CAPTURE_APPROVAL_REASONS.EVENT_PERSIST_FAILED
        ));
      }
      recordDenied(input, VISUAL_CAPTURE_APPROVAL_REASONS.BUSY);
      return Promise.resolve(deniedRequest(VISUAL_CAPTURE_APPROVAL_REASONS.BUSY));
    }
    if (pendingByTask.size >= MAX_PENDING_VISUAL_CAPTURE_DIALOGS) {
      if (!recordEvent(
        input,
        VISUAL_CAPTURE_APPROVAL_EVENTS.REQUESTED,
        'pending_user_decision'
      )) {
        return Promise.resolve(deniedRequest(
          VISUAL_CAPTURE_APPROVAL_REASONS.EVENT_PERSIST_FAILED
        ));
      }
      recordDenied(input, VISUAL_CAPTURE_APPROVAL_REASONS.BUSY);
      return Promise.resolve(deniedRequest(VISUAL_CAPTURE_APPROVAL_REASONS.BUSY));
    }
    let resolveOperation;
    const promise = new Promise((resolve) => { resolveOperation = resolve; });
    const operation = {
      input,
      windowLease,
      taskKey: normalizedTaskKey,
      exactKey: normalizedExactKey,
      signalRecord: createOperationSignal(),
      generation,
      promise,
      resolve: resolveOperation,
      requestedPersisted: false,
      deniedRecorded: false,
      deniedPersisted: null,
      terminalReason: '',
      settled: false,
    };
    pendingByTask.set(normalizedTaskKey, operation);
    const signalFailure = attachOperationSignal(operation);
    const activeRecord = retireStaleActiveRecord(normalizedTaskKey);
    operation.requestedPersisted = recordEvent(
      input,
      VISUAL_CAPTURE_APPROVAL_EVENTS.REQUESTED,
      'pending_user_decision'
    );
    if (!operation.requestedPersisted) {
      operation.terminalReason = VISUAL_CAPTURE_APPROVAL_REASONS.EVENT_PERSIST_FAILED;
      operation.signalRecord.controller.abort();
      finishPendingOperation(operation, deniedRequest(operation.terminalReason));
      return operation.promise;
    }
    if (!pendingOperationIsCurrent(operation)) {
      recordPendingDenial(operation);
      finishPendingOperation(operation, deniedRequest(
        operation.terminalReason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      ));
      return operation.promise;
    }
    if (signalFailure) {
      finishPendingOperation(
        operation,
        deniedPendingResult(operation, signalFailure)
      );
      return operation.promise;
    }
    if (activeRecord && activeRecordIsCurrent(activeRecord)) {
      finishPendingOperation(
        operation,
        deniedPendingResult(operation, VISUAL_CAPTURE_APPROVAL_REASONS.BUSY)
      );
      return operation.promise;
    }
    const runner = runApproval(operation);
    runner.then(
      (result) => finishPendingOperation(operation, result),
      () => finishPendingOperation(
        operation,
        deniedPendingResult(operation, VISUAL_CAPTURE_APPROVAL_REASONS.DIALOG_FAILED)
      )
    );
    return operation.promise;
  }

  function consumeApproval(rawInput) {
    let input;
    try {
      input = normalizeApprovalInput(rawInput, true);
    } catch {
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.INVALID_INPUT);
    }
    const record = recordsByReceipt.get(input.receipt);
    if (!record) {
      recordDenied(input, VISUAL_CAPTURE_APPROVAL_REASONS.NOT_FOUND);
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.NOT_FOUND);
    }
    if (record.status === 'consumed') {
      recordDenied(record.input, VISUAL_CAPTURE_APPROVAL_REASONS.REPLAYED);
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.REPLAYED);
    }
    if (record.status !== 'active') {
      const reason = record.reason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED;
      recordDenied(record.input, reason);
      return consumptionResult(false, reason);
    }
    if (record.exactKey !== exactKey(input, record.windowLease)) {
      recordDenied(record.input, VISUAL_CAPTURE_APPROVAL_REASONS.MISMATCH);
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.MISMATCH);
    }
    const checkedAt = readNow();
    if (!activeRecordIsCurrent(record, input)) {
      return consumptionResult(
        false,
        record.reason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (checkedAt === null) {
      revokeRecordWithEvent(record, VISUAL_CAPTURE_APPROVAL_REASONS.CLOCK_INVALID);
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.CLOCK_INVALID);
    }
    if (checkedAt >= record.expiresAt) {
      revokeRecordWithEvent(record, VISUAL_CAPTURE_APPROVAL_REASONS.EXPIRED);
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.EXPIRED);
    }
    const firstFailure = authorityFailure(
      record.input,
      record.windowLease,
      record.signal
    );
    if (!activeRecordIsCurrent(record, input)) {
      return consumptionResult(
        false,
        record.reason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (firstFailure) {
      revokeRecordWithEvent(record, firstFailure);
      return consumptionResult(false, firstFailure);
    }
    const repeatedFailure = authorityFailure(
      record.input,
      record.windowLease,
      record.signal
    );
    if (!activeRecordIsCurrent(record, input)) {
      return consumptionResult(
        false,
        record.reason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (repeatedFailure) {
      revokeRecordWithEvent(record, repeatedFailure);
      return consumptionResult(false, repeatedFailure);
    }
    if (!recordEvent(
      record.input,
      VISUAL_CAPTURE_APPROVAL_EVENTS.APPROVED,
      VISUAL_CAPTURE_APPROVAL_REASONS.CONSUMED
    )) {
      revokeRecordWithEvent(
        record,
        VISUAL_CAPTURE_APPROVAL_REASONS.EVENT_PERSIST_FAILED
      );
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.EVENT_PERSIST_FAILED);
    }
    if (!activeRecordIsCurrent(record, input)) {
      return consumptionResult(
        false,
        record.reason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    const finalFailure = authorityFailure(
      record.input,
      record.windowLease,
      record.signal
    );
    if (!activeRecordIsCurrent(record, input)) {
      return consumptionResult(
        false,
        record.reason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (finalFailure) {
      revokeRecordWithEvent(record, finalFailure);
      return consumptionResult(false, finalFailure);
    }
    const finalCheckedAt = readNow();
    if (!activeRecordIsCurrent(record, input)) {
      return consumptionResult(
        false,
        record.reason || VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED
      );
    }
    if (finalCheckedAt === null) {
      revokeRecordWithEvent(record, VISUAL_CAPTURE_APPROVAL_REASONS.CLOCK_INVALID);
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.CLOCK_INVALID);
    }
    if (finalCheckedAt >= record.expiresAt) {
      revokeRecordWithEvent(record, VISUAL_CAPTURE_APPROVAL_REASONS.EXPIRED);
      return consumptionResult(false, VISUAL_CAPTURE_APPROVAL_REASONS.EXPIRED);
    }
    record.status = 'consumed';
    record.reason = VISUAL_CAPTURE_APPROVAL_REASONS.REPLAYED;
    activeByTask.delete(record.taskKey);
    return consumptionResult(true, VISUAL_CAPTURE_APPROVAL_REASONS.CONSUMED);
  }

  function cancelJob(rawInput) {
    let candidate;
    try {
      candidate = normalizeCancelInput(rawInput);
    } catch {
      return Object.freeze({ ok: false, canceled: 0, revoked: 0 });
    }
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      if (!bindingsMatch(operation.input.binding, candidate)) continue;
      terminatePendingOperation(operation, VISUAL_CAPTURE_APPROVAL_REASONS.CANCELED);
      canceled += 1;
    }
    for (const record of activeByTask.values()) {
      if (!bindingsMatch(record.input.binding, candidate)) continue;
      if (revokeRecordWithEvent(record, VISUAL_CAPTURE_APPROVAL_REASONS.REVOKED)) {
        revoked += 1;
      }
    }
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function invalidateWindow() {
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      terminatePendingOperation(
        operation,
        VISUAL_CAPTURE_APPROVAL_REASONS.WINDOW_INVALIDATED
      );
      canceled += 1;
    }
    for (const record of activeByTask.values()) {
      if (revokeRecordWithEvent(
        record,
        VISUAL_CAPTURE_APPROVAL_REASONS.WINDOW_INVALIDATED
      )) {
        revoked += 1;
      }
    }
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function clear() {
    generation += 1;
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      terminatePendingOperation(operation, VISUAL_CAPTURE_APPROVAL_REASONS.CLEARED);
      canceled += 1;
    }
    for (const record of activeByTask.values()) {
      if (revokeRecordWithEvent(record, VISUAL_CAPTURE_APPROVAL_REASONS.CLEARED)) {
        revoked += 1;
      }
    }
    pendingByTask.clear();
    activeByTask.clear();
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_VISUAL_CAPTURE_APPROVAL_SERVICE_VERSION,
      pendingDialogs: pendingByTask.size,
      activeApprovals: activeByTask.size,
      ttlMs: approvalTtlMs,
      approvalScope: 'single_digest_bound_capture',
      durableEvents: true,
      durableEventFailures,
      degraded: durableEventFailures > 0,
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

module.exports = {
  AGENTIC_VISUAL_CAPTURE_APPROVAL_SERVICE_VERSION,
  DEFAULT_VISUAL_CAPTURE_APPROVAL_TTL_MS,
  FIXED_VISUAL_CAPTURE_APPROVAL_DIALOG,
  MAX_VISUAL_CAPTURE_APPROVAL_TTL_MS,
  VISUAL_CAPTURE_APPROVAL_EVENTS,
  VISUAL_CAPTURE_APPROVAL_REASONS,
  createAgenticVisualCaptureApprovalService,
};
