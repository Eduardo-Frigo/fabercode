'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TRANSACTION_JOURNAL_AUTHENTICATOR_DIRECTORY_NAME,
  TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME,
  TRANSACTION_JOURNAL_AUTHENTICATOR_VERSION,
  TransactionJournalAuthenticatorError,
  createTransactionJournalAuthenticator,
} = require('../main/security/transaction_journal_authenticator');

const CONCURRENT_WORKER_FLAG = '--transaction-journal-authenticator-worker';
const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (process.platform !== 'win32') fs.chmodSync(directoryPath, 0o700);
  temporaryDirectories.push(directoryPath);
  return directoryPath;
}

function keyPaths(storageDir) {
  const privateDir = path.join(
    storageDir,
    TRANSACTION_JOURNAL_AUTHENTICATOR_DIRECTORY_NAME
  );
  return {
    privateDir,
    keyPath: path.join(privateDir, TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME),
  };
}

function errorHasCode(code) {
  return (error) => error instanceof TransactionJournalAuthenticatorError
    && error.code === code
    && !error.message.includes(os.tmpdir());
}

function mutateFinalHex(value) {
  const last = value[value.length - 1];
  return `${value.slice(0, -1)}${last === '0' ? '1' : '0'}`;
}

function spawnConcurrentWorker(storageDir, rootPath) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      process.execPath,
      [__filename, CONCURRENT_WORKER_FLAG, storageDir, rootPath],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`concurrent worker failed (${code}): ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('concurrent worker returned invalid data'));
      }
    });
  });
}

function runConcurrentWorker() {
  try {
    const storageDir = process.argv[3];
    const rootPath = process.argv[4];
    const authenticator = createTransactionJournalAuthenticator({ storageDir });
    const value = { revision: 7, state: 'PREPARED' };
    const tag = authenticator.seal(rootPath, value);
    process.stdout.write(JSON.stringify({
      tag,
      verified: authenticator.verify(rootPath, value, tag),
    }));
  } catch (error) {
    process.stderr.write(`${error && error.code ? error.code : 'WORKER_FAILED'}\n`);
    process.exitCode = 1;
  }
}

async function runTests() {
  const storageDir = temporaryDirectory('faber-journal-auth-storage-');
  const rootPath = temporaryDirectory('faber-journal-auth-root-');
  const otherRootPath = temporaryDirectory('faber-journal-auth-other-root-');
  const authenticator = createTransactionJournalAuthenticator({ storageDir });
  const value = { revision: 1, state: 'PREPARED', nested: { b: 2, a: 1 } };
  const reorderedValue = { nested: { a: 1, b: 2 }, state: 'PREPARED', revision: 1 };
  const tag = authenticator.seal(rootPath, value);

  assert.strictEqual(Object.isFrozen(authenticator), true);
  assert.strictEqual(Object.isFrozen(authenticator.seal), true);
  assert.strictEqual(Object.isFrozen(authenticator.verify), true);
  assert.deepStrictEqual(
    Object.keys(authenticator).sort(),
    ['seal', 'verify', 'version']
  );
  assert.strictEqual(authenticator.version, TRANSACTION_JOURNAL_AUTHENTICATOR_VERSION);
  assert.strictEqual(typeof tag, 'string');
  assert.match(
    tag,
    /^hmac-sha256:v1:kid-hmac-sha256:[a-f0-9]{64}:[a-f0-9]{64}$/
  );
  assert.strictEqual(tag.includes(rootPath), false);
  assert.strictEqual(authenticator.seal(rootPath, reorderedValue), tag);
  assert.strictEqual(authenticator.verify(rootPath, value, tag), true);
  assert.strictEqual(authenticator.verify(rootPath, reorderedValue, tag), true);
  assert.strictEqual(authenticator.verify(otherRootPath, value, tag), false);
  assert.strictEqual(authenticator.verify(rootPath, { ...value, revision: 2 }, tag), false);
  assert.strictEqual(authenticator.verify(rootPath, value, mutateFinalHex(tag)), false);
  assert.strictEqual(authenticator.verify(rootPath, value, Symbol('tag')), false);
  assert.strictEqual(authenticator.verify(rootPath, value, Object.create(null)), false);

  const restarted = createTransactionJournalAuthenticator({ storageDir });
  assert.deepStrictEqual(Object.keys(restarted).sort(), ['seal', 'verify', 'version']);
  assert.strictEqual(restarted.verify(rootPath, value, tag), true);
  assert.strictEqual(restarted.seal(rootPath, value), tag);

  const continuityStorage = temporaryDirectory('faber-journal-auth-continuity-');
  const continuityRoot = temporaryDirectory('faber-journal-auth-continuity-root-');
  const continuityAuthenticator = createTransactionJournalAuthenticator({
    storageDir: continuityStorage,
  });
  const continuityValue = { revision: 9, state: 'COMMITTED' };
  const continuityTag = continuityAuthenticator.seal(continuityRoot, continuityValue);
  const continuityPaths = keyPaths(continuityStorage);
  const retainedWalPath = path.join(
    continuityRoot,
    '.faber',
    'transactions',
    'job-retained',
    'journal.json'
  );
  fs.mkdirSync(path.dirname(retainedWalPath), { recursive: true });
  const retainedWalBytes = `${JSON.stringify({
    state: 'COMMITTED',
    authenticationTag: continuityTag,
  })}\n`;
  fs.writeFileSync(retainedWalPath, retainedWalBytes, 'utf8');
  fs.unlinkSync(continuityPaths.keyPath);

  assert.throws(
    () => createTransactionJournalAuthenticator({ storageDir: continuityStorage }),
    errorHasCode('KEY_STATE_LOST')
  );
  assert.strictEqual(fs.existsSync(continuityPaths.keyPath), false);
  assert.strictEqual(fs.readFileSync(retainedWalPath, 'utf8'), retainedWalBytes);
  assert.strictEqual(JSON.parse(retainedWalBytes).authenticationTag, continuityTag);
  assert.strictEqual(
    continuityAuthenticator.verify(continuityRoot, continuityValue, continuityTag),
    false
  );
  assert.strictEqual(fs.existsSync(continuityPaths.keyPath), false);

  const prePublishCrashStorage = temporaryDirectory('faber-journal-auth-pre-publish-crash-');
  const prePublishCrashPaths = keyPaths(prePublishCrashStorage);
  fs.mkdirSync(prePublishCrashPaths.privateDir, { mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(prePublishCrashPaths.privateDir, 0o700);
  const abandonedPrePublishTemp = path.join(
    prePublishCrashPaths.privateDir,
    `.${TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME}.999999.${'B'.repeat(24)}.tmp`
  );
  const abandonedPrePublishBytes = 'truncated-key-material';
  fs.writeFileSync(abandonedPrePublishTemp, abandonedPrePublishBytes, { mode: 0o600 });
  assert.throws(
    () => createTransactionJournalAuthenticator({ storageDir: prePublishCrashStorage }),
    errorHasCode('KEY_STATE_LOST')
  );
  assert.strictEqual(fs.existsSync(prePublishCrashPaths.keyPath), false);
  assert.strictEqual(
    fs.readFileSync(abandonedPrePublishTemp, 'utf8'),
    abandonedPrePublishBytes
  );

  const paths = keyPaths(storageDir);
  const privateStat = fs.lstatSync(paths.privateDir);
  const keyStat = fs.lstatSync(paths.keyPath);
  assert.strictEqual(privateStat.isDirectory(), true);
  assert.strictEqual(privateStat.isSymbolicLink(), false);
  assert.strictEqual(keyStat.isFile(), true);
  assert.strictEqual(keyStat.isSymbolicLink(), false);
  assert.strictEqual(Number(keyStat.nlink), 1);
  if (process.platform !== 'win32') {
    assert.strictEqual(Number(privateStat.mode) & 0o777, 0o700);
    assert.strictEqual(Number(keyStat.mode) & 0o777, 0o600);
  }
  const persistedKey = JSON.parse(fs.readFileSync(paths.keyPath, 'utf8'));
  const persistedSecret = Buffer.from(persistedKey.secret, 'base64url');
  assert.ok(persistedSecret.length >= 32);
  assert.strictEqual(JSON.stringify(authenticator).includes(persistedKey.secret), false);
  persistedSecret.fill(0);

  let getterCalls = 0;
  const getterValue = {};
  Object.defineProperty(getterValue, 'secret', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'must-not-run';
    },
  });
  assert.throws(
    () => authenticator.seal(rootPath, getterValue),
    errorHasCode('INVALID_VALUE')
  );
  assert.strictEqual(getterCalls, 0);
  assert.strictEqual(authenticator.verify(rootPath, getterValue, tag), false);
  assert.strictEqual(getterCalls, 0);
  assert.throws(
    () => authenticator.seal(rootPath, { [Symbol('secret')]: true }),
    errorHasCode('INVALID_VALUE')
  );
  assert.throws(
    () => authenticator.seal(rootPath, { unsupported: undefined }),
    errorHasCode('INVALID_VALUE')
  );
  assert.throws(
    () => authenticator.seal(rootPath, { negativeZero: -0 }),
    errorHasCode('INVALID_VALUE')
  );
  assert.throws(
    () => authenticator.seal(rootPath, [, 'sparse']),
    errorHasCode('INVALID_VALUE')
  );

  let nestedSealCode = '';
  const reentrantValue = new Proxy({}, {
    getPrototypeOf() {
      try {
        authenticator.seal(rootPath, { nested: true });
      } catch (error) {
        nestedSealCode = error && error.code;
      }
      throw new Error('hostile proxy');
    },
  });
  assert.throws(
    () => authenticator.seal(rootPath, reentrantValue),
    errorHasCode('INVALID_VALUE')
  );
  assert.strictEqual(nestedSealCode, 'REENTRANT_OPERATION');

  let nestedVerify = true;
  const verifyReentrantValue = new Proxy({}, {
    getPrototypeOf() {
      nestedVerify = authenticator.verify(rootPath, value, tag);
      throw new Error('hostile proxy');
    },
  });
  assert.throws(
    () => authenticator.seal(rootPath, verifyReentrantValue),
    errorHasCode('INVALID_VALUE')
  );
  assert.strictEqual(nestedVerify, false);

  let hostileOptionsGetterCalls = 0;
  const hostileOptions = {};
  Object.defineProperty(hostileOptions, 'storageDir', {
    enumerable: true,
    get() {
      hostileOptionsGetterCalls += 1;
      return storageDir;
    },
  });
  assert.throws(
    () => createTransactionJournalAuthenticator(hostileOptions),
    errorHasCode('INVALID_OPTIONS')
  );
  assert.strictEqual(hostileOptionsGetterCalls, 0);
  assert.throws(
    () => createTransactionJournalAuthenticator({
      storageDir,
      [Symbol('secret')]: 'hidden',
    }),
    errorHasCode('INVALID_OPTIONS')
  );
  assert.throws(
    () => createTransactionJournalAuthenticator({ storageDir, extra: true }),
    errorHasCode('INVALID_OPTIONS')
  );

  const insideRootStorage = path.join(rootPath, 'unsafe-user-data');
  fs.mkdirSync(insideRootStorage, { mode: 0o700 });
  const insideRootAuthenticator = createTransactionJournalAuthenticator({
    storageDir: insideRootStorage,
  });
  assert.throws(
    () => insideRootAuthenticator.seal(rootPath, value),
    errorHasCode('STORAGE_INSIDE_PROJECT')
  );
  assert.strictEqual(insideRootAuthenticator.verify(rootPath, value, tag), false);

  if (process.platform !== 'win32') {
    const unsafeStorage = temporaryDirectory('faber-journal-auth-unsafe-mode-');
    fs.chmodSync(unsafeStorage, 0o777);
    assert.throws(
      () => createTransactionJournalAuthenticator({ storageDir: unsafeStorage }),
      errorHasCode('KEY_STORAGE_INVALID')
    );

    const storageTarget = temporaryDirectory('faber-journal-auth-storage-target-');
    const storageAliasParent = temporaryDirectory('faber-journal-auth-storage-alias-');
    const storageAlias = path.join(storageAliasParent, 'user-data');
    fs.symlinkSync(storageTarget, storageAlias, 'dir');
    assert.throws(
      () => createTransactionJournalAuthenticator({ storageDir: storageAlias }),
      errorHasCode('KEY_STORAGE_INVALID')
    );

    const privateSymlinkStorage = temporaryDirectory('faber-journal-auth-private-link-');
    const privateSymlinkTarget = temporaryDirectory('faber-journal-auth-private-target-');
    fs.symlinkSync(
      privateSymlinkTarget,
      path.join(privateSymlinkStorage, TRANSACTION_JOURNAL_AUTHENTICATOR_DIRECTORY_NAME),
      'dir'
    );
    assert.throws(
      () => createTransactionJournalAuthenticator({ storageDir: privateSymlinkStorage }),
      errorHasCode('KEY_STORAGE_INVALID')
    );

    const rootAliasParent = temporaryDirectory('faber-journal-auth-root-alias-');
    const rootAlias = path.join(rootAliasParent, 'project');
    fs.symlinkSync(rootPath, rootAlias, 'dir');
    assert.throws(
      () => authenticator.seal(rootAlias, value),
      errorHasCode('INVALID_ROOT')
    );
  }

  const crashStorage = temporaryDirectory('faber-journal-auth-crash-recovery-');
  const crashAuthenticator = createTransactionJournalAuthenticator({ storageDir: crashStorage });
  const crashTag = crashAuthenticator.seal(rootPath, value);
  const crashPaths = keyPaths(crashStorage);
  const crashTempPath = path.join(
    crashPaths.privateDir,
    `.${TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME}.999999.${'A'.repeat(24)}.tmp`
  );
  fs.linkSync(crashPaths.keyPath, crashTempPath);
  assert.strictEqual(Number(fs.lstatSync(crashPaths.keyPath).nlink), 2);
  const crashRestarted = createTransactionJournalAuthenticator({ storageDir: crashStorage });
  assert.strictEqual(fs.existsSync(crashTempPath), false);
  assert.strictEqual(Number(fs.lstatSync(crashPaths.keyPath).nlink), 1);
  assert.strictEqual(crashRestarted.verify(rootPath, value, crashTag), true);

  const hardlinkStorage = temporaryDirectory('faber-journal-auth-hardlink-');
  const hardlinkAuthenticator = createTransactionJournalAuthenticator({
    storageDir: hardlinkStorage,
  });
  const hardlinkPaths = keyPaths(hardlinkStorage);
  const unrelatedHardlink = path.join(hardlinkStorage, 'unrelated-key-link');
  fs.linkSync(hardlinkPaths.keyPath, unrelatedHardlink);
  assert.throws(
    () => hardlinkAuthenticator.seal(rootPath, value),
    errorHasCode('KEY_FILE_HARDLINKED')
  );
  assert.strictEqual(hardlinkAuthenticator.verify(rootPath, value, tag), false);
  assert.throws(
    () => createTransactionJournalAuthenticator({ storageDir: hardlinkStorage }),
    errorHasCode('KEY_FILE_HARDLINKED')
  );

  const permissionStorage = temporaryDirectory('faber-journal-auth-permission-');
  const permissionAuthenticator = createTransactionJournalAuthenticator({
    storageDir: permissionStorage,
  });
  const permissionPaths = keyPaths(permissionStorage);
  if (process.platform !== 'win32') {
    fs.chmodSync(permissionPaths.keyPath, 0o644);
    assert.throws(
      () => permissionAuthenticator.seal(rootPath, value),
      errorHasCode('KEY_STORAGE_INVALID')
    );
    assert.throws(
      () => createTransactionJournalAuthenticator({ storageDir: permissionStorage }),
      errorHasCode('KEY_STORAGE_INVALID')
    );
  }

  const symlinkKeyStorage = temporaryDirectory('faber-journal-auth-key-link-');
  const symlinkPrivate = path.join(
    symlinkKeyStorage,
    TRANSACTION_JOURNAL_AUTHENTICATOR_DIRECTORY_NAME
  );
  fs.mkdirSync(symlinkPrivate, { mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(symlinkPrivate, 0o700);
  const symlinkTarget = path.join(symlinkKeyStorage, 'do-not-touch');
  const secretMarker = 'secret-marker-must-not-leak';
  fs.writeFileSync(symlinkTarget, secretMarker, { mode: 0o600 });
  fs.symlinkSync(
    symlinkTarget,
    path.join(symlinkPrivate, TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME)
  );
  assert.throws(
    () => createTransactionJournalAuthenticator({ storageDir: symlinkKeyStorage }),
    (error) => errorHasCode('KEY_STORAGE_INVALID')(error)
      && !error.message.includes(secretMarker)
      && !error.message.includes(symlinkTarget)
  );
  assert.strictEqual(fs.readFileSync(symlinkTarget, 'utf8'), secretMarker);

  const corruptionStorage = temporaryDirectory('faber-journal-auth-corrupt-');
  const corruptionAuthenticator = createTransactionJournalAuthenticator({
    storageDir: corruptionStorage,
  });
  const corruptionPaths = keyPaths(corruptionStorage);
  fs.writeFileSync(corruptionPaths.keyPath, '{"bad":true}\n', { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(corruptionPaths.keyPath, 0o600);
  assert.throws(
    () => corruptionAuthenticator.seal(rootPath, value),
    errorHasCode('KEY_STORAGE_INVALID')
  );
  assert.strictEqual(corruptionAuthenticator.verify(rootPath, value, tag), false);
  assert.throws(
    () => createTransactionJournalAuthenticator({ storageDir: corruptionStorage }),
    errorHasCode('KEY_STORAGE_INVALID')
  );

  const rollbackStorage = temporaryDirectory('faber-journal-auth-key-rollback-');
  const rollbackAuthenticator = createTransactionJournalAuthenticator({
    storageDir: rollbackStorage,
  });
  const rollbackTag = rollbackAuthenticator.seal(rootPath, value);
  const rollbackPaths = keyPaths(rollbackStorage);
  const oldKeyPath = path.join(rollbackStorage, 'old-key-copy');
  fs.renameSync(rollbackPaths.keyPath, oldKeyPath);
  fs.copyFileSync(oldKeyPath, rollbackPaths.keyPath, fs.constants.COPYFILE_EXCL);
  if (process.platform !== 'win32') fs.chmodSync(rollbackPaths.keyPath, 0o600);
  assert.throws(
    () => rollbackAuthenticator.seal(rootPath, value),
    errorHasCode('KEY_STORAGE_INVALID')
  );
  assert.strictEqual(rollbackAuthenticator.verify(rootPath, value, rollbackTag), false);
  assert.throws(
    () => createTransactionJournalAuthenticator({ storageDir: rollbackStorage }),
    errorHasCode('KEY_STORAGE_INVALID')
  );

  const rootSwapStorage = temporaryDirectory('faber-journal-auth-root-swap-storage-');
  const rootSwapPath = temporaryDirectory('faber-journal-auth-root-swap-project-');
  const rootSwapAuthenticator = createTransactionJournalAuthenticator({
    storageDir: rootSwapStorage,
  });
  const displacedRootPath = `${rootSwapPath}.displaced`;
  const originalCreateHmac = crypto.createHmac;
  let createHmacCalls = 0;
  let rootWasSwapped = false;
  crypto.createHmac = function createHmacWithRootSwap(...args) {
    createHmacCalls += 1;
    if (createHmacCalls === 2) {
      fs.renameSync(rootSwapPath, displacedRootPath);
      fs.mkdirSync(rootSwapPath, { mode: 0o700 });
      rootWasSwapped = true;
    }
    return originalCreateHmac.apply(this, args);
  };
  try {
    assert.throws(
      () => rootSwapAuthenticator.seal(rootSwapPath, value),
      errorHasCode('INVALID_ROOT')
    );
  } finally {
    crypto.createHmac = originalCreateHmac;
    if (rootWasSwapped) {
      fs.rmSync(rootSwapPath, { recursive: true, force: true });
      fs.renameSync(displacedRootPath, rootSwapPath);
    }
  }

  const storageSwapPath = temporaryDirectory('faber-journal-auth-storage-swap-');
  const storageSwapAuthenticator = createTransactionJournalAuthenticator({
    storageDir: storageSwapPath,
  });
  const displacedStoragePath = `${storageSwapPath}.displaced`;
  createHmacCalls = 0;
  let storageWasSwapped = false;
  crypto.createHmac = function createHmacWithStorageSwap(...args) {
    createHmacCalls += 1;
    if (createHmacCalls === 2) {
      fs.renameSync(storageSwapPath, displacedStoragePath);
      fs.mkdirSync(storageSwapPath, { mode: 0o700 });
      storageWasSwapped = true;
    }
    return originalCreateHmac.apply(this, args);
  };
  try {
    assert.throws(
      () => storageSwapAuthenticator.seal(rootPath, value),
      errorHasCode('KEY_STATE_CHANGED')
    );
  } finally {
    crypto.createHmac = originalCreateHmac;
    if (storageWasSwapped) {
      fs.rmSync(storageSwapPath, { recursive: true, force: true });
      fs.renameSync(displacedStoragePath, storageSwapPath);
    }
  }

  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalFsyncSync = fs.fsyncSync;
  const windowsStorage = temporaryDirectory('faber-journal-auth-windows-sync-');
  let fileFsyncCalls = 0;
  let directoryFsyncCalls = 0;
  fs.fsyncSync = function fsyncWithUnsupportedDirectories(descriptor) {
    if (fs.fstatSync(descriptor).isDirectory()) {
      directoryFsyncCalls += 1;
      const error = new Error('directory fsync unsupported');
      error.code = 'EINVAL';
      throw error;
    }
    fileFsyncCalls += 1;
    return originalFsyncSync(descriptor);
  };
  Object.defineProperty(process, 'platform', {
    ...platformDescriptor,
    value: 'win32',
  });
  try {
    const windowsAuthenticator = createTransactionJournalAuthenticator({
      storageDir: windowsStorage,
    });
    const windowsTag = windowsAuthenticator.seal(rootPath, value);
    assert.strictEqual(windowsAuthenticator.verify(rootPath, value, windowsTag), true);
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
    fs.fsyncSync = originalFsyncSync;
  }
  assert.ok(fileFsyncCalls >= 1);
  assert.ok(directoryFsyncCalls >= 1);

  const concurrentStorage = temporaryDirectory('faber-journal-auth-concurrent-');
  const concurrentRoot = temporaryDirectory('faber-journal-auth-concurrent-root-');
  const workerResults = await Promise.all(
    Array.from({ length: 8 }, () => spawnConcurrentWorker(concurrentStorage, concurrentRoot))
  );
  assert.ok(workerResults.every((result) => result.verified === true));
  assert.strictEqual(new Set(workerResults.map((result) => result.tag)).size, 1);
  const concurrentPaths = keyPaths(concurrentStorage);
  assert.strictEqual(Number(fs.lstatSync(concurrentPaths.keyPath).nlink), 1);
  assert.deepStrictEqual(
    fs.readdirSync(concurrentPaths.privateDir).filter((name) => name.endsWith('.tmp')),
    []
  );

  console.log('transaction journal authenticator tests: ok');
}

if (process.argv[2] === CONCURRENT_WORKER_FLAG) {
  runConcurrentWorker();
} else {
  runTests()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      for (const directoryPath of temporaryDirectories.reverse()) {
        try { fs.rmSync(directoryPath, { recursive: true, force: true }); } catch {}
      }
    });
}
