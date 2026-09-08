'use strict';

const assert = require('assert');

const {
  createAssistantRuntimeWindowLeaseGate,
} = require('../main/services/assistant_runtime_window_lease_gate');
const {
  createAssistantRuntimeLifecycleClearService,
} = require('../main/services/assistant_runtime_lifecycle_clear_service');

function token() {
  return Object.freeze(Object.create(null));
}

function completed(idempotent = false) {
  return Object.freeze({
    ok: true,
    status: 'completed',
    code: null,
    deferred: false,
    idempotent,
  });
}

function deferred() {
  return Object.freeze({
    ok: true,
    status: 'deferred',
    code: 'execution_draining',
    deferred: true,
    idempotent: false,
  });
}

function healthyDiagnostics(overrides = {}) {
  return Object.freeze({
    active: false,
    failedJobs: 0,
    unresolvedCleanupFailures: 0,
    completedSessions: 1,
    ...overrides,
  });
}

function assertFrozenResult(result) {
  assert.strictEqual(Object.isFrozen(result), true);
  return result;
}

function completedLifecycle() {
  const successfulOperation = () => Object.freeze({ ok: true });
  const service = createAssistantRuntimeLifecycleClearService({
    invalidateWindow: successfulOperation,
    clearPeripheralAuthority: successfulOperation,
    clearCoordinator: successfulOperation,
    clearDeleteRuntime: successfulOperation,
    markCancellationRequested: successfulOperation,
    markCancelledAfterCleanup: successfulOperation,
    markExecutionCleanupFailed: successfulOperation,
    scheduleContinuation() {},
  });
  return Object.freeze({
    result: service.clear('window_reloaded'),
    diagnostics: service.diagnostics(),
  });
}

const gate = createAssistantRuntimeWindowLeaseGate();
assert.strictEqual(Object.isFrozen(gate), true);
assert.deepStrictEqual(Reflect.ownKeys(gate), [
  'beginClear',
  'didFinish',
  'concludeClear',
  'issueLease',
  'consumeLease',
  'diagnostics',
]);
assert.deepStrictEqual(gate.diagnostics(), {
  state: 'idle',
  hasEpoch: false,
  hasWindow: false,
  hasCandidate: false,
  hasLease: false,
});

// Contract integration: consume the lifecycle service's real five-field
// public result instead of accepting a test-only approximation.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const candidateToken = token();
  const { epochToken } = subject.beginClear(windowToken);
  subject.didFinish(epochToken, windowToken, candidateToken);
  const lifecycle = completedLifecycle();
  assert.deepStrictEqual(lifecycle.result, {
    ok: true,
    status: 'completed',
    code: null,
    deferred: false,
    idempotent: false,
  });
  const conclusion = subject.concludeClear(
    epochToken,
    lifecycle.result,
    lifecycle.diagnostics
  );
  assert.strictEqual(conclusion.ok, true);
  assert.strictEqual(conclusion.status, 'ready');
}

// A current epoch only becomes ready after the one exact successful result and
// healthy cleanup diagnostics. The lease remains an opaque identity token.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const candidateToken = token();
  const begun = assertFrozenResult(subject.beginClear(windowToken));
  assert.strictEqual(begun.ok, true);
  assert.strictEqual(begun.status, 'clearing');
  assert.strictEqual(typeof begun.epochToken, 'object');
  assert.strictEqual(Object.isFrozen(begun.epochToken), true);

  const finished = assertFrozenResult(subject.didFinish(
    begun.epochToken,
    windowToken,
    candidateToken
  ));
  assert.strictEqual(finished.ok, true);
  assert.strictEqual(finished.status, 'clearing');
  assert.strictEqual(finished.idempotent, false);

  const concluded = assertFrozenResult(subject.concludeClear(
    begun.epochToken,
    completed(false),
    healthyDiagnostics()
  ));
  assert.strictEqual(concluded.ok, true);
  assert.strictEqual(concluded.status, 'ready');
  assert.strictEqual(concluded.idempotent, false);

  const issued = assertFrozenResult(subject.issueLease(
    begun.epochToken,
    windowToken,
    candidateToken
  ));
  assert.strictEqual(issued.ok, true);
  assert.strictEqual(issued.status, 'ready');
  assert.strictEqual(typeof issued.leaseToken, 'object');
  assert.strictEqual(Object.isFrozen(issued.leaseToken), true);

  const reissued = subject.issueLease(
    begun.epochToken,
    windowToken,
    candidateToken
  );
  assert.strictEqual(reissued.idempotent, true);
  assert.strictEqual(reissued.leaseToken, issued.leaseToken);

  const consumed = assertFrozenResult(subject.consumeLease(
    begun.epochToken,
    windowToken,
    candidateToken
  ));
  assert.strictEqual(consumed.ok, true);
  assert.strictEqual(consumed.leaseToken, issued.leaseToken);
  assert.strictEqual(subject.consumeLease(
    begun.epochToken,
    windowToken,
    candidateToken
  ).leaseToken, issued.leaseToken);
}

// Completion can precede did-finish-load, but it cannot emit a lease until the
// exact candidate for that same epoch and window arrives.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const candidateToken = token();
  const { epochToken } = subject.beginClear(windowToken);
  assert.strictEqual(
    subject.concludeClear(epochToken, completed(), healthyDiagnostics()).status,
    'ready'
  );
  assert.strictEqual(
    subject.issueLease(epochToken, windowToken, candidateToken).ok,
    false
  );
  assert.strictEqual(
    subject.consumeLease(epochToken, windowToken, candidateToken).leaseToken,
    null
  );
  assert.strictEqual(
    subject.didFinish(epochToken, windowToken, candidateToken).status,
    'ready'
  );
  assert.strictEqual(
    subject.issueLease(epochToken, windowToken, candidateToken).ok,
    true
  );
}

// One epoch can bind exactly one document candidate. A second did-finish-load
// candidate must fail the epoch and revoke an already-issued lease rather than
// silently transferring authority without a fresh lifecycle clear.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const candidateA = token();
  const candidateB = token();
  const { epochToken } = subject.beginClear(windowToken);
  subject.didFinish(epochToken, windowToken, candidateA);
  subject.concludeClear(epochToken, completed(), healthyDiagnostics());
  assert.strictEqual(
    subject.issueLease(epochToken, windowToken, candidateA).ok,
    true
  );

  const conflict = subject.didFinish(epochToken, windowToken, candidateB);
  assert.strictEqual(conflict.ok, false);
  assert.strictEqual(conflict.status, 'failed');
  assert.strictEqual(conflict.code, 'document_candidate_conflict');
  assert.strictEqual(
    subject.consumeLease(epochToken, windowToken, candidateA).leaseToken,
    null
  );
  assert.strictEqual(
    subject.issueLease(epochToken, windowToken, candidateB).ok,
    false
  );
}

// Deferred and idempotent continuations are no-ops; neither can make a lease
// available. Only the fresh non-idempotent completion advances the epoch.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const candidateToken = token();
  const { epochToken } = subject.beginClear(windowToken);
  subject.didFinish(epochToken, windowToken, candidateToken);

  const waiting = subject.concludeClear(epochToken, deferred(), null);
  assert.strictEqual(waiting.ok, true);
  assert.strictEqual(waiting.status, 'clearing');
  assert.strictEqual(subject.issueLease(epochToken, windowToken, candidateToken).ok, false);

  const replay = subject.concludeClear(
    epochToken,
    completed(true),
    healthyDiagnostics()
  );
  assert.strictEqual(replay.ok, true);
  assert.strictEqual(replay.status, 'clearing');
  assert.strictEqual(replay.idempotent, true);

  assert.strictEqual(subject.concludeClear(
    epochToken,
    completed(false),
    healthyDiagnostics()
  ).status, 'ready');
}

// Cleanup failures are latched: a later completed result cannot cure a job
// whose cleanup has not been recovered.
for (const diagnostics of [
  healthyDiagnostics({ failedJobs: 1 }),
  healthyDiagnostics({ unresolvedCleanupFailures: 1 }),
]) {
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const candidateToken = token();
  const { epochToken } = subject.beginClear(windowToken);
  subject.didFinish(epochToken, windowToken, candidateToken);
  const failed = subject.concludeClear(epochToken, completed(), diagnostics);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.code, 'lifecycle_cleanup_unresolved');
  const attemptedCure = subject.concludeClear(
    epochToken,
    completed(),
    healthyDiagnostics()
  );
  assert.strictEqual(attemptedCure.ok, true);
  assert.strictEqual(attemptedCure.status, 'failed');
  assert.strictEqual(attemptedCure.idempotent, true);
  assert.strictEqual(subject.issueLease(epochToken, windowToken, candidateToken).ok, false);
}

// Explicit lifecycle failure is also terminal for the epoch.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const candidateToken = token();
  const { epochToken } = subject.beginClear(windowToken);
  subject.didFinish(epochToken, windowToken, candidateToken);
  const failed = subject.concludeClear(epochToken, Object.freeze({
    ok: false,
    status: 'failed',
    idempotent: false,
  }), healthyDiagnostics());
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(subject.issueLease(epochToken, windowToken, candidateToken).ok, false);
}

// Regression: a stale successful continuation from A must not reopen B after
// B failed. New clears also invalidate A's candidate and already-issued lease.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowA = token();
  const candidateA = token();
  const epochA = subject.beginClear(windowA).epochToken;
  subject.didFinish(epochA, windowA, candidateA);
  subject.concludeClear(epochA, completed(), healthyDiagnostics());
  const leaseA = subject.issueLease(epochA, windowA, candidateA).leaseToken;
  assert.ok(leaseA);

  const windowB = token();
  const candidateB = token();
  const epochB = subject.beginClear(windowB).epochToken;
  subject.didFinish(epochB, windowB, candidateB);
  subject.concludeClear(epochB, Object.freeze({
    ok: false,
    status: 'failed',
    idempotent: false,
  }), healthyDiagnostics());

  const staleA = subject.concludeClear(epochA, completed(), healthyDiagnostics());
  assert.strictEqual(staleA.ok, true);
  assert.strictEqual(staleA.status, 'failed');
  assert.strictEqual(staleA.idempotent, true);
  assert.strictEqual(subject.issueLease(epochA, windowA, candidateA).ok, false);
  assert.strictEqual(subject.consumeLease(epochA, windowA, candidateA).leaseToken, null);
  assert.strictEqual(subject.issueLease(epochB, windowB, candidateB).ok, false);
  assert.strictEqual(subject.diagnostics().state, 'failed');
}

// Invalid primitive epochs are malformed input, not stale continuations.
// A genuine stale opaque epoch remains an idempotent no-op.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  const currentEpoch = subject.beginClear(token()).epochToken;
  const invalid = subject.concludeClear(
    'not-an-epoch',
    completed(),
    healthyDiagnostics()
  );
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.code, 'lifecycle_epoch_invalid');
  const stale = subject.concludeClear(token(), completed(), healthyDiagnostics());
  assert.strictEqual(stale.ok, true);
  assert.strictEqual(stale.idempotent, true);
  assert.notStrictEqual(currentEpoch, null);
}

// A wrong epoch/window/candidate identity is never accepted. Same-looking
// primitives are rejected because capability tokens must be opaque identities.
{
  const subject = createAssistantRuntimeWindowLeaseGate();
  assert.strictEqual(subject.beginClear('window').ok, false);
  assert.strictEqual(subject.diagnostics().state, 'failed');

  const windowToken = token();
  const candidateToken = token();
  const { epochToken } = subject.beginClear(windowToken);
  assert.strictEqual(subject.didFinish(token(), windowToken, candidateToken).ok, false);
  assert.strictEqual(subject.didFinish(epochToken, token(), candidateToken).ok, false);
  assert.strictEqual(subject.didFinish(epochToken, windowToken, 'candidate').ok, false);
  assert.strictEqual(subject.didFinish(epochToken, windowToken, candidateToken).ok, true);
  subject.concludeClear(epochToken, completed(), healthyDiagnostics());
  assert.strictEqual(subject.issueLease(epochToken, windowToken, token()).ok, false);
  assert.strictEqual(subject.consumeLease(epochToken, windowToken, token()).leaseToken, null);
}

// The completed tuple is exact and diagnostics are data-only, finite counters.
// Malformed/getter/proxy inputs fail closed synchronously and never return a promise.
{
  const malformedResults = [
    Object.freeze({
      ok: true,
      status: 'completed',
      code: null,
      deferred: false,
      idempotent: false,
      extra: true,
    }),
    Object.freeze({ ok: true, status: 'completed' }),
    Object.freeze({ ok: true, status: 'completed', idempotent: false }),
    { ok: true, status: 'completed', code: null, deferred: false, idempotent: false },
    Object.freeze({ idempotent: true }),
    Object.freeze({
      ok: false,
      status: 'failed',
      code: 'cleanup_failed',
      deferred: false,
      idempotent: true,
    }),
    Promise.resolve(completed()),
    new Proxy(completed(), {}),
  ];
  for (const malformed of malformedResults) {
    const subject = createAssistantRuntimeWindowLeaseGate();
    const windowToken = token();
    const candidateToken = token();
    const { epochToken } = subject.beginClear(windowToken);
    subject.didFinish(epochToken, windowToken, candidateToken);
    const result = subject.concludeClear(epochToken, malformed, healthyDiagnostics());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 'failed');
  }

  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const { epochToken } = subject.beginClear(windowToken);
  const diagnosticsWithGetter = {};
  Object.defineProperty(diagnosticsWithGetter, 'failedJobs', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  Object.defineProperty(diagnosticsWithGetter, 'unresolvedCleanupFailures', {
    enumerable: true,
    value: 0,
  });
  const result = subject.concludeClear(
    epochToken,
    completed(),
    diagnosticsWithGetter
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 'failed');
  assert.strictEqual(typeof result.then, 'undefined');
}

// Diagnostics must be a frozen, inactive lifecycle snapshot. A completed
// result paired with an active or mutable snapshot cannot open authority.
for (const diagnostics of [
  healthyDiagnostics({ active: true }),
  {
    active: false,
    failedJobs: 0,
    unresolvedCleanupFailures: 0,
  },
]) {
  const subject = createAssistantRuntimeWindowLeaseGate();
  const windowToken = token();
  const candidateToken = token();
  const { epochToken } = subject.beginClear(windowToken);
  subject.didFinish(epochToken, windowToken, candidateToken);
  const result = subject.concludeClear(epochToken, completed(), diagnostics);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 'failed');
  assert.strictEqual(result.code, 'lifecycle_diagnostics_invalid');
  assert.strictEqual(subject.issueLease(
    epochToken,
    windowToken,
    candidateToken
  ).ok, false);
}

console.log('assistant runtime window lease gate tests passed');
