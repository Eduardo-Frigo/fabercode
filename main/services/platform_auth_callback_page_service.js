const fs = require('fs');
const path = require('path');

let cachedLogoDataUri = null;

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getFaberLogoDataUri() {
  if (cachedLogoDataUri !== null) return cachedLogoDataUri;
  try {
    const logoPath = path.join(__dirname, '..', '..', 'renderer', 'assets', 'Faber-Code-Logo-02.png');
    const logo = fs.readFileSync(logoPath);
    cachedLogoDataUri = `data:image/png;base64,${logo.toString('base64')}`;
  } catch {
    cachedLogoDataUri = '';
  }
  return cachedLogoDataUri;
}

function buildLoginResultHtml({ ok, message } = {}) {
  const success = Boolean(ok);
  const title = success ? 'Login feito com sucesso!' : 'Login nao concluido';
  const text = success
    ? 'Pode fechar essa página.'
    : message || 'Nao foi possivel concluir o login.';
  const logoDataUri = success ? getFaberLogoDataUri() : '';
  const brandHtml = logoDataUri
    ? `<img class="brand-logo" src="${escapeHtml(logoDataUri)}" alt="Faber Code" data-brand="FaberCode">`
    : '<div class="brand-fallback" aria-label="Faber Code">FaberCode</div>';
  const closeScript = success
    ? `<script>
(function () {
  var attempts = 0;
  var manualFallbackShown = false;
  function showManualFallback() {
    if (manualFallbackShown) return;
    manualFallbackShown = true;
    document.documentElement.setAttribute('data-close-blocked', 'true');
  }
  function tryClose() {
    attempts += 1;
    try {
      window.open('', '_self');
      window.close();
    } catch (_) {}
    if (!document.hidden && attempts < 6) {
      window.setTimeout(tryClose, 350);
      return;
    }
    if (!document.hidden) showManualFallback();
  }
  window.setTimeout(tryClose, 160);
  window.setTimeout(showManualFallback, 2400);
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') tryClose();
  });
}());
</script>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 50% 42%, rgba(255,255,255,0.045), transparent 34%),
        #090b0b;
      color: #f4f1ea;
    }
    main {
      width: min(520px, calc(100vw - 40px));
      display: grid;
      justify-items: center;
      text-align: center;
    }
    .brand-logo {
      display: block;
      width: min(360px, 74vw);
      margin-bottom: 28px;
      filter: drop-shadow(0 16px 30px rgba(0, 0, 0, 0.28));
    }
    .brand-fallback {
      margin-bottom: 28px;
      color: #f4f1ea;
      font-size: clamp(34px, 7vw, 56px);
      font-weight: 760;
      letter-spacing: -0.03em;
    }
    h1 { margin: 0 0 12px; font-size: clamp(30px, 5vw, 44px); line-height: 1.05; }
    p { margin: 0; color: #b9c0bd; line-height: 1.6; font-size: 18px; }
  </style>
</head>
<body>
  <main>
    ${success ? brandHtml : ''}
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(text)}</p>
  </main>
  ${closeScript}
</body>
</html>`;
}

module.exports = {
  buildLoginResultHtml,
  escapeHtml,
  getFaberLogoDataUri,
};
