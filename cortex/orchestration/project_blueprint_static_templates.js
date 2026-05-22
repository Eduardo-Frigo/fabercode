const {
  buildBlueprintIconSet,
  renderInlineSvgIcon,
} = require('./blueprint_icon_registry');
const { normalizeCssImportOrder } = require('./css_operation_safety');
const { buildInstitutionalCopy } = require('./project_blueprint_copy');
const { resolveBlueprintTheme } = require('./project_blueprint_layout');
const {
  escapeHtml,
  normalizeBlueprintMediaAssets,
  renderHeroMediaHtml,
} = require('./project_blueprint_template_utils');

function buildInstitutionalHtml({
  brand,
  isLamp = false,
  contract = {},
  mediaAssets = {},
  iconIntent = [],
} = {}) {
  const title = escapeHtml(brand || 'Faber Projeto');
  const copy = buildInstitutionalCopy(contract);
  const heroMedia = normalizeBlueprintMediaAssets(mediaAssets).hero;
  const iconSet = buildBlueprintIconSet({ contract, iconIntent });
  const heroClass = heroMedia ? 'hero hero--with-media' : 'hero';
  const heroMediaMarkup = renderHeroMediaHtml(heroMedia);
  const servicesMarkup = copy.services.map((service, index) => {
    const icon = iconSet[index] || iconSet[0];
    return `<article>${renderInlineSvgIcon(icon.name)}<h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.description)}</p></article>`;
  }).join('\n        ');
  const contactNotice = isLamp ? '<?php $sent = $_SERVER["REQUEST_METHOD"] === "POST"; ?>\n' : '';
  const formAction = isLamp ? ' method="post" action="#contato"' : '';
  const sentMessage = isLamp
    ? `<?php if ($sent): ?><p class="form-status">${escapeHtml(copy.formStatus)}</p><?php endif; ?>`
    : '<p class="form-status" data-form-status></p>';

  return `${contactNotice}<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="#inicio">${title}</a>
    <nav aria-label="Navegação principal">
      <a href="#servicos">Serviços</a>
      <a href="#sobre">Sobre</a>
      <a href="#depoimentos">Depoimentos</a>
      <a href="#contato">Contato</a>
    </nav>
  </header>

  <main id="inicio">
    <section class="${heroClass}">
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(copy.heroEyebrow)}</p>
        <h1>${escapeHtml(copy.heroTitle)}</h1>
        <p>${escapeHtml(copy.heroText)}</p>
        <a class="button" href="#contato">${escapeHtml(copy.cta)}</a>
      </div>
      ${heroMediaMarkup}
    </section>

    <section id="servicos" class="section">
      <h2>Serviços</h2>
      <div class="grid">
        ${servicesMarkup}
      </div>
    </section>

    <section id="sobre" class="section split">
      <div>
        <h2>Sobre</h2>
        <p>${escapeHtml(copy.about)}</p>
      </div>
      <ul class="stats">
        <li><strong>${escapeHtml(copy.statOneValue)}</strong><span>${escapeHtml(copy.statOneLabel)}</span></li>
        <li><strong>${escapeHtml(copy.statTwoValue)}</strong><span>${escapeHtml(copy.statTwoLabel)}</span></li>
      </ul>
    </section>

    <section id="depoimentos" class="section">
      <h2>Depoimentos</h2>
      <blockquote>"${escapeHtml(copy.testimonial)}"</blockquote>
    </section>

    <section id="contato" class="section contact">
      <div>
        <h2>Contato</h2>
        <p class="contact-copy">${escapeHtml(copy.contactText)}</p>
      </div>
      <form${formAction}>
        <label>Nome <input name="nome" required placeholder="Seu nome"></label>
        <label>Email <input name="email" type="email" required placeholder="voce@email.com"></label>
        <label>Mensagem <textarea name="mensagem" rows="4" required placeholder="Conte um pouco sobre o que precisa"></textarea></label>
        <button type="submit">Enviar mensagem</button>
      </form>
      ${sentMessage}
    </section>
  </main>

  <script src="./script.js"></script>
</body>
</html>
`;
}

function buildInstitutionalCss({ theme = resolveBlueprintTheme() } = {}) {
  return normalizeCssImportOrder(`@import url("https://fonts.googleapis.com/css2?family=${theme.typography.importName}:wght@400;600;700;800;900&display=swap");

:root {
  --bg: ${theme.bg};
  --surface: ${theme.surface};
  --ink: ${theme.ink};
  --muted: ${theme.muted};
  --accent: ${theme.accent};
  --accent-dark: ${theme.accentDark};
  --line: ${theme.line};
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: ${theme.typography.cssStack};
  line-height: 1.5;
}
a { color: inherit; }
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px clamp(20px, 5vw, 72px);
  background: ${theme.headerBg};
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(16px);
}
.brand { font-weight: 800; text-decoration: none; }
nav { display: flex; gap: 18px; flex-wrap: wrap; }
nav a { color: var(--muted); text-decoration: none; font-size: 14px; }
.hero, .section { max-width: 1120px; margin: 0 auto; padding: clamp(56px, 8vw, 96px) clamp(20px, 5vw, 72px); }
.hero { min-height: 74vh; display: grid; align-content: center; gap: 32px; }
.hero--with-media { grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.92fr); align-items: center; }
.eyebrow { color: var(--accent-dark); font-weight: 800; text-transform: uppercase; letter-spacing: 0; font-size: 13px; }
h1, h2, h3, p { margin-top: 0; }
h1 { max-width: 780px; font-size: clamp(42px, 7vw, 82px); line-height: 0.96; letter-spacing: 0; }
h2 { font-size: clamp(28px, 4vw, 44px); letter-spacing: 0; }
.hero-copy > p:not(.eyebrow) { max-width: 640px; color: var(--muted); font-size: 19px; }
.hero-media {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 24px 70px rgba(31, 36, 36, 0.12);
}
.hero-media img,
.hero-media video {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}
.media-credit {
  margin: 0;
  padding: 10px 12px;
  color: var(--muted);
  font-size: 12px;
}
.button, button {
  width: fit-content;
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  color: white;
  padding: 13px 18px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
article, blockquote, form, .stats {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  padding: 22px;
}
.service-icon {
  width: 32px;
  height: 32px;
  color: var(--accent);
  margin-bottom: 18px;
}
article p, .split p, blockquote, .stats span, .contact-copy { color: var(--muted); }
.split { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; align-items: start; }
.stats { list-style: none; margin: 0; display: grid; gap: 16px; }
.stats strong { display: block; font-size: 32px; }
.contact { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 24px; align-items: start; }
form { display: grid; gap: 14px; }
label { display: grid; gap: 7px; color: var(--muted); font-weight: 700; }
input, textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px 13px;
  font: inherit;
}
.form-status { color: var(--accent-dark); font-weight: 700; }
@media (max-width: 760px) {
  .site-header, .split, .contact { display: block; }
  .hero--with-media { grid-template-columns: 1fr; }
  nav { margin-top: 12px; }
  .grid { grid-template-columns: 1fr; }
  h1 { font-size: 44px; }
}
`);
}

function buildInstitutionalJs({ contract = {} } = {}) {
  const copy = buildInstitutionalCopy(contract);
  const statusText = JSON.stringify(copy.formStatus);
  return `const form = document.querySelector('form');
const statusEl = document.querySelector('[data-form-status]');

if (form && statusEl) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    statusEl.textContent = ${statusText};
    form.reset();
  });
}
`;
}

function buildLampBlueprint({ brand, contract = {}, theme = resolveBlueprintTheme(), mediaAssets = {}, iconIntent = [] }) {
  return [
    { op: 'write_file', path: 'index.php', content: buildInstitutionalHtml({ brand, isLamp: true, contract, mediaAssets, iconIntent }) },
    { op: 'write_file', path: 'style.css', content: buildInstitutionalCss({ theme }) },
    { op: 'write_file', path: 'script.js', content: buildInstitutionalJs({ contract }) },
  ];
}

function buildStaticWebBlueprint({ brand, contract = {}, theme = resolveBlueprintTheme(), mediaAssets = {}, iconIntent = [] }) {
  return [
    { op: 'write_file', path: 'index.html', content: buildInstitutionalHtml({ brand, isLamp: false, contract, mediaAssets, iconIntent }) },
    { op: 'write_file', path: 'style.css', content: buildInstitutionalCss({ theme }) },
    { op: 'write_file', path: 'script.js', content: buildInstitutionalJs({ contract }) },
  ];
}


module.exports = {
  buildInstitutionalCss,
  buildInstitutionalHtml,
  buildInstitutionalJs,
  buildLampBlueprint,
  buildStaticWebBlueprint,
};
