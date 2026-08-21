'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');

const {
  ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION,
  assertAnchoredMutationIdentityReceipt,
  createAnchoredMutationIdentityReceipt,
} = require('../main/capabilities/anchored_mutation_identity_receipt_contract');

function digest(seed) {
  return `sha256:${crypto.createHash('sha256').update(String(seed)).digest('hex')}`;
}

function identity(seed) {
  const core = {
    volumeIdentityDigest: digest(`${seed}:volume`),
    objectIdentityDigest: digest(`${seed}:object`),
    generationIdentityDigest: digest(`${seed}:generation`),
  };
  return {
    ...core,
    identityDigest: require('../main/capabilities/transactional_delete_contracts')
      .canonicalSha256Digest(core),
  };
}

function input(overrides = {}) {
  const rootIdentity = identity('root');
  const namespaceIdentity = identity('namespace');
  const fileIdentity = identity('file-a');
  return {
    helperBuildId: 'test-helper-build-v1',
    platform: {
      os: 'linux',
      architecture: 'x64',
      filesystemType: 'ext4',
      capabilityDigest: digest('linux-x64-ext4-capability'),
    },
    bindingDigest: digest('binding'),
    checkpointDigest: digest('checkpoint'),
    rootIdentity,
    namespaceIdentity,
    targets: [{
      relativePath: 'src/file.txt',
      payloadName: '0000',
      kind: 'file',
      identity: fileIdentity,
      closureDigest: null,
      linkIdentityDigest: null,
    }],
    entries: [{
      relativePath: 'src/file.txt',
      kind: 'file',
      identity: fileIdentity,
      closureDigest: null,
      linkIdentityDigest: null,
    }],
    ...overrides,
  };
}

function expectedContext(value = input()) {
  return {
    bindingDigest: value.bindingDigest,
    checkpointDigest: value.checkpointDigest,
    targets: value.targets.map(({ relativePath, payloadName }) => ({ relativePath, payloadName })),
    checkpointEntries: value.entries.map(({ relativePath, kind }) => ({
      relativePath,
      kind,
      bytes: kind === 'directory' ? 0 : 1,
      mode: kind === 'directory' ? 0o755 : 0o644,
      mtimeMs: 1,
      contentDigest: kind === 'directory' ? null : digest(`content:${relativePath}`),
      linkTarget: kind === 'symlink' ? 'target' : null,
    })),
  };
}

const created = createAnchoredMutationIdentityReceipt(input());
assert.strictEqual(created.schemaVersion, ANCHORED_MUTATION_IDENTITY_RECEIPT_VERSION);
assert.ok(Object.isFrozen(created));
assert.ok(Object.isFrozen(created.platform));
assert.ok(Object.isFrozen(created.rootIdentity));
assert.ok(Object.isFrozen(created.targets));
assert.ok(Object.isFrozen(created.targets[0].identity));
assert.strictEqual(created.targetSetIdentityDigest, require('../main/capabilities/transactional_delete_contracts')
  .canonicalSha256Digest(created.targets));
assert.strictEqual(created.entrySetIdentityDigest, require('../main/capabilities/transactional_delete_contracts')
  .canonicalSha256Digest(created.entries));
assert.strictEqual(
  assertAnchoredMutationIdentityReceipt(created, expectedContext()).receiptDigest,
  created.receiptDigest
);

assert.throws(
  () => assertAnchoredMutationIdentityReceipt(created, {
    ...expectedContext(),
    bindingDigest: digest('other-binding'),
  }),
  /bindingDigest|binding/i
);
assert.throws(
  () => assertAnchoredMutationIdentityReceipt(created, {
    ...expectedContext(),
    checkpointDigest: digest('other-checkpoint'),
  }),
  /checkpointDigest|checkpoint/i
);
assert.throws(
  () => assertAnchoredMutationIdentityReceipt(created, {
    ...expectedContext(),
    targets: [{ relativePath: 'other.txt', payloadName: '0000' }],
  }),
  /targets|target/i
);

// Kind-specific receipts bind directory closure and the symlink itself.
{
  const directoryIdentity = identity('dir');
  const childIdentity = identity('dir-child');
  const directoryInput = input({
    targets: [{
      relativePath: 'src',
      payloadName: '0000',
      kind: 'directory',
      identity: directoryIdentity,
      closureDigest: digest('src-closure'),
      linkIdentityDigest: null,
    }],
    entries: [
      {
        relativePath: 'src',
        kind: 'directory',
        identity: directoryIdentity,
        closureDigest: digest('src-closure'),
        linkIdentityDigest: null,
      },
      {
        relativePath: 'src/child.txt',
        kind: 'file',
        identity: childIdentity,
        closureDigest: null,
        linkIdentityDigest: null,
      },
    ],
  });
  assertAnchoredMutationIdentityReceipt(
    createAnchoredMutationIdentityReceipt(directoryInput),
    expectedContext(directoryInput)
  );
  assert.throws(
    () => createAnchoredMutationIdentityReceipt({
      ...directoryInput,
      targets: [{ ...directoryInput.targets[0], closureDigest: null }],
    }),
    /closureDigest/i
  );

  const symlinkIdentity = identity('link');
  const symlinkInput = input({
    targets: [{
      relativePath: 'link',
      payloadName: '0000',
      kind: 'symlink',
      identity: symlinkIdentity,
      closureDigest: null,
      linkIdentityDigest: digest('link-itself'),
    }],
    entries: [{
      relativePath: 'link',
      kind: 'symlink',
      identity: symlinkIdentity,
      closureDigest: null,
      linkIdentityDigest: digest('link-itself'),
    }],
  });
  assertAnchoredMutationIdentityReceipt(
    createAnchoredMutationIdentityReceipt(symlinkInput),
    expectedContext(symlinkInput)
  );
  assert.throws(
    () => createAnchoredMutationIdentityReceipt({
      ...symlinkInput,
      targets: [{ ...symlinkInput.targets[0], linkIdentityDigest: null }],
    }),
    /linkIdentityDigest/i
  );
}

// Physical aliases, duplicate paths and inconsistent target/entry identity are rejected.
{
  const duplicate = input();
  assert.throws(
    () => createAnchoredMutationIdentityReceipt({
      ...duplicate,
      targets: [duplicate.targets[0], {
        ...duplicate.targets[0],
        relativePath: 'src/alias.txt',
        payloadName: '0001',
      }],
      entries: [duplicate.entries[0], {
        ...duplicate.entries[0],
        relativePath: 'src/alias.txt',
      }],
    }),
    /alias|identity|duplicate/i
  );
  const samePhysicalObjectCore = {
    volumeIdentityDigest: duplicate.targets[0].identity.volumeIdentityDigest,
    objectIdentityDigest: duplicate.targets[0].identity.objectIdentityDigest,
    generationIdentityDigest: digest('claimed-other-generation'),
  };
  const samePhysicalObject = {
    ...samePhysicalObjectCore,
    identityDigest: require('../main/capabilities/transactional_delete_contracts')
      .canonicalSha256Digest(samePhysicalObjectCore),
  };
  assert.throws(
    () => createAnchoredMutationIdentityReceipt({
      ...duplicate,
      targets: [duplicate.targets[0], {
        ...duplicate.targets[0],
        relativePath: 'src/physical-alias.txt',
        payloadName: '0001',
        identity: samePhysicalObject,
      }],
      entries: [duplicate.entries[0], {
        ...duplicate.entries[0],
        relativePath: 'src/physical-alias.txt',
        identity: samePhysicalObject,
      }],
    }),
    /physical alias|duplicate/i
  );
  assert.throws(
    () => createAnchoredMutationIdentityReceipt({
      ...duplicate,
      entries: [duplicate.entries[0], { ...duplicate.entries[0] }],
    }),
    /duplicate/i
  );
  assert.throws(
    () => createAnchoredMutationIdentityReceipt({
      ...duplicate,
      entries: [{ ...duplicate.entries[0], identity: identity('replacement') }],
    }),
    /target.*entry|identity/i
  );
}

// Every level is exact data-only: no extras, symbols, accessors, hostile prototypes or Proxies.
for (const invalid of [
  { ...input(), extra: true },
  Object.assign(Object.create({ inherited: true }), input()),
  Object.assign(input(), { [Symbol('extra')]: true }),
  new Proxy(input(), {}),
]) {
  assert.throws(() => createAnchoredMutationIdentityReceipt(invalid), /shape|plain|field|property|proxy/i);
}
{
  const accessor = input();
  Object.defineProperty(accessor, 'helperBuildId', {
    enumerable: true,
    get() { throw new Error('must not run'); },
  });
  assert.throws(() => createAnchoredMutationIdentityReceipt(accessor), /data property|shape/i);
  const symbolNested = input();
  symbolNested.platform[Symbol('extra')] = true;
  assert.throws(() => createAnchoredMutationIdentityReceipt(symbolNested), /field|property|shape/i);
  const sparse = input();
  sparse.targets = new Array(1);
  assert.throws(() => createAnchoredMutationIdentityReceipt(sparse), /dense|array/i);
}

// Derived digests are recomputed, including every nested physical identity.
assert.throws(
  () => createAnchoredMutationIdentityReceipt({
    ...input(),
    rootIdentity: { ...identity('root'), identityDigest: digest('forged') },
  }),
  /identityDigest/i
);
assert.throws(
  () => assertAnchoredMutationIdentityReceipt({ ...created, receiptDigest: digest('forged') }),
  /receiptDigest/i
);
assert.throws(
  () => assertAnchoredMutationIdentityReceipt({
    ...created,
    targetSetIdentityDigest: digest('forged'),
  }),
  /targetSetIdentityDigest/i
);

// Hard bounds are checked before accepting potentially expensive receipts.
{
  const targets = [];
  const entries = [];
  for (let index = 0; index < 33; index += 1) {
    const entryIdentity = identity(`bounded-${index}`);
    targets.push({
      relativePath: `file-${index}.txt`,
      payloadName: String(index).padStart(4, '0'),
      kind: 'file',
      identity: entryIdentity,
      closureDigest: null,
      linkIdentityDigest: null,
    });
    entries.push({
      relativePath: `file-${index}.txt`,
      kind: 'file',
      identity: entryIdentity,
      closureDigest: null,
      linkIdentityDigest: null,
    });
  }
  assert.throws(
    () => createAnchoredMutationIdentityReceipt(input({ targets, entries })),
    /bound|32|limit/i
  );
}

// Rejected native Promises anywhere in the graph are absorbed without reading `.then`.
{
  const modulePath = require.resolve('../main/capabilities/anchored_mutation_identity_receipt_contract');
  const script = String.raw`
    const { createAnchoredMutationIdentityReceipt } = require(${JSON.stringify(modulePath)});
    const p1 = Promise.reject(new Error('hidden-one'));
    const p2 = Promise.reject(new Error('hidden-two'));
    const value = { extra: { sibling: p1 }, another: p2 };
    Object.defineProperty(value, 'then', {
      enumerable: true,
      get() { process.exit(91); }
    });
    try { createAnchoredMutationIdentityReceipt(value); } catch {}
    setImmediate(() => process.exit(0));
  `;
  const child = childProcess.spawnSync(process.execPath, [
    '--unhandled-rejections=strict',
    '-e',
    script,
  ], { encoding: 'utf8' });
  assert.strictEqual(child.status, 0, `${child.stdout}\n${child.stderr}`);
}

console.log('anchored mutation identity receipt contract tests passed');
