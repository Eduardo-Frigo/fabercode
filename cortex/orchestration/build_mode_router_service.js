const {
  hasExplicitProjectRebuildIntent,
  stripNegatedIntentClauses,
} = require('./execution_intent');
const { buildWorkingBrief } = require('./working_brief_service');

const BUILD_MODE_ROUTE_SCHEMA_VERSION = 'build-mode-route-v1';

const BUILD_MODES = {
  CONVERSATION_ONLY: 'conversation_only',
  REQUIRES_PROJECT_SELECTION: 'requires_project_selection',
  INITIAL_BLUEPRINT: 'initial_blueprint',
  ADAPTIVE_BLUEPRINT: 'adaptive_blueprint',
  GUIDED_APP_ARCHITECTURE: 'guided_app_architecture',
  EXISTING_PROJECT_EDIT: 'existing_project_edit',
  NEW_PROJECT_AREA: 'new_project_area',
  DESIGN_TO_CODE: 'design_to_code',
  VISUAL_REVIEW: 'visual_review',
  DIAGNOSTIC_REPAIR: 'diagnostic_repair',
  TOOL_ACTION: 'tool_action',
  BLOCKED_HARMFUL: 'blocked_harmful',
  CONTRACT_ESCALATION: 'contract_escalation',
};

function normalizeRouterText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasComplexApplicationSignal(brief = {}) {
  const source = normalizeRouterText(brief.source && brief.source.consolidated);
  const positiveSource = stripNegatedIntentClauses(source);
  if (!positiveSource) return false;
  return /\b(saas|crm|dashboard|painel admin|admin|login|auth|autenticacao|assinatura|pagamento|banco de dados|database|postgres|supabase|api|backend|crud|multiusuario|permissoes|permissao|workspace|kanban|chat em tempo real|realtime)\b/.test(
    positiveSource
  ) || /\b(mrp|bom|boms|bill of materials|manufatura|manufacturing|ordens de producao|ordem de producao|estoque|inventario|inventory|ledger|audit log|rastreabilidade|maquina de estados|estado finito|finite state|fsm|calculos deterministicos|calculo deterministico|modelagem relacional|regras de negocio|necessidades de materiais|necessidade de material|editor visual|canvas|camadas|inspetor de propriedades|arrastar e soltar|drag and drop|undo|redo|exportacao json|app de dados|explorador de dados|csv|busca textual|ordenacao|metricas agregadas|grafico)\b/.test(
    positiveSource
  );
}

function hasDesignReferenceSignal(brief = {}, attachments = []) {
  const source = normalizeRouterText(brief.source && brief.source.consolidated);
  if (/\b(figma|design-to-code|layout anexado|mockup|screenshot|imagem de referencia|referencia visual|arquivo de design)\b/.test(source)) {
    return true;
  }
  return Array.isArray(attachments) && attachments.some((attachment) => {
    const text = normalizeRouterText(`${attachment && attachment.name ? attachment.name : ''} ${attachment && attachment.type ? attachment.type : ''}`);
    return /\b(figma|png|jpg|jpeg|webp|screenshot|mockup|design)\b/.test(text);
  });
}

function hasExplicitContractReviewIntent(value = '') {
  const source = normalizeRouterText(value);
  return /\b(contrato|contract|ledger|suggest_blueprint|blueprint contract|contrato de blueprint|contrato automata|contrato temporario)\b/.test(source) &&
    /\b(antes|previo|previamente|revisar|aprovacao|aprovar|staged|promover|governanca|policy|politica)\b/.test(source);
}

function hasAdaptiveSignals(brief = {}) {
  const intent = brief.intent || {};
  const product = brief.product || {};
  const source = normalizeRouterText(brief.source && brief.source.consolidated);
  const finalBrief =
    intent.contentMode === 'user_final' ||
    Boolean(brief.briefingSpec && brief.briefingSpec.content && brief.briefingSpec.content.finalRequested);
  const placeholderAuthorized =
    intent.autonomy === 'high' ||
    intent.contentMode === 'ai_placeholder' ||
    intent.contentMode === 'placeholder' ||
    Boolean(brief.briefingSpec && brief.briefingSpec.content && brief.briefingSpec.content.placeholderAllowed);
  if (finalBrief && !placeholderAuthorized) return false;
  const explicitPlaceholderSignal =
    /\b(placeholder|placeholders|conteudo provisorio|conteúdo provisório|pode sugerir|voce decide|pode decidir|qualquer coisa|generico|generica)\b/.test(
      source
    );
  return Boolean(
    placeholderAuthorized ||
      product.defaultedDomain ||
      explicitPlaceholderSignal
  );
}

function buildRoute({
  mode,
  capability = 'conversation',
  executionIntent = '',
  confidence = 0.84,
  reason = '',
  requiresQuestion = false,
  requiresConfirmation = true,
  workingBrief = null,
  routeHints = {},
} = {}) {
  const brief = workingBrief || {};
  return {
    schemaVersion: BUILD_MODE_ROUTE_SCHEMA_VERSION,
    mode,
    capability,
    executionIntent,
    confidence,
    reason,
    requiresQuestion,
    requiresConfirmation,
    technicalStrategy: {
      stack: brief.product && brief.product.stack ? brief.product.stack : '',
      domain: brief.product && brief.product.domain ? brief.product.domain : '',
      projectKind: brief.product && brief.product.projectKind ? brief.product.projectKind : '',
      mediaProvider: Array.isArray(brief.mediaIntent) && brief.mediaIntent[0] ? brief.mediaIntent[0].provider : '',
      iconProvider: Array.isArray(brief.iconIntent) && brief.iconIntent[0] ? brief.iconIntent[0].provider : '',
    },
    allowedBlueprint: mode === BUILD_MODES.INITIAL_BLUEPRINT || mode === BUILD_MODES.ADAPTIVE_BLUEPRINT,
    routeHints,
  };
}

function resolveBuildMode({
  workingBrief = null,
  userMessage = '',
  contextText = '',
  workGraph = null,
  projectInfo = null,
  attachments = [],
} = {}) {
  const brief = workingBrief || buildWorkingBrief({
    userMessage,
    contextText,
    workGraph,
    projectInfo,
    attachments,
  });
  const project = brief.project || {};
  const intent = brief.intent || {};
  const action = intent.action || 'chat';
  const currentRebuildSource = userMessage || (brief.source && brief.source.current) || '';
  const explicitRebuild =
    hasExplicitProjectRebuildIntent(currentRebuildSource) ||
    (!project.hasApplicationFiles &&
      hasExplicitProjectRebuildIntent(brief.source && brief.source.consolidated));

  if (brief.safety && brief.safety.policy === 'block') {
    return buildRoute({
      mode: BUILD_MODES.BLOCKED_HARMFUL,
      capability: 'conversation',
      executionIntent: 'blocked',
      confidence: 0.98,
      reason: 'safety_policy_block',
      requiresQuestion: false,
      requiresConfirmation: false,
      workingBrief: brief,
      routeHints: {
        forceReviewAllowed: Boolean(brief.safety.forceReviewAllowed),
      },
    });
  }

  if (
    brief.contractEscalation &&
    brief.contractEscalation.required &&
    action === 'create_project' &&
    hasExplicitContractReviewIntent(currentRebuildSource || (brief.source && brief.source.consolidated) || '')
  ) {
    return buildRoute({
      mode: BUILD_MODES.CONTRACT_ESCALATION,
      capability: 'create_project',
      executionIntent: 'contract_review',
      confidence: 0.96,
      reason: brief.contractEscalation.code || 'briefing_contract_required',
      requiresQuestion: true,
      requiresConfirmation: false,
      workingBrief: brief,
      routeHints: {
        suggestBlueprint: brief.contractEscalation.suggestedContract || null,
        reason: brief.contractEscalation.reason || '',
      },
    });
  }

  if (!project.hasProject && action !== 'chat') {
    return buildRoute({
      mode: BUILD_MODES.REQUIRES_PROJECT_SELECTION,
      capability: action === 'edit_project' ? 'edit_project' : 'create_project',
      executionIntent: action === 'edit_project' ? 'edit_project' : 'init_project',
      confidence: 0.97,
      reason: 'missing_project_for_work',
      requiresQuestion: true,
      requiresConfirmation: false,
      workingBrief: brief,
    });
  }

  if (action === 'chat') {
    return buildRoute({
      mode: BUILD_MODES.CONVERSATION_ONLY,
      capability: 'conversation',
      executionIntent: 'conversation',
      confidence: 0.92,
      reason: 'conversation_without_product_action',
      requiresQuestion: false,
      requiresConfirmation: false,
      workingBrief: brief,
    });
  }

  if (action === 'tool_action') {
    return buildRoute({
      mode: BUILD_MODES.TOOL_ACTION,
      capability: 'project_tools',
      executionIntent: 'tool_action',
      confidence: 0.9,
      reason: 'tool_action_requested',
      requiresQuestion: false,
      workingBrief: brief,
    });
  }

  if (action === 'visual_review') {
    return buildRoute({
      mode: BUILD_MODES.VISUAL_REVIEW,
      capability: 'diagnose_project',
      executionIntent: 'visual_review',
      confidence: 0.92,
      reason: 'visual_review_requested',
      requiresQuestion: false,
      requiresConfirmation: false,
      workingBrief: brief,
      routeHints: {
        noFileChanges: true,
        useAttachmentsAsEvidence: Array.isArray(attachments) && attachments.length > 0,
      },
    });
  }

  if (action === 'diagnostic_repair') {
    return buildRoute({
      mode: BUILD_MODES.DIAGNOSTIC_REPAIR,
      capability: 'diagnose_project',
      executionIntent: 'diagnose_project',
      confidence: 0.9,
      reason: 'diagnostic_or_repair_requested',
      requiresQuestion: false,
      workingBrief: brief,
    });
  }

  if (hasDesignReferenceSignal(brief, attachments)) {
    return buildRoute({
      mode: BUILD_MODES.DESIGN_TO_CODE,
      capability: project.hasApplicationFiles ? 'edit_project' : 'create_project',
      executionIntent: project.hasApplicationFiles ? 'edit_project' : 'init_project',
      confidence: 0.9,
      reason: 'design_reference_present',
      requiresQuestion: false,
      workingBrief: brief,
    });
  }

  if (project.hasApplicationFiles && action === 'new_project_area') {
    return buildRoute({
      mode: BUILD_MODES.NEW_PROJECT_AREA,
      capability: 'edit_project',
      executionIntent: 'edit_project',
      confidence: 0.9,
      reason: 'existing_project_new_area',
      requiresQuestion: false,
      workingBrief: brief,
    });
  }

  if ((project.hasApplicationFiles || (project.hasAnyFiles && action !== 'create_project')) && !(action === 'create_project' && explicitRebuild)) {
    return buildRoute({
      mode: BUILD_MODES.EXISTING_PROJECT_EDIT,
      capability: 'edit_project',
      executionIntent: 'edit_project',
      confidence: 0.88,
      reason: 'existing_project_files_detected',
      requiresQuestion: false,
      workingBrief: brief,
    });
  }

  if (action === 'create_project') {
    if (hasComplexApplicationSignal(brief)) {
      return buildRoute({
        mode: BUILD_MODES.GUIDED_APP_ARCHITECTURE,
        capability: 'create_project',
        executionIntent: 'init_project',
        confidence: 0.86,
        reason: 'complex_application_requires_guided_architecture',
        requiresQuestion: intent.missingSlots && intent.missingSlots.length > 0 && intent.autonomy !== 'high',
        workingBrief: brief,
      });
    }

    if (hasAdaptiveSignals(brief)) {
      return buildRoute({
        mode: BUILD_MODES.ADAPTIVE_BLUEPRINT,
        capability: 'create_project',
        executionIntent: 'init_project',
        confidence: 0.9,
        reason: brief.product && brief.product.defaultedDomain
          ? 'autonomous_default_domain_blueprint'
          : 'style_media_or_placeholder_blueprint',
        requiresQuestion: false,
        workingBrief: brief,
      });
    }

    return buildRoute({
      mode: BUILD_MODES.INITIAL_BLUEPRINT,
      capability: 'create_project',
      executionIntent: 'init_project',
      confidence: 0.82,
      reason: 'simple_initial_project_blueprint',
      requiresQuestion: intent.askBeforePlanning,
      workingBrief: brief,
    });
  }

  return buildRoute({
    mode: BUILD_MODES.CONVERSATION_ONLY,
    capability: 'conversation',
    executionIntent: 'conversation',
    confidence: 0.64,
    reason: 'no_safe_product_route',
    requiresQuestion: true,
    requiresConfirmation: false,
    workingBrief: brief,
  });
}

function createBuildModeRouterService() {
  return {
    resolveBuildMode,
  };
}

module.exports = {
  BUILD_MODE_ROUTE_SCHEMA_VERSION,
  BUILD_MODES,
  createBuildModeRouterService,
  resolveBuildMode,
};
