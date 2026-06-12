const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createVisualHeroPatchService,
  isHeroVisualOverlayRequest,
} = require('../main/services/visual_hero_patch_service');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

async function run() {
  assert.strictEqual(
    isHeroVisualOverlayRequest('Ajuste o hero do topo com video e camada branca de overlay'),
    true
  );
  assert.strictEqual(
    isHeroVisualOverlayRequest('Troque o texto do segundo card para Aprendizagem'),
    false
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-visual-hero-patch-'));
  fs.writeFileSync(
    path.join(root, 'index.html'),
    [
      '<!doctype html>',
      '<html>',
      '<body>',
      '  <main>',
      '  <section class="hero">',
      '    <div class="hero-text"><h1>Hero atual</h1></div>',
      '  </section>',
      '  </main>',
      '</body>',
      '</html>',
    ].join('\n')
  );
  fs.writeFileSync(path.join(root, 'style.css'), '.hero { position: relative; overflow: hidden; }\n');

  const service = createVisualHeroPatchService({
    fs,
    path,
    buildOperationBatchDiffPreview,
    resolveHeroMediaAssets: async () => ({
      provider: 'pexels',
      status: 'ready',
      hero: {
        kind: 'video',
        provider: 'pexels',
        src: 'https://videos.pexels.com/video-files/bees-smoke.mp4',
        poster: 'https://images.pexels.com/photos/bees-smoke.jpeg',
        alt: 'abelhas voando',
        attribution: 'Vídeo de Smoke no Pexels',
        sourceUrl: 'https://www.pexels.com/video/bees-smoke/',
      },
    }),
  });
  const result = await service.buildHeroVisualOverlayOperationBatch({
    projectInfo: {
      rootPath: root,
      totalFiles: 2,
      files: ['index.html', 'style.css'],
    },
    userMessage:
      'Precisamos ajustar o hero do topo do body, colocar um video de abelhas voando e uma camada branca com blend cor',
    executionIntent: 'edit_project',
    providerFailure: { code: 'persona_engine_empty_response', category: 'empty_response' },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.action.generatedBy, 'visual_hero_video_media_patch');
  assert.deepStrictEqual(result.action.operations.map((operation) => operation.path), ['index.html', 'style.css']);
  const html = result.action.operations.find((operation) => operation.path === 'index.html').content;
  const css = result.action.operations.find((operation) => operation.path === 'style.css').content;
  assert.ok(html.includes('class="hero-media-stack"'));
  assert.ok(html.includes('data-source-status="ready"'));
  assert.ok(html.includes('<source src="https://videos.pexels.com/video-files/bees-smoke.mp4" type="video/mp4">'));
  assert.ok(html.includes('has-hero-video'));
  assert.ok(css.includes('.hero-overlay-color'));
  assert.ok(css.includes('filter: grayscale(1)'));
  assert.ok(css.includes('mix-blend-mode: normal'));
  assert.ok(css.includes('rgba(255, 255, 255, 0.15)'));
  assert.strictEqual(result.action.microContract.idempotentWhenAlreadyApplied, true);
  assert.strictEqual(result.action.microContract.sourceStatus, 'ready');
  assert.strictEqual(result.action.microContract.mediaAsset.provider, 'pexels');
  assert.strictEqual(result.action.microContract.providerFailure.code, 'persona_engine_empty_response');

  for (const operation of result.action.operations) {
    fs.writeFileSync(path.join(root, operation.path), operation.content, 'utf8');
  }
  const idempotent = await service.buildHeroVisualOverlayOperationBatch({
    projectInfo: {
      rootPath: root,
      totalFiles: 2,
      files: ['index.html', 'style.css'],
    },
    userMessage: 'Quero vídeo de abelhas voando no hero em preto e branco com overlay leve',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(idempotent.ok, true);
  assert.ok(idempotent.action.operations.length >= 1);
  assert.ok(idempotent.action.operations.every((operation) => ['index.html', 'style.css'].includes(operation.path)));
  assert.strictEqual(idempotent.action.microContract.sourceStatus, 'ready');

  const reuseExistingService = createVisualHeroPatchService({
    fs,
    path,
    buildOperationBatchDiffPreview,
    resolveHeroMediaAssets: async () => ({ provider: 'pexels', status: 'missing_key', hero: null }),
  });
  const reused = await reuseExistingService.buildHeroVisualOverlayOperationBatch({
    projectInfo: {
      rootPath: root,
      totalFiles: 2,
      files: ['index.html', 'style.css'],
    },
    userMessage: 'Quero manter o video de abelhas no hero com overlay leve',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(reused.ok, true);
  assert.strictEqual(reused.action.microContract.sourceStatus, 'ready');
  assert.strictEqual(reused.action.microContract.mediaAsset.provider, 'existing_project');
  assert.ok(reused.action.microContract.mediaAsset.src.includes('bees-smoke.mp4'));

  const overlayOnlyService = createVisualHeroPatchService({
    fs,
    path,
    buildOperationBatchDiffPreview,
    resolveHeroMediaAssets: async () => {
      throw new Error('overlay-only request should preserve the existing hero video without provider lookup');
    },
  });
  const overlayOnly = await overlayOnlyService.buildHeroVisualOverlayOperationBatch({
    projectInfo: {
      rootPath: root,
      totalFiles: 2,
      files: ['index.html', 'style.css'],
    },
    userMessage: 'Ajuste apenas a opacidade do overlay branco do hero para 50%. Nao altere CTA nem conteudo.',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(overlayOnly.ok, true);
  assert.strictEqual(overlayOnly.action.microContract.sourceStatus, 'ready');
  assert.ok(overlayOnly.action.microContract.mediaAsset.src.includes('bees-smoke.mp4'));
  const overlayOnlyHtml = overlayOnly.action.operations.find((operation) => operation.path === 'index.html');
  const overlayOnlyCss = overlayOnly.action.operations.find((operation) => operation.path === 'style.css').content;
  if (overlayOnlyHtml) {
    assert.ok(overlayOnlyHtml.content.includes('https://videos.pexels.com/video-files/bees-smoke.mp4'));
  }
  assert.ok(overlayOnlyCss.includes('rgba(255, 255, 255, 0.5)'));
  assert.ok(overlayOnlyCss.includes('rgba(255, 255, 255, 0)'));

  const alternateService = createVisualHeroPatchService({
    fs,
    path,
    buildOperationBatchDiffPreview,
    resolveHeroMediaAssets: async (options = {}) => {
      assert.strictEqual(options.excludeMedia.src, 'https://videos.pexels.com/video-files/bees-smoke.mp4');
      return {
        provider: 'pexels',
        status: 'ready',
        hero: {
          kind: 'video',
          provider: 'pexels',
          src: 'https://videos.pexels.com/video-files/bees-second.mp4',
          poster: '',
          alt: 'abelhas voando',
          attribution: 'Vídeo de Second no Pexels',
          sourceUrl: 'https://www.pexels.com/video/bees-second/',
        },
      };
    },
  });
  const alternate = await alternateService.buildHeroVisualOverlayOperationBatch({
    projectInfo: {
      rootPath: root,
      totalFiles: 2,
      files: ['index.html', 'style.css'],
    },
    userMessage: 'Troque por outro vídeo de abelhas no hero e mude a opacidade do overlay branco para 75%',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(alternate.ok, true);
  const alternateHtml = alternate.action.operations.find((operation) => operation.path === 'index.html').content;
  const alternateCss = alternate.action.operations.find((operation) => operation.path === 'style.css').content;
  assert.ok(alternateHtml.includes('https://videos.pexels.com/video-files/bees-second.mp4'));
  assert.ok(alternateCss.includes('rgba(255, 255, 255, 0.75)'));
  assert.ok(alternateCss.includes('rgba(255, 255, 255, 0)'));

  const blockedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-visual-hero-patch-blocked-'));
  fs.writeFileSync(
    path.join(blockedRoot, 'index.html'),
    [
      '<!doctype html>',
      '<html>',
      '<body>',
      '  <main>',
      '  <section class="hero">',
      '    <div class="hero-text"><h1>Hero sem video</h1></div>',
      '  </section>',
      '  </main>',
      '</body>',
      '</html>',
    ].join('\n')
  );
  fs.writeFileSync(path.join(blockedRoot, 'style.css'), '.hero { position: relative; overflow: hidden; }\n');
  const blockedService = createVisualHeroPatchService({
    fs,
    path,
    buildOperationBatchDiffPreview,
    resolveHeroMediaAssets: async () => ({ provider: 'pexels', status: 'missing_key', hero: null }),
  });
  const blocked = await blockedService.buildHeroVisualOverlayOperationBatch({
    projectInfo: {
      rootPath: blockedRoot,
      totalFiles: 2,
      files: ['index.html', 'style.css'],
    },
    userMessage: 'Quero um video de abelhas no hero',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(blocked.blocked, true);
  assert.strictEqual(blocked.reason, 'hero_video_asset_unavailable');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
