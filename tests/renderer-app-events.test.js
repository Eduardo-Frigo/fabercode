const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
  };
}

function createElement(id) {
  const listeners = {};
  return {
    id,
    classList: createClassList(),
    listeners,
    addEventListener(type, handler) { listeners[type] = handler; },
    clickTarget(target = this) {
      if (listeners.click) listeners.click({ target });
    },
  };
}

const ids = [
  'btn-add-project',
  'btn-send',
  'btn-confirm',
  'btn-cancel',
  'projects-list',
  'chat-log',
];
const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));
const centerHeader = createElement('center-header');
const documentListeners = {};
const document = {
  body: { classList: createClassList() },
  getElementById: (id) => elements[id] || null,
  querySelector: (selector) => (selector === '.panel-center > .panel-header' ? centerHeader : null),
  addEventListener(type, handler) { documentListeners[type] = handler; },
};
const source = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'app_events.js'),
  'utf8'
);
const sandbox = { document, window: {} };
vm.runInNewContext(source, sandbox, { filename: 'app_events.js' });

const center = createElement('center');
const centerTools = createElement('center-tools');
const input = createElement('composer');
let clearCount = 0;
const controller = sandbox.window.FaberAppEvents.createAppEventsController({
  callbacks: { onClearProjectSelection: () => { clearCount += 1; } },
  elements: {
    inputEl: input,
    workspaceCenterToolsZoneEl: centerTools,
    workspaceCenterZoneEl: center,
  },
});
controller.bindEvents();

center.clickTarget();
elements['projects-list'].clickTarget();
elements['chat-log'].clickTarget();
centerHeader.clickTarget();
assert.strictEqual(clearCount, 4, 'neutral workspace areas should clear the active project');

center.clickTarget(createElement('child-control'));
assert.strictEqual(clearCount, 4, 'clicking a control inside a neutral zone should preserve selection');

document.body.classList.add('progressive-tutorial-active');
center.clickTarget();
assert.strictEqual(clearCount, 4, 'guided tutorial interactions should never clear project selection');

console.log('renderer-app-events.test.js: ok');
