const { randomUUID: defaultRandomUUID } = require('crypto');

const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const AUTHORIZED_RECOVERY_FAILED_TERMINAL_PHASES = new Set([
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
]);

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
    }, { rejectTerminal: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.completed', { jobId });
    }
    return next;
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
    }, { rejectTerminal: true, notifyTerminal: true });
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
    }, { rejectTerminal: true, notifyTerminal: true });
    if (next.ok) {
      appendJobAuditBestEffort('job.failed', { jobId, phase, reason: String(reason || '') });
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
    return Boolean(found.ok && found.job && found.job.status === 'cancelled');
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

  function recoverInterruptedJobs(reason = 'runtime_restarted_before_job_completed') {
    const current = readJobsState();
    const interruptedStatuses = new Set(['running', 'retry_pending', 'paused_memory_pressure']);
    const nowIso = new Date().toISOString();
    const recoveredJobIds = [];
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
      if (!job || typeof job !== 'object' || Array.isArray(job) || !interruptedStatuses.has(job.status)) continue;

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
    if (!recoveredJobIds.length && !orderChanged) {
      return { ok: true, recovered: 0, jobIds: [] };
    }

    writeJobsState({
      ...current,
      jobsById,
      jobOrder: reconciledOrder,
    });

    recoveredJobIds.forEach((jobId) => {
      notifyJobTerminalBestEffort(jobsById[jobId]);
    });

    recoveredJobIds.forEach((jobId) => {
      appendJobAuditBestEffort('job.interrupted', {
        jobId,
        phase: 'runtime_interrupted',
        reason: String(reason || 'runtime_interrupted'),
      });
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

      return (
        (status === 'completed' && phase === 'done') ||
        (status === 'cancelled' && phase === 'cancelled') ||
        (status === 'failed' && AUTHORIZED_RECOVERY_FAILED_TERMINAL_PHASES.has(phase))
      );
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
    isJobCancelled,
    listAuthorizedJobRecoveryCandidates,
    listJobs,
    markJobAwaitingUserInput,
    markJobCancelled,
    markJobCompleted,
    markJobFailed,
    markJobPausedForMemory,
    markJobPhase,
    markJobRetryPending,
    recoverInterruptedJobs,
    setJobCheckpoint,
  };
}

module.exports = {
  createJobStateStore,
};
