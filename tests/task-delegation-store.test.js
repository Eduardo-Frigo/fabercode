'use strict';

const assert = require('assert');

const {
  DEFAULT_DELEGATION_TTL_MS,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  TASK_DELEGATION_REASONS,
  TaskDelegationStore,
  createTaskDelegationStore,
} = require('../main/capabilities/task_delegation_store');

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

function constraints(overrides = {}) {
  return {
    checkpointRequired: true,
    exactPathsOnly: true,
    rejectProtectedPaths: true,
    maxFilesPerDecision: 2,
    maxBytesPerDecision: 100,
    maxDirectoriesPerDecision: 1,
    maxFilesTotal: 3,
    maxBytesTotal: 180,
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

function decisionRequest({
  taskBinding = binding(),
  request = '1',
  impact = '2',
  checkpoint = '3',
  files = 1,
  bytes = 10,
  directories = 0,
  consumable = true,
} = {}) {
  return {
    binding: taskBinding,
    effect: 'filesystem_delete',
    requestDigest: digest(request),
    impactDigest: digest(impact),
    ...(consumable ? {
      checkpointDigest: digest(checkpoint),
      checkpointVerified: true,
      exactPathsVerified: true,
      protectedPathsRejected: true,
    } : {}),
    impact: { files, bytes, directories },
  };
}

function lifecycleKey(taskBinding) {
  return [
    taskBinding.projectId,
    taskBinding.canonicalRootPath,
    taskBinding.realRootPath,
    taskBinding.sessionId,
    taskBinding.jobId,
    taskBinding.kernelId,
    taskBinding.submissionDigest,
  ].join('\u001f');
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

function createConsentAuthority() {
  const records = new Map();
  const inspectCalls = new Map();
  const consumeCalls = new Map();
  let onInspect = null;
  let onConsume = null;
  return {
    add(handle, value) {
      records.set(handle, { consent: value, consumed: false });
    },
    counts(handle) {
      return {
        inspect: inspectCalls.get(handle) || 0,
        consume: consumeCalls.get(handle) || 0,
      };
    },
    setOnConsume(callback) {
      onConsume = callback;
    },
    setOnInspect(callback) {
      onInspect = callback;
    },
    cancel(handle) {
      if (!records.has(handle)) {
        return Object.freeze({ ok: false, canceled: false });
      }
      records.delete(handle);
      return Object.freeze({ ok: true, canceled: true });
    },
    cancelWhere(filters) {
      let canceled = 0;
      for (const [handle, record] of records) {
        const taskBinding = record.consent && record.consent.binding;
        if (!taskBinding) continue;
        if (Object.entries(filters).some(([field, value]) => taskBinding[field] !== value)) continue;
        records.delete(handle);
        canceled += 1;
      }
      return Object.freeze({ ok: true, canceled });
    },
    clear() {
      const cleared = records.size;
      records.clear();
      return Object.freeze({ ok: true, cleared });
    },
    async inspect(handle) {
      inspectCalls.set(handle, (inspectCalls.get(handle) || 0) + 1);
      if (onInspect) await onInspect(handle);
      const record = records.get(handle);
      if (!record || record.consumed) return { available: false, consent: { mode: 'ask_each' } };
      return { available: true, consent: record.consent };
    },
    async consume(handle) {
      consumeCalls.set(handle, (consumeCalls.get(handle) || 0) + 1);
      const record = records.get(handle);
      if (!record || record.consumed) return { consumed: false, consent: { mode: 'ask_each' } };
      record.consumed = true;
      if (onConsume) await onConsume(handle);
      return { consumed: true, consent: record.consent };
    },
  };
}

function createLifecycleAuthority() {
  const denied = new Set();
  let onAuthorize = null;
  let calls = 0;
  return {
    authorize(taskBinding) {
      calls += 1;
      if (onAuthorize) onAuthorize(taskBinding);
      if (denied.has(lifecycleKey(taskBinding))) return { authorized: false, binding: taskBinding };
      return { authorized: true, binding: taskBinding };
    },
    calls() { return calls; },
    setAuthorized(taskBinding, authorized) {
      const key = lifecycleKey(taskBinding);
      if (authorized) denied.delete(key);
      else denied.add(key);
    },
    setOnAuthorize(callback) { onAuthorize = callback; },
  };
}

function createRootAuthority(entries = [binding()]) {
  const roots = new Map(entries.map((entry) => [entry.projectId, {
    canonicalRootPath: entry.canonicalRootPath,
    realRootPath: entry.realRootPath,
  }]));
  let enabled = true;
  let calls = 0;
  let onAuthorize = null;
  return {
    authorize({ projectId }) {
      calls += 1;
      const root = roots.get(projectId);
      if (!enabled || !root) return { authorized: false };
      if (onAuthorize) onAuthorize();
      return { authorized: true, projectId, ...root };
    },
    calls() { return calls; },
    setOnAuthorize(callback) { onAuthorize = callback; },
    setEnabled(value) { enabled = value; },
  };
}

function createHarness({
  now = () => 1_000,
  roots = createRootAuthority(),
  authority = createConsentAuthority(),
  lifecycle = createLifecycleAuthority(),
  maxRecords,
  maxDecisionRecords,
  maxInFlightIssuances,
  delegationIdFactory,
  decisionIdFactory,
} = {}) {
  let delegationSequence = 0;
  let decisionSequence = 0;
  const store = createTaskDelegationStore({
    now,
    consentAuthority: authority,
    authorizeRoot: roots.authorize,
    authorizeLifecycle: lifecycle.authorize,
    delegationIdFactory: delegationIdFactory || (() => `delegation-${++delegationSequence}`),
    decisionIdFactory: decisionIdFactory || (() => `decision-${++decisionSequence}`),
    ...(maxRecords === undefined ? {} : { maxRecords }),
    ...(maxDecisionRecords === undefined ? {} : { maxDecisionRecords }),
    ...(maxInFlightIssuances === undefined ? {} : { maxInFlightIssuances }),
  });
  return { authority, lifecycle, roots, store };
}

(async () => {
  assert.throws(() => createTaskDelegationStore({
    consentAuthority: { consume() {} },
    authorizeRoot() {},
  }), /inspect, consume, cancel, cancelWhere and clear/);
  const constructorAuthority = {
    inspect() {},
    consume() {},
    cancel() {},
    cancelWhere() {},
    clear() {},
  };
  assert.throws(() => createTaskDelegationStore({
    consentAuthority: constructorAuthority,
  }), /authorizeRoot/);
  assert.throws(() => createTaskDelegationStore({
    consentAuthority: constructorAuthority,
    authorizeRoot() {},
  }), /authorizeLifecycle/);
  assert.throws(() => createTaskDelegationStore({
    consentAuthority: constructorAuthority,
    authorizeRoot() {},
    authorizeLifecycle() {},
    maxInFlightIssuances: 1_025,
  }), /maxInFlightIssuances/);
  const classHarness = createHarness();
  const classStore = new TaskDelegationStore({
    consentAuthority: classHarness.authority,
    authorizeRoot: classHarness.roots.authorize,
    authorizeLifecycle: classHarness.lifecycle.authorize,
  });
  assert(Object.isFrozen(classStore));
  assert.strictEqual('getDecision' in classStore, false);
  assert.strictEqual(classStore.diagnostics().authorityBoundary, 'main_process_only');
  assert.strictEqual(classStore.diagnostics().persistence, 'process_local');
  assert.strictEqual(classStore.diagnostics().maxInFlightIssuances, 64);

  const invalidHarness = createHarness();
  invalidHarness.authority.add('invalid-input', consent());
  const invalid = await invalidHarness.store.issueFromTrustedConsent({
    consentHandle: 'invalid-input',
    authorized: true,
  });
  assert.strictEqual(invalid.reason, TASK_DELEGATION_REASONS.CONSENT_INVALID);
  assert.deepStrictEqual(invalidHarness.authority.counts('invalid-input'), { inspect: 0, consume: 0 });
  assert.strictEqual((await invalidHarness.store.issueFromTrustedConsent(true)).issued, false);
  const handleGetter = {};
  Object.defineProperty(handleGetter, 'consentHandle', {
    enumerable: true,
    get() { throw new Error('must not execute renderer getter'); },
  });
  assert.strictEqual((await invalidHarness.store.issueFromTrustedConsent(handleGetter)).issued, false);

  const contradictoryRootHarness = createHarness({
    roots: {
      authorize({ projectId }) {
        return {
          ok: true,
          authorized: false,
          projectId,
          canonicalRootPath: binding().canonicalRootPath,
          realRootPath: binding().realRootPath,
        };
      },
    },
  });
  contradictoryRootHarness.authority.add('contradictory-root', consent());
  const contradictoryRoot = await contradictoryRootHarness.store.issueFromTrustedConsent({
    consentHandle: 'contradictory-root',
  });
  assert.strictEqual(contradictoryRoot.issued, false);

  invalidHarness.authority.add('ask', { mode: 'ask_each' });
  const ask = await invalidHarness.store.issueFromTrustedConsent({ consentHandle: 'ask' });
  assert.strictEqual(ask.ok, true);
  assert.strictEqual(ask.issued, false);
  assert.strictEqual(ask.reason, TASK_DELEGATION_REASONS.ASK_EACH_SELECTED);
  assert.deepStrictEqual(invalidHarness.authority.counts('ask'), { inspect: 1, consume: 0 });

  const deniedRoots = createRootAuthority();
  deniedRoots.setEnabled(false);
  const deniedHarness = createHarness({ roots: deniedRoots });
  deniedHarness.authority.add('denied-root', consent());
  const deniedRoot = await deniedHarness.store.issueFromTrustedConsent({ consentHandle: 'denied-root' });
  assert.strictEqual(deniedRoot.reason, TASK_DELEGATION_REASONS.CONTEXT_MISMATCH);
  assert.deepStrictEqual(deniedHarness.authority.counts('denied-root'), { inspect: 1, consume: 0 });

  const wrongRealRootHarness = createHarness();
  wrongRealRootHarness.authority.add('wrong-real-root', consent({
    binding: binding({ realRootPath: '/real/workspace/another-project' }),
  }));
  const wrongRealRoot = await wrongRealRootHarness.store.issueFromTrustedConsent({
    consentHandle: 'wrong-real-root',
  });
  assert.strictEqual(wrongRealRoot.reason, TASK_DELEGATION_REASONS.CONTEXT_MISMATCH);
  assert.deepStrictEqual(wrongRealRootHarness.authority.counts('wrong-real-root'), {
    inspect: 1,
    consume: 0,
  });

  const harness = createHarness();
  harness.authority.add('trusted-ui-handle', consent());
  const issued = await harness.store.issueFromTrustedConsent({ consentHandle: 'trusted-ui-handle' });
  assert.strictEqual(issued.ok, true);
  assert.strictEqual(issued.issued, true);
  assert(Object.isFrozen(issued.delegation));
  assert.deepStrictEqual(harness.authority.counts('trusted-ui-handle'), { inspect: 1, consume: 1 });
  assert(harness.roots.calls() >= 2, 'root must be authorized before and after consent consumption');
  const issueAudit = JSON.stringify(issued.audit);
  assert.strictEqual(issueAudit.includes('/workspace'), false);
  assert.strictEqual(issueAudit.includes('sha256:'), false);
  assert.strictEqual(issueAudit.includes('trusted-ui-handle'), false);

  const inspection = harness.store.inspectDecision(decisionRequest({ consumable: false }));
  assert.strictEqual(inspection.authorized, true);
  assert.strictEqual(inspection.delegation.consumedFiles, 0);
  assert.strictEqual(harness.store.get(issued.delegation.delegationId).decisionCount, 0);
  const missingCheckpoint = harness.store.consumeDecision(decisionRequest({ consumable: false }));
  assert.strictEqual(missingCheckpoint.reason, TASK_DELEGATION_REASONS.CHECKPOINT_REQUIRED);
  assert.strictEqual(harness.store.get(issued.delegation.delegationId).decisionCount, 0);

  const overDecision = harness.store.consumeDecision(decisionRequest({
    request: '4', impact: '5', checkpoint: '6', files: 3,
  }));
  assert.strictEqual(overDecision.reason, TASK_DELEGATION_REASONS.PER_DECISION_BUDGET_EXCEEDED);
  assert.strictEqual(harness.store.get(issued.delegation.delegationId).consumedFiles, 0);

  const firstRequest = decisionRequest();
  const first = harness.store.consumeDecision(firstRequest);
  assert.strictEqual(first.authorized, true);
  assert.strictEqual(first.delegation.consumedFiles, 1);
  assert(Object.isFrozen(first.decision));
  const decisionAudit = JSON.stringify(first.audit);
  assert.strictEqual(decisionAudit.includes('/workspace'), false);
  assert.strictEqual(decisionAudit.includes(firstRequest.requestDigest), false);
  assert.strictEqual(decisionAudit.includes(firstRequest.impactDigest), false);
  assert.strictEqual(decisionAudit.includes(firstRequest.checkpointDigest), false);

  const replay = harness.store.consumeDecision(decisionRequest({
    request: '1', impact: '7', checkpoint: '8', bytes: 11,
  }));
  assert.strictEqual(replay.reason, TASK_DELEGATION_REASONS.DECISION_REPLAYED);
  assert.strictEqual(harness.store.get(issued.delegation.delegationId).decisionCount, 1);
  const second = harness.store.consumeDecision(decisionRequest({
    request: '4', impact: '5', checkpoint: '6', files: 2, bytes: 20,
  }));
  assert.strictEqual(second.authorized, true);
  const cumulative = harness.store.consumeDecision(decisionRequest({
    request: '7', impact: '8', checkpoint: '9', files: 1,
  }));
  assert.strictEqual(cumulative.reason, TASK_DELEGATION_REASONS.TASK_BUDGET_EXCEEDED);
  assert.strictEqual(harness.store.get(issued.delegation.delegationId).consumedFiles, 3);

  const mismatch = harness.store.inspectDecision(decisionRequest({
    taskBinding: binding({ sessionId: 'other-session' }),
    request: 'a', impact: 'b', checkpoint: 'c', consumable: false,
  }));
  assert.strictEqual(mismatch.reason, TASK_DELEGATION_REASONS.NOT_FOUND);

  const reauthAuthority = createConsentAuthority();
  const reauthRoots = createRootAuthority();
  const reauthHarness = createHarness({ authority: reauthAuthority, roots: reauthRoots });
  reauthAuthority.add('reauth', consent());
  reauthAuthority.setOnConsume(() => reauthRoots.setEnabled(false));
  const reauthFailure = await reauthHarness.store.issueFromTrustedConsent({ consentHandle: 'reauth' });
  assert.strictEqual(reauthFailure.reason, TASK_DELEGATION_REASONS.CONTEXT_MISMATCH);
  assert.deepStrictEqual(reauthAuthority.counts('reauth'), { inspect: 1, consume: 1 });
  assert.strictEqual(reauthHarness.store.diagnostics().delegations, 0);

  const selectiveBindingA = binding();
  const selectiveBindingB = binding({
    projectId: 'project-b',
    canonicalRootPath: '/workspace/project-b',
    realRootPath: '/real/workspace/project-b',
    sessionId: 'session-b',
    jobId: 'job-b',
    kernelId: 'kernel-b',
    submissionDigest: digest('b'),
  });
  const selectiveAuthority = createConsentAuthority();
  const selectiveHarness = createHarness({
    authority: selectiveAuthority,
    roots: createRootAuthority([selectiveBindingA, selectiveBindingB]),
  });
  const selectiveAEntered = deferred();
  const selectiveBEntered = deferred();
  const selectiveARelease = deferred();
  const selectiveBRelease = deferred();
  selectiveAuthority.setOnConsume(async (handle) => {
    if (handle === 'selective-a') {
      selectiveAEntered.resolve();
      await selectiveARelease.promise;
    }
    if (handle === 'selective-b') {
      selectiveBEntered.resolve();
      await selectiveBRelease.promise;
    }
  });
  selectiveAuthority.add('selective-a', consent({ binding: selectiveBindingA }));
  selectiveAuthority.add('selective-b', consent({ binding: selectiveBindingB }));
  const selectiveAIssue = selectiveHarness.store.issueFromTrustedConsent({
    consentHandle: 'selective-a',
  });
  const selectiveBIssue = selectiveHarness.store.issueFromTrustedConsent({
    consentHandle: 'selective-b',
  });
  await Promise.all([selectiveAEntered.promise, selectiveBEntered.promise]);
  assert.strictEqual(selectiveHarness.store.diagnostics().inFlightIssuances, 2);
  const selectiveRevocation = selectiveHarness.store.revokeBinding(selectiveBindingA, {
    reason: 'job_cancelled',
  });
  assert.strictEqual(selectiveRevocation.ok, true);
  assert.strictEqual(selectiveRevocation.invalidatedIssuances, 1);
  selectiveARelease.resolve();
  selectiveBRelease.resolve();
  const [selectiveAResult, selectiveBResult] = await Promise.all([
    selectiveAIssue,
    selectiveBIssue,
  ]);
  assert.strictEqual(selectiveAResult.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.strictEqual(selectiveBResult.issued, true);
  assert.strictEqual(selectiveHarness.store.diagnostics().inFlightIssuances, 0);

  const duplicateHandleHarness = createHarness();
  duplicateHandleHarness.authority.add('duplicate-h1', consent());
  const duplicateH1 = await duplicateHandleHarness.store.issueFromTrustedConsent({
    consentHandle: 'duplicate-h1',
  });
  duplicateHandleHarness.authority.add('duplicate-h2', consent());
  const duplicateH2 = await duplicateHandleHarness.store.issueFromTrustedConsent({
    consentHandle: 'duplicate-h2',
  });
  assert.strictEqual(duplicateH2.reason, TASK_DELEGATION_REASONS.TASK_ALREADY_DELEGATED);
  assert.deepStrictEqual(duplicateHandleHarness.authority.counts('duplicate-h2'), {
    inspect: 1,
    consume: 0,
  });
  assert.strictEqual(duplicateHandleHarness.store.revoke(
    duplicateH1.delegation.delegationId,
    { reason: 'job_cancelled' }
  ).revoked, true);
  const duplicateH2Resurrection = await duplicateHandleHarness.store.issueFromTrustedConsent({
    consentHandle: 'duplicate-h2',
  });
  assert.strictEqual(duplicateH2Resurrection.issued, false);
  assert.strictEqual(duplicateH2Resurrection.reason, TASK_DELEGATION_REASONS.CONSENT_INVALID);
  assert.deepStrictEqual(duplicateHandleHarness.authority.counts('duplicate-h2'), {
    inspect: 2,
    consume: 0,
  });

  const inspectFenceAuthority = createConsentAuthority();
  const inspectFenceLifecycle = createLifecycleAuthority();
  const inspectFenceHarness = createHarness({
    authority: inspectFenceAuthority,
    lifecycle: inspectFenceLifecycle,
  });
  const inspectEntered = deferred();
  const inspectRelease = deferred();
  inspectFenceAuthority.setOnInspect(async (handle) => {
    if (handle !== 'inspect-fence') return;
    inspectEntered.resolve();
    await inspectRelease.promise;
  });
  inspectFenceAuthority.add('inspect-fence', consent());
  const inspectFenceIssue = inspectFenceHarness.store.issueFromTrustedConsent({
    consentHandle: 'inspect-fence',
  });
  await inspectEntered.promise;
  inspectFenceLifecycle.setAuthorized(binding(), false);
  inspectRelease.resolve();
  const inspectFenceResult = await inspectFenceIssue;
  assert.strictEqual(inspectFenceResult.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.deepStrictEqual(inspectFenceAuthority.counts('inspect-fence'), { inspect: 1, consume: 0 });
  assert.strictEqual(inspectFenceHarness.store.diagnostics().inFlightIssuances, 0);

  const terminalLifecycle = createLifecycleAuthority();
  const terminalHarness = createHarness({ lifecycle: terminalLifecycle });
  terminalHarness.authority.add('terminal-no-hook', consent());
  const terminalDelegation = await terminalHarness.store.issueFromTrustedConsent({
    consentHandle: 'terminal-no-hook',
  });
  assert.strictEqual(terminalDelegation.issued, true);
  terminalLifecycle.setAuthorized(binding(), false);
  const terminalInspection = terminalHarness.store.inspectDecision(decisionRequest({
    consumable: false,
  }));
  assert.strictEqual(terminalInspection.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  const terminalConsume = terminalHarness.store.consumeDecision(decisionRequest());
  assert.strictEqual(terminalConsume.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.strictEqual(
    terminalHarness.store.get(terminalDelegation.delegation.delegationId).consumedFiles,
    0
  );

  const switchBindingA = binding();
  const switchBindingB = binding({
    projectId: 'project-b',
    canonicalRootPath: '/workspace/project-b',
    realRootPath: '/real/workspace/project-b',
    sessionId: 'session-b',
    jobId: 'job-b',
    kernelId: 'kernel-b',
    submissionDigest: digest('b'),
  });
  const switchBindingC = binding({
    sessionId: 'session-c',
    jobId: 'job-c',
    kernelId: 'kernel-c',
    submissionDigest: digest('c'),
  });
  const switchAuthority = createConsentAuthority();
  const switchHarness = createHarness({
    authority: switchAuthority,
    roots: createRootAuthority([switchBindingA, switchBindingB, switchBindingC]),
  });
  const switchEntered = new Map([
    ['switch-a', deferred()],
    ['switch-b', deferred()],
    ['switch-c', deferred()],
  ]);
  const switchRelease = deferred();
  switchAuthority.setOnConsume(async (handle) => {
    switchEntered.get(handle).resolve();
    await switchRelease.promise;
  });
  switchAuthority.add('switch-a', consent({ binding: switchBindingA }));
  switchAuthority.add('switch-b', consent({ binding: switchBindingB }));
  switchAuthority.add('switch-c', consent({ binding: switchBindingC }));
  const switchIssues = [
    switchHarness.store.issueFromTrustedConsent({ consentHandle: 'switch-a' }),
    switchHarness.store.issueFromTrustedConsent({ consentHandle: 'switch-b' }),
    switchHarness.store.issueFromTrustedConsent({ consentHandle: 'switch-c' }),
  ];
  await Promise.all(Array.from(switchEntered.values(), (entry) => entry.promise));
  const switchRevocation = switchHarness.store.revokeWhere({
    projectId: 'project-a',
    sessionId: 'session-a',
  }, { reason: 'session_switched' });
  assert.strictEqual(switchRevocation.ok, true);
  assert.strictEqual(switchRevocation.invalidatedIssuances, 1);
  switchRelease.resolve();
  const switchResults = await Promise.all(switchIssues);
  assert.strictEqual(switchResults[0].reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.strictEqual(switchResults[1].issued, true);
  assert.strictEqual(switchResults[2].issued, true);
  assert.strictEqual(switchHarness.store.diagnostics().inFlightIssuances, 0);

  const boundedAuthority = createConsentAuthority();
  const boundedHarness = createHarness({
    authority: boundedAuthority,
    maxInFlightIssuances: 1,
  });
  const boundedInspectEntered = deferred();
  const boundedInspectRelease = deferred();
  boundedAuthority.setOnInspect(async (handle) => {
    if (handle !== 'bounded-a') return;
    boundedInspectEntered.resolve();
    await boundedInspectRelease.promise;
  });
  boundedAuthority.add('bounded-a', consent());
  boundedAuthority.add('bounded-b', consent({
    binding: binding({ jobId: 'job-b', submissionDigest: digest('b') }),
  }));
  const boundedAIssue = boundedHarness.store.issueFromTrustedConsent({ consentHandle: 'bounded-a' });
  await boundedInspectEntered.promise;
  assert.strictEqual(boundedHarness.store.diagnostics().inFlightIssuances, 1);
  const boundedBResult = await boundedHarness.store.issueFromTrustedConsent({
    consentHandle: 'bounded-b',
  });
  assert.strictEqual(boundedBResult.reason, TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
  assert.deepStrictEqual(boundedAuthority.counts('bounded-b'), { inspect: 0, consume: 0 });
  boundedInspectRelease.resolve();
  assert.strictEqual((await boundedAIssue).issued, true);
  assert.strictEqual(boundedHarness.store.diagnostics().inFlightIssuances, 0);
  const boundedBAfterCleanup = await boundedHarness.store.issueFromTrustedConsent({
    consentHandle: 'bounded-b',
  });
  assert.strictEqual(boundedBAfterCleanup.issued, true);
  assert.strictEqual(boundedHarness.store.diagnostics().inFlightIssuances, 0);

  const errorCleanupAuthority = createConsentAuthority();
  const errorCleanupHarness = createHarness({ authority: errorCleanupAuthority });
  errorCleanupAuthority.setOnConsume(async (handle) => {
    if (handle === 'cleanup-error') throw new Error('simulated consent consume failure');
  });
  errorCleanupAuthority.add('cleanup-error', consent());
  const errorCleanupResult = await errorCleanupHarness.store.issueFromTrustedConsent({
    consentHandle: 'cleanup-error',
  });
  assert.strictEqual(errorCleanupResult.reason, TASK_DELEGATION_REASONS.CONSENT_INVALID);
  assert.strictEqual(errorCleanupHarness.store.diagnostics().inFlightIssuances, 0);

  const clearCleanupAuthority = createConsentAuthority();
  const clearCleanupHarness = createHarness({ authority: clearCleanupAuthority });
  const clearCleanupEntered = deferred();
  const clearCleanupRelease = deferred();
  clearCleanupAuthority.setOnConsume(async (handle) => {
    if (handle !== 'cleanup-clear-active') return;
    clearCleanupEntered.resolve();
    await clearCleanupRelease.promise;
  });
  clearCleanupAuthority.add('cleanup-clear-active', consent());
  clearCleanupAuthority.add('cleanup-clear-pending', consent({
    binding: binding({ jobId: 'job-pending', submissionDigest: digest('b') }),
  }));
  const clearCleanupIssue = clearCleanupHarness.store.issueFromTrustedConsent({
    consentHandle: 'cleanup-clear-active',
  });
  await clearCleanupEntered.promise;
  const clearCleanupResult = clearCleanupHarness.store.clear();
  assert.strictEqual(clearCleanupResult.ok, true);
  assert.strictEqual(clearCleanupResult.invalidatedIssuances, 1);
  assert.strictEqual(clearCleanupHarness.store.diagnostics().inFlightIssuances, 1);
  clearCleanupRelease.resolve();
  const clearCleanupSettled = await clearCleanupIssue;
  assert.strictEqual(clearCleanupSettled.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.strictEqual(clearCleanupHarness.store.diagnostics().inFlightIssuances, 0);
  const clearedPendingHandle = await clearCleanupHarness.store.issueFromTrustedConsent({
    consentHandle: 'cleanup-clear-pending',
  });
  assert.strictEqual(clearedPendingHandle.issued, false);
  assert.strictEqual(clearedPendingHandle.reason, TASK_DELEGATION_REASONS.CONSENT_INVALID);
  assert.deepStrictEqual(clearCleanupAuthority.counts('cleanup-clear-pending'), {
    inspect: 1,
    consume: 0,
  });

  const revokeDuringConsumeAuthority = createConsentAuthority();
  const revokeDuringConsumeHarness = createHarness({ authority: revokeDuringConsumeAuthority });
  revokeDuringConsumeAuthority.add('revoke-during-consume', consent());
  revokeDuringConsumeAuthority.setOnConsume(() => {
    revokeDuringConsumeHarness.store.revokeWhere({ jobId: 'job-a' }, {
      reason: 'job_cancelled',
    });
  });
  const revokedDuringConsume = await revokeDuringConsumeHarness.store.issueFromTrustedConsent({
    consentHandle: 'revoke-during-consume',
  });
  assert.strictEqual(revokedDuringConsume.issued, false);
  assert.strictEqual(revokedDuringConsume.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.strictEqual(revokeDuringConsumeHarness.store.diagnostics().activeDelegations, 0);

  const clearDuringConsumeAuthority = createConsentAuthority();
  const clearDuringConsumeHarness = createHarness({ authority: clearDuringConsumeAuthority });
  clearDuringConsumeAuthority.add('clear-during-consume', consent());
  clearDuringConsumeAuthority.setOnConsume(() => clearDuringConsumeHarness.store.clear());
  const clearedDuringConsume = await clearDuringConsumeHarness.store.issueFromTrustedConsent({
    consentHandle: 'clear-during-consume',
  });
  assert.strictEqual(clearedDuringConsume.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.strictEqual(clearDuringConsumeHarness.store.diagnostics().activeDelegations, 0);

  const clearDuringRootAuthority = createConsentAuthority();
  const clearDuringRootRoots = createRootAuthority();
  const clearDuringRootHarness = createHarness({
    authority: clearDuringRootAuthority,
    roots: clearDuringRootRoots,
  });
  clearDuringRootAuthority.add('clear-during-root', consent());
  let clearedInsideRoot = false;
  clearDuringRootRoots.setOnAuthorize(() => {
    if (clearedInsideRoot) return;
    clearedInsideRoot = true;
    clearDuringRootHarness.store.clear();
  });
  const clearedDuringRoot = await clearDuringRootHarness.store.issueFromTrustedConsent({
    consentHandle: 'clear-during-root',
  });
  assert.strictEqual(clearedDuringRoot.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.deepStrictEqual(clearDuringRootAuthority.counts('clear-during-root'), {
    inspect: 1,
    consume: 0,
  });
  assert.strictEqual(clearDuringRootHarness.store.diagnostics().activeDelegations, 0);

  let clearDuringIdStore;
  const clearDuringIdAuthority = createConsentAuthority();
  const clearDuringIdHarness = createHarness({
    authority: clearDuringIdAuthority,
    delegationIdFactory: () => {
      clearDuringIdStore.clear();
      return 'delegation-cleared-during-id';
    },
  });
  clearDuringIdStore = clearDuringIdHarness.store;
  clearDuringIdAuthority.add('clear-during-id', consent());
  const clearedDuringId = await clearDuringIdStore.issueFromTrustedConsent({
    consentHandle: 'clear-during-id',
  });
  assert.strictEqual(clearedDuringId.reason, TASK_DELEGATION_REASONS.LIFECYCLE_INVALIDATED);
  assert.strictEqual(clearDuringIdStore.diagnostics().activeDelegations, 0);

  const concurrencyHarness = createHarness();
  concurrencyHarness.authority.add('concurrent-a', consent());
  concurrencyHarness.authority.add('concurrent-b', consent());
  const concurrentIssues = await Promise.all([
    concurrencyHarness.store.issueFromTrustedConsent({ consentHandle: 'concurrent-a' }),
    concurrencyHarness.store.issueFromTrustedConsent({ consentHandle: 'concurrent-b' }),
  ]);
  assert.strictEqual(concurrentIssues.filter((result) => result.issued).length, 1);
  assert.strictEqual(concurrentIssues.filter((result) => result.reason === TASK_DELEGATION_REASONS.TASK_ALREADY_DELEGATED).length, 1);
  const concurrentRequest = decisionRequest();
  const concurrentDecisions = await Promise.all([
    Promise.resolve().then(() => concurrencyHarness.store.consumeDecision(concurrentRequest)),
    Promise.resolve().then(() => concurrencyHarness.store.consumeDecision(concurrentRequest)),
  ]);
  assert.strictEqual(concurrentDecisions.filter((result) => result.authorized).length, 1);
  assert.strictEqual(concurrentDecisions.filter((result) => result.reason === TASK_DELEGATION_REASONS.DECISION_REPLAYED).length, 1);

  const rootReentryHarness = createHarness();
  rootReentryHarness.authority.add('root-reentry', consent());
  const rootReentryDelegation = await rootReentryHarness.store.issueFromTrustedConsent({
    consentHandle: 'root-reentry',
  });
  let rootReentryAttempted = false;
  rootReentryHarness.roots.setOnAuthorize(() => {
    if (rootReentryAttempted) return;
    rootReentryAttempted = true;
    rootReentryHarness.store.revoke(rootReentryDelegation.delegation.delegationId, {
      reason: 'revoked_during_root_authorization',
    });
  });
  const rootReentry = rootReentryHarness.store.consumeDecision(decisionRequest());
  assert.strictEqual(rootReentry.authorized, false);
  assert.strictEqual(rootReentry.reason, TASK_DELEGATION_REASONS.REVOKED);
  assert.strictEqual(rootReentryHarness.store.diagnostics().decisionRecords, 0);
  assert.strictEqual(rootReentryHarness.store.get(rootReentryDelegation.delegation.delegationId).consumedFiles, 0);

  let idReentryStore;
  let idReentryDelegationId;
  let idReentryAttempted = false;
  const idReentryHarness = createHarness({
    decisionIdFactory: () => {
      if (!idReentryAttempted) {
        idReentryAttempted = true;
        idReentryStore.revoke(idReentryDelegationId, { reason: 'revoked_during_id_creation' });
      }
      return 'decision-reentrant';
    },
  });
  idReentryStore = idReentryHarness.store;
  idReentryHarness.authority.add('id-reentry', consent());
  const idReentryDelegation = await idReentryStore.issueFromTrustedConsent({
    consentHandle: 'id-reentry',
  });
  idReentryDelegationId = idReentryDelegation.delegation.delegationId;
  const idReentry = idReentryStore.consumeDecision(decisionRequest());
  assert.strictEqual(idReentry.authorized, false);
  assert.strictEqual(idReentry.reason, TASK_DELEGATION_REASONS.REVOKED);
  assert.strictEqual(idReentryStore.diagnostics().decisionRecords, 0);
  assert.strictEqual(idReentryStore.get(idReentryDelegationId).consumedFiles, 0);

  const capacityBinding = binding({
    projectId: 'project-b',
    canonicalRootPath: '/workspace/project-b',
    realRootPath: '/real/workspace/project-b',
    sessionId: 'session-b',
    jobId: 'job-b',
    kernelId: 'kernel-b',
    submissionDigest: digest('b'),
  });
  const capacityAuthority = createConsentAuthority();
  const capacityRoots = createRootAuthority([binding(), capacityBinding]);
  const capacityHarness = createHarness({
    authority: capacityAuthority,
    roots: capacityRoots,
    maxRecords: 1,
  });
  capacityAuthority.add('capacity-a', consent());
  capacityAuthority.add('capacity-b', consent({ binding: capacityBinding }));
  assert.strictEqual((await capacityHarness.store.issueFromTrustedConsent({ consentHandle: 'capacity-a' })).issued, true);
  const full = await capacityHarness.store.issueFromTrustedConsent({ consentHandle: 'capacity-b' });
  assert.strictEqual(full.reason, TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
  assert.deepStrictEqual(capacityAuthority.counts('capacity-b'), { inspect: 0, consume: 0 });
  assert.strictEqual(capacityHarness.store.diagnostics().activeDelegations, 1);

  const decisionCapacityHarness = createHarness({ maxDecisionRecords: 1 });
  decisionCapacityHarness.authority.add('decision-capacity', consent());
  await decisionCapacityHarness.store.issueFromTrustedConsent({ consentHandle: 'decision-capacity' });
  assert.strictEqual(decisionCapacityHarness.store.consumeDecision(decisionRequest()).authorized, true);
  const decisionFull = decisionCapacityHarness.store.consumeDecision(decisionRequest({
    request: '4', impact: '5', checkpoint: '6',
  }));
  assert.strictEqual(decisionFull.reason, TASK_DELEGATION_REASONS.CAPACITY_EXCEEDED);
  assert.strictEqual(decisionCapacityHarness.store.diagnostics().activeDelegations, 1);

  let clock = 5_000;
  const expiryHarness = createHarness({ now: () => clock });
  expiryHarness.authority.add('expires', consent());
  const expiring = await expiryHarness.store.issueFromTrustedConsent({ consentHandle: 'expires' });
  const expiringReceipt = expiryHarness.store.consumeDecision(decisionRequest());
  assert.strictEqual(expiringReceipt.authorized, true);
  assert.strictEqual(expiryHarness.store.diagnostics().decisionRecords, 1);
  clock += DEFAULT_DELEGATION_TTL_MS;
  assert.strictEqual(
    expiryHarness.store.get(expiring.delegation.delegationId).status,
    'expired'
  );
  assert.strictEqual(expiryHarness.store.diagnostics().decisionRecords, 0);
  assert.strictEqual(expiryHarness.store.consumeDecision(decisionRequest()).authorized, false);

  const revokeHarness = createHarness();
  revokeHarness.authority.add('revoke', consent());
  const revocable = await revokeHarness.store.issueFromTrustedConsent({ consentHandle: 'revoke' });
  assert.throws(() => revokeHarness.store.revoke(revocable.delegation.delegationId, {
    reason: '/workspace/project-a/secret.txt',
  }), /safe reason code/);
  const revocableReceipt = revokeHarness.store.consumeDecision(decisionRequest());
  assert.strictEqual(revocableReceipt.authorized, true);
  assert.strictEqual(revokeHarness.store.diagnostics().decisionRecords, 1);
  const revoked = revokeHarness.store.revoke(revocable.delegation.delegationId, {
    reason: 'revoked_by_user',
  });
  assert.strictEqual(revoked.revoked, true);
  assert.strictEqual(JSON.stringify(revoked.audit).includes('/workspace'), false);
  assert.strictEqual(revokeHarness.store.diagnostics().decisionRecords, 0);
  assert.strictEqual('getDecision' in revokeHarness.store, false);
  assert.strictEqual(revokeHarness.store.consumeDecision(decisionRequest()).authorized, false);

  const restarted = createHarness();
  assert.strictEqual(
    restarted.store.inspectDecision(decisionRequest({ consumable: false })).reason,
    TASK_DELEGATION_REASONS.NOT_FOUND
  );

  const windowsTask = binding({
    projectId: 'project-win',
    canonicalRootPath: 'C:\\Project',
    realRootPath: 'C:\\Real\\Project',
    sessionId: 'session-win',
    jobId: 'job-win',
    kernelId: 'kernel-win',
    submissionDigest: digest('c'),
  });
  const windowsAuthority = createConsentAuthority();
  const windowsRoots = createRootAuthority([{
    ...windowsTask,
    canonicalRootPath: 'c:\\project',
    realRootPath: 'c:\\real\\PROJECT',
  }]);
  const windowsHarness = createHarness({ authority: windowsAuthority, roots: windowsRoots });
  windowsAuthority.add('windows', consent({ binding: windowsTask }));
  assert.strictEqual((await windowsHarness.store.issueFromTrustedConsent({ consentHandle: 'windows' })).issued, true);
  assert.strictEqual(windowsHarness.store.consumeDecision(decisionRequest({
    taskBinding: { ...windowsTask, canonicalRootPath: 'c:\\PROJECT', realRootPath: 'C:\\REAL\\project' },
  })).authorized, true);

  const malformedHarness = createHarness();
  const sparseEffects = [];
  sparseEffects.length = 1;
  malformedHarness.authority.add('sparse', consent({ allowedEffects: sparseEffects }));
  assert.strictEqual((await malformedHarness.store.issueFromTrustedConsent({ consentHandle: 'sparse' })).issued, false);
  assert.deepStrictEqual(malformedHarness.authority.counts('sparse'), { inspect: 1, consume: 0 });
  malformedHarness.authority.add('undefined', { ...consent(), ttlMs: undefined });
  assert.strictEqual((await malformedHarness.store.issueFromTrustedConsent({ consentHandle: 'undefined' })).issued, false);
  malformedHarness.authority.add('string-ttl', { ...consent(), ttlMs: '1000' });
  assert.strictEqual((await malformedHarness.store.issueFromTrustedConsent({ consentHandle: 'string-ttl' })).issued, false);
  const symbolConsent = consent();
  symbolConsent[Symbol('proof')] = true;
  malformedHarness.authority.add('symbol', symbolConsent);
  assert.strictEqual((await malformedHarness.store.issueFromTrustedConsent({ consentHandle: 'symbol' })).issued, false);
  const prototypeConsent = JSON.parse(JSON.stringify(consent()));
  Object.defineProperty(prototypeConsent, '__proto__', { enumerable: true, value: { authorized: true } });
  malformedHarness.authority.add('prototype', prototypeConsent);
  assert.strictEqual((await malformedHarness.store.issueFromTrustedConsent({ consentHandle: 'prototype' })).issued, false);

  console.log('task delegation store tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
