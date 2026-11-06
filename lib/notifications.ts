import type { PoolClient } from 'pg';
import { db } from './db';
import { sendTelegramMessage } from './telegram';

export async function enqueueMessage(client: PoolClient, key: string, chatId: number, message: string): Promise<void> {
  await client.query(
    'INSERT INTO telegram_notifications (event_key, chat_id, message) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [key, chatId, message],
  );
}

export async function enqueueAdministrators(client: PoolClient, key: string, message: string): Promise<void> {
  const ids = new Set((process.env.ADMIN_TELEGRAM_IDS || '').split(',').map((id) => id.trim()).filter((id) => /^[1-9]\d*$/.test(id)));
  for (const id of ids) {
    if (Number.isSafeInteger(Number(id))) await enqueueMessage(client, key, Number(id), message);
  }
}

// Request-driven durable outbox: no worker or additional service. A failed send remains visible
// to administrators. Telegram provides no sendMessage idempotency key; crash retries can duplicate.
export async function flushNotifications(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      "SELECT id,chat_id,message FROM telegram_notifications WHERE delivered_at IS NULL " +
      "AND next_attempt_at <= now() ORDER BY id LIMIT 3 FOR UPDATE SKIP LOCKED",
    );
    await Promise.all(result.rows.map(async (row) => {
      const sent = await sendTelegramMessage(Number(row.chat_id), row.message);
      await client.query(
        "UPDATE telegram_notifications SET attempts=attempts+1, delivered_at=CASE WHEN $2 THEN now() ELSE NULL END, " +
        "next_attempt_at=now()+interval '1 minute' WHERE id=$1", [row.id, sent],
      );
    }));
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Notification dispatch failed; pending messages retained');
  } finally { client.release(); }
}

export async function tryFlushNotifications(): Promise<void> {
  try { await flushNotifications(); } catch { console.error('Notification connection failed; pending messages retained'); }
}
