const { normalizeBlueprintText } = require('./project_blueprint_utils');

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
    { regex: /\binter\b/, family: 'Inter' },
    { regex: /\bmanrope\b/, family: 'Manrope' },
    { regex: /\bmontserrat\b/, family: 'Montserrat' },
    { regex: /\bpoppins\b/, family: 'Poppins' },
    { regex: /\broboto\b/, family: 'Roboto' },
    { regex: /\bplayfair\b/, family: 'Playfair Display' },
    { regex: /\blora\b/, family: 'Lora' },
  ];
  const explicit = options.find((option) => option.regex.test(normalized));
  const family = explicit ? explicit.family : 'Inter';
  return {
    family,
    importName: family.replace(/\s+/g, '+'),
    cssStack: `"${family}", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
  };
}

function resolveBlueprintTypographyFromFamily(family = '') {
  const raw = String(family || '').trim();
  if (!raw) return null;
  return {
    family: raw,
    importName: raw.replace(/\s+/g, '+'),
    cssStack: `"${raw}", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
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
  if (/\bcouro\b|\bcouros\b|\bartefatos? de couro\b|\bmarroquinaria\b|\bbolsas?\b|\bpastas?\b|\bartesanal\b|\bfeito a mao\b|\bproduto\b|\bcolecao\b|\bcolecoes\b|\bcat[aá]logo\b/.test(normalized)) {
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
    'gallery-grid',
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

function buildBlueprintLayoutRecipe({ id, header, hero, bodySections = [], footer, source = 'default' }) {
  return {
    id,
    header,
    hero,
    bodySections,
    footer,
    source,
    composition: {
      model: 'layout_piece_recipe',
      version: BLUEPRINT_LAYOUT_PIECE_INVENTORY.version,
      slots: ['header', 'hero', 'bodySections', 'footer'],
      inventory: BLUEPRINT_LAYOUT_PIECE_INVENTORY,
    },
  };
}

function buildBlueprintModuleContract({ contract = {}, layoutRecipe = null, layoutVariant = '' } = {}) {
  const recipe = layoutRecipe && typeof layoutRecipe === 'object' ? layoutRecipe : {};
  const bodySections = Array.isArray(recipe.bodySections) ? recipe.bodySections : [];
  return {
    schemaVersion: 'blueprint-module-contract-v1',
    status: 'resolved_from_core_library',
    libraryScope: 'core',
    domain: contract && contract.domain ? contract.domain : '',
    layoutVariant,
    slots: {
      header: recipe.header || '',
      hero: recipe.hero || '',
      bodySections,
      footer: recipe.footer || '',
    },
    inventoryVersion: BLUEPRINT_LAYOUT_PIECE_INVENTORY.version,
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
  if (domain === 'leather-goods' || layoutVariant === 'atelier_catalog') {
    return buildBlueprintLayoutRecipe({
      id: 'artisan-commerce',
      header: 'atelier-minimal',
      hero: 'atelier-showcase',
      bodySections: ['collection-grid', 'material-story', 'craft-process', 'care-faq', 'contact'],
      footer: 'atelier-footer',
      source: 'domain_recipe',
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
    });
  }
  return buildBlueprintLayoutRecipe({
    id: 'modular-starter',
    header: 'sticky-simple',
    hero: layoutVariant === 'editorial' ? 'editorial-statement' : 'editorial-split',
    bodySections: ['services-grid', 'about-stats', 'method-cards', 'testimonials', 'faq', 'contact'],
    footer: 'simple-footer',
    source: 'default',
  });
}

function resolveBlueprintTheme({ source = '', contract = {}, workingBrief = null } = {}) {
  const normalized = normalizeBlueprintText(source);
  const style = workingBrief && workingBrief.style && typeof workingBrief.style === 'object' ? workingBrief.style : {};
  const palette = style.palette && typeof style.palette === 'object' ? style.palette : {};
  const typographyContract = style.typography && typeof style.typography === 'object' ? style.typography : {};
  const accent = expandBlueprintHex(palette.primary || palette.imageColor || '') || (contract && contract.domain === 'greenhouses' ? '#1f5a3d' : resolveBlueprintAccent(source));
  const wantsWhite = /\bbranco\b|\bwhite\b/.test(normalized);
  const wantsOffwhite = /\boff[-\s]?white\b|\bquase branco\b|\bmarfim\b|\bivory\b|\bamarelo alaranjado\b|\bcreme\b|\bcream\b/.test(normalized);
  const typography = resolveBlueprintTypographyFromFamily(typographyContract.family) || resolveBlueprintTypography(source);
  const bg = expandBlueprintHex(palette.background || '') || (wantsOffwhite ? '#fcf7e3' : wantsWhite ? '#ffffff' : '#f7f6f1');

  return {
    bg,
    surface: '#ffffff',
    ink: '#1f2424',
    muted: '#66706d',
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
