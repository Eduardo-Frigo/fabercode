const PRODUCT_ROUTE_MODE_CONTRACT_SCHEMA_VERSION = 'product-route-mode-contract-v1';

const BLUEPRINT_BUILD_MODES = new Set(['initial_blueprint', 'adaptive_blueprint']);
const PRODUCT_BLUEPRINT_ROUTE_MODES = new Set(['faber_blueprint', 'adaptive_blueprint']);
const INITIAL_PROJECT_STATES = new Set(['empty_project', 'metadata_only_project']);

function normalizeContractText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function readBuildMode(buildModeRoute = null) {
  return normalizeContractText(buildModeRoute && buildModeRoute.mode ? buildModeRoute.mode : '');
}

function hasWorkingBriefDomain(workingBrief = null) {
  return Boolean(
    workingBrief &&
      workingBrief.product &&
      typeof workingBrief.product.domain === 'string' &&
      workingBrief.product.domain.trim()
  );
}

function isBlueprintBuildMode(mode = '') {
  return BLUEPRINT_BUILD_MODES.has(normalizeContractText(mode));
}

function isProductBlueprintRouteMode(mode = '') {
  return PRODUCT_BLUEPRINT_ROUTE_MODES.has(normalizeContractText(mode));
}

function resolveBlueprintRouteModeContract({
  buildModeRoute = null,
  signals = {},
  workingBrief = null,
  projectState = '',
} = {}) {
  const buildMode = readBuildMode(buildModeRoute);
  if (!isBlueprintBuildMode(buildMode)) return null;
  if (!INITIAL_PROJECT_STATES.has(normalizeContractText(projectState))) {
    return null;
  }

  if (buildMode === 'adaptive_blueprint') {
    return {
      schemaVersion: PRODUCT_ROUTE_MODE_CONTRACT_SCHEMA_VERSION,
      ok: true,
      buildMode,
      productRouteMode: 'adaptive_blueprint',
      productRouteReason: 'adaptive_blueprint_create',
      productCapability: 'create_project',
      executionIntent: 'init_project',
      contractRole: 'adaptive_generation_strategy',
      requiresFaberBlueprint: false,
      rationale:
        'adaptive_blueprint é usado quando o briefing autoriza placeholders, autonomia alta ou dominio defaultado.',
    };
  }

  const canUseInitialBlueprint = Boolean(signals.canUseInitialBlueprint);
  const enoughForInitialCreate = Boolean(signals.enoughForInitialCreate || hasWorkingBriefDomain(workingBrief));
  if (!canUseInitialBlueprint || !enoughForInitialCreate) return null;

  const preferred = Boolean(signals.blueprintPreferred);
  return {
    schemaVersion: PRODUCT_ROUTE_MODE_CONTRACT_SCHEMA_VERSION,
    ok: true,
    buildMode,
    productRouteMode: 'faber_blueprint',
    productRouteReason: preferred ? 'faber_blueprint_create' : 'initial_blueprint_create',
    productCapability: 'create_project',
    executionIntent: 'init_project',
    contractRole: preferred ? 'faber_blueprint_execution' : 'initial_faber_blueprint_execution',
    requiresFaberBlueprint: true,
    rationale:
      'initial_blueprint é uma estrategia de build para primeira base; a rota de produto executavel deve ser faber_blueprint.',
  };
}

function validateBlueprintRouteModePair({
  productRouteMode = '',
  buildMode = '',
  capability = '',
  decision = '',
} = {}) {
  const normalizedProductMode = normalizeContractText(productRouteMode);
  const normalizedBuildMode = normalizeContractText(buildMode);
  const normalizedCapability = normalizeContractText(capability);
  const normalizedDecision = normalizeContractText(decision);
  const errors = [];

  if (normalizedProductMode === 'initial_blueprint') {
    errors.push('productRoute.mode must not be initial_blueprint; use buildModeRoute.mode=initial_blueprint and productRoute.mode=faber_blueprint');
  }

  if (
    normalizedDecision === 'execute' &&
    normalizedCapability === 'create_project' &&
    normalizedBuildMode === 'initial_blueprint' &&
    normalizedProductMode !== 'faber_blueprint'
  ) {
    errors.push('buildModeRoute.mode=initial_blueprint requires productRoute.mode=faber_blueprint');
  }

  if (
    normalizedDecision === 'execute' &&
    normalizedCapability === 'create_project' &&
    normalizedBuildMode === 'adaptive_blueprint' &&
    normalizedProductMode !== 'adaptive_blueprint'
  ) {
    errors.push('buildModeRoute.mode=adaptive_blueprint requires productRoute.mode=adaptive_blueprint');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  PRODUCT_ROUTE_MODE_CONTRACT_SCHEMA_VERSION,
  isBlueprintBuildMode,
  isProductBlueprintRouteMode,
  resolveBlueprintRouteModeContract,
  validateBlueprintRouteModePair,
};
