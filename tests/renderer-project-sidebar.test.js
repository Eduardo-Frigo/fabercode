const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(classes = [], parent = null) {
    this.children = [];
    this.className = classes.join(' ');
    this.dataset = {};
    this.listeners = {};
    this.parent = parent;
    this.textContent = '';
    this.value = '';
    this.classList = {
      add: () => {},
      remove: () => {},
      contains: (className) => this.className.split(/\s+/).includes(className),
    };
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  contains(target) {
    let cursor = target;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  closest(selector) {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    let cursor = this;
    while (cursor) {
      if (cursor.className && cursor.className.split(/\s+/).includes(className)) {
        return cursor;
      }
      cursor = cursor.parent;
    }
    return null;
  }

  set innerHTML(_) {
    this.children = [];
  }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_sidebar.js'), 'utf8');
const documentListeners = {};
const sandbox = {
  Element: FakeElement,
  document: {
    addEventListener: (type, handler) => {
      documentListeners[type] = handler;
    },
    createElement: () => new FakeElement(),
    getElementById: () => null,
  },
  window: {},
};
sandbox.window.window = sandbox.window;

vm.runInNewContext(source, sandbox, { filename: 'project_sidebar.js' });

const sidebar = sandbox.window.FaberProjectSidebar;
assert.ok(sidebar, 'FaberProjectSidebar should be registered');

const listEl = new FakeElement();
let expanded = { p1: true };
let collapsedCount = 0;
const controller = sidebar.createProjectSidebarController({
  listEl,
  getProjects: () => [],
  getExpandedProjects: () => expanded,
  setProjectExpanded: (projectId, value) => {
    expanded[projectId] = value;
    if (!value) collapsedCount += 1;
  },
});

const projectItem = new FakeElement(['project-item'], listEl);
const conversationItem = new FakeElement(['conversation-item'], projectItem);
controller.handleOutsidePointerDown({ target: conversationItem });
assert.strictEqual(expanded.p1, true, 'clicking a conversation must keep the project expanded');

const filePanelClick = new FakeElement(['file-tree-row']);
controller.handleOutsidePointerDown({ target: filePanelClick });
assert.strictEqual(expanded.p1, true, 'clicking outside the project list must keep the project expanded');

const emptyListArea = new FakeElement([], listEl);
controller.handleOutsidePointerDown({ target: emptyListArea });
assert.strictEqual(expanded.p1, false, 'clicking the empty project-list area should collapse expanded projects');
assert.strictEqual(collapsedCount, 1, 'collapse should happen only for the empty project-list area');

console.log('renderer-project-sidebar.test.js: ok');
