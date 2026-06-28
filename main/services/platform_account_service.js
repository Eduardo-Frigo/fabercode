const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';
const PASSWORD_HASH_PREFIX = 'scrypt:v1';

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function maskSecretTail(value = '', visibleTail = 4) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= visibleTail) return '*'.repeat(text.length);
  return `${'*'.repeat(Math.max(0, text.length - visibleTail))}${text.slice(-visibleTail)}`;
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
    githubScopes = 'read:user user:email repo',
    now = () => new Date(),
    pexelsApiKey = '',
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
  let currentSession = null;

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
      media: {
        pexelsConfigured: Boolean(String(pexelsApiKey || '').trim()),
        pexelsKeyMasked: maskSecretTail(pexelsApiKey),
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

  function getStatus() {
    const config = getConfigStatus();
    return {
      ok: true,
      signedIn: Boolean(currentSession && currentSession.user),
      user: currentSession && currentSession.user ? { ...currentSession.user } : null,
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
    currentSession = session;
    if (typeof saveSessionFile === 'function') {
      await saveSessionFile(session);
    }
    if (store && typeof store.saveSession === 'function') {
      await store.saveSession({
        sessionId: protectSecret(session.id),
        userId: sanitized.id,
        createdAt: session.createdAt,
      });
    }
    return getCurrentSession();
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
    const pending = pendingGoogleStates.get(String(state || '').trim());
    if (!pending) return { ok: false, message: 'Estado do login Google invalido ou expirado.' };
    pendingGoogleStates.delete(state);

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
    const pending = pendingGithubStates.get(String(state || '').trim());
    if (!pending) return { ok: false, message: 'Estado do login GitHub invalido ou expirado.' };
    pendingGithubStates.delete(state);

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
    const code = String(Math.floor(100000 + Math.random() * 900000));
    pendingEmailCodes.set(normalized, {
      code: protectSecret(code),
      createdAt: Date.now(),
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
    const expected = unprotectSecret(pending.code);
    if (String(code || '').trim() !== expected) return { ok: false, message: 'Codigo de email invalido.' };
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

    const identity = await store.getPasswordIdentityByEmail(normalized);
    if (!identity || !identity.passwordHash) {
      return { ok: false, message: 'Conta nao encontrada. Crie uma conta para continuar.' };
    }
    const validPassword = await verifyPassword(password, identity.passwordHash);
    if (!validPassword) return { ok: false, message: 'Email ou senha invalidos.' };

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
    currentSession = null;
    if (typeof saveSessionFile === 'function') {
      await saveSessionFile(null);
    }
    if (session && store && typeof store.revokeSession === 'function') {
      await store.revokeSession(protectSecret(session.id));
    }
    return { ok: true };
  }

  async function initializeSession() {
    if (typeof loadSessionFile === 'function') {
      const loaded = await loadSessionFile();
      if (loaded) {
        currentSession = loaded;
      }
    }
  }

  function getPlatformPexelsApiKey() {
    return String(pexelsApiKey || '').trim();
  }

  return {
    completeEmailLogin,
    createGithubLoginRequest,
    createGoogleLoginRequest,
    exchangeGithubCode,
    exchangeGoogleCode,
    getCurrentSession,
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
  hashPassword,
  maskSecretTail,
  normalizeEmail,
  normalizeLanguagePreference,
  normalizeThemePreference,
  sanitizeUserProfile,
  verifyPassword,
};
