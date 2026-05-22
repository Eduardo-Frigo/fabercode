const assert = require('assert');

const { registerAccountHandlers } = require('../main/ipc/account_handlers');

function createHandlerMap() {
  const handlers = {};
  return {
    handlers,
    registerIpcHandler: (channel, handler) => {
      handlers[channel] = handler;
    },
  };
}

async function run() {
  const audit = [];
  const accountEvents = [];
  const opened = [];
  const accountService = {
    getStatus: () => ({ ok: true, signedIn: false }),
    createGoogleLoginRequest: () => ({
      ok: true,
      url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
      redirectUri: 'http://127.0.0.1/callback',
    }),
    exchangeGoogleCode: async () => ({ ok: true, session: { user: { email: 'owner@example.com' } } }),
    startEmailLogin: () => ({ ok: true, email: 'owner@example.com', devCode: '123456' }),
    completeEmailLogin: async () => ({ ok: true, session: { user: { email: 'owner@example.com' } } }),
    signInWithPassword: async () => ({ ok: true, session: { user: { email: 'owner@example.com' } } }),
    signUpWithPassword: async () => ({ ok: true, session: { user: { email: 'owner@example.com' } } }),
    signOut: async () => ({ ok: true }),
  };
  const { handlers, registerIpcHandler } = createHandlerMap();

  registerAccountHandlers({
    accountService,
    appendAuditEvent: (type, payload) => audit.push({ type, payload }),
    emitAccountEvent: (payload) => accountEvents.push(payload),
    registerIpcHandler,
    shell: {
      openExternal: async (url) => opened.push(url),
    },
  });

  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'account:email:complete',
    'account:email:start',
    'account:google:complete',
    'account:google:start',
    'account:password:sign-in',
    'account:password:sign-up',
    'account:sign-out',
    'account:status',
  ]);

  assert.deepStrictEqual(await handlers['account:status'](), { ok: true, signedIn: false });
  const googleStart = await handlers['account:google:start'](null, { openExternal: true });
  assert.strictEqual(googleStart.ok, true);
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(audit[0].type, 'account.google_login_started');

  const googleComplete = await handlers['account:google:complete'](null, { code: 'c', state: 's' });
  assert.strictEqual(googleComplete.ok, true);
  assert.ok(audit.some((event) => event.type === 'account.google_login_completed'));
  assert.deepStrictEqual(accountEvents[0], { type: 'signed-in', provider: 'google' });

  const emailStart = await handlers['account:email:start'](null, { email: 'owner@example.com' });
  assert.strictEqual(emailStart.ok, true);
  const emailComplete = await handlers['account:email:complete'](null, { email: 'owner@example.com', code: '123456' });
  assert.strictEqual(emailComplete.ok, true);
  assert.deepStrictEqual(accountEvents[1], { type: 'signed-in', provider: 'email' });
  const passwordSignIn = await handlers['account:password:sign-in'](null, { email: 'owner@example.com', password: 'password123' });
  assert.strictEqual(passwordSignIn.ok, true);
  assert.deepStrictEqual(accountEvents[2], { type: 'signed-in', provider: 'password' });
  const passwordSignUp = await handlers['account:password:sign-up'](null, {
    name: 'Owner Example',
    email: 'owner@example.com',
    password: 'password123',
    themePreference: 'dark',
    languagePreference: 'pt-BR',
  });
  assert.strictEqual(passwordSignUp.ok, true);
  assert.deepStrictEqual(accountEvents[3], { type: 'signed-in', provider: 'password' });
  const signedOut = await handlers['account:sign-out']();
  assert.strictEqual(signedOut.ok, true);
  assert.ok(audit.some((event) => event.type === 'account.signed_out'));
  assert.deepStrictEqual(accountEvents[4], { type: 'signed-out' });

  console.log('account-handlers.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
