const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(classes = [], parent = null) {
    this.children = [];
    this.className = classes.join(' ');
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.parent = parent;
    this.textContent = '';
    this.value = '';
    this.style = {};
    this.classList = {
      add: (className) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(className);
        this.className = Array.from(classes).join(' ');
      },
      remove: (className) => {
        const classes = this.className.split(/\s+/).filter(Boolean).filter((entry) => entry !== className);
        this.className = classes.join(' ');
      },
      toggle: (className, force) => {
        const shouldAdd = force === undefined ? !this.classList.contains(className) : Boolean(force);
        if (shouldAdd) this.classList.add(className);
        else this.classList.remove(className);
      },
      contains: (className) => this.className.split(/\s+/).includes(className),
    };
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
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
const body = new FakeElement();
const sandbox = {
  Element: FakeElement,
  document: {
    body,
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
assert.strictEqual(expanded.p1, true, 'clicking the empty project-list area should keep projects expanded');
assert.strictEqual(collapsedCount, 0, 'collapse should not happen');

const renderedList = new FakeElement();
const renderController = sidebar.createProjectSidebarController({
  listEl: renderedList,
  getProjects: () => [{ id: 'project-a', name: 'Projeto Alpha' }],
  getExpandedProjects: () => ({}),
});
renderController.render();
const renderedHeader = renderedList.children[0] && renderedList.children[0].children[0];
assert.ok(renderedHeader, 'project render should create a header button');
const renderedHeaderClasses = renderedHeader.children.map((child) => child.className);
assert.ok(renderedHeaderClasses.includes('folder-icon'), 'expanded sidebar should keep the regular folder icon');
assert.ok(renderedHeaderClasses.includes('project-rail-icon'), 'project rows should keep a hidden compact icon available for rail contexts');

const railList = new FakeElement();
const railToggle = new FakeElement();
const railLightbox = new FakeElement(['project-rail-lightbox', 'hidden']);
const railLightboxList = new FakeElement(['project-rail-lightbox-list'], railLightbox);
const railLightboxClose = new FakeElement(['project-rail-lightbox__close'], railLightbox);
const railLightboxBackdrop = new FakeElement(['project-rail-lightbox__backdrop'], railLightbox);
const railController = sidebar.createProjectSidebarController({
  listEl: railList,
  railMenuToggleEl: railToggle,
  railLightboxEl: railLightbox,
  railMenuListEl: railLightboxList,
  railMenuCloseEl: railLightboxClose,
  railMenuBackdropEl: railLightboxBackdrop,
  getProjects: () => [{ id: 'project-a', name: 'Projeto Alpha' }],
  getExpandedProjects: () => ({}),
});
body.classList.add('workspace-left-collapsed');
railController.setRailMenuOpen(true);
assert.strictEqual(body.classList.contains('project-rail-menu-open'), true, 'collapsed project rail button should open a mini project menu');
assert.strictEqual(railToggle.attributes['aria-expanded'], 'true');
assert.strictEqual(railLightbox.classList.contains('hidden'), false, 'collapsed project menu should open a lightbox surface');
assert.strictEqual(railLightbox.attributes['aria-hidden'], 'false');
assert.strictEqual(railLightboxList.children.length, 1, 'project lightbox should render the project list');
railController.handleOutsidePointerDown({ target: railLightboxList.children[0] });
assert.strictEqual(body.classList.contains('project-rail-menu-open'), true, 'clicking inside the lightbox menu should keep it open');
railController.handleOutsidePointerDown({ target: new FakeElement(['outside']) });
assert.strictEqual(body.classList.contains('project-rail-menu-open'), false, 'clicking outside the mini project menu should close it');
assert.strictEqual(railToggle.attributes['aria-expanded'], 'false');
assert.strictEqual(railLightbox.classList.contains('hidden'), true);
assert.strictEqual(railLightbox.attributes['aria-hidden'], 'true');

async function testCollapsedRailHeaderOnlyExpandsProject() {
  const localBody = new FakeElement(['workspace-left-collapsed']);
  const localRailToggle = new FakeElement();
  const localLightbox = new FakeElement(['project-rail-lightbox', 'hidden']);
  const localList = new FakeElement(['project-rail-lightbox-list'], localLightbox);
  let selectedProjects = 0;
  let selectedConversations = 0;
  const localExpanded = {};
  const previousBody = sandbox.document.body;
  sandbox.document.body = localBody;

  const localController = sidebar.createProjectSidebarController({
    listEl: new FakeElement(),
    railMenuToggleEl: localRailToggle,
    railLightboxEl: localLightbox,
    railMenuListEl: localList,
    getProjects: () => [{ id: 'project-a', name: 'Projeto Alpha' }],
    getExpandedProjects: () => localExpanded,
    setProjectExpanded: (projectId, value) => {
      localExpanded[projectId] = value;
    },
    getConversations: () => [{ id: 'conv-1', title: 'Briefing inicial' }],
    onSelectProject: async () => {
      selectedProjects += 1;
    },
    onSelectConversation: async () => {
      selectedConversations += 1;
    },
  });

  localController.setRailMenuOpen(true);
  const header = localList.children[0] && localList.children[0].children[0];
  assert.ok(header && header.listeners.click, 'project header should be clickable in collapsed rail lightbox');
  await header.listeners.click();
  assert.strictEqual(localExpanded['project-a'], true, 'project header should expand conversations');
  assert.strictEqual(selectedProjects, 0, 'project header in collapsed rail must not select/open the project');
  assert.strictEqual(localBody.classList.contains('project-rail-menu-open'), true, 'lightbox should stay open after expanding project');

  const expandedProject = localList.children[0];
  const conversationTree = expandedProject.children[1];
  const conversationList = conversationTree.children[1];
  const conversationButton = conversationList.children[0].children[0];
  await conversationButton.listeners.click({ stopPropagation: () => {} });
  assert.strictEqual(selectedConversations, 1, 'conversation click should open the conversation');
  assert.strictEqual(localBody.classList.contains('project-rail-menu-open'), false, 'conversation selection should close the lightbox');

  sandbox.document.body = previousBody;
}

testCollapsedRailHeaderOnlyExpandsProject()
  .then(() => {
    console.log('renderer-project-sidebar.test.js: ok');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
