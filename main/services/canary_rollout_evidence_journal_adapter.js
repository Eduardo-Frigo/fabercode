'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const {
  CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
} = require('../agent_runtime/canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../agent_runtime/canary_rollout_selector');

const CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION =
  'canary-rollout-evidence-journal.v1';
const CANARY_ROLLOUT_EVIDENCE_JOURNAL_RECORD_SCHEMA_VERSION =
  'canary-rollout-evidence-journal-record.v1';
const CANARY_ROLLOUT_EVIDENCE_JOURNAL_SNAPSHOT_SCHEMA_VERSION =
  'canary-rollout-evidence-journal-snapshot.v1';
const CANARY_ROLLOUT_EVIDENCE_JOURNAL_DIRECTORY_NAME =
  'canary-rollout-evidence';
const CANARY_ROLLOUT_EVIDENCE_JOURNAL_FILE_NAME = 'evidence-v1.jsonl';

const CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS = Object.freeze({
  DUPLICATE_EVIDENCE: 'CANARY_ROLLOUT_EVIDENCE_JOURNAL_DUPLICATE_EVIDENCE',
  INVALID_EVIDENCE: 'CANARY_ROLLOUT_EVIDENCE_JOURNAL_INVALID_EVIDENCE',
  INVALID_OPTIONS: 'CANARY_ROLLOUT_EVIDENCE_JOURNAL_INVALID_OPTIONS',
  JOURNAL_CORRUPTED: 'CANARY_ROLLOUT_EVIDENCE_JOURNAL_CORRUPTED',
  STORAGE_CHANGED: 'CANARY_ROLLOUT_EVIDENCE_JOURNAL_STORAGE_CHANGED',
  STORAGE_INVALID: 'CANARY_ROLLOUT_EVIDENCE_JOURNAL_STORAGE_INVALID',
  STORAGE_UNAVAILABLE: 'CANARY_ROLLOUT_EVIDENCE_JOURNAL_STORAGE_UNAVAILABLE',
});

const EVIDENCE_KEYS = Object.freeze([
  'schemaVersion',
  'jobId',
  'projectId',
  'rolloutStage',
  'route',
  'eligible',
  'terminal',
  'succeeded',
  'manualRollback',
  'corrupted',
  'dataLossIncident',
  'securityIncident',
  'duplicateExternalEffect',
]);
const RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'sequence',
  'previousRecordDigest',
  'evidence',
  'recordDigest',
]);
const SIGNAL_KEYS = Object.freeze([
  'manualRollback',
  'corrupted',
  'dataLossIncident',
  'securityIncident',
  'duplicateExternalEffect',
]);
const VALID_STAGES = new Set(Object.values(CANARY_ROLLOUT_STAGES));
const VALID_ROUTES = new Set(['baseline', 'canary']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAXIMUM_RECORDS = 1_000_000;
const MAXIMUM_JOURNAL_BYTES = 512 * 1024 * 1024;
const MAXIMUM_RECORD_BYTES = 64 * 1024;
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set([
  'EACCES',
  'EINVAL',
  'EISDIR',
  'ENOTSUP',
  'EPERM',
]);

class CanaryRolloutEvidenceJournalError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryRolloutEvidenceJournalError';
    this.code = code;
  }
}

function journalError(code) {
  return new CanaryRolloutEvidenceJournalError(code);
}

function fail(code) {
  throw journalError(code);
}

function plainDataFields(value, expectedKeys, {
  exact = true,
  frozen = false,
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)
    || frozen && !Object.isFrozen(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || exact && keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key)
      || !expectedKeys.includes(key))
    || exact && expectedKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeEvidence(value, { frozen = false } = {}) {
  const fields = plainDataFields(value, EVIDENCE_KEYS, { frozen });
  if (!fields
    || fields.get('schemaVersion') !== CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION
    || typeof fields.get('jobId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('jobId'))
    || typeof fields.get('projectId') !== 'string'
    || !SAFE_IDENTIFIER.test(fields.get('projectId'))
    || !VALID_STAGES.has(fields.get('rolloutStage'))
    || !VALID_ROUTES.has(fields.get('route'))
    || fields.get('eligible') !== true
    || fields.get('terminal') !== true
    || typeof fields.get('succeeded') !== 'boolean'
    || SIGNAL_KEYS.some((key) => typeof fields.get(key) !== 'boolean')) {
    return null;
  }
  const hasSignal = SIGNAL_KEYS.some((key) => fields.get(key));
  if (fields.get('route') === 'baseline' && hasSignal
    || fields.get('succeeded') && hasSignal) return null;
  return Object.freeze(Object.fromEntries(
    EVIDENCE_KEYS.map((key) => [key, fields.get(key)])
  ));
}

function normalizeStorageDir(options) {
  const fields = plainDataFields(options, ['storageDir']);
  const value = fields ? fields.get('storageDir') : null;
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.includes('\0') || !path.isAbsolute(value)) {
    fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.INVALID_OPTIONS);
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.INVALID_OPTIONS);
  }
  return resolved;
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
    && left.mode === right.mode
    && left.links === right.links
    && left.size === right.size
    && left.uid === right.uid
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.birthtimeMs === right.birthtimeMs;
}

function sameDirectoryState(left, right) {
  return sameFilesystemObject(left, right)
    && left.mode === right.mode
    && left.uid === right.uid;
}

function assertSecureFileStat(stat, reason) {
  if (!stat.isFile() || stat.isSymbolicLink()
    || Number(stat.nlink) !== 1 || !isOwnedByCurrentUser(stat)
    || process.platform !== 'win32' && permissionBits(stat) !== 0o600
    || Number(stat.size) < 0
    || Number(stat.size) > MAXIMUM_JOURNAL_BYTES) fail(reason);
}

function syncDirectory(directoryPath) {
  let descriptor;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0);
    descriptor = fs.openSync(directoryPath, flags);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform === 'win32' && error
      && WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES.has(error.code)) return;
    fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function preparePrivateDirectory(storageDir) {
  let storageStat;
  try {
    storageStat = fs.lstatSync(storageDir);
    if (!storageStat.isDirectory() || storageStat.isSymbolicLink()
      || !isOwnedByCurrentUser(storageStat)) {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID);
    }
    const realStorageDir = path.resolve(fs.realpathSync(storageDir));
    const directoryPath = path.join(
      realStorageDir,
      CANARY_ROLLOUT_EVIDENCE_JOURNAL_DIRECTORY_NAME
    );
    let created = false;
    try {
      fs.mkdirSync(directoryPath, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
    const directoryStat = fs.lstatSync(directoryPath);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
      || !isOwnedByCurrentUser(directoryStat)
      || path.resolve(fs.realpathSync(directoryPath)) !== directoryPath) {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(directoryPath, 0o700);
      const secured = fs.lstatSync(directoryPath);
      if (permissionBits(secured) !== 0o700) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID);
      }
    }
    if (created) syncDirectory(realStorageDir);
    const finalDirectory = fs.lstatSync(directoryPath);
    if (!finalDirectory.isDirectory() || finalDirectory.isSymbolicLink()
      || !isOwnedByCurrentUser(finalDirectory)) {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID);
    }
    return Object.freeze({
      path: directoryPath,
      identity: fileIdentity(finalDirectory),
    });
  } catch (error) {
    if (error instanceof CanaryRolloutEvidenceJournalError) throw error;
    fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID);
  }
}

function digestCore(core) {
  return 'sha256:' + crypto.createHash('sha256')
    .update(JSON.stringify(core), 'utf8')
    .digest('hex');
}

function buildRecord(sequence, previousRecordDigest, evidence) {
  const core = {
    schemaVersion: CANARY_ROLLOUT_EVIDENCE_JOURNAL_RECORD_SCHEMA_VERSION,
    sequence,
    previousRecordDigest,
    evidence,
  };
  return Object.freeze({
    ...core,
    recordDigest: digestCore(core),
  });
}

function parseJournal(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAXIMUM_JOURNAL_BYTES
    || bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
    fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.JOURNAL_CORRUPTED);
  }
  if (bytes.length === 0) {
    return Object.freeze({ evidence: Object.freeze([]), headDigest: null });
  }
  const lines = bytes.toString('utf8').slice(0, -1).split('\n');
  if (lines.length > MAXIMUM_RECORDS) {
    fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.JOURNAL_CORRUPTED);
  }
  const recovered = [];
  const jobIds = new Set();
  let priorDigest = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || Buffer.byteLength(line, 'utf8') > MAXIMUM_RECORD_BYTES) {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.JOURNAL_CORRUPTED);
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.JOURNAL_CORRUPTED);
    }
    const fields = plainDataFields(value, RECORD_KEYS);
    const evidence = fields
      ? normalizeEvidence(fields.get('evidence'))
      : null;
    if (!fields || !evidence
      || fields.get('schemaVersion')
        !== CANARY_ROLLOUT_EVIDENCE_JOURNAL_RECORD_SCHEMA_VERSION
      || fields.get('sequence') !== index
      || fields.get('previousRecordDigest') !== priorDigest
      || typeof fields.get('recordDigest') !== 'string'
      || !SAFE_DIGEST.test(fields.get('recordDigest'))
      || jobIds.has(evidence.jobId)) {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.JOURNAL_CORRUPTED);
    }
    const record = buildRecord(index, priorDigest, evidence);
    if (record.recordDigest !== fields.get('recordDigest')
      || JSON.stringify(record) !== line) {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.JOURNAL_CORRUPTED);
    }
    recovered.push(evidence);
    jobIds.add(evidence.jobId);
    priorDigest = record.recordDigest;
  }
  return Object.freeze({
    evidence: Object.freeze(recovered),
    headDigest: priorDigest,
  });
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
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
    }
    offset += written;
  }
}

function createCanaryRolloutEvidenceJournalAdapter(options = {}) {
  const storageDir = normalizeStorageDir(options);
  const directory = preparePrivateDirectory(storageDir);
  const directoryPath = directory.path;
  const pinnedDirectoryState = directory.identity;
  const filePath = path.join(
    directoryPath,
    CANARY_ROLLOUT_EVIDENCE_JOURNAL_FILE_NAME
  );
  let loaded = false;
  let evidenceRecords = Object.freeze([]);
  let jobIds = new Set();
  let headDigest = null;
  let pinnedFileState = null;
  let persistedBytes = 0;
  let loads = 0;
  let appends = 0;
  let rejections = 0;
  let lastFailureCode = null;

  function reject(error, fallbackCode) {
    const normalized = error instanceof CanaryRolloutEvidenceJournalError
      ? error
      : journalError(fallbackCode);
    rejections += 1;
    lastFailureCode = normalized.code;
    throw normalized;
  }

  function assertDirectoryUnchanged() {
    try {
      const current = fs.lstatSync(directoryPath);
      if (!current.isDirectory() || current.isSymbolicLink()
        || !isOwnedByCurrentUser(current)
        || process.platform !== 'win32' && permissionBits(current) !== 0o700
        || path.resolve(fs.realpathSync(directoryPath)) !== directoryPath
        || !sameDirectoryState(
          pinnedDirectoryState,
          fileIdentity(current)
        )) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
      }
    } catch (error) {
      if (error instanceof CanaryRolloutEvidenceJournalError) throw error;
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
    }
  }

  function readPersistedJournal() {
    assertDirectoryUnchanged();
    if (!fs.existsSync(filePath)) {
      return Object.freeze({
        evidence: Object.freeze([]),
        headDigest: null,
        fileState: null,
        persistedBytes: 0,
      });
    }
    let descriptor;
    let bytes;
    try {
      const before = fs.lstatSync(filePath);
      assertSecureFileStat(
        before,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID
      );
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
      descriptor = fs.openSync(filePath, flags);
      const opened = fs.fstatSync(descriptor);
      assertSecureFileStat(
        opened,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID
      );
      if (!sameFileState(fileIdentity(before), fileIdentity(opened))) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
      }
      bytes = fs.readFileSync(descriptor);
      const after = fs.fstatSync(descriptor);
      const finalPath = fs.lstatSync(filePath);
      assertSecureFileStat(
        after,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID
      );
      assertSecureFileStat(
        finalPath,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_INVALID
      );
      const afterIdentity = fileIdentity(after);
      if (bytes.length !== after.size
        || !sameFileState(fileIdentity(opened), afterIdentity)
        || !sameFileState(afterIdentity, fileIdentity(finalPath))) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
      }
      const parsed = parseJournal(bytes);
      assertDirectoryUnchanged();
      return Object.freeze({
        evidence: parsed.evidence,
        headDigest: parsed.headDigest,
        fileState: afterIdentity,
        persistedBytes: bytes.length,
      });
    } catch (error) {
      if (error instanceof CanaryRolloutEvidenceJournalError) throw error;
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
    }
  }

  function ensureLoaded() {
    if (loaded) return;
    const recovered = readPersistedJournal();
    evidenceRecords = recovered.evidence;
    jobIds = new Set(evidenceRecords.map((entry) => entry.jobId));
    headDigest = recovered.headDigest;
    pinnedFileState = recovered.fileState;
    persistedBytes = recovered.persistedBytes;
    loaded = true;
  }

  function snapshot() {
    return Object.freeze({
      schemaVersion: CANARY_ROLLOUT_EVIDENCE_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
      evidence: Object.freeze([...evidenceRecords]),
    });
  }

  function load() {
    loads += 1;
    try {
      ensureLoaded();
      lastFailureCode = null;
      return snapshot();
    } catch (error) {
      return reject(
        error,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.JOURNAL_CORRUPTED
      );
    }
  }

  function assertStorageUnchanged() {
    assertDirectoryUnchanged();
    if (pinnedFileState === null) {
      if (fs.existsSync(filePath)) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
      }
      return;
    }
    let current;
    try {
      current = fs.lstatSync(filePath);
      assertSecureFileStat(
        current,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED
      );
    } catch (error) {
      if (error instanceof CanaryRolloutEvidenceJournalError) throw error;
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
    }
    if (!sameFileState(pinnedFileState, fileIdentity(current))) {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
    }
  }

  function persist(record) {
    const bytes = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
    if (bytes.length > MAXIMUM_RECORD_BYTES
      || persistedBytes + bytes.length > MAXIMUM_JOURNAL_BYTES) {
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
    }
    let descriptor;
    const existed = pinnedFileState !== null;
    try {
      assertDirectoryUnchanged();
      const flags = fs.constants.O_WRONLY
        | fs.constants.O_APPEND
        | fs.constants.O_CREAT
        | (fs.constants.O_NOFOLLOW || 0);
      descriptor = fs.openSync(filePath, flags, 0o600);
      if (!existed) fs.fchmodSync(descriptor, 0o600);
      const opened = fs.fstatSync(descriptor);
      assertDirectoryUnchanged();
      assertSecureFileStat(
        opened,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED
      );
      const openedIdentity = fileIdentity(opened);
      if (opened.size !== persistedBytes
        || existed && !sameFileState(pinnedFileState, openedIdentity)) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
      }
      writeAll(descriptor, bytes);
      fs.fsyncSync(descriptor);
      const written = fs.fstatSync(descriptor);
      const finalPath = fs.lstatSync(filePath);
      assertDirectoryUnchanged();
      assertSecureFileStat(
        written,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED
      );
      assertSecureFileStat(
        finalPath,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED
      );
      const writtenIdentity = fileIdentity(written);
      if (written.size !== persistedBytes + bytes.length
        || !sameFileState(writtenIdentity, fileIdentity(finalPath))) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_CHANGED);
      }
      pinnedFileState = writtenIdentity;
      persistedBytes = written.size;
    } catch (error) {
      if (error instanceof CanaryRolloutEvidenceJournalError) throw error;
      fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
    }
    if (!existed) syncDirectory(directoryPath);
  }

  function append(value) {
    const evidence = normalizeEvidence(value, { frozen: true });
    if (!evidence) {
      return reject(
        journalError(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.INVALID_EVIDENCE),
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.INVALID_EVIDENCE
      );
    }
    try {
      ensureLoaded();
      if (jobIds.has(evidence.jobId)) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.DUPLICATE_EVIDENCE);
      }
      if (evidenceRecords.length >= MAXIMUM_RECORDS) {
        fail(CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_UNAVAILABLE);
      }
      assertStorageUnchanged();
      const record = buildRecord(
        evidenceRecords.length,
        headDigest,
        evidence
      );
      persist(record);
      evidenceRecords = Object.freeze([...evidenceRecords, evidence]);
      jobIds.add(evidence.jobId);
      headDigest = record.recordDigest;
      appends += 1;
      lastFailureCode = null;
      return undefined;
    } catch (error) {
      return reject(
        error,
        CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS.STORAGE_UNAVAILABLE
      );
    }
  }

  function diagnostics() {
    return Object.freeze({
      version: CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION,
      storageMode: 'private_user_data_append_only',
      records: evidenceRecords.length,
      headDigest,
      loads,
      appends,
      rejections,
      lastFailureCode,
    });
  }

  return Object.freeze({
    version: CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION,
    load,
    append,
    diagnostics,
  });
}

module.exports = {
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_DIRECTORY_NAME,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_FILE_NAME,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_REASONS,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_RECORD_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_SNAPSHOT_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_JOURNAL_VERSION,
  CanaryRolloutEvidenceJournalError,
  createCanaryRolloutEvidenceJournalAdapter,
};
