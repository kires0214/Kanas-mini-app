import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

test('adopts an existing 001 schema with retained booking data; repeat migration is safe', async () => {
  const connection=process.env.DATABASE_URL;
  if (!connection || !/^kanas_test(?:_|$)/.test(new URL(connection).pathname.slice(1))) throw new Error('Migration QA requires kanas_test database');
  const name='kanas_test_upgrade_'+randomUUID().replaceAll('-','');
  const management=new pg.Client({connectionString:connection,application_name:'kanas-migration-qa-owner'});
  const targetUrl=new URL(connection);targetUrl.pathname='/'+name;
  const legacy=new pg.Client({connectionString:targetUrl.toString(),application_name:'kanas-migration-qa-legacy'});
  let identity: {oid:number;owner:string} | undefined;
  await management.connect();
  try {
    await management.query('CREATE DATABASE "'+name+'"');
    identity=(await management.query('SELECT oid,datdba::regrole::text AS owner FROM pg_database WHERE datname=$1',[name])).rows[0];
    await appendFile('.task-resources.jsonl',JSON.stringify({taskOwner:'Kanas migration QA',database:name,...identity,createdAt:new Date().toISOString(),shutdown:'close owned clients; verify database OID and owner; DROP DATABASE exact name; verify absence'})+'\n');
    await legacy.connect();
    // Represents an existing installation made with the old manual SQL procedure, without a migration ledger.
    await legacy.query(await readFile('db/001_initial.sql','utf8'));
    const field=(await legacy.query("INSERT INTO football_fields(title,price_kzt) VALUES ('Legacy QA fixture',1234) RETURNING id")).rows[0].id;
    await legacy.query("INSERT INTO customers(telegram_id,first_name) VALUES (777001,'Legacy QA')");
    const old=(await legacy.query("INSERT INTO bookings(field_id,telegram_id,starts_at,ends_at,price_kzt,hold_expires_at) VALUES ($1,777001,now()+interval '1 day',now()+interval '25 hours',1234,now()+interval '20 minutes') RETURNING id",[field])).rows[0].id;
    for(let i=0;i<2;i++) execFileSync(process.execPath,['scripts/migrate.mjs'],{env:{...process.env,DATABASE_URL:targetUrl.toString()},stdio:'inherit'});
    const booking=(await legacy.query('SELECT id,price_kzt,payment_issue_open FROM bookings WHERE id=$1',[old])).rows[0];
    assert.equal(booking.price_kzt,1234);assert.equal(booking.payment_issue_open,false);
    assert.equal((await legacy.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,2);
    console.log('Legacy schema upgraded twice; existing booking and amount preserved.');
  } finally {
    await legacy.end();
    try {
      if(identity) {
        const current=(await management.query('SELECT oid,datdba::regrole::text AS owner FROM pg_database WHERE datname=$1',[name])).rows[0];
        assert.deepEqual(current,identity,'verify current exact database identity and ownership before teardown');
        await management.query('DROP DATABASE "'+name+'"');
        assert.equal((await management.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0);
        await appendFile('.task-resources.jsonl',JSON.stringify({taskOwner:'Kanas migration QA',database:name,...identity,stoppedAt:new Date().toISOString(),verified:'owned database dropped; catalog entry absent'})+'\n');
      }
    } finally { await management.end(); }
  }
});
