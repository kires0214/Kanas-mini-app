import { authenticated, ApiError, dateValue, paymentUrl, positiveId, readObject, timeValue, uuidValue } from '@/lib/api';
import { db, expireHolds } from '@/lib/db';

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    const client = await db.connect();
    try {
      await expireHolds(client);
      const result = await client.query(
        "SELECT b.id, b.field_id, f.title AS field_title, b.price_kzt, b.status, b.decision_note, b.payment_issue_open, " +
        "to_char(b.starts_at AT TIME ZONE 'Asia/Almaty', 'YYYY-MM-DD') AS date, " +
        "to_char(b.starts_at AT TIME ZONE 'Asia/Almaty', 'HH24:MI') AS time, b.hold_expires_at " +
        "FROM bookings b JOIN football_fields f ON f.id=b.field_id WHERE b.telegram_id=$1 " +
        "ORDER BY (b.status IN ('held','review','disputed') OR b.payment_issue_open) DESC, b.starts_at DESC LIMIT 100", [user.id],
      );
      return Response.json({ bookings: result.rows });
    } finally { client.release(); }
  });
}

export async function POST(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    const input = await readObject(request);
    const fieldId = positiveId(input.field_id);
    const day = dateValue(input.date);
    const time = timeValue(input.time);
    const requestId = uuidValue(input.request_id);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [user.id]);
      await expireHolds(client);
      const previous = await client.query(
        "SELECT id,field_id,price_kzt,hold_expires_at,status, " +
        "(field_id=$3 AND starts_at=(($4::date+$5::time) AT TIME ZONE 'Asia/Almaty')) AS same_request " +
        "FROM bookings WHERE telegram_id=$1 AND request_id=$2", [user.id, requestId, fieldId, day, time],
      );
      if (previous.rowCount) {
        const { same_request, ...booking } = previous.rows[0];
        if (!same_request) throw new ApiError(409, 'Идентификатор запроса уже использован для другой брони');
        await client.query('COMMIT');
        return Response.json({ booking, replayed: true });
      }
      if (!paymentUrl()) throw new ApiError(503, 'Бронирование временно недоступно: платёжная ссылка не настроена');
      // SHARE protects the selected price/hours against concurrent administrator edits.
      await client.query('SELECT id FROM football_fields WHERE id=$1 FOR SHARE', [fieldId]);
      await client.query(
        'INSERT INTO customers (telegram_id, first_name, username) VALUES ($1,$2,$3) ' +
        'ON CONFLICT (telegram_id) DO UPDATE SET first_name=EXCLUDED.first_name, username=EXCLUDED.username',
        [user.id, user.first_name, user.username || null],
      );
      const count = await client.query(
        "SELECT count(*)::int AS count FROM bookings WHERE telegram_id=$1 AND status IN ('held','review','disputed')", [user.id],
      );
      if (count.rows[0].count >= 5) throw new ApiError(429, 'Слишком много ожидающих бронирований');
      const inserted = await client.query(
        "INSERT INTO bookings (field_id,telegram_id,starts_at,ends_at,price_kzt,hold_expires_at,request_id) " +
        "SELECT f.id,$2,($3::date+$4::time) AT TIME ZONE 'Asia/Almaty', " +
        "(($3::date+$4::time) AT TIME ZONE 'Asia/Almaty')+interval '1 hour',f.price_kzt, " +
        "clock_timestamp()+interval '20 minutes',$5 FROM football_fields f " +
        "WHERE f.id=$1 AND f.active AND $4::time>=f.opens_at " +
        "AND ($3::date+$4::time+interval '1 hour')<=($3::date+f.closes_at) " +
        "AND mod(extract(epoch from ($4::time-f.opens_at))::int,3600)=0 " +
        "AND (($3::date+$4::time) AT TIME ZONE 'Asia/Almaty')>clock_timestamp()+interval '5 minutes' " +
        "AND $3::date BETWEEN (now() AT TIME ZONE 'Asia/Almaty')::date AND (now() AT TIME ZONE 'Asia/Almaty')::date+30 " +
        "RETURNING id,field_id,price_kzt,hold_expires_at,status", [fieldId, user.id, day, time, requestId],
      );
      if (!inserted.rowCount) throw new ApiError(409, 'Этот час недоступен для бронирования');
      await client.query('COMMIT');
      return Response.json({ booking: inserted.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23P01') {
        throw new ApiError(409, 'Поле уже забронировано на это время');
      }
      throw error;
    } finally { client.release(); }
  });
}
