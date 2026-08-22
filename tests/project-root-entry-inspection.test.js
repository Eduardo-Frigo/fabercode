'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  PROJECT_ROOT_ENTRY_KINDS,
  PROJECT_ROOT_READER_VERSION,
  assertProjectRootEntryInspectionResult,
  assertProjectRootReader,
  createProjectRootEntryInspectionRequest,
} = require('../main/capabilities/project_root_authority_contract');

const digest = (character) => `sha256:${character.repeat(64)}`;
const digestBytes = (value) => `sha256:${crypto.createHash('sha256')
  .update(Buffer.from(value, 'utf8'))
  .digest('hex')}`;

assert.strictEqual(PROJECT_ROOT_READER_VERSION, 'project-root-reader.v2');

const request = createProjectRootEntryInspectionRequest({
  relativePath: 'src/app.js',
});
assert.deepStrictEqual(request, { relativePath: 'src/app.js' });
assert.ok(Object.isFrozen(request));

const file = assertProjectRootEntryInspectionResult(Object.freeze({
  found: true,
  kind: PROJECT_ROOT_ENTRY_KINDS.FILE,
  bytes: 12,
  mode: 0o644,
  mtimeMs: 1_725_000_000_000,
  contentDigest: digest('a'),
  linkTarget: null,
  entryIdentityDigest: digest('b'),
}), request);
assert.strictEqual(file.kind, 'file');
assert.strictEqual(file.bytes, 12);
assert.ok(Object.isFrozen(file));

const directory = assertProjectRootEntryInspectionResult(Object.freeze({
  found: true,
  kind: PROJECT_ROOT_ENTRY_KINDS.DIRECTORY,
  bytes: 0,
  mode: 0o755,
  mtimeMs: 1_725_000_000_000,
  contentDigest: null,
  linkTarget: null,
  entryIdentityDigest: digest('c'),
}), createProjectRootEntryInspectionRequest({ relativePath: 'src' }));
assert.strictEqual(directory.kind, 'directory');

const linkTarget = '../shared/app.js';
const symlink = assertProjectRootEntryInspectionResult(Object.freeze({
  found: true,
  kind: PROJECT_ROOT_ENTRY_KINDS.SYMLINK,
  bytes: Buffer.byteLength(linkTarget, 'utf8'),
  mode: 0o777,
  mtimeMs: 1_725_000_000_000,
  contentDigest: digestBytes(linkTarget),
  linkTarget,
  entryIdentityDigest: digest('d'),
}), createProjectRootEntryInspectionRequest({ relativePath: 'src/link.js' }));
assert.strictEqual(symlink.linkTarget, linkTarget);

const other = assertProjectRootEntryInspectionResult(Object.freeze({
  found: true,
  kind: PROJECT_ROOT_ENTRY_KINDS.OTHER,
  bytes: 0,
  mode: 0o600,
  mtimeMs: 1_725_000_000_000,
  contentDigest: null,
  linkTarget: null,
  entryIdentityDigest: digest('e'),
}), createProjectRootEntryInspectionRequest({ relativePath: 'device' }));
assert.strictEqual(other.kind, 'other');

assert.deepStrictEqual(assertProjectRootEntryInspectionResult(Object.freeze({
  found: false,
  kind: null,
  bytes: null,
  mode: null,
  mtimeMs: null,
  contentDigest: null,
  linkTarget: null,
  entryIdentityDigest: null,
}), request), {
  found: false,
  kind: null,
  bytes: null,
  mode: null,
  mtimeMs: null,
  contentDigest: null,
  linkTarget: null,
  entryIdentityDigest: null,
});

for (const invalid of [
  { ...file, bytes: -1 },
  { ...file, bytes: 16 * 1024 * 1024 + 1 },
  { ...file, mode: 0o10000 },
  { ...file, mtimeMs: Number.NaN },
  { ...file, contentDigest: digest('f').toUpperCase() },
  { ...file, linkTarget: 'unexpected' },
  { ...file, entryIdentityDigest: 'not-a-digest' },
  { ...directory, bytes: 1 },
  { ...directory, contentDigest: digest('f') },
  { ...symlink, bytes: symlink.bytes + 1 },
  { ...symlink, contentDigest: digest('f') },
  { ...symlink, linkTarget: '' },
  {
    found: false,
    kind: null,
    bytes: 0,
    mode: null,
    mtimeMs: null,
    contentDigest: null,
    linkTarget: null,
    entryIdentityDigest: null,
  },
  { ...file, unexpected: true },
]) {
  assert.throws(
    () => assertProjectRootEntryInspectionResult(Object.freeze(invalid), request),
    /inspection|entry|invalid|digest|bound/i
  );
}

for (const invalidRequest of [
  {},
  { relativePath: '' },
  { relativePath: '../escape' },
  { relativePath: '/absolute' },
  { relativePath: 'src\\app.js' },
  { relativePath: 'src/app.js', extra: true },
  Promise.resolve({ relativePath: 'src/app.js' }),
]) {
  assert.throws(
    () => createProjectRootEntryInspectionRequest(invalidRequest),
    /inspection|relative|invalid/i
  );
}

function reader(overrides = {}) {
  return Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list() { return Object.freeze({ entries: Object.freeze([]), truncated: false }); },
    readFile() {
      return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
    },
    inspectEntry() { return file; },
    ...overrides,
  });
}

assert.strictEqual(assertProjectRootReader(reader()).version, PROJECT_ROOT_READER_VERSION);
assert.throws(
  () => assertProjectRootReader(Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    list() {},
    readFile() {},
  })),
  /reader|inspectEntry/i
);
assert.throws(
  () => assertProjectRootReader(reader({ inspectEntry: async () => file })),
  /inspectEntry|synchronous/i
);
assert.throws(
  () => assertProjectRootReader(reader({ inspectEntry: new Proxy(() => file, {}) })),
  /inspectEntry|synchronous|function|invalid/i
);

console.log('project-root entry inspection contract tests passed');
