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

function createElement(attributes = {}) {
  const values = new Map(Object.entries(attributes));
  return {
    attributes: values,
    classList: createClassList(),
    disabled: false,
    nodeType: 1,
    style: {},
    textContent: '',
    closest() { return this; },
    contains() { return false; },
    getAttribute(name) { return values.has(name) ? values.get(name) : null; },
    setAttribute(name, value) { values.set(name, String(value)); },
    hasAttribute(name) { return values.has(name); },
    removeAttribute(name) { values.delete(name); },
    getBoundingClientRect() {
      return { left: 100, top: 100, right: 140, bottom: 140, width: 40, height: 40 };
    },
  };
}

const button = createElement({ title: 'Arquivos', 'aria-label': 'Arquivos' });
const body = createElement();
body.appendChild = (node) => { body.tooltip = node; };
body.contains = (node) => node === button || node === body.tooltip;

const listeners = {};
const document = {
  body,
  readyState: 'loading',
  createElement: () => createElement(),
  querySelectorAll: () => [button],
  addEventListener(type, handler) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(handler);
  },
};

let scheduled = null;
const source = fs.readFileSync(
  path.join(__dirname, '..', 'renderer', 'hover_tooltips.js'),
  'utf8'
);
const sandbox = {
  MutationObserver: undefined,
  clearTimeout: () => { scheduled = null; },
  document,
  setTimeout(callback, delay) {
    scheduled = { callback, delay };
    return 1;
  },
  window: {
    addEventListener() {},
    innerWidth: 1200,
  },
};
vm.runInNewContext(source, sandbox, { filename: 'hover_tooltips.js' });

const api = sandbox.window.FaberHoverTooltips;
assert.ok(api, 'hover tooltip module should be registered');
const controller = api.createHoverTooltipController({ document });
controller.bind();

listeners.mouseover[0]({ target: button });
assert.ok(scheduled, 'hover should schedule a tooltip');
assert.strictEqual(scheduled.delay, 3000, 'tool names should appear after three seconds');
scheduled.callback();
assert.strictEqual(body.tooltip.textContent, 'Arquivos');
assert.strictEqual(body.tooltip.getAttribute('aria-hidden'), 'false');

button.setAttribute('aria-label', 'Files');
assert.strictEqual(controller.getTooltipText(button), 'Files', 'derived tooltip should follow language updates');

body.classList.add('progressive-tutorial-active');
controller.hideTooltip();
scheduled = null;
listeners.mouseover[0]({ target: button });
assert.strictEqual(scheduled, null, 'normal tooltip should stay hidden while the guided tutorial is active');

console.log('renderer-hover-tooltips.test.js: ok');
