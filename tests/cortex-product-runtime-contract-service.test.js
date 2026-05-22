const assert = require('assert');

const {
  buildCortexPexelsContractFromPersonaBrief,
  resolveCortexBuildModeRouteFromProductRoute,
  resolveCortexProductRouteDecisionFromContextHint,
  resolveCortexProductRuntimeContract,
  resolvePersonaWorkingBriefFromProductRoute,
} = require('../main/services/cortex_product_runtime_contract_service');

function run() {
  const workingBrief = {
    schemaVersion: 'working-brief-v1',
    product: { domain: 'legal', stack: 'static-web' },
    style: { palette: { primary: '#3240a8', imageColor: '#3240a8' } },
  };
  const buildModeRoute = {
    schemaVersion: 'build-mode-route-v1',
    mode: 'adaptive_blueprint',
    capability: 'create_project',
    executionIntent: 'init_project',
  };
  const productRouteDecision = {
    schemaVersion: 'product-route-v1',
    meta: { planner: 'product_orchestrator' },
    productRoute: { mode: 'adaptive_blueprint' },
    workingBrief,
    buildModeRoute,
  };

  assert.strictEqual(
    resolveCortexProductRouteDecisionFromContextHint({ productRouteDecision }),
    productRouteDecision
  );
  assert.strictEqual(
    resolveCortexProductRouteDecisionFromContextHint({ personaRouteDecision: productRouteDecision }),
    productRouteDecision
  );
  assert.strictEqual(resolvePersonaWorkingBriefFromProductRoute(productRouteDecision), workingBrief);
  assert.strictEqual(resolveCortexBuildModeRouteFromProductRoute(productRouteDecision), buildModeRoute);

  const runtimeContract = resolveCortexProductRuntimeContract({ productRouteDecision });
  assert.strictEqual(runtimeContract.routeDecision, productRouteDecision);
  assert.strictEqual(runtimeContract.workingBrief, workingBrief);
  assert.strictEqual(runtimeContract.buildModeRoute, buildModeRoute);

  assert.deepStrictEqual(buildCortexPexelsContractFromPersonaBrief(workingBrief), {
    domain: 'legal',
    stack: 'static-web',
    palette: { primary: '#3240a8', imageColor: '#3240a8' },
  });

  console.log('cortex-product-runtime-contract-service.test.js: ok');
}

run();
