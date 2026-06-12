const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');

const { createProjectVisualCaptureService } = require('../main/services/project_visual_capture_service');

function buildPng(width, height, paint) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (width * y + x) << 2;
      const color = paint(x, y);
      png.data[offset] = color[0];
      png.data[offset + 1] = color[1];
      png.data[offset + 2] = color[2];
      png.data[offset + 3] = color[3] === undefined ? 255 : color[3];
    }
  }
  return PNG.sync.write(png);
}

function createFakeBrowserWindowClass(bufferProvider, loadedUrls, loadUrlImpl = null, stabilityProvider = null, snapshotProvider = null) {
  return class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.webContents = {
        capturePage: async () => ({
          toPNG: () => bufferProvider(),
        }),
        executeJavaScript: async (script = '') => {
          if (String(script).includes('pendingImages') && String(script).includes('readyState')) {
            return typeof stabilityProvider === 'function'
              ? stabilityProvider()
              : {
                  readyState: 'complete',
                  bodyTextLength: 74,
                  elementCount: 18,
                  pendingImages: 0,
                  mediaCount: 3,
                  fontsReady: true,
                };
          }
          if (typeof snapshotProvider === 'function') {
            return snapshotProvider({ options: this.options, script });
          }
          return {
            title: 'Maison Cacao',
            bodyText: 'Chocolate artesanal premium com cacau selecionado, bombons e processo.',
            viewport: {
              width: this.options.width,
              height: this.options.height,
              devicePixelRatio: 1,
            },
            layout: {
              scrollWidth: this.options.width,
              scrollHeight: 900,
              clientWidth: this.options.width,
              clientHeight: this.options.height,
              overflowX: 0,
              horizontalOverflow: false,
              visibleTextBlocks: 8,
            },
            headings: ['Chocolate feito para ser sentido'],
            buttons: ['Comprar agora'],
            images: [{ src: 'chocolate.jpg', alt: 'Chocolate derretendo' }],
            videos: [],
            iframes: [],
            svgCount: 2,
            iconLikeCount: 2,
            sectionCount: 4,
            formCount: 0,
            computedTokens: [],
          };
        },
      };
    }

    loadURL(url) {
      loadedUrls.push(url);
      if (typeof loadUrlImpl === 'function') return loadUrlImpl(url, loadedUrls.length);
      return Promise.resolve();
    }

    destroy() {
      this.destroyed = true;
    }
  };
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-visual-capture-'));
  try {
    const loadedUrls = [];
    let currentBuffer = buildPng(420, 300, (x, y) => [x % 255, y % 255, (x + y) % 255, 255]);
    const service = createProjectVisualCaptureService({
      BrowserWindow: createFakeBrowserWindowClass(() => currentBuffer, loadedUrls),
      PNG,
      fs,
      path,
    });

    const capture = await service.captureProjectPreview({
      url: 'file:///tmp/index.html',
      rootPath: tempRoot,
      outputDir: path.join(tempRoot, 'captures'),
      waitMs: 0,
      domReadyTimeoutMs: 50,
      domStableIntervalMs: 1,
      domStableQuietMs: 0,
    });

    assert.strictEqual(capture.ok, true);
    assert.strictEqual(loadedUrls[0], 'file:///tmp/index.html');
    assert.strictEqual(capture.loadAttempts, 1);
    assert.strictEqual(capture.domStability.ok, true);
    assert.ok(fs.existsSync(capture.path));
    assert.strictEqual(capture.viewport.id, '1365x768');
    assert.strictEqual(capture.viewport.width, 1365);
    assert.strictEqual(capture.viewport.height, 768);
    assert.strictEqual(capture.analysis.blankLikely, false);
    assert.strictEqual(capture.analysis.horizontalOverflow, false);
    assert.strictEqual(capture.analysis.visibleTextBlocks, 8);
    assert.strictEqual(capture.pageSnapshot.title, 'Maison Cacao');
    assert.strictEqual(capture.pageSnapshot.viewport.width, 1365);
    assert.strictEqual(capture.pageSnapshot.layout.horizontalOverflow, false);
    assert.ok(capture.pageSnapshot.bodyText.includes('Chocolate artesanal premium'));
    assert.strictEqual(capture.issues.length, 0);

    const mobileCapture = await service.captureProjectPreview({
      url: 'file:///tmp/mobile.html',
      rootPath: tempRoot,
      outputDir: path.join(tempRoot, 'captures'),
      viewport: { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
      waitMs: 0,
      domReadyTimeoutMs: 50,
      domStableIntervalMs: 1,
      domStableQuietMs: 0,
    });

    assert.strictEqual(mobileCapture.ok, true);
    assert.strictEqual(mobileCapture.viewport.id, 'mobile');
    assert.strictEqual(mobileCapture.viewport.width, 390);
    assert.strictEqual(mobileCapture.viewport.height, 844);
    assert.match(path.basename(mobileCapture.path), /mobile/);

    const overflowLoadedUrls = [];
    const overflowService = createProjectVisualCaptureService({
      BrowserWindow: createFakeBrowserWindowClass(
        () => currentBuffer,
        overflowLoadedUrls,
        null,
        null,
        ({ options }) => ({
          title: 'Layout Responsivo',
          bodyText: 'Conteudo renderizado com largura excedente.',
          viewport: {
            width: options.width,
            height: options.height,
            devicePixelRatio: 1,
          },
          layout: {
            scrollWidth: options.width + 64,
            scrollHeight: 900,
            clientWidth: options.width,
            clientHeight: options.height,
            overflowX: 64,
            horizontalOverflow: true,
            visibleTextBlocks: 6,
          },
          headings: ['Layout Responsivo'],
          buttons: ['Solicitar orcamento'],
          images: [],
          videos: [],
          iframes: [],
          svgCount: 0,
          iconLikeCount: 0,
          sectionCount: 2,
          formCount: 0,
          computedTokens: [],
        })
      ),
      PNG,
      fs,
      path,
    });
    const overflowCapture = await overflowService.captureProjectPreview({
      url: 'file:///tmp/overflow.html',
      rootPath: tempRoot,
      outputDir: path.join(tempRoot, 'captures'),
      viewport: { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
      waitMs: 0,
      domReadyTimeoutMs: 50,
      domStableIntervalMs: 1,
      domStableQuietMs: 0,
    });

    assert.strictEqual(overflowCapture.ok, true);
    assert.strictEqual(overflowCapture.analysis.horizontalOverflow, true);
    assert.ok(overflowCapture.issues.some((issue) => issue.id === 'capture_horizontal_overflow'));

    currentBuffer = buildPng(420, 300, () => [255, 255, 255, 255]);
    const blankCapture = await service.captureProjectPreview({
      url: 'file:///tmp/blank.html',
      rootPath: tempRoot,
      outputDir: path.join(tempRoot, 'captures'),
      waitMs: 0,
      domReadyTimeoutMs: 50,
      domStableIntervalMs: 1,
      domStableQuietMs: 0,
    });

    assert.strictEqual(blankCapture.ok, true);
    assert.strictEqual(blankCapture.analysis.blankLikely, true);
    assert.ok(blankCapture.issues.some((issue) => issue.id === 'capture_blank'));

    let transientAttempts = 0;
    const retryLoadedUrls = [];
    const retryService = createProjectVisualCaptureService({
      BrowserWindow: createFakeBrowserWindowClass(
        () => currentBuffer,
        retryLoadedUrls,
        () => {
          transientAttempts += 1;
          if (transientAttempts === 1) {
            throw new Error('ERR_EMPTY_RESPONSE (-324) loading http://127.0.0.1:3000/');
          }
          return Promise.resolve();
        }
      ),
      PNG,
      fs,
      path,
    });
    const retriedCapture = await retryService.captureProjectPreview({
      url: 'http://127.0.0.1:3000/',
      rootPath: tempRoot,
      outputDir: path.join(tempRoot, 'captures'),
      waitMs: 0,
      loadRetryDelayMs: 0,
      domReadyTimeoutMs: 50,
      domStableIntervalMs: 1,
      domStableQuietMs: 0,
    });
    assert.strictEqual(retriedCapture.ok, true);
    assert.strictEqual(retriedCapture.loadAttempts, 2);
    assert.strictEqual(retriedCapture.loadRetried, true);
    assert.strictEqual(retryLoadedUrls.length, 2);

    let unstableStep = 0;
    const unstableLoadedUrls = [];
    const unstableService = createProjectVisualCaptureService({
      BrowserWindow: createFakeBrowserWindowClass(
        () => currentBuffer,
        unstableLoadedUrls,
        null,
        () => {
          unstableStep += 1;
          return {
            readyState: 'loading',
            bodyTextLength: unstableStep,
            elementCount: unstableStep,
            pendingImages: 1,
            mediaCount: 1,
            fontsReady: false,
          };
        }
      ),
      PNG,
      fs,
      path,
    });
    const unstableCapture = await unstableService.captureProjectPreview({
      url: 'file:///tmp/unstable.html',
      rootPath: tempRoot,
      outputDir: path.join(tempRoot, 'captures'),
      waitMs: 0,
      domReadyTimeoutMs: 5,
      domStableIntervalMs: 1,
      domStableQuietMs: 1,
    });
    assert.strictEqual(unstableCapture.ok, true);
    assert.strictEqual(unstableCapture.domStability.ok, false);
    assert.ok(unstableCapture.issues.some((issue) => issue.id === 'capture_dom_not_stable'));

    const unavailable = await createProjectVisualCaptureService({
      BrowserWindow: null,
      fs,
      path,
    }).captureProjectPreview({
      url: 'file:///tmp/index.html',
      rootPath: tempRoot,
    });

    assert.strictEqual(unavailable.ok, false);
    assert.strictEqual(unavailable.reason, 'browser_window_unavailable');

    console.log('project-visual-capture-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
