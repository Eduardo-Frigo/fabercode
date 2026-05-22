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
    resolvePexelsQuery({ userMessage: 'Landing page para venda de estufas agrícolas e cultivo protegido com hero video' }),
    'modern greenhouse farming protected cultivation vegetables'
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
