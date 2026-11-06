import { TelegramAuthError, isAdministrator, verifyTelegramInitData, type TelegramUser } from './telegram';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function jsonError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof TelegramAuthError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  // Database/network messages may contain connection strings or signed request data.
  console.error('API request failed', error instanceof Error ? error.name : 'Unknown error');
  return Response.json({ error: 'Ошибка сервера. Попробуйте позже.' }, { status: 500 });
}

export async function authenticated(
  request: Request,
  callback: (user: TelegramUser) => Promise<Response>,
): Promise<Response> {
  try {
    const user = verifyTelegramInitData(
      request.headers.get('x-telegram-init-data') || '',
      process.env.TELEGRAM_BOT_TOKEN || '',
    );
    const response = await callback(user);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const response = jsonError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export function requireAdmin(user: TelegramUser): void {
  if (!isAdministrator(user.id)) throw new ApiError(403, 'Доступ только для администратора');
}

export async function readObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError(400, 'Некорректные данные запроса');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Ожидается объект');
  }
  return value as Record<string, unknown>;
}

export function positiveId(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !/^[1-9]\d*$/.test(value))) {
    throw new ApiError(400, 'Неверный идентификатор');
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num <= 0) throw new ApiError(400, 'Неверный идентификатор');
  return num;
}

export function uuidValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    throw new ApiError(400, 'Неверный идентификатор запроса или брони');
  }
  return value.toLowerCase();
}

export function dateValue(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, 'Неверная дата');
  }
  return value;
}

export function timeValue(value: unknown): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ApiError(400, 'Неверное время');
  }
  return value;
}

export function paymentUrl(): string | null {
  const raw = process.env.KASPI_PAYMENT_URL;
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}
