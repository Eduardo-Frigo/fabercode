'use strict';

const assert = require('assert');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  assertAnchoredFilesystemMutationBackend,
  assertAnchoredFilesystemMutationProbe,
} = require('../main/capabilities/anchored_filesystem_mutation_backend_contract');
const {
  ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
  ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
  createAnchoredMutationHelperResponse,
} = require('../main/capabilities/anchored_mutation_helper_protocol');
const {
  ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
  createAnchoredMutationBackendAdapter,
} = require('../main/services/anchored_mutation_backend_adapter');

function idFactory(prefix = 'adapter-request') {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

function validHandshakePayload(overrides = {}) {
  return {
    accepted: true,
    handshakeVersion: ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
    protocolVersion: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    helperId: 'adapter-test-helper',
    guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
    features: {
      synchronousEffects: true,
      dataOnlyMessages: true,
      digestBound: true,
      sequenceBound: true,
      privateNamespaceIo: 'session_mediated',
      namespaceOpenedBeforeWrites: true,
      anchoredNamespaceCleanup: true,
      outOfBandAbort: true,
      orphanedSessionAutoClose: 'bounded_native_lease',
      maxOrphanLeaseMs: 5_000,
    },
    ...overrides,
  };
}

function transportHarness({ responseMutator, asyncExchange = false } = {}) {
  const operations = [];
  const aborts = [];
  const exchange = asyncExchange
    ? async function exchangeAsync(request) {
      operations.push(request.operation);
      return createAnchoredMutationHelperResponse(request, validHandshakePayload());
    }
    : function exchangeSync(request) {
      operations.push(request.operation);
      const response = createAnchoredMutationHelperResponse(request, validHandshakePayload());
      return responseMutator ? responseMutator(request, response) : response;
    };
  return {
    operations,
    aborts,
    transport: Object.freeze({
      exchange,
      abort(message) {
        aborts.push(message);
        return { aborted: true, abortDigest: message.abortDigest };
      },
    }),
  };
}

function assertUnavailable(adapter, reasonCode) {
  assert.strictEqual(adapter.version, ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION);
  assert.strictEqual(adapter.adapterVersion, ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION);
  assert.strictEqual(assertAnchoredFilesystemMutationBackend(adapter), adapter);
  const probe = assertAnchoredFilesystemMutationProbe(adapter.probe());
  assert.strictEqual(probe.state, ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.UNAVAILABLE);
  assert.strictEqual(probe.reasonCode, reasonCode);
  assert.deepStrictEqual(probe.guarantees, []);
}

// Default/current service integration is deliberately incompatible. The
// adapter does not even perform a diagnostic handshake, much less an effect.
{
  const harness = transportHarness();
  const adapter = createAnchoredMutationBackendAdapter({
    transport: harness.transport,
    requestIdFactory: idFactory('default'),
  });
  assertUnavailable(adapter, 'NAMESPACE_IO_INTEGRATION_REQUIRED');
  assert.deepStrictEqual(harness.operations, []);
  assert.throws(
    () => adapter.prepare({}),
    (error) => error && error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'
  );
  assert.deepStrictEqual(harness.operations, []);
}

// Missing or malformed helper transports remain Unsupported without effects.
{
  assertUnavailable(createAnchoredMutationBackendAdapter({
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  }), 'NATIVE_MUTATION_HELPER_UNAVAILABLE');

  let calls = 0;
  const malformed = createAnchoredMutationBackendAdapter({
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transport: Object.freeze({ exchange() { calls += 1; } }),
  });
  assertUnavailable(malformed, 'NATIVE_MUTATION_HELPER_UNAVAILABLE');
  assert.strictEqual(calls, 0);
}

// Even a perfect helper handshake cannot make the current adapter ENFORCED:
// only the future service-v2 consumer can prove all private namespace I/O is
// routed through the capability.
{
  const harness = transportHarness();
  const adapter = createAnchoredMutationBackendAdapter({
    backendId: 'future-native-helper',
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transport: harness.transport,
    requestIdFactory: idFactory('valid'),
  });
  assertUnavailable(adapter, 'NAMESPACE_IO_CONSUMER_NOT_INTEGRATED');
  assert.deepStrictEqual(harness.operations, ['handshake']);
  assert.throws(
    () => adapter.prepare({ hostilePath: '/must/not/reach/helper' }),
    (error) => error
      && error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'
      && !Object.hasOwn(error, 'cause')
  );
  assert.deepStrictEqual(harness.operations, ['handshake']);
}

// A downgrade is cached as unavailable; prepare never emits session.open.
{
  const harness = transportHarness({
    responseMutator(request) {
      return createAnchoredMutationHelperResponse(request, validHandshakePayload({
        guarantees: ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES.filter(
          (guarantee) => guarantee !== 'private_namespace_anchored'
        ),
      }));
    },
  });
  const adapter = createAnchoredMutationBackendAdapter({
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transport: harness.transport,
    requestIdFactory: idFactory('downgrade'),
  });
  assertUnavailable(adapter, 'NATIVE_MUTATION_HELPER_HANDSHAKE_INVALID');
  assert.deepStrictEqual(harness.operations, ['handshake']);
  assert.throws(() => adapter.prepare({}), /unavailable/);
  assert.deepStrictEqual(harness.operations, ['handshake']);
}

// Spoofed digest-bound handshake fields cannot be used as an attestation.
{
  const harness = transportHarness({
    responseMutator(request, response) {
      return { ...response, payload: { ...response.payload, helperId: 'spoofed-helper' } };
    },
  });
  const adapter = createAnchoredMutationBackendAdapter({
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transport: harness.transport,
    requestIdFactory: idFactory('spoof'),
  });
  assertUnavailable(adapter, 'NATIVE_MUTATION_HELPER_HANDSHAKE_INVALID');
  assert.deepStrictEqual(harness.operations, ['handshake']);
}

// Async transports cannot cross the synchronous native effect frontier.
{
  const harness = transportHarness({ asyncExchange: true });
  const adapter = createAnchoredMutationBackendAdapter({
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transport: harness.transport,
    requestIdFactory: idFactory('async'),
  });
  assertUnavailable(adapter, 'NATIVE_MUTATION_HELPER_HANDSHAKE_INVALID');
  assert.deepStrictEqual(harness.operations, ['handshake']);
  assert.deepStrictEqual(harness.aborts, []);
}

// Hostile option/transport shapes are rejected without invoking accessors.
{
  let getterCalls = 0;
  const hostileOptions = {
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  };
  Object.defineProperty(hostileOptions, 'transport', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return transportHarness().transport;
    },
  });
  assertUnavailable(
    createAnchoredMutationBackendAdapter(hostileOptions),
    'NATIVE_MUTATION_ADAPTER_OPTIONS_INVALID'
  );
  assert.strictEqual(getterCalls, 0);

  const polluted = Object.assign(Object.create({ polluted: true }), {
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transport: transportHarness().transport,
  });
  assertUnavailable(
    createAnchoredMutationBackendAdapter(polluted),
    'NATIVE_MUTATION_ADAPTER_OPTIONS_INVALID'
  );
}

console.log('anchored mutation backend adapter tests passed');
