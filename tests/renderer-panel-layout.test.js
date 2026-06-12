const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'panel_layout.js'), 'utf8');

function createClassList(initialValues = []) {
  const values = new Set(initialValues);
  return {
    add: (name) => values.add(name),
    remove: (name) => values.delete(name),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      const next = force === undefined ? !values.has(name) : Boolean(force);
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
  };
}

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

const storage = createStorage({
  'faber.panelLayout.v1': JSON.stringify({ left: 334, right: 422 }),
});
const body = {
  classList: createClassList(['workspace-right-collapsed']),
};
const appShell = {
  ownerDocument: { body },
  style: {
    values: {},
    setProperty(name, value) {
      this.values[name] = value;
    },
  },
  getBoundingClientRect() {
    return { width: 1600 };
  },
};
const leftPanel = {
  getBoundingClientRect() {
    return { width: 320 };
  },
};
const rightPanel = {
  getBoundingClientRect() {
    return { width: 0 };
  },
};
const documentRef = {
  body,
  querySelector(selector) {
    if (selector === '.app-shell') return appShell;
    if (selector === '.panel-left') return leftPanel;
    if (selector === '.panel-right') return rightPanel;
    return null;
  },
  getElementById() {
    return null;
  },
};

const sandbox = {
  document: documentRef,
  window: {
    localStorage: storage,
    innerWidth: 1600,
    addEventListener() {},
  },
};
sandbox.window.window = sandbox.window;
sandbox.window.document = documentRef;

vm.runInNewContext(source, sandbox, { filename: 'panel_layout.js' });

const panelLayout = sandbox.window.FaberPanelLayout;
assert.ok(panelLayout, 'FaberPanelLayout should be registered');

const controller = panelLayout.createPanelLayoutController({
  appShell,
  storageKey: 'faber.panelLayout.v1',
});

const currentWhileCollapsed = controller.getCurrentLayout();
assert.strictEqual(
  currentWhileCollapsed.right,
  422,
  'collapsed panel width should come from stored layout instead of a zero DOM measurement'
);

controller.applyLayout({ left: 390, right: 480 }, { persist: true });
assert.strictEqual(appShell.style.values['--faber-left-panel-width'], '390px');
assert.strictEqual(
  appShell.style.values['--faber-right-panel-width'],
  undefined,
  'resizing another rail must not overwrite the inline width of a collapsed panel'
);

const stored = JSON.parse(storage.getItem('faber.panelLayout.v1'));
assert.strictEqual(stored.left, 390);
assert.strictEqual(stored.right, 480);

body.classList.remove('workspace-right-collapsed');
const restoredMeasurement = controller.getCurrentLayout();
assert.strictEqual(
  restoredMeasurement.right,
  480,
  'restored panel should keep the last saved expanded width when the DOM has not measured it yet'
);

console.log('renderer-panel-layout.test.js: ok');
