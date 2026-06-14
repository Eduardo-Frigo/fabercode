const FABER_CAPABILITY_CONTRACT_VERSION = 'faber-capability-contract-v1';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeCapabilityId(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function compactArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeProjectSession(projectSession = {}) {
  const rootPath = normalizeText(projectSession.rootPath);
  return {
    id: normalizeText(projectSession.id) || (rootPath ? `project:${rootPath}` : 'project:unknown'),
    rootPath,
    realRootPath: normalizeText(projectSession.realRootPath),
    projectId: normalizeText(projectSession.projectId),
    projectName: normalizeText(projectSession.projectName),
    jobId: normalizeText(projectSession.jobId),
    cwd: normalizeText(projectSession.cwd) || rootPath,
    source: normalizeText(projectSession.source) || 'faber_code',
  };
}

function normalizeCapabilityEvidence(input = {}) {
  const startedAt = normalizeText(input.startedAt) || new Date().toISOString();
  const finishedAt = normalizeText(input.finishedAt) || startedAt;
  const capability = normalizeCapabilityId(input.capability);
  const action = normalizeCapabilityId(input.action);
  const ok = Boolean(input.ok);
  const errors = compactArray(input.errors);
  const warnings = compactArray(input.warnings);

  return {
    schemaVersion: FABER_CAPABILITY_CONTRACT_VERSION,
    ok,
    status: normalizeText(input.status) || (ok ? 'succeeded' : 'failed'),
    capability,
    action,
    source: normalizeText(input.source) || 'local_adapter',
    message: normalizeText(input.message),
    projectSession: normalizeProjectSession(input.projectSession),
    artifacts: compactArray(input.artifacts),
    logs: compactArray(input.logs),
    warnings,
    errors,
    startedAt,
    finishedAt,
    data: input.data && typeof input.data === 'object' ? input.data : {},
  };
}

function buildCapabilityResult(input = {}) {
  const evidence = normalizeCapabilityEvidence(input);
  return {
    ok: evidence.ok,
    schemaVersion: evidence.schemaVersion,
    capability: evidence.capability,
    action: evidence.action,
    status: evidence.status,
    message: evidence.message,
    projectSession: evidence.projectSession,
    evidence,
    data: evidence.data,
    result: input.result && typeof input.result === 'object' ? input.result : {},
  };
}

module.exports = {
  FABER_CAPABILITY_CONTRACT_VERSION,
  buildCapabilityResult,
  normalizeCapabilityEvidence,
  normalizeCapabilityId,
  normalizeProjectSession,
};
