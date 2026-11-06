import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import pg from 'pg';

if (!process.env.DATABASE_URL || !/^kanas_test(?:_|$)/.test(new URL(process.env.DATABASE_URL).pathname.slice(1))) throw new Error('HTTP QA requires kanas_test database');
const database = new pg.Pool({connectionString:process.env.DATABASE_URL});
const token='123456789:test-only-not-a-real-telegram-bot-token';
const admin=900001;
function auth(id) {
  const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'HTTP QA'})});
  const check=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
  params.set('hash',createHmac('sha256',createHmac('sha256','WebAppData').update(token).digest()).update(check).digest('hex'));
  return params.toString();
}
// Reserve a free loopback port, then spawn a directly owned foreground child with a managed handle.
const probe=createServer();
await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
const port=probe.address().port;
await new Promise((resolve,reject)=>probe.close((error)=>error?reject(error):resolve()));
const args=['--import','./tests/support/telegram-mock.mjs','node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)];
const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',TELEGRAM_BOT_TOKEN:token,ADMIN_TELEGRAM_IDS:String(admin),KASPI_PAYMENT_URL:'https://example.invalid/qa-only-not-a-payment'}});
const identity={owner:'Kanas HTTP QA',pid:child.pid,startedAt:new Date().toISOString(),executable:process.execPath,args,port,shutdown:'SIGTERM same child handle, await exit, verify loopback port closed'};
await appendFile('.task-resources.jsonl',JSON.stringify(identity)+'\n');
const exit=once(child,'exit');
child.stdout.on('data',(data)=>process.stdout.write(data));
child.stderr.on('data',(data)=>process.stderr.write(data));
async function call(path,user=800001,body) {
  const response=await fetch('http://127.0.0.1:'+port+path,{headers:{'x-telegram-init-data':auth(user),'content-type':'application/json'},method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  return {status:response.status,body:await response.json()};
}
try {
  let ready=false;
  for(let attempt=0;attempt<100;attempt++) {
    if(child.exitCode!==null) throw new Error('HTTP QA child exited before readiness');
    try { if((await fetch('http://127.0.0.1:'+port+'/api/health')).ok) {ready=true;break;} } catch {}
    await new Promise((resolve)=>setTimeout(resolve,200));
  }
  assert.ok(ready,'HTTP server readiness');
  const page=await fetch('http://127.0.0.1:'+port+'/');
  assert.equal(page.status,200); assert.match(await page.text(),/KANAS/);
  assert.equal((await fetch('http://127.0.0.1:'+port+'/api/me')).status,401);
  assert.equal((await call('/api/admin/bookings')).status,403);
  const field=await call('/api/admin/fields',admin,{title:'HTTP QA fixture - not a real field',description:'Disposable CI fixture',price_kzt:2000,opens_at:'08:00',closes_at:'23:00',active:true});
  assert.equal(field.status,201);
  const fieldId=field.body.field.id;
  const day=(await database.query("SELECT to_char((now() AT TIME ZONE 'Asia/Almaty')::date+2,'YYYY-MM-DD') AS day")).rows[0].day;
  const input={field_id:fieldId,date:day,time:'10:00',request_id:randomUUID()};
  const created=await call('/api/bookings',800001,input); assert.equal(created.status,201);
  assert.equal((await call('/api/bookings',800001,input)).body.booking.id,created.body.booking.id);
  const id=created.body.booking.id;
  assert.equal((await call('/api/bookings/'+id+'/paid',800001,{})).body.status,'review');
  assert.equal((await call('/api/admin/bookings/'+id+'/decision',800001,{decision:'confirm',payment_verified:true})).status,403);
  assert.equal((await call('/api/admin/bookings/'+id+'/decision',admin,{decision:'confirm',payment_verified:true})).body.status,'confirmed');
  const mine=(await call('/api/bookings')).body.bookings;
  assert.equal(mine.find((b)=>b.id===id).status,'confirmed');
  assert.equal((await database.query('SELECT status FROM bookings WHERE id=$1',[id])).rows[0].status,'confirmed');
  const slots=(await call('/api/availability?fieldId='+fieldId+'&date='+day)).body.slots;
  assert.equal(slots.find((slot)=>slot.time==='10:00').available,false);
  console.log('Production HTTP QA passed: page, auth, ACL, field creation, availability, booking replay, paid review, manual admin confirmation, DB and customer history. Telegram transport mocked.');
} finally {
  await database.end();
  // No process-name or old-PID lookup: only the still-live child created above may be signalled.
  if(child.exitCode===null && child.signalCode===null && child.pid===identity.pid) child.kill('SIGTERM');
  await Promise.race([exit,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Owned HTTP child failed to exit')),10000);timer.unref();})]);
  await new Promise((resolve,reject)=>{
    const socket=connect({host:'127.0.0.1',port});
    socket.once('connect',()=>{socket.destroy();reject(new Error('HTTP QA port still open; ownership uncertain, left untouched'));});
    socket.once('error',(error)=>{if(error.code==='ECONNREFUSED') resolve();else reject(error);});
  });
  await appendFile('.task-resources.jsonl',JSON.stringify({...identity,stoppedAt:new Date().toISOString(),verified:'child exited; port refused connection'})+'\n');
  console.log('Owned HTTP server exited and loopback port is closed.');
}
