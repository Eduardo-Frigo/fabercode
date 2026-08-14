'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  PROJECT_CAPABILITY_EFFECTS,
  createProjectCapabilityRequest,
} = require('../main/capabilities/project_capability_contracts');
const {
  createAgenticDeleteBrokerFactory,
} = require('../main/services/agentic_delete_broker_factory');

function binding(overrides = {}) {
  return createCapabilityDelegationBinding({
    projectId: 'project-a',
    canonicalRootPath: '/projects/a',
    realRootPath: '/projects/a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'kernel-a',
    submissionDigest: `sha256:${'a'.repeat(64)}`,
    ...overrides,
  });
}

function request(bound, requestId = 'request-a') {
  return createProjectCapabilityRequest({
    requestId,
    principal: { kind: 'agent', kernelId: bound.kernelId },
    projectSession: {
      projectId: bound.projectId,
      rootPath: bound.canonicalRootPath,
      realRootPath: bound.realRootPath,
      sessionId: bound.sessionId,
      jobId: bound.jobId,
    },
    capability: 'filesystem',
    action: 'delete_paths',
    payload: {
      deleteRequestDigest: `sha256:${'b'.repeat(64)}`,
      impactDigest: `sha256:${'c'.repeat(64)}`,
      checkpointDigest: `sha256:${'d'.repeat(64)}`,
      planDigest: `sha256:${'e'.repeat(64)}`,
    },
    context: { origin: 'agentic_tool_loop', correlationId: bound.jobId },
  });
}

(async () => {
  const bound = binding();
  let lifecycleActive = true;
  let rootActive = true;
  let effects = 0;
  const auditEvents = [];
  const sequence = [];
  const factory = createAgenticDeleteBrokerFactory({
    authorizeLifecycle(candidate) {
      sequence.push('lifecycle');
      return lifecycleActive
        ? { authorized: true, binding: candidate }
        : { authorized: false };
    },
    authorizeRoot({ projectId, rootPath }) {
      sequence.push('root');
      return rootActive
        ? {
          ok: true,
          authorized: true,
          projectId,
          rootPath,
          canonicalRootPath: rootPath,
          realRootPath: rootPath,
        }
        : { ok: false, authorized: false };
    },
    authorizeEffectFrontier(candidate) {
      sequence.push('frontier');
      return lifecycleActive && rootActive
        ? { authorized: true, binding: candidate }
        : { authorized: false };
    },
    audit(event) { auditEvents.push(event); },
    now: (() => {
      let value = 1_000;
      return () => value++;
    })(),
  });
  const proof = Object.freeze(Object.create(null));
  const broker = factory.createBroker({
    binding: bound,
    capability: 'filesystem',
    action: 'delete_paths',
    effects: [
      PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE,
      PROJECT_CAPABILITY_EFFECTS.DESTRUCTIVE,
    ],
    requiresApproval: true,
    adapter: {
      execute() {
        sequence.push('effect');
        effects += 1;
        return { ok: true, status: 'completed' };
      },
    },
    approvalReviewer: {
      verifyDecision(input) {
        return {
          verified: input.proof === proof && input.decision === 'allow',
          decision: input.proof === proof ? input.decision : 'deny',
        };
      },
    },
  });
  const capabilityRequest = request(bound);
  const pending = await broker.execute(capabilityRequest);
  assert.strictEqual(pending.status, 'approval_required');
  assert.strictEqual(effects, 0);
  assert.deepStrictEqual(Object.keys(pending.approval).sort(), [
    'approvalId',
    'expiresAt',
    'status',
  ]);
  const completed = await broker.approveAndExecute(capabilityRequest, {
    approvalId: pending.approval.approvalId,
    decision: 'allow',
    proof,
  });
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(effects, 1);
  assert.strictEqual(sequence[sequence.length - 2], 'frontier');
  assert.strictEqual(sequence[sequence.length - 1], 'effect');
  assert.strictEqual(factory.diagnostics().brokersCreated, 1);
  assert.strictEqual(JSON.stringify(auditEvents).includes('/projects/a'), false);
  assert.strictEqual(JSON.stringify(completed).includes('submissionDigest'), false);

  const deniedProofBroker = factory.createBroker({
    binding: bound,
    capability: 'filesystem',
    action: 'delete_paths',
    effects: [
      PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE,
      PROJECT_CAPABILITY_EFFECTS.DESTRUCTIVE,
    ],
    requiresApproval: true,
    adapter: { execute() { effects += 100; return { ok: true }; } },
    approvalReviewer: { verifyDecision() { return { verified: false, decision: 'deny' }; } },
  });
  const deniedRequest = request(bound, 'request-denied-proof');
  const deniedPending = await deniedProofBroker.execute(deniedRequest);
  const deniedProof = await deniedProofBroker.approveAndExecute(deniedRequest, {
    approvalId: deniedPending.approval.approvalId,
    decision: 'allow',
    proof: Object.freeze({}),
  });
  assert.strictEqual(deniedProof.status, 'denied');
  assert.strictEqual(effects, 1);

  lifecycleActive = false;
  const inactiveBroker = factory.createBroker({
    binding: bound,
    capability: 'filesystem',
    action: 'delete_paths',
    effects: [
      PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE,
      PROJECT_CAPABILITY_EFFECTS.DESTRUCTIVE,
    ],
    requiresApproval: true,
    adapter: { execute() { effects += 100; return { ok: true }; } },
    approvalReviewer: { verifyDecision() { return { verified: true, decision: 'allow' }; } },
  });
  const inactive = await inactiveBroker.execute(request(bound, 'request-inactive'));
  assert.strictEqual(inactive.status, 'denied');
  assert.strictEqual(effects, 1);

  const contradictoryFactory = createAgenticDeleteBrokerFactory({
    authorizeLifecycle(candidate) {
      return { authorized: true, binding: candidate };
    },
    authorizeRoot({ projectId, rootPath }) {
      return {
        ok: true,
        authorized: false,
        projectId,
        rootPath,
        canonicalRootPath: rootPath,
        realRootPath: rootPath,
      };
    },
    authorizeEffectFrontier(candidate) {
      return { authorized: true, binding: candidate };
    },
    audit() {},
  });
  const contradictoryBroker = contradictoryFactory.createBroker({
    binding: bound,
    capability: 'filesystem',
    action: 'delete_paths',
    effects: [
      PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE,
      PROJECT_CAPABILITY_EFFECTS.DESTRUCTIVE,
    ],
    requiresApproval: true,
    adapter: { execute() { effects += 100; return { ok: true }; } },
    approvalReviewer: { verifyDecision() { return { verified: true, decision: 'allow' }; } },
  });
  const contradictory = await contradictoryBroker.execute(request(bound, 'request-contradictory'));
  assert.strictEqual(contradictory.status, 'denied');
  assert.strictEqual(effects, 1);

  assert.throws(() => factory.createBroker({
    binding: bound,
    capability: 'filesystem',
    action: 'delete_paths',
    effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE],
    requiresApproval: true,
    adapter: { execute() {} },
    approvalReviewer: { verifyDecision() {} },
  }), /exact destructive effect set/);
  console.log('agentic delete broker factory tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
