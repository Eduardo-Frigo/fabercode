const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(tagName = 'div', className = '') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = className;
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.rawInnerHTML = '';
    this.classList = {
      add: (classNameToAdd) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(classNameToAdd);
        this.className = Array.from(classes).join(' ');
      },
      remove: (classNameToRemove) => {
        this.className = this.className
          .split(/\s+/)
          .filter(Boolean)
          .filter((entry) => entry !== classNameToRemove)
          .join(' ');
      },
      contains: (classNameToFind) => this.className.split(/\s+/).includes(classNameToFind),
    };
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  removeEventListener(type) {
    delete this.listeners[type];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  focus() {}

  set innerHTML(value) {
    this.rawInnerHTML = String(value || '');
    this.children = [];
  }

  get innerHTML() {
    return this.rawInnerHTML;
  }
}

const ids = {
  'project-file-modal': new FakeElement('div', 'hidden'),
  'project-file-modal-title': new FakeElement('h2'),
  'project-file-modal-content': new FakeElement('div'),
  'project-file-modal-close': new FakeElement('button'),
  'project-file-editor': new FakeElement('textarea'),
  'project-file-lines': new FakeElement('pre'),
  'project-file-save': new FakeElement('button'),
  'project-file-status': new FakeElement('span'),
  'unsaved-exit-modal': new FakeElement('div', 'hidden'),
  'unsaved-exit-backdrop': new FakeElement('div'),
  'unsaved-exit-no': new FakeElement('button'),
  'unsaved-exit-yes': new FakeElement('button'),
};

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'project_file_editor.js'), 'utf8');
const sandbox = {
  document: {
    body: new FakeElement('body'),
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => ids[id] || null,
  },
  setTimeout: (callback) => {
    if (typeof callback === 'function') callback();
    return 1;
  },
  window: {
    confirm: () => true,
  },
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;

vm.runInNewContext(source, sandbox, { filename: 'project_file_editor.js' });

const controller = sandbox.window.FaberProjectFileEditor.createProjectFileEditorController({
  api: {
    readProjectFile: async () => {
      throw new Error('image preview should not read file content');
    },
    writeProjectFile: async () => ({ ok: true }),
  },
  getProjectInfo: () => ({
    rootPath: '/tmp/faber project',
  }),
});

(async () => {
  await controller.open('assets/bad.jpg"onerror="alert(1).jpg');

  const content = ids['project-file-modal-content'];
  assert.strictEqual(content.children.length, 1, 'image preview should append a DOM image node');
  const image = content.children[0];
  assert.strictEqual(image.tagName, 'IMG');
  assert.strictEqual(content.innerHTML.includes('onerror'), false, 'image preview must not build user paths through HTML');
  assert.ok(String(image.src || '').startsWith('file:///tmp/faber%20project/assets/'));
  assert.strictEqual(String(image.src || '').includes('"'), false, 'image src should encode quotes from file names');
  assert.ok(String(image.src || '').includes('%22onerror%3D%22alert(1).jpg'));

  console.log('renderer-file-editor.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
