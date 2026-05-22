const assert = require('assert');

const {
  buildUserId,
  createPostgresUserStore,
} = require('../main/services/postgres_user_store');

async function run() {
  assert.ok(buildUserId('owner@example.com').startsWith('usr_'));

  const missing = createPostgresUserStore({ databaseUrl: '' });
  assert.strictEqual(missing.getStatus().available, false);
  assert.strictEqual(missing.getStatus().reason, 'database_url_missing');

  const queries = [];
  let savedPasswordHash = '';
  const store = createPostgresUserStore({
    databaseUrl: 'postgresql://faber.local/db',
    now: () => new Date('2026-05-18T12:00:00.000Z'),
    poolFactory: () => ({
      query: async (sql, params = []) => {
        queries.push({ sql: String(sql), params });
        if (String(sql).includes('SELECT') && String(sql).includes('i.password_hash')) {
          return {
            rows: savedPasswordHash ? [{
              id: buildUserId('owner@example.com'),
              email: 'owner@example.com',
              name: 'Owner Example',
              avatar_url: '',
              theme_preference: 'dark',
              language_preference: 'pt-BR',
              password_hash: savedPasswordHash,
            }] : [],
          };
        }
        if (String(sql).includes('INSERT INTO faber_auth_identities') && String(sql).includes('password_hash')) {
          savedPasswordHash = params[2];
          return { rows: [] };
        }
        if (String(sql).includes('RETURNING id, email, name, avatar_url')) {
          const isPasswordInsert = String(sql).includes("VALUES ($1, $2, $3, '', $4");
          return {
            rows: [
              {
                id: params[0],
                email: params[1],
                name: params[2],
                avatar_url: isPasswordInsert ? '' : params[3],
                theme_preference: isPasswordInsert ? params[3] : params[4],
                language_preference: isPasswordInsert ? params[4] : params[5],
              },
            ],
          };
        }
        return { rows: [] };
      },
      end: async () => {},
    }),
  });

  assert.strictEqual(store.getStatus().available, true);
  const user = await store.upsertUserIdentity({
    provider: 'google',
    providerUserId: 'google-1',
    email: 'Owner@Example.com',
    name: 'Owner Example',
    avatarUrl: 'https://example.test/avatar.png',
  });

  assert.strictEqual(user.email, 'owner@example.com');
  assert.strictEqual(user.provider, 'google');
  assert.ok(queries.some((entry) => entry.sql.includes('CREATE TABLE IF NOT EXISTS faber_users')));
  assert.ok(queries.some((entry) => entry.sql.includes('ALTER TABLE faber_users ENABLE ROW LEVEL SECURITY')));
  assert.ok(queries.some((entry) => entry.sql.includes('ALTER TABLE faber_auth_identities ENABLE ROW LEVEL SECURITY')));
  assert.ok(queries.some((entry) => entry.sql.includes('ALTER TABLE faber_sessions ENABLE ROW LEVEL SECURITY')));
  assert.ok(queries.some((entry) => entry.sql.includes('CREATE POLICY faber_backend_only_access')));
  assert.ok(queries.some((entry) => entry.sql.includes('Public Supabase API access is intentionally denied')));
  assert.ok(queries.some((entry) => entry.sql.includes('INSERT INTO faber_users')));
  assert.ok(queries.some((entry) => entry.sql.includes('INSERT INTO faber_auth_identities')));

  const passwordUser = await store.createPasswordUser({
    email: 'owner@example.com',
    name: 'Owner Example',
    passwordHash: 'hash-value',
    themePreference: 'dark',
    languagePreference: 'pt-BR',
  });
  assert.strictEqual(passwordUser.provider, 'password');
  const passwordIdentity = await store.getPasswordIdentityByEmail('Owner@Example.com');
  assert.strictEqual(passwordIdentity.user.email, 'owner@example.com');
  assert.strictEqual(passwordIdentity.passwordHash, 'hash-value');
  assert.ok(queries.some((entry) => entry.sql.includes('ALTER TABLE faber_users ADD COLUMN IF NOT EXISTS theme_preference')));
  assert.ok(queries.some((entry) => entry.sql.includes('ALTER TABLE faber_auth_identities ADD COLUMN IF NOT EXISTS password_hash')));

  await store.saveSession({
    sessionId: 'session-1',
    userId: user.id,
    createdAt: '2026-05-18T12:00:00.000Z',
  });
  await store.revokeSession('session-1');
  assert.ok(queries.some((entry) => entry.sql.includes('INSERT INTO faber_sessions')));
  assert.ok(queries.some((entry) => entry.sql.includes('UPDATE faber_sessions SET revoked_at')));

  console.log('postgres-user-store.test.js: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
