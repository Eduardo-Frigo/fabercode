function normalizeIntentText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProjectFiles(projectInfo = {}) {
  return (Array.isArray(projectInfo && projectInfo.files) ? projectInfo.files : [])
    .map((entry) => String(entry || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
    .filter(Boolean);
}

function hasExplicitProjectRebuildIntent(userMessage) {
  const normalized = normalizeIntentText(userMessage);
  if (!normalized) return false;
  return /\b(recomecar|reiniciar|resetar|refazer|recriar|do zero|zerar|sobrescrever tudo|apagar tudo|novo scaffold|regerar inteiro)\b/.test(
    normalized
  );
}

function hasApplicationSurfaceFiles(projectInfo = {}) {
  const files = normalizeProjectFiles(projectInfo);
  if (!files.length) return false;

  return files.some((relPath) => {
    const fileName = relPath.split('/').pop() || '';
    if (!fileName || fileName.startsWith('.')) return false;
    if (/^(readme|license|changelog)(\.[a-z0-9]+)?$/i.test(fileName)) return false;
    if (/^(package|composer)\.json$/i.test(fileName)) return true;
    if (/^(index|main|app)\.(html?|php|js|mjs|ts|tsx|jsx|vue)$/i.test(fileName)) return true;
    if (/^(src|app|pages|components|public|assets|lib|server|api)\//i.test(relPath)) return true;
    return /\.(html?|php|css|js|mjs|ts|tsx|jsx|vue|py|java)$/i.test(fileName);
  });
}

function hasAnyScannedFiles(projectInfo = {}) {
  return Number.isFinite(Number(projectInfo && projectInfo.totalFiles)) && Number(projectInfo.totalFiles) > 0;
}

function resolveExecutionIntentFromContext({
  userMessage = '',
  contextHint = {},
  projectInfo = null,
  hasScaffoldIntent = () => false,
  hasEditIntent = () => false,
  hasProjectEvolutionIntent = () => false,
} = {}) {
  const normalized = normalizeIntentText(userMessage);
  const scaffoldIntent = Boolean(hasScaffoldIntent(normalized));
  const evolutionIntent = Boolean(hasProjectEvolutionIntent(normalized, contextHint, projectInfo));
  const editIntent = Boolean(hasEditIntent(normalized) || evolutionIntent);
  const explicitRebuild = hasExplicitProjectRebuildIntent(normalized);
  const hasAppFiles = hasApplicationSurfaceFiles(projectInfo);
  const hasFiles = hasAnyScannedFiles(projectInfo);

  if (hasAppFiles && !explicitRebuild) return 'edit_project';
  if (scaffoldIntent) return 'init_project';
  if (hasFiles && !explicitRebuild) return 'edit_project';
  if (editIntent) return 'edit_project';
  return scaffoldIntent ? 'init_project' : 'edit_project';
}

module.exports = {
  hasAnyScannedFiles,
  hasApplicationSurfaceFiles,
  hasExplicitProjectRebuildIntent,
  normalizeIntentText,
  resolveExecutionIntentFromContext,
};
