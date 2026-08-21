'use strict';

const assert = require('assert');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
} = require('../main/capabilities/anchored_filesystem_mutation_backend_contract');
const {
  ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
  ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  ANCHORED_MUTATION_HELPER_OPERATIONS,
  ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
  createAnchoredMutationHelperResponse,
} = require('../main/capabilities/anchored_mutation_helper_protocol');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
} = require('../main/runtime/anchored_mutation_runtime_config');
const {
  AGENTIC_DELETE_MUTATION_BACKEND_FACTORY_VERSION,
  createAgenticDeleteMutationBackendSelection,
} = require('../main/services/agentic_delete_mutation_backend_factory');

const PROVIDER_VERSION = 'anchored-mutation-provider.v1';
const ATTESTATION_VERSION = 'anchored-mutation-isolation-attestation.v1';
const RECEIPT_VERSION = 'anchored-mutation-identity-receipt.v1';

function config(mode = 'enabled', killSwitch = false) {
  return Object.freeze({
    version: ANCHORED_MUTATION_RUNTIME_CONFIG_VERSION,
    mode,
    killSwitch,
  });
}

function attestation(buildId = 'native-helper-build-1', overrides = {}) {
  const core = {
    providerVersion: PROVIDER_VERSION,
    buildId,
    schemaVersion: ATTESTATION_VERSION,
    identityReceiptVersion: RECEIPT_VERSION,
    physicalIdentityReceipts: true,
    sourceIdentityCompareAndSwap: true,
    subtreeMutationExcluded: true,
    durablePhysicalProgress: true,
  };
  return {
    schemaVersion: core.schemaVersion,
    identityReceiptVersion: core.identityReceiptVersion,
    physicalIdentityReceipts: core.physicalIdentityReceipts,
    sourceIdentityCompareAndSwap: core.sourceIdentityCompareAndSwap,
    subtreeMutationExcluded: core.subtreeMutationExcluded,
    durablePhysicalProgress: core.durablePhysicalProgress,
    attestationDigest: canonicalSha256Digest(core),
    ...overrides,
  };
}

function handshakeFeatures() {
  const features = {
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
    atomicReplace: true,
    durableNamespaceSync: true,
    boundedListingOverflow: 'fail_closed',
    outOfBandAbort: true,
    orphanedSessionAutoClose: 'bounded_native_lease',
    maxOrphanLeaseMs: 5_000,
  };
  if (ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION.endsWith('.v3')) {
    Object.assign(features, {
      physicalIdentityReceipts: true,
      durablePhysicalProgress: true,
      sourceIdentityCompareAndSwap: true,
      subtreeMutationExcluded: true,
    });
  }
  return features;
}

function handshakePayload(overrides = {}) {
  return {
    accepted: true,
    handshakeVersion: ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
    protocolVersion: ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
    backendContractVersion: ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
    sessionContractVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    helperId: 'factory-test-helper',
    guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
    features: handshakeFeatures(),
    ...overrides,
  };
}

function providerHarness({
  buildId = 'native-helper-build-1',
  attestationOverrides = {},
  handshakeOverrides = {},
  asyncExchange = false,
  disposeImpl = null,
  providerOverrides = {},
} = {}) {
  const state = {
    aborts: 0,
    disposals: 0,
    exchanges: 0,
  };
  const exchange = asyncExchange
    ? async function exchangeAsync(request) {
      state.exchanges += 1;
      return createAnchoredMutationHelperResponse(request, handshakePayload(handshakeOverrides));
    }
    : function exchangeSync(request) {
      state.exchanges += 1;
      assert.strictEqual(request.operation, ANCHORED_MUTATION_HELPER_OPERATIONS.HANDSHAKE);
      return createAnchoredMutationHelperResponse(request, handshakePayload(handshakeOverrides));
    };
  const provider = {
    providerVersion: PROVIDER_VERSION,
    buildId,
    transport: Object.freeze({
      exchange,
      abort(message) {
        state.aborts += 1;
        return { aborted: true, abortDigest: message.abortDigest };
      },
    }),
    dispose() {
      state.disposals += 1;
      return disposeImpl ? disposeImpl() : undefined;
    },
    isolationAttestation: attestation(buildId, attestationOverrides),
    ...providerOverrides,
  };
  return { provider, state };
}

function assertExactSelection(selection) {
  assert.deepStrictEqual(Reflect.ownKeys(selection), ['version', 'backend', 'diagnostics', 'dispose']);
  assert.strictEqual(selection.version, AGENTIC_DELETE_MUTATION_BACKEND_FACTORY_VERSION);
  assert.strictEqual(typeof selection.dispose, 'function');
  assert.strictEqual(Object.isFrozen(selection), true);
  assert.strictEqual(Object.isFrozen(selection.backend), true);
  assert.strictEqual(Object.isFrozen(selection.diagnostics), true);
  assert.deepStrictEqual(
    Reflect.ownKeys(selection.diagnostics),
    ['status', 'reasonCode', 'mode', 'killSwitch']
  );
}

function assertUnsupported(selection, reasonCode) {
  assertExactSelection(selection);
  assert.strictEqual(selection.diagnostics.status, 'unsupported');
  assert.strictEqual(selection.diagnostics.reasonCode, reasonCode);
  const probe = selection.backend.probe();
  assert.strictEqual(probe.state, ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.UNAVAILABLE);
  assert.strictEqual(probe.reasonCode, 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE');
  assert.deepStrictEqual(probe.guarantees, []);
}

async function main() {
  let providerFactoryCalls = 0;
  const disabled = createAgenticDeleteMutationBackendSelection({
    config: config('disabled', false),
    providerFactory() {
      providerFactoryCalls += 1;
      throw new Error('disabled config must not call provider');
    },
  });
  assertUnsupported(disabled, 'RUNTIME_DISABLED');
  assert.strictEqual(providerFactoryCalls, 0);
  disabled.dispose();
  disabled.dispose();

  const killed = createAgenticDeleteMutationBackendSelection({
    config: config('enabled', true),
    providerFactory() {
      providerFactoryCalls += 1;
      throw new Error('kill switch must not call provider');
    },
  });
  assertUnsupported(killed, 'RUNTIME_KILL_SWITCH_ACTIVE');
  assert.strictEqual(providerFactoryCalls, 0);

  assertUnsupported(createAgenticDeleteMutationBackendSelection(), 'RUNTIME_DISABLED');
  assertUnsupported(
    createAgenticDeleteMutationBackendSelection({ config: config(), providerFactory: undefined }),
    'PROVIDER_UNAVAILABLE'
  );

  let invalidConfigProviderCalls = 0;
  for (const invalidConfig of [
    { ...config(), version: 'anchored-mutation-runtime-config.v0' },
    { ...config(), mode: 'canary' },
    { ...config(), killSwitch: 'false' },
    { ...config(), addonPath: '/tmp/provider.node' },
    Promise.resolve(config()),
  ]) {
    assertUnsupported(createAgenticDeleteMutationBackendSelection({
      config: invalidConfig,
      providerFactory() {
        invalidConfigProviderCalls += 1;
        return providerHarness().provider;
      },
    }), 'FACTORY_OPTIONS_INVALID');
  }
  assert.strictEqual(invalidConfigProviderCalls, 0);

  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: Promise.resolve(() => providerHarness().provider),
  }), 'FACTORY_OPTIONS_INVALID');
  assertUnsupported(
    createAgenticDeleteMutationBackendSelection(Promise.reject(new Error('async options denied'))),
    'FACTORY_OPTIONS_INVALID'
  );

  const validHarness = providerHarness({
    disposeImpl: () => Promise.reject(new Error('async disposal is denied and absorbed')),
  });
  const valid = createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory() {
      providerFactoryCalls += 1;
      return validHarness.provider;
    },
  });
  assertExactSelection(valid);
  assert.deepStrictEqual(valid.diagnostics, {
    status: 'enforced',
    reasonCode: 'ENFORCED',
    mode: 'enabled',
    killSwitch: false,
  });
  assert.strictEqual(providerFactoryCalls, 1);
  assert.strictEqual(validHarness.state.exchanges, 1);
  assert.strictEqual(valid.backend.probe().state, ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED);
  assert.strictEqual(valid.backend.probe().state, ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED);
  assert.strictEqual(validHarness.state.exchanges, 1, 'adapter handshake/probe must be cached');
  valid.dispose();
  valid.dispose();
  assert.strictEqual(validHarness.state.disposals, 1);
  assert.strictEqual(
    valid.backend.probe().state,
    ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.UNAVAILABLE
  );
  for (const invokeAfterDispose of [
    () => valid.backend.prepare({}),
    () => valid.backend.openRootNamespace({}),
  ]) {
    assert.throws(
      invokeAfterDispose,
      (error) => error && error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'
    );
  }
  assert.throws(
    () => valid.backend.prepare({
      nested: Promise.reject(new Error('revoked prepare input must be absorbed')),
    }),
    (error) => error && error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'
  );
  assert.throws(
    () => valid.backend.openRootNamespace(
      Promise.reject(new Error('revoked root input must be absorbed'))
    ),
    (error) => error && error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(validHarness.state.exchanges, 1);

  const throwingDisposeHarness = providerHarness({
    disposeImpl() { throw new Error('best effort'); },
  });
  const throwingDispose = createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => throwingDisposeHarness.provider,
  });
  assert.doesNotThrow(() => throwingDispose.dispose());
  assert.doesNotThrow(() => throwingDispose.dispose());
  assert.strictEqual(throwingDisposeHarness.state.disposals, 1);

  const rejectedProvider = Promise.reject(new Error('async provider rejected'));
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => rejectedProvider,
  }), 'PROVIDER_REJECTED');

  const resolvedProviderHarness = providerHarness();
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => Promise.resolve(resolvedProviderHarness.provider),
  }), 'PROVIDER_REJECTED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(resolvedProviderHarness.state.exchanges, 0);
  assert.strictEqual(resolvedProviderHarness.state.disposals, 1);

  const statefulPromiseHarness = providerHarness();
  const statefulProviderPromise = Promise.resolve(statefulPromiseHarness.provider);
  let constructorGetterCalls = 0;
  Object.defineProperty(statefulProviderPromise, 'constructor', {
    configurable: true,
    get() {
      constructorGetterCalls += 1;
      if (constructorGetterCalls === 1) return Promise;
      throw new Error('native Promise constructor must be observed once');
    },
  });
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => statefulProviderPromise,
  }), 'PROVIDER_REJECTED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(constructorGetterCalls, 1);
  assert.strictEqual(statefulPromiseHarness.state.exchanges, 0);
  assert.strictEqual(statefulPromiseHarness.state.disposals, 1);

  const thrownPromise = Promise.reject(new Error('thrown async provider rejected'));
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory() { throw thrownPromise; },
  }), 'PROVIDER_REJECTED');

  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory() { throw new Error('/private/secret/provider.node'); },
  }), 'PROVIDER_REJECTED');

  const invalidCases = [
    providerHarness({ providerOverrides: { providerVersion: 'anchored-mutation-provider.v0' } }),
    providerHarness({ providerOverrides: { buildId: '/tmp/native-helper.node' } }),
    providerHarness({ providerOverrides: { extra: true } }),
    providerHarness({ providerOverrides: { transport: Promise.resolve({}) } }),
    providerHarness({ providerOverrides: { transport: Object.freeze({ exchange() {} }) } }),
    providerHarness({ providerOverrides: { transport: Object.freeze({
      exchange() {},
      abort() {},
      extra: true,
    }) } }),
    providerHarness({ providerOverrides: { isolationAttestation: Promise.resolve({}) } }),
    providerHarness({ attestationOverrides: { physicalIdentityReceipts: false } }),
    providerHarness({ attestationOverrides: { sourceIdentityCompareAndSwap: false } }),
    providerHarness({ attestationOverrides: { subtreeMutationExcluded: false } }),
    providerHarness({ attestationOverrides: { durablePhysicalProgress: false } }),
    providerHarness({ attestationOverrides: { identityReceiptVersion: 'anchored-mutation-identity-receipt.v0' } }),
    providerHarness({ attestationOverrides: { attestationDigest: `sha256:${'0'.repeat(64)}` } }),
    providerHarness({ attestationOverrides: { unexpected: true } }),
  ];
  for (const harness of invalidCases) {
    const selection = createAgenticDeleteMutationBackendSelection({
      config: config(),
      providerFactory: () => harness.provider,
    });
    assertUnsupported(selection, 'PROVIDER_REJECTED');
    assert.strictEqual(harness.state.exchanges, 0);
    assert.strictEqual(harness.state.disposals, 1);
    selection.dispose();
    assert.strictEqual(harness.state.disposals, 1);
  }

  const asyncTransportHarness = providerHarness({ asyncExchange: true });
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => asyncTransportHarness.provider,
  }), 'BACKEND_NOT_ENFORCED');
  assert.strictEqual(asyncTransportHarness.state.exchanges, 1);
  assert.strictEqual(asyncTransportHarness.state.disposals, 1);

  const throwingTransportHarness = providerHarness();
  throwingTransportHarness.provider.transport = Object.freeze({
    exchange() {
      throwingTransportHarness.state.exchanges += 1;
      throw Promise.reject(new Error('transport rejected'));
    },
    abort() { return { aborted: false, abortDigest: null }; },
  });
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => throwingTransportHarness.provider,
  }), 'BACKEND_NOT_ENFORCED');
  assert.strictEqual(throwingTransportHarness.state.exchanges, 1);
  assert.strictEqual(throwingTransportHarness.state.disposals, 1);

  const downgradedHandshakeHarness = providerHarness({
    handshakeOverrides: { guarantees: [] },
  });
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => downgradedHandshakeHarness.provider,
  }), 'BACKEND_NOT_ENFORCED');
  assert.strictEqual(downgradedHandshakeHarness.state.exchanges, 1);
  assert.strictEqual(downgradedHandshakeHarness.state.disposals, 1);

  let providerThenGetterCalls = 0;
  const hostileProvider = providerHarness().provider;
  Object.defineProperty(hostileProvider, 'then', {
    enumerable: true,
    get() {
      providerThenGetterCalls += 1;
      throw new Error('then getter must not run');
    },
  });
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => hostileProvider,
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(providerThenGetterCalls, 0);

  const transparentProxyProviderHarness = providerHarness();
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => new Proxy(transparentProxyProviderHarness.provider, {}),
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(transparentProxyProviderHarness.state.exchanges, 0);
  assert.strictEqual(transparentProxyProviderHarness.state.disposals, 0);

  let proxiedFactoryCalls = 0;
  const proxiedProviderFactory = new Proxy(() => {
    proxiedFactoryCalls += 1;
    return providerHarness().provider;
  }, {});
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: proxiedProviderFactory,
  }), 'FACTORY_OPTIONS_INVALID');
  assert.strictEqual(proxiedFactoryCalls, 0);

  let providerFieldGetterCalls = 0;
  const accessorProviderHarness = providerHarness();
  Object.defineProperty(accessorProviderHarness.provider, 'buildId', {
    enumerable: true,
    configurable: true,
    get() {
      providerFieldGetterCalls += 1;
      return 'native-helper-build-1';
    },
  });
  assertUnsupported(createAgenticDeleteMutationBackendSelection({
    config: config(),
    providerFactory: () => accessorProviderHarness.provider,
  }), 'PROVIDER_REJECTED');
  assert.strictEqual(providerFieldGetterCalls, 0);
  assert.strictEqual(accessorProviderHarness.state.disposals, 1);

  let optionThenGetterCalls = 0;
  const hostileOptions = { config: config() };
  Object.defineProperty(hostileOptions, 'then', {
    enumerable: true,
    get() {
      optionThenGetterCalls += 1;
      throw new Error('then getter must not run');
    },
  });
  assertUnsupported(createAgenticDeleteMutationBackendSelection(hostileOptions), 'FACTORY_OPTIONS_INVALID');
  assert.strictEqual(optionThenGetterCalls, 0);
  assertUnsupported(
    createAgenticDeleteMutationBackendSelection(new Proxy({ config: config() }, {})),
    'FACTORY_OPTIONS_INVALID'
  );

  const leakedText = JSON.stringify([
    disabled.diagnostics,
    killed.diagnostics,
    createAgenticDeleteMutationBackendSelection({ config: config() }).diagnostics,
  ]);
  assert.strictEqual(leakedText.includes('/tmp/'), false);
  assert.strictEqual(leakedText.includes('provider.node'), false);

  await new Promise((resolve) => setImmediate(resolve));
  console.log('agentic delete mutation backend factory tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
