'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CANARY_PROMOTION_ROLLBACK_STORE_DIRECTORY_NAME,
  CANARY_PROMOTION_ROLLBACK_STORE_REASONS,
  createCanaryPromotionRollbackStoreAdapter,
} = require('../main/services/canary_promotion_rollback_store_adapter');
const {
  CANARY_PROMOTION_ROLLBACK_CANCEL_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_COMMIT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_PREPARED_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_RECOVERY_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_SETTLEMENT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_STORE_VERSION,
} = require('../main/agent_runtime/canary_promotion_rollback_store_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;

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

function createStorage(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function prepared(promotionId) {
  return deepFreeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_PREPARED_SCHEMA_VERSION,
    promotionId,
    request: {
      version: 'synthetic-promotion-request.v1',
      promotionId,
      projectId: `project-${promotionId}`,
      jobId: `job-${promotionId}`,
    },
    inversePatchDigest: digest('a'),
    entries: [{
      path: 'src/app.js',
      before: {
        kind: 'file',
        mode: 0o644,
        bytes: 8,
        contentDigest: digest('b'),
        contentBase64: 'b3JpZ2luYWw=',
      },
      after: {
        kind: 'file',
        mode: 0o644,
        bytes: 8,
        contentDigest: digest('c'),
        contentBase64: 'cHJvbW90ZWQ=',
      },
    }],
  });
}

function committed(promotionId) {
  return deepFreeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_COMMIT_SCHEMA_VERSION,
    promotionId,
    promotionReceipt: {
      version: 'synthetic-promotion-receipt.v1',
      promotionId,
      inversePatchDigest: digest('a'),
    },
    sourceAfter: {
      sourceStateDigest: digest('d'),
      branchHeadDigest: digest('e'),
      gitIndexDigest: digest('f'),
      userDirtyDigest: digest('0'),
    },
  });
}

function cancelRecord(promotionId) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_CANCEL_SCHEMA_VERSION,
    promotionId,
  });
}

function settlementRecord(promotionId) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_SETTLEMENT_SCHEMA_VERSION,
    promotionId,
  });
}

function expectedRecovery(pending, commit) {
  return {
    schemaVersion: CANARY_PROMOTION_ROLLBACK_RECOVERY_SCHEMA_VERSION,
    request: pending.request,
    inversePatchDigest: pending.inversePatchDigest,
    entries: pending.entries,
    promotionReceipt: commit.promotionReceipt,
    sourceAfter: commit.sourceAfter,
  };
}

function onlyRecordPath(storageDir) {
  const directoryPath = path.join(
    storageDir,
    CANARY_PROMOTION_ROLLBACK_STORE_DIRECTORY_NAME
  );
  const records = fs.readdirSync(directoryPath)
    .filter((name) => name.endsWith('.json'));
  assert.strictEqual(records.length, 1);
  return path.join(directoryPath, records[0]);
}

function testDurableLifecycleAndPrivateStorage() {
  const storageDir = createStorage('faber-canary-rollback-store-');
  try {
    const store = createCanaryPromotionRollbackStoreAdapter({ storageDir });
    assert.deepStrictEqual(Reflect.ownKeys(store), [
      'version', 'load', 'prepare', 'commit', 'cancel', 'settle', 'diagnostics',
    ]);
    assert.strictEqual(store.version, CANARY_PROMOTION_ROLLBACK_STORE_VERSION);
    assertDeepFrozen(store);
    assert.deepStrictEqual(store.diagnostics(), {
      version: CANARY_PROMOTION_ROLLBACK_STORE_VERSION,
      durability: 'private_user_data',
      stateModel: 'prepared_committed_settled',
    });
    assert.deepStrictEqual(store.load(), {
      schemaVersion: CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION,
      records: [],
    });

    const pending = prepared('promotion-durable-a');
    const commit = committed(pending.promotionId);
    assert.strictEqual(store.prepare(pending), undefined);
    const recordPath = onlyRecordPath(storageDir);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(path.dirname(recordPath)).mode & 0o777, 0o700);
      assert.strictEqual(fs.statSync(recordPath).mode & 0o777, 0o600);
    }
    assert.strictEqual(store.commit(commit), undefined);

    const reopened = createCanaryPromotionRollbackStoreAdapter({ storageDir });
    const snapshot = reopened.load();
    assert.deepStrictEqual(snapshot, {
      schemaVersion: CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION,
      records: [expectedRecovery(pending, commit)],
    });
    assertDeepFrozen(snapshot);
    assert.strictEqual(
      reopened.settle(settlementRecord(pending.promotionId)),
      undefined
    );
    assert.deepStrictEqual(
      createCanaryPromotionRollbackStoreAdapter({ storageDir }).load().records,
      []
    );
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
}

function testPreparedRecoveryFailsClosedAndCanBeCancelled() {
  const storageDir = createStorage('faber-canary-rollback-prepared-');
  try {
    const pending = prepared('promotion-prepared-a');
    createCanaryPromotionRollbackStoreAdapter({ storageDir }).prepare(pending);
    const reopened = createCanaryPromotionRollbackStoreAdapter({ storageDir });
    assert.throws(
      () => reopened.load(),
      (error) => error && error.code
        === CANARY_PROMOTION_ROLLBACK_STORE_REASONS.RECOVERY_AMBIGUOUS
    );
    assert.strictEqual(reopened.cancel(cancelRecord(pending.promotionId)), undefined);
    assert.deepStrictEqual(reopened.load().records, []);
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
}

function testCorruptionSymlinkAndHostileInputFailClosed() {
  const storageDir = createStorage('faber-canary-rollback-corrupt-');
  try {
    const store = createCanaryPromotionRollbackStoreAdapter({ storageDir });
    const pending = prepared('promotion-corrupt-a');
    store.prepare(pending);
    store.commit(committed(pending.promotionId));
    fs.writeFileSync(onlyRecordPath(storageDir), '{"corrupted":true}\n', {
      mode: 0o600,
    });
    assert.throws(
      () => createCanaryPromotionRollbackStoreAdapter({ storageDir }).load(),
      (error) => error && error.code
        === CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CORRUPTED
    );
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }

  if (process.platform !== 'win32') {
    const symlinkStorage = createStorage('faber-canary-rollback-symlink-');
    const target = createStorage('faber-canary-rollback-target-');
    try {
      fs.symlinkSync(target, path.join(
        symlinkStorage,
        CANARY_PROMOTION_ROLLBACK_STORE_DIRECTORY_NAME
      ));
      assert.throws(
        () => createCanaryPromotionRollbackStoreAdapter({
          storageDir: symlinkStorage,
        }),
        (error) => error && error.code
          === CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_INVALID
      );
    } finally {
      fs.rmSync(symlinkStorage, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  const storageDirHostile = createStorage('faber-canary-rollback-hostile-');
  try {
    const store = createCanaryPromotionRollbackStoreAdapter({
      storageDir: storageDirHostile,
    });
    let traps = 0;
    const hostile = new Proxy({}, {
      get() { traps += 1; throw new Error('must not execute'); },
      ownKeys() { traps += 1; throw new Error('must not execute'); },
    });
    assert.throws(
      () => store.prepare(hostile),
      (error) => error && error.code
        === CANARY_PROMOTION_ROLLBACK_STORE_REASONS.INVALID_RECORD
    );
    assert.strictEqual(traps, 0);
  } finally {
    fs.rmSync(storageDirHostile, { recursive: true, force: true });
  }
}

function main() {
  testDurableLifecycleAndPrivateStorage();
  testPreparedRecoveryFailsClosedAndCanBeCancelled();
  testCorruptionSymlinkAndHostileInputFailClosed();
  console.log('canary-promotion-rollback-store-adapter.test.js: ok');
}

main();
