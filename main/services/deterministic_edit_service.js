const defaultFs = require('fs');
const defaultPath = require('path');

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escapeHtmlText(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeJsString(value = '', quote = "'") {
  const text = String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n');
  if (quote === '"') return text.replace(/"/g, '\\"');
  if (quote === '`') return text.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return text.replace(/'/g, "\\'");
}

function defaultNormalizeRequestedRelativePath(rawPath) {
  if (!rawPath) return null;
  const sanitized = String(rawPath).trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!sanitized) return null;
  if (/^(?:[a-zA-Z]:[\\/]|\/)/.test(sanitized)) return null;
  const normalized = sanitized.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (!normalized || normalized.startsWith('..') || normalized.includes('/../')) return null;
  return normalized;
}

function extractQuotedTextAfterMarker(text, markerIndex) {
  const slice = String(text || '').slice(Math.max(0, markerIndex));
  const quoted = slice.match(/["“']([^"”']{1,160})["”']/);
  return quoted && quoted[1] ? quoted[1].trim() : '';
}

function extractRequestedTitle(userMessage = '') {
  const source = String(userMessage || '').trim();
  if (!source) return '';
  const normalized = normalizeText(source);
  if (!/\btitulo\b/.test(normalized)) return '';
  if (!/\b(mude|altere|troque|substitua|atualize|renomeie|editar|edite)\b/.test(normalized)) return '';

  const paraIndex = normalized.search(/\b(para|por|como)\b/);
  if (paraIndex >= 0) {
    const quoted = extractQuotedTextAfterMarker(source, paraIndex);
    if (quoted) return quoted;
  }

  const fallback = source.match(/\b(?:para|por|como)\s+(.+)$/i);
  if (!fallback || !fallback[1]) return '';
  return fallback[1]
    .replace(/^["'“”]+|["'“”.]+$/g, '')
    .trim()
    .slice(0, 160);
}

function expandShortHex(hex) {
  const value = String(hex || '').replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value.split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value}`.toLowerCase();
  return '';
}

function darkenHex(hex, amount = 0.16) {
  const normalized = expandShortHex(hex);
  if (!normalized) return hex;
  const value = normalized.replace(/^#/, '');
  const parts = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((part) =>
    Number.parseInt(part, 16)
  );
  const factor = Math.max(0, Math.min(1, 1 - Number(amount || 0)));
  return `#${parts
    .map((part) => Math.max(0, Math.min(255, Math.round(part * factor))).toString(16).padStart(2, '0'))
    .join('')}`;
}

function extractRequestedColor(userMessage = '') {
  const source = String(userMessage || '');
  const hex = source.match(/#[0-9a-fA-F]{3,6}\b/);
  if (hex) return expandShortHex(hex[0]);

  const normalized = normalizeText(source);
  const colorMap = [
    { regex: /vermelho\s+coral|coral/, value: '#cf416b' },
    { regex: /vermelh[oa]/, value: '#cf416b' },
    { regex: /verde/, value: '#2f8f83' },
    { regex: /azul\s+marinho|marinho/, value: '#0b1f3a' },
    { regex: /azul\s+petroleo|petroleo/, value: '#123a5a' },
    { regex: /azul/, value: '#2563eb' },
    { regex: /preto|escuro/, value: '#1f2424' },
    { regex: /branco|claro/, value: '#ffffff' },
    { regex: /dourado|ouro/, value: '#c9a227' },
  ];
  const hit = colorMap.find((entry) => entry.regex.test(normalized));
  return hit ? hit.value : '';
}

function isButtonColorEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  const hasButtonTarget = /\b(botao|button|cta|chamada)\b/.test(normalized);
  const hasEditVerb = /\b(ajuste|ajustar|mude|alterar|altere|troque|trocar|substitua|atualize|defina|coloque)\b/.test(normalized);
  const hasColor = /#[0-9a-f]{3,6}\b/.test(normalized) || /\b(cor|vermelh|coral|verde|azul|preto|branco|dourado|ouro|marinho|petroleo)\b/.test(normalized);
  return Boolean(hasButtonTarget && hasEditVerb && hasColor);
}

function isFooterInsertRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  const hasFooterTarget = /\b(rodape|footer)\b/.test(normalized);
  const hasAddVerb = /\b(insira|inserir|adicione|adicionar|inclua|incluir|crie|criar|coloque)\b/.test(normalized);
  return Boolean(hasFooterTarget && hasAddVerb);
}

function isHydrationMismatchRepairRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return /\b(hydration|hidratacao|hydrated|mismatch|cz-shortcut-listen|server rendered html|client properties)\b/.test(normalized);
}

function replaceFirstSimpleTagInner(content, tagName, replacementText) {
  const source = String(content || '');
  const pattern = new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)(</${tagName}>)`, 'i');
  const match = source.match(pattern);
  if (!match) return { changed: false, content: source };

  const inner = String(match[2] || '');
  if (/<[a-z][\s\S]*>/i.test(inner)) return { changed: false, content: source };

  const nextInner = escapeHtmlText(replacementText);
  if (inner.trim() === nextInner) return { changed: false, content: source };
  return {
    changed: true,
    content: source.replace(pattern, `$1${nextInner}$3`),
  };
}

function replaceHtmlDocumentTitle(content, replacementText) {
  const source = String(content || '');
  const pattern = /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i;
  if (!pattern.test(source)) return { changed: false, content: source };
  const nextTitle = escapeHtmlText(replacementText);
  const next = source.replace(pattern, `$1${nextTitle}$3`);
  return { changed: next !== source, content: next };
}

function replaceMetadataTitle(content, replacementText) {
  const source = String(content || '');
  const pattern = /(title\s*:\s*)(['"`])([\s\S]{0,180}?)(\2)/m;
  const match = source.match(pattern);
  if (!match) return { changed: false, content: source };
  const quote = match[2] || "'";
  const next = source.replace(pattern, (_full, prefix, q, _old, suffix) => {
    return `${prefix}${q}${escapeJsString(replacementText, quote)}${suffix}`;
  });
  return { changed: next !== source, content: next };
}

function updateTitleContent(content, replacementText, relPath = '') {
  const lowerPath = String(relPath || '').toLowerCase();
  let next = String(content || '');
  let changed = false;
  const changes = [];

  if (/\.(html|php)$/.test(lowerPath)) {
    const titleResult = replaceHtmlDocumentTitle(next, replacementText);
    if (titleResult.changed) {
      next = titleResult.content;
      changed = true;
      changes.push('title');
    }
  }

  if (/\.(html|php|jsx|tsx)$/.test(lowerPath)) {
    const h1Result = replaceFirstSimpleTagInner(next, 'h1', replacementText);
    if (h1Result.changed) {
      next = h1Result.content;
      changed = true;
      changes.push('h1');
    }
  }

  if (/\.(js|jsx|ts|tsx)$/.test(lowerPath)) {
    const metadataResult = replaceMetadataTitle(next, replacementText);
    if (metadataResult.changed) {
      next = metadataResult.content;
      changed = true;
      changes.push('metadata');
    }
  }

  return { changed, content: next, changes };
}

function ensureNextLayoutSuppressHydrationWarning(content, relPath = '') {
  const lowerPath = String(relPath || '').toLowerCase();
  if (!/(^|\/)layout\.(tsx|jsx)$/.test(lowerPath)) {
    return { changed: false, content: String(content || '') };
  }
  const source = String(content || '');
  if (!/<body\b/i.test(source)) return { changed: false, content: source };
  if (/<body\b[^>]*\bsuppressHydrationWarning\b/i.test(source)) {
    return { changed: false, content: source };
  }
  const next = source.replace(/<body\b([^>]*)>/i, (_match, attrs = '') => {
    return `<body${attrs} suppressHydrationWarning>`;
  });
  return { changed: next !== source, content: next };
}

function replaceCssVariable(content, variableName, color) {
  const source = String(content || '');
  const pattern = new RegExp(`(${variableName}\\s*:\\s*)#[0-9a-fA-F]{3,8}(\\s*;)`, 'i');
  if (!pattern.test(source)) return { changed: false, content: source };
  const next = source.replace(pattern, `$1${color}$2`);
  return { changed: next !== source, content: next };
}

function updateAccentColorCss(content, color) {
  const source = String(content || '');
  let next = source;
  let changed = false;
  for (const variable of ['--color-accent', '--accent', '--color-primary', '--primary']) {
    const result = replaceCssVariable(next, variable, color);
    if (result.changed) {
      next = result.content;
      changed = true;
      break;
    }
  }
  const darkResult = replaceCssVariable(next, '--color-accent-dark', darkenHex(color));
  if (darkResult.changed) {
    next = darkResult.content;
    changed = true;
  }
  return { changed, content: next };
}

function updateFirstButtonColorClass(content, color) {
  const source = String(content || '');
  const dark = darkenHex(color);
  const buttonPattern = /(<(?:a|button)\b[^>]*className=")([^"]*\bbg-\[[^\]]+\][^"]*)(")/i;
  const match = source.match(buttonPattern);
  if (!match) return { changed: false, content: source };
  let className = match[2];
  className = className
    .replace(/\bbg-\[[^\]]+\]/, `bg-[${color}]`)
    .replace(/\bhover:bg-\[[^\]]+\]\s*/g, '');
  if (!/\bhover:bg-\[/.test(className)) className = `${className} hover:bg-[${dark}]`;
  const next = source.replace(buttonPattern, `$1${className}$3`);
  return { changed: next !== source, content: next };
}

function extractBrandFromContent(content = '') {
  const source = String(content || '');
  const headerLink = source.match(/<a\b[^>]*href=["']#inicio["'][^>]*>([^<]{2,80})<\/a>/i);
  if (headerLink && headerLink[1]) return headerLink[1].trim();
  const metadata = source.match(/title\s*:\s*['"`]([^'"`]{2,80})['"`]/);
  if (metadata && metadata[1]) return metadata[1].trim();
  const h1 = source.match(/<h1\b[^>]*>([^<]{2,80})<\/h1>/i);
  if (h1 && h1[1]) return h1[1].trim();
  return 'Faber Projeto';
}

function buildNextFooterBlock(brand = 'Faber Projeto') {
  const safeBrand = escapeHtmlText(brand || 'Faber Projeto');
  return [
    '',
    '      <footer className="border-t border-[var(--color-line)] bg-[var(--color-ink)] px-5 py-10 text-white">',
    '        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-white/75 md:flex-row md:items-center md:justify-between">',
    `          <strong className="text-base text-white">${safeBrand}</strong>`,
    `          <span>© 2026 ${safeBrand}. Todos os direitos reservados.</span>`,
    '        </div>',
    '      </footer>',
  ].join('\n');
}

function insertFooterIntoNextPage(content, brand = 'Faber Projeto') {
  const source = String(content || '');
  if (/<footer\b/i.test(source)) return { changed: false, content: source };
  if (!/<\/main>/i.test(source)) return { changed: false, content: source };
  const next = source.replace(/(\s*)<\/main>/i, `${buildNextFooterBlock(brand)}$1</main>`);
  return { changed: next !== source, content: next };
}

function buildHtmlFooterBlock(brand = 'Faber Projeto') {
  const safeBrand = escapeHtmlText(brand || 'Faber Projeto');
  return [
    '',
    '<footer class="site-footer">',
    `  <strong>${safeBrand}</strong>`,
    `  <span>© 2026 ${safeBrand}. Todos os direitos reservados.</span>`,
    '</footer>',
  ].join('\n');
}

function insertFooterIntoHtml(content, brand = 'Faber Projeto') {
  const source = String(content || '');
  if (/<footer\b/i.test(source)) return { changed: false, content: source };
  const block = buildHtmlFooterBlock(brand);
  if (/<\/body>/i.test(source)) {
    const next = source.replace(/<\/body>/i, `${block}\n</body>`);
    return { changed: next !== source, content: next };
  }
  return { changed: false, content: source };
}

function uniqueList(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

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
      const result = /\.(tsx|jsx)$/.test(relPath)
        ? insertFooterIntoNextPage(current, brand)
        : insertFooterIntoHtml(current, brand);
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
      buildTitleEditOperationBatch(options) ||
      buildButtonColorOperationBatch(options) ||
      buildFooterInsertOperationBatch(options)
    );
  }

  return {
    buildButtonColorOperationBatch,
    buildContentEditOperationBatch,
    buildFooterInsertOperationBatch,
    buildHydrationMismatchOperationBatch,
    buildTitleEditOperationBatch,
    ensureNextLayoutSuppressHydrationWarning,
    extractRequestedColor,
    extractRequestedTitle,
    updateTitleContent,
  };
}

module.exports = {
  createDeterministicEditService,
  ensureNextLayoutSuppressHydrationWarning,
  extractRequestedColor,
  extractRequestedTitle,
  isButtonColorEditRequest,
  isFooterInsertRequest,
  isHydrationMismatchRepairRequest,
  updateTitleContent,
};
