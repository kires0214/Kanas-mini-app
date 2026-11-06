import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { db } from '../../lib/db';
import { signedData, testToken, testAdmin } from '../support/auth';
import * as bookings from '../../app/api/bookings/route';
import * as availability from '../../app/api/availability/route';
import * as fields from '../../app/api/fields/route';
import * as adminFields from '../../app/api/admin/fields/route';
import * as adminBookings from '../../app/api/admin/bookings/route';
import * as paid from '../../app/api/bookings/[id]/paid/route';
import * as decision from '../../app/api/admin/bookings/[id]/decision/route';
import { flushNotifications } from '../../lib/notifications';

// This suite deliberately resets data and refuses any database not explicitly named for tests.
const connection = process.env.DATABASE_URL;
if (!connection || !/^kanas_test(?:_|$)/.test(new URL(connection).pathname.slice(1))) {
  throw new Error('Integration tests require a separate DATABASE_URL database named kanas_test...');
}
const originalFetch = globalThis.fetch;
let deliveryWorks = false;
let fieldId: string;
let day: string;
function req(path: string, id = 100001, body?: unknown): Request {
  return new Request('http://localhost'+path,{method:body===undefined?'GET':'POST',headers:{'x-telegram-init-data':signedData(id),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
function context(id: string) { return {params:Promise.resolve({id})}; }
async function create(time: string, user = 100001, requestId = randomUUID(), targetField = fieldId) {
  const response = await bookings.POST(req('/api/bookings',user,{field_id:targetField,date:day,time,request_id:requestId}));
  return {response,body:await response.json()};
}
async function decide(id: string, action: string, note = '', user = testAdmin) {
  return decision.POST(req('/decision',user,{decision:action,note,payment_verified:true}),context(id));
}

before(async () => {
  process.env.TELEGRAM_BOT_TOKEN=testToken;
  process.env.ADMIN_TELEGRAM_IDS=String(testAdmin);
  process.env.KASPI_PAYMENT_URL='https://example.invalid/qa-only-not-a-payment';
  globalThis.fetch=async () => Response.json({ok:deliveryWorks},{status:deliveryWorks?200:503});
  execFileSync(process.execPath,['scripts/migrate.mjs'],{stdio:'inherit'});
  execFileSync(process.execPath,['scripts/migrate.mjs'],{stdio:'inherit'});
  await db.query('TRUNCATE telegram_notifications,booking_decisions,bookings,customers,football_fields RESTART IDENTITY CASCADE');
  fieldId=(await db.query("INSERT INTO football_fields(title,price_kzt,opens_at,closes_at) VALUES ('QA fixture - not a real field',1000,'07:30','23:30') RETURNING id")).rows[0].id;
  day=(await db.query("SELECT to_char((now() AT TIME ZONE 'Asia/Almaty')::date+1,'YYYY-MM-DD') AS day")).rows[0].day;
});
after(async () => { globalThis.fetch=originalFetch; await db.end(); });

test('catalog SQL, Kazakhstan timezone, aligned slots, invalid inputs, and ACL', async () => {
  const catalog=await (await fields.GET(req('/api/fields'))).json();
  assert.equal(catalog.fields[0].opens_at,'07:30');
  assert.equal((await adminFields.GET(req('/api/admin/fields'))).status,403);
  assert.equal((await adminBookings.GET(req('/api/admin/bookings'))).status,403);
  assert.equal((await adminFields.POST(req('/api/admin/fields',100001,{}))).status,403);
  assert.equal((await adminFields.GET(req('/api/admin/fields',testAdmin))).status,200);
  assert.equal((await bookings.GET(new Request('http://localhost/api/bookings'))).status,401);
  const response=await availability.GET(req('/api/availability?fieldId='+fieldId+'&date='+day));
  const slots=(await response.json()).slots;
  assert.equal(slots.length,16); assert.equal(slots[0].time,'07:30'); assert.equal(slots.at(-1).time,'22:30');
  assert.equal(response.headers.get('cache-control'),'no-store');
  for (const time of ['07:00','23:30','23:00','06:30']) assert.equal((await create(time)).response.status,409);
  assert.equal((await availability.GET(req('/api/availability?fieldId='+fieldId+'&date=2026-02-30'))).status,400);
  assert.equal((await paid.POST(req('/paid',100001,{}),context('-'.repeat(36)))).status,400);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM customers')).rows[0].count,0);
});

test('concurrent slot races have exactly one winner; adjacent hours work; DB rejects overlap directly', async () => {
  const results=await Promise.all(Array.from({length:12},(_,i)=>create('07:30',110000+i)));
  assert.equal(results.filter((r)=>r.response.status===201).length,1);
  assert.equal(results.filter((r)=>r.response.status===409).length,11);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM bookings WHERE status='held'")).rows[0].count,1);
  assert.equal((await create('08:30')).response.status,201);
  const winner=results.find((r)=>r.response.status===201)!.body.booking;
  await assert.rejects(db.query(
    "INSERT INTO bookings(field_id,telegram_id,starts_at,ends_at,price_kzt,hold_expires_at) SELECT field_id,telegram_id,starts_at+interval '30 minutes',ends_at+interval '30 minutes',price_kzt,hold_expires_at FROM bookings WHERE id=$1",[winner.id]),
    (error: unknown)=> (error as {code:string}).code==='23P01');
  const instant=(await db.query('SELECT starts_at FROM bookings WHERE id=$1',[winner.id])).rows[0].starts_at as Date;
  assert.equal(instant.toISOString(),day+'T02:30:00.000Z');
  console.log('12 concurrent requests: 1 created / 11 conflict; direct SQL overlap: 23P01');
});

test('concurrent idempotency retries create one booking; mismatched reuse fails', async () => {
  const key=randomUUID();
  const attempts=await Promise.all(Array.from({length:6},()=>create('09:30',120001,key)));
  assert.equal(attempts.filter((r)=>r.response.status===201).length,1);
  assert.equal(attempts.filter((r)=>r.response.status===200).length,5);
  assert.equal(new Set(attempts.map((r)=>r.body.booking.id)).size,1);
  assert.equal((await create('10:30',120001,key)).response.status,409);
});

test('expired holds release slots; late payment is recorded without stealing a new booking', async () => {
  const old=(await create('10:30',130001)).body.booking;
  await db.query("UPDATE bookings SET hold_expires_at=now()-interval '1 second' WHERE id=$1",[old.id]);
  const newer=(await create('10:30',130002)).body.booking;
  assert.ok(newer.id);
  assert.equal((await paid.POST(req('/paid',130002,{}),context(old.id))).status,404);
  const late=await paid.POST(req('/paid',130001,{}),context(old.id));
  assert.equal((await late.json()).payment_issue_open,true);
  assert.equal((await db.query('SELECT status FROM bookings WHERE id=$1',[newer.id])).rows[0].status,'held');
  assert.equal((await decide(old.id,'confirm')).status,409);
  const note='QA: late payment checked, refund agreed outside app';
  assert.equal((await decide(old.id,'resolve',note)).status,200);
  assert.equal((await decide(old.id,'resolve',note)).status,200);
  assert.equal((await (await paid.POST(req('/paid',130001,{}),context(old.id))).json()).payment_issue_open,false);
});

test('manual payment review stays locked, survives old dates, supports dispute and admin-only decisions', async () => {
  const booking=(await create('11:30',140001)).body.booking;
  assert.equal((await paid.POST(req('/paid',140001,{}),context(booking.id))).status,200);
  assert.equal((await paid.POST(req('/paid',140001,{}),context(booking.id))).status,200);
  await db.query("UPDATE bookings SET hold_expires_at=now()-interval '2 days',customer_marked_paid_at=now()-interval '2 days' WHERE id=$1",[booking.id]);
  assert.equal((await create('11:30',140002)).response.status,409);
  assert.equal((await decide(booking.id,'confirm','',140001)).status,403);
  assert.equal((await decision.POST(req('/decision',testAdmin,{decision:'confirm'}),context(booking.id))).status,400);
  assert.equal((await decide(booking.id,'reject')).status,400);
  assert.equal((await decide(booking.id,'dispute','QA: receipt amount requires clarification')).status,200);
  assert.equal((await create('11:30',140002)).response.status,409);
  const queue=(await (await adminBookings.GET(req('/api/admin/bookings',testAdmin))).json()).bookings;
  assert.equal(queue.find((b: {id:string})=>b.id===booking.id).overdue,true);
  assert.equal((await decide(booking.id,'confirm')).status,200);
  assert.equal((await decide(booking.id,'confirm')).status,200);
  assert.equal((await decide(booking.id,'reject','QA: opposing duplicate decision')).status,409);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM booking_decisions WHERE booking_id=$1',[booking.id])).rows[0].n,2);
  const mine=(await (await bookings.GET(req('/api/bookings',140002))).json()).bookings;
  assert.equal(mine.some((b: {id:string})=>b.id===booking.id),false);
});

test('rejection frees slot; stale reviews remain visible after the match date', async () => {
  const booking=(await create('12:30',150001)).body.booking;
  await paid.POST(req('/paid',150001,{}),context(booking.id));
  assert.equal((await decide(booking.id,'reject','QA: no matching payment; customer notified')).status,200);
  assert.equal((await create('12:30',150002)).response.status,201);
  const old=(await create('13:30',150003)).body.booking;
  await paid.POST(req('/paid',150003,{}),context(old.id));
  await db.query("UPDATE bookings SET starts_at=starts_at-interval '10 days',ends_at=ends_at-interval '10 days' WHERE id=$1",[old.id]);
  const queue=(await (await adminBookings.GET(req('/admin',testAdmin))).json()).bookings;
  assert.ok(queue.some((b:{id:string})=>b.id===old.id));
});

test('concurrent per-user limit, disabled fields, and configuration failures leave no partial state', async () => {
  const result=await Promise.all(['14:30','15:30','16:30','17:30','18:30','19:30'].map((time)=>create(time,160001)));
  assert.equal(result.filter((r)=>r.response.status===201).length,5);
  assert.equal(result.filter((r)=>r.response.status===429).length,1);
  await db.query('UPDATE football_fields SET active=false WHERE id=$1',[fieldId]);
  assert.equal((await create('20:30',160002)).response.status,409);
  await db.query('UPDATE football_fields SET active=true WHERE id=$1',[fieldId]);
  const url=process.env.KASPI_PAYMENT_URL;
  delete process.env.KASPI_PAYMENT_URL;
  assert.equal((await create('20:30',160003)).response.status,503);
  process.env.KASPI_PAYMENT_URL=url;
  assert.equal((await db.query('SELECT count(*)::int AS n FROM customers WHERE telegram_id IN (160002,160003)')).rows[0].n,0);
});

test('Telegram failures preserve decisions and pending outbox; retry delivery is persisted', async () => {
  assert.ok((await db.query('SELECT count(*)::int AS n FROM telegram_notifications WHERE delivered_at IS NULL AND attempts>0')).rows[0].n>0);
  deliveryWorks=true;
  await db.query('UPDATE telegram_notifications SET next_attempt_at=now() WHERE delivered_at IS NULL');
  while ((await db.query('SELECT count(*)::int AS n FROM telegram_notifications WHERE delivered_at IS NULL')).rows[0].n) await flushNotifications();
  assert.equal((await db.query('SELECT count(*)::int AS n FROM telegram_notifications WHERE delivered_at IS NULL')).rows[0].n,0);
  assert.ok((await db.query('SELECT count(*)::int AS n FROM telegram_notifications WHERE delivered_at IS NOT NULL')).rows[0].n>0);
});
