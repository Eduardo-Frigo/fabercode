const defaultFs = require('fs');
const defaultPath = require('path');

function createLocalDiagnosticsService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
  } = dependencies;

  function hasEditIntent(userMessage) {
    const normalized = String(userMessage || '').toLowerCase();
    return /\b(edite|editar|altere|alterar|modifique|modificar|corrija|corrigir|crie|criar|adicione|adicionar|remova|remover|refatore|refatorar|implemente|implementar|atualize|atualizar|substitua|substituir|aplique|aplicar|patch|commit)\b/i.test(
      normalized
    );
  }

  function hasProjectEvolutionIntent(userMessage, contextHint = {}) {
    const normalized = String(userMessage || '').toLowerCase().trim();
    if (!normalized) return false;

    const evolutionVerb =
      /\b(continue|continuar|seguir|prossiga|prosseguir|avance|avancar|evolua|evoluir|melhore|melhorar|refine|refinar|ajuste|ajustar|expanda|expandir|incremente|incrementar|complemente|complementar|otimize|otimizar|revis[ea]|corrija|corrigir|adicione|adicionar|inclua|incluir)\b/.test(
        normalized
      );
    const projectObject =
      /\b(site|landing|institucional|plataforma|sistema|app|aplica[cç][aã]o|projeto|p[aá]gina|se[cç][aã]o|layout|frontend|backend|api|crud|dashboard|formul[aá]rio|cta|header|cabe[cç]alho|footer|rodap[eé])\b/.test(
        normalized
      );
    const followupStyle =
      /\b(na mesma conversa|nesse projeto|neste projeto|no projeto|que j[aá] iniciou|j[aá] iniciado|j[aá] criado|vers[aã]o atual|agora|depois disso|pr[oó]ximo ajuste)\b/.test(
        normalized
      ) || normalized.length <= 120;
    const priorCortexFlow =
      Boolean(contextHint && contextHint.lastHadAction) ||
      ['cortex_runtime', 'persona_orchestrator'].includes(
        String((contextHint && contextHint.lastPlanner) || '').toLowerCase()
      ) ||
      String((contextHint && contextHint.lastReason) || '').toLowerCase().startsWith('cortex_');

    if (evolutionVerb && projectObject) return true;
    if (followupStyle && projectObject && priorCortexFlow) return true;
    return false;
  }

  function hasExistingProjectFiles(projectInfo) {
    if (!projectInfo || !Number.isFinite(Number(projectInfo.totalFiles))) return false;
    return Number(projectInfo.totalFiles) > 0;
  }

  function getProjectEntryRelativePath(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry.trim();
    const candidates = [entry.relativePath, entry.relPath, entry.path, entry.filePath, entry.name];
    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) return value.replace(/\\/g, '/');
    }
    return '';
  }

  function listProjectRelativePaths(projectInfo, limit = 260) {
    const rootPath = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    const entries = Array.isArray(projectInfo && projectInfo.files) ? projectInfo.files : [];
    const seen = new Set();
    const paths = [];

    for (const entry of entries) {
      const rel = getProjectEntryRelativePath(entry).replace(/^\/+/, '');
      if (!rel || rel.includes('\0') || rel.split('/').includes('..') || seen.has(rel)) continue;
      seen.add(rel);
      paths.push(rel);
      if (paths.length >= limit) break;
    }

    if (paths.length || !rootPath || !fs.existsSync(rootPath)) return paths;

    const walk = (dir, prefix = '') => {
      if (paths.length >= limit) return;
      let items = [];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const item of items) {
        if (paths.length >= limit) break;
        if (!item || item.name === '.git' || item.name === 'node_modules' || item.name === '.DS_Store') continue;
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) {
          walk(abs, rel);
        } else {
          paths.push(rel);
        }
      }
    };
    walk(rootPath);
    return paths;
  }

  function resolveProjectRelativePathSafe(projectRoot, relPath) {
    const root = String(projectRoot || '').trim();
    const raw = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!root || !raw || raw.includes('\0') || raw.split('/').includes('..')) return null;
    const rootAbs = path.resolve(root);
    const abs = path.resolve(rootAbs, raw);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
    return abs;
  }

  function readProjectTextFileSafe(projectInfo, relPath, maxChars = 24000) {
    const projectRoot = projectInfo && projectInfo.rootPath;
    const abs = resolveProjectRelativePathSafe(projectRoot, relPath);
    if (!abs || !fs.existsSync(abs)) return '';
    const ext = path.extname(abs).toLowerCase();
    const allowed = new Set(['.html', '.htm', '.php', '.css', '.js', '.json', '.md', '.txt', '.tsx', '.ts', '.jsx', '.vue']);
    if (ext && !allowed.has(ext)) return '';
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > 1024 * 1024) return '';
      return fs.readFileSync(abs, 'utf8').slice(0, Math.max(1000, Number(maxChars) || 24000));
    } catch (_) {
      return '';
    }
  }

  function projectRelativeFileExists(projectInfo, relPath) {
    const abs = resolveProjectRelativePathSafe(projectInfo && projectInfo.rootPath, relPath);
    if (!abs) return false;
    try {
      return fs.existsSync(abs) && fs.statSync(abs).isFile();
    } catch (_) {
      return false;
    }
  }

  function extractStylesheetLinksFromHtml(html) {
    const links = [];
    const linkTagRegex = /<link\b[^>]*>/gi;
    let tagMatch;
    while ((tagMatch = linkTagRegex.exec(String(html || '')))) {
      const tag = tagMatch[0];
      if (!/rel\s*=\s*["'][^"']*stylesheet/i.test(tag) && !/rel\s*=\s*stylesheet/i.test(tag)) continue;
      const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i) || tag.match(/href\s*=\s*([^\s>]+)/i);
      if (hrefMatch && hrefMatch[1]) links.push(hrefMatch[1].trim());
    }
    return links;
  }

  function resolveProjectHrefRelative(htmlRelPath, href) {
    const clean = String(href || '').trim().split('#')[0].split('?')[0];
    if (!clean || /^(https?:)?\/\//i.test(clean) || /^(data|mailto|tel):/i.test(clean)) return null;
    if (clean.startsWith('/')) return clean.replace(/^\/+/, '');
    const baseDir = path.posix.dirname(String(htmlRelPath || '').replace(/\\/g, '/'));
    return path.posix.normalize(path.posix.join(baseDir === '.' ? '' : baseDir, clean)).replace(/^\.\//, '');
  }

  function normalizeTextForIntent(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function hasDefaultAuthorizationIntent(userMessage) {
    const normalized = normalizeTextForIntent(userMessage);
    return /\b(sim|pode fazer|pode seguir|siga|seguir|fa[cç]a|manda ver|sugira algo|voc[eê] decide|com defaults|padr[aã]o|pode criar|pode executar)\b/.test(normalized);
  }

  function hasCssOrVisualRepairIntent(userMessage) {
    const normalized = normalizeTextForIntent(userMessage);
    return (
      /\b(css|style\.css|styles\.css|estilo|estilos|visual|apar[eê]ncia|layout|design|sem estilos|quebrado|html est[aá]tico|link do css|carregar.*css|conectar.*css|integrar.*css)\b/.test(normalized) ||
      (/\b(corrigir|arrumar|ajustar|consertar|resolver)\b/.test(normalized) && /\b(html|css|visual|estilo|site|p[aá]gina)\b/.test(normalized))
    );
  }

  function buildLocalProjectDiagnostics({ projectInfo, userMessage = '', attachments = [] } = {}) {
    if (!projectInfo || !projectInfo.rootPath || !hasExistingProjectFiles(projectInfo)) return null;

    const paths = listProjectRelativePaths(projectInfo, 320);
    const htmlFiles = paths.filter((rel) => /\.(html?|php)$/i.test(rel)).slice(0, 12);
    const cssFiles = paths.filter((rel) => /\.css$/i.test(rel)).slice(0, 24);
    const jsFiles = paths.filter((rel) => /\.(js|mjs|ts|tsx|jsx)$/i.test(rel)).slice(0, 18);
    const issues = [];
    const cssLinks = [];
    const brokenStylesheetLinks = [];
    const htmlFilesWithoutStylesheet = [];
    const invalidCssVarRefs = [];
    const placeholderFiles = [];

    for (const htmlRel of htmlFiles) {
      const html = readProjectTextFileSafe(projectInfo, htmlRel, 26000);
      if (!html) continue;
      const links = extractStylesheetLinksFromHtml(html);
      if (!links.length && cssFiles.length) {
        htmlFilesWithoutStylesheet.push(htmlRel);
        issues.push(`${htmlRel} não possui <link rel="stylesheet"> apesar de existir CSS no projeto.`);
      }
      for (const href of links) {
        const resolved = resolveProjectHrefRelative(htmlRel, href);
        cssLinks.push({ html: htmlRel, href, resolved, exists: resolved ? projectRelativeFileExists(projectInfo, resolved) : false });
        if (resolved && !projectRelativeFileExists(projectInfo, resolved)) {
          brokenStylesheetLinks.push({ html: htmlRel, href, resolved });
          issues.push(`${htmlRel} referencia CSS ausente: ${href} -> ${resolved}.`);
        }
      }
      if (/\b(Hero|T[ií]tulo principal|Lista de servi[cç]os com benef[ií]cios|prova social curta|Veterin[aá]rio Respons[aá]vel: Dr\.\s*[çc][aã]o)\b/i.test(html)) {
        placeholderFiles.push(htmlRel);
      }
    }

    for (const cssRel of cssFiles.slice(0, 8)) {
      const css = readProjectTextFileSafe(projectInfo, cssRel, 26000);
      if (!css) continue;
      const matches = css.match(/var\(\s*----[A-Za-z0-9_-]+/g) || [];
      if (matches.length) {
        invalidCssVarRefs.push({ file: cssRel, count: matches.length });
        issues.push(`${cssRel} possui variáveis CSS inválidas com quatro hífens (${matches.length}).`);
      }
    }

    if (placeholderFiles.length) {
      issues.push(`Conteúdo placeholder detectado em ${placeholderFiles.slice(0, 4).join(', ')}.`);
    }

    const cssIntent = hasCssOrVisualRepairIntent(userMessage);
    let suggestedExecutionMessage = String(userMessage || '').trim();
    if (htmlFilesWithoutStylesheet.length && cssFiles.length) {
      suggestedExecutionMessage = `Conecte o CSS existente (${cssFiles[0]}) ao HTML principal (${htmlFilesWithoutStylesheet[0]}) e valide que o estilo carrega no projeto.`;
    } else if (brokenStylesheetLinks.length && cssFiles.length) {
      const issue = brokenStylesheetLinks[0];
      suggestedExecutionMessage = `Corrija o href do stylesheet em ${issue.html}: ele aponta para ${issue.href}, mas o CSS existente provável é ${cssFiles[0]}.`;
    } else if (invalidCssVarRefs.length) {
      suggestedExecutionMessage = `Corrija variáveis CSS inválidas em ${invalidCssVarRefs.map((item) => item.file).join(', ')} sem recriar o projeto.`;
    } else if (cssIntent && cssFiles.length && htmlFiles.length) {
      suggestedExecutionMessage = `Analise ${htmlFiles[0]} e ${cssFiles[0]}, corrija a integração visual/CSS e mantenha edição incremental.`;
    }

    return {
      rootPath: projectInfo.rootPath,
      mode: hasExistingProjectFiles(projectInfo) ? 'edit_project' : 'init_project',
      fileCounts: { total: paths.length, html: htmlFiles.length, css: cssFiles.length, js: jsFiles.length },
      sampleFiles: paths.slice(0, 32),
      htmlFiles,
      cssFiles,
      jsFiles,
      cssLinks: cssLinks.slice(0, 16),
      brokenStylesheetLinks,
      htmlFilesWithoutStylesheet,
      invalidCssVarRefs,
      placeholderFiles,
      actionableIssues: issues.slice(0, 10),
      hasAttachments: Array.isArray(attachments) && attachments.length > 0,
      cssOrVisualRepairIntent: cssIntent,
      suggestedExecutionMessage,
    };
  }

  function formatLocalProjectDiagnosticsForPrompt(diagnostics) {
    if (!diagnostics) return '';
    const lines = [
      `Modo local sugerido: ${diagnostics.mode}`,
      `Arquivos detectados: ${JSON.stringify(diagnostics.fileCounts)}`,
      diagnostics.htmlFiles.length ? `HTML/PHP: ${diagnostics.htmlFiles.slice(0, 8).join(', ')}` : 'HTML/PHP: nenhum detectado',
      diagnostics.cssFiles.length ? `CSS: ${diagnostics.cssFiles.slice(0, 8).join(', ')}` : 'CSS: nenhum detectado',
    ];
    if (diagnostics.cssLinks.length) {
      lines.push(
        `Links CSS encontrados: ${diagnostics.cssLinks
          .slice(0, 8)
          .map((link) => `${link.html} -> ${link.href} (${link.exists ? 'ok' : 'ausente'})`)
          .join('; ')}`
      );
    }
    if (diagnostics.actionableIssues.length) {
      lines.push(`Achados acionáveis: ${diagnostics.actionableIssues.join(' | ')}`);
    }
    if (diagnostics.suggestedExecutionMessage) {
      lines.push(`Execução técnica sugerida pelo diagnóstico local: ${diagnostics.suggestedExecutionMessage}`);
    }
    return lines.join('\n');
  }

  function shouldForceExecutionFromLocalDiagnostics({
    userMessage = '',
    projectInfo = null,
    localDiagnostics = null,
    contextHint = null,
  } = {}) {
    if (!localDiagnostics || !projectInfo || !hasExistingProjectFiles(projectInfo)) return false;
    const hasActionable = Array.isArray(localDiagnostics.actionableIssues) && localDiagnostics.actionableIssues.length > 0;
    const technicalEdit =
      hasEditIntent(userMessage) ||
      hasProjectEvolutionIntent(userMessage, contextHint, projectInfo) ||
      hasCssOrVisualRepairIntent(userMessage);
    if (technicalEdit && (hasActionable || localDiagnostics.cssOrVisualRepairIntent)) return true;
    const lastHadTechnicalContext = Boolean(contextHint && (contextHint.lastJobContext || contextHint.lastHadAction || contextHint.lastReason));
    if (hasDefaultAuthorizationIntent(userMessage) && hasActionable && lastHadTechnicalContext) return true;
    return false;
  }

  return {
    buildLocalProjectDiagnostics,
    formatLocalProjectDiagnosticsForPrompt,
    hasCssOrVisualRepairIntent,
    hasEditIntent,
    hasExistingProjectFiles,
    hasProjectEvolutionIntent,
    shouldForceExecutionFromLocalDiagnostics,
  };
}

module.exports = {
  createLocalDiagnosticsService,
};
