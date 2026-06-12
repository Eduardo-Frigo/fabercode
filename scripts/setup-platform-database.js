#!/usr/bin/env node

const path = require('path');

const { createPostgresUserStore } = require('../main/services/postgres_user_store');

function maskConnectionString(value = '') {
  try {
    const url = new URL(value);
    const user = url.username ? `${url.username.slice(0, 18)}${url.username.length > 18 ? '...' : ''}` : '<missing>';
    const password = url.password ? '***' : '<missing>';
    return `${url.protocol}//${user}:${password}@${url.hostname}:${url.port}${url.pathname}`;
  } catch {
    return '<invalid connection string>';
  }
}

function loadEnvironment() {
  const envPath = path.resolve(process.cwd(), '.env');
  require('dotenv').config({ path: envPath });
  const databaseUrl = process.env.FABER_DATABASE_URL || process.env.DATABASE_URL || '';
  const ssl = process.env.FABER_POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : null;
  return { databaseUrl, envPath, ssl };
}

async function listPlatformTables({ databaseUrl, ssl }) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: databaseUrl, ssl, max: 1 });
  try {
    const tableNames = ['faber_users', 'faber_auth_identities', 'faber_sessions'];
    const tables = await pool.query(
      `
        SELECT
          table_name,
          c.relrowsecurity AS rls_enabled,
          COALESCE(p.policy_count, 0)::int AS policy_count,
          COALESCE(p.policy_names, '') AS policy_names
        FROM information_schema.tables t
        JOIN pg_class c ON c.relname = t.table_name
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
        LEFT JOIN (
          SELECT
            schemaname,
            tablename,
            COUNT(*) AS policy_count,
            STRING_AGG(policyname, ', ' ORDER BY policyname) AS policy_names
          FROM pg_policies
          GROUP BY schemaname, tablename
        ) p ON p.schemaname = t.table_schema AND p.tablename = t.table_name
        WHERE t.table_schema = $1
          AND t.table_name = ANY($2::text[])
        ORDER BY table_name
      `,
      ['public', tableNames]
    );
    const columns = await pool.query(
      'SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = ANY($2::text[]) ORDER BY table_name, ordinal_position',
      ['public', tableNames]
    );
    return {
      tables: tables.rows.map((row) => ({
        name: row.table_name,
        rlsEnabled: Boolean(row.rls_enabled),
        policyCount: Number(row.policy_count || 0),
        policyNames: String(row.policy_names || '').split(', ').filter(Boolean),
      })),
      columns: columns.rows,
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const { databaseUrl, envPath, ssl } = loadEnvironment();
  if (!databaseUrl.trim()) {
    throw new Error(`DATABASE_URL ou FABER_DATABASE_URL ausente em ${envPath}`);
  }

  const store = createPostgresUserStore({ databaseUrl, ssl });
  try {
    const status = store.getStatus();
    if (!status.available) throw new Error(`Postgres indisponivel: ${status.reason}`);

    await store.ensureSchema();
    const schema = await listPlatformTables({ databaseUrl, ssl });

    console.log('Faber platform database ready.');
    console.log(`Connection: ${maskConnectionString(databaseUrl)}`);
    console.log(`Tables: ${schema.tables.map((table) => table.name).join(', ')}`);
    for (const table of schema.tables) {
      console.log(
        `- ${table.name}: RLS ${table.rlsEnabled ? 'enabled' : 'disabled'}, policies=${table.policyCount}${table.policyNames.length ? ` (${table.policyNames.join(', ')})` : ''}`
      );
    }
    for (const row of schema.columns) {
      console.log(`- ${row.table_name}.${row.column_name} (${row.data_type}, nullable=${row.is_nullable})`);
    }
  } finally {
    await store.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  listPlatformTables,
  loadEnvironment,
  maskConnectionString,
};
