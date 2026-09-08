(function () {
  function uiText(key, fallback, variables = {}) {
    const translated = typeof window.t === 'function' ? window.t(key, fallback) : fallback;
    return String(translated || fallback || key).replace(/\{(\w+)\}/g, (_match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : `{${name}}`
    );
  }

  function createAppJobController({
    api = {},
    automataContractsController = null,
    callbacks = {},
    jobProgressController = null,
    state,
  } = {}) {
    if (!state) throw new Error('Renderer incompleto: estado de jobs ausente.');

    const {
      appendMessage = () => {},
      clearPending = () => {},
      buildJobContextForPersona = () => null,
      buildTerminalJobMessage = () => null,
      getActiveConversationId = () => null,
      getSubmissionEpoch = () => 0,
      hidePersonaThinkingIndicator = () => {},
      shouldSuppressInterimAssistantPlanMessage = () => false,
      showPending = () => {},
      showPersonaThinkingIndicator = () => null,
      updateStatus = () => {},
    } = callbacks;
    const staleJobCancellations = new Set();
    const terminalAppliedJobIds = new Set();
    const latestAppliedSnapshotByJobId = new Map();
    let pollRequestSequence = 0;

    function normalizeJobId(value) {
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    function jobSnapshotUpdatedAtMs(job) {
      const value = job && typeof job.updatedAt === 'string'
        ? Date.parse(job.updatedAt)
        : NaN;
      return Number.isFinite(value) ? value : null;
    }

    function acceptMonotonicJobSnapshot(jobId, job, requestSequence) {
      const normalizedJobId = normalizeJobId(jobId);
      if (!normalizedJobId) return false;
      const updatedAtMs = jobSnapshotUpdatedAtMs(job);
      const previous = latestAppliedSnapshotByJobId.get(normalizedJobId);
      if (previous) {
        if (updatedAtMs !== null && previous.updatedAtMs !== null) {
          if (updatedAtMs < previous.updatedAtMs) return false;
          if (updatedAtMs === previous.updatedAtMs
            && requestSequence < previous.requestSequence) return false;
        } else if (requestSequence < previous.requestSequence) {
          return false;
        }
      }
      latestAppliedSnapshotByJobId.set(normalizedJobId, { updatedAtMs, requestSequence });
      if (latestAppliedSnapshotByJobId.size > 256) {
        latestAppliedSnapshotByJobId.delete(latestAppliedSnapshotByJobId.keys().next().value);
      }
      return true;
    }

    function captureJobUiContext() {
      const projectId = state.selectedProjectId || null;
      return Object.freeze({
        projectId,
        rootPath: String(state.selectedProjectInfo && state.selectedProjectInfo.rootPath || '').trim(),
        conversationId: getActiveConversationId(projectId) || null,
        activeJobId: normalizeJobId(state.activeJobId),
      });
    }

    function jobUiContextIsCurrent(context) {
      if (!context) return false;
      const current = captureJobUiContext();
      return context.projectId === current.projectId
        && context.rootPath === current.rootPath
        && context.conversationId === current.conversationId
        && context.activeJobId === current.activeJobId;
    }

    function readSubmissionEpoch() {
      try {
        const value = getSubmissionEpoch();
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
      } catch {
        return null;
      }
    }

    function cancelStaleJobOnce(jobId) {
      const normalizedJobId = normalizeJobId(jobId);
      if (!normalizedJobId || !api || typeof api.cancelJob !== 'function') return false;
      if (staleJobCancellations.has(normalizedJobId)) return false;
      staleJobCancellations.add(normalizedJobId);
      if (staleJobCancellations.size > 256) {
        staleJobCancellations.delete(staleJobCancellations.values().next().value);
      }
      try {
        const cancellation = api.cancelJob({ jobId: normalizedJobId });
        if (cancellation && typeof cancellation.catch === 'function') cancellation.catch(() => {});
      } catch {}
      return true;
    }

    function discardStaleJob(jobId) {
      const normalizedJobId = normalizeJobId(jobId);
      if (normalizedJobId && terminalAppliedJobIds.has(normalizedJobId)) return false;
      return cancelStaleJobOnce(normalizedJobId);
    }

    function rememberAppliedTerminalJob(jobId) {
      const normalizedJobId = normalizeJobId(jobId);
      if (!normalizedJobId) return;
      terminalAppliedJobIds.add(normalizedJobId);
      if (terminalAppliedJobIds.size > 256) {
        terminalAppliedJobIds.delete(terminalAppliedJobIds.values().next().value);
      }
    }

    function stopJobPolling() {
      if (state.jobPollingTimer) {
        clearInterval(state.jobPollingTimer);
        state.jobPollingTimer = null;
      }
    }
    
    function hideJobProgress() {
      if (jobProgressController) jobProgressController.hide();
    }
    
    function renderJobProgress(job) {
      if (jobProgressController) jobProgressController.render(job);
    }

    function clearPendingIfJobAdvanced(job) {
      const responseJobId = normalizeJobId(job && job.id);
      const pendingJobId = normalizeJobId(state.pendingActionJobId);
      if (!responseJobId || responseJobId !== pendingJobId) return false;
      const status = String(job && job.status || '').toLowerCase();
      const phase = String(job && job.phase || '').toLowerCase();
      const terminal = ['completed', 'failed', 'blocked', 'cancelled'].includes(status);
      if (!terminal && phase === 'awaiting_user_confirmation') return false;
      state.pendingAction = null;
      state.pendingActionJobId = null;
      try {
        clearPending();
      } catch {}
      return true;
    }
    
    
    async function maybeAutoRetryPendingJob(job, expectedContext = captureJobUiContext()) {
      if (!job || job.status !== 'retry_pending') return;
      const jobId = typeof job.id === 'string' && job.id.trim() ? job.id.trim() : null;
      if (!jobId || !api || typeof api.retryJob !== 'function') return;
      const retryState = job.retryState || {};
      if (retryState.retryable === false) return;
    
      const nextRetryAtMs = retryState.nextRetryAt ? new Date(retryState.nextRetryAt).getTime() : 0;
      if (Number.isFinite(nextRetryAtMs) && nextRetryAtMs > Date.now()) return;
    
      if (!state.selectedProjectInfo || state.selectedProjectInfo.rootPath !== job.rootPath) return;
    
      const lastRun = Number(state.autoRetryLastRunByJob[jobId] || 0);
      if (Date.now() - lastRun < 2500) return;
    
      if (state.autoRetryInFlightByJob[jobId]) return;
    
      state.autoRetryInFlightByJob[jobId] = true;
      state.autoRetryLastRunByJob[jobId] = Date.now();
      updateStatus(uiText('personaAutomaticRetry', 'Retentativa automática da Persona...'));
      showPersonaThinkingIndicator();
    
      try {
        const plan = await api.retryJob({ jobId });
        if (!jobUiContextIsCurrent(expectedContext)) {
          discardStaleJob(jobId);
          if (plan && plan.jobId && normalizeJobId(plan.jobId) !== jobId) {
            cancelStaleJobOnce(plan.jobId);
          }
          return;
        }
        const planJobId = normalizeJobId(plan && plan.jobId);
        if (planJobId !== jobId) {
          if (planJobId) cancelStaleJobOnce(planJobId);
          return;
        }
    
        if (plan && plan.meta) {
          state.lastAssistantMeta = { ...plan.meta, lastHadAction: Boolean(plan.action) };
        }
    
        const planReason = String((plan && plan.meta && plan.meta.reason) || '');
        const shouldPublishInterim =
          Boolean(plan && plan.response && !plan.action) &&
          !shouldSuppressInterimAssistantPlanMessage(plan) &&
          !/(ai_error|rwkv_error|openai_error|gemini_error|sambanova_error)/i.test(planReason);
    
        if (shouldPublishInterim) {
          const signature = `${planReason}|${String(plan.response).trim()}`;
          if (state.lastInterimPlanSignatureByJob[jobId] !== signature) {
            state.lastInterimPlanSignatureByJob[jobId] = signature;
            appendMessage('assistant', plan.response, { persistToConversation: false });
          }
        }
    
        startJobPolling(planJobId);
    
        if (plan && plan.automataContractSuggestion && automataContractsController) {
          automataContractsController.appendContractPreview(plan.automataContractSuggestion);
        }
    
        if (plan && plan.ok && plan.action && planJobId === jobId) {
          state.pendingActionJobId = planJobId;
          showPending(
            uiText(
              'confirmGovernedExecution',
              'Confirme para iniciar a execução governada.'
            ),
            plan.action
          );
        }
      } catch {
        // silêncio para não poluir chat; o watchdog seguirá tentando.
      } finally {
        if (jobUiContextIsCurrent(expectedContext) || state.activeJobId === jobId) {
          hidePersonaThinkingIndicator();
        }
        state.autoRetryInFlightByJob[jobId] = false;
      }
    }
    
    
    async function pollJob(jobId, expectedContext = captureJobUiContext()) {
      if (!jobId) return null;
      const requestSequence = ++pollRequestSequence;
      try {
        const response = await api.getJob({ jobId });
        if (!jobUiContextIsCurrent(expectedContext)) {
          discardStaleJob(jobId);
          return null;
        }
        if (!response || !response.ok || !response.job) return null;
        const responseJobId = normalizeJobId(response.job.id);
        const responseProjectId = response.job.projectId == null ? null : String(response.job.projectId).trim();
        const responseRootPath = response.job.rootPath == null ? '' : String(response.job.rootPath).trim();
        if (responseJobId !== normalizeJobId(jobId)
          || (expectedContext.projectId && responseProjectId !== expectedContext.projectId)
          || (expectedContext.rootPath && responseRootPath !== expectedContext.rootPath)) {
          if (responseJobId && responseJobId !== normalizeJobId(jobId)) cancelStaleJobOnce(responseJobId);
          return null;
        }
        if (!acceptMonotonicJobSnapshot(responseJobId, response.job, requestSequence)) return null;
        renderJobProgress(response.job);
        clearPendingIfJobAdvanced(response.job);
        state.lastJobContext = buildJobContextForPersona(response.job);
        await maybeAutoRetryPendingJob(response.job, expectedContext);
        if (!jobUiContextIsCurrent(expectedContext)) return null;
    
        if (['completed', 'failed', 'blocked', 'cancelled'].includes(response.job.status)) {
          rememberAppliedTerminalJob(responseJobId);
          const alreadyNotified = Boolean(state.jobTerminalNoticeById[jobId]);
          if (!alreadyNotified) {
            const terminalMessage = buildTerminalJobMessage(response.job);
            if (terminalMessage) {
              appendMessage('assistant', terminalMessage, { persistToConversation: false });
            }
            state.jobTerminalNoticeById[jobId] = true;
          }
    
          stopJobPolling();
          if (state.activeJobId === jobId) state.activeJobId = null;
        }
        return response.job;
      } catch {
        return null;
      }
    }
    
    function startJobPolling(jobId, initialJob = null) {
      const normalizedJobId = normalizeJobId(jobId);
      if (!normalizedJobId) return;
      stopJobPolling();
      state.activeJobId = normalizedJobId;
      const expectedContext = captureJobUiContext();
      const initialJobMatches = initialJob
        && typeof initialJob === 'object'
        && normalizeJobId(initialJob.id) === normalizedJobId;
      if (initialJobMatches) {
        const initialSequence = ++pollRequestSequence;
        if (acceptMonotonicJobSnapshot(normalizedJobId, initialJob, initialSequence)) {
          renderJobProgress(initialJob);
          clearPendingIfJobAdvanced(initialJob);
          state.lastJobContext = buildJobContextForPersona(initialJob);
        }
      } else {
        renderJobProgress({
          id: normalizedJobId,
          status: 'running',
          phase: 'created',
          events: [],
          attemptsByPhase: {},
        });
      }
      pollJob(normalizedJobId, expectedContext);
      state.jobPollingTimer = setInterval(() => {
        pollJob(normalizedJobId, expectedContext);
      }, 1200);
    }

    function jobMatchesRequest(job, request = {}) {
      if (!job || typeof job !== 'object') return false;
      const rootPath = String(request.rootPath || '').trim();
      const userMessage = String(request.userMessage || '').trim();
      const jobRootPath = String(job.rootPath || '').trim();
      const jobMessage = String(job.request && job.request.userMessage ? job.request.userMessage : '').trim();
      if (rootPath && rootPath !== jobRootPath) return false;
      if (userMessage && userMessage !== jobMessage) return false;
      return true;
    }

    function watchLatestProjectJob(request = {}) {
      if (!api || typeof api.listJobs !== 'function') return () => {};
      const expectedContext = captureJobUiContext();
      const expectedSubmissionEpoch = readSubmissionEpoch();
      if (expectedSubmissionEpoch === null) return () => {};
      const normalizedRequest = Object.freeze({
        projectId: request.projectId || null,
        rootPath: String(request.rootPath || '').trim(),
        userMessage: String(request.userMessage || '').trim(),
      });
      const projectId = normalizedRequest.projectId;
      const startedAt = Date.now();
      let stopped = false;
      let timer = null;
      let interval = null;

      function watcherContextIsCurrent() {
        return readSubmissionEpoch() === expectedSubmissionEpoch
          && jobUiContextIsCurrent(expectedContext);
      }

      function stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        timer = null;
        interval = null;
      }

      async function tick() {
        if (stopped || state.activeJobId) return;
        if (!watcherContextIsCurrent()) {
          stop();
          return;
        }
        if (Date.now() - startedAt > 15000) {
          stop();
          return;
        }
        try {
          const response = await api.listJobs({ projectId, limit: 6 });
          if (stopped) return;
          if (!watcherContextIsCurrent()) {
            const staleJobs = response && response.ok && Array.isArray(response.jobs) ? response.jobs : [];
            staleJobs
              .filter((job) => {
                const status = String(job && job.status ? job.status : '').toLowerCase();
                return ['running', 'retry_pending'].includes(status)
                  && (!projectId || job.projectId === projectId)
                  && jobMatchesRequest(job, normalizedRequest);
              })
              .forEach((job) => cancelStaleJobOnce(job.id));
            stop();
            return;
          }
          let jobs = response && response.ok && Array.isArray(response.jobs) ? response.jobs : [];
          if (!jobs.length && normalizedRequest.rootPath) {
            const fallbackResponse = await api.listJobs({ limit: 8 });
            if (stopped) return;
            if (!watcherContextIsCurrent()) {
              const staleJobs = fallbackResponse && fallbackResponse.ok && Array.isArray(fallbackResponse.jobs)
                ? fallbackResponse.jobs
                : [];
              staleJobs
                .filter((job) => {
                  const status = String(job && job.status ? job.status : '').toLowerCase();
                  return ['running', 'retry_pending'].includes(status)
                    && (!projectId || job.projectId === projectId)
                    && jobMatchesRequest(job, normalizedRequest);
                })
                .forEach((job) => cancelStaleJobOnce(job.id));
              stop();
              return;
            }
            jobs =
              fallbackResponse && fallbackResponse.ok && Array.isArray(fallbackResponse.jobs)
                ? fallbackResponse.jobs
                : [];
          }
          const activeJob = jobs.find((job) => {
            const status = String(job && job.status ? job.status : '').toLowerCase();
            return ['running', 'retry_pending'].includes(status)
              && (!projectId || job.projectId === projectId)
              && jobMatchesRequest(job, normalizedRequest);
          });
          if (activeJob && activeJob.id) {
            startJobPolling(activeJob.id);
            stop();
          }
        } catch {
          // O envio principal continua; esta adoção é apenas uma melhoria de visibilidade.
        }
      }

      timer = setTimeout(tick, 450);
      interval = setInterval(tick, 1200);
      return stop;
    }

    return {
      hideJobProgress,
      maybeAutoRetryPendingJob,
      pollJob,
      renderJobProgress,
      startJobPolling,
      stopJobPolling,
      watchLatestProjectJob,
    };
  }

  window.FaberAppJobs = {
    createAppJobController,
  };
})();
