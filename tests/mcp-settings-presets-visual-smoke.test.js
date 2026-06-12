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

function runChrome(chrome, args) {
  return execFileSync(chrome, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

function extractMetrics(dom = '') {
  const match = String(dom || '').match(/<pre id="metrics">([^<]+)<\/pre>/);
  assert.ok(match, 'metrics should be present in dumped DOM');
  return JSON.parse(match[1].replace(/&quot;/g, '"'));
}

function run() {
  const chrome = findChrome();
  assert.ok(chrome, 'Chrome/Chromium is required for MCP settings visual smoke');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles', 'settings.css'), 'utf8');
  const htmlPath = path.join(os.tmpdir(), 'faber-mcp-settings-presets-smoke.html');
  const desktopPng = path.join(os.tmpdir(), 'faber-mcp-settings-presets-desktop.png');
  const mobilePng = path.join(os.tmpdir(), 'faber-mcp-settings-presets-mobile.png');
  const mobileToolsPng = path.join(os.tmpdir(), 'faber-mcp-settings-presets-mobile-tools.png');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; min-height: 100vh; background: #101114; color: #f5f5f5; font-family: Inter, system-ui, sans-serif; }
    #metrics { position: fixed; left: -9999px; top: -9999px; }
    .ai-settings-modal { position: static; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
    .ai-settings-modal__dialog { width: min(1040px, 100%); max-height: none; }
    .ai-settings-panel { display: grid !important; gap: 14px; }
    .hidden { display: none !important; }
    .btn { min-height: 34px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.08); color: #f8fafc; padding: 0 12px; }
    .btn-success { border-color: rgba(74,222,128,.32); background: rgba(34,197,94,.16); }
    .btn-muted { border-color: rgba(148,163,184,.24); }
    ${css}
    @media (max-width: 720px) {
      .ai-settings-modal { padding: 12px; }
    }
  </style>
</head>
<body>
  <div class="ai-settings-modal">
    <div class="ai-settings-modal__dialog">
      <div class="ai-settings-modal__body">
        <div id="ai-settings-mcp-panel" class="ai-settings-panel">
          <div class="ai-settings-panel-head">
            <button type="button" class="btn btn-muted">Voltar</button>
            <span>MCP externo</span>
          </div>
          <p id="ai-settings-mcp-status" class="ai-settings-current">4 presets guiados disponíveis · 2 servidores configurados.</p>
          <div class="ai-settings-mcp-presets">
            <label class="ai-settings-field">
              <span>Preset guiado</span>
              <select>
                <option>Official Filesystem MCP</option>
                <option>DeepWiki Public MCP</option>
                <option>Playwright Browser MCP</option>
                <option>GitHub MCP Read-only · requer segredo</option>
              </select>
            </label>
            <button type="button" class="btn btn-muted">Usar preset</button>
          </div>
          <div class="ai-settings-mcp-editor">
            <div class="ai-settings-mcp-grid">
              <label class="ai-settings-field"><span>Nome</span><input value="DeepWiki Public MCP" /></label>
              <label class="ai-settings-field"><span>Transporte</span><select><option>HTTP</option></select></label>
            </div>
            <label class="ai-settings-field"><span>Endpoint HTTP/SSE</span><input value="https://mcp.deepwiki.com/mcp" /></label>
            <div class="ai-settings-mcp-grid">
              <label class="ai-settings-field"><span>Tools permitidas</span><input value="read_wiki_structure, read_wiki_contents, ask_question" /></label>
              <label class="ai-settings-field"><span>Tools bloqueadas</span><input value="filesystem.write" /></label>
            </div>
            <div class="ai-settings-mcp-toggles">
              <label class="workspace-toggle-row"><input type="checkbox" checked /><span>Ativo</span></label>
              <label class="workspace-toggle-row"><input type="checkbox" /><span>Aprovado</span></label>
              <label class="workspace-toggle-row"><input type="checkbox" checked /><span>Rede externa</span></label>
            </div>
            <div class="ai-settings-editor-actions">
              <button type="button" class="btn btn-muted">Novo</button>
              <button type="button" class="btn btn-success">Salvar servidor</button>
            </div>
          </div>
          <div class="ai-settings-mcp-list">
            <div class="ai-settings-api-item ai-settings-mcp-item">
              <div class="ai-settings-api-meta">
                <div class="ai-settings-api-title-row"><strong>DeepWiki Public MCP</strong><span class="ai-settings-api-badge">http</span><span class="ai-settings-api-badge is-active">pronto</span></div>
                <div class="ai-settings-api-detail">https://mcp.deepwiki.com/mcp</div>
                <div class="ai-settings-api-facts">Permitidas: read_wiki_structure, read_wiki_contents, ask_question | Risco max: medium | Rede: externa permitida</div>
                <div class="ai-settings-mcp-cache-title">Cache visual: 3 tools</div>
                <div class="ai-settings-mcp-tools ai-settings-mcp-cache">
                  <span class="ai-settings-api-badge is-active">read_wiki_structure medium/read</span>
                  <span class="ai-settings-api-badge is-active">read_wiki_contents medium/read</span>
                  <span class="ai-settings-api-badge is-active">ask_question medium/read</span>
                </div>
              </div>
              <div class="ai-settings-api-actions"><button class="btn btn-muted">Editar</button><button class="btn btn-success">Descobrir</button><button class="btn btn-danger">Remover</button></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <pre id="metrics"></pre>
  <script>
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'tools') {
      const scrollHost = document.querySelector('.ai-settings-modal__body');
      if (scrollHost) {
        scrollHost.scrollTop = scrollHost.scrollHeight;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
    const toolCacheRect = document.querySelector('.ai-settings-mcp-cache').getBoundingClientRect();
    const fixedRects = Array.from(document.querySelectorAll('.ai-settings-modal__dialog, .ai-settings-mcp-item, .ai-settings-api-actions, .ai-settings-api-actions .btn, .ai-settings-mcp-cache')).map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    const scrollContainers = Array.from(document.querySelectorAll('.ai-settings-modal__body, .ai-settings-mcp-list'));
    const clippedButtons = Array.from(document.querySelectorAll('.ai-settings-api-actions .btn')).filter((node) => node.scrollWidth > node.clientWidth + 1);
    document.getElementById('metrics').textContent = JSON.stringify({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      hasFixedElementOverflow: fixedRects.some((rect) => rect.left < -1 || rect.right > window.innerWidth + 1),
      hasScrollContainerOverflow: scrollContainers.some((node) => node.scrollWidth > node.clientWidth + 1),
      clippedActionButtons: clippedButtons.length,
      toolCacheHeight: Math.round(toolCacheRect.height),
      presetControls: document.querySelectorAll('.ai-settings-mcp-presets select, .ai-settings-mcp-presets button').length,
      mcpItems: document.querySelectorAll('.ai-settings-mcp-item').length,
      toolChips: document.querySelectorAll('.ai-settings-mcp-cache .ai-settings-api-badge').length
    });
  </script>
</body>
</html>`;
  fs.writeFileSync(htmlPath, html, 'utf8');
  const fileUrl = `file://${htmlPath}`;
  const toolsFileUrl = `${fileUrl}?view=tools`;
  const baseArgs = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=1000'];
  runChrome(chrome, [...baseArgs, '--window-size=1365,768', `--screenshot=${desktopPng}`, fileUrl]);
  runChrome(chrome, [...baseArgs, '--window-size=390,900', `--screenshot=${mobilePng}`, fileUrl]);
  runChrome(chrome, [...baseArgs, '--window-size=390,900', `--screenshot=${mobileToolsPng}`, toolsFileUrl]);
  const desktopMetrics = extractMetrics(runChrome(chrome, [...baseArgs, '--window-size=1365,768', '--dump-dom', fileUrl]));
  const mobileMetrics = extractMetrics(runChrome(chrome, [...baseArgs, '--window-size=390,900', '--dump-dom', fileUrl]));
  assert.strictEqual(desktopMetrics.hasHorizontalOverflow, false);
  assert.strictEqual(mobileMetrics.hasHorizontalOverflow, false);
  assert.strictEqual(desktopMetrics.hasFixedElementOverflow, false);
  assert.strictEqual(mobileMetrics.hasFixedElementOverflow, false);
  assert.strictEqual(desktopMetrics.hasScrollContainerOverflow, false);
  assert.strictEqual(mobileMetrics.hasScrollContainerOverflow, false);
  assert.strictEqual(desktopMetrics.clippedActionButtons, 0);
  assert.strictEqual(mobileMetrics.clippedActionButtons, 0);
  assert.ok(desktopMetrics.toolCacheHeight >= 24, 'desktop tool cache should be visibly rendered');
  assert.ok(mobileMetrics.toolCacheHeight >= 24, 'mobile tool cache should be visibly rendered');
  assert.strictEqual(desktopMetrics.presetControls, 2);
  assert.strictEqual(mobileMetrics.presetControls, 2);
  assert.strictEqual(desktopMetrics.mcpItems, 1);
  assert.strictEqual(mobileMetrics.mcpItems, 1);
  assert.strictEqual(desktopMetrics.toolChips, 3);
  assert.strictEqual(mobileMetrics.toolChips, 3);
  const desktopAnalysis = analyzePng(desktopPng);
  const mobileAnalysis = analyzePng(mobilePng);
  const mobileToolsAnalysis = analyzePng(mobileToolsPng);
  assert.strictEqual(desktopAnalysis.blankLikely, false);
  assert.strictEqual(mobileAnalysis.blankLikely, false);
  assert.strictEqual(mobileToolsAnalysis.blankLikely, false);
  console.log(`mcp-settings-presets-visual-smoke.test.js: ok ${JSON.stringify({
    desktop: desktopPng,
    mobile: mobilePng,
    mobileTools: mobileToolsPng,
    desktopColors: desktopAnalysis.sampledColors,
    mobileColors: mobileAnalysis.sampledColors,
    mobileToolsColors: mobileToolsAnalysis.sampledColors,
  })}`);
}

run();
