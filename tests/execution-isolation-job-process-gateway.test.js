'use strict';

const assert = require('assert');

const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  SANDBOX_COMMAND_KINDS,
  createSandboxExecutionRequest,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  PROCESS_SUPERVISOR_BACKEND_VERSION,
  PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  PROCESS_SUPERVISOR_STATES,
  createProcessSupervisorDisposeReceipt,
  createProcessSupervisorExecReceipt,
  createProcessSupervisorProbeResult,
  createProcessSupervisorReadResult,
  createProcessSupervisorStopReceipt,
  createProcessSupervisorWaitResult,
} = require('../main/capabilities/process_supervisor_contract');
const {
  createProcessSupervisor,
} = require('../main/agent_runtime/execution/process_supervisor');
const {
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_DISPOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS,
  EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_VERSION,
  createExecutionIsolationJobProcessGateway,
} = require('../main/services/execution_isolation_job_process_gateway');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding(jobId = 'job-a') {
  return Object.freeze({
    projectId: 'project-a',
    canonicalRootPath: '/workspace/source-project-a',
    realRootPath: '/private/workspace/source-project-a',
    sessionId: 'session-a',
    jobId,
    kernelId: 'legacy',
    submissionDigest: digest('a'),
  });
}

function workspaceLease(jobBinding = binding()) {
  const request = createExecutionWorkspaceAcquireRequest({
    leaseId: `workspace-${jobBinding.jobId}`,
    binding: jobBinding,
    sourceRootIdentityDigest: digest('b'),
  });
  return createExecutionWorkspaceLease({
    request,
    workspaceRootPath: `/workspace/faber-jobs/${jobBinding.jobId}`,
    workspaceRealRootPath: `/private/workspace/faber-jobs/${jobBinding.jobId}`,
    workspaceRootIdentityDigest: digest('c'),
  });
}

function sourceSandboxRequest({
  executionId = 'execution-a',
  grantId = 'grant-a',
  rootPath = '/workspace/source-project-a',
  realRootPath = '/private/workspace/source-project-a',
} = {}) {
  return createSandboxExecutionRequest({
    executionId,
    requestId: `request-${executionId}`,
    grantId,
    rootPath,
    realRootPath,
    cwd: `${rootPath}/packages/app`,
    cwdRealPath: `${realRootPath}/packages/app`,
    command: {
      kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
      executable: 'npm',
      args: ['test'],
    },
    env: { NODE_ENV: 'test' },
    timeoutMs: 10_000,
  });
}

function backendHarness({ stopFails = false } = {}) {
  const state = {
    events: [],
    execRequests: [],
    executions: new Map(),
    reads: 0,
    waits: 0,
    stops: 0,
  };
  const backend = Object.freeze({
    version: PROCESS_SUPERVISOR_BACKEND_VERSION,
    id: 'portable-process-helper',
    probe() {
      state.events.push('probe');
      return createProcessSupervisorProbeResult({
        state: PROCESS_SUPERVISOR_STATES.ENFORCED,
        guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
      });
    },
    exec(request) {
      state.events.push(`exec:${request.executionId}`);
      state.execRequests.push(request);
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
      state.executions.set(request.executionId, snapshot);
      return createProcessSupervisorExecReceipt({ request, ...snapshot });
    },
    read(request) {
      state.events.push(`read:${request.executionId}`);
      state.reads += 1;
      const snapshot = state.executions.get(request.executionId);
      const text = request.cursor < 5 ? 'hello'.slice(request.cursor) : '';
      return createProcessSupervisorReadResult({
        request,
        ...snapshot,
        chunks: text ? [{
          startCursor: request.cursor,
          endCursor: request.cursor + Buffer.byteLength(text),
          stream: 'stdout',
          text,
        }] : [],
        eof: snapshot.status !== 'running'
          && request.cursor + Buffer.byteLength(text) === snapshot.outputCursor,
      });
    },
    wait(request) {
      state.events.push(`wait:${request.executionId}`);
      state.waits += 1;
      const snapshot = state.executions.get(request.executionId);
      return createProcessSupervisorWaitResult({
        request,
        ...snapshot,
        changed: snapshot.revision > request.afterRevision,
      });
    },
    stop(request) {
      state.events.push(`stop:${request.executionId}`);
      state.stops += 1;
      if (stopFails) throw new Error('stop failed');
      const current = state.executions.get(request.executionId);
      const terminal = current.status !== 'running';
      const snapshot = terminal ? current : {
        ...current,
        status: 'stopped',
        revision: current.revision + 1,
        signal: 'SIGTERM',
        stopped: true,
      };
      state.executions.set(request.executionId, snapshot);
      return createProcessSupervisorStopReceipt({
        request,
        ...snapshot,
        treeTerminated: true,
        idempotent: terminal,
      });
    },
    dispose() {
      state.events.push('dispose');
      return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    },
  });
  return { backend, state };
}

function createGateway(harness, jobBinding = binding()) {
  const processSupervisor = createProcessSupervisor({ backend: harness.backend });
  const gateway = createExecutionIsolationJobProcessGateway({
    binding: jobBinding,
    workspaceLease: workspaceLease(jobBinding),
    processSupervisor,
  });
  return { gateway, processSupervisor };
}

async function main() {
  const harness = backendHarness();
  const { gateway, processSupervisor } = createGateway(harness);
  assert.strictEqual(Object.isFrozen(gateway), true);
  assert.strictEqual(gateway.version, EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_VERSION);
  assert.deepStrictEqual(Reflect.ownKeys(gateway), [
    'version',
    'exec',
    'read',
    'wait',
    'stop',
    'diagnostics',
    'dispose',
  ]);

  const sandboxRequest = sourceSandboxRequest();
  const execInput = Object.freeze({ sandboxRequest });
  const firstExecPromise = gateway.exec(execInput);
  const duplicateExecPromise = gateway.exec(execInput);
  assert.strictEqual(firstExecPromise, duplicateExecPromise);
  const started = await firstExecPromise;
  assert.strictEqual(started.ok, true);
  assert.strictEqual(started.receipt.status, 'running');
  assert.strictEqual(harness.state.execRequests.length, 1);
  const internalRequest = harness.state.execRequests[0];
  assert.strictEqual(internalRequest.jobId, 'job-a');
  assert.strictEqual(
    internalRequest.sandboxRequest.rootPath,
    '/workspace/faber-jobs/job-a'
  );
  assert.strictEqual(
    internalRequest.sandboxRequest.realRootPath,
    '/private/workspace/faber-jobs/job-a'
  );
  assert.strictEqual(
    internalRequest.sandboxRequest.cwd,
    '/workspace/faber-jobs/job-a/packages/app'
  );
  assert.strictEqual(
    internalRequest.sandboxRequest.cwdRealPath,
    '/private/workspace/faber-jobs/job-a/packages/app'
  );
  assert.strictEqual(JSON.stringify(started).includes('/workspace/'), false);
  assert.strictEqual(JSON.stringify(started).includes('npm'), false);

  const read = await gateway.read(Object.freeze({
    executionId: 'execution-a',
    cursor: 0,
    maxBytes: 16,
  }));
  assert.strictEqual(read.ok, true);
  assert.strictEqual(read.result.chunks[0].text, 'hello');
  assert.strictEqual(read.result.nextCursor, 5);

  const wait = await gateway.wait(Object.freeze({
    executionId: 'execution-a',
    afterRevision: 1,
    timeoutMs: 10,
  }));
  assert.strictEqual(wait.ok, true);
  assert.strictEqual(wait.result.changed, false);

  const conflict = await gateway.exec(Object.freeze({
    sandboxRequest: sourceSandboxRequest({ grantId: 'grant-forged' }),
  }));
  assert.deepStrictEqual(conflict, {
    ok: false,
    code: EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.EXECUTION_MISMATCH,
  });
  assert.strictEqual(harness.state.execRequests.length, 1);

  const forgedRoot = await gateway.exec(Object.freeze({
    sandboxRequest: sourceSandboxRequest({
      executionId: 'execution-forged',
      rootPath: '/workspace/other-project',
      realRootPath: '/private/workspace/other-project',
    }),
  }));
  assert.strictEqual(
    forgedRoot.code,
    EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.INVALID_INPUT
  );
  assert.strictEqual(harness.state.execRequests.length, 1);

  const stopped = await gateway.stop(Object.freeze({
    executionId: 'execution-a',
    expectedRevision: 1,
    reasonCode: 'USER_CANCELLED',
  }));
  assert.strictEqual(stopped.ok, true);
  assert.strictEqual(stopped.receipt.status, 'stopped');
  assert.strictEqual(stopped.receipt.treeTerminated, true);
  assert.strictEqual(gateway.diagnostics().terminal, 1);
  assert.strictEqual(JSON.stringify(gateway.diagnostics()).includes('/workspace/'), false);

  const disposeReceipt = await gateway.dispose();
  assert.deepStrictEqual(disposeReceipt, {
    version: EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_DISPOSE_RECEIPT_VERSION,
    ok: true,
    disposed: true,
    active: 0,
    terminal: 1,
    quarantined: 0,
  });
  assert.strictEqual(await gateway.dispose(), disposeReceipt);
  assert.strictEqual((await gateway.read(Object.freeze({
    executionId: 'execution-a',
    cursor: 0,
    maxBytes: 16,
  }))).code, EXECUTION_ISOLATION_JOB_PROCESS_GATEWAY_REASONS.DISPOSED);
  assert.strictEqual((await processSupervisor.dispose()).ok, true);

  const autoStopHarness = backendHarness();
  const autoStopRuntime = createGateway(autoStopHarness, binding('job-b'));
  const autoStarted = await autoStopRuntime.gateway.exec(Object.freeze({
    sandboxRequest: sourceSandboxRequest({ executionId: 'execution-b' }),
  }));
  assert.strictEqual(autoStarted.ok, true);
  const autoDispose = await autoStopRuntime.gateway.dispose();
  assert.strictEqual(autoDispose.ok, true);
  assert.strictEqual(autoStopHarness.state.stops, 1);
  assert.deepStrictEqual(autoStopHarness.state.events.slice(-1), ['stop:execution-b']);
  assert.strictEqual((await autoStopRuntime.processSupervisor.dispose()).ok, true);

  const failedStopHarness = backendHarness({ stopFails: true });
  const failedStopRuntime = createGateway(failedStopHarness, binding('job-c'));
  assert.strictEqual((await failedStopRuntime.gateway.exec(Object.freeze({
    sandboxRequest: sourceSandboxRequest({ executionId: 'execution-c' }),
  }))).ok, true);
  const failedDispose = await failedStopRuntime.gateway.dispose();
  assert.strictEqual(failedDispose.ok, false);
  assert.strictEqual(failedDispose.active, 1);
  assert.strictEqual(failedDispose.quarantined, 1);
  assert.strictEqual((await failedStopRuntime.processSupervisor.dispose()).ok, false);

  assert.throws(
    () => createExecutionIsolationJobProcessGateway({
      binding: binding(),
      workspaceLease: workspaceLease(),
      processSupervisor: createProcessSupervisor({ backend: backendHarness().backend }),
      ambientAuthority: true,
    }),
    /options/i
  );

  console.log('execution isolation job process gateway tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
