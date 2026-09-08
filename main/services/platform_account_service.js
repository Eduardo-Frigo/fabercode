const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';
const PASSWORD_HASH_PREFIX = 'scrypt:v1';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const PASSWORD_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_FAILURE_LIMIT = 8;
const PRODUCT_ACCESS_ACTOR_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,256}$/;

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function createProductAccessPrincipal(kind = '', actorId = '') {
  const normalizedKind = kind === 'account' || kind === 'local_development' ? kind : '';
  const normalizedActorId = String(actorId || '').trim();
  if (!normalizedKind || !PRODUCT_ACCESS_ACTOR_ID_PATTERN.test(normalizedActorId)) return null;
  return Object.freeze({
    kind: normalizedKind,
    actorId: normalizedActorId,
  });
}

function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parseScopes(value = '') {
  const scopes = String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const required = ['openid', 'email', 'profile'];
  return Array.from(new Set([...required, ...scopes])).join(' ');
}

function parseGithubScopes(value = '') {
  const scopes = String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const required = ['read:user', 'user:email'];
  return Array.from(new Set([...required, ...scopes])).join(' ');
}

function createRandomToken(size = 24) {
  return crypto.randomBytes(size).toString('base64url');
}

function createEmailCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashSessionToken(sessionToken = '', sessionSecret = '') {
  const token = String(sessionToken || '').trim();
  const secret = String(sessionSecret || '').trim();
  if (!token || !secret) return '';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function isValidEmail(value = '') {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmail(value));
}

function normalizeThemePreference(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'light' || normalized === 'claro') return 'light';
  if (normalized === 'dark' || normalized === 'escuro') return 'dark';
  return '';
}

function normalizeLanguagePreference(value = '') {
  const normalized = String(value || '').trim();
  if (normalized === 'pt-BR' || normalized.toLowerCase().startsWith('pt')) return 'pt-BR';
  if (normalized === 'en-US' || normalized.toLowerCase().startsWith('en')) return 'en-US';
  if (normalized === 'es-ES' || normalized.toLowerCase().startsWith('es')) return 'es-ES';
  return '';
}

function derivePasswordKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ''), String(salt || ''), 64, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password = '') {
  const salt = createRandomToken(18);
  const key = await derivePasswordKey(password, salt);
  return `${PASSWORD_HASH_PREFIX}:${salt}:${key.toString('base64url')}`;
}

async function verifyPassword(password = '', storedHash = '') {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}` !== PASSWORD_HASH_PREFIX) return false;
  const salt = parts[2];
  const expected = Buffer.from(parts[3], 'base64url');
  if (!expected.length) return false;
  const actual = await derivePasswordKey(password, salt);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function sanitizeUserProfile(profile = {}) {
  const email = normalizeEmail(profile.email);
  return {
    id: String(profile.id || profile.sub || '').trim(),
    email,
    name: String(profile.name || profile.given_name || email || 'Faber user').trim(),
    avatarUrl: String(profile.avatarUrl || profile.picture || '').trim(),
    provider: String(profile.provider || '').trim(),
    providerUserId: String(profile.providerUserId || profile.sub || profile.id || '').trim(),
    themePreference: normalizeThemePreference(profile.themePreference || profile.theme_preference || ''),
    languagePreference: normalizeLanguagePreference(profile.languagePreference || profile.language_preference || ''),
  };
}

function createPlatformAccountService(dependencies = {}) {
  const {
    allowDevEmailCodes = false,
    allowLocalUnauthenticated = false,
    appBaseUrl = 'http://127.0.0.1:37418',
    databaseUrl = '',
    fetchFn = typeof fetch === 'function' ? fetch : null,
    googleClientId = '',
    googleClientSecret = '',
    googleRedirectUri = '',
    googleScopes = 'openid email profile',
    githubClientId = '',
    githubClientSecret = '',
    githubRedirectUri = '',
    githubScopes = 'read:user user:email',
    now = () => new Date(),
    pexelsApiKey = '',
    platformMediaEndpoint = '',
    beforeProductAccessContextChange = () => Object.freeze({ ok: false }),
    createLocalPrincipalId = () => '',
    isProductAccessAuthorityReady = () => false,
    protectSecret = (value) => String(value || ''),
    saveSessionFile = null,
    loadSessionFile = null,
    sessionSecret = '',
    store = null,
    unprotectSecret = (value) => String(value || ''),
  } = dependencies;

  const pendingGoogleStates = new Map();
  const pendingGithubStates = new Map();
  const pendingEmailCodes = new Map();
  const passwordFailures = new Map();
  let currentSession = null;
  let productAccessContextRevision = 0;
  let productAccessTransitionHealthy = true;

  function mintLocalUnauthenticatedPrincipal() {
    if (!allowLocalUnauthenticated || typeof createLocalPrincipalId !== 'function') return null;
    try {
      const actorId = createLocalPrincipalId();
      if (actorId && typeof actorId.then === 'function') return null;
      return createProductAccessPrincipal('local_development', actorId);
    } catch {
      return null;
    }
  }

  let localUnauthenticatedPrincipal = mintLocalUnauthenticatedPrincipal();
  if (localUnauthenticatedPrincipal) productAccessContextRevision = 1;

  function resolveRawProductAccessPrincipal(session = null, localPrincipal = localUnauthenticatedPrincipal) {
    if (session && session.user) {
      const actorId = session.user.id || session.user.email || '';
      return createProductAccessPrincipal('account', actorId);
    }
    return localPrincipal;
  }

  function productAccessPrincipalsMatch(left, right) {
    if (!left || !right) return left === right;
    return left.kind === right.kind && left.actorId === right.actorId;
  }

  function productAccessAuthorityIsReady() {
    if (!productAccessTransitionHealthy || typeof isProductAccessAuthorityReady !== 'function') {
      return false;
    }
    try {
      const result = isProductAccessAuthorityReady();
      return result === true;
    } catch {
      return false;
    }
  }

  function successfulContextChangeResult(value) {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || (value && typeof value.then === 'function')) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, 'ok');
      return Boolean(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === true);
    } catch {
      return false;
    }
  }

  function transitionCurrentSession(nextSession = null, reason = 'principal_changed') {
    const normalizedSession = nextSession && typeof nextSession === 'object' ? nextSession : null;
    const previous = resolveRawProductAccessPrincipal(currentSession);
    let candidateLocalPrincipal = localUnauthenticatedPrincipal;
    if (currentSession && currentSession.user && !normalizedSession && allowLocalUnauthenticated) {
      candidateLocalPrincipal = mintLocalUnauthenticatedPrincipal();
    }
    const next = resolveRawProductAccessPrincipal(normalizedSession, candidateLocalPrincipal);
    const sessionChanged = normalizedSession !== currentSession;
    if (sessionChanged || !productAccessPrincipalsMatch(previous, next)) {
      productAccessTransitionHealthy = false;
      let result = null;
      try {
        result = beforeProductAccessContextChange(Object.freeze({ previous, next, reason }));
      } catch {
        result = null;
      }
      if (!successfulContextChangeResult(result)) {
        throw new Error('product_access_context_change_rejected');
      }
      localUnauthenticatedPrincipal = candidateLocalPrincipal;
      currentSession = normalizedSession;
      productAccessContextRevision += 1;
      productAccessTransitionHealthy = true;
      return;
    }
    currentSession = normalizedSession;
  }

  function isExpired(timestamp, ttlMs) {
    return Date.now() - Number(timestamp || 0) > ttlMs;
  }

  function consumePendingState(map, state = '') {
    const key = String(state || '').trim();
    const pending = map.get(key);
    if (!pending) return null;
    map.delete(key);
    if (isExpired(pending.createdAt, OAUTH_STATE_TTL_MS)) return null;
    return pending;
  }

  function getPasswordFailureState(email = '') {
    const key = normalizeEmail(email);
    const record = passwordFailures.get(key);
    if (!record || isExpired(record.firstAt, PASSWORD_FAILURE_WINDOW_MS)) {
      const fresh = { count: 0, firstAt: Date.now() };
      passwordFailures.set(key, fresh);
      return fresh;
    }
    return record;
  }

  function assertPasswordAttemptsAllowed(email = '') {
    const record = getPasswordFailureState(email);
    if (record.count >= PASSWORD_FAILURE_LIMIT) {
      return { ok: false, message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' };
    }
    return { ok: true };
  }

  function recordPasswordFailure(email = '') {
    const record = getPasswordFailureState(email);
    record.count += 1;
  }

  function clearPasswordFailures(email = '') {
    passwordFailures.delete(normalizeEmail(email));
  }

  function getConfigStatus() {
    const missing = [];
    if (!String(databaseUrl || '').trim()) missing.push('DATABASE_URL');
    if (!String(sessionSecret || '').trim()) missing.push('FABER_SESSION_SECRET');

    const googleMissing = [];
    if (!String(googleClientId || '').trim()) googleMissing.push('GOOGLE_CLIENT_ID');
    if (!String(googleClientSecret || '').trim()) googleMissing.push('GOOGLE_CLIENT_SECRET');

    const githubMissing = [];
    if (!String(githubClientId || '').trim()) githubMissing.push('GITHUB_CLIENT_ID');
    if (!String(githubClientSecret || '').trim()) githubMissing.push('GITHUB_CLIENT_SECRET');

    const platformMediaConfigured = Boolean(
      String(platformMediaEndpoint || '').trim() || String(pexelsApiKey || '').trim()
    );

    return {
      enabled: missing.length === 0,
      missing,
      database: {
        configured: Boolean(String(databaseUrl || '').trim()),
        available: store && typeof store.getStatus === 'function' ? store.getStatus().available : false,
        reason: store && typeof store.getStatus === 'function' ? store.getStatus().reason : 'store_not_configured',
      },
      google: {
        configured: googleMissing.length === 0,
        missing: googleMissing,
        redirectUri: getGoogleRedirectUri(),
      },
      github: {
        configured: githubMissing.length === 0,
        missing: githubMissing,
        redirectUri: getGithubRedirectUri(),
      },
      email: {
        configured: true,
        mode: 'password',
      },
      localUnauthenticated: Boolean(localUnauthenticatedPrincipal),
      media: {
        pexelsConfigured: platformMediaConfigured,
        mode: String(platformMediaEndpoint || '').trim() ? 'endpoint' : String(pexelsApiKey || '').trim() ? 'local-key' : 'none',
      },
    };
  }

  function getGoogleRedirectUri() {
    const explicit = String(googleRedirectUri || '').trim();
    if (explicit) return explicit;
    return `${normalizeUrl(appBaseUrl) || 'http://127.0.0.1:37418'}/auth/google/callback`;
  }

  function getGithubRedirectUri() {
    const explicit = String(githubRedirectUri || '').trim();
    if (explicit) return explicit;
    return `${normalizeUrl(appBaseUrl) || 'http://127.0.0.1:37418'}/auth/github/callback`;
  }

  function getCurrentSession() {
    return currentSession ? { ...currentSession, user: { ...currentSession.user } } : null;
  }

  function getProductAccessPrincipal() {
    const principal = resolveRawProductAccessPrincipal(currentSession);
    return principal && productAccessAuthorityIsReady() ? principal : null;
  }

  function getStatus() {
    const config = getConfigStatus();
    const principal = getProductAccessPrincipal();
    const signedIn = Boolean(currentSession && currentSession.user);
    const authenticatedAccess = Boolean(principal && principal.kind === 'account' && signedIn);
    const databaseAvailable = Boolean(
      config.database && config.database.configured && config.database.available
    );
    return {
      ok: true,
      signedIn,
      user: currentSession && currentSession.user ? { ...currentSession.user } : null,
      access: {
        allowed: Boolean(principal),
        mode: principal ? principal.kind : 'none',
        contextRevision: productAccessContextRevision,
        platformMedia: Boolean(authenticatedAccess && config.media.pexelsConfigured),
        platformSync: Boolean(authenticatedAccess && databaseAvailable),
      },
      config,
    };
  }

  function assertStoreReady(requiredMethod = 'upsertUserIdentity') {
    if (!store || (requiredMethod && typeof store[requiredMethod] !== 'function')) {
      return { ok: false, message: 'Banco de usuarios nao configurado.' };
    }
    const status = typeof store.getStatus === 'function' ? store.getStatus() : { available: true };
    if (!status.available) {
      return { ok: false, message: status.reason || 'Banco de usuarios indisponivel.' };
    }
    return { ok: true };
  }

  async function ensureUser(profile = {}) {
    const ready = assertStoreReady();
    if (!ready.ok) return ready;
    const userProfile = sanitizeUserProfile(profile);
    if (!userProfile.email) return { ok: false, message: 'Email do usuario nao informado.' };
    const user = await store.upsertUserIdentity(userProfile);
    return { ok: true, user: sanitizeUserProfile(user || userProfile) };
  }

  async function createSessionForUser(user = {}, provider = '') {
    const sanitized = sanitizeUserProfile({ ...user, provider: provider || user.provider });
    const session = {
      id: createRandomToken(18),
      user: sanitized,
      createdAt: now().toISOString(),
    };
    transitionCurrentSession(session, 'signed_in');
    if (typeof saveSessionFile === 'function') {
      await saveSessionFile(session);
    }
    await saveSessionRecord(session);
    return getCurrentSession();
  }

  async function saveSessionRecord(session = null) {
    if (!session || !store || typeof store.saveSession !== 'function') return;
    const sessionId = hashSessionToken(session.id, sessionSecret);
    const userId = session.user && session.user.id ? String(session.user.id).trim() : '';
    if (!sessionId || !userId) return;
    await store.saveSession({
      sessionId,
      userId,
      createdAt: session.createdAt,
    });
  }

  function createGoogleLoginRequest() {
    const config = getConfigStatus();
    if (!config.google.configured) {
      return {
        ok: false,
        message: `Google OAuth incompleto: ${config.google.missing.join(', ')}`,
        missing: config.google.missing,
      };
    }

    const state = createRandomToken(18);
    const redirectUri = getGoogleRedirectUri();
    pendingGoogleStates.set(state, { createdAt: Date.now(), redirectUri });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', String(googleClientId).trim());
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', parseScopes(googleScopes));
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('access_type', 'offline');

    return { ok: true, url: url.toString(), state, redirectUri };
  }

  async function exchangeGoogleCode({ code = '', state = '' } = {}) {
    const pending = consumePendingState(pendingGoogleStates, state);
    if (!pending) return { ok: false, message: 'Estado do login Google invalido ou expirado.' };

    if (!String(code || '').trim()) return { ok: false, message: 'Codigo Google nao informado.' };
    if (typeof fetchFn !== 'function') return { ok: false, message: 'Fetch indisponivel para concluir OAuth.' };

    const tokenResponse = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code).trim(),
        client_id: String(googleClientId).trim(),
        client_secret: String(googleClientSecret).trim(),
        redirect_uri: pending.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenResponse || !tokenResponse.ok) {
      return { ok: false, message: 'Google recusou a troca do codigo OAuth.' };
    }
    const tokenPayload = await tokenResponse.json();
    const accessToken = String(tokenPayload.access_token || '').trim();
    if (!accessToken) return { ok: false, message: 'Google nao retornou access token.' };

    const userResponse = await fetchFn(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse || !userResponse.ok) {
      return { ok: false, message: 'Nao foi possivel ler o perfil Google.' };
    }
    const googleProfile = await userResponse.json();
    const ensured = await ensureUser({
      provider: 'google',
      providerUserId: googleProfile.sub,
      id: googleProfile.sub,
      email: googleProfile.email,
      name: googleProfile.name,
      avatarUrl: googleProfile.picture,
    });
    if (!ensured.ok) return ensured;
    const session = await createSessionForUser(ensured.user, 'google');
    return { ok: true, session };
  }

  function createGithubLoginRequest() {
    const config = getConfigStatus();
    const redirectUri = getGithubRedirectUri();
    if (!config.github.configured) {
      const missing = config.github.missing.slice();
      return {
        ok: false,
        message: `GitHub OAuth ainda nao configurado. Falta preencher ${missing.join(', ')} no .env. Callback: ${redirectUri}`,
        missing,
        setup: {
          redirectUri,
          homepageUrl: normalizeUrl(appBaseUrl) || 'http://127.0.0.1:37418',
          scopes: parseGithubScopes(githubScopes),
        },
      };
    }

    const state = createRandomToken(18);
    pendingGithubStates.set(state, { createdAt: Date.now(), redirectUri });

    const url = new URL(GITHUB_AUTH_URL);
    url.searchParams.set('client_id', String(githubClientId).trim());
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', parseGithubScopes(githubScopes));
    url.searchParams.set('state', state);
    url.searchParams.set('allow_signup', 'true');

    return { ok: true, url: url.toString(), state, redirectUri };
  }

  async function resolveGithubPrimaryEmail(accessToken = '', fallbackEmail = '') {
    const fallback = normalizeEmail(fallbackEmail);
    if (fallback) return fallback;
    if (typeof fetchFn !== 'function') return '';

    const response = await fetchFn(GITHUB_EMAILS_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'FaberCode',
      },
    });
    if (!response || !response.ok) return '';
    const emails = await response.json();
    if (!Array.isArray(emails)) return '';
    const primary = emails.find((entry) => entry && entry.primary && entry.verified && entry.email)
      || emails.find((entry) => entry && entry.verified && entry.email)
      || emails.find((entry) => entry && entry.email);
    return normalizeEmail(primary && primary.email ? primary.email : '');
  }

  async function exchangeGithubCode({ code = '', state = '' } = {}) {
    const pending = consumePendingState(pendingGithubStates, state);
    if (!pending) return { ok: false, message: 'Estado do login GitHub invalido ou expirado.' };

    if (!String(code || '').trim()) return { ok: false, message: 'Codigo GitHub nao informado.' };
    if (typeof fetchFn !== 'function') return { ok: false, message: 'Fetch indisponivel para concluir OAuth.' };

    const tokenResponse = await fetchFn(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'FaberCode',
      },
      body: new URLSearchParams({
        code: String(code).trim(),
        client_id: String(githubClientId).trim(),
        client_secret: String(githubClientSecret).trim(),
        redirect_uri: pending.redirectUri,
      }).toString(),
    });
    if (!tokenResponse || !tokenResponse.ok) {
      return { ok: false, message: 'GitHub recusou a troca do codigo OAuth.' };
    }
    const tokenPayload = await tokenResponse.json();
    const accessToken = String(tokenPayload.access_token || '').trim();
    if (!accessToken) return { ok: false, message: 'GitHub nao retornou access token.' };

    const userResponse = await fetchFn(GITHUB_USER_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'FaberCode',
      },
    });
    if (!userResponse || !userResponse.ok) {
      return { ok: false, message: 'Nao foi possivel ler o perfil GitHub.' };
    }
    const githubProfile = await userResponse.json();
    const email = await resolveGithubPrimaryEmail(accessToken, githubProfile.email);
    if (!email) return { ok: false, message: 'GitHub nao retornou um e-mail para criar a conta.' };
    const login = String(githubProfile.login || '').trim();
    const ensured = await ensureUser({
      provider: 'github',
      providerUserId: githubProfile.id,
      id: githubProfile.id,
      email,
      name: githubProfile.name || login || email,
      avatarUrl: githubProfile.avatar_url,
    });
    if (!ensured.ok) return ensured;
    const session = await createSessionForUser(ensured.user, 'github');
    return { ok: true, session };
  }

  function startEmailLogin({ email = '' } = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      return { ok: false, message: 'Email invalido.' };
    }
    const code = createEmailCode();
    pendingEmailCodes.set(normalized, {
      code: protectSecret(code),
      createdAt: Date.now(),
      attempts: 0,
    });
    return {
      ok: true,
      email: normalized,
      delivery: 'manual_or_email_provider_pending',
      devCode: allowDevEmailCodes ? code : undefined,
    };
  }

  async function completeEmailLogin({ email = '', code = '' } = {}) {
    const normalized = normalizeEmail(email);
    const pending = pendingEmailCodes.get(normalized);
    if (!pending) return { ok: false, message: 'Codigo de email expirado ou inexistente.' };
    if (isExpired(pending.createdAt, EMAIL_CODE_TTL_MS)) {
      pendingEmailCodes.delete(normalized);
      return { ok: false, message: 'Codigo de email expirado ou inexistente.' };
    }
    if (pending.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      pendingEmailCodes.delete(normalized);
      return { ok: false, message: 'Muitas tentativas de codigo. Solicite um novo codigo.' };
    }
    const expected = unprotectSecret(pending.code);
    if (String(code || '').trim() !== expected) {
      pending.attempts += 1;
      return { ok: false, message: 'Codigo de email invalido.' };
    }
    pendingEmailCodes.delete(normalized);

    const ensured = await ensureUser({
      provider: 'email',
      providerUserId: normalized,
      id: normalized,
      email: normalized,
      name: normalized,
    });
    if (!ensured.ok) return ensured;
    const session = await createSessionForUser(ensured.user, 'email');
    return { ok: true, session };
  }

  async function signInWithPassword({ email = '', password = '' } = {}) {
    const ready = assertStoreReady('getPasswordIdentityByEmail');
    if (!ready.ok) return ready;
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return { ok: false, message: 'Email invalido.' };
    if (!String(password || '').trim()) return { ok: false, message: 'Senha obrigatoria.' };
    const attemptsAllowed = assertPasswordAttemptsAllowed(normalized);
    if (!attemptsAllowed.ok) return attemptsAllowed;

    const identity = await store.getPasswordIdentityByEmail(normalized);
    if (!identity || !identity.passwordHash) {
      recordPasswordFailure(normalized);
      return { ok: false, message: 'Conta nao encontrada. Crie uma conta para continuar.' };
    }
    const validPassword = await verifyPassword(password, identity.passwordHash);
    if (!validPassword) {
      recordPasswordFailure(normalized);
      return { ok: false, message: 'Email ou senha invalidos.' };
    }
    clearPasswordFailures(normalized);

    const session = await createSessionForUser({
      ...(identity.user || {}),
      provider: 'password',
      providerUserId: normalized,
    }, 'password');
    return { ok: true, session };
  }

  async function signUpWithPassword({
    name = '',
    email = '',
    password = '',
    themePreference = '',
    languagePreference = '',
  } = {}) {
    const ready = assertStoreReady('createPasswordUser');
    if (!ready.ok) return ready;
    const normalized = normalizeEmail(email);
    const trimmedName = String(name || '').trim();
    const trimmedPassword = String(password || '');
    if (trimmedName.length < 2) return { ok: false, message: 'Informe seu nome completo.' };
    if (!isValidEmail(normalized)) return { ok: false, message: 'Email invalido.' };
    if (trimmedPassword.length < 8) return { ok: false, message: 'Use uma senha com pelo menos 8 caracteres.' };

    if (store && typeof store.getPasswordIdentityByEmail === 'function') {
      const existing = await store.getPasswordIdentityByEmail(normalized);
      if (existing && existing.passwordHash) {
        return { ok: false, message: 'Conta ja existe. Faca login com e-mail.' };
      }
    }

    const passwordHash = await hashPassword(trimmedPassword);
    const user = await store.createPasswordUser({
      name: trimmedName,
      email: normalized,
      passwordHash,
      themePreference: normalizeThemePreference(themePreference) || 'dark',
      languagePreference: normalizeLanguagePreference(languagePreference) || 'pt-BR',
    });
    const session = await createSessionForUser(user, 'password');
    return { ok: true, session };
  }

  async function signOut() {
    const session = currentSession;
    transitionCurrentSession(null, 'signed_out');
    if (typeof saveSessionFile === 'function') {
      await saveSessionFile(null);
    }
    if (session && store && typeof store.revokeSession === 'function') {
      const sessionId = hashSessionToken(session.id, sessionSecret);
      if (sessionId) await store.revokeSession(sessionId);
    }
    return { ok: true };
  }

  async function initializeSession() {
    if (typeof loadSessionFile !== 'function') return { ok: true, restored: false };
    const loaded = await loadSessionFile();
    if (!loaded) return { ok: true, restored: false };

    transitionCurrentSession(loaded, 'session_restored');
    try {
      await saveSessionRecord(currentSession);
      return { ok: true, restored: true };
    } catch (error) {
      return {
        ok: false,
        restored: true,
        reason: 'session_record_sync_failed',
        message: error && error.message ? error.message : String(error || ''),
      };
    }
  }

  function getPlatformPexelsApiKey() {
    if (!currentSession || !currentSession.user) return '';
    return String(pexelsApiKey || '').trim();
  }

  return {
    completeEmailLogin,
    createGithubLoginRequest,
    createGoogleLoginRequest,
    exchangeGithubCode,
    exchangeGoogleCode,
    getCurrentSession,
    getProductAccessPrincipal,
    getPlatformPexelsApiKey,
    getStatus,
    initializeSession,
    signInWithPassword,
    signUpWithPassword,
    startEmailLogin,
    signOut,
  };
}

module.exports = {
  GITHUB_AUTH_URL,
  GITHUB_EMAILS_URL,
  GITHUB_TOKEN_URL,
  GITHUB_USER_URL,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  createPlatformAccountService,
  hashSessionToken,
  hashPassword,
  normalizeEmail,
  normalizeLanguagePreference,
  normalizeThemePreference,
  sanitizeUserProfile,
  verifyPassword,
};
