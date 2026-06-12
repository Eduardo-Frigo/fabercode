const CAPABILITY_EVIDENCE_LEDGER_SCHEMA_VERSION = 'faber-capability-evidence-ledger-v1';
const DEFAULT_LEDGER_DIR = '.faber/capabilities';

function clipText(value = '', maxChars = 8000) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function normalizeIdPart(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeList(value = []) {
  return Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
}

function summarizeData(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return clipText(value, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((entry) => summarizeData(entry, depth + 1));
  }
  if (typeof value !== 'object') return String(value);
  if (depth >= 5) return '[object]';
  return Object.keys(value).slice(0, 80).reduce((acc, key) => {
    acc[key] = summarizeData(value[key], depth + 1);
    return acc;
  }, {});
}

function createCapabilityEvidenceLedgerService(dependencies = {}) {
  const {
    fs,
    path,
    ledgerDir = DEFAULT_LEDGER_DIR,
    now = () => new Date().toISOString(),
    idFactory = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Capability evidence ledger dependency missing: ${name}`);
  }

  function resolveLedgerPath(projectSession = {}, capability = '') {
    requireDependency('fs', fs);
    requireDependency('path', path);
    const rootPath = String(projectSession.rootPath || '').trim();
    if (!rootPath) return { ok: false, message: 'Projeto sem rootPath para ledger de capability.' };
    const root = path.resolve(rootPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, message: 'Raiz do projeto indisponível para ledger de capability.' };
    }
    const capabilityId = normalizeIdPart(capability) || 'unknown';
    return {
      ok: true,
      root,
      path: path.join(root, ledgerDir, `${capabilityId}.jsonl`),
      relativePath: path.posix.join(...ledgerDir.split(/[\\/]+/).filter(Boolean), `${capabilityId}.jsonl`),
    };
  }

  function summarizePatch(patch = {}) {
    const operations = Array.isArray(patch.operations)
      ? patch.operations.map((operation) => ({
          op: operation.op || '',
          path: operation.path || '',
          bytes: Number(operation.bytes || 0),
        }))
      : [];
    return {
      generatedBy: patch.generatedBy || '',
      targetFile: patch.targetFile || '',
      operations,
      diffPreview: clipText(patch.diffPreview || '', 8000),
      microContract: patch.microContract || null,
      classification: patch.classification || null,
      validation: patch.validation || null,
      evidence: patch.evidence || null,
    };
  }

  function buildEntry(input = {}) {
    const projectSession = input.projectSession || {};
    return {
      schemaVersion: CAPABILITY_EVIDENCE_LEDGER_SCHEMA_VERSION,
      id: `cap.${normalizeIdPart(input.capability || 'unknown')}.${normalizeIdPart(idFactory())}`,
      createdAt: now(),
      capability: normalizeIdPart(input.capability || ''),
      action: normalizeIdPart(input.action || ''),
      status: String(input.status || (input.ok ? 'succeeded' : 'failed')),
      ok: Boolean(input.ok),
      source: String(input.source || 'capability_adapter'),
      project: {
        id: String(projectSession.projectId || ''),
        name: String(projectSession.projectName || ''),
        rootPath: String(projectSession.rootPath || ''),
      },
      jobId: String(input.jobId || projectSession.jobId || ''),
      requestId: String(input.requestId || ''),
      request: {
        userMessagePreview: clipText(input.userMessage || '', 1000),
      },
      patch: input.patch ? summarizePatch(input.patch) : null,
      data: input.data && typeof input.data === 'object' ? summarizeData(input.data) : null,
      applied: normalizeList(input.applied),
      artifacts: normalizeList(input.artifacts),
      warnings: normalizeList(input.warnings),
      errors: normalizeList(input.errors),
      message: String(input.message || ''),
    };
  }

  function appendCapabilityEvidence(input = {}) {
    const capability = input.capability || 'unknown';
    const resolved = resolveLedgerPath(input.projectSession || {}, capability);
    if (!resolved.ok) return { ok: false, message: resolved.message };
    const entry = buildEntry(input);
    fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
    fs.appendFileSync(resolved.path, `${JSON.stringify(entry)}\n`, 'utf8');
    return {
      ok: true,
      path: resolved.path,
      relativePath: resolved.relativePath,
      entry,
    };
  }

  function listCapabilityEvidence({ projectSession = {}, capability = '', limit = 50 } = {}) {
    const resolved = resolveLedgerPath(projectSession, capability);
    if (!resolved.ok) return { ok: false, message: resolved.message, entries: [] };
    if (!fs.existsSync(resolved.path)) {
      return { ok: true, path: resolved.path, relativePath: resolved.relativePath, entries: [] };
    }
    const max = Math.max(1, Math.min(500, Number(limit) || 50));
    const entries = fs.readFileSync(resolved.path, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-max)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
    return { ok: true, path: resolved.path, relativePath: resolved.relativePath, entries };
  }

  return {
    appendCapabilityEvidence,
    listCapabilityEvidence,
    resolveLedgerPath,
  };
}

module.exports = {
  CAPABILITY_EVIDENCE_LEDGER_SCHEMA_VERSION,
  DEFAULT_LEDGER_DIR,
  createCapabilityEvidenceLedgerService,
};
