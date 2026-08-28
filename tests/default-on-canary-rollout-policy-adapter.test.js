'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  createDefaultOnRolloutPolicy,
} = require('../main/agent_runtime/default_on_rollout_policy');
const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');
const {
  DEFAULT_ON_CANARY_ROLLOUT_POLICY_ADAPTER_VERSION,
  createDefaultOnCanaryRolloutPolicyAdapter,
} = require('../main/services/default_on_canary_rollout_policy_adapter');

function binding(overrides = {}) {
  return createCapabilityDelegationBinding({
    projectId: 'project-default-on',
    canonicalRootPath: '/workspace/project-default-on',
    realRootPath: '/real/workspace/project-default-on',
    sessionId: 'session-default-on',
    jobId: 'job-default-on',
    kernelId: 'codex-app-server-v2',
    submissionDigest: `sha256:${'a'.repeat(64)}`,
    ...overrides,
  });
}

function authorization(inputBinding) {
  return Object.freeze({
    ok: true,
    authorized: true,
    projectId: inputBinding.projectId,
    rootPath: inputBinding.canonicalRootPath,
    canonicalRootPath: inputBinding.canonicalRootPath,
    realRootPath: inputBinding.realRootPath,
    physicalRootIdentity: Object.freeze({
      device: '1',
      inode: '2',
      entryDevice: '1',
      entryInode: '2',
      entryType: 'directory',
    }),
  });
}

function policy() {
  return createDefaultOnRolloutPolicy({
    stableReleaseVersions: Object.freeze(['2.8.0', '2.9.0']),
  });
}

function capture(rolloutPolicy, overrides = {}) {
  return rolloutPolicy.capture({
    jobId: 'job-default-on',
    projectId: 'project-default-on',
    canonicalRootPath: '/workspace/project-default-on',
    configuredMode: 'on',
    killSwitch: false,
    projectPin: null,
    allowlisted: true,
    approvedCohort: true,
    ...overrides,
  });
}

const selectedFacts = Object.freeze({
  killSwitch: false,
  projectPin: 'canary',
  allowlisted: true,
  internal: true,
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
});
const deniedFacts = Object.freeze({
  killSwitch: true,
  projectPin: 'legacy',
  allowlisted: false,
  internal: false,
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
});

assert.strictEqual(
  DEFAULT_ON_CANARY_ROLLOUT_POLICY_ADAPTER_VERSION,
  'default-on-canary-rollout-policy-adapter.v1'
);

const rolloutPolicy = policy();
capture(rolloutPolicy);
const authorizations = [];
const adapter = createDefaultOnCanaryRolloutPolicyAdapter({
  runtimeConfig: createHarnessRuntimeConfig({
    env: { FABER_HARNESS_V2_MODE: 'on' },
  }),
  rolloutPolicy,
  authorizeProjectBinding(projectId, rootPath) {
    const inputBinding = binding({ projectId, canonicalRootPath: rootPath });
    authorizations.push({ projectId, rootPath });
    return authorization(inputBinding);
  },
});
assert.strictEqual(Object.isFrozen(adapter), true);
assert.deepStrictEqual(Reflect.ownKeys(adapter), [
  'version',
  'inspect',
  'diagnostics',
]);
assert.strictEqual(adapter.version, DEFAULT_ON_CANARY_ROLLOUT_POLICY_ADAPTER_VERSION);
assert.deepStrictEqual(adapter.inspect(binding()), selectedFacts);
assert.deepStrictEqual(authorizations, [{
  projectId: 'project-default-on',
  rootPath: '/workspace/project-default-on',
}]);
assert.deepStrictEqual(adapter.diagnostics(), {
  version: DEFAULT_ON_CANARY_ROLLOUT_POLICY_ADAPTER_VERSION,
  runtimeMode: 'on',
  snapshotMode: 'job_bound_immutable',
  authorizationMode: 'exact_project_root_revalidation',
  failureMode: 'deny',
});
assert.strictEqual(Object.isFrozen(adapter.diagnostics()), true);

const missingPolicy = policy();
const missingAdapter = createDefaultOnCanaryRolloutPolicyAdapter({
  runtimeConfig: createHarnessRuntimeConfig({
    env: { FABER_HARNESS_V2_MODE: 'on' },
  }),
  rolloutPolicy: missingPolicy,
  authorizeProjectBinding(projectId, rootPath) {
    return authorization(binding({ projectId, canonicalRootPath: rootPath }));
  },
});
assert.deepStrictEqual(missingAdapter.inspect(binding()), deniedFacts);

const baselinePolicy = policy();
capture(baselinePolicy, { allowlisted: false });
const baselineAdapter = createDefaultOnCanaryRolloutPolicyAdapter({
  runtimeConfig: createHarnessRuntimeConfig({
    env: { FABER_HARNESS_V2_MODE: 'on' },
  }),
  rolloutPolicy: baselinePolicy,
  authorizeProjectBinding(projectId, rootPath) {
    return authorization(binding({ projectId, canonicalRootPath: rootPath }));
  },
});
assert.deepStrictEqual(baselineAdapter.inspect(binding()), deniedFacts);

for (const changedBinding of [
  binding({ jobId: 'job-other' }),
  binding({ projectId: 'project-other' }),
  binding({ canonicalRootPath: '/workspace/other' }),
]) {
  assert.deepStrictEqual(adapter.inspect(changedBinding), deniedFacts);
}
assert.deepStrictEqual(adapter.inspect(null), deniedFacts);
assert.deepStrictEqual(adapter.inspect(new Proxy(binding(), {})), deniedFacts);

const mismatchedRoot = createDefaultOnCanaryRolloutPolicyAdapter({
  runtimeConfig: createHarnessRuntimeConfig({
    env: { FABER_HARNESS_V2_MODE: 'on' },
  }),
  rolloutPolicy,
  authorizeProjectBinding() {
    return authorization(binding({
      canonicalRootPath: '/workspace/changed',
      realRootPath: '/real/workspace/changed',
    }));
  },
});
assert.deepStrictEqual(mismatchedRoot.inspect(binding()), deniedFacts);

const inactive = createDefaultOnCanaryRolloutPolicyAdapter({
  runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
  rolloutPolicy,
  authorizeProjectBinding() {
    throw new Error('must not be called');
  },
});
assert.deepStrictEqual(inactive.inspect(binding()), deniedFacts);

assert.throws(
  () => createDefaultOnCanaryRolloutPolicyAdapter({
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'on' },
    }),
    rolloutPolicy,
    async authorizeProjectBinding() {
      return authorization(binding());
    },
  }),
  /authorizeProjectBinding|synchronous/i
);

console.log('default-on-canary-rollout-policy-adapter.test.js: ok');
