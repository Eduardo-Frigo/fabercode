const crypto = require('crypto');
const path = require('path');

function safeHash(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function normalizeRootPath(value = '') {
  return path.resolve(String(value || '').trim());
}

function buildProjectSession(input = {}) {
  const rootPath = input.rootPath ? normalizeRootPath(input.rootPath) : '';
  const realRootPath = input.realRootPath ? normalizeRootPath(input.realRootPath) : '';
  const projectId = String(input.projectId || '').trim() || (rootPath ? safeHash(rootPath) : '');
  const projectName = String(input.projectName || '').trim() || (rootPath ? path.basename(rootPath) : '');
  const jobId = String(input.jobId || '').trim();
  return {
    id: String(input.id || '').trim() || (projectId ? `project-session:${projectId}` : 'project-session:unknown'),
    rootPath,
    realRootPath,
    projectId,
    projectName,
    jobId,
    cwd: input.cwd ? normalizeRootPath(input.cwd) : rootPath,
    source: String(input.source || 'faber_code').trim(),
    createdAt: String(input.createdAt || new Date().toISOString()),
  };
}

function isInsideRoot(rootPath, candidatePath) {
  const root = normalizeRootPath(rootPath);
  const candidate = normalizeRootPath(candidatePath);
  return candidate === root || candidate.startsWith(root + path.sep);
}

function validateProjectSessionScope(projectSession = {}) {
  const rootPath = String(projectSession.rootPath || '').trim();
  const cwd = String(projectSession.cwd || rootPath || '').trim();
  if (!rootPath) {
    return { ok: false, message: 'Capability sem raiz de projeto autorizada.' };
  }
  if (cwd && !isInsideRoot(rootPath, cwd)) {
    return { ok: false, message: 'Capability bloqueada: cwd fora da raiz do projeto.' };
  }
  return { ok: true };
}

module.exports = {
  buildProjectSession,
  isInsideRoot,
  validateProjectSessionScope,
};
