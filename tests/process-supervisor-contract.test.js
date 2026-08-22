'use strict';

const assert = require('assert');

const {
  EXECUTION_WORKSPACE_REQUIRED_GUARANTEES,
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  SANDBOX_COMMAND_KINDS,
  SANDBOX_NETWORK_MODES,
  createSandboxExecutionRequest,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_EXEC_RECEIPT_VERSION,
  PROCESS_SUPERVISOR_EXEC_REQUEST_VERSION,
  PROCESS_SUPERVISOR_GUARANTEES,
  PROCESS_SUPERVISOR_READ_RESULT_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  PROCESS_SUPERVISOR_STOP_RECEIPT_VERSION,
  ProcessSupervisorUnavailableError,
  assertProcessSupervisorBackend,
  assertProcessSupervisorExecReceipt,
  assertProcessSupervisorReadResult,
  assertProcessSupervisorStopReceipt,
  assertProcessSupervisorWaitResult,
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
  createUnsupportedProcessSupervisorBackend,
} = require('../main/capabilities/process_supervisor_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;

function workspaceAuthority(overrides = {}) {
  const binding = {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/source-a',
    realRootPath: '/private/workspace/source-a',
    sessionId: 'session-a',
    jobId: overrides.jobId || 'job-a',
    kernelId: 'legacy',
    submissionDigest: digest('a'),
  };
  const request = createExecutionWorkspaceAcquireRequest({
    leaseId: overrides.leaseId || 'workspace-lease-a',
    binding,
    sourceRootIdentityDigest: digest('b'),
  });
  const lease = createExecutionWorkspaceLease({
    request,
    workspaceRootPath: overrides.workspaceRootPath || '/workspace/faber-jobs/job-a',
    workspaceRealRootPath:
      overrides.workspaceRealRootPath || '/private/workspace/faber-jobs/job-a',
    workspaceRootIdentityDigest: overrides.workspaceRootIdentityDigest || digest('c'),
  });
  return { request, lease };
}

function executionRequest(overrides = {}) {
  const authority = workspaceAuthority(overrides);
  const sandboxRequest = createSandboxExecutionRequest({
    executionId: overrides.executionId || 'process-execution-a',
    requestId: overrides.requestId || 'request-a',
    grantId: overrides.grantId || 'grant-a',
    rootPath: authority.lease.workspaceRootPath,
    realRootPath: authority.lease.workspaceRealRootPath,
    cwd: authority.lease.workspaceRootPath,
    cwdRealPath: authority.lease.workspaceRealRootPath,
    command: overrides.command || {
      kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
      executable: 'npm',
      args: ['test'],
    },
    env: { NODE_ENV: 'test' },
    networkMode: SANDBOX_NETWORK_MODES.DISABLED,
    tempRoots: overrides.tempRoots || [],
    cacheRoots: overrides.cacheRoots || [],
    timeoutMs: 30_000,
  });
  return createProcessSupervisorExecRequest({
    workspaceLease: authority.lease,
    sandboxRequest,
  });
}

assert.strictEqual(PROCESS_SUPERVISOR_BACKEND_VERSION, 'process-supervisor-backend.v1');
assert.deepStrictEqual(PROCESS_SUPERVISOR_REQUIRED_GUARANTEES, [
  PROCESS_SUPERVISOR_GUARANTEES.WORKSPACE_ROOT_BOUND,
  PROCESS_SUPERVISOR_GUARANTEES.PHYSICAL_CWD_REVALIDATION,
  PROCESS_SUPERVISOR_GUARANTEES.NETWORK_DEFAULT_DENY,
  PROCESS_SUPERVISOR_GUARANTEES.PROCESS_TREE_TERMINATION,
  PROCESS_SUPERVISOR_GUARANTEES.BOUNDED_CURSOR_OUTPUT,
  PROCESS_SUPERVISOR_GUARANTEES.ORPHAN_REAPING,
  PROCESS_SUPERVISOR_GUARANTEES.EXECUTION_IDENTITY_BINDING,
]);
assert.strictEqual(EXECUTION_WORKSPACE_REQUIRED_GUARANTEES.length > 0, true);

const probe = createProcessSupervisorProbeResult({
  state: PROCESS_SUPERVISOR_STATES.ENFORCED,
  guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
});
assert.strictEqual(probe.state, 'enforced');
assert.strictEqual(Object.isFrozen(probe), true);
assert.strictEqual(Object.isFrozen(probe.guarantees), true);
assert.throws(() => createProcessSupervisorProbeResult({
  state: PROCESS_SUPERVISOR_STATES.ENFORCED,
  guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES.slice(0, -1),
}), /guarantee/i);

const execRequest = executionRequest();
assert.strictEqual(execRequest.version, PROCESS_SUPERVISOR_EXEC_REQUEST_VERSION);
assert.deepStrictEqual(Reflect.ownKeys(execRequest), [
  'version',
  'executionId',
  'jobId',
  'workspaceLeaseId',
  'workspaceAuthorityDigest',
  'workspaceRootIdentityDigest',
  'sandboxRequest',
]);
assert.strictEqual(execRequest.executionId, 'process-execution-a');
assert.strictEqual(execRequest.jobId, 'job-a');
assert.strictEqual(Object.isFrozen(execRequest), true);
assert.strictEqual(Object.isFrozen(execRequest.sandboxRequest), true);

const sourceAuthority = workspaceAuthority();
assert.throws(() => createProcessSupervisorExecRequest({
  workspaceLease: sourceAuthority.lease,
  sandboxRequest: createSandboxExecutionRequest({
    executionId: 'source-root-process',
    requestId: 'source-root-request',
    grantId: 'source-root-grant',
    rootPath: sourceAuthority.request.binding.canonicalRootPath,
    realRootPath: sourceAuthority.request.binding.realRootPath,
    command: { kind: 'executable', executable: 'npm', args: ['test'] },
  }),
}), /workspace|root/i);
assert.throws(() => executionRequest({ tempRoots: ['/private/tmp/faber-job-a'] }), /external|root/i);
assert.throws(() => executionRequest({ cacheRoots: ['/private/tmp/faber-cache-a'] }), /external|root/i);
const customPrototypeSandbox = Object.freeze(Object.assign(
  Object.create({ inheritedAuthority: true }),
  execRequest.sandboxRequest
));
assert.throws(() => createProcessSupervisorExecRequest({
  workspaceLease: sourceAuthority.lease,
  sandboxRequest: customPrototypeSandbox,
}), /sandbox|data/i);

const runningReceipt = createProcessSupervisorExecReceipt({
  request: execRequest,
  status: 'running',
  revision: 1,
  availableFromCursor: 0,
  outputCursor: 0,
});
assert.strictEqual(runningReceipt.version, PROCESS_SUPERVISOR_EXEC_RECEIPT_VERSION);
assert.deepStrictEqual(assertProcessSupervisorExecReceipt(runningReceipt, execRequest), runningReceipt);
assert.strictEqual(runningReceipt.exitCode, null);
assert.strictEqual(runningReceipt.signal, null);

const readRequest = createProcessSupervisorReadRequest({
  request: execRequest,
  cursor: 0,
  maxBytes: 32,
});
const readResult = createProcessSupervisorReadResult({
  request: readRequest,
  status: 'running',
  revision: 2,
  availableFromCursor: 0,
  outputCursor: 5,
  chunks: [{ startCursor: 0, endCursor: 5, stream: 'stdout', text: 'hello' }],
  eof: false,
});
assert.strictEqual(readResult.version, PROCESS_SUPERVISOR_READ_RESULT_VERSION);
assert.strictEqual(readResult.nextCursor, 5);
assert.strictEqual(readResult.truncated, false);
assert.strictEqual(readResult.exitCode, null);
assert.strictEqual(readResult.signal, null);
assert.strictEqual(readResult.timedOut, false);
assert.strictEqual(readResult.stopped, false);
assert.strictEqual(Object.isFrozen(readResult.chunks), true);
assert.strictEqual(Object.isFrozen(readResult.chunks[0]), true);
assert.deepStrictEqual(assertProcessSupervisorReadResult(readResult, readRequest), readResult);

const expiredReadRequest = createProcessSupervisorReadRequest({
  request: execRequest,
  cursor: 0,
  maxBytes: 32,
});
const expiredRead = createProcessSupervisorReadResult({
  request: expiredReadRequest,
  status: 'running',
  revision: 3,
  availableFromCursor: 4,
  outputCursor: 6,
  chunks: [{ startCursor: 4, endCursor: 6, stream: 'stderr', text: 'é' }],
  eof: false,
});
assert.strictEqual(expiredRead.truncated, true);
assert.strictEqual(expiredRead.nextCursor, 6);

for (const invalidRead of [
  { chunks: [{ startCursor: 1, endCursor: 6, stream: 'stdout', text: 'hello' }] },
  { chunks: [{ startCursor: 0, endCursor: 4, stream: 'stdout', text: 'hello' }] },
  { chunks: [{ startCursor: 0, endCursor: 5, stream: 'unknown', text: 'hello' }] },
  { outputCursor: 4 },
  { eof: true },
]) {
  assert.throws(() => createProcessSupervisorReadResult({
    request: readRequest,
    status: 'running',
    revision: 2,
    availableFromCursor: 0,
    outputCursor: 5,
    chunks: [{ startCursor: 0, endCursor: 5, stream: 'stdout', text: 'hello' }],
    eof: false,
    ...invalidRead,
  }), /output|cursor|stream|eof/i);
}

const waitRequest = createProcessSupervisorWaitRequest({
  request: execRequest,
  afterRevision: 1,
  timeoutMs: 500,
});
const waitResult = createProcessSupervisorWaitResult({
  request: waitRequest,
  status: 'succeeded',
  revision: 2,
  changed: true,
  exitCode: 0,
  availableFromCursor: 0,
  outputCursor: 5,
});
assert.deepStrictEqual(assertProcessSupervisorWaitResult(waitResult, waitRequest), waitResult);
assert.strictEqual(waitResult.status, 'succeeded');
assert.throws(() => createProcessSupervisorWaitResult({
  request: waitRequest,
  status: 'running',
  revision: 1,
  changed: true,
  availableFromCursor: 0,
  outputCursor: 0,
}), /revision|changed/i);

const stopRequest = createProcessSupervisorStopRequest({
  request: execRequest,
  expectedRevision: 2,
  reasonCode: 'USER_CANCELLED',
});
const stopReceipt = createProcessSupervisorStopReceipt({
  request: stopRequest,
  status: 'stopped',
  revision: 3,
  signal: 'SIGTERM',
  stopped: true,
  availableFromCursor: 0,
  outputCursor: 5,
  treeTerminated: true,
  idempotent: false,
});
assert.strictEqual(stopReceipt.version, PROCESS_SUPERVISOR_STOP_RECEIPT_VERSION);
assert.deepStrictEqual(assertProcessSupervisorStopReceipt(stopReceipt, stopRequest), stopReceipt);
assert.throws(() => createProcessSupervisorStopReceipt({
  request: stopRequest,
  status: 'stopped',
  revision: 3,
  signal: 'SIGTERM',
  stopped: true,
  availableFromCursor: 0,
  outputCursor: 5,
  treeTerminated: false,
  idempotent: false,
}), /tree/i);

const disposeReceipt = createProcessSupervisorDisposeReceipt({ orphaned: 0 });
assert.deepStrictEqual(disposeReceipt, { ok: true, disposed: true, orphaned: 0 });
assert.throws(() => createProcessSupervisorDisposeReceipt({ orphaned: 1 }), /orphan/i);

const backend = Object.freeze({
  version: PROCESS_SUPERVISOR_BACKEND_VERSION,
  id: 'portable-process-helper',
  probe() { return probe; },
  exec() { return runningReceipt; },
  read() { return readResult; },
  wait() { return waitResult; },
  stop() { return stopReceipt; },
  dispose() { return disposeReceipt; },
});
assert.strictEqual(assertProcessSupervisorBackend(backend), backend);
assert.throws(() => assertProcessSupervisorBackend({ ...backend, extra: true }), /backend/i);
assert.throws(() => assertProcessSupervisorBackend(new Proxy(backend, {})), /backend/i);

let getterCalls = 0;
const accessorRequest = {};
Object.defineProperty(accessorRequest, 'workspaceLease', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return sourceAuthority.lease;
  },
});
assert.throws(() => createProcessSupervisorExecRequest(accessorRequest), /request|data/i);
assert.strictEqual(getterCalls, 0);
assert.throws(() => createProcessSupervisorExecRequest(new Proxy({
  workspaceLease: sourceAuthority.lease,
  sandboxRequest: execRequest.sandboxRequest,
}, {})), /request|data/i);

async function main() {
  const rejected = Promise.reject(new Error('async request denied'));
  assert.throws(() => createProcessSupervisorExecRequest(rejected), /request|data/i);
  assert.throws(() => createProcessSupervisorReadRequest({
    request: execRequest,
    cursor: rejected,
    maxBytes: 32,
  }), /request|data/i);

  const unsupported = createUnsupportedProcessSupervisorBackend();
  assert.strictEqual((await unsupported.probe()).state, PROCESS_SUPERVISOR_STATES.UNAVAILABLE);
  for (const invoke of [
    () => unsupported.exec(execRequest),
    () => unsupported.read(readRequest),
    () => unsupported.wait(waitRequest),
    () => unsupported.stop(stopRequest),
  ]) {
    await assert.rejects(invoke(), (error) => (
      error instanceof ProcessSupervisorUnavailableError
        && error.code === 'PROCESS_SUPERVISOR_UNAVAILABLE'
    ));
  }
  assert.deepStrictEqual(await unsupported.dispose(), {
    ok: true,
    disposed: true,
    orphaned: 0,
  });

  await new Promise((resolve) => setImmediate(resolve));
  console.log('process supervisor contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
