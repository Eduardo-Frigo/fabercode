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
    isNonRetriableProviderReason,
    readJobsState,
    writeJobsState,
  } = dependencies;

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

  function mutateJobState(jobId, mutator) {
    const current = readJobsState();
    const previousJob = current.jobsById[jobId];
    if (!previousJob) return { ok: false, message: 'Job não encontrado.' };

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
    return { ok: true, job: nextJob };
  }

  function createAssistantJob({
    projectId = null,
    rootPath = null,
    userMessage = '',
    attachments = [],
    mode = 'default',
  }) {
    const current = readJobsState();
    const now = new Date().toISOString();
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      id,
      status: 'running',
      phase: 'created',
      createdAt: now,
      updatedAt: now,
      projectId,
      rootPath,
      mode,
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
          projectId,
          rootPath,
          userMessagePreview: String(userMessage || '').slice(0, 220),
          attachmentsCount: Array.isArray(attachments) ? attachments.length : 0,
        }),
      ],
    };

    const nextOrder = [id, ...current.jobOrder.filter((entry) => current.jobsById[entry])].slice(0, MAX_JOBS_STORED);
    const jobsById = {};
    for (const key of nextOrder) {
      if (current.jobsById[key]) jobsById[key] = current.jobsById[key];
    }
    jobsById[id] = job;

    writeJobsState({
      jobsById,
      jobOrder: nextOrder,
    });

    appendAuditEvent('job.created', { jobId: id, projectId, rootPath, mode });

    return { ok: true, job };
  }

  function appendJobEvent(jobId, type, payload = {}) {
    return mutateJobState(jobId, (job) => {
      job.events = [buildJobEvent(type, payload), ...(Array.isArray(job.events) ? job.events : [])].slice(0, MAX_JOB_EVENTS);
      return job;
    });
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
    });
    if (next.ok) {
      appendAuditEvent('job.phase_changed', { jobId, phase });
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
    });
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
    });

    if (next.ok) {
      const rs = next.job && next.job.retryState ? next.job.retryState : {};
      appendAuditEvent('job.retry_pending', {
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
    });
    if (next.ok) {
      appendAuditEvent('job.completed', { jobId });
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
    });
    if (next.ok) {
      appendAuditEvent('job.failed', { jobId, phase, reason: String(reason || '') });
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
    });
    if (next.ok) {
      appendAuditEvent('job.cancelled', { jobId, reason: String(reason || 'cancelled_by_user') });
    }
    return next;
  }

  function getJobById(jobId) {
    if (!jobId) return { ok: false, message: 'jobId é obrigatório.' };
    const current = readJobsState();
    const job = current.jobsById[jobId];
    if (!job) return { ok: false, message: 'Job não encontrado.' };
    return { ok: true, job };
  }

  function isJobCancelled(jobId) {
    if (!jobId) return false;
    const found = getJobById(jobId);
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
    });
  }

  function recoverInterruptedJobs(reason = 'runtime_restarted_before_job_completed') {
    const current = readJobsState();
    const interruptedStatuses = new Set(['running', 'retry_pending', 'paused_memory_pressure']);
    const nowIso = new Date().toISOString();
    const recoveredJobIds = [];
    const jobsById = { ...current.jobsById };

    for (const jobId of current.jobOrder || []) {
      const job = jobsById[jobId];
      if (!job || !interruptedStatuses.has(job.status)) continue;

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

    if (!recoveredJobIds.length) {
      return { ok: true, recovered: 0, jobIds: [] };
    }

    writeJobsState({
      ...current,
      jobsById,
    });

    recoveredJobIds.forEach((jobId) => {
      appendAuditEvent('job.interrupted', {
        jobId,
        phase: 'runtime_interrupted',
        reason: String(reason || 'runtime_interrupted'),
      });
    });

    return { ok: true, recovered: recoveredJobIds.length, jobIds: recoveredJobIds };
  }

  function listJobs({ projectId = null, limit = 30 } = {}) {
    const current = readJobsState();
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Number(limit))) : 30;
    const items = [];
    for (const id of current.jobOrder) {
      const job = current.jobsById[id];
      if (!job) continue;
      if (projectId && job.projectId !== projectId) continue;
      items.push(job);
      if (items.length >= safeLimit) break;
    }
    return { ok: true, jobs: items };
  }

  return {
    appendJobEvent,
    createAssistantJob,
    getJobById,
    isJobCancelled,
    listJobs,
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
