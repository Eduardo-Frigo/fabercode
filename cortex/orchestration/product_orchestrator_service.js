const {
  buildRoutingSourceMessage,
  createProductContractService,
  defaultHasEditIntent,
  defaultHasScaffoldIntent,
  defaultHasSearchIntent,
  hasDefaultsAuthorization,
  isAffirmativeContinuation,
  isGreetingOrSmallTalk,
} = require('./product_contract_service');
const { createProductPolicyGateService } = require('./product_policy_gate_service');
const { createBuildModeRouterService } = require('./build_mode_router_service');
const { createWorkingBriefService } = require('./working_brief_service');
const {
  buildOrchestrationContextFrame,
  scopeActiveMemoryForContextFrame,
} = require('./orchestration_context_frame_service');
const { scoreProductRoute } = require('./product_route_scoring_service');
const { normalizeProviderFailure } = require('../providers/provider_failure_service');

function shouldRequestAiProductRoute({ productFacts = {}, buildModeRoute = null } = {}) {
  const signals = productFacts && productFacts.signals ? productFacts.signals : {};
  const routeScore = productFacts && productFacts.routeScore ? productFacts.routeScore : null;
  if (signals.smallTalk) return false;
  if (routeScore && routeScore.noExecutionPreferred) return false;
  if (routeScore && routeScore.requiresClarification) return false;
  if (
    signals.searchIntent ||
    signals.deterministicEdit ||
    signals.scaffoldIntent ||
    signals.editIntent ||
    signals.defaultAuthorized ||
    signals.exploratoryConversation
  ) {
    return false;
  }
  const mode = buildModeRoute && buildModeRoute.mode ? String(buildModeRoute.mode) : '';
  return !mode || mode === 'conversation_only';
}

function createProductOrchestratorService(dependencies = {}) {
  const {
    getSelectedAiProvider = () => 'deterministic',
    requestAiProductRouteDecision = null,
  } = dependencies;
  const contractService = createProductContractService(dependencies);
  const policyGateService = createProductPolicyGateService();
  const workingBriefService = createWorkingBriefService();
  const buildModeRouterService = createBuildModeRouterService();

  async function resolveProductRoute({
    projectInfo = null,
    userMessage = '',
    attachments = [],
    contextHint = null,
    conversationMessages = [],
    activeMemory = null,
  } = {}) {
    const provider = getSelectedAiProvider() || 'deterministic';
    const productContract = contractService.buildCapabilityContract();
    const initialContextFrame = buildOrchestrationContextFrame({
      projectInfo,
      userMessage,
      contextHint,
      conversationMessages,
      activeMemory,
    });
    const scopedActiveMemory = scopeActiveMemoryForContextFrame(activeMemory, initialContextFrame);
    const productFacts = contractService.buildProductFacts({
      projectInfo,
      userMessage,
      attachments,
      contextHint,
      conversationMessages,
      activeMemory: scopedActiveMemory,
    });
    const routingSourceForBriefing =
      productFacts.sourceMessage && productFacts.sourceMessage !== userMessage
        ? productFacts.sourceMessage
        : '';
    const contextFrame = buildOrchestrationContextFrame({
      projectInfo,
      userMessage,
      contextHint,
      conversationMessages,
      activeMemory: scopedActiveMemory,
      routingSourceForBriefing,
    });
    const frameScopedActiveMemory = scopeActiveMemoryForContextFrame(scopedActiveMemory, contextFrame);
    const workingBrief = workingBriefService.buildWorkingBrief({
      projectInfo,
      userMessage: userMessage || '',
      attachments,
      contextText: contextFrame.source.workingBriefContextText || '',
      conversationMessages,
      activeMemory: frameScopedActiveMemory,
    });
    const buildModeRoute = buildModeRouterService.resolveBuildMode({
      workingBrief,
      projectInfo,
      userMessage: productFacts.sourceMessage || userMessage || '',
      attachments,
    });
    productFacts.contextFrame = contextFrame;
    productFacts.workingBrief = workingBrief;
    productFacts.buildModeRoute = buildModeRoute;
    productFacts.routeScore = scoreProductRoute({
      facts: productFacts,
      workingBrief,
      buildModeRoute,
    });

    let aiRoute = null;
    if (
      typeof requestAiProductRouteDecision === 'function' &&
      shouldRequestAiProductRoute({ productFacts, buildModeRoute })
    ) {
      try {
        aiRoute = await requestAiProductRouteDecision({
          projectInfo,
          userMessage: userMessage || '',
          sourceMessage: productFacts.sourceMessage || userMessage || '',
          attachments: attachments || [],
          contextHint: contextHint || null,
          conversationMessages: conversationMessages || [],
          activeMemory: frameScopedActiveMemory,
          productContract,
          productFacts,
          workingBrief,
          buildModeRoute,
        });
      } catch (error) {
        const providerFailure = normalizeProviderFailure(error, provider);
        aiRoute = {
          ok: false,
          providerUnavailable: true,
          provider,
          reason: providerFailure.code,
          errorMessage: providerFailure.technicalMessage,
          providerFailure,
        };
      }
    }

    return policyGateService.applyProductPolicyGate({
      aiRoute,
      facts: productFacts,
      provider,
    });
  }

  return {
    buildCapabilityContract: contractService.buildCapabilityContract,
    buildProductFacts: contractService.buildProductFacts,
    buildWorkingBrief: workingBriefService.buildWorkingBrief,
    resolveBuildMode: buildModeRouterService.resolveBuildMode,
    resolveProductRoute,
  };
}

module.exports = {
  buildRoutingSourceMessage,
  createProductOrchestratorService,
  defaultHasEditIntent,
  defaultHasScaffoldIntent,
  defaultHasSearchIntent,
  hasDefaultsAuthorization,
  isAffirmativeContinuation,
  isGreetingOrSmallTalk,
};
