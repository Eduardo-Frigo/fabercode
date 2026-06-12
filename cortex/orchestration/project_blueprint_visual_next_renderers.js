const {
  renderNextHeroMediaDeclaration,
  renderNextResponsiveHeaderComponent,
} = require('./project_blueprint_template_utils');

function buildEditorialPortfolioStatementNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;

const portfolioRoute = '/projetos' as const;
const insightsRoute = '/insights' as const;
type ContentItem = { title: string; description?: string; excerpt?: string; category?: string; price?: string; quote?: string; name?: string; role?: string };
type FaqItem = { question: string; answer: string };
type FormField = { label: string; name: string; type?: string; rows?: number; placeholder?: string };
const services = copy.services as readonly ContentItem[];
const products = ('products' in copy ? copy.products : []) as readonly ContentItem[];
const differentials = ('differentials' in copy ? copy.differentials : copy.services) as readonly ContentItem[];
const galleryItems = ('galleryItems' in copy ? copy.galleryItems : copy.services) as readonly ContentItem[];
const blogPosts = ('blogPosts' in copy ? copy.blogPosts : []) as readonly ContentItem[];
const methodSteps = ('methodSteps' in copy ? copy.methodSteps : []) as readonly ContentItem[];
const testimonials = ('testimonials' in copy ? copy.testimonials : []) as readonly ContentItem[];
const faqs = ('faq' in copy ? copy.faq : []) as readonly FaqItem[];
const formFields = ('formFields' in copy ? copy.formFields : []) as readonly FormField[];
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#servicos', label: 'Serviços' },
  { href: routeHref(portfolioRoute), label: 'Projetos' },
  { href: routeHref('/processo'), label: 'Processo' },
  { href: routeHref(insightsRoute), label: 'Insights' },
  { href: '#contato', label: 'Contato' },
] as const;

function routeHref(path: string) {
  return path;
}

export default function HomePage() {
  return (
    <main data-visual-grammar="editorial-portfolio-statement" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} position="static" />

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:grid-cols-[0.95fr_1.05fr] md:items-end md:py-24">
        <div className="grid gap-7">
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
          <p className="max-w-2xl text-lg leading-8 text-[var(--color-muted)]">{copy.heroText}</p>
          <div className="flex flex-wrap gap-3">
            <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href="#contato">{copy.cta}</a>
            <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href={routeHref(portfolioRoute)}>{copy.secondaryCta || 'Ver projetos'}</a>
          </div>
        </div>
        <div className="grid gap-4">
          {heroMedia ? (
            <figure className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[0_24px_80px_rgba(31,36,36,0.12)]">
              {heroMedia.kind === 'video' ? (
                <video className="aspect-[16/11] w-full object-cover" autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
                  <source src={heroMedia.src} type="video/mp4" />
                </video>
              ) : (
                <img className="aspect-[16/11] w-full object-cover" src={heroMedia.src} alt={heroMedia.alt} />
              )}
              {heroMedia.attribution ? <figcaption className="px-3 py-2 text-xs text-[var(--color-muted)]">{heroMedia.attribution}</figcaption> : null}
            </figure>
          ) : (
            <div className="grid aspect-[16/11] content-end rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[0_24px_80px_rgba(31,36,36,0.12)]">
              <p className="max-w-sm text-2xl font-black">Galeria visual pronta para receber imagens autorais.</p>
            </div>
          )}
          <div className="grid gap-3 rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm md:grid-cols-2">
            <div>
              <strong className="block text-3xl">{copy.statOneValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statOneLabel}</span>
            </div>
            <div>
              <strong className="block text-3xl">{copy.statTwoValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statTwoLabel}</span>
            </div>
          </div>
        </div>
      </section>

      <section id="sobre" className="border-y border-[var(--color-line)] bg-white px-5 py-14">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[0.6fr_1.4fr]">
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Manifesto</p>
          <p className="text-2xl font-black leading-snug md:text-4xl">{copy.manifestoText || copy.about}</p>
        </div>
      </section>

      <section id="servicos" className="mx-auto max-w-7xl px-5 py-16">
        <div className="grid gap-8 lg:grid-cols-[0.55fr_1.45fr]">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Especialidades</p>
            <h2 className="mt-4 text-4xl font-black">{copy.servicesHeading}</h2>
            <p className="mt-5 leading-7 text-[var(--color-muted)]">{copy.about}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {services.map((service, index) => (
              <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
                <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
                <h3 className="mt-6 text-2xl font-black">{service.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="portfolio" className="bg-[var(--color-ink)] px-5 py-16 text-white">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-black uppercase text-white/60">Portfólio</p>
              <h2 className="mt-3 text-4xl font-black md:text-5xl">{copy.galleryHeading || 'Projetos selecionados'}</h2>
            </div>
            <a className="w-fit rounded-lg border border-white/18 px-5 py-3 font-black text-white" href={routeHref(portfolioRoute)}>Abrir portfólio</a>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {galleryItems.map((item, index) => (
              <article key={item.title} className={index === 0 ? 'rounded-lg border border-white/12 bg-white/10 p-6 md:col-span-2' : 'rounded-lg border border-white/12 bg-white/8 p-6'}>
                <span className="text-xs font-black uppercase text-white/50">{item.category || String(index + 1).padStart(2, '0')}</span>
                <h3 className="mt-4 text-2xl font-black">{item.title}</h3>
                <p className="mt-4 leading-7 text-white/72">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="produtos" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="max-w-3xl text-4xl font-black">{copy.productsHeading || 'Produtos e soluções'}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {products.map((item) => (
            <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <h3 className="text-xl font-black">{item.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              {'price' in item ? <strong className="mt-5 block text-[var(--color-accent)]">{item.price}</strong> : null}
            </article>
          ))}
        </div>
      </section>

      <section id="diferenciais" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="max-w-3xl text-4xl font-black">{copy.differentialsHeading || 'Diferenciais'}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {differentials.map((item) => (
            <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <h3 className="text-xl font-black">{item.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="processo" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">Processo editorial de trabalho</h2>
          <div className="mt-8 grid gap-4 lg:grid-cols-4">
            {methodSteps.map((step, index) => (
              <article key={step.title} className="border-l-4 border-[var(--color-accent)] bg-[var(--color-bg)] p-5">
                <span className="text-sm font-black text-[var(--color-accent)]">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="mt-4 text-xl font-black">{step.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="video" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.8fr_1.2fr] md:items-center">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Bastidores</p>
          <h2 className="mt-4 text-4xl font-black">{copy.bodyMediaTitle || 'Processo visual em detalhes'}</h2>
          <p className="mt-5 leading-8 text-[var(--color-muted)]">{copy.bodyMediaText || copy.about}</p>
        </div>
        <div className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
          <p className="text-lg leading-8 text-[var(--color-muted)]">{copy.testimonial}</p>
        </div>
      </section>

      <section id="blog" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.blogHeading || 'Insights'}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {blogPosts.map((post) => (
            <article key={post.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <span className="text-xs font-black uppercase text-[var(--color-accent)]">{post.category}</span>
              <h3 className="mt-3 text-xl font-black">{post.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{post.excerpt}</p>
            </article>
          ))}
        </div>
        <a className="mt-8 inline-flex rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black" href={routeHref(insightsRoute)}>Ver todos os insights</a>
      </section>

      <BlueprintTestimonialProof testimonials={testimonials} heading="Depoimentos de projeto" />

      <section id="faq" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Perguntas frequentes</h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contato" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.75fr_1.25fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Contato</p>
          <h2 className="mt-4 text-4xl font-black">{copy.contactHeading}</h2>
          <p className="mt-5 leading-8 text-[var(--color-muted)]">{copy.contactText}</p>
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
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{copy.formButtonLabel}</button>
        </form>
      </section>

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription} navLinks={navLinks} contactHref="#contato" />
    </main>
  );
}
`;
}

function buildAgriCommercialSystemNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;

const storeRoute = '/loja' as const;
const blogRoute = '/blog' as const;
const galleryRoute = '/portfolio' as const;
type ContentItem = { title: string; description?: string; excerpt?: string; category?: string; price?: string; quote?: string; name?: string; role?: string };
type FaqItem = { question: string; answer: string };
type FormField = { label: string; name: string; type?: string; rows?: number; placeholder?: string };
const services = copy.services as readonly ContentItem[];
const products = ('products' in copy ? copy.products : copy.services) as readonly ContentItem[];
const blogPosts = ('blogPosts' in copy ? copy.blogPosts : []) as readonly ContentItem[];
const galleryItems = ('galleryItems' in copy ? copy.galleryItems : copy.services) as readonly ContentItem[];
const methodSteps = ('methodSteps' in copy ? copy.methodSteps : []) as readonly ContentItem[];
const testimonials = ('testimonials' in copy ? copy.testimonials : []) as readonly ContentItem[];
const faqs = ('faq' in copy ? copy.faq : []) as readonly FaqItem[];
const formFields = ('formFields' in copy ? copy.formFields : []) as readonly FormField[];
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#servicos', label: 'Serviços' },
  { href: routeHref('/loja'), label: 'Loja' },
  { href: routeHref(blogRoute), label: 'Blog' },
  { href: routeHref(galleryRoute), label: 'Galeria' },
  { href: '#contato', label: 'Contato' },
] as const;

function routeHref(path: string) {
  return path;
}

export default function HomePage() {
  return (
    <main data-visual-grammar="agri-commercial-system" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} position="static" />

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-24">
        <div className="grid gap-7">
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
          <p className="max-w-2xl text-lg leading-8 text-[var(--color-muted)]">{copy.heroText}</p>
          <div className="flex flex-wrap gap-3">
            <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href="#contato">{copy.cta}</a>
            <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href={routeHref('/loja')}>{copy.secondaryCta || 'Ver soluções'}</a>
            <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href="#contato">WhatsApp</a>
          </div>
        </div>
        <div className="grid gap-4">
          {heroMedia ? (
            <figure className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[0_24px_80px_rgba(31,36,36,0.12)]">
              {heroMedia.kind === 'video' ? (
                <video className="aspect-[16/11] w-full object-cover" autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
                  <source src={heroMedia.src} type="video/mp4" />
                </video>
              ) : (
                <img className="aspect-[16/11] w-full object-cover" src={heroMedia.src} alt={heroMedia.alt} />
              )}
              {heroMedia.attribution ? <figcaption className="px-3 py-2 text-xs text-[var(--color-muted)]">{heroMedia.attribution}</figcaption> : null}
            </figure>
          ) : (
            <div className="grid aspect-[16/11] content-end rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[0_24px_80px_rgba(31,36,36,0.12)]">
              <p className="max-w-sm text-2xl font-black">Imagem operacional pronta para cultivo, jardim ou campo.</p>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <strong className="block text-3xl">{copy.statOneValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statOneLabel}</span>
            </div>
            <div className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <strong className="block text-3xl">{copy.statTwoValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statTwoLabel}</span>
            </div>
          </div>
        </div>
      </section>

      <section id="servicos" className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Soluções práticas</p>
            <h2 className="mt-3 text-4xl font-black">{copy.servicesHeading}</h2>
          </div>
          <p className="max-w-xl leading-7 text-[var(--color-muted)]">{copy.about}</p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {services.map((service, index) => (
            <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
              <h3 className="mt-5 text-xl font-black">{service.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="loja" className="bg-white px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">{copy.productsHeading || 'Soluções e produtos'}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {products.map((item) => (
              <article key={item.title} className="grid min-h-56 content-between rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6">
                <div>
                  <h3 className="text-xl font-black">{item.title}</h3>
                  <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
                </div>
                {'price' in item ? <strong className="mt-5 text-[var(--color-accent)]">{item.price}</strong> : null}
              </article>
            ))}
          </div>
          <a className="mt-8 inline-flex rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" href={routeHref('/loja')}>Abrir loja</a>
        </div>
      </section>

      <section id="portfolio" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.galleryHeading || 'Galeria operacional'}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {galleryItems.map((item) => (
            <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <h3 className="text-2xl font-black">{item.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="metodo" className="bg-[var(--color-accent-dark)] px-5 py-16 text-white">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">Como funciona</h2>
          <div className="mt-8 grid gap-4 lg:grid-cols-5">
            {methodSteps.map((step, index) => (
              <article key={step.title} className="rounded-lg border border-white/12 bg-white/8 p-5">
                <span className="text-sm font-black text-white/62">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="mt-4 text-xl font-black">{step.title}</h3>
                <p className="mt-3 leading-7 text-white/72">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="blog" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.blogHeading || 'Conteúdos recentes'}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {blogPosts.map((post) => (
            <article key={post.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <span className="text-xs font-black uppercase text-[var(--color-accent)]">{post.category}</span>
              <h3 className="mt-3 text-xl font-black">{post.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{post.excerpt}</p>
            </article>
          ))}
        </div>
      </section>

      <BlueprintTestimonialProof testimonials={testimonials} heading="Resultados no campo" />

      <section id="faq" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Perguntas frequentes</h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contato" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Lead qualificado</p>
          <h2 className="mt-4 text-4xl font-black">{copy.contactHeading}</h2>
          <p className="mt-5 leading-8 text-[var(--color-muted)]">{copy.contactText}</p>
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
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{copy.formButtonLabel}</button>
        </form>
      </section>

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription} navLinks={navLinks} contactHref="#contato" />
    </main>
  );
}
`;
}

function buildTradeLogisticsCommandNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#servicos', label: 'Serviços' },
  { href: '#tipos', label: 'Tipos' },
  { href: '#processo', label: 'Processo' },
  { href: '#guias', label: 'Guias' },
  { href: '#contato', label: 'Cotação' },
] as const;

type ContentItem = { title: string; description?: string; excerpt?: string; category?: string; price?: string; quote?: string; name?: string; role?: string };
type FaqItem = { question: string; answer: string };
type FormField = { label: string; name: string; type?: string; rows?: number; placeholder?: string };
const services = copy.services as readonly ContentItem[];
const products = ('products' in copy ? copy.products : []) as readonly ContentItem[];
const differentials = ('differentials' in copy ? copy.differentials : []) as readonly ContentItem[];
const galleryItems = ('galleryItems' in copy ? copy.galleryItems : []) as readonly ContentItem[];
const methodSteps = ('methodSteps' in copy ? copy.methodSteps : []) as readonly ContentItem[];
const blogPosts = ('blogPosts' in copy ? copy.blogPosts : []) as readonly ContentItem[];
const testimonials = ('testimonials' in copy ? copy.testimonials : []) as readonly ContentItem[];
const faqs = ('faq' in copy ? copy.faq : []) as readonly FaqItem[];
const formFields = ('formFields' in copy ? copy.formFields : []) as readonly FormField[];

function HeroMedia({ className }: { className: string }) {
  if (!heroMedia || heroMedia.src.includes('-smoke') || heroMedia.src.includes('/smoke')) {
    return (
      <div className={className}>
        <div className="grid h-full content-end bg-[linear-gradient(135deg,#162033,#23415f_58%,#0b1f3a)] p-5 text-white">
          <p className="max-w-xs break-words text-2xl font-black [overflow-wrap:anywhere] sm:max-w-sm">Porto, contêineres e operação internacional prontos para receber imagem.</p>
        </div>
      </div>
    );
  }
  if (heroMedia.kind === 'video') {
    return (
      <video className={className} autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
        <source src={heroMedia.src} type="video/mp4" />
      </video>
    );
  }
  return <img className={className} src={heroMedia.src} alt={heroMedia.alt} />;
}

export default function HomePage() {
  return (
    <main data-visual-grammar="trade-logistics-command" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} position="static" />

      <section id="inicio" className="bg-[#0b1f3a] px-5 py-16 text-white lg:py-24">
        <div className="mx-auto grid max-w-7xl min-w-0 gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="grid min-w-0 gap-7">
            <p className="text-sm font-black uppercase text-white/62">{copy.heroEyebrow}</p>
            <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
            <p className="max-w-xs break-words text-lg leading-8 text-white/76 [overflow-wrap:anywhere] sm:max-w-2xl">{copy.heroText}</p>
            <div className="grid max-w-xs gap-3 sm:flex sm:max-w-none sm:flex-wrap">
              <a className="w-full max-w-full rounded-lg bg-[var(--color-accent)] px-5 py-3 text-center font-black text-white shadow-sm sm:w-auto" href="#contato">{copy.cta}</a>
              <a className="w-full max-w-full rounded-lg border border-white/16 px-5 py-3 text-center font-black text-white sm:w-auto" href="#processo">{copy.secondaryCta || 'Ver processo'}</a>
            </div>
          </div>
          <div className="grid min-w-0 gap-4 rounded-lg border border-white/12 bg-white/8 p-5">
            <figure className="overflow-hidden rounded-lg border border-white/12 bg-white/8">
              <HeroMedia className="aspect-[16/9] w-full object-cover" />
              {heroMedia && heroMedia.attribution ? <figcaption className="px-3 py-2 text-xs text-white/58">{heroMedia.attribution}</figcaption> : null}
            </figure>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-white p-5 text-[var(--color-ink)]">
                <strong className="block text-3xl">{copy.statOneValue}</strong>
                <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statOneLabel}</span>
              </div>
              <div className="rounded-lg bg-white p-5 text-[var(--color-ink)]">
                <strong className="block text-3xl">{copy.statTwoValue}</strong>
                <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statTwoLabel}</span>
              </div>
            </div>
            <div className="rounded-lg border border-white/12 p-5">
              <p className="text-sm font-black uppercase text-white/60">Checklist de operação</p>
              <div className="mt-4 grid gap-3 text-sm text-white/76">
                <span>Fornecedor internacional</span>
                <span>Cotação internacional</span>
                <span>Comércio exterior</span>
                <span>Desembaraço aduaneiro</span>
                <span>Documentação e desembaraço</span>
                <span>Logística internacional</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="servicos" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.servicesHeading}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {services.map((service, index) => (
            <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
              <h3 className="mt-5 text-xl font-black">{service.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="tipos" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.55fr_1.45fr]">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Tipos de importação atendidos</p>
            <h2 className="mt-4 text-4xl font-black">{copy.productsHeading}</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {products.map((item) => (
              <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6">
                <h3 className="text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="diferenciais" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.differentialsHeading}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {differentials.map((item) => (
            <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <h3 className="text-xl font-black">{item.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="portfolio" className="bg-[#162033] px-5 py-16 text-white">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">{copy.galleryHeading}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {galleryItems.map((item) => (
              <article key={item.title} className="rounded-lg border border-white/12 bg-white/8 p-6">
                <h3 className="text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-white/72">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="processo" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Processo de importação</h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-5">
          {methodSteps.map((step, index) => (
            <article key={step.title} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <span className="text-sm font-black text-[var(--color-accent)]">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="mt-4 text-xl font-black">{step.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="guias" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">{copy.blogHeading}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {blogPosts.map((post) => (
              <article key={post.title} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6">
                <span className="text-xs font-black uppercase text-[var(--color-accent)]">{post.category}</span>
                <h3 className="mt-3 text-xl font-black">{post.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{post.excerpt}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <BlueprintTestimonialProof testimonials={testimonials} heading="Confiança operacional" />

      <section id="faq" className="mx-auto max-w-7xl px-5 py-16">
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

      <section id="contato" className="bg-[#0b1f3a] px-5 py-16 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <p className="text-sm font-black uppercase text-white/60">Análise de importação</p>
            <h2 className="mt-4 text-4xl font-black">{copy.contactHeading}</h2>
            <p className="mt-5 leading-8 text-white/72">{copy.contactText}</p>
            <a className="mt-6 inline-flex rounded-lg border border-white/16 px-5 py-3 font-black text-white" href="#contato">Falar no WhatsApp</a>
          </div>
          <form className="grid gap-4 rounded-lg border border-white/12 bg-white/8 p-6">
            {formFields.map((field) => (
              <label key={field.name} className="grid gap-2 font-bold text-white/72">
                {field.label}
                {field.type === 'textarea' ? (
                  <textarea className="rounded-lg border border-white/16 bg-white px-3 py-3 text-[var(--color-ink)]" name={field.name} rows={field.rows || 4} placeholder={field.placeholder} />
                ) : (
                  <input className="rounded-lg border border-white/16 bg-white px-3 py-3 text-[var(--color-ink)]" name={field.name} type={field.type || 'text'} placeholder={field.placeholder} />
                )}
              </label>
            ))}
            <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{copy.formButtonLabel}</button>
          </form>
        </div>
      </section>

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription} navLinks={navLinks} contactHref="#contato" tone="dark" />
    </main>
  );
}
`;
}

function buildSaasToolWorkspaceNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#produto', label: 'Produto' },
  { href: '#modulos', label: 'Módulos' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#planos', label: 'Planos' },
  { href: '#contato', label: 'Demo' },
] as const;

type ContentItem = { title: string; description?: string; excerpt?: string; category?: string; price?: string; quote?: string; name?: string; role?: string };
type FaqItem = { question: string; answer: string };
type FormField = { label: string; name: string; type?: string; rows?: number; placeholder?: string };
const services = copy.services as readonly ContentItem[];
const products = ('products' in copy ? copy.products : []) as readonly ContentItem[];
const methodSteps = ('methodSteps' in copy ? copy.methodSteps : []) as readonly ContentItem[];
const testimonials = ('testimonials' in copy ? copy.testimonials : []) as readonly ContentItem[];
const faqs = ('faq' in copy ? copy.faq : []) as readonly FaqItem[];
const formFields = ('formFields' in copy ? copy.formFields : []) as readonly FormField[];

export default function HomePage() {
  return (
    <main data-visual-grammar="saas-tool-workspace" className="min-h-screen overflow-x-hidden bg-[#f6f7fb] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} position="static" />

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 overflow-hidden px-5 py-16 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:py-24">
        <div className="grid min-w-0 gap-7">
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
          <p className="max-w-xs text-lg leading-8 text-[var(--color-muted)] sm:max-w-2xl">{copy.heroText}</p>
          <div className="flex flex-wrap gap-3">
            <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href="#contato">{copy.cta}</a>
            <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href="#modulos">{copy.secondaryCta || 'Ver módulos'}</a>
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[#111827] p-4 text-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
          <div className="flex gap-2 border-b border-white/12 pb-4">
            <span className="h-3 w-3 rounded-full bg-[#ef4444]" />
            <span className="h-3 w-3 rounded-full bg-[#f59e0b]" />
            <span className="h-3 w-3 rounded-full bg-[#22c55e]" />
          </div>
          <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[0.65fr_1.35fr]">
            <aside className="grid gap-3 rounded-lg bg-white/8 p-4 text-sm text-white/70">
              <strong className="text-white">Workspace</strong>
              <span>Dashboard</span>
              <span>Pipeline</span>
              <span>Automações</span>
              <span>Relatórios</span>
            </aside>
            <section className="grid min-w-0 gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-white p-4 text-[var(--color-ink)]"><strong className="block text-2xl">{copy.statOneValue}</strong><span className="text-xs text-[var(--color-muted)]">{copy.statOneLabel}</span></div>
                <div className="rounded-lg bg-white p-4 text-[var(--color-ink)]"><strong className="block text-2xl">{copy.statTwoValue}</strong><span className="text-xs text-[var(--color-muted)]">{copy.statTwoLabel}</span></div>
                <div className="rounded-lg bg-[var(--color-accent)] p-4"><strong className="block text-2xl">Live</strong><span className="text-xs text-white/76">operação em tempo real</span></div>
              </div>
              <div className="grid gap-3">
                {services.slice(0, 3).map((service, index) => (
                  <div key={service.title} className="min-w-0 overflow-hidden rounded-lg border border-white/12 bg-white/8 p-4">
                    <span className="text-xs font-black text-white/50">{String(index + 1).padStart(2, '0')}</span>
                    <h3 className="mt-2 break-words font-black [overflow-wrap:anywhere]">{service.title}</h3>
                    <p className="mt-1 break-words text-sm leading-6 text-white/66 [overflow-wrap:anywhere]">{service.description}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </section>

      <section id="produto" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[0.7fr_1.3fr]">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Produto</p>
            <h2 className="mt-4 text-4xl font-black">{copy.servicesHeading}</h2>
          </div>
          <p className="text-xl font-black leading-9">{copy.about}</p>
        </div>
      </section>

      <section id="modulos" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Módulos da ferramenta</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {services.map((service, index) => (
            <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
              <h3 className="mt-5 text-xl font-black">{service.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="bg-[#111827] px-5 py-16 text-white">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">Workflow operacional</h2>
          <div className="mt-8 grid gap-4 lg:grid-cols-4">
            {methodSteps.map((step, index) => (
              <article key={step.title} className="rounded-lg border border-white/12 bg-white/8 p-5">
                <span className="text-sm font-black text-white/50">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="mt-4 text-xl font-black">{step.title}</h3>
                <p className="mt-3 leading-7 text-white/70">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.productsHeading || 'Planos e pacotes'}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {products.map((item) => (
            <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <h3 className="text-2xl font-black">{item.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              {'price' in item ? <strong className="mt-5 block text-2xl text-[var(--color-accent)]">{item.price}</strong> : null}
            </article>
          ))}
        </div>
      </section>

      <BlueprintTestimonialProof testimonials={testimonials} heading="Times que ganham previsibilidade" />

      <section id="faq" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Dúvidas frequentes</h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contato" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Demo</p>
          <h2 className="mt-4 text-4xl font-black">{copy.contactHeading}</h2>
          <p className="mt-5 leading-8 text-[var(--color-muted)]">{copy.contactText}</p>
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
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{copy.formButtonLabel}</button>
        </form>
      </section>

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription} navLinks={navLinks} contactHref="#contato" />
    </main>
  );
}
`;
}

function buildEditorialContentHubNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#destaques', label: 'Destaques' },
  { href: '/editorias', label: 'Editorias' },
  { href: '/artigos', label: 'Artigos' },
  { href: '/newsletter', label: 'Newsletter' },
  { href: '/sobre', label: 'Sobre' },
  { href: '/contato', label: 'Contato' },
] as const;

type ContentItem = { title: string; description?: string; excerpt?: string; category?: string; price?: string; quote?: string; name?: string; role?: string };
type FaqItem = { question: string; answer: string };
type FormField = { label: string; name: string; type?: string; rows?: number; placeholder?: string };
const services = copy.services as readonly ContentItem[];
const blogPosts = ('blogPosts' in copy ? copy.blogPosts : copy.services) as readonly ContentItem[];
const products = ('products' in copy ? copy.products : []) as readonly ContentItem[];
const methodSteps = ('methodSteps' in copy ? copy.methodSteps : []) as readonly ContentItem[];
const testimonials = ('testimonials' in copy ? copy.testimonials : []) as readonly ContentItem[];
const faqs = ('faq' in copy ? copy.faq : []) as readonly FaqItem[];
const formFields = ('formFields' in copy ? copy.formFields : []) as readonly FormField[];

export default function HomePage() {
  return (
    <main data-visual-grammar="editorial-content-hub" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} position="static" />

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:items-end lg:py-24">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">{copy.heroEyebrow}</p>
          <h1 className="mt-5 max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-5xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
          <p className="mt-7 max-w-3xl text-lg leading-8 text-[var(--color-muted)]">{copy.heroText}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href="/newsletter">{copy.cta}</a>
            <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href="/artigos">{copy.secondaryCta || 'Ler artigos'}</a>
          </div>
        </div>
        <aside className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Edição atual</p>
          <h2 className="mt-4 text-3xl font-black">{blogPosts[0]?.title || copy.servicesHeading}</h2>
          <p className="mt-4 leading-7 text-[var(--color-muted)]">{blogPosts[0]?.excerpt || copy.about}</p>
        </aside>
      </section>

      <section id="destaques" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
          {blogPosts.slice(0, 3).map((post, index) => (
            <article key={post.title} className={index === 0 ? 'rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6 md:col-span-2' : 'rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6'}>
              <span className="text-xs font-black uppercase text-[var(--color-accent)]">{post.category}</span>
              <h3 className="mt-3 text-2xl font-black">{post.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{post.excerpt || post.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="editorias" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.servicesHeading}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {services.map((service, index) => (
            <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
              <h3 className="mt-5 text-xl font-black">{service.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="artigos" className="bg-[var(--color-ink)] px-5 py-16 text-white">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">{copy.blogHeading || 'Artigos recentes'}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {blogPosts.map((post) => (
              <article key={post.title} className="rounded-lg border border-white/12 bg-white/8 p-6">
                <span className="text-xs font-black uppercase text-white/54">{post.category}</span>
                <h3 className="mt-3 text-xl font-black">{post.title}</h3>
                <p className="mt-3 leading-7 text-white/72">{post.excerpt || post.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="metodo" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Rotina editorial</h2>
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

      <section id="produtos" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">{copy.productsHeading || 'Produtos editoriais'}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {products.map((item) => (
              <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6">
                <h3 className="text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <BlueprintTestimonialProof testimonials={testimonials} heading="Leitores que voltam pelo contexto" />

      <section id="faq" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Perguntas frequentes</h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="newsletter" className="bg-white px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Newsletter</p>
            <h2 className="mt-4 text-4xl font-black">{copy.contactHeading}</h2>
            <p className="mt-5 leading-8 text-[var(--color-muted)]">{copy.contactText}</p>
          </div>
          <form className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6">
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
            <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{copy.formButtonLabel}</button>
          </form>
        </div>
      </section>

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription} navLinks={navLinks} contactHref="/newsletter" />
    </main>
  );
}
`;
}

function buildWineSensoryCellarNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#historia', label: 'História' },
  { href: '#kit', label: 'Kit' },
  { href: '#harmonizacao', label: 'Harmonização' },
  { href: '#oferta', label: 'Oferta' },
  { href: '#faq', label: 'FAQ' },
] as const;

const benefits = copy.services;
const wines = copy.products;
const galleryItems = copy.galleryItems;
const pairings = copy.differentials;
const methodSteps = copy.methodSteps;
const testimonials = copy.testimonials;
const faqs = copy.faq;
const formFields = copy.formFields;

function HeroMedia() {
  if (!heroMedia) {
    return (
      <div className="grid min-h-[420px] content-end rounded-lg border border-[var(--color-line)] bg-[linear-gradient(135deg,var(--color-accent-dark),#3b2119)] p-7 text-white shadow-[0_28px_90px_rgba(36,21,15,0.22)]">
        <p className="max-w-sm text-3xl font-black">Vinhedo, garrafa e taça em luz dourada.</p>
      </div>
    );
  }

  return (
    <figure className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_28px_90px_rgba(36,21,15,0.18)]">
      {heroMedia.kind === 'video' ? (
        <video className="aspect-[4/5] w-full object-cover md:aspect-[5/4]" autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
          <source src={heroMedia.src} type="video/mp4" />
        </video>
      ) : (
        <img className="aspect-[4/5] w-full object-cover md:aspect-[5/4]" src={heroMedia.src} alt={heroMedia.alt} />
      )}
      {heroMedia.attribution ? <figcaption className="px-3 py-2 text-xs text-[var(--color-muted)]">{heroMedia.attribution}</figcaption> : null}
    </figure>
  );
}

export default function HomePage() {
  return (
    <main data-visual-grammar="wine-sensory-cellar" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} />

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:grid-cols-[0.92fr_1.08fr] md:items-center md:py-24">
        <div className="grid gap-7">
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
          <p className="max-w-2xl text-lg leading-8 text-[var(--color-muted)]">{copy.heroText}</p>
          <div className="flex flex-wrap gap-3">
            <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href={copy.ctaHref}>{copy.cta}</a>
            <a className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href={copy.secondaryCtaHref}>{copy.secondaryCta}</a>
          </div>
          <div className="grid gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 md:grid-cols-2">
            <div>
              <strong className="block text-3xl">{copy.statOneValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statOneLabel}</span>
            </div>
            <div>
              <strong className="block text-3xl">{copy.statTwoValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statTwoLabel}</span>
            </div>
          </div>
        </div>
        <HeroMedia />
      </section>

      <section id="historia" className="border-y border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[0.7fr_1.3fr]">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Origem</p>
            <h2 className="mt-4 text-4xl font-black">{copy.manifestoTitle}</h2>
          </div>
          <div className="grid gap-6">
            <p className="text-xl leading-9 text-[var(--color-muted)]">{copy.about}</p>
            <p className="text-2xl font-black leading-snug">{copy.manifestoText}</p>
          </div>
        </div>
      </section>

      <section id="kit" className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Kit degustação</p>
            <h2 className="mt-3 text-4xl font-black md:text-5xl">{copy.productsHeading}</h2>
          </div>
          <a className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" href="#oferta">Garantir meu kit</a>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {wines.map((wine) => (
            <article key={wine.title} className="grid min-h-80 content-between rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div>
                <span className="text-xs font-black uppercase text-[var(--color-accent)]">{wine.category}</span>
                <h3 className="mt-4 text-2xl font-black">{wine.title}</h3>
                <p className="mt-4 leading-7 text-[var(--color-muted)]">{wine.description}</p>
              </div>
              <strong className="mt-8 text-[var(--color-accent)]">{wine.price}</strong>
            </article>
          ))}
        </div>
      </section>

      <section id="beneficios" className="bg-[var(--color-ink)] px-5 py-16 text-white">
        <div className="mx-auto max-w-7xl">
          <h2 className="max-w-3xl text-4xl font-black">{copy.servicesHeading}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {benefits.map((benefit, index) => (
              <article key={benefit.title} className="rounded-lg border border-white/12 bg-white/8 p-5">
                <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} tone="gold" />
                <h3 className="mt-5 text-lg font-black">{benefit.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/72">{benefit.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="experiencia" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.8fr_1.2fr] md:items-start">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Experiência sensorial</p>
          <h2 className="mt-4 text-4xl font-black">{copy.bodyMediaTitle}</h2>
        </div>
        <div className="grid gap-4">
          <p className="text-xl leading-9 text-[var(--color-muted)]">{copy.bodyMediaText}</p>
          <div className="grid gap-4 md:grid-cols-3">
            {galleryItems.map((item) => (
              <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                <h3 className="font-black">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="harmonizacao" className="border-y border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">{copy.differentialsHeading}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {pairings.map((item) => (
              <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6">
                <h3 className="text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <BlueprintTestimonialProof testimonials={testimonials} heading="Vozes da degustação" tone="gold" />

      <section id="oferta" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg bg-[var(--color-accent)] p-8 text-white">
          <p className="text-sm font-black uppercase text-white/72">Oferta especial</p>
          <h2 className="mt-4 text-4xl font-black">Leve a experiência {brandName} para sua casa</h2>
          <p className="mt-5 leading-8 text-white/82">{copy.testimonial}</p>
          <div className="mt-8 grid gap-3">
            {methodSteps.map((step) => (
              <article key={step.title} className="rounded-lg border border-white/18 bg-white/10 p-4">
                <h3 className="font-black">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/75">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
        <div className="grid gap-4">
          <form className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
            <h3 className="text-2xl font-black">{copy.contactHeading}</h3>
            <p className="leading-7 text-[var(--color-muted)]">{copy.contactText}</p>
            {formFields.map((field) => (
              <label key={field.name} className="grid gap-2 font-bold text-[var(--color-muted)]">
                {field.label}
                <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name={field.name} type={field.type || 'text'} placeholder={field.placeholder} />
              </label>
            ))}
            <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{copy.formButtonLabel}</button>
          </form>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Perguntas frequentes</h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <BlueprintFooterUtility brand={brandName} summary="Venda e consumo permitidos apenas para maiores de 18 anos. Beba com moderação." navLinks={navLinks} contactHref="#oferta" />
    </main>
  );
}
`;
}

function buildConstructionRetailYardNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;

const navLinks = [
  { href: '/', label: 'Início' },
  { href: '/sobre', label: 'Sobre' },
  { href: '/produtos', label: 'Produtos' },
  { href: '/servicos', label: 'Serviços' },
  { href: '/orcamento', label: 'Orçamento' },
  { href: '/blog', label: 'Blog' },
  { href: '/contato', label: 'Contato' },
] as const;
const services = copy.services;
const products = copy.products;
const galleryItems = copy.galleryItems;
const blogPosts = copy.blogPosts;
const differentials = copy.differentials;
const methodSteps = copy.methodSteps;
const testimonials = copy.testimonials;
const faqs = copy.faq;
const formFields = copy.formFields;

function HeroMedia() {
  if (!heroMedia) {
    return (
      <div className="grid min-h-[360px] content-end rounded-lg border border-[var(--color-line)] bg-[linear-gradient(135deg,#1e293b,#475569)] p-7 text-white shadow-[0_24px_80px_rgba(30,41,59,0.18)]">
        <p className="max-w-sm text-3xl font-black">Pátio de materiais, ferramentas e entrega pronta.</p>
      </div>
    );
  }

  return (
    <figure className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[0_24px_80px_rgba(30,41,59,0.14)]">
      <img className="aspect-[16/10] w-full object-cover" src={heroMedia.src} alt={heroMedia.alt} />
      {heroMedia.attribution ? <figcaption className="px-3 py-2 text-xs text-[var(--color-muted)]">{heroMedia.attribution}</figcaption> : null}
    </figure>
  );
}

export default function HomePage() {
  return (
    <main data-visual-grammar="construction-retail-yard" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} ctaLabel="Enviar lista" ctaHref="/orcamento" />

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 px-5 py-14 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:py-20">
        <div className="grid gap-7">
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
          <p className="max-w-2xl text-lg leading-8 text-[var(--color-muted)]">{copy.heroText}</p>
          <div className="flex flex-wrap gap-3">
            <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href={copy.ctaHref}>{copy.cta}</a>
            <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href={copy.secondaryCtaHref}>{copy.secondaryCta}</a>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-line)] bg-white p-5">
              <strong className="block text-3xl">{copy.statOneValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statOneLabel}</span>
            </div>
            <div className="rounded-lg border border-[var(--color-line)] bg-white p-5">
              <strong className="block text-3xl">{copy.statTwoValue}</strong>
              <span className="text-sm leading-6 text-[var(--color-muted)]">{copy.statTwoLabel}</span>
            </div>
          </div>
        </div>
        <HeroMedia />
      </section>

      <section id="produtos" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-black uppercase text-[var(--color-accent)]">Catálogo</p>
              <h2 className="mt-3 text-4xl font-black">{copy.productsHeading}</h2>
            </div>
            <a className="w-fit rounded-lg border border-[var(--color-line)] px-5 py-3 font-black" href="/produtos">Abrir produtos</a>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {products.map((item) => (
              <article key={item.title} className="grid min-h-64 content-between rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-5 shadow-sm">
                <div>
                  <span className="text-xs font-black uppercase text-[var(--color-accent)]">{item.category}</span>
                  <h3 className="mt-4 text-xl font-black">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{item.description}</p>
                </div>
                <strong className="mt-6 text-[var(--color-accent)]">{item.price}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="servicos" className="mx-auto max-w-7xl px-5 py-16">
        <div className="grid gap-8 lg:grid-cols-[0.62fr_1.38fr]">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Serviços</p>
            <h2 className="mt-4 text-4xl font-black">{copy.servicesHeading}</h2>
            <p className="mt-5 leading-8 text-[var(--color-muted)]">{copy.about}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {services.map((service, index) => (
              <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
                <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
                <h3 className="mt-6 text-2xl font-black">{service.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="orcamento" className="bg-[var(--color-ink)] px-5 py-16 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <p className="text-sm font-black uppercase text-white/60">Orçamento de obra</p>
            <h2 className="mt-4 text-4xl font-black">{copy.contactHeading}</h2>
            <p className="mt-5 leading-8 text-white/72">{copy.contactText}</p>
            <div className="mt-8 grid gap-3">
              {methodSteps.map((step, index) => (
                <article key={step.title} className="rounded-lg border border-white/12 bg-white/8 p-4">
                  <span className="text-xs font-black text-[var(--color-gold)]">{String(index + 1).padStart(2, '0')}</span>
                  <h3 className="mt-2 font-black">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/72">{step.description}</p>
                </article>
              ))}
            </div>
          </div>
          <form className="grid gap-4 rounded-lg border border-white/12 bg-white p-6 text-[var(--color-ink)] shadow-sm">
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
            <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{copy.formButtonLabel}</button>
          </form>
        </div>
      </section>

      <section id="sobre" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Sobre</p>
          <h2 className="mt-4 text-4xl font-black">{copy.manifestoTitle}</h2>
          <p className="mt-5 leading-8 text-[var(--color-muted)]">{copy.manifestoText}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {differentials.map((item) => (
            <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <h3 className="text-xl font-black">{item.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="projetos" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">{copy.galleryHeading}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {galleryItems.map((item) => (
              <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-6">
                <span className="text-xs font-black uppercase text-[var(--color-accent)]">{item.category}</span>
                <h3 className="mt-4 text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="blog" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.blogHeading}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {blogPosts.map((post) => (
            <article key={post.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <span className="text-xs font-black uppercase text-[var(--color-accent)]">{post.category}</span>
              <h3 className="mt-4 text-xl font-black">{post.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{post.excerpt}</p>
            </article>
          ))}
        </div>
      </section>

      <BlueprintTestimonialProof testimonials={testimonials} heading="Obras atendidas com previsibilidade" />

      <section id="faq" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">Perguntas frequentes</h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription} navLinks={navLinks} contactHref="/contato" />
    </main>
  );
}
`;
}

module.exports = {
  buildAgriCommercialSystemNextPage,
  buildConstructionRetailYardNextPage,
  buildEditorialContentHubNextPage,
  buildEditorialPortfolioStatementNextPage,
  buildSaasToolWorkspaceNextPage,
  buildTradeLogisticsCommandNextPage,
  buildWineSensoryCellarNextPage,
};
