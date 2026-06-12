const DEFAULT_VISUAL_VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: 1365, height: 768 },
  { id: 'tablet', label: 'Tablet', width: 1024, height: 768 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
];

function normalizeViewportId(value = '', fallback = 'viewport') {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeVisualViewport(viewport = {}, index = 0) {
  const candidate = viewport && typeof viewport === 'object' ? viewport : {};
  const width = Math.max(320, Math.round(Number(candidate.width || 0) || DEFAULT_VISUAL_VIEWPORTS[index]?.width || 1365));
  const height = Math.max(240, Math.round(Number(candidate.height || 0) || DEFAULT_VISUAL_VIEWPORTS[index]?.height || 768));
  const id = normalizeViewportId(candidate.id || candidate.name || candidate.label, `viewport-${index + 1}`);
  const label = String(candidate.label || candidate.name || id).trim() || id;
  return {
    id,
    label,
    width,
    height,
  };
}

function normalizeVisualViewportSet(viewports = null) {
  const source = Array.isArray(viewports) && viewports.length
    ? viewports
    : DEFAULT_VISUAL_VIEWPORTS;
  const seen = new Set();
  return source
    .map((viewport, index) => normalizeVisualViewport(viewport, index))
    .filter((viewport) => {
      const key = `${viewport.id}:${viewport.width}x${viewport.height}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeViewportIssue(issue = {}, viewport = {}) {
  const label = viewport && viewport.label ? String(viewport.label) : 'Viewport';
  const size = viewport && viewport.width && viewport.height ? ` ${viewport.width}x${viewport.height}` : '';
  const detail = String(issue.detail || issue.message || 'Falha visual detectada.');
  return {
    id: String(issue.id || 'viewport_visual_issue'),
    severity: String(issue.severity || 'warning'),
    detail: `[${label}${size}] ${detail}`,
    hint: String(issue.hint || ''),
    viewport: {
      id: String(viewport.id || ''),
      label,
      width: Number(viewport.width || 0),
      height: Number(viewport.height || 0),
    },
  };
}

function summarizeViewportCapture(capture = {}, fallbackViewport = {}) {
  const viewport = capture.viewport || fallbackViewport || {};
  return {
    id: String(viewport.id || ''),
    label: String(viewport.label || viewport.id || 'Viewport'),
    width: Number(viewport.width || capture.width || 0),
    height: Number(viewport.height || capture.height || 0),
    status: capture && capture.ok ? 'captured' : 'capture_failed',
    reason: String(capture.reason || ''),
    path: capture && capture.path ? String(capture.path) : '',
    url: capture && capture.url ? String(capture.url) : '',
    bytes: Number(capture.bytes || 0),
    loadAttempts: Number(capture.loadAttempts || 0),
    loadRetried: Boolean(capture.loadRetried),
    domStability: capture.domStability || null,
    analysis: capture.analysis || null,
    semantic: capture.semantic || null,
    productCoverage: capture.productCoverage || null,
    pageSnapshot: capture.pageSnapshot || null,
    issueCount: Array.isArray(capture.issues) ? capture.issues.length : 0,
  };
}

function summarizeProductCoverageSet(captures = []) {
  const coverages = (Array.isArray(captures) ? captures : [])
    .map((capture) => (capture && capture.productCoverage ? capture.productCoverage : null))
    .filter((coverage) => coverage && coverage.enabled);
  if (!coverages.length) return null;
  const failed = coverages.filter((coverage) => !coverage.passesMinimum);
  const minScore = coverages.reduce((min, coverage) => Math.min(min, Number(coverage.score || 0)), 100);
  return {
    enabled: true,
    passesMinimum: failed.length === 0,
    score: minScore,
    minScore: Math.max(...coverages.map((coverage) => Number(coverage.minScore || 0))),
    viewportCount: coverages.length,
    failedViewportCount: failed.length,
    summary: failed.length
      ? `Cobertura visual de produto falhou em ${failed.length}/${coverages.length} viewport(s).`
      : `Cobertura visual de produto passou em ${coverages.length} viewport(s).`,
    viewports: coverages.map((coverage) => ({
      id: coverage.viewport && coverage.viewport.id ? String(coverage.viewport.id) : '',
      label: coverage.viewport && coverage.viewport.label ? String(coverage.viewport.label) : '',
      score: Number(coverage.score || 0),
      minScore: Number(coverage.minScore || 0),
      passesMinimum: Boolean(coverage.passesMinimum),
      summary: String(coverage.summary || ''),
    })),
  };
}

function buildViewportCaptureSet(captures = []) {
  const captureList = Array.isArray(captures) ? captures : [];
  const viewports = captureList.map((capture) => summarizeViewportCapture(capture));
  const capturedCount = viewports.filter((viewport) => viewport.status === 'captured').length;
  const failedCount = viewports.length - capturedCount;
  const allCaptured = viewports.length > 0 && failedCount === 0;
  const firstCaptured = captureList.find((capture) => capture && capture.ok) || null;
  const issues = captureList.flatMap((capture) => {
    const viewport = capture && capture.viewport ? capture.viewport : {};
    return Array.isArray(capture && capture.issues)
      ? capture.issues.map((issue) => normalizeViewportIssue(issue, viewport))
      : [];
  });

  return {
    ok: allCaptured,
    reason: allCaptured ? 'captured' : 'viewport_capture_failed',
    message: allCaptured
      ? `Preview capturado em ${capturedCount} viewport(s).`
      : `Preview capturado parcialmente: ${capturedCount}/${viewports.length} viewport(s).`,
    url: firstCaptured && firstCaptured.url ? firstCaptured.url : viewports[0]?.url || '',
    path: firstCaptured && firstCaptured.path ? firstCaptured.path : '',
    paths: viewports.map((viewport) => viewport.path).filter(Boolean),
    width: firstCaptured && firstCaptured.width ? firstCaptured.width : 0,
    height: firstCaptured && firstCaptured.height ? firstCaptured.height : 0,
    bytes: viewports.reduce((sum, viewport) => sum + Number(viewport.bytes || 0), 0),
    viewportCount: viewports.length,
    capturedViewportCount: capturedCount,
    failedViewportCount: failedCount,
    viewports,
    analysis: {
      viewportCount: viewports.length,
      capturedViewportCount: capturedCount,
      failedViewportCount: failedCount,
      blankViewportCount: viewports.filter((viewport) => viewport.analysis && viewport.analysis.blankLikely).length,
      horizontalOverflowViewportCount: viewports.filter((viewport) => viewport.analysis && viewport.analysis.horizontalOverflow).length,
      viewportResults: viewports.map((viewport) => ({
        id: viewport.id,
        label: viewport.label,
        width: viewport.width,
        height: viewport.height,
        status: viewport.status,
        path: viewport.path,
        blankLikely: Boolean(viewport.analysis && viewport.analysis.blankLikely),
        horizontalOverflow: Boolean(viewport.analysis && viewport.analysis.horizontalOverflow),
        semanticScore: viewport.semantic ? Number(viewport.semantic.score || 0) : null,
        productCoverageScore: viewport.productCoverage ? Number(viewport.productCoverage.score || 0) : null,
        productCoveragePassed: viewport.productCoverage ? Boolean(viewport.productCoverage.passesMinimum) : null,
      })),
    },
    pageSnapshot: firstCaptured && firstCaptured.pageSnapshot ? firstCaptured.pageSnapshot : null,
    semantic: firstCaptured && firstCaptured.semantic ? firstCaptured.semantic : null,
    productCoverage: summarizeProductCoverageSet(captureList),
    issues,
  };
}

module.exports = {
  DEFAULT_VISUAL_VIEWPORTS,
  buildViewportCaptureSet,
  normalizeVisualViewport,
  normalizeVisualViewportSet,
};
