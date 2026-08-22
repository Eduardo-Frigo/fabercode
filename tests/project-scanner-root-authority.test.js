'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const {
  PROJECT_ROOT_READER_VERSION,
} = require('../main/capabilities/project_root_authority_contract');
const { createProjectScanner } = require('../main/services/project_scanner');
const { createStackRegistryService } = require('../main/services/stack_registry_service');

const bytesDigest = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

function file(content) {
  return { kind: 'file', bytes: Buffer.from(content, 'utf8') };
}

function directory(entries) {
  return { kind: 'directory', entries };
}

function createReader(tree, events, overrides = {}) {
  function resolve(relativePath) {
    let current = tree;
    if (!relativePath) return current;
    for (const component of relativePath.split('/')) {
      if (!current || current.kind !== 'directory') return null;
      current = current.entries[component] || null;
    }
    return current;
  }

  return Object.freeze({
    version: PROJECT_ROOT_READER_VERSION,
    inspectEntry() {
      return Object.freeze({
        found: false,
        kind: null,
        bytes: null,
        mode: null,
        mtimeMs: null,
        contentDigest: null,
        linkTarget: null,
        entryIdentityDigest: null,
      });
    },
    list({ relativePath, maxEntries }) {
      events.push(`list:${relativePath}`);
      if (typeof overrides.list === 'function') {
        return overrides.list({ relativePath, maxEntries });
      }
      const node = resolve(relativePath);
      const entries = node && node.kind === 'directory'
        ? Object.entries(node.entries)
          .map(([name, entry]) => Object.freeze({ name, kind: entry.kind }))
          .slice(0, maxEntries)
        : [];
      const total = node && node.kind === 'directory'
        ? Object.keys(node.entries).length
        : 0;
      return Object.freeze({
        entries: Object.freeze(entries),
        truncated: total > entries.length,
      });
    },
    readFile({ relativePath, maxBytes }) {
      events.push(`read:${relativePath}`);
      const node = resolve(relativePath);
      if (!node || node.kind !== 'file') {
        return Object.freeze({ found: false, contentBase64: null, contentDigest: null });
      }
      if (node.bytes.length > maxBytes) throw new Error('read bound exceeded');
      return Object.freeze({
        found: true,
        contentBase64: node.bytes.toString('base64'),
        contentDigest: bytesDigest(node.bytes),
      });
    },
  });
}

function lease(reader, purpose = 'project_scan') {
  return Object.freeze({
    version: 'project-root-authority-lease.v1',
    leaseId: 'root-lease-a',
    jobId: 'job-a',
    projectId: 'project-a',
    purpose,
    physicalRootIdentityDigest: `sha256:${'a'.repeat(64)}`,
    authorityDigest: `sha256:${'b'.repeat(64)}`,
    reader,
    close() {
      return Object.freeze({ closed: true });
    },
  });
}

const tree = directory({
  'package.json': file(JSON.stringify({
    dependencies: { next: '^16.0.0', tailwindcss: '^4.0.0' },
  })),
  'README.md': file('# App'),
  src: directory({
    'app.tsx': file('export default function App() {}'),
    'style.css': file('body { color: #111; }'),
  }),
  '.env': file('SECRET=1'),
  '.hidden': file('hidden'),
  '.faber': directory({ 'internal.json': file('{}') }),
  node_modules: directory({ 'ignored.js': file('ignored') }),
  'linked-source': { kind: 'symlink' },
});

const forbiddenFs = new Proxy({}, {
  get(_target, property) {
    throw new Error(`pathname filesystem access is forbidden: ${String(property)}`);
  },
});
const stackRegistry = createStackRegistryService({ fs: forbiddenFs, path });
const scanner = createProjectScanner({
  excludedDirs: new Set(['node_modules', '.git', '.faber']),
  fs: forbiddenFs,
  maxFilesScan: 20,
  path,
  stackRegistry,
});

{
  const events = [];
  const rootLease = lease(createReader(tree, events));
  const rootPath = '/path/that/must/not/be/reopened';
  const info = scanner.scanProjectFromRootLease({ rootPath, lease: rootLease });
  assert.strictEqual(info.rootPath, rootPath);
  assert.strictEqual(info.totalFiles, 5);
  assert.strictEqual(info.scannedFiles, 5);
  assert.strictEqual(info.truncated, false);
  assert.strictEqual(info.counters.tsx, 1);
  assert.strictEqual(info.counters.css, 1);
  assert.strictEqual(info.counters.md, 1);
  assert.strictEqual(info.counters.other, 2);
  assert.ok(info.stacks.includes('Next.js'));
  assert.ok(info.stacks.includes('Tailwind CSS'));
  assert.ok(info.files.includes(path.join('src', 'app.tsx')));
  assert.ok(!info.files.includes('.env'));
  assert.ok(!info.files.includes('.hidden'));
  assert.ok(!info.files.some((entry) => entry.includes('node_modules')));
  assert.ok(!info.files.some((entry) => entry.includes('.faber')));
  assert.deepStrictEqual(events, [
    'list:',
    'list:src',
    'read:package.json',
    'read:composer.json',
  ]);

  const treeRows = scanner.collectProjectFilesTreeFromRootLease({
    rootPath,
    lease: rootLease,
    maxFiles: 20,
  });
  assert.ok(treeRows.some((entry) => entry.type === 'dir' && entry.path === 'src'));
  assert.ok(treeRows.some((entry) => entry.type === 'file' && entry.path === '.env'));
  assert.ok(!treeRows.some((entry) => entry.path === '.hidden'));
  assert.ok(!treeRows.some((entry) => entry.path.includes('node_modules')));
  assert.ok(!treeRows.some((entry) => entry.path.includes('.faber')));
}

{
  const events = [];
  const executionLease = lease(createReader(tree, events), 'execution');
  const info = scanner.scanProjectFromRootLease({
    rootPath: '/execution/root/path-label',
    lease: executionLease,
  });
  assert.strictEqual(info.totalFiles, 5);
  assert.ok(events.includes('list:'));
}

{
  const events = [];
  const truncatedReader = createReader(tree, events, {
    list({ maxEntries }) {
      return Object.freeze({
        entries: Object.freeze(Array.from({ length: maxEntries }, (_, index) => Object.freeze({
          name: `entry-${index}`,
          kind: 'file',
        }))),
        truncated: true,
      });
    },
  });
  assert.throws(
    () => scanner.scanProjectFromRootLease({
      rootPath: '/never/reopen',
      lease: lease(truncatedReader),
    }),
    /truncated|bound|complete/i
  );
}

{
  assert.throws(
    () => scanner.scanProjectFromRootLease({
      rootPath: '/never/reopen',
      lease: Object.freeze({ reader: createReader(tree, []) }),
    }),
    /lease|authority/i
  );
}

console.log('project-scanner-root-authority.test.js: ok');
