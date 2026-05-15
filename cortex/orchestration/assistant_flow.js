function createAssistantFlow(dependencies = {}) {
  const {
    appendAuditEvent,
    appendJobEvent,
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
    requestPersonaRouteDecision,
    runtimeVersion,
    setJobCheckpoint,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Assistant flow dependency missing: ${name}`);
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

  function normalizeExecuteRouteFromContext(routeFromContext, fallbackUserMessage = '') {
    if (!routeFromContext || String(routeFromContext.decision || '').toLowerCase() !== 'execute') {
      return null;
    }

    return {
      ok: true,
      decision: 'execute',
      response: routeFromContext.response || '',
      executionMessage: routeFromContext.executionMessage || fallbackUserMessage || '',
      meta: routeFromContext.meta || { planner: 'persona_router', reason: 'persona_selected_execution' },
    };
  }

  function buildAssistantRouteOnlyPlan(routeDecision, userMessage = '') {
    assertReady();
    if (!routeDecision || !routeDecision.ok) {
      return {
        ok: false,
        response:
          (routeDecision && routeDecision.response) ||
          buildAiProviderFailureMessage(getSelectedAiProvider(), 'Falha ao consultar a Persona.'),
        action: null,
        routeDecision: routeDecision || null,
        meta: {
          ...(routeDecision && routeDecision.meta ? routeDecision.meta : {}),
          planner: 'persona_router',
          reason:
            routeDecision && routeDecision.meta && routeDecision.meta.reason
              ? routeDecision.meta.reason
              : 'persona_route_failed',
          providerError: Boolean(routeDecision && routeDecision.providerUnavailable),
          noJob: true,
        },
      };
    }

    if (routeDecision.decision !== 'execute') {
      return {
        ok: true,
        response: routeDecision.response || buildConversationOnlyPlan(userMessage || '').response,
        action: null,
        routeDecision,
        meta: {
          ...(routeDecision.meta || {}),
          planner: 'persona_router',
          reason: routeDecision.decision === 'clarify' ? 'persona_clarification_needed' : 'conversation_only',
          noJob: true,
        },
      };
    }

    return null;
  }

  async function buildAssistantPlanResponse(payload = {}) {
    assertReady();
    const { projectInfo, userMessage, attachments, contextHint, conversationMessages, jobId: requestedJobId } = payload || {};
    const routeFromContext =
      contextHint && contextHint.personaRouteDecision && contextHint.personaRouteDecision.decision
        ? contextHint.personaRouteDecision
        : null;
    let routeDecision = normalizeExecuteRouteFromContext(routeFromContext, userMessage || '');

    if (!routeDecision) {
      routeDecision = await requestPersonaRouteDecision({
        projectInfo: projectInfo || null,
        userMessage: userMessage || '',
        attachments: attachments || [],
        contextHint: contextHint || null,
        conversationMessages: conversationMessages || [],
      });
      appendAssistantRouteAudit(routeDecision, projectInfo || null);
    }

    const routeOnlyPlan = buildAssistantRouteOnlyPlan(routeDecision, userMessage || '');
    if (routeOnlyPlan) return routeOnlyPlan;

    let jobId = requestedJobId || null;
    const effectiveUserMessage = routeDecision.executionMessage || userMessage || '';
    const effectiveContextHint = {
      ...(contextHint || {}),
      personaApprovedExecution: true,
      personaRouteDecision: routeDecision,
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
    }

    let plan = null;
    try {
      plan = await buildPlanWithCortexRuntime(
        projectInfo,
        effectiveUserMessage,
        attachments || [],
        effectiveContextHint,
        jobId
      );
    } catch (error) {
      const provider = getSelectedAiProvider();
      const message = error && error.message ? error.message : String(error || '');
      if (jobId) {
        setJobCheckpoint(jobId, 'provider_failure', {
          provider,
          message: clipText(message, 800),
        });
        markJobFailed(jobId, `ai_provider_error:${message}`, 'provider_failure');
      }
      appendAuditEvent('assistant.plan_provider_failed', {
        provider,
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
        jobId,
        message,
      });
      const failedPlan = {
        ok: false,
        response: buildAiProviderFailureMessage(provider, message),
        action: null,
        routeDecision,
        meta: {
          planner: 'cortex_runtime',
          reason: `ai_provider_error:${message}`,
          providerError: true,
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
      } else if (plannerName === 'cortex_runtime') {
        if (plan.action) {
          markJobPhase(jobId, 'awaiting_user_confirmation');
        } else {
          const reasonText = String(planReason || '');
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
        markJobPhase(jobId, plan.action ? 'awaiting_user_confirmation' : 'persona_done');
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
          markJobPhase(jobId, 'awaiting_user_confirmation', {
            route: 'non_persona_with_action',
            planner: plannerName || 'unknown',
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
    const routeDecision = await requestPersonaRouteDecision({
      projectInfo: projectInfo || null,
      userMessage: userMessage || '',
      attachments: attachments || [],
      contextHint: contextHint || null,
      conversationMessages: conversationMessages || [],
    });
    appendAssistantRouteAudit(routeDecision, projectInfo || null);

    const routeOnlyPlan = buildAssistantRouteOnlyPlan(routeDecision, userMessage || '');
    if (routeOnlyPlan) return routeOnlyPlan;

    return buildAssistantPlanResponse({
      projectInfo,
      userMessage: routeDecision.executionMessage || userMessage || '',
      attachments,
      contextHint: {
        ...(contextHint || {}),
        personaApprovedExecution: true,
        personaRouteDecision: routeDecision,
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
  };
}

module.exports = {
  createAssistantFlow,
};
