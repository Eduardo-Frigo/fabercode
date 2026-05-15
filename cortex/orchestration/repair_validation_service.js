const {
  buildOperationBatchFingerprint: defaultBuildOperationBatchFingerprint,
  createRenderPass: defaultCreateRenderPass,
  setPassStatus: defaultSetPassStatus,
} = require('./render_runtime_state');
const { isPatchFirstGuardrailMessage: defaultIsPatchFirstGuardrailMessage } = require('./render_pass_service');

function createCortexRepairValidationService(dependencies = {}) {
  const {
    CORTEX_VALIDATION_REPAIR_STALL_LIMIT = 1,
    buildOperationBatchDiffPreview,
    buildOperationBatchFingerprint = defaultBuildOperationBatchFingerprint,
    checkpointCortexRuntime = () => {},
    createRenderPass = defaultCreateRenderPass,
    evaluateExecutionReadiness,
    hasValidationCoverageImproved,
    isPatchFirstGuardrailMessage = defaultIsPatchFirstGuardrailMessage,
    mergeOperationBatches,
    requestEngineOperationBatchAction,
    setPassStatus = defaultSetPassStatus,
  } = dependencies;

  function requireDependency(name, value) {
    if (typeof value !== 'function') {
      throw new Error(`Cortex repair validation dependency missing: ${name}`);
    }
  }

  function getMaxRepairPasses(runtimeBudget) {
    return Math.max(0, Math.min(5, Number(runtimeBudget && runtimeBudget.maxRepairPasses) || 0));
  }

  async function runRepairValidationLoop({
    projectInfo,
    userMessage,
    attachments = [],
    mempalaceContext,
    mempalaceCore,
    ragContext,
    cortexContext,
    workGraph,
    renderPass,
    enginePlan,
    validation,
    runtimeBudget = {},
    latestDiagnostics = null,
    executionIntent = 'edit_project',
    artifactContext = '',
    jobId = null,
  } = {}) {
    requireDependency('buildOperationBatchDiffPreview', buildOperationBatchDiffPreview);
    requireDependency('buildOperationBatchFingerprint', buildOperationBatchFingerprint);
    requireDependency('checkpointCortexRuntime', checkpointCortexRuntime);
    requireDependency('createRenderPass', createRenderPass);
    requireDependency('evaluateExecutionReadiness', evaluateExecutionReadiness);
    requireDependency('hasValidationCoverageImproved', hasValidationCoverageImproved);
    requireDependency('isPatchFirstGuardrailMessage', isPatchFirstGuardrailMessage);
    requireDependency('mergeOperationBatches', mergeOperationBatches);
    requireDependency('requestEngineOperationBatchAction', requestEngineOperationBatchAction);
    requireDependency('setPassStatus', setPassStatus);

    if (!workGraph || !Array.isArray(workGraph.passes) || !Array.isArray(workGraph.validationResults)) {
      throw new Error('Cortex repair validation dependency missing: workGraph');
    }

    let currentPlan = enginePlan;
    let currentValidation = validation;
    let patchFirstGuardrailHit = false;
    let patchFirstGuardrailMessage = '';

    if (!currentValidation || currentValidation.ready) {
      return {
        enginePlan: currentPlan,
        validation: currentValidation,
        patchFirstGuardrailHit,
        patchFirstGuardrailMessage,
      };
    }

    const maxRepairPasses = getMaxRepairPasses(runtimeBudget);
    let repairAttempt = 0;
    let repairStallCount = 0;
    let bestPlan = currentPlan;
    let bestValidation = currentValidation;
    let cumulativeOperations = Array.isArray(currentPlan && currentPlan.action && currentPlan.action.operations)
      ? currentPlan.action.operations.slice()
      : [];
    let previousFingerprint = buildOperationBatchFingerprint(cumulativeOperations);
    let unchangedFingerprintCount = 0;

    while (!currentValidation.ready && repairAttempt < maxRepairPasses) {
      repairAttempt += 1;
      const previousPassId = workGraph.currentPassId || (renderPass && renderPass.id) || null;

      const repairValidationPass = createRenderPass({
        role: 'persona_executor',
        kind: `repair_validation_${repairAttempt}`,
        inputRefs: [previousPassId, 'validation.failed_checks'].filter(Boolean),
        outputContract: { operations: 'operation_batch', coverage: '100%' },
        maxTokens: runtimeBudget && runtimeBudget.generationOptions
          ? runtimeBudget.generationOptions.num_predict
          : undefined,
        repairOf: previousPassId,
      });

      workGraph.passes.push(repairValidationPass);
      workGraph.currentPassId = repairValidationPass.id;
      setPassStatus(workGraph, repairValidationPass.id, 'running', {
        message: `Repair pass ${repairAttempt}/${maxRepairPasses} iniciado após validação incompleta.`,
        coverage: currentValidation,
      });
      checkpointCortexRuntime(jobId, workGraph, runtimeBudget, {
        stage: 'validation_repair_started',
        repairAttempt,
        maxRepairPasses,
      });

      const repairPlan = await requestEngineOperationBatchAction({
        projectInfo,
        userMessage,
        attachments,
        mempalaceContext,
        mempalaceCore,
        ragContext,
        cortexContext,
        workGraph,
        runtimeBudget,
        latestDiagnostics,
        executionIntent,
        artifactContext,
        repairContext: {
          failedCoverage: currentValidation,
          failedMessage: 'validation_not_ready',
          repairAttempt,
          maxRepairPasses,
          failedOperations: Array.isArray(cumulativeOperations)
            ? cumulativeOperations.map((op) => ({ op: op.op, path: op.path }))
            : [],
        },
      });

      if (!(repairPlan && repairPlan.ok && repairPlan.action && Array.isArray(repairPlan.action.operations))) {
        const repairMessage = (repairPlan && repairPlan.message) || 'Repair pass inválido.';
        if (isPatchFirstGuardrailMessage(repairMessage)) {
          patchFirstGuardrailHit = true;
          patchFirstGuardrailMessage = repairMessage;
        }
        setPassStatus(workGraph, repairValidationPass.id, 'failed', {
          message: repairMessage,
          coverage: currentValidation,
          repairAttempt,
        });
        break;
      }

      const mergedOperations = mergeOperationBatches(
        cumulativeOperations,
        repairPlan.action.operations
      );
      const repairedValidation = evaluateExecutionReadiness({
        operations: mergedOperations,
        projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
        executionIntent,
        userMessage,
        artifactContext,
      });
      workGraph.validationResults.push(repairedValidation);

      const mergedPlan = {
        ...repairPlan,
        action: {
          ...repairPlan.action,
          operations: mergedOperations,
          targetFile:
            (repairPlan.action && repairPlan.action.targetFile) ||
            (mergedOperations[0] && mergedOperations[0].path) ||
            'index.html',
          diffPreview: buildOperationBatchDiffPreview(mergedOperations),
        },
      };
      const improved = hasValidationCoverageImproved(bestValidation, repairedValidation);
      const currentFingerprint = buildOperationBatchFingerprint(mergedOperations);
      if (currentFingerprint === previousFingerprint) {
        unchangedFingerprintCount += 1;
      } else {
        unchangedFingerprintCount = 0;
      }
      previousFingerprint = currentFingerprint;
      cumulativeOperations = mergedOperations;

      if (improved) {
        bestPlan = mergedPlan;
        bestValidation = repairedValidation;
        repairStallCount = 0;
      } else {
        repairStallCount += 1;
      }

      if (repairedValidation.ready) {
        setPassStatus(workGraph, repairValidationPass.id, 'completed', {
          message: `Repair pass ${repairAttempt} concluiu a validação com sucesso.`,
          coverage: repairedValidation,
          improved,
        });
        currentPlan = mergedPlan;
        currentValidation = repairedValidation;
        break;
      }

      setPassStatus(workGraph, repairValidationPass.id, 'failed', {
        message: improved
          ? `Repair pass ${repairAttempt} melhorou a cobertura, mas ainda não atingiu critérios finais.`
          : `Repair pass ${repairAttempt} não melhorou a cobertura de validação.`,
        coverage: repairedValidation,
        improved,
      });
      currentValidation = repairedValidation;

      if (unchangedFingerprintCount >= 1) {
        setPassStatus(workGraph, repairValidationPass.id, 'failed', {
          message: `Repair pass ${repairAttempt} repetiu o mesmo lote técnico sem alteração útil; interrompendo loop para evitar travamento.`,
          coverage: repairedValidation,
          improved,
        });
        break;
      }

      if (repairStallCount >= Math.max(1, CORTEX_VALIDATION_REPAIR_STALL_LIMIT)) {
        break;
      }
    }

    if (
      !currentValidation.ready &&
      bestPlan &&
      bestValidation &&
      hasValidationCoverageImproved(currentValidation, bestValidation)
    ) {
      currentPlan = bestPlan;
      currentValidation = bestValidation;
    }

    return {
      enginePlan: currentPlan,
      validation: currentValidation,
      patchFirstGuardrailHit,
      patchFirstGuardrailMessage,
    };
  }

  return {
    runRepairValidationLoop,
  };
}

module.exports = {
  createCortexRepairValidationService,
};
