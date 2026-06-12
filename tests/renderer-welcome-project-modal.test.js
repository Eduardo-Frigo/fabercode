const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.className = id === 'welcome-project-modal' ? 'welcome-project-modal hidden' : '';
    this.listeners = {};
    this.attributes = {};
    this.textContent = '';
    this.type = '';
    this.parent = null;
    this.classList = {
      add: (className) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(className);
        this.className = Array.from(classes).join(' ');
      },
      remove: (className) => {
        this.className = this.className.split(/\s+/).filter(Boolean).filter((entry) => entry !== className).join(' ');
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

  set innerHTML(_) {
    this.children = [];
  }
}

const elements = {
  'welcome-project-modal': new FakeElement('welcome-project-modal'),
  'welcome-project-backdrop': new FakeElement('welcome-project-backdrop'),
  'welcome-project-close': new FakeElement('welcome-project-close'),
  'welcome-project-list': new FakeElement('welcome-project-list'),
  'welcome-project-create': new FakeElement('welcome-project-create'),
  'welcome-start-conversation': new FakeElement('welcome-start-conversation'),
  'welcome-new-project': new FakeElement('welcome-new-project'),
};

const sandbox = {
  document: {
    createElement: () => new FakeElement(),
    getElementById: (id) => elements[id] || null,
  },
  window: {},
};
sandbox.window.window = sandbox.window;

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'welcome_project_modal.js'), 'utf8');
vm.runInNewContext(source, sandbox, { filename: 'welcome_project_modal.js' });

const factory = sandbox.window.FaberWelcomeProjectModal.createWelcomeProjectModalController;
const starts = [];
const controller = factory({
  t: (key) => ({ startInProject: 'Iniciar', noProjectsForWelcome: 'Nenhum projeto' }[key] || key),
  getProjects: () => [
    { id: 'p1', name: 'Alpha', rootPath: '/tmp/alpha' },
    { id: 'p2', name: 'Beta', rootPath: '/tmp/beta' },
  ],
  getSelectedProjectId: () => 'p2',
  onStartProject: async (projectId) => starts.push(projectId),
});

controller.bindEvents();

(async () => {
  await elements['welcome-start-conversation'].listeners.click();
  assert.deepStrictEqual(starts, ['p2'], 'welcome start should use the selected project directly');
  assert.strictEqual(
    elements['welcome-project-modal'].classList.contains('hidden'),
    true,
    'direct start should not open the project picker modal'
  );

  const fallbackController = factory({
    getProjects: () => [{ id: 'p1', name: 'Alpha', rootPath: '/tmp/alpha' }],
    getSelectedProjectId: () => null,
  });
  await fallbackController.startFromSelectedProject();
  assert.strictEqual(
    elements['welcome-project-modal'].classList.contains('hidden'),
    false,
    'welcome start should still open the picker when no project is selected'
  );
  assert.strictEqual(elements['welcome-project-list'].children.length, 1, 'picker should render available projects');

  console.log('renderer-welcome-project-modal.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
