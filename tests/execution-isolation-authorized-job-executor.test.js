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
} = {}) {
  const jobBinding = binding();
  const state = {
    events: [],
    authorityChecks: 0,
    opens: 0,
    closes: 0,
    execs: 0,
    openInputs: [],
    execInputs: [],
  };
  const receipt = Object.freeze({
    schemaVersion: 'test-process-receipt.v1',
    status: 'running',
    revision: 1,
  });
  const session = Object.freeze({
    version: EXECUTION_ISOLATION_JOB_SESSION_VERSION,
    jobId: jobBinding.jobId,
    projectId: jobBinding.projectId,
    exec(input) {
      state.events.push('session:exec');
      state.execs += 1;
      state.execInputs.push(input);
      return Promise.resolve(execDenied
        ? Object.freeze({ ok: false, code: 'PROCESS_REJECTED' })
        : Object.freeze({ ok: true, receipt }));
    },
    read() { throw new Error('not used'); },
    wait() { throw new Error('not used'); },
    stop() { throw new Error('not used'); },
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
      const result = openDenied
        ? Object.freeze({ ok: false, code: 'SESSION_OPEN_REJECTED' })
        : Object.freeze({ ok: true, session, idempotent: false });
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
  return { authorityService, jobBinding, jobSessionService, receipt, state };
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
    'close',
    'diagnostics',
  ]);

  const request = sandboxRequest();
  const context = brokerContext();
  const output = await executor.execute(request, context);
  assert.strictEqual(output, harness.receipt);
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
  }));
  assert.deepStrictEqual(harness.state.execInputs[0], Object.freeze({
    sandboxRequest: request,
  }));
  const activeDiagnostics = executor.diagnostics();
  assert.deepStrictEqual(activeDiagnostics, Object.freeze({
    version: EXECUTION_ISOLATION_AUTHORIZED_JOB_EXECUTOR_VERSION,
    state: 'active',
    jobId: 'job-a',
    projectId: 'project-a',
    authorityChecks: 2,
    executions: 1,
  }));

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
  assert.deepStrictEqual(integratedResult.output, integratedHarness.receipt);
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
