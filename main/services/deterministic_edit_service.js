const defaultFs = require('fs');
const defaultPath = require('path');

const {
  normalizeText,
  escapeHtmlText,
  escapeJsString,
  defaultNormalizeRequestedRelativePath,
  extractQuotedTextAfterMarker,
  extractRequestedTitle,
  expandShortHex,
  darkenHex,
  extractRequestedColor,
  resolveColorKeyword,
  extractRequestedTargetColor,
  listRequestedSourceColorFamilies,
  sourceColorFamilyPattern,
  extractTargetColorForSourceFamily,
  escapeRegExp,
  extractLiteralColorReplacementIntent,
  isLiteralColorReplacementRequest,
  isButtonColorEditRequest,
  isThemeColorEditRequest,
  extractSemanticColorEditIntent,
  isSemanticColorEditRequest,
  isFooterInsertRequest,
  isHydrationMismatchRepairRequest,
  replaceFirstSimpleTagInner,
  replaceHtmlDocumentTitle,
  replaceMetadataTitle,
  updateTitleContent,
  isHeadingColorEditRequest,
  extractHeadingColorValue,
  replaceHeadingColorClass,
  updateHeadingColorContent,
  ensureNextLayoutSuppressHydrationWarning,
  replaceCssVariable,
  updateAccentColorCss,
  replaceLiteralColor,
  hexToRgb,
  getHue,
  getLuminance,
  isHexColorFamily,
  replaceSemanticHexFamily,
  replaceTailwindSemanticColorClasses,
  updateSemanticColorContent,
  updateFirstButtonColorClass,
  extractBrandFromContent,
  buildNextFooterBlock,
  insertFooterIntoNextPage,
  buildHtmlFooterBlock,
  insertFooterIntoHtml,
  extractBackgroundColor,
  replaceCssVariableIfPresent,
  updateBackgroundColorCss,
  extractTypographyIntent,
  isTypographyEditRequest,
  fontImportName,
  fontStack,
  buildGoogleFontImport,
  ensureGoogleFontImport,
  replaceOrAppendCssRule,
  updateTypographyCss,
  uniqueList,
} = require('./deterministic_edit_helpers');

function createDeterministicEditService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    buildOperationBatchDiffPreview = () => '',
    normalizeRequestedRelativePath = defaultNormalizeRequestedRelativePath,
  } = dependencies;

  function collectExistingTitleCandidates(projectInfo = {}) {
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    const files = Array.isArray(projectInfo && projectInfo.files)
      ? projectInfo.files.map((entry) => String(entry || '').replace(/\\/g, '/')).filter(Boolean)
      : [];
    const priority = [
      'app/page.tsx',
      'src/app/page.tsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'app/page.jsx',
      'pages/index.jsx',
      'src/pages/index.jsx',
      'index.html',
      'index.php',
      'app/layout.tsx',
      'src/app/layout.tsx',
    ];
    const fromFiles = files.filter((rel) =>
      /(^|\/)(index\.(html|php)|page\.(tsx|jsx)|layout\.(tsx|jsx))$/i.test(rel)
    );
    return uniqueList([...priority, ...fromFiles])
      .map((rel) => normalizeRequestedRelativePath(rel))
      .filter((rel) => rel && projectRoot && fs.existsSync(path.join(projectRoot, rel)));
  }

  function collectExistingCandidates(projectInfo = {}, candidates = []) {
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    const files = Array.isArray(projectInfo && projectInfo.files)
      ? projectInfo.files.map((entry) => String(entry || '').replace(/\\/g, '/')).filter(Boolean)
      : [];
    return uniqueList([...candidates, ...files])
      .map((rel) => normalizeRequestedRelativePath(rel))
      .filter((rel) => rel && projectRoot && fs.existsSync(path.join(projectRoot, rel)));
  }

  function buildTitleEditOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent = 'edit_project' } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const nextTitle = extractRequestedTitle(userMessage);
    if (!nextTitle) return null;

    const operations = [];
    const touchedKinds = [];
    for (const relPath of collectExistingTitleCandidates(projectInfo)) {
      const absPath = path.join(projectRoot, relPath);
      let current = '';
      try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile() || stat.size > 700000) continue;
        current = fs.readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      const result = updateTitleContent(current, nextTitle, relPath);
      if (!result.changed || result.content === current) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
      touchedKinds.push(...result.changes);
    }

    if (!operations.length) return null;
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Alterar o título principal/metadados para "${nextTitle}" sem recriar o projeto.`,
        humanSummary: `Título atualizado para "${nextTitle}".`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_title_edit_patch',
      },
      raw: `deterministic_title_edit_patch:${uniqueList(touchedKinds).join(',') || 'title'}`,
    };
  }

  function readTextFile(projectRoot, relPath) {
    const absPath = path.join(projectRoot, relPath);
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > 700000) return null;
    return fs.readFileSync(absPath, 'utf8');
  }

  function buildHeadingColorOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent = 'edit_project' } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isHeadingColorEditRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;
    const target = extractHeadingColorValue(userMessage);
    if (!target) return null;

    const operations = [];
    const pageCandidates = collectExistingCandidates(projectInfo, [
      'app/page.tsx',
      'src/app/page.tsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'app/page.jsx',
      'pages/index.jsx',
      'src/pages/index.jsx',
      'index.html',
      'index.php',
    ]);
    for (const relPath of pageCandidates) {
      if (!/\.(tsx|jsx|html|php)$/i.test(relPath)) continue;
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = updateHeadingColorContent(current, target, relPath);
      if (!result.changed || result.content === current) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
      break;
    }

    if (!operations.length) return null;
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Ajustar a cor do H1 para ${target.label} sem alterar o texto.`,
        humanSummary: `Cor do H1 ajustada para ${target.label}.`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_heading_color_patch',
      },
      raw: `deterministic_heading_color_patch:${target.label}`,
    };
  }

  function buildHydrationMismatchOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent = 'edit_project' } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isHydrationMismatchRepairRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    for (const relPath of collectExistingCandidates(projectInfo, ['app/layout.tsx', 'src/app/layout.tsx'])) {
      if (!/(^|\/)layout\.(tsx|jsx)$/.test(relPath)) continue;
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = ensureNextLayoutSuppressHydrationWarning(current, relPath);
      if (!result.changed) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
    }

    if (!operations.length) return null;
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: 'Mitigar warning de hidratação causado por atributos externos no body/html durante preview Next.js.',
        humanSummary: 'Mitigação de hidratação aplicada ao layout Next.js.',
        userMessage,
        attachments,
        generatedBy: 'deterministic_next_hydration_patch',
      },
      raw: 'deterministic_next_hydration_patch',
    };
  }

  function collectColorReplacementCandidates(projectInfo = {}) {
    return collectExistingCandidates(projectInfo, [
      'app/globals.css',
      'src/app/globals.css',
      'style.css',
      'styles.css',
      'src/styles.css',
      'app/page.tsx',
      'src/app/page.tsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'app/layout.tsx',
      'src/app/layout.tsx',
      'index.html',
      'index.php',
    ]).filter((relPath) => {
      if (/package-lock\.json$/i.test(relPath)) return false;
      return /\.(css|scss|sass|tsx|jsx|ts|js|html|php)$/i.test(relPath);
    });
  }

  function buildLiteralColorReplacementOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const intent = extractLiteralColorReplacementIntent(userMessage);
    if (!intent) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    let replacementCount = 0;
    for (const relPath of collectColorReplacementCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = replaceLiteralColor(current, intent.from, intent.to);
      if (!result.changed) continue;
      replacementCount += result.count || 0;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
    }

    if (!operations.length) return null;
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Substituir ocorrências literais de ${intent.from} por ${intent.to} nos arquivos atuais.`,
        humanSummary: `Cor ${intent.from} substituída por ${intent.to}.`,
        userMessage,
        attachments,
        generatedBy: 'micro_color_literal_replace_patch',
        microContract: {
          schemaVersion: 'micro-edit-color-replacement-v1',
          type: intent.kind,
          from: intent.from,
          to: intent.to,
          replacements: replacementCount,
        },
      },
      raw: `micro_color_literal_replace_patch:${intent.from}->${intent.to}`,
    };
  }

  function buildSemanticColorOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const intent = extractSemanticColorEditIntent(userMessage);
    if (!intent) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    let replacementCount = 0;
    for (const relPath of collectColorReplacementCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = updateSemanticColorContent(current, intent, relPath);
      if (!result.changed) continue;
      replacementCount += result.count || 0;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
    }

    if (!operations.length) return null;
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Aplicar edição semântica de cor: ${intent.sourceFamily} -> ${intent.targetColor}.`,
        humanSummary: `Cores ${intent.sourceFamily} ajustadas para ${intent.targetColor}.`,
        userMessage,
        attachments,
        generatedBy: 'micro_semantic_color_edit_patch',
        microContract: {
          schemaVersion: 'micro-edit-semantic-color-v1',
          type: intent.kind,
          sourceFamily: intent.sourceFamily,
          targetColor: intent.targetColor,
          targetScope: intent.targetScope,
          replacements: replacementCount,
        },
      },
      raw: `micro_semantic_color_edit_patch:${intent.sourceFamily}->${intent.targetColor}`,
    };
  }

  function buildGlobalStyleOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const normalized = normalizeText(userMessage);
    if (
      isButtonColorEditRequest(userMessage) &&
      !/\b(global|todas|todos|paleta|tema|visual|identidade|site inteiro|projeto inteiro)\b/.test(normalized)
    ) {
      return null;
    }
    const semanticIntent = extractSemanticColorEditIntent(userMessage);
    const backgroundColor = extractBackgroundColor(userMessage);
    const typographyIntent = extractTypographyIntent(userMessage);
    if (!semanticIntent && !backgroundColor && !typographyIntent) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    let replacementCount = 0;
    const touchedKinds = [];
    for (const relPath of collectColorReplacementCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;

      let next = current;
      let changed = false;

      if (semanticIntent) {
        const result = updateSemanticColorContent(next, semanticIntent, relPath);
        if (result.changed) {
          next = result.content;
          changed = true;
          replacementCount += result.count || 0;
          touchedKinds.push('palette');
        }
      }

      if (backgroundColor && /\.(css|scss|sass)$/i.test(relPath)) {
        const result = updateBackgroundColorCss(next, backgroundColor);
        if (result.changed) {
          next = result.content;
          changed = true;
          touchedKinds.push('background');
        }
      }

      if (typographyIntent && /\.(css|scss|sass)$/i.test(relPath)) {
        const result = updateTypographyCss(next, typographyIntent);
        if (result.changed) {
          next = result.content;
          changed = true;
          touchedKinds.push('typography');
        }
      }

      if (!changed || next === current) continue;
      operations.push({ op: 'write_file', path: relPath, content: next });
    }

    if (!operations.length) return null;
    const uniqueKinds = uniqueList(touchedKinds);
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Aplicar ajuste global de estilo (${uniqueKinds.join(', ') || 'estilo'}) sem recriar o projeto.`,
        humanSummary: `Estilo global ajustado: ${uniqueKinds.join(', ') || 'estilo'}.`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_global_style_patch',
        microContract: {
          schemaVersion: 'micro-edit-global-style-v1',
          semanticColor: semanticIntent
            ? {
                sourceFamilies: semanticIntent.sourceFamilies || [semanticIntent.sourceFamily].filter(Boolean),
                targetColor: semanticIntent.targetColor,
                perFamilyTargets: semanticIntent.perFamilyTargets || {},
                replacements: replacementCount,
              }
            : null,
          backgroundColor: backgroundColor || '',
          typography: typographyIntent || null,
        },
      },
      raw: `deterministic_global_style_patch:${uniqueKinds.join('+') || 'style'}`,
    };
  }

  function buildButtonColorOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent = 'edit_project' } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isButtonColorEditRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;
    const color = extractRequestedColor(userMessage);
    if (!color) return null;

    const operations = [];
    const pageCandidates = collectExistingCandidates(projectInfo, [
      'app/page.tsx',
      'src/app/page.tsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'index.html',
      'index.php',
    ]);
    for (const relPath of pageCandidates) {
      if (!/\.(tsx|jsx)$/.test(relPath)) continue;
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = updateFirstButtonColorClass(current, color);
      if (!result.changed) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
      break;
    }

    if (!operations.length) {
      for (const relPath of collectExistingCandidates(projectInfo, [
        'app/globals.css',
        'src/app/globals.css',
        'style.css',
        'styles.css',
      ])) {
        if (!/\.(css|scss)$/.test(relPath)) continue;
        let current = '';
        try {
          current = readTextFile(projectRoot, relPath);
        } catch {
          continue;
        }
        if (current === null) continue;
        const result = updateAccentColorCss(current, color);
        if (!result.changed) continue;
        operations.push({ op: 'write_file', path: relPath, content: result.content });
        break;
      }
    }

    if (!operations.length) return null;
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Ajustar cor do primeiro botão/CTA para ${color}.`,
        humanSummary: `Cor do botão ajustada para ${color}.`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_button_color_patch',
      },
      raw: `deterministic_button_color_patch:${color}`,
    };
  }

  function buildThemeColorOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent = 'edit_project' } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isThemeColorEditRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;
    const color = extractRequestedColor(userMessage);
    if (!color) return null;

    const operations = [];
    for (const relPath of collectExistingCandidates(projectInfo, [
      'app/globals.css',
      'src/app/globals.css',
      'style.css',
      'styles.css',
      'src/styles.css',
    ])) {
      if (!/\.(css|scss)$/.test(relPath)) continue;
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = updateAccentColorCss(current, color);
      if (!result.changed) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
      break;
    }

    if (!operations.length) {
      const pageCandidates = collectExistingCandidates(projectInfo, [
        'app/page.tsx',
        'src/app/page.tsx',
        'pages/index.tsx',
        'src/pages/index.tsx',
        'index.html',
        'index.php',
      ]);
      for (const relPath of pageCandidates) {
        if (!/\.(tsx|jsx)$/.test(relPath)) continue;
        let current = '';
        try {
          current = readTextFile(projectRoot, relPath);
        } catch {
          continue;
        }
        if (current === null) continue;
        const result = updateFirstButtonColorClass(current, color);
        if (!result.changed) continue;
        operations.push({ op: 'write_file', path: relPath, content: result.content });
        break;
      }
    }

    if (!operations.length) return null;
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Ajustar cor principal/acento do projeto para ${color} sem recriar a base.`,
        humanSummary: `Paleta principal ajustada para ${color}.`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_theme_color_patch',
      },
      raw: `deterministic_theme_color_patch:${color}`,
    };
  }

  function buildFooterInsertOperationBatch({ projectInfo, userMessage, attachments = [], executionIntent = 'edit_project' } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isFooterInsertRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    const candidates = collectExistingCandidates(projectInfo, [
      'app/page.tsx',
      'src/app/page.tsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'index.html',
      'index.php',
    ]);
    for (const relPath of candidates) {
      if (!/\.(tsx|jsx|html|php)$/.test(relPath)) continue;
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const brand = extractBrandFromContent(current);
      const backgroundColor = extractRequestedColor(userMessage);
      const result = /\.(tsx|jsx)$/.test(relPath)
        ? insertFooterIntoNextPage(current, brand, { backgroundColor })
        : insertFooterIntoHtml(current, brand, { backgroundColor });
      if (!result.changed) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
      break;
    }

    if (!operations.length) return null;
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: 'Inserir rodapé institucional simples sem recriar o projeto.',
        humanSummary: 'Rodapé institucional inserido.',
        userMessage,
        attachments,
        generatedBy: 'deterministic_footer_insert_patch',
      },
      raw: 'deterministic_footer_insert_patch',
    };
  }

  function buildContentEditOperationBatch(options = {}) {
    return (
      buildHydrationMismatchOperationBatch(options) ||
      buildHeadingColorOperationBatch(options) ||
      buildTitleEditOperationBatch(options) ||
      buildLiteralColorReplacementOperationBatch(options) ||
      buildGlobalStyleOperationBatch(options) ||
      buildButtonColorOperationBatch(options) ||
      buildThemeColorOperationBatch(options) ||
      buildFooterInsertOperationBatch(options)
    );
  }

  return {
    buildButtonColorOperationBatch,
    buildContentEditOperationBatch,
    buildFooterInsertOperationBatch,
    buildGlobalStyleOperationBatch,
    buildHeadingColorOperationBatch,
    buildHydrationMismatchOperationBatch,
    buildLiteralColorReplacementOperationBatch,
    buildSemanticColorOperationBatch,
    buildThemeColorOperationBatch,
    buildTitleEditOperationBatch,
    ensureNextLayoutSuppressHydrationWarning,
    extractSemanticColorEditIntent,
    extractLiteralColorReplacementIntent,
    extractRequestedColor,
    extractRequestedTitle,
    extractBackgroundColor,
    extractTypographyIntent,
    isHeadingColorEditRequest,
    isLiteralColorReplacementRequest,
    isSemanticColorEditRequest,
    isTypographyEditRequest,
    replaceLiteralColor,
    updateBackgroundColorCss,
    updateTypographyCss,
    updateTitleContent,
  };
}

module.exports = {
  createDeterministicEditService,
  ensureNextLayoutSuppressHydrationWarning,
  extractLiteralColorReplacementIntent,
  extractRequestedColor,
  extractRequestedTitle,
  extractBackgroundColor,
  extractTypographyIntent,
  extractSemanticColorEditIntent,
  isButtonColorEditRequest,
  isFooterInsertRequest,
  isHeadingColorEditRequest,
  isHydrationMismatchRepairRequest,
  isLiteralColorReplacementRequest,
  isSemanticColorEditRequest,
  isThemeColorEditRequest,
  isTypographyEditRequest,
  replaceLiteralColor,
  updateBackgroundColorCss,
  updateTypographyCss,
  updateTitleContent,
};
