const assert = require('assert');

const {
  AGENTIC_CREATE_PROFILE_SCHEMA_VERSION,
  AGENTIC_CREATE_SCAFFOLD_STRATEGIES,
  buildAgenticCreatePromptGuidance,
  createAgenticCreateProfile,
} = require('../main/services/agentic_create_profile_service');

function createRoute(overrides = {}) {
  return {
    decision: 'execute',
    productRoute: {
      capability: 'create_project',
      executionIntent: 'init_project',
      mode: 'faber_blueprint',
      projectState: 'empty_project',
      ...(overrides.productRoute || {}),
    },
    ...overrides,
  };
}

function run() {
  const generic = createAgenticCreateProfile({
    routeDecision: createRoute(),
    userMessage: 'Crie uma aplicação Next.js com backend e autenticação.',
  });
  assert.ok(generic);
  assert.strictEqual(generic.schemaVersion, AGENTIC_CREATE_PROFILE_SCHEMA_VERSION);
  assert.strictEqual(generic.executionMode, 'unified_agentic_loop');
  assert.strictEqual(generic.scaffold.optional, true);
  assert.strictEqual(
    generic.scaffold.strategy,
    AGENTIC_CREATE_SCAFFOLD_STRATEGIES.NONE,
    'an upstream blueprint mode must not opt the user into a scaffold',
  );
  assert.strictEqual(generic.scaffold.explicitlyRequested, false);
  assert.strictEqual(generic.route.upstreamMode, 'faber_blueprint');
  assert.ok(Object.isFrozen(generic));
  assert.ok(Object.isFrozen(generic.scaffold));
  assert.match(buildAgenticCreatePromptGuidance(generic), /não é um caminho obrigatório/i);
  assert.doesNotMatch(buildAgenticCreatePromptGuidance(generic), /apply_faber_blueprint_scaffold/);

  const explicit = createAgenticCreateProfile({
    routeDecision: createRoute(),
    userMessage: 'Use explicitamente o blueprint do Faber como scaffold inicial.',
  });
  assert.strictEqual(
    explicit.scaffold.strategy,
    AGENTIC_CREATE_SCAFFOLD_STRATEGIES.FABER_BLUEPRINT,
  );
  assert.strictEqual(explicit.scaffold.explicitlyRequested, true);
  assert.strictEqual(explicit.scaffold.authorizationSource, 'user_message');
  assert.match(buildAgenticCreatePromptGuidance(explicit), /apply_faber_blueprint_scaffold/);
  assert.match(buildAgenticCreatePromptGuidance(explicit), /no máximo uma vez/i);

  const negated = createAgenticCreateProfile({
    routeDecision: createRoute(),
    userMessage: 'Crie a aplicação sem blueprint; implemente a arquitetura livremente.',
  });
  assert.strictEqual(negated.scaffold.strategy, AGENTIC_CREATE_SCAFFOLD_STRATEGIES.NONE);
  assert.strictEqual(negated.scaffold.explicitlyRequested, false);
  assert.strictEqual(negated.scaffold.authorizationSource, 'explicit_opt_out');

  const initOnly = createAgenticCreateProfile({
    routeDecision: createRoute({
      productRoute: {
        capability: 'edit_project',
        executionIntent: 'init_project',
        mode: 'guided_app_architecture',
      },
    }),
    userMessage: 'Inicialize o projeto.',
  });
  assert.ok(initOnly, 'init_project alone must activate the creation profile');

  const edit = createAgenticCreateProfile({
    routeDecision: createRoute({
      productRoute: {
        capability: 'edit_project',
        executionIntent: 'edit_project',
        mode: 'existing_project_edit',
      },
    }),
    userMessage: 'Altere a página atual.',
  });
  assert.strictEqual(edit, null);

  console.log('agentic-create-profile-service.test.js: ok');
}

run();
