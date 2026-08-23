'use strict';

const assert = require('assert');

const {
  PORTABLE_ISOLATION_HELPER_CLIENT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
  createPortableIsolationHelperClient,
} = require('../main/services/portable_isolation_helper_client');
const {
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  createPortableIsolationHelperHandshakeResponse,
  createPortableIsolationHelperResponse,
  createPortableIsolationHelperShutdownReceipt,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION,
  PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
  PORTABLE_ISOLATION_HELPER_PROVIDER_ACTIVATION_BLOCK_REASON,
  PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_DISPOSE_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_VERSION,
  PORTABLE_ISOLATION_HELPER_PROVIDER_CANDIDATE_VERSION,
  PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION,
  createPortableIsolationHelperProviderAdapter,
} = require('../main/services/portable_isolation_helper_provider_adapter');
const {
  EXECUTION_WORKSPACE_BACKEND_VERSION,
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  assertExecutionWorkspaceBackend,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  assertProjectRootAuthorityBackend,
  assertProjectRootAuthorityLease,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  assertProcessSupervisorBackend,
  createProcessSupervisorExecReceipt,
  createProcessSupervisorExecRequest,
  createProcessSupervisorReadRequest,
  createProcessSupervisorReadResult,
  createProcessSupervisorStopReceipt,
  createProcessSupervisorStopRequest,
  createProcessSupervisorWaitRequest,
  createProcessSupervisorWaitResult,
} = require('../main/capabilities/process_supervisor_contract');
const {
  SANDBOX_COMMAND_KINDS,
  createSandboxExecutionRequest,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
} = require('../main/services/execution_isolation_provider_factory');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;
const nonce = (character) => character.repeat(64);

function handshake() {
  return {
    clientId: 'faber-main-runtime',
    clientNonce: nonce('a'),
    expectedBundleIdentityDigest: digest('b'),
    providerVersion: PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION,
    attestationVersion: PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION,
  };
}

function handshakeResponse(request) {
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
  });
}

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

function workspaceRequest() {
  return createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-a',
    binding: binding(),
    sourceRootIdentityDigest: digest('d'),
  });
}

function rootRequest() {
  return createProjectRootAuthorityAcquireRequest({
    leaseId: 'root-lease-a',
    binding: binding(),
    expectedPhysicalRootIdentityDigest: digest('d'),
    purpose: 'project_scan',
  });
}

function processRequest(workspaceLease) {
  const sandboxRequest = createSandboxExecutionRequest({
    executionId: 'execution-a',
    requestId: 'sandbox-request-a',
    grantId: 'grant-a',
    rootPath: workspaceLease.workspaceRootPath,
    realRootPath: workspaceLease.workspaceRealRootPath,
    command: {
      kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
      executable: 'npm',
      args: ['test'],
    },
    env: { NODE_ENV: 'test' },
    timeoutMs: 10_000,
  });
  return createProcessSupervisorExecRequest({ workspaceLease, sandboxRequest });
}

function backendResponse(backendId, result) {
  return {
    version: PORTABLE_ISOLATION_BACKEND_RESPONSE_VERSION,
    backendId,
    result,
  };
}

function transportHarness() {
  const state = {
    requests: [],
    aborts: [],
    disposeCalls: 0,
  };
  const transport = Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_TRANSPORT_VERSION,
    exchange(request) {
      state.requests.push(request);
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
      const payload = request.payload;
      assert.strictEqual(payload.version, PORTABLE_ISOLATION_BACKEND_REQUEST_VERSION);
      assert.strictEqual(Object.isFrozen(payload), true);
      const input = payload.input;
      let result;
      switch (request.operation) {
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE:
          result = createExecutionWorkspaceLease({
            request: input,
            workspaceRootPath: '/workspace/faber-jobs/job-a',
            workspaceRealRootPath: '/private/workspace/faber-jobs/job-a',
            workspaceRootIdentityDigest: digest('e'),
          });
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_DISCARD:
          result = createExecutionWorkspaceDiscardReceipt({ request: input, discarded: true });
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE:
          result = {
            version: PORTABLE_ISOLATION_ROOT_LEASE_DESCRIPTOR_VERSION,
            leaseId: input.leaseId,
            jobId: input.binding.jobId,
            projectId: input.binding.projectId,
            purpose: input.purpose,
            physicalRootIdentityDigest: input.expectedPhysicalRootIdentityDigest,
            authorityDigest: input.authorityDigest,
          };
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST:
          result = { entries: [], truncated: false };
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_READ_FILE:
          result = { found: false, contentBase64: null, contentDigest: null };
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_INSPECT_ENTRY:
          result = {
            found: false,
            kind: null,
            bytes: null,
            mode: null,
            mtimeMs: null,
            contentDigest: null,
            linkTarget: null,
            entryIdentityDigest: null,
          };
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_CLOSE:
          result = createProjectRootAuthorityCloseReceipt({
            request: input.request,
            closed: true,
          });
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC:
          result = createProcessSupervisorExecReceipt({
            request: input,
            status: 'running',
            revision: 1,
            availableFromCursor: 0,
            outputCursor: 0,
          });
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ:
          result = createProcessSupervisorReadResult({
            request: input,
            status: 'running',
            revision: 1,
            availableFromCursor: 0,
            outputCursor: 0,
            chunks: [],
            eof: false,
          });
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT:
          result = createProcessSupervisorWaitResult({
            request: input,
            status: 'running',
            revision: 1,
            availableFromCursor: 0,
            outputCursor: 0,
            changed: false,
          });
          break;
        case PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP:
          result = createProcessSupervisorStopReceipt({
            request: input,
            status: 'stopped',
            revision: 2,
            signal: 'SIGTERM',
            stopped: true,
            availableFromCursor: 0,
            outputCursor: 0,
            treeTerminated: true,
            idempotent: false,
          });
          break;
        default:
          throw new Error(`unexpected operation ${request.operation}`);
      }
      return Promise.resolve(createPortableIsolationHelperResponse(
        request,
        backendResponse(payload.backendId, result)
      ));
    },
    abort(request) {
      state.aborts.push(request);
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_TRANSPORT_ABORT_RECEIPT_VERSION,
        aborted: true,
      }));
    },
    dispose() {
      state.disposeCalls += 1;
      return Promise.resolve(Object.freeze({
        version: PORTABLE_ISOLATION_HELPER_TRANSPORT_DISPOSE_RECEIPT_VERSION,
        closed: true,
      }));
    },
  });
  return { state, transport };
}

async function main() {
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_VERSION,
    'portable-isolation-helper-provider-adapter.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_PROVIDER_CANDIDATE_VERSION,
    'portable-isolation-helper-provider-candidate.v1'
  );
  assert.strictEqual(
    PORTABLE_ISOLATION_HELPER_PROVIDER_ACTIVATION_BLOCK_REASON,
    'ASYNC_ROOT_AUTHORITY_CONTRACT_REQUIRED'
  );

  const harness = transportHarness();
  const client = createPortableIsolationHelperClient({
    transport: harness.transport,
    handshake: handshake(),
  });
  assert.strictEqual(client.version, PORTABLE_ISOLATION_HELPER_CLIENT_VERSION);
  const adapter = createPortableIsolationHelperProviderAdapter({ client });
  assert.deepStrictEqual(Reflect.ownKeys(adapter), [
    'version', 'connect', 'diagnostics', 'dispose',
  ]);
  assert.strictEqual(Object.isFrozen(adapter), true);
  const firstConnect = adapter.connect();
  const secondConnect = adapter.connect();
  assert.strictEqual(firstConnect, secondConnect);
  const candidate = await firstConnect;
  assert.deepStrictEqual(Reflect.ownKeys(candidate), [
    'version',
    'activationReady',
    'activationBlockReason',
    'providerVersion',
    'buildId',
    'executionWorkspaceBackend',
    'projectRootAuthorityBackend',
    'processSupervisorBackend',
    'isolationAttestation',
    'dispose',
  ]);
  assert.strictEqual(candidate.version, PORTABLE_ISOLATION_HELPER_PROVIDER_CANDIDATE_VERSION);
  assert.strictEqual(candidate.activationReady, false);
  assert.strictEqual(
    candidate.activationBlockReason,
    PORTABLE_ISOLATION_HELPER_PROVIDER_ACTIVATION_BLOCK_REASON
  );
  assert.strictEqual(candidate.providerVersion, PORTABLE_EXECUTION_ISOLATION_PROVIDER_VERSION);
  assert.strictEqual(candidate.buildId, 'portable-helper-build-1');
  assert.strictEqual(Object.isFrozen(candidate), true);

  const workspaceBackend = assertExecutionWorkspaceBackend(
    candidate.executionWorkspaceBackend
  );
  const rootBackend = assertProjectRootAuthorityBackend(
    candidate.projectRootAuthorityBackend
  );
  const processBackend = assertProcessSupervisorBackend(candidate.processSupervisorBackend);
  assert.strictEqual(workspaceBackend.version, EXECUTION_WORKSPACE_BACKEND_VERSION);
  assert.strictEqual(rootBackend.version, PROJECT_ROOT_AUTHORITY_BACKEND_VERSION);
  assert.strictEqual(processBackend.version, PROCESS_SUPERVISOR_BACKEND_VERSION);
  assert.deepStrictEqual(workspaceBackend.probe().guarantees, EXECUTION_WORKSPACE_REQUIRED_GUARANTEES);
  assert.deepStrictEqual(rootBackend.probe().guarantees, PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES);
  assert.deepStrictEqual(processBackend.probe().guarantees, PROCESS_SUPERVISOR_REQUIRED_GUARANTEES);

  const workspaceAcquire = workspaceRequest();
  const workspaceLease = await workspaceBackend.acquire(workspaceAcquire);
  const rootAcquire = rootRequest();
  const rootLease = await rootBackend.acquire(rootAcquire);
  assertProjectRootAuthorityLease(rootLease, rootAcquire);
  assert.deepStrictEqual(await rootLease.reader.list(createProjectRootListRequest({
    relativePath: '',
    maxEntries: 10,
  })), { entries: [], truncated: false });
  assert.deepStrictEqual(await rootLease.reader.readFile(createProjectRootReadFileRequest({
    relativePath: 'package.json',
    maxBytes: 1024,
  })), { found: false, contentBase64: null, contentDigest: null });
  assert.strictEqual((await rootLease.reader.inspectEntry(
    createProjectRootEntryInspectionRequest({ relativePath: 'package.json' })
  )).found, false);
  assert.strictEqual((await rootLease.close()).closed, true);

  const execRequest = processRequest(workspaceLease);
  const execReceipt = await processBackend.exec(execRequest);
  assert.strictEqual(execReceipt.status, 'running');
  const readRequest = createProcessSupervisorReadRequest({
    request: execRequest,
    cursor: 0,
    maxBytes: 1024,
  });
  assert.deepStrictEqual((await processBackend.read(readRequest)).chunks, []);
  const waitRequest = createProcessSupervisorWaitRequest({
    request: execRequest,
    afterRevision: 1,
    timeoutMs: 100,
  });
  assert.strictEqual((await processBackend.wait(waitRequest)).changed, false);
  const stopRequest = createProcessSupervisorStopRequest({
    request: execRequest,
    expectedRevision: 1,
    reasonCode: 'USER_CANCELLED',
  });
  assert.strictEqual((await processBackend.stop(stopRequest)).treeTerminated, true);
  assert.deepStrictEqual(await processBackend.dispose(), {
    ok: true,
    disposed: true,
    orphaned: 0,
  });

  const discardRequest = createExecutionWorkspaceDiscardRequest({
    request: workspaceAcquire,
    lease: workspaceLease,
  });
  assert.strictEqual((await workspaceBackend.discard(discardRequest)).discarded, true);
  assert.deepStrictEqual(workspaceBackend.dispose(), { ok: true, disposed: true });
  assert.deepStrictEqual(rootBackend.dispose(), { ok: true, disposed: true });

  const attestation = candidate.isolationAttestation;
  assert.strictEqual(attestation.schemaVersion, PORTABLE_EXECUTION_ISOLATION_ATTESTATION_VERSION);
  assert.strictEqual(attestation.workspaceBackendId, workspaceBackend.id);
  assert.strictEqual(attestation.projectRootAuthorityBackendId, rootBackend.id);
  assert.strictEqual(attestation.processSupervisorBackendId, processBackend.id);
  const attestationCore = {
    providerVersion: candidate.providerVersion,
    buildId: candidate.buildId,
    ...Object.fromEntries(Object.entries(attestation).filter(
      ([key]) => key !== 'attestationDigest'
    )),
  };
  assert.strictEqual(attestation.attestationDigest, canonicalSha256Digest(attestationCore));

  assert.deepStrictEqual(await candidate.dispose(), {
    version: PORTABLE_ISOLATION_HELPER_PROVIDER_ADAPTER_DISPOSE_RECEIPT_VERSION,
    disposed: true,
    helperShutdownConfirmed: true,
    transportClosed: true,
  });
  assert.strictEqual(harness.state.aborts.length, 0);
  assert.strictEqual(harness.state.disposeCalls, 1);
  assert.strictEqual(adapter.diagnostics().state, 'closed');
  assert.deepStrictEqual(harness.state.requests.map((request) => request.operation), [
    'handshake',
    'workspace.acquire',
    'root.acquire',
    'root.list',
    'root.read_file',
    'root.inspect_entry',
    'root.close',
    'process.exec',
    'process.read',
    'process.wait',
    'process.stop',
    'workspace.discard',
    'provider.dispose',
  ]);

  console.log('portable isolation helper provider adapter tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
