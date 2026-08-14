'use strict';

const assert = require('assert');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES,
  ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  assertAnchoredFilesystemMutationBackend,
  assertAnchoredFilesystemMutationProbe,
  assertAnchoredFilesystemMutationSession,
  createAnchoredFilesystemMutationProbe,
  createUnsupportedAnchoredFilesystemMutationBackend,
} = require('../main/capabilities/anchored_filesystem_mutation_backend_contract');

const enforcedProbe = createAnchoredFilesystemMutationProbe({
  backendId: 'native-test-backend',
  state: ANCHORED_FILESYSTEM_MUTATION_PROBE_STATES.ENFORCED,
  guarantees: [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES],
  reasonCode: 'ENFORCED',
});
assert.strictEqual(enforcedProbe.schemaVersion, ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION);
assert.strictEqual(
  assertAnchoredFilesystemMutationProbe(enforcedProbe, { requireEnforced: true }).state,
  'enforced'
);
assert.throws(() => createAnchoredFilesystemMutationProbe({
  backendId: 'weak',
  state: 'enforced',
  guarantees: [],
  reasonCode: 'ENFORCED',
}) && assertAnchoredFilesystemMutationProbe(createAnchoredFilesystemMutationProbe({
  backendId: 'weak',
  state: 'enforced',
  guarantees: [],
  reasonCode: 'ENFORCED',
})), /omitted required guarantees/);
assert.throws(() => assertAnchoredFilesystemMutationProbe(
  createAnchoredFilesystemMutationProbe({
    backendId: 'unordered-progress',
    state: 'enforced',
    guarantees: ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES.filter(
      (guarantee) => guarantee !== 'ordered_prefix_progress'
    ),
    reasonCode: 'ENFORCED',
  })
), /omitted required guarantees/);
assert.throws(() => assertAnchoredFilesystemMutationProbe(
  createAnchoredFilesystemMutationProbe({
    backendId: 'direct-targets-only',
    state: 'enforced',
    guarantees: ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES.filter(
      (guarantee) => guarantee !== 'subtree_identity_bound'
    ),
    reasonCode: 'ENFORCED',
  })
), /omitted required guarantees/);

let hostileMapCalls = 0;
const hostileGuarantees = ['physical_root_pinned'];
Object.setPrototypeOf(hostileGuarantees, {
  map() {
    hostileMapCalls += 1;
    return [...ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES];
  },
});
assert.throws(() => createAnchoredFilesystemMutationProbe({
  backendId: 'hostile',
  state: 'enforced',
  guarantees: hostileGuarantees,
  reasonCode: 'ENFORCED',
}), /standard dense/);
assert.strictEqual(hostileMapCalls, 0);

const unsupported = createUnsupportedAnchoredFilesystemMutationBackend({});
assert.strictEqual(assertAnchoredFilesystemMutationBackend(unsupported), unsupported);
assert.throws(
  () => assertAnchoredFilesystemMutationProbe(unsupported.probe(), { requireEnforced: true }),
  /unavailable/
);
assert.throws(() => unsupported.prepare({}), (error) => (
  error.code === 'ATOMIC_MUTATION_BACKEND_UNAVAILABLE'
));

const session = Object.freeze({
  schemaVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  verify() { return { verified: true }; },
  moveToQuarantine() { return { moved: true }; },
  restoreFromQuarantine() { return { restored: true }; },
  purgeQuarantine() { return { purged: true }; },
  close() { return { closed: true }; },
});
assert.strictEqual(assertAnchoredFilesystemMutationSession(session), session);
assert.throws(() => assertAnchoredFilesystemMutationSession({
  ...session,
  moveToQuarantine: undefined,
}), /moveToQuarantine/);

console.log('anchored filesystem mutation backend contract tests passed');
