'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createOrchestrationStateStore } = require('../cortex/orchestration/state_store');
const {
  createTransactionJournalAuthenticator,
} = require('../main/security/transaction_journal_authenticator');
const {
  createAgenticDeleteRecoveryService,
} = require('../main/services/agentic_delete_recovery_service');
const {
  createAgenticDeleteCancellationRecoveryAdapter,
} = require('../main/services/agentic_delete_cancellation_recovery_adapter');
const {
  createAgenticDeleteStartupRecoveryService,
} = require('../main/services/agentic_delete_startup_recovery_service');
const {
  createTransactionalFilesystemDeleteService,
} = require('../main/services/transactional_filesystem_delete_service');
const {
  createAnchoredMutationTestBackend,
} = require('./support/anchored_mutation_test_backend');

function physicalIdentity(rootPath) {
  const target = fs.statSync(rootPath);
  const entry = fs.lstatSync(rootPath);
  return Object.freeze({
    device: String(target.dev),
    inode: String(target.ino),
    entryDevice: String(entry.dev),
    entryInode: String(entry.ino),
    entryType: entry.isSymbolicLink() ? 'symlink' : 'directory',
  });
}

function createStateStore(userDataRoot) {
  return createOrchestrationStateStore({
    computeRetryBackoffMs: () => 1_000,
    fs,
    getUserDataPath: () => userDataRoot,
    isNonRetriableProviderReason: () => false,
    path,
  });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-startup-recovery-'));
try {
  const userDataRoot = path.join(tempRoot, 'user-data');
  const projectRoot = path.join(tempRoot, 'project');
  fs.mkdirSync(userDataRoot, { mode: 0o700 });
  fs.mkdirSync(projectRoot, { mode: 0o700 });
  fs.writeFileSync(path.join(projectRoot, 'rollback.txt'), 'restore-me', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'purge.txt'), 'delete-me', 'utf8');

  const child = childProcess.spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'fixtures', 'agentic_delete_committed_process.js'),
      projectRoot,
      userDataRoot,
    ],
    { encoding: 'utf8' }
  );
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  const childResult = JSON.parse(child.stdout);
  assert.strictEqual(typeof childResult.rollbackJobId, 'string');
  assert.strictEqual(typeof childResult.purgeJobId, 'string');
  assert.notStrictEqual(childResult.rollbackJobId, childResult.purgeJobId);
  assert.strictEqual(fs.existsSync(path.join(projectRoot, 'rollback.txt')), false);
  assert.strictEqual(fs.existsSync(path.join(projectRoot, 'purge.txt')), false);
  assert.strictEqual(
    fs.existsSync(path.join(projectRoot, '.faber', 'transaction-journal.key')),
    false,
    'authentication material must remain outside the project'
  );

  const stateStore = createStateStore(userDataRoot);
  const cancellationRequested = stateStore.markJobCancellationRequested(
    childResult.rollbackJobId,
    'cancelled_by_user'
  );
  assert.strictEqual(cancellationRequested.ok, true);
  assert.strictEqual(cancellationRequested.job.status, 'running');
  assert.strictEqual(cancellationRequested.job.phase, 'cancelling');
  const journalAuthenticator = createTransactionJournalAuthenticator({ storageDir: userDataRoot });
  const mutationBackend = createAnchoredMutationTestBackend();
  const recoveryService = createAgenticDeleteRecoveryService({
    getAuthorizedJobById: stateStore.getAuthorizedJobById,
    authorizeProjectBinding(projectId, rootPath) {
      const realRootPath = fs.realpathSync(projectRoot);
      return projectId === 'project-startup-recovery' && rootPath === realRootPath
        ? Object.freeze({
          ok: true,
          authorized: true,
          projectId,
          rootPath,
          canonicalRootPath: rootPath,
          realRootPath,
          physicalRootIdentity: physicalIdentity(realRootPath),
        })
        : Object.freeze({ ok: false, authorized: false });
    },
    createTransactionalRuntime(authority) {
      const transactional = createTransactionalFilesystemDeleteService({
        authorizeLifecycle: authority.authorizeLifecycle,
        authorizeRoot: authority.authorizeRoot,
        authorizeEffectFrontier: authority.authorizeEffectFrontier,
        journalAuthenticator,
        mutationBackend,
      });
      return Object.freeze({
        recoverProject: transactional.recoverProject,
        rollbackJob: transactional.rollbackJob,
        finalizeJob: transactional.finalizeJob,
      });
    },
  });
  const cancellationRecoveryAdapter = createAgenticDeleteCancellationRecoveryAdapter({
    getAuthorizedJobById: stateStore.getAuthorizedJobById,
    recoverJob: recoveryService.recoverJob,
    markJobCancelledAfterCleanup: stateStore.markJobCancelledAfterCleanup,
  });
  const startupRecovery = createAgenticDeleteStartupRecoveryService({
    recoverInterruptedJobs: stateStore.recoverInterruptedJobs,
    listAuthorizedJobRecoveryCandidates: stateStore.listAuthorizedJobRecoveryCandidates,
    recoverJob: cancellationRecoveryAdapter.recoverJob,
  });

  const result = startupRecovery.recoverAtStartup({
    reason: 'runtime_restarted_before_job_completed',
  });
  assert.deepStrictEqual(result, {
    ok: true,
    interruptedJobs: 0,
    listedCandidates: 2,
    uniqueCandidates: 2,
    attemptedRecoveries: 2,
    successfulRecoveries: 2,
    failedRecoveries: 0,
    deferredCandidates: 0,
  });
  assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'rollback.txt'), 'utf8'), 'restore-me');
  assert.strictEqual(
    fs.existsSync(path.join(projectRoot, 'purge.txt')),
    false,
    'completed/done must purge its retained quarantine rather than restore the source'
  );
  assert.deepStrictEqual(fs.readdirSync(path.join(projectRoot, '.faber', 'transactions')), []);
  const cancelledJob = stateStore.getAuthorizedJobById(childResult.rollbackJobId).job;
  assert.strictEqual(cancelledJob.status, 'cancelled');
  assert.strictEqual(cancelledJob.phase, 'cancelled');
  assert.deepStrictEqual(cancelledJob.checkpoints.execution_cleanup.data, {
    schemaVersion: 'assistant-job-execution-cleanup-receipt.v1',
    jobId: childResult.rollbackJobId,
    cleanupCompleted: true,
  });
  assert.strictEqual(
    stateStore.getAuthorizedJobById(childResult.purgeJobId).job.phase,
    'done'
  );

  const replayStore = createStateStore(userDataRoot);
  const replayCancellationRecoveryAdapter = createAgenticDeleteCancellationRecoveryAdapter({
    getAuthorizedJobById: replayStore.getAuthorizedJobById,
    recoverJob: recoveryService.recoverJob,
    markJobCancelledAfterCleanup: replayStore.markJobCancelledAfterCleanup,
  });
  const replayRecovery = createAgenticDeleteStartupRecoveryService({
    recoverInterruptedJobs: replayStore.recoverInterruptedJobs,
    listAuthorizedJobRecoveryCandidates: replayStore.listAuthorizedJobRecoveryCandidates,
    recoverJob: replayCancellationRecoveryAdapter.recoverJob,
  });
  const replay = replayRecovery.recoverAtStartup({
    reason: 'runtime_restarted_before_job_completed',
  });
  assert.strictEqual(replay.interruptedJobs, 0);
  assert.strictEqual(
    replay.listedCandidates,
    1,
    'cancelled jobs with cleanup receipts are excluded while completed legacy jobs remain'
  );
  assert.strictEqual(replay.attemptedRecoveries, 1);
  assert.strictEqual(replay.successfulRecoveries, 1);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('agentic delete startup recovery integration tests passed');
