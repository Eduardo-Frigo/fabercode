'use strict';

const assert = require('assert');

const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceLease,
  createExecutionWorkspaceProbeResult,
} = require('../main/capabilities/execution_workspace_contract');
const {
  EXECUTION_WORKSPACE_REGISTRY_REASONS,
  EXECUTION_WORKSPACE_REGISTRY_VERSION,
  createExecutionWorkspaceRegistry,
} = require('../main/capabilities/execution_workspace_registry');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding(jobId = 'job-a', overrides = {}) {
  return {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/source-a',
    realRootPath: '/private/workspace/source-a',
    sessionId: `session-${jobId}`,
    jobId,
    kernelId: 'legacy',
    submissionDigest: digest('a'),
    ...overrides,
  };
}

function acquireInput(jobId = 'job-a', sourceRootIdentityDigest = digest('b'), overrides = {}) {
  return {
    binding: binding(jobId),
    sourceRootIdentityDigest,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function within(promise, label, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function createBackend(overrides = {}) {
  const state = {
    probes: 0,
    acquires: 0,
    discards: 0,
    disposes: 0,
    events: [],
  };
  const backend = Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: 'mock-execution-workspace',
    probe() {
      state.probes += 1;
      state.events.push('probe');
      return createExecutionWorkspaceProbeResult({
        state: EXECUTION_WORKSPACE_STATES.ENFORCED,
        guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
      });
    },
    acquire(request) {
      state.acquires += 1;
      state.events.push(`acquire:${request.binding.jobId}`);
      return createExecutionWorkspaceLease({
        request,
        workspaceRootPath: `/workspace/faber-jobs/${request.binding.jobId}`,
        workspaceRealRootPath: `/private/workspace/faber-jobs/${request.binding.jobId}`,
        workspaceRootIdentityDigest: digest(request.binding.jobId === 'job-a' ? 'c' : 'd'),
      });
    },
    discard(request) {
      state.discards += 1;
      state.events.push(`discard:${request.jobId}`);
      return createExecutionWorkspaceDiscardReceipt({ request, discarded: true });
    },
    dispose() {
      state.disposes += 1;
      state.events.push('dispose');
    },
    ...overrides,
  });
  return { backend, state };
}

function deterministicLeaseIds() {
  let index = 0;
  return () => `workspace-lease-${++index}`;
}

async function main() {
  const unsupported = createExecutionWorkspaceRegistry({
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.deepStrictEqual(Reflect.ownKeys(unsupported), [
    'version',
    'acquire',
    'rollback',
    'diagnostics',
    'dispose',
  ]);
  assert.strictEqual(unsupported.version, EXECUTION_WORKSPACE_REGISTRY_VERSION);
  assert.strictEqual(Object.isFrozen(unsupported), true);
  const unavailable = await unsupported.acquire(acquireInput());
  assert.deepStrictEqual(unavailable, {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.UNAVAILABLE,
  });

  const basicHarness = createBackend();
  const basic = createExecutionWorkspaceRegistry({
    backend: basicHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
    maxActiveWorkspaces: 4,
  });
  const acquiredA = await basic.acquire(acquireInput('job-a'));
  assert.strictEqual(acquiredA.ok, true);
  assert.strictEqual(acquiredA.lease.leaseId, 'workspace-lease-1');
  const acquiredB = await basic.acquire(acquireInput('job-b', digest('e'), {
    binding: binding('job-b', {
      projectId: 'project-b',
      canonicalRootPath: '/workspace/source-b',
      realRootPath: '/private/workspace/source-b',
    }),
  }));
  assert.strictEqual(acquiredB.ok, true);
  assert.strictEqual(basicHarness.state.probes, 1, 'probe must be cached process-wide');
  assert.strictEqual(basicHarness.state.acquires, 2);
  assert.deepStrictEqual(basic.diagnostics(), {
    version: EXECUTION_WORKSPACE_REGISTRY_VERSION,
    backendState: 'enforced',
    disposed: false,
    allocating: 0,
    active: 2,
    discarding: 0,
    quarantined: 0,
    discarded: 0,
    maxActiveWorkspaces: 4,
  });

  const duplicateA = basic.acquire(acquireInput('job-a'));
  const duplicateA2 = basic.acquire(acquireInput('job-a'));
  assert.strictEqual(duplicateA, duplicateA2, 'same owner request must share one operation promise');
  assert.strictEqual((await duplicateA).lease, acquiredA.lease);
  assert.strictEqual(basicHarness.state.acquires, 2);

  const rollbackA = basic.rollback({ binding: binding('job-a'), leaseId: acquiredA.lease.leaseId });
  const rollbackAAgain = basic.rollback({ binding: binding('job-a'), leaseId: acquiredA.lease.leaseId });
  assert.strictEqual(rollbackA, rollbackAAgain, 'concurrent rollback must share one operation promise');
  assert.deepStrictEqual(await rollbackA, { ok: true, rolledBack: true, idempotent: false });
  assert.deepStrictEqual(
    await basic.rollback({ binding: binding('job-a'), leaseId: acquiredA.lease.leaseId }),
    { ok: true, rolledBack: true, idempotent: true }
  );
  assert.strictEqual(basicHarness.state.discards, 1);
  const reacquiredA = await basic.acquire(acquireInput('job-a'));
  assert.strictEqual(reacquiredA.ok, true);
  assert.strictEqual(reacquiredA.lease.leaseId, 'workspace-lease-3');
  assert.notStrictEqual(reacquiredA.lease, acquiredA.lease);
  assert.strictEqual(basicHarness.state.acquires, 3);
  assert.deepStrictEqual(
    await basic.rollback({ binding: binding('job-a'), leaseId: acquiredA.lease.leaseId }),
    { ok: true, rolledBack: true, idempotent: true }
  );
  assert.strictEqual(
    basicHarness.state.discards,
    1,
    'a late rollback for the discarded lease must not discard the replacement workspace'
  );
  assert.strictEqual((await basic.acquire(acquireInput('job-a'))).lease, reacquiredA.lease);

  const changedJobHarness = createBackend();
  const changedJob = createExecutionWorkspaceRegistry({
    backend: changedJobHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await changedJob.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await changedJob.acquire(acquireInput('job-a', digest('e'))), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.LEASE_MISMATCH,
  });
  assert.strictEqual(changedJobHarness.state.acquires, 1);

  const capacityHarness = createBackend();
  const capacity = createExecutionWorkspaceRegistry({
    backend: capacityHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
    maxActiveWorkspaces: 1,
  });
  const capacityFirst = capacity.acquire(acquireInput());
  assert.deepStrictEqual(await capacity.acquire(acquireInput('job-b', digest('e'), {
    binding: binding('job-b', {
      projectId: 'project-b',
      canonicalRootPath: '/workspace/source-b',
      realRootPath: '/private/workspace/source-b',
    }),
  })), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.CAPACITY_EXCEEDED,
  });
  assert.strictEqual((await capacityFirst).ok, true);
  assert.strictEqual(capacityHarness.state.acquires, 1);

  const sourceOverlapHarness = createBackend();
  const sourceOverlap = createExecutionWorkspaceRegistry({
    backend: sourceOverlapHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await sourceOverlap.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await sourceOverlap.acquire(acquireInput('job-b', digest('e'), {
    binding: binding('job-b', {
      projectId: 'project-b',
      canonicalRootPath: '/workspace/source-a/nested',
      realRootPath: '/private/workspace/source-a/nested',
    }),
  })), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.SOURCE_BUSY,
  });
  assert.strictEqual(sourceOverlapHarness.state.acquires, 1);

  const capturedHarness = createBackend();
  const mutableBackend = { ...capturedHarness.backend };
  const capturedBackend = createExecutionWorkspaceRegistry({
    backend: mutableBackend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  mutableBackend.probe = () => createExecutionWorkspaceProbeResult({
    state: EXECUTION_WORKSPACE_STATES.UNAVAILABLE,
    guarantees: [],
    reasonCode: 'MUTATED_AFTER_CAPTURE',
  });
  mutableBackend.acquire = () => {
    throw new Error('mutated backend method must not run');
  };
  assert.strictEqual((await capturedBackend.acquire(acquireInput())).ok, true);
  assert.strictEqual(capturedHarness.state.probes, 1);
  assert.strictEqual(capturedHarness.state.acquires, 1);

  const allocationGate = deferred();
  const raceHarness = createBackend({
    acquire(request) {
      raceHarness.state.acquires += 1;
      return allocationGate.promise.then(() => createExecutionWorkspaceLease({
        request,
        workspaceRootPath: `/workspace/faber-race/${request.binding.jobId}`,
        workspaceRealRootPath: `/private/workspace/faber-race/${request.binding.jobId}`,
        workspaceRootIdentityDigest: digest('f'),
      }));
    },
  });
  const race = createExecutionWorkspaceRegistry({
    backend: raceHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const pendingA = race.acquire(acquireInput('job-a'));
  const samePendingA = race.acquire(acquireInput('job-a'));
  assert.strictEqual(pendingA, samePendingA);
  const busy = await race.acquire(acquireInput('job-b', digest('b'), {
    binding: binding('job-b'),
  }));
  assert.deepStrictEqual(busy, {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.SOURCE_BUSY,
  });
  assert.strictEqual(raceHarness.state.acquires, 1);
  allocationGate.resolve();
  assert.strictEqual((await pendingA).ok, true);

  let reentrantRegistry;
  let nestedPromise;
  const reentrantHarness = createBackend({
    acquire(request) {
      reentrantHarness.state.acquires += 1;
      nestedPromise = reentrantRegistry.acquire(acquireInput(request.binding.jobId));
      return createExecutionWorkspaceLease({
        request,
        workspaceRootPath: '/workspace/faber-reentrant/job-a',
        workspaceRealRootPath: '/private/workspace/faber-reentrant/job-a',
        workspaceRootIdentityDigest: digest('7'),
      });
    },
  });
  reentrantRegistry = createExecutionWorkspaceRegistry({
    backend: reentrantHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const outerPromise = reentrantRegistry.acquire(acquireInput('job-a'));
  assert.strictEqual((await outerPromise).ok, true);
  assert.notStrictEqual(nestedPromise, outerPromise);
  assert.deepStrictEqual(await nestedPromise, {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.REENTRANT_CALL,
  });
  assert.strictEqual(reentrantHarness.state.acquires, 1);

  let probeReentrantRegistry;
  let nestedProbeAcquire;
  const probeReentrantHarness = createBackend({
    probe() {
      probeReentrantHarness.state.probes += 1;
      probeReentrantHarness.state.events.push('probe');
      if (probeReentrantHarness.state.probes === 1) {
        nestedProbeAcquire = probeReentrantRegistry.acquire(acquireInput(
          'job-b',
          digest('e'),
          {
            binding: binding('job-b', {
              projectId: 'project-b',
              canonicalRootPath: '/workspace/source-b',
              realRootPath: '/private/workspace/source-b',
            }),
          }
        ));
      }
      return createExecutionWorkspaceProbeResult({
        state: EXECUTION_WORKSPACE_STATES.ENFORCED,
        guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
      });
    },
  });
  probeReentrantRegistry = createExecutionWorkspaceRegistry({
    backend: probeReentrantHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await probeReentrantRegistry.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await nestedProbeAcquire, {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.REENTRANT_CALL,
  });
  assert.strictEqual(probeReentrantHarness.state.probes, 1);
  assert.strictEqual(probeReentrantHarness.state.acquires, 1);

  let acquireDisposeRegistry;
  let nestedAcquireDispose;
  const acquireDisposeHarness = createBackend({
    acquire(request) {
      acquireDisposeHarness.state.acquires += 1;
      nestedAcquireDispose = acquireDisposeRegistry.dispose();
      return createExecutionWorkspaceLease({
        request,
        workspaceRootPath: '/workspace/faber-acquire-dispose/job-a',
        workspaceRealRootPath: '/private/workspace/faber-acquire-dispose/job-a',
        workspaceRootIdentityDigest: digest('4'),
      });
    },
  });
  acquireDisposeRegistry = createExecutionWorkspaceRegistry({
    backend: acquireDisposeHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await acquireDisposeRegistry.acquire(acquireInput())).ok, true);
  assert.deepStrictEqual(await nestedAcquireDispose, {
    ok: false,
    disposed: false,
    quarantined: 0,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.REENTRANT_CALL,
  });
  assert.strictEqual(acquireDisposeRegistry.diagnostics().disposed, false);
  assert.deepStrictEqual(await acquireDisposeRegistry.dispose(), {
    ok: true,
    disposed: true,
    quarantined: 0,
  });

  let discardReentrantRegistry;
  let nestedDiscardRollback;
  const discardReentrantHarness = createBackend({
    discard(request) {
      discardReentrantHarness.state.discards += 1;
      nestedDiscardRollback = discardReentrantRegistry.rollback({
        binding: binding(request.jobId),
        leaseId: request.leaseId,
      });
      return createExecutionWorkspaceDiscardReceipt({ request, discarded: true });
    },
  });
  discardReentrantRegistry = createExecutionWorkspaceRegistry({
    backend: discardReentrantHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const discardReentrantLease = (await discardReentrantRegistry.acquire(acquireInput())).lease;
  const outerDiscardRollback = discardReentrantRegistry.rollback({
    binding: binding(),
    leaseId: discardReentrantLease.leaseId,
  });
  assert.deepStrictEqual(await outerDiscardRollback, {
    ok: true,
    rolledBack: true,
    idempotent: false,
  });
  assert.notStrictEqual(nestedDiscardRollback, outerDiscardRollback);
  assert.deepStrictEqual(await nestedDiscardRollback, {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.REENTRANT_CALL,
  });

  let disposeReentrantRegistry;
  let nestedBackendDispose;
  const disposeReentrantHarness = createBackend({
    dispose() {
      disposeReentrantHarness.state.disposes += 1;
      nestedBackendDispose = disposeReentrantRegistry.dispose();
      return nestedBackendDispose;
    },
  });
  disposeReentrantRegistry = createExecutionWorkspaceRegistry({
    backend: disposeReentrantHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const outerBackendDispose = disposeReentrantRegistry.dispose();
  assert.deepStrictEqual(await within(outerBackendDispose, 'reentrant backend dispose'), {
    ok: true,
    disposed: true,
    quarantined: 0,
  });
  assert.notStrictEqual(nestedBackendDispose, outerBackendDispose);
  assert.deepStrictEqual(await nestedBackendDispose, {
    ok: false,
    disposed: true,
    quarantined: 0,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.REENTRANT_CALL,
  });
  assert.strictEqual(disposeReentrantHarness.state.disposes, 1);

  const invalidHarness = createBackend({
    acquire(request) {
      invalidHarness.state.acquires += 1;
      return {
        version: 'execution-workspace-lease.v1',
        leaseId: request.leaseId,
        jobId: request.binding.jobId,
        sourceRootIdentityDigest: request.sourceRootIdentityDigest,
        workspaceAuthorityDigest: request.workspaceAuthorityDigest,
        workspaceRootIdentityDigest: request.sourceRootIdentityDigest,
        workspaceRootPath: `${request.binding.canonicalRootPath}/nested`,
        workspaceRealRootPath: `${request.binding.realRootPath}/nested`,
      };
    },
  });
  const invalid = createExecutionWorkspaceRegistry({
    backend: invalidHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.deepStrictEqual(await invalid.acquire(acquireInput()), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED,
  });
  assert.strictEqual(invalid.diagnostics().quarantined, 1);
  assert.deepStrictEqual(await invalid.acquire(acquireInput('job-b')), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.SOURCE_BUSY,
  });

  const collisionHarness = createBackend({
    acquire(request) {
      collisionHarness.state.acquires += 1;
      return createExecutionWorkspaceLease({
        request,
        workspaceRootPath: '/workspace/faber-shared/run',
        workspaceRealRootPath: '/private/workspace/faber-shared/run',
        workspaceRootIdentityDigest: digest('6'),
      });
    },
  });
  const collision = createExecutionWorkspaceRegistry({
    backend: collisionHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await collision.acquire(acquireInput('job-a'))).ok, true);
  assert.deepStrictEqual(await collision.acquire(acquireInput('job-b', digest('e'), {
    binding: binding('job-b', {
      projectId: 'project-b',
      canonicalRootPath: '/workspace/source-b',
      realRootPath: '/private/workspace/source-b',
    }),
  })), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED,
  });
  assert.strictEqual(collisionHarness.state.acquires, 2);
  assert.strictEqual(collisionHarness.state.discards, 0);
  assert.deepStrictEqual(collision.diagnostics(), {
    version: EXECUTION_WORKSPACE_REGISTRY_VERSION,
    backendState: 'enforced',
    disposed: false,
    allocating: 0,
    active: 1,
    discarding: 0,
    quarantined: 1,
    discarded: 0,
    maxActiveWorkspaces: 64,
  });
  assert.deepStrictEqual(await collision.acquire(acquireInput('job-c', digest('6'), {
    binding: binding('job-c', {
      projectId: 'project-c',
      canonicalRootPath: '/workspace/source-c',
      realRootPath: '/private/workspace/source-c',
    }),
  })), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.SOURCE_BUSY,
  });
  assert.deepStrictEqual(await collision.acquire(acquireInput('job-d', digest('9'), {
    binding: binding('job-d', {
      projectId: 'project-d',
      canonicalRootPath: '/workspace/faber-shared/run/nested',
      realRootPath: '/private/workspace/faber-shared/run/nested',
    }),
  })), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.SOURCE_BUSY,
  });
  assert.strictEqual(collisionHarness.state.acquires, 2);

  const rejectedHarness = createBackend({
    acquire() {
      rejectedHarness.state.acquires += 1;
      return Promise.reject(new Error('/private/workspace/secret'));
    },
  });
  const rejected = createExecutionWorkspaceRegistry({
    backend: rejectedHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.deepStrictEqual(await rejected.acquire(acquireInput()), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED,
  });
  assert.strictEqual(rejected.diagnostics().quarantined, 1);
  assert.strictEqual(JSON.stringify(rejected.diagnostics()).includes('/private/'), false);

  const discardFailureHarness = createBackend({
    discard() {
      discardFailureHarness.state.discards += 1;
      throw Promise.reject(new Error('discard rejected'));
    },
  });
  const discardFailure = createExecutionWorkspaceRegistry({
    backend: discardFailureHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const acquiredForFailure = await discardFailure.acquire(acquireInput());
  assert.strictEqual(acquiredForFailure.ok, true);
  assert.deepStrictEqual(await discardFailure.rollback({
    binding: binding(),
    leaseId: acquiredForFailure.lease.leaseId,
  }), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.ROLLBACK_FAILED,
  });
  assert.strictEqual(discardFailure.diagnostics().quarantined, 1);
  assert.deepStrictEqual(await discardFailure.acquire(acquireInput()), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.BACKEND_REJECTED,
  });
  await new Promise((resolve) => setImmediate(resolve));

  const mismatchHarness = createBackend();
  const mismatch = createExecutionWorkspaceRegistry({
    backend: mismatchHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const mismatchLease = (await mismatch.acquire(acquireInput())).lease;
  assert.deepStrictEqual(await mismatch.rollback({
    binding: binding('job-forged'),
    leaseId: mismatchLease.leaseId,
  }), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.LEASE_MISMATCH,
  });
  assert.strictEqual(mismatchHarness.state.discards, 0);

  const hostileRollbackOne = Promise.reject(new Error('hostile rollback one'));
  const hostileRollbackTwo = Promise.reject(new Error('hostile rollback two'));
  assert.deepStrictEqual(await mismatch.rollback({
    binding: binding(),
    leaseId: hostileRollbackOne,
    sibling: { nested: hostileRollbackTwo },
  }), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.INVALID_REQUEST,
  });
  await new Promise((resolve) => setImmediate(resolve));

  const shutdownAcquireGate = deferred();
  let shutdownRequest;
  const shutdownHarness = createBackend({
    acquire(request) {
      shutdownHarness.state.acquires += 1;
      shutdownHarness.state.events.push(`acquire:${request.binding.jobId}`);
      shutdownRequest = request;
      return shutdownAcquireGate.promise;
    },
  });
  const shutdownRace = createExecutionWorkspaceRegistry({
    backend: shutdownHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const pendingDuringShutdown = shutdownRace.acquire(acquireInput());
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(shutdownHarness.state.acquires, 1);
  const disposingDuringAcquire = shutdownRace.dispose();
  shutdownAcquireGate.resolve(createExecutionWorkspaceLease({
    request: shutdownRequest,
    workspaceRootPath: '/workspace/faber-shutdown/job-a',
    workspaceRealRootPath: '/private/workspace/faber-shutdown/job-a',
    workspaceRootIdentityDigest: digest('5'),
  }));
  assert.deepStrictEqual(await pendingDuringShutdown, {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.DISPOSED,
  });
  assert.deepStrictEqual(await disposingDuringAcquire, {
    ok: true,
    disposed: true,
    quarantined: 0,
  });
  assert.deepStrictEqual(shutdownHarness.state.events.slice(-3), [
    'acquire:job-a',
    'discard:job-a',
    'dispose',
  ]);
  assert.strictEqual(shutdownHarness.state.discards, 1);

  const shutdownProbeGate = deferred();
  const shutdownProbeHarness = createBackend({
    probe() {
      shutdownProbeHarness.state.probes += 1;
      shutdownProbeHarness.state.events.push('probe');
      return shutdownProbeGate.promise;
    },
  });
  const shutdownDuringProbe = createExecutionWorkspaceRegistry({
    backend: shutdownProbeHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  const pendingDuringProbe = shutdownDuringProbe.acquire(acquireInput());
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(shutdownProbeHarness.state.probes, 1);
  assert.strictEqual(shutdownProbeHarness.state.acquires, 0);
  const disposingDuringProbe = shutdownDuringProbe.dispose();
  shutdownProbeGate.resolve(createExecutionWorkspaceProbeResult({
    state: EXECUTION_WORKSPACE_STATES.ENFORCED,
    guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  }));
  assert.deepStrictEqual(await pendingDuringProbe, {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.DISPOSED,
  });
  assert.deepStrictEqual(await within(disposingDuringProbe, 'dispose during probe'), {
    ok: true,
    disposed: true,
    quarantined: 0,
  });
  assert.strictEqual(shutdownProbeHarness.state.acquires, 0);
  assert.strictEqual(shutdownProbeHarness.state.discards, 0);
  assert.strictEqual(shutdownProbeHarness.state.disposes, 1);
  assert.deepStrictEqual(shutdownProbeHarness.state.events, ['probe', 'dispose']);

  const disposeHarness = createBackend();
  const disposable = createExecutionWorkspaceRegistry({
    backend: disposeHarness.backend,
    leaseIdFactory: deterministicLeaseIds(),
  });
  assert.strictEqual((await disposable.acquire(acquireInput())).ok, true);
  const disposed = await disposable.dispose();
  assert.deepStrictEqual(disposed, { ok: true, disposed: true, quarantined: 0 });
  assert.deepStrictEqual(await disposable.dispose(), disposed);
  assert.deepStrictEqual(await disposable.acquire(acquireInput('job-after-dispose', digest('9'))), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.DISPOSED,
  });
  assert.deepStrictEqual(disposeHarness.state.events.slice(-2), ['discard:job-a', 'dispose']);
  assert.strictEqual(disposeHarness.state.disposes, 1);

  const hostileOne = Promise.reject(new Error('hostile one'));
  const hostileTwo = Promise.reject(new Error('hostile two'));
  const hostileResult = await basic.acquire({
    binding: binding('hostile'),
    sourceRootIdentityDigest: hostileOne,
    sibling: { nested: hostileTwo },
  });
  assert.deepStrictEqual(hostileResult, {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.INVALID_REQUEST,
  });
  let getterCalls = 0;
  const accessorInput = { binding: binding('accessor') };
  Object.defineProperty(accessorInput, 'sourceRootIdentityDigest', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return digest('8');
    },
  });
  assert.deepStrictEqual(await basic.acquire(accessorInput), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.INVALID_REQUEST,
  });
  assert.strictEqual(getterCalls, 0);
  assert.deepStrictEqual(await basic.acquire(new Proxy(acquireInput('proxy'), {})), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.INVALID_REQUEST,
  });
  assert.deepStrictEqual(await basic.acquire({
    ...acquireInput('symbol'),
    [Symbol('secret')]: true,
  }), {
    ok: false,
    code: EXECUTION_WORKSPACE_REGISTRY_REASONS.INVALID_REQUEST,
  });
  await new Promise((resolve) => setImmediate(resolve));

  console.log('execution workspace registry tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
