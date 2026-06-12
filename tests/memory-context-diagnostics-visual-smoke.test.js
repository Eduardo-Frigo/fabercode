const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'chromium',
  ];
  return candidates.find((candidate) => candidate.includes('/') ? fs.existsSync(candidate) : true);
}

function analyzePng(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  const colors = new Set();
  for (let y = 0; y < png.height; y += 16) {
    for (let x = 0; x < png.width; x += 16) {
      const idx = (png.width * y + x) << 2;
      colors.add(`${png.data[idx]},${png.data[idx + 1]},${png.data[idx + 2]},${png.data[idx + 3]}`);
    }
  }
  return {
    width: png.width,
    height: png.height,
    sampledColors: colors.size,
    blankLikely: colors.size < 8,
  };
}

function runChrome(chrome, args) {
  return execFileSync(chrome, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function extractMetrics(dom = '') {
  const match = String(dom || '').match(/<pre id="metrics">([^<]+)<\/pre>/);
  assert.ok(match, 'metrics should be present in dumped DOM');
  return JSON.parse(match[1].replace(/&quot;/g, '"'));
}

function run() {
  const chrome = findChrome();
  assert.ok(chrome, 'Chrome/Chromium is required for memory context visual smoke');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles', 'cortex.css'), 'utf8');
  const htmlPath = path.join(os.tmpdir(), 'faber-memory-context-diagnostics-smoke.html');
  const desktopPng = path.join(os.tmpdir(), 'faber-memory-context-diagnostics-desktop.png');
  const mobilePng = path.join(os.tmpdir(), 'faber-memory-context-diagnostics-mobile.png');
  const mobileAuditPng = path.join(os.tmpdir(), 'faber-memory-context-diagnostics-mobile-audit.png');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; background: #0b1020; color: #f8fafc; font-family: Inter, system-ui, sans-serif; }
    #metrics { position: fixed; left: -9999px; top: -9999px; }
    .cortex-modal { position: static; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
    .cortex-modal__dialog { width: min(1180px, 100%); height: auto; min-height: calc(100vh - 48px); position: relative; }
    .cortex-modal__body { grid-template-columns: minmax(360px, 1fr) minmax(300px, 0.8fr); }
    ${css}
    @media (max-width: 720px) {
      .cortex-modal { padding: 12px; }
      .cortex-modal__body { grid-template-columns: 1fr; }
      .cortex-modal__dialog { min-height: calc(100vh - 24px); }
    }
  </style>
</head>
<body>
  <div class="cortex-modal">
    <div class="cortex-modal__dialog">
      <div class="cortex-modal__head">
        <div class="cortex-modal__title"><strong>Cortex</strong><span>Memória e contexto auditáveis</span></div>
      </div>
      <div class="cortex-modal__body">
        <section class="cortex-card cortex-context-card">
          <div class="cortex-card__head"><strong>Context Frame</strong><span>Fonte dominante, memória usada e provenance</span></div>
          <div class="cortex-context-diagnostics">
            <article class="cortex-context-item">
              <strong>Runtime</strong>
              <p>integrated · MemPalace pronto · RAG pronto</p>
            </article>
            <article class="cortex-context-item">
              <strong>Fonte dominante: memória ativa</strong>
              <p>Memória usada com 2 citação(ões)</p>
              <div class="cortex-context-pills">
                <span class="cortex-context-pill ready">mensagem atual</span>
                <span class="cortex-context-pill ready">memória ativa</span>
                <span class="cortex-context-pill blocked">briefing da conversa</span>
              </div>
            </article>
            <article class="cortex-context-item">
              <strong>Provenance: 2 usada(s), 1 bloqueada(s)</strong>
              <p>Confiança média 68%; vetor 61%. Memória ativa construída com provenance auditável.</p>
              <div class="cortex-context-pills">
                <span class="cortex-context-pill ready">MemPalace projeto</span>
                <span class="cortex-context-pill ready">RAG briefing</span>
              </div>
            </article>
          </div>
        </section>
        <section class="cortex-card cortex-memory-card">
          <div class="cortex-card__head">
            <div><strong>Biblioteca</strong><span>Cortex local</span></div>
            <div class="cortex-library-actions">
              <button class="cortex-icon-action" type="button">↻</button>
              <button class="cortex-icon-action" type="button">⌁</button>
            </div>
          </div>
          <div class="cortex-runtime-status">
            <div class="cortex-runtime-status__item ready"><strong>Cortex</strong><span>2 regras · 1 documento</span></div>
            <div class="cortex-runtime-status__item ready"><strong>Embedding</strong><span>openai · text-embedding-3-small</span></div>
            <div class="cortex-runtime-status__item ready"><strong>MemPalace</strong><span>persistência ativa</span></div>
            <div class="cortex-runtime-status__item ready"><strong>RAG</strong><span>busca semântica ativa</span></div>
          </div>
          <div class="cortex-memory-filters">
            <input type="search" value="arquitetura" />
            <select><option>Promovidas</option></select>
          </div>
          <div class="cortex-library-list">
            <article class="cortex-library-item promoted">
              <div class="cortex-library-item__head"><strong>arquitetura.md</strong><span>codigo</span><span class="cortex-memory-status promoted">promovida</span></div>
              <p>Decisões técnicas recuperadas com citação.</p>
              <div class="cortex-memory-actions">
                <button class="cortex-memory-action" type="button">✎</button>
                <button class="cortex-memory-action" type="button">↑</button>
                <button class="cortex-memory-action" type="button">⏱</button>
                <button class="cortex-memory-action" type="button">×</button>
              </div>
            </article>
          </div>
        </section>
        <section class="cortex-card cortex-context-card">
          <div class="cortex-card__head"><strong>Auditoria</strong><span>Histórico recente</span></div>
          <div class="cortex-memory-audit-list">
            <div class="cortex-memory-audit-title"><strong>Auditoria</strong><span>Histórico recente de memória, lifecycle e provenance</span></div>
            <article class="cortex-memory-audit-item ok">
              <div class="cortex-memory-audit-item__head"><strong>lifecycle promote</strong><span>succeeded</span></div>
              <p>Memória promovida. · 2 usadas / 1 bloqueadas · lifecycle promote</p>
              <small>28/05/2026 10:00</small>
            </article>
          </div>
        </section>
      </div>
    </div>
  </div>
  <pre id="metrics"></pre>
  <script>
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'audit') {
      const modalBody = document.querySelector('.cortex-modal__body');
      if (modalBody) {
        modalBody.scrollTop = modalBody.scrollHeight;
      }
    }
    const rects = Array.from(document.querySelectorAll('.cortex-modal__body > .cortex-card')).map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    });
    const overlaps = rects.flatMap((a, index) => rects.slice(index + 1).map((b) => {
      const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return xOverlap * yOverlap;
    })).filter((area) => area > 1);
    const auditRect = document.querySelector('.cortex-memory-audit-list').getBoundingClientRect();
    document.getElementById('metrics').textContent = JSON.stringify({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      cardOverlapCount: overlaps.length,
      auditVisibleHeight: Math.round(auditRect.height),
      contextCards: document.querySelectorAll('.cortex-context-item').length,
      memoryActions: document.querySelectorAll('.cortex-memory-action').length,
      runtimeItems: document.querySelectorAll('.cortex-runtime-status__item').length,
      auditItems: document.querySelectorAll('.cortex-memory-audit-item').length,
      memoryFilters: document.querySelectorAll('.cortex-memory-filters input, .cortex-memory-filters select').length
    });
  </script>
</body>
</html>`;
  fs.writeFileSync(htmlPath, html, 'utf8');
  const fileUrl = `file://${htmlPath}`;
  const auditFileUrl = `${fileUrl}?view=audit`;
  const baseArgs = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=1000'];

  runChrome(chrome, [...baseArgs, '--window-size=1365,768', `--screenshot=${desktopPng}`, fileUrl]);
  runChrome(chrome, [...baseArgs, '--window-size=500,1000', `--screenshot=${mobilePng}`, fileUrl]);
  runChrome(chrome, [...baseArgs, '--window-size=500,1000', `--screenshot=${mobileAuditPng}`, auditFileUrl]);
  const desktopDom = runChrome(chrome, [...baseArgs, '--window-size=1365,768', '--dump-dom', fileUrl]);
  const mobileDom = runChrome(chrome, [...baseArgs, '--window-size=500,1000', '--dump-dom', fileUrl]);

  const desktopMetrics = extractMetrics(desktopDom);
  const mobileMetrics = extractMetrics(mobileDom);
  assert.strictEqual(desktopMetrics.hasHorizontalOverflow, false);
  assert.strictEqual(mobileMetrics.hasHorizontalOverflow, false);
  assert.strictEqual(desktopMetrics.cardOverlapCount, 0);
  assert.strictEqual(mobileMetrics.cardOverlapCount, 0);
  assert.ok(desktopMetrics.auditVisibleHeight >= 100, 'desktop audit list should be visibly rendered');
  assert.ok(mobileMetrics.auditVisibleHeight >= 100, 'mobile audit list should be visibly rendered');
  assert.strictEqual(desktopMetrics.contextCards, 3);
  assert.strictEqual(mobileMetrics.contextCards, 3);
  assert.strictEqual(desktopMetrics.memoryActions, 4);
  assert.strictEqual(mobileMetrics.memoryActions, 4);
  assert.strictEqual(desktopMetrics.runtimeItems, 4);
  assert.strictEqual(mobileMetrics.runtimeItems, 4);
  assert.strictEqual(desktopMetrics.auditItems, 1);
  assert.strictEqual(mobileMetrics.auditItems, 1);
  assert.strictEqual(desktopMetrics.memoryFilters, 2);
  assert.strictEqual(mobileMetrics.memoryFilters, 2);

  const desktopAnalysis = analyzePng(desktopPng);
  const mobileAnalysis = analyzePng(mobilePng);
  const mobileAuditAnalysis = analyzePng(mobileAuditPng);
  assert.strictEqual(desktopAnalysis.blankLikely, false);
  assert.strictEqual(mobileAnalysis.blankLikely, false);
  assert.strictEqual(mobileAuditAnalysis.blankLikely, false);

  console.log(`memory-context-diagnostics-visual-smoke.test.js: ok ${JSON.stringify({
    desktop: desktopPng,
    mobile: mobilePng,
    mobileAudit: mobileAuditPng,
    desktopColors: desktopAnalysis.sampledColors,
    mobileColors: mobileAnalysis.sampledColors,
    mobileAuditColors: mobileAuditAnalysis.sampledColors,
  })}`);
}

run();
