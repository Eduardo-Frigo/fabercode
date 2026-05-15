const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPostExecutionQualityService } = require('../main/services/post_execution_quality_service');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-post-quality-'));
  try {
    writeFile(path.join(tempRoot, 'index.html'), '<img src="missing.png"><link rel="stylesheet" href="style.css">');
    writeFile(path.join(tempRoot, 'style.css'), 'body { color: #111; ');
    writeFile(path.join(tempRoot, 'bad.js'), 'function broken( {');

    const commandCalls = [];
    const service = createPostExecutionQualityService({
      AIDER_MAIN_ROOT: path.join(tempRoot, 'aider-missing'),
      EXECUTION_ENFORCE_EFFECT_GATE: true,
      EXECUTION_ENFORCE_NONZERO_DIFF_ON_EDIT: true,
      POST_EXEC_QUALITY_ENABLED: true,
      POST_EXEC_QUALITY_ENFORCE_ERRORS: true,
      POST_EXEC_QUALITY_ENFORCE_WARNINGS: false,
      POST_EXEC_QUALITY_MAX_FILES: 10,
      POST_EXEC_QUALITY_MAX_ISSUES: 20,
      POST_EXEC_QUALITY_TIMEOUT_MS: 5000,
      clipTextPreserveLines: (value, max) => String(value || '').slice(0, max),
      fs,
      path,
      runCommand: async (bin, args, options) => {
        commandCalls.push({ bin, args, options });
        if (bin === 'node' && args[0] === '--check') {
          return { ok: false, stdout: '', stderr: 'SyntaxError: Unexpected token' };
        }
        return { ok: true, stdout: '', stderr: '' };
      },
    });

    const report = await service.runPostExecutionQualityReport(
      {
        rootPath: tempRoot,
        files: ['index.html', 'style.css', 'bad.js'],
      },
      {
        modifiedFiles: ['style.css', 'bad.js'],
        userMessage: 'corrigir layout',
        attachments: [{ name: 'brief.md' }],
      }
    );

    assert.strictEqual(report.enabled, true);
    assert.strictEqual(report.summary.checkedFiles, 3);
    assert.strictEqual(report.summary.modifiedFiles, 2);
    assert.ok(report.summary.errors >= 2);
    assert.ok(report.summary.warnings >= 1);
    assert.ok(report.issues.some((issue) => issue.source === 'css_balance'));
    assert.ok(report.issues.some((issue) => issue.source === 'node_check'));
    assert.ok(report.issues.some((issue) => issue.source === 'html_asset_missing'));
    assert.strictEqual(commandCalls.length, 1);

    const promptContext = service.buildDiagnosticsPromptContext(report, { maxIssues: 2, maxChars: 600 });
    assert.ok(promptContext.includes('Diagnóstico anterior:'));

    const hint = service.buildDiagnosticsHintFromQualityReport(report);
    assert.strictEqual(hint.issues.length > 0, true);

    const outcome = service.buildExecutionOutcomeReport({
      modifiedFiles: ['style.css'],
      diffStats: { 'style.css': { add: 2, del: 1 } },
    }, report);
    assert.ok(outcome.text.includes('Linhas adicionadas: +2'));
    assert.deepStrictEqual(outcome.totals, { add: 2, del: 1, files: 1 });

    const effectOk = service.evaluateExecutionEffectGate(
      { type: 'operation_batch', intent: 'edit_project' },
      { modifiedFiles: ['style.css'] },
      outcome
    );
    assert.strictEqual(effectOk.shouldBlock, false);

    const noEffect = service.evaluateExecutionEffectGate(
      { type: 'operation_batch', intent: 'edit_project' },
      { modifiedFiles: [] },
      { totals: { add: 0, del: 0 } }
    );
    assert.strictEqual(noEffect.shouldBlock, true);
    assert.ok(service.buildExecutionEffectGateMessage(noEffect).includes('não alterou'));

    const qualityGate = service.evaluatePostExecutionGate(report);
    assert.strictEqual(qualityGate.shouldBlock, true);
    assert.ok(service.buildPostExecutionGateMessage(qualityGate).includes('pós-execução'));

    writeFile(path.join(tempRoot, 'ok.php'), '<?php echo "ok"; ?>');
    const phpUnavailableService = createPostExecutionQualityService({
      AIDER_MAIN_ROOT: path.join(tempRoot, 'aider-missing'),
      POST_EXEC_QUALITY_ENABLED: true,
      POST_EXEC_QUALITY_ENFORCE_ERRORS: true,
      POST_EXEC_QUALITY_ENFORCE_WARNINGS: false,
      fs,
      path,
      runCommand: async (bin) => {
        if (bin === 'php') {
          return { ok: false, code: null, stdout: '', stderr: 'spawn php ENOENT' };
        }
        return { ok: true, stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(
      phpUnavailableService.isCommandUnavailableResult({ ok: false, stderr: 'spawn php ENOENT' }, 'php'),
      true
    );

    const phpReport = await phpUnavailableService.runPostExecutionQualityReport(
      {
        rootPath: tempRoot,
        files: ['ok.php'],
      },
      {
        modifiedFiles: ['ok.php'],
      }
    );
    assert.strictEqual(phpReport.summary.errors, 0);
    assert.strictEqual(phpReport.summary.warnings, 1);
    assert.ok(phpReport.issues.some((issue) => issue.source === 'php_lint_unavailable'));
    assert.strictEqual(phpUnavailableService.evaluatePostExecutionGate(phpReport).shouldBlock, false);

    const artifactWarningService = createPostExecutionQualityService({
      AIDER_MAIN_ROOT: path.join(tempRoot, 'aider-missing'),
      POST_EXEC_QUALITY_ENABLED: true,
      POST_EXEC_QUALITY_ENFORCE_ERRORS: true,
      POST_EXEC_QUALITY_ENFORCE_WARNINGS: false,
      fs,
      path,
      evaluateOperationBatchArtifactQuality: () => ({
        enabled: true,
        score: 35,
        minScore: 70,
        passesMinimum: false,
        issues: [
          {
            id: 'css_substantial',
            severity: 'critical',
            detail: 'CSS insuficiente para uma página institucional.',
            hint: 'Expandir style.css.',
          },
        ],
      }),
      runCommand: async () => ({ ok: true, stdout: '', stderr: '' }),
    });
    writeFile(path.join(tempRoot, 'index.html'), '<main><h1>Site institucional</h1><link rel="stylesheet" href="./style.css"></main>');
    writeFile(path.join(tempRoot, 'style.css'), 'body { color: #111; }');
    const artifactReport = await artifactWarningService.runPostExecutionQualityReport(
      {
        rootPath: tempRoot,
        files: ['index.html', 'style.css'],
      },
      {
        modifiedFiles: ['index.html', 'style.css'],
        userMessage: 'criar site institucional',
        executionIntent: 'init_project',
      }
    );
    assert.strictEqual(artifactReport.summary.artifactQuality.score, 35);
    assert.ok(artifactReport.issues.some((issue) => issue.source === 'artifact_quality:css_substantial'));
    assert.ok(artifactReport.issues.some((issue) => issue.source === 'artifact_quality:css_substantial' && issue.severity === 'error'));
    assert.strictEqual(artifactWarningService.evaluatePostExecutionGate(artifactReport).shouldBlock, true);

    console.log('post-execution-quality-service.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
