'use strict';

const assert = require('assert');

const {
  PROJECT_CAPABILITY_EFFECTS,
  PROJECT_CAPABILITY_KINDS,
  createProjectCapabilityRequest,
} = require('../main/capabilities/project_capability_contracts');
const {
  CapabilityEffectClassifier,
} = require('../main/capabilities/capability_effect_classifier');
const {
  CapabilityPolicyService,
} = require('../main/capabilities/capability_policy_service');
const {
  createProjectCapabilityBroker,
} = require('../main/capabilities/project_capability_broker');
const {
  SANDBOX_COMMAND_KINDS,
  createSandboxExecutionRequest,
} = require('../main/capabilities/sandbox_backend_contract');
const {
  EXECUTION_ISOLATION_JOB_SESSION_CLOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION,
  EXECUTION_ISOLATION_JOB_SESSION_VERSION,
} = require('../main/services/execution_isolation_job_session_service');
const {
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS,
  EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
  ExecutionIsolationAuthorizedJobExecutorError,
  createExecutionIsolationAuthorizedJobExecutor,
} = require('../main/services/execution_isolation_authorized_job_executor');

const digest = (character) => `sha256:${character.repeat(64)}`;

function binding() {
  return Object.freeze({
    projectId: 'project-a',
    canonicalRootPath: '/workspace/source-project-a',
    realRootPath: '/private/workspace/source-project-a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'kernel-a',
    submissionDigest: digest('a'),
  });
}

function sandboxRequest({
  requestId = 'request-a',
  executionDigest = 'c'.repeat(64),
  grantDigest = executionDigest,
  rootPath = '/workspace/source-project-a',
  realRootPath = '/private/workspace/source-project-a',
  networkMode = 'disabled',
} = {}) {
  return createSandboxExecutionRequest({
    executionId: `sandbox-exec:${executionDigest}`,
    requestId,
    grantId: `sandbox-auth:${grantDigest}`,
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
    networkMode,
    timeoutMs: 10_000,
  });
}

function brokerContext({
  requestId = 'request-a',
  kernelId = 'kernel-a',
  sessionId = 'session-a',
  jobId = 'job-a',
  projectId = 'project-a',
  rootPath = '/workspace/source-project-a',
  realRootPath = '/private/workspace/source-project-a',
  effects = [PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE],
  requestDigest = 'c'.repeat(64),
  mutationRevision = 0,
} = {}) {
  return Object.freeze({
    requestId,
    principal: Object.freeze({ kind: 'agent', kernelId }),
    projectSession: Object.freeze({
      sessionId,
      projectId,
      rootPath,
      realRootPath,
      cwd: `${rootPath}/packages/app`,
      cwdRealPath: `${realRootPath}/packages/app`,
      jobId,
    }),
    capability: 'process',
    action: 'run',
    effects: Object.freeze([...effects]),
    requestDigest,
    mutationRevision,
  });
}

function dependencyHarness({
  denyOnAuthorityCheck = 0,
  digestOnAuthorityCheck = null,
  openDenied = false,
  closeFails = false,
  execDenied = false,
  authorityReturnsPromise = false,
  authorityRejectsPromise = false,
  openReturnsPromise = true,
  refreshDenied = false,
  deferFirstOpen = false,
  execStatus = 'running',
} = {}) {
  const jobBinding = binding();
  const state = {
    events: [],
    authorityChecks: 0,
    opens: 0,
    sessionMutationRevision: null,
    closes: 0,
    execs: 0,
    reads: 0,
    waits: 0,
    stops: 0,
    openInputs: [],
    execInputs: [],
    readInputs: [],
    waitInputs: [],
    stopInputs: [],
    receipts: [],
    releaseFirstOpen: null,
  };
  const session = Object.freeze({
    version: EXECUTION_ISOLATION_JOB_SESSION_VERSION,
    jobId: jobBinding.jobId,
    projectId: jobBinding.projectId,
    exec(input) {
      state.events.push('session:exec');
      state.execs += 1;
      state.execInputs.push(input);
      const receipt = Object.freeze({
        schemaVersion: 'test-process-receipt.v1',
        executionId: input.sandboxRequest.executionId,
        status: execStatus,
        revision: 1,
        exitCode: execStatus === 'succeeded' ? 0 : null,
        signal: null,
        timedOut: false,
        stopped: false,
        availableFromCursor: 0,
        outputCursor: 0,
      });
      state.receipts.push(receipt);
      return Promise.resolve(execDenied
        ? Object.freeze({ ok: false, code: 'PROCESS_REJECTED' })
        : Object.freeze({ ok: true, receipt }));
    },
    read(input) {
      state.events.push('session:read');
      state.reads += 1;
      state.readInputs.push(input);
      return Promise.resolve(Object.freeze({
        ok: true,
        result: Object.freeze({
          version: 'test-process-read-result.v1',
          executionId: input.executionId,
          status: 'running',
          revision: 1,
          exitCode: null,
          signal: null,
          timedOut: false,
          stopped: false,
          cursor: input.cursor,
          availableFromCursor: 0,
          nextCursor: 4,
          outputCursor: 4,
          truncated: false,
          chunks: Object.freeze([Object.freeze({
            startCursor: 0,
            endCursor: 4,
            stream: 'stdout',
            text: 'pass',
          })]),
          eof: false,
        }),
      }));
    },
    wait(input) {
      state.events.push('session:wait');
      state.waits += 1;
      state.waitInputs.push(input);
      return Promise.resolve(Object.freeze({
        ok: true,
        result: Object.freeze({
          version: 'test-process-wait-result.v1',
          executionId: input.executionId,
          status: 'succeeded',
          revision: input.afterRevision + 1,
          exitCode: 0,
          signal: null,
          timedOut: false,
          stopped: false,
          availableFromCursor: 0,
          outputCursor: 4,
          changed: true,
        }),
      }));
    },
    stop(input) {
      state.events.push('session:stop');
      state.stops += 1;
      state.stopInputs.push(input);
      return Promise.resolve(Object.freeze({
        ok: true,
        receipt: Object.freeze({
          version: 'test-process-stop-receipt.v1',
          executionId: input.executionId,
          status: 'stopped',
          revision: input.expectedRevision + 1,
          exitCode: null,
          signal: 'SIGTERM',
          timedOut: false,
          stopped: true,
          availableFromCursor: 0,
          outputCursor: 4,
          treeTerminated: true,
          idempotent: false,
        }),
      }));
    },
    diagnostics() { return Object.freeze({ state: 'active' }); },
    close() { throw new Error('executor must close through the session service'); },
  });
  const authorityService = Object.freeze({
    authorizeProjectRootLease(candidate) {
      state.authorityChecks += 1;
      state.events.push(`authority:${state.authorityChecks}`);
      if (authorityRejectsPromise) {
        return Promise.reject(new Error('unexpected async authority rejection'));
      }
      const decision = state.authorityChecks === denyOnAuthorityCheck
        ? Object.freeze({ authorized: false, reason: 'lifecycle_inactive' })
        : Object.freeze({
          authorized: true,
          reason: 'authorized',
          binding: candidate,
          physicalRootIdentityDigest: typeof digestOnAuthorityCheck === 'function'
            ? digestOnAuthorityCheck(state.authorityChecks)
            : digest('b'),
        });
      return authorityReturnsPromise ? Promise.resolve(decision) : decision;
    },
  });
  const jobSessionService = Object.freeze({
    version: EXECUTION_ISOLATION_JOB_SESSION_SERVICE_VERSION,
    open(input) {
      state.events.push('session:open');
      state.opens += 1;
      state.openInputs.push(input);
      const refreshing = state.sessionMutationRevision !== null
        && input.mutationRevision > state.sessionMutationRevision;
      const result = openDenied
        ? Object.freeze({ ok: false, code: 'SESSION_OPEN_REJECTED' })
        : refreshDenied && refreshing
        ? Object.freeze({ ok: false, code: 'WORKSPACE_ACQUIRE_FAILED' })
        : Object.freeze({ ok: true, session, idempotent: false });
      if (result.ok === true) state.sessionMutationRevision = input.mutationRevision;
      if (openReturnsPromise && deferFirstOpen && state.opens === 1) {
        return new Promise((resolve) => {
          state.releaseFirstOpen = () => resolve(result);
        });
      }
      return openReturnsPromise ? Promise.resolve(result) : result;
    },
    close(input) {
      state.events.push('session:close');
      state.closes += 1;
      assert.deepStrictEqual(input, Object.freeze({ binding: jobBinding }));
      return Promise.resolve(Object.freeze({
        version: EXECUTION_ISOLATION_JOB_SESSION_CLOSE_RECEIPT_VERSION,
        ok: !closeFails,
        closed: !closeFails,
        processesStopped: !closeFails,
        workspaceRolledBack: !closeFails,
        rootReleased: !closeFails,
      }));
    },
    diagnostics() { return Object.freeze({ state: 'ready' }); },
    dispose() { throw new Error('not used'); },
  });
  return { authorityService, jobBinding, jobSessionService, state };
}

function createExecutor(harness) {
  return createExecutionIsolationAuthorizedJobExecutor({
    binding: harness.jobBinding,
    authorityService: harness.authorityService,
    jobSessionService: harness.jobSessionService,
  });
}

async function rejectedCode(operation, expectedCode) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof ExecutionIsolationAuthorizedJobExecutorError);
    assert.strictEqual(error.code, expectedCode);
    return true;
  });
}

async function main() {
  const harness = dependencyHarness();
  const executor = createExecutor(harness);
  assert.strictEqual(Object.isFrozen(executor), true);
  assert.strictEqual(executor.version, EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION);
  assert.deepStrictEqual(Reflect.ownKeys(executor), [
    'version',
    'execute',
    'read',
    'wait',
    'stop',
    'close',
    'diagnostics',
  ]);

  const request = sandboxRequest();
  const context = brokerContext();
  const output = await executor.execute(request, context);
  assert.strictEqual(output, harness.state.receipts[0]);
  assert.deepStrictEqual(harness.state.events, [
    'authority:1',
    'session:open',
    'authority:2',
    'session:exec',
  ]);
  assert.strictEqual(harness.state.opens, 1);
  assert.deepStrictEqual(harness.state.openInputs[0], Object.freeze({
    binding: harness.jobBinding,
    sourceRootIdentityDigest: digest('b'),
    mutationRevision: 0,
  }));
  assert.deepStrictEqual(harness.state.execInputs[0], Object.freeze({
    sandboxRequest: request,
    mutationRevision: 0,
  }));
  const activeDiagnostics = executor.diagnostics();
  assert.deepStrictEqual(activeDiagnostics, Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
    state: 'active',
    jobId: 'job-a',
    projectId: 'project-a',
    authorityChecks: 2,
    executions: 1,
    reads: 0,
    waits: 0,
    stops: 0,
  }));

  const processIdentity = output.executionId;
  const readInput = Object.freeze({
    executionId: processIdentity,
    cursor: 0,
    maxBytes: 4096,
  });
  const readResult = await executor.read(readInput);
  assert.strictEqual(readResult.executionId, processIdentity);
  assert.deepStrictEqual(harness.state.readInputs, [readInput]);

  const waitInput = Object.freeze({
    executionId: processIdentity,
    afterRevision: 1,
    timeoutMs: 1000,
  });
  const waitResult = await executor.wait(waitInput);
  assert.strictEqual(waitResult.status, 'succeeded');
  assert.deepStrictEqual(harness.state.waitInputs, [waitInput]);

  const stopInput = Object.freeze({
    executionId: processIdentity,
    expectedRevision: 1,
    reasonCode: 'AGENTIC_PROCESS_STOP_REQUESTED',
  });
  const stopResult = await executor.stop(stopInput);
  assert.strictEqual(stopResult.treeTerminated, true);
  assert.deepStrictEqual(harness.state.stopInputs, [stopInput]);
  assert.deepStrictEqual(harness.state.events.slice(4), [
    'authority:3',
    'session:read',
    'authority:4',
    'session:wait',
    'authority:5',
    'session:stop',
  ]);
  assert.deepStrictEqual(executor.diagnostics(), Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
    state: 'active',
    jobId: 'job-a',
    projectId: 'project-a',
    authorityChecks: 5,
    executions: 1,
    reads: 1,
    waits: 1,
    stops: 1,
  }));
  const authorityChecksBeforeForeignRead = harness.state.authorityChecks;
  await rejectedCode(
    executor.read(Object.freeze({
      executionId: `sandbox-exec:${'d'.repeat(64)}`,
      cursor: 0,
      maxBytes: 1024,
    })),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.PROCESS_NOT_FOUND
  );
  assert.strictEqual(harness.state.authorityChecks, authorityChecksBeforeForeignRead);
  assert.strictEqual(harness.state.reads, 1);

  const closed = await executor.close();
  assert.deepStrictEqual(closed, Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_CLOSE_RECEIPT_VERSION,
    ok: true,
    closed: true,
    sessionClosed: true,
  }));
  assert.strictEqual(await executor.close(), closed);
  assert.strictEqual(harness.state.closes, 1);
  assert.strictEqual(executor.diagnostics().state, 'closed');
  await rejectedCode(
    executor.execute(request, context),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED
  );
  await rejectedCode(
    executor.read(readInput),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLOSED
  );

  const integratedHarness = dependencyHarness();
  const integratedExecutor = createExecutor(integratedHarness);
  let directBackendExecutions = 0;
  const integratedBroker = createProjectCapabilityBroker({
    authorizeProjectSession: async (projectSession) => Object.freeze({
      authorized: true,
      projectSession,
    }),
    authorizeProjectEffect: (projectSession) => Object.freeze({
      authorized: true,
      projectSession,
    }),
    descriptorResolver: Object.freeze({
      resolve() {
        return Object.freeze({
          capability: 'process',
          action: 'run',
          version: 'integrated-process.v1',
          kind: PROJECT_CAPABILITY_KINDS.PROCESS,
          effects: Object.freeze([PROJECT_CAPABILITY_EFFECTS.PROCESS_EXECUTE]),
          createSandboxExecutionSpec(payload) {
            return Object.freeze({
              command: Object.freeze({
                kind: SANDBOX_COMMAND_KINDS.EXECUTABLE,
                executable: payload.command,
                args: Object.freeze([...payload.args]),
              }),
            });
          },
        });
      },
    }),
    classifier: new CapabilityEffectClassifier(),
    policy: new CapabilityPolicyService(),
    grantStore: Object.freeze({
      inspect() { return Object.freeze({ authorized: false, reason: 'not_found' }); },
      consume() { return Object.freeze({ authorized: false, reason: 'not_found' }); },
    }),
    pendingApprovalStore: Object.freeze({
      create() { throw new Error('approval is not expected'); },
      resolve() { throw new Error('approval is not expected'); },
    }),
    approvalReviewer: Object.freeze({
      verifyDecision() { return Object.freeze({ verified: false }); },
    }),
    sandboxRegistry: Object.freeze({
      select() {
        return Promise.resolve(Object.freeze({
          backend: Object.freeze({
            id: 'selection-proof-only',
            execute() {
              directBackendExecutions += 1;
              return Object.freeze({ status: 'bypassed' });
            },
          }),
          probe: Object.freeze({
            state: 'enforced',
            features: Object.freeze([
              'filesystem_scope',
              'network_isolation',
              'process_execute',
              'process_tree_termination',
            ]),
          }),
        }));
      },
    }),
    sandboxExecutor: integratedExecutor,
    buildSandboxEnvironment: async () => Object.freeze({ NODE_ENV: 'test' }),
    audit: Object.freeze({ record() {} }),
    now: () => Date.now(),
  });
  const integratedRequest = createProjectCapabilityRequest({
    requestId: 'request-integrated',
    principal: { kind: 'agent', kernelId: 'kernel-a' },
    projectSession: {
      sessionId: 'session-a',
      projectId: 'project-a',
      rootPath: '/workspace/source-project-a',
      realRootPath: '/private/workspace/source-project-a',
      cwd: '/workspace/source-project-a/packages/app',
      cwdRealPath: '/private/workspace/source-project-a/packages/app',
      jobId: 'job-a',
    },
    capability: 'process',
    action: 'run',
    payload: { command: 'npm', args: ['test'] },
    context: { origin: 'assistant_execution' },
  });
  const integratedResult = await integratedBroker.execute(integratedRequest);
  assert.strictEqual(integratedResult.status, 'completed');
  assert.deepStrictEqual(integratedResult.output, integratedHarness.state.receipts[0]);
  assert.strictEqual(directBackendExecutions, 0);
  assert.strictEqual(integratedHarness.state.execs, 1);
  assert.strictEqual(integratedHarness.state.authorityChecks, 2);
  assert.strictEqual((await integratedExecutor.close()).ok, true);

  const invalidContextHarness = dependencyHarness();
  const invalidContextExecutor = createExecutor(invalidContextHarness);
  await rejectedCode(
    invalidContextExecutor.execute(sandboxRequest(), brokerContext({ kernelId: 'other' })),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.BROKER_REQUEST_INVALID
  );
  await rejectedCode(
    invalidContextExecutor.execute(
      sandboxRequest({ grantDigest: 'd'.repeat(64) }),
      brokerContext()
    ),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.BROKER_REQUEST_INVALID
  );
  await rejectedCode(
    invalidContextExecutor.execute(
      sandboxRequest(),
      brokerContext({ requestDigest: 'd'.repeat(64) })
    ),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.BROKER_REQUEST_INVALID
  );
  await rejectedCode(
    invalidContextExecutor.execute(
      sandboxRequest({ networkMode: 'broker_approved' }),
      brokerContext()
    ),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.BROKER_REQUEST_INVALID
  );
  assert.strictEqual(invalidContextHarness.state.authorityChecks, 0);
  assert.strictEqual(invalidContextHarness.state.opens, 0);
  await rejectedCode(
    invalidContextExecutor.execute(
      sandboxRequest(),
      brokerContext({ mutationRevision: -1 })
    ),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.BROKER_REQUEST_INVALID
  );

  const refreshHarness = dependencyHarness({ execStatus: 'succeeded' });
  const refreshExecutor = createExecutor(refreshHarness);
  await refreshExecutor.execute(sandboxRequest(), brokerContext());
  const refreshedRequest = sandboxRequest({
    requestId: 'request-refresh',
    executionDigest: 'd'.repeat(64),
  });
  const refreshedContext = brokerContext({
    requestId: 'request-refresh',
    requestDigest: 'd'.repeat(64),
    mutationRevision: 1,
  });
  const refreshedOutput = await refreshExecutor.execute(
    refreshedRequest,
    refreshedContext
  );
  assert.strictEqual(refreshedOutput.status, 'succeeded');
  assert.strictEqual(refreshHarness.state.opens, 2);
  assert.deepStrictEqual(refreshHarness.state.openInputs[1], Object.freeze({
    binding: refreshHarness.jobBinding,
    sourceRootIdentityDigest: digest('b'),
    mutationRevision: 1,
  }));
  assert.deepStrictEqual(refreshHarness.state.execInputs[1], Object.freeze({
    sandboxRequest: refreshedRequest,
    mutationRevision: 1,
  }));
  assert.deepStrictEqual(refreshHarness.state.events, [
    'authority:1',
    'session:open',
    'authority:2',
    'session:exec',
    'authority:3',
    'session:open',
    'authority:4',
    'session:exec',
  ]);
  await rejectedCode(
    refreshExecutor.execute(
      sandboxRequest({
        requestId: 'request-stale-revision',
        executionDigest: 'f'.repeat(64),
      }),
      brokerContext({
        requestId: 'request-stale-revision',
        requestDigest: 'f'.repeat(64),
        mutationRevision: 0,
      })
    ),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.MUTATION_REVISION_MISMATCH
  );
  assert.strictEqual(refreshHarness.state.execs, 2);
  assert.strictEqual((await refreshExecutor.close()).ok, true);

  const refreshFailureHarness = dependencyHarness({
    execStatus: 'succeeded',
    refreshDenied: true,
  });
  const refreshFailureExecutor = createExecutor(refreshFailureHarness);
  await refreshFailureExecutor.execute(sandboxRequest(), brokerContext());
  await rejectedCode(
    refreshFailureExecutor.execute(refreshedRequest, refreshedContext),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_REFRESH_FAILED
  );
  assert.strictEqual(refreshFailureHarness.state.execs, 1);
  await rejectedCode(
    refreshFailureExecutor.execute(
      sandboxRequest({
        requestId: 'request-after-refresh-failure',
        executionDigest: 'e'.repeat(64),
      }),
      brokerContext({
        requestId: 'request-after-refresh-failure',
        requestDigest: 'e'.repeat(64),
        mutationRevision: 0,
      })
    ),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_REFRESH_FAILED
  );
  assert.strictEqual(refreshFailureHarness.state.execs, 1);

  const concurrentRevisionHarness = dependencyHarness({
    deferFirstOpen: true,
    execStatus: 'succeeded',
  });
  const concurrentRevisionExecutor = createExecutor(concurrentRevisionHarness);
  const revisionZeroExecution = concurrentRevisionExecutor.execute(
    sandboxRequest(),
    brokerContext()
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(typeof concurrentRevisionHarness.state.releaseFirstOpen, 'function');
  const revisionOneExecution = concurrentRevisionExecutor.execute(
    refreshedRequest,
    refreshedContext
  );
  concurrentRevisionHarness.state.releaseFirstOpen();
  assert.strictEqual((await revisionZeroExecution).status, 'succeeded');
  assert.strictEqual((await revisionOneExecution).status, 'succeeded');
  assert.deepStrictEqual(
    concurrentRevisionHarness.state.openInputs.map((input) => input.mutationRevision),
    [0, 1]
  );
  assert.deepStrictEqual(
    concurrentRevisionHarness.state.execInputs.map((input) => input.mutationRevision),
    [0, 1]
  );
  assert.strictEqual((await concurrentRevisionExecutor.close()).ok, true);

  const mutableContext = { ...brokerContext() };
  await rejectedCode(
    invalidContextExecutor.execute(sandboxRequest(), mutableContext),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.BROKER_REQUEST_INVALID
  );

  const deniedHarness = dependencyHarness({ denyOnAuthorityCheck: 1 });
  const deniedExecutor = createExecutor(deniedHarness);
  await rejectedCode(
    deniedExecutor.execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
  );
  assert.deepStrictEqual(deniedHarness.state.events, ['authority:1']);
  await rejectedCode(
    deniedExecutor.execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
  );
  assert.strictEqual(deniedHarness.state.authorityChecks, 1);

  const revokedControlHarness = dependencyHarness({ denyOnAuthorityCheck: 3 });
  const revokedControlExecutor = createExecutor(revokedControlHarness);
  const revokedControlReceipt = await revokedControlExecutor.execute(
    sandboxRequest(),
    brokerContext()
  );
  await rejectedCode(
    revokedControlExecutor.read(Object.freeze({
      executionId: revokedControlReceipt.executionId,
      cursor: 0,
      maxBytes: 1024,
    })),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
  );
  assert.deepStrictEqual(revokedControlHarness.state.events, [
    'authority:1',
    'session:open',
    'authority:2',
    'session:exec',
    'authority:3',
    'session:close',
  ]);
  assert.strictEqual(revokedControlHarness.state.reads, 0);

  const asyncAuthorityHarness = dependencyHarness({ authorityReturnsPromise: true });
  await rejectedCode(
    createExecutor(asyncAuthorityHarness).execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
  );
  assert.strictEqual(asyncAuthorityHarness.state.opens, 0);

  const rejectedAuthorityHarness = dependencyHarness({ authorityRejectsPromise: true });
  await rejectedCode(
    createExecutor(rejectedAuthorityHarness).execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(rejectedAuthorityHarness.state.opens, 0);

  const revokedHarness = dependencyHarness({ denyOnAuthorityCheck: 2 });
  await rejectedCode(
    createExecutor(revokedHarness).execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
  );
  assert.deepStrictEqual(revokedHarness.state.events, [
    'authority:1',
    'session:open',
    'authority:2',
    'session:close',
  ]);
  assert.strictEqual(revokedHarness.state.execs, 0);

  const changedRootHarness = dependencyHarness({
    digestOnAuthorityCheck(check) {
      return check === 1 ? digest('b') : digest('d');
    },
  });
  await rejectedCode(
    createExecutor(changedRootHarness).execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.AUTHORITY_DENIED
  );
  assert.strictEqual(changedRootHarness.state.closes, 1);
  assert.strictEqual(changedRootHarness.state.execs, 0);

  const cleanupFailureHarness = dependencyHarness({
    denyOnAuthorityCheck: 2,
    closeFails: true,
  });
  const cleanupFailureExecutor = createExecutor(cleanupFailureHarness);
  await rejectedCode(
    cleanupFailureExecutor.execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.CLEANUP_FAILED
  );
  assert.strictEqual(cleanupFailureExecutor.diagnostics().state, 'quarantined');

  const openFailureHarness = dependencyHarness({ openDenied: true });
  await rejectedCode(
    createExecutor(openFailureHarness).execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_OPEN_FAILED
  );
  assert.strictEqual(openFailureHarness.state.execs, 0);

  const syncOpenHarness = dependencyHarness({ openReturnsPromise: false });
  await rejectedCode(
    createExecutor(syncOpenHarness).execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.SESSION_OPEN_FAILED
  );
  assert.strictEqual(syncOpenHarness.state.execs, 0);

  const execFailureHarness = dependencyHarness({ execDenied: true });
  const execFailureExecutor = createExecutor(execFailureHarness);
  await rejectedCode(
    execFailureExecutor.execute(sandboxRequest(), brokerContext()),
    EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_REASONS.EXECUTION_FAILED
  );
  assert.strictEqual(execFailureExecutor.diagnostics().state, 'active');
  assert.strictEqual((await execFailureExecutor.close()).ok, true);

  assert.throws(() => createExecutionIsolationAuthorizedJobExecutor({
    binding: binding(),
    authorityService: {
      authorizeProjectRootLease() { return null; },
    },
    jobSessionService: dependencyHarness().jobSessionService,
  }), TypeError);
  assert.throws(() => createExecutionIsolationAuthorizedJobExecutor({
    binding: binding(),
    authorityService: dependencyHarness().authorityService,
    jobSessionService: {
      ...dependencyHarness().jobSessionService,
    },
  }), TypeError);

  const neverOpenedHarness = dependencyHarness();
  const neverOpenedExecutor = createExecutor(neverOpenedHarness);
  const neverOpenedClose = await neverOpenedExecutor.close();
  assert.strictEqual(neverOpenedClose.ok, true);
  assert.strictEqual(neverOpenedClose.sessionClosed, false);
  assert.strictEqual(neverOpenedHarness.state.closes, 0);

  console.log('execution isolation authorized job executor tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
