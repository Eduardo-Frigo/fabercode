const assert = require('assert');

const { createProjectBlueprintService } = require('../cortex/orchestration/project_blueprint_service');
const { createStackRegistryService } = require('../main/services/stack_registry_service');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

function run() {
  const service = createProjectBlueprintService();

  const lamp = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-lamp' },
    userMessage: 'criar site institucional em LAMP com placeholder rápido',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(lamp.ok, true);
  assert.strictEqual(lamp.raw, 'project_blueprint:lamp');
  assert.strictEqual(lamp.action.generatedBy, 'project_blueprint_service');
  assert.deepStrictEqual(lamp.action.operations.map((operation) => operation.path), [
    'index.php',
    'style.css',
    'script.js',
  ]);

  const next = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-next' },
    userMessage: 'criar página institucional em Next.js com React e Tailwind usando placeholders',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(next.ok, true);
  assert.strictEqual(next.raw, 'project_blueprint:next-tailwind');
  assert.ok(next.action.operations.some((operation) => operation.path === 'package.json'));
  assert.ok(next.action.operations.some((operation) => operation.path === 'app/layout.tsx'));
  assert.ok(next.action.operations.some((operation) => operation.path === 'app/page.tsx'));
  assert.ok(next.action.operations.some((operation) => operation.path === 'app/globals.css'));
  assert.ok(next.action.operations.find((operation) => operation.path === 'package.json').content.includes('"next"'));
  assert.ok(next.action.operations.find((operation) => operation.path === 'app/layout.tsx').content.includes('suppressHydrationWarning'));
  assert.ok(next.action.operations.find((operation) => operation.path === 'app/globals.css').content.includes('@import "tailwindcss"'));

  const legalNext = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-lawyer' },
    userMessage: 'criar site institucional em Next.js com React e Tailwind para advogado empresarial usando placeholders',
    contextText: 'conversa antiga sobre dentista e Clínica Sorriso',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(legalNext.ok, true);
  const legalPage = legalNext.action.operations.find((operation) => operation.path === 'app/page.tsx').content;
  const legalLayout = legalNext.action.operations.find((operation) => operation.path === 'app/layout.tsx').content;
  assert.ok(legalLayout.includes('Escritório Faber Advocacia'));
  assert.ok(legalPage.includes('advocacia'));
  assert.ok(legalPage.includes('consulta jurídica'));
  assert.strictEqual(legalPage.includes('Clínica Sorriso'), false);

  const contextualLamp = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-context-lamp' },
    userMessage: 'faz com placeholders',
    contextText: 'Pedido consolidado: criar site institucional em LAMP para advogado.',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
    force: true,
  });
  assert.deepStrictEqual(contextualLamp.action.operations.map((operation) => operation.path), [
    'index.php',
    'style.css',
    'script.js',
  ]);
  assert.ok(contextualLamp.action.operations.find((operation) => operation.path === 'index.php').content.includes('advocacia'));

  assert.strictEqual(service.hasRequiredProjectBlueprintFiles({
    operations: next.action.operations,
    userMessage: 'Next.js com Tailwind',
  }), true);

  const figmaSpecific = service.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-figma' },
    userMessage: 'criar página institucional em Next.js seguindo este Figma específico com Tailwind',
    attachments: [{ name: 'layout.png' }],
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });
  assert.strictEqual(figmaSpecific, null);
  assert.strictEqual(service.shouldPreferProjectBlueprint({
    userMessage: 'criar página institucional em Next.js seguindo este Figma específico com Tailwind',
    attachments: [{ name: 'layout.png' }],
    executionIntent: 'init_project',
  }), false);
  assert.strictEqual(service.shouldUseProjectBlueprintFallback({
    userMessage: 'criar página institucional em Next.js seguindo este Figma específico com Tailwind',
    attachments: [{ name: 'layout.png' }],
    executionIntent: 'init_project',
  }), false);

  const stackRegistry = createStackRegistryService({
    pluginProfiles: [
      {
        id: 'astro',
        label: 'Astro',
        aliases: ['astro'],
        detect: {
          packageDependencies: ['astro'],
          fileExtensions: ['.astro'],
        },
        blueprint: {
          targetFile: 'src/pages/index.astro',
          requiredFiles: ['package.json', 'src/pages/index.astro'],
          promptGuidance: ['Para Astro, gerar package.json e src/pages/index.astro como baseline inicial.'],
          operations: [
            {
              op: 'write_file',
              path: 'package.json',
              content: '{\n  "private": true,\n  "name": "{{brandSlug}}",\n  "scripts": { "dev": "astro dev", "build": "astro build" },\n  "dependencies": { "astro": "^5.0.0" }\n}\n',
            },
            {
              op: 'write_file',
              path: 'src/pages/index.astro',
              content: '---\nconst brand = {{brandJson}};\n---\n<main><h1>{brand}</h1><p>Placeholder institucional Astro.</p></main>\n',
            },
            {
              op: 'write_file',
              path: '../unsafe.txt',
              content: 'nao deve entrar',
            },
          ],
        },
      },
    ],
  });
  const pluginService = createProjectBlueprintService({ stackRegistry });
  const astro = pluginService.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath: '/tmp/faber-astro' },
    userMessage: 'criar site institucional em Astro com placeholders',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });

  assert.strictEqual(astro.ok, true);
  assert.strictEqual(astro.raw, 'project_blueprint:astro');
  assert.strictEqual(astro.action.targetFile, 'src/pages/index.astro');
  assert.deepStrictEqual(astro.action.operations.map((operation) => operation.path), [
    'package.json',
    'src/pages/index.astro',
  ]);
  assert.ok(astro.action.operations.find((operation) => operation.path === 'package.json').content.includes('"name": "faber-projeto"'));
  assert.strictEqual(pluginService.hasRequiredProjectBlueprintFiles({
    operations: astro.action.operations,
    userMessage: 'site institucional em Astro',
  }), true);
  assert.ok(pluginService.buildProjectBlueprintPromptGuidance({
    userMessage: 'site institucional em Astro com placeholders',
    executionIntent: 'init_project',
  }).includes('Para Astro'));

  console.log('project-blueprint-service.test.js: ok');
}

run();
