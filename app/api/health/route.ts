import { db } from '@/lib/db';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const schema = await db.query("SELECT 1 FROM schema_migrations WHERE name='002_payment_safety.sql'");
    if (!schema.rowCount) return Response.json({ status: 'unavailable' }, { status: 503 });
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
