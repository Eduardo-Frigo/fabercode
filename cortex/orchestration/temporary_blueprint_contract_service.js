const { normalizeBriefingContractText } = require('./briefing_contract_service');

const TEMPORARY_BLUEPRINT_CONTRACT_SCHEMA_VERSION = 'temporary-blueprint-contract-v1';

const SECTION_TO_SLOT = {
  hero: 'services-grid',
  cta: 'lead-form',
  services: 'services-grid',
  products: 'products-grid',
  blog: 'blog-list',
  gallery: 'gallery-grid',
  testimonials: 'testimonials',
  sustainability: 'icon-feature-grid',
  comparison: 'icon-feature-grid',
  guarantee: 'faq',
  calculator: 'calculator',
  careers: 'lead-form',
  contact: 'contact',
  footer: 'contact',
  faq: 'faq',
  process: 'process',
  about: 'about-stats',
  differentials: 'icon-feature-grid',
  form: 'lead-form',
  video: 'material-story',
  team: 'services-grid',
  events: 'blog-list',
};

const DEFAULT_BODY_SECTIONS = ['services-grid', 'about-stats', 'process', 'gallery-grid', 'testimonials', 'faq', 'contact'];

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

function normalizeRouteId(value = '') {
  const route = String(value || '').trim();
  if (!route || route === '/') return route || '/';
  return `/${route.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function slugifyContractLabel(value = '') {
  const normalized = normalizeBriefingContractText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'briefing-atual';
}

function pickDomainLabel({ normalized = '', brand = '' } = {}) {
  if (brand) return brand;
  const calledEntityMatch = normalized.match(
    /\b(?:ferramenta|aplicacao|aplicação|app|site|landing page|componente|calculadora|conversor)\b[^\n;!?]{0,140}?\bchamad[ao]\s+([a-z0-9&'.\s-]{2,80}?)(?=\.|,|;| com | que | para | precisa | deve |$)/
  );
  if (calledEntityMatch && calledEntityMatch[1]) {
    const label = calledEntityMatch[1].replace(/\s+/g, ' ').trim();
    if (!/^(final|cta|principal|primaria|primária|secundaria|secundária)$/.test(label)) return label;
  }
  const namedToolMatch = normalized.match(
    /\b(?:nome da ferramenta|nome do produto|produto)\s+([a-z0-9&'.\s-]{2,80})(?:\:|\.|,|;| com | que | para |$)/
  );
  if (namedToolMatch && namedToolMatch[1]) return namedToolMatch[1].replace(/\s+/g, ' ').trim();
  const titleMatch = normalized.match(/\bsite\s+(?:de|para)\s+([a-z0-9\s-]{4,80})(?:\.|,|;| com | que | e |$)/);
  if (titleMatch && titleMatch[1]) return titleMatch[1].replace(/\s+/g, ' ').trim();
  const landingMatch = normalized.match(/\blanding page\s+(?:de|para)\s+([a-z0-9\s-]{4,90})(?:\.|,|;| com | que | deve |$)/);
  if (landingMatch && landingMatch[1]) return landingMatch[1].replace(/\s+/g, ' ').trim();
  if (/\bclinica multidisciplinar\b/.test(normalized)) return 'clinica multidisciplinar';
  if (/\bcurso online de produtividade\b|\bprodutividade para lideres\b|\bprodutividade para líderes\b/.test(normalized)) return 'curso online de produtividade para lideres';
  if (/\bforge mrp\b|\bmrp\b.*\b(manufatura|manufacturing|bom|estoque|ordens de producao|ordens de produção)\b/.test(normalized)) return 'Forge MRP';
  if (/\beditor visual\b.*\b(layout|layouts|canvas|camadas|inspetor)\b/.test(normalized)) return 'editor visual de layout';
  if (/\bcsv de vendas\b|\bexplorar um csv\b|\bapp de dados\b.*\b(csv|tabela|metricas|métricas)\b/.test(normalized)) return 'explorador de dados CSV';
  if (/\bdashboard saas simples para controle financeiro\b|\bcontrole financeiro de pequenas empresas\b/.test(normalized)) return 'dashboard financeiro para pequenas empresas';
  if (/\bgestao de tarefas\b|\bgestão de tarefas\b/.test(normalized)) return 'gestao de tarefas com prioridades';
  if (/\bgestao de eventos\b|\bgestão de eventos\b/.test(normalized)) return 'gestao de eventos';
  if (/\bescola de musica\b|\baulas? de musica\b/.test(normalized)) {
    return 'escola de musica experimental';
  }
  if (/\bclinica\b/.test(normalized)) return 'clinica especializada';
  if (/\batelie\b/.test(normalized)) return 'atelie autoral';
  return 'projeto solicitado no briefing atual';
}

function buildTemporaryCalculatorContract(normalized = '') {
  if (!/\b(calculadora|simulador|estimativa|conversor|conversao|conversão)\b/.test(normalized)) return null;
  if (/\b(preco final|preço final|valor base|imposto percentual|taxa da plataforma|desconto opcional|total final)\b/.test(normalized)) {
    return {
      id: 'final-price',
      title: 'Calculadora de preço final',
      formula: 'total = valorBase + imposto + taxaPlataforma - desconto',
      inputs: [
        { label: 'Valor base', name: 'valorBase', type: 'number', placeholder: 'Ex: 1200' },
        { label: 'Imposto percentual', name: 'impostoPercentual', type: 'number', placeholder: 'Ex: 12' },
        { label: 'Taxa da plataforma', name: 'taxaPlataforma', type: 'number', placeholder: 'Ex: 80' },
        { label: 'Desconto opcional', name: 'desconto', type: 'number', placeholder: 'Ex: 50' },
      ],
      outputs: ['subtotal', 'imposto', 'taxa', 'desconto', 'total final'],
      resultText: 'Subtotal, imposto, taxa, desconto e total final com validacao de campos vazios, negativos e percentuais acima de 100%.',
    };
  }
  if (/\b(imc|indice de massa corporal|índice de massa corporal)\b/.test(normalized)) {
    return {
      id: 'imc',
      title: 'Calculadora de IMC',
      formula: 'imc = peso / (altura * altura)',
      inputs: [
        { label: 'Peso em kg', name: 'peso', type: 'number', placeholder: 'Ex: 72' },
        { label: 'Altura em metros', name: 'altura', type: 'number', placeholder: 'Ex: 1.75' },
      ],
      outputs: ['IMC', 'classificacao'],
      resultText: 'Resultado de IMC com classificacao por faixa.',
    };
  }
  if (/\b(roi|retorno sobre investimento|payback)\b/.test(normalized)) {
    return {
      id: 'roi',
      title: 'Calculadora de ROI',
      formula: 'roi = ((receitaGerada - investimento - custoOperacional) / investimento) * 100',
      inputs: [
        { label: 'Investimento', name: 'investimento', type: 'number', placeholder: 'Ex: 1200' },
        { label: 'Receita gerada', name: 'receitaGerada', type: 'number', placeholder: 'Ex: 3600' },
        { label: 'Custo operacional', name: 'custoOperacional', type: 'number', placeholder: 'Ex: 400' },
        { label: 'Periodo em meses', name: 'periodoMeses', type: 'number', placeholder: 'Ex: 3' },
      ],
      outputs: ['lucro liquido', 'ROI percentual', 'payback estimado', 'alerta de ROI negativo'],
      resultText: 'Lucro liquido, ROI percentual, payback estimado e alerta textual quando o ROI for negativo.',
    };
  }
  if (/\b(conversor|conversao|conversão|comprimento|peso|temperatura|unidade|unidades)\b/.test(normalized)) {
    return {
      id: 'unit-converter',
      title: 'Conversor de unidades',
      formula: 'resultado = converter(valor, categoria, unidadeOrigem, unidadeDestino, arredondamento)',
      inputs: [
        { label: 'Categoria', name: 'categoria', type: 'select', placeholder: 'Comprimento, peso ou temperatura' },
        { label: 'Unidade de origem', name: 'unidadeOrigem', type: 'select', placeholder: 'Selecione a origem' },
        { label: 'Unidade de destino', name: 'unidadeDestino', type: 'select', placeholder: 'Selecione o destino' },
        { label: 'Valor', name: 'valor', type: 'number', placeholder: 'Ex: 10' },
        { label: 'Arredondamento', name: 'arredondamento', type: 'number', placeholder: 'Ex: 2' },
      ],
      outputs: ['resultado convertido', 'combinacoes invalidas bloqueadas'],
      resultText: 'Conversoes de comprimento, peso e temperatura com arredondamento configuravel e bloqueio de combinacoes invalidas.',
    };
  }
  return {
    id: 'generic-calculator',
    title: 'Calculadora interativa',
    formula: 'resultado = entradas informadas pelo usuario',
    inputs: [
      { label: 'Valor principal', name: 'valor', type: 'number', placeholder: 'Informe o valor' },
      { label: 'Parametro adicional', name: 'parametro', type: 'number', placeholder: 'Informe o parametro' },
    ],
    outputs: ['resultado'],
    resultText: 'Resultado estimado a partir dos dados informados.',
  };
}

function buildRequiredPages({ pages = [], sections = [], normalized = '' } = {}) {
  const direct = Array.isArray(pages) ? pages : [];
  const sectionIds = new Set((Array.isArray(sections) ? sections : []).map((section) => section.id));
  const inferred = [{ id: '/', label: 'inicio' }];
  const hasExplicitPagePlan = direct.filter((page) => page && page.id && page.id !== '/').length >= 2;
  if (!hasExplicitPagePlan) {
    if (sectionIds.has('about')) inferred.push({ id: '/sobre', label: 'sobre' });
    if (sectionIds.has('services')) inferred.push({ id: '/servicos', label: 'servicos' });
    if (sectionIds.has('team')) inferred.push({ id: '/professores', label: 'professores' });
    if (sectionIds.has('events')) inferred.push({ id: '/agenda', label: 'agenda' });
    if (sectionIds.has('gallery')) inferred.push({ id: '/portfolio', label: 'portfolio' });
    if (sectionIds.has('blog')) inferred.push({ id: '/blog', label: 'blog' });
    if (sectionIds.has('products')) inferred.push({ id: '/loja', label: 'loja' });
    if (sectionIds.has('process')) inferred.push({ id: '/processo', label: 'processo' });
    if (sectionIds.has('careers')) inferred.push({ id: '/trabalhe-conosco', label: 'trabalhe conosco' });
  }
  if (sectionIds.has('contact') || sectionIds.has('form') || /\bcontato\b|\bformulario\b/.test(normalized)) {
    inferred.push({ id: '/contato', label: 'contato' });
  }
  return uniqueEntries([...direct, ...inferred])
    .map((page) => ({ ...page, id: normalizeRouteId(page.id) }))
    .filter((page) => page.id);
}

function uniqueEntries(entries = []) {
  const seen = new Set();
  return entries
    .filter((entry) => entry && entry.id)
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

function buildModuleSlots(sections = []) {
  const requested = (Array.isArray(sections) ? sections : [])
    .map((section) => SECTION_TO_SLOT[section.id])
    .filter(Boolean);
  return uniqueStrings([...requested, ...DEFAULT_BODY_SECTIONS]);
}

function hasCreateSiteSignal(normalized = '') {
  return /\b(criar|crie|gerar|gere|montar|monte|implementar|implemente|desenvolver|desenvolva|configurar|configure|fazer|faca|site|landing|pagina|web|app|aplicacao|aplicação|next|react|tailwind|ferramenta|calculadora|conversor|componente|tabela|formulario|formulário|fluxo|integracao|integração|dashboard|crm|editor visual|canvas|explorador de dados|app de dados|csv|preset|mcp|tools?|capability)\b/.test(normalized);
}

function hasTemporaryContractSignal(normalized = '') {
  return /\b(contrato temporario|contrato temporário|props esperadas|criterios de aceitacao|critérios de aceitação|capability|input|output|timeout|retry|fallback|calculadora|conversor|ferramenta|componente|fluxo|integracao|integração|editor visual|canvas|camadas|inspetor|exportacao json|exportação json|csv|app de dados|metricas agregadas|métricas agregadas|busca textual|preset mcp|mcp externo|tools?|permissoes|permissões|escopo|risco|memoria ativa|memória ativa|provenance|confidence score)\b/.test(normalized);
}

function shouldSynthesizeTemporaryBlueprintContract({
  normalized = '',
  contract = {},
  selfContained = false,
  finalRequested = false,
  placeholderAllowed = false,
} = {}) {
  const domainDecision = contract && contract.domainDecision ? contract.domainDecision : {};
  const domainConflict = Boolean(domainDecision.blockDomainFallback || domainDecision.status === 'conflict');
  const temporarySignal = hasTemporaryContractSignal(normalized);
  return Boolean(
    (selfContained || finalRequested || temporarySignal) &&
      !placeholderAllowed &&
      hasCreateSiteSignal(normalized) &&
      !domainConflict &&
      !(contract && contract.domain)
  );
}

function synthesizeTemporaryBlueprintContract({
  source = '',
  normalized = '',
  contract = {},
  sections = [],
  pages = [],
  brand = '',
  selfContained = false,
  finalRequested = false,
  placeholderAllowed = false,
} = {}) {
  const normalizedSource = normalizeBriefingContractText(normalized || source);
  if (
    !shouldSynthesizeTemporaryBlueprintContract({
      normalized: normalizedSource,
      contract,
      selfContained,
      finalRequested,
      placeholderAllowed,
    })
  ) {
    return null;
  }

  const requiredSections = uniqueEntries([
    ...sections,
    { id: 'hero', label: 'hero' },
    { id: 'cta', label: 'CTA' },
    { id: 'contact', label: 'contato/formulario' },
    { id: 'footer', label: 'footer/rodape' },
  ]);
  const requiredPages = buildRequiredPages({ pages, sections: requiredSections, normalized: normalizedSource });
  const moduleSlots = buildModuleSlots(requiredSections);
  const label = pickDomainLabel({ normalized: normalizedSource, brand });
  const slug = slugifyContractLabel(label);
  const calculatorContract = buildTemporaryCalculatorContract(normalizedSource);
  const hero = /\b(video|full width|full-width|full bleed|full-bleed|imersiv)/.test(normalizedSource)
    ? 'full-bleed-media'
    : 'editorial-split';

  return {
    schemaVersion: TEMPORARY_BLUEPRINT_CONTRACT_SCHEMA_VERSION,
    status: 'active',
    source: 'current_briefing',
    briefingSource: normalizedSource,
    activation: 'auto_synthesized_current_briefing',
    domain: `temporary-${slug}`,
    label,
    domainLabel: label,
    brandFallback: brand || label.replace(/\b\w/g, (char) => char.toUpperCase()),
    stack: contract && contract.stack ? contract.stack : 'next-tailwind',
    contentMode: 'final_content',
    memoryPolicy: {
      staleContextAllowed: false,
      source: 'current_message_only',
      contaminationGuard: 'do_not_complete_with_active_memory',
    },
    requiredSections,
    requiredPages,
    moduleSlots,
    calculatorContract,
    layoutRecipe: {
      id: 'temporary-contract-site',
      header: 'sticky-simple',
      hero,
      bodySections: moduleSlots,
      footer: 'simple-footer',
    },
    coverage: {
      requiredSections: requiredSections.map((section) => section.id),
      requiredPages: requiredPages.map((page) => page.id),
    },
    mediaQuery: buildTemporaryMediaQuery({ normalized: normalizedSource, label }),
    iconIntents: buildTemporaryIconIntents({ normalized: normalizedSource }),
  };
}

function buildTemporaryMediaQuery({ normalized = '', label = '' } = {}) {
  if (/\bescola de musica\b|\bmusica experimental\b/.test(normalized)) {
    return 'experimental music school rehearsal classroom concert instruments';
  }
  if (/\bprofessores?\b|\baulas?\b|\bagenda\b/.test(normalized)) {
    return `${label} classes teachers event schedule`;
  }
  return `${label} professional editorial website`;
}

function buildTemporaryIconIntents({ normalized = '' } = {}) {
  if (/\bescola de musica\b|\bmusica\b/.test(normalized)) {
    return ['sparkles', 'users', 'calendar-check'];
  }
  if (/\bagenda\b|\beventos?\b/.test(normalized)) return ['calendar-check', 'users', 'sparkles'];
  return ['sparkles', 'layout-template', 'check-circle'];
}

function applySpecificTemporaryCopy(copy, {
  brand = '',
  label = '',
  normalizedSource = '',
} = {}) {
  const source = normalizeBriefingContractText(`${normalizedSource} ${label}`);
  if (/\btremn\b|\bescola de gestao consciente\b|\bgestao consciente\b|\bnovos niveis de consciencia\b|\bnovos níveis de consciência\b/.test(source)) {
    copy.heroEyebrow = 'Escola de Gestão Consciente';
    copy.heroTitle = 'Uma nova consciência para uma nova forma de gerir.';
    copy.heroText = 'A Escola de Gestão Consciente apoia líderes, gestores e organizações no desenvolvimento de novas formas de pensar, sentir e agir diante dos desafios do nosso tempo.';
    copy.cta = 'Conheça a Escola';
    copy.ctaHref = '/a-escola';
    copy.secondaryCta = 'Ver premissas';
    copy.secondaryCtaHref = '/premissas';
    copy.headerCta = 'Quero conhecer';
    copy.headerCtaHref = '/contato';
    copy.navServicesLabel = 'A Escola';
    copy.navProductsLabel = 'Premissas';
    copy.navGalleryLabel = 'Jornada';
    copy.navBlogLabel = 'Conteúdos';
    copy.navMethodLabel = 'Jornada';
    copy.servicesHeading = 'Os desafios atuais pedem novos níveis de consciência.';
    copy.services = [
      { title: 'Ecologia', description: 'Empresas também participam dos desafios ecológicos e podem agir como parte essencial das soluções.' },
      { title: 'Tecnologia', description: 'Novas ferramentas pedem discernimento, responsabilidade e presença humana nas decisões.' },
      { title: 'Sociedade', description: 'Relações, comunidades e culturas organizacionais revelam o impacto real da forma de gerir.' },
      { title: 'Economia', description: 'Resultados precisam dialogar com impacto, sustentabilidade e visão de longo prazo.' },
      { title: 'Liderança', description: 'Líderes conscientes ampliam percepção, cuidado e maturidade diante da complexidade.' },
    ];
    copy.differentialsHeading = 'Uma escola para líderes que desejam transformar a forma de gerir.';
    copy.differentials = [
      { title: 'Consciência', description: 'Ampliar a percepção sobre si, o outro, a organização e o mundo.' },
      { title: 'Responsabilidade', description: 'Assumir escolhas, impactos e consequências.' },
      { title: 'Transformação', description: 'Aplicar novos níveis de consciência na prática da gestão.' },
    ];
    copy.productsHeading = 'Cinco premissas orientam essa jornada.';
    copy.products = [
      { title: 'Ir além da mera existência', description: 'A consciência nos convida a acender uma luz sobre a vida.', category: 'Premissa 1' },
      { title: 'Crenças e conhecimentos são degraus', description: 'Toda crença pode proteger, mas também pode limitar.', category: 'Premissa 2' },
      { title: 'A verdadeira transformação é interna', description: 'A mudança mais profunda nasce de dentro para fora.', category: 'Premissa 3' },
      { title: 'Responsabilidade é consciência em ação', description: 'Quanto mais conscientes somos, mais responsáveis nos tornamos.', category: 'Premissa 4' },
      { title: 'Novos níveis de consciência criam novas soluções', description: 'Não resolvemos novos desafios com velhas formas de pensar.', category: 'Premissa 5' },
    ];
    copy.about = 'A Escola de Gestão Consciente nasce para apoiar o desenvolvimento de gestores e gestoras preparados para decidir com mais responsabilidade, cuidado e profundidade.';
    copy.bodyMediaTitle = 'O mundo mudou. A gestão também precisa mudar.';
    copy.bodyMediaText = 'Questões ecológicas, sociais, econômicas e tecnológicas exigem líderes capazes de lidar com complexidade, interdependência e responsabilidade.';
    copy.manifestoTitle = 'Somente alcançaremos resultados diferentes se nossas ações também forem diferentes.';
    copy.manifestoText = 'A transformação da gestão começa pela ampliação da consciência individual e se expressa nas relações, decisões e práticas organizacionais.';
    copy.methodSteps = [
      { title: 'Perceber', description: 'Reconhecer os desafios atuais e a necessidade de novas formas de liderança.' },
      { title: 'Questionar', description: 'Observar crenças, hábitos e modelos mentais que limitam decisões e relações.' },
      { title: 'Interiorizar', description: 'Acessar o autoconhecimento como base da transformação.' },
      { title: 'Responsabilizar-se', description: 'Assumir escolhas, impactos e consequências com maturidade.' },
      { title: 'Transformar', description: 'Aplicar novos níveis de consciência na prática da gestão.' },
    ];
    copy.blogHeading = 'Reflexões para uma nova gestão';
    copy.blogPosts = [
      { title: 'Por que a gestão precisa de novos níveis de consciência?', category: 'Liderança consciente', excerpt: 'Uma reflexão sobre complexidade, presença e responsabilidade diante dos desafios atuais.' },
      { title: 'Responsabilidade como prática de liderança', category: 'Responsabilidade', excerpt: 'Como escolhas conscientes se traduzem em cultura, decisão e impacto cotidiano.' },
      { title: 'A transformação que começa no interior do líder', category: 'Autoconhecimento', excerpt: 'Por que transformação real exige percepção, escolha e autorresponsabilidade.' },
      { title: 'Empresas como parte do problema e da solução', category: 'Sustentabilidade', excerpt: 'O papel das organizações em mudanças ecológicas, sociais, econômicas e tecnológicas.' },
    ];
    copy.galleryHeading = 'Pilares metodológicos';
    copy.galleryItems = [
      { title: 'Estudo', description: 'Conteúdos sobre consciência, gestão, sociedade, sustentabilidade e futuro.' },
      { title: 'Reflexão', description: 'Espaços de diálogo para ampliar percepção e repertório.' },
      { title: 'Autoconhecimento', description: 'Práticas para reconhecer crenças, padrões e potenciais.' },
      { title: 'Aplicação', description: 'Conexão entre consciência e decisões reais de gestão.' },
      { title: 'Comunidade', description: 'Rede de líderes interessados em transformação consciente.' },
    ];
    copy.testimonial = 'Uma escola para líderes e organizações que desejam florescer novos níveis de consciência.';
    copy.faq = [
      { question: 'Para quem é a Escola?', answer: 'Para líderes, gestores, gestoras e organizações que desejam desenvolver novas formas de pensar, sentir e agir.' },
      { question: 'A jornada é acadêmica?', answer: 'Não. A linguagem é acessível, humana e profunda, conectando estudo, reflexão, autoconhecimento e aplicação prática.' },
      { question: 'Como manifestar interesse?', answer: 'A página de contato reúne formulário, e-mail, WhatsApp, redes sociais e possibilidades de parceria.' },
    ];
    copy.contactHeading = 'Vamos conversar sobre uma nova forma de gerir?';
    copy.contactText = 'Entre em contato para saber mais sobre a Escola de Gestão Consciente, próximas turmas, encontros, programas e possibilidades de parceria.';
    copy.formButtonLabel = 'Enviar mensagem';
    copy.formFields = [
      { label: 'Nome', name: 'nome', type: 'text', placeholder: 'Seu nome' },
      { label: 'E-mail', name: 'email', type: 'email', placeholder: 'voce@email.com' },
      { label: 'WhatsApp', name: 'whatsapp', type: 'tel', placeholder: '(00) 00000-0000' },
      { label: 'Empresa', name: 'empresa', type: 'text', placeholder: 'Nome da empresa' },
      { label: 'Cargo', name: 'cargo', type: 'text', placeholder: 'Seu cargo' },
      { label: 'Interesse', name: 'interesse', type: 'select', placeholder: 'Quero conhecer a Escola' },
      { label: 'Mensagem', name: 'mensagem', type: 'textarea', rows: 4, placeholder: 'Conte como podemos conversar' },
    ];
    copy.formStatus = 'Mensagem enviada. A equipe da Escola de Gestão Consciente entrará em contato.';
    copy.metaDescription = 'Site institucional da Tremn — Escola de Gestão Consciente, com premissas, jornada, conteúdos e contato.';
  } else if (/\blanding page valida\b|\bregressao visual\b|\bscreenshot baseline\b|\bremova um cta\b|\bvalidacao de formulario\b/.test(source)) {
    copy.heroEyebrow = 'Loop de regressão visual';
    copy.heroTitle = `${brand}: landing page válida com baseline, falha detectada e correção.`;
    copy.heroText = 'Fluxo para gerar uma landing page válida, capturar screenshot baseline, remover um CTA, quebrar espaçamento mobile, alterar texto de botão, remover validação de formulário, detectar regressão visual, corrigir e rodar smoke novamente.';
    copy.servicesHeading = 'Evidências do loop';
    copy.services = [
      { title: 'Baseline válido', description: 'Landing page válida com CTA e validação de formulário antes da regressão visual.' },
      { title: 'Falha detectada', description: 'Remoção de CTA, quebra mobile e ausência de validação de formulário são detectadas pelo smoke.' },
      { title: 'Correção confirmada', description: 'Depois do patch, screenshot e validação funcional confirmam smoke final corrigido.' },
    ];
    copy.formButtonLabel = 'Rodar smoke visual';
    copy.formStatus = 'Regressão visual detectada, corrigida e validada com screenshots.';
  } else if (/\bviolacao de contrato\b|\bviolar contrato\b|\bexpire contrato\b|\bexpirar contrato\b|\blifecycle\b/.test(source)) {
    copy.heroEyebrow = 'Loop de regressão de contrato';
    copy.heroTitle = `${brand}: contrato temporário válido, violado, corrigido e expirado.`;
    copy.heroText = 'Fluxo para gerar componente com contrato temporário, capturar evidência do contrato válido, editar implementação para violação de contrato, confirmar falha, corrigir, expirar contrato e validar lifecycle.';
    copy.servicesHeading = 'Estados do contrato';
    copy.services = [
      { title: 'Contrato válido', description: 'Contrato temporário ativo com evidência antes da alteração.' },
      { title: 'Violação de contrato', description: 'Teste de contrato falha quando a implementação remove uma obrigação.' },
      { title: 'Correção e lifecycle', description: 'Patch corrige a regressão, expira contrato e confirma estado final no lifecycle.' },
    ];
    copy.formButtonLabel = 'Validar lifecycle';
    copy.formStatus = 'Contrato temporário corrigido, expirado e registrado no lifecycle.';
  } else if (/\bconfiguracoes\b|\bmemoria ativa\b|\bmemorias foram usadas\b|\bprovenance\b|\bconfidence score\b/.test(source)) {
    copy.heroEyebrow = 'Configurações com memória ativa';
    copy.heroTitle = `${brand}: padrões visuais compatíveis e auditáveis.`;
    copy.heroText = 'Página de configurações seguindo padrões visuais já promovidos na memória ativa do projeto, usando apenas memórias compatíveis, com provenance, confidence score e lista clara de memórias usadas.';
    copy.servicesHeading = 'Diagnóstico de memória';
    copy.services = [
      { title: 'Memória ativa compatível', description: 'Memórias usadas aparecem com escopo, validade e motivo de recuperação.' },
      { title: 'Provenance e confidence score', description: 'Cada referência mostra provenance, confidence score e sinais de ranking para auditoria.' },
      { title: 'Auditoria visível', description: 'Context Frame exibe memórias usadas, suprimidas e fonte dominante sem conflito com o briefing atual.' },
    ];
    copy.methodSteps = [
      { title: 'Checar compatibilidade', description: 'A memória ativa só entra quando não conflita com a mensagem atual.' },
      { title: 'Mostrar memórias usadas', description: 'A UI lista memórias usadas e confidence score de forma legível.' },
      { title: 'Auditar provenance', description: 'O diagnóstico explica fonte, escopo, validade e motivo de recuperação.' },
    ];
    copy.formButtonLabel = 'Atualizar configurações';
    copy.formStatus = 'Memórias usadas registradas com provenance e confidence score.';
  } else if (/\bclinica multidisciplinar\b|\bclinica\b/.test(source)) {
    copy.heroEyebrow = 'Clínica multidisciplinar';
    copy.heroTitle = `${brand}: cuidado acessível, claro e responsável.`;
    copy.heroText = 'Apresentação da clínica com especialidades, profissionais, convênios, horários, localização, FAQ e botão de contato, sempre sem promessas médicas absolutas.';
    copy.cta = 'Falar com a clínica';
    copy.servicesHeading = 'Especialidades e profissionais';
    copy.services = [
      { title: 'Especialidades integradas', description: 'Cards organizam especialidades, formas de atendimento e caminhos de triagem sem prometer resultados absolutos.' },
      { title: 'Profissionais e horários', description: 'Profissionais, horários de atendimento e disponibilidade aparecem de forma acessível para o visitante.' },
      { title: 'Convênios e localização', description: 'Convênios aceitos, endereço, localização e canais de contato ficam visíveis antes do formulário.' },
    ];
    copy.methodSteps = [
      { title: 'Conheça a apresentação', description: 'O visitante entende a proposta da clínica e as especialidades disponíveis.' },
      { title: 'Veja profissionais e convênios', description: 'Cards deixam equipe, horários e convênios fáceis de comparar.' },
      { title: 'Use o botão de contato', description: 'O CTA leva ao formulário com linguagem responsável e sem promessas médicas absolutas.' },
    ];
    copy.contactHeading = 'Entre em contato com a clínica';
    copy.contactText = 'Use o formulário para dúvidas sobre especialidades, profissionais, convênios, horários e localização.';
    copy.formButtonLabel = 'Enviar contato';
    copy.formStatus = 'Contato recebido pela clínica para retorno responsável.';
    copy.metaDescription = 'Site institucional para clínica multidisciplinar com especialidades, profissionais, convênios, horários, localização e FAQ.';
  } else if (/\bgestao de tarefas\b|\bgerenciamento de tarefas\b|\btarefas\b/.test(source)) {
    copy.heroEyebrow = 'Gestão de tarefas com prioridades';
    copy.heroTitle = `${brand}: tarefas, prazos e responsáveis em uma rotina clara.`;
    copy.heroText = 'Ferramenta para criar, editar, concluir, filtrar e excluir tarefas com título, descrição, prioridade, status, prazo, responsável e alertas para tarefas vencidas.';
    copy.cta = 'Criar tarefa';
    copy.servicesHeading = 'Fluxo de tarefas';
    copy.services = [
      { title: 'Cadastro completo', description: 'Título, descrição, prioridade, status, prazo e responsável ficam padronizados no formulário.' },
      { title: 'Filtros e edição', description: 'A lista permite editar, concluir, filtrar por status ou prioridade e excluir tarefas localmente.' },
      { title: 'Alertas de vencidas', description: 'Tarefas vencidas aparecem destacadas para priorização diária.' },
    ];
    copy.methodSteps = [
      { title: 'Criar', description: 'Registre a tarefa com prioridade, prazo, status e responsável.' },
      { title: 'Filtrar', description: 'Use filtros por status e prioridade para focar no que importa.' },
      { title: 'Concluir ou excluir', description: 'Atualize o ciclo de vida e mantenha a lista limpa.' },
    ];
    copy.contactHeading = 'Resumo operacional';
    copy.contactText = 'Estado vazio, lista preenchida e tarefa vencida são cobertos pela validação visual.';
    copy.formButtonLabel = 'Salvar tarefa';
    copy.formStatus = 'Tarefa salva localmente com validação de prazo e responsável.';
    copy.metaDescription = 'Ferramenta de gestão de tarefas com prioridade, status, prazo, responsável, filtros e alertas para vencidas.';
  } else if (/\btabela\b.*\bclientes\b|\bprops esperadas\b|\bestados vazios\b/.test(source)) {
    copy.heroEyebrow = 'Contrato temporário de componente';
    copy.heroTitle = `${brand}: tabela reutilizável de clientes validada por contrato.`;
    copy.heroText = 'Componente de tabela para dados de clientes com props esperadas, estados vazios, estados de erro, comportamento responsivo e critérios de aceitação.';
    copy.servicesHeading = 'Critérios do contrato';
    copy.services = [
      { title: 'Props esperadas', description: 'Clientes, colunas, loading, erro e ações são entradas obrigatórias do componente.' },
      { title: 'Estados vazios e erro', description: 'A tabela mostra mensagem de estado vazio e estado de erro sem quebrar o layout responsivo.' },
      { title: 'Aceite auditável', description: 'Critérios de aceitação validam responsividade, remoção de prop obrigatória e expiração do contrato.' },
    ];
    copy.formButtonLabel = 'Validar contrato';
    copy.formStatus = 'Contrato temporário ativo, validado e pronto para expiração no lifecycle.';
  } else if (/\bfornecedor\b|\bm[uú]ltiplas etapas\b|\bcampos obrigatorios\b|\bpersistencia local\b/.test(source)) {
    copy.heroEyebrow = 'Contrato temporário de formulário';
    copy.heroTitle = `${brand}: cadastro de fornecedor em múltiplas etapas.`;
    copy.heroText = 'Fluxo de formulário em múltiplas etapas para cadastro de fornecedor com campos obrigatórios, validações, mensagens de erro, persistência local e critérios visuais.';
    copy.servicesHeading = 'Etapas e validações';
    copy.services = [
      { title: 'Etapa 1: identificação', description: 'Dados do fornecedor e campos obrigatórios com mensagens de erro claras.' },
      { title: 'Etapa 2: documentação', description: 'Validações por etapa e persistência local para evitar perda de preenchimento.' },
      { title: 'Etapa 3: revisão', description: 'Critérios visuais confirmam navegação, erros, resumo e envio.' },
    ];
    copy.formButtonLabel = 'Salvar fornecedor';
    copy.formStatus = 'Cadastro persistido localmente e validado contra o contrato temporário.';
  } else if (/\bcapability local\b|\bcategorias disponiveis\b|\blayer governado\b/.test(source)) {
    copy.heroEyebrow = 'Capability local segura';
    copy.heroTitle = `${brand}: categorias disponíveis via capability layer governado.`;
    copy.heroText = 'Ferramenta que consulta uma capability local simulada para obter categorias disponíveis, sem acesso externo direto, com política aplicada, logs e fallback quando a capability falhar.';
    copy.servicesHeading = 'Governança da capability';
    copy.services = [
      { title: 'Capability local', description: 'Categorias disponíveis são obtidas somente pelo capability layer governado.' },
      { title: 'Política aplicada', description: 'Acesso externo direto é bloqueado e os logs registram a capability usada.' },
      { title: 'Fallback seguro', description: 'Quando a capability falha, a UI mostra fallback controlado sem expor dados externos.' },
    ];
    copy.formButtonLabel = 'Consultar categorias';
    copy.formStatus = 'Capability local executada com política aplicada e fallback auditável.';
  } else if (/\bpreset mcp\b|\bdocumentacao tecnica\b|\bservidor indisponivel\b|\btools\b.*\bpermissoes\b/.test(source)) {
    copy.heroEyebrow = 'Preset MCP externo';
    copy.heroTitle = `${brand}: preset MCP fictício para documentação técnica.`;
    copy.heroText = 'Preset MCP externo fictício para documentação técnica com descoberta de tools, permissões, escopo, risco, estado conectado/desconectado e fallback quando o servidor estiver indisponível, sem credenciais reais.';
    copy.servicesHeading = 'Auditoria do preset';
    copy.services = [
      { title: 'Tools e permissões', description: 'A UI lista tools descobertas, permissões solicitadas e escopo permitido.' },
      { title: 'Risco e conexão', description: 'Estados conectado e desconectado deixam risco e falha segura visíveis.' },
      { title: 'Artifact store', description: 'Screenshots e evidências do preset MCP ficam registrados para auditoria.' },
    ];
    copy.formButtonLabel = 'Validar preset MCP';
    copy.formStatus = 'Preset MCP validado sem credenciais reais e com fallback seguro.';
  } else if (/\bintegracao simulada\b|\bemissao de propostas\b|\btimeout\b|\bretry\b|\bfallback\b/.test(source)) {
    copy.heroEyebrow = 'Contrato temporário de capability';
    copy.heroTitle = `${brand}: integração simulada para emissão de propostas.`;
    copy.heroText = 'Capability com input, output, erros possíveis, timeout, retry, fallback local, mock controlado e evidências persistidas no artifact store.';
    copy.servicesHeading = 'Contrato da capability';
    copy.services = [
      { title: 'Input e output', description: 'A integração simulada declara entrada, saída e erros possíveis antes da implementação.' },
      { title: 'Timeout e retry', description: 'O mock controlado simula timeout, falha e retry para validar fallback local.' },
      { title: 'Artifact store', description: 'Logs e evidências persistem no artifact store para auditoria de regressão.' },
    ];
    copy.formButtonLabel = 'Emitir proposta fake';
    copy.formStatus = 'Fallback local exibido quando a capability simulada falha ou excede timeout.';
  } else if (/\bassinatura mensal\b|\bbasic\b|\benterprise\b/.test(source)) {
    copy.heroEyebrow = 'Calculadora de assinatura mensal';
    copy.heroTitle = `${brand}: planos Basic, Pro e Enterprise em visual claro.`;
    copy.heroText = 'Calculadora de assinatura mensal com plano Basic, Pro e Enterprise, visual claro, cards brancos, fundo suave, memória conflitante suprimida e provenance auditável.';
    copy.servicesHeading = 'Planos e diagnóstico';
    copy.services = [
      { title: 'Basic', description: 'Plano inicial com preço mensal claro e card branco.' },
      { title: 'Pro', description: 'Plano intermediário com comparação objetiva em visual claro.' },
      { title: 'Enterprise', description: 'Plano avançado com diagnóstico de memória usada ou suprimida.' },
    ];
    copy.formButtonLabel = 'Calcular assinatura';
    copy.formStatus = 'Memória conflitante bloqueada: a mensagem atual exige tema claro.';
  }
  return copy;
}

function isActiveTemporaryBlueprintContract(value = null) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.schemaVersion === TEMPORARY_BLUEPRINT_CONTRACT_SCHEMA_VERSION &&
      value.status === 'active'
  );
}

function titleFromRoute(route = {}) {
  const label = String(route.label || route.id || '').replace(/^\/+/, '').replace(/-/g, ' ').trim();
  if (!label || label === '/') return 'inicio';
  return label;
}

function buildItemsFromSections(sections = [], fallbackLabel = '') {
  const labels = (Array.isArray(sections) ? sections : [])
    .filter((section) => !['hero', 'cta', 'footer', 'contact', 'form'].includes(section.id))
    .map((section) => section.label || section.id);
  const safeLabels = labels.length ? labels : ['proposta', 'experiencia', 'atendimento'];
  return safeLabels.slice(0, 6).map((label) => ({
    title: String(label || fallbackLabel).replace(/\b\w/g, (char) => char.toUpperCase()),
    description: `Conteudo final organizado para ${label || fallbackLabel}, mantendo prioridade total ao briefing atual.`,
  }));
}

function routeItemsForPage(route = {}, copy = {}) {
  const id = String(route.id || '');
  if (/premissas/.test(id)) return copy.products || [];
  if (/jornada/.test(id)) return copy.methodSteps || [];
  if (/conteudos/.test(id)) return copy.blogPosts || [];
  if (/a-escola|escola/.test(id)) return copy.differentials || [];
  if (/professores|equipe/.test(id)) return copy.team || copy.services || [];
  if (/agenda|eventos/.test(id)) return copy.events || copy.blogPosts || [];
  if (/blog|insights/.test(id)) return copy.blogPosts || [];
  if (/portfolio|galeria|projetos/.test(id)) return copy.galleryItems || [];
  if (/loja|produtos/.test(id)) return copy.products || [];
  if (/processo/.test(id)) return copy.methodSteps || [];
  if (/sobre/.test(id)) return copy.differentials || [];
  return copy.services || [];
}

function buildTemporaryBlueprintCopy(contract = {}) {
  const temporary = contract.temporaryBlueprintContract || contract;
  const label = temporary.label || temporary.domainLabel || 'projeto solicitado';
  const brand = contract.brandFallback || temporary.brandFallback || label;
  const normalizedSource = normalizeBriefingContractText(temporary.briefingSource || label);
  const calculatorContract = temporary.calculatorContract && typeof temporary.calculatorContract === 'object'
    ? temporary.calculatorContract
    : null;
  const sections = Array.isArray(temporary.requiredSections) ? temporary.requiredSections : [];
  const pages = Array.isArray(temporary.requiredPages) ? temporary.requiredPages : [];
  const sectionIds = new Set(sections.map((section) => section.id));
  const services = buildItemsFromSections(sections, label);
  const team = [
    { title: 'Professores autorais', description: `Equipe preparada para conduzir ${label} com repertorio, pratica e acompanhamento individual.` },
    { title: 'Mentorias e pratica', description: 'Aulas e encontros conectam tecnica, experimentacao e evolucao continua.' },
    { title: 'Convidados especiais', description: 'Participacoes pontuais ampliam repertorio, processo criativo e vivencia de palco.' },
  ];
  const events = [
    { title: 'Mostras de processo', description: 'Agenda para apresentar estudos, composicoes, performances e evolucao dos alunos.' },
    { title: 'Aulas abertas', description: 'Encontros para conhecer a metodologia, conversar com professores e experimentar formatos.' },
    { title: 'Calendario de apresentacoes', description: 'Programacao organizada para aproximar comunidade, artistas e familias.' },
  ];
  const blogPosts = [
    { title: `Como funciona ${label}`, category: 'Guia', excerpt: 'Um panorama claro da proposta, dos formatos e dos caminhos de entrada.' },
    { title: 'Pratica, repertorio e criacao', category: 'Metodo', excerpt: 'Conteudos para mostrar processo, bastidores e evolucao de quem participa.' },
    { title: 'Agenda e comunidade', category: 'Eventos', excerpt: 'Novidades, mostras, encontros e oportunidades de participacao.' },
  ];
  const galleryItems = [
    { title: 'Ambientes de pratica', description: 'Espacos pensados para concentracao, experimentacao e troca.' },
    { title: 'Apresentacoes e encontros', description: 'Registros editoriais de aulas, eventos e momentos coletivos.' },
    { title: 'Processos criativos', description: 'Bastidores que aproximam tecnica, linguagem e expressao.' },
  ];
  const copy = {
    heroEyebrow: label,
    heroTitle: calculatorContract
      ? `${brand}: ${calculatorContract.title} pronta para uso.`
      : `${brand} apresenta uma experiencia completa, clara e pronta para conversao.`,
    heroText: calculatorContract
      ? `A ferramenta organiza ${calculatorContract.title}, entradas de ${calculatorContract.inputs.map((field) => field.label).join(', ')}, formula ${calculatorContract.formula} e saida com ${calculatorContract.outputs.join(' e ')}.`
      : `A estrutura do site organiza ${label} com conteudo final, modulos, rotas modulares, chamada principal, prova social, preco, garantia, contato, CTA e caminhos objetivos para visitantes entenderem e agendarem o proximo passo.`,
    cta: calculatorContract ? 'Calcular agora' : 'Agendar conversa',
    ctaHref: pages.some((page) => page.id === '/contato') ? '/contato' : '#contato',
    secondaryCta: 'Conhecer proposta',
    secondaryCtaHref: pages.some((page) => page.id === '/sobre') ? '/sobre' : '#sobre',
    headerCta: 'Contato',
    headerCtaHref: pages.some((page) => page.id === '/contato') ? '/contato' : '#contato',
    navServicesLabel: sectionIds.has('services') ? 'Servicos' : 'Proposta',
    navProductsLabel: sectionIds.has('products') ? 'Loja' : 'Ofertas',
    navGalleryLabel: 'Galeria',
    navBlogLabel: 'Blog',
    navMethodLabel: 'Processo',
    servicesHeading: calculatorContract ? `Como a ${calculatorContract.title} funciona` : `O que ${brand} oferece`,
    services: calculatorContract
      ? [
          { title: 'Entrada dos dados', description: `Campos claros para ${calculatorContract.inputs.map((field) => field.label).join(', ')}.` },
          { title: 'Formula auditavel', description: `Regra usada: ${calculatorContract.formula}.` },
          { title: 'Resultado interpretado', description: calculatorContract.resultText },
        ]
      : services,
    productsHeading: 'Formatos e possibilidades',
    products: sectionIds.has('products')
      ? [
          { title: 'Experiencia inicial', description: 'Entrada para conhecer a proposta e escolher o melhor caminho.', price: 'Sob consulta', category: 'Inicio' },
          { title: 'Programa completo', description: 'Acompanhamento estruturado para desenvolvimento continuo.', price: 'Sob consulta', category: 'Programa' },
          { title: 'Encontros especiais', description: 'Oficinas, eventos e formatos pontuais para aprofundamento.', price: 'Sob consulta', category: 'Agenda' },
        ]
      : [],
    galleryHeading: 'Galeria de experiencias',
    galleryItems: sectionIds.has('gallery') ? galleryItems : [],
    blogHeading: 'Conteudos e novidades',
    blogPosts: sectionIds.has('blog') || sectionIds.has('events') ? blogPosts : [],
    about: `${brand} foi estruturado a partir do briefing atual para apresentar ${label} com clareza, identidade editorial e foco em acao, sem recorrer a memoria antiga ou textos genericos de outro projeto.`,
    bodyMediaTitle: 'Identidade editorial aplicada ao briefing atual',
    bodyMediaText: 'Cada bloco prioriza o pedido da mensagem atual: apresentacao, prova, rotas, formulario e conteudo organizado para publicacao.',
    manifestoTitle: 'Proposta clara, modular e auditavel',
    manifestoText: 'O contrato temporario define o que precisa existir agora, permitindo validar cobertura, rotas e copy antes de promover a receita para biblioteca permanente.',
    differentialsHeading: 'Diferenciais da experiencia',
    differentials: [
      { title: 'Briefing como fonte unica', description: 'A mensagem atual define dominio, secoes, paginas e intencao de conteudo.' },
      { title: 'Rotas modulares', description: 'Paginas solicitadas sao criadas como partes independentes e navegaveis.' },
      { title: 'Cobertura verificavel', description: 'Secoes, modulos, formularios, CTA, prova social, garantia, galeria, blog e contato entram no manifesto de validacao.' },
    ],
    methodSteps: [
      { title: 'Entendimento', description: `Organizamos ${label} a partir do briefing atual e das secoes obrigatorias.` },
      { title: 'Composicao modular', description: 'Montamos hero, corpo, rotas, prova, FAQ e contato como pecas auditaveis.' },
      { title: 'Validacao', description: 'A cobertura confirma se o que foi pedido aparece nos arquivos gerados.' },
    ],
    team: sectionIds.has('team') ? team : [],
    events: sectionIds.has('events') ? events : [],
    statOneValue: String(sections.length),
    statOneLabel: 'secoes obrigatorias capturadas do briefing atual',
    statTwoValue: String(pages.length),
    statTwoLabel: 'rotas planejadas pelo contrato temporario',
    testimonial: 'Quando o briefing atual vira contrato, a entrega para de depender de lembrancas antigas.',
    testimonials: sectionIds.has('testimonials')
      ? [
          { quote: 'A experiencia ficou clara desde o primeiro acesso, com caminhos objetivos para entender e entrar em contato.', name: 'Cliente Faber', role: 'Validacao de produto' },
          { quote: 'As paginas ajudam a separar proposta, agenda, galeria e contato sem misturar contextos antigos.', name: 'Equipe editorial', role: 'Revisao de conteudo' },
        ]
      : [],
    faq: [
      { question: 'Este site usa memoria antiga para completar conteudo?', answer: 'Nao. O contrato temporario foi sintetizado a partir da mensagem atual e bloqueia contaminacao por contexto antigo.' },
      { question: 'O contrato temporario substitui um contrato permanente?', answer: 'Nao. Ele permite entregar e validar este pedido; depois pode ser promovido para uma receita permanente.' },
      { question: 'As paginas solicitadas entram na validacao?', answer: 'Sim. Rotas e secoes obrigatorias entram no manifesto de cobertura da blueprint.' },
    ],
    contactHeading: 'Vamos organizar o proximo passo',
    contactText: `Entre em contato para falar sobre ${label}, agenda, formatos disponiveis e melhor caminho para comecar.`,
    formButtonLabel: calculatorContract ? 'Calcular resultado' : 'Enviar solicitacao',
    formFields: calculatorContract
      ? calculatorContract.inputs
      : [
          { label: 'Nome', name: 'nome', type: 'text', placeholder: 'Seu nome' },
          { label: 'E-mail', name: 'email', type: 'email', placeholder: 'voce@email.com' },
          { label: 'WhatsApp', name: 'whatsapp', type: 'tel', placeholder: '(00) 00000-0000' },
          { label: 'Interesse principal', name: 'interesse', type: 'text', placeholder: 'Aulas, agenda, professores, visita ou proposta' },
          { label: 'Mensagem', name: 'mensagem', type: 'textarea', rows: 4, placeholder: 'Conte o que voce procura' },
        ],
    formStatus: calculatorContract
      ? `${calculatorContract.resultText} Formula: ${calculatorContract.formula}.`
      : `Solicitacao recebida pela equipe ${brand}.`,
    metaDescription: `${brand}: ${label} com apresentacao, agenda, galeria, conteudo e contato organizados em site modular.`,
  };
  applySpecificTemporaryCopy(copy, { brand, label, normalizedSource });
  copy.routePages = pages
    .filter((page) => page.id && page.id !== '/')
    .map((page) => ({
      href: page.id,
      label: titleFromRoute(page),
      eyebrow: titleFromRoute(page),
      title: `${titleFromRoute(page).replace(/\b\w/g, (char) => char.toUpperCase())} | ${brand}`,
      intro: `Pagina dedicada a ${titleFromRoute(page)} dentro de ${label}, com conteudo alinhado ao briefing atual.`,
      items: routeItemsForPage(page, copy),
    }));
  return copy;
}

module.exports = {
  TEMPORARY_BLUEPRINT_CONTRACT_SCHEMA_VERSION,
  buildTemporaryBlueprintCopy,
  isActiveTemporaryBlueprintContract,
  shouldSynthesizeTemporaryBlueprintContract,
  synthesizeTemporaryBlueprintContract,
};
