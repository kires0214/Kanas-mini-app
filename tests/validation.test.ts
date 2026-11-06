import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, dateValue, positiveId, timeValue, uuidValue, paymentUrl, requireAdmin } from '../lib/api';

test('date validation rejects impossible dates', () => {
  assert.equal(dateValue('2026-11-07'), '2026-11-07');
  assert.throws(() => dateValue('2026-02-30'), ApiError);
  assert.throws(() => dateValue('2026-13-01'), ApiError);
});

test('identifiers reject coercion and malformed UUIDs', () => {
  for (const value of [true, ['1'], '1e2', ' 1 ', '', null, {}, 1.5]) assert.throws(() => positiveId(value), ApiError);
  assert.throws(() => uuidValue('-'.repeat(36)), ApiError);
  assert.equal(uuidValue('AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA'),'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
});

test('ACL and payment URL configuration fail closed', () => {
  const admin = process.env.ADMIN_TELEGRAM_IDS;
  const url = process.env.KASPI_PAYMENT_URL;
  try {
    process.env.ADMIN_TELEGRAM_IDS='123, 456';
    requireAdmin({id:123,first_name:'Admin'});
    assert.throws(() => requireAdmin({id:12,first_name:'User'}), ApiError);
    for (const value of ['', 'http://example.invalid', 'javascript:alert(1)', 'https://user:secret@example.invalid']) {
      process.env.KASPI_PAYMENT_URL=value; assert.equal(paymentUrl(),null);
    }
    process.env.KASPI_PAYMENT_URL='https://example.invalid/qa-only';
    assert.equal(paymentUrl(),'https://example.invalid/qa-only');
  } finally {
    if (admin === undefined) delete process.env.ADMIN_TELEGRAM_IDS; else process.env.ADMIN_TELEGRAM_IDS=admin;
    if (url === undefined) delete process.env.KASPI_PAYMENT_URL; else process.env.KASPI_PAYMENT_URL=url;
  }
});

test('time and id validation rejects malformed values', () => {
  assert.equal(timeValue('07:30'), '07:30');
  assert.throws(() => timeValue('24:00'), ApiError);
  assert.throws(() => timeValue('07:99'), ApiError);
  assert.equal(positiveId('12'), 12);
  assert.throws(() => positiveId(-5), ApiError);
});
