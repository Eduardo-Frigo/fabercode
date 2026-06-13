const {
  inferBriefingContract,
} = require('./briefing_contract_service');
const { buildProductIntake } = require('./product_intake_service');
const { buildBriefingSpec } = require('./briefing_spec_service');
const {
  isActiveTemporaryBlueprintContract,
} = require('./temporary_blueprint_contract_service');
const { buildProviderFailureReason, normalizeProviderFailure } = require('../providers/provider_failure_service');

function hasScaffoldPlatformDetails(userMessage) {
  const normalized = String(userMessage || '').toLowerCase();
  return /\b(html|css|javascript|js|react|next|php|lamp|mysql|api|backend|frontend|web)\b/.test(normalized);
}

function normalizeBriefingIntentText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldUseDefaultScaffoldConfiguration(userMessage) {
  const normalized = normalizeBriefingIntentText(userMessage);
  if (!normalized) return false;

  const explicitDefaultSignals = [
    /\bpadrao\b/,
    /\bdefaults?\b/,
    /\bplaceholder(s)?\b/,
    /\bsugir(a|e|ir)?\b/,
    /\bsugere\b/,
    /\bsugerir\b/,
    /\bqualquer (coisa|conteudo|texto|imagem|tema|cor|paleta|nome)\b/,
    /\bvoce decide\b/,
    /\bdecide voce\b/,
    /\bescolha voce\b/,
    /\bcomo achar melhor\b/,
    /\bsem detalhes\b/,
  ];
  if (explicitDefaultSignals.some((regex) => regex.test(normalized))) return true;

  const shortAuthorizationSignals = [
    /\bsegue direto\b/,
    /\bseguir direto\b/,
    /\bvai no padrao\b/,
    /\bpode seguir\b/,
    /\bpode fazer\b/,
    /\bpode criar\b/,
    /\bpode montar\b/,
    /\bpode gerar\b/,
    /\bmanda ver\b/,
  ];
  if (normalized.length <= 80 && shortAuthorizationSignals.some((regex) => regex.test(normalized))) {
    return true;
  }

  return false;
}

function buildDefaultScaffoldPrompt(userMessage = '', contextHint = {}) {
  const lastScaffoldPrompt = String(contextHint && contextHint.lastScaffoldPrompt ? contextHint.lastScaffoldPrompt : '');
  const source = `${String(userMessage || '')} ${lastScaffoldPrompt}`.toLowerCase();
  const contract = inferBriefingContract({
    userMessage,
    contextText: lastScaffoldPrompt,
  });
  const isInstitutionalOrSite = /\b(site|landing|institucional|empresa|marca|cl[ií]nica|veterin[aá]ri|consult[oó]rio)\b/.test(source);
  const isPlatform = /\b(plataforma|sistema|painel|dashboard|portal|saas)\b/.test(source);
  const isLamp = contract.stack === 'lamp' || /\b(lamp|php|mysql)\b/.test(source);
  const domainLabel = contract.domainLabel ? ` para ${contract.domainLabel}` : '';

  if (isInstitutionalOrSite || isPlatform) {
    return [
      isLamp ? `criar site modular em arquitetura LAMP${domainLabel}` : `criar site com composição modular completa${domainLabel}`,
      'usuário autorizou defaults e placeholders; não pedir novas clarificações',
      lastScaffoldPrompt
        ? `preservar o pedido anterior como fonte de verdade operacional: ${compactStandaloneText(lastScaffoldPrompt, 1800)}`
        : '',
      'não entregar projeto mínimo ou página vazia',
      'definir estrutura como peças editáveis: header, hero, seções do body e footer',
      'variar a receita visual conforme o domínio e o pedido, em vez de repetir sempre o mesmo template',
      'incluir seções coerentes com o negócio, objetivo, CTA e nível de conteúdo disponível',
      'gerar copy real para cada seção com ctas claros',
      contract.guidance || '',
      'usar nome, imagens, textos, cores e ctas placeholder quando faltarem dados específicos',
      'incluir formulário de contato com validação',
      isLamp ? 'gerar arquivos base index.php, style.css e script.js conectados' : 'incluir interações javascript e menu responsivo',
      isLamp ? 'incluir backend php simples para formulário quando aplicável' : 'validar links entre html css javascript',
      'layout responsivo premium com identidade visual consistente',
    ].join(' ');
  }

  return [
    'criar projeto web completo conforme pedido anterior',
    'usuário autorizou defaults e placeholders; não pedir novas clarificações',
    lastScaffoldPrompt
      ? `preservar o pedido anterior como fonte de verdade operacional: ${compactStandaloneText(lastScaffoldPrompt, 1800)}`
      : '',
    'usar html css javascript quando não houver stack explícita',
    'não entregar projeto mínimo ou página vazia',
    'criar estrutura com seções reais, copy útil, CTA e responsividade',
    'gerar conteúdo placeholder apenas quando faltarem dados específicos',
    'validar links entre html css javascript',
  ].join(' ');
}

function compactStandaloneText(value = '', max = 1600) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(240, Number(max) || 1600);
  return text.length > limit ? text.slice(0, limit).trim() : text;
}

function getCortexBriefingClarificationQuestions() {
  return [
    'O que esse projeto precisa fazer primeiro para já ser útil?',
    'Quais funcionalidades são indispensáveis nesta primeira versão?',
    'Existe alguma restrição técnica ou visual que eu não posso ignorar?',
  ];
}

function buildCortexBriefingClarificationResponse(userMessage, attempts = 0, customQuestions = []) {
  const questions = Array.isArray(customQuestions) && customQuestions.length
    ? customQuestions.slice(0, 5)
    : getCortexBriefingClarificationQuestions();

  const mainQuestion = questions[0] || 'O que esse projeto precisa fazer primeiro para já ser útil?';
  const intro = attempts > 0
    ? 'Ainda falta uma decisão para eu não chutar no escuro.'
    : 'Posso seguir, mas antes preciso entender uma coisa.';

  return [
    intro,
    '',
    mainQuestion,
    '',
    'Pode responder do seu jeito, em uma frase mesmo.',
  ].join('\n');
}

function hasMinimumInstitutionalBriefingDetails(userMessage) {
  const normalized = String(userMessage || '').toLowerCase();
  if (!normalized) return false;

  const signals = [
    /\b(objetivo|meta|convers[aã]o|lead|agendar|agendamento)\b/,
    /\b(p[aá]gina|se[cç][aã]o|menu|inicio|in[ií]cio|servi[cç]os|sobre|contato|depoimentos)\b/,
    /\b(formul[aá]rio|whatsapp|cta|bot[aã]o|chamada para a[cç][aã]o)\b/,
    /\b(estilo|visual|moderno|minimalista|premium|cores|paleta|tipografia)\b/,
    /\b(servi[cç]o|consulta|vacina|exame|cirurgia|banho|tosa|advocacia|advogad[oa]|jur[ií]dic[oa]|direito|contrato|odontologia|dentista|escola|educa[cç][aã]o|gest[aã]o consciente|lideran[cç]a consciente|premissas|jornada)\b/,
  ];

  let matched = 0;
  for (const regex of signals) {
    if (regex.test(normalized)) matched += 1;
  }
  const hasStructureHints = /\b(hero|header|cabe[cç]alho|body|footer|rodap[eé]|cta|sess[aã]o|bloco)\b/.test(normalized);
  return matched >= 2 && (hasStructureHints || normalized.length >= 180);
}

function hasEnoughInitialScaffoldDetails(userMessage) {
  const normalized = normalizeBriefingIntentText(userMessage);
  if (!normalized) return false;

  const hasPlatform = hasScaffoldPlatformDetails(userMessage);
  const hasDomain =
    /\b(advocacia|advogad[oa]|juridic[oa]|direito|cl[ií]nica|dentista|odontologia|veterin[aá]ri|aqu[aá]rio|aquario|imobili[aá]ria|imoveis|restaurante|portfolio|fotografia|arquitetura|empresa|neg[oó]cio|importa[cç][aã]o|importar|com[eé]rcio exterior|log[ií]stica internacional|escola|educa[cç][aã]o|gest[aã]o consciente|lideran[cç]a consciente|premissas|jornada)\b/.test(
      normalized
    );
  const hasStyle =
    /\b(cor|cores|paleta|azul|branco|offwhite|off white|verde|vermelh|preto|claro|escuro|premium|minimalista|moderno|imagem|imagens|foto|fotos|fonte|tipografia)\b/.test(
      normalized
    );
  const hasStructure = /\b(hero|header|footer|rodape|rodap[eé]|cta|menu|se[cç][aã]o|servi[cç]os|sobre|contato)\b/.test(
    normalized
  );

  return Boolean(hasPlatform && (hasDomain || hasStyle || hasStructure));
}

function buildClarificationContextText(contextHint = {}) {
  const messages = Array.isArray(contextHint && contextHint.conversationMessages)
    ? contextHint.conversationMessages
    : [];
  const conversation = messages
    .slice(-6)
    .map((message) => String(message && (message.text || message.content || message.message) || '').trim())
    .filter(Boolean)
    .join('\n');
  return [
    contextHint && contextHint.originalUserMessage ? String(contextHint.originalUserMessage) : '',
    contextHint && contextHint.lastScaffoldPrompt ? String(contextHint.lastScaffoldPrompt) : '',
    conversation,
  ].filter(Boolean).join('\n');
}

function hasConfidentCreateBrief(userMessage = '', contextHint = {}) {
  const contextText = buildClarificationContextText(contextHint);
  const source = [userMessage, contextText].filter(Boolean).join('\n');
  const intake = buildProductIntake({ userMessage, contextText });
  if (intake.canonical.action !== 'create_project') return false;
  if (intake.scores.create < 70 && !intake.canonical.stackMentioned) return false;
  if (hasEnoughInitialScaffoldDetails(source) || hasMinimumInstitutionalBriefingDetails(source)) return true;
  const normalized = normalizeBriefingIntentText(source);
  return /\b(multiplas paginas|multi paginas|multipaginas|escola|educacao|gestao consciente|paleta|tipografia|menu|contato|hero)\b/.test(normalized);
}

function defaultHasScaffoldIntent(userMessage) {
  const normalized = String(userMessage || '').toLowerCase();
  return /\b(criar|gerar|montar|novo|site|landing|app|aplica[cç][aã]o|sistema|dashboard)\b/.test(normalized);
}

function shouldAskCortexBriefingClarification(userMessage, contextHint = {}, options = {}) {
  const text = String(userMessage || '').trim();
  if (!text) return false;

  const hasScaffoldIntent = options.hasScaffoldIntent || defaultHasScaffoldIntent;
  const awaitingClarification = Boolean(contextHint && contextHint.awaitingScaffoldClarification);
  const currentIntake = buildProductIntake({ userMessage: text });
  if (currentIntake.signals && currentIntake.signals.diagnosticIntent) return false;
  if (!hasScaffoldIntent(text) && !awaitingClarification) return false;
  if (shouldUseDefaultScaffoldConfiguration(text)) return false;

  const normalized = text.toLowerCase();
  const institutionalLike = /\b(site|landing|institucional|cl[ií]nica|veterin[aá]ri|empresa|marca|advocacia|advogad[oa]|jur[ií]dic[oa]|direito|odontologia|dentista)\b/.test(normalized);
  const platformLike = /\b(plataforma|sistema|painel|dashboard|portal|saas|app)\b/.test(normalized);
  const shortGenericReply = /^(ok|sim|segue|pode seguir|seguir|vai|padr[aã]o|default|isso|boa)$/i.test(text) || text.length < 30;

  if (awaitingClarification && shortGenericReply) return true;

  if (hasConfidentCreateBrief(text, contextHint)) return false;

  if (!hasScaffoldPlatformDetails(text)) return true;

  if (hasEnoughInitialScaffoldDetails(text)) {
    return false;
  }

  if (institutionalLike && !hasMinimumInstitutionalBriefingDetails(text)) {
    return true;
  }

  if (platformLike) {
    const hasFunctionalSignals = /\b(login|autentica|dashboard|crud|api|usuarios?|perfil|permiss[aã]o|fluxo|workflow|relat[oó]rio)\b/.test(normalized);
    if (!hasFunctionalSignals) return true;
  }

  if ((institutionalLike || platformLike) && text.length < 140) {
    return true;
  }

  return false;
}

function normalizeBrainSiteSpec(rawSiteSpec, userMessage = '') {
  if (!rawSiteSpec || typeof rawSiteSpec !== 'object') return null;

  const asText = (value, fallback = '') => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
  };
  const toArray = (value) => (Array.isArray(value) ? value : []);

  const normalizeSection = (section = {}, index = 0) => ({
    id: asText(section.id, `section_${index + 1}`),
    title: asText(section.title, `Seção ${index + 1}`),
    purpose: asText(section.purpose, ''),
    copy: asText(section.copy || section.description, 'Conteúdo a definir nesta seção.'),
    ctaLabel: asText(section.ctaLabel || section.cta, 'Saiba mais'),
    ctaTarget: asText(section.ctaTarget || section.ctaHref, '#contato'),
  });

  const normalizePage = (page = {}, index = 0) => ({
    slug: asText(page.slug, index === 0 ? 'index' : `pagina-${index + 1}`),
    title: asText(page.title, index === 0 ? 'Página inicial' : `Página ${index + 1}`),
    goal: asText(page.goal, ''),
    sections: toArray(page.sections).map((section, sectionIndex) => normalizeSection(section, sectionIndex)).slice(0, 12),
  });

  const pagesRaw = toArray(rawSiteSpec.pages).map((page, pageIndex) => normalizePage(page, pageIndex)).slice(0, 8);
  const mechanics = toArray(rawSiteSpec.mechanics).map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 12);
  const menuItems = toArray(rawSiteSpec.menuItems || (rawSiteSpec.header && rawSiteSpec.header.menuItems))
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 10);

  const sourcePrompt = String(userMessage || '').toLowerCase();
  const inferredType = /\b(plataforma|sistema|painel|dashboard|portal|saas)\b/.test(sourcePrompt) ? 'platform' : 'modular_site';
  const siteType = asText(rawSiteSpec.siteType, inferredType);

  let pages = pagesRaw;
  if (!pages.length) {
    pages = [
      {
        slug: 'index',
        title: 'Página inicial',
        goal: 'Apresentar proposta de valor e direcionar para contato.',
        sections: [
          { id: 'hero', title: 'Hero', purpose: 'Posicionamento principal', copy: 'Título principal + subtítulo + prova social curta.', ctaLabel: 'Falar com a equipe', ctaTarget: '#contato' },
          { id: 'servicos', title: 'Serviços', purpose: 'Mostrar ofertas principais', copy: 'Lista de serviços com benefícios.', ctaLabel: 'Ver serviços', ctaTarget: '#servicos' },
          { id: 'sobre', title: 'Sobre', purpose: 'Gerar confiança', copy: 'História, diferenciais e credenciais.', ctaLabel: 'Conhecer equipe', ctaTarget: '#sobre' },
          { id: 'contato', title: 'Contato', purpose: 'Conversão', copy: 'Formulário e canais de atendimento.', ctaLabel: 'Agendar atendimento', ctaTarget: '#contato' },
        ],
      },
    ];
  }

  return {
    siteType,
    brandName: asText(rawSiteSpec.brandName, ''),
    audience: asText(rawSiteSpec.audience, ''),
    tone: asText(rawSiteSpec.tone, ''),
    menuItems,
    footerNote: asText(rawSiteSpec.footerNote || (rawSiteSpec.footer && rawSiteSpec.footer.note), ''),
    pages,
    mechanics,
  };
}

function buildFallbackSiteSpecFromBriefing(userMessage = '', contextHint = {}) {
  const contract = inferBriefingContract({
    userMessage,
    contextText: buildClarificationContextText(contextHint),
  });
  const briefingSpec = buildBriefingSpec({
    userMessage,
    contextText: buildClarificationContextText(contextHint),
    contract,
  });
  const temporary = briefingSpec && isActiveTemporaryBlueprintContract(briefingSpec.temporaryBlueprintContract)
    ? briefingSpec.temporaryBlueprintContract
    : null;
  if (!temporary) {
    return normalizeBrainSiteSpec({
      siteType: 'modular_site',
      brandName: briefingSpec && briefingSpec.current && briefingSpec.current.brand
        ? briefingSpec.current.brand
        : contract.brandFallback || contract.domainLabel || '',
    }, userMessage);
  }
  const pages = Array.isArray(temporary.requiredPages) && temporary.requiredPages.length
    ? temporary.requiredPages
    : [{ id: '/', label: 'Início' }];
  const sections = Array.isArray(temporary.requiredSections) && temporary.requiredSections.length
    ? temporary.requiredSections
    : [
        { id: 'hero', label: 'hero' },
        { id: 'contact', label: 'contato' },
      ];
  return normalizeBrainSiteSpec({
    siteType: 'modular_site',
    brandName: temporary.brandFallback || temporary.domainLabel || temporary.label || '',
    audience: temporary.domainLabel || temporary.label || '',
    tone: 'claro, específico e aderente ao briefing atual',
    menuItems: pages.map((page) => page.label || page.id || 'Página'),
    footerNote: temporary.domainLabel || temporary.label || '',
    mechanics: ['menu_mobile', 'links_entre_paginas', 'formulario_contato'],
    pages: pages.map((page, index) => ({
      slug: index === 0 ? 'index' : String(page.id || page.label || `pagina-${index + 1}`).replace(/^\/+/, '') || `pagina-${index + 1}`,
      title: page.label || page.id || `Página ${index + 1}`,
      goal: `Atender a rota/página obrigatória ${page.label || page.id || index + 1} do briefing atual.`,
      sections: sections.slice(0, 6).map((section, sectionIndex) => ({
        id: section.id || `section_${sectionIndex + 1}`,
        title: section.label || section.id || `Seção ${sectionIndex + 1}`,
        purpose: `Preservar o requisito "${section.label || section.id || 'seção'}" do briefing atual.`,
        copy: `Conteúdo específico do briefing atual para ${temporary.domainLabel || temporary.label || 'o projeto solicitado'}.`,
        ctaLabel: sectionIndex === 0 ? 'Quero conhecer' : 'Saiba mais',
        ctaTarget: '#contato',
      })),
    })),
  }, userMessage);
}

function createCortexBriefingService(dependencies = {}) {
  const {
    BRAIN_BRIEFING_TIMEOUT_MS = 600000,
    PERSONA_MODEL_BRAIN = 'brain',
    buildAttachmentsPromptContext = async () => '',
    buildDiagnosticsPromptContext = () => '',
    buildLocalProjectDiagnostics = () => null,
    buildProjectEvolutionContext = () => '',
    callPersonaProviderChat,
    clipText = (value, max = 4000) => String(value || '').slice(0, max),
    formatLocalProjectDiagnosticsForPrompt = () => '',
    formatMempalaceCoreForPrompt = () => '',
    getRuntimeProfileSettings,
    hasScaffoldIntent = defaultHasScaffoldIntent,
    sanitizeAssistantText = (text, fallback) => String(text || '').trim() || fallback,
    tryParseJsonObject = (raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
  } = dependencies;

  function requireDependency(name, value) {
    if (!value) throw new Error(`Cortex briefing dependency missing: ${name}`);
  }

  function compactPromptPart(value, limit) {
    return clipText(String(value || ''), Math.max(200, Number(limit) || 1200));
  }

  function shouldAsk(userMessage, contextHint = {}) {
    return shouldAskCortexBriefingClarification(userMessage, contextHint, { hasScaffoldIntent });
  }

  function buildLocalFallbackBriefing(userMessage = '', raw = '', extra = {}) {
    const fallbackBriefSpec = buildFallbackSiteSpecFromBriefing(userMessage, extra && extra.contextHint ? extra.contextHint : {});
    const fallbackBrief = [
      'Briefing normalizado localmente pelo Cortex a partir do pedido do usuário.',
      `Pedido: ${compactPromptPart(userMessage, 900)}`,
      shouldUseDefaultScaffoldConfiguration(userMessage)
        ? 'Defaults/placeholders autorizados; prosseguir sem nova clarificação.'
        : '',
    ].filter(Boolean).join(' ');

    return {
      brief: sanitizeAssistantText(fallbackBrief, 'Briefing criado pelo Cortex a partir do pedido do usuário.'),
      briefSpec: fallbackBriefSpec,
      acceptanceCriteria: [
        'Gerar artefatos executáveis e verificáveis para o pedido.',
        fallbackBriefSpec && fallbackBriefSpec.brandName
          ? `Preservar a marca "${fallbackBriefSpec.brandName}" nos artefatos.`
          : '',
        fallbackBriefSpec && Array.isArray(fallbackBriefSpec.pages) && fallbackBriefSpec.pages.length > 1
          ? `Gerar navegação real para ${fallbackBriefSpec.pages.length} página(s)/rota(s).`
          : '',
      ].filter(Boolean),
      risks: [
        extra && extra.providerError
          ? 'A Persona remota falhou nesta etapa; o Cortex continuou com briefing local para não bloquear uma rota válida.'
          : 'A Persona não retornou JSON estruturado ou completo; briefing foi normalizado pelo Cortex.',
      ],
      suggestedPasses: ['render_operations'],
      needsClarification: false,
      clarificationQuestions: [],
      raw,
      providerFallback: Boolean(extra && extra.providerError),
      providerFailure: extra && extra.providerFailure ? extra.providerFailure : null,
    };
  }

  async function requestCortexBrainBriefing({
    projectInfo,
    userMessage,
    attachments = [],
    mempalaceContext,
    mempalaceCore,
    ragContext,
    cortexContext,
    activeMemory = null,
    runtimeBudget,
    latestDiagnostics = null,
  }) {
    const defaultsAuthorized = shouldUseDefaultScaffoldConfiguration(userMessage);
    if (defaultsAuthorized && hasScaffoldIntent(userMessage)) {
      return {
        brief: [
          'Briefing determinístico para criação inicial com defaults/placeholders autorizados.',
          `Pedido consolidado: ${compactPromptPart(userMessage, 900)}`,
          'Prosseguir sem nova clarificação e gerar artefatos base conectados.',
        ].join(' '),
        briefSpec: normalizeBrainSiteSpec({ siteType: 'modular_site' }, userMessage),
        acceptanceCriteria: [
          'Gerar entrada executável do projeto.',
          'Conectar CSS e JavaScript ao arquivo principal.',
          'Usar conteúdo placeholder suficiente para validar estrutura, responsividade e CTA.',
        ],
        risks: ['Conteúdo e identidade visual finais ainda precisarão de refinamento após a primeira versão.'],
        suggestedPasses: ['render_operations'],
        needsClarification: false,
        clarificationQuestions: [],
        raw: 'deterministic_defaults_briefing',
      };
    }

    requireDependency('callPersonaProviderChat', callPersonaProviderChat);
    requireDependency('getRuntimeProfileSettings', getRuntimeProfileSettings);
    const runtimeSettings = getRuntimeProfileSettings();
    const compactProject = {
      rootPath: projectInfo.rootPath,
      stacks: projectInfo.stacks,
      totalFiles: projectInfo.totalFiles,
      counters: projectInfo.counters,
      sampleFiles: (projectInfo.files || []).slice(0, runtimeSettings.brainSampleFilesLimit),
    };
    const projectEvolutionContext = buildProjectEvolutionContext(projectInfo, userMessage, {
      maxFiles: Math.max(4, Math.min(10, Number(runtimeSettings.brainSampleFilesLimit) || 8)),
      maxCharsPerFile: 950,
      totalMaxChars: 5600,
    });
    const attachmentContext = await buildAttachmentsPromptContext(attachments, {
      maxAttachments: 4,
      maxCharsPerAttachment: 1300,
      totalMaxChars: 4200,
    });
    const diagnosticsContext = buildDiagnosticsPromptContext(latestDiagnostics, {
      maxIssues: 6,
      maxChars: 1700,
    });
    const localDiagnostics = buildLocalProjectDiagnostics({ projectInfo, userMessage, attachments });
    const localDiagnosticsContext = formatLocalProjectDiagnosticsForPrompt(localDiagnostics);
    const activeMemoryContext =
      activeMemory && activeMemory.decision && activeMemory.decision.briefingContextText
        ? compactPromptPart(activeMemory.decision.briefingContextText, 1800)
        : '';
    const systemPrompt = [
      'Você é a Persona ativa dentro do Cortex Render Runtime.',
      'Sua função é criar briefing operacional detalhado para o Executor, sem gerar código direto.',
      'Responda somente JSON válido.',
      'Quando o pedido envolver site/plataforma, detalhe páginas, seções, CTAs, mecânicas e textos-guia por seção.',
      'Nunca devolva resumo raso; sempre decomponha em requisitos acionáveis.',
      'Se faltarem dados críticos para execução com qualidade, marque needsClarification=true e devolva 3-5 perguntas objetivas em clarificationQuestions.',
      defaultsAuthorized
        ? 'Neste pedido o usuário autorizou defaults/placeholders; portanto needsClarification deve ser false e você deve preencher lacunas com escolhas plausíveis.'
        : '',
    ].filter(Boolean).join(' ');

    const userPrompt = [
      `Pedido: ${compactPromptPart(userMessage, runtimeBudget.maxPromptCharsPerPass)}`,
      defaultsAuthorized
        ? 'Diretriz de clarificação: defaults/placeholders autorizados; prossiga sem perguntas e defina conteúdo placeholder suficiente.'
        : 'Diretriz de clarificação: pergunte somente quando uma decisão crítica impedir execução com qualidade.',
      attachments.length
        ? `Anexos: ${attachments.map((a) => `${a.name} (${a.type || 'desconhecido'})`).join(', ')}`
        : 'Anexos: nenhum',
      attachmentContext
        ? `Conteúdo extraído de anexos (OCR/texto):\n${attachmentContext}`
        : 'Conteúdo extraído de anexos: indisponível',
      `Projeto: ${JSON.stringify(compactProject)}`,
      projectEvolutionContext
        ? `Arquivos atuais do projeto (trechos para evolução incremental):\n${projectEvolutionContext}`
        : 'Arquivos atuais do projeto: indisponíveis',
      diagnosticsContext
        ? `Diagnóstico técnico da última execução (use para correções pontuais):\n${diagnosticsContext}`
        : 'Diagnóstico técnico anterior: indisponível',
      localDiagnosticsContext
        ? `Diagnóstico local dos arquivos atuais (não pergunte de novo sobre isto; use para orientar o plano):\n${localDiagnosticsContext}`
        : 'Diagnóstico local dos arquivos atuais: indisponível',
      activeMemoryContext
        ? `Memória ativa operacional (separada entre usuário, projeto e mensagem atual):\n${activeMemoryContext}`
        : 'Memória ativa operacional: indisponível',
      mempalaceContext && mempalaceContext.contextText
        ? `MemPalace relevante:
${compactPromptPart(mempalaceContext.contextText, 900)}`
        : 'MemPalace relevante: indisponível',
      mempalaceCore && mempalaceCore.ok
        ? `MemPalace core operacional:
${formatMempalaceCoreForPrompt(mempalaceCore, 1300)}`
        : 'MemPalace core operacional: indisponível',
      ragContext && ragContext.contextText
        ? `RAG relevante (${ragContext.provider || 'r2r'}):
${compactPromptPart(ragContext.contextText, 1200)}`
        : 'RAG relevante: indisponível',
      cortexContext && cortexContext.available
        ? `Cortex relevante:
${compactPromptPart(cortexContext.contextText, 900)}`
        : 'Cortex relevante: sem entradas úteis',
      'Formato JSON obrigatório:',
      '{',
      '  "brief": "resumo executivo objetivo",',
      '  "acceptanceCriteria": ["critério mensurável"],',
      '  "risks": ["risco"],',
      '  "suggestedPasses": ["passo"],',
      '  "needsClarification": false,',
      '  "clarificationQuestions": ["pergunta objetiva"],',
      '  "siteSpec": {',
      '    "siteType": "modular_site|platform",',
      '    "brandName": "nome da marca",',
      '    "audience": "público principal",',
      '    "tone": "tom de comunicação",',
      '    "menuItems": ["Início", "Serviços", "Sobre", "Contato"],',
      '    "footerNote": "texto de rodapé",',
      '    "mechanics": ["formulario_contato", "scroll_suave", "menu_mobile"],',
      '    "pages": [',
      '      {',
      '        "slug": "index",',
      '        "title": "Página inicial",',
      '        "goal": "objetivo da página",',
      '        "sections": [',
      '          {',
      '            "id": "hero",',
      '            "title": "Título da seção",',
      '            "purpose": "função da seção",',
      '            "copy": "texto guia da seção",',
      '            "ctaLabel": "texto do botão",',
      '            "ctaTarget": "destino do CTA"',
      '          }',
      '        ]',
      '      }',
      '    ]',
      '  }',
      '}',
      'Mesmo fora de site/plataforma, retorne siteSpec mínimo adaptado para orientar o executor.',
      'Se houver incerteza real, não invente: use needsClarification=true e perguntas curtas.',
    ].join('\n');

    let raw = '';
    try {
      raw = await callPersonaProviderChat(
        PERSONA_MODEL_BRAIN,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        BRAIN_BRIEFING_TIMEOUT_MS,
        { runtimeBudget, options: { num_predict: Math.min(700, runtimeBudget.generationOptions.num_predict || 700) } }
      );
    } catch (error) {
      const failure = normalizeProviderFailure(error, 'persona_briefing');
      return buildLocalFallbackBriefing(userMessage, buildProviderFailureReason(failure), {
        providerError: true,
        providerFailure: failure,
        contextHint: { conversationMessages: [], originalUserMessage: userMessage },
      });
    }
    const parsed = tryParseJsonObject(raw);
    if (!parsed) {
      return buildLocalFallbackBriefing(userMessage, raw);
    }

    return {
      brief: typeof parsed.brief === 'string' && parsed.brief.trim() ? parsed.brief.trim() : 'Briefing compacto criado.',
      briefSpec: normalizeBrainSiteSpec(parsed.siteSpec, userMessage),
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria)
        ? parsed.acceptanceCriteria.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 16)
        : ['Gerar artefatos executáveis e verificáveis para o pedido.'],
      risks: Array.isArray(parsed.risks)
        ? parsed.risks.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
        : [],
      suggestedPasses: Array.isArray(parsed.suggestedPasses)
        ? parsed.suggestedPasses.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
        : ['render_operations'],
      needsClarification: defaultsAuthorized ? false : Boolean(parsed.needsClarification),
      clarificationQuestions: defaultsAuthorized || !Array.isArray(parsed.clarificationQuestions)
        ? []
        : parsed.clarificationQuestions.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 5),
      raw,
    };
  }

  return {
    buildCortexBriefingClarificationResponse,
    buildDefaultScaffoldPrompt,
    getCortexBriefingClarificationQuestions,
    normalizeBrainSiteSpec,
    requestCortexBrainBriefing,
    shouldAskCortexBriefingClarification: shouldAsk,
    shouldUseDefaultScaffoldConfiguration,
  };
}

module.exports = {
  buildCortexBriefingClarificationResponse,
  buildDefaultScaffoldPrompt,
  createCortexBriefingService,
  getCortexBriefingClarificationQuestions,
  hasMinimumInstitutionalBriefingDetails,
  hasEnoughInitialScaffoldDetails,
  hasScaffoldPlatformDetails,
  normalizeBrainSiteSpec,
  shouldAskCortexBriefingClarification,
  shouldUseDefaultScaffoldConfiguration,
};
