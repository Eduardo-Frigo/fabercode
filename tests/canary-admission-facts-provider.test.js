'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  classifyCanaryEditAction,
} = require('../main/agent_runtime/canary_edit_action_classifier');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  HARNESS_OPERATIONS,
  createExecuteRequest,
} = require('../main/agent_runtime/harness_contracts');
const {
  createActionDigest,
} = require('../main/services/assistant_job_authority_service');
const {
  CANARY_ADMISSION_FACTS_PROVIDER_VERSION,
  createCanaryAdmissionFactsProvider,
} = require('../main/services/canary_admission_facts_provider');

const digest = (character) => `sha256:${character.repeat(64)}`;

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

function createFixture({
  executeAuthorized = true,
  rootAuthorized = true,
  inspectRootMutation = null,
  inspectRollout = null,
} = {}) {
  const calls = [];
  const binding = createCapabilityDelegationBinding({
    projectId: 'project-admission-a',
    canonicalRootPath: '/workspace/project-admission-a',
    realRootPath: '/physical/project-admission-a',
    sessionId: 'session-admission-a',
    jobId: 'job-admission-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
  });
  const action = deepFreeze({
    type: 'apply_file_patch',
    targetFile: 'src/app.js',
    previousContentHash: digest('b'),
    nextContent: 'module.exports = true;\n',
  });
  const executionContext = {
    jobId: binding.jobId,
    requestedMode: 'delegate_task',
    signal: Object.freeze({ aborted: false }),
  };
  Object.defineProperty(executionContext, 'authorityBinding', {
    enumerable: false,
    value: binding,
  });
  Object.freeze(executionContext);
  const request = createExecuteRequest(
    action,
    deepFreeze({
      id: binding.projectId,
      projectId: binding.projectId,
      rootPath: binding.canonicalRootPath,
    }),
    { requestId: 'request-admission-a', executionContext }
  );
  const classification = classifyCanaryEditAction(action);
  const authorityService = Object.freeze({
    authorizeExecute(input) {
      calls.push('authorizeExecute');
      if (!executeAuthorized) {
        return Object.freeze({
          authorized: false,
          reason: 'project_not_authorized',
        });
      }
      return Object.freeze({
        authorized: true,
        reason: 'authorized',
        binding,
        actionDigest: createActionDigest(input.action),
      });
    },
    authorizeProjectRootLease() {
      calls.push('authorizeProjectRootLease');
      if (!rootAuthorized) {
        return Object.freeze({
          authorized: false,
          reason: 'root_not_authorized',
        });
      }
      return Object.freeze({
        authorized: true,
        reason: 'authorized',
        binding,
        physicalRootIdentityDigest: digest('c'),
      });
    },
  });
  const rootMutationInspector = inspectRootMutation || ((inputBinding) => {
    calls.push('inspectRootMutation');
    return Object.freeze({
      canonicalRootPath: inputBinding.canonicalRootPath,
      ownerJobId: inputBinding.jobId,
      activeOtherMutatingJobs: 0,
    });
  });
  const rolloutInspector = inspectRollout || ((inputBinding) => {
    calls.push('inspectRollout');
    assert.strictEqual(inputBinding.projectId, binding.projectId);
    return Object.freeze({
      killSwitch: false,
      projectPin: 'canary',
      allowlisted: true,
      internal: true,
      rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    });
  });
  const provider = createCanaryAdmissionFactsProvider({
    authorityService,
    inspectRootMutation: rootMutationInspector,
    inspectRollout: rolloutInspector,
  });
  return {
    action,
    authorityService,
    binding,
    calls,
    classification,
    provider,
    request,
  };
}

function testAuthorizedFactsAreDeterministicAndBound() {
  const fixture = createFixture();
  const first = fixture.provider.inspect(
    fixture.request,
    fixture.classification
  );
  const second = fixture.provider.inspect(
    fixture.request,
    fixture.classification
  );
  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(first, {
    projectAuthorized: true,
    checkpoint: {
      checkpointDigest: first.checkpoint.checkpointDigest,
      checkpointVerified: true,
      projectId: fixture.binding.projectId,
      canonicalRootPath: fixture.binding.canonicalRootPath,
      jobId: fixture.binding.jobId,
    },
    rootMutation: {
      canonicalRootPath: fixture.binding.canonicalRootPath,
      ownerJobId: fixture.binding.jobId,
      activeOtherMutatingJobs: 0,
    },
    rollout: {
      killSwitch: false,
      projectPin: 'canary',
      allowlisted: true,
      internal: true,
      rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    },
  });
  assert.match(first.checkpoint.checkpointDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepStrictEqual(fixture.calls, [
    'authorizeExecute',
    'authorizeProjectRootLease',
    'inspectRootMutation',
    'inspectRollout',
    'authorizeExecute',
    'authorizeProjectRootLease',
    'inspectRootMutation',
    'inspectRollout',
  ]);
  assertDeepFrozen(first);
  assert.deepStrictEqual(fixture.provider.diagnostics(), {
    version: CANARY_ADMISSION_FACTS_PROVIDER_VERSION,
    authorityMode: 'exact_job_action_root',
    checkpointMode: 'authority_bound',
    mutationObservation: 'external_exact',
    rolloutPolicy: 'external_exact',
    failureMode: 'deny',
  });
}

function testAuthorityAndObservationFailuresDeny() {
  const authorityDenied = createFixture({ executeAuthorized: false });
  const denied = authorityDenied.provider.inspect(
    authorityDenied.request,
    authorityDenied.classification
  );
  assert.strictEqual(denied.projectAuthorized, false);
  assert.strictEqual(denied.checkpoint.checkpointVerified, false);

  const rootDenied = createFixture({ rootAuthorized: false });
  const deniedRoot = rootDenied.provider.inspect(
    rootDenied.request,
    rootDenied.classification
  );
  assert.strictEqual(deniedRoot.projectAuthorized, false);
  assert.strictEqual(deniedRoot.checkpoint.checkpointVerified, false);

  const observationFailed = createFixture({
    inspectRootMutation() {
      throw new Error('private root state');
    },
    inspectRollout() {
      return Promise.reject(new Error('private rollout state'));
    },
  });
  const failed = observationFailed.provider.inspect(
    observationFailed.request,
    observationFailed.classification
  );
  assert.strictEqual(failed.rootMutation.activeOtherMutatingJobs, 1);
  assert.deepStrictEqual(failed.rollout, {
    killSwitch: true,
    projectPin: 'legacy',
    allowlisted: false,
    internal: false,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  });
  assertDeepFrozen(failed);
}

function testInvalidOrHostileInputsFailWithoutExecutingTraps() {
  const fixture = createFixture();
  let traps = 0;
  const hostile = new Proxy({}, {
    get() {
      traps += 1;
      throw new Error('must not execute');
    },
    ownKeys() {
      traps += 1;
      throw new Error('must not execute');
    },
  });
  assert.throws(
    () => fixture.provider.inspect(hostile, fixture.classification),
    /admission facts|request|invalid/i
  );
  assert.strictEqual(traps, 0);
  assert.throws(
    () => fixture.provider.inspect(fixture.request, Object.freeze({})),
    /admission facts|classification|invalid/i
  );
  assert.throws(
    () => createCanaryAdmissionFactsProvider({}),
    /authorityService|options/i
  );
}

function testSurfaceIsMinimalAndFrozen() {
  const fixture = createFixture();
  assert.strictEqual(
    fixture.provider.version,
    CANARY_ADMISSION_FACTS_PROVIDER_VERSION
  );
  assert.deepStrictEqual(Reflect.ownKeys(fixture.provider), [
    'version',
    'inspect',
    'diagnostics',
  ]);
  assert.strictEqual(Object.isFrozen(fixture.provider), true);
  assert.strictEqual(fixture.request.operation, HARNESS_OPERATIONS.EXECUTE);
}

function main() {
  testSurfaceIsMinimalAndFrozen();
  testAuthorizedFactsAreDeterministicAndBound();
  testAuthorityAndObservationFailuresDeny();
  testInvalidOrHostileInputsFailWithoutExecutingTraps();
  console.log('canary-admission-facts-provider.test.js: ok');
}

main();
