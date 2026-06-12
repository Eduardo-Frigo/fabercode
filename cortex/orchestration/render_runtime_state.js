const defaultCrypto = require('crypto');

const CORTEX_RENDER_RUNTIME_VERSION = 'cortex_render_runtime.v1';
const WORK_GRAPH_VERSION = 'work_graph_v1';
const RENDER_PASS_VERSION = 'render_pass_v1';
const RUNTIME_BUDGET_VERSION = 'runtime_budget_v1';

function resolveNow(options = {}) {
  return typeof options.now === 'function' ? options.now() : Date.now();
}

function resolveCrypto(options = {}) {
  return options.crypto || defaultCrypto;
}

function buildOperationBatchFingerprint(operations = [], cryptoImpl = defaultCrypto) {
  const payload = Array.isArray(operations)
    ? operations.map((op) => ({
        op: String(op && op.op ? op.op : ''),
        path: String(op && op.path ? op.path : ''),
        contentHash:
          typeof op.content === 'string' ? cryptoImpl.createHash('sha1').update(op.content).digest('hex').slice(0, 12) : '',
      }))
    : [];
  return cryptoImpl.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function createRenderPass(
  { role, kind, inputRefs = [], outputContract = {}, maxTokens = 700, repairOf = null },
  options = {}
) {
  const cryptoImpl = resolveCrypto(options);
  return {
    kind: RENDER_PASS_VERSION,
    id: `${kind}-${resolveNow(options)}-${cryptoImpl.randomBytes(3).toString('hex')}`,
    role,
    passKind: kind,
    inputRefs,
    outputContract,
    maxTokens,
    status: 'pending',
    result: null,
    repairOf,
  };
}

function createCortexWorkGraph(
  { projectInfo, userMessage, attachments, runtimeBudget, memory, cortex, mempalaceCore, rag },
  options = {}
) {
  const cryptoImpl = resolveCrypto(options);
  const id = `wg-${resolveNow(options)}-${cryptoImpl.randomBytes(4).toString('hex')}`;
  return {
    kind: WORK_GRAPH_VERSION,
    id,
    goal: String(userMessage || '').slice(0, 2000),
    brief: '',
    briefSpec: null,
    acceptanceCriteria: null,
    passes: [],
    currentPassId: null,
    status: 'created',
    artifacts: [],
    validationResults: [],
    project: {
      rootPath: projectInfo && projectInfo.rootPath ? projectInfo.rootPath : null,
      stacks: projectInfo && Array.isArray(projectInfo.stacks) ? projectInfo.stacks : [],
      totalFiles: projectInfo && Number.isFinite(projectInfo.totalFiles) ? projectInfo.totalFiles : 0,
    },
    attachments: (attachments || []).map((entry) => ({
      name: entry.name,
      type: entry.type || 'unknown',
      size: entry.size || null,
    })),
    memoryRefs: {
      mempalace: memory && memory.ok ? memory.reason || 'memory_ok' : memory ? memory.reason : 'memory_unset',
      mempalaceCore:
        mempalaceCore && mempalaceCore.ok
          ? {
              wing: mempalaceCore.wing || null,
              wakeUp: Boolean(mempalaceCore.layers && mempalaceCore.layers.wake_up),
              kgFacts: mempalaceCore.kg && Array.isArray(mempalaceCore.kg.facts) ? mempalaceCore.kg.facts.length : 0,
              tunnels:
                mempalaceCore.graph && Array.isArray(mempalaceCore.graph.tunnels)
                  ? mempalaceCore.graph.tunnels.length
                  : 0,
            }
          : mempalaceCore
            ? mempalaceCore.reason || 'mempalace_core_unavailable'
            : 'mempalace_core_unset',
      cortex: cortex && cortex.available ? `selected:${cortex.selectedCount || 0}` : cortex ? cortex.reason : 'cortex_unset',
      rag:
        rag && rag.ok
          ? {
              provider: rag.provider || 'r2r',
              refsCount: Number(rag.refsCount || 0),
            }
          : rag
            ? rag.reason || 'rag_unavailable'
            : 'rag_unset',
    },
    runtimeBudget: {
      kind: runtimeBudget.kind,
      profile: runtimeBudget.profile,
      maxActiveModels: runtimeBudget.maxActiveModels,
      maxPromptCharsPerPass: runtimeBudget.maxPromptCharsPerPass,
      maxOperationsPerPass: runtimeBudget.maxOperationsPerPass,
      memoryState: runtimeBudget.memoryState,
    },
  };
}

function setPassStatus(workGraph, passId, status, result = null) {
  const pass = workGraph && Array.isArray(workGraph.passes)
    ? workGraph.passes.find((entry) => entry.id === passId)
    : null;
  if (!pass) return null;
  pass.status = status;
  if (result !== null) pass.result = result;
  return pass;
}

function createCortexRuntimeCheckpoint(workGraph, runtimeBudget, extra = {}) {
  return {
    runtime: CORTEX_RENDER_RUNTIME_VERSION,
    workGraph,
    runtimeBudget,
    ...extra,
  };
}

module.exports = {
  CORTEX_RENDER_RUNTIME_VERSION,
  RENDER_PASS_VERSION,
  RUNTIME_BUDGET_VERSION,
  WORK_GRAPH_VERSION,
  buildOperationBatchFingerprint,
  createCortexRuntimeCheckpoint,
  createCortexWorkGraph,
  createRenderPass,
  setPassStatus,
};
