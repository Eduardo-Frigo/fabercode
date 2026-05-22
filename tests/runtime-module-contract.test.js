const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function load(relativePath) {
  return require(path.join(rootDir, relativePath));
}

const { createFileTextUtils } = load('main/runtime/file_text_utils');
const { createProjectStore } = load('main/runtime/project_store');
const { createProjectContextService } = load('main/runtime/project_context');
const { createAttachmentContextService } = load('main/runtime/attachment_context');
const { buildOperationBatchDiffPreview } = load('main/runtime/diff_preview');
const { createCssRuntimeRepairService } = load('main/services/css_runtime_repair_service');
const { createJobStateStore } = load('cortex/orchestration/state_store_jobs');

const textUtils = createFileTextUtils({ crypto });
assert.strictEqual(typeof textUtils.clipText, 'function');
assert.strictEqual(typeof textUtils.clipTextPreserveLines, 'function');
assert.strictEqual(textUtils.hashText('abc'), crypto.createHash('sha256').update('abc', 'utf8').digest('hex'));
assert.strictEqual(textUtils.isTextLikeExtension('.tsx'), true);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-project-store-'));
const projectStore = createProjectStore({ fs, path, getUserDataPath: () => tempRoot });
projectStore.writeProjects([{ id: 'p1', name: 'Projeto 1', rootPath: '/tmp/projeto' }]);
assert.strictEqual(projectStore.readProjects().length, 1);
assert.strictEqual(projectStore.readProjects()[0].state, 'active');

const projectContext = createProjectContextService({
  CORTEX_STOPWORDS: new Set(['com']),
  MAX_CORTEX_CONTEXT_ITEMS: 4,
  clipText: textUtils.clipText,
  clipTextPreserveLines: textUtils.clipTextPreserveLines,
  fs,
  getCortexLearning: () => ({
    ok: true,
    learning: {
      persona: ['Site para estufas com orçamento'],
      executor: ['Gerar landing page comercial'],
      events: [],
    },
  }),
  path,
});
assert.deepStrictEqual(projectContext.extractIntentTerms('Site com estufas comerciais'), ['site', 'estufas', 'comerciais']);
assert.strictEqual(projectContext.buildCortexPromptContext('p1', 'estufas orçamento', { profile: 'padrao' }).available, true);

const attachmentContext = createAttachmentContextService({
  clipTextPreserveLines: textUtils.clipTextPreserveLines,
  fs,
  isTextLikeExtension: textUtils.isTextLikeExtension,
  path,
  runCommand: async () => ({ ok: false }),
});
assert.strictEqual(typeof attachmentContext.buildAttachmentsPromptContext, 'function');

const diff = buildOperationBatchDiffPreview([{ op: 'write_file', path: 'index.html', content: '<h1>Ok</h1>' }]);
assert.ok(diff.includes('+++ b/index.html'));

const cssRepair = createCssRuntimeRepairService({ fs, path });
assert.strictEqual(cssRepair.isCssRuntimeRepairRequest('CSS sem estilo no site'), true);
assert.deepStrictEqual(cssRepair.repairInvalidCssCustomPropertyReferences('color: var(---accent);'), {
  changed: true,
  content: 'color: var(--accent);',
  replacements: 1,
});

const jobStateStore = createJobStateStore({
  appendAuditEvent: () => {},
  computeRetryBackoffMs: () => 1000,
  isNonRetriableProviderReason: () => false,
  readJobsState: () => ({ jobsById: {}, jobOrder: [] }),
  writeJobsState: () => {},
});
assert.deepStrictEqual(jobStateStore.listJobs(), { ok: true, jobs: [] });

console.log('runtime-module-contract.test.js: ok');
