'use strict';

const assert = require('assert');
const crypto = require('crypto');

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
const {
  createAnchoredMutationIdentityReceipt,
} = require('../main/capabilities/anchored_mutation_identity_receipt_contract');
const {
  canonicalSha256Digest,
} = require('../main/capabilities/transactional_delete_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;
const hashedDigest = (seed) => (
  `sha256:${crypto.createHash('sha256').update(String(seed)).digest('hex')}`
);
const identity = (seed) => {
  const core = {
    volumeIdentityDigest: hashedDigest(`${seed}:volume`),
    objectIdentityDigest: hashedDigest(`${seed}:object`),
    generationIdentityDigest: hashedDigest(`${seed}:generation`),
  };
  return { ...core, identityDigest: canonicalSha256Digest(core) };
};
const rootIdentity = identity('root');
const namespaceIdentity = identity('namespace');
const targetIdentity = identity('target');
const identityReceipt = createAnchoredMutationIdentityReceipt({
  helperBuildId: 'native-helper-build-v1',
  platform: {
    os: 'linux',
    architecture: 'x64',
    filesystemType: 'ext4',
    capabilityDigest: hashedDigest('capability'),
  },
  bindingDigest: hashedDigest('binding'),
  checkpointDigest: hashedDigest('checkpoint'),
  rootIdentity,
  namespaceIdentity,
  targets: [{
    relativePath: 'target.txt',
    payloadName: '0000',
    kind: 'file',
    identity: targetIdentity,
    closureDigest: null,
    linkIdentityDigest: null,
  }],
  entries: [{
    relativePath: 'target.txt',
    kind: 'file',
    identity: targetIdentity,
    closureDigest: null,
    linkIdentityDigest: null,
  }],
});

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
  rootIdentityDigest: rootIdentity.identityDigest,
  namespaceIdentityDigest: namespaceIdentity.identityDigest,
  identityReceipt,
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
  () => assertAnchoredFilesystemMutationNamespaceSession({ ...session, identityReceipt: undefined }),
  /identityReceipt|native Promises|receipt/i
);
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceSession({
    ...session,
    rootIdentityDigest: digest('a'),
  }),
  /rootIdentityDigest.*identityReceipt/
);
assert.throws(
  () => assertAnchoredFilesystemMutationNamespaceSession({
    ...session,
    namespaceIdentityDigest: digest('b'),
  }),
  /namespaceIdentityDigest.*identityReceipt/
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
  rootIdentityDigest: rootIdentity.identityDigest,
  namespaceIdentityDigest: namespaceIdentity.identityDigest,
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
  /namespace-I\/O v3/
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
  /namespace-I\/O v3/
);
assert.strictEqual(versionGetterCalls, 0);

console.log('anchored filesystem mutation namespace contract tests passed');
