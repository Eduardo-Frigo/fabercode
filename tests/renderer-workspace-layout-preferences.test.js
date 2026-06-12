const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace_layout_preferences.js'), 'utf8');

function createClassList() {
  const values = new Set();
  return {
    contains: (name) => values.has(name),
    add: (name) => values.add(name),
    remove: (name) => values.delete(name),
    toggle: (name, force) => {
      const next = force === undefined ? !values.has(name) : Boolean(force);
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
  };
}

function createStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

function createButton() {
  return {
    attrs: {},
    listeners: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    },
  };
}

const leftButton = createButton();
const rightButton = createButton();
const leftRestoreButton = createButton();
const rightRestoreButton = createButton();
const storage = createStorage();
const appShell = {
  style: {
    values: {},
    setProperty(name, value) {
      this.values[name] = value;
    },
  },
};
const body = {
  classList: createClassList(),
  dataset: {},
};
const documentRef = {
  body,
  defaultView: { localStorage: storage },
  getElementById(id) {
    return {
      'workspace-collapse-left': leftButton,
      'workspace-collapse-right': rightButton,
      'workspace-restore-left': leftRestoreButton,
      'workspace-restore-right': rightRestoreButton,
    }[id] || null;
  },
};

const sandbox = { window: {}, document: documentRef };
sandbox.window.window = sandbox.window;
sandbox.window.localStorage = storage;
sandbox.window.document = documentRef;

vm.runInNewContext(source, sandbox, { filename: 'workspace_layout_preferences.js' });

const workspace = sandbox.window.FaberWorkspaceLayoutPreferences;
assert.ok(workspace, 'FaberWorkspaceLayoutPreferences should be registered');
assert.strictEqual(workspace.normalizeWorkspaceMode('programador'), 'ide');
assert.strictEqual(workspace.normalizeWorkspaceMode('unknown'), 'chat');
assert.strictEqual(workspace.normalizePanelSlot('terminal'), 'terminal');
assert.strictEqual(workspace.normalizePanelSlot('bad', 'projects'), 'projects');
assert.strictEqual(workspace.normalizeTerminalDock('bottom'), 'bottom');
assert.strictEqual(workspace.normalizeToolPlacements({ terminal: 'bottom', files: 'bad' }).terminal, 'bottom');
assert.strictEqual(workspace.normalizeToolPlacements({ terminal: 'bottom', files: 'bad' }).files, 'right');

let appliedPreset = null;
let runtimeApplied = null;
let layoutChangedCount = 0;
const state = {};
const controller = workspace.createWorkspaceLayoutPreferenceController({
  appShell,
  documentRef,
  state,
  onLayoutChanged() {
    layoutChangedCount += 1;
  },
  panelLayoutController: {
    applyLayout(layout, options) {
      appliedPreset = { layout, options };
    },
  },
  layoutRuntimeController: {
    applyPreferences(preferences) {
      runtimeApplied = preferences;
    },
  },
});

controller.initialize();
assert.strictEqual(body.dataset.workspaceMode, 'chat');
assert.strictEqual(leftButton.attrs['aria-pressed'], 'false');
assert.strictEqual(rightButton.attrs['aria-pressed'], 'false');

controller.updatePreferences({ mode: 'ide', rightCollapsed: true }, { persist: true });
assert.strictEqual(body.dataset.workspaceMode, 'ide');
assert.strictEqual(body.classList.contains('workspace-right-collapsed'), true);
assert.strictEqual(appliedPreset.layout.left, 300);
assert.strictEqual(appliedPreset.layout.right, 460);
assert.strictEqual(appShell.style.values['--faber-right-panel-width'], '58px');
assert.strictEqual(appShell.style.values['--faber-right-splitter-width'], '0px');
assert.strictEqual(rightButton.attrs['aria-pressed'], 'true');
assert.strictEqual(rightRestoreButton.attrs['aria-pressed'], 'true');
assert.strictEqual(runtimeApplied.mode, 'ide');
assert.strictEqual(runtimeApplied.rightCollapsed, true);

const stored = JSON.parse(storage.getItem('faber.workspaceLayout.v1'));
assert.strictEqual(stored.mode, 'ide');
assert.strictEqual(stored.rightCollapsed, true);

controller.togglePanel('left');
assert.strictEqual(body.classList.contains('workspace-left-collapsed'), true);
assert.strictEqual(appShell.style.values['--faber-left-panel-width'], '58px');
assert.strictEqual(appShell.style.values['--faber-left-splitter-width'], '0px');
assert.strictEqual(leftButton.attrs['aria-pressed'], 'true');
assert.strictEqual(leftRestoreButton.attrs['aria-pressed'], 'true');
assert.strictEqual(runtimeApplied.leftCollapsed, true);
assert.ok(layoutChangedCount >= 3, 'layout changes should notify dependents such as chat scrolling');

const sanitizedStored = controller.readStoredPreferences();
assert.strictEqual(sanitizedStored.mode, 'chat');
assert.strictEqual(sanitizedStored.terminalDock, 'right');
assert.strictEqual(sanitizedStored.toolPlacements.terminal, 'right');
assert.strictEqual(sanitizedStored.toolPlacements.files, 'right');
assert.strictEqual(sanitizedStored.leftCollapsed, true);
assert.strictEqual(sanitizedStored.rightCollapsed, true);

console.log('renderer-workspace-layout-preferences.test.js: ok');
