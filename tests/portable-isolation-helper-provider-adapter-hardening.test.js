'use strict';

const assert = require('assert');

const {
  PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
} = require('../main/services/portable_isolation_helper_client');
const {
  MAX_QUEUED_EXCHANGES,
  PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
  PORTABLE_ISOLATION_HELPER_PROVIDER_ACTIVATION_BLOCK_REASON,
  createPortableIsolationHelperProviderAdapter,
} = require('../main/services/portable_isolation_helper_provider_adapter');
const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  createPortableIsolationHelperFailureReceipt,
  createPortableIsolationHelperHandshakeRequest,
  createPortableIsolationHelperHandshakeResponse,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  createProjectRootAuthorityAcquireRequest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  createProcessSupervisorExecReceipt,
  createProcessSupervisorExecRequest,
  createProcessSupervisorStopReceipt,
} = require('../main/capabilities/process_supervisor_contract');
const {
  SANDBOX_COMMAND_KINDS,
  createSandboxExecutionRequest,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
} = require('../main/runtime/execution_isolation_runtime_config');
const {
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
  createExecutionIsolationProviderSelection,
} = require('../main/services/execution_isolation_provider_factory');

const digest = (character) => `sha256:${character.repeat(64)}`;
const nonce = (character) => character.repeat(64);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function handshakePayload() {
  const request = createPortableIsolationHelperHandshakeRequest({
    requestId: 'hardening-handshake-1',
    clientId: 'faber-main-runtime',
    clientNonce: nonce('a'),
    expectedBundleIdentityDigest: digest('b'),
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    attestationVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  });
  return createPortableIsolationHelperHandshakeResponse(request, {
    helperId: 'faber-portable-isolation-helper',
    helperBuildId: 'portable-helper-hardening-build-1',
    helperNonce: nonce('c'),
    sessionId: 'portable-hardening-session-1',
    bundleIdentityDigest: digest('b'),
    executionWorkspaceBackendId: 'portable-private-workspace',
    projectRootAuthorityBackendId: 'portable-project-root-authority',
    processSupervisorBackendId: 'portable-process-supervisor',
    platform: {
      os: 'darwin',
      architecture: 'arm64',
      signatureVerification: 'platform_verified',
    },
  }).payload;
}

function binding(suffix = 'a') {
  return {
    projectId: `project-${suffix}`,
    canonicalRootPath: `/workspace/source-${suffix}`,
    realRootPath: `/private/workspace/source-${suffix}`,
    sessionId: `session-${suffix}`,
    jobId: `job-${suffix}`,
    kernelId: 'legacy',
    submissionDigest: digest('a'),
  };
}

function workspaceRequest(suffix = 'a') {
  return createExecutionWorkspaceAcquireRequest({
    leaseId: `workspace-lease-${suffix}`,
    binding: binding(suffix),
    sourceRootIdentityDigest: digest('d'),
  });
}

function workspaceLease(request, suffix = 'a') {
  return createExecutionWorkspaceLease({
    request,
    workspaceRootPath: `/workspace/faber-jobs/job-${suffix}`,
    workspaceRealRootPath: `/private/workspace/faber-jobs/job-${suffix}`,
    workspaceRootIdentityDigest: digest('e'),
  });
}

function rootRequest(suffix = 'a') {
  return createProjectRootAuthorityAcquireRequest({
    leaseId: `root-lease-${suffix}`,
    binding: binding(suffix),
    expectedPhysicalRootIdentityDigest: digest('d'),
    purpose: 'project_scan',
  });
}

function rootDescriptor(request) {
  return {
    version: 'portable-isolation-root-lease-descriptor.v1',
    leaseId: request.leaseId,
    jobId: request.binding.jobId,
    projectId: request.binding.projectId,
    purpose: request.purpose,
    physicalRootIdentityDigest: request.expectedPhysicalRootIdentityDigest,
    authorityDigest: request.authorityDigest,
  };
}

function processRequest(lease, suffix = 'a') {
  const sandboxRequest = createSandboxExecutionRequest({
    executionId: `execution-${suffix}`,
    requestId: `sandbox-request-${suffix}`,
    grantId: `grant-${suffix}`,
    rootPath: lease.workspaceRootPath,
    realRootPath: lease.workspaceRealRootPath,
    command: {
      kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
      executable: 'npm',
      args: ['test'],
    },
    env: { NODE_ENV: 'test' },
    timeoutMs: 10_000,
  });
  return createProcessSupervisorExecRequest({ workspaceLease: lease, sandboxRequest });
}

function backendResponse(backendId, result) {
  return {
    version: PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
    backendId,
    result,
  };
}

function clientHarness({
  onConnect,
  onExchange,
  helperShutdownConfirmed = false,
} = {}) {
  const state = {
    connectCalls: 0,
    disposeCalls: 0,
    exchanges: [],
    quarantines: [],
  };
  const client = Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
    connect() {
      state.connectCalls += 1;
      if (typeof onConnect === 'function') return onConnect();
      return Promise.resolve(handshakePayload());
    },
    exchange(request) {
      state.exchanges.push(request);
      if (typeof onExchange !== 'function') {
        return Promise.reject(new Error('hardening exchange handler unavailable'));
      }
      return onExchange(request, state);
    },
    quarantine(request) {
      state.quarantines.push(request);
      return Object.freeze({ ok: true, quarantined: true });
    },
    diagnostics() {
      return Object.freeze({ state: 'test-double' });
    },
    dispose() {
      state.disposeCalls += 1;
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_CLIENT_DISPOSE_RECEIPT_VERSION,
        disposed: true,
        helperShutdownConfirmed,
        transportClosed: true,
      }));
    },
  });
  return { client, state };
}

function assertErrorCode(code) {
  return (error) => {
    assert.strictEqual(error.code, code);
    assert.strictEqual(error.message, code);
    return true;
  };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function assertConstructionHardening() {
  assert.strictEqual(MAX_QUEUED_EXCHANGES, 1_024);
  assert.throws(
    () => createPortableIsolationHelperProviderAdapter(),
    assertErrorCode('ADAPTER_OPTIONS_INVALID')
  );
  const harness = clientHarness();
  assert.throws(
    () => createPortableIsolationHelperProviderAdapter({
      client: harness.client,
      injectedHelperPath: '/tmp/denied',
    }),
    assertErrorCode('ADAPTER_OPTIONS_INVALID')
  );
  assert.throws(
    () => createPortableIsolationHelperProviderAdapter({
      client: { ...harness.client },
    }),
    assertErrorCode('ADAPTER_CLIENT_INVALID')
  );

  const rejectedClient = Promise.reject(new Error('secret-client-rejection'));
  assert.throws(
    () => createPortableIsolationHelperProviderAdapter({ client: rejectedClient }),
    assertErrorCode('ADAPTER_OPTIONS_INVALID')
  );
  await flushTasks();
}

async function assertCounterfeitHandshakeIsRejected() {
  const counterfeit = Object.freeze({
    ...handshakePayload(),
    helperBuildId: '/private/secret-helper',
  });
  const harness = clientHarness({
    onConnect() {
      return Promise.resolve(counterfeit);
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  await assert.rejects(
    adapter.connect(),
    (error) => {
      assert.strictEqual(error.code, 'ADAPTER_HANDSHAKE_REJECTED');
      assert.strictEqual(error.message.includes('/private/secret-helper'), false);
      return true;
    }
  );
  await flushTasks();
  assert.deepStrictEqual(harness.state.quarantines, [
    { reasonCode: 'ADAPTER_HANDSHAKE_REJECTED' },
  ]);
  assert.strictEqual(harness.state.disposeCalls, 1);
  assert.strictEqual(adapter.diagnostics().state, 'closed');
}

async function assertFifoSerialization() {
  const pending = [];
  const harness = clientHarness({
    onExchange(request) {
      const task = deferred();
      pending.push({ request, task });
      return task.promise;
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  const candidate = await adapter.connect();
  const requestA = workspaceRequest('fifo-a');
  const requestB = workspaceRequest('fifo-b');
  const acquireA = candidate.executionWorkspaceBackend.acquire(requestA);
  const acquireB = candidate.executionWorkspaceBackend.acquire(requestB);

  assert.strictEqual(harness.state.exchanges.length, 1);
  assert.strictEqual(adapter.diagnostics().inFlight, true);
  assert.strictEqual(adapter.diagnostics().queued, 1);
  pending[0].task.resolve(backendResponse(
    pending[0].request.payload.backendId,
    workspaceLease(requestA, 'fifo-a')
  ));
  assert.strictEqual((await acquireA).leaseId, requestA.leaseId);
  await flushTasks();
  assert.strictEqual(harness.state.exchanges.length, 2);
  pending[1].task.resolve(backendResponse(
    pending[1].request.payload.backendId,
    workspaceLease(requestB, 'fifo-b')
  ));
  assert.strictEqual((await acquireB).leaseId, requestB.leaseId);
  assert.strictEqual(adapter.diagnostics().queued, 0);
  assert.strictEqual(adapter.diagnostics().exchanges, 2);
  await candidate.dispose();
}

async function assertQueueCapacityAndInFlightDisposal() {
  const exchangePending = deferred();
  const harness = clientHarness({
    onExchange() {
      return exchangePending.promise;
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  const candidate = await adapter.connect();
  const acquisitions = [];
  for (let index = 0; index < MAX_QUEUED_EXCHANGES; index += 1) {
    acquisitions.push(candidate.executionWorkspaceBackend.acquire(
      workspaceRequest(`capacity-${index}`)
    ));
  }
  await assert.rejects(
    candidate.executionWorkspaceBackend.acquire(workspaceRequest('capacity-overflow')),
    assertErrorCode('ADAPTER_QUEUE_CAPACITY_EXCEEDED')
  );
  assert.strictEqual(harness.state.exchanges.length, 1);
  assert.strictEqual(adapter.diagnostics().queued, MAX_QUEUED_EXCHANGES - 1);
  assert.strictEqual((await candidate.dispose()).transportClosed, true);
  exchangePending.resolve(backendResponse(
    candidate.executionWorkspaceBackend.id,
    workspaceLease(workspaceRequest('capacity-0'), 'capacity-0')
  ));
  const outcomes = await Promise.allSettled(acquisitions);
  assert.strictEqual(outcomes.every((outcome) => outcome.status === 'rejected'), true);
  assert.strictEqual(adapter.diagnostics().state, 'closed_unconfirmed');
}

async function assertOperationalFailureIsNonTerminal() {
  const harness = clientHarness({
    onExchange() {
      return Promise.resolve(createPortableIsolationHelperFailureReceipt({
        reasonCode: 'WORKSPACE_CAPACITY_EXCEEDED',
        retryable: true,
      }));
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  const candidate = await adapter.connect();
  await assert.rejects(
    candidate.executionWorkspaceBackend.acquire(workspaceRequest('failure')),
    (error) => {
      assert.strictEqual(error.code, 'ADAPTER_OPERATION_FAILED');
      assert.strictEqual(error.message, 'ADAPTER_OPERATION_FAILED');
      assert.strictEqual(error.reasonCode, 'WORKSPACE_CAPACITY_EXCEEDED');
      assert.strictEqual(error.retryable, true);
      return true;
    }
  );
  assert.strictEqual(adapter.diagnostics().state, 'active');
  assert.strictEqual(harness.state.quarantines.length, 0);
  await candidate.dispose();
}

async function assertPendingFacetsCannotReleaseAuthority() {
  const pending = new Map();
  const harness = clientHarness({
    onExchange(request) {
      const task = deferred();
      pending.set(request.operation, { request, task });
      return task.promise;
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  const candidate = await adapter.connect();
  const workspaceAcquireRequest = workspaceRequest('pending');
  const rootAcquireRequest = rootRequest('pending');
  const workspaceAcquire = candidate.executionWorkspaceBackend.acquire(
    workspaceAcquireRequest
  );
  const rootAcquire = candidate.projectRootAuthorityBackend.acquire(rootAcquireRequest);

  assert.throws(
    () => candidate.executionWorkspaceBackend.dispose(),
    assertErrorCode('ADAPTER_PENDING_WORKSPACE_OPERATIONS')
  );
  assert.throws(
    () => candidate.projectRootAuthorityBackend.dispose(),
    assertErrorCode('ADAPTER_PENDING_ROOT_OPERATIONS')
  );

  const workspacePending = pending.get(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE
  );
  workspacePending.task.resolve(backendResponse(
    workspacePending.request.payload.backendId,
    workspaceLease(workspaceAcquireRequest, 'pending')
  ));
  await workspaceAcquire;
  await flushTasks();
  const rootPending = pending.get(PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE);
  rootPending.task.resolve(backendResponse(
    rootPending.request.payload.backendId,
    rootDescriptor(rootAcquireRequest)
  ));
  await rootAcquire;

  assert.throws(
    () => candidate.executionWorkspaceBackend.dispose(),
    assertErrorCode('ADAPTER_LIVE_WORKSPACES')
  );
  assert.throws(
    () => candidate.projectRootAuthorityBackend.dispose(),
    assertErrorCode('ADAPTER_LIVE_ROOT_LEASES')
  );
  await candidate.dispose();
}

async function assertDomainFailureQuarantinesAndRejectsQueue() {
  const first = deferred();
  const harness = clientHarness({
    onExchange() {
      return first.promise;
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  const candidate = await adapter.connect();
  const acquireA = candidate.executionWorkspaceBackend.acquire(workspaceRequest('invalid-a'));
  const acquireB = candidate.executionWorkspaceBackend.acquire(workspaceRequest('invalid-b'));
  first.resolve(backendResponse('wrong-backend-id', { leakedPath: '/private/secret' }));

  await assert.rejects(acquireA, assertErrorCode('ADAPTER_RESPONSE_REJECTED'));
  await assert.rejects(acquireB, assertErrorCode('ADAPTER_RESPONSE_REJECTED'));
  await flushTasks();
  assert.deepStrictEqual(harness.state.quarantines, [
    { reasonCode: 'DOMAIN_RESPONSE_REJECTED' },
  ]);
  assert.strictEqual(harness.state.disposeCalls, 1);
  assert.strictEqual(adapter.diagnostics().state, 'closed_unconfirmed');
  assert.strictEqual(harness.state.exchanges.length, 1);
}

async function assertProcessDisposeWaitsAndReapsPendingExec() {
  const execPending = deferred();
  const harness = clientHarness({
    onExchange(request) {
      const input = request.payload.input;
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC) {
        return execPending.promise;
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP) {
        return Promise.resolve(backendResponse(
          request.payload.backendId,
          createProcessSupervisorStopReceipt({
            request: input,
            status: 'stopped',
            revision: 2,
            signal: 'SIGTERM',
            stopped: true,
            availableFromCursor: 0,
            outputCursor: 0,
            treeTerminated: true,
            idempotent: false,
          })
        ));
      }
      return Promise.reject(new Error('unexpected process hardening operation'));
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  const candidate = await adapter.connect();
  const workspaceAcquire = workspaceRequest('process-pending');
  const lease = workspaceLease(workspaceAcquire, 'process-pending');
  const execRequest = processRequest(lease, 'process-pending');
  const execPromise = candidate.processSupervisorBackend.exec(execRequest);
  const disposePromise = candidate.processSupervisorBackend.dispose();
  let disposeSettled = false;
  disposePromise.then(
    () => { disposeSettled = true; },
    () => { disposeSettled = true; }
  );
  await flushTasks();
  assert.strictEqual(disposeSettled, false);

  execPending.resolve(backendResponse(
    candidate.processSupervisorBackend.id,
    createProcessSupervisorExecReceipt({
      request: execRequest,
      status: 'running',
      revision: 1,
      availableFromCursor: 0,
      outputCursor: 0,
    })
  ));
  await execPromise;
  assert.deepStrictEqual(await disposePromise, {
    ok: true,
    disposed: true,
    orphaned: 0,
  });
  const stopRequests = harness.state.exchanges.filter(
    (request) => request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP
  );
  assert.strictEqual(stopRequests.length, 1);
  assert.strictEqual(stopRequests[0].payload.input.reasonCode, 'PROVIDER_DISPOSE');
  assert.strictEqual(adapter.diagnostics().activeProcesses, 0);
  await candidate.dispose();
}

async function assertReentrancyFlushesQuarantineAndDisposal() {
  let candidate;
  let nestedPromise;
  const harness = clientHarness({
    onExchange(request) {
      nestedPromise = candidate.executionWorkspaceBackend.acquire(
        workspaceRequest('reentrant-nested')
      );
      return Promise.resolve(backendResponse(
        request.payload.backendId,
        workspaceLease(request.payload.input, 'reentrant-outer')
      ));
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  candidate = await adapter.connect();
  const outerPromise = candidate.executionWorkspaceBackend.acquire(
    workspaceRequest('reentrant-outer')
  );
  await assert.rejects(nestedPromise, assertErrorCode('ADAPTER_REENTRANT'));
  await assert.rejects(outerPromise, assertErrorCode('ADAPTER_REENTRANT'));
  await flushTasks();
  assert.deepStrictEqual(harness.state.quarantines, [
    { reasonCode: 'ADAPTER_REENTRANCY' },
  ]);
  assert.strictEqual(harness.state.disposeCalls, 1);
  assert.strictEqual(adapter.diagnostics().state, 'closed_unconfirmed');
}

async function assertCandidateCannotActivateEarly() {
  const harness = clientHarness({
    onExchange() {
      return Promise.reject(new Error('not expected'));
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client: harness.client });
  const candidate = await adapter.connect();
  assert.strictEqual(candidate.activationReady, false);
  assert.strictEqual(
    candidate.activationBlockReason,
    PORTABLE_ISOLATION_HELPER_PROVIDER_ACTIVATION_BLOCK_REASON
  );
  const selection = createExecutionIsolationProviderSelection({
    config: Object.freeze({
      version: EXECUTION_ISOLATION_RUNTIME_CONFIG_VERSION,
      mode: 'enabled',
      killSwitch: false,
    }),
    providerFactory: () => candidate,
  });
  assert.strictEqual(selection.diagnostics.status, 'unsupported');
  assert.strictEqual(selection.diagnostics.reasonCode, 'PROVIDER_REJECTED');
  await candidate.dispose();
  assert.strictEqual(harness.state.disposeCalls, 1);
}

async function main() {
  await assertConstructionHardening();
  await assertCounterfeitHandshakeIsRejected();
  await assertFifoSerialization();
  await assertQueueCapacityAndInFlightDisposal();
  await assertOperationalFailureIsNonTerminal();
  await assertPendingFacetsCannotReleaseAuthority();
  await assertDomainFailureQuarantinesAndRejectsQueue();
  await assertProcessDisposeWaitsAndReapsPendingExec();
  await assertReentrancyFlushesQuarantineAndDisposal();
  await assertCandidateCannotActivateEarly();
  console.log('portable isolation helper provider adapter hardening tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
