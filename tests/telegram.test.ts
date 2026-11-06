import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TelegramAuthError, verifyTelegramInitData } from '../lib/telegram';

const token = '123456789:testing-telegram-bot-token';
const now = 1800000000;

function signedInitData(
  user: unknown = { id: 1234567890, first_name: 'Test', username: 'tester' },
  date: number = now,
): string {
  const params = new URLSearchParams({
    auth_date: String(date),
    query_id: 'sample',
    user: JSON.stringify(user),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + value).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

test('accepts authentic fresh Telegram user data', () => {
  const user = verifyTelegramInitData(signedInitData(), token, now);
  assert.equal(user.id, 1234567890);
  assert.equal(user.first_name, 'Test');
});

test('rejects changed signed user data', () => {
  const altered = signedInitData().replace('tester', 'imposter');
  assert.throws(() => verifyTelegramInitData(altered, token, now), TelegramAuthError);
});

test('rejects expired signed data', () => {
  assert.throws(() => verifyTelegramInitData(signedInitData(undefined, now - 90000), token, now), TelegramAuthError);
});

test('rejects signed invalid user id', () => {
  assert.throws(() => verifyTelegramInitData(signedInitData({ id: -1, first_name: 'Invalid' }), token, now), TelegramAuthError);
});

test('rejects duplicate fields, future data, missing token, oversized data and malformed signature', () => {
  assert.throws(() => verifyTelegramInitData(signedInitData()+'&auth_date='+now,token,now), TelegramAuthError);
  assert.throws(() => verifyTelegramInitData(signedInitData(undefined,now+61),token,now), TelegramAuthError);
  assert.throws(() => verifyTelegramInitData(signedInitData(),'',now), TelegramAuthError);
  assert.throws(() => verifyTelegramInitData('a'.repeat(8193),token,now), TelegramAuthError);
  assert.throws(() => verifyTelegramInitData('hash=nope',token,now), TelegramAuthError);
});
