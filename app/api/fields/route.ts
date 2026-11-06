import { authenticated } from '@/lib/api';
import { db } from '@/lib/db';

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async () => {
    const result = await db.query(
      "SELECT id, title, description, price_kzt, left(opens_at::text,5) AS opens_at, left(closes_at::text,5) AS closes_at FROM football_fields WHERE active = true ORDER BY id",
    );
    return Response.json({ fields: result.rows });
  });
}
