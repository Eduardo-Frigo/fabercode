'use strict';

const assert = require('assert');

const {
  TRANSACTIONAL_DELETE_CONTRACT_VERSION,
  TRANSACTIONAL_DELETE_ENTRY_KINDS,
  TRANSACTIONAL_DELETE_PATH_STYLES,
  TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES,
  TRANSACTIONAL_DELETE_STATES,
  assertTransactionalDeletePlan,
  canonicalSha256Digest,
  createTransactionalDeleteCheckpointManifest,
  createTransactionalDeleteImpact,
  createTransactionalDeletePlan,
  createTransactionalDeletePublicRequest,
  createTransactionalDeletePublicResult,
  createTransactionalDeleteStateRecord,
  isProtectedTransactionalDeletePath,
} = require('../main/capabilities/transactional_delete_contracts');
const {
  HARD_MAX_DELEGATION_CONSTRAINTS,
} = require('../main/capabilities/capability_delegation_contracts');

const digest = (character) => `sha256:${character.repeat(64)}`;

const request = createTransactionalDeletePublicRequest({
  paths: ['tmp/cache', 'src/old.js'],
}, { pathStyle: TRANSACTIONAL_DELETE_PATH_STYLES.POSIX, caseSensitive: true });
assert.strictEqual(request.contractVersion, TRANSACTIONAL_DELETE_CONTRACT_VERSION);
assert.deepStrictEqual(request.paths, ['src/old.js', 'tmp/cache']);
assert(Object.isFrozen(request));
assert(Object.isFrozen(request.paths));

const impact = createTransactionalDeleteImpact({ files: 1, bytes: 7, directories: 1 });
assert(Object.isFrozen(impact));
const plan = createTransactionalDeletePlan({
  request,
  pathStyle: TRANSACTIONAL_DELETE_PATH_STYLES.POSIX,
  caseSensitive: true,
  entries: [
    { relativePath: 'tmp/cache', kind: TRANSACTIONAL_DELETE_ENTRY_KINDS.DIRECTORY },
    { relativePath: 'src/old.js', kind: TRANSACTIONAL_DELETE_ENTRY_KINDS.FILE },
  ],
  impact,
});
assert(Object.isFrozen(plan));
assert(Object.isFrozen(plan.entries));
assert.strictEqual(plan.requestDigest.startsWith('sha256:'), true);
assert.strictEqual(plan.impactDigest.startsWith('sha256:'), true);
assert.strictEqual(plan.planDigest.startsWith('sha256:'), true);
assert.strictEqual(assertTransactionalDeletePlan(plan).planDigest, plan.planDigest);

const manifest = createTransactionalDeleteCheckpointManifest({
  plan,
  createdAt: 1_000,
  entries: [
    {
      relativePath: 'tmp/cache',
      kind: 'directory',
      bytes: 0,
      mode: 0o755,
      mtimeMs: 900.5,
      contentDigest: null,
      linkTarget: null,
    },
    {
      relativePath: 'src/old.js',
      kind: 'file',
      bytes: 7,
      mode: 0o644,
      mtimeMs: 901,
      contentDigest: digest('a'),
      linkTarget: null,
    },
  ],
});
assert(Object.isFrozen(manifest));
assert(Object.isFrozen(manifest.entries[0]));
assert.strictEqual(manifest.checkpointDigest.startsWith('sha256:'), true);
assert.strictEqual(manifest.entries[0].relativePath, 'src/old.js');

const preparing = createTransactionalDeleteStateRecord({
  previousState: null,
  state: TRANSACTIONAL_DELETE_STATES.PREPARING,
  at: 1,
});
assert(Object.isFrozen(preparing));
const prepared = createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.PREPARING,
  state: TRANSACTIONAL_DELETE_STATES.PREPARED,
  at: 2,
});
assert.strictEqual(prepared.state, 'PREPARED');
assert.throws(() => createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.PREPARING,
  state: TRANSACTIONAL_DELETE_STATES.COMMITTED,
  at: 2,
}), /transition/);
assert.throws(() => createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.APPLYING,
  state: TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  at: 2,
}), /reasonCode/);
assert.strictEqual(createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.APPLYING,
  state: TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  at: 2,
  reasonCode: 'CHECKPOINT_RESTORE_FAILED',
}).state, 'RECOVERY_PRE_COMMIT');
assert.throws(() => createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.COMMITTED,
  state: TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  at: 2,
  reasonCode: 'CHECKPOINT_RESTORE_FAILED',
}), /transition/);
assert.throws(() => createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.APPLYING,
  state: TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT,
  at: 2,
  reasonCode: 'INVALID_RECOVERY_SIDE',
}), /transition/);
assert.strictEqual(createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.COMMITTED,
  state: TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT,
  at: 3,
  reasonCode: 'PURGE_INTERRUPTED',
}).state, 'RECOVERY_POST_COMMIT');
assert.strictEqual(createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  state: TRANSACTIONAL_DELETE_STATES.ROLLING_BACK,
  at: 4,
}).state, 'ROLLING_BACK');
assert.throws(() => createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.RECOVERY_PRE_COMMIT,
  state: TRANSACTIONAL_DELETE_STATES.PURGING,
  at: 4,
}), /transition/);
assert.strictEqual(createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT,
  state: TRANSACTIONAL_DELETE_STATES.PURGING,
  at: 5,
}).state, 'PURGING');
assert.throws(() => createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.RECOVERY_POST_COMMIT,
  state: TRANSACTIONAL_DELETE_STATES.ROLLING_BACK,
  at: 5,
}), /transition/);
assert.strictEqual(createTransactionalDeleteStateRecord({
  previousState: TRANSACTIONAL_DELETE_STATES.COMMITTED,
  state: TRANSACTIONAL_DELETE_STATES.ROLLING_BACK,
  at: 6,
}).state, 'ROLLING_BACK');

const publicResult = createTransactionalDeletePublicResult({
  status: TRANSACTIONAL_DELETE_PUBLIC_RESULT_STATUSES.COMPLETED,
  state: TRANSACTIONAL_DELETE_STATES.PURGED,
  impact: { files: 1, bytes: 7, directories: 1 },
});
assert(Object.isFrozen(publicResult));
assert.strictEqual(publicResult.ok, true);
const publicJson = JSON.stringify(publicResult);
for (const forbidden of [
  '/Users/',
  'C:\\',
  'requestId',
  'transactionId',
  'checkpointDigest',
  'planDigest',
  'handle',
]) {
  assert.strictEqual(publicJson.includes(forbidden), false);
}
for (const forbiddenField of [
  'absolutePath',
  'requestId',
  'transactionId',
  'checkpointDigest',
  'planDigest',
  'handle',
  'message',
  'binding',
  'actorId',
  'windowLease',
]) {
  assert.throws(() => createTransactionalDeletePublicResult({
    status: 'failed',
    state: TRANSACTIONAL_DELETE_STATES.ROLLED_BACK,
    impact: { files: 0, bytes: 0, directories: 0 },
    errorCode: 'DELETE_FAILED',
    [forbiddenField]: forbiddenField === 'absolutePath' ? '/secret/path' : 'secret',
  }), /unsupported field/);
}

assert.deepStrictEqual(
  canonicalSha256Digest({ z: 1, a: { y: 2, x: 3 } }),
  canonicalSha256Digest({ a: { x: 3, y: 2 }, z: 1 })
);
assert.match(canonicalSha256Digest({ value: 'same' }), /^sha256:[a-f0-9]{64}$/);
assert.throws(() => assertTransactionalDeletePlan({
  ...plan,
  planDigest: digest('b'),
}), /does not match/);

const invalidPaths = [
  '',
  '.',
  '..',
  './file.txt',
  'dir/.',
  'dir/..',
  'dir/../file.txt',
  '/etc/passwd',
  'C:/Windows/system.ini',
  'C:\\Windows\\system.ini',
  'C:drive-relative.txt',
  '//server/share/file.txt',
  '\\\\server\\share\\file.txt',
  '\\\\?\\C:\\secret.txt',
  '\\\\.\\pipe\\name',
  '\\rooted.txt',
  'a\\b.txt',
  'a//b.txt',
  'a/b.txt/',
  ' a.txt',
  'a.txt ',
  'a\0b.txt',
  '*.txt',
  'file?.txt',
  'files/[ab].txt',
  'files/{a,b}.txt',
  'files/!(keep).txt',
];
for (const invalidPath of invalidPaths) {
  assert.throws(() => createTransactionalDeletePublicRequest({
    paths: [invalidPath],
  }, { pathStyle: 'posix', caseSensitive: true }), /path|glob|relative|separator|traversal|root/i, invalidPath);
}

const protectedPaths = [
  '.git',
  '.git/config',
  'nested/.git/config',
  '.faber',
  '.faber/application-map.json',
  '.faber/map-assets-index.json',
  '.faber/milestones.json',
  '.env',
  '.env.local',
  '.env.example',
  'config/.environment',
  '.ssh/id_ed25519',
  'nested/private_context/notes.md',
  'docs/application-map',
  'docs/application-map/frontend.md',
  'docs/milestones',
  'docs/milestones/milestones.json',
  'Map assets/hero/reference.png',
  '.GIT/config',
  '.ENV.PRODUCTION',
  'Nested/.FABER/Application-Map.json',
  '.\u017fsh/config',
  'docs/mile\u017ftones/release.json',
];
for (const protectedPath of protectedPaths) {
  assert.strictEqual(isProtectedTransactionalDeletePath(protectedPath, 'posix'), true);
  assert.throws(() => createTransactionalDeletePublicRequest({
    paths: [protectedPath],
  }, { pathStyle: 'posix', caseSensitive: true }), /protected/);
}
assert.strictEqual(isProtectedTransactionalDeletePath('.gitignore', 'posix'), false);
assert.strictEqual(isProtectedTransactionalDeletePath('src/environment.js', 'posix'), false);

assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src', 'src/index.js'],
}, { pathStyle: 'posix', caseSensitive: true }), /ancestor and descendant/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src/a.js', 'src/a.js'],
}, { pathStyle: 'posix', caseSensitive: true }), /duplicate/);
assert.deepStrictEqual(createTransactionalDeletePublicRequest({
  paths: ['src/A.js', 'src/a.js'],
}, { pathStyle: 'posix', caseSensitive: true }).paths, ['src/A.js', 'src/a.js']);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src/A.js', 'src/a.js'],
}, { pathStyle: 'posix', caseSensitive: false }), /duplicate/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src/\u00e9.txt', 'src/e\u0301.txt'],
}, { pathStyle: 'posix', caseSensitive: false }), /duplicate/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src/\u00e9', 'src/e\u0301/file.txt'],
}, { pathStyle: 'posix', caseSensitive: false }), /ancestor and descendant/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src/\u03c3.txt', 'src/\u03c2.txt'],
}, { pathStyle: 'posix', caseSensitive: false }), /duplicate/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src/\u03a3', 'src/\u03c2/child.txt'],
}, { pathStyle: 'posix', caseSensitive: false }), /ancestor and descendant/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src/A.js', 'src/a.js'],
}, { pathStyle: 'windows', caseSensitive: false }), /duplicate/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['SRC', 'src/a.js'],
}, { pathStyle: 'windows', caseSensitive: false }), /ancestor and descendant/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['DOCS/Application-Map/readme.md'],
}, { pathStyle: 'windows', caseSensitive: false }), /protected/);
for (const invalidWindowsPath of ['CON', 'src/NUL.txt', 'src/trailing.', 'src/trailing ', 'src/bad:name']) {
  assert.throws(() => createTransactionalDeletePublicRequest({
    paths: [invalidWindowsPath],
  }, { pathStyle: 'windows', caseSensitive: false }), /Windows|trimming/);
}
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src\\old.js'],
}, { pathStyle: 'windows', caseSensitive: false }), /ambiguous path separator/);

const maximumPaths = Array.from(
  { length: HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision },
  (_, index) => `src/obsolete-${index}.js`
);
assert.strictEqual(createTransactionalDeletePublicRequest({
  paths: maximumPaths,
}, { pathStyle: 'posix', caseSensitive: true }).paths.length, HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: [...maximumPaths, 'src/too-many.js'],
}, { pathStyle: 'posix', caseSensitive: true }), /between 1 and/);
assert.throws(() => createTransactionalDeleteImpact({
  files: HARD_MAX_DELEGATION_CONSTRAINTS.maxFilesPerDecision + 1,
  bytes: 0,
  directories: 0,
}), /hard caps/);
assert.throws(() => createTransactionalDeleteImpact({
  files: 1,
  bytes: HARD_MAX_DELEGATION_CONSTRAINTS.maxBytesPerDecision + 1,
  directories: 0,
}), /hard caps/);

for (const privateField of [
  'binding',
  'mode',
  'actorId',
  'lease',
  'windowLease',
  'jobId',
  'caseSensitive',
]) {
  assert.throws(() => createTransactionalDeletePublicRequest({
    paths: ['src/old.js'],
    [privateField]: 'private-authority',
  }, { pathStyle: 'posix', caseSensitive: true }), /unsupported field/);
}
assert.throws(() => createTransactionalDeletePublicRequest({
  schemaVersion: 'transactional-delete.public-request.v999',
  paths: ['src/old.js'],
}, { pathStyle: 'posix', caseSensitive: true }), /schemaVersion/);

assert.throws(() => createTransactionalDeletePublicRequest({
  pathStyle: 'windows',
  paths: ['src/old.js'],
}, { pathStyle: 'posix', caseSensitive: true }), /unsupported field/);

const sparsePaths = [];
sparsePaths.length = 1;
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: sparsePaths,
}, { pathStyle: 'posix', caseSensitive: true }), /dense/);
const exoticPaths = ['src/old.js'];
Object.setPrototypeOf(exoticPaths, { map() { throw new Error('must not execute'); } });
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: exoticPaths,
}, { pathStyle: 'posix', caseSensitive: true }), /plain array/);
assert.throws(() => createTransactionalDeletePublicRequest({
  paths: ['src/old.js'],
  optional: undefined,
}, { pathStyle: 'posix', caseSensitive: true }), /unsupported field|undefined/);
assert.throws(() => createTransactionalDeleteImpact({ files: -0, bytes: 0, directories: 1 }), /non-negative/);
assert.throws(() => canonicalSha256Digest({ value: undefined }), /undefined/);
assert.throws(() => canonicalSha256Digest({ value: -0 }), /negative zero/);
assert.throws(() => canonicalSha256Digest({ value: Symbol('secret') }), /JSON-compatible/);
assert.throws(() => canonicalSha256Digest({ [Symbol('secret')]: true }), /symbol/);
const hostileDigestArray = ['secret'];
let hostileDigestMapRan = false;
Object.setPrototypeOf(hostileDigestArray, {
  map() {
    hostileDigestMapRan = true;
    return [];
  },
});
assert.throws(
  () => canonicalSha256Digest(hostileDigestArray),
  /standard array prototype/
);
assert.strictEqual(hostileDigestMapRan, false);
const getterRequest = {};
Object.defineProperty(getterRequest, 'paths', {
  enumerable: true,
  get() { return ['src/old.js']; },
});
assert.throws(() => createTransactionalDeletePublicRequest(
  getterRequest,
  { pathStyle: 'posix', caseSensitive: true }
), /data properties/);
assert.throws(() => createTransactionalDeletePublicRequest(
  JSON.parse('{"paths":["src/old.js"],"__proto__":{"polluted":true}}'),
  { pathStyle: 'posix', caseSensitive: true }
), /forbidden key/);

const directoryPlan = createTransactionalDeletePlan({
  request: { paths: ['src'] },
  pathStyle: 'posix',
  caseSensitive: true,
  entries: [{ relativePath: 'src', kind: 'directory' }],
  impact: { files: 1, bytes: 1, directories: 1 },
});
assert.throws(() => createTransactionalDeleteCheckpointManifest({
  plan: directoryPlan,
  createdAt: 1,
  entries: [
    {
      relativePath: 'src',
      kind: 'directory',
      bytes: 0,
      mode: 0o755,
      mtimeMs: 1,
      contentDigest: null,
      linkTarget: null,
    },
    {
      relativePath: 'src/.env',
      kind: 'file',
      bytes: 1,
      mode: 0o600,
      mtimeMs: 1,
      contentDigest: digest('c'),
      linkTarget: null,
    },
  ],
}), /protected/);

const treePlan = createTransactionalDeletePlan({
  request: { paths: ['tree'] },
  pathStyle: 'posix',
  caseSensitive: true,
  entries: [{ relativePath: 'tree', kind: 'directory' }],
  impact: { files: 1, bytes: 2, directories: 2 },
});
const directoryEntry = (relativePath) => ({
  relativePath,
  kind: 'directory',
  bytes: 0,
  mode: 0o755,
  mtimeMs: 1,
  contentDigest: null,
  linkTarget: null,
});
const fileEntry = (relativePath) => ({
  relativePath,
  kind: 'file',
  bytes: 2,
  mode: 0o644,
  mtimeMs: 1,
  contentDigest: digest('d'),
  linkTarget: null,
});
assert.strictEqual(createTransactionalDeleteCheckpointManifest({
  plan: treePlan,
  createdAt: 3,
  entries: [directoryEntry('tree'), directoryEntry('tree/sub'), fileEntry('tree/sub/file.js')],
}).impact.directories, 2);
assert.throws(() => createTransactionalDeleteCheckpointManifest({
  plan: treePlan,
  createdAt: 3,
  entries: [directoryEntry('tree'), directoryEntry('elsewhere'), fileEntry('tree/file.js')],
}), /outside exact planned targets/);
assert.throws(() => createTransactionalDeleteCheckpointManifest({
  plan: treePlan,
  createdAt: 3,
  entries: [directoryEntry('tree'), directoryEntry('tree/other'), fileEntry('tree/sub/file.js')],
}), /complete directory parent closure/);

console.log('transactional delete contract tests passed');
