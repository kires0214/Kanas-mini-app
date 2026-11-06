import { authenticated, ApiError, uuidValue } from '@/lib/api';
import { db } from '@/lib/db';
import { enqueueAdministrators, tryFlushNotifications } from '@/lib/notifications';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx): Promise<Response> {
  return authenticated(request, async (user) => {
    const id = uuidValue((await context.params).id);
    const client = await db.connect();
    let status: string;
    let issue: boolean;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        "SELECT *,hold_expires_at<=clock_timestamp() AS expired FROM bookings WHERE id=$1 AND telegram_id=$2 FOR UPDATE", [id, user.id],
      );
      if (!result.rowCount) throw new ApiError(404, 'Бронь не найдена');
      const booking = result.rows[0];
      status = booking.status;
      issue = booking.payment_issue_open;
      if (status === 'held' || (status === 'expired' && !booking.customer_marked_paid_at)) {
        issue = status === 'expired' || booking.expired;
        status = issue ? 'expired' : 'review';
        await client.query(
          'UPDATE bookings SET status=$2,payment_issue_open=$3,customer_marked_paid_at=coalesce(customer_marked_paid_at,now()) WHERE id=$1',
          [id, status, issue],
        );
        await enqueueAdministrators(client, 'paid:' + id, 'Kanas: ' + (issue ? 'СПОРНЫЙ ПОЗДНИЙ ПЛАТЁЖ' : 'ПРОВЕРИТЬ ОПЛАТУ') +
          '\nБронь #' + id.slice(0, 8) + '\nПоле: ' + booking.field_id + '\nСумма: ' + booking.price_kzt +
          ' ₸\nTelegram клиента: ' + user.id + '\nОтметка клиента не является доказательством оплаты.' +
          (issue ? '\nУдержание истекло. Проверьте деньги и согласуйте возврат или другое время; слот не гарантирован.' : ''));
      } else if (status !== 'expired' && !['review','disputed','confirmed'].includes(status)) {
        throw new ApiError(409, 'По этой оплате уже принято решение. Проверьте комментарий администратора.');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    await tryFlushNotifications();
    return Response.json({ status, payment_issue_open: issue });
  });
}
