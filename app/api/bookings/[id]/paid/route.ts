import { authenticated, ApiError, paymentUrl } from '@/lib/api';
import { db } from '@/lib/db';
import { notifyAdministrators } from '@/lib/telegram';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx): Promise<Response> {
  return authenticated(request, async (user) => {
    if (!paymentUrl()) throw new ApiError(503, 'Оплата пока не настроена');
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new ApiError(400, 'Неверная бронь');
    const result = await db.query(
      "UPDATE bookings SET status='review', customer_marked_paid_at=now() " +
      "WHERE id=$1 AND telegram_id=$2 AND status='held' AND hold_expires_at>now() " +
      "RETURNING id, field_id, price_kzt, starts_at",
      [id, user.id],
    );
    if (!result.rowCount) throw new ApiError(409, 'Бронь уже обработана или истекла');
    const booking = result.rows[0];
    await notifyAdministrators(
      'Kanas: ПРОВЕРИТЬ ОПЛАТУ\nБронь #' + id.slice(0, 8) +
      '\nПоле: ' + booking.field_id +
      '\nСумма: ' + booking.price_kzt + ' ₸' +
      '\nКлиент: ' + user.first_name + ' (Telegram ' + user.id + ')' +
      '\nОтметка «Я оплатил» — не доказательство оплаты.',
    );
    return Response.json({ status: 'review' });
  });
}
