import { createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramUser = {
  id: number;
  first_name: string;
  username?: string;
  last_name?: string;
};

export class TelegramAuthError extends Error {}

export function verifyTelegramInitData(
  initData: string,
  token: string,
  currentTimeSeconds: number = Math.floor(Date.now() / 1000),
): TelegramUser {
  if (!initData || !token || initData.length > 8192) {
    throw new TelegramAuthError('Нет данных авторизации Telegram');
  }

  const params = new URLSearchParams(initData);
  const providedHashes = params.getAll('hash');
  if (providedHashes.length !== 1 || !/^[a-f0-9]{64}$/i.test(providedHashes[0])) {
    throw new TelegramAuthError('Недействительная подпись Telegram');
  }

  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const dataCheckString = [...params.entries()]
    .filter(([name]) => name !== 'hash')
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, value]) => name + '=' + value)
    .join('\n');
  const expectedHash = createHmac('sha256', key).update(dataCheckString).digest();
  const actualHash = Buffer.from(providedHashes[0], 'hex');
  if (actualHash.length !== expectedHash.length ||
      !timingSafeEqual(actualHash, expectedHash)) {
    throw new TelegramAuthError('Недействительная подпись Telegram');
  }

  const rawAuthDate = params.get('auth_date');
  const authDate = Number(rawAuthDate);
  if (!rawAuthDate || !Number.isSafeInteger(authDate) ||
      authDate > currentTimeSeconds + 60 ||
      currentTimeSeconds - authDate > 24 * 60 * 60) {
    throw new TelegramAuthError('Данные Telegram устарели, откройте приложение заново');
  }

  try {
    const rawUser = params.get('user');
    const user = rawUser ? JSON.parse(rawUser) as Partial<TelegramUser> : null;
    if (!user || !Number.isSafeInteger(user.id) || Number(user.id) <= 0 ||
        typeof user.first_name !== 'string' || user.first_name.length > 256 ||
        (user.username !== undefined && typeof user.username !== 'string')) {
      throw new Error('Invalid user');
    }
    return user as TelegramUser;
  } catch {
    throw new TelegramAuthError('Нет корректного пользователя Telegram');
  }
}

export function isAdministrator(telegramId: number): boolean {
  return (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => value === String(telegramId));
}

export async function sendTelegramMessage(chatId: number, message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.warn('Telegram delivery failed:', response.status);
  } catch {
    console.warn('Telegram delivery failed: connection error');
  }
}

export async function notifyAdministrators(message: string): Promise<void> {
  const ids = (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',').map((item) => item.trim()).filter((item) => /^\d+$/.test(item));
  await Promise.all(ids.map((id) => sendTelegramMessage(Number(id), message)));
}
