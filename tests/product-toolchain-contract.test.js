const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createAutomataExecutor } = require('../cortex/automata/core/executor');
const { findCssImportOrderViolation } = require('../cortex/orchestration/css_operation_safety');
const { createProjectBlueprintService } = require('../cortex/orchestration/project_blueprint_service');
const { createDeterministicEditService } = require('../main/services/deterministic_edit_service');
const { createProjectPreviewService } = require('../main/services/project_preview_service');
const { createProjectVerificationService } = require('../main/services/project_verification_service');
const { createStackRegistryService } = require('../main/services/stack_registry_service');

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

function assertSafeRelativePath(relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  assert.ok(normalized, 'operation path should not be empty');
  assert.strictEqual(path.isAbsolute(normalized), false, `operation path must be relative: ${normalized}`);
  assert.strictEqual(normalized.includes('\0'), false, `operation path must not contain null bytes: ${normalized}`);
  assert.strictEqual(normalized.split('/').some((part) => part === '..'), false, `operation path must not escape root: ${normalized}`);
  return normalized;
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeRequestedRelativePath(value) {
  const text = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const normalized = path.posix.normalize(text);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return '';
  return normalized;
}

function computeLineChangeStats(previous, next) {
  const previousLines = String(previous || '').split('\n');
  const nextLines = String(next || '').split('\n');
  return {
    added: Math.max(0, nextLines.length - previousLines.length),
    removed: Math.max(0, previousLines.length - nextLines.length),
  };
}

function mergeDiffStatsEntry(target, file, stats) {
  target[file] = stats;
}

function validateExecutionCommand(command) {
  if (!command || !command.root_path) return { ok: false, message: 'root_path ausente' };
  if (!['apply_file_patch', 'search_text_in_files', 'execute_operation_batch'].includes(command.task_type)) {
    return { ok: false, message: 'task_type inválido' };
  }
  return { ok: true };
}

function createProductContractExecutor() {
  return createAutomataExecutor({
    computeLineChangeStats,
    fs,
    hashText,
    isTextLikeExtension: () => true,
    mergeDiffStatsEntry,
    normalizeRelativePathForDiff: normalizeRequestedRelativePath,
    normalizeRequestedRelativePath,
    path,
    validateExecutionCommand,
  });
}

function applyOperations(rootPath, operations = []) {
  for (const operation of operations) {
    assertSafeRelativePath(operation && operation.path);
  }

  fs.mkdirSync(rootPath, { recursive: true });
  const result = createProductContractExecutor().executeOperationBatchAction({
    rootPath,
    operations,
  });
  assert.strictEqual(result.ok, true, result.message);
  assert.strictEqual(result.transactional, true, 'product contract must apply writes through the transactional executor');
  return result.modifiedFiles || [];
}

function writeLocalBin(rootPath, name) {
  const target = path.join(rootPath, 'node_modules', '.bin', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '#!/usr/bin/env node\n', 'utf8');
}

function createProjectInfo(rootPath, files, stacks) {
  return {
    rootPath,
    files,
    stacks,
    totalFiles: files.length,
    counters: {},
  };
}

function createDeterministicService() {
  return createDeterministicEditService({
    fs,
    path,
    buildOperationBatchDiffPreview,
  });
}

async function testNextCreationPreviewVerificationAndEditing(tempRoot) {
  const rootPath = path.join(tempRoot, 'next-product');
  const blueprintService = createProjectBlueprintService();
  const blueprint = blueprintService.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath },
    userMessage: 'criar página institucional em Next.js com React e Tailwind usando placeholders',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });

  assert.strictEqual(blueprint.ok, true);
  assert.strictEqual(blueprint.raw, 'project_blueprint:next-tailwind');
  assert.strictEqual(blueprint.action.targetFile, 'app/page.tsx');
  assert.strictEqual(blueprintService.hasRequiredProjectBlueprintFiles({
    operations: blueprint.action.operations,
    userMessage: 'Next.js com Tailwind',
  }), true);

  const files = applyOperations(rootPath, blueprint.action.operations);
  const projectInfo = createProjectInfo(rootPath, files, ['Next.js', 'React', 'Tailwind CSS']);
  assert.ok(files.includes('package.json'));
  assert.ok(files.includes('app/layout.tsx'));
  assert.ok(files.includes('app/page.tsx'));
  assert.ok(files.includes('app/globals.css'));
  assert.strictEqual(
    findCssImportOrderViolation(fs.readFileSync(path.join(rootPath, 'app', 'globals.css'), 'utf8')),
    null,
    'Next blueprint CSS must keep @import rules before regular CSS rules'
  );

  const previewService = createProjectPreviewService({ fs, path });
  const blockedPreview = previewService.buildProjectPreviewPlan(projectInfo);
  assert.strictEqual(blockedPreview.ready, false);
  assert.ok(blockedPreview.steps.some((step) => step.id === 'preview_dependencies' && step.commandText === 'npm install'));

  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'next');
  const readyPreview = previewService.buildProjectPreviewPlan(projectInfo, { port: 3005 });
  assert.strictEqual(readyPreview.ready, true);
  assert.strictEqual(readyPreview.commandText, 'npm run dev -- --hostname 127.0.0.1 --port 3005');
  assert.strictEqual(readyPreview.url, 'http://127.0.0.1:3005/');

  const verificationCalls = [];
  const verificationService = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args, options) => {
      verificationCalls.push({ bin, args, options });
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const verification = await verificationService.runProjectVerification(projectInfo);
  assert.strictEqual(verification.ready, true);
  assert.deepStrictEqual(verificationCalls.map((call) => [call.bin, call.args.join(' ')]), [
    ['npm', 'run build'],
  ]);
  assert.ok(verification.results.some((result) => result.id === 'next_entry' && result.status === 'passed'));
  assert.ok(verification.results.some((result) => result.id === 'tailwind_css_entry' && result.status === 'passed'));

  const deterministicService = createDeterministicService();
  const titlePatch = deterministicService.buildContentEditOperationBatch({
    projectInfo,
    executionIntent: 'edit_project',
    userMessage: 'Altere o título da página para "Portal Institucional Faber"',
  });
  assert.strictEqual(titlePatch.ok, true);
  assert.deepStrictEqual(titlePatch.action.operations.map((operation) => operation.path), [
    'app/page.tsx',
    'app/layout.tsx',
  ]);
  assert.ok(titlePatch.action.operations[0].content.includes('Portal Institucional Faber'));
  assert.strictEqual(titlePatch.action.operations[0].content.includes('{copy.heroTitle}'), false);
  applyOperations(rootPath, titlePatch.action.operations);

  const footerPatch = deterministicService.buildContentEditOperationBatch({
    projectInfo,
    executionIntent: 'edit_project',
    userMessage: 'Insira um Rodapé no site com cor contrastante',
  });
  assert.strictEqual(footerPatch.ok, true);
  assert.strictEqual(footerPatch.action.targetFile, 'app/page.tsx');
  assert.ok(footerPatch.action.operations[0].content.includes('<footer className='));
}

async function testLampCreationPreviewVerificationAndEditing(tempRoot) {
  const rootPath = path.join(tempRoot, 'lamp-product');
  const blueprintService = createProjectBlueprintService();
  const blueprint = blueprintService.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath },
    userMessage: 'criar site institucional em LAMP com placeholder rápido',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });

  assert.strictEqual(blueprint.ok, true);
  assert.strictEqual(blueprint.raw, 'project_blueprint:lamp');

  const files = applyOperations(rootPath, blueprint.action.operations);
  const projectInfo = createProjectInfo(rootPath, files, ['PHP/LAMP']);
  assert.deepStrictEqual(files, ['index.php', 'style.css', 'script.js']);

  const previewService = createProjectPreviewService({ fs, path });
  const preview = previewService.buildProjectPreviewPlan(projectInfo, { port: 8088 });
  assert.strictEqual(preview.ready, true);
  assert.strictEqual(preview.stack, 'PHP/LAMP');
  assert.strictEqual(preview.commandText, 'php -S 127.0.0.1:8088 -t .');

  const verificationCalls = [];
  const verificationService = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args, options) => {
      verificationCalls.push({ bin, args, options });
      return { ok: true, stdout: 'No syntax errors detected', stderr: '' };
    },
  });
  const verification = await verificationService.runProjectVerification(projectInfo);
  assert.strictEqual(verification.ready, true);
  assert.deepStrictEqual(verificationCalls.map((call) => [call.bin, call.args.join(' ')]), [
    ['php', '-l index.php'],
  ]);

  const deterministicService = createDeterministicService();
  const titlePatch = deterministicService.buildContentEditOperationBatch({
    projectInfo,
    executionIntent: 'edit_project',
    userMessage: 'Altere o título da página para "LAMP Institucional Faber"',
  });
  assert.strictEqual(titlePatch.ok, true);
  assert.strictEqual(titlePatch.action.targetFile, 'index.php');
  assert.ok(titlePatch.action.operations[0].content.includes('<title>LAMP Institucional Faber</title>'));
  assert.ok(titlePatch.action.operations[0].content.includes('<h1>LAMP Institucional Faber</h1>'));
  applyOperations(rootPath, titlePatch.action.operations);

  const colorPatch = deterministicService.buildContentEditOperationBatch({
    projectInfo,
    executionIntent: 'edit_project',
    userMessage: 'Quero ajustar a cor do botão principal para vermelho coral #cf416b',
  });
  assert.strictEqual(colorPatch.ok, true);
  assert.strictEqual(colorPatch.action.targetFile, 'style.css');
  assert.ok(colorPatch.action.operations[0].content.includes('--accent: #cf416b;'));

  const footerPatch = deterministicService.buildContentEditOperationBatch({
    projectInfo,
    executionIntent: 'edit_project',
    userMessage: 'Insira um Rodapé no site com cor contrastante',
  });
  assert.strictEqual(footerPatch.ok, true);
  assert.strictEqual(footerPatch.action.targetFile, 'index.php');
  assert.ok(footerPatch.action.operations[0].content.includes('<footer class="site-footer">'));
}

async function testPluginFrameworkCreationPreviewAndVerification(tempRoot) {
  const rootPath = path.join(tempRoot, 'astro-product');
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
          ],
        },
      },
    ],
  });
  const blueprintService = createProjectBlueprintService({ stackRegistry });
  const blueprint = blueprintService.buildProjectBlueprintOperationBatch({
    projectInfo: { rootPath },
    userMessage: 'criar site institucional em Astro com placeholders',
    executionIntent: 'init_project',
    buildOperationBatchDiffPreview,
  });

  assert.strictEqual(blueprint.ok, true);
  assert.strictEqual(blueprint.raw, 'project_blueprint:astro');
  assert.strictEqual(blueprint.action.targetFile, 'src/pages/index.astro');
  assert.strictEqual(blueprintService.hasRequiredProjectBlueprintFiles({
    operations: blueprint.action.operations,
    userMessage: 'site institucional em Astro',
  }), true);

  const files = applyOperations(rootPath, blueprint.action.operations);
  const projectInfo = createProjectInfo(rootPath, files, ['Astro']);

  const previewService = createProjectPreviewService({ fs, path });
  const blockedPreview = previewService.buildProjectPreviewPlan(projectInfo);
  assert.strictEqual(blockedPreview.ready, false);
  assert.strictEqual(blockedPreview.stack, 'Node');
  assert.strictEqual(blockedPreview.commandText, 'npm run dev -- --host 127.0.0.1 --port 5173');

  fs.mkdirSync(path.join(rootPath, 'node_modules'), { recursive: true });
  writeLocalBin(rootPath, 'astro');
  const readyPreview = previewService.buildProjectPreviewPlan(projectInfo, { port: 5179 });
  assert.strictEqual(readyPreview.ready, true);
  assert.strictEqual(readyPreview.commandText, 'npm run dev -- --host 127.0.0.1 --port 5179');

  const verificationCalls = [];
  const verificationService = createProjectVerificationService({
    fs,
    path,
    runCommand: async (bin, args, options) => {
      verificationCalls.push({ bin, args, options });
      return { ok: true, stdout: '', stderr: '' };
    },
  });
  const verification = await verificationService.runProjectVerification(projectInfo);
  assert.strictEqual(verification.ready, true);
  assert.deepStrictEqual(verificationCalls.map((call) => [call.bin, call.args.join(' ')]), [
    ['npm', 'run build'],
  ]);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-product-toolchain-'));
  try {
    await testNextCreationPreviewVerificationAndEditing(tempRoot);
    await testLampCreationPreviewVerificationAndEditing(tempRoot);
    await testPluginFrameworkCreationPreviewAndVerification(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('product-toolchain-contract.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
