/**
 * PostgreSQL connection pool
 *
 * Reads DATABASE_URL from environment. Supports:
 *   - Direct Supabase connection
 *   - Supabase connection pooler (recommended — IPv4, faster)
 *   - Any PostgreSQL-compatible database
 *
 * Set DATABASE_URL in .env:
 *   DATABASE_URL=postgresql://postgres.{ref}:[password]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
 */

import pg from 'pg';
const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL environment variable is not set');

    _pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on('error', err => {
      console.error('[pg] pool error:', err.message);
    });
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/** Check if DATABASE_URL is configured (does not verify connectivity) */
export function isDatabaseConfigured(): boolean {
  return !!process.env['DATABASE_URL'];
}
