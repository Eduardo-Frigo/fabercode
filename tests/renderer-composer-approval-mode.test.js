const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor() {
    this.attributes = {};
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.value = 'ask_each';
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this });
  }
}

const container = new FakeElement();
const select = new FakeElement();
const nodes = new Map([
  ['composer-approval-mode', container],
  ['composer-approval-mode-select', select],
]);
const document = {
  getElementById(id) {
    return nodes.get(id) || null;
  },
};
const window = {};
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'composer_approval_mode.js'), 'utf8');
vm.runInNewContext(source, { document, window }, { filename: 'composer_approval_mode.js' });

const api = window.FaberComposerApprovalMode;
assert.ok(api, 'composer approval mode module should register its browser facade');
assert.strictEqual(api.normalizeApprovalMode('ask_each'), 'ask_each');
assert.strictEqual(api.normalizeApprovalMode('delegate_task'), 'delegate_task');
for (const hostileValue of [undefined, null, '', 'autoAllow', 'delegate', {}, 1, true]) {
  assert.strictEqual(api.normalizeApprovalMode(hostileValue), 'ask_each', 'unknown modes must fail closed');
}
const hostileContext = {};
Object.defineProperty(hostileContext, 'uiMode', {
  get() {
    throw new Error('hostile context getter');
  },
});

const state = { composerApprovalMode: 'unexpected' };
const controller = api.createComposerApprovalModeController({ document, state });
assert.deepStrictEqual(
  Object.keys(controller).sort(),
  ['bindEvents', 'captureSubmission', 'finishSubmission', 'render', 'reset', 'setContext'].sort(),
  'controller should expose only the approval-mode lifecycle surface',
);

controller.bindEvents();
controller.bindEvents();
assert.strictEqual((select.listeners.get('change') || []).length, 1, 'event binding must be idempotent');
assert.strictEqual(select.value, 'ask_each', 'ask_each must be the initial mode');
assert.strictEqual(select.disabled, false);
assert.strictEqual(container.hidden, false);
assert.strictEqual(state.composerApprovalMode, 'ask_each');

select.value = 'delegate_task';
select.dispatch('change');
assert.strictEqual(container.attributes['data-approval-mode'], 'delegate_task');
assert.strictEqual(state.composerApprovalMode, 'delegate_task');

const first = controller.captureSubmission({ uiMode: 'default' });
assert.strictEqual(Object.isFrozen(first), true, 'submission snapshot must be immutable');
assert.strictEqual(Object.isFrozen(first.token), true, 'submission token must be immutable');
assert.deepStrictEqual(Object.keys(first).sort(), ['approvalMode', 'token']);
assert.strictEqual(first.approvalMode, 'delegate_task');
assert.strictEqual(select.disabled, true, 'mode changes must be disabled during submission');

select.value = 'ask_each';
select.dispatch('change');
assert.strictEqual(select.value, 'delegate_task', 'disabled submissions must retain their captured choice');

const current = controller.captureSubmission({ uiMode: 'default' });
assert.notStrictEqual(current.token, first.token, 'every submission must receive an identity token');
assert.strictEqual(controller.finishSubmission(first, { accepted: true }), false, 'stale snapshots must be ignored');
assert.strictEqual(controller.finishSubmission(Object.freeze({}), { accepted: true }), false, 'lookalike tokens must be ignored');
assert.strictEqual(select.disabled, true, 'stale completion must not unlock a newer submission');
assert.strictEqual(controller.finishSubmission(current.token, { accepted: false }), true);
assert.strictEqual(select.value, 'delegate_task', 'failed submissions must preserve the chosen mode');
assert.strictEqual(select.disabled, false);

const accepted = controller.captureSubmission({ uiMode: 'default' });
assert.strictEqual(controller.finishSubmission(accepted, { accepted: true }), true);
assert.strictEqual(select.value, 'ask_each', 'accepted submissions must return to ask_each');
assert.strictEqual(state.composerApprovalMode, 'ask_each');

select.value = 'delegate_task';
select.dispatch('change');
const invalidated = controller.captureSubmission({ uiMode: 'default' });
controller.reset();
assert.strictEqual(controller.finishSubmission(invalidated, { accepted: false }), false, 'reset must invalidate active tokens');
assert.strictEqual(select.value, 'ask_each');

controller.setContext('cortex');
assert.strictEqual(container.hidden, true, 'Cortex must hide project approval controls');
assert.strictEqual(container.attributes['aria-hidden'], 'true');
assert.strictEqual(select.disabled, true);
assert.strictEqual(select.value, 'ask_each', 'Cortex must force ask_each');
assert.strictEqual(state.composerApprovalMode, 'ask_each');
const cortexSubmission = controller.captureSubmission({ uiMode: 'cortex' });
assert.strictEqual(cortexSubmission.approvalMode, 'ask_each');

controller.setContext('unexpected-context');
assert.strictEqual(container.hidden, true, 'unknown UI contexts must fail closed as Cortex');
controller.setContext('default');
assert.strictEqual(controller.finishSubmission(cortexSubmission, { accepted: false }), false, 'context changes must invalidate tokens');
assert.strictEqual(container.hidden, false);
assert.strictEqual(select.disabled, false);
assert.strictEqual(select.value, 'ask_each');

const hostileSnapshot = controller.captureSubmission(hostileContext);
assert.strictEqual(hostileSnapshot.approvalMode, 'ask_each', 'hostile context access must fail closed');
assert.strictEqual(container.hidden, true);
assert.strictEqual(controller.finishSubmission(hostileSnapshot, { accepted: false }), true);

const rootDir = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'renderer', 'index.html'), 'utf8');
const stylesEntry = fs.readFileSync(path.join(rootDir, 'renderer', 'styles.css'), 'utf8').trim();
const approvalCss = fs.readFileSync(
  path.join(rootDir, 'renderer', 'styles', 'composer-approval-mode.css'),
  'utf8',
);
assert.match(indexHtml, /value="ask_each"/);
assert.match(indexHtml, /value="delegate_task"/);
assert.match(indexHtml, /aria-describedby="composer-approval-mode-help"/);
assert.match(
  indexHtml,
  /<div class="composer-toolbar">[\s\S]*id="btn-attach"[\s\S]*id="composer-provider"[\s\S]*id="composer-approval-mode"[\s\S]*id="btn-send"[\s\S]*<\/div>/,
  'all send controls must share the composer toolbar in stable DOM order',
);
assert.match(indexHtml, /class="sr-only" data-i18n="approvalModeLabel"/);
assert.ok(
  stylesEntry.endsWith('@import url("./styles/composer-approval-mode.css");'),
  'approval-mode CSS must be the final stylesheet layer',
);
assert.match(approvalCss, /@container workspace-chat \(max-width: 640px\)/);
assert.match(approvalCss, /@container workspace-chat \(max-width: 430px\)/);
assert.match(approvalCss, /\.composer-toolbar\s*\{[\s\S]*display:\s*flex/);
assert.match(approvalCss, /\.composer-toolbar \.icon-btn,[\s\S]*position:\s*static/);
assert.match(approvalCss, /\.composer \.input-shell > #user-input\s*\{[\s\S]*padding:\s*12px 14px/);
assert.match(approvalCss, /body\[data-theme='light'\]/);
assert.match(approvalCss, /:focus-visible/);
assert.match(approvalCss, /:disabled/);

console.log('renderer-composer-approval-mode.test.js: ok');
