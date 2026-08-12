'use strict';

const assert = require('assert');

const {
  CAPABILITY_DELEGATION_AUTHORITY_KINDS,
  CAPABILITY_DELEGATION_EFFECTS,
  CAPABILITY_DELEGATION_MODES,
  CAPABILITY_DELEGATION_SCOPES,
  CAPABILITY_DELEGATION_STATUSES,
  DEFAULT_DELEGATION_CONSTRAINTS,
  DEFAULT_DELEGATION_TTL_MS,
  HARD_MAX_DELEGATION_CONSTRAINTS,
  MAX_DELEGATION_TTL_MS,
  createCapabilityDelegationAllowedEffects,
  createCapabilityDelegationAuditSummary,
  createCapabilityDelegationBinding,
  createCapabilityDelegationConstraints,
  createCapabilityDelegationDecisionRequest,
  createCapabilityDelegationImpact,
  createCapabilityDelegationPrincipal,
  createTaskDelegationRecord,
  immutableSnapshot,
  normalizeDigest,
} = require('../main/capabilities/capability_delegation_contracts');

const hex = (character) => character.repeat(64);
const digest = (character) => `sha256:${hex(character)}`;

function binding(overrides = {}) {
  return {
    projectId: 'project-a',
    canonicalRootPath: '/workspace/project-a',
    realRootPath: '/private/workspace/project-a',
    sessionId: 'session-a',
    jobId: 'job-a',
    kernelId: 'kernel-a',
    submissionDigest: digest('a'),
    ...overrides,
  };
}

function constraints(overrides = {}) {
  return {
    checkpointRequired: true,
    exactPathsOnly: true,
    rejectProtectedPaths: true,
    maxFilesPerDecision: 2,
    maxBytesPerDecision: 100,
    maxDirectoriesPerDecision: 1,
    maxFilesTotal: 4,
    maxBytesTotal: 200,
    maxDirectoriesTotal: 2,
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    delegationId: 'delegation-a',
    principal: { kind: 'user_ui', actorId: 'user-a' },
    binding: binding(),
    allowedEffects: [CAPABILITY_DELEGATION_EFFECTS.FILESYSTEM_DELETE],
    constraints: constraints(),
    issuedAt: 1_000,
    expiresAt: 1_000 + DEFAULT_DELEGATION_TTL_MS,
    status: CAPABILITY_DELEGATION_STATUSES.ACTIVE,
    revokedAt: null,
    revocationReason: '',
    consumedFiles: 0,
    consumedBytes: 0,
    consumedDirectories: 0,
    decisionCount: 0,
    ...overrides,
  };
}

assert.strictEqual(CAPABILITY_DELEGATION_MODES.ASK_EACH, 'ask_each');
assert.strictEqual(CAPABILITY_DELEGATION_MODES.DELEGATE_TASK, 'delegate_task');
assert.deepStrictEqual(CAPABILITY_DELEGATION_SCOPES, { TASK: 'task' });
assert.strictEqual(CAPABILITY_DELEGATION_AUTHORITY_KINDS.USER_DELEGATED_AGENT, 'user_delegated_agent');
assert.strictEqual(DEFAULT_DELEGATION_TTL_MS, 60 * 60 * 1000);
assert.strictEqual(MAX_DELEGATION_TTL_MS, 2 * 60 * 60 * 1000);

assert.strictEqual(normalizeDigest(hex('A'), 'digest'), digest('a'));
assert.strictEqual(normalizeDigest(`SHA256:${hex('A')}`, 'digest'), digest('a'));
assert.throws(() => normalizeDigest('not-a-digest', 'digest'), /SHA-256/);

const principal = createCapabilityDelegationPrincipal({ kind: 'user_ui', actorId: 'user-a' });
assert(Object.isFrozen(principal));
assert.throws(() => createCapabilityDelegationPrincipal({ kind: 'agent', actorId: 'agent-a' }), /user_ui/);
assert.throws(() => createCapabilityDelegationPrincipal({ kind: 'user_ui', actorId: 'u', authorized: true }), /unsupported/);

const normalizedBinding = createCapabilityDelegationBinding(binding({ submissionDigest: hex('A') }));
assert.strictEqual(normalizedBinding.submissionDigest, digest('a'));
const windowsBinding = createCapabilityDelegationBinding(binding({
  canonicalRootPath: 'C:\\Project',
  realRootPath: 'C:\\Real\\Project',
}));
assert.strictEqual(windowsBinding.canonicalRootPath, 'C:\\Project');
assert.throws(() => createCapabilityDelegationBinding(binding({ canonicalRootPath: 'relative/path' })), /absolute/);

const effects = createCapabilityDelegationAllowedEffects(['filesystem_delete']);
assert(Object.isFrozen(effects));
assert.throws(() => createCapabilityDelegationAllowedEffects(['filesystem_write']), /filesystem_delete/);
assert.throws(() => createCapabilityDelegationAllowedEffects(new Array(1)), /dense/);

const normalizedConstraints = createCapabilityDelegationConstraints(constraints());
assert(Object.isFrozen(normalizedConstraints));
const hardCeilingConstraints = createCapabilityDelegationConstraints(DEFAULT_DELEGATION_CONSTRAINTS);
for (const [field, ceiling] of Object.entries(HARD_MAX_DELEGATION_CONSTRAINTS)) {
  assert.strictEqual(hardCeilingConstraints[field], ceiling);
  assert.throws(() => createCapabilityDelegationConstraints({
    ...DEFAULT_DELEGATION_CONSTRAINTS,
    [field]: Number.MAX_SAFE_INTEGER,
  }), /hard security cap/);
}
assert.throws(() => createCapabilityDelegationConstraints(constraints({ checkpointRequired: false })), /remain true/);
assert.throws(() => createCapabilityDelegationConstraints(constraints({ maxFilesPerDecision: -0 })), /positive/);
assert.throws(() => createCapabilityDelegationConstraints(constraints({ maxFilesTotal: 1 })), /Cumulative/);

assert.deepStrictEqual(createCapabilityDelegationImpact({ files: 1, bytes: 0, directories: 0 }), {
  files: 1,
  bytes: 0,
  directories: 0,
});
assert.throws(() => createCapabilityDelegationImpact({ files: -0, bytes: 0, directories: 1 }), /non-negative/);
assert.throws(() => createCapabilityDelegationImpact({ files: 0, bytes: 0, directories: 0 }), /at least one/);

const inspectRequest = createCapabilityDelegationDecisionRequest({
  binding: binding(),
  effect: 'filesystem_delete',
  requestDigest: digest('b'),
  impactDigest: digest('c'),
  impact: { files: 1, bytes: 10, directories: 0 },
});
assert.strictEqual(inspectRequest.checkpointDigest, undefined);
assert.throws(() => createCapabilityDelegationDecisionRequest({ ...inspectRequest }, { requireCheckpoint: true }), /checkpoint/);
const consumableRequest = createCapabilityDelegationDecisionRequest({
  ...inspectRequest,
  checkpointDigest: digest('d'),
  checkpointVerified: true,
  exactPathsVerified: true,
  protectedPathsRejected: true,
}, { requireCheckpoint: true });
assert.strictEqual(consumableRequest.checkpointVerified, true);
assert(Object.isFrozen(consumableRequest.binding));
assert.throws(() => createCapabilityDelegationDecisionRequest({
  ...consumableRequest,
  protectedPathsRejected: false,
}, { requireCheckpoint: true }), /protectedPathsRejected/);

const delegation = createTaskDelegationRecord(record());
assert.strictEqual(delegation.mode, 'delegate_task');
assert.strictEqual(delegation.scope, 'task');
assert(Object.isFrozen(delegation));
assert(Object.isFrozen(delegation.binding));
assert.throws(() => createTaskDelegationRecord(record({ consumedFiles: 5 })), /must not exceed/);
assert.throws(() => createTaskDelegationRecord(record({
  expiresAt: 1_000 + MAX_DELEGATION_TTL_MS + 1,
})), /maximum TTL/);
assert.throws(() => createTaskDelegationRecord(record({
  status: CAPABILITY_DELEGATION_STATUSES.REVOKED,
  revokedAt: 2_000,
  revocationReason: '/workspace/project-a/secret.txt',
})), /safe reason code/);

const audit = createCapabilityDelegationAuditSummary('delegation_authorized', {
  delegationId: 'delegation-a',
  status: 'authorized',
  reason: 'delegation_authorized',
  effect: 'filesystem_delete',
  impact: { files: 1, bytes: 10, directories: 0 },
});
assert(Object.isFrozen(audit));
assert.strictEqual(JSON.stringify(audit).includes('/workspace'), false);
assert.strictEqual(JSON.stringify(audit).includes('sha256:'), false);
assert.throws(() => createCapabilityDelegationAuditSummary('event', {
  reason: '/workspace/secret',
}), /safe reason code/);
assert.throws(() => createCapabilityDelegationAuditSummary('event', {
  canonicalRootPath: '/workspace/project-a',
}), /unsupported/);

const sparse = [];
sparse.length = 1;
assert.throws(() => immutableSnapshot(sparse), /dense/);
assert.throws(() => immutableSnapshot({ value: undefined }), /undefined/);
assert.throws(() => immutableSnapshot({ value: -0 }), /negative zero/);
assert.throws(() => immutableSnapshot({ [Symbol('secret')]: true }), /symbol/);
const getter = {};
Object.defineProperty(getter, 'secret', { enumerable: true, get() { return 'path'; } });
assert.throws(() => immutableSnapshot(getter), /data properties/);
assert.throws(() => immutableSnapshot(JSON.parse('{"__proto__":{"polluted":true}}')), /forbidden/);

console.log('capability delegation contract tests passed');
