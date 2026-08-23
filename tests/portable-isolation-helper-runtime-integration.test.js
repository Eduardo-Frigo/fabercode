'use strict';

const assert = require('assert');

const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  EXECUTION_WORKSPACE_STATES,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceLease,
  createExecutionWorkspaceProbeResult,
} = require('../main/capabilities/execution_workspace_contract');
const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  createProjectRootAuthorityProbeResult,
} = require('../main/capabilities/project_root_authority_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  createProcessSupervisorDisposeReceipt,
  createProcessSupervisorProbeResult,
} = require('../main/capabilities/process_supervisor_contract');
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
  createPortableIsolationHelperRuntimeSession,
} = require('../main/services/portable_isolation_helper_runtime_session');
const {
  createPortableIsolationHelperBackendDispatcher,
} = require('../main/services/portable_isolation_helper_backend_dispatcher');

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
  const backendEvents = [];
  const executionWorkspaceBackend = Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: 'portable-private-workspace',
    probe() {
      backendEvents.push('workspace:probe');
      return createExecutionWorkspaceProbeResult({
        state: EXECUTION_WORKSPACE_STATES.ENFORCED,
        guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
      });
    },
    dispose() {
      backendEvents.push('workspace:dispose');
      assert.strictEqual(activeWorkspaceLeases.size, 0);
      return Object.freeze({ ok: true, disposed: true });
    },
    acquire(request) {
      backendEvents.push('workspace:acquire');
      activeWorkspaceLeases.add(request.leaseId);
      return createExecutionWorkspaceLease({
        request,
        workspaceRootPath: '/workspace/faber-jobs/job-a',
        workspaceRealRootPath: '/private/workspace/faber-jobs/job-a',
        workspaceRootIdentityDigest: digest('c'),
      });
    },
    discard(request) {
      backendEvents.push('workspace:discard');
      activeWorkspaceLeases.delete(request.leaseId);
      return createExecutionWorkspaceDiscardReceipt({
        request,
        discarded: true,
      });
    },
  });
  const projectRootAuthorityBackend = Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: 'portable-project-root-authority',
    probe() {
      backendEvents.push('root:probe');
      return createProjectRootAuthorityProbeResult({
        state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
        guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
      });
    },
    acquire() {
      throw new Error('root acquisition is outside this integration scenario');
    },
    dispose() {
      backendEvents.push('root:dispose');
      return Object.freeze({ ok: true, disposed: true });
    },
  });
  const processSupervisorBackend = Object.freeze({
    version: PROCESS_SUPERVISOR_BACKEND_VERSION,
    id: 'portable-process-supervisor',
    probe() {
      backendEvents.push('process:probe');
      return createProcessSupervisorProbeResult({
        state: PROCESS_SUPERVISOR_STATES.ENFORCED,
        guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
      });
    },
    exec() { throw new Error('process exec is outside this integration scenario'); },
    read() { throw new Error('process read is outside this integration scenario'); },
    wait() { throw new Error('process wait is outside this integration scenario'); },
    stop() { throw new Error('process stop is outside this integration scenario'); },
    dispose() {
      backendEvents.push('process:dispose');
      return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    },
  });
  const dispatcher = createPortableIsolationHelperBackendDispatcher({
    executionWorkspaceBackend,
    projectRootAuthorityBackend,
    processSupervisorBackend,
  });
  const activation = await dispatcher.activate();
  const runtime = createPortableIsolationHelperRuntimeSession({
    identity: Object.freeze({
      helperId: 'faber-portable-isolation-helper',
      helperBuildId: 'portable-helper-runtime-1',
      bundleIdentityDigest: digest('b'),
      executionWorkspaceBackendId: activation.executionWorkspaceBackendId,
      projectRootAuthorityBackendId:
        activation.projectRootAuthorityBackendId,
      processSupervisorBackendId: activation.processSupervisorBackendId,
      platform: Object.freeze({
        os: 'darwin',
        architecture: 'arm64',
        signatureVerification: 'platform_verified',
      }),
    }),
    dispatch: dispatcher.dispatch,
    dispose: dispatcher.dispose,
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
  assert.deepStrictEqual(dispatcher.diagnostics(), {
    version: 'portable-isolation-helper-backend-dispatcher.v1',
    state: 'closed',
    backendCalls: 8,
    exchanges: 2,
    activeWorkspaces: 0,
    activeRootLeases: 0,
    activeProcesses: 0,
  });
  assert.deepStrictEqual(backendEvents, [
    'workspace:probe',
    'root:probe',
    'process:probe',
    'workspace:acquire',
    'workspace:discard',
    'process:dispose',
    'root:dispose',
    'workspace:dispose',
  ]);

  console.log('portable isolation helper runtime integration tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
