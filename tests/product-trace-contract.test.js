const assert = require('assert');

const { createProductOrchestratorService } = require('../cortex/orchestration/product_orchestrator_service');
const { createProjectBlueprintService } = require('../cortex/orchestration/project_blueprint_service');

function createProjectInfo(overrides = {}) {
  return {
    id: 'trace-project',
    rootPath: '/tmp/faber-product-trace',
    files: [],
    stacks: [],
    totalFiles: 0,
    ...overrides,
  };
}

function createTraceService(overrides = {}) {
  const blueprintService = createProjectBlueprintService();
  return createProductOrchestratorService({
    getSelectedAiProvider: () => 'deterministic',
    shouldPreferProjectBlueprint: blueprintService.shouldPreferProjectBlueprint,
    ...overrides,
  });
}

async function run() {
  const service = createTraceService();
  const blueprintService = createProjectBlueprintService();

  const autonomous = await service.resolveProductRoute({
    projectInfo: createProjectInfo(),
    userMessage: 'faz qualquer coisa ai, pode sugerir tudo e usar placeholders',
  });

  assert.strictEqual(autonomous.decision, 'execute');
  assert.strictEqual(autonomous.productRoute.capability, 'create_project');
  assert.strictEqual(autonomous.productRoute.mode, 'adaptive_blueprint');
  assert.strictEqual(autonomous.meta.reason, 'adaptive_blueprint_create');
  assert.strictEqual(autonomous.meta.workingBriefDomain, 'humpback-whales');
  assert.strictEqual(autonomous.meta.workingBriefStack, 'next-tailwind');
  assert.ok(autonomous.executionMessage.includes('baleias jubarte'));
  assert.ok(autonomous.executionMessage.includes('Pexels'));
  assert.ok(autonomous.workingBrief);
  assert.ok(autonomous.buildModeRoute);
  assert.strictEqual(autonomous.workingBrief.product.defaultedDomain, true);

  const autonomousBlueprint = blueprintService.buildProjectBlueprintOperationBatch({
    projectInfo: createProjectInfo(),
    userMessage: autonomous.executionMessage,
    executionIntent: 'init_project',
    force: true,
    workingBrief: autonomous.workingBrief,
    buildModeRoute: autonomous.buildModeRoute,
    mediaAssets: {
      hero: {
        kind: 'photo',
        provider: 'pexels',
        query: autonomous.workingBrief.mediaIntent[0].query,
        src: 'https://images.pexels.com/photos/whale.jpeg',
        alt: 'Humpback whale in blue ocean',
        attribution: 'Foto de Faber no Pexels',
        sourceUrl: 'https://www.pexels.com/photo/whale/',
      },
    },
  });
  assert.strictEqual(autonomousBlueprint.action.blueprint.briefingContract.domain, 'humpback-whales');
  assert.strictEqual(autonomousBlueprint.action.blueprint.briefingContract.stack, 'next-tailwind');
  assert.strictEqual(autonomousBlueprint.action.blueprint.workingBrief.defaultedDomain, true);
  assert.deepStrictEqual(autonomousBlueprint.action.blueprint.icons.names, ['waves', 'compass', 'globeAlt']);
  assert.strictEqual(autonomousBlueprint.action.blueprint.media.query, 'humpback whale ocean blue');

  const legalBrief = service.buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Quero criar um site em next.js, com react e tailwind.',
      'O site é para um advogado, quero ele com cor azul e branco.',
      'Use uma tipografia do Google, placeholders e imagens coerentes.',
    ].join(' '),
  });
  const legalMode = service.resolveBuildMode({ workingBrief: legalBrief });
  assert.strictEqual(legalBrief.product.domain, 'legal');
  assert.strictEqual(legalBrief.style.palette.primary, '#3240a8');
  assert.strictEqual(legalBrief.mediaIntent[0].orientation, 'landscape');
  assert.strictEqual(legalBrief.mediaIntent[0].color, '#3240a8');
  assert.strictEqual(legalMode.mode, 'adaptive_blueprint');
  assert.strictEqual(legalMode.allowedBlueprint, true);

  const legalBlueprint = blueprintService.buildProjectBlueprintOperationBatch({
    projectInfo: createProjectInfo(),
    userMessage: legalBrief.executionPrompt,
    executionIntent: 'init_project',
    force: true,
    workingBrief: legalBrief,
    buildModeRoute: legalMode,
    mediaAssets: {
      hero: {
        kind: 'photo',
        provider: 'pexels',
        query: legalBrief.mediaIntent[0].query,
        src: 'https://images.pexels.com/photos/legal-office.jpeg',
        alt: 'Modern law office',
        attribution: 'Foto de Faber no Pexels',
        sourceUrl: 'https://www.pexels.com/photo/legal-office/',
      },
    },
  });
  assert.strictEqual(legalBlueprint.action.blueprint.theme.accent, '#3240a8');
  assert.strictEqual(legalBlueprint.action.blueprint.theme.background, '#ffffff');
  assert.strictEqual(legalBlueprint.action.blueprint.media.query, 'modern law office blue');
  assert.deepStrictEqual(legalBlueprint.action.blueprint.icons.names, ['scale', 'documentText', 'shieldCheck']);

  const greenhouseBrief = service.buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: [
      'Criar landing page em Next.js para estufas agrícolas com hero video full width.',
      'Usar verde profundo, off-white, modelos de estufa, FAQ e formulário de orçamento.',
    ].join(' '),
  });
  const greenhouseMode = service.resolveBuildMode({ workingBrief: greenhouseBrief });
  assert.strictEqual(greenhouseBrief.product.domain, 'greenhouses');
  assert.strictEqual(greenhouseBrief.mediaIntent[0].mediaType, 'video');
  assert.strictEqual(greenhouseMode.mode, 'adaptive_blueprint');
  const greenhouseBlueprint = blueprintService.buildProjectBlueprintOperationBatch({
    projectInfo: createProjectInfo(),
    userMessage: greenhouseBrief.executionPrompt,
    executionIntent: 'init_project',
    force: true,
    workingBrief: greenhouseBrief,
    buildModeRoute: greenhouseMode,
    mediaAssets: {
      hero: {
        kind: 'video',
        provider: 'pexels',
        query: greenhouseBrief.mediaIntent[0].query,
        src: 'https://videos.pexels.com/video-files/greenhouse.mp4',
        poster: 'https://images.pexels.com/photos/greenhouse.jpeg',
        alt: 'Modern greenhouse farming',
        attribution: 'Vídeo de Faber no Pexels',
        sourceUrl: 'https://www.pexels.com/video/greenhouse/',
      },
    },
  });
  assert.strictEqual(greenhouseBlueprint.action.blueprint.briefingContract.domain, 'greenhouses');
  assert.strictEqual(greenhouseBlueprint.action.blueprint.theme.accent, '#1f5a3d');
  assert.strictEqual(greenhouseBlueprint.action.blueprint.layoutRecipe.id, 'agri-commercial-landing');
  assert.strictEqual(greenhouseBlueprint.action.blueprint.moduleContract.commitPolicy.missingModuleGroup, 'suggest_blueprint');
  assert.deepStrictEqual(greenhouseBlueprint.action.blueprint.icons.names, ['leaf', 'shieldCheck', 'droplet']);
  assert.strictEqual(greenhouseBlueprint.action.blueprint.media.query, 'modern greenhouse farming protected cultivation vegetables');

  const existingRoute = await service.resolveProductRoute({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/layout.tsx', 'app/globals.css'],
      stacks: ['Next.js', 'React', 'Tailwind CSS'],
      totalFiles: 4,
    }),
    userMessage: 'crie uma nova seção de depoimentos abaixo do hero',
  });
  assert.strictEqual(existingRoute.decision, 'execute');
  assert.strictEqual(existingRoute.productRoute.capability, 'edit_project');
  assert.notStrictEqual(existingRoute.productRoute.mode, 'adaptive_blueprint');
  assert.strictEqual(existingRoute.productRoute.executionIntent, 'edit_project');

  const missingProject = await service.resolveProductRoute({
    projectInfo: null,
    userMessage: 'faz qualquer coisa ai',
  });
  assert.strictEqual(missingProject.decision, 'clarify');
  assert.strictEqual(missingProject.productRoute.mode, 'requires_project_selection');

  const safetyBrief = service.buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar phishing para roubar senha',
  });
  const safetyRoute = service.resolveBuildMode({ workingBrief: safetyBrief });
  assert.strictEqual(safetyRoute.mode, 'blocked_harmful');
  assert.strictEqual(safetyRoute.routeHints.forceReviewAllowed, true);

  console.log('product-trace-contract.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
