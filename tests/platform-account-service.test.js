const assert = require('assert');

const {
  createPlatformAccountService,
  hashSessionToken,
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
  assert.strictEqual(disabledStatus.config.localUnauthenticated, false);
  assert.ok(disabledStatus.config.missing.includes('DATABASE_URL'));
  assert.deepStrictEqual(disabledStatus.access, {
    allowed: false,
    mode: 'none',
    contextRevision: 0,
    platformMedia: false,
    platformSync: false,
  });
  assert.strictEqual(disabled.getProductAccessPrincipal(), null);

  let localPrincipalSequence = 0;
  const localUnauthenticated = createPlatformAccountService({
    allowLocalUnauthenticated: true,
    createLocalPrincipalId: () => `local-development:test-process-${++localPrincipalSequence}`,
    databaseUrl: '',
    isProductAccessAuthorityReady: () => true,
    sessionSecret: '',
  });
  const localUnauthenticatedStatus = localUnauthenticated.getStatus();
  assert.strictEqual(localUnauthenticatedStatus.signedIn, false);
  assert.strictEqual(localUnauthenticatedStatus.user, null);
  assert.strictEqual(localUnauthenticatedStatus.config.localUnauthenticated, true);
  assert.deepStrictEqual(localUnauthenticatedStatus.access, {
    allowed: true,
    mode: 'local_development',
    contextRevision: 1,
    platformMedia: false,
    platformSync: false,
  });
  assert.deepStrictEqual(localUnauthenticated.getProductAccessPrincipal(), {
    kind: 'local_development',
    actorId: 'local-development:test-process-1',
  });
  assert.strictEqual(Object.isFrozen(localUnauthenticated.getProductAccessPrincipal()), true);

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
  const principalChanges = [];
  const service = createPlatformAccountService({
    allowDevEmailCodes: true,
    appBaseUrl: 'http://127.0.0.1:4141',
    databaseUrl: 'postgresql://faber.local/db',
    fetchFn: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      const urlText = String(url);
      if (urlText.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          async json() {
            return { access_token: 'google-access-token' };
          },
        };
      }
      if (urlText.includes('github.com/login/oauth/access_token')) {
        return {
          ok: true,
          async json() {
            return { access_token: 'github-access-token' };
          },
        };
      }
      if (urlText.includes('api.github.com/user/emails')) {
        return {
          ok: true,
          async json() {
            return [{ email: 'GithubOwner@Example.com', primary: true, verified: true }];
          },
        };
      }
      if (urlText.includes('api.github.com/user')) {
        return {
          ok: true,
          async json() {
            return {
              id: 12345,
              login: 'github-owner',
              email: null,
              name: 'GitHub Owner',
              avatar_url: 'https://example.test/github-avatar.png',
            };
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
    githubClientId: 'github-client-id',
    githubClientSecret: 'github-client-secret',
    pexelsApiKey: 'pexels-secret-1234',
    protectSecret: (value) => `protected:${value}`,
    beforeProductAccessContextChange: (event) => {
      principalChanges.push(event);
      return Object.freeze({ ok: true });
    },
    isProductAccessAuthorityReady: () => true,
    sessionSecret: 'session-secret',
    store,
    unprotectSecret: (value) => String(value || '').replace(/^protected:/, ''),
  });

  const status = service.getStatus();
  assert.strictEqual(status.config.enabled, true);
  assert.strictEqual(status.config.google.configured, true);
  assert.strictEqual(status.config.github.configured, true);
  assert.strictEqual(status.config.media.pexelsConfigured, true);
  assert.deepStrictEqual(status.access, {
    allowed: false,
    mode: 'none',
    contextRevision: 0,
    platformMedia: false,
    platformSync: false,
  });

  const login = service.createGoogleLoginRequest();
  assert.strictEqual(login.ok, true);
  assert.ok(login.url.includes('accounts.google.com'));
  assert.ok(login.url.includes('client_id=google-client-id'));
  assert.ok(login.url.includes(encodeURIComponent(login.redirectUri)));

  const completed = await service.exchangeGoogleCode({ code: 'oauth-code', state: login.state });
  assert.strictEqual(completed.ok, true);
  assert.strictEqual(completed.session.user.email, 'owner@example.com');
  assert.deepStrictEqual(principalChanges[0], {
    previous: null,
    next: { kind: 'account', actorId: 'usr_google' },
    reason: 'signed_in',
  });
  assert.strictEqual(service.getStatus().access.allowed, true);
  assert.strictEqual(service.getStatus().access.mode, 'account');
  assert.strictEqual(service.getStatus().access.contextRevision, 1);
  assert.strictEqual(service.getStatus().access.platformMedia, true);
  assert.strictEqual(Object.isFrozen(principalChanges[0]), true);
  assert.strictEqual(upsertedProfiles[0].provider, 'google');
  assert.strictEqual(savedSessions.length, 1);
  assert.strictEqual(savedSessions[0].sessionId, hashSessionToken(completed.session.id, 'session-secret'));
  assert.notStrictEqual(savedSessions[0].sessionId, completed.session.id);
  assert.ok(!String(savedSessions[0].sessionId).startsWith('protected:'));
  assert.strictEqual(fetchCalls.length, 2);

  const githubLogin = service.createGithubLoginRequest();
  assert.strictEqual(githubLogin.ok, true);
  assert.ok(githubLogin.url.includes('github.com/login/oauth/authorize'));
  assert.ok(githubLogin.url.includes('client_id=github-client-id'));
  assert.ok(githubLogin.url.includes(encodeURIComponent(githubLogin.redirectUri)));

  const githubCompleted = await service.exchangeGithubCode({ code: 'oauth-code', state: githubLogin.state });
  assert.strictEqual(githubCompleted.ok, true);
  assert.strictEqual(githubCompleted.session.user.email, 'githubowner@example.com');
  assert.strictEqual(upsertedProfiles[1].provider, 'github');
  assert.strictEqual(savedSessions.length, 2);
  assert.strictEqual(fetchCalls.length, 5);

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

  const degradedService = createPlatformAccountService({
    databaseUrl: 'postgresql://faber.local/db',
    beforeProductAccessContextChange: () => Object.freeze({ ok: true }),
    isProductAccessAuthorityReady: () => true,
    loadSessionFile: async () => ({
      id: 'local-session',
      createdAt: '2026-07-10T12:00:00.000Z',
      user: {
        id: 'usr_local',
        email: 'local@example.com',
        name: 'Local User',
      },
    }),
    sessionSecret: 'session-secret',
    store: {
      getStatus: () => ({ available: true, reason: 'ready' }),
      saveSession: async () => {
        throw new Error('self signed certificate in certificate chain');
      },
    },
  });
  const degradedRestore = await degradedService.initializeSession();
  assert.strictEqual(degradedRestore.ok, false);
  assert.strictEqual(degradedRestore.restored, true);
  assert.strictEqual(degradedRestore.reason, 'session_record_sync_failed');
  assert.strictEqual(degradedService.getStatus().signedIn, true);

  const signOutPromise = service.signOut();
  assert.strictEqual(principalChanges.at(-1).reason, 'signed_out');
  assert.strictEqual(principalChanges.at(-1).next, null);
  const signedOut = await signOutPromise;
  assert.strictEqual(signedOut.ok, true);
  assert.strictEqual(service.getStatus().signedIn, false);
  assert.strictEqual(service.getStatus().access.allowed, false);

  let rotatingSequence = 0;
  const transitionSnapshots = [];
  let transitionService = null;
  transitionService = createPlatformAccountService({
    allowLocalUnauthenticated: true,
    beforeProductAccessContextChange: (event) => {
      transitionSnapshots.push({
        event,
        sessionBeforeChange: transitionService.getCurrentSession(),
      });
      return Object.freeze({ ok: true });
    },
    createLocalPrincipalId: () => `local-development:rotation-${++rotatingSequence}`,
    isProductAccessAuthorityReady: () => true,
    loadSessionFile: async () => ({
      id: 'restored-session',
      createdAt: '2026-07-10T12:00:00.000Z',
      user: { id: 'usr_restored', email: 'restored@example.com', name: 'Restored' },
    }),
  });
  const firstLocalPrincipal = transitionService.getProductAccessPrincipal();
  assert.strictEqual(firstLocalPrincipal.actorId, 'local-development:rotation-1');
  assert.strictEqual((await transitionService.initializeSession()).ok, true);
  assert.strictEqual(transitionSnapshots[0].sessionBeforeChange, null);
  assert.strictEqual(transitionService.getProductAccessPrincipal().actorId, 'usr_restored');
  assert.strictEqual(transitionService.getStatus().access.contextRevision, 2);
  await transitionService.signOut();
  const secondLocalPrincipal = transitionService.getProductAccessPrincipal();
  assert.strictEqual(secondLocalPrincipal.kind, 'local_development');
  assert.strictEqual(secondLocalPrincipal.actorId, 'local-development:rotation-2');
  assert.notStrictEqual(secondLocalPrincipal.actorId, firstLocalPrincipal.actorId);
  assert.strictEqual(transitionService.getStatus().access.contextRevision, 3);

  const asynchronousTransition = createPlatformAccountService({
    allowLocalUnauthenticated: true,
    beforeProductAccessContextChange: async () => Object.freeze({ ok: true }),
    createLocalPrincipalId: () => 'local-development:async-denied',
    isProductAccessAuthorityReady: () => true,
    loadSessionFile: async () => ({
      id: 'forbidden-session',
      user: { id: 'usr_forbidden', email: 'forbidden@example.com' },
    }),
  });
  await assert.rejects(
    asynchronousTransition.initializeSession(),
    /product_access_context_change_rejected/,
  );
  assert.strictEqual(asynchronousTransition.getProductAccessPrincipal(), null);
  assert.strictEqual(asynchronousTransition.getStatus().access.allowed, false);

  const unreadyLocal = createPlatformAccountService({
    allowLocalUnauthenticated: true,
    createLocalPrincipalId: () => 'local-development:not-ready',
    isProductAccessAuthorityReady: () => false,
  });
  assert.strictEqual(unreadyLocal.getStatus().config.localUnauthenticated, true);
  assert.strictEqual(unreadyLocal.getStatus().access.allowed, false);
  assert.strictEqual(unreadyLocal.getProductAccessPrincipal(), null);

  console.log('platform-account-service.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
