'use strict';

const assert = require('assert');

const {
  DEFAULT_EFFECT_DECISION_TTL_MS,
  DEFAULT_NATIVE_EFFECT_APPROVAL_CAPS,
  FIXED_EFFECT_APPROVAL_DIALOG,
  MAX_EFFECT_DECISION_TTL_MS,
  NATIVE_EFFECT_APPROVAL_REASONS,
  NATIVE_EFFECT_APPROVAL_SERVICE_VERSION,
  NativeEffectApprovalService,
  createNativeEffectApprovalService,
} = require('../main/services/native_effect_approval_service');
const {
  canonicalSha256Digest,
  createTransactionalDeleteImpact,
  createTransactionalDeletePublicRequest,
} = require('../main/capabilities/transactional_delete_contracts');

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

async function until(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(message || 'condition was not reached');
}

function createHarness({
  dialog,
  caps,
  decisionTtlMs,
  decisionIdFactory,
  nowHook,
  lifecycleHook,
  rootHook,
  leaseHook,
  effectFrontierHook,
} = {}) {
  let now = 1_000;
  let lifecycleAuthorized = true;
  let rootAuthorized = true;
  let currentLease = Object.freeze({ window: 'a' });
  let dialogCalls = 0;
  let lifecycleCalls = 0;
  let rootCalls = 0;
  let leaseCalls = 0;
  let effectFrontierCalls = 0;
  let idCalls = 0;
  const payloads = [];
  const contexts = [];
  let service;
  service = createNativeEffectApprovalService({
    showNativeDialog(payload, context) {
      dialogCalls += 1;
      payloads.push(payload);
      contexts.push(context);
      return dialog ? dialog(payload, context) : { response: 1 };
    },
    authorizeLifecycle(candidate) {
      lifecycleCalls += 1;
      if (lifecycleHook) lifecycleHook({ candidate, service });
      return lifecycleAuthorized
        ? { authorized: true, binding: candidate }
        : { authorized: false, reason: 'inactive' };
    },
    authorizeRoot(candidate) {
      rootCalls += 1;
      if (rootHook) rootHook({ candidate, service });
      return rootAuthorized
        ? {
          authorized: true,
          projectId: candidate.projectId,
          canonicalRootPath: candidate.canonicalRootPath,
          realRootPath: candidate.realRootPath,
        }
        : { authorized: false, reason: 'root_changed' };
    },
    authorizeEffectFrontier(candidate) {
      effectFrontierCalls += 1;
      if (effectFrontierHook) effectFrontierHook({ candidate, service });
      return lifecycleAuthorized && rootAuthorized && candidate.windowLease === currentLease
        ? {
          authorized: true,
          binding: candidate.binding,
          windowLease: candidate.windowLease,
        }
        : { authorized: false, binding: candidate.binding, windowLease: candidate.windowLease };
    },
    getWindowLease() {
      leaseCalls += 1;
      if (leaseHook) leaseHook({ service });
      return currentLease;
    },
    now() {
      if (nowHook) nowHook({ service });
      return now;
    },
    decisionIdFactory() {
      idCalls += 1;
      return decisionIdFactory
        ? decisionIdFactory({ service, idCalls })
        : `effect-decision-${idCalls}`;
    },
    ...(caps === undefined ? {} : { caps }),
    ...(decisionTtlMs === undefined ? {} : { decisionTtlMs }),
  });
  return {
    service,
    currentLease: () => currentLease,
    setLease(value) { currentLease = value; },
    setLifecycle(value) { lifecycleAuthorized = value; },
    setRoot(value) { rootAuthorized = value; },
    setNow(value) { now = value; },
    counts() {
      return {
        dialogCalls,
        lifecycleCalls,
        rootCalls,
        leaseCalls,
        effectFrontierCalls,
        idCalls,
      };
    },
    payloads,
    contexts,
  };
}

function decisionInput(harness, overrides = {}) {
  const input = {
    binding: binding(),
    impactDigest: digest('c'),
    checkpointDigest: digest('d'),
    impact: { files: 1, bytes: 12, directories: 0 },
    displayPaths: ['src/obsolete.js'],
    pathStyle: 'posix',
    caseSensitive: true,
    projectLabel: 'Faber Code',
    actorId: 'user-a',
    windowLease: harness.currentLease(),
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'requestDigest')) {
    try {
      const request = createTransactionalDeletePublicRequest(
        { paths: input.displayPaths },
        { pathStyle: input.pathStyle, caseSensitive: input.caseSensitive }
      );
      input.requestDigest = canonicalSha256Digest({
        pathStyle: input.pathStyle,
        caseSensitive: input.caseSensitive,
        request,
      });
    } catch {
      input.requestDigest = digest('b');
    }
  }
  if (!Object.hasOwn(overrides, 'impactDigest')) {
    try {
      input.impactDigest = canonicalSha256Digest(createTransactionalDeleteImpact(input.impact));
    } catch {
      input.impactDigest = digest('c');
    }
  }
  return input;
}

function assertDecisionEnvelope(value) {
  assert.deepStrictEqual(Object.keys(value), ['ok', 'approved', 'reason']);
  assert(Object.isFrozen(value));
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    'effect-decision-',
    'sha256:',
    '/workspace',
    '/real/',
    'src/obsolete.js',
    'binding',
    'requestDigest',
    'checkpointDigest',
  ]) {
    assert.strictEqual(serialized.includes(forbidden), false, `public result leaked ${forbidden}`);
  }
}

(async () => {
  assert.strictEqual(
    NATIVE_EFFECT_APPROVAL_SERVICE_VERSION,
    'native-effect-approval-service.v1'
  );
  assert.strictEqual(DEFAULT_EFFECT_DECISION_TTL_MS, 60_000);
  assert.strictEqual(MAX_EFFECT_DECISION_TTL_MS, 300_000);
  assert.strictEqual(FIXED_EFFECT_APPROVAL_DIALOG.defaultId, 0);
  assert.strictEqual(FIXED_EFFECT_APPROVAL_DIALOG.cancelId, 0);
  assert.deepStrictEqual(
    FIXED_EFFECT_APPROVAL_DIALOG.buttons,
    ['Cancelar', 'Permitir exclusão']
  );
  assert(Object.isFrozen(FIXED_EFFECT_APPROVAL_DIALOG));
  assert(Object.isFrozen(FIXED_EFFECT_APPROVAL_DIALOG.buttons));
  assert(Object.isFrozen(DEFAULT_NATIVE_EFFECT_APPROVAL_CAPS));

  assert.throws(() => createNativeEffectApprovalService(), /plain data record/);
  assert.throws(() => createNativeEffectApprovalService({ unknown: true }), /plain data record/);
  const hostileOptions = {};
  let hostileOptionGetterRead = false;
  Object.defineProperty(hostileOptions, 'showNativeDialog', {
    enumerable: true,
    get() {
      hostileOptionGetterRead = true;
      return () => ({ response: 1 });
    },
  });
  assert.throws(
    () => createNativeEffectApprovalService(hostileOptions),
    /plain data record/
  );
  assert.strictEqual(hostileOptionGetterRead, false);
  const validOptions = {
    showNativeDialog: () => ({ response: 1 }),
    authorizeLifecycle: (candidate) => ({ authorized: true, binding: candidate }),
    authorizeRoot: (candidate) => ({ authorized: true, binding: candidate }),
    authorizeEffectFrontier: (candidate) => ({
      authorized: true,
      binding: candidate.binding,
      windowLease: candidate.windowLease,
    }),
    getWindowLease: () => Object.freeze({ lease: true }),
  };
  assert.throws(
    () => createNativeEffectApprovalService({ ...validOptions, decisionTtlMs: 0 }),
    /decisionTtlMs/
  );
  assert.throws(
    () => createNativeEffectApprovalService({
      ...validOptions,
      decisionTtlMs: MAX_EFFECT_DECISION_TTL_MS + 1,
    }),
    /decisionTtlMs/
  );
  assert.throws(
    () => createNativeEffectApprovalService({
      ...validOptions,
      caps: { maxFilesPerDecision: 33 },
    }),
    /maxFilesPerDecision/
  );
  assert(new NativeEffectApprovalService(validOptions));

  const pathHarness = createHarness();
  for (const unsafePath of [
    'a\\b',
    '.git/config',
    'src/.GIT/config',
    '.env',
    'src/.faber/internal',
    'docs/milestones/plan.json',
    'src/safe\u0085forged-label.js',
    'src/safe\u2028Impacto verificado: 0.js',
    'src/safe\u2029forged-label.js',
  ]) {
    const unsafeDecision = await pathHarness.service.requestDecision(decisionInput(pathHarness, {
      displayPaths: [unsafePath],
    }));
    assert.strictEqual(unsafeDecision.approved, false);
    assert.strictEqual(unsafeDecision.reason, NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT);
  }
  const overclaimedPaths = await pathHarness.service.requestDecision(decisionInput(pathHarness, {
    displayPaths: ['src/a.js', 'src/b.js'],
    impact: { files: 1, bytes: 12, directories: 0 },
  }));
  assert.strictEqual(overclaimedPaths.approved, false);
  assert.strictEqual(overclaimedPaths.reason, NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT);
  const fullDeleteRequest = createTransactionalDeletePublicRequest({
    paths: ['visible.txt', 'hidden.txt'],
  }, { pathStyle: 'posix', caseSensitive: true });
  const underDisclosed = await pathHarness.service.requestDecision(decisionInput(pathHarness, {
    displayPaths: ['visible.txt'],
    impact: { files: 2, bytes: 12, directories: 0 },
    requestDigest: canonicalSha256Digest({
      pathStyle: 'posix',
      caseSensitive: true,
      request: fullDeleteRequest,
    }),
  }));
  assert.strictEqual(underDisclosed.approved, false);
  assert.strictEqual(underDisclosed.reason, NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT);
  assert.strictEqual(pathHarness.counts().dialogCalls, 0);

  const allowHarness = createHarness();
  const allowInput = decisionInput(allowHarness);
  const allowResult = await allowHarness.service.requestDecision(allowInput);
  assertDecisionEnvelope(allowResult);
  assert.deepStrictEqual(allowResult, {
    ok: true,
    approved: true,
    reason: NATIVE_EFFECT_APPROVAL_REASONS.APPROVED,
  });
  assert.strictEqual(allowHarness.counts().dialogCalls, 1);
  assert(Object.isFrozen(allowHarness.payloads[0]));
  assert(Object.isFrozen(allowHarness.payloads[0].buttons));
  assert.strictEqual(allowHarness.payloads[0].defaultId, 0);
  assert.strictEqual(allowHarness.payloads[0].cancelId, 0);
  assert(allowHarness.payloads[0].detail.includes('Projeto: Faber Code'));
  assert(allowHarness.payloads[0].detail.includes('src/obsolete.js'));
  assert.strictEqual(allowHarness.payloads[0].detail.includes('/workspace'), false);
  assert(Object.isFrozen(allowHarness.contexts[0]));
  assert(allowHarness.contexts[0].signal instanceof AbortSignal);
  assert.strictEqual(allowHarness.contexts[0].signal.aborted, false);
  const consumed = allowHarness.service.consumeDecision(allowInput);
  assertDecisionEnvelope(consumed);
  assert.strictEqual(consumed.approved, true);
  const replay = allowHarness.service.consumeDecision(allowInput);
  assertDecisionEnvelope(replay);
  assert.strictEqual(replay.approved, false);
  assert.strictEqual(replay.reason, NATIVE_EFFECT_APPROVAL_REASONS.REPLAYED);

  const labeledProjectsHarness = createHarness();
  const labeledProjectA = decisionInput(labeledProjectsHarness, {
    projectLabel: 'Project A\n\u0085\u202e/path',
  });
  const labeledProjectB = decisionInput(labeledProjectsHarness, {
    binding: binding({
      projectId: 'project-b',
      canonicalRootPath: '/workspace/project-b',
      realRootPath: '/real/workspace/project-b',
      sessionId: 'session-b',
      jobId: 'job-b',
      submissionDigest: digest('e'),
    }),
    projectLabel: 'Project B',
  });
  assert.strictEqual(
    (await labeledProjectsHarness.service.requestDecision(labeledProjectA)).approved,
    true
  );
  assert.strictEqual(
    (await labeledProjectsHarness.service.requestDecision(labeledProjectB)).approved,
    true
  );
  assert.strictEqual(labeledProjectsHarness.counts().dialogCalls, 2);
  assert(labeledProjectsHarness.payloads[0].detail.includes('Projeto: Project A /path'));
  assert(labeledProjectsHarness.payloads[1].detail.includes('Projeto: Project B'));
  for (const payload of labeledProjectsHarness.payloads) {
    assert.strictEqual(payload.detail.includes('\n\u202e'), false);
    assert.strictEqual(payload.detail.includes('/workspace/project-'), false);
    assert.strictEqual(payload.detail.includes('/real/workspace'), false);
  }

  const mismatchHarness = createHarness();
  const mismatchInput = decisionInput(mismatchHarness);
  assert.strictEqual(
    (await mismatchHarness.service.requestDecision(mismatchInput)).approved,
    true
  );
  const mismatch = mismatchHarness.service.consumeDecision({
    ...mismatchInput,
    impactDigest: digest('e'),
  });
  assertDecisionEnvelope(mismatch);
  assert.strictEqual(mismatch.reason, NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT);
  assert.strictEqual(mismatchHarness.service.consumeDecision(mismatchInput).approved, true);

  for (const testCase of [
    { name: 'deny', dialog: () => ({ response: 0 }), expectedOk: true },
    { name: 'close', dialog: () => ({ response: -1 }), expectedOk: true },
    { name: 'malformed', dialog: () => ({ response: 1, unexpected: true }), expectedOk: true },
    { name: 'throw', dialog: () => { throw new Error('dialog unavailable'); }, expectedOk: false },
    { name: 'reject', dialog: () => Promise.reject(new Error('dialog rejected')), expectedOk: false },
  ]) {
    const harness = createHarness({ dialog: testCase.dialog });
    const input = decisionInput(harness);
    const result = await harness.service.requestDecision(input);
    assertDecisionEnvelope(result);
    assert.strictEqual(result.approved, false, testCase.name);
    assert.strictEqual(result.ok, testCase.expectedOk, testCase.name);
    assert.strictEqual(harness.service.diagnostics().activeDecisions, 0, testCase.name);
    assert.strictEqual(harness.service.consumeDecision(input).approved, false, testCase.name);
  }

  let hostileDialogGetterRead = false;
  const hostileDialogResult = {};
  Object.defineProperty(hostileDialogResult, 'response', {
    enumerable: true,
    get() {
      hostileDialogGetterRead = true;
      return 1;
    },
  });
  const hostileDialogHarness = createHarness({ dialog: () => hostileDialogResult });
  const hostileDialogDecision = await hostileDialogHarness.service.requestDecision(
    decisionInput(hostileDialogHarness)
  );
  assert.strictEqual(hostileDialogDecision.approved, false);
  assert.strictEqual(hostileDialogGetterRead, false);
  assert.strictEqual(hostileDialogHarness.service.diagnostics().activeDecisions, 0);

  const concurrentGate = deferred();
  const concurrentHarness = createHarness({ dialog: () => concurrentGate.promise });
  const concurrentInput = decisionInput(concurrentHarness);
  const concurrentCalls = Array.from(
    { length: 100 },
    () => concurrentHarness.service.requestDecision(concurrentInput)
  );
  assert.strictEqual(new Set(concurrentCalls).size, 1);
  await until(() => concurrentHarness.counts().dialogCalls === 1, 'dialog did not open');
  const divergent = await concurrentHarness.service.requestDecision({
    ...concurrentInput,
    requestDigest: digest('e'),
  });
  assert.strictEqual(divergent.approved, false);
  assert.strictEqual(divergent.reason, NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT);
  assert.strictEqual(concurrentHarness.counts().dialogCalls, 1);
  concurrentGate.resolve({ response: 1 });
  const concurrentResults = await Promise.all(concurrentCalls);
  assert(concurrentResults.every((result) => result.approved === true));
  assert.strictEqual(concurrentHarness.counts().dialogCalls, 1);
  assert.strictEqual(concurrentHarness.service.diagnostics().activeDecisions, 1);

  const cancelGate = deferred();
  const cancelHarness = createHarness({ dialog: () => cancelGate.promise });
  const cancelInput = decisionInput(cancelHarness);
  const cancelPending = cancelHarness.service.requestDecision(cancelInput);
  await until(() => cancelHarness.counts().dialogCalls === 1);
  assert.deepStrictEqual(cancelHarness.service.cancelJob({ binding: cancelInput.binding }), {
    ok: true,
    canceled: 1,
    revoked: 0,
  });
  const cancelResult = await cancelPending;
  assertDecisionEnvelope(cancelResult);
  assert.strictEqual(cancelResult.approved, false);
  cancelGate.resolve({ response: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(cancelHarness.service.diagnostics().activeDecisions, 0);
  assert.strictEqual(cancelHarness.service.consumeDecision(cancelInput).approved, false);

  const activeCancelHarness = createHarness();
  const activeCancelInput = decisionInput(activeCancelHarness);
  await activeCancelHarness.service.requestDecision(activeCancelInput);
  assert.deepStrictEqual(
    activeCancelHarness.service.cancelJob({
      binding: activeCancelInput.binding,
      reason: 'job_canceled',
    }),
    { ok: true, canceled: 0, revoked: 1 }
  );
  const canceledConsume = activeCancelHarness.service.consumeDecision(activeCancelInput);
  assert.strictEqual(canceledConsume.approved, false);
  assert.strictEqual(canceledConsume.reason, NATIVE_EFFECT_APPROVAL_REASONS.REVOKED);

  const crossJobGates = [deferred(), deferred()];
  let crossJobDialogIndex = 0;
  const crossJobHarness = createHarness({
    dialog: () => crossJobGates[crossJobDialogIndex++].promise,
  });
  const crossJobInputA = decisionInput(crossJobHarness);
  const crossJobInputB = decisionInput(crossJobHarness, {
    binding: binding({ jobId: 'job-b', submissionDigest: digest('e') }),
    checkpointDigest: digest('2'),
    displayPaths: ['src/other-obsolete.js'],
  });
  const crossJobPendingA = crossJobHarness.service.requestDecision(crossJobInputA);
  const crossJobPendingB = crossJobHarness.service.requestDecision(crossJobInputB);
  await until(() => crossJobHarness.counts().dialogCalls === 2);
  assert.deepStrictEqual(crossJobHarness.service.cancelJob({
    binding: crossJobInputA.binding,
    reason: `sha256:${'f'.repeat(64)}`,
  }), { ok: true, canceled: 1, revoked: 0 });
  const crossJobCanceled = await crossJobPendingA;
  assertDecisionEnvelope(crossJobCanceled);
  assert.strictEqual(crossJobCanceled.reason, NATIVE_EFFECT_APPROVAL_REASONS.CANCELED);
  crossJobGates[1].resolve({ response: 1 });
  assert.strictEqual((await crossJobPendingB).approved, true);
  assert.strictEqual(crossJobHarness.service.consumeDecision(crossJobInputB).approved, true);
  crossJobGates[0].resolve({ response: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(crossJobHarness.service.diagnostics().activeDecisions, 0);

  for (const staleCase of ['lifecycle', 'root', 'lease']) {
    const gate = deferred();
    const harness = createHarness({ dialog: () => gate.promise });
    const input = decisionInput(harness);
    const pending = harness.service.requestDecision(input);
    await until(() => harness.counts().dialogCalls === 1);
    if (staleCase === 'lifecycle') harness.setLifecycle(false);
    if (staleCase === 'root') harness.setRoot(false);
    if (staleCase === 'lease') harness.setLease(Object.freeze({ window: 'b' }));
    gate.resolve({ response: 1 });
    const result = await pending;
    assertDecisionEnvelope(result);
    assert.strictEqual(result.approved, false, staleCase);
    assert.strictEqual(harness.service.diagnostics().activeDecisions, 0, staleCase);
  }

  const windowGate = deferred();
  const windowHarness = createHarness({ dialog: () => windowGate.promise });
  const windowInput = decisionInput(windowHarness);
  const windowPending = windowHarness.service.requestDecision(windowInput);
  await until(() => windowHarness.counts().dialogCalls === 1);
  const invalidated = windowHarness.service.invalidateWindow();
  assert.deepStrictEqual(invalidated, { ok: true, canceled: 1, revoked: 0 });
  assert.strictEqual((await windowPending).approved, false);
  windowGate.resolve({ response: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(windowHarness.service.diagnostics().activeDecisions, 0);

  const clearGate = deferred();
  const clearHarness = createHarness({ dialog: () => clearGate.promise });
  const clearInput = decisionInput(clearHarness);
  const clearPending = clearHarness.service.requestDecision(clearInput);
  await until(() => clearHarness.counts().dialogCalls === 1);
  assert.deepStrictEqual(clearHarness.service.clear(), { ok: true, canceled: 1, revoked: 0 });
  assert.strictEqual((await clearPending).approved, false);
  clearGate.resolve({ response: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(clearHarness.service.diagnostics().activeDecisions, 0);
  assert.strictEqual(clearHarness.service.diagnostics().decisionRecords, 0);

  const ttlHarness = createHarness({ decisionTtlMs: 10 });
  const ttlInput = decisionInput(ttlHarness);
  await ttlHarness.service.requestDecision(ttlInput);
  ttlHarness.setNow(1_010);
  const expired = ttlHarness.service.consumeDecision(ttlInput);
  assert.strictEqual(expired.approved, false);
  assert.strictEqual(expired.reason, NATIVE_EFFECT_APPROVAL_REASONS.EXPIRED);
  assert.strictEqual(ttlHarness.service.diagnostics().activeDecisions, 0);

  const ttlRepromptHarness = createHarness({ decisionTtlMs: 10 });
  const ttlRepromptInput = decisionInput(ttlRepromptHarness);
  assert.strictEqual(
    (await ttlRepromptHarness.service.requestDecision(ttlRepromptInput)).approved,
    true
  );
  ttlRepromptHarness.setNow(1_010);
  assert.strictEqual(
    (await ttlRepromptHarness.service.requestDecision(ttlRepromptInput)).approved,
    true
  );
  assert.strictEqual(ttlRepromptHarness.counts().dialogCalls, 2);
  assert.strictEqual(ttlRepromptHarness.service.consumeDecision(ttlRepromptInput).approved, true);

  const rollbackHarness = createHarness();
  const rollbackInput = decisionInput(rollbackHarness);
  await rollbackHarness.service.requestDecision(rollbackInput);
  rollbackHarness.setNow(999);
  const clockRollback = rollbackHarness.service.consumeDecision(rollbackInput);
  assert.strictEqual(clockRollback.approved, false);
  assert.strictEqual(clockRollback.reason, NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
  assert.strictEqual(rollbackHarness.service.diagnostics().authorityHealthy, false);
  assert.strictEqual(rollbackHarness.service.diagnostics().activeDecisions, 0);

  const nanHarness = createHarness();
  nanHarness.setNow(Number.NaN);
  const nanResult = await nanHarness.service.requestDecision(decisionInput(nanHarness));
  assert.strictEqual(nanResult.approved, false);
  assert.strictEqual(nanResult.reason, NATIVE_EFFECT_APPROVAL_REASONS.CLOCK_INVALID);
  assert.strictEqual(nanHarness.counts().dialogCalls, 0);

  let nestedConsume = null;
  let reenterInput = null;
  const idReentryHarness = createHarness({
    decisionIdFactory({ service, idCalls }) {
      if (reenterInput) nestedConsume = service.consumeDecision(reenterInput);
      return `reentrant-decision-${idCalls}`;
    },
  });
  reenterInput = decisionInput(idReentryHarness);
  const reentryOuter = await idReentryHarness.service.requestDecision(reenterInput);
  assert.strictEqual(reentryOuter.approved, true);
  assertDecisionEnvelope(nestedConsume);
  assert.strictEqual(nestedConsume.approved, false);
  assert.strictEqual(idReentryHarness.service.consumeDecision(reenterInput).approved, true);

  let lifecycleReentered = false;
  let lifecycleReentryInput = null;
  const lifecycleReentryHarness = createHarness({
    lifecycleHook({ service }) {
      if (!lifecycleReentered && lifecycleReentryInput) {
        lifecycleReentered = true;
        service.cancelJob({ binding: lifecycleReentryInput.binding });
      }
    },
  });
  lifecycleReentryInput = decisionInput(lifecycleReentryHarness);
  const lifecycleReentryResult = await lifecycleReentryHarness.service.requestDecision(
    lifecycleReentryInput
  );
  assert.strictEqual(lifecycleReentryResult.approved, false);
  assert.strictEqual(lifecycleReentryHarness.counts().dialogCalls, 0);
  assert.strictEqual(lifecycleReentryHarness.service.diagnostics().activeDecisions, 0);

  let revokeLifecycleDuringConsume = false;
  const frontierRaceHarness = createHarness({
    rootHook() {
      if (revokeLifecycleDuringConsume) frontierRaceHarness.setLifecycle(false);
    },
  });
  const frontierRaceInput = decisionInput(frontierRaceHarness);
  assert.strictEqual(
    (await frontierRaceHarness.service.requestDecision(frontierRaceInput)).approved,
    true
  );
  revokeLifecycleDuringConsume = true;
  const frontierRaceDenied = frontierRaceHarness.service.consumeDecision(frontierRaceInput);
  assert.strictEqual(frontierRaceDenied.approved, false);
  assert.strictEqual(
    frontierRaceDenied.reason,
    NATIVE_EFFECT_APPROVAL_REASONS.LIFECYCLE_INVALIDATED
  );

  let revokeAtFinalFrontier = false;
  const combinedFrontierHarness = createHarness({
    effectFrontierHook() {
      if (revokeAtFinalFrontier) combinedFrontierHarness.setLifecycle(false);
    },
  });
  const combinedFrontierInput = decisionInput(combinedFrontierHarness);
  assert.strictEqual(
    (await combinedFrontierHarness.service.requestDecision(combinedFrontierInput)).approved,
    true
  );
  revokeAtFinalFrontier = true;
  const combinedFrontierDenied = combinedFrontierHarness.service.consumeDecision(
    combinedFrontierInput
  );
  assert.strictEqual(combinedFrontierDenied.approved, false);
  assert.strictEqual(
    combinedFrontierDenied.reason,
    NATIVE_EFFECT_APPROVAL_REASONS.LIFECYCLE_INVALIDATED
  );
  assert.strictEqual(combinedFrontierHarness.counts().effectFrontierCalls, 1);

  const hostileInputHarness = createHarness();
  const hostileInput = decisionInput(hostileInputHarness);
  let hostileImpactGetterRead = false;
  const hostileImpact = {};
  Object.defineProperty(hostileImpact, 'files', {
    enumerable: true,
    get() {
      hostileImpactGetterRead = true;
      return 1;
    },
  });
  Object.defineProperties(hostileImpact, {
    bytes: { enumerable: true, value: 1 },
    directories: { enumerable: true, value: 0 },
  });
  const hostileInputResult = await hostileInputHarness.service.requestDecision({
    ...hostileInput,
    impact: hostileImpact,
  });
  assert.strictEqual(hostileInputResult.approved, false);
  assert.strictEqual(hostileInputResult.reason, NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT);
  assert.strictEqual(hostileImpactGetterRead, false);
  assert.strictEqual(hostileInputHarness.counts().dialogCalls, 0);

  const pendingCapacityGate = deferred();
  const pendingCapacityHarness = createHarness({
    caps: { maxPendingDialogs: 1 },
    dialog: () => pendingCapacityGate.promise,
  });
  const firstCapacityInput = decisionInput(pendingCapacityHarness);
  const firstCapacityPending = pendingCapacityHarness.service.requestDecision(firstCapacityInput);
  await until(() => pendingCapacityHarness.counts().dialogCalls === 1);
  const pendingCapacityDenied = await pendingCapacityHarness.service.requestDecision(
    decisionInput(pendingCapacityHarness, {
      binding: binding({ jobId: 'job-b', submissionDigest: digest('e') }),
      displayPaths: ['src/job-b-obsolete.js'],
    })
  );
  assert.strictEqual(pendingCapacityDenied.approved, false);
  assert.strictEqual(pendingCapacityDenied.reason, NATIVE_EFFECT_APPROVAL_REASONS.BUSY);
  pendingCapacityHarness.service.clear();
  assert.strictEqual((await firstCapacityPending).approved, false);
  pendingCapacityGate.resolve({ response: 1 });

  const recordCapacityHarness = createHarness({ caps: { maxDecisionRecords: 1 } });
  const firstRecordInput = decisionInput(recordCapacityHarness);
  await recordCapacityHarness.service.requestDecision(firstRecordInput);
  assert.strictEqual(recordCapacityHarness.service.consumeDecision(firstRecordInput).approved, true);
  const secondRecordInput = decisionInput(recordCapacityHarness, {
    binding: binding({ jobId: 'job-b', submissionDigest: digest('e') }),
    displayPaths: ['src/job-b-obsolete.js'],
  });
  const secondRecordResult = await recordCapacityHarness.service.requestDecision(secondRecordInput);
  assert.strictEqual(secondRecordResult.approved, false);
  assert.strictEqual(
    secondRecordResult.reason,
    NATIVE_EFFECT_APPROVAL_REASONS.CAPACITY_EXCEEDED
  );
  assert.strictEqual(recordCapacityHarness.service.diagnostics().decisionRecords, 1);

  const impactCapHarness = createHarness({ caps: { maxFilesPerDecision: 1 } });
  const impactCapResult = await impactCapHarness.service.requestDecision(
    decisionInput(impactCapHarness, {
      impact: { files: 2, bytes: 1, directories: 0 },
      displayPaths: ['a.txt', 'b.txt'],
    })
  );
  assert.strictEqual(impactCapResult.approved, false);
  assert.strictEqual(impactCapResult.reason, NATIVE_EFFECT_APPROVAL_REASONS.INVALID_INPUT);
  assert.strictEqual(impactCapHarness.counts().dialogCalls, 0);

  for (const unsafePath of ['.', '..', '../outside', '/absolute', 'C:/absolute', 'a//b', 'a\nspoof']) {
    const pathHarness = createHarness();
    const pathResult = await pathHarness.service.requestDecision(decisionInput(pathHarness, {
      displayPaths: [unsafePath],
    }));
    assert.strictEqual(pathResult.approved, false, unsafePath);
    assert.strictEqual(pathHarness.counts().dialogCalls, 0, unsafePath);
  }

  const diagnostics = allowHarness.service.diagnostics();
  assert(Object.isFrozen(diagnostics));
  assert.strictEqual(diagnostics.version, NATIVE_EFFECT_APPROVAL_SERVICE_VERSION);
  assert.strictEqual(diagnostics.defaultDecision, 'deny');
  assert.strictEqual(diagnostics.persistence, 'process_local');
  assert.strictEqual(diagnostics.authorityBoundary, 'main_process_only');
  const diagnosticsText = JSON.stringify(diagnostics);
  for (const forbidden of ['sha256:', '/workspace', '/real/', 'effect-decision-', 'src/']) {
    assert.strictEqual(diagnosticsText.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }

  console.log('native effect approval service tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
