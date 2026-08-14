'use strict';

const ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION =
  'anchored-filesystem-mutation-backend.v1';
const ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION =
  'anchored-filesystem-mutation-session.v1';
const ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES = Object.freeze({
  ENFORCED: 'enforced',
  UNAVAILABLE: 'unavailable',
});
const ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES = Object.freeze([
  'physical_root_pinned',
  'ancestor_chain_pinned',
  'source_identity_bound',
  'subtree_identity_bound',
  'atomic_rename_to_quarantine',
  'rollback_no_overwrite',
  'same_filesystem',
  'symlink_no_follow',
  // moveToQuarantine advances targets from index 0 upward; rollback restores
  // them in reverse order. After a crash, physical progress is therefore one
  // authenticated prefix and can be resumed without guessing a bitmap.
  'ordered_prefix_progress',
]);

function isPlainDataRecord(value, allowedKeys = null, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return false;
  if (allowedKeys && keys.some((key) => !allowedKeys.includes(key))) return false;
  if (requiredKeys && requiredKeys.some((key) => !keys.includes(key))) return false;
  return keys.every((key) => {
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

function denseStringArray(value, fieldName) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${fieldName} must be a standard dense string array`);
  }
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be a standard dense string array`);
  }
  const result = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName} must contain data values only`);
    }
    if (typeof descriptor.value !== 'string' || !descriptor.value) {
      throw new TypeError(`${fieldName} must contain non-empty strings`);
    }
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function normalizeBackendId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new TypeError('backendId must be a stable identifier');
  }
  return value;
}

function createAnchoredFilesystemMutationProbe(input = {}) {
  if (!isPlainDataRecord(
    input,
    ['backendId', 'state', 'guarantees', 'reasonCode'],
    ['backendId', 'state', 'guarantees', 'reasonCode']
  )) throw new TypeError('Invalid anchored filesystem mutation probe');
  const backendId = normalizeBackendId(dataValue(input, 'backendId'));
  const state = dataValue(input, 'state');
  if (!Object.values(ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES).includes(state)) {
    throw new TypeError('Invalid anchored filesystem mutation probe state');
  }
  const guarantees = denseStringArray(dataValue(input, 'guarantees'), 'guarantees');
  if (new Set(guarantees).size !== guarantees.length) {
    throw new TypeError('Anchored filesystem mutation guarantees must be unique');
  }
  const reasonCode = dataValue(input, 'reasonCode');
  if (typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(reasonCode)) {
    throw new TypeError('reasonCode must be a stable uppercase code');
  }
  return Object.freeze({
    schemaVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    backendId,
    state,
    guarantees,
    reasonCode,
  });
}

function assertAnchoredFilesystemMutationProbe(probe, { requireEnforced = false } = {}) {
  if (!isPlainDataRecord(probe, [
    'schemaVersion',
    'backendId',
    'state',
    'guarantees',
    'reasonCode',
  ])) throw new TypeError('Invalid anchored filesystem mutation probe');
  if (dataValue(probe, 'schemaVersion') !== ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION) {
    throw new TypeError('Unsupported anchored filesystem mutation probe version');
  }
  const normalized = createAnchoredFilesystemMutationProbe({
    backendId: dataValue(probe, 'backendId'),
    state: dataValue(probe, 'state'),
    guarantees: dataValue(probe, 'guarantees'),
    reasonCode: dataValue(probe, 'reasonCode'),
  });
  const guaranteeSet = new Set(normalized.guarantees);
  const complete = ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES.every(
    (guarantee) => guaranteeSet.has(guarantee)
  );
  if (normalized.state === ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED && !complete) {
    throw new TypeError('Enforced anchored mutation backend omitted required guarantees');
  }
  if (requireEnforced
    && normalized.state !== ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED) {
    throw new TypeError('Anchored filesystem mutation backend is unavailable');
  }
  return normalized;
}

function assertAnchoredFilesystemMutationSession(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new TypeError('Anchored filesystem mutation session is required');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(session, 'schemaVersion');
  if (!versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION) {
    throw new TypeError('Invalid anchored filesystem mutation session version');
  }
  for (const method of [
    'verify',
    'moveToQuarantine',
    'restoreFromQuarantine',
    'purgeQuarantine',
    'close',
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(session, method);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
      throw new TypeError(`Anchored filesystem mutation session.${method} is required`);
    }
  }
  return session;
}

function createUnsupportedAnchoredFilesystemMutationBackend({
  backendId = 'anchored-mutation-unsupported',
  reasonCode = 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE',
} = {}) {
  const probe = createAnchoredFilesystemMutationProbe({
    backendId,
    state: ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.UNAVAILABLE,
    guarantees: [],
    reasonCode,
  });
  return Object.freeze({
    version: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    probe() { return probe; },
    prepare() {
      const error = new Error('Anchored filesystem mutation backend is unavailable');
      error.code = reasonCode;
      throw error;
    },
  });
}

function assertAnchoredFilesystemMutationBackend(backend) {
  if (!backend || typeof backend !== 'object' || Array.isArray(backend)) {
    throw new TypeError('Anchored filesystem mutation backend is required');
  }
  for (const method of ['probe', 'prepare']) {
    if (typeof backend[method] !== 'function') {
      throw new TypeError(`Anchored filesystem mutation backend.${method} is required`);
    }
  }
  const probe = backend.probe();
  if (probe && typeof probe.then === 'function') {
    throw new TypeError('Anchored filesystem mutation backend probe must be synchronous');
  }
  assertAnchoredFilesystemMutationProbe(probe);
  return backend;
}

module.exports = {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  assertAnchoredFilesystemMutationBackend,
  assertAnchoredFilesystemMutationProbe,
  assertAnchoredFilesystemMutationSession,
  createAnchoredFilesystemMutationProbe,
  createUnsupportedAnchoredFilesystemMutationBackend,
};
