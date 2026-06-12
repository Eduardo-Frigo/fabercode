const defaultFs = require('fs');
const defaultPath = require('path');

const {
  escapeHtmlText,
  normalizeText,
  uniqueList,
} = require('./deterministic_edit_core');
const {
  isUnsupportedBackgroundMediaRequest,
} = require('./deterministic_edit_styles');

const VISUAL_HERO_PATCH_SCHEMA_VERSION = 'visual-hero-overlay-patch-v1';

function wantsHeroVideo(userMessage = '') {
  return /\b(video|vídeo|videos|vídeos)\b/.test(normalizeText(userMessage));
}

function wantsDifferentHeroVideo(userMessage = '') {
  const normalized = normalizeText(userMessage);
  return /\b(outro|outra|troque|trocar|mude|mudar|substitua|substituir|diferente|novo|nova)\b/.test(normalized) &&
    /\b(video|videos)\b/.test(normalized);
}

function isHeroVisualOverlayRequest(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (!normalized) return false;
  if (!/\b(hero|topo|capa|banner|inicio|início|body)\b/.test(normalized)) return false;
  if (isUnsupportedBackgroundMediaRequest(userMessage)) return true;
  return /\b(video|vídeo|midia|mídia|imagem|foto|overlay|sobreposicao|sobreposição|camada|blend)\b/.test(normalized);
}

function pickHeroMediaLabel(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (/\babelha|abelhas|bee|bees\b/.test(normalized)) return 'abelhas voando';
  if (/\bfolha|folhas\b/.test(normalized)) return 'folhas em movimento';
  if (/\bluz|sol|natural\b/.test(normalized)) return 'luz natural em movimento';
  return 'movimento visual de fundo';
}

function pickHeroMediaSearchQuery(userMessage = '') {
  const normalized = normalizeText(userMessage);
  if (/\babelha|abelhas|bee|bees\b/.test(normalized)) return 'honey bees flying flowers pollination macro';
  if (/\bfolha|folhas\b/.test(normalized)) return 'leaves moving natural light';
  if (/\bluz|sol|natural\b/.test(normalized)) return 'natural light movement texture';
  return '';
}

function formatAlpha(value) {
  const number = Math.min(1, Math.max(0, Number(value) || 0));
  return number.toFixed(3).replace(/0+$/g, '').replace(/\.$/, '') || '0';
}

function extractOverlayAlphaFromMessage(userMessage = '') {
  const source = String(userMessage || '');
  const percentMatches = [...source.matchAll(/(\d{1,3})(?:[,.](\d{1,2}))?\s*%/g)];
  for (let index = percentMatches.length - 1; index >= 0; index -= 1) {
    const match = percentMatches[index];
    const raw = `${match[1] || ''}.${match[2] || '0'}`;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value / 100;
  }

  const normalized = normalizeText(source);
  const decimalMatch = normalized.match(/\b(?:opacidade|overlay|camada)[\s\S]{0,80}?\b(?:0[,.]\d{1,2}|1[,.]0{1,2})\b/);
  if (decimalMatch) {
    const valueMatch = decimalMatch[0].match(/\b(0[,.]\d{1,2}|1[,.]0{1,2})\b/);
    const value = valueMatch ? Number(valueMatch[1].replace(',', '.')) : NaN;
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
  }

  return null;
}

function resolveHeroOverlaySettings(userMessage = '') {
  const alpha = extractOverlayAlphaFromMessage(userMessage);
  if (alpha === null) {
    return {
      explicit: false,
      colorAlpha: '0.18',
      softAlpha: '0.15',
    };
  }

  return {
    explicit: true,
    colorAlpha: formatAlpha(alpha),
    softAlpha: '0',
  };
}

function escapeHtmlAttribute(value = '') {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

function extractVideoUrlFromMessage(userMessage = '') {
  const match = String(userMessage || '').match(/https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?/i);
  return match ? match[0] : '';
}

function resolveAttachmentVideoAsset(attachments = []) {
  const list = Array.isArray(attachments) ? attachments : [];
  for (const attachment of list) {
    if (!attachment || typeof attachment !== 'object') continue;
    const candidates = [
      attachment.url,
      attachment.src,
      attachment.path,
      attachment.filePath,
      attachment.relativePath,
      attachment.name,
    ];
    const source = candidates.map((value) => String(value || '').trim()).find((value) => /\.mp4(?:$|\?)/i.test(value));
    if (!source) continue;
    return {
      kind: 'video',
      provider: 'attachment',
      src: source,
      poster: '',
      alt: String(attachment.alt || attachment.name || 'video de fundo do hero').trim(),
      attribution: '',
      sourceUrl: source,
    };
  }
  return null;
}

function normalizeHeroVideoAsset(asset = null, userMessage = '') {
  if (!asset || typeof asset !== 'object') return null;
  const src = String(asset.src || '').trim();
  if (!src || String(asset.kind || '').toLowerCase() !== 'video') return null;
  return {
    kind: 'video',
    provider: String(asset.provider || '').trim(),
    src,
    poster: String(asset.poster || '').trim(),
    alt: String(asset.alt || pickHeroMediaLabel(userMessage)).trim(),
    attribution: String(asset.attribution || '').trim(),
    sourceUrl: String(asset.sourceUrl || '').trim(),
    query: String(asset.query || '').trim(),
  };
}

function readAttribute(source = '', attrName = '') {
  const pattern = new RegExp(`\\b${attrName}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  const match = String(source || '').match(pattern);
  return match ? match[2] : '';
}

function extractVideoSourceFromMarkup(markup = '') {
  const source = String(markup || '');
  const sourceMatch = source.match(/<source\b[^>]*\bsrc\s*=\s*(["'])([^"']+\.(?:mp4|webm)(?:\?[^"']*)?)\1/i);
  if (sourceMatch) return sourceMatch[2].trim();
  const videoMatch = source.match(/<video\b[^>]*\bsrc\s*=\s*(["'])([^"']+\.(?:mp4|webm)(?:\?[^"']*)?)\1/i);
  return videoMatch ? videoMatch[2].trim() : '';
}

function extractExistingHeroVideoAsset(html = '', userMessage = '') {
  const source = String(html || '');
  const scopes = [];
  const markedBlock = source.match(/<!-- faber-hero-media-start -->[\s\S]*?<!-- faber-hero-media-end -->/i);
  if (markedBlock) scopes.push(markedBlock[0]);

  const heroBlock = source.match(/<section\b[^>]*class=(["'])(?=[^"']*\bhero\b)[^"']*\1[^>]*>[\s\S]*?<\/section>/i);
  if (heroBlock) scopes.push(heroBlock[0]);

  for (const scope of scopes) {
    const src = extractVideoSourceFromMarkup(scope);
    if (!src) continue;
    return normalizeHeroVideoAsset({
      kind: 'video',
      provider: 'existing_project',
      src,
      poster: readAttribute(scope, 'poster'),
      alt: readAttribute(scope, 'aria-label') || pickHeroMediaLabel(userMessage),
      attribution: readAttribute(scope, 'data-attribution'),
      sourceUrl: src,
    }, userMessage);
  }
  return null;
}

function buildHeroMediaBlock(userMessage = '', mediaAsset = null) {
  const label = pickHeroMediaLabel(userMessage);
  const videoAsset = normalizeHeroVideoAsset(mediaAsset, userMessage);
  const sourceStatus = videoAsset ? 'ready' : 'awaiting-video-asset';
  const posterAttr = videoAsset && videoAsset.poster ? ` poster="${escapeHtmlAttribute(videoAsset.poster)}"` : '';
  const sourceLine = videoAsset
    ? `        <source src="${escapeHtmlAttribute(videoAsset.src)}" type="video/mp4">`
    : '';
  const attribution = videoAsset && videoAsset.attribution
    ? ` data-attribution="${escapeHtmlAttribute(videoAsset.attribution)}"`
    : '';
  return [
    '    <!-- faber-hero-media-start -->',
    `    <div class="hero-media-stack" aria-hidden="true" data-source-status="${sourceStatus}"${attribution}>`,
    `      <video class="hero-video" autoplay muted loop playsinline preload="metadata"${posterAttr} aria-label="${escapeHtmlText(videoAsset ? videoAsset.alt : label)}">`,
    sourceLine,
    '      </video>',
    '      <div class="hero-video-fallback" aria-hidden="true"><span></span><span></span><span></span><span></span></div>',
    '      <span class="hero-overlay hero-overlay-color"></span>',
    '      <span class="hero-overlay hero-overlay-soft"></span>',
    '    </div>',
    '    <!-- faber-hero-media-end -->',
  ].join('\n');
}

function addHeroVideoClass(html = '') {
  return String(html || '').replace(
    /<section\b([^>]*class=(["'])(?=[^"']*\bhero\b)([^"']*)\2[^>]*)>/i,
    (match, attrs, quote, classes) => {
      if (/\bhas-hero-video\b/.test(classes)) return match;
      const nextClasses = `${classes} has-hero-video`.replace(/\s+/g, ' ').trim();
      return match.replace(`${quote}${classes}${quote}`, `${quote}${nextClasses}${quote}`);
    }
  );
}

function insertOrReplaceHeroMediaBlock(html = '', userMessage = '', mediaAsset = null) {
  const source = String(html || '');
  const block = buildHeroMediaBlock(userMessage, mediaAsset);
  if (source.includes('<!-- faber-hero-media-start -->')) {
    const next = source.replace(
      /\s*<!-- faber-hero-media-start -->[\s\S]*?<!-- faber-hero-media-end -->/i,
      `\n${block}`
    );
    const withClass = addHeroVideoClass(next);
    return { changed: withClass !== source, content: withClass };
  }
  if (/class=["'][^"']*\bhero-media-stack\b/i.test(source)) {
    return { changed: false, content: source };
  }

  const heroOpen = source.match(/<section\b[^>]*class=(["'])(?=[^"']*\bhero\b)[^"']*\1[^>]*>/i);
  if (!heroOpen || heroOpen.index === undefined) return { changed: false, content: source };
  const insertAt = heroOpen.index + heroOpen[0].length;
  const separator = source[insertAt] === '\n' ? '\n' : '\n';
  const next = `${source.slice(0, insertAt)}${separator}${block}${source.slice(insertAt)}`;
  const withClass = addHeroVideoClass(next);
  return { changed: withClass !== source, content: withClass };
}

function buildHeroOverlayCss(userMessage = '') {
  const overlay = resolveHeroOverlaySettings(userMessage);
  return [
    '',
    '/* Faber visual hero media layer: real video when available, safe fallback otherwise. */',
    '.hero-media-stack {',
    '  position: absolute;',
    '  inset: 0;',
    '  z-index: 0;',
    '  overflow: hidden;',
    '  pointer-events: none;',
    '}',
    '',
    '.hero-video,',
    '.hero-video-fallback {',
    '  position: absolute;',
    '  inset: 0;',
    '  width: 100%;',
    '  height: 100%;',
    '  object-fit: cover;',
    '}',
    '',
    '.hero-video {',
    '  filter: grayscale(1) contrast(1.04) brightness(1.04);',
    '  opacity: 0.82;',
    '}',
    '',
    '.hero-media-stack[data-source-status="ready"] .hero-video-fallback {',
    '  display: none;',
    '}',
    '',
    '.hero-video-fallback {',
    '  background:',
    '    radial-gradient(circle at 18% 24%, rgba(45, 42, 41, 0.28) 0 2px, transparent 3px),',
    '    radial-gradient(circle at 54% 16%, rgba(45, 42, 41, 0.22) 0 2px, transparent 3px),',
    '    radial-gradient(circle at 82% 34%, rgba(45, 42, 41, 0.2) 0 2px, transparent 3px),',
    '    linear-gradient(135deg, rgba(240, 190, 67, 0.34), rgba(241, 204, 152, 0.36));',
    '  transform: scale(1.04);',
    '  animation: heroAmbientFlight 18s ease-in-out infinite alternate;',
    '}',
    '',
    '.hero-video-fallback span {',
    '  position: absolute;',
    '  width: clamp(26px, 5vw, 54px);',
    '  height: clamp(12px, 2vw, 22px);',
    '  border-top: 1px solid rgba(45, 42, 41, 0.28);',
    '  border-bottom: 1px solid rgba(45, 42, 41, 0.12);',
    '  border-radius: 999px;',
    '  opacity: 0.34;',
    '  animation: heroBeeDrift 14s ease-in-out infinite;',
    '}',
    '',
    '.hero-video-fallback span:nth-child(1) { left: 12%; top: 24%; }',
    '.hero-video-fallback span:nth-child(2) { left: 38%; top: 42%; animation-delay: -4s; }',
    '.hero-video-fallback span:nth-child(3) { left: 68%; top: 28%; animation-delay: -8s; }',
    '.hero-video-fallback span:nth-child(4) { left: 78%; top: 58%; animation-delay: -11s; }',
    '',
    '.hero-overlay {',
    '  position: absolute;',
    '  inset: 0;',
    '}',
    '',
    '.hero-overlay-color {',
    `  background: rgba(255, 255, 255, ${overlay.colorAlpha});`,
    '  opacity: 1;',
    '  mix-blend-mode: normal;',
    '}',
    '',
    '.hero-overlay-soft {',
    `  background: rgba(255, 255, 255, ${overlay.softAlpha});`,
    '  mix-blend-mode: normal;',
    '}',
    '',
    '.hero > *:not(.hero-media-stack) {',
    '  position: relative;',
    '  z-index: 1;',
    '}',
    '',
    '.hero.has-hero-video {',
    '  grid-template-columns: minmax(0, 1fr);',
    '  background: var(--bg, #f8f7f2);',
    '}',
    '',
    '.hero.has-hero-video::before {',
    '  opacity: 0.18;',
    '}',
    '',
    '.hero.has-hero-video .hero-text {',
    '  max-width: min(760px, 100%);',
    '}',
    '',
    '.hero.has-hero-video .texture-panel {',
    '  display: none;',
    '}',
    '',
    '@keyframes heroAmbientFlight {',
    '  from { background-position: 0% 0%, 40% 20%, 80% 10%, 0 0; }',
    '  to { background-position: 18% 12%, 56% 28%, 92% 24%, 0 0; }',
    '}',
    '',
    '@keyframes heroBeeDrift {',
    '  0%, 100% { transform: translate3d(0, 0, 0) rotate(-8deg); }',
    '  50% { transform: translate3d(22px, -16px, 0) rotate(7deg); }',
    '}',
  ].join('\n');
}

function appendOrReplaceHeroOverlayCss(css = '', userMessage = '') {
  const source = String(css || '');
  const block = buildHeroOverlayCss(userMessage);
  const oldMarker = '/* Faber visual hero media layer: safe fallback when no video asset is attached yet. */';
  const newMarker = '/* Faber visual hero media layer: real video when available, safe fallback otherwise. */';
  if (source.includes(oldMarker) || source.includes(newMarker)) {
    const next = source.replace(
      /\/\* Faber visual hero media layer: (?:safe fallback when no video asset is attached yet|real video when available, safe fallback otherwise)\. \*\/[\s\S]*?(?=\n@media|\n\/\*|$)/,
      block.trim()
    );
    return { changed: next !== source, content: next };
  }
  const next = `${source.trimEnd()}\n${block}\n`;
  return { changed: next !== source, content: next };
}

function createVisualHeroPatchService(dependencies = {}) {
  const {
    fs = defaultFs,
    path = defaultPath,
    buildOperationBatchDiffPreview = () => '',
    normalizeRequestedRelativePath = (value) => String(value || '').replace(/^\.\/+/, ''),
    resolveHeroMediaAssets = async () => ({}),
  } = dependencies;

  function collectExistingCandidates(projectInfo = {}, candidates = []) {
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    const files = Array.isArray(projectInfo && projectInfo.files)
      ? projectInfo.files.map((entry) => String(entry || '').replace(/\\/g, '/')).filter(Boolean)
      : [];
    return uniqueList([...candidates, ...files])
      .map((rel) => normalizeRequestedRelativePath(rel))
      .filter((rel) => rel && projectRoot && fs.existsSync(path.join(projectRoot, rel)));
  }

  function readTextFile(projectRoot, relPath) {
    const absPath = path.join(projectRoot, relPath);
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > 700000) return null;
    return fs.readFileSync(absPath, 'utf8');
  }

  async function resolveHeroMediaAsset({ userMessage = '', attachments = [], projectInfo = {}, html = '' } = {}) {
    const directUrl = extractVideoUrlFromMessage(userMessage);
    if (directUrl) {
      return normalizeHeroVideoAsset({
        kind: 'video',
        provider: 'direct_url',
        src: directUrl,
        alt: pickHeroMediaLabel(userMessage),
        sourceUrl: directUrl,
      }, userMessage);
    }

    const attachmentAsset = resolveAttachmentVideoAsset(attachments);
    if (attachmentAsset) return normalizeHeroVideoAsset(attachmentAsset, userMessage);

    const existingAsset = extractExistingHeroVideoAsset(html, userMessage);
    const needsDifferentVideo = wantsDifferentHeroVideo(userMessage);

    try {
      const mediaAssets = await resolveHeroMediaAssets({
        projectInfo,
        userMessage,
        mediaIntent: [{
          slot: 'hero',
          provider: 'pexels',
          mediaType: 'video',
          query: pickHeroMediaSearchQuery(userMessage),
          orientation: 'landscape',
        }],
        requireVideo: true,
        allowPhotoFallback: false,
        excludeMedia: existingAsset
          ? {
              src: existingAsset.src,
              sourceUrl: existingAsset.sourceUrl,
            }
          : null,
      });
      const providerAsset = normalizeHeroVideoAsset(mediaAssets && mediaAssets.hero, userMessage);
      if (providerAsset && (!existingAsset || providerAsset.src !== existingAsset.src)) return providerAsset;
    } catch {
    }

    return needsDifferentVideo ? null : existingAsset;
  }

  async function buildHeroVisualOverlayOperationBatch({
    projectInfo,
    userMessage,
    attachments = [],
    executionIntent = 'edit_project',
    providerFailure = null,
  } = {}) {
    if (String(executionIntent || '').toLowerCase() !== 'edit_project') return null;
    if (!isHeroVisualOverlayRequest(userMessage)) return null;
    const projectRoot = projectInfo && projectInfo.rootPath ? String(projectInfo.rootPath) : '';
    if (!projectRoot) return null;

    const htmlRel = collectExistingCandidates(projectInfo, ['index.html', 'src/index.html'])
      .find((relPath) => /\.html$/i.test(relPath));
    const cssRel = collectExistingCandidates(projectInfo, [
      'style.css',
      'styles.css',
      'src/styles.css',
      'assets/css/styles.css',
      'assets/styles.css',
      'css/styles.css',
    ]).find((relPath) => /\.(css|scss)$/i.test(relPath));
    if (!htmlRel || !cssRel) return null;

    let html = '';
    let css = '';
    try {
      html = readTextFile(projectRoot, htmlRel);
      css = readTextFile(projectRoot, cssRel);
    } catch {
      return null;
    }
    if (html === null || css === null) return null;

    const requiresVideo = wantsHeroVideo(userMessage);
    const mediaAsset = requiresVideo
      ? await resolveHeroMediaAsset({ userMessage, attachments, projectInfo, html })
      : extractExistingHeroVideoAsset(html, userMessage);
    if (requiresVideo && !mediaAsset) {
      return {
        ok: false,
        blocked: true,
        reason: 'hero_video_asset_unavailable',
        message:
          'O pedido exige video real no hero, mas nenhum provider/URL/anexo retornou um src de video valido. Mantive o projeto intacto.',
      };
    }

    const htmlResult = insertOrReplaceHeroMediaBlock(html, userMessage, mediaAsset);
    const cssResult = appendOrReplaceHeroOverlayCss(css, userMessage);
    const operations = [];
    if (htmlResult.changed) operations.push({ op: 'write_file', path: htmlRel, content: htmlResult.content });
    if (cssResult.changed) operations.push({ op: 'write_file', path: cssRel, content: cssResult.content });
    if (!operations.length && mediaAsset) {
      operations.push({ op: 'write_file', path: htmlRel, content: htmlResult.content });
    }
    if (!operations.length) return null;

    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'edit_project',
        rootPath: projectRoot,
        targetFile: htmlRel,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: mediaAsset
          ? 'Inserir video real no hero existente com grayscale, fallback seguro e overlays brancos leves sem recriar o projeto.'
          : 'Preparar o hero existente com camada de video de fundo, fallback visual e overlays brancos sem recriar o projeto.',
        humanSummary: mediaAsset
          ? 'Hero atualizado com video real de fundo, filtro em preto e branco, fallback seguro e overlays brancos leves.'
          : 'Hero preparado com camada de video/fallback e overlays brancos. Anexe ou referencie o arquivo de video para substituir o fallback.',
        userMessage,
        attachments,
        generatedBy: mediaAsset ? 'visual_hero_video_media_patch' : 'visual_hero_overlay_fallback_patch',
        microContract: {
          schemaVersion: VISUAL_HERO_PATCH_SCHEMA_VERSION,
          type: 'hero_media_overlay',
          idempotentWhenAlreadyApplied: true,
          mediaSlot: 'hero',
          sourceStatus: mediaAsset ? 'ready' : 'awaiting_video_asset',
          mediaAsset: mediaAsset
            ? {
                provider: mediaAsset.provider || '',
                src: mediaAsset.src,
                sourceUrl: mediaAsset.sourceUrl || '',
                attribution: mediaAsset.attribution || '',
              }
            : null,
          providerFailure: providerFailure
            ? {
                code: providerFailure.code || '',
                category: providerFailure.category || '',
              }
            : null,
        },
      },
      raw: 'visual_hero_overlay_fallback_patch',
    };
  }

  return {
    buildHeroVisualOverlayOperationBatch,
    isHeroVisualOverlayRequest,
  };
}

module.exports = {
  VISUAL_HERO_PATCH_SCHEMA_VERSION,
  createVisualHeroPatchService,
  isHeroVisualOverlayRequest,
  insertOrReplaceHeroMediaBlock,
  appendOrReplaceHeroOverlayCss,
};
