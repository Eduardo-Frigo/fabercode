'use strict';

const assert = require('assert');

const {
  PROJECT_ROOT_PHYSICAL_IDENTITY_VERSION,
  createProjectRootPhysicalIdentityDigest,
} = require('../main/capabilities/project_root_authority_contract');

const identity = {
  device: '1',
  inode: '2',
  entryDevice: '1',
  entryInode: '2',
  entryType: 'directory',
};

assert.strictEqual(
  PROJECT_ROOT_PHYSICAL_IDENTITY_VERSION,
  'project-root-physical-identity.v1'
);
const first = createProjectRootPhysicalIdentityDigest(identity);
const reordered = createProjectRootPhysicalIdentityDigest({
  entryType: 'directory',
  entryInode: '2',
  entryDevice: '1',
  inode: '2',
  device: '1',
});
assert.match(first, /^sha256:[a-f0-9]{64}$/);
assert.strictEqual(first, reordered);
assert.notStrictEqual(
  first,
  createProjectRootPhysicalIdentityDigest({ ...identity, inode: '3' })
);
assert.notStrictEqual(
  first,
  createProjectRootPhysicalIdentityDigest({ ...identity, entryType: 'symlink' })
);
assert.throws(
  () => createProjectRootPhysicalIdentityDigest({ ...identity, extra: true }),
  /identity|invalid/i
);
assert.throws(
  () => createProjectRootPhysicalIdentityDigest({ ...identity, inode: '' }),
  /identity|invalid/i
);
assert.throws(
  () => createProjectRootPhysicalIdentityDigest(Promise.resolve(identity)),
  /identity|invalid/i
);

console.log('project-root-identity-digest.test.js: ok');
