const assert = require('assert');

const {
  createPexelsAssetService,
  resolvePexelsMediaPreference,
  resolvePexelsQuery,
} = require('../main/services/pexels_asset_service');

async function run() {
  assert.strictEqual(
    resolvePexelsQuery({ userMessage: 'Criar site para advogado com azul e branco' }),
    'law office consultation'
  );
  assert.strictEqual(
    resolvePexelsQuery({ userMessage: 'Landing page para corretor de imóveis moderno' }),
    'modern real estate interior modern'
  );
  assert.strictEqual(
    resolvePexelsQuery({ userMessage: 'faz qualquer coisa sobre baleias jubarte no oceano azul' }),
    'humpback whale ocean blue'
  );
  assert.strictEqual(
    resolvePexelsQuery({ userMessage: 'Landing para bolsas, pastas e artefatos de couro artesanal' }),
    'handmade leather bags artisan workshop'
  );
  assert.strictEqual(
    resolvePexelsQuery({
      userMessage: 'Landing para chocolate artesanal premium com cacau, bombons e vídeo sensorial',
      contextText: 'conversa antiga sobre couro artesanal e bolsas',
    }),
    'artisan chocolate melting cocoa premium dessert premium'
  );
  assert.strictEqual(
    resolvePexelsQuery({ userMessage: 'Landing page para venda de estufas agrícolas e cultivo protegido com hero video' }),
    'modern greenhouse farming protected cultivation vegetables'
  );
  assert.strictEqual(
    resolvePexelsQuery({ userMessage: 'Site completo de jardinagem com paisagismo, plantas para apartamento e loja de jardinagem' }),
    'lush home garden landscaping plants natural light'
  );
  assert.strictEqual(
    resolvePexelsQuery({ userMessage: 'Site de escultura em madeira com vídeo de talha manual e ateliê de escultura' }),
    'wood carving artisan hands sculpture workshop'
  );
  assert.strictEqual(
    resolvePexelsQuery({ userMessage: 'Ajustar hero com vídeo de abelhas voando' }),
    'honey bees flying flowers pollination macro'
  );
  assert.strictEqual(
    resolvePexelsQuery({
      userMessage: 'Site para laboratório fotográfico com revelação de filmes, negativos, darkroom e impressão fine art',
    }),
    'darkroom film development photo lab fine art printing negatives'
  );
  assert.strictEqual(
    resolvePexelsMediaPreference({ userMessage: 'usar um hero video no topo' }),
    'video'
  );
  assert.strictEqual(
    resolvePexelsQuery({
      userMessage: 'Criar site para advogado',
      mediaIntent: [{ query: 'modern law office with blue tones' }],
    }),
    'modern law office with blue tones'
  );
  assert.strictEqual(
    resolvePexelsMediaPreference({
      userMessage: 'usar foto se nao houver contrato',
      mediaIntent: [{ mediaType: 'video' }],
    }),
    'video'
  );

  const requested = [];
  const service = createPexelsAssetService({
    getApiKey: () => 'pexels-test-key',
    fetchFn: async (url, options) => {
      requested.push({ url, authorization: options.headers.Authorization });
      return {
        ok: true,
        async json() {
          return {
            photos: [
              {
                id: 123,
                url: 'https://www.pexels.com/photo/sample-123/',
                photographer: 'Jane Creator',
                photographer_url: 'https://www.pexels.com/@jane',
                alt: 'Professional office with blue details',
                src: {
                  landscape: 'https://images.pexels.com/photos/123/office.jpeg',
                },
              },
            ],
          };
        },
      };
    },
  });

  const assets = await service.resolveBlueprintMediaAssets({
    userMessage: 'Crie um site em Next.js para advogado com placeholders',
  });

  assert.strictEqual(assets.status, 'ready');
  assert.strictEqual(assets.hero.kind, 'photo');
  assert.strictEqual(assets.hero.provider, 'pexels');
  assert.strictEqual(assets.hero.photographer, 'Jane Creator');
  assert.strictEqual(assets.hero.attribution, 'Foto de Jane Creator no Pexels');
  assert.ok(requested[0].url.includes('/v1/search'));
  assert.ok(requested[0].url.includes('law+office+consultation'));
  assert.ok(requested[0].url.includes('orientation=landscape'));
  assert.strictEqual(requested[0].authorization, 'pexels-test-key');

  requested.length = 0;
  await service.resolveBlueprintMediaAssets({
    userMessage: 'Criar site sobre baleias jubarte com azul e branco',
    mediaIntent: [{ query: 'humpback whale ocean blue', orientation: 'portrait', color: '#3240a8' }],
  });
  assert.ok(requested[0].url.includes('humpback+whale+ocean+blue'));
  assert.ok(requested[0].url.includes('orientation=portrait'));
  assert.ok(requested[0].url.includes('color=%233240a8'));

  const videoRequests = [];
  const videoService = createPexelsAssetService({
    getApiKey: () => 'pexels-video-key',
    fetchFn: async (url) => {
      videoRequests.push(url);
      return {
        ok: true,
        async json() {
          return {
            videos: [
              {
                id: 456,
                url: 'https://www.pexels.com/video/bees-456/',
                user: { name: 'Video Creator', url: 'https://www.pexels.com/@video' },
                video_files: [
                  { file_type: 'video/mp4', width: 1280, height: 720, link: 'https://videos.pexels.com/video-files/bees.mp4' },
                ],
                video_pictures: [{ picture: 'https://images.pexels.com/photos/bees.jpeg' }],
              },
            ],
          };
        },
      };
    },
  });
  const videoAssets = await videoService.resolveBlueprintMediaAssets({
    userMessage: 'Ajustar hero com vídeo de abelhas voando',
    requireVideo: true,
    allowPhotoFallback: false,
  });
  assert.strictEqual(videoAssets.status, 'ready');
  assert.strictEqual(videoAssets.preference, 'video');
  assert.strictEqual(videoAssets.hero.kind, 'video');
  assert.strictEqual(videoAssets.hero.src, 'https://videos.pexels.com/video-files/bees.mp4');
  assert.ok(videoRequests[0].includes('/videos/search'));
  assert.ok(videoRequests[0].includes('honey+bees+flying+flowers+pollination+macro'));

  const alternateVideoRequests = [];
  const alternateVideoService = createPexelsAssetService({
    getApiKey: () => 'pexels-video-key',
    fetchFn: async (url) => {
      alternateVideoRequests.push(url);
      return {
        ok: true,
        async json() {
          return {
            videos: [
              {
                id: 456,
                url: 'https://www.pexels.com/video/bees-456/',
                user: { name: 'Video Creator', url: 'https://www.pexels.com/@video' },
                video_files: [
                  { file_type: 'video/mp4', width: 1280, height: 720, link: 'https://videos.pexels.com/video-files/bees.mp4' },
                ],
                video_pictures: [],
              },
              {
                id: 789,
                url: 'https://www.pexels.com/video/bees-789/',
                user: { name: 'Second Creator', url: 'https://www.pexels.com/@second' },
                video_files: [
                  { file_type: 'video/mp4', width: 1280, height: 720, link: 'https://videos.pexels.com/video-files/bees-second.mp4' },
                ],
                video_pictures: [],
              },
            ],
          };
        },
      };
    },
  });
  const alternateAssets = await alternateVideoService.resolveBlueprintMediaAssets({
    userMessage: 'Troque por outro vídeo de abelhas no hero',
    requireVideo: true,
    allowPhotoFallback: false,
    excludeMedia: {
      src: 'https://videos.pexels.com/video-files/bees.mp4',
      sourceUrl: 'https://www.pexels.com/video/bees-456/',
    },
  });
  assert.strictEqual(alternateAssets.status, 'ready');
  assert.strictEqual(alternateAssets.hero.src, 'https://videos.pexels.com/video-files/bees-second.mp4');
  assert.ok(alternateVideoRequests[0].includes('per_page=8'));

  const unavailableVideo = createPexelsAssetService({
    getApiKey: () => 'pexels-video-key',
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { videos: [] };
      },
    }),
  });
  const unavailableAssets = await unavailableVideo.resolveBlueprintMediaAssets({
    userMessage: 'Ajustar hero com vídeo de abelhas voando',
    requireVideo: true,
    allowPhotoFallback: false,
  });
  assert.strictEqual(unavailableAssets.status, 'unavailable');
  assert.strictEqual(unavailableAssets.hero, null);

  const missing = createPexelsAssetService({
    getApiKey: () => '',
    fetchFn: async () => {
      throw new Error('should not fetch without key');
    },
  });
  const missingAssets = await missing.resolveBlueprintMediaAssets({
    userMessage: 'Crie um site para clínica',
  });
  assert.strictEqual(missingAssets.status, 'missing_key');
  assert.strictEqual(missingAssets.hero, null);

  console.log('pexels-asset-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
