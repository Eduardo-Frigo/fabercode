const defaultCrypto = require('crypto');
const defaultFs = require('fs');
const defaultOs = require('os');
const defaultPath = require('path');
const { createProjectVisualCaptureStabilityService } = require('./project_visual_capture_stability_service');

function optionalPngParser() {
  try {
    return require('pngjs').PNG;
  } catch {
    return null;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), Math.max(1, Number(timeoutMs || 1)));
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isRetryablePreviewLoadError(error = null) {
  const text = String(error && error.message ? error.message : error || '').toLowerCase();
  if (!text) return false;
  return /err_empty_response|err_connection_refused|err_connection_reset|err_connection_aborted|err_aborted|err_timed_out|tempo limite|timeout/.test(text);
}

async function loadUrlWithRetries(win, targetUrl, {
  attempts = 3,
  retryDelayMs = 700,
  timeoutMs = 15000,
} = {}) {
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const loadPromise = typeof win.loadURL === 'function'
        ? win.loadURL(targetUrl)
        : win.webContents && typeof win.webContents.loadURL === 'function'
          ? win.webContents.loadURL(targetUrl)
          : Promise.reject(new Error('BrowserWindow sem loadURL'));
      await withTimeout(
        loadPromise,
        timeoutMs,
        `Tempo limite ao carregar preview (${timeoutMs}ms).`
      );
      return {
        attempts: attempt,
        retried: attempt > 1,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryablePreviewLoadError(error)) break;
      await wait(retryDelayMs * attempt);
    }
  }

  throw lastError || new Error('Falha desconhecida ao carregar preview.');
}

function safeHash(value, cryptoImpl = defaultCrypto) {
  try {
    return cryptoImpl.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
  } catch {
    return String(Date.now());
  }
}

function clipSnapshotText(value = '', maxChars = 12000) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function createProjectVisualCaptureService(dependencies = {}) {
  const {
    BrowserWindow = null,
    PNG = optionalPngParser(),
    app = null,
    artifactStore = null,
    crypto = defaultCrypto,
    captureStabilityService = createProjectVisualCaptureStabilityService(),
    fs = defaultFs,
    os = defaultOs,
    path = defaultPath,
  } = dependencies;

  function resolveOutputDir(rootPath = '', explicitOutputDir = '') {
    if (explicitOutputDir) return path.resolve(explicitOutputDir);
    const userData =
      app && typeof app.getPath === 'function'
        ? app.getPath('userData')
        : path.join(os.tmpdir(), 'faber-code');
    const rootHash = safeHash(rootPath || userData, crypto);
    return path.join(userData, 'visual-captures', rootHash);
  }

  function buildCapturePath({ rootPath = '', url = '', outputDir = '', viewport = null } = {}) {
    const dir = resolveOutputDir(rootPath, outputDir);
    const viewportKey = viewport && (viewport.id || viewport.label || viewport.width || viewport.height)
      ? String(viewport.id || viewport.label || `${viewport.width}x${viewport.height}`)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      : '';
    const stem = `preview-${new Date().toISOString().replace(/[:.]/g, '-')}-${safeHash(`${rootPath}\n${url}`, crypto)}${viewportKey ? `-${viewportKey}` : ''}`;
    return path.join(dir, `${stem}.png`);
  }

  function analyzePngBuffer(buffer) {
    if (!PNG) {
      return {
        available: false,
        issues: [],
      };
    }

    try {
      const png = PNG.sync.read(buffer);
      const width = Number(png.width || 0);
      const height = Number(png.height || 0);
      const totalPixels = Math.max(1, width * height);
      const step = Math.max(1, Math.floor(totalPixels / 20000));
      let count = 0;
      let sumLum = 0;
      let sumLumSq = 0;
      let transparent = 0;
      const colors = new Set();

      for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += step) {
        const offset = pixelIndex * 4;
        const r = png.data[offset] || 0;
        const g = png.data[offset + 1] || 0;
        const b = png.data[offset + 2] || 0;
        const a = png.data[offset + 3] || 0;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const colorKey = `${Math.round(r / 16)}:${Math.round(g / 16)}:${Math.round(b / 16)}:${Math.round(a / 16)}`;
        colors.add(colorKey);
        if (a < 8) transparent += 1;
        sumLum += lum;
        sumLumSq += lum * lum;
        count += 1;
      }

      const meanLuminance = count ? sumLum / count : 0;
      const luminanceVariance = count ? Math.max(0, sumLumSq / count - meanLuminance * meanLuminance) : 0;
      const transparentRatio = count ? transparent / count : 0;
      const uniqueSampledColors = colors.size;
      const blankLikely = luminanceVariance < 4 && uniqueSampledColors <= 3;
      const tooSmall = width < 320 || height < 240;
      const issues = [];

      if (tooSmall) {
        issues.push({
          id: 'capture_viewport_too_small',
          severity: 'warning',
          detail: `Captura muito pequena para validar layout (${width}x${height}).`,
          hint: 'Use viewport maior para validação visual.',
        });
      }
      if (transparentRatio > 0.95) {
        issues.push({
          id: 'capture_transparent',
          severity: 'error',
          detail: 'Captura parece transparente ou sem pintura visível.',
          hint: 'Verifique se o preview renderizou conteúdo antes da captura.',
        });
      } else if (blankLikely) {
        issues.push({
          id: 'capture_blank',
          severity: 'error',
          detail: 'Captura parece vazia ou uniforme demais.',
          hint: 'Abra o preview e confirme se a página carregou conteúdo visível.',
        });
      }

      return {
        available: true,
        width,
        height,
        sampledPixels: count,
        uniqueSampledColors,
        meanLuminance: Number(meanLuminance.toFixed(2)),
        luminanceVariance: Number(luminanceVariance.toFixed(2)),
        transparentRatio: Number(transparentRatio.toFixed(4)),
        blankLikely,
        issues,
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        issues: [
          {
            id: 'capture_analysis_failed',
            severity: 'warning',
            detail: `Não consegui analisar o PNG capturado: ${error.message}`,
            hint: 'A captura foi salva, mas a análise de pixels não rodou.',
          },
        ],
      };
    }
  }

  async function collectRenderedPageSnapshot(win) {
    if (!win || !win.webContents || typeof win.webContents.executeJavaScript !== 'function') {
      return null;
    }

    try {
      const snapshot = await win.webContents.executeJavaScript(`
        (() => {
          const clip = (value, max = 800) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
          const textFrom = (nodes, max = 24) => Array.from(nodes || []).slice(0, max).map((node) => clip(node.innerText || node.textContent || node.getAttribute('aria-label') || '', 220)).filter(Boolean);
          const attrFrom = (nodes, attr, max = 24) => Array.from(nodes || []).slice(0, max).map((node) => clip(node.getAttribute(attr) || '', 220)).filter(Boolean);
          const rectFrom = (node) => {
            const rect = node && typeof node.getBoundingClientRect === 'function'
              ? node.getBoundingClientRect()
              : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
            return {
              top: Math.round(rect.top || 0),
              bottom: Math.round(rect.bottom || 0),
              left: Math.round(rect.left || 0),
              right: Math.round(rect.right || 0),
              width: Math.round(rect.width || 0),
              height: Math.round(rect.height || 0),
            };
          };
          const isVisibleInViewport = (node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1 && rect.bottom >= 0 && rect.top <= window.innerHeight;
          };
          const isAboveFold = (node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1 && rect.top < window.innerHeight && rect.bottom > 0;
          };
          const mediaFrom = (nodes, max = 24) => Array.from(nodes || []).slice(0, max).map((node) => ({
            tag: node.tagName ? node.tagName.toLowerCase() : '',
            src: clip(node.currentSrc || node.src || node.getAttribute('src') || '', 500),
            alt: clip(node.getAttribute('alt') || node.getAttribute('title') || '', 220),
            rect: rectFrom(node),
            visibleInViewport: isVisibleInViewport(node),
            aboveFold: isAboveFold(node),
          }));
          const sectionFrom = (nodes, max = 64) => Array.from(nodes || []).slice(0, max).map((node) => {
            const heading = node.querySelector('h1,h2,h3,[role="heading"]');
            const buttons = Array.from(node.querySelectorAll('button,a,[role="button"]')).slice(0, 10);
            const links = Array.from(node.querySelectorAll('a[href]')).slice(0, 10);
            return {
              tag: node.tagName ? node.tagName.toLowerCase() : '',
              id: clip(node.id || '', 160),
              className: clip(node.className || '', 240),
              role: clip(node.getAttribute('role') || '', 120),
              ariaLabel: clip(node.getAttribute('aria-label') || '', 180),
              heading: heading ? clip(heading.innerText || heading.textContent || '', 240) : '',
              text: clip(node.innerText || node.textContent || '', 1400),
              buttonTexts: buttons.map((entry) => clip(entry.innerText || entry.textContent || entry.getAttribute('aria-label') || '', 160)).filter(Boolean),
              linkTexts: links.map((entry) => clip(entry.innerText || entry.textContent || entry.getAttribute('aria-label') || entry.getAttribute('href') || '', 160)).filter(Boolean),
              mediaCount: node.querySelectorAll('img,picture,video,iframe,svg').length,
              formControlCount: node.querySelectorAll('form,input,textarea,select').length,
              itemCount: node.querySelectorAll('article,li,[class*="card"],[class*="item"],[class*="post"],[class*="product"],[class*="produto"]').length,
              rect: rectFrom(node),
              visibleInViewport: isVisibleInViewport(node),
              aboveFold: isAboveFold(node),
            };
          }).filter((entry) => entry.text || entry.heading || entry.id || entry.className);
          const ctaFrom = (nodes, max = 40) => Array.from(nodes || []).slice(0, max).map((node) => ({
            tag: node.tagName ? node.tagName.toLowerCase() : '',
            text: clip(node.innerText || node.textContent || node.getAttribute('aria-label') || '', 180),
            href: clip(node.getAttribute('href') || '', 240),
            className: clip(node.className || '', 180),
            ariaLabel: clip(node.getAttribute('aria-label') || '', 180),
            rect: rectFrom(node),
            visibleInViewport: isVisibleInViewport(node),
            aboveFold: isAboveFold(node),
          })).filter((entry) => entry.text || entry.href || entry.ariaLabel);
          const computedTokens = Array.from(document.querySelectorAll('body, header, main, section, footer, [class*="hero"], [class*="card"]')).slice(0, 24).map((node) => {
            const style = window.getComputedStyle(node);
            return {
              tag: node.tagName ? node.tagName.toLowerCase() : '',
              className: clip(node.className || '', 180),
              color: style.color || '',
              backgroundColor: style.backgroundColor || '',
              backgroundImage: style.backgroundImage && style.backgroundImage !== 'none' ? style.backgroundImage.slice(0, 500) : '',
              fontFamily: style.fontFamily || '',
            };
          });
          const doc = document.documentElement || document.body;
          const body = document.body || doc;
          const overflowCandidates = Array.from(document.querySelectorAll('body *')).slice(0, 1000).map((node) => {
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return {
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height,
              visible: rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden',
            };
          }).filter((rect) => rect.visible);
          const elementOverflowX = Math.ceil(Math.max(0, ...overflowCandidates.map((rect) => Math.max(
            rect.right - window.innerWidth,
            -rect.left,
            rect.width - window.innerWidth
          ))));
          const oversizedElementCount = overflowCandidates.filter((rect) => (
            rect.left < -1 ||
            rect.right > window.innerWidth + 1 ||
            rect.width > window.innerWidth + 1
          )).length;
          const scrollOverflowX = Math.max(0, Math.max(doc ? doc.scrollWidth || 0 : 0, body ? body.scrollWidth || 0 : 0) - window.innerWidth);
          const overflowX = Math.max(scrollOverflowX, elementOverflowX);
          const visibleTextBlocks = Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,label,summary,li')).filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1 && rect.bottom >= 0 && rect.top <= window.innerHeight;
          }).length;
          const aboveFoldNodes = Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,label,summary,li')).filter(isAboveFold);
          const sectionNodes = Array.from(new Set(Array.from(document.querySelectorAll([
            'header',
            'main',
            'section',
            'footer',
            'form',
            '[role="banner"]',
            '[role="region"]',
            '[role="contentinfo"]',
            '[class*="hero"]',
            '[id*="hero"]',
            '[class*="section"]',
            '[class*="product"]',
            '[class*="produto"]',
            '[id*="produto"]',
            '[id*="loja"]',
            '[class*="shop"]',
            '[class*="blog"]',
            '[id*="blog"]',
            '[class*="portfolio"]',
            '[id*="portfolio"]',
            '[class*="gallery"]',
            '[class*="galeria"]',
            '[id*="galeria"]',
            '[class*="testimonial"]',
            '[class*="depo"]',
            '[id*="depo"]',
            '[class*="contact"]',
            '[class*="contato"]',
            '[id*="contato"]'
          ].join(',')))));
          return {
            url: location.href,
            title: clip(document.title || '', 300),
            lang: document.documentElement ? String(document.documentElement.lang || '') : '',
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
              devicePixelRatio: window.devicePixelRatio || 1,
            },
            layout: {
              scrollWidth: doc ? doc.scrollWidth || 0 : 0,
              scrollHeight: doc ? doc.scrollHeight || 0 : 0,
              clientWidth: doc ? doc.clientWidth || window.innerWidth : window.innerWidth,
              clientHeight: doc ? doc.clientHeight || window.innerHeight : window.innerHeight,
              overflowX,
              scrollOverflowX,
              elementOverflowX,
              oversizedElementCount,
              horizontalOverflow: overflowX > 8,
              visibleTextBlocks,
            },
            aboveFold: {
              text: clip(aboveFoldNodes.map((node) => node.innerText || node.textContent || node.getAttribute('aria-label') || '').join(' '), 2400),
              headings: textFrom(aboveFoldNodes.filter((node) => /^h[1-3]$/i.test(node.tagName || '') || node.getAttribute('role') === 'heading'), 12),
              buttons: textFrom(aboveFoldNodes.filter((node) => /^(a|button)$/i.test(node.tagName || '') || node.getAttribute('role') === 'button'), 16),
              hasH1: aboveFoldNodes.some((node) => /^h1$/i.test(node.tagName || '')),
              visibleTextBlocks,
              mediaCount: Array.from(document.querySelectorAll('img,picture,video,iframe,svg')).filter(isAboveFold).length,
            },
            bodyText: clip(document.body ? document.body.innerText || document.body.textContent || '' : '', 12000),
            headings: textFrom(document.querySelectorAll('h1,h2,h3'), 32),
            buttons: textFrom(document.querySelectorAll('button,a,[role="button"]'), 32),
            links: attrFrom(document.querySelectorAll('a[href]'), 'href', 32),
            images: mediaFrom(document.querySelectorAll('img,picture img'), 32),
            videos: mediaFrom(document.querySelectorAll('video,source[type^="video"]'), 16),
            iframes: mediaFrom(document.querySelectorAll('iframe'), 16),
            svgCount: document.querySelectorAll('svg').length,
            iconLikeCount: document.querySelectorAll('svg,[class*="icon"],[data-icon],[aria-label*="icon"],i[class]').length,
            sectionCount: document.querySelectorAll('section,[class*="section"],main > div').length,
            formCount: document.querySelectorAll('form,input,textarea,select').length,
            sections: sectionFrom(sectionNodes, 64),
            ctaCandidates: ctaFrom(document.querySelectorAll('button,a,[role="button"]'), 40),
            computedTokens,
          };
        })();
      `);
      if (!snapshot || typeof snapshot !== 'object') return null;
      return {
        ...snapshot,
        bodyText: clipSnapshotText(snapshot.bodyText || ''),
      };
    } catch {
      return null;
    }
  }

  function analyzePageSnapshotForViewport(pageSnapshot = null, viewport = {}) {
    if (!pageSnapshot || typeof pageSnapshot !== 'object') return [];
    const issues = [];
    const layout = pageSnapshot.layout && typeof pageSnapshot.layout === 'object' ? pageSnapshot.layout : {};
    const overflowX = Math.max(
      Number(layout.overflowX || 0),
      Number(layout.elementOverflowX || 0),
      layout.horizontalOverflow ? 9 : 0
    );
    const visibleTextBlocks = Number(layout.visibleTextBlocks || 0);
    const label = viewport && viewport.label ? String(viewport.label) : 'viewport';
    if (overflowX > 24) {
      issues.push({
        id: 'capture_horizontal_overflow',
        severity: 'error',
        detail: `Layout ultrapassou a largura do ${label} em ${Math.round(overflowX)}px.`,
        hint: 'Revise grids, cards, títulos e containers com largura fixa para evitar rolagem horizontal.',
      });
    } else if (overflowX > 8) {
      issues.push({
        id: 'capture_horizontal_overflow',
        severity: 'warning',
        detail: `Layout tem indício de rolagem horizontal no ${label} (${Math.round(overflowX)}px).`,
        hint: 'Verifique responsividade e containers com largura fixa.',
      });
    }
    if (visibleTextBlocks <= 0) {
      issues.push({
        id: 'capture_no_visible_text',
        severity: 'error',
        detail: `Nenhum bloco de texto visível foi detectado no ${label}.`,
        hint: 'Confirme se o conteúdo principal apareceu dentro da primeira viewport.',
      });
    }
    return issues;
  }

  async function captureProjectPreview({
    url = '',
    rootPath = '',
    outputDir = '',
    viewport = null,
    waitMs = 700,
    timeoutMs = 15000,
    loadAttempts = 3,
    loadRetryDelayMs = 700,
    domReadyTimeoutMs = 5000,
    domStableIntervalMs = 120,
    domStableQuietMs = 240,
  } = {}) {
    const targetUrl = String(url || '').trim();
    const width = Math.max(320, Number(viewport && viewport.width ? viewport.width : 1365));
    const height = Math.max(240, Number(viewport && viewport.height ? viewport.height : 768));
    const viewportInfo = {
      id: String(viewport && viewport.id ? viewport.id : `${width}x${height}`),
      label: String(viewport && viewport.label ? viewport.label : viewport && viewport.id ? viewport.id : `${width}x${height}`),
      width,
      height,
    };
    if (!targetUrl) {
      return {
        ok: false,
        reason: 'missing_preview_url',
        message: 'Preview sem URL para captura visual.',
        viewport: viewportInfo,
        issues: [
          {
            id: 'missing_preview_url',
            severity: 'error',
            detail: 'Preview não expôs uma URL capturável.',
            hint: 'Inicie um preview web antes de validar visualmente.',
          },
        ],
      };
    }

    if (typeof BrowserWindow !== 'function') {
      return {
        ok: false,
        reason: 'browser_window_unavailable',
        message: 'BrowserWindow indisponível para captura visual.',
        viewport: viewportInfo,
        issues: [
          {
            id: 'browser_window_unavailable',
            severity: 'warning',
            detail: 'Runtime atual não fornece BrowserWindow para capturar o preview.',
            hint: 'Execute esta validação dentro do app Electron.',
          },
        ],
      };
    }

    let win = null;
    try {
      const capturePath = buildCapturePath({ rootPath, url: targetUrl, outputDir, viewport: viewportInfo });
      fs.mkdirSync(path.dirname(capturePath), { recursive: true });
      win = new BrowserWindow({
        width,
        height,
        show: false,
        backgroundColor: '#ffffff',
        webPreferences: {
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      const loadResult = await loadUrlWithRetries(win, targetUrl, {
        attempts: loadAttempts,
        retryDelayMs: loadRetryDelayMs,
        timeoutMs,
      });
      const domStability = captureStabilityService &&
        typeof captureStabilityService.waitForVisualCaptureStability === 'function'
        ? await captureStabilityService.waitForVisualCaptureStability(win, {
            domReadyTimeoutMs,
            domStableIntervalMs,
            domStableQuietMs,
          })
        : null;
      await wait(waitMs);

      if (!win.webContents || typeof win.webContents.capturePage !== 'function') {
        throw new Error('BrowserWindow sem webContents.capturePage');
      }

      const image = await win.webContents.capturePage();
      if (!image || typeof image.toPNG !== 'function') {
        throw new Error('Captura não retornou imagem PNG.');
      }

      const pngBuffer = image.toPNG();
      fs.writeFileSync(capturePath, pngBuffer);
      const analysis = analyzePngBuffer(pngBuffer);
      const pageSnapshot = await collectRenderedPageSnapshot(win);
      const snapshotIssues = analyzePageSnapshotForViewport(pageSnapshot, viewportInfo);
      const artifactRecord = artifactStore && typeof artifactStore.storeArtifact === 'function'
        ? artifactStore.storeArtifact({
            rootPath,
            sourcePath: capturePath,
            kind: 'screenshot',
            category: 'visual_capture',
            label: viewportInfo.id || viewportInfo.label || 'preview',
            metadata: {
              url: targetUrl,
              viewport: viewportInfo,
              analysis: {
                available: Boolean(analysis.available),
                uniqueSampledColors: analysis.uniqueSampledColors || 0,
                blankLikely: Boolean(analysis.blankLikely),
              },
              pageSnapshot: pageSnapshot
                ? {
                    title: pageSnapshot.title || '',
                    horizontalOverflow: Boolean(pageSnapshot.layout && pageSnapshot.layout.horizontalOverflow),
                    visibleTextBlocks: Number(pageSnapshot.layout ? pageSnapshot.layout.visibleTextBlocks || 0 : 0),
                  }
                : null,
            },
          })
        : null;
      const issues = [
        ...(Array.isArray(analysis.issues) ? analysis.issues : []),
        ...(domStability && domStability.ok === false && domStability.issue ? [domStability.issue] : []),
        ...snapshotIssues,
      ];
      return {
        ok: true,
        reason: 'captured',
        url: targetUrl,
        path: capturePath,
        permanentPath: artifactRecord && artifactRecord.ok ? artifactRecord.path : '',
        permanentRelativePath: artifactRecord && artifactRecord.ok ? artifactRecord.relativePath : '',
        viewport: viewportInfo,
        width,
        height,
        loadAttempts: loadResult.attempts,
        loadRetried: Boolean(loadResult.retried),
        domStability,
        bytes: pngBuffer.length,
        analysis: {
          available: Boolean(analysis.available),
          width: analysis.width || width,
          height: analysis.height || height,
          sampledPixels: analysis.sampledPixels || 0,
          uniqueSampledColors: analysis.uniqueSampledColors || 0,
          meanLuminance: analysis.meanLuminance || 0,
          luminanceVariance: analysis.luminanceVariance || 0,
          transparentRatio: analysis.transparentRatio || 0,
          blankLikely: Boolean(analysis.blankLikely),
          horizontalOverflow: Boolean(pageSnapshot && pageSnapshot.layout && pageSnapshot.layout.horizontalOverflow),
          overflowX: Number(pageSnapshot && pageSnapshot.layout ? pageSnapshot.layout.overflowX || 0 : 0),
          visibleTextBlocks: Number(pageSnapshot && pageSnapshot.layout ? pageSnapshot.layout.visibleTextBlocks || 0 : 0),
        },
        pageSnapshot,
        artifactStore: artifactRecord,
        issues,
        message: 'Preview capturado para validação visual.',
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'capture_failed',
        url: targetUrl,
        viewport: viewportInfo,
        message: `Falha ao capturar preview: ${error.message}`,
        issues: [
          {
            id: 'capture_failed',
            severity: 'error',
            detail: `Falha ao capturar preview: ${error.message}`,
            hint: 'Verifique se o preview abre localmente antes da validação visual.',
          },
        ],
      };
    } finally {
      if (win) {
        try {
          if (typeof win.destroy === 'function') win.destroy();
          else if (typeof win.close === 'function') win.close();
        } catch {
          // Best effort window cleanup.
        }
      }
    }
  }

  return {
    analyzePngBuffer,
    collectRenderedPageSnapshot,
    captureProjectPreview,
    resolveOutputDir,
  };
}

module.exports = {
  createProjectVisualCaptureService,
};
