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
  extractCardTextEditIntent,
  extractCtaTextEditIntent,
  extractFaqItemPatchIntent,
  extractFormFieldPatchIntent,
  extractGridColumnsIntent,
  extractHeroMediaPatchIntent,
  extractNavLinkEditIntent,
  extractSecondaryCtaEditIntent,
  extractSectionRemoveIntent,
  extractSectionReorderIntent,
  extractStatTextPatchIntent,
  isCardTextEditRequest,
  isCtaTextEditRequest,
  isFaqItemPatchRequest,
  isFormFieldPatchRequest,
  isGridColumnsEditRequest,
  isHeroMediaPatchRequest,
  isNavLinkEditRequest,
  isSecondaryCtaEditRequest,
  isSectionRemoveRequest,
  isSectionReorderRequest,
  isStatTextPatchRequest,
  removeSectionContent,
  reorderSectionContent,
  replaceNthCardHeading,
  replaceNthSimpleActionInner,
  updateCardTextContent,
  updateCtaTextContent,
  updateFaqItemContent,
  updateFormFieldContent,
  updateGridColumnsContent,
  updateHeroMediaContent,
  updateNavLinkContent,
  updateStatTextContent,
  classifyBackgroundEditRequest,
  extractBackgroundColor,
  isBackgroundColorEditRequest,
  isUnsupportedBackgroundMediaRequest,
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
const {
  createDeterministicEditSafetyService,
  DETERMINISTIC_SAFE_PATCH_VALIDATION_SCHEMA_VERSION,
} = require('./deterministic_edit_safety_service');
const {
  buildDeterministicEditPatchEvidence,
} = require('./deterministic_edit_patch_evidence_service');

function createDeterministicEditService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    buildOperationBatchDiffPreview = () => '',
    normalizeRequestedRelativePath = defaultNormalizeRequestedRelativePath,
  } = dependencies;

  const deterministicEditSafetyService = createDeterministicEditSafetyService({
    fs,
    path,
    normalizeRequestedRelativePath,
  });

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

  function collectPageEditCandidates(projectInfo = {}) {
    return collectExistingCandidates(projectInfo, [
      'app/page.tsx',
      'src/app/page.tsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'app/page.jsx',
      'pages/index.jsx',
      'src/pages/index.jsx',
      'index.html',
      'index.php',
    ]).filter((relPath) => /\.(tsx|jsx|html|php)$/i.test(relPath));
  }

  function collectCssEditCandidates(projectInfo = {}) {
    return collectExistingCandidates(projectInfo, [
      'app/globals.css',
      'src/app/globals.css',
      'style.css',
      'styles.css',
      'src/styles.css',
      'assets/css/styles.css',
      'assets/css/styles-v2.css',
      'assets/styles.css',
      'css/styles.css',
    ]).filter((relPath) => /\.css$/i.test(relPath));
  }

  function isSectionBackgroundFullWidthRequest(userMessage = '') {
    const normalized = normalizeText(userMessage);
    const widthIntent = /\b(full width|full-width|full bleed|full-bleed|largura inteira|largura total|100%|ponta a ponta|tela inteira)\b/.test(normalized);
    const backgroundIntent = /\b(degrade|degrad[eê]|gradient|gradiente|fundo|background)\b/.test(normalized);
    const sectionIntent = /\b(segunda secao|segunda seção|segunda sessao|segunda sessão|secao 2|seção 2|section 2|segundo bloco|segundo body|body)\b/.test(normalized);
    const limitedIntent = /\b(limitado|presa|preso|cortado|nao ocupa|não ocupa)\b/.test(normalized);
    const referenceIntent = /\b(cta|como no anexo|como esta no anexo|como está no anexo|igual ao anexo)\b/.test(normalized);
    return Boolean(widthIntent && backgroundIntent && (sectionIntent || limitedIntent || referenceIntent));
  }

  function patchIntroBandFullWidth(css = '') {
    const source = String(css || '');
    if (!/\.intro-band\s*\{/.test(source)) return { changed: false, content: source };
    let changed = false;
    let next = source.replace(/\.intro-band\s*\{([^}]*)\}/, (match, body) => {
      if (/\bmax-width\s*:\s*none\s*;/.test(body)) return match;
      changed = true;
      const cleanBody = body.trim();
      return `.intro-band { max-width: none; ${cleanBody}${cleanBody.endsWith(';') ? '' : ';'} }`;
    });

    const constraintSelector = '.intro-band > .eyebrow,\n.intro-band > h2,\n.intro-band > p,\n.intro-band > .card-grid,\n.intro-band > .text-link';
    if (!next.includes('.intro-band > .card-grid')) {
      changed = true;
      next += `\n${constraintSelector} { width: min(1180px, 100%); margin-left: auto; margin-right: auto; }\n`;
    }
    return { changed, content: next };
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

  function isNextBrowserGlobalModuleRepairRequest(userMessage = '') {
    const normalized = normalizeText(userMessage);
    if (!normalized) return false;
    const hasRepairVerb = /\b(?:corrij\w*|consert\w*|arrum\w*|repar\w*|remov\w*|mov\w*|apliqu\w*|fix)\b/.test(normalized);
    const hasPreviewContext = /\b(next|app router|preview|visualizacao|visualizacao|render|referenceerror|document is not defined|window is not defined)\b/.test(normalized);
    const hasBrowserGlobal = /\b(document|window|localstorage|sessionstorage|navigator|browser global|escopo de modulo|module scope)\b/.test(normalized);
    return Boolean(hasRepairVerb && hasPreviewContext && hasBrowserGlobal);
  }

  function removeNextModuleStyleInjection(source = '') {
    const current = String(source || '');
    const styleDeclaration = current.match(
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\s*\(\s*["']style["']\s*\)\s*;/
    );
    if (!styleDeclaration) return { changed: false, content: current };

    const styleVar = escapeRegExp(styleDeclaration[1]);
    const pattern = new RegExp(
      `\\n?(?:const\\s+baseStyles\\s*=\\s*(?:"[^"]*"|'[^']*'|\\\`[\\s\\S]*?\\\`)\\s*;\\s*)?(?:const|let)\\s+${styleVar}\\s*=\\s*document\\.createElement\\s*\\(\\s*["']style["']\\s*\\)\\s*;[\\s\\S]*?document\\.head\\.appendChild\\s*\\(\\s*${styleVar}\\s*\\)\\s*;\\s*\\}\\s*`,
      'm'
    );
    const content = current.replace(pattern, '\n');
    return { changed: content !== current, content };
  }

  function ensureNextBrowserGlobalRepairCss(source = '') {
    const current = String(source || '');
    if (current.includes('faber-next-browser-global-module-repair')) {
      return { changed: false, content: current };
    }
    const needsControlStyles =
      !/\.input\s*\{/.test(current) ||
      !/\.btn\s*\{/.test(current) ||
      !/\.btn-secondary\s*\{/.test(current) ||
      !/\.table\s*\{/.test(current);
    if (!needsControlStyles) return { changed: false, content: current };

    const block = [
      '',
      '/* faber-next-browser-global-module-repair */',
      '.input {',
      ' border: 1px solid #cbd5e1;',
      ' border-radius: 0.5rem;',
      ' background: #ffffff;',
      ' padding: 0.5rem 0.75rem;',
      ' outline: none;',
      '}',
      '',
      '.input:focus {',
      ' border-color: #2563eb;',
      ' box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.22);',
      '}',
      '',
      '.btn, .btn-secondary {',
      ' border: 1px solid #cbd5e1;',
      ' border-radius: 0.5rem;',
      ' padding: 0.5rem 0.75rem;',
      ' font-weight: 600;',
      '}',
      '',
      '.btn {',
      ' background: #1f2937;',
      ' color: #ffffff;',
      '}',
      '',
      '.btn-secondary {',
      ' background: #e5e7eb;',
      ' color: #111827;',
      '}',
      '',
      '.table {',
      ' width: 100%;',
      ' border-collapse: collapse;',
      '}',
      '',
      '.table th {',
      ' color: #64748b;',
      ' font-size: 0.75rem;',
      ' text-align: left;',
      ' text-transform: uppercase;',
      '}',
      '',
      '.table td, .table th {',
      ' border-top: 1px solid #e2e8f0;',
      ' padding: 0.75rem;',
      '}',
      '',
    ].join('\n');
    return {
      changed: true,
      content: `${current.trimEnd()}\n${block}`,
    };
  }

  function buildNextBrowserGlobalModuleOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isNextBrowserGlobalModuleRepairRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    let targetFile = '';
    for (const relPath of collectExistingCandidates(projectInfo, [
      'app/page.tsx',
      'src/app/page.tsx',
      'app/page.jsx',
      'src/app/page.jsx',
      'pages/index.tsx',
      'src/pages/index.tsx',
      'pages/index.jsx',
      'src/pages/index.jsx',
    ])) {
      if (!/\.(tsx|jsx)$/.test(relPath)) continue;
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = removeNextModuleStyleInjection(current);
      if (!result.changed) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content.trimEnd() + '\n' });
      targetFile = relPath;
      break;
    }

    if (!operations.length) return null;

    for (const relPath of collectCssEditCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = ensureNextBrowserGlobalRepairCss(current);
      if (!result.changed) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
      break;
    }

    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: targetFile || operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: 'Remover acesso a APIs do navegador no escopo de módulo do Next.js e mover estilos para CSS global.',
        humanSummary: 'Preview Next.js corrigido sem recriar a aplicação.',
        userMessage,
        attachments,
        generatedBy: 'deterministic_next_browser_global_module_patch',
        microContract: {
          schemaVersion: 'deterministic-next-browser-global-module-repair-v1',
          type: 'next_browser_global_module_scope',
          movedStylesToCss: operations.some((operation) => /\.css$/i.test(operation.path)),
        },
      },
      raw: 'deterministic_next_browser_global_module_patch',
    };
  }

  function isStructuredCloneCompatibilityRepairRequest(userMessage = '') {
    const normalized = normalizeText(userMessage);
    if (!normalized) return false;
    const mentionsStructuredClone = /\b(structuredclone|structured clone)\b/.test(normalized);
    const mentionsTestRuntime = /\b(jest|teste|testes|unitario|unitarios|unitário|unitários|referenceerror|is not defined|nao definido|não definido)\b/.test(normalized);
    const hasRepairVerb = /\b(?:corrij\w*|consert\w*|arrum\w*|repar\w*|resolv\w*|falh\w*|fix)\b/.test(normalized);
    return Boolean(mentionsStructuredClone && mentionsTestRuntime && hasRepairVerb);
  }

  function replaceStructuredCloneWithCompat(source = '') {
    const current = String(source || '');
    if (!/\bstructuredClone\s*\(/.test(current)) return { changed: false, content: current };
    let next = current.replace(/\bstructuredClone\s*\(/g, 'cloneSerializable(');
    if (!/\bfunction\s+cloneSerializable\b/.test(next)) {
      const helper = [
        '',
        'function cloneSerializable<T>(value: T): T {',
        '  if (typeof structuredClone === "function") {',
        '    return structuredClone(value);',
        '  }',
        '  return JSON.parse(JSON.stringify(value)) as T;',
        '}',
        '',
      ].join('\n');
      if (/\nfunction\s+cryptoUUID\s*\(/.test(next)) {
        next = next.replace(/\nfunction\s+cryptoUUID\s*\(/, `${helper}function cryptoUUID(`);
      } else {
        next = `${next.trimEnd()}\n${helper}`;
      }
    }
    return { changed: next !== current, content: next };
  }

  function buildStructuredCloneCompatibilityOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isStructuredCloneCompatibilityRepairRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    for (const relPath of collectExistingCandidates(projectInfo, [
      'lib/mrp.ts',
      'src/lib/mrp.ts',
      'lib/mrp.js',
      'src/lib/mrp.js',
    ])) {
      if (!/\.(tsx?|jsx?)$/i.test(relPath)) continue;
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = replaceStructuredCloneWithCompat(current);
      if (!result.changed) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content.trimEnd() + '\n' });
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
        summary: 'Adicionar fallback serializável para structuredClone em ambiente de testes.',
        humanSummary: 'Compatibilidade com Jest aplicada sem alterar regras de domínio.',
        userMessage,
        attachments,
        generatedBy: 'deterministic_structured_clone_compat_patch',
        microContract: {
          schemaVersion: 'deterministic-structured-clone-compat-v1',
          type: 'runtime_test_compatibility',
        },
      },
      raw: 'deterministic_structured_clone_compat_patch',
    };
  }

  function collectColorReplacementCandidates(projectInfo = {}) {
    return collectExistingCandidates(projectInfo, [
      'app/globals.css',
      'src/app/globals.css',
      'style.css',
      'styles.css',
      'src/styles.css',
      'assets/css/styles.css',
      'assets/css/styles-v2.css',
      'assets/styles.css',
      'css/styles.css',
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
    if (isUnsupportedBackgroundMediaRequest(userMessage) && !isHeroMediaPatchRequest(userMessage)) {
      return null;
    }
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
    if (isBackgroundColorEditRequest(userMessage)) return null;
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
        'assets/css/styles.css',
        'assets/css/styles-v2.css',
        'assets/styles.css',
        'css/styles.css',
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

  function buildCtaTextOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const intent = extractCtaTextEditIntent(userMessage);
    if (!intent || (!intent.toText && !intent.toHref)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    for (const relPath of collectPageEditCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = updateCtaTextContent(current, intent);
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
        summary: 'Editar CTA existente sem recriar a página.',
        humanSummary: intent.toHref
          ? `Destino do CTA atualizado para ${intent.toHref}.`
          : `Texto do CTA atualizado para "${intent.toText}".`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_cta_text_patch',
        microContract: {
          schemaVersion: 'deterministic-structural-micro-edit-v1',
          type: 'cta_text',
          index: intent.index,
          fromText: intent.fromText || '',
          toText: intent.toText || '',
          toHref: intent.toHref || '',
        },
      },
      raw: 'deterministic_cta_text_patch',
    };
  }

  function buildCardTextOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const intent = extractCardTextEditIntent(userMessage);
    if (!intent || !intent.text) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    for (const relPath of collectPageEditCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = updateCardTextContent(current, intent);
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
        summary: 'Editar texto de card existente sem recriar a página.',
        humanSummary: `Card ${intent.index + 1} atualizado para "${intent.text}".`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_card_text_patch',
        microContract: {
          schemaVersion: 'deterministic-structural-micro-edit-v1',
          type: 'card_text',
          index: intent.index,
          field: intent.field || 'title',
          fromText: intent.fromText || '',
          text: intent.text,
        },
      },
      raw: 'deterministic_card_text_patch',
    };
  }

  function buildGridColumnsOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const intent = extractGridColumnsIntent(userMessage);
    if (!intent || !intent.count) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    for (const relPath of collectPageEditCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = updateGridColumnsContent(current, intent);
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
        summary: `Ajustar grid existente para ${intent.count} colunas em ${intent.breakpoint}.`,
        humanSummary: `Grid ajustado para ${intent.count} colunas em ${intent.breakpoint}.`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_grid_columns_patch',
        microContract: {
          schemaVersion: 'deterministic-structural-micro-edit-v1',
          type: 'grid_columns',
          count: intent.count,
          breakpoint: intent.breakpoint,
          sectionId: intent.sectionId || '',
        },
      },
      raw: `deterministic_grid_columns_patch:${intent.breakpoint}:${intent.count}`,
    };
  }

  function buildSectionReorderOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const intent = extractSectionReorderIntent(userMessage);
    if (!intent) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    for (const relPath of collectPageEditCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = reorderSectionContent(current, intent);
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
        summary: `Reordenar seção ${intent.sourceId} ${intent.position === 'before' ? 'antes' : 'depois'} de ${intent.targetId}.`,
        humanSummary: `Seção ${intent.sourceId} movida ${intent.position === 'before' ? 'antes' : 'depois'} de ${intent.targetId}.`,
        userMessage,
        attachments,
        generatedBy: 'deterministic_section_reorder_patch',
        microContract: {
          schemaVersion: 'deterministic-structural-micro-edit-v1',
          type: 'section_reorder',
          sourceId: intent.sourceId,
          targetId: intent.targetId,
          position: intent.position,
        },
      },
      raw: `deterministic_section_reorder_patch:${intent.sourceId}:${intent.position}:${intent.targetId}`,
    };
  }

  function buildSinglePagePatchOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}, spec = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    const intent = typeof spec.extractIntent === 'function' ? spec.extractIntent(userMessage) : null;
    if (!intent) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    for (const relPath of collectPageEditCandidates(projectInfo)) {
      let current = '';
      try {
        current = readTextFile(projectRoot, relPath);
      } catch {
        continue;
      }
      if (current === null) continue;
      const result = spec.updateContent(current, intent, relPath);
      if (!result || !result.changed || result.content === current) continue;
      operations.push({ op: 'write_file', path: relPath, content: result.content });
      break;
    }

    if (!operations.length) return null;
    const microContract = typeof spec.microContract === 'function'
      ? spec.microContract(intent)
      : {
          schemaVersion: 'deterministic-structural-micro-edit-v1',
          type: spec.type,
        };
    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: operations[0].path,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: typeof spec.summary === 'function' ? spec.summary(intent) : spec.summary,
        humanSummary: typeof spec.humanSummary === 'function' ? spec.humanSummary(intent) : spec.humanSummary,
        userMessage,
        attachments,
        generatedBy: spec.generatedBy,
        microContract,
      },
      raw: typeof spec.raw === 'function' ? spec.raw(intent) : spec.generatedBy,
    };
  }

  function buildFaqItemOperationBatch(options = {}) {
    return buildSinglePagePatchOperationBatch(options, {
      generatedBy: 'deterministic_faq_item_patch',
      type: 'faq_item',
      extractIntent: extractFaqItemPatchIntent,
      updateContent: updateFaqItemContent,
      summary: (intent) => `${intent.action === 'add' ? 'Adicionar' : intent.action === 'remove' ? 'Remover' : 'Editar'} item de FAQ existente.`,
      humanSummary: (intent) => `FAQ ${intent.action === 'add' ? 'adicionado' : intent.action === 'remove' ? 'removido' : 'editado'}.`,
      microContract: (intent) => ({
        schemaVersion: 'deterministic-structural-micro-edit-v1',
        type: 'faq_item',
        action: intent.action,
        question: intent.question || '',
        answer: intent.answer || '',
        toQuestion: intent.toQuestion || '',
        toAnswer: intent.toAnswer || '',
      }),
    });
  }

  function buildNavLinkOperationBatch(options = {}) {
    return buildSinglePagePatchOperationBatch(options, {
      generatedBy: 'deterministic_nav_link_patch',
      type: 'nav_link',
      extractIntent: extractNavLinkEditIntent,
      updateContent: updateNavLinkContent,
      summary: 'Editar link de navegação sem recriar a página.',
      humanSummary: 'Link de navegação atualizado.',
      microContract: (intent) => ({
        schemaVersion: 'deterministic-structural-micro-edit-v1',
        type: 'nav_link',
        index: intent.index,
        fromText: intent.fromText || '',
        toText: intent.toText || '',
        toHref: intent.toHref || '',
      }),
    });
  }

  function buildSectionBackgroundWidthOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isSectionBackgroundFullWidthRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const operations = [];
    for (const relPath of collectCssEditCandidates(projectInfo)) {
      const absPath = path.join(projectRoot, relPath);
      let current = '';
      try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile() || stat.size > 700000) continue;
        current = fs.readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      const result = patchIntroBandFullWidth(current);
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
        summary: 'Expandir o fundo/degradê da segunda seção para largura total sem recriar a página.',
        humanSummary: 'Fundo da segunda seção expandido para largura total.',
        userMessage,
        attachments,
        generatedBy: 'deterministic_section_background_width_patch',
        microContract: {
          schemaVersion: 'deterministic-structural-micro-edit-v1',
          type: 'section_background_width',
          targetSelector: '.intro-band',
          width: 'full',
          contentConstraint: '1180px',
        },
      },
      raw: 'deterministic_section_background_width_patch:intro-band',
    };
  }

  function buildSectionRemoveOperationBatch(options = {}) {
    return buildSinglePagePatchOperationBatch(options, {
      generatedBy: 'deterministic_section_remove_patch',
      type: 'section_remove',
      extractIntent: extractSectionRemoveIntent,
      updateContent: removeSectionContent,
      summary: (intent) => `Remover seção ${intent.sectionId}.`,
      humanSummary: (intent) => `Seção ${intent.sectionId} removida.`,
      microContract: (intent) => ({
        schemaVersion: 'deterministic-structural-micro-edit-v1',
        type: 'section_remove',
        sectionId: intent.sectionId,
      }),
      raw: (intent) => `deterministic_section_remove_patch:${intent.sectionId}`,
    });
  }

  function buildFormFieldOperationBatch(options = {}) {
    return buildSinglePagePatchOperationBatch(options, {
      generatedBy: 'deterministic_form_field_patch',
      type: 'form_field',
      extractIntent: extractFormFieldPatchIntent,
      updateContent: updateFormFieldContent,
      summary: (intent) => `${intent.action === 'add' ? 'Adicionar' : 'Renomear'} campo de formulário.`,
      humanSummary: (intent) => `Campo de formulário ${intent.action === 'add' ? 'adicionado' : 'renomeado'}.`,
      microContract: (intent) => ({
        schemaVersion: 'deterministic-structural-micro-edit-v1',
        type: 'form_field',
        action: intent.action,
        fromText: intent.fromText || '',
        toText: intent.toText || '',
        inputType: intent.type || 'text',
      }),
    });
  }

  function buildStatTextOperationBatch(options = {}) {
    return buildSinglePagePatchOperationBatch(options, {
      generatedBy: 'deterministic_stat_text_patch',
      type: 'stat_text',
      extractIntent: extractStatTextPatchIntent,
      updateContent: updateStatTextContent,
      summary: 'Editar métrica textual explícita.',
      humanSummary: 'Métrica textual atualizada.',
      microContract: (intent) => ({
        schemaVersion: 'deterministic-structural-micro-edit-v1',
        type: 'stat_text',
        fromText: intent.fromText,
        toText: intent.toText,
      }),
    });
  }

  function buildHeroMediaOperationBatch(options = {}) {
    return buildSinglePagePatchOperationBatch(options, {
      generatedBy: 'deterministic_hero_media_patch',
      type: 'hero_media',
      extractIntent: extractHeroMediaPatchIntent,
      updateContent: updateHeroMediaContent,
      summary: (intent) => `Editar ${intent.attr} da mídia do hero com valor explícito.`,
      humanSummary: (intent) => `Mídia do hero atualizada (${intent.attr}).`,
      microContract: (intent) => ({
        schemaVersion: 'deterministic-structural-micro-edit-v1',
        type: 'hero_media',
        attr: intent.attr,
        value: intent.value,
        mediaKind: intent.mediaKind,
      }),
    });
  }

  function classifySafeContentEditRequest(userMessage = '') {
    if (isHeroMediaPatchRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'hero_media_micro_patch',
        reason: 'Pedido contém troca explícita de atributo de mídia do hero.',
      };
    }
    const backgroundClassification = classifyBackgroundEditRequest(userMessage);
    if (backgroundClassification.kind !== 'background_no_deterministic_color') {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        ...backgroundClassification,
      };
    }
    if (extractRequestedTitle(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'title_micro_patch',
        reason: 'Pedido contém alteração textual de título com destino inequívoco.',
      };
    }
    if (isHeadingColorEditRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'heading_color_micro_patch',
        reason: 'Pedido contém ajuste de cor do H1/título com alvo restrito.',
      };
    }
    if (isHydrationMismatchRepairRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'hydration_mismatch_micro_patch',
        reason: 'Pedido contém correção local de hidratação restrita ao layout Next.js.',
      };
    }
    if (isStructuredCloneCompatibilityRepairRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'structured_clone_compat_micro_patch',
        reason: 'Pedido contém correção localizada de compatibilidade structuredClone para runtime de testes.',
      };
    }
    if (isNextBrowserGlobalModuleRepairRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'next_browser_global_module_micro_patch',
        reason: 'Pedido contém remoção localizada de APIs do navegador em escopo de módulo Next.js.',
      };
    }
    if (extractLiteralColorReplacementIntent(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'literal_color_replacement_micro_patch',
        reason: 'Pedido contém substituição literal de cor com origem e destino explícitos.',
      };
    }
    if (extractSemanticColorEditIntent(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'semantic_color_micro_patch',
        reason: 'Pedido contém família semântica de cor e destino resolvido.',
      };
    }
    if (isNavLinkEditRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'nav_link_micro_patch',
        reason: 'Pedido contém ajuste restrito a link de navegação existente.',
      };
    }
    if (isCtaTextEditRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'cta_text_micro_patch',
        reason: 'Pedido contém ajuste restrito a CTA existente.',
      };
    }
    if (isCardTextEditRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'card_text_micro_patch',
        reason: 'Pedido contém ajuste textual de card com posição resolvida.',
      };
    }
    if (isGridColumnsEditRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'grid_columns_micro_patch',
        reason: 'Pedido contém ajuste de colunas de grid com contagem resolvida.',
      };
    }
    if (isSectionBackgroundFullWidthRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'section_background_width_micro_patch',
        reason: 'Pedido contém ajuste localizado de largura do fundo/degradê de seção existente.',
      };
    }
    if (isSectionReorderRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'section_reorder_micro_patch',
        reason: 'Pedido contém reordenação simples entre seções identificadas.',
      };
    }
    if (isFaqItemPatchRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'faq_item_micro_patch',
        reason: 'Pedido contém alteração determinística em item de FAQ.',
      };
    }
    if (isSectionRemoveRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'section_remove_micro_patch',
        reason: 'Pedido contém remoção de seção identificada.',
      };
    }
    if (isFormFieldPatchRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'form_field_micro_patch',
        reason: 'Pedido contém alteração localizada de campo de formulário.',
      };
    }
    if (isStatTextPatchRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'stat_text_micro_patch',
        reason: 'Pedido contém troca explícita de métrica textual.',
      };
    }
    if (isButtonColorEditRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'button_color_micro_patch',
        reason: 'Pedido contém ajuste de cor do botão/CTA com alvo restrito.',
      };
    }
    if (isThemeColorEditRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'theme_color_micro_patch',
        reason: 'Pedido contém ajuste de cor principal/acento com destino resolvido.',
      };
    }
    if (extractTypographyIntent(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'typography_micro_patch',
        reason: 'Pedido contém troca tipográfica com família resolvida.',
      };
    }
    if (isFooterInsertRequest(userMessage)) {
      return {
        schemaVersion: 'deterministic-safe-patch-classification-v1',
        supported: true,
        kind: 'footer_insert_micro_patch',
        reason: 'Pedido contém inserção de rodapé restrita ao arquivo de página existente.',
      };
    }
    return {
      schemaVersion: 'deterministic-safe-patch-classification-v1',
      supported: false,
      kind: 'no_active_micro_contract',
      reason: 'Nenhum micro-contrato determinístico ativo reconheceu este pedido como patch simples.',
    };
  }

  function finalizeDeterministicPatch(patch, options = {}) {
    if (!patch || !patch.action) return patch;
    const safePatchClassification = classifySafeContentEditRequest(options.userMessage || '');
    const safePatchValidation = deterministicEditSafetyService.validateSafePatch({
      projectInfo: options.projectInfo || null,
      action: patch.action,
      userMessage: options.userMessage || '',
    });

    if (!safePatchValidation.ok) {
      return {
        ok: false,
        action: null,
        message:
          safePatchValidation.summary ||
          'Patch determinístico bloqueado pela validação de segurança antes de gerar ação aplicável.',
        raw: 'deterministic_patch_safety_rejected',
        safePatchClassification,
        safePatchValidation,
        safePatchEvidence: buildDeterministicEditPatchEvidence({
          action: patch.action,
          classification: safePatchClassification,
          validation: safePatchValidation,
          status: 'blocked',
        }),
      };
    }

    patch.action.safePatchClassification = safePatchClassification;
    patch.action.safePatchValidation = safePatchValidation;
    patch.action.safePatchEvidence = buildDeterministicEditPatchEvidence({
      action: patch.action,
      classification: safePatchClassification,
      validation: safePatchValidation,
      status: 'approved',
    });
    return patch;
  }

  function buildContentEditOperationBatch(options = {}) {
    const userMessage = options && options.userMessage ? String(options.userMessage) : '';
    if (isUnsupportedBackgroundMediaRequest(userMessage) && !isHeroMediaPatchRequest(userMessage)) {
      return null;
    }
    const patch = (
      buildNextBrowserGlobalModuleOperationBatch(options) ||
      buildStructuredCloneCompatibilityOperationBatch(options) ||
      buildHydrationMismatchOperationBatch(options) ||
      buildHeadingColorOperationBatch(options) ||
      buildTitleEditOperationBatch(options) ||
      buildLiteralColorReplacementOperationBatch(options) ||
      buildGlobalStyleOperationBatch(options) ||
      buildSectionBackgroundWidthOperationBatch(options) ||
      buildNavLinkOperationBatch(options) ||
      buildCtaTextOperationBatch(options) ||
      buildCardTextOperationBatch(options) ||
      buildGridColumnsOperationBatch(options) ||
      buildSectionReorderOperationBatch(options) ||
      buildFaqItemOperationBatch(options) ||
      buildSectionRemoveOperationBatch(options) ||
      buildFormFieldOperationBatch(options) ||
      buildStatTextOperationBatch(options) ||
      buildHeroMediaOperationBatch(options) ||
      buildButtonColorOperationBatch(options) ||
      buildThemeColorOperationBatch(options) ||
      buildFooterInsertOperationBatch(options)
    );
    return finalizeDeterministicPatch(patch, options);
  }

  return {
    buildButtonColorOperationBatch,
    buildCardTextOperationBatch,
    buildContentEditOperationBatch,
    buildCtaTextOperationBatch,
    buildFaqItemOperationBatch,
    buildFooterInsertOperationBatch,
    buildFormFieldOperationBatch,
    buildGlobalStyleOperationBatch,
    buildGridColumnsOperationBatch,
    buildHeroMediaOperationBatch,
    buildHeadingColorOperationBatch,
    buildHydrationMismatchOperationBatch,
    buildNextBrowserGlobalModuleOperationBatch,
    buildLiteralColorReplacementOperationBatch,
    buildNavLinkOperationBatch,
    buildSemanticColorOperationBatch,
    buildSectionRemoveOperationBatch,
    buildSectionBackgroundWidthOperationBatch,
    buildSectionReorderOperationBatch,
    buildStatTextOperationBatch,
    buildStructuredCloneCompatibilityOperationBatch,
    buildThemeColorOperationBatch,
    buildTitleEditOperationBatch,
    classifySafeContentEditRequest,
    validateSafePatch: deterministicEditSafetyService.validateSafePatch,
    ensureNextLayoutSuppressHydrationWarning,
    extractSemanticColorEditIntent,
    extractLiteralColorReplacementIntent,
    extractRequestedColor,
    extractRequestedTitle,
    extractBackgroundColor,
    extractCardTextEditIntent,
    extractCtaTextEditIntent,
    extractFaqItemPatchIntent,
    extractFormFieldPatchIntent,
    extractGridColumnsIntent,
    extractHeroMediaPatchIntent,
    extractNavLinkEditIntent,
    extractSecondaryCtaEditIntent,
    extractSectionRemoveIntent,
    extractSectionReorderIntent,
    extractStatTextPatchIntent,
    extractTypographyIntent,
    isSectionBackgroundFullWidthRequest,
    isBackgroundColorEditRequest,
    isCardTextEditRequest,
    isCtaTextEditRequest,
    isFaqItemPatchRequest,
    isFormFieldPatchRequest,
    isGridColumnsEditRequest,
    isHeroMediaPatchRequest,
    isHeadingColorEditRequest,
    isNavLinkEditRequest,
    isSecondaryCtaEditRequest,
    isSectionRemoveRequest,
    isSectionReorderRequest,
    isStatTextPatchRequest,
    isUnsupportedBackgroundMediaRequest,
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
  classifyBackgroundEditRequest,
  createDeterministicEditService,
  createDeterministicEditSafetyService,
  DETERMINISTIC_SAFE_PATCH_VALIDATION_SCHEMA_VERSION,
  ensureNextLayoutSuppressHydrationWarning,
  extractLiteralColorReplacementIntent,
  extractRequestedColor,
  extractRequestedTitle,
  extractBackgroundColor,
  extractCardTextEditIntent,
  extractCtaTextEditIntent,
  extractFaqItemPatchIntent,
  extractFormFieldPatchIntent,
  extractGridColumnsIntent,
  extractHeroMediaPatchIntent,
  extractNavLinkEditIntent,
  extractSecondaryCtaEditIntent,
  extractSectionRemoveIntent,
  extractSectionReorderIntent,
  extractStatTextPatchIntent,
  extractTypographyIntent,
  extractSemanticColorEditIntent,
  isButtonColorEditRequest,
  isBackgroundColorEditRequest,
  isCardTextEditRequest,
  isCtaTextEditRequest,
  isFaqItemPatchRequest,
  isFooterInsertRequest,
  isFormFieldPatchRequest,
  isGridColumnsEditRequest,
  isHeroMediaPatchRequest,
  isHeadingColorEditRequest,
  isHydrationMismatchRepairRequest,
  isNavLinkEditRequest,
  isSecondaryCtaEditRequest,
  isSectionRemoveRequest,
  isSectionReorderRequest,
  isStatTextPatchRequest,
  isUnsupportedBackgroundMediaRequest,
  isLiteralColorReplacementRequest,
  isSemanticColorEditRequest,
  isThemeColorEditRequest,
  isTypographyEditRequest,
  replaceLiteralColor,
  updateBackgroundColorCss,
  updateTypographyCss,
  updateTitleContent,
};
