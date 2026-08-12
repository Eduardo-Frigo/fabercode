'use strict';

const assert = require('assert');

const {
  PROJECT_CAPABILITY_EFFECTS,
  PROJECT_CAPABILITY_KINDS,
  createProjectCapabilityRequest,
  isProjectCapabilityRequest,
} = require('../main/capabilities/project_capability_contracts');
const {
  CapabilityEffectClassifier,
} = require('../main/capabilities/capability_effect_classifier');
const {
  CapabilityPolicyService,
} = require('../main/capabilities/capability_policy_service');
const {
  createProjectCapabilityBroker,
} = require('../main/capabilities/project_capability_broker');
function makeRequest({
  requestId = 'request-1',
  projectId = 'project-a',
  rootPath = '/projects/a',
  sessionId = 'session-a',
  capability = 'filesystem',
  action = 'read',
  payload = { path: 'src/app.js' },
  cwd,
  context = { origin: 'agentic_tool_loop' },
} = {}) {
  return createProjectCapabilityRequest({
    requestId,
    principal: { kind: 'agent', kernelId: 'kernel-test' },
    projectSession: {
      sessionId,
      projectId,
      rootPath,
      realRootPath: rootPath,
      jobId: 'job-1',
      ...(cwd === undefined ? {} : { cwd }),
    },
    capability,
    action,
    payload,
    context,
  });
}

function createPendingFake({ stats = {}, now = () => Date.now(), ttlMs = 120000 } = {}) {
  const records = new Map();
  let sequence = 0;
  stats.createCalls = 0;
  stats.resolveCalls = 0;
  return {
    async create(input) {
      stats.createCalls += 1;
      const approval = Object.freeze({
        approvalId: `approval-${++sequence}`,
        ...input,
        status: 'pending',
        expiresAt: now() + ttlMs,
      });
      records.set(approval.approvalId, { approval, resolved: false });
      return { ok: true, reason: 'approval_created', approval };
    },
    async resolve(input) {
      stats.resolveCalls += 1;
      const record = records.get(input.approvalId);
      if (!record) return { ok: false, resolved: false, reason: 'approval_not_found' };
      if (record.resolved) return { ok: false, resolved: false, reason: 'approval_replayed' };
      if (record.approval.requestDigest !== input.requestDigest) {
        return { ok: false, resolved: false, reason: 'approval_digest_mismatch' };
      }
      record.resolved = true;
      return {
        ok: true,
        resolved: true,
        reason: 'approval_resolved',
        decision: input.decision,
        approval: record.approval,
      };
    },
  };
}

function createHarness({
  authorize,
  descriptors,
  grantAuthorization = { ok: false, authorized: false, reason: 'grant_not_found' },
  grantStore: injectedGrantStore = null,
  sandboxSelection = null,
  auditEvents = [],
  audit = null,
  pendingApprovalStore = createPendingFake(),
  approvalReviewer = null,
  onSandboxSelect = null,
  buildSandboxEnvironment = async () => ({}),
  now = () => Date.now(),
  cacheTtlMs,
  maxCacheEntries,
  maxPendingEntries,
} = {}) {
  return createProjectCapabilityBroker({
    authorizeProjectSession: authorize || (async (session) => ({ authorized: true, projectSession: session })),
    descriptorResolver: {
      async resolve(capability, action) {
        return descriptors[`${capability}:${action}`] || null;
      },
    },
    classifier: new CapabilityEffectClassifier(),
    policy: new CapabilityPolicyService(),
    grantStore: injectedGrantStore || {
      async inspect() { return grantAuthorization; },
      async consume() { return grantAuthorization; },
    },
    pendingApprovalStore,
    approvalReviewer: approvalReviewer || {
      async verifyDecision(input) {
        return input.proof === 'valid-proof'
          ? { verified: true, decision: input.decision }
          : { verified: false };
      },
    },
    sandboxRegistry: {
      async select() {
        if (onSandboxSelect) onSandboxSelect(arguments[0]);
        if (!sandboxSelection) throw new Error('sandbox should not have been inspected');
        return sandboxSelection;
      },
    },
    buildSandboxEnvironment,
    audit: audit || { async record(event) { auditEvents.push(event); } },
    now,
    ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }),
    ...(maxCacheEntries === undefined ? {} : { maxCacheEntries }),
    ...(maxPendingEntries === undefined ? {} : { maxPendingEntries }),
  });
}

(async () => {
  const sequence = [];
  let executeCount = 0;
  let adapterPayloadFrozen = false;
  const safeDescriptor = {
    capability: 'filesystem',
    action: 'read',
    version: 'descriptor.v1',
    kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
    effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_READ],
    adapter: {
      async execute(payload) {
        sequence.push('execute');
        executeCount += 1;
        adapterPayloadFrozen = Object.isFrozen(payload);
        return { ok: true, payload };
      },
    },
  };
  const descriptors = { 'filesystem:read': safeDescriptor };
  const request = makeRequest();
  let descriptorSawAuthoritativeSession = false;
  const broker = createProjectCapabilityBroker({
    authorizeProjectSession: async (session) => {
      sequence.push('authorize');
      return { authorized: true, projectSession: { ...session, source: 'authoritative' } };
    },
    descriptorResolver: {
      async resolve(capability, action, authorizedRequest) {
        sequence.push('descriptor');
        descriptorSawAuthoritativeSession = authorizedRequest.projectSession.source === 'authoritative';
        return safeDescriptor;
      },
    },
    classifier: {
      classify(input) {
        sequence.push('classify');
        return new CapabilityEffectClassifier().classify(input);
      },
    },
    policy: new CapabilityPolicyService(),
    grantStore: {
      inspect() {
        sequence.push('grant');
        return { authorized: false };
      },
      consume() { throw new Error('ungranted capability must not consume'); },
    },
    pendingApprovalStore: createPendingFake(),
    approvalReviewer: { verifyDecision(input) { return { verified: true, decision: input.decision }; } },
    sandboxRegistry: { select() { throw new Error('unexpected sandbox selection'); } },
    buildSandboxEnvironment: async () => ({}),
    audit: { record() {} },
    now: () => Date.now(),
  });
  const completed = await broker.execute(request);
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(descriptorSawAuthoritativeSession, true);
  assert.notStrictEqual(completed.output.payload, request.payload, 'broker payload is an immutable snapshot');
  assert.deepStrictEqual(completed.output.payload, request.payload);
  assert.strictEqual(adapterPayloadFrozen, true);
  assert.deepStrictEqual(sequence, [
    'authorize', 'descriptor', 'classify', 'grant',
    'authorize', 'descriptor', 'classify', 'authorize', 'execute',
  ]);

  // A terminal replay still authorizes before reading broker state and never executes twice.
  const replay = await broker.execute(request);
  assert.strictEqual(replay, completed);
  assert.strictEqual(executeCount, 1);
  assert.deepStrictEqual(sequence.slice(-3), ['authorize', 'descriptor', 'classify']);

  // Cached outputs are detached, JSON-safe immutable snapshots.
  const mutableAdapterOutput = { value: 'original', nested: { stable: true } };
  let mutableOutputExecutions = 0;
  const immutableOutputBroker = createHarness({
    descriptors: {
      'filesystem:read': {
        ...safeDescriptor,
        adapter: {
          execute() {
            mutableOutputExecutions += 1;
            return mutableAdapterOutput;
          },
        },
      },
    },
  });
  const immutableOutputRequest = makeRequest({ requestId: 'immutable-output' });
  const immutableOutput = await immutableOutputBroker.execute(immutableOutputRequest);
  assert.notStrictEqual(immutableOutput.output, mutableAdapterOutput);
  assert.strictEqual(Object.isFrozen(immutableOutput.output), true);
  assert.strictEqual(Object.isFrozen(immutableOutput.output.nested), true);
  mutableAdapterOutput.value = 'mutated-after-execution';
  assert.strictEqual(immutableOutput.output.value, 'original');
  assert.throws(() => { immutableOutput.output.value = 'cache-poisoned'; }, TypeError);
  const immutableOutputReplay = await immutableOutputBroker.execute(immutableOutputRequest);
  assert.strictEqual(immutableOutputReplay, immutableOutput);
  assert.strictEqual(immutableOutputReplay.output.value, 'original');
  assert.strictEqual(mutableOutputExecutions, 1);

  // Unauthorized scope fails before descriptor lookup, grant state, sandbox state or adapter.
  const unauthorizedEvents = [];
  const unauthorized = createHarness({
    authorize: async () => {
      unauthorizedEvents.push('authorize');
      return { authorized: false };
    },
    descriptors,
    auditEvents: [],
  });
  const denied = await unauthorized.execute(makeRequest({ requestId: 'unauthorized' }));
  assert.strictEqual(denied.status, 'denied');
  assert.strictEqual(denied.error.code, 'PROJECT_SCOPE_INVALID');
  assert.deepStrictEqual(unauthorizedEvents, ['authorize']);

  const booleanAuthorization = createHarness({
    authorize: async () => true,
    descriptors,
  });
  const booleanDenied = await booleanAuthorization.execute(makeRequest({ requestId: 'boolean-auth' }));
  assert.strictEqual(booleanDenied.status, 'denied');
  assert.strictEqual(booleanDenied.error.code, 'PROJECT_SCOPE_INVALID');

  const unboundCwdBroker = createHarness({
    authorize: async (session) => ({
      authorized: true,
      projectSession: { ...session, cwd: '/projects/a/other', cwdRealPath: '/projects/a/other' },
    }),
    descriptors,
  });
  const unboundCwd = await unboundCwdBroker.execute(makeRequest({
    requestId: 'unbound-cwd',
    cwd: '/projects/a/src',
  }));
  assert.strictEqual(unboundCwd.status, 'denied');
  assert.strictEqual(unboundCwd.error.code, 'PROJECT_SCOPE_INVALID');

  let descriptorSawValidAuthorizedCwd = false;
  const authorizedCwdBroker = createHarness({
    authorize: async (session) => ({
      authorized: true,
      projectSession: { ...session, cwdRealPath: session.cwd },
    }),
    descriptors: {
      'filesystem:read': {
        ...safeDescriptor,
        canonicalizePayload(input, authorizedRequest) {
          descriptorSawValidAuthorizedCwd = isProjectCapabilityRequest(authorizedRequest);
          return input;
        },
      },
    },
  });
  const authorizedCwd = await authorizedCwdBroker.execute(makeRequest({
    requestId: 'authorized-cwd',
    cwd: '/projects/a/src',
  }));
  assert.strictEqual(authorizedCwd.status, 'completed');
  assert.strictEqual(descriptorSawValidAuthorizedCwd, true);

  const effectsBeforeOutsideCwd = executeCount;
  const outsideCwdBroker = createHarness({
    authorize: async (session) => ({
      authorized: true,
      projectSession: {
        ...session,
        cwd: '/outside/project',
        cwdRealPath: '/outside/project',
      },
    }),
    descriptors,
  });
  const outsideCwd = await outsideCwdBroker.execute(makeRequest({ requestId: 'outside-cwd' }));
  assert.strictEqual(outsideCwd.status, 'denied');
  assert.strictEqual(outsideCwd.error.code, 'PROJECT_SCOPE_INVALID');
  assert.strictEqual(executeCount, effectsBeforeOutsideCwd);

  const windowsCaseBroker = createHarness({
    authorize: async (session) => ({
      authorized: true,
      projectSession: {
        ...session,
        rootPath: String.raw`c:\project`,
        realRootPath: String.raw`c:\project`,
      },
    }),
    descriptors,
  });
  const windowsCase = await windowsCaseBroker.execute(makeRequest({
    requestId: 'windows-case-root',
    rootPath: String.raw`C:\Project`,
  }));
  assert.strictEqual(windowsCase.status, 'completed');

  const effectsBeforePoisonedContext = executeCount;
  const poisonedContext = await broker.execute(makeRequest({
    requestId: 'poisoned-context',
    context: {
      origin: 'agentic_tool_loop',
      metadata: JSON.parse('{"prototype":{"collision":true}}'),
    },
  }));
  assert.strictEqual(poisonedContext.status, 'denied');
  assert.strictEqual(poisonedContext.error.code, 'INVALID_CAPABILITY_REQUEST');
  assert.strictEqual(executeCount, effectsBeforePoisonedContext);

  const sparsePayload = { values: new Array(1) };
  const sparseDenied = await broker.execute(makeRequest({
    requestId: 'sparse-payload',
    payload: sparsePayload,
  }));
  assert.strictEqual(sparseDenied.status, 'denied');
  assert.strictEqual(sparseDenied.error.code, 'INVALID_CAPABILITY_REQUEST');
  const negativeZeroDenied = await broker.execute(makeRequest({
    requestId: 'negative-zero-payload',
    payload: { offset: -0 },
  }));
  assert.strictEqual(negativeZeroDenied.status, 'denied');
  assert.strictEqual(negativeZeroDenied.error.code, 'INVALID_CAPABILITY_REQUEST');

  // A request-id collision from another project cannot read or reuse a cached result.
  const projectB = makeRequest({
    requestId: request.requestId,
    projectId: 'project-b',
    rootPath: '/projects/b',
    sessionId: 'session-b',
  });
  const effectsBeforeCrossProject = executeCount;
  const crossProject = await broker.execute(projectB);
  assert.strictEqual(crossProject.status, 'completed');
  assert.strictEqual(executeCount, effectsBeforeCrossProject + 1, 'cross-project digests must not share terminal state');

  // Approval is digest-bound, one-shot, and revalidated before the effect.
  let deleteCount = 0;
  const auditEvents = [];
  const destructiveDescriptor = {
    capability: 'filesystem',
    action: 'delete',
    version: 'descriptor.v1',
    kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
    effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE, PROJECT_CAPABILITY_EFFECTS.DESTRUCTIVE],
    adapter: { async execute() { deleteCount += 1; return { deleted: true, secret: 'output-secret' }; } },
  };
  const pendingCollisionStats = {};
  const pendingCollisionBroker = createHarness({
    descriptors: { 'filesystem:delete': destructiveDescriptor },
    pendingApprovalStore: createPendingFake({ stats: pendingCollisionStats }),
  });
  const pendingProjectARequest = makeRequest({ requestId: 'shared-pending-id', action: 'delete' });
  const pendingProjectBRequest = makeRequest({
    requestId: 'shared-pending-id',
    projectId: 'project-b',
    rootPath: '/projects/b',
    sessionId: 'session-b',
    action: 'delete',
  });
  const pendingProjectAFirst = await pendingCollisionBroker.execute(pendingProjectARequest);
  const pendingProjectB = await pendingCollisionBroker.execute(pendingProjectBRequest);
  const pendingProjectAReplay = await pendingCollisionBroker.execute(pendingProjectARequest);
  assert.strictEqual(pendingProjectAFirst.approval.approvalId, pendingProjectAReplay.approval.approvalId);
  assert.notStrictEqual(pendingProjectAFirst.approval.approvalId, pendingProjectB.approval.approvalId);
  assert.strictEqual(pendingCollisionStats.createCalls, 2);
  assert.strictEqual(pendingCollisionBroker.diagnostics().pendingRequests, 2);

  const boundedPendingStats = {};
  const boundedPendingBroker = createHarness({
    descriptors: { 'filesystem:delete': destructiveDescriptor },
    pendingApprovalStore: createPendingFake({ stats: boundedPendingStats }),
    maxPendingEntries: 1,
  });
  const boundedPendingA = await boundedPendingBroker.execute(makeRequest({
    requestId: 'bounded-pending-a',
    action: 'delete',
  }));
  const boundedPendingB = await boundedPendingBroker.execute(makeRequest({
    requestId: 'bounded-pending-b',
    projectId: 'project-b',
    rootPath: '/projects/b',
    sessionId: 'session-b',
    action: 'delete',
  }));
  const boundedPendingAReplay = await boundedPendingBroker.execute(makeRequest({
    requestId: 'bounded-pending-a',
    action: 'delete',
  }));
  assert.strictEqual(boundedPendingB.status, 'denied');
  assert.strictEqual(boundedPendingB.error.code, 'BROKER_BUSY');
  assert.strictEqual(boundedPendingA.approval.approvalId, boundedPendingAReplay.approval.approvalId);
  assert.strictEqual(boundedPendingStats.createCalls, 1);
  assert.strictEqual(boundedPendingBroker.diagnostics().pendingRequests, 1);

  let inspectionConsumes = 0;
  const inspectionBroker = createHarness({
    descriptors: { 'filesystem:delete': destructiveDescriptor },
    grantStore: {
      inspect() {
        return {
          authorized: true,
          reason: 'grant_authorized',
          grant: { grantId: 'inspection-grant' },
        };
      },
      consume() {
        inspectionConsumes += 1;
        return { authorized: true };
      },
    },
  });
  const effectiveInspection = await inspectionBroker.inspect(makeRequest({
    requestId: 'inspect-grant',
    action: 'delete',
  }));
  assert.strictEqual(effectiveInspection.schemaVersion, 'project-capability.inspection.v1');
  assert.strictEqual(effectiveInspection.decision, 'allow');
  assert.strictEqual(effectiveInspection.reasonCode, 'GRANT_AUTHORIZED');
  assert.strictEqual(effectiveInspection.grant.authorized, true);
  assert.strictEqual(inspectionConsumes, 0);

  const approvalBroker = createHarness({
    descriptors: { 'filesystem:delete': destructiveDescriptor },
    auditEvents,
  });
  const deleteRequest = makeRequest({
    requestId: 'delete-1',
    action: 'delete',
    payload: { path: 'private/secret.txt', token: 'payload-secret' },
  });
  const pending = await approvalBroker.execute(deleteRequest);
  assert.strictEqual(pending.status, 'approval_required');
  assert.strictEqual(deleteCount, 0);

  deleteRequest.payload.path = 'different.txt';
  const mutatedRequest = deleteRequest;
  const digestMismatch = await approvalBroker.approveAndExecute(mutatedRequest, {
    approvalId: pending.approval.approvalId,
    decision: 'allow',
    proof: 'valid-proof',
  });
  assert.strictEqual(digestMismatch.status, 'denied');
  assert.strictEqual(digestMismatch.error.code, 'APPROVAL_INVALID');
  assert.strictEqual(deleteCount, 0);

  const approvedRequest = makeRequest({
    requestId: 'delete-1',
    action: 'delete',
    payload: { path: 'private/secret.txt', token: 'payload-secret' },
  });
  const approved = await approvalBroker.approveAndExecute(approvedRequest, {
    approvalId: pending.approval.approvalId,
    decision: 'allow',
    proof: 'valid-proof',
  });
  assert.strictEqual(approved.status, 'completed');
  assert.strictEqual(deleteCount, 1);
  const approvedReplay = await approvalBroker.approveAndExecute(approvedRequest, {
    approvalId: pending.approval.approvalId,
    decision: 'allow',
    proof: 'valid-proof',
  });
  assert.strictEqual(approvedReplay, approved);
  assert.strictEqual(deleteCount, 1, 'approved request must execute at most once');

  const serializedAudit = JSON.stringify(auditEvents);
  assert.strictEqual(serializedAudit.includes('payload-secret'), false);
  assert.strictEqual(serializedAudit.includes('output-secret'), false);
  assert.strictEqual(serializedAudit.includes('private/secret.txt'), false);
  assert.strictEqual(serializedAudit.includes('/projects/a'), false);

  // Renderer-supplied decisions/proofs never reach the pending store unchecked.
  const invalidProofStats = {};
  let invalidProofEffects = 0;
  const invalidProofBroker = createHarness({
    descriptors: {
      'filesystem:delete': {
        ...destructiveDescriptor,
        adapter: { execute() { invalidProofEffects += 1; } },
      },
    },
    pendingApprovalStore: createPendingFake({ stats: invalidProofStats }),
  });
  const invalidProofRequest = makeRequest({ requestId: 'invalid-proof', action: 'delete' });
  const invalidProofPending = await invalidProofBroker.execute(invalidProofRequest);
  const invalidProofResult = await invalidProofBroker.approveAndExecute(invalidProofRequest, {
    approvalId: invalidProofPending.approval.approvalId,
    decision: 'allow',
    proof: 'renderer-forged-proof',
  });
  assert.strictEqual(invalidProofResult.status, 'denied');
  assert.strictEqual(invalidProofResult.error.code, 'APPROVAL_INVALID');
  assert.strictEqual(invalidProofStats.resolveCalls, 0);
  assert.strictEqual(invalidProofEffects, 0);
  const missingDecisionResult = await invalidProofBroker.approveAndExecute(invalidProofRequest, {
    approvalId: invalidProofPending.approval.approvalId,
    proof: 'valid-proof',
  });
  assert.strictEqual(missingDecisionResult.error.code, 'APPROVAL_INVALID');
  assert.strictEqual(invalidProofStats.resolveCalls, 0);
  const retriedApproval = await invalidProofBroker.approveAndExecute(invalidProofRequest, {
    approvalId: invalidProofPending.approval.approvalId,
    decision: 'allow',
    proof: 'valid-proof',
  });
  assert.strictEqual(retriedApproval.status, 'completed');
  assert.strictEqual(invalidProofStats.resolveCalls, 1);
  assert.strictEqual(invalidProofEffects, 1);

  // Approval cache entries expire and are not returned as reusable approvals.
  let approvalClock = 1000;
  const expiryStats = {};
  const expiryBroker = createHarness({
    descriptors: { 'filesystem:delete': destructiveDescriptor },
    pendingApprovalStore: createPendingFake({
      stats: expiryStats,
      now: () => approvalClock,
      ttlMs: 10,
    }),
    now: () => approvalClock,
    cacheTtlMs: 20,
  });
  const expiryRequest = makeRequest({ requestId: 'expiring-approval', action: 'delete' });
  const firstPending = await expiryBroker.execute(expiryRequest);
  approvalClock += 11;
  const replacementPending = await expiryBroker.execute(expiryRequest);
  assert.notStrictEqual(firstPending.approval.approvalId, replacementPending.approval.approvalId);
  assert.strictEqual(expiryStats.createCalls, 2);

  // A grant revoked between inspection and atomic consume cannot authorize an effect.
  let revokedGrantEffects = 0;
  let grantConsumeCalls = 0;
  const revokedGrantBroker = createProjectCapabilityBroker({
    authorizeProjectSession: async (session) => ({ authorized: true, projectSession: session }),
    descriptorResolver: {
      resolve() {
        return {
          ...destructiveDescriptor,
          adapter: { execute() { revokedGrantEffects += 1; } },
        };
      },
    },
    classifier: new CapabilityEffectClassifier(),
    policy: new CapabilityPolicyService(),
    grantStore: {
      inspect() {
        return { authorized: true, grant: { grantId: 'grant-revoked' } };
      },
      consume(input) {
        grantConsumeCalls += 1;
        assert.strictEqual(input.grantId, 'grant-revoked');
        return { authorized: false, reason: 'grant_revoked' };
      },
    },
    pendingApprovalStore: createPendingFake(),
    approvalReviewer: { verifyDecision() { throw new Error('grant should bypass approval'); } },
    sandboxRegistry: { select() { throw new Error('unexpected sandbox'); } },
    buildSandboxEnvironment: async () => ({}),
    audit: { record() {} },
    now: () => Date.now(),
  });
  const revokedGrantResult = await revokedGrantBroker.execute(makeRequest({
    requestId: 'revoked-grant',
    action: 'delete',
  }));
  assert.strictEqual(revokedGrantResult.status, 'denied');
  assert.strictEqual(revokedGrantResult.error.code, 'GRANT_REVALIDATION_FAILED');
  assert.strictEqual(grantConsumeCalls, 1);
  assert.strictEqual(revokedGrantEffects, 0);

  // Revocation during the pre-effect audit is caught by a final authoritative
  // scope check before the adapter is invoked.
  let auditBoundaryAuthorized = true;
  let auditBoundaryAuthorizationCalls = 0;
  let auditBoundaryEffects = 0;
  const auditBoundaryBroker = createHarness({
    authorize: async (session) => {
      auditBoundaryAuthorizationCalls += 1;
      return auditBoundaryAuthorized
        ? { authorized: true, projectSession: session }
        : { authorized: false };
    },
    descriptors: {
      'filesystem:read': {
        ...safeDescriptor,
        adapter: { execute() { auditBoundaryEffects += 1; return { ok: true }; } },
      },
    },
    audit: {
      record(event) {
        if (event.event === 'capability_execution_started') auditBoundaryAuthorized = false;
      },
    },
  });
  const auditBoundaryResult = await auditBoundaryBroker.execute(makeRequest({
    requestId: 'revoked-during-audit',
  }));
  assert.strictEqual(auditBoundaryResult.status, 'denied');
  assert.strictEqual(auditBoundaryResult.error.code, 'PROJECT_SCOPE_INVALID');
  assert.strictEqual(auditBoundaryAuthorizationCalls, 3);
  assert.strictEqual(auditBoundaryEffects, 0);

  let revalidationCanonicalizerCalls = 0;
  let revalidationLeakEffects = 0;
  const revalidationLeakBroker = createHarness({
    descriptors: {
      'filesystem:read': {
        ...safeDescriptor,
        canonicalizePayload(input) {
          revalidationCanonicalizerCalls += 1;
          if (revalidationCanonicalizerCalls === 2) {
            const error = new Error('private revalidation detail');
            error.code = 'leaked-lowercase-code';
            throw error;
          }
          return input;
        },
        adapter: { execute() { revalidationLeakEffects += 1; } },
      },
    },
  });
  const revalidationLeakResult = await revalidationLeakBroker.execute(makeRequest({
    requestId: 'revalidation-code-redaction',
  }));
  assert.strictEqual(revalidationLeakResult.status, 'denied');
  assert.strictEqual(revalidationLeakResult.error.code, 'REVALIDATION_FAILED');
  assert.strictEqual(JSON.stringify(revalidationLeakResult).includes('leaked-lowercase-code'), false);
  assert.strictEqual(revalidationLeakEffects, 0);

  let replayGrantActive = true;
  let replayGrantExecutions = 0;
  const replayGrantBroker = createHarness({
    descriptors: {
      'filesystem:delete': {
        ...destructiveDescriptor,
        adapter: {
          execute() {
            replayGrantExecutions += 1;
            return { secret: 'TOP-SECRET' };
          },
        },
      },
    },
    grantStore: {
      inspect() {
        return replayGrantActive
          ? {
            authorized: true,
            reason: 'grant_authorized',
            grant: { grantId: 'replay-grant' },
          }
          : { authorized: false, reason: 'grant_revoked', grant: null };
      },
      consume() {
        return replayGrantActive
          ? { authorized: true, grant: { grantId: 'replay-grant' } }
          : { authorized: false, reason: 'grant_revoked' };
      },
    },
  });
  const replayGrantRequest = makeRequest({ requestId: 'grant-result-replay', action: 'delete' });
  const replayGrantCompleted = await replayGrantBroker.execute(replayGrantRequest);
  assert.strictEqual(replayGrantCompleted.status, 'completed');
  assert.strictEqual(replayGrantCompleted.output.secret, 'TOP-SECRET');
  replayGrantActive = false;
  const replayGrantDenied = await replayGrantBroker.execute(replayGrantRequest);
  assert.strictEqual(replayGrantDenied.status, 'denied');
  assert.strictEqual(replayGrantDenied.error.code, 'TERMINAL_REPLAY_NOT_AUTHORIZED');
  assert.strictEqual(JSON.stringify(replayGrantDenied).includes('TOP-SECRET'), false);
  assert.strictEqual(replayGrantExecutions, 1);

  // Dynamic preflight denials run before grant or sandbox state is touched.
  let hardDenyGrantCalls = 0;
  let hardDenySandboxCalls = 0;
  const hardDenyBroker = createProjectCapabilityBroker({
    authorizeProjectSession: async (session) => ({ authorized: true, projectSession: session }),
    descriptorResolver: {
      resolve() {
        return {
          capability: 'filesystem',
          action: 'delete',
          version: 'descriptor.v1',
          kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
          effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE],
          classifyEffects() {
            return {
              effects: [PROJECT_CAPABILITY_EFFECTS.FILESYSTEM_DELETE],
              hardDeny: true,
              hardDenyReason: 'PROTECTED_PROJECT_PATH',
            };
          },
          adapter: { execute() { throw new Error('must not execute'); } },
        };
      },
    },
    classifier: new CapabilityEffectClassifier(),
    policy: new CapabilityPolicyService(),
    grantStore: {
      inspect() { hardDenyGrantCalls += 1; return { authorized: true }; },
      consume() { throw new Error('hard deny must not consume'); },
    },
    pendingApprovalStore: createPendingFake(),
    approvalReviewer: { verifyDecision(input) { return { verified: true, decision: input.decision }; } },
    sandboxRegistry: { select() { hardDenySandboxCalls += 1; } },
    buildSandboxEnvironment: async () => ({}),
    audit: { record() {} },
    now: () => Date.now(),
  });
  const hardDeniedResult = await hardDenyBroker.execute(makeRequest({
    requestId: 'protected-delete',
    action: 'delete',
    payload: { path: '.git/config' },
  }));
  assert.strictEqual(hardDeniedResult.status, 'denied');
  assert.strictEqual(hardDeniedResult.error.code, 'PROTECTED_PROJECT_PATH');
  assert.strictEqual(hardDenyGrantCalls, 0);
  assert.strictEqual(hardDenySandboxCalls, 0);

  // Policy/descriptor versions participate in the approval digest.
  let policyVersion = 'policy.v1';
  let descriptorVersion = 'descriptor.v1';
  const versionedPolicyDelegate = new CapabilityPolicyService();
  const versionedPolicy = {
    get version() { return policyVersion; },
    evaluate(input) { return versionedPolicyDelegate.evaluate(input); },
  };
  const versionedBroker = createProjectCapabilityBroker({
    authorizeProjectSession: async (session) => ({ authorized: true, projectSession: session }),
    descriptorResolver: { resolve() { return { ...destructiveDescriptor, version: descriptorVersion }; } },
    classifier: new CapabilityEffectClassifier(),
    policy: versionedPolicy,
    grantStore: {
      inspect() { return { authorized: false }; },
      consume() { throw new Error('ungranted capability must not consume'); },
    },
    pendingApprovalStore: createPendingFake(),
    approvalReviewer: { verifyDecision(input) { return { verified: true, decision: input.decision }; } },
    sandboxRegistry: { select() { throw new Error('unexpected sandbox'); } },
    buildSandboxEnvironment: async () => ({}),
    audit: { record() {} },
    now: () => Date.now(),
  });
  const versionedRequest = makeRequest({ requestId: 'versioned-delete', action: 'delete' });
  const versionedPending = await versionedBroker.execute(versionedRequest);
  policyVersion = 'policy.v2';
  const stalePolicyApproval = await versionedBroker.approveAndExecute(versionedRequest, {
    approvalId: versionedPending.approval.approvalId,
    decision: 'allow',
    proof: 'valid-proof',
  });
  assert.strictEqual(stalePolicyApproval.status, 'denied');
  assert.strictEqual(stalePolicyApproval.error.code, 'APPROVAL_INVALID');

  policyVersion = 'policy.v1';
  const descriptorRequest = makeRequest({ requestId: 'versioned-descriptor-delete', action: 'delete' });
  const descriptorPending = await versionedBroker.execute(descriptorRequest);
  descriptorVersion = 'descriptor.v2';
  const staleDescriptorApproval = await versionedBroker.approveAndExecute(descriptorRequest, {
    approvalId: descriptorPending.approval.approvalId,
    decision: 'allow',
    proof: 'valid-proof',
  });
  assert.strictEqual(staleDescriptorApproval.status, 'denied');
  assert.strictEqual(staleDescriptorApproval.error.code, 'APPROVAL_INVALID');

  // Process execution fails closed without every A1 guarantee, even with a grant.
  let sandboxExecuteCount = 0;
  let secretEnvironmentBuilds = 0;
  const secretAccessBroker = createHarness({
    descriptors: {
      'process:run': {
        capability: 'process',
        action: 'run',
        version: 'secret-access.v1',
        kind: PROJECT_CAPABILITY_KINDS.PROCESS,
        effects: [
          PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE,
          PROJECT_CAPABILITY_EFFECTS.SECRET_ACCESS,
        ],
        createSandboxExecutionSpec() {
          return { command: { kind: 'shell', text: 'npm test' } };
        },
      },
    },
    buildSandboxEnvironment: async () => {
      secretEnvironmentBuilds += 1;
      return { TOKEN: 'must-not-materialize' };
    },
  });
  const secretAccessDenied = await secretAccessBroker.execute(makeRequest({
    requestId: 'secret-access-disabled',
    capability: 'process',
    action: 'run',
  }));
  assert.strictEqual(secretAccessDenied.status, 'denied');
  assert.strictEqual(secretAccessDenied.error.code, 'SECRET_ACCESS_DISABLED');
  assert.strictEqual(secretEnvironmentBuilds, 0);

  const processDescriptor = {
    capability: 'process',
    action: 'run',
    version: 'descriptor.v1',
    kind: PROJECT_CAPABILITY_KINDS.PROCESS,
    effects: [PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE],
    createSandboxExecutionSpec(payload) { return payload; },
  };
  const insufficientSandboxBroker = createHarness({
    descriptors: { 'process:run': processDescriptor },
    grantAuthorization: { authorized: true },
    sandboxSelection: {
      backend: { id: 'fake', async execute() { sandboxExecuteCount += 1; } },
      probe: { state: 'enforced', features: ['filesystem_scope', 'process_execute'] },
    },
  });
  const processDenied = await insufficientSandboxBroker.execute(makeRequest({
    requestId: 'process-1',
    capability: 'process',
    action: 'run',
    payload: { command: 'npm', args: ['test'] },
  }));
  assert.strictEqual(processDenied.status, 'denied');
  assert.strictEqual(processDenied.error.code, 'SANDBOX_GUARANTEES_INSUFFICIENT');
  assert.strictEqual(sandboxExecuteCount, 0);

  // The broker validates and binds the sandbox request rather than trusting the descriptor.
  const fullyEnforcedProbe = {
    state: 'enforced',
    features: [
      'filesystem_scope',
      'network_isolation',
      'process_execute',
      'process_tree_termination',
    ],
  };

  let canonicalEnvironmentExecutions = 0;
  const environmentInputs = [];
  let canonicalEnvironmentRequest = makeRequest({
    requestId: 'canonical-environment',
    capability: 'process',
    action: 'run',
    payload: { command: 'npm test', token: 'token-a' },
  });
  const canonicalEnvironmentBroker = createHarness({
    descriptors: {
      'process:run': {
        capability: 'process',
        action: 'run',
        version: 'canonical-environment.v1',
        kind: PROJECT_CAPABILITY_KINDS.PROCESS,
        effects: [
          PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE,
          PROJECT_CAPABILITY_EFFECTS.NETWORK_ACCESS,
        ],
        canonicalizePayload(input) {
          return { command: input.command };
        },
        createSandboxExecutionSpec(input) {
          return { command: { kind: 'shell', text: input.command } };
        },
      },
    },
    sandboxSelection: {
      backend: {
        id: 'canonical-environment-backend',
        async execute(requestInput) {
          canonicalEnvironmentExecutions += 1;
          assert.deepStrictEqual(requestInput.env, { SAFE_FLAG: '1' });
          return { exitCode: 0 };
        },
      },
      probe: fullyEnforcedProbe,
    },
    buildSandboxEnvironment: async (input) => {
      environmentInputs.push(input);
      assert.strictEqual('request' in input, false);
      assert.deepStrictEqual(input.canonicalRequest.payload, { command: 'npm test' });
      return { SAFE_FLAG: '1' };
    },
  });
  const canonicalEnvironmentPending = await canonicalEnvironmentBroker.execute(canonicalEnvironmentRequest);
  assert.strictEqual(canonicalEnvironmentPending.status, 'approval_required');
  canonicalEnvironmentRequest = makeRequest({
    requestId: 'canonical-environment',
    capability: 'process',
    action: 'run',
    payload: { command: 'npm test', token: 'token-b' },
  });
  const canonicalEnvironmentApproved = await canonicalEnvironmentBroker.approveAndExecute(
    canonicalEnvironmentRequest,
    {
      approvalId: canonicalEnvironmentPending.approval.approvalId,
      decision: 'allow',
      proof: 'valid-proof',
    }
  );
  assert.strictEqual(canonicalEnvironmentApproved.status, 'completed');
  assert.strictEqual(canonicalEnvironmentExecutions, 1);
  assert.ok(environmentInputs.length >= 3, 'sandbox environment must be rebuilt for digest revalidation');

  let nondeterministicPlanCalls = 0;
  let nondeterministicExecutions = 0;
  const nondeterministicBroker = createHarness({
    descriptors: {
      'process:run': {
        capability: 'process',
        action: 'run',
        version: 'nondeterministic-plan.v1',
        kind: PROJECT_CAPABILITY_KINDS.PROCESS,
        effects: [PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE],
        requiresApproval: true,
        createSandboxExecutionSpec() {
          nondeterministicPlanCalls += 1;
          return {
            command: {
              kind: 'shell',
              text: nondeterministicPlanCalls <= 2 ? 'npm test' : 'npm publish',
            },
          };
        },
      },
    },
    sandboxSelection: {
      backend: {
        id: 'nondeterministic-backend',
        async execute() { nondeterministicExecutions += 1; },
      },
      probe: fullyEnforcedProbe,
    },
  });
  const nondeterministicRequest = makeRequest({
    requestId: 'nondeterministic-plan',
    capability: 'process',
    action: 'run',
    payload: { command: 'ignored' },
  });
  const nondeterministicPending = await nondeterministicBroker.execute(nondeterministicRequest);
  const nondeterministicDenied = await nondeterministicBroker.approveAndExecute(
    nondeterministicRequest,
    {
      approvalId: nondeterministicPending.approval.approvalId,
      decision: 'allow',
      proof: 'valid-proof',
    }
  );
  assert.strictEqual(nondeterministicDenied.status, 'denied');
  assert.strictEqual(nondeterministicDenied.error.code, 'REQUEST_CHANGED');
  assert.strictEqual(nondeterministicExecutions, 0);

  const mismatchedProcessBroker = createHarness({
    descriptors: {
      'process:run': {
        ...processDescriptor,
        createSandboxExecutionSpec() {
          return {
            cwd: '/outside/project',
            command: { kind: 'executable', executable: 'npm', args: ['test'] },
          };
        },
      },
    },
    sandboxSelection: {
      backend: { id: 'fake', async execute() { sandboxExecuteCount += 1; } },
      probe: fullyEnforcedProbe,
    },
  });
  const mismatchedProcess = await mismatchedProcessBroker.execute(makeRequest({
    requestId: 'process-mismatch',
    capability: 'process',
    action: 'run',
    payload: { command: 'npm', args: ['test'] },
  }));
  assert.strictEqual(mismatchedProcess.status, 'completed');
  assert.strictEqual(sandboxExecuteCount, 1, 'descriptor cwd must be ignored in favor of authorized cwd');

  let receivedSandboxRequest = null;
  const boundProcessBroker = createHarness({
    descriptors: {
      'process:run': {
        ...processDescriptor,
        createSandboxExecutionSpec(payload) {
          return {
            command: { kind: 'executable', executable: payload.command, args: payload.args },
            cwd: '/descriptor/cwd/is/ignored',
            env: { API_TOKEN: 'descriptor-secret-must-not-pass' },
          };
        },
      },
    },
    sandboxSelection: {
      backend: {
        id: 'fake',
        async execute(sandboxRequest) {
          receivedSandboxRequest = sandboxRequest;
          return { exitCode: 0 };
        },
      },
      probe: fullyEnforcedProbe,
    },
    buildSandboxEnvironment: async () => ({ SAFE_TEST_FLAG: '1' }),
  });
  const boundProcess = await boundProcessBroker.execute(makeRequest({
    requestId: 'process-bound',
    capability: 'process',
    action: 'run',
    payload: { command: 'npm', args: ['test'] },
  }));
  assert.strictEqual(boundProcess.status, 'completed');
  assert.strictEqual(receivedSandboxRequest.rootPath, '/projects/a');
  assert.strictEqual(receivedSandboxRequest.realRootPath, '/projects/a');
  assert.match(receivedSandboxRequest.executionId, /^sandbox-exec:[a-f0-9]{64}$/);
  assert.strictEqual(receivedSandboxRequest.requestId, 'process-bound');
  assert.match(receivedSandboxRequest.grantId, /^sandbox-auth:[a-f0-9]{64}$/);
  assert.deepStrictEqual(receivedSandboxRequest.env, { SAFE_TEST_FLAG: '1' });
  assert.strictEqual('API_TOKEN' in receivedSandboxRequest.env, false);

  const collidingExecutionIds = [];
  const executionIdBroker = createHarness({
    descriptors: {
      'process:run': {
        capability: 'process',
        action: 'run',
        version: 'execution-id.v1',
        kind: PROJECT_CAPABILITY_KINDS.PROCESS,
        effects: [PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE],
        createSandboxExecutionSpec() {
          return { command: { kind: 'shell', text: 'npm test' } };
        },
      },
    },
    sandboxSelection: {
      backend: {
        id: 'execution-id-backend',
        async execute(input) {
          collidingExecutionIds.push(input.executionId);
          return { exitCode: 0 };
        },
      },
      probe: fullyEnforcedProbe,
    },
  });
  await executionIdBroker.execute(makeRequest({
    requestId: 'shared-process-request',
    capability: 'process',
    action: 'run',
  }));
  await executionIdBroker.execute(makeRequest({
    requestId: 'shared-process-request',
    projectId: 'project-b',
    rootPath: '/projects/b',
    sessionId: 'session-b',
    capability: 'process',
    action: 'run',
  }));
  assert.strictEqual(collidingExecutionIds.length, 2);
  assert.notStrictEqual(collidingExecutionIds[0], collidingExecutionIds[1]);

  // Concurrent duplicate calls share the same in-flight execution.
  let releaseExecution;
  let concurrentCount = 0;
  const concurrentDescriptor = {
    ...safeDescriptor,
    adapter: {
      async execute() {
        concurrentCount += 1;
        await new Promise((resolve) => { releaseExecution = resolve; });
        return { ok: true };
      },
    },
  };
  const concurrentBroker = createHarness({
    descriptors: { 'filesystem:read': concurrentDescriptor },
  });
  const concurrentRequest = makeRequest({ requestId: 'concurrent-1' });
  const first = concurrentBroker.execute(concurrentRequest);
  const second = concurrentBroker.execute(concurrentRequest);
  while (!releaseExecution) await new Promise((resolve) => setImmediate(resolve));
  releaseExecution();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.strictEqual(firstResult, secondResult);
  assert.strictEqual(concurrentCount, 1);

  const boundedBroker = createHarness({
    descriptors,
    maxCacheEntries: 2,
  });
  await boundedBroker.execute(makeRequest({ requestId: 'bounded-1' }));
  await boundedBroker.execute(makeRequest({ requestId: 'bounded-2' }));
  await boundedBroker.execute(makeRequest({ requestId: 'bounded-3' }));
  assert.strictEqual(boundedBroker.diagnostics().terminalRequests, 2);
  assert.strictEqual(boundedBroker.diagnostics().idempotencyScope, 'process_local');

  // Adapter failures are stable and do not leak exception messages.
  const failedAudit = [];
  const failureBroker = createHarness({
    descriptors: {
      'filesystem:read': {
        ...safeDescriptor,
        adapter: { async execute() { throw new Error('secret-adapter-message'); } },
      },
    },
    auditEvents: failedAudit,
  });
  const failure = await failureBroker.execute(makeRequest({ requestId: 'failure-1' }));
  assert.strictEqual(failure.status, 'failed');
  assert.strictEqual(failure.error.code, 'EXECUTION_FAILED');
  assert.strictEqual(JSON.stringify(failure).includes('secret-adapter-message'), false);
  assert.strictEqual(JSON.stringify(failedAudit).includes('secret-adapter-message'), false);

  // A post-effect audit outage cannot turn a successful mutation into a retryable failure.
  let postAuditCalls = 0;
  let postAuditExecutions = 0;
  const postAuditBroker = createProjectCapabilityBroker({
    authorizeProjectSession: async (session) => ({ authorized: true, projectSession: session }),
    descriptorResolver: {
      resolve() {
        return {
          ...safeDescriptor,
          adapter: { async execute() { postAuditExecutions += 1; return { persisted: true }; } },
        };
      },
    },
    classifier: new CapabilityEffectClassifier(),
    policy: new CapabilityPolicyService(),
    grantStore: {
      inspect() { return { authorized: false }; },
      consume() { throw new Error('ungranted capability must not consume'); },
    },
    pendingApprovalStore: createPendingFake(),
    approvalReviewer: { verifyDecision(input) { return { verified: true, decision: input.decision }; } },
    sandboxRegistry: { select() { throw new Error('unexpected sandbox'); } },
    buildSandboxEnvironment: async () => ({}),
    audit: {
      record() {
        postAuditCalls += 1;
        if (postAuditCalls === 2) throw new Error('audit storage unavailable');
      },
    },
    now: () => Date.now(),
  });
  const postAuditRequest = makeRequest({ requestId: 'post-audit-1' });
  const postAuditResult = await postAuditBroker.execute(postAuditRequest);
  assert.strictEqual(postAuditResult.status, 'completed');
  assert.strictEqual(postAuditExecutions, 1);
  assert.strictEqual(postAuditBroker.diagnostics().auditFailures, 1);
  const postAuditReplay = await postAuditBroker.execute(postAuditRequest);
  assert.strictEqual(postAuditReplay, postAuditResult);
  assert.strictEqual(postAuditExecutions, 1);
  assert.strictEqual('resolveApproval' in postAuditBroker, false);

  console.log('project capability broker tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
