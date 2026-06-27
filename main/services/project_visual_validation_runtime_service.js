const { buildVisualValidationReport } = require('../../cortex/orchestration/visual_validation_service');
const { createVisualBriefingSemanticService } = require('../../cortex/orchestration/visual_briefing_semantic_service');
const { createVisualProductCoverageService } = require('../../cortex/orchestration/visual_product_coverage_service');
const {
  buildViewportCaptureSet,
  normalizeVisualViewportSet,
} = require('./project_visual_viewport_service');

function normalizeVisualRuntimeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isAbortSignalAborted(signal = null) {
  return Boolean(signal && signal.aborted);
}

function resolveActionTaskType(action = {}) {
  if (action && action.executionCommand && action.executionCommand.task_type) {
    return String(action.executionCommand.task_type || '').trim().toLowerCase();
  }
  return String(action && action.type ? action.type : '').trim().toLowerCase();
}

function isRuntimeTestCompatibilityPatch(action = null) {
  if (!action || typeof action !== 'object') return false;
  const generatedBy = String(action.generatedBy || '').trim();
  const microContractType =
    action.microContract && action.microContract.type ? String(action.microContract.type || '').trim() : '';
  if (
    generatedBy === 'deterministic_structured_clone_compat_patch' ||
    microContractType === 'runtime_test_compatibility'
  ) {
    return true;
  }
  const operations = Array.isArray(action.operations) ? action.operations : [];
  if (!operations.length) return false;
  return operations.every((operation) => {
    const relPath = String(operation && operation.path ? operation.path : '').replace(/\\/g, '/');
    return /^(lib|src\/lib|tests|__tests__)\//.test(relPath) && /\.(tsx?|jsx?)$/i.test(relPath);
  });
}

function isVisualSurfaceRequest({ action = null, userMessage = '', executionIntent = '' } = {}) {
  if (resolveActionTaskType(action) === 'search_text_in_files') return false;
  if (isRuntimeTestCompatibilityPatch(action)) return false;
  const visual = action && action.executionValidation && action.executionValidation.visualValidation
    ? action.executionValidation.visualValidation
    : null;
  if (visual && visual.required) return true;

  const source = normalizeVisualRuntimeText(`${userMessage}\n${executionIntent}`);
  return /\b(site|landing|pagina|web|layout|visual|hero|background|fundo|imagem|overlay|video|cards?|grid|css|tailwind|responsivo|produto|chocolate|cacau|portfolio|institucional)\b/.test(source);
}

function normalizePreviewForReport(previewResult = null) {
  if (!previewResult || typeof previewResult !== 'object') return null;
  const session = previewResult.session || {};
  const url = String(session.url || previewResult.url || '');
  const ready = Boolean(previewResult.ok && session.status === 'ready' && url);
  return {
    ok: Boolean(previewResult.ok),
    ready,
    url,
    mode: session.mode || (previewResult.plan && previewResult.plan.mode) || '',
    status: session.status || previewResult.status || '',
    message: previewResult.message || '',
  };
}

function createPreviewFailureCapture(preview = null) {
  const message =
    preview && preview.message
      ? preview.message
      : 'Preview não ficou pronto para captura visual.';
  return {
    ok: false,
    reason: 'preview_not_ready',
    message,
    issues: [
      {
        id: 'preview_not_ready',
        severity: 'error',
        detail: message,
        hint: 'Corrija o preview local antes de validar visualmente o resultado.',
      },
    ],
  };
}

function mergeArtifactQuality(primary = null, fallback = null) {
  if (primary && primary.enabled) return primary;
  if (fallback && fallback.enabled) return fallback;
  return primary || fallback || null;
}

function normalizeSemanticIssue(issue = {}) {
  return {
    id: String(issue.id || 'semantic_visual_issue'),
    severity: String(issue.severity || 'warning'),
    detail: String(issue.detail || ''),
    hint: String(issue.hint || ''),
    source: 'visual_briefing_semantic',
  };
}

function normalizeProductCoverageIssue(issue = {}) {
  return {
    id: String(issue.id || 'product_visual_coverage_issue'),
    severity: String(issue.severity || 'warning'),
    detail: String(issue.detail || ''),
    hint: String(issue.hint || ''),
    source: 'visual_product_coverage',
  };
}

function isVisualInfrastructureIssue(issue = {}) {
  const id = String(issue && issue.id ? issue.id : '').toLowerCase();
  const detail = normalizeVisualRuntimeText(issue && issue.detail ? issue.detail : '');
  return (
    [
      'preview_not_ready',
      'capture_failed',
      'missing_preview_url',
      'browser_window_unavailable',
      'capture_dependency_missing',
    ].includes(id) ||
    /\b(err_empty_response|err_connection_refused|err_connection_reset|err_aborted|interrompendo preview|preview nao ficou pronto|browserwindow indisponivel|sem url)\b/.test(detail)
  );
}

function isVisualInfrastructureFailure(report = null) {
  if (!report || !report.required) return false;
  const captureStatus = report.capture && report.capture.status ? String(report.capture.status) : '';
  if (captureStatus === 'capture_failed') return true;
  return Array.isArray(report.issues) && report.issues.some(isVisualInfrastructureIssue);
}

function isPreviewCodeRuntimeFailure(report = null) {
  if (!report || !Array.isArray(report.issues)) return false;
  return report.issues.some((issue) => {
    const id = String(issue && issue.id ? issue.id : '').toLowerCase();
    const detail = normalizeVisualRuntimeText(issue && issue.detail ? issue.detail : '');
    return (
      id === 'preview_not_ready' &&
      /\b(referenceerror|typeerror|syntaxerror|module not found|document is not defined|window is not defined|localstorage is not defined|sessionstorage is not defined|navigator is not defined|can't resolve|cannot find module|failed to compile)\b/.test(detail)
    );
  });
}

function isBriefingSemanticVisualFailure(report = null) {
  if (!report || !report.required) return false;
  const artifactQuality = report.artifactQuality && typeof report.artifactQuality === 'object'
    ? report.artifactQuality
    : null;
  const criticalFailures = artifactQuality && Array.isArray(artifactQuality.criticalFailures)
    ? artifactQuality.criticalFailures.map((failure) => String(failure || '').toLowerCase())
    : [];
  const semanticCriticalIds = new Set([
    'content_specific',
    'generic_placeholders',
    'expected_brand_missing',
    'stale_fallback_brand',
  ]);
  if (criticalFailures.some((id) => semanticCriticalIds.has(id))) return true;

  return Array.isArray(report.issues) && report.issues.some((issue) => {
    const id = String(issue && issue.id ? issue.id : '').toLowerCase();
    const detail = normalizeVisualRuntimeText(issue && issue.detail ? issue.detail : '');
    return (
      [
        'semantic_visual_minimum',
        'semantic_domain_adherence',
        'product_visual_coverage_minimum',
        'expected_brand_missing',
        'stale_fallback_brand',
        'generic_placeholders',
      ].includes(id) ||
      /\b(aderencia semantica|briefing pediu cta|cores declaradas|marca explicita|placeholder generico|dominio do pedido|conteudo nao preserva)\b/.test(detail)
    );
  });
}

function attachSemanticValidationToCapture(capture = {}, {
  artifactContext = '',
  evaluateVisualBriefingSemantics = null,
  userMessage = '',
} = {}) {
  if (!capture || !capture.ok || typeof evaluateVisualBriefingSemantics !== 'function') return capture;
  const semantic = evaluateVisualBriefingSemantics({
    userMessage,
    contextText: artifactContext,
    pageSnapshot: capture.pageSnapshot,
  });
  if (!semantic || !semantic.enabled) return capture;
  const semanticAnalysis = {
    score: semantic.score,
    minScore: semantic.minScore,
    passesMinimum: semantic.passesMinimum,
    summary: semantic.summary,
    domain: semantic.contract ? semantic.contract.domain : '',
  };
  const nextCapture = {
    ...capture,
    semantic,
    analysis: {
      ...(capture.analysis || {}),
      semantic: semanticAnalysis,
    },
    issues: [
      ...(Array.isArray(capture.issues) ? capture.issues : []),
      ...(Array.isArray(semantic.issues) ? semantic.issues.map(normalizeSemanticIssue) : []),
    ],
  };
  if (!semantic.passesMinimum) {
    nextCapture.issues.push({
      id: 'semantic_visual_minimum',
      severity: 'error',
      detail: semantic.summary || 'Aderencia semantica visual abaixo do minimo.',
      hint: 'Ajuste o resultado renderizado para aderir ao briefing antes de concluir.',
      source: 'visual_briefing_semantic',
    });
  }
  return nextCapture;
}

function attachProductCoverageToCapture(capture = {}, {
  artifactContext = '',
  evaluateVisualProductCoverage = null,
  userMessage = '',
} = {}) {
  if (!capture || !capture.ok || typeof evaluateVisualProductCoverage !== 'function') return capture;
  const productCoverage = evaluateVisualProductCoverage({
    userMessage,
    contextText: artifactContext,
    pageSnapshot: capture.pageSnapshot,
    viewport: capture.viewport || null,
  });
  if (!productCoverage || !productCoverage.enabled) return capture;

  const productCoverageAnalysis = {
    score: productCoverage.score,
    minScore: productCoverage.minScore,
    passesMinimum: productCoverage.passesMinimum,
    summary: productCoverage.summary,
    required: productCoverage.expectations ? productCoverage.expectations.required : {},
  };
  const nextCapture = {
    ...capture,
    productCoverage,
    analysis: {
      ...(capture.analysis || {}),
      productCoverage: productCoverageAnalysis,
    },
    issues: [
      ...(Array.isArray(capture.issues) ? capture.issues : []),
      ...(Array.isArray(productCoverage.issues) ? productCoverage.issues.map(normalizeProductCoverageIssue) : []),
    ],
  };
  const hasBlockingIssue = Array.isArray(productCoverage.issues) &&
    productCoverage.issues.some((issue) => ['critical', 'error'].includes(String(issue.severity || '').toLowerCase()));
  if (!productCoverage.passesMinimum && !hasBlockingIssue) {
    nextCapture.issues.push({
      id: 'product_visual_coverage_minimum',
      severity: 'error',
      detail: productCoverage.summary || 'Cobertura visual de produto abaixo do minimo.',
      hint: 'Ajuste hero, CTA e secoes prometidas antes de concluir.',
      source: 'visual_product_coverage',
    });
  }
  return nextCapture;
}

function createProjectVisualValidationRuntimeService(dependencies = {}) {
  const {
    captureProjectPreview = async () => ({
      ok: false,
      reason: 'capture_dependency_missing',
      issues: [
        {
          id: 'capture_dependency_missing',
          severity: 'warning',
          detail: 'Serviço de captura visual não foi configurado.',
        },
      ],
    }),
    executeBrowserPreviewCapability = null,
    evaluateOperationBatchArtifactQuality = null,
    evaluateVisualBriefingSemantics = createVisualBriefingSemanticService().evaluateVisualBriefingSemantics,
    evaluateVisualProductCoverage = createVisualProductCoverageService().evaluateVisualProductCoverage,
    startProjectPreview = async () => ({ ok: false, message: 'Preview runtime não configurado.' }),
  } = dependencies;

  function buildDiskArtifactQuality({ projectInfo = null, userMessage = '', executionIntent = '', artifactContext = '' } = {}) {
    if (typeof evaluateOperationBatchArtifactQuality !== 'function') return null;
    return evaluateOperationBatchArtifactQuality({
      operations: [],
      projectRootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
      userMessage,
      executionIntent,
      contextText: artifactContext,
    });
  }

  async function runProjectVisualValidation(projectInfo = null, {
    action = null,
    userMessage = '',
    executionIntent = '',
    artifactContext = '',
    force = false,
    previewOptions = {},
    captureOptions = {},
    signal = null,
  } = {}) {
    const baseValidation = action && action.executionValidation ? action.executionValidation : {};
    const technicalChecksPassed = baseValidation.technicalChecksPassed !== undefined
      ? Boolean(baseValidation.technicalChecksPassed)
      : true;
    const technicalScore = Number(baseValidation.score || baseValidation.technicalScore || 100);
    const minTechnicalScore = Number(baseValidation.minScore || baseValidation.minTechnicalScore || 55);

    if (!force && isRuntimeTestCompatibilityPatch(action)) {
      return buildVisualValidationReport({
        technicalChecksPassed,
        technicalScore,
        minTechnicalScore,
        artifactQuality: null,
      });
    }

    const diskArtifactQuality = buildDiskArtifactQuality({
      projectInfo,
      userMessage,
      executionIntent,
      artifactContext,
    });
    const artifactQuality = mergeArtifactQuality(baseValidation.artifactQuality, diskArtifactQuality);
    const required = force || Boolean(artifactQuality && artifactQuality.enabled) || isVisualSurfaceRequest({
      action,
      userMessage,
      executionIntent,
    });

    if (!required) {
      return buildVisualValidationReport({
        technicalChecksPassed,
        technicalScore,
        minTechnicalScore,
        artifactQuality: null,
      });
    }

    const effectiveArtifactQuality = artifactQuality && artifactQuality.enabled
      ? artifactQuality
      : {
          enabled: true,
          score: 0,
          minScore: 70,
          passesMinimum: false,
          criticalFailures: ['visual_contract_missing'],
          issues: [
            {
              id: 'visual_contract_missing',
              severity: 'critical',
              detail: 'Pedido visual sem contrato de aderência ativo para comparar contra o briefing.',
              hint: 'Recalcule a qualidade de artefato a partir do projeto renderizado.',
            },
          ],
        };

    if (isAbortSignalAborted(signal)) {
      const preview = {
        ok: false,
        ready: false,
        url: '',
        message: 'Validação visual cancelada antes de abrir preview.',
      };
      return buildVisualValidationReport({
        technicalChecksPassed,
        technicalScore,
        minTechnicalScore,
        artifactQuality: effectiveArtifactQuality,
        preview,
        capture: createPreviewFailureCapture(preview),
      });
    }

    let previewResult = null;
    let preview = null;
    let capture = null;
    try {
      if (typeof executeBrowserPreviewCapability === 'function') {
        const capabilityResult = await executeBrowserPreviewCapability(projectInfo, {
          previewOptions,
          captureOptions,
          signal,
        });
        const capabilityData = capabilityResult && capabilityResult.evidence ? capabilityResult.evidence.data : {};
        previewResult = capabilityData.preview || (capabilityResult && capabilityResult.result ? capabilityResult.result.preview : null);
        preview = normalizePreviewForReport(previewResult);
        const captures = Array.isArray(capabilityData.captures) ? capabilityData.captures : [];
        if (captures.length) {
          const viewportCaptures = captures.map((viewportCapture) => {
            const semanticCapture = attachSemanticValidationToCapture(viewportCapture, {
              artifactContext,
              evaluateVisualBriefingSemantics,
              userMessage,
            });
            return attachProductCoverageToCapture(semanticCapture, {
              artifactContext,
              evaluateVisualProductCoverage,
              userMessage,
            });
          });
          capture = buildViewportCaptureSet(viewportCaptures);
        } else {
          capture = createPreviewFailureCapture(preview);
        }
      } else {
          previewResult = await startProjectPreview(projectInfo, {
            open: false,
            autoInstallDependencies: true,
            reuseActiveSession: true,
            preferExistingServer: true,
            existingServerTimeoutMs: 1500,
            existingServerPollIntervalMs: 250,
            readyTimeoutMs: 45000,
            signal,
            ...previewOptions,
          });
        preview = normalizePreviewForReport(previewResult);
        if (preview && preview.ready && preview.url) {
          const {
            viewport,
            viewports,
            ...singleCaptureOptions
          } = captureOptions || {};
          const viewportSet = normalizeVisualViewportSet(Array.isArray(viewports) && viewports.length ? viewports : viewport ? [viewport] : null);
          const viewportCaptures = [];
          for (const currentViewport of viewportSet) {
            if (isAbortSignalAborted(signal)) break;
            const viewportCapture = await captureProjectPreview({
              url: preview.url,
              rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
              ...singleCaptureOptions,
              viewport: currentViewport,
            });
            const semanticCapture = attachSemanticValidationToCapture(viewportCapture, {
              artifactContext,
              evaluateVisualBriefingSemantics,
              userMessage,
            });
            viewportCaptures.push(attachProductCoverageToCapture(semanticCapture, {
              artifactContext,
              evaluateVisualProductCoverage,
              userMessage,
            }));
          }
          capture = buildViewportCaptureSet(viewportCaptures);
        } else {
          capture = createPreviewFailureCapture(preview);
        }
      }
    } catch (error) {
      preview = {
        ok: false,
        ready: false,
        url: '',
        message: error.message,
      };
      capture = createPreviewFailureCapture(preview);
    }

    return buildVisualValidationReport({
      technicalChecksPassed,
      technicalScore,
      minTechnicalScore,
      artifactQuality: effectiveArtifactQuality,
      capture,
      preview,
    });
  }

  function evaluateVisualValidationGate(report = null) {
    if (!report || !report.required || report.status === 'not_required') {
      return {
        shouldBlock: false,
        reason: 'visual_validation_not_required',
        status: report && report.status ? report.status : 'not_required',
        topIssues: [],
      };
    }

    const infrastructureFailure = isVisualInfrastructureFailure(report);
    const shouldBlock = report.status === 'failed' || report.status === 'not_captured';
    const briefingSemanticFailure = !infrastructureFailure && shouldBlock && isBriefingSemanticVisualFailure(report);
    const topIssues = Array.isArray(report.issues)
      ? report.issues.slice(0, 3).map((issue) => {
          const severity = String(issue && issue.severity ? issue.severity : 'warning').toUpperCase();
          const detail = String(issue && issue.detail ? issue.detail : 'falha visual detectada');
          return `${severity}: ${detail}`;
        })
      : [];
    const staticVisualPassed = Boolean(
      (report.staticPassesMinimum ||
        (report.artifactQuality && report.artifactQuality.passesMinimum)) &&
        report.artifactQuality &&
        report.artifactQuality.passesMinimum
    );
    const technicalPassed = Boolean(
      report.technicalChecksPassed &&
        Number(report.technicalScore || 0) >= Number(report.minTechnicalScore || 0)
    );

    if (infrastructureFailure && staticVisualPassed && technicalPassed) {
      if (isPreviewCodeRuntimeFailure(report)) {
        return {
          shouldBlock: true,
          reason: 'visual_validation_preview_not_ready',
          status: report.status,
          topIssues,
          summary: report.summary || '',
          autoRepairable: true,
          retryable: true,
          warning: false,
        };
      }
      return {
        shouldBlock: true,
        reason: 'visual_validation_capture_required',
        status: report.status,
        topIssues,
        summary: report.summary || '',
        autoRepairable: false,
        retryable: false,
        warning: false,
      };
    }

    const finalShouldBlock = infrastructureFailure ? true : shouldBlock;

    return {
      shouldBlock: finalShouldBlock,
      reason: infrastructureFailure
        ? 'visual_validation_capture_unavailable'
        : `visual_validation_${report.status}`,
      status: report.status,
      topIssues,
      summary: report.summary || '',
      autoRepairable: !infrastructureFailure && !briefingSemanticFailure,
      retryable: !infrastructureFailure && !briefingSemanticFailure,
      semanticFailure: briefingSemanticFailure,
    };
  }

  function buildVisualValidationGateMessage(gate = null) {
    if (!gate || !gate.shouldBlock) return '';
    const lines = [
      `A validação visual não liberou a conclusão (${gate.status}).`,
    ];
    if (gate.summary) lines.push(gate.summary);
    if (Array.isArray(gate.topIssues) && gate.topIssues.length) {
      lines.push('Principais pontos visuais:');
      gate.topIssues.forEach((issue) => lines.push(`- ${issue}`));
    }
    if (gate.semanticFailure) {
      lines.push('Vou preservar o checkpoint e bloquear a retentativa automática, porque a falha é de aderência ao briefing e precisa voltar ao contrato/blueprint.');
    } else {
      lines.push(
        gate.autoRepairable === false
          ? 'Vou preservar o checkpoint sem acionar auto-reparo de arquivos, porque a falha está na captura/preview e não no patch em si.'
          : 'Vou preservar o checkpoint para correção incremental orientada pela captura/briefing.'
      );
    }
    return lines.join('\n');
  }

  function buildVisualValidationDiagnosticsHint(report = null) {
    if (!report || !report.required || !Array.isArray(report.issues) || !report.issues.length) return null;
    const issues = report.issues.slice(0, 8).map((issue) => ({
      file: report.capture && report.capture.artifactPath ? report.capture.artifactPath : 'preview',
      severity: issue && issue.severity ? String(issue.severity) : 'warning',
      detail: issue && issue.detail ? String(issue.detail) : report.summary || 'Falha visual detectada.',
      hint: issue && issue.hint ? String(issue.hint) : '',
      source: `visual_validation:${issue && issue.id ? issue.id : 'issue'}`,
    }));
    const errors = issues.filter((issue) => String(issue.severity).toLowerCase() === 'error' || String(issue.severity).toLowerCase() === 'critical').length;
    return {
      summary: {
        total: issues.length,
        errors,
        warnings: issues.length - errors,
      },
      issues,
    };
  }

  return {
    buildVisualValidationDiagnosticsHint,
    buildVisualValidationGateMessage,
    evaluateVisualValidationGate,
    isVisualSurfaceRequest,
    runProjectVisualValidation,
  };
}

module.exports = {
  createProjectVisualValidationRuntimeService,
  isVisualInfrastructureFailure,
  isVisualSurfaceRequest,
  isPreviewCodeRuntimeFailure,
};
