const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createProjectScanner } = require('../main/services/project_scanner');
const { createStackRegistryService } = require('../main/services/stack_registry_service');

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-project-scanner-'));
  try {
    writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ dependencies: { next: '^16.0.0', tailwindcss: '^4.0.0' } }));
    writeFile(path.join(tempRoot, 'src', 'app.tsx'), 'export default function App() {}');
    writeFile(path.join(tempRoot, 'src', 'style.css'), 'body { color: #111; }');
    writeFile(path.join(tempRoot, 'README.md'), '# App');
    writeFile(path.join(tempRoot, '.env'), 'SECRET=1');
    writeFile(path.join(tempRoot, '.hidden'), 'hidden');
    writeFile(path.join(tempRoot, 'node_modules', 'ignored.js'), 'ignored');
    writeFile(path.join(tempRoot, '.git', 'config'), 'ignored');

    const stackRegistry = createStackRegistryService({ fs, path });
    const scanner = createProjectScanner({
      excludedDirs: new Set(['node_modules', '.git']),
      fs,
      maxFilesScan: 20,
      path,
      stackRegistry,
    });

    const info = scanner.scanProject(tempRoot);
    assert.strictEqual(info.rootPath, tempRoot);
    assert.strictEqual(info.scannedLimit, 20);
    assert.ok(info.stacks.includes('Next.js'));
    assert.ok(info.stacks.includes('Tailwind CSS'));
    assert.ok(!info.stacks.includes('React'));
    assert.strictEqual(info.counters.tsx, 1);
    assert.strictEqual(info.counters.css, 1);
    assert.strictEqual(info.counters.md, 1);
    assert.ok(info.files.includes(path.join('src', 'app.tsx')));
    assert.ok(!info.files.includes('.env'));
    assert.ok(!info.files.includes('.hidden'));
    assert.ok(!info.files.some((entry) => entry.includes('node_modules')));
    assert.ok(!info.files.some((entry) => entry.includes('.git')));

    const tree = scanner.collectProjectFilesTree(tempRoot, 20);
    assert.ok(tree.some((entry) => entry.type === 'dir' && entry.path === 'src'));
    assert.ok(tree.some((entry) => entry.type === 'file' && entry.path === '.env'));
    assert.ok(!tree.some((entry) => entry.path === '.hidden'));
    assert.ok(!tree.some((entry) => entry.path.includes('node_modules')));

    const electronRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-project-scanner-electron-'));
    try {
      writeFile(path.join(electronRoot, 'package.json'), JSON.stringify({ devDependencies: { electron: '^38.0.0' } }));
      writeFile(path.join(electronRoot, 'main.js'), 'require("electron");');
      const electronInfo = scanner.scanProject(electronRoot);
      assert.ok(electronInfo.stacks.includes('Electron'));
    } finally {
      fs.rmSync(electronRoot, { recursive: true, force: true });
    }

    const metadataOnlyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faber-project-scanner-meta-'));
    try {
      writeFile(path.join(metadataOnlyRoot, '.DS_Store'), 'ignored');
      writeFile(path.join(metadataOnlyRoot, '.env'), 'SECRET=1');
      writeFile(path.join(metadataOnlyRoot, '.hidden'), 'hidden');
      const metadataOnly = scanner.scanProject(metadataOnlyRoot);
      assert.strictEqual(metadataOnly.totalFiles, 0);
      assert.deepStrictEqual(metadataOnly.files, []);
    } finally {
      fs.rmSync(metadataOnlyRoot, { recursive: true, force: true });
    }

    console.log('project-scanner.test.js: ok');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run();
