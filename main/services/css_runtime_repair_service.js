function createCssRuntimeRepairService(dependencies = {}) {
  const {
    fs,
    path,
  } = dependencies;

  function isCssStylesheetRepairRequest(text = '') {
    const normalized = String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const mentionsCss = /\b(css|style\.css|stylesheet|estilo)\b/.test(normalized);
    const mentionsHtml = /\b(html|index\.html|pagina|site|arquivo)\b/.test(normalized);
    const mentionsConnection = /(conect|carreg|link|href|import|nao esta funcionando|nao funciona|corrig)/.test(normalized);
    return mentionsCss && mentionsHtml && mentionsConnection;
  }

  function toPosixPath(filePath = '') {
    return String(filePath || '').split(path.sep).join('/');
  }

  function findProjectRelativeFile(projectRoot, projectInfo, fileName) {
    const directCandidates = [fileName, `public/${fileName}`, `src/${fileName}`, `pages/${fileName}`];
    for (const candidate of directCandidates) {
      if (fs.existsSync(path.join(projectRoot, candidate))) return candidate;
    }
    const files = Array.isArray(projectInfo && projectInfo.files) ? projectInfo.files : [];
    const match = files.find((item) => {
      const rel = typeof item === 'string' ? item : item && (item.path || item.relativePath || item.name);
      return rel && path.basename(rel) === fileName;
    });
    if (!match) return null;
    const rel = typeof match === 'string' ? match : match.path || match.relativePath || match.name;
    return rel ? toPosixPath(rel) : null;
  }

  function normalizeRelativeHref(fromFile, toFile) {
    const fromDir = path.posix.dirname(toPosixPath(fromFile));
    let href = path.posix.relative(fromDir === '.' ? '' : fromDir, toPosixPath(toFile));
    if (!href || href === '') href = path.posix.basename(toFile);
    if (!href.startsWith('.') && !href.startsWith('/')) href = `./${href}`;
    return href;
  }

  function escapeRegExpLiteral(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function replaceStylesheetHref(html, fromHref, toHref) {
    const source = String(html || '');
    const escapedFrom = escapeRegExpLiteral(fromHref);
    const patterns = [
      new RegExp(`(<link\\b[^>]*rel=["']?stylesheet["']?[^>]*href=["'])${escapedFrom}(["'][^>]*>)`, 'i'),
      new RegExp(`(<link\\b[^>]*href=["'])${escapedFrom}(["'][^>]*rel=["']?stylesheet["']?[^>]*>)`, 'i'),
    ];
    for (const pattern of patterns) {
      const next = source.replace(pattern, `$1${toHref}$2`);
      if (next !== source) return { changed: true, content: next };
    }
    return { changed: false, content: source };
  }

  function ensureHtmlHasStylesheetLink(html, href) {
    const source = String(html || '');
    const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingStyleLink = new RegExp(`<link\\b[^>]*rel=["']?stylesheet["']?[^>]*href=["'][^"']*style\\.css["'][^>]*>`, 'i');
    const exactLink = `<link rel="stylesheet" href="${href}">`;

    if (existingStyleLink.test(source)) {
      const next = source.replace(existingStyleLink, exactLink);
      return { changed: next !== source, content: next };
    }

    const alreadyExact = new RegExp(`<link\\b[^>]*href=["']${escapedHref}["'][^>]*rel=["']?stylesheet["']?[^>]*>|<link\\b[^>]*rel=["']?stylesheet["']?[^>]*href=["']${escapedHref}["'][^>]*>`, 'i');
    if (alreadyExact.test(source)) return { changed: false, content: source };

    const line = `  ${exactLink}\n`;
    if (/<\/head>/i.test(source)) {
      return { changed: true, content: source.replace(/<\/head>/i, `${line}</head>`) };
    }
    if (/<head\b[^>]*>/i.test(source)) {
      return { changed: true, content: source.replace(/<head\b[^>]*>/i, (match) => `${match}\n${line.trimEnd()}`) };
    }
    if (/<html\b[^>]*>/i.test(source)) {
      return {
        changed: true,
        content: source.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>\n  <meta charset="UTF-8">\n${line}</head>`),
      };
    }
    return {
      changed: true,
      content: `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8">\n${line}</head>\n<body>\n${source}\n</body>\n</html>\n`,
    };
  }

  function isCssRuntimeRepairRequest(text = '') {
    const normalized = String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const mentionsCss = /\b(css|style\.css|stylesheet|estilo|estilos|visual|cores|tipografia)\b/.test(normalized);
    const mentionsProblem = /(quebrad|sem estilo|sem estilos|html estatico|nao esta funcionando|nao funciona|nao carrega|carreg|conect|corrig|arrum|visual)/.test(normalized);
    return mentionsCss && mentionsProblem;
  }

  function repairInvalidCssCustomPropertyReferences(css = '') {
    const source = String(css || '');
    let replacements = 0;
    const content = source.replace(/var\(\s*-{3,}([a-zA-Z0-9_-]+)(\s*,[^)]*)?\s*\)/g, (_match, name, fallback = '') => {
      replacements += 1;
      return `var(--${name}${fallback || ''})`;
    });
    return {
      changed: content !== source,
      content,
      replacements,
    };
  }

  function buildCssRuntimeRepairOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent, reason = 'css_runtime_repair' }) {
    if (executionIntent !== 'edit_project') return null;
    const projectRoot = projectInfo && projectInfo.rootPath;
    if (!projectRoot) return null;

    const styleRel = findProjectRelativeFile(projectRoot, projectInfo, 'style.css');
    if (!styleRel) return null;

    const styleAbs = path.join(projectRoot, styleRel);
    if (!fs.existsSync(styleAbs)) return null;

    const currentCss = fs.readFileSync(styleAbs, 'utf8');
    const result = repairInvalidCssCustomPropertyReferences(currentCss);
    if (!result.changed) return null;

    const linkAlreadyOkNote = reason === 'css_link_already_ok_css_runtime_repair'
      ? 'O link do CSS ja estava presente; encontrei a raiz do problema no proprio CSS. '
      : '';

    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: styleRel,
        operations: [
          {
            op: 'write_file',
            path: styleRel,
            content: result.content,
          },
        ],
        diffPreview: `Corrigir ${result.replacements} referencia(s) invalida(s) de variaveis CSS em ${styleRel}.`,
        summary: `${linkAlreadyOkNote}Corrigir referencias invalidas de variaveis CSS em ${styleRel} para o navegador aplicar cores, fundos e tipografia corretamente.`,
        userMessage,
        attachments,
        generatedBy: 'automata_static_css_runtime_repair',
      },
      raw: reason,
    };
  }

  return {
    buildCssRuntimeRepairOperationBatch,
    ensureHtmlHasStylesheetLink,
    findProjectRelativeFile,
    isCssRuntimeRepairRequest,
    isCssStylesheetRepairRequest,
    normalizeRelativeHref,
    repairInvalidCssCustomPropertyReferences,
    replaceStylesheetHref,
  };
}

module.exports = {
  createCssRuntimeRepairService,
};
