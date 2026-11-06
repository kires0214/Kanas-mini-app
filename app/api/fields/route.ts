import { authenticated } from '@/lib/api';
import { db } from '@/lib/db';

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async () => {
    const result = await db.query(
      "SELECT id, title, description, price_kzt, to_char(opens_at, 'HH24:MI') AS opens_at, to_char(closes_at, 'HH24:MI') AS closes_at FROM football_fields WHERE active = true ORDER BY id",
    );
    return Response.json({ fields: result.rows });
  });
}
