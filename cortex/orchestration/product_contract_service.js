const {
  hasAnyScannedFiles,
  hasApplicationSurfaceFiles,
  hasExplicitProjectRebuildIntent,
  normalizeIntentText,
} = require('./execution_intent');
const {
  buildProductIntake,
  stripNegatedRoutingClauses,
} = require('./product_intake_service');

function defaultHasScaffoldIntent(userMessage = '') {
  return Boolean(buildProductIntake({ userMessage }).signals.scaffoldIntent);
}

function defaultHasEditIntent(userMessage = '') {
  return Boolean(buildProductIntake({ userMessage }).signals.editIntent);
}

function defaultHasSearchIntent(userMessage = '') {
  const intake = buildProductIntake({ userMessage });
  if (intake.signals.searchIntent) return true;
  const normalized = normalizeIntentText(userMessage);
  const searchVerb = /\b(encontre|encontrar|achar|ache|localize|localizar|procure|procurar|buscar|busque)\b/.test(
    normalized
  );
  const searchObject = /\b(arquivo|arquivos|texto|frase|mensagem|string|codigo|código)\b/.test(normalized);
  const projectScope = /\b(nos arquivos?|no arquivo|na pasta|no projeto|na base|no codigo|no código|dentro do projeto|dentro dos arquivos?)\b/.test(
    normalized
  );
  const quotedNeedle = /["“”'`][^"“”'`]{2,}["“”'`]/.test(String(userMessage || ''));
  const createBriefContext = /\b(criar|crie|gerar|gere|montar|monte|desenvolver|desenvolva|site|site completo|landing|pagina inicial|página inicial|briefing|home|loja|blog|galeria|portfolio|portfólio)\b/.test(
    normalized
  );
  return Boolean(searchVerb && searchObject && projectScope && (quotedNeedle || !createBriefContext));
}

function defaultHasVisualReviewIntent(userMessage = '') {
  const intake = buildProductIntake({ userMessage });
  const normalized = intake.normalized;
  if (!normalized) return false;
  if (intake.signals.scaffoldIntent || intake.signals.selfContainedBrief || hasSelfContainedRoutingBrief(userMessage)) return false;
  if (intake.signals.visualReviewIntent) return true;
  return (
    /\b(validar visualmente|validacao visual|validar prints?|validar screenshots?|revisar visual|analise visual|analisar visualmente|comparar com o briefing|aderencia visual|captura visual|smoketest visual|smoke visual)\b/.test(normalized) ||
    (/\b(prints?|screenshots?|capturas?|imagens anexadas?|anexos?)\b/.test(normalized) &&
      /\b(validar|validacao|revisar|analisar|comparar|diagnosticar|avaliar)\b/.test(normalized))
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
  return /^(sim|s|ok|certo|isso|pode|pode sim|pode gerar|gera|gerar|continue|continuar|segue|pode seguir|claro|faca|fazer|manda ver|vamos|prossiga|tente novamente|retente|tanto faz|qualquer|qualquer um|indiferente|tanto fez|voce decide|você decide|o que achar melhor)$/.test(
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
  const normalized = stripNegatedRoutingClauses(normalizeIntentText(source));
  if (!normalized) return false;
  return /\b(criar|crie|gerar|gere|montar|monte|configurar|configure|fazer|faca|site|site completo|app|aplicacao|projeto|preset|mcp|tools?|capability|next|nextjs|next\.js|react|tailwind|estrutura inicial|base inicial|briefing completo|composicao modular|composição modular)\b/.test(
    normalized
  );
}

function shouldUseAutonomousIncrementalEdit(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  if (!normalized) return false;
  return /\b(mcp|automata|tools?|capabilit|agente|agentes|executor|liberdade de acao|liberdade de ação|liberdade de execucao|liberdade de execução|autonom[iao]|arquitetura livre|sem scaffold|nao use scaffold|não use scaffold)\b/.test(normalized) ||
    /\b(arquitetura|reorganize|reorganizar|refatore|refatorar|estrutura de arquivos|pastas|dominio|domínio|services?|persistencia|persistência|prisma|postgres|zod|vitest|playwright|react hook form|tanstack)\b/.test(normalized) ||
    /\b(tipografia|tipografias|typography|fontes?|next\/font|google fonts?|ibm plex|assistant|inter|tailwind|className|globals\.css|tailwind\.config|layout|visual|tema|dark|escuro)\b/.test(normalized) ||
    (/\b(build|testes?|tests?|preview|smoke|screenshot|screenshots?|captura|capturas)\b/.test(normalized) &&
      /\b(validar|valide|validacao|validação|rodar|rode|executar|execute|real)\b/.test(normalized));
}

function hasSelfContainedRoutingBrief(source = '') {
  const normalized = stripNegatedRoutingClauses(normalizeIntentText(source));
  if (!normalized || normalized.length < 260) return false;
  const hasCreateSurface = hasProjectCreationContext(normalized);
  const hasBriefDetails = /\b(hero|header|footer|rodape|secao|secoes|seção|seções|paleta|tipografia|video|imagem|produtos|servicos|processo|contato|cta|botao|formulario|blog|galeria|portfolio|depoimentos|faq|rota|pagina)\b/.test(
    normalized
  );
  return Boolean(hasCreateSurface && hasBriefDetails);
}

function looksLikeProjectBriefContinuation(userMessage = '') {
  const normalized = stripNegatedRoutingClauses(normalizeIntentText(userMessage));
  if (!normalized || isGreetingOrSmallTalk(userMessage)) return false;
  return /\b(queria|acho que|tambem|também|secao|seção|secoes|seções|hero|cta|horario|horarios|ingresso|ingressos|mapa|contato|imagem|imagens|icone|icones|ícone|ícones|fonte|google|manrope|paleta|cor|cores|azul|branco|estilo|experiencia|experiência|imersiva|passeio|passeios|catalogo|catálogo|blog|loja|checkout|pagamento|briefing|briefing completo|composicao modular|composição modular|pedido|finalize|finalizar|algo novo|novo projeto|nova base)\b/.test(
    normalized
  );
}

function looksLikeTechnicalChoiceContinuation(userMessage = '') {
  const normalized = stripNegatedRoutingClauses(normalizeIntentText(userMessage));
  if (!normalized || isGreetingOrSmallTalk(userMessage)) return false;
  const choiceVerb = /\b(quero manter|manter|mantem|mantém|prefiro|prefere|vamos de|vamos usar|usar|use|usa|escolho|escolher|opto|optar|vou de|va de|vai de|com|utilizar|utilize|utiliza|primeira|segunda|primeiro|segundo|opcao|opção)\b/;
  const stackOrTool = /\b(next|nextjs|next\.js|react|vite|electron|tailwind|typescript|javascript|node|prisma|drizzle|postgres|postgresql|sqlite|mysql|supabase|firebase|yjs|websocket|ws|app router|pages router)\b/;
  return stackOrTool.test(normalized) || (choiceVerb.test(normalized) && /\b(primeir|segund|terceir|quarta|opcao|opçao|opção|primeiro|segundo)\b/.test(normalized));
}

function hasNewProjectContinuationSignal(userMessage = '') {
  const normalized = stripNegatedRoutingClauses(normalizeIntentText(userMessage));
  if (!normalized || isGreetingOrSmallTalk(userMessage)) return false;
  const wantsCreation = /\b(criar|crie|gerar|gere|seguir|finalize|finalizar|concluir|prossiga|continuar|continue)\b/.test(
    normalized
  );
  const referencesBrief = /\b(briefing|briefing completo|pedido|composicao modular|composição modular|algo novo|novo projeto|nova base|site completo|nessa conversa|desta conversa|que passei|que enviei)\b/.test(
    normalized
  );
  return wantsCreation && referencesBrief;
}

function hasCurrentEditSignalForRouting(userMessage = '') {
  const normalized = stripNegatedRoutingClauses(normalizeIntentText(userMessage));
  if (!normalized) return false;
  return /\b(altere|alterar|edite|editar|corrija|corrigir|ajuste|ajustar|mude|mudar|troque|trocar|insira|inserir|adicione|adicionar|remova|remover|refatore|refatorar|atualize|atualizar|deixe|deixar|coloque|colocar|substitua|substituir|melhore|melhorar)\b/.test(
    normalized
  );
}

function currentMessageOwnsExistingProjectEdit({ current = '', projectInfo = null } = {}) {
  const normalized = stripNegatedRoutingClauses(normalizeIntentText(current));
  const explicitCreateConflict = Boolean(
    /\b(criar|crie|gerar|gere|montar|monte|novo app|novo projeto|novo site|nova base)\b/.test(normalized) &&
      !/\b(nova area|nova secao|nova seção|nova pagina|nova rota|adicionar pagina|adicionar secao|adicionar seção)\b/.test(normalized)
  );
  const discussionQuestion = Boolean(
    /\b(o que voce acha|qual sua opiniao|voce acha|deveria|seria melhor|vale a pena|faz sentido)\b/.test(normalized) ||
      /^(como|qual|quais|por que|o que)\b/.test(normalized)
  );
  return Boolean(
    hasApplicationSurfaceFiles(projectInfo || {}) &&
      hasCurrentEditSignalForRouting(current) &&
      !hasExplicitProjectRebuildIntent(current) &&
      !hasNewProjectContinuationSignal(current) &&
      !explicitCreateConflict &&
      !discussionQuestion
  );
}

function shouldUseConversationForRouting(current = '', conversationMessages = [], projectInfo = null) {
  const recentConversation = buildRecentConversationText(conversationMessages);
  if (!recentConversation) return false;
  if (hasSelfContainedRoutingBrief(current)) return false;
  if (currentMessageOwnsExistingProjectEdit({ current, projectInfo })) return false;
  if (isAffirmativeContinuation(current)) return hasProjectCreationContext(recentConversation);
  return hasProjectCreationContext(recentConversation) &&
    (
      looksLikeProjectBriefContinuation(current) ||
      looksLikeTechnicalChoiceContinuation(current) ||
      hasNewProjectContinuationSignal(current)
    );
}

function buildRoutingSourceMessage({ userMessage = '', contextHint = null, conversationMessages = [], projectInfo = null } = {}) {
  const current = String(userMessage || '').trim();
  const contextParts = [];
  if (contextHint && contextHint.originalUserMessage) contextParts.push(contextHint.originalUserMessage);
  if (contextHint && contextHint.routeExecutionMessage) contextParts.push(contextHint.routeExecutionMessage);
  if (contextHint && contextHint.lastScaffoldPrompt) contextParts.push(contextHint.lastScaffoldPrompt);

  if (!shouldUseConversationForRouting(current, conversationMessages, projectInfo)) {
    return current || contextParts.filter(Boolean).join('\n');
  }

  const recentConversation = buildRecentConversationText(conversationMessages);
  return [recentConversation, ...contextParts, current].filter(Boolean).join('\n');
}

function shouldUseActiveMemoryForRouting(currentMessage = '', activeMemory = null) {
  if (!activeMemory || typeof activeMemory !== 'object') return false;
  if (hasSelfContainedRoutingBrief(currentMessage)) return false;
  if (activeMemory.current && activeMemory.current.continuationIntent) return true;
  const normalized = normalizeIntentText(currentMessage);
  return /\b(memoria|contexto|como combinamos|como conversamos|do jeito que falamos|segue com isso|usa isso|use isso|briefing que passei|briefing completo|nessa conversa|desta conversa|que enviei)\b/.test(
    normalized
  );
}

function buildActiveMemoryRoutingContext(activeMemory = null, currentMessage = '') {
  if (!shouldUseActiveMemoryForRouting(currentMessage, activeMemory)) return '';
  const decision = activeMemory && activeMemory.decision && typeof activeMemory.decision === 'object'
    ? activeMemory.decision
    : {};
  return String(decision.routeContextText || '').trim();
}

function buildActiveMemoryRouteSignals(activeMemory = null, currentMessage = '') {
  if (!activeMemory || typeof activeMemory !== 'object') {
    return {
      activeMemoryAvailable: false,
      activeMemoryContinuation: false,
      activeMemoryForRouting: false,
    };
  }
  const user = activeMemory.user || {};
  const project = activeMemory.project || {};
  const routeContextText = buildActiveMemoryRoutingContext(activeMemory, currentMessage);
  return {
    activeMemoryAvailable: Boolean(user.available || project.available),
    activeMemoryContinuation: Boolean(routeContextText && activeMemory.current && activeMemory.current.continuationIntent),
    activeMemoryForRouting: Boolean(routeContextText),
    userMemoryCount: Number(user.selectedCount || 0),
    projectMemoryCount: Number(project.selectedCount || 0),
  };
}

function summarizeActiveMemoryForProduct(activeMemory = null) {
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

function hasSiteOrAppSurface(userMessage = '') {
  const intake = buildProductIntake({ userMessage });
  if (intake.signals.siteOrAppSurface) return true;
  const normalized = intake.normalized;
  return (
    /\b(site|landing|pagina|page|app|aplicacao|sistema|dashboard|portal|web|frontend|next|nextjs|next\.js|react|tailwind|lamp|php|astro|vue|svelte|ferramenta|calculadora|conversor|componente|tabela|formulario|formulário|fluxo|integracao|integração|crm)\b/.test(
      normalized
    ) ||
    /\b(qualquer coisa|faz qualquer|faca qualquer|voce decide|pode decidir|pode sugerir|sem perguntar|placeholder|placeholders|generico|generica)\b/.test(
      normalized
    )
  );
}

function hasKnownProjectStack(userMessage = '') {
  return Boolean(buildProductIntake({ userMessage }).signals.knownProjectStack);
}

function hasDomainOrAudience(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  return /\b(advogad|advocacia|juridic|juridico|jurídico|propriedade intelectual|propriedade industrial|patente|patentes|registro de marcas|desenho industrial|desenhos industriais|busca de anterioridade|inpi|imoveis|imobiliari|corretor|clinica|dentista|odont|veterin|restaurante|portfolio|fotograf|laboratorio fotografico|laboratório fotográfico|revelacao de filmes|revelação de filmes|digitalizacao de negativos|digitalização de negativos|impressao fine art|impressão fine art|restauracao fotografica|restauração fotográfica|arquitet|empresa|negocio|loja|ecommerce|curso|escola|produtividade|lider|lideres|líder|líderes|marketing|campanha|campanhas|freelancer|freelancers|saas|crm|pipeline|financeiro|financas|finanças|despesas|receitas|tarefas|prioridades|contratos|contrato|fornecedor|fornecedores|propostas|eventos|participantes|check-in|landing|aquario|aquarium|pinguim|peixe|chocolate|chocolates|cacau|cacao|bombom|bombons|chocolateria|tablete|trufa|ganache|garrafa|garrafas|vidro reutilizavel|vidro reutilizável|livre de bpa|jardinagem|jardim|jardins|paisagismo|plantas|plantas internas|jardim vertical|revestimento|revestimentos|piso de madeira|pisos de madeira|painel ripado|paineis ripados|painéis ripados|deck|decks|madeira natural|acabamentos arquitetonicos|rodapes|rodapés|esquadria|esquadrias|aluminio|alumínio|fachada em acm|fachadas em acm|pele de vidro|guarda-corpo|guarda-corpos|brise|brises|escultura|esculturas|madeira|talha|entalhe|atelie|ateliê|estufa|estufas|greenhouse|cultivo protegido|viveiro|viveiros|horta|hortas|floricultura|agricultura|produtor rural|agricultor|mudas|irrigacao|importacao|importar|comercio exterior|logistica internacional|desembaraco aduaneiro|alfandega|fornecedor internacional)\b/.test(
    normalized
  );
}

function hasDefaultsAuthorization(userMessage = '', shouldUseDefaultScaffoldConfiguration = null) {
  if (typeof shouldUseDefaultScaffoldConfiguration === 'function' && shouldUseDefaultScaffoldConfiguration(userMessage)) {
    return true;
  }
  const intake = buildProductIntake({ userMessage });
  if (intake.signals.defaultAuthorized) return true;
  const normalized = intake.normalized;
  return /\b(qualquer coisa|faz qualquer|faca qualquer|placeholder|placeholders|default|defaults|padrao|generico|generica|informacoes genericas|pode sugerir|voce decide|pode decidir|pode fazer|pode seguir|sem travar|sem perguntar)\b/.test(
    normalized
  );
}

function hasTechnicalDeterministicRepairRequest(userMessage = '') {
  const normalized = normalizeIntentText(userMessage);
  if (!normalized) return false;

  const hasRepairVerb = /\b(corrij\w*|consert\w*|arrum\w*|repar\w*|resolv\w*|apliqu\w*|substitu\w*|remov\w*|mov\w*|falh\w*|fix)\b/.test(
    normalized
  );
  if (!hasRepairVerb) return false;

  const structuredCloneCompat = Boolean(
    /\b(structuredclone|structured clone)\b/.test(normalized) &&
      /\b(jest|teste|testes|unitario|unitarios|referenceerror|is not defined|nao definido)\b/.test(normalized)
  );

  const nextBrowserGlobalModuleScope = Boolean(
    /\b(next|preview|visualizacao|render|app\/page|page\.tsx|referenceerror)\b/.test(normalized) &&
      /\b(document is not defined|window is not defined|document\.createelement|document\.head|document|window|localstorage|sessionstorage|navigator|browser global|escopo de modulo|module scope)\b/.test(normalized)
  );

  return Boolean(structuredCloneCompat || nextBrowserGlobalModuleScope);
}

function createProductContractService(dependencies = {}) {
  const {
    extractRequestedTitle = () => '',
    hasEditIntent = defaultHasEditIntent,
    hasScaffoldIntent = defaultHasScaffoldIntent,
    hasSearchIntent = defaultHasSearchIntent,
    hasVisualReviewIntent = defaultHasVisualReviewIntent,
    isBackgroundColorEditRequest = () => false,
    isButtonColorEditRequest = () => false,
    isCardTextEditRequest = () => false,
    isCtaTextEditRequest = () => false,
    isFaqItemPatchRequest = () => false,
    isFooterInsertRequest = () => false,
    isFormFieldPatchRequest = () => false,
    isGridColumnsEditRequest = () => false,
    isHeroMediaPatchRequest = () => false,
    isHeadingColorEditRequest = () => false,
    isHydrationMismatchRepairRequest = () => false,
    isLiteralColorReplacementRequest = () => false,
    isNavLinkEditRequest = () => false,
    isSecondaryCtaEditRequest = () => false,
    isSectionRemoveRequest = () => false,
    isSectionReorderRequest = () => false,
    isStatTextPatchRequest = () => false,
    isThemeColorEditRequest = () => false,
    isTypographyEditRequest = () => false,
    isUnsupportedBackgroundMediaRequest = () => false,
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
          allowedDecisions: ['chat', 'clarify', 'execute'],
          executionIntent: 'diagnose_project',
          modes: ['local_diagnostics', 'cortex_diagnostics', 'visual_review'],
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
    const scaffoldLike = hasScaffoldIntent(sourceMessage) || hasSelfContainedRoutingBrief(sourceMessage);
    const explicitRebuild = hasExplicitProjectRebuildIntent(sourceMessage);
    if (scaffoldLike && (!projectInfo || isProjectEmpty(projectInfo))) return 'init_project';
    if (scaffoldLike && explicitRebuild) return 'init_project';
    if (hasApplicationSurfaceFiles(projectInfo)) return 'edit_project';
    return scaffoldLike ? 'init_project' : 'edit_project';
  }

  function hasDeterministicEditRequest(userMessage, projectInfo) {
    if (!projectInfo || !hasApplicationSurfaceFiles(projectInfo)) return false;
    if (shouldUseAutonomousIncrementalEdit(userMessage)) return false;
    const unsupportedVisualPatch = Boolean(
      isUnsupportedBackgroundMediaRequest(userMessage) && !isHeroMediaPatchRequest(userMessage)
    );
    if (unsupportedVisualPatch) return false;
    return Boolean(
        extractRequestedTitle(userMessage) ||
        isBackgroundColorEditRequest(userMessage) ||
        isHeadingColorEditRequest(userMessage) ||
        isLiteralColorReplacementRequest(userMessage) ||
        isThemeColorEditRequest(userMessage) ||
        isTypographyEditRequest(userMessage) ||
        isButtonColorEditRequest(userMessage) ||
        isNavLinkEditRequest(userMessage) ||
        isCtaTextEditRequest(userMessage) ||
        isSecondaryCtaEditRequest(userMessage) ||
        isCardTextEditRequest(userMessage) ||
        isGridColumnsEditRequest(userMessage) ||
        isSectionReorderRequest(userMessage) ||
        isFaqItemPatchRequest(userMessage) ||
        isSectionRemoveRequest(userMessage) ||
        isFormFieldPatchRequest(userMessage) ||
        isStatTextPatchRequest(userMessage) ||
        isHeroMediaPatchRequest(userMessage) ||
        isFooterInsertRequest(userMessage) ||
        isHydrationMismatchRepairRequest(userMessage) ||
        hasTechnicalDeterministicRepairRequest(userMessage)
    );
  }

  function buildProductFacts({
    projectInfo = null,
    userMessage = '',
    attachments = [],
    contextHint = null,
    conversationMessages = [],
    activeMemory = null,
  } = {}) {
    const currentMessage = String(userMessage || '').trim();
    const activeMemoryRouteContext = buildActiveMemoryRoutingContext(activeMemory, currentMessage);
    const activeMemorySignals = buildActiveMemoryRouteSignals(activeMemory, currentMessage);
    let sourceMessage = buildRoutingSourceMessage({ userMessage, contextHint, conversationMessages, projectInfo });
    if (activeMemoryRouteContext) {
      sourceMessage = [sourceMessage || currentMessage, activeMemoryRouteContext]
        .filter(Boolean)
        .join('\n');
    }
    const hasProject = Boolean(projectInfo && projectInfo.rootPath);
    const projectState = !hasProject
      ? 'missing_project'
      : hasApplicationSurfaceFiles(projectInfo)
        ? 'existing_project'
        : isProjectEmpty(projectInfo)
          ? 'empty_project'
          : 'metadata_only_project';
    const source = sourceMessage || currentMessage;
    const currentIntake = buildProductIntake({ userMessage: currentMessage, projectInfo });
    const sourceIntake = buildProductIntake({ userMessage: source, projectInfo });
    const pendingBriefing = Boolean(currentIntake.signals.pendingBriefing);
    const currentEditOverridesContextScaffold = currentMessageOwnsExistingProjectEdit({
      current: currentMessage,
      projectInfo,
    });
    const routeSource = pendingBriefing ? currentMessage : currentEditOverridesContextScaffold ? currentMessage : source;
    const routeIntake = pendingBriefing ? currentIntake : currentEditOverridesContextScaffold ? currentIntake : sourceIntake;
    const intakeExecutionIntent = pendingBriefing
      ? 'conversation'
      : routeIntake.canonical.executionIntent !== 'conversation'
      ? routeIntake.canonical.executionIntent
      : currentIntake.canonical.executionIntent !== 'conversation'
        ? currentIntake.canonical.executionIntent
        : '';
    const executionIntent = pendingBriefing ? 'conversation' : intakeExecutionIntent || resolveIntent(routeSource, contextHint, projectInfo);
    const newProjectContinuation = !pendingBriefing && hasNewProjectContinuationSignal(currentMessage);
    const selfContainedCreateBrief = Boolean(
      !pendingBriefing &&
        !currentEditOverridesContextScaffold &&
        (currentIntake.signals.selfContainedBrief ||
          sourceIntake.signals.selfContainedBrief ||
          hasSelfContainedRoutingBrief(currentMessage) ||
          hasSelfContainedRoutingBrief(routeSource))
    );
    const scaffoldIntent = Boolean(
      !pendingBriefing &&
        !currentEditOverridesContextScaffold &&
        (currentIntake.signals.scaffoldIntent ||
          sourceIntake.signals.scaffoldIntent ||
          hasScaffoldIntent(currentMessage) ||
          hasScaffoldIntent(routeSource) ||
          selfContainedCreateBrief ||
          (newProjectContinuation && hasProjectCreationContext(routeSource)))
    );
    const editIntent = Boolean(
      !pendingBriefing &&
        (currentEditOverridesContextScaffold ||
        currentIntake.signals.editIntent ||
        (!newProjectContinuation && sourceIntake.signals.editIntent) ||
        hasEditIntent(currentMessage) ||
        (!newProjectContinuation && hasEditIntent(source)))
    );
    const diagnosticIntent = Boolean(
      !pendingBriefing &&
        (currentIntake.signals.diagnosticIntent ||
          (!newProjectContinuation && sourceIntake.signals.diagnosticIntent))
    );
    const defaultAuthorized = routeIntake.signals.defaultAuthorized || hasDefaultsAuthorization(routeSource, shouldUseDefaultScaffoldConfiguration);
    const explicitRebuild = Boolean(currentIntake.signals.explicitRebuild || (!currentEditOverridesContextScaffold && sourceIntake.signals.explicitRebuild));
    const complexApplication = Boolean(routeIntake.signals.complexApplication || currentIntake.signals.complexApplication);
    const complexBriefSufficient = Boolean(routeIntake.signals.complexBriefSufficient || currentIntake.signals.complexBriefSufficient);
    const requiresComplexBriefing = Boolean(currentIntake.signals.requiresComplexBriefing || routeIntake.signals.requiresComplexBriefing);
    const mcpFreedomAllowed = Boolean(routeIntake.signals.mcpFreedomAllowed || currentIntake.signals.mcpFreedomAllowed);
    const guidedArchitecturePreferred = Boolean(
      routeIntake.signals.guidedArchitecturePreferred ||
        currentIntake.signals.guidedArchitecturePreferred ||
        (complexApplication && (complexBriefSufficient || mcpFreedomAllowed || defaultAuthorized))
    );
    const siteOrAppSurface = routeIntake.signals.siteOrAppSurface || hasSiteOrAppSurface(routeSource);
    const knownProjectStack = routeIntake.signals.knownProjectStack || hasKnownProjectStack(routeSource);
    const domainOrAudience = hasDomainOrAudience(routeSource);
    const briefingCreateRequest = Boolean(
      !pendingBriefing &&
      scaffoldIntent &&
        (siteOrAppSurface || domainOrAudience || defaultAuthorized) &&
        !/\b(nos arquivos?|no arquivo|na pasta|no projeto|na base|dentro dos arquivos?|dentro do projeto)\b/.test(
          normalizeIntentText(currentMessage)
        )
    );
    const searchIntent = Boolean(!pendingBriefing && hasSearchIntent(currentMessage) && !briefingCreateRequest);
    const visualReviewIntent = Boolean(hasVisualReviewIntent(currentMessage) || hasVisualReviewIntent(routeSource));
    const exploratoryConversation = Boolean(
      hasExploratoryConversationSignal(currentMessage) || hasExploratoryConversationSignal(routeSource)
    );
    const deterministicEdit = Boolean(
      !explicitRebuild &&
        !scaffoldIntent &&
        !selfContainedCreateBrief &&
        hasDeterministicEditRequest(routeSource, projectInfo)
    );
    const unsupportedDeterministicVisualPatch = Boolean(
      isUnsupportedBackgroundMediaRequest(routeSource) && !isHeroMediaPatchRequest(routeSource)
    );
    const canUseInitialBlueprint = Boolean(
      ((projectState === 'empty_project' || projectState === 'metadata_only_project') ||
        (projectState === 'existing_project' && explicitRebuild)) &&
        executionIntent === 'init_project' &&
        scaffoldIntent &&
        (!editIntent || explicitRebuild)
    );
    const blueprintPreferred = Boolean(
      sourceIntake.signals.blueprintPreferred ||
        (canUseInitialBlueprint &&
        shouldPreferProjectBlueprint({
          projectInfo,
          userMessage: routeSource,
          attachments,
          executionIntent: 'init_project',
        }))
    );

    return {
      currentMessage,
      sourceMessage: routeSource,
      activeMemorySummary: summarizeActiveMemoryForProduct(activeMemory),
      hasProject,
      projectState,
      executionIntent,
      signals: {
        smallTalk: isGreetingOrSmallTalk(currentMessage),
        affirmativeContinuation: isAffirmativeContinuation(currentMessage),
        ...activeMemorySignals,
        pendingBriefing,
        newProjectContinuation,
        selfContainedCreateBrief,
        scaffoldIntent,
        editIntent,
        diagnosticIntent,
        searchIntent,
        visualReviewIntent,
        exploratoryConversation,
        defaultAuthorized,
        explicitRebuild,
        complexApplication,
        complexBriefSufficient,
        requiresComplexBriefing,
        mcpFreedomAllowed,
        guidedArchitecturePreferred,
        siteOrAppSurface,
        knownProjectStack,
        domainOrAudience,
        deterministicEdit,
        unsupportedDeterministicVisualPatch,
        currentEditOverridesContextScaffold,
        hasNegatedRoutingClauses: Boolean(
          currentIntake.signals.hasNegatedRoutingClauses || sourceIntake.signals.hasNegatedRoutingClauses
        ),
        canUseInitialBlueprint,
        blueprintPreferred,
        intake: {
          action: routeIntake.canonical.action,
          executionIntent: routeIntake.canonical.executionIntent,
          createScore: routeIntake.scores.create,
          editScore: routeIntake.scores.edit,
        },
        hasAttachments: Array.isArray(attachments) && attachments.length > 0,
        hasApplicationFiles: hasApplicationSurfaceFiles(projectInfo),
        hasAnyFiles: hasAnyScannedFiles(projectInfo || {}),
        enoughForInitialCreate:
          (siteOrAppSurface && (knownProjectStack || domainOrAudience || defaultAuthorized)) ||
          guidedArchitecturePreferred,
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
  defaultHasVisualReviewIntent,
  hasExploratoryConversationSignal,
  hasDefaultsAuthorization,
  hasDomainOrAudience,
  hasKnownProjectStack,
  hasNewProjectContinuationSignal,
  hasSiteOrAppSurface,
  isAffirmativeContinuation,
  isGreetingOrSmallTalk,
  isProjectEmpty,
  shouldUseAutonomousIncrementalEdit,
};
