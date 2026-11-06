import { Pool, type PoolClient } from 'pg';

const globalPool = globalThis as unknown as { kanasPool?: Pool };
export const db = globalPool.kanasPool || new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  statement_timeout: 10000,
  application_name: 'kanas-mini-app',
});
db.on('error', () => console.error('PostgreSQL idle connection failed'));
if (process.env.NODE_ENV !== 'production') globalPool.kanasPool = db;

export async function expireHolds(client: PoolClient): Promise<void> {
  await client.query(
    "WITH due AS (SELECT id FROM bookings WHERE status='held' AND hold_expires_at <= clock_timestamp() " +
    "ORDER BY id FOR UPDATE SKIP LOCKED) UPDATE bookings b SET status='expired' FROM due WHERE b.id=due.id",
  );
}
