const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rendererDir = path.join(__dirname, '..', 'renderer');
const styleEntrypoint = 'styles.css';
const expectedStyleModules = [
  './styles/core.css',
  './styles/project-shell.css',
  './styles/account-gate.css',
  './styles/workspace-tools.css',
  './styles/legacy-overrides.css',
  './styles/settings.css',
  './styles/ui-overrides.css',
  './styles/cortex.css',
  './styles/automata-contracts.css',
  './styles/system-shell.css',
];

function readRendererFile(relativePath) {
  return fs.readFileSync(path.join(rendererDir, relativePath), 'utf8');
}

function normalizeImportPath(relativePath, importPath) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), importPath));
}

function readCssWithImports(relativePath, seen = new Set()) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  assert.ok(!seen.has(normalizedPath), `CSS import cycle detected at ${normalizedPath}`);
  seen.add(normalizedPath);

  const source = readRendererFile(normalizedPath);
  return source.replace(/@import\s+url\(["']?(.+?)["']?\)\s*;/g, (_match, importPath) =>
    readCssWithImports(normalizeImportPath(normalizedPath, importPath), seen)
  );
}

const styleEntrypointSource = readRendererFile(styleEntrypoint);
const importedModules = [...styleEntrypointSource.matchAll(/@import\s+url\(["']?(.+?)["']?\)\s*;/g)].map(
  (match) => match[1]
);

assert.deepStrictEqual(
  importedModules,
  expectedStyleModules,
  'renderer/styles.css must load UI CSS modules in the agreed architecture order'
);
assert.doesNotMatch(
  styleEntrypointSource.replace(/@import\s+url\(["']?.+?["']?\)\s*;/g, '').trim(),
  /[{}]/,
  'renderer/styles.css should remain an import-only stylesheet entrypoint'
);

for (const modulePath of expectedStyleModules) {
  assert.ok(
    fs.existsSync(path.join(rendererDir, modulePath.replace('./', ''))),
    `${modulePath} must exist as a renderer CSS module`
  );
}

const styles = readCssWithImports(styleEntrypoint);

function getRuleBlocks(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]);
}

const dragRegionBlocks = getRuleBlocks('.app-drag-region');
assert.ok(dragRegionBlocks.length > 0, 'app-drag-region CSS rule should exist');

const finalDragRegionBlock = dragRegionBlocks[dragRegionBlocks.length - 1];
assert.match(
  finalDragRegionBlock,
  /-webkit-app-region\s*:\s*drag\s*!important\s*;/,
  'app drag region should own the native drag hitbox'
);
assert.match(
  finalDragRegionBlock,
  /pointer-events\s*:\s*auto\s*;/,
  'app drag region must receive pointer hit-testing'
);
assert.doesNotMatch(
  finalDragRegionBlock,
  /pointer-events\s*:\s*none\s*;/,
  'app drag region cannot opt out of pointer hit-testing'
);

for (const block of dragRegionBlocks) {
  assert.doesNotMatch(block, /-webkit-app-region\s*:\s*no-drag/, 'app drag region cannot be marked no-drag');
}

assert.match(
  styles,
  /--panel-font-scale\s*:\s*1\s*;/,
  'panel font scale token should exist for appearance settings'
);
assert.match(
  styles,
  /body\[data-theme='dark'\][^{]*\{[^}]*color\s*:\s*#e8e4df\s*!important\s*;/s,
  'dark theme should use the requested Faber typography color'
);
assert.match(
  styles,
  /body\[data-theme='light'\][^{]*\{[^}]*--text\s*:\s*#212121\s*;/s,
  'light theme should use the requested typography color token'
);
assert.match(
  styles,
  /body\[data-theme='light'\]\s+\.startup-preloader/s,
  'light theme should explicitly restyle the preloader surface for swapped logos'
);

console.log('window-chrome-css.test.js: ok');
