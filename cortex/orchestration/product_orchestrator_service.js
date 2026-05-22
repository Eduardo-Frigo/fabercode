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

function shouldRequestAiProductRoute({ productFacts = {}, buildModeRoute = null } = {}) {
  const signals = productFacts && productFacts.signals ? productFacts.signals : {};
  if (signals.smallTalk) return false;
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
  } = {}) {
    const provider = getSelectedAiProvider() || 'deterministic';
    const productContract = contractService.buildCapabilityContract();
    const productFacts = contractService.buildProductFacts({
      projectInfo,
      userMessage,
      attachments,
      contextHint,
      conversationMessages,
    });
    const workingBrief = workingBriefService.buildWorkingBrief({
      projectInfo,
      userMessage: productFacts.sourceMessage || userMessage || '',
      attachments,
      contextText: contextHint && contextHint.originalUserMessage ? contextHint.originalUserMessage : '',
      conversationMessages,
    });
    const buildModeRoute = buildModeRouterService.resolveBuildMode({
      workingBrief,
      projectInfo,
      userMessage: productFacts.sourceMessage || userMessage || '',
      attachments,
    });
    productFacts.workingBrief = workingBrief;
    productFacts.buildModeRoute = buildModeRoute;

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
          productContract,
          productFacts,
          workingBrief,
          buildModeRoute,
        });
      } catch (error) {
        aiRoute = {
          ok: false,
          providerUnavailable: true,
          errorMessage: error && error.message ? error.message : String(error || ''),
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
