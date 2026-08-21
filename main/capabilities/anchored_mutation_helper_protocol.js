'use strict';

const crypto = require('crypto');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
} = require('./anchored_filesystem_mutation_backend_contract');
const {
  immutableSnapshot,
} = require('./capability_delegation_contracts');
const {
  canonicalSha256Digest,
} = require('./transactional_delete_contracts');
const {
  assertAnchoredMutationIdentityReceipt,
} = require('./anchored_mutation_identity_receipt_contract');

const ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION =
  'anchored-mutation-helper-protocol.v3';
const ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION =
  'anchored-mutation-helper-handshake.v3';
const ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION =
  'anchored-mutation-helper.namespace-io-integration.v3';

const ANCHORED_MUTATION_HELPER_OPERATIONS = Object.freeze({
  HANDSHAKE: 'handshake',
  ROOT_NAMESPACE_OPEN: 'root_namespace.open',
  ROOT_NAMESPACE_READ_FILE: 'root_namespace.read_file',
  ROOT_NAMESPACE_LIST: 'root_namespace.list',
  ROOT_NAMESPACE_OPEN_EXISTING_SESSION: 'root_namespace.open_existing_session',
  ROOT_NAMESPACE_CLEANUP_AUTHENTICATED_ORPHAN:
    'root_namespace.cleanup_authenticated_orphan',
  ROOT_NAMESPACE_CLOSE: 'root_namespace.close',
  SESSION_OPEN: 'session.open',
  SESSION_VERIFY: 'session.verify',
  SESSION_INSPECT_PROGRESS: 'session.inspect_progress',
  SESSION_MOVE_TO_QUARANTINE: 'session.move_to_quarantine',
  SESSION_RESTORE_FROM_QUARANTINE: 'session.restore_from_quarantine',
  SESSION_PURGE_QUARANTINE: 'session.purge_quarantine',
  SESSION_CLOSE: 'session.close',
  NAMESPACE_WRITE_FILE: 'namespace.write_file',
  NAMESPACE_READ_FILE: 'namespace.read_file',
  NAMESPACE_LIST: 'namespace.list',
  NAMESPACE_REMOVE: 'namespace.remove',
  NAMESPACE_SYNC: 'namespace.sync',
  NAMESPACE_CLEANUP: 'namespace.cleanup',
});

const ANCHORED_MUTATION_HELPER_LIMITS = Object.freeze({
  maxMessageBytes: 3 * 1024 * 1024,
  maxPathHintLength: 4096,
  maxPrivateRelativePathLength: 1024,
  maxPrivateFileBytes: 2 * 1024 * 1024,
  maxNamespaceEntries: 512,
  maxTargets: 32,
  maxCheckpointEntries: 36,
  maxSequence: 1_000_000,
  maxActiveSessions: 256,
  maxTotalSessions: 65_536,
  maxRequestsPerClient: 262_144,
  maxOrphanLeaseMs: 5_000,
});
const DATA_GRAPH_PREFLIGHT_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxProperties: 200_000,
});

const MESSAGE_KINDS = Object.freeze({
  REQUEST: 'request',
  RESPONSE: 'response',
});
const NAMESPACE_POLICY = immutableSnapshot({
  privateRootName: '.faber',
  transactionNamespaceName: 'transactions',
  mode: 'create_or_open_private',
  authority: 'pinned_root_handle',
  io: 'session_mediated',
  cleanup: 'anchored_session',
  pathnameHintsAreAuthority: false,
});
const ROOT_NAMESPACE_POLICY = immutableSnapshot({
  privateRootName: '.faber',
  transactionNamespaceName: 'transactions',
  mode: 'open_existing_private_read_only',
  authority: 'pinned_root_handle',
  io: 'root_namespace_mediated',
  cleanup: 'authenticated_orphan_only',
  pathnameHintsAreAuthority: false,
});
const HANDSHAKE_REQUIREMENTS = immutableSnapshot({
  synchronousEffects: true,
  dataOnlyMessages: true,
  digestBound: true,
  sequenceBound: true,
  privateNamespaceIo: 'session_mediated',
  namespaceOpenedBeforeWrites: true,
  anchoredNamespaceCleanup: true,
  rootNamespaceBootstrap: true,
  rootNamespaceReadOnly: true,
  authenticatedOrphanCleanup: true,
  movementProgressInspection: true,
  identityContinuity: true,
  physicalIdentityReceipts: true,
  durablePhysicalProgress: true,
  sourceIdentityCompareAndSwap: true,
  subtreeMutationExcluded: true,
  atomicReplace: true,
  durableNamespaceSync: true,
  boundedListingOverflow: 'fail_closed',
  outOfBandAbort: true,
  orphanedSessionAutoClose: 'bounded_native_lease',
  maxOrphanLeaseMs: 5_000,
});
const REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'requestId',
  'operation',
  'sequence',
  'sessionId',
  'previousResponseDigest',
  'payload',
  'payloadDigest',
  'requestDigest',
]);
const RESPONSE_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'requestId',
  'operation',
  'sequence',
  'sessionId',
  'requestDigest',
  'previousResponseDigest',
  'payload',
  'payloadDigest',
  'responseDigest',
]);
const ABORT_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'sessionId',
  'namespaceCapabilityId',
  'sequence',
  'lastResponseDigest',
  'reasonCode',
  'abortDigest',
]);
const SAFE_ID = /^[A-Za-z0-9._:@-]{1,256}$/;
const SAFE_PAYLOAD_NAME = /^[A-Za-z0-9._-]{1,256}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const OPERATIONS = new Set(Object.values(ANCHORED_MUTATION_HELPER_OPERATIONS));
const ENTRY_KINDS = new Set(['directory', 'file', 'symlink']);

class AnchoredMutationHelperProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AnchoredMutationHelperProtocolError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AnchoredMutationHelperProtocolError(code, message);
}

function dataFields(value, allowedKeys, requiredKeys = allowedKeys, fieldName = 'value') {
  const preflight = absorbNativePromisesInDataGraph(value);
  if (preflight.hasNativePromise) {
    fail('PROTOCOL_ASYNC_INPUT', `${fieldName} must be synchronous plain data`);
  }
  if (!preflight.bounded) {
    fail('PROTOCOL_LIMIT_EXCEEDED', `${fieldName} exceeded the data graph bound`);
  }
  if (!preflight.inspectable) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be inspectable plain data`);
  }
  rejectAsyncInput(value, fieldName);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be a plain data record`);
  }
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be inspectable plain data`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must have a plain prototype`);
  }
  if (keys.some((key) => typeof key !== 'string')
    || keys.some((key) => !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} contains unsupported fields`);
  }
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      fail('PROTOCOL_DATA_INVALID', `${fieldName}.${key} must be a data property`);
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      fail('PROTOCOL_DATA_INVALID', `${fieldName}.${key} must be an enumerable data property`);
    }
    rejectAsyncInput(descriptor.value, `${fieldName}.${key}`);
    fields.set(key, descriptor.value);
  }
  return fields;
}

function denseDataArray(value, fieldName, { maxLength, minLength = 0 } = {}) {
  const preflight = absorbNativePromisesInDataGraph(value);
  if (preflight.hasNativePromise) {
    fail('PROTOCOL_ASYNC_INPUT', `${fieldName} must be synchronous plain data`);
  }
  if (!preflight.bounded) {
    fail('PROTOCOL_LIMIT_EXCEEDED', `${fieldName} exceeded the data graph bound`);
  }
  if (!preflight.inspectable) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be inspectable plain data`);
  }
  if (!Array.isArray(value)) fail('PROTOCOL_DATA_INVALID', `${fieldName} must be an array`);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch (error) {
    absorbNativePromise(error);
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be inspectable plain data`);
  }
  if (prototype !== Array.prototype
    || keys.length !== value.length
    || keys.some((key, index) => key !== String(index))) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be a standard dense array`);
  }
  if (value.length < minLength || (maxLength !== undefined && value.length > maxLength)) {
    fail('PROTOCOL_LIMIT_EXCEEDED', `${fieldName} is outside the protocol bounds`);
  }
  const result = [];
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      fail('PROTOCOL_DATA_INVALID', `${fieldName} must contain inspectable data values`);
    }
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('PROTOCOL_DATA_INVALID', `${fieldName} must contain data values only`);
    }
    rejectAsyncInput(descriptor.value, `${fieldName}[${key}]`);
    result.push(descriptor.value);
  }
  return result;
}

function normalizeIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be a stable identifier`);
  }
  return value;
}

function normalizeDigest(value, fieldName, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be a canonical SHA-256 digest`);
  }
  return value;
}

function normalizeBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be a boolean`);
  }
  return value;
}

function normalizeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 0
    || value > ANCHORED_MUTATION_HELPER_LIMITS.maxSequence || Object.is(value, -0)) {
    fail('PROTOCOL_SEQUENCE_INVALID', 'sequence is outside the protocol bounds');
  }
  return value;
}

function normalizeBoundedString(value, fieldName, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value)
    || value.length > maxLength || value.includes('\0')) {
    fail('PROTOCOL_LIMIT_EXCEEDED', `${fieldName} is outside the protocol bounds`);
  }
  return value;
}

function normalizePathHint(value, fieldName) {
  return normalizeBoundedString(
    value,
    fieldName,
    ANCHORED_MUTATION_HELPER_LIMITS.maxPathHintLength
  );
}

function normalizePrivateRelativePath(value, fieldName, { allowRoot = false } = {}) {
  const normalized = normalizeBoundedString(
    value,
    fieldName,
    ANCHORED_MUTATION_HELPER_LIMITS.maxPrivateRelativePathLength,
    { allowEmpty: allowRoot }
  );
  if (normalized === '' && allowRoot) return normalized;
  if (normalized.startsWith('/') || normalized.startsWith('\\')
    || normalized.includes('\\') || /^[A-Za-z]:/.test(normalized)) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be a portable relative path`);
  }
  const components = normalized.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must not escape the private namespace`);
  }
  return normalized;
}

function normalizeStringArray(value, fieldName, maxLength, { identifier = false } = {}) {
  const values = denseDataArray(value, fieldName, { maxLength });
  const result = values.map((entry, index) => (
    identifier
      ? normalizeIdentifier(entry, `${fieldName}[${index}]`)
      : normalizeBoundedString(entry, `${fieldName}[${index}]`, 256)
  ));
  if (new Set(result).size !== result.length) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must contain unique values`);
  }
  return Object.freeze(result);
}

function normalizeGuarantees(value, fieldName = 'guarantees') {
  return normalizeStringArray(value, fieldName, 64, { identifier: true });
}

function normalizeNamespacePolicy(value) {
  const fields = dataFields(
    value,
    Object.keys(NAMESPACE_POLICY),
    Object.keys(NAMESPACE_POLICY),
    'namespacePolicy'
  );
  for (const [key, expected] of Object.entries(NAMESPACE_POLICY)) {
    if (fields.get(key) !== expected) {
      fail('PROTOCOL_DOWNGRADE_DETECTED', `namespacePolicy.${key} was downgraded`);
    }
  }
  return NAMESPACE_POLICY;
}

function normalizeRootNamespacePolicy(value) {
  const fields = dataFields(
    value,
    Object.keys(ROOT_NAMESPACE_POLICY),
    Object.keys(ROOT_NAMESPACE_POLICY),
    'rootNamespacePolicy'
  );
  for (const [key, expected] of Object.entries(ROOT_NAMESPACE_POLICY)) {
    if (fields.get(key) !== expected) {
      fail('PROTOCOL_DOWNGRADE_DETECTED', `rootNamespacePolicy.${key} was downgraded`);
    }
  }
  return ROOT_NAMESPACE_POLICY;
}

function normalizeHandshakeRequirements(value) {
  const fields = dataFields(
    value,
    Object.keys(HANDSHAKE_REQUIREMENTS),
    Object.keys(HANDSHAKE_REQUIREMENTS),
    'handshake requirements'
  );
  for (const [key, expected] of Object.entries(HANDSHAKE_REQUIREMENTS)) {
    if (fields.get(key) !== expected) {
      fail('PROTOCOL_DOWNGRADE_DETECTED', `handshake requirement ${key} was downgraded`);
    }
  }
  return HANDSHAKE_REQUIREMENTS;
}

function normalizeIdentityReceipt(value, expected = {}, fieldName = 'identityReceipt') {
  try {
    return assertAnchoredMutationIdentityReceipt(value, expected);
  } catch (error) {
    absorbNativePromise(error);
    fail('PROTOCOL_IDENTITY_MISMATCH', `${fieldName} is invalid or does not match its context`);
  }
}

function normalizeOpenIdentityFields(fields, fieldName) {
  const rootIdentityDigest = normalizeDigest(
    fields.get('rootIdentityDigest'),
    `${fieldName}.rootIdentityDigest`
  );
  const namespaceIdentityDigest = normalizeDigest(
    fields.get('namespaceIdentityDigest'),
    `${fieldName}.namespaceIdentityDigest`
  );
  const targetSetIdentityDigest = normalizeDigest(
    fields.get('targetSetIdentityDigest'),
    `${fieldName}.targetSetIdentityDigest`
  );
  const identityReceipt = normalizeIdentityReceipt(
    fields.get('identityReceipt'),
    {},
    `${fieldName}.identityReceipt`
  );
  return Object.freeze({
    rootIdentityDigest,
    namespaceIdentityDigest,
    targetSetIdentityDigest,
    identityReceipt,
  });
}

function normalizeTarget(value, index) {
  const fields = dataFields(
    value,
    ['relativePath', 'payloadName'],
    ['relativePath', 'payloadName'],
    `targets[${index}]`
  );
  const relativePath = normalizePrivateRelativePath(
    fields.get('relativePath'),
    `targets[${index}].relativePath`
  );
  const payloadName = fields.get('payloadName');
  if (typeof payloadName !== 'string' || !SAFE_PAYLOAD_NAME.test(payloadName)
    || payloadName === '.' || payloadName === '..') {
    fail('PROTOCOL_DATA_INVALID', `targets[${index}].payloadName is invalid`);
  }
  return Object.freeze({ relativePath, payloadName });
}

function normalizeTargets(value) {
  const values = denseDataArray(value, 'targets', {
    minLength: 1,
    maxLength: ANCHORED_MUTATION_HELPER_LIMITS.maxTargets,
  });
  const targets = values.map(normalizeTarget);
  if (new Set(targets.map((target) => target.relativePath)).size !== targets.length
    || new Set(targets.map((target) => target.payloadName)).size !== targets.length) {
    fail('PROTOCOL_DATA_INVALID', 'targets must be unique');
  }
  return Object.freeze(targets);
}

function normalizeNonNegativeNumber(value, fieldName, { integer = false, maximum } = {}) {
  const valid = integer ? Number.isSafeInteger(value) : Number.isFinite(value);
  if (!valid || value < 0 || Object.is(value, -0) || (maximum !== undefined && value > maximum)) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be a bounded non-negative number`);
  }
  return value;
}

function normalizeCheckpointEntry(value, index) {
  const fieldName = `checkpointEntries[${index}]`;
  const fields = dataFields(value, [
    'relativePath',
    'kind',
    'bytes',
    'mode',
    'mtimeMs',
    'contentDigest',
    'linkTarget',
  ], undefined, fieldName);
  const relativePath = normalizePrivateRelativePath(
    fields.get('relativePath'),
    `${fieldName}.relativePath`
  );
  const kind = fields.get('kind');
  if (!ENTRY_KINDS.has(kind)) fail('PROTOCOL_DATA_INVALID', `${fieldName}.kind is invalid`);
  const bytes = normalizeNonNegativeNumber(fields.get('bytes'), `${fieldName}.bytes`, {
    integer: true,
    maximum: 64 * 1024 * 1024,
  });
  const mode = normalizeNonNegativeNumber(fields.get('mode'), `${fieldName}.mode`, {
    integer: true,
    maximum: 0o7777,
  });
  const mtimeMs = normalizeNonNegativeNumber(fields.get('mtimeMs'), `${fieldName}.mtimeMs`);
  const rawContentDigest = fields.get('contentDigest');
  const rawLinkTarget = fields.get('linkTarget');
  let contentDigest = null;
  let linkTarget = null;
  if (kind === 'directory') {
    if (bytes !== 0 || rawContentDigest !== null || rawLinkTarget !== null) {
      fail('PROTOCOL_DATA_INVALID', `${fieldName} directory metadata is inconsistent`);
    }
  } else {
    contentDigest = normalizeDigest(rawContentDigest, `${fieldName}.contentDigest`);
    if (kind === 'symlink') {
      linkTarget = normalizeBoundedString(rawLinkTarget, `${fieldName}.linkTarget`, 4096);
    } else if (rawLinkTarget !== null) {
      fail('PROTOCOL_DATA_INVALID', `${fieldName} file linkTarget must be null`);
    }
  }
  return Object.freeze({
    relativePath,
    kind,
    bytes,
    mode,
    mtimeMs,
    contentDigest,
    linkTarget,
  });
}

function normalizeCheckpointEntries(value) {
  const values = denseDataArray(value, 'checkpointEntries', {
    minLength: 1,
    maxLength: ANCHORED_MUTATION_HELPER_LIMITS.maxCheckpointEntries,
  });
  const entries = values.map(normalizeCheckpointEntry);
  if (new Set(entries.map((entry) => entry.relativePath)).size !== entries.length) {
    fail('PROTOCOL_DATA_INVALID', 'checkpointEntries must be unique');
  }
  return Object.freeze(entries);
}

function normalizeBase64(value, fieldName) {
  if (typeof value !== 'string' || value.length > Math.ceil(
    ANCHORED_MUTATION_HELPER_LIMITS.maxPrivateFileBytes / 3
  ) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('PROTOCOL_LIMIT_EXCEEDED', `${fieldName} must be bounded canonical base64`);
  }
  let bytes;
  try { bytes = Buffer.from(value, 'base64'); } catch {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be canonical base64`);
  }
  if (bytes.length > ANCHORED_MUTATION_HELPER_LIMITS.maxPrivateFileBytes
    || bytes.toString('base64') !== value) {
    fail('PROTOCOL_LIMIT_EXCEEDED', `${fieldName} must be bounded canonical base64`);
  }
  return Object.freeze({ value, bytes });
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function normalizeHandshakeRequestPayload(value) {
  const fields = dataFields(value, [
    'handshakeVersion',
    'backendContractVersion',
    'sessionContractVersion',
    'integrationVersion',
    'requiredGuarantees',
    'requirements',
  ], undefined, 'handshake request payload');
  if (fields.get('handshakeVersion') !== ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION
    || fields.get('backendContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION
    || fields.get('sessionContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION
    || fields.get('integrationVersion') !== ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION) {
    fail('PROTOCOL_VERSION_UNSUPPORTED', 'handshake request version is unsupported');
  }
  const requiredGuarantees = normalizeGuarantees(fields.get('requiredGuarantees'));
  if (JSON.stringify(requiredGuarantees)
    !== JSON.stringify(ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES)) {
    fail('PROTOCOL_DOWNGRADE_DETECTED', 'handshake request guarantee catalog was changed');
  }
  normalizeHandshakeRequirements(fields.get('requirements'));
  return immutableSnapshot({
    handshakeVersion: ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
    backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    requiredGuarantees,
    requirements: HANDSHAKE_REQUIREMENTS,
  });
}

function normalizeHandshakeResponsePayload(value) {
  const fields = dataFields(value, [
    'accepted',
    'handshakeVersion',
    'protocolVersion',
    'backendContractVersion',
    'sessionContractVersion',
    'integrationVersion',
    'helperId',
    'guarantees',
    'features',
  ], undefined, 'handshake response payload');
  if (fields.get('accepted') !== true) {
    fail('PROTOCOL_HANDSHAKE_REJECTED', 'native helper rejected the handshake');
  }
  if (fields.get('handshakeVersion') !== ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION
    || fields.get('protocolVersion') !== ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION
    || fields.get('backendContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION
    || fields.get('sessionContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION
    || fields.get('integrationVersion') !== ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION) {
    fail('PROTOCOL_VERSION_UNSUPPORTED', 'native helper handshake version is unsupported');
  }
  const helperId = normalizeIdentifier(fields.get('helperId'), 'helperId');
  const guarantees = normalizeGuarantees(fields.get('guarantees'));
  normalizeHandshakeRequirements(fields.get('features'));
  return immutableSnapshot({
    accepted: true,
    handshakeVersion: ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
    protocolVersion: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    helperId,
    guarantees,
    features: HANDSHAKE_REQUIREMENTS,
  });
}

function normalizeRootNamespaceOpenRequestPayload(value) {
  const fields = dataFields(value, [
    'backendContractVersion',
    'integrationVersion',
    'rootPathHint',
    'namespacePolicy',
  ], undefined, 'root_namespace.open request payload');
  if (fields.get('backendContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION
    || fields.get('integrationVersion') !== ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION) {
    fail('PROTOCOL_VERSION_UNSUPPORTED', 'root namespace contract version is unsupported');
  }
  return immutableSnapshot({
    backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    rootPathHint: normalizePathHint(fields.get('rootPathHint'), 'rootPathHint'),
    namespacePolicy: normalizeRootNamespacePolicy(fields.get('namespacePolicy')),
  });
}

function normalizeRootNamespaceOpenResponsePayload(value) {
  const fields = dataFields(value, [
    'opened',
    'sessionId',
    'namespaceCapabilityId',
    'rootIdentityDigest',
    'namespaceIdentityDigest',
  ], undefined, 'root_namespace.open response payload');
  if (fields.get('opened') !== true) {
    fail('PROTOCOL_DOWNGRADE_DETECTED', 'anchored root namespace was not opened');
  }
  return immutableSnapshot({
    opened: true,
    sessionId: normalizeIdentifier(fields.get('sessionId'), 'sessionId'),
    namespaceCapabilityId: normalizeIdentifier(
      fields.get('namespaceCapabilityId'),
      'namespaceCapabilityId'
    ),
    rootIdentityDigest: normalizeDigest(fields.get('rootIdentityDigest'), 'rootIdentityDigest'),
    namespaceIdentityDigest: normalizeDigest(
      fields.get('namespaceIdentityDigest'),
      'namespaceIdentityDigest'
    ),
  });
}

function normalizeExistingSessionOpenRequestPayload(value) {
  const fields = dataFields(value, [
    'namespaceCapabilityId',
    'backendContractVersion',
    'sessionContractVersion',
    'integrationVersion',
    'transactionPathHint',
    'payloadPathHint',
    'headPathHint',
    'anchorPathHint',
    'bindingDigest',
    'checkpointDigest',
    'manifestDigest',
    'journalDigest',
    'targets',
    'checkpointEntries',
    'expectedIdentityReceipt',
  ], undefined, 'root_namespace.open_existing_session request payload');
  if (fields.get('backendContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION
    || fields.get('sessionContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION
    || fields.get('integrationVersion') !== ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION) {
    fail('PROTOCOL_VERSION_UNSUPPORTED', 'existing session contract version is unsupported');
  }
  const bindingDigest = normalizeDigest(fields.get('bindingDigest'), 'bindingDigest');
  const checkpointDigest = normalizeDigest(fields.get('checkpointDigest'), 'checkpointDigest');
  const targets = normalizeTargets(fields.get('targets'));
  const checkpointEntries = normalizeCheckpointEntries(fields.get('checkpointEntries'));
  const expectedIdentityReceipt = normalizeIdentityReceipt(
    fields.get('expectedIdentityReceipt'),
    { bindingDigest, checkpointDigest, targets, checkpointEntries },
    'expectedIdentityReceipt'
  );
  return immutableSnapshot({
    namespaceCapabilityId: normalizeIdentifier(
      fields.get('namespaceCapabilityId'),
      'namespaceCapabilityId'
    ),
    backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transactionPathHint: normalizePathHint(fields.get('transactionPathHint'), 'transactionPathHint'),
    payloadPathHint: normalizePathHint(fields.get('payloadPathHint'), 'payloadPathHint'),
    headPathHint: normalizePathHint(fields.get('headPathHint'), 'headPathHint'),
    anchorPathHint: normalizePathHint(fields.get('anchorPathHint'), 'anchorPathHint'),
    bindingDigest,
    checkpointDigest,
    manifestDigest: normalizeDigest(fields.get('manifestDigest'), 'manifestDigest'),
    journalDigest: normalizeDigest(fields.get('journalDigest'), 'journalDigest'),
    targets,
    checkpointEntries,
    expectedIdentityReceipt,
  });
}

function normalizeExistingSessionOpenResponsePayload(value) {
  const fields = dataFields(value, [
    'opened',
    'sessionId',
    'namespaceCapabilityId',
    'rootIdentityDigest',
    'namespaceIdentityDigest',
    'targetSetIdentityDigest',
    'identityReceipt',
    'rootNamespaceClosed',
    'movementProgress',
  ], undefined, 'root_namespace.open_existing_session response payload');
  if (fields.get('opened') !== true || fields.get('rootNamespaceClosed') !== true) {
    fail('PROTOCOL_DOWNGRADE_DETECTED', 'root namespace was not atomically promoted');
  }
  const identity = normalizeOpenIdentityFields(
    fields,
    'root_namespace.open_existing_session response payload'
  );
  return immutableSnapshot({
    opened: true,
    sessionId: normalizeIdentifier(fields.get('sessionId'), 'sessionId'),
    namespaceCapabilityId: normalizeIdentifier(
      fields.get('namespaceCapabilityId'),
      'namespaceCapabilityId'
    ),
    ...identity,
    rootNamespaceClosed: true,
    movementProgress: normalizeMovementProgress(
      fields.get('movementProgress'),
      'root_namespace.open_existing_session movementProgress'
    ),
  });
}

function normalizeAuthenticatedOrphanCleanupRequestPayload(value) {
  const fields = dataFields(value, [
    'namespaceCapabilityId',
    'transactionId',
    'bindingDigest',
    'manifestDigest',
    'journalDigest',
    'headContentDigest',
    'anchorChainDigest',
  ], undefined, 'root_namespace.cleanup_authenticated_orphan request payload');
  return Object.freeze({
    namespaceCapabilityId: normalizeIdentifier(
      fields.get('namespaceCapabilityId'),
      'namespaceCapabilityId'
    ),
    transactionId: normalizeIdentifier(fields.get('transactionId'), 'transactionId'),
    bindingDigest: normalizeDigest(fields.get('bindingDigest'), 'bindingDigest'),
    manifestDigest: normalizeDigest(fields.get('manifestDigest'), 'manifestDigest'),
    journalDigest: normalizeDigest(fields.get('journalDigest'), 'journalDigest'),
    headContentDigest: normalizeDigest(fields.get('headContentDigest'), 'headContentDigest'),
    anchorChainDigest: normalizeDigest(fields.get('anchorChainDigest'), 'anchorChainDigest'),
  });
}

function normalizeSessionOpenRequestPayload(value) {
  const fields = dataFields(value, [
    'backendContractVersion',
    'sessionContractVersion',
    'integrationVersion',
    'rootPathHint',
    'transactionPathHint',
    'payloadPathHint',
    'headPathHint',
    'anchorPathHint',
    'bindingDigest',
    'checkpointDigest',
    'targets',
    'checkpointEntries',
    'namespacePolicy',
  ], undefined, 'session.open request payload');
  if (fields.get('backendContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION
    || fields.get('sessionContractVersion') !== ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION
    || fields.get('integrationVersion') !== ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION) {
    fail('PROTOCOL_VERSION_UNSUPPORTED', 'session.open contract version is unsupported');
  }
  const result = {
    backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    rootPathHint: normalizePathHint(fields.get('rootPathHint'), 'rootPathHint'),
    transactionPathHint: normalizePathHint(fields.get('transactionPathHint'), 'transactionPathHint'),
    payloadPathHint: normalizePathHint(fields.get('payloadPathHint'), 'payloadPathHint'),
    headPathHint: normalizePathHint(fields.get('headPathHint'), 'headPathHint'),
    anchorPathHint: normalizePathHint(fields.get('anchorPathHint'), 'anchorPathHint'),
    bindingDigest: normalizeDigest(fields.get('bindingDigest'), 'bindingDigest'),
    checkpointDigest: normalizeDigest(fields.get('checkpointDigest'), 'checkpointDigest'),
    targets: normalizeTargets(fields.get('targets')),
    checkpointEntries: normalizeCheckpointEntries(fields.get('checkpointEntries')),
    namespacePolicy: normalizeNamespacePolicy(fields.get('namespacePolicy')),
  };
  return immutableSnapshot(result);
}

function normalizeSessionOpenResponsePayload(value) {
  const fields = dataFields(value, [
    'opened',
    'sessionId',
    'namespaceCapabilityId',
    'rootIdentityDigest',
    'namespaceIdentityDigest',
    'targetSetIdentityDigest',
    'identityReceipt',
    'namespaceReadyBeforeWrites',
    'movementProgress',
  ], undefined, 'session.open response payload');
  if (fields.get('opened') !== true || fields.get('namespaceReadyBeforeWrites') !== true) {
    fail('PROTOCOL_DOWNGRADE_DETECTED', 'anchored private namespace was not ready before writes');
  }
  const identity = normalizeOpenIdentityFields(fields, 'session.open response payload');
  return immutableSnapshot({
    opened: true,
    sessionId: normalizeIdentifier(fields.get('sessionId'), 'sessionId'),
    namespaceCapabilityId: normalizeIdentifier(
      fields.get('namespaceCapabilityId'),
      'namespaceCapabilityId'
    ),
    ...identity,
    namespaceReadyBeforeWrites: true,
    movementProgress: normalizeMovementProgress(
      fields.get('movementProgress'),
      'session.open movementProgress'
    ),
  });
}

function normalizeSessionClientInput(value) {
  const fields = dataFields(value, [
    'rootPath',
    'transactionPath',
    'payloadPath',
    'headPath',
    'anchorPath',
    'bindingDigest',
    'checkpointDigest',
    'targets',
    'checkpointEntries',
  ], undefined, 'session input');
  return immutableSnapshot({
    rootPath: normalizePathHint(fields.get('rootPath'), 'session input.rootPath'),
    transactionPath: normalizePathHint(
      fields.get('transactionPath'),
      'session input.transactionPath'
    ),
    payloadPath: normalizePathHint(fields.get('payloadPath'), 'session input.payloadPath'),
    headPath: normalizePathHint(fields.get('headPath'), 'session input.headPath'),
    anchorPath: normalizePathHint(fields.get('anchorPath'), 'session input.anchorPath'),
    bindingDigest: normalizeDigest(fields.get('bindingDigest'), 'session input.bindingDigest'),
    checkpointDigest: normalizeDigest(
      fields.get('checkpointDigest'),
      'session input.checkpointDigest'
    ),
    targets: normalizeTargets(fields.get('targets')),
    checkpointEntries: normalizeCheckpointEntries(fields.get('checkpointEntries')),
  });
}

function normalizeRootNamespaceClientInput(value) {
  const fields = dataFields(value, ['rootPath'], ['rootPath'], 'root namespace input');
  return Object.freeze({
    rootPath: normalizePathHint(fields.get('rootPath'), 'root namespace input.rootPath'),
  });
}

function normalizeMovementProgress(value, fieldName) {
  const fields = dataFields(
    value,
    ['checkpointDigest', 'moved', 'progressDigest'],
    undefined,
    fieldName
  );
  const checkpointDigest = normalizeDigest(
    fields.get('checkpointDigest'),
    `${fieldName}.checkpointDigest`
  );
  const moved = normalizePayloadNameArray(
    fields.get('moved'),
    `${fieldName}.moved`
  );
  const core = Object.freeze({ checkpointDigest, moved });
  const progressDigest = canonicalSha256Digest(core);
  if (fields.get('progressDigest') !== progressDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH', `${fieldName}.progressDigest is invalid`);
  }
  return immutableSnapshot({ ...core, progressDigest });
}

function normalizeCheckpointRequestPayload(value, fieldName) {
  const fields = dataFields(value, ['checkpointDigest'], ['checkpointDigest'], fieldName);
  return Object.freeze({
    checkpointDigest: normalizeDigest(fields.get('checkpointDigest'), `${fieldName}.checkpointDigest`),
  });
}

function normalizeNamespaceCapabilityPayload(value, operation, extraKeys, requiredExtraKeys = extraKeys) {
  const allowed = ['namespaceCapabilityId', ...extraKeys];
  const required = ['namespaceCapabilityId', ...requiredExtraKeys];
  const fields = dataFields(value, allowed, required, `${operation} request payload`);
  return { fields, namespaceCapabilityId: normalizeIdentifier(
    fields.get('namespaceCapabilityId'),
    `${operation}.namespaceCapabilityId`
  ) };
}

function normalizeOperationRequestPayload(operation, value) {
  switch (operation) {
    case ANCHORED_MUTATION_HELPER_OPERATIONS.HANDSHAKE:
      return normalizeHandshakeRequestPayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN:
      return normalizeRootNamespaceOpenRequestPayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION:
      return normalizeExistingSessionOpenRequestPayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLEANUP_AUTHENTICATED_ORPHAN:
      return normalizeAuthenticatedOrphanCleanupRequestPayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_READ_FILE: {
      const { fields, namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(
        value,
        operation,
        ['relativePath', 'maxBytes']
      );
      return Object.freeze({
        namespaceCapabilityId,
        relativePath: normalizePrivateRelativePath(
          fields.get('relativePath'),
          `${operation}.relativePath`
        ),
        maxBytes: normalizeNonNegativeNumber(fields.get('maxBytes'), `${operation}.maxBytes`, {
          integer: true,
          maximum: ANCHORED_MUTATION_HELPER_LIMITS.maxPrivateFileBytes,
        }),
      });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_LIST: {
      const { fields, namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(
        value,
        operation,
        ['relativePath', 'maxEntries']
      );
      return Object.freeze({
        namespaceCapabilityId,
        relativePath: normalizePrivateRelativePath(
          fields.get('relativePath'),
          `${operation}.relativePath`,
          { allowRoot: true }
        ),
        maxEntries: normalizeNonNegativeNumber(fields.get('maxEntries'), `${operation}.maxEntries`, {
          integer: true,
          maximum: ANCHORED_MUTATION_HELPER_LIMITS.maxNamespaceEntries,
        }),
      });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLOSE: {
      const { namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(value, operation, []);
      return Object.freeze({ namespaceCapabilityId });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN:
      return normalizeSessionOpenRequestPayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_INSPECT_PROGRESS:
      dataFields(value, [], [], `${operation} request payload`);
      return Object.freeze({});
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY:
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_MOVE_TO_QUARANTINE:
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_RESTORE_FROM_QUARANTINE:
      return normalizeCheckpointRequestPayload(value, `${operation} request payload`);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_PURGE_QUARANTINE: {
      const { fields, namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(
        value,
        operation,
        ['checkpointDigest']
      );
      return Object.freeze({
        checkpointDigest: normalizeDigest(fields.get('checkpointDigest'), `${operation}.checkpointDigest`),
        namespaceCapabilityId,
      });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_CLOSE:
      dataFields(value, [], [], `${operation} request payload`);
      return Object.freeze({});
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_WRITE_FILE: {
      const { fields, namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(
        value,
        operation,
        ['relativePath', 'contentBase64', 'contentDigest', 'mode']
      );
      const content = normalizeBase64(fields.get('contentBase64'), `${operation}.contentBase64`);
      const contentDigest = normalizeDigest(fields.get('contentDigest'), `${operation}.contentDigest`);
      if (digestBytes(content.bytes) !== contentDigest) {
        fail('PROTOCOL_DIGEST_MISMATCH', `${operation} content digest does not match its bytes`);
      }
      const mode = fields.get('mode');
      if (!['create_exclusive', 'replace_atomic'].includes(mode)) {
        fail('PROTOCOL_DATA_INVALID', `${operation}.mode is invalid`);
      }
      return immutableSnapshot({
        namespaceCapabilityId,
        relativePath: normalizePrivateRelativePath(
          fields.get('relativePath'),
          `${operation}.relativePath`
        ),
        contentBase64: content.value,
        contentDigest,
        mode,
      });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_READ_FILE: {
      const { fields, namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(
        value,
        operation,
        ['relativePath', 'maxBytes']
      );
      return Object.freeze({
        namespaceCapabilityId,
        relativePath: normalizePrivateRelativePath(
          fields.get('relativePath'),
          `${operation}.relativePath`
        ),
        maxBytes: normalizeNonNegativeNumber(fields.get('maxBytes'), `${operation}.maxBytes`, {
          integer: true,
          maximum: ANCHORED_MUTATION_HELPER_LIMITS.maxPrivateFileBytes,
        }),
      });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_LIST: {
      const { fields, namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(
        value,
        operation,
        ['relativePath', 'maxEntries']
      );
      return Object.freeze({
        namespaceCapabilityId,
        relativePath: normalizePrivateRelativePath(
          fields.get('relativePath'),
          `${operation}.relativePath`,
          { allowRoot: true }
        ),
        maxEntries: normalizeNonNegativeNumber(fields.get('maxEntries'), `${operation}.maxEntries`, {
          integer: true,
          maximum: ANCHORED_MUTATION_HELPER_LIMITS.maxNamespaceEntries,
        }),
      });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_REMOVE: {
      const { fields, namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(
        value,
        operation,
        ['relativePath', 'recursive']
      );
      return Object.freeze({
        namespaceCapabilityId,
        relativePath: normalizePrivateRelativePath(
          fields.get('relativePath'),
          `${operation}.relativePath`
        ),
        recursive: normalizeBoolean(fields.get('recursive'), `${operation}.recursive`),
      });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_SYNC: {
      const { namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(value, operation, []);
      return Object.freeze({ namespaceCapabilityId });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_CLEANUP: {
      const { fields, namespaceCapabilityId } = normalizeNamespaceCapabilityPayload(
        value,
        operation,
        ['checkpointDigest', 'disposition', 'progressDigest']
      );
      const disposition = fields.get('disposition');
      if (!['restored', 'purged'].includes(disposition)) {
        fail('PROTOCOL_STATE_INVALID', `${operation}.disposition is not terminal`);
      }
      return Object.freeze({
        namespaceCapabilityId,
        checkpointDigest: normalizeDigest(fields.get('checkpointDigest'), `${operation}.checkpointDigest`),
        disposition,
        progressDigest: normalizeDigest(fields.get('progressDigest'), `${operation}.progressDigest`),
      });
    }
    default:
      fail('PROTOCOL_OPERATION_UNSUPPORTED', 'unsupported helper request operation');
  }
}

function normalizeBooleanResponse(value, operation, key, extraKeys = []) {
  const fields = dataFields(
    value,
    [key, ...extraKeys],
    [key, ...extraKeys],
    `${operation} response payload`
  );
  const result = { [key]: normalizeBoolean(fields.get(key), `${operation}.${key}`) };
  for (const extraKey of extraKeys) {
    result[extraKey] = normalizeBoolean(fields.get(extraKey), `${operation}.${extraKey}`);
  }
  return immutableSnapshot(result);
}

function normalizePayloadNameArray(value, fieldName) {
  const values = denseDataArray(value, fieldName, {
    maxLength: ANCHORED_MUTATION_HELPER_LIMITS.maxTargets,
  });
  const names = values.map((entry, index) => {
    if (typeof entry !== 'string' || !SAFE_PAYLOAD_NAME.test(entry)
      || entry === '.' || entry === '..') {
      fail('PROTOCOL_DATA_INVALID', `${fieldName}[${index}] is invalid`);
    }
    return entry;
  });
  if (new Set(names).size !== names.length) {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must contain unique entries`);
  }
  return Object.freeze(names);
}

function normalizeMoveResponse(value, operation) {
  const fields = dataFields(
    value,
    ['moved', 'checkpointDigest', 'progressDigest'],
    undefined,
    `${operation} response payload`
  );
  const moved = normalizePayloadNameArray(fields.get('moved'), `${operation}.moved`);
  const checkpointDigest = normalizeDigest(
    fields.get('checkpointDigest'),
    `${operation}.checkpointDigest`
  );
  const core = Object.freeze({ checkpointDigest, moved });
  const progressDigest = canonicalSha256Digest(core);
  if (fields.get('progressDigest') !== progressDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH', `${operation}.progressDigest is invalid`);
  }
  return immutableSnapshot({ moved, checkpointDigest, progressDigest });
}

function normalizeRestoreResponse(value, operation) {
  const fields = dataFields(
    value,
    ['restored', 'remainingMoved', 'checkpointDigest', 'progressDigest'],
    undefined,
    `${operation} response payload`
  );
  const restored = normalizePayloadNameArray(fields.get('restored'), `${operation}.restored`);
  const remainingMoved = normalizePayloadNameArray(
    fields.get('remainingMoved'),
    `${operation}.remainingMoved`
  );
  const checkpointDigest = normalizeDigest(
    fields.get('checkpointDigest'),
    `${operation}.checkpointDigest`
  );
  const progressCore = Object.freeze({ checkpointDigest, moved: remainingMoved });
  const progressDigest = canonicalSha256Digest(progressCore);
  if (fields.get('progressDigest') !== progressDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH', `${operation}.progressDigest is invalid`);
  }
  return immutableSnapshot({ restored, remainingMoved, checkpointDigest, progressDigest });
}

function normalizeOperationResponsePayload(operation, value) {
  switch (operation) {
    case ANCHORED_MUTATION_HELPER_OPERATIONS.HANDSHAKE:
      return normalizeHandshakeResponsePayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN:
      return normalizeRootNamespaceOpenResponsePayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION:
      return normalizeExistingSessionOpenResponsePayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLEANUP_AUTHENTICATED_ORPHAN:
      return normalizeBooleanResponse(value, operation, 'cleaned');
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLOSE:
      return normalizeBooleanResponse(value, operation, 'closed');
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN:
      return normalizeSessionOpenResponsePayload(value);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_INSPECT_PROGRESS:
      return normalizeMovementProgress(value, `${operation} response payload`);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY:
      return normalizeBooleanResponse(value, operation, 'verified');
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_MOVE_TO_QUARANTINE:
      return normalizeMoveResponse(value, operation);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_RESTORE_FROM_QUARANTINE:
      return normalizeRestoreResponse(value, operation);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_PURGE_QUARANTINE:
      return normalizeBooleanResponse(value, operation, 'purged', ['namespaceCleaned']);
    case ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_CLOSE:
      return normalizeBooleanResponse(value, operation, 'closed');
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_WRITE_FILE: {
      const fields = dataFields(value, ['written', 'contentDigest'], undefined, `${operation} response payload`);
      return Object.freeze({
        written: normalizeBoolean(fields.get('written'), `${operation}.written`),
        contentDigest: normalizeDigest(fields.get('contentDigest'), `${operation}.contentDigest`),
      });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_READ_FILE:
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_READ_FILE: {
      const fields = dataFields(
        value,
        ['found', 'contentBase64', 'contentDigest'],
        undefined,
        `${operation} response payload`
      );
      const found = normalizeBoolean(fields.get('found'), `${operation}.found`);
      if (!found) {
        if (fields.get('contentBase64') !== null || fields.get('contentDigest') !== null) {
          fail('PROTOCOL_DATA_INVALID', `${operation} missing content must use null fields`);
        }
        return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
      }
      const content = normalizeBase64(fields.get('contentBase64'), `${operation}.contentBase64`);
      const contentDigest = normalizeDigest(fields.get('contentDigest'), `${operation}.contentDigest`);
      if (digestBytes(content.bytes) !== contentDigest) {
        fail('PROTOCOL_DIGEST_MISMATCH', `${operation} content digest does not match its bytes`);
      }
      return Object.freeze({ found: true, contentBase64: content.value, contentDigest });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_LIST:
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_LIST: {
      const fields = dataFields(value, ['entries'], ['entries'], `${operation} response payload`);
      const entries = denseDataArray(fields.get('entries'), `${operation}.entries`, {
        maxLength: ANCHORED_MUTATION_HELPER_LIMITS.maxNamespaceEntries,
      }).map((entry, index) => normalizePrivateRelativePath(
        entry,
        `${operation}.entries[${index}]`
      ));
      if (new Set(entries).size !== entries.length) {
        fail('PROTOCOL_DATA_INVALID', `${operation}.entries must be unique`);
      }
      return Object.freeze({ entries: Object.freeze(entries) });
    }
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_REMOVE:
      return normalizeBooleanResponse(value, operation, 'removed');
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_SYNC:
      return normalizeBooleanResponse(value, operation, 'synced');
    case ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_CLEANUP:
      return normalizeBooleanResponse(value, operation, 'cleaned');
    default:
      fail('PROTOCOL_OPERATION_UNSUPPORTED', 'unsupported helper response operation');
  }
}

function assertMessageBounded(message, fieldName) {
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(message), 'utf8'); } catch {
    fail('PROTOCOL_DATA_INVALID', `${fieldName} must be JSON data`);
  }
  if (bytes > ANCHORED_MUTATION_HELPER_LIMITS.maxMessageBytes) {
    fail('PROTOCOL_LIMIT_EXCEEDED', `${fieldName} exceeded the message bound`);
  }
}

function requestCore(fields, payload) {
  return {
    schemaVersion: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    kind: MESSAGE_KINDS.REQUEST,
    requestId: normalizeIdentifier(fields.get('requestId'), 'requestId'),
    operation: fields.get('operation'),
    sequence: normalizeSequence(fields.get('sequence')),
    sessionId: fields.get('sessionId') === null
      ? null
      : normalizeIdentifier(fields.get('sessionId'), 'sessionId'),
    previousResponseDigest: normalizeDigest(
      fields.get('previousResponseDigest'),
      'previousResponseDigest',
      { nullable: true }
    ),
    payload,
    payloadDigest: canonicalSha256Digest(payload),
  };
}

function assertAnchoredMutationHelperRequest(value) {
  const fields = dataFields(value, REQUEST_KEYS, REQUEST_KEYS, 'helper request');
  if (fields.get('schemaVersion') !== ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION
    || fields.get('kind') !== MESSAGE_KINDS.REQUEST
    || !OPERATIONS.has(fields.get('operation'))) {
    fail('PROTOCOL_DATA_INVALID', 'helper request envelope is invalid');
  }
  const operation = fields.get('operation');
  const payload = normalizeOperationRequestPayload(operation, fields.get('payload'));
  const core = requestCore(fields, payload);
  if (fields.get('payloadDigest') !== core.payloadDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH', 'helper request payload digest is invalid');
  }
  const requestDigest = canonicalSha256Digest(core);
  if (fields.get('requestDigest') !== requestDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH', 'helper request digest is invalid');
  }
  const normalized = immutableSnapshot({ ...core, requestDigest });
  assertMessageBounded(normalized, 'helper request');
  return normalized;
}

function createAnchoredMutationHelperRequest({
  requestId,
  operation,
  sequence,
  sessionId,
  previousResponseDigest,
  payload,
}) {
  if (!OPERATIONS.has(operation)) {
    fail('PROTOCOL_OPERATION_UNSUPPORTED', 'unsupported helper request operation');
  }
  const normalizedPayload = normalizeOperationRequestPayload(operation, payload);
  const fields = new Map([
    ['requestId', requestId],
    ['operation', operation],
    ['sequence', sequence],
    ['sessionId', sessionId],
    ['previousResponseDigest', previousResponseDigest],
  ]);
  const core = requestCore(fields, normalizedPayload);
  const request = immutableSnapshot({
    ...core,
    requestDigest: canonicalSha256Digest(core),
  });
  assertMessageBounded(request, 'helper request');
  return request;
}

function responseCore(fields, payload) {
  return {
    schemaVersion: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    kind: MESSAGE_KINDS.RESPONSE,
    requestId: normalizeIdentifier(fields.get('requestId'), 'requestId'),
    operation: fields.get('operation'),
    sequence: normalizeSequence(fields.get('sequence')),
    sessionId: fields.get('sessionId') === null
      ? null
      : normalizeIdentifier(fields.get('sessionId'), 'sessionId'),
    requestDigest: normalizeDigest(fields.get('requestDigest'), 'requestDigest'),
    previousResponseDigest: normalizeDigest(
      fields.get('previousResponseDigest'),
      'previousResponseDigest',
      { nullable: true }
    ),
    payload,
    payloadDigest: canonicalSha256Digest(payload),
  };
}

function assertOpenResponseIdentityConsistency(operation, payload) {
  if (operation !== ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN
    && operation
      !== ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION) return;
  if (payload.rootIdentityDigest !== payload.identityReceipt.rootIdentity.identityDigest
    || payload.namespaceIdentityDigest !== payload.identityReceipt.namespaceIdentity.identityDigest
    || payload.targetSetIdentityDigest !== payload.identityReceipt.targetSetIdentityDigest) {
    fail(
      'PROTOCOL_IDENTITY_MISMATCH',
      'helper open response identity digests do not match identityReceipt'
    );
  }
}

function normalizeAnchoredMutationHelperResponse(value, { deferOpenIdentityConsistency = false } = {}) {
  const fields = dataFields(value, RESPONSE_KEYS, RESPONSE_KEYS, 'helper response');
  if (fields.get('schemaVersion') !== ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION
    || fields.get('kind') !== MESSAGE_KINDS.RESPONSE
    || !OPERATIONS.has(fields.get('operation'))) {
    fail('PROTOCOL_DATA_INVALID', 'helper response envelope is invalid');
  }
  const operation = fields.get('operation');
  const payload = normalizeOperationResponsePayload(operation, fields.get('payload'));
  const core = responseCore(fields, payload);
  if (fields.get('payloadDigest') !== core.payloadDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH', 'helper response payload digest is invalid');
  }
  const responseDigest = canonicalSha256Digest(core);
  if (fields.get('responseDigest') !== responseDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH', 'helper response digest is invalid');
  }
  const normalized = immutableSnapshot({ ...core, responseDigest });
  if (!deferOpenIdentityConsistency) {
    assertOpenResponseIdentityConsistency(operation, normalized.payload);
  }
  assertMessageBounded(normalized, 'helper response');
  return normalized;
}

function assertAnchoredMutationHelperResponse(value) {
  return normalizeAnchoredMutationHelperResponse(value);
}

function createAnchoredMutationHelperResponse(requestValue, payload) {
  const request = assertAnchoredMutationHelperRequest(requestValue);
  const normalizedPayload = normalizeOperationResponsePayload(request.operation, payload);
  assertOpenResponseIdentityConsistency(request.operation, normalizedPayload);
  const fields = new Map([
    ['requestId', request.requestId],
    ['operation', request.operation],
    ['sequence', request.sequence],
    ['sessionId', request.sessionId],
    ['requestDigest', request.requestDigest],
    ['previousResponseDigest', request.previousResponseDigest],
  ]);
  const core = responseCore(fields, normalizedPayload);
  const response = immutableSnapshot({
    ...core,
    responseDigest: canonicalSha256Digest(core),
  });
  assertMessageBounded(response, 'helper response');
  return response;
}

function createAbortMessage({
  sessionId,
  namespaceCapabilityId,
  sequence,
  lastResponseDigest,
  reasonCode,
}) {
  const core = {
    schemaVersion: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    kind: 'abort',
    sessionId: normalizeIdentifier(sessionId, 'abort.sessionId'),
    namespaceCapabilityId: normalizeIdentifier(
      namespaceCapabilityId,
      'abort.namespaceCapabilityId'
    ),
    sequence: normalizeSequence(sequence),
    lastResponseDigest: normalizeDigest(lastResponseDigest, 'abort.lastResponseDigest'),
    reasonCode: normalizeIdentifier(reasonCode, 'abort.reasonCode'),
  };
  const message = immutableSnapshot({ ...core, abortDigest: canonicalSha256Digest(core) });
  assertMessageBounded(message, 'abort message');
  return message;
}

function assertAnchoredMutationHelperAbort(value) {
  const fields = dataFields(value, ABORT_KEYS, ABORT_KEYS, 'abort message');
  if (fields.get('schemaVersion') !== ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION
    || fields.get('kind') !== 'abort') {
    fail('PROTOCOL_DATA_INVALID', 'abort message envelope is invalid');
  }
  const core = {
    schemaVersion: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    kind: 'abort',
    sessionId: normalizeIdentifier(fields.get('sessionId'), 'abort.sessionId'),
    namespaceCapabilityId: normalizeIdentifier(
      fields.get('namespaceCapabilityId'),
      'abort.namespaceCapabilityId'
    ),
    sequence: normalizeSequence(fields.get('sequence')),
    lastResponseDigest: normalizeDigest(
      fields.get('lastResponseDigest'),
      'abort.lastResponseDigest'
    ),
    reasonCode: normalizeIdentifier(fields.get('reasonCode'), 'abort.reasonCode'),
  };
  const abortDigest = canonicalSha256Digest(core);
  if (fields.get('abortDigest') !== abortDigest) {
    fail('PROTOCOL_DIGEST_MISMATCH', 'abort message digest is invalid');
  }
  const message = immutableSnapshot({ ...core, abortDigest });
  assertMessageBounded(message, 'abort message');
  return message;
}

function absorbNativePromise(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    // Calling the intrinsic never consults value.then: it succeeds only for an
    // actual native Promise (including cross-realm promises). Both handlers
    // prevent a denied async transport from becoming an unhandled rejection.
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
    return true;
  } catch {
    return false;
  }
}

function absorbNativePromisesInDataGraph(root) {
  const seen = new Set();
  const stack = [{ depth: 0, value: root }];
  let hasNativePromise = false;
  let inspectable = true;
  let bounded = true;
  let nodeCount = 0;
  let propertyCount = 0;

  while (stack.length > 0) {
    const { depth, value } = stack.pop();
    if (absorbNativePromise(value)) {
      hasNativePromise = true;
      continue;
    }
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    nodeCount += 1;
    if (nodeCount > DATA_GRAPH_PREFLIGHT_LIMITS.maxNodes
      || depth > DATA_GRAPH_PREFLIGHT_LIMITS.maxDepth) {
      bounded = false;
      continue;
    }

    let keys;
    try { keys = Reflect.ownKeys(value); } catch (error) {
      if (absorbNativePromise(error)) hasNativePromise = true;
      inspectable = false;
      continue;
    }
    propertyCount += keys.length;
    const mayDescend = propertyCount <= DATA_GRAPH_PREFLIGHT_LIMITS.maxProperties;
    if (!mayDescend) bounded = false;
    for (const key of keys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
        if (absorbNativePromise(error)) hasNativePromise = true;
        inspectable = false;
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
      if (absorbNativePromise(descriptor.value)) {
        hasNativePromise = true;
      } else if (mayDescend && descriptor.value
        && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
        stack.push({ depth: depth + 1, value: descriptor.value });
      }
    }
  }

  return Object.freeze({ bounded, hasNativePromise, inspectable });
}

function rejectAsyncInput(value, fieldName) {
  if (absorbNativePromise(value)) {
    fail('PROTOCOL_ASYNC_INPUT', `${fieldName} must be synchronous plain data`);
  }
}

function normalizeTransport(value) {
  const fields = dataFields(value, ['exchange', 'abort'], ['exchange', 'abort'], 'transport');
  if (typeof fields.get('exchange') !== 'function' || typeof fields.get('abort') !== 'function') {
    fail('HELPER_TRANSPORT_INVALID', 'transport must expose main-owned exchange and abort functions');
  }
  return Object.freeze({
    receiver: value,
    exchange: fields.get('exchange'),
    abort: fields.get('abort'),
  });
}

function normalizeRequestIdFactory(value) {
  if (value === undefined) return () => `request-${crypto.randomUUID()}`;
  if (typeof value !== 'function') {
    fail('PROTOCOL_DATA_INVALID', 'requestIdFactory must be a function');
  }
  return value;
}

function createAnchoredMutationHelperProtocolClient(options = {}) {
  const fields = dataFields(
    options,
    ['transport', 'requestIdFactory'],
    ['transport'],
    'protocol client options'
  );
  const transport = normalizeTransport(fields.get('transport'));
  const requestIdFactory = normalizeRequestIdFactory(fields.get('requestIdFactory'));
  const usedRequestIds = new Set();
  const usedSessionIds = new Set();
  const usedNamespaceCapabilityIds = new Set();
  const activeSessions = new Set();
  let clientPoisoned = false;
  let handshakeState = null;
  let totalSessions = 0;
  let clientBusy = false;
  let transportCallDepth = 0;
  const pendingAborts = [];

  function issueAbort(controller, reasonCode) {
    if (!controller || controller.abortSent) return;
    controller.abortSent = true;
    activeSessions.delete(controller);
    const abortMessage = createAbortMessage({
      sessionId: controller.sessionId,
      namespaceCapabilityId: controller.namespaceCapabilityId,
      sequence: controller.sequence,
      lastResponseDigest: controller.previousResponseDigest,
      reasonCode,
    });
    if (transportCallDepth > 0) {
      pendingAborts.push(abortMessage);
      return;
    }
    try {
      const result = Reflect.apply(transport.abort, transport.receiver, [abortMessage]);
      if (absorbNativePromise(result)) return;
      const abortFields = dataFields(
        result,
        ['aborted', 'abortDigest'],
        ['aborted', 'abortDigest'],
        'abort response'
      );
      if (abortFields.get('aborted') !== true
        || abortFields.get('abortDigest') !== abortMessage.abortDigest) return;
    } catch (error) {
      absorbNativePromise(error);
      // The strict handshake requires a bounded native lease, so an abort
      // transport failure cannot leave the OS helper handle alive forever.
    }
  }

  function flushPendingAborts() {
    if (transportCallDepth > 0) return;
    while (pendingAborts.length > 0) {
      const abortMessage = pendingAborts.shift();
      try {
        const result = Reflect.apply(transport.abort, transport.receiver, [abortMessage]);
        if (absorbNativePromise(result)) continue;
        const abortFields = dataFields(
          result,
          ['aborted', 'abortDigest'],
          ['aborted', 'abortDigest'],
          'abort response'
        );
        if (abortFields.get('aborted') !== true
          || abortFields.get('abortDigest') !== abortMessage.abortDigest) continue;
      } catch (error) { absorbNativePromise(error); }
    }
  }

  function poisonClient(reasonCode = 'PROTOCOL_CLIENT_POISONED') {
    clientPoisoned = true;
    for (const controller of [...activeSessions]) {
      controller.poisoned = true;
      issueAbort(controller, reasonCode);
    }
  }

  function runExclusive(callback) {
    if (clientBusy) {
      poisonClient('PROTOCOL_REENTRANCY');
      fail('PROTOCOL_REENTRANCY', 'helper protocol client rejected a reentrant call');
    }
    clientBusy = true;
    try { return callback(); } finally { clientBusy = false; }
  }

  function nextRequestId() {
    if (usedRequestIds.size >= ANCHORED_MUTATION_HELPER_LIMITS.maxRequestsPerClient) {
      poisonClient('PROTOCOL_CAPACITY_EXCEEDED');
      fail('PROTOCOL_CAPACITY_EXCEEDED', 'helper protocol request capacity was exhausted');
    }
    let value;
    try { value = requestIdFactory(); } catch (error) {
      absorbNativePromise(error);
      if (clientPoisoned && error instanceof AnchoredMutationHelperProtocolError
        && error.code === 'PROTOCOL_REENTRANCY') {
        fail('PROTOCOL_REENTRANCY', 'requestIdFactory reentered the helper protocol client');
      }
      poisonClient('PROTOCOL_REQUEST_ID_INVALID');
      fail('PROTOCOL_REQUEST_ID_INVALID', 'requestIdFactory failed');
    }
    if (absorbNativePromise(value)) {
      poisonClient('PROTOCOL_REQUEST_ID_INVALID');
      fail('PROTOCOL_REQUEST_ID_INVALID', 'requestIdFactory must be synchronous');
    }
    let requestId;
    try { requestId = normalizeIdentifier(value, 'requestId'); } catch (error) {
      poisonClient('PROTOCOL_REQUEST_ID_INVALID');
      throw error;
    }
    if (usedRequestIds.has(requestId)) {
      poisonClient('PROTOCOL_REPLAY_DETECTED');
      fail('PROTOCOL_REPLAY_DETECTED', 'requestIdFactory replayed an identifier');
    }
    usedRequestIds.add(requestId);
    return requestId;
  }

  function exchange(request, poison) {
    let rawResponse;
    transportCallDepth += 1;
    try {
      rawResponse = Reflect.apply(transport.exchange, transport.receiver, [request]);
    } catch (error) {
      absorbNativePromise(error);
      poison();
      if (clientPoisoned && error instanceof AnchoredMutationHelperProtocolError
        && error.code === 'PROTOCOL_REENTRANCY') {
        fail('PROTOCOL_REENTRANCY', 'native helper transport reentered the protocol client');
      }
      fail('HELPER_TRANSPORT_FAILED', 'native helper transport failed synchronously');
    } finally {
      transportCallDepth -= 1;
      flushPendingAborts();
    }
    try {
      if (clientPoisoned) {
        fail('PROTOCOL_CLIENT_POISONED', 'helper protocol client was poisoned during exchange');
      }
      if (absorbNativePromise(rawResponse)) {
        fail('HELPER_TRANSPORT_ASYNC', 'native helper transport returned a Promise');
      }
      // Open-response cross-field identity continuity is checked immediately
      // after correlation by performOpenSession. Deferring only that check here
      // lets a fully authenticated promotion mismatch abort the exact returned
      // native capability instead of the stale bootstrap handle.
      const response = normalizeAnchoredMutationHelperResponse(rawResponse, {
        deferOpenIdentityConsistency: true,
      });
      if (clientPoisoned) {
        fail('PROTOCOL_CLIENT_POISONED', 'helper response validation was reentered');
      }
      if (response.requestId !== request.requestId
        || response.operation !== request.operation
        || response.sequence !== request.sequence
        || response.sessionId !== request.sessionId
        || response.requestDigest !== request.requestDigest
        || response.previousResponseDigest !== request.previousResponseDigest) {
        fail('PROTOCOL_REPLAY_DETECTED', 'native helper response did not match its request');
      }
      if (clientPoisoned) {
        fail('PROTOCOL_CLIENT_POISONED', 'helper response correlation was reentered');
      }
      return response;
    } catch (error) {
      absorbNativePromise(error);
      poison();
      if (error instanceof AnchoredMutationHelperProtocolError) throw error;
      fail('PROTOCOL_DATA_INVALID', 'native helper returned an invalid response');
    }
  }

  function performHandshake() {
    if (clientPoisoned) fail('PROTOCOL_CLIENT_POISONED', 'helper protocol client is poisoned');
    if (handshakeState) return handshakeState.publicHandshake;
    const request = createAnchoredMutationHelperRequest({
      requestId: nextRequestId(),
      operation: ANCHORED_MUTATION_HELPER_OPERATIONS.HANDSHAKE,
      sequence: 0,
      sessionId: null,
      previousResponseDigest: null,
      payload: {
        handshakeVersion: ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
        backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
        sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
        integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
        requiredGuarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
        requirements: { ...HANDSHAKE_REQUIREMENTS },
      },
    });
    const response = exchange(request, () => { poisonClient('PROTOCOL_HANDSHAKE_INVALID'); });
    if (JSON.stringify(response.payload.guarantees)
      !== JSON.stringify(ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES)) {
      poisonClient('PROTOCOL_DOWNGRADE_DETECTED');
      fail('PROTOCOL_DOWNGRADE_DETECTED', 'native helper omitted or changed required guarantees');
    }
    const publicHandshake = immutableSnapshot({
      helperId: response.payload.helperId,
      guarantees: response.payload.guarantees,
      protocolVersion: response.payload.protocolVersion,
      integrationVersion: response.payload.integrationVersion,
    });
    handshakeState = Object.freeze({ responseDigest: response.responseDigest, publicHandshake });
    return publicHandshake;
  }

  function handshake() {
    return runExclusive(performHandshake);
  }

  function performOpenSession(input, promotion = null) {
    const handshakeResult = performHandshake();
    if (clientPoisoned) fail('PROTOCOL_CLIENT_POISONED', 'helper protocol client is poisoned');
    if (!promotion && (activeSessions.size >= ANCHORED_MUTATION_HELPER_LIMITS.maxActiveSessions
      || totalSessions >= ANCHORED_MUTATION_HELPER_LIMITS.maxTotalSessions)) {
      fail('PROTOCOL_CAPACITY_EXCEEDED', 'helper protocol session capacity was exhausted');
    }
    let request;
    let response;
    if (promotion) {
      request = promotion.request;
      response = promotion.response;
    } else {
      const inputFields = dataFields(input, [
        'rootPath',
        'transactionPath',
        'payloadPath',
        'headPath',
        'anchorPath',
        'bindingDigest',
        'checkpointDigest',
        'targets',
        'checkpointEntries',
      ], undefined, 'session input');
      request = createAnchoredMutationHelperRequest({
        requestId: nextRequestId(),
        operation: ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN,
        sequence: 0,
        sessionId: null,
        previousResponseDigest: handshakeState.responseDigest,
        payload: {
          backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
          sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
          integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
          rootPathHint: inputFields.get('rootPath'),
          transactionPathHint: inputFields.get('transactionPath'),
          payloadPathHint: inputFields.get('payloadPath'),
          headPathHint: inputFields.get('headPath'),
          anchorPathHint: inputFields.get('anchorPath'),
          bindingDigest: inputFields.get('bindingDigest'),
          checkpointDigest: inputFields.get('checkpointDigest'),
          targets: inputFields.get('targets'),
          checkpointEntries: inputFields.get('checkpointEntries'),
          namespacePolicy: { ...NAMESPACE_POLICY },
        },
      });
      response = exchange(request, () => { poisonClient('PROTOCOL_SESSION_OPEN_INVALID'); });
    }
    const sessionId = response.payload.sessionId;
    const namespaceCapabilityId = response.payload.namespaceCapabilityId;
    const checkpointDigest = request.payload.checkpointDigest;
    const targetPayloadNames = Object.freeze(request.payload.targets.map((target) => target.payloadName));
    const openProgress = response.payload.movementProgress;
    const progressIsPrefix = openProgress.checkpointDigest === checkpointDigest
      && openProgress.moved.every((name, index) => name === targetPayloadNames[index]);
    let receiptMatchesRequest = response.payload.rootIdentityDigest
      === response.payload.identityReceipt.rootIdentity.identityDigest
      && response.payload.namespaceIdentityDigest
        === response.payload.identityReceipt.namespaceIdentity.identityDigest
      && response.payload.targetSetIdentityDigest
        === response.payload.identityReceipt.targetSetIdentityDigest;
    try {
      assertAnchoredMutationIdentityReceipt(response.payload.identityReceipt, {
        bindingDigest: request.payload.bindingDigest,
        checkpointDigest,
        targets: request.payload.targets,
        checkpointEntries: request.payload.checkpointEntries,
      });
    } catch (error) {
      absorbNativePromise(error);
      receiptMatchesRequest = false;
    }
    const identityContinues = receiptMatchesRequest && (!promotion || (
      response.payload.rootNamespaceClosed === true
      && sessionId === promotion.sessionId
      && response.payload.rootIdentityDigest === promotion.rootIdentityDigest
      && response.payload.namespaceIdentityDigest === promotion.namespaceIdentityDigest
      && response.payload.targetSetIdentityDigest
        === request.payload.expectedIdentityReceipt.targetSetIdentityDigest
      && response.payload.identityReceipt.receiptDigest
        === request.payload.expectedIdentityReceipt.receiptDigest
    ));
    const sessionIdReplayed = promotion
      ? sessionId !== promotion.sessionId
      : usedSessionIds.has(sessionId);
    const namespaceCapabilityReplayed = usedNamespaceCapabilityIds.has(namespaceCapabilityId)
      && (!promotion || namespaceCapabilityId !== promotion.namespaceCapabilityId);
    if (!progressIsPrefix || !identityContinues
      || sessionIdReplayed || namespaceCapabilityReplayed) {
      const orphan = {
        abortSent: false,
        namespaceCapabilityId,
        previousResponseDigest: response.responseDigest,
        sequence: promotion ? promotion.sequence : 1,
        sessionId,
      };
      const reasonCode = !progressIsPrefix
        ? 'PROTOCOL_PROGRESS_INVALID'
        : !identityContinues ? 'PROTOCOL_IDENTITY_MISMATCH' : 'PROTOCOL_REPLAY_DETECTED';
      if (promotion) {
        // The promotion response names the native capability that may now own
        // effects. Consume the bootstrap controller without sending an abort
        // to its stale identifiers, then abort exactly the returned pair.
        promotion.controller.poisoned = true;
        promotion.controller.abortSent = true;
        activeSessions.delete(promotion.controller);
        issueAbort(orphan, reasonCode);
      } else {
        issueAbort(orphan, reasonCode);
      }
      poisonClient(reasonCode);
      fail(
        reasonCode,
        'native helper opened an invalid or replayed session'
      );
    }
    if (!promotion) usedSessionIds.add(sessionId);
    usedNamespaceCapabilityIds.add(namespaceCapabilityId);
    if (!promotion) totalSessions += 1;
    else activeSessions.delete(promotion.controller);
    let sequence = promotion ? promotion.sequence : 1;
    let previousResponseDigest = response.responseDigest;
    let closed = false;
    let namespaceCleaned = false;
    let movedCount = openProgress.moved.length;
    let progressDigest = openProgress.progressDigest;
    let phase = movedCount === 0
      ? 'prepared'
      : movedCount === targetPayloadNames.length ? 'quarantined' : 'partial';
    const controller = {
      abortSent: false,
      namespaceCapabilityId,
      poisoned: false,
      get previousResponseDigest() { return previousResponseDigest; },
      get sequence() { return sequence; },
      sessionId,
    };
    activeSessions.add(controller);

    function assertUsable({ namespace = false, allowDisposed = false } = {}) {
      if (controller.poisoned) fail('PROTOCOL_SESSION_POISONED', 'anchored helper session is poisoned');
      if (closed) fail('PROTOCOL_SESSION_CLOSED', 'anchored helper session is closed');
      if (namespace && namespaceCleaned) {
        fail('PROTOCOL_NAMESPACE_CLOSED', 'private namespace capability is closed');
      }
      if (namespaceCleaned && !allowDisposed) {
        fail('PROTOCOL_SESSION_DISPOSED', 'anchored helper session is disposed');
      }
    }

    function invoke(operation, payload, { namespace = false, allowDisposed = false } = {}) {
      return runExclusive(() => {
        assertUsable({ namespace, allowDisposed });
        const operationRequest = createAnchoredMutationHelperRequest({
          requestId: nextRequestId(),
          operation,
          sequence,
          sessionId,
          previousResponseDigest,
          payload,
        });
        const operationResponse = exchange(operationRequest, () => {
          poisonClient('PROTOCOL_SESSION_RESPONSE_INVALID');
        });
        sequence += 1;
        previousResponseDigest = operationResponse.responseDigest;
        return operationResponse.payload;
      });
    }

    const privateNamespace = Object.freeze({
      capabilityVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
      writeFile(value) {
        const fields = dataFields(
          value,
          ['relativePath', 'contentBase64', 'contentDigest', 'mode'],
          undefined,
          'privateNamespace.writeFile input'
        );
        const result = invoke(ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_WRITE_FILE, {
          namespaceCapabilityId,
          relativePath: fields.get('relativePath'),
          contentBase64: fields.get('contentBase64'),
          contentDigest: fields.get('contentDigest'),
          mode: fields.get('mode'),
        }, { namespace: true });
        if (result.contentDigest !== fields.get('contentDigest')) {
          poisonClient('PROTOCOL_DIGEST_MISMATCH');
          fail('PROTOCOL_DIGEST_MISMATCH', 'private namespace write digest changed');
        }
        return result;
      },
      readFile(value) {
        const fields = dataFields(
          value,
          ['relativePath', 'maxBytes'],
          undefined,
          'privateNamespace.readFile input'
        );
        const result = invoke(ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_READ_FILE, {
          namespaceCapabilityId,
          relativePath: fields.get('relativePath'),
          maxBytes: fields.get('maxBytes'),
        }, { namespace: true });
        if (result.found
          && Buffer.from(result.contentBase64, 'base64').length > fields.get('maxBytes')) {
          poisonClient('PROTOCOL_LIMIT_EXCEEDED');
          fail('PROTOCOL_LIMIT_EXCEEDED', 'private namespace read exceeded the requested bound');
        }
        return result;
      },
      list(value) {
        const fields = dataFields(
          value,
          ['relativePath', 'maxEntries'],
          undefined,
          'privateNamespace.list input'
        );
        const result = invoke(ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_LIST, {
          namespaceCapabilityId,
          relativePath: fields.get('relativePath'),
          maxEntries: fields.get('maxEntries'),
        }, { namespace: true });
        if (result.entries.length > fields.get('maxEntries')) {
          poisonClient('PROTOCOL_LIMIT_EXCEEDED');
          fail('PROTOCOL_LIMIT_EXCEEDED', 'private namespace list exceeded the requested bound');
        }
        return result;
      },
      remove(value) {
        const fields = dataFields(
          value,
          ['relativePath', 'recursive'],
          undefined,
          'privateNamespace.remove input'
        );
        return invoke(ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_REMOVE, {
          namespaceCapabilityId,
          relativePath: fields.get('relativePath'),
          recursive: fields.get('recursive'),
        }, { namespace: true });
      },
      sync() {
        return invoke(ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_SYNC, {
          namespaceCapabilityId,
        }, { namespace: true });
      },
      cleanup() {
        if (phase !== 'restored') {
          fail('PROTOCOL_STATE_INVALID', 'private namespace cleanup requires terminal disposition');
        }
        const result = invoke(ANCHORED_MUTATION_HELPER_OPERATIONS.NAMESPACE_CLEANUP, {
          namespaceCapabilityId,
          checkpointDigest,
          disposition: phase,
          progressDigest,
        }, { namespace: true });
        if (result.cleaned === true) {
          namespaceCleaned = true;
          phase = 'disposed';
        }
        return result;
      },
    });

    return Object.freeze({
      schemaVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
      helperId: handshakeResult.helperId,
      rootIdentityDigest: response.payload.rootIdentityDigest,
      namespaceIdentityDigest: response.payload.namespaceIdentityDigest,
      identityReceipt: response.payload.identityReceipt,
      privateNamespace,
      inspectProgress() {
        const result = invoke(
          ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_INSPECT_PROGRESS,
          {}
        );
        const isPrefix = result.checkpointDigest === checkpointDigest
          && result.moved.every((name, index) => name === targetPayloadNames[index]);
        const regressedOutsideRestore = phase !== 'restored'
          && result.moved.length < movedCount;
        if (!isPrefix || regressedOutsideRestore
          || (phase === 'restored' && result.moved.length !== 0)) {
          poisonClient('PROTOCOL_PROGRESS_INVALID');
          fail('PROTOCOL_PROGRESS_INVALID', 'helper returned invalid inspected movement progress');
        }
        movedCount = result.moved.length;
        progressDigest = result.progressDigest;
        if (phase !== 'restored') {
          phase = movedCount === 0
            ? 'prepared'
            : movedCount === targetPayloadNames.length ? 'quarantined' : 'partial';
        }
        return result;
      },
      verify(value) {
        const normalized = normalizeCheckpointRequestPayload(value, 'verify input');
        if (normalized.checkpointDigest !== checkpointDigest) {
          fail('PROTOCOL_DIGEST_MISMATCH', 'verify checkpoint digest changed');
        }
        return invoke(ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_VERIFY, normalized);
      },
      moveToQuarantine(value) {
        const normalized = normalizeCheckpointRequestPayload(value, 'moveToQuarantine input');
        if (normalized.checkpointDigest !== checkpointDigest) {
          fail('PROTOCOL_DIGEST_MISMATCH', 'move checkpoint digest changed');
        }
        if (!['prepared', 'partial'].includes(phase)) {
          fail('PROTOCOL_STATE_INVALID', 'movement is not valid in the current session phase');
        }
        const result = invoke(
          ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_MOVE_TO_QUARANTINE,
          normalized
        );
        const monotonicPrefix = result.checkpointDigest === checkpointDigest
          && result.moved.length >= movedCount
          && result.moved.every((name, index) => name === targetPayloadNames[index]);
        if (!monotonicPrefix) {
          poisonClient('PROTOCOL_PROGRESS_INVALID');
          fail('PROTOCOL_PROGRESS_INVALID', 'helper returned non-prefix movement progress');
        }
        movedCount = result.moved.length;
        progressDigest = result.progressDigest;
        phase = movedCount === targetPayloadNames.length ? 'quarantined' : 'partial';
        return result;
      },
      restoreFromQuarantine(value) {
        const normalized = normalizeCheckpointRequestPayload(value, 'restoreFromQuarantine input');
        if (normalized.checkpointDigest !== checkpointDigest) {
          fail('PROTOCOL_DIGEST_MISMATCH', 'restore checkpoint digest changed');
        }
        if (!['prepared', 'partial', 'quarantined'].includes(phase)) {
          fail('PROTOCOL_STATE_INVALID', 'restoration is not valid in the current session phase');
        }
        const result = invoke(
          ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_RESTORE_FROM_QUARANTINE,
          normalized
        );
        const expectedRestored = targetPayloadNames.slice(0, movedCount).reverse();
        if (result.checkpointDigest !== checkpointDigest
          || JSON.stringify(result.restored) !== JSON.stringify(expectedRestored)
          || result.remainingMoved.length !== 0) {
          poisonClient('PROTOCOL_PROGRESS_INVALID');
          fail('PROTOCOL_PROGRESS_INVALID', 'helper returned non-reverse restoration progress');
        }
        movedCount = 0;
        progressDigest = result.progressDigest;
        phase = 'restored';
        return result;
      },
      purgeQuarantine(value) {
        const normalized = normalizeCheckpointRequestPayload(value, 'purgeQuarantine input');
        if (normalized.checkpointDigest !== checkpointDigest) {
          fail('PROTOCOL_DIGEST_MISMATCH', 'purge checkpoint digest changed');
        }
        if (phase !== 'quarantined') {
          fail('PROTOCOL_STATE_INVALID', 'purge requires a fully quarantined target prefix');
        }
        const result = invoke(ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_PURGE_QUARANTINE, {
          checkpointDigest,
          namespaceCapabilityId,
        });
        if (result.purged !== result.namespaceCleaned) {
          poisonClient('PROTOCOL_DOWNGRADE_DETECTED');
          fail(
            'PROTOCOL_DOWNGRADE_DETECTED',
            'purge and anchored namespace cleanup must reach terminal state together'
          );
        }
        if (result.purged === true) {
          namespaceCleaned = true;
          phase = 'purged';
        }
        return result;
      },
      close() {
        const result = invoke(
          ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_CLOSE,
          {},
          { allowDisposed: true }
        );
        if (result.closed === true) {
          closed = true;
          activeSessions.delete(controller);
        }
        return result;
      },
    });
  }

  function performOpenRootNamespace(input) {
    const handshakeResult = performHandshake();
    if (clientPoisoned) fail('PROTOCOL_CLIENT_POISONED', 'helper protocol client is poisoned');
    if (activeSessions.size >= ANCHORED_MUTATION_HELPER_LIMITS.maxActiveSessions
      || totalSessions >= ANCHORED_MUTATION_HELPER_LIMITS.maxTotalSessions) {
      fail('PROTOCOL_CAPACITY_EXCEEDED', 'helper protocol session capacity was exhausted');
    }
    const inputFields = dataFields(input, ['rootPath'], ['rootPath'], 'root namespace input');
    const request = createAnchoredMutationHelperRequest({
      requestId: nextRequestId(),
      operation: ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN,
      sequence: 0,
      sessionId: null,
      previousResponseDigest: handshakeState.responseDigest,
      payload: {
        backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
        integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
        rootPathHint: inputFields.get('rootPath'),
        namespacePolicy: { ...ROOT_NAMESPACE_POLICY },
      },
    });
    const response = exchange(request, () => {
      poisonClient('PROTOCOL_ROOT_NAMESPACE_OPEN_INVALID');
    });
    const {
      sessionId,
      namespaceCapabilityId,
      rootIdentityDigest,
      namespaceIdentityDigest,
    } = response.payload;
    if (usedSessionIds.has(sessionId) || usedNamespaceCapabilityIds.has(namespaceCapabilityId)) {
      const orphan = {
        abortSent: false,
        namespaceCapabilityId,
        previousResponseDigest: response.responseDigest,
        sequence: 1,
        sessionId,
      };
      issueAbort(orphan, 'PROTOCOL_REPLAY_DETECTED');
      poisonClient('PROTOCOL_REPLAY_DETECTED');
      fail('PROTOCOL_REPLAY_DETECTED', 'native helper replayed a root namespace capability');
    }
    usedSessionIds.add(sessionId);
    usedNamespaceCapabilityIds.add(namespaceCapabilityId);
    totalSessions += 1;
    let closed = false;
    let promoted = false;
    const controller = {
      abortSent: false,
      namespaceCapabilityId,
      poisoned: false,
      previousResponseDigest: response.responseDigest,
      sequence: 1,
      sessionId,
    };
    activeSessions.add(controller);

    function assertRootUsable() {
      if (controller.poisoned) {
        fail('PROTOCOL_SESSION_POISONED', 'anchored root namespace is poisoned');
      }
      if (promoted) fail('PROTOCOL_ROOT_NAMESPACE_PROMOTED', 'root namespace was promoted');
      if (closed) fail('PROTOCOL_SESSION_CLOSED', 'anchored root namespace is closed');
    }

    function invokeRootRaw(operation, payload) {
      assertRootUsable();
      const operationRequest = createAnchoredMutationHelperRequest({
        requestId: nextRequestId(),
        operation,
        sequence: controller.sequence,
        sessionId,
        previousResponseDigest: controller.previousResponseDigest,
        payload,
      });
      const operationResponse = exchange(operationRequest, () => {
        poisonClient('PROTOCOL_ROOT_NAMESPACE_RESPONSE_INVALID');
      });
      controller.sequence += 1;
      controller.previousResponseDigest = operationResponse.responseDigest;
      return Object.freeze({ request: operationRequest, response: operationResponse });
    }

    const privateNamespace = Object.freeze({
      capabilityVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
      readFile(value) {
        return runExclusive(() => {
          const inputValue = dataFields(
            value,
            ['relativePath', 'maxBytes'],
            undefined,
            'root privateNamespace.readFile input'
          );
          const { response: readResponse } = invokeRootRaw(
            ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_READ_FILE,
            {
              namespaceCapabilityId: controller.namespaceCapabilityId,
              relativePath: inputValue.get('relativePath'),
              maxBytes: inputValue.get('maxBytes'),
            }
          );
          const result = readResponse.payload;
          if (result.found
            && Buffer.from(result.contentBase64, 'base64').length > inputValue.get('maxBytes')) {
            poisonClient('PROTOCOL_LIMIT_EXCEEDED');
            fail('PROTOCOL_LIMIT_EXCEEDED', 'root namespace read exceeded the requested bound');
          }
          return result;
        });
      },
      list(value) {
        return runExclusive(() => {
          const inputValue = dataFields(
            value,
            ['relativePath', 'maxEntries'],
            undefined,
            'root privateNamespace.list input'
          );
          const { response: listResponse } = invokeRootRaw(
            ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_LIST,
            {
              namespaceCapabilityId: controller.namespaceCapabilityId,
              relativePath: inputValue.get('relativePath'),
              maxEntries: inputValue.get('maxEntries'),
            }
          );
          const result = listResponse.payload;
          if (result.entries.length > inputValue.get('maxEntries')) {
            poisonClient('PROTOCOL_LIMIT_EXCEEDED');
            fail('PROTOCOL_LIMIT_EXCEEDED', 'root namespace list exceeded the requested bound');
          }
          return result;
        });
      },
    });

    return Object.freeze({
      schemaVersion: ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION,
      helperId: handshakeResult.helperId,
      rootIdentityDigest,
      namespaceIdentityDigest,
      privateNamespace,
      cleanupAuthenticatedOrphan(value) {
        return runExclusive(() => {
          const inputValue = dataFields(value, [
            'transactionId',
            'bindingDigest',
            'manifestDigest',
            'journalDigest',
            'headContentDigest',
            'anchorChainDigest',
          ], undefined, 'cleanupAuthenticatedOrphan input');
          return invokeRootRaw(
            ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLEANUP_AUTHENTICATED_ORPHAN,
            {
              namespaceCapabilityId: controller.namespaceCapabilityId,
              transactionId: inputValue.get('transactionId'),
              bindingDigest: inputValue.get('bindingDigest'),
              manifestDigest: inputValue.get('manifestDigest'),
              journalDigest: inputValue.get('journalDigest'),
              headContentDigest: inputValue.get('headContentDigest'),
              anchorChainDigest: inputValue.get('anchorChainDigest'),
            }
          ).response.payload;
        });
      },
      openExistingSession(value) {
        return runExclusive(() => {
          const inputValue = dataFields(value, [
            'transactionPath',
            'payloadPath',
            'headPath',
            'anchorPath',
            'bindingDigest',
            'checkpointDigest',
            'manifestDigest',
            'journalDigest',
            'targets',
            'checkpointEntries',
            'identityReceipt',
          ], undefined, 'openExistingSession input');
          const expectedIdentityReceipt = normalizeIdentityReceipt(
            inputValue.get('identityReceipt'),
            {
              bindingDigest: inputValue.get('bindingDigest'),
              checkpointDigest: inputValue.get('checkpointDigest'),
              targets: inputValue.get('targets'),
              checkpointEntries: inputValue.get('checkpointEntries'),
            },
            'openExistingSession identityReceipt'
          );
          if (expectedIdentityReceipt.rootIdentity.identityDigest !== rootIdentityDigest
            || expectedIdentityReceipt.namespaceIdentity.identityDigest
              !== namespaceIdentityDigest) {
            fail(
              'PROTOCOL_IDENTITY_MISMATCH',
              'openExistingSession identityReceipt does not match the anchored root namespace'
            );
          }
          const { request: promotionRequest, response: promotionResponse } = invokeRootRaw(
            ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN_EXISTING_SESSION,
            {
              namespaceCapabilityId: controller.namespaceCapabilityId,
              backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
              sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
              integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
              transactionPathHint: inputValue.get('transactionPath'),
              payloadPathHint: inputValue.get('payloadPath'),
              headPathHint: inputValue.get('headPath'),
              anchorPathHint: inputValue.get('anchorPath'),
              bindingDigest: inputValue.get('bindingDigest'),
              checkpointDigest: inputValue.get('checkpointDigest'),
              manifestDigest: inputValue.get('manifestDigest'),
              journalDigest: inputValue.get('journalDigest'),
              targets: inputValue.get('targets'),
              checkpointEntries: inputValue.get('checkpointEntries'),
              expectedIdentityReceipt,
            }
          );
          promoted = true;
          return performOpenSession(null, {
            controller,
            namespaceCapabilityId: controller.namespaceCapabilityId,
            namespaceIdentityDigest,
            request: promotionRequest,
            response: promotionResponse,
            rootIdentityDigest,
            sequence: controller.sequence,
            sessionId,
          });
        });
      },
      close() {
        return runExclusive(() => {
          const result = invokeRootRaw(
            ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLOSE,
            { namespaceCapabilityId: controller.namespaceCapabilityId }
          ).response.payload;
          if (result.closed === true) {
            closed = true;
            activeSessions.delete(controller);
          }
          return result;
        });
      },
    });
  }

  function openSession(input) {
    return runExclusive(() => performOpenSession(normalizeSessionClientInput(input)));
  }

  function openRootNamespace(input) {
    return runExclusive(() => performOpenRootNamespace(normalizeRootNamespaceClientInput(input)));
  }

  return Object.freeze({
    version: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    handshake,
    openRootNamespace,
    openSession,
  });
}

module.exports = {
  ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
  ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  ANCHORED_MUTATION_HELPER_LIMITS,
  ANCHORED_MUTATION_HELPER_OPERATIONS,
  ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
  AnchoredMutationHelperProtocolError,
  assertAnchoredMutationHelperAbort,
  assertAnchoredMutationHelperRequest,
  assertAnchoredMutationHelperResponse,
  createAnchoredMutationHelperProtocolClient,
  createAnchoredMutationHelperRequest,
  createAnchoredMutationHelperResponse,
};
