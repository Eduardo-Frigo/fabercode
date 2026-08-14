'use strict';

const assert = require('assert');

const {
  CAPABILITY_POLICY_DECISIONS,
  CapabilityPolicyService,
} = require('../main/capabilities/capability_policy_service');

const policy = new CapabilityPolicyService();

const hardDenied = policy.evaluate({
  classification: {
    hardDeny: true,
    hardDenyReason: 'CAPABILITY_DISABLED',
    effects: ['filesystem_delete', 'destructive'],
    requiresApproval: true,
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
  approvalAuthorization: { authorized: true },
});
assert.deepStrictEqual(hardDenied, {
  decision: CAPABILITY_POLICY_DECISIONS.DENY,
  reasonCode: 'CAPABILITY_DISABLED',
}, 'hard deny must take precedence over a grant');

const dynamicHardDeny = policy.evaluate({
  classification: {
    hardDeny: true,
    hardDenyReason: 'PROTECTED_PROJECT_PATH',
    requiresSandbox: false,
  },
});
assert.strictEqual(dynamicHardDeny.reasonCode, 'PROTECTED_PROJECT_PATH');

const granted = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['filesystem_write'],
    requiresApproval: true,
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
});
assert.strictEqual(granted.decision, CAPABILITY_POLICY_DECISIONS.ALLOW);
assert.strictEqual(granted.reasonCode, 'GRANT_AUTHORIZED');

const deleteGrantIgnored = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['filesystem_delete'],
    requiresApproval: true,
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
});
assert.deepStrictEqual(deleteGrantIgnored, {
  decision: CAPABILITY_POLICY_DECISIONS.REQUIRE_APPROVAL,
  reasonCode: 'APPROVAL_REQUIRED',
});

const destructiveGrantIgnored = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['destructive'],
    requiresApproval: true,
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
});
assert.deepStrictEqual(destructiveGrantIgnored, {
  decision: CAPABILITY_POLICY_DECISIONS.REQUIRE_APPROVAL,
  reasonCode: 'APPROVAL_REQUIRED',
});

const deleteApproved = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['filesystem_delete'],
    requiresApproval: true,
    requiresSandbox: false,
  },
  approvalAuthorization: { authorized: true },
});
assert.deepStrictEqual(deleteApproved, {
  decision: CAPABILITY_POLICY_DECISIONS.ALLOW,
  reasonCode: 'APPROVAL_AUTHORIZED',
});

const destructiveGrantAndApproval = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['destructive'],
    requiresApproval: true,
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
  approvalAuthorization: { authorized: true },
});
assert.deepStrictEqual(destructiveGrantAndApproval, {
  decision: CAPABILITY_POLICY_DECISIONS.ALLOW,
  reasonCode: 'APPROVAL_AUTHORIZED',
});

const approvalRequired = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['network_access'],
    requiresApproval: true,
    requiresSandbox: false,
  },
});
assert.strictEqual(approvalRequired.decision, CAPABILITY_POLICY_DECISIONS.REQUIRE_APPROVAL);

const sandboxUnavailable = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['filesystem_delete'],
    requiresApproval: true,
    requiresSandbox: true,
    requiredSandboxFeatures: ['filesystem_scope', 'process_execute'],
  },
  grantAuthorization: { authorized: true },
  approvalAuthorization: { authorized: true },
  sandboxProbe: { state: 'unavailable', features: [] },
});
assert.deepStrictEqual(sandboxUnavailable, {
  decision: CAPABILITY_POLICY_DECISIONS.DENY,
  reasonCode: 'SANDBOX_UNAVAILABLE',
});

const insufficient = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['process_execute'],
    requiresApproval: false,
    requiresSandbox: true,
    requiredSandboxFeatures: ['filesystem_scope', 'process_execute'],
  },
  sandboxProbe: { state: 'enforced', features: ['filesystem_scope'] },
});
assert.strictEqual(insufficient.decision, CAPABILITY_POLICY_DECISIONS.DENY);
assert.strictEqual(insufficient.reasonCode, 'SANDBOX_GUARANTEES_INSUFFICIENT');

const processCannotDowngradeSandbox = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['process_execute'],
    requiresApproval: false,
    requiresSandbox: false,
    requiredSandboxFeatures: [],
  },
  grantAuthorization: { authorized: true },
  approvalAuthorization: { authorized: true },
});
assert.deepStrictEqual(processCannotDowngradeSandbox, {
  decision: CAPABILITY_POLICY_DECISIONS.DENY,
  reasonCode: 'SANDBOX_UNAVAILABLE',
});

const processCannotDowngradeA1Features = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['process_execute'],
    requiresApproval: false,
    requiresSandbox: false,
    requiredSandboxFeatures: [],
  },
  sandboxProbe: { state: 'enforced', features: ['process_execute'] },
});
assert.deepStrictEqual(processCannotDowngradeA1Features, {
  decision: CAPABILITY_POLICY_DECISIONS.DENY,
  reasonCode: 'SANDBOX_GUARANTEES_INSUFFICIENT',
});

for (const effect of ['network_access', 'external_read', 'durable_memory_write']) {
  const derivedApproval = policy.evaluate({
    classification: {
      hardDeny: false,
      effects: [effect],
      requiresApproval: false,
      requiresSandbox: false,
    },
  });
  assert.deepStrictEqual(derivedApproval, {
    decision: CAPABILITY_POLICY_DECISIONS.REQUIRE_APPROVAL,
    reasonCode: 'APPROVAL_REQUIRED',
  });
}

const autonomous = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['filesystem_read'],
    requiresApproval: false,
    requiresSandbox: false,
  },
});
assert.deepStrictEqual(autonomous, {
  decision: CAPABILITY_POLICY_DECISIONS.ALLOW,
  reasonCode: 'AUTOMATIC_PROJECT_AUTONOMY',
});

const externalMutationDisabled = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['external_mutation'],
    requiresApproval: true,
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
  approvalAuthorization: { authorized: true },
});
assert.deepStrictEqual(externalMutationDisabled, {
  decision: CAPABILITY_POLICY_DECISIONS.DENY,
  reasonCode: 'EXTERNAL_MUTATION_DISABLED',
});

const secretAccessDisabled = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['secret_access'],
    requiresApproval: true,
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
  approvalAuthorization: { authorized: true },
});
assert.deepStrictEqual(secretAccessDisabled, {
  decision: CAPABILITY_POLICY_DECISIONS.DENY,
  reasonCode: 'SECRET_ACCESS_DISABLED',
});

for (const effects of [undefined, [], ['delete'], ['rm'], ['FILESYSTEM_DELETE'], [' filesystem_delete ']]) {
  const malformed = policy.evaluate({
    classification: {
      hardDeny: false,
      effects,
      requiresApproval: false,
      requiresSandbox: false,
    },
    grantAuthorization: { authorized: true },
    approvalAuthorization: { authorized: true },
  });
  assert.strictEqual(malformed.decision, CAPABILITY_POLICY_DECISIONS.DENY);
  assert.ok(
    malformed.reasonCode === 'CAPABILITY_EFFECTS_MISSING'
      || malformed.reasonCode === 'CAPABILITY_EFFECT_UNKNOWN'
  );
}

const duplicateEffects = policy.evaluate({
  classification: {
    hardDeny: false,
    effects: ['filesystem_write', 'filesystem_write'],
    requiresApproval: false,
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
});
assert.deepStrictEqual(duplicateEffects, {
  decision: CAPABILITY_POLICY_DECISIONS.DENY,
  reasonCode: 'CAPABILITY_EFFECT_UNKNOWN',
});

console.log('capability policy service tests passed');
