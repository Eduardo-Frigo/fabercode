'use strict';

const assert = require('assert');

const {
  DEFAULT_DELEGATION_TTL_MS,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  createTaskDelegationStore,
} = require('../main/capabilities/task_delegation_store');
const {
  createTrustedConsentAuthority,
} = require('../main/capabilities/trusted_consent_authority');
const {
  DEFAULT_MAX_ACTIVE_DELEGATIONS,
  DEFAULT_MAX_PENDING_DIALOGS,
  FIXED_DIALOG,
  NATIVE_TASK_CONSENT_REASONS,
  NATIVE_TASK_CONSENT_SERVICE_VERSION,
  NativeTaskConsentService,
  createNativeTaskConsentService,
} = require('../main/services/native_task_consent_service');

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
  taskStoreFactory,
  trustedAuthorityFactory,
  maxPendingDialogs,
  maxActiveDelegations,
} = {}) {
  let now = 1_000;
  let lifecycleAuthorized = true;
  let currentLease = Object.freeze({ lease: 'window-a' });
  let dialogCalls = 0;
  let issueCalls = 0;
  let lifecycleCalls = 0;
  const payloads = [];
  const dialogContexts = [];
  let handleSequence = 0;
  const trustedConsentAuthority = createTrustedConsentAuthority({
    now: () => now,
    handleFactory: () => `consent_${String(++handleSequence).padStart(32, 'a')}`,
  });
  const lifecycle = (candidate) => {
    lifecycleCalls += 1;
    return lifecycleAuthorized
      ? { authorized: true, binding: candidate }
      : { authorized: false, reason: 'not_active' };
  };
  const concreteStore = createTaskDelegationStore({
    now: () => now,
    consentAuthority: trustedConsentAuthority,
    authorizeRoot({ projectId }) {
      return {
        authorized: projectId === 'project-a',
        projectId,
        canonicalRootPath: '/workspace/project-a',
        realRootPath: '/real/workspace/project-a',
      };
    },
    authorizeLifecycle: lifecycle,
    delegationIdFactory: () => `delegation-${issueCalls}`,
    decisionIdFactory: () => 'decision-native-consent',
  });
  const taskDelegationStore = taskStoreFactory
    ? taskStoreFactory({ concreteStore, trustedConsentAuthority })
    : {
      async issueFromTrustedConsent(input) {
        issueCalls += 1;
        return concreteStore.issueFromTrustedConsent(input);
      },
      get: concreteStore.get,
      revokeBinding: concreteStore.revokeBinding,
      clear: concreteStore.clear,
    };
  const serviceConsentAuthority = trustedAuthorityFactory
    ? trustedAuthorityFactory(trustedConsentAuthority)
    : trustedConsentAuthority;
  const service = createNativeTaskConsentService({
    async showNativeDialog(payload, context) {
      dialogCalls += 1;
      payloads.push(payload);
      dialogContexts.push(context);
      return dialog ? dialog(payload) : { response: 1 };
    },
    trustedConsentAuthority: serviceConsentAuthority,
    taskDelegationStore,
    authorizeLifecycle: lifecycle,
    getWindowLease: () => currentLease,
    now: () => now,
    ...(maxPendingDialogs === undefined ? {} : { maxPendingDialogs }),
    ...(maxActiveDelegations === undefined ? {} : { maxActiveDelegations }),
  });
  return {
    service,
    concreteStore,
    trustedConsentAuthority,
    lifecycle,
    currentLease: () => currentLease,
    setLease(value) { currentLease = value; },
    setLifecycle(value) { lifecycleAuthorized = value; },
    setNow(value) { now = value; },
    counts() { return { dialogCalls, issueCalls, lifecycleCalls }; },
    incrementIssueCalls() { issueCalls += 1; },
    payloads,
    dialogContexts,
  };
}

function ensureInput(harness, overrides = {}) {
  return {
    binding: binding(),
    actorId: 'user-a',
    windowLease: harness.currentLease(),
    projectLabel: 'Faber\n\u0000 Code',
    ...overrides,
  };
}

function assertPublicEnvelope(value) {
  assert.deepStrictEqual(Object.keys(value), ['ok', 'mode', 'delegated', 'reason']);
  assert(Object.isFrozen(value));
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    'consent_',
    'submission',
    'sha256:',
    '/workspace',
    '/real/',
    'binding',
    'rootPath',
  ]) {
    assert.strictEqual(serialized.includes(forbidden), false, `public result leaked ${forbidden}`);
  }
}

(async () => {
  assert.strictEqual(NATIVE_TASK_CONSENT_SERVICE_VERSION, 'native-task-consent-service.v1');
  assert.deepStrictEqual(FIXED_DIALOG.buttons, ['Perguntar antes', 'IA decide nesta tarefa']);
  assert.strictEqual(FIXED_DIALOG.defaultId, 0);
  assert.strictEqual(FIXED_DIALOG.cancelId, 0);
  assert(Object.isFrozen(FIXED_DIALOG));
  assert(Object.isFrozen(FIXED_DIALOG.buttons));

  assert.throws(() => createNativeTaskConsentService(), /plain data record/);
  assert.throws(() => createNativeTaskConsentService({ unknown: true }), /plain data record/);
  const hostileOptions = {};
  let hostileOptionRead = false;
  Object.defineProperty(hostileOptions, 'showNativeDialog', {
    enumerable: true,
    get() {
      hostileOptionRead = true;
      return () => ({ response: 1 });
    },
  });
  assert.throws(() => createNativeTaskConsentService(hostileOptions), /plain data record/);
  assert.strictEqual(hostileOptionRead, false);

  const gate = deferred();
  const concurrent = createHarness({ dialog: () => gate.promise });
  const calls = Array.from({ length: 100 }, () => concurrent.service.ensureTaskDelegation(
    ensureInput(concurrent)
  ));
  assert.strictEqual(new Set(calls).size, 1, 'identical concurrent calls must share one promise');
  await until(() => concurrent.counts().dialogCalls === 1, 'native dialog did not open');
  assert.strictEqual(concurrent.counts().issueCalls, 0);
  const divergentPending = await concurrent.service.ensureTaskDelegation(ensureInput(concurrent, {
    binding: binding({ submissionDigest: digest('b') }),
  }));
  assert.strictEqual(divergentPending.reason, NATIVE_TASK_CONSENT_REASONS.BUSY);
  assert.strictEqual(concurrent.counts().dialogCalls, 1);

  let activeReentry;
  let reenterOnGet = false;
  activeReentry = createHarness({
    taskStoreFactory({ concreteStore }) {
      return {
        async issueFromTrustedConsent(input) {
          activeReentry.incrementIssueCalls();
          return concreteStore.issueFromTrustedConsent(input);
        },
        get(delegationId) {
          const snapshot = concreteStore.get(delegationId);
          if (reenterOnGet) {
            reenterOnGet = false;
            activeReentry.service.cancelJob({
              binding: binding(),
              reason: 'active_get_reentry',
            });
          }
          return snapshot;
        },
        revokeBinding: concreteStore.revokeBinding,
        clear: concreteStore.clear,
      };
    },
  });
  assert.strictEqual(
    (await activeReentry.service.ensureTaskDelegation(ensureInput(activeReentry))).delegated,
    true
  );
  reenterOnGet = true;
  const reentrantRepeat = await activeReentry.service.ensureTaskDelegation(
    ensureInput(activeReentry)
  );
  assert.strictEqual(reentrantRepeat.mode, 'ask_each');
  assert.strictEqual(reentrantRepeat.delegated, false);
  assert.strictEqual(activeReentry.service.diagnostics().activeDelegations, 0);
  const otherActorPending = await concurrent.service.ensureTaskDelegation(ensureInput(concurrent, {
    actorId: 'user-b',
  }));
  assert.strictEqual(otherActorPending.reason, NATIVE_TASK_CONSENT_REASONS.BUSY);
  const dialogPayload = concurrent.payloads[0];
  assert(Object.isFrozen(dialogPayload));
  assert(Object.isFrozen(dialogPayload.buttons));
  assert.strictEqual(dialogPayload.defaultId, 0);
  assert.strictEqual(dialogPayload.cancelId, 0);
  assert.strictEqual(dialogPayload.detail.includes('\n\u0000'), false);
  assert.strictEqual(dialogPayload.detail.includes('/workspace'), false);
  assert.strictEqual(dialogPayload.detail.includes('project-a'), false);
  assert(Object.isFrozen(concurrent.dialogContexts[0]));
  assert(concurrent.dialogContexts[0].signal instanceof AbortSignal);
  assert.strictEqual(concurrent.dialogContexts[0].signal.aborted, false);
  gate.resolve({ response: 1 });
  const results = await Promise.all(calls);
  assert.strictEqual(concurrent.counts().dialogCalls, 1);
  assert.strictEqual(concurrent.counts().issueCalls, 1);
  assert(results.every((result) => result === results[0]));
  assert.deepStrictEqual(results[0], {
    ok: true,
    mode: 'delegate_task',
    delegated: true,
    reason: NATIVE_TASK_CONSENT_REASONS.DELEGATION_ISSUED,
  });
  assertPublicEnvelope(results[0]);
  const delegations = concurrent.concreteStore.list({ jobId: 'job-a' });
  assert.strictEqual(delegations.length, 1);
  assert.deepStrictEqual(delegations[0].principal, { kind: 'user_ui', actorId: 'user-a' });
  assert.deepStrictEqual(delegations[0].allowedEffects, ['filesystem_delete']);
  assert.strictEqual(delegations[0].expiresAt - delegations[0].issuedAt, DEFAULT_DELEGATION_TTL_MS);
  assert.strictEqual(delegations[0].constraints.checkpointRequired, true);
  assert.strictEqual(delegations[0].constraints.exactPathsOnly, true);
  assert.strictEqual(delegations[0].constraints.rejectProtectedPaths, true);
  assert.strictEqual(concurrent.trustedConsentAuthority.diagnostics().records, 0);
  const repeat = await concurrent.service.ensureTaskDelegation(ensureInput(concurrent));
  assert.strictEqual(repeat.mode, 'delegate_task');
  assert.strictEqual(repeat.delegated, true);
  assert.strictEqual(concurrent.counts().dialogCalls, 1, 'active delegation must be idempotent');
  assert.strictEqual(concurrent.counts().issueCalls, 1);
  const divergentActive = await concurrent.service.ensureTaskDelegation(ensureInput(concurrent, {
    binding: binding({ submissionDigest: digest('c') }),
  }));
  assert.strictEqual(divergentActive.reason, NATIVE_TASK_CONSENT_REASONS.BUSY);
  assert.strictEqual(concurrent.counts().dialogCalls, 1);
  const diagnostics = concurrent.service.diagnostics();
  assert.deepStrictEqual(Object.keys(diagnostics), [
    'version',
    'pendingDialogs',
    'activeDelegations',
    'maxPendingDialogs',
    'maxActiveDelegations',
    'invalidatedWindowLeases',
    'authorityHealthy',
    'defaultMode',
    'delegatedEffect',
    'delegatedTtlMs',
    'persistence',
    'authorityBoundary',
  ]);
  assert.strictEqual(diagnostics.pendingDialogs, 0);
  assert.strictEqual(diagnostics.activeDelegations, 1);
  assert.strictEqual(diagnostics.maxPendingDialogs, DEFAULT_MAX_PENDING_DIALOGS);
  assert.strictEqual(diagnostics.maxActiveDelegations, DEFAULT_MAX_ACTIVE_DELEGATIONS);
  assert.strictEqual(diagnostics.authorityHealthy, true);
  assert.strictEqual(diagnostics.defaultMode, 'ask_each');
  assert.strictEqual(diagnostics.delegatedEffect, 'filesystem_delete');
  const serializedDiagnostics = JSON.stringify(diagnostics);
  for (const forbidden of ['submission', 'sha256:', '/workspace', 'binding', 'rootPath', 'consent_']) {
    assert.strictEqual(serializedDiagnostics.includes(forbidden), false);
  }

  const denied = createHarness({ dialog: () => ({ response: 0 }) });
  const deniedResult = await denied.service.ensureTaskDelegation(ensureInput(denied));
  assert.deepStrictEqual(deniedResult, {
    ok: true,
    mode: 'ask_each',
    delegated: false,
    reason: NATIVE_TASK_CONSENT_REASONS.ASK_EACH_SELECTED,
  });
  assertPublicEnvelope(deniedResult);
  assert.strictEqual(denied.counts().issueCalls, 0);

  const closed = createHarness({ dialog: () => ({ response: -1 }) });
  assert.strictEqual(
    (await closed.service.ensureTaskDelegation(ensureInput(closed))).mode,
    'ask_each'
  );
  assert.strictEqual(closed.counts().issueCalls, 0);

  const brokenDialog = createHarness({ dialog: () => { throw new Error('native unavailable'); } });
  const brokenResult = await brokenDialog.service.ensureTaskDelegation(ensureInput(brokenDialog));
  assert.strictEqual(brokenResult.mode, 'ask_each');
  assert.strictEqual(brokenResult.reason, NATIVE_TASK_CONSENT_REASONS.DIALOG_FAILED);
  assert.strictEqual(brokenDialog.counts().issueCalls, 0);

  let proxyRace;
  proxyRace = createHarness({
    dialog: () => new Proxy({ response: 1 }, {
      getPrototypeOf(target) {
        proxyRace.service.cancelJob({ binding: binding(), reason: 'proxy_reentry' });
        return Object.getPrototypeOf(target);
      },
    }),
  });
  const proxyResult = await proxyRace.service.ensureTaskDelegation(ensureInput(proxyRace));
  assert.strictEqual(proxyResult.mode, 'ask_each');
  assert.strictEqual(proxyResult.delegated, false);
  assert.strictEqual(proxyRace.counts().issueCalls, 0);
  assert.strictEqual(proxyRace.dialogContexts[0].signal.aborted, true);

  const lifecycleGate = deferred();
  const lifecycleRace = createHarness({ dialog: () => lifecycleGate.promise });
  const lifecyclePromise = lifecycleRace.service.ensureTaskDelegation(ensureInput(lifecycleRace));
  await until(() => lifecycleRace.counts().dialogCalls === 1);
  lifecycleRace.setLifecycle(false);
  lifecycleGate.resolve({ response: 1 });
  const lifecycleResult = await lifecyclePromise;
  assert.strictEqual(lifecycleResult.mode, 'ask_each');
  assert.strictEqual(lifecycleResult.ok, false);
  assert.strictEqual(lifecycleResult.reason, NATIVE_TASK_CONSENT_REASONS.LIFECYCLE_INVALIDATED);
  assert.strictEqual(lifecycleRace.counts().issueCalls, 0);

  const leaseGate = deferred();
  const leaseRace = createHarness({ dialog: () => leaseGate.promise });
  const leasePromise = leaseRace.service.ensureTaskDelegation(ensureInput(leaseRace));
  await until(() => leaseRace.counts().dialogCalls === 1);
  leaseRace.setLease(Object.freeze({ lease: 'window-b' }));
  leaseGate.resolve({ response: 1 });
  const leaseResult = await leasePromise;
  assert.strictEqual(leaseResult.mode, 'ask_each');
  assert.strictEqual(leaseResult.ok, false);
  assert.strictEqual(leaseRace.counts().issueCalls, 0);

  const invalidationGate = deferred();
  const invalidationRace = createHarness({ dialog: () => invalidationGate.promise });
  const invalidatedLease = invalidationRace.currentLease();
  const invalidationPromise = invalidationRace.service.ensureTaskDelegation(
    ensureInput(invalidationRace)
  );
  await until(() => invalidationRace.counts().dialogCalls === 1);
  const invalidation = invalidationRace.service.invalidateWindow('window_reload');
  assert.strictEqual(invalidation.ok, true);
  assert.strictEqual(invalidation.canceled, 1);
  assert.strictEqual(invalidationRace.dialogContexts[0].signal.aborted, true);
  const invalidatedResult = await invalidationPromise;
  invalidationGate.resolve({ response: 1 });
  assert.strictEqual(invalidatedResult.mode, 'ask_each');
  assert.strictEqual(invalidatedResult.delegated, false);
  assert.strictEqual(invalidationRace.counts().issueCalls, 0);
  const retiredLeaseResult = await invalidationRace.service.ensureTaskDelegation({
    binding: binding(),
    actorId: 'user-a',
    windowLease: invalidatedLease,
  });
  assert.strictEqual(retiredLeaseResult.reason, NATIVE_TASK_CONSENT_REASONS.INVALID_INPUT);

  const cancelGate = deferred();
  const cancelRace = createHarness({ dialog: () => cancelGate.promise });
  const cancelPromise = cancelRace.service.ensureTaskDelegation(ensureInput(cancelRace));
  await until(() => cancelRace.counts().dialogCalls === 1);
  const canceled = cancelRace.service.cancelJob({
    binding: binding(),
    reason: 'job_cancelled',
  });
  assert.strictEqual(canceled.ok, true);
  assert.strictEqual(canceled.canceled, 1);
  assert.strictEqual(cancelRace.dialogContexts[0].signal.aborted, true);
  const canceledResult = await cancelPromise;
  cancelGate.resolve({ response: 1 });
  assert.strictEqual(canceledResult.mode, 'ask_each');
  assert.strictEqual(canceledResult.delegated, false);
  assert.strictEqual(cancelRace.counts().issueCalls, 0);

  const issuanceGate = deferred();
  let fakeActiveDelegation = false;
  let capturedHandle = '';
  let capturedConsent = null;
  let fakeRevokeCalls = 0;
  const issuanceRace = createHarness({
    dialog: () => ({ response: 1 }),
    taskStoreFactory({ trustedConsentAuthority }) {
      return {
        issueFromTrustedConsent({ consentHandle }) {
          issuanceRace.incrementIssueCalls();
          capturedHandle = consentHandle;
          const consumed = trustedConsentAuthority.consume(consentHandle);
          assert.strictEqual(consumed.consumed, true);
          capturedConsent = consumed.consent;
          fakeActiveDelegation = true;
          return issuanceGate.promise;
        },
        revokeBinding() {
          fakeRevokeCalls += 1;
          fakeActiveDelegation = false;
          return { ok: true, revoked: 1 };
        },
        get() {
          return null;
        },
        clear() {
          fakeActiveDelegation = false;
          return { ok: true };
        },
      };
    },
  });
  const issuancePromise = issuanceRace.service.ensureTaskDelegation(ensureInput(issuanceRace));
  await until(() => issuanceRace.counts().issueCalls === 1, 'delegation issue did not start');
  assert(capturedHandle.startsWith('consent_'));
  issuanceRace.service.cancelJob({ binding: binding(), reason: 'job_cancelled' });
  issuanceGate.resolve({
    ok: true,
    issued: true,
    delegation: {
      delegationId: 'delegation-race',
      mode: 'delegate_task',
      status: 'active',
      principal: capturedConsent.principal,
      binding: capturedConsent.binding,
      allowedEffects: capturedConsent.allowedEffects,
      constraints: capturedConsent.constraints,
      issuedAt: 1_000,
      expiresAt: 1_000 + DEFAULT_DELEGATION_TTL_MS,
    },
  });
  const issuanceRaceResult = await issuancePromise;
  assert.strictEqual(issuanceRaceResult.mode, 'ask_each');
  assert.strictEqual(issuanceRaceResult.delegated, false);
  assert.strictEqual(fakeActiveDelegation, false);
  assert(fakeRevokeCalls >= 1);
  assert.strictEqual(issuanceRace.trustedConsentAuthority.diagnostics().records, 0);
  assertPublicEnvelope(issuanceRaceResult);

  const clearGate = deferred();
  const clearRace = createHarness({ dialog: () => clearGate.promise });
  const clearPromise = clearRace.service.ensureTaskDelegation(ensureInput(clearRace));
  await until(() => clearRace.counts().dialogCalls === 1);
  const cleared = clearRace.service.clear();
  assert.strictEqual(cleared.ok, true);
  assert.strictEqual(cleared.canceled, 1);
  assert.strictEqual(clearRace.dialogContexts[0].signal.aborted, true);
  assert.strictEqual((await clearPromise).delegated, false);
  clearGate.resolve({ response: 1 });
  assert.strictEqual(clearRace.counts().issueCalls, 0);
  assert.strictEqual(clearRace.service.diagnostics().pendingDialogs, 0);

  const freshClear = createHarness();
  assert.strictEqual(freshClear.service.clear().ok, true);
  assert.strictEqual(freshClear.service.diagnostics().authorityHealthy, true);
  const deniedThenClear = createHarness({ dialog: () => ({ response: 0 }) });
  assert.strictEqual(
    (await deniedThenClear.service.ensureTaskDelegation(ensureInput(deniedThenClear))).mode,
    'ask_each'
  );
  assert.strictEqual(deniedThenClear.service.clear().ok, true);
  assert.strictEqual(deniedThenClear.service.diagnostics().authorityHealthy, true);

  const capacityGate = deferred();
  const pendingCapacity = createHarness({
    dialog: () => capacityGate.promise,
    maxPendingDialogs: 1,
  });
  const capacityFirst = pendingCapacity.service.ensureTaskDelegation(
    ensureInput(pendingCapacity)
  );
  await until(() => pendingCapacity.counts().dialogCalls === 1);
  const capacitySecond = await pendingCapacity.service.ensureTaskDelegation(
    ensureInput(pendingCapacity, { binding: binding({ jobId: 'job-b' }) })
  );
  assert.strictEqual(capacitySecond.reason, NATIVE_TASK_CONSENT_REASONS.BUSY);
  assert.strictEqual(pendingCapacity.counts().dialogCalls, 1);
  capacityGate.resolve({ response: 0 });
  await capacityFirst;

  const activeCapacity = createHarness({ maxActiveDelegations: 1 });
  assert.strictEqual(
    (await activeCapacity.service.ensureTaskDelegation(ensureInput(activeCapacity))).delegated,
    true
  );
  const activeCapacityDenied = await activeCapacity.service.ensureTaskDelegation(
    ensureInput(activeCapacity, { binding: binding({ jobId: 'job-b' }) })
  );
  assert.strictEqual(activeCapacityDenied.reason, NATIVE_TASK_CONSENT_REASONS.BUSY);
  assert.strictEqual(activeCapacity.counts().dialogCalls, 1);

  let forgedHarness;
  forgedHarness = createHarness({
    taskStoreFactory({ concreteStore }) {
      return {
        async issueFromTrustedConsent(input) {
          forgedHarness.incrementIssueCalls();
          const actual = await concreteStore.issueFromTrustedConsent(input);
          return {
            ...actual,
            delegation: {
              ...actual.delegation,
              binding: binding({ submissionDigest: digest('d') }),
            },
          };
        },
        get: concreteStore.get,
        revokeBinding: concreteStore.revokeBinding,
        clear: concreteStore.clear,
      };
    },
  });
  const forgedResult = await forgedHarness.service.ensureTaskDelegation(ensureInput(forgedHarness));
  assert.strictEqual(forgedResult.mode, 'ask_each');
  assert.strictEqual(forgedResult.delegated, false);
  assert.strictEqual(forgedHarness.service.diagnostics().authorityHealthy, false);
  assert.strictEqual(forgedHarness.concreteStore.list({ jobId: 'job-a' })[0].status, 'revoked');

  let revocationFault;
  revocationFault = createHarness({
    taskStoreFactory({ concreteStore }) {
      return {
        async issueFromTrustedConsent(input) {
          revocationFault.incrementIssueCalls();
          return concreteStore.issueFromTrustedConsent(input);
        },
        get: concreteStore.get,
        revokeBinding() {
          return { ok: false, revoked: 0 };
        },
        clear() {
          return { ok: false, cleared: 0 };
        },
      };
    },
  });
  assert.strictEqual(
    (await revocationFault.service.ensureTaskDelegation(ensureInput(revocationFault))).delegated,
    true
  );
  const failedCancel = revocationFault.service.cancelJob({
    binding: binding(),
    reason: 'fault_injected',
  });
  assert.strictEqual(failedCancel.ok, false);
  assert.strictEqual(revocationFault.service.diagnostics().authorityHealthy, false);
  assert.strictEqual(revocationFault.service.diagnostics().activeDelegations, 1);
  const blockedAfterFault = await revocationFault.service.ensureTaskDelegation(
    ensureInput(revocationFault, { binding: binding({ jobId: 'job-b' }) })
  );
  assert.strictEqual(blockedAfterFault.reason, NATIVE_TASK_CONSENT_REASONS.BUSY);
  assert.strictEqual(revocationFault.counts().dialogCalls, 1);
  assert.strictEqual(revocationFault.service.clear().ok, false);
  assert.strictEqual(revocationFault.service.diagnostics().activeDelegations, 1);

  const handleCleanupFault = createHarness({
    trustedAuthorityFactory(base) {
      return {
        issueFromNativeConfirmation: base.issueFromNativeConfirmation,
        cancel() {
          throw new Error('fault injected cancel');
        },
        cancelWhere() {
          return { ok: false, canceled: 0 };
        },
        clear: base.clear,
      };
    },
  });
  assert.strictEqual(
    (await handleCleanupFault.service.ensureTaskDelegation(ensureInput(handleCleanupFault))).delegated,
    false
  );
  assert.strictEqual(handleCleanupFault.service.diagnostics().authorityHealthy, false);
  const blockedAfterHandleFault = await handleCleanupFault.service.ensureTaskDelegation(
    ensureInput(handleCleanupFault, { binding: binding({ jobId: 'job-b' }) })
  );
  assert.strictEqual(blockedAfterHandleFault.reason, NATIVE_TASK_CONSENT_REASONS.BUSY);
  assert.strictEqual(handleCleanupFault.counts().dialogCalls, 1);

  const hostile = createHarness();
  const hostileInput = {};
  let getterCalled = false;
  Object.defineProperty(hostileInput, 'binding', {
    enumerable: true,
    get() {
      getterCalled = true;
      return binding();
    },
  });
  Object.defineProperty(hostileInput, 'actorId', {
    enumerable: true,
    value: 'user-a',
  });
  Object.defineProperty(hostileInput, 'windowLease', {
    enumerable: true,
    value: hostile.currentLease(),
  });
  const hostileResult = await hostile.service.ensureTaskDelegation(hostileInput);
  assert.strictEqual(hostileResult.reason, NATIVE_TASK_CONSENT_REASONS.INVALID_INPUT);
  assert.strictEqual(getterCalled, false);
  assert.strictEqual(hostile.counts().dialogCalls, 0);

  assert.throws(() => createNativeTaskConsentService({
    showNativeDialog() {},
    trustedConsentAuthority: hostile.trustedConsentAuthority,
    taskDelegationStore: {
      issueFromTrustedConsent: hostile.concreteStore.issueFromTrustedConsent,
      get: hostile.concreteStore.get,
      revokeBinding: hostile.concreteStore.revokeBinding,
      clear: hostile.concreteStore.clear,
    },
    authorizeLifecycle: hostile.lifecycle,
    getWindowLease: hostile.currentLease,
    maxPendingDialogs: 0,
  }), /maxPendingDialogs/);

  const classHarness = createHarness();
  const classService = new NativeTaskConsentService({
    showNativeDialog: () => ({ response: 0 }),
    trustedConsentAuthority: classHarness.trustedConsentAuthority,
    taskDelegationStore: {
      issueFromTrustedConsent: classHarness.concreteStore.issueFromTrustedConsent,
      get: classHarness.concreteStore.get,
      revokeBinding: classHarness.concreteStore.revokeBinding,
      clear: classHarness.concreteStore.clear,
    },
    authorizeLifecycle: classHarness.lifecycle,
    getWindowLease: classHarness.currentLease,
  });
  assert(Object.isFrozen(classService));
  assert.strictEqual(typeof classService.ensureTaskDelegation, 'function');
  assert.strictEqual('consentHandle' in classService, false);

  console.log('native task consent service tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
