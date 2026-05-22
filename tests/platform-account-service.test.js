const assert = require('assert');

const {
  createPlatformAccountService,
  normalizeEmail,
} = require('../main/services/platform_account_service');

async function run() {
  assert.strictEqual(normalizeEmail(' User@Example.COM '), 'user@example.com');

  const disabled = createPlatformAccountService({
    databaseUrl: '',
    sessionSecret: '',
  });
  const disabledStatus = disabled.getStatus();
  assert.strictEqual(disabledStatus.ok, true);
  assert.strictEqual(disabledStatus.config.enabled, false);
  assert.ok(disabledStatus.config.missing.includes('DATABASE_URL'));

  const savedSessions = [];
  const upsertedProfiles = [];
  const passwordIdentities = new Map();
  const store = {
    getStatus: () => ({ available: true, reason: 'ready' }),
    upsertUserIdentity: async (profile) => {
      upsertedProfiles.push(profile);
      return {
        id: `usr_${profile.provider}`,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl || '',
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        themePreference: profile.themePreference || '',
        languagePreference: profile.languagePreference || '',
      };
    },
    getPasswordIdentityByEmail: async (email) => passwordIdentities.get(email) || null,
    createPasswordUser: async (profile) => {
      const user = {
        id: 'usr_password',
        email: profile.email,
        name: profile.name,
        avatarUrl: '',
        provider: 'password',
        providerUserId: profile.email,
        themePreference: profile.themePreference,
        languagePreference: profile.languagePreference,
      };
      passwordIdentities.set(profile.email, {
        user,
        passwordHash: profile.passwordHash,
        provider: 'password',
        providerUserId: profile.email,
      });
      return user;
    },
    saveSession: async (session) => {
      savedSessions.push(session);
      return { ok: true };
    },
    revokeSession: async () => ({ ok: true }),
  };

  const fetchCalls = [];
  const service = createPlatformAccountService({
    allowDevEmailCodes: true,
    appBaseUrl: 'http://127.0.0.1:4141',
    databaseUrl: 'postgresql://faber.local/db',
    fetchFn: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          async json() {
            return { access_token: 'google-access-token' };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            sub: 'google-user-1',
            email: 'Owner@Example.com',
            name: 'Owner Example',
            picture: 'https://example.test/avatar.png',
          };
        },
      };
    },
    googleClientId: 'google-client-id',
    googleClientSecret: 'google-client-secret',
    pexelsApiKey: 'pexels-secret-1234',
    protectSecret: (value) => `protected:${value}`,
    sessionSecret: 'session-secret',
    store,
    unprotectSecret: (value) => String(value || '').replace(/^protected:/, ''),
  });

  const status = service.getStatus();
  assert.strictEqual(status.config.enabled, true);
  assert.strictEqual(status.config.google.configured, true);
  assert.strictEqual(status.config.media.pexelsConfigured, true);

  const login = service.createGoogleLoginRequest();
  assert.strictEqual(login.ok, true);
  assert.ok(login.url.includes('accounts.google.com'));
  assert.ok(login.url.includes('client_id=google-client-id'));
  assert.ok(login.url.includes(encodeURIComponent(login.redirectUri)));

  const completed = await service.exchangeGoogleCode({ code: 'oauth-code', state: login.state });
  assert.strictEqual(completed.ok, true);
  assert.strictEqual(completed.session.user.email, 'owner@example.com');
  assert.strictEqual(upsertedProfiles[0].provider, 'google');
  assert.strictEqual(savedSessions.length, 1);
  assert.strictEqual(fetchCalls.length, 2);

  const emailStart = service.startEmailLogin({ email: 'dev@example.com' });
  assert.strictEqual(emailStart.ok, true);
  assert.strictEqual(emailStart.email, 'dev@example.com');
  assert.ok(emailStart.devCode);

  const emailComplete = await service.completeEmailLogin({
    email: 'dev@example.com',
    code: emailStart.devCode,
  });
  assert.strictEqual(emailComplete.ok, true);
  assert.strictEqual(emailComplete.session.user.email, 'dev@example.com');

  const createdAccount = await service.signUpWithPassword({
    name: 'Password Owner',
    email: 'Password@Example.com',
    password: 'password123',
    themePreference: 'light',
    languagePreference: 'en-US',
  });
  assert.strictEqual(createdAccount.ok, true);
  assert.strictEqual(createdAccount.session.user.email, 'password@example.com');
  assert.strictEqual(createdAccount.session.user.themePreference, 'light');
  assert.strictEqual(createdAccount.session.user.languagePreference, 'en-US');

  const passwordLogin = await service.signInWithPassword({
    email: 'password@example.com',
    password: 'password123',
  });
  assert.strictEqual(passwordLogin.ok, true);
  assert.strictEqual(passwordLogin.session.user.provider, 'password');

  const wrongPassword = await service.signInWithPassword({
    email: 'password@example.com',
    password: 'wrong-password',
  });
  assert.strictEqual(wrongPassword.ok, false);

  const signedOut = await service.signOut();
  assert.strictEqual(signedOut.ok, true);
  assert.strictEqual(service.getStatus().signedIn, false);

  console.log('platform-account-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
