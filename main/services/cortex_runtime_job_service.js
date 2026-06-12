function requireFunction(name, value) {
  if (typeof value !== 'function') {
    throw new Error(`cortex_runtime_job_service dependency missing: ${name}`);
  }
}

function createCortexRuntimeJobService(dependencies = {}) {
  const {
    appendJobEvent = () => {},
    buildConfirmationPlan,
    buildDeterministicEditPatchCheckpoint,
    buildDeterministicEditPatchEventPayload,
    clipText,
    createCortexRuntimeCheckpoint,
    markJobPhase = () => {},
    runtimeVersion,
    setJobCheckpoint,
  } = dependencies;

  requireFunction('appendJobEvent', appendJobEvent);
  requireFunction('buildConfirmationPlan', buildConfirmationPlan);
  requireFunction('buildDeterministicEditPatchCheckpoint', buildDeterministicEditPatchCheckpoint);
  requireFunction('buildDeterministicEditPatchEventPayload', buildDeterministicEditPatchEventPayload);
  requireFunction('clipText', clipText);
  requireFunction('createCortexRuntimeCheckpoint', createCortexRuntimeCheckpoint);
  requireFunction('markJobPhase', markJobPhase);
  requireFunction('setJobCheckpoint', setJobCheckpoint);

  function markCortexRuntimePhase(jobId, phase, details = {}) {
    if (!jobId) return;
    markJobPhase(jobId, phase, details);
  }

  function checkpointCortexRuntime(jobId, workGraph, runtimeBudget, extra = {}) {
    if (!jobId) return;
    setJobCheckpoint(jobId, 'cortex_runtime', createCortexRuntimeCheckpoint(workGraph, runtimeBudget, extra));
  }

  function checkpointRuntimeBudget(jobId, runtimeBudget) {
    if (!jobId) return;
    setJobCheckpoint(jobId, 'runtime_budget', runtimeBudget);
  }

  function checkpointProjectBlueprintPlan(jobId, blueprintPlan) {
    if (
      !jobId ||
      !blueprintPlan ||
      !blueprintPlan.action ||
      !Array.isArray(blueprintPlan.action.operations)
    ) {
      return;
    }
    setJobCheckpoint(jobId, 'project_blueprint', {
      reason: blueprintPlan.meta ? blueprintPlan.meta.reason : 'project_blueprint_ready',
      files: blueprintPlan.action.operations.map((operation) => operation.path).slice(0, 24),
    });
  }

  function checkpointDeterministicPatchPlan(jobId, deterministicPatchPlan) {
    if (
      !jobId ||
      !deterministicPatchPlan ||
      !deterministicPatchPlan.action ||
      !Array.isArray(deterministicPatchPlan.action.operations)
    ) {
      return null;
    }
    const patchEvidence = buildDeterministicEditPatchCheckpoint(deterministicPatchPlan.action);
    setJobCheckpoint(jobId, 'deterministic_patch', {
      reason: deterministicPatchPlan.meta ? deterministicPatchPlan.meta.reason : 'deterministic_patch_ready',
      files: deterministicPatchPlan.action.operations.map((operation) => operation.path).slice(0, 24),
      safePatchEvidence: patchEvidence,
    });
    const patchEventPayload = buildDeterministicEditPatchEventPayload(patchEvidence);
    if (patchEventPayload) {
      appendJobEvent(jobId, 'job.deterministic_patch_evidence', patchEventPayload);
    }
    return {
      patchEvidence,
      patchEventPayload,
    };
  }

  function compactPromptPart(value, limit) {
    return clipText(String(value || ''), Math.max(200, Number(limit) || 1200));
  }

  function buildCortexPausePlan({ projectInfo, userMessage, attachments = [], runtimeBudget } = {}) {
    const basePlan = buildConfirmationPlan(projectInfo, userMessage, attachments);
    return {
      ...(basePlan.ok ? basePlan : { ok: true, response: '', action: null }),
      action: null,
      response: [
        'Pausei este trabalho antes de iniciar nova inferência porque o Cortex detectou pressão crítica de memória local (guard ativo para provedores locais).',
        'O pedido ficou preservado no job. Feche apps pesados ou aguarde o Mac aliviar a memória, depois use tentar novamente para retomar sem reabrir tudo do zero.',
      ].join(' '),
      meta: {
        planner: 'cortex_runtime',
        model: null,
        reason: 'paused_memory_pressure',
        runtime: runtimeVersion,
        runtimeBudget,
      },
    };
  }

  return {
    buildCortexPausePlan,
    checkpointCortexRuntime,
    checkpointDeterministicPatchPlan,
    checkpointProjectBlueprintPlan,
    checkpointRuntimeBudget,
    compactPromptPart,
    markCortexRuntimePhase,
  };
}

module.exports = {
  createCortexRuntimeJobService,
};
