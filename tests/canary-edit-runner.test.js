'use strict';

const assert = require('assert');

const { AgentKernel } = require('../main/agent_runtime/agent_kernel');
const {
  CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
  CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
  CANARY_EDIT_RUNNER_REASONS,
  CANARY_EDIT_RUNNER_VERSION,
  createCanaryEditRunner,
} = require('../main/agent_runtime/canary_edit_runner');
const {
  CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
  CANARY_EDIT_MUTATION_FRONTIERS,
} = require('../main/agent_runtime/canary_edit_lifecycle');
const {
  CANARY_ROLLOUT_STAGES,
  createCanaryRolloutSelector,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  HARNESS_OPERATIONS,
  createExecuteRequest,
  createHarnessResult,
} = require('../main/agent_runtime/harness_contracts');

const HASH = 'sha256:' + 'a'.repeat(64);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

function binding(overrides = {}) {
  return deepFreeze({
    projectId: 'project-canary-a',
    canonicalRootPath: '/workspace/project-canary-a',
    realRootPath: '/workspace/project-canary-a',
    sessionId: 'session-canary-a',
    jobId: 'job-canary-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: HASH,
    ...overrides,
  });
}

function executionContext(authorityBinding = binding()) {
  const context = {
    jobId: authorityBinding.jobId,
    requestedMode: 'delegate_task',
    signal: Object.freeze({ aborted: false }),
  };
  Object.defineProperty(context, 'authorityBinding', {
    configurable: false,
    enumerable: false,
    value: authorityBinding,
    writable: false,
  });
  return Object.freeze(context);
}

function action(overrides = {}) {
  return deepFreeze({
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: HASH,
    nextContent: 'module.exports = true;\n',
    ...overrides,
  });
}

function request({
  requestId = 'canary-runner-request-a',
  authorityBinding = binding(),
  actionValue = action(),
  projectInfo = null,
} = {}) {
  return createExecuteRequest(
    actionValue,
    projectInfo || deepFreeze({
      id: authorityBinding.projectId,
      projectId: authorityBinding.projectId,
      rootPath: authorityBinding.canonicalRootPath,
    }),
    {
      requestId,
      executionContext: executionContext(authorityBinding),
    }
  );
}

class RecordingKernel extends AgentKernel {
  constructor({ id = 'legacy', rejection = null } = {}) {
    super({ id, version: id + '-kernel.v1', capabilities: [HARNESS_OPERATIONS.EXECUTE] });
    this.calls = [];
    this.rejection = rejection;
  }

  async execute(harnessRequest) {
    this.calls.push(harnessRequest);
    if (this.rejection) throw this.rejection;
    return createHarnessResult({
      requestId: harnessRequest.requestId,
      operation: harnessRequest.operation,
      kernelId: this.id,
      output: { ok: true, engine: this.id },
      diagnostics: null,
    });
  }
}

function facts(authorityBinding = binding(), overrides = {}) {
  return deepFreeze({
    projectAuthorized: true,
    checkpoint: {
      checkpointDigest: HASH,
      checkpointVerified: true,
      projectId: authorityBinding.projectId,
      canonicalRootPath: authorityBinding.canonicalRootPath,
      jobId: authorityBinding.jobId,
    },
    rootMutation: {
      canonicalRootPath: authorityBinding.canonicalRootPath,
      ownerJobId: authorityBinding.jobId,
      activeOtherMutatingJobs: 0,
    },
    rollout: {
      killSwitch: false,
      projectPin: null,
      allowlisted: true,
      internal: true,
      rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    },
    ...overrides,
  });
}

function createFactsProvider({
  authorityBinding = binding(),
  result = null,
  rejection = null,
  synchronousPromise = null,
} = {}) {
  const calls = [];
  const provider = Object.freeze({
    version: 'canary-admission-facts-provider.test.v1',
    inspect(harnessRequest, classification) {
      calls.push({ harnessRequest, classification });
      if (rejection) throw rejection;
      if (synchronousPromise) return synchronousPromise;
      return result || facts(authorityBinding);
    },
    diagnostics() {
      return Object.freeze({
        version: 'canary-admission-facts-provider.test.v1',
        authorityMode: 'exact_job_action_root',
        checkpointMode: 'authority_bound',
        mutationObservation: 'external_exact',
        rolloutPolicy: 'external_exact',
        failureMode: 'deny',
      });
    },
  });
  return { calls, provider };
}

function createStagedExecutor({
  kernelId = 'codex-app-server-canary',
  diagnosticsOverrides = {},
  rejection = null,
  resultFactory = null,
  synchronous = false,
} = {}) {
  const calls = [];
  const diagnostics = deepFreeze({
    version: 'staged-canary-executor.test.v1',
    kernelId,
    workspaceIsolation: 'per_job_staging',
    networkMode: 'disabled',
    installMode: 'disabled',
    promotionMode: 'explicit_checkpointed',
    ...diagnosticsOverrides,
  });
  const execute = function execute(harnessRequest, grant) {
    calls.push({ harnessRequest, grant });
    if (rejection) return Promise.reject(rejection);
    const result = resultFactory
      ? resultFactory(harnessRequest, grant)
      : createHarnessResult({
        requestId: harnessRequest.requestId,
        operation: harnessRequest.operation,
        kernelId,
        output: { ok: true, engine: kernelId },
        diagnostics: null,
      });
    return synchronous ? result : Promise.resolve(result);
  };
  const executor = Object.freeze({
    version: diagnostics.version,
    kernelId,
    execute,
    diagnostics() {
      return diagnostics;
    },
  });
  return { calls, executor };
}

function fallbackSignal(authorityBinding, overrides = {}) {
  const stagingId = overrides.stagingId || 'canary-staging-fallback-a';
  const mutationFrontier = overrides.mutationFrontier
    || CANARY_EDIT_MUTATION_FRONTIERS.STAGING;
  const disposition = mutationFrontier === CANARY_EDIT_MUTATION_FRONTIERS.SOURCE
    ? 'reverted'
    : 'discarded';
  return deepFreeze({
    schemaVersion: CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
    status: 'fallback_ready',
    requestId: overrides.requestId || 'canary-clean-fallback',
    jobId: authorityBinding.jobId,
    stagingId,
    mutationFrontier,
    reason: 'canary_execution_failed',
    cleanupReceipt: mutationFrontier === CANARY_EDIT_MUTATION_FRONTIERS.NONE
      ? null
      : {
        schemaVersion: CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
        jobId: authorityBinding.jobId,
        stagingId,
        disposition,
        clean: true,
      },
    ...overrides,
  });
}

function fixture(overrides = {}) {
  const authoritativeKernel = overrides.authoritativeKernel || new RecordingKernel();
  const authorityBinding = overrides.authorityBinding || binding();
  const factsProviderFixture = overrides.factsProviderFixture || createFactsProvider({
    authorityBinding,
  });
  const stagedExecutorFixture = overrides.stagedExecutorFixture || createStagedExecutor();
  const rolloutSelector = overrides.rolloutSelector || createCanaryRolloutSelector({
    cohortSeed: 'canary-runner-tests-v1',
  });
  return {
    authoritativeKernel,
    authorityBinding,
    factsProviderFixture,
    stagedExecutorFixture,
    runner: createCanaryEditRunner({
      authoritativeKernel,
      admissionFactsProvider: factsProviderFixture.provider,
      rolloutSelector,
      stagedCanaryExecutor: stagedExecutorFixture.executor,
    }),
  };
}

async function testEligibleEditUsesOnlyStagedCanary() {
  const current = fixture();
  const harnessRequest = request({ authorityBinding: current.authorityBinding });
  const result = await current.runner.execute(harnessRequest);
  assert.strictEqual(result.kernelId, 'codex-app-server-canary');
  assert.deepStrictEqual(result.output, {
    ok: true,
    engine: 'codex-app-server-canary',
  });
  assert.strictEqual(current.authoritativeKernel.calls.length, 0);
  assert.strictEqual(current.factsProviderFixture.calls.length, 1);
  assert.strictEqual(current.stagedExecutorFixture.calls.length, 1);
  const stagedCall = current.stagedExecutorFixture.calls[0];
  assert.strictEqual(stagedCall.harnessRequest, harnessRequest);
  assert.strictEqual(
    stagedCall.grant.schemaVersion,
    CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION
  );
  assert.strictEqual(stagedCall.grant.requestId, harnessRequest.requestId);
  assert.strictEqual(stagedCall.grant.actionClassification.eligible, true);
  assert.strictEqual(stagedCall.grant.rolloutDecision.selected, true);
  assert.strictEqual(stagedCall.grant.admissionDecision.eligible, true);
  assertDeepFrozen(stagedCall.grant);
  assert.deepStrictEqual(current.runner.diagnostics(), {
    version: CANARY_EDIT_RUNNER_VERSION,
    authoritativeKernelId: 'legacy',
    canaryKernelId: 'codex-app-server-canary',
    requests: 1,
    canaryCompleted: 1,
    legacyFallbacks: 0,
    actionDenied: 0,
    factsDenied: 0,
    rolloutDenied: 0,
    admissionDenied: 0,
    canaryFailed: 0,
    cleanFallbacks: 0,
    lastDecisionReason: 'canary_completed',
  });
  assertDeepFrozen(current.runner.diagnostics());
}

async function testUnsupportedActionFallsBackBeforeAuthorityInspection() {
  const current = fixture();
  const result = await current.runner.execute(request({
    authorityBinding: current.authorityBinding,
    requestId: 'canary-action-denied',
    actionValue: deepFreeze({ type: 'run_command', command: 'npm test' }),
  }));
  assert.strictEqual(result.kernelId, 'legacy');
  assert.strictEqual(current.authoritativeKernel.calls.length, 1);
  assert.strictEqual(current.factsProviderFixture.calls.length, 0);
  assert.strictEqual(current.stagedExecutorFixture.calls.length, 0);
  assert.strictEqual(current.runner.diagnostics().actionDenied, 1);
  assert.strictEqual(current.runner.diagnostics().lastDecisionReason, 'unsupported_action');
}

async function testRolloutAndAdmissionDenialsFallbackBeforeCanary() {
  const killedBinding = binding({ jobId: 'job-canary-killed' });
  const killedFacts = createFactsProvider({
    authorityBinding: killedBinding,
    result: facts(killedBinding, {
      rollout: {
        killSwitch: true,
        projectPin: 'canary',
        allowlisted: true,
        internal: true,
        rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_50,
      },
    }),
  });
  const killed = fixture({ authorityBinding: killedBinding, factsProviderFixture: killedFacts });
  const killedResult = await killed.runner.execute(request({
    requestId: 'canary-rollout-killed',
    authorityBinding: killedBinding,
  }));
  assert.strictEqual(killedResult.kernelId, 'legacy');
  assert.strictEqual(killed.stagedExecutorFixture.calls.length, 0);
  assert.strictEqual(killed.runner.diagnostics().rolloutDenied, 1);
  assert.strictEqual(killed.runner.diagnostics().lastDecisionReason, 'kill_switch');

  const checkpointBinding = binding({ jobId: 'job-canary-checkpoint-denied' });
  const checkpointFacts = createFactsProvider({
    authorityBinding: checkpointBinding,
    result: facts(checkpointBinding, {
      checkpoint: {
        checkpointDigest: HASH,
        checkpointVerified: false,
        projectId: checkpointBinding.projectId,
        canonicalRootPath: checkpointBinding.canonicalRootPath,
        jobId: checkpointBinding.jobId,
      },
    }),
  });
  const denied = fixture({
    authorityBinding: checkpointBinding,
    factsProviderFixture: checkpointFacts,
  });
  const deniedResult = await denied.runner.execute(request({
    requestId: 'canary-admission-denied',
    authorityBinding: checkpointBinding,
  }));
  assert.strictEqual(deniedResult.kernelId, 'legacy');
  assert.strictEqual(denied.stagedExecutorFixture.calls.length, 0);
  assert.strictEqual(denied.runner.diagnostics().admissionDenied, 1);
  assert.strictEqual(denied.runner.diagnostics().lastDecisionReason, 'checkpoint_invalid');
}

async function testUnavailableFactsFallbackBeforeCanary() {
  const unavailable = createFactsProvider({
    rejection: new Error('private authority provider details'),
  });
  const current = fixture({ factsProviderFixture: unavailable });
  const result = await current.runner.execute(request({
    requestId: 'canary-facts-unavailable',
    authorityBinding: current.authorityBinding,
  }));
  assert.strictEqual(result.kernelId, 'legacy');
  assert.strictEqual(current.stagedExecutorFixture.calls.length, 0);
  assert.strictEqual(current.runner.diagnostics().factsDenied, 1);
  assert.strictEqual(current.runner.diagnostics().lastDecisionReason, 'facts_unavailable');
  assert.doesNotMatch(
    JSON.stringify(current.runner.diagnostics()),
    /private authority provider/i
  );

  const promise = Promise.resolve(facts());
  const asyncFacts = createFactsProvider({ synchronousPromise: promise });
  const asyncCurrent = fixture({ factsProviderFixture: asyncFacts });
  const asyncResult = await asyncCurrent.runner.execute(request({
    requestId: 'canary-facts-async',
    authorityBinding: asyncCurrent.authorityBinding,
  }));
  assert.strictEqual(asyncResult.kernelId, 'legacy');
  assert.strictEqual(asyncCurrent.stagedExecutorFixture.calls.length, 0);
  assert.strictEqual(asyncCurrent.runner.diagnostics().factsDenied, 1);
}

async function testCanaryFailureNeverStartsLegacyFallback() {
  const privateFailure = new Error('private staged workspace path');
  privateFailure.code = 'PRIVATE_STAGING_FAILURE';
  const staged = createStagedExecutor({ rejection: privateFailure });
  const current = fixture({ stagedExecutorFixture: staged });
  await assert.rejects(
    current.runner.execute(request({
      requestId: 'canary-ambiguous-failure',
      authorityBinding: current.authorityBinding,
    })),
    (error) => error.code === CANARY_EDIT_RUNNER_REASONS.CANARY_EXECUTION_FAILED
      && !/private staged workspace/i.test(error.message)
  );
  assert.strictEqual(current.authoritativeKernel.calls.length, 0);
  assert.strictEqual(staged.calls.length, 1);
  assert.strictEqual(current.runner.diagnostics().canaryFailed, 1);
  assert.strictEqual(current.runner.diagnostics().legacyFallbacks, 0);
  assert.strictEqual(current.runner.diagnostics().lastDecisionReason, 'canary_failed');

  const synchronous = createStagedExecutor({ synchronous: true });
  const syncCurrent = fixture({ stagedExecutorFixture: synchronous });
  await assert.rejects(
    syncCurrent.runner.execute(request({
      requestId: 'canary-sync-result',
      authorityBinding: syncCurrent.authorityBinding,
    })),
    (error) => error.code === CANARY_EDIT_RUNNER_REASONS.CANARY_EXECUTION_FAILED
  );
  assert.strictEqual(syncCurrent.authoritativeKernel.calls.length, 0);
}

async function testVerifiedCleanupAllowsLegacyFallback() {
  const authorityBinding = binding({ jobId: 'job-canary-clean-fallback' });
  const staged = createStagedExecutor({
    resultFactory() {
      return fallbackSignal(authorityBinding);
    },
  });
  const current = fixture({ authorityBinding, stagedExecutorFixture: staged });
  const result = await current.runner.execute(request({
    requestId: 'canary-clean-fallback',
    authorityBinding,
  }));
  assert.strictEqual(result.kernelId, 'legacy');
  assert.strictEqual(staged.calls.length, 1);
  assert.strictEqual(current.authoritativeKernel.calls.length, 1);
  assert.strictEqual(current.runner.diagnostics().cleanFallbacks, 1);
  assert.strictEqual(current.runner.diagnostics().legacyFallbacks, 1);
  assert.strictEqual(
    current.runner.diagnostics().lastDecisionReason,
    'canary_execution_failed'
  );

  const preWriteBinding = binding({ jobId: 'job-canary-prewrite-fallback' });
  const preWrite = createStagedExecutor({
    resultFactory() {
      return fallbackSignal(preWriteBinding, {
        requestId: 'canary-prewrite-fallback',
        mutationFrontier: CANARY_EDIT_MUTATION_FRONTIERS.NONE,
        cleanupReceipt: null,
      });
    },
  });
  const preWriteCurrent = fixture({
    authorityBinding: preWriteBinding,
    stagedExecutorFixture: preWrite,
  });
  const preWriteResult = await preWriteCurrent.runner.execute(request({
    requestId: 'canary-prewrite-fallback',
    authorityBinding: preWriteBinding,
  }));
  assert.strictEqual(preWriteResult.kernelId, 'legacy');
  assert.strictEqual(preWriteCurrent.runner.diagnostics().cleanFallbacks, 1);
}

async function testInsufficientCleanupNeverStartsLegacy() {
  const authorityBinding = binding({ jobId: 'job-canary-bad-cleanup' });
  const staged = createStagedExecutor({
    resultFactory() {
      return fallbackSignal(authorityBinding, {
        requestId: 'canary-bad-cleanup',
        mutationFrontier: CANARY_EDIT_MUTATION_FRONTIERS.SOURCE,
        cleanupReceipt: {
          schemaVersion: CANARY_EDIT_CLEANUP_RECEIPT_SCHEMA_VERSION,
          jobId: authorityBinding.jobId,
          stagingId: 'canary-staging-fallback-a',
          disposition: 'discarded',
          clean: true,
        },
      });
    },
  });
  const current = fixture({ authorityBinding, stagedExecutorFixture: staged });
  await assert.rejects(
    current.runner.execute(request({
      requestId: 'canary-bad-cleanup',
      authorityBinding,
    })),
    (error) => error.code === CANARY_EDIT_RUNNER_REASONS.CANARY_FALLBACK_INVALID
  );
  assert.strictEqual(current.authoritativeKernel.calls.length, 0);
  assert.strictEqual(current.runner.diagnostics().cleanFallbacks, 0);
  assert.strictEqual(current.runner.diagnostics().legacyFallbacks, 0);
  assert.strictEqual(current.runner.diagnostics().canaryFailed, 1);
  assert.strictEqual(
    current.runner.diagnostics().lastDecisionReason,
    'canary_fallback_invalid'
  );
}

async function testMismatchedCanaryResultFailsClosed() {
  const staged = createStagedExecutor({
    resultFactory(harnessRequest) {
      return createHarnessResult({
        requestId: harnessRequest.requestId,
        operation: harnessRequest.operation,
        kernelId: 'wrong-canary',
        output: { ok: true },
      });
    },
  });
  const current = fixture({ stagedExecutorFixture: staged });
  await assert.rejects(
    current.runner.execute(request({
      requestId: 'canary-wrong-result',
      authorityBinding: current.authorityBinding,
    })),
    (error) => error.code === CANARY_EDIT_RUNNER_REASONS.CANARY_INVALID_RESULT
  );
  assert.strictEqual(current.authoritativeKernel.calls.length, 0);
  assert.strictEqual(current.runner.diagnostics().legacyFallbacks, 0);
}

function testConstructionRejectsUntrustedPorts() {
  const authoritativeKernel = new RecordingKernel();
  const factsProviderFixture = createFactsProvider();
  const rolloutSelector = createCanaryRolloutSelector({ cohortSeed: 'valid-seed' });
  const unsafeIsolation = createStagedExecutor({
    diagnosticsOverrides: { workspaceIsolation: 'source_workspace' },
  });
  assert.throws(
    () => createCanaryEditRunner({
      authoritativeKernel,
      admissionFactsProvider: factsProviderFixture.provider,
      rolloutSelector,
      stagedCanaryExecutor: unsafeIsolation.executor,
    }),
    /staging|isolation/i
  );
  const sameKernel = createStagedExecutor({ kernelId: 'legacy' });
  assert.throws(
    () => createCanaryEditRunner({
      authoritativeKernel,
      admissionFactsProvider: factsProviderFixture.provider,
      rolloutSelector,
      stagedCanaryExecutor: sameKernel.executor,
    }),
    /distinct|kernel/i
  );
  assert.throws(
    () => createCanaryEditRunner({
      authoritativeKernel,
      admissionFactsProvider: { ...factsProviderFixture.provider },
      rolloutSelector,
      stagedCanaryExecutor: createStagedExecutor().executor,
    }),
    /admissionFactsProvider/
  );
}

async function run() {
  assert.strictEqual(CANARY_EDIT_RUNNER_VERSION, 'canary-edit-runner.v1');
  assert.strictEqual(
    CANARY_EDIT_RUNNER_EXECUTION_GRANT_SCHEMA_VERSION,
    'canary-edit-execution-grant.v1'
  );
  assert.strictEqual(
    CANARY_EDIT_RUNNER_FALLBACK_SIGNAL_SCHEMA_VERSION,
    'canary-edit-fallback-signal.v1'
  );
  assert.strictEqual(Object.isFrozen(CANARY_EDIT_RUNNER_REASONS), true);
  testConstructionRejectsUntrustedPorts();
  await testEligibleEditUsesOnlyStagedCanary();
  await testUnsupportedActionFallsBackBeforeAuthorityInspection();
  await testRolloutAndAdmissionDenialsFallbackBeforeCanary();
  await testUnavailableFactsFallbackBeforeCanary();
  await testVerifiedCleanupAllowsLegacyFallback();
  await testInsufficientCleanupNeverStartsLegacy();
  await testCanaryFailureNeverStartsLegacyFallback();
  await testMismatchedCanaryResultFailsClosed();
  console.log('canary edit runner tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
