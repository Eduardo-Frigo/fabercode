'use strict';

const assert = require('assert');

const {
  CONTEXT_PACK_CITATION_KINDS,
  CONTEXT_PACK_SECTION_IDS,
  CONTEXT_PACK_SECTION_STATES,
  CONTEXT_PACK_SURFACES,
  createContextPackCitation,
  createContextPackSection,
} = require('../main/agent_runtime/context_pack_contracts');
const {
  createContextPackCompiler,
} = require('../main/agent_runtime/context_pack_compiler');
const {
  CONTEXT_PACK_HARNESS_INJECTOR_VERSION,
  createContextPackHarnessInjector,
} = require('../main/agent_runtime/context_pack_harness_injector');
const {
  createHarnessRouter,
} = require('../main/agent_runtime/harness_router');
const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');
const {
  createLegacyKernelAdapter,
} = require('../main/agent_runtime/legacy_kernel_adapter');

const authorityDigest = `sha256:${'a'.repeat(64)}`;

function availableSection({ id, kind, locator, revision, summary, digest }) {
  return createContextPackSection({
    id,
    state: CONTEXT_PACK_SECTION_STATES.AVAILABLE,
    revision,
    summary,
    citations: Object.freeze([createContextPackCitation({
      kind,
      locator,
      revision,
      digest,
    })]),
    truncated: false,
  });
}

function manifestFor(requestId, surface) {
  const requestDigest = `sha256:${'b'.repeat(64)}`;
  return createContextPackCompiler({
    now: () => '2026-08-24T16:00:00.000Z',
  }).compile({
    requestId,
    projectId: 'project-1',
    surface,
    sections: Object.freeze([
      availableSection({
        id: CONTEXT_PACK_SECTION_IDS.REQUEST,
        kind: CONTEXT_PACK_CITATION_KINDS.RUNTIME_REQUEST,
        locator: `runtime://request/${requestId}`,
        revision: requestDigest,
        summary: 'Continue o desenvolvimento.',
        digest: requestDigest,
      }),
      availableSection({
        id: CONTEXT_PACK_SECTION_IDS.PERMISSIONS,
        kind: CONTEXT_PACK_CITATION_KINDS.JOB_AUTHORITY,
        locator: `authority://request/${requestId}`,
        revision: authorityDigest,
        summary: 'Leitura contextual autorizada.',
        digest: authorityDigest,
      }),
    ]),
  });
}

function runtimeWith(collect, diagnostics = () => Object.freeze({ ok: true })) {
  return Object.freeze({
    version: 'test-context-pack-runtime.v1',
    collect,
    diagnostics,
  });
}

async function run() {
  const collectionCalls = [];
  const runtime = runtimeWith((input) => {
    collectionCalls.push(input);
    return Promise.resolve(manifestFor(input.binding.requestId, input.surface));
  });
  const boundRequests = [];
  const injector = createContextPackHarnessInjector({
    contextPackRuntime: runtime,
    bindRequest(request) {
      boundRequests.push(request);
      return Object.freeze({
        requestId: request.requestId,
        operation: request.operation,
      });
    },
  });
  assert.strictEqual(Object.isFrozen(injector), true);
  assert.deepStrictEqual(Reflect.ownKeys(injector), ['version', 'inject', 'diagnostics']);
  assert.strictEqual(injector.version, CONTEXT_PACK_HARNESS_INJECTOR_VERSION);

  const legacyCalls = [];
  const legacyKernel = createLegacyKernelAdapter({
    plan(payload, contextPack) {
      legacyCalls.push(['plan', payload, contextPack]);
      return { ok: true, channel: 'plan' };
    },
    message(payload, contextPack) {
      legacyCalls.push(['message', payload, contextPack]);
      return { ok: true, channel: 'message' };
    },
    execute(action, projectInfo, executionContext, contextPack) {
      legacyCalls.push(['execute', action, projectInfo, executionContext, contextPack]);
      return { ok: true, channel: 'execute' };
    },
  });
  const requestIds = [
    'request-plan',
    'request-message',
    'request-map-chat',
    'request-execute',
    'request-milestone',
  ];
  const router = createHarnessRouter({
    legacyKernel,
    contextPackInjector: injector,
    runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
    requestIdFactory: () => requestIds.shift(),
  });

  const projectInfo = { id: 'project-1', rootPath: '/workspace/project' };
  const planPayload = { projectInfo, userMessage: 'planeje' };
  const messagePayload = { projectInfo, userMessage: 'continue' };
  const mapPayload = { projectInfo, userMessage: 'analise o mapa', isMapChat: true };
  const action = { type: 'operation_batch', operations: [] };
  const milestoneAction = {
    type: 'operation_batch',
    operations: [],
    milestoneId: 'milestone-3',
  };
  const executionContext = { jobId: 'job-1' };

  assert.deepStrictEqual(await router.plan(planPayload), { ok: true, channel: 'plan' });
  assert.deepStrictEqual(await router.message(messagePayload), { ok: true, channel: 'message' });
  assert.deepStrictEqual(await router.message(mapPayload), { ok: true, channel: 'message' });
  assert.deepStrictEqual(
    await router.execute(action, projectInfo, executionContext),
    { ok: true, channel: 'execute' }
  );
  assert.deepStrictEqual(
    await router.execute(milestoneAction, projectInfo, { jobId: 'job-2' }),
    { ok: true, channel: 'execute' }
  );

  assert.strictEqual(boundRequests.length, 5);
  assert.strictEqual(collectionCalls.length, 5);
  assert.deepStrictEqual(collectionCalls.map((entry) => entry.surface), [
    CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE,
    CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE,
    CONTEXT_PACK_SURFACES.MAP_CHAT,
    CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE,
    CONTEXT_PACK_SURFACES.MILESTONE_EXECUTE,
  ]);
  assert(collectionCalls.every((entry) => Object.isFrozen(entry)));
  assert.deepStrictEqual(collectionCalls.map((entry) => entry.binding.requestId), [
    'request-plan',
    'request-message',
    'request-map-chat',
    'request-execute',
    'request-milestone',
  ]);

  assert.strictEqual(legacyCalls[0][1], planPayload);
  assert.strictEqual(legacyCalls[0][2].surface, CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE);
  assert.strictEqual(legacyCalls[0][2].requestId, 'request-plan');
  assert.strictEqual(legacyCalls[1][1], messagePayload);
  assert.strictEqual(legacyCalls[1][2].requestId, 'request-message');
  assert.strictEqual(legacyCalls[2][1], mapPayload);
  assert.strictEqual(legacyCalls[2][2].surface, CONTEXT_PACK_SURFACES.MAP_CHAT);
  assert.strictEqual(legacyCalls[3][1], action);
  assert.strictEqual(legacyCalls[3][2], projectInfo);
  assert.strictEqual(legacyCalls[3][3], executionContext);
  assert.strictEqual(legacyCalls[3][4].surface, CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE);
  assert.strictEqual(legacyCalls[4][1], milestoneAction);
  assert.strictEqual(legacyCalls[4][4].surface, CONTEXT_PACK_SURFACES.MILESTONE_EXECUTE);
  assert(legacyCalls.every((entry) => Object.isFrozen(entry[entry.length - 1])));

  const diagnostics = injector.diagnostics();
  assert.deepStrictEqual(diagnostics, Object.freeze({
    version: CONTEXT_PACK_HARNESS_INJECTOR_VERSION,
    injections: 5,
    rejections: 0,
    lastPackId: legacyCalls[4][4].packId,
    surfaces: Object.freeze({
      [CONTEXT_PACK_SURFACES.MAP_CHAT]: 1,
      [CONTEXT_PACK_SURFACES.MAP_RENDER]: 0,
      [CONTEXT_PACK_SURFACES.DEVELOPMENT_PREPARE]: 2,
      [CONTEXT_PACK_SURFACES.DEVELOPMENT_EXECUTE]: 1,
      [CONTEXT_PACK_SURFACES.MILESTONE_EXECUTE]: 1,
      [CONTEXT_PACK_SURFACES.REVIEW]: 0,
    }),
  }));
  assert.strictEqual(Object.isFrozen(diagnostics), true);
  assert.strictEqual(Object.isFrozen(diagnostics.surfaces), true);
  assert.strictEqual(Object.hasOwn(router.getStatus(), 'contextPack'), false);

  const mismatched = createContextPackHarnessInjector({
    contextPackRuntime: runtimeWith((input) => Promise.resolve(
      manifestFor('different-request', input.surface)
    )),
    bindRequest: (request) => ({ requestId: request.requestId }),
  });
  await assert.rejects(
    mismatched.inject(boundRequests[0]),
    /requestId/i
  );
  assert.strictEqual(mismatched.diagnostics().rejections, 1);

  const asynchronousBinder = createContextPackHarnessInjector({
    contextPackRuntime: runtime,
    bindRequest: () => Promise.resolve({ requestId: 'request-plan' }),
  });
  await assert.rejects(
    asynchronousBinder.inject(boundRequests[0]),
    /synchronous/i
  );

  const synchronousCollector = createContextPackHarnessInjector({
    contextPackRuntime: runtimeWith((input) => manifestFor(
      input.binding.requestId,
      input.surface
    )),
    bindRequest: (request) => ({ requestId: request.requestId }),
  });
  await assert.rejects(
    synchronousCollector.inject(boundRequests[0]),
    /asynchronous/i
  );

  let blockedKernelCalls = 0;
  const blockedKernel = createLegacyKernelAdapter({
    plan: () => { blockedKernelCalls += 1; },
    message: () => { blockedKernelCalls += 1; },
    execute: () => { blockedKernelCalls += 1; },
  });
  const blockedRouter = createHarnessRouter({
    legacyKernel: blockedKernel,
    contextPackInjector: createContextPackHarnessInjector({
      contextPackRuntime: runtimeWith(() => Promise.reject(new Error('unavailable'))),
      bindRequest: (request) => ({ requestId: request.requestId }),
    }),
    requestIdFactory: () => 'blocked-request',
  });
  await assert.rejects(blockedRouter.plan(planPayload), /collection failed/i);
  assert.strictEqual(blockedKernelCalls, 0);

  assert.throws(() => createContextPackHarnessInjector({
    contextPackRuntime: runtime,
    bindRequest: new Proxy(() => ({}), {}),
  }), /bindRequest/i);
  assert.throws(() => createContextPackHarnessInjector({
    contextPackRuntime: Object.freeze({
      version: 'invalid-runtime.v1',
      collect: () => Promise.resolve(null),
      diagnostics: null,
    }),
    bindRequest: () => ({}),
  }), /diagnostics/i);
  assert.throws(() => createHarnessRouter({
    legacyKernel,
    contextPackInjector: {},
  }), /contextPackInjector/i);

  console.log('context-pack-harness-injector.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
