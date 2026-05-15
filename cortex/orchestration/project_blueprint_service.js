const {
  formatBriefingContractForPrompt,
  inferBriefingContract,
} = require('./briefing_contract_service');

function normalizeBlueprintText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildBlueprintContextText({
  userMessage = '',
  contextText = '',
  workGraph = null,
} = {}) {
  const parts = [userMessage, contextText];
  if (workGraph && typeof workGraph === 'object') {
    parts.push(workGraph.brief || '');
    if (workGraph.briefSpec) {
      try {
        parts.push(JSON.stringify(workGraph.briefSpec));
      } catch {
        parts.push(String(workGraph.briefSpec || ''));
      }
    }
    if (Array.isArray(workGraph.acceptanceCriteria)) {
      parts.push(workGraph.acceptanceCriteria.join(' '));
    }
  }
  return parts.filter(Boolean).join('\n');
}

function inferBlueprintBrand(source = '', contract = null) {
  if (contract && contract.brandFallback) return contract.brandFallback;
  const normalized = normalizeBlueprintText(source);
  if (/\badvocacia\b|\badvogad[oa]s?\b|\bjuridic[oa]\b|\bdireito\b/.test(normalized)) return 'Escritório Faber Advocacia';
  if (/\bveterin/.test(normalized)) return 'Clínica Faber Vet';
  if (/\bfotograf/.test(normalized)) return 'Estúdio Aurora';
  if (/\bodonto|dent/.test(normalized)) return 'Clínica Sorriso';
  if (/\barquit/.test(normalized)) return 'Studio Habitat';
  return 'Faber Projeto';
}

function hasProfileBlueprintOperations(profile) {
  return Boolean(
    profile &&
    profile.blueprint &&
    Array.isArray(profile.blueprint.operations) &&
    profile.blueprint.operations.length > 0
  );
}

function resolveRegistryBlueprintStack({ stackRegistry = null, source = '', projectInfo = null } = {}) {
  if (!stackRegistry || typeof stackRegistry.resolveStackProfilesFromText !== 'function') return null;

  const rootPath = projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '';
  const profiles = stackRegistry.resolveStackProfilesFromText(source, rootPath);
  if (!Array.isArray(profiles) || !profiles.length) return null;

  const ids = new Set(profiles.map((profile) => String(profile.id || '').toLowerCase()));
  const customBlueprintProfile = profiles.find((profile) => profile.source !== 'builtin' && hasProfileBlueprintOperations(profile));
  if (customBlueprintProfile) {
    return {
      stack: `profile:${customBlueprintProfile.id}`,
      profile: customBlueprintProfile,
    };
  }

  if (ids.has('lamp')) return { stack: 'lamp', profile: profiles.find((profile) => profile.id === 'lamp') || null };
  if (ids.has('next') || (ids.has('react') && ids.has('tailwind'))) {
    return { stack: 'next-tailwind', profile: profiles.find((profile) => profile.id === 'next') || null };
  }

  return null;
}

function inferProjectBlueprintRequest({
  userMessage = '',
  contextText = '',
  workGraph = null,
  attachments = [],
  executionIntent = '',
  projectInfo = null,
  stackRegistry = null,
} = {}) {
  const rawSource = buildBlueprintContextText({ userMessage, contextText, workGraph });
  const source = normalizeBlueprintText(rawSource);
  const briefingContract = inferBriefingContract({ userMessage, contextText, workGraph });
  const initMode = String(executionIntent || '').toLowerCase() === 'init_project';
  const registryResolution = resolveRegistryBlueprintStack({ stackRegistry, source: rawSource, projectInfo });
  const siteLike = /\b(site|landing|one page|pagina|institucional|web|html|php|lamp|next|nextjs|react|tailwind|cta|desktop|electron|astro|vue)\b/.test(source) ||
    Boolean(registryResolution);
  const creationLike = /\b(criar|crie|gerar|gere|desenvolver|desenvolva|montar|monte|fazer|faca|novo|nova)\b/.test(source);
  const defaultLike = /\b(placeholder|placeholders|default|defaults|padrao|qualquer coisa|voce decide|pode fazer|pode seguir|generico|generica|informacoes genericas)\b/.test(source);
  const hasVisualReference =
    /\b(figma|figjam|design system|mockup|wireframe|layout especifico|layout específico|pixel perfect|referencia visual|referência visual|prototipo|protótipo)\b/.test(source) ||
    (Array.isArray(attachments) && attachments.length > 0);
  const lamp = briefingContract.stack === 'lamp' || /\b(lamp|php|mysql)\b/.test(source);
  const nextTailwind = briefingContract.stack === 'next-tailwind' || /\b(next|nextjs|next\.js|tailwind)\b/.test(source) || (/\breact\b/.test(source) && /\btailwind\b/.test(source));
  const stack = registryResolution
    ? registryResolution.stack
    : lamp ? 'lamp' : nextTailwind ? 'next-tailwind' : 'static-web';

  return {
    enabled: Boolean(initMode && siteLike && (creationLike || defaultLike)),
    canFallback: Boolean(initMode && siteLike && !hasVisualReference),
    forceBlueprint: Boolean(initMode && siteLike && defaultLike && !hasVisualReference),
    hasVisualReference,
    initMode,
    siteLike,
    stack,
    stackProfile: registryResolution ? registryResolution.profile : null,
    briefingContract,
    source,
    rawSource,
  };
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildInstitutionalCopy(contract = {}) {
  const domain = contract && contract.domain ? contract.domain : '';
  if (domain === 'legal') {
    return {
      heroEyebrow: 'Atendimento jurídico estratégico',
      heroTitle: 'Orientação jurídica clara para proteger decisões importantes.',
      heroText: 'Página institucional para escritório de advocacia com placeholders contextualizados, áreas de atuação e CTA para consulta jurídica.',
      cta: 'Agendar consulta jurídica',
      services: [
        { title: 'Consultoria jurídica', description: 'Análise inicial para entender riscos, prioridades e o melhor caminho jurídico.' },
        { title: 'Contratos e prevenção', description: 'Organização de documentos, acordos e orientações para reduzir conflitos futuros.' },
        { title: 'Atuação contenciosa', description: 'Acompanhamento em demandas cíveis, empresariais ou trabalhistas com comunicação objetiva.' },
      ],
      about: 'Este bloco apresenta a história do escritório, áreas de atuação, credenciais e diferenciais de atendimento jurídico.',
      statOneValue: '10+',
      statOneLabel: 'anos de experiência jurídica simulada',
      statTwoValue: '3',
      statTwoLabel: 'áreas de atuação placeholder',
      testimonial: 'O atendimento jurídico ficou fácil de entender e pronto para receber os casos reais do escritório.',
      contactText: 'Use este formulário como placeholder até conectar CRM, e-mail, Supabase ou outro backend.',
      formStatus: 'Solicitação jurídica placeholder registrada. Conecte este formulário ao backend real na próxima etapa.',
      metaDescription: 'Página institucional placeholder para escritório de advocacia.',
    };
  }
  if (domain === 'dental') {
    return {
      heroEyebrow: 'Atendimento odontológico premium',
      heroTitle: 'Uma experiência odontológica clara para transformar visitantes em consultas.',
      heroText: 'Página institucional para clínica odontológica com placeholders contextualizados, serviços e agendamento.',
      cta: 'Agendar avaliação',
      services: [
        { title: 'Consulta odontológica', description: 'Primeiro atendimento para entender necessidades e orientar o plano de cuidado.' },
        { title: 'Tratamentos personalizados', description: 'Organização de opções como prevenção, estética e reabilitação de forma simples.' },
        { title: 'Acompanhamento', description: 'Rotina de cuidado para manter saúde bucal e confiança no sorriso.' },
      ],
      about: 'Este bloco apresenta a clínica, equipe, estrutura e diferenciais do atendimento odontológico.',
      statOneValue: '10+',
      statOneLabel: 'anos de experiência odontológica simulada',
      statTwoValue: '98%',
      statTwoLabel: 'satisfação placeholder',
      testimonial: 'A estrutura deixou a clínica odontológica fácil de entender e pronta para conteúdo real.',
      contactText: 'Use este formulário como placeholder até conectar agenda, CRM ou backend.',
      formStatus: 'Agendamento odontológico placeholder registrado. Conecte este formulário ao backend real na próxima etapa.',
      metaDescription: 'Página institucional placeholder para clínica odontológica.',
    };
  }
  if (domain === 'veterinary') {
    return {
      heroEyebrow: 'Cuidado veterinário acolhedor',
      heroTitle: 'Uma presença digital clara para aproximar pets, tutores e atendimento.',
      heroText: 'Página institucional para clínica veterinária com placeholders contextualizados, serviços e CTA para consulta.',
      cta: 'Agendar consulta veterinária',
      services: [
        { title: 'Consulta veterinária', description: 'Atendimento inicial para avaliar saúde, rotina e necessidades do pet.' },
        { title: 'Vacinas e prevenção', description: 'Orientação para manter cuidado animal em dia com calendário simples.' },
        { title: 'Acompanhamento', description: 'Contato próximo para manter tutores informados depois da consulta.' },
      ],
      about: 'Este bloco apresenta a clínica, equipe veterinária, estrutura e diferenciais no cuidado animal.',
      statOneValue: '10+',
      statOneLabel: 'anos de cuidado animal simulado',
      statTwoValue: '98%',
      statTwoLabel: 'satisfação placeholder',
      testimonial: 'A página deixou a clínica veterinária clara e pronta para receber informações reais.',
      contactText: 'Use este formulário como placeholder até conectar agenda, WhatsApp ou backend.',
      formStatus: 'Consulta veterinária placeholder registrada. Conecte este formulário ao backend real na próxima etapa.',
      metaDescription: 'Página institucional placeholder para clínica veterinária.',
    };
  }

  return {
    heroEyebrow: 'Atendimento placeholder premium',
    heroTitle: 'Uma presença digital clara para transformar visitantes em contatos.',
    heroText: 'Primeira versão institucional com conteúdo provisório, estrutura responsiva e chamada para ação pronta para evoluir.',
    cta: 'Agendar conversa',
    services: [
      { title: 'Diagnóstico inicial', description: 'Entendimento rápido da necessidade e indicação do melhor caminho.' },
      { title: 'Plano personalizado', description: 'Organização da solução com etapas simples, visuais e mensuráveis.' },
      { title: 'Acompanhamento', description: 'Contato próximo para manter a experiência confiável depois do primeiro atendimento.' },
    ],
    about: 'Este bloco usa texto placeholder para validar hierarquia, leitura e ritmo visual antes da entrada do conteúdo final.',
    statOneValue: '10+',
    statOneLabel: 'anos de experiência simulada',
    statTwoValue: '98%',
    statTwoLabel: 'satisfação placeholder',
    testimonial: 'A estrutura ficou simples de entender e pronta para receber conteúdo real.',
    contactText: 'Use este formulário como placeholder até conectar backend, CRM ou Supabase.',
    formStatus: 'Mensagem placeholder registrada. Conecte este formulário ao backend real na próxima etapa.',
    metaDescription: 'Página institucional placeholder pronta para evoluir com conteúdo real.',
  };
}

function buildInstitutionalHtml({
  brand,
  isLamp = false,
  contract = {},
} = {}) {
  const title = escapeHtml(brand || 'Faber Projeto');
  const copy = buildInstitutionalCopy(contract);
  const servicesMarkup = copy.services.map((service) => {
    return `<article><h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.description)}</p></article>`;
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
    <section class="hero">
      <p class="eyebrow">${escapeHtml(copy.heroEyebrow)}</p>
      <h1>${escapeHtml(copy.heroTitle)}</h1>
      <p>${escapeHtml(copy.heroText)}</p>
      <a class="button" href="#contato">${escapeHtml(copy.cta)}</a>
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

function buildInstitutionalCss() {
  return `:root {
  --bg: #f7f6f1;
  --surface: #ffffff;
  --ink: #1f2424;
  --muted: #66706d;
  --accent: #2f8f83;
  --accent-dark: #18675f;
  --line: rgba(31, 36, 36, 0.14);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
  background: rgba(247, 246, 241, 0.92);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(16px);
}
.brand { font-weight: 800; text-decoration: none; }
nav { display: flex; gap: 18px; flex-wrap: wrap; }
nav a { color: var(--muted); text-decoration: none; font-size: 14px; }
.hero, .section { max-width: 1120px; margin: 0 auto; padding: clamp(56px, 8vw, 96px) clamp(20px, 5vw, 72px); }
.hero { min-height: 74vh; display: grid; align-content: center; }
.eyebrow { color: var(--accent-dark); font-weight: 800; text-transform: uppercase; letter-spacing: 0; font-size: 13px; }
h1, h2, h3, p { margin-top: 0; }
h1 { max-width: 780px; font-size: clamp(42px, 7vw, 82px); line-height: 0.96; letter-spacing: 0; }
h2 { font-size: clamp(28px, 4vw, 44px); letter-spacing: 0; }
.hero p { max-width: 640px; color: var(--muted); font-size: 19px; }
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
  nav { margin-top: 12px; }
  .grid { grid-template-columns: 1fr; }
  h1 { font-size: 44px; }
}
`;
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

function slugifyBlueprintValue(value = '') {
  return normalizeBlueprintText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'faber-projeto';
}

function renderBlueprintTemplate(value = '', { brand = 'Faber Projeto' } = {}) {
  const text = String(value || '');
  return text
    .replace(/\{\{brand\}\}/g, brand)
    .replace(/\{\{brandHtml\}\}/g, escapeHtml(brand))
    .replace(/\{\{brandJson\}\}/g, JSON.stringify(brand))
    .replace(/\{\{brandSlug\}\}/g, slugifyBlueprintValue(brand));
}

function isSafeBlueprintPath(value = '') {
  const normalized = String(value || '').replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return false;
  return !normalized.split('/').some((segment) => segment === '..');
}

function buildProfileBlueprintOperations({ profile, brand }) {
  const blueprint = profile && profile.blueprint ? profile.blueprint : {};
  const operations = Array.isArray(blueprint.operations) ? blueprint.operations : [];
  const allowedOps = new Set(['write_file', 'append_file', 'mkdir']);

  return operations
    .map((operation) => {
      if (!operation || typeof operation !== 'object') return null;
      const op = String(operation.op || '').trim();
      const targetPath = String(operation.path || '').replace(/\\/g, '/').trim();
      if (!allowedOps.has(op) || !isSafeBlueprintPath(targetPath)) return null;

      const normalized = {
        op,
        path: targetPath,
      };
      if (op !== 'mkdir') normalized.content = renderBlueprintTemplate(operation.content || '', { brand });
      return normalized;
    })
    .filter(Boolean);
}

function buildLampBlueprint({ brand, contract = {} }) {
  return [
    { op: 'write_file', path: 'index.php', content: buildInstitutionalHtml({ brand, isLamp: true, contract }) },
    { op: 'write_file', path: 'style.css', content: buildInstitutionalCss() },
    { op: 'write_file', path: 'script.js', content: buildInstitutionalJs({ contract }) },
  ];
}

function buildStaticWebBlueprint({ brand, contract = {} }) {
  return [
    { op: 'write_file', path: 'index.html', content: buildInstitutionalHtml({ brand, isLamp: false, contract }) },
    { op: 'write_file', path: 'style.css', content: buildInstitutionalCss() },
    { op: 'write_file', path: 'script.js', content: buildInstitutionalJs({ contract }) },
  ];
}

function buildNextTailwindBlueprint({ brand, contract = {} }) {
  const safeBrand = String(brand || 'Faber Projeto').replace(/`/g, "'");
  const copy = buildInstitutionalCopy(contract);
  const packageJson = JSON.stringify(
    {
      private: true,
      name: 'faber-next-institutional',
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
      },
      dependencies: {
        next: '^16.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        '@tailwindcss/postcss': '^4.0.0',
        tailwindcss: '^4.0.0',
        typescript: '^5.0.0',
        '@types/node': '^22.0.0',
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        eslint: '^9.0.0',
        'eslint-config-next': '^16.0.0',
      },
    },
    null,
    2
  );

  const page = `const copy = ${JSON.stringify(copy, null, 2)} as const;

const services = copy.services;

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-bg)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <a className="text-lg font-black" href="#inicio">${safeBrand}</a>
          <nav className="flex flex-wrap gap-4 text-sm font-semibold text-[var(--color-muted)]" aria-label="Navegação principal">
            <a href="#servicos">Serviços</a>
            <a href="#sobre">Sobre</a>
            <a href="#depoimentos">Depoimentos</a>
            <a href="#contato">Contato</a>
          </nav>
        </div>
      </header>

      <section id="inicio" className="mx-auto grid min-h-[72vh] max-w-6xl content-center gap-7 px-5 py-20 md:py-28">
        <p className="text-sm font-black uppercase text-[var(--color-accent-dark)]">{copy.heroEyebrow}</p>
        <h1 className="max-w-4xl text-5xl font-black leading-none md:text-7xl">
          {copy.heroTitle}
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-[var(--color-muted)]">
          {copy.heroText}
        </p>
        <a className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href="#contato">
          {copy.cta}
        </a>
      </section>

      <section id="servicos" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-4xl font-black">Serviços</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {services.map((service) => (
            <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <h3 className="text-xl font-black">{service.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="sobre" className="mx-auto grid max-w-6xl gap-6 px-5 py-16 md:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="text-4xl font-black">Sobre</h2>
          <p className="mt-4 max-w-2xl leading-8 text-[var(--color-muted)]">
            {copy.about}
          </p>
        </div>
        <ul className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
          <li><strong className="block text-4xl">{copy.statOneValue}</strong><span className="text-[var(--color-muted)]">{copy.statOneLabel}</span></li>
          <li><strong className="block text-4xl">{copy.statTwoValue}</strong><span className="text-[var(--color-muted)]">{copy.statTwoLabel}</span></li>
        </ul>
      </section>

      <section id="depoimentos" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-4xl font-black">Depoimentos</h2>
        <blockquote className="mt-8 rounded-lg border border-[var(--color-line)] bg-white p-6 text-lg leading-8 text-[var(--color-muted)] shadow-sm">
          "{copy.testimonial}"
        </blockquote>
      </section>

      <section id="contato" className="mx-auto grid max-w-6xl gap-6 px-5 py-16 md:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="text-4xl font-black">Contato</h2>
          <p className="mt-4 leading-7 text-[var(--color-muted)]">{copy.contactText}</p>
        </div>
        <form className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Nome <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="nome" placeholder="Seu nome" /></label>
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Email <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="email" type="email" placeholder="voce@email.com" /></label>
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Mensagem <textarea className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="mensagem" rows={4} placeholder="Conte um pouco sobre o que precisa" /></label>
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">Enviar mensagem</button>
        </form>
      </section>
    </main>
  );
}
`;

  const layout = `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '${safeBrand}',
  description: ${JSON.stringify(copy.metaDescription)},
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
`;

  const globals = `@import "tailwindcss";

:root {
  --color-bg: #f7f6f1;
  --color-surface: #ffffff;
  --color-ink: #1f2424;
  --color-muted: #66706d;
  --color-accent: #2f8f83;
  --color-accent-dark: #18675f;
  --color-line: rgba(31, 36, 36, 0.14);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

a {
  text-decoration: none;
}
`;

  return [
    { op: 'write_file', path: 'package.json', content: packageJson },
    { op: 'write_file', path: 'next.config.mjs', content: `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nexport default nextConfig;\n` },
    { op: 'write_file', path: 'postcss.config.mjs', content: `const config = {\n  plugins: {\n    '@tailwindcss/postcss': {},\n  },\n};\n\nexport default config;\n` },
    { op: 'write_file', path: 'tsconfig.json', content: JSON.stringify({
      compilerOptions: {
        target: 'ES2017',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: false,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2) },
    { op: 'write_file', path: 'next-env.d.ts', content: `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n\n// This file is generated by the Next.js blueprint baseline.\n` },
    { op: 'write_file', path: 'app/layout.tsx', content: layout },
    { op: 'write_file', path: 'app/page.tsx', content: page },
    { op: 'write_file', path: 'app/globals.css', content: globals },
    { op: 'write_file', path: 'README.md', content: `# ${safeBrand}\n\nBaseline institucional em Next.js App Router, React e Tailwind CSS.\n\n## Rodar localmente\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Próximas configurações\n\n- Trocar placeholders por conteúdo final.\n- Conectar formulário ao backend escolhido.\n- Configurar variáveis em \`.env.local\` antes de integrações externas.\n` },
  ];
}

function buildBlueprintOperations({ stack, brand, stackProfile = null, contract = {} }) {
  if (stackProfile && hasProfileBlueprintOperations(stackProfile)) {
    return buildProfileBlueprintOperations({ profile: stackProfile, brand });
  }
  if (stack === 'lamp') return buildLampBlueprint({ brand, contract });
  if (stack === 'next-tailwind') return buildNextTailwindBlueprint({ brand, contract });
  return buildStaticWebBlueprint({ brand, contract });
}

function createProjectBlueprintService(dependencies = {}) {
  const {
    stackRegistry = null,
  } = dependencies;

  function buildProjectBlueprintOperationBatch({
    projectInfo,
    userMessage = '',
    attachments = [],
    executionIntent = 'edit_project',
    buildOperationBatchDiffPreview = () => '',
    contextText = '',
    workGraph = null,
    force = false,
  } = {}) {
    const request = inferProjectBlueprintRequest({
      userMessage,
      contextText,
      workGraph,
      attachments,
      executionIntent,
      projectInfo,
      stackRegistry,
    });

    if (!request.enabled) return null;
    if (request.hasVisualReference && !force) return null;
    if (!force && !request.forceBlueprint) return null;

    const brand = inferBlueprintBrand(request.rawSource || userMessage, request.briefingContract);
    const operations = buildBlueprintOperations({
      stack: request.stack,
      brand,
      stackProfile: request.stackProfile,
      contract: request.briefingContract,
    });
    if (!operations.length) return null;

    const rawProfileTargetFile = request.stackProfile && request.stackProfile.blueprint
      ? request.stackProfile.blueprint.targetFile
      : '';
    const profileTargetFile = isSafeBlueprintPath(rawProfileTargetFile) ? rawProfileTargetFile : '';
    const targetFile = profileTargetFile || (request.stack === 'lamp'
      ? 'index.php'
      : request.stack === 'next-tailwind'
        ? 'app/page.tsx'
        : operations[0].path || 'index.html');
    const stackLabel = request.stackProfile && request.stackProfile.label
      ? request.stackProfile.label
      : request.stack === 'lamp'
      ? 'LAMP'
      : request.stack === 'next-tailwind'
        ? 'Next.js + Tailwind'
        : 'web';

    return {
      ok: true,
      action: {
        type: 'operation_batch',
        intent: 'init_project',
        rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : '',
        targetFile,
        operations,
        diffPreview: buildOperationBatchDiffPreview(operations),
        summary: `Criar blueprint inicial ${stackLabel} com estrutura institucional e placeholders editáveis.`,
        userMessage,
        attachments,
        generatedBy: 'project_blueprint_service',
        blueprint: {
          stack: request.stack,
          profileId: request.stackProfile ? request.stackProfile.id : '',
          profileSource: request.stackProfile ? request.stackProfile.source : '',
          briefingContract: {
            domain: request.briefingContract ? request.briefingContract.domain : '',
            stack: request.briefingContract ? request.briefingContract.stack : '',
          },
          reason: request.forceBlueprint ? 'default_authorized' : 'quality_fallback',
        },
      },
      raw: `project_blueprint:${request.stackProfile ? request.stackProfile.id : request.stack}`,
    };
  }

  function shouldPreferProjectBlueprint(options = {}) {
    const request = inferProjectBlueprintRequest({ ...options, stackRegistry });
    return Boolean(request.enabled && request.forceBlueprint);
  }

  function shouldUseProjectBlueprintFallback(options = {}) {
    const request = inferProjectBlueprintRequest({ ...options, stackRegistry });
    return Boolean(request.canFallback && !request.hasVisualReference);
  }

  function hasRequiredProjectBlueprintFiles({ operations = [], userMessage = '', contextText = '', workGraph = null } = {}) {
    const request = inferProjectBlueprintRequest({
      userMessage,
      contextText,
      workGraph,
      executionIntent: 'init_project',
      stackRegistry,
    });
    const writes = new Set(
      (Array.isArray(operations) ? operations : [])
        .filter((op) => op && (op.op === 'write_file' || op.op === 'append_file'))
        .map((op) => String(op.path || '').replace(/\\/g, '/').toLowerCase())
    );
    const profileRequired = request.stackProfile && request.stackProfile.blueprint && Array.isArray(request.stackProfile.blueprint.requiredFiles)
      ? request.stackProfile.blueprint.requiredFiles
        .map((file) => String(file || '').replace(/\\/g, '/').toLowerCase())
        .filter(isSafeBlueprintPath)
      : null;
    const required = profileRequired || (request.stack === 'lamp'
      ? ['index.php', 'style.css', 'script.js']
      : request.stack === 'next-tailwind'
        ? ['package.json', 'app/layout.tsx', 'app/page.tsx', 'app/globals.css']
        : ['index.html', 'style.css', 'script.js']);
    return required.every((file) => writes.has(file));
  }

  function buildProjectBlueprintPromptGuidance(options = {}) {
    const request = inferProjectBlueprintRequest({ ...options, stackRegistry });
    if (!request.enabled) return '';
    const lines = [
      'Diretrizes de blueprint inicial:',
      '- Use o blueprint apenas como base quando o pedido estiver genérico, com defaults/placeholders ou quando a geração vier tecnicamente fraca.',
      '- Se houver Figma, mockup, referência visual, anexo ou briefing criativo específico, preserve a direção criativa e adapte o projeto em vez de forçar template genérico.',
    ];
    if (request.stack === 'next-tailwind') {
      lines.push('- Para Next.js + Tailwind, prefira App Router com package.json, app/layout.tsx, app/page.tsx e app/globals.css.');
    }
    if (request.stack === 'lamp') {
      lines.push('- Para LAMP/PHP, use index.php, style.css e script.js conectados.');
    }
    const contractGuidance = formatBriefingContractForPrompt(request.briefingContract);
    if (contractGuidance) {
      for (const line of contractGuidance.split('\n').filter(Boolean)) lines.push(`- ${line}`);
    }
    if (request.stackProfile && request.stackProfile.blueprint) {
      const pluginGuidance = request.stackProfile.blueprint.promptGuidance;
      if (Array.isArray(pluginGuidance)) lines.push(...pluginGuidance.map((line) => `- ${line}`));
      else if (pluginGuidance) lines.push(`- ${pluginGuidance}`);
    }
    return lines.join('\n');
  }

  return {
    buildProjectBlueprintOperationBatch,
    buildProjectBlueprintPromptGuidance,
    hasRequiredProjectBlueprintFiles,
    inferProjectBlueprintRequest,
    shouldPreferProjectBlueprint,
    shouldUseProjectBlueprintFallback,
  };
}

module.exports = {
  createProjectBlueprintService,
  inferProjectBlueprintRequest,
  normalizeBlueprintText,
};
