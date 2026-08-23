'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  assertPortableIsolationHelperFailureReceipt,
  assertPortableIsolationHelperHandshakeResponse,
  assertPortableIsolationHelperShutdownReceipt,
  createPortableIsolationHelperHandshakeRequest,
  createPortableIsolationHelperRequest,
  createPortableIsolationHelperSessionController,
  createPortableIsolationHelperShutdownReceipt,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
  assertPortableIsolationHelperBackendResponse,
  createPortableIsolationHelperBackendRequest,
} = require('../main/capabilities/portable_isolation_helper_backend_contract');
const {
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
} = require('../main/services/execution_isolation_provider_factory');
const {
  PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION,
  PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION,
  PortableIsolationHelperRuntimeOperationError,
  PortableIsolationHelperRuntimeSessionError,
  createPortableIsolationHelperRuntimeSession,
  isPortableIsolationHelperRuntimeOperationError,
} = require('../main/services/portable_isolation_helper_runtime_session');

const digest = (character) => `sha256:${character.repeat(64)}`;
const nonce = (character) => character.repeat(64);

function identity(overrides = {}) {
  return Object.freeze({
    helperId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-runtime-1',
    bundleIdentityDigest: digest('b'),
    executionWorkspaceBackendId: 'portable-private-workspace',
    projectRootAuthorityBackendId: 'portable-project-root-authority',
    processSupervisorBackendId: 'portable-process-supervisor',
    platform: Object.freeze({
      os: 'darwin',
      architecture: 'arm64',
      signatureVerification: 'platform_verified',
    }),
    ...overrides,
  });
}

function handshake(expectedBundleIdentityDigest = digest('b')) {
  return createPortableIsolationHelperHandshakeRequest({
    requestId: 'portable-handshake-a',
    clientId: 'faber-main-runtime',
    clientNonce: nonce('a'),
    expectedBundleIdentityDigest,
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    attestationVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  });
}

async function connected(overrides = {}) {
  const calls = [];
  const disposeCalls = [];
  const runtimeIdentity = overrides.identity || identity();
  const dispatch = overrides.dispatch || ((request) => {
    calls.push(request);
    return { ok: true, operation: request.operation };
  });
  const dispose = overrides.dispose || ((request) => {
    disposeCalls.push(request);
    return createPortableIsolationHelperShutdownReceipt({
      activeWorkspaces: 0,
      activeRootLeases: 0,
      activeProcesses: 0,
      orphaned: 0,
    });
  });
  const session = createPortableIsolationHelperRuntimeSession({
    identity: runtimeIdentity,
    dispatch,
    dispose,
  });
  const handshakeRequest = handshake(runtimeIdentity.bundleIdentityDigest);
  const handshakeResponse = await session.accept(handshakeRequest);
  assertPortableIsolationHelperHandshakeResponse(
    handshakeResponse,
    handshakeRequest
  );
  const controller = createPortableIsolationHelperSessionController({
    handshakeRequest,
    handshakeResponse,
  });
  return {
    calls,
    controller,
    disposeCalls,
    handshakeRequest,
    handshakeResponse,
    identity: runtimeIdentity,
    session,
  };
}

async function expectCode(action, code) {
  await assert.rejects(
    Promise.resolve().then(action),
    (error) => error instanceof PortableIsolationHelperRuntimeSessionError
      && error.code === code
      && !error.message.includes('/Users/')
  );
}

(async () => {
  const base = await connected();
  assert.ok(Object.isFrozen(base.session));
  assert.deepStrictEqual(Object.keys(base.session).sort(), [
    'version',
    'accept',
    'quarantine',
    'diagnostics',
  ].sort());
  assert.strictEqual(
    base.session.version,
    PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION,
    'portable-isolation-helper-runtime-session.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION,
    'portable-isolation-helper-runtime-dispatch-request.v1'
  );
  const brandedOperationError = new PortableIsolationHelperRuntimeOperationError(
    'WORKSPACE_BUSY',
    true
  );
  assert.ok(Object.isFrozen(brandedOperationError));
  assert.strictEqual(brandedOperationError.reasonCode, 'WORKSPACE_BUSY');
  assert.strictEqual(
    isPortableIsolationHelperRuntimeOperationError(brandedOperationError),
    true
  );
  assert.strictEqual(
    isPortableIsolationHelperRuntimeOperationError(
      Object.create(PortableIsolationHelperRuntimeOperationError.prototype)
    ),
    false
  );
  assert.deepStrictEqual(base.session.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION,
    state: 'active',
    nextSequence: 1,
    exchanges: 0,
    pending: false,
  });

  const operationBackends = new Map([
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
      base.identity.executionWorkspaceBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_DISCARD,
      base.identity.executionWorkspaceBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE,
      base.identity.projectRootAuthorityBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
      base.identity.projectRootAuthorityBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_READ_FILE,
      base.identity.projectRootAuthorityBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_INSPECT_ENTRY,
      base.identity.projectRootAuthorityBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_CLOSE,
      base.identity.projectRootAuthorityBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
      base.identity.processSupervisorBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
      base.identity.processSupervisorBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT,
      base.identity.processSupervisorBackendId],
    [PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP,
      base.identity.processSupervisorBackendId],
  ]);
  let requestNumber = 0;
  for (const [operation, backendId] of operationBackends) {
    requestNumber += 1;
    const request = base.controller.request({
      requestId: `portable-runtime-request-${requestNumber}`,
      operation,
      payload: createPortableIsolationHelperBackendRequest({
        backendId,
        input: { operationMarker: operation },
      }),
    });
    const response = await base.session.accept(request);
    base.controller.accept(response);
    const backendResponse = assertPortableIsolationHelperBackendResponse(
      response.payload
    );
    assert.strictEqual(
      backendResponse.version,
      PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION
    );
    assert.strictEqual(backendResponse.backendId, backendId);
    assert.deepStrictEqual(backendResponse.result, { ok: true, operation });
  }
  assert.strictEqual(base.calls.length, operationBackends.size);
  for (const call of base.calls) {
    assert.ok(Object.isFrozen(call));
    assert.deepStrictEqual(Object.keys(call).sort(), [
      'version', 'operation', 'backendId', 'input',
    ].sort());
    assert.strictEqual(
      call.version,
      PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION
    );
    assert.strictEqual(call.backendId, operationBackends.get(call.operation));
    assert.ok(Object.isFrozen(call.input));
  }
  assert.deepStrictEqual(base.session.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_RUNTIME_SESSION_VERSION,
    state: 'active',
    nextSequence: operationBackends.size + 1,
    exchanges: operationBackends.size,
    pending: false,
  });

  const failure = await connected({
    dispatch() {
      throw new PortableIsolationHelperRuntimeOperationError(
        'WORKSPACE_BUSY',
        true
      );
    },
  });
  const failureRequest = failure.controller.request({
    requestId: 'portable-runtime-failure-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: failure.identity.executionWorkspaceBackendId,
      input: { leaseId: 'workspace-a' },
    }),
  });
  const failureResponse = await failure.session.accept(failureRequest);
  failure.controller.accept(failureResponse);
  assert.deepStrictEqual(
    assertPortableIsolationHelperFailureReceipt(failureResponse.payload),
    {
      version: 'portable-isolation-helper-failure.v1',
      ok: false,
      reasonCode: 'WORKSPACE_BUSY',
      retryable: true,
    }
  );
  assert.strictEqual(failure.session.diagnostics().state, 'active');

  const unknownFailure = await connected({
    dispatch() {
      return Promise.reject(new Error('secret: private-project-path'));
    },
  });
  const unknownRequest = unknownFailure.controller.request({
    requestId: 'portable-runtime-unknown-failure-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: unknownFailure.identity.processSupervisorBackendId,
      input: { executionId: 'execution-a' },
    }),
  });
  const unknownResponse = await unknownFailure.session.accept(unknownRequest);
  unknownFailure.controller.accept(unknownResponse);
  const unknownReceipt = assertPortableIsolationHelperFailureReceipt(
    unknownResponse.payload
  );
  assert.strictEqual(unknownReceipt.reasonCode, 'HELPER_OPERATION_FAILED');
  assert.strictEqual(
    JSON.stringify(unknownResponse).includes('private-project-path'),
    false
  );
  assert.strictEqual(unknownFailure.session.diagnostics().state, 'quarantined');

  let hostileErrorTrapTouched = false;
  const hostileError = new Proxy(new Error('secret: hostile-error-token'), {
    getPrototypeOf() {
      hostileErrorTrapTouched = true;
      throw new Error('secret: hostile-prototype-trap');
    },
  });
  const hostileFailure = await connected({
    dispatch() {
      throw hostileError;
    },
  });
  const hostileFailureRequest = hostileFailure.controller.request({
    requestId: 'portable-runtime-hostile-failure-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: hostileFailure.identity.processSupervisorBackendId,
      input: { executionId: 'execution-a' },
    }),
  });
  const hostileFailureResponse = await hostileFailure.session.accept(
    hostileFailureRequest
  );
  hostileFailure.controller.accept(hostileFailureResponse);
  assert.strictEqual(
    assertPortableIsolationHelperFailureReceipt(
      hostileFailureResponse.payload
    ).reasonCode,
    'HELPER_OPERATION_FAILED'
  );
  assert.strictEqual(hostileErrorTrapTouched, false);
  assert.strictEqual(hostileFailure.session.diagnostics().state, 'quarantined');

  const wrongBackend = await connected();
  const wrongBackendRequest = wrongBackend.controller.request({
    requestId: 'portable-runtime-wrong-backend-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: wrongBackend.identity.processSupervisorBackendId,
      input: {},
    }),
  });
  await expectCode(
    () => wrongBackend.session.accept(wrongBackendRequest),
    'RUNTIME_BACKEND_MISMATCH'
  );
  assert.strictEqual(wrongBackend.session.diagnostics().state, 'quarantined');
  assert.strictEqual(wrongBackend.calls.length, 0);

  let reentrantSession;
  let reentrantRequest;
  let nestedReentrantCode = null;
  const reentrant = await connected({
    dispatch() {
      reentrantSession.accept(reentrantRequest).catch((error) => {
        nestedReentrantCode = error.code;
      });
      return { ok: true };
    },
  });
  reentrantSession = reentrant.session;
  reentrantRequest = reentrant.controller.request({
    requestId: 'portable-runtime-reentrant-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: reentrant.identity.processSupervisorBackendId,
      input: { executionId: 'execution-a' },
    }),
  });
  await expectCode(
    () => reentrant.session.accept(reentrantRequest),
    'RUNTIME_SESSION_QUARANTINED'
  );
  await Promise.resolve();
  assert.strictEqual(nestedReentrantCode, 'RUNTIME_SESSION_REENTRANT');
  assert.strictEqual(reentrant.session.diagnostics().state, 'quarantined');

  let thenableTouched = false;
  const hostileResult = await connected({
    dispatch() {
      return {
        ok: true,
        then() {
          thenableTouched = true;
        },
      };
    },
  });
  const hostileResultRequest = hostileResult.controller.request({
    requestId: 'portable-runtime-hostile-result-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_READ_FILE,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: hostileResult.identity.projectRootAuthorityBackendId,
      input: { relativePath: 'README.md' },
    }),
  });
  const hostileResultResponse = await hostileResult.session.accept(
    hostileResultRequest
  );
  hostileResult.controller.accept(hostileResultResponse);
  assert.strictEqual(
    assertPortableIsolationHelperFailureReceipt(
      hostileResultResponse.payload
    ).reasonCode,
    'HELPER_OPERATION_FAILED'
  );
  assert.strictEqual(thenableTouched, false);
  assert.strictEqual(hostileResult.session.diagnostics().state, 'quarantined');

  const sequence = await connected();
  const outOfSequence = createPortableIsolationHelperRequest({
    requestId: 'portable-runtime-sequence-2',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    sequence: 2,
    sessionId: sequence.handshakeResponse.sessionId,
    previousResponseDigest: sequence.handshakeResponse.responseDigest,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: sequence.identity.projectRootAuthorityBackendId,
      input: {},
    }),
  });
  await expectCode(
    () => sequence.session.accept(outOfSequence),
    'RUNTIME_REQUEST_REJECTED'
  );
  assert.strictEqual(sequence.session.diagnostics().state, 'quarantined');

  const replay = await connected();
  const firstReplayRequest = replay.controller.request({
    requestId: 'portable-runtime-replay-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: replay.identity.projectRootAuthorityBackendId,
      input: {},
    }),
  });
  const firstReplayResponse = await replay.session.accept(firstReplayRequest);
  replay.controller.accept(firstReplayResponse);
  const replayedRequest = createPortableIsolationHelperRequest({
    requestId: firstReplayRequest.requestId,
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    sequence: 2,
    sessionId: replay.handshakeResponse.sessionId,
    previousResponseDigest: firstReplayResponse.responseDigest,
    payload: createPortableIsolationHelperBackendRequest({
      backendId: replay.identity.projectRootAuthorityBackendId,
      input: {},
    }),
  });
  await expectCode(
    () => replay.session.accept(replayedRequest),
    'RUNTIME_REQUEST_REPLAY'
  );

  const shutdown = await connected();
  const shutdownRequest = shutdown.controller.request({
    requestId: 'portable-runtime-shutdown-1',
    operation: PORTABLE_ISOLATION_HELPER_OPERATIONS.PROVIDER_DISPOSE,
    payload: { reasonCode: 'APPLICATION_SHUTDOWN' },
  });
  const shutdownResponse = await shutdown.session.accept(shutdownRequest);
  shutdown.controller.accept(shutdownResponse);
  assertPortableIsolationHelperShutdownReceipt(shutdownResponse.payload);
  assert.strictEqual(shutdown.disposeCalls.length, 1);
  assert.deepStrictEqual(shutdown.disposeCalls[0], {
    reasonCode: 'APPLICATION_SHUTDOWN',
  });
  assert.ok(Object.isFrozen(shutdown.disposeCalls[0]));
  assert.strictEqual(shutdown.session.diagnostics().state, 'closed');
  await expectCode(
    () => shutdown.session.accept(shutdownRequest),
    'RUNTIME_SESSION_CLOSED'
  );

  const bundleMismatch = createPortableIsolationHelperRuntimeSession({
    identity: identity(),
    dispatch() { return {}; },
    dispose() {
      return createPortableIsolationHelperShutdownReceipt({
        activeWorkspaces: 0,
        activeRootLeases: 0,
        activeProcesses: 0,
        orphaned: 0,
      });
    },
  });
  await expectCode(
    () => bundleMismatch.accept(handshake(digest('c'))),
    'RUNTIME_HANDSHAKE_REJECTED'
  );
  assert.strictEqual(bundleMismatch.diagnostics().state, 'quarantined');

  let getterTouched = false;
  const hostileOptions = {
    identity: identity(),
    dispose() {},
  };
  Object.defineProperty(hostileOptions, 'dispatch', {
    enumerable: true,
    get() {
      getterTouched = true;
      return () => ({});
    },
  });
  assert.throws(
    () => createPortableIsolationHelperRuntimeSession(hostileOptions),
    (error) => error instanceof PortableIsolationHelperRuntimeSessionError
      && error.code === 'RUNTIME_OPTIONS_INVALID'
  );
  assert.strictEqual(getterTouched, false);

  const sessionSource = fs.readFileSync(path.join(
    __dirname,
    '..',
    'main',
    'services',
    'portable_isolation_helper_runtime_session.js'
  ), 'utf8');
  assert.doesNotMatch(
    sessionSource,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\b__dirname\b|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(|\bconsole\./
  );
  assert.match(sessionSource, /crypto\.randomBytes/);
  assert.match(sessionSource, /assertPortableIsolationHelperRequest/);
  assert.match(sessionSource, /createPortableIsolationHelperResponse/);
  assert.match(sessionSource, /util\.types\.isPromise/);
  assert.match(sessionSource, /Reflect\.apply\(Promise\.prototype\.then/);
  assert.match(sessionSource, /RUNTIME_OPERATION_ERRORS\.has/);

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const utilityEntrySource = fs.readFileSync(path.join(
    __dirname,
    '..',
    'main',
    'portable_isolation_helper',
    'utility_entry.js'
  ), 'utf8');
  assert.doesNotMatch(
    `${mainSource}\n${utilityEntrySource}`,
    /portable_isolation_helper_runtime_session|createPortableIsolationHelperRuntimeSession/
  );
  assert.match(utilityEntrySource, /createPortableIsolationHelperPhysicalRuntime/);
  assert.match(utilityEntrySource, /assertPortableIsolationHelperPrivateFrame/);
  assert.doesNotMatch(utilityEntrySource, /HELPER_RUNTIME_UNAVAILABLE/);

  console.log('portable isolation helper runtime session tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
