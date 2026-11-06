import { db } from '@/lib/db';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    await db.query('SELECT 1 FROM football_fields LIMIT 0');
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
