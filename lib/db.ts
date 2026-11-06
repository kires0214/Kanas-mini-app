import { Pool, type PoolClient } from 'pg';

const globalPool = globalThis as unknown as { kanasPool?: Pool };
export const db = globalPool.kanasPool || new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});
if (process.env.NODE_ENV !== 'production') globalPool.kanasPool = db;

export async function expireHolds(client: PoolClient): Promise<void> {
  await client.query("UPDATE bookings SET status = 'expired' WHERE status = 'held' AND hold_expires_at <= now()");
}
