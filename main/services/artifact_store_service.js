const ARTIFACT_STORE_SCHEMA_VERSION = 'faber-artifact-store-v1';
const DEFAULT_ARTIFACT_STORE_DIR = '.faber/artifacts';

function normalizeIdPart(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function summarizeValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => summarizeValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  if (depth >= 5) return '[object]';
  return Object.keys(value).slice(0, 80).reduce((acc, key) => {
    acc[key] = summarizeValue(value[key], depth + 1);
    return acc;
  }, {});
}

function createArtifactStoreService(dependencies = {}) {
  const {
    crypto,
    fs,
    path,
    storeDir = DEFAULT_ARTIFACT_STORE_DIR,
    now = () => new Date().toISOString(),
    idFactory = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Artifact store dependency missing: ${name}`);
  }

  function resolveProjectRoot(input = {}) {
    const projectInfo = input.projectInfo && typeof input.projectInfo === 'object' ? input.projectInfo : {};
    const projectSession = input.projectSession && typeof input.projectSession === 'object' ? input.projectSession : {};
    return String(projectInfo.rootPath || projectSession.rootPath || input.rootPath || '').trim();
  }

  function getStorePaths(input = {}) {
    requireDependency('fs', fs);
    requireDependency('path', path);
    const rootPath = resolveProjectRoot(input);
    if (!rootPath) return { ok: false, message: 'Projeto sem rootPath para artifact store.' };
    const root = path.resolve(rootPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, message: 'Raiz do projeto indisponível para artifact store.' };
    }
    const dir = path.join(root, storeDir);
    return {
      ok: true,
      root,
      dir,
      indexPath: path.join(dir, 'index.jsonl'),
      relativeDir: path.posix.join(...storeDir.split(/[\\/]+/).filter(Boolean)),
    };
  }

  function hashFile(filePath) {
    requireDependency('crypto', crypto);
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
  }

  function storeArtifact(input = {}) {
    const resolved = getStorePaths(input);
    if (!resolved.ok) return { ok: false, message: resolved.message };
    const sourcePath = String(input.sourcePath || input.path || '').trim();
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return { ok: false, message: 'Artefato de origem não encontrado.' };
    }

    const timestamp = now();
    const day = timestamp.slice(0, 10) || 'unknown-date';
    const ext = path.extname(sourcePath) || '.bin';
    const kind = normalizeIdPart(input.kind || input.category || 'artifact') || 'artifact';
    const label = normalizeIdPart(input.label || input.name || path.basename(sourcePath, ext)) || 'artifact';
    const id = `art.${kind}.${normalizeIdPart(idFactory())}`;
    const targetDir = path.join(resolved.dir, day);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${id}.${label}${ext}`);
    fs.copyFileSync(sourcePath, targetPath);
    const stats = fs.statSync(targetPath);
    const sha256 = hashFile(targetPath);
    const relativePath = path.relative(resolved.root, targetPath).split(path.sep).join('/');
    const entry = {
      schemaVersion: ARTIFACT_STORE_SCHEMA_VERSION,
      id,
      createdAt: timestamp,
      kind,
      category: normalizeIdPart(input.category || kind) || kind,
      label: String(input.label || input.name || label),
      project: {
        id: String(input.projectId || input.projectInfo && input.projectInfo.id || input.projectSession && input.projectSession.projectId || ''),
        name: String(input.projectName || input.projectInfo && input.projectInfo.name || input.projectSession && input.projectSession.projectName || ''),
        rootPath: resolved.root,
      },
      jobId: String(input.jobId || input.projectSession && input.projectSession.jobId || ''),
      sourcePath,
      path: targetPath,
      relativePath,
      bytes: stats.size,
      sha256,
      metadata: summarizeValue(input.metadata || null),
    };
    fs.appendFileSync(resolved.indexPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return {
      ok: true,
      entry,
      path: targetPath,
      relativePath,
    };
  }

  function listArtifacts(input = {}) {
    const resolved = getStorePaths(input);
    if (!resolved.ok) return { ok: false, message: resolved.message, artifacts: [] };
    const limit = Math.max(1, Math.min(500, Number(input.limit || 80)));
    if (!fs.existsSync(resolved.indexPath)) {
      return { ok: true, artifacts: [], path: resolved.indexPath };
    }
    const kind = normalizeIdPart(input.kind || '');
    const category = normalizeIdPart(input.category || '');
    const artifacts = fs.readFileSync(resolved.indexPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => (kind ? entry.kind === kind : true))
      .filter((entry) => (category ? entry.category === category : true))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return {
      ok: true,
      path: resolved.indexPath,
      artifacts: artifacts.slice(0, limit),
    };
  }

  return {
    getStorePaths,
    listArtifacts,
    storeArtifact,
  };
}

module.exports = {
  ARTIFACT_STORE_SCHEMA_VERSION,
  DEFAULT_ARTIFACT_STORE_DIR,
  createArtifactStoreService,
};
