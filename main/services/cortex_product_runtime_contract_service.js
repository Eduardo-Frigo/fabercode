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

function normalizeRuntimeRouteMode(value = '') {
  return String(value || '').trim().toLowerCase();
}

function resolveRuntimeLocalBlueprintPolicy({
  routeMode = '',
  buildModeRoute = null,
  explicitRebuild = false,
  preferLocalBlueprint = false,
  fallbackLocalBlueprint = false,
} = {}) {
  const normalizedRouteMode = normalizeRuntimeRouteMode(routeMode);
  const buildModeName = normalizeRuntimeRouteMode(buildModeRoute && buildModeRoute.mode);
  const localBlueprintModes = new Set(['adaptive_blueprint', 'faber_blueprint', 'initial_blueprint']);
  const guidedAppArchitecture =
    normalizedRouteMode === 'guided_app_architecture' ||
    buildModeName === 'guided_app_architecture';
  const routeSupportsLocalBlueprint = Boolean(
    !guidedAppArchitecture &&
      (localBlueprintModes.has(normalizedRouteMode) || localBlueprintModes.has(buildModeName))
  );
  const routeAllowsBlueprint = Boolean(
    !guidedAppArchitecture &&
      (routeSupportsLocalBlueprint || normalizedRouteMode === 'cortex_scaffold')
  );
  const explicitRebuildAllowsLocalBlueprint = Boolean(
    !guidedAppArchitecture &&
      explicitRebuild &&
      (routeSupportsLocalBlueprint || preferLocalBlueprint || fallbackLocalBlueprint)
  );

  return {
    routeMode: normalizedRouteMode,
    buildModeName,
    guidedAppArchitecture,
    routeSupportsLocalBlueprint,
    routeAllowsBlueprint,
    explicitRebuildAllowsLocalBlueprint,
  };
}

function hasExplicitRuntimeRepairIntent(value = '') {
  const normalized = normalizeRuntimeRouteMode(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!normalized) return false;
  const diagnosticQuestion =
    /\b(o que|como|qual|quais)\b/.test(normalized) &&
    /\b(corrigir|corrijo|ajustar|consertar|resolver|necessario|necessaria|precisa|falta)\b/.test(normalized) &&
    !/\b(corrija|conserte|arrume|repare|resolva|aplique|implemente|remova|reescreva|substitua|altere|ajuste|edite|troque|adicione|faca|faça|execute)\b/.test(normalized);
  if (diagnosticQuestion) return false;
  return /\b(corrija|corrigir|conserte|consertar|arrume|arrumar|repare|reparar|resolva|resolver|aplique|aplicar|implemente|implementar|remova|remover|reescreva|reescrever|substitua|substituir|altere|alterar|ajuste|ajustar|edite|editar|troque|trocar|adicione|adicionar|continue a correcao|faca a correcao|faça a correcao|edicao pontual|edição pontual|fix)\b/.test(
    normalized
  );
}

function shouldTreatRuntimeRequestAsDiagnostic({
  executionIntent = '',
  userMessage = '',
  currentDiagnosticIntent = false,
  effectiveDiagnosticIntent = false,
  contextDiagnosticIntent = false,
  routeCapability = '',
} = {}) {
  const normalizedExecutionIntent = normalizeRuntimeRouteMode(executionIntent);
  const normalizedCapability = normalizeRuntimeRouteMode(routeCapability);
  const explicitRepairIntent = hasExplicitRuntimeRepairIntent(userMessage);

  if (explicitRepairIntent && normalizedExecutionIntent !== 'init_project') {
    return false;
  }

  if (normalizedExecutionIntent === 'diagnose_project' || normalizedCapability === 'diagnose_project') {
    return true;
  }
  if (normalizedExecutionIntent === 'init_project') {
    return false;
  }

  return Boolean(currentDiagnosticIntent || effectiveDiagnosticIntent || contextDiagnosticIntent);
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
  hasExplicitRuntimeRepairIntent,
  resolveRuntimeLocalBlueprintPolicy,
  shouldTreatRuntimeRequestAsDiagnostic,
  resolveCortexBuildModeRouteFromProductRoute,
  resolveCortexProductRouteDecisionFromContextHint,
  resolveCortexProductRuntimeContract,
  resolvePersonaWorkingBriefFromProductRoute,
};
