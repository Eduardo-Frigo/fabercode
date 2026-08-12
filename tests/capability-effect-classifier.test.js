'use strict';

const assert = require('assert');

const {
  PROJECT_CAPABILITY_KINDS,
} = require('../main/capabilities/project_capability_contracts');

const {
  CAPABILITY_EFFECTS,
  CapabilityEffectClassifier,
  classifyCapabilityEffect,
} = require('../main/capabilities/capability_effect_classifier');

const payload = { path: 'src/app.js', operation: 'read', secret: 'do-not-log' };
const request = { action: 'file', payload };
const descriptor = {
  capability: 'filesystem.file',
  version: 'descriptor.v1',
  action: 'file',
  kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
  effects: [CAPABILITY_EFFECTS.FILESYSTEM_READ],
};
const classification = classifyCapabilityEffect({ request, descriptor });
assert.notStrictEqual(classification.canonicalPayload, payload, 'broker payload must be snapshotted');
assert.deepStrictEqual(classification.canonicalPayload, payload);
assert.strictEqual(Object.isFrozen(classification.canonicalPayload), true);
assert.deepStrictEqual(classification.effects, [CAPABILITY_EFFECTS.FILESYSTEM_READ]);
assert.strictEqual(classification.requiresApproval, false);
assert.strictEqual(classification.requiresSandbox, false);
assert.strictEqual(Object.isFrozen(classification), true);

let classifierPayload = null;
const deleteClassification = new CapabilityEffectClassifier().classify({
  request: { action: 'mutate', payload: { operation: 'delete', path: 'tmp/a.txt' } },
  descriptor: {
    capability: 'filesystem.mutate',
    version: 'descriptor.v1',
    action: 'mutate',
    kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
    effects: [CAPABILITY_EFFECTS.FILESYSTEM_DELETE, CAPABILITY_EFFECTS.DESTRUCTIVE],
    canonicalizePayload(input) {
      return { ...input, path: `canonical/${input.path}` };
    },
    classifyEffects(input) {
      classifierPayload = input;
      return {
        effects: [CAPABILITY_EFFECTS.FILESYSTEM_DELETE, CAPABILITY_EFFECTS.DESTRUCTIVE],
        risk: 'critical',
        requiresApproval: true,
      };
    },
  },
});
assert.strictEqual(classifierPayload.path, 'canonical/tmp/a.txt');
assert.strictEqual(deleteClassification.destructive, true);
assert.strictEqual(deleteClassification.requiresApproval, true);
assert.strictEqual(deleteClassification.risk, 'critical');

for (const [effect, declaredRisk, expectedRisk] of [
  [CAPABILITY_EFFECTS.DESTRUCTIVE, 'low', 'critical'],
  [CAPABILITY_EFFECTS.FILESYSTEM_DELETE, 'low', 'high'],
  [CAPABILITY_EFFECTS.NETWORK_ACCESS, 'medium', 'high'],
  [CAPABILITY_EFFECTS.FILESYSTEM_READ, 'critical', 'critical'],
]) {
  const riskClassification = classifyCapabilityEffect({
    request: { action: 'risk-check', payload: {} },
    descriptor: {
      capability: `risk.${effect}`,
      version: 'descriptor.v1',
      action: 'risk-check',
      kind: PROJECT_CAPABILITY_KINDS.APPLICATION,
      effects: [effect],
      risk: declaredRisk,
    },
  });
  assert.strictEqual(
    riskClassification.risk,
    expectedRisk,
    `${effect} cannot be labeled below its inferred risk`
  );
}

const processClassification = classifyCapabilityEffect({
  request: { action: 'run', payload: { command: 'npm' } },
  descriptor: {
    capability: 'process.run',
    version: 'descriptor.v1',
    action: 'run',
    kind: PROJECT_CAPABILITY_KINDS.PROCESS,
    effects: [CAPABILITY_EFFECTS.PROCESS_EXECUTE],
    requiredSandboxFeatures: [],
  },
});
assert.strictEqual(processClassification.requiresSandbox, true);
assert.deepStrictEqual(processClassification.requiredSandboxFeatures, [
  'filesystem_scope',
  'network_isolation',
  'process_execute',
  'process_tree_termination',
]);

assert.throws(() => classifyCapabilityEffect({
  request: { action: 'future', payload: {} },
  descriptor: {
    capability: 'future.capability',
    version: 'descriptor.v1',
    action: 'future',
    kind: PROJECT_CAPABILITY_KINDS.APPLICATION,
    effects: ['teleport'],
  },
}), /descriptor/);

const protectedPath = classifyCapabilityEffect({
  request: { action: 'write', payload: { path: '.git/config' } },
  descriptor: {
    capability: 'filesystem.write',
    version: 'descriptor.v1',
    action: 'write',
    kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
    effects: [CAPABILITY_EFFECTS.FILESYSTEM_WRITE],
    classifyEffects() {
      return {
        effects: [CAPABILITY_EFFECTS.FILESYSTEM_WRITE],
        hardDeny: true,
        hardDenyReason: 'PROTECTED_PROJECT_PATH',
      };
    },
  },
});
assert.strictEqual(protectedPath.hardDeny, true);
assert.strictEqual(protectedPath.hardDenyReason, 'PROTECTED_PROJECT_PATH');

assert.throws(() => classifyCapabilityEffect({
  request,
  descriptor: {
    capability: 'filesystem.file',
    action: 'file',
    kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
    effects: ['read'],
  },
}), /descriptor/);
assert.throws(() => classifyCapabilityEffect({
  request,
  descriptor: { ...descriptor, risk: 'whatever' },
}), /Unsupported capability risk/);
assert.throws(() => classifyCapabilityEffect({
  request,
  descriptor: { ...descriptor, canonicalizePayload: () => 'unsafe' },
}), /payload must be an object/);
assert.throws(() => classifyCapabilityEffect({
  request: {
    action: 'file',
    payload: JSON.parse('{"__proto__":{"polluted":true}}'),
  },
  descriptor,
}), /forbidden key: __proto__/);
assert.throws(() => classifyCapabilityEffect({
  request: { action: 'file', payload: {} },
  descriptor: {
    ...descriptor,
    createSelector() {
      return JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
    },
  },
}), /forbidden key: constructor/);
const sparseValues = new Array(1);
assert.throws(() => classifyCapabilityEffect({
  request: { action: 'file', payload: { values: sparseValues } },
  descriptor,
}), /arrays must be dense/);
assert.throws(() => classifyCapabilityEffect({
  request: { action: 'file', payload: { offset: -0 } },
  descriptor,
}), /negative zero/);
const symbolPayload = { path: 'src/app.js' };
symbolPayload[Symbol('hidden-scope')] = '/outside';
assert.throws(() => classifyCapabilityEffect({
  request: { action: 'file', payload: symbolPayload },
  descriptor,
}), /symbol keys/);
let payloadGetterCalls = 0;
const accessorPayload = {};
Object.defineProperty(accessorPayload, 'path', {
  enumerable: true,
  get() {
    payloadGetterCalls += 1;
    return 'src/app.js';
  },
});
assert.throws(() => classifyCapabilityEffect({
  request: { action: 'file', payload: accessorPayload },
  descriptor,
}), /enumerable data properties/);
assert.strictEqual(payloadGetterCalls, 0);

for (const [effect, expectedRisk] of [
  [CAPABILITY_EFFECTS.DURABLE_MEMORY_WRITE, 'medium'],
  [CAPABILITY_EFFECTS.EXTERNAL_READ, 'high'],
]) {
  const classified = classifyCapabilityEffect({
    request: { action: effect, payload: {} },
    descriptor: {
      capability: `effect.${effect}`,
      version: 'descriptor.v1',
      action: effect,
      kind: effect === CAPABILITY_EFFECTS.DURABLE_MEMORY_WRITE
        ? PROJECT_CAPABILITY_KINDS.MEMORY
        : PROJECT_CAPABILITY_KINDS.MCP,
      effects: [effect],
    },
  });
  assert.strictEqual(classified.requiresApproval, true, `${effect} must leave project autonomy`);
  assert.strictEqual(classified.risk, expectedRisk);
}
const externalMutation = classifyCapabilityEffect({
  request: { action: 'publish', payload: {} },
  descriptor: {
    capability: 'external.publish',
    version: 'descriptor.v1',
    action: 'publish',
    kind: PROJECT_CAPABILITY_KINDS.MCP,
    effects: [CAPABILITY_EFFECTS.EXTERNAL_MUTATION],
  },
});
assert.strictEqual(externalMutation.hardDeny, true);
assert.strictEqual(externalMutation.hardDenyReason, 'EXTERNAL_MUTATION_DISABLED');
const secretAccess = classifyCapabilityEffect({
  request: { action: 'read_secret', payload: {} },
  descriptor: {
    capability: 'secret.read',
    version: 'descriptor.v1',
    action: 'read_secret',
    kind: PROJECT_CAPABILITY_KINDS.FILESYSTEM,
    effects: [CAPABILITY_EFFECTS.SECRET_ACCESS],
  },
});
assert.strictEqual(secretAccess.hardDeny, true);
assert.strictEqual(secretAccess.hardDenyReason, 'SECRET_ACCESS_DISABLED');
assert.strictEqual({}.polluted, undefined, 'prototype pollution payloads must not collide with benign input');

console.log('capability effect classifier tests passed');
