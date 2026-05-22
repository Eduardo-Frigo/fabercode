const { buildBlueprintIconSet } = require('./blueprint_icon_registry');
const { normalizeCssImportOrder } = require('./css_operation_safety');
const { buildInstitutionalCopy } = require('./project_blueprint_copy');
const {
  resolveBlueprintLayoutRecipe,
  resolveBlueprintTheme,
} = require('./project_blueprint_layout');
const { normalizeBlueprintMediaAssets } = require('./project_blueprint_template_utils');

function buildAtelierCatalogNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
const heroMedia = ${JSON.stringify(heroMedia, null, 2)} as const;
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;

const collections = copy.services;
const methodSteps = 'methodSteps' in copy ? copy.methodSteps : [];
const faqs = 'faq' in copy ? copy.faq : [];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-bg)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <a className="text-lg font-black" href="#inicio">{brandName}</a>
          <nav className="flex flex-wrap gap-5 text-sm font-bold text-[var(--color-muted)]" aria-label="Navegação principal">
            <a href="#colecoes">Coleções</a>
            <a href="#materiais">Materiais</a>
            <a href="#processo">Processo</a>
            <a href="#cuidados">Cuidados</a>
            <a href="#contato">Contato</a>
          </nav>
        </div>
      </header>

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:grid-cols-[0.88fr_1.12fr] md:items-end md:py-24">
        <div className="grid gap-7">
          <p className="text-sm font-black uppercase text-[var(--color-accent-dark)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-3xl text-5xl font-black leading-none md:text-7xl">
            {copy.heroTitle}
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-[var(--color-muted)]">
            {copy.heroText}
          </p>
          <div className="flex flex-wrap gap-3">
            <a className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href="#colecoes">
              {copy.cta}
            </a>
            <a className="w-fit rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href="#materiais">
              Ver materiais
            </a>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[0.72fr_1.28fr] md:items-end">
          <aside className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-sm">
            <p className="text-xs font-black uppercase text-[var(--color-accent)]">Atelier</p>
            <div>
              <strong className="block text-4xl">{copy.statOneValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statOneLabel}</span>
            </div>
            <div>
              <strong className="block text-2xl">{copy.statTwoValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statTwoLabel}</span>
            </div>
          </aside>

          {heroMedia ? (
            <figure className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_24px_70px_rgba(31,36,36,0.12)]">
              {heroMedia.kind === 'video' ? (
                <video className="aspect-[16/11] w-full object-cover" autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
                  <source src={heroMedia.src} type="video/mp4" />
                </video>
              ) : (
                <img className="aspect-[16/11] w-full object-cover" src={heroMedia.src} alt={heroMedia.alt} />
              )}
              {heroMedia.attribution ? (
                <figcaption className="px-3 py-2 text-xs text-[var(--color-muted)]">{heroMedia.attribution}</figcaption>
              ) : null}
            </figure>
          ) : (
            <div className="grid aspect-[16/11] content-end rounded-lg border border-[var(--color-line)] bg-[var(--color-accent-dark)] p-6 text-white shadow-[0_24px_70px_rgba(31,36,36,0.12)]">
              <p className="max-w-sm text-2xl font-black">Fotografia de atelier pronta para entrar aqui.</p>
            </div>
          )}
        </div>
      </section>

      <section id="colecoes" className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">{layoutRecipe.bodySections[0]}</p>
            <h2 className="text-4xl font-black">{copy.servicesHeading || 'Coleções'}</h2>
          </div>
          <p className="max-w-xl leading-7 text-[var(--color-muted)]">{copy.about}</p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {collections.map((item, index) => (
            <article key={item.title} className="grid min-h-64 content-between rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div>
                <svg className="mb-5 h-8 w-8 text-[var(--color-accent)]" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d={(serviceIcons[index] || serviceIcons[0]).path} />
                </svg>
                <h3 className="text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              </div>
              <span className="mt-8 text-sm font-black text-[var(--color-accent)]">{String(index + 1).padStart(2, '0')}</span>
            </article>
          ))}
        </div>
      </section>

      <section id="materiais" className="bg-[var(--color-accent-dark)] px-5 py-16 text-white md:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[0.9fr_1.1fr] md:items-start">
          <div>
            <p className="text-sm font-black uppercase text-white/70">Matéria-prima</p>
            <h2 className="mt-4 text-4xl font-black md:text-5xl">Couro, textura e tempo como parte do design.</h2>
          </div>
          <p className="text-lg leading-8 text-white/78">
            {copy.about}
          </p>
        </div>
      </section>

      <section id="processo" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Processo artesanal</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {methodSteps.map((step, index) => (
            <article key={step.title} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
              <span className="text-sm font-black text-[var(--color-accent)]">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="mt-4 text-xl font-black">{step.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="cuidados" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Uso e cuidado</p>
          <h2 className="mt-4 text-4xl font-black">Perguntas antes da primeira peça.</h2>
        </div>
        <div className="grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contato" className="mx-auto grid max-w-7xl gap-6 px-5 py-16 md:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="text-4xl font-black">Contato</h2>
          <p className="mt-4 leading-7 text-[var(--color-muted)]">{copy.contactText}</p>
        </div>
        <form className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Nome <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="nome" placeholder="Seu nome" /></label>
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Email <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="email" type="email" placeholder="voce@email.com" /></label>
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Mensagem <textarea className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="mensagem" rows={4} placeholder="Conte sobre a peça, uso ou prazo desejado" /></label>
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">Enviar pedido</button>
        </form>
      </section>

      <footer className="border-t border-[var(--color-line)] px-5 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 text-sm text-[var(--color-muted)] md:flex-row md:items-center md:justify-between">
          <strong className="text-[var(--color-ink)]">{brandName}</strong>
          <span>{copy.metaDescription}</span>
        </div>
      </footer>
    </main>
  );
}
`;
}

function buildNextTailwindBlueprint({ brand, contract = {}, theme = resolveBlueprintTheme(), mediaAssets = {}, iconIntent = [], layoutVariant = 'editorial_split', layoutRecipe = null }) {
  const safeBrand = String(brand || 'Faber Projeto').replace(/`/g, "'");
  const copy = buildInstitutionalCopy(contract);
  const heroMedia = normalizeBlueprintMediaAssets(mediaAssets).hero;
  const iconSet = buildBlueprintIconSet({ contract, iconIntent });
  const activeLayoutRecipe = layoutRecipe || resolveBlueprintLayoutRecipe({ contract, layoutVariant });
  const fontHref = `https://fonts.googleapis.com/css2?family=${theme.typography.importName}:wght@400;600;700;800;900&display=swap`;
  const packageJson = JSON.stringify(
    {
      private: true,
      name: 'faber-next-institutional',
      scripts: {
        dev: 'next dev --webpack',
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

  const page = activeLayoutRecipe.id === 'artisan-commerce'
    ? buildAtelierCatalogNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : `const copy = ${JSON.stringify(copy, null, 2)} as const;
const heroMedia = ${JSON.stringify(heroMedia, null, 2)} as const;
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;

const services = copy.services;
const servicesHeading = 'servicesHeading' in copy ? copy.servicesHeading : 'Serviços';
const contactHeading = 'contactHeading' in copy ? copy.contactHeading : 'Contato';
const formButtonLabel = 'formButtonLabel' in copy ? copy.formButtonLabel : 'Enviar mensagem';
const formFields = 'formFields' in copy ? copy.formFields : [
  { label: 'Nome', name: 'nome', type: 'text', placeholder: 'Seu nome' },
  { label: 'Email', name: 'email', type: 'email', placeholder: 'voce@email.com' },
  { label: 'Mensagem', name: 'mensagem', type: 'textarea', rows: 4, placeholder: 'Conte um pouco sobre o que precisa' },
];
const methodSteps = 'methodSteps' in copy ? copy.methodSteps : [
  { title: 'Entendimento', description: 'Mapeamento rápido do contexto, prioridades e restrições do projeto.' },
  { title: 'Plano', description: 'Organização das frentes de trabalho em uma sequência clara e editável.' },
  { title: 'Acompanhamento', description: 'Ritmo de revisão para transformar a primeira versão em conteúdo final.' },
];
const faqs = 'faq' in copy ? copy.faq : [
  { question: 'Este conteúdo é definitivo?', answer: 'Não. Ele funciona como placeholder contextual para validar estrutura, ritmo visual e hierarquia.' },
  { question: 'O formulário já envia dados?', answer: 'Ainda não. Ele fica pronto para conexão posterior com CRM, e-mail, Supabase ou outro backend.' },
  { question: 'Posso trocar seções depois?', answer: 'Sim. A estrutura foi gerada para receber ajustes incrementais sem recriar o projeto.' },
];

export default function HomePage() {
  const fullBleedHero = layoutVariant === 'full_bleed_media' && Boolean(heroMedia);

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-bg)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <a className="text-lg font-black" href="#inicio">${safeBrand}</a>
          <nav className="flex flex-wrap gap-4 text-sm font-semibold text-[var(--color-muted)]" aria-label="Navegação principal">
            <a href="#servicos">{servicesHeading}</a>
            <a href="#sobre">Sobre</a>
            <a href="#metodo">Método</a>
            <a href="#depoimentos">Depoimentos</a>
            <a href="#faq">FAQ</a>
            <a href="#contato">Contato</a>
          </nav>
        </div>
      </header>

      <section
        id="inicio"
        className={
          fullBleedHero
            ? 'relative isolate min-h-[84vh] overflow-hidden px-5 py-24 text-white md:py-32'
            : 'mx-auto grid min-h-[72vh] max-w-6xl content-center gap-10 px-5 py-20 md:py-28${heroMedia ? ' md:grid-cols-[1.08fr_0.92fr] md:items-center' : ''}'
        }
      >
        {fullBleedHero && heroMedia ? (
          <>
            {heroMedia.kind === 'video' ? (
              <video className="absolute inset-0 z-0 h-full w-full object-cover" autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
                <source src={heroMedia.src} type="video/mp4" />
              </video>
            ) : (
              <img className="absolute inset-0 z-0 h-full w-full object-cover" src={heroMedia.src} alt={heroMedia.alt} />
            )}
            <div className="absolute inset-0 z-[1] bg-[rgba(12,18,24,0.64)]" />
          </>
        ) : null}
        <div className={fullBleedHero ? 'relative z-10 mx-auto grid min-h-[66vh] max-w-6xl content-center gap-7' : 'grid gap-7'}>
          <p className={fullBleedHero ? 'text-sm font-black uppercase text-white/80' : 'text-sm font-black uppercase text-[var(--color-accent-dark)]'}>{copy.heroEyebrow}</p>
          <h1 className="max-w-4xl text-5xl font-black leading-none md:text-7xl">
            {copy.heroTitle}
          </h1>
          <p className={fullBleedHero ? 'max-w-2xl text-lg leading-8 text-white/80' : 'max-w-2xl text-lg leading-8 text-[var(--color-muted)]'}>
            {copy.heroText}
          </p>
          <a className={fullBleedHero ? 'w-fit rounded-lg bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm' : 'w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm'} href="#contato">
            {copy.cta}
          </a>
        </div>
        {!fullBleedHero && heroMedia ? (
          <figure className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[0_24px_70px_rgba(31,36,36,0.12)]">
            {heroMedia.kind === 'video' ? (
              <video className="aspect-[4/3] w-full object-cover" autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
                <source src={heroMedia.src} type="video/mp4" />
              </video>
            ) : (
              <img className="aspect-[4/3] w-full object-cover" src={heroMedia.src} alt={heroMedia.alt} />
            )}
            {heroMedia.attribution ? (
              <figcaption className="px-3 py-2 text-xs text-[var(--color-muted)]">{heroMedia.attribution}</figcaption>
            ) : null}
          </figure>
        ) : null}
      </section>

      <section id="servicos" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-4xl font-black">{servicesHeading}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {services.map((service, index) => (
            <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <svg className="mb-5 h-8 w-8 text-[var(--color-accent)]" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d={(serviceIcons[index] || serviceIcons[0]).path} />
              </svg>
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

      <section id="metodo" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-4xl font-black">Método de trabalho</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {methodSteps.map((step, index) => (
            <article key={step.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <span className="text-sm font-black text-[var(--color-accent)]">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="mt-4 text-xl font-black">{step.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="depoimentos" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-4xl font-black">Depoimentos</h2>
        <blockquote className="mt-8 rounded-lg border border-[var(--color-line)] bg-white p-6 text-lg leading-8 text-[var(--color-muted)] shadow-sm">
          "{copy.testimonial}"
        </blockquote>
      </section>

      <section id="faq" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-4xl font-black">FAQ</h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contato" className="mx-auto grid max-w-6xl gap-6 px-5 py-16 md:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="text-4xl font-black">{contactHeading}</h2>
          <p className="mt-4 leading-7 text-[var(--color-muted)]">{copy.contactText}</p>
        </div>
        <form className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
          {formFields.map((field) => (
            <label key={field.name} className="grid gap-2 font-bold text-[var(--color-muted)]">
              {field.label}
              {field.type === 'textarea' ? (
                <textarea className="rounded-lg border border-[var(--color-line)] px-3 py-3" name={field.name} rows={field.rows || 4} placeholder={field.placeholder} />
              ) : (
                <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name={field.name} type={field.type || 'text'} placeholder={field.placeholder} />
              )}
            </label>
          ))}
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{formButtonLabel}</button>
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="${fontHref}" rel="stylesheet" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
`;

  const globals = normalizeCssImportOrder(`@import "tailwindcss";

:root {
  --color-bg: ${theme.bg};
  --color-surface: ${theme.surface};
  --color-ink: ${theme.ink};
  --color-muted: ${theme.muted};
  --color-accent: ${theme.accent};
  --color-accent-dark: ${theme.accentDark};
  --color-line: ${theme.line};
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
  font-family: ${theme.typography.cssStack};
}

a {
  text-decoration: none;
}
`);

  return [
    { op: 'write_file', path: 'package.json', content: packageJson },
    { op: 'write_file', path: '.nvmrc', content: '24.15.0\n' },
    { op: 'write_file', path: 'next.config.mjs', content: `import path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n\nconst __dirname = path.dirname(fileURLToPath(import.meta.url));\n\n/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  turbopack: {\n    root: __dirname,\n  },\n};\n\nexport default nextConfig;\n` },
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
    { op: 'write_file', path: 'README.md', content: `# ${safeBrand}\n\nComposição modular em Next.js App Router, React e Tailwind CSS.\n\n## Rodar localmente\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Próximas configurações\n\n- Trocar placeholders por conteúdo final.\n- Ajustar peças de layout: header, hero, seções e footer.\n- Conectar formulário ao backend escolhido.\n- Configurar variáveis em \`.env.local\` antes de integrações externas.\n` },
  ];
}


module.exports = {
  buildAtelierCatalogNextPage,
  buildNextTailwindBlueprint,
};
