const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const preferencesSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace_layout_preferences.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace_layout_runtime.js'), 'utf8');

function createClassList() {
  const values = new Set();
  return {
    add: (name) => values.add(name),
    remove: (name) => values.delete(name),
    toggle: (name, force) => {
      const next = force === undefined ? !values.has(name) : Boolean(force);
      if (next) values.add(name);
      else values.delete(name);
      return next;
    },
    contains: (name) => values.has(name),
  };
}

function createElement(id, tool) {
  const element = {
    id,
    children: [],
    classList: createClassList(),
    dataset: {},
    parentElement: null,
    attrs: tool ? { 'data-workspace-runtime-tool': tool } : {},
    getAttribute(name) {
      return this.attrs[name] || '';
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    appendChild(child) {
      return this.insertBefore(child, null);
    },
    insertBefore(child, before) {
      if (child.parentElement) {
        child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
      }
      child.parentElement = this;
      const index = before ? this.children.indexOf(before) : -1;
      if (index >= 0) this.children.splice(index, 0, child);
      else this.children.push(child);
      return child;
    },
  };
  if (tool) element.classList.add('workspace-tool-region');
  return element;
}

const elements = {
  'workspace-left-zone': createElement('workspace-left-zone'),
  'workspace-center-zone': createElement('workspace-center-zone'),
  'workspace-center-tools-zone': createElement('workspace-center-tools-zone'),
  'workspace-right-zone': createElement('workspace-right-zone'),
  'workspace-bottom-zone': createElement('workspace-bottom-zone'),
  'workspace-projects-region': createElement('workspace-projects-region', 'projects'),
  'workspace-chat-region': createElement('workspace-chat-region', 'chat'),
  'workspace-files-region': createElement('workspace-files-region', 'files'),
  'project-terminal-panel': createElement('project-terminal-panel', 'terminal'),
  'workspace-actions-region': createElement('workspace-actions-region', 'automations'),
  'cortex-learning-box': createElement('cortex-learning-box', 'cortex'),
};

elements['workspace-left-zone'].appendChild(elements['workspace-projects-region']);
elements['workspace-center-zone'].appendChild(elements['workspace-chat-region']);
elements['workspace-right-zone'].appendChild(elements['workspace-files-region']);
elements['workspace-right-zone'].appendChild(elements['project-terminal-panel']);
elements['workspace-right-zone'].appendChild(elements['cortex-learning-box']);
elements['workspace-right-zone'].appendChild(elements['workspace-actions-region']);

const documentRef = {
  body: { dataset: {} },
  getElementById(id) {
    return elements[id] || null;
  },
};

const sandbox = { window: {}, document: documentRef };
sandbox.window.window = sandbox.window;
sandbox.window.document = documentRef;

vm.runInNewContext(preferencesSource, sandbox, { filename: 'workspace_layout_preferences.js' });
vm.runInNewContext(runtimeSource, sandbox, { filename: 'workspace_layout_runtime.js' });

const runtimeModule = sandbox.window.FaberWorkspaceLayoutRuntime;
assert.ok(runtimeModule, 'FaberWorkspaceLayoutRuntime should be registered');

const runtime = runtimeModule.createWorkspaceLayoutRuntimeController({ documentRef });
runtime.applyPreferences({
  terminalDock: 'bottom',
  toolPlacements: {
    projects: 'left',
    chat: 'center',
    files: 'left',
    terminal: 'bottom',
    automations: 'hidden',
    cortex: 'right',
  },
});

assert.strictEqual(elements['workspace-files-region'].parentElement, elements['workspace-left-zone']);
assert.strictEqual(elements['project-terminal-panel'].parentElement, elements['workspace-bottom-zone']);
assert.strictEqual(elements['workspace-actions-region'].classList.contains('workspace-runtime-hidden'), true);
assert.strictEqual(documentRef.body.dataset.workspaceRuntimeApplied, 'true');

runtime.applyPreferences({
  terminalDock: 'right',
  toolPlacements: {
    projects: 'hidden',
    chat: 'center',
    files: 'right',
    terminal: 'right',
    automations: 'right',
    cortex: 'hidden',
  },
});

assert.strictEqual(elements['project-terminal-panel'].parentElement, elements['workspace-right-zone']);
assert.strictEqual(elements['workspace-projects-region'].classList.contains('workspace-runtime-hidden'), true);
assert.strictEqual(elements['cortex-learning-box'].classList.contains('workspace-runtime-hidden'), true);

console.log('renderer-workspace-layout-runtime.test.js: ok');
