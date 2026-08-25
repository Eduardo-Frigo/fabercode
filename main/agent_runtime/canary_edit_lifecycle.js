'use strict';

const util = require('util');

const CANARY_EDIT_LIFECYCLE_VERSION = 'canary-edit-lifecycle.v1';
const CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION =
  'canary-edit-cleanup-receipt.v1';

const CANARY_EDIT_LIFECYCLE_STATES = Object.freeze({
  ACTIVE: 'active',
  CLEANUP_REQUIRED: 'cleanup_required',
  FALLBACK_READY: 'fallback_ready',
  LEGACY_STARTED: 'legacy_started',
  CANARY_COMPLETED: 'canary_completed',
  QUARANTINED: 'quarantined',
});

const CANARY_EDIT_MUTATION_FRONTIERS = Object.freeze({
  NONE: 'none',
  STAGING: 'staging',
  SOURCE: 'source',
});

const CANARY_EDIT_LIFECYCLE_CODES = Object.freeze({
  WRITE_RECORDED: 'write_recorded',
  FALLBACK_READY: 'fallback_ready',
  CLEANUP_REQUIRED: 'cleanup_required',
  CLEANUP_CONFIRMED: 'cleanup_confirmed',
  CLEANUP_FAILED: 'cleanup_failed',
  CLEANUP_INSUFFICIENT: 'cleanup_insufficient',
  LEGACY_STARTED: 'legacy_started',
  CANARY_COMPLETED: 'canary_completed',
  IDEMPOTENT: 'idempotent',
  INVALID_INPUT: 'invalid_input',
  INVALID_TRANSITION: 'invalid_transition',
});

const OPTION_KEYS = Object.freeze(['jobId', 'stagingId']);
const WRITE_KEYS = Object.freeze(['scope']);
const FALLBACK_KEYS = Object.freeze(['reason']);
const CLEANUP_KEYS = Object.freeze([
  'schemaVersion',
  'jobId',
  'stagingId',
  'disposition',
  'clean',
]);
const CLEANUP_DISPOSITIONS = new Set(['discarded', 'reverted']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON = /^[a-z][a-z0-9_:-]{0,79}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

function createCanaryEditLifecycle(options = {}) {
  const optionFields = exactDataFields(options, OPTION_KEYS);
  const jobId = optionFields && optionFields.get('jobId');
  const stagingId = optionFields && optionFields.get('stagingId');
  if (!optionFields || typeof jobId !== 'string' || !SAFE_IDENTIFIER.test(jobId)
    || typeof stagingId !== 'string' || !SAFE_IDENTIFIER.test(stagingId)) {
    throw new TypeError('Invalid canary edit lifecycle options');
  }

  let state = CANARY_EDIT_LIFECYCLE_STATES.ACTIVE;
  let mutationFrontier = CANARY_EDIT_MUTATION_FRONTIERS.NONE;
  let fallbackReason = null;

  function requiredCleanupDisposition() {
    if (state !== CANARY_EDIT_LIFECYCLE_STATES.CLEANUP_REQUIRED) return null;
    return mutationFrontier === CANARY_EDIT_MUTATION_FRONTIERS.SOURCE
      ? 'reverted'
      : 'discarded_or_reverted';
  }

  function snapshot() {
    return Object.freeze({
      version: CANARY_EDIT_LIFECYCLE_VERSION,
      state,
      mutationFrontier,
      fallbackReason,
      fallbackAllowed: state === CANARY_EDIT_LIFECYCLE_STATES.FALLBACK_READY,
      cleanupRequired: state === CANARY_EDIT_LIFECYCLE_STATES.CLEANUP_REQUIRED,
      requiredCleanupDisposition: requiredCleanupDisposition(),
    });
  }

  function transition(ok, code) {
    return Object.freeze({ ok, code, snapshot: snapshot() });
  }

  function noteWrite(input = {}) {
    const fields = exactDataFields(input, WRITE_KEYS);
    const scope = fields && fields.get('scope');
    if (!fields || ![
      CANARY_EDIT_MUTATION_FRONTIERS.STAGING,
      CANARY_EDIT_MUTATION_FRONTIERS.SOURCE,
    ].includes(scope)) {
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.INVALID_INPUT);
    }
    if (state !== CANARY_EDIT_LIFECYCLE_STATES.ACTIVE) {
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.INVALID_TRANSITION);
    }
    if (scope === CANARY_EDIT_MUTATION_FRONTIERS.STAGING) {
      if (mutationFrontier !== CANARY_EDIT_MUTATION_FRONTIERS.NONE) {
        return transition(true, CANARY_EDIT_LIFECYCLE_CODES.IDEMPOTENT);
      }
      mutationFrontier = CANARY_EDIT_MUTATION_FRONTIERS.STAGING;
      return transition(true, CANARY_EDIT_LIFECYCLE_CODES.WRITE_RECORDED);
    }
    if (mutationFrontier === CANARY_EDIT_MUTATION_FRONTIERS.NONE) {
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.INVALID_TRANSITION);
    }
    if (mutationFrontier === CANARY_EDIT_MUTATION_FRONTIERS.SOURCE) {
      return transition(true, CANARY_EDIT_LIFECYCLE_CODES.IDEMPOTENT);
    }
    mutationFrontier = CANARY_EDIT_MUTATION_FRONTIERS.SOURCE;
    return transition(true, CANARY_EDIT_LIFECYCLE_CODES.WRITE_RECORDED);
  }

  function requestFallback(input = {}) {
    const fields = exactDataFields(input, FALLBACK_KEYS);
    const reason = fields && fields.get('reason');
    if (!fields || typeof reason !== 'string' || !SAFE_REASON.test(reason)) {
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.INVALID_INPUT);
    }
    if (state === CANARY_EDIT_LIFECYCLE_STATES.FALLBACK_READY
      && fallbackReason === reason) {
      return transition(true, CANARY_EDIT_LIFECYCLE_CODES.IDEMPOTENT);
    }
    if (state !== CANARY_EDIT_LIFECYCLE_STATES.ACTIVE) {
      return transition(false, state === CANARY_EDIT_LIFECYCLE_STATES.CLEANUP_REQUIRED
        ? CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED
        : CANARY_EDIT_LIFECYCLE_CODES.INVALID_TRANSITION);
    }
    fallbackReason = reason;
    if (mutationFrontier === CANARY_EDIT_MUTATION_FRONTIERS.NONE) {
      state = CANARY_EDIT_LIFECYCLE_STATES.FALLBACK_READY;
      return transition(true, CANARY_EDIT_LIFECYCLE_CODES.FALLBACK_READY);
    }
    state = CANARY_EDIT_LIFECYCLE_STATES.CLEANUP_REQUIRED;
    return transition(false, CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED);
  }

  function confirmCleanup(input = {}) {
    const fields = exactDataFields(input, CLEANUP_KEYS);
    if (!fields
      || fields.get('schemaVersion') !== CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION
      || fields.get('jobId') !== jobId
      || fields.get('stagingId') !== stagingId
      || !CLEANUP_DISPOSITIONS.has(fields.get('disposition'))
      || typeof fields.get('clean') !== 'boolean') {
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.INVALID_INPUT);
    }
    if (state !== CANARY_EDIT_LIFECYCLE_STATES.CLEANUP_REQUIRED) {
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.INVALID_TRANSITION);
    }
    if (fields.get('clean') !== true) {
      state = CANARY_EDIT_LIFECYCLE_STATES.QUARANTINED;
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_FAILED);
    }
    if (mutationFrontier === CANARY_EDIT_MUTATION_FRONTIERS.SOURCE
      && fields.get('disposition') !== 'reverted') {
      state = CANARY_EDIT_LIFECYCLE_STATES.QUARANTINED;
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_INSUFFICIENT);
    }
    mutationFrontier = CANARY_EDIT_MUTATION_FRONTIERS.NONE;
    state = CANARY_EDIT_LIFECYCLE_STATES.FALLBACK_READY;
    return transition(true, CANARY_EDIT_LIFECYCLE_CODES.FALLBACK_READY);
  }

  function startLegacy() {
    if (state === CANARY_EDIT_LIFECYCLE_STATES.LEGACY_STARTED) {
      return transition(true, CANARY_EDIT_LIFECYCLE_CODES.IDEMPOTENT);
    }
    if (state !== CANARY_EDIT_LIFECYCLE_STATES.FALLBACK_READY) {
      return transition(false, state === CANARY_EDIT_LIFECYCLE_STATES.CLEANUP_REQUIRED
        ? CANARY_EDIT_LIFECYCLE_CODES.CLEANUP_REQUIRED
        : CANARY_EDIT_LIFECYCLE_CODES.INVALID_TRANSITION);
    }
    state = CANARY_EDIT_LIFECYCLE_STATES.LEGACY_STARTED;
    return transition(true, CANARY_EDIT_LIFECYCLE_CODES.LEGACY_STARTED);
  }

  function completeCanary() {
    if (state === CANARY_EDIT_LIFECYCLE_STATES.CANARY_COMPLETED) {
      return transition(true, CANARY_EDIT_LIFECYCLE_CODES.IDEMPOTENT);
    }
    if (state !== CANARY_EDIT_LIFECYCLE_STATES.ACTIVE) {
      return transition(false, CANARY_EDIT_LIFECYCLE_CODES.INVALID_TRANSITION);
    }
    state = CANARY_EDIT_LIFECYCLE_STATES.CANARY_COMPLETED;
    return transition(true, CANARY_EDIT_LIFECYCLE_CODES.CANARY_COMPLETED);
  }

  return Object.freeze({
    version: CANARY_EDIT_LIFECYCLE_VERSION,
    completeCanary,
    confirmCleanup,
    noteWrite,
    requestFallback,
    snapshot,
    startLegacy,
  });
}

module.exports = {
  CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
  CANARY_EDIT_LIFECYCLE_CODES,
  CANARY_EDIT_LIFECYCLE_STATES,
  CANARY_EDIT_LIFECYCLE_VERSION,
  CANARY_EDIT_MUTATION_FRONTIERS,
  createCanaryEditLifecycle,
};
