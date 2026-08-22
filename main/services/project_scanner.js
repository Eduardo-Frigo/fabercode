'use strict';

const defaultFs = require('fs');
const defaultPath = require('path');

const {
  MAX_LIST_ENTRIES,
  PROJECT_ROOT_AUTHORITY_LEASE_VERSION,
  PROJECT_ROOT_AUTHORITY_PURPOSES,
  assertProjectRootListResult,
  assertProjectRootReadFileResult,
  assertProjectRootReader,
  createProjectRootListRequest,
  createProjectRootReadFileRequest,
} = require('../capabilities/project_root_authority_contract');

const DEFAULT_EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache', '.faber']);
const DEFAULT_MAX_FILES_SCAN = 800;
const DEFAULT_MAX_DIRECTORY_ENTRIES = 10_000;
const DEFAULT_MAX_TRAVERSAL_ENTRIES = 100_000;
const DEFAULT_MAX_TRAVERSAL_DEPTH = 64;
const PROJECT_MANIFEST_MAX_BYTES = 1024 * 1024;
const SYSTEM_FILE_NAMES = new Set(['.DS_Store', '.localized', 'Thumbs.db', 'desktop.ini']);

function asExcludedDirSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return DEFAULT_EXCLUDED_DIRS;
}

function isPlainDataRecord(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactDataFields(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!isPlainDataRecord(value)) return null;
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { return null; }
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))) return null;
  const fields = new Map();
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { return null; }
    if (!descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) return null;
    fields.set(key, descriptor.value);
  }
  return fields;
}

function readRootLease(value) {
  const fields = exactDataFields(value, [
    'version',
    'leaseId',
    'jobId',
    'projectId',
    'purpose',
    'physicalRootIdentityDigest',
    'authorityDigest',
    'reader',
    'close',
  ]);
  if (!fields || !Object.isFrozen(value)
    || fields.get('version') !== PROJECT_ROOT_AUTHORITY_LEASE_VERSION
    || typeof fields.get('leaseId') !== 'string'
    || typeof fields.get('jobId') !== 'string'
    || typeof fields.get('projectId') !== 'string'
    || !PROJECT_ROOT_AUTHORITY_PURPOSES.includes(fields.get('purpose'))
    || !/^sha256:[a-f0-9]{64}$/.test(fields.get('physicalRootIdentityDigest'))
    || !/^sha256:[a-f0-9]{64}$/.test(fields.get('authorityDigest'))
    || typeof fields.get('close') !== 'function') {
    throw new TypeError('A valid project-scan root authority lease is required');
  }
  return Object.freeze({
    lease: value,
    reader: assertProjectRootReader(fields.get('reader')),
  });
}

function createProjectScanner(dependencies = {}) {
  const {
    excludedDirs = DEFAULT_EXCLUDED_DIRS,
    fs = defaultFs,
    maxDirectoryEntries = DEFAULT_MAX_DIRECTORY_ENTRIES,
    maxFilesScan = DEFAULT_MAX_FILES_SCAN,
    maxTraversalDepth = DEFAULT_MAX_TRAVERSAL_DEPTH,
    maxTraversalEntries = DEFAULT_MAX_TRAVERSAL_ENTRIES,
    path = defaultPath,
    stackRegistry = null,
  } = dependencies;

  if (!Number.isSafeInteger(maxDirectoryEntries) || maxDirectoryEntries < 1
    || maxDirectoryEntries > MAX_LIST_ENTRIES) {
    throw new TypeError('maxDirectoryEntries must be a bounded positive integer');
  }
  if (!Number.isSafeInteger(maxTraversalEntries) || maxTraversalEntries < 1
    || maxTraversalEntries > DEFAULT_MAX_TRAVERSAL_ENTRIES) {
    throw new TypeError('maxTraversalEntries must be a bounded positive integer');
  }
  if (!Number.isSafeInteger(maxTraversalDepth) || maxTraversalDepth < 1
    || maxTraversalDepth > DEFAULT_MAX_TRAVERSAL_DEPTH) {
    throw new TypeError('maxTraversalDepth must be a bounded positive integer');
  }

  const excludedDirSet = asExcludedDirSet(excludedDirs);

  function shouldIgnoreScanEntry(entry) {
    if (!entry || !entry.name) return true;
    if (SYSTEM_FILE_NAMES.has(entry.name)) return true;
    if (entry.name.startsWith('.')) return true;
    return false;
  }

  function safeReadJson(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function detectStack(rootPath, counters, fileList = []) {
    const packageJsonPath = path.join(rootPath, 'package.json');
    const composerJsonPath = path.join(rootPath, 'composer.json');
    const packageJson = safeReadJson(packageJsonPath);

    if (stackRegistry && typeof stackRegistry.detectProjectStacks === 'function') {
      const detected = stackRegistry.detectProjectStacks({
        rootPath,
        files: fileList,
        counters,
        packageJson,
        composerJson: safeReadJson(composerJsonPath),
      });
      if (detected && Array.isArray(detected.stacks) && detected.stacks.length) return detected.stacks;
    }

    const stacks = [];

    if (packageJson) {
      const deps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };

      if (deps.next) stacks.push('Next.js');
      if (deps.react && !deps.next) stacks.push('React');
      if (deps.tailwindcss || deps['@tailwindcss/postcss']) stacks.push('Tailwind CSS');
      if (deps.vue) stacks.push('Vue');
      if (deps.express) stacks.push('Node/Express');
    }

    if (fs.existsSync(composerJsonPath) || counters.php > 0) {
      stacks.push('PHP/LAMP');
    }

    if (counters.py > 0) stacks.push('Python');
    if (counters.java > 0) stacks.push('Java');

    if (stacks.length === 0) stacks.push('Projeto genérico');

    return stacks;
  }

  function scanProject(rootPath) {
    const fileList = [];
    let totalFiles = 0;
    const counters = {
      js: 0,
      ts: 0,
      tsx: 0,
      jsx: 0,
      php: 0,
      css: 0,
      md: 0,
      py: 0,
      java: 0,
      other: 0,
    };

    function countFile(relativePath, fileName) {
      totalFiles += 1;
      if (fileList.length < maxFilesScan) {
        fileList.push(relativePath);
      }

      const ext = path.extname(fileName).toLowerCase();
      if (ext === '.js') counters.js += 1;
      else if (ext === '.ts') counters.ts += 1;
      else if (ext === '.tsx') counters.tsx += 1;
      else if (ext === '.jsx') counters.jsx += 1;
      else if (ext === '.php') counters.php += 1;
      else if (ext === '.css' || ext === '.scss') counters.css += 1;
      else if (ext === '.md') counters.md += 1;
      else if (ext === '.py') counters.py += 1;
      else if (ext === '.java') counters.java += 1;
      else counters.other += 1;
    }

    function walk(dirPath) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (shouldIgnoreScanEntry(entry)) continue;

        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        if (entry.isDirectory()) {
          if (excludedDirSet.has(entry.name)) continue;
          walk(fullPath);
          continue;
        }

        countFile(relativePath, entry.name);
      }
    }

    walk(rootPath);

    const stacks = detectStack(rootPath, counters, fileList);

    return {
      rootPath,
      totalFiles,
      scannedFiles: fileList.length,
      scannedLimit: maxFilesScan,
      truncated: totalFiles > fileList.length,
      counters,
      stacks,
      files: fileList,
    };
  }

  function collectProjectFilesTree(rootPath, maxFiles = 1400) {
    const safeRoot = path.resolve(String(rootPath || ''));
    const rows = [];

    let rootEntries = [];
    try {
      rootEntries = fs.readdirSync(safeRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    rootEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    const stack = [];
    for (let i = rootEntries.length - 1; i >= 0; i -= 1) {
      const entry = rootEntries[i];
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (entry.isDirectory() && excludedDirSet.has(entry.name)) continue;

      const relPath = entry.name;
      const absPath = path.join(safeRoot, entry.name);
      stack.push({
        type: entry.isDirectory() ? 'dir' : 'file',
        path: relPath,
        abs: absPath,
        depth: 0,
        name: entry.name,
      });
    }

    while (stack.length && rows.length < maxFiles) {
      const current = stack.pop();
      rows.push({
        type: current.type,
        path: current.path,
        depth: current.depth,
        name: current.name,
      });

      if (current.type === 'dir') {
        let entries = [];
        try {
          entries = fs.readdirSync(current.abs, { withFileTypes: true });
        } catch {
          continue;
        }

        entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name, 'pt-BR');
        });

        for (let i = entries.length - 1; i >= 0; i -= 1) {
          const entry = entries[i];
          if (entry.name.startsWith('.') && entry.name !== '.env') continue;
          if (entry.isDirectory() && excludedDirSet.has(entry.name)) continue;

          const relPath = path.posix.join(current.path, entry.name);
          const absPath = path.join(current.abs, entry.name);
          stack.push({
            type: entry.isDirectory() ? 'dir' : 'file',
            path: relPath,
            abs: absPath,
            depth: current.depth + 1,
            name: entry.name,
          });
        }
      }
    }

    return rows;
  }

  function normalizeRootLeaseInput(input, { includeMaxFiles = false } = {}) {
    const allowed = includeMaxFiles ? ['rootPath', 'lease', 'maxFiles'] : ['rootPath', 'lease'];
    const required = ['rootPath', 'lease'];
    const fields = exactDataFields(input, allowed, required);
    if (!fields) throw new TypeError('Invalid project-root scan input');
    const rootPath = fields.get('rootPath');
    if (typeof rootPath !== 'string' || !rootPath || rootPath !== rootPath.trim()
      || rootPath.includes('\0') || !path.isAbsolute(rootPath)) {
      throw new TypeError('Project-root scan rootPath must be an absolute path label');
    }
    const rootLease = readRootLease(fields.get('lease'));
    let maxFiles = 1400;
    if (includeMaxFiles && fields.has('maxFiles')) maxFiles = fields.get('maxFiles');
    if (!Number.isSafeInteger(maxFiles) || maxFiles < 1
      || maxFiles > maxTraversalEntries) {
      throw new TypeError('Project-root tree maxFiles is invalid');
    }
    return Object.freeze({ rootPath, rootLease, maxFiles });
  }

  function invokeRootList(reader, relativePath) {
    const request = createProjectRootListRequest({ relativePath, maxEntries: maxDirectoryEntries });
    const method = Object.getOwnPropertyDescriptor(reader, 'list').value;
    const raw = Reflect.apply(method, reader, [request]);
    const result = assertProjectRootListResult(raw, request);
    if (result.truncated) {
      throw new Error('Project-root directory listing was truncated; scan cannot be complete');
    }
    return [...result.entries].sort((left, right) => {
      const leftDirectory = left.kind === 'directory';
      const rightDirectory = right.kind === 'directory';
      if (leftDirectory && !rightDirectory) return -1;
      if (!leftDirectory && rightDirectory) return 1;
      return left.name.localeCompare(right.name, 'pt-BR');
    });
  }

  function readRootJson(reader, relativePath) {
    const request = createProjectRootReadFileRequest({
      relativePath,
      maxBytes: PROJECT_MANIFEST_MAX_BYTES,
    });
    const method = Object.getOwnPropertyDescriptor(reader, 'readFile').value;
    const raw = Reflect.apply(method, reader, [request]);
    const result = assertProjectRootReadFileResult(raw, request);
    if (!result.found) return null;
    try {
      return JSON.parse(Buffer.from(result.contentBase64, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  function detectStackFromRootSnapshot(counters, fileList, packageJson, composerJson) {
    if (stackRegistry && typeof stackRegistry.detectProjectStacks === 'function') {
      const detected = stackRegistry.detectProjectStacks({
        // An empty rootPath is deliberate: stack detection receives an already
        // anchored snapshot and must not reopen project plugins by pathname.
        rootPath: '',
        files: fileList,
        counters,
        packageJson,
        composerJson,
      });
      if (detected && Array.isArray(detected.stacks) && detected.stacks.length) {
        return detected.stacks;
      }
    }

    const stacks = [];
    if (packageJson && typeof packageJson === 'object' && !Array.isArray(packageJson)) {
      const deps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      if (deps.next) stacks.push('Next.js');
      if (deps.react && !deps.next) stacks.push('React');
      if (deps.tailwindcss || deps['@tailwindcss/postcss']) stacks.push('Tailwind CSS');
      if (deps.vue) stacks.push('Vue');
      if (deps.express) stacks.push('Node/Express');
    }
    if (composerJson || counters.php > 0) stacks.push('PHP/LAMP');
    if (counters.py > 0) stacks.push('Python');
    if (counters.java > 0) stacks.push('Java');
    return stacks.length ? stacks : ['Projeto genérico'];
  }

  function createCounters() {
    return {
      js: 0,
      ts: 0,
      tsx: 0,
      jsx: 0,
      php: 0,
      css: 0,
      md: 0,
      py: 0,
      java: 0,
      other: 0,
    };
  }

  function countSnapshotFile(counters, fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.js') counters.js += 1;
    else if (ext === '.ts') counters.ts += 1;
    else if (ext === '.tsx') counters.tsx += 1;
    else if (ext === '.jsx') counters.jsx += 1;
    else if (ext === '.php') counters.php += 1;
    else if (ext === '.css' || ext === '.scss') counters.css += 1;
    else if (ext === '.md') counters.md += 1;
    else if (ext === '.py') counters.py += 1;
    else if (ext === '.java') counters.java += 1;
    else counters.other += 1;
  }

  function scanProjectFromRootLease(input = {}) {
    const normalized = normalizeRootLeaseInput(input);
    const { reader } = normalized.rootLease;
    const counters = createCounters();
    const fileList = [];
    let totalFiles = 0;
    let traversalEntries = 0;

    function walk(relativeDirectory, depth) {
      if (depth > maxTraversalDepth) {
        throw new Error('Project-root scan exceeded its depth bound');
      }
      const entries = invokeRootList(reader, relativeDirectory);
      for (const entry of entries) {
        traversalEntries += 1;
        if (traversalEntries > maxTraversalEntries) {
          throw new Error('Project-root scan exceeded its traversal bound');
        }
        if (shouldIgnoreScanEntry(entry)) continue;
        const relativePath = relativeDirectory
          ? path.posix.join(relativeDirectory, entry.name)
          : entry.name;
        if (entry.kind === 'directory') {
          if (excludedDirSet.has(entry.name)) continue;
          walk(relativePath, depth + 1);
          continue;
        }
        totalFiles += 1;
        if (fileList.length < maxFilesScan) {
          fileList.push(path.join(...relativePath.split('/')));
        }
        countSnapshotFile(counters, entry.name);
      }
    }

    walk('', 0);
    const packageJson = readRootJson(reader, 'package.json');
    const composerJson = readRootJson(reader, 'composer.json');
    const stacks = detectStackFromRootSnapshot(
      counters,
      fileList,
      packageJson,
      composerJson
    );
    return {
      rootPath: normalized.rootPath,
      totalFiles,
      scannedFiles: fileList.length,
      scannedLimit: maxFilesScan,
      truncated: totalFiles > fileList.length,
      counters,
      stacks,
      files: fileList,
    };
  }

  function collectProjectFilesTreeFromRootLease(input = {}) {
    const normalized = normalizeRootLeaseInput(input, { includeMaxFiles: true });
    const { reader } = normalized.rootLease;
    const rows = [];
    let traversalEntries = 0;
    const stack = [];

    function pushDirectoryEntries(relativeDirectory, depth) {
      if (depth > maxTraversalDepth) {
        throw new Error('Project-root tree exceeded its depth bound');
      }
      const entries = invokeRootList(reader, relativeDirectory);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;
        if (entry.kind === 'directory' && excludedDirSet.has(entry.name)) continue;
        const relativePath = relativeDirectory
          ? path.posix.join(relativeDirectory, entry.name)
          : entry.name;
        stack.push({
          type: entry.kind === 'directory' ? 'dir' : 'file',
          path: relativePath,
          depth,
          name: entry.name,
        });
      }
    }

    pushDirectoryEntries('', 0);
    while (stack.length && rows.length < normalized.maxFiles) {
      const current = stack.pop();
      traversalEntries += 1;
      if (traversalEntries > maxTraversalEntries) {
        throw new Error('Project-root tree exceeded its traversal bound');
      }
      rows.push({
        type: current.type,
        path: current.path,
        depth: current.depth,
        name: current.name,
      });
      if (current.type === 'dir') {
        pushDirectoryEntries(current.path, current.depth + 1);
      }
    }
    return rows;
  }

  return {
    collectProjectFilesTree,
    collectProjectFilesTreeFromRootLease,
    detectStack,
    safeReadJson,
    scanProject,
    scanProjectFromRootLease,
    shouldIgnoreScanEntry,
  };
}

module.exports = {
  createProjectScanner,
};
