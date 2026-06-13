const {
  hasAnyScannedFiles,
  hasApplicationSurfaceFiles,
  isAffirmativeContinuation,
  normalizeIntentText,
} = require('./execution_intent');

const PRODUCT_INTAKE_SCHEMA_VERSION = 'product-intake-v1';

const CREATE_VERBS = [
  'crie', 'criar', 'criaria', 'cria',
  'recrie', 'recriar',
  'gere', 'gera', 'gerar',
  'monte', 'monta', 'montar',
  'construa', 'construir',
  'implemente', 'implementar',
  'desenvolva', 'desenvolver',
  'configure', 'configurar',
  'faca', 'faz', 'fazer',
  'refaca', 'refazer',
  'produza', 'produzir',
];

const REQUEST_PHRASES = [
  'quero', 'queria', 'preciso', 'gostaria', 'poderia',
  'pode fazer', 'pode criar', 'pode gerar', 'pode montar',
  'me ajuda', 'me ajude', 'vamos fazer', 'vamos criar',
  'bora criar', 'bora fazer',
];

const CREATE_SURFACES = [
  'site', 'website', 'landing', 'landing page', 'pagina', 'paginas',
  'page', 'home', 'hero', 'frontend', 'web', 'app', 'aplicacao',
  'sistema', 'projeto', 'ferramenta', 'calculadora', 'conversor',
  'dashboard', 'crm', 'portal', 'componente', 'formulario',
  'fluxo', 'editor visual', 'canvas', 'app de dados', 'explorador de dados',
  'csv', 'api', 'preset', 'mcp', 'capability',
];

const STACK_TERMS = [
  'next', 'nextjs', 'next.js', 'react', 'tailwind', 'html', 'css',
  'lamp', 'php', 'astro', 'vue', 'svelte', 'node', 'express',
  'electron',
];

const EDIT_TERMS = [
  'altere', 'alterar', 'edite', 'editar', 'corrija', 'corrigir',
  'repare', 'reparar', 'conserte', 'consertar', 'resolva', 'resolver',
  'ajuste', 'ajustar', 'mude', 'mudar', 'troque', 'trocar',
  'insira', 'inserir', 'adicione', 'adicionar', 'remova', 'remover',
  'refatore', 'refatorar', 'atualize', 'atualizar', 'deixe', 'deixar',
  'coloque', 'colocar', 'substitua', 'substituir', 'melhore', 'melhorar',
];

const SEARCH_TERMS = ['encontre', 'encontrar', 'ache', 'achar', 'localize', 'localizar', 'procure', 'procurar', 'buscar', 'busque'];
const DIAGNOSTIC_TERMS = [
  'erro', 'bug', 'falha', 'runtime', 'typeerror', 'cannot read', 'does not exist',
  'quebrou', 'diagnostico', 'diagnosticar', 'debug', 'depurar', 'nao funciona', 'preview nao abre',
];
const TOOL_TERMS = ['terminal', 'git', 'commit', 'branch', 'npm run', 'rodar comando', 'executar comando', 'bash'];
const VISUAL_REVIEW_TERMS = [
  'screenshot', 'screenshots', 'print', 'prints', 'captura', 'capturas',
  'validar visualmente', 'validacao visual', 'validar screenshots',
  'validar prints', 'smoke visual', 'comparar com briefing', 'aderencia visual',
];

const COMPLEX_APP_TERMS = [
  'saas', 'crm', 'erp', 'mrp', 'dashboard', 'painel admin', 'admin',
  'login', 'auth', 'autenticacao', 'autenticação', 'permissao', 'permissoes',
  'permissão', 'permissões', 'multiusuario', 'multiusuario',
  'banco de dados', 'database', 'postgres', 'postgresql', 'supabase',
  'prisma', 'orm', 'api', 'backend', 'crud', 'workflow',
  'pipeline',
  'editor visual', 'canvas', 'camadas', 'inspetor de propriedades',
  'arrastar e soltar', 'drag and drop', 'undo', 'redo', 'exportacao json',
  'exportação json', 'app de dados', 'explorador de dados', 'csv',
  'busca textual', 'ordenacao', 'ordenação', 'metricas agregadas',
  'métricas agregadas', 'grafico', 'gráfico',
  'maquina de estados', 'máquina de estados', 'fsm', 'estado finito',
  'regras de negocio', 'regras de negócio', 'dominio', 'domínio',
  'audit log', 'auditoria', 'rastreabilidade', 'ledger',
  'estoque', 'inventory', 'inventario', 'inventário',
  'boms', 'bill of materials', 'ordem de producao',
  'ordem de produção', 'ordens de producao', 'ordens de produção',
  'calculo', 'cálculo', 'necessidades', 'deterministico', 'determinístico',
];

const COMPLEX_BRIEF_TERMS = [
  'escopo', 'mvp', 'funcionalidades', 'modulos', 'módulos',
  'regras', 'validacoes', 'validações', 'modelo de dados',
  'entidades', 'schema', 'telas', 'rotas', 'fluxos',
  'criterios de aceite', 'critérios de aceite', 'testes',
  'unitarios', 'unitários', 'persistencia', 'persistência',
  'cadastro', 'cadastrar', 'campos', 'listar', 'lista', 'filtrar',
  'filtros', 'resumo', 'editar', 'remover', 'localmente',
  'estado local', 'estado vazio', 'propriedades',
  'exportacao', 'exportação', 'arquitetura', 'servicos', 'services', 'dominio', 'domínio',
];

function normalizeIntakeText(value = '') {
  return normalizeIntentText(value)
    .replace(/\bnext\s+js\b/g, 'nextjs')
    .replace(/\bnext-js\b/g, 'nextjs')
    .replace(/\breac[t]*\s+tailwind\b/g, 'react tailwind')
    .replace(/\bemultiplas\b/g, 'multiplas')
    .replace(/\bepaginas\b/g, 'paginas')
    .replace(/\bemulti\b/g, 'multi')
    .replace(/[“”"']/g, ' ')
    .replace(/[_/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWord(text = '', word = '') {
  const safe = String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${safe}(?=\\s|$)`, 'i').test(text);
}

function hasAnyPhrase(text = '', phrases = []) {
  return phrases.some((phrase) => {
    const normalized = normalizeIntakeText(phrase);
    return normalized.includes(' ') ? text.includes(normalized) : hasWord(text, normalized);
  });
}

function stripNegatedRoutingClauses(text = '') {
  if (!text) return '';
  return String(text)
    .replace(
      /\bnao\s+(?:quero\s+que\s+)?(?:crie|criar|recrie|recriar|refaca|refazer|gere|gerar|monte|montar|construa|construir|implemente|implementar|desenvolva|desenvolver|configure|configurar|faca|fazer|altere|alterar|mude|mudar|reorganize|reorganizar|mexa|mexer|toque|tocar)\b[^,.!?;]*/g,
      ' '
    )
    .replace(
      /\bsem\s+(?:criar|recriar|refazer|gerar|montar|construir|implementar|desenvolver|configurar|alterar|mudar|reorganizar|mexer|tocar)\b[^,.!?;]*/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function countPhraseHits(text = '', phrases = []) {
  return phrases.reduce((count, phrase) => count + (hasAnyPhrase(text, [phrase]) ? 1 : 0), 0);
}

function inferProjectState(projectInfo = null) {
  const hasProject = Boolean(projectInfo && projectInfo.rootPath);
  const hasApplicationFiles = hasApplicationSurfaceFiles(projectInfo || {});
  const hasAnyFiles = hasAnyScannedFiles(projectInfo || {});
  const projectState = !hasProject
    ? 'missing_project'
    : hasApplicationFiles
      ? 'existing_project'
      : hasAnyFiles
        ? 'metadata_only_project'
        : 'empty_project';
  return {
    hasProject,
    hasApplicationFiles,
    hasAnyFiles,
    projectState,
  };
}

function isSmallTalk(text = '') {
  if (!text) return true;
  if (text.length <= 3 && /^(oi|ola|hey|hi)$/.test(text)) return true;
  return /^(oi|ola|bom dia|boa tarde|boa noite|hello|hi|e ai|tudo bem)[.!? ]*$/.test(text);
}

function hasSelfContainedBrief(text = '') {
  if (!text || text.length < 220) return false;
  const hasSurface = hasAnyPhrase(text, CREATE_SURFACES) || hasAnyPhrase(text, STACK_TERMS);
  const hasBriefParts = /\b(hero|header|footer|rodape|secao|secoes|paleta|tipografia|video|imagem|contato|cta|botao|formulario|rota|menu|mobile|responsivo|premissas|jornada)\b/.test(text);
  return Boolean(hasSurface && hasBriefParts);
}

function hasComplexApplicationSignal(text = '') {
  if (!text) return false;
  const complexHits = countPhraseHits(text, COMPLEX_APP_TERMS);
  const appSurface = hasAnyPhrase(text, CREATE_SURFACES) || /\b(sistema|aplicacao|aplicação|ferramenta|produto|plataforma)\b/.test(text);
  const stackSignal = hasAnyPhrase(text, STACK_TERMS);
  const createSignal = hasAnyPhrase(text, CREATE_VERBS) || hasAnyPhrase(text, REQUEST_PHRASES);
  const strongComplexTerm = /\b(mrp|erp|crm|saas|auth|backend|banco de dados|database|estoque|inventory|ordens? de producao|ordens? de produção|maquina de estados|máquina de estados|fsm|editor visual|canvas|app de dados|explorador de dados|csv)\b/.test(text);
  const bomDomainSignal = /\bboms?\b/.test(text) &&
    /\b(mrp|manufatura|manufacturing|estoque|inventory|ordens? de producao|ordens? de produção|bill of materials)\b/.test(text);
  return Boolean((strongComplexTerm || bomDomainSignal) && (appSurface || stackSignal || createSignal)) ||
    Boolean(appSurface && complexHits >= 1) ||
    complexHits >= 2;
}

function hasComplexBriefSignal(text = '') {
  if (!text) return false;
  const complexHits = countPhraseHits(text, COMPLEX_APP_TERMS);
  const briefHits = countPhraseHits(text, COMPLEX_BRIEF_TERMS);
  const structuredLongBrief = text.length >= 420 && briefHits >= 2;
  return Boolean(structuredLongBrief || (complexHits >= 2 && briefHits >= 2) || (text.length >= 900 && complexHits >= 1));
}

function hasMcpFreedomSignal(text = '') {
  if (!text) return false;
  return /\b(mcp|tools?|capabilit|agente|agentes|use o que for necessario|use o que for necessário|liberdade de acao|liberdade de ação|autonom[iao]|arquitetura livre|sem scaffold|nao use scaffold|não use scaffold)\b/.test(text);
}

function hasPendingBriefingSignal(text = '') {
  if (!text) return false;
  const pendingDelivery = Boolean(
    /\b(vou|irei|pretendo)\b.{0,120}\b(passar|mandar|enviar|colar|compartilhar|trazer)\b.{0,120}\b(briefing|pedido|escopo|requisitos|descricao completa|conteudo completo)\b/.test(text) ||
      /\b(briefing|pedido|escopo|requisitos|descricao completa|conteudo completo)\b.{0,120}\b(na sequencia|em seguida|depois|logo depois|ja ja)\b/.test(text) ||
      /\b(vou passar|vou mandar|vou enviar|passarei|mandarei|enviarei)\b.{0,100}\b(na sequencia|em seguida|depois|logo depois|ja ja)\b/.test(text)
  );
  const alreadyContainsBrief = Boolean(
    /\b(segue|segue o|aqui esta|abaixo|briefing completo\s*[:\-]|briefing\s*:)\b/.test(text) ||
      hasSelfContainedBrief(text)
  );
  return pendingDelivery && !alreadyContainsBrief;
}

function hasPreviewDiagnosticQuestion(text = '') {
  if (!text) return false;
  const previewSurface = /\b(preview|visualizacao|visualizar|build|rodar|executar|execucao|localhost|status 500|http 500|500)\b/.test(text);
  const asksForCorrection = /\b(o que|como|qual|quais)\b/.test(text) &&
    /\b(corrigir|corrijo|ajustar|consertar|resolver|necessario|necessaria|precisa|falta)\b/.test(text);
  const brokenSignal = /\b(nao funciona|nao abre|quebrou|falha|erro|500)\b/.test(text);
  return Boolean(previewSurface && (asksForCorrection || brokenSignal));
}

function hasContinuationCreateSignal(text = '') {
  return /\b(briefing completo|pedido completo|desta conversa|nessa conversa|que passei|que enviei|seguir com isso|use o briefing|usa o briefing|algo novo|novo projeto|nova base|site completo)\b/.test(text);
}

function hasExplicitRebuildSignal(text = '') {
  return /\b(recomecar|reiniciar|resetar|refazer|recriar|do zero|zerar|novo scaffold|nova base)\b/.test(text);
}

function hasVisualCorrectionIntent(text = '') {
  return Boolean(
    hasAnyPhrase(text, EDIT_TERMS) ||
      /\b(correcao|correção|edicao pontual|edição pontual|nao mudou|não mudou|precisa estar|deve estar|deveria estar|precisa ficar|deve ficar|ficar igual|como no anexo|como está no anexo|como esta no anexo|esta limitado|está limitado|limitado)\b/.test(text)
  );
}

function hasExplicitFilePatchIntent(text = '') {
  if (!text) return false;
  const fileOrCodeTarget =
    /\b(app\/page\.tsx|app\/globals\.css|page\.tsx|globals\.css|layout\.tsx|package\.json|arquivo|classe|classes|classname|tailwind|css|jsx|tsx)\b/.test(text);
  const patchAction =
    hasVisualCorrectionIntent(text) ||
    /\b(troque|trocar|altere|alterar|edite|editar|ajuste|ajustar|substitua|substituir|adicione|adicionar)\b/.test(text);
  return Boolean(fileOrCodeTarget && patchAction);
}

function buildProductIntake({
  userMessage = '',
  projectInfo = null,
  contextText = '',
} = {}) {
  const raw = String(userMessage || '').trim();
  const normalized = normalizeIntakeText(raw);
  const context = normalizeIntakeText(contextText || '');
  const routingNormalized = stripNegatedRoutingClauses(normalized);
  const routingContext = stripNegatedRoutingClauses(context);
  const combined = [routingNormalized, routingContext].filter(Boolean).join(' ');
  const project = inferProjectState(projectInfo);
  const canCreateInitialProject = project.projectState === 'empty_project' || project.projectState === 'metadata_only_project';
  const pendingBriefing = hasPendingBriefingSignal(normalized);

  const editVerb =
	    hasVisualCorrectionIntent(routingNormalized) ||
	      /\b(nos arquivos?|no arquivo|dentro do projeto|nesse projeto|na pagina atual|no projeto atual)\b/.test(routingNormalized);
  const currentExplicitRebuild = hasExplicitRebuildSignal(routingNormalized);
  const currentReferencesCreateContinuation = hasContinuationCreateSignal(routingNormalized);
  const currentExplicitCreateConflict = Boolean(
    (hasAnyPhrase(routingNormalized, CREATE_VERBS) || /\b(novo app|novo projeto|novo site|nova base)\b/.test(routingNormalized)) &&
      !/\b(nova area|nova secao|nova seção|nova pagina|nova rota|adicionar pagina|adicionar secao|adicionar seção)\b/.test(routingNormalized)
  );
  const currentDiscussionQuestion = Boolean(
    /\b(o que voce acha|qual sua opiniao|voce acha|deveria|seria melhor|vale a pena|faz sentido)\b/.test(normalized) ||
      /^(como|qual|quais|por que|o que)\b/.test(normalized)
  );
  const currentEditOverridesContextScaffold = Boolean(
    !pendingBriefing &&
      project.hasApplicationFiles &&
      editVerb &&
      !currentExplicitRebuild &&
      !currentReferencesCreateContinuation &&
      !currentExplicitCreateConflict &&
      !currentDiscussionQuestion
  );
  const intentSource = pendingBriefing ? normalized : currentEditOverridesContextScaffold ? normalized : combined;

  const createVerb = hasAnyPhrase(intentSource, CREATE_VERBS);
  const requestPhrase = hasAnyPhrase(intentSource, REQUEST_PHRASES);
  const createSurface = hasAnyPhrase(intentSource, CREATE_SURFACES) || /\b(multipaginas|multi paginas|multiplas paginas|varias paginas|body|video no fundo)\b/.test(intentSource);
  const knownStack = hasAnyPhrase(intentSource, STACK_TERMS);
  const selfContainedBrief = pendingBriefing || currentEditOverridesContextScaffold ? false : hasSelfContainedBrief(intentSource);
  const continuationCreate = pendingBriefing || currentEditOverridesContextScaffold ? false : hasContinuationCreateSignal(intentSource);
  const defaultAuthorized = /\b(qualquer coisa|faz qualquer|voce decide|pode decidir|pode sugerir|sem perguntar|placeholder|placeholders|default|defaults|padrao|generico|generica|sem travar)\b/.test(intentSource);
  const explicitRebuild = currentExplicitRebuild || (!currentEditOverridesContextScaffold && hasExplicitRebuildSignal(routingContext));
  const complexApplication = !pendingBriefing && !currentEditOverridesContextScaffold && hasComplexApplicationSignal(intentSource);
  const complexBriefSufficient = complexApplication && hasComplexBriefSignal(intentSource);
  const mcpFreedomAllowed = complexApplication && hasMcpFreedomSignal(intentSource);
  const isAffirmative = isAffirmativeContinuation(raw);
  const requiresComplexBriefing = Boolean(
    complexApplication &&
      !complexBriefSufficient &&
      !defaultAuthorized &&
      !mcpFreedomAllowed &&
      !continuationCreate &&
      !selfContainedBrief &&
      !isAffirmative
  );

  const searchObject = /\b(arquivo|arquivos|texto|frase|mensagem|string|codigo)\b/.test(normalized);
  const searchScope = /\b(nos arquivos?|no arquivo|na pasta|no projeto|na base|no codigo|dentro do projeto|dentro dos arquivos?)\b/.test(normalized);
  const quotedSearch = /["“”'`][^"“”'`]{2,}["“”'`]/.test(raw);
  const searchIntent = hasAnyPhrase(normalized, SEARCH_TERMS) && searchObject && (searchScope || quotedSearch);
  const explicitFilePatchIntent = hasExplicitFilePatchIntent(routingNormalized);
  const errorDiagnosticSignal = hasAnyPhrase(normalized, DIAGNOSTIC_TERMS) || hasPreviewDiagnosticQuestion(normalized);
  const currentRepairIntent = hasVisualCorrectionIntent(normalized);
  const repairErrorIntent = Boolean(currentRepairIntent && errorDiagnosticSignal);
  const diagnosticIntent = (!explicitFilePatchIntent || repairErrorIntent) && errorDiagnosticSignal;
  const toolIntent = hasAnyPhrase(normalized, TOOL_TERMS);
  const repairDiagnosticIntent = Boolean(diagnosticIntent && (editVerb || currentRepairIntent));
  const visualReviewIntent =
    hasAnyPhrase(normalized, VISUAL_REVIEW_TERMS) &&
    !selfContainedBrief &&
    !hasVisualCorrectionIntent(normalized);

  const createScore = pendingBriefing ? 0 :
    (createVerb ? 38 : 0) +
    (requestPhrase ? 16 : 0) +
    (createSurface ? 26 : 0) +
    (knownStack ? 16 : 0) +
    (selfContainedBrief ? 30 : 0) +
    (complexBriefSufficient ? 28 : 0) +
    (continuationCreate ? 18 : 0) +
    (defaultAuthorized ? 8 : 0) +
    (canCreateInitialProject ? 8 : 0);
  const editScore =
    (editVerb ? 42 : 0) +
    (project.hasApplicationFiles ? 18 : 0) +
    (!canCreateInitialProject ? 8 : 0) -
    (explicitRebuild ? 24 : 0);

  const scaffoldIntent = Boolean(
    !pendingBriefing &&
      !explicitFilePatchIntent &&
      !requiresComplexBriefing &&
      !currentEditOverridesContextScaffold &&
      (selfContainedBrief ||
        complexBriefSufficient ||
        mcpFreedomAllowed ||
        continuationCreate ||
        explicitRebuild ||
        (createVerb && (createSurface || knownStack || defaultAuthorized)) ||
        (!editVerb && requestPhrase && (createSurface || knownStack || defaultAuthorized)) ||
        (canCreateInitialProject && knownStack && (createVerb || requestPhrase)))
  );
  const editIntent = Boolean((editVerb || currentEditOverridesContextScaffold) && !scaffoldIntent);
  const enoughForInitialCreate = Boolean(
    createSurface ||
      knownStack ||
      defaultAuthorized ||
      complexBriefSufficient ||
      mcpFreedomAllowed ||
      selfContainedBrief ||
      continuationCreate
  );
  const blueprintPreferred = Boolean(canCreateInitialProject && scaffoldIntent && enoughForInitialCreate);

  let action = 'conversation';
  let executionIntent = 'conversation';
  if (pendingBriefing || requiresComplexBriefing) {
    action = 'conversation';
    executionIntent = 'conversation';
  } else if (toolIntent && !repairDiagnosticIntent) {
    action = 'tool_action';
    executionIntent = 'tool_action';
  } else if (diagnosticIntent) {
    action = 'diagnostic_repair';
    executionIntent = 'diagnose_project';
  } else if (visualReviewIntent) {
    action = 'visual_review';
    executionIntent = 'visual_review';
  } else if (searchIntent) {
    action = 'search_project';
    executionIntent = 'search_project';
  } else if (scaffoldIntent && (canCreateInitialProject || createScore >= editScore || explicitRebuild)) {
    action = 'create_project';
    executionIntent = 'init_project';
  } else if (editVerb || project.hasApplicationFiles) {
    action = 'edit_project';
    executionIntent = 'edit_project';
  } else if (!isSmallTalk(normalized) && (createSurface || knownStack) && canCreateInitialProject) {
    action = 'create_project';
    executionIntent = 'init_project';
  }

  return {
    schemaVersion: PRODUCT_INTAKE_SCHEMA_VERSION,
    raw,
    normalized,
    canonical: {
      action,
      executionIntent,
      targetSurface: createSurface ? 'site_or_app_surface' : '',
      stackMentioned: knownStack,
      projectState: project.projectState,
    },
    project,
    scores: {
      create: createScore,
      edit: editScore,
    },
    signals: {
      smallTalk: isSmallTalk(normalized),
      scaffoldIntent,
      editIntent,
      searchIntent,
      diagnosticIntent,
      pendingBriefing,
      complexApplication,
      complexBriefSufficient,
      requiresComplexBriefing,
      mcpFreedomAllowed,
      guidedArchitecturePreferred: Boolean(complexApplication && (complexBriefSufficient || mcpFreedomAllowed || defaultAuthorized)),
      toolIntent,
      repairDiagnosticIntent,
      visualReviewIntent,
      explicitFilePatchIntent,
      selfContainedBrief,
      continuationCreate,
      defaultAuthorized,
      explicitRebuild,
      siteOrAppSurface: createSurface,
      knownProjectStack: knownStack,
      currentEditOverridesContextScaffold,
      canCreateInitialProject,
      enoughForInitialCreate,
	      blueprintPreferred,
	      hasNegatedRoutingClauses: routingNormalized !== normalized,
	      hasApplicationFiles: project.hasApplicationFiles,
	      hasAnyFiles: project.hasAnyFiles,
	    },
  };
}

module.exports = {
  PRODUCT_INTAKE_SCHEMA_VERSION,
  buildProductIntake,
  normalizeIntakeText,
  stripNegatedRoutingClauses,
};
