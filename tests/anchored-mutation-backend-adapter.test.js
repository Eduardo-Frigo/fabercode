'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  assertAnchoredFilesystemMutationBackend,
  assertAnchoredFilesystemMutationNamespaceBackend,
  assertAnchoredFilesystemMutationProbe,
} = require('../main/capabilities/anchored_filesystem_mutation_backend_contract');
const {
  ANCHORED_MUTATION_HELPER_HANDSHAKE_VERSION,
  ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
  ANCHORED_MUTATION_HELPER_PROTOCOL_VERSION,
  ANCHORED_MUTATION_HELPER_OPERATIONS,
  createAnchoredMutationHelperResponse,
} = require('../main/capabilities/anchored_mutation_helper_protocol');
const {
  ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
  createAnchoredMutationBackendAdapter,
} = require('../main/services/anchored_mutation_backend_adapter');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  createAnchoredMutationIdentityReceipt,
} = require('../main/capabilities/anchored_mutation_identity_receipt_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;
const hashedDigest = (seed) => (
  `sha256:${crypto.createHash('sha256').update(String(seed)).digest('hex')}`
);

function identity(seed) {
  const core = {
    volumeIdentityDigest: hashedDigest(`${seed}:volume`),
    objectIdentityDigest: hashedDigest(`${seed}:object`),
    generationIdentityDigest: hashedDigest(`${seed}:generation`),
  };
  return { ...core, identityDigest: canonicalSha256Digest(core) };
}

function receiptForRequest(request) {
  const targetIdentity = identity(`target:${request.payload.targets[0].relativePath}`);
  return createAnchoredMutationIdentityReceipt({
    helperBuildId: 'adapter-test-helper-build-v1',
    platform: {
      os: 'linux',
      architecture: 'x64',
      filesystemType: 'ext4',
      capabilityDigest: hashedDigest('adapter-capability'),
    },
    bindingDigest: request.payload.bindingDigest,
    checkpointDigest: request.payload.checkpointDigest,
    rootIdentity: identity('root'),
    namespaceIdentity: identity('namespace'),
    targets: [{
      ...request.payload.targets[0],
      kind: 'file',
      identity: targetIdentity,
      closureDigest: null,
      linkIdentityDigest: null,
    }],
    entries: [{
      relativePath: request.payload.checkpointEntries[0].relativePath,
      kind: 'file',
      identity: targetIdentity,
      closureDigest: null,
      linkIdentityDigest: null,
    }],
  });
}

function idFactory(prefix = 'adapter-request') {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

function sessionInput() {
  return {
    rootPath: '/project',
    transactionPath: '/project/.faber/transactions/transaction-1',
    payloadPath: '/project/.faber/transactions/transaction-1/payload',
    headPath: '/project/.faber/transaction-heads/job-1.json',
    anchorPath: '/project/.faber/transaction-journal/transaction-1',
    bindingDigest: digest('d'),
    checkpointDigest: digest('e'),
    targets: [{ relativePath: 'docs/file.txt', payloadName: 'target-0001' }],
    checkpointEntries: [{
      relativePath: 'docs/file.txt',
      kind: 'file',
      bytes: 3,
      mode: 0o644,
      mtimeMs: 100,
      contentDigest: digest('f'),
      linkTarget: null,
    }],
  };
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
      let payload;
      if (request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.HANDSHAKE) {
        payload = validHandshakePayload();
      } else if (request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_OPEN) {
        const progressCore = { checkpointDigest: request.payload.checkpointDigest, moved: [] };
        const identityReceipt = receiptForRequest(request);
        payload = {
          opened: true,
          sessionId: 'adapter-session-1',
          namespaceCapabilityId: 'adapter-namespace-1',
          rootIdentityDigest: identityReceipt.rootIdentity.identityDigest,
          namespaceIdentityDigest: identityReceipt.namespaceIdentity.identityDigest,
          targetSetIdentityDigest: identityReceipt.targetSetIdentityDigest,
          identityReceipt,
          namespaceReadyBeforeWrites: true,
          movementProgress: {
            ...progressCore,
            progressDigest: canonicalSha256Digest(progressCore),
          },
        };
      } else if (request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_OPEN) {
        payload = {
          opened: true,
          sessionId: 'adapter-root-session-1',
          namespaceCapabilityId: 'adapter-root-namespace-1',
          rootIdentityDigest: digest('a'),
          namespaceIdentityDigest: digest('b'),
        };
      } else if (request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.SESSION_CLOSE
        || request.operation === ANCHORED_MUTATION_HELPER_OPERATIONS.ROOT_NAMESPACE_CLOSE) {
        payload = { closed: true };
      } else {
        throw new Error(`Unexpected adapter test operation ${request.operation}`);
      }
      const response = createAnchoredMutationHelperResponse(request, payload);
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
  assert.strictEqual(adapter.namespaceIoVersion, ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION);
  assert.strictEqual(assertAnchoredFilesystemMutationBackend(adapter), adapter);
  assert.strictEqual(assertAnchoredFilesystemMutationNamespaceBackend(adapter), adapter);
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

// Promise-valued adapter options are absorbed before any handshake and reduce
// to an inert unavailable backend under strict unhandled-rejection mode.
{
  const topLevel = createAnchoredMutationBackendAdapter(
    Promise.reject(new Error('async adapter options'))
  );
  assertUnavailable(topLevel, 'NATIVE_MUTATION_ADAPTER_OPTIONS_INVALID');

  const harness = transportHarness();
  const nested = createAnchoredMutationBackendAdapter({
    integrationVersion: Promise.reject(new Error('async integration version')),
    transport: harness.transport,
  });
  assertUnavailable(nested, 'NATIVE_MUTATION_ADAPTER_OPTIONS_INVALID');
  assert.deepStrictEqual(harness.operations, []);
}

// Adapter option preflight observes every rejected Promise before rejecting an
// invalid graph, including unknown nested transport data and Promise siblings.
{
  const adapterPath = require.resolve('../main/services/anchored_mutation_backend_adapter');
  const protocolPath = require.resolve(
    '../main/capabilities/anchored_mutation_helper_protocol'
  );
  const script = `
    const {
      createAnchoredMutationBackendAdapter,
    } = require(${JSON.stringify(adapterPath)});
    const {
      ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    } = require(${JSON.stringify(protocolPath)});
    const nested = createAnchoredMutationBackendAdapter({
      integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
      transport: {
        exchange() { throw new Error('transport must not be reached'); },
        abort() { throw new Error('abort must not be reached'); },
        unknown: Promise.reject(new Error('nested unknown rejected Promise')),
      },
    });
    if (nested.probe().state !== 'unavailable') process.exit(21);
    const siblings = createAnchoredMutationBackendAdapter({
      integrationVersion: Promise.reject(new Error('first rejected option')),
      backendId: Promise.reject(new Error('second rejected option')),
    });
    if (siblings.probe().state !== 'unavailable') process.exit(22);
    setImmediate(() => process.stdout.write('strict adapter preflight survived'));
  `;
  const child = childProcess.spawnSync(process.execPath, [
    '--unhandled-rejections=strict',
    '-e',
    script,
  ], { encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /strict adapter preflight survived/);
}

// An exact v3 handshake exposes both live preparation and anchored recovery
// bootstrap; the service still has to opt in with the integration version.
{
  const harness = transportHarness();
  const adapter = createAnchoredMutationBackendAdapter({
    backendId: 'future-native-helper',
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transport: harness.transport,
    requestIdFactory: idFactory('valid'),
  });
  assert.strictEqual(assertAnchoredFilesystemMutationNamespaceBackend(adapter), adapter);
  const probe = assertAnchoredFilesystemMutationProbe(adapter.probe(), { requireEnforced: true });
  assert.strictEqual(probe.reasonCode, 'ENFORCED');
  assert.deepStrictEqual(harness.operations, ['handshake']);
  const session = adapter.prepare(sessionInput());
  assert.strictEqual(session.schemaVersion, ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION);
  assert.strictEqual(
    session.identityReceipt.rootIdentity.identityDigest,
    session.rootIdentityDigest
  );
  assert.strictEqual(
    ANCHORED_MUTATION_BACKEND_ADAPTER_VERSION,
    'anchored-mutation-backend-adapter.v3'
  );
  assert.strictEqual(session.close().closed, true);
  const root = adapter.openRootNamespace({ rootPath: '/project' });
  assert.strictEqual(root.close().closed, true);
  assert.deepStrictEqual(harness.operations, [
    'handshake',
    'session.open',
    'session.close',
    'root_namespace.open',
    'root_namespace.close',
  ]);
}

// Effect inputs are scanned for native Promises before probe() can perform the
// handshake, including Promise-valued nested fields.
{
  const harness = transportHarness();
  const adapter = createAnchoredMutationBackendAdapter({
    integrationVersion: ANCHORED_MUTATION_HELPER_INTEGRATION_VERSION,
    transport: harness.transport,
    requestIdFactory: idFactory('async-effect-input'),
  });
  assert.throws(
    () => adapter.prepare(Promise.reject(new Error('async prepare input'))),
    (error) => error && error.code === 'PROTOCOL_ASYNC_INPUT'
  );
  assert.throws(
    () => adapter.openRootNamespace({
      rootPath: Promise.reject(new Error('async root input field')),
    }),
    (error) => error && error.code === 'PROTOCOL_ASYNC_INPUT'
  );
  assert.deepStrictEqual(harness.operations, []);
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
