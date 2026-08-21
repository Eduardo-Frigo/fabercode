'use strict';

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  assertAnchoredFilesystemMutationNamespaceSession,
  assertAnchoredFilesystemMutationRootNamespace,
  createAnchoredFilesystemMutationProbe,
} = require('../capabilities/anchored_filesystem_mutation_backend_contract');
const {
  ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  createAnchoredMutationHelperProtocolClient,
} = require('../capabilities/anchored_mutation_helper_protocol');

const ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION =
  'anchored-mutation-backend-adapter.v2';
const DEFAULT_BACKEND_ID = 'native-anchored-mutation-helper';
const SAFE_BACKEND_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const DATA_GRAPH_PREFLIGHT_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxProperties: 200_000,
});

function absorbNativePromise(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
    return true;
  } catch {
    return false;
  }
}

function absorbPromiseInDataGraph(root) {
  const seen = new Set();
  const stack = [{ depth: 0, value: root }];
  let rejected = false;
  let nodeCount = 0;
  let propertyCount = 0;

  while (stack.length > 0) {
    const { depth, value } = stack.pop();
    if (absorbNativePromise(value)) {
      rejected = true;
      continue;
    }
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    nodeCount += 1;
    if (nodeCount > DATA_GRAPH_PREFLIGHT_LIMITS.maxNodes
      || depth > DATA_GRAPH_PREFLIGHT_LIMITS.maxDepth) {
      rejected = true;
      continue;
    }

    let keys;
    try { keys = Reflect.ownKeys(value); } catch (error) {
      absorbNativePromise(error);
      rejected = true;
      continue;
    }
    propertyCount += keys.length;
    const mayDescend = propertyCount <= DATA_GRAPH_PREFLIGHT_LIMITS.maxProperties;
    if (!mayDescend) rejected = true;
    for (const key of keys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
        absorbNativePromise(error);
        rejected = true;
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
      if (absorbNativePromise(descriptor.value)) {
        rejected = true;
      } else if (mayDescend && descriptor.value
        && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
        stack.push({ depth: depth + 1, value: descriptor.value });
      }
    }
  }

  return rejected;
}

function dataFields(value, allowedKeys, requiredKeys = [], fieldName = 'value') {
  if (absorbPromiseInDataGraph(value)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch (error) {
    absorbNativePromise(error);
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')
    || keys.some((key) => !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    if (absorbNativePromise(descriptor.value)) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function unavailableProbe(backendId, reasonCode) {
  return createAnchoredFilesystemMutationProbe({
    backendId,
    state: ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.UNAVAILABLE,
    guarantees: [],
    reasonCode,
  });
}

function createUnavailableBackend(backendId, reasonCode) {
  const probe = unavailableProbe(backendId, reasonCode);
  return Object.freeze({
    version: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    adapterVersion: ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
    namespaceIoVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
    probe() { return probe; },
    openRootNamespace(input) {
      absorbPromiseInDataGraph(input);
      const error = new Error('Anchored native mutation helper is unavailable');
      error.code = 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE';
      throw error;
    },
    prepare(input) {
      absorbPromiseInDataGraph(input);
      const error = new Error('Anchored native mutation helper is unavailable');
      error.code = 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE';
      throw error;
    },
  });
}

function createAnchoredMutationBackendAdapter(options = {}) {
  const fields = dataFields(options, [
    'backendId',
    'integrationVersion',
    'transport',
    'requestIdFactory',
  ]);
  if (!fields) {
    return createUnavailableBackend(DEFAULT_BACKEND_ID, 'NATIVE_MUTATION_ADAPTER_OPTIONS_INVALID');
  }

  const rawBackendId = fields.has('backendId') ? fields.get('backendId') : DEFAULT_BACKEND_ID;
  const backendId = typeof rawBackendId === 'string' && SAFE_BACKEND_ID.test(rawBackendId)
    ? rawBackendId
    : DEFAULT_BACKEND_ID;
  if (rawBackendId !== backendId) {
    return createUnavailableBackend(backendId, 'NATIVE_MUTATION_ADAPTER_OPTIONS_INVALID');
  }

  if (fields.get('integrationVersion') !== ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION) {
    return createUnavailableBackend(backendId, 'NAMESPACE_IO_INTEGRATION_REQUIRED');
  }
  if (!fields.has('transport')) {
    return createUnavailableBackend(backendId, 'NATIVE_MUTATION_HELPER_UNAVAILABLE');
  }

  let client;
  try {
    const clientOptions = { transport: fields.get('transport') };
    if (fields.has('requestIdFactory')) {
      clientOptions.requestIdFactory = fields.get('requestIdFactory');
    }
    client = createAnchoredMutationHelperProtocolClient(clientOptions);
  } catch {
    return createUnavailableBackend(backendId, 'NATIVE_MUTATION_HELPER_UNAVAILABLE');
  }

  let cachedProbe = null;

  function probe() {
    if (cachedProbe) return cachedProbe;
    try {
      const handshake = client.handshake();
      const exactGuarantees = JSON.stringify(handshake.guarantees)
        === JSON.stringify(ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES);
      if (!exactGuarantees
        || handshake.integrationVersion !== ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION) {
        throw new TypeError('Native mutation helper handshake was downgraded');
      }
      cachedProbe = createAnchoredFilesystemMutationProbe({
        backendId,
        state: ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED,
        guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
        reasonCode: 'ENFORCED',
      });
    } catch {
      cachedProbe = unavailableProbe(backendId, 'NATIVE_MUTATION_HELPER_HANDSHAKE_INVALID');
    }
    return cachedProbe;
  }

  function prepare(input) {
    if (absorbPromiseInDataGraph(input)) {
      const error = new TypeError('Anchored mutation adapter input must be synchronous plain data');
      error.code = 'PROTOCOL_ASYNC_INPUT';
      throw error;
    }
    const currentProbe = probe();
    if (currentProbe.state !== ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED) {
      const error = new Error('Anchored native mutation helper is unavailable');
      error.code = 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE';
      throw error;
    }
    return assertAnchoredFilesystemMutationNamespaceSession(client.openSession(input));
  }

  function openRootNamespace(input) {
    if (absorbPromiseInDataGraph(input)) {
      const error = new TypeError('Anchored mutation adapter input must be synchronous plain data');
      error.code = 'PROTOCOL_ASYNC_INPUT';
      throw error;
    }
    const currentProbe = probe();
    if (currentProbe.state !== ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED) {
      const error = new Error('Anchored native mutation helper is unavailable');
      error.code = 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE';
      throw error;
    }
    return assertAnchoredFilesystemMutationRootNamespace(client.openRootNamespace(input));
  }

  return Object.freeze({
    version: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    adapterVersion: ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
    namespaceIoVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
    probe,
    openRootNamespace,
    prepare,
  });
}

module.exports = {
  ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
  createAnchoredMutationBackendAdapter,
};
