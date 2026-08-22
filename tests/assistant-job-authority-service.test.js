'use strict';

const assert = require('assert');

const {
  ASSISTANT_JOB_AUTHORITY_REASONS,
  ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION,
  AssistantJobAuthorityService,
  createActionDigest,
  createAssistantJobAuthorityService,
} = require('../main/services/assistant_job_authority_service');

function idFactory(prefix) {
  let sequence = 0;
  return () => `${prefix}_${String(++sequence).padStart(24, '0')}`;
}

function request(overrides = {}) {
  return {
    userMessage: 'Crie uma aplicação real',
    attachments: [{ name: 'brief.md', type: 'text/markdown', size: 42, path: '/tmp/brief.md' }],
    ...overrides,
  };
}

function physicalRootIdentity(overrides = {}) {
  return {
    device: '1',
    inode: '2',
    entryDevice: '1',
    entryInode: '2',
    entryType: 'directory',
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const jobs = new Map();
  let checkedAt = 1_000;
  let authorizedContext = { conversationId: 'conversation-a', mode: 'build' };
  let projectAuthorized = true;
  let currentPhysicalRootIdentity = physicalRootIdentity();
  let onAuthorize = null;
  let onGetJob = null;
  const authorizeProjectBinding = overrides.authorizeProjectBinding || ((projectId, rootPath) => {
    if (onAuthorize) onAuthorize(projectId, rootPath);
    if (!projectAuthorized || projectId !== 'project-a' || rootPath !== '/workspace/project-a') {
      return { authorized: false };
    }
    return {
      authorized: true,
      projectId: 'project-a',
      canonicalRootPath: '/workspace/project-a',
      realRootPath: '/real/workspace/project-a',
      physicalRootIdentity: currentPhysicalRootIdentity,
      authorizedContext,
    };
  });
  const getJobById = overrides.getJobById || ((jobId) => {
    if (onGetJob) onGetJob(jobId);
    const job = jobs.get(jobId);
    return job ? { ok: true, job } : { ok: false, message: 'missing' };
  });
  const service = createAssistantJobAuthorityService({
    authorizeProjectBinding,
    getJobById,
    now: overrides.now || (() => checkedAt),
    sessionIdFactory: overrides.sessionIdFactory || idFactory('session'),
    submissionIdFactory: overrides.submissionIdFactory || idFactory('submission'),
    maxActiveSubmissions: overrides.maxActiveSubmissions || 8,
    maxActiveSessions: overrides.maxActiveSessions || 8,
  });

  function begin(inputOverrides = {}) {
    return service.beginSubmission({
      projectId: 'project-a',
      rootPath: '/workspace/project-a',
      kernelId: 'kernel-a',
      request: request(),
      ...inputOverrides,
    });
  }

  function persistJob(started, jobOverrides = {}) {
    const job = {
      id: 'job-a',
      status: 'running',
      phase: 'persona_plan',
      projectId: 'project-a',
      rootPath: '/workspace/project-a',
      request: request(),
      retryState: { retryable: true },
      authorityContext: started.authorityContext,
      ...jobOverrides,
    };
    jobs.set(job.id, job);
    return job;
  }

  function bind(started, job = persistJob(started)) {
    const result = service.bindJob({ submissionId: started.submissionId, jobId: job.id });
    assert.strictEqual(result.authorized, true);
    return { job, binding: result.binding };
  }

  return {
    begin,
    bind,
    jobs,
    service,
    setAuthorizedContext(value) { authorizedContext = value; },
    setProjectAuthorized(value) { projectAuthorized = value; },
    setPhysicalRootIdentity(value) { currentPhysicalRootIdentity = value; },
    setNow(value) { checkedAt = value; },
    setOnAuthorize(callback) { onAuthorize = callback; },
    setOnGetJob(callback) { onGetJob = callback; },
  };
}

function persistAction(job, result) {
  job.authorityContext = result.authorityContext;
}

function run() {
  // Main-generated authority is exact, immutable, JSON-safe and digest-bound.
  const harness = createHarness();
  const started = harness.begin();
  assert.strictEqual(started.ok, true);
  assert.match(started.submissionId, /^submission_[A-Za-z0-9_-]{24,128}$/);
  assert.deepStrictEqual(Object.keys(started.authorityContext), [
    'schemaVersion',
    'projectId',
    'canonicalRootPath',
    'realRootPath',
    'sessionId',
    'kernelId',
    'submissionDigest',
    'actionDigest',
  ]);
  assert.strictEqual(started.authorityContext.schemaVersion, ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION);
  assert.match(started.authorityContext.submissionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(started.authorityContext.actionDigest, null);
  assert.strictEqual(Object.isFrozen(started.authorityContext), true);
  assert.strictEqual(JSON.parse(JSON.stringify(started.authorityContext)).sessionId, started.authorityContext.sessionId);

  const { job, binding } = harness.bind(started);
  assert.strictEqual(harness.service.authorizeLifecycle(binding).authorized, true);
  const action = { type: 'write_files', files: [{ path: 'src/app.js', content: 'ok' }] };
  const actionBinding = harness.service.bindAction({ binding, action });
  assert.strictEqual(actionBinding.authorized, true);
  assert.match(actionBinding.actionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(actionBinding.authorityContext.actionDigest, actionBinding.actionDigest);
  assert.strictEqual(Object.isFrozen(actionBinding.authorityContext), true);
  persistAction(job, actionBinding);
  job.phase = 'awaiting_user_confirmation';
  assert.strictEqual(harness.service.authorizeExecute({ binding, action }).authorized, true);
  const rootLeaseAuthorization = harness.service.authorizeProjectRootLease(binding);
  assert.strictEqual(rootLeaseAuthorization.authorized, true);
  assert.deepStrictEqual(rootLeaseAuthorization.binding, binding);
  assert.match(rootLeaseAuthorization.physicalRootIdentityDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(
    harness.service.authorizeProjectRootLease(binding).physicalRootIdentityDigest,
    rootLeaseAuthorization.physicalRootIdentityDigest
  );
  assert.strictEqual(harness.service.verifyActionDigest({ binding, action }).authorized, true);

  // Canonical order never changes submission/action digests.
  const canonicalA = createHarness();
  canonicalA.setAuthorizedContext({ z: [2, { b: true, a: false }], a: 'value' });
  const canonicalB = createHarness();
  canonicalB.setAuthorizedContext({ a: 'value', z: [2, { a: false, b: true }] });
  const canonicalStartA = canonicalA.begin({
    request: {
      attachments: [{ path: '/tmp/x', size: 1, type: 'text/plain', name: 'x' }],
      userMessage: 'same',
    },
  });
  const canonicalStartB = canonicalB.begin({
    request: {
      userMessage: 'same',
      attachments: [{ name: 'x', type: 'text/plain', size: 1, path: '/tmp/x' }],
    },
  });
  assert.strictEqual(canonicalStartA.authorityContext.submissionDigest, canonicalStartB.authorityContext.submissionDigest);
  assert.strictEqual(
    createActionDigest({ z: 1, a: [{ y: true, x: false }] }),
    createActionDigest({ a: [{ x: false, y: true }], z: 1 })
  );
  let authorizerArguments = null;
  const signature = createHarness({
    authorizeProjectBinding(projectId, rootPath) {
      authorizerArguments = [projectId, rootPath];
      return {
        authorized: true,
        projectId,
        canonicalRootPath: rootPath,
        realRootPath: '/real/workspace/project-a',
        physicalRootIdentity: physicalRootIdentity(),
      };
    },
  });
  assert.strictEqual(signature.begin().ok, true);
  assert.deepStrictEqual(authorizerArguments, ['project-a', '/workspace/project-a']);
  const contradictoryAuthorization = createHarness({
    authorizeProjectBinding: () => ({
      ok: true,
      authorized: false,
      projectId: 'project-a',
      canonicalRootPath: '/workspace/project-a',
      realRootPath: '/real/workspace/project-a',
      physicalRootIdentity: physicalRootIdentity(),
    }),
  });
  assert.strictEqual(contradictoryAuthorization.begin().ok, false);

  // Every lifecycle boundary reauthorizes both the project record and its physical root.
  const revokedProject = createHarness();
  const revokedStart = revokedProject.begin();
  const revokedBound = revokedProject.bind(revokedStart);
  revokedProject.setProjectAuthorized(false);
  assert.strictEqual(revokedProject.service.authorizeLifecycle(revokedBound.binding).authorized, false);
  revokedProject.setProjectAuthorized(true);
  assert.strictEqual(revokedProject.service.authorizeLifecycle(revokedBound.binding).authorized, false);
  assert.strictEqual(revokedProject.service.snapshotForUi(revokedStart.submissionId).active, false);

  const swappedRoot = createHarness();
  const swappedStart = swappedRoot.begin();
  const swappedBound = swappedRoot.bind(swappedStart);
  swappedRoot.setPhysicalRootIdentity(physicalRootIdentity({ inode: '999' }));
  assert.strictEqual(swappedRoot.service.authorizeLifecycle(swappedBound.binding).authorized, false);
  swappedRoot.setPhysicalRootIdentity(physicalRootIdentity());
  assert.strictEqual(swappedRoot.service.authorizeLifecycle(swappedBound.binding).authorized, false);

  const mismatchedRoot = createHarness();
  const mismatchedStart = mismatchedRoot.begin();
  const mismatchedJob = mismatchedRoot.bind(mismatchedStart).job;
  mismatchedJob.rootPath = '/workspace/other-project';
  assert.strictEqual(
    mismatchedRoot.service.authorizeLifecycle({
      projectId: 'project-a',
      canonicalRootPath: '/workspace/project-a',
      realRootPath: '/real/workspace/project-a',
      sessionId: mismatchedStart.authorityContext.sessionId,
      jobId: 'job-a',
      kernelId: 'kernel-a',
      submissionDigest: mismatchedStart.authorityContext.submissionDigest,
    }).authorized,
    false
  );

  // Renderer-forged identifiers/digests and every cross-scope dimension fail closed.
  const forgeries = [
    { projectId: 'project-b' },
    { canonicalRootPath: '/workspace/project-b' },
    { realRootPath: '/real/workspace/project-b' },
    { sessionId: `session_${'x'.repeat(24)}` },
    { jobId: 'job-b' },
    { kernelId: 'kernel-b' },
    { submissionDigest: `sha256:${'f'.repeat(64)}` },
  ];
  for (const forged of forgeries) {
    assert.strictEqual(harness.service.authorizeLifecycle({ ...binding, ...forged }).authorized, false);
  }
  assert.strictEqual(
    harness.service.bindJob({ submissionId: started.submissionId, jobId: 'job-b' }).reason,
    ASSISTANT_JOB_AUTHORITY_REASONS.JOB_ALREADY_BOUND
  );
  assert.strictEqual(
    harness.service.bindJob({ submissionId: `submission_${'x'.repeat(24)}`, jobId: 'job-a' }).authorized,
    false
  );

  // Action authority is write-once; mutation after planning is rejected.
  const mutatedAction = { type: 'write_files', files: [{ path: 'src/other.js', content: 'changed' }] };
  assert.strictEqual(harness.service.bindAction({ binding, action: mutatedAction }).authorized, false);
  assert.strictEqual(harness.service.authorizeExecute({ binding, action: mutatedAction }).authorized, false);
  job.phase = 'persona_plan';
  assert.strictEqual(harness.service.authorizeExecute({ binding, action }).authorized, false);
  job.phase = 'awaiting_user_confirmation';
  job.status = 'retry_pending';
  assert.strictEqual(harness.service.authorizeExecute({ binding, action }).authorized, false);
  job.status = 'running';
  job.authorityContext = { ...job.authorityContext, actionDigest: `sha256:${'e'.repeat(64)}` };
  assert.strictEqual(harness.service.authorizeExecute({ binding, action }).authorized, false);
  job.authorityContext = actionBinding.authorityContext;
  job.phase = 'persona_plan';

  // Retry reconstructs only the persisted request and supports the two explicit states.
  const retryHarness = createHarness();
  const retryStart = retryHarness.begin();
  const { job: retryJob, binding: retryBinding } = retryHarness.bind(retryStart);
  retryJob.status = 'retry_pending';
  retryJob.phase = 'persona_plan';
  retryJob.retryState = { retryable: true };
  const retry = retryHarness.service.authorizeRetry(retryBinding);
  assert.strictEqual(retry.authorized, true);
  assert.deepStrictEqual(retry.request, request());
  assert.strictEqual(Object.isFrozen(retry.request), true);
  assert.strictEqual(Object.isFrozen(retry.request.attachments), true);
  retryJob.retryState = {
    retryable: true,
    nextRetryAt: new Date(2_000).toISOString(),
  };
  const waitingInspection = retryHarness.service.inspectRetryEligibility(retryBinding);
  assert.strictEqual(waitingInspection.eligible, true);
  assert.strictEqual(waitingInspection.due, false);
  assert.strictEqual(waitingInspection.notBefore, new Date(2_000).toISOString());
  assert.deepStrictEqual(waitingInspection.request, request());
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, false);
  retryHarness.setNow(2_000);
  assert.strictEqual(retryHarness.service.inspectRetryEligibility(retryBinding).due, true);
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, true);
  retryJob.retryState.nextRetryAt = '1970-01-01T00:00:02Z';
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, false);
  retryJob.retryState.nextRetryAt = null;
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, true);
  retryJob.retryState = { retryable: false };
  assert.strictEqual(retryHarness.service.inspectRetryEligibility(retryBinding).eligible, false);
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, false);
  retryJob.status = 'paused_memory_pressure';
  retryJob.phase = 'paused_memory_pressure';
  retryJob.retryState = { retryable: true };
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, true);
  retryJob.phase = 'unsupported_pause';
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, false);
  retryJob.status = 'running';
  retryJob.phase = 'persona_plan';
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, false);
  retryJob.status = 'retry_pending';
  retryJob.retryState = undefined;
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, false);
  retryJob.retryState = {};
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, false);
  retryJob.request = request({ userMessage: 'renderer mutated persisted request' });
  assert.strictEqual(retryHarness.service.authorizeLifecycle(retryBinding).authorized, false);
  assert.strictEqual(retryHarness.service.authorizeRetry(retryBinding).authorized, false);

  // Terminal transitions revoke the exact active session.
  job.status = 'completed';
  assert.strictEqual(harness.service.authorizeLifecycle(binding).authorized, false);
  assert.deepStrictEqual(harness.service.snapshotForUi(started.submissionId), {
    schemaVersion: ASSISTANT_JOB_AUTHORITY_SCHEMA_VERSION,
    active: false,
    jobBound: false,
    actionBound: false,
  });
  assert.strictEqual(harness.service.authorizeExecute({ binding, action }).authorized, false);

  // Exact revoke and clear block stale/replayed authority without touching other tasks.
  const lifecycle = createHarness();
  const first = lifecycle.begin();
  const firstBound = lifecycle.bind(first, lifecycle.persistJob ? lifecycle.persistJob(first) : undefined);
  const second = lifecycle.begin();
  const secondJob = {
    id: 'job-b', status: 'running', phase: 'persona_plan', projectId: 'project-a', rootPath: '/workspace/project-a',
    request: request(), retryState: { retryable: true }, authorityContext: second.authorityContext,
  };
  lifecycle.jobs.set(secondJob.id, secondJob);
  const secondBindingResult = lifecycle.service.bindJob({ submissionId: second.submissionId, jobId: secondJob.id });
  assert.strictEqual(secondBindingResult.authorized, true);
  assert.strictEqual(lifecycle.service.revokeExact(firstBound.binding).revoked, true);
  assert.strictEqual(lifecycle.service.authorizeLifecycle(firstBound.binding).authorized, false);
  assert.strictEqual(lifecycle.service.authorizeLifecycle(secondBindingResult.binding).authorized, true);
  assert.strictEqual(lifecycle.service.clear().cleared, 1);
  assert.strictEqual(lifecycle.service.authorizeLifecycle(secondBindingResult.binding).authorized, false);

  // Capacity is bounded and released by exact revocation.
  const bounded = createHarness({ maxActiveSubmissions: 1, maxActiveSessions: 1 });
  const boundedFirst = bounded.begin();
  assert.strictEqual(boundedFirst.ok, true);
  assert.strictEqual(bounded.begin().reason, ASSISTANT_JOB_AUTHORITY_REASONS.CAPACITY_EXCEEDED);
  assert.strictEqual(bounded.service.revokeSubmission(boundedFirst.submissionId).revoked, true);
  assert.strictEqual(bounded.begin().ok, true);
  assert.strictEqual(bounded.service.diagnostics().activeSubmissions, 1);
  assert.strictEqual(JSON.stringify(bounded.service.diagnostics()).includes('submission_'), false);

  // Reentrant begin is rejected; lifecycle clearing during a dependency call wins the race.
  const reentrant = createHarness();
  let nestedBegin = null;
  reentrant.setOnAuthorize(() => {
    if (!nestedBegin) nestedBegin = reentrant.begin();
  });
  assert.strictEqual(reentrant.begin().ok, true);
  assert.strictEqual(nestedBegin.reason, ASSISTANT_JOB_AUTHORITY_REASONS.BUSY);

  const raced = createHarness();
  const racedStart = raced.begin();
  const racedJob = {
    id: 'job-race', status: 'running', phase: 'persona_plan', projectId: 'project-a', rootPath: '/workspace/project-a',
    request: request(), retryState: { retryable: true }, authorityContext: racedStart.authorityContext,
  };
  raced.jobs.set(racedJob.id, racedJob);
  raced.setOnGetJob(() => raced.service.clear());
  assert.strictEqual(
    raced.service.bindJob({ submissionId: racedStart.submissionId, jobId: racedJob.id }).authorized,
    false
  );
  assert.strictEqual(raced.service.diagnostics().activeSubmissions, 0);

  const retryRace = createHarness();
  const retryRaceStart = retryRace.begin();
  const retryRaceBound = retryRace.bind(retryRaceStart);
  retryRaceBound.job.status = 'retry_pending';
  retryRaceBound.job.phase = 'persona_plan';
  retryRaceBound.job.retryState = new Proxy({ retryable: true }, {
    getPrototypeOf(target) {
      retryRace.service.clear();
      return Object.getPrototypeOf(target);
    },
  });
  assert.strictEqual(retryRace.service.authorizeRetry(retryRaceBound.binding).authorized, false);
  assert.strictEqual(retryRace.service.diagnostics().activeSubmissions, 0);

  const executeRace = createHarness();
  const executeRaceStart = executeRace.begin();
  const executeRaceBound = executeRace.bind(executeRaceStart);
  const stableAction = { type: 'write_files', files: [] };
  const executeRaceActionBinding = executeRace.service.bindAction({
    binding: executeRaceBound.binding,
    action: stableAction,
  });
  persistAction(executeRaceBound.job, executeRaceActionBinding);
  executeRaceBound.job.phase = 'awaiting_user_confirmation';
  let statusMutated = false;
  const racingAction = new Proxy(stableAction, {
    ownKeys(target) {
      if (!statusMutated) {
        statusMutated = true;
        executeRaceBound.job.status = 'completed';
      }
      return Reflect.ownKeys(target);
    },
  });
  assert.strictEqual(
    executeRace.service.authorizeExecute({ binding: executeRaceBound.binding, action: racingAction }).authorized,
    false
  );

  // Hostile JSON is rejected without invoking accessors or polluting prototypes.
  const hostile = createHarness();
  let getterCalls = 0;
  const getterRequest = {};
  Object.defineProperty(getterRequest, 'userMessage', {
    enumerable: true,
    get() { getterCalls += 1; return 'unsafe'; },
  });
  Object.defineProperty(getterRequest, 'attachments', { enumerable: true, value: [] });
  assert.strictEqual(hostile.begin({ request: getterRequest }).ok, false);
  assert.strictEqual(getterCalls, 0);
  assert.strictEqual(hostile.begin({ request: request({ attachments: new Array(1) }) }).ok, false);
  assert.strictEqual(hostile.begin({ request: request({ attachments: [{ name: 'x', size: -0 }] }) }).ok, false);
  assert.strictEqual(hostile.begin({ request: request({ attachments: [{ name: 'x', size: undefined }] }) }).ok, false);
  assert.strictEqual(hostile.begin({ rootPath: 'C:relative\\project' }).ok, false);
  assert.strictEqual(hostile.begin({ rootPath: '\\\\?\\C:\\project' }).ok, false);
  assert.strictEqual(hostile.begin({ rootPath: '//server/share' }).ok, false);
  const symbolRequest = request();
  symbolRequest[Symbol('forged')] = true;
  assert.strictEqual(hostile.begin({ request: symbolRequest }).ok, false);
  const pollutedRequest = JSON.parse('{"userMessage":"x","attachments":[],"__proto__":{"polluted":true}}');
  assert.strictEqual(hostile.begin({ request: pollutedRequest }).ok, false);
  assert.strictEqual({}.polluted, undefined);
  let actionGetterCalls = 0;
  const getterAction = {};
  Object.defineProperty(getterAction, 'type', {
    enumerable: true,
    get() { actionGetterCalls += 1; return 'unsafe'; },
  });
  assert.throws(() => createActionDigest(getterAction), /data properties/);
  assert.strictEqual(actionGetterCalls, 0);
  assert.throws(() => createActionDigest({ value: -0 }), /negative zero/);
  assert.throws(() => createActionDigest({ value: undefined }), /unsupported value/);
  assert.throws(() => createActionDigest(new Array(1)), /dense indexed arrays/);
  const symbolAction = { type: 'write' };
  symbolAction[Symbol('forged')] = true;
  assert.throws(() => createActionDigest(symbolAction), /symbols/);
  assert.throws(
    () => createActionDigest(JSON.parse('{"type":"write","__proto__":{"polluted":true}}')),
    /forbidden key/
  );
  hostile.setAuthorizedContext({ api_token: 'must-not-enter-authority' });
  assert.strictEqual(hostile.begin().ok, false);

  // Clock rollback poisons and clears all process-local authority.
  const clocked = createHarness();
  const clockFirst = clocked.begin();
  assert.strictEqual(clockFirst.ok, true);
  clocked.setNow(999);
  assert.strictEqual(clocked.begin().ok, false);
  assert.strictEqual(clocked.service.diagnostics().clockHealthy, false);
  assert.strictEqual(clocked.service.diagnostics().activeSessions, 0);

  let clockMode = 'ok';
  const throwingClock = createHarness({
    now: () => {
      if (clockMode === 'throw') throw new Error('clock failed');
      return 1_000;
    },
  });
  assert.strictEqual(throwingClock.begin().ok, true);
  clockMode = 'throw';
  assert.strictEqual(throwingClock.begin().ok, false);
  assert.strictEqual(throwingClock.service.diagnostics().clockHealthy, false);
  clockMode = 'ok';
  assert.strictEqual(throwingClock.begin().ok, false, 'a poisoned clock must stay fail-closed');
  const nanClock = createHarness({ now: () => Number.NaN });
  assert.strictEqual(nanClock.begin().ok, false);
  assert.strictEqual(nanClock.service.diagnostics().clockHealthy, false);

  const classService = new AssistantJobAuthorityService({
    authorizeProjectBinding: () => ({ authorized: false }),
    getJobById: () => ({ ok: false }),
  });
  assert.strictEqual(Object.isFrozen(classService), true);

  console.log('assistant job authority service tests passed');
}

run();
