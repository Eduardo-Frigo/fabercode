const {
  hasAnyScannedFiles,
  hasApplicationSurfaceFiles,
  normalizeIntentText,
  stripNegatedIntentClauses,
} = require('./execution_intent');
const {
  buildProductIntake,
} = require('./product_intake_service');
const { inferBriefingContract } = require('./briefing_contract_service');
const {
  buildBriefingSpec,
  formatBriefingSpecForPrompt,
} = require('./briefing_spec_service');
const {
  isActiveTemporaryBlueprintContract,
} = require('./temporary_blueprint_contract_service');

const WORKING_BRIEF_SCHEMA_VERSION = 'working-brief-v1';
const DEFAULT_SITE_STACK = 'next-tailwind';

const DOMAIN_OVERRIDES = {
  'intellectual-property': {
    id: 'intellectual-property',
    label: 'propriedade intelectual',
    brandFallback: 'Escritório de Propriedade Intelectual',
    mediaQuery: 'patent law intellectual property office technology documents',
    iconIntents: ['shield-check', 'file-text', 'globe-alt'],
  },
  'sustainable-product-landing': {
    id: 'sustainable-product-landing',
    label: 'produto sustentável com catálogo',
    brandFallback: 'Marca de Produto Sustentável',
    mediaQuery: 'premium reusable glass water bottle natural kitchen sustainability',
    iconIntents: ['droplet', 'leaf', 'shield-check'],
  },
  'technical-b2b-services-site': {
    id: 'technical-b2b-services-site',
    label: 'serviços técnicos B2B multipágina',
    brandFallback: 'Empresa Técnica B2B',
    mediaQuery: 'modern aluminum windows acm facade glass curtain wall architecture construction',
    iconIntents: ['building', 'ruler', 'calculator'],
  },
  'premium-wine-landing': {
    id: 'premium-wine-landing',
    label: 'vinhos premium e experiência sensorial',
    brandFallback: 'Vinícola Boutique',
    mediaQuery: 'premium wine bottle vineyard cellar tasting table golden light',
    iconIntents: ['sparkles', 'gift', 'map-pin'],
  },
  'construction-materials-site': {
    id: 'construction-materials-site',
    label: 'loja de materiais de construção multipágina',
    brandFallback: 'Loja de Materiais de Construção',
    mediaQuery: 'construction materials store cement bricks tools warehouse delivery',
    iconIntents: ['building', 'truck', 'document-text'],
  },
  'saas-tool': {
    id: 'saas-tool',
    label: 'SaaS e ferramenta operacional',
    brandFallback: 'Faber Workspace',
    mediaQuery: 'modern software dashboard workspace analytics interface',
    iconIntents: ['chart-bar', 'shield-check', 'users'],
  },
  'editorial-content': {
    id: 'editorial-content',
    label: 'conteúdo editorial',
    brandFallback: 'Revista Faber',
    mediaQuery: 'editorial magazine workspace publication articles',
    iconIntents: ['document-text', 'sparkles', 'users'],
  },
  'institutional-education': {
    id: 'institutional-education',
    label: 'escola institucional e educação',
    brandFallback: 'Escola Institucional',
    mediaQuery: 'warm minimal education leadership workshop natural light editorial',
    iconIntents: ['document-text', 'users', 'sparkles'],
  },
  'general-institutional-site': {
    id: 'general-institutional-site',
    label: 'site institucional genérico',
    brandFallback: 'Projeto Institucional',
    mediaQuery: 'warm editorial institutional website natural workspace',
    iconIntents: ['document-text', 'sparkles', 'users'],
  },
  'humpback-whales': {
    id: 'humpback-whales',
    label: 'baleias jubarte',
    brandFallback: 'Jubarte Azul',
    mediaQuery: 'humpback whale ocean blue',
    iconIntents: ['waves', 'compass', 'globeAlt'],
  },
  legal: {
    id: 'legal',
    label: 'advocacia',
    brandFallback: 'Escritório Faber Advocacia',
    mediaQuery: 'modern law office blue',
    iconIntents: ['scale', 'document-text', 'shield-check'],
  },
  dental: {
    id: 'dental',
    label: 'odontologia',
    brandFallback: 'Clínica Sorriso',
    mediaQuery: 'modern dental clinic blue white',
    iconIntents: ['smile', 'calendar-check', 'shield-check'],
  },
  veterinary: {
    id: 'veterinary',
    label: 'veterinário',
    brandFallback: 'Clínica Faber Vet',
    mediaQuery: 'veterinary clinic pet care',
    iconIntents: ['heart-pulse', 'calendar-check', 'shield-check'],
  },
  architecture: {
    id: 'architecture',
    label: 'arquitetura',
    brandFallback: 'Studio Habitat',
    mediaQuery: 'modern architecture interior design',
    iconIntents: ['ruler', 'layers', 'building'],
  },
  'import-services': {
    id: 'import-services',
    label: 'importação',
    brandFallback: 'ImportaPro Consultoria',
    mediaQuery: 'international shipping containers port logistics cargo',
    iconIntents: ['globe-alt', 'document-text', 'truck'],
  },
  photography: {
    id: 'photography',
    label: 'fotografia',
    brandFallback: 'Estúdio Aurora',
    mediaQuery: 'photography studio portrait',
    iconIntents: ['camera', 'image', 'sparkles'],
  },
  'photo-lab': {
    id: 'photo-lab',
    label: 'laboratório fotográfico',
    brandFallback: 'Laboratório Fotográfico',
    mediaQuery: 'darkroom film development photo lab fine art printing negatives',
    iconIntents: ['camera', 'document-text', 'sparkles'],
  },
  chocolate: {
    id: 'chocolate',
    label: 'chocolate artesanal',
    brandFallback: 'Maison Cacao',
    mediaQuery: 'artisan chocolate melting cocoa premium dessert',
    iconIntents: ['sparkles', 'gift', 'heart-pulse'],
  },
  gardening: {
    id: 'gardening',
    label: 'jardinagem',
    brandFallback: 'Jardim Vivo',
    mediaQuery: 'lush home garden landscaping plants natural light',
    iconIntents: ['leaf', 'droplet', 'sparkles'],
  },
  'wood-finishes': {
    id: 'wood-finishes',
    label: 'revestimentos de madeira',
    brandFallback: 'Estúdio de Revestimentos Naturais',
    mediaQuery: 'premium wood flooring interior design natural wood panels',
    iconIntents: ['layers', 'home', 'ruler'],
  },
  'wood-sculpture': {
    id: 'wood-sculpture',
    label: 'escultura em madeira',
    brandFallback: 'Ateliê Madeira Viva',
    mediaQuery: 'wood carving artisan hands sculpture workshop',
    iconIntents: ['sparkles', 'leaf', 'shield-check'],
  },
  'leather-goods': {
    id: 'leather-goods',
    label: 'artefatos de couro',
    brandFallback: 'Atelier Couro Faber',
    mediaQuery: 'handmade leather bags artisan workshop',
    iconIntents: ['briefcase', 'sparkles', 'shield-check'],
  },
  greenhouses: {
    id: 'greenhouses',
    label: 'estufas agrícolas',
    brandFallback: 'Estufas Protegidas',
    mediaQuery: 'modern greenhouse farming protected cultivation vegetables',
    iconIntents: ['leaf', 'shield-check', 'droplet'],
  },
  'real-estate': {
    id: 'real-estate',
    label: 'imóveis',
    brandFallback: 'Faber Imóveis',
    mediaQuery: 'modern real estate interior',
    iconIntents: ['home', 'map-pin', 'key-round'],
  },
  aquarium: {
    id: 'aquarium',
    label: 'aquário',
    brandFallback: 'Aqua Viva',
    mediaQuery: 'modern public aquarium blue fish penguins visitors',
    iconIntents: ['waves', 'map-pin', 'compass'],
  },
};

function normalizeBriefText(value = '') {
  return normalizeIntentText(value);
}

function compactText(value = '', max = 640) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function buildSourceText({
  userMessage = '',
  contextText = '',
  workGraph = null,
  conversationMessages = [],
} = {}) {
  const parts = [userMessage, contextText];
  if (Array.isArray(conversationMessages) && conversationMessages.length) {
    parts.push(
      conversationMessages
        .slice(-8)
        .map((message) => {
          const role = message && message.role === 'assistant' ? 'assistant' : 'user';
          const text = String(message && (message.text || message.content || message.message) || '').trim();
          return text ? `${role}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n')
    );
  }
  if (workGraph && typeof workGraph === 'object') {
    parts.push(workGraph.brief || '');
    if (workGraph.briefSpec) {
      try {
        parts.push(JSON.stringify(workGraph.briefSpec));
      } catch {
        parts.push(String(workGraph.briefSpec || ''));
      }
    }
  }
  return parts.filter(Boolean).join('\n');
}

function isWorkingBriefMemoryContinuation(userMessage = '', activeMemory = null) {
  const normalized = normalizeBriefText(userMessage);
  if (!normalized) return false;
  if (hasSelfContainedCurrentBriefForWorkingBrief(normalized)) return false;
  if (activeMemory && activeMemory.current && activeMemory.current.continuationIntent) return true;
  return /\b(memoria|contexto|como combinamos|como conversamos|do jeito que falamos|segue com isso|usa isso|use isso|briefing que passei|briefing completo|nessa conversa|desta conversa|que enviei)\b/.test(
    normalized
  );
}

function isWorkingBriefConversationContinuation(userMessage = '', conversationMessages = [], projectInfo = null) {
  if (!Array.isArray(conversationMessages) || !conversationMessages.length) return false;
  const normalized = normalizeBriefText(userMessage);
  if (!normalized || hasSelfContainedCurrentBriefForWorkingBrief(normalized)) return false;
  if (hasApplicationSurfaceFiles(projectInfo || {}) && hasEditSignal(userMessage)) return false;
  const hasContinuationDetail = /\b(acho que|tambem|também|secao|seção|secoes|seções|hero|cta|horario|horarios|ingresso|ingressos|mapa|contato|imagem|imagens|icone|icones|ícone|ícones|fonte|google|manrope|paleta|cor|cores|azul|branco|estilo|experiencia|experiência|imersiva|passeio|passeios|catalogo|catálogo|blog|loja|checkout|pagamento|briefing|pedido|finalize|finalizar)\b/.test(
    normalized
  );
  if (!hasContinuationDetail) return false;
  const recentConversation = conversationMessages
    .slice(-8)
    .map((message) => String(message && (message.text || message.content || message.message) || ''))
    .join(' ');
  return hasExplicitCreateSignal(recentConversation) || /\b(site|landing|pagina|app|projeto|next|react|tailwind)\b/.test(normalizeBriefText(recentConversation));
}

function hasSelfContainedCurrentBriefForWorkingBrief(normalized = '') {
  return normalized.length >= 260 && hasExplicitCreateSignal(normalized);
}

function summarizeWorkingBriefMemory(activeMemory = null) {
  if (!activeMemory || typeof activeMemory !== 'object') return null;
  const user = activeMemory.user || {};
  const project = activeMemory.project || {};
  return {
    schemaVersion: activeMemory.schemaVersion || 'active-memory-v1',
    continuationIntent: Boolean(activeMemory.current && activeMemory.current.continuationIntent),
    user: {
      available: Boolean(user.available),
      selectedCount: Number(user.selectedCount || 0),
    },
    project: {
      available: Boolean(project.available),
      selectedCount: Number(project.selectedCount || 0),
      hasProjectFiles: Boolean(project.projectFilesText),
    },
  };
}

function hasAutonomousPlaceholderSignal(source = '') {
  const normalized = normalizeBriefText(source);
  if (!normalized) return false;
  if (/\b(sem placeholders?|nao usar placeholders?|nao quero placeholders?|conteudo final|conteudo real|conteudo especifico|usar meus textos|use meus textos)\b/.test(normalized)) {
    return false;
  }
  return /\b(qualquer coisa|faz qualquer|faca qualquer|voce decide|pode decidir|pode sugerir|sugira|placeholders?|placeholder|generico|generica|sem perguntar|sem travar|depois ajusto|so quero ver|quero visualizar|teste rapido)\b/.test(
    stripNegatedIntentClauses(normalized)
  );
}

function hasExplicitCreateSignal(source = '') {
  const normalized = normalizeBriefText(source);
  return /\b(crie|criar|gere|gerar|monte|montar|construa|construir|implemente|implementar|desenvolva|desenvolver|configure|configurar|faca|fazer|novo projeto|nova pagina|nova area|nova base|algo novo|composicao modular|composição modular|briefing completo|site completo|landing|site|app|aplicacao|sistema|ferramenta|calculadora|conversor|componente|fluxo|integracao|integração|dashboard|crm|preset|mcp|tools?|capability)\b/.test(
    normalized
  );
}

function hasEditSignal(source = '') {
  const normalized = normalizeBriefText(source);
  return /\b(altere|alterar|edite|editar|corrija|corrigir|ajuste|ajustar|mude|mudar|troque|trocar|insira|inserir|adicione|adicionar|remova|remover|refatore|refatorar|atualize|atualizar|melhore|melhorar)\b/.test(
    normalized
  );
}

function hasDiagnosticSignal(source = '') {
  const normalized = normalizeBriefText(source);
  return /\b(erro|bug|falha|build|quebrou|diagnostico|diagnosticar|debug|depurar|preview nao abre|nao funciona)\b/.test(
    normalized
  );
}

function hasVisualCorrectionIntent(source = '') {
  const normalized = normalizeBriefText(source);
  return /\b(altere|alterar|edite|editar|corrija|corrigir|ajuste|ajustar|mude|mudar|troque|trocar|atualize|atualizar|deixe|deixar|coloque|colocar|nao mudou|precisa estar|deve estar|deveria estar|precisa ficar|deve ficar|ficar igual|como no anexo|esta limitado|limitado)\b/.test(
    normalized
  );
}

function hasVisualReviewSignal(source = '', attachments = []) {
  const normalized = normalizeBriefText(source);
  if (hasVisualCorrectionIntent(normalized)) return false;
  const reviewIntent = /\b(validar visualmente|validacao visual|valida[rcao]* visual|revisar visual|analise visual|analisar visualmente|comparar com o briefing|aderencia visual|captura visual|preview visual|smoketest visual|smoke visual|prints? para validar|screenshots? para validar|validar prints?|validar screenshots?)\b/.test(
    normalized
  );
  if (reviewIntent) return true;

  const screenshotContext = /\b(prints?|screenshots?|capturas?|imagens anexadas?|anexos?)\b/.test(normalized) &&
    /\b(validar|validacao|revisar|analisar|comparar|diagnosticar|avaliar)\b/.test(normalized);
  if (screenshotContext) return true;

  return Boolean(
    Array.isArray(attachments) &&
      attachments.length > 0 &&
      /\b(validar|validacao|revisar|analisar|comparar|diagnosticar|avaliar)\b/.test(normalized)
  );
}

function hasToolSignal(source = '') {
  const normalized = normalizeBriefText(source);
  if (/\b(terminal|git|commit|push|deploy|executar comando|rodar comando|npm install|npm run)\b/.test(normalized)) {
    return true;
  }
  return (
    /\b(abrir|abra|iniciar|inicie|rodar|rode|subir|suba|executar|execute|capturar|capture|recarregar|recarregue|testar|teste)\b.{0,50}\bpreview\b/.test(normalized) ||
    /\bpreview\b.{0,50}\b(localhost|porta|browser|navegador|abrir|iniciar|rodar|subir|capturar|recarregar)\b/.test(normalized)
  );
}

function hasDesignReferenceSignal(source = '', attachments = []) {
  const normalized = normalizeBriefText(source);
  if (/\b(figma|design-to-code|layout anexado|print anexado|screenshot|imagem de referencia|referencia visual|mockup|arquivo de design)\b/.test(normalized)) return true;
  return Array.isArray(attachments) && attachments.some((attachment) => {
    const text = normalizeBriefText(
      `${attachment && attachment.name ? attachment.name : ''} ${attachment && attachment.type ? attachment.type : ''}`
    );
    return /\b(figma|png|jpg|jpeg|webp|screenshot|mockup|design)\b/.test(text);
  });
}

function hasNewAreaSignal(source = '') {
  const normalized = normalizeBriefText(source);
  return /\b(nova area|nova secao|nova seção|nova pagina|nova rota|novo modulo|adicionar pagina|adicionar secao|adicionar seção)\b/.test(
    normalized
  );
}

function inferProjectState(projectInfo = null) {
  const hasProject = Boolean(projectInfo && projectInfo.rootPath);
  const hasAnyFiles = hasAnyScannedFiles(projectInfo || {});
  const hasApplicationFiles = hasApplicationSurfaceFiles(projectInfo || {});
  const state = !hasProject
    ? 'missing_project'
    : hasApplicationFiles
      ? 'existing_project'
      : hasAnyFiles
        ? 'metadata_only_project'
        : 'empty_project';

  return {
    state,
    hasProject,
    hasAnyFiles,
    hasApplicationFiles,
    rootPath: hasProject ? String(projectInfo.rootPath || '') : '',
  };
}

function inferProjectKind(source = '') {
  const normalized = normalizeBriefText(source);
  if (/\blanding\b|\bone page\b|one-page|pagina institucional|página institucional|site institucional\b/.test(normalized)) {
    return 'institutional-site';
  }
  if (/\bdashboard|painel|admin|crm|saas|portal\b/.test(normalized)) return 'application';
  if (/\bapi|backend|servidor\b/.test(normalized)) return 'backend';
  if (/\blamp|php\b/.test(normalized)) return 'lamp-site';
  if (/\bsite|pagina|page|web\b/.test(normalized)) return 'site';
  return '';
}

function inferColorPalette(source = '', domain = '') {
  const normalized = normalizeBriefText(source);
  const positiveNormalized = stripNegatedIntentClauses(normalized);
  const requested = [];
  let primary = '';
  let background = '';
  let surface = '';
  let text = '';

  const push = (name) => {
    if (!requested.includes(name)) requested.push(name);
  };

  if (/\b(?:pantone\s+)?p 10-7 c\b/.test(positiveNormalized)) {
    primary = '#f0be43';
    push('pantone-p-10-7-c');
  }
  if (/\b(?:pantone\s+)?p 14-16 c\b/.test(positiveNormalized)) {
    if (!primary) primary = '#d19615';
    push('pantone-p-14-16-c');
  }
  if (/\b(?:pantone\s+)?p 20-2 c\b/.test(positiveNormalized)) {
    surface = surface || '#f1cc98';
    push('pantone-p-20-2-c');
  }
  if (/\b(?:pantone\s+)?p 179-16 c\b/.test(positiveNormalized)) {
    text = '#2d2a29';
    push('pantone-p-179-16-c');
  }
  if (/\b(?:pantone\s+)?p 1-1 c\b/.test(positiveNormalized)) {
    background = '#f8f7f2';
    surface = surface || '#fffaf0';
    push('pantone-p-1-1-c');
  }

  if (/\bazul\b|\bblue\b/.test(positiveNormalized)) {
    primary = '#3240a8';
    push('azul');
  }
  const wantsPlainWhite = (/\bbranc[oa]s?\b|\bwhite\b/.test(positiveNormalized)) &&
    !/\boff[-\s]?white\b|\bbranco quente\b|\bwhite quente\b|\bcreme\b|\bcream\b/.test(positiveNormalized);
  const wantsExplicitLight = /\bvisual claro\b|\btema claro\b|\bfundo suave\b|\bcards? branc[oa]s?\b/.test(positiveNormalized);
  if (wantsPlainWhite || wantsExplicitLight) {
    background = wantsExplicitLight && !wantsPlainWhite ? '#f7faf8' : '#ffffff';
    surface = '#ffffff';
    text = '#212121';
    push(wantsExplicitLight ? 'claro' : 'branco');
  }
  if (/\bvermelh|coral|#cf416b\b/.test(positiveNormalized)) {
    primary = '#cf416b';
    push('vermelho');
  }
  if (/\bmarsala\b|\bvinho\b|\bbordo\b|\bbordô\b/.test(positiveNormalized)) {
    primary = '#8f3447';
    push('marsala');
  }
  if (/\b(chocolate|cacau|cacao|marrom chocolate)\b/.test(positiveNormalized)) {
    primary = primary || '#3b1f14';
    text = text || '#1e0f0a';
    push('chocolate');
  }
  if (/\bcreme\b|\bcream\b|\bbranco quente\b/.test(positiveNormalized)) {
    background = background || '#f7e7ce';
    surface = surface || '#fff8f0';
    push('creme');
  }
  if (/\bdourado suave\b|\bdourado\b|\bouro\b/.test(positiveNormalized)) {
    primary = primary || '#c98b3c';
    push('dourado');
  }
  if (/\b[aâ]mbar\b|\bamber\b|#c98b3c\b/.test(positiveNormalized)) {
    primary = '#c98b3c';
    push('ambar');
  }
  if (/\boff[-\s]?white\b|\bquase branco\b|\bbranco quente\b|\bmarfim\b|\bivory\b|\bamarelo alaranjado\b|\bamarelo\b|\blaranja\b/.test(positiveNormalized)) {
    background = background || '#fcf7e3';
    surface = surface || '#fffaf0';
    push('offwhite');
  }
  if (/\bverde profundo\b|\bdeep green\b/.test(positiveNormalized)) {
    primary = '#1f5a3d';
    push('verde');
  } else if (/\bverde\b|\bgreen\b/.test(positiveNormalized)) {
    primary = primary || '#2f8f7f';
    push('verde');
  }
  const darkMentionIsNegated = /\b(ignore|ignorar|ignora|nao usar|não usar|sem|bloquear|suprimir)\b[\s\S]{0,90}\b(tema escuro|escuro|dark)\b|\b(tema escuro|escuro|dark)\b[\s\S]{0,90}\b(anterior|preferencia anterior|preferência anterior|conflitante|suprimid[ao]|bloquead[ao])\b/.test(normalized);
  if (!wantsExplicitLight && !darkMentionIsNegated && /\bpreto\b|\bescuro\b|\bdark\b/.test(positiveNormalized)) {
    background = background || '#111111';
    text = text || '#e8e4df';
    push('escuro');
  }

  if (!primary && domain === 'humpback-whales') primary = '#1f6f9f';
  if (!primary && domain === 'chocolate') primary = '#3b1f14';
  if (!primary && domain === 'gardening') primary = '#2f6b45';
  if (!primary && domain === 'wood-sculpture') primary = '#7a4a2a';
  if (!primary && domain === 'leather-goods') primary = '#8f3447';
  if (!primary && domain === 'greenhouses') primary = '#1f5a3d';
  if (!primary && domain === 'import-services') primary = '#0b1f3a';
  if (!primary && domain === 'architecture') primary = '#2f2f2d';
  if (!primary && domain === 'photo-lab') primary = '#c98b3c';
  if (!primary && domain === 'saas-tool') primary = '#2563eb';
  if (!primary && domain === 'editorial-content') primary = '#7c3aed';
  if (!primary && domain === 'intellectual-property') primary = '#183b73';
  if (!primary && domain === 'sustainable-product-landing') primary = '#4d9f8f';
  if (!primary && domain === 'technical-b2b-services-site') primary = '#1e6f9f';
  if (!primary && domain === 'premium-wine-landing') primary = '#7a1830';
  if (!primary && domain === 'construction-materials-site') primary = '#e26522';
  if (!primary && domain === 'wood-finishes') primary = '#6f4b2a';
  if (!background && domain === 'chocolate') background = '#f7e7ce';
  if (!surface && domain === 'chocolate') surface = '#fff8f0';
  if (!text && domain === 'chocolate') text = '#1e0f0a';
  if (!background && domain === 'gardening') background = '#f3f5ec';
  if (!surface && domain === 'gardening') surface = '#ffffff';
  if (!background && domain === 'wood-sculpture') background = '#f4ede4';
  if (!surface && domain === 'wood-sculpture') surface = '#fffaf4';
  if (!text && domain === 'wood-sculpture') text = '#1f1712';
  if (!background && domain === 'leather-goods') background = '#fcf7e3';
  if (!surface && domain === 'leather-goods') surface = '#fffaf0';
  if (!background && domain === 'greenhouses') background = '#fcf7e3';
  if (!surface && domain === 'greenhouses') surface = '#fffaf0';
  if (!background && domain === 'architecture') background = '#f7f3ed';
  if (!surface && domain === 'architecture') surface = '#ffffff';
  if (!text && domain === 'architecture') text = '#1e1e1c';
  if (!background && domain === 'photo-lab') background = '#111111';
  if (!surface && domain === 'photo-lab') surface = '#1c1c1c';
  if (!text && domain === 'photo-lab') text = '#f5f1ea';
  if (!background && domain === 'intellectual-property') background = '#f6f8fb';
  if (!surface && domain === 'intellectual-property') surface = '#ffffff';
  if (!text && domain === 'intellectual-property') text = '#172033';
  if (!background && domain === 'sustainable-product-landing') background = '#f7f8f4';
  if (!surface && domain === 'sustainable-product-landing') surface = '#ffffff';
  if (!text && domain === 'sustainable-product-landing') text = '#172420';
  if (!background && domain === 'technical-b2b-services-site') background = '#f7f8f9';
  if (!surface && domain === 'technical-b2b-services-site') surface = '#ffffff';
  if (!text && domain === 'technical-b2b-services-site') text = '#111315';
  if (!background && domain === 'premium-wine-landing') background = '#f7efe3';
  if (!surface && domain === 'premium-wine-landing') surface = '#fff8ef';
  if (!text && domain === 'premium-wine-landing') text = '#24150f';
  if (!background && domain === 'construction-materials-site') background = '#f8fafc';
  if (!surface && domain === 'construction-materials-site') surface = '#ffffff';
  if (!text && domain === 'construction-materials-site') text = '#1e293b';
  if (!background && domain === 'wood-finishes') background = '#f6f1e9';
  if (!surface && domain === 'wood-finishes') surface = '#fffaf3';
  if (!text && domain === 'wood-finishes') text = '#1f1a15';
  if (!background && domain === 'import-services') background = '#f4f7fb';
  if (!surface && domain === 'import-services') surface = '#ffffff';
  if (!text && domain === 'import-services') text = '#162033';
  if (!background && domain === 'saas-tool') background = '#f6f7fb';
  if (!surface && domain === 'saas-tool') surface = '#ffffff';
  if (!text && domain === 'saas-tool') text = '#111827';
  if (!background && domain === 'editorial-content') background = '#faf7ff';
  if (!surface && domain === 'editorial-content') surface = '#ffffff';
  if (!text && domain === 'editorial-content') text = '#231942';
  if (!primary) primary = '#2f8f7f';
  if (!background) background = '#ffffff';
  if (!surface) surface = background;
  if (!text) text = background === '#111111' ? '#e8e4df' : '#212121';

  return {
    requested,
    primary,
    background,
    surface,
    text,
    imageColor: primary,
  };
}

function inferTypography(source = '') {
  const normalized = normalizeBriefText(source);
  const positiveNormalized = stripNegatedIntentClauses(normalized);
  const requested = /\b(fonte|font|tipografia|typography|google fonts?|google|assistant|inter)\b/.test(positiveNormalized);
  let family = requested ? 'Inter' : 'system-ui';
  let headingFamily = '';
  if (/\bassistant\b/.test(positiveNormalized)) headingFamily = 'Assistant';
  if (/\binter\b/.test(positiveNormalized)) family = 'Inter';
  if (/\bmanrope\b/.test(positiveNormalized)) family = 'Manrope';
  if (/\bplayfair(?: display)?\b/.test(positiveNormalized)) family = 'Playfair Display';
  if (/\bcormorant(?: garamond)?\b/.test(positiveNormalized)) family = 'Cormorant Garamond';
  if (/\blibre baskerville\b/.test(positiveNormalized)) family = 'Libre Baskerville';
  if (/\bmontserrat\b/.test(positiveNormalized)) family = 'Montserrat';
  return {
    requested,
    provider: requested ? 'google' : 'system',
    family,
    headingFamily,
  };
}

function inferDomain({ source = '', contract = {}, autonomous = false } = {}) {
  const normalized = normalizeBriefText(source);
  const positiveNormalized = stripNegatedIntentClauses(normalized);
  if (contract && contract.domain) return contract.domain;
  if (contract && contract.domainDecision && (contract.domainDecision.blockDomainFallback || contract.domainDecision.contextSuppressed)) return '';
  if (/\b(propriedade intelectual|propriedade industrial|registro de patentes?|patentes?|marcas? e patentes?|registro de marcas|desenhos? industriais?|modelos? de utilidade|busca de anterioridade|inpi|ativos intelectuais|prote[cç][aã]o internacional|pct)\b/.test(positiveNormalized)) {
    return 'intellectual-property';
  }
  if (/\b(garrafas? de vidro|garrafas? reutilizaveis|garrafas? reutilizáveis|vidro reutilizavel|vidro reutilizável|livre de bpa|sem bpa|sabor puro|plastico descartavel|plástico descartável|vidro premium|capa protetora)\b/.test(positiveNormalized)) {
    return 'sustainable-product-landing';
  }
  if (/\b(esquadrias? de aluminio|esquadrias? de alumínio|fachadas? em acm|pele de vidro|portas? de aluminio|portas? de alumínio|janelas? de aluminio|janelas? de alumínio|guarda[-\s]?corpos?|brises? metalicos|brises? metálicos|portoes? de aluminio|portões? de alumínio|aluminio sob medida|alumínio sob medida|calculadora de orcamento|calculadora de orçamento)\b/.test(positiveNormalized)) {
    return 'technical-b2b-services-site';
  }
  if (/\b(vinhos? artesanais?|vin[ií]cola|vin[ií]cola boutique|kit degusta[cç][aã]o|r[oó]tulos?|terroir|uvas? selecionadas?|colheita manual|en[oó]log[ao]|barricas?|degusta[cç][aã]o|harmoniza[cç][aã]o|vinhos? premium|vinhos? de pequena produ[cç][aã]o|comprar vinho online)\b/.test(positiveNormalized)) {
    return 'premium-wine-landing';
  }
  if (/\b(materiais? de constru[cç][aã]o|loja de materiais|material de obra|cimento|brita|argamassa|blocos?|tijolos?|telhas?|hidr[aá]ulica|el[eé]trica|lista de materiais|entrega programada|retirada na loja|or[cç]amento de obra|or[cç]amento para obra)\b/.test(positiveNormalized)) {
    return 'construction-materials-site';
  }
  if (/\b(saas|software de gest[aã]o|dashboard|painel|workspace operacional|crm|kanban|pipeline|automa[cç][aã]o|relat[oó]rios?|login|gest[aã]o de usu[aá]rios?|permiss[oõ]es por usu[aá]rio|assinatura|planos|demo|onboarding)\b/.test(positiveNormalized)) {
    return 'saas-tool';
  }
  if (/\b(conte[uú]do editorial|revista|magazine|publica[cç][aã]o|portal de conte[uú]do|blog editorial|editorias?|colunas?|mat[eé]rias?|reportagens?|assinantes?)\b/.test(positiveNormalized)) {
    return 'editorial-content';
  }
  if (/\b(escola|educa[cç][aã]o|curso|cursos|forma[cç][aã]o|jornada de aprendizagem|gest[aã]o consciente|lideran[cç]a consciente|premissas|autoconhecimento|consci[eê]ncia ampliada|nova forma de gerir|gestores conscientes)\b/.test(positiveNormalized)) {
    return 'institutional-education';
  }
  if (/\b(linea bosco|revestimentos? naturais?|revestimentos? de madeira|pisos? de madeira|paineis? ripados?|pain[eé]is? ripados?|decks?|madeira natural|acabamentos? arquitet[oô]nicos?|rodap[eé]s?|paginac[oõ]es|chevron|espinha de peixe|carvalho|nogueira|cumaru|freij[oó]|tauari|ip[eê])\b/.test(positiveNormalized)) {
    return 'wood-finishes';
  }
  if (/\bjardinagem\b|\bjardins?\b|\bpaisagismo\b|\bcuidados com plantas\b|\bplantas para apartamento\b|\bplantas internas\b|\bhortas? caseiras?\b|\bjardins? verticais?\b|\bloja de jardinagem\b|\bmanutencao de jardim\b|\bdecoracao natural\b/.test(positiveNormalized)) {
    return 'gardening';
  }
  if (/\besculturas? em madeira\b|\bescultor(?:a)? em madeira\b|\barte em madeira\b|\bmadeira bruta\b|\btalha manual\b|\bentalhe\b|\bveios da madeira\b|\bateli[eê] de escultura\b|\bobras sob encomenda\b/.test(positiveNormalized)) {
    return 'wood-sculpture';
  }
  if (/\bestufas?\b|\bgreenhouses?\b|\bcultivo protegido\b|\bviveiros?\b|\bhortas? comerciais?\b|\bfloriculturas?\b|\bprodutor rural\b|\bagricultor(?:es)?\b|\bagricultura\b|\bhortalicas?\b|\bmudas?\b|\birrigacao\b|\bcontrole climatico\b/.test(positiveNormalized)) {
    return 'greenhouses';
  }
  if (/\b(chocolates?|cacau|cacao|bombons?|chocolateria|tabletes?|trufas?|ganache|temperagem|bean to bar)\b/.test(positiveNormalized)) {
    return 'chocolate';
  }
  if (/\bcouro\b|\bcouros\b|\bartefatos? de couro\b|\bmarroquinaria\b|\bbolsas?\b|\bpastas?\b|\bcarteiras?\b/.test(positiveNormalized)) {
    return 'leather-goods';
  }
  if (/\baquario\b|\baquarium\b|\bpinguim\b|\bpinguins\b|\bpeixes\b/.test(positiveNormalized)) return 'aquarium';
  if (/\bimoveis\b|\bimobiliaria\b|\bcorretor\b|\breal estate\b/.test(positiveNormalized)) return 'real-estate';
  if (autonomous) return 'general-institutional-site';
  return '';
}

function inferSafety(source = '') {
  const normalized = normalizeBriefText(source);
  const harmful = /\b(phishing|roubar senha|malware|ransomware|invadir|hackear conta|exploit para roubar|fraude bancaria)\b/.test(
    normalized
  );
  if (harmful) {
    return {
      policy: 'block',
      reasons: ['possible_harmful_development'],
      forceReviewAllowed: true,
    };
  }
  return {
    policy: 'allow',
    reasons: [],
    forceReviewAllowed: false,
  };
}

function inferAction({ source = '', project = {}, autonomous = false, attachments = [], intake = null } = {}) {
  if (project.hasApplicationFiles && hasNewAreaSignal(source)) return 'new_project_area';
  if (intake && intake.canonical && intake.canonical.action && intake.canonical.action !== 'conversation') {
    return intake.canonical.action;
  }
  if (!source || /^\s*(oi|ola|olá|hello|hi|bom dia|boa tarde|boa noite)\s*[.!?]*\s*$/i.test(source)) return 'chat';
  const explicitCreate = hasExplicitCreateSignal(source);
  const projectWithoutAppSurfaceCreate = explicitCreate && !project.hasApplicationFiles;
  if (projectWithoutAppSurfaceCreate) return 'create_project';
  if (hasVisualReviewSignal(source, attachments) && !projectWithoutAppSurfaceCreate) return 'visual_review';
  if (hasToolSignal(source)) return 'tool_action';
  if (hasDiagnosticSignal(source)) return 'diagnostic_repair';
  if (hasDesignReferenceSignal(source, attachments)) return project.hasAnyFiles ? 'edit_project' : 'create_project';
  if (project.hasApplicationFiles || (project.hasAnyFiles && !/\bdo zero|recriar|recomecar|reiniciar\b/.test(normalizeBriefText(source)))) {
    return explicitCreate && hasNewAreaSignal(source) ? 'new_project_area' : 'edit_project';
  }
  if (explicitCreate || autonomous) return 'create_project';
  if (hasEditSignal(source)) return 'edit_project';
  return 'chat';
}

function inferAutonomy(source = '') {
  if (hasAutonomousPlaceholderSignal(source)) return 'high';
  const normalized = normalizeBriefText(source);
  if (/\b(como exatamente|qual|quais|me pergunte|antes de gerar)\b/.test(normalized)) return 'low';
  return 'medium';
}

function buildMediaIntent({ source = '', domain = '', palette = {}, projectKind = '', temporaryBlueprintContract = null } = {}) {
  if (isActiveTemporaryBlueprintContract(temporaryBlueprintContract)) {
    return [
      {
        slot: 'hero',
        provider: 'pexels',
        mediaType: /\b(video|motion|animado)\b/.test(normalizeBriefText(source)) ? 'video' : 'photo',
        query: temporaryBlueprintContract.mediaQuery || 'professional editorial website',
        orientation: 'landscape',
        color: palette.imageColor || palette.primary || '',
        purpose: 'temporary_contract_contextual_media',
      },
    ];
  }
  const profile = DOMAIN_OVERRIDES[domain] || {};
  const query = profile.mediaQuery || (projectKind === 'application' ? 'software team workspace' : 'professional workspace');
  return [
    {
      slot: 'hero',
      provider: 'pexels',
      mediaType: /\b(video|motion|animado)\b/.test(normalizeBriefText(source)) ? 'video' : 'photo',
      query,
      orientation: 'landscape',
      color: palette.imageColor || palette.primary || '',
      purpose: 'contextual_placeholder',
    },
  ];
}

function buildIconIntent(domain = '', temporaryBlueprintContract = null) {
  if (isActiveTemporaryBlueprintContract(temporaryBlueprintContract)) {
    return (temporaryBlueprintContract.iconIntents || ['sparkles', 'layout-template', 'check-circle']).map((name) => ({
      provider: 'lucide',
      semanticName: name,
      purpose: 'temporary_contract_section_marker',
    }));
  }
  const profile = DOMAIN_OVERRIDES[domain] || {};
  return (profile.iconIntents || ['sparkles', 'layout-template', 'check-circle']).map((name) => ({
    provider: 'lucide',
    semanticName: name,
    purpose: 'section_or_service_marker',
  }));
}

function buildExecutionPrompt({ action = '', source = '', contract = {}, domain = '', palette = {}, typography = {}, autonomous = false } = {}) {
  const cleanSource = String(source || '').trim();
  if (action !== 'create_project') return cleanSource;

  const stack = contract && contract.stack ? contract.stack : DEFAULT_SITE_STACK;
  const profile = DOMAIN_OVERRIDES[domain] || {};
  const domainText = profile.label || (contract && contract.domainLabel) || 'modular';
  const colorText = palette.requested && palette.requested.length
    ? `paleta ${palette.requested.join(' e ')}`
    : `paleta baseada em ${palette.primary}`;
  const typographyText = typography && typography.requested
    ? `tipografia Google ${typography.family}`
    : 'tipografia profissional';

  if (autonomous && domain === 'general-institutional-site') {
    return [
      'Criar um site institucional genérico com placeholders neutros e editáveis.',
      stack ? `Stack sugerida: ${stack}.` : '',
      `${colorText}; ${typographyText}.`,
      'Usar imagem Pexels institucional e editorial, orientação landscape e tons alinhados à cor principal.',
      'Usar ícones coerentes com navegação, confiança e clareza.',
      'Gerar uma primeira versão útil sem novas perguntas.',
    ].filter(Boolean).join(' ');
  }

  return cleanSource || [
    `Criar site ${domainText} com composição de header, hero, seções e footer.`,
    stack ? `Stack: ${stack}.` : '',
    `${colorText}; ${typographyText}.`,
    'Usar placeholders, mídia Pexels contextual e ícones coerentes quando houver ambiguidade.',
  ].filter(Boolean).join(' ');
}

function buildMissingSlots({ action = '', contract = {}, domain = '', autonomy = '' } = {}) {
  if (action !== 'create_project') return [];
  const slots = [];
  if (!domain && autonomy !== 'high') slots.push('domain_or_allow_default');
  return slots;
}

function buildWorkingBrief({
  userMessage = '',
  contextText = '',
  workGraph = null,
  projectInfo = null,
  attachments = [],
  conversationMessages = [],
  activeMemory = null,
} = {}) {
  const activeMemoryContext =
    activeMemory && activeMemory.decision && activeMemory.decision.briefingContextText
      ? String(activeMemory.decision.briefingContextText)
      : '';
  const mergedContextText = [
    contextText,
    activeMemoryContext && !String(contextText || '').includes(activeMemoryContext.slice(0, 120))
      ? activeMemoryContext
      : '',
  ].filter(Boolean).join('\n\n');
  const source = buildSourceText({ userMessage, contextText: mergedContextText, workGraph, conversationMessages });
  const directSource = String(userMessage || '').trim();
  const normalizedSource = normalizeBriefText(source);
  const memoryContinuation =
    isWorkingBriefMemoryContinuation(directSource, activeMemory) ||
    isWorkingBriefConversationContinuation(directSource, conversationMessages, projectInfo);
  const primarySource = memoryContinuation ? source : (directSource || source);
  const normalizedPrimarySource = normalizeBriefText(primarySource);
  const actionSource = primarySource;
  const autonomy = inferAutonomy(primarySource);
  const autonomous = autonomy === 'high';
  const contract = inferBriefingContract({
    userMessage: directSource || source,
    contextText: mergedContextText,
    workGraph,
  });
  const briefingSpec = buildBriefingSpec({
    userMessage: directSource || source,
    contextText: mergedContextText,
    workGraph,
    conversationMessages,
    activeMemory,
    contract,
  });
  const temporaryBlueprintContract = briefingSpec.temporaryBlueprintContract || null;
  const temporaryBlueprintActive = isActiveTemporaryBlueprintContract(temporaryBlueprintContract);
  const project = inferProjectState(projectInfo);
  const productIntake = buildProductIntake({ userMessage: actionSource, projectInfo });
  const effectivePrimarySource = briefingSpec && briefingSpec.generationSource
    ? briefingSpec.generationSource
    : primarySource;
  const effectiveNormalizedPrimarySource = normalizeBriefText(effectivePrimarySource);
  const domain = temporaryBlueprintActive
    ? temporaryBlueprintContract.domain
    : inferDomain({ source: effectivePrimarySource, contract, autonomous });
  const domainProfile = DOMAIN_OVERRIDES[domain] || {};
  const projectKind = inferProjectKind(effectivePrimarySource) || (autonomous ? 'institutional-site' : '');
  const palette = inferColorPalette(effectivePrimarySource, domain);
  const typography = inferTypography(effectivePrimarySource);
  const action = inferAction({ source: actionSource, project, autonomous, attachments, intake: productIntake });
  const safety = inferSafety(primarySource);
  const missingSlots = buildMissingSlots({ action, contract, domain, autonomy });
  if (briefingSpec.contractEscalation && briefingSpec.contractEscalation.required && briefingSpec.contractEscalation.blocking) {
    missingSlots.push('blueprint_contract_required');
  }
  const contentMode = autonomous
    ? 'ai_placeholder'
    : briefingSpec.content && briefingSpec.content.placeholderAllowed
      ? 'placeholder'
      : briefingSpec.content && briefingSpec.content.finalRequested
        ? 'user_final'
        : /\bplaceholder/.test(effectiveNormalizedPrimarySource)
          ? 'placeholder'
          : 'user_guided';
  const executionPrompt = buildExecutionPrompt({
    action,
    source: effectivePrimarySource,
    contract: temporaryBlueprintActive
      ? { ...contract, stack: temporaryBlueprintContract.stack, domainLabel: temporaryBlueprintContract.domainLabel || temporaryBlueprintContract.label }
      : contract,
    domain,
    palette,
    typography,
    autonomous,
  });
  const briefingSpecGuidance = formatBriefingSpecForPrompt(briefingSpec);
  const finalExecutionPrompt = action === 'create_project'
    ? [executionPrompt, briefingSpecGuidance].filter(Boolean).join('\n\n')
    : executionPrompt;

  return {
    schemaVersion: WORKING_BRIEF_SCHEMA_VERSION,
    source: {
      current: directSource,
      consolidated: compactText(effectivePrimarySource || source, 2200),
      normalized: compactText(effectiveNormalizedPrimarySource || normalizedSource, 2200),
      memoryContextSuppressed: Boolean(briefingSpec.contextPolicy && briefingSpec.contextPolicy.staleContextSuppressed),
    },
    project,
    intent: {
      action,
      scope: hasNewAreaSignal(source) ? 'new_area' : project.hasApplicationFiles ? 'existing_project' : 'project_root',
      contentMode,
      autonomy,
      confidence: safety.policy === 'block' ? 0.98 : autonomous || contract.stack || domain ? 0.86 : 0.68,
      intake: {
        action: productIntake.canonical.action,
        executionIntent: productIntake.canonical.executionIntent,
        createScore: productIntake.scores.create,
        editScore: productIntake.scores.edit,
      },
      askBeforePlanning: missingSlots.length > 0 && autonomy !== 'high',
      missingSlots,
    },
    product: {
      domain,
      domainLabel: temporaryBlueprintActive
        ? temporaryBlueprintContract.domainLabel || temporaryBlueprintContract.label || ''
        : domainProfile.label || contract.domainLabel || '',
      stack: temporaryBlueprintActive
        ? temporaryBlueprintContract.stack || DEFAULT_SITE_STACK
        : contract.stack || (action === 'create_project' ? DEFAULT_SITE_STACK : ''),
      projectKind,
      brandFallback:
        briefingSpec.current && briefingSpec.current.brand
          ? briefingSpec.current.brand
          : temporaryBlueprintActive
            ? temporaryBlueprintContract.brandFallback || temporaryBlueprintContract.label || 'Faber Projeto'
            : domainProfile.brandFallback || contract.brandFallback || 'Faber Projeto',
      defaultedDomain: autonomous && domain === 'general-institutional-site',
    },
    style: {
      palette,
      typography,
    },
    mediaIntent: buildMediaIntent({ source: primarySource, domain, palette, projectKind, temporaryBlueprintContract }),
    iconIntent: buildIconIntent(domain, temporaryBlueprintContract),
    safety,
    executionPrompt: finalExecutionPrompt,
    briefingSpec,
    temporaryBlueprintContract,
    contractEscalation: briefingSpec.contractEscalation || null,
    memory: summarizeWorkingBriefMemory(activeMemory),
    assumptions: [
      autonomous ? 'Usuário autorizou autonomia/placeholder; seguir sem novas perguntas.' : '',
      autonomous && domain === 'general-institutional-site' ? 'Sem domínio definido; aplicar fallback institucional neutro.' : '',
      project.hasApplicationFiles ? 'Projeto possui arquivos de aplicação; tratar como edição incremental.' : '',
      memoryContinuation ? 'Mensagem atual referencia memoria/contexto; usar memoria ativa sem perder prioridade do pedido atual.' : '',
      briefingSpec.contextPolicy && briefingSpec.contextPolicy.staleContextSuppressed
        ? 'Briefing atual é autocontido; memória antiga não pode fornecer conteúdo final.'
        : '',
      briefingSpec.contractEscalation && briefingSpec.contractEscalation.required && briefingSpec.contractEscalation.blocking
        ? 'Briefing final exige suggest_blueprint antes de gerar arquivos.'
        : '',
      briefingSpec.contractEscalation && briefingSpec.contractEscalation.code && !briefingSpec.contractEscalation.required
        ? `Aviso de premissa registrado: ${briefingSpec.contractEscalation.code}; seguir sem contrato obrigatorio.`
        : '',
      temporaryBlueprintActive
        ? 'Briefing final sem contrato permanente foi convertido em contrato temporario de blueprint a partir da mensagem atual.'
        : '',
    ].filter(Boolean),
  };
}

function createWorkingBriefService() {
  return {
    buildWorkingBrief,
  };
}

module.exports = {
  WORKING_BRIEF_SCHEMA_VERSION,
  buildWorkingBrief,
  createWorkingBriefService,
  hasAutonomousPlaceholderSignal,
  hasVisualReviewSignal,
};
