const {
  escapeRegExp,
  expandShortHex,
  normalizeText,
  resolveColorKeyword,
  uniqueList,
} = require('./deterministic_edit_core');

function extractBackgroundColor(userMessage = '') {
  const source = String(userMessage || '');
  const normalized = normalizeText(source);
  if (!/\b(fundo|background|bg)\b/.test(normalized)) return '';
  const mediaOverlayRequest = /\b(imagem|image|foto|photo|video|midia|media|overlay)\b/.test(normalized);
  const explicitBackgroundColorTarget = /\b(cor do fundo|fundo do site|fundo da pagina|background do site|background da pagina|deixar o background|deixar o fundo|troque a cor do fundo|mude a cor do fundo|alterar a cor do fundo)\b/.test(
    normalized
  );
  if (mediaOverlayRequest && !explicitBackgroundColorTarget) return '';
  const backgroundMatch = source.match(/\b(?:fundo|background|bg)\b[\s\S]{0,100}?(#[0-9a-fA-F]{3,6}\b)/i);
  if (backgroundMatch && backgroundMatch[1]) return expandShortHex(backgroundMatch[1]);
  const scopedColor = source.match(/\b(?:fundo|background|bg)\b([\s\S]{0,120})$/i);
  const scopedKeyword = scopedColor && scopedColor[1] ? resolveColorKeyword(scopedColor[1]) : '';
  return scopedKeyword || resolveColorKeyword(source);
}

function isBackgroundColorEditRequest(userMessage = '') {
  return Boolean(extractBackgroundColor(userMessage));
}

function isUnsupportedBackgroundMediaRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!/\b(fundo|background|bg|hero|topo)\b/.test(normalized)) return false;
  const asksMedia = /\b(imagem|image|foto|photo|video|midia|media)\b/.test(normalized);
  const asksOverlay = /\boverlay\b|\bsobreposicao\b|\bsobreposição\b|\bcamada\b/.test(normalized);
  return Boolean(asksMedia || asksOverlay);
}

function classifyBackgroundEditRequest(userMessage = '') {
  if (isUnsupportedBackgroundMediaRequest(userMessage)) {
    return {
      supported: false,
      kind: 'background_media_overlay_requires_visual_patch',
      reason:
        'Pedido envolve imagem, vídeo ou overlay no fundo; isso exige edição visual/estrutural e não deve ser tratado como troca simples de cor.',
    };
  }
  const color = extractBackgroundColor(userMessage);
  if (color) {
    return {
      supported: true,
      kind: 'background_color_micro_patch',
      color,
      reason: 'Pedido contém alvo de fundo/background e uma cor resolvida para micro-patch determinístico.',
    };
  }
  return {
    supported: false,
    kind: 'background_no_deterministic_color',
    reason: 'Não foi encontrada uma cor de fundo inequívoca para micro-patch determinístico.',
  };
}

function replaceCssVariableIfPresent(content, variableNames = [], value = '') {
  let next = String(content || '');
  let changed = false;
  for (const variableName of variableNames) {
    const pattern = new RegExp(`(${escapeRegExp(variableName)}\\s*:\\s*)#[0-9a-fA-F]{3,8}(\\s*;)`, 'i');
    if (!pattern.test(next)) continue;
    next = next.replace(pattern, `$1${value}$2`);
    changed = true;
  }
  return { changed, content: next };
}

function updateBackgroundColorCss(content, color) {
  const source = String(content || '');
  const normalizedColor = expandShortHex(color);
  if (!normalizedColor) return { changed: false, content: source };
  let next = source;
  let changed = false;

  const variableResult = replaceCssVariableIfPresent(next, [
    '--color-bg',
    '--bg',
    '--background',
    '--paper',
    '--page-bg',
    '--body-bg',
  ], normalizedColor);
  if (variableResult.changed) {
    next = variableResult.content;
    changed = true;
  }

  if (!changed) {
    const bodyPattern = /(body\s*\{[\s\S]*?\bbackground\s*:\s*)#[0-9a-fA-F]{3,8}(\s*;[\s\S]*?\})/i;
    if (bodyPattern.test(next)) {
      next = next.replace(bodyPattern, `$1${normalizedColor}$2`);
      changed = true;
    }
  }

  return { changed, content: next };
}

const KNOWN_FONT_FAMILIES = [
  'Playfair Display',
  'Cormorant',
  'Manrope',
  'Inter',
  'Montserrat',
  'Poppins',
  'Roboto',
  'Lora',
];

function extractTypographyIntent(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!/\b(fonte|fontes|font|tipografia|tipografias|typography|titulo|titulos|texto|textos)\b/.test(normalized)) {
    return null;
  }
  const mentions = KNOWN_FONT_FAMILIES.map((family) => {
    const normalizedFamily = normalizeText(family);
    const index = normalized.indexOf(normalizedFamily);
    return index >= 0 ? { family, index, normalizedFamily } : null;
  })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
  if (!mentions.length) return null;

  let titleFamily = '';
  let bodyFamily = '';
  for (const [mentionIndex, mention] of mentions.entries()) {
    const nextMention = mentions[mentionIndex + 1] || null;
    const windowText = normalized.slice(
      Math.max(0, mention.index - 48),
      nextMention
        ? nextMention.index
        : mention.index + mention.normalizedFamily.length + 96
    );
    if (/\b(titulo|titulos|heading|headings|display)\b/.test(windowText)) {
      titleFamily = titleFamily || mention.family;
    }
    if (/\b(texto|textos|body|corpo|paragrafo|paragrafos|fontes?)\b/.test(windowText)) {
      bodyFamily = bodyFamily || mention.family;
    }
  }

  if (!titleFamily && !bodyFamily) {
    if (mentions.length > 1) {
      titleFamily = mentions[0].family;
      bodyFamily = mentions[1].family;
    } else {
      bodyFamily = mentions[0].family;
    }
  }

  return {
    titleFamily,
    bodyFamily,
    families: uniqueList([titleFamily, bodyFamily]),
  };
}

function isTypographyEditRequest(userMessage = '') {
  return Boolean(extractTypographyIntent(userMessage));
}

function fontImportName(family = '') {
  return String(family || '').trim().replace(/\s+/g, '+');
}

function fontStack(family = '') {
  const raw = String(family || '').trim();
  if (!raw) return '';
  const serif = /playfair|cormorant|lora/i.test(raw);
  const fallback = serif
    ? 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif'
    : 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  return `"${raw}", ${fallback}`;
}

function buildGoogleFontImport(families = []) {
  const normalizedFamilies = uniqueList(families).map(fontImportName).filter(Boolean);
  if (!normalizedFamilies.length) return '';
  const familyQuery = normalizedFamilies
    .map((family) => `family=${family}:wght@400;500;600;700;800;900`)
    .join('&');
  return `@import url("https://fonts.googleapis.com/css2?${familyQuery}&display=swap");`;
}

function ensureGoogleFontImport(content, families = []) {
  const source = String(content || '');
  const importLine = buildGoogleFontImport(families);
  if (!importLine) return { changed: false, content: source };
  const withoutGoogle = source.replace(/^@import\s+url\(["']https:\/\/fonts\.googleapis\.com\/css2\?[^"']+["']\);\s*/gmi, '');
  const importBlock = withoutGoogle.match(/^((?:@import[^\n;]+;\s*)+)/);
  const next = importBlock
    ? withoutGoogle.replace(importBlock[0], `${importBlock[0].trimEnd()}\n${importLine}\n\n`)
    : `${importLine}\n\n${withoutGoogle}`;
  return { changed: next !== source, content: next };
}

function replaceOrAppendCssRule(content, selectorPattern, rule) {
  const source = String(content || '');
  if (selectorPattern.test(source)) {
    const next = source.replace(selectorPattern, rule);
    return { changed: next !== source, content: next };
  }
  const next = `${source.trimEnd()}\n\n${rule}\n`;
  return { changed: true, content: next };
}

function updateTypographyCss(content, intent = {}) {
  let next = String(content || '');
  let changed = false;
  const families = uniqueList([intent.titleFamily, intent.bodyFamily]);
  const importResult = ensureGoogleFontImport(next, families);
  if (importResult.changed) {
    next = importResult.content;
    changed = true;
  }

  if (intent.bodyFamily) {
    const bodyStack = fontStack(intent.bodyFamily);
    const bodyPattern = /(body\s*\{[\s\S]*?\bfont-family\s*:\s*)[^;]+(\s*;[\s\S]*?\})/i;
    if (bodyPattern.test(next)) {
      const replaced = next.replace(bodyPattern, `$1${bodyStack}$2`);
      if (replaced !== next) {
        next = replaced;
        changed = true;
      }
    } else {
      const rule = `body {\n  font-family: ${bodyStack};\n}`;
      const result = replaceOrAppendCssRule(next, /^body\s*\{[\s\S]*?\}/im, rule);
      if (result.changed) {
        next = result.content;
        changed = true;
      }
    }
  }

  if (intent.titleFamily) {
    const titleStack = fontStack(intent.titleFamily);
    const rule = `h1, h2, h3, .font-display {\n  font-family: ${titleStack};\n}`;
    const result = replaceOrAppendCssRule(next, /^h1\s*,\s*h2\s*,\s*h3[^{]*\{[\s\S]*?\}/im, rule);
    if (result.changed) {
      next = result.content;
      changed = true;
    }
  }

  return { changed, content: next };
}

module.exports = {
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
};
