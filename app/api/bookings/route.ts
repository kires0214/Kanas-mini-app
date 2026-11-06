import { authenticated, ApiError, dateValue, positiveId, readObject, timeValue } from '@/lib/api';
import { db, expireHolds } from '@/lib/db';
import { notifyAdministrators } from '@/lib/telegram';

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    const result = await db.query(
      "SELECT b.id, b.field_id, f.title AS field_title, b.price_kzt, b.status, " +
      "to_char(b.starts_at AT TIME ZONE 'Asia/Almaty', 'YYYY-MM-DD') AS date, " +
      "to_char(b.starts_at AT TIME ZONE 'Asia/Almaty', 'HH24:MI') AS time, " +
      "b.hold_expires_at FROM bookings b JOIN football_fields f ON f.id=b.field_id " +
      "WHERE b.telegram_id=$1 ORDER BY b.starts_at DESC LIMIT 100", [user.id],
    );
    const now = Date.now();
    return Response.json({ bookings: result.rows.map((row) => ({
      ...row,
      status: row.status === 'held' && new Date(row.hold_expires_at).getTime() <= now
        ? 'expired' : row.status,
    })) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    const input = await readObject(request);
    const fieldId = positiveId(input.field_id);
    const day = dateValue(input.date);
    const time = timeValue(input.time);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [user.id]);
      await expireHolds(client);
      const customerName = user.first_name.slice(0, 256);
      await client.query(
        'INSERT INTO customers (telegram_id, first_name, username) VALUES ($1,$2,$3) ' +
        'ON CONFLICT (telegram_id) DO UPDATE SET first_name=EXCLUDED.first_name, username=EXCLUDED.username',
        [user.id, customerName, user.username || null],
      );
      const count = await client.query(
        "SELECT count(*)::int AS count FROM bookings WHERE telegram_id=$1 AND status IN ('held','review')",
        [user.id],
      );
      if (count.rows[0].count >= 5) throw new ApiError(429, 'Слишком много ожидающих бронирований');

      const inserted = await client.query(
        "INSERT INTO bookings (field_id, telegram_id, starts_at, ends_at, price_kzt, hold_expires_at) " +
        "SELECT f.id, $2, ($3::date + $4::time) AT TIME ZONE 'Asia/Almaty', " +
        "(($3::date + $4::time) AT TIME ZONE 'Asia/Almaty') + interval '1 hour', " +
        "f.price_kzt, now() + interval '20 minutes' FROM football_fields f " +
        "WHERE f.id=$1 AND f.active=true AND $4::time >= f.opens_at " +
        "AND ($4::time + interval '1 hour') <= f.closes_at " +
        "AND mod(extract(epoch from ($4::time - f.opens_at))::int, 3600) = 0 " +
        "AND (($3::date + $4::time) AT TIME ZONE 'Asia/Almaty') > now() + interval '5 minutes' " +
        "AND $3::date BETWEEN (now() AT TIME ZONE 'Asia/Almaty')::date " +
        "AND (now() AT TIME ZONE 'Asia/Almaty')::date + 30 " +
        "RETURNING id, field_id, price_kzt, hold_expires_at", [fieldId, user.id, day, time],
      );
      if (!inserted.rowCount) throw new ApiError(409, 'Этот час недоступен для бронирования');

      await client.query('COMMIT');
      const booking = inserted.rows[0];
      void notifyAdministrators('Kanas: новая бронь #' + String(booking.id).slice(0, 8) +
        '\nПоле: ' + fieldId + '\nДата: ' + day + ' ' + time + '\nСумма: ' + booking.price_kzt +
        ' ₸\nОжидает оплаты.');
      return Response.json({ booking }, { status: 201 });
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error &&
          error.code === '23P01') {
        throw new ApiError(409, 'Поле уже забронировано на это время');
      }
      throw error;
    } finally {
      client.release();
    }
  });
}
