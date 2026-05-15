const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createOrchestrationStateStore } = require('../cortex/orchestration/state_store');

function createStore(tempRoot) {
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
    MAX_AUDIT_EVENTS: 8,
    MAX_CONVERSATION_MESSAGES: 3,
    MAX_CORTEX_LEARNING_EVENTS: 3,
    MAX_JOB_EVENTS: 6,
    MAX_JOBS_STORED: 4,
    computeRetryBackoffMs: () => 1000,
    fs,
    getUserDataPath: () => tempRoot,
    isNonRetriableProviderReason: (reason) => String(reason || '').includes('nonretry'),
    path,
  });
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

    const cancelledResult = store.markJobCancelled(jobId);
    assert.strictEqual(cancelledResult.ok, true);
    assert.strictEqual(store.isJobCancelled(jobId), true);
    assert.strictEqual(store.listJobs({ projectId: 'project-1' }).jobs.length, 1);

    store.removeProjectConversationHistory('project-1');
    const stateAfterRemoval = store.readOrchestrationState();
    assert.strictEqual(stateAfterRemoval.conversationsByProject['project-1'], undefined);
    assert.strictEqual(stateAfterRemoval.messagesByConversation[conversationId], undefined);
    assert.strictEqual(stateAfterRemoval.cortexLearningByProject['project-1'], undefined);

    assert.ok(stateAfterRemoval.auditTrail.some((event) => event.type === 'conversation.added'));
    assert.ok(stateAfterRemoval.auditTrail.some((event) => event.type === 'job.cancelled'));

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
