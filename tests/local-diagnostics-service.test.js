const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLocalDiagnosticsService } = require('../main/services/local_diagnostics_service');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-local-diagnostics-'));
  try {
    writeFile(path.join(tempRoot, 'index.html'), '<main>Hero Título principal</main>');
    writeFile(path.join(tempRoot, 'style.css'), 'body { color: var(----brand); }');

    const service = createLocalDiagnosticsService({ fs, path });
    const projectInfo = {
      rootPath: tempRoot,
      totalFiles: 2,
      files: ['index.html', 'style.css'],
    };

    const diagnostics = service.buildLocalProjectDiagnostics({
      projectInfo,
      userMessage: 'corrigir o layout visual do site',
      attachments: [{ name: 'brief.md' }],
    });

    assert.strictEqual(diagnostics.mode, 'edit_project');
    assert.deepStrictEqual(diagnostics.htmlFiles, ['index.html']);
    assert.deepStrictEqual(diagnostics.cssFiles, ['style.css']);
    assert.deepStrictEqual(diagnostics.htmlFilesWithoutStylesheet, ['index.html']);
    assert.strictEqual(diagnostics.invalidCssVarRefs[0].file, 'style.css');
    assert.strictEqual(diagnostics.hasAttachments, true);
    assert.ok(diagnostics.suggestedExecutionMessage.includes('Conecte o CSS existente'));

    const prompt = service.formatLocalProjectDiagnosticsForPrompt(diagnostics);
    assert.ok(prompt.includes('Modo local sugerido: edit_project'));
    assert.ok(prompt.includes('Achados acionáveis:'));

    assert.strictEqual(service.hasExistingProjectFiles(projectInfo), true);
    assert.strictEqual(service.hasEditIntent('adicione uma seção'), true);
    assert.strictEqual(service.hasProjectEvolutionIntent('melhore o site atual', { lastHadAction: true }), true);
    assert.strictEqual(service.hasCssOrVisualRepairIntent('corrigir css quebrado'), true);
    assert.strictEqual(service.shouldForceExecutionFromLocalDiagnostics({
      userMessage: 'corrigir o layout visual',
      projectInfo,
      localDiagnostics: diagnostics,
      contextHint: { lastHadAction: true },
    }), true);

    console.log('local-diagnostics-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
