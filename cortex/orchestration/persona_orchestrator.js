const {
  buildProviderFailureReason,
  normalizeProviderFailure,
} = require('../providers/provider_failure_service');

function normalizePersonaMessageText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasExplicitAutomataContractIntent(userMessage = '') {
  const normalized = normalizePersonaMessageText(userMessage);
  if (!normalized) return false;
  return (
    /\b(automata contract|contract ledger|ledger de contratos|contrato automata|contrato automatico|contrato de automacao)\b/.test(normalized) ||
    /\bcontrato\s+(local|temporario|temporario|do faber|para o faber|reutilizavel|fixo)\b/.test(normalized) ||
    /\b(crie|criar|gere|gerar|salve|salvar|promova|promover)\s+(uma\s+)?(regra|contrato)\s+local\b/.test(normalized) ||
    /\b(tornar|transformar|virar)\s+(isso|esse|esta|essa|este)\s+.*\b(comportamento|regra)\s+fix[oa]\b/.test(normalized)
  );
}

function shouldPreferCortexRuntimeForRoute(routeDecision) {
  const productRoute = routeDecision && routeDecision.productRoute ? routeDecision.productRoute : {};
  return (
    productRoute.capability === 'create_project' ||
    productRoute.executionIntent === 'init_project'
  );
}

function createPersonaOrchestrator(dependencies = {}) {
  const {
    appendAuditEvent,
    appendJobEvent,
    appendMemoryEvidence = null,
    buildAgenticExecutionPlan = null,
    buildAiProviderFailureMessage,
    buildConversationOnlyPlan,
    buildPlanWithCortexRuntime,
    clipText,
    createAssistantJob,
    getSelectedAiProvider,
    isAiRetryableReason,
    markJobCompleted,
    markJobFailed,
    markJobPausedForMemory,
    markJobPhase,
    markJobRetryPending,
    requestDirectPersonaChat = null,
    requestPersonaRouteDecision,
    resolveActiveMemoryContext = null,
    resolveProductRoute,
    runtimeVersion,
    setJobCheckpoint,
    summarizeActiveMemory = () => null,
    suggestAutomataContract,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Persona orchestrator dependency missing: ${name}`);
  }

  function assertReady() {
    requireDependency('appendAuditEvent', appendAuditEvent);
    requireDependency('appendJobEvent', appendJobEvent);
    requireDependency('buildAiProviderFailureMessage', buildAiProviderFailureMessage);
    requireDependency('buildConversationOnlyPlan', buildConversationOnlyPlan);
    requireDependency('buildPlanWithCortexRuntime', buildPlanWithCortexRuntime);
    requireDependency('clipText', clipText);
    requireDependency('createAssistantJob', createAssistantJob);
    requireDependency('getSelectedAiProvider', getSelectedAiProvider);
    requireDependency('isAiRetryableReason', isAiRetryableReason);
    requireDependency('markJobCompleted', markJobCompleted);
    requireDependency('markJobFailed', markJobFailed);
    requireDependency('markJobPausedForMemory', markJobPausedForMemory);
    requireDependency('markJobPhase', markJobPhase);
    requireDependency('markJobRetryPending', markJobRetryPending);
    requireDependency('requestPersonaRouteDecision', requestPersonaRouteDecision);
    requireDependency('resolveProductRoute', resolveProductRoute);
    requireDependency('setJobCheckpoint', setJobCheckpoint);
  }

  function appendAssistantRouteAudit(route, projectInfo) {
    assertReady();
    appendAuditEvent('assistant.route_decided', {
      ok: route ? route.ok : false,
      decision: route ? route.decision : null,
      provider: (route && (route.provider || (route.meta && route.meta.provider))) || getSelectedAiProvider(),
      reason: route && route.meta ? route.meta.reason : null,
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
    });
  }

  async function resolveRequestActiveMemory(payload = {}, stage = 'route') {
    const contextHint = payload && payload.contextHint && typeof payload.contextHint === 'object'
      ? payload.contextHint
      : null;
    if (
      contextHint &&
      contextHint.activeMemory &&
      contextHint.activeMemory.schemaVersion === 'active-memory-v1'
    ) {
      return contextHint.activeMemory;
    }
    if (typeof resolveActiveMemoryContext !== 'function') return null;
    try {
      return await resolveActiveMemoryContext({
        projectInfo: payload.projectInfo || null,
        userMessage: payload.userMessage || '',
        attachments: payload.attachments || [],
        contextHint,
        conversationMessages: payload.conversationMessages || [],
        userId: payload.userId || (payload.account && payload.account.id) || '',
        conversationId: payload.conversationId || (contextHint && contextHint.conversationId) || '',
        jobId: payload.jobId || (contextHint && contextHint.jobId) || '',
        stage,
      });
    } catch (error) {
      appendAuditEvent('cortex.active_memory_failed', {
        stage,
        rootPath: payload.projectInfo && payload.projectInfo.rootPath ? payload.projectInfo.rootPath : null,
        message: clipText(error && error.message ? error.message : String(error || ''), 500),
      });
      return null;
    }
  }

  function enrichContextHintWithActiveMemory(contextHint = null, activeMemory = null) {
    if (!activeMemory) return contextHint || null;
    return {
      ...(contextHint || {}),
      activeMemory,
    };
  }

  function normalizeExecuteRouteFromContext(routeFromContext, fallbackUserMessage = '') {
    if (!routeFromContext || String(routeFromContext.decision || '').toLowerCase() !== 'execute') {
      return null;
    }

    return {
      ok: true,
      decision: 'execute',
      response: routeFromContext.response || '',
      executionMessage: routeFromContext.executionMessage || fallbackUserMessage || '',
      confidence: routeFromContext.confidence,
      provider: routeFromContext.provider,
      productRoute: routeFromContext.productRoute || null,
      buildModeRoute: routeFromContext.buildModeRoute || null,
      workingBrief: routeFromContext.workingBrief || null,
      aiRoute: routeFromContext.aiRoute || null,
      meta: routeFromContext.meta || { planner: 'persona_router', reason: 'persona_selected_execution' },
    };
  }

  function shouldDelegateProductRoute(routeDecision) {
    return Boolean(
      routeDecision &&
        (routeDecision.delegateToPersona ||
          routeDecision.requiresPersona ||
          (routeDecision.meta && routeDecision.meta.requiresPersona))
    );
  }

  function readRouteContextFrameEvidence(routeDecision = null) {
    const meta = routeDecision && routeDecision.meta && typeof routeDecision.meta === 'object'
      ? routeDecision.meta
      : {};
    return meta.contextFrame && typeof meta.contextFrame === 'object' ? meta.contextFrame : null;
  }

  function attachDelegatedProductContextFrame(routeDecision = null, productRoute = null) {
    const contextFrame = readRouteContextFrameEvidence(productRoute);
    if (!routeDecision || typeof routeDecision !== 'object' || !contextFrame) return routeDecision;
    return {
      ...routeDecision,
      meta: {
        ...(routeDecision.meta || {}),
        contextFrame,
        productRouteReason: productRoute && productRoute.meta ? productRoute.meta.reason || '' : '',
      },
    };
  }

  function persistJobContextFrameEvidence(jobId = '', routeDecision = null, projectInfo = null) {
    const contextFrame = readRouteContextFrameEvidence(routeDecision);
    if (!jobId || !contextFrame) return;
    setJobCheckpoint(jobId, 'route_context_frame', contextFrame);
    appendJobEvent(jobId, 'job.context_frame', {
      dominantSource: contextFrame.dominantSource || 'unknown',
      allowedSources: Array.isArray(contextFrame.allowedSources) ? contextFrame.allowedSources : [],
      blockedSources: Array.isArray(contextFrame.blockedSources) ? contextFrame.blockedSources : [],
      activeMemoryAllowed: Boolean(
        contextFrame.activeMemory &&
          (contextFrame.activeMemory.allowedForBriefing || contextFrame.activeMemory.allowedForRouting)
      ),
      activeMemorySuppressed: Boolean(contextFrame.activeMemory && contextFrame.activeMemory.suppressed),
      guardOk: !(contextFrame.guard && contextFrame.guard.ok === false),
      guardReason: contextFrame.guard && contextFrame.guard.reason ? contextFrame.guard.reason : '',
    });
    if (typeof appendMemoryEvidence === 'function') {
      appendMemoryEvidence({
        action: 'context_frame_decision',
        ok: !(contextFrame.guard && contextFrame.guard.ok === false),
        status: contextFrame.guard && contextFrame.guard.blocking ? 'blocked' : 'succeeded',
        projectInfo,
        projectSession:
          routeDecision && routeDecision.projectSession
            ? routeDecision.projectSession
            : null,
        jobId,
        contextFrame,
        provenance:
          contextFrame.activeMemory && contextFrame.activeMemory.provenance
            ? contextFrame.activeMemory.provenance
            : null,
        message: contextFrame.guard && contextFrame.guard.blocking
          ? 'Context frame exige confirmação antes de usar memória.'
          : 'Context frame registrado para o job.',
      });
    }
  }

  async function resolveAssistantRouteDecision(payload = {}) {
    assertReady();
    const { projectInfo, userMessage, attachments, contextHint, conversationMessages } = payload || {};
    const activeMemory = await resolveRequestActiveMemory(payload, 'route');
    const enrichedContextHint = enrichContextHintWithActiveMemory(contextHint, activeMemory);
    let productRoute = null;
    try {
      productRoute = await resolveProductRoute({
        projectInfo: projectInfo || null,
        userMessage: userMessage || '',
        attachments: attachments || [],
        contextHint: enrichedContextHint,
        conversationMessages: conversationMessages || [],
        activeMemory,
      });
    } catch (error) {
      appendAuditEvent('assistant.product_route_failed', {
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
        message: clipText(error && error.message ? error.message : String(error || ''), 500),
      });
    }

    if (productRoute && !shouldDelegateProductRoute(productRoute)) {
      appendAssistantRouteAudit(productRoute, projectInfo || null);
      return productRoute;
    }

    if (productRoute && shouldDelegateProductRoute(productRoute)) {
      appendAuditEvent('assistant.product_route_delegated', {
        reason: productRoute.meta ? productRoute.meta.reason : 'requires_persona',
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      });
    }

    const routeDecision = await requestPersonaRouteDecision({
      projectInfo: projectInfo || null,
      userMessage: userMessage || '',
      attachments: attachments || [],
      contextHint: enrichedContextHint,
      conversationMessages: conversationMessages || [],
      activeMemory,
    });
    const enrichedRouteDecision = attachDelegatedProductContextFrame(routeDecision, productRoute);
    appendAssistantRouteAudit(enrichedRouteDecision, projectInfo || null);
    return enrichedRouteDecision;
  }

  async function buildNaturalRouteOnlyResponse(routeDecision, payload = {}, activeMemory = null) {
    if (!routeDecision || routeDecision.decision === 'execute' || typeof requestDirectPersonaChat !== 'function') {
      return routeDecision && routeDecision.response ? routeDecision.response : '';
    }

    try {
      const result = await requestDirectPersonaChat({
        projectInfo: payload.projectInfo || null,
        userMessage: payload.userMessage || '',
        attachments: payload.attachments || [],
        contextHint: payload.contextHint || null,
        conversationMessages: payload.conversationMessages || [],
        activeMemory,
        routeDecision,
      });
      const response = result && result.response ? String(result.response).trim() : '';
      if (response) return response;
    } catch (error) {
      appendAuditEvent('assistant.direct_chat_failed', {
        rootPath: payload.projectInfo && payload.projectInfo.rootPath ? payload.projectInfo.rootPath : null,
        decision: routeDecision.decision,
        message: clipText(error && error.message ? error.message : String(error || ''), 500),
      });
    }

    return routeDecision.response || '';
  }

  async function buildAssistantRouteOnlyPlan(routeDecision, payload = {}, activeMemory = null) {
    assertReady();
    const userMessage = payload && payload.userMessage ? payload.userMessage : '';
    if (!routeDecision || !routeDecision.ok) {
      const routeMeta = routeDecision && routeDecision.meta ? routeDecision.meta : {};
      return {
        ok: false,
        response:
          (routeDecision && routeDecision.response) ||
          buildAiProviderFailureMessage(getSelectedAiProvider(), 'Falha ao consultar a Persona.'),
        action: null,
        routeDecision: routeDecision || null,
        meta: {
          ...routeMeta,
          planner: routeMeta.planner || 'persona_router',
          reason:
            routeMeta.reason
              ? routeMeta.reason
              : 'persona_route_failed',
          providerError: Boolean(routeDecision && routeDecision.providerUnavailable),
          providerFailure: routeDecision && routeDecision.providerFailure ? routeDecision.providerFailure : null,
          noJob: true,
        },
      };
    }

    if (routeDecision.decision !== 'execute') {
      const routeMeta = routeDecision.meta || {};
      const response =
        (await buildNaturalRouteOnlyResponse(routeDecision, payload, activeMemory)) ||
        routeDecision.response ||
        buildConversationOnlyPlan(userMessage || '').response;
      return {
        ok: true,
        response,
        action: null,
        routeDecision,
        meta: {
          ...routeMeta,
          planner: routeMeta.planner || 'persona_router',
          reason:
            routeMeta.reason ||
            (routeDecision.decision === 'clarify' ? 'persona_clarification_needed' : 'conversation_only'),
          noJob: true,
        },
      };
    }

    return null;
  }

  function resolveRouteMode(routeDecision = {}) {
    return String(
      (routeDecision.productRoute && routeDecision.productRoute.mode) ||
        (routeDecision.meta && routeDecision.meta.mode) ||
        ''
    ).trim();
  }

  function resolveRouteCapability(routeDecision = {}) {
    return String(
      (routeDecision.productRoute && routeDecision.productRoute.capability) ||
        (routeDecision.meta && routeDecision.meta.capability) ||
        'edit_project'
    ).trim() || 'edit_project';
  }

  function shouldSuggestAutomataContract(plan = {}, routeDecision = {}, userMessage = '') {
    if (!plan || plan.action) return false;
    if (plan.meta && plan.meta.providerError) return false;
    if (!hasExplicitAutomataContractIntent(userMessage)) return false;
    const reason = String((plan.meta && plan.meta.reason) || '');
    if (!reason) return false;
    if (/conversation_only|clarification|awaiting_user_input|missing_project/i.test(reason)) return false;
    if (/contract_unresolved|unsupported_automata_contract|unsupported_micro_contract/i.test(reason)) return true;

    const routeMode = resolveRouteMode(routeDecision);
    const executableRoute = routeDecision && routeDecision.decision === 'execute';
    if (
      executableRoute &&
      /adaptive_blueprint|guided_app_architecture/i.test(routeMode)
    ) {
      return false;
    }
    if (
      executableRoute &&
      /deterministic_patch|cortex_incremental_edit|existing_project_edit|new_project_area/i.test(routeMode) &&
      /no_action|runtime_empty_plan|validation_retry_exhausted|validation_score/i.test(reason)
    ) {
      return true;
    }

    return false;
  }

  function buildAutomataContractSuggestionPayload({
    plan = {},
    projectInfo = null,
    routeDecision = {},
    userMessage = '',
  } = {}) {
    const meta = plan && plan.meta ? plan.meta : {};
    const reason = String(meta.reason || 'contract_unresolved');
    const routeMode = resolveRouteMode(routeDecision);
    const capability = resolveRouteCapability(routeDecision);
    const executionIntent = String(
      (routeDecision.productRoute && routeDecision.productRoute.executionIntent) ||
        (routeDecision.meta && routeDecision.meta.executionIntent) ||
        capability
    ).trim();
    const observedMessage = String(userMessage || '').trim();
    const titleBase = routeMode
      ? `Contrato temporario para ${routeMode}`
      : 'Contrato temporario de execucao';

    return {
      title: titleBase,
      capability,
      observedMessage,
      triggerExamples: observedMessage ? [observedMessage] : [],
      reason:
        'O pedido entrou em uma rota valida, mas nenhum contrato ativo conseguiu transformar a intencao em uma alteracao segura. ' +
        'A proposta fica local e so vira contrato ativo depois de voce aprovar, testar e promover.',
      proposedContract: {
        schemaVersion: 'automata-micro-contract-draft-v1',
        source: 'persona_orchestrator',
        route: {
          capability,
          mode: routeMode || 'unknown',
          executionIntent,
          originalReason: reason,
          projectState:
            (routeDecision.productRoute && routeDecision.productRoute.projectState) ||
            (routeDecision.meta && routeDecision.meta.projectState) ||
            '',
        },
        aiResponsibilities: [
          'Interpretar a intencao humana e preencher valores tecnicos ausentes quando o usuario demonstrar indiferenca.',
          'Explicar em linguagem natural o que o contrato pretende resolver antes da aprovacao.',
        ],
        systemResponsibilities: [
          'Validar o contrato como dados locais, sem executar codigo sugerido.',
          'Manter o contrato em staged ate existir teste pratico no projeto.',
          'Promover para local_active apenas apos aceite explicito do usuario.',
        ],
        acceptanceCriteria: [
          'Nao altera arquivos no momento da sugestao.',
          'Contrato tem pre-visualizacao expansivel antes de aprovar.',
          'Contrato staged pode ser marcado como funcionou ou falhou depois do smoke test.',
        ],
        project: {
          id: projectInfo && projectInfo.id ? projectInfo.id : '',
          rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
        },
      },
    };
  }

  function attachAutomataContractSuggestion(plan, suggestionResult) {
    if (!suggestionResult || !suggestionResult.ok || !suggestionResult.entry) return plan;
    const entry = suggestionResult.entry;
    return {
      ...plan,
      response:
        'Esse pedido parece precisar de um contrato temporario antes de virar comportamento fixo do Faber Code. ' +
        'Preparei uma proposta local para voce revisar: ela nao executa comandos nem altera arquivos agora; se fizer sentido, voce aprova para staged, testa no projeto e depois promove para contrato local ativo.',
      automataContractSuggestion: entry,
      meta: {
        ...(plan.meta || {}),
        automataContractSuggestion: true,
        automataContractLedgerId: entry.id,
        originalReason:
          plan.meta && plan.meta.reason
            ? plan.meta.reason
            : 'contract_unresolved',
        reason: 'automata_contract_suggestion_ready',
      },
    };
  }

  async function buildAssistantPlanResponse(payload = {}) {
    assertReady();
    const { projectInfo, userMessage, attachments, contextHint, conversationMessages, jobId: requestedJobId } = payload || {};
    const activeMemory = await resolveRequestActiveMemory(payload, 'plan');
    const enrichedContextHint = enrichContextHintWithActiveMemory(contextHint, activeMemory);
    const routeFromContext =
      enrichedContextHint && enrichedContextHint.personaRouteDecision && enrichedContextHint.personaRouteDecision.decision
        ? enrichedContextHint.personaRouteDecision
        : enrichedContextHint && enrichedContextHint.productRouteDecision && enrichedContextHint.productRouteDecision.decision
          ? enrichedContextHint.productRouteDecision
        : null;
    let routeDecision = normalizeExecuteRouteFromContext(routeFromContext, userMessage || '');

    if (!routeDecision) {
      routeDecision = await resolveAssistantRouteDecision({
        projectInfo: projectInfo || null,
        userMessage: userMessage || '',
        attachments: attachments || [],
        contextHint: enrichedContextHint,
        conversationMessages: conversationMessages || [],
      });
    }

    const routeOnlyPlan = await buildAssistantRouteOnlyPlan(
      routeDecision,
      {
        projectInfo,
        userMessage: userMessage || '',
        attachments,
        contextHint: enrichedContextHint,
        conversationMessages,
      },
      activeMemory
    );
    if (routeOnlyPlan) return routeOnlyPlan;

    let jobId = requestedJobId || null;
    const effectiveUserMessage = routeDecision.executionMessage || userMessage || '';
    const effectiveContextHint = {
      ...(enrichedContextHint || {}),
      originalUserMessage:
        (enrichedContextHint && enrichedContextHint.originalUserMessage) ||
        userMessage ||
        routeDecision.executionMessage ||
        '',
      routeExecutionMessage: routeDecision.executionMessage || '',
      conversationMessages: Array.isArray(conversationMessages) ? conversationMessages : [],
      personaApprovedExecution: true,
      personaRouteDecision: routeDecision,
      productRouteDecision:
        routeDecision && routeDecision.meta && routeDecision.meta.planner === 'product_orchestrator'
          ? routeDecision
          : enrichedContextHint && enrichedContextHint.productRouteDecision
            ? enrichedContextHint.productRouteDecision
            : null,
    };

    if (!jobId) {
      const jobCreation = createAssistantJob({
        projectId: projectInfo && projectInfo.id ? projectInfo.id : null,
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
        userMessage: effectiveUserMessage,
        attachments: attachments || [],
        mode: (effectiveContextHint && effectiveContextHint.mode) || 'default',
      });
      if (jobCreation.ok) {
        jobId = jobCreation.job.id;
      }
    }

    if (jobId) {
      markJobPhase(jobId, 'persona_plan', {
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      });
      if (activeMemory) {
        setJobCheckpoint(jobId, 'active_memory', summarizeActiveMemory(activeMemory));
      }
      persistJobContextFrameEvidence(jobId, routeDecision, projectInfo || null);
    }

    let plan = null;
    try {
      if (
        routeDecision &&
        routeDecision.decision === 'execute' &&
        typeof buildAgenticExecutionPlan === 'function' &&
        !shouldPreferCortexRuntimeForRoute(routeDecision)
      ) {
        plan = await buildAgenticExecutionPlan({
          projectInfo,
          userMessage: effectiveUserMessage,
          attachments: attachments || [],
          contextHint: effectiveContextHint,
          conversationMessages: conversationMessages || [],
          routeDecision,
          jobId,
        });
      }
      if (!plan) {
        plan = await buildPlanWithCortexRuntime(
          projectInfo,
          effectiveUserMessage,
          attachments || [],
          effectiveContextHint,
          jobId
        );
      }
    } catch (error) {
      const provider = getSelectedAiProvider();
      const failure = normalizeProviderFailure(error, provider);
      const message = failure.technicalMessage;
      const reason = buildProviderFailureReason(failure, 'ai_provider_error', provider);
      if (jobId) {
        setJobCheckpoint(jobId, 'provider_failure', {
          provider,
          message: clipText(message, 800),
          providerFailure: failure,
        });
        markJobFailed(jobId, reason, 'provider_failure');
      }
      appendAuditEvent('assistant.plan_provider_failed', {
        provider,
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
        jobId,
        code: failure.code,
        category: failure.category,
        retryable: failure.retryable,
        message,
      });
      const failedPlan = {
        ok: false,
        response: buildAiProviderFailureMessage(provider, failure),
        action: null,
        routeDecision,
        meta: {
          planner: 'cortex_runtime',
          reason,
          providerError: true,
          providerFailure: failure,
          provider,
          runtime: runtimeVersion,
        },
      };
      if (jobId) failedPlan.jobId = jobId;
      return failedPlan;
    }

    if (!plan || typeof plan !== 'object') {
      plan = {
        ok: false,
        response: 'O runtime Cortex não retornou um plano válido. Nenhuma alteração foi preparada.',
        action: null,
        routeDecision,
        meta: {
          planner: 'cortex_runtime',
          reason: 'cortex_runtime_empty_plan',
          runtime: runtimeVersion,
        },
      };
    }

    if (
      typeof suggestAutomataContract === 'function' &&
      shouldSuggestAutomataContract(
        plan,
        routeDecision,
        effectiveContextHint.originalUserMessage || userMessage || ''
      )
    ) {
      try {
        const suggestion = suggestAutomataContract(
          buildAutomataContractSuggestionPayload({
            plan,
            projectInfo,
            routeDecision,
            userMessage: effectiveUserMessage,
          }),
          {
            project: {
              projectId: projectInfo && projectInfo.id ? projectInfo.id : null,
              rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
            },
            provider: getSelectedAiProvider(),
          }
        );
        plan = attachAutomataContractSuggestion(plan, suggestion);
      } catch (error) {
        appendAuditEvent('automata_contract.suggestion_failed', {
          rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
          jobId,
          message: clipText(error && error.message ? error.message : String(error || ''), 500),
        });
      }
    }

    if (jobId) {
      setJobCheckpoint(jobId, 'last_plan', {
        ok: plan.ok,
        hasAction: Boolean(plan.action),
        planner: plan.meta ? plan.meta.planner || null : null,
        model: plan.meta ? plan.meta.model || null : null,
        reason: plan.meta ? plan.meta.reason || null : null,
        responsePreview: String(plan.response || '').slice(0, 320),
      });

      const plannerName = plan.meta && plan.meta.planner ? plan.meta.planner : null;
      const planReason = plan.meta && plan.meta.reason ? plan.meta.reason : null;
      const autoExecute = Boolean(plan.meta && plan.meta.autoExecute);
      if (planReason === 'paused_memory_pressure') {
        markJobPausedForMemory(jobId, {
          runtime: plan.meta && plan.meta.runtime ? plan.meta.runtime : runtimeVersion,
          memoryState:
            plan.meta && plan.meta.runtimeBudget && plan.meta.runtimeBudget.memoryState
              ? plan.meta.runtimeBudget.memoryState
              : null,
        });
      } else if (planReason && isAiRetryableReason(planReason)) {
        const retryMarked = markJobRetryPending(jobId, planReason, 'persona_plan');
        if (retryMarked.ok && retryMarked.job && retryMarked.job.retryState && retryMarked.job.retryState.retryable === false) {
          markJobFailed(jobId, planReason, 'persona_retry_exhausted');
        }
      } else if (plannerName === 'cortex_runtime' || plannerName === 'agentic_tool_loop') {
        if (plan.action) {
          markJobPhase(jobId, autoExecute ? 'execute_pending' : 'awaiting_user_confirmation', {
            planner: plannerName,
            autoExecute,
          });
        } else {
          const reasonText = String(planReason || '');
          const hasAutomataContractSuggestion = Boolean(plan.automataContractSuggestion);
          const isBriefingRetry = reasonText.startsWith('cortex_briefing_error');
          const isValidationRetry =
            reasonText.startsWith('cortex_validation_score:') ||
            reasonText === 'cortex_validation_unmet' ||
            reasonText.startsWith('cortex_validation_unmet');
          const isBriefingClarification = reasonText === 'cortex_briefing_clarification_needed';
          const isConversationOnly = reasonText === 'conversation_only' || reasonText === 'edit_needs_target';

          if (isBriefingClarification) {
            markJobPhase(jobId, 'awaiting_user_input', {
              reason: 'briefing_clarification_needed',
              questions: plan.meta && Array.isArray(plan.meta.clarificationQuestions)
                ? plan.meta.clarificationQuestions.slice(0, 5)
                : [],
            });
          } else if (isConversationOnly) {
            markJobCompleted(jobId, {
              reason: reasonText,
              noFileChanges: true,
            });
          } else if (hasAutomataContractSuggestion) {
            markJobPhase(jobId, 'awaiting_user_input', {
              reason: 'automata_contract_review',
              ledgerId: plan.automataContractSuggestion.id,
            });
          } else if (isBriefingRetry || isValidationRetry) {
            const retryPhase = isBriefingRetry ? 'cortex_briefing' : 'cortex_validation';
            const retryMarked = markJobRetryPending(jobId, planReason, retryPhase);
            if (retryMarked.ok && retryMarked.job && retryMarked.job.retryState && retryMarked.job.retryState.retryable === false) {
              markJobFailed(
                jobId,
                planReason,
                isBriefingRetry ? 'cortex_briefing_retry_exhausted' : 'cortex_validation_retry_exhausted'
              );
            }
          } else {
            markJobFailed(jobId, planReason || 'cortex_runtime_no_action', 'cortex_validation');
          }
        }
      } else if (plannerName === 'persona_orchestrator') {
        markJobPhase(jobId, plan.action ? (autoExecute ? 'execute_pending' : 'awaiting_user_confirmation') : 'persona_done');
      } else {
        appendJobEvent(jobId, 'job.plan_non_persona_route', {
          planner: plannerName || 'unknown',
          reason: planReason,
        });

        if (!plan.action) {
          const nonPersonaReason = planReason || `planner:${plannerName || 'unknown'}`;
          if (isAiRetryableReason(nonPersonaReason)) {
            const retryMarked = markJobRetryPending(jobId, nonPersonaReason, 'persona_plan');
            if (retryMarked.ok && retryMarked.job && retryMarked.job.retryState && retryMarked.job.retryState.retryable === false) {
              markJobFailed(jobId, nonPersonaReason, 'persona_retry_exhausted');
            }
          } else {
            markJobFailed(jobId, nonPersonaReason, 'persona_non_actionable_route');
          }
        } else {
          markJobPhase(jobId, autoExecute ? 'execute_pending' : 'awaiting_user_confirmation', {
            route: 'non_persona_with_action',
            planner: plannerName || 'unknown',
            autoExecute,
          });
        }
      }
    }

    if (jobId) {
      plan.jobId = jobId;
      if (plan.action && typeof plan.action === 'object') {
        plan.action.jobId = jobId;
      }
    }

    plan.routeDecision = routeDecision;
    appendAuditEvent('assistant.plan_built', {
      ok: plan.ok,
      hasAction: Boolean(plan.action),
      rootPath: projectInfo ? projectInfo.rootPath : null,
      jobId,
      planner: plan.meta ? plan.meta.planner : 'unknown',
      model: plan.meta && plan.meta.model ? plan.meta.model : null,
      reason: plan.meta && plan.meta.reason ? plan.meta.reason : null,
      memoryStatus:
        plan.meta && plan.meta.memory
          ? plan.meta.memory.ok
            ? 'memory_ok'
            : plan.meta.memory.reason || 'memory_unavailable'
          : 'memory_unset',
    });
    return plan;
  }

  async function handleAssistantMessage(payload = {}) {
    assertReady();
    const { projectInfo, userMessage, attachments, contextHint, conversationMessages, jobId } = payload || {};
    const activeMemory = await resolveRequestActiveMemory(payload, 'message');
    const enrichedContextHint = enrichContextHintWithActiveMemory(contextHint, activeMemory);
    const routeDecision = await resolveAssistantRouteDecision({
      projectInfo: projectInfo || null,
      userMessage: userMessage || '',
      attachments: attachments || [],
      contextHint: enrichedContextHint,
      conversationMessages: conversationMessages || [],
    });

    const routeOnlyPlan = await buildAssistantRouteOnlyPlan(
      routeDecision,
      {
        projectInfo,
        userMessage: userMessage || '',
        attachments,
        contextHint: enrichedContextHint,
        conversationMessages,
      },
      activeMemory
    );
    if (routeOnlyPlan) return routeOnlyPlan;

    return buildAssistantPlanResponse({
      projectInfo,
      userMessage: routeDecision.executionMessage || userMessage || '',
      attachments,
      contextHint: {
        ...(enrichedContextHint || {}),
        originalUserMessage: userMessage || '',
        routeExecutionMessage: routeDecision.executionMessage || '',
        conversationMessages: Array.isArray(conversationMessages) ? conversationMessages : [],
        personaApprovedExecution: true,
        personaRouteDecision: routeDecision,
        productRouteDecision:
          routeDecision && routeDecision.meta && routeDecision.meta.planner === 'product_orchestrator'
            ? routeDecision
            : enrichedContextHint && enrichedContextHint.productRouteDecision
              ? enrichedContextHint.productRouteDecision
              : null,
      },
      conversationMessages,
      jobId,
    });
  }

  return {
    appendAssistantRouteAudit,
    buildAssistantPlanResponse,
    buildAssistantRouteOnlyPlan,
    handleAssistantMessage,
    resolveAssistantRouteDecision,
  };
}

module.exports = {
  createPersonaOrchestrator,
};
