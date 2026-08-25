'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  classifyCanaryEditAction,
} = require('../main/agent_runtime/canary_edit_action_classifier');
const {
  CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
  CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
} = require('../main/agent_runtime/canary_rollout_evidence_ledger');
const {
  CANARY_ROLLOUT_STAGES,
  createCanaryRolloutSelector,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  HARNESS_OPERATIONS,
  createExecuteRequest,
  createHarnessResult,
} = require('../main/agent_runtime/harness_contracts');
const {
  CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_REASONS,
  CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_VERSION,
  createCanaryRolloutEvidenceObserverAdapter,
} = require('../main/agent_runtime/canary_rollout_evidence_observer_adapter');

const HASH = `sha256:${'a'.repeat(64)}`;
const AUTHORITATIVE_KERNEL_ID = 'legacy';
const CANARY_KERNEL_ID = 'codex-app-server-canary';
const RUNNER_VERSION = 'canary-edit-runner.v1';
const FACTS_PROVIDER_VERSION = 'canary-observer-facts.test.v1';

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.strictEqual(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      assertDeepFrozen(descriptor.value, seen);
    }
  }
}

function binding({
  jobId = 'rollout-observer-job-1',
  projectId = 'rollout-observer-project-1',
} = {}) {
  const rootPath = `/workspace/${projectId}`;
  return createCapabilityDelegationBinding({
    projectId,
    canonicalRootPath: rootPath,
    realRootPath: rootPath,
    sessionId: `session-${jobId}`,
    jobId,
    kernelId: CANARY_KERNEL_ID,
    submissionDigest: HASH,
  });
}

function request({
  authorityBinding = binding(),
  requestId = 'rollout-observer-request-1',
} = {}) {
  const executionContext = { jobId: authorityBinding.jobId };
  Object.defineProperty(executionContext, 'authorityBinding', {
    configurable: false,
    enumerable: false,
    value: authorityBinding,
    writable: false,
  });
  Object.freeze(executionContext);
  return createExecuteRequest(
    deepFreeze({
      type: 'apply_file_patch',
      targetFile: 'src/app.js',
      previousContentHash: HASH,
      nextContent: 'module.exports = "observed";\n',
    }),
    deepFreeze({
      id: authorityBinding.projectId,
      projectId: authorityBinding.projectId,
      rootPath: authorityBinding.canonicalRootPath,
    }),
    { requestId, executionContext }
  );
}

function facts(authorityBinding, overrides = {}) {
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

function createFactsProvider(authorityBinding, value) {
  return Object.freeze({
    version: FACTS_PROVIDER_VERSION,
    inspect() {
      return value;
    },
    diagnostics() {
      return Object.freeze({
        version: FACTS_PROVIDER_VERSION,
        authorityMode: 'exact_job_action_root',
        checkpointMode: 'authority_bound',
        mutationObservation: 'external_exact',
        rolloutPolicy: 'external_exact',
        failureMode: 'deny',
      });
    },
  });
}

function createEvidenceSink({ rejection = null } = {}) {
  const records = [];
  return {
    records,
    sink: Object.freeze({
      version: CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
      record(value) {
        if (rejection) throw rejection;
        records.push(value);
        return undefined;
      },
    }),
  };
}

function result(requestValue, kernelId, output) {
  return createHarnessResult({
    requestId: requestValue.requestId,
    operation: HARNESS_OPERATIONS.EXECUTE,
    kernelId,
    output: deepFreeze(output),
    diagnostics: null,
  });
}

function createObservedFixture({
  authorityBinding = binding(),
  factsValue = null,
  resultFactory = null,
  rejection = null,
  sinkFixture = createEvidenceSink(),
} = {}) {
  const admissionFactsProvider = createFactsProvider(
    authorityBinding,
    factsValue || facts(authorityBinding)
  );
  const rolloutSelector = createCanaryRolloutSelector({
    cohortSeed: 'rollout-evidence-observer-tests-v1',
  });
  const adapter = createCanaryRolloutEvidenceObserverAdapter({
    admissionFactsProvider,
    rolloutSelector,
    evidenceSink: sinkFixture.sink,
  });
  const calls = [];
  const runner = Object.freeze({
    version: RUNNER_VERSION,
    execute(requestValue) {
      const classification = classifyCanaryEditAction(requestValue.action);
      const inspectedFacts = adapter.admissionFactsProvider.inspect(
        requestValue,
        classification
      );
      const rolloutDecision = adapter.rolloutSelector.select(Object.freeze({
        killSwitch: inspectedFacts.rollout.killSwitch,
        configuredMode: 'canary',
        projectId: authorityBinding.projectId,
        projectPin: inspectedFacts.rollout.projectPin,
        allowlisted: inspectedFacts.rollout.allowlisted,
        internal: inspectedFacts.rollout.internal,
        rolloutStage: inspectedFacts.rollout.rolloutStage,
      }));
      calls.push({ requestValue, classification, inspectedFacts, rolloutDecision });
      if (rejection) return Promise.reject(rejection);
      if (resultFactory) {
        return Promise.resolve(resultFactory(requestValue, rolloutDecision));
      }
      const kernelId = rolloutDecision.selected
        ? CANARY_KERNEL_ID
        : AUTHORITATIVE_KERNEL_ID;
      return Promise.resolve(result(
        requestValue,
        kernelId,
        kernelId === CANARY_KERNEL_ID
          ? {
            status: 'completed',
            mutationScope: 'staging',
            changedPaths: ['src/app.js'],
            writeSetDigest: `sha256:${'b'.repeat(64)}`,
          }
          : { ok: true, engine: 'legacy' }
      ));
    },
    diagnostics() {
      return Object.freeze({
        version: RUNNER_VERSION,
        authoritativeKernelId: AUTHORITATIVE_KERNEL_ID,
        canaryKernelId: CANARY_KERNEL_ID,
        requests: calls.length,
      });
    },
  });
  return {
    adapter,
    calls,
    runner: adapter.observeRunner(runner),
    sinkFixture,
  };
}

function expectedEvidence(authorityBinding, overrides = {}) {
  return {
    schemaVersion: CANARY_ROLLOUT_EVIDENCE_SCHEMA_VERSION,
    jobId: authorityBinding.jobId,
    projectId: authorityBinding.projectId,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    route: 'canary',
    eligible: true,
    terminal: true,
    succeeded: true,
    manualRollback: false,
    corrupted: false,
    dataLossIncident: false,
    securityIncident: false,
    duplicateExternalEffect: false,
    ...overrides,
  };
}

async function testEligibleCanaryResultRecordsAutomaticEvidence() {
  const authorityBinding = binding();
  const fixture = createObservedFixture({ authorityBinding });
  const harnessRequest = request({ authorityBinding });

  assert.strictEqual(
    CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_VERSION,
    'canary-rollout-evidence-observer-adapter.v1'
  );
  assert.deepStrictEqual(Reflect.ownKeys(fixture.adapter), [
    'version',
    'admissionFactsProvider',
    'rolloutSelector',
    'observeRunner',
    'diagnostics',
  ]);
  assert.deepStrictEqual(Reflect.ownKeys(fixture.runner), [
    'version',
    'execute',
    'diagnostics',
  ]);
  assert.strictEqual(Object.isFrozen(fixture.adapter), true);
  assert.strictEqual(Object.isFrozen(fixture.runner), true);

  const observed = await fixture.runner.execute(harnessRequest);
  assert.strictEqual(observed.kernelId, CANARY_KERNEL_ID);
  assert.strictEqual(fixture.sinkFixture.records.length, 1);
  assert.deepStrictEqual(
    fixture.sinkFixture.records[0],
    expectedEvidence(authorityBinding)
  );
  assertDeepFrozen(fixture.sinkFixture.records[0]);
  assert.deepStrictEqual(fixture.adapter.diagnostics(), {
    version: CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_VERSION,
    evidenceSinkVersion: CANARY_ROLLOUT_EVIDENCE_SINK_VERSION,
    runnerVersion: RUNNER_VERSION,
    requests: 1,
    eligibleObservations: 1,
    ineligibleObservations: 0,
    baselineEvidence: 0,
    canaryEvidence: 1,
    conservativeFailures: 0,
    incompleteObservations: 0,
    evidenceRejections: 0,
    lastFailureCode: null,
  });
  assertDeepFrozen(fixture.adapter.diagnostics());
}

async function testEligibleRolloutHoldbackBecomesBaselineEvidence() {
  const authorityBinding = binding({
    jobId: 'rollout-observer-baseline-job',
    projectId: 'rollout-observer-baseline-project',
  });
  const fixture = createObservedFixture({
    authorityBinding,
    factsValue: facts(authorityBinding, {
      rollout: {
        killSwitch: false,
        projectPin: 'legacy',
        allowlisted: true,
        internal: false,
        rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_1,
      },
    }),
  });
  const harnessRequest = request({
    authorityBinding,
    requestId: 'rollout-observer-baseline-request',
  });

  const observed = await fixture.runner.execute(harnessRequest);
  assert.strictEqual(observed.kernelId, AUTHORITATIVE_KERNEL_ID);
  assert.deepStrictEqual(fixture.sinkFixture.records, [deepFreeze(
    expectedEvidence(authorityBinding, {
      rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_1,
      route: 'baseline',
    })
  )]);
  assert.strictEqual(fixture.adapter.diagnostics().baselineEvidence, 1);
}

async function testAdmissionDeniedJobNeverPollutesTheEligibleSample() {
  const authorityBinding = binding({ jobId: 'rollout-observer-denied-job' });
  const fixture = createObservedFixture({
    authorityBinding,
    factsValue: facts(authorityBinding, {
      checkpoint: {
        checkpointDigest: HASH,
        checkpointVerified: false,
        projectId: authorityBinding.projectId,
        canonicalRootPath: authorityBinding.canonicalRootPath,
        jobId: authorityBinding.jobId,
      },
    }),
  });
  await fixture.runner.execute(request({
    authorityBinding,
    requestId: 'rollout-observer-denied-request',
  }));
  assert.strictEqual(fixture.sinkFixture.records.length, 0);
  assert.strictEqual(fixture.adapter.diagnostics().ineligibleObservations, 1);
  assert.strictEqual(fixture.adapter.diagnostics().eligibleObservations, 0);
}

async function testCleanCanaryFallbackIsAttributedAsCanaryFailure() {
  const authorityBinding = binding({ jobId: 'rollout-observer-fallback-job' });
  const fixture = createObservedFixture({
    authorityBinding,
    resultFactory(requestValue) {
      return result(requestValue, AUTHORITATIVE_KERNEL_ID, {
        ok: true,
        engine: 'legacy-after-clean-fallback',
      });
    },
  });
  await fixture.runner.execute(request({
    authorityBinding,
    requestId: 'rollout-observer-fallback-request',
  }));
  assert.deepStrictEqual(
    fixture.sinkFixture.records[0],
    expectedEvidence(authorityBinding, { succeeded: false })
  );
  assert.strictEqual(fixture.adapter.diagnostics().canaryEvidence, 1);
  assert.strictEqual(fixture.adapter.diagnostics().conservativeFailures, 0);
}

async function testRejectedCanaryIsConservativelyMarkedCorrupted() {
  const authorityBinding = binding({ jobId: 'rollout-observer-rejected-job' });
  const privateFailure = new Error('private source location and content');
  privateFailure.code = 'CANARY_EDIT_RUNNER_CANARY_EXECUTION_FAILED';
  const fixture = createObservedFixture({
    authorityBinding,
    rejection: privateFailure,
  });
  await assert.rejects(
    fixture.runner.execute(request({
      authorityBinding,
      requestId: 'rollout-observer-rejected-request',
    })),
    (error) => error === privateFailure
  );
  assert.deepStrictEqual(
    fixture.sinkFixture.records[0],
    expectedEvidence(authorityBinding, {
      succeeded: false,
      corrupted: true,
    })
  );
  assert.strictEqual(fixture.adapter.diagnostics().conservativeFailures, 1);
  assert.doesNotMatch(
    JSON.stringify(fixture.adapter.diagnostics()),
    /private source|content/
  );
}

async function testEvidenceSinkFailureCannotRewriteExecutionOutcome() {
  const authorityBinding = binding({ jobId: 'rollout-observer-sink-job' });
  const privateFailure = new Error('private ledger storage path');
  const fixture = createObservedFixture({
    authorityBinding,
    sinkFixture: createEvidenceSink({ rejection: privateFailure }),
  });
  const observed = await fixture.runner.execute(request({
    authorityBinding,
    requestId: 'rollout-observer-sink-request',
  }));
  assert.strictEqual(observed.kernelId, CANARY_KERNEL_ID);
  assert.strictEqual(fixture.adapter.diagnostics().evidenceRejections, 1);
  assert.strictEqual(
    fixture.adapter.diagnostics().lastFailureCode,
    CANARY_ROLLOUT_EVIDENCE_OBSERVER_ADAPTER_REASONS.EVIDENCE_REJECTED
  );
  assert.doesNotMatch(
    JSON.stringify(fixture.adapter.diagnostics()),
    /private ledger|storage path/
  );
}

function testInvalidAndHostileOptionsFailWithoutInvokingAccessors() {
  assert.throws(
    () => createCanaryRolloutEvidenceObserverAdapter({}),
    /rollout evidence observer options/i
  );
  let getterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'admissionFactsProvider', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  assert.throws(
    () => createCanaryRolloutEvidenceObserverAdapter(hostile),
    /rollout evidence observer options/i
  );
  assert.strictEqual(getterCalls, 0);
}

async function main() {
  await testEligibleCanaryResultRecordsAutomaticEvidence();
  await testEligibleRolloutHoldbackBecomesBaselineEvidence();
  await testAdmissionDeniedJobNeverPollutesTheEligibleSample();
  await testCleanCanaryFallbackIsAttributedAsCanaryFailure();
  await testRejectedCanaryIsConservativelyMarkedCorrupted();
  await testEvidenceSinkFailureCannotRewriteExecutionOutcome();
  testInvalidAndHostileOptionsFailWithoutInvokingAccessors();
  console.log('canary-rollout-evidence-observer-adapter.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
