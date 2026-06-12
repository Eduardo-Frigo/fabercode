const {
  hasApplicationSurfaceFiles,
  normalizeIntentText,
} = require('./execution_intent');
const {
  buildActiveMemoryScope,
  validateActiveMemoryForRequest,
} = require('../memory/active_memory_governance_service');

const ORCHESTRATION_CONTEXT_FRAME_SCHEMA_VERSION = 'orchestration-context-frame-v1';

function compactFrameText(value = '', max = 2800) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function normalizeFrameText(value = '') {
  return normalizeIntentText(value);
}

function readActiveMemoryDecision(activeMemory = null) {
  return activeMemory && activeMemory.decision && typeof activeMemory.decision === 'object'
    ? activeMemory.decision
    : {};
}

function buildConversationText(conversationMessages = []) {
  if (!Array.isArray(conversationMessages) || !conversationMessages.length) return '';
  return conversationMessages
    .slice(-10)
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

function hasCreateSurfaceSignal(normalized = '') {
  return /\b(crie|criar|gere|gerar|monte|montar|construa|construir|desenvolva|desenvolver|faca|fazer|site|landing|pagina|app|aplicacao|sistema|projeto|next|react|tailwind)\b/.test(
    normalized
  );
}

function hasBriefDetailSignal(normalized = '') {
  return /\b(hero|header|footer|rodape|secao|secoes|seção|seções|paleta|tipografia|video|imagem|produtos|servicos|serviços|processo|contato|cta|botao|formulario|blog|galeria|portfolio|portfólio|depoimentos|faq|rota|pagina|página|loja|catalogo|catálogo)\b/.test(
    normalized
  );
}

function hasSelfContainedCreateBrief(value = '') {
  const normalized = normalizeFrameText(value);
  if (!normalized) return false;
  return normalized.length >= 260 && hasCreateSurfaceSignal(normalized) && hasBriefDetailSignal(normalized);
}

function referencesConversationBrief(value = '') {
  const normalized = normalizeFrameText(value);
  if (!normalized) return false;
  return /\b(briefing que passei|briefing completo que passei|briefing desta conversa|briefing dessa conversa|nessa conversa|nesta conversa|desta conversa|dessa conversa|que passei nessa conversa|que enviei nessa conversa|pedido que passei|pedido anterior|conversa acima)\b/.test(
    normalized
  );
}

function referencesActiveMemoryStore(value = '') {
  const normalized = normalizeFrameText(value);
  if (!normalized) return false;
  if (rejectsActiveMemoryStore(normalized)) return false;
  return /\b(memoria|memória|memoria ativa|memória ativa|mempalace|rag|cortex|contexto salvo|contexto combinado|usando a memoria|usando a memória|use a memoria|use a memória|usa a memoria|usa a memória)\b/.test(
    normalized
  );
}

function hasEditActionSignal(value = '') {
  const normalized = normalizeFrameText(value);
  if (!normalized) return false;
  return /\b(altere|alterar|edite|editar|corrija|corrigir|ajuste|ajustar|mude|mudar|troque|trocar|insira|inserir|adicione|adicionar|remova|remover|refatore|refatorar|atualize|atualizar|deixe|deixar|coloque|colocar|substitua|substituir|melhore|melhorar)\b/.test(
    normalized
  );
}

function rejectsActiveMemoryStore(value = '') {
  const normalized = normalizeFrameText(value);
  if (!normalized) return false;
  return /\b(use somente esta mensagem|usar somente esta mensagem|somente esta mensagem atual|apenas esta mensagem|fonte de verdade[^.!?\n]*esta mensagem|suprim[aeia]* memoria|suprimir memoria|suprima memoria|suprim[aeia]* memória|suprimir memória|suprima memória|nao usar memoria|não usar memória|sem memoria ativa|sem memória ativa|ignore memoria|ignore memória|ignorar memoria|ignorar memória)\b/.test(
    normalized
  );
}

function isShortContinuation(value = '') {
  const normalized = normalizeFrameText(value);
  if (!normalized || normalized.length > 180) return false;
  return /^(sim|ok|certo|isso|pode|pode sim|pode seguir|segue|seguir|continue|continua|prossiga|finalize|finalizar|vamos seguir|vamos seguir com a composicao modular|vamos seguir com a composição modular|composicao modular|composição modular)(\s|$)/.test(
    normalized
  );
}

function shouldUseConversationForFrame({ userMessage = '', conversationText = '' } = {}) {
  if (!conversationText) return false;
  if (hasSelfContainedCreateBrief(userMessage)) return false;
  const normalized = normalizeFrameText(userMessage);
  if (referencesConversationBrief(userMessage)) return true;
  if (isShortContinuation(userMessage) && hasCreateSurfaceSignal(normalizeFrameText(conversationText))) return true;
  return Boolean(
    hasCreateSurfaceSignal(normalized) &&
      /\b(algo novo|novo projeto|nova base|briefing|pedido|conversa|composicao modular|composição modular)\b/.test(normalized) &&
      hasCreateSurfaceSignal(normalizeFrameText(conversationText))
  );
}

function shouldUseActiveMemoryForFrame({ userMessage = '', activeMemory = null } = {}) {
  if (!activeMemory || typeof activeMemory !== 'object') return false;
  if (hasSelfContainedCreateBrief(userMessage)) return false;
  if (!referencesActiveMemoryStore(userMessage)) return false;
  const decision = readActiveMemoryDecision(activeMemory);
  return Boolean(decision.routeContextText || decision.briefingContextText || activeMemory.current);
}

function shouldUseContextHintForFrame({ userMessage = '', contextHintText = '', projectInfo = null } = {}) {
  if (!contextHintText) return false;
  if (hasSelfContainedCreateBrief(userMessage)) return false;
  if (referencesConversationBrief(userMessage)) return true;
  if (isShortContinuation(userMessage)) return true;
  if (hasApplicationSurfaceFiles(projectInfo || {}) && hasEditActionSignal(userMessage)) return false;
  const normalized = normalizeFrameText(userMessage);
  return Boolean(
    !hasApplicationSurfaceFiles(projectInfo || {}) &&
      hasCreateSurfaceSignal(normalized) &&
      hasCreateSurfaceSignal(normalizeFrameText(contextHintText))
  );
}

function buildContextSourceConfirmation({
  currentMessage = '',
  conversationAllowed = false,
  activeMemory = null,
  activeMemoryEligibility = null,
} = {}) {
  const activeAvailable = Boolean(activeMemory && typeof activeMemory === 'object');
  const referencesMemory = referencesActiveMemoryStore(currentMessage);
  if (rejectsActiveMemoryStore(currentMessage)) {
    return {
      required: false,
      reason: '',
      choices: [],
    };
  }
  if (!activeAvailable || !referencesMemory) {
    return {
      required: false,
      reason: '',
      choices: [],
    };
  }

  if (hasSelfContainedCreateBrief(currentMessage)) {
    return {
      required: true,
      reason: 'current_brief_and_active_memory_requested',
      choices: ['current_message', 'active_memory'],
    };
  }

  if (referencesConversationBrief(currentMessage) && conversationAllowed) {
    return {
      required: true,
      reason: 'conversation_brief_and_active_memory_requested',
      choices: ['conversation_brief', 'active_memory'],
    };
  }

  return {
    required: false,
    reason: '',
    choices: [],
  };
}

function buildActiveMemorySuppressionReason({
  userMessage = '',
  activeMemory = null,
  allowed = false,
  eligibility = null,
} = {}) {
  if (!activeMemory || typeof activeMemory !== 'object') return '';
  if (allowed) return '';
  if (eligibility && eligibility.reason && eligibility.reason !== 'active_memory_valid_for_request') {
    return eligibility.reason;
  }
  if (hasSelfContainedCreateBrief(userMessage)) return 'current_brief_is_self_contained';
  if (referencesConversationBrief(userMessage) && !referencesActiveMemoryStore(userMessage)) {
    return 'request_references_conversation_brief_not_memory_store';
  }
  return 'current_message_does_not_authorize_active_memory';
}

function buildOrchestrationContextFrame({
  projectInfo = null,
  userId = '',
  conversationId = '',
  jobId = '',
  userMessage = '',
  contextHint = null,
  conversationMessages = [],
  activeMemory = null,
  routingSourceForBriefing = '',
  now = () => new Date().toISOString(),
} = {}) {
  const currentMessage = String(userMessage || '').trim();
  const normalizedCurrent = normalizeFrameText(currentMessage);
  const conversationText = buildConversationText(conversationMessages);
  const conversationAllowed = shouldUseConversationForFrame({ userMessage: currentMessage, conversationText });
  const requestScope = buildActiveMemoryScope({
    projectInfo,
    projectId: projectInfo && projectInfo.id ? projectInfo.id : '',
    userId:
      userId ||
      (contextHint && contextHint.userId ? contextHint.userId : ''),
    conversationId:
      conversationId ||
      (contextHint && contextHint.conversationId ? contextHint.conversationId : ''),
    jobId:
      jobId ||
      (contextHint && contextHint.jobId ? contextHint.jobId : ''),
    stage: 'orchestration_context_frame',
  });
  const activeMemoryEligibility = validateActiveMemoryForRequest(activeMemory, requestScope, { now });
  const confirmation = buildContextSourceConfirmation({
    currentMessage,
    conversationAllowed,
    activeMemory,
    activeMemoryEligibility,
  });
  const activeMemoryAllowed =
    !confirmation.required &&
    activeMemoryEligibility.ok &&
    shouldUseActiveMemoryForFrame({ userMessage: currentMessage, activeMemory });
  const activeMemorySuppressionReason = buildActiveMemorySuppressionReason({
    userMessage: currentMessage,
    activeMemory,
    allowed: activeMemoryAllowed,
    eligibility: activeMemoryEligibility,
  });
  const decision = readActiveMemoryDecision(activeMemory);
  const rawContextHintText = [
    contextHint && contextHint.originalUserMessage ? contextHint.originalUserMessage : '',
    contextHint && contextHint.routeExecutionMessage ? contextHint.routeExecutionMessage : '',
    contextHint && contextHint.lastScaffoldPrompt ? contextHint.lastScaffoldPrompt : '',
  ].filter(Boolean).join('\n\n');
  const contextHintText = shouldUseContextHintForFrame({
    userMessage: currentMessage,
    contextHintText: rawContextHintText,
    projectInfo,
  })
    ? rawContextHintText
    : '';
  const briefingContextParts = [
    contextHintText,
    conversationAllowed ? conversationText : '',
    routingSourceForBriefing,
    activeMemoryAllowed ? decision.briefingContextText || '' : '',
  ].filter(Boolean);

  return {
    schemaVersion: ORCHESTRATION_CONTEXT_FRAME_SCHEMA_VERSION,
    current: {
      message: currentMessage,
      normalized: compactFrameText(normalizedCurrent, 1800),
      selfContainedCreateBrief: hasSelfContainedCreateBrief(currentMessage),
      referencesConversationBrief: referencesConversationBrief(currentMessage),
      referencesActiveMemoryStore: referencesActiveMemoryStore(currentMessage),
      shortContinuation: isShortContinuation(currentMessage),
      createSurfaceSignal: hasCreateSurfaceSignal(normalizedCurrent),
      briefDetailSignal: hasBriefDetailSignal(normalizedCurrent),
    },
    conversation: {
      available: Boolean(conversationText),
      allowedForBriefing: conversationAllowed,
      contextText: conversationAllowed ? compactFrameText(conversationText) : '',
    },
    activeMemory: {
      available: Boolean(activeMemory),
      eligibility: activeMemoryEligibility,
      scope: activeMemory && activeMemory.scope ? activeMemory.scope : null,
      validity: activeMemory && activeMemory.validity ? activeMemory.validity : null,
      retrievalReason: activeMemory && activeMemory.retrieval ? activeMemory.retrieval.reason || '' : '',
      citationsCount: activeMemory && Array.isArray(activeMemory.citations) ? activeMemory.citations.length : 0,
      citations: activeMemory && Array.isArray(activeMemory.citations)
        ? activeMemory.citations.slice(0, 8)
        : [],
      provenance: activeMemory && activeMemory.provenance ? {
        schemaVersion: activeMemory.provenance.schemaVersion || '',
        confidence: activeMemory.provenance.confidence || null,
        usedCount: Array.isArray(activeMemory.provenance.used) ? activeMemory.provenance.used.length : 0,
        blockedCount: Array.isArray(activeMemory.provenance.blocked) ? activeMemory.provenance.blocked.length : 0,
        used: Array.isArray(activeMemory.provenance.used) ? activeMemory.provenance.used.slice(0, 8) : [],
        blocked: Array.isArray(activeMemory.provenance.blocked) ? activeMemory.provenance.blocked.slice(0, 8) : [],
      } : null,
      allowedForRouting: activeMemoryAllowed,
      allowedForBriefing: activeMemoryAllowed,
      suppressed: Boolean(activeMemory && !activeMemoryAllowed),
      suppressionReason: activeMemorySuppressionReason,
      routeContextText: activeMemoryAllowed ? compactFrameText(decision.routeContextText || '') : '',
      briefingContextText: activeMemoryAllowed ? compactFrameText(decision.briefingContextText || '') : '',
    },
    confirmation,
    source: {
      contextHintText: compactFrameText(contextHintText),
      routingSourceForBriefing: compactFrameText(routingSourceForBriefing),
      workingBriefContextText: compactFrameText(briefingContextParts.join('\n\n'), 4200),
      precedence: [
        'current_user_message',
        conversationAllowed ? 'conversation_brief' : '',
        activeMemoryAllowed ? 'active_memory' : '',
        'project_files',
      ].filter(Boolean),
    },
  };
}

function scopeActiveMemoryForContextFrame(activeMemory = null, contextFrame = null) {
  if (!activeMemory || typeof activeMemory !== 'object') return null;
  const active = contextFrame && contextFrame.activeMemory ? contextFrame.activeMemory : {};
  if (active.allowedForRouting && active.allowedForBriefing) return activeMemory;

  const decision = readActiveMemoryDecision(activeMemory);
  return {
    ...activeMemory,
    current: {
      ...(activeMemory.current || {}),
      continuationIntent: Boolean(
        (active.allowedForRouting || active.allowedForBriefing) &&
          activeMemory.current &&
          activeMemory.current.continuationIntent
      ),
    },
    decision: {
      ...decision,
      routeContextText: active.allowedForRouting ? decision.routeContextText || '' : '',
      briefingContextText: active.allowedForBriefing ? decision.briefingContextText || '' : '',
    },
    contextFrameSuppressed: Boolean(active.suppressed),
    contextFrameSuppressionReason: active.suppressionReason || '',
  };
}

module.exports = {
  ORCHESTRATION_CONTEXT_FRAME_SCHEMA_VERSION,
  buildContextSourceConfirmation,
  buildOrchestrationContextFrame,
  scopeActiveMemoryForContextFrame,
};
