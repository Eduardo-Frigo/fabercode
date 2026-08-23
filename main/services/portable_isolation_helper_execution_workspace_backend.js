'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  assertExecutionWorkspaceAcquireRequest,
  assertExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceLease,
  createExecutionWorkspaceProbeResult,
} = require('../capabilities/execution_workspace_contract');
const {
  createProjectRootPhysicalIdentityDigest,
} = require('../capabilities/project_root_authority_contract');

const PORTABLE_EXECUTION_WORKSPACE_BACKEND_VERSION =
  'portable-execution-workspace-backend.v1';
const PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID =
  'portable-physical-execution-workspace';
const SESSION_DIRECTORY_PREFIX = 'faber-portable-workspaces-';
const WORKSPACE_DIRECTORY_PREFIX = 'workspace-';
const COPY_BUFFER_BYTES = 64 * 1024;
const MAX_SOURCE_ENTRIES = 2_000_000;
const MAX_SOURCE_BYTES = 128n * 1024n * 1024n * 1024n;
const MAX_LINK_BYTES = 4096;
const MAX_LINK_HOPS = 128;

class PortableExecutionWorkspaceBackendError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PortableExecutionWorkspaceBackendError';
    this.code = code;
  }
}

function fail(code) {
  throw new PortableExecutionWorkspaceBackendError(code);
}

function rethrow(error, fallbackCode) {
  if (error instanceof PortableExecutionWorkspaceBackendError) throw error;
  fail(fallbackCode);
}

function normalizeOptions(value) {
  const code = 'WORKSPACE_BACKEND_OPTIONS_INVALID';
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
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isDirectory()) return 'directory';
    if (stat.isFile()) return 'file';
    return 'other';
  } catch {
    return 'unknown';
  }
}

function statSnapshot(stat) {
  if (!stat || typeof stat !== 'object') fail('WORKSPACE_PHYSICAL_IDENTITY_INVALID');
  let kind;
  try {
    kind = statKind(stat);
    return Object.freeze({
      kind,
      device: String(stat.dev),
      inode: String(stat.ino),
      mode: String(stat.mode),
      size: String(stat.size),
      modifiedNanoseconds: String(stat.mtimeNs),
      changedNanoseconds: String(stat.ctimeNs),
    });
  } catch {
    fail('WORKSPACE_PHYSICAL_IDENTITY_INVALID');
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

function physicalIdentityDigest(entrySnapshot, targetSnapshot) {
  if (!['directory', 'symlink'].includes(entrySnapshot.kind)
    || targetSnapshot.kind !== 'directory') {
    fail('WORKSPACE_PHYSICAL_IDENTITY_INVALID');
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
    rethrow(error, 'WORKSPACE_PHYSICAL_IDENTITY_INVALID');
  }
}

function captureSourceRoot(request) {
  const canonicalRootPath = request.binding.canonicalRootPath;
  const boundRealRootPath = request.binding.realRootPath;
  if (!path.isAbsolute(canonicalRootPath) || !path.isAbsolute(boundRealRootPath)
    || sameLocalPath(canonicalRootPath, path.parse(canonicalRootPath).root)
    || sameLocalPath(boundRealRootPath, path.parse(boundRealRootPath).root)) {
    fail('WORKSPACE_SOURCE_ROOT_INVALID');
  }
  try {
    const entryBefore = statSnapshot(lstatBigInt(canonicalRootPath));
    const targetBefore = statSnapshot(statBigInt(canonicalRootPath));
    if (!['directory', 'symlink'].includes(entryBefore.kind)
      || targetBefore.kind !== 'directory') fail('WORKSPACE_SOURCE_ROOT_INVALID');
    const realRootPath = fs.realpathSync(canonicalRootPath);
    const boundPhysicalPath = fs.realpathSync(boundRealRootPath);
    if (!sameLocalPath(realRootPath, boundPhysicalPath)
      || sameLocalPath(realRootPath, path.parse(realRootPath).root)) {
      fail('WORKSPACE_SOURCE_BINDING_MISMATCH');
    }
    const realRoot = statSnapshot(lstatBigInt(realRootPath));
    const entryAfter = statSnapshot(lstatBigInt(canonicalRootPath));
    const targetAfter = statSnapshot(statBigInt(canonicalRootPath));
    if (realRoot.kind !== 'directory'
      || !sameSnapshot(entryBefore, entryAfter)
      || !sameSnapshot(targetBefore, targetAfter)
      || !sameIdentity(targetAfter, realRoot)) {
      fail('WORKSPACE_SOURCE_CHANGED');
    }
    const identityDigest = physicalIdentityDigest(entryAfter, targetAfter);
    if (identityDigest !== request.sourceRootIdentityDigest) {
      fail('WORKSPACE_SOURCE_IDENTITY_MISMATCH');
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
    rethrow(error, 'WORKSPACE_SOURCE_ROOT_INVALID');
  }
}

function assertSourceUnchanged(source, request) {
  const current = captureSourceRoot(request);
  if (!sameLocalPath(current.realRootPath, source.realRootPath)
    || !sameSnapshot(current.entrySnapshot, source.entrySnapshot)
    || !sameSnapshot(current.targetSnapshot, source.targetSnapshot)
    || current.identityDigest !== source.identityDigest) {
    fail('WORKSPACE_SOURCE_CHANGED');
  }
}

function ownedDirectoryRecord(location, parentRealPath) {
  try {
    const before = statSnapshot(lstatBigInt(location));
    if (before.kind !== 'directory') fail('WORKSPACE_PHYSICAL_IDENTITY_INVALID');
    const realPath = fs.realpathSync(location);
    const after = statSnapshot(lstatBigInt(location));
    if (!sameSnapshot(before, after) || !sameLocalPath(location, realPath)
      || (parentRealPath && !isStrictlyInside(parentRealPath, realPath))) {
      fail('WORKSPACE_PHYSICAL_IDENTITY_INVALID');
    }
    return Object.freeze({
      path: location,
      realPath,
      identity: after,
      identityDigest: physicalIdentityDigest(after, after),
    });
  } catch (error) {
    rethrow(error, 'WORKSPACE_PHYSICAL_IDENTITY_INVALID');
  }
}

function assertOwnedDirectory(record, changedCode) {
  let current;
  try {
    current = statSnapshot(lstatBigInt(record.path));
    const realPath = fs.realpathSync(record.path);
    if (current.kind !== 'directory'
      || !sameIdentity(current, record.identity)
      || !sameLocalPath(realPath, record.realPath)) fail(changedCode);
  } catch (error) {
    rethrow(error, changedCode);
  }
  return current;
}

function directoryNames(location, expectedIdentity, changedCode) {
  let directory;
  const names = [];
  try {
    const before = statSnapshot(lstatBigInt(location));
    if (before.kind !== 'directory' || !sameIdentity(before, expectedIdentity)) {
      fail(changedCode);
    }
    directory = fs.opendirSync(location);
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      if (typeof entry.name !== 'string' || !entry.name
        || entry.name === '.' || entry.name === '..'
        || entry.name.includes('/') || entry.name.includes('\\')) fail(changedCode);
      names.push(entry.name);
      if (names.length > MAX_SOURCE_ENTRIES) fail('WORKSPACE_SOURCE_LIMIT_EXCEEDED');
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

function sourceDirectorySnapshot(location) {
  let identity;
  try {
    identity = statSnapshot(lstatBigInt(location));
  } catch (error) {
    rethrow(error, 'WORKSPACE_SOURCE_CHANGED');
  }
  if (identity.kind !== 'directory') fail('WORKSPACE_SOURCE_CHANGED');
  return directoryNames(location, identity, 'WORKSPACE_SOURCE_CHANGED');
}

function incrementEntryCount(copyState) {
  copyState.entries += 1;
  if (copyState.entries > MAX_SOURCE_ENTRIES) {
    fail('WORKSPACE_SOURCE_LIMIT_EXCEEDED');
  }
}

function sourceMode(stat, fallback) {
  try {
    return Number(stat.mode & 0o777n) | fallback;
  } catch {
    fail('WORKSPACE_SOURCE_CHANGED');
  }
}

function openReadNoFollow(location) {
  let flags = fs.constants.O_RDONLY;
  if (typeof fs.constants.O_NOFOLLOW === 'number') flags |= fs.constants.O_NOFOLLOW;
  return fs.openSync(location, flags);
}

function copyRegularFile(sourcePath, targetPath, beforeStat, beforeSnapshot, copyState) {
  let sourceDescriptor;
  let targetDescriptor;
  let targetCreated = false;
  try {
    const sourceSize = BigInt(beforeSnapshot.size);
    if (sourceSize < 0n || copyState.bytes + sourceSize > MAX_SOURCE_BYTES) {
      fail('WORKSPACE_SOURCE_LIMIT_EXCEEDED');
    }
    sourceDescriptor = openReadNoFollow(sourcePath);
    const openedSource = statSnapshot(fstatBigInt(sourceDescriptor));
    if (openedSource.kind !== 'file' || !sameSnapshot(beforeSnapshot, openedSource)) {
      fail('WORKSPACE_SOURCE_CHANGED');
    }
    let targetFlags = fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL;
    if (typeof fs.constants.O_NOFOLLOW === 'number') targetFlags |= fs.constants.O_NOFOLLOW;
    targetDescriptor = fs.openSync(targetPath, targetFlags, 0o600);
    targetCreated = true;
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let copied = 0n;
    for (;;) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      let offset = 0;
      while (offset < bytesRead) {
        const bytesWritten = fs.writeSync(
          targetDescriptor,
          buffer,
          offset,
          bytesRead - offset,
          null
        );
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
          fail('WORKSPACE_COPY_FAILED');
        }
        offset += bytesWritten;
      }
      copied += BigInt(bytesRead);
      if (copied > sourceSize) fail('WORKSPACE_SOURCE_CHANGED');
    }
    if (copied !== sourceSize) fail('WORKSPACE_SOURCE_CHANGED');
    const finalSource = statSnapshot(fstatBigInt(sourceDescriptor));
    const finalPath = statSnapshot(lstatBigInt(sourcePath));
    if (!sameSnapshot(openedSource, finalSource)
      || !sameSnapshot(openedSource, finalPath)) fail('WORKSPACE_SOURCE_CHANGED');
    fs.fchmodSync(targetDescriptor, sourceMode(beforeStat, 0o600) & 0o777);
    fs.fsyncSync(targetDescriptor);
    const targetStat = statSnapshot(fstatBigInt(targetDescriptor));
    if (targetStat.kind !== 'file' || BigInt(targetStat.size) !== copied) {
      fail('WORKSPACE_COPY_FAILED');
    }
    copyState.bytes += copied;
  } catch (error) {
    rethrow(error, 'WORKSPACE_COPY_FAILED');
  } finally {
    if (sourceDescriptor !== undefined) {
      try { fs.closeSync(sourceDescriptor); } catch { /* best effort */ }
    }
    if (targetDescriptor !== undefined) {
      try { fs.closeSync(targetDescriptor); } catch { /* best effort */ }
    }
    if (targetCreated && targetDescriptor !== undefined) {
      try {
        const targetStat = lstatBigInt(targetPath);
        if (!targetStat.isFile()) fs.unlinkSync(targetPath);
      } catch { /* acquisition cleanup owns the complete workspace */ }
    }
  }
}

function relativeComponents(rootPath, candidatePath) {
  if (sameLocalPath(rootPath, candidatePath)) return [];
  const relative = path.relative(rootPath, candidatePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) fail('WORKSPACE_SOURCE_LINK_ESCAPE');
  return relative.split(path.sep);
}

function resolveContainedSourceLink(sourceRootPath, linkPath, linkTarget) {
  const initial = path.isAbsolute(linkTarget)
    ? path.resolve(linkTarget)
    : path.resolve(path.dirname(linkPath), linkTarget);
  if (!isInsideOrEqual(sourceRootPath, initial)) {
    fail('WORKSPACE_SOURCE_LINK_ESCAPE');
  }
  let pending = relativeComponents(sourceRootPath, initial);
  let resolved = [];
  let hops = 0;
  while (pending.length > 0) {
    const component = pending.shift();
    const current = path.join(sourceRootPath, ...resolved, component);
    let currentStat;
    try {
      currentStat = statSnapshot(lstatBigInt(current));
    } catch (error) {
      rethrow(error, 'WORKSPACE_SOURCE_LINK_INVALID');
    }
    if (currentStat.kind !== 'symlink') {
      if (pending.length > 0 && currentStat.kind !== 'directory') {
        fail('WORKSPACE_SOURCE_LINK_INVALID');
      }
      resolved.push(component);
      continue;
    }
    hops += 1;
    if (hops > MAX_LINK_HOPS) fail('WORKSPACE_SOURCE_LINK_INVALID');
    let nestedTarget;
    try {
      nestedTarget = fs.readlinkSync(current);
    } catch (error) {
      rethrow(error, 'WORKSPACE_SOURCE_LINK_INVALID');
    }
    if (typeof nestedTarget !== 'string' || nestedTarget.includes('\0')
      || Buffer.byteLength(nestedTarget, 'utf8') > MAX_LINK_BYTES) {
      fail('WORKSPACE_SOURCE_LINK_INVALID');
    }
    const nestedAbsolute = path.isAbsolute(nestedTarget)
      ? path.resolve(nestedTarget)
      : path.resolve(path.dirname(current), nestedTarget);
    if (!isInsideOrEqual(sourceRootPath, nestedAbsolute)) {
      fail('WORKSPACE_SOURCE_LINK_ESCAPE');
    }
    pending = [
      ...relativeComponents(sourceRootPath, nestedAbsolute),
      ...pending,
    ];
    resolved = [];
  }
  const output = path.join(sourceRootPath, ...resolved);
  let outputStat;
  try {
    outputStat = statSnapshot(lstatBigInt(output));
  } catch (error) {
    rethrow(error, 'WORKSPACE_SOURCE_LINK_INVALID');
  }
  if (!['directory', 'file'].includes(outputStat.kind)) {
    fail('WORKSPACE_SOURCE_LINK_INVALID');
  }
  return Object.freeze({ path: output, kind: outputStat.kind });
}

function copySymbolicLink(
  sourceRootPath,
  workspaceRootPath,
  sourcePath,
  targetPath,
  beforeSnapshot
) {
  let linkTarget;
  try {
    linkTarget = fs.readlinkSync(sourcePath);
  } catch (error) {
    rethrow(error, 'WORKSPACE_SOURCE_CHANGED');
  }
  if (typeof linkTarget !== 'string' || linkTarget.includes('\0')
    || Buffer.byteLength(linkTarget, 'utf8') > MAX_LINK_BYTES) {
    fail('WORKSPACE_SOURCE_LINK_INVALID');
  }
  const resolved = resolveContainedSourceLink(sourceRootPath, sourcePath, linkTarget);
  let afterSnapshot;
  let finalTarget;
  try {
    afterSnapshot = statSnapshot(lstatBigInt(sourcePath));
    finalTarget = fs.readlinkSync(sourcePath);
  } catch (error) {
    rethrow(error, 'WORKSPACE_SOURCE_CHANGED');
  }
  if (!sameSnapshot(beforeSnapshot, afterSnapshot) || finalTarget !== linkTarget) {
    fail('WORKSPACE_SOURCE_CHANGED');
  }
  const targetRelative = path.relative(sourceRootPath, resolved.path);
  const workspaceTarget = path.join(workspaceRootPath, targetRelative);
  if (!isInsideOrEqual(workspaceRootPath, workspaceTarget)) {
    fail('WORKSPACE_SOURCE_LINK_ESCAPE');
  }
  const safeLinkTarget = path.relative(path.dirname(targetPath), workspaceTarget) || '.';
  try {
    fs.symlinkSync(safeLinkTarget, targetPath, resolved.kind === 'directory' ? 'dir' : 'file');
    if (!lstatBigInt(targetPath).isSymbolicLink()) fail('WORKSPACE_COPY_FAILED');
  } catch (error) {
    rethrow(error, 'WORKSPACE_COPY_FAILED');
  }
}

function copyEntry(sourceRootPath, workspaceRootPath, sourcePath, targetPath, copyState) {
  incrementEntryCount(copyState);
  let beforeStat;
  let beforeSnapshot;
  try {
    beforeStat = lstatBigInt(sourcePath);
    beforeSnapshot = statSnapshot(beforeStat);
  } catch (error) {
    rethrow(error, 'WORKSPACE_SOURCE_CHANGED');
  }
  if (beforeSnapshot.kind === 'directory') {
    try {
      fs.mkdirSync(targetPath, { mode: 0o700 });
    } catch (error) {
      rethrow(error, 'WORKSPACE_COPY_FAILED');
    }
    copyDirectoryContents(
      sourceRootPath,
      workspaceRootPath,
      sourcePath,
      targetPath,
      copyState
    );
    let afterSnapshot;
    try {
      afterSnapshot = statSnapshot(lstatBigInt(sourcePath));
      fs.chmodSync(targetPath, sourceMode(beforeStat, 0o700) & 0o777);
    } catch (error) {
      rethrow(error, 'WORKSPACE_SOURCE_CHANGED');
    }
    if (!sameSnapshot(beforeSnapshot, afterSnapshot)) {
      fail('WORKSPACE_SOURCE_CHANGED');
    }
    return;
  }
  if (beforeSnapshot.kind === 'file') {
    copyRegularFile(sourcePath, targetPath, beforeStat, beforeSnapshot, copyState);
    return;
  }
  if (beforeSnapshot.kind === 'symlink') {
    copySymbolicLink(
      sourceRootPath,
      workspaceRootPath,
      sourcePath,
      targetPath,
      beforeSnapshot
    );
    return;
  }
  fail('WORKSPACE_SOURCE_ENTRY_UNSUPPORTED');
}

function copyDirectoryContents(
  sourceRootPath,
  workspaceRootPath,
  sourceDirectory,
  targetDirectory,
  copyState
) {
  const initial = sourceDirectorySnapshot(sourceDirectory);
  for (const name of initial.names) {
    const sourcePath = path.join(sourceDirectory, name);
    const targetPath = path.join(targetDirectory, name);
    if (!isStrictlyInside(sourceRootPath, sourcePath)
      || !isStrictlyInside(workspaceRootPath, targetPath)) {
      fail('WORKSPACE_SOURCE_CHANGED');
    }
    copyEntry(sourceRootPath, workspaceRootPath, sourcePath, targetPath, copyState);
  }
  const final = sourceDirectorySnapshot(sourceDirectory);
  if (!sameSnapshot(initial.identity, final.identity)
    || initial.names.length !== final.names.length
    || initial.names.some((name, index) => name !== final.names[index])) {
    fail('WORKSPACE_SOURCE_CHANGED');
  }
}

function lstatOrNull(location) {
  try {
    return lstatBigInt(location);
  } catch (error) {
    if (isMissing(error)) return null;
    rethrow(error, 'WORKSPACE_DISCARD_FAILED');
  }
}

function removeDirectoryTree(location, expectedIdentity) {
  const currentStat = lstatOrNull(location);
  if (!currentStat) return false;
  const current = statSnapshot(currentStat);
  if (current.kind !== 'directory' || !sameIdentity(current, expectedIdentity)) {
    fail('WORKSPACE_PHYSICAL_IDENTITY_CHANGED');
  }
  let names;
  try {
    fs.chmodSync(location, 0o700);
    names = directoryNames(
      location,
      current,
      'WORKSPACE_PHYSICAL_IDENTITY_CHANGED'
    ).names;
  } catch (error) {
    rethrow(error, 'WORKSPACE_DISCARD_FAILED');
  }
  for (const name of names) {
    const childPath = path.join(location, name);
    let childStat;
    try {
      childStat = lstatBigInt(childPath);
    } catch (error) {
      rethrow(error, 'WORKSPACE_DISCARD_FAILED');
    }
    const child = statSnapshot(childStat);
    if (child.kind === 'directory') {
      removeDirectoryTree(childPath, child);
    } else {
      try {
        fs.unlinkSync(childPath);
      } catch (error) {
        rethrow(error, 'WORKSPACE_DISCARD_FAILED');
      }
    }
  }
  try {
    const final = statSnapshot(lstatBigInt(location));
    if (final.kind !== 'directory' || !sameIdentity(final, expectedIdentity)) {
      fail('WORKSPACE_PHYSICAL_IDENTITY_CHANGED');
    }
    fs.rmdirSync(location);
  } catch (error) {
    rethrow(error, 'WORKSPACE_DISCARD_FAILED');
  }
  return true;
}

function createPortableExecutionWorkspaceBackend(options = {}) {
  normalizeOptions(options);
  let state = 'idle';
  let sessionRoot = null;
  let disposeReceipt = null;
  const recordsByLeaseId = new Map();
  const ownersBySourceIdentity = new Map();

  function unavailable(reasonCode) {
    return createExecutionWorkspaceProbeResult({
      state: EXECUTION_WORKSPACE_STATES.UNAVAILABLE,
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
        fail('WORKSPACE_STORAGE_UNAVAILABLE');
      }
      createdPath = fs.mkdtempSync(path.join(temporaryRoot, SESSION_DIRECTORY_PREFIX));
      createdIdentity = statSnapshot(lstatBigInt(createdPath));
      if (createdIdentity.kind !== 'directory') {
        fail('WORKSPACE_STORAGE_UNAVAILABLE');
      }
      fs.chmodSync(createdPath, 0o700);
      sessionRoot = ownedDirectoryRecord(createdPath, temporaryRoot);
      state = 'ready';
    } catch (error) {
      if (createdPath && createdIdentity) {
        try {
          removeDirectoryTree(createdPath, createdIdentity);
        } catch { /* refuse cleanup when the created inode changed */ }
      }
      sessionRoot = null;
      state = 'unavailable';
      rethrow(error, 'WORKSPACE_STORAGE_UNAVAILABLE');
    }
  }

  function assertSessionRoot() {
    if (!sessionRoot || state !== 'ready') fail('WORKSPACE_BACKEND_UNAVAILABLE');
    try {
      assertOwnedDirectory(sessionRoot, 'WORKSPACE_SESSION_IDENTITY_CHANGED');
    } catch (error) {
      state = 'quarantined';
      rethrow(error, 'WORKSPACE_SESSION_IDENTITY_CHANGED');
    }
  }

  function createWorkspaceRoot() {
    let createdPath = null;
    let createdIdentity = null;
    try {
      assertSessionRoot();
      createdPath = fs.mkdtempSync(path.join(sessionRoot.path, WORKSPACE_DIRECTORY_PREFIX));
      createdIdentity = statSnapshot(lstatBigInt(createdPath));
      if (createdIdentity.kind !== 'directory') {
        fail('WORKSPACE_STORAGE_UNAVAILABLE');
      }
      fs.chmodSync(createdPath, 0o700);
      return ownedDirectoryRecord(createdPath, sessionRoot.realPath);
    } catch (error) {
      if (createdPath && createdIdentity) {
        try {
          removeDirectoryTree(createdPath, createdIdentity);
        } catch { /* refuse cleanup when the created inode changed */ }
      }
      rethrow(error, 'WORKSPACE_STORAGE_UNAVAILABLE');
    }
  }

  function removeWorkspaceRecord(record) {
    const current = lstatOrNull(record.workspace.path);
    if (!current) return;
    const currentSnapshot = statSnapshot(current);
    if (currentSnapshot.kind !== 'directory'
      || !sameIdentity(currentSnapshot, record.workspace.identity)) {
      fail('WORKSPACE_PHYSICAL_IDENTITY_CHANGED');
    }
    removeDirectoryTree(record.workspace.path, record.workspace.identity);
  }

  function releaseRecord(record) {
    recordsByLeaseId.delete(record.request.leaseId);
    if (ownersBySourceIdentity.get(record.source.ownershipKey) === record) {
      ownersBySourceIdentity.delete(record.source.ownershipKey);
    }
  }

  function probe(input) {
    void input;
    if (state === 'disposed') return unavailable('WORKSPACE_BACKEND_DISPOSED');
    if (state === 'quarantined') return unavailable('WORKSPACE_BACKEND_UNHEALTHY');
    if (state === 'unavailable') return unavailable('WORKSPACE_STORAGE_UNAVAILABLE');
    if (state === 'idle') {
      try {
        createSessionRoot();
      } catch {
        return unavailable('WORKSPACE_STORAGE_UNAVAILABLE');
      }
    }
    try {
      assertSessionRoot();
    } catch {
      return unavailable('WORKSPACE_BACKEND_UNHEALTHY');
    }
    return createExecutionWorkspaceProbeResult({
      state: EXECUTION_WORKSPACE_STATES.ENFORCED,
      guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
    });
  }

  function acquire(value) {
    if (state !== 'ready') fail('WORKSPACE_BACKEND_UNAVAILABLE');
    let request;
    try {
      request = assertExecutionWorkspaceAcquireRequest(value);
    } catch (error) {
      rethrow(error, 'WORKSPACE_ACQUIRE_REQUEST_INVALID');
    }
    if (recordsByLeaseId.has(request.leaseId)) {
      fail('WORKSPACE_LEASE_ALREADY_ACTIVE');
    }
    assertSessionRoot();
    const source = captureSourceRoot(request);
    if (ownersBySourceIdentity.has(source.ownershipKey)) {
      fail('WORKSPACE_SOURCE_ALREADY_ACTIVE');
    }
    if (isInsideOrEqual(source.realRootPath, sessionRoot.realPath)
      || isInsideOrEqual(sessionRoot.realPath, source.realRootPath)) {
      fail('WORKSPACE_SOURCE_STORAGE_OVERLAP');
    }
    let workspace = null;
    try {
      workspace = createWorkspaceRoot();
      const copyState = { entries: 0, bytes: 0n };
      copyDirectoryContents(
        source.realRootPath,
        workspace.realPath,
        source.realRootPath,
        workspace.realPath,
        copyState
      );
      assertSourceUnchanged(source, request);
      assertOwnedDirectory(workspace, 'WORKSPACE_PHYSICAL_IDENTITY_CHANGED');
      const lease = createExecutionWorkspaceLease({
        request,
        workspaceRootPath: workspace.path,
        workspaceRealRootPath: workspace.realPath,
        workspaceRootIdentityDigest: workspace.identityDigest,
      });
      const record = Object.freeze({ request, lease, source, workspace });
      recordsByLeaseId.set(request.leaseId, record);
      ownersBySourceIdentity.set(source.ownershipKey, record);
      return lease;
    } catch (error) {
      if (workspace) {
        try {
          removeDirectoryTree(workspace.path, workspace.identity);
        } catch {
          state = 'quarantined';
          fail('WORKSPACE_ACQUIRE_CLEANUP_FAILED');
        }
      }
      rethrow(error, 'WORKSPACE_ACQUIRE_FAILED');
    }
  }

  function discard(value) {
    if (!['ready', 'quarantined'].includes(state)) {
      fail('WORKSPACE_BACKEND_UNAVAILABLE');
    }
    let request;
    try {
      request = assertExecutionWorkspaceDiscardRequest(value);
    } catch (error) {
      rethrow(error, 'WORKSPACE_DISCARD_REQUEST_INVALID');
    }
    const record = recordsByLeaseId.get(request.leaseId);
    if (!record
      || request.jobId !== record.lease.jobId
      || request.sourceRootIdentityDigest !== record.lease.sourceRootIdentityDigest
      || request.workspaceAuthorityDigest !== record.lease.workspaceAuthorityDigest
      || request.workspaceRootIdentityDigest !== record.lease.workspaceRootIdentityDigest) {
      fail('WORKSPACE_DISCARD_AUTHORITY_MISMATCH');
    }
    try {
      removeWorkspaceRecord(record);
      releaseRecord(record);
      return createExecutionWorkspaceDiscardReceipt({ request, discarded: true });
    } catch (error) {
      rethrow(error, 'WORKSPACE_DISCARD_FAILED');
    }
  }

  function removeSessionRoot() {
    if (!sessionRoot) return;
    const current = lstatOrNull(sessionRoot.path);
    if (!current) {
      sessionRoot = null;
      return;
    }
    const currentSnapshot = statSnapshot(current);
    if (currentSnapshot.kind !== 'directory'
      || !sameIdentity(currentSnapshot, sessionRoot.identity)) {
      fail('WORKSPACE_SESSION_IDENTITY_CHANGED');
    }
    const names = directoryNames(
      sessionRoot.path,
      currentSnapshot,
      'WORKSPACE_SESSION_IDENTITY_CHANGED'
    ).names;
    if (names.length !== 0) fail('WORKSPACE_SESSION_NOT_EMPTY');
    try {
      fs.rmdirSync(sessionRoot.path);
    } catch (error) {
      rethrow(error, 'WORKSPACE_DISPOSE_FAILED');
    }
    sessionRoot = null;
  }

  function dispose(input) {
    void input;
    if (disposeReceipt) return disposeReceipt;
    try {
      for (const record of [...recordsByLeaseId.values()]) {
        removeWorkspaceRecord(record);
        releaseRecord(record);
      }
      removeSessionRoot();
      state = 'disposed';
      disposeReceipt = Object.freeze({ ok: true, disposed: true });
      return disposeReceipt;
    } catch (error) {
      state = 'quarantined';
      rethrow(error, 'WORKSPACE_DISPOSE_FAILED');
    }
  }

  return Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID,
    probe,
    acquire,
    discard,
    dispose,
  });
}

module.exports = {
  PORTABLE_EXECUTION_WORKSPACE_BACKEND_ID,
  PORTABLE_EXECUTION_WORKSPACE_BACKEND_VERSION,
  PortableExecutionWorkspaceBackendError,
  createPortableExecutionWorkspaceBackend,
};
