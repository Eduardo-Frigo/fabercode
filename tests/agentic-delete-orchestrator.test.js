'use strict';

const assert = require('assert');

const {
  CAPABILITY_DELEGATION_MODES,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  canonicalSha256Digest,
  createTransactionalDeletePlan,
  createTransactionalDeletePublicResult,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  AGENTIC_DELETE_ERROR_CODES,
  createAgenticDeleteOrchestrator,
} = require('../main/services/agentic_delete_orchestrator');

const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

function makeBinding(overrides = {}) {
  return Object.freeze({
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

function deferred() {
  let resolve;
  const promise = new Promise((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

function createHarness({
  nativeApproved = true,
  delegated = false,
  delegationInspectable = true,
  deferredNative = null,
  beforeAdapter = null,
  executeAdapterEarly = false,
  initialBrokerStatus = 'approval_required',
} = {}) {
  const binding = makeBinding();
  const events = [];
  const stats = {
    aborts: 0,
    approvals: 0,
    brokerApprovals: 0,
    brokerExecutions: 0,
    brokerRequest: null,
    brokerRequestDigest: null,
    commits: 0,
    delegationConsumes: 0,
    delegationInspections: 0,
    finalizations: 0,
    nativeCancels: 0,
    nativeConsumes: 0,
    nativeInvalidations: 0,
    nativeRequests: 0,
    recoveries: 0,
    renames: 0,
    revocations: 0,
    rollbacks: 0,
    taskCancels: 0,
    taskConsents: 0,
    taskInvalidations: 0,
    replayDecision: null,
  };
  const lifecycle = { authorized: true };
  const root = { authorized: true };
  const windowLease = Object.freeze({ lease: 'window-a' });
  let requestSequence = 0;
  let individualActive = false;
  let individualLastConsumed = false;
  let delegatedActive = false;
  let delegatedLastConsumed = false;
  let retainedCommitted = 0;
  let preparedCount = 0;

  const transactionalDeleteService = {
    prepare(input) {
      const entries = input.paths.map((relativePath) => ({ relativePath, kind: 'file' }));
      const plan = createTransactionalDeletePlan({
        request: { paths: input.paths },
        pathStyle: input.pathStyle,
        caseSensitive: input.caseSensitive,
        entries,
        impact: {
          files: entries.length,
          bytes: entries.length * 13,
          directories: 0,
        },
      });
      const checkpointDigest = canonicalSha256Digest({
        checkpoint: plan.planDigest,
        transaction: preparedCount + 1,
      });
      const publicPlanImpact = Object.freeze({
        files: plan.impact.files,
        bytes: plan.impact.bytes,
        directories: plan.impact.directories,
      });
      let state = 'PREPARED';
      preparedCount += 1;
      const verification = Object.freeze({
        effect: 'filesystem_delete',
        binding,
        deleteRequestDigest: plan.requestDigest,
        impactDigest: plan.impactDigest,
        checkpointDigest,
        checkpointVerified: true,
        exactPathsVerified: true,
        protectedPathsRejected: true,
        impact: plan.impact,
      });
      const handle = Object.freeze({
        inspect() {
          return Object.freeze({
            state,
            plan,
            checkpointManifest: Object.freeze({ checkpointDigest }),
            retention: 'until_job_terminal',
          });
        },
        verify() {
          if (state !== 'PREPARED') throw new Error('not prepared');
          return verification;
        },
        commit({ decisionRequestDigest, consumeDecision }) {
          stats.commits += 1;
          if (state !== 'PREPARED' || decisionRequestDigest !== plan.requestDigest) {
            return createTransactionalDeletePublicResult({
              status: 'denied',
              state: 'PURGED',
              impact: publicPlanImpact,
              errorCode: 'TRANSACTION_NOT_PREPARED',
            });
          }
          state = 'APPLYING';
          const facts = Object.freeze({
            ...verification,
            requestDigest: decisionRequestDigest,
          });
          events.push('transaction:consume');
          const decision = consumeDecision(facts);
          stats.replayDecision = () => consumeDecision(facts);
          if (!decision || decision.authorized !== true) {
            state = 'PURGED';
            return createTransactionalDeletePublicResult({
              status: 'denied',
              state,
              impact: publicPlanImpact,
              errorCode: 'DECISION_DENIED',
            });
          }
          // This event represents the first synchronous rename frontier.
          events.push('transaction:first-rename');
          stats.renames += 1;
          state = 'COMMITTED';
          retainedCommitted += 1;
          return Object.freeze({
            ...createTransactionalDeletePublicResult({
              status: 'completed',
              state,
              impact: publicPlanImpact,
              errorCode: null,
            }),
            freshApprovalRequired: false,
          });
        },
        abort() {
          stats.aborts += 1;
          if (state === 'COMMITTED') retainedCommitted -= 1;
          state = 'PURGED';
          return Object.freeze({ ok: true, state });
        },
      });
      return handle;
    },
    finalizeJob({ outcome }) {
      stats.finalizations += 1;
      const successful = outcome === 'success' || outcome === 'completed';
      const purged = successful ? retainedCommitted : 0;
      const rolledBack = successful ? 0 : retainedCommitted;
      retainedCommitted = 0;
      return Object.freeze({ ok: true, purged, rolledBack, recoveryRequired: 0 });
    },
    rollbackJob() {
      stats.rollbacks += 1;
      const rolledBack = retainedCommitted;
      retainedCommitted = 0;
      return Object.freeze({ ok: true, purged: 0, rolledBack, recoveryRequired: 0 });
    },
    recoverProject() {
      stats.recoveries += 1;
      return Object.freeze({
        ok: true,
        recovered: 1,
        retainedCommitted,
        retainedUnknown: 0,
      });
    },
    diagnostics() {
      return Object.freeze({
        prepared: Math.max(0, preparedCount - retainedCommitted),
        committed: retainedCommitted,
        recoveryRequired: 0,
        hiddenRoot: binding.realRootPath,
      });
    },
  };

  const nativeEffectApprovalService = {
    requestDecision(input) {
      stats.nativeRequests += 1;
      stats.nativeInput = input;
      events.push('native:request');
      if (deferredNative) return deferredNative.promise;
      individualActive = nativeApproved;
      individualLastConsumed = false;
      return Promise.resolve(Object.freeze({
        ok: nativeApproved,
        approved: nativeApproved,
        reason: nativeApproved ? 'native_effect_approved' : 'native_effect_denied',
      }));
    },
    consumeDecision(input) {
      stats.nativeConsumes += 1;
      events.push('native:consume');
      if (input !== stats.nativeInput || !individualActive || individualLastConsumed || !nativeApproved) {
        return Object.freeze({ ok: false, approved: false, reason: 'native_effect_replayed' });
      }
      individualActive = false;
      individualLastConsumed = true;
      return Object.freeze({ ok: true, approved: true, reason: 'native_effect_approved' });
    },
    cancelJob() {
      stats.nativeCancels += 1;
      individualActive = false;
      return Object.freeze({ ok: true, canceled: 1, revoked: individualLastConsumed ? 0 : 1 });
    },
    invalidateWindow() {
      stats.nativeInvalidations += 1;
      return Object.freeze({ ok: true, canceled: 0, revoked: 0 });
    },
    diagnostics() { return Object.freeze({ activeDecisions: individualActive ? 1 : 0 }); },
  };

  const nativeTaskConsentService = {
    ensureTaskDelegation() {
      stats.taskConsents += 1;
      return Promise.resolve(Object.freeze(delegated
        ? { ok: true, mode: 'delegate_task', delegated: true, reason: 'delegation_issued' }
        : { ok: true, mode: 'ask_each', delegated: false, reason: 'ask_each_selected' }));
    },
    cancelJob() {
      stats.taskCancels += 1;
      return Object.freeze({ ok: true, canceled: 0, revoked: delegated ? 1 : 0 });
    },
    invalidateWindow() {
      stats.taskInvalidations += 1;
      return Object.freeze({ ok: true, canceled: 0, revoked: 0 });
    },
    diagnostics() { return Object.freeze({ activeDelegations: delegated ? 1 : 0 }); },
  };

  const taskDelegationStore = {
    inspectDecision(input) {
      stats.delegationInspections += 1;
      stats.delegationInput = input;
      delegatedActive = delegationInspectable;
      delegatedLastConsumed = false;
      return Object.freeze({
        ok: delegationInspectable,
        authorized: delegationInspectable,
        reason: delegationInspectable ? 'delegation_authorized' : 'delegation_expired',
      });
    },
    consumeDecision(input) {
      stats.delegationConsumes += 1;
      events.push('delegation:consume');
      if (input !== stats.delegationInput
        || !delegatedActive
        || delegatedLastConsumed
        || !delegationInspectable) {
        return Object.freeze({ ok: false, authorized: false, reason: 'delegation_decision_replayed' });
      }
      delegatedActive = false;
      delegatedLastConsumed = true;
      return Object.freeze({ ok: true, authorized: true, reason: 'delegation_authorized' });
    },
    revokeBinding() {
      stats.revocations += 1;
      delegatedActive = false;
      return Object.freeze({ ok: true, revoked: delegated ? 1 : 0 });
    },
    diagnostics() { return Object.freeze({ activeDelegations: delegated ? 1 : 0 }); },
  };

  function createBroker(config) {
    stats.brokerConfig = config;
    return Object.freeze({
      async execute(request) {
        stats.brokerExecutions += 1;
        stats.brokerRequest = request;
        stats.brokerRequestDigest = canonicalSha256Digest(request);
        if (executeAdapterEarly) {
          stats.earlyOutput = config.adapter.execute(request.payload, { untrusted: true });
        }
        if (initialBrokerStatus !== 'approval_required') {
          return Object.freeze({
            status: initialBrokerStatus,
            decision: 'deny',
            error: Object.freeze({ code: 'INTERNAL_SECRET', message: binding.realRootPath }),
          });
        }
        return Object.freeze({
          status: 'approval_required',
          decision: 'require_approval',
          approval: Object.freeze({
            approvalId: 'approval-routing-1',
            status: 'pending',
            expiresAt: Date.now() + 60_000,
          }),
        });
      },
      async approveAndExecute(request, approval) {
        stats.brokerApprovals += 1;
        const reviewed = await config.approvalReviewer.verifyDecision({
          approvalId: approval.approvalId,
          requestDigest: stats.brokerRequestDigest,
          decision: approval.decision,
          proof: approval.proof,
        });
        if (!reviewed.verified) {
          return Object.freeze({ status: 'denied', decision: 'deny' });
        }
        if (beforeAdapter) beforeAdapter({ lifecycle, root, stats, request });
        const output = config.adapter.execute(request.payload, Object.freeze({}));
        return Object.freeze({
          status: 'completed',
          decision: 'allow',
          output: Object.freeze({
            ...output,
            injectedRoot: binding.realRootPath,
            injectedDigest: stats.brokerRequestDigest,
          }),
        });
      },
    });
  }

  const orchestrator = createAgenticDeleteOrchestrator({
    createBroker,
    transactionalDeleteService,
    nativeEffectApprovalService,
    nativeTaskConsentService,
    taskDelegationStore,
    authorizeLifecycle(candidate) {
      return lifecycle.authorized
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false, binding: candidate });
    },
    authorizeRoot(candidate) {
      return root.authorized
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false, binding: candidate });
    },
    getWindowLease() { return windowLease; },
    getActorId() { return 'actor-user-a'; },
    requestIdFactory() {
      requestSequence += 1;
      return `agentic-delete-${requestSequence}`;
    },
    pathStyle: 'posix',
    caseSensitive: true,
  });

  function executeInput(overrides = {}) {
    return {
      binding,
      requestedMode: CAPABILITY_DELEGATION_MODES.ASK_EACH,
      paths: ['src/old.txt'],
      signal: new AbortController().signal,
      projectLabel: 'Projeto confidencial',
      ...overrides,
    };
  }

  return {
    binding,
    events,
    executeInput,
    lifecycle,
    orchestrator,
    root,
    stats,
  };
}

test('ask_each keeps broker routing and delete authority as separate digests', async () => {
  const harness = createHarness();
  const result = await harness.orchestrator.executeDeletePaths(harness.executeInput());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.mode, 'ask_each');
  assert.strictEqual(result.state, 'COMMITTED');
  assert.deepStrictEqual(result.impact, { files: 1, bytes: 13, directories: 0 });
  assert.strictEqual(harness.stats.nativeRequests, 1);
  assert.strictEqual(harness.stats.nativeConsumes, 1);
  assert.strictEqual(harness.stats.renames, 1);
  assert.strictEqual(
    harness.stats.nativeInput.requestDigest,
    harness.stats.brokerRequest.payload.deleteRequestDigest
  );
  assert.strictEqual(
    harness.stats.brokerConfig.effects.includes('filesystem_delete'),
    true
  );
  assert.strictEqual(harness.stats.brokerConfig.effects.includes('destructive'), true);
  assert.strictEqual(harness.stats.brokerConfig.requiresApproval, true);
  assert.notStrictEqual(
    harness.stats.nativeInput.requestDigest,
    harness.stats.brokerRequestDigest,
    'the one-shot delete digest must never be replaced with the broker routing digest'
  );
  const consumeIndex = harness.events.indexOf('native:consume');
  assert.strictEqual(harness.events[consumeIndex + 1], 'transaction:first-rename');

  const replay = harness.stats.replayDecision();
  assert.deepStrictEqual(replay, { authorized: false });
  assert.strictEqual(harness.stats.renames, 1);

  const serialized = JSON.stringify(result);
  for (const secret of [
    '/projects/a',
    'src/old.txt',
    'sha256:',
    'approval-routing-1',
    'Projeto confidencial',
    'injectedRoot',
  ]) {
    assert.strictEqual(serialized.includes(secret), false, `public result leaked ${secret}`);
  }
});

test('individual denial never approves the broker or enters commit', async () => {
  const harness = createHarness({ nativeApproved: false });
  const result = await harness.orchestrator.executeDeletePaths(harness.executeInput());
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(result.errorCode, AGENTIC_DELETE_ERROR_CODES.APPROVAL_DENIED);
  assert.strictEqual(harness.stats.brokerApprovals, 0);
  assert.strictEqual(harness.stats.commits, 0);
  assert.strictEqual(harness.stats.renames, 0);
  assert.ok(harness.stats.aborts >= 1);
});

test('the internal routing proof is opaque and cannot be forged', async () => {
  const harness = createHarness();
  const execution = harness.orchestrator.executeDeletePaths(harness.executeInput());
  await new Promise((resolve) => setImmediate(resolve));
  const forged = harness.stats.brokerConfig.approvalReviewer.verifyDecision({
    decision: 'allow',
    proof: Object.freeze(Object.create(null)),
  });
  assert.deepStrictEqual(forged, { verified: false, decision: 'deny' });
  const result = await execution;
  assert.strictEqual(result.status, 'completed');
});

test('delegate_task inspects and consumes task authority synchronously', async () => {
  const harness = createHarness({ delegated: true });
  const result = await harness.orchestrator.executeDeletePaths(harness.executeInput({
    requestedMode: CAPABILITY_DELEGATION_MODES.DELEGATE_TASK,
  }));
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.mode, 'delegate_task');
  assert.strictEqual(harness.stats.taskConsents, 1);
  assert.strictEqual(harness.stats.delegationInspections, 1);
  assert.strictEqual(harness.stats.delegationConsumes, 1);
  assert.strictEqual(harness.stats.nativeRequests, 0);
  const consumeIndex = harness.events.indexOf('delegation:consume');
  assert.strictEqual(harness.events[consumeIndex + 1], 'transaction:first-rename');
  assert.deepStrictEqual(harness.stats.replayDecision(), { authorized: false });
});

test('expired delegation falls back to a fresh individual decision', async () => {
  const harness = createHarness({ delegated: true, delegationInspectable: false });
  const result = await harness.orchestrator.executeDeletePaths(harness.executeInput({
    requestedMode: CAPABILITY_DELEGATION_MODES.DELEGATE_TASK,
  }));
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(result.mode, 'ask_each');
  assert.strictEqual(harness.stats.delegationInspections, 1);
  assert.strictEqual(harness.stats.delegationConsumes, 0);
  assert.strictEqual(harness.stats.nativeRequests, 1);
  assert.strictEqual(harness.stats.nativeConsumes, 1);
});

test('AbortSignal wins a pending native-dialog race and late approval cannot execute', async () => {
  const nativeDialog = deferred();
  const harness = createHarness({ deferredNative: nativeDialog });
  const controller = new AbortController();
  const execution = harness.orchestrator.executeDeletePaths(harness.executeInput({
    signal: controller.signal,
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.stats.nativeRequests, 1);
  controller.abort();
  const result = await execution;
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(result.errorCode, AGENTIC_DELETE_ERROR_CODES.OPERATION_CANCELED);
  assert.strictEqual(harness.stats.brokerApprovals, 0);
  assert.strictEqual(harness.stats.commits, 0);
  assert.strictEqual(harness.stats.renames, 0);
  nativeDialog.resolve(Object.freeze({ ok: true, approved: true, reason: 'native_effect_approved' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(harness.stats.renames, 0);
});

test('lifecycle revocation at broker-to-adapter frontier fails closed', async () => {
  const harness = createHarness({
    beforeAdapter({ lifecycle }) { lifecycle.authorized = false; },
  });
  const result = await harness.orchestrator.executeDeletePaths(harness.executeInput());
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(harness.stats.nativeConsumes, 0);
  assert.strictEqual(harness.stats.commits, 0);
  assert.strictEqual(harness.stats.renames, 0);
  assert.ok(harness.stats.aborts >= 1);
});

test('a broker that enters the adapter before fresh approval is quarantined', async () => {
  const harness = createHarness({ executeAdapterEarly: true });
  const result = await harness.orchestrator.executeDeletePaths(harness.executeInput());
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(
    result.errorCode,
    AGENTIC_DELETE_ERROR_CODES.BROKER_FRESH_APPROVAL_REQUIRED
  );
  assert.strictEqual(harness.stats.nativeRequests, 0);
  assert.strictEqual(harness.stats.commits, 0);
  assert.strictEqual(harness.stats.renames, 0);
});

test('window invalidation cancels pending work and rolls back without waiting for dialog', async () => {
  const nativeDialog = deferred();
  const harness = createHarness({ deferredNative: nativeDialog });
  const execution = harness.orchestrator.executeDeletePaths(harness.executeInput());
  await new Promise((resolve) => setImmediate(resolve));
  const invalidated = harness.orchestrator.invalidateWindow('window_navigation');
  assert.strictEqual(invalidated.invalidated, 1);
  assert.strictEqual(harness.stats.nativeInvalidations, 1);
  assert.strictEqual(harness.stats.taskInvalidations, 1);
  const result = await execution;
  assert.strictEqual(result.status, 'denied');
  assert.strictEqual(result.errorCode, AGENTIC_DELETE_ERROR_CODES.OPERATION_CANCELED);
  assert.strictEqual(harness.stats.renames, 0);
  nativeDialog.resolve(Object.freeze({ ok: true, approved: true, reason: 'native_effect_approved' }));
});

test('terminal success purges; failure rolls back; recovery and diagnostics expose counts only', async () => {
  const harness = createHarness();
  const completed = await harness.orchestrator.executeDeletePaths(harness.executeInput());
  assert.strictEqual(completed.status, 'completed');

  const terminal = harness.orchestrator.onJobTerminal({
    binding: harness.binding,
    status: 'success',
  });
  assert.deepStrictEqual(terminal, {
    ok: true,
    purged: 1,
    rolledBack: 0,
    recoveryRequired: 0,
    invalidated: 0,
  });

  const second = await harness.orchestrator.executeDeletePaths(harness.executeInput({
    paths: ['src/second-old.txt'],
  }));
  assert.strictEqual(second.status, 'completed');
  const failedTerminal = harness.orchestrator.onJobTerminal({
    binding: harness.binding,
    status: 'failed',
  });
  assert.deepStrictEqual(failedTerminal, {
    ok: true,
    purged: 0,
    rolledBack: 1,
    recoveryRequired: 0,
    invalidated: 0,
  });

  const recovery = harness.orchestrator.recoverProject({ binding: harness.binding });
  assert.deepStrictEqual(recovery, {
    ok: true,
    recovered: 1,
    retainedCommitted: 0,
    retainedUnknown: 0,
  });
  const revoked = harness.orchestrator.revokeJob({
    binding: harness.binding,
    reason: 'user_revoked',
  });
  assert.strictEqual(revoked.ok, true);
  assert.strictEqual(revoked.invalidated, 0);

  const diagnostics = harness.orchestrator.diagnostics();
  assert.strictEqual(diagnostics.activeOperations, 0);
  assert.strictEqual(diagnostics.completedOperations, 2);
  const serialized = JSON.stringify({
    terminal,
    failedTerminal,
    recovery,
    revoked,
    diagnostics,
  });
  assert.strictEqual(serialized.includes('/projects/a'), false);
  assert.strictEqual(serialized.includes('hiddenRoot'), false);
});

test('invalid input and broker denial return stable non-leaking denials', async () => {
  const harness = createHarness({ initialBrokerStatus: 'denied' });
  const deniedByBroker = await harness.orchestrator.executeDeletePaths(harness.executeInput());
  assert.strictEqual(deniedByBroker.status, 'denied');
  assert.strictEqual(
    deniedByBroker.errorCode,
    AGENTIC_DELETE_ERROR_CODES.BROKER_FRESH_APPROVAL_REQUIRED
  );
  assert.strictEqual(JSON.stringify(deniedByBroker).includes('/projects/a'), false);

  const invalid = await harness.orchestrator.executeDeletePaths(harness.executeInput({
    paths: ['../private.txt'],
  }));
  assert.strictEqual(invalid.status, 'denied');
  assert.strictEqual(invalid.errorCode, AGENTIC_DELETE_ERROR_CODES.INVALID_REQUEST);
  assert.strictEqual(harness.stats.renames, 0);
});

(async () => {
  for (const { name, callback } of tests) {
    await callback();
    process.stdout.write(`ok - ${name}\n`);
  }
  process.stdout.write(`ok - ${tests.length} agentic delete orchestrator tests passed\n`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
