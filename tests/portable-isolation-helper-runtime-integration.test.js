'use strict';

const assert = require('assert');

const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  createPortableIsolationHelperShutdownReceipt,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
} = require('../main/services/execution_isolation_provider_factory');
const {
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
  createPortableIsolationHelperClient,
} = require('../main/services/portable_isolation_helper_client');
const {
  createPortableIsolationHelperProviderAdapter,
} = require('../main/services/portable_isolation_helper_provider_adapter');
const {
  PortableIsolationHelperRuntimeOperationError,
  createPortableIsolationHelperRuntimeSession,
} = require('../main/services/portable_isolation_helper_runtime_session');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding() {
  return {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/source-a',
    realRootPath: '/private/workspace/source-a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'legacy',
    submissionDigest: digest('a'),
  };
}

(async () => {
  const activeWorkspaceLeases = new Set();
  const runtime = createPortableIsolationHelperRuntimeSession({
    identity: Object.freeze({
      helperId: 'faber-portable-isolation-helper',
      helperBuildId: 'portable-helper-bootstrap-1',
      bundleIdentityDigest: digest('b'),
      executionWorkspaceBackendId: 'portable-private-workspace',
      projectRootAuthorityBackendId: 'portable-project-root-authority',
      processSupervisorBackendId: 'portable-process-supervisor',
      platform: Object.freeze({
        os: 'darwin',
        architecture: 'arm64',
        signatureVerification: 'platform_verified',
      }),
    }),
    dispatch(request) {
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE) {
        activeWorkspaceLeases.add(request.input.leaseId);
        return createExecutionWorkspaceLease({
          request: request.input,
          workspaceRootPath: '/workspace/faber-jobs/job-a',
          workspaceRealRootPath: '/private/workspace/faber-jobs/job-a',
          workspaceRootIdentityDigest: digest('c'),
        });
      }
      if (request.operation === PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_DISCARD) {
        activeWorkspaceLeases.delete(request.input.leaseId);
        return createExecutionWorkspaceDiscardReceipt({
          request: request.input,
          discarded: true,
        });
      }
      throw new PortableIsolationHelperRuntimeOperationError(
        'OPERATION_UNAVAILABLE',
        false
      );
    },
    dispose() {
      assert.strictEqual(activeWorkspaceLeases.size, 0);
      return createPortableIsolationHelperShutdownReceipt({
        activeWorkspaces: 0,
        activeRootLeases: 0,
        activeProcesses: 0,
        orphaned: 0,
      });
    },
  });

  const transportState = {
    exchanges: 0,
    aborts: 0,
    disposed: false,
  };
  const transport = Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
    exchange(request) {
      transportState.exchanges += 1;
      return runtime.accept(request);
    },
    abort(request) {
      transportState.aborts += 1;
      runtime.quarantine({ reasonCode: request.reasonCode });
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
        aborted: true,
      }));
    },
    dispose() {
      transportState.disposed = true;
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
        closed: true,
      }));
    },
  });

  const client = createPortableIsolationHelperClient({
    transport,
    handshake: {
      clientId: 'faber-main-runtime',
      clientNonce: 'a'.repeat(64),
      expectedBundleIdentityDigest: digest('b'),
      providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
      attestationVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
    },
  });
  const adapter = createPortableIsolationHelperProviderAdapter({ client });
  const candidate = await adapter.connect();
  assert.strictEqual(candidate.activationReady, true);
  assert.strictEqual(candidate.activationBlockReason, null);

  const acquireRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-a',
    binding: binding(),
    sourceRootIdentityDigest: digest('d'),
  });
  const lease = await candidate.executionWorkspaceBackend.acquire(acquireRequest);
  assert.strictEqual(lease.leaseId, acquireRequest.leaseId);
  assert.strictEqual(
    lease.workspaceRootPath,
    '/workspace/faber-jobs/job-a'
  );
  assert.strictEqual(activeWorkspaceLeases.has(lease.leaseId), true);

  const discardRequest = createExecutionWorkspaceDiscardRequest({
    request: acquireRequest,
    lease,
  });
  const discardReceipt = await candidate.executionWorkspaceBackend.discard(
    discardRequest
  );
  assert.strictEqual(discardReceipt.discarded, true);
  assert.strictEqual(activeWorkspaceLeases.size, 0);

  candidate.executionWorkspaceBackend.dispose();
  candidate.projectRootAuthorityBackend.dispose();
  const processDispose = await candidate.processSupervisorBackend.dispose();
  assert.strictEqual(processDispose.orphaned, 0);

  const disposal = await candidate.dispose();
  assert.strictEqual(disposal.disposed, true);
  assert.strictEqual(disposal.helperShutdownConfirmed, true);
  assert.strictEqual(disposal.transportClosed, true);
  assert.strictEqual(transportState.aborts, 0);
  assert.strictEqual(transportState.disposed, true);
  assert.strictEqual(transportState.exchanges, 4);
  assert.deepStrictEqual(runtime.diagnostics(), {
    version: 'portable-isolation-helper-runtime-session.v1',
    state: 'closed',
    nextSequence: 4,
    exchanges: 3,
    pending: false,
  });

  console.log('portable isolation helper runtime integration tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
