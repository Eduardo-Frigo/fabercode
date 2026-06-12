(function () {
  function createAppActionsController({
    api = {},
    automataContractsController = null,
    callbacks = {},
    controllers = {},
    elements = {},
    formatters = {},
    state,
    t = (_key, fallback = '') => fallback,
  } = {}) {
    if (!state) throw new Error('Renderer incompleto: estado de ações ausente.');

    const { inputEl } = elements;
    const {
      accountGateController = null,
      aiSettingsController = null,
      cortexController = null,
      projectFileTreeController = null,
      projectToolsController = null,
    } = controllers;
    const {
      appendChangeCard = () => {},
      appendMessage = () => {},
      buildPersonaRequestContextHint = () => ({}),
      clearPending = () => {},
      clearTransientChatNotices = () => {},
      ensureActiveConversationForSend = async () => null,
      ensureSelectedProjectInfoReady = async () => false,
      getRecentConversationMessagesForPersona = () => [],
      hideJobProgress = () => {},
      hidePersonaThinkingIndicator = () => {},
      openWelcomeProjectModal = () => {},
      pollJob = async () => null,
      prepareNewConversationForProject = async () => {},
      renderAttachments = () => {},
      renderCortexLearning = () => {},
      renderCortexRuntimeStatus = () => {},
      renderJobProgress = () => {},
      renderNextSteps = () => {},
      renderProjects = () => {},
      resetTextareaHeight = () => {},
      selectProject = async () => {},
      showChangeSummary = () => {},
      showModificationAlert = () => {},
      showPending = () => {},
      showPersonaThinkingIndicator = () => null,
      startJobPolling = () => {},
      stopJobPolling = () => {},
      updateStatus = () => {},
      watchLatestProjectJob = () => () => {},
      normalizeProjectItems = () => [],
    } = callbacks;
    const {
      buildExecutionOutcomeAssistantMessage = () => '',
      isManualRetryMessage = () => false,
      shouldSuppressInterimAssistantPlanMessage = () => false,
    } = formatters;

    async function applyComposerProviderBeforeSend() {
      if (aiSettingsController) await aiSettingsController.applyComposerProviderBeforeSend();
    }
    
    async function ensureAccountUnlockedForProductUse() {
      if (!accountGateController) return true;
      const unlocked = await accountGateController.ensureUnlocked();
      if (!unlocked) {
        updateStatus('Login obrigatório para usar o Faber Code.');
      }
      return unlocked;
    }

    function normalizeActionRootPath(value = '') {
      return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
    }

    function resolvePendingActionRootPath(action = null) {
      if (!action || typeof action !== 'object') return '';
      const command = action.executionCommand && typeof action.executionCommand === 'object'
        ? action.executionCommand
        : {};
      return normalizeActionRootPath(
        action.rootPath ||
          action.root_path ||
          action.projectRootPath ||
          command.root_path ||
          command.rootPath ||
          ''
      );
    }

    function pendingActionMatchesSelectedProject(action = null, projectInfo = null) {
      const actionRoot = resolvePendingActionRootPath(action);
      const projectRoot = normalizeActionRootPath(projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '');
      if (!actionRoot || !projectRoot) return true;
      return actionRoot === projectRoot;
    }

    async function executePendingAction() {
      if (!state.pendingAction || !state.selectedProjectInfo) return;

      updateStatus('Estou trabalhando no projeto.');
      const pendingJobId =
        (state.pendingAction && state.pendingAction.jobId ? state.pendingAction.jobId : null) ||
        state.activeJobId ||
        null;
      if (pendingJobId) {
        state.activeJobId = pendingJobId;
        renderJobProgress({
          id: pendingJobId,
          status: 'running',
          phase: 'execute_pending',
          progress: { pct: 76 },
          events: [],
          attemptsByPhase: {},
        });
      }

      const selectedProjectReady = await ensureSelectedProjectInfoReady({ forceRefresh: true });
      if (!selectedProjectReady || !state.selectedProjectInfo) {
        appendMessage('assistant', 'Não consegui atualizar o contexto desse projeto no disco antes de executar.');
        updateStatus('Projeto indisponível para execução');
        return;
      }
      if (!pendingActionMatchesSelectedProject(state.pendingAction, state.selectedProjectInfo)) {
        appendMessage(
          'assistant',
          'Descartei a confirmação pendente porque ela pertencia a outro projeto. Gere a ação novamente no projeto selecionado antes de executar.',
          { persistToConversation: false }
        );
        stopJobPolling();
        state.activeJobId = null;
        clearPending();
        hideJobProgress();
        updateStatus('Confirmação antiga descartada');
        return;
      }

      const result = await api.executePlan(state.pendingAction, state.selectedProjectInfo);
      if (state.activeJobId) {
        pollJob(state.activeJobId);
      }
      if (!result.ok) {
        if (result && result.projectInfo && result.projectInfo.rootPath) {
          state.selectedProjectInfo = result.projectInfo;
        }
        state.lastQualityReport = result && result.qualityReport ? result.qualityReport : state.lastQualityReport;
        if (projectFileTreeController) await projectFileTreeController.refresh();
        const finalMessage = buildExecutionOutcomeAssistantMessage(result, state.pendingAction, state.lastQualityReport);
        appendMessage('assistant', finalMessage || result.message || 'Falha ao executar ação.');
        if (result && result.blockedByPostExecutionValidation) {
          updateStatus('Validação técnica bloqueou conclusão; correção incremental necessária');
        } else {
          updateStatus('Falha na execução');
        }
        clearPending();
        return;
      }

      if (result && result.projectInfo && result.projectInfo.rootPath) {
        state.selectedProjectInfo = result.projectInfo;
      }
      state.nextSteps = result.nextSteps || state.nextSteps;
      state.lastQualityReport = result && result.qualityReport ? result.qualityReport : null;
      renderNextSteps();
      if (projectFileTreeController) await projectFileTreeController.refresh();

      const finalMessage = buildExecutionOutcomeAssistantMessage(result, state.pendingAction, state.lastQualityReport);

      if (Array.isArray(result.modifiedFiles) && result.modifiedFiles.length) {
        appendMessage('assistant', finalMessage || result.message || 'Concluído.');
        appendChangeCard(state.pendingAction, result);
        showChangeSummary(state.pendingAction, result);
        showModificationAlert(`Arquivo modificado: ${result.modifiedFiles.join(', ')}`);
        updateStatus('Alteração aplicada com sucesso');
      } else {
        appendMessage('assistant', finalMessage || result.message || 'Concluído.');
        updateStatus('Ação concluída');
      }
      clearPending();
    }
    
    async function onSend() {
      const userMessage = inputEl.value.trim();
      if (!userMessage && !state.attachments.length) return;
      if (!(await ensureAccountUnlockedForProductUse())) return;
      await applyComposerProviderBeforeSend();
    
      const attachmentSummary = state.attachments.map((file) => file.name);
      const visibleUserMessage = userMessage || '[Somente anexos]';
      const composedUserMessage = attachmentSummary.length
        ? `${visibleUserMessage}\n\nAnexos: ${attachmentSummary.join(', ')}`
        : visibleUserMessage;
      const attachmentsPayload = state.attachments.map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        path: file.path || '',
      }));
    
      const retryTechnicalMessage =
        isManualRetryMessage(visibleUserMessage) &&
        state.lastJobContext &&
        state.lastJobContext.lastError &&
        state.lastJobContext.lastUserMessage
          ? String(state.lastJobContext.lastUserMessage).trim()
          : '';
      const effectivePersonaMessage = retryTechnicalMessage || visibleUserMessage;
      const personaContextExtra = retryTechnicalMessage
        ? {
            manualRetryRequest: visibleUserMessage,
            retryingLastFailedJob: true,
            retryTechnicalUserMessage: retryTechnicalMessage,
          }
        : {};
    
      if (!state.selectedProjectId) {
        openWelcomeProjectModal();
        return;
      }
      const selectedProjectReady = await ensureSelectedProjectInfoReady({ forceRefresh: true });
      if (!selectedProjectReady || !state.selectedProjectInfo) {
        appendMessage('assistant', 'Não consegui atualizar o contexto desse projeto no disco antes de enviar.', { persistToConversation: false });
        return;
      }
    
      await ensureActiveConversationForSend(visibleUserMessage);
      clearTransientChatNotices();
      appendMessage('user', composedUserMessage);
      inputEl.value = '';
      resetTextareaHeight();
    
      if (state.uiMode === 'cortex') {
        const cortexLearningPayload = {
          projectId: state.selectedProjectId,
          projectInfo: state.selectedProjectInfo,
          userMessage: effectivePersonaMessage,
          attachments: attachmentsPayload,
          contextHint: buildPersonaRequestContextHint(personaContextExtra),
          conversationMessages: getRecentConversationMessagesForPersona(),
        };
        const learningResult = cortexController
          ? await cortexController.learnFromComposer(cortexLearningPayload)
          : await api.learnWithCortex(cortexLearningPayload);
    
        state.attachments = [];
        renderAttachments();
    
        if (learningResult && learningResult.ok) {
          if (!cortexController) {
            state.cortexLearningByProject[state.selectedProjectId] = learningResult.learning;
            if (learningResult.knowledgeStatus) {
              state.knowledgeRuntimeStatusByProject[state.selectedProjectId] = learningResult.knowledgeStatus;
            }
            renderCortexLearning(learningResult.learning);
            renderCortexRuntimeStatus(state.knowledgeRuntimeStatusByProject[state.selectedProjectId] || null);
          }
          appendMessage('assistant', learningResult.message);
          updateStatus(t('memoryUpdated'));
        } else {
          appendMessage('assistant', learningResult?.message || 'Não consegui registrar essa memória do projeto.');
          updateStatus('Falha ao salvar memória');
        }
        return;
      }
    
      updateStatus('Conversando com o modelo.');
      showPersonaThinkingIndicator();
      const stopLatestJobWatch = watchLatestProjectJob({
        projectId: state.selectedProjectId,
        rootPath: state.selectedProjectInfo ? state.selectedProjectInfo.rootPath : '',
        userMessage: effectivePersonaMessage,
      });
    
      if (!api || !api.sendAssistantMessage) {
        stopLatestJobWatch();
        hidePersonaThinkingIndicator();
        state.attachments = [];
        renderAttachments();
        appendMessage(
          'assistant',
          'Não iniciei execução. O fluxo de assistente não está disponível nesta versão, então não posso decidir e planejar com segurança.',
          { persistToConversation: true }
        );
        updateStatus('Assistente indisponível.');
        return;
      }
    
      let plan = null;
      try {
        plan = await api.sendAssistantMessage({
          projectInfo: state.selectedProjectInfo,
          userMessage: effectivePersonaMessage,
          attachments: attachmentsPayload,
          contextHint: buildPersonaRequestContextHint(personaContextExtra),
          conversationMessages: getRecentConversationMessagesForPersona(),
        });
      } catch (error) {
        stopLatestJobWatch();
        hidePersonaThinkingIndicator();
        state.attachments = [];
        renderAttachments();
        appendMessage(
          'assistant',
          `A IA não conseguiu responder pelo provedor selecionado. Detalhe: ${
            error && error.message ? error.message : String(error || '')
          }`,
          { persistToConversation: true }
        );
        updateStatus('IA desconectada ou indisponível.');
        return;
      }
    
      hidePersonaThinkingIndicator();
      stopLatestJobWatch();
    
      state.attachments = [];
      renderAttachments();
    
      const suppressInterim = shouldSuppressInterimAssistantPlanMessage(plan);
      if (!suppressInterim && plan && plan.response) {
        appendMessage('assistant', plan.response);
      }
      if (plan && plan.automataContractSuggestion && automataContractsController) {
        automataContractsController.appendContractPreview(plan.automataContractSuggestion);
      }
      if (plan && plan.ok && plan.action) {
        if (plan.action.targetFile) {
          updateStatus(`Encontrei a raiz do problema em ${plan.action.targetFile}.`);
        } else {
          updateStatus('Planejamento concluído. Pronto para corrigir.');
        }
      } else if (plan && !plan.action) {
        const reason = String((plan && plan.meta && plan.meta.reason) || '');
        if (reason === 'cortex_briefing_clarification_needed') {
          updateStatus('Aguardando suas respostas para fechar o briefing.');
        } else if (reason === 'persona_clarification_needed') {
          updateStatus('Aguardando sua resposta.');
        } else if (plan && plan.meta && plan.meta.providerError) {
          updateStatus('IA desconectada ou indisponível.');
        } else if (reason === 'conversation_only') {
          updateStatus('Resposta enviada.');
        } else if (reason === 'edit_needs_target') {
          updateStatus('Preciso de um alvo mais claro antes de editar.');
        } else if (reason === 'automata_contract_suggestion_ready') {
          updateStatus('Contrato temporário pronto para revisão.');
        } else {
          updateStatus('Nenhuma alteração foi preparada nesta rodada.');
        }
      }
      state.lastAssistantMeta = plan && plan.meta ? { ...plan.meta, lastHadAction: Boolean(plan.action) } : null;
      if (plan && plan.jobId) {
        startJobPolling(plan.jobId);
      }
    
      if (plan && plan.ok && plan.action) {
        if (plan.meta && plan.meta.autoExecute) {
          state.pendingAction = plan.action;
          await executePendingAction();
          return;
        }
        showPending(
          `Pronto para executar em uma área temporária. Só aplico no projeto se passar na validação real.`,
          plan.action
        );
      } else {
        clearPending();
      }
    }
    
    async function onConfirm() {
      await executePendingAction();
    }
    
    async function onCancel() {
      const jobId =
        (state.pendingAction && state.pendingAction.jobId ? state.pendingAction.jobId : null) ||
        state.activeJobId ||
        null;
      let cancelledJob = null;
    
      if (jobId && api.cancelJob) {
        try {
          const cancelResult = await api.cancelJob({ jobId });
          if (cancelResult && cancelResult.ok && cancelResult.job) {
            cancelledJob = cancelResult.job;
          }
        } catch {
          // O cancelamento local ainda deve limpar a tela mesmo se o registro do job falhar.
        }
      }
    
      appendMessage('assistant', 'Ação cancelada. Nenhum arquivo foi alterado.');
      api
        .appendAuditEvent('assistant.execute_cancelled', {
          rootPath: state.selectedProjectInfo ? state.selectedProjectInfo.rootPath : null,
          targetFile: state.pendingAction ? state.pendingAction.targetFile : null,
          jobId,
        })
        .catch(() => {});
      stopJobPolling();
      if (cancelledJob) {
        renderJobProgress(cancelledJob);
      } else {
        hideJobProgress();
      }
      state.activeJobId = null;
      clearPending();
    }
    
    async function onNewConversation() {
      if (!state.selectedProjectId) {
        openWelcomeProjectModal();
        return;
      }
    
      await prepareNewConversationForProject(state.selectedProjectId);
      renderProjects();
    }
    
    async function onAddProject() {
      const result = await api.addProject();
      if (!result.ok) return;
    
      state.projects = normalizeProjectItems(result.projects);
      renderProjects();
    
      if (state.projects.length) {
        const latest = state.projects[state.projects.length - 1];
        await selectProject(latest.id);
      }
    }
    
    async function onProjectGitClick() {
      if (projectToolsController) await projectToolsController.publishToGithub();
    }
    
    async function onProjectPreviewClick() {
      if (projectToolsController) await projectToolsController.startPreview();
    }

    return {
      applyComposerProviderBeforeSend,
      ensureAccountUnlockedForProductUse,
      onAddProject,
      onCancel,
      onConfirm,
      onNewConversation,
      onProjectGitClick,
      onProjectPreviewClick,
      onSend,
    };
  }

  window.FaberAppActions = {
    createAppActionsController,
  };
})();
