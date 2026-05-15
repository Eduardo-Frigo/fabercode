const assert = require('assert');

const {
  createCortexRenderPassService,
  isPatchFirstGuardrailMessage,
  looksLikeScaffoldRewriteBatch,
  normalizeEngineOperation,
  validatePatchFirstOperationBatch,
} = require('../cortex/orchestration/render_pass_service');
const { createArtifactQualityService } = require('../cortex/orchestration/artifact_quality_service');

const artifactQualityService = createArtifactQualityService({ minArtifactQualityScore: 70 });

function clipText(value, max = 4000) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max) : text;
}

function tryParseJsonObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validateOperationBatchPlan(plan) {
  if (!plan || !Array.isArray(plan.operations)) {
    return { ok: false, errors: ['operations required'] };
  }
  return {
    ok: true,
    value: {
      summary: plan.summary || 'summary fallback',
      operations: plan.operations,
    },
  };
}

function buildOperationBatchDiffPreview(operations = []) {
  return operations.map((operation) => `${operation.op}:${operation.path}`).join('\n');
}

function createService(overrides = {}) {
  return createCortexRenderPassService({
    AI_REQUEST_TIMEOUT_MS: 1234,
    PERSONA_MODEL_ENGINE: 'engine-model',
    buildAttachmentsPromptContext: async () => 'attachment text',
    buildArtifactQualityPromptGuidance: artifactQualityService.buildArtifactQualityPromptGuidance,
    buildDeterministicPatchOperationBatch: () => null,
    buildDiagnosticsPromptContext: () => 'diagnostics text',
    buildLocalProjectDiagnostics: () => ({ htmlFilesWithoutStylesheet: ['index.html'] }),
    buildOperationBatchDiffPreview,
    buildProjectEvolutionContext: () => 'project evolution text',
    buildRuntimeBudget: (runtimeSettings) => ({
      maxOperationsPerPass: runtimeSettings.maxOperationsPerPass,
      maxPromptCharsPerPass: 5000,
      generationOptions: { num_predict: 900 },
    }),
    callPersonaProviderChat: async () => JSON.stringify({
      summary: 'Plano ok',
      operations: [
        { action: 'folder', path: 'src' },
        { type: 'file', path: 'src/app.js', content: 'console.log("ok")' },
      ],
    }),
    clipText,
    evaluateOperationBatchArtifactQuality: artifactQualityService.evaluateOperationBatchArtifactQuality,
    formatArtifactQualityForPrompt: artifactQualityService.formatArtifactQualityForPrompt,
    formatLocalProjectDiagnosticsForPrompt: () => 'local diagnostics text',
    formatMempalaceCoreForPrompt: () => 'mempalace core text',
    getRuntimeProfileSettings: () => ({
      engineSampleFilesLimit: 2,
      maxOperationsPerPass: 8,
      generationOptions: { num_predict: 900 },
    }),
    normalizeRequestedRelativePath: (value) => {
      const raw = String(value || '').trim();
      if (!raw || raw.startsWith('/') || raw.includes('..')) return null;
      return raw.replace(/^\.\/+/, '');
    },
    tryParseJsonObject,
    validateOperationBatchPlan,
    ...overrides,
  });
}

async function run() {
  assert.deepStrictEqual(normalizeEngineOperation({ action: 'folder', dir: './src' }), {
    op: 'mkdir',
    path: 'src',
  });
  assert.deepStrictEqual(normalizeEngineOperation({ type: 'file', path: 'index.html', content: '<main />' }), {
    op: 'write_file',
    path: 'index.html',
    content: '<main />',
  });
  assert.strictEqual(normalizeEngineOperation({ op: 'write_file', path: '../escape.js', content: '' }), null);
  assert.strictEqual(looksLikeScaffoldRewriteBatch([
    { op: 'write_file', path: 'index.html' },
    { op: 'write_file', path: 'style.css' },
    { op: 'write_file', path: 'script.js' },
  ]), true);
  assert.strictEqual(isPatchFirstGuardrailMessage('Plano rejeitado no modo edit_project'), true);

  const patchFirst = validatePatchFirstOperationBatch({
    projectInfo: { totalFiles: 4, files: ['src/app.js'] },
    operations: [
      { op: 'write_file', path: 'index.html' },
      { op: 'write_file', path: 'style.css' },
      { op: 'write_file', path: 'script.js' },
    ],
    executionIntent: 'edit_project',
    userMessage: 'corrigir o layout atual',
  });
  assert.strictEqual(patchFirst.ok, false);

  const providerCalls = [];
  const service = createService({
    callPersonaProviderChat: async (model, messages, timeoutMs, options) => {
      providerCalls.push({ model, messages, timeoutMs, options });
      return JSON.stringify({
        summary: 'Criar app',
        operations: [
          { op: 'mkdir', path: 'src' },
          { op: 'write_file', path: 'src/app.js', content: 'console.log("app")' },
        ],
      });
    },
  });

  const result = await service.requestEngineOperationBatchAction({
    projectInfo: {
      rootPath: '/tmp/project',
      stacks: ['Node'],
      totalFiles: 0,
      counters: { js: 0 },
      files: ['README.md'],
    },
    userMessage: 'criar app',
    attachments: [{ name: 'brief.md', type: 'text/markdown' }],
    mempalaceContext: { contextText: 'memory text' },
    mempalaceCore: { ok: true },
    ragContext: { provider: 'r2r', contextText: 'rag text' },
    cortexContext: { available: true, contextText: 'cortex text' },
    workGraph: { brief: 'brief text', briefSpec: { pages: [] }, acceptanceCriteria: ['ok'] },
    runtimeBudget: {
      maxOperationsPerPass: 10,
      maxPromptCharsPerPass: 5000,
      generationOptions: { num_predict: 900 },
    },
    latestDiagnostics: { issues: [] },
    executionIntent: 'init_project',
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.action.type, 'operation_batch');
  assert.strictEqual(result.action.intent, 'init_project');
  assert.strictEqual(result.action.targetFile, 'src/app.js');
  assert.strictEqual(result.action.operations.length, 2);
  assert.ok(result.action.diffPreview.includes('write_file:src/app.js'));
  assert.strictEqual(providerCalls[0].model, 'engine-model');
  assert.strictEqual(providerCalls[0].timeoutMs, 1234);
  assert.strictEqual(providerCalls[0].options.options.num_predict, 900);
  assert.ok(providerCalls[0].messages[1].content.includes('brief text'));
  assert.ok(providerCalls[0].messages[1].content.includes('mempalace core text'));
  assert.ok(providerCalls[0].messages[1].content.includes('attachment text'));

  const deterministicService = createService({
    buildDeterministicPatchOperationBatch: () => ({
      ok: true,
      action: { type: 'operation_batch', operations: [{ op: 'write_file', path: 'index.html', content: '' }] },
      raw: 'deterministic',
    }),
    callPersonaProviderChat: async () => {
      throw new Error('should not call provider');
    },
  });
  const deterministic = await deterministicService.requestEngineOperationBatchAction({
    projectInfo: { rootPath: '/tmp/project', totalFiles: 1, files: ['index.html'] },
    userMessage: 'corrigir css',
    executionIntent: 'edit_project',
  });
  assert.strictEqual(deterministic.raw, 'deterministic');

  let repairCalls = 0;
  const repairService = createService({
    callPersonaProviderChat: async () => {
      repairCalls += 1;
      if (repairCalls === 1) return 'not json';
      return JSON.stringify({
        summary: 'Repair ok',
        operations: [{ op: 'write_file', path: 'src/app.js', content: 'fixed' }],
      });
    },
  });
  const repaired = await repairService.requestEngineOperationBatchAction({
    projectInfo: { rootPath: '/tmp/project', totalFiles: 0, files: [] },
    userMessage: 'criar app',
    executionIntent: 'init_project',
  });
  assert.strictEqual(repaired.ok, true);
  assert.strictEqual(repairCalls, 2);
  assert.strictEqual(repaired.action.summary, 'Repair ok');

  let invalidInitCalls = 0;
  const invalidInitService = createService({
    callPersonaProviderChat: async () => {
      invalidInitCalls += 1;
      return 'not json';
    },
  });
  const invalidInit = await invalidInitService.requestEngineOperationBatchAction({
    projectInfo: { rootPath: '/tmp/project', totalFiles: 0, files: [] },
    userMessage: 'criar site institucional com placeholder rápido',
    executionIntent: 'init_project',
  });
  assert.strictEqual(invalidInit.ok, true);
  assert.strictEqual(invalidInitCalls, 0);
  assert.strictEqual(invalidInit.action.generatedBy, 'project_blueprint_service');
  assert.deepStrictEqual(invalidInit.action.operations.map((operation) => operation.path), [
    'index.html',
    'style.css',
    'script.js',
  ]);

  const partialLampService = createService({
    callPersonaProviderChat: async () => JSON.stringify({
      summary: 'Parcial',
      operations: [{ op: 'write_file', path: 'README.md', content: 'parcial' }],
    }),
  });
  const partialLamp = await partialLampService.requestEngineOperationBatchAction({
    projectInfo: { rootPath: '/tmp/project', totalFiles: 0, files: [] },
    userMessage: 'criar site institucional em LAMP com placeholder rápido',
    executionIntent: 'init_project',
  });
  assert.strictEqual(partialLamp.ok, true);
  assert.strictEqual(partialLamp.action.generatedBy, 'project_blueprint_service');
  assert.deepStrictEqual(partialLamp.action.operations.map((operation) => operation.path), [
    'index.php',
    'style.css',
    'script.js',
  ]);

  let weakProviderCalls = 0;
  const weakContextualLampService = createService({
    callPersonaProviderChat: async () => {
      weakProviderCalls += 1;
      return JSON.stringify({
        summary: 'Plano fraco',
        operations: [
          { op: 'write_file', path: 'index.html', content: '<h1>Título principal</h1><p>Subtítulo</p><section>Serviço 1</section><section>Contato</section>' },
          { op: 'write_file', path: 'style.css', content: 'body { font-family: Arial; }' },
          { op: 'write_file', path: 'script.js', content: '' },
        ],
      });
    },
  });
  const weakContextualLamp = await weakContextualLampService.requestEngineOperationBatchAction({
    projectInfo: { rootPath: '/tmp/project', totalFiles: 0, files: [] },
    userMessage: 'Para uma página inicial apenas',
    workGraph: {
      brief: 'Criar site institucional em LAMP para veterinário com placeholders autorizados.',
      briefSpec: { stack: 'LAMP', domain: 'veterinário' },
      acceptanceCriteria: ['usar index.php', 'CSS responsivo e substancial'],
    },
    executionIntent: 'init_project',
  });
  assert.strictEqual(weakProviderCalls, 0);
  assert.strictEqual(weakContextualLamp.ok, true);
  assert.strictEqual(weakContextualLamp.action.generatedBy, 'project_blueprint_service');
  assert.deepStrictEqual(weakContextualLamp.action.operations.map((operation) => operation.path), [
    'index.php',
    'style.css',
    'script.js',
  ]);

  let nextBlueprintCalls = 0;
  const nextBlueprintService = createService({
    callPersonaProviderChat: async () => {
      nextBlueprintCalls += 1;
      throw new Error('should not call provider for authorized Next blueprint');
    },
  });
  const nextBlueprint = await nextBlueprintService.requestEngineOperationBatchAction({
    projectInfo: { rootPath: '/tmp/project', totalFiles: 0, files: [] },
    userMessage: 'criar página institucional em Next.js com React e Tailwind usando placeholders',
    executionIntent: 'init_project',
  });
  assert.strictEqual(nextBlueprintCalls, 0);
  assert.strictEqual(nextBlueprint.ok, true);
  assert.strictEqual(nextBlueprint.action.generatedBy, 'project_blueprint_service');
  assert.ok(nextBlueprint.action.operations.some((operation) => operation.path === 'package.json'));
  assert.ok(nextBlueprint.action.operations.some((operation) => operation.path === 'app/page.tsx'));
  assert.ok(nextBlueprint.action.operations.some((operation) => operation.path === 'app/globals.css'));

  console.log('render-pass-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
