import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuiltin } from '../../js/core/library.js';
import { makeItem, makeFoodEntry, makeMeal, makeMealEntry, rescaleEntry, dayTotals, copyEntries, makeQuickEntry } from '../../js/core/entries.js';

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);

test('recipe combination: 50 g roasted chana + 20 g peanuts', () => {
  const chana = getBuiltin('d:roasted-chana'); const pea = getBuiltin('f:peanuts');
  const items = [makeItem(chana, { grams: 50, portionLabel: 'grams', qty: 50 }), makeItem(pea, { grams: 20, portionLabel: 'grams', qty: 20 })];
  const meal = makeMeal({ profileId: 'p1', name: 'Chana + peanuts', items });
  const e = makeMealEntry({ profileId: 'p1', date: '2026-10-25', slot: 'Snacks', meal, mult: 1 });
  near(e.n.kcal, items[0].n.kcal + items[1].n.kcal);
  near(e.n.protein, items[0].n.protein + items[1].n.protein);
  const e2 = makeMealEntry({ profileId: 'p1', date: '2026-10-25', slot: 'Snacks', meal, mult: 1.5 });
  near(e2.n.kcal, e.n.kcal * 1.5);
});

test('two chapatis + one bowl sabzi + curd', () => {
  const ch = getBuiltin('d:chapati'); const sb = getBuiltin('d:mixed-veg'); const curd = getBuiltin('d:curd');
  const items = [makeItem(ch, { grams: 80, qty: 2, portionLabel: 'medium chapati' }), makeItem(sb, { grams: 150, qty: 1, portionLabel: 'medium bowl' }), makeItem(curd, { grams: 100, qty: 1, portionLabel: 'small bowl' })];
  const meal = makeMeal({ profileId: 'p1', name: 'Roti sabzi dahi', items });
  const sum = items.reduce((s, i) => s + i.n.kcal, 0);
  near(makeMealEntry({ profileId: 'p1', date: '2026-10-25', slot: 'Lunch', meal }).n.kcal, sum);
});

test('history is immutable: editing a saved meal does not change logged entries', () => {
  const pea = getBuiltin('f:peanuts');
  const meal = makeMeal({ profileId: 'p1', name: 'Peanuts', items: [makeItem(pea, { grams: 20 })] });
  const entry = makeMealEntry({ profileId: 'p1', date: '2026-10-24', slot: 'Snacks', meal });
  const before = entry.n.kcal;
  meal.items[0].n.kcal = 9999; meal.items.push(makeItem(pea, { grams: 100 }));
  const edited = makeMeal({ ...meal, id: meal.id });
  assert.equal(entry.n.kcal, before);
  assert.equal(entry.items.length, 1);
  assert.notEqual(edited.items.length, entry.items.length);
});

test('rescale entry relative to original snapshot', () => {
  const f = getBuiltin('f:almonds');
  const e = makeFoodEntry({ profileId: 'p1', date: '2026-10-25', slot: 'Snacks', item: makeItem(f, { grams: 12, qty: 1, portionLabel: '10 almonds' }) });
  const r = rescaleEntry(e, 2);
  near(r.n.kcal, e.n.kcal * 2);
  near(rescaleEntry(r, 0.5).n.kcal, e.n.kcal * 0.5);
  assert.throws(() => rescaleEntry(e, 0), RangeError);
});

test('missing data: items with unknown sodium reduce coverage, never add zero', () => {
  const quick = makeQuickEntry({ profileId: 'p1', date: '2026-10-25', slot: 'Lunch', name: 'Restaurant thali', nutrients: { kcal: 800, protein: 25 } });
  const dal = makeFoodEntry({ profileId: 'p1', date: '2026-10-25', slot: 'Dinner', item: makeItem(getBuiltin('d:dal-arhar'), { grams: 150 }) });
  const t = dayTotals([quick, dal]);
  assert.ok(t.totals.sodium > 0);
  assert.ok(t.coverage.sodium < 0.25, `coverage ${t.coverage.sodium}`);
  assert.throws(() => makeQuickEntry({ profileId: 'p1', date: '2026-10-25', slot: 'Lunch', nutrients: { protein: 5 } }), /Calories/);
});

test('copy entries creates new ids on the target date', () => {
  const f = getBuiltin('f:apple');
  const e = makeFoodEntry({ profileId: 'p1', date: '2026-10-24', slot: 'Snacks', item: makeItem(f, { grams: 150 }) });
  const [c] = copyEntries([e], { date: '2026-10-25' });
  assert.notEqual(c.id, e.id); assert.equal(c.date, '2026-10-25'); near(c.n.kcal, e.n.kcal);
});
