'use strict';

const fs = require('fs');
const path = require('path');

const { createOrchestrationStateStore } = require('../../cortex/orchestration/state_store');
const {
  createTransactionJournalAuthenticator,
} = require('../../main/security/transaction_journal_authenticator');
const {
  createTransactionalFilesystemDeleteService,
} = require('../../main/services/transactional_filesystem_delete_service');
const {
  createAnchoredMutationTestBackend,
} = require('../support/anchored_mutation_test_backend');

const projectRoot = process.argv[2];
const userDataRoot = process.argv[3];
if (!projectRoot || !userDataRoot) process.exit(2);

const digest = (character) => `sha256:${character.repeat(64)}`;
const realRootPath = fs.realpathSync(projectRoot);
let uuidSerial = 0;

const stateStore = createOrchestrationStateStore({
  computeRetryBackoffMs: () => 1_000,
  fs,
  getUserDataPath: () => userDataRoot,
  isNonRetriableProviderReason: () => false,
  path,
  randomUUID: () => {
    uuidSerial += 1;
    return `00000000-0000-4000-8000-${String(uuidSerial).padStart(12, '0')}`;
  },
});
const allow = (candidate) => Object.freeze({ authorized: true, binding: candidate });
const transactionService = createTransactionalFilesystemDeleteService({
  authorizeLifecycle: allow,
  authorizeRoot: (candidate) => Object.freeze({
    ok: true,
    authorized: true,
    projectId: candidate.projectId,
    rootPath: candidate.canonicalRootPath,
    canonicalRootPath: candidate.canonicalRootPath,
    realRootPath: candidate.realRootPath,
  }),
  authorizeEffectFrontier: allow,
  journalAuthenticator: createTransactionJournalAuthenticator({ storageDir: userDataRoot }),
  mutationBackend: createAnchoredMutationTestBackend(),
});

function commitJob({ serial, fileName, terminal = false }) {
  const authorityContext = {
    schemaVersion: 'assistant-job-authority.v1',
    projectId: 'project-startup-recovery',
    canonicalRootPath: realRootPath,
    realRootPath,
    sessionId: `session-startup-recovery-${serial}`,
    kernelId: `kernel-startup-recovery-${serial}`,
    submissionDigest: digest(serial),
    actionDigest: null,
  };
  const created = stateStore.createAuthorizedAssistantJob({
    authorityContext,
    userMessage: `delete ${fileName}`,
  });
  if (!created || created.ok !== true) process.exit(3);
  const bound = stateStore.bindJobActionDigest(created.job.id, digest('f'));
  if (!bound || bound.ok !== true) process.exit(4);
  const binding = Object.freeze({
    projectId: authorityContext.projectId,
    canonicalRootPath: authorityContext.canonicalRootPath,
    realRootPath: authorityContext.realRootPath,
    sessionId: authorityContext.sessionId,
    jobId: created.job.id,
    kernelId: authorityContext.kernelId,
    submissionDigest: authorityContext.submissionDigest,
  });
  const prepared = transactionService.prepare({
    binding,
    paths: [fileName],
    pathStyle: 'posix',
    caseSensitive: true,
  });
  const committed = prepared.commit({
    decisionRequestDigest: digest('c'),
    consumeDecision: () => Object.freeze({ authorized: true }),
  });
  if (!committed || committed.ok !== true || committed.state !== 'COMMITTED') process.exit(5);
  if (terminal) {
    const completed = stateStore.markJobCompleted(created.job.id, { source: 'process-one' });
    if (!completed || completed.ok !== true) process.exit(6);
  }
  return created.job.id;
}

const rollbackJobId = commitJob({ serial: 'a', fileName: 'rollback.txt' });
const purgeJobId = commitJob({ serial: 'b', fileName: 'purge.txt', terminal: true });
process.stdout.write(JSON.stringify({ rollbackJobId, purgeJobId }));
