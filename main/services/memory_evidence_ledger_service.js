const MEMORY_EVIDENCE_LEDGER_SCHEMA_VERSION = 'faber-memory-evidence-ledger-v1';
const DEFAULT_MEMORY_LEDGER_DIR = '.faber/memory';

function clipText(value = '', max = 5000) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeIdPart(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function summarizeValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return clipText(value, 3000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => summarizeValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  if (depth >= 5) return '[object]';
  return Object.keys(value).slice(0, 80).reduce((acc, key) => {
    acc[key] = summarizeValue(value[key], depth + 1);
    return acc;
  }, {});
}

function createMemoryEvidenceLedgerService(dependencies = {}) {
  const {
    fs,
    path,
    ledgerDir = DEFAULT_MEMORY_LEDGER_DIR,
    now = () => new Date().toISOString(),
    idFactory = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Memory evidence ledger dependency missing: ${name}`);
  }

  function resolveProjectRoot(input = {}) {
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : {};
    const projectSession = input.projectSession && typeof input.projectSession === 'object' ? input.projectSession : {};
    return String(projectInfo.rootPath || projectSession.rootPath || input.rootPath || '').trim();
  }

  function resolveLedgerPath(input = {}) {
    requireDependency('fs', fs);
    requireDependency('path', path);
    const rootPath = resolveProjectRoot(input);
    if (!rootPath) return { ok: false, message: 'Projeto sem rootPath para ledger de memória.' };
    const root = path.resolve(rootPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, message: 'Raiz do projeto indisponível para ledger de memória.' };
    }
    const jobId = normalizeIdPart(input.jobId || input.projectSession && input.projectSession.jobId || 'project');
    return {
      ok: true,
      root,
      jobId,
      path: path.join(root, ledgerDir, `${jobId || 'project'}.jsonl`),
      relativePath: path.posix.join(...ledgerDir.split(/[\\/]+/).filter(Boolean), `${jobId || 'project'}.jsonl`),
      dir: path.join(root, ledgerDir),
    };
  }

  function buildEntry(input = {}) {
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : {};
    const projectSession = input.projectSession && typeof input.projectSession === 'object' ? input.projectSession : {};
    return {
      schemaVersion: MEMORY_EVIDENCE_LEDGER_SCHEMA_VERSION,
      id: `mem.${normalizeIdPart(input.action || 'event')}.${normalizeIdPart(idFactory())}`,
      createdAt: now(),
      action: normalizeIdPart(input.action || 'memory_event'),
      ok: input.ok !== undefined ? Boolean(input.ok) : true,
      status: String(input.status || (input.ok === false ? 'failed' : 'succeeded')),
      project: {
        id: String(projectInfo.id || projectSession.projectId || input.projectId || ''),
        name: String(projectInfo.name || projectSession.projectName || ''),
        rootPath: resolveProjectRoot(input),
      },
      jobId: String(input.jobId || projectSession.jobId || ''),
      query: clipText(input.query || '', 1200),
      decision: summarizeValue(input.decision || null),
      contextFrame: summarizeValue(input.contextFrame || null),
      provenance: summarizeValue(input.provenance || null),
      lifecycle: summarizeValue(input.lifecycle || null),
      warnings: Array.isArray(input.warnings) ? input.warnings.map(String).slice(0, 30) : [],
      errors: Array.isArray(input.errors) ? input.errors.map(String).slice(0, 30) : [],
      message: String(input.message || ''),
    };
  }

  function appendMemoryEvidence(input = {}) {
    const resolved = resolveLedgerPath(input);
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

  function readLedgerFile(filePath, max = 50) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
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
      .filter(Boolean);
  }

  function listMemoryEvidence(input = {}) {
    const resolved = resolveLedgerPath(input);
    if (!resolved.ok) return { ok: false, message: resolved.message, entries: [] };
    const limit = Math.max(1, Math.min(500, Number(input.limit || 50)));
    let entries = [];
    if (input.jobId) {
      entries = readLedgerFile(resolved.path, limit);
    } else if (fs.existsSync(resolved.dir)) {
      entries = fs.readdirSync(resolved.dir)
        .filter((fileName) => fileName.endsWith('.jsonl'))
        .flatMap((fileName) => readLedgerFile(path.join(resolved.dir, fileName), limit));
    }
    entries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return {
      ok: true,
      path: resolved.path,
      relativePath: resolved.relativePath,
      entries: entries.slice(0, limit),
    };
  }

  return {
    appendMemoryEvidence,
    listMemoryEvidence,
    resolveLedgerPath,
  };
}

module.exports = {
  DEFAULT_MEMORY_LEDGER_DIR,
  MEMORY_EVIDENCE_LEDGER_SCHEMA_VERSION,
  createMemoryEvidenceLedgerService,
};
