const {
  hasAnyScannedFiles,
  hasApplicationSurfaceFiles,
  normalizeIntentText,
} = require('./execution_intent');

function defaultHasScaffoldIntent(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  const buildVerb = /\b(crie|criar|gere|gerar|monte|montar|construa|construir|implemente|implementar|desenvolva|desenvolver|faz|faca|fazer|produza|produzir)\b/.test(
    normalized
  );
  const requestStyle = /\b(quero|queria|preciso|gostaria|poderia|pode seguir)\b/.test(normalized);
  const buildObject = /\b(aplicacao|app|sistema|site|projeto|calculadora|dashboard|api|landing|pagina)\b/.test(
    normalized
  );
  const autonomousDefault = /\b(qualquer coisa|faz qualquer|faca qualquer|voce decide|pode decidir|pode sugerir|sem perguntar|placeholder|placeholders|generico|generica)\b/.test(
    normalized
  );
  return ((buildVerb || requestStyle) && buildObject) || (buildVerb && autonomousDefault);
}

function defaultHasEditIntent(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  return /\b(altere|alterar|edite|editar|corrija|corrigir|ajuste|ajustar|mude|mudar|troque|trocar|insira|inserir|adicione|adicionar|remova|remover|refatore|refatorar|atualize|atualizar)\b/.test(
    normalized
  );
}

function defaultHasSearchIntent(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  return (
    /\b(encontre|encontrar|achar|ache|localize|localizar|procure|procurar|buscar|busque)\b/.test(normalized) &&
    /\b(arquivo|texto|frase|mensagem|string|codigo|código)\b/.test(normalized)
  );
}

function isGreetingOrSmallTalk(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  if (!normalized) return true;
  if (normalized.length <= 3 && /^(oi|ola|hey|hi)$/.test(normalized)) return true;
  return /^(oi|ola|ol[aá]|bom dia|boa tarde|boa noite|hello|hi|e ai|e aí|tudo bem)[.!? ]*$/.test(
    String(userMessage || '').trim().toLowerCase()
  );
}

function hasExploratoryConversationSignal(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  if (!normalized || isGreetingOrSmallTalk(userMessage)) return false;
  return /\b(nao sei|nao tenho certeza|estou em duvida|to em duvida|tou em duvida|duvida do que|ainda nao sei|nao decidi|me ajuda a pensar|me ajude a pensar|explorar ideias|explorar possibilidades|o que posso fazer|sem ideia ainda)\b/.test(
    normalized
  );
}

function isAffirmativeContinuation(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  return /^(sim|s|ok|certo|isso|pode|pode sim|pode gerar|gera|gerar|continue|continuar|segue|pode seguir|claro|faca|fazer|manda ver|vamos|prossiga|tente novamente|retente)$/.test(
    normalized
  );
}

function isProjectEmpty(projectInfo = null) {
  if (!projectInfo) return false;
  return !hasAnyScannedFiles(projectInfo) && !hasApplicationSurfaceFiles(projectInfo);
}

function buildRecentConversationText(conversationMessages = []) {
  if (!Array.isArray(conversationMessages) || !conversationMessages.length) return '';
  return conversationMessages
    .slice(-8)
    .map((message) => {
      const role = message && message.role === 'assistant' ? 'assistant' : 'user';
      const text = String(
        message && (message.text || message.content || message.message)
          ? message.text || message.content || message.message
          : ''
      ).trim();
      return text ? `${role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function hasProjectCreationContext(source = '') {
  const normalized = normalizeIntentText(source);
  if (!normalized) return false;
  return /\b(criar|crie|gerar|gere|montar|monte|fazer|faca|site|app|aplicacao|projeto|next|nextjs|next\.js|react|tailwind|estrutura inicial|base inicial)\b/.test(
    normalized
  );
}

function looksLikeProjectBriefContinuation(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  if (!normalized || isGreetingOrSmallTalk(userMessage)) return false;
  return /\b(queria|acho que|tambem|também|secao|seção|secoes|seções|hero|cta|horario|horarios|ingresso|ingressos|mapa|contato|imagem|imagens|icone|icones|ícone|ícones|fonte|google|manrope|paleta|cor|cores|azul|branco|estilo|experiencia|experiência|imersiva|passeio|passeios|catalogo|catálogo|blog|loja|checkout|pagamento)\b/.test(
    normalized
  );
}

function shouldUseConversationForRouting(current = '', conversationMessages = []) {
  if (isAffirmativeContinuation(current)) return true;
  const recentConversation = buildRecentConversationText(conversationMessages);
  if (!recentConversation) return false;
  return hasProjectCreationContext(recentConversation) && looksLikeProjectBriefContinuation(current);
}

function buildRoutingSourceMessage({ userMessage = '', contextHint = null, conversationMessages = [] } = {}) {
  const current = String(userMessage || '').trim();
  const contextParts = [];
  if (contextHint && contextHint.originalUserMessage) contextParts.push(contextHint.originalUserMessage);
  if (contextHint && contextHint.routeExecutionMessage) contextParts.push(contextHint.routeExecutionMessage);
  if (contextHint && contextHint.lastScaffoldPrompt) contextParts.push(contextHint.lastScaffoldPrompt);

  if (!shouldUseConversationForRouting(current, conversationMessages)) {
    return current || contextParts.filter(Boolean).join('\n');
  }

  const recentConversation = buildRecentConversationText(conversationMessages);
  return [recentConversation, ...contextParts, current].filter(Boolean).join('\n');
}

function hasSiteOrAppSurface(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  return (
    /\b(site|landing|pagina|page|app|aplicacao|sistema|dashboard|portal|web|frontend|next|nextjs|next\.js|react|tailwind|lamp|php|astro|vue|svelte)\b/.test(
      normalized
    ) ||
    /\b(qualquer coisa|faz qualquer|faca qualquer|voce decide|pode decidir|pode sugerir|sem perguntar|placeholder|placeholders|generico|generica)\b/.test(
      normalized
    )
  );
}

function hasKnownProjectStack(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  return /\b(next|nextjs|next\.js|react|tailwind|lamp|php|mysql|html|css|astro|vue|svelte|node|express|electron)\b/.test(
    normalized
  );
}

function hasDomainOrAudience(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  return /\b(advogad|advocacia|juridic|imoveis|imobiliari|corretor|clinica|dentista|odont|veterin|restaurante|portfolio|fotograf|arquitet|empresa|negocio|loja|ecommerce|curso|escola|saas|crm|landing|aquario|aquarium|pinguim|peixe|estufa|estufas|greenhouse|cultivo protegido|viveiro|viveiros|horta|hortas|floricultura|agricultura|produtor rural|agricultor|mudas|irrigacao)\b/.test(
    normalized
  );
}

function hasDefaultsAuthorization(userMessage = '', shouldUseDefaultScaffoldConfiguration = null) {
  if (typeof shouldUseDefaultScaffoldConfiguration === 'function' && shouldUseDefaultScaffoldConfiguration(userMessage)) {
    return true;
  }
  const normalized = normalizeIntentText(userMessage);
  return /\b(qualquer coisa|faz qualquer|faca qualquer|placeholder|placeholders|default|defaults|padrao|generico|generica|informacoes genericas|pode sugerir|voce decide|pode decidir|pode fazer|pode seguir|sem travar|sem perguntar)\b/.test(
    normalized
  );
}

function createProductContractService(dependencies = {}) {
  const {
    extractRequestedTitle = () => '',
    hasEditIntent = defaultHasEditIntent,
    hasScaffoldIntent = defaultHasScaffoldIntent,
    hasSearchIntent = defaultHasSearchIntent,
    isButtonColorEditRequest = () => false,
    isFooterInsertRequest = () => false,
    isHydrationMismatchRepairRequest = () => false,
    isLiteralColorReplacementRequest = () => false,
    isThemeColorEditRequest = () => false,
    resolveExecutionIntent = null,
    shouldPreferProjectBlueprint = () => false,
    shouldUseDefaultScaffoldConfiguration = null,
  } = dependencies;

  function buildCapabilityContract() {
    return {
      schemaVersion: 'product-route-v1',
      decisions: ['chat', 'clarify', 'execute'],
      capabilities: {
        conversation: {
          description: 'Conversar sem iniciar job quando o pedido nao exige arquivos, comandos ou diagnostico.',
          allowedDecisions: ['chat', 'clarify'],
        },
        create_project: {
          description: 'Criar a base inicial de um projeto selecionado, preferindo blueprints Faber quando cabivel.',
          allowedDecisions: ['clarify', 'execute'],
          executionIntent: 'init_project',
          modes: ['faber_blueprint', 'adaptive_blueprint', 'guided_app_architecture', 'cortex_scaffold'],
        },
        edit_project: {
          description: 'Editar projeto existente com operacoes incrementais, validacao e confirmacao do usuario.',
          allowedDecisions: ['clarify', 'execute'],
          executionIntent: 'edit_project',
          modes: ['deterministic_patch', 'cortex_incremental_edit'],
        },
        search_project: {
          description: 'Localizar texto, arquivo ou trecho dentro do projeto selecionado.',
          allowedDecisions: ['execute'],
          executionIntent: 'search_project',
          modes: ['local_search'],
        },
        diagnose_project: {
          description: 'Analisar build, preview, erro ou integridade tecnica antes de propor alteracao.',
          allowedDecisions: ['clarify', 'execute'],
          executionIntent: 'diagnose_project',
          modes: ['local_diagnostics', 'cortex_diagnostics'],
        },
        project_tools: {
          description: 'Operar ferramentas do produto como terminal, preview, Git e execucao local.',
          allowedDecisions: ['clarify', 'execute'],
          executionIntent: 'tool_action',
          modes: ['terminal', 'preview', 'git', 'runner'],
        },
      },
      rules: [
        'Nunca executar sem projeto selecionado.',
        'Projeto vazio com pedido de site/app e stack suficiente deve ir para create_project.',
        'Projeto existente com pedido de alteracao deve ir para edit_project.',
        'Se a decisao semantica da IA conflitar com o estado do projeto, o policy gate deve corrigir ou pedir esclarecimento.',
        'Arquivos so podem ser alterados depois da etapa de plano validado e confirmacao do usuario.',
      ],
    };
  }

  function resolveIntent(sourceMessage, contextHint, projectInfo) {
    if (typeof resolveExecutionIntent === 'function') {
      return resolveExecutionIntent(sourceMessage, contextHint || {}, projectInfo || null);
    }
    if (hasScaffoldIntent(sourceMessage) && (!projectInfo || isProjectEmpty(projectInfo))) return 'init_project';
    if (hasApplicationSurfaceFiles(projectInfo)) return 'edit_project';
    return hasScaffoldIntent(sourceMessage) ? 'init_project' : 'edit_project';
  }

  function hasDeterministicEditRequest(userMessage, projectInfo) {
    if (!projectInfo || !hasApplicationSurfaceFiles(projectInfo)) return false;
    return Boolean(
      extractRequestedTitle(userMessage) ||
        isLiteralColorReplacementRequest(userMessage) ||
        isThemeColorEditRequest(userMessage) ||
        isButtonColorEditRequest(userMessage) ||
        isFooterInsertRequest(userMessage) ||
        isHydrationMismatchRepairRequest(userMessage)
    );
  }

  function buildProductFacts({
    projectInfo = null,
    userMessage = '',
    attachments = [],
    contextHint = null,
    conversationMessages = [],
  } = {}) {
    const currentMessage = String(userMessage || '').trim();
    const sourceMessage = buildRoutingSourceMessage({ userMessage, contextHint, conversationMessages });
    const hasProject = Boolean(projectInfo && projectInfo.rootPath);
    const projectState = !hasProject
      ? 'missing_project'
      : hasApplicationSurfaceFiles(projectInfo)
        ? 'existing_project'
        : isProjectEmpty(projectInfo)
          ? 'empty_project'
          : 'metadata_only_project';
    const source = sourceMessage || currentMessage;
    const executionIntent = resolveIntent(source, contextHint, projectInfo);
    const scaffoldIntent = Boolean(hasScaffoldIntent(currentMessage) || hasScaffoldIntent(source));
    const editIntent = Boolean(hasEditIntent(currentMessage) || hasEditIntent(source));
    const searchIntent = Boolean(hasSearchIntent(currentMessage) || hasSearchIntent(source));
    const defaultAuthorized = hasDefaultsAuthorization(source, shouldUseDefaultScaffoldConfiguration);
    const siteOrAppSurface = hasSiteOrAppSurface(source);
    const knownProjectStack = hasKnownProjectStack(source);
    const domainOrAudience = hasDomainOrAudience(source);
    const exploratoryConversation = Boolean(
      hasExploratoryConversationSignal(currentMessage) || hasExploratoryConversationSignal(source)
    );
    const deterministicEdit = hasDeterministicEditRequest(source, projectInfo);
    const canUseInitialBlueprint = Boolean(
      (projectState === 'empty_project' || projectState === 'metadata_only_project') &&
        executionIntent === 'init_project' &&
        scaffoldIntent &&
        !editIntent
    );
    const blueprintPreferred = Boolean(
      canUseInitialBlueprint &&
        shouldPreferProjectBlueprint({
          projectInfo,
          userMessage: source,
          attachments,
          executionIntent: 'init_project',
        })
    );

    return {
      currentMessage,
      sourceMessage: source,
      hasProject,
      projectState,
      executionIntent,
      signals: {
        smallTalk: isGreetingOrSmallTalk(currentMessage),
        affirmativeContinuation: isAffirmativeContinuation(currentMessage),
        scaffoldIntent,
        editIntent,
        searchIntent,
        exploratoryConversation,
        defaultAuthorized,
        siteOrAppSurface,
        knownProjectStack,
        domainOrAudience,
        deterministicEdit,
        canUseInitialBlueprint,
        blueprintPreferred,
        hasAttachments: Array.isArray(attachments) && attachments.length > 0,
        hasApplicationFiles: hasApplicationSurfaceFiles(projectInfo),
        hasAnyFiles: hasAnyScannedFiles(projectInfo || {}),
        enoughForInitialCreate:
          siteOrAppSurface && (knownProjectStack || domainOrAudience || defaultAuthorized),
      },
    };
  }

  return {
    buildCapabilityContract,
    buildProductFacts,
  };
}

module.exports = {
  buildRoutingSourceMessage,
  createProductContractService,
  defaultHasEditIntent,
  defaultHasScaffoldIntent,
  defaultHasSearchIntent,
  hasExploratoryConversationSignal,
  hasDefaultsAuthorization,
  hasDomainOrAudience,
  hasKnownProjectStack,
  hasSiteOrAppSurface,
  isAffirmativeContinuation,
  isGreetingOrSmallTalk,
  isProjectEmpty,
};
