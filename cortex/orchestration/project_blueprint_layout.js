const { normalizeBlueprintText } = require('./project_blueprint_utils');
const {
  resolveBlueprintVisualGrammar,
} = require('./project_blueprint_visual_grammar');
const {
  isActiveTemporaryBlueprintContract,
} = require('./temporary_blueprint_contract_service');

function expandBlueprintHex(hex) {
  const value = String(hex || '').replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value.split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) return `#${value}`.toLowerCase();
  return '';
}

function darkenBlueprintHex(hex, amount = 0.22) {
  const normalized = expandBlueprintHex(hex);
  if (!normalized) return hex;
  const value = normalized.slice(1);
  const factor = Math.max(0, Math.min(1, 1 - Number(amount || 0)));
  const channels = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)]
    .map((part) => Number.parseInt(part, 16))
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor))));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function resolveBlueprintAccent(source = '') {
  const raw = String(source || '');
  const explicitHex = raw.match(/#[0-9a-fA-F]{3,6}\b/);
  if (explicitHex) return expandBlueprintHex(explicitHex[0]);

  const normalized = normalizeBlueprintText(raw);
  if (/\b(chocolate|cacau|cacao|marrom chocolate)\b/.test(normalized)) return '#3b1f14';
  if (/\bmarsala\b|\bvinho\b|\bbordo\b|\bbordô\b/.test(normalized)) return '#8f3447';
  if (/\bazul\s+marinho\b|\bmarinho\b/.test(normalized)) return '#0b1f3a';
  if (/\bazul\b/.test(normalized)) return '#3240a8';
  if (/\bvermelho\s+coral\b|\bcoral\b|\bvermelh/.test(normalized)) return '#cf416b';
  if (/\bdourado\b|\bouro\b/.test(normalized)) return '#c9a227';
  if (/\bpreto\b|\bescuro\b/.test(normalized)) return '#1f2424';
  if (/\bverde profundo\b|\bdeep green\b/.test(normalized)) return '#1f5a3d';
  if (/\bverde\b/.test(normalized)) return '#2f8f83';
  return '#2f8f83';
}

function resolveBlueprintTypography(source = '') {
  const normalized = normalizeBlueprintText(source);
  const options = [
    { regex: /\bassistant\b/, family: 'Assistant' },
    { regex: /\binter\b/, family: 'Inter' },
    { regex: /\bmanrope\b/, family: 'Manrope' },
    { regex: /\bmontserrat\b/, family: 'Montserrat' },
    { regex: /\bpoppins\b/, family: 'Poppins' },
    { regex: /\broboto\b/, family: 'Roboto' },
    { regex: /\bplayfair\b/, family: 'Playfair Display' },
    { regex: /\bcormorant\b/, family: 'Cormorant Garamond' },
    { regex: /\blibre baskerville\b/, family: 'Libre Baskerville' },
    { regex: /\blora\b/, family: 'Lora' },
  ];
  const explicit = options.find((option) => option.regex.test(normalized));
  const family = explicit ? explicit.family : 'Inter';
  return {
    family,
    importName: family.replace(/\s+/g, '+'),
    cssStack: `"${family}", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    headingFamily: family,
    headingCssStack: `"${family}", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
  };
}

function resolveBlueprintTypographyFromFamily(family = '') {
  const raw = String(family || '').trim();
  if (!raw) return null;
  return {
    family: raw,
    importName: raw.replace(/\s+/g, '+'),
    cssStack: `"${raw}", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    headingFamily: raw,
    headingCssStack: `"${raw}", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
  };
}

function buildGoogleFontHref(families = []) {
  const uniqueFamilies = Array.from(new Set(families.map((family) => String(family || '').trim()).filter(Boolean)));
  if (!uniqueFamilies.length) return '';
  const params = uniqueFamilies
    .map((family) => `family=${family.replace(/\s+/g, '+')}:wght@300;400;500;600;700;800;900`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

function resolveBlueprintTypographyFromContract(typography = {}) {
  if (!typography || typeof typography !== 'object') return null;
  const family = String(typography.family || '').trim();
  const headingFamily = String(typography.headingFamily || '').trim();
  if (!family && !headingFamily) return null;
  const bodyFamily = family || headingFamily;
  const titleFamily = headingFamily || bodyFamily;
  return {
    family: bodyFamily,
    headingFamily: titleFamily,
    importName: bodyFamily.replace(/\s+/g, '+'),
    cssStack: `"${bodyFamily}", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    headingCssStack: `"${titleFamily}", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    googleHref: buildGoogleFontHref([titleFamily, bodyFamily]),
  };
}

function inferBlueprintLayoutVariant(source = '', workingBrief = null) {
  const briefSource = workingBrief && workingBrief.source && typeof workingBrief.source === 'object'
    ? [workingBrief.source.current, workingBrief.source.consolidated, workingBrief.source.normalized].filter(Boolean).join(' ')
    : '';
  const normalized = normalizeBlueprintText([source, briefSource].filter(Boolean).join(' '));
  if (
    /full[-\s]?width|full[-\s]?bleed|hero[\s\S]{0,80}imagem[\s\S]{0,80}(full|inteira|largura)|imagem[\s\S]{0,80}full[-\s]?width|destaque visual forte|visual forte|imersiv/.test(
      normalized
    )
  ) {
    return 'full_bleed_media';
  }
  if (/\beditorial\b|\bmagazine\b|\bassimetr/.test(normalized)) return 'editorial';
  if (/\bcouro\b|\bcouros\b|\bartefatos? de couro\b|\bmarroquinaria\b|\bbolsas?\b|\bpastas?\b|\bcarteiras?\b/.test(normalized)) {
    return 'atelier_catalog';
  }
  return 'editorial_split';
}

const BLUEPRINT_LAYOUT_PIECE_INVENTORY = Object.freeze({
  version: 1,
  headers: [
    'sticky-simple',
    'atelier-minimal',
    'portfolio-minimal',
    'centered-brand',
    'split-nav',
  ],
  heroes: [
    'editorial-split',
    'editorial-statement',
    'full-bleed-media',
    'atelier-showcase',
    'statement-grid',
    'product-mosaic',
  ],
  bodySections: [
    'services-grid',
    'collection-grid',
    'about-stats',
    'icon-feature-grid',
    'material-story',
    'method-cards',
    'process',
    'craft-process',
    'technical-specs',
    'proof-strip',
    'products-grid',
    'blog-list',
    'gallery-grid',
    'lead-magnet',
    'testimonials',
    'calculator',
    'faq',
    'care-faq',
    'lead-form',
    'contact',
  ],
  footers: [
    'simple-footer',
    'atelier-footer',
    'compact-footer',
  ],
});

function buildBlueprintLayoutRecipe({ id, header, hero, bodySections = [], footer, source = 'default', domain = '', layoutVariant = '' }) {
  const visualGrammar = resolveBlueprintVisualGrammar({ domain, recipeId: id, layoutVariant });
  return {
    id,
    header,
    hero,
    bodySections,
    footer,
    source,
    visualGrammar,
    composition: {
      model: 'layout_piece_recipe',
      version: BLUEPRINT_LAYOUT_PIECE_INVENTORY.version,
      slots: ['visualGrammar', 'header', 'hero', 'bodySections', 'footer'],
      inventory: BLUEPRINT_LAYOUT_PIECE_INVENTORY,
    },
  };
}

function buildBlueprintModuleContract({ contract = {}, layoutRecipe = null, layoutVariant = '' } = {}) {
  const recipe = layoutRecipe && typeof layoutRecipe === 'object' ? layoutRecipe : {};
  const bodySections = Array.isArray(recipe.bodySections) ? recipe.bodySections : [];
  const temporaryBlueprintContract = contract && contract.temporaryBlueprintContract
    ? contract.temporaryBlueprintContract
    : null;
  const temporaryBlueprintActive = isActiveTemporaryBlueprintContract(temporaryBlueprintContract);
  return {
    schemaVersion: 'blueprint-module-contract-v1',
    status: temporaryBlueprintActive ? 'temporary_contract_resolved' : 'resolved_from_core_library',
    libraryScope: temporaryBlueprintActive ? 'temporary' : 'core',
    domain: contract && contract.domain ? contract.domain : '',
    temporaryBlueprintContract: temporaryBlueprintActive
      ? {
          schemaVersion: temporaryBlueprintContract.schemaVersion,
          status: temporaryBlueprintContract.status,
          domain: temporaryBlueprintContract.domain,
          source: temporaryBlueprintContract.source,
          activation: temporaryBlueprintContract.activation,
          memoryPolicy: temporaryBlueprintContract.memoryPolicy || null,
          requiredSections: Array.isArray(temporaryBlueprintContract.requiredSections)
            ? temporaryBlueprintContract.requiredSections.map((section) => section.id)
            : [],
          requiredPages: Array.isArray(temporaryBlueprintContract.requiredPages)
            ? temporaryBlueprintContract.requiredPages.map((page) => page.id)
            : [],
        }
      : null,
    layoutVariant,
    slots: {
      visualGrammar: recipe.visualGrammar && recipe.visualGrammar.id ? recipe.visualGrammar.id : '',
      header: recipe.header || '',
      hero: recipe.hero || '',
      bodySections,
      footer: recipe.footer || '',
    },
    visualGrammar: recipe.visualGrammar || null,
    inventoryVersion: BLUEPRINT_LAYOUT_PIECE_INVENTORY.version,
    visualContracts: {
      responsiveNavigation: {
        schemaVersion: 'blueprint-responsive-navigation-v1',
        status: 'required',
        appliesTo: ['home_page', 'route_pages'],
        mobileNavigation: 'hamburger',
        mobileUntil: 'lg',
        desktopNavigation: 'inline_links',
        desktopFrom: 'lg',
        hamburgerPlacement: 'header_right_absolute',
        overflowPolicy: 'no_horizontal_scroll',
      },
    },
    commitPolicy: {
      missingModuleGroup: 'suggest_blueprint',
      ledger: 'automata_contract_ledger',
      promotionFlow: ['suggest_blueprint', 'staged', 'trial_running', 'trial_passed', 'local_active'],
    },
  };
}

function resolveBlueprintLayoutRecipe({ source = '', contract = {}, layoutVariant = 'editorial_split', workingBrief = null } = {}) {
  const normalized = normalizeBlueprintText([
    source,
    workingBrief && workingBrief.source ? workingBrief.source.normalized || workingBrief.source.consolidated || '' : '',
  ].filter(Boolean).join(' '));
  const domain = contract && contract.domain ? contract.domain : '';
  const temporaryBlueprintContract = contract && contract.temporaryBlueprintContract
    ? contract.temporaryBlueprintContract
    : null;
  if (isActiveTemporaryBlueprintContract(temporaryBlueprintContract)) {
    const temporaryRecipe = temporaryBlueprintContract.layoutRecipe || {};
    return buildBlueprintLayoutRecipe({
      id: temporaryRecipe.id || 'temporary-contract-site',
      header: temporaryRecipe.header || 'sticky-simple',
      hero: temporaryRecipe.hero || (layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-split'),
      bodySections: Array.isArray(temporaryRecipe.bodySections) && temporaryRecipe.bodySections.length
        ? temporaryRecipe.bodySections
        : ['services-grid', 'about-stats', 'process', 'gallery-grid', 'testimonials', 'faq', 'contact'],
      footer: temporaryRecipe.footer || 'simple-footer',
      source: 'temporary_contract',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'photo-lab') {
    return buildBlueprintLayoutRecipe({
      id: 'photographic-lab-site',
      header: 'sticky-simple',
      hero: 'full-bleed-media',
      bodySections: ['services-grid', 'material-story', 'process', 'gallery-grid', 'testimonials', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'import-services') {
    return buildBlueprintLayoutRecipe({
      id: 'import-service-landing',
      header: 'sticky-simple',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-split',
      bodySections: ['services-grid', 'process', 'products-grid', 'proof-strip', 'testimonials', 'blog-list', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'sustainable-product-landing') {
    return buildBlueprintLayoutRecipe({
      id: 'consumer-product-catalog-landing',
      header: 'sticky-simple',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'product-mosaic',
      bodySections: ['icon-feature-grid', 'products-grid', 'material-story', 'proof-strip', 'testimonials', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'technical-b2b-services-site') {
    return buildBlueprintLayoutRecipe({
      id: 'technical-b2b-lead-site',
      header: 'sticky-simple',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-split',
      bodySections: ['services-grid', 'calculator', 'gallery-grid', 'process', 'blog-list', 'testimonials', 'faq', 'contact'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'premium-wine-landing') {
    return buildBlueprintLayoutRecipe({
      id: 'wine-sensory-landing',
      header: 'sticky-simple',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-split',
      bodySections: ['material-story', 'products-grid', 'icon-feature-grid', 'gallery-grid', 'proof-strip', 'testimonials', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'construction-materials-site') {
    return buildBlueprintLayoutRecipe({
      id: 'construction-materials-store-site',
      header: 'sticky-simple',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-split',
      bodySections: ['services-grid', 'products-grid', 'calculator', 'process', 'testimonials', 'faq', 'contact'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'saas-tool') {
    return buildBlueprintLayoutRecipe({
      id: 'saas-tool-landing',
      header: 'sticky-simple',
      hero: 'dashboard-workspace-preview',
      bodySections: ['services-grid', 'products-grid', 'process', 'testimonials', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'editorial-content') {
    return buildBlueprintLayoutRecipe({
      id: 'editorial-content-hub',
      header: 'portfolio-minimal',
      hero: 'editorial-statement',
      bodySections: ['blog-list', 'services-grid', 'products-grid', 'process', 'testimonials', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'architecture') {
    return buildBlueprintLayoutRecipe({
      id: 'architecture-studio-site',
      header: 'portfolio-minimal',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-statement',
      bodySections: ['services-grid', 'material-story', 'gallery-grid', 'process', 'blog-list', 'testimonials', 'faq', 'contact'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'chocolate') {
    return buildBlueprintLayoutRecipe({
      id: 'sensory-chocolate-landing',
      header: 'sticky-simple',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-split',
      bodySections: ['collection-grid', 'icon-feature-grid', 'process', 'gallery-grid', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'gardening') {
    return buildBlueprintLayoutRecipe({
      id: 'garden-service-commerce',
      header: 'sticky-simple',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-split',
      bodySections: ['services-grid', 'products-grid', 'blog-list', 'gallery-grid', 'about-stats', 'method-cards', 'lead-magnet', 'testimonials', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'wood-sculpture') {
    return buildBlueprintLayoutRecipe({
      id: 'wood-sculpture-atelier',
      header: 'atelier-minimal',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'atelier-showcase',
      bodySections: ['gallery-grid', 'products-grid', 'material-story', 'craft-process', 'blog-list', 'collection-grid', 'testimonials', 'faq', 'contact'],
      footer: 'atelier-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'leather-goods' || layoutVariant === 'atelier_catalog') {
    return buildBlueprintLayoutRecipe({
      id: 'artisan-commerce',
      header: 'atelier-minimal',
      hero: 'atelier-showcase',
      bodySections: ['collection-grid', 'material-story', 'craft-process', 'care-faq', 'contact'],
      footer: 'atelier-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (domain === 'greenhouses') {
    return buildBlueprintLayoutRecipe({
      id: 'agri-commercial-landing',
      header: 'sticky-simple',
      hero: layoutVariant === 'full_bleed_media' ? 'full-bleed-media' : 'editorial-split',
      bodySections: ['services-grid', 'about-stats', 'method-cards', 'testimonials', 'faq', 'lead-form'],
      footer: 'simple-footer',
      source: 'domain_recipe',
      domain,
      layoutVariant,
    });
  }
  if (layoutVariant === 'full_bleed_media') {
    return buildBlueprintLayoutRecipe({
      id: 'immersive-story',
      header: 'sticky-simple',
      hero: 'full-bleed-media',
      bodySections: ['services-grid', 'about-stats', 'method-cards', 'testimonials', 'faq', 'contact'],
      footer: 'simple-footer',
      source: 'layout_signal',
      domain,
      layoutVariant,
    });
  }
  if (/\bportfolio\b|\bgaleria\b|\bgallery\b/.test(normalized)) {
    return buildBlueprintLayoutRecipe({
      id: 'portfolio-gallery',
      header: 'portfolio-minimal',
      hero: 'statement-grid',
      bodySections: ['gallery-grid', 'proof-strip', 'process', 'contact'],
      footer: 'simple-footer',
      source: 'prompt_signal',
      domain,
      layoutVariant,
    });
  }
  return buildBlueprintLayoutRecipe({
    id: 'modular-starter',
    header: 'sticky-simple',
    hero: layoutVariant === 'editorial' ? 'editorial-statement' : 'editorial-split',
    bodySections: ['services-grid', 'about-stats', 'method-cards', 'testimonials', 'faq', 'contact'],
    footer: 'simple-footer',
    source: 'default',
    domain,
    layoutVariant,
  });
}

function resolveBlueprintTheme({ source = '', contract = {}, workingBrief = null } = {}) {
  const normalized = normalizeBlueprintText(source);
  const style = workingBrief && workingBrief.style && typeof workingBrief.style === 'object' ? workingBrief.style : {};
  const palette = style.palette && typeof style.palette === 'object' ? style.palette : {};
  const typographyContract = style.typography && typeof style.typography === 'object' ? style.typography : {};
  const domain = contract && contract.domain ? contract.domain : '';
  const accent = expandBlueprintHex(palette.primary || palette.imageColor || '') ||
    (domain === 'greenhouses'
      ? '#1f5a3d'
      : domain === 'chocolate'
        ? '#3b1f14'
        : domain === 'gardening'
          ? '#2f6b45'
          : domain === 'wood-sculpture'
            ? '#7a4a2a'
            : domain === 'import-services'
              ? '#0b1f3a'
              : domain === 'architecture'
                ? '#2f2f2d'
                : domain === 'sustainable-product-landing'
                  ? '#4d9f8f'
              : domain === 'technical-b2b-services-site'
                ? '#1e6f9f'
                : domain === 'premium-wine-landing'
                  ? '#7a1830'
                  : domain === 'construction-materials-site'
                    ? '#e26522'
                : domain === 'saas-tool'
                  ? '#2563eb'
                  : domain === 'editorial-content'
                    ? '#7c3aed'
                    : resolveBlueprintAccent(source));
  const wantsWhite = /\bbranco\b|\bwhite\b/.test(normalized);
  const wantsOffwhite = /\boff[-\s]?white\b|\bquase branco\b|\bmarfim\b|\bivory\b|\bamarelo alaranjado\b|\bcreme\b|\bcream\b/.test(normalized);
  const typography = resolveBlueprintTypographyFromContract(typographyContract) ||
    resolveBlueprintTypographyFromFamily(typographyContract.family) ||
    resolveBlueprintTypography(source);
  const bg = expandBlueprintHex(palette.background || '') ||
    (domain === 'chocolate'
      ? '#f7e7ce'
      : domain === 'gardening'
        ? '#f3f5ec'
        : domain === 'wood-sculpture'
          ? '#f4ede4'
          : domain === 'import-services'
            ? '#f4f7fb'
            : domain === 'architecture'
              ? '#f7f3ed'
                : domain === 'sustainable-product-landing'
                  ? '#f7f8f4'
                  : domain === 'technical-b2b-services-site'
                    ? '#f7f8f9'
                    : domain === 'premium-wine-landing'
                      ? '#f7efe3'
                      : domain === 'construction-materials-site'
                        ? '#f8fafc'
                  : domain === 'saas-tool'
                    ? '#f6f7fb'
                    : domain === 'editorial-content'
                      ? '#faf7ff'
                  : wantsOffwhite
                ? '#fcf7e3'
                : wantsWhite
                  ? '#ffffff'
                  : '#f7f6f1');

  const surface = expandBlueprintHex(palette.surface || '') ||
    (domain === 'chocolate'
      ? '#fff8f0'
      : domain === 'wood-sculpture'
        ? '#fffaf4'
        : domain === 'architecture'
          ? '#fffaf5'
          : domain === 'sustainable-product-landing' || domain === 'technical-b2b-services-site'
            ? '#ffffff'
            : domain === 'premium-wine-landing'
              ? '#fff8ef'
              : domain === 'construction-materials-site'
                ? '#ffffff'
            : domain === 'saas-tool' || domain === 'editorial-content'
              ? '#ffffff'
            : '#ffffff');
  const ink = expandBlueprintHex(palette.text || '') ||
    (domain === 'chocolate'
      ? '#1e0f0a'
      : domain === 'wood-sculpture'
        ? '#1f1712'
        : domain === 'import-services'
          ? '#162033'
          : domain === 'architecture'
            ? '#1e1e1c'
            : domain === 'sustainable-product-landing'
              ? '#172420'
              : domain === 'technical-b2b-services-site'
                ? '#111315'
                : domain === 'premium-wine-landing'
                  ? '#24150f'
                  : domain === 'construction-materials-site'
                    ? '#1e293b'
                : domain === 'saas-tool'
                  ? '#111827'
                  : domain === 'editorial-content'
                    ? '#231942'
                : '#1f2424');

  return {
    bg,
    surface,
    ink,
    muted: ink === '#2d2a29' && bg === '#f8f7f2'
      ? 'rgba(45, 42, 41, 0.72)'
      : 'rgba(31, 36, 36, 0.72)',
    accent,
    accentDark: darkenBlueprintHex(accent),
    line: 'rgba(31, 36, 36, 0.14)',
    headerBg: bg === '#ffffff'
      ? 'rgba(255, 255, 255, 0.92)'
      : bg === '#fcf7e3'
        ? 'rgba(252, 247, 227, 0.92)'
        : 'rgba(247, 246, 241, 0.92)',
    typography,
    domain: contract && contract.domain ? contract.domain : '',
  };
}


module.exports = {
  BLUEPRINT_LAYOUT_PIECE_INVENTORY,
  buildBlueprintLayoutRecipe,
  buildBlueprintModuleContract,
  inferBlueprintLayoutVariant,
  resolveBlueprintLayoutRecipe,
  resolveBlueprintTheme,
};
