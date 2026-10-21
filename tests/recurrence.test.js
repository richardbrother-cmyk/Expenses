import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, describeRule, parseMonthDays, addMonths, nextOccurrence } from '../recurrence.js';

test('mensual el día 5', () => {
  const r = { freq: 'monthly', interval: 1, monthDays: [5], start: '2026-01-05' };
  assert.deepEqual(occurrences(r, '2026-01-01', '2026-04-30'), ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05']);
});

test('bimestral', () => {
  const r = { freq: 'monthly', interval: 2, monthDays: [10], start: '2026-01-10' };
  assert.deepEqual(occurrences(r, '2026-01-01', '2026-12-31'), ['2026-01-10', '2026-03-10', '2026-05-10', '2026-07-10', '2026-09-10', '2026-11-10']);
});

test('día 31 se ajusta al último día del mes', () => {
  const r = { freq: 'monthly', interval: 1, monthDays: [31], start: '2026-01-31' };
  assert.deepEqual(occurrences(r, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('quincenal: 15 y último', () => {
  const r = { freq: 'monthly', interval: 1, monthDays: [15, -1], start: '2026-02-01' };
  assert.deepEqual(occurrences(r, '2026-02-01', '2026-03-31'), ['2026-02-15', '2026-02-28', '2026-03-15', '2026-03-31']);
});

test('cada semana en jueves', () => {
  const r = { freq: 'weekly', interval: 1, weekdays: [4], start: '2026-10-01' }; // 1 oct 2026 es jueves
  assert.deepEqual(occurrences(r, '2026-10-01', '2026-10-31'), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
});

test('cada 2 semanas lunes y jueves, empezando a media semana', () => {
  const r = { freq: 'weekly', interval: 2, weekdays: [1, 4], start: '2026-10-07' }; // miércoles
  assert.deepEqual(occurrences(r, '2026-10-01', '2026-10-31'), ['2026-10-08', '2026-10-19', '2026-10-22']);
});

test('primer lunes y último viernes', () => {
  const a = { freq: 'monthly', interval: 1, monthMode: 'nth', nth: 1, nthWeekday: 1, start: '2026-01-01' };
  assert.deepEqual(occurrences(a, '2026-01-01', '2026-03-31'), ['2026-01-05', '2026-02-02', '2026-03-02']);
  const b = { freq: 'monthly', interval: 1, monthMode: 'nth', nth: -1, nthWeekday: 5, start: '2026-01-01' };
  assert.deepEqual(occurrences(b, '2026-01-01', '2026-02-28'), ['2026-01-30', '2026-02-27']);
});

test('anual con 29 de febrero', () => {
  const r = { freq: 'yearly', interval: 1, start: '2024-02-29' };
  assert.deepEqual(occurrences(r, '2024-01-01', '2026-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28']);
});

test('fin por número de veces y por fecha', () => {
  const r = { freq: 'monthly', interval: 1, monthDays: [1], start: '2026-01-01', endType: 'count', count: 3 };
  assert.deepEqual(occurrences(r, '2026-02-01', '2026-12-31'), ['2026-02-01', '2026-03-01']);
  const s = { freq: 'daily', interval: 3, start: '2026-01-01', endType: 'date', endDate: '2026-01-10' };
  assert.deepEqual(occurrences(s, '2026-01-01', '2026-12-31'), ['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10']);
});

test('siguiente ocurrencia y meses', () => {
  const r = { freq: 'monthly', interval: 1, monthDays: [5], start: '2026-01-05' };
  assert.equal(nextOccurrence(r, '2026-10-21'), '2026-11-05');
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('descripción y parseo de días', () => {
  assert.deepEqual(parseMonthDays('15 y último'), [15, -1]);
  assert.deepEqual(parseMonthDays('1, 15'), [1, 15]);
  assert.equal(describeRule({ freq: 'monthly', interval: 2, monthDays: [5], start: '2026-01-05' }), 'Cada 2 meses (bimestral) el día 5');
  assert.equal(describeRule({ freq: 'weekly', interval: 1, weekdays: [4], start: '2026-10-01' }), 'Cada semana los jueves');
  assert.equal(describeRule({ freq: 'monthly', interval: 1, monthDays: [15, -1], start: '2026-01-01' }), 'Cada mes los días 15 y último');
});
