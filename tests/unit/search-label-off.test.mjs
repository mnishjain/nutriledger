import test from 'node:test';
import assert from 'node:assert/strict';
import { coreLibrary } from '../../js/core/library.js';
import { rank, indexFood, relevantExternal, tokens } from '../../js/core/search.js';
import { parseLabel } from '../../js/core/labelparse.js';
import { mapProduct, searchProducts, lookupBarcode, _clearCache } from '../../js/api/off.js';

const index = coreLibrary().map(indexFood);
const top = (q, n = 1, opts) => rank(q, index, opts).slice(0, n).map((r) => r.f.id);

test('search relevance: common Indian queries hit the right food first', () => {
  const cases = { roti: 'd:chapati', chapati: 'd:chapati', 'aloo paratha': 'd:aloo-paratha', dahi: 'd:curd', curd: 'd:curd', rajma: 'd:rajma', 'toor dal': 'd:dal-arhar',
    'roasted chana': 'd:roasted-chana', 'bhuna chana': 'd:roasted-chana', akhrot: 'f:walnuts', walnut: 'f:walnuts', badam: 'f:almonds', paneer: 'f:paneer',
    tofu: 'f:tofu-firm', 'moong sprouts': 'd:sprouts-moong', ghee: 'f:ghee', chai: 'd:chai', 'toned milk': 'label:amul-taaza', whey: 'label:whey-generic', kela: 'f:banana', 'paner': 'f:paneer' };
  for (const [q, id] of Object.entries(cases)) assert.equal(top(q)[0], id, `query "${q}" → ${top(q, 3)}`);
});

test('search never pads with irrelevant results', () => {
  assert.deepEqual(rank('xyzzy', index), []);
  assert.deepEqual(rank('pizza burger', index), []);
  for (const r of rank('paneer tikka', index)) assert.match(r.f.name.toLowerCase() + r.f.aliases.join(' '), /paneer|tandoori/);
});

test('diet filter excludes non-vegetarian foods for vegetarian profiles', () => {
  const res = rank('egg', index, { dietOk: (f) => f.diet === 'veg' });
  assert.ok(res.every((r) => r.f.diet === 'veg'));
  assert.ok(rank('egg', index).some((r) => r.f.diet === 'egg'));
});

test('personal history boosts ranking', () => {
  const stats = new Map([['d:dal-moong', { count: 40 }]]);
  assert.equal(top('dal', 1, { stats })[0], 'd:dal-moong');
});

test('external relevance filter', () => {
  assert.ok(relevantExternal('amul paneer', 'Malai Paneer', 'Amul'));
  assert.ok(!relevantExternal('amul paneer', 'Amul Butter', 'Amul'));
  assert.ok(!relevantExternal('walnuts', 'Chocolate cookies', 'Brand'));
  assert.deepEqual(tokens('Walnuts (Akhrot)'), ['walnut', 'akhrot']);
});

test('label parse: two-column Indian label (per 100 g | per serve | %RDA)', () => {
  const txt = `NUTRITIONAL INFORMATION
  Nutrient Per 100 g Per serve (30 g) %RDA*
  Energy (kcal) 520 156 7.8%
  Protein (g) 8.5 2.6
  Carbohydrate (g) 60.2 18.1
  Total Sugars (g) 5.0 1.5
  Added Sugars (g) 3.1 0.9 1.9%
  Dietary Fibre (g) 2.1 0.6
  Total Fat (g) 27.0 8.1 12%
  Saturated Fat (g) 12.0 3.6 16%
  Trans Fat (g) 0.1 0.03
  Sodium (mg) 650 195 9.8%`;
  const r = parseLabel(txt);
  assert.equal(r.basis, 'per100'); assert.equal(r.servingG, 30);
  assert.deepEqual([r.per100.kcal, r.per100.protein, r.per100.carbs, r.per100.sugar, r.per100.fibre, r.per100.fat, r.per100.satfat, r.per100.sodium], [520, 8.5, 60.2, 5, 2.1, 27, 12, 650]);
  assert.equal(r.suspicious.length, 0);
});

test('label parse: per-serving only label converts to per 100 g; kJ handled', () => {
  const r = parseLabel(`Nutrition facts per serving (40 g)\nEnergy 669 kJ\nProtein 4 g\nTotal fat 2 g\nCarbohydrate 28 g\nSodium 0.12 g`);
  assert.equal(r.basis, 'perServing');
  assert.ok(Math.abs(r.per100.kcal - 669 / 4.184 * 2.5) < 0.5);
  assert.equal(r.per100.protein, 10); assert.equal(r.per100.sodium, 300);
});

test('label parse: OCR misreads are flagged, not silently accepted', () => {
  const r = parseLabel(`Per 100 g\nEnergy 450 kcal\nProtein 129\nTotal Fat 20 g\nSaturated Fat 30 g`);
  assert.ok(r.suspicious.includes('protein'));
  assert.ok(r.suspicious.includes('satfat'));
  assert.ok(r.warnings.length > 0);
});

test('label parse: missing fields stay missing', () => {
  const r = parseLabel('Per 100 g\nEnergy 100 kcal\nProtein 3 g');
  assert.equal(r.per100.fat, undefined);
  assert.deepEqual(r.found, ['kcal', 'protein']);
});

const offProduct = { code: '8901262150378', product_name: 'Malai Paneer', brands: 'Amul', serving_quantity: '50', serving_size: '50 g',
  nutriments: { 'energy-kcal_100g': 288, proteins_100g: 18.3, carbohydrates_100g: 2.6, fat_100g: 22.8, 'saturated-fat_100g': 14.5, sodium_100g: 0.02, calcium_100g: 0.48 } };

test('OFF mapping: units converted, unknown stays unknown, serving portion created', () => {
  const { food } = mapProduct(offProduct);
  assert.equal(food.per100.kcal, 288); assert.equal(food.per100.sodium, 20); assert.equal(food.per100.calcium, 480);
  assert.equal(food.per100.fibre, null);
  assert.equal(food.portions[0][1], 50);
  assert.equal(food.conf, 'off');
  assert.match(food.name, /Amul/);
});

test('OFF mapping: rejects products without calories; flags implausible data', () => {
  assert.ok(mapProduct({ code: '1', product_name: 'X', nutriments: { proteins_100g: 3 } }).error);
  const bad = mapProduct({ code: '2', product_name: 'Bad', nutriments: { 'energy-kcal_100g': 100, proteins_100g: 30, fat_100g: 30, carbohydrates_100g: 30 } });
  assert.equal(bad.food.conf, 'off-doubtful');
  const kj = mapProduct({ code: '3', product_name: 'KJ only', nutriments: { 'energy-kj_100g': 1674, salt_100g: 1 } });
  assert.ok(Math.abs(kj.food.per100.kcal - 400) < 0.2); assert.equal(kj.food.per100.sodium, 400);
});

test('OFF search filters irrelevant products and survives API failure', async () => {
  _clearCache();
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ products: [offProduct, { code: '9', product_name: 'Amul Butter', brands: 'Amul', nutriments: { 'energy-kcal_100g': 720 } }, { code: '10', product_name: 'Paneer No Calories', brands: 'Amul', nutriments: {} }] }) });
  const r = await searchProducts('amul paneer', { fetchImpl: fakeFetch });
  assert.equal(r.items.length, 1); assert.equal(r.dropped, 2);
  _clearCache();
  await assert.rejects(searchProducts('amul paneer', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), /No internet/);
  await assert.rejects(searchProducts('x paneer', { fetchImpl: async () => ({ ok: false, status: 429 }) }), /rate-limiting/);
  const nf = await lookupBarcode('8900000000001', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 0 }) }) });
  assert.match(nf.error, /not in Open Food Facts/);
  assert.match((await lookupBarcode('12')).error, /barcode/);
});
