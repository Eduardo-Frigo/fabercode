const {
  hasAnyScannedFiles,
  hasApplicationSurfaceFiles,
  normalizeIntentText,
} = require('./execution_intent');
const { inferBriefingContract } = require('./briefing_contract_service');

const WORKING_BRIEF_SCHEMA_VERSION = 'working-brief-v1';
const DEFAULT_SITE_STACK = 'next-tailwind';

const DOMAIN_OVERRIDES = {
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
  photography: {
    id: 'photography',
    label: 'fotografia',
    brandFallback: 'Estúdio Aurora',
    mediaQuery: 'photography studio portrait',
    iconIntents: ['camera', 'image', 'sparkles'],
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

function hasAutonomousPlaceholderSignal(source = '') {
  const normalized = normalizeBriefText(source);
  if (!normalized) return false;
  return /\b(qualquer coisa|faz qualquer|faca qualquer|voce decide|pode decidir|pode sugerir|sugira|placeholders?|placeholder|generico|generica|sem perguntar|sem travar|depois ajusto|so quero ver|quero visualizar|teste rapido)\b/.test(
    normalized
  );
}

function hasExplicitCreateSignal(source = '') {
  const normalized = normalizeBriefText(source);
  return /\b(crie|criar|gere|gerar|monte|montar|construa|construir|desenvolva|desenvolver|faca|fazer|novo projeto|nova pagina|nova area|landing|site|app|aplicacao|sistema)\b/.test(
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

function hasToolSignal(source = '') {
  const normalized = normalizeBriefText(source);
  return /\b(terminal|git|commit|push|deploy|executar comando|rodar comando|preview|npm install|npm run)\b/.test(
    normalized
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
  const requested = [];
  let primary = '';
  let background = '';
  let surface = '';
  let text = '';

  const push = (name) => {
    if (!requested.includes(name)) requested.push(name);
  };

  if (/\bazul\b|\bblue\b/.test(normalized)) {
    primary = '#3240a8';
    push('azul');
  }
  if (/\bbranco\b|\bwhite\b/.test(normalized)) {
    background = '#ffffff';
    surface = '#ffffff';
    text = '#212121';
    push('branco');
  }
  if (/\bvermelh|coral|#cf416b\b/.test(normalized)) {
    primary = '#cf416b';
    push('vermelho');
  }
  if (/\bmarsala\b|\bvinho\b|\bbordo\b|\bbordô\b/.test(normalized)) {
    primary = '#8f3447';
    push('marsala');
  }
  if (/\boff[-\s]?white\b|\bquase branco\b|\bbranco quente\b|\bmarfim\b|\bivory\b|\bamarelo alaranjado\b|\bamarelo\b|\blaranja\b/.test(normalized)) {
    background = '#fcf7e3';
    surface = '#fffaf0';
    push('offwhite');
  }
  if (/\bverde profundo\b|\bdeep green\b/.test(normalized)) {
    primary = '#1f5a3d';
    push('verde');
  } else if (/\bverde\b|\bgreen\b/.test(normalized)) {
    primary = primary || '#2f8f7f';
    push('verde');
  }
  if (/\bpreto\b|\bescuro\b|\bdark\b/.test(normalized)) {
    background = background || '#111111';
    text = text || '#e8e4df';
    push('escuro');
  }

  if (!primary && domain === 'humpback-whales') primary = '#1f6f9f';
  if (!primary && domain === 'leather-goods') primary = '#8f3447';
  if (!primary && domain === 'greenhouses') primary = '#1f5a3d';
  if (!background && domain === 'leather-goods') background = '#fcf7e3';
  if (!surface && domain === 'leather-goods') surface = '#fffaf0';
  if (!background && domain === 'greenhouses') background = '#fcf7e3';
  if (!surface && domain === 'greenhouses') surface = '#fffaf0';
  if (!primary) primary = '#2f8f7f';
  if (!background) background = '#ffffff';
  if (!surface) surface = background;
  if (!text) text = background === '#ffffff' ? '#212121' : '#e8e4df';

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
  const requested = /\b(fonte|font|tipografia|typography|google fonts?|google)\b/.test(normalized);
  let family = requested ? 'Inter' : 'system-ui';
  if (/\bmanrope\b/.test(normalized)) family = 'Manrope';
  return {
    requested,
    provider: requested ? 'google' : 'system',
    family,
  };
}

function inferDomain({ source = '', contract = {}, autonomous = false } = {}) {
  const normalized = normalizeBriefText(source);
  if (contract && contract.domain) return contract.domain;
  if (/\bestufas?\b|\bgreenhouses?\b|\bcultivo protegido\b|\bviveiros?\b|\bhortas? comerciais?\b|\bfloriculturas?\b|\bprodutor rural\b|\bagricultor(?:es)?\b|\bagricultura\b|\bhortalicas?\b|\bmudas?\b|\birrigacao\b|\bcontrole climatico\b/.test(normalized)) {
    return 'greenhouses';
  }
  if (/\bcouro\b|\bcouros\b|\bartefatos? de couro\b|\bmarroquinaria\b|\bbolsas?\b|\bpastas?\b|\bcarteiras?\b|\bartesanal\b|\bfeito a mao\b/.test(normalized)) {
    return 'leather-goods';
  }
  if (/\baquario\b|\baquarium\b|\bpinguim\b|\bpinguins\b|\bpeixes\b/.test(normalized)) return 'aquarium';
  if (/\bimoveis\b|\bimobiliaria\b|\bcorretor\b|\breal estate\b/.test(normalized)) return 'real-estate';
  if (autonomous) return 'humpback-whales';
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

function inferAction({ source = '', project = {}, autonomous = false, attachments = [] } = {}) {
  if (!source || /^\s*(oi|ola|olá|hello|hi|bom dia|boa tarde|boa noite)\s*[.!?]*\s*$/i.test(source)) return 'chat';
  if (hasToolSignal(source)) return 'tool_action';
  if (hasDiagnosticSignal(source)) return 'diagnostic_repair';
  if (hasDesignReferenceSignal(source, attachments)) return project.hasAnyFiles ? 'edit_project' : 'create_project';
  if (project.hasApplicationFiles && hasNewAreaSignal(source)) return 'new_project_area';
  if (project.hasApplicationFiles || (project.hasAnyFiles && !/\bdo zero|recriar|recomecar|reiniciar\b/.test(normalizeBriefText(source)))) {
    return hasExplicitCreateSignal(source) && hasNewAreaSignal(source) ? 'new_project_area' : 'edit_project';
  }
  if (hasExplicitCreateSignal(source) || autonomous) return 'create_project';
  if (hasEditSignal(source)) return 'edit_project';
  return 'chat';
}

function inferAutonomy(source = '') {
  if (hasAutonomousPlaceholderSignal(source)) return 'high';
  const normalized = normalizeBriefText(source);
  if (/\b(como exatamente|qual|quais|me pergunte|antes de gerar)\b/.test(normalized)) return 'low';
  return 'medium';
}

function buildMediaIntent({ source = '', domain = '', palette = {}, projectKind = '' } = {}) {
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

function buildIconIntent(domain = '') {
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

  if (autonomous && domain === 'humpback-whales') {
    return [
      'Criar um site institucional com placeholders sobre baleias jubarte.',
      stack ? `Stack sugerida: ${stack}.` : '',
      `${colorText}; ${typographyText}.`,
      'Usar imagem Pexels coerente com oceano, baleias jubarte, orientação landscape e tons alinhados à cor principal.',
      'Usar ícones coerentes com natureza, navegação e descoberta.',
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
} = {}) {
  const source = buildSourceText({ userMessage, contextText, workGraph, conversationMessages });
  const directSource = String(userMessage || '').trim();
  const normalizedSource = normalizeBriefText(source);
  const autonomy = inferAutonomy(source);
  const autonomous = autonomy === 'high';
  const contract = inferBriefingContract({
    userMessage: directSource || source,
    contextText,
    workGraph,
  });
  const project = inferProjectState(projectInfo);
  const domain = inferDomain({ source, contract, autonomous });
  const domainProfile = DOMAIN_OVERRIDES[domain] || {};
  const projectKind = inferProjectKind(source) || (autonomous ? 'institutional-site' : '');
  const palette = inferColorPalette(source, domain);
  const typography = inferTypography(source);
  const action = inferAction({ source: directSource || source, project, autonomous, attachments });
  const safety = inferSafety(source);
  const missingSlots = buildMissingSlots({ action, contract, domain, autonomy });
  const contentMode = autonomous ? 'ai_placeholder' : /\bplaceholder/.test(normalizedSource) ? 'placeholder' : 'user_guided';
  const executionPrompt = buildExecutionPrompt({
    action,
    source: directSource || source,
    contract,
    domain,
    palette,
    typography,
    autonomous,
  });

  return {
    schemaVersion: WORKING_BRIEF_SCHEMA_VERSION,
    source: {
      current: directSource,
      consolidated: compactText(source, 1600),
      normalized: compactText(normalizedSource, 1600),
    },
    project,
    intent: {
      action,
      scope: hasNewAreaSignal(source) ? 'new_area' : project.hasApplicationFiles ? 'existing_project' : 'project_root',
      contentMode,
      autonomy,
      confidence: safety.policy === 'block' ? 0.98 : autonomous || contract.stack || domain ? 0.86 : 0.68,
      askBeforePlanning: missingSlots.length > 0 && autonomy !== 'high',
      missingSlots,
    },
    product: {
      domain,
      domainLabel: domainProfile.label || contract.domainLabel || '',
      stack: contract.stack || (action === 'create_project' ? DEFAULT_SITE_STACK : ''),
      projectKind,
      brandFallback: domainProfile.brandFallback || contract.brandFallback || 'Faber Projeto',
      defaultedDomain: autonomous && domain === 'humpback-whales',
    },
    style: {
      palette,
      typography,
    },
    mediaIntent: buildMediaIntent({ source, domain, palette, projectKind }),
    iconIntent: buildIconIntent(domain),
    safety,
    executionPrompt,
    assumptions: [
      autonomous ? 'Usuário autorizou autonomia/placeholder; seguir sem novas perguntas.' : '',
      autonomous && domain === 'humpback-whales' ? 'Sem domínio definido; aplicar fallback do produto para baleias jubarte.' : '',
      project.hasApplicationFiles ? 'Projeto possui arquivos de aplicação; tratar como edição incremental.' : '',
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
};
