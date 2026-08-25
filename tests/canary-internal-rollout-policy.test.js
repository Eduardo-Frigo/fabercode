'use strict';

const assert = require('assert');

const {
  createCapabilityDelegationBinding,
} = require('../main/capabilities/capability_delegation_contracts');
const {
  CANARY_ROLLOUT_STAGES,
} = require('../main/agent_runtime/canary_rollout_selector');
const {
  createHarnessRuntimeConfig,
} = require('../main/agent_runtime/harness_runtime_config');
const {
  CANARY_INTERNAL_ROLLOUT_POLICY_VERSION,
  createCanaryInternalRolloutPolicy,
} = require('../main/services/canary_internal_rollout_policy');

const digest = (character) => `sha256:${character.repeat(64)}`;

function createBinding(overrides = {}) {
  return createCapabilityDelegationBinding({
    projectId: 'project-internal-a',
    canonicalRootPath: '/workspace/project-internal-a',
    realRootPath: '/physical/project-internal-a',
    sessionId: 'session-internal-a',
    jobId: 'job-internal-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: digest('a'),
    ...overrides,
  });
}

function authorizedProject(binding, overrides = {}) {
  return {
    ok: true,
    authorized: true,
    projectId: binding.projectId,
    canonicalRootPath: binding.canonicalRootPath,
    rootPath: binding.canonicalRootPath,
    realRootPath: binding.realRootPath,
    physicalRootIdentity: {
      device: '1',
      inode: '2',
      entryDevice: '1',
      entryInode: '2',
      entryType: 'directory',
    },
    ...overrides,
  };
}

function createPolicy({
  env = { FABER_HARNESS_V2_MODE: 'canary' },
  authorizeProjectBinding = null,
} = {}) {
  const binding = createBinding();
  const authorize = authorizeProjectBinding
    || ((projectId, rootPath) => {
      assert.strictEqual(projectId, binding.projectId);
      assert.strictEqual(rootPath, binding.canonicalRootPath);
      return authorizedProject(binding);
    });
  return {
    binding,
    policy: createCanaryInternalRolloutPolicy({
      runtimeConfig: createHarnessRuntimeConfig({ env }),
      authorizeProjectBinding: authorize,
    }),
  };
}

const SELECTED_INTERNAL = Object.freeze({
  killSwitch: false,
  projectPin: null,
  allowlisted: true,
  internal: true,
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
});

const NOT_ALLOWLISTED = Object.freeze({
  killSwitch: false,
  projectPin: null,
  allowlisted: false,
  internal: false,
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
});

function assertFrozenFacts(actual, expected) {
  assert.deepStrictEqual(actual, expected);
  assert.strictEqual(Object.isFrozen(actual), true);
  assert.deepStrictEqual(Reflect.ownKeys(actual), [
    'killSwitch',
    'projectPin',
    'allowlisted',
    'internal',
    'rolloutStage',
  ]);
}

function testAuthorizedBindingSelectsTheInternalCohort() {
  const calls = [];
  const binding = createBinding();
  const policy = createCanaryInternalRolloutPolicy({
    runtimeConfig: createHarnessRuntimeConfig({
      env: { FABER_HARNESS_V2_MODE: 'canary' },
    }),
    authorizeProjectBinding(projectId, rootPath) {
      calls.push({ projectId, rootPath });
      return authorizedProject(binding);
    },
  });

  const first = policy.inspect(binding);
  const second = policy.inspect(binding);
  assertFrozenFacts(first, SELECTED_INTERNAL);
  assert.strictEqual(first, second);
  assert.deepStrictEqual(calls, [
    {
      projectId: binding.projectId,
      rootPath: binding.canonicalRootPath,
    },
    {
      projectId: binding.projectId,
      rootPath: binding.canonicalRootPath,
    },
  ]);
  assert.deepStrictEqual(policy.diagnostics(), {
    version: CANARY_INTERNAL_ROLLOUT_POLICY_VERSION,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    allowlistMode: 'authorized_project_binding',
    projectPinMode: 'legacy_outside_canary',
    failureMode: 'deny',
  });
  assert.strictEqual(Object.isFrozen(policy.diagnostics()), true);
}

function testAuthorizationFailuresStayOutsideTheAllowlist() {
  const binding = createBinding();
  const cases = [
    () => ({ ok: false, authorized: false, message: 'denied' }),
    () => { throw new Error('authorization unavailable'); },
    () => Promise.reject(new Error('authorization must stay synchronous')),
    () => authorizedProject(binding, { projectId: 'project-other' }),
    () => authorizedProject(binding, { canonicalRootPath: '/workspace/other' }),
    () => authorizedProject(binding, { realRootPath: '/physical/other' }),
    () => ({ ...authorizedProject(binding), unexpectedAuthority: true }),
    () => ({
      ...authorizedProject(binding),
      physicalRootIdentity: { device: '1' },
    }),
  ];

  for (const authorizeProjectBinding of cases) {
    const policy = createCanaryInternalRolloutPolicy({
      runtimeConfig: createHarnessRuntimeConfig({
        env: { FABER_HARNESS_V2_MODE: 'canary' },
      }),
      authorizeProjectBinding,
    });
    assertFrozenFacts(policy.inspect(binding), NOT_ALLOWLISTED);
  }
}

function testRuntimeControlsPinNonCanaryModesBeforeAuthorization() {
  for (const mode of ['legacy', 'shadow', 'on']) {
    let calls = 0;
    const fixture = createPolicy({
      env: { FABER_HARNESS_V2_MODE: mode },
      authorizeProjectBinding() {
        calls += 1;
        throw new Error('must not authorize outside canary mode');
      },
    });
    assertFrozenFacts(fixture.policy.inspect(fixture.binding), {
      killSwitch: false,
      projectPin: 'legacy',
      allowlisted: false,
      internal: false,
      rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
    });
    assert.strictEqual(calls, 0);
  }

  let killedCalls = 0;
  const killed = createPolicy({
    env: {
      FABER_HARNESS_V2_MODE: 'canary',
      FABER_HARNESS_V2_KILL_SWITCH: 'true',
    },
    authorizeProjectBinding() {
      killedCalls += 1;
      throw new Error('must not authorize while killed');
    },
  });
  assertFrozenFacts(killed.policy.inspect(killed.binding), {
    killSwitch: true,
    projectPin: 'legacy',
    allowlisted: false,
    internal: false,
    rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  });
  assert.strictEqual(killedCalls, 0);
}

function testHostileValuesDenyWithoutExecutingTraps() {
  let inputTraps = 0;
  let authorizationCalls = 0;
  const hostileInput = new Proxy({}, {
    get() {
      inputTraps += 1;
      throw new Error('input trap must not execute');
    },
    ownKeys() {
      inputTraps += 1;
      throw new Error('input trap must not execute');
    },
  });
  const inputFixture = createPolicy({
    authorizeProjectBinding() {
      authorizationCalls += 1;
      return {};
    },
  });
  assertFrozenFacts(inputFixture.policy.inspect(hostileInput), NOT_ALLOWLISTED);
  assert.strictEqual(inputTraps, 0);
  assert.strictEqual(authorizationCalls, 0);

  let resultTraps = 0;
  const hostileResult = new Proxy({}, {
    get() {
      resultTraps += 1;
      throw new Error('result trap must not execute');
    },
    ownKeys() {
      resultTraps += 1;
      throw new Error('result trap must not execute');
    },
  });
  const resultFixture = createPolicy({
    authorizeProjectBinding: () => hostileResult,
  });
  assertFrozenFacts(
    resultFixture.policy.inspect(resultFixture.binding),
    NOT_ALLOWLISTED
  );
  assert.strictEqual(resultTraps, 0);

  let thenCalls = 0;
  const thenableFixture = createPolicy({
    authorizeProjectBinding: () => ({
      ...authorizedProject(createBinding()),
      then() {
        thenCalls += 1;
      },
    }),
  });
  assertFrozenFacts(
    thenableFixture.policy.inspect(thenableFixture.binding),
    NOT_ALLOWLISTED
  );
  assert.strictEqual(thenCalls, 0);
}

function testSurfaceAndConstructionAreMinimalAndStrict() {
  const fixture = createPolicy();
  assert.strictEqual(
    fixture.policy.version,
    CANARY_INTERNAL_ROLLOUT_POLICY_VERSION
  );
  assert.deepStrictEqual(Reflect.ownKeys(fixture.policy), [
    'version',
    'inspect',
    'diagnostics',
  ]);
  assert.strictEqual(Object.isFrozen(fixture.policy), true);

  assert.throws(
    () => createCanaryInternalRolloutPolicy({}),
    /rollout policy options|runtimeConfig|authorizeProjectBinding/i
  );
  assert.throws(
    () => createCanaryInternalRolloutPolicy({
      runtimeConfig: createHarnessRuntimeConfig({ env: {} }),
      async authorizeProjectBinding() {
        return {};
      },
    }),
    /synchronous|authorizeProjectBinding/i
  );
  assert.throws(
    () => createCanaryInternalRolloutPolicy({
      runtimeConfig: {
        ...createHarnessRuntimeConfig({
          env: { FABER_HARNESS_V2_MODE: 'canary' },
        }),
      },
      authorizeProjectBinding() {
        return {};
      },
    }),
    /runtimeConfig/i
  );
}

function main() {
  testSurfaceAndConstructionAreMinimalAndStrict();
  testAuthorizedBindingSelectsTheInternalCohort();
  testAuthorizationFailuresStayOutsideTheAllowlist();
  testRuntimeControlsPinNonCanaryModesBeforeAuthorization();
  testHostileValuesDenyWithoutExecutingTraps();
  console.log('canary-internal-rollout-policy.test.js: ok');
}

main();
