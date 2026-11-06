export async function requestJson<T>(path: string, auth: string, options: RequestInit = {}): Promise<T> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  let result: Response;
  try {
    result = await fetch(path, {
      ...options, signal, cache: 'no-store',
      headers: { 'x-telegram-init-data': auth, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    });
  } catch {
    throw new Error(options.method && options.method !== 'GET'
      ? 'Нет ответа сервера. Откройте «Мои брони» или повторите действие: повторный запрос безопасен.'
      : 'Не удалось загрузить данные. Проверьте соединение и нажмите «Обновить».');
  }
  const payload = await result.json().catch(() => null) as (T & { error?: string }) | null;
  if (!result.ok || !payload) throw new Error(payload?.error || 'Сервер временно недоступен. Попробуйте обновить данные.');
  return payload;
}
