const { randomUUID: defaultRandomUUID } = require('crypto');

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'blocked', 'cancelled']);
const AUTHORIZED_RECOVERY_FAILED_TERMINAL_PHASES = new Set([
  'failed',
  'runtime_interrupted',
  'execution_cleanup_failed',
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
const AUTHORITY_CONTEXT_SCHEMA_VERSION = 'assistant-job-authority.v1';
const AUTHORITY_CONTEXT_KEYS = [
  'schemaVersion',
  'projectId',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'kernelId',
  'submissionDigest',
  'actionDigest',
];
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_JOB_ID_PATTERN = /^job-[A-Za-z0-9._-]{1,180}$/;
const SAFE_CANARY_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;
const CANARY_ROLLBACK_COMPLETION_KEYS = Object.freeze([
  'promotionId',
  'reconciliationId',
  'sourceRestored',
]);
const MAX_JOB_ID_ATTEMPTS = 3;
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PUBLIC_JOB_REDACTED_KEYS = new Set([
  'authorityContext',
  'canonicalRootPath',
  'realRootPath',
  'sessionId',
  'kernelId',
  'submissionDigest',
  'actionDigest',
  'pendingApprovalRecovery',
]);
const PENDING_APPROVAL_RECOVERY_SCHEMA_VERSION =
  'assistant-pending-approval-recovery.v1';
const EXECUTION_CLEANUP_RECEIPT_SCHEMA_VERSION =
  'assistant-job-execution-cleanup-receipt.v1';
const EXECUTION_CLEANUP_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'jobId',
  'cleanupCompleted',
]);
const PENDING_APPROVAL_RECOVERY_KEYS = Object.freeze([
  'schemaVersion',
  'actionDigest',
  'requestedMode',
  'action',
]);
const PENDING_APPROVAL_MODES = new Set(['ask_each', 'delegate_task']);
const MAX_PENDING_APPROVAL_DATA_NODES = 50_000;
const MAX_PENDING_APPROVAL_DATA_DEPTH = 32;
const MAX_PENDING_APPROVAL_STRING_BYTES = 2 * 1024 * 1024;

function createJobStateStore(dependencies = {}) {
  const {
    CORTEX_BRIEFING_MAX_RETRIES = 8,
    CORTEX_VALIDATION_MAX_RETRIES = 8,
    CORTEX_VALIDATION_STALL_LIMIT = 2,
    JOB_PROGRESS_MIN_DELTA = 1,
    JOB_RETRY_NO_PROGRESS_MS = 1800000,
    JOB_RETRY_SAME_FINGERPRINT_LIMIT = 3,
    JOB_RETRY_SAME_REASON_LIMIT = 6,
    JOB_RETRY_STAGNATION_LIMIT = 12,
    JOB_SOFT_TIMEOUT_MS = 3600000,
    MAX_JOB_EVENTS = 240,
    MAX_JOBS_STORED = 180,
    appendAuditEvent,
    computeRetryBackoffMs,
    isAuthorizedRecoveryProject = () => true,
    isJobsStorageHealthy = () => true,
    isNonRetriableProviderReason,
    onJobTerminal,
    randomUUID = defaultRandomUUID,
    readJobsState,
    writeJobsState,
  } = dependencies;

  function isTerminalJob(job) {
    return Boolean(
      job &&
        (TERMINAL_JOB_STATUSES.has(job.status) || job.phase === 'runtime_interrupted')
    );
  }

  function cloneJsonSnapshot(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clonePendingApprovalData(
    value,
    state = { nodes: 0, stringBytes: 0 },
    depth = 0,
    seen = new Set()
  ) {
    state.nodes += 1;
    if (state.nodes > MAX_PENDING_APPROVAL_DATA_NODES
      || depth > MAX_PENDING_APPROVAL_DATA_DEPTH) {
      throw new TypeError('Pending approval recovery data exceeds structural limits');
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.includes('\0')) throw new TypeError('Pending approval strings must not contain NUL');
      state.stringBytes += Buffer.byteLength(value, 'utf8');
      if (state.stringBytes > MAX_PENDING_APPROVAL_STRING_BYTES) {
        throw new TypeError('Pending approval recovery data exceeds its string budget');
      }
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new TypeError('Pending approval numbers must be finite');
      }
      return value;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) {
      throw new TypeError('Pending approval recovery data is not plain acyclic data');
    }

    seen.add(value);
    try {
      const isArray = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if ((isArray && prototype !== Array.prototype)
        || (!isArray && prototype !== Object.prototype && prototype !== null)) {
        throw new TypeError('Pending approval recovery data must be plain');
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== 'string'
        || key === 'then'
        || UNSAFE_RECORD_KEYS.has(key))) {
        throw new TypeError('Pending approval recovery data contains unsafe keys');
      }
      if (isArray && (keys.length !== value.length + 1 || keys.at(-1) !== 'length')) {
        throw new TypeError('Pending approval arrays must be dense');
      }
      const output = isArray ? [] : {};
      const dataKeys = isArray ? keys.slice(0, -1) : keys;
      dataKeys.forEach((key, index) => {
        if (isArray && key !== String(index)) {
          throw new TypeError('Pending approval arrays must be indexed');
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor
          || descriptor.enumerable !== true
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || descriptor.value === undefined) {
          throw new TypeError('Pending approval recovery data must use data properties');
        }
        output[key] = clonePendingApprovalData(descriptor.value, state, depth + 1, seen);
      });
      return output;
    } finally {
      seen.delete(value);
    }
  }

  function normalizePendingApprovalRecovery(value, expectedDigest = null) {
    let snapshot;
    try {
      snapshot = clonePendingApprovalData(value);
    } catch {
      return null;
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const keys = Object.keys(snapshot).sort();
    const expectedKeys = [...PENDING_APPROVAL_RECOVERY_KEYS].sort();
    if (keys.length !== expectedKeys.length
      || keys.some((key, index) => key !== expectedKeys[index])
      || snapshot.schemaVersion !== PENDING_APPROVAL_RECOVERY_SCHEMA_VERSION
      || !SHA256_DIGEST_PATTERN.test(snapshot.actionDigest)
      || (expectedDigest !== null && snapshot.actionDigest !== expectedDigest)
      || !PENDING_APPROVAL_MODES.has(snapshot.requestedMode)
      || !snapshot.action
      || typeof snapshot.action !== 'object'
      || Array.isArray(snapshot.action)) {
      return null;
    }
    return snapshot;
  }

  function isPendingApprovalRecoveryCandidate(job) {
    if (ownDataValue(job, 'status') !== 'running'
      || ownDataValue(job, 'phase') !== 'awaiting_user_confirmation') {
      return false;
    }
    const authority = validateStoredAuthorityJob(job);
    if (!authority.ok
      || authority.authorityContextStatus !== 'bound'
      || !authority.authorityContext
      || !SHA256_DIGEST_PATTERN.test(authority.authorityContext.actionDigest)) {
      return false;
    }
    return Boolean(normalizePendingApprovalRecovery(
      ownDataValue(job, 'pendingApprovalRecovery'),
      authority.authorityContext.actionDigest
    ));
  }

  function snapshotAuthorityContext(authorityContext, options = {}) {
    if (authorityContext === undefined || authorityContext === null) {
      return { ok: true, authorityContext: null, authorityContextStatus: 'legacy_missing' };
    }

    if (typeof authorityContext !== 'object' || Array.isArray(authorityContext)) {
      return { ok: false, message: 'authorityContext interno inválido.' };
    }

    let prototype;
    let keys;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(authorityContext);
      keys = Reflect.ownKeys(authorityContext);
      descriptors = Object.getOwnPropertyDescriptors(authorityContext);
    } catch {
      return { ok: false, message: 'authorityContext interno inválido.' };
    }
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, message: 'authorityContext interno inválido.' };
    }
    if (keys.some((key) => typeof key !== 'string')) {
      return { ok: false, message: 'authorityContext interno inválido.' };
    }

    keys.sort();
    const expectedKeys = [...AUTHORITY_CONTEXT_KEYS].sort();
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])
    ) {
      return { ok: false, message: 'authorityContext interno inválido.' };
    }

    if (
      AUTHORITY_CONTEXT_KEYS.some((key) => {
        const descriptor = descriptors[key];
        return (
          !descriptor ||
          descriptor.enumerable !== true ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
          descriptor.value === undefined
        );
      })
    ) {
      return { ok: false, message: 'authorityContext interno inválido.' };
    }

    const snapshot = {};
    AUTHORITY_CONTEXT_KEYS.forEach((key) => {
      snapshot[key] = descriptors[key].value;
    });

    const requiredStringFields = AUTHORITY_CONTEXT_KEYS.filter(
      (key) => key !== 'actionDigest'
    );
    if (
      requiredStringFields.some(
        (key) => typeof snapshot[key] !== 'string' || !snapshot[key]
      ) ||
      snapshot.schemaVersion !== AUTHORITY_CONTEXT_SCHEMA_VERSION ||
      !SHA256_DIGEST_PATTERN.test(snapshot.submissionDigest) ||
      (snapshot.actionDigest !== null &&
        (!options.allowBoundActionDigest || !SHA256_DIGEST_PATTERN.test(snapshot.actionDigest)))
    ) {
      return { ok: false, message: 'authorityContext interno inválido.' };
    }

    return { ok: true, authorityContext: snapshot, authorityContextStatus: 'bound' };
  }

  function notifyJobTerminalBestEffort(job) {
    if (typeof onJobTerminal !== 'function') return;
    try {
      const result = onJobTerminal(cloneJsonSnapshot(job));
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Terminal persistence is authoritative; lifecycle observers are best-effort.
    }
  }

  function appendJobAuditBestEffort(type, payload) {
    if (typeof appendAuditEvent !== 'function') return;
    try {
      const result = appendAuditEvent(type, payload);
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Job events are the durable lifecycle record; the secondary audit is best-effort.
    }
  }

  function isSafeJobId(jobId) {
    return Boolean(
      typeof jobId === 'string' &&
        !jobId.includes('\0') &&
        SAFE_JOB_ID_PATTERN.test(jobId) &&
        !UNSAFE_RECORD_KEYS.has(jobId) &&
        !UNSAFE_RECORD_KEYS.has(jobId.slice(4))
    );
  }

  function invalidJobIdResult(jobId) {
    if (!jobId) return { ok: false, code: 'job_id_required', message: 'jobId é obrigatório.' };
    return { ok: false, code: 'invalid_job_id', message: 'jobId inválido.' };
  }

  function normalizeCanaryRollbackCompletion(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    let prototype;
    let keys;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return null;
    }
    if ((prototype !== Object.prototype && prototype !== null)
      || keys.length !== CANARY_ROLLBACK_COMPLETION_KEYS.length
      || keys.some((key) => typeof key !== 'string'
        || UNSAFE_RECORD_KEYS.has(key)
        || !CANARY_ROLLBACK_COMPLETION_KEYS.includes(key))
      || CANARY_ROLLBACK_COMPLETION_KEYS.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor || descriptor.enumerable !== true
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value');
      })) return null;
    const promotionId = descriptors.promotionId.value;
    const reconciliationId = descriptors.reconciliationId.value;
    const sourceRestored = descriptors.sourceRestored.value;
    if (typeof promotionId !== 'string'
      || !SAFE_CANARY_IDENTIFIER_PATTERN.test(promotionId)
      || typeof reconciliationId !== 'string'
      || !SAFE_CANARY_IDENTIFIER_PATTERN.test(reconciliationId)
      || sourceRestored !== true) return null;
    return {
      promotionId,
      reconciliationId,
      sourceRestored: true,
    };
  }

  function ownDataValue(value, key) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch {
      return undefined;
    }
    return descriptor && descriptor.enumerable === true
      && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value : undefined;
  }

  function completedCanaryPromotionId(job) {
    if (ownDataValue(job, 'status') !== 'completed'
      || ownDataValue(job, 'phase') !== 'done') return null;
    const events = ownDataValue(job, 'events');
    if (!Array.isArray(events)) return null;
    for (const event of events) {
      if (ownDataValue(event, 'type') !== 'job.completed') continue;
      const payload = ownDataValue(event, 'payload');
      const promotionId = ownDataValue(payload, 'canaryPromotionId');
      if (ownDataValue(payload, 'canary') === true
        && typeof promotionId === 'string'
        && SAFE_CANARY_IDENTIFIER_PATTERN.test(promotionId)) {
        return promotionId;
      }
    }
    return null;
  }

  function projectPublicJobValue(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return null;
    seen.add(value);

    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return null;
    }
    if (Array.isArray(value)) {
      const lengthDescriptor = descriptors.length;
      const length =
        lengthDescriptor &&
        Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') &&
        Number.isSafeInteger(lengthDescriptor.value) &&
        lengthDescriptor.value >= 0
          ? lengthDescriptor.value
          : 0;
      const projectedArray = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        projectedArray.push(
          descriptor &&
            descriptor.enumerable === true &&
            Object.prototype.hasOwnProperty.call(descriptor, 'value')
            ? projectPublicJobValue(descriptor.value, seen)
            : null
        );
      }
      return projectedArray;
    }

    const projected = {};
    for (const key of Object.keys(descriptors)) {
      if (PUBLIC_JOB_REDACTED_KEYS.has(key) || UNSAFE_RECORD_KEYS.has(key)) continue;
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        continue;
      }
      Object.defineProperty(projected, key, {
        configurable: true,
        enumerable: true,
        value: projectPublicJobValue(descriptor.value, seen),
        writable: true,
      });
    }
    return projected;
  }

  function validateStoredAuthorityJob(job) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      return { ok: false, code: 'authority_job_invalid', message: 'Job autoritativo inválido.' };
    }

    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(job);
      descriptors = Object.getOwnPropertyDescriptors(job);
    } catch {
      return { ok: false, code: 'authority_job_invalid', message: 'Job autoritativo inválido.' };
    }
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, code: 'authority_job_invalid', message: 'Job autoritativo inválido.' };
    }

    const authorityDescriptor = descriptors.authorityContext;
    if (
      authorityDescriptor &&
      (authorityDescriptor.enumerable !== true ||
        !Object.prototype.hasOwnProperty.call(authorityDescriptor, 'value'))
    ) {
      return { ok: false, code: 'authority_context_invalid', message: 'Contexto de autoridade persistido inválido.' };
    }
    const authorityContext = authorityDescriptor ? authorityDescriptor.value : undefined;

    const validation = snapshotAuthorityContext(authorityContext, {
      allowBoundActionDigest: true,
    });
    if (!validation.ok) {
      return { ok: false, code: 'authority_context_invalid', message: 'Contexto de autoridade persistido inválido.' };
    }

    const derivedStatus = validation.authorityContext ? 'bound' : 'legacy_missing';
    const statusDescriptor = descriptors.authorityContextStatus;
    if (
      statusDescriptor &&
      (statusDescriptor.enumerable !== true ||
        !Object.prototype.hasOwnProperty.call(statusDescriptor, 'value'))
    ) {
      return { ok: false, code: 'authority_status_invalid', message: 'Status de autoridade persistido inválido.' };
    }
    const persistedStatus = statusDescriptor ? statusDescriptor.value : undefined;
    if (
      (persistedStatus !== undefined && persistedStatus !== derivedStatus) ||
      (derivedStatus === 'bound' && persistedStatus !== 'bound')
    ) {
      return { ok: false, code: 'authority_status_invalid', message: 'Status de autoridade persistido inválido.' };
    }

    if (!validation.authorityContext) {
      return {
        ok: true,
        authorityContext: null,
        authorityContextStatus: 'legacy_missing',
      };
    }
    const projectDescriptor = descriptors.projectId;
    const rootDescriptor = descriptors.rootPath;
    if (
      !projectDescriptor ||
      !rootDescriptor ||
      projectDescriptor.enumerable !== true ||
      rootDescriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(projectDescriptor, 'value') ||
      !Object.prototype.hasOwnProperty.call(rootDescriptor, 'value')
    ) {
      return { ok: false, code: 'authority_binding_invalid', message: 'Binding autoritativo persistido inválido.' };
    }
    if (
      projectDescriptor.value !== validation.authorityContext.projectId ||
      rootDescriptor.value !== validation.authorityContext.canonicalRootPath
    ) {
      return { ok: false, code: 'authority_binding_invalid', message: 'Binding autoritativo persistido inválido.' };
    }
    return {
      ok: true,
      authorityContext: validation.authorityContext,
      authorityContextStatus: 'bound',
    };
  }

  function generateUniqueJobIdentity() {
    if (typeof randomUUID !== 'function') return null;
    for (let attempt = 0; attempt < MAX_JOB_ID_ATTEMPTS; attempt += 1) {
      let candidate;
      try {
        candidate = randomUUID();
      } catch {
        continue;
      }
      if (
        typeof candidate !== 'string' ||
        candidate.includes('\0') ||
        !UUID_V4_PATTERN.test(candidate)
      ) {
        continue;
      }

      const id = `job-${candidate.toLowerCase()}`;
      const current = readJobsState();
      if (!Object.hasOwn(current.jobsById, id)) {
        return { id, current };
      }
    }
    return null;
  }

  function buildJobEvent(type, payload = {}) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };
  }

  const JOB_PHASE_PROGRESS_BASE = {
    created: 0,
    persona_plan: 18,
    cortex_intake: 12,
    cortex_briefing: 26,
    cortex_render_pass: 44,
    cortex_validation: 52,
    paused_memory_pressure: 52,
    persona_done: 42,
    awaiting_user_confirmation: 58,
    awaiting_user_input: 100,
    execute_pending: 76,
    done: 100,
    failed: 100,
    cancelled: 100,
  };

  function clampJobPct(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function ensureJobProgressState(job) {
    const nowIso = new Date().toISOString();
    const current = job && job.progress && typeof job.progress === 'object' ? job.progress : {};
    const phasePct = current.phasePct && typeof current.phasePct === 'object' ? current.phasePct : {};
    const pct = clampJobPct(current.pct, 0);
    const lastDelta = Number.isFinite(current.lastDelta) ? Number(current.lastDelta) : 0;
    const updatedAt = typeof current.updatedAt === 'string' && current.updatedAt ? current.updatedAt : nowIso;

    job.progress = {
      pct,
      updatedAt,
      lastDelta,
      phasePct,
    };
    return job.progress;
  }

  function ensureJobRetryState(job) {
    const nowIso = new Date().toISOString();
    const current = job && job.retryState && typeof job.retryState === 'object' ? job.retryState : {};
    const noProgressSince =
      typeof current.noProgressSince === 'string' && current.noProgressSince
        ? current.noProgressSince
        : nowIso;

    job.retryState = {
      stagnationCount: Number.isFinite(current.stagnationCount) ? Number(current.stagnationCount) : 0,
      noProgressSince,
      lastRetryAt: current.lastRetryAt || null,
      nextRetryAt: current.nextRetryAt || null,
      retryable: current.retryable !== false,
      softTimeoutExceeded: Boolean(current.softTimeoutExceeded),
      lastValidationScore: Number.isFinite(Number(current.lastValidationScore))
        ? Number(current.lastValidationScore)
        : null,
      validationSameScoreCount: Number.isFinite(Number(current.validationSameScoreCount))
        ? Number(current.validationSameScoreCount)
        : 0,
      lastReason: typeof current.lastReason === 'string' ? current.lastReason : '',
      repeatedReasonCount: Number.isFinite(Number(current.repeatedReasonCount))
        ? Number(current.repeatedReasonCount)
        : 0,
      lastRetryFingerprint:
        typeof current.lastRetryFingerprint === 'string' ? current.lastRetryFingerprint : '',
      repeatedFingerprintCount: Number.isFinite(Number(current.repeatedFingerprintCount))
        ? Number(current.repeatedFingerprintCount)
        : 0,
    };
    return job.retryState;
  }

  function buildRetryFingerprint(phase, reason, override = null) {
    if (override && typeof override === 'string' && override.trim()) {
      return override.trim().toLowerCase().slice(0, 240);
    }
    const safePhase = String(phase || '').toLowerCase().trim() || 'unknown_phase';
    const safeReason = String(reason || '')
      .toLowerCase()
      .replace(/retry-after\s*:\s*[^\)\]\s]+/gi, 'retry-after:*')
      .replace(/\bjob-[a-z0-9\-]+\b/gi, 'job-*')
      .replace(/\b\d{2}:\d{2}:\d{2}\b/g, 'time:*')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    return `${safePhase}|${safeReason}`;
  }

  function isNonRetriableValidationReason(reason = '', phase = '') {
    const normalizedPhase = String(phase || '').toLowerCase().trim();
    const normalizedReason = String(reason || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalizedPhase !== 'execute_validation' && normalizedPhase !== 'cortex_validation') return false;
    return /\b(visual_validation_failed|visual_validation_capture_required|visual_validation_capture_unavailable|expected_brand_missing|stale_fallback_brand|generic_placeholders|semantic_visual_minimum|product_visual_coverage_minimum)\b/.test(
      normalizedReason
    );
  }

  function derivePhaseProgressPct(phase, attempt = 1) {
    const base = Number.isFinite(JOB_PHASE_PROGRESS_BASE[phase]) ? JOB_PHASE_PROGRESS_BASE[phase] : null;
    if (!Number.isFinite(base)) return null;
    const bonus = Math.max(0, Math.min(8, (Number(attempt) || 1) - 1));
    return clampJobPct(base + bonus, base);
  }

  function applyProgressUpdate(job, nextPct, phase = null) {
    const progress = ensureJobProgressState(job);
    const currentPct = clampJobPct(progress.pct, 0);
    const targetPct = clampJobPct(nextPct, currentPct);
    const finalPct = Math.max(currentPct, targetPct);
    const delta = finalPct - currentPct;
    const nowIso = new Date().toISOString();

    progress.pct = finalPct;
    progress.lastDelta = delta;
    progress.updatedAt = nowIso;
    if (phase) {
      progress.phasePct = {
        ...(progress.phasePct || {}),
        [phase]: finalPct,
      };
    }
    return { progress, delta, nowIso };
  }

  function mutateJobState(jobId, mutator, options = {}) {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const previousJob = current.jobsById[jobId];
    if (!previousJob || typeof previousJob !== 'object' || Array.isArray(previousJob)) {
      return { ok: false, code: 'job_invalid', message: 'Job persistido inválido.' };
    }
    if (options.rejectTerminal && isTerminalJob(previousJob)) {
      return { ok: false, code: 'job_terminal', message: 'Job já está em estado terminal.' };
    }
    if (previousJob.phase === 'cancelling' && options.allowCancellationPending !== true) {
      return {
        ok: false,
        code: 'job_cancellation_pending',
        message: 'O cancelamento aguarda confirmação do cleanup.',
      };
    }

    const nextJob = mutator({ ...previousJob });
    if (!nextJob || typeof nextJob !== 'object') {
      return { ok: false, message: 'Mutação de job inválida.' };
    }

    nextJob.updatedAt = new Date().toISOString();
    const jobsById = {
      ...current.jobsById,
      [jobId]: nextJob,
    };
    writeJobsState({
      ...current,
      jobsById,
    });
    if (options.notifyTerminal && !isTerminalJob(previousJob) && isTerminalJob(nextJob)) {
      notifyJobTerminalBestEffort(nextJob);
    }
    return { ok: true, job: nextJob };
  }

  function createAssistantJob(input = {}, internalOptions = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, code: 'job_input_invalid', message: 'Entrada de job inválida.' };
    }
    const {
      projectId = null,
      rootPath = null,
      userMessage = '',
      attachments = [],
      mode = 'default',
      authorityContext,
    } = input;
    const now = new Date().toISOString();
    const authoritySnapshot = snapshotAuthorityContext(authorityContext);
    if (!authoritySnapshot.ok) return authoritySnapshot;
    const requireAuthorityContext =
      internalOptions.requireAuthorityContext === true || input.requireAuthorityContext === true;
    if (requireAuthorityContext && !authoritySnapshot.authorityContext) {
      return {
        ok: false,
        code: 'authority_context_required',
        message: 'authorityContext é obrigatório para jobs autoritativos.',
      };
    }

    if (authoritySnapshot.authorityContext) {
      if (
        (Object.hasOwn(input, 'projectId') &&
          projectId !== authoritySnapshot.authorityContext.projectId) ||
        (Object.hasOwn(input, 'rootPath') &&
          rootPath !== authoritySnapshot.authorityContext.canonicalRootPath)
      ) {
        return {
          ok: false,
          code: 'authority_binding_mismatch',
          message: 'projectId/rootPath divergem do contexto autoritativo.',
        };
      }
    }

    const identity = generateUniqueJobIdentity();
    if (!identity) {
      return { ok: false, message: 'Não foi possível gerar um identificador único para o job.' };
    }
    const { id, current } = identity;
    const boundAuthorityContext = authoritySnapshot.authorityContext;
    const authoritativeProjectId = boundAuthorityContext
      ? boundAuthorityContext.projectId
      : projectId;
    const authoritativeRootPath = boundAuthorityContext
      ? boundAuthorityContext.canonicalRootPath
      : rootPath;
    const job = {
      id,
      status: 'running',
      phase: 'created',
      createdAt: now,
      updatedAt: now,
      projectId: authoritativeProjectId,
      rootPath: authoritativeRootPath,
      mode,
      authorityContext: authoritySnapshot.authorityContext,
      authorityContextStatus: authoritySnapshot.authorityContextStatus,
      request: {
        userMessage: String(userMessage || ''),
        attachments: Array.isArray(attachments) ? attachments : [],
      },
      attemptsByPhase: {},
      checkpoints: {},
      progress: {
        pct: 0,
        updatedAt: now,
        lastDelta: 0,
        phasePct: {},
      },
      retryState: {
        stagnationCount: 0,
        noProgressSince: now,
        lastRetryAt: null,
        nextRetryAt: null,
        retryable: true,
        softTimeoutExceeded: false,
      },
      lastError: null,
      events: [
        buildJobEvent('job.created', {
          projectId: authoritativeProjectId,
          rootPath: authoritativeRootPath,
          userMessagePreview: String(userMessage || '').slice(0, 220),
          attachmentsCount: Array.isArray(attachments) ? attachments.length : 0,
        }),
      ],
    };

    const nextOrder = [
      id,
      ...current.jobOrder.filter(
        (entry) => isSafeJobId(entry) && Object.hasOwn(current.jobsById, entry)
      ),
    ].slice(0, MAX_JOBS_STORED);
    const jobsById = Object.create(null);
    for (const key of nextOrder) {
      if (Object.hasOwn(current.jobsById, key)) jobsById[key] = current.jobsById[key];
    }
    jobsById[id] = job;

    writeJobsState({
      jobsById,
      jobOrder: nextOrder,
    });

    appendJobAuditBestEffort('job.created', {
      jobId: id,
      projectId: authoritativeProjectId,
      rootPath: authoritativeRootPath,
      mode,
    });

    return { ok: true, job };
  }

  function createAuthorizedAssistantJob(input = {}) {
    return createAssistantJob(input, { requireAuthorityContext: true });
  }

  function appendJobEvent(jobId, type, payload = {}) {
    return mutateJobState(jobId, (job) => {
      job.events = [buildJobEvent(type, payload), ...(Array.isArray(job.events) ? job.events : [])].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true });
  }

  function markJobPhase(jobId, phase, payload = {}) {
    const next = mutateJobState(jobId, (job) => {
      const attempts = { ...(job.attemptsByPhase || {}) };
      attempts[phase] = Number(attempts[phase] || 0) + 1;
      const attemptNumber = attempts[phase];

      job.status = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' ? job.status : 'running';
      job.phase = phase;
      job.attemptsByPhase = attempts;

      const retryState = ensureJobRetryState(job);
      const phasePct = derivePhaseProgressPct(phase, attemptNumber);
      let progressPct = null;

      if (Number.isFinite(phasePct)) {
        const progressResult = applyProgressUpdate(job, phasePct, phase);
        progressPct = progressResult.progress.pct;

        if (progressResult.delta >= JOB_PROGRESS_MIN_DELTA) {
          retryState.stagnationCount = 0;
          retryState.noProgressSince = progressResult.nowIso;
          retryState.softTimeoutExceeded = false;
        }
      } else {
        ensureJobProgressState(job);
      }

      job.events = [
        buildJobEvent('job.phase_changed', { phase, attempt: attemptNumber, progressPct, ...payload }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.phase_changed', { jobId, phase });
    }
    return next;
  }

  function setJobCheckpoint(jobId, key, data) {
    return mutateJobState(jobId, (job) => {
      job.checkpoints = {
        ...(job.checkpoints || {}),
        [key]: {
          savedAt: new Date().toISOString(),
          data,
        },
      };
      job.events = [
        buildJobEvent('job.checkpoint_saved', { key }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true });
  }

  function markJobRetryPending(jobId, reason, phase = 'persona_plan', meta = {}) {
    const next = mutateJobState(jobId, (job) => {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const safeReason = String(reason || 'retry_pending');
      const normalizedReason = safeReason.toLowerCase();

      const progress = ensureJobProgressState(job);
      const retryState = ensureJobRetryState(job);

      job.status = 'retry_pending';
      job.phase = phase;
      job.lastError = safeReason;

      const hadRecentProgress = Number(progress.lastDelta || 0) >= JOB_PROGRESS_MIN_DELTA;
      if (hadRecentProgress) {
        retryState.stagnationCount = 0;
        retryState.noProgressSince = nowIso;
      } else {
        retryState.stagnationCount = Number(retryState.stagnationCount || 0) + 1;
        if (!retryState.noProgressSince) retryState.noProgressSince = nowIso;
      }

      const noProgressSinceMs = new Date(retryState.noProgressSince || nowIso).getTime();
      const noProgressElapsedMs = Number.isFinite(noProgressSinceMs) ? Math.max(0, now - noProgressSinceMs) : 0;
      const createdAtMs = new Date(job.createdAt || nowIso).getTime();
      const totalElapsedMs = Number.isFinite(createdAtMs) ? Math.max(0, now - createdAtMs) : 0;

      const hardStagnationExceeded = retryState.stagnationCount >= Math.max(1, JOB_RETRY_STAGNATION_LIMIT);
      const hardNoProgressExceeded =
        JOB_RETRY_NO_PROGRESS_MS > 0 && noProgressElapsedMs >= JOB_RETRY_NO_PROGRESS_MS;

      retryState.softTimeoutExceeded = JOB_SOFT_TIMEOUT_MS > 0 && totalElapsedMs >= JOB_SOFT_TIMEOUT_MS;
      if (retryState.lastReason && retryState.lastReason === normalizedReason) {
        retryState.repeatedReasonCount = Number(retryState.repeatedReasonCount || 0) + 1;
      } else {
        retryState.repeatedReasonCount = 0;
      }
      retryState.lastReason = normalizedReason;

      const retryFingerprint = buildRetryFingerprint(phase, safeReason, meta && meta.fingerprint ? meta.fingerprint : null);
      if (!hadRecentProgress && retryState.lastRetryFingerprint && retryState.lastRetryFingerprint === retryFingerprint) {
        retryState.repeatedFingerprintCount = Number(retryState.repeatedFingerprintCount || 0) + 1;
      } else if (hadRecentProgress) {
        retryState.repeatedFingerprintCount = 0;
      } else if (retryState.lastRetryFingerprint !== retryFingerprint) {
        retryState.repeatedFingerprintCount = 0;
      }
      retryState.lastRetryFingerprint = retryFingerprint;

      const nonRetriableReason =
        isNonRetriableProviderReason(safeReason) ||
        isNonRetriableValidationReason(safeReason, phase);
      const phaseAttempts = Number((job.attemptsByPhase && job.attemptsByPhase[phase]) || 0);
      const briefingMaxReached =
        phase === 'cortex_briefing' && phaseAttempts >= Math.max(1, CORTEX_BRIEFING_MAX_RETRIES);
      const validationMaxReached =
        phase === 'cortex_validation' && phaseAttempts >= Math.max(1, CORTEX_VALIDATION_MAX_RETRIES);
      retryState.lastRetryAt = nowIso;

      let validationStalled = false;
      const validationScoreMatch = safeReason.match(/cortex_validation_score:(\d+)/i);
      if (validationScoreMatch) {
        const score = Number.parseInt(validationScoreMatch[1], 10);
        const previousScore = Number.parseInt(retryState.lastValidationScore, 10);
        if (Number.isFinite(score)) {
          if (Number.isFinite(previousScore) && score === previousScore) {
            retryState.validationSameScoreCount = Number(retryState.validationSameScoreCount || 0) + 1;
          } else {
            retryState.validationSameScoreCount = 0;
          }
          retryState.lastValidationScore = score;
        }
        validationStalled = Number(retryState.validationSameScoreCount || 0) >= Math.max(1, CORTEX_VALIDATION_STALL_LIMIT);
      }

      const repeatedReasonExceeded = Number(retryState.repeatedReasonCount || 0) >= Math.max(1, JOB_RETRY_SAME_REASON_LIMIT);
      const repeatedFingerprintExceeded =
        Number(retryState.repeatedFingerprintCount || 0) >= Math.max(1, JOB_RETRY_SAME_FINGERPRINT_LIMIT);
      retryState.retryable = !((hardStagnationExceeded && hardNoProgressExceeded) || nonRetriableReason || validationStalled || briefingMaxReached || validationMaxReached || repeatedReasonExceeded || repeatedFingerprintExceeded);

      const backoffMs = computeRetryBackoffMs(safeReason, retryState.stagnationCount);
      retryState.nextRetryAt = retryState.retryable ? new Date(now + backoffMs).toISOString() : null;

      job.events = [
        buildJobEvent('job.retry_pending', {
          phase,
          reason: safeReason,
          retryable: retryState.retryable,
          stagnationCount: retryState.stagnationCount,
          noProgressElapsedMs,
          totalElapsedMs,
          progressPct: progress.pct,
          softTimeoutExceeded: retryState.softTimeoutExceeded,
          validationSameScoreCount: Number(retryState.validationSameScoreCount || 0),
          repeatedReasonCount: Number(retryState.repeatedReasonCount || 0),
          repeatedFingerprintCount: Number(retryState.repeatedFingerprintCount || 0),
          retryFingerprint,
          nextRetryAt: retryState.nextRetryAt,
          phaseAttempts,
          briefingMaxReached,
          validationMaxReached,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);

      return job;
    }, { rejectTerminal: true });

    if (next.ok) {
      const rs = next.job && next.job.retryState ? next.job.retryState : {};
      appendJobAuditBestEffort('job.retry_pending', {
        jobId,
        phase,
        reason: String(reason || ''),
        retryable: rs.retryable !== false,
        stagnationCount: Number(rs.stagnationCount || 0),
        repeatedFingerprintCount: Number(rs.repeatedFingerprintCount || 0),
        retryFingerprint: rs.lastRetryFingerprint || null,
        nextRetryAt: rs.nextRetryAt || null,
      });
    }
    return next;
  }

  function markJobCompleted(jobId, payload = {}) {
    const next = mutateJobState(jobId, (job) => {
      const retryState = ensureJobRetryState(job);
      const progressResult = applyProgressUpdate(job, 100, 'done');

      retryState.retryable = false;
      retryState.stagnationCount = 0;
      retryState.softTimeoutExceeded = false;
      retryState.lastRetryAt = retryState.lastRetryAt || progressResult.nowIso;
      retryState.nextRetryAt = null;

      job.status = 'completed';
      job.phase = 'done';
      job.lastError = null;
      job.events = [
        buildJobEvent('job.completed', { progressPct: progressResult.progress.pct, ...payload }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true, rejectCancellationPending: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.completed', { jobId });
    }
    return next;
  }

  function markJobCanaryRolledBack(jobId, value) {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    const completion = normalizeCanaryRollbackCompletion(value);
    if (!completion) {
      return {
        ok: false,
        code: 'canary_rollback_completion_invalid',
        message: 'Comprovante de rollback canary inválido.',
      };
    }
    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const previousJob = current.jobsById[jobId];
    const authority = validateStoredAuthorityJob(previousJob);
    if (!authority.ok) return authority;
    if (authority.authorityContextStatus !== 'bound'
      || ownDataValue(previousJob, 'id') !== jobId
      || completedCanaryPromotionId(previousJob) !== completion.promotionId) {
      return {
        ok: false,
        code: 'canary_rollback_unavailable',
        message: 'Este job não possui uma promoção canary reversível.',
      };
    }
    const previousCompletion = ownDataValue(previousJob, 'canaryRollback');
    if (previousCompletion !== undefined) {
      if (ownDataValue(previousCompletion, 'status') === 'completed'
        && CANARY_ROLLBACK_COMPLETION_KEYS.every((key) => (
          ownDataValue(previousCompletion, key) === completion[key]
        ))) {
        return { ok: true, job: previousJob, idempotent: true };
      }
      return {
        ok: false,
        code: 'canary_rollback_conflict',
        message: 'O job já possui outro comprovante de rollback canary.',
      };
    }
    const canaryRollback = {
      status: 'completed',
      ...completion,
    };
    const nextJob = {
      ...previousJob,
      updatedAt: new Date().toISOString(),
      canaryRollback,
      events: [
        buildJobEvent('job.canary_rolled_back', completion),
        ...(Array.isArray(previousJob.events) ? previousJob.events : []),
      ].slice(0, MAX_JOB_EVENTS),
    };
    writeJobsState({
      ...current,
      jobsById: {
        ...current.jobsById,
        [jobId]: nextJob,
      },
    });
    appendJobAuditBestEffort('job.canary_rolled_back', {
      jobId,
      promotionId: completion.promotionId,
      reconciliationId: completion.reconciliationId,
    });
    return { ok: true, job: nextJob, idempotent: false };
  }

  function markJobAwaitingUserInput(jobId, payload = {}) {
    const next = mutateJobState(jobId, (job) => {
      const retryState = ensureJobRetryState(job);
      const progressResult = applyProgressUpdate(job, 100, 'awaiting_user_input');

      retryState.retryable = false;
      retryState.stagnationCount = 0;
      retryState.softTimeoutExceeded = false;
      retryState.lastRetryAt = retryState.lastRetryAt || progressResult.nowIso;
      retryState.nextRetryAt = null;

      job.status = 'completed';
      job.phase = 'awaiting_user_input';
      job.lastError = null;
      job.events = [
        buildJobEvent('job.awaiting_user_input', {
          progressPct: progressResult.progress.pct,
          ...payload,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true, rejectCancellationPending: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.awaiting_user_input', { jobId });
    }
    return next;
  }

  function markJobFailed(jobId, reason, phase = 'failed') {
    const next = mutateJobState(jobId, (job) => {
      const retryState = ensureJobRetryState(job);
      const progressResult = applyProgressUpdate(job, 100, 'failed');

      retryState.retryable = false;
      retryState.nextRetryAt = null;
      retryState.lastRetryAt = retryState.lastRetryAt || progressResult.nowIso;

      job.status = 'failed';
      job.phase = phase;
      job.lastError = String(reason || 'unknown_error');
      job.events = [
        buildJobEvent('job.failed', {
          phase,
          reason: String(reason || ''),
          progressPct: progressResult.progress.pct,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true, rejectCancellationPending: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.failed', { jobId, phase, reason: String(reason || '') });
    }
    return next;
  }

  function markJobBlocked(jobId, reason, phase = 'blocked') {
    const next = mutateJobState(jobId, (job) => {
      const retryState = ensureJobRetryState(job);
      const progressResult = applyProgressUpdate(job, 100, 'blocked');

      retryState.retryable = false;
      retryState.nextRetryAt = null;
      retryState.lastRetryAt = retryState.lastRetryAt || progressResult.nowIso;

      job.status = 'blocked';
      job.phase = phase;
      job.lastError = String(reason || 'blocked');
      job.events = [
        buildJobEvent('job.blocked', {
          phase,
          reason: String(reason || ''),
          progressPct: progressResult.progress.pct,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true, rejectCancellationPending: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.blocked', { jobId, phase, reason: String(reason || '') });
    }
    return next;
  }

  function markJobCancelled(jobId, reason = 'cancelled_by_user') {
    const next = mutateJobState(jobId, (job) => {
      const retryState = ensureJobRetryState(job);
      const progressResult = applyProgressUpdate(job, 100, 'cancelled');

      retryState.retryable = false;
      retryState.nextRetryAt = null;
      retryState.lastReason = String(reason || 'cancelled_by_user');

      job.status = 'cancelled';
      job.phase = 'cancelled';
      job.lastError = null;
      job.events = [
        buildJobEvent('job.cancelled', {
          reason: String(reason || 'cancelled_by_user'),
          progressPct: progressResult.progress.pct,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.cancelled', { jobId, reason: String(reason || 'cancelled_by_user') });
    }
    return next;
  }

  function markJobCancellationRequested(jobId, reason = 'cancelled_by_user') {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const previousJob = current.jobsById[jobId];
    if (!previousJob || typeof previousJob !== 'object' || Array.isArray(previousJob)) {
      return { ok: false, code: 'job_invalid', message: 'Job persistido inválido.' };
    }
    if (previousJob.status === 'running' && previousJob.phase === 'cancelling') {
      return { ok: true, job: previousJob, idempotent: true };
    }
    if (isTerminalJob(previousJob)) {
      return { ok: false, code: 'job_terminal', message: 'Job já está em estado terminal.' };
    }
    const safeReason = String(reason || 'cancelled_by_user');
    const next = mutateJobState(jobId, (job) => {
      const retryState = ensureJobRetryState(job);
      retryState.retryable = false;
      retryState.nextRetryAt = null;
      retryState.lastReason = safeReason;
      job.status = 'running';
      job.phase = 'cancelling';
      job.lastError = null;
      job.cancellation = {
        requestedAt: new Date().toISOString(),
        reason: safeReason,
      };
      job.events = [
        buildJobEvent('job.cancellation_requested', { reason: safeReason }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.cancellation_requested', { jobId, reason: safeReason });
      return { ...next, idempotent: false };
    }
    return next;
  }

  function normalizeExecutionCleanupReceipt(value, expectedJobId) {
    if (value === undefined) {
      return { ok: false, code: 'execution_cleanup_receipt_required' };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Object.isFrozen(value)
      || (Object.getPrototypeOf(value) !== Object.prototype
        && Object.getPrototypeOf(value) !== null)) {
      return { ok: false, code: 'execution_cleanup_receipt_invalid' };
    }
    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      return { ok: false, code: 'execution_cleanup_receipt_invalid' };
    }
    if (keys.length !== EXECUTION_CLEANUP_RECEIPT_KEYS.length
      || EXECUTION_CLEANUP_RECEIPT_KEYS.some((key) => !keys.includes(key))) {
      return { ok: false, code: 'execution_cleanup_receipt_invalid' };
    }
    const fields = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !EXECUTION_CLEANUP_RECEIPT_KEYS.includes(key)
        || !descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')) {
        return { ok: false, code: 'execution_cleanup_receipt_invalid' };
      }
      fields[key] = descriptor.value;
    }
    if (fields.schemaVersion !== EXECUTION_CLEANUP_RECEIPT_SCHEMA_VERSION
      || fields.cleanupCompleted !== true
      || !isSafeJobId(fields.jobId)) {
      return { ok: false, code: 'execution_cleanup_receipt_invalid' };
    }
    if (fields.jobId !== expectedJobId) {
      return { ok: false, code: 'execution_cleanup_receipt_mismatch' };
    }
    return {
      ok: true,
      receipt: Object.freeze({
        schemaVersion: fields.schemaVersion,
        jobId: fields.jobId,
        cleanupCompleted: true,
      }),
    };
  }

  function hasPersistedExecutionCleanupReceipt(job, expectedJobId) {
    const checkpoints = ownDataValue(job, 'checkpoints');
    const checkpoint = ownDataValue(checkpoints, 'execution_cleanup');
    const receipt = ownDataValue(checkpoint, 'data');
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
    let prototype;
    let keys;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(receipt);
      keys = Reflect.ownKeys(receipt);
      descriptors = Object.getOwnPropertyDescriptors(receipt);
    } catch {
      return false;
    }
    if ((prototype !== Object.prototype && prototype !== null)
      || keys.length !== EXECUTION_CLEANUP_RECEIPT_KEYS.length
      || keys.some((key) => typeof key !== 'string'
        || !EXECUTION_CLEANUP_RECEIPT_KEYS.includes(key))) {
      return false;
    }
    for (const key of EXECUTION_CLEANUP_RECEIPT_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return descriptors.schemaVersion.value === EXECUTION_CLEANUP_RECEIPT_SCHEMA_VERSION
      && descriptors.jobId.value === expectedJobId
      && descriptors.cleanupCompleted.value === true;
  }

  function markJobCancelledAfterCleanup(jobId, receiptValue) {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    const normalized = normalizeExecutionCleanupReceipt(receiptValue, jobId);
    if (!normalized.ok) return normalized;
    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const previousJob = current.jobsById[jobId];
    const previousReceipt = previousJob
      && previousJob.checkpoints
      && previousJob.checkpoints.execution_cleanup
      && previousJob.checkpoints.execution_cleanup.data;
    if (previousJob && previousJob.status === 'cancelled' && previousReceipt) {
      const sameReceipt = EXECUTION_CLEANUP_RECEIPT_KEYS.every(
        (key) => previousReceipt[key] === normalized.receipt[key]
      );
      return sameReceipt
        ? { ok: true, job: previousJob, idempotent: true }
        : { ok: false, code: 'execution_cleanup_receipt_conflict' };
    }
    const cancellationPending = previousJob
      && previousJob.status === 'running'
      && previousJob.phase === 'cancelling';
    const cleanupRecoveryPending = previousJob
      && previousJob.status === 'failed'
      && previousJob.phase === 'execution_cleanup_failed';
    const legacyCancellationPending = previousJob
      && previousJob.status === 'cancelled'
      && previousJob.phase === 'cancelled'
      && !previousReceipt;
    if (!cancellationPending && !cleanupRecoveryPending && !legacyCancellationPending) {
      return { ok: false, code: 'execution_cleanup_not_requested' };
    }
    const next = mutateJobState(jobId, (job) => {
      const progressResult = applyProgressUpdate(job, 100, 'cancelled');
      const retryState = ensureJobRetryState(job);
      retryState.retryable = false;
      retryState.nextRetryAt = null;
      job.checkpoints = {
        ...(job.checkpoints || {}),
        execution_cleanup: {
          savedAt: new Date().toISOString(),
          data: normalized.receipt,
        },
      };
      job.status = 'cancelled';
      job.phase = 'cancelled';
      job.lastError = null;
      job.events = [
        ...(!legacyCancellationPending ? [buildJobEvent('job.cancelled', {
          reason: job.cancellation && job.cancellation.reason
            ? job.cancellation.reason
            : 'cancelled_by_user',
          progressPct: progressResult.progress.pct,
          executionCleanupConfirmed: true,
        })] : []),
        buildJobEvent('job.execution_cleanup_confirmed', {
          schemaVersion: normalized.receipt.schemaVersion,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, {
      rejectTerminal: !cleanupRecoveryPending && !legacyCancellationPending,
      allowCancellationPending: true,
      notifyTerminal: !legacyCancellationPending,
    });
    if (next.ok) {
      appendJobAuditBestEffort('job.execution_cleanup_confirmed', { jobId });
      if (!legacyCancellationPending) {
        appendJobAuditBestEffort('job.cancelled', { jobId, reason: 'cleanup_confirmed' });
      }
      return { ...next, idempotent: false };
    }
    return next;
  }

  function markJobExecutionCleanupFailed(jobId, reason = 'execution_cleanup_failed') {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const previousJob = current.jobsById[jobId];
    if (previousJob && previousJob.status === 'failed'
      && previousJob.phase === 'execution_cleanup_failed') {
      return { ok: true, job: previousJob, idempotent: true };
    }
    if (!previousJob || previousJob.status !== 'running' || previousJob.phase !== 'cancelling') {
      return { ok: false, code: 'execution_cleanup_not_requested' };
    }
    const safeReason = String(reason || 'execution_cleanup_failed');
    const next = mutateJobState(jobId, (job) => {
      const progressResult = applyProgressUpdate(job, 100, 'execution_cleanup_failed');
      const retryState = ensureJobRetryState(job);
      retryState.retryable = false;
      retryState.nextRetryAt = null;
      retryState.lastReason = safeReason;
      job.status = 'failed';
      job.phase = 'execution_cleanup_failed';
      job.lastError = safeReason;
      job.events = [
        buildJobEvent('job.execution_cleanup_failed', {
          reason: safeReason,
          progressPct: progressResult.progress.pct,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true, allowCancellationPending: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.execution_cleanup_failed', { jobId, reason: safeReason });
      return { ...next, idempotent: false };
    }
    return next;
  }

  function getAuthorizedJobById(jobId) {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const job = current.jobsById[jobId];
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      return { ok: false, code: 'job_invalid', message: 'Job persistido inválido.' };
    }
    return { ok: true, job };
  }

  function getJobById(jobId) {
    const found = getAuthorizedJobById(jobId);
    if (!found.ok) return found;
    return { ok: true, job: projectPublicJobValue(found.job) };
  }

  function bindJobActionDigest(jobId, digest) {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    if (typeof digest !== 'string' || !SHA256_DIGEST_PATTERN.test(digest)) {
      return { ok: false, code: 'invalid_action_digest', message: 'actionDigest SHA-256 inválido.' };
    }

    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const previousJob = current.jobsById[jobId];
    const authority = validateStoredAuthorityJob(previousJob);
    if (!authority.ok) return authority;
    if (isTerminalJob(previousJob)) {
      return { ok: false, code: 'job_terminal', message: 'Job já está em estado terminal.' };
    }
    if (authority.authorityContextStatus !== 'bound') {
      return {
        ok: false,
        code: 'authority_context_missing',
        message: 'Job legado não possui contexto de autoridade.',
      };
    }

    const currentDigest = authority.authorityContext.actionDigest;
    if (currentDigest === digest) {
      return { ok: true, job: previousJob, idempotent: true };
    }
    if (currentDigest !== null) {
      return {
        ok: false,
        code: 'action_digest_conflict',
        message: 'actionDigest já vinculado a outra ação.',
      };
    }

    const nextJob = {
      ...previousJob,
      updatedAt: new Date().toISOString(),
      authorityContext: {
        ...authority.authorityContext,
        actionDigest: digest,
      },
      authorityContextStatus: authority.authorityContextStatus,
      events: [
        buildJobEvent('job.action_digest_bound'),
        ...(Array.isArray(previousJob.events) ? previousJob.events : []),
      ].slice(0, MAX_JOB_EVENTS),
    };
    writeJobsState({
      ...current,
      jobsById: {
        ...current.jobsById,
        [jobId]: nextJob,
      },
    });
    appendJobAuditBestEffort('job.action_digest_bound', { jobId });
    return { ok: true, job: nextJob, idempotent: false };
  }

  function isJobCancelled(jobId) {
    if (!jobId) return false;
    const found = getAuthorizedJobById(jobId);
    return Boolean(found.ok && found.job
      && (found.job.status === 'cancelled' || found.job.phase === 'cancelling'));
  }

  function markJobPausedForMemory(jobId, payload = {}) {
    return mutateJobState(jobId, (job) => {
      job.status = 'paused_memory_pressure';
      job.phase = 'paused_memory_pressure';
      const progressResult = applyProgressUpdate(job, derivePhaseProgressPct('paused_memory_pressure') || 52, 'paused_memory_pressure');
      const retryState = ensureJobRetryState(job);
      retryState.retryable = true;
      retryState.nextRetryAt = null;
      job.events = [
        buildJobEvent('job.paused_memory_pressure', {
          progressPct: progressResult.progress.pct,
          ...payload,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true });
  }

  function persistPendingApprovalRecovery(jobId, value) {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const previousJob = current.jobsById[jobId];
    const authority = validateStoredAuthorityJob(previousJob);
    if (!authority.ok) return authority;
    if (isTerminalJob(previousJob)) {
      return { ok: false, code: 'job_terminal', message: 'Job já está em estado terminal.' };
    }
    if (previousJob.status !== 'running'
      || previousJob.phase !== 'awaiting_user_confirmation'
      || authority.authorityContextStatus !== 'bound'
      || !authority.authorityContext
      || !SHA256_DIGEST_PATTERN.test(authority.authorityContext.actionDigest)) {
      return {
        ok: false,
        code: 'pending_approval_unavailable',
        message: 'O job não está aguardando uma aprovação recuperável.',
      };
    }
    const normalized = normalizePendingApprovalRecovery(
      value,
      authority.authorityContext.actionDigest
    );
    if (!normalized) {
      const suppliedDigest = ownDataValue(value, 'actionDigest');
      return {
        ok: false,
        code: typeof suppliedDigest === 'string'
          && SHA256_DIGEST_PATTERN.test(suppliedDigest)
          && suppliedDigest !== authority.authorityContext.actionDigest
          ? 'pending_approval_digest_mismatch'
          : 'pending_approval_recovery_invalid',
        message: 'Comprovante de retomada da aprovação inválido.',
      };
    }
    const previousRecovery = normalizePendingApprovalRecovery(
      ownDataValue(previousJob, 'pendingApprovalRecovery'),
      authority.authorityContext.actionDigest
    );
    if (previousRecovery) {
      const idempotent = JSON.stringify(previousRecovery) === JSON.stringify(normalized);
      return idempotent
        ? { ok: true, job: previousJob, idempotent: true }
        : {
          ok: false,
          code: 'pending_approval_recovery_conflict',
          message: 'O job já possui outro comprovante de retomada.',
        };
    }
    const nextJob = {
      ...previousJob,
      updatedAt: new Date().toISOString(),
      pendingApprovalRecovery: normalized,
      events: [
        buildJobEvent('job.pending_approval_recovery_persisted'),
        ...(Array.isArray(previousJob.events) ? previousJob.events : []),
      ].slice(0, MAX_JOB_EVENTS),
    };
    writeJobsState({
      ...current,
      jobsById: { ...current.jobsById, [jobId]: nextJob },
    });
    appendJobAuditBestEffort('job.pending_approval_recovery_persisted', { jobId });
    return { ok: true, job: nextJob, idempotent: false };
  }

  function getPendingApprovalRecovery(jobId) {
    if (!isSafeJobId(jobId)) return invalidJobIdResult(jobId);
    const current = readJobsState();
    if (!Object.hasOwn(current.jobsById, jobId)) {
      return { ok: false, code: 'job_not_found', message: 'Job não encontrado.' };
    }
    const job = current.jobsById[jobId];
    if (!isPendingApprovalRecoveryCandidate(job)) {
      return {
        ok: false,
        code: 'pending_approval_recovery_unavailable',
        message: 'A retomada da aprovação não está disponível.',
      };
    }
    const authority = validateStoredAuthorityJob(job);
    const recovery = normalizePendingApprovalRecovery(
      ownDataValue(job, 'pendingApprovalRecovery'),
      authority.authorityContext.actionDigest
    );
    return { ok: true, job, recovery };
  }

  function listPendingApprovalRecoveryCandidates() {
    const current = readJobsState();
    if (isJobsStorageHealthy() !== true) return { ok: false, jobIds: [] };
    const ordered = [];
    const seen = new Set();
    const inspect = (jobId) => {
      if (seen.has(jobId)
        || !isSafeJobId(jobId)
        || !Object.hasOwn(current.jobsById, jobId)) return;
      seen.add(jobId);
      if (isPendingApprovalRecoveryCandidate(current.jobsById[jobId])) {
        ordered.push(jobId);
      }
    };
    (Array.isArray(current.jobOrder) ? current.jobOrder : []).forEach(inspect);
    Object.keys(current.jobsById).forEach(inspect);
    return { ok: true, jobIds: ordered };
  }

  function markJobApprovalExpired(
    jobId,
    reason = 'approval_expired_after_runtime_restart'
  ) {
    const next = mutateJobState(jobId, (job) => {
      const previousPhase = job.phase || null;
      const retryState = ensureJobRetryState(job);
      const progressResult = applyProgressUpdate(job, 100, 'approval_expired');
      retryState.retryable = false;
      retryState.nextRetryAt = null;
      retryState.lastReason = String(reason || 'approval_expired');
      job.status = 'cancelled';
      job.phase = 'approval_expired';
      job.lastError = null;
      delete job.pendingApprovalRecovery;
      job.events = [
        buildJobEvent('job.approval_expired', {
          previousPhase,
          reason: String(reason || 'approval_expired'),
          progressPct: progressResult.progress.pct,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      return job;
    }, { rejectTerminal: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.approval_expired', {
        jobId,
        reason: String(reason || 'approval_expired'),
      });
    }
    return next;
  }

  function recoverInterruptedJobs(reason = 'runtime_restarted_before_job_completed') {
    const current = readJobsState();
    const interruptedStatuses = new Set(['running', 'retry_pending', 'paused_memory_pressure']);
    const nowIso = new Date().toISOString();
    const recoveredJobIds = [];
    const expiredApprovalJobIds = [];
    const resumableApprovalJobIds = [];
    const jobsById = { ...current.jobsById };
    const ownJobIds = Object.keys(current.jobsById);
    const reconciledOrder = [];
    const seenJobIds = new Set();

    for (const jobId of current.jobOrder || []) {
      if (
        typeof jobId !== 'string' ||
        seenJobIds.has(jobId) ||
        !Object.hasOwn(current.jobsById, jobId)
      ) {
        continue;
      }
      seenJobIds.add(jobId);
      reconciledOrder.push(jobId);
    }
    for (const jobId of ownJobIds) {
      if (seenJobIds.has(jobId)) continue;
      seenJobIds.add(jobId);
      reconciledOrder.push(jobId);
    }

    for (const jobId of ownJobIds) {
      const job = jobsById[jobId];
      if (!job || typeof job !== 'object' || Array.isArray(job)
        || !interruptedStatuses.has(job.status)) continue;

      if (job.status === 'running' && job.phase === 'cancelling') continue;

      const pendingApproval = job.status === 'running'
        && job.phase === 'awaiting_user_confirmation';
      if (pendingApproval) {
        if (isPendingApprovalRecoveryCandidate(job)) {
          const nextJob = { ...job, updatedAt: nowIso };
          if (!Array.isArray(job.events)
            || !job.events[0]
            || job.events[0].type !== 'job.pending_approval_recovery_ready') {
            nextJob.events = [
              buildJobEvent('job.pending_approval_recovery_ready', {
                previousPhase: job.phase,
              }),
              ...(Array.isArray(job.events) ? job.events : []),
            ].slice(0, MAX_JOB_EVENTS);
          }
          jobsById[jobId] = nextJob;
          resumableApprovalJobIds.push(jobId);
          continue;
        }
        const nextJob = { ...job };
        const retryState = ensureJobRetryState(nextJob);
        const progressResult = applyProgressUpdate(nextJob, 100, 'approval_expired');
        retryState.retryable = false;
        retryState.nextRetryAt = null;
        retryState.lastReason = 'approval_expired_after_runtime_restart';
        nextJob.status = 'cancelled';
        nextJob.phase = 'approval_expired';
        nextJob.lastError = null;
        nextJob.updatedAt = nowIso;
        delete nextJob.pendingApprovalRecovery;
        nextJob.events = [
          buildJobEvent('job.approval_expired', {
            previousPhase: job.phase,
            reason: retryState.lastReason,
            progressPct: progressResult.progress.pct,
          }),
          ...(Array.isArray(job.events) ? job.events : []),
        ].slice(0, MAX_JOB_EVENTS);
        jobsById[jobId] = nextJob;
        expiredApprovalJobIds.push(jobId);
        continue;
      }

      const nextJob = { ...job };
      const retryState = ensureJobRetryState(nextJob);
      const progressResult = applyProgressUpdate(nextJob, 100, 'failed');
      retryState.retryable = false;
      retryState.nextRetryAt = null;
      retryState.lastRetryAt = retryState.lastRetryAt || progressResult.nowIso;
      nextJob.status = 'failed';
      nextJob.phase = 'runtime_interrupted';
      nextJob.lastError = String(reason || 'runtime_interrupted');
      nextJob.updatedAt = nowIso;
      nextJob.events = [
        buildJobEvent('job.interrupted', {
          previousStatus: job.status,
          previousPhase: job.phase || null,
          reason: nextJob.lastError,
          progressPct: progressResult.progress.pct,
        }),
        ...(Array.isArray(job.events) ? job.events : []),
      ].slice(0, MAX_JOB_EVENTS);
      jobsById[jobId] = nextJob;
      recoveredJobIds.push(jobId);
    }

    const orderChanged =
      reconciledOrder.length !== current.jobOrder.length ||
      reconciledOrder.some((jobId, index) => jobId !== current.jobOrder[index]);
    if (!recoveredJobIds.length
      && !expiredApprovalJobIds.length
      && !resumableApprovalJobIds.length
      && !orderChanged) {
      return { ok: true, recovered: 0, jobIds: [] };
    }

    writeJobsState({ ...current, jobsById, jobOrder: reconciledOrder });
    [...recoveredJobIds, ...expiredApprovalJobIds].forEach((jobId) => {
      notifyJobTerminalBestEffort(jobsById[jobId]);
    });
    recoveredJobIds.forEach((jobId) => {
      appendJobAuditBestEffort('job.interrupted', {
        jobId,
        phase: 'runtime_interrupted',
        reason: String(reason || 'runtime_interrupted'),
      });
    });
    expiredApprovalJobIds.forEach((jobId) => {
      appendJobAuditBestEffort('job.approval_expired', {
        jobId,
        reason: 'approval_expired_after_runtime_restart',
      });
    });
    resumableApprovalJobIds.forEach((jobId) => {
      appendJobAuditBestEffort('job.pending_approval_recovery_ready', { jobId });
    });
    return { ok: true, recovered: recoveredJobIds.length, jobIds: recoveredJobIds };
  }

  function listAuthorizedJobRecoveryCandidates() {
    const current = readJobsState();
    if (isJobsStorageHealthy() !== true) {
      return { ok: false, jobIds: [] };
    }
    const orderedJobIds = [];
    const seenJobIds = new Set();

    const appendJobId = (jobId) => {
      if (
        seenJobIds.has(jobId) ||
        !isSafeJobId(jobId) ||
        !Object.hasOwn(current.jobsById, jobId)
      ) {
        return;
      }
      seenJobIds.add(jobId);
      orderedJobIds.push(jobId);
    };

    if (Array.isArray(current.jobOrder)) {
      current.jobOrder.forEach(appendJobId);
    }
    Object.keys(current.jobsById).forEach(appendJobId);

    const jobIds = orderedJobIds.filter((jobId) => {
      const job = current.jobsById[jobId];
      const authority = validateStoredAuthorityJob(job);
      if (
        !authority.ok ||
        authority.authorityContextStatus !== 'bound' ||
        !authority.authorityContext ||
        !SHA256_DIGEST_PATTERN.test(authority.authorityContext.actionDigest)
      ) {
        return false;
      }

      let descriptors;
      try {
        descriptors = Object.getOwnPropertyDescriptors(job);
      } catch {
        return false;
      }
      if (Object.hasOwn(descriptors, 'then')) return false;

      const readDataProperty = (key) => {
        const descriptor = descriptors[key];
        if (
          !descriptor ||
          descriptor.enumerable !== true ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
          return undefined;
        }
        return descriptor.value;
      };
      const storedId = readDataProperty('id');
      const status = readDataProperty('status');
      const phase = readDataProperty('phase');
      if (storedId !== jobId) return false;

      const cancellationRecoveryEligible = status === 'running' && phase === 'cancelling';
      const terminalRecoveryEligible = (
        (status === 'completed' && phase === 'done') ||
        (status === 'cancelled' && phase === 'cancelled'
          && !hasPersistedExecutionCleanupReceipt(job, jobId)) ||
        (status === 'failed' && AUTHORIZED_RECOVERY_FAILED_TERMINAL_PHASES.has(phase))
      );
      if (!cancellationRecoveryEligible && !terminalRecoveryEligible) return false;

      const projectId = readDataProperty('projectId');
      const rootPath = readDataProperty('rootPath');
      if (typeof projectId !== 'string' || typeof rootPath !== 'string') return false;
      try {
        return isAuthorizedRecoveryProject(Object.freeze({
          projectId,
          rootPath,
        })) === true;
      } catch {
        return false;
      }
    });

    return { ok: true, jobIds };
  }

  function listJobs({ projectId = null, limit = 30 } = {}) {
    const current = readJobsState();
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Number(limit))) : 30;
    const items = [];
    for (const id of current.jobOrder) {
      if (!isSafeJobId(id) || !Object.hasOwn(current.jobsById, id)) continue;
      const job = current.jobsById[id];
      if (!job || typeof job !== 'object' || Array.isArray(job)) continue;
      if (projectId && job.projectId !== projectId) continue;
      items.push(projectPublicJobValue(job));
      if (items.length >= safeLimit) break;
    }
    return { ok: true, jobs: items };
  }

  return {
    appendJobEvent,
    bindJobActionDigest,
    createAuthorizedAssistantJob,
    createAssistantJob,
    getAuthorizedJobById,
    getJobById,
    getPendingApprovalRecovery,
    isJobCancelled,
    listAuthorizedJobRecoveryCandidates,
    listPendingApprovalRecoveryCandidates,
    listJobs,
    markJobApprovalExpired,
    markJobAwaitingUserInput,
    markJobBlocked,
    markJobCancellationRequested,
    markJobCancelled,
    markJobCancelledAfterCleanup,
    markJobExecutionCleanupFailed,
    markJobCanaryRolledBack,
    markJobCompleted,
    markJobFailed,
    markJobPausedForMemory,
    markJobPhase,
    markJobRetryPending,
    persistPendingApprovalRecovery,
    recoverInterruptedJobs,
    setJobCheckpoint,
  };
}

module.exports = {
  createJobStateStore,
};
