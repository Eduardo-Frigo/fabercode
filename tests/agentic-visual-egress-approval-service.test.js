'use strict';

const assert = require('assert');

const {
  AGENTIC_VISUAL_EGRESS_APPROVAL_SERVICE_VERSION,
  DEFAULT_VISUAL_EGRESS_APPROVAL_TTL_MS,
  FIXED_VISUAL_EGRESS_APPROVAL_DIALOG,
  MAX_VISUAL_EGRESS_APPROVAL_TTL_MS,
  MAX_VISUAL_EGRESS_IMAGE_BYTES,
  VISUAL_EGRESS_APPROVAL_REASONS,
  AgenticVisualEgressApprovalService,
  createAgenticVisualEgressApprovalService,
} = require('../main/services/agentic_visual_egress_approval_service');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding(overrides = {}) {
  return {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/project-a',
    realRootPath: '/real/workspace/project-a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'kernel-a',
    submissionDigest: digest('a'),
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

async function until(predicate, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(message);
}

function createHarness({ dialog, approvalTtlMs, frontierHook } = {}) {
  let now = 1_000;
  let lifecycleAuthorized = true;
  let rootAuthorized = true;
  let frontierAuthorized = true;
  let currentLease = Object.freeze({ window: 'main' });
  let dialogCalls = 0;
  let lifecycleCalls = 0;
  let rootCalls = 0;
  let frontierCalls = 0;
  let leaseCalls = 0;
  const payloads = [];
  const contexts = [];
  let service;

  service = createAgenticVisualEgressApprovalService({
    showNativeDialog(payload, context) {
      dialogCalls += 1;
      payloads.push(payload);
      contexts.push(context);
      return dialog ? dialog(payload, context) : { response: 1 };
    },
    authorizeLifecycle(candidate) {
      lifecycleCalls += 1;
      return lifecycleAuthorized
        ? { authorized: true, binding: candidate }
        : { authorized: false };
    },
    authorizeRoot(candidate) {
      rootCalls += 1;
      return rootAuthorized
        ? { authorized: true, binding: candidate }
        : { authorized: false };
    },
    authorizeEgressFrontier(candidate) {
      frontierCalls += 1;
      if (frontierHook) frontierHook({ candidate, service });
      return frontierAuthorized && candidate.windowLease === currentLease
        ? {
          authorized: true,
          binding: candidate.binding,
          windowLease: candidate.windowLease,
          providerOrigin: candidate.providerOrigin,
          payloadDigest: candidate.payloadDigest,
        }
        : { authorized: false };
    },
    getWindowLease() {
      leaseCalls += 1;
      return currentLease;
    },
    now: () => now,
    ...(approvalTtlMs === undefined ? {} : { approvalTtlMs }),
  });

  return {
    service,
    currentLease: () => currentLease,
    setLease(value) { currentLease = value; },
    setLifecycle(value) { lifecycleAuthorized = value; },
    setRoot(value) { rootAuthorized = value; },
    setFrontier(value) { frontierAuthorized = value; },
    setNow(value) { now = value; },
    counts() {
      return { dialogCalls, lifecycleCalls, rootCalls, frontierCalls, leaseCalls };
    },
    payloads,
    contexts,
  };
}

function approvalInput(harness, overrides = {}) {
  return {
    binding: binding(),
    windowLease: harness.currentLease(),
    providerId: 'openai',
    providerLabel: 'OpenAI',
    providerOrigin: 'https://api.openai.com',
    payloadDigest: digest('b'),
    mimeType: 'image/png',
    bytes: 2_048,
    projectLabel: 'Faber Code',
    ...overrides,
  };
}

function assertRequestEnvelope(value, approved) {
  assert.deepStrictEqual(Object.keys(value), approved
    ? ['ok', 'approved', 'reason', 'receipt']
    : ['ok', 'approved', 'reason']);
  assert.strictEqual(value.approved, approved);
  assert(Object.isFrozen(value));
  if (approved) {
    assert(value.receipt && typeof value.receipt === 'object');
    assert(Object.isFrozen(value.receipt));
    assert.deepStrictEqual(Object.keys(value.receipt), []);
    assert.strictEqual(JSON.stringify(value.receipt), '{}');
  }
  const serialized = JSON.stringify(value);
  for (const forbidden of ['sha256:', '/workspace', '/real/', 'api.openai.com', 'image/png']) {
    assert.strictEqual(serialized.includes(forbidden), false, `result leaked ${forbidden}`);
  }
}

function consumeInput(input, receipt, overrides = {}) {
  return { ...input, receipt, ...overrides };
}

(async () => {
  assert.strictEqual(
    AGENTIC_VISUAL_EGRESS_APPROVAL_SERVICE_VERSION,
    'agentic-visual-egress-approval-service.v1'
  );
  assert.strictEqual(DEFAULT_VISUAL_EGRESS_APPROVAL_TTL_MS, 60_000);
  assert.strictEqual(MAX_VISUAL_EGRESS_APPROVAL_TTL_MS, 300_000);
  assert.strictEqual(MAX_VISUAL_EGRESS_IMAGE_BYTES, 8 * 1024 * 1024);
  assert.strictEqual(FIXED_VISUAL_EGRESS_APPROVAL_DIALOG.defaultId, 0);
  assert.strictEqual(FIXED_VISUAL_EGRESS_APPROVAL_DIALOG.cancelId, 0);
  assert.deepStrictEqual(
    FIXED_VISUAL_EGRESS_APPROVAL_DIALOG.buttons,
    ['Cancelar', 'Permitir esta captura']
  );
  assert(Object.isFrozen(FIXED_VISUAL_EGRESS_APPROVAL_DIALOG));
  assert(Object.isFrozen(FIXED_VISUAL_EGRESS_APPROVAL_DIALOG.buttons));

  assert.throws(() => createAgenticVisualEgressApprovalService(), /plain data record/);
  assert.throws(
    () => createAgenticVisualEgressApprovalService({ unknown: true }),
    /plain data record/
  );
  const validOptions = {
    showNativeDialog: () => ({ response: 1 }),
    authorizeLifecycle: (candidate) => ({ authorized: true, binding: candidate }),
    authorizeRoot: (candidate) => ({ authorized: true, binding: candidate }),
    authorizeEgressFrontier: (candidate) => ({
      authorized: true,
      binding: candidate.binding,
      windowLease: candidate.windowLease,
      providerOrigin: candidate.providerOrigin,
      payloadDigest: candidate.payloadDigest,
    }),
    getWindowLease: () => Object.freeze({ lease: true }),
  };
  assert(new AgenticVisualEgressApprovalService(validOptions));
  assert.throws(
    () => createAgenticVisualEgressApprovalService({ ...validOptions, approvalTtlMs: 0 }),
    /approvalTtlMs/
  );
  assert.throws(
    () => createAgenticVisualEgressApprovalService({
      ...validOptions,
      approvalTtlMs: MAX_VISUAL_EGRESS_APPROVAL_TTL_MS + 1,
    }),
    /approvalTtlMs/
  );

  const invalidHarness = createHarness();
  const validInput = approvalInput(invalidHarness);
  for (const overrides of [
    { providerOrigin: 'http://api.openai.com' },
    { providerOrigin: 'https://api.openai.com/v1' },
    { providerOrigin: 'https://user@api.openai.com' },
    { providerOrigin: 'file:///tmp/provider' },
    { providerLabel: 'OpenAI\nPermitir tudo' },
    { mimeType: 'image/jpeg' },
    { bytes: 0 },
    { bytes: MAX_VISUAL_EGRESS_IMAGE_BYTES + 1 },
    { payloadDigest: 'sha256:not-a-digest' },
    { receipt: Object.freeze({}) },
  ]) {
    const result = await invalidHarness.service.requestApproval({ ...validInput, ...overrides });
    assertRequestEnvelope(result, false);
    assert.strictEqual(result.reason, VISUAL_EGRESS_APPROVAL_REASONS.INVALID_INPUT);
  }
  assert.strictEqual(invalidHarness.counts().dialogCalls, 0);

  let hostileGetterRead = false;
  const hostileInput = { ...validInput };
  Object.defineProperty(hostileInput, 'bytes', {
    enumerable: true,
    get() {
      hostileGetterRead = true;
      return 2_048;
    },
  });
  assert.strictEqual(
    (await invalidHarness.service.requestApproval(hostileInput)).approved,
    false
  );
  assert.strictEqual(hostileGetterRead, false);

  const allowHarness = createHarness();
  const allowInput = approvalInput(allowHarness);
  const allowResult = await allowHarness.service.requestApproval(allowInput);
  assertRequestEnvelope(allowResult, true);
  assert.strictEqual(allowResult.reason, VISUAL_EGRESS_APPROVAL_REASONS.APPROVED);
  assert.strictEqual(allowHarness.counts().dialogCalls, 1);
  assert(Object.isFrozen(allowHarness.payloads[0]));
  assert(Object.isFrozen(allowHarness.contexts[0]));
  assert(allowHarness.contexts[0].signal instanceof AbortSignal);
  const detail = allowHarness.payloads[0].detail;
  assert(detail.includes('Projeto: Faber Code'));
  assert(detail.includes('Provedor: OpenAI'));
  assert(detail.includes('Destino: https://api.openai.com'));
  assert(detail.includes('PNG'));
  assert(detail.includes('2.048 bytes'));
  assert(detail.includes('somente esta tarefa e esta captura'));
  for (const forbidden of ['sha256:', 'data:image', '/workspace', '/real/']) {
    assert.strictEqual(detail.includes(forbidden), false, `dialog leaked ${forbidden}`);
  }

  const mismatch = allowHarness.service.consumeApproval(consumeInput(
    allowInput,
    allowResult.receipt,
    { payloadDigest: digest('c') }
  ));
  assert.deepStrictEqual(mismatch, {
    ok: false,
    authorized: false,
    reason: VISUAL_EGRESS_APPROVAL_REASONS.MISMATCH,
  });
  const consumed = allowHarness.service.consumeApproval(
    consumeInput(allowInput, allowResult.receipt)
  );
  assert.deepStrictEqual(consumed, {
    ok: true,
    authorized: true,
    reason: VISUAL_EGRESS_APPROVAL_REASONS.CONSUMED,
  });
  assert(Object.isFrozen(consumed));
  assert.deepStrictEqual(
    allowHarness.service.consumeApproval(consumeInput(allowInput, allowResult.receipt)),
    {
      ok: false,
      authorized: false,
      reason: VISUAL_EGRESS_APPROVAL_REASONS.REPLAYED,
    }
  );

  for (const dialogCase of [
    { value: { response: 0 }, reason: VISUAL_EGRESS_APPROVAL_REASONS.DENIED, ok: true },
    { value: { response: -1 }, reason: VISUAL_EGRESS_APPROVAL_REASONS.DENIED, ok: true },
    { value: { response: 1, extra: true }, reason: VISUAL_EGRESS_APPROVAL_REASONS.DENIED, ok: true },
    { reject: true, reason: VISUAL_EGRESS_APPROVAL_REASONS.DIALOG_FAILED, ok: false },
  ]) {
    const harness = createHarness({
      dialog: () => dialogCase.reject
        ? Promise.reject(new Error('dialog failed'))
        : dialogCase.value,
    });
    const result = await harness.service.requestApproval(approvalInput(harness));
    assertRequestEnvelope(result, false);
    assert.strictEqual(result.reason, dialogCase.reason);
    assert.strictEqual(result.ok, dialogCase.ok);
  }

  const concurrentGate = deferred();
  const concurrentHarness = createHarness({ dialog: () => concurrentGate.promise });
  const concurrentInput = approvalInput(concurrentHarness);
  const concurrentRequests = Array.from(
    { length: 50 },
    () => concurrentHarness.service.requestApproval(concurrentInput)
  );
  assert.strictEqual(new Set(concurrentRequests).size, 1);
  await until(() => concurrentHarness.counts().dialogCalls === 1, 'dialog did not open');
  const divergent = await concurrentHarness.service.requestApproval({
    ...concurrentInput,
    payloadDigest: digest('c'),
  });
  assert.strictEqual(divergent.approved, false);
  assert.strictEqual(divergent.reason, VISUAL_EGRESS_APPROVAL_REASONS.BUSY);
  concurrentGate.resolve({ response: 1 });
  const concurrentResults = await Promise.all(concurrentRequests);
  assert(concurrentResults.every((result) => result === concurrentResults[0]));
  assert.strictEqual(concurrentHarness.counts().dialogCalls, 1);

  for (const staleCase of ['lifecycle', 'root', 'lease']) {
    const gate = deferred();
    const harness = createHarness({ dialog: () => gate.promise });
    const input = approvalInput(harness);
    const pending = harness.service.requestApproval(input);
    await until(() => harness.counts().dialogCalls === 1);
    if (staleCase === 'lifecycle') harness.setLifecycle(false);
    if (staleCase === 'root') harness.setRoot(false);
    if (staleCase === 'lease') harness.setLease(Object.freeze({ window: 'replacement' }));
    gate.resolve({ response: 1 });
    const result = await pending;
    assert.strictEqual(result.approved, false, staleCase);
    assert.strictEqual(harness.service.diagnostics().activeApprovals, 0, staleCase);
  }

  const frontierHarness = createHarness();
  const frontierInput = approvalInput(frontierHarness);
  const frontierApproval = await frontierHarness.service.requestApproval(frontierInput);
  frontierHarness.setFrontier(false);
  assert.deepStrictEqual(
    frontierHarness.service.consumeApproval(
      consumeInput(frontierInput, frontierApproval.receipt)
    ),
    {
      ok: false,
      authorized: false,
      reason: VISUAL_EGRESS_APPROVAL_REASONS.FRONTIER_INVALIDATED,
    }
  );
  frontierHarness.setFrontier(true);
  assert.strictEqual(
    frontierHarness.service.consumeApproval(
      consumeInput(frontierInput, frontierApproval.receipt)
    ).authorized,
    false
  );

  const ttlHarness = createHarness({ approvalTtlMs: 10 });
  const ttlInput = approvalInput(ttlHarness);
  const ttlApproval = await ttlHarness.service.requestApproval(ttlInput);
  ttlHarness.setNow(1_010);
  assert.deepStrictEqual(
    ttlHarness.service.consumeApproval(consumeInput(ttlInput, ttlApproval.receipt)),
    {
      ok: false,
      authorized: false,
      reason: VISUAL_EGRESS_APPROVAL_REASONS.EXPIRED,
    }
  );

  const cancelGate = deferred();
  const cancelHarness = createHarness({ dialog: () => cancelGate.promise });
  const cancelInput = approvalInput(cancelHarness);
  const cancelPending = cancelHarness.service.requestApproval(cancelInput);
  await until(() => cancelHarness.counts().dialogCalls === 1);
  assert.deepStrictEqual(cancelHarness.service.cancelJob({ binding: cancelInput.binding }), {
    ok: true,
    canceled: 1,
    revoked: 0,
  });
  assert.strictEqual((await cancelPending).approved, false);
  cancelGate.resolve({ response: 1 });
  await new Promise((resolve) => setImmediate(resolve));

  const activeCancelHarness = createHarness();
  const activeCancelInput = approvalInput(activeCancelHarness);
  const activeApproval = await activeCancelHarness.service.requestApproval(activeCancelInput);
  assert.deepStrictEqual(
    activeCancelHarness.service.cancelJob({ binding: activeCancelInput.binding }),
    { ok: true, canceled: 0, revoked: 1 }
  );
  assert.strictEqual(
    activeCancelHarness.service.consumeApproval(
      consumeInput(activeCancelInput, activeApproval.receipt)
    ).authorized,
    false
  );

  const windowHarness = createHarness();
  const windowInput = approvalInput(windowHarness);
  const windowApproval = await windowHarness.service.requestApproval(windowInput);
  assert.deepStrictEqual(windowHarness.service.invalidateWindow(), {
    ok: true,
    canceled: 0,
    revoked: 1,
  });
  assert.strictEqual(
    windowHarness.service.consumeApproval(
      consumeInput(windowInput, windowApproval.receipt)
    ).authorized,
    false
  );

  const clearHarness = createHarness();
  const clearInput = approvalInput(clearHarness);
  const clearApproval = await clearHarness.service.requestApproval(clearInput);
  assert.deepStrictEqual(clearHarness.service.clear(), {
    ok: true,
    canceled: 0,
    revoked: 1,
  });
  assert.strictEqual(
    clearHarness.service.consumeApproval(
      consumeInput(clearInput, clearApproval.receipt)
    ).authorized,
    false
  );
  assert.strictEqual(clearHarness.service.diagnostics().activeApprovals, 0);
  assert.strictEqual(clearHarness.service.diagnostics().pendingDialogs, 0);

  console.log('agentic-visual-egress-approval-service.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
