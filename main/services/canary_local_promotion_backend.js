'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const {
  MAX_ENTRY_INSPECTION_BYTES,
  createProjectRootPhysicalIdentityDigest,
} = require('../capabilities/project_root_authority_contract');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  CanaryPromotionBackendAmbiguousError,
  assertCanaryPromotionBackendRequest,
  assertCanaryPromotionReceipt,
  createCanaryPromotionReceipt,
  createCanaryPromotionRevertReceipt,
} = require('../agent_runtime/canary_promotion_contract');
const {
  CANARY_PROMOTION_ROLLBACK_CANCEL_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_COMMIT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_PREPARED_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_RECOVERY_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_SETTLEMENT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION,
  CANARY_PROMOTION_ROLLBACK_STORE_VERSION,
} = require('../agent_runtime/canary_promotion_rollback_store_contract');
const {
  CANARY_SOURCE_BRANCH_STATE_SCHEMA_VERSION,
  CANARY_SOURCE_INDEX_STATE_SCHEMA_VERSION,
  CANARY_SOURCE_TREE_SCHEMA_VERSION,
  CANARY_SOURCE_USER_STATE_SCHEMA_VERSION,
} = require('../agent_runtime/canary_source_snapshot_contract');
const {
  createCanaryStagingWriteSetDigest,
} = require('../agent_runtime/canary_staging_write_set_contract');

const CANARY_LOCAL_PROMOTION_BACKEND_VERSION =
  'canary-local-promotion-backend.v1';
const CANARY_LOCAL_PROMOTION_BACKEND_REASONS = Object.freeze({
  CAPACITY_EXCEEDED: 'CANARY_LOCAL_PROMOTION_CAPACITY_EXCEEDED',
  INVALID_INPUT: 'CANARY_LOCAL_PROMOTION_INVALID_INPUT',
  REPLAY_MISMATCH: 'CANARY_LOCAL_PROMOTION_REPLAY_MISMATCH',
  ROLLBACK_STORE_FAILED: 'CANARY_LOCAL_PROMOTION_ROLLBACK_STORE_FAILED',
  REVERT_CONFLICT: 'CANARY_LOCAL_PROMOTION_REVERT_CONFLICT',
  REVERT_FAILED: 'CANARY_LOCAL_PROMOTION_REVERT_FAILED',
  SOURCE_CONFLICT: 'CANARY_LOCAL_PROMOTION_SOURCE_CONFLICT',
  STAGING_CONFLICT: 'CANARY_LOCAL_PROMOTION_STAGING_CONFLICT',
  WRITE_FAILED: 'CANARY_LOCAL_PROMOTION_WRITE_FAILED',
});

const CANARY_LOCAL_PROMOTION_BACKEND_DIAGNOSTICS = Object.freeze({
  version: CANARY_LOCAL_PROMOTION_BACKEND_VERSION,
  conflictCheck: 'required',
  inversePatch: 'job_scoped',
  rejectionFrontier: 'pre_write_only',
  settlementMode: 'terminal_receipt',
  branchMutation: 'forbidden',
  gitIndexMutation: 'forbidden',
  userDirtyMutation: 'forbidden',
});

const DEFAULT_MAX_PROMOTIONS = 4096;
const HARD_MAX_PROMOTIONS = 100_000;
const DEFAULT_MAX_ENTRIES = 100_000;
const HARD_MAX_ENTRIES = 250_000;
const DEFAULT_MAX_PRIVATE_BYTES = 256 * 1024 * 1024;
const HARD_MAX_PRIVATE_BYTES = 1024 * 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const MAX_GIT_FILE_BYTES = 4096;
const MAX_LINK_TARGET_BYTES = 16 * 1024;
const COPY_BUFFER_BYTES = 64 * 1024;
const TEMP_FILE_ATTEMPTS = 8;
const SAFE_REF = /^refs\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const SAFE_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SAFE_REASON = /^[a-z][a-z0-9_:-]{0,79}$/;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPTION_KEYS = Object.freeze([
  'maxPromotions',
  'maxEntries',
  'maxPrivateBytes',
  'rollbackStore',
]);
const ROLLBACK_STORE_KEYS = Object.freeze([
  'version',
  'load',
  'prepare',
  'commit',
  'cancel',
  'settle',
  'diagnostics',
]);
const ROLLBACK_STORE_DIAGNOSTIC_KEYS = Object.freeze([
  'version',
  'durability',
  'stateModel',
]);
const ROLLBACK_STORE_SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'records',
]);
const ROLLBACK_RECOVERY_KEYS = Object.freeze([
  'schemaVersion',
  'request',
  'inversePatchDigest',
  'entries',
  'promotionReceipt',
  'sourceAfter',
]);
const ROLLBACK_ENTRY_KEYS = Object.freeze(['path', 'before', 'after']);
const ABSENT_STATE_KEYS = Object.freeze(['kind']);
const DIRECTORY_STATE_KEYS = Object.freeze(['kind', 'mode']);
const FILE_STATE_KEYS = Object.freeze([
  'kind',
  'mode',
  'bytes',
  'contentDigest',
  'contentBase64',
]);
const SOURCE_AFTER_KEYS = Object.freeze([
  'sourceStateDigest',
  'branchHeadDigest',
  'gitIndexDigest',
  'userDirtyDigest',
]);
const REVERT_INPUT_KEYS = Object.freeze([
  'request',
  'promotionReceipt',
  'reason',
]);
const GIT_TRANSITION_MARKERS = Object.freeze([
  '.git/index.lock',
  '.git/HEAD.lock',
  '.git/MERGE_HEAD',
  '.git/CHERRY_PICK_HEAD',
  '.git/REVERT_HEAD',
  '.git/BISECT_LOG',
  '.git/rebase-apply',
  '.git/rebase-merge',
  '.git/sequencer',
  '.git/commondir',
]);

class CanaryLocalPromotionBackendError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CanaryLocalPromotionBackendError';
    this.code = code;
  }
}

class PhysicalStateError extends Error {
  constructor(scope) {
    super(`CANARY_LOCAL_PROMOTION_${scope.toUpperCase()}_STATE_CHANGED`);
    this.name = 'PhysicalStateError';
    this.scope = scope;
  }
}

function backendError(code) {
  return new CanaryLocalPromotionBackendError(code);
}

function fail(code) {
  throw backendError(code);
}

function physicalFail(scope) {
  throw new PhysicalStateError(scope);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { return false; }
  return prototype === Object.prototype || prototype === null;
}

function exactDataFields(value, expectedKeys, { frozen = false } = {}) {
  if (!isPlainRecord(value) || frozen && !Object.isFrozen(value)) return null;
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { return null; }
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || expectedKeys.some((key) => !keys.includes(key))) return null;
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

function normalizeOptions(options) {
  if (!isPlainRecord(options)) {
    throw new TypeError('Invalid canary local promotion backend options');
  }
  let keys;
  try { keys = Reflect.ownKeys(options); } catch {
    throw new TypeError('Invalid canary local promotion backend options');
  }
  if (keys.some((key) => typeof key !== 'string'
    || FORBIDDEN_KEYS.has(key) || !OPTION_KEYS.includes(key))) {
    throw new TypeError('Invalid canary local promotion backend options');
  }
  const values = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Invalid canary local promotion backend options');
    }
    values[key] = descriptor.value;
  }
  const maxPromotions = values.maxPromotions === undefined
    ? DEFAULT_MAX_PROMOTIONS : values.maxPromotions;
  const maxEntries = values.maxEntries === undefined
    ? DEFAULT_MAX_ENTRIES : values.maxEntries;
  const maxPrivateBytes = values.maxPrivateBytes === undefined
    ? DEFAULT_MAX_PRIVATE_BYTES : values.maxPrivateBytes;
  if (!Number.isSafeInteger(maxPromotions) || maxPromotions < 1
    || maxPromotions > HARD_MAX_PROMOTIONS
    || !Number.isSafeInteger(maxEntries) || maxEntries < 1
    || maxEntries > HARD_MAX_ENTRIES
    || !Number.isSafeInteger(maxPrivateBytes) || maxPrivateBytes < 1
    || maxPrivateBytes > HARD_MAX_PRIVATE_BYTES) {
    throw new TypeError('Invalid canary local promotion backend limit options');
  }
  const rollbackStore = values.rollbackStore === undefined
    ? null : captureRollbackStore(values.rollbackStore);
  return Object.freeze({
    maxPromotions,
    maxEntries,
    maxPrivateBytes,
    rollbackStore,
  });
}

function invokeRollbackStore(port, method, argument, { mutation = false } = {}) {
  let result;
  try {
    result = argument === undefined
      ? Reflect.apply(port[method], port.receiver, [])
      : Reflect.apply(port[method], port.receiver, [argument]);
  } catch {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED);
  }
  if (util.types.isPromise(result) || mutation && result !== undefined) {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED);
  }
  return result;
}

function captureRollbackStore(value) {
  const fields = exactDataFields(value, ROLLBACK_STORE_KEYS, { frozen: true });
  if (!fields
    || fields.get('version') !== CANARY_PROMOTION_ROLLBACK_STORE_VERSION
    || ROLLBACK_STORE_KEYS.slice(1).some(
      (key) => typeof fields.get(key) !== 'function'
    )) {
    throw new TypeError('Invalid canary promotion rollback store');
  }
  const port = Object.freeze({
    receiver: value,
    load: fields.get('load'),
    prepare: fields.get('prepare'),
    commit: fields.get('commit'),
    cancel: fields.get('cancel'),
    settle: fields.get('settle'),
    diagnostics: fields.get('diagnostics'),
  });
  const diagnostics = invokeRollbackStore(port, 'diagnostics');
  const diagnosticFields = exactDataFields(
    diagnostics,
    ROLLBACK_STORE_DIAGNOSTIC_KEYS,
    { frozen: true }
  );
  if (!diagnosticFields
    || diagnosticFields.get('version') !== CANARY_PROMOTION_ROLLBACK_STORE_VERSION
    || diagnosticFields.get('durability') !== 'private_user_data'
    || diagnosticFields.get('stateModel') !== 'prepared_committed_settled') {
    throw new TypeError('Invalid canary promotion rollback store diagnostics');
  }
  return port;
}

function errorCode(error) {
  if (!error || typeof error !== 'object' || util.types.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value : null;
}

function isMissing(error) {
  return errorCode(error) === 'ENOENT';
}

function statKind(stat) {
  try {
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isDirectory()) return 'directory';
    if (stat.isFile()) return 'file';
  } catch {
    return 'unknown';
  }
  return 'other';
}

function statSnapshot(stat, scope) {
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
    physicalFail(scope);
  }
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.kind === right.kind
    && left.device === right.device && left.inode === right.inode);
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.mode === right.mode && left.size === right.size
    && left.modifiedNanoseconds === right.modifiedNanoseconds
    && left.changedNanoseconds === right.changedNanoseconds;
}

function permissionMode(snapshot, scope) {
  try { return Number(BigInt(snapshot.mode) & 0o7777n); } catch {
    physicalFail(scope);
  }
}

function localPathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return path.sep === '\\' ? normalized.toLowerCase() : normalized;
}

function sameLocalPath(left, right) {
  return localPathKey(left) === localPathKey(right);
}

function pathsOverlap(left, right) {
  const leftKey = localPathKey(left);
  const rightKey = localPathKey(right);
  const relativeLeft = path.relative(leftKey, rightKey);
  const relativeRight = path.relative(rightKey, leftKey);
  return !relativeLeft || !relativeRight
    || relativeLeft !== '..' && !relativeLeft.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeLeft)
    || relativeRight !== '..' && !relativeRight.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeRight);
}

function isStrictlyInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return Boolean(relative) && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function physicalIdentityDigest(entry, target, scope) {
  try {
    return createProjectRootPhysicalIdentityDigest({
      device: target.device,
      inode: target.inode,
      entryDevice: entry.device,
      entryInode: entry.inode,
      entryType: entry.kind,
    });
  } catch {
    physicalFail(scope);
  }
}

function captureBoundRoot(rootPath, realRootPath, identityDigest, scope) {
  try {
    const entryBefore = statSnapshot(
      fs.lstatSync(rootPath, { bigint: true }), scope
    );
    const targetBefore = statSnapshot(
      fs.statSync(rootPath, { bigint: true }), scope
    );
    const observedRealPath = fs.realpathSync(rootPath);
    const entryAfter = statSnapshot(
      fs.lstatSync(rootPath, { bigint: true }), scope
    );
    const targetAfter = statSnapshot(
      fs.statSync(rootPath, { bigint: true }), scope
    );
    if (!['directory', 'symlink'].includes(entryAfter.kind)
      || targetAfter.kind !== 'directory'
      || !sameSnapshot(entryBefore, entryAfter)
      || !sameSnapshot(targetBefore, targetAfter)
      || entryAfter.kind === 'directory' && !sameIdentity(entryAfter, targetAfter)
      || !sameLocalPath(observedRealPath, realRootPath)
      || physicalIdentityDigest(entryAfter, targetAfter, scope) !== identityDigest) {
      physicalFail(scope);
    }
    return Object.freeze({
      path: rootPath,
      realPath: observedRealPath,
      identityDigest,
      entryIdentity: entryAfter,
      targetIdentity: targetAfter,
      scope,
    });
  } catch (error) {
    if (error instanceof PhysicalStateError) throw error;
    physicalFail(scope);
  }
}

function assertBoundRoot(root) {
  try {
    const entry = statSnapshot(
      fs.lstatSync(root.path, { bigint: true }), root.scope
    );
    const target = statSnapshot(
      fs.statSync(root.path, { bigint: true }), root.scope
    );
    if (!sameIdentity(entry, root.entryIdentity)
      || !sameIdentity(target, root.targetIdentity)
      || entry.kind === 'directory' && !sameIdentity(entry, target)
      || !sameLocalPath(fs.realpathSync(root.path), root.realPath)
      || physicalIdentityDigest(entry, target, root.scope)
        !== root.identityDigest) physicalFail(root.scope);
  } catch (error) {
    if (error instanceof PhysicalStateError) throw error;
    physicalFail(root.scope);
  }
}

function safeComponents(relativePath, scope) {
  if (typeof relativePath !== 'string' || !relativePath
    || relativePath.includes('\0') || relativePath.includes('\\')
    || relativePath.startsWith('/') || /^[A-Za-z]:\//.test(relativePath)
    || Buffer.byteLength(relativePath, 'utf8') > MAX_PATH_BYTES) {
    physicalFail(scope);
  }
  const components = relativePath.split('/');
  if (components.some((component) => !component
    || component === '.' || component === '..')) physicalFail(scope);
  return components;
}

function lstatOrNull(location, scope) {
  try {
    return statSnapshot(fs.lstatSync(location, { bigint: true }), scope);
  } catch (error) {
    if (error instanceof PhysicalStateError) throw error;
    if (isMissing(error)) return null;
    physicalFail(scope);
  }
}

function locateRelative(root, relativePath) {
  assertBoundRoot(root);
  const components = safeComponents(relativePath, root.scope);
  let parentPath = root.realPath;
  let parentIdentity = root.targetIdentity;
  for (let index = 0; index < components.length - 1; index += 1) {
    const candidate = path.join(parentPath, components[index]);
    if (!isStrictlyInside(root.realPath, candidate)) physicalFail(root.scope);
    const before = lstatOrNull(candidate, root.scope);
    if (!before) {
      return Object.freeze({ missingParent: true, target: null });
    }
    if (before.kind !== 'directory') physicalFail(root.scope);
    let realPath;
    try { realPath = fs.realpathSync(candidate); } catch { physicalFail(root.scope); }
    const after = lstatOrNull(candidate, root.scope);
    if (!after || !sameSnapshot(before, after)
      || !isStrictlyInside(root.realPath, realPath)) physicalFail(root.scope);
    parentPath = candidate;
    parentIdentity = after;
  }
  const targetPath = path.join(parentPath, components[components.length - 1]);
  if (!isStrictlyInside(root.realPath, targetPath)) physicalFail(root.scope);
  const target = lstatOrNull(targetPath, root.scope);
  assertBoundRoot(root);
  return Object.freeze({
    missingParent: false,
    parentPath,
    parentIdentity,
    targetPath,
    target,
  });
}

function bytesDigest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function readRegularFile(root, relativePath, { capture = false,
  maxBytes = MAX_ENTRY_INSPECTION_BYTES } = {}) {
  const located = locateRelative(root, relativePath);
  if (located.missingParent || !located.target
    || located.target.kind !== 'file'
    || typeof fs.constants.O_NOFOLLOW !== 'number') physicalFail(root.scope);
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      located.targetPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
    );
    const opened = statSnapshot(
      fs.fstatSync(descriptor, { bigint: true }), root.scope
    );
    const size = Number(BigInt(opened.size));
    if (opened.kind !== 'file' || !sameSnapshot(opened, located.target)
      || !Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      physicalFail(root.scope);
    }
    const hash = crypto.createHash('sha256');
    const output = capture ? Buffer.alloc(size) : null;
    const scratch = capture ? output : Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let offset = 0;
    while (offset < size) {
      const targetOffset = capture ? offset : 0;
      const requested = Math.min(size - offset, scratch.length - targetOffset);
      const read = fs.readSync(
        descriptor, scratch, targetOffset, requested, null
      );
      if (!Number.isSafeInteger(read) || read <= 0) physicalFail(root.scope);
      hash.update(scratch.subarray(targetOffset, targetOffset + read));
      offset += read;
    }
    const finalHandle = statSnapshot(
      fs.fstatSync(descriptor, { bigint: true }), root.scope
    );
    const finalPath = lstatOrNull(located.targetPath, root.scope);
    if (!sameSnapshot(opened, finalHandle) || !finalPath
      || !sameSnapshot(opened, finalPath)) physicalFail(root.scope);
    assertBoundRoot(root);
    return {
      kind: 'file',
      mode: permissionMode(opened, root.scope),
      bytes: size,
      contentDigest: `sha256:${hash.digest('hex')}`,
      content: output,
      snapshot: opened,
    };
  } catch (error) {
    if (error instanceof PhysicalStateError) throw error;
    physicalFail(root.scope);
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* descriptor is no longer used */ }
    }
  }
}

function readSymlink(root, relativePath, expected) {
  const located = locateRelative(root, relativePath);
  if (located.missingParent || !located.target
    || located.target.kind !== 'symlink'
    || expected && !sameSnapshot(located.target, expected)) physicalFail(root.scope);
  let linkTarget;
  try { linkTarget = fs.readlinkSync(located.targetPath); } catch {
    physicalFail(root.scope);
  }
  const after = lstatOrNull(located.targetPath, root.scope);
  if (!after || !sameSnapshot(located.target, after)
    || typeof linkTarget !== 'string' || !linkTarget
    || linkTarget.includes('\0')
    || Buffer.byteLength(linkTarget, 'utf8') > MAX_LINK_TARGET_BYTES) {
    physicalFail(root.scope);
  }
  const bytes = Buffer.from(linkTarget, 'utf8');
  return Object.freeze({
    path: relativePath,
    kind: 'symlink',
    mode: permissionMode(after, root.scope),
    bytes: bytes.length,
    contentDigest: bytesDigest(bytes),
    linkTarget,
  });
}

function directoryListing(root, relativePath) {
  const location = relativePath
    ? locateRelative(root, relativePath) : Object.freeze({
      missingParent: false,
      target: root.targetIdentity,
      targetPath: root.realPath,
    });
  if (location.missingParent || !location.target
    || location.target.kind !== 'directory') physicalFail(root.scope);
  const before = lstatOrNull(location.targetPath, root.scope);
  let names;
  try { names = fs.readdirSync(location.targetPath); } catch { physicalFail(root.scope); }
  if (!before || before.kind !== 'directory' || !Array.isArray(names)
    || names.some((name) => typeof name !== 'string' || !name
      || name === '.' || name === '..' || name.includes('/')
      || name.includes('\\') || name.includes('\0'))) physicalFail(root.scope);
  names.sort();
  const after = lstatOrNull(location.targetPath, root.scope);
  if (!after || !sameSnapshot(before, after)) physicalFail(root.scope);
  return Object.freeze({ names: Object.freeze(names), snapshot: after });
}

function canonicalTreeFile(relativePath, file) {
  return Object.freeze({
    path: relativePath,
    kind: 'file',
    mode: file.mode,
    bytes: file.bytes,
    contentDigest: file.contentDigest,
  });
}

function scanSourceTree(root, maxEntries) {
  const queue = [''];
  const entries = [];
  const byPath = new Map();
  let gitEntry = null;
  let observed = 0;
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const directory = queue[queueIndex];
    const listing = directoryListing(root, directory);
    for (const name of listing.names) {
      observed += 1;
      if (observed > maxEntries) physicalFail(root.scope);
      const relativePath = directory ? `${directory}/${name}` : name;
      if (Buffer.byteLength(relativePath, 'utf8') > MAX_PATH_BYTES) {
        physicalFail(root.scope);
      }
      const located = locateRelative(root, relativePath);
      if (located.missingParent || !located.target) physicalFail(root.scope);
      if (directory === '' && name === '.git') {
        gitEntry = located.target;
        continue;
      }
      let entry;
      if (located.target.kind === 'directory') {
        entry = Object.freeze({
          path: relativePath,
          kind: 'directory',
          mode: permissionMode(located.target, root.scope),
        });
        queue.push(relativePath);
      } else if (located.target.kind === 'file') {
        entry = canonicalTreeFile(
          relativePath,
          readRegularFile(root, relativePath)
        );
      } else if (located.target.kind === 'symlink') {
        entry = readSymlink(root, relativePath, located.target);
      } else {
        physicalFail(root.scope);
      }
      entries.push(entry);
      byPath.set(relativePath, entry);
    }
  }
  entries.sort((left, right) => left.path < right.path
    ? -1 : left.path > right.path ? 1 : 0);
  assertBoundRoot(root);
  return Object.freeze({
    entries: Object.freeze(entries),
    byPath,
    gitEntry,
  });
}

function optionalEntry(root, relativePath) {
  const located = locateRelative(root, relativePath);
  return located.missingParent ? null : located.target;
}

function readSmallGitFile(root, relativePath, inspection) {
  if (!inspection || inspection.kind !== 'file') physicalFail(root.scope);
  const size = Number(BigInt(inspection.size));
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_GIT_FILE_BYTES) {
    physicalFail(root.scope);
  }
  const file = readRegularFile(root, relativePath, {
    capture: true,
    maxBytes: MAX_GIT_FILE_BYTES,
  });
  const text = file.content.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(file.content)
    || text.includes('\0')) physicalFail(root.scope);
  return Object.freeze({ text, contentDigest: file.contentDigest });
}

function metadataDigest(file, schemaVersion) {
  return canonicalSha256Digest(file ? {
    schemaVersion,
    state: 'present',
    bytes: file.bytes,
    mode: file.mode,
    contentDigest: file.contentDigest,
  } : { schemaVersion, state: 'absent' });
}

function inspectGitState(root, gitEntry) {
  if (!gitEntry) {
    return Object.freeze({
      branchHeadDigest: canonicalSha256Digest({
        schemaVersion: CANARY_SOURCE_BRANCH_STATE_SCHEMA_VERSION,
        state: 'absent',
      }),
      gitIndexDigest: canonicalSha256Digest({
        schemaVersion: CANARY_SOURCE_INDEX_STATE_SCHEMA_VERSION,
        state: 'absent',
      }),
    });
  }
  if (gitEntry.kind !== 'directory') physicalFail(root.scope);
  for (const marker of GIT_TRANSITION_MARKERS) {
    if (optionalEntry(root, marker)) physicalFail(root.scope);
  }
  const headInspection = optionalEntry(root, '.git/HEAD');
  const head = readSmallGitFile(root, '.git/HEAD', headInspection);
  const headValue = head.text.trim();
  let headState;
  if (headValue.startsWith('ref: ')) {
    const ref = headValue.slice(5);
    if (!SAFE_REF.test(ref) || ref.split('/').some((part) => (
      part === '.' || part === '..' || part.endsWith('.lock')
    ))) physicalFail(root.scope);
    const refPath = `.git/${ref}`;
    const refInspection = optionalEntry(root, refPath);
    let refObjectId = null;
    let refContentDigest = null;
    if (refInspection) {
      const refFile = readSmallGitFile(root, refPath, refInspection);
      refObjectId = refFile.text.trim();
      refContentDigest = refFile.contentDigest;
      if (!SAFE_OBJECT_ID.test(refObjectId)) physicalFail(root.scope);
    }
    headState = Object.freeze({
      mode: 'symbolic',
      ref,
      objectId: refObjectId,
      refContentDigest,
    });
  } else {
    if (!SAFE_OBJECT_ID.test(headValue)) physicalFail(root.scope);
    headState = Object.freeze({
      mode: 'detached',
      ref: null,
      objectId: headValue,
      refContentDigest: null,
    });
  }
  const packedInspection = optionalEntry(root, '.git/packed-refs');
  let packedRefsDigest = null;
  if (packedInspection) {
    if (packedInspection.kind !== 'file') physicalFail(root.scope);
    packedRefsDigest = readRegularFile(root, '.git/packed-refs').contentDigest;
  }
  const indexInspection = optionalEntry(root, '.git/index');
  let indexFile = null;
  if (indexInspection) {
    if (indexInspection.kind !== 'file') physicalFail(root.scope);
    indexFile = readRegularFile(root, '.git/index');
  }
  return Object.freeze({
    branchHeadDigest: canonicalSha256Digest({
      schemaVersion: CANARY_SOURCE_BRANCH_STATE_SCHEMA_VERSION,
      state: 'present',
      headContentDigest: head.contentDigest,
      headState,
      packedRefsDigest,
    }),
    gitIndexDigest: metadataDigest(
      indexFile,
      CANARY_SOURCE_INDEX_STATE_SCHEMA_VERSION
    ),
  });
}

function inspectSourceState(root, request, maxEntries) {
  const tree = scanSourceTree(root, maxEntries);
  const git = inspectGitState(root, tree.gitEntry);
  const sourceStateDigest = canonicalSha256Digest({
    schemaVersion: CANARY_SOURCE_TREE_SCHEMA_VERSION,
    sourceRootIdentityDigest: request.sourceRootIdentityDigest,
    entries: tree.entries,
  });
  const authorizedPaths = request.changedPaths;
  const authorized = new Set(authorizedPaths);
  const userDirtyDigest = canonicalSha256Digest({
    schemaVersion: CANARY_SOURCE_USER_STATE_SCHEMA_VERSION,
    sourceRootIdentityDigest: request.sourceRootIdentityDigest,
    gitIndexDigest: git.gitIndexDigest,
    authorizedPaths,
    entries: Object.freeze(
      tree.entries.filter((entry) => !authorized.has(entry.path))
    ),
  });
  assertBoundRoot(root);
  return Object.freeze({
    sourceStateDigest,
    branchHeadDigest: git.branchHeadDigest,
    gitIndexDigest: git.gitIndexDigest,
    userDirtyDigest,
    tree,
  });
}

function stagingEntry(root, relativePath) {
  const located = locateRelative(root, relativePath);
  if (located.missingParent || !located.target) physicalFail(root.scope);
  if (located.target.kind === 'directory') {
    return {
      digestEntry: Object.freeze({
        path: relativePath,
        kind: 'directory',
        mode: permissionMode(located.target, root.scope) & 0o777,
        bytes: null,
        contentDigest: null,
      }),
      content: null,
      snapshot: located.target,
    };
  }
  if (located.target.kind !== 'file') physicalFail(root.scope);
  const file = readRegularFile(root, relativePath, { capture: true });
  return {
    digestEntry: Object.freeze({
      path: relativePath,
      kind: 'file',
      mode: file.mode & 0o777,
      bytes: file.bytes,
      contentDigest: file.contentDigest,
    }),
    content: file.content,
    snapshot: file.snapshot,
  };
}

function inspectStagingWriteSet(root, request) {
  const captured = request.changedPaths.map((relativePath) => (
    stagingEntry(root, relativePath)
  ));
  const digestEntries = Object.freeze(captured.map((entry) => entry.digestEntry));
  const writeSetDigest = createCanaryStagingWriteSetDigest(digestEntries);
  assertBoundRoot(root);
  return Object.freeze({ captured, digestEntries, writeSetDigest });
}

function sourceMatchesRequest(state, request) {
  return state.sourceStateDigest === request.sourceStateDigest
    && state.branchHeadDigest === request.branchHeadDigest
    && state.gitIndexDigest === request.gitIndexDigest
    && state.userDirtyDigest === request.userDirtyDigest;
}

function stateMatches(left, right) {
  return left.sourceStateDigest === right.sourceStateDigest
    && left.branchHeadDigest === right.branchHeadDigest
    && left.gitIndexDigest === right.gitIndexDigest
    && left.userDirtyDigest === right.userDirtyDigest;
}

function cloneStateRecord(value) {
  if (!value) return Object.freeze({ kind: 'absent' });
  if (value.kind === 'directory') {
    return Object.freeze({ kind: 'directory', mode: value.mode });
  }
  if (value.kind !== 'file') physicalFail('source');
  return {
    kind: 'file',
    mode: value.mode,
    bytes: value.bytes,
    contentDigest: value.contentDigest,
    content: Buffer.from(value.content),
  };
}

function publicEntryMetadata(value) {
  if (value.kind === 'absent') return Object.freeze({ kind: 'absent' });
  if (value.kind === 'directory') {
    return Object.freeze({ kind: 'directory', mode: value.mode });
  }
  return Object.freeze({
    kind: 'file',
    mode: value.mode,
    bytes: value.bytes,
    contentDigest: value.contentDigest,
  });
}

function frozenArrayValues(value, { minimum = 0, maximum } = {}) {
  if (!Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || !Object.isFrozen(value)
    || !Number.isSafeInteger(maximum)
    || value.length < minimum || value.length > maximum) return null;
  let keys;
  try { keys = Reflect.ownKeys(value).filter((key) => key !== 'length'); } catch {
    return null;
  }
  if (keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) return null;
  const output = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.value === undefined) return null;
    output.push(descriptor.value);
  }
  return output;
}

function serializeRollbackState(value) {
  if (value.kind === 'absent') return Object.freeze({ kind: 'absent' });
  if (value.kind === 'directory') {
    return Object.freeze({ kind: 'directory', mode: value.mode });
  }
  if (value.kind !== 'file' || !Buffer.isBuffer(value.content)) {
    physicalFail('source');
  }
  return Object.freeze({
    kind: 'file',
    mode: value.mode,
    bytes: value.bytes,
    contentDigest: value.contentDigest,
    contentBase64: value.content.toString('base64'),
  });
}

function serializeRollbackEntries(inverse) {
  return Object.freeze(inverse.entries.map((entry) => Object.freeze({
    path: entry.path,
    before: serializeRollbackState(entry.before),
    after: serializeRollbackState(entry.after),
  })));
}

function serializeSourceAfter(value) {
  return Object.freeze({
    sourceStateDigest: value.sourceStateDigest,
    branchHeadDigest: value.branchHeadDigest,
    gitIndexDigest: value.gitIndexDigest,
    userDirtyDigest: value.userDirtyDigest,
  });
}

function rollbackPreparedRecord(request, inverse) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_PREPARED_SCHEMA_VERSION,
    promotionId: request.promotionId,
    request,
    inversePatchDigest: inverse.inversePatchDigest,
    entries: serializeRollbackEntries(inverse),
  });
}

function rollbackCommitRecord(record) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_COMMIT_SCHEMA_VERSION,
    promotionId: record.request.promotionId,
    promotionReceipt: record.receipt,
    sourceAfter: serializeSourceAfter(record.sourceAfter),
  });
}

function rollbackCancelRecord(record) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_CANCEL_SCHEMA_VERSION,
    promotionId: record.request.promotionId,
  });
}

function rollbackSettlementRecord(record) {
  return Object.freeze({
    schemaVersion: CANARY_PROMOTION_ROLLBACK_SETTLEMENT_SCHEMA_VERSION,
    promotionId: record.request.promotionId,
  });
}

function normalizeStoredMode(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0o7777
    && !Object.is(value, -0) ? value : null;
}

function normalizeStoredState(value, config) {
  const absent = exactDataFields(value, ABSENT_STATE_KEYS, { frozen: true });
  if (absent && absent.get('kind') === 'absent') {
    return Object.freeze({
      state: Object.freeze({ kind: 'absent' }),
      privateBytes: 0,
    });
  }
  const directory = exactDataFields(
    value,
    DIRECTORY_STATE_KEYS,
    { frozen: true }
  );
  const directoryMode = directory && normalizeStoredMode(directory.get('mode'));
  if (directory && directory.get('kind') === 'directory'
    && directoryMode !== null) {
    return Object.freeze({
      state: Object.freeze({ kind: 'directory', mode: directoryMode }),
      privateBytes: 0,
    });
  }
  const file = exactDataFields(value, FILE_STATE_KEYS, { frozen: true });
  if (!file || file.get('kind') !== 'file') return null;
  const mode = normalizeStoredMode(file.get('mode'));
  const bytes = file.get('bytes');
  const contentDigest = file.get('contentDigest');
  const contentBase64 = file.get('contentBase64');
  const maximumBase64Bytes = Math.ceil(config.maxPrivateBytes / 3) * 4;
  if (mode === null || !Number.isSafeInteger(bytes) || bytes < 0
    || Object.is(bytes, -0) || bytes > config.maxPrivateBytes
    || typeof contentDigest !== 'string' || !SAFE_DIGEST.test(contentDigest)
    || typeof contentBase64 !== 'string'
    || Buffer.byteLength(contentBase64, 'utf8') > maximumBase64Bytes
    || !CANONICAL_BASE64.test(contentBase64)) return null;
  let content;
  try { content = Buffer.from(contentBase64, 'base64'); } catch { return null; }
  if (content.length !== bytes || content.toString('base64') !== contentBase64
    || bytesDigest(content) !== contentDigest) return null;
  return Object.freeze({
    state: Object.freeze({
      kind: 'file',
      mode,
      bytes,
      contentDigest,
      content,
    }),
    privateBytes: bytes,
  });
}

function normalizeStoredInverse(value, request, inversePatchDigest, config) {
  const records = frozenArrayValues(value, {
    minimum: request.changedPaths.length,
    maximum: request.changedPaths.length,
  });
  if (!records) return null;
  const entries = [];
  let privateBytes = 0;
  for (let index = 0; index < records.length; index += 1) {
    const fields = exactDataFields(
      records[index],
      ROLLBACK_ENTRY_KEYS,
      { frozen: true }
    );
    if (!fields || fields.get('path') !== request.changedPaths[index]) return null;
    const before = normalizeStoredState(fields.get('before'), config);
    const after = normalizeStoredState(fields.get('after'), config);
    if (!before || !after) return null;
    privateBytes += before.privateBytes + after.privateBytes;
    if (!Number.isSafeInteger(privateBytes)
      || privateBytes > config.maxPrivateBytes) return null;
    entries.push(Object.freeze({
      path: fields.get('path'),
      before: before.state,
      after: after.state,
    }));
  }
  const frozenEntries = Object.freeze(entries);
  const observedDigest = canonicalSha256Digest({
    schemaVersion: 'canary-local-inverse-patch.v1',
    promotionId: request.promotionId,
    sourceRootIdentityDigest: request.sourceRootIdentityDigest,
    entries: Object.freeze(frozenEntries.map((entry) => Object.freeze({
      path: entry.path,
      before: publicEntryMetadata(entry.before),
      after: publicEntryMetadata(entry.after),
    }))),
  });
  if (observedDigest !== inversePatchDigest) return null;
  return Object.freeze({
    entries: frozenEntries,
    inversePatchDigest,
    privateBytes,
  });
}

function normalizeStoredSourceAfter(value, request, promotionReceipt) {
  const fields = exactDataFields(value, SOURCE_AFTER_KEYS, { frozen: true });
  if (!fields || SOURCE_AFTER_KEYS.some((key) => (
    typeof fields.get(key) !== 'string' || !SAFE_DIGEST.test(fields.get(key))
  ))) return null;
  const output = Object.freeze(Object.fromEntries(
    SOURCE_AFTER_KEYS.map((key) => [key, fields.get(key)])
  ));
  if (output.sourceStateDigest !== promotionReceipt.sourceAfterDigest
    || output.branchHeadDigest !== promotionReceipt.branchHeadAfterDigest
    || output.gitIndexDigest !== promotionReceipt.gitIndexAfterDigest
    || output.userDirtyDigest !== promotionReceipt.userDirtyAfterDigest
    || output.branchHeadDigest !== request.branchHeadDigest
    || output.gitIndexDigest !== request.gitIndexDigest
    || output.userDirtyDigest !== request.userDirtyDigest) return null;
  return output;
}

function prepareInverse(sourceRoot, request, sourceState, stagingState, config) {
  const entries = [];
  let privateBytes = 0;
  for (let index = 0; index < request.changedPaths.length; index += 1) {
    const relativePath = request.changedPaths[index];
    const canonicalBefore = sourceState.tree.byPath.get(relativePath) || null;
    let before;
    if (!canonicalBefore) {
      before = Object.freeze({ kind: 'absent' });
    } else if (canonicalBefore.kind === 'directory') {
      before = Object.freeze({
        kind: 'directory',
        mode: canonicalBefore.mode,
      });
    } else if (canonicalBefore.kind === 'file') {
      const file = readRegularFile(sourceRoot, relativePath, { capture: true });
      if (file.mode !== canonicalBefore.mode || file.bytes !== canonicalBefore.bytes
        || file.contentDigest !== canonicalBefore.contentDigest) {
        physicalFail('source');
      }
      before = cloneStateRecord(file);
      privateBytes += before.bytes;
    } else {
      physicalFail('source');
    }
    const staged = stagingState.captured[index];
    const digestEntry = staged.digestEntry;
    const after = digestEntry.kind === 'directory'
      ? Object.freeze({ kind: 'directory', mode: digestEntry.mode })
      : {
        kind: 'file',
        mode: digestEntry.mode,
        bytes: digestEntry.bytes,
        contentDigest: digestEntry.contentDigest,
        content: Buffer.from(staged.content),
      };
    if (after.kind === 'file') privateBytes += after.bytes;
    if (privateBytes > config.maxPrivateBytes) physicalFail('staging');
    entries.push({ path: relativePath, before, after });
  }
  const inversePatchDigest = canonicalSha256Digest({
    schemaVersion: 'canary-local-inverse-patch.v1',
    promotionId: request.promotionId,
    sourceRootIdentityDigest: request.sourceRootIdentityDigest,
    entries: Object.freeze(entries.map((entry) => Object.freeze({
      path: entry.path,
      before: publicEntryMetadata(entry.before),
      after: publicEntryMetadata(entry.after),
    }))),
  });
  return Object.freeze({ entries, inversePatchDigest, privateBytes });
}

function currentStateRecord(root, relativePath) {
  const located = locateRelative(root, relativePath);
  if (located.missingParent || !located.target) {
    return Object.freeze({ kind: 'absent' });
  }
  if (located.target.kind === 'directory') {
    return Object.freeze({
      kind: 'directory',
      mode: permissionMode(located.target, root.scope),
      snapshot: located.target,
    });
  }
  if (located.target.kind !== 'file') physicalFail(root.scope);
  return readRegularFile(root, relativePath, { capture: true });
}

function sameEntryState(current, expected) {
  if (current.kind !== expected.kind) return false;
  if (current.kind === 'absent') return true;
  if (current.mode !== expected.mode) return false;
  return current.kind === 'directory'
    || current.bytes === expected.bytes
      && current.contentDigest === expected.contentDigest;
}

function assertAllEntries(root, inverse, direction) {
  for (const entry of inverse.entries) {
    if (!sameEntryState(
      currentStateRecord(root, entry.path),
      entry[direction]
    )) physicalFail(root.scope);
  }
}

function targetStillMatches(location, expected, scope) {
  const current = lstatOrNull(location, scope);
  if (!expected) return current === null;
  return current !== null && sameSnapshot(current, expected);
}

function fsyncDirectory(directoryPath) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function cleanupTemporary(root, temporaryPath, parentPath, parentIdentity) {
  assertBoundRoot(root);
  const parent = lstatOrNull(parentPath, root.scope);
  if (!parent || !sameIdentity(parent, parentIdentity)) physicalFail(root.scope);
  const temporary = lstatOrNull(temporaryPath, root.scope);
  if (!temporary) return;
  if (temporary.kind !== 'file') physicalFail(root.scope);
  try { fs.unlinkSync(temporaryPath); } catch { physicalFail(root.scope); }
}

function atomicWrite(root, relativePath, content, expectedSnapshot, mode) {
  const located = locateRelative(root, relativePath);
  if (located.missingParent || located.target && located.target.kind !== 'file'
    || !targetStillMatches(located.targetPath, expectedSnapshot, root.scope)
    || typeof fs.constants.O_NOFOLLOW !== 'number') physicalFail(root.scope);
  let descriptor = null;
  let temporaryPath = null;
  try {
    for (let attempt = 0; attempt < TEMP_FILE_ATTEMPTS; attempt += 1) {
      temporaryPath = path.join(
        located.parentPath,
        `.faber-canary-${crypto.randomBytes(12).toString('hex')}.tmp`
      );
      try {
        descriptor = fs.openSync(
          temporaryPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT
            | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
          0o600
        );
        break;
      } catch (error) {
        if (!error || errorCode(error) !== 'EEXIST') throw error;
      }
    }
    if (descriptor === null || !temporaryPath) physicalFail(root.scope);
    let offset = 0;
    while (offset < content.length) {
      const written = fs.writeSync(
        descriptor, content, offset, content.length - offset, null
      );
      if (!Number.isSafeInteger(written) || written <= 0) physicalFail(root.scope);
      offset += written;
    }
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    assertBoundRoot(root);
    const parent = lstatOrNull(located.parentPath, root.scope);
    if (!parent || !sameIdentity(parent, located.parentIdentity)
      || !targetStillMatches(
        located.targetPath, expectedSnapshot, root.scope
      )) physicalFail(root.scope);
    fs.renameSync(temporaryPath, located.targetPath);
    temporaryPath = null;
    fsyncDirectory(located.parentPath);
    const written = readRegularFile(root, relativePath, { capture: true });
    if (written.mode !== mode || written.bytes !== content.length
      || written.contentDigest !== bytesDigest(content)) physicalFail(root.scope);
  } catch (error) {
    if (error instanceof PhysicalStateError) throw error;
    physicalFail(root.scope);
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* handled by state proof */ }
    }
    if (temporaryPath) cleanupTemporary(
      root,
      temporaryPath,
      located.parentPath,
      located.parentIdentity
    );
  }
}

function removeCurrentEntry(root, relativePath, current) {
  const located = locateRelative(root, relativePath);
  if (located.missingParent || !located.target
    || current.snapshot && !sameSnapshot(located.target, current.snapshot)) {
    physicalFail(root.scope);
  }
  try {
    if (current.kind === 'file') fs.unlinkSync(located.targetPath);
    else if (current.kind === 'directory') fs.rmdirSync(located.targetPath);
    else physicalFail(root.scope);
    fsyncDirectory(located.parentPath);
  } catch (error) {
    if (error instanceof PhysicalStateError) throw error;
    physicalFail(root.scope);
  }
}

function applyDesiredState(root, entry, desiredKey, acceptableKey, {
  allowAlreadyDesired = true,
} = {}) {
  const desired = entry[desiredKey];
  const acceptable = entry[acceptableKey];
  const current = currentStateRecord(root, entry.path);
  if (sameEntryState(current, desired)) {
    if (allowAlreadyDesired) return;
    physicalFail(root.scope);
  }
  if (!sameEntryState(current, acceptable)) physicalFail(root.scope);
  if (desired.kind === 'absent') {
    removeCurrentEntry(root, entry.path, current);
    return;
  }
  if (desired.kind === 'directory') {
    if (current.kind !== 'absent') physicalFail(root.scope);
    const located = locateRelative(root, entry.path);
    if (located.missingParent || located.target) physicalFail(root.scope);
    try {
      fs.mkdirSync(located.targetPath, { mode: desired.mode });
      fs.chmodSync(located.targetPath, desired.mode);
      fsyncDirectory(located.parentPath);
    } catch { physicalFail(root.scope); }
    if (!sameEntryState(currentStateRecord(root, entry.path), desired)) {
      physicalFail(root.scope);
    }
    return;
  }
  atomicWrite(
    root,
    entry.path,
    desired.content,
    current.kind === 'file' ? current.snapshot : null,
    desired.mode
  );
}

function promotionOrder(entries) {
  const directories = entries.filter((entry) => entry.after.kind === 'directory')
    .sort((left, right) => left.path.split('/').length
      - right.path.split('/').length || left.path.localeCompare(right.path));
  const files = entries.filter((entry) => entry.after.kind === 'file')
    .sort((left, right) => left.path.localeCompare(right.path));
  return [...directories, ...files];
}

function applyPromotion(root, inverse, attempted) {
  for (const entry of promotionOrder(inverse.entries)) {
    attempted.push(entry);
    applyDesiredState(root, entry, 'after', 'before', {
      allowAlreadyDesired: false,
    });
  }
}

function restoreBaseline(root, inverse, attempted) {
  for (const entry of [...attempted].reverse()) {
    applyDesiredState(root, entry, 'before', 'after');
  }
}

function restoreAllBaseline(root, inverse) {
  for (const entry of [...promotionOrder(inverse.entries)].reverse()) {
    applyDesiredState(root, entry, 'before', 'after');
  }
}

function reapplyPromotedState(root, inverse) {
  for (const entry of promotionOrder(inverse.entries)) {
    applyDesiredState(root, entry, 'after', 'before');
  }
}

function validatePreWriteSource(state, request) {
  if (!sourceMatchesRequest(state, request)) {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT);
  }
}

function validatePreWriteStaging(state, request) {
  if (state.writeSetDigest !== request.writeSetDigest) {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.STAGING_CONFLICT);
  }
}

function capturePromotionRoots(request) {
  let sourceRoot;
  let workspaceRoot;
  try {
    sourceRoot = captureBoundRoot(
      request.sourceRootPath,
      request.sourceRealRootPath,
      request.sourceRootIdentityDigest,
      'source'
    );
  } catch {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT);
  }
  try {
    workspaceRoot = captureBoundRoot(
      request.workspaceRootPath,
      request.workspaceRealRootPath,
      request.workspaceRootIdentityDigest,
      'staging'
    );
  } catch {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.STAGING_CONFLICT);
  }
  if (pathsOverlap(sourceRoot.realPath, workspaceRoot.realPath)) {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.INVALID_INPUT);
  }
  return Object.freeze({ sourceRoot, workspaceRoot });
}

function preparePromotion(request, config) {
  const roots = capturePromotionRoots(request);
  let sourceFirst;
  let stagingFirst;
  try {
    sourceFirst = inspectSourceState(
      roots.sourceRoot, request, config.maxEntries
    );
    validatePreWriteSource(sourceFirst, request);
  } catch (error) {
    if (error instanceof CanaryLocalPromotionBackendError) throw error;
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT);
  }
  try {
    stagingFirst = inspectStagingWriteSet(roots.workspaceRoot, request);
    validatePreWriteStaging(stagingFirst, request);
  } catch (error) {
    if (error instanceof CanaryLocalPromotionBackendError) throw error;
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.STAGING_CONFLICT);
  }
  let inverse;
  try {
    inverse = prepareInverse(
      roots.sourceRoot, request, sourceFirst, stagingFirst, config
    );
  } catch (error) {
    if (error instanceof PhysicalStateError && error.scope === 'staging') {
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.STAGING_CONFLICT);
    }
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT);
  }
  let sourceSecond;
  let stagingSecond;
  try {
    sourceSecond = inspectSourceState(
      roots.sourceRoot, request, config.maxEntries
    );
    validatePreWriteSource(sourceSecond, request);
    if (!stateMatches(sourceFirst, sourceSecond)) {
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT);
    }
  } catch (error) {
    if (error instanceof CanaryLocalPromotionBackendError) throw error;
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT);
  }
  try {
    stagingSecond = inspectStagingWriteSet(roots.workspaceRoot, request);
    validatePreWriteStaging(stagingSecond, request);
    if (stagingFirst.writeSetDigest !== stagingSecond.writeSetDigest) {
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.STAGING_CONFLICT);
    }
  } catch (error) {
    if (error instanceof CanaryLocalPromotionBackendError) throw error;
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.STAGING_CONFLICT);
  }
  try {
    assertAllEntries(roots.sourceRoot, inverse, 'before');
    assertAllEntries(roots.workspaceRoot, Object.freeze({
      entries: inverse.entries.map((entry) => Object.freeze({
        path: entry.path,
        after: entry.after,
      })),
    }), 'after');
  } catch (error) {
    if (error instanceof PhysicalStateError && error.scope === 'staging') {
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.STAGING_CONFLICT);
    }
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT);
  }
  return Object.freeze({
    inverse,
    roots,
    sourceBefore: sourceSecond,
  });
}

function normalizePromotionRequest(value) {
  try { return assertCanaryPromotionBackendRequest(value); } catch {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.INVALID_INPUT);
  }
}

function normalizeRevertInput(value) {
  const fields = exactDataFields(value, REVERT_INPUT_KEYS, { frozen: true });
  const reason = fields && fields.get('reason');
  if (!fields || typeof reason !== 'string' || !SAFE_REASON.test(reason)) {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.INVALID_INPUT);
  }
  let request;
  let promotionReceipt;
  try {
    request = assertCanaryPromotionBackendRequest(fields.get('request'));
    promotionReceipt = assertCanaryPromotionReceipt(
      fields.get('promotionReceipt'), request
    );
  } catch {
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.INVALID_INPUT);
  }
  return Object.freeze({ request, promotionReceipt, reason });
}

function requestFingerprint(request) {
  return canonicalSha256Digest({
    schemaVersion: 'canary-local-promotion-request-fingerprint.v1',
    request,
  });
}

function receiptFingerprint(receipt) {
  return canonicalSha256Digest({
    schemaVersion: 'canary-local-promotion-receipt-fingerprint.v1',
    receipt,
  });
}

function verifyPromotedState(record, config) {
  assertAllEntries(record.roots.sourceRoot, record.inverse, 'after');
  const after = inspectSourceState(
    record.roots.sourceRoot, record.request, config.maxEntries
  );
  if (after.sourceStateDigest === record.request.sourceStateDigest
    || after.branchHeadDigest !== record.request.branchHeadDigest
    || after.gitIndexDigest !== record.request.gitIndexDigest
    || after.userDirtyDigest !== record.request.userDirtyDigest) {
    physicalFail('source');
  }
  return after;
}

function verifyBaseline(record, config) {
  assertAllEntries(record.roots.sourceRoot, record.inverse, 'before');
  const restored = inspectSourceState(
    record.roots.sourceRoot, record.request, config.maxEntries
  );
  if (!sourceMatchesRequest(restored, record.request)) physicalFail('source');
  return restored;
}

function normalizeRollbackRecovery(value, config) {
  const fields = exactDataFields(value, ROLLBACK_RECOVERY_KEYS, { frozen: true });
  if (!fields
    || fields.get('schemaVersion')
      !== CANARY_PROMOTION_ROLLBACK_RECOVERY_SCHEMA_VERSION
    || typeof fields.get('inversePatchDigest') !== 'string'
    || !SAFE_DIGEST.test(fields.get('inversePatchDigest'))) return null;
  let request;
  let receipt;
  try {
    request = assertCanaryPromotionBackendRequest(fields.get('request'));
    receipt = assertCanaryPromotionReceipt(
      fields.get('promotionReceipt'),
      request
    );
  } catch {
    return null;
  }
  const inversePatchDigest = fields.get('inversePatchDigest');
  if (receipt.inversePatchDigest !== inversePatchDigest) return null;
  const inverse = normalizeStoredInverse(
    fields.get('entries'),
    request,
    inversePatchDigest,
    config
  );
  const storedSourceAfter = normalizeStoredSourceAfter(
    fields.get('sourceAfter'),
    request,
    receipt
  );
  if (!inverse || !storedSourceAfter) return null;
  let sourceRoot;
  try {
    sourceRoot = captureBoundRoot(
      request.sourceRootPath,
      request.sourceRealRootPath,
      request.sourceRootIdentityDigest,
      'source'
    );
  } catch {
    return null;
  }
  const record = {
    fingerprint: requestFingerprint(request),
    request,
    state: 'promoted',
    receipt,
    revertReceipt: null,
    receiptFingerprint: receiptFingerprint(receipt),
    inverse,
    roots: Object.freeze({ sourceRoot }),
    sourceAfter: storedSourceAfter,
  };
  try {
    const observedSourceAfter = verifyPromotedState(record, config);
    if (!stateMatches(observedSourceAfter, storedSourceAfter)) return null;
    record.sourceAfter = observedSourceAfter;
  } catch {
    return null;
  }
  return record;
}

function hydrateRollbackRecoveries(config, promotions) {
  if (!config.rollbackStore) return;
  try {
    const snapshot = invokeRollbackStore(config.rollbackStore, 'load');
    const fields = exactDataFields(
      snapshot,
      ROLLBACK_STORE_SNAPSHOT_KEYS,
      { frozen: true }
    );
    const records = fields && frozenArrayValues(fields.get('records'), {
      maximum: config.maxPromotions,
    });
    if (!fields
      || fields.get('schemaVersion')
        !== CANARY_PROMOTION_ROLLBACK_STORE_SNAPSHOT_SCHEMA_VERSION
      || !records) {
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED);
    }
    for (const value of records) {
      const record = normalizeRollbackRecovery(value, config);
      if (!record || promotions.has(record.request.promotionId)) {
        fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED);
      }
      promotions.set(record.request.promotionId, record);
    }
  } catch (error) {
    if (error instanceof CanaryLocalPromotionBackendError
      && error.code
        === CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED) {
      throw error;
    }
    fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED);
  }
}

function createCanaryLocalPromotionBackend(options = {}) {
  const config = normalizeOptions(options);
  const promotions = new Map();
  hydrateRollbackRecoveries(config, promotions);

  function diagnostics() {
    return CANARY_LOCAL_PROMOTION_BACKEND_DIAGNOSTICS;
  }

  async function promote(value) {
    const request = normalizePromotionRequest(value);
    const fingerprint = requestFingerprint(request);
    const existing = promotions.get(request.promotionId);
    if (existing) {
      if (existing.state === 'ambiguous') {
        throw new CanaryPromotionBackendAmbiguousError();
      }
      if (existing.fingerprint !== fingerprint || existing.state !== 'promoted') {
        fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.REPLAY_MISMATCH);
      }
      return existing.receipt;
    }
    if (promotions.size >= config.maxPromotions) {
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.CAPACITY_EXCEEDED);
    }
    const record = {
      fingerprint,
      request,
      state: 'preparing',
      receipt: null,
      revertReceipt: null,
      receiptFingerprint: null,
    };
    promotions.set(request.promotionId, record);
    let prepared;
    try {
      prepared = preparePromotion(request, config);
    } catch (error) {
      promotions.delete(request.promotionId);
      if (error instanceof CanaryLocalPromotionBackendError) throw error;
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.SOURCE_CONFLICT);
    }
    Object.assign(record, prepared);
    if (config.rollbackStore) {
      try {
        invokeRollbackStore(
          config.rollbackStore,
          'prepare',
          rollbackPreparedRecord(request, record.inverse),
          { mutation: true }
        );
      } catch {
        try {
          invokeRollbackStore(
            config.rollbackStore,
            'cancel',
            rollbackCancelRecord(record),
            { mutation: true }
          );
        } catch {
          record.state = 'ambiguous';
          throw new CanaryPromotionBackendAmbiguousError();
        }
        promotions.delete(request.promotionId);
        fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED);
      }
    }
    record.state = 'promoting';
    const attempted = [];
    try {
      applyPromotion(record.roots.sourceRoot, record.inverse, attempted);
      record.sourceAfter = verifyPromotedState(record, config);
      record.receipt = createCanaryPromotionReceipt({
        request,
        sourceAfterDigest: record.sourceAfter.sourceStateDigest,
        inversePatchDigest: record.inverse.inversePatchDigest,
        branchHeadAfterDigest: record.sourceAfter.branchHeadDigest,
        gitIndexAfterDigest: record.sourceAfter.gitIndexDigest,
        userDirtyAfterDigest: record.sourceAfter.userDirtyDigest,
        conflictChecked: true,
        sourceMutated: true,
        promotionApplied: true,
      });
      record.receiptFingerprint = receiptFingerprint(record.receipt);
      if (config.rollbackStore) {
        invokeRollbackStore(
          config.rollbackStore,
          'commit',
          rollbackCommitRecord(record),
          { mutation: true }
        );
      }
      record.state = 'promoted';
      return record.receipt;
    } catch (error) {
      const failureCode = error instanceof CanaryLocalPromotionBackendError
        && error.code
          === CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED
        ? CANARY_LOCAL_PROMOTION_BACKEND_REASONS.ROLLBACK_STORE_FAILED
        : CANARY_LOCAL_PROMOTION_BACKEND_REASONS.WRITE_FAILED;
      try {
        restoreBaseline(record.roots.sourceRoot, record.inverse, attempted);
        verifyBaseline(record, config);
      } catch {
        record.state = 'ambiguous';
        throw new CanaryPromotionBackendAmbiguousError();
      }
      if (config.rollbackStore) {
        try {
          invokeRollbackStore(
            config.rollbackStore,
            'cancel',
            rollbackCancelRecord(record),
            { mutation: true }
          );
        } catch {
          record.state = 'ambiguous';
          throw new CanaryPromotionBackendAmbiguousError();
        }
      }
      promotions.delete(request.promotionId);
      fail(failureCode);
    }
  }

  async function revert(value) {
    const input = normalizeRevertInput(value);
    const fingerprint = requestFingerprint(input.request);
    const record = promotions.get(input.request.promotionId);
    if (!record || record.fingerprint !== fingerprint
      || record.receiptFingerprint !== receiptFingerprint(input.promotionReceipt)) {
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.REPLAY_MISMATCH);
    }
    if (record.state === 'reverted') return record.revertReceipt;
    if (record.state !== 'promoted') {
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.REPLAY_MISMATCH);
    }
    try {
      const current = inspectSourceState(
        record.roots.sourceRoot, record.request, config.maxEntries
      );
      assertAllEntries(record.roots.sourceRoot, record.inverse, 'after');
      if (!stateMatches(current, record.sourceAfter)) {
        fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.REVERT_CONFLICT);
      }
    } catch (error) {
      if (error instanceof CanaryLocalPromotionBackendError) throw error;
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.REVERT_CONFLICT);
    }
    record.state = 'reverting';
    try {
      restoreAllBaseline(record.roots.sourceRoot, record.inverse);
      const restored = verifyBaseline(record, config);
      record.revertReceipt = createCanaryPromotionRevertReceipt({
        request: record.request,
        promotionReceipt: record.receipt,
        sourceRestoredDigest: restored.sourceStateDigest,
        branchHeadAfterDigest: restored.branchHeadDigest,
        gitIndexAfterDigest: restored.gitIndexDigest,
        userDirtyAfterDigest: restored.userDirtyDigest,
        inversePatchApplied: true,
        sourceRestored: true,
      });
      if (config.rollbackStore) {
        invokeRollbackStore(
          config.rollbackStore,
          'settle',
          rollbackSettlementRecord(record),
          { mutation: true }
        );
      }
      record.state = 'reverted';
      return record.revertReceipt;
    } catch {
      try {
        reapplyPromotedState(record.roots.sourceRoot, record.inverse);
        const reapplied = verifyPromotedState(record, config);
        if (!stateMatches(reapplied, record.sourceAfter)) physicalFail('source');
      } catch {
        record.state = 'ambiguous';
        throw new CanaryPromotionBackendAmbiguousError();
      }
      record.state = 'promoted';
      fail(CANARY_LOCAL_PROMOTION_BACKEND_REASONS.REVERT_FAILED);
    }
  }

  return Object.freeze({
    version: CANARY_LOCAL_PROMOTION_BACKEND_VERSION,
    promote,
    revert,
    diagnostics,
  });
}

module.exports = {
  CANARY_LOCAL_PROMOTION_BACKEND_REASONS,
  CANARY_LOCAL_PROMOTION_BACKEND_VERSION,
  CanaryLocalPromotionBackendError,
  createCanaryLocalPromotionBackend,
};
