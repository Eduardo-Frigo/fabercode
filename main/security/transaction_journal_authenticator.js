'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');

const TRANSACTION_JOURNAL_AUTHENTICATOR_VERSION =
  'transactional-delete.hmac-sha256.v1';
const TRANSACTION_JOURNAL_KEY_SCHEMA_VERSION =
  'transactional-delete.journal-key.v1';
const TRANSACTION_JOURNAL_AUTHENTICATOR_DIRECTORY_NAME =
  'transaction-journal-authenticator';
const TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME = 'hmac-key-v1.json';
const ROOT_BINDING_SCHEMA_VERSION = 'transactional-delete.root-binding.v1';
const AUTHENTICATION_PAYLOAD_SCHEMA_VERSION =
  'transactional-delete.authentication-payload.v1';
const KEY_IDENTITY_SCHEMA_VERSION =
  'transactional-delete.key-identity.v1';
const KEY_ID_DOMAIN = 'faber.transactional-delete.journal-key-id.v1';
const TAG_PREFIX = 'hmac-sha256:v1';
const MINIMUM_KEY_BYTES = 32;
const MAXIMUM_KEY_BYTES = 64;
const MAXIMUM_KEY_FILE_BYTES = 2048;
const TRANSIENT_HARDLINK_RETRIES = 50;
const TRANSIENT_HARDLINK_WAIT_MS = 2;
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set([
  'EINVAL',
  'EISDIR',
  'EACCES',
  'ENOTSUP',
  'EPERM',
]);
const SAFE_TAG_PATTERN =
  /^hmac-sha256:v1:(kid-hmac-sha256:[a-f0-9]{64}):([a-f0-9]{64})$/;
const ESCAPED_KEY_FILE_NAME = TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PUBLISHED_KEY_TEMP_PATTERN = new RegExp(
  `^\\.${ESCAPED_KEY_FILE_NAME}\\.[0-9]+\\.[A-Za-z0-9_-]{24}\\.tmp$`
);

class TransactionJournalAuthenticatorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TransactionJournalAuthenticatorError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TransactionJournalAuthenticatorError(code, message);
}

function inspectOptions(options) {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      fail('INVALID_OPTIONS', 'Journal authenticator options must be plain data');
    }
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('INVALID_OPTIONS', 'Journal authenticator options must be plain data');
    }
    const keys = Reflect.ownKeys(options);
    if (keys.length !== 1 || keys[0] !== 'storageDir') {
      fail('INVALID_OPTIONS', 'Journal authenticator options are invalid');
    }
    const descriptor = Object.getOwnPropertyDescriptor(options, 'storageDir');
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_OPTIONS', 'Journal authenticator options must be data properties');
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof TransactionJournalAuthenticatorError) throw error;
    fail('INVALID_OPTIONS', 'Journal authenticator options are invalid');
  }
}

function normalizeStoragePath(value) {
  if (typeof value !== 'string'
    || value !== value.trim()
    || !value
    || value.includes('\0')
    || !path.isAbsolute(value)) {
    fail('INVALID_OPTIONS', 'Journal authenticator storage is invalid');
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    fail('INVALID_OPTIONS', 'Journal authenticator storage is invalid');
  }
  return resolved;
}

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function permissionBits(stat) {
  return Number(stat.mode) & 0o777;
}

function isOwnedByCurrentUser(stat) {
  const uid = currentUid();
  return uid === null || Number(stat.uid) === uid;
}

function statIdentity(stat) {
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
  return left.device === right.device
    && left.inode === right.inode;
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

function isPathWithin(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function waitSynchronously(milliseconds) {
  try {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, milliseconds);
  } catch {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      // A very short fail-closed compatibility wait for runtimes without Atomics.wait.
    }
  }
}

function syncDirectory(directoryPath) {
  let descriptor;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0);
    descriptor = fs.openSync(directoryPath, flags);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform === 'win32'
      && error
      && WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES.has(error.code)) {
      return;
    }
    fail('KEY_STORAGE_UNAVAILABLE', 'Journal authentication storage is unavailable');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function captureStorageDirectory(directoryPath, { privateDirectory = false } = {}) {
  try {
    const before = fs.lstatSync(directoryPath);
    if (!before.isDirectory() || before.isSymbolicLink() || !isOwnedByCurrentUser(before)) {
      fail('KEY_STORAGE_INVALID', 'Journal authentication storage is invalid');
    }
    if (!privateDirectory
      && process.platform !== 'win32'
      && (permissionBits(before) & 0o022) !== 0) {
      fail('KEY_STORAGE_INVALID', 'Journal authentication storage is invalid');
    }
    if (privateDirectory
      && process.platform !== 'win32'
      && permissionBits(before) !== 0o700) {
      fail('KEY_STORAGE_INVALID', 'Journal authentication storage is invalid');
    }
    const realPath = fs.realpathSync(directoryPath);
    const after = fs.lstatSync(directoryPath);
    const beforeIdentity = statIdentity(before);
    const afterIdentity = statIdentity(after);
    if (!sameDirectoryState(beforeIdentity, afterIdentity)) {
      fail('KEY_STORAGE_INVALID', 'Journal authentication storage is unstable');
    }
    return Object.freeze({
      identity: afterIdentity,
      realPath: path.resolve(realPath),
    });
  } catch (error) {
    if (error instanceof TransactionJournalAuthenticatorError) throw error;
    fail('KEY_STORAGE_INVALID', 'Journal authentication storage is invalid');
  }
}

function assertStableStorageDirectory(directoryPath, pinned, options) {
  const current = captureStorageDirectory(directoryPath, options);
  if (current.realPath !== pinned.realPath
    || !sameDirectoryState(current.identity, pinned.identity)) {
    fail('KEY_STATE_CHANGED', 'Journal authentication key state changed');
  }
}

function ensurePrivateStorageDirectory(storageCapture) {
  const privatePath = path.join(
    storageCapture.realPath,
    TRANSACTION_JOURNAL_AUTHENTICATOR_DIRECTORY_NAME
  );
  let created = false;
  try {
    fs.mkdirSync(privatePath, { mode: 0o700 });
    created = true;
    fs.chmodSync(privatePath, 0o700);
  } catch (error) {
    if (!error || error.code !== 'EEXIST') {
      fail('KEY_STORAGE_UNAVAILABLE', 'Journal authentication storage is unavailable');
    }
  }
  const capture = captureStorageDirectory(privatePath, { privateDirectory: true });
  if (!isPathWithin(storageCapture.realPath, capture.realPath)
    || capture.realPath === storageCapture.realPath) {
    fail('KEY_STORAGE_INVALID', 'Journal authentication storage is invalid');
  }
  if (created) syncDirectory(storageCapture.realPath);
  return Object.freeze({ path: privatePath, capture });
}

function strictJsonRecord(bytes) {
  if (!Buffer.isBuffer(bytes)
    || bytes.length < 1
    || bytes.length > MAXIMUM_KEY_FILE_BYTES) {
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  const expectedKeys = ['algorithm', 'keyId', 'schemaVersion', 'secret'];
  const keys = Reflect.ownKeys(value).sort();
  if (keys.length !== expectedKeys.length
    || keys.some((key, index) => typeof key !== 'string' || key !== expectedKeys[index])) {
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  const result = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string') {
      fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
    }
    result[key] = descriptor.value;
  }
  const canonicalBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: result.schemaVersion,
    algorithm: result.algorithm,
    keyId: result.keyId,
    secret: result.secret,
  })}\n`, 'utf8');
  if (canonicalBytes.length !== bytes.length
    || !crypto.timingSafeEqual(canonicalBytes, bytes)) {
    canonicalBytes.fill(0);
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  canonicalBytes.fill(0);
  return result;
}

function decodeSecret(encoded) {
  if (typeof encoded !== 'string'
    || !/^[A-Za-z0-9_-]+$/.test(encoded)
    || encoded.includes('=')) {
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  let secret;
  try {
    secret = Buffer.from(encoded, 'base64url');
  } catch {
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  if (secret.length < MINIMUM_KEY_BYTES
    || secret.length > MAXIMUM_KEY_BYTES
    || secret.toString('base64url') !== encoded) {
    secret.fill(0);
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  return secret;
}

function keyIdentityDigest(identity) {
  return canonicalSha256Digest({
    schemaVersion: KEY_IDENTITY_SCHEMA_VERSION,
    device: identity.device,
    inode: identity.inode,
    birthtimeMs: Number.isFinite(identity.birthtimeMs) ? identity.birthtimeMs : 0,
  });
}

function computeKeyId(secret, identity) {
  return `kid-hmac-sha256:${crypto
    .createHmac('sha256', secret)
    .update(`${KEY_ID_DOMAIN}\0${keyIdentityDigest(identity)}`, 'utf8')
    .digest('hex')}`;
}

function safeTextEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length
    && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function validateKeyRecord(bytes, identity) {
  const record = strictJsonRecord(bytes);
  if (record.schemaVersion !== TRANSACTION_JOURNAL_KEY_SCHEMA_VERSION
    || record.algorithm !== 'hmac-sha256'
    || !/^kid-hmac-sha256:[a-f0-9]{64}$/.test(record.keyId)) {
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  const secret = decodeSecret(record.secret);
  const expectedKeyId = computeKeyId(secret, identity);
  if (!safeTextEqual(record.keyId, expectedKeyId)) {
    secret.fill(0);
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  }
  return Object.freeze({ keyId: expectedKeyId, secret });
}

function assertSecureKeyStat(stat, { allowedLinks = 1 } = {}) {
  if (!stat.isFile()
    || stat.isSymbolicLink()
    || Number(stat.nlink) !== allowedLinks
    || !isOwnedByCurrentUser(stat)
    || (process.platform !== 'win32' && permissionBits(stat) !== 0o600)
    || Number(stat.size) < 1
    || Number(stat.size) > MAXIMUM_KEY_FILE_BYTES) {
    fail(
      Number(stat.nlink) !== allowedLinks ? 'KEY_FILE_HARDLINKED' : 'KEY_STORAGE_INVALID',
      'Journal authentication key is invalid'
    );
  }
}

function readKeyFileSecurely(keyPath, { allowedLinks = 1 } = {}) {
  let descriptor;
  let bytes;
  try {
    const before = fs.lstatSync(keyPath);
    assertSecureKeyStat(before, { allowedLinks });
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(keyPath, flags);
    const opened = fs.fstatSync(descriptor);
    assertSecureKeyStat(opened, { allowedLinks });
    const beforeIdentity = statIdentity(before);
    const openedIdentity = statIdentity(opened);
    if (!sameFileState(beforeIdentity, openedIdentity)) {
      fail('KEY_STORAGE_INVALID', 'Journal authentication key is unstable');
    }
    bytes = fs.readFileSync(descriptor);
    const afterRead = fs.fstatSync(descriptor);
    const finalPath = fs.lstatSync(keyPath);
    assertSecureKeyStat(afterRead, { allowedLinks });
    assertSecureKeyStat(finalPath, { allowedLinks });
    const afterReadIdentity = statIdentity(afterRead);
    const finalPathIdentity = statIdentity(finalPath);
    if (bytes.length !== opened.size
      || !sameFileState(openedIdentity, afterReadIdentity)
      || !sameFileState(afterReadIdentity, finalPathIdentity)) {
      fail('KEY_STORAGE_INVALID', 'Journal authentication key is unstable');
    }
    const key = validateKeyRecord(bytes, finalPathIdentity);
    return Object.freeze({
      identity: finalPathIdentity,
      keyId: key.keyId,
      secret: key.secret,
    });
  } catch (error) {
    if (error instanceof TransactionJournalAuthenticatorError) throw error;
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (bytes) bytes.fill(0);
  }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (!Number.isSafeInteger(written) || written < 1) {
      fail('KEY_STORAGE_UNAVAILABLE', 'Journal authentication key could not be created');
    }
    offset += written;
  }
}

function createKeyFileAtomically(privatePath, keyPath) {
  let descriptor;
  let temporaryPath = '';
  let secret;
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const randomName = crypto.randomBytes(18).toString('base64url');
      temporaryPath = path.join(
        privatePath,
        `.${TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME}.${process.pid}.${randomName}.tmp`
      );
      try {
        const flags = fs.constants.O_WRONLY
          | fs.constants.O_CREAT
          | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW || 0);
        descriptor = fs.openSync(temporaryPath, flags, 0o600);
        break;
      } catch (error) {
        if (!error || error.code !== 'EEXIST' || attempt === 7) throw error;
      }
    }
    if (descriptor === undefined) {
      fail('KEY_STORAGE_UNAVAILABLE', 'Journal authentication key could not be created');
    }
    fs.fchmodSync(descriptor, 0o600);
    const initialStat = fs.fstatSync(descriptor);
    if (!initialStat.isFile()
      || Number(initialStat.nlink) !== 1
      || !isOwnedByCurrentUser(initialStat)) {
      fail('KEY_STORAGE_UNAVAILABLE', 'Journal authentication key could not be created');
    }
    secret = crypto.randomBytes(MINIMUM_KEY_BYTES);
    const identity = statIdentity(initialStat);
    const keyId = computeKeyId(secret, identity);
    const record = Object.freeze({
      schemaVersion: TRANSACTION_JOURNAL_KEY_SCHEMA_VERSION,
      algorithm: 'hmac-sha256',
      keyId,
      secret: secret.toString('base64url'),
    });
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
    writeAll(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const writtenStat = fs.fstatSync(descriptor);
    if (!sameFilesystemObject(identity, statIdentity(writtenStat))
      || Number(writtenStat.size) !== bytes.length
      || Number(writtenStat.nlink) !== 1
      || (process.platform !== 'win32' && permissionBits(writtenStat) !== 0o600)) {
      fail('KEY_STORAGE_UNAVAILABLE', 'Journal authentication key could not be created');
    }
    fs.closeSync(descriptor);
    descriptor = undefined;

    try {
      fs.linkSync(temporaryPath, keyPath);
    } catch (error) {
      if (error && error.code === 'EEXIST') return false;
      throw error;
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      // A concurrent initializer may have completed a strictly validated
      // crash-recovery unlink for this exact inode.
      if (!error || error.code !== 'ENOENT') throw error;
    }
    temporaryPath = '';
    syncDirectory(privatePath);
    return true;
  } catch (error) {
    if (error instanceof TransactionJournalAuthenticatorError) throw error;
    fail('KEY_STORAGE_UNAVAILABLE', 'Journal authentication key could not be created');
  } finally {
    if (secret) secret.fill(0);
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (temporaryPath) {
      try { fs.unlinkSync(temporaryPath); } catch {}
    }
  }
}

function recoverPublishedKeyTempLink(privatePath, keyPath) {
  let keyMaterial;
  let temporaryMaterial;
  try {
    const keyStat = fs.lstatSync(keyPath);
    if (!keyStat.isFile()
      || keyStat.isSymbolicLink()
      || Number(keyStat.nlink) !== 2
      || !isOwnedByCurrentUser(keyStat)
      || (process.platform !== 'win32' && permissionBits(keyStat) !== 0o600)) {
      return false;
    }
    const keyIdentity = statIdentity(keyStat);
    const candidates = fs.readdirSync(privatePath)
      .filter((name) => PUBLISHED_KEY_TEMP_PATTERN.test(name))
      .map((name) => ({ name, entryPath: path.join(privatePath, name) }))
      .filter(({ entryPath }) => {
        try {
          const stat = fs.lstatSync(entryPath);
          return stat.isFile()
            && !stat.isSymbolicLink()
            && Number(stat.nlink) === 2
            && isOwnedByCurrentUser(stat)
            && (process.platform === 'win32' || permissionBits(stat) === 0o600)
            && sameFileState(statIdentity(stat), keyIdentity);
        } catch {
          return false;
        }
      });
    if (candidates.length !== 1) return false;

    const candidate = candidates[0];
    keyMaterial = readKeyFileSecurely(keyPath, { allowedLinks: 2 });
    temporaryMaterial = readKeyFileSecurely(candidate.entryPath, { allowedLinks: 2 });
    if (!sameFileState(keyMaterial.identity, temporaryMaterial.identity)
      || !safeTextEqual(keyMaterial.keyId, temporaryMaterial.keyId)
      || keyMaterial.secret.length !== temporaryMaterial.secret.length
      || !crypto.timingSafeEqual(keyMaterial.secret, temporaryMaterial.secret)) {
      return false;
    }

    const finalKeyStat = fs.lstatSync(keyPath);
    const finalTempStat = fs.lstatSync(candidate.entryPath);
    if (!sameFileState(statIdentity(finalKeyStat), keyMaterial.identity)
      || !sameFileState(statIdentity(finalTempStat), temporaryMaterial.identity)) {
      return false;
    }
    fs.unlinkSync(candidate.entryPath);
    syncDirectory(privatePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    if (error instanceof TransactionJournalAuthenticatorError) throw error;
    fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
  } finally {
    if (keyMaterial) keyMaterial.secret.fill(0);
    if (temporaryMaterial) temporaryMaterial.secret.fill(0);
  }
}

function loadOrCreateKey(privatePath) {
  const keyPath = path.join(
    privatePath,
    TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME
  );
  let exists = false;
  try {
    fs.lstatSync(keyPath);
    exists = true;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
    }
  }
  if (!exists) createKeyFileAtomically(privatePath, keyPath);

  for (let attempt = 0; attempt <= TRANSIENT_HARDLINK_RETRIES; attempt += 1) {
    try {
      return Object.freeze({ keyPath, ...readKeyFileSecurely(keyPath) });
    } catch (error) {
      if (!(error instanceof TransactionJournalAuthenticatorError)
        || error.code !== 'KEY_FILE_HARDLINKED'
        || attempt === TRANSIENT_HARDLINK_RETRIES) {
        throw error;
      }
      if (recoverPublishedKeyTempLink(privatePath, keyPath)) continue;
      waitSynchronously(TRANSIENT_HARDLINK_WAIT_MS);
    }
  }
  fail('KEY_STORAGE_INVALID', 'Journal authentication key is invalid');
}

function captureRootBinding(rootPath, storageRealPath) {
  let descriptor;
  try {
    if (typeof rootPath !== 'string'
      || rootPath !== rootPath.trim()
      || !rootPath
      || rootPath.includes('\0')
      || !path.isAbsolute(rootPath)) {
      fail('INVALID_ROOT', 'Journal authentication root is invalid');
    }
    const resolvedRoot = path.resolve(rootPath);
    if (resolvedRoot === path.parse(resolvedRoot).root) {
      fail('INVALID_ROOT', 'Journal authentication root is invalid');
    }
    const before = fs.lstatSync(resolvedRoot);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      fail('INVALID_ROOT', 'Journal authentication root is invalid');
    }
    const flags = fs.constants.O_RDONLY
      | (fs.constants.O_DIRECTORY || 0)
      | (fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(resolvedRoot, flags);
    const opened = fs.fstatSync(descriptor);
    const realRootPath = path.resolve(fs.realpathSync(resolvedRoot));
    const finalPath = fs.lstatSync(resolvedRoot);
    const beforeIdentity = statIdentity(before);
    const openedIdentity = statIdentity(opened);
    const finalIdentity = statIdentity(finalPath);
    if (!opened.isDirectory()
      || opened.isSymbolicLink()
      || !finalPath.isDirectory()
      || finalPath.isSymbolicLink()
      || !sameFileState(beforeIdentity, openedIdentity)
      || !sameFileState(openedIdentity, finalIdentity)) {
      fail('INVALID_ROOT', 'Journal authentication root is unstable');
    }
    if (isPathWithin(realRootPath, storageRealPath)) {
      fail('STORAGE_INSIDE_PROJECT', 'Journal authentication storage is not isolated');
    }
    return canonicalSha256Digest({
      schemaVersion: ROOT_BINDING_SCHEMA_VERSION,
      realRootPath,
      device: finalIdentity.device,
      inode: finalIdentity.inode,
    });
  } catch (error) {
    if (error instanceof TransactionJournalAuthenticatorError) throw error;
    fail('INVALID_ROOT', 'Journal authentication root is invalid');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function createAuthenticationPayload(keyId, rootBindingDigest, value) {
  let valueDigest;
  try {
    valueDigest = canonicalSha256Digest(value);
  } catch {
    fail('INVALID_VALUE', 'Journal authentication value is invalid');
  }
  return canonicalSha256Digest({
    schemaVersion: AUTHENTICATION_PAYLOAD_SCHEMA_VERSION,
    algorithm: 'hmac-sha256',
    keyId,
    rootBindingDigest,
    valueDigest,
  });
}

function authenticationMac(secret, payloadDigest) {
  return crypto
    .createHmac('sha256', secret)
    .update(payloadDigest, 'utf8')
    .digest('hex');
}

function createTransactionJournalAuthenticator(options = {}) {
  const storagePath = normalizeStoragePath(inspectOptions(options));
  const storageCapture = captureStorageDirectory(storagePath);
  const privateStorage = ensurePrivateStorageDirectory(storageCapture);
  const key = loadOrCreateKey(privateStorage.capture.realPath);
  let operationActive = false;

  function assertStableState() {
    assertStableStorageDirectory(storagePath, storageCapture);
    assertStableStorageDirectory(
      privateStorage.path,
      privateStorage.capture,
      { privateDirectory: true }
    );
    const current = readKeyFileSecurely(key.keyPath);
    try {
      if (!sameFileState(current.identity, key.identity)
        || !safeTextEqual(current.keyId, key.keyId)
        || current.secret.length !== key.secret.length
        || !crypto.timingSafeEqual(current.secret, key.secret)) {
        fail('KEY_STATE_CHANGED', 'Journal authentication key state changed');
      }
    } finally {
      current.secret.fill(0);
    }
  }

  function beginOperation() {
    if (operationActive) {
      fail('REENTRANT_OPERATION', 'Journal authentication operation is already active');
    }
    operationActive = true;
  }

  function seal(rootPath, value) {
    beginOperation();
    try {
      assertStableState();
      const rootBindingDigest = captureRootBinding(
        rootPath,
        privateStorage.capture.realPath
      );
      const payloadDigest = createAuthenticationPayload(key.keyId, rootBindingDigest, value);
      const mac = authenticationMac(key.secret, payloadDigest);
      const finalRootBindingDigest = captureRootBinding(
        rootPath,
        privateStorage.capture.realPath
      );
      if (!safeTextEqual(rootBindingDigest, finalRootBindingDigest)) {
        fail('INVALID_ROOT', 'Journal authentication root is unstable');
      }
      assertStableState();
      return `${TAG_PREFIX}:${key.keyId}:${mac}`;
    } finally {
      operationActive = false;
    }
  }

  function verify(rootPath, value, authenticationTag) {
    if (operationActive) return false;
    operationActive = true;
    try {
      if (typeof authenticationTag !== 'string') return false;
      const match = SAFE_TAG_PATTERN.exec(authenticationTag);
      if (!match) return false;
      assertStableState();
      const rootBindingDigest = captureRootBinding(
        rootPath,
        privateStorage.capture.realPath
      );
      const payloadDigest = createAuthenticationPayload(key.keyId, rootBindingDigest, value);
      const expectedMac = authenticationMac(key.secret, payloadDigest);
      const finalRootBindingDigest = captureRootBinding(
        rootPath,
        privateStorage.capture.realPath
      );
      const keyIdMatches = safeTextEqual(match[1], key.keyId);
      const macMatches = safeTextEqual(match[2], expectedMac);
      const rootMatches = safeTextEqual(rootBindingDigest, finalRootBindingDigest);
      assertStableState();
      return keyIdMatches && macMatches && rootMatches;
    } catch {
      return false;
    } finally {
      operationActive = false;
    }
  }

  Object.freeze(seal);
  Object.freeze(verify);
  return Object.freeze({
    version: TRANSACTION_JOURNAL_AUTHENTICATOR_VERSION,
    seal,
    verify,
  });
}

module.exports = {
  TRANSACTION_JOURNAL_AUTHENTICATOR_DIRECTORY_NAME,
  TRANSACTION_JOURNAL_AUTHENTICATOR_KEY_FILE_NAME,
  TRANSACTION_JOURNAL_AUTHENTICATOR_VERSION,
  TRANSACTION_JOURNAL_KEY_SCHEMA_VERSION,
  TransactionJournalAuthenticatorError,
  createTransactionJournalAuthenticator,
};
