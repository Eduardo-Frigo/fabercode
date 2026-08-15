'use strict';

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  createAnchoredFilesystemMutationProbe,
} = require('../capabilities/anchored_filesystem_mutation_backend_contract');
const {
  ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  createAnchoredMutationHelperProtocolClient,
} = require('../capabilities/anchored_mutation_helper_protocol');

const ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION =
  'anchored-mutation-backend-adapter.v1';
const DEFAULT_BACKEND_ID = 'native-anchored-mutation-helper';
const SAFE_BACKEND_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function dataFields(value, allowedKeys, requiredKeys = [], fieldName = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')
    || keys.some((key) => !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { return null; }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
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
    probe() { return probe; },
    prepare() {
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

  // The transactional delete service currently writes its manifest and WAL by
  // pathname before mutationBackend.prepare(). Merely pinning `.faber` during
  // session.open would therefore make a false private_namespace_anchored claim.
  // A future service must opt into the helper-mediated namespace I/O API before
  // this adapter is even allowed to contact a native helper.
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
      // A public version string can negotiate the wire protocol, but cannot
      // prove that the transactional service routes every manifest/WAL read,
      // write and cleanup through session.privateNamespace. Until that v2
      // consumer exists, this adapter deliberately has no ENFORCED path.
      cachedProbe = unavailableProbe(backendId, 'NAMESPACE_IO_CONSUMER_NOT_INTEGRATED');
    } catch {
      cachedProbe = unavailableProbe(backendId, 'NATIVE_MUTATION_HELPER_HANDSHAKE_INVALID');
    }
    return cachedProbe;
  }

  function prepare(input) {
    void input;
    probe();
    const error = new Error('Anchored native mutation helper is unavailable');
    error.code = 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE';
    throw error;
  }

  return Object.freeze({
    version: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    adapterVersion: ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
    probe,
    prepare,
  });
}

module.exports = {
  ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
  createAnchoredMutationBackendAdapter,
};
