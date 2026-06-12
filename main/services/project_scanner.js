const defaultFs = require('fs');
const defaultPath = require('path');

const DEFAULT_EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.cache', '.faber']);
const DEFAULT_MAX_FILES_SCAN = 800;
const SYSTEM_FILE_NAMES = new Set(['.DS_Store', '.localized', 'Thumbs.db', 'desktop.ini']);

function asExcludedDirSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return DEFAULT_EXCLUDED_DIRS;
}

function createProjectScanner(dependencies = {}) {
  const {
    excludedDirs = DEFAULT_EXCLUDED_DIRS,
    fs = defaultFs,
    maxFilesScan = DEFAULT_MAX_FILES_SCAN,
    path = defaultPath,
    stackRegistry = null,
  } = dependencies;

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
    const stack = [{ rel: '', abs: safeRoot, depth: 0 }];

    while (stack.length && rows.length < maxFiles) {
      const current = stack.pop();
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

        const relPath = current.rel ? path.posix.join(current.rel, entry.name) : entry.name;
        const absPath = path.join(current.abs, entry.name);

        if (entry.isDirectory()) {
          rows.push({ type: 'dir', path: relPath, depth: current.depth, name: entry.name });
          stack.push({ rel: relPath, abs: absPath, depth: current.depth + 1 });
        } else if (entry.isFile()) {
          rows.push({ type: 'file', path: relPath, depth: current.depth, name: entry.name });
          if (rows.length >= maxFiles) break;
        }
      }
    }

    return rows;
  }

  return {
    collectProjectFilesTree,
    detectStack,
    safeReadJson,
    scanProject,
    shouldIgnoreScanEntry,
  };
}

module.exports = {
  createProjectScanner,
};
