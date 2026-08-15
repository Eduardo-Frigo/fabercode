'use strict';

const {
  createCapabilityDelegationBinding,
} = require('../capabilities/capability_delegation_contracts');

const AGENTIC_DELETE_RECOVERY_SERVICE_VERSION = 'agentic-delete-recovery-service.v1';
const AGENTIC_DELETE_RECOVERY_RESULT_VERSION = 'agentic-delete-recovery-result.v1';
const DEFAULT_MAX_TRACKED_JOBS = 1_024;
const HARD_MAX_TRACKED_JOBS = 10_000;
// A production agentic run can emit up to 100 model turns and more than one
// transactional effect per turn. Recovery commonly spends two authority
// frontiers per retained transaction (restore plus checkpoint purge), in
// addition to root/lifecycle fences. Keep this bounded, but above that valid
// worst-case operating envelope so restart recovery cannot self-deny midway.
const MAX_AUTHORITY_USES_PER_RECOVERY = 512;

const OPTION_KEYS = Object.freeze([
  'getAuthorizedJobById',
  'authorizeProjectBinding',
  'createTransactionalRuntime',
  'audit',
  'maxTrackedJobs',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'getAuthorizedJobById',
  'authorizeProjectBinding',
  'createTransactionalRuntime',
]);
const RECOVER_KEYS = Object.freeze(['jobId']);
const AUTHORITY_CONTEXT_KEYS = Object.freeze([
  'schemaVersion',
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'kernelId',
  'submissionDigest',
  'actionDigest',
]);
const PHYSICAL_IDENTITY_KEYS = Object.freeze([
  'device',
  'inode',
  'entryDevice',
  'entryInode',
  'entryType',
]);
const RECOVERY_RESULT_KEYS = Object.freeze([
  'ok',
  'recovered',
  'retainedCommitted',
  'retainedUnknown',
]);
const TERMINAL_RESULT_KEYS = Object.freeze([
  'ok',
  'purged',
  'rolledBack',
  'recoveryRequired',
]);
const SAFE_JOB_ID = /^job-[A-Za-z0-9._-]{1,180}$/;
const SAFE_PHASE = /^[a-z][a-z0-9_:-]{0,79}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const FAILED_TERMINAL_PHASES = new Set([
  'failed',
  'runtime_interrupted',
  'execute_authorization_failed',
  'execute_validation_fresh_approval_required',
  'execute_pending_fresh_approval_required',
  'execute_validation_retry_exhausted',
  'execute_pending_retry_exhausted',
  'execute_validation',
  'execute_failed',
  'assistant_planning_failed',
  'provider_failure',
  'persona_retry_exhausted',
  'cortex_briefing_retry_exhausted',
  'cortex_validation_retry_exhausted',
  'cortex_validation',
  'persona_non_actionable_route',
]);

const RECOVERY_ERROR_CODES = Object.freeze({
  AUTHORITY_INVALID: 'AUTHORITY_INVALID',
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  JOB_INVALID: 'JOB_INVALID',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  JOB_NOT_TERMINAL: 'JOB_NOT_TERMINAL',
  PROJECT_UNAVAILABLE: 'PROJECT_UNAVAILABLE',
  RECOVERY_BUSY: 'RECOVERY_BUSY',
  RECOVERY_FAILED: 'RECOVERY_FAILED',
  RECOVERY_UNKNOWN: 'RECOVERY_UNKNOWN',
  RUNTIME_INVALID: 'RUNTIME_INVALID',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function inspectDataRecord(value, { allowedKeys = null, requiredKeys = [] } = {}) {
  try {
    if (!isObject(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return null;
    if (allowedKeys && keys.some((key) => !allowedKeys.includes(key))) return null;
    if (requiredKeys.some((key) => !keys.includes(key))) return null;
    const values = new Map();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.value === undefined) {
        return null;
      }
      values.set(key, descriptor.value);
    }
    return values;
  } catch {
    return null;
  }
}

function sameBinding(left, right) {
  return left.projectId === right.projectId
    && left.canonicalRootPath === right.canonicalRootPath
    && left.realRootPath === right.realRootPath
    && left.sessionId === right.sessionId
    && left.jobId === right.jobId
    && left.kernelId === right.kernelId
    && left.submissionDigest === right.submissionDigest;
}

function normalizeBinding(value) {
  try {
    return createCapabilityDelegationBinding(value);
  } catch {
    return null;
  }
}

function normalizePhysicalIdentity(value) {
  const fields = inspectDataRecord(value, {
    allowedKeys: PHYSICAL_IDENTITY_KEYS,
    requiredKeys: PHYSICAL_IDENTITY_KEYS,
  });
  if (!fields) return null;
  const normalized = {};
  for (const key of PHYSICAL_IDENTITY_KEYS) {
    const entry = fields.get(key);
    if (typeof entry !== 'string' || !entry || entry.length > 128 || entry.includes('\0')) {
      return null;
    }
    normalized[key] = entry;
  }
  return Object.freeze(normalized);
}

function samePhysicalIdentity(left, right) {
  return Boolean(left && right && PHYSICAL_IDENTITY_KEYS.every(
    (key) => left[key] === right[key]
  ));
}

function publicResult({ ok, status, disposition = null, errorCode = null, idempotent = false }) {
  const safeStatus = ['completed', 'denied', 'failed'].includes(status) ? status : 'failed';
  const safeDisposition = ['rollback', 'purge'].includes(disposition) ? disposition : null;
  const safeErrorCode = errorCode && Object.values(RECOVERY_ERROR_CODES).includes(errorCode)
    ? errorCode
    : (safeStatus === 'completed' ? null : RECOVERY_ERROR_CODES.RECOVERY_FAILED);
  return Object.freeze({
    schemaVersion: AGENTIC_DELETE_RECOVERY_RESULT_VERSION,
    ok: ok === true && safeStatus === 'completed',
    status: safeStatus,
    disposition: safeDisposition,
    errorCode: safeStatus === 'completed' ? null : safeErrorCode,
    idempotent: idempotent === true,
  });
}

function denied(errorCode) {
  return publicResult({ ok: false, status: 'denied', errorCode });
}

function failed(errorCode, disposition = null) {
  return publicResult({ ok: false, status: 'failed', disposition, errorCode });
}

function replayResult(result) {
  return publicResult({
    ok: result.ok,
    status: result.status,
    disposition: result.disposition,
    errorCode: result.errorCode,
    idempotent: true,
  });
}

function normalizeTerminalJob(job, requestedJobId) {
  const jobFields = inspectDataRecord(job);
  if (!jobFields || jobFields.has('then')) {
    return { errorCode: RECOVERY_ERROR_CODES.JOB_INVALID };
  }
  const jobId = jobFields.get('id');
  const projectId = jobFields.get('projectId');
  const rootPath = jobFields.get('rootPath');
  const status = jobFields.get('status');
  const phase = jobFields.get('phase');
  const authorityContextStatus = jobFields.get('authorityContextStatus');
  const authorityFields = inspectDataRecord(jobFields.get('authorityContext'), {
    allowedKeys: AUTHORITY_CONTEXT_KEYS,
    requiredKeys: AUTHORITY_CONTEXT_KEYS,
  });
  if (jobId !== requestedJobId
    || typeof projectId !== 'string'
    || typeof rootPath !== 'string'
    || typeof status !== 'string'
    || typeof phase !== 'string'
    || !SAFE_PHASE.test(phase)
    || authorityContextStatus !== 'bound'
    || !authorityFields
    || authorityFields.get('schemaVersion') !== 'assistant-job-authority.v1'
    || authorityFields.get('projectId') !== projectId
    || authorityFields.get('canonicalRootPath') !== rootPath
    || typeof authorityFields.get('submissionDigest') !== 'string'
    || !SHA256_DIGEST.test(authorityFields.get('submissionDigest'))
    || typeof authorityFields.get('actionDigest') !== 'string'
    || !SHA256_DIGEST.test(authorityFields.get('actionDigest'))) {
    return { errorCode: RECOVERY_ERROR_CODES.AUTHORITY_INVALID };
  }

  let outcome;
  if (status === 'completed' && phase === 'done') {
    outcome = 'completed';
  } else if (status === 'failed' && FAILED_TERMINAL_PHASES.has(phase)) {
    outcome = phase === 'runtime_interrupted' ? 'runtime_interrupted' : 'failed';
  } else if (status === 'cancelled' && phase === 'cancelled') {
    outcome = 'cancelled';
  } else {
    return { errorCode: RECOVERY_ERROR_CODES.JOB_NOT_TERMINAL };
  }

  const binding = normalizeBinding({
    projectId: authorityFields.get('projectId'),
    canonicalRootPath: authorityFields.get('canonicalRootPath'),
    realRootPath: authorityFields.get('realRootPath'),
    sessionId: authorityFields.get('sessionId'),
    jobId,
    kernelId: authorityFields.get('kernelId'),
    submissionDigest: authorityFields.get('submissionDigest'),
  });
  if (!binding) return { errorCode: RECOVERY_ERROR_CODES.AUTHORITY_INVALID };
  return Object.freeze({
    binding,
    outcome,
    actionDigest: authorityFields.get('actionDigest'),
  });
}

function normalizeMaintenanceResult(value, keys) {
  const fields = inspectDataRecord(value, { allowedKeys: keys, requiredKeys: keys });
  if (!fields || fields.get('ok') !== true) return null;
  const normalized = {};
  for (const key of keys.filter((entry) => entry !== 'ok')) {
    const count = fields.get(key);
    if (!Number.isSafeInteger(count) || count < 0 || Object.is(count, -0)) return null;
    normalized[key] = count;
  }
  return Object.freeze(normalized);
}

function createAgenticDeleteRecoveryService(options = {}) {
  const optionFields = inspectDataRecord(options, {
    allowedKeys: OPTION_KEYS,
    requiredKeys: REQUIRED_OPTION_KEYS,
  });
  if (!optionFields) throw new TypeError('agentic delete recovery options are invalid');
  const getAuthorizedJobById = optionFields.get('getAuthorizedJobById');
  const authorizeProjectBinding = optionFields.get('authorizeProjectBinding');
  const createTransactionalRuntime = optionFields.get('createTransactionalRuntime');
  const audit = optionFields.has('audit') ? optionFields.get('audit') : () => {};
  for (const [name, callback] of [
    ['getAuthorizedJobById', getAuthorizedJobById],
    ['authorizeProjectBinding', authorizeProjectBinding],
    ['createTransactionalRuntime', createTransactionalRuntime],
    ['audit', audit],
  ]) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }
  const maxTrackedJobs = optionFields.has('maxTrackedJobs')
    ? optionFields.get('maxTrackedJobs')
    : DEFAULT_MAX_TRACKED_JOBS;
  if (!Number.isSafeInteger(maxTrackedJobs)
    || maxTrackedJobs <= 0
    || maxTrackedJobs > HARD_MAX_TRACKED_JOBS) {
    throw new TypeError('maxTrackedJobs is invalid');
  }

  const attempts = new Map();
  const issuedRuntimes = new WeakSet();
  let activeRecovery = null;
  let interferenceGeneration = 0;
  let completedJobs = 0;
  let deniedJobs = 0;
  let failedJobs = 0;
  let reentrantAttempts = 0;

  function safeAudit(status, disposition, errorCode) {
    try {
      const result = audit(Object.freeze({ status, disposition, errorCode }));
      if (result && (typeof result === 'object' || typeof result === 'function')) {
        try {
          Reflect.apply(Promise.prototype.then, result, [() => {}, () => {}]);
        } catch {
          // Ignore non-Promise telemetry values without invoking thenables.
        }
      }
    } catch {
      // Recovery never depends on telemetry.
    }
  }

  function readPersistedJob(jobId, epoch) {
    let raw;
    try { raw = getAuthorizedJobById(jobId); } catch {
      return { errorCode: RECOVERY_ERROR_CODES.JOB_NOT_FOUND };
    }
    if (interferenceGeneration !== epoch || !activeRecovery) {
      return { errorCode: RECOVERY_ERROR_CODES.RECOVERY_BUSY };
    }
    const fields = inspectDataRecord(raw);
    if (!fields || fields.has('then') || fields.get('ok') !== true) {
      return { errorCode: RECOVERY_ERROR_CODES.JOB_NOT_FOUND };
    }
    const job = fields.get('job');
    if (!job) return { errorCode: RECOVERY_ERROR_CODES.JOB_NOT_FOUND };
    return { job };
  }

  function authorizeRootSnapshot(binding, expectedIdentity, epoch) {
    let raw;
    try {
      raw = authorizeProjectBinding(binding.projectId, binding.canonicalRootPath);
    } catch {
      return null;
    }
    if (interferenceGeneration !== epoch || !activeRecovery) return null;
    const fields = inspectDataRecord(raw);
    if (!fields
      || fields.has('then')
      || fields.get('authorized') !== true
      || (fields.has('ok') && fields.get('ok') !== true)
      || fields.get('projectId') !== binding.projectId
      || (fields.has('canonicalRootPath')
        ? fields.get('canonicalRootPath')
        : fields.get('rootPath')) !== binding.canonicalRootPath
      || (fields.has('rootPath') && fields.get('rootPath') !== binding.canonicalRootPath)
      || fields.get('realRootPath') !== binding.realRootPath) {
      return null;
    }
    const physicalIdentity = normalizePhysicalIdentity(fields.get('physicalRootIdentity'));
    if (!physicalIdentity
      || (expectedIdentity && !samePhysicalIdentity(expectedIdentity, physicalIdentity))) {
      return null;
    }
    return Object.freeze({
      projectId: binding.projectId,
      canonicalRootPath: binding.canonicalRootPath,
      realRootPath: binding.realRootPath,
      physicalIdentity,
    });
  }

  function readMatchingPersistedSnapshot(expected, epoch) {
    const persisted = readPersistedJob(expected.binding.jobId, epoch);
    if (!persisted.job) return null;
    const current = normalizeTerminalJob(persisted.job, expected.binding.jobId);
    if (!current.binding
      || !sameBinding(current.binding, expected.binding)
      || current.outcome !== expected.outcome
      || current.actionDigest !== expected.actionDigest) {
      return null;
    }
    return current;
  }

  function validateRecoveryFence(expected, physicalIdentity, epoch) {
    if (!readMatchingPersistedSnapshot(expected, epoch)) return null;
    const root = authorizeRootSnapshot(expected.binding, physicalIdentity, epoch);
    if (!root || !readMatchingPersistedSnapshot(expected, epoch)) return null;
    return root;
  }

  function buildRecoveryAuthority(expected, physicalIdentity, epoch) {
    const { binding } = expected;
    const authority = { active: true, uses: 0 };

    function authorize(candidate, kind) {
      if (!authority.active
        || !activeRecovery
        || interferenceGeneration !== epoch
        || authority.uses >= MAX_AUTHORITY_USES_PER_RECOVERY) {
        authority.active = false;
        return Object.freeze({ authorized: false });
      }
      authority.uses += 1;
      const normalized = normalizeBinding(candidate);
      if (!normalized || !sameBinding(binding, normalized)) {
        authority.active = false;
        return Object.freeze({ authorized: false });
      }
      const root = validateRecoveryFence(expected, physicalIdentity, epoch);
      if (!root) {
        authority.active = false;
        return Object.freeze({ authorized: false });
      }
      if (kind === 'root') {
        return Object.freeze({
          ok: true,
          authorized: true,
          projectId: binding.projectId,
          rootPath: binding.canonicalRootPath,
          canonicalRootPath: binding.canonicalRootPath,
          realRootPath: binding.realRootPath,
        });
      }
      return Object.freeze({ authorized: true, binding });
    }

    return Object.freeze({
      authorizeLifecycle: (candidate) => authorize(candidate, 'lifecycle'),
      authorizeRoot: (candidate) => authorize(candidate, 'root'),
      authorizeEffectFrontier: (candidate) => authorize(candidate, 'frontier'),
      revoke() { authority.active = false; },
    });
  }

  function createRuntime(authority, epoch) {
    let runtime;
    try {
      runtime = createTransactionalRuntime(Object.freeze({
        authorizeLifecycle: authority.authorizeLifecycle,
        authorizeRoot: authority.authorizeRoot,
        authorizeEffectFrontier: authority.authorizeEffectFrontier,
      }));
    } catch {
      return null;
    }
    if (interferenceGeneration !== epoch || !activeRecovery || issuedRuntimes.has(runtime)) {
      return null;
    }
    const runtimeFields = inspectDataRecord(runtime, {
      allowedKeys: ['recoverProject', 'rollbackJob', 'finalizeJob'],
      requiredKeys: ['recoverProject', 'rollbackJob', 'finalizeJob'],
    });
    if (!runtimeFields) return null;
    const methods = {};
    for (const name of ['recoverProject', 'rollbackJob', 'finalizeJob']) {
      const method = runtimeFields.get(name);
      if (typeof method !== 'function') return null;
      methods[name] = method;
    }
    if (interferenceGeneration !== epoch || !activeRecovery) return null;
    issuedRuntimes.add(runtime);
    return Object.freeze({ runtime, methods: Object.freeze(methods) });
  }

  function invokeRuntime(runtimeRecord, methodName, input, epoch) {
    let result;
    try {
      result = runtimeRecord.methods[methodName].call(runtimeRecord.runtime, Object.freeze(input));
    } catch {
      return null;
    }
    if (interferenceGeneration !== epoch || !activeRecovery) return null;
    return result;
  }

  function finishAttempt(attempt, result) {
    attempt.state = 'sealed';
    attempt.result = result;
    if (result.status === 'completed') completedJobs += 1;
    else if (result.status === 'denied') deniedJobs += 1;
    else failedJobs += 1;
    safeAudit(result.status, result.disposition, result.errorCode);
    return result;
  }

  function recoverJob(input = {}) {
    const inputFields = inspectDataRecord(input, {
      allowedKeys: RECOVER_KEYS,
      requiredKeys: RECOVER_KEYS,
    });
    const jobId = inputFields ? inputFields.get('jobId') : null;
    if (typeof jobId !== 'string' || !SAFE_JOB_ID.test(jobId)) {
      return denied(RECOVERY_ERROR_CODES.INVALID_REQUEST);
    }

    const prior = attempts.get(jobId);
    if (prior) {
      if (prior.state === 'sealed') return replayResult(prior.result);
      reentrantAttempts += 1;
      interferenceGeneration += 1;
      return denied(RECOVERY_ERROR_CODES.RECOVERY_BUSY);
    }
    if (activeRecovery) {
      reentrantAttempts += 1;
      interferenceGeneration += 1;
      return denied(RECOVERY_ERROR_CODES.RECOVERY_BUSY);
    }
    if (attempts.size >= maxTrackedJobs) {
      return denied(RECOVERY_ERROR_CODES.CAPACITY_EXCEEDED);
    }

    const attempt = { state: 'active', result: null };
    attempts.set(jobId, attempt);
    interferenceGeneration += 1;
    const epoch = interferenceGeneration;
    activeRecovery = attempt;
    let authority = null;
    let result;
    try {
      const persisted = readPersistedJob(jobId, epoch);
      if (!persisted.job) {
        result = denied(persisted.errorCode);
        return result;
      }
      const normalized = normalizeTerminalJob(persisted.job, jobId);
      if (!normalized.binding) {
        result = denied(normalized.errorCode);
        return result;
      }
      const initialRoot = authorizeRootSnapshot(normalized.binding, null, epoch);
      if (!initialRoot) {
        result = denied(RECOVERY_ERROR_CODES.PROJECT_UNAVAILABLE);
        return result;
      }
      authority = buildRecoveryAuthority(
        normalized,
        initialRoot.physicalIdentity,
        epoch
      );
      if (!validateRecoveryFence(normalized, initialRoot.physicalIdentity, epoch)) {
        result = denied(RECOVERY_ERROR_CODES.AUTHORITY_INVALID);
        return result;
      }
      const runtimeRecord = createRuntime(authority, epoch);
      if (!runtimeRecord) {
        result = failed(RECOVERY_ERROR_CODES.RUNTIME_INVALID);
        return result;
      }
      if (!validateRecoveryFence(normalized, initialRoot.physicalIdentity, epoch)) {
        result = denied(RECOVERY_ERROR_CODES.AUTHORITY_INVALID);
        return result;
      }

      const recoveryRaw = invokeRuntime(
        runtimeRecord,
        'recoverProject',
        { binding: normalized.binding },
        epoch
      );
      const recovery = normalizeMaintenanceResult(recoveryRaw, RECOVERY_RESULT_KEYS);
      if (!recovery || recovery.retainedUnknown !== 0) {
        result = failed(RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN);
        return result;
      }
      if (!validateRecoveryFence(normalized, initialRoot.physicalIdentity, epoch)) {
        // recoverProject may already have restored or purged checkpoint data.
        // Once an effectful recovery method ran, a stale authority fence makes
        // the result ambiguous rather than proving that no effect occurred.
        result = failed(RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN);
        return result;
      }

      const disposition = normalized.outcome === 'completed' ? 'purge' : 'rollback';
      const terminalRaw = normalized.outcome === 'completed'
        ? invokeRuntime(
          runtimeRecord,
          'finalizeJob',
          { binding: normalized.binding, outcome: 'completed' },
          epoch
        )
        : invokeRuntime(
          runtimeRecord,
          'rollbackJob',
          { binding: normalized.binding, reason: `startup_${normalized.outcome}` },
          epoch
        );
      const terminal = normalizeMaintenanceResult(terminalRaw, TERMINAL_RESULT_KEYS);
      if (interferenceGeneration !== epoch || activeRecovery !== attempt) {
        result = failed(RECOVERY_ERROR_CODES.RECOVERY_BUSY, disposition);
        return result;
      }
      const dispositionMatches = disposition === 'purge'
        ? terminal
          && terminal.purged === recovery.retainedCommitted
          && terminal.rolledBack === 0
        : terminal
          && terminal.purged === 0
          && terminal.rolledBack === recovery.retainedCommitted;
      if (!terminal || terminal.recoveryRequired !== 0 || !dispositionMatches) {
        result = failed(RECOVERY_ERROR_CODES.RECOVERY_FAILED, disposition);
        return result;
      }
      if (!validateRecoveryFence(normalized, initialRoot.physicalIdentity, epoch)) {
        result = failed(RECOVERY_ERROR_CODES.RECOVERY_UNKNOWN, disposition);
        return result;
      }
      result = publicResult({
        ok: true,
        status: 'completed',
        disposition,
      });
      return result;
    } catch {
      result = failed(RECOVERY_ERROR_CODES.RECOVERY_FAILED);
      return result;
    } finally {
      if (authority) authority.revoke();
      activeRecovery = null;
      finishAttempt(attempt, result || failed(RECOVERY_ERROR_CODES.RECOVERY_FAILED));
    }
  }

  function diagnostics() {
    return Object.freeze({
      version: AGENTIC_DELETE_RECOVERY_SERVICE_VERSION,
      active: activeRecovery !== null,
      trackedJobs: attempts.size,
      completedJobs,
      deniedJobs,
      failedJobs,
      reentrantAttempts,
      maxTrackedJobs,
      maxAuthorityUses: MAX_AUTHORITY_USES_PER_RECOVERY,
      authorityBoundary: 'main_process_only',
      defaultDecision: 'deny',
    });
  }

  return Object.freeze({ recoverJob, diagnostics });
}

module.exports = {
  AGENTIC_DELETE_RECOVERY_RESULT_VERSION,
  AGENTIC_DELETE_RECOVERY_SERVICE_VERSION,
  RECOVERY_ERROR_CODES,
  createAgenticDeleteRecoveryService,
};
