'use strict';

const assert = require('assert');

const {
  PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
  createPortableIsolationHelperClient,
} = require('../main/services/portable_isolation_helper_client');
const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  createPortableIsolationHelperFailureReceipt,
  createPortableIsolationHelperHandshakeResponse,
  createPortableIsolationHelperResponse,
  createPortableIsolationHelperShutdownReceipt,
} = require('../main/capabilities/portable_isolation_helper_protocol');

const digest = (character) => `sha256:${character.repeat(64)}`;
const nonce = (character) => character.repeat(64);

function handshake() {
  return {
    clientId: 'faber-main-runtime',
    clientNonce: nonce('a'),
    expectedBundleIdentityDigest: digest('b'),
    providerVersion: 'portable-execution-isolation-provider.v2',
    attestationVersion: 'portable-execution-isolation-attestation.v2',
  };
}

function handshakeResponse(request, overrides = {}) {
  return createPortableIsolationHelperHandshakeResponse(request, {
    helperId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-build-1',
    helperNonce: nonce('c'),
    sessionId: 'portable-session-1',
    bundleIdentityDigest: digest('b'),
    executionWorkspaceBackendId: 'portable-private-workspace',
    projectRootAuthorityBackendId: 'portable-project-root-authority',
    processSupervisorBackendId: 'portable-process-supervisor',
    platform: {
      os: 'darwin',
      architecture: 'arm64',
      signatureVerification: 'platform_verified',
    },
    ...overrides,
  });
}

function transportHarness(overrides = {}) {
  const state = {
    requests: [],
    aborts: [],
    disposeCalls: 0,
  };
  const transport = Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
    exchange(request) {
      state.requests.push(request);
      if (overrides.exchange) return overrides.exchange(request, state);
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
        return Promise.resolve(handshakeResponse(request));
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
        return Promise.resolve(createPortableIsolationHelperResponse(
          request,
          createPortableIsolationHelperShutdownReceipt({
            activeWorkspaces: 0,
            activeRootLeases: 0,
            activeProcesses: 0,
            orphaned: 0,
          })
        ));
      }
      return Promise.resolve(createPortableIsolationHelperResponse(request, {
        ok: true,
        operation: request.operation,
      }));
    },
    abort(request) {
      state.aborts.push(request);
      if (overrides.abort) return overrides.abort(request, state);
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
        aborted: true,
      }));
    },
    dispose() {
      state.disposeCalls += 1;
      if (overrides.dispose) return overrides.dispose(state);
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
        closed: true,
      }));
    },
  });
  return { state, transport };
}

async function expectRejectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

function expectThrowCode(action, code) {
  assert.throws(action, (error) => error && error.code === code);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function main() {
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
    'portable-isolation-helper-client.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
    'portable-isolation-helper-transport.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
    'portable-isolation-helper-transport-abort-request.v1'
  );

  const harness = transportHarness();
  const client = createPortableIsolationHelperClient({
    transport: harness.transport,
    handshake: handshake(),
  });
  assert.deepStrictEqual(Reflect.ownKeys(client), [
    'version', 'connect', 'exchange', 'quarantine', 'diagnostics', 'dispose',
  ]);
  assert.strictEqual(Object.isFrozen(client), true);
  assert.deepStrictEqual(client.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
    state: 'idle',
    nextSequence: 1,
    exchanges: 0,
    pending: false,
    transportClosed: false,
  });

  const firstConnect = client.connect();
  const secondConnect = client.connect();
  assert.strictEqual(firstConnect, secondConnect);
  const connected = await firstConnect;
  assert.strictEqual(connected.accepted, true);
  assert.strictEqual(connected.bundleIdentityDigest, digest('b'));
  assert.strictEqual(Object.isFrozen(connected), true);
  assert.strictEqual(harness.state.requests.length, 1);
  assert.strictEqual(harness.state.requests[0].operation, 'handshake');
  assert.strictEqual(Object.isFrozen(harness.state.requests[0]), true);

  const rootList = await client.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: { leaseId: 'root-lease-1', relativePath: '' },
  });
  assert.deepStrictEqual(rootList, { ok: true, operation: 'root.list' });
  const processRead = await client.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
    payload: { executionId: 'execution-1', cursor: 0, maxBytes: 4096 },
  });
  assert.deepStrictEqual(processRead, { ok: true, operation: 'process.read' });
  assert.strictEqual(harness.state.requests[1].sequence, 1);
  assert.strictEqual(
    harness.state.requests[1].previousResponseDigest,
    handshakeResponse(harness.state.requests[0]).responseDigest
  );
  assert.strictEqual(harness.state.requests[2].sequence, 2);

  await expectRejectCode(client.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE,
    payload: {},
  }), 'CLIENT_OPERATION_INVALID');
  await expectRejectCode(client.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE,
    payload: {},
  }), 'CLIENT_OPERATION_INVALID');
  assert.strictEqual(harness.state.requests.length, 3);

  const firstDispose = client.dispose();
  const secondDispose = client.dispose();
  assert.strictEqual(firstDispose, secondDispose);
  assert.deepStrictEqual(await firstDispose, {
    version: PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
    disposed: true,
    helperShutdownConfirmed: true,
    transportClosed: true,
  });
  assert.strictEqual(harness.state.requests.at(-1).operation, 'provider.dispose');
  assert.strictEqual(harness.state.disposeCalls, 1);
  assert.deepStrictEqual(client.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
    state: 'closed',
    nextSequence: 4,
    exchanges: 3,
    pending: false,
    transportClosed: true,
  });
  await expectRejectCode(client.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: {},
  }), 'CLIENT_CLOSED');

  const constructionHarness = transportHarness();
  expectThrowCode(() => createPortableIsolationHelperClient({
    transport: { ...constructionHarness.transport },
    handshake: handshake(),
  }), 'CLIENT_TRANSPORT_INVALID');
  expectThrowCode(() => createPortableIsolationHelperClient({
    transport: Object.freeze({
      ...constructionHarness.transport,
      binaryPath: '/private/untrusted/helper',
    }),
    handshake: handshake(),
  }), 'CLIENT_TRANSPORT_INVALID');
  let transportGetterCalls = 0;
  const accessorTransport = {
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
    abort() {},
    dispose() {},
  };
  Object.defineProperty(accessorTransport, 'exchange', {
    enumerable: true,
    get() {
      transportGetterCalls += 1;
      throw new Error('transport getter must not run');
    },
  });
  Object.freeze(accessorTransport);
  expectThrowCode(() => createPortableIsolationHelperClient({
    transport: accessorTransport,
    handshake: handshake(),
  }), 'CLIENT_OPTIONS_INVALID');
  assert.strictEqual(transportGetterCalls, 0);

  let nonceCoercions = 0;
  expectThrowCode(() => createPortableIsolationHelperClient({
    transport: constructionHarness.transport,
    handshake: {
      ...handshake(),
      clientNonce: {
        toString() {
          nonceCoercions += 1;
          return nonce('a');
        },
      },
    },
  }), 'CLIENT_HANDSHAKE_INVALID');
  assert.strictEqual(nonceCoercions, 0);

  const rejectedOptions = Promise.reject(new Error('async options must be absorbed'));
  expectThrowCode(
    () => createPortableIsolationHelperClient(rejectedOptions),
    'CLIENT_OPTIONS_INVALID'
  );

  const explicitQuarantineHarness = transportHarness();
  const explicitQuarantineClient = createPortableIsolationHelperClient({
    transport: explicitQuarantineHarness.transport,
    handshake: handshake(),
  });
  await explicitQuarantineClient.connect();
  assert.deepStrictEqual(explicitQuarantineClient.quarantine({
    reasonCode: 'DOMAIN_RESPONSE_REJECTED',
  }), { ok: true, quarantined: true });
  assert.strictEqual(explicitQuarantineClient.diagnostics().state, 'quarantined');
  assert.strictEqual(explicitQuarantineHarness.state.aborts.length, 1);
  assert.deepStrictEqual(explicitQuarantineClient.quarantine({
    reasonCode: 'DOMAIN_RESPONSE_REJECTED',
  }), { ok: true, quarantined: true });
  assert.strictEqual(explicitQuarantineHarness.state.aborts.length, 1);
  expectThrowCode(() => explicitQuarantineClient.quarantine({
    reasonCode: 'DOMAIN_RESPONSE_REJECTED',
    message: '/private/project/root',
  }), 'CLIENT_QUARANTINE_INVALID');
  await expectRejectCode(explicitQuarantineClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: {},
  }), 'CLIENT_QUARANTINED');
  assert.deepStrictEqual(await explicitQuarantineClient.dispose(), {
    version: PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
    disposed: true,
    helperShutdownConfirmed: false,
    transportClosed: true,
  });
  assert.deepStrictEqual(explicitQuarantineClient.quarantine({
    reasonCode: 'DOMAIN_RESPONSE_REJECTED',
  }), { ok: false, quarantined: false });

  const idleHarness = transportHarness();
  const idleClient = createPortableIsolationHelperClient({
    transport: idleHarness.transport,
    handshake: handshake(),
  });
  assert.deepStrictEqual(await idleClient.dispose(), {
    version: PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
    disposed: true,
    helperShutdownConfirmed: false,
    transportClosed: true,
  });
  assert.strictEqual(idleHarness.state.requests.length, 0);
  assert.strictEqual(idleHarness.state.aborts.length, 0);
  assert.strictEqual(idleHarness.state.disposeCalls, 1);
  assert.strictEqual(idleClient.diagnostics().state, 'closed');

  const corruptHandshakeHarness = transportHarness({
    exchange(request) {
      const response = handshakeResponse(request);
      return Object.freeze({ ...response, responseDigest: digest('f') });
    },
  });
  const corruptHandshakeClient = createPortableIsolationHelperClient({
    transport: corruptHandshakeHarness.transport,
    handshake: handshake(),
  });
  await expectRejectCode(
    corruptHandshakeClient.connect(),
    'CLIENT_HANDSHAKE_REJECTED'
  );
  assert.strictEqual(corruptHandshakeClient.diagnostics().state, 'quarantined');
  assert.strictEqual(corruptHandshakeHarness.state.aborts.length, 1);
  assert.deepStrictEqual(corruptHandshakeHarness.state.aborts[0], {
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_REQUEST_VERSION,
    reasonCode: 'HANDSHAKE_RESPONSE_REJECTED',
  });
  assert.strictEqual(Object.isFrozen(corruptHandshakeHarness.state.aborts[0]), true);
  const corruptHandshakeDispose = await corruptHandshakeClient.dispose();
  assert.strictEqual(corruptHandshakeDispose.helperShutdownConfirmed, false);
  assert.strictEqual(corruptHandshakeDispose.transportClosed, true);

  const rejectedTransportHarness = transportHarness({
    exchange() {
      return Promise.reject(new Error('/private/secret/helper.sock'));
    },
  });
  const rejectedTransportClient = createPortableIsolationHelperClient({
    transport: rejectedTransportHarness.transport,
    handshake: handshake(),
  });
  let rejectedTransportError;
  try {
    await rejectedTransportClient.connect();
  } catch (error) {
    rejectedTransportError = error;
  }
  assert.strictEqual(rejectedTransportError.code, 'CLIENT_TRANSPORT_FAILED');
  assert.strictEqual(rejectedTransportError.message, 'CLIENT_TRANSPORT_FAILED');
  assert.strictEqual(rejectedTransportError.message.includes('/private'), false);
  await rejectedTransportClient.dispose();

  let thenGetterCalls = 0;
  const thenableHarness = transportHarness({
    exchange() {
      const result = {};
      Object.defineProperty(result, 'then', {
        enumerable: true,
        get() {
          thenGetterCalls += 1;
          throw new Error('then getter must not run');
        },
      });
      return result;
    },
  });
  const thenableClient = createPortableIsolationHelperClient({
    transport: thenableHarness.transport,
    handshake: handshake(),
  });
  await expectRejectCode(thenableClient.connect(), 'CLIENT_HANDSHAKE_REJECTED');
  assert.strictEqual(thenGetterCalls, 0);
  await thenableClient.dispose();

  const correlationHarness = transportHarness({
    exchange(request) {
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
        return handshakeResponse(request);
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
        return createPortableIsolationHelperResponse(
          request,
          createPortableIsolationHelperShutdownReceipt({
            activeWorkspaces: 0,
            activeRootLeases: 0,
            activeProcesses: 0,
            orphaned: 0,
          })
        );
      }
      const response = createPortableIsolationHelperResponse(request, { ok: true });
      return Object.freeze({ ...response, requestId: 'replayed-request' });
    },
  });
  const correlationClient = createPortableIsolationHelperClient({
    transport: correlationHarness.transport,
    handshake: handshake(),
  });
  await correlationClient.connect();
  await expectRejectCode(correlationClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: { leaseId: 'root-lease-correlation', relativePath: '' },
  }), 'CLIENT_RESPONSE_REJECTED');
  assert.strictEqual(correlationClient.diagnostics().state, 'quarantined');
  assert.strictEqual(correlationHarness.state.aborts.length, 1);
  const correlationCalls = correlationHarness.state.requests.length;
  await expectRejectCode(correlationClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: {},
  }), 'CLIENT_RESPONSE_REJECTED');
  assert.strictEqual(correlationHarness.state.requests.length, correlationCalls);
  await correlationClient.dispose();

  const failureHarness = transportHarness({
    exchange(request) {
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
        return handshakeResponse(request);
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
        return createPortableIsolationHelperResponse(
          request,
          createPortableIsolationHelperShutdownReceipt({
            activeWorkspaces: 0,
            activeRootLeases: 0,
            activeProcesses: 0,
            orphaned: 0,
          })
        );
      }
      return createPortableIsolationHelperResponse(
        request,
        createPortableIsolationHelperFailureReceipt({
          reasonCode: 'ROOT_LEASE_NOT_FOUND',
          retryable: false,
        })
      );
    },
  });
  const failureClient = createPortableIsolationHelperClient({
    transport: failureHarness.transport,
    handshake: handshake(),
  });
  assert.deepStrictEqual(await failureClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: { leaseId: 'missing-root-lease', relativePath: '' },
  }), {
    version: 'portable-isolation-helper-failure.v1',
    ok: false,
    reasonCode: 'ROOT_LEASE_NOT_FOUND',
    retryable: false,
  });
  assert.strictEqual(failureClient.diagnostics().state, 'active');
  await failureClient.dispose();

  const busyResponse = deferred();
  let busyRequest = null;
  const busyHarness = transportHarness({
    exchange(request) {
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
        return handshakeResponse(request);
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
        return createPortableIsolationHelperResponse(
          request,
          createPortableIsolationHelperShutdownReceipt({
            activeWorkspaces: 0,
            activeRootLeases: 0,
            activeProcesses: 0,
            orphaned: 0,
          })
        );
      }
      busyRequest = request;
      return busyResponse.promise;
    },
  });
  const busyClient = createPortableIsolationHelperClient({
    transport: busyHarness.transport,
    handshake: handshake(),
  });
  await busyClient.connect();
  const firstBusyExchange = busyClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT,
    payload: { executionId: 'execution-busy', afterRevision: 0 },
  });
  await expectRejectCode(busyClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
    payload: { executionId: 'execution-busy', cursor: 0, maxBytes: 4096 },
  }), 'CLIENT_BUSY');
  await Promise.resolve();
  busyResponse.resolve(createPortableIsolationHelperResponse(busyRequest, {
    ok: true,
    status: 'exited',
  }));
  assert.deepStrictEqual(await firstBusyExchange, { ok: true, status: 'exited' });
  assert.strictEqual(busyClient.diagnostics().state, 'active');
  await busyClient.dispose();

  const delayedHandshake = deferred();
  let delayedHandshakeRequest = null;
  const mutationHarness = transportHarness({
    exchange(request) {
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
        delayedHandshakeRequest = request;
        return delayedHandshake.promise;
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
        return createPortableIsolationHelperResponse(
          request,
          createPortableIsolationHelperShutdownReceipt({
            activeWorkspaces: 0,
            activeRootLeases: 0,
            activeProcesses: 0,
            orphaned: 0,
          })
        );
      }
      return createPortableIsolationHelperResponse(request, {
        ok: true,
        observedCursor: request.payload.cursor,
      });
    },
  });
  const mutationClient = createPortableIsolationHelperClient({
    transport: mutationHarness.transport,
    handshake: handshake(),
  });
  const mutablePayload = { executionId: 'execution-mutable', cursor: 0, maxBytes: 1024 };
  const mutationExchange = mutationClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
    payload: mutablePayload,
  });
  mutablePayload.cursor = 99;
  delayedHandshake.resolve(handshakeResponse(delayedHandshakeRequest));
  assert.deepStrictEqual(await mutationExchange, { ok: true, observedCursor: 0 });
  assert.strictEqual(mutationHarness.state.requests[1].payload.cursor, 0);
  await mutationClient.dispose();

  let reentrantClient;
  let reentrantExchange;
  const reentrantHarness = transportHarness({
    exchange(request) {
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
        return handshakeResponse(request);
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
        return createPortableIsolationHelperResponse(
          request,
          createPortableIsolationHelperShutdownReceipt({
            activeWorkspaces: 0,
            activeRootLeases: 0,
            activeProcesses: 0,
            orphaned: 0,
          })
        );
      }
      reentrantExchange = reentrantClient.exchange({
        operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
        payload: { executionId: 'execution-reentrant', cursor: 0, maxBytes: 1024 },
      });
      reentrantExchange.catch(() => undefined);
      return createPortableIsolationHelperResponse(request, { ok: true });
    },
  });
  reentrantClient = createPortableIsolationHelperClient({
    transport: reentrantHarness.transport,
    handshake: handshake(),
  });
  await reentrantClient.connect();
  await expectRejectCode(reentrantClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: { leaseId: 'root-reentrant', relativePath: '' },
  }), 'CLIENT_REENTRANT');
  await expectRejectCode(reentrantExchange, 'CLIENT_REENTRANT');
  assert.strictEqual(reentrantClient.diagnostics().state, 'quarantined');
  assert.strictEqual(reentrantHarness.state.aborts.length, 1);
  await reentrantClient.dispose();

  const orphanHarness = transportHarness({
    exchange(request) {
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
        return handshakeResponse(request);
      }
      return createPortableIsolationHelperResponse(request, {
        ok: true,
        disposed: true,
        activeWorkspaces: 0,
        activeRootLeases: 0,
        activeProcesses: 1,
        orphaned: 1,
      });
    },
  });
  const orphanClient = createPortableIsolationHelperClient({
    transport: orphanHarness.transport,
    handshake: handshake(),
  });
  await orphanClient.connect();
  assert.deepStrictEqual(await orphanClient.dispose(), {
    version: PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
    disposed: true,
    helperShutdownConfirmed: false,
    transportClosed: true,
  });
  assert.strictEqual(orphanClient.diagnostics().state, 'closed_unconfirmed');
  assert.strictEqual(orphanHarness.state.aborts.length, 1);

  const closeFailureHarness = transportHarness({
    dispose() {
      return Promise.reject(new Error('/private/secret/transport-close'));
    },
  });
  const closeFailureClient = createPortableIsolationHelperClient({
    transport: closeFailureHarness.transport,
    handshake: handshake(),
  });
  await closeFailureClient.connect();
  const closeFailurePromise = closeFailureClient.dispose();
  await expectRejectCode(closeFailurePromise, 'CLIENT_TRANSPORT_CLOSE_FAILED');
  assert.strictEqual(closeFailureClient.dispose(), closeFailurePromise);
  assert.strictEqual(closeFailureHarness.state.disposeCalls, 1);
  assert.strictEqual(closeFailureClient.diagnostics().state, 'quarantined');
  assert.strictEqual(closeFailureClient.diagnostics().transportClosed, false);

  const hangingAbortHarness = transportHarness({
    exchange(request) {
      const response = handshakeResponse(request);
      return Object.freeze({ ...response, responseDigest: digest('0') });
    },
    abort() {
      return new Promise(() => {});
    },
  });
  const hangingAbortClient = createPortableIsolationHelperClient({
    transport: hangingAbortHarness.transport,
    handshake: handshake(),
  });
  await expectRejectCode(hangingAbortClient.connect(), 'CLIENT_HANDSHAKE_REJECTED');
  const hangingAbortDispose = hangingAbortClient.dispose();
  const hangingAbortWinner = await Promise.race([
    hangingAbortDispose,
    new Promise((resolve) => setImmediate(() => resolve('abort-blocked-close'))),
  ]);
  assert.notStrictEqual(hangingAbortWinner, 'abort-blocked-close');
  assert.strictEqual(hangingAbortWinner.transportClosed, true);
  assert.strictEqual(hangingAbortWinner.helperShutdownConfirmed, false);
  assert.strictEqual(hangingAbortHarness.state.disposeCalls, 1);

  const interruptedResponse = deferred();
  let interruptedRequest = null;
  const interruptedHarness = transportHarness({
    exchange(request) {
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE) {
        return handshakeResponse(request);
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE) {
        throw new Error('interrupted operation must not reach graceful disposal');
      }
      interruptedRequest = request;
      return interruptedResponse.promise;
    },
  });
  const interruptedClient = createPortableIsolationHelperClient({
    transport: interruptedHarness.transport,
    handshake: handshake(),
  });
  await interruptedClient.connect();
  const interruptedExchange = interruptedClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT,
    payload: { executionId: 'execution-interrupted', afterRevision: 0 },
  });
  interruptedExchange.catch(() => undefined);
  await Promise.resolve();
  const interruptedDispose = interruptedClient.dispose();
  const interruptedWinner = await Promise.race([
    interruptedDispose,
    new Promise((resolve) => setImmediate(() => resolve('exchange-blocked-close'))),
  ]);
  assert.notStrictEqual(interruptedWinner, 'exchange-blocked-close');
  assert.strictEqual(interruptedWinner.helperShutdownConfirmed, false);
  assert.strictEqual(interruptedClient.diagnostics().state, 'closed_unconfirmed');
  assert.strictEqual(interruptedHarness.state.aborts.length, 1);
  interruptedResponse.resolve(createPortableIsolationHelperResponse(
    interruptedRequest,
    { ok: true, status: 'exited' }
  ));
  await expectRejectCode(interruptedExchange, 'CLIENT_CLOSED');
  assert.strictEqual(interruptedClient.diagnostics().state, 'closed_unconfirmed');

  const lateHandshake = deferred();
  let lateHandshakeRequest = null;
  const lateHandshakeHarness = transportHarness({
    exchange(request) {
      lateHandshakeRequest = request;
      return lateHandshake.promise;
    },
  });
  const lateHandshakeClient = createPortableIsolationHelperClient({
    transport: lateHandshakeHarness.transport,
    handshake: handshake(),
  });
  const lateConnect = lateHandshakeClient.connect();
  lateConnect.catch(() => undefined);
  const lateDispose = lateHandshakeClient.dispose();
  const lateDisposeWinner = await Promise.race([
    lateDispose,
    new Promise((resolve) => setImmediate(() => resolve('handshake-blocked-close'))),
  ]);
  assert.notStrictEqual(lateDisposeWinner, 'handshake-blocked-close');
  assert.strictEqual(lateDisposeWinner.helperShutdownConfirmed, false);
  lateHandshake.resolve(handshakeResponse(lateHandshakeRequest));
  await expectRejectCode(lateConnect, 'CLIENT_CLOSED');
  assert.strictEqual(lateHandshakeClient.diagnostics().state, 'closed');
  assert.strictEqual(lateHandshakeHarness.state.requests.length, 1);

  let closeReentryClient;
  let closeReentryAttempt;
  const closeReentryHarness = transportHarness({
    dispose() {
      closeReentryAttempt = closeReentryClient.exchange({
        operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
        payload: { executionId: 'execution-close-reentry', cursor: 0, maxBytes: 1024 },
      });
      closeReentryAttempt.catch(() => undefined);
      return Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
        closed: true,
      });
    },
  });
  closeReentryClient = createPortableIsolationHelperClient({
    transport: closeReentryHarness.transport,
    handshake: handshake(),
  });
  await closeReentryClient.connect();
  assert.deepStrictEqual(await closeReentryClient.dispose(), {
    version: PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
    disposed: true,
    helperShutdownConfirmed: false,
    transportClosed: true,
  });
  await expectRejectCode(closeReentryAttempt, 'CLIENT_REENTRANT');
  assert.strictEqual(closeReentryClient.diagnostics().state, 'closed_unconfirmed');

  const invalidInputHarness = transportHarness();
  const invalidInputClient = createPortableIsolationHelperClient({
    transport: invalidInputHarness.transport,
    handshake: handshake(),
  });
  await expectRejectCode(invalidInputClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
    payload: {
      rejected: Promise.reject(new Error('nested request rejection must be absorbed')),
    },
  }), 'CLIENT_REQUEST_INVALID');
  let payloadGetterCalls = 0;
  const accessorPayload = {};
  Object.defineProperty(accessorPayload, 'command', {
    enumerable: true,
    get() {
      payloadGetterCalls += 1;
      throw new Error('payload getter must not run');
    },
  });
  await expectRejectCode(invalidInputClient.exchange({
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
    payload: accessorPayload,
  }), 'CLIENT_REQUEST_INVALID');
  assert.strictEqual(payloadGetterCalls, 0);
  assert.strictEqual(invalidInputHarness.state.requests.length, 0);
  await invalidInputClient.dispose();

  await new Promise((resolve) => setImmediate(resolve));
  console.log('portable isolation helper client tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
