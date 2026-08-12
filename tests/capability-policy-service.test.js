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
    requiresSandbox: false,
  },
  grantAuthorization: { authorized: true },
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
  classification: { hardDeny: false, requiresApproval: true, requiresSandbox: false },
  grantAuthorization: { authorized: true },
});
assert.strictEqual(granted.decision, CAPABILITY_POLICY_DECISIONS.ALLOW);
assert.strictEqual(granted.reasonCode, 'GRANT_AUTHORIZED');

const approvalRequired = policy.evaluate({
  classification: { hardDeny: false, requiresApproval: true, requiresSandbox: false },
});
assert.strictEqual(approvalRequired.decision, CAPABILITY_POLICY_DECISIONS.REQUIRE_APPROVAL);

const sandboxUnavailable = policy.evaluate({
  classification: {
    hardDeny: false,
    requiresApproval: false,
    requiresSandbox: true,
    requiredSandboxFeatures: ['filesystem_scope', 'process_execute'],
  },
  grantAuthorization: { authorized: true },
  sandboxProbe: { state: 'unavailable', features: [] },
});
assert.deepStrictEqual(sandboxUnavailable, {
  decision: CAPABILITY_POLICY_DECISIONS.DENY,
  reasonCode: 'SANDBOX_UNAVAILABLE',
});

const insufficient = policy.evaluate({
  classification: {
    hardDeny: false,
    requiresApproval: false,
    requiresSandbox: true,
    requiredSandboxFeatures: ['filesystem_scope', 'process_execute'],
  },
  sandboxProbe: { state: 'enforced', features: ['filesystem_scope'] },
});
assert.strictEqual(insufficient.decision, CAPABILITY_POLICY_DECISIONS.DENY);
assert.strictEqual(insufficient.reasonCode, 'SANDBOX_GUARANTEES_INSUFFICIENT');

const autonomous = policy.evaluate({
  classification: { hardDeny: false, requiresApproval: false, requiresSandbox: false },
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

console.log('capability policy service tests passed');
