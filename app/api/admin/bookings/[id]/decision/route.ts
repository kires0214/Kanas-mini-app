import { authenticated, ApiError, readObject, requireAdmin, uuidValue } from '@/lib/api';
import { db } from '@/lib/db';
import { enqueueMessage, tryFlushNotifications } from '@/lib/notifications';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx): Promise<Response> {
  return authenticated(request, async (user) => {
    requireAdmin(user);
    const input = await readObject(request);
    const decision = input.decision;
    if (!['confirm','reject','dispute','resolve'].includes(String(decision))) throw new ApiError(400, 'Неверное решение');
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length > 500 || (decision !== 'confirm' && note.length < 5)) {
      throw new ApiError(400, 'Укажите причину и порядок решения вопроса (5–500 символов)');
    }
    if (decision === 'confirm' && input.payment_verified !== true) {
      throw new ApiError(400, 'Сначала подтвердите сверку поступления денег в Kaspi Pay');
    }
    const id = uuidValue((await context.params).id);
    const client = await db.connect();
    let status: string;
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [id]);
      if (!found.rowCount) throw new ApiError(404, 'Бронь не найдена');
      const booking = found.rows[0];
      status = decision === 'confirm' ? 'confirmed' : decision === 'reject' ? 'rejected' : decision === 'dispute' ? 'disputed' : 'expired';
      if (booking.status === status && booking.decision_note === note &&
          (decision !== 'resolve' || !booking.payment_issue_open)) {
        await client.query('COMMIT');
      } else {
        if (decision === 'resolve' ? !(booking.status === 'expired' && booking.payment_issue_open) :
          !['review','disputed'].includes(booking.status)) throw new ApiError(409, 'Бронь уже обработана или не ожидает проверки');
        await client.query(
          'UPDATE bookings SET status=$2,decision_note=$3,decided_at=now(),decided_by=$4,payment_issue_open=false WHERE id=$1',
          [id, status, note, user.id],
        );
        const audit = await client.query(
          'INSERT INTO booking_decisions (booking_id,telegram_id,decision,note) VALUES ($1,$2,$3,$4) RETURNING id', [id, user.id, decision, note],
        );
        const description = decision === 'confirm' ? 'подтверждена. До встречи на поле!' :
          decision === 'reject' ? 'отклонена.' : decision === 'dispute' ? 'на дополнительной проверке. Слот сохранён.' : 'по позднему платежу рассмотрена.';
        await enqueueMessage(client, 'decision:' + audit.rows[0].id, Number(booking.telegram_id),
          'Kanas: бронь #' + id.slice(0, 8) + ' ' + description + (note ? '\n' + note : ''));
        await client.query('COMMIT');
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    await tryFlushNotifications();
    return Response.json({ status });
  });
}
