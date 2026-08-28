'use strict';

const assert = require('assert');

const {
  DEFAULT_ON_ROLLOUT_POLICY_VERSION,
  DEFAULT_ON_ROLLOUT_REASONS,
  DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION,
  createDefaultOnRolloutPolicy,
} = require('../main/agent_runtime/default_on_rollout_policy');

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

function input(overrides = {}) {
  return {
    jobId: 'job-phase9-1',
    projectId: 'project-phase9',
    canonicalRootPath: '/workspace/project-phase9',
    configuredMode: 'on',
    killSwitch: false,
    projectPin: null,
    allowlisted: true,
    approvedCohort: true,
    ...overrides,
  };
}

function createReadyPolicy() {
  return createDefaultOnRolloutPolicy({
    stableReleaseVersions: Object.freeze(['2.8.0', '2.9.0']),
  });
}

assert.strictEqual(
  DEFAULT_ON_ROLLOUT_POLICY_VERSION,
  'default-on-rollout-policy.v1'
);
assert.strictEqual(
  DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION,
  'default-on-rollout-snapshot.v1'
);
assert.deepStrictEqual(DEFAULT_ON_ROLLOUT_REASONS, {
  DEFAULT_ON: 'default_on',
  INVALID_INPUT: 'invalid_input',
  KILL_SWITCH: 'kill_switch',
  PINNED_LEGACY: 'pinned_legacy',
  PINNED_V2: 'pinned_v2',
  STABILITY_GATE_NOT_MET: 'stability_gate_not_met',
  NOT_ALLOWLISTED: 'not_allowlisted',
  COHORT_NOT_APPROVED: 'cohort_not_approved',
  MODE_NOT_ON: 'mode_not_on',
});

const policy = createReadyPolicy();
assert.strictEqual(Object.isFrozen(policy), true);
assert.deepStrictEqual(Reflect.ownKeys(policy), [
  'version',
  'capture',
  'get',
  'diagnostics',
]);
assert.deepStrictEqual(policy.diagnostics(), {
  version: DEFAULT_ON_ROLLOUT_POLICY_VERSION,
  minimumStableVersions: 2,
  stableVersionCount: 2,
  stabilityGateSatisfied: true,
  precedence: 'kill_switch>project_pin>allowlist>cohort>default',
  snapshotMode: 'job_bound_immutable',
});
assertDeepFrozen(policy.diagnostics());
assert.strictEqual(JSON.stringify(policy.diagnostics()).includes('2.8.0'), false);

const selected = policy.capture(input());
assert.deepStrictEqual(selected, {
  schemaVersion: DEFAULT_ON_ROLLOUT_SNAPSHOT_SCHEMA_VERSION,
  policyVersion: DEFAULT_ON_ROLLOUT_POLICY_VERSION,
  jobId: 'job-phase9-1',
  projectId: 'project-phase9',
  canonicalRootPath: '/workspace/project-phase9',
  selectedKernel: 'v2',
  reason: DEFAULT_ON_ROLLOUT_REASONS.DEFAULT_ON,
  flags: {
    configuredMode: 'on',
    killSwitch: false,
    projectPin: null,
    allowlisted: true,
    approvedCohort: true,
  },
  releaseGate: {
    minimumStableVersions: 2,
    stableVersionCount: 2,
    satisfied: true,
  },
  policyDigest: selected.policyDigest,
});
assert.match(selected.policyDigest, /^sha256:[a-f0-9]{64}$/);
assertDeepFrozen(selected);
assert.strictEqual(policy.get('job-phase9-1'), selected);
assert.strictEqual(policy.capture(input()), selected);

// A running job consumes its captured snapshot. Later flag reads cannot switch it.
const retained = policy.get('job-phase9-1');
assert.strictEqual(retained.selectedKernel, 'v2');
assert.strictEqual(retained.flags.killSwitch, false);
assert.throws(
  () => policy.capture(input({ killSwitch: true })),
  (error) => error && error.code === 'ROLLOUT_SNAPSHOT_CONFLICT'
);
assert.strictEqual(policy.get('job-phase9-1'), retained);

function capture(overrides, jobId) {
  return createReadyPolicy().capture(input({
    jobId: jobId || `job-${Math.random()}`,
    ...overrides,
  }));
}

const killed = capture({
  killSwitch: true,
  projectPin: 'v2',
  allowlisted: true,
  approvedCohort: true,
}, 'job-killed');
assert.strictEqual(killed.selectedKernel, 'legacy');
assert.strictEqual(killed.reason, DEFAULT_ON_ROLLOUT_REASONS.KILL_SWITCH);

const pinnedLegacy = capture({
  projectPin: 'legacy',
  allowlisted: true,
  approvedCohort: true,
}, 'job-pinned-legacy');
assert.strictEqual(pinnedLegacy.selectedKernel, 'legacy');
assert.strictEqual(
  pinnedLegacy.reason,
  DEFAULT_ON_ROLLOUT_REASONS.PINNED_LEGACY
);

const pinnedV2 = capture({
  configuredMode: 'legacy',
  projectPin: 'v2',
  allowlisted: false,
  approvedCohort: false,
}, 'job-pinned-v2');
assert.strictEqual(pinnedV2.selectedKernel, 'v2');
assert.strictEqual(pinnedV2.reason, DEFAULT_ON_ROLLOUT_REASONS.PINNED_V2);

const notAllowlisted = capture({
  allowlisted: false,
  approvedCohort: true,
}, 'job-not-allowlisted');
assert.strictEqual(notAllowlisted.selectedKernel, 'legacy');
assert.strictEqual(
  notAllowlisted.reason,
  DEFAULT_ON_ROLLOUT_REASONS.NOT_ALLOWLISTED
);

const outsideCohort = capture({
  approvedCohort: false,
}, 'job-outside-cohort');
assert.strictEqual(outsideCohort.selectedKernel, 'legacy');
assert.strictEqual(
  outsideCohort.reason,
  DEFAULT_ON_ROLLOUT_REASONS.COHORT_NOT_APPROVED
);

const modeNotOn = capture({ configuredMode: 'canary' }, 'job-mode-not-on');
assert.strictEqual(modeNotOn.selectedKernel, 'legacy');
assert.strictEqual(modeNotOn.reason, DEFAULT_ON_ROLLOUT_REASONS.MODE_NOT_ON);

for (const stableReleaseVersions of [
  Object.freeze([]),
  Object.freeze(['2.9.0']),
]) {
  const gated = createDefaultOnRolloutPolicy({ stableReleaseVersions });
  const decision = gated.capture(input({
    jobId: `job-gated-${stableReleaseVersions.length}`,
    projectPin: 'v2',
  }));
  assert.strictEqual(decision.selectedKernel, 'legacy');
  assert.strictEqual(
    decision.reason,
    DEFAULT_ON_ROLLOUT_REASONS.STABILITY_GATE_NOT_MET
  );
  assert.strictEqual(decision.releaseGate.satisfied, false);
}

const stableDigestA = createReadyPolicy().capture(input({ jobId: 'job-stable' }));
const stableDigestB = createReadyPolicy().capture(input({ jobId: 'job-stable' }));
assert.strictEqual(stableDigestA.policyDigest, stableDigestB.policyDigest);
const changedProject = createReadyPolicy().capture(input({
  jobId: 'job-stable',
  projectId: 'project-other',
}));
assert.notStrictEqual(stableDigestA.policyDigest, changedProject.policyDigest);

for (const invalid of [
  null,
  {},
  input({ jobId: '../unsafe' }),
  input({ projectId: '' }),
  input({ canonicalRootPath: 'relative/project' }),
  input({ configuredMode: 'experimental' }),
  input({ killSwitch: 'false' }),
  input({ projectPin: 'canary' }),
  input({ allowlisted: 'yes' }),
  input({ approvedCohort: 1 }),
  input({ unexpected: true }),
  new Proxy(input(), {}),
]) {
  const invalidPolicy = createReadyPolicy();
  const decision = invalidPolicy.capture(invalid);
  assert.strictEqual(decision.selectedKernel, 'legacy');
  assert.strictEqual(decision.reason, DEFAULT_ON_ROLLOUT_REASONS.INVALID_INPUT);
  assert.strictEqual(decision.jobId, null);
  assert.strictEqual(decision.projectId, null);
  assert.strictEqual(decision.canonicalRootPath, null);
  assert.strictEqual(decision.policyDigest, null);
  assertDeepFrozen(decision);
}

let getterCalls = 0;
const accessor = input({ jobId: 'job-accessor' });
Object.defineProperty(accessor, 'projectId', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 'project-phase9';
  },
});
assert.strictEqual(
  createReadyPolicy().capture(accessor).reason,
  DEFAULT_ON_ROLLOUT_REASONS.INVALID_INPUT
);
assert.strictEqual(getterCalls, 0);

for (const invalidOptions of [
  {},
  { stableReleaseVersions: ['2.8.0', '2.9.0'] },
  { stableReleaseVersions: Object.freeze(['2.9.0', '2.9.0']) },
  { stableReleaseVersions: Object.freeze(['../2.8.0', '2.9.0']) },
  { stableReleaseVersions: Object.freeze(['2.8.0', '2.9.0']), extra: true },
]) {
  assert.throws(
    () => createDefaultOnRolloutPolicy(invalidOptions),
    /stableReleaseVersions|options/i
  );
}

console.log('default-on-rollout-policy.test.js: ok');
