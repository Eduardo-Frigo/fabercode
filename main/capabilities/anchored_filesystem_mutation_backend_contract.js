'use strict';

const ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION =
  'anchored-filesystem-mutation-backend.v1';
const ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION =
  'anchored-filesystem-mutation-session.v1';
const ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION =
  'anchored-root-namespace.v1';
const ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION =
  'anchored-filesystem-mutation-namespace-io.v2';
const ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES = Object.freeze({
  ENFORCED: 'enforced',
  UNAVAILABLE: 'unavailable',
});
const DATA_GRAPH_PREFLIGHT_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxProperties: 200_000,
});
const ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES = Object.freeze([
  'physical_root_pinned',
  'ancestor_chain_pinned',
  // Creation, opening and cleanup of transaction metadata must happen
  // through the pinned project root. Pathname writes performed before the
  // anchored session exists do not satisfy this guarantee.
  'private_namespace_anchored',
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
  const preflight = absorbNativePromisesInDataGraph(value);
  if (preflight.hasNativePromise || !preflight.bounded || !preflight.inspectable) return false;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (keys.some((key) => typeof key !== 'string')) return false;
  if (allowedKeys && keys.some((key) => !allowedKeys.includes(key))) return false;
  if (requiredKeys && requiredKeys.some((key) => !keys.includes(key))) return false;
  return keys.every((key) => {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      return false;
    }
    return Boolean(descriptor)
      && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      && descriptor.value !== undefined;
  });
}

function dataValue(value, key) {
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
    absorbNativePromise(error);
    return undefined;
  }
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function denseStringArray(value, fieldName) {
  const preflight = absorbNativePromisesInDataGraph(value);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  } catch (error) {
    absorbNativePromise(error);
    throw new TypeError(`${fieldName} must be a standard dense string array`);
  }
  if (preflight.hasNativePromise || !preflight.bounded || !preflight.inspectable
    || !Array.isArray(value) || prototype !== Array.prototype) {
    throw new TypeError(`${fieldName} must be a standard dense string array`);
  }
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${fieldName} must be a standard dense string array`);
  }
  const result = [];
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      throw new TypeError(`${fieldName} must contain data values only`);
    }
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

function isCanonicalDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function absorbNativePromise(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
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

function exactOwnDataDescriptors(value, expectedKeys, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} is required`);
  }
  const preflight = absorbNativePromisesInDataGraph(value);
  if (preflight.hasNativePromise || !preflight.bounded || !preflight.inspectable) {
    throw new TypeError(`${fieldName} shape is invalid`);
  }
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    throw new TypeError(`${fieldName} is not inspectable`);
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))) {
    throw new TypeError(`${fieldName} shape is invalid`);
  }
  const descriptors = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      throw new TypeError(`${fieldName} is not inspectable`);
    }
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${fieldName}.${key} must be an enumerable data property`);
    }
    descriptors.set(key, descriptor);
  }
  return descriptors;
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

function assertAnchoredFilesystemMutationPrivateNamespace(
  privateNamespace,
  { readOnly = false } = {}
) {
  const methods = readOnly
    ? ['readFile', 'list']
    : ['writeFile', 'readFile', 'list', 'remove', 'sync', 'cleanup'];
  const expectedKeys = ['capabilityVersion', ...methods];
  const descriptors = exactOwnDataDescriptors(
    privateNamespace,
    expectedKeys,
    'Anchored filesystem mutation private namespace'
  );
  const capabilityDescriptor = descriptors.get('capabilityVersion');
  if (!capabilityDescriptor || !Object.hasOwn(capabilityDescriptor, 'value')
    || capabilityDescriptor.value !== ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION) {
    throw new TypeError('Invalid anchored filesystem mutation namespace-I/O capability version');
  }
  for (const method of methods) {
    const descriptor = descriptors.get(method);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function') {
      throw new TypeError(`Anchored filesystem mutation private namespace.${method} is required`);
    }
  }
  return privateNamespace;
}

function assertAnchoredFilesystemMutationNamespaceSession(session) {
  const expectedKeys = [
    'schemaVersion',
    'helperId',
    'rootIdentityDigest',
    'namespaceIdentityDigest',
    'privateNamespace',
    'inspectProgress',
    'verify',
    'moveToQuarantine',
    'restoreFromQuarantine',
    'purgeQuarantine',
    'close',
  ];
  const descriptors = exactOwnDataDescriptors(
    session,
    expectedKeys,
    'Anchored filesystem mutation namespace session'
  );
  try {
    assertAnchoredFilesystemMutationSession(session);
  } catch (error) {
    if (absorbNativePromise(error)) {
      throw new TypeError('Anchored filesystem mutation namespace session is not inspectable');
    }
    throw error;
  }
  const inspectDescriptor = descriptors.get('inspectProgress');
  if (!inspectDescriptor || !Object.hasOwn(inspectDescriptor, 'value')
    || typeof inspectDescriptor.value !== 'function') {
    throw new TypeError('Anchored filesystem mutation session.inspectProgress is required');
  }
  const helperDescriptor = descriptors.get('helperId');
  if (!helperDescriptor || typeof helperDescriptor.value !== 'string' || !helperDescriptor.value) {
    throw new TypeError('Anchored filesystem mutation session.helperId is required');
  }
  for (const field of ['rootIdentityDigest', 'namespaceIdentityDigest']) {
    const descriptor = descriptors.get(field);
    if (!descriptor || !isCanonicalDigest(descriptor.value)) {
      throw new TypeError(`Anchored filesystem mutation session.${field} is invalid`);
    }
  }
  const namespaceDescriptor = descriptors.get('privateNamespace');
  const privateNamespace = namespaceDescriptor && Object.hasOwn(namespaceDescriptor, 'value')
    ? namespaceDescriptor.value
    : null;
  assertAnchoredFilesystemMutationPrivateNamespace(privateNamespace);
  return session;
}

function assertAnchoredFilesystemMutationRootNamespace(rootNamespace) {
  const expectedKeys = [
    'schemaVersion',
    'helperId',
    'rootIdentityDigest',
    'namespaceIdentityDigest',
    'privateNamespace',
    'cleanupAuthenticatedOrphan',
    'openExistingSession',
    'close',
  ];
  const descriptors = exactOwnDataDescriptors(
    rootNamespace,
    expectedKeys,
    'Anchored filesystem mutation root namespace'
  );
  const versionDescriptor = descriptors.get('schemaVersion');
  if (!versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION) {
    throw new TypeError('Invalid anchored filesystem mutation root namespace version');
  }
  for (const field of ['helperId', 'rootIdentityDigest', 'namespaceIdentityDigest']) {
    const descriptor = descriptors.get(field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string' || !descriptor.value) {
      throw new TypeError(`Anchored filesystem mutation root namespace.${field} is required`);
    }
    if (field !== 'helperId' && !isCanonicalDigest(descriptor.value)) {
      throw new TypeError(`Anchored filesystem mutation root namespace.${field} is invalid`);
    }
  }
  const namespaceDescriptor = descriptors.get('privateNamespace');
  const privateNamespace = namespaceDescriptor && Object.hasOwn(namespaceDescriptor, 'value')
    ? namespaceDescriptor.value
    : null;
  if (!privateNamespace || typeof privateNamespace !== 'object' || Array.isArray(privateNamespace)) {
    throw new TypeError('Anchored filesystem mutation root namespace.privateNamespace is required');
  }
  assertAnchoredFilesystemMutationPrivateNamespace(privateNamespace, { readOnly: true });
  for (const method of ['cleanupAuthenticatedOrphan', 'openExistingSession', 'close']) {
    const descriptor = descriptors.get(method);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
      throw new TypeError(`Anchored filesystem mutation root namespace.${method} is required`);
    }
  }
  return rootNamespace;
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
    openRootNamespace() {
      const error = new Error('Anchored filesystem mutation backend is unavailable');
      error.code = reasonCode;
      throw error;
    },
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
  const preflight = absorbNativePromisesInDataGraph(backend);
  if (preflight.hasNativePromise || !preflight.bounded || !preflight.inspectable) {
    throw new TypeError('Anchored filesystem mutation backend shape is invalid');
  }
  const methods = new Map();
  for (const method of ['probe', 'prepare']) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(backend, method); } catch (error) {
      absorbNativePromise(error);
      throw new TypeError(`Anchored filesystem mutation backend.${method} is not inspectable`);
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function') {
      throw new TypeError(`Anchored filesystem mutation backend.${method} is required`);
    }
    methods.set(method, descriptor.value);
  }
  let probe;
  try {
    probe = Reflect.apply(methods.get('probe'), backend, []);
  } catch (error) {
    absorbNativePromise(error);
    throw new TypeError('Anchored filesystem mutation backend probe failed');
  }
  if (absorbNativePromise(probe)) {
    throw new TypeError('Anchored filesystem mutation backend probe must be synchronous');
  }
  assertAnchoredFilesystemMutationProbe(probe);
  return backend;
}

function assertAnchoredFilesystemMutationNamespaceBackend(backend) {
  assertAnchoredFilesystemMutationBackend(backend);
  let versionDescriptor;
  try {
    versionDescriptor = Object.getOwnPropertyDescriptor(backend, 'namespaceIoVersion');
  } catch (error) {
    absorbNativePromise(error);
    throw new TypeError('Anchored filesystem mutation namespace-I/O v2 backend is not inspectable');
  }
  if (!versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION) {
    throw new TypeError('Anchored filesystem mutation namespace-I/O v2 backend is required');
  }
  let openDescriptor;
  try { openDescriptor = Object.getOwnPropertyDescriptor(backend, 'openRootNamespace'); } catch (error) {
    absorbNativePromise(error);
    throw new TypeError('Anchored filesystem mutation backend.openRootNamespace is not inspectable');
  }
  if (!openDescriptor || !Object.hasOwn(openDescriptor, 'value')
    || typeof openDescriptor.value !== 'function') {
    throw new TypeError('Anchored filesystem mutation backend.openRootNamespace is required');
  }
  return backend;
}

module.exports = {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  assertAnchoredFilesystemMutationBackend,
  assertAnchoredFilesystemMutationNamespaceBackend,
  assertAnchoredFilesystemMutationNamespaceSession,
  assertAnchoredFilesystemMutationPrivateNamespace,
  assertAnchoredFilesystemMutationProbe,
  assertAnchoredFilesystemMutationRootNamespace,
  assertAnchoredFilesystemMutationSession,
  createAnchoredFilesystemMutationProbe,
  createUnsupportedAnchoredFilesystemMutationBackend,
};
