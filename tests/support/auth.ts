import { createHmac } from 'node:crypto';

export const testToken = '123456789:test-only-not-a-real-telegram-bot-token';
export const testAdmin = 900001;
export function signedData(id = 100001, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now()/1000)), user: JSON.stringify({ id, first_name: 'QA fixture' }), ...extra });
  const check = [...params.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => k + '=' + v).join('\n');
  const key = createHmac('sha256','WebAppData').update(testToken).digest();
  params.set('hash',createHmac('sha256',key).update(check).digest('hex'));
  return params.toString();
}
