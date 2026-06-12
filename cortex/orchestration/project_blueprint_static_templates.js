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
const {
  buildTemporaryBlueprintCopy,
  isActiveTemporaryBlueprintContract,
} = require('./temporary_blueprint_contract_service');

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
  const fontHref = theme.typography.googleHref ||
    `https://fonts.googleapis.com/css2?family=${theme.typography.importName}:wght@400;600;700;800;900&display=swap`;
  return normalizeCssImportOrder(`@import url("${fontHref}");

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
h1, h2, h3 { font-family: ${theme.typography.headingCssStack || theme.typography.cssStack}; }
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

function routeToStaticFile(route = '') {
  const clean = String(route || '').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  return clean ? `${clean}.html` : 'index.html';
}

function buildStaticNavLinks(copy = {}) {
  return [
    { href: 'index.html', label: 'Início' },
    { href: 'a-escola.html', label: 'A Escola' },
    { href: 'premissas.html', label: 'Premissas' },
    { href: 'jornada.html', label: 'Jornada' },
    { href: 'conteudos.html', label: 'Conteúdos' },
    { href: 'contato.html', label: 'Contato' },
  ].filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);
}

function renderStaticHeader({ brand = '', copy = {}, active = '' } = {}) {
  const title = escapeHtml(brand || 'Faber Projeto');
  const links = buildStaticNavLinks(copy)
    .map((link) => `<a class="${active === link.href ? 'is-active' : ''}" href="${link.href}">${escapeHtml(link.label)}</a>`)
    .join('');
  return `<header class="site-header" data-site-header>
    <a class="brand" href="index.html">${title}</a>
    <button class="menu-toggle" type="button" aria-label="Abrir menu" aria-expanded="false" data-menu-toggle><span></span><span></span></button>
    <nav class="site-nav" aria-label="Navegação principal" data-site-nav>${links}<a class="nav-cta" href="contato.html">${escapeHtml(copy.headerCta || 'Quero conhecer')}</a></nav>
  </header>`;
}

function renderStaticFooter({ brand = '', copy = {} } = {}) {
  const links = buildStaticNavLinks(copy)
    .map((link) => `<a href="${link.href}">${escapeHtml(link.label)}</a>`)
    .join('');
  return `<footer class="site-footer">
    <div>
      <h2>${escapeHtml(brand || 'Tremn')}</h2>
      <p>Uma escola para líderes e organizações que desejam florescer novos níveis de consciência.</p>
    </div>
    <div><h3>Mapa</h3>${links}</div>
    <div><h3>Contato</h3><p>contato@tremn.com.br</p><p>WhatsApp: (00) 00000-0000</p><p>Instagram · LinkedIn</p></div>
    <form class="newsletter"><h3>Newsletter</h3><label>Receba reflexões sobre gestão consciente.<input type="email" placeholder="seu@email.com"></label><button type="submit">Inscrever-se</button></form>
    <p class="footer-bottom">© Tremn — Escola de Gestão Consciente. Todos os direitos reservados.</p>
  </footer>`;
}

const TEMPORARY_CARD_ICONS = ['leaf', 'chartBar', 'users', 'scale', 'sparkles', 'documentText', 'shieldCheck'];

function renderCards(items = [], className = 'card-grid') {
  return `<div class="${className}">${(Array.isArray(items) ? items : []).map((item, index) => `<article class="info-card">
    ${renderInlineSvgIcon(item.icon || TEMPORARY_CARD_ICONS[index % TEMPORARY_CARD_ICONS.length], 'card-icon')}
    <h3>${escapeHtml(item.title || '')}</h3>
    <p>${escapeHtml(item.description || item.excerpt || '')}</p>
  </article>`).join('')}</div>`;
}

function renderStaticForm(copy = {}) {
  const interestOptions = [
    'Quero conhecer a Escola',
    'Tenho interesse em uma turma',
    'Quero levar para minha empresa',
    'Quero propor uma parceria',
    'Outro',
  ];
  const fields = Array.isArray(copy.formFields) && copy.formFields.length ? copy.formFields : [
    { label: 'Nome', name: 'nome', type: 'text', placeholder: 'Seu nome' },
    { label: 'E-mail', name: 'email', type: 'email', placeholder: 'voce@email.com' },
    { label: 'Mensagem', name: 'mensagem', type: 'textarea', rows: 4, placeholder: 'Conte como podemos conversar' },
  ];
  return `<form class="contact-form">
    ${fields.map((field) => {
      const label = escapeHtml(field.label || field.name || '');
      const name = escapeHtml(field.name || '');
      const placeholder = escapeHtml(field.placeholder || '');
      if (field.type === 'textarea') {
        return `<label>${label}<textarea name="${name}" rows="${Number(field.rows || 4)}" placeholder="${placeholder}" required></textarea></label>`;
      }
      if (field.type === 'select' || field.name === 'interesse') {
        return `<label>${label}<select name="${name}" required>${interestOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`;
      }
      return `<label>${label}<input name="${name}" type="${escapeHtml(field.type || 'text')}" placeholder="${placeholder}" required></label>`;
    }).join('')}
    <button type="submit">${escapeHtml(copy.formButtonLabel || 'Enviar mensagem')}</button>
    <p class="form-status" data-form-status></p>
  </form>`;
}

function renderStaticPageShell({ brand = '', copy = {}, active = 'index.html', main = '' } = {}) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(brand || 'Tremn — Escola de Gestão Consciente')}</title>
  <meta name="description" content="${escapeHtml(copy.metaDescription || '')}">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  ${renderStaticHeader({ brand, copy, active })}
  <main>${main}</main>
  ${renderStaticFooter({ brand, copy })}
  <script src="./script.js"></script>
</body>
</html>
`;
}

function buildStaticTemporaryHome({ brand = '', copy = {} } = {}) {
  const main = `<section class="hero">
    <div class="hero-text">
      <p class="eyebrow">${escapeHtml(copy.heroEyebrow || '')}</p>
      <h1>${escapeHtml(copy.heroTitle || '')}</h1>
      <p>${escapeHtml(copy.heroText || '')}</p>
      <div class="hero-actions"><a class="button" href="a-escola.html">${escapeHtml(copy.cta || 'Conheça a Escola')}</a><a class="button button-secondary" href="premissas.html">${escapeHtml(copy.secondaryCta || 'Ver premissas')}</a></div>
    </div>
    <div class="texture-panel" aria-hidden="true"><span></span><span></span><span></span></div>
  </section>
  <section class="section intro-band">
    <p class="eyebrow">Por que a Escola existe</p>
    <h2>${escapeHtml(copy.servicesHeading || '')}</h2>
    <p>Vivemos um tempo de profundas mudanças ecológicas, sociais, econômicas e tecnológicas. As empresas fazem parte desses desafios, mas também podem ser parte essencial das soluções.</p>
    ${renderCards(copy.services)}
  </section>
  <section class="section split">
    <div><p class="eyebrow">O que é a Escola</p><h2>${escapeHtml(copy.differentialsHeading || '')}</h2><p>${escapeHtml(copy.about || '')}</p></div>
    ${renderCards(copy.differentials, 'stacked-cards')}
  </section>
  <section class="section">
    <p class="eyebrow">Premissas</p>
    <h2>${escapeHtml(copy.productsHeading || '')}</h2>
    ${renderCards(copy.products)}
    <a class="text-link" href="premissas.html">Explorar premissas</a>
  </section>
  <section class="section closing-cta"><h2>Comece uma nova forma de liderar.</h2><p>Conheça a Escola de Gestão Consciente e descubra como desenvolver uma gestão mais humana, responsável e preparada para o futuro.</p><a class="button" href="contato.html">Entrar em contato</a></section>`;
  return renderStaticPageShell({ brand, copy, active: 'index.html', main });
}

function buildStaticTemporaryAbout({ brand = '', copy = {} } = {}) {
  const main = `<section class="inner-hero"><p class="eyebrow">A Escola</p><h1>Uma escola para o florescimento de novos níveis de consciência.</h1><p>A Escola de Gestão Consciente surge para apoiar líderes e organizações na construção de novas formas de pensar, sentir e agir.</p></section>
  <section class="section split"><div><h2>${escapeHtml(copy.bodyMediaTitle || '')}</h2><p>${escapeHtml(copy.bodyMediaText || '')}</p></div><div class="quote-panel"><h3>Nosso propósito</h3><p>Apoiar o estudo, a divulgação e o treinamento de metodologias e formas de pensamento que contribuam para o desenvolvimento de gestores mais conscientes.</p></div></section>
  <section class="section"><h2>O que a Escola desenvolve</h2>${renderCards(copy.differentials)}</section>
  <section class="manifesto"><p>${escapeHtml(copy.manifestoTitle || '')}</p></section>`;
  return renderStaticPageShell({ brand, copy, active: 'a-escola.html', main });
}

function buildStaticTemporaryPremises({ brand = '', copy = {} } = {}) {
  const main = `<section class="inner-hero"><p class="eyebrow">Premissas</p><h1>Premissas para uma Gestão Consciente</h1><p>Cinco ideias fundamentais orientam a jornada da Escola e convidam líderes a ampliarem sua forma de perceber, decidir e agir.</p></section>
  <section class="section premise-list">${(copy.products || []).map((item, index) => `<article class="premise-card"><span>0${index + 1}</span><h2>${escapeHtml(item.title || '')}</h2><p class="impact">${escapeHtml(item.description || '')}</p><p>${escapeHtml(index === 0 ? 'A gestão consciente começa quando deixamos de operar apenas pela sobrevivência, escassez e acumulação.' : index === 1 ? 'A evolução começa quando reconhecemos nossas próprias cascas e abrimos espaço para novos níveis de consciência.' : index === 2 ? 'Autoconhecimento, escolha e autorresponsabilidade sustentam uma transformação real.' : index === 3 ? 'Nossas decisões impactam pessoas, organizações, comunidades e ambiente.' : 'Ampliar a percepção abre caminho a soluções mais maduras, sustentáveis e efetivas.')}</p><button type="button">Ler mais</button></article>`).join('')}</section>`;
  return renderStaticPageShell({ brand, copy, active: 'premissas.html', main });
}

function buildStaticTemporaryJourney({ brand = '', copy = {} } = {}) {
  const main = `<section class="inner-hero"><p class="eyebrow">Jornada</p><h1>Uma jornada de dentro para fora</h1><p>A transformação da gestão começa pela ampliação da consciência individual e se expressa nas relações, decisões e práticas organizacionais.</p></section>
  <section class="section timeline">${(copy.methodSteps || []).map((step, index) => `<article><span>Etapa ${index + 1}</span><h2>${escapeHtml(step.title || '')}</h2><p>${escapeHtml(step.description || '')}</p></article>`).join('')}</section>
  <section class="section"><h2>Pilares metodológicos</h2>${renderCards(copy.galleryItems)}</section>`;
  return renderStaticPageShell({ brand, copy, active: 'jornada.html', main });
}

function buildStaticTemporaryContent({ brand = '', copy = {} } = {}) {
  const categories = ['Liderança consciente', 'Autoconhecimento', 'Sustentabilidade', 'Cultura organizacional', 'Futuro do trabalho', 'Tecnologia e humanidade'];
  const main = `<section class="inner-hero"><p class="eyebrow">Conteúdos</p><h1>${escapeHtml(copy.blogHeading || 'Reflexões para uma nova gestão')}</h1><p>Conteúdos sobre consciência, liderança, responsabilidade, transformação organizacional e futuro.</p></section>
  <section class="section categories">${categories.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</section>
  <section class="section content-grid">${(copy.blogPosts || []).map((post) => `<article class="content-card"><div class="content-texture"></div><p>${escapeHtml(post.category || '')}</p><h2>${escapeHtml(post.title || '')}</h2><span>${escapeHtml(post.excerpt || '')}</span><a href="#">Ler mais</a></article>`).join('')}</section>`;
  return renderStaticPageShell({ brand, copy, active: 'conteudos.html', main });
}

function buildStaticTemporaryContact({ brand = '', copy = {} } = {}) {
  const main = `<section class="inner-hero"><p class="eyebrow">Contato</p><h1>${escapeHtml(copy.contactHeading || 'Vamos conversar?')}</h1><p>${escapeHtml(copy.contactText || '')}</p></section>
  <section class="section contact-layout"><div><h2>Manifestar interesse</h2><p>Use o formulário para falar sobre próximas turmas, encontros, programas e possibilidades de parceria.</p><div class="contact-info"><p>contato@tremn.com.br</p><p>WhatsApp: (00) 00000-0000</p><p>Instagram · LinkedIn</p><p>Brasil</p></div></div>${renderStaticForm(copy)}</section>`;
  return renderStaticPageShell({ brand, copy, active: 'contato.html', main });
}

function buildTemporaryStaticCss({ theme = resolveBlueprintTheme() } = {}) {
  const fontHref = theme.typography.googleHref ||
    `https://fonts.googleapis.com/css2?family=${theme.typography.importName}:wght@300;400;500;600;700;800;900&display=swap`;
  return normalizeCssImportOrder(`@import url("${fontHref}");

:root {
  --bg: ${theme.bg};
  --surface: ${theme.surface};
  --ink: ${theme.ink};
  --muted: ${theme.muted};
  --accent: ${theme.accent};
  --accent-dark: ${theme.accentDark};
  --sand: #f1cc98;
  --line: ${theme.line};
}

* { box-sizing: border-box; min-width: 0; }
html { scroll-behavior: smooth; overflow-x: hidden; }
body { width: 100%; max-width: 100%; margin: 0; background: var(--bg); color: var(--ink); font-family: ${theme.typography.cssStack}; line-height: 1.55; overflow-x: hidden; }
h1, h2, h3, p { margin-top: 0; }
h1, h2, h3 { font-family: ${theme.typography.headingCssStack || theme.typography.cssStack}; font-weight: 300; letter-spacing: 0; overflow-wrap: anywhere; }
a { color: inherit; }
img, svg, video, canvas { max-width: 100%; }
.site-header { position: sticky; top: 0; z-index: 20; width: 100%; max-width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 18px clamp(20px, 5vw, 72px); background: rgba(248, 247, 242, 0.92); border-bottom: 1px solid var(--line); backdrop-filter: blur(18px); }
.brand { flex: 1 1 auto; max-width: min(52vw, 420px); font-weight: 700; line-height: 1.2; text-decoration: none; overflow-wrap: anywhere; }
.site-nav { display: flex; align-items: center; gap: 22px; color: var(--muted); }
.site-nav a { text-decoration: none; font-weight: 600; }
.site-nav a.is-active { color: var(--ink); }
.nav-cta, .button, button { border: 0; border-radius: 8px; background: var(--accent); color: var(--ink); padding: 12px 18px; font-weight: 800; text-decoration: none; cursor: pointer; box-shadow: 0 12px 30px rgba(45, 42, 41, 0.08); }
.button-secondary { background: transparent; border: 1px solid rgba(45,42,41,.28); color: var(--ink); box-shadow: none; }
.menu-toggle { display: none; flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 1px solid var(--line); background: rgba(248,247,242,.58); }
.menu-toggle span { display: block; width: 18px; height: 2px; margin: 4px auto; background: var(--ink); }
.hero { position: relative; min-height: calc(100vh - 74px); display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, .78fr); align-items: center; gap: clamp(28px, 6vw, 84px); padding: clamp(44px, 6vw, 84px) clamp(20px, 7vw, 112px); overflow: hidden; background: var(--bg); color: var(--ink); }
.hero::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 16% 18%, rgba(240,190,67,.18), transparent 0 22%, transparent 38%), radial-gradient(circle at 84% 20%, rgba(241,204,152,.32), transparent 0 20%, transparent 42%), repeating-linear-gradient(112deg, rgba(45,42,41,.035) 0 1px, transparent 1px 22px); }
.hero > * { position: relative; z-index: 1; }
.hero-text { min-width: 0; max-width: 100%; }
.hero h1 { max-width: 760px; font-size: clamp(46px, 5.2vw, 78px); line-height: 1.02; overflow-wrap: anywhere; }
.hero p:not(.eyebrow) { max-width: 620px; color: var(--muted); font-size: clamp(17px, 1.6vw, 20px); }
.hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.eyebrow { color: var(--accent); font: 800 13px/1 ${theme.typography.cssStack}; text-transform: uppercase; letter-spacing: 0; }
.texture-panel { position: relative; min-height: clamp(260px, 34vw, 360px); overflow: hidden; border-radius: 8px; background: radial-gradient(circle at 78% 18%, rgba(248,247,242,.74), transparent 0 18%, transparent 32%), linear-gradient(145deg, rgba(241,204,152,.55), rgba(248,247,242,.94)), repeating-radial-gradient(circle at 24px 24px, rgba(45,42,41,.055) 0 1px, transparent 1px 22px); box-shadow: inset 0 0 0 1px rgba(45,42,41,.08), 0 30px 80px rgba(45,42,41,.08); }
.texture-panel::before { content: ''; position: absolute; inset: 0; background: repeating-linear-gradient(125deg, rgba(45,42,41,.055) 0 1px, transparent 1px 18px), radial-gradient(circle at 20% 78%, rgba(214,154,10,.12), transparent 0 22%, transparent 36%); mix-blend-mode: multiply; opacity: .58; }
.texture-panel span { position: absolute; display: block; border: 1px solid rgba(45,42,41,.22); border-radius: 999px; }
.texture-panel span:nth-child(1) { width: 64%; aspect-ratio: 1; right: -18%; top: -22%; }
.texture-panel span:nth-child(2) { width: 52%; aspect-ratio: 1; left: -14%; bottom: -28%; border-color: rgba(187,148,52,.24); }
.texture-panel span:nth-child(3) { width: 42%; height: 1px; left: 28%; top: 54%; background: rgba(45,42,41,.22); border: 0; transform: rotate(-12deg); }
.section, .inner-hero { width: 100%; max-width: 1180px; margin: 0 auto; padding: clamp(64px, 8vw, 112px) clamp(20px, 5vw, 72px); }
.inner-hero { padding-top: clamp(96px, 12vw, 156px); }
.inner-hero h1, .section h2 { max-width: 100%; font-size: clamp(38px, 5vw, 72px); line-height: 1; overflow-wrap: anywhere; }
.inner-hero p, .section > p, .split p { max-width: 760px; color: var(--muted); font-size: 18px; overflow-wrap: anywhere; }
.card-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-top: 34px; }
.info-card, .premise-card, .content-card, .quote-panel, .contact-form { border: 1px solid var(--line); border-radius: 8px; background: rgba(248,247,242,.68); padding: 26px; box-shadow: 0 18px 45px rgba(45,42,41,.06); }
.card-icon { display: block; width: 34px; height: 34px; margin-bottom: 22px; color: var(--accent-dark); }
.info-card h3, .premise-card h2, .content-card h2 { font-weight: 600; }
.info-card p, .premise-card p, .content-card span { color: var(--muted); }
.split { display: grid; grid-template-columns: .92fr 1.08fr; gap: 34px; align-items: start; }
.stacked-cards { display: grid; gap: 14px; }
.intro-band { background: linear-gradient(180deg, transparent, rgba(241,204,152,.2)); }
.text-link { display: inline-flex; margin-top: 22px; color: var(--accent-dark); font-weight: 800; }
.closing-cta { max-width: none; background: linear-gradient(180deg, rgba(248,247,242,.96), rgba(241,204,152,.26)); color: var(--ink); text-align: center; }
.closing-cta p { margin-left: auto; margin-right: auto; color: var(--muted); }
.manifesto { max-width: none; background: var(--ink); color: var(--bg); text-align: center; }
.manifesto p { max-width: 920px; margin: 0 auto; font: 300 clamp(34px, 5vw, 68px)/1.05 ${theme.typography.headingCssStack || theme.typography.cssStack}; }
.premise-list { display: grid; gap: 18px; }
.premise-card span, .timeline span, .content-card p { color: var(--accent-dark); font-weight: 900; text-transform: uppercase; }
.impact { color: var(--ink) !important; font-size: 22px; }
.timeline { display: grid; gap: 1px; }
.timeline article { display: grid; grid-template-columns: 160px 1fr 1.1fr; gap: 22px; padding: 26px 0; border-bottom: 1px solid var(--line); }
.categories { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 20px; padding-bottom: 20px; }
.categories span { max-width: 100%; border: 1px solid var(--line); border-radius: 999px; padding: 9px 13px; background: rgba(248,247,242,.52); white-space: normal; overflow-wrap: anywhere; }
.content-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.content-texture { height: 120px; margin: -26px -26px 24px; border-radius: 8px 8px 0 0; background: linear-gradient(135deg, rgba(241,204,152,.8), rgba(240,190,67,.44)), repeating-linear-gradient(90deg, rgba(45,42,41,.09) 0 1px, transparent 1px 18px); }
.contact-layout { display: grid; grid-template-columns: .8fr 1.2fr; gap: 32px; align-items: start; }
.contact-info { margin-top: 26px; color: var(--muted); }
.contact-form { display: grid; gap: 14px; }
label { display: grid; gap: 8px; color: var(--muted); font-weight: 700; }
input, textarea, select { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: rgba(248,247,242,.76); color: var(--ink); padding: 13px 14px; font: inherit; }
.form-status { min-height: 1.5em; color: var(--accent-dark); font-weight: 700; }
.site-footer { display: grid; grid-template-columns: 1.2fr .7fr .9fr 1fr; gap: 28px; padding: 56px clamp(20px, 5vw, 72px) 28px; background: var(--ink); color: var(--bg); }
.site-footer a, .site-footer p, .site-footer label { display: block; color: rgba(248,247,242,.72); text-decoration: none; }
.site-footer h2, .site-footer h3 { font-weight: 500; }
.newsletter { display: grid; gap: 10px; }
.footer-bottom { grid-column: 1 / -1; border-top: 1px solid rgba(248,247,242,.16); padding-top: 22px; }
@media (max-width: 860px) {
  .site-header { align-items: center; }
  .menu-toggle { display: block; position: relative; z-index: 1001; }
  .site-nav { position: fixed; inset: 0; width: 100vw; min-height: 100vh; z-index: 1000; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 86px 24px 34px; background: #2d2a29; color: var(--bg); text-align: center; overflow-y: auto; }
  .site-nav.is-open { display: flex; }
  .site-nav a { color: var(--bg); font-size: clamp(24px, 7vw, 34px); line-height: 1.05; }
  .site-nav a.is-active { color: var(--accent); }
  .site-nav .nav-cta { color: var(--ink); font-size: 18px; }
  .hero, .split, .timeline article, .contact-layout, .site-footer { grid-template-columns: 1fr; }
  .hero { min-height: auto; padding: 72px 20px 56px; }
  .hero h1 { font-size: clamp(38px, 11vw, 56px); line-height: 1.06; }
  .hero p:not(.eyebrow) { font-size: 17px; }
  .hero-actions .button { flex: 1 1 150px; justify-content: center; text-align: center; }
  .texture-panel { min-height: 260px; }
  .card-grid, .content-grid { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .site-header { gap: 12px; padding: 16px 20px; }
  .brand { max-width: calc(100vw - 104px); font-size: 16px; }
  .hero { padding: 62px 20px 48px; }
  .hero-text { width: min(100%, 330px); }
  .hero h1 { font-size: clamp(30px, 8.4vw, 34px); max-width: 100%; }
  .hero p:not(.eyebrow) { max-width: 100%; font-size: 16px; overflow-wrap: break-word; }
  .hero-actions { flex-direction: column; width: min(100%, 330px); }
  .hero-actions .button { width: 100%; flex: 0 0 auto; }
  .texture-panel { width: min(100%, 330px); }
  .section, .inner-hero { max-width: 100%; padding-left: 24px; padding-right: 24px; }
  .inner-hero { padding-top: 76px; }
  .inner-hero h1, .section h2 { font-size: clamp(30px, 8.4vw, 34px); line-height: 1.12; overflow-wrap: anywhere; }
  .inner-hero p, .section > p, .split p { max-width: 100%; font-size: 16px; }
  .info-card, .premise-card, .content-card, .quote-panel, .contact-form { padding: 22px; }
  .categories span { flex: 1 1 100%; text-align: center; }
}
`);
}

function buildTemporaryStaticJs({ copy = {} } = {}) {
  return `const toggle = document.querySelector('[data-menu-toggle]');
const nav = document.querySelector('[data-site-nav]');
if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('is-open');
    document.body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
  }));
}

document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = form.querySelector('[data-form-status]');
    if (status) status.textContent = ${JSON.stringify(copy.formStatus || 'Mensagem enviada.')};
    form.reset();
  });
});
`;
}

function buildTemporaryStaticWebBlueprint({ brand, contract = {}, theme = resolveBlueprintTheme() } = {}) {
  const copy = buildTemporaryBlueprintCopy({ ...contract, brandFallback: brand || contract.brandFallback });
  return [
    { op: 'write_file', path: 'index.html', content: buildStaticTemporaryHome({ brand, copy }) },
    { op: 'write_file', path: 'a-escola.html', content: buildStaticTemporaryAbout({ brand, copy }) },
    { op: 'write_file', path: 'premissas.html', content: buildStaticTemporaryPremises({ brand, copy }) },
    { op: 'write_file', path: 'jornada.html', content: buildStaticTemporaryJourney({ brand, copy }) },
    { op: 'write_file', path: 'conteudos.html', content: buildStaticTemporaryContent({ brand, copy }) },
    { op: 'write_file', path: 'contato.html', content: buildStaticTemporaryContact({ brand, copy }) },
    { op: 'write_file', path: 'style.css', content: buildTemporaryStaticCss({ theme }) },
    { op: 'write_file', path: 'script.js', content: buildTemporaryStaticJs({ copy }) },
  ];
}

function buildLampBlueprint({ brand, contract = {}, theme = resolveBlueprintTheme(), mediaAssets = {}, iconIntent = [] }) {
  return [
    { op: 'write_file', path: 'index.php', content: buildInstitutionalHtml({ brand, isLamp: true, contract, mediaAssets, iconIntent }) },
    { op: 'write_file', path: 'style.css', content: buildInstitutionalCss({ theme }) },
    { op: 'write_file', path: 'script.js', content: buildInstitutionalJs({ contract }) },
  ];
}

function buildStaticWebBlueprint({ brand, contract = {}, theme = resolveBlueprintTheme(), mediaAssets = {}, iconIntent = [] }) {
  if (isActiveTemporaryBlueprintContract(contract.temporaryBlueprintContract)) {
    return buildTemporaryStaticWebBlueprint({ brand, contract, theme });
  }
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
  buildTemporaryStaticWebBlueprint,
};
