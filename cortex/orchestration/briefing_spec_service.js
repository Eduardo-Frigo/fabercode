const {
  inferBriefingContract,
  normalizeBriefingContractText,
} = require('./briefing_contract_service');
const {
  isActiveTemporaryBlueprintContract,
  synthesizeTemporaryBlueprintContract,
} = require('./temporary_blueprint_contract_service');

const BRIEFING_SPEC_SCHEMA_VERSION = 'briefing-spec-v1';

const SECTION_PATTERNS = [
  { id: 'hero', label: 'hero', patterns: [/\bhero\b/, /\bprimeira dobra\b/, /\btopo\b/] },
  { id: 'cta', label: 'CTA', patterns: [/\bcta\b/, /\bchamada para acao\b/, /\bbotao\b/, /\bsolicitar\b/, /\bagendar\b/] },
  { id: 'services', label: 'servicos', patterns: [/\bservicos?\b/, /\bsolucoes?\s+(?:oferecidas|para|tecnicas|técnicas|da empresa|do negocio|do negócio)\b/, /\bconsultoria\b/] },
  { id: 'products', label: 'loja/produtos', patterns: [/\bloja\b/, /\bprodutos?\b/, /\bcatalogo\b/, /\bvitrine\b/, /\bcolecoes?\b/] },
  { id: 'blog', label: 'blog/insights', patterns: [/\bblog\b/, /\binsights?\b/, /\bartigos?\b/, /\bconteudos? educativos?\b/] },
  { id: 'gallery', label: 'galeria/portfolio', patterns: [/\bgaleria\b/, /\bportfolio\b/, /\bportfol[io]\b/, /\bprojetos\b(?!\s+(?:anteriores?|antigos?|de\s+memoria|de\s+memória))/, /\bprojetos?\s+(?:realizados|selecionados|autorais|em destaque)\b/, /\bcases?\b/] },
  { id: 'testimonials', label: 'depoimentos', patterns: [/\bdepoimentos?\b/, /\bprova social\b/, /\bclientes?\b/] },
  { id: 'sustainability', label: 'sustentabilidade', patterns: [/\bsustentabilidade\b/, /\bsustentavel\b/, /\bsustentável\b/, /\bplastico descartavel\b/, /\bplástico descartável\b/] },
  { id: 'comparison', label: 'comparacao', patterns: [/\bcomparacao\b/, /\bcomparação\b/, /\bpor que escolher\b/, /\bem vez de\b/] },
  { id: 'guarantee', label: 'garantia', patterns: [/\bgarantia\b/, /\bcompra segura\b/, /\btroca\b/, /\bdevolucao\b/, /\bdevolução\b/] },
  { id: 'calculator', label: 'calculadora', patterns: [/\bcalculadora\b/, /\bsimulador\b/, /\bestimativa\b/, /\borcamento estimativo\b/, /\borçamento estimativo\b/] },
  { id: 'careers', label: 'trabalhe conosco', patterns: [/\btrabalhe conosco\b/, /\bcarreira\b/, /\btalentos\b/, /\benviar curriculo\b/, /\benviar currículo\b/] },
  { id: 'team', label: 'equipe/professores', patterns: [/\bequipe\b/, /\bprofessores?\b/, /\bespecialistas?\b/, /\binstrutores?\b/, /\bmentores?\b/] },
  { id: 'events', label: 'agenda/eventos', patterns: [/\bagenda\b/, /\beventos?\b/, /\bapresentacoes\b/, /\bapresentações\b/, /\bcalendario\b/, /\bcalendário\b/] },
  { id: 'contact', label: 'contato/formulario', patterns: [/\bcontato\b/, /\bformulario\b/, /\bwhatsapp\b/, /\bcotacao\b/, /\bproposta\b/] },
  { id: 'footer', label: 'footer/rodape', patterns: [/\bfooter\b/, /\brodape\b/, /\brodape completo\b/] },
  { id: 'faq', label: 'FAQ', patterns: [/\bfaq\b/, /\bperguntas frequentes\b/] },
  { id: 'process', label: 'processo/metodo', patterns: [/\bprocesso\b/, /\bmetodo\b/, /\bcomo funciona\b/, /\betapas?\b/] },
  { id: 'about', label: 'sobre', patterns: [/\bsobre\b/, /\bhistoria\b/, /\bmanifesto\b/, /\btrajetoria\b/] },
  { id: 'differentials', label: 'diferenciais', patterns: [/\bdiferenciais?\b/, /\bbeneficios?\b/, /\bpor que escolher\b/] },
  { id: 'form', label: 'formulario qualificado', patterns: [/\bcampos?\b/, /\bnome\b/, /\be-?mail\b/, /\bmensagem\b/, /\bwhatsapp\b/] },
  { id: 'video', label: 'video', patterns: [/\bvideo\b/, /\bfull width\b/, /\bloop\b/, /\bautoplay\b/] },
];

const PAGE_PATTERNS = [
  { id: '/', label: 'inicio', patterns: [/\bpagina inicial\b/, /\bpágina inicial\b/, /\bhome\b/, /\bindex\.html\b/] },
  { id: '/sobre', label: 'sobre', patterns: [/\bpagina sobre\b/, /\bpágina sobre\b/, /\bsobre o escritorio\b/, /\bsobre o escritório\b/] },
  { id: '/a-escola', label: 'a escola', patterns: [/\bpagina a escola\b/, /\bpágina a escola\b/, /\ba-escola\.html\b/, /\ba escola\b/, /\bo que e a escola\b/, /\bo que é a escola\b/] },
  { id: '/premissas', label: 'premissas', patterns: [/\bpagina premissas\b/, /\bpágina premissas\b/, /\bpremissas\.html\b/, /\bpremissas\b/, /\b5 premissas\b/, /\bcinco premissas\b/] },
  { id: '/jornada', label: 'jornada', patterns: [/\bpagina jornada\b/, /\bpágina jornada\b/, /\bjornada\.html\b/, /\bjornada\b/, /\blinha do tempo\b/] },
  { id: '/conteudos', label: 'conteudos', patterns: [/\bpagina conteudos\b/, /\bpágina conteúdos\b/, /\bconteudos\.html\b/, /\bconteúdos\.html\b/, /\bconteudos\b/, /\bconteúdos\b/, /\breflexoes\b/, /\breflexões\b/] },
  { id: '/servicos', label: 'servicos', patterns: [/\bpagina servicos\b/, /\bpágina servicos\b/, /\bpagina serviços\b/, /\bpágina serviços\b/] },
  { id: '/produtos', label: 'produtos', patterns: [/\bpagina produtos\b/, /\bpágina produtos\b/, /\bp[aá]ginas? principais[\s\S]{0,360}\bprodutos\b/] },
  { id: '/pisos', label: 'pisos de madeira', patterns: [/\bpagina pisos\b/, /\bpágina pisos\b/, /\bp[aá]ginas? principais[\s\S]{0,360}\bpisos\b/] },
  { id: '/paineis', label: 'paineis ripados', patterns: [/\bpagina paineis\b/, /\bpágina pain[eé]is\b/, /\bp[aá]ginas? principais[\s\S]{0,360}\bpaineis\b/, /\bp[aá]ginas? principais[\s\S]{0,360}\bpain[eé]is\b/] },
  { id: '/decks', label: 'decks', patterns: [/\bpagina decks\b/, /\bpágina decks\b/, /\bp[aá]ginas? principais[\s\S]{0,360}\bdecks\b/] },
  { id: '/projetos', label: 'projetos/cases', patterns: [/\bpagina cases\b/, /\bpágina cases\b/, /\bpagina projetos\b/, /\bpágina projetos\b/, /\bprojetos \/ cases\b/, /\bcases e projetos\b/] },
  { id: '/processo', label: 'processo', patterns: [/\bpagina processo\b/, /\bpágina processo\b/] },
  { id: '/insights', label: 'insights/blog', patterns: [/\bblog \/ insights\b/, /\bpagina insights\b/, /\bpágina insights\b/] },
  { id: '/blog', label: 'blog', patterns: [/\bpagina blog\b/, /\bpágina blog\b/, /\bpagina 7\b[\s\S]{0,80}\bblog\b/, /\bconteudos sobre\b/, /\bconteúdos sobre\b/] },
  { id: '/inspiracoes', label: 'inspiracoes', patterns: [/\bpagina inspiracoes\b/, /\bpágina inspirações\b/, /\bp[aá]ginas? principais[\s\S]{0,360}\binspiracoes\b/, /\bp[aá]ginas? principais[\s\S]{0,360}\binspirações\b/] },
  { id: '/solucoes', label: 'solucoes', patterns: [/\bpagina solucoes\b/, /\bpágina soluções\b/, /\bpagina soluções\b/, /\bpágina solucoes\b/] },
  { id: '/calculadora', label: 'calculadora', patterns: [/\bpagina calculadora\b/, /\bpágina calculadora\b/, /\bcalculadora de orcamento\b/, /\bcalculadora de orçamento\b/] },
  { id: '/orcamento', label: 'orcamento', patterns: [/\bpagina orcamento\b/, /\bpágina orçamento\b/, /\bpagina orçamento\b/, /\bpágina orcamento\b/, /\bpagina de orcamento\b/, /\bpágina de orçamento\b/, /\borcamento de obra\b/, /\borçamento de obra\b/] },
  { id: '/contato', label: 'contato', patterns: [/\bpagina contato\b/, /\bpágina contato\b/, /\bcontato\.html\b/] },
  { id: '/trabalhe-conosco', label: 'trabalhe conosco', patterns: [/\bpagina trabalhe conosco\b/, /\bpágina trabalhe conosco\b/, /\btrabalhe conosco\b/] },
  { id: '/professores', label: 'professores', patterns: [/\bpagina professores\b/, /\bpágina professores\b/, /\bprofessores?\b/, /\binstrutores?\b/] },
  { id: '/agenda', label: 'agenda', patterns: [/\bpagina agenda\b/, /\bpágina agenda\b/, /\bagenda\b/, /\beventos?\b/, /\bapresentacoes\b/, /\bapresentações\b/] },
  { id: '/loja', label: 'loja', patterns: [/\bpagina loja\b/, /\bpágina loja\b/] },
  { id: '/portfolio', label: 'portfolio', patterns: [/\bpagina portfolio\b/, /\bpágina portfolio\b/, /\bpagina portfólio\b/, /\bpágina portfólio\b/] },
];

const COMMON_SUPPORTED_SECTIONS = new Set(SECTION_PATTERNS.map((entry) => entry.id));
const COMMON_SUPPORTED_PAGES = new Set(PAGE_PATTERNS.map((entry) => entry.id));

function normalizeSpecText(value = '') {
  return normalizeBriefingContractText(value);
}

function compactSpecText(value = '', max = 2600) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function isContextContinuationMessage(value = '') {
  const normalized = normalizeSpecText(value);
  if (!normalized) return true;
  return /^(faz|faca|faça|gere|gerar|pode|sim|ok|certo|isso|continue|continua|prossiga|segue|seguir|usa|use|com isso|perfeito)(\s|$)/.test(
    normalized
  ) && normalized.length <= 120;
}

function hasCreateSurfaceSignal(normalized = '') {
  return /\b(criar|crie|gerar|gere|montar|monte|implementar|implemente|desenvolver|desenvolva|configurar|configure|fazer|faca|site|landing|pagina|app|web|next|react|tailwind|ferramenta|calculadora|conversor|componente|tabela|formulario|formulário|fluxo|integracao|integração|dashboard|crm|preset|mcp|tools?|capability)\b/.test(
    normalized
  );
}

function hasBriefDetailSignal(normalized = '') {
  return /\b(hero|header|footer|rodape|secao|secoes|seção|seções|paleta|tipografia|video|imagem|produtos|servicos|processo|contato|cta|botao|formulario|formulário|blog|galeria|portfolio|depoimentos|faq|rota|pagina|input|inputs|output|outputs|campos|validacao|validação|erro|resultado|cards?|props|estado vazio|estados vazios|responsivo|responsiva|tools?|permissoes|permissões|escopo|risco|fallback|capability|mcp|memoria ativa|memória ativa|provenance|confidence score)\b/.test(
    normalized
  );
}

function hasSelfContainedCurrentBrief(value = '') {
  const normalized = normalizeSpecText(value);
  if (!normalized) return false;
  return normalized.length >= 260 || (hasCreateSurfaceSignal(normalized) && hasBriefDetailSignal(normalized));
}

function hasPlaceholderAuthorization(normalized = '') {
  if (!normalized) return false;
  if (/\b(sem placeholder|sem placeholders|nao quero placeholder|nao usar placeholder|conteudo final|conteudo real|conteudo especifico|usar meus textos|use meus textos)\b/.test(normalized)) {
    return false;
  }
  return hasNonNegatedSpecMatch(
    normalized,
    /\b(placeholders?|conteudo provisorio|primeira versao|rapido para validar|validar estrutura|qualquer coisa|voce decide|pode decidir|generico|generica|depois ajusto)\b/
  );
}

function hasFinalContentSignal(normalized = '', selfContained = false) {
  if (!normalized) return false;
  if (/\b(briefing completo|conteudo final|conteudo real|conteudo especifico|conteudo que solicitei|com o meu conteudo|use meus textos|usar meus textos|textos prontos|resultado final|site completo|landing page final|pagina final)\b/.test(normalized)) {
    return true;
  }
  return Boolean(selfContained && normalized.length >= 900);
}

function findMatches(normalized = '', entries = []) {
  return entries
    .filter((entry) => entry.patterns.some((pattern) => hasNonNegatedSpecMatch(normalized, pattern)))
    .map((entry) => ({ id: entry.id, label: entry.label }));
}

function hasNonNegatedSpecMatch(normalized = '', pattern = null) {
  if (!pattern) return false;
  const flags = pattern.flags && pattern.flags.includes('g') ? pattern.flags : `${pattern.flags || ''}g`;
  const matcher = new RegExp(pattern.source, flags);
  let match = matcher.exec(normalized);
  while (match) {
    const before = normalized.slice(Math.max(0, match.index - 150), match.index);
    const after = normalized.slice(match.index + String(match[0] || '').length, match.index + String(match[0] || '').length + 72);
    const negatedBefore = /\b(nao|nunca|sem|evitar|evite|excluir|bloquear|bloqueie|suprimir|suprima|ignorar|ignore)\b[\s\w,;:-]{0,140}$/.test(before) ||
      /\bnao\s+(?:e|eh|deve ser|se trata de|usar|utilizar)\b[\s\w,;:-]{0,140}$/.test(before);
    const negatedAfter = /^[\s\w,;:-]{0,56}\b(nao|nunca|proibid[ao]s?|bloquead[ao]s?|fora da paleta|fora do escopo)\b/.test(after);
    if (!negatedBefore && !negatedAfter) return true;
    match = matcher.exec(normalized);
  }
  return false;
}

function uniqueById(entries = []) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function inferRequestedSections(normalized = '') {
  return uniqueById(findMatches(normalizeSpecText(normalized), SECTION_PATTERNS));
}

function inferRequestedPages(normalized = '') {
  const source = normalizeSpecText(normalized);
  const direct = findMatches(source, PAGE_PATTERNS);
  if (/\bsite completo\b/.test(source)) {
    direct.push(
      { id: '/', label: 'inicio' },
      { id: '/sobre', label: 'sobre' },
      { id: '/servicos', label: 'servicos' },
      { id: '/contato', label: 'contato' }
    );
    if (/\b(produtos?|catalogo|catálogo|pisos? de madeira|paineis?|pain[eé]is|decks?|revestimentos?)\b/.test(source)) {
      direct.push({ id: '/produtos', label: 'produtos' });
    }
    if (/\bpisos?\b/.test(source)) direct.push({ id: '/pisos', label: 'pisos de madeira' });
    if (/\bpaineis?\b|\bpain[eé]is\b/.test(source)) direct.push({ id: '/paineis', label: 'paineis ripados' });
    if (/\bdecks?\b/.test(source)) direct.push({ id: '/decks', label: 'decks' });
    if (/\bprojetos\b|\bcases?\b|\bgaleria\b|\bportfolio\b|\bportf[oó]lio\b/.test(source)) {
      direct.push({ id: '/projetos', label: 'projetos/cases' });
    }
    if (/\binspiracoes\b|\binspirações\b/.test(source)) direct.push({ id: '/inspiracoes', label: 'inspiracoes' });
    if (/\binsights?\b|\bblog\b|\bartigos?\b/.test(source)) direct.push({ id: '/insights', label: 'insights/blog' });
    if (/\bprofessores?\b|\bequipe\b|\binstrutores?\b/.test(source)) direct.push({ id: '/professores', label: 'professores' });
    if (/\bagenda\b|\beventos?\b|\bapresentacoes\b|\bapresentações\b/.test(source)) direct.push({ id: '/agenda', label: 'agenda' });
  }
  return uniqueById(direct);
}

function cleanBrandCandidate(value = '') {
  return String(value || '')
    .split(/\s+(?:Objetivo(?:\s+da\s+p[áa]gina)?|Conceito(?:\s+do\s+projeto)?|Criar|Estrutura|Hero|Home|Menu|P[áa]ginas?\s+principais)\b/i)[0]
    .replace(/[.;:,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function inferExplicitBrand(value = '') {
  const source = String(value || '');
  const headingPatterns = [
    /(?:^|\n)\s*Nome fict[ií]cio(?:\s+do\s+(?:neg[oó]cio|projeto|site|estabelecimento))?\s*:?\s*(?:\n|\r\n)+\s*([^\n\r.]+)/i,
    /(?:^|\n)\s*Nome da marca\s*:?\s*(?:\n|\r\n)+\s*([^\n\r.]+)/i,
    /(?:^|\n)\s*Nome da empresa\s*:?\s*(?:\n|\r\n)+\s*([^\n\r.]+)/i,
    /(?:^|\n)\s*Nome do produto\s*:?\s*(?:\n|\r\n)+\s*([^\n\r.]+)/i,
    /(?:^|\n)\s*Nome do projeto\s*:?\s*(?:\n|\r\n)+\s*([^\n\r.]+)/i,
    /(?:^|\n)\s*Marca\s*:?\s*(?:\n|\r\n)+\s*([^\n\r.]+)/i,
    /(?:^|\n)\s*Empresa\s*:?\s*(?:\n|\r\n)+\s*([^\n\r.]+)/i,
  ];
  for (const pattern of headingPatterns) {
    const match = source.match(pattern);
    const brand = match ? cleanBrandCandidate(match[1] || '') : '';
    if (brand && brand.length >= 3 && !/^nome/i.test(brand)) return brand;
  }
  const patterns = [
    /Nome do escrit[oó]rio:\s*([^\n\r.]+)/i,
    /Escrit[oó]rio de Patentes\s*:\s*([^\n\r.]+)/i,
    /Escrit[oó]rio\s*:\s*([^\n\r.]+)/i,
    /Empresa\s*:\s*([^\n\r.]+)/i,
    /Cliente\s*:\s*([^\n\r.]+)/i,
    /Marca\s*\/\s*Empresa\s*:\s*([^\n\r.]+)/i,
    /Nome fict[ií]cio\s*:\s*([^\n\r.]+)/i,
    /Nome da marca\s*:\s*([^\n\r.]+)/i,
    /Nome do produto\s*:\s*([^\n\r.]+)/i,
    /Nome do projeto\s*:\s*([^\n\r.]+)/i,
    /Marca\s*:\s*([^\n\r.]+)/i,
    /\b(Tremn\s*[—-]\s*Escola de Gestão Consciente)\b/i,
    /\bpara\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ0-9&'.-]*(?:\s+(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][A-Za-zÀ-ÿ0-9&'.-]*|&|e|de|da|do|dos|das|di|du|del|la|le)){0,6})(?=\s*(?:,|\.|\b(?:com|que|SaaS|ferramenta|produto|plataforma|site|landing)\b))/,
    /\b(Helena Duarte Arquitetura)\b/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const brand = match ? cleanBrandCandidate(match[1] || match[0]) : '';
    if (brand && brand.length >= 3 && !/^nome/i.test(brand)) return brand;
  }
  return '';
}

function buildContractEscalation({
  normalized = '',
  contract = {},
  sections = [],
  pages = [],
  selfContained = false,
  finalRequested = false,
  placeholderAllowed = false,
  temporaryBlueprintContract = null,
} = {}) {
  const createSite = hasCreateSurfaceSignal(normalized);
  const domainDecision = contract && contract.domainDecision ? contract.domainDecision : {};
  const domainConflict = Boolean(domainDecision.blockDomainFallback || domainDecision.status === 'conflict');
  const domainMissing = !contract || !contract.domain;
  const needsFinalProduct = Boolean((finalRequested || domainConflict) && !placeholderAllowed && createSite);

  if (!needsFinalProduct) {
    return { required: false, code: '', reason: '', suggestedContract: null };
  }

  if (isActiveTemporaryBlueprintContract(temporaryBlueprintContract) && !domainConflict) {
    return {
      required: false,
      code: 'temporary_blueprint_contract_synthesized',
      reason: 'O briefing final sem dominio permanente foi convertido em contrato temporario auditavel a partir da mensagem atual.',
      suggestedContract: null,
    };
  }

  const unsupportedSections = sections.filter((section) => !COMMON_SUPPORTED_SECTIONS.has(section.id));
  const unsupportedPages = pages.filter((page) => !COMMON_SUPPORTED_PAGES.has(page.id));
  if (domainConflict || (selfContained && domainMissing)) {
    return {
      required: false,
      advisory: true,
      code: domainConflict ? 'current_briefing_domain_conflict' : 'missing_domain_blueprint_contract',
      reason: domainConflict
        ? 'O briefing atual tem sinais de dominios conflitantes. Siga com uma premissa explicita em vez de exigir contrato antes de agir.'
        : 'O briefing atual parece final e autocontido sem dominio/recipe permanente. Siga com uma premissa explicita em vez de exigir contrato antes de agir.',
      suggestedContract: {
        type: 'suggest_blueprint',
        status: 'advisory',
        scope: 'domain_blueprint',
        requiredSections: sections.map((section) => section.id),
        requiredPages: pages.map((page) => page.id),
        activation: 'optional_after_smoke_test',
      },
    };
  }

  if (unsupportedSections.length || unsupportedPages.length) {
    return {
      required: false,
      advisory: true,
      code: 'missing_section_blueprint_contract',
      reason: 'O briefing atual pede secoes ou paginas fora do contrato comum de composicao. Gere a melhor solucao possivel e registre a premissa adotada.',
      suggestedContract: {
        type: 'suggest_blueprint',
        status: 'advisory',
        scope: 'section_or_route_blueprint',
        missingSections: unsupportedSections.map((section) => section.id),
        missingPages: unsupportedPages.map((page) => page.id),
        activation: 'optional_after_smoke_test',
      },
    };
  }

  return { required: false, code: '', reason: '', suggestedContract: null };
}

function buildBriefingSpec({
  userMessage = '',
  contextText = '',
  workGraph = null,
  conversationMessages = [],
  activeMemory = null,
  contract = null,
} = {}) {
  const current = String(userMessage || '').trim();
  const normalizedCurrent = normalizeSpecText(current);
  const selfContained = hasSelfContainedCurrentBrief(current);
  const continuation = Boolean(
    !selfContained &&
      (
        (activeMemory && activeMemory.current && activeMemory.current.continuationIntent) ||
        isContextContinuationMessage(current)
      )
  );
  const activeContract = contract || inferBriefingContract({ userMessage: current, contextText, workGraph });
  const placeholderAllowed = hasPlaceholderAuthorization(normalizedCurrent);
  const finalRequested = hasFinalContentSignal(normalizedCurrent, selfContained);
  const sections = inferRequestedSections(normalizedCurrent);
  const pages = inferRequestedPages(normalizedCurrent);
  const brand = inferExplicitBrand(current);
  const temporaryBlueprintContract = synthesizeTemporaryBlueprintContract({
    source: current,
    normalized: normalizedCurrent,
    contract: activeContract,
    sections,
    pages,
    brand,
    selfContained,
    finalRequested,
    placeholderAllowed,
  });
  const memoryAllowedForContent = Boolean(continuation || !selfContained);
  const generationSource = memoryAllowedForContent
    ? [current, contextText].filter(Boolean).join('\n\n')
    : current;
  const escalation = buildContractEscalation({
    normalized: normalizedCurrent,
    contract: activeContract,
    sections,
    pages,
    selfContained,
    finalRequested,
    placeholderAllowed,
    temporaryBlueprintContract,
  });

  return {
    schemaVersion: BRIEFING_SPEC_SCHEMA_VERSION,
    current: {
      text: compactSpecText(current, 3600),
      normalized: compactSpecText(normalizedCurrent, 3600),
      selfContained,
      continuation,
      brand,
    },
    contextPolicy: {
      currentMessageHasPriority: Boolean(current),
      memoryAllowedForContent,
      staleContextSuppressed: Boolean(current && !memoryAllowedForContent),
      sourcePrecedence: ['current_user_message', 'project_files', 'active_memory', 'conversation_history'],
    },
    content: {
      finalRequested,
      placeholderAllowed,
      mode: placeholderAllowed ? 'placeholder_allowed' : finalRequested ? 'final_content' : 'draft_or_guided',
    },
    required: {
      sections,
      pages,
      sectionIds: sections.map((section) => section.id),
      pageIds: pages.map((page) => page.id),
    },
    domain: {
      id: activeContract.domain || '',
      label: activeContract.domainLabel || '',
      source: activeContract.domainDecision ? activeContract.domainDecision.source || '' : '',
      status: activeContract.domainDecision ? activeContract.domainDecision.status || '' : '',
      conflict: Boolean(activeContract.domainDecision && activeContract.domainDecision.blockDomainFallback),
    },
    generationSource: compactSpecText(generationSource, 3600),
    temporaryBlueprintContract,
    contractEscalation: escalation,
  };
}

function formatBriefingSpecForPrompt(spec = {}) {
  if (!spec || typeof spec !== 'object') return '';
  const lines = [
    'Contrato do briefing atual:',
    '- A mensagem atual tem precedencia sobre memoria, historico e contexto antigo.',
  ];
  if (spec.contextPolicy && spec.contextPolicy.staleContextSuppressed) {
    lines.push('- Contexto antigo foi suprimido para gerar conteudo; nao reutilize copy de conversas anteriores.');
  }
  if (spec.current && spec.current.brand) lines.push(`- Marca/nome solicitado: ${spec.current.brand}.`);
  if (spec.content && spec.content.finalRequested) {
    lines.push('- Pedido tratado como conteudo final: nao use placeholders genericos.');
  }
  if (isActiveTemporaryBlueprintContract(spec.temporaryBlueprintContract)) {
    const temporary = spec.temporaryBlueprintContract;
    lines.push(`- Contrato temporario de blueprint ativo: ${temporary.domainLabel || temporary.label || temporary.domain}.`);
    lines.push('- Use somente a mensagem atual para conteudo final; memoria antiga continua bloqueada.');
  }
  if (spec.required && spec.required.sectionIds && spec.required.sectionIds.length) {
    lines.push(`- Secoes obrigatorias: ${spec.required.sectionIds.join(', ')}.`);
  }
  if (spec.required && spec.required.pageIds && spec.required.pageIds.length) {
    lines.push(`- Rotas/paginas obrigatorias: ${spec.required.pageIds.join(', ')}.`);
  }
  if (spec.contractEscalation && spec.contractEscalation.required) {
    lines.push(`- Bloqueio explicito: ${spec.contractEscalation.code}. Proponha suggest_blueprint antes de gerar arquivos.`);
  } else if (spec.contractEscalation && spec.contractEscalation.code) {
    lines.push(`- Aviso de premissa: ${spec.contractEscalation.code}. Nao bloqueie a execucao; avance e documente a escolha aplicada.`);
  }
  return lines.join('\n');
}

module.exports = {
  BRIEFING_SPEC_SCHEMA_VERSION,
  buildBriefingSpec,
  formatBriefingSpecForPrompt,
  hasSelfContainedCurrentBrief,
  inferExplicitBrand,
  inferRequestedPages,
  inferRequestedSections,
};
