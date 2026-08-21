'use strict';

const defaultCrypto = require('crypto');
const defaultFs = require('fs');
const defaultPath = require('path');

const {
  TRANSACTIONAL_DELETE_ENTRY_KINDS,
  TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES,
  TRANSACTIONAL_DELETE_STATES,
  assertTransactionalDeletePlan,
  canonicalSha256Digest,
  createTransactionalDeleteCheckpointManifest,
  createTransactionalDeletePlan,
  createTransactionalDeletePublicRequest,
  createTransactionalDeletePublicResult,
  createTransactionalDeleteStateRecord,
  isProtectedTransactionalDeletePath,
} = require('../capabilities/transactional_delete_contracts');
const {
  createTransactionalDeleteJournalRecord,
  verifyTransactionalDeleteJournalChain,
} = require('../capabilities/transactional_delete_journal_contract');
const {
  CAPABILITY_DELEGATION_EFFECTS,
  HARD_MAX_DELEGATION_CONSTRAINTS,
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('../capabilities/capability_delegation_contracts');
const {
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  assertAnchoredFilesystemMutationNamespaceSession,
  assertAnchoredFilesystemMutationProbe,
  assertAnchoredFilesystemMutationRootNamespace,
  createUnsupportedAnchoredFilesystemMutationBackend,
} = require('../capabilities/anchored_filesystem_mutation_backend_contract');

const TRANSACTIONAL_FILESYSTEM_DELETE_SERVICE_VERSION =
  'transactional-filesystem-delete-service.v2';
const PRIVATE_MANIFEST_SCHEMA_VERSION = 'transactional-delete.private-manifest.v1';
const PRIVATE_JOURNAL_SCHEMA_VERSION = 'transactional-delete.private-journal.v1';
const PRIVATE_JOURNAL_RECORD_SCHEMA_VERSION = 'transactional-delete.private-state.v1';
const PRIVATE_HEAD_SCHEMA_VERSION = 'transactional-delete.private-head.v1';
const JOURNAL_AUTHENTICATOR_VERSION = 'transactional-delete.hmac-sha256.v1';
const MAX_PRIVATE_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_PRIVATE_NAMESPACE_LIST_ENTRIES = 512;
const MAX_ROOT_TRANSACTIONS = 192;
const MAX_DIRECTORY_SCAN_DEPTH = 256;
const SAFE_TRANSACTION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const TERMINAL_SUCCESS = new Set(['success', 'completed']);
const TERMINAL_ROLLBACK = new Set([
  'failed',
  'cancelled',
  'canceled',
  'runtime_interrupted',
  'interrupted',
]);

class TransactionalFilesystemDeleteError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'TransactionalFilesystemDeleteError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TransactionalFilesystemDeleteError(code, message);
}

function absorbNativePromise(value) {
  try {
    Promise.prototype.then.call(value, undefined, () => undefined);
  } catch {}
}

function isPromiseLike(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  // Never execute an attacker-controlled `then` getter merely to decide
  // whether a trust-boundary result is asynchronous. A getter is itself
  // treated as thenable and therefore rejected by the synchronous contract.
  try {
    let candidate = value;
    while (candidate) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, 'then');
      if (descriptor) {
        const thenable = Object.hasOwn(descriptor, 'get')
          || (Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function');
        if (thenable && Object.hasOwn(descriptor, 'value')) absorbNativePromise(value);
        return thenable;
      }
      candidate = Object.getPrototypeOf(candidate);
    }
  } catch {
    return true;
  }
  return false;
}

function isPlainDataRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor)
      && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      && descriptor.value !== undefined;
  });
}

function dataValue(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function assertExactKeys(value, allowed, required, fieldName) {
  if (!isPlainDataRecord(value)) fail('INVALID_INPUT', `${fieldName} must be plain data`);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))
    || required.some((key) => !keys.includes(key))) {
    fail('INVALID_INPUT', `${fieldName} has unsupported fields`);
  }
  return value;
}

function sha256Buffer(cryptoImpl, buffer) {
  return `sha256:${cryptoImpl.createHash('sha256').update(buffer).digest('hex')}`;
}

function sameBinding(left, right) {
  return left.projectId === right.projectId
    && left.canonicalRootPath === right.canonicalRootPath
    && left.realRootPath === right.realRootPath
    && left.sessionId === right.sessionId
    && left.jobId === right.jobId
    && left.kernelId === right.kernelId
    && left.submissionDigest === right.submissionDigest;
}

function compareStatIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function lstatExists(fs, entryPath) {
  try {
    fs.lstatSync(entryPath);
    return true;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
}

function entryKind(stat) {
  if (stat.isSymbolicLink()) return TRANSACTIONAL_DELETE_ENTRY_KINDS.SYMLINK;
  if (stat.isFile()) return TRANSACTIONAL_DELETE_ENTRY_KINDS.FILE;
  if (stat.isDirectory()) return TRANSACTIONAL_DELETE_ENTRY_KINDS.DIRECTORY;
  fail('SPECIAL_FILE_REJECTED', 'Only regular files, directories, and symlinks may be deleted');
}

function createUnavailableDeleteJournalAuthenticator() {
  return Object.freeze({
    version: JOURNAL_AUTHENTICATOR_VERSION,
    seal() {
      fail(
        'JOURNAL_AUTHENTICATOR_REQUIRED',
        'An external main-owned journal authenticator is required'
      );
    },
    verify() { return false; },
  });
}

function createTransactionalFilesystemDeleteService(options = {}) {
  assertExactKeys(
    options,
    [
      'fs',
      'path',
      'crypto',
      'now',
      'transactionIdFactory',
      'authorizeLifecycle',
      'authorizeRoot',
      'authorizeEffectFrontier',
      'journalAuthenticator',
      'mutationBackend',
    ],
    ['authorizeLifecycle', 'authorizeRoot', 'authorizeEffectFrontier'],
    'transactional delete options'
  );
  const fs = dataValue(options, 'fs') || defaultFs;
  const path = dataValue(options, 'path') || defaultPath;
  const crypto = dataValue(options, 'crypto') || defaultCrypto;
  const now = dataValue(options, 'now') || Date.now;
  const transactionIdFactory = dataValue(options, 'transactionIdFactory')
    || (() => crypto.randomUUID());
  const authorizeLifecycle = dataValue(options, 'authorizeLifecycle');
  const authorizeRoot = dataValue(options, 'authorizeRoot');
  const authorizeEffectFrontier = dataValue(options, 'authorizeEffectFrontier');
  const hasExternalJournalAuthenticator = Object.hasOwn(options, 'journalAuthenticator');
  const journalAuthenticator = hasExternalJournalAuthenticator
    ? dataValue(options, 'journalAuthenticator')
    : createUnavailableDeleteJournalAuthenticator();
  const mutationBackend = dataValue(options, 'mutationBackend')
    || createUnsupportedAnchoredFilesystemMutationBackend({});
  for (const [name, callback] of [
    ['now', now],
    ['transactionIdFactory', transactionIdFactory],
    ['authorizeLifecycle', authorizeLifecycle],
    ['authorizeRoot', authorizeRoot],
    ['authorizeEffectFrontier', authorizeEffectFrontier],
  ]) {
    if (typeof callback !== 'function') fail('INVALID_OPTIONS', `${name} must be a function`);
  }
  for (const name of ['seal', 'verify']) {
    if (!journalAuthenticator || typeof journalAuthenticator[name] !== 'function') {
      fail('INVALID_OPTIONS', `journalAuthenticator.${name} must be a function`);
    }
  }
  let initialMutationProbe;
  try {
    if (!mutationBackend || typeof mutationBackend !== 'object' || Array.isArray(mutationBackend)) {
      throw new TypeError('backend required');
    }
    for (const method of ['probe', 'prepare']) {
      const descriptor = Object.getOwnPropertyDescriptor(mutationBackend, method);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function') {
        throw new TypeError(`mutationBackend.${method} is required`);
      }
    }
    const probe = Object.getOwnPropertyDescriptor(mutationBackend, 'probe').value
      .call(mutationBackend);
    if (isPromiseLike(probe)) throw new TypeError('probe must be synchronous');
    initialMutationProbe = assertAnchoredFilesystemMutationProbe(probe);
  } catch {
    fail('INVALID_OPTIONS', 'mutationBackend must satisfy the anchored mutation contract');
  }
  function backendSupportsNamespaceIo() {
    const descriptor = Object.getOwnPropertyDescriptor(mutationBackend, 'namespaceIoVersion');
    return Boolean(descriptor)
      && Object.hasOwn(descriptor, 'value')
      && descriptor.value === ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION;
  }
  function backendHasRootNamespace() {
    const descriptor = Object.getOwnPropertyDescriptor(mutationBackend, 'openRootNamespace');
    return Boolean(descriptor)
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'function';
  }
  if (initialMutationProbe.state === ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED
    && !hasExternalJournalAuthenticator) {
    fail(
      'JOURNAL_AUTHENTICATOR_REQUIRED',
      'An enforced mutation backend requires an external main-owned journal authenticator'
    );
  }
  if (initialMutationProbe.state === ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED
    && (!backendSupportsNamespaceIo() || !backendHasRootNamespace())) {
    fail(
      'INVALID_OPTIONS',
      'An enforced mutation backend requires anchored namespace I/O v2'
    );
  }

  function readMutationProbe({ requireEnforced = false } = {}) {
    let probe;
    try { probe = mutationBackend.probe(); } catch {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'The anchored mutation backend probe failed');
    }
    if (isPromiseLike(probe)) {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'The anchored mutation backend probe is async');
    }
    try {
      const normalized = assertAnchoredFilesystemMutationProbe(probe, { requireEnforced });
      if (normalized.state === ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED
        && !hasExternalJournalAuthenticator) {
        fail(
          'JOURNAL_AUTHENTICATOR_REQUIRED',
          'An enforced mutation backend requires an external main-owned journal authenticator'
        );
      }
      if (normalized.state === ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED
        && (!backendSupportsNamespaceIo() || !backendHasRootNamespace())) {
        fail(
          'ATOMIC_MUTATION_BACKEND_UNAVAILABLE',
          'Anchored namespace I/O v2 is unavailable'
        );
      }
      return normalized;
    } catch {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'An enforced anchored mutation backend is required');
    }
  }

  const transactionsById = new Map();
  const transactionIdsByJob = new Map();
  const busyRoots = new Set();
  let completedTransactions = 0;
  let recoveryRequiredTransactions = 0;

  function readNow() {
    const value = now();
    if (isPromiseLike(value)
      || typeof value !== 'number'
      || !Number.isFinite(value)
      || value < 0
      || Object.is(value, -0)) {
      fail('CLOCK_INVALID', 'The transactional clock is invalid');
    }
    return value;
  }

  function denseDataValues(value, fieldName) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      fail('JOURNAL_INVALID', `${fieldName} must be a dense array`);
    }
    const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      fail('JOURNAL_INVALID', `${fieldName} must be a dense array`);
    }
    return keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        fail('JOURNAL_INVALID', `${fieldName} must contain data values`);
      }
      return descriptor.value;
    });
  }

  function namespaceMethod(namespace, name, errorCode = 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE') {
    if (!namespace || typeof namespace !== 'object' || Array.isArray(namespace)) {
      fail(errorCode, 'The anchored private namespace is unavailable');
    }
    const descriptor = Object.getOwnPropertyDescriptor(namespace, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function') {
      fail(errorCode, `The anchored private namespace omitted ${name}`);
    }
    return descriptor.value;
  }

  function invokeNamespace(namespace, name, input, errorCode = 'JOURNAL_INVALID') {
    let result;
    try {
      result = namespaceMethod(namespace, name, errorCode).call(namespace, input);
    } catch (error) {
      if (error instanceof TransactionalFilesystemDeleteError) throw error;
      fail(errorCode, `Anchored namespace ${name} failed`);
    }
    if (isPromiseLike(result) || !isPlainDataRecord(result)) {
      fail(errorCode, `Anchored namespace ${name} returned invalid data`);
    }
    return result;
  }

  function readNamespaceJson(
    namespace,
    relativePath,
    { optional = false, includeContentDigest = false } = {}
  ) {
    const result = invokeNamespace(namespace, 'readFile', Object.freeze({
      relativePath,
      maxBytes: MAX_PRIVATE_METADATA_BYTES,
    }));
    if (dataValue(result, 'found') !== true) {
      if (optional && dataValue(result, 'found') === false) return null;
      fail('JOURNAL_INVALID', 'Transaction metadata is missing');
    }
    const contentBase64 = dataValue(result, 'contentBase64');
    const contentDigest = dataValue(result, 'contentDigest');
    if (typeof contentBase64 !== 'string' || typeof contentDigest !== 'string') {
      fail('JOURNAL_INVALID', 'Transaction metadata is unreadable');
    }
    let bytes;
    try { bytes = Buffer.from(contentBase64, 'base64'); } catch {
      fail('JOURNAL_INVALID', 'Transaction metadata is unreadable');
    }
    if (bytes.length < 2
      || bytes.length > MAX_PRIVATE_METADATA_BYTES
      || bytes.toString('base64') !== contentBase64
      || sha256Buffer(crypto, bytes) !== contentDigest) {
      fail('JOURNAL_INVALID', 'Transaction metadata failed integrity checks');
    }
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch {
      fail('JOURNAL_INVALID', 'Transaction metadata is unreadable');
    }
    return includeContentDigest
      ? Object.freeze({ value, contentDigest })
      : value;
  }

  function listNamespace(namespace, relativePath, maxEntries = MAX_PRIVATE_NAMESPACE_LIST_ENTRIES) {
    const result = invokeNamespace(namespace, 'list', Object.freeze({
      relativePath,
      maxEntries,
    }));
    const entries = denseDataValues(dataValue(result, 'entries'), 'anchored namespace entries');
    if (entries.length > maxEntries || entries.some((entry) => (
      typeof entry !== 'string'
      || !entry
      || entry.startsWith('/')
      || entry.includes('\\')
      || entry.split('/').some((component) => !component || component === '.' || component === '..')
    ))) {
      fail('JOURNAL_INVALID', 'Anchored namespace listing is invalid');
    }
    return entries;
  }

  function writeNamespaceJson(namespace, relativePath, value) {
    let bytes;
    try { bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'); } catch {
      fail('CHECKPOINT_CREATE_FAILED', 'Transaction metadata is not serializable');
    }
    if (bytes.length < 2 || bytes.length > MAX_PRIVATE_METADATA_BYTES) {
      fail('CHECKPOINT_CREATE_FAILED', 'Transaction metadata exceeded its bound');
    }
    const contentDigest = sha256Buffer(crypto, bytes);
    const written = invokeNamespace(namespace, 'writeFile', Object.freeze({
      relativePath,
      contentBase64: bytes.toString('base64'),
      contentDigest,
      mode: 'replace_atomic',
    }), 'CHECKPOINT_CREATE_FAILED');
    if (dataValue(written, 'written') !== true
      || dataValue(written, 'contentDigest') !== contentDigest) {
      fail('CHECKPOINT_CREATE_FAILED', 'Anchored namespace write was not durable');
    }
    const synced = invokeNamespace(
      namespace,
      'sync',
      undefined,
      'CHECKPOINT_CREATE_FAILED'
    );
    if (dataValue(synced, 'synced') !== true) {
      fail('CHECKPOINT_CREATE_FAILED', 'Anchored namespace sync failed');
    }
  }

  function removeNamespaceEntry(namespace, relativePath, recursive) {
    const removed = invokeNamespace(namespace, 'remove', Object.freeze({
      relativePath,
      recursive,
    }), 'PURGE_FAILED');
    if (dataValue(removed, 'removed') !== true) {
      fail('PURGE_FAILED', 'Anchored namespace removal failed');
    }
  }

  function authenticationIsValid(rootPath, value, authenticationTag) {
    let verified;
    try { verified = journalAuthenticator.verify(rootPath, value, authenticationTag); } catch {
      return false;
    }
    return !isPromiseLike(verified) && verified === true;
  }

  function sessionOpenInput(transaction) {
    return Object.freeze({
      rootPath: transaction.binding.realRootPath,
      transactionPath: transaction.transactionPath,
      payloadPath: transaction.payloadPath,
      headPath: transaction.headPath,
      anchorPath: transaction.anchorPath,
      bindingDigest: transaction.bindingDigest,
      checkpointDigest: transaction.checkpointManifest.checkpointDigest,
      targets: Object.freeze(transaction.targets.map((target) => Object.freeze({
        relativePath: target.relativePath,
        payloadName: target.payloadName,
      }))),
      checkpointEntries: Object.freeze(
        transaction.checkpointManifest.entries.map((entry) => Object.freeze({
          relativePath: entry.relativePath,
          kind: entry.kind,
          bytes: entry.bytes,
          mode: entry.mode,
          mtimeMs: entry.mtimeMs,
          contentDigest: entry.contentDigest,
          linkTarget: entry.linkTarget,
        }))
      ),
    });
  }

  function existingSessionOpenInput(transaction) {
    const live = sessionOpenInput(transaction);
    return Object.freeze({
      transactionPath: live.transactionPath,
      payloadPath: live.payloadPath,
      headPath: live.headPath,
      anchorPath: live.anchorPath,
      bindingDigest: live.bindingDigest,
      checkpointDigest: live.checkpointDigest,
      manifestDigest: transaction.manifest.manifestDigest,
      journalDigest: transaction.journal.journalDigest,
      targets: live.targets,
      checkpointEntries: live.checkpointEntries,
    });
  }

  function prepareMutationSession(transaction, openSession = null) {
    readMutationProbe({ requireEnforced: true });
    let session;
    try {
      const opener = openSession
        || Object.getOwnPropertyDescriptor(mutationBackend, 'prepare').value.bind(mutationBackend);
      session = opener(openSession
        ? existingSessionOpenInput(transaction)
        : sessionOpenInput(transaction));
    } catch (error) {
      fail(
        error && error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'
          ? error.code
          : 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE',
        'Unable to prepare an anchored mutation session'
      );
    }
    if (isPromiseLike(session)) {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Anchored mutation session creation must be synchronous');
    }
    try {
      const normalized = assertAnchoredFilesystemMutationNamespaceSession(session);
      const namespaceDescriptor = Object.getOwnPropertyDescriptor(normalized, 'privateNamespace');
      if (!namespaceDescriptor || !Object.hasOwn(namespaceDescriptor, 'value')) {
        throw new TypeError('session private namespace required');
      }
      for (const method of ['readFile', 'list', 'writeFile', 'remove', 'sync']) {
        namespaceMethod(namespaceDescriptor.value, method);
      }
      return normalized;
    } catch {
      // A backend may have opened descriptors before returning a malformed
      // session. Do not leak those handles merely because validation failed.
      try {
        const closeDescriptor = session && typeof session === 'object'
          ? Object.getOwnPropertyDescriptor(session, 'close')
          : null;
        if (closeDescriptor && Object.hasOwn(closeDescriptor, 'value')
          && typeof closeDescriptor.value === 'function') {
          closeDescriptor.value.call(session);
        }
      } catch {}
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'The anchored mutation session is invalid');
    }
  }

  function verifyMutationSession(transaction) {
    let result;
    try {
      result = transaction.mutationSession.verify(Object.freeze({
        checkpointDigest: transaction.checkpointManifest.checkpointDigest,
      }));
    } catch {
      fail('ANCHORED_TARGET_INVALIDATED', 'The anchored delete targets changed');
    }
    if (isPromiseLike(result) || !isPlainDataRecord(result)
      || dataValue(result, 'verified') !== true) {
      fail('ANCHORED_TARGET_INVALIDATED', 'The anchored delete targets changed');
    }
  }

  function closeMutationSession(transaction) {
    if (!transaction.mutationSession || transaction.mutationSessionClosed) return;
    let result;
    try { result = transaction.mutationSession.close(); } catch {
      fail('MUTATION_SESSION_CLOSE_FAILED', 'The anchored mutation session did not close');
    }
    if (isPromiseLike(result) || !isPlainDataRecord(result)
      || dataValue(result, 'closed') !== true) {
      fail('MUTATION_SESSION_CLOSE_FAILED', 'The anchored mutation session did not close');
    }
    transaction.mutationSessionClosed = true;
  }

  function runForRoot(realRootPath, callback) {
    const key = path.resolve(realRootPath);
    if (busyRoots.has(key)) fail('ROOT_BUSY', 'A delete transaction is already mutating this root');
    busyRoots.add(key);
    try {
      return callback();
    } finally {
      busyRoots.delete(key);
    }
  }

  function invokeAuthority(callback, binding, kind) {
    let result;
    try {
      result = callback(binding);
    } catch {
      fail(`${kind}_INVALIDATED`, `${kind} authorization failed`);
    }
    if (isPromiseLike(result) || !isPlainDataRecord(result)
      || dataValue(result, 'authorized') !== true) {
      fail(`${kind}_INVALIDATED`, `${kind} authorization failed`);
    }
    const returnedBinding = dataValue(result, 'binding');
    if (returnedBinding !== undefined) {
      let normalized;
      try { normalized = createCapabilityDelegationBinding(returnedBinding); } catch {
        fail(`${kind}_INVALIDATED`, `${kind} authorization failed`);
      }
      if (!sameBinding(binding, normalized)) {
        fail(`${kind}_INVALIDATED`, `${kind} authorization changed`);
      }
    } else if (kind === 'ROOT') {
      if (dataValue(result, 'projectId') !== binding.projectId
        || dataValue(result, 'canonicalRootPath') !== binding.canonicalRootPath
        || dataValue(result, 'realRootPath') !== binding.realRootPath) {
        fail('ROOT_INVALIDATED', 'Root authorization changed');
      }
    } else {
      fail('LIFECYCLE_INVALIDATED', 'Lifecycle authorization omitted its binding');
    }
  }

  function authorize(binding) {
    invokeAuthority(authorizeRoot, binding, 'ROOT');
    invokeAuthority(authorizeLifecycle, binding, 'LIFECYCLE');
    let rootStat;
    let physicalRoot;
    try {
      rootStat = fs.lstatSync(binding.realRootPath);
      physicalRoot = fs.realpathSync(binding.realRootPath);
    } catch {
      fail('ROOT_INVALIDATED', 'The project root is unavailable');
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
      || path.resolve(physicalRoot) !== path.resolve(binding.realRootPath)) {
      fail('ROOT_INVALIDATED', 'The physical project root changed');
    }
  }

  function authorizeFinalFrontier(binding) {
    invokeAuthority(authorizeEffectFrontier, binding, 'EFFECT_FRONTIER');
  }

  function safeTransactionId() {
    let candidate;
    try { candidate = transactionIdFactory(); } catch {
      fail('TRANSACTION_ID_INVALID', 'Unable to allocate a transaction');
    }
    if (isPromiseLike(candidate)
      || typeof candidate !== 'string'
      || !SAFE_TRANSACTION_ID.test(candidate)) {
      fail('TRANSACTION_ID_INVALID', 'Unable to allocate a transaction');
    }
    return candidate;
  }

  function assertSafeAncestors(rootPath, relativePath) {
    const components = relativePath.split('/');
    let current = rootPath;
    for (let index = 0; index < components.length - 1; index += 1) {
      current = path.join(current, components[index]);
      let stat;
      try { stat = fs.lstatSync(current); } catch {
        fail('TARGET_NOT_FOUND', 'A delete target does not exist');
      }
      if (stat.isSymbolicLink()) {
        fail('ANCESTOR_SYMLINK_REJECTED', 'A delete target has a symlink ancestor');
      }
      if (!stat.isDirectory()) fail('TARGET_NOT_FOUND', 'A delete target ancestor is not a directory');
    }
  }

  function readRegularFile(absPath, firstStat) {
    let descriptor;
    try {
      const noFollow = fs.constants.O_NOFOLLOW || 0;
      descriptor = fs.openSync(absPath, fs.constants.O_RDONLY | noFollow);
      const openedStat = fs.fstatSync(descriptor);
      if (!openedStat.isFile() || !compareStatIdentity(firstStat, openedStat)) {
        fail('TARGET_CHANGED', 'A delete target changed while it was inspected');
      }
      const bytes = fs.readFileSync(descriptor);
      const finalStat = fs.fstatSync(descriptor);
      if (!compareStatIdentity(openedStat, finalStat)) {
        fail('TARGET_CHANGED', 'A delete target changed while it was inspected');
      }
      return bytes;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  function scanEntry(
    rootPath,
    relativePath,
    entries,
    physicalIdentities = new Set(),
    budget = { files: 0, bytes: 0, directories: 0 },
    depth = 0
  ) {
    if (depth > MAX_DIRECTORY_SCAN_DEPTH) {
      fail('SCAN_DEPTH_EXCEEDED', 'The delete target tree is too deeply nested');
    }
    if (isProtectedTransactionalDeletePath(relativePath, 'posix')) {
      fail('PROTECTED_PATH_REJECTED', 'A protected project path cannot be deleted');
    }
    const absPath = path.join(rootPath, ...relativePath.split('/'));
    let stat;
    try { stat = fs.lstatSync(absPath); } catch {
      fail('TARGET_NOT_FOUND', 'A delete target does not exist');
    }
    const physicalIdentity = `${String(stat.dev)}:${String(stat.ino)}`;
    if (physicalIdentities.has(physicalIdentity)) {
      fail('TARGET_ALIAS_REJECTED', 'Delete targets contain the same physical entry twice');
    }
    physicalIdentities.add(physicalIdentity);
    const kind = entryKind(stat);
    if (kind === TRANSACTIONAL_DELETE_ENTRY_KINDS.FILE) {
      budget.files += 1;
      if (budget.files > HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision
        || stat.size > HARD_MAX_DELEGATION_CONSTRAINTS.maxBytesPerDecision
        || budget.bytes + stat.size > HARD_MAX_DELEGATION_CONSTRAINTS.maxBytesPerDecision) {
        fail('DELETE_IMPACT_CAP_EXCEEDED', 'The delete impact exceeds hard caps');
      }
      const bytes = readRegularFile(absPath, stat);
      budget.bytes += bytes.length;
      entries.push({
        relativePath,
        kind,
        bytes: bytes.length,
        mode: stat.mode & 0o7777,
        mtimeMs: stat.mtimeMs,
        contentDigest: sha256Buffer(crypto, bytes),
        linkTarget: null,
      });
      return;
    }
    if (kind === TRANSACTIONAL_DELETE_ENTRY_KINDS.SYMLINK) {
      budget.files += 1;
      if (budget.files > HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision) {
        fail('DELETE_IMPACT_CAP_EXCEEDED', 'The delete impact exceeds hard caps');
      }
      let linkTarget;
      try { linkTarget = fs.readlinkSync(absPath); } catch {
        fail('TARGET_CHANGED', 'A symlink target changed while it was inspected');
      }
      const finalStat = fs.lstatSync(absPath);
      if (!compareStatIdentity(stat, finalStat) || !finalStat.isSymbolicLink()) {
        fail('TARGET_CHANGED', 'A symlink target changed while it was inspected');
      }
      const bytes = Buffer.from(linkTarget, 'utf8');
      if (budget.bytes + bytes.length > HARD_MAX_DELEGATION_CONSTRAINTS.maxBytesPerDecision) {
        fail('DELETE_IMPACT_CAP_EXCEEDED', 'The delete impact exceeds hard caps');
      }
      budget.bytes += bytes.length;
      entries.push({
        relativePath,
        kind,
        bytes: bytes.length,
        mode: stat.mode & 0o7777,
        mtimeMs: stat.mtimeMs,
        contentDigest: sha256Buffer(crypto, bytes),
        linkTarget,
      });
      return;
    }

    budget.directories += 1;
    if (budget.directories > HARD_MAX_DELEGATION_CONSTRAINTS.maxDirectoriesPerDecision) {
      fail('DELETE_IMPACT_CAP_EXCEEDED', 'The delete impact exceeds hard caps');
    }
    entries.push({
      relativePath,
      kind,
      bytes: 0,
      mode: stat.mode & 0o7777,
      mtimeMs: stat.mtimeMs,
      contentDigest: null,
      linkTarget: null,
    });
    let names;
    try { names = fs.readdirSync(absPath).sort(); } catch {
      fail('TARGET_CHANGED', 'A directory target changed while it was inspected');
    }
    for (const name of names) {
      scanEntry(
        rootPath,
        `${relativePath}/${name}`,
        entries,
        physicalIdentities,
        budget,
        depth + 1
      );
    }
    let finalStat;
    try { finalStat = fs.lstatSync(absPath); } catch {
      fail('TARGET_CHANGED', 'A directory target changed while it was inspected');
    }
    if (!finalStat.isDirectory() || finalStat.isSymbolicLink()
      || finalStat.dev !== stat.dev || finalStat.ino !== stat.ino) {
      fail('TARGET_CHANGED', 'A directory target changed while it was inspected');
    }
  }

  function scanTargets(binding, request, pathStyle, caseSensitive, createdAt) {
    if (pathStyle !== 'posix' && path.sep === '/') {
      fail('PATH_STYLE_UNSUPPORTED', 'The requested path style is not supported on this host');
    }
    const entries = [];
    const directEntries = [];
    const physicalIdentities = new Set();
    const budget = { files: 0, bytes: 0, directories: 0 };
    for (const relativePath of request.paths) {
      assertSafeAncestors(binding.realRootPath, relativePath);
      const before = entries.length;
      scanEntry(
        binding.realRootPath,
        relativePath,
        entries,
        physicalIdentities,
        budget,
        0
      );
      directEntries.push({ relativePath, kind: entries[before].kind });
    }
    const files = entries.filter((entry) => entry.kind !== 'directory').length;
    const directories = entries.length - files;
    const bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
    const impact = { files, bytes, directories };
    const plan = createTransactionalDeletePlan({
      request,
      pathStyle,
      caseSensitive,
      entries: directEntries,
      impact,
    });
    const checkpointManifest = createTransactionalDeleteCheckpointManifest({
      plan,
      entries,
      createdAt,
    });
    return { plan, checkpointManifest };
  }

  function privateManifest(transaction) {
    const core = {
      schemaVersion: PRIVATE_MANIFEST_SCHEMA_VERSION,
      authenticationVersion: JOURNAL_AUTHENTICATOR_VERSION,
      transactionId: transaction.id,
      binding: transaction.binding,
      bindingDigest: transaction.bindingDigest,
      plan: transaction.plan,
      checkpointManifest: transaction.checkpointManifest,
      targets: transaction.targets,
    };
    const signed = Object.freeze({ ...core, manifestDigest: canonicalSha256Digest(core) });
    const authenticationTag = journalAuthenticator.seal(
      transaction.binding.realRootPath,
      signed
    );
    if (isPromiseLike(authenticationTag) || typeof authenticationTag !== 'string') {
      fail('JOURNAL_AUTHENTICATION_FAILED', 'The transaction manifest could not be authenticated');
    }
    return Object.freeze({ ...signed, authenticationTag });
  }

  function stateRecord(transaction, state, reasonCode = '') {
    const leaf = createTransactionalDeleteStateRecord({
      previousState: transaction.state,
      state,
      at: readNow(),
      reasonCode,
    });
    return createTransactionalDeleteJournalRecord({
      transactionId: transaction.id,
      planDigest: transaction.plan.planDigest,
      checkpointDigest: transaction.checkpointManifest.checkpointDigest,
      sequence: transaction.journal.records.length,
      previousRecordDigest: transaction.journal.headDigest || null,
      stateRecord: leaf,
    });
  }

  function authenticateRecord(transaction, record) {
    const core = {
      transactionId: transaction.id,
      bindingDigest: transaction.bindingDigest,
      manifestDigest: transaction.manifest.manifestDigest,
      deleteRequestDigest: transaction.plan.requestDigest,
      impactDigest: transaction.plan.impactDigest,
      record,
    };
    const authenticationTag = journalAuthenticator.seal(
      transaction.binding.realRootPath,
      core
    );
    if (isPromiseLike(authenticationTag) || typeof authenticationTag !== 'string') {
      fail('JOURNAL_AUTHENTICATION_FAILED', 'A transaction journal record could not be authenticated');
    }
    return authenticationTag;
  }

  function buildJournal(transaction, records, recordAuthentications, moved) {
    const core = {
      schemaVersion: PRIVATE_JOURNAL_SCHEMA_VERSION,
      authenticationVersion: JOURNAL_AUTHENTICATOR_VERSION,
      transactionId: transaction.id,
      bindingDigest: transaction.bindingDigest,
      manifestDigest: transaction.manifest.manifestDigest,
      planDigest: transaction.plan.planDigest,
      deleteRequestDigest: transaction.plan.requestDigest,
      impactDigest: transaction.plan.impactDigest,
      checkpointDigest: transaction.checkpointManifest.checkpointDigest,
      revision: transaction.journal ? transaction.journal.revision + 1 : 0,
      records,
      recordAuthentications,
      headDigest: records.length ? records[records.length - 1].recordDigest : '',
      moved,
    };
    const signed = { ...core, journalDigest: canonicalSha256Digest(core) };
    const authenticationTag = journalAuthenticator.seal(
      transaction.binding.realRootPath,
      signed
    );
    if (isPromiseLike(authenticationTag) || typeof authenticationTag !== 'string') {
      fail('JOURNAL_AUTHENTICATION_FAILED', 'The transaction journal could not be authenticated');
    }
    return Object.freeze({ ...signed, authenticationTag });
  }

  function buildHead(transaction, journal = transaction.journal) {
    const core = {
      schemaVersion: PRIVATE_HEAD_SCHEMA_VERSION,
      authenticationVersion: JOURNAL_AUTHENTICATOR_VERSION,
      transactionId: transaction.id,
      bindingDigest: transaction.bindingDigest,
      manifestDigest: transaction.manifest.manifestDigest,
      revision: journal.revision,
      previousAnchorDigest: transaction.lastAnchorDigest,
      sequence: journal.records.length - 1,
      headDigest: journal.headDigest,
      journalDigest: journal.journalDigest,
      latestState: journal.records.length
        ? journal.records[journal.records.length - 1].stateRecord.state
        : null,
    };
    const authenticationTag = journalAuthenticator.seal(
      transaction.binding.realRootPath,
      core
    );
    if (isPromiseLike(authenticationTag) || typeof authenticationTag !== 'string') {
      fail('JOURNAL_AUTHENTICATION_FAILED', 'The durable transaction head could not be authenticated');
    }
    return Object.freeze({ ...core, authenticationTag });
  }

  function validatePrivateManifest(raw, expectedId, expectedBinding) {
    assertExactKeys(raw, [
      'schemaVersion',
      'authenticationVersion',
      'transactionId',
      'binding',
      'bindingDigest',
      'plan',
      'checkpointManifest',
      'targets',
      'manifestDigest',
      'authenticationTag',
    ], [
      'schemaVersion',
      'authenticationVersion',
      'transactionId',
      'binding',
      'bindingDigest',
      'plan',
      'checkpointManifest',
      'targets',
      'manifestDigest',
      'authenticationTag',
    ], 'private manifest');
    if (raw.schemaVersion !== PRIVATE_MANIFEST_SCHEMA_VERSION
      || raw.authenticationVersion !== JOURNAL_AUTHENTICATOR_VERSION
      || raw.transactionId !== expectedId
      || !SAFE_TRANSACTION_ID.test(raw.transactionId)) {
      fail('MANIFEST_INVALID', 'The transaction manifest identity is invalid');
    }
    let binding;
    let plan;
    let checkpointManifest;
    try {
      binding = createCapabilityDelegationBinding(raw.binding);
      plan = assertTransactionalDeletePlan(raw.plan);
      assertExactKeys(raw.checkpointManifest, [
        'schemaVersion',
        'contractVersion',
        'createdAt',
        'pathStyle',
        'caseSensitive',
        'planDigest',
        'requestDigest',
        'impactDigest',
        'impact',
        'entries',
        'checkpointDigest',
      ], [
        'schemaVersion',
        'contractVersion',
        'createdAt',
        'pathStyle',
        'caseSensitive',
        'planDigest',
        'requestDigest',
        'impactDigest',
        'impact',
        'entries',
        'checkpointDigest',
      ], 'checkpoint manifest');
      checkpointManifest = createTransactionalDeleteCheckpointManifest({
        plan,
        entries: raw.checkpointManifest.entries,
        createdAt: raw.checkpointManifest.createdAt,
      });
    } catch {
      fail('MANIFEST_INVALID', 'The transaction manifest contracts are invalid');
    }
    if (binding.canonicalRootPath !== expectedBinding.canonicalRootPath
      || binding.realRootPath !== expectedBinding.realRootPath) {
      fail('MANIFEST_BINDING_MISMATCH', 'The transaction manifest is bound elsewhere');
    }
    if (raw.bindingDigest !== canonicalSha256Digest(binding)
      || checkpointManifest.checkpointDigest !== raw.checkpointManifest.checkpointDigest
      || checkpointManifest.planDigest !== plan.planDigest
      || checkpointManifest.requestDigest !== plan.requestDigest
      || checkpointManifest.impactDigest !== plan.impactDigest) {
      fail('MANIFEST_INVALID', 'The transaction manifest digests are invalid');
    }
    const targetValues = denseDataValues(raw.targets, 'private manifest targets');
    if (targetValues.length !== plan.request.paths.length) {
      fail('MANIFEST_INVALID', 'The transaction target set is invalid');
    }
    const targets = targetValues.map((target, index) => {
      assertExactKeys(
        target,
        ['relativePath', 'payloadName'],
        ['relativePath', 'payloadName'],
        'private manifest target'
      );
      const payloadName = String(index).padStart(4, '0');
      if (target.relativePath !== plan.request.paths[index]
        || target.payloadName !== payloadName) {
        fail('MANIFEST_INVALID', 'The transaction target order is invalid');
      }
      return Object.freeze({ relativePath: target.relativePath, payloadName });
    });
    const core = {
      schemaVersion: raw.schemaVersion,
      authenticationVersion: raw.authenticationVersion,
      transactionId: raw.transactionId,
      binding,
      bindingDigest: raw.bindingDigest,
      plan,
      checkpointManifest,
      targets,
    };
    const signed = { ...core, manifestDigest: canonicalSha256Digest(core) };
    if (raw.manifestDigest !== signed.manifestDigest
      || !authenticationIsValid(
        expectedBinding.realRootPath,
        signed,
        raw.authenticationTag
      )) {
      fail('MANIFEST_AUTHENTICATION_FAILED', 'The transaction manifest failed authentication');
    }
    return Object.freeze({ ...signed, targets, authenticationTag: raw.authenticationTag });
  }

  function validatePrivateJournal(raw, manifest) {
    assertExactKeys(raw, [
      'schemaVersion',
      'authenticationVersion',
      'transactionId',
      'bindingDigest',
      'manifestDigest',
      'planDigest',
      'deleteRequestDigest',
      'impactDigest',
      'checkpointDigest',
      'revision',
      'records',
      'recordAuthentications',
      'headDigest',
      'moved',
      'journalDigest',
      'authenticationTag',
    ], [
      'schemaVersion',
      'authenticationVersion',
      'transactionId',
      'bindingDigest',
      'manifestDigest',
      'planDigest',
      'deleteRequestDigest',
      'impactDigest',
      'checkpointDigest',
      'revision',
      'records',
      'recordAuthentications',
      'headDigest',
      'moved',
      'journalDigest',
      'authenticationTag',
    ], 'private journal');
    if (raw.schemaVersion !== PRIVATE_JOURNAL_SCHEMA_VERSION
      || raw.authenticationVersion !== JOURNAL_AUTHENTICATOR_VERSION
      || raw.transactionId !== manifest.transactionId
      || raw.bindingDigest !== manifest.bindingDigest
      || raw.manifestDigest !== manifest.manifestDigest
      || raw.planDigest !== manifest.plan.planDigest
      || raw.deleteRequestDigest !== manifest.plan.requestDigest
      || raw.impactDigest !== manifest.plan.impactDigest
      || raw.checkpointDigest !== manifest.checkpointManifest.checkpointDigest) {
      fail('JOURNAL_BINDING_MISMATCH', 'The transaction journal is bound elsewhere');
    }
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 1 || Object.is(raw.revision, -0)) {
      fail('JOURNAL_REVISION_INVALID', 'The transaction journal revision is invalid');
    }
    let verified;
    try {
      verified = verifyTransactionalDeleteJournalChain(raw.records, {
        transactionId: raw.transactionId,
        planDigest: raw.planDigest,
        checkpointDigest: raw.checkpointDigest,
      });
    } catch {
      fail('JOURNAL_CHAIN_INVALID', 'The transaction journal chain is invalid');
    }
    const records = verified.records;
    const recordAuthentications = denseDataValues(
      raw.recordAuthentications,
      'journal record authentications'
    );
    if (recordAuthentications.length !== records.length) {
      fail('JOURNAL_AUTHENTICATION_FAILED', 'The journal record authentication set is invalid');
    }
    for (let index = 0; index < records.length; index += 1) {
      const authenticationCore = {
        transactionId: manifest.transactionId,
        bindingDigest: manifest.bindingDigest,
        manifestDigest: manifest.manifestDigest,
        deleteRequestDigest: manifest.plan.requestDigest,
        impactDigest: manifest.plan.impactDigest,
        record: records[index],
      };
      if (!authenticationIsValid(
        manifest.binding.realRootPath,
        authenticationCore,
        recordAuthentications[index]
      )) {
        fail('JOURNAL_AUTHENTICATION_FAILED', 'A journal record failed authentication');
      }
    }
    const moved = denseDataValues(raw.moved, 'journal moved set');
    if (moved.length > manifest.targets.length
      || moved.some((name, index) => name !== manifest.targets[index].payloadName)) {
      fail('JOURNAL_PROGRESS_INVALID', 'The journal movement progress is invalid');
    }
    const expectedHead = records[records.length - 1].recordDigest;
    if (raw.headDigest !== expectedHead) {
      fail('JOURNAL_HEAD_INVALID', 'The journal head does not match its record chain');
    }
    const core = {
      schemaVersion: raw.schemaVersion,
      authenticationVersion: raw.authenticationVersion,
      transactionId: raw.transactionId,
      bindingDigest: raw.bindingDigest,
      manifestDigest: raw.manifestDigest,
      planDigest: raw.planDigest,
      deleteRequestDigest: raw.deleteRequestDigest,
      impactDigest: raw.impactDigest,
      checkpointDigest: raw.checkpointDigest,
      revision: raw.revision,
      records,
      recordAuthentications,
      headDigest: raw.headDigest,
      moved,
    };
    const signed = { ...core, journalDigest: canonicalSha256Digest(core) };
    if (raw.journalDigest !== signed.journalDigest
      || !authenticationIsValid(
        manifest.binding.realRootPath,
        signed,
        raw.authenticationTag
      )) {
      fail('JOURNAL_AUTHENTICATION_FAILED', 'The transaction journal failed authentication');
    }
    return Object.freeze({ ...signed, authenticationTag: raw.authenticationTag });
  }

  function validatePrivateHead(raw, manifest, journal) {
    assertExactKeys(raw, [
      'schemaVersion',
      'authenticationVersion',
      'transactionId',
      'bindingDigest',
      'manifestDigest',
      'revision',
      'previousAnchorDigest',
      'sequence',
      'headDigest',
      'journalDigest',
      'latestState',
      'authenticationTag',
    ], [
      'schemaVersion',
      'authenticationVersion',
      'transactionId',
      'bindingDigest',
      'manifestDigest',
      'revision',
      'previousAnchorDigest',
      'sequence',
      'headDigest',
      'journalDigest',
      'latestState',
      'authenticationTag',
    ], 'private journal head');
    const core = {
      schemaVersion: raw.schemaVersion,
      authenticationVersion: raw.authenticationVersion,
      transactionId: raw.transactionId,
      bindingDigest: raw.bindingDigest,
      manifestDigest: raw.manifestDigest,
      revision: raw.revision,
      previousAnchorDigest: raw.previousAnchorDigest,
      sequence: raw.sequence,
      headDigest: raw.headDigest,
      journalDigest: raw.journalDigest,
      latestState: raw.latestState,
    };
    if (raw.schemaVersion !== PRIVATE_HEAD_SCHEMA_VERSION
      || raw.authenticationVersion !== JOURNAL_AUTHENTICATOR_VERSION
      || raw.transactionId !== manifest.transactionId
      || raw.bindingDigest !== manifest.bindingDigest
      || raw.manifestDigest !== manifest.manifestDigest
      || raw.revision !== journal.revision
      || raw.sequence !== journal.records.length - 1
      || raw.headDigest !== journal.headDigest
      || raw.journalDigest !== journal.journalDigest
      || raw.latestState !== journal.records[journal.records.length - 1].stateRecord.state
      || !authenticationIsValid(
        manifest.binding.realRootPath,
        core,
        raw.authenticationTag
      )) {
      fail('JOURNAL_HEAD_INVALID', 'The durable journal head is invalid');
    }
    return Object.freeze({ ...core, authenticationTag: raw.authenticationTag });
  }

  function validateAnchorChain(namespace, anchorRelativePath, manifest) {
    const prefix = `${anchorRelativePath}/`;
    const entries = listNamespace(namespace, anchorRelativePath);
    const names = entries.map((entry) => {
      if (!entry.startsWith(prefix) || entry.slice(prefix.length).includes('/')) {
        fail('JOURNAL_ANCHOR_INVALID', 'The durable journal anchor directory is unsafe');
      }
      return entry.slice(prefix.length);
    }).sort();
    if (!names.length) {
      fail('JOURNAL_ANCHOR_INVALID', 'The durable journal anchor chain has a gap');
    }
    let previousAnchorDigest = null;
    let latestAnchor = null;
    let previousSequence = null;
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const match = /^(\d{12})-([a-f0-9]{64})\.json$/.exec(name);
      if (!match || Number(match[1]) !== index + 1) {
        fail('JOURNAL_ANCHOR_INVALID', 'The durable journal anchor order is invalid');
      }
      const head = readNamespaceJson(namespace, `${anchorRelativePath}/${name}`);
      assertExactKeys(head, [
        'schemaVersion',
        'authenticationVersion',
        'transactionId',
        'bindingDigest',
        'manifestDigest',
        'revision',
        'previousAnchorDigest',
        'sequence',
        'headDigest',
        'journalDigest',
        'latestState',
        'authenticationTag',
      ], [
        'schemaVersion',
        'authenticationVersion',
        'transactionId',
        'bindingDigest',
        'manifestDigest',
        'revision',
        'previousAnchorDigest',
        'sequence',
        'headDigest',
        'journalDigest',
        'latestState',
        'authenticationTag',
      ], 'journal anchor');
      const core = {
        schemaVersion: head.schemaVersion,
        authenticationVersion: head.authenticationVersion,
        transactionId: head.transactionId,
        bindingDigest: head.bindingDigest,
        manifestDigest: head.manifestDigest,
        revision: head.revision,
        previousAnchorDigest: head.previousAnchorDigest,
        sequence: head.sequence,
        headDigest: head.headDigest,
        journalDigest: head.journalDigest,
        latestState: head.latestState,
      };
      if (head.schemaVersion !== PRIVATE_HEAD_SCHEMA_VERSION
        || head.authenticationVersion !== JOURNAL_AUTHENTICATOR_VERSION
        || head.transactionId !== manifest.transactionId
        || head.bindingDigest !== manifest.bindingDigest
        || head.manifestDigest !== manifest.manifestDigest
        || head.revision !== index + 1
        || head.previousAnchorDigest !== previousAnchorDigest
        || (previousSequence !== null
          && (head.sequence < previousSequence || head.sequence > previousSequence + 1))
        || head.journalDigest !== `sha256:${match[2]}`
        || !authenticationIsValid(
          manifest.binding.realRootPath,
          core,
          head.authenticationTag
        )) {
        fail('JOURNAL_ANCHOR_INVALID', 'A durable journal anchor is invalid');
      }
      previousAnchorDigest = canonicalSha256Digest(head);
      latestAnchor = head;
      previousSequence = head.sequence;
    }
    return Object.freeze({
      latestHead: Object.freeze(latestAnchor),
      lastAnchorDigest: previousAnchorDigest,
    });
  }

  function isCanonicalSha256Digest(value) {
    try { return normalizeDigest(value, 'journal head digest') === value; } catch {
      return false;
    }
  }

  function validateAuthenticatedOrphanHead(raw, transactionId, rootPath, fieldName) {
    assertExactKeys(raw, [
      'schemaVersion',
      'authenticationVersion',
      'transactionId',
      'bindingDigest',
      'manifestDigest',
      'revision',
      'previousAnchorDigest',
      'sequence',
      'headDigest',
      'journalDigest',
      'latestState',
      'authenticationTag',
    ], [
      'schemaVersion',
      'authenticationVersion',
      'transactionId',
      'bindingDigest',
      'manifestDigest',
      'revision',
      'previousAnchorDigest',
      'sequence',
      'headDigest',
      'journalDigest',
      'latestState',
      'authenticationTag',
    ], fieldName);
    const core = {
      schemaVersion: raw.schemaVersion,
      authenticationVersion: raw.authenticationVersion,
      transactionId: raw.transactionId,
      bindingDigest: raw.bindingDigest,
      manifestDigest: raw.manifestDigest,
      revision: raw.revision,
      previousAnchorDigest: raw.previousAnchorDigest,
      sequence: raw.sequence,
      headDigest: raw.headDigest,
      journalDigest: raw.journalDigest,
      latestState: raw.latestState,
    };
    const digestsAreCanonical = [
      raw.bindingDigest,
      raw.manifestDigest,
      raw.headDigest,
      raw.journalDigest,
    ].every(isCanonicalSha256Digest)
      && (raw.previousAnchorDigest === null
        || isCanonicalSha256Digest(raw.previousAnchorDigest));
    if (raw.schemaVersion !== PRIVATE_HEAD_SCHEMA_VERSION
      || raw.authenticationVersion !== JOURNAL_AUTHENTICATOR_VERSION
      || raw.transactionId !== transactionId
      || !SAFE_TRANSACTION_ID.test(raw.transactionId)
      || !Number.isSafeInteger(raw.revision)
      || raw.revision < 1
      || Object.is(raw.revision, -0)
      || !Number.isSafeInteger(raw.sequence)
      || raw.sequence < 0
      || Object.is(raw.sequence, -0)
      || !Object.values(TRANSACTIONAL_DELETE_STATES).includes(raw.latestState)
      || !digestsAreCanonical
      || !authenticationIsValid(rootPath, core, raw.authenticationTag)) {
      fail('JOURNAL_HEAD_INVALID', 'An orphan journal head failed authentication');
    }
    return Object.freeze({ ...core, authenticationTag: raw.authenticationTag });
  }

  function validateOrphanAnchorChain(namespace, anchorRelativePath, transactionId, rootPath) {
    const prefix = `${anchorRelativePath}/`;
    const entries = listNamespace(namespace, anchorRelativePath);
    const names = entries.map((entry) => {
      if (!entry.startsWith(prefix) || entry.slice(prefix.length).includes('/')) {
        fail('JOURNAL_ANCHOR_INVALID', 'The orphan journal anchor directory is unsafe');
      }
      return entry.slice(prefix.length);
    }).sort();
    if (!names.length) {
      fail('JOURNAL_ANCHOR_INVALID', 'The orphan journal anchor chain has a gap');
    }
    let previousAnchorDigest = null;
    let previousSequence = null;
    let bindingDigest = null;
    let manifestDigest = null;
    let latestHead = null;
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const match = /^(\d{12})-([a-f0-9]{64})\.json$/.exec(name);
      if (!match || Number(match[1]) !== index + 1) {
        fail('JOURNAL_ANCHOR_INVALID', 'The orphan journal anchor order is invalid');
      }
      const head = validateAuthenticatedOrphanHead(
        readNamespaceJson(namespace, `${anchorRelativePath}/${name}`),
        transactionId,
        rootPath,
        'orphan journal anchor'
      );
      if (head.revision !== index + 1
        || head.previousAnchorDigest !== previousAnchorDigest
        || (previousSequence === null
          ? head.sequence !== 0
          : head.sequence < previousSequence || head.sequence > previousSequence + 1)
        || head.journalDigest !== `sha256:${match[2]}`
        || (bindingDigest !== null && head.bindingDigest !== bindingDigest)
        || (manifestDigest !== null && head.manifestDigest !== manifestDigest)) {
        fail('JOURNAL_ANCHOR_INVALID', 'An orphan journal anchor is invalid');
      }
      bindingDigest = head.bindingDigest;
      manifestDigest = head.manifestDigest;
      previousAnchorDigest = canonicalSha256Digest(head);
      previousSequence = head.sequence;
      latestHead = head;
    }
    return Object.freeze({ latestHead, lastAnchorDigest: previousAnchorDigest });
  }

  function persistJournal(transaction, journal = transaction.journal) {
    const head = buildHead(transaction, journal);
    const generationName = `${String(journal.revision).padStart(12, '0')}-${journal.journalDigest.slice(7)}.json`;
    const generationRelativePath = `${transaction.generationsRelativePath}/${generationName}`;
    const existingGeneration = readNamespaceJson(
      transaction.privateNamespace,
      generationRelativePath,
      { optional: true }
    );
    if (existingGeneration) {
      if (canonicalSha256Digest(existingGeneration) !== canonicalSha256Digest(journal)) {
        fail('JOURNAL_GENERATION_CONFLICT', 'A durable journal generation conflicts with this update');
      }
    } else {
      writeNamespaceJson(transaction.privateNamespace, generationRelativePath, journal);
    }
    const anchorName = `${String(head.revision).padStart(12, '0')}-${head.journalDigest.slice(7)}.json`;
    const anchorRelativePath = `${transaction.anchorRelativePath}/${anchorName}`;
    const existingAnchor = readNamespaceJson(
      transaction.privateNamespace,
      anchorRelativePath,
      { optional: true }
    );
    if (existingAnchor) {
      if (canonicalSha256Digest(existingAnchor) !== canonicalSha256Digest(head)) {
        fail('JOURNAL_ANCHOR_CONFLICT', 'A durable journal anchor conflicts with this update');
      }
    } else {
      writeNamespaceJson(transaction.privateNamespace, anchorRelativePath, head);
    }
    transaction.lastAnchorDigest = canonicalSha256Digest(head);

    // These are replaceable read caches, not the commit point. Recovery uses
    // the authenticated immutable generation selected by the anchor chain.
    try {
      writeNamespaceJson(transaction.privateNamespace, transaction.journalRelativePath, journal);
    } catch {}
    try {
      writeNamespaceJson(transaction.privateNamespace, transaction.headRelativePath, head);
    } catch {}
  }

  function transition(transaction, state, reasonCode = '') {
    const record = stateRecord(transaction, state, reasonCode);
    const records = [...transaction.journal.records, record];
    const recordAuthentications = [
      ...transaction.journal.recordAuthentications,
      authenticateRecord(transaction, record),
    ];
    const nextJournal = buildJournal(
      transaction,
      records,
      recordAuthentications,
      [...transaction.moved]
    );
    persistJournal(transaction, nextJournal);
    transaction.journal = nextJournal;
    transaction.state = state;
  }

  function publicOutcome(transaction, status, state, errorCode, freshApprovalRequired = false) {
    const impact = {
      files: transaction.plan.impact.files,
      bytes: transaction.plan.impact.bytes,
      directories: transaction.plan.impact.directories,
    };
    const result = createTransactionalDeletePublicResult({
      status,
      state,
      impact,
      errorCode,
    });
    return Object.freeze({ ...result, freshApprovalRequired });
  }

  function register(transaction) {
    transactionsById.set(transaction.id, transaction);
    const jobKey = canonicalSha256Digest(transaction.binding);
    let ids = transactionIdsByJob.get(jobKey);
    if (!ids) {
      ids = new Set();
      transactionIdsByJob.set(jobKey, ids);
    }
    ids.add(transaction.id);
  }

  function unregister(transaction) {
    transactionsById.delete(transaction.id);
    const jobKey = canonicalSha256Digest(transaction.binding);
    const ids = transactionIdsByJob.get(jobKey);
    if (ids) {
      ids.delete(transaction.id);
      if (!ids.size) transactionIdsByJob.delete(jobKey);
    }
  }

  function verifyQuarantinedTargets(transaction) {
    verifyMutationSession(transaction);
    inferMovementProgress(transaction);
  }

  function inferMovementProgress(transaction) {
    const descriptor = transaction.mutationSession
      ? Object.getOwnPropertyDescriptor(transaction.mutationSession, 'inspectProgress')
      : null;
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function') {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Anchored progress inspection is unavailable');
    }
    let result;
    try { result = descriptor.value.call(transaction.mutationSession); } catch (error) {
      if (error && typeof error.code === 'string') {
        fail(error.code, 'Anchored progress inspection failed');
      }
      fail('CHECKPOINT_TAMPERED', 'Anchored progress inspection failed');
    }
    if (isPromiseLike(result) || !isPlainDataRecord(result)) {
      fail('CHECKPOINT_TAMPERED', 'Anchored progress inspection returned invalid data');
    }
    const moved = denseDataValues(dataValue(result, 'moved'), 'anchored movement progress');
    if (moved.length > transaction.targets.length
      || moved.some((name, index) => name !== transaction.targets[index].payloadName)) {
      fail('JOURNAL_PROGRESS_INVALID', 'Transaction movement is not an ordered prefix');
    }
    return moved;
  }

  function reconcileMovementProgress(transaction) {
    const inferredMoved = inferMovementProgress(transaction);
    if (JSON.stringify(inferredMoved) === JSON.stringify(transaction.moved)) return;
    const previousMoved = transaction.moved;
    transaction.moved = inferredMoved;
    try {
      const reconciledJournal = buildJournal(
        transaction,
        transaction.journal.records,
        transaction.journal.recordAuthentications,
        inferredMoved
      );
      persistJournal(transaction, reconciledJournal);
      transaction.journal = reconciledJournal;
    } catch (error) {
      transaction.moved = previousMoved;
      throw error;
    }
  }

  function verifyRestoredTargets(transaction, restoration) {
    let restored;
    try {
      restored = denseDataValues(dataValue(restoration, 'restored'), 'anchored restored set');
    } catch {
      fail('ROLLBACK_FAILED', 'The anchored mutation backend returned invalid restoration data');
    }
    const expected = [...transaction.moved];
    if (restored.length !== expected.length
      || new Set(restored).size !== restored.length
      || restored.some((name) => !expected.includes(name))) {
      fail('ROLLBACK_FAILED', 'The anchored mutation backend returned incomplete restoration progress');
    }
    if (inferMovementProgress(transaction).length !== 0) {
      fail('ROLLBACK_FAILED', 'The anchored mutation backend left restoration incomplete');
    }
    verifyMutationSession(transaction);
    const restoredScan = scanTargets(
      transaction.binding,
      transaction.plan.request,
      transaction.plan.pathStyle,
      transaction.plan.caseSensitive,
      transaction.checkpointManifest.createdAt
    );
    if (restoredScan.plan.planDigest !== transaction.plan.planDigest
      || restoredScan.checkpointManifest.checkpointDigest
        !== transaction.checkpointManifest.checkpointDigest) {
      fail('ROLLBACK_FAILED', 'Restored delete targets no longer match the checkpoint');
    }
  }

  function rootNamespaceMethod(rootNamespace, name) {
    if (!rootNamespace || typeof rootNamespace !== 'object' || Array.isArray(rootNamespace)) {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Anchored root namespace is unavailable');
    }
    const descriptor = Object.getOwnPropertyDescriptor(rootNamespace, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function') {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', `Anchored root namespace omitted ${name}`);
    }
    return descriptor.value;
  }

  function openRootNamespace(rootPath) {
    readMutationProbe({ requireEnforced: true });
    let rootNamespace;
    try {
      const opener = Object.getOwnPropertyDescriptor(mutationBackend, 'openRootNamespace').value;
      rootNamespace = opener.call(mutationBackend, Object.freeze({ rootPath }));
    } catch {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Unable to open the anchored root namespace');
    }
    if (isPromiseLike(rootNamespace)) {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Anchored root namespace creation must be synchronous');
    }
    try { return assertAnchoredFilesystemMutationRootNamespace(rootNamespace); } catch {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Anchored root namespace is invalid');
    }
  }

  function closeRootNamespace(rootNamespace) {
    if (!rootNamespace) return;
    let result;
    try { result = rootNamespaceMethod(rootNamespace, 'close').call(rootNamespace); } catch {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Anchored root namespace did not close');
    }
    if (isPromiseLike(result) || !isPlainDataRecord(result)
      || dataValue(result, 'closed') !== true) {
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Anchored root namespace did not close');
    }
  }

  function assertTransactionCapacity(rootPath) {
    let rootNamespace = null;
    try {
      rootNamespace = openRootNamespace(rootPath);
      const entries = listNamespace(
        dataValue(rootNamespace, 'privateNamespace'),
        'transactions',
        MAX_ROOT_TRANSACTIONS
      );
      const prefix = 'transactions/';
      if (entries.some((entry) => (
        !entry.startsWith(prefix) || entry.slice(prefix.length).includes('/')
      ))) {
        fail('JOURNAL_INVALID', 'The transaction root listing is invalid');
      }
      if (entries.length >= MAX_ROOT_TRANSACTIONS) {
        fail('TRANSACTION_CAPACITY_EXCEEDED', 'The transaction root is at capacity');
      }
      closeRootNamespace(rootNamespace);
      rootNamespace = null;
    } catch (error) {
      try { closeRootNamespace(rootNamespace); } catch {}
      if (error instanceof TransactionalFilesystemDeleteError) throw error;
      fail('ATOMIC_MUTATION_BACKEND_UNAVAILABLE', 'Unable to inspect transaction capacity');
    }
  }

  function loadTransactionFromAnchoredNamespace(binding, transactionId) {
    if (!SAFE_TRANSACTION_ID.test(transactionId)) {
      fail('JOURNAL_INVALID', 'An unsafe transaction directory was retained');
    }
    const rootNamespace = openRootNamespace(binding.realRootPath);
    let promoted = false;
    const bootstrapNamespace = dataValue(rootNamespace, 'privateNamespace');
    const transactionsPath = path.join(binding.realRootPath, '.faber', 'transactions');
    const transactionPath = path.join(transactionsPath, transactionId);
    const transactionRelativePath = `transactions/${transactionId}`;
    const manifestPath = path.join(transactionPath, 'manifest.json');
    const journalPath = path.join(transactionPath, 'journal.json');
    const headPath = path.join(
      binding.realRootPath,
      '.faber',
      'transaction-heads',
      `${transactionId}.json`
    );
    let transaction = null;
    try {
      const manifest = validatePrivateManifest(
        readNamespaceJson(bootstrapNamespace, `${transactionRelativePath}/manifest.json`),
        transactionId,
        binding
      );
    // A project root may retain checkpoints for more than one authorized job.
    // Ignore another job only after its complete manifest, digests, root
    // binding, and authentication tag have all been validated above. Unknown
    // or tampered manifests still throw and remain recovery-blocking.
      if (!sameBinding(manifest.binding, binding)) {
        closeRootNamespace(rootNamespace);
        return null;
      }
    const anchorPath = path.join(
      binding.realRootPath,
      '.faber',
      'transaction-heads',
      transactionId
    );
    const anchorRelativePath = `transaction-heads/${transactionId}`;
      const anchorChain = validateAnchorChain(bootstrapNamespace, anchorRelativePath, manifest);
    const generationsPath = path.join(transactionPath, 'journal-generations');
    const generationName = `${String(anchorChain.latestHead.revision).padStart(12, '0')}-${anchorChain.latestHead.journalDigest.slice(7)}.json`;
      const journal = validatePrivateJournal(readNamespaceJson(
        bootstrapNamespace,
        `${transactionRelativePath}/journal-generations/${generationName}`
      ), manifest);
      validatePrivateHead(anchorChain.latestHead, manifest, journal);
      const lastAnchorDigest = anchorChain.lastAnchorDigest;
      const payloadPath = path.join(transactionPath, 'payload');
      transaction = {
      id: transactionId,
      binding: manifest.binding,
      bindingDigest: manifest.bindingDigest,
      plan: manifest.plan,
      checkpointManifest: manifest.checkpointManifest,
      transactionPath,
      payloadPath,
      generationsPath,
      manifestPath,
      journalPath,
      transactionRelativePath,
      manifestRelativePath: `${transactionRelativePath}/manifest.json`,
      journalRelativePath: `${transactionRelativePath}/journal.json`,
      generationsRelativePath: `${transactionRelativePath}/journal-generations`,
      headPath,
      anchorPath,
      headRelativePath: `transaction-heads/${transactionId}.json`,
      anchorRelativePath,
      targets: manifest.targets,
      moved: [...journal.moved],
      state: journal.records[journal.records.length - 1].stateRecord.state,
      manifest,
      journal,
      lastAnchorDigest,
      mutationSession: null,
      mutationSessionClosed: false,
      privateNamespace: null,
      restoredInSession: false,
      };
      const opener = rootNamespaceMethod(rootNamespace, 'openExistingSession')
        .bind(rootNamespace);
      transaction.mutationSession = prepareMutationSession(transaction, opener);
      promoted = true;
      transaction.privateNamespace = dataValue(
        transaction.mutationSession,
        'privateNamespace'
      );
      reconcileMovementProgress(transaction);
      verifyQuarantinedTargets(transaction);
      return transaction;
    } catch (error) {
      // Discovery is intentionally fail-closed and may swallow the load error.
      // Once the anchored backend has returned a session, however, every load
      // failure must still release its root/ancestor/source handles.
      if (transaction && transaction.mutationSession) {
        try { closeMutationSession(transaction); } catch {}
      } else if (!promoted) {
        try { closeRootNamespace(rootNamespace); } catch {}
      }
      throw error;
    }
  }

  function discoverTransactions(binding) {
    const discovered = [];
    let retainedUnknown = 0;
    let recoveredOrphanHeads = 0;
    let probe;
    try {
      probe = readMutationProbe();
    } catch {
      return { discovered, retainedUnknown: 1, recoveredOrphanHeads };
    }
    if (probe.state !== ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED) {
      // An unavailable backend may safely report an empty root as recovered,
      // but existing private metadata must be retained fail-closed. There is
      // deliberately no mutable pathname fallback.
      return {
        discovered,
        retainedUnknown: lstatExists(
          fs,
          path.join(binding.realRootPath, '.faber')
        ) ? 1 : 0,
        recoveredOrphanHeads,
      };
    }
    let names = [];
    let headNames = [];
    let listingRoot = null;
    try {
      listingRoot = openRootNamespace(binding.realRootPath);
      const namespace = dataValue(listingRoot, 'privateNamespace');
      const transactionEntries = listNamespace(
        namespace,
        'transactions',
        MAX_ROOT_TRANSACTIONS
      );
      names = transactionEntries.map((entry) => {
        const prefix = 'transactions/';
        if (!entry.startsWith(prefix) || entry.slice(prefix.length).includes('/')) {
          fail('JOURNAL_INVALID', 'The transaction root listing is invalid');
        }
        return entry.slice(prefix.length);
      }).sort();
      const headEntries = listNamespace(
        namespace,
        'transaction-heads',
        MAX_PRIVATE_NAMESPACE_LIST_ENTRIES
      );
      headNames = headEntries.map((entry) => {
        const prefix = 'transaction-heads/';
        if (!entry.startsWith(prefix) || entry.slice(prefix.length).includes('/')) {
          fail('JOURNAL_INVALID', 'The transaction head listing is invalid');
        }
        return entry.slice(prefix.length);
      }).sort();
      if (new Set(names).size !== names.length
        || new Set(headNames).size !== headNames.length) {
        fail('JOURNAL_INVALID', 'The private namespace listing contains duplicates');
      }
      closeRootNamespace(listingRoot);
      listingRoot = null;
    } catch {
      try { closeRootNamespace(listingRoot); } catch {}
      return { discovered, retainedUnknown: 1, recoveredOrphanHeads };
    }
    for (const name of names) {
      if (transactionsById.has(name)) continue;
      try {
        const transaction = loadTransactionFromAnchoredNamespace(binding, name);
        if (!transaction) continue;
        register(transaction);
        discovered.push(transaction);
      } catch {
        retainedUnknown += 1;
      }
    }
    const transactionNames = new Set(names);
    const headNameSet = new Set(headNames);
    for (const fileName of headNames) {
      if (transactionNames.has(fileName)) continue;
      if (!fileName.endsWith('.json')) {
        // An orphan anchor directory is validated and removed together with
        // its authenticated companion head.
        if (headNameSet.has(`${fileName}.json`)) continue;
        retainedUnknown += 1;
        continue;
      }
      const transactionId = fileName.slice(0, -5);
      if (transactionNames.has(transactionId)) continue;
      let orphanRoot = null;
      try {
        orphanRoot = openRootNamespace(binding.realRootPath);
        const namespace = dataValue(orphanRoot, 'privateNamespace');
        const headRead = readNamespaceJson(
          namespace,
          `transaction-heads/${fileName}`,
          { includeContentDigest: true }
        );
        const head = validateAuthenticatedOrphanHead(
          headRead.value,
          transactionId,
          binding.realRootPath,
          'orphan journal head'
        );
        if (head.latestState !== TRANSACTIONAL_DELETE_STATES.PURGING) {
          fail('JOURNAL_HEAD_INVALID', 'An orphan journal head is not safely purgeable');
        }
        const anchorChain = validateOrphanAnchorChain(
          namespace,
          `transaction-heads/${transactionId}`,
          transactionId,
          binding.realRootPath
        );
        if (canonicalSha256Digest(anchorChain.latestHead)
          !== canonicalSha256Digest(head)) {
          fail('JOURNAL_REPLAY_DETECTED', 'The orphan head does not match its anchor');
        }
        // Preserve a fully authenticated foreign pair for its owner.
        if (head.bindingDigest === canonicalSha256Digest(binding)) {
          authorizeFinalFrontier(binding);
          const cleaned = rootNamespaceMethod(orphanRoot, 'cleanupAuthenticatedOrphan')
            .call(orphanRoot, Object.freeze({
              transactionId,
              bindingDigest: head.bindingDigest,
              manifestDigest: head.manifestDigest,
              journalDigest: head.journalDigest,
              headContentDigest: headRead.contentDigest,
              anchorChainDigest: anchorChain.lastAnchorDigest,
            }));
          if (isPromiseLike(cleaned) || !isPlainDataRecord(cleaned)
            || dataValue(cleaned, 'cleaned') !== true) {
            fail('PURGE_FAILED', 'Anchored orphan cleanup failed');
          }
          recoveredOrphanHeads += 1;
        }
        closeRootNamespace(orphanRoot);
        orphanRoot = null;
      } catch {
        try { closeRootNamespace(orphanRoot); } catch {}
        retainedUnknown += 1;
      }
    }
    return { discovered, retainedUnknown, recoveredOrphanHeads };
  }

  function transactionsForBinding(binding, discovered = []) {
    const transactions = new Map();
    for (const transaction of discovered) {
      if (sameBinding(transaction.binding, binding)) {
        transactions.set(transaction.id, transaction);
      }
    }
    const ids = transactionIdsByJob.get(canonicalSha256Digest(binding));
    if (ids) {
      for (const id of ids) {
        const transaction = transactionsById.get(id);
        if (transaction && sameBinding(transaction.binding, binding)) {
          transactions.set(transaction.id, transaction);
        }
      }
    }
    return [...transactions.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  function cleanupRestoredTransaction(transaction) {
    try {
      if (!transaction.restoredInSession) {
        reconcileMovementProgress(transaction);
        authorizeFinalFrontier(transaction.binding);
        const restoration = transaction.mutationSession.restoreFromQuarantine(
          Object.freeze({
            checkpointDigest: transaction.checkpointManifest.checkpointDigest,
          })
        );
        if (isPromiseLike(restoration) || !isPlainDataRecord(restoration)) {
          fail('ROLLBACK_FAILED', 'The anchored mutation backend returned invalid restoration data');
        }
        verifyRestoredTargets(transaction, restoration);
        transaction.moved = [];
        transaction.restoredInSession = true;
      }
      authorizeFinalFrontier(transaction.binding);
      const cleaned = namespaceMethod(
        transaction.privateNamespace,
        'cleanup',
        'PURGE_FAILED'
      ).call(transaction.privateNamespace);
      if (isPromiseLike(cleaned) || !isPlainDataRecord(cleaned)
        || dataValue(cleaned, 'cleaned') !== true) {
        fail('PURGE_FAILED', 'The restored checkpoint namespace was not cleaned');
      }
      transaction.state = TRANSACTIONAL_DELETE_STATES.PURGED;
      closeMutationSession(transaction);
      completedTransactions += 1;
      unregister(transaction);
    } catch (error) {
      recoveryRequiredTransactions += 1;
      if (error instanceof TransactionalFilesystemDeleteError) throw error;
      fail('PURGE_FAILED', 'The restored checkpoint namespace could not be cleaned');
    }
  }

  function purge(transaction) {
    if (transaction.state === TRANSACTIONAL_DELETE_STATES.PURGED) return;
    if (transaction.state === TRANSACTIONAL_DELETE_STATES.ROLLED_BACK) {
      cleanupRestoredTransaction(transaction);
      return;
    }
    if (transaction.state === TRANSACTIONAL_DELETE_STATES.COMMITTED) {
      verifyQuarantinedTargets(transaction);
    }
    if (transaction.state !== TRANSACTIONAL_DELETE_STATES.PURGING) {
      transition(transaction, TRANSACTIONAL_DELETE_STATES.PURGING);
    }
    try {
      authorizeFinalFrontier(transaction.binding);
      const purged = transaction.mutationSession.purgeQuarantine(
        Object.freeze({
          checkpointDigest: transaction.checkpointManifest.checkpointDigest,
        })
      );
      if (isPromiseLike(purged) || !isPlainDataRecord(purged)
        || dataValue(purged, 'purged') !== true) {
        fail('PURGE_FAILED', 'The anchored mutation backend did not purge the checkpoint');
      }
      if (dataValue(purged, 'namespaceCleaned') !== true) {
        fail('PURGE_FAILED', 'The anchored mutation backend left checkpoint data behind');
      }
      transaction.state = TRANSACTIONAL_DELETE_STATES.PURGED;
      closeMutationSession(transaction);
      completedTransactions += 1;
      unregister(transaction);
    } catch {
      // PURGING was durably anchored before the irreversible frontier. Do not
      // attempt another namespace write after the helper may already have
      // removed the transaction directory; doing so could resurrect metadata.
      transaction.state = TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT;
      recoveryRequiredTransactions += 1;
      fail('PURGE_FAILED', 'The delete checkpoint could not be purged');
    }
  }

  function rollback(transaction, reasonCode = '') {
    if (transaction.state === TRANSACTIONAL_DELETE_STATES.PURGED) return;
    if (transaction.state === TRANSACTIONAL_DELETE_STATES.ROLLED_BACK) {
      cleanupRestoredTransaction(transaction);
      return;
    }
    if (transaction.state !== TRANSACTIONAL_DELETE_STATES.ROLLING_BACK) {
      transition(transaction, TRANSACTIONAL_DELETE_STATES.ROLLING_BACK, reasonCode);
    }
    try {
      // The anchored backend can move a prefix and then throw before it can
      // return progress to the caller. Reconcile the physical checkpoint before
      // judging the restoration response so that an honest partial move can be
      // rolled back completely.
      reconcileMovementProgress(transaction);
      verifyQuarantinedTargets(transaction);
      authorizeFinalFrontier(transaction.binding);
      const restoration = transaction.mutationSession.restoreFromQuarantine(
        Object.freeze({
          checkpointDigest: transaction.checkpointManifest.checkpointDigest,
        })
      );
      if (isPromiseLike(restoration) || !isPlainDataRecord(restoration)) {
        fail('ROLLBACK_FAILED', 'The anchored mutation backend returned invalid restoration data');
      }
      verifyRestoredTargets(transaction, restoration);
      transaction.moved = [];
      transaction.restoredInSession = true;
      transition(transaction, TRANSACTIONAL_DELETE_STATES.ROLLED_BACK);
      cleanupRestoredTransaction(transaction);
    } catch (error) {
      try { reconcileMovementProgress(transaction); } catch {}
      try {
        if (transaction.state !== TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT) {
          transition(
            transaction,
            TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
            error && error.code === 'ROLLBACK_COLLISION'
              ? 'ROLLBACK_COLLISION'
              : 'CHECKPOINT_RESTORE_FAILED'
          );
        }
      } catch {}
      recoveryRequiredTransactions += 1;
      if (error instanceof TransactionalFilesystemDeleteError) throw error;
      fail('ROLLBACK_FAILED', 'The delete transaction requires recovery');
    }
  }

  function verifyTransaction(transaction) {
    authorize(transaction.binding);
    verifyMutationSession(transaction);
    const rescanned = scanTargets(
      transaction.binding,
      transaction.plan.request,
      transaction.plan.pathStyle,
      transaction.plan.caseSensitive,
      transaction.checkpointManifest.createdAt
    );
    if (rescanned.plan.planDigest !== transaction.plan.planDigest
      || rescanned.checkpointManifest.checkpointDigest
        !== transaction.checkpointManifest.checkpointDigest) {
      fail('TARGET_CHANGED', 'Delete targets changed after approval planning');
    }
    verifyMutationSession(transaction);
    return Object.freeze({
      effect: CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE,
      binding: transaction.binding,
      deleteRequestDigest: transaction.plan.requestDigest,
      impactDigest: transaction.plan.impactDigest,
      checkpointDigest: transaction.checkpointManifest.checkpointDigest,
      checkpointVerified: true,
      exactPathsVerified: true,
      protectedPathsRejected: true,
      impact: transaction.plan.impact,
    });
  }

  function createHandle(transaction) {
    let commitActive = false;

    function inspect() {
      return Object.freeze({
        state: transaction.state,
        plan: transaction.plan,
        checkpointManifest: transaction.checkpointManifest,
        retention: 'until_job_terminal',
        authorityBoundary: 'main_process_only',
      });
    }

    function verify() {
      return runForRoot(transaction.binding.realRootPath, () => verifyTransaction(transaction));
    }

    function commit(input = {}) {
      assertExactKeys(
        input,
        ['decisionRequestDigest', 'consumeDecision'],
        ['decisionRequestDigest', 'consumeDecision'],
        'commit input'
      );
      if (transaction.state !== TRANSACTIONAL_DELETE_STATES.PREPARED || commitActive) {
        return publicOutcome(
          transaction,
          TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.DENIED,
          transaction.state,
          'TRANSACTION_NOT_PREPARED'
        );
      }
      const consumeDecision = dataValue(input, 'consumeDecision');
      if (typeof consumeDecision !== 'function') {
        return publicOutcome(
          transaction,
          TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.DENIED,
          transaction.state,
          'DECISION_INVALID'
        );
      }
      let decisionRequestDigest;
      try {
        decisionRequestDigest = normalizeDigest(
          dataValue(input, 'decisionRequestDigest'),
          'decisionRequestDigest'
        );
      } catch {
        return publicOutcome(
          transaction,
          TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.DENIED,
          transaction.state,
          'DECISION_INVALID'
        );
      }
      commitActive = true;
      return runForRoot(transaction.binding.realRootPath, () => {
        let decisionSpent = false;
        try {
          const verified = verifyTransaction(transaction);
          transition(transaction, TRANSACTIONAL_DELETE_STATES.APPLYING);
          const finalVerified = verifyTransaction(transaction);
          const decisionFacts = Object.freeze({
            ...verified,
            ...finalVerified,
            requestDigest: decisionRequestDigest,
          });
          let decision;
          try { decision = consumeDecision(decisionFacts); } catch { decision = null; }
          if (isPromiseLike(decision)
            || !isPlainDataRecord(decision)
            || dataValue(decision, 'authorized') !== true) {
            rollback(transaction, 'DECISION_DENIED');
            return publicOutcome(
              transaction,
              TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.DENIED,
              TRANSACTIONAL_DELETE_STATES.PURGED,
              'DECISION_DENIED'
            );
          }
          decisionSpent = true;

          // FINAL SECURITY FRONTIER: consumeDecision may itself invoke trusted
          // lifecycle callbacks. The combined frontier is therefore last, and
          // the enforced anchored backend starts its first effect immediately.
          authorizeFinalFrontier(transaction.binding);
          const movement = transaction.mutationSession.moveToQuarantine(
            Object.freeze({
              checkpointDigest: transaction.checkpointManifest.checkpointDigest,
            })
          );
          if (isPromiseLike(movement) || !isPlainDataRecord(movement)) {
            fail('ANCHORED_MUTATION_FAILED', 'The anchored mutation backend returned invalid progress');
          }
          const moved = denseDataValues(dataValue(movement, 'moved'), 'anchored moved set');
          if (moved.length !== transaction.targets.length
            || moved.some((name, index) => name !== transaction.targets[index].payloadName)) {
            fail('ANCHORED_MUTATION_FAILED', 'The anchored mutation backend returned incomplete progress');
          }
          transaction.moved = [...moved];
          const movementJournal = buildJournal(
            transaction,
            transaction.journal.records,
            transaction.journal.recordAuthentications,
            [...transaction.moved]
          );
          persistJournal(transaction, movementJournal);
          transaction.journal = movementJournal;
          transition(transaction, TRANSACTIONAL_DELETE_STATES.COMMITTED);
          return publicOutcome(
            transaction,
            TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.COMPLETED,
            TRANSACTIONAL_DELETE_STATES.COMMITTED,
            null
          );
        } catch {
          try { rollback(transaction, 'DELETE_APPLY_FAILED'); } catch {}
          const state = transaction.state;
          return publicOutcome(
            transaction,
            TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.FAILED,
            state,
            state === TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT
              ? 'RECOVERY_REQUIRED'
              : 'DELETE_APPLY_FAILED',
            decisionSpent
          );
        } finally {
          commitActive = false;
        }
      });
    }

    function abort(input = {}) {
      assertExactKeys(input, ['reason'], [], 'abort input');
      return runForRoot(transaction.binding.realRootPath, () => {
        if (transaction.state === TRANSACTIONAL_DELETE_STATES.PURGED) {
          return Object.freeze({ ok: true, state: transaction.state });
        }
        try {
          rollback(transaction, 'OPERATION_ABORTED');
          return Object.freeze({ ok: true, state: transaction.state });
        } catch {
          return Object.freeze({ ok: false, state: transaction.state });
        }
      });
    }

    return Object.freeze({ inspect, verify, commit, abort });
  }

  function prepare(input = {}) {
    assertExactKeys(
      input,
      ['binding', 'paths', 'pathStyle', 'caseSensitive'],
      ['binding', 'paths', 'pathStyle', 'caseSensitive'],
      'prepare input'
    );
    const binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
    const pathStyle = dataValue(input, 'pathStyle');
    const caseSensitive = dataValue(input, 'caseSensitive');
    const request = createTransactionalDeletePublicRequest(
      { paths: dataValue(input, 'paths') },
      { pathStyle, caseSensitive }
    );
    readMutationProbe({ requireEnforced: true });
    return runForRoot(binding.realRootPath, () => {
      authorize(binding);
      const createdAt = readNow();
      const scanned = scanTargets(binding, request, pathStyle, caseSensitive, createdAt);
      authorize(binding);
      assertTransactionCapacity(binding.realRootPath);
      const id = safeTransactionId();
      const transactionsPath = path.join(binding.realRootPath, '.faber', 'transactions');
      const transactionPath = path.join(transactionsPath, id);
      const payloadPath = path.join(transactionPath, 'payload');
      const generationsPath = path.join(transactionPath, 'journal-generations');
      const anchorPath = path.join(binding.realRootPath, '.faber', 'transaction-heads', id);
      const transactionRelativePath = `transactions/${id}`;
      const transaction = {
        id,
        binding,
        bindingDigest: canonicalSha256Digest(binding),
        plan: scanned.plan,
        checkpointManifest: scanned.checkpointManifest,
        transactionPath,
        payloadPath,
        generationsPath,
        manifestPath: path.join(transactionPath, 'manifest.json'),
        journalPath: path.join(transactionPath, 'journal.json'),
        transactionRelativePath,
        manifestRelativePath: `${transactionRelativePath}/manifest.json`,
        journalRelativePath: `${transactionRelativePath}/journal.json`,
        generationsRelativePath: `${transactionRelativePath}/journal-generations`,
        anchorPath,
        headPath: path.join(
          binding.realRootPath,
          '.faber',
          'transaction-heads',
          `${id}.json`
        ),
        anchorRelativePath: `transaction-heads/${id}`,
        headRelativePath: `transaction-heads/${id}.json`,
        targets: scanned.plan.request.paths.map((relativePath, index) => ({
          relativePath,
          payloadName: String(index).padStart(4, '0'),
        })),
        moved: [],
        state: null,
        manifest: null,
        journal: null,
        lastAnchorDigest: null,
        mutationSession: null,
        mutationSessionClosed: false,
        privateNamespace: null,
        restoredInSession: false,
      };
      transaction.manifest = privateManifest(transaction);
      transaction.journal = buildJournal(transaction, [], [], []);
      try {
        // This is the critical namespace-order invariant: the native anchored
        // session must exist before the first private metadata write.
        transaction.mutationSession = prepareMutationSession(transaction);
        transaction.privateNamespace = dataValue(
          transaction.mutationSession,
          'privateNamespace'
        );
        writeNamespaceJson(
          transaction.privateNamespace,
          transaction.manifestRelativePath,
          transaction.manifest
        );
        transition(transaction, TRANSACTIONAL_DELETE_STATES.PREPARING);
        transition(transaction, TRANSACTIONAL_DELETE_STATES.PREPARED);
      } catch (error) {
        try {
          if (transaction.mutationSession) {
            // No target effect can have started before prepare returns. Move the
            // empty session through its protocol-valid restored disposition,
            // then clean only through the anchored namespace capability.
            authorizeFinalFrontier(transaction.binding);
            const restoration = transaction.mutationSession.restoreFromQuarantine(Object.freeze({
              checkpointDigest: transaction.checkpointManifest.checkpointDigest,
            }));
            if (isPromiseLike(restoration) || !isPlainDataRecord(restoration)
              || denseDataValues(
                dataValue(restoration, 'restored'),
                'failed prepare restoration'
              ).length !== 0
              || inferMovementProgress(transaction).length !== 0) {
              fail('CHECKPOINT_CREATE_FAILED', 'Failed prepare restoration was invalid');
            }
            authorizeFinalFrontier(transaction.binding);
            const cleaned = namespaceMethod(
              transaction.privateNamespace,
              'cleanup',
              'CHECKPOINT_CREATE_FAILED'
            ).call(transaction.privateNamespace);
            if (isPromiseLike(cleaned) || !isPlainDataRecord(cleaned)
              || dataValue(cleaned, 'cleaned') !== true) {
              fail('CHECKPOINT_CREATE_FAILED', 'Failed prepare namespace was not cleaned');
            }
          }
        } catch {}
        try { closeMutationSession(transaction); } catch {}
        if (error instanceof TransactionalFilesystemDeleteError) throw error;
        fail('CHECKPOINT_CREATE_FAILED', 'Unable to persist the delete checkpoint');
      }
      register(transaction);
      return createHandle(transaction);
    });
  }

  function normalizeTerminalInput(input, requireOutcome) {
    assertExactKeys(
      input,
      requireOutcome ? ['binding', 'outcome'] : ['binding', 'reason'],
      requireOutcome ? ['binding', 'outcome'] : ['binding'],
      requireOutcome ? 'finalizeJob input' : 'rollbackJob input'
    );
    return {
      binding: createCapabilityDelegationBinding(dataValue(input, 'binding')),
      outcome: requireOutcome ? dataValue(input, 'outcome') : 'failed',
    };
  }

  function finalizeJob(input = {}) {
    const normalized = normalizeTerminalInput(input, true);
    if (!TERMINAL_SUCCESS.has(normalized.outcome) && !TERMINAL_ROLLBACK.has(normalized.outcome)) {
      fail('INVALID_OUTCOME', 'Unsupported terminal job outcome');
    }
    return runForRoot(normalized.binding.realRootPath, () => {
      authorize(normalized.binding);
      const discovered = discoverTransactions(normalized.binding);
      const transactions = transactionsForBinding(normalized.binding, discovered.discovered);
      let purged = 0;
      let rolledBack = 0;
      let recoveryRequired = discovered.retainedUnknown;
      for (const transaction of transactions) {
        try {
          const postPurgeDisposition = transaction.state === TRANSACTIONAL_DELETE_STATES.PURGING
            || transaction.state === TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT;
          const successfulCommittedDisposition = TERMINAL_SUCCESS.has(normalized.outcome)
            && transaction.state === TRANSACTIONAL_DELETE_STATES.COMMITTED;
          if (postPurgeDisposition || successfulCommittedDisposition) {
            // Once durable purge has started it cannot safely change direction,
            // even if a later terminal notification reports failure/cancel.
            purge(transaction);
            purged += 1;
          } else if (transaction.state === TRANSACTIONAL_DELETE_STATES.PURGED) {
            unregister(transaction);
          } else {
            rollback(transaction, 'JOB_TERMINATED');
            rolledBack += 1;
          }
        } catch {
          recoveryRequired += 1;
        }
      }
      return Object.freeze({ ok: recoveryRequired === 0, purged, rolledBack, recoveryRequired });
    });
  }

  function rollbackJob(input = {}) {
    const normalized = normalizeTerminalInput(input, false);
    return finalizeJob({ binding: normalized.binding, outcome: normalized.outcome });
  }

  function recoverProject(input = {}) {
    assertExactKeys(input, ['binding'], ['binding'], 'recoverProject input');
    const binding = createCapabilityDelegationBinding(dataValue(input, 'binding'));
    return runForRoot(binding.realRootPath, () => {
      authorize(binding);
      const discovery = discoverTransactions(binding);
      const transactions = transactionsForBinding(binding, discovery.discovered);
      let recovered = discovery.recoveredOrphanHeads;
      let retainedCommitted = 0;
      let retainedUnknown = discovery.retainedUnknown;
      for (const transaction of transactions) {
        try {
          switch (transaction.state) {
            case TRANSACTIONAL_DELETE_STATES.PREPARING:
            case TRANSACTIONAL_DELETE_STATES.PREPARED:
            case TRANSACTIONAL_DELETE_STATES.APPLYING:
            case TRANSACTIONAL_DELETE_STATES.ROLLING_BACK:
            case TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT:
              rollback(transaction, 'RUNTIME_INTERRUPTED');
              recovered += 1;
              break;
            case TRANSACTIONAL_DELETE_STATES.COMMITTED:
              retainedCommitted += 1;
              break;
            case TRANSACTIONAL_DELETE_STATES.ROLLED_BACK:
            case TRANSACTIONAL_DELETE_STATES.PURGING:
            case TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT:
              purge(transaction);
              recovered += 1;
              break;
            default:
              retainedUnknown += 1;
          }
        } catch {
          retainedUnknown += 1;
        }
      }
      return Object.freeze({
        ok: retainedUnknown === 0,
        recovered,
        retainedCommitted,
        retainedUnknown,
      });
    });
  }

  function diagnostics() {
    let prepared = 0;
    let committed = 0;
    let recoveryRequired = 0;
    for (const transaction of transactionsById.values()) {
      if (transaction.state === TRANSACTIONAL_DELETE_STATES.PREPARED) prepared += 1;
      else if (transaction.state === TRANSACTIONAL_DELETE_STATES.COMMITTED) committed += 1;
      else if (transaction.state === TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT
        || transaction.state === TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT) {
        recoveryRequired += 1;
      }
    }
    return Object.freeze({
      version: TRANSACTIONAL_FILESYSTEM_DELETE_SERVICE_VERSION,
      activeTransactions: transactionsById.size,
      prepared,
      committed,
      recoveryRequired,
      completedTransactions,
      recoveryRequiredTransactions,
      retention: 'until_job_terminal',
      checkpointStorage: 'project_same_filesystem',
      authorityBoundary: 'main_process_only',
      defaultDecision: 'deny',
    });
  }

  return Object.freeze({ prepare, finalizeJob, rollbackJob, recoverProject, diagnostics });
}

class TransactionalFilesystemDeleteService {
  constructor(options = {}) {
    Object.assign(this, createTransactionalFilesystemDeleteService(options));
    Object.freeze(this);
  }
}

module.exports = {
  PRIVATE_JOURNAL_RECORD_SCHEMA_VERSION,
  PRIVATE_JOURNAL_SCHEMA_VERSION,
  PRIVATE_MANIFEST_SCHEMA_VERSION,
  TRANSACTIONAL_FILESYSTEM_DELETE_SERVICE_VERSION,
  TransactionalFilesystemDeleteError,
  TransactionalFilesystemDeleteService,
  createTransactionalFilesystemDeleteService,
};
