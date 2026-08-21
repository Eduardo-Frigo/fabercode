'use strict';

const assert = require('assert');
const childProcess = require('child_process');

const {
  ANCHORED_FILESYSTEM_MUTATION_BACKEND_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_LEGACY_SESSION_VERSION,
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
assert.throws(() => assertAnchoredFilesystemMutationProbe(
  createAnchoredFilesystemMutationProbe({
    backendId: 'unanchored-private-namespace',
    state: 'enforced',
    guarantees: ANCHORED_FILESYSTEM_MUTATION_REQUIRED_GUARANTEES.filter(
      (guarantee) => guarantee !== 'private_namespace_anchored'
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
  schemaVersion: ANCHORED_FILESYSTEM_MUTATION_LEGACY_SESSION_VERSION,
  verify() { return { verified: true }; },
  moveToQuarantine() { return { moved: true }; },
  restoreFromQuarantine() { return { restored: true }; },
  purgeQuarantine() { return { purged: true }; },
  close() { return { closed: true }; },
});
assert.strictEqual(assertAnchoredFilesystemMutationSession(session), session);
assert.strictEqual(
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  'anchored-filesystem-mutation-session.v2'
);
assert.throws(() => assertAnchoredFilesystemMutationSession({
  ...session,
  moveToQuarantine: undefined,
}), /moveToQuarantine/);
assert.throws(() => assertAnchoredFilesystemMutationSession({
  ...session,
  schemaVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
}), /version/);

// Backend validation never executes accessors or reads attacker-controlled
// thenables, and rejected native Promises are observed before synchronous
// denial so strict unhandled-rejection mode remains safe.
{
  let getterCalls = 0;
  const hostile = {
    prepare() {},
  };
  Object.defineProperty(hostile, 'probe', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return () => enforcedProbe;
    },
  });
  assert.throws(() => assertAnchoredFilesystemMutationBackend(hostile), /probe/);
  assert.strictEqual(getterCalls, 0);

  assert.throws(() => assertAnchoredFilesystemMutationBackend({
    probe() { return Promise.reject(new Error('async probe')); },
    prepare() {},
  }), /synchronous/);
  assert.throws(() => assertAnchoredFilesystemMutationBackend({
    probe() { throw Promise.reject(new Error('thrown rejected probe')); },
    prepare() {},
  }), /probe failed/);

  let thenGetterCalls = 0;
  const thenableProbe = {};
  Object.defineProperty(thenableProbe, 'then', {
    enumerable: true,
    get() {
      thenGetterCalls += 1;
      return () => {};
    },
  });
  assert.throws(() => assertAnchoredFilesystemMutationBackend({
    probe() { return thenableProbe; },
    prepare() {},
  }));
  assert.strictEqual(thenGetterCalls, 0);
}

// Malformed probe data is fully preflighted before its shape is rejected, so
// unknown and sibling native Promise rejections cannot escape strict mode.
{
  const contractPath = require.resolve(
    '../main/capabilities/anchored_filesystem_mutation_backend_contract'
  );
  const script = `
    const {
      assertAnchoredFilesystemMutationBackend,
    } = require(${JSON.stringify(contractPath)});
    try {
      assertAnchoredFilesystemMutationBackend({
        prepare() {},
        probe() {
          return {
            schemaVersion: 'anchored-filesystem-mutation-backend.v1',
            backendId: 'strict-probe',
            state: 'unavailable',
            guarantees: [Promise.reject(new Error('first rejected probe value'))],
            reasonCode: 'UNAVAILABLE',
            unknown: Promise.reject(new Error('second rejected probe value')),
          };
        },
      });
    } catch {}
    setImmediate(() => process.stdout.write('strict contract preflight survived'));
  `;
  const child = childProcess.spawnSync(process.execPath, [
    '--unhandled-rejections=strict',
    '-e',
    script,
  ], { encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /strict contract preflight survived/);
}

// Even the canonical fail-closed backend observes rejected input Promises
// before synchronously denying a call, including after a selected backend is
// revoked and delegates to this fallback.
{
  const contractPath = require.resolve(
    '../main/capabilities/anchored_filesystem_mutation_backend_contract'
  );
  const script = `
    const {
      createUnsupportedAnchoredFilesystemMutationBackend,
    } = require(${JSON.stringify(contractPath)});
    const backend = createUnsupportedAnchoredFilesystemMutationBackend({});
    try {
      backend.prepare({ nested: Promise.reject(new Error('rejected prepare input')) });
    } catch {}
    try {
      backend.openRootNamespace(Promise.reject(new Error('rejected root input')));
    } catch {}
    setImmediate(() => process.stdout.write('strict unsupported backend survived'));
  `;
  const child = childProcess.spawnSync(process.execPath, [
    '--unhandled-rejections=strict',
    '-e',
    script,
  ], { encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /strict unsupported backend survived/);
}

console.log('anchored filesystem mutation backend contract tests passed');
