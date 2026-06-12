const assert = require('assert');

const {
  PRODUCT_ROUTE_MODE_CONTRACT_SCHEMA_VERSION,
  resolveBlueprintRouteModeContract,
  validateBlueprintRouteModePair,
} = require('../cortex/orchestration/product_route_mode_contract_service');

function run() {
  const adaptive = resolveBlueprintRouteModeContract({
    buildModeRoute: { mode: 'adaptive_blueprint', confidence: 0.9 },
    projectState: 'empty_project',
    signals: {
      canUseInitialBlueprint: true,
      enoughForInitialCreate: true,
      blueprintPreferred: true,
    },
    workingBrief: {
      product: { domain: 'legal', stack: 'next-tailwind' },
    },
  });
  assert.strictEqual(adaptive.schemaVersion, PRODUCT_ROUTE_MODE_CONTRACT_SCHEMA_VERSION);
  assert.strictEqual(adaptive.buildMode, 'adaptive_blueprint');
  assert.strictEqual(adaptive.productRouteMode, 'adaptive_blueprint');
  assert.strictEqual(adaptive.productRouteReason, 'adaptive_blueprint_create');
  assert.strictEqual(adaptive.requiresFaberBlueprint, false);

  const initialPreferred = resolveBlueprintRouteModeContract({
    buildModeRoute: { mode: 'initial_blueprint', confidence: 0.82 },
    projectState: 'empty_project',
    signals: {
      canUseInitialBlueprint: true,
      enoughForInitialCreate: true,
      blueprintPreferred: true,
    },
    workingBrief: {
      product: { domain: 'greenhouses', stack: 'next-tailwind' },
    },
  });
  assert.strictEqual(initialPreferred.buildMode, 'initial_blueprint');
  assert.strictEqual(initialPreferred.productRouteMode, 'faber_blueprint');
  assert.strictEqual(initialPreferred.productRouteReason, 'faber_blueprint_create');
  assert.strictEqual(initialPreferred.requiresFaberBlueprint, true);

  const initialFallback = resolveBlueprintRouteModeContract({
    buildModeRoute: { mode: 'initial_blueprint' },
    projectState: 'metadata_only_project',
    signals: {
      canUseInitialBlueprint: true,
      enoughForInitialCreate: false,
      blueprintPreferred: false,
    },
    workingBrief: {
      product: { domain: 'gardening' },
    },
  });
  assert.strictEqual(initialFallback.productRouteMode, 'faber_blueprint');
  assert.strictEqual(initialFallback.productRouteReason, 'initial_blueprint_create');

  const existingProject = resolveBlueprintRouteModeContract({
    buildModeRoute: { mode: 'initial_blueprint' },
    projectState: 'existing_project',
    signals: {
      canUseInitialBlueprint: true,
      enoughForInitialCreate: true,
    },
    workingBrief: { product: { domain: 'legal' } },
  });
  assert.strictEqual(existingProject, null);

  assert.strictEqual(validateBlueprintRouteModePair({
    decision: 'execute',
    capability: 'create_project',
    buildMode: 'initial_blueprint',
    productRouteMode: 'faber_blueprint',
  }).ok, true);
  assert.strictEqual(validateBlueprintRouteModePair({
    decision: 'execute',
    capability: 'create_project',
    buildMode: 'adaptive_blueprint',
    productRouteMode: 'adaptive_blueprint',
  }).ok, true);
  assert.strictEqual(validateBlueprintRouteModePair({
    decision: 'execute',
    capability: 'create_project',
    buildMode: 'initial_blueprint',
    productRouteMode: 'initial_blueprint',
  }).ok, false);
  assert.strictEqual(validateBlueprintRouteModePair({
    decision: 'execute',
    capability: 'create_project',
    buildMode: 'adaptive_blueprint',
    productRouteMode: 'faber_blueprint',
  }).ok, false);

  console.log('product-route-mode-contract-service.test.js: ok');
}

run();
