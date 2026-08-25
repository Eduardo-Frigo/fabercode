'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CANARY_MANUAL_ROLLBACK_JOURNAL_DIRECTORY_NAME,
  CANARY_MANUAL_ROLLBACK_JOURNAL_FILE_NAME,
  CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS,
  createCanaryManualRollbackJournalAdapter,
} = require('../main/services/canary_manual_rollback_journal_adapter');
const {
  CANARY_MANUAL_ROLLBACK_JOURNAL_REMOVE_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
} = require('../main/agent_runtime/canary_manual_rollback_journal_contract');
const {
  CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
} = require('../main/agent_runtime/canary_manual_rollback_service');
const {
  CANARY_PROMOTION_TRANSACTION_VERSION,
} = require('../main/agent_runtime/canary_promotion_controller');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function registration(promotionId) {
  return deepFreeze({
    schemaVersion:
      CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    transaction: {
      version: CANARY_PROMOTION_TRANSACTION_VERSION,
      request: {
        promotionId,
        jobId: `job-${promotionId}`,
        projectId: `project-${promotionId}`,
      },
      receipt: {
        promotionId,
        inversePatchDigest: `sha256:${'a'.repeat(64)}`,
      },
    },
  });
}

function removeRecord(promotionId) {
  return Object.freeze({
    schemaVersion: CANARY_MANUAL_ROLLBACK_JOURNAL_REMOVE_SCHEMA_VERSION,
    promotionId,
  });
}

function createStorage(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function persistedPath(storageDir) {
  return path.join(
    storageDir,
    CANARY_MANUAL_ROLLBACK_JOURNAL_DIRECTORY_NAME,
    CANARY_MANUAL_ROLLBACK_JOURNAL_FILE_NAME
  );
}

function testDurableLifecycleAndPrivateStorage() {
  const storageDir = createStorage('faber-canary-manual-journal-');
  try {
    const journal = createCanaryManualRollbackJournalAdapter({ storageDir });
    assert.deepStrictEqual(Reflect.ownKeys(journal), [
      'version', 'load', 'append', 'remove', 'diagnostics',
    ]);
    assert.strictEqual(journal.version, CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION);
    assertDeepFrozen(journal);
    assert.deepStrictEqual(journal.diagnostics(), {
      version: CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
      durability: 'private_user_data',
      stateModel: 'registered_removed',
    });
    assert.deepStrictEqual(journal.load(), {
      schemaVersion: CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
      registrations: [],
    });

    const first = registration('promotion-manual-journal-a');
    const second = registration('promotion-manual-journal-b');
    assert.strictEqual(journal.append(first), undefined);
    assert.strictEqual(journal.append(second), undefined);
    const filePath = persistedPath(storageDir);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(path.dirname(filePath)).mode & 0o777, 0o700);
      assert.strictEqual(fs.statSync(filePath).mode & 0o777, 0o600);
    }

    const reopened = createCanaryManualRollbackJournalAdapter({ storageDir });
    const snapshot = reopened.load();
    assert.deepStrictEqual(snapshot.registrations, [first, second]);
    assertDeepFrozen(snapshot);
    assert.strictEqual(reopened.remove(removeRecord(first.transaction.request.promotionId)), undefined);
    assert.deepStrictEqual(
      createCanaryManualRollbackJournalAdapter({ storageDir })
        .load().registrations,
      [second]
    );
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
}

function testCorruptionSymlinkDuplicateAndHostileInputFailClosed() {
  const storageDir = createStorage('faber-canary-manual-corrupt-');
  try {
    const journal = createCanaryManualRollbackJournalAdapter({ storageDir });
    const value = registration('promotion-manual-corrupt-a');
    journal.append(value);
    assert.throws(
      () => journal.append(value),
      (error) => error && error.code
        === CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.DUPLICATE_REGISTRATION
    );
    fs.writeFileSync(persistedPath(storageDir), '{"corrupted":true}\n', {
      mode: 0o600,
    });
    assert.throws(
      () => createCanaryManualRollbackJournalAdapter({ storageDir }).load(),
      (error) => error && error.code
        === CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.JOURNAL_CORRUPTED
    );
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }

  if (process.platform !== 'win32') {
    const symlinkStorage = createStorage('faber-canary-manual-symlink-');
    const target = createStorage('faber-canary-manual-target-');
    try {
      fs.symlinkSync(target, path.join(
        symlinkStorage,
        CANARY_MANUAL_ROLLBACK_JOURNAL_DIRECTORY_NAME
      ));
      assert.throws(
        () => createCanaryManualRollbackJournalAdapter({
          storageDir: symlinkStorage,
        }),
        (error) => error && error.code
          === CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_INVALID
      );
    } finally {
      fs.rmSync(symlinkStorage, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  const hostileStorage = createStorage('faber-canary-manual-hostile-');
  try {
    const journal = createCanaryManualRollbackJournalAdapter({
      storageDir: hostileStorage,
    });
    let traps = 0;
    const hostile = new Proxy({}, {
      get() { traps += 1; throw new Error('must not execute'); },
      ownKeys() { traps += 1; throw new Error('must not execute'); },
    });
    assert.throws(
      () => journal.append(hostile),
      (error) => error && error.code
        === CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.INVALID_REGISTRATION
    );
    assert.strictEqual(traps, 0);
  } finally {
    fs.rmSync(hostileStorage, { recursive: true, force: true });
  }
}

function main() {
  testDurableLifecycleAndPrivateStorage();
  testCorruptionSymlinkDuplicateAndHostileInputFailClosed();
  console.log('canary-manual-rollback-journal-adapter.test.js: ok');
}

main();
