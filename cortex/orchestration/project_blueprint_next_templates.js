const { buildBlueprintIconSet } = require('./blueprint_icon_registry');
const { normalizeCssImportOrder } = require('./css_operation_safety');
const { buildInstitutionalCopy } = require('./project_blueprint_copy');
const {
  resolveBlueprintLayoutRecipe,
  resolveBlueprintTheme,
} = require('./project_blueprint_layout');
const {
  normalizeBlueprintMediaAssets,
  renderNextHeroMediaDeclaration,
  renderNextResponsiveHeaderComponent,
} = require('./project_blueprint_template_utils');
const {
  isActiveTemporaryBlueprintContract,
} = require('./temporary_blueprint_contract_service');
const {
  buildAgriCommercialSystemNextPage,
  buildConstructionRetailYardNextPage,
  buildEditorialContentHubNextPage,
  buildEditorialPortfolioStatementNextPage,
  buildSaasToolWorkspaceNextPage,
  buildTradeLogisticsCommandNextPage,
  buildWineSensoryCellarNextPage,
} = require('./project_blueprint_visual_next_renderers');
const {
  buildAtelierCatalogNextPage,
  buildChocolateSensoryNextPage,
  buildConsumerProductCatalogNextPage,
  buildTechnicalB2BLeadNextPage,
} = require('./project_blueprint_next_page_renderers');
const { buildDomainRouteOperations } = require('./project_blueprint_next_route_pages');

function buildNextTailwindBlueprint({ brand, contract = {}, theme = resolveBlueprintTheme(), mediaAssets = {}, iconIntent = [], layoutVariant = 'editorial_split', layoutRecipe = null }) {
  const safeBrand = String(brand || 'Faber Projeto').replace(/`/g, "'");
  const copy = buildInstitutionalCopy({ ...contract, brandFallback: safeBrand || contract.brandFallback });
  const heroMedia = normalizeBlueprintMediaAssets(mediaAssets).hero;
  const iconSet = buildBlueprintIconSet({ contract, iconIntent });
  const activeLayoutRecipe = layoutRecipe || resolveBlueprintLayoutRecipe({ contract, layoutVariant });
  const supportsRoutePages = isActiveTemporaryBlueprintContract(contract.temporaryBlueprintContract) ||
    activeLayoutRecipe.id === 'temporary-contract-site' ||
    ['garden-service-commerce', 'wood-sculpture-atelier', 'architecture-studio-site'].includes(activeLayoutRecipe.id) ||
    contract.domain === 'wood-finishes' ||
    activeLayoutRecipe.id === 'technical-b2b-lead-site' ||
    activeLayoutRecipe.id === 'construction-materials-store-site';
  const fontHref = theme.typography.googleHref ||
    `https://fonts.googleapis.com/css2?family=${theme.typography.importName}:wght@400;600;700;800;900&display=swap`;
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

  const visualGrammarId = activeLayoutRecipe.visualGrammar && activeLayoutRecipe.visualGrammar.id
    ? activeLayoutRecipe.visualGrammar.id
    : '';
  const renderGenericFullBleedHero = activeLayoutRecipe.hero === 'full-bleed-media' &&
    Boolean(heroMedia) &&
    activeLayoutRecipe.id !== 'sensory-chocolate-landing';
  const visualGrammarRendererId = renderGenericFullBleedHero ? '' : visualGrammarId;
  const page = visualGrammarRendererId === 'consumer-product-mosaic'
    ? buildConsumerProductCatalogNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : visualGrammarRendererId === 'technical-b2b-systems'
      ? buildTechnicalB2BLeadNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : visualGrammarRendererId === 'wine-sensory-cellar'
      ? buildWineSensoryCellarNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : visualGrammarRendererId === 'construction-retail-yard'
      ? buildConstructionRetailYardNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : visualGrammarRendererId === 'editorial-portfolio-statement'
      ? buildEditorialPortfolioStatementNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : visualGrammarRendererId === 'agri-commercial-system'
      ? buildAgriCommercialSystemNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : visualGrammarRendererId === 'trade-logistics-command'
      ? buildTradeLogisticsCommandNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : visualGrammarRendererId === 'saas-tool-workspace'
      ? buildSaasToolWorkspaceNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : visualGrammarRendererId === 'editorial-content-hub'
      ? buildEditorialContentHubNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
      : activeLayoutRecipe.id === 'artisan-commerce'
    ? buildAtelierCatalogNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : activeLayoutRecipe.id === 'sensory-chocolate-landing'
      ? buildChocolateSensoryNextPage({ brand: safeBrand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe: activeLayoutRecipe })
    : `const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant: string = ${JSON.stringify(layoutVariant)};
const layoutRecipe = ${JSON.stringify(activeLayoutRecipe, null, 2)};
const hasRoutePages = ${JSON.stringify(supportsRoutePages)} as const;
const isArchitectureSite = layoutRecipe.id === 'architecture-studio-site';
const isTechnicalB2BSite = layoutRecipe.id === 'technical-b2b-lead-site';

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
type FormField = {
  label: string;
  name: string;
  type?: string;
  rows?: number;
  placeholder?: string;
};
const optionalCopy = copy as typeof copy & {
  ctaHref?: string;
  headerCta?: string;
  headerCtaHref?: string;
  navServicesLabel?: string;
  navProductsLabel?: string;
  navGalleryLabel?: string;
  navBlogLabel?: string;
  navMethodLabel?: string;
  secondaryCta?: string;
  secondaryCtaHref?: string;
  products?: readonly ContentItem[];
  productsHeading?: string;
  blogPosts?: readonly ContentItem[];
  blogHeading?: string;
  galleryItems?: readonly ContentItem[];
  galleryHeading?: string;
  testimonials?: readonly ContentItem[];
  differentials?: readonly ContentItem[];
  differentialsHeading?: string;
  guideTitle?: string;
  guideText?: string;
  manifestoTitle?: string;
  manifestoText?: string;
  bodyMediaTitle?: string;
  bodyMediaText?: string;
  whatsappLabel?: string;
  formFields?: readonly FormField[];
  careerAreas?: readonly ContentItem[];
  routePages?: readonly { href: string; label: string }[];
  servicesHeading?: string;
  contactHeading?: string;
  formButtonLabel?: string;
  methodSteps?: readonly ContentItem[];
  faq?: readonly { question: string; answer: string }[];
};
const routeHref = (routePath: string, anchorPath: string) => hasRoutePages ? routePath : anchorPath;
const servicesRoute = isTechnicalB2BSite ? '/solucoes' : '/servicos';
const productsRoute = isTechnicalB2BSite ? '/calculadora' : '/loja';
const productsLabel = optionalCopy.navProductsLabel || (isTechnicalB2BSite ? 'Calculadora' : 'Loja');
const productsHref = isTechnicalB2BSite ? routeHref('/calculadora', '#loja') : routeHref('/loja', '#loja');
const galleryRoute = isArchitectureSite || isTechnicalB2BSite ? '/projetos' : '/portfolio';
const blogRoute = isArchitectureSite ? '/insights' : '/blog';
const methodHref = isArchitectureSite ? routeHref('/processo', '#metodo') : '#metodo';
const services = copy.services;
const servicesHeading = optionalCopy.servicesHeading || 'Serviços';
const contactHeading = optionalCopy.contactHeading || 'Contato';
const formButtonLabel = optionalCopy.formButtonLabel || 'Enviar mensagem';
const primaryCtaHref = optionalCopy.ctaHref || routeHref('/contato', '#contato');
const headerCta = optionalCopy.headerCta || '';
const headerCtaHref = optionalCopy.headerCtaHref || primaryCtaHref;
const secondaryCta = optionalCopy.secondaryCta || '';
const secondaryCtaHref = optionalCopy.secondaryCtaHref || routeHref(servicesRoute, '#servicos');
const products = (optionalCopy.products || []) as readonly ContentItem[];
const productsHeading = optionalCopy.productsHeading || 'Produtos';
const blogPosts = (optionalCopy.blogPosts || []) as readonly ContentItem[];
const blogHeading = optionalCopy.blogHeading || 'Blog';
const galleryItems = (optionalCopy.galleryItems || []) as readonly ContentItem[];
const galleryHeading = optionalCopy.galleryHeading || 'Galeria';
const testimonials = (optionalCopy.testimonials || [{ title: 'Depoimento', quote: copy.testimonial }]) as readonly ContentItem[];
const differentials = (optionalCopy.differentials || []) as readonly ContentItem[];
const differentialsHeading = optionalCopy.differentialsHeading || 'Diferenciais';
const guideTitle = optionalCopy.guideTitle || '';
const guideText = optionalCopy.guideText || '';
const manifestoTitle = optionalCopy.manifestoTitle || '';
const manifestoText = optionalCopy.manifestoText || '';
const bodyMediaTitle = optionalCopy.bodyMediaTitle || '';
const bodyMediaText = optionalCopy.bodyMediaText || '';
const whatsappLabel = optionalCopy.whatsappLabel || '';
const careerAreas = (optionalCopy.careerAreas || []) as readonly ContentItem[];
const customRouteLinks = (optionalCopy.routePages || []) as readonly BlueprintNavLink[];
const formFields = optionalCopy.formFields || [
  { label: 'Nome', name: 'nome', type: 'text', placeholder: 'Seu nome' },
  { label: 'Email', name: 'email', type: 'email', placeholder: 'voce@email.com' },
  { label: 'Mensagem', name: 'mensagem', type: 'textarea', rows: 4, placeholder: 'Conte um pouco sobre o que precisa' },
];
const methodSteps = optionalCopy.methodSteps || [
  { title: 'Entendimento', description: 'Mapeamento rápido do contexto, prioridades e restrições do projeto.' },
  { title: 'Plano', description: 'Organização das frentes de trabalho em uma sequência clara e editável.' },
  { title: 'Acompanhamento', description: 'Ritmo de revisão para transformar a primeira versão em conteúdo final.' },
];
const faqs = optionalCopy.faq || [
  { question: 'A estrutura pode ser ajustada depois?', answer: 'Sim. As seções foram organizadas para receber refinamentos de conteúdo, imagem e prioridade sem recriar o projeto.' },
  { question: 'Como o contato é tratado?', answer: 'O bloco de contato centraliza os campos essenciais para qualificar interessados e orientar a próxima conversa comercial.' },
  { question: 'A página funciona em mobile?', answer: 'Sim. A composição usa grid responsivo, espaçamentos fluidos e hierarquia preparada para leitura em telas menores.' },
];
const navLinks = [
  { href: routeHref('/', '#inicio'), label: 'Início' },
  { href: routeHref(servicesRoute, '#servicos'), label: optionalCopy.navServicesLabel || servicesHeading },
  products.length ? { href: productsHref, label: productsLabel } : null,
  galleryItems.length ? { href: routeHref(galleryRoute, '#portfolio'), label: optionalCopy.navGalleryLabel || (isArchitectureSite || isTechnicalB2BSite ? 'Projetos' : 'Portfólio') } : null,
  blogPosts.length ? { href: routeHref(blogRoute, '#blog'), label: optionalCopy.navBlogLabel || (isArchitectureSite ? 'Insights' : 'Blog') } : null,
  differentials.length ? { href: '#diferenciais', label: 'Diferenciais' } : null,
  { href: routeHref('/sobre', '#sobre'), label: 'Sobre' },
  { href: methodHref, label: optionalCopy.navMethodLabel || 'Método' },
  { href: '#depoimentos', label: 'Depoimentos' },
  { href: '#faq', label: 'FAQ' },
  { href: routeHref('/contato', '#contato'), label: 'Contato' },
  ...customRouteLinks,
  careerAreas.length ? { href: routeHref('/trabalhe-conosco', '#contato'), label: 'Trabalhe Conosco' } : null,
]
  .filter((link): link is BlueprintNavLink => Boolean(link))
  .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);

export default function HomePage() {
  const fullBleedHero = layoutVariant === 'full_bleed_media' && Boolean(heroMedia);

  return (
    <main data-visual-grammar="${visualGrammarId || 'modular-editorial-default'}" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={${JSON.stringify(safeBrand)}} navLinks={navLinks} ctaLabel={headerCta} ctaHref={headerCtaHref} />

      <section
        id="inicio"
        className={
          fullBleedHero
            ? 'relative isolate min-h-[84vh] overflow-hidden px-5 py-24 text-white md:py-32'
            : 'mx-auto grid min-h-[72vh] w-full max-w-6xl content-center gap-10 overflow-hidden px-5 py-20 md:py-28${heroMedia ? ' lg:grid-cols-[1.08fr_0.92fr] lg:items-center' : ''}'
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
        <div className={fullBleedHero ? 'relative z-10 mx-auto grid min-h-[66vh] max-w-6xl min-w-0 content-center gap-7' : 'grid min-w-0 max-w-xs gap-7 sm:max-w-xl md:max-w-none'}>
          <p className={fullBleedHero ? 'text-sm font-black uppercase text-white/80' : 'text-sm font-black uppercase text-[var(--color-accent-dark)]'}>{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-none [overflow-wrap:anywhere] sm:max-w-xl sm:text-5xl lg:max-w-4xl lg:text-7xl">
            {copy.heroTitle}
          </h1>
          <p className={fullBleedHero ? 'max-w-xs break-words text-lg leading-8 text-white/80 [overflow-wrap:anywhere] sm:max-w-2xl' : 'max-w-xs text-lg leading-8 text-[var(--color-muted)] sm:max-w-xl md:max-w-2xl'}>
            {copy.heroText}
          </p>
          <div className={fullBleedHero ? 'grid max-w-xs gap-3 sm:flex sm:max-w-none sm:flex-wrap' : 'flex flex-wrap gap-3'}>
            <a className={fullBleedHero ? 'w-full min-w-0 max-w-full rounded-lg bg-white px-5 py-3 text-center font-black text-[#0f172a] shadow-sm sm:w-auto' : 'min-w-0 max-w-full rounded-lg bg-[var(--color-accent)] px-5 py-3 text-center font-black text-white shadow-sm'} href={primaryCtaHref}>
              {copy.cta}
            </a>
            {secondaryCta ? (
              <a className={fullBleedHero ? 'w-full min-w-0 max-w-full rounded-lg border border-white/50 px-5 py-3 text-center font-black text-white sm:w-auto' : 'min-w-0 max-w-full rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 text-center font-black text-[var(--color-ink)] shadow-sm'} href={secondaryCtaHref}>
                {secondaryCta}
              </a>
            ) : null}
          </div>
        </div>
        {!fullBleedHero && heroMedia ? (
          <figure className="min-w-0 max-w-xs overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[0_24px_70px_rgba(31,36,36,0.12)] sm:max-w-xl md:max-w-none">
            {heroMedia.kind === 'video' ? (
              <video className="aspect-[4/3] w-full object-cover" autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
                <source src={heroMedia.src} type="video/mp4" />
              </video>
            ) : (
              <img className="block aspect-[4/3] w-full object-cover" src={heroMedia.src} alt={heroMedia.alt} />
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
              <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
              <h3 className="text-xl font-black">{service.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
            </article>
          ))}
        </div>
      </section>

      {differentials.length ? (
        <section id="diferenciais" className="mx-auto max-w-6xl px-5 py-16">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Diferenciais</p>
            <h2 className="mt-3 text-4xl font-black">{differentialsHeading}</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {differentials.map((item) => (
              <article key={item.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
                <h3 className="text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {manifestoTitle || manifestoText ? (
        <section id="manifesto" className="bg-[var(--color-surface)] px-5 py-16">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Manifesto</p>
            {manifestoTitle ? <h2 className="mt-4 max-w-4xl text-4xl font-black leading-tight md:text-5xl">{manifestoTitle}</h2> : null}
            {manifestoText ? <p className="mt-6 max-w-4xl text-xl leading-9 text-[var(--color-muted)]">{manifestoText}</p> : null}
          </div>
        </section>
      ) : null}

      {bodyMediaTitle || bodyMediaText ? (
        <section id="video" className="px-5 py-16">
          <div className="mx-auto grid max-w-6xl overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-accent-dark)] text-white shadow-sm md:grid-cols-[1.05fr_0.95fr]">
            <div className="grid content-center gap-4 p-8 md:p-12">
              <p className="text-sm font-black uppercase text-white/70">Processo</p>
              {bodyMediaTitle ? <h2 className="text-4xl font-black leading-tight">{bodyMediaTitle}</h2> : null}
              {bodyMediaText ? <p className="text-lg leading-8 text-white/76">{bodyMediaText}</p> : null}
            </div>
            <div className="min-h-72 bg-black/20">
              {heroMedia ? (
                heroMedia.kind === 'video' ? (
                  <video className="h-full min-h-72 w-full object-cover" autoPlay muted loop playsInline poster={heroMedia.poster || undefined} aria-label={heroMedia.alt}>
                    <source src={heroMedia.src} type="video/mp4" />
                  </video>
                ) : (
                  <img className="h-full min-h-72 w-full object-cover" src={heroMedia.src} alt={heroMedia.alt} />
                )
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {galleryItems.length ? (
        <section id="portfolio" className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-4xl font-black">{galleryHeading}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {galleryItems.map((item) => (
              <article key={item.title} className="min-h-48 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
                <p className="text-xs font-black uppercase text-[var(--color-accent)]">Galeria</p>
                <h3 className="mt-5 text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {products.length ? (
        <section id="loja" className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-4xl font-black">{productsHeading}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <article key={product.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
                <h3 className="text-xl font-black">{product.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{product.description}</p>
                {'price' in product ? <p className="mt-5 font-black text-[var(--color-accent)]">{product.price}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {blogPosts.length ? (
        <section id="blog" className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-4xl font-black">{blogHeading}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {blogPosts.map((post) => (
              <article key={post.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
                <p className="text-xs font-black uppercase text-[var(--color-accent)]">{post.category}</p>
                <h3 className="mt-4 text-xl font-black">{post.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{post.excerpt}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

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

      {guideTitle ? (
        <section id="guia" className="mx-auto max-w-6xl px-5 py-16">
          <div className="rounded-lg border border-[var(--color-line)] bg-white p-8 shadow-sm md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-sm font-black uppercase text-[var(--color-accent)]">Guia gratuito</p>
              <h2 className="mt-3 text-3xl font-black">{guideTitle}</h2>
              <p className="mt-3 max-w-2xl leading-7 text-[var(--color-muted)]">{guideText}</p>
            </div>
            <a className="mt-6 inline-flex rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white md:mt-0" href={routeHref('/contato', '#contato')}>Receber guia</a>
          </div>
        </section>
      ) : null}

      <BlueprintTestimonialProof testimonials={testimonials} heading="Depoimentos" />

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
      <BlueprintFooterUtility brand={${JSON.stringify(safeBrand)}} summary={copy.metaDescription} navLinks={navLinks} contactHref={routeHref('/contato', '#contato')} />
      {whatsappLabel ? (
        <a className="fixed bottom-5 left-5 right-5 z-20 rounded-full bg-[var(--color-accent)] px-5 py-3 text-center text-sm font-black text-white shadow-lg sm:left-auto sm:w-auto" href={routeHref('/contato', '#contato')}>
          {whatsappLabel}
        </a>
      ) : null}
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
  --color-gold: #c89b5a;
  --color-line: ${theme.line};
}

* {
  box-sizing: border-box;
  min-width: 0;
}

*::before,
*::after {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

html,
body {
  max-width: 100%;
  overflow-x: hidden;
}

body {
  width: 100%;
  margin: 0;
  background: var(--color-bg);
  color: var(--color-ink);
  font-family: ${theme.typography.cssStack};
}

h1,
h2,
h3 {
  font-family: ${theme.typography.headingCssStack || theme.typography.cssStack};
}

a {
  text-decoration: none;
}

h1,
h2,
h3,
h4,
p,
a,
span,
strong,
button,
label,
summary,
li {
  overflow-wrap: anywhere;
}

img,
video,
svg,
input,
textarea,
select,
button {
  max-width: 100%;
}
`);
  const routeOperations = buildDomainRouteOperations({
    brand: safeBrand,
    copy,
    layoutRecipe: activeLayoutRecipe,
    contract,
  });

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
    ...routeOperations,
    { op: 'write_file', path: 'app/globals.css', content: globals },
    { op: 'write_file', path: 'README.md', content: `# ${safeBrand}\n\nComposição modular em Next.js App Router, React e Tailwind CSS.\n\n## Rodar localmente\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Próximas configurações\n\n- Revisar conteúdo, imagens, métricas e integrações antes da publicação.\n- Ajustar peças de layout: header, hero, seções e footer.\n- Conectar formulário ao backend escolhido.\n- Configurar variáveis em \`.env.local\` antes de integrações externas.\n` },
  ];
}


module.exports = {
  buildAtelierCatalogNextPage,
  buildChocolateSensoryNextPage,
  buildNextTailwindBlueprint,
};
