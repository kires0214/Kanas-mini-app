import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'kanas-migrate' });
try {
  await client.connect();
  await client.query("SET lock_timeout='30s'");
  await client.query('SELECT pg_advisory_lock(180119, 1)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = fileURLToPath(new URL('../db/', import.meta.url));
  for (const name of (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(new URL('../db/' + name, import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log('Applied', name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  // Closing the session also releases the migration advisory lock on failure.
  await client.end();
}
