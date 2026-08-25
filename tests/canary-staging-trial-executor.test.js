'use strict';

const assert = require('assert');
const { AgentKernel } = require('../main/agent_runtime/agent_kernel');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  createExecutionWorkspaceAcquireRequest,
  createExecutionWorkspaceDiscardReceipt,
  createExecutionWorkspaceDiscardRequest,
  createExecutionWorkspaceLease,
} = require('../main/capabilities/execution_workspace_contract');
const {
  classifyCanaryEditAction,
} = require('../main/agent_runtime/canary_edit_action_classifier');
const {
  evaluateCanaryEditAdmission,
} = require('../main/agent_runtime/canary_edit_admission_policy');
const {
  CANARY_EDIT_LIFECYCLE_STATES,
  CANARY_EDIT_MUTATION_FRONTIERS,
  createCanaryEditLifecycle,
} = require('../main/agent_runtime/canary_edit_lifecycle');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
  CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
  createCanaryEditRunner,
} = require('../main/agent_runtime/canary_edit_runner');
const {
  CANARY_ROLLOUT_STAGES,
  createCanaryRolloutSelector,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  createCanaryStagingDiscardReceipt,
  createCanaryStagingSession,
  createCanaryStagingWriteReceipt,
} = require('../main/agent_runtime/canary_staging_contract');
const {
  CANARY_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
  CANARY_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
  CANARY_STAGING_TRIAL_EXECUTOR_REASONS,
  CANARY_STAGING_TRIAL_EXECUTOR_VERSION,
  createCanaryStagingTrialExecutor,
} = require('../main/agent_runtime/canary_staging_trial_executor');
const {
  HARNESS_OPERATIONS,
  createExecuteRequest,
  createHarnessResult,
} = require('../main/agent_runtime/harness_contracts');

function digest(character) {
  return 'sha256:' + character.repeat(64);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function makeFixture({
  editorRejection = null,
  editorSynchronous = false,
  discardRejection = null,
  openRejection = null,
  writeReceiptOverride = null,
} = {}) {
  const events = [];
  const binding = createCapabilityDelegationBinding({
    projectId: 'project-trial-a',
    canonicalRootPath: '/workspace/project-trial-a',
    realRootPath: '/workspace/project-trial-a',
    sessionId: 'session-trial-a',
    jobId: 'job-trial-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const executionContext = {
    jobId: binding.jobId,
    requestedMode: 'delegate_task',
    signal: Object.freeze({ aborted: false }),
  };
  Object.defineProperty(executionContext, 'authorityBinding', {
    configurable: false,
    enumerable: false,
    value: binding,
    writable: false,
  });
  Object.freeze(executionContext);
  const action = deepFreeze({
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: digest('b'),
    nextContent: 'module.exports = true;\n',
  });
  const request = createExecuteRequest(
    action,
    deepFreeze({
      id: binding.projectId,
      projectId: binding.projectId,
      rootPath: binding.canonicalRootPath,
    }),
    { requestId: 'canary-staging-trial-a', executionContext }
  );
  const checkpoint = Object.freeze({
    checkpointDigest: digest('c'),
    checkpointVerified: true,
    projectId: binding.projectId,
    canonicalRootPath: binding.canonicalRootPath,
    jobId: binding.jobId,
  });
  const rootMutation = Object.freeze({
    canonicalRootPath: binding.canonicalRootPath,
    ownerJobId: binding.jobId,
    activeOtherMutatingJobs: 0,
  });
  const classification = classifyCanaryEditAction(action);
  const rolloutDecision = createCanaryRolloutSelector({
    cohortSeed: 'canary-staging-trial-tests-v1',
  }).select({
    killSwitch: false,
    configuredMode: 'canary',
    projectId: binding.projectId,
    projectPin: null,
    allowlisted: true,
    internal: true,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  });
  const admissionDecision = evaluateCanaryEditAdmission({
    runtimeMode: 'canary',
    projectAuthorization: Object.freeze({ authorized: true, binding }),
    editProfile: classification.editProfile,
    checkpoint,
    rootMutation,
  });
  const grant = Object.freeze({
    schemaVersion: CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
    requestId: request.requestId,
    actionClassification: classification,
    rolloutDecision,
    admissionDecision,
  });
  const workspaceRequest = createExecutionWorkspaceAcquireRequest({
    leaseId: 'workspace-lease-trial-a',
    binding,
    sourceRootIdentityDigest: digest('d'),
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: '/private/staging/trial-a',
    workspaceRealRootPath: '/private/staging/trial-a',
    workspaceRootIdentityDigest: digest('e'),
  });
  const session = createCanaryStagingSession({
    requestId: request.requestId,
    checkpoint,
    workspaceRequest,
    workspaceLease,
  });
  const actionDigest = digest('f');
  const defaultWriteReceipt = createCanaryStagingWriteReceipt({
    session,
    actionDigest,
    writeSetDigest: digest('1'),
    changedPaths: ['src/app.js'],
    stagingWritten: true,
    sourceMutated: false,
  });
  const workspaceDiscardRequest = createExecutionWorkspaceDiscardRequest({
    request: workspaceRequest,
    lease: workspaceLease,
  });
  const workspaceDiscardReceipt = createExecutionWorkspaceDiscardReceipt({
    request: workspaceDiscardRequest,
    discarded: true,
  });
  const discardReceipt = createCanaryStagingDiscardReceipt({
    session,
    workspaceDiscardRequest,
    workspaceDiscardReceipt,
  });

  const workspaceCalls = { open: [], discard: [] };
  const workspaceSessionPort = Object.freeze({
    version: 'canary-workspace-session-port.test.v1',
    open(harnessRequest, executionGrant) {
      workspaceCalls.open.push({ harnessRequest, executionGrant });
      events.push('open');
      if (openRejection) return Promise.reject(openRejection);
      return Promise.resolve(Object.freeze({
        schemaVersion: CANARY_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
        ok: true,
        session,
        checkpoint,
        workspaceRequest,
        actionDigest,
      }));
    },
    discard(sessionValue) {
      workspaceCalls.discard.push(sessionValue);
      events.push('discard');
      if (discardRejection) return Promise.reject(discardRejection);
      return Promise.resolve(Object.freeze({
        receipt: discardReceipt,
        workspaceDiscardRequest,
      }));
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-workspace-session-port.test.v1',
        workspaceIsolation: 'per_job_staging',
        sourceMutation: 'forbidden',
        discardMode: 'verified',
      });
    },
  });

  const editorCalls = [];
  const canaryEditor = Object.freeze({
    version: 'canary-editor.test.v1',
    kernelId: binding.kernelId,
    execute(harnessRequest, executionGrant, stagingSession) {
      editorCalls.push({ harnessRequest, executionGrant, stagingSession });
      events.push('edit');
      if (editorRejection) return Promise.reject(editorRejection);
      const outcome = Object.freeze({
        schemaVersion: CANARY_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
        ok: true,
        writeReceipt: writeReceiptOverride || defaultWriteReceipt,
      });
      return editorSynchronous ? outcome : Promise.resolve(outcome);
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-editor.test.v1',
        kernelId: binding.kernelId,
        workspaceMode: 'provided_session_only',
        sourceMutation: 'forbidden',
        settlementMode: 'terminal',
        networkMode: 'disabled',
        installMode: 'disabled',
      });
    },
  });

  return {
    actionDigest,
    binding,
    canaryEditor,
    checkpoint,
    defaultWriteReceipt,
    discardReceipt,
    editorCalls,
    events,
    grant,
    request,
    rootMutation,
    session,
    workspaceCalls,
    workspaceDiscardRequest,
    workspaceRequest,
    workspaceSessionPort,
    executor: createCanaryStagingTrialExecutor({
      kernelId: binding.kernelId,
      workspaceSessionPort,
      canaryEditor,
    }),
  };
}

async function testTrialExecutorIntegratesWithGuardedRunner() {
  const fixture = makeFixture();
  class LegacyKernel extends AgentKernel {
    constructor() {
      super({
        id: 'legacy',
        version: 'legacy.test.v1',
        capabilities: [HARNESS_OPERATIONS.EXECUTE],
      });
      this.calls = [];
    }

    async execute(request) {
      this.calls.push(request);
      return createHarnessResult({
        requestId: request.requestId,
        operation: request.operation,
        kernelId: this.id,
        output: { ok: true, engine: 'legacy-after-clean-discard' },
      });
    }
  }
  const legacyKernel = new LegacyKernel();
  const admissionFactsProvider = Object.freeze({
    version: 'trial-integration-facts.test.v1',
    inspect() {
      return deepFreeze({
        projectAuthorized: true,
        checkpoint: fixture.checkpoint,
        rootMutation: fixture.rootMutation,
        rollout: {
          killSwitch: false,
          projectPin: null,
          allowlisted: true,
          internal: true,
          rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
        },
      });
    },
  });
  const runner = createCanaryEditRunner({
    authoritativeKernel: legacyKernel,
    admissionFactsProvider,
    rolloutSelector: createCanaryRolloutSelector({
      cohortSeed: 'trial-runner-integration-v1',
    }),
    stagedCanaryExecutor: fixture.executor,
  });
  const result = await runner.execute(fixture.request);
  assert.strictEqual(result.kernelId, 'legacy');
  assert.deepStrictEqual(result.output, {
    ok: true,
    engine: 'legacy-after-clean-discard',
  });
  assert.deepStrictEqual(fixture.events, ['open', 'edit', 'discard']);
  assert.strictEqual(legacyKernel.calls.length, 1);
  assert.strictEqual(runner.diagnostics().cleanFallbacks, 1);
  assert.strictEqual(runner.diagnostics().legacyFallbacks, 1);
  assert.strictEqual(runner.diagnostics().canaryFailed, 0);
}

async function testSuccessfulTrialDiscardsBeforeFallbackSignal() {
  const fixture = makeFixture();
  const signal = await fixture.executor.execute(fixture.request, fixture.grant);
  assert.deepStrictEqual(fixture.events, ['open', 'edit', 'discard']);
  assert.strictEqual(fixture.workspaceCalls.open.length, 1);
  assert.strictEqual(fixture.editorCalls.length, 1);
  assert.strictEqual(fixture.workspaceCalls.discard.length, 1);
  assert.strictEqual(fixture.editorCalls[0].stagingSession, fixture.session);
  assert.deepStrictEqual(signal, {
    schemaVersion: CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
    status: 'fallback_ready',
    requestId: fixture.request.requestId,
    jobId: fixture.binding.jobId,
    stagingId: fixture.session.stagingId,
    mutationFrontier: CANARY_EDIT_MUTATION_FRONTIERS.STAGING,
    reason: 'promotion_unavailable',
    cleanupReceipt: fixture.discardReceipt.lifecycleReceipt,
  });
  assertDeepFrozen(signal);

  const lifecycle = createCanaryEditLifecycle({
    jobId: fixture.binding.jobId,
    stagingId: fixture.session.stagingId,
  });
  lifecycle.noteWrite({ scope: CANARY_EDIT_MUTATION_FRONTIERS.STAGING });
  lifecycle.requestFallback({ reason: signal.reason });
  assert.strictEqual(lifecycle.confirmCleanup(signal.cleanupReceipt).ok, true);
  assert.strictEqual(lifecycle.startLegacy().ok, true);
  assert.strictEqual(lifecycle.snapshot().state, CANARY_EDIT_LIFECYCLE_STATES.LEGACY_STARTED);
  assert.deepStrictEqual(fixture.executor.diagnostics(), {
    version: CANARY_STAGING_TRIAL_EXECUTOR_VERSION,
    kernelId: fixture.binding.kernelId,
    workspaceIsolation: 'per_job_staging',
    networkMode: 'disabled',
    installMode: 'disabled',
    promotionMode: 'explicit_checkpointed',
  });
}

async function testEditorFailureIsSanitizedAfterVerifiedDiscard() {
  const privateFailure = new Error('private staging path and content');
  privateFailure.code = 'PRIVATE_EDITOR_FAILURE';
  const fixture = makeFixture({ editorRejection: privateFailure });
  const signal = await fixture.executor.execute(fixture.request, fixture.grant);
  assert.strictEqual(signal.reason, 'canary_execution_failed');
  assert.strictEqual(signal.cleanupReceipt.clean, true);
  assert.deepStrictEqual(fixture.events, ['open', 'edit', 'discard']);
  assert.doesNotMatch(JSON.stringify(signal), /private staging path|content/i);

  const synchronous = makeFixture({ editorSynchronous: true });
  const synchronousSignal = await synchronous.executor.execute(
    synchronous.request,
    synchronous.grant
  );
  assert.strictEqual(synchronousSignal.reason, 'canary_execution_failed');
  assert.deepStrictEqual(synchronous.events, ['open', 'edit', 'discard']);
}

async function testInvalidWriteReceiptIsDiscardedAndCannotComplete() {
  const seed = makeFixture();
  const invalidReceipt = Object.freeze({
    ...seed.defaultWriteReceipt,
    actionDigest: digest('9'),
  });
  const fixture = makeFixture({ writeReceiptOverride: invalidReceipt });
  const signal = await fixture.executor.execute(fixture.request, fixture.grant);
  assert.strictEqual(signal.reason, 'canary_execution_failed');
  assert.deepStrictEqual(fixture.events, ['open', 'edit', 'discard']);
}

async function testAmbiguousOpenOrCleanupFailsClosed() {
  const openFailure = makeFixture({
    openRejection: new Error('private open failure'),
  });
  await assert.rejects(
    openFailure.executor.execute(openFailure.request, openFailure.grant),
    (error) => error.code === CANARY_STAGING_TRIAL_EXECUTOR_REASONS.OPEN_FAILED
      && !/private open/i.test(error.message)
  );
  assert.deepStrictEqual(openFailure.events, ['open']);

  const cleanupFailure = makeFixture({
    editorRejection: new Error('editor failed'),
    discardRejection: new Error('private discard failure'),
  });
  await assert.rejects(
    cleanupFailure.executor.execute(cleanupFailure.request, cleanupFailure.grant),
    (error) => error.code === CANARY_STAGING_TRIAL_EXECUTOR_REASONS.CLEANUP_FAILED
      && !/private discard/i.test(error.message)
  );
  assert.deepStrictEqual(cleanupFailure.events, ['open', 'edit', 'discard']);
}

async function testInvalidGrantStopsBeforeWorkspaceOpen() {
  const fixture = makeFixture();
  const wrongGrant = Object.freeze({
    ...fixture.grant,
    requestId: 'different-request',
  });
  await assert.rejects(
    fixture.executor.execute(fixture.request, wrongGrant),
    (error) => error.code === CANARY_STAGING_TRIAL_EXECUTOR_REASONS.INVALID_INPUT
  );
  assert.deepStrictEqual(fixture.events, []);
}

function testConstructionRejectsUnsafePorts() {
  const fixture = makeFixture();
  assert.throws(
    () => createCanaryStagingTrialExecutor({
      kernelId: fixture.binding.kernelId,
      workspaceSessionPort: Object.freeze({
        ...fixture.workspaceSessionPort,
        diagnostics() {
          return Object.freeze({
            version: fixture.workspaceSessionPort.version,
            workspaceIsolation: 'source_workspace',
            sourceMutation: 'allowed',
            discardMode: 'best_effort',
          });
        },
      }),
      canaryEditor: fixture.canaryEditor,
    }),
    /workspaceSessionPort|staging|isolation/i
  );
  assert.throws(
    () => createCanaryStagingTrialExecutor({
      kernelId: fixture.binding.kernelId,
      workspaceSessionPort: fixture.workspaceSessionPort,
      canaryEditor: { ...fixture.canaryEditor },
    }),
    /canaryEditor/
  );
}

async function run() {
  assert.strictEqual(
    CANARY_STAGING_TRIAL_EXECUTOR_VERSION,
    'canary-staging-trial-executor.v1'
  );
  assert.strictEqual(
    CANARY_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
    'canary-staging-open-outcome.v1'
  );
  assert.strictEqual(
    CANARY_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
    'canary-staging-edit-outcome.v1'
  );
  assert.strictEqual(Object.isFrozen(CANARY_STAGING_TRIAL_EXECUTOR_REASONS), true);
  testConstructionRejectsUnsafePorts();
  await testTrialExecutorIntegratesWithGuardedRunner();
  await testSuccessfulTrialDiscardsBeforeFallbackSignal();
  await testEditorFailureIsSanitizedAfterVerifiedDiscard();
  await testInvalidWriteReceiptIsDiscardedAndCannotComplete();
  await testAmbiguousOpenOrCleanupFailsClosed();
  await testInvalidGrantStopsBeforeWorkspaceOpen();
  console.log('canary staging trial executor tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
