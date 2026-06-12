const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'account_gate.js'), 'utf8');
const sandbox = { window: {} };
sandbox.window.window = sandbox.window;

vm.runInNewContext(source, sandbox, { filename: 'account_gate.js' });

const accountGate = sandbox.window.FaberAccountGate;
assert.ok(accountGate, 'FaberAccountGate should be registered');

assert.strictEqual(accountGate.isSignedIn({ ok: true, signedIn: true, user: { email: 'a@b.com' } }), true);
assert.strictEqual(accountGate.isSignedIn({ ok: true, signedIn: false }), false);
assert.strictEqual(accountGate.hasPlatformMedia({ config: { media: { pexelsConfigured: true } } }), true);
assert.strictEqual(accountGate.hasPlatformMedia({ config: { media: { pexelsConfigured: false } } }), false);
assert.strictEqual(accountGate.normalizeWorkspacePreference('programador'), 'ide');
assert.strictEqual(accountGate.normalizeWorkspacePreference('anything'), 'chat');
assert.strictEqual(accountGate.getPreferredDeviceLanguage({ navigator: { language: 'en-US' } }), 'en-US');
assert.strictEqual(accountGate.getPreferredSignupLanguage({
  documentRef: { documentElement: { lang: 'pt-BR' } },
  getInterfaceLanguage: () => 'pt-BR',
}), 'pt-BR');
assert.match(
  accountGate.formatGithubSetupMessage({
    ok: false,
    missing: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    setup: { redirectUri: 'http://127.0.0.1:37418/auth/github/callback' },
  }),
  /Authorization callback URL: http:\/\/127\.0\.0\.1:37418\/auth\/github\/callback/
);

function createClassList() {
  const values = new Set();
  return {
    contains: (name) => values.has(name),
    add: (name) => {
      values.add(name);
    },
    remove: (name) => {
      values.delete(name);
    },
    toggle: (name, force) => {
      const shouldAdd = force === undefined ? !values.has(name) : Boolean(force);
      if (shouldAdd) values.add(name);
      else values.delete(name);
      return shouldAdd;
    },
  };
}

function createElement() {
  return {
    classList: createClassList(),
    disabled: false,
    textContent: '',
    value: '',
    attrs: {},
    focus: () => {},
    addEventListener: () => {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

async function run() {
  const gateEl = createElement();
  const statusEl = createElement();
  const actionsEl = createElement();
  const googleButton = createElement();
  const backButton = createElement();
  const signOutButton = createElement();
  const refreshButton = createElement();
  const emailToggle = createElement();
  const emailForm = createElement();
  const emailInput = createElement();
  const passwordInput = createElement();
  const emailSubmit = createElement();
  const createToggle = createElement();
  const signupFields = createElement();
  const fullNameInput = createElement();
  const themeSelect = createElement();
  const languageSelect = createElement();
  const workspaceSelect = createElement();
  const signupWorkspaceSelect = createElement();
  const githubButton = createElement();
  const body = createElement();
  const documentRef = {
    documentElement: { lang: 'pt-BR' },
    defaultView: {
      navigator: { language: 'en-US' },
      matchMedia: () => ({ matches: true }),
    },
    body,
    getElementById(id) {
      return {
        'account-gate': gateEl,
        'account-gate-actions': actionsEl,
        'account-gate-status': statusEl,
        'account-gate-email-toggle': emailToggle,
        'account-gate-email-form': emailForm,
        'account-gate-email': emailInput,
        'account-gate-password': passwordInput,
        'account-gate-email-submit': emailSubmit,
        'account-gate-create-toggle': createToggle,
        'account-gate-signup-fields': signupFields,
        'account-gate-full-name': fullNameInput,
        'account-gate-theme': themeSelect,
        'account-gate-language': languageSelect,
        'account-gate-workspace': workspaceSelect,
        'account-gate-signup-workspace': signupWorkspaceSelect,
        'account-gate-google-login': googleButton,
        'account-gate-github-login': githubButton,
        'account-gate-back': backButton,
        'account-gate-sign-out': signOutButton,
        'account-gate-refresh': refreshButton,
      }[id] || null;
    },
  };

  let accountEventCallback = null;
  let accountStatus = {
    ok: true,
    signedIn: false,
    user: null,
    config: {
      media: { pexelsConfigured: true },
      google: { configured: true, missing: [] },
      github: { configured: true, missing: [] },
      missing: [],
    },
  };
  const api = {
    getAccountStatus: async () => accountStatus,
    startGoogleLogin: async () => ({ ok: true }),
    startGithubAccountLogin: async () => ({ ok: true }),
    signInWithPassword: async () => ({ ok: true }),
    signUpWithPassword: async (payload) => {
      api.lastSignUpPayload = payload;
      return { ok: true };
    },
    signOutAccount: async () => ({ ok: true }),
    onAccountEvent: (callback) => {
      accountEventCallback = callback;
      return () => {};
    },
  };
  const statusChanges = [];
  const workspaceSelections = [];
  const controller = accountGate.createAccountGateController({
    api,
    documentRef,
    getInterfaceLanguage: () => 'pt-BR',
    onStatusChange: (status, unlocked) => statusChanges.push({ status, unlocked }),
    onWorkspacePreferenceSelected: (mode) => workspaceSelections.push(mode),
  });

  controller.bindEvents();
  await controller.refresh();
  assert.strictEqual(controller.isUnlocked(), false);
  assert.strictEqual(body.classList.contains('account-locked'), true);
  assert.strictEqual(gateEl.classList.contains('hidden'), false);
  controller.showEmailForm('signup');
  assert.strictEqual(actionsEl.classList.contains('hidden'), true);
  assert.strictEqual(emailForm.classList.contains('hidden'), false);
  assert.strictEqual(signupFields.classList.contains('hidden'), false);
  assert.strictEqual(languageSelect.value, 'pt-BR');
  assert.strictEqual(themeSelect.value, 'light');
  assert.strictEqual(workspaceSelect.value, 'chat');
  signupWorkspaceSelect.value = 'ide';
  emailInput.value = 'owner@example.com';
  passwordInput.value = 'secret-password';
  await controller.submitEmailForm();
  assert.strictEqual(workspaceSelections.at(-1), 'ide');
  assert.strictEqual(api.lastSignUpPayload.languagePreference, 'pt-BR');
  controller.showChoices();
  assert.strictEqual(actionsEl.classList.contains('hidden'), false);
  assert.strictEqual(emailForm.classList.contains('hidden'), true);
  assert.strictEqual(signupFields.classList.contains('hidden'), true);
  api.startGithubAccountLogin = async () => ({
    ok: false,
    missing: ['GITHUB_CLIENT_ID'],
    setup: { redirectUri: 'http://127.0.0.1:37418/auth/github/callback' },
  });
  await controller.startGithubLogin();
  assert.match(statusEl.textContent, /GitHub OAuth/);
  assert.match(statusEl.textContent, /auth\/github\/callback/);
  api.startGithubAccountLogin = async () => ({ ok: true });
  controller.showEmailForm('signup');

  accountStatus = {
    ok: true,
    signedIn: true,
    user: { email: 'owner@example.com' },
    config: {
      media: { pexelsConfigured: true },
      google: { configured: true, missing: [] },
      github: { configured: true, missing: [] },
      missing: [],
    },
  };
  await accountEventCallback({ type: 'signed-in' });
  assert.strictEqual(controller.isUnlocked(), true);
  assert.strictEqual(body.classList.contains('account-locked'), false);
  assert.strictEqual(gateEl.classList.contains('hidden'), true);
  assert.strictEqual(signOutButton.classList.contains('hidden'), false);
  assert.strictEqual(statusChanges.at(-1).unlocked, true);

  accountStatus = {
    ok: true,
    signedIn: true,
    user: { email: 'owner@example.com' },
    config: {
      media: { pexelsConfigured: false },
      google: { configured: true, missing: [] },
      github: { configured: true, missing: [] },
      missing: [],
    },
  };
  await controller.refresh();
  assert.strictEqual(controller.isUnlocked(), false);
  assert.match(statusEl.textContent, /PEXELS_API_KEY/);

  console.log('renderer-account-gate.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
