import { authenticated, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    requireAdmin(user);
    const result = await db.query(
      "SELECT b.id, b.field_id, f.title AS field_title, c.first_name, c.username, " +
      "b.telegram_id, b.price_kzt, b.status, b.hold_expires_at, " +
      "to_char(b.starts_at AT TIME ZONE 'Asia/Almaty', 'YYYY-MM-DD') AS date, " +
      "to_char(b.starts_at AT TIME ZONE 'Asia/Almaty', 'HH24:MI') AS time " +
      "FROM bookings b JOIN football_fields f ON f.id=b.field_id " +
      "JOIN customers c ON c.telegram_id=b.telegram_id " +
      "WHERE b.status IN ('review','held','confirmed') AND b.starts_at > now() - interval '1 day' " +
      "ORDER BY CASE b.status WHEN 'review' THEN 0 WHEN 'held' THEN 1 ELSE 2 END, b.starts_at LIMIT 200",
    );
    return Response.json({ bookings: result.rows });
  });
}
