const {
  evaluateBriefingAdherence,
  inferBriefingContract,
  normalizeBriefingContractText,
} = require('./briefing_contract_service');

const VISUAL_BRIEFING_SEMANTIC_SCHEMA_VERSION = 'visual-briefing-semantic-v1';

const DEFAULT_MIN_SEMANTIC_SCORE = 72;

function normalizeList(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasAnyPattern(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function countMatches(text = '', patterns = []) {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function inferSnapshotPageKey(pageSnapshot = {}) {
  const url = normalizeBriefingContractText(pageSnapshot && pageSnapshot.url ? pageSnapshot.url : '');
  const title = normalizeBriefingContractText(pageSnapshot && pageSnapshot.title ? pageSnapshot.title : '');
  const body = normalizeBriefingContractText(pageSnapshot && pageSnapshot.bodyText ? pageSnapshot.bodyText : '');
  const source = `${url} ${title} ${body.slice(0, 1200)}`;
  if (/\b(contato|contact)\.html\b|\b\/contato\b/.test(source)) return 'contact';
  if (/\b(jornada|processo|metodo|m[eé]todo)\.html\b|\b\/(jornada|processo|metodo)\b/.test(source)) return 'process';
  if (/\b(conteudos|conteúdos|blog|artigos|conteudo|conteúdo)\.html\b|\b\/(conteudos|conteudo|blog|artigos)\b/.test(source)) return 'content';
  if (/\b(produtos|produto|catalogo|cat[aá]logo|colecao|cole[cç][aã]o|sabores)\.html\b|\b\/(produtos|catalogo|colecao|sabores)\b/.test(source)) return 'products';
  if (/\b(a-escola|sobre|premissas)\.html\b|\b\/(a-escola|sobre|premissas)\b/.test(source)) return 'institutional';
  return 'home';
}

function isMultipageSiteSource(source = '') {
  return (
    /\b(multipagina|multi pagina|multiplas paginas|m[uú]ltiplas p[aá]ginas|site institucional multipagina|site institucional multi pagina)\b/.test(source) ||
    /\b(paginas reais obrigatorias|p[aá]ginas reais obrigat[oó]rias|rotas paginas obrigatorias|rotas \/ paginas obrigatorias)\b/.test(source) ||
    /\bindex\.html\b[\s\S]{0,500}\b(contato|jornada|premissas|conteudos|conteúdos)\.html\b/.test(source)
  );
}

function isHomeScopedRequirement(source = '', patterns = []) {
  const normalized = normalizeBriefingContractText(source);
  const homeBlocks = normalized.match(/\b(home|inicio|in[ií]cio|pagina 1|p[aá]gina 1)\b[\s\S]{0,900}/g) || [];
  return homeBlocks.some((block) => hasAnyPattern(block, patterns));
}

function applySnapshotScopeToExpectations(expectations = {}, pageSnapshot = null) {
  if (!pageSnapshot || typeof pageSnapshot !== 'object') return expectations;
  const source = String(expectations.source || '');
  const multipage = isMultipageSiteSource(source);
  const pageKey = inferSnapshotPageKey(pageSnapshot);
  if (!multipage) {
    return {
      ...expectations,
      scope: { multipage: false, pageKey },
    };
  }

  const scoped = {
    ...expectations,
    scope: { multipage: true, pageKey, relaxed: [] },
  };

  if (pageKey === 'home') {
    const homeAsksForProducts = isHomeScopedRequirement(source, [
      /\b(produtos?|sabores?|catalogo|cat[aá]logo|colecao|cole[cç][aã]o)\b/,
    ]);
    const homeAsksForProcess = isHomeScopedRequirement(source, [
      /\b(processo|fabricacao|fabrica[cç][aã]o|producao|produ[cç][aã]o|do grao|gr[aã]o ao tablete|temperagem|moldagem)\b/,
    ]);
    if (scoped.wantsProducts && !homeAsksForProducts) {
      scoped.wantsProducts = false;
      scoped.scope.relaxed.push('products_home_multipage');
    }
    if (scoped.wantsProcess && !homeAsksForProcess) {
      scoped.wantsProcess = false;
      scoped.scope.relaxed.push('process_home_multipage');
    }
  }

  if (pageKey !== 'products' && scoped.wantsProducts && !hasAnyPattern(source, [/\bpagina produtos\b/, /\bp[aá]gina produtos\b/, /\bprodutos\.html\b/])) {
    scoped.wantsProducts = false;
    scoped.scope.relaxed.push('products_not_current_page');
  }

  if (pageKey !== 'process' && scoped.wantsProcess && !hasAnyPattern(source, [/\bpagina processo\b/, /\bp[aá]gina processo\b/, /\bprocesso\.html\b/])) {
    scoped.wantsProcess = false;
    scoped.scope.relaxed.push('process_not_current_page');
  }

  return scoped;
}

function buildRenderedText(pageSnapshot = {}) {
  const parts = [
    pageSnapshot.title || '',
    pageSnapshot.bodyText || '',
    ...normalizeList(pageSnapshot.headings),
    ...normalizeList(pageSnapshot.buttons),
    ...(Array.isArray(pageSnapshot.images) ? pageSnapshot.images.map((image) => `${image.alt || ''} ${image.src || ''}`) : []),
    ...(Array.isArray(pageSnapshot.videos) ? pageSnapshot.videos.map((video) => `${video.alt || ''} ${video.src || ''}`) : []),
    ...(Array.isArray(pageSnapshot.iframes) ? pageSnapshot.iframes.map((iframe) => `${iframe.alt || ''} ${iframe.src || ''}`) : []),
  ];
  return normalizeBriefingContractText(parts.join(' '));
}

function includesMediaSource(pageSnapshot = {}, patterns = []) {
  const mediaText = normalizeBriefingContractText([
    ...(Array.isArray(pageSnapshot.images) ? pageSnapshot.images.map((image) => `${image.alt || ''} ${image.src || ''}`) : []),
    ...(Array.isArray(pageSnapshot.videos) ? pageSnapshot.videos.map((video) => `${video.alt || ''} ${video.src || ''}`) : []),
    ...(Array.isArray(pageSnapshot.iframes) ? pageSnapshot.iframes.map((iframe) => `${iframe.alt || ''} ${iframe.src || ''}`) : []),
    ...(Array.isArray(pageSnapshot.computedTokens)
      ? pageSnapshot.computedTokens.map((token) => `${token.backgroundImage || ''} ${token.className || ''}`)
      : []),
  ].join(' '));
  return hasAnyPattern(mediaText, patterns);
}

function hasRenderableVideoSource(video = {}) {
  if (!video || typeof video !== 'object') return false;
  const src = String(video.currentSrc || video.src || '').trim();
  if (!src) return false;
  return /(?:^https?:\/\/|^file:\/\/|^\.{0,2}\/|\.mp4(?:$|\?)|\.webm(?:$|\?)|\.mov(?:$|\?))/i.test(src);
}

function countRenderableVideos(videos = []) {
  return Array.isArray(videos) ? videos.filter(hasRenderableVideoSource).length : 0;
}

function isOperationalToolSource(source = '') {
  const normalized = normalizeBriefingContractText(source);
  const operational = hasAnyPattern(normalized, [
    /\b(app|aplicacao|aplicação|ferramenta|sistema|plataforma|painel operacional)\b/,
    /\b(mrp|erp|crm|ide|kanban|cadastro|estoque|bom|ordens?|ordens de producao|ordens de produção)\b/,
    /\b(audit log|auditoria|maquina de estados|máquina de estados|calculo deterministico|cálculo determinístico)\b/,
    /\b(tabela|acoes|ações|formularios|formulários|interface tecnica|interface técnica)\b/,
  ]);
  if (!operational) return false;
  return !hasAnyPattern(normalized, [/\blanding\b/, /\bsite completo\b/, /\bpresenca digital\b/]);
}

function inferVisualBriefingExpectations({ userMessage = '', contextText = '', contract = null } = {}) {
  const source = normalizeBriefingContractText(`${userMessage}\n${contextText}`);
  const domain = contract && contract.domain ? String(contract.domain) : '';
  const operationalTool = isOperationalToolSource(source);
  const chocolate = domain === 'chocolate' || /\b(chocolate|cacau|bombom|tablete|temperagem|ganache)\b/.test(source);
  const wantsVideo = /\b(video|videos|youtube|vimeo|player|campanha|incorporar)\b/.test(source);
  const wantsExplicitImages = /\b(imagem|imagens|foto|fotos|close-up|closeups?|background visual|hero visual)\b/.test(source);
  const wantsGenericMedia = /\b(midia|media)\b/.test(source);
  const wantsImages = wantsExplicitImages || (wantsGenericMedia && !wantsVideo) || chocolate;
  const wantsIcons = /\b(icone|icones|icons?|lucide|simbolo|simbolos)\b/.test(source);
  const wantsProducts = /\b(produtos?|sabores?|colecao|colecoes|catalogo|cat[aá]logo|loja|compras?)\b/.test(source) || chocolate;
  const wantsProcess = /\b(processo|fabricacao|producao|do grao|grao ao tablete|temperagem|moldagem|etapas?)\b/.test(source) || chocolate;
  const wantsContact = !operationalTool && /\b(contato|atendimento|whatsapp|email|fale conosco)\b/.test(source);
  const wantsFooter = /\b(footer|rodape|redes sociais|instagram|facebook|tiktok|pinterest|youtube)\b/.test(source);
  const wantsCTA = !operationalTool && /\b(cta|botao|comprar|explorar|escolher|conheca|ver colecao|ver colecoes|pronto para experimentar)\b/.test(source);
  const wantsPremiumTone = /\b(premium|sensorial|sofisticad[oa]|elegante|apetit[oa]s[ao]|indulgente|acolhedor|desejo|qualidade|sabor|experiencia)\b/.test(source);
  const expectedHexColors = unique(source.match(/#[0-9a-f]{3,8}\b/g) || []);

  return {
    enabled: Boolean(
      source ||
        domain ||
        wantsVideo ||
        wantsImages ||
        wantsIcons ||
        wantsProducts ||
        wantsProcess ||
        wantsContact ||
        wantsFooter ||
        wantsCTA ||
        wantsPremiumTone
    ),
    source,
    domain,
    operationalTool,
    wantsVideo,
    wantsImages,
    wantsIcons,
    wantsProducts,
    wantsProcess,
    wantsContact,
    wantsFooter,
    wantsCTA,
    wantsPremiumTone,
    expectedHexColors,
  };
}

function scoreFromChecks(checks = {}, weights = {}) {
  const entries = Object.entries(weights).filter(([, weight]) => Number(weight || 0) > 0);
  const maxScore = entries.reduce((sum, [, weight]) => sum + Number(weight || 0), 0);
  if (!maxScore) return 100;
  const score = entries.reduce((sum, [key, weight]) => sum + (checks[key] ? Number(weight || 0) : 0), 0);
  return Math.round((score * 100) / maxScore);
}

function createVisualBriefingSemanticService(dependencies = {}) {
  const {
    minSemanticScore = DEFAULT_MIN_SEMANTIC_SCORE,
  } = dependencies;

  function evaluateVisualBriefingSemantics({
    userMessage = '',
    contextText = '',
    pageSnapshot = null,
    contract = null,
  } = {}) {
    const activeContract = contract || inferBriefingContract({ userMessage, contextText });
    const rawExpectations = inferVisualBriefingExpectations({
      userMessage,
      contextText,
      contract: activeContract,
    });
    const expectations = applySnapshotScopeToExpectations(rawExpectations, pageSnapshot);

    if (!expectations.enabled) {
      return {
        schemaVersion: VISUAL_BRIEFING_SEMANTIC_SCHEMA_VERSION,
        enabled: false,
        score: 100,
        minScore: minSemanticScore,
        passesMinimum: true,
        checks: {},
        issues: [],
        expectations,
      };
    }

    if (!pageSnapshot || typeof pageSnapshot !== 'object') {
      return {
        schemaVersion: VISUAL_BRIEFING_SEMANTIC_SCHEMA_VERSION,
        enabled: true,
        score: 0,
        minScore: minSemanticScore,
        passesMinimum: false,
        checks: { pageSnapshot: false },
        criticalFailures: ['page_snapshot_missing'],
        issues: [
          {
            id: 'page_snapshot_missing',
            severity: 'error',
            detail: 'Nao consegui extrair texto/DOM do preview renderizado para comparar com o briefing.',
            hint: 'Valide o preview em runtime e extraia snapshot da pagina renderizada.',
          },
        ],
        expectations,
      };
    }

    const renderedText = buildRenderedText(pageSnapshot);
    const adherence = evaluateBriefingAdherence({
      contract: activeContract,
      text: renderedText,
    });
    const renderableVideos = countRenderableVideos(pageSnapshot.videos);
    const mediaCounts = {
      images: Array.isArray(pageSnapshot.images) ? pageSnapshot.images.length : 0,
      videos: renderableVideos,
      videoElements: Array.isArray(pageSnapshot.videos) ? pageSnapshot.videos.length : 0,
      iframes: Array.isArray(pageSnapshot.iframes) ? pageSnapshot.iframes.length : 0,
      svg: Number(pageSnapshot.svgCount || 0),
      iconLike: Number(pageSnapshot.iconLikeCount || 0),
      sections: Number(pageSnapshot.sectionCount || 0),
      forms: Number(pageSnapshot.formCount || 0),
    };
    const computedText = normalizeBriefingContractText(
      Array.isArray(pageSnapshot.computedTokens)
        ? pageSnapshot.computedTokens.map((token) => `${token.color || ''} ${token.backgroundColor || ''} ${token.backgroundImage || ''} ${token.fontFamily || ''}`).join(' ')
        : ''
    );

    const hasDomainAdherence = !adherence.enabled || adherence.passesMinimum;
    const hasNoDomainConflict = !adherence.enabled || !adherence.hasConflictingDomain;
    const hasHero = normalizeList(pageSnapshot.headings).length > 0 && mediaCounts.sections >= 1;
    const hasVideo = !expectations.wantsVideo || mediaCounts.videos > 0 || mediaCounts.iframes > 0 || includesMediaSource(pageSnapshot, [/\byoutube\b/, /\bvimeo\b/, /\.mp4\b/, /\.webm\b/, /videos\.pexels\.com/]);
    const hasImages = !expectations.wantsImages || mediaCounts.images > 0 || includesMediaSource(pageSnapshot, [
      /\bimage\b/,
      /\bimg\b/,
      /\bjpg\b/,
      /\bjpeg\b/,
      /\bpng\b/,
      /\bwebp\b/,
      /\bgradient\b/,
      /\bradial-gradient\b/,
      /\blinear-gradient\b/,
      /\bbackground\b/,
      /\bhero-video-fallback\b/,
      /\bchocolate\b/,
      /\bcacau\b/,
    ]);
    const hasIcons = !expectations.wantsIcons || mediaCounts.svg > 0 || mediaCounts.iconLike > 0;
    const hasProductContent = !expectations.wantsProducts || hasAnyPattern(renderedText, [
      /\bproduto\b/,
      /\bprodutos\b/,
      /\bsabores\b/,
      /\bcolecao\b/,
      /\bcolecoes\b/,
      /\bchocolate\b/,
      /\bbombom\b/,
      /\bbombons\b/,
      /\btablete\b/,
      /\btabletes\b/,
      /\bavelas\b/,
    ]);
    const hasProcessContent = !expectations.wantsProcess || hasAnyPattern(renderedText, [
      /\bprocesso\b/,
      /\bproducao\b/,
      /\bfabricacao\b/,
      /\btemperagem\b/,
      /\bmoldagem\b/,
      /\bdo grao\b/,
      /\bgrao ao tablete\b/,
      /\betapa\b/,
      /\betapas\b/,
    ]);
    const hasContactContent = !expectations.wantsContact || hasAnyPattern(renderedText, [
      /\bcontato\b/,
      /\batendimento\b/,
      /\bwhatsapp\b/,
      /\bemail\b/,
      /\bfale conosco\b/,
    ]) || mediaCounts.forms > 0;
    const hasFooterContent = !expectations.wantsFooter || hasAnyPattern(renderedText, [
      /\brodape\b/,
      /\binstagram\b/,
      /\bfacebook\b/,
      /\btiktok\b/,
      /\bpinterest\b/,
      /\byoutube\b/,
      /\btodos os direitos\b/,
    ]);
    const ctaText = normalizeBriefingContractText(normalizeList(pageSnapshot.buttons).join(' '));
    const hasCta = !expectations.wantsCTA || hasAnyPattern(`${renderedText} ${ctaText}`, [
      /\bcomprar\b/,
      /\bexplorar\b/,
      /\bescolher\b/,
      /\bconheca\b/,
      /\bver colecao\b/,
      /\bver colecoes\b/,
      /\bfale conosco\b/,
      /\bagendar\b/,
    ]);
    const hasPremiumTone = !expectations.wantsPremiumTone || countMatches(renderedText, [
      /\bpremium\b/,
      /\bsensorial\b/,
      /\bsofisticad[oa]\b/,
      /\belegante\b/,
      /\bartesanal\b/,
      /\bexperiencia\b/,
      /\bsabor\b/,
      /\bqualidade\b/,
      /\bmemoravel\b/,
      /\bhumano\b/,
      /\bhumana\b/,
      /\bconsciencia\b/,
      /\bconsciência\b/,
      /\bpresenca\b/,
      /\bpresença\b/,
      /\bcuidado\b/,
      /\bprofundidade\b/,
      /\bmaturidade\b/,
      /\bresponsabilidade\b/,
      /\bsilencio\b/,
      /\bsilêncio\b/,
      /\beditorial\b/,
    ]) >= 2;
    const hasPaletteTrace = !expectations.expectedHexColors.length ||
      expectations.expectedHexColors.some((hex) => renderedText.includes(hex.replace('#', ''))) ||
      expectations.expectedHexColors.some((hex) => computedText.includes(hex));

    const checks = {
      pageSnapshot: true,
      domainAdherence: hasDomainAdherence,
      noDomainConflict: hasNoDomainConflict,
      hero: hasHero,
      video: hasVideo,
      images: hasImages,
      icons: hasIcons,
      products: hasProductContent,
      process: hasProcessContent,
      contact: hasContactContent,
      footer: hasFooterContent,
      cta: hasCta,
      premiumTone: hasPremiumTone,
      paletteTrace: hasPaletteTrace,
    };
    const weights = {
      pageSnapshot: 6,
      domainAdherence: adherence.enabled ? 22 : 0,
      noDomainConflict: adherence.enabled ? 14 : 0,
      hero: 8,
      video: expectations.wantsVideo ? 10 : 0,
      images: expectations.wantsImages ? 8 : 0,
      icons: expectations.wantsIcons ? 5 : 0,
      products: expectations.wantsProducts ? 10 : 0,
      process: expectations.wantsProcess ? 9 : 0,
      contact: expectations.wantsContact ? 6 : 0,
      footer: expectations.wantsFooter ? 5 : 0,
      cta: expectations.wantsCTA ? 8 : 0,
      premiumTone: expectations.wantsPremiumTone ? 7 : 0,
      paletteTrace: expectations.expectedHexColors.length ? 4 : 0,
    };
    const issues = [];
    const addIssue = (id, severity, detail, hint) => {
      issues.push({ id, severity, detail, hint });
    };

    if (!checks.domainAdherence && adherence.enabled) {
      addIssue(
        'semantic_domain_adherence',
        adherence.severity === 'critical' ? 'critical' : 'error',
        adherence.detail || 'Conteudo renderizado nao aderiu ao dominio do briefing.',
        adherence.hint || 'Reescreva o conteudo visual com termos e secoes do dominio solicitado.'
      );
    }
    if (!checks.video) {
      addIssue('semantic_video_missing', 'error', 'Briefing pediu video, mas o preview renderizado nao mostrou video/player com src valido.', 'Adicionar video, iframe ou source com src real coerente com o briefing.');
    }
    if (!checks.images) {
      addIssue('semantic_images_missing', 'error', 'Briefing pediu experiencia visual com imagens, mas o preview nao mostrou imagens/backgrounds detectaveis.', 'Adicionar imagens reais ou placeholders visuais coerentes com o dominio.');
    }
    if (!checks.icons) {
      addIssue('semantic_icons_missing', 'warning', 'Briefing pediu icones, mas o preview nao mostrou SVGs ou elementos icon-like.', 'Adicionar icones nas areas de beneficios/diferenciais.');
    }
    if (!checks.products) {
      addIssue('semantic_products_missing', 'error', 'Briefing pediu produtos/sabores, mas a pagina renderizada nao trouxe essa secao.', 'Adicionar cards de produtos/sabores alinhados ao dominio.');
    }
    if (!checks.process) {
      addIssue('semantic_process_missing', 'error', 'Briefing pediu processo, mas a pagina renderizada nao apresentou etapas/processo.', 'Adicionar secao de processo com etapas claras.');
    }
    if (!checks.contact) {
      addIssue('semantic_contact_missing', 'warning', 'Briefing pediu contato/atendimento, mas isso nao apareceu no preview.', 'Adicionar contato, email, WhatsApp ou formulario.');
    }
    if (!checks.footer) {
      addIssue('semantic_footer_missing', 'warning', 'Briefing pediu footer/redes sociais, mas isso nao apareceu no preview.', 'Adicionar rodape com links e redes sociais.');
    }
    if (!checks.cta) {
      addIssue('semantic_cta_missing', 'error', 'Briefing pediu CTA, mas nenhum CTA coerente apareceu no preview.', 'Adicionar botao de acao com texto alinhado ao objetivo.');
    }
    if (!checks.premiumTone) {
      addIssue('semantic_tone_weak', 'warning', 'Tom premium/sensorial do briefing ficou fraco no texto renderizado.', 'Usar copy mais sensorial, sofisticada e especifica ao produto.');
    }
    if (!checks.paletteTrace) {
      addIssue('semantic_palette_trace_missing', 'warning', 'Nao encontrei indicio das cores declaradas no briefing no snapshot renderizado.', 'Preservar a paleta visual solicitada no CSS/render.');
    }

    const score = scoreFromChecks(checks, weights);
    const criticalFailures = issues.filter((issue) => issue.severity === 'critical').map((issue) => issue.id);
    const passesMinimum = score >= minSemanticScore && criticalFailures.length === 0 && !issues.some((issue) => issue.severity === 'error');

    return {
      schemaVersion: VISUAL_BRIEFING_SEMANTIC_SCHEMA_VERSION,
      enabled: true,
      score,
      minScore: minSemanticScore,
      passesMinimum,
      checks,
      issues,
      criticalFailures,
      expectations,
      contract: {
        domain: activeContract.domain || '',
        domainLabel: activeContract.domainLabel || '',
        stack: activeContract.stack || '',
        confidence: activeContract.confidence || 0,
      },
      adherence,
      mediaCounts,
      renderedTextPreview: renderedText.slice(0, 600),
      summary: passesMinimum
        ? `Aderencia semantica visual passou (${score}%, minimo ${minSemanticScore}%).`
        : `Aderencia semantica visual falhou (${score}%, minimo ${minSemanticScore}%).`,
    };
  }

  return {
    evaluateVisualBriefingSemantics,
    inferVisualBriefingExpectations,
  };
}

module.exports = {
  VISUAL_BRIEFING_SEMANTIC_SCHEMA_VERSION,
  createVisualBriefingSemanticService,
  inferVisualBriefingExpectations,
};
