const {
  escapeHtmlText,
  escapeRegExp,
  normalizeText,
} = require('./deterministic_edit_core');

const ORDINAL_INDEXES = [
  { regex: /\b(primeir[oa]|1(?:o|a)?|um|uma)\b/, index: 0 },
  { regex: /\b(segund[oa]|2(?:o|a)?|dois|duas)\b/, index: 1 },
  { regex: /\b(terceir[oa]|3(?:o|a)?|tres|tr[eê]s)\b/, index: 2 },
  { regex: /\b(quart[oa]|4(?:o|a)?)\b/, index: 3 },
  { regex: /\b(quint[oa]|5(?:o|a)?)\b/, index: 4 },
];

function extractTrailingReplacement(userMessage = '') {
  const source = String(userMessage || '').trim();
  const quoted = Array.from(source.matchAll(/\b(?:para|pra|por|como)\b[\s:,-]*(["“'])([^"”']{1,180})\1/gi)).pop();
  if (quoted && quoted[2]) return quoted[2].trim();
  const match = source.match(/\b(?:para|pra|por|como)\b\s+([^.;\n]{1,180})\s*$/i);
  return match && match[1] ? match[1].replace(/^["'“”]+|["'“”.]+$/g, '').trim() : '';
}

function extractOrdinalIndex(userMessage = '', fallback = 0) {
  const normalized = normalizeText(userMessage);
  const hit = ORDINAL_INDEXES.find((entry) => entry.regex.test(normalized));
  return hit ? hit.index : fallback;
}

function extractQuotedValue(source = '', labelPattern = '') {
  const pattern = labelPattern
    ? new RegExp(`\\b(?:${labelPattern})\\b[\\s:,-]*(["“'])([^"”']{1,220})\\1`, 'i')
    : /(["“'])([^"”']{1,220})\1/i;
  const match = String(source || '').match(pattern);
  return match && match[2] ? match[2].trim() : '';
}

function extractFromText(source = '') {
  const match = String(source || '').match(
    /\b(?:de|atual|chamado|chamada|com texto|com label|label)\s+["“']?([^"”'\n]{2,160}?)["”']?\s+\b(?:para|pra|por|como)\b/i
  );
  return match && match[1] ? match[1].trim() : '';
}

function extractHrefReplacement(source = '') {
  const match = String(source || '').match(
    /\b(?:href|link|url|destino|apontar|aponte)\b[\s\S]{0,80}?\b(?:para|pra|por|como)\b\s+(#[a-z0-9_-]+|\/[^\s"'”]+|https?:\/\/[^\s"'”]+)/i
  );
  if (match && match[1]) return match[1].trim();
  const trailing = extractTrailingReplacement(source);
  if (/^(?:#[a-z0-9_-]+|\/[^\s"'”]+|https?:\/\/[^\s"'”]+)$/i.test(trailing)) return trailing;
  return '';
}

function resolveRoleIndex(userMessage = '', fallback = 0) {
  const normalized = normalizeText(userMessage);
  if (/\b(primari[oa]|principal|primeir[oa]|1(?:o|a)?)\b/.test(normalized)) return 0;
  if (/\b(secundari[oa]|segund[oa]|2(?:o|a)?)\b/.test(normalized)) return 1;
  return extractOrdinalIndex(userMessage, fallback);
}

function isCtaTextEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  if (/\b(menu|nav|navbar|navegacao|navegação|cabecalho|cabeçalho)\b/.test(normalized)) return false;
  return (
    /\b(cta|botao|botão|link|chamada)\b/.test(normalized) &&
    /\b(texto|label|nome|href|link|url|destino|troque|mude|altere|atualize)\b/.test(normalized)
  );
}

function isSecondaryCtaEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  return isCtaTextEditRequest(userMessage) && /\b(secundari[oa]|segund[oa]|2(?:o|a)?)\b/.test(normalized);
}

function extractCtaTextEditIntent(userMessage = '') {
  if (!isCtaTextEditRequest(userMessage)) return null;
  const source = String(userMessage || '');
  const toHref = extractHrefReplacement(source);
  const replacement = extractTrailingReplacement(source);
  return {
    fromText: extractFromText(source),
    toText: toHref ? '' : replacement,
    toHref,
    index: resolveRoleIndex(source, 0),
  };
}

function extractSecondaryCtaEditIntent(userMessage = '') {
  const intent = extractCtaTextEditIntent(userMessage);
  return intent && isSecondaryCtaEditRequest(userMessage) ? { ...intent, index: 1 } : null;
}

function replaceNthSimpleActionInner(content = '', intent = {}, options = {}) {
  const source = String(content || '');
  const actionPattern = options.anchorOnly
    ? /<(?<tag>a)\b(?<attrs>[^>]*)>(?<inner>[^<]{1,180})<\/\k<tag>>/gi
    : /<(?<tag>a|button)\b(?<attrs>[^>]*)>(?<inner>[^<]{1,180})<\/\k<tag>>/gi;
  const matches = Array.from(source.matchAll(actionPattern));
  if (!matches.length) return { changed: false, content: source };
  const fromNormalized = normalizeText(intent.fromText || '');
  const targetIndex = Number.isInteger(intent.index) ? intent.index : 1;
  const match = fromNormalized
    ? matches.find((entry) => normalizeText(entry.groups && entry.groups.inner) === fromNormalized)
    : matches[targetIndex] || matches[0];
  if (!match || match.index === undefined) return { changed: false, content: source };

  let replacement = match[0];
  if (intent.toText) {
    replacement = replacement.replace(
      /(<(?:a|button)\b[^>]*>)([^<]{1,180})(<\/(?:a|button)>)/i,
      `$1${escapeHtmlText(intent.toText)}$3`
    );
  }
  if (intent.toHref && /^<a\b/i.test(replacement)) {
    if (/\bhref=/.test(replacement)) {
      replacement = replacement.replace(/\bhref=(["'])([^"']*)(\1)/i, `href=$1${intent.toHref}$3`);
    } else {
      replacement = replacement.replace(/^<a\b/i, `<a href="${intent.toHref}"`);
    }
  }
  if (replacement === match[0]) return { changed: false, content: source };
  return {
    changed: true,
    content: `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`,
  };
}

function updateCtaTextContent(content = '', intent = {}) {
  const source = String(content || '');
  const hero = findSectionBlock(source, 'hero') || findSectionBlock(source, 'inicio') || source.match(/<section\b[\s\S]*?<\/section>/i);
  const region = hero ? (hero.block || hero[0]) : source;
  const regionIndex = hero && hero.index !== undefined ? hero.index : 0;
  const result = replaceNthSimpleActionInner(region, intent);
  if (!result.changed) return { changed: false, content: source };
  return {
    changed: true,
    content: `${source.slice(0, regionIndex)}${result.content}${source.slice(regionIndex + region.length)}`,
  };
}

function isCardTextEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(card|cartao|cartão)\b/.test(normalized) &&
    /\b(troque|mude|altere|atualize|substitua|edite|editar)\b/.test(normalized) &&
    /\b(texto|titulo|título|descricao|descrição|label|para|pra|por)\b/.test(normalized)
  );
}

function extractCardTextEditIntent(userMessage = '') {
  if (!isCardTextEditRequest(userMessage)) return null;
  const normalized = normalizeText(userMessage);
  const replacement = extractTrailingReplacement(userMessage);
  if (!replacement) return null;
  return {
    index: extractOrdinalIndex(userMessage, 0),
    fromText: extractFromText(userMessage),
    field: /\b(descricao|descrição|paragrafo|parágrafo|body|corpo)\b/.test(normalized) ? 'description' : 'title',
    text: replacement,
  };
}

function replaceNthCardHeading(content = '', intent = {}) {
  return updateCardTextContent(content, { ...intent, field: 'title' });
}

function updateCardTextContent(content = '', intent = {}) {
  const source = String(content || '');
  const cards = Array.from(source.matchAll(/<article\b[\s\S]*?<\/article>/gi));
  const fromNormalized = normalizeText(intent.fromText || '');
  const card = fromNormalized
    ? cards.find((entry) => normalizeText(entry[0]).includes(fromNormalized))
    : cards[Number.isInteger(intent.index) ? intent.index : 0];
  if (!card || card.index === undefined) return { changed: false, content: source };
  const block = card[0];
  const targetPattern = intent.field === 'description'
    ? /(<p\b[^>]*>)([^<]{1,260})(<\/p>)/i
    : /(<h[2-4]\b[^>]*>)([^<]{1,180})(<\/h[2-4]>)/i;
  if (!targetPattern.test(block)) return { changed: false, content: source };
  const nextBlock = block.replace(targetPattern, `$1${escapeHtmlText(intent.text)}$3`);
  if (nextBlock === block) return { changed: false, content: source };
  return {
    changed: true,
    content: `${source.slice(0, card.index)}${nextBlock}${source.slice(card.index + block.length)}`,
  };
}

function isGridColumnsEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(grid|coluna|colunas|cards)\b/.test(normalized) &&
    /\b(mude|altere|ajuste|troque|defina|coloque)\b/.test(normalized) &&
    /\b(coluna|colunas|grid-cols)\b/.test(normalized)
  );
}

function extractGridColumnsIntent(userMessage = '') {
  if (!isGridColumnsEditRequest(userMessage)) return null;
  const normalized = normalizeText(userMessage);
  const numeric = normalized.match(/\b([2-6])\s+colunas?\b/);
  const wordMap = [
    { regex: /\bduas?\s+colunas?\b/, count: 2 },
    { regex: /\btres|tr[eê]s\s+colunas?\b/, count: 3 },
    { regex: /\bquatro\s+colunas?\b/, count: 4 },
  ];
  const wordHit = wordMap.find((entry) => entry.regex.test(normalized));
  const count = numeric ? Number(numeric[1]) : wordHit ? wordHit.count : 0;
  if (!count) return null;
  return {
    count,
    breakpoint: /\bdesktop|lg|large|grande\b/.test(normalized) ? 'lg' : 'md',
    sectionId: /\bservicos|serviços\b/.test(normalized) ? 'servicos' : '',
  };
}

function replaceGridColumnsInClassName(className = '', intent = {}) {
  const breakpoint = intent.breakpoint || 'md';
  const nextClass = `${breakpoint}:grid-cols-${intent.count}`;
  let classes = String(className || '').split(/\s+/).filter(Boolean);
  let replaced = false;
  classes = classes.map((entry) => {
    if (new RegExp(`^${breakpoint}:grid-cols-\\d+$`).test(entry)) {
      replaced = true;
      return nextClass;
    }
    return entry;
  });
  if (!replaced) {
    const anyResponsiveIndex = classes.findIndex((entry) => /^(?:sm|md|lg|xl|2xl):grid-cols-\d+$/.test(entry));
    if (anyResponsiveIndex >= 0) classes[anyResponsiveIndex] = nextClass;
    else classes.push(nextClass);
  }
  return Array.from(new Set(classes)).join(' ');
}

function updateGridColumnsContent(content = '', intent = {}) {
  const source = String(content || '');
  const sectionPattern = intent.sectionId
    ? new RegExp(`<section\\b[^>]*\\bid=["']${intent.sectionId}["'][\\s\\S]*?<\\/section>`, 'i')
    : /<section\b[\s\S]*?<\/section>/i;
  const sectionMatch = source.match(sectionPattern);
  const region = sectionMatch ? sectionMatch[0] : source;
  const regionStart = sectionMatch && sectionMatch.index !== undefined ? sectionMatch.index : 0;
  const classPattern = /(className|class)=(["'])([^"']*\bgrid\b[^"']*)(\2)/i;
  if (!classPattern.test(region)) return { changed: false, content: source };
  const nextRegion = region.replace(classPattern, (_full, attr, quote, className, closing) => {
    return `${attr}=${quote}${replaceGridColumnsInClassName(className, intent)}${closing}`;
  });
  if (nextRegion === region) return { changed: false, content: source };
  return {
    changed: true,
    content: `${source.slice(0, regionStart)}${nextRegion}${source.slice(regionStart + region.length)}`,
  };
}

function isSectionReorderRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(mova|mover|reordene|reordenar|coloque|posicione)\b/.test(normalized) &&
    /\b(secao|seção|section|faq|depoimentos|servicos|serviços)\b/.test(normalized) &&
    /\b(antes|depois|apos|após)\b/.test(normalized)
  );
}

function resolveSectionIdFromText(value = '') {
  const normalized = normalizeText(value);
  const quoted = extractQuotedValue(value);
  if (quoted) return normalizeText(quoted).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (/\bfaq|perguntas?\b/.test(normalized)) return 'faq';
  if (/\bdepoimentos?|testimonials?|prova social\b/.test(normalized)) return 'depoimentos';
  if (/\bservicos|serviços|solucoes|soluções\b/.test(normalized)) return 'servicos';
  if (/\bcontato|orcamento|orçamento\b/.test(normalized)) return 'contato';
  if (/\bblog|artigos?\b/.test(normalized)) return 'blog';
  if (/\bsobre\b/.test(normalized)) return 'sobre';
  if (/\bhero|topo|inicio|início\b/.test(normalized)) return 'hero';
  return '';
}

function extractSectionReorderIntent(userMessage = '') {
  if (!isSectionReorderRequest(userMessage)) return null;
  const source = String(userMessage || '');
  const normalized = normalizeText(source);
  const before = /\bantes\b/.test(normalized);
  const sourcePart = source.split(/\b(?:antes|depois|apos|após)\b/i)[0] || source;
  const targetPart = source.split(/\b(?:antes|depois|apos|após)\b/i).slice(1).join(' ') || '';
  const sourceId = resolveSectionIdFromText(sourcePart);
  const targetId = resolveSectionIdFromText(targetPart);
  if (!sourceId || !targetId || sourceId === targetId) return null;
  return {
    sourceId,
    targetId,
    position: before ? 'before' : 'after',
  };
}

function findSectionBlock(source = '', id = '') {
  const rawId = String(id || '').trim();
  const pattern = rawId
    ? new RegExp(`<section\\b[^>]*\\bid=["']${escapeRegExp(rawId)}["'][\\s\\S]*?<\\/section>`, 'i')
    : null;
  const text = String(source || '');
  const match = pattern ? text.match(pattern) : null;
  if (match && match.index !== undefined) {
    return {
      index: match.index,
      block: match[0],
      end: match.index + match[0].length,
    };
  }
  const targetHeading = normalizeText(rawId).replace(/-/g, ' ');
  if (!targetHeading) return null;
  const sections = Array.from(text.matchAll(/<section\b[\s\S]*?<\/section>/gi));
  const headingPattern = /<h[1-4]\b[^>]*>([^<]{1,180})<\/h[1-4]>/i;
  const section = sections.find((entry) => {
    const heading = entry[0].match(headingPattern);
    return heading && normalizeText(heading[1]).includes(targetHeading);
  });
  if (!section || section.index === undefined) return null;
  return {
    index: section.index,
    block: section[0],
    end: section.index + section[0].length,
  };
}

function reorderSectionContent(content = '', intent = {}) {
  let source = String(content || '');
  const sourceBlock = findSectionBlock(source, intent.sourceId);
  const targetBlock = findSectionBlock(source, intent.targetId);
  if (!sourceBlock || !targetBlock) return { changed: false, content: source };

  source = `${source.slice(0, sourceBlock.index)}${source.slice(sourceBlock.end)}`;
  const targetAfterRemoval = findSectionBlock(source, intent.targetId);
  if (!targetAfterRemoval) return { changed: false, content: String(content || '') };

  const insertAt = intent.position === 'after' ? targetAfterRemoval.end : targetAfterRemoval.index;
  const separatorBefore = insertAt > 0 && source[insertAt - 1] !== '\n' ? '\n' : '';
  const separatorAfter = source[insertAt] && source[insertAt] !== '\n' ? '\n' : '';
  const next = `${source.slice(0, insertAt)}${separatorBefore}${sourceBlock.block}${separatorAfter}${source.slice(insertAt)}`;
  return { changed: next !== content, content: next };
}

function isFaqItemPatchRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(faq|pergunta|perguntas|resposta|respostas)\b/.test(normalized) &&
    /\b(adicione|adicionar|inclua|incluir|crie|criar|remova|remover|exclua|excluir|apague|apagar|troque|mude|altere|edite|editar|atualize)\b/.test(normalized)
  );
}

function extractFaqItemPatchIntent(userMessage = '') {
  if (!isFaqItemPatchRequest(userMessage)) return null;
  const source = String(userMessage || '');
  const normalized = normalizeText(source);
  const action = /\b(remova|remover|exclua|excluir|apague|apagar)\b/.test(normalized)
    ? 'remove'
    : /\b(adicione|adicionar|inclua|incluir|crie|criar)\b/.test(normalized)
      ? 'add'
      : 'edit';
  const question =
    extractQuotedValue(source, 'pergunta|faq') ||
    (source.match(/\bpergunta\s+([^.;\n]{4,180})/i) || [])[1] ||
    extractFromText(source);
  const answer =
    extractQuotedValue(source, 'resposta') ||
    (source.match(/\bresposta\s+["“']?([^"”'\n]{2,260})["”']?/i) || [])[1] ||
    '';
  const replacement = extractTrailingReplacement(source);
  const editsAnswer = /\bresposta\b/.test(normalized);
  return {
    action,
    question: String(question || '').trim(),
    answer: action === 'add' ? String(answer || '').trim() : '',
    toQuestion: action === 'edit' && !editsAnswer && /\bpergunta\b/.test(normalized) ? replacement : '',
    toAnswer: action === 'edit' && editsAnswer ? (replacement || answer) : '',
  };
}

function buildFaqItemBlock(question = '', answer = '') {
  return [
    '        <article>',
    `          <h3>${escapeHtmlText(question)}</h3>`,
    `          <p>${escapeHtmlText(answer || 'Resposta em revisão.')}</p>`,
    '        </article>',
  ].join('\n');
}

function findContentBlockContaining(source = '', needle = '') {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return null;
  const patterns = [
    /<article\b[\s\S]*?<\/article>/gi,
    /<li\b[\s\S]*?<\/li>/gi,
    /<div\b[\s\S]*?<\/div>/gi,
  ];
  for (const pattern of patterns) {
    const matches = Array.from(String(source || '').matchAll(pattern));
    const found = matches.find((entry) => normalizeText(entry[0]).includes(normalizedNeedle));
    if (found && found.index !== undefined) {
      return { index: found.index, block: found[0], end: found.index + found[0].length };
    }
  }
  return null;
}

function updateFaqItemContent(content = '', intent = {}) {
  const source = String(content || '');
  const section = findSectionBlock(source, 'faq');
  if (!section) return { changed: false, content: source };
  const sectionBlock = section.block;

  if (intent.action === 'add') {
    if (!intent.question) return { changed: false, content: source };
    const item = buildFaqItemBlock(intent.question, intent.answer);
    const nextBlock = sectionBlock.replace(/<\/section>\s*$/i, `${item}\n      </section>`);
    return {
      changed: nextBlock !== sectionBlock,
      content: `${source.slice(0, section.index)}${nextBlock}${source.slice(section.end)}`,
    };
  }

  const item = findContentBlockContaining(sectionBlock, intent.question);
  if (!item) return { changed: false, content: source };
  if (intent.action === 'remove') {
    const nextBlock = `${sectionBlock.slice(0, item.index)}${sectionBlock.slice(item.end)}`;
    return {
      changed: nextBlock !== sectionBlock,
      content: `${source.slice(0, section.index)}${nextBlock}${source.slice(section.end)}`,
    };
  }

  let nextItem = item.block;
  if (intent.toQuestion) {
    nextItem = nextItem.replace(/(<h[2-4]\b[^>]*>)([^<]{1,180})(<\/h[2-4]>)/i, `$1${escapeHtmlText(intent.toQuestion)}$3`);
  }
  if (intent.toAnswer) {
    nextItem = nextItem.replace(/(<p\b[^>]*>)([^<]{1,260})(<\/p>)/i, `$1${escapeHtmlText(intent.toAnswer)}$3`);
  }
  if (nextItem === item.block) return { changed: false, content: source };
  const nextBlock = `${sectionBlock.slice(0, item.index)}${nextItem}${sectionBlock.slice(item.end)}`;
  return {
    changed: true,
    content: `${source.slice(0, section.index)}${nextBlock}${source.slice(section.end)}`,
  };
}

function isNavLinkEditRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(menu|nav|navbar|navegacao|navegação|cabecalho|cabeçalho)\b/.test(normalized) &&
    /\b(link|item|label|href|url|destino|texto)\b/.test(normalized) &&
    /\b(troque|mude|altere|atualize|renomeie|aponte)\b/.test(normalized)
  );
}

function extractNavLinkEditIntent(userMessage = '') {
  if (!isNavLinkEditRequest(userMessage)) return null;
  const source = String(userMessage || '');
  const toHref = extractHrefReplacement(source);
  const replacement = extractTrailingReplacement(source);
  return {
    fromText: extractFromText(source),
    toText: toHref ? '' : replacement,
    toHref,
    index: extractOrdinalIndex(source, 0),
  };
}

function updateNavLinkContent(content = '', intent = {}) {
  const source = String(content || '');
  const regionMatch = source.match(/<nav\b[\s\S]*?<\/nav>/i) || source.match(/<header\b[\s\S]*?<\/header>/i);
  if (!regionMatch || regionMatch.index === undefined) return { changed: false, content: source };
  const result = replaceNthSimpleActionInner(regionMatch[0], intent, { anchorOnly: true });
  if (!result.changed) return { changed: false, content: source };
  return {
    changed: true,
    content: `${source.slice(0, regionMatch.index)}${result.content}${source.slice(regionMatch.index + regionMatch[0].length)}`,
  };
}

function isSectionRemoveRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(remova|remover|exclua|excluir|apague|apagar|delete)\b/.test(normalized) &&
    /\b(secao|seção|section|faq|depoimentos|servicos|serviços|sobre|blog|contato)\b/.test(normalized)
  );
}

function extractSectionRemoveIntent(userMessage = '') {
  if (!isSectionRemoveRequest(userMessage)) return null;
  const sectionId = resolveSectionIdFromText(userMessage);
  return sectionId ? { sectionId } : null;
}

function removeSectionContent(content = '', intent = {}) {
  const source = String(content || '');
  const section = findSectionBlock(source, intent.sectionId);
  if (!section) return { changed: false, content: source };
  const before = source.slice(0, section.index).replace(/[ \t]+$/g, '');
  const after = source.slice(section.end).replace(/^\s*\n?/, '\n');
  return { changed: true, content: `${before}${after}` };
}

function isFormFieldPatchRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(formulario|formulário|form|campo|input|field)\b/.test(normalized) &&
    /\b(adicione|adicionar|inclua|incluir|crie|criar|renomeie|renomear|troque|mude|altere|atualize)\b/.test(normalized)
  );
}

function extractFormFieldPatchIntent(userMessage = '') {
  if (!isFormFieldPatchRequest(userMessage)) return null;
  const source = String(userMessage || '');
  const normalized = normalizeText(source);
  const action = /\b(adicione|adicionar|inclua|incluir|crie|criar)\b/.test(normalized) ? 'add' : 'rename';
  const fieldRenameFrom = (source.match(/\bcampo\s+["“']?([^"”'\n]{1,80}?)["”']?\s+\b(?:para|pra|por|como)\b/i) || [])[1] || '';
  const rawFieldLabel =
    extractQuotedValue(source, 'campo|input|field') ||
    (source.match(/\bcampo\s+([^.;\n]{2,80})/i) || [])[1] ||
    '';
  const fieldLabel = String(rawFieldLabel || '').replace(/\s+(?:ao|no|na|do|da)\s+formul[aá]rio.*$/i, '').trim();
  const fromText = extractFromText(source) || fieldRenameFrom || fieldLabel;
  const toText = action === 'rename' ? extractTrailingReplacement(source) : fieldLabel;
  const type = /\b(email|e-mail)\b/.test(normalized)
    ? 'email'
    : /\b(telefone|whatsapp|celular|phone|tel)\b/.test(normalized)
      ? 'tel'
      : 'text';
  return {
    action,
    fromText: String(fromText || '').trim(),
    toText: String(toText || '').trim(),
    type,
  };
}

function fieldNameFromLabel(label = '') {
  return normalizeText(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'campo';
}

function buildFormFieldBlock(label = '', type = 'text') {
  const name = fieldNameFromLabel(label);
  return [
    '        <label>',
    `          <span>${escapeHtmlText(label)}</span>`,
    `          <input name="${name}" type="${type}" placeholder="${escapeHtmlText(label)}" />`,
    '        </label>',
  ].join('\n');
}

function updateFormFieldContent(content = '', intent = {}) {
  const source = String(content || '');
  const form = source.match(/<form\b[\s\S]*?<\/form>/i);
  if (!form || form.index === undefined) return { changed: false, content: source };
  const block = form[0];
  if (intent.action === 'add') {
    if (!intent.toText) return { changed: false, content: source };
    const nextBlock = block.replace(/<\/form>\s*$/i, `${buildFormFieldBlock(intent.toText, intent.type)}\n      </form>`);
    return {
      changed: nextBlock !== block,
      content: `${source.slice(0, form.index)}${nextBlock}${source.slice(form.index + block.length)}`,
    };
  }

  if (!intent.fromText || !intent.toText) return { changed: false, content: source };
  const fromPattern = new RegExp(escapeRegExp(intent.fromText), 'i');
  if (!fromPattern.test(block)) return { changed: false, content: source };
  const nextBlock = block
    .replace(fromPattern, escapeHtmlText(intent.toText))
    .replace(
      new RegExp(`placeholder=(["'])${escapeRegExp(intent.fromText)}\\1`, 'i'),
      (_full, quote) => `placeholder=${quote}${escapeHtmlText(intent.toText)}${quote}`
    );
  return {
    changed: nextBlock !== block,
    content: `${source.slice(0, form.index)}${nextBlock}${source.slice(form.index + block.length)}`,
  };
}

function isStatTextPatchRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(metrica|métrica|metricas|métricas|stat|stats|numero|número|contador|indicador|indicadores|kpi)\b/.test(normalized) &&
    /\b(troque|mude|altere|atualize|renomeie)\b/.test(normalized)
  );
}

function extractStatTextPatchIntent(userMessage = '') {
  if (!isStatTextPatchRequest(userMessage)) return null;
  const fromText = extractFromText(userMessage) || (String(userMessage || '').match(/\b(?:numero|número|label|m[eé]trica)\s+["“']?([^"”'\n]{1,80}?)["”']?\s+\b(?:para|pra|por|como)\b/i) || [])[1];
  const toText = extractTrailingReplacement(userMessage);
  return fromText && toText ? { fromText: String(fromText).trim(), toText } : null;
}

function updateStatTextContent(content = '', intent = {}) {
  const source = String(content || '');
  if (!intent.fromText || !intent.toText) return { changed: false, content: source };
  const section =
    findSectionBlock(source, 'metricas') ||
    findSectionBlock(source, 'métricas') ||
    findSectionBlock(source, 'metrics') ||
    findSectionBlock(source, 'stats') ||
    findSectionBlock(source, 'indicadores');
  const region = section ? section.block : source;
  const regionIndex = section ? section.index : 0;
  const pattern = new RegExp(escapeRegExp(intent.fromText));
  if (!pattern.test(region)) return { changed: false, content: source };
  const nextRegion = region.replace(pattern, escapeHtmlText(intent.toText));
  return {
    changed: true,
    content: `${source.slice(0, regionIndex)}${nextRegion}${source.slice(regionIndex + region.length)}`,
  };
}

function isHeroMediaPatchRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  return (
    /\b(hero|topo|capa|banner|imagem|foto|video|vídeo|media|mídia)\b/.test(normalized) &&
    /\b(src|alt|poster|url|imagem|foto|video|vídeo)\b/.test(normalized) &&
    /\b(troque|mude|altere|atualize|substitua)\b/.test(normalized)
  );
}

function extractHeroMediaPatchIntent(userMessage = '') {
  if (!isHeroMediaPatchRequest(userMessage)) return null;
  const source = String(userMessage || '');
  const normalized = normalizeText(source);
  const attr = /\bposter\b/.test(normalized) ? 'poster' : /\balt|descricao|descrição\b/.test(normalized) ? 'alt' : 'src';
  const explicitUrl = (source.match(/(?:https?:\/\/[^\s"'”]+|\/[^\s"'”]+\.(?:png|jpe?g|webp|gif|mp4|webm|avif|svg))/i) || [])[0];
  const value = attr === 'alt'
    ? extractTrailingReplacement(source)
    : explicitUrl || extractTrailingReplacement(source);
  if (!value) return null;
  return {
    attr,
    value: value.trim(),
    mediaKind: /\b(video|vídeo|poster)\b/.test(normalized) ? 'video' : 'image',
  };
}

function replaceOrInsertAttribute(tag = '', attr = '', value = '') {
  const safeValue = attr === 'alt' ? escapeHtmlText(value) : value;
  const pattern = new RegExp(`\\b${escapeRegExp(attr)}=(["'])([^"']*)\\1`, 'i');
  if (pattern.test(tag)) return tag.replace(pattern, `${attr}=$1${safeValue}$1`);
  return tag.replace(/>$/, ` ${attr}="${safeValue}">`);
}

function updateHeroMediaContent(content = '', intent = {}) {
  const source = String(content || '');
  const hero = findSectionBlock(source, 'hero') || findSectionBlock(source, 'inicio') || source.match(/<section\b[\s\S]*?<\/section>/i);
  if (!hero) return { changed: false, content: source };
  const region = hero.block || hero[0];
  const regionIndex = hero.index || 0;
  let nextRegion = region;
  if (intent.mediaKind === 'video') {
    if (intent.attr === 'src') {
      if (/<source\b/i.test(region)) {
        nextRegion = region.replace(/<source\b[^>]*>/i, (tag) => replaceOrInsertAttribute(tag, 'src', intent.value));
      } else {
        nextRegion = region.replace(/<video\b[^>]*>/i, (tag) => replaceOrInsertAttribute(tag, 'src', intent.value));
      }
    } else {
      nextRegion = region.replace(/<video\b[^>]*>/i, (tag) => replaceOrInsertAttribute(tag, intent.attr, intent.value));
    }
  } else {
    nextRegion = region.replace(/<img\b[^>]*>/i, (tag) => replaceOrInsertAttribute(tag, intent.attr, intent.value));
  }
  if (nextRegion === region) return { changed: false, content: source };
  return {
    changed: true,
    content: `${source.slice(0, regionIndex)}${nextRegion}${source.slice(regionIndex + region.length)}`,
  };
}

module.exports = {
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
};
