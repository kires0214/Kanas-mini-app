import { authenticated, dateValue, positiveId } from '@/lib/api';
import { db, expireHolds } from '@/lib/db';

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async () => {
    const url = new URL(request.url);
    const fieldId = positiveId(url.searchParams.get('fieldId'));
    const day = dateValue(url.searchParams.get('date'));

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expireHolds(client);
      const result = await client.query(
        "SELECT to_char(slot_time, 'HH24:MI') AS time, " +
        "((slot_time AT TIME ZONE 'Asia/Almaty') > now() + interval '5 minutes' " +
        "AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.field_id = f.id " +
        "AND (b.status IN ('review', 'disputed', 'confirmed') OR (b.status='held' AND b.hold_expires_at>clock_timestamp())) " +
        "AND tstzrange(b.starts_at, b.ends_at, '[)') && " +
        "tstzrange(slot_time AT TIME ZONE 'Asia/Almaty', " +
        "(slot_time AT TIME ZONE 'Asia/Almaty') + interval '1 hour', '[)'))) AS available " +
        "FROM football_fields f CROSS JOIN LATERAL " +
        "generate_series($2::date + f.opens_at, ($2::date + f.closes_at) - interval '1 hour', interval '1 hour') AS slot_time " +
        "WHERE f.id = $1 AND f.active = true " +
        "AND $2::date BETWEEN (now() AT TIME ZONE 'Asia/Almaty')::date " +
        "AND (now() AT TIME ZONE 'Asia/Almaty')::date + 30 ORDER BY slot_time",
        [fieldId, day],
      );
      await client.query('COMMIT');
      return Response.json({ slots: result.rows });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
