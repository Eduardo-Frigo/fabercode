'use strict';

const util = require('util');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  assertAnchoredFilesystemMutationProbe,
  createUnsupportedAnchoredFilesystemMutationBackend,
} = require('../capabilities/anchored_filesystem_mutation_backend_contract');
const {
  ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION,
} = require('../capabilities/anchored_mutation_identity_receipt_contract');
const {
  ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
} = require('../capabilities/anchored_mutation_helper_protocol');
const {
  canonicalSha256Digest,
} = require('../capabilities/transactional_delete_contracts');
const {
  ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
  createAnchoredMutationRuntimeConfig,
} = require('../runtime/anchored_mutation_runtime_config');
const {
  ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
  createAnchoredMutationBackendAdapter,
} = require('./anchored_mutation_backend_adapter');

const AGENTIC_DELETE_MUTATION_BACKEND_FACTORY_VERSION =
  'agentic-delete-mutation-backend-factory.v1';

const PROVIDER_VERSION = 'anchored-mutation-provider.v1';
const ISOLATION_ATTESTATION_VERSION =
  'anchored-mutation-isolation-attestation.v1';
const UNSUPPORTED_BACKEND_ID = 'faber-main-anchored-delete-unavailable';
const UNSUPPORTED_REASON_CODE = 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE';
const SAFE_BUILD_ID = /^[A-Za-z0-9._:@-]{1,128}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const DATA_GRAPH_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxProperties: 200_000,
});

const DEFAULT_CONFIG = createAnchoredMutationRuntimeConfig({ env: {} });

function absorbNativePromise(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [() => undefined, () => undefined]);
    return true;
  } catch {
    return false;
  }
}

function preflightDataGraph(root) {
  const seen = new Set();
  const stack = [{ depth: 0, value: root }];
  let bounded = true;
  let hasNativePromise = false;
  let inspectable = true;
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
    if (nodeCount > DATA_GRAPH_LIMITS.maxNodes || depth > DATA_GRAPH_LIMITS.maxDepth) {
      bounded = false;
      continue;
    }
    if (util.types.isProxy(value)) {
      inspectable = false;
      continue;
    }

    let keys;
    try { keys = Reflect.ownKeys(value); } catch (error) {
      absorbNativePromise(error);
      inspectable = false;
      continue;
    }
    propertyCount += keys.length;
    const mayDescend = propertyCount <= DATA_GRAPH_LIMITS.maxProperties;
    if (!mayDescend) bounded = false;
    for (const key of keys) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
        absorbNativePromise(error);
        inspectable = false;
        continue;
      }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        inspectable = false;
        continue;
      }
      if (absorbNativePromise(descriptor.value)) {
        hasNativePromise = true;
      } else if (mayDescend && descriptor.value
        && (typeof descriptor.value === 'object' || typeof descriptor.value === 'function')) {
        stack.push({ depth: depth + 1, value: descriptor.value });
      }
    }
  }

  return { bounded, hasNativePromise, inspectable };
}

function exactDataFields(
  value,
  allowedKeys,
  requiredKeys = allowedKeys,
  { allowUndefined = [] } = {}
) {
  const preflight = preflightDataGraph(value);
  if (preflight.hasNativePromise || !preflight.bounded || !preflight.inspectable
    || !value || typeof value !== 'object' || Array.isArray(value)) return null;

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
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;

  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (error) {
      absorbNativePromise(error);
      return null;
    }
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
      || (descriptor.value === undefined && !allowUndefined.includes(key))) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function normalizeConfig(value) {
  const fields = exactDataFields(
    value,
    ['version', 'mode', 'killSwitch'],
    ['version', 'mode', 'killSwitch']
  );
  if (!fields
    || fields.get('version') !== ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION
    || !['disabled', 'enabled'].includes(fields.get('mode'))
    || typeof fields.get('killSwitch') !== 'boolean') return null;
  return Object.freeze({
    version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
    mode: fields.get('mode'),
    killSwitch: fields.get('killSwitch'),
  });
}

function normalizeTransport(value) {
  const fields = exactDataFields(value, ['exchange', 'abort'], ['exchange', 'abort']);
  if (!fields || typeof fields.get('exchange') !== 'function'
    || typeof fields.get('abort') !== 'function') return null;
  return value;
}

function normalizeAttestation(value, providerVersion, buildId) {
  const fields = exactDataFields(value, [
    'schemaVersion',
    'identityReceiptVersion',
    'physicalIdentityReceipts',
    'sourceIdentityCompareAndSwap',
    'subtreeMutationExcluded',
    'durablePhysicalProgress',
    'attestationDigest',
  ]);
  if (!fields
    || fields.get('schemaVersion') !== ISOLATION_ATTESTATION_VERSION
    || fields.get('identityReceiptVersion') !== ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION
    || fields.get('physicalIdentityReceipts') !== true
    || fields.get('sourceIdentityCompareAndSwap') !== true
    || fields.get('subtreeMutationExcluded') !== true
    || fields.get('durablePhysicalProgress') !== true
    || typeof fields.get('attestationDigest') !== 'string'
    || !DIGEST.test(fields.get('attestationDigest'))) return null;

  const attestationCore = {
    providerVersion,
    buildId,
    schemaVersion: ISOLATION_ATTESTATION_VERSION,
    identityReceiptVersion: ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION,
    physicalIdentityReceipts: true,
    sourceIdentityCompareAndSwap: true,
    subtreeMutationExcluded: true,
    durablePhysicalProgress: true,
  };
  if (fields.get('attestationDigest') !== canonicalSha256Digest(attestationCore)) return null;
  return value;
}

function providerDisposer(value) {
  if (util.types.isProxy(value)) return () => {};
  let receiver = null;
  let method = null;
  try {
    const descriptor = value && Object.getOwnPropertyDescriptor(value, 'dispose');
    if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function') {
      receiver = value;
      method = descriptor.value;
    }
  } catch (error) { absorbNativePromise(error); }

  let disposed = false;
  return function disposeProvider() {
    if (disposed) return;
    disposed = true;
    const currentMethod = method;
    const currentReceiver = receiver;
    method = null;
    receiver = null;
    if (!currentMethod) return;
    try {
      const result = Reflect.apply(currentMethod, currentReceiver, []);
      preflightDataGraph(result);
    } catch (error) { preflightDataGraph(error); }
  };
}

function disposeResolvedProviderPromise(value) {
  if (!util.types.isPromise(value)) return false;
  try {
    Reflect.apply(Promise.prototype.then, value, [
      (provider) => providerDisposer(provider)(),
      () => undefined,
    ]);
  } catch {
    // A native Promise with poisoned species metadata is rejected without
    // consulting userland `.then`; retrying would introduce a second TOCTOU.
  }
  return true;
}

function createRevocableBackend(adapter, disposeProvider) {
  const unavailable = createUnsupportedAnchoredFilesystemMutationBackend({
    backendId: UNSUPPORTED_BACKEND_ID,
    reasonCode: UNSUPPORTED_REASON_CODE,
  });
  let active = true;
  let disposed = false;

  function requireActive(method, input) {
    if (!active) return unavailable[method](input);
    return adapter[method](input);
  }

  const backend = Object.freeze({
    version: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    adapterVersion: ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
    namespaceIoVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
    probe() { return active ? adapter.probe() : unavailable.probe(); },
    openRootNamespace(input) { return requireActive('openRootNamespace', input); },
    prepare(input) { return requireActive('prepare', input); },
  });

  return Object.freeze({
    backend,
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      disposeProvider();
    },
  });
}

function normalizeProvider(value) {
  const fields = exactDataFields(value, [
    'providerVersion',
    'buildId',
    'transport',
    'dispose',
    'isolationAttestation',
  ]);
  if (!fields
    || fields.get('providerVersion') !== PROVIDER_VERSION
    || typeof fields.get('buildId') !== 'string'
    || !SAFE_BUILD_ID.test(fields.get('buildId'))
    || typeof fields.get('dispose') !== 'function') return null;
  const transport = normalizeTransport(fields.get('transport'));
  const attestation = normalizeAttestation(
    fields.get('isolationAttestation'),
    fields.get('providerVersion'),
    fields.get('buildId')
  );
  if (!transport || !attestation) return null;
  return Object.freeze({ transport });
}

function diagnostics(status, reasonCode, config) {
  return Object.freeze({
    status,
    reasonCode,
    mode: config.mode,
    killSwitch: config.killSwitch,
  });
}

function unsupportedSelection(reasonCode, config, dispose = () => {}) {
  return Object.freeze({
    version: AGENTIC_DELETE_MUTATION_BACKEND_FACTORY_VERSION,
    backend: createUnsupportedAnchoredFilesystemMutationBackend({
      backendId: UNSUPPORTED_BACKEND_ID,
      reasonCode: UNSUPPORTED_REASON_CODE,
    }),
    diagnostics: diagnostics('unsupported', reasonCode, config),
    dispose,
  });
}

function createAgenticDeleteMutationBackendSelection(options = {}) {
  const optionFields = exactDataFields(
    options,
    ['config', 'providerFactory'],
    [],
    { allowUndefined: ['providerFactory'] }
  );
  if (!optionFields) {
    return unsupportedSelection('FACTORY_OPTIONS_INVALID', DEFAULT_CONFIG);
  }

  const config = optionFields.has('config')
    ? normalizeConfig(optionFields.get('config'))
    : DEFAULT_CONFIG;
  if (!config) return unsupportedSelection('FACTORY_OPTIONS_INVALID', DEFAULT_CONFIG);
  if (config.mode !== 'enabled') return unsupportedSelection('RUNTIME_DISABLED', config);
  if (config.killSwitch) {
    return unsupportedSelection('RUNTIME_KILL_SWITCH_ACTIVE', config);
  }

  const providerFactory = optionFields.get('providerFactory');
  if (typeof providerFactory !== 'function') {
    return unsupportedSelection('PROVIDER_UNAVAILABLE', config);
  }

  let provider;
  try {
    provider = Reflect.apply(providerFactory, undefined, []);
  } catch (error) {
    if (!disposeResolvedProviderPromise(error)) preflightDataGraph(error);
    return unsupportedSelection('PROVIDER_REJECTED', config);
  }
  if (disposeResolvedProviderPromise(provider)) {
    return unsupportedSelection('PROVIDER_REJECTED', config);
  }

  const dispose = providerDisposer(provider);
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) {
    dispose();
    return unsupportedSelection('PROVIDER_REJECTED', config, dispose);
  }

  let backend;
  let probe;
  try {
    backend = createAnchoredMutationBackendAdapter({
      backendId: 'native-anchored-mutation-helper',
      integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
      transport: normalizedProvider.transport,
    });
    const probeDescriptor = Object.getOwnPropertyDescriptor(backend, 'probe');
    if (!probeDescriptor || !Object.hasOwn(probeDescriptor, 'value')
      || typeof probeDescriptor.value !== 'function') throw new TypeError('probe unavailable');
    const rawProbe = Reflect.apply(probeDescriptor.value, backend, []);
    if (absorbNativePromise(rawProbe)) throw new TypeError('async probe denied');
    probe = assertAnchoredFilesystemMutationProbe(rawProbe);
  } catch (error) {
    preflightDataGraph(error);
    dispose();
    return unsupportedSelection('BACKEND_NOT_ENFORCED', config, dispose);
  }

  if (probe.state !== ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED) {
    dispose();
    return unsupportedSelection('BACKEND_NOT_ENFORCED', config, dispose);
  }

  const revocable = createRevocableBackend(backend, dispose);
  return Object.freeze({
    version: AGENTIC_DELETE_MUTATION_BACKEND_FACTORY_VERSION,
    backend: revocable.backend,
    diagnostics: diagnostics('enforced', 'ENFORCED', config),
    dispose: revocable.dispose,
  });
}

module.exports = {
  AGENTIC_DELETE_MUTATION_BACKEND_FACTORY_VERSION,
  createAgenticDeleteMutationBackendSelection,
};
