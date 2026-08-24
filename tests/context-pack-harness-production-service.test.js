'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
} = require('../main/agent_runtime/context_pack_contracts');
const {
  createExecuteRequest,
  createMessageRequest,
  createPlanRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  createHarnessRouter,
} = require('../main/agent_runtime/harness_router');
const {
  createLegacyKernelAdapter,
} = require('../main/agent_runtime/legacy_kernel_adapter');
const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_READER_VERSION,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootPhysicalIdentityDigest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  CONTEXT_PACK_HARNESS_PRODUCTION_SERVICE_VERSION,
  createContextPackHarnessProductionService,
} = require('../main/services/context_pack_harness_production_service');

const digest = (character) => `sha256:${character.repeat(64)}`;
const bytesDigest = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const ROOT_PATH = '/workspace/project';
const REAL_ROOT_PATH = '/physical/project';

function physicalIdentity(overrides = {}) {
  return {
    device: '10',
    inode: '20',
    entryDevice: '10',
    entryInode: '20',
    entryType: 'directory',
    ...overrides,
  };
}

function readResult(content) {
  if (content === null) {
    return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
  }
  const bytes = Buffer.from(content, 'utf8');
  return Object.freeze({
    found: true,
    contentBase64: bytes.toString('base64'),
    contentDigest: bytesDigest(bytes),
  });
}

function createReader(files = new Map()) {
  return Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list: () => Promise.resolve(Object.freeze({
      entries: Object.freeze([]),
      truncated: false,
    })),
    inspectEntry: () => Promise.resolve(Object.freeze({
      found: false,
      kind: null,
      bytes: null,
      mode: null,
      mtimeMs: null,
      contentDigest: null,
      linkTarget: null,
      entryIdentityDigest: null,
    })),
    readFile(request) {
      return Promise.resolve(readResult(
        files.has(request.relativePath) ? files.get(request.relativePath) : null
      ));
    },
  });
}

function createLease({
  binding,
  expectedPhysicalRootIdentityDigest,
  purpose,
  leaseId,
  reader,
  onClose,
}) {
  const request = createProjectRootAuthorityAcquireRequest({
    leaseId,
    binding,
    expectedPhysicalRootIdentityDigest,
    purpose,
  });
  return Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
    leaseId,
    jobId: binding.jobId,
    projectId: binding.projectId,
    purpose,
    physicalRootIdentityDigest: expectedPhysicalRootIdentityDigest,
    authorityDigest: request.authorityDigest,
    reader,
    close() {
      if (onClose) onClose();
      return Promise.resolve(createProjectRootAuthorityCloseReceipt({
        request,
        closed: true,
      }));
    },
  });
}

function projectInfo() {
  return {
    id: 'project-1',
    projectId: 'project-1',
    rootPath: ROOT_PATH,
    files: ['src/index.js', 'package.json', '.env'],
    stacks: ['Node/Express'],
  };
}

function createHarness(overrides = {}) {
  const state = {
    projectAuthorizationCalls: 0,
    executionAuthorizationCalls: 0,
    registryAcquires: [],
    requestLeaseCloses: 0,
    executionLeaseCloses: 0,
    activeMemoryInputs: [],
  };
  const identity = physicalIdentity();
  const physicalDigest = createProjectRootPhysicalIdentityDigest(identity);
  const files = new Map([
    ['AGENTS.md', '# Project instructions\nPreserve contracts.'],
    ['src/AGENTS.md', '# Source instructions\nUse TDD.'],
    ['src/index.js', "module.exports = 'ok';"],
    ['package.json', '{"name":"project"}'],
  ]);
  const reader = createReader(files);
  let leaseSequence = 0;
  const registry = Object.freeze({
    acquire(input) {
      state.registryAcquires.push(input);
      leaseSequence += 1;
      return Promise.resolve(Object.freeze({
        ok: true,
        lease: createLease({
          ...input,
          leaseId: `context-lease-${leaseSequence}`,
          reader,
          onClose: () => { state.requestLeaseCloses += 1; },
        }),
        idempotent: false,
      }));
    },
  });
  const executionBinding = createCapabilityDelegationBinding({
    projectId: 'project-1',
    canonicalRootPath: ROOT_PATH,
    realRootPath: REAL_ROOT_PATH,
    sessionId: 'session-execution-1',
    jobId: 'job-1',
    kernelId: 'legacy-localcode-kernel',
    submissionDigest: digest('9'),
  });
  const executionLease = createLease({
    binding: executionBinding,
    expectedPhysicalRootIdentityDigest: physicalDigest,
    purpose: 'execution',
    leaseId: 'execution-lease-1',
    reader,
    onClose: () => { state.executionLeaseCloses += 1; },
  });
  const nonces = ['nonce-plan', 'nonce-message', 'nonce-execute', 'nonce-extra'];

  const authorizeProjectBinding = overrides.authorizeProjectBinding
    || ((projectId, rootPath) => {
      state.projectAuthorizationCalls += 1;
      return {
        ok: true,
        authorized: true,
        projectId,
        canonicalRootPath: rootPath,
        rootPath,
        realRootPath: REAL_ROOT_PATH,
        physicalRootIdentity: identity,
      };
    });
  const authorizeExecutionBinding = overrides.authorizeExecutionBinding
    || ((binding) => {
      state.executionAuthorizationCalls += 1;
      return Object.freeze({
        authorized: true,
        reason: 'authorized',
        binding,
        physicalRootIdentityDigest: physicalDigest,
      });
    });
  const getProjectRootAuthorityRegistry = overrides.getProjectRootAuthorityRegistry
    || (() => registry);

  const service = createContextPackHarnessProductionService({
    applicationMapService: {
      readApplicationMapSnapshot: () => ({
        ok: true,
        found: true,
        map: { nodes: [{ id: 'runtime', title: 'Agent Runtime' }], edges: [] },
        contentDigest: digest('b'),
      }),
    },
    authorizeExecutionBinding,
    authorizeProjectBinding,
    compilerOptions: {
      now: () => '2026-08-24T18:00:00.000Z',
    },
    getActiveMemory(input) {
      state.activeMemoryInputs.push(input);
      return {
        ok: true,
        validity: { expired: false },
        citations: [{ source: 'cortex_learning.events', sourceId: 'memory-1' }],
        provenance: {
          schemaVersion: 'memory-provenance-v1',
          used: [{ source: 'cortex_learning.events', sourceId: 'memory-1' }],
        },
        decision: { briefingContextText: 'Preserve o Harness v2.' },
      };
    },
    getProjectRootAuthorityRegistry,
    gitService: {
      getProjectGitWorktree: () => ({
        ok: true,
        isGitRepo: true,
        branch: 'feat/harness-v2',
        latest: { hash: 'cfeecea', subject: 'context prompts', relative: 'agora' },
        entries: [],
      }),
    },
    kernelId: 'legacy-localcode-kernel',
    milestoneService: {
      readMilestonesSnapshot: () => ({
        ok: true,
        found: true,
        format: 'rendered',
        renderedAt: '2026-08-24T17:00:00.000Z',
        source: 'application-map-render',
        milestones: [{
          id: 'milestone-3',
          number: 3,
          title: 'ContextPack',
          status: 'active',
          acceptanceCriteria: 'Contexto governado em todos os turnos.',
          tasks: [],
        }],
        contentDigest: digest('c'),
      }),
    },
    nonceFactory: () => nonces.shift() || `nonce-${crypto.randomUUID()}`,
  });

  return {
    executionBinding,
    executionLease,
    physicalDigest,
    reader,
    service,
    state,
  };
}

function privateExecutionContext(binding, lease = null) {
  const context = { jobId: binding.jobId, requestedMode: 'ask_each', signal: {} };
  Object.defineProperty(context, 'authorityBinding', {
    enumerable: false,
    value: binding,
  });
  if (lease) {
    Object.defineProperty(context, 'projectRootLease', {
      enumerable: false,
      value: lease,
    });
  } else {
    Object.defineProperty(context, 'sandboxExecutor', {
      enumerable: false,
      value: Object.freeze({ version: 'test-sandbox-executor.v1' }),
    });
  }
  return Object.freeze(context);
}

function section(manifest, id) {
  return manifest.sections.find((entry) => entry.id === id);
}

async function run() {
  const harness = createHarness();
  const { service, state } = harness;
  assert.strictEqual(Object.isFrozen(service), true);
  assert.strictEqual(service.version, CONTEXT_PACK_HARNESS_PRODUCTION_SERVICE_VERSION);
  assert.strictEqual(Object.isFrozen(service.contextPackInjector), true);

  const planRequest = createPlanRequest({
    projectInfo: projectInfo(),
    userMessage: `Continue a refatoração em ${ROOT_PATH}.`,
    attachments: [],
    conversationId: 'conversation-1',
    userId: 'user-1',
    conversationMessages: [
      { role: 'user', text: 'Pode commitar e continuar.' },
      { role: 'assistant', text: 'Checkpoint concluído.' },
    ],
    contextHint: {
      relativeCwd: 'src',
      relevantFiles: ['src/index.js', '../outside.js', '.env'],
    },
  }, { requestId: 'request-plan' });
  const injectedPlan = await service.contextPackInjector.inject(planRequest);
  const planPack = injectedPlan.contextPack;
  assert.strictEqual(planPack.requestId, 'request-plan');
  assert.strictEqual(planPack.projectId, 'project-1');
  assert.strictEqual(planPack.surface, CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE);
  assert.strictEqual(JSON.stringify(planPack).includes(ROOT_PATH), false);
  assert.strictEqual(JSON.stringify(planPack).includes(REAL_ROOT_PATH), false);
  assert.strictEqual(section(planPack, CONTEXT_PACK_SECTION_IDS.REQUEST).summary.includes('[project-root]'), true);
  assert.strictEqual(
    section(planPack, CONTEXT_PACK_SECTION_IDS.PERMISSIONS).citations[0].locator,
    'authority://request/request-plan'
  );
  assert.strictEqual(section(planPack, CONTEXT_PACK_SECTION_IDS.INSTRUCTIONS).state, CONTEXT_PACK_SECTION_STATES.AVAILABLE);
  assert.strictEqual(section(planPack, CONTEXT_PACK_SECTION_IDS.FILES).summary.includes('src/index.js'), true);
  assert.strictEqual(section(planPack, CONTEXT_PACK_SECTION_IDS.FILES).summary.includes('.env'), false);
  assert.strictEqual(section(planPack, CONTEXT_PACK_SECTION_IDS.CONVERSATION).state, CONTEXT_PACK_SECTION_STATES.AVAILABLE);
  assert.strictEqual(state.registryAcquires.length, 1);
  assert.strictEqual(state.registryAcquires[0].purpose, 'project_scan');
  assert.strictEqual(state.registryAcquires[0].binding.projectId, 'project-1');
  assert.notStrictEqual(state.registryAcquires[0].binding.jobId, 'job-1');
  assert.strictEqual(state.requestLeaseCloses, 1);
  assert.strictEqual(state.projectAuthorizationCalls, 3);
  assert.strictEqual(state.activeMemoryInputs.length, 1);
  assert.strictEqual(state.activeMemoryInputs[0].requestId, 'request-plan');
  assert.strictEqual(state.activeMemoryInputs[0].projectInfo.rootPath, ROOT_PATH);

  const mapRequest = createMessageRequest({
    projectInfo: projectInfo(),
    userMessage: 'Analise o mapa sem alterar código.',
    attachments: [],
    isMapChat: true,
  }, { requestId: 'request-message' });
  const injectedMap = await service.contextPackInjector.inject(mapRequest);
  assert.strictEqual(injectedMap.contextPack.surface, CONTEXT_PACK_SURFACES.MAP_CHAT);
  assert.strictEqual(state.registryAcquires.length, 2);
  assert.strictEqual(state.requestLeaseCloses, 2);

  const executeContext = privateExecutionContext(
    harness.executionBinding,
    harness.executionLease
  );
  const executeRequest = createExecuteRequest({
    type: 'write_files',
    milestoneId: 'milestone-3',
    files: [{ path: 'src/index.js', content: 'updated' }],
    rootPath: ROOT_PATH,
  }, projectInfo(), {
    requestId: 'request-execute',
    executionContext: executeContext,
  });
  const injectedExecute = await service.contextPackInjector.inject(executeRequest);
  const executePack = injectedExecute.contextPack;
  assert.strictEqual(executePack.surface, CONTEXT_PACK_SURFACES.MILESTONE_EXECUTE);
  assert.strictEqual(
    section(executePack, CONTEXT_PACK_SECTION_IDS.PERMISSIONS).citations[0].locator,
    'authority://job/job-1'
  );
  assert.strictEqual(
    section(executePack, CONTEXT_PACK_SECTION_IDS.PERMISSIONS).citations[0].digest,
    harness.executionLease.authorityDigest
  );
  assert.strictEqual(section(executePack, CONTEXT_PACK_SECTION_IDS.FILES).summary.includes('src/index.js'), true);
  assert.strictEqual(state.registryAcquires.length, 2, 'execution must reuse the coordinator lease');
  assert.strictEqual(state.executionLeaseCloses, 0, 'the ContextPack must not own the execution lease');
  assert.strictEqual(state.executionAuthorizationCalls, 3);

  const productionExecuteRequest = createExecuteRequest({
    type: 'write_files',
    files: [{ path: 'src/index.js', content: 'production path' }],
  }, projectInfo(), {
    requestId: 'request-execute-scan',
    executionContext: privateExecutionContext(harness.executionBinding),
  });
  const injectedProductionExecute = await service.contextPackInjector.inject(
    productionExecuteRequest
  );
  assert.strictEqual(
    injectedProductionExecute.contextPack.surface,
    CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE
  );
  assert.strictEqual(state.registryAcquires.length, 3);
  assert.strictEqual(state.registryAcquires[2].purpose, 'project_scan');
  assert.deepStrictEqual(
    state.registryAcquires[2].binding,
    harness.executionBinding,
    'the short read lease must remain bound to the real authorized job'
  );
  assert.strictEqual(state.requestLeaseCloses, 3);
  assert.strictEqual(state.executionLeaseCloses, 0);
  assert.strictEqual(state.executionAuthorizationCalls, 6);

  const publicAuthorityContext = Object.freeze({
    jobId: 'job-1',
    authorityBinding: harness.executionBinding,
    projectRootLease: harness.executionLease,
  });
  await assert.rejects(
    service.contextPackInjector.inject(createExecuteRequest(
      { type: 'write_files', files: [] },
      projectInfo(),
      { requestId: 'request-forged', executionContext: publicAuthorityContext }
    )),
    /binding failed/i
  );

  const driftIdentity = physicalIdentity({ inode: '21' });
  let driftCalls = 0;
  const drift = createHarness({
    authorizeProjectBinding(projectId, rootPath) {
      driftCalls += 1;
      const selected = driftCalls >= 3 ? driftIdentity : physicalIdentity();
      return {
        ok: true,
        authorized: true,
        projectId,
        canonicalRootPath: rootPath,
        rootPath,
        realRootPath: REAL_ROOT_PATH,
        physicalRootIdentity: selected,
      };
    },
  });
  await assert.rejects(
    drift.service.contextPackInjector.inject(createPlanRequest({
      projectInfo: projectInfo(),
      userMessage: 'Continue.',
      attachments: [],
    }, { requestId: 'request-drift' })),
    /collection failed/i
  );
  assert.strictEqual(drift.state.requestLeaseCloses, 1, 'drift must still close the request lease');

  const unavailable = createHarness({
    getProjectRootAuthorityRegistry: () => null,
  });
  await assert.rejects(
    unavailable.service.contextPackInjector.inject(createPlanRequest({
      projectInfo: projectInfo(),
      userMessage: 'Continue.',
      attachments: [],
    }, { requestId: 'request-unavailable' })),
    /collection failed/i
  );
  let unavailableKernelCalls = 0;
  const unavailableRouter = createHarnessRouter({
    contextPackInjector: unavailable.service.contextPackInjector,
    legacyKernel: createLegacyKernelAdapter({
      plan: () => { unavailableKernelCalls += 1; },
      message: () => { unavailableKernelCalls += 1; },
      execute: () => { unavailableKernelCalls += 1; },
    }),
    requestIdFactory: () => 'request-router-unavailable',
  });
  await assert.rejects(unavailableRouter.plan({
    projectInfo: projectInfo(),
    userMessage: 'Continue.',
    attachments: [],
  }), /collection failed/i);
  assert.strictEqual(unavailableKernelCalls, 0);

  const mismatchedProject = createHarness({
    authorizeProjectBinding(projectId, rootPath) {
      return {
        ok: true,
        authorized: true,
        projectId: 'project-attacker',
        canonicalRootPath: rootPath,
        rootPath,
        realRootPath: REAL_ROOT_PATH,
        physicalRootIdentity: physicalIdentity(),
      };
    },
  });
  await assert.rejects(
    mismatchedProject.service.contextPackInjector.inject(createPlanRequest({
      projectInfo: projectInfo(),
      userMessage: 'Continue.',
      attachments: [],
    }, { requestId: 'request-project-mismatch' })),
    /binding failed/i
  );

  const diagnostics = service.diagnostics();
  assert.strictEqual(Object.isFrozen(diagnostics), true);
  assert.strictEqual(diagnostics.bindings, 5);
  assert.strictEqual(diagnostics.collections, 4);
  assert.strictEqual(diagnostics.rejections, 1);
  assert.strictEqual(diagnostics.activeBindings, 0);
  assert.strictEqual(diagnostics.requestLeases.acquired, 3);
  assert.strictEqual(diagnostics.requestLeases.closed, 3);
  assert.strictEqual(diagnostics.executionLeasesReused, 1);

  assert.throws(() => createHarness({
    authorizeProjectBinding: async () => ({}),
  }), /authorizeProjectBinding/i);

  console.log('context-pack-harness-production-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
