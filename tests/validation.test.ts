import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, dateValue, positiveId, timeValue } from '../lib/api';

test('date validation rejects impossible dates', () => {
  assert.equal(dateValue('2026-11-07'), '2026-11-07');
  assert.throws(() => dateValue('2026-02-30'), ApiError);
  assert.throws(() => dateValue('2026-13-01'), ApiError);
});

test('time and id validation rejects malformed values', () => {
  assert.equal(timeValue('07:30'), '07:30');
  assert.throws(() => timeValue('24:00'), ApiError);
  assert.throws(() => timeValue('07:99'), ApiError);
  assert.equal(positiveId('12'), 12);
  assert.throws(() => positiveId(-5), ApiError);
});
