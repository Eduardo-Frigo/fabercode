const { normalizeBriefingContractText } = require('./briefing_contract_service');
const { stripNegatedIntentClauses } = require('./execution_intent');

const VISUAL_PRODUCT_COVERAGE_SCHEMA_VERSION = 'visual-product-coverage-v1';
const DEFAULT_MIN_PRODUCT_COVERAGE_SCORE = 78;

const SECTION_PATTERNS = {
  productsStore: [
    /\bloja\b/,
    /\bproduto\b/,
    /\bprodutos\b/,
    /\bcatalogo\b/,
    /\becommerce\b/,
    /\bshop\b/,
    /\bobras disponiveis\b/,
    /\bpecas prontas\b/,
    /\bsabores\b/,
    /\bcolecao\b/,
    /\btipos de importacao\b/,
    /\btipos de importação\b/,
    /\bproduto que deseja importar\b/,
    /\bcotacao internacional\b/,
    /\bcotação internacional\b/,
  ],
  blog: [
    /\bblog\b/,
    /\bartigo\b/,
    /\bartigos\b/,
    /\bposts\b/,
    /\bconteudo\b/,
    /\bconteudos\b/,
    /\bconteúdo\b/,
    /\bconteúdos\b/,
    /\breflexao\b/,
    /\breflexoes\b/,
    /\breflexão\b/,
    /\breflexões\b/,
    /\bconteudo educativo\b/,
    /\bseo\b/,
    /\bguia\b/,
    /\binsights\b/,
    /\bguias de importacao\b/,
    /\bguias de importação\b/,
  ],
  galleryPortfolio: [
    /\bgaleria\b/,
    /\bportfolio\b/,
    /\bportf[oó]lio\b/,
    /\bprojetos realizados\b/,
    /\bprojetos selecionados\b/,
    /\bprojetos autorais\b/,
    /\bobras selecionadas\b/,
    /\bantes e depois\b/,
    /\boperacoes acompanhadas\b/,
    /\boperações acompanhadas\b/,
    /\bcases\b/,
  ],
  testimonials: [
    /\bdepoimentos\b/,
    /\bdepoimento\b/,
    /\btestimonials\b/,
    /\bavaliacoes\b/,
    /\bclientes\b/,
    /\bcliente\b/,
  ],
  contactForm: [
    /\bcontato\b/,
    /\bformulario\b/,
    /\bwhatsapp\b/,
    /\bemail\b/,
    /\borcamento\b/,
    /\bfale conosco\b/,
    /\bencomenda\b/,
    /\bcotacao\b/,
    /\bcotação\b/,
    /\bproduto que deseja importar\b/,
    /\btipo de projeto\b/,
  ],
  footer: [
    /\bfooter\b/,
    /\brodape\b/,
    /\bredes sociais\b/,
    /\binstagram\b/,
    /\bfacebook\b/,
    /\blinkedin\b/,
    /\byoutube\b/,
    /\btiktok\b/,
    /\btodos os direitos\b/,
  ],
};

const CTA_PATTERNS = [
  /\bcta\b/,
  /\bbotao\b/,
  /\bcomprar\b/,
  /\bsolicitar\b/,
  /\borcamento\b/,
  /\bagendar\b/,
  /\bfalar com\b/,
  /\bentrar em contato\b/,
  /\bconhecer\b/,
  /\bexplorar\b/,
  /\bver\b/,
  /\bencomendar\b/,
  /\bassinar\b/,
];

const SITE_SURFACE_PATTERNS = [
  /\bsite\b/,
  /\blanding\b/,
  /\bpagina\b/,
  /\bhome\b/,
  /\bweb\b/,
  /\bsite completo\b/,
  /\bpresenca digital\b/,
];

const OPERATIONAL_TOOL_PATTERNS = [
  /\b(app|aplicacao|aplicação|ferramenta|sistema|plataforma|painel operacional)\b/,
  /\b(mrp|erp|crm|ide|kanban|cadastro|estoque|bom|ordens?|ordens de producao|ordens de produção)\b/,
  /\b(audit log|auditoria|maquina de estados|máquina de estados|calculo deterministico|cálculo determinístico)\b/,
  /\b(tabela|acoes|ações|formularios|formulários|interface tecnica|interface técnica)\b/,
];

const GENERIC_VISIBLE_PLACEHOLDER_PATTERNS = [
  /\batendimento placeholder premium\b/,
  /\bconteudo provisorio\b/,
  /\bpronta para evoluir\b/,
  /\bpronta para receber conteudo real\b/,
  /\bfaber projeto\b/,
  /\bescritorio faber advocacia\b/,
  /\bstudio habitat\b/,
  /\bhelena duarte arquitetura\b/,
  /\barquitetura contemporanea para espacos com identidade\b/,
  /\buma presenca digital clara para transformar visitantes em contatos\b/,
  /\beste conteudo e definitivo\b/,
  /\bo formulario ja envia dados\b/,
  /\bsatisfacao placeholder\b/,
  /\banos de experiencia simulada\b/,
];

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeProductCoverageText(value = '') {
  return normalizeBriefingContractText(value);
}

function compact(value = '', max = 900) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function hasAnyPattern(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(String(text || '')));
}

function inferSnapshotPageKey(pageSnapshot = {}) {
  const source = normalizeProductCoverageText([
    pageSnapshot && pageSnapshot.url ? pageSnapshot.url : '',
    pageSnapshot && pageSnapshot.title ? pageSnapshot.title : '',
    pageSnapshot && pageSnapshot.bodyText ? String(pageSnapshot.bodyText).slice(0, 1200) : '',
  ].join(' '));
  if (/\b(contato|contact)\.html\b|\b\/contato\b/.test(source)) return 'contact';
  if (/\b(conteudos|conteúdos|conteudo|conteúdo|blog|artigos)\.html\b|\b\/(conteudos|conteudo|blog|artigos)\b/.test(source)) return 'blog';
  if (/\b(produtos|produto|catalogo|cat[aá]logo|loja)\.html\b|\b\/(produtos|produto|catalogo|loja)\b/.test(source)) return 'productsStore';
  if (/\b(portfolio|portf[oó]lio|galeria|projetos)\.html\b|\b\/(portfolio|galeria|projetos)\b/.test(source)) return 'galleryPortfolio';
  if (/\b(depoimentos|testimonials)\.html\b|\b\/(depoimentos|testimonials)\b/.test(source)) return 'testimonials';
  return 'home';
}

function isMultipageSiteSource(source = '') {
  return hasAnyPattern(normalizeProductCoverageText(source), [
    /\b(multipagina|multi pagina|m[uú]ltiplas paginas|m[uú]ltiplas p[aá]ginas)\b/,
    /\bp[aá]ginas reais obrigat[oó]rias\b/,
    /\brotas?\s*\/?\s*p[aá]ginas obrigat[oó]rias\b/,
    /\bindex\.html\b[\s\S]{0,500}\b(contato|conteudos|conteúdos|jornada|premissas)\.html\b/,
  ]);
}

function isOperationalToolSource(source = '', { explicitSiteSurface = false, fullSite = false } = {}) {
  const normalized = normalizeProductCoverageText(source);
  if (!hasAnyPattern(normalized, OPERATIONAL_TOOL_PATTERNS)) return false;
  if (fullSite) return false;
  if (explicitSiteSurface && hasAnyPattern(normalized, [/\blanding\b/, /\bsite completo\b/, /\bpresenca digital\b/])) {
    return false;
  }
  return true;
}

function isHomeScopedRequirement(source = '', patterns = []) {
  const normalized = normalizeProductCoverageText(source);
  const homeBlocks = normalized.match(/\b(home|inicio|in[ií]cio|pagina 1|p[aá]gina 1)\b[\s\S]{0,900}/g) || [];
  return homeBlocks.some((block) => hasAnyPattern(block, patterns));
}

function applySnapshotScopeToCoverageExpectations(expectations = {}, pageSnapshot = null) {
  if (!pageSnapshot || typeof pageSnapshot !== 'object') return expectations;
  const source = String(expectations.source || '');
  const pageKey = inferSnapshotPageKey(pageSnapshot);
  if (!isMultipageSiteSource(source)) {
    return {
      ...expectations,
      scope: { multipage: false, pageKey },
    };
  }

  const scoped = {
    ...expectations,
    required: {
      ...(expectations.required || {}),
    },
    scope: { multipage: true, pageKey, relaxed: [] },
  };
  const sourceForHome = normalizeProductCoverageText(source);
  const sectionScopes = {
    productsStore: [
      SECTION_PATTERNS.productsStore,
      [/\bpagina produtos\b/, /\bp[aá]gina produtos\b/, /\bprodutos\.html\b/, /\bloja\.html\b/],
    ],
    blog: [
      SECTION_PATTERNS.blog,
      [/\bpagina conteudos\b/, /\bp[aá]gina conte[uú]dos\b/, /\bconteudos\.html\b/, /\bconteúdos\.html\b/, /\bblog\.html\b/],
    ],
    galleryPortfolio: [
      SECTION_PATTERNS.galleryPortfolio,
      [/\bpagina portfolio\b/, /\bp[aá]gina portf[oó]lio\b/, /\bportfolio\.html\b/, /\bgaleria\.html\b/],
    ],
    testimonials: [
      SECTION_PATTERNS.testimonials,
      [/\bpagina depoimentos\b/, /\bp[aá]gina depoimentos\b/, /\bdepoimentos\.html\b/],
    ],
    contactForm: [
      SECTION_PATTERNS.contactForm,
      [/\bpagina contato\b/, /\bp[aá]gina contato\b/, /\bcontato\.html\b/],
    ],
  };

  Object.entries(sectionScopes).forEach(([key, [sectionPatterns, pagePatterns]]) => {
    if (!scoped.required[key]) return;
    if (pageKey === key) return;
    const explicitSeparatePage = hasAnyPattern(sourceForHome, pagePatterns);
    const requestedInsideHome = isHomeScopedRequirement(sourceForHome, sectionPatterns);
    if (pageKey === 'home' && explicitSeparatePage) {
      scoped.required[key] = false;
      scoped.scope.relaxed.push(requestedInsideHome ? `${key}_separate_page_with_home_summary` : `${key}_separate_page`);
      return;
    }
    if (pageKey !== 'home' && explicitSeparatePage) {
      scoped.required[key] = false;
      scoped.scope.relaxed.push(`${key}_not_current_page`);
    }
  });

  return scoped;
}

function countTruthy(values = []) {
  return values.reduce((sum, value) => sum + (value ? 1 : 0), 0);
}

function inferVisualProductCoverageExpectations({ userMessage = '', contextText = '' } = {}) {
  const userSource = normalizeProductCoverageText(stripNegatedIntentClauses(userMessage));
  const contextSource = normalizeProductCoverageText(stripNegatedIntentClauses(contextText));
  const combinedSource = normalizeProductCoverageText(`${userSource}\n${contextSource}`);
  const explicitSiteSurface = hasAnyPattern(userSource, SITE_SURFACE_PATTERNS);
  const placeholderAuthorized = hasAnyPattern(combinedSource, [
    /\bplaceholder\b/,
    /\bprovisorio\b/,
    /\bprovisório\b/,
    /\bgenerico\b/,
    /\bgen[eé]rico\b/,
    /\bqualquer coisa\b/,
  ]);
  const fullSite = hasAnyPattern(userSource, [
    /\bsite completo\b/,
    /\bpresenca digital forte\b/,
    /\bhome\b[\s\S]{0,120}\bcontato\b/,
  ]);
  const operationalTool = isOperationalToolSource(combinedSource, { explicitSiteSurface, fullSite });
  const operationalOnly = operationalTool && !explicitSiteSurface && !fullSite;

  const expectedFromSource = (patterns) => (
    hasAnyPattern(userSource, patterns) ||
    (explicitSiteSurface && hasAnyPattern(contextSource, patterns))
  );

  const sections = {
    productsStore: operationalOnly ? false : expectedFromSource(SECTION_PATTERNS.productsStore),
    blog: operationalOnly ? false : expectedFromSource(SECTION_PATTERNS.blog),
    galleryPortfolio: operationalOnly ? false : expectedFromSource(SECTION_PATTERNS.galleryPortfolio),
    testimonials: operationalOnly ? false : expectedFromSource(SECTION_PATTERNS.testimonials),
    contactForm: operationalOnly ? false : expectedFromSource(SECTION_PATTERNS.contactForm),
    footer: operationalOnly ? false : expectedFromSource(SECTION_PATTERNS.footer) || fullSite,
  };

  const explicitSections = Object.values(sections).some(Boolean);
  const hero = operationalOnly ? false : explicitSiteSurface || fullSite || explicitSections || hasAnyPattern(userSource, [/\bhero\b/, /\babove the fold\b/, /\bprimeira dobra\b/]);
  const cta = operationalOnly
    ? hasAnyPattern(userSource, [/\bcta\b/, /\bcall[-\s]?to[-\s]?action\b/])
    : hero || hasAnyPattern(userSource, CTA_PATTERNS);

  return {
    schemaVersion: VISUAL_PRODUCT_COVERAGE_SCHEMA_VERSION,
    enabled: Boolean(operationalTool || hero || cta || explicitSections),
    source: compact(combinedSource, 1600),
    fullSite,
    operationalTool,
    placeholderAuthorized,
    required: {
      operationalSurface: operationalTool,
      hero,
      cta,
      ...sections,
    },
  };
}

function normalizeRect(rect = {}) {
  return {
    top: Number(rect.top || 0),
    bottom: Number(rect.bottom || 0),
    width: Number(rect.width || 0),
    height: Number(rect.height || 0),
  };
}

function normalizeSection(section = {}, index = 0) {
  const rect = normalizeRect(section.rect || {});
  const text = normalizeProductCoverageText([
    section.id || '',
    section.className || '',
    section.role || '',
    section.ariaLabel || '',
    section.heading || '',
    section.text || '',
    ...(Array.isArray(section.buttonTexts) ? section.buttonTexts : []),
    ...(Array.isArray(section.linkTexts) ? section.linkTexts : []),
  ].join(' '));
  return {
    index,
    tag: String(section.tag || ''),
    id: String(section.id || ''),
    className: String(section.className || ''),
    role: String(section.role || ''),
    ariaLabel: String(section.ariaLabel || ''),
    heading: String(section.heading || ''),
    text,
    rawText: compact(section.text || '', 1200),
    buttonTexts: Array.isArray(section.buttonTexts) ? section.buttonTexts.map(String).filter(Boolean) : [],
    linkTexts: Array.isArray(section.linkTexts) ? section.linkTexts.map(String).filter(Boolean) : [],
    mediaCount: Number(section.mediaCount || 0),
    formControlCount: Number(section.formControlCount || 0),
    itemCount: Number(section.itemCount || 0),
    rect,
    aboveFold: Boolean(section.aboveFold || section.visibleInViewport),
    visibleInViewport: Boolean(section.visibleInViewport),
  };
}

function extractSnapshotSections(pageSnapshot = {}) {
  const rawSections = Array.isArray(pageSnapshot.sections) ? pageSnapshot.sections : [];
  if (rawSections.length) {
    return rawSections.map(normalizeSection).filter((section) => section.text || section.heading || section.id || section.className);
  }

  const fallbackText = normalizeProductCoverageText([
    pageSnapshot.bodyText || '',
    ...(Array.isArray(pageSnapshot.headings) ? pageSnapshot.headings : []),
    ...(Array.isArray(pageSnapshot.buttons) ? pageSnapshot.buttons : []),
  ].join(' '));
  if (!fallbackText) return [];
  return [
    {
      index: 0,
      tag: 'body',
      id: '',
      className: '',
      role: '',
      ariaLabel: '',
      heading: Array.isArray(pageSnapshot.headings) ? String(pageSnapshot.headings[0] || '') : '',
      text: fallbackText,
      rawText: compact(pageSnapshot.bodyText || '', 1200),
      buttonTexts: Array.isArray(pageSnapshot.buttons) ? pageSnapshot.buttons.map(String).filter(Boolean) : [],
      linkTexts: [],
      mediaCount: (Array.isArray(pageSnapshot.images) ? pageSnapshot.images.length : 0) +
        (Array.isArray(pageSnapshot.videos) ? pageSnapshot.videos.length : 0) +
        (Array.isArray(pageSnapshot.iframes) ? pageSnapshot.iframes.length : 0),
      formControlCount: Number(pageSnapshot.formCount || 0),
      itemCount: Number(pageSnapshot.sectionCount || 0),
      rect: { top: 0, bottom: Number(pageSnapshot.viewport && pageSnapshot.viewport.height ? pageSnapshot.viewport.height : 0), width: 0, height: 0 },
      aboveFold: true,
      visibleInViewport: true,
    },
  ];
}

function normalizeCtaCandidate(candidate = {}, index = 0) {
  const text = normalizeProductCoverageText([
    candidate.text || '',
    candidate.href || '',
    candidate.className || '',
    candidate.ariaLabel || '',
  ].join(' '));
  return {
    index,
    text,
    rawText: String(candidate.text || ''),
    href: String(candidate.href || ''),
    aboveFold: Boolean(candidate.aboveFold || candidate.visibleInViewport),
    visibleInViewport: Boolean(candidate.visibleInViewport),
  };
}

function extractCtaCandidates(pageSnapshot = {}) {
  const rawCandidates = Array.isArray(pageSnapshot.ctaCandidates) ? pageSnapshot.ctaCandidates : [];
  const candidates = rawCandidates.map(normalizeCtaCandidate).filter((candidate) => candidate.text);
  if (candidates.length) return candidates;
  return (Array.isArray(pageSnapshot.buttons) ? pageSnapshot.buttons : [])
    .map((text, index) => ({
      index,
      text: normalizeProductCoverageText(text),
      rawText: String(text || ''),
      href: '',
      aboveFold: true,
      visibleInViewport: true,
    }))
    .filter((candidate) => candidate.text);
}

function buildAboveFoldEvidence(pageSnapshot = {}, sections = [], ctaCandidates = []) {
  const aboveFold = pageSnapshot.aboveFold && typeof pageSnapshot.aboveFold === 'object'
    ? pageSnapshot.aboveFold
    : null;
  const visibleSections = sections.filter((section) => section.aboveFold || section.visibleInViewport);
  const text = normalizeProductCoverageText([
    aboveFold && aboveFold.text ? aboveFold.text : '',
    ...(aboveFold && Array.isArray(aboveFold.headings) ? aboveFold.headings : []),
    ...(aboveFold && Array.isArray(aboveFold.buttons) ? aboveFold.buttons : []),
    ...visibleSections.map((section) => section.text),
  ].join(' '));
  const headings = unique([
    ...(aboveFold && Array.isArray(aboveFold.headings) ? aboveFold.headings : []),
    ...visibleSections.map((section) => section.heading),
    ...(Array.isArray(pageSnapshot.headings) ? pageSnapshot.headings.slice(0, 1) : []),
  ].map((entry) => String(entry || '').trim()));
  const visibleCtas = ctaCandidates.filter((candidate) => candidate.aboveFold || candidate.visibleInViewport);
  return {
    text,
    headings,
    hasH1: Boolean(aboveFold && aboveFold.hasH1) || headings.length > 0,
    visibleTextBlocks: Number(
      aboveFold && Number.isFinite(Number(aboveFold.visibleTextBlocks))
        ? aboveFold.visibleTextBlocks
        : pageSnapshot.layout && Number.isFinite(Number(pageSnapshot.layout.visibleTextBlocks))
          ? pageSnapshot.layout.visibleTextBlocks
          : headings.length
    ),
    mediaCount: Number(aboveFold && aboveFold.mediaCount ? aboveFold.mediaCount : 0),
    visibleCtas,
  };
}

function isCtaText(text = '') {
  return hasAnyPattern(normalizeProductCoverageText(text), CTA_PATTERNS);
}

function findSectionCoverage(sections = [], key = '') {
  const patterns = SECTION_PATTERNS[key] || [];
  const matching = sections.find((section) => hasAnyPattern(section.text, patterns)) || null;
  if (!matching) {
    return {
      present: false,
      aboveFold: false,
      depthScore: 0,
      evidence: '',
    };
  }

  const textLength = String(matching.text || '').length;
  const interactionCount = matching.buttonTexts.length + matching.linkTexts.length;
  const visualCount = Number(matching.mediaCount || 0);
  const itemCount = Number(matching.itemCount || 0);
  const formControlCount = Number(matching.formControlCount || 0);
  let depthScore = 35;
  if (textLength >= 120) depthScore += 25;
  else if (textLength >= 70) depthScore += 14;
  if (interactionCount > 0) depthScore += 10;
  if (visualCount > 0) depthScore += 10;
  if (itemCount >= 3) depthScore += 12;
  else if (itemCount >= 2) depthScore += 7;
  if (key === 'contactForm' && formControlCount > 0) depthScore += 22;
  if (key === 'footer' && (matching.tag === 'footer' || /footer|rodape/.test(matching.text))) depthScore += 12;

  return {
    present: true,
    aboveFold: Boolean(matching.aboveFold),
    visibleInViewport: Boolean(matching.visibleInViewport),
    depthScore: Math.min(100, depthScore),
    evidence: compact(matching.heading || matching.rawText || matching.text, 220),
    section: {
      index: matching.index,
      tag: matching.tag,
      id: matching.id,
      className: compact(matching.className, 160),
      heading: matching.heading,
      mediaCount: matching.mediaCount,
      itemCount: matching.itemCount,
      formControlCount: matching.formControlCount,
    },
  };
}

function createCoverageIssue(id, severity, detail, hint) {
  return {
    id,
    severity,
    detail,
    hint,
    source: 'visual_product_coverage',
  };
}

function scoreCoverage(checks = {}, weights = {}) {
  const activeEntries = Object.entries(weights).filter(([, weight]) => Number(weight || 0) > 0);
  const maxScore = activeEntries.reduce((sum, [, weight]) => sum + Number(weight || 0), 0);
  if (!maxScore) return 100;
  const score = activeEntries.reduce((sum, [key, weight]) => sum + (checks[key] ? Number(weight || 0) : 0), 0);
  return Math.round((score * 100) / maxScore);
}

function createVisualProductCoverageService(dependencies = {}) {
  const {
    minProductCoverageScore = DEFAULT_MIN_PRODUCT_COVERAGE_SCORE,
  } = dependencies;

  function evaluateVisualProductCoverage({
    userMessage = '',
    contextText = '',
    pageSnapshot = null,
    viewport = null,
  } = {}) {
    const expectations = applySnapshotScopeToCoverageExpectations(
      inferVisualProductCoverageExpectations({ userMessage, contextText }),
      pageSnapshot
    );
    if (!expectations.enabled) {
      return {
        schemaVersion: VISUAL_PRODUCT_COVERAGE_SCHEMA_VERSION,
        enabled: false,
        score: 100,
        minScore: minProductCoverageScore,
        passesMinimum: true,
        expectations,
        checks: {},
        sections: {},
        issues: [],
      };
    }

    if (!pageSnapshot || typeof pageSnapshot !== 'object') {
      return {
        schemaVersion: VISUAL_PRODUCT_COVERAGE_SCHEMA_VERSION,
        enabled: true,
        score: 0,
        minScore: minProductCoverageScore,
        passesMinimum: false,
        expectations,
        viewport: viewport || null,
        checks: { pageSnapshot: false },
        sections: {},
        issues: [
          createCoverageIssue(
            'product_coverage_snapshot_missing',
            'error',
            'Nao consegui ler o DOM renderizado para validar cobertura visual de produto.',
            'Extraia snapshot renderizado junto da captura de preview antes de liberar o gate visual.'
          ),
        ],
        summary: 'Cobertura visual de produto falhou: snapshot renderizado ausente.',
      };
    }

    const sections = extractSnapshotSections(pageSnapshot);
    const ctaCandidates = extractCtaCandidates(pageSnapshot);
    const aboveFold = buildAboveFoldEvidence(pageSnapshot, sections, ctaCandidates);
    const renderedText = normalizeProductCoverageText([
      aboveFold.text,
      ...sections.map((section) => section.text),
      ...ctaCandidates.map((candidate) => candidate.text),
    ].join(' '));
    const hasGenericVisiblePlaceholder =
      !expectations.placeholderAuthorized &&
      hasAnyPattern(renderedText, GENERIC_VISIBLE_PLACEHOLDER_PATTERNS);
    const hasHeroAboveFold = !expectations.required.hero || Boolean(
      aboveFold.hasH1 &&
        aboveFold.visibleTextBlocks > 0 &&
        (aboveFold.text.length >= 24 || aboveFold.headings.join(' ').length >= 12)
    );
    const hasCtaAboveFold = !expectations.required.cta || ctaCandidates.some((candidate) => (
      (candidate.aboveFold || candidate.visibleInViewport) &&
        isCtaText(candidate.text)
    ));
    const hasOperationalSurface = !expectations.required.operationalSurface || Boolean(
      aboveFold.hasH1 &&
        (Number(pageSnapshot.formCount || 0) > 0 ||
          hasAnyPattern(renderedText, OPERATIONAL_TOOL_PATTERNS)) &&
        hasAnyPattern(renderedText, [
          /\bcadastro\b/,
          /\bestoque\b/,
          /\bordens?\b/,
          /\bbom\b/,
          /\bauditoria\b/,
          /\bitens?\b/,
          /\btabela\b/,
          /\ba[cç][oõ]es\b/,
        ])
    );

    const sectionKeys = [
      'productsStore',
      'blog',
      'galleryPortfolio',
      'testimonials',
      'contactForm',
      'footer',
    ];
    const sectionCoverage = {};
    sectionKeys.forEach((key) => {
      sectionCoverage[key] = findSectionCoverage(sections, key);
    });

    const checks = {
      pageSnapshot: true,
      operationalSurface: hasOperationalSurface,
      heroAboveFold: hasHeroAboveFold,
      ctaAboveFold: hasCtaAboveFold,
      noGenericProductPlaceholders: !hasGenericVisiblePlaceholder,
    };
    sectionKeys.forEach((key) => {
      checks[key] = !expectations.required[key] || sectionCoverage[key].present;
    });

    const weights = {
      operationalSurface: expectations.required.operationalSurface ? 30 : 0,
      heroAboveFold: expectations.required.hero ? 18 : 0,
      ctaAboveFold: expectations.required.cta ? 14 : 0,
      productsStore: expectations.required.productsStore ? 12 : 0,
      blog: expectations.required.blog ? 9 : 0,
      galleryPortfolio: expectations.required.galleryPortfolio ? 9 : 0,
      testimonials: expectations.required.testimonials ? 8 : 0,
      contactForm: expectations.required.contactForm ? 10 : 0,
      footer: expectations.required.footer ? 7 : 0,
    };

    const issues = [];
    if (!hasHeroAboveFold) {
      issues.push(createCoverageIssue(
        'product_hero_above_fold_missing',
        'error',
        'Hero com titulo/texto principal nao apareceu de forma verificavel acima da dobra.',
        'Garanta H1, texto principal e estrutura de hero visiveis na primeira viewport.'
      ));
    }
    if (!hasOperationalSurface) {
      issues.push(createCoverageIssue(
        'product_operational_surface_missing',
        'error',
        'A ferramenta operacional nao exibiu controles/dados de dominio suficientes no preview.',
        'Renderize formularios, tabelas, acoes e termos do dominio da ferramenta na primeira tela util.'
      ));
    }
    if (!hasCtaAboveFold) {
      issues.push(createCoverageIssue(
        'product_cta_above_fold_missing',
        'error',
        'CTA principal nao apareceu acima da dobra nesta viewport.',
        'Inclua um botao/link de acao claro dentro do hero ou da primeira dobra.'
      ));
    }
    if (hasGenericVisiblePlaceholder) {
      issues.push(createCoverageIssue(
        'product_generic_placeholder_visible',
        'critical',
        'O snapshot renderizado exibiu textos genéricos de placeholder em uma entrega de produto final.',
        'Regere ou repare a página com conteúdo específico do briefing antes de liberar o gate visual.'
      ));
    }

    sectionKeys.forEach((key) => {
      if (!expectations.required[key]) return;
      const coverage = sectionCoverage[key];
      if (!coverage.present) {
        issues.push(createCoverageIssue(
          `product_section_missing_${key}`,
          'error',
          `Secao prometida nao apareceu no snapshot renderizado: ${key}.`,
          'Renderize a secao prometida com titulo/texto visivel e navegacao coerente.'
        ));
        return;
      }

      const minimumDepth = key === 'footer' ? 35 : 52;
      if (coverage.depthScore < minimumDepth) {
        issues.push(createCoverageIssue(
          `product_section_shallow_${key}`,
          key === 'footer' ? 'warning' : 'error',
          `Secao ${key} apareceu, mas esta rasa para uma entrega visual completa.`,
          'Aprofunde a secao com conteudo, cards, midia, links ou campos coerentes com o briefing.'
        ));
      }
    });

    const score = scoreCoverage(checks, weights);
    const blockingIssues = issues.filter((issue) => ['critical', 'error'].includes(String(issue.severity || '').toLowerCase()));
    const passesMinimum = score >= minProductCoverageScore && blockingIssues.length === 0;
    const requiredChecks = [
      expectations.required.operationalSurface ? checks.operationalSurface : null,
      expectations.required.hero ? checks.heroAboveFold : null,
      expectations.required.cta ? checks.ctaAboveFold : null,
      ...sectionKeys.map((key) => (expectations.required[key] ? checks[key] : null)),
    ].filter((value) => value !== null);
    const requiredCount = requiredChecks.length;
    const passedCount = countTruthy(requiredChecks);

    return {
      schemaVersion: VISUAL_PRODUCT_COVERAGE_SCHEMA_VERSION,
      enabled: true,
      score,
      minScore: minProductCoverageScore,
      passesMinimum,
      expectations,
      viewport: viewport || (pageSnapshot.viewport || null),
      checks,
      aboveFold: {
        hasHero: hasHeroAboveFold,
        hasCta: hasCtaAboveFold,
        headingCount: aboveFold.headings.length,
        visibleTextBlocks: aboveFold.visibleTextBlocks,
        ctaCount: aboveFold.visibleCtas.length,
      },
      sections: sectionCoverage,
      issues,
      summary: passesMinimum
        ? `Cobertura visual de produto passou (${score}%, minimo ${minProductCoverageScore}%).`
        : `Cobertura visual de produto falhou (${score}%, minimo ${minProductCoverageScore}%).`,
      evidence: {
        requiredCount,
        passedCount,
      },
    };
  }

  return {
    evaluateVisualProductCoverage,
    inferVisualProductCoverageExpectations,
  };
}

module.exports = {
  VISUAL_PRODUCT_COVERAGE_SCHEMA_VERSION,
  createVisualProductCoverageService,
  inferVisualProductCoverageExpectations,
};
