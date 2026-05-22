function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value = '') {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function compactBlueprintText(value = '', max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function normalizeBlueprintMediaAssets(mediaAssets = {}) {
  const hero = mediaAssets && typeof mediaAssets === 'object' ? mediaAssets.hero : null;
  if (!hero || typeof hero !== 'object') return { hero: null };
  const src = String(hero.src || '').trim();
  if (!src || !/^https?:\/\//i.test(src)) return { hero: null };
  const kind = String(hero.kind || '').toLowerCase() === 'video' ? 'video' : 'photo';
  return {
    hero: {
      kind,
      provider: String(hero.provider || 'pexels').trim(),
      query: compactBlueprintText(hero.query || ''),
      src,
      poster: String(hero.poster || '').trim(),
      alt: compactBlueprintText(hero.alt || hero.query || 'Imagem contextual do projeto'),
      attribution: compactBlueprintText(hero.attribution || ''),
      photographer: compactBlueprintText(hero.photographer || ''),
      photographerUrl: String(hero.photographerUrl || '').trim(),
      sourceUrl: String(hero.sourceUrl || '').trim(),
    },
  };
}

function renderHeroMediaHtml(heroMedia = null) {
  if (!heroMedia || !heroMedia.src) return '';
  const attribution = heroMedia.attribution
    ? `<p class="media-credit">${escapeHtml(heroMedia.attribution)}</p>`
    : '';
  if (heroMedia.kind === 'video') {
    const poster = heroMedia.poster ? ` poster="${escapeAttribute(heroMedia.poster)}"` : '';
    return `<figure class="hero-media">
        <video autoplay muted loop playsinline${poster} aria-label="${escapeAttribute(heroMedia.alt)}">
          <source src="${escapeAttribute(heroMedia.src)}" type="video/mp4">
        </video>
        ${attribution}
      </figure>`;
  }
  return `<figure class="hero-media">
        <img src="${escapeAttribute(heroMedia.src)}" alt="${escapeAttribute(heroMedia.alt)}" loading="lazy">
        ${attribution}
      </figure>`;
}


module.exports = {
  compactBlueprintText,
  escapeAttribute,
  escapeHtml,
  normalizeBlueprintMediaAssets,
  renderHeroMediaHtml,
};
