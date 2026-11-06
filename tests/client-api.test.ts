import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../lib/client-api';

test('network and non-JSON errors remain readable and mutations are never automatically repeated', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new TypeError('offline'); };
    await assert.rejects(requestJson('/api/bookings','signed',{method:'POST'}), /повторный запрос безопасен/);
    assert.equal(calls,1);
    globalThis.fetch = async () => new Response('<h1>Bad Gateway</h1>',{status:502});
    await assert.rejects(requestJson('/api/me','signed'), /временно недоступен/);
    globalThis.fetch = async (_url,options) => {
      assert.equal(options?.cache,'no-store');
      assert.equal((options?.headers as Record<string,string>)['x-telegram-init-data'],'signed');
      return Response.json({ok:true});
    };
    assert.deepEqual(await requestJson('/api/me','signed'),{ok:true});
  } finally { globalThis.fetch = original; }
});
