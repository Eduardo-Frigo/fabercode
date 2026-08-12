'use strict';

const {
  SANDBOX_BACKEND_STATES,
  SANDBOX_FEATURES,
  assertSandboxBackend,
  assertSandboxProbeResult,
  createUnsupportedSandboxBackend,
} = require('./sandbox_backend_contract');

const SANDBOX_SELECTION_SCHEMA_VERSION = 'sandbox-backend.selection.v1';
const SUPPORTED_FEATURES = new Set(Object.values(SANDBOX_FEATURES));

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRequiredFeatures(features) {
  if (!Array.isArray(features)) {
    throw new TypeError('Sandbox requiredFeatures must be an array');
  }
  const normalized = [];
  for (const feature of features) {
    if (!SUPPORTED_FEATURES.has(feature)) {
      throw new TypeError(`Unsupported required sandbox feature: ${String(feature)}`);
    }
    if (!normalized.includes(feature)) normalized.push(feature);
  }
  return Object.freeze(normalized);
}

function supportsFeatures(probe, requiredFeatures) {
  const available = new Set(probe.features);
  return requiredFeatures.every((feature) => available.has(feature));
}

function createSandboxBackendRegistry({
  backends = [],
  unsupportedReason = 'No enforced sandbox backend is available.',
  runtime = {},
} = {}) {
  if (!isRecord(runtime)) throw new TypeError('Sandbox runtime must be an object');
  const trustedRuntime = Object.freeze({ ...runtime });
  const unsupportedBackend = createUnsupportedSandboxBackend({ reason: unsupportedReason });
  assertSandboxBackend(unsupportedBackend);
  const registered = [];
  const ids = new Set();

  function register(backend) {
    assertSandboxBackend(backend);
    if (ids.has(backend.id)) {
      throw new Error(`Duplicate sandbox backend: ${backend.id}`);
    }
    if (backend.id === unsupportedBackend.id) {
      throw new Error(`Sandbox backend id is reserved: ${backend.id}`);
    }
    registered.push(backend);
    ids.add(backend.id);
    return backend;
  }

  for (const backend of backends) register(backend);

  function list() {
    return Object.freeze(registered.map((backend) => Object.freeze({
      id: backend.id,
      schemaVersion: backend.schemaVersion,
    })));
  }

  async function select(context = {}) {
    if (!isRecord(context)) throw new TypeError('Sandbox selection context must be an object');
    if (Object.prototype.hasOwnProperty.call(context, 'runtime')) {
      throw new TypeError('Sandbox runtime must be injected by the registry');
    }
    const requiredFeatures = normalizeRequiredFeatures(context.requiredFeatures || []);
    const attempts = [];
    const candidates = [];

    for (const backend of registered) {
      try {
        const probe = assertSandboxProbeResult(await backend.probe(Object.freeze({
          ...context,
          runtime: trustedRuntime,
          requiredFeatures,
        })));
        const featureMatch = supportsFeatures(probe, requiredFeatures);
        attempts.push(Object.freeze({
          backendId: backend.id,
          state: probe.state,
          featureMatch,
          reason: probe.reason,
        }));
        if (featureMatch && probe.state !== SANDBOX_BACKEND_STATES.UNAVAILABLE) {
          candidates.push({ backend, probe });
        }
      } catch (error) {
        attempts.push(Object.freeze({
          backendId: backend.id,
          state: SANDBOX_BACKEND_STATES.UNAVAILABLE,
          featureMatch: false,
          reason: error && error.message ? error.message : 'Sandbox feature probe failed.',
        }));
      }
    }

    const enforced = candidates.find(({ probe }) => probe.state === SANDBOX_BACKEND_STATES.ENFORCED);
    const selected = enforced;

    if (selected) {
      return Object.freeze({
        schemaVersion: SANDBOX_SELECTION_SCHEMA_VERSION,
        matched: true,
        backend: selected.backend,
        probe: selected.probe,
        requiredFeatures,
        attempts: Object.freeze(attempts),
      });
    }

    const fallbackProbe = assertSandboxProbeResult(await unsupportedBackend.probe(Object.freeze({
      ...context,
      runtime: trustedRuntime,
      requiredFeatures,
    })));
    return Object.freeze({
      schemaVersion: SANDBOX_SELECTION_SCHEMA_VERSION,
      matched: false,
      backend: unsupportedBackend,
      probe: fallbackProbe,
      requiredFeatures,
      attempts: Object.freeze(attempts),
    });
  }

  return Object.freeze({
    list,
    register,
    select,
  });
}

module.exports = {
  SANDBOX_SELECTION_SCHEMA_VERSION,
  createSandboxBackendRegistry,
  normalizeRequiredFeatures,
  supportsFeatures,
};
