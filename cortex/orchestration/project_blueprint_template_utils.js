function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value = '') {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function compactBlueprintText(value = '', max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function normalizeBlueprintMediaAssets(mediaAssets = {}) {
  const hero = mediaAssets && typeof mediaAssets === 'object' ? mediaAssets.hero : null;
  if (!hero || typeof hero !== 'object') return { hero: null };
  const src = String(hero.src || '').trim();
  const safeSrc = /^https?:\/\//i.test(src) || /^data:image\//i.test(src) || src.startsWith('/');
  if (!src || !safeSrc) return { hero: null };
  const kind = String(hero.kind || '').toLowerCase() === 'video' ? 'video' : 'photo';
  return {
    hero: {
      kind,
      provider: String(hero.provider || 'pexels').trim(),
      query: compactBlueprintText(hero.query || ''),
      src,
      poster: String(hero.poster || '').trim(),
      alt: compactBlueprintText(hero.alt || hero.query || 'Imagem contextual do projeto'),
      attribution: compactBlueprintText(hero.attribution || ''),
      photographer: compactBlueprintText(hero.photographer || ''),
      photographerUrl: String(hero.photographerUrl || '').trim(),
      sourceUrl: String(hero.sourceUrl || '').trim(),
    },
  };
}

function renderNextHeroMediaDeclaration(heroMedia = null) {
  return `type BlueprintHeroMedia = {
  kind: 'photo' | 'video';
  provider?: string;
  query?: string;
  src: string;
  poster?: string;
  alt: string;
  attribution?: string;
  photographer?: string;
  photographerUrl?: string;
  sourceUrl?: string;
};

const heroMedia: BlueprintHeroMedia | null = ${JSON.stringify(heroMedia, null, 2)};`;
}

function renderNextResponsiveHeaderComponent() {
  return `type BlueprintNavLink = {
  href: string;
  label: string;
};

type BlueprintElementTone = 'light' | 'dark' | 'chocolate' | 'gold';
type BlueprintTestimonialItem = {
  title?: string;
  quote?: string;
  description?: string;
  name?: string;
  role?: string;
};

function BlueprintIconBadge({ path, tone = 'light' }: { path: string; tone?: BlueprintElementTone }) {
  const darkTone = tone === 'dark' || tone === 'chocolate';
  const goldTone = tone === 'gold' || tone === 'chocolate';
  const badgeClass = [
    'mb-5 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border',
    darkTone
      ? 'border-white/16 bg-white/10 text-white'
      : goldTone
        ? 'border-[var(--color-gold)]/30 bg-[var(--color-gold)]/12 text-[var(--color-gold)]'
        : 'border-[var(--color-line)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
  ].join(' ');

  return (
    <span data-blueprint-element="icon-badge" className={badgeClass} aria-hidden="true">
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
  );
}

function BlueprintTestimonialProof({
  testimonials,
  heading = 'Depoimentos',
  eyebrow = 'Prova social',
  tone = 'light',
}: {
  testimonials: readonly BlueprintTestimonialItem[];
  heading?: string;
  eyebrow?: string;
  tone?: BlueprintElementTone;
}) {
  const darkTone = tone === 'dark' || tone === 'chocolate';
  const sectionClass = darkTone
    ? 'border-y border-white/12 bg-[var(--color-ink)] px-5 py-16 text-white'
    : 'border-y border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-16';
  const cardClass = darkTone
    ? 'rounded-lg border border-white/12 bg-white/8 p-6 shadow-sm'
    : 'rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm';
  const featureCardClass = darkTone
    ? 'rounded-lg border border-white/12 bg-white/10 p-6 shadow-sm md:col-span-2'
    : 'rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-sm md:col-span-2';
  const mutedClass = darkTone ? 'text-white/72' : 'text-[var(--color-muted)]';
  const accentClass = tone === 'chocolate' || tone === 'gold' ? 'text-[var(--color-gold)]' : 'text-[var(--color-accent)]';

  return (
    <section id="depoimentos" data-blueprint-element="testimonial-proof" className={sectionClass}>
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.62fr_1.38fr] lg:items-start">
        <div>
          <p className={\`text-sm font-black uppercase \${accentClass}\`}>{eyebrow}</p>
          <h2 className="mt-4 max-w-xl text-4xl font-black leading-tight">{heading}</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {testimonials.map((item, index) => {
            const quote = item.quote || item.description || item.title || '';
            const name = item.name || item.title || 'Cliente';
            return (
              <blockquote key={item.quote || item.name || item.title || String(index)} className={index === 0 ? featureCardClass : cardClass}>
                <span className={\`block text-3xl font-black leading-none \${accentClass}\`} aria-hidden="true">"</span>
                <p className={\`mt-3 text-lg leading-8 \${mutedClass}\`}>"{quote}"</p>
                <footer className="mt-5 text-sm leading-6">
                  <strong className={darkTone ? 'block text-white' : 'block text-[var(--color-ink)]'}>{name}</strong>
                  {item.role ? <span className={accentClass}>{item.role}</span> : null}
                </footer>
              </blockquote>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BlueprintFooterUtility({
  brand,
  summary,
  navLinks,
  contactHref = '#contato',
  tone = 'light',
  backgroundColor = '',
}: {
  brand: string;
  summary: string;
  navLinks: readonly BlueprintNavLink[];
  contactHref?: string;
  tone?: BlueprintElementTone;
  backgroundColor?: string;
}) {
  const customBackgroundColor = backgroundColor.trim();
  const darkTone = !customBackgroundColor && (tone === 'dark' || tone === 'chocolate');
  const footerClass = customBackgroundColor
    ? 'border-t border-[var(--color-line)] px-5 py-12 text-[var(--color-ink)]'
    : darkTone
    ? 'bg-[var(--color-ink)] px-5 py-12 text-white'
    : 'border-t border-[var(--color-line)] bg-[var(--color-bg)] px-5 py-12';
  const mutedClass = darkTone ? 'text-white/68' : 'text-[var(--color-muted)]';
  const linkClass = darkTone ? 'text-white/78 hover:text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]';
  const pillClass = darkTone
    ? 'rounded-full border border-white/14 px-3 py-2 text-white/78'
    : 'rounded-full border border-[var(--color-line)] bg-white px-3 py-2 text-[var(--color-muted)]';

  return (
    <footer data-blueprint-element="footer-utility-grid" className={footerClass} style={customBackgroundColor ? { backgroundColor: customBackgroundColor } : undefined}>
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.15fr_0.85fr] lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
        <div>
          <strong className={darkTone ? 'text-xl text-white' : 'text-xl text-[var(--color-ink)]'}>{brand}</strong>
          <p className={\`mt-3 max-w-xl text-sm leading-6 \${mutedClass}\`}>{summary}</p>
        </div>
        <nav className={\`grid gap-2 text-sm font-bold \${linkClass}\`} aria-label="Links de rodapé">
          {navLinks.slice(0, 6).map((link) => (
            <a key={link.href} className="leading-5 [overflow-wrap:anywhere]" href={link.href}>{link.label}</a>
          ))}
        </nav>
        <div className={\`text-sm leading-6 \${mutedClass}\`}>
          <h3 className={darkTone ? 'font-black text-white' : 'font-black text-[var(--color-ink)]'}>Atendimento</h3>
          <a className={\`mt-3 block font-bold \${linkClass}\`} href={contactHref}>WhatsApp</a>
          <a className={\`mt-2 block font-bold \${linkClass}\`} href={contactHref}>Contato</a>
        </div>
        <div>
          <h3 className={darkTone ? 'font-black text-white' : 'font-black text-[var(--color-ink)]'}>Social</h3>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
            <a className={pillClass} href={contactHref}>Instagram</a>
            <a className={pillClass} href={contactHref}>LinkedIn</a>
            <a className={pillClass} href={contactHref}>YouTube</a>
          </div>
        </div>
      </div>
      <p className={\`mx-auto mt-10 max-w-7xl border-t pt-5 text-sm \${darkTone ? 'border-white/10 text-white/52' : 'border-[var(--color-line)] text-[var(--color-muted)]'}\`}>© 2026 {brand}. Todos os direitos reservados.</p>
    </footer>
  );
}

function BlueprintResponsiveHeader({
  brand,
  navLinks,
  ctaLabel = '',
  ctaHref = '',
  tone = 'light',
  position = 'sticky',
}: {
  brand: string;
  navLinks: readonly BlueprintNavLink[];
  ctaLabel?: string;
  ctaHref?: string;
  tone?: 'light' | 'dark' | 'chocolate';
  position?: 'static' | 'sticky' | 'fixed';
}) {
  const darkTone = tone === 'dark' || tone === 'chocolate';
  const headerClass = [
    position === 'fixed' ? 'fixed left-0 right-0 top-0' : position === 'sticky' ? 'sticky top-0' : '',
    'z-20 border-b backdrop-blur',
    tone === 'chocolate'
      ? 'border-white/12 bg-[rgba(30,15,10,0.78)] text-white'
      : tone === 'dark'
        ? 'border-white/10 bg-[#111315]/94 text-white'
        : 'border-[var(--color-line)] bg-[var(--color-bg)]/92 text-[var(--color-ink)]',
  ].filter(Boolean).join(' ');
  const mutedLinkClass = darkTone ? 'text-white/76 hover:text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]';
  const menuButtonClass = darkTone
    ? 'inline-flex h-11 w-11 shrink-0 cursor-pointer list-none items-center justify-center rounded-lg border border-white/18 bg-white/8 text-white lg:hidden [&::-webkit-details-marker]:hidden'
    : 'inline-flex h-11 w-11 shrink-0 cursor-pointer list-none items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] lg:hidden [&::-webkit-details-marker]:hidden';
  const panelClass = darkTone
    ? 'absolute right-0 top-12 z-30 grid max-h-[calc(100vh-5rem)] w-64 max-w-[calc(100vw-2rem)] gap-2 overflow-y-auto rounded-lg border border-white/16 bg-[#111315] p-3 text-sm font-bold text-white shadow-2xl'
    : 'absolute right-0 top-12 z-30 grid max-h-[calc(100vh-5rem)] w-64 max-w-[calc(100vw-2rem)] gap-2 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm font-bold text-[var(--color-ink)] shadow-2xl';
  const ctaClass = tone === 'chocolate'
    ? 'bg-[var(--color-gold)] text-[#1e0f0a]'
    : 'bg-[var(--color-accent)] text-white';

  return (
    <header data-blueprint-element="responsive-header" className={headerClass}>
      <div className="relative mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-4 px-5 py-4">
        <a className="min-w-0 max-w-[calc(100vw-7.5rem)] break-words pr-14 text-lg font-black leading-tight lg:max-w-none lg:pr-0" href={navLinks[0]?.href || '#inicio'}>
          {brand}
        </a>
        <details className="group absolute right-5 top-1/2 shrink-0 -translate-y-1/2 lg:hidden">
          <summary className={menuButtonClass} aria-label="Abrir menu de navegação">
            <span className="grid gap-1.5" aria-hidden="true">
              <span className="block h-0.5 w-5 rounded bg-current" />
              <span className="block h-0.5 w-5 rounded bg-current" />
              <span className="block h-0.5 w-5 rounded bg-current" />
            </span>
          </summary>
          <nav className={panelClass} aria-label="Navegação principal mobile">
            {navLinks.map((link) => (
              <a key={link.href} className="rounded px-3 py-2 leading-5 [overflow-wrap:anywhere] hover:bg-current/10" href={link.href}>
                {link.label}
              </a>
            ))}
            {ctaLabel && ctaHref ? (
              <a className={\`mt-1 rounded-lg px-4 py-3 text-center font-black whitespace-nowrap \${ctaClass}\`} href={ctaHref}>
                {ctaLabel}
              </a>
            ) : null}
          </nav>
        </details>
        <nav className={\`hidden max-w-full flex-wrap items-center gap-x-5 gap-y-2 text-sm font-bold lg:flex \${mutedLinkClass}\`} aria-label="Navegação principal">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        {ctaLabel && ctaHref ? (
          <a className={\`hidden shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-black lg:inline-flex \${ctaClass}\`} href={ctaHref}>
            {ctaLabel}
          </a>
        ) : null}
      </div>
    </header>
  );
}`;
}

function buildBrandContactEmail(brand = '') {
  const slug = String(brand || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  return `contato@${slug || 'projeto'}.com.br`;
}

function renderHeroMediaHtml(heroMedia = null) {
  if (!heroMedia || !heroMedia.src) return '';
  const attribution = heroMedia.attribution
    ? `<p class="media-credit">${escapeHtml(heroMedia.attribution)}</p>`
    : '';
  if (heroMedia.kind === 'video') {
    const poster = heroMedia.poster ? ` poster="${escapeAttribute(heroMedia.poster)}"` : '';
    return `<figure class="hero-media">
        <video autoplay muted loop playsinline${poster} aria-label="${escapeAttribute(heroMedia.alt)}">
          <source src="${escapeAttribute(heroMedia.src)}" type="video/mp4">
        </video>
        ${attribution}
      </figure>`;
  }
  return `<figure class="hero-media">
        <img src="${escapeAttribute(heroMedia.src)}" alt="${escapeAttribute(heroMedia.alt)}" loading="lazy">
        ${attribution}
      </figure>`;
}


module.exports = {
  buildBrandContactEmail,
  compactBlueprintText,
  escapeAttribute,
  escapeHtml,
  normalizeBlueprintMediaAssets,
  renderNextHeroMediaDeclaration,
  renderNextResponsiveHeaderComponent,
  renderHeroMediaHtml,
};
