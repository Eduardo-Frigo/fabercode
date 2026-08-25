'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const {
  CANARY_PROMOTION_ROLLBACK_CANCEL_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_COMMIT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_PREPARED_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_RECOVERY_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_SETTLEMENT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_STORE_VERSION,
} = require('../agent_runtime/canary_promotion_rollback_store_contract');

const CANARY_PROMOTION_ROLLBACK_STORE_DIRECTORY_NAME =
  'canary-promotion-rollbacks';
const CANARY_PROMOTION_ROLLBACK_STORE_RECORD_SCHEMA_VERSION =
  'canary-promotion-rollback-store-record.v1';
const CANARY_PROMOTION_ROLLBACK_STORE_REASONS = Object.freeze({
  CAPACITY_EXCEEDED: 'CANARY_PROMOTION_ROLLBACK_STORE_CAPACITY_EXCEEDED',
  DUPLICATE_PROMOTION: 'CANARY_PROMOTION_ROLLBACK_STORE_DUPLICATE_PROMOTION',
  INVALID_OPTIONS: 'CANARY_PROMOTION_ROLLBACK_STORE_INVALID_OPTIONS',
  INVALID_RECORD: 'CANARY_PROMOTION_ROLLBACK_STORE_INVALID_RECORD',
  RECOVERY_AMBIGUOUS: 'CANARY_PROMOTION_ROLLBACK_STORE_RECOVERY_AMBIGUOUS',
  STATE_CONFLICT: 'CANARY_PROMOTION_ROLLBACK_STORE_STATE_CONFLICT',
  STORAGE_CHANGED: 'CANARY_PROMOTION_ROLLBACK_STORE_STORAGE_CHANGED',
  STORAGE_CORRUPTED: 'CANARY_PROMOTION_ROLLBACK_STORE_STORAGE_CORRUPTED',
  STORAGE_INVALID: 'CANARY_PROMOTION_ROLLBACK_STORE_STORAGE_INVALID',
  STORAGE_UNAVAILABLE: 'CANARY_PROMOTION_ROLLBACK_STORE_STORAGE_UNAVAILABLE',
});

const STORE_DIAGNOSTICS = Object.freeze({
  version: CANARY_PROMOTION_ROLLBACK_STORE_VERSION,
  durability: 'private_user_data',
  stateModel: 'prepared_committed_settled',
});
const DEFAULT_MAX_RECORDS = 4096;
const HARD_MAX_RECORDS = 100_000;
const DEFAULT_MAX_RECORD_BYTES = 512 * 1024 * 1024;
const HARD_MAX_RECORD_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const HARD_MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_GRAPH_DEPTH = 128;
const MAX_GRAPH_NODES = 1_000_000;
const MAX_PROMOTION_ENTRIES = 32;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const RECORD_FILE = /^[a-f0-9]{64}\.json$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPTION_KEYS = Object.freeze([
  'storageDir',
  'maxRecords',
  'maxRecordBytes',
  'maxTotalBytes',
]);
const PREPARED_KEYS = Object.freeze([
  'schemaVersion',
  'promotionId',
  'request',
  'inversePatchDigest',
  'entries',
]);
const COMMIT_KEYS = Object.freeze([
  'schemaVersion',
  'promotionId',
  'promotionReceipt',
  'sourceAfter',
]);
const TERMINAL_KEYS = Object.freeze(['schemaVersion', 'promotionId']);
const PREPARED_ENVELOPE_KEYS = Object.freeze([
  'schemaVersion',
  'state',
  'promotionId',
  'prepared',
]);
const COMMITTED_ENVELOPE_KEYS = Object.freeze([
  'schemaVersion',
  'state',
  'promotionId',
  'recovery',
]);
const RECOVERY_KEYS = Object.freeze([
  'schemaVersion',
  'request',
  'inversePatchDigest',
  'entries',
  'promotionReceipt',
  'sourceAfter',
]);
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set([
  'EACCES',
  'EINVAL',
  'EISDIR',
  'ENOTSUP',
  'EPERM',
]);

class CanaryPromotionRollbackStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryPromotionRollbackStoreError';
    this.code = code;
  }
}

function storeError(code) {
  return new CanaryPromotionRollbackStoreError(code);
}

function fail(code) {
  throw storeError(code);
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

function normalizeOptions(options) {
  const fields = dataFields(options, OPTION_KEYS, { exact: false });
  if (!fields || !fields.has('storageDir')) {
    fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.INVALID_OPTIONS);
  }
  const storageDir = fields.get('storageDir');
  const resolvedStorageDir = typeof storageDir === 'string'
    && storageDir && storageDir === storageDir.trim()
    && !storageDir.includes('\0') && path.isAbsolute(storageDir)
    ? path.resolve(storageDir) : null;
  const maxRecords = fields.has('maxRecords')
    ? fields.get('maxRecords') : DEFAULT_MAX_RECORDS;
  const maxRecordBytes = fields.has('maxRecordBytes')
    ? fields.get('maxRecordBytes') : DEFAULT_MAX_RECORD_BYTES;
  const maxTotalBytes = fields.has('maxTotalBytes')
    ? fields.get('maxTotalBytes') : DEFAULT_MAX_TOTAL_BYTES;
  if (!resolvedStorageDir
    || resolvedStorageDir === path.parse(resolvedStorageDir).root
    || !Number.isSafeInteger(maxRecords) || maxRecords < 1
    || maxRecords > HARD_MAX_RECORDS
    || !Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1
    || maxRecordBytes > HARD_MAX_RECORD_BYTES
    || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < maxRecordBytes
    || maxTotalBytes > HARD_MAX_TOTAL_BYTES) {
    fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.INVALID_OPTIONS);
  }
  return Object.freeze({
    storageDir: resolvedStorageDir,
    maxRecords,
    maxRecordBytes,
    maxTotalBytes,
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

function sameFilesystemObject(left, right) {
  return left.device === right.device && left.inode === right.inode;
}

function sameFileState(left, right) {
  return sameFilesystemObject(left, right)
    && left.mode === right.mode && left.links === right.links
    && left.size === right.size && left.uid === right.uid
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    && left.birthtimeMs === right.birthtimeMs;
}

function sameDirectoryState(left, right) {
  return sameFilesystemObject(left, right)
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
    fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE);
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
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_INVALID);
    }
    const realStorageDir = path.resolve(fs.realpathSync(storageDir));
    const directoryPath = path.join(
      realStorageDir,
      CANARY_PROMOTION_ROLLBACK_STORE_DIRECTORY_NAME
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
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_INVALID);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(directoryPath, 0o700);
      if (permissionBits(fs.lstatSync(directoryPath)) !== 0o700) {
        fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_INVALID);
      }
    }
    if (created) syncDirectory(realStorageDir);
    const secured = fs.lstatSync(directoryPath);
    return Object.freeze({
      path: directoryPath,
      identity: fileIdentity(secured),
    });
  } catch (error) {
    if (error instanceof CanaryPromotionRollbackStoreError) throw error;
    fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_INVALID);
  }
}

function promotionFileName(promotionId) {
  return crypto.createHash('sha256').update(promotionId, 'utf8').digest('hex')
    + '.json';
}

function frozenArray(value, { minimum = 0, maximum } = {}) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum || value.length > maximum) return null;
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  return keys.length === value.length
    && keys.every((key, index) => key === String(index)) ? value : null;
}

function normalizePrepared(value, { requireFrozen = true } = {}) {
  const snapshot = immutableDataSnapshot(value, { requireFrozen });
  const fields = dataFields(snapshot, PREPARED_KEYS);
  const entries = fields && frozenArray(fields.get('entries'), {
    minimum: 1,
    maximum: MAX_PROMOTION_ENTRIES,
  });
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_PROMOTION_ROLLBACK_PREPARED_SCHEMA_VERSION
    || typeof fields.get('promotionId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('promotionId'))
    || !isPlainRecord(fields.get('request'))
    || typeof fields.get('inversePatchDigest') !== 'string'
    || !SAFE_DIGEST.test(fields.get('inversePatchDigest'))
    || !entries) return null;
  return snapshot;
}

function normalizeCommit(value, { requireFrozen = true } = {}) {
  const snapshot = immutableDataSnapshot(value, { requireFrozen });
  const fields = dataFields(snapshot, COMMIT_KEYS);
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_PROMOTION_ROLLBACK_COMMIT_SCHEMA_VERSION
    || typeof fields.get('promotionId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('promotionId'))
    || !isPlainRecord(fields.get('promotionReceipt'))
    || !isPlainRecord(fields.get('sourceAfter'))) return null;
  return snapshot;
}

function normalizeTerminal(value, schemaVersion) {
  const snapshot = immutableDataSnapshot(value, { requireFrozen: true });
  const fields = dataFields(snapshot, TERMINAL_KEYS);
  if (!fields || fields.get('schemaVersion') !== schemaVersion
    || typeof fields.get('promotionId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('promotionId'))) return null;
  return snapshot;
}

function createRecovery(prepared, commit) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_RECOVERY_SCHEMA_VERSION,
    request: prepared.request,
    inversePatchDigest: prepared.inversePatchDigest,
    entries: prepared.entries,
    promotionReceipt: commit.promotionReceipt,
    sourceAfter: commit.sourceAfter,
  });
}

function normalizeRecovery(value) {
  const fields = dataFields(value, RECOVERY_KEYS);
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_PROMOTION_ROLLBACK_RECOVERY_SCHEMA_VERSION
    || !isPlainRecord(fields.get('request'))
    || typeof fields.get('inversePatchDigest') !== 'string'
    || !SAFE_DIGEST.test(fields.get('inversePatchDigest'))
    || !frozenArray(fields.get('entries'), {
      minimum: 1,
      maximum: MAX_PROMOTION_ENTRIES,
    })
    || !isPlainRecord(fields.get('promotionReceipt'))
    || !isPlainRecord(fields.get('sourceAfter'))) return null;
  return value;
}

function preparedEnvelope(prepared) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_STORE_RECORD_SCHEMA_VERSION,
    state: 'prepared',
    promotionId: prepared.promotionId,
    prepared,
  });
}

function committedEnvelope(promotionId, recovery) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_STORE_RECORD_SCHEMA_VERSION,
    state: 'committed',
    promotionId,
    recovery,
  });
}

function normalizeEnvelope(value) {
  const snapshot = immutableDataSnapshot(value);
  const preparedFields = dataFields(snapshot, PREPARED_ENVELOPE_KEYS);
  if (preparedFields
    && preparedFields.get('schemaVersion')
      === CANARY_PROMOTION_ROLLBACK_STORE_RECORD_SCHEMA_VERSION
    && preparedFields.get('state') === 'prepared') {
    const prepared = normalizePrepared(
      preparedFields.get('prepared'),
      { requireFrozen: false }
    );
    if (prepared && prepared.promotionId === preparedFields.get('promotionId')) {
      return preparedEnvelope(prepared);
    }
    return null;
  }
  const committedFields = dataFields(snapshot, COMMITTED_ENVELOPE_KEYS);
  if (committedFields
    && committedFields.get('schemaVersion')
      === CANARY_PROMOTION_ROLLBACK_STORE_RECORD_SCHEMA_VERSION
    && committedFields.get('state') === 'committed'
    && typeof committedFields.get('promotionId') === 'string'
    && SAFE_IDENTIFIER.test(committedFields.get('promotionId'))) {
    const recovery = normalizeRecovery(committedFields.get('recovery'));
    return recovery
      ? committedEnvelope(committedFields.get('promotionId'), recovery)
      : null;
  }
  return null;
}

function canonicalRecordBytes(envelope, config) {
  let bytes;
  try { bytes = Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8'); } catch {
    fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.INVALID_RECORD);
  }
  if (bytes.length < 1 || bytes.length > config.maxRecordBytes) {
    fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.CAPACITY_EXCEEDED);
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
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE);
    }
    offset += written;
  }
}

function readStoredRecord(filePath, fileName, config) {
  let descriptor;
  try {
    const before = fs.lstatSync(filePath);
    assertSecureFile(
      before,
      config.maxRecordBytes,
      CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_INVALID
    );
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    );
    const opened = fs.fstatSync(descriptor);
    assertSecureFile(
      opened,
      config.maxRecordBytes,
      CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_INVALID
    );
    if (!sameFileState(fileIdentity(before), fileIdentity(opened))) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const finalPath = fs.lstatSync(filePath);
    assertSecureFile(
      after,
      config.maxRecordBytes,
      CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED
    );
    assertSecureFile(
      finalPath,
      config.maxRecordBytes,
      CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED
    );
    const identity = fileIdentity(after);
    if (bytes.length !== identity.size
      || !sameFileState(fileIdentity(opened), identity)
      || !sameFileState(identity, fileIdentity(finalPath))
      || bytes[bytes.length - 1] !== 0x0a) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED);
    }
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8').slice(0, -1)); } catch {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CORRUPTED);
    }
    const envelope = normalizeEnvelope(parsed);
    if (!envelope || promotionFileName(envelope.promotionId) !== fileName
      || `${JSON.stringify(envelope)}\n` !== bytes.toString('utf8')) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CORRUPTED);
    }
    return Object.freeze({ envelope, identity, bytes: bytes.length });
  } catch (error) {
    if (error instanceof CanaryPromotionRollbackStoreError) throw error;
    fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function createCanaryPromotionRollbackStoreAdapter(options = {}) {
  const config = normalizeOptions(options);
  const directory = preparePrivateDirectory(config.storageDir);
  const directoryPath = directory.path;
  const pinnedDirectoryState = directory.identity;
  let loaded = false;
  let records = new Map();
  let totalBytes = 0;

  function assertDirectoryUnchanged() {
    try {
      const current = fs.lstatSync(directoryPath);
      if (!current.isDirectory() || current.isSymbolicLink()
        || !isOwnedByCurrentUser(current)
        || process.platform !== 'win32' && permissionBits(current) !== 0o700
        || path.resolve(fs.realpathSync(directoryPath)) !== directoryPath
        || !sameDirectoryState(pinnedDirectoryState, fileIdentity(current))) {
        fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED);
      }
    } catch (error) {
      if (error instanceof CanaryPromotionRollbackStoreError) throw error;
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED);
    }
  }

  function scanRecords() {
    assertDirectoryUnchanged();
    let names;
    try { names = fs.readdirSync(directoryPath).sort(); } catch {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE);
    }
    if (names.length > config.maxRecords
      || names.some((name) => typeof name !== 'string'
        || !RECORD_FILE.test(name))) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CORRUPTED);
    }
    const recovered = new Map();
    let observedBytes = 0;
    for (const name of names) {
      const filePath = path.join(directoryPath, name);
      const stored = readStoredRecord(filePath, name, config);
      if (recovered.has(stored.envelope.promotionId)) {
        fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CORRUPTED);
      }
      observedBytes += stored.bytes;
      if (!Number.isSafeInteger(observedBytes)
        || observedBytes > config.maxTotalBytes) {
        fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.CAPACITY_EXCEEDED);
      }
      recovered.set(stored.envelope.promotionId, Object.freeze({
        fileName: name,
        filePath,
        envelope: stored.envelope,
        identity: stored.identity,
        bytes: stored.bytes,
      }));
    }
    assertDirectoryUnchanged();
    return Object.freeze({ records: recovered, totalBytes: observedBytes });
  }

  function hasPreparedRecord() {
    return [...records.values()].some(
      (record) => record.envelope.state === 'prepared'
    );
  }

  function ensureLoaded({ allowPrepared = false } = {}) {
    if (!loaded) {
      const recovered = scanRecords();
      records = recovered.records;
      totalBytes = recovered.totalBytes;
      loaded = true;
    }
    if (!allowPrepared && hasPreparedRecord()) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.RECOVERY_AMBIGUOUS);
    }
  }

  function assertStorageUnchanged() {
    assertDirectoryUnchanged();
    let names;
    try { names = fs.readdirSync(directoryPath).sort(); } catch {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED);
    }
    const expectedNames = [...records.values()]
      .map((record) => record.fileName).sort();
    if (names.length !== expectedNames.length
      || names.some((name, index) => name !== expectedNames[index])) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED);
    }
    for (const record of records.values()) {
      try {
        const current = fs.lstatSync(record.filePath);
        assertSecureFile(
          current,
          config.maxRecordBytes,
          CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED
        );
        if (!sameFileState(record.identity, fileIdentity(current))) {
          fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED);
        }
      } catch (error) {
        if (error instanceof CanaryPromotionRollbackStoreError) throw error;
        fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_CHANGED);
      }
    }
    assertDirectoryUnchanged();
  }

  function persistEnvelope(envelope, existing = null) {
    const bytes = canonicalRecordBytes(envelope, config);
    const nextTotal = totalBytes - (existing ? existing.bytes : 0) + bytes.length;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > config.maxTotalBytes) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.CAPACITY_EXCEEDED);
    }
    assertStorageUnchanged();
    const fileName = promotionFileName(envelope.promotionId);
    const filePath = path.join(directoryPath, fileName);
    if (existing && existing.fileName !== fileName
      || !existing && records.has(envelope.promotionId)) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STATE_CONFLICT);
    }
    const temporaryPath = path.join(
      directoryPath,
      `.rollback-${crypto.randomBytes(16).toString('hex')}.tmp`
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
        config.maxRecordBytes,
        CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE
      );
      if (Number(written.size) !== bytes.length) {
        fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE);
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
        config.maxRecordBytes,
        CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE
      );
      const stored = Object.freeze({
        fileName,
        filePath,
        envelope,
        identity: fileIdentity(finalStat),
        bytes: bytes.length,
      });
      records.set(envelope.promotionId, stored);
      totalBytes = nextTotal;
      return undefined;
    } catch (error) {
      if (error instanceof CanaryPromotionRollbackStoreError) throw error;
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE);
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

  function removeRecord(record) {
    assertStorageUnchanged();
    try {
      fs.unlinkSync(record.filePath);
      syncDirectory(directoryPath);
    } catch (error) {
      if (error instanceof CanaryPromotionRollbackStoreError) throw error;
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STORAGE_UNAVAILABLE);
    }
    records.delete(record.envelope.promotionId);
    totalBytes -= record.bytes;
  }

  function load() {
    ensureLoaded();
    assertStorageUnchanged();
    const active = [...records.values()]
      .filter((record) => record.envelope.state === 'committed')
      .sort((left, right) => left.envelope.promotionId.localeCompare(
        right.envelope.promotionId
      ))
      .map((record) => record.envelope.recovery);
    return Object.freeze({
      schemaVersion: CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION,
      records: Object.freeze(active),
    });
  }

  function prepare(value) {
    const pending = normalizePrepared(value);
    if (!pending) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.INVALID_RECORD);
    }
    ensureLoaded({ allowPrepared: true });
    if (hasPreparedRecord()) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.RECOVERY_AMBIGUOUS);
    }
    if (records.has(pending.promotionId)) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.DUPLICATE_PROMOTION);
    }
    if (records.size >= config.maxRecords) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.CAPACITY_EXCEEDED);
    }
    return persistEnvelope(preparedEnvelope(pending));
  }

  function commit(value) {
    const commitRecord = normalizeCommit(value);
    if (!commitRecord) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.INVALID_RECORD);
    }
    ensureLoaded({ allowPrepared: true });
    const existing = records.get(commitRecord.promotionId);
    if (!existing || existing.envelope.state !== 'prepared') {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STATE_CONFLICT);
    }
    const recovery = createRecovery(existing.envelope.prepared, commitRecord);
    return persistEnvelope(
      committedEnvelope(commitRecord.promotionId, recovery),
      existing
    );
  }

  function cancel(value) {
    const cancellation = normalizeTerminal(
      value,
      CANARY_PROMOTION_ROLLBACK_CANCEL_SCHEMA_VERSION
    );
    if (!cancellation) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.INVALID_RECORD);
    }
    ensureLoaded({ allowPrepared: true });
    const existing = records.get(cancellation.promotionId);
    if (!existing) {
      assertStorageUnchanged();
      return undefined;
    }
    removeRecord(existing);
    return undefined;
  }

  function settle(value) {
    const settlement = normalizeTerminal(
      value,
      CANARY_PROMOTION_ROLLBACK_SETTLEMENT_SCHEMA_VERSION
    );
    if (!settlement) {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.INVALID_RECORD);
    }
    ensureLoaded({ allowPrepared: true });
    const existing = records.get(settlement.promotionId);
    if (!existing || existing.envelope.state !== 'committed') {
      fail(CANARY_PROMOTION_ROLLBACK_STORE_REASONS.STATE_CONFLICT);
    }
    removeRecord(existing);
    return undefined;
  }

  function diagnostics() {
    return STORE_DIAGNOSTICS;
  }

  return Object.freeze({
    version: CANARY_PROMOTION_ROLLBACK_STORE_VERSION,
    load,
    prepare,
    commit,
    cancel,
    settle,
    diagnostics,
  });
}

module.exports = {
  CANARY_PROMOTION_ROLLBACK_STORE_DIRECTORY_NAME,
  CANARY_PROMOTION_ROLLBACK_STORE_REASONS,
  CANARY_PROMOTION_ROLLBACK_STORE_RECORD_SCHEMA_VERSION,
  CanaryPromotionRollbackStoreError,
  createCanaryPromotionRollbackStoreAdapter,
};
