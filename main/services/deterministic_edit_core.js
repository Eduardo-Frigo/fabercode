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
  if (!/\b(titulo|titulos|h1|headline|chamada principal)\b/.test(normalized)) return '';
  if (/\b(cor|color|imagem|image|foto|overlay|fundo|background)\b/.test(normalized)) return '';

  const explicitPattern =
    /\b(?:mude|altere|troque|substitua|atualize|renomeie|editar|edite)\b[\s\S]{0,100}?\b(?:t[ií]tulo|t[ií]tulos|h1|headline|chamada principal)\b[\s\S]{0,100}?\b(para|pra|por|como)\b/i;
  const explicit = source.match(explicitPattern);
  if (!explicit || explicit.index === undefined) return '';

  const markerIndex = explicit.index + explicit[0].toLowerCase().lastIndexOf(String(explicit[1] || '').toLowerCase());
  if (markerIndex >= 0) {
    const quoted = extractQuotedTextAfterMarker(source, markerIndex);
    if (quoted) return quoted;
  }

  const fallback = source.slice(Math.max(0, markerIndex)).match(/\b(?:para|pra|por|como)\s+(.+)$/i);
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

  const targetColor = extractRequestedTargetColor(source);
  if (targetColor) return targetColor;

  return resolveColorKeyword(source);
}

function resolveColorKeyword(text = '') {
  const normalized = normalizeText(text);
  const colorMap = [
    { regex: /vermelho\s+coral|coral/, value: '#cf416b' },
    { regex: /vermelh[oa]/, value: '#cf416b' },
    { regex: /azul\s+(suave|claro|leve)/, value: '#4293c2' },
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

function extractRequestedTargetColor(userMessage = '') {
  const source = String(userMessage || '');
  const bridgeMatches = Array.from(source.matchAll(/\b(?:para|pra|por|como|vira|virar)\b/gi));
  if (!bridgeMatches.length) return '';
  const lastBridge = bridgeMatches[bridgeMatches.length - 1];
  const slice = source.slice(lastBridge.index);
  const hex = slice.match(/#[0-9a-fA-F]{3,6}\b/);
  if (hex) return expandShortHex(hex[0]);
  return resolveColorKeyword(slice);
}

function listRequestedSourceColorFamilies(normalized = '') {
  const families = [];
  const add = (family) => {
    if (!families.includes(family)) families.push(family);
  };
  if (/\bverde\b/.test(normalized)) add('green');
  if (/\bvermelh|coral\b/.test(normalized)) add('red');
  if (/\bazul\b/.test(normalized)) add('blue');
  if (/\bpreto|escuro\b/.test(normalized)) add('dark');
  if (/\bbranco|claro\b/.test(normalized)) add('light');
  if (/\bdourado|dourad[oa]s|ouro\b/.test(normalized)) add('gold');
  return families;
}

function sourceColorFamilyPattern(family = '') {
  return {
    green: '(?:verde|green)',
    red: '(?:vermelh[oa]s?|red|coral)',
    blue: '(?:azuis|azul|blue)',
    dark: '(?:preto|escuro|dark)',
    light: '(?:branco|claro|white)',
    gold: '(?:dourad[oa]s?|ouro|gold)',
  }[String(family || '').toLowerCase()] || '';
}

function extractTargetColorForSourceFamily(userMessage = '', family = '') {
  const source = String(userMessage || '');
  const familyPattern = sourceColorFamilyPattern(family);
  if (!familyPattern) return '';
  const pattern = new RegExp(
    `${familyPattern}[\\s\\S]{0,140}?\\b(?:para|pra|por|como|vira|virar|usando|usar|use|com)\\b[\\s\\S]{0,100}?(#[0-9a-fA-F]{3,6}\\b)`,
    'i'
  );
  const match = source.match(pattern);
  return match && match[1] ? expandShortHex(match[1]) : '';
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLiteralColorReplacementIntent(userMessage = '') {
  const source = String(userMessage || '');
  const normalized = normalizeText(source);
  if (!normalized) return null;

  const hexes = Array.from(source.matchAll(/#[0-9a-fA-F]{3,6}\b/g))
    .map((match) => expandShortHex(match[0]))
    .filter(Boolean);
  const uniqueHexes = uniqueList(hexes);
  if (uniqueHexes.length < 2) return null;

  const hasReplacementVerb = /\b(altere|alterar|mude|mudar|troque|trocar|substitua|substituir|atualize|atualizar|onde for|aonde for|quando for)\b/.test(
    normalized
  );
  const hasReplacementBridge = /\b(para|por|pela|pelo|vira|virar|como)\b/.test(normalized);
  const hasColorScope = /\b(cor|cores|hex|paleta|tema|visual|azul|verde|vermelh|dourado|preto|branco)\b/.test(
    normalized
  );
  if (!hasReplacementVerb || !hasReplacementBridge || !hasColorScope) return null;

  const explicitReplacement =
    source.match(
      /\b(?:onde|aonde|quando)\s+for\s+(#[0-9a-fA-F]{3,6}\b)[\s\S]{0,140}?\b(?:para|pra|por|pela|pelo|vira|virar|como)\b[\s\S]{0,140}?(#[0-9a-fA-F]{3,6}\b)/i
    ) ||
    source.match(
      /\b(?:troque|trocar|substitua|substituir|altere|alterar)\s+(?:a\s+cor\s+|o\s+hex\s+)?(#[0-9a-fA-F]{3,6}\b)[\s\S]{0,140}?\b(?:para|pra|por|pela|pelo|vira|virar|como)\b[\s\S]{0,140}?(#[0-9a-fA-F]{3,6}\b)/i
    );
  if (!explicitReplacement) return null;

  return {
    kind: 'literal_color_replacement',
    from: expandShortHex(explicitReplacement[1]),
    to: expandShortHex(explicitReplacement[2]),
  };
}

function isLiteralColorReplacementRequest(userMessage = '') {
  return Boolean(extractLiteralColorReplacementIntent(userMessage));
}

function isButtonColorEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  const hasButtonTarget = /\b(botao|button|cta|chamada)\b/.test(normalized);
  const hasEditVerb = /\b(ajuste|ajustar|mude|alterar|altere|troque|trocar|substitua|atualize|defina|coloque)\b/.test(normalized);
  const hasColor = /#[0-9a-f]{3,6}\b/.test(normalized) || /\b(cor|vermelh|coral|verde|azul|preto|branco|dourado|ouro|marinho|petroleo)\b/.test(normalized);
  return Boolean(hasButtonTarget && hasEditVerb && hasColor);
}

function isThemeColorEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  const hasEditVerb = /\b(ajuste|ajustar|mude|mudar|alterar|altere|troque|trocar|substitua|atualize|atualizar|defina|coloque)\b/.test(
    normalized
  );
  const hasThemeTarget = /\b(cor|cores|paleta|tema|visual|accent|acento|principal|primaria|primario)\b/.test(normalized);
  const hasColor = /#[0-9a-f]{3,6}\b/.test(normalized) ||
    /\b(vermelh|coral|verde|azul|preto|branco|dourado|ouro|marinho|petroleo)\b/.test(normalized);
  return Boolean(hasEditVerb && hasThemeTarget && hasColor);
}

function extractSemanticColorEditIntent(userMessage = '') {
  const source = String(userMessage || '');
  const normalized = normalizeText(source);
  if (!normalized) return null;
  const hasEditVerb = /\b(ajuste|ajustar|mude|mudar|alterar|altere|troque|trocar|substitua|atualize|atualizar|defina|coloque)\b/.test(
    normalized
  );
  const hasBridge = /\b(para|pra|por|como|vira|virar)\b/.test(normalized);
  const sourceFamilies = listRequestedSourceColorFamilies(normalized);
  const hasSourceColor = sourceFamilies.length > 0 || /\b(marinho|petroleo)\b/.test(normalized);
  const hasTargetScope = /\b(texto|textos|fonte|fontes|icone|icones|ícone|ícones|cor|cores|paleta|visual|tema|accent|acento|principal|ocorrencia|ocorrencias|todas|todos)\b/.test(
    normalized
  );
  const normalizedFamilies = sourceFamilies.length
    ? sourceFamilies
    : /\bmarinho|petroleo\b/.test(normalized)
      ? ['blue']
      : [];
  const fallbackTargetColor = extractRequestedTargetColor(source);
  const perFamilyTargets = normalizedFamilies.reduce((acc, family) => {
    acc[family] = extractTargetColorForSourceFamily(source, family) || fallbackTargetColor;
    return acc;
  }, {});
  const targetColor = perFamilyTargets[normalizedFamilies[0]] || fallbackTargetColor;
  if (!hasEditVerb || !hasBridge || !hasSourceColor || !hasTargetScope || !targetColor) return null;

  const sourceFamily = normalizedFamilies[0] || 'blue';

  const targetScope = /\b(texto|textos|fonte|fontes)\b/.test(normalized)
    ? 'text'
    : /\b(icone|icones|ícone|ícones)\b/.test(normalized)
      ? 'icon'
      : 'theme';

  return {
    kind: 'semantic_color_edit',
    sourceFamily,
    sourceFamilies: normalizedFamilies,
    targetColor,
    perFamilyTargets,
    targetScope,
  };
}

function isSemanticColorEditRequest(userMessage = '') {
  return Boolean(extractSemanticColorEditIntent(userMessage));
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

function uniqueList(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

module.exports = {
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
  uniqueList,
};
