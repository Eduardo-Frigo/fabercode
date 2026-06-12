const {
  darkenHex,
  escapeHtmlText,
  escapeJsString,
  escapeRegExp,
  expandShortHex,
  extractRequestedColor,
  normalizeText,
  uniqueList,
} = require('./deterministic_edit_core');

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

const TAILWIND_TEXT_COLOR_CLASS_PATTERN =
  /\btext-(?:white|black|transparent|current)(?:\/\d+)?\b|\btext-\[(?:#[0-9a-fA-F]{3,8}|var\([^)]+\)|rgba?\([^)]+\)|[^\]]+)\]|\btext-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\/\d+)?\b/g;

function isHeadingColorEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  const colorWords = '(?:#[0-9a-f]{3,6}|azul|verde|vermelh|coral|preto|branco|dourado|ouro|marinho|petroleo|accent|acento|principal|mesmo|mesma)';
  const pattern = new RegExp(
    `\\b(?:ajuste|ajustar|mude|mudar|alterar|altere|troque|trocar|substitua|atualize|defina|coloque)\\b[\\s\\S]{0,100}?\\b(?:cor\\s+(?:do|da)\\s+)?(?:h1|titulo|titulos|headline|heading|chamada principal)\\b[\\s\\S]{0,100}?\\b(?:para|pra|por|como|em)\\b[\\s\\S]{0,80}?${colorWords}`,
    'i'
  );
  return pattern.test(normalized);
}

function extractHeadingColorValue(userMessage = '') {
  const source = String(userMessage || '');
  const normalized = normalizeText(source);
  if (
    /\b(mesmo|mesma)\s+azul\b/.test(normalized) ||
    /\bazul\s+(?:dos|do|da)\s+(?:outros|pontos|site|acentos?)\b/.test(normalized) ||
    /\b(accent|acento|principal)\b/.test(normalized)
  ) {
    return {
      cssValue: 'var(--color-accent)',
      className: 'text-[var(--color-accent)]',
      label: 'var(--color-accent)',
    };
  }

  const hex = source.match(/#[0-9a-fA-F]{3,6}\b/);
  const color = hex ? expandShortHex(hex[0]) : extractRequestedColor(source);
  if (!color) return null;
  return {
    cssValue: color,
    className: `text-[${color}]`,
    label: color,
  };
}

function replaceHeadingColorClass(className = '', colorClass = '') {
  const cleaned = String(className || '')
    .replace(TAILWIND_TEXT_COLOR_CLASS_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
  return uniqueList([...cleaned.split(/\s+/).filter(Boolean), colorClass]).join(' ');
}

function updateHeadingColorContent(content, target = {}, relPath = '') {
  const source = String(content || '');
  const lowerPath = String(relPath || '').toLowerCase();
  if (!/\.(html|php|jsx|tsx)$/.test(lowerPath)) return { changed: false, content: source };

  const classAttribute = /\.(jsx|tsx)$/.test(lowerPath) ? 'className' : 'class';
  const classPattern = new RegExp(`(<h1\\b[^>]*?\\b${classAttribute}=)(["'])([^"']*)(\\2)([^>]*>)`, 'i');
  if (classPattern.test(source)) {
    const next = source.replace(classPattern, (_match, prefix, quote, className, _closingQuote, rest) => {
      return `${prefix}${quote}${replaceHeadingColorClass(className, target.className)}${quote}${rest}`;
    });
    return { changed: next !== source, content: next };
  }

  const fallbackClassPattern = /(<h1\b[^>]*?\bclass=)(["'])([^"']*)(\2)([^>]*>)/i;
  if (fallbackClassPattern.test(source)) {
    const next = source.replace(fallbackClassPattern, (_match, prefix, quote, className, _closingQuote, rest) => {
      return `${prefix}${quote}${replaceHeadingColorClass(className, target.className)}${quote}${rest}`;
    });
    return { changed: next !== source, content: next };
  }

  const tagPattern = /<h1\b([^>]*)>/i;
  if (!tagPattern.test(source)) return { changed: false, content: source };
  const next = source.replace(tagPattern, (_match, attrs = '') => {
    return `<h1${attrs} ${classAttribute}="${target.className}">`;
  });
  return { changed: next !== source, content: next };
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

function replaceLiteralColor(content, fromColor, toColor) {
  const source = String(content || '');
  const from = expandShortHex(fromColor);
  const to = expandShortHex(toColor);
  if (!from || !to || from === to) return { changed: false, content: source, count: 0 };
  const pattern = new RegExp(escapeRegExp(from), 'gi');
  let count = 0;
  const next = source.replace(pattern, () => {
    count += 1;
    return to;
  });
  return { changed: next !== source, content: next, count };
}

function hexToRgb(hex) {
  const normalized = expandShortHex(hex);
  if (!normalized) return null;
  const value = normalized.replace(/^#/, '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function getHue({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (!delta) return 0;
  let hue = 0;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return Math.round((hue * 60 + 360) % 360);
}

function getLuminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isHexColorFamily(hex, family = '') {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const hue = getHue(rgb);
  const luminance = getLuminance(rgb);
  const target = String(family || '').toLowerCase();
  if (target === 'green') return hue >= 70 && hue <= 175 && rgb.g >= rgb.r && rgb.g >= rgb.b;
  if (target === 'blue') return hue >= 185 && hue <= 255 && rgb.b >= rgb.r;
  if (target === 'red') return hue <= 20 || hue >= 340;
  if (target === 'gold') return hue >= 35 && hue <= 65;
  if (target === 'dark') return luminance <= 0.24;
  if (target === 'light') return luminance >= 0.82;
  return false;
}

function replaceSemanticHexFamily(content, intent = {}) {
  const source = String(content || '');
  const targetColor = expandShortHex(intent.targetColor);
  if (!targetColor || !intent.sourceFamily) return { changed: false, content: source, count: 0 };
  let count = 0;
  const next = source.replace(/#[0-9a-fA-F]{3,6}\b/g, (match) => {
    const normalized = expandShortHex(match);
    if (!normalized || normalized === targetColor || !isHexColorFamily(normalized, intent.sourceFamily)) {
      return match;
    }
    count += 1;
    return targetColor;
  });
  return { changed: next !== source, content: next, count };
}

function replaceTailwindSemanticColorClasses(content, intent = {}) {
  const source = String(content || '');
  const targetColor = expandShortHex(intent.targetColor);
  const sourceFamily = String(intent.sourceFamily || '').toLowerCase();
  if (!targetColor || !sourceFamily) return { changed: false, content: source, count: 0 };
  const familyClass = {
    green: 'green',
    blue: 'blue',
    red: 'red',
    gold: 'yellow',
    dark: '(slate|gray|zinc|neutral|stone)',
    light: '(white|slate|gray|zinc|neutral|stone)',
  }[sourceFamily];
  if (!familyClass) return { changed: false, content: source, count: 0 };
  const scope = String(intent.targetScope || 'theme');
  const prefixes = scope === 'text'
    ? ['text']
    : scope === 'icon'
      ? ['text', 'fill', 'stroke']
      : ['text', 'bg', 'border', 'ring', 'from', 'via', 'to', 'fill', 'stroke'];
  const pattern = new RegExp(`\\b(${prefixes.join('|')})-${familyClass}-(?:50|100|200|300|400|500|600|700|800|900|950)\\b`, 'g');
  let count = 0;
  const next = source.replace(pattern, (_match, prefix) => {
    count += 1;
    return `${prefix}-[${targetColor}]`;
  });
  return { changed: next !== source, content: next, count };
}

function updateSemanticColorContent(content, intent = {}, relPath = '') {
  let next = String(content || '');
  let changed = false;
  let count = 0;
  const sourceFamilies = Array.isArray(intent.sourceFamilies) && intent.sourceFamilies.length
    ? intent.sourceFamilies
    : [intent.sourceFamily].filter(Boolean);

  for (const sourceFamily of sourceFamilies) {
    const targetColor =
      (intent.perFamilyTargets && intent.perFamilyTargets[sourceFamily]) ||
      intent.targetColor;
    const familyIntent = {
      ...intent,
      sourceFamily,
      targetColor,
    };

    const classResult = replaceTailwindSemanticColorClasses(next, familyIntent);
    if (classResult.changed) {
      next = classResult.content;
      changed = true;
      count += classResult.count || 0;
    }

    const hexResult = replaceSemanticHexFamily(next, familyIntent);
    if (hexResult.changed) {
      next = hexResult.content;
      changed = true;
      count += hexResult.count || 0;
    }
  }

  if (/\.(css|scss|sass)$/i.test(relPath)) {
    const accentResult = updateAccentColorCss(next, intent.targetColor);
    if (accentResult.changed) {
      next = accentResult.content;
      changed = true;
      count += 1;
    }
  }

  return { changed, content: next, count };
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

function buildNextFooterBlock(brand = 'Faber Projeto', options = {}) {
  const safeBrand = escapeHtmlText(brand || 'Faber Projeto');
  const backgroundColor = expandShortHex(options.backgroundColor || '');
  const toneClass = backgroundColor
    ? `bg-[${backgroundColor}] text-[var(--color-ink)]`
    : 'bg-[var(--color-ink)] text-white';
  const mutedClass = backgroundColor ? 'text-[var(--color-muted)]' : 'text-white/75';
  const linkClass = backgroundColor
    ? 'border-[var(--color-line)] text-[var(--color-ink)]'
    : 'border-white/20 text-white';
  return [
    '',
    `      <footer className="border-t border-[var(--color-line)] ${toneClass} px-5 py-10">`,
    '        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-[1fr_auto] md:items-center">',
    '          <div className="grid gap-2">',
    `            <strong className="text-base">${safeBrand}</strong>`,
    `            <span className="text-sm ${mutedClass}">© 2026 ${safeBrand}. Todos os direitos reservados.</span>`,
    '          </div>',
    '          <nav className="flex flex-wrap gap-3" aria-label="Redes sociais">',
    `            <a className="grid h-10 w-10 place-items-center rounded-full border ${linkClass} text-xs font-black" href="#" aria-label="Instagram">IG</a>`,
    `            <a className="grid h-10 w-10 place-items-center rounded-full border ${linkClass} text-xs font-black" href="#" aria-label="LinkedIn">IN</a>`,
    `            <a className="grid h-10 w-10 place-items-center rounded-full border ${linkClass} text-xs font-black" href="#" aria-label="WhatsApp">WA</a>`,
    '          </nav>',
    '        </div>',
    '      </footer>',
  ].join('\n');
}

function hasInstitutionalFooter(content = '') {
  return /<footer\b[\s\S]{0,2200}(?:Redes sociais|Todos os direitos reservados|©\s*20\d{2})/i.test(String(content || ''));
}

function patchBlueprintFooterUtility(content = '', options = {}) {
  const source = String(content || '');
  const backgroundColor = expandShortHex(options.backgroundColor || '');
  const pattern = /<BlueprintFooterUtility\b([\s\S]*?)\/>/m;
  const match = source.match(pattern);
  if (!match) return { changed: false, content: source };

  let block = match[0];
  if (backgroundColor) {
    if (/\sbackgroundColor=/.test(block)) {
      block = block.replace(/\sbackgroundColor=(?:"[^"]*"|'[^']*'|\{[^}]*\})/, ` backgroundColor="${backgroundColor}"`);
    } else {
      block = block.replace(/\s*\/>$/, ` backgroundColor="${backgroundColor}" />`);
    }
  } else if (/\stone=/.test(block)) {
    block = block.replace(/\stone=(?:"light"|'light'|\{['"]light['"]\})/, ' tone="dark"');
  } else {
    block = block.replace(/\s*\/>$/, ' tone="dark" />');
  }

  if (block === match[0]) return { changed: false, content: source };
  return { changed: true, content: source.replace(pattern, block) };
}

function insertFooterIntoNextPage(content, brand = 'Faber Projeto', options = {}) {
  const source = String(content || '');
  const componentPatch = patchBlueprintFooterUtility(source, options);
  if (componentPatch.changed) return componentPatch;
  if (hasInstitutionalFooter(source)) return { changed: false, content: source };
  if (!/<\/main>/i.test(source)) return { changed: false, content: source };
  const next = source.replace(/(\s*)<\/main>/i, `${buildNextFooterBlock(brand, options)}$1</main>`);
  return { changed: next !== source, content: next };
}

function buildHtmlFooterBlock(brand = 'Faber Projeto', options = {}) {
  const safeBrand = escapeHtmlText(brand || 'Faber Projeto');
  const backgroundColor = expandShortHex(options.backgroundColor || '');
  const style = backgroundColor ? ` style="background:${backgroundColor}"` : '';
  return [
    '',
    `<footer class="site-footer"${style}>`,
    `  <strong>${safeBrand}</strong>`,
    `  <span>© 2026 ${safeBrand}. Todos os direitos reservados.</span>`,
    '  <nav aria-label="Redes sociais"><a href="#">Instagram</a><a href="#">LinkedIn</a><a href="#">WhatsApp</a></nav>',
    '</footer>',
  ].join('\n');
}

function insertFooterIntoHtml(content, brand = 'Faber Projeto', options = {}) {
  const source = String(content || '');
  if (hasInstitutionalFooter(source)) return { changed: false, content: source };
  const block = buildHtmlFooterBlock(brand, options);
  if (/<\/body>/i.test(source)) {
    const next = source.replace(/<\/body>/i, `${block}\n</body>`);
    return { changed: next !== source, content: next };
  }
  return { changed: false, content: source };
}

module.exports = {
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
};
