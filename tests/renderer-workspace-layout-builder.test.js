const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const preferencesSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace_layout_preferences.js'), 'utf8');
const builderSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace_layout_builder.js'), 'utf8');

function createElement(tagName = 'div') {
  const attrs = {};
  const listeners = {};
  const classNames = new Set();
  const element = {
    attrs,
    children: [],
    listeners,
    tagName,
    textContent: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return attrs[name] || '';
    },
    closest(selector) {
      if (selector === '[data-workspace-tool]' && attrs['data-workspace-tool']) return this;
      return null;
    },
    classList: {
      add(name) {
        classNames.add(name);
      },
      remove(name) {
        classNames.delete(name);
      },
      toggle(name, force) {
        const next = force === undefined ? !classNames.has(name) : Boolean(force);
        if (next) classNames.add(name);
        else classNames.delete(name);
        return next;
      },
      contains(name) {
        return classNames.has(name);
      },
    },
  };
  Object.defineProperty(element, 'className', {
    get() {
      return Array.from(classNames).join(' ');
    },
    set(value) {
      classNames.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((name) => classNames.add(name));
    },
  });
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return '';
    },
    set() {
      element.children = [];
    },
  });
  return element;
}

const documentRef = {
  createElement,
};
const sandbox = { window: {}, document: documentRef };
sandbox.window.window = sandbox.window;
sandbox.window.document = documentRef;

vm.runInNewContext(preferencesSource, sandbox, { filename: 'workspace_layout_preferences.js' });
vm.runInNewContext(builderSource, sandbox, { filename: 'workspace_layout_builder.js' });

const builderModule = sandbox.window.FaberWorkspaceLayoutBuilder;
assert.ok(builderModule, 'FaberWorkspaceLayoutBuilder should be registered');

const derived = builderModule.deriveControlsFromPlacements({
  toolPlacements: {
    projects: 'right',
    files: 'left',
    terminal: 'bottom',
  },
});
assert.strictEqual(derived.leftSlot, 'files');
assert.strictEqual(derived.rightSlot, 'projects');
assert.strictEqual(derived.terminalDock, 'bottom');

const synced = builderModule.syncControlsFromPlacements({
  leftSlot: 'cortex',
  rightSlot: 'files',
  terminalDock: 'bottom',
});
assert.strictEqual(synced.toolPlacements.cortex, 'left');
assert.strictEqual(synced.toolPlacements.files, 'right');
assert.strictEqual(synced.toolPlacements.terminal, 'bottom');

let layout = {
  toolPlacements: {
    projects: 'left',
    chat: 'center',
    files: 'right',
    terminal: 'right',
    automations: 'hidden',
    cortex: 'right',
  },
};

const idePreset = builderModule.buildWorkspacePreset('ide', layout, sandbox.window.FaberWorkspaceLayoutPreferences.normalizeWorkspaceLayoutPreferences);
assert.strictEqual(idePreset.mode, 'ide');
assert.strictEqual(idePreset.terminalDock, 'bottom');
assert.strictEqual(idePreset.toolPlacements.terminal, 'bottom');
assert.strictEqual(idePreset.toolPlacements.files, 'right');
assert.strictEqual(idePreset.toolPlacements.chat, 'center');

const focusPreset = builderModule.buildWorkspacePreset('focus', layout, sandbox.window.FaberWorkspaceLayoutPreferences.normalizeWorkspaceLayoutPreferences);
assert.strictEqual(focusPreset.rightCollapsed, true);
assert.strictEqual(focusPreset.toolPlacements.files, 'hidden');
assert.strictEqual(focusPreset.toolPlacements.terminal, 'bottom');

let changed = null;
const terminalChip = createElement('button');
terminalChip.setAttribute('data-workspace-tool', 'terminal');
const bottomZone = createElement('section');
bottomZone.setAttribute('data-workspace-zone', 'bottom');
const rightContainer = createElement('div');
rightContainer.setAttribute('data-workspace-zone-items', 'right');
const bottomContainer = createElement('div');
bottomContainer.setAttribute('data-workspace-zone-items', 'bottom');

const builder = builderModule.createWorkspaceLayoutBuilder({
  documentRef,
  elements: {
    workspaceToolChips: [terminalChip],
    workspaceDropZones: [bottomZone],
    workspaceZoneItemContainers: [rightContainer, bottomContainer],
  },
  getLayout: () => layout,
  onChange: (partial) => {
    changed = partial;
    layout = { ...layout, ...partial };
  },
});

builder.bind();
const dataTransfer = {
  value: '',
  setData(_type, value) {
    this.value = value;
  },
  getData() {
    return this.value;
  },
};
terminalChip.listeners.dragstart({ target: terminalChip, dataTransfer });
bottomZone.listeners.drop({
  preventDefault() {},
  dataTransfer,
});

assert.strictEqual(changed.toolPlacements.terminal, 'bottom');
builder.render();
assert.strictEqual(bottomContainer.children.some((child) => child.textContent === 'Terminal'), true);

console.log('renderer-workspace-layout-builder.test.js: ok');
