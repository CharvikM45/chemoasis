// Postgres connection and a tiny migration runner: every .sql file in migrations/ runs once, in order.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function createPool(env = process.env) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. On Railway, add it as a reference to your Postgres service; locally, put it in .env.');
  }
  return new Pool({
    connectionString: env.DATABASE_URL,
    // Railway's private network doesn't use SSL; its public proxy (handy for local development) can.
    ssl: env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: Number(env.PG_POOL_MAX || 10)
  });
}

async function migrate(db, dir = path.join(__dirname, 'migrations')) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    run_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Ran migration ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { createPool, migrate };
