'use strict';

const assert = require('assert');

const {
  AGENTIC_VISUAL_CAPTURE_APPROVAL_SERVICE_VERSION,
  DEFAULT_VISUAL_CAPTURE_APPROVAL_TTL_MS,
  FIXED_VISUAL_CAPTURE_APPROVAL_DIALOG,
  VISUAL_CAPTURE_APPROVAL_REASONS,
  createAgenticVisualCaptureApprovalService,
} = require('../main/services/agentic_visual_capture_approval_service');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding(overrides = {}) {
  return Object.freeze({
    projectId: 'project-capture',
    canonicalRootPath: '/workspace/project-capture',
    realRootPath: '/real/workspace/project-capture',
    sessionId: 'project-session-capture',
    jobId: 'job-capture',
    kernelId: 'kernel-capture',
    submissionDigest: digest('a'),
    ...overrides,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was not reached');
}

function createHarness({
  dialog,
  approvalTtlMs,
  recordFails = false,
  recordFailType = '',
  recordHook = null,
} = {}) {
  let now = 1_000;
  let active = true;
  let frontier = true;
  let lease = Object.freeze({ window: 'main' });
  let dialogCalls = 0;
  const dialogPayloads = [];
  const events = [];
  const controller = new AbortController();
  let service = null;
  service = createAgenticVisualCaptureApprovalService({
    showNativeDialog(payload, context) {
      dialogCalls += 1;
      dialogPayloads.push({ payload, context });
      return dialog ? dialog(payload, context) : { response: 1 };
    },
    authorizeLifecycle(candidate) {
      return active
        ? Object.freeze({ authorized: true, binding: candidate })
        : Object.freeze({ authorized: false });
    },
    authorizeRoot(candidate) {
      return active
        ? Object.freeze({
          ok: true,
          authorized: true,
          projectId: candidate.projectId,
          rootPath: candidate.rootPath,
          canonicalRootPath: candidate.rootPath,
          realRootPath: binding().realRootPath,
        })
        : Object.freeze({ authorized: false });
    },
    authorizeCaptureFrontier(candidate) {
      return active && frontier && candidate.windowLease === lease
        ? Object.freeze({
          authorized: true,
          binding: candidate.binding,
          windowLease: candidate.windowLease,
          browserSessionId: candidate.browserSessionId,
          browserSessionSnapshotDigest: candidate.browserSessionSnapshotDigest,
          callId: candidate.callId,
          invocationId: candidate.invocationId,
          requestDigest: candidate.requestDigest,
        })
        : Object.freeze({ authorized: false });
    },
    getWindowLease() { return lease; },
    getSignal() { return controller.signal; },
    recordJobEvent(jobId, type, payload) {
      events.push({ jobId, type, payload });
      if (recordHook) {
        recordHook({
          service,
          jobId,
          type,
          payload,
          setNow(value) { now = value; },
        });
      }
      return recordFails || type === recordFailType ? { ok: false } : { ok: true };
    },
    now: () => now,
    ...(approvalTtlMs === undefined ? {} : { approvalTtlMs }),
  });
  return {
    service,
    events,
    dialogPayloads,
    dialogCalls: () => dialogCalls,
    lease: () => lease,
    setLease(value) { lease = value; },
    setActive(value) { active = value; },
    setFrontier(value) { frontier = value; },
    setNow(value) { now = value; },
    abort() { controller.abort(); },
  };
}

function approvalInput(overrides = {}) {
  return Object.freeze({
    binding: binding(),
    browserSessionId: 'browser-session-capture',
    browserSessionSnapshotDigest: digest('d'),
    callId: 'call-capture-1',
    invocationId: 'capture-invocation-1',
    requestDigest: digest('b'),
    projectLabel: 'Projeto Capture',
    ...overrides,
  });
}

function consumeInput(input, receipt, overrides = {}) {
  return Object.freeze({ ...input, receipt, ...overrides });
}

function assertSanitizedEvents(events) {
  const serialized = JSON.stringify(events);
  for (const forbidden of [
    'sha256:',
    '/workspace',
    '/real/',
    'browser-session-capture',
    'call-capture-1',
    'capture-invocation-1',
  ]) {
    assert.strictEqual(serialized.includes(forbidden), false, `event leaked ${forbidden}`);
  }
  for (const event of events) {
    assert(Object.isFrozen(event.payload));
    assert.deepStrictEqual(Object.keys(event.payload).sort(), [
      'approvalScope',
      'reason',
    ]);
  }
}

(async () => {
  assert.strictEqual(
    AGENTIC_VISUAL_CAPTURE_APPROVAL_SERVICE_VERSION,
    'agentic-visual-capture-approval-service.v1'
  );
  assert.strictEqual(DEFAULT_VISUAL_CAPTURE_APPROVAL_TTL_MS, 60_000);
  assert.strictEqual(FIXED_VISUAL_CAPTURE_APPROVAL_DIALOG.defaultId, 0);
  assert.strictEqual(FIXED_VISUAL_CAPTURE_APPROVAL_DIALOG.cancelId, 0);
  assert.deepStrictEqual(
    FIXED_VISUAL_CAPTURE_APPROVAL_DIALOG.buttons,
    ['Cancelar', 'Capturar uma vez']
  );

  assert.throws(
    () => createAgenticVisualCaptureApprovalService(),
    /plain data record/
  );

  const allowed = createHarness();
  const allowedInput = approvalInput();
  const approval = await allowed.service.requestApproval(allowedInput);
  assert.strictEqual(approval.ok, true);
  assert.strictEqual(approval.approved, true);
  assert.strictEqual(approval.reason, VISUAL_CAPTURE_APPROVAL_REASONS.APPROVED);
  assert.deepStrictEqual(Object.keys(approval.receipt), []);
  assert(Object.isFrozen(approval.receipt));
  assert.strictEqual(allowed.dialogCalls(), 1);
  assert(Object.isFrozen(allowed.dialogPayloads[0].payload));
  assert(Object.isFrozen(allowed.dialogPayloads[0].context));
  assert(allowed.dialogPayloads[0].context.signal instanceof AbortSignal);
  assert.match(allowed.dialogPayloads[0].payload.detail, /Projeto Capture/);
  assert.match(allowed.dialogPayloads[0].payload.detail, /uma vez/i);
  assert.doesNotMatch(allowed.dialogPayloads[0].payload.detail, /sha256:|\/workspace|\/real\//);
  assert.deepStrictEqual(allowed.events.map((event) => event.type), [
    'job.agentic_visual_capture_approval_requested',
  ]);

  const consumed = allowed.service.consumeApproval(
    consumeInput(allowedInput, approval.receipt)
  );
  assert.deepStrictEqual(consumed, {
    ok: true,
    authorized: true,
    reason: VISUAL_CAPTURE_APPROVAL_REASONS.CONSUMED,
  });
  assert.deepStrictEqual(allowed.events.map((event) => event.type), [
    'job.agentic_visual_capture_approval_requested',
    'job.agentic_visual_capture_approval_approved',
  ]);
  assert.deepStrictEqual(
    allowed.service.consumeApproval(consumeInput(allowedInput, approval.receipt)),
    {
      ok: false,
      authorized: false,
      reason: VISUAL_CAPTURE_APPROVAL_REASONS.REPLAYED,
    }
  );
  assert.strictEqual(allowed.events.at(-1).type, 'job.agentic_visual_capture_approval_denied');
  assert.strictEqual(allowed.events.at(-1).payload.reason, 'replayed');
  assertSanitizedEvents(allowed.events);

  const denied = createHarness({ dialog: () => ({ response: 0 }) });
  const deniedResult = await denied.service.requestApproval(approvalInput());
  assert.deepStrictEqual(deniedResult, {
    ok: true,
    approved: false,
    reason: VISUAL_CAPTURE_APPROVAL_REASONS.DENIED,
  });
  assert.deepStrictEqual(denied.events.map((event) => event.type), [
    'job.agentic_visual_capture_approval_requested',
    'job.agentic_visual_capture_approval_denied',
  ]);

  const concurrentGate = deferred();
  const concurrent = createHarness({ dialog: () => concurrentGate.promise });
  const concurrentInput = approvalInput();
  const firstPending = concurrent.service.requestApproval(concurrentInput);
  const duplicatePending = concurrent.service.requestApproval(concurrentInput);
  assert.strictEqual(firstPending, duplicatePending);
  await until(() => concurrent.dialogCalls() === 1);
  assert.deepStrictEqual(concurrent.events.map((event) => event.type), [
    'job.agentic_visual_capture_approval_requested',
  ]);
  concurrentGate.resolve({ response: 1 });
  assert.strictEqual((await firstPending).approved, true);
  assert.strictEqual(concurrent.events.length, 1);

  let reenteredRequest = null;
  let reentered = false;
  const reentrantRequestedInput = approvalInput({
    invocationId: 'capture-invocation-reentrant-requested',
  });
  const reentrantRequested = createHarness({
    recordHook({ service, type }) {
      if (type !== 'job.agentic_visual_capture_approval_requested' || reentered) return;
      reentered = true;
      reenteredRequest = service.requestApproval(reentrantRequestedInput);
    },
  });
  const originalRequest = reentrantRequested.service.requestApproval(
    reentrantRequestedInput
  );
  assert.strictEqual(reenteredRequest, originalRequest);
  assert.strictEqual((await originalRequest).approved, true);
  assert.strictEqual(reentrantRequested.dialogCalls(), 1);
  assert.deepStrictEqual(reentrantRequested.events.map((event) => event.type), [
    'job.agentic_visual_capture_approval_requested',
  ]);

  for (const field of [
    'browserSessionId',
    'browserSessionSnapshotDigest',
    'callId',
    'invocationId',
    'requestDigest',
    'binding',
  ]) {
    const harness = createHarness();
    const input = approvalInput();
    const result = await harness.service.requestApproval(input);
    const overrides = {
      browserSessionId: 'browser-session-other',
      browserSessionSnapshotDigest: digest('e'),
      callId: 'call-capture-other',
      invocationId: 'capture-invocation-other',
      requestDigest: digest('c'),
      binding: binding({ canonicalRootPath: '/workspace/other' }),
    };
    const mismatch = harness.service.consumeApproval(consumeInput(
      input,
      result.receipt,
      { [field]: overrides[field] }
    ));
    assert.strictEqual(mismatch.authorized, false, field);
    assert.strictEqual(mismatch.reason, VISUAL_CAPTURE_APPROVAL_REASONS.MISMATCH, field);
    assert.strictEqual(harness.events.at(-1).type, 'job.agentic_visual_capture_approval_denied');
  }

  for (const staleCase of ['lifecycle', 'frontier', 'lease']) {
    const gate = deferred();
    const harness = createHarness({ dialog: () => gate.promise });
    const pending = harness.service.requestApproval(approvalInput());
    await until(() => harness.dialogCalls() === 1);
    if (staleCase === 'lifecycle') harness.setActive(false);
    if (staleCase === 'frontier') harness.setFrontier(false);
    if (staleCase === 'lease') harness.setLease(Object.freeze({ window: 'replacement' }));
    gate.resolve({ response: 1 });
    const result = await pending;
    assert.strictEqual(result.approved, false, staleCase);
    assert.strictEqual(harness.events.at(-1).type, 'job.agentic_visual_capture_approval_denied');
  }

  const expired = createHarness({ approvalTtlMs: 10 });
  const expiredInput = approvalInput();
  const expiredApproval = await expired.service.requestApproval(expiredInput);
  expired.setNow(1_010);
  assert.strictEqual(
    expired.service.consumeApproval(consumeInput(expiredInput, expiredApproval.receipt)).reason,
    VISUAL_CAPTURE_APPROVAL_REASONS.EXPIRED
  );

  const expiredBeforeRetry = createHarness({ approvalTtlMs: 10 });
  const expiredBeforeRetryInput = approvalInput({
    invocationId: 'capture-invocation-expired-before-retry',
  });
  assert.strictEqual(
    (await expiredBeforeRetry.service.requestApproval(expiredBeforeRetryInput)).approved,
    true
  );
  expiredBeforeRetry.setNow(1_010);
  const retriedAfterExpiry = await expiredBeforeRetry.service.requestApproval(
    expiredBeforeRetryInput
  );
  assert.strictEqual(retriedAfterExpiry.approved, true);
  assert.strictEqual(expiredBeforeRetry.dialogCalls(), 2);
  assert.strictEqual(
    expiredBeforeRetry.events.some((event) => event.payload.reason === 'expired'),
    true
  );

  const cancelled = createHarness({ dialog: () => new Promise(() => {}) });
  const cancelledPending = cancelled.service.requestApproval(approvalInput());
  await until(() => cancelled.dialogCalls() === 1);
  cancelled.abort();
  assert.strictEqual(
    (await cancelledPending).reason,
    VISUAL_CAPTURE_APPROVAL_REASONS.CANCELED
  );

  for (const pendingTerminal of [
    {
      invoke(harness) {
        return harness.service.cancelJob(Object.freeze({ binding: binding() }));
      },
      reason: VISUAL_CAPTURE_APPROVAL_REASONS.CANCELED,
      eventReason: 'canceled',
    },
    {
      invoke(harness) { return harness.service.invalidateWindow(); },
      reason: VISUAL_CAPTURE_APPROVAL_REASONS.WINDOW_INVALIDATED,
      eventReason: 'window_invalidated',
    },
    {
      invoke(harness) { return harness.service.clear(); },
      reason: VISUAL_CAPTURE_APPROVAL_REASONS.CLEARED,
      eventReason: 'cleared',
    },
  ]) {
    const gate = deferred();
    const harness = createHarness({ dialog: () => gate.promise });
    const pending = harness.service.requestApproval(approvalInput({
      invocationId: `capture-invocation-${pendingTerminal.eventReason}`,
    }));
    await until(() => harness.dialogCalls() === 1);
    assert.strictEqual(pendingTerminal.invoke(harness).ok, true);
    assert.strictEqual((await pending).reason, pendingTerminal.reason);
    const deniedEvents = harness.events.filter(
      (event) => event.type === 'job.agentic_visual_capture_approval_denied'
    );
    assert.strictEqual(deniedEvents.length, 1, pendingTerminal.eventReason);
    assert.strictEqual(deniedEvents[0].payload.reason, pendingTerminal.eventReason);
  }

  const recorderFailure = createHarness({ recordFails: true });
  const recorderResult = await recorderFailure.service.requestApproval(approvalInput());
  assert.strictEqual(recorderResult.approved, false);
  assert.strictEqual(recorderResult.reason, VISUAL_CAPTURE_APPROVAL_REASONS.EVENT_PERSIST_FAILED);
  assert.strictEqual(recorderFailure.dialogCalls(), 0);

  const approvedEventFailure = createHarness({
    recordFailType: 'job.agentic_visual_capture_approval_approved',
  });
  const approvedEventInput = approvalInput();
  const approvedEventReceipt = await approvedEventFailure.service.requestApproval(
    approvedEventInput
  );
  assert.strictEqual(approvedEventReceipt.approved, true);
  assert.deepStrictEqual(
    approvedEventFailure.service.consumeApproval(
      consumeInput(approvedEventInput, approvedEventReceipt.receipt)
    ),
    {
      ok: false,
      authorized: false,
      reason: VISUAL_CAPTURE_APPROVAL_REASONS.EVENT_PERSIST_FAILED,
    }
  );
  assert.deepStrictEqual(approvedEventFailure.events.map((event) => event.type), [
    'job.agentic_visual_capture_approval_requested',
    'job.agentic_visual_capture_approval_approved',
    'job.agentic_visual_capture_approval_denied',
  ]);

  const reentrantRevocation = createHarness({
    recordHook({ service, type }) {
      if (type === 'job.agentic_visual_capture_approval_approved') service.clear();
    },
  });
  const reentrantInput = approvalInput();
  const reentrantApproval = await reentrantRevocation.service.requestApproval(
    reentrantInput
  );
  const reentrantConsumption = reentrantRevocation.service.consumeApproval(
    consumeInput(reentrantInput, reentrantApproval.receipt)
  );
  assert.strictEqual(reentrantConsumption.authorized, false);
  assert.strictEqual(
    reentrantConsumption.reason,
    VISUAL_CAPTURE_APPROVAL_REASONS.CLEARED
  );

  const expiredDuringApprovedEvent = createHarness({
    approvalTtlMs: 10,
    recordHook({ type, setNow }) {
      if (type === 'job.agentic_visual_capture_approval_approved') setNow(1_010);
    },
  });
  const expiredDuringApprovedInput = approvalInput({
    invocationId: 'capture-invocation-expired-during-approved-event',
  });
  const expiredDuringApprovedReceipt = await expiredDuringApprovedEvent.service.requestApproval(
    expiredDuringApprovedInput
  );
  const expiredDuringApprovedConsumption =
    expiredDuringApprovedEvent.service.consumeApproval(consumeInput(
      expiredDuringApprovedInput,
      expiredDuringApprovedReceipt.receipt
    ));
  assert.strictEqual(expiredDuringApprovedConsumption.authorized, false);
  assert.strictEqual(
    expiredDuringApprovedConsumption.reason,
    VISUAL_CAPTURE_APPROVAL_REASONS.EXPIRED
  );

  const clearHarness = createHarness();
  const clearInput = approvalInput();
  const clearApproval = await clearHarness.service.requestApproval(clearInput);
  assert.deepStrictEqual(clearHarness.service.clear(), { ok: true, canceled: 0, revoked: 1 });
  assert.strictEqual(
    clearHarness.service.consumeApproval(consumeInput(clearInput, clearApproval.receipt)).authorized,
    false
  );
  assert.deepStrictEqual(clearHarness.service.diagnostics(), {
    version: 'agentic-visual-capture-approval-service.v1',
    pendingDialogs: 0,
    activeApprovals: 0,
    ttlMs: 60_000,
    approvalScope: 'single_digest_bound_capture',
    durableEvents: true,
    durableEventFailures: 0,
    degraded: false,
  });

  console.log('agentic-visual-capture-approval-service.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
