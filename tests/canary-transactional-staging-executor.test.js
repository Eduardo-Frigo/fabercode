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
  CANARY_EDIT_MUTATION_FRONTIERS,
} = require('../main/agent_runtime/canary_edit_lifecycle');
const {
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
  CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
  createCanaryEditRunner,
} = require('../main/agent_runtime/canary_edit_runner');
const {
  createCanaryPromotionController,
} = require('../main/agent_runtime/canary_promotion_controller');
const {
  CanaryPromotionBackendAmbiguousError,
  createCanaryPromotionReceipt,
  createCanaryPromotionRevertReceipt,
} = require('../main/agent_runtime/canary_promotion_contract');
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
  CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
  CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS,
  CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
  CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
  CANARY_TRANSACTIONAL_STAGING_RESULT_DIAGNOSTICS_SCHEMA_VERSION,
  createCanaryTransactionalStagingExecutor,
} = require('../main/agent_runtime/canary_transactional_staging_executor');
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
  discardRejection = null,
  editorRejection = null,
  editorResultOverride = null,
  invalidPromotionReceipt = false,
  openOutcomeOverride = null,
  promotionRejection = null,
  revertRejection = null,
} = {}) {
  const events = [];
  const binding = createCapabilityDelegationBinding({
    projectId: 'project-transaction-a',
    canonicalRootPath: '/workspace/project-transaction-a',
    realRootPath: '/workspace/project-transaction-a',
    sessionId: 'session-transaction-a',
    jobId: 'job-transaction-a',
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
    { requestId: 'canary-transactional-a', executionContext }
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
    cohortSeed: 'canary-transactional-tests-v1',
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
    leaseId: 'workspace-lease-transaction-a',
    binding,
    sourceRootIdentityDigest: digest('d'),
  });
  const workspaceLease = createExecutionWorkspaceLease({
    request: workspaceRequest,
    workspaceRootPath: '/private/staging/transaction-a',
    workspaceRealRootPath: '/private/staging/transaction-a',
    workspaceRootIdentityDigest: digest('e'),
  });
  const session = createCanaryStagingSession({
    requestId: request.requestId,
    checkpoint,
    workspaceRequest,
    workspaceLease,
  });
  const actionDigest = digest('f');
  const writeReceipt = createCanaryStagingWriteReceipt({
    session,
    actionDigest,
    writeSetDigest: digest('1'),
    changedPaths: ['src/app.js'],
    stagingWritten: true,
    sourceMutated: false,
  });
  const sourceSnapshot = Object.freeze({
    checkpointDigest: checkpoint.checkpointDigest,
    sourceRootIdentityDigest: session.sourceRootIdentityDigest,
    sourceStateDigest: digest('2'),
    branchHeadDigest: digest('3'),
    gitIndexDigest: digest('4'),
    userDirtyDigest: digest('5'),
  });
  const promotionId = 'promotion-transaction-a';
  const workspaceDiscardRequest = createExecutionWorkspaceDiscardRequest({
    request: workspaceRequest,
    lease: workspaceLease,
  });
  const physicalDiscardReceipt = createExecutionWorkspaceDiscardReceipt({
    request: workspaceDiscardRequest,
    discarded: true,
  });
  const discardReceipt = createCanaryStagingDiscardReceipt({
    session,
    workspaceDiscardRequest,
    workspaceDiscardReceipt: physicalDiscardReceipt,
  });
  const editorResult = editorResultOverride || createHarnessResult({
    requestId: request.requestId,
    operation: HARNESS_OPERATIONS.EXECUTE,
    kernelId: binding.kernelId,
    output: deepFreeze({ ok: true, engine: 'canary-promoted' }),
    diagnostics: null,
  });

  const calls = {
    discard: [],
    edit: [],
    open: [],
    promote: [],
    revert: [],
  };
  const workspaceSessionPort = Object.freeze({
    version: 'canary-transactional-workspace.test.v1',
    open(harnessRequest, executionGrant) {
      calls.open.push({ harnessRequest, executionGrant });
      events.push('open');
      return Promise.resolve(openOutcomeOverride || Object.freeze({
        schemaVersion: CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
        ok: true,
        session,
        checkpoint,
        workspaceRequest,
        actionDigest,
        promotionId,
        sourceSnapshot,
        rootMutation,
      }));
    },
    discard(sessionValue) {
      calls.discard.push(sessionValue);
      events.push('discard');
      if (discardRejection) return Promise.reject(discardRejection);
      return Promise.resolve(Object.freeze({
        receipt: discardReceipt,
        workspaceDiscardRequest,
      }));
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-transactional-workspace.test.v1',
        workspaceIsolation: 'per_job_staging',
        sourceMutation: 'forbidden',
        discardMode: 'verified',
      });
    },
  });
  const canaryEditor = Object.freeze({
    version: 'canary-transactional-editor.test.v1',
    kernelId: binding.kernelId,
    execute(harnessRequest, executionGrant, stagingSession) {
      calls.edit.push({ harnessRequest, executionGrant, stagingSession });
      events.push('edit');
      if (editorRejection) return Promise.reject(editorRejection);
      return Promise.resolve(Object.freeze({
        schemaVersion: CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
        ok: true,
        writeReceipt,
        result: editorResult,
      }));
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-transactional-editor.test.v1',
        kernelId: binding.kernelId,
        workspaceMode: 'provided_session_only',
        sourceMutation: 'forbidden',
        settlementMode: 'terminal',
        networkMode: 'disabled',
        installMode: 'disabled',
      });
    },
  });
  const backend = Object.freeze({
    version: 'canary-transactional-promotion-backend.test.v1',
    promote(promotionRequest) {
      calls.promote.push(promotionRequest);
      events.push('promote');
      if (promotionRejection) return Promise.reject(promotionRejection);
      const receipt = createCanaryPromotionReceipt({
        request: promotionRequest,
        sourceAfterDigest: digest('6'),
        inversePatchDigest: digest('7'),
        branchHeadAfterDigest: promotionRequest.branchHeadDigest,
        gitIndexAfterDigest: promotionRequest.gitIndexDigest,
        userDirtyAfterDigest: promotionRequest.userDirtyDigest,
        conflictChecked: true,
        sourceMutated: true,
        promotionApplied: true,
      });
      return Promise.resolve(invalidPromotionReceipt
        ? Object.freeze({ ...receipt, gitIndexAfterDigest: digest('9') })
        : receipt);
    },
    revert(input) {
      calls.revert.push(input);
      events.push('revert');
      if (revertRejection) return Promise.reject(revertRejection);
      return Promise.resolve(createCanaryPromotionRevertReceipt({
        request: input.request,
        promotionReceipt: input.promotionReceipt,
        sourceRestoredDigest: input.request.sourceStateDigest,
        branchHeadAfterDigest: input.request.branchHeadDigest,
        gitIndexAfterDigest: input.request.gitIndexDigest,
        userDirtyAfterDigest: input.request.userDirtyDigest,
        inversePatchApplied: true,
        sourceRestored: true,
      }));
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-transactional-promotion-backend.test.v1',
        conflictCheck: 'required',
        inversePatch: 'job_scoped',
        rejectionFrontier: 'pre_write_only',
        settlementMode: 'terminal_receipt',
        branchMutation: 'forbidden',
        gitIndexMutation: 'forbidden',
        userDirtyMutation: 'forbidden',
      });
    },
  });
  const promotionController = createCanaryPromotionController({ backend });
  const executor = createCanaryTransactionalStagingExecutor({
    kernelId: binding.kernelId,
    workspaceSessionPort,
    canaryEditor,
    promotionController,
  });

  return {
    binding,
    calls,
    canaryEditor,
    checkpoint,
    discardReceipt,
    events,
    executor,
    grant,
    promotionController,
    request,
    rootMutation,
    session,
    sourceSnapshot,
    workspaceRequest,
    workspaceSessionPort,
    writeReceipt,
  };
}

async function testPromotesOnlyAfterValidStagingAndDiscardsBeforeSuccess() {
  const fixture = makeFixture();
  const result = await fixture.executor.execute(fixture.request, fixture.grant);
  assert.deepStrictEqual(fixture.events, ['open', 'edit', 'promote', 'discard']);
  assert.strictEqual(fixture.calls.promote.length, 1);
  assert.strictEqual(fixture.calls.revert.length, 0);
  assert.strictEqual(result.kernelId, fixture.binding.kernelId);
  assert.deepStrictEqual(result.output, { ok: true, engine: 'canary-promoted' });
  assert.deepStrictEqual(result.diagnostics, {
    schemaVersion: CANARY_TRANSACTIONAL_STAGING_RESULT_DIAGNOSTICS_SCHEMA_VERSION,
    executorVersion: CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
    promotionId: 'promotion-transaction-a',
    stagingId: fixture.session.stagingId,
    checkpointDigest: fixture.checkpoint.checkpointDigest,
    writeSetDigest: fixture.writeReceipt.writeSetDigest,
    sourceBeforeDigest: fixture.sourceSnapshot.sourceStateDigest,
    sourceAfterDigest: digest('6'),
    changedPaths: ['src/app.js'],
    stagingDiscarded: true,
  });
  assertDeepFrozen(result);
  assert.deepStrictEqual(fixture.executor.diagnostics(), {
    version: CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
    kernelId: fixture.binding.kernelId,
    workspaceIsolation: 'per_job_staging',
    networkMode: 'disabled',
    installMode: 'disabled',
    promotionMode: 'explicit_checkpointed',
  });
}

async function testPromotedResultIntegratesWithGuardedRunner() {
  const fixture = makeFixture();
  class LegacyKernel extends AgentKernel {
    constructor() {
      super({
        id: 'legacy',
        version: 'legacy.transactional.test.v1',
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
        output: deepFreeze({ ok: true, engine: 'legacy' }),
      });
    }
  }
  const legacy = new LegacyKernel();
  const admissionFactsProvider = Object.freeze({
    version: 'transactional-facts.test.v1',
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
    authoritativeKernel: legacy,
    admissionFactsProvider,
    rolloutSelector: createCanaryRolloutSelector({
      cohortSeed: 'transactional-runner-integration-v1',
    }),
    stagedCanaryExecutor: fixture.executor,
  });
  const result = await runner.execute(fixture.request);
  assert.strictEqual(result.kernelId, fixture.binding.kernelId);
  assert.strictEqual(legacy.calls.length, 0);
  assert.strictEqual(runner.diagnostics().canaryCompleted, 1);
  assert.strictEqual(runner.diagnostics().legacyFallbacks, 0);
  assert.deepStrictEqual(fixture.events, ['open', 'edit', 'promote', 'discard']);
}

async function testPrePromotionFailuresDiscardThenFallback() {
  for (const fixture of [
    makeFixture({ editorRejection: new Error('private editor failure') }),
    makeFixture({ promotionRejection: new Error('pre-write conflict') }),
  ]) {
    const signal = await fixture.executor.execute(fixture.request, fixture.grant);
    assert.strictEqual(
      signal.schemaVersion,
      CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION
    );
    assert.strictEqual(signal.status, 'fallback_ready');
    assert.strictEqual(
      signal.mutationFrontier,
      CANARY_EDIT_MUTATION_FRONTIERS.STAGING
    );
    assert.strictEqual(signal.cleanupReceipt.disposition, 'discarded');
    assert.strictEqual(fixture.calls.revert.length, 0);
    assertDeepFrozen(signal);
  }
}

async function testAmbiguousPromotionNeverFallsBack() {
  const fixture = makeFixture({ invalidPromotionReceipt: true });
  await assert.rejects(
    fixture.executor.execute(fixture.request, fixture.grant),
    (error) => error.code
      === CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.PROMOTION_AMBIGUOUS
  );
  assert.deepStrictEqual(fixture.events, ['open', 'edit', 'promote']);
  assert.strictEqual(fixture.calls.discard.length, 0);
  assert.strictEqual(fixture.calls.revert.length, 0);

  const explicitBackendAmbiguity = makeFixture({
    promotionRejection: new CanaryPromotionBackendAmbiguousError(),
  });
  await assert.rejects(
    explicitBackendAmbiguity.executor.execute(
      explicitBackendAmbiguity.request,
      explicitBackendAmbiguity.grant
    ),
    (error) => error.code
      === CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.PROMOTION_AMBIGUOUS
  );
  assert.deepStrictEqual(
    explicitBackendAmbiguity.events,
    ['open', 'edit', 'promote']
  );
  assert.strictEqual(explicitBackendAmbiguity.calls.discard.length, 0);
  assert.strictEqual(explicitBackendAmbiguity.calls.revert.length, 0);
}

async function testPostPromotionCleanupRevertsBeforeFallback() {
  const fixture = makeFixture({
    discardRejection: new Error('private discard failure'),
  });
  const signal = await fixture.executor.execute(fixture.request, fixture.grant);
  assert.deepStrictEqual(fixture.events, [
    'open',
    'edit',
    'promote',
    'discard',
    'revert',
  ]);
  assert.strictEqual(signal.mutationFrontier, CANARY_EDIT_MUTATION_FRONTIERS.SOURCE);
  assert.strictEqual(signal.cleanupReceipt.disposition, 'reverted');
  assert.strictEqual(signal.cleanupReceipt.clean, true);
  assert.strictEqual(fixture.calls.revert.length, 1);
  assertDeepFrozen(signal);

  const failedRevert = makeFixture({
    discardRejection: new Error('discard failed'),
    revertRejection: new Error('private revert failure'),
  });
  await assert.rejects(
    failedRevert.executor.execute(failedRevert.request, failedRevert.grant),
    (error) => error.code
      === CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.REVERT_FAILED
      && !/private revert/i.test(error.message)
  );
  assert.deepStrictEqual(failedRevert.events, [
    'open',
    'edit',
    'promote',
    'discard',
    'revert',
  ]);
}

async function testInvalidOpenOrEditorResultFailsClosed() {
  const invalidOpenSeed = makeFixture();
  const invalidOpen = makeFixture({
    openOutcomeOverride: Object.freeze({
      schemaVersion: CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
      ok: true,
      session: invalidOpenSeed.session,
      checkpoint: invalidOpenSeed.checkpoint,
      workspaceRequest: invalidOpenSeed.workspaceRequest,
      actionDigest: digest('f'),
      promotionId: 'promotion-transaction-a',
      sourceSnapshot: Object.freeze({
        ...invalidOpenSeed.sourceSnapshot,
        sourceRootIdentityDigest: digest('9'),
      }),
      rootMutation: invalidOpenSeed.rootMutation,
    }),
  });
  await assert.rejects(
    invalidOpen.executor.execute(invalidOpen.request, invalidOpen.grant),
    (error) => error.code
      === CANARY_TRANSACTIONAL_STAGING_EXECUTOR_REASONS.OPEN_FAILED
  );
  assert.deepStrictEqual(invalidOpen.events, ['open']);

  const mutableOutput = makeFixture({
    editorResultOverride: createHarnessResult({
      requestId: 'canary-transactional-a',
      operation: HARNESS_OPERATIONS.EXECUTE,
      kernelId: 'codex-app-server-canary',
      output: { ok: true },
      diagnostics: null,
    }),
  });
  const signal = await mutableOutput.executor.execute(
    mutableOutput.request,
    mutableOutput.grant
  );
  assert.strictEqual(signal.reason, 'canary_execution_failed');
  assert.deepStrictEqual(mutableOutput.events, ['open', 'edit', 'discard']);
  assert.strictEqual(mutableOutput.calls.promote.length, 0);
}

function testConstructionRejectsUnsafePorts() {
  const fixture = makeFixture();
  assert.throws(
    () => createCanaryTransactionalStagingExecutor({
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
      promotionController: fixture.promotionController,
    }),
    /workspaceSessionPort|staging|isolation/i
  );
  assert.throws(
    () => createCanaryTransactionalStagingExecutor({
      kernelId: fixture.binding.kernelId,
      workspaceSessionPort: fixture.workspaceSessionPort,
      canaryEditor: fixture.canaryEditor,
      promotionController: { ...fixture.promotionController },
    }),
    /promotionController/
  );
}

async function run() {
  assert.strictEqual(
    CANARY_TRANSACTIONAL_STAGING_EXECUTOR_VERSION,
    'canary-transactional-staging-executor.v1'
  );
  assert.strictEqual(
    CANARY_TRANSACTIONAL_STAGING_OPEN_OUTCOME_SCHEMA_VERSION,
    'canary-transactional-staging-open-outcome.v1'
  );
  assert.strictEqual(
    CANARY_TRANSACTIONAL_STAGING_EDIT_OUTCOME_SCHEMA_VERSION,
    'canary-transactional-staging-edit-outcome.v1'
  );
  testConstructionRejectsUnsafePorts();
  await testPromotesOnlyAfterValidStagingAndDiscardsBeforeSuccess();
  await testPromotedResultIntegratesWithGuardedRunner();
  await testPrePromotionFailuresDiscardThenFallback();
  await testAmbiguousPromotionNeverFallsBack();
  await testPostPromotionCleanupRevertsBeforeFallback();
  await testInvalidOpenOrEditorResultFailsClosed();
  console.log('canary transactional staging executor tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
