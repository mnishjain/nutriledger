import test from 'node:test';
import assert from 'node:assert/strict';
import { sumWithCoverage, sanitize, scale, plausibility, kcalFromMacros, fromVector, KEYS } from '../../js/core/nutrients.js';

test('unknown is never zero: sanitize keeps blanks as null', () => {
  const n = sanitize({ kcal: '120', protein: '', fat: null, sodium: 'abc', fibre: -1, sugar: 0 });
  assert.equal(n.kcal, 120);
  assert.equal(n.protein, null);
  assert.equal(n.fat, null);
  assert.equal(n.sodium, null);
  assert.equal(n.fibre, null, 'negative is invalid → unknown');
  assert.equal(n.sugar, 0, 'a real zero stays zero');
});

test('sumWithCoverage: calorie-weighted coverage and lower-bound totals', () => {
  const items = [
    { ...fromVector(null), kcal: 300, protein: 10, sodium: 400 },
    { ...fromVector(null), kcal: 100, protein: 5, sodium: null },
  ];
  const r = sumWithCoverage(items);
  assert.equal(r.totals.kcal, 400);
  assert.equal(r.totals.protein, 15);
  assert.equal(r.totals.sodium, 400);
  assert.equal(r.coverage.sodium, 0.75, '300 of 400 kcal have sodium data');
  assert.equal(r.coverage.protein, 1);
  assert.equal(r.totals.iron, null, 'no item has iron → unknown, not 0');
  assert.equal(r.coverage.iron, 0);
});

test('sumWithCoverage on empty list', () => {
  const r = sumWithCoverage([]);
  assert.equal(r.totals.kcal, null);
  assert.equal(r.coverage.kcal, 0);
});

test('scale keeps unknowns unknown', () => {
  const s = scale({ ...fromVector(null), kcal: 100, protein: null }, 2.5);
  assert.equal(s.kcal, 250);
  assert.equal(s.protein, null);
  assert.equal(KEYS.length, 16);
});

test('plausibility catches impossible labels', () => {
  assert.deepEqual(plausibility({ kcal: 350, protein: 10, carbs: 60, fat: 8 }), []);
  assert.ok(plausibility({ kcal: 1200, protein: 10, carbs: 60, fat: 8 }).some((p) => p.includes('950')));
  assert.ok(plausibility({ kcal: 300, protein: 10, carbs: 60, fat: 8, satfat: 12 }).some((p) => p.includes('Saturated')));
  assert.ok(plausibility({ kcal: 300, protein: 50, carbs: 60, fat: 8 }).length > 0, 'macros > 100 g or mismatch');
  assert.ok(plausibility({ kcal: 100, protein: 20, carbs: 60, fat: 20 }).some((p) => p.includes('do not match')));
});

test('kcalFromMacros uses IFCT/FAO factors (ghee ≈ 884 kcal)', () => {
  assert.equal(Math.round(kcalFromMacros({ protein: 0, fat: 100, carbs: 0, fibre: 0 })), 884);
  assert.equal(kcalFromMacros({ protein: null, fat: 1, carbs: 1 }), null);
});
