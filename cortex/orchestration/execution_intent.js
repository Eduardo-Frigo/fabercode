function normalizeIntentText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stripNegatedIntentClauses(normalized = '') {
  return String(normalized || '')
    .replace(/\b(?:este|esse|o)\s+projeto\s+nao\s+(?:e|eh|se trata de)\b[^.!?\n]*(?:[.!?\n]|$)/g, ' ')
    .replace(/\bnao\s+(?:e|eh|se trata de|usar|utilizar|use|utilize|reaproveitar|reaproveite|reusar|reuse|misturar|misture|incluir|inclua|trazer|traga)\b[^.!?\n]*(?:[.!?\n]|$)/g, ' ')
    .replace(/\b(?:evitar|evite|excluir|exclua|bloquear|bloqueie|suprimir|suprima|ignorar|ignore)\b[^.!?\n]*(?:[.!?\n]|$)/g, ' ')
    .replace(/\bsem\s+(?:qualquer\s+)?(?:conteudo|conteudo antigo|conteudo previo|conteudos|nomes|marcas|temas|exemplos|referencias)\b[^.!?\n]*(?:[.!?\n]|$)/g, ' ')
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

function isAffirmativeContinuation(userMessage = '') {
  const normalized = normalizeIntentText(userMessage).replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(sim|s|ok|certo|isso|pode|pode sim|pode gerar|gera|gerar|continue|continuar|segue|pode seguir|claro|faca|fazer|manda ver|vamos|prossiga|tente novamente|retente|tanto faz|qualquer|qualquer um|indiferente|tanto fez|voce decide|você decide|o que achar melhor|perfeito|pode executar|executar|rodar|pode rodar|aplicar|pode aplicar|iniciar|pode iniciar)$/.test(normalized)) {
    return true;
  }
  if (/\b(vamos seguir seu plano|siga o plano|seguir o plano|seguir plano|pode seguir com o plano|vamos seguir com o plano|vamos em frente|pode comecar|pode iniciar|pode rodar|pode executar|pode fazer)\b/i.test(normalized)) {
    return true;
  }
  return /^(perfeito|sim|certo|ok)?\s*(pode\s+)?(executar|seguir|rodar|gerar|fazer|aplicar|iniciar|mudar|alterar)(\s+(o\s+que\s+voce\s+sugeriu|com\s+isso|a\s+execucao|o\s+projeto|os\s+arquivos|as\s+alteracoes))?$/i.test(normalized);
}

module.exports = {
  hasAnyScannedFiles,
  hasApplicationSurfaceFiles,
  hasExplicitProjectRebuildIntent,
  isAffirmativeContinuation,
  normalizeIntentText,
  resolveExecutionIntentFromContext,
  stripNegatedIntentClauses,
};
