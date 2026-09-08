'use strict';

const util = require('util');

const RECOVERY_RESULT_VERSION = 'agentic-delete-recovery-result.v1';
const CLEANUP_RECEIPT_VERSION = 'assistant-job-execution-cleanup-receipt.v1';
const OPTION_KEYS = Object.freeze([
  'getAuthorizedJobById',
  'recoverJob',
  'markJobCancelledAfterCleanup',
]);
const RECOVERY_RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'ok',
  'status',
  'disposition',
  'errorCode',
  'idempotent',
]);
const NATIVE_PROMISE_THEN = Promise.prototype.then;

const RECOVERY_FAILED = Object.freeze({
  schemaVersion: RECOVERY_RESULT_VERSION,
  ok: false,
  status: 'failed',
  disposition: 'rollback',
  errorCode: 'RECOVERY_FAILED',
  idempotent: false,
});

function absorbNativePromise(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    Reflect.apply(NATIVE_PROMISE_THEN, value, [() => {}, () => {}]);
    return true;
  } catch {
    return false;
  }
}

function inspectDataRecord(value, { allowedKeys = null, requiredKeys = [] } = {}) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || util.types.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return null;
    if (allowedKeys && keys.some((key) => !allowedKeys.includes(key))) return null;
    if (requiredKeys.some((key) => !keys.includes(key))) return null;
    const fields = new Map();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
        return null;
      }
      fields.set(key, descriptor.value);
    }
    return fields;
  } catch {
    return null;
  }
}

function captureOptions(options) {
  const fields = inspectDataRecord(options, {
    allowedKeys: OPTION_KEYS,
  });
  if (!fields || fields.size === 0) {
    throw new TypeError('agentic delete cancellation recovery adapter options are invalid');
  }
  const captured = {};
  for (const key of OPTION_KEYS) {
    const callback = fields.get(key);
    if (typeof callback !== 'function' || util.types.isProxy(callback)) {
      throw new TypeError(`${key} must be a function`);
    }
    captured[key] = callback;
  }
  return Object.freeze(captured);
}

function inputJobId(input) {
  const fields = inspectDataRecord(input);
  return fields && typeof fields.get('jobId') === 'string'
    ? fields.get('jobId')
    : null;
}

function isCancellingJob(raw, expectedJobId) {
  if (absorbNativePromise(raw)) return false;
  const response = inspectDataRecord(raw);
  if (!response || response.get('ok') !== true) return false;
  const job = inspectDataRecord(response.get('job'));
  return Boolean(job
    && job.get('id') === expectedJobId
    && ((job.get('status') === 'running' && job.get('phase') === 'cancelling')
      || (job.get('status') === 'failed'
        && job.get('phase') === 'execution_cleanup_failed')
      || (job.get('status') === 'cancelled' && job.get('phase') === 'cancelled')));
}

function isCompletedRollback(raw) {
  if (absorbNativePromise(raw)) return false;
  const fields = inspectDataRecord(raw, {
    allowedKeys: RECOVERY_RESULT_KEYS,
    requiredKeys: RECOVERY_RESULT_KEYS,
  });
  return Boolean(fields
    && fields.get('schemaVersion') === RECOVERY_RESULT_VERSION
    && fields.get('ok') === true
    && fields.get('status') === 'completed'
    && fields.get('disposition') === 'rollback'
    && fields.get('errorCode') === null
    && typeof fields.get('idempotent') === 'boolean');
}

function confirmationSucceeded(raw) {
  if (absorbNativePromise(raw)) return false;
  const fields = inspectDataRecord(raw);
  return Boolean(fields && fields.get('ok') === true);
}

function createAgenticDeleteCancellationRecoveryAdapter(options = {}) {
  const dependencies = captureOptions(options);

  function recoverJob(input) {
    const jobId = inputJobId(input);
    let cancelling = false;
    if (jobId) {
      try {
        cancelling = isCancellingJob(dependencies.getAuthorizedJobById(jobId), jobId);
      } catch {
        cancelling = false;
      }
    }

    let result;
    try {
      result = dependencies.recoverJob(input);
    } catch {
      return RECOVERY_FAILED;
    }
    if (!cancelling || !isCompletedRollback(result)) return result;

    const receipt = Object.freeze({
      schemaVersion: CLEANUP_RECEIPT_VERSION,
      jobId,
      cleanupCompleted: true,
    });
    try {
      const confirmation = dependencies.markJobCancelledAfterCleanup(jobId, receipt);
      return confirmationSucceeded(confirmation) ? result : RECOVERY_FAILED;
    } catch {
      return RECOVERY_FAILED;
    }
  }

  return Object.freeze({ recoverJob });
}

module.exports = {
  createAgenticDeleteCancellationRecoveryAdapter,
};
