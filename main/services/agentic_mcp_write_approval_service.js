'use strict';

const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');

const AGENTIC_MCP_WRITE_APPROVAL_SERVICE_VERSION =
  'agentic-mcp-write-approval-service.v1';
const DEFAULT_MCP_WRITE_APPROVAL_TTL_MS = 60 * 1000;
const MAX_MCP_WRITE_APPROVAL_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_MCP_WRITE_DIALOGS = 64;
const DIALOG_ALLOW_RESPONSE = 1;

const MCP_WRITE_APPROVAL_REASONS = Object.freeze({
  APPROVED: 'mcp_write_approved',
  BUSY: 'mcp_write_busy',
  CANCELED: 'mcp_write_canceled',
  CLEARED: 'mcp_write_cleared',
  CLOCK_INVALID: 'mcp_write_clock_invalid',
  CONSUMED: 'mcp_write_consumed',
  DENIED: 'mcp_write_denied',
  DIALOG_FAILED: 'mcp_write_dialog_failed',
  EXPIRED: 'mcp_write_expired',
  FRONTIER_INVALIDATED: 'mcp_write_frontier_invalidated',
  INVALID_INPUT: 'mcp_write_invalid_input',
  MISMATCH: 'mcp_write_mismatch',
  NOT_FOUND: 'mcp_write_not_found',
  REPLAYED: 'mcp_write_replayed',
  REVOKED: 'mcp_write_revoked',
});

const FIXED_MCP_WRITE_APPROVAL_DIALOG = Object.freeze({
  type: 'warning',
  title: 'Autorizar escrita externa por MCP',
  message: 'Permitir que a IA execute esta chamada MCP com efeito externo?',
  buttons: Object.freeze(['Cancelar', 'Permitir esta chamada']),
  defaultId: 0,
  cancelId: 0,
  noLink: true,
});

const OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeWriteFrontier',
  'getWindowLease',
  'getSignal',
  'now',
  'approvalTtlMs',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'showNativeDialog',
  'authorizeLifecycle',
  'authorizeRoot',
  'authorizeWriteFrontier',
  'getWindowLease',
]);
const APPROVAL_KEYS = Object.freeze([
  'binding',
  'windowLease',
  'serverId',
  'toolName',
  'invocationDigest',
  'idempotencyKey',
  'riskLevel',
  'projectLabel',
]);
const CONSUME_KEYS = Object.freeze([...APPROVAL_KEYS, 'receipt']);
const BINDING_KEYS = Object.freeze([
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'jobId',
  'kernelId',
  'submissionDigest',
]);
const SERVER_ID = /^[a-z0-9][a-z0-9_.:-]{0,255}$/;
const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const SAFE_ID = /^[A-Za-z0-9._:@-]{1,256}$/;
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
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
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
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
  return BINDING_KEYS.every((key) => left[key] === right[key]);
}

function normalizeDisplay(value, fieldName, maximum) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum
    || UNSAFE_DISPLAY_CHARACTERS.test(normalized)) {
    throw new TypeError(`${fieldName} must be safe display text`);
  }
  return normalized;
}

function normalizeApprovalInput(raw, includeReceipt = false) {
  const allowed = includeReceipt ? CONSUME_KEYS : APPROVAL_KEYS;
  if (!isPlainDataRecord(raw, allowed, allowed)) {
    throw new TypeError('MCP write approval input is invalid');
  }
  const binding = createCapabilityDelegationBinding(dataProperty(raw, 'binding'));
  const windowLease = dataProperty(raw, 'windowLease');
  const serverId = dataProperty(raw, 'serverId');
  const toolName = dataProperty(raw, 'toolName');
  const idempotencyKey = dataProperty(raw, 'idempotencyKey');
  const riskLevel = dataProperty(raw, 'riskLevel');
  if (!isOpaqueObject(windowLease)
    || typeof serverId !== 'string' || !SERVER_ID.test(serverId)
    || typeof toolName !== 'string' || !TOOL_NAME.test(toolName)
    || typeof idempotencyKey !== 'string' || !SAFE_ID.test(idempotencyKey)
    || !RISK_LEVELS.has(riskLevel)) {
    throw new TypeError('MCP write approval input is invalid');
  }
  const normalized = {
    binding,
    windowLease,
    serverId,
    toolName,
    invocationDigest: normalizeDigest(
      dataProperty(raw, 'invocationDigest'),
      'invocationDigest'
    ),
    idempotencyKey,
    riskLevel,
    projectLabel: normalizeDisplay(dataProperty(raw, 'projectLabel'), 'projectLabel', 80),
  };
  if (includeReceipt) {
    const receipt = dataProperty(raw, 'receipt');
    if (!isOpaqueObject(receipt)) throw new TypeError('receipt must be opaque');
    normalized.receipt = receipt;
  }
  return Object.freeze(normalized);
}

function exactKey(input) {
  return JSON.stringify({
    projectId: input.binding.projectId,
    sessionId: input.binding.sessionId,
    jobId: input.binding.jobId,
    kernelId: input.binding.kernelId,
    submissionDigest: input.binding.submissionDigest,
    serverId: input.serverId,
    toolName: input.toolName,
    invocationDigest: input.invocationDigest,
    idempotencyKey: input.idempotencyKey,
    riskLevel: input.riskLevel,
  });
}

function taskKey(input) {
  return `${input.binding.jobId}:${input.idempotencyKey}`;
}

function approvedResult(receipt) {
  return Object.freeze({
    ok: true,
    approved: true,
    reason: MCP_WRITE_APPROVAL_REASONS.APPROVED,
    receipt,
  });
}

function deniedResult(reason, ok = false) {
  return Object.freeze({ ok, approved: false, reason });
}

function consumptionResult(authorized, reason) {
  return Object.freeze({ ok: authorized, authorized, reason });
}

function nativeDialogAllowed(value) {
  if (!isPlainDataRecord(value, ['response', 'checkboxChecked'], ['response'])) return false;
  if (Object.hasOwn(value, 'checkboxChecked')
    && typeof dataProperty(value, 'checkboxChecked') !== 'boolean') return false;
  return Number.isSafeInteger(dataProperty(value, 'response'))
    && dataProperty(value, 'response') === DIALOG_ALLOW_RESPONSE;
}

function createDialogPayload(input) {
  return Object.freeze({
    ...FIXED_MCP_WRITE_APPROVAL_DIALOG,
    detail: [
      `Projeto: ${input.projectLabel}`,
      `Servidor: ${input.serverId}`,
      `Ferramenta: ${input.toolName}`,
      `Risco declarado: ${input.riskLevel}`,
      '',
      'A aprovação vale somente para esta chamada, estes argumentos e o job atual.',
      'Nenhuma permissão persistente será criada.',
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

function createAgenticMcpWriteApprovalService(options = {}) {
  if (!isPlainDataRecord(options, OPTION_KEYS, REQUIRED_OPTION_KEYS)) {
    throw new TypeError('MCP write approval options must be a plain data record');
  }
  const showNativeDialog = dataProperty(options, 'showNativeDialog');
  const authorizeLifecycle = dataProperty(options, 'authorizeLifecycle');
  const authorizeRoot = dataProperty(options, 'authorizeRoot');
  const authorizeWriteFrontier = dataProperty(options, 'authorizeWriteFrontier');
  const getWindowLease = dataProperty(options, 'getWindowLease');
  const getSignal = Object.hasOwn(options, 'getSignal')
    ? dataProperty(options, 'getSignal')
    : () => null;
  const now = Object.hasOwn(options, 'now') ? dataProperty(options, 'now') : () => Date.now();
  const approvalTtlMs = Object.hasOwn(options, 'approvalTtlMs')
    ? dataProperty(options, 'approvalTtlMs')
    : DEFAULT_MCP_WRITE_APPROVAL_TTL_MS;
  for (const [name, callback] of [
    ['showNativeDialog', showNativeDialog],
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeWriteFrontier', authorizeWriteFrontier],
    ['getWindowLease', getWindowLease],
    ['getSignal', getSignal],
    ['now', now],
  ]) {
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${name} must be a trusted function`);
    }
  }
  if (!Number.isSafeInteger(approvalTtlMs) || approvalTtlMs <= 0
    || approvalTtlMs > MAX_MCP_WRITE_APPROVAL_TTL_MS) {
    throw new TypeError('approvalTtlMs is invalid');
  }

  const pendingByTask = new Map();
  const activeByTask = new Map();
  const recordsByReceipt = new Map();
  let generation = 0;

  function readNow() {
    try {
      const value = now();
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  function authorityActive(input) {
    let lifecycle;
    let root;
    let lease;
    let frontier;
    try {
      lifecycle = authorizeLifecycle(input.binding);
      root = authorizeRoot(Object.freeze({
        projectId: input.binding.projectId,
        rootPath: input.binding.canonicalRootPath,
      }));
      lease = getWindowLease();
      frontier = authorizeWriteFrontier(Object.freeze({
        binding: input.binding,
        windowLease: input.windowLease,
        serverId: input.serverId,
        toolName: input.toolName,
        invocationDigest: input.invocationDigest,
      }));
    } catch {
      return false;
    }
    const lifecycleBinding = safeDataValue(lifecycle, 'binding');
    const frontierBinding = safeDataValue(frontier, 'binding');
    const rootPath = safeDataValue(root, 'canonicalRootPath') || safeDataValue(root, 'rootPath');
    return Boolean(
      safeDataValue(lifecycle, 'authorized') === true
      && lifecycleBinding && bindingsMatch(lifecycleBinding, input.binding)
      && safeDataValue(root, 'authorized') === true
      && safeDataValue(root, 'projectId') === input.binding.projectId
      && rootPath === input.binding.canonicalRootPath
      && safeDataValue(root, 'realRootPath') === input.binding.realRootPath
      && lease === input.windowLease
      && safeDataValue(frontier, 'authorized') === true
      && frontierBinding && bindingsMatch(frontierBinding, input.binding)
      && safeDataValue(frontier, 'windowLease') === input.windowLease
      && safeDataValue(frontier, 'serverId') === input.serverId
      && safeDataValue(frontier, 'toolName') === input.toolName
      && safeDataValue(frontier, 'invocationDigest') === input.invocationDigest
    );
  }

  function operationSignal(input) {
    let externalSignal = null;
    try {
      externalSignal = getSignal(input.binding);
    } catch {
      externalSignal = null;
    }
    const controller = new AbortController();
    let onExternalAbort = null;
    if (externalSignal && typeof externalSignal === 'object') {
      if (externalSignal.aborted === true) controller.abort();
      else if (typeof externalSignal.addEventListener === 'function') {
        onExternalAbort = () => controller.abort();
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    return Object.freeze({ controller, externalSignal, onExternalAbort });
  }

  function detachOperationSignal(record) {
    if (record.externalSignal && record.onExternalAbort
      && typeof record.externalSignal.removeEventListener === 'function') {
      record.externalSignal.removeEventListener('abort', record.onExternalAbort);
    }
  }

  async function runApproval(operation) {
    const signal = operation.signalRecord.controller.signal;
    try {
      if (signal.aborted) return deniedResult(MCP_WRITE_APPROVAL_REASONS.CANCELED);
      if (!authorityActive(operation.input)) {
        return deniedResult(MCP_WRITE_APPROVAL_REASONS.REVOKED);
      }
      let dialogResult;
      try {
        dialogResult = showNativeDialog(
          createDialogPayload(operation.input),
          Object.freeze({ signal })
        );
        if (dialogResult && typeof dialogResult.then === 'function'
          && !util.types.isPromise(dialogResult)) {
          throw new TypeError('showNativeDialog returned an untrusted thenable');
        }
      } catch {
        return deniedResult(MCP_WRITE_APPROVAL_REASONS.DIALOG_FAILED);
      }
      const attempt = await awaitDialogOrAbort(dialogResult, signal);
      if (attempt.aborted) return deniedResult(MCP_WRITE_APPROVAL_REASONS.CANCELED);
      if (attempt.error) return deniedResult(MCP_WRITE_APPROVAL_REASONS.DIALOG_FAILED);
      if (!authorityActive(operation.input)) {
        return deniedResult(MCP_WRITE_APPROVAL_REASONS.REVOKED);
      }
      if (!nativeDialogAllowed(attempt.value)) {
        return deniedResult(MCP_WRITE_APPROVAL_REASONS.DENIED, true);
      }
      const issuedAt = readNow();
      if (issuedAt === null || issuedAt > Number.MAX_SAFE_INTEGER - approvalTtlMs) {
        return deniedResult(MCP_WRITE_APPROVAL_REASONS.CLOCK_INVALID);
      }
      if (signal.aborted || operation.generation !== generation
        || !authorityActive(operation.input)
        || activeByTask.has(operation.taskKey)) {
        return deniedResult(MCP_WRITE_APPROVAL_REASONS.REVOKED);
      }
      const receipt = Object.freeze(Object.create(null));
      const record = {
        input: operation.input,
        exactKey: operation.exactKey,
        taskKey: operation.taskKey,
        receipt,
        status: 'active',
        reason: '',
        expiresAt: issuedAt + approvalTtlMs,
        generation,
      };
      recordsByReceipt.set(receipt, record);
      activeByTask.set(record.taskKey, record);
      return approvedResult(receipt);
    } finally {
      detachOperationSignal(operation.signalRecord);
    }
  }

  function requestApproval(rawInput) {
    let input;
    try {
      input = normalizeApprovalInput(rawInput);
    } catch {
      return Promise.resolve(deniedResult(MCP_WRITE_APPROVAL_REASONS.INVALID_INPUT));
    }
    if (!authorityActive(input)) {
      return Promise.resolve(deniedResult(MCP_WRITE_APPROVAL_REASONS.REVOKED));
    }
    const normalizedTaskKey = taskKey(input);
    const normalizedExactKey = exactKey(input);
    const pending = pendingByTask.get(normalizedTaskKey);
    if (pending) {
      return pending.exactKey === normalizedExactKey
        ? pending.promise
        : Promise.resolve(deniedResult(MCP_WRITE_APPROVAL_REASONS.BUSY));
    }
    if (activeByTask.has(normalizedTaskKey)
      || pendingByTask.size >= MAX_PENDING_MCP_WRITE_DIALOGS) {
      return Promise.resolve(deniedResult(MCP_WRITE_APPROVAL_REASONS.BUSY));
    }
    const operation = {
      input,
      taskKey: normalizedTaskKey,
      exactKey: normalizedExactKey,
      signalRecord: operationSignal(input),
      generation,
      promise: null,
    };
    pendingByTask.set(normalizedTaskKey, operation);
    operation.promise = runApproval(operation).finally(() => {
      if (pendingByTask.get(normalizedTaskKey) === operation) {
        pendingByTask.delete(normalizedTaskKey);
      }
    });
    return operation.promise;
  }

  function consumeApproval(rawInput) {
    let input;
    try {
      input = normalizeApprovalInput(rawInput, true);
    } catch {
      return consumptionResult(false, MCP_WRITE_APPROVAL_REASONS.INVALID_INPUT);
    }
    const record = recordsByReceipt.get(input.receipt);
    if (!record) return consumptionResult(false, MCP_WRITE_APPROVAL_REASONS.NOT_FOUND);
    if (record.status === 'consumed') {
      return consumptionResult(false, MCP_WRITE_APPROVAL_REASONS.REPLAYED);
    }
    if (record.status !== 'active') {
      return consumptionResult(false, record.reason || MCP_WRITE_APPROVAL_REASONS.REVOKED);
    }
    if (record.exactKey !== exactKey(input)) {
      return consumptionResult(false, MCP_WRITE_APPROVAL_REASONS.MISMATCH);
    }
    const checkedAt = readNow();
    if (checkedAt === null) {
      record.status = 'revoked';
      record.reason = MCP_WRITE_APPROVAL_REASONS.CLOCK_INVALID;
      activeByTask.delete(record.taskKey);
      return consumptionResult(false, record.reason);
    }
    if (checkedAt >= record.expiresAt) {
      record.status = 'revoked';
      record.reason = MCP_WRITE_APPROVAL_REASONS.EXPIRED;
      activeByTask.delete(record.taskKey);
      return consumptionResult(false, record.reason);
    }
    if (record.generation !== generation || !authorityActive(record.input)) {
      record.status = 'revoked';
      record.reason = MCP_WRITE_APPROVAL_REASONS.REVOKED;
      activeByTask.delete(record.taskKey);
      return consumptionResult(false, record.reason);
    }
    if (!authorityActive(record.input)) {
      record.status = 'revoked';
      record.reason = MCP_WRITE_APPROVAL_REASONS.FRONTIER_INVALIDATED;
      activeByTask.delete(record.taskKey);
      return consumptionResult(false, record.reason);
    }
    record.status = 'consumed';
    record.reason = MCP_WRITE_APPROVAL_REASONS.REPLAYED;
    activeByTask.delete(record.taskKey);
    return consumptionResult(true, MCP_WRITE_APPROVAL_REASONS.CONSUMED);
  }

  function cancelJob(rawInput = {}) {
    let candidate;
    try {
      candidate = createCapabilityDelegationBinding(dataProperty(rawInput, 'binding'));
    } catch {
      return Object.freeze({ ok: false, canceled: 0, revoked: 0 });
    }
    let canceled = 0;
    let revoked = 0;
    for (const operation of pendingByTask.values()) {
      if (!bindingsMatch(operation.input.binding, candidate)) continue;
      operation.signalRecord.controller.abort();
      canceled += 1;
    }
    for (const record of activeByTask.values()) {
      if (!bindingsMatch(record.input.binding, candidate)) continue;
      record.status = 'revoked';
      record.reason = MCP_WRITE_APPROVAL_REASONS.REVOKED;
      activeByTask.delete(record.taskKey);
      revoked += 1;
    }
    return Object.freeze({ ok: true, canceled, revoked });
  }

  function clear() {
    generation += 1;
    for (const operation of pendingByTask.values()) {
      operation.signalRecord.controller.abort();
    }
    for (const record of activeByTask.values()) {
      record.status = 'revoked';
      record.reason = MCP_WRITE_APPROVAL_REASONS.CLEARED;
    }
    const result = Object.freeze({
      ok: true,
      canceled: pendingByTask.size,
      revoked: activeByTask.size,
    });
    pendingByTask.clear();
    activeByTask.clear();
    return result;
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_MCP_WRITE_APPROVAL_SERVICE_VERSION,
      pendingDialogs: pendingByTask.size,
      activeApprovals: activeByTask.size,
      ttlMs: approvalTtlMs,
      approvalScope: 'single_digest_bound_call',
    });
  }

  return Object.freeze({
    requestApproval,
    consumeApproval,
    cancelJob,
    clear,
    diagnostics,
  });
}

module.exports = {
  AGENTIC_MCP_WRITE_APPROVAL_SERVICE_VERSION,
  DEFAULT_MCP_WRITE_APPROVAL_TTL_MS,
  FIXED_MCP_WRITE_APPROVAL_DIALOG,
  MAX_MCP_WRITE_APPROVAL_TTL_MS,
  MCP_WRITE_APPROVAL_REASONS,
  createAgenticMcpWriteApprovalService,
};
