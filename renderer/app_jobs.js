(function () {
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
      buildJobContextForPersona = () => null,
      buildPersonaRequestContextHint = () => ({}),
      buildTerminalJobMessage = () => null,
      getRecentConversationMessagesForPersona = () => [],
      hidePersonaThinkingIndicator = () => {},
      shouldSuppressInterimAssistantPlanMessage = () => false,
      showPending = () => {},
      showPersonaThinkingIndicator = () => null,
      updateStatus = () => {},
    } = callbacks;

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
    
    
    async function maybeAutoRetryPendingJob(job) {
      if (!job || job.status !== 'retry_pending') return;
      const retryState = job.retryState || {};
      if (retryState.retryable === false) return;
    
      const nextRetryAtMs = retryState.nextRetryAt ? new Date(retryState.nextRetryAt).getTime() : 0;
      if (Number.isFinite(nextRetryAtMs) && nextRetryAtMs > Date.now()) return;
    
      if (!state.selectedProjectInfo || state.selectedProjectInfo.rootPath !== job.rootPath) return;
    
      const lastRun = Number(state.autoRetryLastRunByJob[job.id] || 0);
      if (Date.now() - lastRun < 2500) return;
    
      if (state.autoRetryInFlightByJob[job.id]) return;
    
      const request = job.request || {};
      const userMessage = String(request.userMessage || '').trim();
      const attachments = Array.isArray(request.attachments) ? request.attachments : [];
      if (!userMessage) return;
    
      state.autoRetryInFlightByJob[job.id] = true;
      state.autoRetryLastRunByJob[job.id] = Date.now();
      updateStatus('Retentativa automática da Persona...');
      showPersonaThinkingIndicator();
    
      try {
        const plan = await api.buildPlan({
          projectInfo: state.selectedProjectInfo,
          userMessage,
          attachments,
          jobId: job.id,
          contextHint: buildPersonaRequestContextHint({
            personaApprovedExecution: true,
            personaRouteDecision: {
              ok: true,
              decision: 'execute',
              response: '',
              executionMessage: userMessage,
              meta: { planner: 'persona_router', reason: 'retry_existing_job' },
            },
            lastJobContext: buildJobContextForPersona(job),
          }),
          conversationMessages: getRecentConversationMessagesForPersona(),
        });
    
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
          if (state.lastInterimPlanSignatureByJob[job.id] !== signature) {
            state.lastInterimPlanSignatureByJob[job.id] = signature;
            appendMessage('assistant', plan.response, { persistToConversation: false });
          }
        }
    
        if (plan && plan.jobId) {
          startJobPolling(plan.jobId);
        }
    
        if (plan && plan.automataContractSuggestion && automataContractsController) {
          automataContractsController.appendContractPreview(plan.automataContractSuggestion);
        }
    
        if (plan && plan.ok && plan.action) {
          showPending('Pronto para executar em uma área temporária. Só aplico no projeto se passar na validação real.', plan.action);
        }
      } catch {
        // silêncio para não poluir chat; o watchdog seguirá tentando.
      } finally {
        hidePersonaThinkingIndicator();
        state.autoRetryInFlightByJob[job.id] = false;
      }
    }
    
    
    async function pollJob(jobId) {
      if (!jobId) return null;
      try {
        const response = await api.getJob({ jobId });
        if (!response || !response.ok || !response.job) return null;
        renderJobProgress(response.job);
        state.lastJobContext = buildJobContextForPersona(response.job);
        await maybeAutoRetryPendingJob(response.job);
    
        if (['completed', 'failed', 'cancelled'].includes(response.job.status)) {
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
    
    function startJobPolling(jobId) {
      if (!jobId) return;
      state.activeJobId = jobId;
      stopJobPolling();
      renderJobProgress({
        id: jobId,
        status: 'running',
        phase: 'created',
        events: [],
        attemptsByPhase: {},
      });
      pollJob(jobId);
      state.jobPollingTimer = setInterval(() => {
        pollJob(jobId);
      }, 1200);
    }

    function jobMatchesRequest(job, request = {}) {
      if (!job || typeof job !== 'object') return false;
      const rootPath = String(request.rootPath || '').trim();
      const userMessage = String(request.userMessage || '').trim();
      const jobRootPath = String(job.rootPath || '').trim();
      const jobMessage = String(job.request && job.request.userMessage ? job.request.userMessage : '').trim();
      if (rootPath && jobRootPath && rootPath !== jobRootPath) return false;
      if (userMessage && jobMessage && userMessage !== jobMessage) return false;
      return true;
    }

    function watchLatestProjectJob(request = {}) {
      if (!api || typeof api.listJobs !== 'function') return () => {};
      const projectId = request.projectId || null;
      const startedAt = Date.now();
      let stopped = false;
      let timer = null;
      let interval = null;

      function stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        timer = null;
        interval = null;
      }

      async function tick() {
        if (stopped || state.activeJobId) return;
        if (Date.now() - startedAt > 15000) {
          stop();
          return;
        }
        try {
          const response = await api.listJobs({ projectId, limit: 6 });
          let jobs = response && response.ok && Array.isArray(response.jobs) ? response.jobs : [];
          if (!jobs.length && request.rootPath) {
            const fallbackResponse = await api.listJobs({ limit: 8 });
            jobs =
              fallbackResponse && fallbackResponse.ok && Array.isArray(fallbackResponse.jobs)
                ? fallbackResponse.jobs
                : [];
          }
          const activeJob = jobs.find((job) => {
            const status = String(job && job.status ? job.status : '').toLowerCase();
            return ['running', 'retry_pending'].includes(status) && jobMatchesRequest(job, request);
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
