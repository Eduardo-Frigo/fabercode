'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_DIRECTORY_NAME,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_FILE_NAME,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_RECORD_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION,
  createCanaryRolloutEvidenceJournalAdapter,
} = require('../main/services/canary_rollout_evidence_journal_adapter');
const {
  CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');

function evidence(jobId, overrides = {}) {
  return Object.freeze({
    schemaVersion: CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
    jobId,
    projectId: 'project-' + jobId,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    route: 'canary',
    eligible: true,
    terminal: true,
    succeeded: true,
    manualRollback: false,
    corrupted: false,
    dataLossIncident: false,
    securityIncident: false,
    duplicateExternalEffect: false,
    ...overrides,
  });
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function createStorage(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function persistedPath(storageDir) {
  return path.join(
    storageDir,
    CANARY_ROLLOUT_EVIDENCE_JOURNAL_DIRECTORY_NAME,
    CANARY_ROLLOUT_EVIDENCE_JOURNAL_FILE_NAME
  );
}

function testDurableReplayAndIntegrity() {
  const storageDir = createStorage('faber-canary-evidence-journal-');
  const journal = createCanaryRolloutEvidenceJournalAdapter({ storageDir });
  assert.strictEqual(
    CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION,
    'canary-rollout-evidence-journal.v1'
  );
  assert.deepStrictEqual(Reflect.ownKeys(journal), [
    'version', 'load', 'append', 'diagnostics',
  ]);
  assertDeepFrozen(journal);
  assert.deepStrictEqual(journal.load(), {
    schemaVersion: CANARY_ROLLOUT_EVIDENCE_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
    evidence: [],
  });

  const baseline = evidence('baseline-a', { route: 'baseline' });
  const canary = evidence('canary-a');
  assert.strictEqual(journal.append(baseline), undefined);
  assert.strictEqual(journal.append(canary), undefined);
  const filePath = persistedPath(storageDir);
  const lines = fs.readFileSync(filePath, 'utf8')
    .split('\n').filter(Boolean).map(JSON.parse);
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual(Reflect.ownKeys(lines[0]), [
    'schemaVersion', 'sequence', 'previousRecordDigest',
    'evidence', 'recordDigest',
  ]);
  assert.strictEqual(
    lines[0].schemaVersion,
    CANARY_ROLLOUT_EVIDENCE_JOURNAL_RECORD_SCHEMA_VERSION
  );
  assert.strictEqual(lines[0].sequence, 0);
  assert.strictEqual(lines[0].previousRecordDigest, null);
  assert.strictEqual(lines[1].sequence, 1);
  assert.strictEqual(lines[1].previousRecordDigest, lines[0].recordDigest);
  assert.match(lines[1].recordDigest, /^sha256:[a-f0-9]{64}$/);
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(path.dirname(filePath)).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(filePath).mode & 0o777, 0o600);
  }

  const reopened = createCanaryRolloutEvidenceJournalAdapter({ storageDir });
  const recovered = reopened.load();
  assert.deepStrictEqual(recovered.evidence, [baseline, canary]);
  assertDeepFrozen(recovered);
  assert.deepStrictEqual(reopened.diagnostics(), {
    version: CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION,
    storageMode: 'private_user_data_append_only',
    records: 2,
    headDigest: lines[1].recordDigest,
    loads: 1,
    appends: 0,
    rejections: 0,
    lastFailureCode: null,
  });
  fs.rmSync(storageDir, { recursive: true, force: true });
}

function testInvalidDuplicateAndCorruptionFailClosed() {
  const storageDir = createStorage('faber-canary-evidence-invalid-');
  const journal = createCanaryRolloutEvidenceJournalAdapter({ storageDir });
  const accepted = evidence('accepted');
  journal.append(accepted);
  const before = fs.readFileSync(persistedPath(storageDir));
  assert.throws(
    () => journal.append(accepted),
    (error) => error.code
      === CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.DUPLICATE_EVIDENCE
  );
  assert.throws(
    () => journal.append(Object.freeze({
      ...evidence('invalid'), schemaVersion: 'future-version',
    })),
    (error) => error.code
      === CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.INVALID_EVIDENCE
  );
  assert.deepStrictEqual(fs.readFileSync(persistedPath(storageDir)), before);

  fs.appendFileSync(persistedPath(storageDir), '{"truncated":', 'utf8');
  const reopened = createCanaryRolloutEvidenceJournalAdapter({ storageDir });
  assert.throws(
    () => reopened.load(),
    (error) => error.code
      === CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.JOURNAL_CORRUPTED
  );
  fs.rmSync(storageDir, { recursive: true, force: true });
}

function testSymlinkStorageIsRejected() {
  const storageDir = createStorage('faber-canary-evidence-symlink-');
  const outside = createStorage('faber-canary-evidence-outside-');
  fs.symlinkSync(
    outside,
    path.join(storageDir, CANARY_ROLLOUT_EVIDENCE_JOURNAL_DIRECTORY_NAME),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  assert.throws(
    () => createCanaryRolloutEvidenceJournalAdapter({ storageDir }),
    (error) => error.code
      === CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID
  );
  assert.deepStrictEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(
    storageDir,
    CANARY_ROLLOUT_EVIDENCE_JOURNAL_DIRECTORY_NAME
  ));
  fs.rmSync(storageDir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

function testDirectorySwapAfterActivationIsRejected() {
  const storageDir = createStorage('faber-canary-evidence-swap-');
  const outside = createStorage('faber-canary-evidence-swap-outside-');
  const directoryPath = path.join(
    storageDir,
    CANARY_ROLLOUT_EVIDENCE_JOURNAL_DIRECTORY_NAME
  );
  const movedPath = directoryPath + '-pinned';
  const journal = createCanaryRolloutEvidenceJournalAdapter({ storageDir });
  journal.load();
  let moved = false;
  let linked = false;
  try {
    fs.renameSync(directoryPath, movedPath);
    moved = true;
    fs.symlinkSync(
      outside,
      directoryPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    linked = true;
    assert.throws(
      () => journal.append(evidence('directory-swap')),
      (error) => error.code
        === CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED
    );
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  } finally {
    if (linked) fs.unlinkSync(directoryPath);
    if (moved) fs.renameSync(movedPath, directoryPath);
    fs.rmSync(storageDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

assert.strictEqual(
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_RECORD_SCHEMA_VERSION,
  'canary-rollout-evidence-journal-record.v1'
);
assert.strictEqual(
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
  'canary-rollout-evidence-journal-snapshot.v1'
);
testDurableReplayAndIntegrity();
testInvalidDuplicateAndCorruptionFailClosed();
testSymlinkStorageIsRejected();
testDirectorySwapAfterActivationIsRejected();
console.log('canary-rollout-evidence-journal-adapter.test.js: ok');
