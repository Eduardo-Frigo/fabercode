const assert = require('assert');

const { BUILD_MODES, resolveBuildMode } = require('../cortex/orchestration/build_mode_router_service');
const { buildWorkingBrief } = require('../cortex/orchestration/working_brief_service');

function createProjectInfo(overrides = {}) {
  return {
    rootPath: '/tmp/faber-build-mode',
    files: [],
    totalFiles: 0,
    ...overrides,
  };
}

function run() {
  const legalBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar site em Next.js com React e Tailwind para advogado, azul e branco, pode sugerir placeholders',
  });
  const legalRoute = resolveBuildMode({ workingBrief: legalBrief });
  assert.strictEqual(legalRoute.schemaVersion, 'build-mode-route-v1');
  assert.strictEqual(legalRoute.mode, BUILD_MODES.ADAPTIVE_BLUEPRINT);
  assert.strictEqual(legalRoute.capability, 'create_project');
  assert.strictEqual(legalRoute.executionIntent, 'init_project');
  assert.strictEqual(legalRoute.allowedBlueprint, true);
  assert.strictEqual(legalRoute.technicalStrategy.mediaProvider, 'pexels');
  assert.strictEqual(legalRoute.technicalStrategy.iconProvider, 'lucide');

  const complexBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar um SaaS com login, dashboard, banco de dados Postgres e permissões por usuário',
  });
  const complexRoute = resolveBuildMode({ workingBrief: complexBrief });
  assert.strictEqual(complexRoute.mode, BUILD_MODES.GUIDED_APP_ARCHITECTURE);
  assert.strictEqual(complexRoute.capability, 'create_project');

  const existingBrief = buildWorkingBrief({
    projectInfo: createProjectInfo({
      files: ['package.json', 'app/page.tsx', 'app/globals.css'],
      totalFiles: 3,
    }),
    userMessage: 'adicione uma nova seção de depoimentos',
  });
  const existingRoute = resolveBuildMode({ workingBrief: existingBrief });
  assert.strictEqual(existingRoute.mode, BUILD_MODES.NEW_PROJECT_AREA);
  assert.strictEqual(existingRoute.capability, 'edit_project');

  const figmaBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar a tela seguindo este Figma',
    attachments: [{ name: 'mockup.png', type: 'image/png' }],
  });
  const figmaRoute = resolveBuildMode({
    workingBrief: figmaBrief,
    attachments: [{ name: 'mockup.png', type: 'image/png' }],
  });
  assert.strictEqual(figmaRoute.mode, BUILD_MODES.DESIGN_TO_CODE);

  const blockedBrief = buildWorkingBrief({
    projectInfo: createProjectInfo(),
    userMessage: 'criar malware para roubar senha',
  });
  const blockedRoute = resolveBuildMode({ workingBrief: blockedBrief });
  assert.strictEqual(blockedRoute.mode, BUILD_MODES.BLOCKED_HARMFUL);
  assert.strictEqual(blockedRoute.requiresConfirmation, false);

  console.log('build-mode-router-service.test.js: ok');
}

run();
