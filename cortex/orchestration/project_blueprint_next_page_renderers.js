const {
  buildBrandContactEmail,
  renderNextHeroMediaDeclaration,
  renderNextResponsiveHeaderComponent,
} = require('./project_blueprint_template_utils');

function buildAtelierCatalogNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#colecoes', label: 'Coleções' },
  { href: '#materiais', label: 'Materiais' },
  { href: '#processo', label: 'Processo' },
  { href: '#cuidados', label: 'Cuidados' },
  { href: '#contato', label: 'Contato' },
] as const;

const collections = copy.services;
const methodSteps = ('methodSteps' in copy ? copy.methodSteps : []) as readonly { title: string; description: string }[];
const faqs = ('faq' in copy ? copy.faq : []) as readonly { question: string; answer: string }[];
const testimonials = ('testimonials' in copy ? copy.testimonials : [{ quote: copy.testimonial, name: brandName, role: 'Atelier' }]) as readonly { title?: string; quote?: string; name?: string; role?: string }[];

export default function HomePage() {
  return (
    <main data-visual-grammar="atelier-catalog-studio" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} position="static" />

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:grid-cols-[0.88fr_1.12fr] md:items-end md:py-24">
        <div className="grid gap-7">
          <p className="text-sm font-black uppercase text-[var(--color-accent-dark)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-3xl sm:text-5xl lg:text-7xl">
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
                <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
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

      <BlueprintTestimonialProof testimonials={testimonials} heading="Peças que atravessam o tempo" />

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

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription} navLinks={navLinks} contactHref="#contato" />
    </main>
  );
}
`;
}

function buildChocolateSensoryNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  const contactEmail = buildBrandContactEmail(brand);
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const contactEmail = ${JSON.stringify(contactEmail)} as const;
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#sobre', label: 'Sobre' },
  { href: '#produtos', label: 'Chocolates' },
  { href: '#processo', label: 'Processo' },
  { href: '#video', label: 'Vídeo' },
  { href: '#contato', label: 'Contato' },
] as const;

const products = copy.services;
const methodSteps = ('methodSteps' in copy ? copy.methodSteps : []) as readonly { title: string; description: string }[];
const testimonials = ('testimonials' in copy ? copy.testimonials : []) as readonly { title?: string; quote?: string; name?: string; role?: string }[];
const faqs = ('faq' in copy ? copy.faq : []) as readonly { question: string; answer: string }[];
const features = [
  {
    title: 'Cacau selecionado',
    description: 'Ingredientes de origem controlada para garantir sabor intenso e qualidade superior.',
  },
  {
    title: 'Produção artesanal',
    description: 'Cada receita é preparada com atenção aos detalhes e acabamento refinado.',
  },
  {
    title: 'Ingredientes naturais',
    description: 'Sabores puros, sem excessos, valorizando a essência do chocolate.',
  },
  {
    title: 'Experiência premium',
    description: 'Embalagens elegantes e chocolates ideais para presentear ou saborear.',
  },
] as const;

function HeroMedia({ className }: { className: string }) {
  if (!heroMedia) {
    return (
      <div className={className}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(200,155,90,0.42),transparent_32%),linear-gradient(135deg,#1e0f0a,#3b1f14_58%,#120804)]" />
        <div className="absolute bottom-[10%] right-[6%] h-[42%] w-[42%] max-w-[520px] opacity-90 max-md:bottom-[6%] max-md:right-[-12%] max-md:h-[32%] max-md:w-[64%]" aria-hidden="true">
          <div className="absolute inset-x-[12%] bottom-[6%] h-[64%] rotate-[-8deg] rounded-lg border border-white/10 bg-[linear-gradient(135deg,#5a2d1c,#24100a)] shadow-[0_34px_90px_rgba(0,0,0,0.38)]">
            <div className="grid h-full grid-cols-3 gap-2 p-4">
              {Array.from({ length: 9 }).map((_, index) => (
                <span key={index} className="rounded border border-white/8 bg-white/7 shadow-inner" />
              ))}
            </div>
          </div>
          <div className="absolute bottom-[16%] left-[2%] h-[42%] w-[34%] rotate-[10deg] rounded-lg border border-white/10 bg-[linear-gradient(145deg,#7b4126,#2b120b)] shadow-[0_24px_70px_rgba(0,0,0,0.34)]" />
          <div className="absolute right-[4%] top-[2%] h-24 w-24 rounded-full border border-[var(--color-gold)]/30 bg-[radial-gradient(circle_at_35%_35%,#c89b5a,#5a2d1c_62%,transparent_64%)] shadow-[0_18px_60px_rgba(0,0,0,0.34)] max-md:h-16 max-md:w-16" />
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
    <main data-visual-grammar="sensory-immersive-story" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} ctaLabel="Comprar agora" ctaHref="#produtos" tone="chocolate" position="fixed" />

      <section id="inicio" className="relative isolate min-h-screen overflow-hidden px-5 text-white">
        <HeroMedia className="absolute inset-0 z-0 h-full w-full object-cover" />
        <div className="absolute inset-0 z-[1] bg-[rgba(30,15,10,0.62)]" />
        <div className="relative z-10 mx-auto grid min-h-screen max-w-7xl min-w-0 content-center gap-7 pb-20 pt-44 md:pt-32">
          <p className="text-sm font-black uppercase text-[var(--color-gold)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
          <p className="max-w-2xl text-lg leading-8 text-white/82">{copy.heroText}</p>
          <div className="flex flex-wrap gap-3">
            <a className="max-w-full rounded-lg bg-[var(--color-gold)] px-5 py-3 text-center font-black text-[#1e0f0a] shadow-sm md:w-fit" href="#produtos">
              Explorar chocolates
            </a>
            <a className="max-w-full rounded-lg border border-white/30 bg-white/10 px-5 py-3 text-center font-black text-white backdrop-blur md:w-fit" href="#processo">
              Ver processo
            </a>
          </div>
        </div>
      </section>

      <section id="sobre" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.95fr_1.05fr] md:items-center">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">O sabor autêntico do cacau</p>
          <h2 className="mt-4 text-4xl font-black md:text-5xl">Criado para transformar cada pedaço em experiência.</h2>
        </div>
        <p className="text-lg leading-8 text-[var(--color-muted)]">{copy.about}</p>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-10">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <article key={feature.title} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
              <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} tone="chocolate" />
              <h3 className="text-xl font-black">{feature.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="video" className="bg-[var(--color-ink)] px-5 py-16 text-white md:py-20">
        <div className="mx-auto grid max-w-7xl gap-8">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase text-[var(--color-gold)]">{layoutRecipe.bodySections[2]}</p>
            <h2 className="mt-4 text-4xl font-black md:text-5xl">Veja como nasce o nosso chocolate</h2>
            <p className="mt-4 text-lg leading-8 text-white/76">Do grão ao tablete, cada etapa é pensada para preservar aroma, textura e intensidade.</p>
          </div>
          <div className="relative aspect-video overflow-hidden rounded-lg border border-white/14 bg-[#120804] shadow-[0_30px_90px_rgba(0,0,0,0.28)]">
            <HeroMedia className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-[rgba(30,15,10,0.16)]" />
          </div>
          <a className="w-fit rounded-lg bg-[var(--color-gold)] px-5 py-3 font-black text-[#1e0f0a]" href="#contato">
            Escolher meu chocolate
          </a>
        </div>
      </section>

      <section id="produtos" className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Sabores</p>
            <h2 className="text-4xl font-black">{copy.servicesHeading}</h2>
          </div>
          <p className="max-w-xl leading-7 text-[var(--color-muted)]">Escolha entre tabletes intensos, versões cremosas e bombons especiais para presentear ou saborear.</p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {products.map((item) => (
            <article key={item.title} className="grid min-h-72 min-w-0 content-between rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div>
                <h3 className="text-xl font-black">{item.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.description}</p>
              </div>
              <a className="mt-8 w-fit rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-black text-white" href="#contato">
                Ver detalhes
              </a>
            </article>
          ))}
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

      <BlueprintTestimonialProof testimonials={testimonials} heading="Experiências de quem escolhe cacau com cuidado." tone="chocolate" />

      <section className="bg-[var(--color-accent)] px-5 py-16 text-white">
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="text-4xl font-black">Um momento de prazer começa com o primeiro pedaço.</h2>
            <p className="mt-4 max-w-2xl leading-8 text-white/80">{copy.contactText}</p>
          </div>
          <a className="w-fit rounded-lg bg-[var(--color-gold)] px-5 py-3 font-black text-[#1e0f0a]" href="#contato">Comprar agora</a>
        </div>
      </section>

      <section id="contato" className="mx-auto grid max-w-7xl gap-6 px-5 py-16 md:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h2 className="text-4xl font-black">{copy.contactHeading}</h2>
          <p className="mt-4 leading-7 text-[var(--color-muted)]">{copy.contactText}</p>
        </div>
        <form className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm">
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Nome <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="nome" placeholder="Seu nome" /></label>
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Email <input className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="email" type="email" placeholder="voce@email.com" /></label>
          <label className="grid gap-2 font-bold text-[var(--color-muted)]">Mensagem <textarea className="rounded-lg border border-[var(--color-line)] px-3 py-3" name="mensagem" rows={4} placeholder="Conte o sabor, quantidade ou ocasião" /></label>
          <button className="w-fit rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" type="submit">{copy.formButtonLabel}</button>
        </form>
      </section>

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription + ' Atendimento: ' + contactEmail} navLinks={navLinks} contactHref="#contato" tone="chocolate" />
    </main>
  );
}
`;
}

function buildConsumerProductCatalogNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;
const navLinks = [
  { href: '#inicio', label: 'Início' },
  { href: '#beneficios', label: 'Benefícios' },
  { href: '#loja', label: 'Modelos' },
  { href: '#sustentabilidade', label: 'Sustentabilidade' },
  { href: '#depoimentos', label: 'Depoimentos' },
  { href: '#faq', label: 'FAQ' },
] as const;

type ContentItem = {
  title: string;
  description?: string;
  excerpt?: string;
  category?: string;
  price?: string;
  quote?: string;
  role?: string;
};
type FormField = {
  label: string;
  name: string;
  type?: string;
  rows?: number;
  placeholder?: string;
};

const benefits = copy.services as readonly ContentItem[];
const products = ('products' in copy ? copy.products : []) as readonly ContentItem[];
const differentiators = ('differentials' in copy ? copy.differentials : []) as readonly ContentItem[];
const testimonials = ('testimonials' in copy ? copy.testimonials : []) as readonly ContentItem[];
const faqs = ('faq' in copy ? copy.faq : []) as readonly { question: string; answer: string }[];
const formFields = copy.formFields as readonly FormField[];

function HeroMedia({ className }: { className: string }) {
  if (!heroMedia) {
    return (
      <div className={className}>
        <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#ffffff,#e4f6f1_48%,#cfece9)] p-8 text-center">
          <span className="text-sm font-black uppercase text-[var(--color-accent)]">Imagem premium do produto</span>
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
    <main data-visual-grammar="consumer-product-mosaic" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} ctaLabel={copy.cta} ctaHref="#loja" />

      <section id="inicio" className="mx-auto grid max-w-7xl gap-10 px-5 py-16 md:py-24 lg:grid-cols-[1.04fr_0.96fr] lg:items-center">
        <div className="grid gap-7">
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">{copy.heroEyebrow}</p>
          <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
          <p className="max-w-2xl text-lg leading-8 text-[var(--color-muted)]">{copy.heroText}</p>
          <div className="flex flex-wrap gap-3">
            <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href="#loja">{copy.cta}</a>
            <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href="#beneficios">{copy.secondaryCta}</a>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border-l-4 border-[var(--color-accent)] bg-white px-4 py-3 shadow-sm">
              <strong className="block text-2xl">{copy.statOneValue}</strong>
              <span className="text-sm leading-5 text-[var(--color-muted)]">{copy.statOneLabel}</span>
            </div>
            <div className="border-l-4 border-[var(--color-accent)] bg-white px-4 py-3 shadow-sm">
              <strong className="block text-2xl">{copy.statTwoValue}</strong>
              <span className="text-sm leading-5 text-[var(--color-muted)]">{copy.statTwoLabel}</span>
            </div>
            <div className="border-l-4 border-[var(--color-accent)] bg-white px-4 py-3 shadow-sm">
              <strong className="block text-2xl">Frete</strong>
              <span className="text-sm leading-5 text-[var(--color-muted)]">condição promocional para primeira compra</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <figure className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-white shadow-[0_28px_90px_rgba(23,36,32,0.12)]">
            <HeroMedia className="aspect-[4/3] w-full object-cover" />
            {heroMedia && heroMedia.attribution ? <figcaption className="px-3 py-2 text-xs text-[var(--color-muted)]">{heroMedia.attribution}</figcaption> : null}
          </figure>
          <div className="grid gap-3 sm:grid-cols-3">
            {products.slice(0, 3).map((product) => (
              <a key={product.title} className="rounded-lg border border-[var(--color-line)] bg-white p-4 shadow-sm" href="#loja">
                <span className="text-xs font-black uppercase text-[var(--color-accent)]">{product.category || 'Modelo'}</span>
                <strong className="mt-2 block text-sm">{product.title}</strong>
                <span className="mt-2 block text-sm font-black">{product.price}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="beneficios" className="border-y border-[var(--color-line)] bg-white px-5 py-10">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-5">
          {benefits.map((item, index) => (
            <article key={item.title} className="grid gap-3">
              <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
              <h2 className="text-lg font-black">{item.title}</h2>
              <p className="text-sm leading-6 text-[var(--color-muted)]">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="loja" className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Modelos</p>
            <h2 className="text-4xl font-black">{copy.productsHeading}</h2>
          </div>
          <p className="max-w-xl leading-7 text-[var(--color-muted)]">{copy.bodyMediaText}</p>
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {products.map((product, index) => (
            <article key={product.title} className="grid min-h-80 content-between rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <div>
                <span className="text-xs font-black uppercase text-[var(--color-accent)]">{product.category || String(index + 1).padStart(2, '0')}</span>
                <h3 className="mt-4 text-2xl font-black">{product.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{product.description}</p>
              </div>
              <div className="mt-8 flex items-center justify-between gap-4">
                <strong className="text-2xl">{product.price}</strong>
                <a className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-black text-white" href="#contato">Ver detalhes</a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="sobre" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.86fr_1.14fr] md:items-start">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Sobre o produto</p>
          <h2 className="mt-4 text-4xl font-black">{copy.bodyMediaTitle}</h2>
        </div>
        <p className="text-lg leading-8 text-[var(--color-muted)]">{copy.about}</p>
      </section>

      <section id="comparacao" className="bg-[var(--color-surface)] px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.86fr_1.14fr] lg:items-start">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Comparação</p>
            <h2 className="mt-4 text-4xl font-black">{copy.differentialsHeading}</h2>
            <p className="mt-5 leading-7 text-[var(--color-muted)]">{copy.manifestoText}</p>
          </div>
          <div className="grid gap-3">
            {differentiators.map((item) => (
              <article key={item.title} className="grid gap-2 rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm md:grid-cols-[0.42fr_0.58fr]">
                <h3 className="font-black">{item.title}</h3>
                <p className="leading-7 text-[var(--color-muted)]">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="sustentabilidade" className="px-5 py-16">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-lg bg-[var(--color-accent)] p-8 text-white md:grid-cols-[0.9fr_1.1fr] md:p-10">
          <div>
            <p className="text-sm font-black uppercase text-white/72">Sustentabilidade</p>
            <h2 className="mt-4 text-4xl font-black">{copy.manifestoTitle}</h2>
          </div>
          <p className="text-lg leading-8 text-white/84">{copy.manifestoText}</p>
        </div>
      </section>

      <BlueprintTestimonialProof testimonials={testimonials} heading="Quem usa, recomenda" />

      <section id="blog" className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Guia de compra</p>
            <h2 className="text-4xl font-black">Escolhas simples para uma rotina melhor.</h2>
          </div>
          <p className="max-w-xl leading-7 text-[var(--color-muted)]">Conteúdos rápidos para comparar capacidades, uso diário, limpeza e impacto ambiental antes da compra.</p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {products.map((product) => (
            <article key={product.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <span className="text-xs font-black uppercase text-[var(--color-accent)]">{product.category || 'Modelo'}</span>
              <h3 className="mt-3 text-xl font-black">{product.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{product.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="faq" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="text-sm font-black uppercase text-[var(--color-accent)]">Dúvidas</p>
          <h2 className="mt-4 text-4xl font-black">Antes de escolher sua garrafa.</h2>
        </div>
        <div className="grid gap-3">
          {faqs.map((item) => (
            <details key={item.question} className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer font-black">{item.question}</summary>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contato" className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-[0.85fr_1.15fr]">
        <div>
          <h2 className="text-4xl font-black">{copy.contactHeading}</h2>
          <p className="mt-4 text-lg leading-8 text-[var(--color-muted)]">{copy.contactText}</p>
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

function buildTechnicalB2BLeadNextPage({ brand, copy, heroMedia, iconSet, layoutVariant, layoutRecipe }) {
  return `const brandName = ${JSON.stringify(brand)} as const;
const copy = ${JSON.stringify(copy, null, 2)} as const;
${renderNextHeroMediaDeclaration(heroMedia)}
${renderNextResponsiveHeaderComponent()}
const serviceIcons = ${JSON.stringify(iconSet, null, 2)} as const;
const layoutVariant = ${JSON.stringify(layoutVariant)} as const;
const layoutRecipe = ${JSON.stringify(layoutRecipe, null, 2)} as const;
const servicesRoute = '/solucoes';
const calculatorRoute = '/calculadora';

type ContentItem = {
  title: string;
  description?: string;
  excerpt?: string;
  category?: string;
  price?: string;
  quote?: string;
  role?: string;
};
type FormField = {
  label: string;
  name: string;
  type?: string;
  rows?: number;
  placeholder?: string;
};

const services = copy.services as readonly ContentItem[];
const products = ('products' in copy ? copy.products : []) as readonly ContentItem[];
const galleryItems = ('galleryItems' in copy ? copy.galleryItems : []) as readonly ContentItem[];
const methodSteps = ('methodSteps' in copy ? copy.methodSteps : []) as readonly ContentItem[];
const blogPosts = ('blogPosts' in copy ? copy.blogPosts : []) as readonly ContentItem[];
const testimonials = ('testimonials' in copy ? copy.testimonials : []) as readonly ContentItem[];
const formFields = copy.formFields as readonly FormField[];
const navLinks = [
  { href: '/', label: 'Início' },
  { href: servicesRoute, label: 'Soluções' },
  { href: '/projetos', label: 'Projetos' },
  { href: calculatorRoute, label: 'Calculadora de Orçamento' },
  { href: '/blog', label: 'Blog' },
  { href: '/contato', label: 'Contato' },
] as const;

function HeroMedia({ className }: { className: string }) {
  if (!heroMedia) {
    return <div className={className}><div className="h-full bg-[linear-gradient(135deg,#111315,#252a2e_55%,#1e6f9f)]" /></div>;
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
    <main data-visual-grammar="technical-b2b-systems" className="min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      <BlueprintResponsiveHeader brand={brandName} navLinks={navLinks} ctaLabel="Solicitar orçamento" ctaHref="/contato" tone="dark" />

      <section id="inicio" className="bg-[#111315] px-5 py-16 text-white md:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div className="grid gap-7">
            <p className="text-sm font-black uppercase text-[#c8a45d]">{copy.heroEyebrow}</p>
            <h1 className="max-w-xs break-words text-3xl font-black leading-[0.98] [overflow-wrap:anywhere] sm:max-w-4xl sm:text-5xl lg:text-7xl">{copy.heroTitle}</h1>
            <p className="max-w-2xl text-lg leading-8 text-white/76">{copy.heroText}</p>
            <div className="flex flex-wrap gap-3">
              <a className="rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white shadow-sm" href="/contato">{copy.cta}</a>
              <a className="rounded-lg border border-white/18 bg-white/8 px-5 py-3 font-black text-white backdrop-blur" href={servicesRoute}>{copy.secondaryCta}</a>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[0.64fr_1.36fr] lg:items-stretch">
            <aside className="grid content-between rounded-lg border border-white/12 bg-white/8 p-5">
              <div>
                <p className="text-xs font-black uppercase text-[#c8a45d]">Operação</p>
                <strong className="mt-3 block text-4xl">{copy.statOneValue}</strong>
                <span className="text-sm leading-6 text-white/68">{copy.statOneLabel}</span>
              </div>
              <div className="mt-8">
                <strong className="block text-3xl">{copy.statTwoValue}</strong>
                <span className="text-sm leading-6 text-white/68">{copy.statTwoLabel}</span>
              </div>
            </aside>
            <figure className="overflow-hidden rounded-lg border border-white/12 bg-[#252a2e] shadow-[0_32px_100px_rgba(0,0,0,0.28)]">
              <HeroMedia className="aspect-[16/10] h-full w-full object-cover" />
              {heroMedia && heroMedia.attribution ? <figcaption className="px-3 py-2 text-xs text-white/58">{heroMedia.attribution}</figcaption> : null}
            </figure>
          </div>
        </div>
      </section>

      <section id="solucoes" className="mx-auto max-w-7xl px-5 py-16">
        <div className="grid gap-8 lg:grid-cols-[0.58fr_1.42fr]">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Matriz técnica</p>
            <h2 className="mt-4 text-4xl font-black">{copy.servicesHeading}</h2>
            <p className="mt-5 leading-7 text-[var(--color-muted)]">{copy.about}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {services.map((service, index) => (
              <article key={service.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <BlueprintIconBadge path={(serviceIcons[index] || serviceIcons[0]).path} />
                  <span className="text-xs font-black text-[var(--color-accent)]">{String(index + 1).padStart(2, '0')}</span>
                </div>
                <h3 className="mt-5 text-2xl font-black">{service.title}</h3>
                <p className="mt-3 leading-7 text-[var(--color-muted)]">{service.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="calculadora" className="bg-[#252a2e] px-5 py-16 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <p className="text-sm font-black uppercase text-[#c8a45d]">Calculadora de Orçamento</p>
            <h2 className="mt-4 text-4xl font-black md:text-5xl">Estimativa inicial com lógica técnica clara.</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/76">Área em m² × valor base da solução × acabamento × vidro. O orçamento final depende de visita técnica e especificações reais.</p>
          </div>
          <div className="rounded-lg border border-white/12 bg-white/8 p-6">
            <div className="grid gap-3 text-sm text-white/72">
              <span>1. Selecione solução e metragem</span>
              <span>2. Ajuste acabamento e vidro</span>
              <span>3. Envie para análise técnica</span>
            </div>
            <div className="mt-6 grid gap-3">
              {products.map((item) => (
                <div key={item.title} className="flex items-center justify-between gap-4 border-t border-white/12 pt-3 text-sm">
                  <span className="text-white/72">{item.title}</span>
                  <strong>{item.price}</strong>
                </div>
              ))}
            </div>
            <a className="mt-6 inline-flex rounded-lg bg-[var(--color-accent)] px-5 py-3 font-black text-white" href={calculatorRoute}>Acessar calculadora de orçamento</a>
          </div>
        </div>
      </section>

      <section id="projetos" className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase text-[var(--color-accent)]">Projetos</p>
            <h2 className="text-4xl font-black">{copy.galleryHeading}</h2>
          </div>
          <a className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-black text-[var(--color-ink)] shadow-sm" href="/projetos">Ver portfólio completo</a>
        </div>
        <div className="mt-8 grid gap-4">
          {galleryItems.map((project) => (
            <article key={project.title} className="grid gap-4 rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-sm md:grid-cols-[0.32fr_0.68fr] md:items-center">
              <div>
                <span className="text-xs font-black uppercase text-[var(--color-accent)]">{project.category}</span>
                <h3 className="mt-2 text-2xl font-black">{project.title}</h3>
              </div>
              <p className="leading-7 text-[var(--color-muted)]">{project.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="processo" className="border-y border-[var(--color-line)] bg-white px-5 py-16">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-black">Fluxo técnico de atendimento</h2>
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

      <BlueprintTestimonialProof testimonials={testimonials} heading="Prova de execução" />

      <section id="blog" className="mx-auto max-w-7xl px-5 py-16">
        <h2 className="text-4xl font-black">{copy.blogHeading}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {blogPosts.map((post) => (
            <article key={post.title} className="rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm">
              <span className="text-xs font-black uppercase text-[var(--color-accent)]">{post.category}</span>
              <h3 className="mt-3 text-xl font-black">{post.title}</h3>
              <p className="mt-3 leading-7 text-[var(--color-muted)]">{post.excerpt}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="contato" className="bg-[#111315] px-5 py-16 text-white">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.86fr_1.14fr]">
          <div>
            <p className="text-sm font-black uppercase text-[#c8a45d]">Contato</p>
            <h2 className="mt-4 text-4xl font-black">{copy.contactHeading}</h2>
            <p className="mt-5 text-lg leading-8 text-white/72">{copy.contactText}</p>
          </div>
          <form className="grid gap-4 rounded-lg border border-white/12 bg-white/8 p-6">
            {formFields.slice(0, 6).map((field) => (
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

      <BlueprintFooterUtility brand={brandName} summary={copy.metaDescription} navLinks={navLinks} contactHref="/contato" tone="dark" />
    </main>
  );
}
`;
}

module.exports = {
  buildAtelierCatalogNextPage,
  buildChocolateSensoryNextPage,
  buildConsumerProductCatalogNextPage,
  buildTechnicalB2BLeadNextPage,
};
