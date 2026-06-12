function normalizeAssetText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactAssetText(value = '', max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function buildPexelsSearchSource({
  userMessage = '',
  contextText = '',
  workGraph = null,
} = {}) {
  const parts = [userMessage, contextText];
  if (workGraph && typeof workGraph === 'object') {
    parts.push(workGraph.brief || '');
    if (workGraph.briefSpec) {
      try {
        parts.push(JSON.stringify(workGraph.briefSpec));
      } catch {
        parts.push(String(workGraph.briefSpec || ''));
      }
    }
  }
  return parts.filter(Boolean).join('\n');
}

function inferPexelsDomain(source = '', contract = {}) {
  const contractDomain = String(contract && contract.domain ? contract.domain : '').trim();
  if (contractDomain) return contractDomain;

  const normalized = normalizeAssetText(source);
  if (/\bestufas?\b|\bgreenhouses?\b|\bcultivo protegido\b|\bviveiros?\b|\bhortas? comerciais?\b|\bfloriculturas?\b|\bprodutor rural\b|\bagricultor(?:es)?\b|\bagricultura\b|\bhortalicas?\b|\bmudas?\b|\birrigacao\b|\bcontrole climatico\b/.test(normalized)) return 'greenhouses';
  if (/\babelhas?\b|\bapicultura\b|\bapiario\b|\bbee\b|\bbees\b|\bhoneybee\b|\bpollination\b/.test(normalized)) return 'bees';
  if (/\bbaleias?\b|\bjubartes?\b|\bhumpback\b|\bwhales?\b|\boceano\b|\bvida marinha\b/.test(normalized)) return 'humpback-whales';
  if (/\b(chocolates?|cacau|cacao|bombons?|chocolateria|tabletes?|trufas?|ganache|temperagem|bean to bar)\b/.test(normalized)) return 'chocolate';
  if (/\bjardinagem\b|\bjardins?\b|\bpaisagismo\b|\bcuidados com plantas\b|\bplantas para apartamento\b|\bplantas internas\b|\bhortas? caseiras?\b|\bjardins? verticais?\b|\bloja de jardinagem\b/.test(normalized)) return 'gardening';
  if (/\besculturas? em madeira\b|\bescultor(?:a)? em madeira\b|\barte em madeira\b|\bmadeira bruta\b|\btalha manual\b|\bentalhe\b|\bveios da madeira\b|\bateli[eê] de escultura\b|\bobras sob encomenda\b/.test(normalized)) return 'wood-sculpture';
  if (/\bcouro\b|\bcouros\b|\bartefatos? de couro\b|\bmarroquinaria\b|\bbolsas?\b|\bpastas?\b|\bcarteiras?\b/.test(normalized)) return 'leather-goods';
  if (/\badvocacia\b|\badvogad[oa]s?\b|\bjuridic[oa]\b|\bdireito\b|\blaw\b/.test(normalized)) return 'legal';
  if (/\bimoveis\b|\bimobiliaria\b|\bcorretor\b|\breal estate\b|\bapartamento\b|\bcasa\b/.test(normalized)) return 'real-estate';
  if (/\bodonto|dent/.test(normalized)) return 'dental';
  if (/\bveterin|pet\b|pets\b/.test(normalized)) return 'veterinary';
  if (/\barquit|interior|decor/.test(normalized)) return 'architecture';
  if (/\blaboratorio fotografico\b|\blaboratorio de revelacao\b|\brevelacao de filmes?\b|\bdigitalizacao de negativos?\b|\bimpressao fine art\b|\brestauracao fotografica\b|\bfotografia analogica\b|\bdarkroom\b/.test(normalized)) return 'photo-lab';
  if (/\bfotograf|photo|camera\b/.test(normalized)) return 'photography';
  if (/\brestaurante|restaurant|food|gastronomia\b/.test(normalized)) return 'restaurant';
  if (/\bacademia|fitness|yoga|pilates\b/.test(normalized)) return 'fitness';
  if (/\bsoftware|saas|startup|app|tecnologia|technology\b/.test(normalized)) return 'technology';
  return 'institutional';
}

function resolvePexelsQuery(options = {}) {
  const mediaIntent = Array.isArray(options.mediaIntent) ? options.mediaIntent[0] : null;
  const requestedQuery = mediaIntent && mediaIntent.query ? compactAssetText(mediaIntent.query, 160) : '';
  if (requestedQuery) return requestedQuery;

  const source = buildPexelsSearchSource(options);
  const domain = inferPexelsDomain(source, options.contract || {});
  const normalized = normalizeAssetText(source);
  const baseByDomain = {
    legal: 'law office consultation',
    'real-estate': 'modern real estate interior',
    dental: 'modern dental clinic',
    veterinary: 'veterinary clinic pet care',
    architecture: 'modern architecture interior design',
    'photo-lab': 'darkroom film development photo lab fine art printing negatives',
    photography: 'photography studio portrait',
    restaurant: 'restaurant interior dining',
    fitness: 'fitness studio wellness',
    technology: 'software team workspace',
    chocolate: 'artisan chocolate melting cocoa premium dessert',
    gardening: 'lush home garden landscaping plants natural light',
    'wood-sculpture': 'wood carving artisan hands sculpture workshop',
    'leather-goods': 'handmade leather bags artisan workshop',
    'humpback-whales': 'humpback whale ocean blue',
    bees: 'honey bees flying flowers pollination macro',
    greenhouses: 'modern greenhouse farming protected cultivation vegetables',
    institutional: 'professional workspace',
  };

  if (/\bluxo\b|\bpremium\b|\bsofisticad/.test(normalized)) {
    return `${baseByDomain[domain] || baseByDomain.institutional} premium`;
  }
  if (/\bminimalista\b|\bclean\b|\bmoderno\b|\bmodern\b/.test(normalized)) {
    return `${baseByDomain[domain] || baseByDomain.institutional} modern`;
  }
  return baseByDomain[domain] || baseByDomain.institutional;
}

function resolvePexelsMediaPreference(options = {}) {
  const mediaIntent = Array.isArray(options.mediaIntent) ? options.mediaIntent[0] : null;
  const requestedType = mediaIntent && mediaIntent.mediaType ? String(mediaIntent.mediaType).trim().toLowerCase() : '';
  if (requestedType === 'video') return 'video';
  if (requestedType === 'photo' || requestedType === 'image') return 'photo';

  const source = normalizeAssetText(buildPexelsSearchSource(options));
  if (/\b(video|videos|filmagem|motion|hero video|background animado|animado)\b/.test(source)) return 'video';
  return 'photo';
}

function resolvePexelsOrientation(options = {}) {
  const source = normalizeAssetText(buildPexelsSearchSource(options));
  const mediaIntent = Array.isArray(options.mediaIntent) ? options.mediaIntent[0] : null;
  const requested = mediaIntent && mediaIntent.orientation ? String(mediaIntent.orientation).trim().toLowerCase() : '';
  if (['landscape', 'portrait', 'square'].includes(requested)) return requested;
  if (/\b(retrato|portrait|vertical)\b/.test(source)) return 'portrait';
  if (/\b(quadrado|square)\b/.test(source)) return 'square';
  return 'landscape';
}

function normalizePexelsColor(value = '') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  const normalized = normalizeAssetText(raw);
  if (/\bazul|blue\b/.test(normalized)) return '#3240a8';
  if (/\bbranco|white\b/.test(normalized)) return '#ffffff';
  if (/\bverde|green\b/.test(normalized)) return '#2f8f7f';
  if (/\bvermelh|red|coral\b/.test(normalized)) return '#cf416b';
  if (/\b(chocolate|cacau|cacao|marrom)\b/.test(normalized)) return '#3b1f14';
  if (/\bcreme|cream\b/.test(normalized)) return '#f7e7ce';
  if (/\bdourado|ouro|gold\b/.test(normalized)) return '#c89b5a';
  if (/\bpreto|black|escuro\b/.test(normalized)) return '#111111';
  return '';
}

function resolvePexelsColor(options = {}) {
  const mediaIntent = Array.isArray(options.mediaIntent) ? options.mediaIntent[0] : null;
  const candidates = [
    options.color,
    mediaIntent && mediaIntent.color,
    options.contract && options.contract.palette && options.contract.palette.imageColor,
    options.workingBrief && options.workingBrief.style && options.workingBrief.style.palette && options.workingBrief.style.palette.imageColor,
    buildPexelsSearchSource(options),
  ];
  for (const candidate of candidates) {
    const color = normalizePexelsColor(candidate);
    if (color) return color;
  }
  return '';
}

function normalizePexelsPhoto(photo = {}, query = '') {
  if (!photo || typeof photo !== 'object') return null;
  const src = photo.src && typeof photo.src === 'object' ? photo.src : {};
  const url = String(src.landscape || src.large2x || src.large || src.original || '').trim();
  if (!url) return null;
  const photographer = String(photo.photographer || '').trim();
  return {
    kind: 'photo',
    provider: 'pexels',
    id: String(photo.id || '').trim(),
    query,
    src: url,
    poster: '',
    alt: compactAssetText(photo.alt || `Imagem de ${query}`),
    photographer,
    photographerUrl: String(photo.photographer_url || '').trim(),
    sourceUrl: String(photo.url || '').trim(),
    attribution: photographer ? `Foto de ${photographer} no Pexels` : 'Foto do Pexels',
  };
}

function normalizeMediaIdentity(value = '') {
  return String(value || '').trim();
}

function collectExcludedMediaIdentities(options = {}) {
  const exclude = options.excludeMedia && typeof options.excludeMedia === 'object'
    ? options.excludeMedia
    : {};
  return new Set([
    options.excludeSrc,
    options.excludeSourceUrl,
    options.excludeId,
    exclude.src,
    exclude.sourceUrl,
    exclude.id,
  ].map(normalizeMediaIdentity).filter(Boolean));
}

function hasExcludedMedia(options = {}) {
  return collectExcludedMediaIdentities(options).size > 0;
}

function isExcludedMedia(asset = null, options = {}) {
  if (!asset || typeof asset !== 'object') return false;
  const excluded = collectExcludedMediaIdentities(options);
  if (!excluded.size) return false;
  const candidates = [
    asset.src,
    asset.sourceUrl,
    asset.id,
  ].map(normalizeMediaIdentity).filter(Boolean);
  return candidates.some((value) => excluded.has(value));
}

function choosePexelsVideoFile(files = []) {
  const candidates = Array.isArray(files) ? files : [];
  const mp4Files = candidates
    .filter((file) => file && String(file.file_type || '').toLowerCase().includes('mp4') && file.link)
    .sort((a, b) => {
      const aScore = Math.abs(Number(a.width || 0) - 1280) + Math.abs(Number(a.height || 0) - 720);
      const bScore = Math.abs(Number(b.width || 0) - 1280) + Math.abs(Number(b.height || 0) - 720);
      return aScore - bScore;
    });
  return mp4Files[0] || candidates.find((file) => file && file.link) || null;
}

function normalizePexelsVideo(video = {}, query = '') {
  if (!video || typeof video !== 'object') return null;
  const file = choosePexelsVideoFile(video.video_files);
  const src = file ? String(file.link || '').trim() : '';
  if (!src) return null;
  const pictures = Array.isArray(video.video_pictures) ? video.video_pictures : [];
  const poster = pictures.find((item) => item && item.picture) || {};
  const user = video.user && typeof video.user === 'object' ? video.user : {};
  const photographer = String(user.name || '').trim();
  return {
    kind: 'video',
    provider: 'pexels',
    id: String(video.id || '').trim(),
    query,
    src,
    poster: String(poster.picture || '').trim(),
    alt: compactAssetText(`Vídeo de ${query}`),
    photographer,
    photographerUrl: String(user.url || '').trim(),
    sourceUrl: String(video.url || '').trim(),
    attribution: photographer ? `Vídeo de ${photographer} no Pexels` : 'Vídeo do Pexels',
  };
}

function createPexelsAssetService(dependencies = {}) {
  const {
    baseUrl = 'https://api.pexels.com',
    fetchFn = typeof fetch === 'function' ? fetch : null,
    getApiKey = () => '',
    timeoutMs = 8000,
  } = dependencies;

  async function requestJson(pathname, params = {}) {
    const apiKey = String(getApiKey() || '').trim();
    if (!apiKey || typeof fetchFn !== 'function') return null;

    const url = new URL(pathname, baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        url.searchParams.set(key, String(value).trim());
      }
    });

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchFn(url.toString(), {
        headers: { Authorization: apiKey },
        signal: controller ? controller.signal : undefined,
      });
      if (!response || !response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function searchPhoto(query, options = {}) {
    const payload = await requestJson('/v1/search', {
      query,
      orientation: resolvePexelsOrientation(options),
      color: resolvePexelsColor(options),
      per_page: hasExcludedMedia(options) ? 8 : 1,
    });
    const photos = payload && Array.isArray(payload.photos) ? payload.photos : [];
    for (const photo of photos) {
      const asset = normalizePexelsPhoto(photo, query);
      if (asset && !isExcludedMedia(asset, options)) return asset;
    }
    return null;
  }

  async function searchVideo(query, options = {}) {
    const payload = await requestJson('/videos/search', {
      query,
      orientation: resolvePexelsOrientation(options),
      color: resolvePexelsColor(options),
      per_page: hasExcludedMedia(options) ? 8 : 1,
    });
    const videos = payload && Array.isArray(payload.videos) ? payload.videos : [];
    for (const video of videos) {
      const asset = normalizePexelsVideo(video, query);
      if (asset && !isExcludedMedia(asset, options)) return asset;
    }
    return null;
  }

  async function resolveBlueprintMediaAssets(options = {}) {
    const query = resolvePexelsQuery(options);
    const preference = resolvePexelsMediaPreference(options);
    const requireVideo = Boolean(options.requireVideo);
    const allowPhotoFallback = options.allowPhotoFallback !== false;
    const apiKey = String(getApiKey() || '').trim();
    if (!apiKey || typeof fetchFn !== 'function') {
      return {
        provider: 'pexels',
        hero: null,
        query,
        preference,
        status: 'missing_key',
      };
    }

    const primary = preference === 'video'
      ? await searchVideo(query, options)
      : await searchPhoto(query, options);
    const fallback = primary || !allowPhotoFallback || requireVideo
      ? null
      : preference === 'video'
        ? await searchPhoto(query, options)
        : null;
    const hero = primary || fallback || null;

    return {
      provider: 'pexels',
      hero,
      query,
      preference,
      status: hero ? 'ready' : 'unavailable',
    };
  }

  return {
    resolveBlueprintMediaAssets,
    resolvePexelsColor,
    resolvePexelsOrientation,
    resolvePexelsMediaPreference,
    resolvePexelsQuery,
    searchPhoto,
    searchVideo,
  };
}

module.exports = {
  createPexelsAssetService,
  inferPexelsDomain,
  normalizePexelsPhoto,
  normalizePexelsVideo,
  resolvePexelsColor,
  resolvePexelsOrientation,
  resolvePexelsMediaPreference,
  resolvePexelsQuery,
};
