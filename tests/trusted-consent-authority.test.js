'use strict';

const assert = require('assert');

const {
  DEFAULT_DELEGATION_TTL_MS,
  MAX_DELEGATION_TTL_MS,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  DEFAULT_CONSENT_HANDLE_TTL_MS,
  DEFAULT_MAX_CONSENT_HANDLE_TTL_MS,
  HARD_MAX_CONSENT_HANDLE_TTL_MS,
  TRUSTED_CONSENT_AUTHORITY_VERSION,
  TRUSTED_CONSENT_REASONS,
  TrustedConsentAuthority,
  createTrustedConsentAuthority,
} = require('../main/capabilities/trusted_consent_authority');
const {
  createTaskDelegationStore,
} = require('../main/capabilities/task_delegation_store');

const digest = (character) => `sha256:${character.repeat(64)}`;
const handle = (character) => `consent_${character.repeat(32)}`;

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

function constraints(overrides = {}) {
  return {
    checkpointRequired: true,
    exactPathsOnly: true,
    rejectProtectedPaths: true,
    maxFilesPerDecision: 2,
    maxBytesPerDecision: 100,
    maxDirectoriesPerDecision: 1,
    maxFilesTotal: 4,
    maxBytesTotal: 200,
    maxDirectoriesTotal: 2,
    ...overrides,
  };
}

function consent(overrides = {}) {
  return {
    mode: 'delegate_task',
    principal: { kind: 'user_ui', actorId: 'user-a' },
    binding: binding(),
    allowedEffects: ['filesystem_delete'],
    constraints: constraints(),
    ttlMs: DEFAULT_DELEGATION_TTL_MS,
    ...overrides,
  };
}

function sequenceHandleFactory(characters) {
  let index = 0;
  return () => handle(characters[index++]);
}

(async () => {
  assert.strictEqual(TRUSTED_CONSENT_AUTHORITY_VERSION, 'trusted-consent-authority.v1');
  assert.strictEqual(DEFAULT_CONSENT_HANDLE_TTL_MS, 60 * 1000);
  assert.strictEqual(DEFAULT_MAX_CONSENT_HANDLE_TTL_MS, 5 * 60 * 1000);
  assert.strictEqual(HARD_MAX_CONSENT_HANDLE_TTL_MS, 10 * 60 * 1000);

  assert.throws(() => createTrustedConsentAuthority({ unknown: true }), /plain data record/);
  assert.throws(() => createTrustedConsentAuthority({ now: true }), /now must be a function/);
  assert.throws(() => createTrustedConsentAuthority({ handleFactory: true }), /handleFactory/);
  assert.throws(() => createTrustedConsentAuthority({ maxRecords: 0 }), /positive safe integer/);
  assert.throws(() => createTrustedConsentAuthority({
    maxHandleTtlMs: HARD_MAX_CONSENT_HANDLE_TTL_MS + 1,
  }), /positive safe integer/);
  assert.throws(() => createTrustedConsentAuthority({
    handleTtlMs: 2,
    maxHandleTtlMs: 1,
  }), /positive safe integer/);
  const optionGetter = {};
  let optionGetterCalled = false;
  Object.defineProperty(optionGetter, 'now', {
    enumerable: true,
    get() {
      optionGetterCalled = true;
      return () => 1_000;
    },
  });
  assert.throws(() => createTrustedConsentAuthority(optionGetter), /plain data record/);
  assert.strictEqual(optionGetterCalled, false);

  const classAuthority = new TrustedConsentAuthority();
  assert(Object.isFrozen(classAuthority));
  assert.strictEqual('proof' in classAuthority, false);
  assert.strictEqual('create' in classAuthority, false);
  assert.strictEqual('issue' in classAuthority, false);
  assert.strictEqual(typeof classAuthority.clear, 'function');
  assert.deepStrictEqual(classAuthority.diagnostics(), {
    version: TRUSTED_CONSENT_AUTHORITY_VERSION,
    records: 0,
    pendingTasks: 0,
    clockHealthy: true,
    handleTtlMs: DEFAULT_CONSENT_HANDLE_TTL_MS,
    maxHandleTtlMs: DEFAULT_MAX_CONSENT_HANDLE_TTL_MS,
    maxRecords: 5_000,
    persistence: 'process_local',
    authorityBoundary: 'main_process_only',
    consumption: 'one_shot',
    nativeConfirmationRequired: true,
  });

  let now = 1_000;
  const authority = createTrustedConsentAuthority({
    now: () => now,
    handleFactory: sequenceHandleFactory(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
    handleTtlMs: 100,
    maxHandleTtlMs: 200,
    maxRecords: 4,
  });
  const issued = authority.issueFromNativeConfirmation(consent({
    binding: binding({ submissionDigest: 'A'.repeat(64) }),
  }));
  assert.deepStrictEqual(Object.keys(issued), [
    'ok',
    'issued',
    'reason',
    'consentHandle',
    'expiresAt',
  ]);
  assert.strictEqual(issued.ok, true);
  assert.strictEqual(issued.issued, true);
  assert.strictEqual(issued.reason, TRUSTED_CONSENT_REASONS.ISSUED);
  assert.strictEqual(issued.consentHandle, handle('a'));
  assert.strictEqual(issued.expiresAt, 1_100);
  assert(Object.isFrozen(issued));
  assert.strictEqual(JSON.stringify(issued).includes('proof'), false);
  assert.strictEqual(JSON.stringify(issued).includes('/workspace'), false);
  assert.strictEqual(JSON.stringify(issued).includes('submissionDigest'), false);

  const inspected = authority.inspect(issued.consentHandle);
  assert.deepStrictEqual(Object.keys(inspected), ['available', 'consent']);
  assert.strictEqual(inspected.available, true);
  assert.strictEqual(inspected.consent.mode, 'delegate_task');
  assert.strictEqual(inspected.consent.binding.submissionDigest, digest('a'));
  assert.strictEqual(inspected.consent.ttlMs, DEFAULT_DELEGATION_TTL_MS);
  assert.deepStrictEqual(inspected.consent.allowedEffects, ['filesystem_delete']);
  assert(Object.isFrozen(inspected));
  assert(Object.isFrozen(inspected.consent));
  assert(Object.isFrozen(inspected.consent.binding));
  assert(Object.isFrozen(inspected.consent.constraints));
  assert.strictEqual('proof' in inspected, false);

  const wrongConsent = consent({ binding: binding({ jobId: 'job-b' }) });
  assert.deepStrictEqual(authority.inspect(issued.consentHandle, wrongConsent), {
    available: false,
    consent: { mode: 'ask_each' },
  });
  assert.strictEqual(authority.inspect(issued.consentHandle).available, true);
  assert.deepStrictEqual(authority.consume(issued.consentHandle, wrongConsent), {
    consumed: false,
    consent: { mode: 'ask_each' },
  });
  assert.strictEqual(authority.inspect(issued.consentHandle).available, true);

  const consumed = authority.consume(issued.consentHandle, consent({
    binding: binding({ submissionDigest: 'A'.repeat(64) }),
  }));
  assert.strictEqual(consumed.consumed, true);
  assert.strictEqual(consumed.consent.binding.jobId, 'job-a');
  assert(Object.isFrozen(consumed));
  assert.deepStrictEqual(authority.consume(issued.consentHandle), {
    consumed: false,
    consent: { mode: 'ask_each' },
  });
  assert.deepStrictEqual(authority.inspect(issued.consentHandle), {
    available: false,
    consent: { mode: 'ask_each' },
  });
  assert.strictEqual(authority.diagnostics().records, 0);

  let reentrantReadAuthority;
  let reentrantReadEnabled = false;
  let reentrantReadActive = false;
  let nestedClockConsumption = null;
  reentrantReadAuthority = createTrustedConsentAuthority({
    now() {
      if (reentrantReadEnabled && !reentrantReadActive) {
        reentrantReadActive = true;
        nestedClockConsumption = reentrantReadAuthority.consume(handle('n'));
        reentrantReadActive = false;
      }
      return 1_250;
    },
    handleFactory: () => handle('n'),
  });
  const reentrantReadIssue = reentrantReadAuthority.issueFromNativeConfirmation(consent());
  reentrantReadEnabled = true;
  const outerClockConsumption = reentrantReadAuthority.consume(reentrantReadIssue.consentHandle);
  assert.strictEqual(nestedClockConsumption.consumed, true);
  assert.strictEqual(outerClockConsumption.consumed, false);
  assert.strictEqual(reentrantReadAuthority.diagnostics().records, 0);

  const expectedReentryAuthority = createTrustedConsentAuthority({
    now: () => 1_300,
    handleFactory: () => handle('p'),
  });
  const expectedReentryIssue = expectedReentryAuthority.issueFromNativeConfirmation(consent());
  let nestedExpectedConsumption = null;
  const reentrantExpectedConsent = new Proxy(consent(), {
    getPrototypeOf(target) {
      nestedExpectedConsumption = expectedReentryAuthority.consume(
        expectedReentryIssue.consentHandle
      );
      return Reflect.getPrototypeOf(target);
    },
  });
  const outerExpectedInspection = expectedReentryAuthority.inspect(
    expectedReentryIssue.consentHandle,
    reentrantExpectedConsent
  );
  assert.strictEqual(nestedExpectedConsumption.consumed, true);
  assert.strictEqual(outerExpectedInspection.available, false);
  assert.strictEqual(expectedReentryAuthority.diagnostics().records, 0);

  const cancelIssue = authority.issueFromNativeConfirmation(consent());
  assert.strictEqual(cancelIssue.consentHandle, handle('b'));
  assert.deepStrictEqual(authority.cancel(cancelIssue.consentHandle), {
    ok: true,
    canceled: true,
    reason: TRUSTED_CONSENT_REASONS.CANCELED,
  });
  assert.deepStrictEqual(authority.cancel(cancelIssue.consentHandle), {
    ok: false,
    canceled: false,
    reason: TRUSTED_CONSENT_REASONS.NOT_FOUND,
  });
  assert.strictEqual(authority.consume(cancelIssue.consentHandle).consumed, false);

  const clearIssueOne = authority.issueFromNativeConfirmation(consent());
  const clearIssueTwo = authority.issueFromNativeConfirmation(consent({
    binding: binding({ jobId: 'job-clear-two' }),
  }));
  assert.strictEqual(clearIssueOne.issued, true);
  assert.strictEqual(clearIssueTwo.issued, true);
  assert.deepStrictEqual(authority.clear(), { ok: true, cleared: 2 });
  assert.deepStrictEqual(authority.clear(), { ok: true, cleared: 0 });
  assert.strictEqual(authority.consume(clearIssueOne.consentHandle).consumed, false);
  assert.strictEqual(authority.inspect(clearIssueTwo.consentHandle).available, false);

  const replacementAuthority = createTrustedConsentAuthority({
    now: () => 1_400,
    handleFactory: sequenceHandleFactory(['s', 't', 'u']),
  });
  const stalePendingHandle = replacementAuthority.issueFromNativeConfirmation(consent());
  const replacementHandle = replacementAuthority.issueFromNativeConfirmation(consent());
  assert.strictEqual(stalePendingHandle.issued, true);
  assert.strictEqual(replacementHandle.issued, true);
  assert.notStrictEqual(stalePendingHandle.consentHandle, replacementHandle.consentHandle);
  assert.strictEqual(
    replacementAuthority.inspect(stalePendingHandle.consentHandle).available,
    false
  );
  assert.strictEqual(replacementAuthority.inspect(replacementHandle.consentHandle).available, true);
  assert.strictEqual(replacementAuthority.diagnostics().records, 1);
  assert.strictEqual(replacementAuthority.diagnostics().pendingTasks, 1);
  assert.deepStrictEqual(replacementAuthority.cancelWhere({ jobId: 'job-b' }), {
    ok: true,
    canceled: 0,
  });
  assert.strictEqual(replacementAuthority.inspect(replacementHandle.consentHandle).available, true);
  assert.deepStrictEqual(replacementAuthority.cancelWhere({
    projectId: 'project-a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'kernel-a',
  }), { ok: true, canceled: 1 });
  assert.strictEqual(replacementAuthority.inspect(replacementHandle.consentHandle).available, false);
  assert.strictEqual(replacementAuthority.diagnostics().pendingTasks, 0);
  assert.deepStrictEqual(replacementAuthority.cancelWhere({}), { ok: false, canceled: 0 });
  assert.deepStrictEqual(
    replacementAuthority.cancelWhere({ jobId: 'job-a', proof: true }),
    { ok: false, canceled: 0 }
  );

  let clearDuringIssueAuthority;
  clearDuringIssueAuthority = createTrustedConsentAuthority({
    now: () => 1_450,
    handleFactory() {
      clearDuringIssueAuthority.clear();
      return handle('v');
    },
  });
  const clearedDuringIssue = clearDuringIssueAuthority.issueFromNativeConfirmation(consent());
  assert.strictEqual(clearedDuringIssue.issued, false);
  assert.strictEqual(
    clearedDuringIssue.reason,
    TRUSTED_CONSENT_REASONS.LIFECYCLE_INVALIDATED
  );
  assert.strictEqual(clearDuringIssueAuthority.diagnostics().records, 0);

  let cancelDuringIssueAuthority;
  cancelDuringIssueAuthority = createTrustedConsentAuthority({
    now: () => 1_500,
    handleFactory() {
      cancelDuringIssueAuthority.cancelWhere({ jobId: 'job-a' });
      return handle('w');
    },
  });
  const canceledDuringIssue = cancelDuringIssueAuthority.issueFromNativeConfirmation(consent());
  assert.strictEqual(canceledDuringIssue.issued, false);
  assert.strictEqual(
    canceledDuringIssue.reason,
    TRUSTED_CONSENT_REASONS.LIFECYCLE_INVALIDATED
  );
  assert.strictEqual(cancelDuringIssueAuthority.diagnostics().records, 0);

  let cancelDuringNormalizeAuthority;
  cancelDuringNormalizeAuthority = createTrustedConsentAuthority({
    now: () => 1_525,
    handleFactory: () => handle('l'),
  });
  const cancelDuringNormalizeConsent = new Proxy(consent(), {
    getPrototypeOf(target) {
      cancelDuringNormalizeAuthority.cancelWhere({ jobId: 'job-a' });
      return Reflect.getPrototypeOf(target);
    },
  });
  const canceledDuringNormalize = cancelDuringNormalizeAuthority.issueFromNativeConfirmation(
    cancelDuringNormalizeConsent
  );
  assert.strictEqual(canceledDuringNormalize.issued, false);
  assert.strictEqual(
    canceledDuringNormalize.reason,
    TRUSTED_CONSENT_REASONS.LIFECYCLE_INVALIDATED
  );
  assert.strictEqual(cancelDuringNormalizeAuthority.diagnostics().records, 0);

  let unrelatedCancelAuthority;
  unrelatedCancelAuthority = createTrustedConsentAuthority({
    now: () => 1_550,
    handleFactory() {
      unrelatedCancelAuthority.cancelWhere({ jobId: 'job-b' });
      return handle('y');
    },
  });
  const unrelatedCancellation = unrelatedCancelAuthority.issueFromNativeConfirmation(consent());
  assert.strictEqual(unrelatedCancellation.issued, true);
  assert.strictEqual(unrelatedCancelAuthority.inspect(unrelatedCancellation.consentHandle).available, true);

  let clockHealthy = true;
  const cancelWithBrokenClock = createTrustedConsentAuthority({
    now: () => (clockHealthy ? 1_500 : Number.NaN),
    handleFactory: () => handle('q'),
  });
  const clockHandle = cancelWithBrokenClock.issueFromNativeConfirmation(consent());
  clockHealthy = false;
  assert.strictEqual(cancelWithBrokenClock.consume(clockHandle.consentHandle).consumed, false);
  assert.strictEqual(cancelWithBrokenClock.cancel(clockHandle.consentHandle).canceled, false);
  clockHealthy = true;
  assert.strictEqual(cancelWithBrokenClock.inspect(clockHandle.consentHandle).available, false);
  assert.strictEqual(cancelWithBrokenClock.issueFromNativeConfirmation(consent()).issued, false);
  assert.strictEqual(cancelWithBrokenClock.diagnostics().clockHealthy, false);

  let rollbackNow = 1_600;
  const rollbackClock = createTrustedConsentAuthority({
    now: () => rollbackNow,
    handleFactory: () => handle('o'),
  });
  const rollbackHandle = rollbackClock.issueFromNativeConfirmation(consent());
  rollbackNow -= 1;
  assert.strictEqual(rollbackClock.inspect(rollbackHandle.consentHandle).available, false);
  assert.strictEqual(rollbackClock.consume(rollbackHandle.consentHandle).consumed, false);
  rollbackNow += 1;
  assert.strictEqual(rollbackClock.inspect(rollbackHandle.consentHandle).available, false);
  assert.strictEqual(rollbackClock.cancel(rollbackHandle.consentHandle).canceled, false);
  assert.strictEqual(rollbackClock.issueFromNativeConfirmation(consent()).issued, false);
  assert.strictEqual(rollbackClock.diagnostics().clockHealthy, false);

  const expiring = authority.issueFromNativeConfirmation(consent());
  now = expiring.expiresAt;
  assert.strictEqual(authority.inspect(expiring.consentHandle).available, false);
  assert.strictEqual(authority.consume(expiring.consentHandle).consumed, false);

  now = 2_000;
  const firstPurge = authority.issueFromNativeConfirmation(consent());
  const secondPurge = authority.issueFromNativeConfirmation(consent({
    binding: binding({ jobId: 'job-b' }),
  }));
  assert.strictEqual(authority.diagnostics().records, 2);
  now = firstPurge.expiresAt;
  assert.deepStrictEqual(authority.purge(), { ok: true, purged: 2, remaining: 0 });
  assert.deepStrictEqual(authority.purge({ expired: true }), {
    ok: false,
    purged: 0,
    remaining: 0,
  });
  assert.strictEqual(secondPurge.expiresAt, firstPurge.expiresAt);

  now = 3_000;
  const capacity = createTrustedConsentAuthority({
    now: () => now,
    handleFactory: sequenceHandleFactory(['f', 'g', 'h']),
    handleTtlMs: 10,
    maxHandleTtlMs: 10,
    maxRecords: 1,
  });
  const capacityFirst = capacity.issueFromNativeConfirmation(consent());
  const capacityDenied = capacity.issueFromNativeConfirmation(consent({
    binding: binding({ jobId: 'job-b' }),
  }));
  assert.strictEqual(capacityDenied.reason, TRUSTED_CONSENT_REASONS.CAPACITY_EXCEEDED);
  assert.strictEqual(capacityDenied.consentHandle, null);
  now = capacityFirst.expiresAt;
  const capacityRecovered = capacity.issueFromNativeConfirmation(consent({
    binding: binding({ jobId: 'job-b' }),
  }));
  assert.strictEqual(capacityRecovered.issued, true);
  assert.strictEqual(capacityRecovered.consentHandle, handle('g'));

  const collision = createTrustedConsentAuthority({
    now: () => 4_000,
    handleFactory: () => handle('z'),
    maxRecords: 2,
  });
  assert.strictEqual(collision.issueFromNativeConfirmation(consent()).issued, true);
  const collided = collision.issueFromNativeConfirmation(consent({
    binding: binding({ jobId: 'job-b' }),
  }));
  assert.strictEqual(collided.reason, TRUSTED_CONSENT_REASONS.HANDLE_COLLISION);
  assert.strictEqual(collision.diagnostics().records, 1);

  const invalidFactory = createTrustedConsentAuthority({
    now: () => 5_000,
    handleFactory: () => 'renderer-chosen-handle',
  });
  assert.strictEqual(
    invalidFactory.issueFromNativeConfirmation(consent()).reason,
    TRUSTED_CONSENT_REASONS.INVALID_INPUT
  );

  let reentrantAuthority;
  let nestedIssuance;
  reentrantAuthority = createTrustedConsentAuthority({
    now: () => 6_000,
    handleFactory() {
      nestedIssuance = reentrantAuthority.issueFromNativeConfirmation(consent({
        binding: binding({ jobId: 'nested-job' }),
      }));
      return handle('r');
    },
  });
  const outerIssuance = reentrantAuthority.issueFromNativeConfirmation(consent());
  assert.strictEqual(outerIssuance.issued, true);
  assert.strictEqual(nestedIssuance.reason, TRUSTED_CONSENT_REASONS.REENTRANT_ISSUANCE);
  assert.strictEqual(reentrantAuthority.diagnostics().records, 1);

  const hostileAuthority = createTrustedConsentAuthority({
    now: () => 7_000,
    handleFactory: () => handle('x'),
  });
  const invalidInputs = [
    true,
    null,
    { ...consent(), confirmed: true },
    { ...consent(), ttlMs: undefined },
    { ...consent(), ttlMs: -0 },
    { ...consent(), ttlMs: MAX_DELEGATION_TTL_MS + 1 },
    { ...consent(), mode: 'ask_each' },
    { ...consent(), mode: 'delegate_conversation' },
    { ...consent(), principal: { kind: 'agent', actorId: 'agent-a' } },
    { ...consent(), allowedEffects: ['filesystem_write'] },
    { ...consent(), allowedEffects: new Array(1) },
    { ...consent(), constraints: constraints({ checkpointRequired: false }) },
    Object.assign(Object.create({ inherited: true }), consent()),
    { ...consent(), [Symbol('proof')]: true },
    JSON.parse(`{"mode":"delegate_task","principal":{"kind":"user_ui","actorId":"user-a"},"binding":{"projectId":"project-a","canonicalRootPath":"/workspace/project-a","realRootPath":"/real/workspace/project-a","sessionId":"session-a","jobId":"job-a","kernelId":"kernel-a","submissionDigest":"${digest('a')}"},"allowedEffects":["filesystem_delete"],"constraints":{"checkpointRequired":true,"exactPathsOnly":true,"rejectProtectedPaths":true,"maxFilesPerDecision":2,"maxBytesPerDecision":100,"maxDirectoriesPerDecision":1,"maxFilesTotal":4,"maxBytesTotal":200,"maxDirectoriesTotal":2,"__proto__":{"polluted":true}},"ttlMs":${DEFAULT_DELEGATION_TTL_MS}}`),
  ];
  const cyclic = consent();
  cyclic.binding.loop = cyclic;
  invalidInputs.push(cyclic);
  const topLevelGetter = {};
  let topLevelGetterCalled = false;
  Object.defineProperty(topLevelGetter, 'mode', {
    enumerable: true,
    get() {
      topLevelGetterCalled = true;
      return 'delegate_task';
    },
  });
  invalidInputs.push(topLevelGetter);
  const getterConsent = consent();
  const hostilePrincipal = {};
  let nestedGetterCalled = false;
  Object.defineProperty(hostilePrincipal, 'kind', {
    enumerable: true,
    get() {
      nestedGetterCalled = true;
      return 'user_ui';
    },
  });
  getterConsent.principal = hostilePrincipal;
  invalidInputs.push(getterConsent);
  for (const invalidInput of invalidInputs) {
    const result = hostileAuthority.issueFromNativeConfirmation(invalidInput);
    assert.strictEqual(result.issued, false);
    assert.strictEqual(result.reason, TRUSTED_CONSENT_REASONS.INVALID_INPUT);
  }
  assert.strictEqual(topLevelGetterCalled, false);
  assert.strictEqual(nestedGetterCalled, false);
  assert.strictEqual(hostileAuthority.diagnostics().records, 0);

  const expectedGetter = {};
  let expectedGetterCalled = false;
  Object.defineProperty(expectedGetter, 'mode', {
    enumerable: true,
    get() {
      expectedGetterCalled = true;
      return 'delegate_task';
    },
  });
  const expectedHarness = createTrustedConsentAuthority({
    now: () => 8_000,
    handleFactory: () => handle('e'),
  });
  const expectedIssue = expectedHarness.issueFromNativeConfirmation(consent());
  assert.strictEqual(expectedHarness.inspect(expectedIssue.consentHandle, expectedGetter).available, false);
  assert.strictEqual(expectedGetterCalled, false);
  assert.strictEqual(expectedHarness.inspect(expectedIssue.consentHandle).available, true);

  const integrationAuthority = createTrustedConsentAuthority({
    now: () => 9_000,
    handleFactory: () => handle('i'),
  });
  const integrationConsent = integrationAuthority.issueFromNativeConfirmation(consent());
  const delegationStore = createTaskDelegationStore({
    now: () => 9_000,
    consentAuthority: integrationAuthority,
    authorizeRoot({ projectId }) {
      return {
        authorized: projectId === 'project-a',
        projectId,
        canonicalRootPath: '/workspace/project-a',
        realRootPath: '/real/workspace/project-a',
      };
    },
    authorizeLifecycle(authorizedBinding) {
      return { authorized: true, binding: authorizedBinding };
    },
    delegationIdFactory: () => 'delegation-integration',
    decisionIdFactory: () => 'decision-integration',
  });
  const delegated = await delegationStore.issueFromTrustedConsent({
    consentHandle: integrationConsent.consentHandle,
  });
  assert.strictEqual(delegated.ok, true);
  assert.strictEqual(delegated.issued, true);
  assert.strictEqual(delegated.delegation.binding.jobId, 'job-a');
  assert.strictEqual(integrationAuthority.inspect(integrationConsent.consentHandle).available, false);

  const randomAuthority = createTrustedConsentAuthority({ now: () => 10_000 });
  const randomOne = randomAuthority.issueFromNativeConfirmation(consent());
  const randomTwo = randomAuthority.issueFromNativeConfirmation(consent({
    binding: binding({ jobId: 'job-random-two' }),
  }));
  assert.match(randomOne.consentHandle, /^consent_[A-Za-z0-9_-]{43}$/);
  assert.match(randomTwo.consentHandle, /^consent_[A-Za-z0-9_-]{43}$/);
  assert.notStrictEqual(randomOne.consentHandle, randomTwo.consentHandle);

  console.log('trusted consent authority tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
