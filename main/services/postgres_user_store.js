const crypto = require('crypto');

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function buildUserId(email = '') {
  const normalized = normalizeEmail(email);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return `usr_${hash}`;
}

function mapUserRow(row = {}) {
  return {
    id: String(row.id || '').trim(),
    email: normalizeEmail(row.email),
    name: String(row.name || row.email || 'Faber user').trim(),
    avatarUrl: String(row.avatar_url || row.avatarUrl || '').trim(),
    themePreference: String(row.theme_preference || row.themePreference || '').trim(),
    languagePreference: String(row.language_preference || row.languagePreference || '').trim(),
  };
}

function loadPgModule() {
  try {
    return require('pg');
  } catch {
    return null;
  }
}

function createPostgresUserStore(dependencies = {}) {
  const {
    databaseUrl = '',
    now = () => new Date(),
    pgModule = null,
    poolFactory = null,
    ssl = null,
  } = dependencies;

  let pool = null;
  let driverLoadAttempted = false;
  let driver = pgModule || null;

  function getDriver() {
    if (driver) return driver;
    if (!driverLoadAttempted) {
      driverLoadAttempted = true;
      driver = loadPgModule();
    }
    return driver;
  }

  function getStatus() {
    const configured = Boolean(String(databaseUrl || '').trim());
    const availableDriver = Boolean(poolFactory || getDriver());
    return {
      configured,
      driverAvailable: availableDriver,
      available: configured && availableDriver,
      reason: !configured ? 'database_url_missing' : availableDriver ? 'ready' : 'pg_driver_missing',
    };
  }

  function getPool() {
    const status = getStatus();
    if (!status.available) return null;
    if (!pool) {
      if (typeof poolFactory === 'function') {
        pool = poolFactory({ connectionString: databaseUrl, ssl });
      } else {
        const pg = getDriver();
        pool = new pg.Pool({ connectionString: databaseUrl, ssl });
      }
    }
    return pool;
  }

  async function query(sql, params = []) {
    const targetPool = getPool();
    if (!targetPool || typeof targetPool.query !== 'function') {
      throw new Error('Postgres indisponivel para usuarios.');
    }
    return targetPool.query(sql, params);
  }

  async function ensureSchema() {
    await query(`
      CREATE TABLE IF NOT EXISTS faber_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        theme_preference TEXT NOT NULL DEFAULT '',
        language_preference TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query("ALTER TABLE faber_users ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT ''");
    await query("ALTER TABLE faber_users ADD COLUMN IF NOT EXISTS language_preference TEXT NOT NULL DEFAULT ''");
    await query(`
      CREATE TABLE IF NOT EXISTS faber_auth_identities (
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES faber_users(id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (provider, provider_user_id)
      )
    `);
    await query("ALTER TABLE faber_auth_identities ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT ''");
    await query(`
      CREATE TABLE IF NOT EXISTS faber_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES faber_users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )
    `);
    await query('ALTER TABLE faber_users ENABLE ROW LEVEL SECURITY');
    await query('ALTER TABLE faber_auth_identities ENABLE ROW LEVEL SECURITY');
    await query('ALTER TABLE faber_sessions ENABLE ROW LEVEL SECURITY');
    await ensureBackendOnlyPolicy('faber_users');
    await ensureBackendOnlyPolicy('faber_auth_identities');
    await ensureBackendOnlyPolicy('faber_sessions');
    return { ok: true };
  }

  async function ensureBackendOnlyPolicy(tableName = '') {
    const normalizedTable = String(tableName || '').trim();
    if (!['faber_users', 'faber_auth_identities', 'faber_sessions'].includes(normalizedTable)) {
      throw new Error('Tabela de conta desconhecida para policy RLS.');
    }
    await query(`DROP POLICY IF EXISTS faber_backend_only_access ON ${normalizedTable}`);
    await query(`
      CREATE POLICY faber_backend_only_access
      ON ${normalizedTable}
      FOR ALL
      USING (false)
      WITH CHECK (false)
    `);
    await query(`
      COMMENT ON POLICY faber_backend_only_access ON ${normalizedTable}
      IS 'Faber Code backend-only table. Public Supabase API access is intentionally denied.'
    `);
  }

  async function upsertUserIdentity(profile = {}) {
    await ensureSchema();
    const email = normalizeEmail(profile.email);
    if (!email) throw new Error('Email obrigatorio para registrar usuario.');
    const provider = String(profile.provider || 'email').trim().toLowerCase();
    const providerUserId = String(profile.providerUserId || profile.id || email).trim();
    const userId = String(profile.id || '').startsWith('usr_') ? profile.id : buildUserId(email);
    const name = String(profile.name || email).trim();
    const avatarUrl = String(profile.avatarUrl || '').trim();
    const themePreference = String(profile.themePreference || '').trim();
    const languagePreference = String(profile.languagePreference || '').trim();

    const userResult = await query(
      `
        INSERT INTO faber_users (id, email, name, avatar_url, theme_preference, language_preference, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (email)
        DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name, ''), faber_users.name),
          avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), faber_users.avatar_url),
          theme_preference = COALESCE(NULLIF(EXCLUDED.theme_preference, ''), faber_users.theme_preference),
          language_preference = COALESCE(NULLIF(EXCLUDED.language_preference, ''), faber_users.language_preference),
          updated_at = EXCLUDED.updated_at
        RETURNING id, email, name, avatar_url, theme_preference, language_preference
      `,
      [userId, email, name, avatarUrl, themePreference, languagePreference, now().toISOString()]
    );
    const user = mapUserRow(userResult && userResult.rows && userResult.rows[0] ? userResult.rows[0] : {
      id: userId,
      email,
      name,
      avatar_url: avatarUrl,
      theme_preference: themePreference,
      language_preference: languagePreference,
    });

    await query(
      `
        INSERT INTO faber_auth_identities (provider, provider_user_id, user_id, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (provider, provider_user_id)
        DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = EXCLUDED.updated_at
      `,
      [provider, providerUserId, user.id, now().toISOString()]
    );

    return {
      ...user,
      provider,
      providerUserId,
    };
  }

  async function getPasswordIdentityByEmail(email = '') {
    await ensureSchema();
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const result = await query(
      `
        SELECT
          u.id,
          u.email,
          u.name,
          u.avatar_url,
          u.theme_preference,
          u.language_preference,
          i.password_hash
        FROM faber_users u
        INNER JOIN faber_auth_identities i ON i.user_id = u.id
        WHERE LOWER(u.email) = $1
          AND i.provider = 'password'
          AND i.provider_user_id = $1
        LIMIT 1
      `,
      [normalized]
    );
    const row = result && result.rows && result.rows[0] ? result.rows[0] : null;
    if (!row) return null;
    return {
      user: mapUserRow(row),
      passwordHash: String(row.password_hash || '').trim(),
      provider: 'password',
      providerUserId: normalized,
    };
  }

  async function createPasswordUser(profile = {}) {
    await ensureSchema();
    const email = normalizeEmail(profile.email);
    if (!email) throw new Error('Email obrigatorio para registrar usuario.');
    const userId = buildUserId(email);
    const name = String(profile.name || email).trim();
    const passwordHash = String(profile.passwordHash || '').trim();
    const themePreference = String(profile.themePreference || '').trim();
    const languagePreference = String(profile.languagePreference || '').trim();
    if (!passwordHash) throw new Error('Hash de senha obrigatorio para registrar usuario.');

    const userResult = await query(
      `
        INSERT INTO faber_users (id, email, name, avatar_url, theme_preference, language_preference, updated_at)
        VALUES ($1, $2, $3, '', $4, $5, $6)
        ON CONFLICT (email)
        DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name, ''), faber_users.name),
          theme_preference = COALESCE(NULLIF(EXCLUDED.theme_preference, ''), faber_users.theme_preference),
          language_preference = COALESCE(NULLIF(EXCLUDED.language_preference, ''), faber_users.language_preference),
          updated_at = EXCLUDED.updated_at
        RETURNING id, email, name, avatar_url, theme_preference, language_preference
      `,
      [userId, email, name, themePreference, languagePreference, now().toISOString()]
    );
    const user = mapUserRow(userResult && userResult.rows && userResult.rows[0] ? userResult.rows[0] : {
      id: userId,
      email,
      name,
      avatar_url: '',
      theme_preference: themePreference,
      language_preference: languagePreference,
    });

    await query(
      `
        INSERT INTO faber_auth_identities (provider, provider_user_id, user_id, password_hash, updated_at)
        VALUES ('password', $1, $2, $3, $4)
        ON CONFLICT (provider, provider_user_id)
        DO UPDATE SET user_id = EXCLUDED.user_id, password_hash = EXCLUDED.password_hash, updated_at = EXCLUDED.updated_at
      `,
      [email, user.id, passwordHash, now().toISOString()]
    );

    return {
      ...user,
      provider: 'password',
      providerUserId: email,
    };
  }

  async function saveSession({ sessionId = '', userId = '', createdAt = '' } = {}) {
    await ensureSchema();
    await query(
      `
        INSERT INTO faber_sessions (id, user_id, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (id)
        DO UPDATE SET user_id = EXCLUDED.user_id, created_at = EXCLUDED.created_at, revoked_at = NULL
      `,
      [String(sessionId || '').trim(), String(userId || '').trim(), createdAt || now().toISOString()]
    );
    return { ok: true };
  }

  async function revokeSession(sessionId = '') {
    await query(
      'UPDATE faber_sessions SET revoked_at = $2 WHERE id = $1',
      [String(sessionId || '').trim(), now().toISOString()]
    );
    return { ok: true };
  }

  async function close() {
    if (pool && typeof pool.end === 'function') await pool.end();
    pool = null;
  }

  return {
    close,
    createPasswordUser,
    ensureSchema,
    getPasswordIdentityByEmail,
    getStatus,
    saveSession,
    upsertUserIdentity,
    revokeSession,
  };
}

module.exports = {
  buildUserId,
  createPostgresUserStore,
  mapUserRow,
};
