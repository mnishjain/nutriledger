import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTargets, bmr, validateProfile } from '../../js/core/targets.js';
import { analyzeDay, analyzeWindow, dayStatus } from '../../js/core/analysis.js';
import { rangeEnding, addDays } from '../../js/core/dates.js';
import { fromVector } from '../../js/core/nutrients.js';

const P = { name: 'MJ', sex: 'male', age: 47, heightCm: 168, weightKg: 72, activity: 'light', goal: 'lose', rateKgWk: 0.35, training: true, diet: 'veg' };
const T = computeTargets(P);
const TODAY = '2026-10-25';
const entry = (date, n) => ({ id: `${date}-${Math.random()}`, profileId: 'p', date, slot: 'Lunch', kind: 'quick', items: [{ name: 'x', n: { ...fromVector(null), ...n } }], n: { ...fromVector(null), ...n } });
function window(days, nutr, opts = {}) {
  const byDate = {};
  for (const d of rangeEnding(addDays(TODAY, -1), days)) byDate[d] = [entry(d, typeof nutr === 'function' ? nutr(d) : nutr)];
  return analyzeWindow({ today: TODAY, n: days, entriesByDate: byDate, targets: T, profile: P, ...opts });
}

test('targets: Mifflin-St Jeor and documented values for the owner profile', () => {
  assert.equal(Math.round(bmr(P)), 1540);
  assert.equal(T.kcal.maintenance, 2118);
  assert.equal(T.kcal.value, 1730, '0.35 kg/week ≈ 385 kcal deficit');
  assert.equal(T.protein.value, 115, '1.6 g/kg');
  assert.equal(T.sodium.value, 2000); assert.equal(T.fibre.value, 25); assert.equal(T.potassium.value, 3510);
  assert.equal(T.iron.value, 19); assert.equal(T.iron.ear, 11); assert.equal(T.calcium.value, 1000);
  assert.equal(T.satfat.value, Math.round(1730 * 0.1 / 9));
  const F = computeTargets({ ...P, sex: 'female', weightKg: 60 });
  assert.equal(F.iron.value, 29); assert.equal(F.iron.ear, 15);
});

test('targets: calorie floor and overrides', () => {
  const tiny = computeTargets({ ...P, weightKg: 50, heightCm: 155, age: 60, activity: 'sedentary', rateKgWk: 1 });
  assert.ok(tiny.kcal.value >= 1500, 'never below 1500 for men');
  const o = computeTargets({ ...P, overrides: { kcal: 1900, protein: 130 } });
  assert.equal(o.kcal.value, 1900); assert.equal(o.kcal.auto, 1730); assert.ok(o.kcal.overridden);
  assert.deepEqual(validateProfile({ ...P, age: 15 }).length, 1);
});

test('intraday: no "below target" alarms while the day is in progress', () => {
  const r = analyzeDay({ date: TODAY, today: TODAY, entries: [entry(TODAY, { kcal: 300, protein: 10, fibre: 2, sodium: 100 })], targets: T });
  assert.equal(r.status, 'in-progress');
  assert.equal(r.alerts.filter((a) => a.level === 'below').length, 0);
});

test('genuinely exceeded daily sodium limit is reported even in progress', () => {
  const r = analyzeDay({ date: TODAY, today: TODAY, entries: [entry(TODAY, { kcal: 600, sodium: 2600 })], targets: T });
  assert.ok(r.alerts.some((a) => a.level === 'limit' && a.nutrient === 'sodium'));
});

test('completed past day below protein target → "below" (not alarming)', () => {
  const d = addDays(TODAY, -1);
  const r = analyzeDay({ date: d, today: TODAY, entries: [entry(d, { kcal: 1700, protein: 60, fibre: 30 })], complete: true, targets: T });
  assert.ok(r.alerts.some((a) => a.level === 'below' && a.nutrient === 'protein'));
  assert.ok(!r.alerts.some((a) => a.nutrient === 'fibre'));
});

test('incomplete record cannot support a conclusion', () => {
  const d = addDays(TODAY, -2);
  assert.equal(dayStatus({ date: d, today: TODAY, entries: [entry(d, { kcal: 400 })], kcalTarget: 1730 }), 'likely-incomplete');
  const r = window(7, { kcal: 500, protein: 20 });
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].level, 'insufficient');
});

test('persistent overconsumption of calories', () => {
  const r = window(14, { kcal: 2100, protein: 120, fibre: 30, sodium: 1500, satfat: 10 });
  assert.ok(r.alerts.some((a) => a.level === 'pattern-high' && a.nutrient === 'kcal'), JSON.stringify(r.alerts));
});

test('persistent protein underconsumption and inadequate fibre', () => {
  const r = window(7, { kcal: 1750, protein: 70, fibre: 12, sodium: 1500, satfat: 10 });
  assert.ok(r.alerts.some((a) => a.level === 'pattern-low' && a.nutrient === 'protein'));
  assert.ok(r.alerts.some((a) => a.level === 'pattern-low' && a.nutrient === 'fibre' && /Inadequate recorded fibre/.test(a.message)));
});

test('potentially excessive sodium; low sodium never flagged as deficiency', () => {
  const hi = window(21, { kcal: 1750, protein: 120, fibre: 30, sodium: 3200, satfat: 10 });
  assert.ok(hi.alerts.some((a) => a.level === 'pattern-high' && /Potentially excessive sodium/.test(a.message)));
  const lo = window(21, { kcal: 1750, protein: 120, fibre: 30, sodium: 300, satfat: 10 });
  assert.ok(!lo.alerts.some((a) => a.nutrient === 'sodium' && ['pattern-low', 'below'].includes(a.level)));
  assert.ok(lo.alerts.some((a) => a.level === 'info' && a.nutrient === 'sodium'));
});

test('sustained calorie restriction → caution', () => {
  const r = window(14, { kcal: 1100, protein: 90, fibre: 25, sodium: 1500, satfat: 8 }, { completeDays: new Set(rangeEnding(addDays(TODAY, -1), 14)) });
  assert.ok(r.alerts.some((a) => a.level === 'caution' && a.nutrient === 'kcal'), JSON.stringify(r.alerts.map((a) => a.message)));
});

test('nutrient with poor coverage → insufficient, never a false deficiency', () => {
  const r = window(30, { kcal: 1750, protein: 120, fibre: 30, sodium: 1500, satfat: 10 }); // iron unknown everywhere
  assert.ok(!r.alerts.some((a) => a.nutrient === 'iron'));
  assert.ok(r.alerts.some((a) => a.level === 'insufficient' && /Iron/.test(a.message)));
});

test('micronutrient below EAR persistently → pattern-low; between EAR and RDA → below', () => {
  const low = window(14, { kcal: 1750, protein: 120, fibre: 30, sodium: 1500, satfat: 10, iron: 8 });
  assert.ok(low.alerts.some((a) => a.level === 'pattern-low' && a.nutrient === 'iron'));
  const mid = window(14, { kcal: 1750, protein: 120, fibre: 30, sodium: 1500, satfat: 10, iron: 15 });
  assert.ok(mid.alerts.some((a) => a.level === 'below' && a.nutrient === 'iron'));
});

test('7/14/21/30-day minimum day thresholds', () => {
  for (const [n, need] of [[7, 4], [14, 7], [21, 11], [30, 15]]) {
    const r = window(n, (d) => ({ kcal: rangeEnding(addDays(TODAY, -1), n).indexOf(d) < need - 1 ? 1750 : 0, protein: 120 }));
    assert.equal(r.minDays, need);
    assert.ok(r.alerts.some((a) => a.level === 'insufficient'), `${n}: should be insufficient with ${need - 1} days`);
  }
});

test('rapid weight loss caution', () => {
  const weights = [0, 7, 14, 21].map((i) => ({ date: addDays(TODAY, -21 + i), kg: 75 - i * 0.15 }));
  const r = window(14, { kcal: 1750, protein: 120, fibre: 30, sodium: 1500, satfat: 10 }, { weights });
  assert.ok(r.alerts.some((a) => a.level === 'caution' && /Weight falling/.test(a.message)));
});
