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
  PROCESS_SUPERVISOR_REASONS,
  PROCESS_SUPERVISOR_VERSION,
  createProcessSupervisor,
} = require('../main/agent_runtime/execution/process_supervisor');

const digest = (character) => `sha256:${character.repeat(64)}`;

function execRequest({ executionId = 'execution-a', jobId = 'job-a', grantId = 'grant-a' } = {}) {
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: `workspace-${executionId}`,
    binding: {
      projectId: 'project-a',
      canonicalRootPath: `/workspace/source-${jobId}`,
      realRootPath: `/private/workspace/source-${jobId}`,
      sessionId: 'session-a',
      jobId,
      kernelId: 'legacy',
      submissionDigest: digest('a'),
    },
    sourceRootIdentityDigest: digest('b'),
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: `/workspace/faber-jobs/${jobId}`,
    workspaceRealRootPath: `/private/workspace/faber-jobs/${jobId}`,
    workspaceRootIdentityDigest: digest(jobId === 'job-a' ? 'c' : 'd'),
  });
  const sandboxRequest = createSandboxExecutionRequest({
    executionId,
    requestId: `request-${executionId}`,
    grantId,
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

function backendHarness({ probeOverride = null, methodOverrides = {} } = {}) {
  const state = {
    probes: 0,
    execs: 0,
    reads: 0,
    waits: 0,
    stops: 0,
    disposals: 0,
    executions: new Map(),
  };
  const probe = createProcessSupervisorProbeResult({
    state: PROCESS_SUPERVISOR_STATES.ENFORCED,
    guarantees: PROCESS_SUPERVISOR_REQUIRED_GUARANTEES,
  });
  const backend = Object.freeze({
    version: PROCESS_SUPERVISOR_BACKEND_VERSION,
    id: 'portable-process-helper',
    probe() {
      state.probes += 1;
      return probeOverride ? probeOverride() : probe;
    },
    exec(request) {
      state.execs += 1;
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
      state.reads += 1;
      const snapshot = state.executions.get(request.executionId);
      const text = request.cursor < 5 ? 'hello'.slice(request.cursor) : '';
      const chunks = text ? [{
        startCursor: request.cursor,
        endCursor: 5,
        stream: 'stdout',
        text,
      }] : [];
      return createProcessSupervisorReadResult({
        request,
        ...snapshot,
        chunks,
        eof: snapshot.status !== 'running' && request.cursor + Buffer.byteLength(text) === 5,
      });
    },
    wait(request) {
      state.waits += 1;
      const snapshot = state.executions.get(request.executionId);
      return createProcessSupervisorWaitResult({
        request,
        ...snapshot,
        changed: snapshot.revision > request.afterRevision,
      });
    },
    stop(request) {
      state.stops += 1;
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
      state.disposals += 1;
      return createProcessSupervisorDisposeReceipt({ orphaned: 0 });
    },
    ...methodOverrides,
  });
  return { backend, state, probe };
}

async function assertRejectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

async function main() {
  const harness = backendHarness();
  const supervisor = createProcessSupervisor({
    backend: harness.backend,
    maxActiveExecutions: 2,
  });
  assert.deepStrictEqual(Reflect.ownKeys(supervisor), [
    'version', 'probe', 'exec', 'read', 'wait', 'stop', 'diagnostics', 'dispose',
  ]);
  assert.strictEqual(supervisor.version, PROCESS_SUPERVISOR_VERSION);
  assert.strictEqual(Object.isFrozen(supervisor), true);

  const requestA = execRequest();
  const firstPromise = supervisor.exec(requestA);
  const duplicatePromise = supervisor.exec(requestA);
  assert.strictEqual(firstPromise, duplicatePromise);
  const started = await firstPromise;
  assert.strictEqual(started.status, 'running');
  assert.strictEqual(harness.state.probes, 1);
  assert.strictEqual(harness.state.execs, 1);

  const readRequest = createProcessSupervisorReadRequest({
    request: requestA,
    cursor: 0,
    maxBytes: 16,
  });
  const output = await supervisor.read(readRequest);
  assert.strictEqual(output.chunks[0].text, 'hello');
  assert.strictEqual(output.nextCursor, 5);
  const waitRequest = createProcessSupervisorWaitRequest({
    request: requestA,
    afterRevision: 1,
    timeoutMs: 10,
  });
  const unchanged = await supervisor.wait(waitRequest);
  assert.strictEqual(unchanged.changed, false);
  assert.strictEqual(unchanged.status, 'running');

  const conflicting = execRequest({ executionId: 'execution-a', grantId: 'grant-forged' });
  await assertRejectCode(
    supervisor.exec(conflicting),
    PROCESS_SUPERVISOR_REASONS.EXECUTION_CONFLICT
  );
  await assertRejectCode(
    supervisor.exec(execRequest({ executionId: 'execution-job-a-second', jobId: 'job-a' })),
    PROCESS_SUPERVISOR_REASONS.JOB_BUSY
  );

  const forgedRead = Object.freeze({
    ...readRequest,
    workspaceAuthorityDigest: digest('f'),
  });
  await assertRejectCode(
    supervisor.read(forgedRead),
    PROCESS_SUPERVISOR_REASONS.AUTHORITY_MISMATCH
  );
  assert.strictEqual(harness.state.reads, 1);

  const stopRequest = createProcessSupervisorStopRequest({
    request: requestA,
    expectedRevision: 1,
    reasonCode: 'USER_CANCELLED',
  });
  const stopped = await supervisor.stop(stopRequest);
  assert.strictEqual(stopped.status, 'stopped');
  assert.strictEqual(stopped.treeTerminated, true);
  const terminal = await supervisor.wait(createProcessSupervisorWaitRequest({
    request: requestA,
    afterRevision: 1,
    timeoutMs: 10,
  }));
  assert.strictEqual(terminal.changed, true);
  assert.strictEqual(terminal.status, 'stopped');

  const requestB = execRequest({ executionId: 'execution-b', jobId: 'job-b' });
  await supervisor.exec(requestB);
  const diagnosticsBeforeDispose = supervisor.diagnostics();
  assert.deepStrictEqual(Reflect.ownKeys(diagnosticsBeforeDispose), [
    'version',
    'backendState',
    'disposed',
    'starting',
    'running',
    'terminal',
    'quarantined',
    'maxActiveExecutions',
  ]);
  assert.strictEqual(diagnosticsBeforeDispose.running, 1);
  assert.strictEqual(JSON.stringify(diagnosticsBeforeDispose).includes('/workspace/'), false);
  assert.strictEqual(JSON.stringify(diagnosticsBeforeDispose).includes('npm'), false);

  const disposed = await supervisor.dispose();
  assert.deepStrictEqual(disposed, {
    ok: true,
    disposed: true,
    quarantined: 0,
    orphaned: 0,
  });
  assert.strictEqual(harness.state.stops, 2);
  assert.strictEqual(harness.state.disposals, 1);
  assert.deepStrictEqual(await supervisor.dispose(), disposed);
  await assertRejectCode(
    supervisor.exec(execRequest({ executionId: 'execution-after-dispose', jobId: 'job-c' })),
    PROCESS_SUPERVISOR_REASONS.DISPOSED
  );

  const unsupported = createProcessSupervisor();
  const unsupportedProbe = await unsupported.probe();
  assert.strictEqual(unsupportedProbe.state, PROCESS_SUPERVISOR_STATES.UNAVAILABLE);
  await assertRejectCode(
    unsupported.exec(execRequest({ executionId: 'unsupported', jobId: 'job-u' })),
    PROCESS_SUPERVISOR_REASONS.UNAVAILABLE
  );
  assert.deepStrictEqual(await unsupported.dispose(), {
    ok: true,
    disposed: true,
    quarantined: 0,
    orphaned: 0,
  });

  const capacityHarness = backendHarness();
  const capacitySupervisor = createProcessSupervisor({
    backend: capacityHarness.backend,
    maxActiveExecutions: 1,
  });
  await capacitySupervisor.exec(execRequest({ executionId: 'capacity-a', jobId: 'job-cap-a' }));
  await assertRejectCode(
    capacitySupervisor.exec(execRequest({ executionId: 'capacity-b', jobId: 'job-cap-b' })),
    PROCESS_SUPERVISOR_REASONS.CAPACITY_EXCEEDED
  );
  await capacitySupervisor.dispose();

  const invalidOutputHarness = backendHarness({
    methodOverrides: {
      exec(request) {
        invalidOutputHarness.state.execs += 1;
        return Promise.resolve({ executionId: request.executionId, status: 'running' });
      },
    },
  });
  const invalidOutputSupervisor = createProcessSupervisor({
    backend: invalidOutputHarness.backend,
  });
  await assertRejectCode(
    invalidOutputSupervisor.exec(execRequest({ executionId: 'invalid-output', jobId: 'job-invalid' })),
    PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED
  );
  assert.strictEqual(invalidOutputSupervisor.diagnostics().quarantined, 1);
  assert.deepStrictEqual(await invalidOutputSupervisor.dispose(), {
    ok: false,
    disposed: true,
    quarantined: 1,
    orphaned: 0,
  });
  assert.strictEqual(invalidOutputHarness.state.disposals, 1);

  const regressionHarness = backendHarness({
    methodOverrides: {
      exec(request) {
        regressionHarness.state.execs += 1;
        const snapshot = {
          status: 'running',
          revision: 2,
          exitCode: null,
          signal: null,
          timedOut: false,
          stopped: false,
          availableFromCursor: 0,
          outputCursor: 0,
        };
        regressionHarness.state.executions.set(request.executionId, snapshot);
        return createProcessSupervisorExecReceipt({ request, ...snapshot });
      },
      read(request) {
        regressionHarness.state.reads += 1;
        return createProcessSupervisorReadResult({
          request,
          status: 'running',
          revision: 1,
          availableFromCursor: 0,
          outputCursor: 0,
          chunks: [],
          eof: false,
        });
      },
    },
  });
  const regressionSupervisor = createProcessSupervisor({ backend: regressionHarness.backend });
  const regressionExec = execRequest({ executionId: 'regression', jobId: 'job-regression' });
  await regressionSupervisor.exec(regressionExec);
  await assertRejectCode(regressionSupervisor.read(createProcessSupervisorReadRequest({
    request: regressionExec,
    cursor: 0,
    maxBytes: 16,
  })), PROCESS_SUPERVISOR_REASONS.STATE_REGRESSION);
  assert.strictEqual(regressionSupervisor.diagnostics().quarantined, 1);
  await regressionSupervisor.dispose();

  let reentrantPromise = null;
  let reentrantSupervisor = null;
  const reentrantHarness = backendHarness({
    methodOverrides: {
      exec(request) {
        reentrantHarness.state.execs += 1;
        reentrantPromise = reentrantSupervisor.read(createProcessSupervisorReadRequest({
          request,
          cursor: 0,
          maxBytes: 16,
        }));
        const snapshot = {
          status: 'running',
          revision: 1,
          availableFromCursor: 0,
          outputCursor: 0,
        };
        reentrantHarness.state.executions.set(request.executionId, {
          ...snapshot,
          exitCode: null,
          signal: null,
          timedOut: false,
          stopped: false,
        });
        return createProcessSupervisorExecReceipt({ request, ...snapshot });
      },
    },
  });
  reentrantSupervisor = createProcessSupervisor({ backend: reentrantHarness.backend });
  await reentrantSupervisor.exec(execRequest({ executionId: 'reentrant', jobId: 'job-reentrant' }));
  await assertRejectCode(reentrantPromise, PROCESS_SUPERVISOR_REASONS.REENTRANT_CALL);
  await reentrantSupervisor.dispose();

  assert.throws(() => createProcessSupervisor({
    backend: harness.backend,
    extra: true,
  }), /options/i);
  assert.throws(() => createProcessSupervisor({
    backend: new Proxy(harness.backend, {}),
  }), /backend|options/i);
  assert.throws(() => createProcessSupervisor(Promise.resolve({ backend: harness.backend })), /options/i);

  const rejectedProviderHarness = backendHarness({
    methodOverrides: {
      exec() { return Promise.reject(new Error('/private/secret/provider')); },
    },
  });
  const rejectedProviderSupervisor = createProcessSupervisor({
    backend: rejectedProviderHarness.backend,
  });
  await assertRejectCode(
    rejectedProviderSupervisor.exec(execRequest({
      executionId: 'rejected-provider',
      jobId: 'job-rejected-provider',
    })),
    PROCESS_SUPERVISOR_REASONS.BACKEND_REJECTED
  );

  await new Promise((resolve) => setImmediate(resolve));
  console.log('process supervisor tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
