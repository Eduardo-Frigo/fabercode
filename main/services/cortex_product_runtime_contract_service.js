function resolveCortexProductRouteDecisionFromContextHint(contextHint = {}) {
  if (!contextHint || typeof contextHint !== 'object') return {};
  if (contextHint.productRouteDecision && typeof contextHint.productRouteDecision === 'object') {
    return contextHint.productRouteDecision;
  }
  if (
    contextHint.personaRouteDecision &&
    typeof contextHint.personaRouteDecision === 'object' &&
    contextHint.personaRouteDecision.meta &&
    contextHint.personaRouteDecision.meta.planner === 'product_orchestrator'
  ) {
    return contextHint.personaRouteDecision;
  }
  return {};
}

function resolvePersonaWorkingBriefFromProductRoute(routeDecision = {}) {
  if (!routeDecision || typeof routeDecision !== 'object') return null;
  if (routeDecision.workingBrief && typeof routeDecision.workingBrief === 'object') return routeDecision.workingBrief;
  if (
    routeDecision.buildModeRoute &&
    typeof routeDecision.buildModeRoute === 'object' &&
    routeDecision.buildModeRoute.workingBrief &&
    typeof routeDecision.buildModeRoute.workingBrief === 'object'
  ) {
    return routeDecision.buildModeRoute.workingBrief;
  }
  return null;
}

function resolveCortexBuildModeRouteFromProductRoute(routeDecision = {}) {
  if (!routeDecision || typeof routeDecision !== 'object') return null;
  return routeDecision.buildModeRoute && typeof routeDecision.buildModeRoute === 'object'
    ? routeDecision.buildModeRoute
    : null;
}

function buildCortexPexelsContractFromPersonaBrief(workingBrief = null) {
  if (!workingBrief || typeof workingBrief !== 'object') return {};
  const product = workingBrief.product && typeof workingBrief.product === 'object' ? workingBrief.product : {};
  const style = workingBrief.style && typeof workingBrief.style === 'object' ? workingBrief.style : {};
  return {
    domain: product.domain || '',
    stack: product.stack || '',
    palette: style.palette || {},
  };
}

function resolveCortexProductRuntimeContract(contextHint = {}) {
  const routeDecision = resolveCortexProductRouteDecisionFromContextHint(contextHint);
  const workingBrief = resolvePersonaWorkingBriefFromProductRoute(routeDecision);
  const buildModeRoute = resolveCortexBuildModeRouteFromProductRoute(routeDecision);
  return {
    routeDecision,
    workingBrief,
    buildModeRoute,
  };
}

module.exports = {
  buildCortexPexelsContractFromPersonaBrief,
  resolveCortexBuildModeRouteFromProductRoute,
  resolveCortexProductRouteDecisionFromContextHint,
  resolveCortexProductRuntimeContract,
  resolvePersonaWorkingBriefFromProductRoute,
};
