'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const {
  CANARY_MANUAL_ROLLBACK_JOURNAL_REMOVE_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
  CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
} = require('../agent_runtime/canary_manual_rollback_journal_contract');
const {
  CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION,
} = require('../agent_runtime/canary_manual_rollback_service');
const {
  CANARY_PROMOTION_TRANSACTION_VERSION,
} = require('../agent_runtime/canary_promotion_controller');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../agent_runtime/canary_rollout_selector');

const CANARY_MANUAL_ROLLBACK_JOURNAL_DIRECTORY_NAME =
  'canary-manual-rollbacks';
const CANARY_MANUAL_ROLLBACK_JOURNAL_FILE_NAME = 'registrations-v1.json';
const CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS = Object.freeze({
  CAPACITY_EXCEEDED: 'CANARY_MANUAL_ROLLBACK_JOURNAL_CAPACITY_EXCEEDED',
  DUPLICATE_REGISTRATION:
    'CANARY_MANUAL_ROLLBACK_JOURNAL_DUPLICATE_REGISTRATION',
  INVALID_OPTIONS: 'CANARY_MANUAL_ROLLBACK_JOURNAL_INVALID_OPTIONS',
  INVALID_REGISTRATION:
    'CANARY_MANUAL_ROLLBACK_JOURNAL_INVALID_REGISTRATION',
  INVALID_REMOVE: 'CANARY_MANUAL_ROLLBACK_JOURNAL_INVALID_REMOVE',
  JOURNAL_CORRUPTED: 'CANARY_MANUAL_ROLLBACK_JOURNAL_CORRUPTED',
  STORAGE_CHANGED: 'CANARY_MANUAL_ROLLBACK_JOURNAL_STORAGE_CHANGED',
  STORAGE_INVALID: 'CANARY_MANUAL_ROLLBACK_JOURNAL_STORAGE_INVALID',
  STORAGE_UNAVAILABLE: 'CANARY_MANUAL_ROLLBACK_JOURNAL_STORAGE_UNAVAILABLE',
});

const JOURNAL_DIAGNOSTICS = Object.freeze({
  version: CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
  durability: 'private_user_data',
  stateModel: 'registered_removed',
});
const DEFAULT_MAX_REGISTRATIONS = 4096;
const HARD_MAX_REGISTRATIONS = 100_000;
const DEFAULT_MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
const HARD_MAX_JOURNAL_BYTES = 512 * 1024 * 1024;
const MAX_GRAPH_DEPTH = 128;
const MAX_GRAPH_NODES = 1_000_000;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VALID_STAGES = new Set(Object.values(CANARY_ROLLOUT_STAGES));
const OPTION_KEYS = Object.freeze([
  'storageDir',
  'maxRegistrations',
  'maxJournalBytes',
]);
const REGISTRATION_KEYS = Object.freeze([
  'schemaVersion',
  'rolloutStage',
  'transaction',
]);
const TRANSACTION_KEYS = Object.freeze(['version', 'request', 'receipt']);
const REMOVE_KEYS = Object.freeze(['schemaVersion', 'promotionId']);
const SNAPSHOT_KEYS = Object.freeze(['schemaVersion', 'registrations']);
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set([
  'EACCES',
  'EINVAL',
  'EISDIR',
  'ENOTSUP',
  'EPERM',
]);

class CanaryManualRollbackJournalError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryManualRollbackJournalError';
    this.code = code;
  }
}

function journalError(code) {
  return new CanaryManualRollbackJournalError(code);
}

function fail(code) {
  throw journalError(code);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { return false; }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, expectedKeys, { exact = true } = {}) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { return null; }
  if (exact && keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || exact && expectedKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function immutableDataSnapshot(value, { requireFrozen = false } = {}) {
  const seen = new Set();
  let nodes = 0;

  function visit(current, depth) {
    if (current === null || typeof current === 'string'
      || typeof current === 'boolean') return current;
    if (typeof current === 'number') {
      return Number.isFinite(current) && !Object.is(current, -0)
        ? current : null;
    }
    if (!current || typeof current !== 'object'
      || util.types.isProxy(current) || util.types.isPromise(current)
      || requireFrozen && !Object.isFrozen(current)
      || seen.has(current) || depth > MAX_GRAPH_DEPTH) return null;
    nodes += 1;
    if (nodes > MAX_GRAPH_NODES) return null;
    seen.add(current);
    let prototype;
    let keys;
    try {
      prototype = Object.getPrototypeOf(current);
      keys = Reflect.ownKeys(current);
    } catch {
      return null;
    }
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) return null;
      const elementKeys = keys.filter((key) => key !== 'length');
      if (elementKeys.length !== current.length
        || elementKeys.some((key, index) => key !== String(index))) return null;
      const output = [];
      for (const key of elementKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) return null;
        const child = visit(descriptor.value, depth + 1);
        if (child === null && descriptor.value !== null) return null;
        output.push(child);
      }
      return Object.freeze(output);
    }
    if (prototype !== Object.prototype && prototype !== null
      || keys.some((key) => typeof key !== 'string'
        || FORBIDDEN_KEYS.has(key))) return null;
    const output = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')) return null;
      const child = visit(descriptor.value, depth + 1);
      if (child === null && descriptor.value !== null) return null;
      output[key] = child;
    }
    return Object.freeze(output);
  }

  return visit(value, 0);
}

function canonicalArray(value, maximum) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  return keys.length === value.length
    && keys.every((key, index) => key === String(index)) ? value : null;
}

function normalizeRegistration(value, {
  requireFrozen = true,
} = {}) {
  const snapshot = immutableDataSnapshot(value, { requireFrozen });
  const fields = dataFields(snapshot, REGISTRATION_KEYS);
  const transactionFields = fields
    ? dataFields(fields.get('transaction'), TRANSACTION_KEYS)
    : null;
  const request = transactionFields && transactionFields.get('request');
  const receipt = transactionFields && transactionFields.get('receipt');
  const requestPromotionId = isPlainRecord(request)
    ? dataFields(request, Reflect.ownKeys(request), { exact: false })
    : null;
  const receiptPromotionId = isPlainRecord(receipt)
    ? dataFields(receipt, Reflect.ownKeys(receipt), { exact: false })
    : null;
  const promotionId = requestPromotionId
    ? requestPromotionId.get('promotionId') : null;
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_MANUAL_ROLLBACK_PROMOTION_REGISTRATION_SCHEMA_VERSION
    || !VALID_STAGES.has(fields.get('rolloutStage'))
    || !transactionFields
    || transactionFields.get('version') !== CANARY_PROMOTION_TRANSACTION_VERSION
    || !requestPromotionId || !receiptPromotionId
    || typeof promotionId !== 'string' || !SAFE_IDENTIFIER.test(promotionId)
    || receiptPromotionId.get('promotionId') !== promotionId
    || typeof receiptPromotionId.get('inversePatchDigest') !== 'string'
    || !SAFE_DIGEST.test(receiptPromotionId.get('inversePatchDigest'))) {
    return null;
  }
  return snapshot;
}

function normalizeRemove(value) {
  const snapshot = immutableDataSnapshot(value, { requireFrozen: true });
  const fields = dataFields(snapshot, REMOVE_KEYS);
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_MANUAL_ROLLBACK_JOURNAL_REMOVE_SCHEMA_VERSION
    || typeof fields.get('promotionId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('promotionId'))) return null;
  return snapshot;
}

function createSnapshot(registrations) {
  return Object.freeze({
    schemaVersion: CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
    registrations: Object.freeze([...registrations]),
  });
}

function normalizeSnapshot(value, config) {
  const snapshot = immutableDataSnapshot(value);
  const fields = dataFields(snapshot, SNAPSHOT_KEYS);
  const values = fields
    ? canonicalArray(fields.get('registrations'), config.maxRegistrations)
    : null;
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_MANUAL_ROLLBACK_JOURNAL_SNAPSHOT_SCHEMA_VERSION
    || !values) return null;
  const registrations = [];
  const promotionIds = new Set();
  for (const valueEntry of values) {
    const registration = normalizeRegistration(
      valueEntry,
      { requireFrozen: false }
    );
    const promotionId = registration
      && registration.transaction.request.promotionId;
    if (!registration || promotionIds.has(promotionId)) return null;
    promotionIds.add(promotionId);
    registrations.push(registration);
  }
  return createSnapshot(registrations);
}

function normalizeOptions(options) {
  const fields = dataFields(options, OPTION_KEYS, { exact: false });
  if (!fields || !fields.has('storageDir')) {
    fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.INVALID_OPTIONS);
  }
  const storageDir = fields.get('storageDir');
  const resolvedStorageDir = typeof storageDir === 'string'
    && storageDir && storageDir === storageDir.trim()
    && !storageDir.includes('\0') && path.isAbsolute(storageDir)
    ? path.resolve(storageDir) : null;
  const maxRegistrations = fields.has('maxRegistrations')
    ? fields.get('maxRegistrations') : DEFAULT_MAX_REGISTRATIONS;
  const maxJournalBytes = fields.has('maxJournalBytes')
    ? fields.get('maxJournalBytes') : DEFAULT_MAX_JOURNAL_BYTES;
  if (!resolvedStorageDir
    || resolvedStorageDir === path.parse(resolvedStorageDir).root
    || !Number.isSafeInteger(maxRegistrations) || maxRegistrations < 1
    || maxRegistrations > HARD_MAX_REGISTRATIONS
    || !Number.isSafeInteger(maxJournalBytes) || maxJournalBytes < 1
    || maxJournalBytes > HARD_MAX_JOURNAL_BYTES) {
    fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.INVALID_OPTIONS);
  }
  return Object.freeze({
    storageDir: resolvedStorageDir,
    maxRegistrations,
    maxJournalBytes,
  });
}

function isOwnedByCurrentUser(stat) {
  return typeof process.getuid !== 'function'
    || Number(stat.uid) === process.getuid();
}

function permissionBits(stat) {
  return Number(stat.mode) & 0o777;
}

function fileIdentity(stat) {
  return Object.freeze({
    device: String(stat.dev),
    inode: String(stat.ino),
    mode: Number(stat.mode),
    links: Number(stat.nlink),
    size: Number(stat.size),
    uid: stat.uid === undefined ? '' : String(stat.uid),
    mtimeMs: Number(stat.mtimeMs),
    ctimeMs: Number(stat.ctimeMs),
    birthtimeMs: Number(stat.birthtimeMs),
  });
}

function sameFileState(left, right) {
  return left.device === right.device && left.inode === right.inode
    && left.mode === right.mode && left.links === right.links
    && left.size === right.size && left.uid === right.uid
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    && left.birthtimeMs === right.birthtimeMs;
}

function sameDirectoryState(left, right) {
  return left.device === right.device && left.inode === right.inode
    && left.mode === right.mode && left.uid === right.uid;
}

function assertSecureFile(stat, maximumBytes, reason) {
  if (!stat.isFile() || stat.isSymbolicLink()
    || Number(stat.nlink) !== 1 || !isOwnedByCurrentUser(stat)
    || process.platform !== 'win32' && permissionBits(stat) !== 0o600
    || !Number.isSafeInteger(Number(stat.size)) || Number(stat.size) < 1
    || Number(stat.size) > maximumBytes) fail(reason);
}

function syncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      directoryPath,
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0)
    );
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform === 'win32' && error
      && WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES.has(error.code)) return;
    fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function preparePrivateDirectory(storageDir) {
  try {
    const storage = fs.lstatSync(storageDir);
    if (!storage.isDirectory() || storage.isSymbolicLink()
      || !isOwnedByCurrentUser(storage)) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_INVALID);
    }
    const realStorageDir = path.resolve(fs.realpathSync(storageDir));
    const directoryPath = path.join(
      realStorageDir,
      CANARY_MANUAL_ROLLBACK_JOURNAL_DIRECTORY_NAME
    );
    let created = false;
    try {
      fs.mkdirSync(directoryPath, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
    const directory = fs.lstatSync(directoryPath);
    if (!directory.isDirectory() || directory.isSymbolicLink()
      || !isOwnedByCurrentUser(directory)
      || path.resolve(fs.realpathSync(directoryPath)) !== directoryPath) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_INVALID);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(directoryPath, 0o700);
      if (permissionBits(fs.lstatSync(directoryPath)) !== 0o700) {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_INVALID);
      }
    }
    if (created) syncDirectory(realStorageDir);
    return Object.freeze({
      path: directoryPath,
      identity: fileIdentity(fs.lstatSync(directoryPath)),
    });
  } catch (error) {
    if (error instanceof CanaryManualRollbackJournalError) throw error;
    fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_INVALID);
  }
}

function canonicalSnapshotBytes(snapshot, config) {
  let bytes;
  try { bytes = Buffer.from(`${JSON.stringify(snapshot)}\n`, 'utf8'); } catch {
    fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.INVALID_REGISTRATION);
  }
  if (bytes.length < 1 || bytes.length > config.maxJournalBytes) {
    fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.CAPACITY_EXCEEDED);
  }
  return bytes;
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(
      descriptor,
      bytes,
      offset,
      bytes.length - offset,
      null
    );
    if (!Number.isSafeInteger(written) || written < 1) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
    }
    offset += written;
  }
}

function createCanaryManualRollbackJournalAdapter(options = {}) {
  const config = normalizeOptions(options);
  const directory = preparePrivateDirectory(config.storageDir);
  const directoryPath = directory.path;
  const filePath = path.join(
    directoryPath,
    CANARY_MANUAL_ROLLBACK_JOURNAL_FILE_NAME
  );
  const pinnedDirectoryState = directory.identity;
  let loaded = false;
  let registrations = Object.freeze([]);
  let promotionIds = new Set();
  let pinnedFileState = null;

  function assertDirectoryUnchanged() {
    try {
      const current = fs.lstatSync(directoryPath);
      if (!current.isDirectory() || current.isSymbolicLink()
        || !isOwnedByCurrentUser(current)
        || process.platform !== 'win32' && permissionBits(current) !== 0o700
        || path.resolve(fs.realpathSync(directoryPath)) !== directoryPath
        || !sameDirectoryState(pinnedDirectoryState, fileIdentity(current))) {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED);
      }
    } catch (error) {
      if (error instanceof CanaryManualRollbackJournalError) throw error;
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED);
    }
  }

  function directoryEntries() {
    assertDirectoryUnchanged();
    let names;
    try { names = fs.readdirSync(directoryPath).sort(); } catch {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
    }
    if (names.length > 1
      || names.length === 1
        && names[0] !== CANARY_MANUAL_ROLLBACK_JOURNAL_FILE_NAME) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.JOURNAL_CORRUPTED);
    }
    return names;
  }

  function readPersistedJournal() {
    const names = directoryEntries();
    if (names.length === 0) {
      return Object.freeze({
        snapshot: createSnapshot([]),
        fileState: null,
      });
    }
    let descriptor;
    try {
      const before = fs.lstatSync(filePath);
      assertSecureFile(
        before,
        config.maxJournalBytes,
        CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_INVALID
      );
      descriptor = fs.openSync(
        filePath,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
      );
      const opened = fs.fstatSync(descriptor);
      assertSecureFile(
        opened,
        config.maxJournalBytes,
        CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_INVALID
      );
      if (!sameFileState(fileIdentity(before), fileIdentity(opened))) {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED);
      }
      const bytes = fs.readFileSync(descriptor);
      const after = fs.fstatSync(descriptor);
      const finalPath = fs.lstatSync(filePath);
      assertSecureFile(
        after,
        config.maxJournalBytes,
        CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED
      );
      assertSecureFile(
        finalPath,
        config.maxJournalBytes,
        CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED
      );
      const finalIdentity = fileIdentity(after);
      if (bytes.length !== finalIdentity.size
        || !sameFileState(fileIdentity(opened), finalIdentity)
        || !sameFileState(finalIdentity, fileIdentity(finalPath))
        || bytes[bytes.length - 1] !== 0x0a) {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED);
      }
      let parsed;
      try { parsed = JSON.parse(bytes.toString('utf8').slice(0, -1)); } catch {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.JOURNAL_CORRUPTED);
      }
      const snapshot = normalizeSnapshot(parsed, config);
      if (!snapshot
        || `${JSON.stringify(snapshot)}\n` !== bytes.toString('utf8')) {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.JOURNAL_CORRUPTED);
      }
      assertDirectoryUnchanged();
      return Object.freeze({ snapshot, fileState: finalIdentity });
    } catch (error) {
      if (error instanceof CanaryManualRollbackJournalError) throw error;
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
    }
  }

  function ensureLoaded() {
    if (loaded) return;
    const recovered = readPersistedJournal();
    registrations = recovered.snapshot.registrations;
    promotionIds = new Set(registrations.map(
      (registration) => registration.transaction.request.promotionId
    ));
    pinnedFileState = recovered.fileState;
    loaded = true;
  }

  function assertStorageUnchanged() {
    const names = directoryEntries();
    if (pinnedFileState === null) {
      if (names.length !== 0) {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED);
      }
      return;
    }
    if (names.length !== 1) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED);
    }
    try {
      const current = fs.lstatSync(filePath);
      assertSecureFile(
        current,
        config.maxJournalBytes,
        CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED
      );
      if (!sameFileState(pinnedFileState, fileIdentity(current))) {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED);
      }
    } catch (error) {
      if (error instanceof CanaryManualRollbackJournalError) throw error;
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_CHANGED);
    }
    assertDirectoryUnchanged();
  }

  function persist(nextRegistrations) {
    const snapshot = createSnapshot(nextRegistrations);
    const bytes = canonicalSnapshotBytes(snapshot, config);
    assertStorageUnchanged();
    const temporaryPath = path.join(
      directoryPath,
      `.manual-rollback-${crypto.randomBytes(16).toString('hex')}.tmp`
    );
    let descriptor;
    let renamed = false;
    try {
      descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW || 0),
        0o600
      );
      if (process.platform !== 'win32') fs.fchmodSync(descriptor, 0o600);
      writeAll(descriptor, bytes);
      fs.fsyncSync(descriptor);
      const written = fs.fstatSync(descriptor);
      assertSecureFile(
        written,
        config.maxJournalBytes,
        CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_UNAVAILABLE
      );
      if (Number(written.size) !== bytes.length) {
        fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
      }
      fs.closeSync(descriptor);
      descriptor = undefined;
      assertDirectoryUnchanged();
      fs.renameSync(temporaryPath, filePath);
      renamed = true;
      syncDirectory(directoryPath);
      const finalStat = fs.lstatSync(filePath);
      assertSecureFile(
        finalStat,
        config.maxJournalBytes,
        CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_UNAVAILABLE
      );
      pinnedFileState = fileIdentity(finalStat);
      registrations = snapshot.registrations;
      promotionIds = new Set(registrations.map(
        (registration) => registration.transaction.request.promotionId
      ));
      return undefined;
    } catch (error) {
      if (error instanceof CanaryManualRollbackJournalError) throw error;
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      if (!renamed) {
        try {
          const temporary = fs.lstatSync(temporaryPath);
          if (temporary.isFile() && !temporary.isSymbolicLink()) {
            fs.unlinkSync(temporaryPath);
          }
        } catch {}
      }
    }
  }

  function load() {
    ensureLoaded();
    assertStorageUnchanged();
    return createSnapshot(registrations);
  }

  function append(value) {
    const registration = normalizeRegistration(value);
    if (!registration) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.INVALID_REGISTRATION);
    }
    ensureLoaded();
    const promotionId = registration.transaction.request.promotionId;
    if (promotionIds.has(promotionId)) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.DUPLICATE_REGISTRATION);
    }
    if (registrations.length >= config.maxRegistrations) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.CAPACITY_EXCEEDED);
    }
    return persist([...registrations, registration]);
  }

  function remove(value) {
    const removal = normalizeRemove(value);
    if (!removal) {
      fail(CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS.INVALID_REMOVE);
    }
    ensureLoaded();
    if (!promotionIds.has(removal.promotionId)) {
      assertStorageUnchanged();
      return undefined;
    }
    return persist(registrations.filter(
      (registration) => registration.transaction.request.promotionId
        !== removal.promotionId
    ));
  }

  function diagnostics() {
    return JOURNAL_DIAGNOSTICS;
  }

  return Object.freeze({
    version: CANARY_MANUAL_ROLLBACK_JOURNAL_VERSION,
    load,
    append,
    remove,
    diagnostics,
  });
}

module.exports = {
  CANARY_MANUAL_ROLLBACK_JOURNAL_DIRECTORY_NAME,
  CANARY_MANUAL_ROLLBACK_JOURNAL_FILE_NAME,
  CANARY_MANUAL_ROLLBACK_JOURNAL_REASONS,
  CanaryManualRollbackJournalError,
  createCanaryManualRollbackJournalAdapter,
};
