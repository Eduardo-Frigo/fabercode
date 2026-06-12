const { normalizeBlueprintText } = require('./project_blueprint_utils');
const { buildProjectBlueprintManifest } = require('./project_blueprint_manifest_service');

const BLUEPRINT_COVERAGE_CONTRACT_VERSION = 'blueprint-coverage-contract-v1';

function hasAny(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function normalizeExpectedRouteForDomain(route = '', domain = '') {
  const normalized = String(route || '').replace(/\\/g, '/').trim();
  if (!normalized) return '';
  if (domain === 'gardening' || domain === 'wood-sculpture') {
    if (normalized === '/produtos') return '/loja';
    if (normalized === '/projetos') return '/portfolio';
    if (normalized === '/insights' || normalized === '/inspiracoes' || normalized === '/conteudos' || normalized === '/conteúdos') return '/blog';
  }
  if (domain === 'editorial-content') {
    if (normalized === '/servicos' || normalized === '/serviços') return '/editorias';
    if (normalized === '/blog' || normalized === '/insights' || normalized === '/guias') return '/artigos';
  }
  return normalized;
}

function buildCoverageSource({ source = '', contract = {}, workingBrief = null, layoutRecipe = null } = {}) {
  const workingSource = workingBrief && workingBrief.source && typeof workingBrief.source === 'object'
    ? [workingBrief.source.current, workingBrief.source.consolidated, workingBrief.source.normalized].filter(Boolean).join('\n')
    : '';
  const recipeSource = layoutRecipe && typeof layoutRecipe === 'object'
    ? [layoutRecipe.id, layoutRecipe.hero, ...(Array.isArray(layoutRecipe.bodySections) ? layoutRecipe.bodySections : [])].filter(Boolean).join(' ')
    : '';
  return normalizeBlueprintText([
    source,
    contract && contract.source ? contract.source : '',
    workingSource,
    recipeSource,
  ].filter(Boolean).join('\n'));
}

function inferBlueprintCoverageRequirements({ source = '', contract = {}, workingBrief = null, layoutRecipe = null } = {}) {
  const normalized = buildCoverageSource({ source, contract, workingBrief, layoutRecipe });
  const domain = contract && contract.domain
    ? contract.domain
    : workingBrief && workingBrief.product
      ? workingBrief.product.domain || ''
      : '';
  const bodySections = layoutRecipe && Array.isArray(layoutRecipe.bodySections) ? layoutRecipe.bodySections : [];
  const manifest = buildProjectBlueprintManifest({ source, contract, workingBrief, layoutRecipe });
  const manifestCoverage = manifest.coverage || {};
  const routeProfile = domain === 'architecture'
    ? ['/sobre', '/servicos', '/projetos', '/processo', '/insights', '/contato']
    : domain === 'technical-b2b-services-site'
      ? ['/sobre', '/solucoes', '/projetos', '/calculadora', '/blog', '/contato', '/trabalhe-conosco']
    : domain === 'construction-materials-site'
      ? ['/sobre', '/produtos', '/servicos', '/orcamento', '/blog', '/contato']
    : domain === 'editorial-content'
      ? ['/editorias', '/artigos', '/newsletter', '/sobre', '/contato']
    : domain === 'wood-finishes'
      ? ['/sobre', '/servicos', '/produtos', '/pisos', '/paineis', '/decks', '/projetos', '/inspiracoes', '/contato']
    : domain === 'gardening' || domain === 'wood-sculpture'
      ? ['/servicos', '/loja', '/portfolio', '/blog', '/sobre', '/contato']
      : [];
  const expectedRoutes = uniqueStrings([...routeProfile, ...(Array.isArray(manifest.expectedRoutes) ? manifest.expectedRoutes : [])]
    .map((route) => normalizeExpectedRouteForDomain(route, domain)));
  const wantsCompleteSite = hasAny(normalized, [
    /\bsite completo\b/,
    /\bm[uú]ltiplas paginas\b/,
    /\bm[uú]ltiplas páginas\b/,
    /\bvarias paginas\b/,
    /\bvárias páginas\b/,
    /\bpresenca digital forte\b/,
    /\bpagina inicial\b[\s\S]{0,220}\bsobre\b[\s\S]{0,220}\bcontato\b/,
    /\bpágina inicial\b[\s\S]{0,220}\bsobre\b[\s\S]{0,220}\bcontato\b/,
    /\bhome\b[\s\S]{0,220}\bsobre\b[\s\S]{0,220}\bcontato\b/,
  ]);
  const domainFullSite = domain === 'gardening' || domain === 'wood-sculpture' || domain === 'architecture' || domain === 'wood-finishes' || domain === 'technical-b2b-services-site' || domain === 'construction-materials-site';
  const wantsProducts = domain === 'gardening' || domain === 'import-services' || hasAny(normalized, [
    /\bloja\b/,
    /\bprodutos?\b/,
    /\bcarrinho\b/,
    /\bcheckout\b/,
    /\bcomprar\b/,
    /\bobras disponiveis\b/,
    /\bpecas prontas\b/,
    /\bcat[aá]logo\b/,
    /\bcatalogo\b/,
    /\btipos? de importacao\b/,
    /\btipos? de importação\b/,
    /\bproduto que deseja importar\b/,
  ]);
  const wantsBlog = domain === 'gardening' || domain === 'architecture' || hasAny(normalized, [
    /\bblog\b/,
    /\bartigos?\b/,
    /\bconteudos? educativos?\b/,
    /\bseo\b/,
    /\bcalendario de cuidados\b/,
    /\bbastidores\b/,
    /\binsights\b/,
    /\bguias? de importacao\b/,
    /\bguias? de importação\b/,
  ]);
  const wantsGallery = domainFullSite || hasAny(normalized, [
    /\bgaleria\b/,
    /\bportfolio\b/,
    /\bportf[oó]lio\b/,
    /\bobras selecionadas\b/,
    /\bprojetos realizados\b/,
    /\bantes e depois\b/,
    /\boperacoes acompanhadas\b/,
    /\boperações acompanhadas\b/,
    /\bcases?\b/,
  ]);
  const wantsTestimonials = hasAny(normalized, [/\bdepoimentos?\b/, /\bavaliacoes?\b/, /\bclientes?\b/]) ||
    bodySections.includes('testimonials');
  const wantsContact = domainFullSite || domain === 'import-services' || hasAny(normalized, [
    /\bcontato\b/,
    /\bformulario\b/,
    /\bformul[aá]rio\b/,
    /\borcamento\b/,
    /\borçamento\b/,
    /\bwhatsapp\b/,
    /\bencomenda\b/,
  ]);
  const wantsFaq = manifestCoverage.faq || hasAny(normalized, [/\bfaq\b/, /\bperguntas frequentes\b/]);
  const wantsProcess = manifestCoverage.process || hasAny(normalized, [/\bcomo funciona\b/, /\bprocesso\b/, /\bmetodo\b/, /\bm[eé]todo\b/, /\betapas?\b/]);
  const wantsAbout = manifestCoverage.about || domainFullSite || hasAny(normalized, [/\bsobre o escritorio\b/, /\bsobre o escritório\b/, /\bapresentacao da arquiteta\b/, /\bapresentação da arquiteta\b/]);
  const wantsDifferentials = manifestCoverage.differentials || hasAny(normalized, [/\bdiferenciais?\b/, /\bbeneficios?\b/, /\bbenefícios?\b/, /\bpor que escolher\b/]);
  const wantsBodyVideo = manifestCoverage.videoSection || hasAny(normalized, [
    /\bvideo\b[\s\S]{0,120}\bcorpo\b/,
    /\bvídeo\b[\s\S]{0,120}\bcorpo\b/,
    /\balem do hero\b[\s\S]{0,160}\bvideo\b/,
    /\balém do hero\b[\s\S]{0,160}\bvideo\b/,
  ]);
  const wantsVideoHero = manifestCoverage.videoHero || hasAny(normalized, [/\bhero\b[\s\S]{0,80}\bvideo\b/, /\bvideo\b[\s\S]{0,80}\bfull\b/, /\bfull width\b/, /\bfull bleed\b/]);

  return {
    schemaVersion: BLUEPRINT_COVERAGE_CONTRACT_VERSION,
    domain,
    sourceSignals: {
      completeSite: wantsCompleteSite || domainFullSite,
      explicitVideoHero: wantsVideoHero,
      explicitBodyVideo: wantsBodyVideo,
    },
    expectedRoutes,
    manifest,
    required: {
      hero: true,
      services: manifestCoverage.services || bodySections.includes('services-grid') || hasAny(normalized, [/\bservicos?\b/, /\bserviços?\b/, /\bsolucoes?\b/, /\bsoluções?\b/, /\bobras e encomendas\b/]),
      productsStore: manifestCoverage.productsStore || wantsProducts,
      blog: manifestCoverage.blog || wantsBlog,
      galleryPortfolio: manifestCoverage.galleryPortfolio || wantsGallery,
      testimonials: manifestCoverage.testimonials || wantsTestimonials,
      contact: manifestCoverage.contact || wantsContact,
      ctas: true,
      formFields: manifestCoverage.formFields || wantsContact,
      faq: wantsFaq,
      process: wantsProcess,
      about: wantsAbout,
      differentials: wantsDifferentials,
      videoHero: wantsVideoHero,
      videoSection: wantsBodyVideo,
      multiplePages: Boolean(expectedRoutes.length) || wantsCompleteSite || domainFullSite,
      routeNavigation: Boolean(expectedRoutes.length) || wantsCompleteSite || domainFullSite,
      sectionDepth: wantsCompleteSite || domainFullSite,
      testimonialDepth: manifestCoverage.testimonialDepth || wantsTestimonials || wantsCompleteSite || domainFullSite,
      footerSocial: manifestCoverage.footerSocial || wantsContact || wantsCompleteSite || domainFullSite,
    },
  };
}

function collectBlueprintOperationText(operations = []) {
  return (Array.isArray(operations) ? operations : [])
    .filter((operation) => operation && typeof operation === 'object')
    .map((operation) => `${operation.path || ''}\n${operation.content || ''}`)
    .join('\n')
    .toLowerCase();
}

function collectBlueprintOperationPaths(operations = []) {
  return new Set(
    (Array.isArray(operations) ? operations : [])
      .map((operation) => String(operation && operation.path ? operation.path : '').replace(/\\/g, '/').toLowerCase())
      .filter(Boolean)
  );
}

function evaluateBlueprintCoverage({ requirements = {}, operations = [] } = {}) {
  const required = requirements.required || {};
  const text = collectBlueprintOperationText(operations);
  const paths = collectBlueprintOperationPaths(operations);
  const domain = requirements.domain || '';
  const hasRoute = (routePath) => paths.has(routePath);
  const routeToFilePath = (routePath) => {
    const normalized = String(routePath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    return normalized ? `app/${normalized}/page.tsx` : 'app/page.tsx';
  };
  const hasLinkedRoute = (routePath) => text.includes(`href="${routePath}"`) ||
    text.includes(`href='${routePath}'`) ||
    text.includes(`'${routePath}'`) ||
    text.includes(`"${routePath}"`) ||
    text.includes(`routehref('${routePath}'`) ||
    text.includes(`routehref("${routePath}"`) ||
    text.includes(`href={routehref('${routePath}'`) ||
    text.includes(`href={routehref("${routePath}"`);
  const expectedRoutes = Array.isArray(requirements.expectedRoutes) && requirements.expectedRoutes.length
    ? requirements.expectedRoutes
    : [
        '/servicos',
        '/loja',
        '/portfolio',
        '/blog',
        '/sobre',
        '/contato',
      ];
  const hasMeaningfulCollection = (pattern) => {
    const matches = text.match(pattern) || [];
    return matches.length >= 2;
  };
  const hasRequiredMapper = (key, pattern) => !required[key] || pattern.test(text);
  const covered = {
    hero: /id="inicio"|heroeyebrow|herotitle|<h1/.test(text),
    services: /id="servicos"|id="serviços"|servicesheading|servicos\/page\.tsx|servicos/.test(text),
    productsStore: /id="loja"|id="produtos"|id="chocolates"|productsheading|produtos para jardim|obras disponiveis|loja\/page\.tsx|catalogo|catálogo|chocolates|bombons especiais|tipos de importacao|tipos de importação|produto que deseja importar|cotacao internacional|cotação internacional/.test(text),
    blog: /id="blog"|blogheading|blogposts|blog\/page\.tsx|insights\/page\.tsx|artigos|conteudo educativo|conteúdo educativo|insights|guias de importacao|guias de importação/.test(text),
    galleryPortfolio: /id="portfolio"|id="galeria"|galleryheading|galleryitems|portfolio\/page\.tsx|projetos\/page\.tsx|galeria|portfólio|portfolio|projetos selecionados|operacoes acompanhadas|operações acompanhadas/.test(text),
    testimonials: /id="depoimentos"|testimonial|depoimentos\/page\.tsx/.test(text),
    contact: /id="contato"|contactheading|contato\/page\.tsx|formbuttonlabel/.test(text),
    ctas: /(secondarycta|secondaryctalabel|solicitar|ver portfolio|ver portfólio|falar com|comprar|orcamento|orçamento|encomenda)/.test(text),
    formFields: /(telefone|whatsapp|tipo de servico|tipo de serviço|tipo de interesse|dimensoes|dimensões|prazo|mensagem|email|produto que deseja importar|pais de origem|país de origem|quantidade estimada|objetivo da importacao|objetivo da importação|cidade|tipo de projeto)/.test(text),
    faq: /id="faq"|perguntas frequentes|faqs\.map|faq/.test(text),
    process: /id="metodo"|processo\/page\.tsx|methodsteps|como funciona|diagnostico inicial|diagnóstico inicial|imersao|imersão/.test(text),
    about: /id="sobre"|sobre\/page\.tsx|copy\.about|helena duarte e arquiteta|importar pode parecer complicado/.test(text),
    differentials: /id="diferenciais"[\s\S]{0,160}differentials\.map|por que escolher|diferenciais da empresa|diferenciais/.test(text),
    videoHero: /<video|kind": "video"|kind': 'video'/.test(text),
    videoSection: /"bodymediatitle"\s*:\s*"[^"]{8,}"|id="video"[\s\S]{0,220}<video/.test(text),
    multiplePages: expectedRoutes.map(routeToFilePath).every(hasRoute),
    routeNavigation: expectedRoutes.every(hasLinkedRoute),
    sectionDepth:
      /services\.map/.test(text) &&
      hasRequiredMapper('productsStore', /products\.map/) &&
      hasRequiredMapper('blog', /blogposts\.map/) &&
      hasRequiredMapper('galleryPortfolio', domain === 'editorial-content' ? /blogposts\.map/ : /galleryitems\.map/) &&
      hasRequiredMapper('testimonials', /testimonials\.map/) &&
      hasMeaningfulCollection(/\btitle\b/g),
    testimonialDepth:
      /testimonials\s*=|testimonials":|testimonials\.map/.test(text) &&
      /name|role|depoimentos/.test(text),
    footerSocial: /<footer|<\/footer>/.test(text) && /(whatsapp|instagram|linkedin|redes sociais|links de rodap[eé])/.test(text),
  };
  const requiredKeys = Object.keys(required).filter((key) => required[key]);
  const missing = requiredKeys.filter((key) => !covered[key]);
  const coveredCount = requiredKeys.length - missing.length;
  const score = requiredKeys.length ? Math.round((coveredCount / requiredKeys.length) * 100) : 100;

  return {
    schemaVersion: BLUEPRINT_COVERAGE_CONTRACT_VERSION,
    domain: requirements.domain || '',
    required,
    covered,
    missing,
    score,
    passes: missing.length === 0,
  };
}

function buildBlueprintCoverageContract(options = {}) {
  const requirements = inferBlueprintCoverageRequirements(options);
  const evaluation = evaluateBlueprintCoverage({
    requirements,
    operations: options.operations || [],
  });
  return {
    schemaVersion: BLUEPRINT_COVERAGE_CONTRACT_VERSION,
    requirements,
    evaluation,
    status: evaluation.passes ? 'passed' : 'missing_required_coverage',
  };
}

module.exports = {
  BLUEPRINT_COVERAGE_CONTRACT_VERSION,
  buildBlueprintCoverageContract,
  evaluateBlueprintCoverage,
  inferBlueprintCoverageRequirements,
};
