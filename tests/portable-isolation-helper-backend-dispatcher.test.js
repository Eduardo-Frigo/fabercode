'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
  PROJECT_ROOT_AUTHORITY_STATES,
  PROJECT_ROOT_READER_VERSION,
  createProjectRootAuthorityAcquireRequest,
  createProjectRootAuthorityCloseReceipt,
  createProjectRootAuthorityProbeResult,
  createProjectRootEntryInspectionRequest,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
} = require('../main/capabilities/project_root_authority_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  createProcessSupervisorDisposeReceipt,
  createProcessSupervisorExecReceipt,
  createProcessSupervisorExecRequest,
  createProcessSupervisorProbeResult,
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
  PORTABLE_ISOLATION_HELPER_OPERATIONS,
  assertPortableIsolationHelperShutdownReceipt,
} = require('../main/capabilities/portable_isolation_helper_protocol');
const {
  assertPortableIsolationHelperRootLeaseDescriptor,
} = require('../main/capabilities/portable_isolation_helper_backend_contract');
const {
  PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION,
  PortableIsolationHelperRuntimeOperationError,
} = require('../main/services/portable_isolation_helper_runtime_session');

const {
  PORTABLE_ISOLATION_HELPER_BACKEND_ACTIVATION_RECEIPT_VERSION,
  PORTABLE_ISOLATION_HELPER_BACKEND_DISPATCHER_VERSION,
  PortableIsolationHelperBackendDispatcherError,
  createPortableIsolationHelperBackendDispatcher,
} = require('../main/services/portable_isolation_helper_backend_dispatcher');

assert.strictEqual(
  PORTABLE_ISOLATION_HELPER_BACKEND_DISPATCHER_VERSION,
  'portable-isolation-helper-backend-dispatcher.v1'
);
assert.strictEqual(
  PORTABLE_ISOLATION_HELPER_BACKEND_ACTIVATION_RECEIPT_VERSION,
  'portable-isolation-helper-backend-activation-receipt.v1'
);
assert.strictEqual(typeof PortableIsolationHelperBackendDispatcherError, 'function');
assert.strictEqual(typeof createPortableIsolationHelperBackendDispatcher, 'function');

const digest = (character) => 'sha256:' + character.repeat(64);
const bytesDigest = (bytes) => (
  'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex')
);

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
    sourceRootIdentityDigest: digest('b'),
  });
}

function rootRequest() {
  return createProjectRootAuthorityAcquireRequest({
    leaseId: 'root-lease-a',
    binding: binding(),
    expectedPhysicalRootIdentityDigest: digest('b'),
    purpose: 'project_scan',
  });
}

function executionRequest(workspaceLease) {
  const sandboxRequest = createSandboxExecutionRequest({
    executionId: 'execution-a',
    requestId: 'request-execution-a',
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
  return createProcessSupervisorExecRequest({
    workspaceLease,
    sandboxRequest,
  });
}

function backendHarness(overrides = {}) {
  const state = {
    events: [],
    processSnapshots: new Map(),
  };
  const workspaceBackend = Object.freeze({
    version: EXECUTION_WORKSPACE_BACKEND_VERSION,
    id: 'portable-private-workspace',
    probe(context) {
      state.events.push('workspace:probe');
      assert.deepStrictEqual(
        context.requiredGuarantees,
        EXECUTION_WORKSPACE_REQUIRED_GUARANTEES
      );
      return overrides.workspaceProbe
        ? overrides.workspaceProbe(context, state)
        : createExecutionWorkspaceProbeResult({
          state: EXECUTION_WORKSPACE_STATES.ENFORCED,
          guarantees: EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
        });
    },
    acquire(request) {
      state.events.push('workspace:acquire');
      if (overrides.workspaceAcquire) {
        return overrides.workspaceAcquire(request, state);
      }
      return createExecutionWorkspaceLease({
        request,
        workspaceRootPath: '/workspace/faber-jobs/job-a',
        workspaceRealRootPath: '/private/workspace/faber-jobs/job-a',
        workspaceRootIdentityDigest: digest('c'),
      });
    },
    discard(request) {
      state.events.push('workspace:discard');
      if (overrides.workspaceDiscard) {
        return overrides.workspaceDiscard(request, state);
      }
      return createExecutionWorkspaceDiscardReceipt({
        request,
        discarded: true,
      });
    },
    dispose() {
      state.events.push('workspace:dispose');
      if (overrides.workspaceDispose) {
        return overrides.workspaceDispose(state);
      }
      return Object.freeze({ ok: true, disposed: true });
    },
  });

  const rootBackend = Object.freeze({
    version: PROJECT_ROOT_AUTHORITY_BACKEND_VERSION,
    id: 'portable-project-root-authority',
    probe(context) {
      state.events.push('root:probe');
      assert.deepStrictEqual(
        context.requiredGuarantees,
        PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES
      );
      return overrides.rootProbe
        ? overrides.rootProbe(context, state)
        : createProjectRootAuthorityProbeResult({
          state: PROJECT_ROOT_AUTHORITY_STATES.ENFORCED,
          guarantees: PROJECT_ROOT_AUTHORITY_REQUIRED_GUARANTEES,
        });
    },
    acquire(request) {
      state.events.push('root:acquire');
      let closed = false;
      const readBytes = Buffer.from('portable helper', 'utf8');
      const reader = Object.freeze({
        version: PROJECT_ROOT_READER_VERSION,
        list(listRequest) {
          if (closed) throw new Error('closed root lease');
          state.events.push('root:list:' + listRequest.relativePath);
          return Object.freeze({
            entries: Object.freeze([
              Object.freeze({ name: 'README.md', kind: 'file' }),
            ]),
            truncated: false,
          });
        },
        readFile(readRequest) {
          if (closed) throw new Error('closed root lease');
          state.events.push('root:read:' + readRequest.relativePath);
          return Object.freeze({
            found: true,
            contentBase64: readBytes.toString('base64'),
            contentDigest: bytesDigest(readBytes),
          });
        },
        inspectEntry(inspectRequest) {
          if (closed) throw new Error('closed root lease');
          state.events.push('root:inspect:' + inspectRequest.relativePath);
          return Object.freeze({
            found: false,
            kind: null,
            bytes: null,
            mode: null,
            mtimeMs: null,
            contentDigest: null,
            linkTarget: null,
            entryIdentityDigest: null,
          });
        },
      });
      const lease = Object.freeze({
        version: PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
        leaseId: request.leaseId,
        jobId: request.binding.jobId,
        projectId: request.binding.projectId,
        purpose: request.purpose,
        physicalRootIdentityDigest: request.expectedPhysicalRootIdentityDigest,
        authorityDigest: request.authorityDigest,
        reader,
        close() {
          state.events.push('root:close');
          closed = true;
          return createProjectRootAuthorityCloseReceipt({
            request,
            closed: true,
          });
        },
      });
      return overrides.rootAcquire
        ? overrides.rootAcquire(request, lease, state)
        : lease;
    },
    dispose() {
      state.events.push('root:dispose');
      if (overrides.rootDispose) return overrides.rootDispose(state);
      return Object.freeze({ ok: true, disposed: true });
    },
  });

  const processBackend = Object.freeze({
    version: PROCESS_SUPERVISOR_BACKEND_VERSION,
    id: 'portable-process-supervisor',
    probe(context) {
      state.events.push('process:probe');
      assert.deepStrictEqual(
        context.requiredGuarantees,
        PROCESS_SUPERVISOR_REQUIRED_GUARANTEES
      );
      return overrides.processProbe
        ? overrides.processProbe(context, state)
        : createProcessSupervisorProbeResult({
          state: PROCESS_SUPERVISOR_STATES.ENFORCED,
          guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
        });
    },
    exec(request) {
      state.events.push('process:exec');
      if (overrides.processExec) return overrides.processExec(request, state);
      const snapshot = {
        status: 'running',
        revision: 1,
        exitCode: null,
        signal: null,
        timedOut: false,
        stopped: false,
        availableFromCursor: 0,
        outputCursor: 5,
      };
      state.processSnapshots.set(request.executionId, snapshot);
      return createProcessSupervisorExecReceipt({ request, ...snapshot });
    },
    read(request) {
      state.events.push('process:read');
      if (overrides.processRead) return overrides.processRead(request, state);
      const snapshot = state.processSnapshots.get(request.executionId);
      const text = request.cursor < 5 ? 'hello'.slice(request.cursor) : '';
      const chunks = text
        ? [Object.freeze({
          startCursor: request.cursor,
          endCursor: 5,
          stream: 'stdout',
          text,
        })]
        : [];
      return createProcessSupervisorReadResult({
        request,
        ...snapshot,
        chunks,
        eof: false,
      });
    },
    wait(request) {
      state.events.push('process:wait');
      if (overrides.processWait) return overrides.processWait(request, state);
      const snapshot = state.processSnapshots.get(request.executionId);
      return createProcessSupervisorWaitResult({
        request,
        ...snapshot,
        changed: snapshot.revision > request.afterRevision,
      });
    },
    stop(request) {
      state.events.push('process:stop');
      if (overrides.processStop) return overrides.processStop(request, state);
      const current = state.processSnapshots.get(request.executionId);
      const snapshot = {
        ...current,
        status: 'stopped',
        revision: current.revision + 1,
        signal: 'SIGTERM',
        stopped: true,
      };
      state.processSnapshots.set(request.executionId, snapshot);
      return createProcessSupervisorStopReceipt({
        request,
        ...snapshot,
        treeTerminated: true,
        idempotent: false,
      });
    },
    dispose() {
      state.events.push('process:dispose');
      if (overrides.processDispose) return overrides.processDispose(state);
      state.processSnapshots.clear();
      return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    },
  });
  return { workspaceBackend, rootBackend, processBackend, state };
}

function createDispatcher(harness) {
  return createPortableIsolationHelperBackendDispatcher({
    executionWorkspaceBackend: harness.workspaceBackend,
    projectRootAuthorityBackend: harness.rootBackend,
    processSupervisorBackend: harness.processBackend,
  });
}

function dispatchRequest(operation, backendId, input) {
  return Object.freeze({
    version: PORTABLE_ISOLATION_HELPER_RUNTIME_DISPATCH_REQUEST_VERSION,
    operation,
    backendId,
    input,
  });
}

function rootContext(request, operationRequest) {
  return Object.freeze({
    leaseId: request.leaseId,
    authorityDigest: request.authorityDigest,
    request: operationRequest,
  });
}

(async () => {
  const harness = backendHarness();
  const dispatcher = createDispatcher(harness);
  assert.ok(Object.isFrozen(dispatcher));
  assert.deepStrictEqual(
    Object.keys(dispatcher).sort(),
    ['version', 'activate', 'dispatch', 'dispose', 'diagnostics'].sort()
  );
  assert.deepStrictEqual(dispatcher.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_BACKEND_DISPATCHER_VERSION,
    state: 'idle',
    backendCalls: 0,
    exchanges: 0,
    activeWorkspaces: 0,
    activeRootLeases: 0,
    activeProcesses: 0,
  });

  const activation = await dispatcher.activate();
  assert.ok(Object.isFrozen(activation));
  assert.deepStrictEqual(activation, {
    version: PORTABLE_ISOLATION_HELPER_BACKEND_ACTIVATION_RECEIPT_VERSION,
    active: true,
    executionWorkspaceBackendId: harness.workspaceBackend.id,
    projectRootAuthorityBackendId: harness.rootBackend.id,
    processSupervisorBackendId: harness.processBackend.id,
  });
  assert.strictEqual(await dispatcher.activate(), activation);

  const acquireWorkspace = workspaceRequest();
  const workspaceLease = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
    harness.workspaceBackend.id,
    acquireWorkspace
  ));
  assert.strictEqual(workspaceLease.leaseId, acquireWorkspace.leaseId);

  const acquireRoot = rootRequest();
  const rootDescriptor = assertPortableIsolationHelperRootLeaseDescriptor(
    await dispatcher.dispatch(dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE,
      harness.rootBackend.id,
      acquireRoot
    ))
  );
  assert.strictEqual(rootDescriptor.leaseId, acquireRoot.leaseId);
  const listRequest = createProjectRootListRequest({
    relativePath: '',
    maxEntries: 20,
  });
  const listResult = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_LIST,
    harness.rootBackend.id,
    rootContext(acquireRoot, listRequest)
  ));
  assert.deepStrictEqual(listResult.entries, [
    { name: 'README.md', kind: 'file' },
  ]);
  const readRequest = createProjectRootReadFileRequest({
    relativePath: 'README.md',
    maxBytes: 1024,
  });
  const readResult = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_READ_FILE,
    harness.rootBackend.id,
    rootContext(acquireRoot, readRequest)
  ));
  assert.strictEqual(
    Buffer.from(readResult.contentBase64, 'base64').toString('utf8'),
    'portable helper'
  );
  const inspectRequest = createProjectRootEntryInspectionRequest({
    relativePath: 'missing.txt',
  });
  const inspectResult = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_INSPECT_ENTRY,
    harness.rootBackend.id,
    rootContext(acquireRoot, inspectRequest)
  ));
  assert.strictEqual(inspectResult.found, false);

  const execRequest = executionRequest(workspaceLease);
  const execReceipt = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
    harness.processBackend.id,
    execRequest
  ));
  assert.strictEqual(execReceipt.status, 'running');
  const processRead = createProcessSupervisorReadRequest({
    request: execRequest,
    cursor: 0,
    maxBytes: 1024,
  });
  const processReadResult = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_READ,
    harness.processBackend.id,
    processRead
  ));
  assert.strictEqual(processReadResult.chunks[0].text, 'hello');
  const processWait = createProcessSupervisorWaitRequest({
    request: execRequest,
    afterRevision: 1,
    timeoutMs: 50,
  });
  const processWaitResult = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_WAIT,
    harness.processBackend.id,
    processWait
  ));
  assert.strictEqual(processWaitResult.changed, false);
  const processStop = createProcessSupervisorStopRequest({
    request: execRequest,
    expectedRevision: 1,
    reasonCode: 'TEST_COMPLETE',
  });
  const processStopReceipt = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_STOP,
    harness.processBackend.id,
    processStop
  ));
  assert.strictEqual(processStopReceipt.status, 'stopped');
  assert.strictEqual(dispatcher.diagnostics().activeProcesses, 0);

  const rootClose = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_CLOSE,
    harness.rootBackend.id,
    rootContext(acquireRoot, acquireRoot)
  ));
  assert.strictEqual(rootClose.closed, true);
  const discardWorkspace = createExecutionWorkspaceDiscardRequest({
    request: acquireWorkspace,
    lease: workspaceLease,
  });
  const discardReceipt = await dispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_DISCARD,
    harness.workspaceBackend.id,
    discardWorkspace
  ));
  assert.strictEqual(discardReceipt.discarded, true);

  const beforeDispose = dispatcher.diagnostics();
  assert.strictEqual(beforeDispose.exchanges, 11);
  assert.strictEqual(beforeDispose.activeWorkspaces, 0);
  assert.strictEqual(beforeDispose.activeRootLeases, 0);
  const shutdown = await dispatcher.dispose({
    reasonCode: 'APPLICATION_SHUTDOWN',
  });
  assertPortableIsolationHelperShutdownReceipt(shutdown);
  assert.strictEqual(
    await dispatcher.dispose({ reasonCode: 'APPLICATION_SHUTDOWN' }),
    shutdown
  );
  assert.deepStrictEqual(dispatcher.diagnostics(), {
    version: PORTABLE_ISOLATION_HELPER_BACKEND_DISPATCHER_VERSION,
    state: 'closed',
    backendCalls: 17,
    exchanges: 11,
    activeWorkspaces: 0,
    activeRootLeases: 0,
    activeProcesses: 0,
  });
  assert.deepStrictEqual(harness.state.events.slice(0, 3), [
    'workspace:probe',
    'root:probe',
    'process:probe',
  ]);

  const unleasedHarness = backendHarness();
  const unleasedDispatcher = createDispatcher(unleasedHarness);
  await unleasedDispatcher.activate();
  const forgedWorkspaceRequest = workspaceRequest();
  const forgedWorkspaceLease = createExecutionWorkspaceLease({
    request: forgedWorkspaceRequest,
    workspaceRootPath: '/workspace/faber-jobs/job-a',
    workspaceRealRootPath: '/private/workspace/faber-jobs/job-a',
    workspaceRootIdentityDigest: digest('c'),
  });
  await assert.rejects(
    unleasedDispatcher.dispatch(dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
      unleasedHarness.processBackend.id,
      executionRequest(forgedWorkspaceLease)
    )),
    (error) => (
      error instanceof PortableIsolationHelperBackendDispatcherError
      && error.code === 'BACKEND_DISPATCH_FAILED'
    )
  );
  assert.strictEqual(
    unleasedHarness.state.events.includes('process:exec'),
    false
  );
  assert.strictEqual(
    unleasedDispatcher.diagnostics().state,
    'quarantined'
  );
  await unleasedDispatcher.dispose({
    reasonCode: 'APPLICATION_SHUTDOWN',
  });

  const liveDiscardHarness = backendHarness();
  const liveDiscardDispatcher = createDispatcher(liveDiscardHarness);
  await liveDiscardDispatcher.activate();
  const liveWorkspaceRequest = workspaceRequest();
  const liveWorkspaceLease = await liveDiscardDispatcher.dispatch(
    dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
      liveDiscardHarness.workspaceBackend.id,
      liveWorkspaceRequest
    )
  );
  await liveDiscardDispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
    liveDiscardHarness.processBackend.id,
    executionRequest(liveWorkspaceLease)
  ));
  const liveDiscardRequest = createExecutionWorkspaceDiscardRequest({
    request: liveWorkspaceRequest,
    lease: liveWorkspaceLease,
  });
  await assert.rejects(
    liveDiscardDispatcher.dispatch(dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_DISCARD,
      liveDiscardHarness.workspaceBackend.id,
      liveDiscardRequest
    )),
    (error) => (
      error instanceof PortableIsolationHelperBackendDispatcherError
      && error.code === 'BACKEND_DISPATCH_FAILED'
    )
  );
  assert.strictEqual(
    liveDiscardHarness.state.events.filter(
      (event) => event === 'workspace:discard'
    ).length,
    0
  );
  assert.strictEqual(
    liveDiscardDispatcher.diagnostics().state,
    'quarantined'
  );
  await liveDiscardDispatcher.dispose({
    reasonCode: 'APPLICATION_SHUTDOWN',
  });

  const expectedError = new PortableIsolationHelperRuntimeOperationError(
    'PROCESS_CAPACITY_EXCEEDED',
    true
  );
  const expectedHarness = backendHarness({
    processExec() {
      throw expectedError;
    },
  });
  const expectedDispatcher = createDispatcher(expectedHarness);
  await expectedDispatcher.activate();
  const expectedWorkspaceRequest = workspaceRequest();
  const expectedWorkspaceLease = await expectedDispatcher.dispatch(
    dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
      expectedHarness.workspaceBackend.id,
      expectedWorkspaceRequest
    )
  );
  await assert.rejects(
    expectedDispatcher.dispatch(dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
      expectedHarness.processBackend.id,
      executionRequest(expectedWorkspaceLease)
    )),
    (error) => error === expectedError
  );
  assert.strictEqual(expectedDispatcher.diagnostics().state, 'active');
  await expectedDispatcher.dispose({
    reasonCode: 'APPLICATION_SHUTDOWN',
  });

  let hostileErrorTrapTouched = false;
  const hostileBackendError = new Proxy(
    new Error('secret: hostile-backend-error'),
    {
      getPrototypeOf() {
        hostileErrorTrapTouched = true;
        throw new Error('secret: hostile-backend-prototype');
      },
    }
  );
  const hostileFailureHarness = backendHarness({
    processExec() {
      throw hostileBackendError;
    },
  });
  const hostileFailureDispatcher = createDispatcher(hostileFailureHarness);
  await hostileFailureDispatcher.activate();
  const hostileWorkspaceRequest = workspaceRequest();
  const hostileWorkspaceLease = await hostileFailureDispatcher.dispatch(
    dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
      hostileFailureHarness.workspaceBackend.id,
      hostileWorkspaceRequest
    )
  );
  await assert.rejects(
    hostileFailureDispatcher.dispatch(dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
      hostileFailureHarness.processBackend.id,
      executionRequest(hostileWorkspaceLease)
    )),
    (error) => (
      error instanceof PortableIsolationHelperBackendDispatcherError
      && error.code === 'BACKEND_DISPATCH_FAILED'
      && !error.message.includes('hostile-backend')
    )
  );
  assert.strictEqual(hostileErrorTrapTouched, false);
  assert.strictEqual(
    hostileFailureDispatcher.diagnostics().state,
    'quarantined'
  );
  await hostileFailureDispatcher.dispose({
    reasonCode: 'APPLICATION_SHUTDOWN',
  });

  const unavailableHarness = backendHarness({
    processProbe() {
      return createProcessSupervisorProbeResult({
        state: PROCESS_SUPERVISOR_STATES.UNAVAILABLE,
        guarantees: [],
        reasonCode: 'PORTABLE_PROCESS_UNAVAILABLE',
      });
    },
  });
  const unavailableDispatcher = createDispatcher(unavailableHarness);
  await assert.rejects(
    unavailableDispatcher.activate(),
    (error) => (
      error instanceof PortableIsolationHelperBackendDispatcherError
      && error.code === 'BACKEND_DISPATCHER_ACTIVATION_FAILED'
    )
  );
  assert.strictEqual(unavailableDispatcher.diagnostics().state, 'quarantined');
  await unavailableDispatcher.dispose({
    reasonCode: 'APPLICATION_SHUTDOWN',
  });

  const cleanupHarness = backendHarness();
  const cleanupDispatcher = createDispatcher(cleanupHarness);
  await cleanupDispatcher.activate();
  const cleanupWorkspaceRequest = workspaceRequest();
  const cleanupWorkspaceLease = await cleanupDispatcher.dispatch(
    dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
      cleanupHarness.workspaceBackend.id,
      cleanupWorkspaceRequest
    )
  );
  const cleanupRootRequest = rootRequest();
  await cleanupDispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.ROOT_ACQUIRE,
    cleanupHarness.rootBackend.id,
    cleanupRootRequest
  ));
  await cleanupDispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
    cleanupHarness.processBackend.id,
    executionRequest(cleanupWorkspaceLease)
  ));
  const cleanupReceipt = await cleanupDispatcher.dispose({
    reasonCode: 'APPLICATION_SHUTDOWN',
  });
  assertPortableIsolationHelperShutdownReceipt(cleanupReceipt);
  assert.deepStrictEqual(cleanupHarness.state.events.slice(-5), [
    'process:dispose',
    'root:close',
    'workspace:discard',
    'root:dispose',
    'workspace:dispose',
  ]);
  assert.strictEqual(cleanupDispatcher.diagnostics().state, 'closed');

  const failedShutdownHarness = backendHarness({
    processDispose() {
      return Object.freeze({
        ok: false,
        disposed: true,
        orphaned: 1,
      });
    },
  });
  const failedShutdownDispatcher = createDispatcher(failedShutdownHarness);
  await failedShutdownDispatcher.activate();
  const failedWorkspaceRequest = workspaceRequest();
  const failedWorkspaceLease = await failedShutdownDispatcher.dispatch(
    dispatchRequest(
      PORTABLE_ISOLATION_HELPER_OPERATIONS.WORKSPACE_ACQUIRE,
      failedShutdownHarness.workspaceBackend.id,
      failedWorkspaceRequest
    )
  );
  await failedShutdownDispatcher.dispatch(dispatchRequest(
    PORTABLE_ISOLATION_HELPER_OPERATIONS.PROCESS_EXEC,
    failedShutdownHarness.processBackend.id,
    executionRequest(failedWorkspaceLease)
  ));
  await assert.rejects(
    failedShutdownDispatcher.dispose({
      reasonCode: 'APPLICATION_SHUTDOWN',
    }),
    (error) => (
      error instanceof PortableIsolationHelperBackendDispatcherError
      && error.code === 'BACKEND_DISPATCHER_SHUTDOWN_FAILED'
    )
  );
  assert.strictEqual(
    failedShutdownDispatcher.diagnostics().state,
    'quarantined'
  );
  assert.strictEqual(
    failedShutdownHarness.state.events.includes('workspace:dispose'),
    true
  );

  let optionGetterTouched = false;
  const hostileOptions = {
    executionWorkspaceBackend: harness.workspaceBackend,
    projectRootAuthorityBackend: harness.rootBackend,
  };
  Object.defineProperty(hostileOptions, 'processSupervisorBackend', {
    enumerable: true,
    get() {
      optionGetterTouched = true;
      return harness.processBackend;
    },
  });
  assert.throws(
    () => createPortableIsolationHelperBackendDispatcher(hostileOptions),
    (error) => (
      error instanceof PortableIsolationHelperBackendDispatcherError
      && error.code === 'BACKEND_DISPATCHER_OPTIONS_INVALID'
    )
  );
  assert.strictEqual(optionGetterTouched, false);

  const source = fs.readFileSync(path.join(
    __dirname,
    '..',
    'main',
    'services',
    'portable_isolation_helper_backend_dispatcher.js'
  ), 'utf8');
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|child_process|fs|path|net|tls|http|https|worker_threads|module)['"]\)|\bprocess\.env\b|\b__dirname\b|\bspawn\s*\(|\bexecFile\s*\(|\bimport\s*\(|\bconsole\./
  );
  assert.match(source, /isPortableIsolationHelperRuntimeOperationError/);
  assert.match(source, /createExecutionWorkspaceDiscardRequest/);
  assert.match(source, /assertProcessSupervisorDisposeReceipt/);
  const mainSource = fs.readFileSync(
    path.join(__dirname, '..', 'main.js'),
    'utf8'
  );
  const utilityEntrySource = fs.readFileSync(path.join(
    __dirname,
    '..',
    'main',
    'portable_isolation_helper',
    'utility_entry.js'
  ), 'utf8');
  assert.doesNotMatch(
    mainSource + '\n' + utilityEntrySource,
    /portable_isolation_helper_backend_dispatcher|createPortableIsolationHelperBackendDispatcher/
  );
  assert.match(utilityEntrySource, /createPortableIsolationHelperPhysicalRuntime/);
  assert.match(utilityEntrySource, /assertPortableIsolationHelperPrivateFrame/);
  assert.doesNotMatch(utilityEntrySource, /HELPER_RUNTIME_UNAVAILABLE/);

  console.log('portable isolation helper backend dispatcher tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
