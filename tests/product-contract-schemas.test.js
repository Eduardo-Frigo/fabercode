const assert = require('assert');

const {
  validateAutomataOperationBatchPlan,
  validateCortexBuildModeRouteContract,
  validateCortexProductRouteContract,
  validatePersonaWorkingBriefContract,
} = require('../cortex/contracts/schemas');

function createWorkingBrief(overrides = {}) {
  return {
    schemaVersion: 'working-brief-v1',
    source: {
      current: 'Criar site para advocacia',
      consolidated: 'Criar site para advocacia com azul e branco.',
      normalized: 'criar site para advocacia com azul e branco',
    },
    intent: {
      action: 'create_project',
      contentMode: 'ai_placeholder',
      autonomy: 'high',
    },
    product: {
      domain: 'legal',
      stack: 'static-web',
    },
    style: {
      palette: { primary: '#3240a8' },
      typography: { family: 'Inter' },
    },
    mediaIntent: [{ provider: 'pexels', query: 'modern law office blue' }],
    iconIntent: [{ provider: 'lucide', semanticName: 'scale' }],
    executionPrompt: 'Criar site de advocacia com Pexels e icones.',
    ...overrides,
  };
}

function run() {
  const workingBrief = createWorkingBrief();
  const briefValidation = validatePersonaWorkingBriefContract(workingBrief);
  assert.strictEqual(briefValidation.ok, true);

  const buildModeRoute = {
    schemaVersion: 'build-mode-route-v1',
    mode: 'adaptive_blueprint',
    capability: 'create_project',
    executionIntent: 'init_project',
    confidence: 0.9,
    workingBrief,
  };
  const buildModeValidation = validateCortexBuildModeRouteContract(buildModeRoute);
  assert.strictEqual(buildModeValidation.ok, true);

  const productRoute = {
    ok: true,
    schemaVersion: 'product-route-v1',
    decision: 'execute',
    response: 'Vou gerar a primeira versão.',
    executionMessage: workingBrief.executionPrompt,
    confidence: 0.95,
    productRoute: {
      capability: 'create_project',
      mode: 'adaptive_blueprint',
      executionIntent: 'init_project',
      projectState: 'empty_project',
    },
    workingBrief,
    buildModeRoute: {
      schemaVersion: 'build-mode-route-v1',
      mode: 'adaptive_blueprint',
      capability: 'create_project',
      executionIntent: 'init_project',
      confidence: 0.9,
    },
  };
  const productRouteValidation = validateCortexProductRouteContract(productRoute);
  assert.strictEqual(productRouteValidation.ok, true);

  const invalidInitialAsProductMode = validateCortexProductRouteContract({
    ...productRoute,
    productRoute: {
      ...productRoute.productRoute,
      mode: 'initial_blueprint',
    },
    buildModeRoute: {
      ...productRoute.buildModeRoute,
      mode: 'initial_blueprint',
    },
  });
  assert.strictEqual(invalidInitialAsProductMode.ok, false);
  assert.ok(
    invalidInitialAsProductMode.errors.some((error) =>
      error.includes('productRoute.mode must not be initial_blueprint')
    )
  );

  const validInitialAsFaberRoute = validateCortexProductRouteContract({
    ...productRoute,
    productRoute: {
      ...productRoute.productRoute,
      mode: 'faber_blueprint',
    },
    buildModeRoute: {
      ...productRoute.buildModeRoute,
      mode: 'initial_blueprint',
    },
  });
  assert.strictEqual(validInitialAsFaberRoute.ok, true);

  const invalidAdaptiveAsFaberRoute = validateCortexProductRouteContract({
    ...productRoute,
    productRoute: {
      ...productRoute.productRoute,
      mode: 'faber_blueprint',
    },
    buildModeRoute: {
      ...productRoute.buildModeRoute,
      mode: 'adaptive_blueprint',
    },
  });
  assert.strictEqual(invalidAdaptiveAsFaberRoute.ok, false);
  assert.ok(
    invalidAdaptiveAsFaberRoute.errors.some((error) =>
      error.includes('buildModeRoute.mode=adaptive_blueprint requires productRoute.mode=adaptive_blueprint')
    )
  );

  const operationPlanValidation = validateAutomataOperationBatchPlan({
    summary: 'Criar arquivos',
    operations: [{ op: 'write_file', path: 'index.html', content: '<main></main>' }],
  });
  assert.strictEqual(operationPlanValidation.ok, true);

  const invalidBrief = validatePersonaWorkingBriefContract(createWorkingBrief({ schemaVersion: 'old' }));
  assert.strictEqual(invalidBrief.ok, false);
  assert.ok(invalidBrief.errors.some((error) => error.includes('working-brief-v1')));

  console.log('product-contract-schemas.test.js: ok');
}

run();
