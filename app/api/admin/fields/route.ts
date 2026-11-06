import { authenticated, ApiError, positiveId, readObject, requireAdmin, timeValue } from '@/lib/api';
import { db } from '@/lib/db';

function fieldInput(data: Record<string, unknown>): {
  title: string; description: string; price: number; opens: string; closes: string; active: boolean;
} {
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const price = Number(data.price_kzt);
  const opens = timeValue(data.opens_at);
  const closes = timeValue(data.closes_at);
  if (title.length < 2 || title.length > 80 || description.length > 500 ||
      !Number.isSafeInteger(price) || price < 1 || price > 10000000 || opens >= closes ||
      typeof data.active !== 'boolean') {
    throw new ApiError(400, 'Проверьте название, цену и график поля');
  }
  return { title, description, price, opens, closes, active: data.active };
}

export async function GET(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    requireAdmin(user);
    const result = await db.query(
      "SELECT id, title, description, price_kzt, " +
      "to_char(opens_at, 'HH24:MI') AS opens_at, " +
      "to_char(closes_at, 'HH24:MI') AS closes_at, active " +
      "FROM football_fields ORDER BY id",
    );
    return Response.json({ fields: result.rows });
  });
}

export async function POST(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    requireAdmin(user);
    const data = fieldInput(await readObject(request));
    const result = await db.query(
      'INSERT INTO football_fields (title, description, price_kzt, opens_at, closes_at, active) ' +
      'VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [data.title, data.description, data.price, data.opens, data.closes, data.active],
    );
    return Response.json({ field: result.rows[0] }, { status: 201 });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return authenticated(request, async (user) => {
    requireAdmin(user);
    const raw = await readObject(request);
    const id = positiveId(raw.id);
    const data = fieldInput(raw);
    const result = await db.query(
      'UPDATE football_fields SET title=$2, description=$3, price_kzt=$4, ' +
      'opens_at=$5, closes_at=$6, active=$7 WHERE id=$1 RETURNING id',
      [id, data.title, data.description, data.price, data.opens, data.closes, data.active],
    );
    if (!result.rowCount) throw new ApiError(404, 'Поле не найдено');
    return Response.json({ field: result.rows[0] });
  });
}
