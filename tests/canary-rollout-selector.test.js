'use strict';

const assert = require('assert');

const {
  CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
  CANARY_ROLLOUT_REASONS,
  CANARY_ROLLOUT_SELECTOR_VERSION,
  CANARY_ROLLOUT_STAGES,
  createCanaryRolloutSelector,
} = require('../main/agent_runtime/canary_rollout_selector');

function input(overrides = {}) {
  return {
    killSwitch: false,
    configuredMode: 'canary',
    projectId: 'project-a',
    projectPin: null,
    allowlisted: true,
    internal: false,
    rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_50,
    ...overrides,
  };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

assert.strictEqual(CANARY_ROLLOUT_SELECTOR_VERSION, 'canary-rollout-selector.v1');
assert.strictEqual(
  CANARY_ROLLOUT_DECISION_SCHEMA_VERSION,
  'canary-rollout-decision.v1'
);
assert.deepStrictEqual(CANARY_ROLLOUT_STAGES, {
  INTERNAL: 'internal',
  PERCENT_1: '1_percent',
  PERCENT_5: '5_percent',
  PERCENT_25: '25_percent',
  PERCENT_50: '50_percent',
});
assert.deepStrictEqual(CANARY_ROLLOUT_REASONS, {
  SELECTED_INTERNAL: 'selected_internal',
  SELECTED_COHORT: 'selected_cohort',
  SELECTED_PROJECT_PIN: 'selected_project_pin',
  INVALID_INPUT: 'invalid_input',
  KILL_SWITCH: 'kill_switch',
  MODE_NOT_CANARY: 'mode_not_canary',
  PINNED_LEGACY: 'pinned_legacy',
  NOT_ALLOWLISTED: 'not_allowlisted',
  INTERNAL_ONLY: 'internal_only',
  OUTSIDE_COHORT: 'outside_cohort',
});

const selector = createCanaryRolloutSelector({ cohortSeed: 'faber-test-seed-v1' });
assert.strictEqual(Object.isFrozen(selector), true);
assert.strictEqual(selector.version, CANARY_ROLLOUT_SELECTOR_VERSION);
assert.deepStrictEqual(selector.diagnostics(), {
  version: CANARY_ROLLOUT_SELECTOR_VERSION,
  algorithm: 'sha256-project-cohort.v1',
  stages: {
    internal: 0,
    '1_percent': 100,
    '5_percent': 500,
    '25_percent': 2500,
    '50_percent': 5000,
  },
});
assertDeepFrozen(selector.diagnostics());
assert.strictEqual(JSON.stringify(selector.diagnostics()).includes('faber-test-seed-v1'), false);

const internal = selector.select(input({
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
  internal: true,
}));
assert.strictEqual(internal.selected, true);
assert.strictEqual(internal.reason, CANARY_ROLLOUT_REASONS.SELECTED_INTERNAL);
assert.strictEqual(internal.thresholdBasisPoints, 0);
assertDeepFrozen(internal);

const externalAtInternal = selector.select(input({
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
}));
assert.strictEqual(externalAtInternal.selected, false);
assert.strictEqual(externalAtInternal.reason, CANARY_ROLLOUT_REASONS.INTERNAL_ONLY);

const killedPin = selector.select(input({
  killSwitch: true,
  projectPin: 'canary',
  allowlisted: false,
}));
assert.strictEqual(killedPin.selected, false);
assert.strictEqual(killedPin.reason, CANARY_ROLLOUT_REASONS.KILL_SWITCH);

const wrongModePin = selector.select(input({
  configuredMode: 'shadow',
  projectPin: 'canary',
}));
assert.strictEqual(wrongModePin.selected, false);
assert.strictEqual(wrongModePin.reason, CANARY_ROLLOUT_REASONS.MODE_NOT_CANARY);

const legacyPin = selector.select(input({ projectPin: 'legacy' }));
assert.strictEqual(legacyPin.selected, false);
assert.strictEqual(legacyPin.reason, CANARY_ROLLOUT_REASONS.PINNED_LEGACY);

const canaryPin = selector.select(input({
  projectPin: 'canary',
  allowlisted: false,
  rolloutStage: CANARY_ROLLOUT_STAGES.INTERNAL,
}));
assert.strictEqual(canaryPin.selected, true);
assert.strictEqual(canaryPin.reason, CANARY_ROLLOUT_REASONS.SELECTED_PROJECT_PIN);

const notAllowlisted = selector.select(input({ allowlisted: false }));
assert.strictEqual(notAllowlisted.selected, false);
assert.strictEqual(notAllowlisted.reason, CANARY_ROLLOUT_REASONS.NOT_ALLOWLISTED);

const cohortSamples = [];
for (let index = 0; index < 50_000 && cohortSamples.filter(Boolean).length < 4; index += 1) {
  const decision = selector.select(input({ projectId: `project-cohort-${index}` }));
  const score = decision.cohortBasisPoints;
  if (score < 100 && !cohortSamples[0]) cohortSamples[0] = `project-cohort-${index}`;
  if (score >= 100 && score < 500 && !cohortSamples[1]) cohortSamples[1] = `project-cohort-${index}`;
  if (score >= 500 && score < 2500 && !cohortSamples[2]) cohortSamples[2] = `project-cohort-${index}`;
  if (score >= 5000 && !cohortSamples[3]) cohortSamples[3] = `project-cohort-${index}`;
}
assert.strictEqual(cohortSamples.filter(Boolean).length, 4);

const [onePercentProject, fivePercentProject, twentyFivePercentProject, outsideProject] =
  cohortSamples;
for (const stage of [
  CANARY_ROLLOUT_STAGES.PERCENT_1,
  CANARY_ROLLOUT_STAGES.PERCENT_5,
  CANARY_ROLLOUT_STAGES.PERCENT_25,
  CANARY_ROLLOUT_STAGES.PERCENT_50,
]) {
  const decision = selector.select(input({ projectId: onePercentProject, rolloutStage: stage }));
  assert.strictEqual(decision.selected, true);
  assert.strictEqual(decision.reason, CANARY_ROLLOUT_REASONS.SELECTED_COHORT);
}
assert.strictEqual(selector.select(input({
  projectId: fivePercentProject,
  rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_1,
})).selected, false);
assert.strictEqual(selector.select(input({
  projectId: fivePercentProject,
  rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_5,
})).selected, true);
assert.strictEqual(selector.select(input({
  projectId: twentyFivePercentProject,
  rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_5,
})).selected, false);
assert.strictEqual(selector.select(input({
  projectId: twentyFivePercentProject,
  rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_25,
})).selected, true);
const outside = selector.select(input({
  projectId: outsideProject,
  rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_50,
}));
assert.strictEqual(outside.selected, false);
assert.strictEqual(outside.reason, CANARY_ROLLOUT_REASONS.OUTSIDE_COHORT);

const stableA = selector.select(input({ projectId: 'project-stable' }));
const stableB = createCanaryRolloutSelector({
  cohortSeed: 'faber-test-seed-v1',
}).select(input({ projectId: 'project-stable' }));
assert.strictEqual(stableA.cohortBasisPoints, stableB.cohortBasisPoints);

const internalDuringRollout = selector.select(input({
  internal: true,
  rolloutStage: CANARY_ROLLOUT_STAGES.PERCENT_1,
  projectId: outsideProject,
}));
assert.strictEqual(internalDuringRollout.selected, true);
assert.strictEqual(
  internalDuringRollout.reason,
  CANARY_ROLLOUT_REASONS.SELECTED_INTERNAL
);

for (const invalid of [
  null,
  {},
  input({ rolloutStage: '100_percent' }),
  input({ configuredMode: 'unsupported' }),
  input({ projectPin: 'shadow' }),
  input({ allowlisted: 'yes' }),
  input({ topLevel: true }),
  new Proxy(input(), {}),
]) {
  const decision = selector.select(invalid);
  assert.strictEqual(decision.selected, false);
  assert.strictEqual(decision.reason, CANARY_ROLLOUT_REASONS.INVALID_INPUT);
  assert.strictEqual(decision.cohortBasisPoints, null);
  assertDeepFrozen(decision);
}

let getterCalls = 0;
const accessor = input();
Object.defineProperty(accessor, 'projectId', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 'project-a';
  },
});
assert.strictEqual(
  selector.select(accessor).reason,
  CANARY_ROLLOUT_REASONS.INVALID_INPUT
);
assert.strictEqual(getterCalls, 0);

assert.throws(
  () => createCanaryRolloutSelector({ cohortSeed: '' }),
  /cohortSeed/
);
assert.throws(
  () => createCanaryRolloutSelector({ cohortSeed: 'valid', unexpected: true }),
  /options/
);

console.log('canary rollout selector tests passed');
