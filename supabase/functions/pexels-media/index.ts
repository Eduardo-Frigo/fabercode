const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PEXELS_BASE_URL = 'https://api.pexels.com';

type AnyRecord = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function env(name: string): string {
  return String(Deno.env.get(name) || '').trim();
}

function compactText(value: unknown, max = 240): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function normalizeAssetText(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getObject(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function getFirstMediaIntent(options: AnyRecord): AnyRecord | null {
  const mediaIntent = Array.isArray(options.mediaIntent) ? options.mediaIntent[0] : null;
  return getObject(mediaIntent);
}

function buildSearchSource(options: AnyRecord): string {
  const parts: string[] = [String(options.userMessage || ''), String(options.contextText || '')];
  const workGraph = getObject(options.workGraph);
  if (workGraph) {
    parts.push(String(workGraph.brief || ''));
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

function inferDomain(source = '', contract: AnyRecord | null = null): string {
  const contractDomain = String(contract && contract.domain ? contract.domain : '').trim();
  if (contractDomain) return contractDomain;

  const normalized = normalizeAssetText(source);
  if (/\bestufas?\b|\bgreenhouses?\b|\bcultivo protegido\b|\bviveiros?\b|\bhortas? comerciais?\b|\bfloriculturas?\b|\bprodutor rural\b|\bagricultor(?:es)?\b|\bagricultura\b|\bhortalicas?\b|\bmudas?\b|\birrigacao\b|\bcontrole climatico\b/.test(normalized)) return 'greenhouses';
  if (/\babelhas?\b|\bapicultura\b|\bapiario\b|\bbee\b|\bbees\b|\bhoneybee\b|\bpollination\b/.test(normalized)) return 'bees';
  if (/\bbaleias?\b|\bjubartes?\b|\bhumpback\b|\bwhales?\b|\boceano\b|\bvida marinha\b/.test(normalized)) return 'humpback-whales';
  if (/\b(chocolates?|cacau|cacao|bombons?|chocolateria|tabletes?|trufas?|ganache|temperagem|bean to bar)\b/.test(normalized)) return 'chocolate';
  if (/\bjardinagem\b|\bjardins?\b|\bpaisagismo\b|\bcuidados com plantas\b|\bplantas para apartamento\b|\bplantas internas\b|\bhortas? caseiras?\b|\bjardins? verticais?\b|\bloja de jardinagem\b/.test(normalized)) return 'gardening';
  if (/\besculturas? em madeira\b|\bescultor(?:a)? em madeira\b|\barte em madeira\b|\bmadeira bruta\b|\btalha manual\b|\bentalhe\b|\bveios da madeira\b|\batelie de escultura\b|\bobras sob encomenda\b/.test(normalized)) return 'wood-sculpture';
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

function resolveQuery(options: AnyRecord): string {
  const mediaIntent = getFirstMediaIntent(options);
  const requestedQuery = mediaIntent && mediaIntent.query ? compactText(mediaIntent.query, 160) : '';
  if (requestedQuery) return requestedQuery;

  const source = buildSearchSource(options);
  const contract = getObject(options.contract);
  const domain = inferDomain(source, contract);
  const normalized = normalizeAssetText(source);
  const baseByDomain: Record<string, string> = {
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

  const base = baseByDomain[domain] || baseByDomain.institutional;
  if (/\bluxo\b|\bpremium\b|\bsofisticad/.test(normalized)) return `${base} premium`;
  if (/\bminimalista\b|\bclean\b|\bmoderno\b|\bmodern\b/.test(normalized)) return `${base} modern`;
  return base;
}

function resolvePreference(options: AnyRecord): 'photo' | 'video' {
  const mediaIntent = getFirstMediaIntent(options);
  const requestedType = String(mediaIntent && mediaIntent.mediaType ? mediaIntent.mediaType : '').trim().toLowerCase();
  if (requestedType === 'video') return 'video';
  if (requestedType === 'photo' || requestedType === 'image') return 'photo';

  const source = normalizeAssetText(buildSearchSource(options));
  if (/\b(video|videos|filmagem|motion|hero video|background animado|animado)\b/.test(source)) return 'video';
  return 'photo';
}

function resolveOrientation(options: AnyRecord): string {
  const source = normalizeAssetText(buildSearchSource(options));
  const mediaIntent = getFirstMediaIntent(options);
  const requested = String(mediaIntent && mediaIntent.orientation ? mediaIntent.orientation : '').trim().toLowerCase();
  if (['landscape', 'portrait', 'square'].includes(requested)) return requested;
  if (/\b(retrato|portrait|vertical)\b/.test(source)) return 'portrait';
  if (/\b(quadrado|square)\b/.test(source)) return 'square';
  return 'landscape';
}

function normalizeColor(value: unknown): string {
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

function resolveColor(options: AnyRecord): string {
  const mediaIntent = getFirstMediaIntent(options);
  const contract = getObject(options.contract);
  const palette = getObject(contract && contract.palette);
  const workingBrief = getObject(options.workingBrief);
  const style = getObject(workingBrief && workingBrief.style);
  const workingPalette = getObject(style && style.palette);
  const candidates = [
    options.color,
    mediaIntent && mediaIntent.color,
    palette && palette.imageColor,
    workingPalette && workingPalette.imageColor,
    buildSearchSource(options),
  ];
  for (const candidate of candidates) {
    const color = normalizeColor(candidate);
    if (color) return color;
  }
  return '';
}

function identity(value: unknown): string {
  return String(value || '').trim();
}

function collectExcluded(options: AnyRecord): Set<string> {
  const exclude = getObject(options.excludeMedia) || {};
  return new Set([
    options.excludeSrc,
    options.excludeSourceUrl,
    options.excludeId,
    exclude.src,
    exclude.sourceUrl,
    exclude.id,
  ].map(identity).filter(Boolean));
}

function isExcluded(asset: AnyRecord | null, options: AnyRecord): boolean {
  if (!asset) return false;
  const excluded = collectExcluded(options);
  if (!excluded.size) return false;
  return [asset.src, asset.sourceUrl, asset.id].map(identity).some((value) => excluded.has(value));
}

function normalizePhoto(photo: AnyRecord, query: string): AnyRecord | null {
  const src = getObject(photo.src) || {};
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
    alt: compactText(photo.alt || `Imagem de ${query}`),
    photographer,
    photographerUrl: String(photo.photographer_url || '').trim(),
    sourceUrl: String(photo.url || '').trim(),
    attribution: photographer ? `Foto de ${photographer} no Pexels` : 'Foto do Pexels',
  };
}

function chooseVideoFile(files: unknown): AnyRecord | null {
  const candidates = Array.isArray(files) ? files.map(getObject).filter(Boolean) as AnyRecord[] : [];
  const mp4Files = candidates
    .filter((file) => String(file.file_type || '').toLowerCase().includes('mp4') && file.link)
    .sort((a, b) => {
      const aScore = Math.abs(Number(a.width || 0) - 1280) + Math.abs(Number(a.height || 0) - 720);
      const bScore = Math.abs(Number(b.width || 0) - 1280) + Math.abs(Number(b.height || 0) - 720);
      return aScore - bScore;
    });
  return mp4Files[0] || candidates.find((file) => file && file.link) || null;
}

function normalizeVideo(video: AnyRecord, query: string): AnyRecord | null {
  const file = chooseVideoFile(video.video_files);
  const src = file ? String(file.link || '').trim() : '';
  if (!src) return null;
  const pictures = Array.isArray(video.video_pictures) ? video.video_pictures.map(getObject).filter(Boolean) as AnyRecord[] : [];
  const poster = pictures.find((item) => item && item.picture) || {};
  const user = getObject(video.user) || {};
  const photographer = String(user.name || '').trim();
  return {
    kind: 'video',
    provider: 'pexels',
    id: String(video.id || '').trim(),
    query,
    src,
    poster: String(poster.picture || '').trim(),
    alt: compactText(`Video de ${query}`),
    photographer,
    photographerUrl: String(user.url || '').trim(),
    sourceUrl: String(video.url || '').trim(),
    attribution: photographer ? `Video de ${photographer} no Pexels` : 'Video do Pexels',
  };
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function validateSession(request: Request): Promise<{ ok: true; userId: string } | { ok: false; status: number; message: string }> {
  const token = bearerToken(request);
  const sessionSecret = env('FABER_SESSION_SECRET');
  const supabaseUrl = env('SUPABASE_URL');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!token) return { ok: false, status: 401, message: 'Login necessario para usar midia Pexels.' };
  if (!sessionSecret || !supabaseUrl || !serviceRoleKey) {
    return { ok: false, status: 500, message: 'Endpoint Pexels incompleto.' };
  }

  const sessionHash = await hmacSha256Hex(sessionSecret, token);
  const url = new URL('/rest/v1/faber_sessions', supabaseUrl);
  url.searchParams.set('id', `eq.${sessionHash}`);
  url.searchParams.set('revoked_at', 'is.null');
  url.searchParams.set('select', 'user_id');
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return { ok: false, status: 500, message: 'Nao foi possivel validar sessao.' };
  const rows = await response.json();
  const row = Array.isArray(rows) && rows.length ? getObject(rows[0]) : null;
  const userId = row ? String(row.user_id || '').trim() : '';
  if (!userId) return { ok: false, status: 401, message: 'Sessao invalida ou expirada.' };
  return { ok: true, userId };
}

async function requestPexels(pathname: string, params: Record<string, string>, apiKey: string): Promise<AnyRecord | null> {
  const url = new URL(pathname, PEXELS_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (String(value || '').trim()) url.searchParams.set(key, String(value).trim());
  }
  const response = await fetch(url.toString(), {
    headers: { Authorization: apiKey },
  });
  if (!response.ok) return null;
  return await response.json();
}

async function searchPhoto(query: string, options: AnyRecord, apiKey: string): Promise<AnyRecord | null> {
  const excluded = collectExcluded(options);
  const payload = await requestPexels('/v1/search', {
    query,
    orientation: resolveOrientation(options),
    color: resolveColor(options),
    per_page: excluded.size ? '8' : '1',
  }, apiKey);
  const photos = payload && Array.isArray(payload.photos) ? payload.photos.map(getObject).filter(Boolean) as AnyRecord[] : [];
  for (const photo of photos) {
    const asset = normalizePhoto(photo, query);
    if (asset && !isExcluded(asset, options)) return asset;
  }
  return null;
}

async function searchVideo(query: string, options: AnyRecord, apiKey: string): Promise<AnyRecord | null> {
  const excluded = collectExcluded(options);
  const payload = await requestPexels('/videos/search', {
    query,
    orientation: resolveOrientation(options),
    color: resolveColor(options),
    per_page: excluded.size ? '8' : '1',
  }, apiKey);
  const videos = payload && Array.isArray(payload.videos) ? payload.videos.map(getObject).filter(Boolean) as AnyRecord[] : [];
  for (const video of videos) {
    const asset = normalizeVideo(video, query);
    if (asset && !isExcluded(asset, options)) return asset;
  }
  return null;
}

async function resolveMedia(options: AnyRecord): Promise<AnyRecord> {
  const apiKey = env('FABER_PEXELS_API_KEY') || env('PEXELS_API_KEY');
  const query = resolveQuery(options);
  const preference = resolvePreference(options);
  const requireVideo = Boolean(options.requireVideo);
  const allowPhotoFallback = options.allowPhotoFallback !== false;
  if (!apiKey) {
    return { provider: 'pexels', hero: null, query, preference, status: 'missing_key' };
  }

  const primary = preference === 'video'
    ? await searchVideo(query, options, apiKey)
    : await searchPhoto(query, options, apiKey);
  const fallback = primary || !allowPhotoFallback || requireVideo
    ? null
    : preference === 'video'
      ? await searchPhoto(query, options, apiKey)
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

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ ok: false, message: 'Metodo nao permitido.' }, 405);

  const session = await validateSession(request);
  if (!session.ok) return jsonResponse({ ok: false, message: session.message }, session.status);

  let payload: AnyRecord = {};
  try {
    const parsed = await request.json();
    payload = getObject(parsed) || {};
  } catch {
    return jsonResponse({ ok: false, message: 'JSON invalido.' }, 400);
  }

  const media = await resolveMedia(payload);
  return jsonResponse({ ok: true, media });
});
