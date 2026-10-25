import test from 'node:test';
import assert from 'node:assert/strict';
import { coreLibrary, getBuiltin, loadUsda, dietAllows } from '../../js/core/library.js';
import { nutrientsFor, allPortions, gramsForPortion } from '../../js/core/portions.js';
import { plausibility } from '../../js/core/nutrients.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

test('library: every food has calories, portions and a source', () => {
  for (const f of coreLibrary()) {
    assert.ok(f.per100.kcal !== null, `${f.id} kcal`);
    assert.ok(f.portions.length > 0, `${f.id} portions`);
    assert.ok(f.ref, `${f.id} ref`);
    assert.ok(['verified', 'label', 'estimate'].includes(f.conf), `${f.id} conf ${f.conf}`);
  }
});

test('IFCT values are converted to correct units (spot checks vs IFCT 2017)', () => {
  const atta = getBuiltin('f:atta');
  near(atta.per100.kcal, 320.3, 0.5, 'atta kcal (1340 kJ)');
  near(atta.per100.protein, 10.57, 0.01, 'atta protein');
  near(atta.per100.iron, 4.1, 0.01, 'atta iron mg');
  near(atta.per100.calcium, 30.94, 0.01, 'atta calcium mg');
  const ghee = getBuiltin('f:ghee');
  near(ghee.per100.kcal, 884, 1, 'ghee energy recomputed (dataset lists 0)');
  const paneer = getBuiltin('f:paneer');
  near(paneer.per100.protein, 18.86, 0.01, 'paneer protein');
  near(paneer.per100.calcium, 476, 0.5, 'paneer calcium');
});

test('Indian portions: chapatis 1/2/3 and ghee add-on', () => {
  const c = getBuiltin('d:chapati');
  const one = nutrientsFor(c, gramsForPortion(c, 0, 1));
  near(one.kcal, 96, 1, '1 medium chapati');
  near(one.protein, 3.17, 0.05, '1 chapati protein');
  const three = nutrientsFor(c, gramsForPortion(c, 0, 3));
  near(three.kcal, 3 * one.kcal, 0.01, '3 chapatis');
  const withGhee = nutrientsFor(c, gramsForPortion(c, 0, 2), 5);
  near(withGhee.kcal, 2 * one.kcal + 2 * 44.2, 0.5, '2 chapatis each with 1 tsp ghee');
  near(withGhee.fat, 2 * one.fat + 10, 0.01, 'fat increases by 10 g');
});

test('bowl sizes scale correctly for rice/dal/sabzi', () => {
  for (const id of ['d:rice-cooked', 'd:dal-arhar', 'd:mixed-veg']) {
    const f = getBuiltin(id);
    const ps = allPortions(f);
    const small = nutrientsFor(f, ps[0][1]); const med = nutrientsFor(f, ps[1][1]); const large = nutrientsFor(f, ps[2][1]);
    near(small.kcal / med.kcal, 2 / 3, 0.001, `${id} small/medium`);
    near(large.kcal / med.kcal, 4 / 3, 0.001, `${id} large/medium`);
  }
  const dal = getBuiltin('d:dal-arhar');
  const noTadka = nutrientsFor(dal, 150, 0); const dbl = nutrientsFor(dal, 150, 10);
  near(dbl.fat - noTadka.fat, 10, 0.01, 'tadka adjustment is exactly the fat added');
});

test('grams entry and custom portions', () => {
  const f = getBuiltin('f:almonds');
  const ps = allPortions(f, [['my scoop', 18]]);
  assert.ok(ps.some((p) => p[0] === 'my scoop'));
  assert.ok(ps.some((p) => p[0] === 'grams' && p[1] === 1));
  near(nutrientsFor(f, 18).kcal, (f.per100.kcal * 18) / 100, 1e-9, 'custom portion maths');
  assert.throws(() => nutrientsFor(f, 0), RangeError);
  assert.throws(() => nutrientsFor(f, -5), RangeError);
});

test('required foods from the brief exist', () => {
  for (const id of ['d:chapati', 'd:aloo-paratha', 'f:paneer', 'f:tofu-firm', 'd:roasted-chana', 'f:peanuts', 'f:walnuts', 'd:sprouts-moong', 'd:curd', 'label:amul-taaza', 'label:whey-generic', 'f:banana', 'd:rice-cooked', 'd:dal-arhar', 'd:mixed-veg']) {
    assert.ok(getBuiltin(id), id);
  }
});

test('USDA library loads lazily with diet flags', async () => {
  const usda = await loadUsda();
  assert.ok(usda.length > 5000);
  const chicken = usda.find((f) => /^Chicken\b/.test(f.name));
  assert.equal(chicken.diet, 'nonveg');
  assert.equal(dietAllows('veg', 'nonveg'), false);
  assert.equal(dietAllows('veg', 'egg'), false);
  assert.equal(dietAllows('egg', 'egg'), true);
  assert.equal(dietAllows('nonveg', 'nonveg'), true);
  const bad = usda.filter((f) => plausibility(f.per100).some((p) => p.includes('950')));
  assert.equal(bad.length, 0);
});
