'use strict';

const crypto = require('crypto');
const util = require('util');

const {
  createCapabilityDelegationBinding,
  normalizeDigest,
} = require('./capability_delegation_contracts');
const {
  preflightDataGraph,
} = require('./execution_workspace_contract');

const PROJECT_ROOT_AUTHORITY_BACKEND_VERSION = 'project-root-authority-backend.v2';
const PROJECT_ROOT_AUTHORITY_PROBE_VERSION = 'project-root-authority-probe.v1';
const PROJECT_ROOT_AUTHORITY_ACQUIRE_REQUEST_VERSION =
  'project-root-authority-acquire-request.v1';
const PROJECT_ROOT_AUTHORITY_LEASE_VERSION = 'project-root-authority-lease.v2';
const PROJECT_ROOT_AUTHORITY_CLOSE_RECEIPT_VERSION =
  'project-root-authority-close-receipt.v1';
const PROJECT_ROOT_READER_VERSION = 'project-root-reader.v3';
const PROJECT_ROOT_PHYSICAL_IDENTITY_VERSION =
  'project-root-physical-identity.v1';

const PROJECT_ROOT_AUTHORITY_STATES = Object.freeze({
  ENFORCED: 'enforced',
  UNAVAILABLE: 'unavailable',
});

const PROJECT_ROOT_AUTHORITY_GUARANTEES = Object.freeze({
  PINNED_PHYSICAL_ROOT: 'pinned_physical_root',
  HANDLE_RELATIVE_READ: 'handle_relative_read',
  HANDLE_RELATIVE_INSPECT: 'handle_relative_inspect',
  NO_SYMLINK_TRAVERSAL: 'no_symlink_traversal',
  NO_PATHNAME_REOPEN: 'no_pathname_reopen',
  AUTHENTICATED_CLOSE: 'authenticated_close',
});

const PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES = Object.freeze([
  PROJECT_ROOT_AUTHORITY_GUARANTEES.PINNED_PHYSICAL_ROOT,
  PROJECT_ROOT_AUTHORITY_GUARANTEES.HANDLE_RELATIVE_READ,
  PROJECT_ROOT_AUTHORITY_GUARANTEES.HANDLE_RELATIVE_INSPECT,
  PROJECT_ROOT_AUTHORITY_GUARANTEES.NO_SYMLINK_TRAVERSAL,
  PROJECT_ROOT_AUTHORITY_GUARANTEES.NO_PATHNAME_REOPEN,
  PROJECT_ROOT_AUTHORITY_GUARANTEES.AUTHENTICATED_CLOSE,
]);

const PROJECT_ROOT_AUTHORITY_PURPOSES = Object.freeze([
  'project_scan',
  'execution',
  'mutation_prepare',
  'recovery',
]);

const PROJECT_ROOT_PHYSICAL_IDENTITY_KEYS = Object.freeze([
  'device',
  'inode',
  'entryDevice',
  'entryInode',
  'entryType',
]);

const PROJECT_ROOT_ENTRY_KINDS = Object.freeze({
  DIRECTORY: 'directory',
  FILE: 'file',
  OTHER: 'other',
  SYMLINK: 'symlink',
});

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_RELATIVE_PATH_BYTES = 4096;
const MAX_ENTRY_NAME_BYTES = 255;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_LIST_ENTRIES = 100_000;
const MAX_ENTRY_INSPECTION_BYTES = 16 * 1024 * 1024;
const MAX_LINK_TARGET_BYTES = 4096;
const MAX_MTIME_MS = 8_640_000_000_000_000;
const SUPPORTED_STATES = new Set(Object.values(PROJECT_ROOT_AUTHORITY_STATES));
const SUPPORTED_GUARANTEES = new Set(Object.values(PROJECT_ROOT_AUTHORITY_GUARANTEES));
const SUPPORTED_PURPOSES = new Set(PROJECT_ROOT_AUTHORITY_PURPOSES);
const SUPPORTED_ENTRY_KINDS = new Set(Object.values(PROJECT_ROOT_ENTRY_KINDS));

class ProjectRootAuthorityUnavailableError extends Error {
  constructor(message = 'No enforced project-root authority backend is available.') {
    super(message);
    this.name = 'ProjectRootAuthorityUnavailableError';
    this.code = 'PROJECT_ROOT_AUTHORITY_UNAVAILABLE';
  }
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)
    || util.types.isProxy(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    preflightDataGraph(error);
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      preflightDataGraph(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseDataValues(value, fieldName, maximum) {
  const preflight = preflightDataGraph(value);
  if (!preflight.bounded || preflight.hasNativePromise || !preflight.inspectable
    || !Array.isArray(value) || util.types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum) {
    throw new TypeError(`${fieldName} must be a bounded dense array`);
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be a bounded dense array`);
  }
  return keys.map((key) => Object.getOwnPropertyDescriptor(value, key).value);
}

function normalizeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${fieldName} must be a safe identifier`);
  }
  return value;
}

function normalizeIdentityDigest(value, fieldName) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${fieldName} must be a canonical SHA-256 digest`);
  }
  return normalizeDigest(value, fieldName);
}

function createProjectRootPhysicalIdentityDigest(value) {
  const fields = exactDataFields(value, PROJECT_ROOT_PHYSICAL_IDENTITY_KEYS);
  if (!fields) throw new TypeError('Invalid project-root physical identity');
  const identity = {};
  for (const field of PROJECT_ROOT_PHYSICAL_IDENTITY_KEYS) {
    const entry = fields.get(field);
    if (typeof entry !== 'string' || !entry || entry.includes('\0')
      || Buffer.byteLength(entry, 'utf8') > 256) {
      throw new TypeError('Invalid project-root physical identity');
    }
    identity[field] = entry;
  }
  if (!['directory', 'symlink'].includes(identity.entryType)) {
    throw new TypeError('Invalid project-root physical identity');
  }
  const core = {
    version: PROJECT_ROOT_PHYSICAL_IDENTITY_VERSION,
    identity: {
      device: identity.device,
      inode: identity.inode,
      entryDevice: identity.entryDevice,
      entryInode: identity.entryInode,
      entryType: identity.entryType,
    },
  };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex')}`;
}

function normalizeRelativePath(value, fieldName, { allowRoot = true } = {}) {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)
    || Buffer.byteLength(value, 'utf8') > MAX_RELATIVE_PATH_BYTES
    || (!allowRoot && !value)) {
    throw new TypeError(`${fieldName} must be a bounded POSIX relative path`);
  }
  if (!value) return '';
  const components = value.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) {
    throw new TypeError(`${fieldName} must be a normalized POSIX relative path`);
  }
  return value;
}

function normalizeEntryName(value, fieldName) {
  if (typeof value !== 'string' || !value || value.includes('\0')
    || value.includes('/') || value.includes('\\') || value === '.' || value === '..'
    || Buffer.byteLength(value, 'utf8') > MAX_ENTRY_NAME_BYTES) {
    throw new TypeError(`${fieldName} must be one safe path component`);
  }
  return value;
}

function assertAuthorityMethod(value, fieldName, { synchronous = false } = {}) {
  if (typeof value !== 'function' || util.types.isProxy(value)
    || util.types.isGeneratorFunction(value)
    || (synchronous && util.types.isAsyncFunction(value))) {
    throw new TypeError(`${fieldName} must be an inspectable function`);
  }
  let keys;
  try { keys = Reflect.ownKeys(value); } catch (error) {
    preflightDataGraph(error);
    throw new TypeError(`${fieldName} must be inspectable`);
  }
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'string'
      || !descriptor
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable === true;
  })) {
    throw new TypeError(`${fieldName} must not carry enumerable authority`);
  }
  return value;
}

function authorityDigest({ leaseId, binding, expectedPhysicalRootIdentityDigest, purpose }) {
  const core = {
    version: PROJECT_ROOT_AUTHORITY_ACQUIRE_REQUEST_VERSION,
    leaseId,
    binding: {
      projectId: binding.projectId,
      canonicalRootPath: binding.canonicalRootPath,
      realRootPath: binding.realRootPath,
      sessionId: binding.sessionId,
      jobId: binding.jobId,
      kernelId: binding.kernelId,
      submissionDigest: binding.submissionDigest,
    },
    expectedPhysicalRootIdentityDigest,
    purpose,
  };
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex')}`;
}

function createProjectRootAuthorityAcquireRequest(input = {}) {
  const fields = exactDataFields(input, [
    'leaseId',
    'binding',
    'expectedPhysicalRootIdentityDigest',
    'purpose',
  ]);
  if (!fields) throw new TypeError('Invalid project-root authority acquire request data');
  let leaseId;
  let binding;
  let expectedPhysicalRootIdentityDigest;
  const purpose = fields.get('purpose');
  try {
    leaseId = normalizeIdentifier(fields.get('leaseId'), 'leaseId');
    binding = createCapabilityDelegationBinding(fields.get('binding'));
    expectedPhysicalRootIdentityDigest = normalizeIdentityDigest(
      fields.get('expectedPhysicalRootIdentityDigest'),
      'expectedPhysicalRootIdentityDigest'
    );
  } catch (error) {
    preflightDataGraph(error);
    throw new TypeError('Invalid project-root authority acquire request');
  }
  if (!SUPPORTED_PURPOSES.has(purpose)) {
    throw new TypeError('Invalid project-root authority purpose');
  }
  return Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_ACQUIRE_REQUEST_VERSION,
    leaseId,
    binding,
    expectedPhysicalRootIdentityDigest,
    purpose,
    authorityDigest: authorityDigest({
      leaseId,
      binding,
      expectedPhysicalRootIdentityDigest,
      purpose,
    }),
  });
}

function assertProjectRootAuthorityAcquireRequest(value) {
  const fields = exactDataFields(value, [
    'version',
    'leaseId',
    'binding',
    'expectedPhysicalRootIdentityDigest',
    'purpose',
    'authorityDigest',
  ]);
  if (!fields || fields.get('version') !== PROJECT_ROOT_AUTHORITY_ACQUIRE_REQUEST_VERSION) {
    throw new TypeError('Invalid project-root authority acquire request');
  }
  const canonical = createProjectRootAuthorityAcquireRequest({
    leaseId: fields.get('leaseId'),
    binding: fields.get('binding'),
    expectedPhysicalRootIdentityDigest: fields.get('expectedPhysicalRootIdentityDigest'),
    purpose: fields.get('purpose'),
  });
  if (fields.get('authorityDigest') !== canonical.authorityDigest) {
    throw new TypeError('Invalid project-root authority request binding');
  }
  return canonical;
}

function normalizeGuarantees(value) {
  const values = denseDataValues(value, 'project-root authority guarantees', 16);
  const seen = new Set();
  for (const guarantee of values) {
    if (!SUPPORTED_GUARANTEES.has(guarantee) || seen.has(guarantee)) {
      throw new TypeError('Invalid project-root authority guarantee');
    }
    seen.add(guarantee);
  }
  return Object.freeze(PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES.filter(
    (guarantee) => seen.has(guarantee)
  ));
}

function createProjectRootAuthorityProbeResult(input = {}) {
  const fields = exactDataFields(input, ['state', 'guarantees', 'reasonCode'], [
    'state',
    'guarantees',
  ]);
  if (!fields) throw new TypeError('Invalid project-root authority probe data');
  const state = fields.get('state');
  const guarantees = normalizeGuarantees(fields.get('guarantees'));
  const reasonCode = fields.has('reasonCode') ? fields.get('reasonCode') : null;
  if (!SUPPORTED_STATES.has(state)) throw new TypeError('Invalid project-root authority state');
  if (state === PROJECT_ROOT_AUTHORITY_STATES.ENFORCED
    && (!PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES.every((entry) => guarantees.includes(entry))
      || reasonCode !== null)) {
    throw new TypeError('Enforced project-root authority is missing a required guarantee');
  }
  if (state === PROJECT_ROOT_AUTHORITY_STATES.UNAVAILABLE
    && (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode))) {
    throw new TypeError('Unavailable project-root authority requires a safe reasonCode');
  }
  return Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_PROBE_VERSION,
    state,
    guarantees,
    reasonCode,
  });
}

function assertProjectRootAuthorityProbeResult(value) {
  const fields = exactDataFields(value, ['version', 'state', 'guarantees', 'reasonCode']);
  if (!fields || fields.get('version') !== PROJECT_ROOT_AUTHORITY_PROBE_VERSION) {
    throw new TypeError('Invalid project-root authority probe result');
  }
  return createProjectRootAuthorityProbeResult({
    state: fields.get('state'),
    guarantees: fields.get('guarantees'),
    reasonCode: fields.get('reasonCode'),
  });
}

function createProjectRootEntryInspectionRequest(input = {}) {
  const fields = exactDataFields(input, ['relativePath']);
  if (!fields) throw new TypeError('Invalid project-root entry inspection request');
  return Object.freeze({
    relativePath: normalizeRelativePath(
      fields.get('relativePath'),
      'relativePath',
      { allowRoot: false }
    ),
  });
}

function assertProjectRootEntryInspectionResult(value, expectedRequest) {
  createProjectRootEntryInspectionRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'found',
    'kind',
    'bytes',
    'mode',
    'mtimeMs',
    'contentDigest',
    'linkTarget',
    'entryIdentityDigest',
  ]);
  if (!fields || typeof fields.get('found') !== 'boolean') {
    throw new TypeError('Invalid project-root entry inspection result');
  }
  if (!fields.get('found')) {
    for (const key of [
      'kind',
      'bytes',
      'mode',
      'mtimeMs',
      'contentDigest',
      'linkTarget',
      'entryIdentityDigest',
    ]) {
      if (fields.get(key) !== null) {
        throw new TypeError('Missing project-root entry inspection fields must be null');
      }
    }
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

  const kind = fields.get('kind');
  const bytes = fields.get('bytes');
  const mode = fields.get('mode');
  const mtimeMs = fields.get('mtimeMs');
  if (!SUPPORTED_ENTRY_KINDS.has(kind)
    || !Number.isSafeInteger(bytes) || bytes < 0 || Object.is(bytes, -0)
    || bytes > MAX_ENTRY_INSPECTION_BYTES
    || !Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777 || Object.is(mode, -0)
    || !Number.isFinite(mtimeMs) || mtimeMs < 0 || mtimeMs > MAX_MTIME_MS
    || Object.is(mtimeMs, -0)) {
    throw new TypeError('Invalid project-root entry inspection metadata');
  }
  const entryIdentityDigest = normalizeIdentityDigest(
    fields.get('entryIdentityDigest'),
    'entryIdentityDigest'
  );
  let contentDigest = fields.get('contentDigest');
  let linkTarget = fields.get('linkTarget');

  if (kind === PROJECT_ROOT_ENTRY_KINDS.FILE) {
    contentDigest = normalizeIdentityDigest(contentDigest, 'contentDigest');
    if (linkTarget !== null) {
      throw new TypeError('Invalid project-root file inspection result');
    }
  } else if (kind === PROJECT_ROOT_ENTRY_KINDS.SYMLINK) {
    if (typeof linkTarget !== 'string' || !linkTarget || linkTarget.includes('\0')
      || Buffer.byteLength(linkTarget, 'utf8') > MAX_LINK_TARGET_BYTES
      || Buffer.byteLength(linkTarget, 'utf8') !== bytes) {
      throw new TypeError('Invalid project-root symlink inspection result');
    }
    contentDigest = normalizeIdentityDigest(contentDigest, 'contentDigest');
    const expectedDigest = `sha256:${crypto.createHash('sha256')
      .update(Buffer.from(linkTarget, 'utf8'))
      .digest('hex')}`;
    if (contentDigest !== expectedDigest) {
      throw new TypeError('Invalid project-root symlink inspection digest');
    }
  } else {
    if (bytes !== 0 || contentDigest !== null || linkTarget !== null) {
      throw new TypeError('Invalid project-root non-file inspection result');
    }
    contentDigest = null;
    linkTarget = null;
  }

  return Object.freeze({
    found: true,
    kind,
    bytes,
    mode,
    mtimeMs,
    contentDigest,
    linkTarget,
    entryIdentityDigest,
  });
}

function createProjectRootListRequest(input = {}) {
  const fields = exactDataFields(input, ['relativePath', 'maxEntries']);
  if (!fields) throw new TypeError('Invalid project-root list request');
  const maxEntries = fields.get('maxEntries');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_LIST_ENTRIES) {
    throw new TypeError('Project-root list maxEntries is invalid');
  }
  return Object.freeze({
    relativePath: normalizeRelativePath(fields.get('relativePath'), 'relativePath'),
    maxEntries,
  });
}

function assertProjectRootListResult(value, expectedRequest) {
  const request = createProjectRootListRequest(expectedRequest);
  const fields = exactDataFields(value, ['entries', 'truncated']);
  if (!fields || typeof fields.get('truncated') !== 'boolean') {
    throw new TypeError('Invalid project-root list result');
  }
  const rawEntries = denseDataValues(fields.get('entries'), 'project-root entries', request.maxEntries);
  const names = new Set();
  const entries = rawEntries.map((entry, index) => {
    const entryFields = exactDataFields(entry, ['name', 'kind']);
    if (!entryFields || !SUPPORTED_ENTRY_KINDS.has(entryFields.get('kind'))) {
      throw new TypeError(`Invalid project-root entry at index ${index}`);
    }
    const name = normalizeEntryName(entryFields.get('name'), `entries[${index}].name`);
    if (names.has(name)) throw new TypeError('Project-root list entries must be unique');
    names.add(name);
    return Object.freeze({ name, kind: entryFields.get('kind') });
  });
  if (fields.get('truncated') === true && entries.length !== request.maxEntries) {
    throw new TypeError('Truncated project-root list must consume its requested bound');
  }
  return Object.freeze({ entries: Object.freeze(entries), truncated: fields.get('truncated') });
}

function createProjectRootReadFileRequest(input = {}) {
  const fields = exactDataFields(input, ['relativePath', 'maxBytes']);
  if (!fields) throw new TypeError('Invalid project-root read request');
  const maxBytes = fields.get('maxBytes');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_READ_BYTES) {
    throw new TypeError('Project-root read maxBytes is invalid');
  }
  return Object.freeze({
    relativePath: normalizeRelativePath(fields.get('relativePath'), 'relativePath', { allowRoot: false }),
    maxBytes,
  });
}

function assertProjectRootReadFileResult(value, expectedRequest) {
  const request = createProjectRootReadFileRequest(expectedRequest);
  const fields = exactDataFields(value, ['found', 'contentBase64', 'contentDigest']);
  if (!fields || typeof fields.get('found') !== 'boolean') {
    throw new TypeError('Invalid project-root read result');
  }
  if (!fields.get('found')) {
    if (fields.get('contentBase64') !== null || fields.get('contentDigest') !== null) {
      throw new TypeError('Missing project-root content must use null fields');
    }
    return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
  }
  const contentBase64 = fields.get('contentBase64');
  const contentDigest = fields.get('contentDigest');
  if (typeof contentBase64 !== 'string' || !BASE64_PATTERN.test(contentBase64)) {
    throw new TypeError('Project-root content is not canonical base64');
  }
  const bytes = Buffer.from(contentBase64, 'base64');
  if (bytes.length > request.maxBytes || bytes.toString('base64') !== contentBase64
    || normalizeIdentityDigest(contentDigest, 'contentDigest')
      !== `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`) {
    throw new TypeError('Project-root content exceeded its bound or digest');
  }
  return Object.freeze({ found: true, contentBase64, contentDigest });
}

function assertProjectRootReader(value) {
  const fields = exactDataFields(value, ['version', 'list', 'readFile', 'inspectEntry']);
  if (!fields || fields.get('version') !== PROJECT_ROOT_READER_VERSION || !Object.isFrozen(value)) {
    throw new TypeError('Invalid project-root reader');
  }
  assertAuthorityMethod(fields.get('list'), 'project-root reader.list');
  assertAuthorityMethod(fields.get('readFile'), 'project-root reader.readFile');
  assertAuthorityMethod(fields.get('inspectEntry'), 'project-root reader.inspectEntry');
  return value;
}

function assertProjectRootAuthorityLease(value, expectedRequest) {
  const request = assertProjectRootAuthorityAcquireRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'version',
    'leaseId',
    'jobId',
    'projectId',
    'purpose',
    'physicalRootIdentityDigest',
    'authorityDigest',
    'reader',
    'close',
  ]);
  if (!fields || fields.get('version') !== PROJECT_ROOT_AUTHORITY_LEASE_VERSION
    || !Object.isFrozen(value)
    || fields.get('leaseId') !== request.leaseId
    || fields.get('jobId') !== request.binding.jobId
    || fields.get('projectId') !== request.binding.projectId
    || fields.get('purpose') !== request.purpose
    || fields.get('physicalRootIdentityDigest') !== request.expectedPhysicalRootIdentityDigest
    || fields.get('authorityDigest') !== request.authorityDigest) {
    throw new TypeError('Invalid project-root authority lease binding');
  }
  assertProjectRootReader(fields.get('reader'));
  assertAuthorityMethod(fields.get('close'), 'project-root authority lease.close');
  return value;
}

function createProjectRootAuthorityCloseReceipt(input = {}) {
  const fields = exactDataFields(input, ['request', 'closed']);
  if (!fields || fields.get('closed') !== true) {
    throw new TypeError('Invalid project-root authority close receipt data');
  }
  const request = assertProjectRootAuthorityAcquireRequest(fields.get('request'));
  return Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_CLOSE_RECEIPT_VERSION,
    leaseId: request.leaseId,
    physicalRootIdentityDigest: request.expectedPhysicalRootIdentityDigest,
    authorityDigest: request.authorityDigest,
    closed: true,
  });
}

function assertProjectRootAuthorityCloseReceipt(value, expectedRequest) {
  const request = assertProjectRootAuthorityAcquireRequest(expectedRequest);
  const fields = exactDataFields(value, [
    'version',
    'leaseId',
    'physicalRootIdentityDigest',
    'authorityDigest',
    'closed',
  ]);
  if (!fields || fields.get('version') !== PROJECT_ROOT_AUTHORITY_CLOSE_RECEIPT_VERSION
    || fields.get('leaseId') !== request.leaseId
    || fields.get('physicalRootIdentityDigest') !== request.expectedPhysicalRootIdentityDigest
    || fields.get('authorityDigest') !== request.authorityDigest
    || fields.get('closed') !== true) {
    throw new TypeError('Invalid project-root authority close receipt');
  }
  return createProjectRootAuthorityCloseReceipt({ request, closed: true });
}

function assertProjectRootAuthorityBackend(value) {
  const fields = exactDataFields(value, ['version', 'id', 'probe', 'acquire', 'dispose']);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== PROJECT_ROOT_AUTHORITY_BACKEND_VERSION) {
    throw new TypeError('Invalid project-root authority backend');
  }
  normalizeIdentifier(fields.get('id'), 'project-root authority backend id');
  assertAuthorityMethod(fields.get('probe'), 'project-root authority backend.probe', {
    synchronous: true,
  });
  assertAuthorityMethod(fields.get('acquire'), 'project-root authority backend.acquire');
  assertAuthorityMethod(fields.get('dispose'), 'project-root authority backend.dispose');
  return value;
}

function createUnsupportedProjectRootAuthorityBackend(options = {}) {
  const fields = exactDataFields(options, ['id', 'reasonCode'], []);
  if (!fields) throw new TypeError('Invalid unsupported project-root authority options');
  const id = fields.has('id') ? fields.get('id') : 'unsupported-project-root-authority';
  const reasonCode = fields.has('reasonCode')
    ? fields.get('reasonCode')
    : 'PROJECT_ROOT_AUTHORITY_PROVIDER_UNAVAILABLE';
  normalizeIdentifier(id, 'project-root authority backend id');
  if (typeof reasonCode !== 'string' || !SAFE_REASON_CODE.test(reasonCode)) {
    throw new TypeError('Invalid project-root authority reasonCode');
  }
  return Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id,
    probe(input) {
      preflightDataGraph(input);
      return createProjectRootAuthorityProbeResult({
        state: PROJECT_ROOT_AUTHORITY_STATES.UNAVAILABLE,
        guarantees: [],
        reasonCode,
      });
    },
    acquire(input) {
      preflightDataGraph(input);
      return Promise.reject(new ProjectRootAuthorityUnavailableError(reasonCode));
    },
    dispose(input) {
      preflightDataGraph(input);
      return Promise.resolve(Object.freeze({ ok: true, disposed: true }));
    },
  });
}

module.exports = {
  MAX_LIST_ENTRIES,
  MAX_ENTRY_INSPECTION_BYTES,
  MAX_READ_BYTES,
  PROJECT_ROOT_AUTHORITY_ACQUIRE_REQUEST_VERSION,
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_CLOSE_RECEIPT_VERSION,
  PROJECT_ROOT_AUTHORITY_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_PROBE_VERSION,
  PROJECT_ROOT_AUTHORITY_PURPOSES,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_PHYSICAL_IDENTITY_VERSION,
  PROJECT_ROOT_ENTRY_KINDS,
  PROJECT_ROOT_READER_VERSION,
  ProjectRootAuthorityUnavailableError,
  createProjectRootPhysicalIdentityDigest,
  assertProjectRootAuthorityAcquireRequest,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityCloseReceipt,
  assertProjectRootAuthorityLease,
  assertProjectRootAuthorityProbeResult,
  assertProjectRootEntryInspectionResult,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  assertProjectRootReader,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootAuthorityProbeResult,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
  createUnsupportedProjectRootAuthorityBackend,
};
