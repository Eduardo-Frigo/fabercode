const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createClassList() {
  const values = new Set();
  return {
    add: (name) => values.add(name),
    remove: (name) => values.delete(name),
    contains: (name) => values.has(name),
  };
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'startup_preloader.js'), 'utf8');
  const timers = [];
  const listeners = {};
  const logo = {
    classList: createClassList(),
    offsetWidth: 12,
    addEventListener: (eventName, handler) => {
      listeners[eventName] = handler;
    },
  };
  const element = {
    classList: createClassList(),
    parentNode: {
      removed: null,
      removeChild(node) {
        this.removed = node;
      },
    },
    querySelector: (selector) => (selector === '.startup-preloader__logo-img' ? logo : null),
  };
  const body = { classList: createClassList() };
  const fakeWindow = {
    setTimeout: (fn, delay = 0) => {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => fn(),
  };
  const documentRef = {
    body,
    defaultView: fakeWindow,
    querySelector: () => element,
  };
  const sandbox = { window: fakeWindow, document: documentRef, Promise, Date, console };
  vm.runInNewContext(source, sandbox);

  const controller = sandbox.window.FaberStartupPreloader.createStartupPreloaderController({
    document: documentRef,
    element,
    logoAnimationTimeoutMs: 999,
    minVisibleMs: 0,
    startedAt: Date.now(),
  });

  assert.strictEqual(logo.classList.contains('is-animating'), true);

  controller.hide();
  const hideTimer = timers.find((timer) => timer.delay === 0);
  assert.ok(hideTimer, 'hide must schedule a zero-delay timer after minVisibleMs has elapsed');
  hideTimer.fn();

  assert.strictEqual(element.classList.contains('is-hidden'), false);
  assert.strictEqual(typeof listeners.animationend, 'function');

  listeners.animationend();
  await Promise.resolve();

  assert.strictEqual(element.classList.contains('is-hidden'), true);
  const finishTimer = timers.find((timer) => timer.delay === 460);
  assert.ok(finishTimer, 'finish must wait for the fade-out duration');
  finishTimer.fn();

  assert.strictEqual(element.parentNode.removed, element);
  assert.strictEqual(body.classList.contains('ui-ready'), true);

  console.log('renderer-startup-preloader.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
