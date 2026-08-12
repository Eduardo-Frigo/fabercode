const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createOrchestrationStateStore } = require('../cortex/orchestration/state_store');

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

  const completed = store.markJobCompleted(created.job.id, { source: 'test' });
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
