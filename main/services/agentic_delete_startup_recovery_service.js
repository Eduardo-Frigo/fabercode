'use strict';

const {
  AGENTIC_DELETE_RECOVERY_RESULT_VERSION,
  RECOVERY_ERROR_CODES,
} = require('./agentic_delete_recovery_service');

const AGENTIC_DELETE_STARTUP_RECOVERY_SERVICE_VERSION =
  'agentic-delete-startup-recovery-service.v1';
const MAX_STARTUP_RECOVERY_CANDIDATES = 1_024;
const HARD_MAX_LISTED_RECOVERY_CANDIDATES = 10_000;
const MAX_DATA_NODES = 2_048;
const MAX_DATA_DEPTH = 16;

const OPTION_KEYS = Object.freeze([
  'recoverInterruptedJobs',
  'listAuthorizedJobRecoveryCandidates',
  'recoverJob',
  'audit',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'recoverInterruptedJobs',
  'listAuthorizedJobRecoveryCandidates',
  'recoverJob',
]);
const REQUEST_KEYS = Object.freeze(['reason']);
const INTERRUPTED_RESULT_KEYS = Object.freeze(['ok', 'recovered', 'jobIds']);
const CANDIDATE_RESULT_KEYS = Object.freeze(['ok', 'jobIds']);
const RECOVERY_RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'ok',
  'status',
  'disposition',
  'errorCode',
  'idempotent',
]);
const RECOVERY_STATUSES = new Set(['completed', 'denied', 'failed']);
const RECOVERY_DISPOSITIONS = new Set(['rollback', 'purge']);
const RECOVERY_ERROR_CODE_VALUES = new Set(Object.values(RECOVERY_ERROR_CODES));
const SAFE_REASON = /^[A-Za-z][A-Za-z0-9_:-]{0,79}$/;
const SAFE_JOB_ID = /^job-[A-Za-z0-9._-]{1,180}$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function inspectDataRecord(value, { allowedKeys, requiredKeys = [] } = {}) {
  try {
    if (!isObject(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return null;
    if (allowedKeys && keys.some((key) => !allowedKeys.includes(key))) return null;
    if (requiredKeys.some((key) => !keys.includes(key))) return null;
    const fields = new Map();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.value === undefined) {
        return null;
      }
      fields.set(key, descriptor.value);
    }
    return fields;
  } catch {
    return null;
  }
}

function absorbNativePromise(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => {}, () => {}]);
    return true;
  } catch {
    return false;
  }
}

function readDenseJobIds(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    if (!Number.isSafeInteger(value.length)
      || value.length < 0
      || value.length > HARD_MAX_LISTED_RECOVERY_CANDIDATES) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') return null;
    const jobIds = [];
    for (let index = 0; index < value.length; index += 1) {
      if (keys[index] !== String(index)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'string'
        || !SAFE_JOB_ID.test(descriptor.value)) {
        return null;
      }
      jobIds.push(descriptor.value);
    }
    return Object.freeze(jobIds);
  } catch {
    return null;
  }
}

function normalizeInterruptedResult(value) {
  if (absorbNativePromise(value)) return null;
  const fields = inspectDataRecord(value, {
    allowedKeys: INTERRUPTED_RESULT_KEYS,
    requiredKeys: ['ok'],
  });
  if (!fields || typeof fields.get('ok') !== 'boolean') return null;
  if (fields.get('ok') !== true) {
    return fields.size === 1 ? Object.freeze({ ok: false }) : null;
  }
  if (fields.size !== INTERRUPTED_RESULT_KEYS.length) return null;
  const recovered = fields.get('recovered');
  const jobIds = readDenseJobIds(fields.get('jobIds'));
  if (!Number.isSafeInteger(recovered)
    || recovered < 0
    || Object.is(recovered, -0)
    || !jobIds
    || recovered !== jobIds.length) {
    return null;
  }
  return Object.freeze({ ok: true, recovered, jobIds });
}

function normalizeCandidateResult(value) {
  if (absorbNativePromise(value)) return null;
  const fields = inspectDataRecord(value, {
    allowedKeys: CANDIDATE_RESULT_KEYS,
    requiredKeys: ['ok'],
  });
  if (!fields || typeof fields.get('ok') !== 'boolean') return null;
  if (fields.get('ok') !== true) {
    return fields.size === 1 ? Object.freeze({ ok: false }) : null;
  }
  if (fields.size !== CANDIDATE_RESULT_KEYS.length) return null;
  const jobIds = readDenseJobIds(fields.get('jobIds'));
  return jobIds ? Object.freeze({ ok: true, jobIds }) : null;
}

function isPlainData(value, state = { nodes: 0 }, depth = 0, seen = new Set()) {
  state.nodes += 1;
  if (state.nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || key === 'then')) return false;
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype
        || keys.length !== value.length + 1
        || keys[keys.length - 1] !== 'length') {
        return false;
      }
      for (let index = 0; index < value.length; index += 1) {
        if (keys[index] !== String(index)) return false;
      }
    } else if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    for (const key of keys) {
      if (key === 'length' && Array.isArray(value)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.value === undefined
        || !isPlainData(descriptor.value, state, depth + 1, seen)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}

function normalizeRecoveryResult(value) {
  if (absorbNativePromise(value) || !isPlainData(value)) return null;
  const fields = inspectDataRecord(value, {
    allowedKeys: RECOVERY_RESULT_KEYS,
    requiredKeys: RECOVERY_RESULT_KEYS,
  });
  if (!fields
    || fields.get('schemaVersion') !== AGENTIC_DELETE_RECOVERY_RESULT_VERSION
    || typeof fields.get('ok') !== 'boolean'
    || !RECOVERY_STATUSES.has(fields.get('status'))
    || (fields.get('disposition') !== null
      && !RECOVERY_DISPOSITIONS.has(fields.get('disposition')))
    || typeof fields.get('idempotent') !== 'boolean') {
    return null;
  }
  if (fields.get('ok') === true) {
    const completed = fields.get('status') === 'completed'
      && RECOVERY_DISPOSITIONS.has(fields.get('disposition'))
      && fields.get('errorCode') === null;
    return completed ? Object.freeze({ ok: true }) : null;
  }
  if (!['denied', 'failed'].includes(fields.get('status'))
    || typeof fields.get('errorCode') !== 'string'
    || !RECOVERY_ERROR_CODE_VALUES.has(fields.get('errorCode'))) {
    return null;
  }
  return Object.freeze({ ok: false });
}

function counterResult(overrides = {}) {
  return Object.freeze({
    ok: false,
    interruptedJobs: 0,
    listedCandidates: 0,
    uniqueCandidates: 0,
    attemptedRecoveries: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    deferredCandidates: 0,
    ...overrides,
  });
}

function createAgenticDeleteStartupRecoveryService(options = {}) {
  const optionFields = inspectDataRecord(options, {
    allowedKeys: OPTION_KEYS,
  });
  if (!optionFields) throw new TypeError('agentic delete startup recovery options are invalid');
  for (const name of REQUIRED_OPTION_KEYS) {
    if (!optionFields.has(name)) throw new TypeError(`${name} is required in options`);
  }
  const recoverInterruptedJobs = optionFields.get('recoverInterruptedJobs');
  const listAuthorizedJobRecoveryCandidates = optionFields.get(
    'listAuthorizedJobRecoveryCandidates'
  );
  const recoverJob = optionFields.get('recoverJob');
  const audit = optionFields.has('audit') ? optionFields.get('audit') : () => {};
  for (const [name, callback] of [
    ['recoverInterruptedJobs', recoverInterruptedJobs],
    ['listAuthorizedJobRecoveryCandidates', listAuthorizedJobRecoveryCandidates],
    ['recoverJob', recoverJob],
    ['audit', audit],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }

  let active = false;
  let interferenceGeneration = 0;

  function safeAudit(result) {
    try {
      const auditResult = audit(result);
      absorbNativePromise(auditResult);
    } catch {
      // Startup recovery never depends on telemetry.
    }
  }

  function recoverAtStartup(input = {}) {
    // Adopt a native Promise immediately, before any structural inspection or
    // early return can leave its rejection unobserved. The intrinsic brand
    // check does not read or execute a host object's `then` property.
    const inputIsNativePromise = absorbNativePromise(input);
    if (active) {
      interferenceGeneration += 1;
      return counterResult();
    }

    active = true;
    interferenceGeneration += 1;
    const epoch = interferenceGeneration;
    let result = null;
    try {
      if (inputIsNativePromise) {
        result = counterResult();
        return result;
      }
      const inputFields = inspectDataRecord(input, {
        allowedKeys: REQUEST_KEYS,
        requiredKeys: REQUEST_KEYS,
      });
      const reason = inputFields ? inputFields.get('reason') : null;
      if (typeof reason !== 'string' || !SAFE_REASON.test(reason)) {
        result = counterResult();
        return result;
      }

      let interruptedRaw;
      try { interruptedRaw = recoverInterruptedJobs(reason); } catch {
        result = counterResult();
        return result;
      }
      const interrupted = normalizeInterruptedResult(interruptedRaw);
      if (interferenceGeneration !== epoch || !interrupted || interrupted.ok !== true) {
        result = counterResult();
        return result;
      }

      let candidatesRaw;
      try { candidatesRaw = listAuthorizedJobRecoveryCandidates(); } catch {
        result = counterResult({ interruptedJobs: interrupted.recovered });
        return result;
      }
      const candidates = normalizeCandidateResult(candidatesRaw);
      if (interferenceGeneration !== epoch || !candidates || candidates.ok !== true) {
        result = counterResult({ interruptedJobs: interrupted.recovered });
        return result;
      }

      const uniqueJobIds = [...new Set([
        ...interrupted.jobIds,
        ...candidates.jobIds,
      ])];
      const selectedJobIds = uniqueJobIds.slice(0, MAX_STARTUP_RECOVERY_CANDIDATES);
      let attemptedRecoveries = 0;
      let successfulRecoveries = 0;
      let failedRecoveries = 0;
      let deferredCandidates = uniqueJobIds.length - selectedJobIds.length;

      for (let index = 0; index < selectedJobIds.length; index += 1) {
        const candidateJobId = selectedJobIds[index];
        attemptedRecoveries += 1;
        let recoveryRaw;
        try {
          recoveryRaw = recoverJob(Object.freeze({ jobId: candidateJobId }));
        } catch {
          recoveryRaw = null;
        }
        if (interferenceGeneration !== epoch) {
          failedRecoveries += 1;
          deferredCandidates += selectedJobIds.length - index - 1;
          break;
        }
        const recovery = normalizeRecoveryResult(recoveryRaw);
        if (recovery && recovery.ok === true) successfulRecoveries += 1;
        else failedRecoveries += 1;
      }

      result = counterResult({
        ok: failedRecoveries === 0 && deferredCandidates === 0,
        interruptedJobs: interrupted.recovered,
        listedCandidates: candidates.jobIds.length,
        uniqueCandidates: uniqueJobIds.length,
        attemptedRecoveries,
        successfulRecoveries,
        failedRecoveries,
        deferredCandidates,
      });
      return result;
    } catch {
      result = counterResult();
      return result;
    } finally {
      safeAudit(result || counterResult());
      active = false;
    }
  }

  Object.freeze(recoverAtStartup);
  return Object.freeze({ recoverAtStartup });
}

module.exports = {
  AGENTIC_DELETE_STARTUP_RECOVERY_SERVICE_VERSION,
  MAX_STARTUP_RECOVERY_CANDIDATES,
  createAgenticDeleteStartupRecoveryService,
};
