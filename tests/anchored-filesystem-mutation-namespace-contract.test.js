'use strict';

const assert = require('assert');

const {
  ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION,
  ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  assertAnchoredFilesystemMutationNamespaceBackend,
  assertAnchoredFilesystemMutationNamespaceSession,
  assertAnchoredFilesystemMutationPrivateNamespace,
  assertAnchoredFilesystemMutationRootNamespace,
  createUnsupportedAnchoredFilesystemMutationBackend,
} = require('../main/capabilities/anchored_filesystem_mutation_backend_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;

function mutablePrivateNamespace() {
  return Object.freeze({
    capabilityVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
    writeFile() { return { written: true }; },
    readFile() { return { found: false, contentBase64: null, contentDigest: null }; },
    list() { return { entries: [] }; },
    remove() { return { removed: true }; },
    sync() { return { synced: true }; },
    cleanup() { return { cleaned: true }; },
  });
}

const privateNamespace = mutablePrivateNamespace();
assert.strictEqual(
  assertAnchoredFilesystemMutationPrivateNamespace(privateNamespace),
  privateNamespace
);
assert.throws(
  () => assertAnchoredFilesystemMutationPrivateNamespace({
    capabilityVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
    readFile() {},
    list() {},
  }),
  /shape is invalid/
);

const readOnlyNamespace = Object.freeze({
  capabilityVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  readFile() { return { found: false, contentBase64: null, contentDigest: null }; },
  list() { return { entries: [] }; },
});
assert.strictEqual(
  assertAnchoredFilesystemMutationPrivateNamespace(readOnlyNamespace, { readOnly: true }),
  readOnlyNamespace
);
assert.throws(() => assertAnchoredFilesystemMutationPrivateNamespace({
  ...readOnlyNamespace,
  writeFile() {},
}, { readOnly: true }), /shape is invalid/);
assert.throws(() => assertAnchoredFilesystemMutationPrivateNamespace({
  ...readOnlyNamespace,
  [Symbol('mutable')]: true,
}, { readOnly: true }), /shape is invalid/);
assert.throws(() => assertAnchoredFilesystemMutationPrivateNamespace(
  Object.assign(Object.create({ writeFile() {} }), readOnlyNamespace),
  { readOnly: true }
), /shape is invalid/);
let namespaceGetterCalls = 0;
const accessorNamespace = { ...readOnlyNamespace };
Object.defineProperty(accessorNamespace, 'readFile', {
  enumerable: true,
  get() {
    namespaceGetterCalls += 1;
    return () => {};
  },
});
assert.throws(
  () => assertAnchoredFilesystemMutationPrivateNamespace(
    accessorNamespace,
    { readOnly: true }
  ),
  /data property/
);
assert.strictEqual(namespaceGetterCalls, 0);

const session = Object.freeze({
  schemaVersion: ANCHORED_FILESYSTEM_MUTATION_SESSION_VERSION,
  helperId: 'native-helper',
  rootIdentityDigest: digest('a'),
  namespaceIdentityDigest: digest('b'),
  privateNamespace,
  verify() { return { verified: true }; },
  inspectProgress() { return { moved: [] }; },
  moveToQuarantine() { return { moved: [] }; },
  restoreFromQuarantine() { return { restored: [] }; },
  purgeQuarantine() { return { purged: true }; },
  close() { return { closed: true }; },
});
assert.strictEqual(assertAnchoredFilesystemMutationNamespaceSession(session), session);
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceSession({ ...session, inspectProgress: undefined }),
  /inspectProgress/
);
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceSession({ ...session, extraMutation() {} }),
  /shape is invalid/
);
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceSession({
    ...session,
    [Symbol('ambient-authority')]: true,
  }),
  /shape is invalid/
);
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceSession(
    Object.assign(Object.create({ inheritedMutation() {} }), session)
  ),
  /shape is invalid/
);
let sessionGetterCalls = 0;
const accessorSession = { ...session };
Object.defineProperty(accessorSession, 'helperId', {
  enumerable: true,
  get() {
    sessionGetterCalls += 1;
    return 'native-helper';
  },
});
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceSession(accessorSession),
  /data property/
);
assert.strictEqual(sessionGetterCalls, 0);

const rootNamespace = Object.freeze({
  schemaVersion: ANCHORED_FILESYSTEM_MUTATION_ROOT_NAMESPACE_VERSION,
  helperId: 'native-helper',
  rootIdentityDigest: digest('a'),
  namespaceIdentityDigest: digest('b'),
  privateNamespace: readOnlyNamespace,
  cleanupAuthenticatedOrphan() { return { cleaned: true }; },
  openExistingSession() { return session; },
  close() { return { closed: true }; },
});
assert.strictEqual(assertAnchoredFilesystemMutationRootNamespace(rootNamespace), rootNamespace);
assert.throws(
  () => assertAnchoredFilesystemMutationRootNamespace({
    ...rootNamespace,
    rootIdentityDigest: 'not-a-digest',
  }),
  /rootIdentityDigest.*invalid/
);
assert.throws(
  () => assertAnchoredFilesystemMutationRootNamespace({ ...rootNamespace, remove() {} }),
  /shape is invalid/
);
assert.throws(
  () => assertAnchoredFilesystemMutationRootNamespace({
    ...rootNamespace,
    [Symbol('ambient-authority')]: true,
  }),
  /shape is invalid/
);
assert.throws(
  () => assertAnchoredFilesystemMutationRootNamespace(
    Object.assign(Object.create({ inheritedMutation() {} }), rootNamespace)
  ),
  /shape is invalid/
);
let rootGetterCalls = 0;
const accessorRoot = { ...rootNamespace };
Object.defineProperty(accessorRoot, 'helperId', {
  enumerable: true,
  get() {
    rootGetterCalls += 1;
    return 'native-helper';
  },
});
assert.throws(
  () => assertAnchoredFilesystemMutationRootNamespace(accessorRoot),
  /data property/
);
assert.strictEqual(rootGetterCalls, 0);

const legacy = createUnsupportedAnchoredFilesystemMutationBackend({});
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceBackend(legacy),
  /namespace-I\/O v2/
);
const namespaceBackend = Object.freeze({
  ...legacy,
  namespaceIoVersion: ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION,
  openRootNamespace() { return rootNamespace; },
});
assert.strictEqual(
  assertAnchoredFilesystemMutationNamespaceBackend(namespaceBackend),
  namespaceBackend
);

let versionGetterCalls = 0;
const hostileVersion = { ...namespaceBackend };
Object.defineProperty(hostileVersion, 'namespaceIoVersion', {
  enumerable: true,
  get() {
    versionGetterCalls += 1;
    return ANCHORED_FILESYSTEM_MUTATION_NAMESPACE_IO_VERSION;
  },
});
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceBackend(hostileVersion),
  /namespace-I\/O v2/
);
assert.strictEqual(versionGetterCalls, 0);

console.log('anchored filesystem mutation namespace contract tests passed');
