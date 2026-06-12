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
const { createCortexRuntimeJobService } = load('main/services/cortex_runtime_job_service');
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

const graphRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-project-graph-'));
try {
  fs.mkdirSync(path.join(graphRoot, 'app'), { recursive: true });
  fs.mkdirSync(path.join(graphRoot, 'src', 'store'), { recursive: true });
  fs.writeFileSync(
    path.join(graphRoot, 'app', 'page.tsx'),
    "import { useForgeMrpStore } from '../src/store/mrp_store';\nexport default function Page(){ const store = useForgeMrpStore(); return <main>{store.snapshot.items.length}</main>; }\n",
    'utf8'
  );
  fs.writeFileSync(
    path.join(graphRoot, 'src', 'store', 'mrp_store.ts'),
    "import { create } from 'zustand';\ntype ForgeMrpState = { status: string; setStatus: (status: string) => void };\nexport const useForgeMrpStore = create<ForgeMrpState>(() => ({ status: 'DRAFT', setStatus: () => {} }));\n",
    'utf8'
  );
  const graphContext = projectContext.buildProjectGraphContext(
    {
      rootPath: graphRoot,
      files: ['app/page.tsx', 'src/store/mrp_store.ts'],
    },
    'Repare Property snapshot does not exist'
  );
  assert.ok(graphContext.includes('app/page.tsx'));
  assert.ok(graphContext.includes('src/store/mrp_store.ts'));
  assert.ok(graphContext.includes('store.snapshot'));
  assert.ok(graphContext.includes('nao declara snapshot'));
} finally {
  fs.rmSync(graphRoot, { recursive: true, force: true });
}

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

const runtimeJobEvents = [];
const runtimeJobPhases = [];
const runtimeJobCheckpoints = [];
const runtimeJobService = createCortexRuntimeJobService({
  appendJobEvent: (...args) => runtimeJobEvents.push(args),
  buildConfirmationPlan: () => ({ ok: true, response: 'base', action: { type: 'noop' }, meta: { intent: 'test' } }),
  buildDeterministicEditPatchCheckpoint: (action) => ({ operationCount: action.operations.length }),
  buildDeterministicEditPatchEventPayload: (evidence) => ({ evidence }),
  clipText: textUtils.clipText,
  createCortexRuntimeCheckpoint: (workGraph, runtimeBudget, extra) => ({ workGraph, runtimeBudget, extra }),
  markJobPhase: (...args) => runtimeJobPhases.push(args),
  runtimeVersion: 'test-runtime',
  setJobCheckpoint: (...args) => runtimeJobCheckpoints.push(args),
});
runtimeJobService.markCortexRuntimePhase('job-1', 'cortex_intake', { runtime: 'test-runtime' });
runtimeJobService.checkpointRuntimeBudget('job-1', { maxRepairPasses: 1 });
runtimeJobService.checkpointCortexRuntime('job-1', { id: 'graph-1' }, { maxRepairPasses: 1 }, { stage: 'created' });
runtimeJobService.checkpointProjectBlueprintPlan('job-1', {
  meta: { reason: 'project_blueprint_ready' },
  action: { operations: [{ path: 'app/page.tsx' }] },
});
runtimeJobService.checkpointDeterministicPatchPlan('job-1', {
  meta: { reason: 'deterministic_patch_ready' },
  action: { operations: [{ op: 'write_file', path: 'app/page.tsx' }] },
});
const runtimePausePlan = runtimeJobService.buildCortexPausePlan({
  projectInfo: null,
  userMessage: 'build',
  attachments: [],
  runtimeBudget: { pausePolicy: { shouldPause: true } },
});
assert.strictEqual(runtimeJobPhases.length, 1);
assert.strictEqual(runtimeJobCheckpoints.filter((entry) => entry[1] === 'cortex_runtime').length, 1);
assert.strictEqual(runtimeJobCheckpoints.filter((entry) => entry[1] === 'deterministic_patch').length, 1);
assert.strictEqual(runtimeJobEvents.length, 1);
assert.strictEqual(runtimePausePlan.action, null);
assert.strictEqual(runtimePausePlan.meta.runtime, 'test-runtime');
assert.strictEqual(runtimeJobService.compactPromptPart('abc', 10), 'abc');

const jobStateStore = createJobStateStore({
  appendAuditEvent: () => {},
  computeRetryBackoffMs: () => 1000,
  isNonRetriableProviderReason: () => false,
  readJobsState: () => ({ jobsById: {}, jobOrder: [] }),
  writeJobsState: () => {},
});
assert.deepStrictEqual(jobStateStore.listJobs(), { ok: true, jobs: [] });

console.log('runtime-module-contract.test.js: ok');
