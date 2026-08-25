'use strict';

const assert = require('assert');

const {
  CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  CANARY_EDIT_ADMISSION_POLICY_VERSION,
  CANARY_EDIT_ADMISSION_REASONS,
  evaluateCanaryEditAdmission,
} = require('../main/agent_runtime/canary_edit_admission_policy');

const DIGEST = `sha256:${'a'.repeat(64)}`;

function binding(overrides = {}) {
  return {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/project-a',
    realRootPath: '/real/workspace/project-a',
    sessionId: 'session_canary-a',
    jobId: 'job-canary-a',
    kernelId: 'codex-app-server-canary',
    submissionDigest: DIGEST,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  const authorizedBinding = binding(overrides.binding);
  return {
    runtimeMode: 'canary',
    projectAuthorization: {
      authorized: true,
      binding: authorizedBinding,
      ...overrides.projectAuthorization,
    },
    editProfile: {
      kind: 'local_edit',
      installRequested: false,
      networkRequested: false,
      ...overrides.editProfile,
    },
    checkpoint: {
      checkpointDigest: `sha256:${'b'.repeat(64)}`,
      checkpointVerified: true,
      projectId: authorizedBinding.projectId,
      canonicalRootPath: authorizedBinding.canonicalRootPath,
      jobId: authorizedBinding.jobId,
      ...overrides.checkpoint,
    },
    rootMutation: {
      canonicalRootPath: authorizedBinding.canonicalRootPath,
      ownerJobId: authorizedBinding.jobId,
      activeOtherMutatingJobs: 0,
      ...overrides.rootMutation,
    },
    ...overrides.topLevel,
  };
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.strictEqual(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

assert.strictEqual(CANARY_EDIT_ADMISSION_POLICY_VERSION, 'canary-edit-admission-policy.v1');
assert.strictEqual(
  CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  'canary-edit-admission-decision.v1'
);
assert.deepStrictEqual(CANARY_EDIT_ADMISSION_REASONS, {
  ELIGIBLE: 'eligible',
  INVALID_INPUT: 'invalid_input',
  MODE_NOT_CANARY: 'mode_not_canary',
  PROJECT_NOT_AUTHORIZED: 'project_not_authorized',
  NOT_LOCAL_EDIT: 'not_local_edit',
  INSTALL_REQUESTED: 'install_requested',
  NETWORK_REQUESTED: 'network_requested',
  CHECKPOINT_INVALID: 'checkpoint_invalid',
  ROOT_MUTATION_NOT_EXCLUSIVE: 'root_mutation_not_exclusive',
});

const eligible = evaluateCanaryEditAdmission(candidate());
assert.deepStrictEqual(eligible, {
  schemaVersion: CANARY_EDIT_ADMISSION_DECISION_SCHEMA_VERSION,
  policyVersion: CANARY_EDIT_ADMISSION_POLICY_VERSION,
  eligible: true,
  reason: CANARY_EDIT_ADMISSION_REASONS.ELIGIBLE,
  prerequisites: {
    canaryMode: true,
    projectAuthorized: true,
    localEdit: true,
    installFree: true,
    networkFree: true,
    checkpointValid: true,
    rootMutationExclusive: true,
  },
});
assertDeepFrozen(eligible);

const equivalentPaths = candidate({
  checkpoint: { canonicalRootPath: '/workspace/project-a/.' },
  rootMutation: { canonicalRootPath: '/workspace/project-a/.' },
});
assert.strictEqual(evaluateCanaryEditAdmission(equivalentPaths).eligible, true);

const denials = [
  [
    candidate({ topLevel: { runtimeMode: 'shadow' } }),
    CANARY_EDIT_ADMISSION_REASONS.MODE_NOT_CANARY,
    'canaryMode',
  ],
  [
    candidate({ projectAuthorization: { authorized: false } }),
    CANARY_EDIT_ADMISSION_REASONS.PROJECT_NOT_AUTHORIZED,
    'projectAuthorized',
  ],
  [
    candidate({ editProfile: { kind: 'create_application' } }),
    CANARY_EDIT_ADMISSION_REASONS.NOT_LOCAL_EDIT,
    'localEdit',
  ],
  [
    candidate({ editProfile: { installRequested: true } }),
    CANARY_EDIT_ADMISSION_REASONS.INSTALL_REQUESTED,
    'installFree',
  ],
  [
    candidate({ editProfile: { networkRequested: true } }),
    CANARY_EDIT_ADMISSION_REASONS.NETWORK_REQUESTED,
    'networkFree',
  ],
  [
    candidate({ checkpoint: { checkpointVerified: false } }),
    CANARY_EDIT_ADMISSION_REASONS.CHECKPOINT_INVALID,
    'checkpointValid',
  ],
  [
    candidate({ checkpoint: { jobId: 'job-other' } }),
    CANARY_EDIT_ADMISSION_REASONS.CHECKPOINT_INVALID,
    'checkpointValid',
  ],
  [
    candidate({ checkpoint: { canonicalRootPath: '/workspace/project-b' } }),
    CANARY_EDIT_ADMISSION_REASONS.CHECKPOINT_INVALID,
    'checkpointValid',
  ],
  [
    candidate({ rootMutation: { activeOtherMutatingJobs: 1 } }),
    CANARY_EDIT_ADMISSION_REASONS.ROOT_MUTATION_NOT_EXCLUSIVE,
    'rootMutationExclusive',
  ],
  [
    candidate({ rootMutation: { ownerJobId: 'job-other' } }),
    CANARY_EDIT_ADMISSION_REASONS.ROOT_MUTATION_NOT_EXCLUSIVE,
    'rootMutationExclusive',
  ],
  [
    candidate({ rootMutation: { canonicalRootPath: '/workspace/project-b' } }),
    CANARY_EDIT_ADMISSION_REASONS.ROOT_MUTATION_NOT_EXCLUSIVE,
    'rootMutationExclusive',
  ],
];

for (const [input, reason, failedPrerequisite] of denials) {
  const decision = evaluateCanaryEditAdmission(input);
  assert.strictEqual(decision.eligible, false);
  assert.strictEqual(decision.reason, reason);
  assert.strictEqual(decision.prerequisites[failedPrerequisite], false);
  assertDeepFrozen(decision);
}

const precedence = evaluateCanaryEditAdmission(candidate({
  topLevel: { runtimeMode: 'legacy' },
  projectAuthorization: { authorized: false },
  editProfile: { kind: 'create_application', installRequested: true, networkRequested: true },
  checkpoint: { checkpointVerified: false },
  rootMutation: { activeOtherMutatingJobs: 2 },
}));
assert.strictEqual(precedence.reason, CANARY_EDIT_ADMISSION_REASONS.MODE_NOT_CANARY);

for (const invalidInput of [
  null,
  {},
  candidate({ topLevel: { unexpected: true } }),
  candidate({ binding: { submissionDigest: 'not-a-digest' } }),
  candidate({ checkpoint: { checkpointDigest: 'not-a-digest' } }),
  candidate({ rootMutation: { activeOtherMutatingJobs: -1 } }),
  new Proxy(candidate(), {}),
]) {
  const decision = evaluateCanaryEditAdmission(invalidInput);
  assert.strictEqual(decision.eligible, false);
  assert.strictEqual(decision.reason, CANARY_EDIT_ADMISSION_REASONS.INVALID_INPUT);
  assert.deepStrictEqual(Object.values(decision.prerequisites), Array(7).fill(false));
  assertDeepFrozen(decision);
}

let getterCalls = 0;
const accessorInput = candidate();
Object.defineProperty(accessorInput, 'runtimeMode', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 'canary';
  },
});
const accessorDecision = evaluateCanaryEditAdmission(accessorInput);
assert.strictEqual(accessorDecision.reason, CANARY_EDIT_ADMISSION_REASONS.INVALID_INPUT);
assert.strictEqual(getterCalls, 0);

console.log('canary edit admission policy tests passed');
