import { authenticated, requireAdmin } from '@/lib/api';
import { db, expireHolds } from '@/lib/db';

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    requireAdmin(user);
    const client = await db.connect();
    try {
      await expireHolds(client);
      const result = await client.query(
        "SELECT b.id,b.field_id,f.title AS field_title,c.first_name,c.username,b.telegram_id,b.price_kzt,b.status, " +
        "b.hold_expires_at,b.customer_marked_paid_at,b.decision_note,b.payment_issue_open, " +
        "(b.status IN ('review','disputed') AND b.customer_marked_paid_at<now()-interval '24 hours') AS overdue, " +
        "to_char(b.starts_at AT TIME ZONE 'Asia/Almaty','YYYY-MM-DD') AS date, " +
        "to_char(b.starts_at AT TIME ZONE 'Asia/Almaty','HH24:MI') AS time " +
        "FROM bookings b JOIN football_fields f ON f.id=b.field_id JOIN customers c ON c.telegram_id=b.telegram_id " +
        "WHERE b.status IN ('review','disputed') OR b.payment_issue_open OR " +
        "(b.status IN ('held','confirmed') AND b.starts_at>now()-interval '1 day') " +
        "ORDER BY (b.status IN ('review','disputed') OR b.payment_issue_open) DESC,b.customer_marked_paid_at NULLS LAST,b.starts_at",
      );
      const delivery = await client.query(
        'SELECT count(*)::int AS pending,count(*) FILTER (WHERE attempts>0)::int AS failed FROM telegram_notifications WHERE delivered_at IS NULL',
      );
      return Response.json({ bookings: result.rows, notifications: delivery.rows[0] });
    } finally { client.release(); }
  });
}
