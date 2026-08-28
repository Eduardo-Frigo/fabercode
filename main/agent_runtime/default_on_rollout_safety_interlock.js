'use strict';

const path = require('path');
const util = require('util');

const DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION =
  'default-on-rollout-safety-interlock.v1';
const DEFAULT_ON_ROLLOUT_SAFETY_TRIP_RECEIPT_SCHEMA_VERSION =
  'default-on-rollout-safety-trip-receipt.v1';

const DEFAULT_ON_ROLLOUT_SAFETY_EVENTS = Object.freeze({
  ROOT_ESCAPE: 'root_escape',
  SECRET_EXPOSURE: 'secret_exposure',
  USER_CHANGE_OVERWRITE: 'user_change_overwrite',
  UNAPPROVED_EXTERNAL_EFFECT: 'unapproved_external_effect',
  GIT_STATE_MUTATION: 'git_state_mutation',
  STATE_STORE_CORRUPTION: 'state_store_corruption',
});

function classifyDefaultOnCanarySafetyEvent(reason) {
  if (reason === 'CANARY_TRANSACTIONAL_STAGING_PROMOTION_AMBIGUOUS'
    || reason === 'CANARY_TRANSACTIONAL_STAGING_REVERT_FAILED') {
    return DEFAULT_ON_ROLLOUT_SAFETY_EVENTS.USER_CHANGE_OVERWRITE;
  }
  return null;
}

const SAFETY_EVENT_VALUES = new Set(
  Object.values(DEFAULT_ON_ROLLOUT_SAFETY_EVENTS)
);
const OPTION_KEYS = Object.freeze([
  'cancelJob',
  'closeBrowserJob',
  'closeRuntime',
  'audit',
]);
const REGISTRATION_KEYS = Object.freeze([
  'jobId',
  'projectId',
  'canonicalRootPath',
  'policyDigest',
]);
const FINISH_KEYS = Object.freeze(['jobId', 'policyDigest']);
const TRIP_KEYS = Object.freeze(['event', 'sourceJobId', 'evidenceDigest']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
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

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
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

function inspectableFunction(value, fieldName, { synchronous = false } = {}) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)
    || synchronous && util.types.isAsyncFunction(value)) {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  try {
    Function.prototype.toString.call(value);
  } catch {
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  return value;
}

function normalizeRegistration(value) {
  const fields = exactDataFields(value, REGISTRATION_KEYS, { frozen: true });
  if (!fields || !SAFE_IDENTIFIER.test(fields.get('jobId'))
    || !SAFE_IDENTIFIER.test(fields.get('projectId'))
    || typeof fields.get('canonicalRootPath') !== 'string'
    || !path.isAbsolute(fields.get('canonicalRootPath'))
    || fields.get('canonicalRootPath').includes('\0')
    || path.normalize(fields.get('canonicalRootPath'))
      !== fields.get('canonicalRootPath')
    || !SHA256_DIGEST.test(fields.get('policyDigest'))) return null;
  return Object.freeze(Object.fromEntries(
    REGISTRATION_KEYS.map((key) => [key, fields.get(key)])
  ));
}

function normalizeFinish(value) {
  const fields = exactDataFields(value, FINISH_KEYS, { frozen: true });
  if (!fields || !SAFE_IDENTIFIER.test(fields.get('jobId'))
    || !SHA256_DIGEST.test(fields.get('policyDigest'))) return null;
  return Object.freeze({
    jobId: fields.get('jobId'),
    policyDigest: fields.get('policyDigest'),
  });
}

function normalizeTrip(value) {
  const fields = exactDataFields(value, TRIP_KEYS, { frozen: true });
  if (!fields || !SAFETY_EVENT_VALUES.has(fields.get('event'))
    || !SAFE_IDENTIFIER.test(fields.get('sourceJobId'))
    || !SHA256_DIGEST.test(fields.get('evidenceDigest'))) return null;
  return Object.freeze({
    event: fields.get('event'),
    sourceJobId: fields.get('sourceJobId'),
    evidenceDigest: fields.get('evidenceDigest'),
  });
}

function registrationsMatch(left, right) {
  return REGISTRATION_KEYS.every((key) => left[key] === right[key]);
}

function readDataValue(value, key) {
  if (!isPlainRecord(value) || !Object.isFrozen(value)) return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return null;
  }
  return descriptor && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    ? descriptor.value : null;
}

function synchronousCall(callback, args) {
  let result;
  try {
    result = Reflect.apply(callback, undefined, args);
  } catch {
    return Object.freeze({ ok: false, value: null });
  }
  if (util.types.isPromise(result)) {
    try {
      Reflect.apply(Promise.prototype.then, result, [() => {}, () => {}]);
    } catch { /* asynchronous callbacks remain unconfirmed */ }
    return Object.freeze({ ok: false, value: null });
  }
  return Object.freeze({ ok: true, value: result });
}

function cancellationConfirmed(value) {
  return readDataValue(value, 'ok') === true
    && (readDataValue(value, 'revoked') === true
      || readDataValue(value, 'deferred') === true);
}

function browserCloseConfirmed(value) {
  const closed = readDataValue(value, 'closed');
  return readDataValue(value, 'ok') === true
    && Number.isSafeInteger(closed) && closed >= 0;
}

function runtimeCloseConfirmed(value) {
  return readDataValue(value, 'closed') === true
    && readDataValue(value, 'drained') === true
    && readDataValue(value, 'clientClosed') === true;
}

function createDefaultOnRolloutSafetyInterlock(options = {}) {
  const fields = exactDataFields(options, OPTION_KEYS);
  if (!fields) {
    throw new TypeError('Invalid default-on rollout safety interlock options');
  }
  const cancelJob = inspectableFunction(fields.get('cancelJob'), 'cancelJob', {
    synchronous: true,
  });
  const closeBrowserJob = inspectableFunction(
    fields.get('closeBrowserJob'),
    'closeBrowserJob',
    { synchronous: true }
  );
  const closeRuntime = inspectableFunction(
    fields.get('closeRuntime'),
    'closeRuntime'
  );
  const audit = inspectableFunction(fields.get('audit'), 'audit', {
    synchronous: true,
  });

  const activeJobs = new Map();
  let state = 'armed';
  let tripRequest = null;
  let tripPromise = null;
  let tripReceipt = null;

  function auditBestEffort(type, payload) {
    synchronousCall(audit, [type, payload]);
  }

  function begin(value) {
    const registration = normalizeRegistration(value);
    if (!registration) throw new TypeError('Invalid safety registration');
    if (state === 'tripped') {
      return Object.freeze({
        ok: true,
        allowed: false,
        idempotent: false,
        jobId: registration.jobId,
        reason: 'interlock_tripped',
      });
    }
    const existing = activeJobs.get(registration.jobId);
    if (existing && !registrationsMatch(existing, registration)) {
      throw new Error('Safety registration conflict');
    }
    if (!existing) activeJobs.set(registration.jobId, registration);
    return Object.freeze({
      ok: true,
      allowed: true,
      idempotent: Boolean(existing),
      jobId: registration.jobId,
      reason: existing ? 'already_registered' : 'registered',
    });
  }

  function finish(value) {
    const completion = normalizeFinish(value);
    if (!completion) throw new TypeError('Invalid safety completion');
    const existing = activeJobs.get(completion.jobId);
    if (existing && existing.policyDigest !== completion.policyDigest) {
      throw new Error('Safety completion conflict');
    }
    const finished = Boolean(existing);
    if (finished) activeJobs.delete(completion.jobId);
    return Object.freeze({ ok: true, finished, jobId: completion.jobId });
  }

  async function performTrip(request, registrations) {
    let cancelledJobs = 0;
    let browserJobsClosed = 0;
    auditBestEffort('assistant.default_on_rollout_safety_tripped', Object.freeze({
      event: request.event,
      evidenceDigest: request.evidenceDigest,
      activeJobs: registrations.length,
    }));
    for (const registration of registrations) {
      const cancellation = synchronousCall(cancelJob, [Object.freeze({
        jobId: registration.jobId,
        reason: 'default_on_rollout_safety_trip',
      })]);
      if (cancellation.ok && cancellationConfirmed(cancellation.value)) {
        cancelledJobs += 1;
      }
      const browserClose = synchronousCall(closeBrowserJob, [Object.freeze({
        jobId: registration.jobId,
      })]);
      if (browserClose.ok && browserCloseConfirmed(browserClose.value)) {
        browserJobsClosed += 1;
      }
    }

    let runtimeClosed = false;
    try {
      const pending = Reflect.apply(closeRuntime, undefined, []);
      if (util.types.isPromise(pending)) {
        let value;
        try {
          value = await new Promise((resolve, reject) => {
            Reflect.apply(Promise.prototype.then, pending, [resolve, reject]);
          });
        } catch {
          value = null;
        }
        runtimeClosed = runtimeCloseConfirmed(value);
      } else {
        runtimeClosed = false;
      }
    } catch {
      runtimeClosed = false;
    }

    tripReceipt = Object.freeze({
      schemaVersion:
        DEFAULT_ON_ROLLOUT_SAFETY_TRIP_RECEIPT_SCHEMA_VERSION,
      ok: cancelledJobs === registrations.length
        && browserJobsClosed === registrations.length
        && runtimeClosed,
      tripped: true,
      event: request.event,
      evidenceDigest: request.evidenceDigest,
      activeJobs: registrations.length,
      cancelledJobs,
      browserJobsClosed,
      runtimeClosed,
      restartMode: 'legacy_new_job',
      broadResetUsed: false,
    });
    auditBestEffort('assistant.default_on_rollout_safety_settled', Object.freeze({
      ok: tripReceipt.ok,
      event: tripReceipt.event,
      activeJobs: tripReceipt.activeJobs,
      cancelledJobs: tripReceipt.cancelledJobs,
      browserJobsClosed: tripReceipt.browserJobsClosed,
      runtimeClosed: tripReceipt.runtimeClosed,
      broadResetUsed: false,
    }));
    return tripReceipt;
  }

  function trip(value) {
    const request = normalizeTrip(value);
    if (!request) {
      return Promise.reject(new TypeError('Invalid safety trip input'));
    }
    if (tripPromise) return tripPromise;
    state = 'tripped';
    tripRequest = request;
    tripPromise = performTrip(request, [...activeJobs.values()]);
    return tripPromise;
  }

  function diagnostics() {
    return Object.freeze({
      version: DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
      state,
      activeJobs: activeJobs.size,
      tripEvent: tripRequest ? tripRequest.event : null,
      tripEvidenceDigest: tripRequest ? tripRequest.evidenceDigest : null,
      settled: tripReceipt !== null,
      restartMode: 'legacy_new_job',
      resetAvailable: false,
    });
  }

  return Object.freeze({
    version: DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
    begin,
    finish,
    trip,
    diagnostics,
  });
}

module.exports = {
  DEFAULT_ON_ROLLOUT_SAFETY_EVENTS,
  DEFAULT_ON_ROLLOUT_SAFETY_INTERLOCK_VERSION,
  DEFAULT_ON_ROLLOUT_SAFETY_TRIP_RECEIPT_SCHEMA_VERSION,
  classifyDefaultOnCanarySafetyEvent,
  createDefaultOnRolloutSafetyInterlock,
};
