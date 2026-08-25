const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createOrchestrationStateStore } = require('../cortex/orchestration/state_store');
const {
  createAgenticDeleteStartupRecoveryService,
} = require('../main/services/agentic_delete_startup_recovery_service');

function createStore(tempRoot, overrides = {}) {
  return createOrchestrationStateStore({
    CORTEX_BRIEFING_MAX_RETRIES: 2,
    CORTEX_VALIDATION_MAX_RETRIES: 2,
    CORTEX_VALIDATION_STALL_LIMIT: 1,
    JOB_PROGRESS_MIN_DELTA: 1,
    JOB_RETRY_NO_PROGRESS_MS: 60000,
    JOB_RETRY_SAME_FINGERPRINT_LIMIT: 2,
    JOB_RETRY_SAME_REASON_LIMIT: 2,
    JOB_RETRY_STAGNATION_LIMIT: 3,
    JOB_SOFT_TIMEOUT_MS: 600000,
    MAX_AUDIT_EVENTS: 12,
    MAX_CONVERSATION_MESSAGES: 3,
    MAX_CORTEX_LEARNING_EVENTS: 3,
    MAX_JOB_EVENTS: 6,
    MAX_JOBS_STORED: 4,
    computeRetryBackoffMs: () => 1000,
    fs,
    getUserDataPath: () => tempRoot,
    isNonRetriableProviderReason: (reason) => String(reason || '').includes('nonretry'),
    path,
    ...overrides,
  });
}

function buildAuthorityContext(overrides = {}) {
  return {
    schemaVersion: 'assistant-job-authority.v1',
    projectId: 'project-authority',
    canonicalRootPath: '/workspace/project-authority',
    realRootPath: '/workspace/project-authority',
    sessionId: 'session-authority',
    kernelId: 'kernel-authority',
    submissionDigest: `sha256:${'1'.repeat(64)}`,
    actionDigest: null,
    ...overrides,
  };
}

function runAuthorizedRecoveryCandidateTests(tempRoot) {
  const recoveryRoot = path.join(tempRoot, 'authorized-recovery-candidates');
  const store = createStore(recoveryRoot, { MAX_JOBS_STORED: 100 });
  const failedTerminalPhases = [
    'failed',
    'runtime_interrupted',
    'execute_authorization_failed',
    'execute_validation_fresh_approval_required',
    'execute_pending_fresh_approval_required',
    'execute_validation_retry_exhausted',
    'execute_pending_retry_exhausted',
    'execute_validation',
    'execute_failed',
    'assistant_planning_failed',
    'provider_failure',
    'persona_retry_exhausted',
    'cortex_briefing_retry_exhausted',
    'cortex_validation_retry_exhausted',
    'cortex_validation',
    'persona_non_actionable_route',
  ];
  const recoveryAuthority = (actionDigest = `sha256:${'a'.repeat(64)}`) =>
    buildAuthorityContext({
      projectId: 'project-recovery',
      canonicalRootPath: '/workspace/project-recovery',
      realRootPath: '/workspace/project-recovery',
      sessionId: 'session-recovery',
      kernelId: 'kernel-recovery',
      submissionDigest: `sha256:${'b'.repeat(64)}`,
      actionDigest,
    });
  const makeJob = (id, status, phase, overrides = {}) => ({
    id,
    status,
    phase,
    projectId: 'project-recovery',
    rootPath: '/workspace/project-recovery',
    authorityContext: recoveryAuthority(),
    authorityContextStatus: 'bound',
    ...overrides,
  });

  const eligibleJobs = [
    makeJob('job-recovery-completed', 'completed', 'done'),
    makeJob('job-recovery-cancelled', 'cancelled', 'cancelled'),
    ...failedTerminalPhases.map((phase, index) =>
      makeJob(`job-recovery-failed-${index}`, 'failed', phase)
    ),
  ];
  const excludedJobs = [
    makeJob('job-recovery-running', 'running', 'execute_pending'),
    makeJob('job-recovery-retry', 'retry_pending', 'execute_validation'),
    makeJob('job-recovery-paused', 'paused_memory_pressure', 'paused_memory_pressure'),
    makeJob('job-recovery-awaiting', 'completed', 'awaiting_user_input'),
    makeJob('job-recovery-completed-contradiction', 'completed', 'cancelled'),
    makeJob('job-recovery-cancelled-contradiction', 'cancelled', 'done'),
    makeJob('job-recovery-failed-contradiction', 'failed', 'done'),
    makeJob('job-recovery-unbound-digest', 'completed', 'done', {
      authorityContext: recoveryAuthority(null),
    }),
    makeJob('job-recovery-malformed-digest', 'completed', 'done', {
      authorityContext: recoveryAuthority('sha256:not-a-valid-digest'),
    }),
    makeJob('job-recovery-legacy', 'completed', 'done', {
      authorityContext: null,
      authorityContextStatus: 'legacy_missing',
    }),
    makeJob('job-recovery-forged-status', 'completed', 'done', {
      authorityContextStatus: 'legacy_missing',
    }),
    makeJob('job-recovery-forged-binding', 'completed', 'done', {
      projectId: 'forged-project',
    }),
    makeJob('job-recovery-id-mismatch', 'completed', 'done', {
      id: 'job-recovery-other-id',
    }),
    makeJob('job-recovery-thenable', 'completed', 'done', {
      then: null,
    }),
  ];
  const unsafeKeyJob = makeJob('unsafe-recovery-id', 'completed', 'done');
  const allJobs = [...eligibleJobs, ...excludedJobs, unsafeKeyJob];
  const jobsById = Object.fromEntries(allJobs.map((job) => [job.id, job]));
  jobsById['job-recovery-id-mismatch'] = excludedJobs.at(-2);
  delete jobsById['job-recovery-other-id'];
  store.writeJobsState({
    jobsById,
    jobOrder: [
      eligibleJobs[1].id,
      excludedJobs[0].id,
      eligibleJobs[0].id,
      eligibleJobs[1].id,
    ],
  });

  const expectedIds = new Set(eligibleJobs.map((job) => job.id));
  const firstResult = store.listAuthorizedJobRecoveryCandidates();
  assert.deepStrictEqual(Object.keys(firstResult).sort(), ['jobIds', 'ok']);
  assert.strictEqual(firstResult.ok, true);
  assert.deepStrictEqual(new Set(firstResult.jobIds), expectedIds);
  assert.strictEqual(firstResult.jobIds.length, expectedIds.size);
  const serializedResult = JSON.stringify(firstResult);
  assert.strictEqual(serializedResult.includes('authorityContext'), false);
  assert.strictEqual(serializedResult.includes('project-recovery'), false);
  assert.strictEqual(serializedResult.includes('sha256:'), false);

  const restartedStore = createStore(recoveryRoot, { MAX_JOBS_STORED: 100 });
  const restartedResult = restartedStore.listAuthorizedJobRecoveryCandidates();
  assert.deepStrictEqual(new Set(restartedResult.jobIds), expectedIds);
  assert.strictEqual(restartedResult.jobIds.length, expectedIds.size);
}

function runAtomicJobsPersistenceTests(tempRoot) {
  const crashRoot = path.join(tempRoot, 'atomic-jobs-crash');
  const jobsPath = path.join(crashRoot, 'jobs.json');
  const previousState = {
    jobsById: {
      'job-previous': { id: 'job-previous', status: 'completed', phase: 'done' },
    },
    jobOrder: ['job-previous'],
  };
  const nextState = {
    jobsById: {
      'job-next': { id: 'job-next', status: 'failed', phase: 'runtime_interrupted' },
    },
    jobOrder: ['job-next'],
  };
  const baselineStore = createStore(crashRoot);
  baselineStore.writeJobsState(previousState);
  const previousBytes = fs.readFileSync(jobsPath, 'utf8');

  const crashFs = Object.create(fs);
  let renameCalls = 0;
  crashFs.fsyncSync = (descriptor) => {
    if (fs.fstatSync(descriptor).isFile()) {
      const error = new Error('injected file fsync failure');
      error.code = 'EIO';
      throw error;
    }
    return fs.fsyncSync(descriptor);
  };
  crashFs.renameSync = (...args) => {
    renameCalls += 1;
    return fs.renameSync(...args);
  };
  const crashingStore = createStore(crashRoot, { fs: crashFs });
  assert.throws(
    () => crashingStore.writeJobsState(nextState),
    /injected file fsync failure/
  );
  assert.strictEqual(renameCalls, 0);
  assert.strictEqual(fs.readFileSync(jobsPath, 'utf8'), previousBytes);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(jobsPath, 'utf8')), previousState);
  assert.deepStrictEqual(
    fs.readdirSync(crashRoot).filter((name) => name !== 'jobs.json'),
    []
  );

  const durableRoot = path.join(tempRoot, 'atomic-jobs-durable');
  const durableJobsPath = path.join(durableRoot, 'jobs.json');
  const durableFs = Object.create(fs);
  const descriptorKinds = new Map();
  const durabilityEvents = [];
  durableFs.openSync = (...args) => {
    const descriptor = fs.openSync(...args);
    descriptorKinds.set(descriptor, fs.fstatSync(descriptor).isDirectory() ? 'directory' : 'file');
    return descriptor;
  };
  durableFs.fsyncSync = (descriptor) => {
    durabilityEvents.push(`fsync:${descriptorKinds.get(descriptor) || 'unknown'}`);
    return fs.fsyncSync(descriptor);
  };
  durableFs.closeSync = (descriptor) => {
    const result = fs.closeSync(descriptor);
    descriptorKinds.delete(descriptor);
    return result;
  };
  durableFs.renameSync = (sourcePath, destinationPath) => {
    durabilityEvents.push('rename');
    assert.strictEqual(path.dirname(sourcePath), durableRoot);
    assert.strictEqual(destinationPath, durableJobsPath);
    return fs.renameSync(sourcePath, destinationPath);
  };
  const durableStore = createStore(durableRoot, { fs: durableFs });
  durableStore.readJobsState();
  durabilityEvents.length = 0;
  durableStore.writeJobsState(nextState);
  assert.deepStrictEqual(durabilityEvents, ['fsync:file', 'rename', 'fsync:directory']);
  const reopenedStore = createStore(durableRoot);
  assert.deepStrictEqual(reopenedStore.readJobsState(), nextState);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(durableJobsPath, 'utf8')), nextState);
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(durableJobsPath).mode & 0o777, 0o600);
  }

  const orphanRoot = path.join(tempRoot, 'atomic-jobs-orphan');
  fs.mkdirSync(orphanRoot, { recursive: true });
  fs.writeFileSync(path.join(orphanRoot, '.jobs.json.999.orphan.tmp'), '{"jobsById":');
  const orphanStore = createStore(orphanRoot);
  assert.deepStrictEqual(orphanStore.readJobsState(), { jobsById: {}, jobOrder: [] });
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(orphanRoot, 'jobs.json'), 'utf8')),
    { jobsById: {}, jobOrder: [] }
  );

  const createDirectorySyncFailureFs = (code, counters) => {
    const simulatedFs = Object.create(fs);
    const kinds = new Map();
    simulatedFs.openSync = (...args) => {
      const descriptor = fs.openSync(...args);
      kinds.set(descriptor, fs.fstatSync(descriptor).isDirectory() ? 'directory' : 'file');
      return descriptor;
    };
    simulatedFs.fsyncSync = (descriptor) => {
      if (kinds.get(descriptor) === 'directory') {
        counters.directory += 1;
        const error = new Error(`injected directory fsync failure: ${code}`);
        error.code = code;
        throw error;
      }
      counters.file += 1;
      return fs.fsyncSync(descriptor);
    };
    simulatedFs.closeSync = (descriptor) => {
      const result = fs.closeSync(descriptor);
      kinds.delete(descriptor);
      return result;
    };
    return simulatedFs;
  };

  const knownWindowsRoot = path.join(tempRoot, 'atomic-jobs-windows-known');
  const knownWindowsCounters = { file: 0, directory: 0 };
  const knownWindowsStore = createStore(knownWindowsRoot, {
    fs: createDirectorySyncFailureFs('EINVAL', knownWindowsCounters),
    runtimePlatform: 'win32',
  });
  knownWindowsStore.writeJobsState(nextState);
  assert.ok(knownWindowsCounters.file >= 1);
  assert.ok(knownWindowsCounters.directory >= 1);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(knownWindowsRoot, 'jobs.json'), 'utf8')),
    nextState
  );

  const unknownWindowsRoot = path.join(tempRoot, 'atomic-jobs-windows-unknown');
  const unknownWindowsCounters = { file: 0, directory: 0 };
  const unknownWindowsStore = createStore(unknownWindowsRoot, {
    fs: createDirectorySyncFailureFs('EIO', unknownWindowsCounters),
    runtimePlatform: 'win32',
  });
  assert.throws(
    () => unknownWindowsStore.writeJobsState(nextState),
    (error) => error && error.code === 'EIO'
  );
  assert.ok(unknownWindowsCounters.file >= 1);
  assert.ok(unknownWindowsCounters.directory >= 1);
}

function runUnhealthyJobsStorageTests(tempRoot) {
  const corruptRoot = path.join(tempRoot, 'unhealthy-jobs-parse');
  const corruptJobsPath = path.join(corruptRoot, 'jobs.json');
  const corruptBytes = '{broken';
  fs.mkdirSync(corruptRoot, { recursive: true });
  fs.writeFileSync(corruptJobsPath, corruptBytes, 'utf8');

  const corruptStore = createStore(corruptRoot);
  assert.deepStrictEqual(
    corruptStore.listAuthorizedJobRecoveryCandidates(),
    { ok: false, jobIds: [] }
  );
  let recoveryCalls = 0;
  const startupRecovery = createAgenticDeleteStartupRecoveryService({
    recoverInterruptedJobs: corruptStore.recoverInterruptedJobs,
    listAuthorizedJobRecoveryCandidates: corruptStore.listAuthorizedJobRecoveryCandidates,
    recoverJob() {
      recoveryCalls += 1;
      throw new Error('corrupt storage must never reach recovery');
    },
  });
  const startupResult = startupRecovery.recoverAtStartup({
    reason: 'runtime_restarted_before_job_completed',
  });
  assert.strictEqual(startupResult.ok, false);
  assert.strictEqual(startupResult.attemptedRecoveries, 0);
  assert.strictEqual(recoveryCalls, 0);

  assert.throws(
    () => corruptStore.createAssistantJob({ userMessage: 'não sobrescrever corrupção' }),
    (error) => error && error.code === 'jobs_storage_unhealthy'
  );
  assert.throws(
    () => corruptStore.writeJobsState({ jobsById: {}, jobOrder: [] }),
    (error) => error && error.code === 'jobs_storage_unhealthy'
  );
  assert.strictEqual(fs.readFileSync(corruptJobsPath, 'utf8'), corruptBytes);

  const repairedState = {
    jobsById: {
      'job-repaired': { id: 'job-repaired', status: 'completed', phase: 'done' },
    },
    jobOrder: ['job-repaired'],
  };
  fs.writeFileSync(corruptJobsPath, JSON.stringify(repairedState), 'utf8');
  assert.throws(
    () => corruptStore.writeJobsState({ jobsById: {}, jobOrder: [] }),
    (error) => error && error.code === 'jobs_storage_unhealthy'
  );
  assert.deepStrictEqual(corruptStore.readJobsState(), repairedState);
  corruptStore.writeJobsState({ jobsById: {}, jobOrder: [] });
  assert.deepStrictEqual(corruptStore.readJobsState(), { jobsById: {}, jobOrder: [] });

  const invalidShapeRoot = path.join(tempRoot, 'unhealthy-jobs-shape');
  const invalidShapePath = path.join(invalidShapeRoot, 'jobs.json');
  const invalidShapeBytes = '{"jobsById":[],"jobOrder":{}}';
  fs.mkdirSync(invalidShapeRoot, { recursive: true });
  fs.writeFileSync(invalidShapePath, invalidShapeBytes, 'utf8');
  const invalidShapeStore = createStore(invalidShapeRoot);
  assert.deepStrictEqual(
    invalidShapeStore.listAuthorizedJobRecoveryCandidates(),
    { ok: false, jobIds: [] }
  );
  assert.throws(
    () => invalidShapeStore.createAssistantJob({ userMessage: 'shape inválido' }),
    (error) => error && error.code === 'jobs_storage_unhealthy'
  );
  assert.strictEqual(fs.readFileSync(invalidShapePath, 'utf8'), invalidShapeBytes);
}

function runAuthorityAndLifecycleTests(tempRoot) {
  const authorityRoot = path.join(tempRoot, 'authority-lifecycle');
  const terminalSnapshots = [];
  const uuids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
  ];
  let uuidIndex = 0;
  const store = createStore(authorityRoot, {
    MAX_JOBS_STORED: 20,
    randomUUID: () => uuids[uuidIndex++],
    onJobTerminal: (snapshot) => {
      const persisted = JSON.parse(fs.readFileSync(path.join(authorityRoot, 'jobs.json'), 'utf8'));
      assert.deepStrictEqual(persisted.jobsById[snapshot.id], snapshot);
      terminalSnapshots.push(snapshot);
    },
  });

  let hostileGetterCalled = false;
  const accessorContext = buildAuthorityContext();
  Object.defineProperty(accessorContext, 'kernelId', {
    enumerable: true,
    get() {
      hostileGetterCalled = true;
      return 'kernel-from-getter';
    },
  });
  assert.strictEqual(
    store.createAssistantJob({ userMessage: 'getter hostil', authorityContext: accessorContext }).ok,
    false
  );
  assert.strictEqual(hostileGetterCalled, false);

  const symbolContext = buildAuthorityContext();
  symbolContext[Symbol('hidden-authority')] = 'hidden';
  assert.strictEqual(
    store.createAssistantJob({ userMessage: 'symbol hostil', authorityContext: symbolContext }).ok,
    false
  );

  assert.strictEqual(
    store.createAssistantJob({
      userMessage: 'digest antecipado',
      authorityContext: buildAuthorityContext({ actionDigest: `sha256:${'a'.repeat(64)}` }),
    }).ok,
    false
  );
  assert.strictEqual(
    store.createAuthorizedAssistantJob({ userMessage: 'sem autoridade' }).code,
    'authority_context_required'
  );
  assert.strictEqual(
    store.createAssistantJob({ userMessage: 'strict explícito', requireAuthorityContext: true }).code,
    'authority_context_required'
  );

  const authorityInput = buildAuthorityContext();
  const crossBound = store.createAuthorizedAssistantJob({
    projectId: 'renderer-cross-bound-project',
    rootPath: '/renderer/cross-bound-root',
    userMessage: 'criar com proveniência',
    authorityContext: authorityInput,
  });
  assert.strictEqual(crossBound.ok, false);
  assert.strictEqual(crossBound.code, 'authority_binding_mismatch');

  const created = store.createAuthorizedAssistantJob({
    userMessage: 'criar com proveniência',
    authorityContext: authorityInput,
  });
  assert.strictEqual(created.ok, true);
  assert.strictEqual(created.job.id, `job-${uuids[0]}`);
  assert.strictEqual(created.job.authorityContextStatus, 'bound');
  assert.strictEqual(created.job.projectId, authorityInput.projectId);
  assert.strictEqual(created.job.rootPath, authorityInput.canonicalRootPath);
  assert.notStrictEqual(created.job.authorityContext, authorityInput);

  authorityInput.projectId = 'renderer-mutated-project';
  authorityInput.actionDigest = `sha256:${'f'.repeat(64)}`;
  created.job.authorityContext.kernelId = 'caller-mutated-kernel';
  const persistedCreated = store.getAuthorizedJobById(created.job.id).job;
  assert.strictEqual(persistedCreated.authorityContext.projectId, 'project-authority');
  assert.strictEqual(persistedCreated.authorityContext.kernelId, 'kernel-authority');
  assert.strictEqual(persistedCreated.authorityContext.actionDigest, null);

  const sensitiveEvent = store.appendJobEvent(created.job.id, 'job.sensitive_test', {
    sessionId: 'session-must-not-leak',
    nested: {
      actionDigest: `sha256:${'e'.repeat(64)}`,
      canonicalRootPath: '/canonical/must-not-leak',
    },
  });
  assert.strictEqual(sensitiveEvent.ok, true);
  const publicJob = store.getJobById(created.job.id).job;
  assert.strictEqual(Object.hasOwn(publicJob, 'authorityContext'), false);
  assert.strictEqual(Object.hasOwn(publicJob, 'rootPath'), true);
  assert.strictEqual(JSON.stringify(publicJob).includes('session-must-not-leak'), false);
  assert.strictEqual(JSON.stringify(publicJob).includes('/canonical/must-not-leak'), false);
  assert.strictEqual(
    Object.hasOwn(store.listJobs({ projectId: 'project-authority' }).jobs[0], 'authorityContext'),
    false
  );

  const pristineAuthorityState = store.readJobsState();
  const forgedStatusState = JSON.parse(JSON.stringify(pristineAuthorityState));
  forgedStatusState.jobsById[created.job.id].authorityContextStatus = 'legacy_missing';
  store.writeJobsState(forgedStatusState);
  assert.strictEqual(
    store.bindJobActionDigest(created.job.id, `sha256:${'a'.repeat(64)}`).code,
    'authority_status_invalid'
  );

  const forgedSchemaState = JSON.parse(JSON.stringify(pristineAuthorityState));
  forgedSchemaState.jobsById[created.job.id].authorityContext.extraAuthority = 'forged';
  store.writeJobsState(forgedSchemaState);
  assert.strictEqual(
    store.bindJobActionDigest(created.job.id, `sha256:${'a'.repeat(64)}`).code,
    'authority_context_invalid'
  );

  const forgedBindingState = JSON.parse(JSON.stringify(pristineAuthorityState));
  forgedBindingState.jobsById[created.job.id].projectId = 'forged-project';
  store.writeJobsState(forgedBindingState);
  assert.strictEqual(
    store.bindJobActionDigest(created.job.id, `sha256:${'a'.repeat(64)}`).code,
    'authority_binding_invalid'
  );
  store.writeJobsState(pristineAuthorityState);

  const actionDigest = `sha256:${'a'.repeat(64)}`;
  assert.strictEqual(store.bindJobActionDigest(created.job.id, 'not-a-digest').ok, false);
  const firstBind = store.bindJobActionDigest(created.job.id, actionDigest);
  assert.strictEqual(firstBind.ok, true);
  assert.strictEqual(firstBind.idempotent, false);
  assert.strictEqual(firstBind.job.authorityContext.actionDigest, actionDigest);
  assert.deepStrictEqual(firstBind.job.events[0].payload, {});

  const eventCountAfterBind = firstBind.job.events.length;
  const repeatedBind = store.bindJobActionDigest(created.job.id, actionDigest);
  assert.strictEqual(repeatedBind.ok, true);
  assert.strictEqual(repeatedBind.idempotent, true);
  assert.strictEqual(repeatedBind.job.events.length, eventCountAfterBind);
  assert.strictEqual(
    store.bindJobActionDigest(created.job.id, `sha256:${'b'.repeat(64)}`).code,
    'action_digest_conflict'
  );

  const completed = store.markJobCompleted(created.job.id, {
    source: 'test',
    canary: true,
    canaryPromotionId: 'canary-promotion-state-1',
  });
  assert.strictEqual(completed.ok, true);
  assert.strictEqual(terminalSnapshots.length, 1);
  assert.strictEqual(terminalSnapshots[0].status, 'completed');
  assert.strictEqual(store.bindJobActionDigest(created.job.id, actionDigest).code, 'job_terminal');

  const completedSnapshot = store.getAuthorizedJobById(created.job.id).job;
  assert.strictEqual(store.markJobPhase(created.job.id, 'execute_pending').code, 'job_terminal');
  assert.strictEqual(store.markJobRetryPending(created.job.id, 'retry').code, 'job_terminal');
  assert.strictEqual(store.markJobPausedForMemory(created.job.id).code, 'job_terminal');
  assert.strictEqual(store.appendJobEvent(created.job.id, 'late.event').code, 'job_terminal');
  assert.strictEqual(store.setJobCheckpoint(created.job.id, 'late', {}).code, 'job_terminal');
  assert.deepStrictEqual(store.getAuthorizedJobById(created.job.id).job, completedSnapshot);
  assert.strictEqual(store.markJobCompleted(created.job.id).code, 'job_terminal');
  assert.strictEqual(terminalSnapshots.length, 1);
  const rollbackCompletion = Object.freeze({
    promotionId: 'canary-promotion-state-1',
    reconciliationId: `rollback-${'c'.repeat(64)}`,
    sourceRestored: true,
  });
  const rolledBack = store.markJobCanaryRolledBack(
    created.job.id,
    rollbackCompletion
  );
  assert.strictEqual(rolledBack.ok, true);
  assert.strictEqual(rolledBack.idempotent, false);
  assert.strictEqual(rolledBack.job.status, 'completed');
  assert.strictEqual(rolledBack.job.phase, 'done');
  assert.deepStrictEqual(rolledBack.job.canaryRollback, {
    status: 'completed',
    promotionId: rollbackCompletion.promotionId,
    reconciliationId: rollbackCompletion.reconciliationId,
    sourceRestored: true,
  });
  assert.deepStrictEqual(rolledBack.job.events[0].payload, {
    promotionId: rollbackCompletion.promotionId,
    reconciliationId: rollbackCompletion.reconciliationId,
    sourceRestored: true,
  });
  assert.strictEqual(rolledBack.job.events[0].type, 'job.canary_rolled_back');
  assert.strictEqual(terminalSnapshots.length, 1);

  const restartedStore = createStore(authorityRoot);
  const repeatedRollback = restartedStore.markJobCanaryRolledBack(
    created.job.id,
    rollbackCompletion
  );
  assert.strictEqual(
    repeatedRollback.ok,
    true,
    JSON.stringify(repeatedRollback)
  );
  assert.strictEqual(repeatedRollback.idempotent, true);
  assert.strictEqual(
    repeatedRollback.job.events.filter(
      (event) => event.type === 'job.canary_rolled_back'
    ).length,
    1
  );
  assert.strictEqual(
    restartedStore.markJobCanaryRolledBack(created.job.id, Object.freeze({
      ...rollbackCompletion,
      promotionId: 'canary-promotion-state-other',
    })).code,
    'canary_rollback_unavailable'
  );
  assert.strictEqual(
    restartedStore.markJobCanaryRolledBack(created.job.id, Object.freeze({
      ...rollbackCompletion,
      reconciliationId: `rollback-${'d'.repeat(64)}`,
    })).code,
    'canary_rollback_conflict'
  );
  assert.strictEqual(store.getJobById('__proto__').code, 'invalid_job_id');
  assert.strictEqual(store.getAuthorizedJobById('job-__proto__').code, 'invalid_job_id');
  assert.strictEqual(store.appendJobEvent('__proto__', 'forged').code, 'invalid_job_id');

  const failedJob = store.createAssistantJob({ userMessage: 'falhar' }).job;
  assert.strictEqual(failedJob.authorityContext, null);
  assert.strictEqual(failedJob.authorityContextStatus, 'legacy_missing');
  assert.strictEqual(store.bindJobActionDigest(failedJob.id, actionDigest).code, 'authority_context_missing');
  assert.strictEqual(store.markJobFailed(failedJob.id, 'expected_failure').ok, true);
  assert.strictEqual(terminalSnapshots.at(-1).status, 'failed');
  assert.strictEqual(terminalSnapshots.at(-1).phase, 'failed');

  const cancelledJob = store.createAssistantJob({ userMessage: 'cancelar' }).job;
  assert.strictEqual(store.markJobCancelled(cancelledJob.id).ok, true);
  assert.strictEqual(terminalSnapshots.at(-1).status, 'cancelled');

  const runningJob = store.createAssistantJob({ userMessage: 'interromper running' }).job;
  const retryPendingJob = store.createAssistantJob({ userMessage: 'interromper retry' }).job;
  const retryPending = store.markJobRetryPending(
    retryPendingJob.id,
    'provider timeout',
    'persona_plan'
  );
  assert.strictEqual(retryPending.ok, true);
  assert.strictEqual(retryPending.job.status, 'retry_pending');
  assert.strictEqual(terminalSnapshots.some((snapshot) => snapshot.id === retryPendingJob.id), false);

  const orphanedState = store.readJobsState();
  orphanedState.jobOrder = [retryPendingJob.id, retryPendingJob.id, 'job-missing-from-state'];
  store.writeJobsState(orphanedState);

  const recovery = store.recoverInterruptedJobs('runtime_restart_test');
  assert.strictEqual(recovery.ok, true);
  assert.strictEqual(recovery.recovered, 2);
  assert.deepStrictEqual(new Set(recovery.jobIds), new Set([runningJob.id, retryPendingJob.id]));
  const reconciledState = store.readJobsState();
  assert.strictEqual(new Set(reconciledState.jobOrder).size, reconciledState.jobOrder.length);
  assert.strictEqual(reconciledState.jobOrder.includes('job-missing-from-state'), false);
  assert.deepStrictEqual(new Set(reconciledState.jobOrder), new Set(Object.keys(reconciledState.jobsById)));
  assert.strictEqual(reconciledState.jobOrder.includes(runningJob.id), true);
  const recoveredSnapshots = terminalSnapshots.filter(
    (snapshot) => snapshot.phase === 'runtime_interrupted'
  );
  assert.strictEqual(recoveredSnapshots.length, 2);
  recoveredSnapshots.forEach((snapshot) => {
    assert.strictEqual(snapshot.status, 'failed');
    assert.strictEqual(snapshot.lastError, 'runtime_restart_test');
  });

  const actionAudit = store
    .readOrchestrationState()
    .auditTrail.find((event) => event.type === 'job.action_digest_bound');
  assert.deepStrictEqual(actionAudit.payload, { jobId: created.job.id });

  const awaitingRoot = path.join(tempRoot, 'awaiting-user-input-terminal');
  const awaitingSnapshots = [];
  const awaitingStore = createStore(awaitingRoot, {
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
    onJobTerminal: (snapshot) => awaitingSnapshots.push(snapshot),
  });
  const awaitingJob = awaitingStore.createAssistantJob({ userMessage: 'precisa de resposta' }).job;
  const awaitingResult = awaitingStore.markJobAwaitingUserInput(awaitingJob.id, {
    reason: 'briefing_clarification_needed',
    questions: ['Qual plataforma?'],
  });
  assert.strictEqual(awaitingResult.ok, true);
  assert.strictEqual(awaitingResult.job.status, 'completed');
  assert.strictEqual(awaitingResult.job.phase, 'awaiting_user_input');
  assert.strictEqual(awaitingResult.job.progress.pct, 100);
  assert.strictEqual(awaitingResult.job.retryState.retryable, false);
  assert.strictEqual(awaitingResult.job.retryState.nextRetryAt, null);
  assert.strictEqual(awaitingResult.job.events[0].type, 'job.awaiting_user_input');
  assert.strictEqual(awaitingSnapshots.length, 1);
  assert.strictEqual(awaitingSnapshots[0].status, 'completed');
  assert.strictEqual(awaitingSnapshots[0].phase, 'awaiting_user_input');
  assert.strictEqual(awaitingStore.getJobById(awaitingJob.id).job.phase, 'awaiting_user_input');
  assert.strictEqual(awaitingStore.markJobRetryPending(awaitingJob.id, 'retry').code, 'job_terminal');
  assert.strictEqual(awaitingStore.markJobPhase(awaitingJob.id, 'execute_pending').code, 'job_terminal');
  assert.strictEqual(awaitingStore.recoverInterruptedJobs().recovered, 0);

  const throwingRoot = path.join(tempRoot, 'throwing-terminal-hook');
  const throwingStore = createStore(throwingRoot, {
    onJobTerminal: () => {
      throw new Error('observer failure');
    },
  });
  const throwingJob = throwingStore.createAssistantJob({ userMessage: 'hook falha' }).job;
  const terminalDespiteHookFailure = throwingStore.markJobCompleted(throwingJob.id);
  assert.strictEqual(terminalDespiteHookFailure.ok, true);
  assert.strictEqual(throwingStore.getJobById(throwingJob.id).job.status, 'completed');

  const auditFailureRoot = path.join(tempRoot, 'audit-write-failure');
  const auditFailureFs = Object.create(fs);
  auditFailureFs.writeFileSync = (targetPath, ...args) => {
    if (path.basename(String(targetPath)) === 'orchestration.json') {
      throw new Error('audit storage unavailable');
    }
    return fs.writeFileSync(targetPath, ...args);
  };
  const auditFailureStore = createStore(auditFailureRoot, { fs: auditFailureFs });
  const auditFailureCreated = auditFailureStore.createAssistantJob({
    userMessage: 'persistir sem audit secundário',
  });
  assert.strictEqual(auditFailureCreated.ok, true);
  assert.strictEqual(
    auditFailureStore.markJobPhase(auditFailureCreated.job.id, 'persona_plan').ok,
    true
  );
  assert.strictEqual(auditFailureStore.markJobCompleted(auditFailureCreated.job.id).ok, true);
  const durableAuditFailureJob = auditFailureStore.getAuthorizedJobById(
    auditFailureCreated.job.id
  ).job;
  assert.strictEqual(durableAuditFailureJob.status, 'completed');
  assert.strictEqual(durableAuditFailureJob.events[0].type, 'job.completed');
  assert.strictEqual(
    durableAuditFailureJob.events.some((event) => event.type === 'job.phase_changed'),
    true
  );

  const weakUuidRoot = path.join(tempRoot, 'weak-uuid');
  const weakUuidValues = [undefined, 'bad\0uuid', '00000000-0000-1000-8000-000000000001'];
  let weakUuidCalls = 0;
  const weakUuidStore = createStore(weakUuidRoot, {
    randomUUID: () => weakUuidValues[weakUuidCalls++],
  });
  assert.strictEqual(weakUuidStore.createAssistantJob({ userMessage: 'uuid fraco' }).ok, false);
  assert.strictEqual(weakUuidCalls, 3);

  const collisionRoot = path.join(tempRoot, 'uuid-collision');
  const firstUuid = '10000000-0000-4000-8000-000000000001';
  const secondUuid = '20000000-0000-4000-8000-000000000002';
  const collisionValues = [firstUuid, firstUuid, secondUuid];
  let collisionCalls = 0;
  const collisionStore = createStore(collisionRoot, {
    randomUUID: () => collisionValues[collisionCalls++],
  });
  assert.strictEqual(collisionStore.createAssistantJob({ userMessage: 'primeiro uuid' }).job.id, `job-${firstUuid}`);
  assert.strictEqual(collisionStore.createAssistantJob({ userMessage: 'colisão uuid' }).job.id, `job-${secondUuid}`);
  assert.strictEqual(collisionCalls, 3);
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-orchestration-state-'));
  try {
    const store = createStore(tempRoot);

    assert.deepStrictEqual(store.readOrchestrationState(), {
      conversationsByProject: {},
      messagesByConversation: {},
      cortexLearningByProject: {},
      auditTrail: [],
    });

    const conversationResult = store.addConversationEntry('project-1', '  Conversa   Principal  ', { source: 'test' });
    assert.strictEqual(conversationResult.ok, true);
    assert.strictEqual(conversationResult.conversation.title, 'Conversa Principal');

    const conversationId = conversationResult.conversation.id;
    const firstMessage = store.addConversationMessage('project-1', conversationId, 'user', 'Olá', { mode: 'chat' });
    const duplicateMessage = store.addConversationMessage('project-1', conversationId, 'user', 'Olá', { mode: 'chat' });
    assert.strictEqual(firstMessage.ok, true);
    assert.strictEqual(duplicateMessage.deduplicated, true);
    assert.strictEqual(store.listConversationMessages(conversationId, 20).messages.length, 1);

    const renameResult = store.renameConversationEntry('project-1', conversationId, 'Renomeada');
    assert.strictEqual(renameResult.ok, true);
    assert.strictEqual(renameResult.conversation.title, 'Renomeada');

    const learningResult = store.upsertCortexLearning('project-1', {
      ia1: [{ summary: 'executor' }],
      ia2: [{ summary: 'persona' }],
      events: [{ type: 'learned' }],
    });
    assert.strictEqual(learningResult.ok, true);
    assert.strictEqual(store.getCortexLearning('project-1').learning.executor.length, 1);

    const topicResult = store.upsertCortexTopic('project-1', {
      id: 'design',
      label: 'Design System',
    });
    assert.strictEqual(topicResult.ok, true);
    assert.strictEqual(store.getCortexLearning('project-1').learning.topics[0].label, 'Design System');

    const renamedTopic = store.renameCortexTopic('project-1', 'design', 'UI e Experiência');
    assert.strictEqual(renamedTopic.ok, true);
    assert.strictEqual(store.getCortexLearning('project-1').learning.topics[0].label, 'UI e Experiência');

    const jobResult = store.createAssistantJob({
      projectId: 'project-1',
      rootPath: tempRoot,
      userMessage: 'executar tarefa',
      attachments: [{ name: 'a.txt' }],
      mode: 'test',
    });
    assert.strictEqual(jobResult.ok, true);
    const jobId = jobResult.job.id;
    assert.match(
      jobId,
      /^job-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.strictEqual(jobResult.job.authorityContext, null);
    assert.strictEqual(jobResult.job.authorityContextStatus, 'legacy_missing');

    const phaseResult = store.markJobPhase(jobId, 'persona_plan', { step: 1 });
    assert.strictEqual(phaseResult.ok, true);
    assert.strictEqual(phaseResult.job.phase, 'persona_plan');
    assert.ok(phaseResult.job.progress.pct >= 18);

    const checkpointResult = store.setJobCheckpoint(jobId, 'plan', { ok: true });
    assert.strictEqual(checkpointResult.ok, true);
    assert.deepStrictEqual(checkpointResult.job.checkpoints.plan.data, { ok: true });

    const retryResult = store.markJobRetryPending(jobId, 'provider timeout retry-after:2', 'persona_plan');
    assert.strictEqual(retryResult.ok, true);
    assert.strictEqual(retryResult.job.status, 'retry_pending');
    assert.strictEqual(retryResult.job.retryState.retryable, true);

    const visualRetryResult = store.markJobRetryPending(jobId, 'visual_validation_failed', 'execute_validation');
    assert.strictEqual(visualRetryResult.ok, true);
    assert.strictEqual(visualRetryResult.job.status, 'retry_pending');
    assert.strictEqual(visualRetryResult.job.retryState.retryable, false);
    assert.strictEqual(visualRetryResult.job.retryState.nextRetryAt, null);

    const cancelledResult = store.markJobCancelled(jobId);
    assert.strictEqual(cancelledResult.ok, true);
    assert.strictEqual(store.isJobCancelled(jobId), true);
    assert.strictEqual(store.listJobs({ projectId: 'project-1' }).jobs.length, 1);

    const interruptedJob = store.createAssistantJob({
      projectId: 'project-1',
      rootPath: tempRoot,
      userMessage: 'execução verificada',
      mode: 'test',
    });
    assert.strictEqual(interruptedJob.ok, true);
    store.markJobPhase(interruptedJob.job.id, 'execute_staging', { step: 'visual-smoke' });

    const recoveryResult = store.recoverInterruptedJobs('runtime_restart');
    assert.strictEqual(recoveryResult.ok, true);
    assert.strictEqual(recoveryResult.recovered, 1);
    assert.deepStrictEqual(recoveryResult.jobIds, [interruptedJob.job.id]);

    const recoveredJob = store.getJobById(interruptedJob.job.id).job;
    assert.strictEqual(recoveredJob.status, 'failed');
    assert.strictEqual(recoveredJob.phase, 'runtime_interrupted');
    assert.strictEqual(recoveredJob.lastError, 'runtime_restart');
    assert.strictEqual(recoveredJob.retryState.retryable, false);
    assert.strictEqual(recoveredJob.events[0].type, 'job.interrupted');

    store.removeProjectConversationHistory('project-1');
    const stateAfterRemoval = store.readOrchestrationState();
    assert.strictEqual(stateAfterRemoval.conversationsByProject['project-1'], undefined);
    assert.strictEqual(stateAfterRemoval.messagesByConversation[conversationId], undefined);
    assert.strictEqual(stateAfterRemoval.cortexLearningByProject['project-1'], undefined);

    assert.ok(stateAfterRemoval.auditTrail.some((event) => event.type === 'conversation.added'));
    assert.ok(stateAfterRemoval.auditTrail.some((event) => event.type === 'job.cancelled'));
    assert.ok(stateAfterRemoval.auditTrail.some((event) => event.type === 'job.interrupted'));

    runAuthorityAndLifecycleTests(tempRoot);
    runAuthorizedRecoveryCandidateTests(tempRoot);
    runAtomicJobsPersistenceTests(tempRoot);
    runUnhealthyJobsStorageTests(tempRoot);

    console.log('orchestration-state.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
