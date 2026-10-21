/** Run: npx ts-node src/hospitals/slot-times.check.ts */
import * as assert from 'node:assert';
import { slotTimesForDay } from './hospitals.service';

// 2026-10-26 is a Monday (day_of_week 1).
const monday = '2026-10-26';
const weekly = [
  { day_of_week: 1, start_time: '09:00:00', end_time: '12:00:00', slot_minutes: 60 },
  { day_of_week: 2, start_time: '14:00:00', end_time: '16:00:00', slot_minutes: 60 },
];

// Weekly window for the day only; a slot must fit before end_time.
assert.deepStrictEqual(slotTimesForDay(monday, weekly, []), ['09:00', '10:00', '11:00']);
assert.deepStrictEqual(slotTimesForDay('2026-10-28', weekly, []), []); // Wednesday: none

// A closed exception covering the day wins, even alongside open ones.
assert.deepStrictEqual(
  slotTimesForDay(monday, weekly, [
    { start_date: '2026-10-25', end_date: '2026-10-27', is_closed: true },
    { start_date: monday, end_date: monday, is_closed: false, start_time: '08:00', end_time: '09:00', slot_minutes: 30 },
  ]),
  [],
);

// Custom hours replace the weekly window for that day only.
const custom = [
  { start_date: monday, end_date: monday, is_closed: false, start_time: '13:00', end_time: '14:00', slot_minutes: 30 },
];
assert.deepStrictEqual(slotTimesForDay(monday, weekly, custom), ['13:00', '13:30']);
assert.deepStrictEqual(slotTimesForDay('2026-10-27', weekly, custom), ['14:00', '15:00']);

// One-off dated windows (doctor calendar proposals) apply on their date only,
// on top of the weekly window, and never repeat on the same weekday.
const withDated = [
  ...weekly,
  { day_of_week: 1, date: monday, start_time: '15:00:00', end_time: '16:00:00', slot_minutes: 60 },
];
assert.deepStrictEqual(slotTimesForDay(monday, withDated, []), ['09:00', '10:00', '11:00', '15:00']);
assert.deepStrictEqual(slotTimesForDay('2026-11-02', withDated, []), ['09:00', '10:00', '11:00']);
// Dated windows add to custom hours too, but a closed day closes everything.
assert.deepStrictEqual(slotTimesForDay(monday, withDated, custom), ['13:00', '13:30', '15:00']);
assert.deepStrictEqual(
  slotTimesForDay(monday, withDated, [{ start_date: monday, end_date: monday, is_closed: true }]),
  [],
);

console.log('slot-times.check: ok');
