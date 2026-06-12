const VISUAL_VALIDATION_SCHEMA_VERSION = 'visual-validation-v1';

function normalizeIssue(issue = {}) {
  return {
    id: String(issue.id || 'visual_issue'),
    severity: String(issue.severity || 'warning'),
    detail: String(issue.detail || ''),
    hint: String(issue.hint || ''),
  };
}

function normalizeCaptureIssue(issue = {}) {
  return {
    id: String(issue.id || issue.source || 'capture_issue'),
    severity: String(issue.severity || 'warning'),
    detail: String(issue.detail || issue.message || ''),
    hint: String(issue.hint || ''),
  };
}

function isBlockingIssue(issue = {}) {
  const severity = String(issue.severity || '').toLowerCase();
  return severity === 'critical' || severity === 'error';
}

function summarizeViewportEvidence(capture = null) {
  const analysis = capture && capture.analysis && typeof capture.analysis === 'object' ? capture.analysis : {};
  const viewportCount = Number(capture && capture.viewportCount ? capture.viewportCount : analysis.viewportCount || 0);
  const capturedViewportCount = Number(capture && capture.capturedViewportCount ? capture.capturedViewportCount : analysis.capturedViewportCount || 0);
  const failedViewportCount = Number(capture && capture.failedViewportCount ? capture.failedViewportCount : analysis.failedViewportCount || 0);
  return {
    viewportCount,
    capturedViewportCount,
    failedViewportCount,
    label: viewportCount ? `${capturedViewportCount}/${viewportCount} viewport(s)` : '',
  };
}

function buildVisualValidationReport({
  technicalChecksPassed = false,
  technicalScore = 0,
  minTechnicalScore = 0,
  artifactQuality = null,
  capture = null,
  preview = null,
} = {}) {
  const visualRequired = Boolean(artifactQuality && artifactQuality.enabled);
  const captureStatus = capture
    ? capture.ok
      ? 'captured'
      : 'capture_failed'
    : 'not_run';
  const previewStatus = preview
    ? preview.ok || preview.ready
      ? 'ready'
      : 'failed'
    : 'not_run';

  if (!visualRequired) {
    return {
      schemaVersion: VISUAL_VALIDATION_SCHEMA_VERSION,
      required: false,
      status: 'not_required',
      passesMinimum: true,
      technicalChecksPassed: Boolean(technicalChecksPassed),
      technicalScore: Number(technicalScore || 0),
      minTechnicalScore: Number(minTechnicalScore || 0),
      capture: { status: captureStatus, artifactPath: capture && capture.path ? String(capture.path) : '' },
      preview: { status: previewStatus, url: preview && preview.url ? String(preview.url) : '' },
      issues: [],
      summary: 'Validação visual não exigida para este tipo de alteração.',
    };
  }

  const visualIssues = Array.isArray(artifactQuality.issues)
    ? artifactQuality.issues.map(normalizeIssue).filter((issue) => issue.detail)
    : [];
  const captureIssues = Array.isArray(capture && capture.issues)
    ? capture.issues.map(normalizeCaptureIssue).filter((issue) => issue.detail)
    : [];
  const issues = [...visualIssues, ...captureIssues];
  const staticVisualPassed = Boolean(artifactQuality.passesMinimum);
  const captured = captureStatus === 'captured';
  const captureFailed = captureStatus === 'capture_failed';
  const captureBlockingIssue = captureIssues.some(isBlockingIssue);
  const viewportEvidence = summarizeViewportEvidence(capture);
  const status = (!staticVisualPassed || captureFailed || captureBlockingIssue)
    ? 'failed'
    : captured
      ? 'passed'
      : 'not_captured';
  const fullVisualPassed = Boolean(status === 'passed' && staticVisualPassed && captured && !captureBlockingIssue);
  const firstIssue = issues[0] || null;
  const technicalText = technicalChecksPassed
    ? `Tecnicamente passou (${Number(technicalScore || 0)}%, mínimo ${Number(minTechnicalScore || 0)}%).`
    : `Tecnicamente ainda não passou (${Number(technicalScore || 0)}%, mínimo ${Number(minTechnicalScore || 0)}%).`;
  const visualText = status === 'passed'
    ? `Visualmente passou com captura real${viewportEvidence.label ? ` em ${viewportEvidence.label}` : ''} (${artifactQuality.score}%, mínimo ${artifactQuality.minScore}%).`
    : status === 'not_captured'
      ? `Validação visual pendente: a análise estática atingiu ${artifactQuality.score}% (mínimo ${artifactQuality.minScore}%), mas ainda não houve captura real de preview.`
      : captureFailed
        ? `Visualmente falhou: não consegui capturar o preview${viewportEvidence.label ? ` em todos os viewports (${viewportEvidence.label})` : ''}${firstIssue ? ` (${firstIssue.detail})` : '.'}`
      : `Visualmente falhou${firstIssue ? `: ${firstIssue.detail}` : ` (${artifactQuality.score}%, mínimo ${artifactQuality.minScore}%).`}`;

  return {
    schemaVersion: VISUAL_VALIDATION_SCHEMA_VERSION,
    required: true,
    status,
    passesMinimum: fullVisualPassed,
    staticPassesMinimum: staticVisualPassed,
    technicalChecksPassed: Boolean(technicalChecksPassed),
    technicalScore: Number(technicalScore || 0),
    minTechnicalScore: Number(minTechnicalScore || 0),
    capture: {
      status: captureStatus,
      artifactPath: capture && capture.path ? String(capture.path) : '',
      artifactPaths: Array.isArray(capture && capture.paths) ? capture.paths.map(String) : [],
      viewportCount: viewportEvidence.viewportCount,
      capturedViewportCount: viewportEvidence.capturedViewportCount,
      failedViewportCount: viewportEvidence.failedViewportCount,
      viewports: Array.isArray(capture && capture.viewports)
        ? capture.viewports.map((viewport) => ({
            id: String(viewport.id || ''),
            label: String(viewport.label || ''),
            width: Number(viewport.width || 0),
            height: Number(viewport.height || 0),
            status: String(viewport.status || ''),
            path: String(viewport.path || ''),
            issueCount: Number(viewport.issueCount || 0),
            analysis: viewport.analysis || null,
            semantic: viewport.semantic
              ? {
                  score: Number(viewport.semantic.score || 0),
                  minScore: Number(viewport.semantic.minScore || 0),
                  passesMinimum: Boolean(viewport.semantic.passesMinimum),
                  summary: String(viewport.semantic.summary || ''),
                }
              : null,
            productCoverage: viewport.productCoverage
              ? {
                  score: Number(viewport.productCoverage.score || 0),
                  minScore: Number(viewport.productCoverage.minScore || 0),
                  passesMinimum: Boolean(viewport.productCoverage.passesMinimum),
                  summary: String(viewport.productCoverage.summary || ''),
                }
              : null,
          }))
        : [],
      note: captured
        ? `Preview capturado${viewportEvidence.label ? ` em ${viewportEvidence.label}` : ''}.`
        : captureFailed
          ? 'Falha ao capturar preview nesta etapa.'
          : 'Captura visual ainda não executada nesta etapa.',
      analysis: capture && capture.analysis ? capture.analysis : null,
      semantic: capture && capture.semantic ? capture.semantic : null,
      productCoverage: capture && capture.productCoverage ? capture.productCoverage : null,
    },
    preview: {
      status: previewStatus,
      url: preview && preview.url ? String(preview.url) : '',
    },
    artifactQuality: {
      score: Number(artifactQuality.score || 0),
      minScore: Number(artifactQuality.minScore || 0),
      passesMinimum: Boolean(artifactQuality.passesMinimum),
      criticalFailures: Array.isArray(artifactQuality.criticalFailures) ? artifactQuality.criticalFailures : [],
    },
    issues,
    summary: `${technicalText} ${visualText}`,
  };
}

module.exports = {
  VISUAL_VALIDATION_SCHEMA_VERSION,
  buildVisualValidationReport,
};
