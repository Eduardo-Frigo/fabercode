const {
  isActiveTemporaryBlueprintContract,
} = require('./temporary_blueprint_contract_service');

function escapeRouteText(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildRouteNavigationMarkup(navLinks = []) {
  const links = Array.isArray(navLinks) && navLinks.length
    ? navLinks
    : [
        { href: '/', label: 'Home' },
        { href: '/servicos', label: 'Serviços' },
        { href: '/loja', label: 'Loja' },
        { href: '/portfolio', label: 'Portfólio' },
        { href: '/blog', label: 'Blog' },
        { href: '/sobre', label: 'Sobre' },
        { href: '/contato', label: 'Contato' },
      ];
  return links.map((link) => `            <a href="${escapeRouteText(link.href)}">${escapeRouteText(link.label)}</a>`).join('\n');
}

function normalizeTemporaryRouteFilePath(route = '') {
  const clean = String(route || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
  if (!clean || clean === '.') return '';
  return `app/${clean}/page.tsx`;
}

function buildTemporaryRouteOperations({ brand, copy, contract = {} } = {}) {
  const temporary = contract.temporaryBlueprintContract || null;
  if (!isActiveTemporaryBlueprintContract(temporary)) return [];
  const routePages = Array.isArray(copy.routePages) ? copy.routePages : [];
  const requiredPages = Array.isArray(temporary.requiredPages) ? temporary.requiredPages : [];
  const navLinks = [
    { href: '/', label: 'Início' },
    ...requiredPages
      .filter((page) => page && page.id && page.id !== '/')
      .map((page) => ({ href: page.id, label: page.label || page.id.replace(/^\/+/, '') })),
  ];
  const routes = routePages.length
    ? routePages
    : requiredPages
        .filter((page) => page && page.id && page.id !== '/')
        .map((page) => ({
          href: page.id,
          label: page.label || page.id.replace(/^\/+/, ''),
          eyebrow: page.label || page.id.replace(/^\/+/, ''),
          title: `${page.label || page.id.replace(/^\/+/, '')} | ${brand}`,
          intro: copy.heroText || '',
          items: copy.services || [],
        }));

  return routes
    .map((route) => {
      const href = route.href || route.id || '';
      const path = normalizeTemporaryRouteFilePath(href);
      if (!path) return null;
      return {
        op: 'write_file',
        path,
        content: href === '/contato'
          ? buildContactRoutePage({ brand, copy, navLinks })
          : buildSimpleRoutePage({
              brand,
              eyebrow: route.eyebrow || route.label || '',
              title: route.title || route.label || brand,
              intro: route.intro || copy.heroText || '',
              items: Array.isArray(route.items) ? route.items : [],
              ctaLabel: copy.formButtonLabel || copy.cta || 'Entrar em contato',
              ctaHref: '/contato',
              navLinks,
            }),
      };
    })
    .filter(Boolean);
}

function buildResponsiveRouteHeaderMarkup({ brand = '', navMarkup = '', ariaLabel = 'Navegação da página' } = {}) {
  return `<header className="border-b border-[var(--color-line)] bg-[var(--color-bg)]/90">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
          <a className="min-w-0 max-w-[calc(100vw-7.5rem)] break-words pr-14 text-lg font-black lg:max-w-none lg:pr-0" href="/">${brand}</a>
          <details className="group absolute right-5 top-1/2 shrink-0 -translate-y-1/2 lg:hidden">
            <summary className="inline-flex h-11 w-11 shrink-0 cursor-pointer list-none items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] [&::-webkit-details-marker]:hidden" aria-label="Abrir menu de navegação">
              <span className="grid gap-1.5" aria-hidden="true">
                <span className="block h-0.5 w-5 rounded bg-current" />
                <span className="block h-0.5 w-5 rounded bg-current" />
                <span className="block h-0.5 w-5 rounded bg-current" />
              </span>
            </summary>
            <nav className="absolute right-0 top-12 z-30 grid w-64 max-w-[calc(100vw-2rem)] gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm font-bold text-[var(--color-ink)] shadow-2xl" aria-label="${ariaLabel} mobile">
${navMarkup}
            </nav>
          </details>
          <nav className="hidden flex-wrap gap-4 text-sm font-bold text-[var(--color-muted)] lg:flex" aria-label="${ariaLabel}">
${navMarkup}
          </nav>
        </div>
      </header>`;
}

function buildSimpleRoutePage({ brand, eyebrow = '', title = '', intro = '', items = [], ctaLabel = 'Voltar para home', ctaHref = '/', navLinks = [] } = {}) {
  const navMarkup = buildRouteNavigationMarkup(navLinks);
  const headerMarkup = buildResponsiveRouteHeaderMarkup({ brand, navMarkup });
  return `const items = ${JSON.stringify(items, null, 2)} as const;
type ContentItem = {
  title: string;
  description?: string;
  excerpt?: string;
  category?: string;
  price?: string;
  quote?: string;
  name?: string;
  role?: string;
};
const contentItems = items as readonly ContentItem[];

export default function RoutePage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      ${headerMarkup}
      <section className="mx-auto max-w-6xl px-5 py-20">
        ${eyebrow ? `<p className="text-sm font-black uppercase text-[var(--color-accent)]">${eyebrow}</p>` : ''}
        <h1 className="mt-3 max-w-4xl text-5xl font-black leading-none md:text-7xl">${title}</h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[var(--color-muted)]">${intro}</p>
        {contentItems.length ? (
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {contentItems.map((item) => (
              <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
                {'category' in item ? <p className="mb-3 text-xs font-black uppercase text-[var(--color-accent)]">{item.category}</p> : null}
                <h2 className="text-2xl font-black">{item.title}</h2>
                {'price' in item ? <p className="mt-3 font-black text-[var(--color-accent)]">{item.price}</p> : null}
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.excerpt || item.description}</p>
              </article>
            ))}
          </div>
        ) : null}
        <a className="mt-10 inline-flex rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" href="${ctaHref}">${ctaLabel}</a>
      </section>
    </main>
  );
}
`;
}

function buildContactRoutePage({ brand, copy, navLinks = [] } = {}) {
  const navMarkup = buildRouteNavigationMarkup(navLinks);
  const headerMarkup = buildResponsiveRouteHeaderMarkup({ brand, navMarkup });
  const formFields = Array.isArray(copy.formFields) ? copy.formFields : [
    { label: 'Nome', name: 'nome', type: 'text', placeholder: 'Seu nome' },
    { label: 'Email', name: 'email', type: 'email', placeholder: 'voce@email.com' },
    { label: 'Mensagem', name: 'mensagem', type: 'textarea', rows: 4, placeholder: 'Conte um pouco sobre o que precisa' },
  ];
  return `const formFields = ${JSON.stringify(formFields, null, 2)} as const;
type FormField = {
  label: string;
  name: string;
  type?: string;
  rows?: number;
  placeholder?: string;
};
const fields = formFields as readonly FormField[];

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      ${headerMarkup}
      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-20 md:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Contato</p>
          <h1 className="mt-3 text-5xl font-black leading-none">${copy.contactHeading || 'Contato'}</h1>
          <p className="mt-6 text-lg leading-8 text-[var(--color-muted)]">${copy.contactText || ''}</p>
        </div>
        <form className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
          {fields.map((field) => (
            <label key={field.name} className="grid gap-2 font-bold text-[var(--color-muted)]">
              {field.label}
              {field.type === 'textarea' ? (
                <textarea className="rounded-lg border border-[var(--color-line)] px-3 py-3" name={field.name} rows={field.rows || 4} placeholder={field.placeholder} />
              ) : (
                <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name={field.name} type={field.type || 'text'} placeholder={field.placeholder} />
              )}
            </label>
          ))}
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">${copy.formButtonLabel || 'Enviar mensagem'}</button>
        </form>
      </section>
    </main>
  );
}
`;
}

function buildAluminumCalculatorRoutePage({ brand, navLinks = [] } = {}) {
  const navMarkup = buildRouteNavigationMarkup(navLinks);
  const headerMarkup = buildResponsiveRouteHeaderMarkup({ brand, navMarkup });
  return `"use client";

import { useMemo, useState } from 'react';

const baseValues = [
  { label: 'Janela de alumínio', value: 850 },
  { label: 'Porta de correr', value: 1100 },
  { label: 'Fachada em ACM', value: 650 },
  { label: 'Pele de vidro', value: 1450 },
  { label: 'Guarda-corpo', value: 980 },
  { label: 'Brise metálico', value: 720 },
  { label: 'Portão de alumínio', value: 900 },
  { label: 'Projeto personalizado', value: 1300 },
] as const;

const finishMultipliers = [
  { label: 'Econômica', value: 1 },
  { label: 'Standard', value: 1.2 },
  { label: 'Premium', value: 1.45 },
  { label: 'Alto padrão arquitetônico', value: 1.75 },
] as const;

const glassMultipliers = [
  { label: 'Sem vidro', value: 1 },
  { label: 'Vidro comum', value: 1.1 },
  { label: 'Vidro temperado', value: 1.25 },
  { label: 'Vidro laminado', value: 1.35 },
  { label: 'Vidro refletivo', value: 1.5 },
  { label: 'Vidro insulado', value: 1.8 },
] as const;

const cities = ['Sorocaba/SP', 'Campinas/SP', 'Itu/SP', 'Indaiatuba/SP', 'Jundiaí/SP', 'São Paulo/SP', 'Outra cidade'] as const;
const deadlines = ['Ainda estou pesquisando', 'Quero iniciar em até 30 dias', 'Quero iniciar em até 60 dias', 'Tenho urgência'] as const;
const colors = ['Branco', 'Preto fosco', 'Cinza', 'Bronze', 'Amadeirado', 'Grafite', 'Personalizado'] as const;

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export default function CalculatorPage() {
  const [solution, setSolution] = useState(baseValues[0].label);
  const [area, setArea] = useState('12');
  const [finish, setFinish] = useState(finishMultipliers[1].label);
  const [glass, setGlass] = useState(glassMultipliers[2].label);
  const areaValue = Math.max(0, Number.parseFloat(area.replace(',', '.')) || 0);
  const estimatedValue = useMemo(() => {
    const base = baseValues.find((item) => item.label === solution)?.value || 0;
    const finishMultiplier = finishMultipliers.find((item) => item.label === finish)?.value || 1;
    const glassMultiplier = glassMultipliers.find((item) => item.label === glass)?.value || 1;
    return areaValue * base * finishMultiplier * glassMultiplier;
  }, [areaValue, finish, glass, solution]);

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      ${headerMarkup}
      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-20 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Calculadora de Orçamento</p>
          <h1 className="mt-3 text-5xl font-black leading-none md:text-6xl">Calcule uma estimativa para seu projeto</h1>
          <p className="mt-6 text-lg leading-8 text-[var(--color-muted)]">
            Informe o tipo de solução, medidas aproximadas e acabamento desejado para receber uma estimativa inicial de orçamento.
          </p>
          <p className="mt-5 rounded-lg border border-[var(--color-line)] bg-white p-4 text-sm leading-6 text-[var(--color-muted)]">
            Esta calculadora gera apenas uma estimativa. O valor final depende de visita técnica, medidas reais, tipo de vidro, linha de alumínio, acabamento, local da obra e condições de instalação.
          </p>
        </div>
        <div className="grid gap-5 rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Tipo de solução
              <select className="rounded-lg border border-[var(--color-line)] px-3 py-3" value={solution} onChange={(event) => setSolution(event.target.value)}>
                {baseValues.map((item) => <option key={item.label}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Área aproximada em m²
              <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" value={area} onChange={(event) => setArea(event.target.value)} inputMode="decimal" placeholder="Exemplo: 12" />
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Linha de acabamento
              <select className="rounded-lg border border-[var(--color-line)] px-3 py-3" value={finish} onChange={(event) => setFinish(event.target.value)}>
                {finishMultipliers.map((item) => <option key={item.label}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Tipo de vidro
              <select className="rounded-lg border border-[var(--color-line)] px-3 py-3" value={glass} onChange={(event) => setGlass(event.target.value)}>
                {glassMultipliers.map((item) => <option key={item.label}>{item.label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Cor do alumínio ou ACM
              <select className="rounded-lg border border-[var(--color-line)] px-3 py-3">{colors.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Cidade da obra
              <select className="rounded-lg border border-[var(--color-line)] px-3 py-3">{cities.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Prazo desejado
              <select className="rounded-lg border border-[var(--color-line)] px-3 py-3">{deadlines.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Nome
              <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" placeholder="Digite seu nome" />
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">Telefone/WhatsApp
              <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" placeholder="Digite seu WhatsApp" />
            </label>
            <label className="grid gap-2 font-bold text-[var(--color-muted)]">E-mail
              <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" type="email" placeholder="Digite seu e-mail" />
            </label>
          </div>
          <aside className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-5">
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Sua estimativa inicial está pronta</p>
            <strong className="mt-3 block text-4xl font-black">{formatCurrency(estimatedValue)}</strong>
            <p className="mt-3 leading-7 text-[var(--color-muted)]">
              Um consultor da equipe pode revisar os dados, tirar dúvidas e preparar uma proposta mais precisa para sua obra.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" href="/contato">Enviar para análise técnica</a>
              <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)]" href="/contato">Falar pelo WhatsApp</a>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
`;
}

function buildAluminumContactRoutePage({ brand, copy, navLinks = [] } = {}) {
  const navMarkup = buildRouteNavigationMarkup(navLinks);
  const headerMarkup = buildResponsiveRouteHeaderMarkup({ brand, navMarkup });
  const formFields = Array.isArray(copy.formFields) ? copy.formFields : [];
  return `const formFields = ${JSON.stringify(formFields, null, 2)} as const;
type FormField = {
  label: string;
  name: string;
  type?: string;
  rows?: number;
  placeholder?: string;
};
const fields = formFields as readonly FormField[];

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      ${headerMarkup}
      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-20 lg:grid-cols-[0.82fr_1.18fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Contato</p>
          <h1 className="mt-3 text-5xl font-black leading-none">Fale com a equipe</h1>
          <p className="mt-6 text-lg leading-8 text-[var(--color-muted)]">${copy.contactText || ''}</p>
          <div className="mt-6 grid gap-3 text-sm leading-6 text-[var(--color-muted)]">
            <p><strong className="text-[var(--color-ink)]">Sede administrativa:</strong><br />Rua Engenheiro Afonso Martins, 428, Distrito Industrial, Sorocaba/SP, CEP 18087-240</p>
            <p><strong className="text-[var(--color-ink)]">Showroom Campinas:</strong><br />Avenida Norte-Sul, 1560, Cambuí, Campinas/SP, CEP 13025-085</p>
            <p><strong className="text-[var(--color-ink)]">Telefone:</strong> (15) 3342-9080<br /><strong className="text-[var(--color-ink)]">WhatsApp:</strong> (15) 99728-4410<br /><strong className="text-[var(--color-ink)]">E-mail:</strong> contato@empresa.com.br</p>
          </div>
        </div>
        <form className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
          {fields.map((field) => (
            <label key={field.name} className="grid gap-2 font-bold text-[var(--color-muted)]">
              {field.label}
              {field.type === 'textarea' ? (
                <textarea className="rounded-lg border border-[var(--color-line)] px-3 py-3" name={field.name} rows={field.rows || 4} placeholder={field.placeholder} />
              ) : (
                <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name={field.name} type={field.type || 'text'} placeholder={field.placeholder} />
              )}
            </label>
          ))}
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">Enviar solicitação</button>
        </form>
      </section>
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <h2 className="text-4xl font-black">Encontre a unidade mais próxima de você</h2>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <iframe className="h-80 w-full rounded-lg border border-[var(--color-line)] bg-white" title="Mapa da sede administrativa" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=Rua%20Engenheiro%20Afonso%20Martins%20428%20Sorocaba%20SP&output=embed" />
          <iframe className="h-80 w-full rounded-lg border border-[var(--color-line)] bg-white" title="Mapa do showroom" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=Avenida%20Norte-Sul%201560%20Cambui%20Campinas%20SP&output=embed" />
        </div>
        <p className="mt-4 leading-7 text-[var(--color-muted)]">Atendemos Sorocaba, Campinas, Itu, Indaiatuba, Jundiaí, São Paulo e outras cidades mediante consulta.</p>
      </section>
    </main>
  );
}
`;
}

function buildDomainRouteOperations({ brand, copy, layoutRecipe = null, contract = {} } = {}) {
  const recipeId = layoutRecipe && layoutRecipe.id ? String(layoutRecipe.id) : '';
  const domain = contract && contract.domain ? String(contract.domain) : '';
  const temporaryRouteOperations = buildTemporaryRouteOperations({ brand, copy, contract });
  if (temporaryRouteOperations.length) return temporaryRouteOperations;
  const supportedRecipeRoutes = ['garden-service-commerce', 'wood-sculpture-atelier', 'architecture-studio-site', 'technical-b2b-lead-site', 'construction-materials-store-site'].includes(recipeId);
  if (!supportedRecipeRoutes && domain !== 'wood-finishes' && domain !== 'editorial-content') return [];
  const services = Array.isArray(copy.services) ? copy.services : [];
  const galleryItems = Array.isArray(copy.galleryItems) ? copy.galleryItems : services;
  const blogPosts = Array.isArray(copy.blogPosts) ? copy.blogPosts : [];
  const products = Array.isArray(copy.products) ? copy.products : [];
  if (domain === 'editorial-content') {
    const editorialNavLinks = [
      { href: '/', label: 'Início' },
      { href: '/editorias', label: 'Editorias' },
      { href: '/artigos', label: 'Artigos' },
      { href: '/newsletter', label: 'Newsletter' },
      { href: '/sobre', label: 'Sobre' },
      { href: '/contato', label: 'Contato' },
    ];
    return [
      {
        op: 'write_file',
        path: 'app/editorias/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Editorias',
          title: copy.servicesHeading || 'Editorias',
          intro: copy.about || '',
          items: services,
          ctaLabel: copy.cta || 'Assinar newsletter',
          ctaHref: '/newsletter',
          navLinks: editorialNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/artigos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Artigos',
          title: copy.blogHeading || 'Artigos recentes',
          intro: copy.heroText || '',
          items: blogPosts,
          ctaLabel: copy.cta || 'Assinar newsletter',
          ctaHref: '/newsletter',
          navLinks: editorialNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/newsletter/page.tsx',
        content: buildContactRoutePage({ brand, copy, navLinks: editorialNavLinks }),
      },
      {
        op: 'write_file',
        path: 'app/sobre/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Sobre',
          title: 'Sobre a publicação',
          intro: copy.about || '',
          items: Array.isArray(copy.methodSteps) ? copy.methodSteps : [],
          ctaLabel: copy.secondaryCta || 'Ler artigos',
          ctaHref: '/artigos',
          navLinks: editorialNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/contato/page.tsx',
        content: buildContactRoutePage({ brand, copy, navLinks: editorialNavLinks }),
      },
    ];
  }
  if (domain === 'technical-b2b-services-site') {
    const aluminumNavLinks = [
      { href: '/', label: 'Início' },
      { href: '/sobre', label: 'Sobre' },
      { href: '/solucoes', label: 'Soluções' },
      { href: '/projetos', label: 'Projetos' },
      { href: '/calculadora', label: 'Calculadora de Orçamento' },
      { href: '/blog', label: 'Blog' },
      { href: '/contato', label: 'Contato' },
      { href: '/trabalhe-conosco', label: 'Trabalhe Conosco' },
    ];
    return [
      {
        op: 'write_file',
        path: 'app/sobre/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Sobre',
          title: 'A história de uma empresa construída com precisão, confiança e visão de futuro',
          intro: copy.about || '',
          items: [...(Array.isArray(copy.timeline) ? copy.timeline : []), ...(Array.isArray(copy.team) ? copy.team : [])],
          ctaLabel: 'Conhecer soluções',
          ctaHref: '/solucoes',
          navLinks: aluminumNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/solucoes/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Soluções',
          title: 'Soluções completas em alumínio, vidro e ACM',
          intro: 'Do projeto residencial à fachada corporativa, desenvolvemos soluções sob medida com alto padrão de acabamento.',
          items: services,
          ctaLabel: 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: aluminumNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/projetos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Projetos',
          title: 'Obras executadas com precisão e acabamento de alto padrão',
          intro: 'Conheça alguns projetos fictícios que representam a qualidade e versatilidade da operação.',
          items: galleryItems,
          ctaLabel: 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: aluminumNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/calculadora/page.tsx',
        content: buildAluminumCalculatorRoutePage({ brand, navLinks: aluminumNavLinks }),
      },
      {
        op: 'write_file',
        path: 'app/blog/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Blog',
          title: copy.blogHeading || 'Conteúdos sobre esquadrias, fachadas e arquitetura',
          intro: 'Dicas, tendências e orientações para quem está construindo, reformando ou planejando um projeto arquitetônico.',
          items: blogPosts,
          ctaLabel: 'Calcular meu projeto',
          ctaHref: '/calculadora',
          navLinks: aluminumNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/contato/page.tsx',
        content: buildAluminumContactRoutePage({ brand, copy, navLinks: aluminumNavLinks }),
      },
      {
        op: 'write_file',
        path: 'app/trabalhe-conosco/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Trabalhe Conosco',
          title: 'Faça parte da equipe',
          intro: 'Buscamos profissionais comprometidos com qualidade, segurança e excelência em cada detalhe.',
          items: Array.isArray(copy.careerAreas) ? copy.careerAreas : [],
          ctaLabel: 'Enviar currículo',
          ctaHref: '/contato',
          navLinks: aluminumNavLinks,
        }),
      },
    ];
  }
  if (domain === 'construction-materials-site') {
    const constructionNavLinks = [
      { href: '/', label: 'Início' },
      { href: '/sobre', label: 'Sobre' },
      { href: '/produtos', label: 'Produtos' },
      { href: '/servicos', label: 'Serviços' },
      { href: '/orcamento', label: 'Orçamento' },
      { href: '/blog', label: 'Blog' },
      { href: '/contato', label: 'Contato' },
    ];
    return [
      {
        op: 'write_file',
        path: 'app/sobre/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Sobre',
          title: 'Sobre a loja',
          intro: copy.about || '',
          items: Array.isArray(copy.differentials) ? copy.differentials : [],
          ctaLabel: copy.cta || 'Enviar lista',
          ctaHref: '/orcamento',
          navLinks: constructionNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/produtos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Produtos',
          title: copy.productsHeading || 'Categorias de materiais',
          intro: 'Catálogo organizado para materiais básicos, alvenaria, hidráulica, elétrica, tintas, acabamentos, ferramentas e manutenção.',
          items: products,
          ctaLabel: 'Enviar lista de materiais',
          ctaHref: '/orcamento',
          navLinks: constructionNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/servicos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Serviços',
          title: copy.servicesHeading || 'Serviços para sua obra',
          intro: copy.heroText || '',
          items: services,
          ctaLabel: 'Pedir orçamento',
          ctaHref: '/orcamento',
          navLinks: constructionNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/orcamento/page.tsx',
        content: buildContactRoutePage({ brand, copy, navLinks: constructionNavLinks }),
      },
      {
        op: 'write_file',
        path: 'app/blog/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Blog',
          title: copy.blogHeading || 'Conteúdos para comprar melhor',
          intro: 'Dicas para planejar compras de obra, evitar atrasos, escolher materiais e organizar reformas.',
          items: blogPosts,
          ctaLabel: 'Enviar lista',
          ctaHref: '/orcamento',
          navLinks: constructionNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/contato/page.tsx',
        content: buildContactRoutePage({ brand, copy, navLinks: constructionNavLinks }),
      },
    ];
  }
  const architectureNavLinks = [
    { href: '/', label: 'Início' },
    { href: '/sobre', label: 'Sobre' },
    { href: '/servicos', label: 'Serviços' },
    { href: '/projetos', label: 'Projetos' },
    { href: '/processo', label: 'Processo' },
    { href: '/insights', label: 'Insights' },
    { href: '/contato', label: 'Contato' },
  ];
  if (recipeId === 'architecture-studio-site') {
    return [
      {
        op: 'write_file',
        path: 'app/sobre/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Sobre',
          title: 'Sobre o escritório',
          intro: copy.about || '',
          items: [
            { title: 'Nossa forma de pensar arquitetura', description: copy.manifestoText || '' },
            { title: copy.statOneValue || 'Projetos', description: copy.statOneLabel || '' },
            { title: copy.statTwoValue || 'Experiência', description: copy.statTwoLabel || '' },
          ],
          ctaLabel: copy.secondaryCta || 'Conheça os projetos',
          ctaHref: '/projetos',
          navLinks: architectureNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/servicos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Serviços',
          title: copy.servicesHeading || 'Serviços de arquitetura',
          intro: copy.heroText || '',
          items: services,
          ctaLabel: copy.formButtonLabel || 'Solicitar proposta',
          ctaHref: '/contato',
          navLinks: architectureNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/projetos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Projetos',
          title: copy.galleryHeading || 'Cases e projetos',
          intro: 'Uma seleção de espaços projetados para traduzir histórias, rotinas e identidades.',
          items: galleryItems,
          ctaLabel: copy.formButtonLabel || 'Solicitar proposta',
          ctaHref: '/contato',
          navLinks: architectureNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/processo/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Processo',
          title: 'Um processo claro do primeiro encontro à entrega do projeto',
          intro: 'Organizamos cada etapa para que o cliente tenha segurança, previsibilidade e participação nas decisões importantes.',
          items: Array.isArray(copy.methodSteps) ? copy.methodSteps : [],
          ctaLabel: copy.formButtonLabel || 'Solicitar proposta',
          ctaHref: '/contato',
          navLinks: architectureNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/insights/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Insights',
          title: copy.blogHeading || 'Insights de Arquitetura',
          intro: 'Conteúdos sobre arquitetura, interiores, reformas, materiais e planejamento de obra.',
          items: blogPosts,
          ctaLabel: 'Conversar sobre meu projeto',
          ctaHref: '/contato',
          navLinks: architectureNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/contato/page.tsx',
        content: buildContactRoutePage({ brand, copy, navLinks: architectureNavLinks }),
      },
    ];
  }
  if (domain === 'wood-finishes') {
    const woodNavLinks = [
      { href: '/', label: 'Início' },
      { href: '/sobre', label: 'Sobre' },
      { href: '/servicos', label: 'Serviços' },
      { href: '/produtos', label: 'Produtos' },
      { href: '/pisos', label: 'Pisos' },
      { href: '/paineis', label: 'Painéis' },
      { href: '/decks', label: 'Decks' },
      { href: '/projetos', label: 'Projetos' },
      { href: '/inspiracoes', label: 'Inspirações' },
      { href: '/contato', label: 'Contato' },
    ];
    return [
      {
        op: 'write_file',
        path: 'app/sobre/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Sobre',
          title: `Sobre ${brand}`,
          intro: copy.about || '',
          items: [
            { title: 'Design, técnica e matéria natural', description: copy.manifestoText || '' },
            { title: copy.statOneValue || 'Soluções em madeira', description: copy.statOneLabel || '' },
            { title: copy.statTwoValue || 'Atendimento consultivo', description: copy.statTwoLabel || '' },
          ],
          ctaLabel: copy.formButtonLabel || 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: woodNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/servicos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Serviços',
          title: 'Soluções completas em madeira',
          intro: 'Atendimento técnico para especificação, curadoria, paginação, instalação e acabamento em madeira natural.',
          items: services,
          ctaLabel: copy.secondaryCta || copy.formButtonLabel || 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: woodNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/produtos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Produtos',
          title: 'Soluções em madeira para cada detalhe do projeto',
          intro: 'Conheça pisos de madeira, painéis ripados, decks, revestimentos naturais e acabamentos sob medida.',
          items: [...services, ...products],
          ctaLabel: copy.secondaryCta || 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: woodNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/pisos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Pisos de Madeira',
          title: 'Pisos de madeira para ambientes elegantes, naturais e duradouros',
          intro: 'Pisos naturais, engenheirados, maciços e multiestruturados para conforto térmico, estética atemporal e valorização do imóvel.',
          items: [
            { title: 'Piso de Madeira Natural', description: 'Autenticidade, nobreza e veios únicos para projetos de alto padrão.' },
            { title: 'Piso Engenheirado', description: 'Estabilidade, beleza natural e desempenho para diferentes ambientes internos.' },
            { title: 'Piso Maciço', description: 'Opção robusta, tradicional e restaurável ao longo dos anos.' },
            { title: 'Paginações', description: 'Régua linear, espinha de peixe, chevron, escama de peixe e composições personalizadas.' },
          ],
          ctaLabel: copy.formButtonLabel || 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: woodNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/paineis/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Painéis Ripados',
          title: 'Painéis ripados que criam ritmo, textura e sofisticação',
          intro: 'Soluções para paredes, divisórias, halls, recepções, quartos e ambientes corporativos com profundidade visual e acabamento refinado.',
          items: [
            { title: 'Design sob medida', description: 'Medidas, espaçamentos, tons e acabamentos adaptados ao projeto.' },
            { title: 'Textura arquitetônica', description: 'Ritmo das ripas cria sombra, profundidade e movimento visual.' },
            { title: 'Acabamento refinado', description: 'Alinhamento, proporção e elegância em cada composição.' },
            { title: 'Integração com iluminação', description: 'Painéis dialogam com luz indireta, perfis de LED e marcenaria.' },
          ],
          ctaLabel: copy.formButtonLabel || 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: woodNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/decks/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Decks e Áreas Externas',
          title: 'Decks de madeira para viver melhor os espaços externos',
          intro: 'Soluções para piscinas, varandas, áreas gourmet, jardins, fachadas, pérgolas e espaços de convivência.',
          items: [
            { title: 'Material adequado', description: 'Escolha considerando sol, umidade, tráfego, ventilação e estilo arquitetônico.' },
            { title: 'Instalação técnica', description: 'Planejamento de estrutura, drenagem, acabamento e segurança de uso.' },
            { title: 'Beleza natural', description: 'Textura, conforto e integração entre arquitetura, paisagem e bem-estar.' },
          ],
          ctaLabel: copy.formButtonLabel || 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: woodNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/projetos/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Projetos',
          title: copy.galleryHeading || 'Ambientes assinados pela madeira',
          intro: 'Galeria de ambientes finalizados com pisos, painéis, decks e acabamentos em madeira natural.',
          items: galleryItems,
          ctaLabel: copy.formButtonLabel || 'Solicitar orçamento',
          ctaHref: '/contato',
          navLinks: woodNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/inspiracoes/page.tsx',
        content: buildSimpleRoutePage({
          brand,
          eyebrow: 'Inspirações',
          title: copy.blogHeading || 'Inspirações para projetos com madeira natural',
          intro: 'Ideias, tendências e orientações para transformar ambientes com pisos, painéis e acabamentos em madeira.',
          items: blogPosts,
          ctaLabel: 'Solicitar atendimento técnico',
          ctaHref: '/contato',
          navLinks: woodNavLinks,
        }),
      },
      {
        op: 'write_file',
        path: 'app/contato/page.tsx',
        content: buildContactRoutePage({ brand, copy, navLinks: woodNavLinks }),
      },
    ];
  }
  const defaultNavLinks = [
    { href: '/', label: 'Home' },
    { href: '/servicos', label: 'Serviços' },
    { href: '/loja', label: 'Loja' },
    { href: '/portfolio', label: 'Portfólio' },
    { href: '/blog', label: 'Blog' },
    { href: '/sobre', label: 'Sobre' },
    { href: '/contato', label: 'Contato' },
  ];
  return [
    {
      op: 'write_file',
      path: 'app/sobre/page.tsx',
      content: buildSimpleRoutePage({
        brand,
        eyebrow: 'Sobre',
        title: 'Sobre o projeto',
        intro: copy.about || '',
        items: [
          { title: copy.statOneValue || 'Diferencial', description: copy.statOneLabel || '' },
          { title: copy.statTwoValue || 'Experiência', description: copy.statTwoLabel || '' },
        ],
        navLinks: defaultNavLinks,
      }),
    },
    {
      op: 'write_file',
      path: 'app/servicos/page.tsx',
      content: buildSimpleRoutePage({
        brand,
        eyebrow: 'Serviços',
        title: copy.servicesHeading || 'Serviços',
        intro: copy.heroText || '',
        items: services,
        ctaLabel: copy.formButtonLabel || 'Solicitar orçamento',
        ctaHref: '/contato',
        navLinks: defaultNavLinks,
      }),
    },
    {
      op: 'write_file',
      path: 'app/portfolio/page.tsx',
      content: buildSimpleRoutePage({
        brand,
        eyebrow: 'Portfólio',
        title: copy.galleryHeading || 'Portfólio',
        intro: 'Seleção de referências para apresentar projetos, obras, ambientes e possibilidades de aplicação.',
        items: galleryItems,
        ctaLabel: copy.secondaryCta || copy.cta || 'Solicitar conversa',
        ctaHref: '/contato',
        navLinks: defaultNavLinks,
      }),
    },
    {
      op: 'write_file',
      path: 'app/blog/page.tsx',
      content: buildSimpleRoutePage({
        brand,
        eyebrow: 'Blog',
        title: copy.blogHeading || 'Blog',
        intro: 'Conteúdos educativos para fortalecer autoridade, SEO e relacionamento com visitantes.',
        items: blogPosts,
        navLinks: defaultNavLinks,
      }),
    },
    {
      op: 'write_file',
      path: 'app/loja/page.tsx',
      content: buildSimpleRoutePage({
        brand,
        eyebrow: 'Catálogo',
        title: copy.productsHeading || 'Produtos e catálogo',
        intro: 'Itens, peças ou soluções disponíveis para consulta, compra ou encomenda personalizada.',
        items: products,
        ctaLabel: copy.formButtonLabel || 'Consultar disponibilidade',
        ctaHref: '/contato',
        navLinks: defaultNavLinks,
      }),
    },
    {
      op: 'write_file',
      path: 'app/contato/page.tsx',
      content: buildContactRoutePage({ brand, copy, navLinks: defaultNavLinks }),
    },
  ];
}

module.exports = {
  buildDomainRouteOperations,
};
