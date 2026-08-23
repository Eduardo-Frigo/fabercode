'use strict';

const assert = require('assert');

const {
  PORTABLE_ISOLATION_HELPER_CONTROLLER_VERSION,
  PORTABLE_ISOLATION_HELPER_FAILURE_VERSION,
  PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION,
  PORTABLE_ISOLATION_HELPER_LIMITS,
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION,
  PORTABLE_ISOLATION_HELPER_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_REQUIREMENTS,
  PORTABLE_ISOLATION_HELPER_RESPONSE_VERSION,
  assertPortableIsolationHelperFailureReceipt,
  assertPortableIsolationHelperHandshakeRequest,
  assertPortableIsolationHelperHandshakeResponse,
  assertPortableIsolationHelperRequest,
  assertPortableIsolationHelperResponse,
  assertPortableIsolationHelperShutdownReceipt,
  createPortableIsolationHelperFailureReceipt,
  createPortableIsolationHelperHandshakeRequest,
  createPortableIsolationHelperHandshakeResponse,
  createPortableIsolationHelperRequest,
  createPortableIsolationHelperResponse,
  createPortableIsolationHelperSessionController,
  createPortableIsolationHelperShutdownReceipt,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;
const nonce = (character) => character.repeat(64);

function expectCode(action, code) {
  assert.throws(action, (error) => error && error.code === code);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const nested of Object.values(value)) assertDeepFrozen(nested, seen);
}

function handshakeRequest(overrides = {}) {
  return createPortableIsolationHelperHandshakeRequest({
    requestId: 'helper-handshake-1',
    clientId: 'faber-main-runtime',
    clientNonce: nonce('a'),
    expectedBundleIdentityDigest: digest('b'),
    providerVersion: 'portable-execution-isolation-provider.v2',
    attestationVersion: 'portable-execution-isolation-attestation.v2',
    ...overrides,
  });
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

async function main() {
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION,
    'portable-isolation-helper-protocol.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION,
    'portable-isolation-helper-handshake.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_REQUEST_VERSION,
    'portable-isolation-helper-request.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_RESPONSE_VERSION,
    'portable-isolation-helper-response.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_CONTROLLER_VERSION,
    'portable-isolation-helper-session-controller.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_FAILURE_VERSION,
    'portable-isolation-helper-failure.v1'
  );
  assert.deepStrictEqual(PORTABLE_ISOLATION_HELPER_REQUIREMENTS, {
    bundledDistributionOnly: true,
    platformSignatureRequired: true,
    privateFramedTransport: true,
    singleSessionPerHelper: true,
    dataOnlyMessages: true,
    digestBound: true,
    sequenceBound: true,
    responseCorrelation: true,
    workspaceRootBound: true,
    physicalRootAuthority: true,
    networkDefaultDeny: true,
    processTreeTermination: true,
    boundedCursorOutput: true,
    zeroOrphanShutdown: true,
    noProviderPathInjection: true,
  });
  assertDeepFrozen(PORTABLE_ISOLATION_HELPER_REQUIREMENTS);
  assert.deepStrictEqual(Reflect.ownKeys(PORTABLE_ISOLATION_HELPER_OPERATIONS), [
    'HANDSHAKE',
    'WORKSPACE_ACQUIRE',
    'WORKSPACE_DISCARD',
    'ROOT_ACQUIRE',
    'ROOT_LIST',
    'ROOT_READ_FILE',
    'ROOT_INSPECT_ENTRY',
    'ROOT_CLOSE',
    'PROCESS_EXEC',
    'PROCESS_READ',
    'PROCESS_WAIT',
    'PROCESS_STOP',
    'PROVIDER_DISPOSE',
  ]);

  const request = handshakeRequest();
  assert.strictEqual(request.version, PORTABLE_ISOLATION_HELPER_REQUEST_VERSION);
  assert.strictEqual(request.kind, 'request');
  assert.strictEqual(request.operation, PORTABLE_ISOLATION_HELPER_OPERATIONS.HANDSHAKE);
  assert.strictEqual(request.sequence, 0);
  assert.strictEqual(request.sessionId, null);
  assert.strictEqual(request.previousResponseDigest, null);
  assert.strictEqual(request.payload.protocolVersion, PORTABLE_ISOLATION_HELPER_PROTOCOL_VERSION);
  assert.strictEqual(
    request.payload.handshakeVersion,
    PORTABLE_ISOLATION_HELPER_HANDSHAKE_VERSION
  );
  assert.strictEqual(
    request.payload.requirementsDigest,
    canonicalSha256Digest(PORTABLE_ISOLATION_HELPER_REQUIREMENTS)
  );
  assert.strictEqual(request.payloadDigest, canonicalSha256Digest(request.payload));
  assertDeepFrozen(request);
  assert.deepStrictEqual(assertPortableIsolationHelperRequest(request), request);
  assert.deepStrictEqual(assertPortableIsolationHelperHandshakeRequest(request), request);

  const response = handshakeResponse(request);
  assert.strictEqual(response.version, PORTABLE_ISOLATION_HELPER_RESPONSE_VERSION);
  assert.strictEqual(response.kind, 'response');
  assert.strictEqual(response.requestId, request.requestId);
  assert.strictEqual(response.requestDigest, request.requestDigest);
  assert.strictEqual(response.sessionId, 'portable-session-1');
  assert.strictEqual(response.payload.accepted, true);
  assert.strictEqual(response.payload.bundleIdentityDigest, digest('b'));
  assert.strictEqual(response.payload.providerVersion, request.payload.providerVersion);
  assert.strictEqual(response.payload.attestationVersion, request.payload.attestationVersion);
  assert.match(response.payload.capabilityDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(response.payload.sessionBindingDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(response.payloadDigest, canonicalSha256Digest(response.payload));
  assertDeepFrozen(response);
  assert.deepStrictEqual(assertPortableIsolationHelperResponse(response, request), response);
  assert.deepStrictEqual(
    assertPortableIsolationHelperHandshakeResponse(response, request),
    response
  );

  expectCode(
    () => handshakeResponse(request, { bundleIdentityDigest: digest('d') }),
    'PROTOCOL_BUNDLE_IDENTITY_MISMATCH'
  );
  expectCode(
    () => handshakeResponse(request, { helperNonce: request.payload.clientNonce }),
    'PROTOCOL_DATA_INVALID'
  );
  expectCode(
    () => handshakeResponse(request, {
      projectRootAuthorityBackendId: 'portable-private-workspace',
    }),
    'PROTOCOL_DATA_INVALID'
  );
  expectCode(
    () => handshakeResponse(request, {
      platform: {
        os: 'freebsd',
        architecture: 'arm64',
        signatureVerification: 'platform_verified',
      },
    }),
    'PROTOCOL_DATA_INVALID'
  );

  const sessionRequest = createPortableIsolationHelperRequest({
    requestId: 'workspace-acquire-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
    sequence: 1,
    sessionId: response.sessionId,
    previousResponseDigest: response.responseDigest,
    payload: { leaseId: 'workspace-lease-1', authorityDigest: digest('d') },
  });
  const sessionResponse = createPortableIsolationHelperResponse(sessionRequest, {
    ok: true,
    leaseId: 'workspace-lease-1',
  });
  assert.deepStrictEqual(assertPortableIsolationHelperRequest(sessionRequest), sessionRequest);
  assert.deepStrictEqual(
    assertPortableIsolationHelperResponse(sessionResponse, sessionRequest),
    sessionResponse
  );
  const differentRequest = createPortableIsolationHelperRequest({
    requestId: 'workspace-acquire-2',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
    sequence: 1,
    sessionId: response.sessionId,
    previousResponseDigest: response.responseDigest,
    payload: { leaseId: 'workspace-lease-2', authorityDigest: digest('e') },
  });
  expectCode(
    () => assertPortableIsolationHelperResponse(sessionResponse, differentRequest),
    'PROTOCOL_RESPONSE_MISMATCH'
  );

  const rejectedHandshakeSibling = Promise.reject(
    new Error('invalid handshake sibling must be absorbed')
  );
  expectCode(
    () => createPortableIsolationHelperHandshakeResponse({}, {
      platform: { rejectedHandshakeSibling },
    }),
    'PROTOCOL_ASYNC_INPUT'
  );
  const rejectedResponseSibling = Promise.reject(
    new Error('invalid response sibling must be absorbed')
  );
  expectCode(
    () => assertPortableIsolationHelperResponse(rejectedResponseSibling, {}),
    'PROTOCOL_ASYNC_INPUT'
  );
  const rejectedPayloadSibling = Promise.reject(
    new Error('invalid create-response payload sibling must be absorbed')
  );
  expectCode(
    () => createPortableIsolationHelperResponse({}, {
      rejectedPayloadSibling,
    }),
    'PROTOCOL_ASYNC_INPUT'
  );

  const mutablePayload = { nested: { cursor: 0 } };
  const immutableRequest = createPortableIsolationHelperRequest({
    requestId: 'immutable-request-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
    sequence: 1,
    sessionId: response.sessionId,
    previousResponseDigest: response.responseDigest,
    payload: mutablePayload,
  });
  mutablePayload.nested.cursor = 99;
  assert.strictEqual(immutableRequest.payload.nested.cursor, 0);
  assertDeepFrozen(immutableRequest.payload);

  const controller = createPortableIsolationHelperSessionController({
    handshakeRequest: request,
    handshakeResponse: response,
  });
  assert.deepStrictEqual(Reflect.ownKeys(controller), [
    'version', 'request', 'accept', 'quarantine', 'diagnostics',
  ]);
  assert.strictEqual(Object.isFrozen(controller), true);
  assert.deepStrictEqual(controller.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_CONTROLLER_VERSION,
    state: 'active',
    nextSequence: 1,
    exchanges: 0,
    pending: false,
  });
  const controlledRequest = controller.request({
    requestId: 'process-read-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
    payload: { executionId: 'execution-1', cursor: 0, maxBytes: 4096 },
  });
  assert.strictEqual(controlledRequest.sequence, 1);
  assert.strictEqual(controlledRequest.previousResponseDigest, response.responseDigest);
  assert.strictEqual(controller.diagnostics().state, 'busy');
  expectCode(
    () => controller.request({
      requestId: 'process-wait-1',
      operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT,
      payload: {},
    }),
    'PROTOCOL_SESSION_BUSY'
  );
  const controlledResponse = createPortableIsolationHelperResponse(controlledRequest, {
    ok: true,
    cursor: 0,
  });
  assert.deepStrictEqual(controller.accept(controlledResponse), controlledResponse);
  assert.deepStrictEqual(controller.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_CONTROLLER_VERSION,
    state: 'active',
    nextSequence: 2,
    exchanges: 1,
    pending: false,
  });
  expectCode(
    () => controller.request({
      requestId: 'process-read-1',
      operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
      payload: { executionId: 'execution-1', cursor: 0, maxBytes: 4096 },
    }),
    'PROTOCOL_REQUEST_REPLAY'
  );
  assert.strictEqual(controller.diagnostics().state, 'quarantined');

  const corruptController = createPortableIsolationHelperSessionController({
    handshakeRequest: request,
    handshakeResponse: response,
  });
  const corruptRequest = corruptController.request({
    requestId: 'root-list-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: { leaseId: 'root-lease-1', relativePath: '' },
  });
  const corruptResponse = createPortableIsolationHelperResponse(corruptRequest, { ok: true });
  const tamperedResponse = Object.freeze({
    ...corruptResponse,
    responseDigest: digest('f'),
  });
  expectCode(
    () => corruptController.accept(tamperedResponse),
    'PROTOCOL_RESPONSE_REJECTED'
  );
  assert.strictEqual(corruptController.diagnostics().state, 'quarantined');
  expectCode(
    () => corruptController.request({
      requestId: 'root-list-2',
      operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
      payload: {},
    }),
    'PROTOCOL_SESSION_QUARANTINED'
  );

  const hostileResponseController = createPortableIsolationHelperSessionController({
    handshakeRequest: request,
    handshakeResponse: response,
  });
  hostileResponseController.request({
    requestId: 'hostile-response-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT,
    payload: { executionId: 'execution-1', afterRevision: 1 },
  });
  expectCode(
    () => hostileResponseController.accept(
      Promise.reject(new Error('hostile response must be absorbed'))
    ),
    'PROTOCOL_RESPONSE_REJECTED'
  );
  assert.strictEqual(
    hostileResponseController.diagnostics().state,
    'quarantined'
  );

  const failureReceipt = createPortableIsolationHelperFailureReceipt({
    reasonCode: 'WORKSPACE_CAPACITY_EXCEEDED',
    retryable: true,
  });
  assert.deepStrictEqual(failureReceipt, {
    version: PORTABLE_ISOLATION_HELPER_FAILURE_VERSION,
    ok: false,
    reasonCode: 'WORKSPACE_CAPACITY_EXCEEDED',
    retryable: true,
  });
  assert.strictEqual(Object.isFrozen(failureReceipt), true);
  assert.deepStrictEqual(
    assertPortableIsolationHelperFailureReceipt(failureReceipt),
    failureReceipt
  );
  expectCode(
    () => createPortableIsolationHelperFailureReceipt({
      reasonCode: 'WORKSPACE_CAPACITY_EXCEEDED',
      retryable: true,
      message: '/private/workspace must not cross the helper boundary',
    }),
    'PROTOCOL_DATA_INVALID'
  );

  const failureController = createPortableIsolationHelperSessionController({
    handshakeRequest: request,
    handshakeResponse: response,
  });
  const failedOperationRequest = failureController.request({
    requestId: 'workspace-capacity-failure-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
    payload: { leaseId: 'workspace-lease-capacity' },
  });
  const failedOperationResponse = createPortableIsolationHelperResponse(
    failedOperationRequest,
    failureReceipt
  );
  failureController.accept(failedOperationResponse);
  assert.strictEqual(failureController.diagnostics().state, 'active');

  const leakingFailureController = createPortableIsolationHelperSessionController({
    handshakeRequest: request,
    handshakeResponse: response,
  });
  const leakingFailureRequest = leakingFailureController.request({
    requestId: 'leaking-failure-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE,
    payload: { leaseId: 'root-lease-leaking' },
  });
  const leakingFailureResponse = createPortableIsolationHelperResponse(
    leakingFailureRequest,
    {
      version: PORTABLE_ISOLATION_HELPER_FAILURE_VERSION,
      ok: false,
      reasonCode: 'ROOT_ACQUIRE_FAILED',
      retryable: false,
      message: '/private/project/root',
    }
  );
  expectCode(
    () => leakingFailureController.accept(leakingFailureResponse),
    'PROTOCOL_RESPONSE_REJECTED'
  );
  assert.strictEqual(leakingFailureController.diagnostics().state, 'quarantined');

  const shutdownController = createPortableIsolationHelperSessionController({
    handshakeRequest: request,
    handshakeResponse: response,
  });
  const shutdownRequest = shutdownController.request({
    requestId: 'provider-dispose-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE,
    payload: { reasonCode: 'APPLICATION_SHUTDOWN' },
  });
  const shutdownReceipt = createPortableIsolationHelperShutdownReceipt({
    activeWorkspaces: 0,
    activeRootLeases: 0,
    activeProcesses: 0,
    orphaned: 0,
  });
  expectCode(
    () => createPortableIsolationHelperShutdownReceipt({
      activeWorkspaces: 0,
      activeRootLeases: 0,
      activeProcesses: 1,
      orphaned: 0,
    }),
    'PROTOCOL_DATA_INVALID'
  );
  assert.deepStrictEqual(assertPortableIsolationHelperShutdownReceipt(shutdownReceipt), {
    ok: true,
    disposed: true,
    activeWorkspaces: 0,
    activeRootLeases: 0,
    activeProcesses: 0,
    orphaned: 0,
  });
  const shutdownResponse = createPortableIsolationHelperResponse(
    shutdownRequest,
    shutdownReceipt
  );
  shutdownController.accept(shutdownResponse);
  assert.strictEqual(shutdownController.diagnostics().state, 'closed');
  expectCode(
    () => shutdownController.request({
      requestId: 'after-close',
      operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
      payload: {},
    }),
    'PROTOCOL_SESSION_CLOSED'
  );

  const orphanController = createPortableIsolationHelperSessionController({
    handshakeRequest: request,
    handshakeResponse: response,
  });
  const orphanRequest = orphanController.request({
    requestId: 'provider-dispose-orphaned',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE,
    payload: { reasonCode: 'APPLICATION_SHUTDOWN' },
  });
  const orphanResponse = createPortableIsolationHelperResponse(orphanRequest, {
    ok: true,
    disposed: true,
    activeWorkspaces: 0,
    activeRootLeases: 0,
    activeProcesses: 1,
    orphaned: 1,
  });
  expectCode(
    () => orphanController.accept(orphanResponse),
    'PROTOCOL_RESPONSE_REJECTED'
  );
  assert.strictEqual(orphanController.diagnostics().state, 'quarantined');

  const manuallyQuarantined = createPortableIsolationHelperSessionController({
    handshakeRequest: request,
    handshakeResponse: response,
  });
  assert.deepStrictEqual(manuallyQuarantined.quarantine({
    reasonCode: 'TRANSPORT_CLOSED',
  }), { ok: true, quarantined: true });
  assert.deepStrictEqual(manuallyQuarantined.quarantine({
    reasonCode: 'TRANSPORT_CLOSED',
  }), { ok: true, quarantined: true });
  assert.strictEqual(manuallyQuarantined.diagnostics().state, 'quarantined');

  expectCode(
    () => createPortableIsolationHelperRequest({
      requestId: 'invalid-operation',
      operation: 'shell.execute',
      sequence: 1,
      sessionId: response.sessionId,
      previousResponseDigest: response.responseDigest,
      payload: {},
    }),
    'PROTOCOL_OPERATION_INVALID'
  );
  expectCode(
    () => createPortableIsolationHelperRequest({
      requestId: 'too-large',
      operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
      sequence: 1,
      sessionId: response.sessionId,
      previousResponseDigest: response.responseDigest,
      payload: { data: 'x'.repeat(PORTABLE_ISOLATION_HELPER_LIMITS.maxMessageBytes) },
    }),
    'PROTOCOL_LIMIT_EXCEEDED'
  );

  const sparse = [];
  sparse[1] = 'value';
  for (const hostilePayload of [
    Object.create({ inherited: true }),
    new Proxy({}, {}),
    { sparse },
  ]) {
    expectCode(
      () => createPortableIsolationHelperRequest({
        requestId: 'hostile-payload',
        operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
        sequence: 1,
        sessionId: response.sessionId,
        previousResponseDigest: response.responseDigest,
        payload: hostilePayload,
      }),
      'PROTOCOL_DATA_INVALID'
    );
  }

  expectCode(
    () => createPortableIsolationHelperRequest({
      requestId: 'async-payload',
      operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
      sequence: 1,
      sessionId: response.sessionId,
      previousResponseDigest: response.responseDigest,
      payload: { rejected: Promise.reject(new Error('absorbed async payload')) },
    }),
    'PROTOCOL_ASYNC_INPUT'
  );

  let getterCalls = 0;
  const accessorOptions = {
    clientId: 'faber-main-runtime',
    clientNonce: nonce('a'),
    expectedBundleIdentityDigest: digest('b'),
    providerVersion: 'portable-execution-isolation-provider.v2',
    attestationVersion: 'portable-execution-isolation-attestation.v2',
  };
  Object.defineProperty(accessorOptions, 'requestId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('requestId getter must not run');
    },
  });
  expectCode(
    () => createPortableIsolationHelperHandshakeRequest(accessorOptions),
    'PROTOCOL_DATA_INVALID'
  );
  assert.strictEqual(getterCalls, 0);

  await new Promise((resolve) => setImmediate(resolve));
  console.log('portable isolation helper protocol tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
