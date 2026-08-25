'use strict';

const util = require('util');

const {
  CANARY_MANUAL_ROLLBACK_RECEIPT_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_SERVICE_VERSION,
} = require('../agent_runtime/canary_manual_rollback_service');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../agent_runtime/canary_rollout_selector');

const CANARY_MANUAL_ROLLBACK_JOB_SERVICE_VERSION =
  'canary-manual-rollback-job-service.v1';
const CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS = Object.freeze({
  INVALID_INPUT: 'CANARY_MANUAL_ROLLBACK_JOB_INVALID_INPUT',
  ROLLBACK_UNAVAILABLE: 'CANARY_MANUAL_ROLLBACK_JOB_UNAVAILABLE',
  RUNTIME_UNAVAILABLE: 'CANARY_MANUAL_ROLLBACK_RUNTIME_UNAVAILABLE',
  ROLLBACK_FAILED: 'CANARY_MANUAL_ROLLBACK_JOB_FAILED',
  STATE_PERSISTENCE_FAILED:
    'CANARY_MANUAL_ROLLBACK_STATE_PERSISTENCE_FAILED',
});

const OPTION_KEYS = Object.freeze([
  'getAuthorizedJobById',
  'getManualRollback',
  'markJobCanaryRolledBack',
  'audit',
]);
const REQUEST_KEYS = Object.freeze(['jobId']);
const MANUAL_ROLLBACK_PORT_KEYS = Object.freeze([
  'version',
  'rollback',
  'diagnostics',
]);
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'jobId',
  'projectId',
  'promotionId',
  'rolloutStage',
  'reconciliationId',
  'revertReceipt',
]);
const SAFE_JOB_ID = /^job-[A-Za-z0-9._-]{1,180}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const VALID_STAGES = new Set(Object.values(CANARY_ROLLOUT_STAGES));
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)
    || frozen && !Object.isFrozen(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== expectedKeys.length
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

function ownDataValue(value, key) {
  if (!value || typeof value !== 'object' || util.types.isProxy(value)) {
    return undefined;
  }
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch {
    return undefined;
  }
  return descriptor && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    ? descriptor.value : undefined;
}

function inspectableFunction(value, fieldName) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)) {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  try { Function.prototype.toString.call(value); } catch {
    throw new TypeError(fieldName + ' must be an inspectable function');
  }
  return value;
}

function captureDependencies(options) {
  const fields = exactDataFields(options, OPTION_KEYS);
  if (!fields) throw new TypeError('Invalid canary rollback job options');
  return Object.freeze(Object.fromEntries(OPTION_KEYS.map((key) => [
    key,
    inspectableFunction(fields.get(key), key),
  ])));
}

function normalizeRequest(value) {
  const fields = exactDataFields(value, REQUEST_KEYS, { frozen: true });
  const jobId = fields && fields.get('jobId');
  return typeof jobId === 'string' && SAFE_JOB_ID.test(jobId)
    ? Object.freeze({ jobId }) : null;
}

function denseArrayValues(value, maximum = 512) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || value.length > maximum) return null;
  let keys;
  try { keys = Reflect.ownKeys(value).filter((key) => key !== 'length'); } catch {
    return null;
  }
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const output = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) return null;
    output.push(descriptor.value);
  }
  return output;
}

function inspectPersistedRollback(job) {
  const rollback = ownDataValue(job, 'canaryRollback');
  if (!rollback) return null;
  const status = ownDataValue(rollback, 'status');
  const promotionId = ownDataValue(rollback, 'promotionId');
  const reconciliationId = ownDataValue(rollback, 'reconciliationId');
  const sourceRestored = ownDataValue(rollback, 'sourceRestored');
  if (status !== 'completed'
    || typeof promotionId !== 'string' || !SAFE_IDENTIFIER.test(promotionId)
    || typeof reconciliationId !== 'string'
    || !SAFE_IDENTIFIER.test(reconciliationId)
    || sourceRestored !== true) return null;
  return Object.freeze({ promotionId, reconciliationId, sourceRestored: true });
}

function inspectEligibleJob(value, expectedJobId) {
  const job = ownDataValue(value, 'job');
  if (ownDataValue(value, 'ok') !== true || !job
    || ownDataValue(job, 'id') !== expectedJobId
    || ownDataValue(job, 'status') !== 'completed'
    || ownDataValue(job, 'phase') !== 'done') return null;
  const projectId = ownDataValue(job, 'projectId');
  if (typeof projectId !== 'string' || !SAFE_IDENTIFIER.test(projectId)) {
    return null;
  }
  const persistedRollback = inspectPersistedRollback(job);
  if (persistedRollback) {
    return Object.freeze({ job, projectId, persistedRollback });
  }
  const events = denseArrayValues(ownDataValue(job, 'events'));
  if (!events) return null;
  for (const event of events) {
    if (ownDataValue(event, 'type') !== 'job.completed') continue;
    const payload = ownDataValue(event, 'payload');
    const promotionId = ownDataValue(payload, 'canaryPromotionId');
    if (ownDataValue(payload, 'canary') === true
      && typeof promotionId === 'string'
      && SAFE_IDENTIFIER.test(promotionId)) {
      return Object.freeze({
        job,
        projectId,
        persistedRollback: null,
        promotionId,
      });
    }
  }
  return null;
}

function captureManualRollbackPort(value) {
  const fields = exactDataFields(
    value,
    MANUAL_ROLLBACK_PORT_KEYS,
    { frozen: true }
  );
  if (!fields
    || fields.get('version') !== CANARY_MANUAL_ROLLBACK_SERVICE_VERSION) {
    return null;
  }
  let rollback;
  try { rollback = inspectableFunction(fields.get('rollback'), 'rollback'); } catch {
    return null;
  }
  return Object.freeze({ receiver: value, rollback });
}

function normalizeReceipt(value, input) {
  const fields = exactDataFields(value, RECEIPT_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_MANUAL_ROLLBACK_RECEIPT_SCHEMA_VERSION
    || fields.get('jobId') !== input.jobId
    || fields.get('projectId') !== input.projectId
    || fields.get('promotionId') !== input.promotionId
    || !VALID_STAGES.has(fields.get('rolloutStage'))
    || typeof fields.get('reconciliationId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('reconciliationId'))) return null;
  const revertReceipt = fields.get('revertReceipt');
  if (ownDataValue(revertReceipt, 'promotionId') !== input.promotionId
    || ownDataValue(revertReceipt, 'inversePatchApplied') !== true
    || ownDataValue(revertReceipt, 'sourceRestored') !== true) return null;
  return Object.freeze({
    promotionId: input.promotionId,
    reconciliationId: fields.get('reconciliationId'),
    sourceRestored: true,
  });
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function createCanaryManualRollbackJobService(options = {}) {
  const dependencies = captureDependencies(options);
  let requests = 0;
  let completed = 0;
  let idempotent = 0;
  let failures = 0;
  let lastFailureCode = null;

  function resultFailure(code, message, jobId = null, rollbackApplied = false) {
    failures += 1;
    lastFailureCode = code;
    try {
      dependencies.audit('assistant.canary_manual_rollback_failed',
        Object.freeze({ jobId, code, rollbackApplied }));
    } catch { /* telemetry never changes rollback authority */ }
    return Object.freeze({ ok: false, code, message });
  }

  function completedResult(job, rollback, wasIdempotent) {
    completed += wasIdempotent ? 0 : 1;
    idempotent += wasIdempotent ? 1 : 0;
    lastFailureCode = null;
    try {
      dependencies.audit('assistant.canary_manual_rollback_completed',
        Object.freeze({
          jobId: ownDataValue(job, 'id'),
          promotionId: rollback.promotionId,
          reconciliationId: rollback.reconciliationId,
          idempotent: wasIdempotent,
        }));
    } catch { /* durable state remains authoritative */ }
    return deepFreeze({
      ok: true,
      idempotent: wasIdempotent,
      rollback,
      job,
    });
  }

  async function rollback(value) {
    requests += 1;
    const request = normalizeRequest(value);
    if (!request) {
      return resultFailure(
        CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.INVALID_INPUT,
        'Solicitação de rollback inválida.'
      );
    }
    let found;
    try {
      found = dependencies.getAuthorizedJobById(request.jobId);
    } catch {
      found = null;
    }
    if (util.types.isPromise(found)) {
      found.catch(() => {});
      found = null;
    }
    const eligible = inspectEligibleJob(found, request.jobId);
    if (!eligible) {
      return resultFailure(
        CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.ROLLBACK_UNAVAILABLE,
        'Este job não possui uma promoção canary reversível.',
        request.jobId
      );
    }
    if (eligible.persistedRollback) {
      return completedResult(eligible.job, eligible.persistedRollback, true);
    }
    let runtimeValue;
    try { runtimeValue = dependencies.getManualRollback(); } catch {
      runtimeValue = null;
    }
    if (util.types.isPromise(runtimeValue)) {
      runtimeValue.catch(() => {});
      runtimeValue = null;
    }
    const port = captureManualRollbackPort(runtimeValue);
    if (!port) {
      return resultFailure(
        CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.RUNTIME_UNAVAILABLE,
        'O runtime canary não está disponível para rollback.',
        request.jobId
      );
    }
    const coreInput = Object.freeze({
      jobId: request.jobId,
      projectId: eligible.projectId,
      promotionId: eligible.promotionId,
      reason: 'manual_user_rollback',
    });
    let pending;
    try { pending = Reflect.apply(port.rollback, port.receiver, [coreInput]); } catch {
      pending = null;
    }
    if (!util.types.isPromise(pending)) {
      return resultFailure(
        CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.ROLLBACK_FAILED,
        'Não foi possível concluir o rollback canary.',
        request.jobId
      );
    }
    let receipt;
    try { receipt = await pending; } catch {
      return resultFailure(
        CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.ROLLBACK_FAILED,
        'Não foi possível concluir o rollback canary.',
        request.jobId
      );
    }
    const completion = normalizeReceipt(receipt, coreInput);
    if (!completion) {
      return resultFailure(
        CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.ROLLBACK_FAILED,
        'O runtime não comprovou a restauração da fonte.',
        request.jobId
      );
    }
    let marked;
    try {
      marked = dependencies.markJobCanaryRolledBack(
        request.jobId,
        completion
      );
    } catch {
      marked = null;
    }
    if (util.types.isPromise(marked)) {
      marked.catch(() => {});
      marked = null;
    }
    if (ownDataValue(marked, 'ok') !== true
      || !ownDataValue(marked, 'job')) {
      return resultFailure(
        CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS.STATE_PERSISTENCE_FAILED,
        'A fonte foi restaurada, mas o estado do job não pôde ser persistido.',
        request.jobId,
        true
      );
    }
    return completedResult(
      ownDataValue(marked, 'job'),
      completion,
      ownDataValue(marked, 'idempotent') === true
    );
  }

  function diagnostics() {
    return Object.freeze({
      version: CANARY_MANUAL_ROLLBACK_JOB_SERVICE_VERSION,
      requests,
      completed,
      idempotent,
      failures,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: CANARY_MANUAL_ROLLBACK_JOB_SERVICE_VERSION,
    rollback,
    diagnostics,
  });
}

module.exports = {
  CANARY_MANUAL_ROLLBACK_JOB_SERVICE_REASONS,
  CANARY_MANUAL_ROLLBACK_JOB_SERVICE_VERSION,
  createCanaryManualRollbackJobService,
};
