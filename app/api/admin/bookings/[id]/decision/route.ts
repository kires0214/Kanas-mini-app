import { authenticated, ApiError, readObject, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { sendTelegramMessage } from '@/lib/telegram';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx): Promise<Response> {
  return authenticated(request, async (user) => {
    requireAdmin(user);
    const input = await readObject(request);
    if (input.decision !== 'confirm' && input.decision !== 'reject') {
      throw new ApiError(400, 'Неверное решение');
    }
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new ApiError(400, 'Неверная бронь');
    const result = await db.query(
      "UPDATE bookings SET status=$2, decided_at=now(), decided_by=$3 " +
      "WHERE id=$1 AND status='review' " +
      "RETURNING telegram_id, id, price_kzt, starts_at, field_id",
      [id, input.decision === 'confirm' ? 'confirmed' : 'rejected', user.id],
    );
    if (!result.rowCount) throw new ApiError(409, 'Бронь не ожидает проверки');
    const booking = result.rows[0];
    await sendTelegramMessage(
      Number(booking.telegram_id),
      input.decision === 'confirm'
        ? 'Kanas: бронь #' + id.slice(0, 8) + ' подтверждена. До встречи на поле!'
        : 'Kanas: бронь #' + id.slice(0, 8) + ' не подтверждена. Свяжитесь с администратором.',
    );
    return Response.json({ status: input.decision === 'confirm' ? 'confirmed' : 'rejected' });
  });
}
