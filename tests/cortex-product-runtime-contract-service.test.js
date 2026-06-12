const assert = require('assert');

const {
  buildCortexPexelsContractFromPersonaBrief,
  hasExplicitRuntimeRepairIntent,
  resolveRuntimeLocalBlueprintPolicy,
  shouldTreatRuntimeRequestAsDiagnostic,
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

  const guidedPolicy = resolveRuntimeLocalBlueprintPolicy({
    routeMode: 'guided_app_architecture',
    buildModeRoute: { mode: 'guided_app_architecture' },
    explicitRebuild: true,
    preferLocalBlueprint: true,
    fallbackLocalBlueprint: true,
  });
  assert.strictEqual(guidedPolicy.guidedAppArchitecture, true);
  assert.strictEqual(guidedPolicy.routeAllowsBlueprint, false);
  assert.strictEqual(guidedPolicy.explicitRebuildAllowsLocalBlueprint, false);

  const adaptivePolicy = resolveRuntimeLocalBlueprintPolicy({
    routeMode: 'adaptive_blueprint',
    explicitRebuild: true,
  });
  assert.strictEqual(adaptivePolicy.guidedAppArchitecture, false);
  assert.strictEqual(adaptivePolicy.routeAllowsBlueprint, true);
  assert.strictEqual(adaptivePolicy.explicitRebuildAllowsLocalBlueprint, true);

  assert.strictEqual(
    shouldTreatRuntimeRequestAsDiagnostic({
      executionIntent: 'init_project',
      currentDiagnosticIntent: false,
      effectiveDiagnosticIntent: false,
      contextDiagnosticIntent: true,
    }),
    false
  );
  assert.strictEqual(
    shouldTreatRuntimeRequestAsDiagnostic({
      executionIntent: 'diagnose_project',
      contextDiagnosticIntent: false,
    }),
    true
  );
  assert.strictEqual(
    shouldTreatRuntimeRequestAsDiagnostic({
      executionIntent: 'edit_project',
      currentDiagnosticIntent: true,
    }),
    true
  );
  assert.strictEqual(hasExplicitRuntimeRepairIntent('O que é necessário corrigir para a visualização funcionar?'), false);
  assert.strictEqual(hasExplicitRuntimeRepairIntent('Corrija o preview que falha com document is not defined.'), true);
  assert.strictEqual(
    hasExplicitRuntimeRepairIntent('Faça apenas uma edição pontual em app/page.tsx e troque classes Tailwind existentes.'),
    true
  );
  assert.strictEqual(
    shouldTreatRuntimeRequestAsDiagnostic({
      executionIntent: 'diagnose_project',
      userMessage: 'Corrija o preview Next.js removendo document em escopo de módulo.',
      currentDiagnosticIntent: true,
      effectiveDiagnosticIntent: true,
    }),
    false
  );
  assert.strictEqual(
    shouldTreatRuntimeRequestAsDiagnostic({
      executionIntent: 'diagnose_project',
      userMessage: 'O que é necessário corrigir para a visualização funcionar?',
      currentDiagnosticIntent: true,
    }),
    true
  );
  assert.strictEqual(
    shouldTreatRuntimeRequestAsDiagnostic({
      executionIntent: 'edit_project',
      userMessage: 'Faça apenas uma edição pontual em app/page.tsx e troque classes Tailwind existentes.',
      currentDiagnosticIntent: false,
      effectiveDiagnosticIntent: false,
      contextDiagnosticIntent: true,
      routeCapability: 'diagnose_project',
    }),
    false
  );

  console.log('cortex-product-runtime-contract-service.test.js: ok');
}

run();
