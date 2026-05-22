const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildSemanticRequirementsFromPrompt,
  createCortexValidationService,
} = require('../cortex/orchestration/validation_service');
const { createArtifactQualityService } = require('../cortex/orchestration/artifact_quality_service');

function normalizeRequestedRelativePath(rawPath) {
  if (!rawPath) return null;
  const normalized = String(rawPath).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null;
  return normalized;
}

function createService(options = {}) {
  return createCortexValidationService({
    CORTEX_VALIDATION_MIN_SCORE: 55,
    CORTEX_VALIDATION_REQUIRE_CORE: true,
    CORTEX_VALIDATION_REPAIR_MIN_IMPROVEMENT: 2,
    excludedDirs: new Set(['node_modules']),
    fs,
    path,
    normalizeRequestedRelativePath,
    ...options,
  });
}

function run() {
  const artifactQualityService = createArtifactQualityService({ fs, path, minArtifactQualityScore: 70 });
  assert.deepStrictEqual(
    buildSemanticRequirementsFromPrompt('Criar FAQ, planos, WhatsApp e contato'),
    ['faq', 'plans', 'whatsapp', 'contact']
  );

  const service = createService();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-validation-service-'));
  try {
    fs.writeFileSync(
      path.join(tempRoot, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="./style.css"><script src="./script.js"></script></head><body>Serviços, contato, faq e whatsapp.</body></html>',
      'utf8'
    );
    fs.writeFileSync(path.join(tempRoot, 'style.css'), 'body { color: #111; }', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'script.js'), 'console.log("ok");', 'utf8');
    fs.mkdirSync(path.join(tempRoot, 'node_modules'));
    fs.writeFileSync(path.join(tempRoot, 'node_modules', 'ignored.js'), 'ignored', 'utf8');

    const ready = service.evaluateExecutionReadiness({
      operations: [
        {
          op: 'write_file',
          path: 'index.html',
          content:
            '<!doctype html><html><head><link rel="stylesheet" href="./style.css"><script src="./script.js"></script></head><body>FAQ, contato e WhatsApp.</body></html>',
        },
      ],
      projectRootPath: tempRoot,
      executionIntent: 'edit_project',
      userMessage: 'corrigir FAQ, contato e WhatsApp',
    });
    assert.strictEqual(ready.ready, true);
    assert.strictEqual(ready.coreChecksPassed, true);
    assert.strictEqual(ready.checks.cssLinked, true);
    assert.strictEqual(ready.checks.jsLinked, true);
    assert.ok(ready.semanticCoverage >= 0.6);

    const patchFirstBlocked = service.evaluateExecutionReadiness({
      operations: [
        { op: 'write_file', path: 'new-index.html', content: '<main>novo</main>' },
        { op: 'write_file', path: 'new-style.css', content: 'body{}' },
        { op: 'write_file', path: 'new-script.js', content: 'console.log(1)' },
        { op: 'write_file', path: 'extra.html', content: 'extra' },
      ],
      projectRootPath: tempRoot,
      executionIntent: 'edit_project',
      userMessage: 'corrigir layout atual',
    });
    assert.strictEqual(patchFirstBlocked.checks.patchFirst, false);
    assert.strictEqual(patchFirstBlocked.ready, false);

    const artifactAwareService = createService({
      evaluateOperationBatchArtifactQuality: artifactQualityService.evaluateOperationBatchArtifactQuality,
    });
    const microTitleEdit = artifactAwareService.evaluateExecutionReadiness({
      operations: [
        {
          op: 'write_file',
          path: 'index.html',
          content:
            '<!doctype html><html><head><link rel="stylesheet" href="./style.css"><script src="./script.js"></script><title>ESSE É UM TESTE</title></head><body><h1>ESSE É UM TESTE</h1><p>FAQ, contato e WhatsApp.</p></body></html>',
        },
      ],
      projectRootPath: tempRoot,
      executionIntent: 'edit_project',
      userMessage: 'Mude o título da página já desenvolvida para "ESSE É UM TESTE"',
      artifactContext: 'Projeto institucional com CSS e seções já existentes.',
    });
    assert.strictEqual(microTitleEdit.ready, true);
    assert.strictEqual(microTitleEdit.artifactQuality, null);

    const weakArtifact = artifactAwareService.evaluateExecutionReadiness({
      operations: [
        {
          op: 'write_file',
          path: 'index.html',
          content:
            '<h1>Título principal</h1><p>Subtítulo</p><section>Serviço 1</section><section>Contato</section>',
        },
        { op: 'write_file', path: 'style.css', content: 'body { font-family: Arial; }' },
      ],
      projectRootPath: tempRoot,
      executionIntent: 'init_project',
      userMessage: 'Para uma página inicial apenas',
      artifactContext: 'Criar site institucional em LAMP para veterinário com placeholders.',
    });
    assert.strictEqual(weakArtifact.ready, false);
    assert.strictEqual(weakArtifact.checks.artifactStack, false);
    assert.strictEqual(weakArtifact.checks.artifactCss, false);
    assert.strictEqual(weakArtifact.artifactQuality.passesMinimum, false);

    const nextReady = service.evaluateExecutionReadiness({
      operations: [
        { op: 'write_file', path: 'package.json', content: '{"dependencies":{"next":"^16.0.0","react":"^19.0.0"}}' },
        { op: 'write_file', path: 'app/page.tsx', content: 'export default function Page(){return <main>Next com Tailwind</main>}' },
      ],
      projectRootPath: tempRoot,
      executionIntent: 'init_project',
      userMessage: 'criar página institucional em Next.js com Tailwind',
    });
    assert.strictEqual(nextReady.checks.runnableEntry, true);

    const nextLateCssImport = service.evaluateExecutionReadiness({
      operations: [
        { op: 'write_file', path: 'package.json', content: '{"dependencies":{"next":"^16.0.0","react":"^19.0.0","tailwindcss":"^4.0.0"}}' },
        { op: 'write_file', path: 'app/page.tsx', content: 'export default function Page(){return <main>Next com Tailwind</main>}' },
        { op: 'write_file', path: 'app/globals.css', content: 'body { margin: 0; }\n@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");\n:root { --color-bg: #fff; }' },
      ],
      projectRootPath: tempRoot,
      executionIntent: 'init_project',
      userMessage: 'criar página institucional em Next.js com Tailwind',
    });
    assert.strictEqual(nextLateCssImport.checks.cssImportOrder, false);
    assert.strictEqual(nextLateCssImport.coreChecksPassed, false);
    assert.strictEqual(nextLateCssImport.ready, false);
    assert.deepStrictEqual(nextLateCssImport.cssImportOrderViolations.map((entry) => entry.path), ['app/globals.css']);

    const nextWithoutEntry = service.evaluateExecutionReadiness({
      operations: [
        { op: 'write_file', path: 'README.md', content: 'Next sem página' },
      ],
      projectRootPath: null,
      executionIntent: 'init_project',
      userMessage: 'criar página institucional em Next.js com Tailwind',
    });
    assert.strictEqual(nextWithoutEntry.checks.runnableEntry, false);
    assert.strictEqual(nextWithoutEntry.ready, false);

    const noCore = { ready: false, score: 40, coreChecksPassed: false, missingRequiredFiles: ['index.html'] };
    const betterScore = { ready: false, score: 45, coreChecksPassed: false, missingRequiredFiles: ['index.html'] };
    const coreReady = { ready: false, score: 45, coreChecksPassed: true, missingRequiredFiles: ['index.html'] };
    const fewerMissing = { ready: false, score: 40, coreChecksPassed: false, missingRequiredFiles: [] };
    assert.strictEqual(service.hasValidationCoverageImproved(noCore, betterScore), true);
    assert.strictEqual(service.hasValidationCoverageImproved(noCore, coreReady), true);
    assert.strictEqual(service.hasValidationCoverageImproved(noCore, fewerMissing), true);
    assert.strictEqual(service.hasValidationCoverageImproved(betterScore, noCore), false);

    const merged = service.mergeOperationBatches(
      [
        { op: 'mkdir', path: 'src' },
        { op: 'write_file', path: 'src/app.js', content: 'old' },
        { op: 'custom', path: 'x/y', value: 1 },
      ],
      [
        { op: 'mkdir', path: './src' },
        { op: 'write_file', path: 'src/app.js', content: 'new' },
        { op: 'append_file', path: 'src/log.js', content: 'log' },
      ]
    );
    assert.deepStrictEqual(merged, [
      { op: 'mkdir', path: 'src' },
      { op: 'write_file', path: 'src/app.js', content: 'new' },
      { op: 'append_file', path: 'src/log.js', content: 'log' },
      { op: 'custom', path: 'x/y', value: 1 },
    ]);

    console.log('validation-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
