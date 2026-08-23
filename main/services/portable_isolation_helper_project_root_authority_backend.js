'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const {
  MAX_ENTRY_INSPECTION_BYTES,
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_ENTRY_KINDS,
  PROJECT_ROOT_READER_VERSION,
  assertProjectRootAuthorityAcquireRequest,
  assertProjectRootAuthorityLease,
  assertProjectRootEntryInspectionResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootAuthorityProbeResult,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootPhysicalIdentityDigest,
  createProjectRootReadFileRequest,
} = require('../capabilities/project_root_authority_contract');

const PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_VERSION =
  'portable-project-root-authority-backend.v1';
const PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID =
  'portable-physical-project-root-authority';
const PORTABLE_PROJECT_ROOT_ENTRY_IDENTITY_VERSION =
  'portable-project-root-entry-identity.v1';
const SESSION_DIRECTORY_PREFIX = 'faber-portable-root-snapshots-';
const LEASE_DIRECTORY_PREFIX = 'root-lease-';
const SNAPSHOT_ARCHIVE_NAME = 'snapshot.bin';
const COPY_BUFFER_BYTES = 64 * 1024;
const MAX_SNAPSHOT_ENTRIES = 500_000;
const MAX_SNAPSHOT_ARCHIVE_BYTES = 128n * 1024n * 1024n * 1024n;
const MAX_RELATIVE_PATH_BYTES = 4096;
const MAX_LINK_TARGET_BYTES = 4096;

class PortableProjectRootAuthorityBackendError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableProjectRootAuthorityBackendError';
    this.code = code;
  }
}

function fail(code) {
  throw new PortableProjectRootAuthorityBackendError(code);
}

function rethrow(error, fallbackCode) {
  if (error instanceof PortableProjectRootAuthorityBackendError) throw error;
  fail(fallbackCode);
}

function normalizeOptions(value) {
  const code = 'PROJECT_ROOT_BACKEND_OPTIONS_INVALID';
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) fail(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(code);
  }
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== 0) {
    fail(code);
  }
}

function errorCode(error) {
  if (!error || typeof error !== 'object' || util.types.isProxy(error)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function isMissing(error) {
  return errorCode(error) === 'ENOENT';
}

function lstatBigInt(location) {
  return fs.lstatSync(location, { bigint: true });
}

function statBigInt(location) {
  return fs.statSync(location, { bigint: true });
}

function fstatBigInt(descriptor) {
  return fs.fstatSync(descriptor, { bigint: true });
}

function statKind(stat) {
  try {
    if (stat.isSymbolicLink()) return PROJECT_ROOT_ENTRY_KINDS.SYMLINK;
    if (stat.isDirectory()) return PROJECT_ROOT_ENTRY_KINDS.DIRECTORY;
    if (stat.isFile()) return PROJECT_ROOT_ENTRY_KINDS.FILE;
    return PROJECT_ROOT_ENTRY_KINDS.OTHER;
  } catch {
    return 'unknown';
  }
}

function statSnapshot(stat) {
  if (!stat || typeof stat !== 'object') fail('PROJECT_ROOT_PHYSICAL_IDENTITY_INVALID');
  try {
    return Object.freeze({
      kind: statKind(stat),
      device: String(stat.dev),
      inode: String(stat.ino),
      mode: String(stat.mode),
      size: String(stat.size),
      modifiedNanoseconds: String(stat.mtimeNs),
      changedNanoseconds: String(stat.ctimeNs),
    });
  } catch {
    fail('PROJECT_ROOT_PHYSICAL_IDENTITY_INVALID');
  }
}

function sameIdentity(left, right) {
  return Boolean(left && right
    && left.kind === right.kind
    && left.device === right.device
    && left.inode === right.inode);
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.mode === right.mode
    && left.size === right.size
    && left.modifiedNanoseconds === right.modifiedNanoseconds
    && left.changedNanoseconds === right.changedNanoseconds;
}

function localPathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return path.sep === '\\' ? normalized.toLowerCase() : normalized;
}

function sameLocalPath(left, right) {
  return localPathKey(left) === localPathKey(right);
}

function isInsideOrEqual(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  if (sameLocalPath(parent, candidate)) return true;
  const relative = path.relative(parent, candidate);
  return Boolean(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function isStrictlyInside(parentPath, candidatePath) {
  return !sameLocalPath(parentPath, candidatePath)
    && isInsideOrEqual(parentPath, candidatePath);
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex')}`;
}

function bytesDigest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function physicalRootIdentityDigest(entrySnapshot, targetSnapshot) {
  if (![
    PROJECT_ROOT_ENTRY_KINDS.DIRECTORY,
    PROJECT_ROOT_ENTRY_KINDS.SYMLINK,
  ].includes(entrySnapshot.kind)
    || targetSnapshot.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
    fail('PROJECT_ROOT_PHYSICAL_IDENTITY_INVALID');
  }
  try {
    return createProjectRootPhysicalIdentityDigest({
      device: targetSnapshot.device,
      inode: targetSnapshot.inode,
      entryDevice: entrySnapshot.device,
      entryInode: entrySnapshot.inode,
      entryType: entrySnapshot.kind,
    });
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_PHYSICAL_IDENTITY_INVALID');
  }
}

function captureSourceRoot(request) {
  const canonicalRootPath = request.binding.canonicalRootPath;
  const boundRealRootPath = request.binding.realRootPath;
  if (!path.isAbsolute(canonicalRootPath) || !path.isAbsolute(boundRealRootPath)
    || sameLocalPath(canonicalRootPath, path.parse(canonicalRootPath).root)
    || sameLocalPath(boundRealRootPath, path.parse(boundRealRootPath).root)) {
    fail('PROJECT_ROOT_SOURCE_INVALID');
  }
  try {
    const entryBefore = statSnapshot(lstatBigInt(canonicalRootPath));
    const targetBefore = statSnapshot(statBigInt(canonicalRootPath));
    if (![
      PROJECT_ROOT_ENTRY_KINDS.DIRECTORY,
      PROJECT_ROOT_ENTRY_KINDS.SYMLINK,
    ].includes(entryBefore.kind)
      || targetBefore.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
      fail('PROJECT_ROOT_SOURCE_INVALID');
    }
    const realRootPath = fs.realpathSync(canonicalRootPath);
    const boundPhysicalPath = fs.realpathSync(boundRealRootPath);
    if (!sameLocalPath(realRootPath, boundPhysicalPath)
      || sameLocalPath(realRootPath, path.parse(realRootPath).root)) {
      fail('PROJECT_ROOT_SOURCE_BINDING_MISMATCH');
    }
    const realRoot = statSnapshot(lstatBigInt(realRootPath));
    const entryAfter = statSnapshot(lstatBigInt(canonicalRootPath));
    const targetAfter = statSnapshot(statBigInt(canonicalRootPath));
    if (realRoot.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
      || !sameSnapshot(entryBefore, entryAfter)
      || !sameSnapshot(targetBefore, targetAfter)
      || !sameIdentity(targetAfter, realRoot)) {
      fail('PROJECT_ROOT_SOURCE_CHANGED');
    }
    const identityDigest = physicalRootIdentityDigest(entryAfter, targetAfter);
    if (identityDigest !== request.expectedPhysicalRootIdentityDigest) {
      fail('PROJECT_ROOT_SOURCE_IDENTITY_MISMATCH');
    }
    return Object.freeze({
      canonicalRootPath,
      realRootPath,
      entrySnapshot: entryAfter,
      targetSnapshot: targetAfter,
      identityDigest,
      ownershipKey: `${targetAfter.device}:${targetAfter.inode}`,
    });
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_SOURCE_INVALID');
  }
}

function assertSourceUnchanged(source, request) {
  const current = captureSourceRoot(request);
  if (!sameLocalPath(current.realRootPath, source.realRootPath)
    || !sameSnapshot(current.entrySnapshot, source.entrySnapshot)
    || !sameSnapshot(current.targetSnapshot, source.targetSnapshot)
    || current.identityDigest !== source.identityDigest) {
    fail('PROJECT_ROOT_SOURCE_CHANGED');
  }
}

function ownedDirectoryRecord(location, parentRealPath) {
  try {
    const before = statSnapshot(lstatBigInt(location));
    if (before.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
      fail('PROJECT_ROOT_PRIVATE_STORAGE_INVALID');
    }
    const realPath = fs.realpathSync(location);
    const after = statSnapshot(lstatBigInt(location));
    if (!sameSnapshot(before, after) || !sameLocalPath(location, realPath)
      || (parentRealPath && !isStrictlyInside(parentRealPath, realPath))) {
      fail('PROJECT_ROOT_PRIVATE_STORAGE_INVALID');
    }
    return Object.freeze({ path: location, realPath, identity: after });
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_PRIVATE_STORAGE_INVALID');
  }
}

function assertOwnedDirectory(record, changedCode) {
  try {
    const current = statSnapshot(lstatBigInt(record.path));
    const realPath = fs.realpathSync(record.path);
    if (current.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
      || !sameIdentity(current, record.identity)
      || !sameLocalPath(realPath, record.realPath)) fail(changedCode);
    return current;
  } catch (error) {
    rethrow(error, changedCode);
  }
}

function directoryNames(location, expectedIdentity, changedCode, maximum) {
  let directory;
  const names = [];
  try {
    const before = statSnapshot(lstatBigInt(location));
    if (before.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
      || !sameIdentity(before, expectedIdentity)) fail(changedCode);
    directory = fs.opendirSync(location);
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      if (typeof entry.name !== 'string' || !entry.name
        || entry.name === '.' || entry.name === '..'
        || entry.name.includes('/') || entry.name.includes('\\')) fail(changedCode);
      names.push(entry.name);
      if (names.length > maximum) fail('PROJECT_ROOT_SNAPSHOT_LIMIT_EXCEEDED');
    }
    directory.closeSync();
    directory = null;
    const after = statSnapshot(lstatBigInt(location));
    if (!sameSnapshot(before, after)) fail(changedCode);
  } catch (error) {
    if (directory) {
      try { directory.closeSync(); } catch { /* best effort */ }
    }
    rethrow(error, changedCode);
  }
  names.sort();
  if (names.some((name, index) => index > 0 && name === names[index - 1])) {
    fail(changedCode);
  }
  return Object.freeze({ names: Object.freeze(names), identity: expectedIdentity });
}

function lstatOrNull(location, fallbackCode) {
  try {
    return lstatBigInt(location);
  } catch (error) {
    if (isMissing(error)) return null;
    rethrow(error, fallbackCode);
  }
}

function removeEmptyOwnedDirectory(record, changedCode) {
  const currentStat = lstatOrNull(record.path, changedCode);
  if (!currentStat) return;
  const current = statSnapshot(currentStat);
  if (current.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
    || !sameIdentity(current, record.identity)) fail(changedCode);
  let names;
  try {
    fs.chmodSync(record.path, 0o700);
    names = directoryNames(record.path, current, changedCode, 16).names;
  } catch (error) {
    rethrow(error, changedCode);
  }
  if (names.length !== 0) fail('PROJECT_ROOT_PRIVATE_STORAGE_NOT_EMPTY');
  try {
    const final = statSnapshot(lstatBigInt(record.path));
    if (!sameIdentity(final, record.identity)) fail(changedCode);
    fs.rmdirSync(record.path);
  } catch (error) {
    rethrow(error, changedCode);
  }
}

function openReadNoFollow(location) {
  let flags = fs.constants.O_RDONLY;
  if (typeof fs.constants.O_NOFOLLOW === 'number') flags |= fs.constants.O_NOFOLLOW;
  return fs.openSync(location, flags);
}

function openArchiveExclusive(location) {
  let flags = fs.constants.O_RDWR
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL;
  if (typeof fs.constants.O_NOFOLLOW === 'number') flags |= fs.constants.O_NOFOLLOW;
  return fs.openSync(location, flags, 0o600);
}

function entryIdentityDigest(relativePath, snapshot) {
  return canonicalDigest({
    version: PORTABLE_PROJECT_ROOT_ENTRY_IDENTITY_VERSION,
    relativePath,
    identity: {
      device: snapshot.device,
      inode: snapshot.inode,
      kind: snapshot.kind,
      mode: snapshot.mode,
      size: snapshot.size,
      modifiedNanoseconds: snapshot.modifiedNanoseconds,
      changedNanoseconds: snapshot.changedNanoseconds,
    },
  });
}

function entryMode(snapshot) {
  try {
    return Number(BigInt(snapshot.mode) & 0o7777n);
  } catch {
    fail('PROJECT_ROOT_SOURCE_CHANGED');
  }
}

function entryMtimeMs(snapshot) {
  try {
    const milliseconds = BigInt(snapshot.modifiedNanoseconds) / 1_000_000n;
    const value = Number(milliseconds);
    if (!Number.isFinite(value)) fail('PROJECT_ROOT_SOURCE_CHANGED');
    return Math.max(0, value);
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_SOURCE_CHANGED');
  }
}

function normalizedRelativePath(parentRelativePath, name) {
  const relativePath = parentRelativePath
    ? `${parentRelativePath}/${name}`
    : name;
  if (Buffer.byteLength(relativePath, 'utf8') > MAX_RELATIVE_PATH_BYTES) {
    fail('PROJECT_ROOT_SNAPSHOT_LIMIT_EXCEEDED');
  }
  return relativePath;
}

function baseMetadata(relativePath, snapshot, kind) {
  return {
    relativePath,
    kind,
    mode: entryMode(snapshot),
    mtimeMs: entryMtimeMs(snapshot),
    entryIdentityDigest: entryIdentityDigest(relativePath, snapshot),
  };
}

function incrementSnapshotEntries(snapshotState) {
  snapshotState.totalEntries += 1;
  if (snapshotState.totalEntries > MAX_SNAPSHOT_ENTRIES) {
    fail('PROJECT_ROOT_SNAPSHOT_LIMIT_EXCEEDED');
  }
}

function writeArchiveChunk(storage, buffer, offset, length, position) {
  let written = 0;
  while (written < length) {
    const bytesWritten = fs.writeSync(
      storage.archive.descriptor,
      buffer,
      offset + written,
      length - written,
      position + written
    );
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      fail('PROJECT_ROOT_ARCHIVE_WRITE_FAILED');
    }
    written += bytesWritten;
  }
}

function captureFile(
  sourcePath,
  relativePath,
  beforeSnapshot,
  storage,
  snapshotState
) {
  const size = BigInt(beforeSnapshot.size);
  if (size < 0n) fail('PROJECT_ROOT_SOURCE_CHANGED');
  if (size > BigInt(MAX_ENTRY_INSPECTION_BYTES)) {
    let after;
    try { after = statSnapshot(lstatBigInt(sourcePath)); } catch (error) {
      rethrow(error, 'PROJECT_ROOT_SOURCE_CHANGED');
    }
    if (!sameSnapshot(beforeSnapshot, after)) fail('PROJECT_ROOT_SOURCE_CHANGED');
    return Object.freeze({
      ...baseMetadata(relativePath, after, PROJECT_ROOT_ENTRY_KINDS.OTHER),
      bytes: 0,
      contentDigest: null,
      linkTarget: null,
      archiveOffset: null,
    });
  }
  if (snapshotState.archiveBytes + size > MAX_SNAPSHOT_ARCHIVE_BYTES) {
    fail('PROJECT_ROOT_SNAPSHOT_LIMIT_EXCEEDED');
  }
  let sourceDescriptor;
  const hash = crypto.createHash('sha256');
  const archiveOffset = Number(snapshotState.archiveBytes);
  let copied = 0n;
  try {
    sourceDescriptor = openReadNoFollow(sourcePath);
    const opened = statSnapshot(fstatBigInt(sourceDescriptor));
    if (opened.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
      || !sameSnapshot(beforeSnapshot, opened)) fail('PROJECT_ROOT_SOURCE_CHANGED');
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    for (;;) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      writeArchiveChunk(
        storage,
        buffer,
        0,
        bytesRead,
        archiveOffset + Number(copied)
      );
      copied += BigInt(bytesRead);
      if (copied > size) fail('PROJECT_ROOT_SOURCE_CHANGED');
    }
    if (copied !== size) fail('PROJECT_ROOT_SOURCE_CHANGED');
    const finalHandle = statSnapshot(fstatBigInt(sourceDescriptor));
    const finalPath = statSnapshot(lstatBigInt(sourcePath));
    if (!sameSnapshot(opened, finalHandle) || !sameSnapshot(opened, finalPath)) {
      fail('PROJECT_ROOT_SOURCE_CHANGED');
    }
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_SNAPSHOT_CAPTURE_FAILED');
  } finally {
    if (sourceDescriptor !== undefined) {
      try { fs.closeSync(sourceDescriptor); } catch { /* best effort */ }
    }
  }
  snapshotState.archiveBytes += copied;
  return Object.freeze({
    ...baseMetadata(relativePath, beforeSnapshot, PROJECT_ROOT_ENTRY_KINDS.FILE),
    bytes: Number(size),
    contentDigest: `sha256:${hash.digest('hex')}`,
    linkTarget: null,
    archiveOffset,
  });
}

function captureSymlink(sourcePath, relativePath, beforeSnapshot) {
  let linkTarget;
  let after;
  try {
    linkTarget = fs.readlinkSync(sourcePath);
    after = statSnapshot(lstatBigInt(sourcePath));
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_SOURCE_CHANGED');
  }
  if (!sameSnapshot(beforeSnapshot, after)
    || typeof linkTarget !== 'string' || !linkTarget || linkTarget.includes('\0')
    || Buffer.byteLength(linkTarget, 'utf8') > MAX_LINK_TARGET_BYTES) {
    fail('PROJECT_ROOT_SOURCE_LINK_INVALID');
  }
  const bytes = Buffer.from(linkTarget, 'utf8');
  return Object.freeze({
    ...baseMetadata(relativePath, after, PROJECT_ROOT_ENTRY_KINDS.SYMLINK),
    bytes: bytes.length,
    contentDigest: bytesDigest(bytes),
    linkTarget,
    archiveOffset: null,
  });
}

function captureOther(relativePath, beforeSnapshot) {
  return Object.freeze({
    ...baseMetadata(relativePath, beforeSnapshot, PROJECT_ROOT_ENTRY_KINDS.OTHER),
    bytes: 0,
    contentDigest: null,
    linkTarget: null,
    archiveOffset: null,
  });
}

function captureEntry(
  sourceRootPath,
  sourcePath,
  relativePath,
  storage,
  snapshotState
) {
  incrementSnapshotEntries(snapshotState);
  let beforeSnapshot;
  try {
    beforeSnapshot = statSnapshot(lstatBigInt(sourcePath));
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_SOURCE_CHANGED');
  }
  if (beforeSnapshot.kind === PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
    return captureDirectory(
      sourceRootPath,
      sourcePath,
      relativePath,
      beforeSnapshot,
      storage,
      snapshotState
    );
  }
  if (beforeSnapshot.kind === PROJECT_ROOT_ENTRY_KINDS.FILE) {
    return captureFile(
      sourcePath,
      relativePath,
      beforeSnapshot,
      storage,
      snapshotState
    );
  }
  if (beforeSnapshot.kind === PROJECT_ROOT_ENTRY_KINDS.SYMLINK) {
    return captureSymlink(sourcePath, relativePath, beforeSnapshot);
  }
  let after;
  try { after = statSnapshot(lstatBigInt(sourcePath)); } catch (error) {
    rethrow(error, 'PROJECT_ROOT_SOURCE_CHANGED');
  }
  if (!sameSnapshot(beforeSnapshot, after)) fail('PROJECT_ROOT_SOURCE_CHANGED');
  return captureOther(relativePath, after);
}

function captureDirectory(
  sourceRootPath,
  sourceDirectory,
  relativePath,
  expectedIdentity,
  storage,
  snapshotState
) {
  let current;
  try { current = statSnapshot(lstatBigInt(sourceDirectory)); } catch (error) {
    rethrow(error, 'PROJECT_ROOT_SOURCE_CHANGED');
  }
  if (current.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY
    || !sameSnapshot(current, expectedIdentity)) fail('PROJECT_ROOT_SOURCE_CHANGED');
  const initial = directoryNames(
    sourceDirectory,
    current,
    'PROJECT_ROOT_SOURCE_CHANGED',
    MAX_SNAPSHOT_ENTRIES
  );
  const metadata = Object.freeze({
    ...baseMetadata(relativePath, current, PROJECT_ROOT_ENTRY_KINDS.DIRECTORY),
    bytes: 0,
    contentDigest: null,
    linkTarget: null,
    archiveOffset: null,
  });
  snapshotState.entries.set(relativePath, metadata);
  const childEntries = [];
  for (const name of initial.names) {
    const childPath = path.join(sourceDirectory, name);
    if (!isStrictlyInside(sourceRootPath, childPath)) {
      fail('PROJECT_ROOT_SOURCE_CHANGED');
    }
    const childRelativePath = normalizedRelativePath(relativePath, name);
    const child = captureEntry(
      sourceRootPath,
      childPath,
      childRelativePath,
      storage,
      snapshotState
    );
    snapshotState.entries.set(childRelativePath, child);
    childEntries.push(Object.freeze({ name, kind: child.kind }));
  }
  const final = directoryNames(
    sourceDirectory,
    current,
    'PROJECT_ROOT_SOURCE_CHANGED',
    MAX_SNAPSHOT_ENTRIES
  );
  if (!sameSnapshot(initial.identity, final.identity)
    || initial.names.length !== final.names.length
    || initial.names.some((name, index) => name !== final.names[index])) {
    fail('PROJECT_ROOT_SOURCE_CHANGED');
  }
  snapshotState.directories.set(relativePath, Object.freeze(childEntries));
  return metadata;
}

function createSnapshot(source, request, storage) {
  const snapshotState = {
    archiveBytes: 0n,
    directories: new Map(),
    entries: new Map(),
    totalEntries: 1,
  };
  captureDirectory(
    source.realRootPath,
    source.realRootPath,
    '',
    source.targetSnapshot,
    storage,
    snapshotState
  );
  assertSourceUnchanged(source, request);
  try {
    fs.fsyncSync(storage.archive.descriptor);
    const handleIdentity = statSnapshot(fstatBigInt(storage.archive.descriptor));
    const pathIdentity = statSnapshot(lstatBigInt(storage.archive.path));
    if (handleIdentity.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
      || !sameSnapshot(handleIdentity, pathIdentity)
      || BigInt(handleIdentity.size) !== snapshotState.archiveBytes) {
      fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
    }
    storage.archive.identity = handleIdentity;
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_ARCHIVE_WRITE_FAILED');
  }
  return Object.freeze({
    archiveBytes: Number(snapshotState.archiveBytes),
    directories: snapshotState.directories,
    entries: snapshotState.entries,
    totalEntries: snapshotState.totalEntries,
  });
}

function createLeaseStorage(sessionRoot) {
  let directory = null;
  let directoryPath = null;
  let archivePath = null;
  let archiveDescriptor;
  let archiveIdentity = null;
  try {
    assertOwnedDirectory(sessionRoot, 'PROJECT_ROOT_SESSION_IDENTITY_CHANGED');
    directoryPath = fs.mkdtempSync(path.join(sessionRoot.path, LEASE_DIRECTORY_PREFIX));
    const initialDirectoryIdentity = statSnapshot(lstatBigInt(directoryPath));
    if (initialDirectoryIdentity.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
      fail('PROJECT_ROOT_PRIVATE_STORAGE_INVALID');
    }
    fs.chmodSync(directoryPath, 0o700);
    directory = ownedDirectoryRecord(directoryPath, sessionRoot.realPath);
    archivePath = path.join(directory.path, SNAPSHOT_ARCHIVE_NAME);
    archiveDescriptor = openArchiveExclusive(archivePath);
    archiveIdentity = statSnapshot(fstatBigInt(archiveDescriptor));
    const pathIdentity = statSnapshot(lstatBigInt(archivePath));
    if (archiveIdentity.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
      || !sameSnapshot(archiveIdentity, pathIdentity)) {
      fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
    }
    return {
      archive: {
        descriptor: archiveDescriptor,
        identity: archiveIdentity,
        path: archivePath,
      },
      directory,
    };
  } catch (error) {
    if (archiveDescriptor !== undefined) {
      try { fs.closeSync(archiveDescriptor); } catch { /* best effort */ }
    }
    if (archivePath && archiveIdentity) {
      try {
        const current = statSnapshot(lstatBigInt(archivePath));
        if (sameIdentity(current, archiveIdentity)) fs.unlinkSync(archivePath);
      } catch { /* refuse an ambiguous cleanup */ }
    }
    if (directory) {
      try { removeEmptyOwnedDirectory(directory, 'PROJECT_ROOT_PRIVATE_STORAGE_CHANGED'); } catch {
        /* refuse an ambiguous cleanup */
      }
    } else if (directoryPath) {
      try {
        const current = statSnapshot(lstatBigInt(directoryPath));
        if (current.kind === PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
          removeEmptyOwnedDirectory(
            Object.freeze({
              path: directoryPath,
              realPath: fs.realpathSync(directoryPath),
              identity: current,
            }),
            'PROJECT_ROOT_PRIVATE_STORAGE_CHANGED'
          );
        }
      } catch { /* refuse an ambiguous cleanup */ }
    }
    rethrow(error, 'PROJECT_ROOT_PRIVATE_STORAGE_INVALID');
  }
}

function assertArchiveHandle(record) {
  if (!record.storage.archive
    || record.storage.archive.descriptor === undefined
    || record.storage.archive.descriptor === null) {
    fail('PROJECT_ROOT_LEASE_CLOSED');
  }
  try {
    const current = statSnapshot(fstatBigInt(record.storage.archive.descriptor));
    if (!sameSnapshot(current, record.storage.archive.identity)) {
      fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
    }
    return current;
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
  }
}

function readSnapshotBytes(record, offset, length) {
  assertArchiveHandle(record);
  const output = Buffer.alloc(length);
  let read = 0;
  try {
    while (read < length) {
      const bytesRead = fs.readSync(
        record.storage.archive.descriptor,
        output,
        read,
        length - read,
        offset + read
      );
      if (bytesRead <= 0) fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
      read += bytesRead;
    }
    assertArchiveHandle(record);
  } catch (error) {
    rethrow(error, 'PROJECT_ROOT_ARCHIVE_READ_FAILED');
  }
  return output;
}

function missingReadResult() {
  return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
}

function missingInspectionResult() {
  return Object.freeze({
    found: false,
    kind: null,
    bytes: null,
    mode: null,
    mtimeMs: null,
    contentDigest: null,
    linkTarget: null,
    entryIdentityDigest: null,
  });
}

function assertRecordActive(record) {
  if (record.state !== 'active') fail('PROJECT_ROOT_LEASE_CLOSED');
  assertArchiveHandle(record);
}

function createReader(record) {
  return Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    inspectEntry(input) {
      assertRecordActive(record);
      let request;
      try { request = createProjectRootEntryInspectionRequest(input); } catch (error) {
        rethrow(error, 'PROJECT_ROOT_INSPECTION_REQUEST_INVALID');
      }
      const metadata = record.snapshot.entries.get(request.relativePath);
      if (!metadata) return missingInspectionResult();
      const result = {
        found: true,
        kind: metadata.kind,
        bytes: metadata.bytes,
        mode: metadata.mode,
        mtimeMs: metadata.mtimeMs,
        contentDigest: metadata.contentDigest,
        linkTarget: metadata.linkTarget,
        entryIdentityDigest: metadata.entryIdentityDigest,
      };
      try {
        return assertProjectRootEntryInspectionResult(
          Object.freeze(result),
          request
        );
      } catch (error) {
        rethrow(error, 'PROJECT_ROOT_SNAPSHOT_INVALID');
      }
    },
    list(input) {
      assertRecordActive(record);
      let request;
      try { request = createProjectRootListRequest(input); } catch (error) {
        rethrow(error, 'PROJECT_ROOT_LIST_REQUEST_INVALID');
      }
      const available = record.snapshot.directories.get(request.relativePath)
        || Object.freeze([]);
      const entries = available.slice(0, request.maxEntries);
      const result = Object.freeze({
        entries,
        truncated: available.length > request.maxEntries,
      });
      try { return assertProjectRootListResult(result, request); } catch (error) {
        rethrow(error, 'PROJECT_ROOT_SNAPSHOT_INVALID');
      }
    },
    readFile(input) {
      assertRecordActive(record);
      let request;
      try { request = createProjectRootReadFileRequest(input); } catch (error) {
        rethrow(error, 'PROJECT_ROOT_READ_REQUEST_INVALID');
      }
      const metadata = record.snapshot.entries.get(request.relativePath);
      if (!metadata || metadata.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE) {
        return missingReadResult();
      }
      const length = Math.min(metadata.bytes, request.maxBytes);
      const bytes = readSnapshotBytes(record, metadata.archiveOffset, length);
      const result = Object.freeze({
        found: true,
        contentBase64: bytes.toString('base64'),
        contentDigest: bytesDigest(bytes),
      });
      try { return assertProjectRootReadFileResult(result, request); } catch (error) {
        rethrow(error, 'PROJECT_ROOT_SNAPSHOT_INVALID');
      }
    },
  });
}

function createLease(record, closeRecord) {
  const reader = createReader(record);
  const lease = Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
    leaseId: record.request.leaseId,
    jobId: record.request.binding.jobId,
    projectId: record.request.binding.projectId,
    purpose: record.request.purpose,
    physicalRootIdentityDigest: record.request.expectedPhysicalRootIdentityDigest,
    authorityDigest: record.request.authorityDigest,
    reader,
    close() {
      return closeRecord(record);
    },
  });
  try { return assertProjectRootAuthorityLease(lease, record.request); } catch (error) {
    rethrow(error, 'PROJECT_ROOT_LEASE_INVALID');
  }
}

function createPortableProjectRootAuthorityBackend(options = {}) {
  normalizeOptions(options);
  let state = 'idle';
  let sessionRoot = null;
  let disposeReceipt = null;
  const recordsByLeaseId = new Map();
  const ownersBySourceIdentity = new Map();

  function unavailable(reasonCode) {
    return createProjectRootAuthorityProbeResult({
      state: PROJECT_ROOT_AUTHORITY_STATES.UNAVAILABLE,
      guarantees: [],
      reasonCode,
    });
  }

  function createSessionRoot() {
    let createdPath = null;
    let createdIdentity = null;
    try {
      const temporaryRoot = fs.realpathSync(os.tmpdir());
      if (!path.isAbsolute(temporaryRoot)
        || sameLocalPath(temporaryRoot, path.parse(temporaryRoot).root)) {
        fail('PROJECT_ROOT_PRIVATE_STORAGE_UNAVAILABLE');
      }
      createdPath = fs.mkdtempSync(path.join(temporaryRoot, SESSION_DIRECTORY_PREFIX));
      createdIdentity = statSnapshot(lstatBigInt(createdPath));
      if (createdIdentity.kind !== PROJECT_ROOT_ENTRY_KINDS.DIRECTORY) {
        fail('PROJECT_ROOT_PRIVATE_STORAGE_UNAVAILABLE');
      }
      fs.chmodSync(createdPath, 0o700);
      sessionRoot = ownedDirectoryRecord(createdPath, temporaryRoot);
      state = 'ready';
    } catch (error) {
      if (createdPath && createdIdentity) {
        try {
          removeEmptyOwnedDirectory(
            Object.freeze({
              path: createdPath,
              realPath: createdPath,
              identity: createdIdentity,
            }),
            'PROJECT_ROOT_PRIVATE_STORAGE_CHANGED'
          );
        } catch { /* refuse an ambiguous cleanup */ }
      }
      sessionRoot = null;
      state = 'unavailable';
      rethrow(error, 'PROJECT_ROOT_PRIVATE_STORAGE_UNAVAILABLE');
    }
  }

  function assertSessionRoot() {
    if (!sessionRoot || state !== 'ready') fail('PROJECT_ROOT_BACKEND_UNAVAILABLE');
    try {
      assertOwnedDirectory(sessionRoot, 'PROJECT_ROOT_SESSION_IDENTITY_CHANGED');
    } catch (error) {
      state = 'quarantined';
      rethrow(error, 'PROJECT_ROOT_SESSION_IDENTITY_CHANGED');
    }
  }

  function releaseRecord(record) {
    recordsByLeaseId.delete(record.request.leaseId);
    if (ownersBySourceIdentity.get(record.source.ownershipKey) === record) {
      ownersBySourceIdentity.delete(record.source.ownershipKey);
    }
  }

  function cleanupStorage(storage, {
    acceptIncompleteArchive = false,
    allowMissing = false,
  } = {}) {
    const archive = storage.archive;
    if (archive.descriptor !== undefined && archive.descriptor !== null) {
      try {
        const handleIdentity = statSnapshot(fstatBigInt(archive.descriptor));
        if (handleIdentity.kind !== PROJECT_ROOT_ENTRY_KINDS.FILE
          || !sameIdentity(handleIdentity, archive.identity)
          || (!acceptIncompleteArchive
            && !sameSnapshot(handleIdentity, archive.identity))) {
          fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
        }
        const pathStat = lstatOrNull(
          archive.path,
          'PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED'
        );
        if (!pathStat) {
          if (!allowMissing) fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
        } else {
          const pathIdentity = statSnapshot(pathStat);
          if (!sameSnapshot(handleIdentity, pathIdentity)) {
            fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
          }
        }
        archive.identity = handleIdentity;
        fs.closeSync(archive.descriptor);
        archive.descriptor = null;
      } catch (error) {
        rethrow(error, 'PROJECT_ROOT_ARCHIVE_CLOSE_FAILED');
      }
    }
    const archivePathStat = lstatOrNull(
      archive.path,
      'PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED'
    );
    if (!archivePathStat) {
      if (!allowMissing) fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
    } else {
      const current = statSnapshot(archivePathStat);
      if (!sameSnapshot(current, archive.identity)) {
        fail('PROJECT_ROOT_ARCHIVE_IDENTITY_CHANGED');
      }
      try { fs.unlinkSync(archive.path); } catch (error) {
        rethrow(error, 'PROJECT_ROOT_ARCHIVE_CLOSE_FAILED');
      }
    }
    removeEmptyOwnedDirectory(
      storage.directory,
      'PROJECT_ROOT_PRIVATE_STORAGE_CHANGED'
    );
  }

  function closeRecord(record) {
    if (record.closeReceipt) return record.closeReceipt;
    if (!['active', 'quarantined'].includes(record.state)) {
      fail('PROJECT_ROOT_LEASE_CLOSED');
    }
    record.state = 'closing';
    try {
      cleanupStorage(record.storage);
      releaseRecord(record);
      record.closeReceipt = createProjectRootAuthorityCloseReceipt({
        request: record.request,
        closed: true,
      });
      record.state = 'closed';
      return record.closeReceipt;
    } catch (error) {
      record.state = 'quarantined';
      state = 'quarantined';
      rethrow(error, 'PROJECT_ROOT_CLOSE_FAILED');
    }
  }

  function probe(input) {
    void input;
    if (state === 'disposed') return unavailable('PROJECT_ROOT_BACKEND_DISPOSED');
    if (state === 'quarantined') return unavailable('PROJECT_ROOT_BACKEND_UNHEALTHY');
    if (state === 'unavailable') return unavailable('PROJECT_ROOT_PRIVATE_STORAGE_UNAVAILABLE');
    if (state === 'idle') {
      try { createSessionRoot(); } catch {
        return unavailable('PROJECT_ROOT_PRIVATE_STORAGE_UNAVAILABLE');
      }
    }
    try { assertSessionRoot(); } catch {
      return unavailable('PROJECT_ROOT_BACKEND_UNHEALTHY');
    }
    return createProjectRootAuthorityProbeResult({
      state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
      guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
    });
  }

  function acquire(value) {
    if (state !== 'ready') fail('PROJECT_ROOT_BACKEND_UNAVAILABLE');
    let request;
    try { request = assertProjectRootAuthorityAcquireRequest(value); } catch (error) {
      rethrow(error, 'PROJECT_ROOT_ACQUIRE_REQUEST_INVALID');
    }
    if (recordsByLeaseId.has(request.leaseId)) {
      fail('PROJECT_ROOT_LEASE_ALREADY_ACTIVE');
    }
    assertSessionRoot();
    const source = captureSourceRoot(request);
    if (ownersBySourceIdentity.has(source.ownershipKey)
      || [...recordsByLeaseId.values()].some((record) => (
        isInsideOrEqual(record.source.realRootPath, source.realRootPath)
          || isInsideOrEqual(source.realRootPath, record.source.realRootPath)
      ))) {
      fail('PROJECT_ROOT_SOURCE_ALREADY_ACTIVE');
    }
    let storage = null;
    try {
      storage = createLeaseStorage(sessionRoot);
      const snapshot = createSnapshot(source, request, storage);
      const record = {
        closeReceipt: null,
        lease: null,
        request,
        snapshot,
        source,
        state: 'active',
        storage,
      };
      record.lease = createLease(record, closeRecord);
      recordsByLeaseId.set(request.leaseId, record);
      ownersBySourceIdentity.set(source.ownershipKey, record);
      return record.lease;
    } catch (error) {
      if (storage) {
        try {
          cleanupStorage(storage, {
            acceptIncompleteArchive: true,
            allowMissing: true,
          });
        } catch {
          state = 'quarantined';
          fail('PROJECT_ROOT_ACQUIRE_CLEANUP_FAILED');
        }
      }
      rethrow(error, 'PROJECT_ROOT_ACQUIRE_FAILED');
    }
  }

  function removeSessionRoot() {
    if (!sessionRoot) return;
    removeEmptyOwnedDirectory(
      sessionRoot,
      'PROJECT_ROOT_SESSION_IDENTITY_CHANGED'
    );
    sessionRoot = null;
  }

  function dispose(input) {
    void input;
    if (disposeReceipt) return disposeReceipt;
    try {
      for (const record of [...recordsByLeaseId.values()]) closeRecord(record);
      removeSessionRoot();
      state = 'disposed';
      disposeReceipt = Object.freeze({ ok: true, disposed: true });
      return disposeReceipt;
    } catch (error) {
      state = 'quarantined';
      rethrow(error, 'PROJECT_ROOT_DISPOSE_FAILED');
    }
  }

  return Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID,
    probe,
    acquire,
    dispose,
  });
}

module.exports = {
  PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_ID,
  PORTABLE_PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PortableProjectRootAuthorityBackendError,
  createPortableProjectRootAuthorityBackend,
};
