'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const MAP_CHAT_PROPOSAL_STORE_VERSION = 'map-chat-proposal-store.v1';
const MAP_CHAT_PROPOSAL_RECORD_SCHEMA_VERSION = 'map-chat-proposal-record.v1';
const MAP_CHAT_PROPOSAL_FILE_SCHEMA_VERSION = 'map-chat-proposal-file.v1';
const STORE_FILE_NAME = 'map-chat-proposals.v1.json';
const DEFAULT_MAX_RECORDS = 1_000;
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const MAX_PATCH_BYTES = 2 * 1024 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const TERMINAL_STATUSES = new Set(['applied', 'failed', 'rejected', 'superseded']);
const ALL_STATUSES = new Set(['pending', 'applying', ...TERMINAL_STATUSES]);
const WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set([
  'EACCES',
  'EINVAL',
  'EISDIR',
  'ENOTSUP',
  'EPERM',
]);

const MAP_CHAT_PROPOSAL_STORE_REASONS = Object.freeze({
  APPLY_IN_PROGRESS: 'MAP_CHAT_PROPOSAL_APPLY_IN_PROGRESS',
  CAPACITY_EXCEEDED: 'MAP_CHAT_PROPOSAL_CAPACITY_EXCEEDED',
  DIGEST_MISMATCH: 'MAP_CHAT_PROPOSAL_DIGEST_MISMATCH',
  INVALID_INPUT: 'MAP_CHAT_PROPOSAL_INVALID_INPUT',
  NOT_FOUND: 'MAP_CHAT_PROPOSAL_NOT_FOUND',
  NOT_PENDING: 'MAP_CHAT_PROPOSAL_NOT_PENDING',
  NOT_APPLYING: 'MAP_CHAT_PROPOSAL_NOT_APPLYING',
  REVISION_CONFLICT: 'MAP_CHAT_PROPOSAL_REVISION_CONFLICT',
  STORAGE_CORRUPTED: 'MAP_CHAT_PROPOSAL_STORAGE_CORRUPTED',
  STORAGE_UNAVAILABLE: 'MAP_CHAT_PROPOSAL_STORAGE_UNAVAILABLE',
});

const OPTION_KEYS = Object.freeze([
  'storageDir',
  'now',
  'idFactory',
  'maxRecords',
]);
const PREVIEW_KEYS = Object.freeze([
  'projectId',
  'rootPath',
  'conversationId',
  'surface',
  'target',
  'baseDigest',
  'patch',
]);
const APPROVAL_KEYS = Object.freeze([
  'proposalId',
  'expectedRevision',
  'patchDigest',
]);
const SETTLEMENT_KEYS = Object.freeze([
  'proposalId',
  'expectedRevision',
  'outcome',
  'failureCode',
]);
const FILTER_KEYS = Object.freeze([
  'projectId',
  'conversationId',
  'surface',
  'target',
  'status',
]);
const FILE_KEYS = Object.freeze([
  'schemaVersion',
  'storeRevision',
  'proposals',
]);
const RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'proposalId',
  'revision',
  'projectId',
  'rootPath',
  'conversationId',
  'surface',
  'target',
  'baseDigest',
  'patchDigest',
  'patch',
  'status',
  'failureCode',
  'supersededBy',
  'createdAt',
  'updatedAt',
  'resolvedAt',
]);

class ProposalStoreFault extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProposalStoreFault';
    this.code = code;
  }
}

function fault(code) {
  throw new ProposalStoreFault(code);
}

function deny(code) {
  return Object.freeze({ ok: false, code });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value) || util.types.isPromise(value)) return false;
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return prototype === Object.prototype || prototype === null;
}

function dataFields(value, expectedKeys, { exact = true } = {}) {
  if (!isPlainRecord(value)) return null;
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((exact && keys.length !== expectedKeys.length)
    || keys.some((key) => typeof key !== 'string'
      || FORBIDDEN_KEYS.has(key) || !expectedKeys.includes(key))
    || (exact && expectedKeys.some((key) => !keys.includes(key)))) return null;
  const fields = new Map();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function canonicalSnapshot(
  value,
  state = { depth: 0, nodes: 0, stringChars: 0, seen: new Set() },
) {
  state.nodes += 1;
  if (state.nodes > 100_000 || state.depth > 48) {
    throw new TypeError('proposal value exceeds structural bounds');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('proposal numbers must be finite');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new TypeError('proposal strings must not contain NUL');
    state.stringChars += value.length;
    if (state.stringChars > 4_000_000) throw new TypeError('proposal text exceeds bounds');
    return value;
  }
  if (!value || typeof value !== 'object' || util.types.isProxy(value)
    || util.types.isPromise(value) || state.seen.has(value)) {
    throw new TypeError('proposal values must be acyclic JSON data');
  }
  state.seen.add(value);
  state.depth += 1;
  try {
    let output;
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 20_000) {
        throw new TypeError('proposal arrays must be bounded plain arrays');
      }
      const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new TypeError('proposal arrays must be dense');
      }
      output = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('proposal arrays must contain data properties');
        }
        return canonicalSnapshot(descriptor.value, state);
      });
    } else {
      if (!isPlainRecord(value)) throw new TypeError('proposal objects must be plain');
      const keys = Reflect.ownKeys(value).sort();
      if (keys.length > 20_000
        || keys.some((key) => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) {
        throw new TypeError('proposal objects contain unsupported keys');
      }
      output = {};
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
          throw new TypeError('proposal objects must contain data properties');
        }
        Object.defineProperty(output, key, {
          enumerable: true,
          value: canonicalSnapshot(descriptor.value, state),
        });
      }
    }
    return Object.freeze(output);
  } finally {
    state.depth -= 1;
    state.seen.delete(value);
  }
}

function normalizeText(value, fieldName, maximum = 32_768) {
  if (typeof value !== 'string' || value !== value.trim()
    || !value || value.includes('\0') || value.length > maximum) {
    throw new TypeError(fieldName + ' must be bounded text');
  }
  return value;
}

function normalizeIdentifier(value, fieldName) {
  const normalized = normalizeText(value, fieldName, 256);
  if (!SAFE_IDENTIFIER.test(normalized)) {
    throw new TypeError(fieldName + ' must be a safe identifier');
  }
  return normalized;
}

function normalizePortableAbsolutePath(value) {
  const normalized = normalizeText(value, 'rootPath');
  const absolute = normalized.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(normalized)
    || /^\\\\[^\\]/.test(normalized);
  if (!absolute || normalized === '/' || /^[A-Za-z]:[\\/]?$/.test(normalized)) {
    throw new TypeError('rootPath must be a non-root absolute path');
  }
  return normalized;
}

function normalizeDigest(value, fieldName, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !SAFE_DIGEST.test(value)) {
    throw new TypeError(fieldName + ' must be a SHA-256 digest');
  }
  return value;
}

function normalizeRevision(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(fieldName + ' must be a positive revision');
  }
  return value;
}

function normalizeTimestamp(value, fieldName, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw new TypeError(fieldName + ' must be an ISO timestamp');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(fieldName + ' must be an ISO timestamp');
  }
  return value;
}

function patchDigest(patch) {
  const bytes = Buffer.from(JSON.stringify(patch), 'utf8');
  if (bytes.length > MAX_PATCH_BYTES) throw new TypeError('patch exceeds byte bound');
  return 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalizeMapChatProposalPatch(value) {
  const patch = canonicalSnapshot(value);
  if (!isPlainRecord(patch) || Reflect.ownKeys(patch).length === 0) {
    throw new TypeError('patch must be a non-empty plain object');
  }
  return patch;
}

function computeMapChatProposalPatchDigest(value) {
  return patchDigest(canonicalizeMapChatProposalPatch(value));
}

function normalizePreview(value) {
  const fields = dataFields(value, PREVIEW_KEYS);
  if (!fields) throw new TypeError('preview input is invalid');
  const surface = normalizeIdentifier(fields.get('surface'), 'surface');
  const target = normalizeIdentifier(fields.get('target'), 'target');
  if (!['map_chat', 'map_render'].includes(surface)
    || !['application_map', 'milestones'].includes(target)) {
    throw new TypeError('preview surface or target is unsupported');
  }
  const patch = canonicalizeMapChatProposalPatch(fields.get('patch'));
  return Object.freeze({
    projectId: normalizeIdentifier(fields.get('projectId'), 'projectId'),
    rootPath: normalizePortableAbsolutePath(fields.get('rootPath')),
    conversationId: normalizeIdentifier(fields.get('conversationId'), 'conversationId'),
    surface,
    target,
    baseDigest: normalizeDigest(fields.get('baseDigest'), 'baseDigest', { nullable: true }),
    patch,
    patchDigest: patchDigest(patch),
  });
}

function normalizeApproval(value) {
  const fields = dataFields(value, APPROVAL_KEYS);
  if (!fields) throw new TypeError('approval input is invalid');
  return Object.freeze({
    proposalId: normalizeIdentifier(fields.get('proposalId'), 'proposalId'),
    expectedRevision: normalizeRevision(fields.get('expectedRevision'), 'expectedRevision'),
    patchDigest: normalizeDigest(fields.get('patchDigest'), 'patchDigest'),
  });
}

function normalizeSettlement(value) {
  const fields = dataFields(value, SETTLEMENT_KEYS);
  if (!fields) throw new TypeError('settlement input is invalid');
  const outcome = fields.get('outcome');
  const failureCode = fields.get('failureCode');
  if (!['applied', 'failed'].includes(outcome)
    || (outcome === 'applied' && failureCode !== null)
    || (outcome === 'failed'
      && (typeof failureCode !== 'string' || !SAFE_IDENTIFIER.test(failureCode)))) {
    throw new TypeError('settlement outcome is invalid');
  }
  return Object.freeze({
    proposalId: normalizeIdentifier(fields.get('proposalId'), 'proposalId'),
    expectedRevision: normalizeRevision(fields.get('expectedRevision'), 'expectedRevision'),
    outcome,
    failureCode,
  });
}

function normalizeFilters(value) {
  const fields = dataFields(value, FILTER_KEYS, { exact: false });
  if (!fields) throw new TypeError('proposal filters are invalid');
  const output = {};
  for (const key of FILTER_KEYS) {
    if (!fields.has(key)) continue;
    const normalized = normalizeIdentifier(fields.get(key), key);
    if (key === 'status' && !ALL_STATUSES.has(normalized)) {
      throw new TypeError('status filter is invalid');
    }
    output[key] = normalized;
  }
  return Object.freeze(output);
}

function isOwnedByCurrentUser(stat) {
  return typeof process.getuid !== 'function' || Number(stat.uid) === process.getuid();
}

function normalizeOptions(options) {
  const fields = dataFields(options, OPTION_KEYS, { exact: false });
  if (!fields || !fields.has('storageDir')) {
    throw new TypeError('storageDir is required');
  }
  const storageDir = fields.get('storageDir');
  if (typeof storageDir !== 'string' || storageDir !== storageDir.trim()
    || storageDir.includes('\0') || !path.isAbsolute(storageDir)) {
    throw new TypeError('storageDir must be absolute');
  }
  const resolvedStorageDir = path.resolve(storageDir);
  if (resolvedStorageDir === path.parse(resolvedStorageDir).root) {
    throw new TypeError('storageDir must not be a filesystem root');
  }
  const now = fields.has('now') ? fields.get('now') : () => Date.now();
  const idFactory = fields.has('idFactory')
    ? fields.get('idFactory')
    : () => 'proposal-' + crypto.randomUUID();
  const maxRecords = fields.has('maxRecords')
    ? fields.get('maxRecords')
    : DEFAULT_MAX_RECORDS;
  if (typeof now !== 'function' || util.types.isProxy(now)
    || typeof idFactory !== 'function' || util.types.isProxy(idFactory)
    || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
    throw new TypeError('proposal store options are invalid');
  }
  return Object.freeze({
    storageDir: resolvedStorageDir,
    now,
    idFactory,
    maxRecords,
  });
}

function emptyState() {
  return {
    schemaVersion: MAP_CHAT_PROPOSAL_FILE_SCHEMA_VERSION,
    storeRevision: 0,
    proposals: [],
  };
}

function validateStoredRecord(value) {
  const fields = dataFields(value, RECORD_KEYS);
  if (!fields
    || fields.get('schemaVersion') !== MAP_CHAT_PROPOSAL_RECORD_SCHEMA_VERSION) {
    throw new TypeError('proposal record schema is invalid');
  }
  normalizeIdentifier(fields.get('proposalId'), 'proposalId');
  normalizeRevision(fields.get('revision'), 'revision');
  normalizeIdentifier(fields.get('projectId'), 'projectId');
  normalizePortableAbsolutePath(fields.get('rootPath'));
  normalizeIdentifier(fields.get('conversationId'), 'conversationId');
  if (!['map_chat', 'map_render'].includes(fields.get('surface'))
    || !['application_map', 'milestones'].includes(fields.get('target'))
    || !ALL_STATUSES.has(fields.get('status'))) {
    throw new TypeError('proposal record enum is invalid');
  }
  normalizeDigest(fields.get('baseDigest'), 'baseDigest', { nullable: true });
  const patch = canonicalSnapshot(fields.get('patch'));
  const storedPatchDigest = normalizeDigest(fields.get('patchDigest'), 'patchDigest');
  if (patchDigest(patch) !== storedPatchDigest) {
    throw new TypeError('proposal patch digest is invalid');
  }
  const failureCode = fields.get('failureCode');
  if (failureCode !== null
    && (typeof failureCode !== 'string' || !SAFE_IDENTIFIER.test(failureCode))) {
    throw new TypeError('proposal failure code is invalid');
  }
  const supersededBy = fields.get('supersededBy');
  if (supersededBy !== null) normalizeIdentifier(supersededBy, 'supersededBy');
  normalizeTimestamp(fields.get('createdAt'), 'createdAt');
  normalizeTimestamp(fields.get('updatedAt'), 'updatedAt');
  normalizeTimestamp(fields.get('resolvedAt'), 'resolvedAt', { nullable: true });
  if (TERMINAL_STATUSES.has(fields.get('status')) !== (fields.get('resolvedAt') !== null)) {
    throw new TypeError('proposal resolution timestamp is inconsistent');
  }
  if ((fields.get('status') === 'failed') !== (failureCode !== null)
    || (fields.get('status') === 'superseded') !== (supersededBy !== null)) {
    throw new TypeError('proposal terminal metadata is inconsistent');
  }
}

function validateState(value, maxRecords) {
  const fields = dataFields(value, FILE_KEYS);
  if (!fields || fields.get('schemaVersion') !== MAP_CHAT_PROPOSAL_FILE_SCHEMA_VERSION
    || !Number.isSafeInteger(fields.get('storeRevision')) || fields.get('storeRevision') < 0) {
    throw new TypeError('proposal file envelope is invalid');
  }
  const proposals = fields.get('proposals');
  if (!Array.isArray(proposals) || Object.getPrototypeOf(proposals) !== Array.prototype
    || proposals.length > maxRecords) {
    throw new TypeError('proposal file records are invalid');
  }
  const keys = Reflect.ownKeys(proposals).filter((key) => key !== 'length');
  if (keys.length !== proposals.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError('proposal file records must be dense');
  }
  const ids = new Set();
  for (const proposal of proposals) {
    validateStoredRecord(proposal);
    if (ids.has(proposal.proposalId)) throw new TypeError('duplicate proposalId');
    ids.add(proposal.proposalId);
  }
  return value;
}

function createMapChatProposalStore(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const storePath = path.join(options.storageDir, STORE_FILE_NAME);

  function nowIso() {
    let value;
    try {
      value = Reflect.apply(options.now, undefined, []);
    } catch {
      throw new TypeError('now failed');
    }
    const milliseconds = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(milliseconds)) throw new TypeError('now must return a timestamp');
    return new Date(milliseconds).toISOString();
  }

  function ensureDirectory() {
    try {
      if (!fs.existsSync(options.storageDir)) {
        fs.mkdirSync(options.storageDir, { recursive: true, mode: 0o700 });
      }
      const stat = fs.lstatSync(options.storageDir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat)) {
        fault(MAP_CHAT_PROPOSAL_STORE_REASONS.STORAGE_UNAVAILABLE);
      }
      if (process.platform !== 'win32') fs.chmodSync(options.storageDir, 0o700);
    } catch (error) {
      if (error instanceof ProposalStoreFault) throw error;
      fault(MAP_CHAT_PROPOSAL_STORE_REASONS.STORAGE_UNAVAILABLE);
    }
  }

  function readState() {
    ensureDirectory();
    let stat;
    try {
      stat = fs.lstatSync(storePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyState();
      fault(MAP_CHAT_PROPOSAL_STORE_REASONS.STORAGE_UNAVAILABLE);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat)
      || stat.size < 2 || stat.size > MAX_STORE_BYTES) {
      fault(MAP_CHAT_PROPOSAL_STORE_REASONS.STORAGE_CORRUPTED);
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      return validateState(parsed, options.maxRecords);
    } catch (error) {
      if (error instanceof ProposalStoreFault) throw error;
      fault(MAP_CHAT_PROPOSAL_STORE_REASONS.STORAGE_CORRUPTED);
    }
  }

  function syncDirectory() {
    let descriptor;
    try {
      descriptor = fs.openSync(
        options.storageDir,
        fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0),
      );
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (!(process.platform === 'win32'
        && error && WINDOWS_DIRECTORY_SYNC_UNSUPPORTED_CODES.has(error.code))) throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  function writeState(state) {
    validateState(state, options.maxRecords);
    const serialized = JSON.stringify(canonicalSnapshot(state), null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
      fault(MAP_CHAT_PROPOSAL_STORE_REASONS.CAPACITY_EXCEEDED);
    }
    const temporaryPath = path.join(
      options.storageDir,
      '.' + STORE_FILE_NAME + '.' + process.pid + '.'
        + crypto.randomBytes(12).toString('hex') + '.tmp',
    );
    let descriptor;
    let renamed = false;
    try {
      descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW || 0),
        0o600,
      );
      if (process.platform !== 'win32') fs.fchmodSync(descriptor, 0o600);
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, storePath);
      renamed = true;
      if (process.platform !== 'win32') fs.chmodSync(storePath, 0o600);
      syncDirectory();
    } catch (error) {
      if (error instanceof ProposalStoreFault) throw error;
      fault(MAP_CHAT_PROPOSAL_STORE_REASONS.STORAGE_UNAVAILABLE);
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      if (!renamed) {
        try { fs.unlinkSync(temporaryPath); } catch {}
      }
    }
  }

  function handleFault(error) {
    return deny(error instanceof ProposalStoreFault
      ? error.code
      : MAP_CHAT_PROPOSAL_STORE_REASONS.STORAGE_UNAVAILABLE);
  }

  function snapshot(record) {
    return canonicalSnapshot(record);
  }

  function success(record) {
    return Object.freeze({ ok: true, proposal: snapshot(record) });
  }

  function findRecord(state, proposalId) {
    return state.proposals.find((record) => record.proposalId === proposalId) || null;
  }

  function persistMutation(state) {
    state.storeRevision += 1;
    writeState(state);
  }

  function createPreview(rawInput) {
    let input;
    try {
      input = normalizePreview(rawInput);
    } catch {
      return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT);
    }
    try {
      const state = readState();
      const applying = state.proposals.some((record) => (
        record.projectId === input.projectId
        && record.rootPath === input.rootPath
        && record.conversationId === input.conversationId
        && record.surface === input.surface
        && record.target === input.target
        && record.status === 'applying'
      ));
      if (applying) return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.APPLY_IN_PROGRESS);

      if (state.proposals.length >= options.maxRecords) {
        state.proposals = state.proposals.filter((record) => !TERMINAL_STATUSES.has(record.status));
      }
      if (state.proposals.length >= options.maxRecords) {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.CAPACITY_EXCEEDED);
      }

      let proposalId;
      try {
        proposalId = normalizeIdentifier(
          Reflect.apply(options.idFactory, undefined, []),
          'proposalId',
        );
      } catch {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT);
      }
      if (findRecord(state, proposalId)) {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT);
      }
      const timestamp = nowIso();
      for (const record of state.proposals) {
        if (record.projectId === input.projectId
          && record.rootPath === input.rootPath
          && record.conversationId === input.conversationId
          && record.surface === input.surface
          && record.target === input.target
          && record.status === 'pending') {
          record.status = 'superseded';
          record.revision += 1;
          record.updatedAt = timestamp;
          record.resolvedAt = timestamp;
          record.supersededBy = proposalId;
        }
      }
      const record = {
        schemaVersion: MAP_CHAT_PROPOSAL_RECORD_SCHEMA_VERSION,
        proposalId,
        revision: 1,
        projectId: input.projectId,
        rootPath: input.rootPath,
        conversationId: input.conversationId,
        surface: input.surface,
        target: input.target,
        baseDigest: input.baseDigest,
        patchDigest: input.patchDigest,
        patch: input.patch,
        status: 'pending',
        failureCode: null,
        supersededBy: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        resolvedAt: null,
      };
      state.proposals.push(record);
      persistMutation(state);
      return success(record);
    } catch (error) {
      return handleFault(error);
    }
  }

  function getProposal(rawProposalId) {
    let proposalId;
    try {
      proposalId = normalizeIdentifier(rawProposalId, 'proposalId');
    } catch {
      return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT);
    }
    try {
      const record = findRecord(readState(), proposalId);
      return record ? success(record) : deny(MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_FOUND);
    } catch (error) {
      return handleFault(error);
    }
  }

  function claimApproval(rawInput) {
    let input;
    try {
      input = normalizeApproval(rawInput);
    } catch {
      return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT);
    }
    try {
      const state = readState();
      const record = findRecord(state, input.proposalId);
      if (!record) return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_FOUND);
      if (record.status !== 'pending') {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_PENDING);
      }
      if (record.revision !== input.expectedRevision) {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.REVISION_CONFLICT);
      }
      if (record.patchDigest !== input.patchDigest) {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.DIGEST_MISMATCH);
      }
      record.status = 'applying';
      record.revision += 1;
      record.updatedAt = nowIso();
      persistMutation(state);
      return success(record);
    } catch (error) {
      return handleFault(error);
    }
  }

  function settleApproval(rawInput) {
    let input;
    try {
      input = normalizeSettlement(rawInput);
    } catch {
      return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT);
    }
    try {
      const state = readState();
      const record = findRecord(state, input.proposalId);
      if (!record) return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_FOUND);
      if (record.status !== 'applying') {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_APPLYING);
      }
      if (record.revision !== input.expectedRevision) {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.REVISION_CONFLICT);
      }
      const timestamp = nowIso();
      record.status = input.outcome;
      record.failureCode = input.failureCode;
      record.revision += 1;
      record.updatedAt = timestamp;
      record.resolvedAt = timestamp;
      persistMutation(state);
      return success(record);
    } catch (error) {
      return handleFault(error);
    }
  }

  function rejectPreview(rawInput) {
    let input;
    try {
      input = normalizeApproval(rawInput);
    } catch {
      return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT);
    }
    try {
      const state = readState();
      const record = findRecord(state, input.proposalId);
      if (!record) return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_FOUND);
      if (record.status !== 'pending') {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.NOT_PENDING);
      }
      if (record.revision !== input.expectedRevision) {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.REVISION_CONFLICT);
      }
      if (record.patchDigest !== input.patchDigest) {
        return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.DIGEST_MISMATCH);
      }
      const timestamp = nowIso();
      record.status = 'rejected';
      record.revision += 1;
      record.updatedAt = timestamp;
      record.resolvedAt = timestamp;
      persistMutation(state);
      return success(record);
    } catch (error) {
      return handleFault(error);
    }
  }

  function listProposals(rawFilters = {}) {
    let filters;
    try {
      filters = normalizeFilters(rawFilters);
    } catch {
      return deny(MAP_CHAT_PROPOSAL_STORE_REASONS.INVALID_INPUT);
    }
    try {
      const proposals = readState().proposals
        .filter((record) => Object.entries(filters)
          .every(([key, value]) => record[key] === value))
        .map(snapshot);
      return Object.freeze({
        ok: true,
        proposals: Object.freeze(proposals),
      });
    } catch (error) {
      return handleFault(error);
    }
  }

  ensureDirectory();
  return Object.freeze({
    version: MAP_CHAT_PROPOSAL_STORE_VERSION,
    claimApproval,
    createPreview,
    getProposal,
    listProposals,
    rejectPreview,
    settleApproval,
  });
}

module.exports = {
  MAP_CHAT_PROPOSAL_STORE_REASONS,
  MAP_CHAT_PROPOSAL_STORE_VERSION,
  canonicalizeMapChatProposalPatch,
  computeMapChatProposalPatchDigest,
  createMapChatProposalStore,
};
