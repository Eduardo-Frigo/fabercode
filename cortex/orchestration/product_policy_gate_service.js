const {
  hasCortexPolicyOwnedBuildMode,
  resolveCortexBuildModeRoutePayload,
} = require('./cortex_build_mode_handlers_service');

const ALLOWED_DECISIONS = new Set(['chat', 'clarify', 'execute']);
const ALLOWED_CAPABILITIES = new Set([
  'conversation',
  'create_project',
  'edit_project',
  'search_project',
  'diagnose_project',
  'project_tools',
]);

function buildProductRoute({
  decision,
  response,
  executionMessage = '',
  confidence = 0.9,
  reason,
  provider = 'deterministic',
  capability = 'conversation',
  mode = 'deterministic',
  executionIntent = '',
  projectState = '',
  aiRoute = null,
  workingBrief = null,
  buildModeRoute = null,
  extraMeta = {},
} = {}) {
  const routeWorkingBrief =
    workingBrief || (buildModeRoute && typeof buildModeRoute === 'object' ? buildModeRoute.workingBrief : null) || null;
  const routeBuildMode = buildModeRoute && typeof buildModeRoute === 'object'
    ? (() => {
        const cleanBuildModeRoute = { ...buildModeRoute };
        delete cleanBuildModeRoute.workingBrief;
        return cleanBuildModeRoute;
      })()
    : null;

  return {
    ok: true,
    schemaVersion: 'product-route-v1',
    decision,
    response,
    executionMessage: decision === 'execute' ? executionMessage : '',
    confidence,
    provider,
    productRoute: {
      capability,
      mode,
      executionIntent,
      projectState,
    },
    workingBrief: routeWorkingBrief,
    buildModeRoute: routeBuildMode,
    aiRoute,
    meta: {
      planner: 'product_orchestrator',
      reason,
      provider,
      capability,
      mode,
      executionIntent,
      projectState,
      ...extraMeta,
    },
  };
}

function buildPersonaDelegation({ reason = 'requires_persona_semantics', sourceMessage = '', provider = 'deterministic' } = {}) {
  return {
    ok: true,
    decision: 'chat',
    response: '',
    executionMessage: '',
    confidence: 0.4,
    delegateToPersona: true,
    meta: {
      planner: 'product_orchestrator',
      reason,
      provider,
      requiresPersona: true,
      sourcePreview: String(sourceMessage || '').slice(0, 360),
    },
  };
}

function normalizeProductCapability(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (ALLOWED_CAPABILITIES.has(raw)) return raw;
  if (/create|scaffold|init|novo|nova|criar|gerar/.test(raw)) return 'create_project';
  if (/edit|alter|patch|corrig|fix|refactor/.test(raw)) return 'edit_project';
  if (/search|find|buscar|procurar|localizar/.test(raw)) return 'search_project';
  if (/diagnos|analis|erro|build|preview/.test(raw)) return 'diagnose_project';
  if (/terminal|git|preview|runner|tool/.test(raw)) return 'project_tools';
  return 'conversation';
}

function normalizeAiProductRoute(rawRoute, fallbackMessage = '') {
  if (!rawRoute || typeof rawRoute !== 'object' || rawRoute.providerUnavailable) return null;
  const route = rawRoute.route && typeof rawRoute.route === 'object' ? rawRoute.route : rawRoute;
  const decision = String(route.decision || route.intent || route.action || '').trim().toLowerCase();
  if (!ALLOWED_DECISIONS.has(decision)) return null;

  const confidence = Number.isFinite(Number(route.confidence)) ? Number(route.confidence) : 0.7;
  return {
    decision,
    response: String(route.response || route.message || '').trim(),
    executionMessage: String(route.executionMessage || route.execution_request || route.task || fallbackMessage || '').trim(),
    capability: normalizeProductCapability(route.capability || route.tool || route.domain || ''),
    mode: String(route.mode || route.executionMode || route.path || '').trim().toLowerCase(),
    executionIntent: String(route.executionIntent || '').trim().toLowerCase(),
    confidence,
    missingSlots: Array.isArray(route.missingSlots) ? route.missingSlots.filter(Boolean).map(String) : [],
    raw: rawRoute,
  };
}

function buildDeterministicFallbackRoute({ facts, provider = 'deterministic' } = {}) {
  const signals = facts && facts.signals ? facts.signals : {};
  const sourceMessage = facts ? facts.sourceMessage || facts.currentMessage || '' : '';
  const projectState = facts ? facts.projectState || '' : '';
  const executionIntent = facts ? facts.executionIntent || '' : '';
  const workingBrief = facts && facts.workingBrief ? facts.workingBrief : null;
  const buildModeRoute = facts && facts.buildModeRoute ? facts.buildModeRoute : null;
  const routedExecutionMessage =
    workingBrief && workingBrief.executionPrompt ? workingBrief.executionPrompt : sourceMessage;
  const buildRoute = (payload = {}) => buildProductRoute({ workingBrief, buildModeRoute, ...payload });
  const canCreateInitialProject = projectState === 'empty_project' || projectState === 'metadata_only_project';

  if (!facts || !facts.currentMessage || (signals.smallTalk && !signals.scaffoldIntent && !signals.editIntent && !signals.searchIntent)) {
    return buildRoute({
      decision: 'chat',
      response: 'Oi. Estou por aqui. Me conta no seu ritmo o que você quer criar, ajustar ou explorar.',
      confidence: 0.98,
      reason: 'small_talk_no_execution',
      provider,
      capability: 'conversation',
      mode: 'conversation_only',
      executionIntent: 'conversation',
      projectState,
    });
  }

  if (!facts.hasProject) {
    if (signals.scaffoldIntent || signals.editIntent || signals.searchIntent) {
      return buildRoute({
        decision: 'clarify',
        response:
          'Para criar, editar ou procurar arquivos, selecione um projeto na lateral esquerda ou crie um novo projeto primeiro.',
        confidence: 0.98,
        reason: 'missing_project_for_work',
        provider,
        capability: signals.scaffoldIntent ? 'create_project' : signals.editIntent ? 'edit_project' : 'search_project',
        mode: 'requires_project_selection',
        executionIntent,
        projectState,
      });
    }
    return buildRoute({
      decision: 'chat',
      response:
        'Posso conversar aqui, mas para executar trabalho preciso de um projeto selecionado ou criado na lateral esquerda.',
      confidence: 0.94,
      reason: 'conversation_without_project',
      provider,
      capability: 'conversation',
      mode: 'conversation_only',
      executionIntent,
      projectState,
    });
  }

  if (
    signals.exploratoryConversation &&
    !signals.scaffoldIntent &&
    !signals.editIntent &&
    !signals.searchIntent &&
    !signals.deterministicEdit
  ) {
    return buildRoute({
      decision: 'chat',
      response:
        'Tudo bem. Posso explorar caminhos com você sem alterar arquivos agora. Quando quiser, seguimos para revisar o projeto atual, planejar uma direção ou executar uma mudança concreta.',
      confidence: 0.96,
      reason: 'exploratory_conversation_no_execution',
      provider,
      capability: 'conversation',
      mode: 'exploratory_conversation',
      executionIntent: 'conversation',
      projectState,
    });
  }

  if (signals.searchIntent) {
    return buildRoute({
      decision: 'execute',
      response: 'Entendi. Vou procurar esse texto nos arquivos do projeto e mostrar os pontos encontrados.',
      executionMessage: facts.currentMessage || sourceMessage,
      confidence: 0.97,
      reason: 'search_project_intent',
      provider,
      capability: 'search_project',
      mode: 'local_search',
      executionIntent,
      projectState,
    });
  }

  if (signals.deterministicEdit) {
    return buildRoute({
      decision: 'execute',
      response: 'Entendi. Vou aplicar a rota determinística de edição e preparar a alteração para sua confirmação.',
      executionMessage: facts.currentMessage || sourceMessage,
      confidence: 0.99,
      reason: 'deterministic_edit_intent',
      provider,
      capability: 'edit_project',
      mode: 'deterministic_patch',
      executionIntent: 'edit_project',
      projectState,
    });
  }

  if (buildModeRoute && buildModeRoute.mode === 'blocked_harmful') {
    return buildRoute({
      decision: 'clarify',
      response:
        'Detectei um possível desenvolvimento nocivo e vou interromper esta rota. Se houve interpretação incorreta, reformule o objetivo legítimo do projeto para revisão.',
      confidence: Math.max(Number(buildModeRoute.confidence || 0), 0.96),
      reason: 'policy_gate_harmful_block',
      provider,
      capability: 'conversation',
      mode: 'blocked_harmful',
      executionIntent: 'blocked',
      projectState,
      extraMeta: {
        buildMode: buildModeRoute.mode,
        forceReviewAllowed: Boolean(buildModeRoute.routeHints && buildModeRoute.routeHints.forceReviewAllowed),
      },
    });
  }

  const cortexModePayload = resolveCortexBuildModeRoutePayload({
    buildModeRoute,
    provider,
    projectState,
    routedExecutionMessage,
    signals,
  });
  if (cortexModePayload) return buildRoute(cortexModePayload);

  if (
    buildModeRoute &&
    (buildModeRoute.mode === 'existing_project_edit' || buildModeRoute.mode === 'new_project_area') &&
    signals.hasApplicationFiles
  ) {
    return buildRoute({
      decision: 'execute',
      response:
        buildModeRoute.mode === 'new_project_area'
          ? 'Entendi. Vou analisar a estrutura atual e preparar a nova área sem recriar o projeto inteiro.'
          : 'Entendi. Vou analisar os arquivos atuais e preparar uma edição incremental segura.',
      executionMessage: routedExecutionMessage,
      confidence: Math.max(Number(buildModeRoute.confidence || 0), 0.88),
      reason: buildModeRoute.mode === 'new_project_area' ? 'build_mode_new_project_area' : 'build_mode_existing_project_edit',
      provider,
      capability: 'edit_project',
      mode: buildModeRoute.mode,
      executionIntent: 'edit_project',
      projectState,
      extraMeta: {
        buildMode: buildModeRoute.mode,
        workingBriefDomain: workingBrief && workingBrief.product ? workingBrief.product.domain : '',
        workingBriefStack: workingBrief && workingBrief.product ? workingBrief.product.stack : '',
      },
    });
  }

  if ((signals.scaffoldIntent || executionIntent === 'init_project') && canCreateInitialProject) {
    if (buildModeRoute && buildModeRoute.mode === 'adaptive_blueprint') {
      return buildRoute({
        decision: 'execute',
        response:
          'Entendi. Vou consolidar o pedido em um brief de trabalho e gerar uma primeira versão adaptativa com placeholders, mídia e ícones coerentes.',
        executionMessage: routedExecutionMessage,
        confidence: Math.max(Number(buildModeRoute.confidence || 0), 0.9),
        reason: 'adaptive_blueprint_create',
        provider,
        capability: 'create_project',
        mode: 'adaptive_blueprint',
        executionIntent: 'init_project',
        projectState,
        extraMeta: {
          buildMode: buildModeRoute.mode,
          workingBriefDomain: workingBrief && workingBrief.product ? workingBrief.product.domain : '',
          workingBriefStack: workingBrief && workingBrief.product ? workingBrief.product.stack : '',
        },
      });
    }

    if (signals.blueprintPreferred && signals.canUseInitialBlueprint) {
      return buildRoute({
        decision: 'execute',
        response:
          'Entendi. Vou usar o blueprint do Faber Code para montar uma primeira versão coerente, com validação antes de aplicar arquivos.',
        executionMessage: routedExecutionMessage,
        confidence: 0.98,
        reason: 'faber_blueprint_create',
        provider,
        capability: 'create_project',
        mode: 'faber_blueprint',
        executionIntent: 'init_project',
        projectState,
        extraMeta: {
          buildMode: buildModeRoute && buildModeRoute.mode ? buildModeRoute.mode : '',
        },
      });
    }

    if (buildModeRoute && buildModeRoute.mode === 'guided_app_architecture') {
      return buildRoute({
        decision: 'execute',
        response:
          'Entendi. Vou preparar a arquitetura inicial guiada antes de escrever arquivos, respeitando stack, dependências e validação.',
        executionMessage: routedExecutionMessage,
        confidence: Math.max(Number(buildModeRoute.confidence || 0), 0.86),
        reason: 'guided_app_architecture_create',
        provider,
        capability: 'create_project',
        mode: 'guided_app_architecture',
        executionIntent: 'init_project',
        projectState,
        extraMeta: {
          buildMode: buildModeRoute.mode,
        },
      });
    }

    if (projectState === 'empty_project' && signals.enoughForInitialCreate) {
      return buildRoute({
        decision: 'execute',
        response:
          'Entendi. Vou preparar a criação inicial do projeto com base no pedido e pedir confirmação antes de escrever arquivos.',
        executionMessage: routedExecutionMessage,
        confidence: 0.94,
        reason: 'scaffold_create_ready',
        provider,
        capability: 'create_project',
        mode: 'cortex_scaffold',
        executionIntent: 'init_project',
        projectState,
      });
    }

    return buildRoute({
      decision: 'clarify',
      response:
        'Posso criar o projeto, mas preciso de um ponto de partida: stack desejada, tipo de produto ou autorização para usar o blueprint padrão com placeholders.',
      confidence: 0.92,
      reason: 'scaffold_needs_product_start',
      provider,
      capability: 'create_project',
      mode: 'deterministic_clarification',
      executionIntent: 'init_project',
      projectState,
    });
  }

  if (signals.editIntent && signals.hasApplicationFiles) {
    return buildRoute({
      decision: 'execute',
      response: 'Entendi. Vou analisar os arquivos atuais e preparar uma edição incremental segura.',
      executionMessage: facts.currentMessage || sourceMessage,
      confidence: 0.95,
      reason: 'edit_existing_project',
      provider,
      capability: 'edit_project',
      mode: 'cortex_incremental_edit',
      executionIntent: 'edit_project',
      projectState,
    });
  }

  if (signals.editIntent && !signals.hasApplicationFiles) {
    return buildRoute({
      decision: 'clarify',
      response:
        'O projeto selecionado ainda não tem arquivos de aplicação carregados. Crie uma base inicial ou reabra a pasta antes de pedir uma edição.',
      confidence: 0.92,
      reason: 'edit_without_application_files',
      provider,
      capability: 'edit_project',
      mode: 'requires_project_files',
      executionIntent: 'edit_project',
      projectState,
    });
  }

  return buildPersonaDelegation({ reason: 'requires_persona_semantics', sourceMessage, provider });
}

function createProductPolicyGateService() {
  function applyProductPolicyGate({ aiRoute = null, facts = null, provider = 'deterministic' } = {}) {
    const fallbackRoute = buildDeterministicFallbackRoute({ facts, provider });
    const normalizedAiRoute = normalizeAiProductRoute(aiRoute, facts ? facts.sourceMessage : '');
    const signals = facts && facts.signals ? facts.signals : {};
    const sourceMessage = facts ? facts.sourceMessage || facts.currentMessage || '' : '';
    const projectState = facts ? facts.projectState || '' : '';
    const canCreateInitialProject = projectState === 'empty_project' || projectState === 'metadata_only_project';
    const workingBrief = facts && facts.workingBrief ? facts.workingBrief : null;
    const buildModeRoute = facts && facts.buildModeRoute ? facts.buildModeRoute : null;
    const routedExecutionMessage =
      workingBrief && workingBrief.executionPrompt ? workingBrief.executionPrompt : sourceMessage;
    const buildRoute = (payload = {}) => buildProductRoute({ workingBrief, buildModeRoute, ...payload });

    if (!normalizedAiRoute) return fallbackRoute;

    if (!facts || !facts.hasProject) {
      if (normalizedAiRoute.decision === 'execute') {
        return buildRoute({
          decision: 'clarify',
          response:
            'Para executar esse pedido, selecione ou crie um projeto primeiro. Depois eu consigo rotear a criação, edição ou ferramenta correta.',
          confidence: 0.99,
          reason: 'policy_gate_missing_project',
          provider,
          capability: normalizedAiRoute.capability,
          mode: 'requires_project_selection',
          executionIntent: normalizedAiRoute.executionIntent || (facts ? facts.executionIntent : ''),
          projectState,
          aiRoute: normalizedAiRoute.raw,
        });
      }
      return buildRoute({
        decision: normalizedAiRoute.decision,
        response: normalizedAiRoute.response || fallbackRoute.response,
        confidence: normalizedAiRoute.confidence,
        reason: 'ai_product_route_accepted',
        provider,
        capability: normalizedAiRoute.capability,
        mode: normalizedAiRoute.mode || 'ai_router',
        executionIntent: normalizedAiRoute.executionIntent || (facts ? facts.executionIntent : ''),
        projectState,
        aiRoute: normalizedAiRoute.raw,
      });
    }

    if (
      signals.exploratoryConversation &&
      !signals.scaffoldIntent &&
      !signals.editIntent &&
      !signals.searchIntent &&
      !signals.deterministicEdit
    ) {
      return {
        ...fallbackRoute,
        aiRoute: normalizedAiRoute.raw,
        meta: {
          ...fallbackRoute.meta,
          aiRouterReason: 'exploratory_conversation_overrides_ai_route',
        },
      };
    }

    if (signals.searchIntent || normalizedAiRoute.capability === 'search_project') {
      return buildRoute({
        decision: 'execute',
        response: normalizedAiRoute.response || fallbackRoute.response,
        executionMessage: normalizedAiRoute.executionMessage || sourceMessage,
        confidence: Math.max(normalizedAiRoute.confidence, 0.9),
        reason: 'policy_gate_search_project',
        provider,
        capability: 'search_project',
        mode: 'local_search',
        executionIntent: 'search_project',
        projectState,
        aiRoute: normalizedAiRoute.raw,
      });
    }

    if (signals.deterministicEdit) {
      return {
        ...fallbackRoute,
        aiRoute: normalizedAiRoute.raw,
        meta: {
          ...fallbackRoute.meta,
          aiRouterReason: 'deterministic_edit_overrides_ai_route',
        },
      };
    }

    if (buildModeRoute && buildModeRoute.mode === 'blocked_harmful') {
      return {
        ...fallbackRoute,
        aiRoute: normalizedAiRoute.raw,
        meta: {
          ...fallbackRoute.meta,
          aiRouterReason: 'build_mode_safety_overrides_ai_route',
        },
      };
    }

    if (buildModeRoute && hasCortexPolicyOwnedBuildMode(buildModeRoute.mode)) {
      return {
        ...fallbackRoute,
        aiRoute: normalizedAiRoute.raw,
        meta: {
          ...fallbackRoute.meta,
          aiRouterReason: 'build_mode_execution_overrides_ai_route',
        },
      };
    }

    if (
      buildModeRoute &&
      (buildModeRoute.mode === 'existing_project_edit' || buildModeRoute.mode === 'new_project_area') &&
      signals.hasApplicationFiles &&
      !(normalizedAiRoute.decision === 'execute' && normalizedAiRoute.capability === 'edit_project')
    ) {
      return {
        ...fallbackRoute,
        aiRoute: normalizedAiRoute.raw,
        meta: {
          ...fallbackRoute.meta,
          aiRouterReason: 'build_mode_existing_project_overrides_ai_route',
        },
      };
    }

    if (
      buildModeRoute &&
      buildModeRoute.mode === 'adaptive_blueprint' &&
      canCreateInitialProject &&
      !signals.hasApplicationFiles
    ) {
      return buildRoute({
        decision: 'execute',
        response:
          normalizedAiRoute.response ||
          'Entendi. Vou consolidar o pedido em um brief de trabalho e gerar uma primeira versão adaptativa com placeholders, mídia e ícones coerentes.',
        executionMessage: routedExecutionMessage || normalizedAiRoute.executionMessage,
        confidence: Math.max(normalizedAiRoute.confidence, Number(buildModeRoute.confidence || 0), 0.9),
        reason: 'policy_gate_adaptive_blueprint',
        provider,
        capability: 'create_project',
        mode: 'adaptive_blueprint',
        executionIntent: 'init_project',
        projectState,
        aiRoute: normalizedAiRoute.raw,
        extraMeta: {
          buildMode: buildModeRoute.mode,
          workingBriefDomain: workingBrief && workingBrief.product ? workingBrief.product.domain : '',
          workingBriefStack: workingBrief && workingBrief.product ? workingBrief.product.stack : '',
        },
      });
    }

    if (signals.blueprintPreferred) {
      return buildRoute({
        decision: 'execute',
        response:
          normalizedAiRoute.response ||
          'Entendi. Vou usar o blueprint do Faber Code para montar uma primeira versão coerente, com validação antes de aplicar arquivos.',
        executionMessage: routedExecutionMessage || normalizedAiRoute.executionMessage,
        confidence: Math.max(normalizedAiRoute.confidence, 0.96),
        reason: 'policy_gate_faber_blueprint',
        provider,
        capability: 'create_project',
        mode: 'faber_blueprint',
        executionIntent: 'init_project',
        projectState,
        aiRoute: normalizedAiRoute.raw,
      });
    }

    if (normalizedAiRoute.decision === 'execute' && normalizedAiRoute.capability === 'create_project') {
      if (canCreateInitialProject && signals.enoughForInitialCreate) {
        return buildRoute({
          decision: 'execute',
          response: normalizedAiRoute.response || fallbackRoute.response,
          executionMessage: normalizedAiRoute.executionMessage || routedExecutionMessage,
          confidence: normalizedAiRoute.confidence,
          reason: 'ai_product_create_accepted',
          provider,
          capability: 'create_project',
          mode: normalizedAiRoute.mode || 'cortex_scaffold',
          executionIntent: 'init_project',
          projectState,
          aiRoute: normalizedAiRoute.raw,
        });
      }
      return buildRoute({
        decision: 'clarify',
        response:
          'Antes de criar uma nova base neste projeto, preciso confirmar se você quer gerar um projeto novo ou editar a estrutura atual.',
        confidence: 0.93,
        reason: 'policy_gate_create_conflict',
        provider,
        capability: 'create_project',
        mode: 'requires_create_confirmation',
        executionIntent: 'init_project',
        projectState,
        aiRoute: normalizedAiRoute.raw,
      });
    }

    if (normalizedAiRoute.decision === 'execute' && normalizedAiRoute.capability === 'edit_project') {
      if (signals.hasApplicationFiles) {
        return buildRoute({
          decision: 'execute',
          response: normalizedAiRoute.response || fallbackRoute.response,
          executionMessage: normalizedAiRoute.executionMessage || sourceMessage,
          confidence: normalizedAiRoute.confidence,
          reason: 'ai_product_edit_accepted',
          provider,
          capability: 'edit_project',
          mode: normalizedAiRoute.mode || 'cortex_incremental_edit',
          executionIntent: 'edit_project',
          projectState,
          aiRoute: normalizedAiRoute.raw,
        });
      }
      return buildRoute({
        decision: 'clarify',
        response:
          'O projeto selecionado ainda não tem arquivos de aplicação para editar. Posso criar uma base inicial ou você pode reabrir a pasta correta.',
        confidence: 0.94,
        reason: 'policy_gate_edit_without_files',
        provider,
        capability: 'edit_project',
        mode: 'requires_project_files',
        executionIntent: 'edit_project',
        projectState,
        aiRoute: normalizedAiRoute.raw,
      });
    }

    if (normalizedAiRoute.decision === 'execute' && normalizedAiRoute.confidence < 0.72) {
      return buildRoute({
        decision: 'clarify',
        response:
          normalizedAiRoute.response ||
          'Consigo ajudar, mas preciso confirmar se você quer criar, editar, diagnosticar ou usar uma ferramenta do projeto.',
        confidence: normalizedAiRoute.confidence,
        reason: 'policy_gate_low_confidence',
        provider,
        capability: normalizedAiRoute.capability,
        mode: 'requires_intent_confirmation',
        executionIntent: normalizedAiRoute.executionIntent || (facts ? facts.executionIntent : ''),
        projectState,
        aiRoute: normalizedAiRoute.raw,
      });
    }

    return buildRoute({
      decision: normalizedAiRoute.decision,
      response: normalizedAiRoute.response || fallbackRoute.response,
      executionMessage: normalizedAiRoute.executionMessage || sourceMessage,
      confidence: normalizedAiRoute.confidence,
      reason: 'ai_product_route_accepted',
      provider,
      capability: normalizedAiRoute.capability,
      mode: normalizedAiRoute.mode || 'ai_router',
      executionIntent: normalizedAiRoute.executionIntent || (facts ? facts.executionIntent : ''),
      projectState,
      aiRoute: normalizedAiRoute.raw,
    });
  }

  return {
    applyProductPolicyGate,
    buildDeterministicFallbackRoute,
  };
}

module.exports = {
  buildPersonaDelegation,
  buildProductRoute,
  createProductPolicyGateService,
  normalizeAiProductRoute,
  normalizeProductCapability,
};
