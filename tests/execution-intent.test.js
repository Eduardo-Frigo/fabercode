const assert = require('assert');

const {
  hasApplicationSurfaceFiles,
  hasExplicitProjectRebuildIntent,
  resolveExecutionIntentFromContext,
  stripNegatedIntentClauses,
} = require('../cortex/orchestration/execution_intent');

const hasScaffoldIntent = (message) => /\b(criar|crie|gerar|gere|desenvolver|desenvolva)\b/.test(message) && /\b(site|app|sistema|landing)\b/.test(message);
const hasEditIntent = (message) => /\b(criar|crie|corrigir|corrija|ajustar|ajuste|adicionar|adicione)\b/.test(message);
const hasProjectEvolutionIntent = (message) => /\b(site atual|projeto atual|melhore|corrigir)\b/.test(message);

function resolve(userMessage, projectInfo = {}, contextHint = {}) {
  return resolveExecutionIntentFromContext({
    userMessage,
    contextHint,
    projectInfo,
    hasScaffoldIntent,
    hasEditIntent,
    hasProjectEvolutionIntent,
  });
}

function run() {
  assert.strictEqual(hasExplicitProjectRebuildIntent('vamos refazer do zero'), true);
  assert.strictEqual(
    stripNegatedIntentClauses('site institucional. nao e saas, nao e dashboard, nao e app interno. usar html.'),
    'site institucional. usar html.'
  );
  assert.strictEqual(
    stripNegatedIntentClauses('site institucional. nao reaproveite dashboard, saas, pipeline ou demo. usar html.'),
    'site institucional. usar html.'
  );
  assert.strictEqual(hasApplicationSurfaceFiles({ files: ['README.md', '.env'] }), false);
  assert.strictEqual(hasApplicationSurfaceFiles({ files: ['README.md', 'index.php'] }), true);
  assert.strictEqual(hasApplicationSurfaceFiles({ files: ['src/app.js'] }), true);

  assert.strictEqual(
    resolve('criar site institucional em LAMP com placeholder rápido', { totalFiles: 0, files: [] }),
    'init_project'
  );
  assert.strictEqual(
    resolve('criar site institucional', { totalFiles: 1, files: ['README.md'] }),
    'init_project'
  );
  assert.strictEqual(
    resolve('corrigir link do CSS', { totalFiles: 2, files: ['index.html', 'style.css'] }),
    'edit_project'
  );
  assert.strictEqual(
    resolve('criar site institucional', { totalFiles: 2, files: ['index.html', 'style.css'] }),
    'edit_project'
  );
  assert.strictEqual(
    resolve('criar site institucional do zero', { totalFiles: 2, files: ['index.html', 'style.css'] }),
    'init_project'
  );

  console.log('execution-intent.test.js: ok');
}

run();
