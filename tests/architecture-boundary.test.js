const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

const ignoredDirs = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'dist',
  'node_modules',
  'release',
]);

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function walkJsFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function relative(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function assertDoesNotMatch(source, pattern, message) {
  assert.strictEqual(pattern.test(source), false, message);
}

function assertRendererBoundary() {
  const rendererDir = path.join(rootDir, 'renderer');
  const rendererFiles = walkJsFiles(rendererDir);
  const appSource = read('renderer/app.js');

  for (const filePath of rendererFiles) {
    const rel = relative(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    assertDoesNotMatch(source, /\brequire\s*\(/, `${rel} must not use CommonJS require; preload owns Node/Electron access`);
    assertDoesNotMatch(source, /\bipcRenderer\b/, `${rel} must not access ipcRenderer directly`);
    assertDoesNotMatch(source, /require\(['"]electron['"]\)/, `${rel} must not import Electron directly`);
    if (rel !== 'renderer/app.js') {
      assertDoesNotMatch(
        source,
        /\bwindow\.localcodeApi\b/,
        `${rel} must receive the preload bridge through injected controller options`
      );
    }
  }

  assert.ok(
    appSource.includes('window.FaberAppState.createInitialRendererState()'),
    'renderer/app.js must initialize UI state through renderer/app_state.js'
  );
  assert.ok(
    appSource.includes('window.FaberStartupPreloader.createStartupPreloaderController'),
    'renderer/app.js must delegate startup preloader behavior to renderer/startup_preloader.js'
  );
  assertDoesNotMatch(
    appSource,
    /\bBOOT_MIN_PRELOADER_MS\b|\bpreloaderHideRequested\b|\bstartupPreloaderEl\b/,
    'renderer/app.js must not own startup preloader timing or DOM removal internals'
  );
}

function assertPreloadBoundary() {
  const source = read('preload.js');
  assert.ok(
    source.includes("contextBridge.exposeInMainWorld('localcodeApi'"),
    'preload.js must expose a single localcodeApi bridge'
  );
  assertDoesNotMatch(
    source,
    /exposeInMainWorld\(['"]ipcRenderer['"]/,
    'preload.js must never expose raw ipcRenderer'
  );
  assertDoesNotMatch(
    source,
    /exposeInMainWorld\(['"]electron['"]/,
    'preload.js must never expose raw Electron objects'
  );
}

function assertCortexBoundary() {
  const cortexFiles = walkJsFiles(path.join(rootDir, 'cortex'));
  for (const filePath of cortexFiles) {
    const rel = relative(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    assertDoesNotMatch(source, /require\(['"]electron['"]\)/, `${rel} must stay runtime-agnostic and not import Electron`);
    assertDoesNotMatch(source, /require\(['"](?:[^'"]*[\/\\])?renderer[\/\\][^'"]*['"]\)/, `${rel} must not depend on renderer modules`);
    assertDoesNotMatch(source, /\bipcRenderer\b/, `${rel} must not use renderer IPC APIs`);
  }
}

function assertMainBoundary() {
  const mainFiles = [
    path.join(rootDir, 'main.js'),
    ...walkJsFiles(path.join(rootDir, 'main')),
  ];

  for (const filePath of mainFiles) {
    const rel = relative(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    assertDoesNotMatch(source, /require\(['"][^'"]*renderer\/[^'"]*\.js['"]\)/, `${rel} must not import renderer scripts`);
    assertDoesNotMatch(source, /\bipcRenderer\b/, `${rel} must not use renderer-side IPC APIs`);
  }
}

function assertProductToolchainUsesExecutionBoundary() {
  const productContract = read('tests/product-toolchain-contract.test.js');
  assert.ok(
    productContract.includes('createAutomataExecutor'),
    'product toolchain contract must validate writes through the Automata executor'
  );
  assert.ok(
    productContract.includes('findCssImportOrderViolation'),
    'product toolchain contract must guard generated CSS import ordering'
  );

  const executor = read('cortex/automata/core/executor.js');
  assert.ok(
    executor.includes('normalizeCssImportOrder'),
    'Automata executor must normalize CSS imports before writing CSS files'
  );
}

assertRendererBoundary();
assertPreloadBoundary();
assertCortexBoundary();
assertMainBoundary();
assertProductToolchainUsesExecutionBoundary();

console.log('architecture-boundary.test.js: ok');
