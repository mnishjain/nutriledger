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

test('label parse: energy checksum repairs dropped decimals and flags them', () => {
  const r = parseLabel('Per 100 g\nEnergy 520 kcal\nProtein 8.5 g\nCarbohydrate 60.2 g\nTotal Fat 270 g\nSaturated Fat 120 g\nSodium 650 mg');
  assert.equal(r.per100.fat, 27); assert.equal(r.per100.satfat, 12);
  assert.ok(r.suspicious.includes('fat')); assert.ok(r.warnings.some((w) => /decimal point/.test(w)));
  const ok = parseLabel('Per 100 g\nEnergy 520 kcal\nProtein 8.5 g\nCarbohydrate 60.2 g\nTotal Fat 27.0 g');
  assert.equal(ok.per100.fat, 27); assert.ok(!ok.suspicious.includes('fat'));
  const g = parseLabel('Per 100 g\nEnergy 520 kcal\nDietary Fibre 2.1¢\nTotal Fat 27.0¢');
  assert.equal(g.per100.fibre, 2.1); assert.equal(g.per100.fat, 27);
});

test('label parse: a whole number among decimal values is flagged (lost decimal point)', () => {
  const r = parseLabel('Per 100 g\nEnergy 520 kcal\nProtein 8.5 g\nCarbohydrate 60.2 g\nTotal Sugars 50 g\nTotal Fat 27.0 g\nSaturated Fat 12.0 g');
  assert.ok(r.suspicious.includes('sugar'));
  assert.ok(!r.suspicious.includes('protein'));
  const plain = parseLabel('Per 100 g\nEnergy 360 kcal\nProtein 12 g\nCarbohydrate 70 g\nTotal Fat 4 g');
  assert.equal(plain.suspicious.length, 0, 'labels that use whole numbers throughout are not flagged');
});

// Real-world formats users screenshot from the web (fixtures in tests/fixtures/labels/)
import fsLab from 'node:fs';
const lab = (f) => parseLabel(fsLab.readFileSync(new URL(`../fixtures/labels/${f}`, import.meta.url), 'utf8'));
const r1 = (v) => Math.round(v * 10) / 10;

test('web formats: US FDA panel per serving "2/3 cup (55g)" → per 100 g', () => {
  const r = lab('us-fda-panel.txt');
  assert.equal(r.basis, 'perServing'); assert.equal(r.servingG, 55);
  assert.deepEqual([r1(r.per100.kcal), r1(r.per100.fat), r1(r.per100.carbs), r1(r.per100.protein), r1(r.per100.sodium), r1(r.per100.fibre)], [418.2, 14.5, 67.3, 5.5, 290.9, 7.3]);
  assert.equal(r.suspicious.length, 0);
});
test('web formats: old US panel ignores "Calories from Fat"', () => {
  const r = lab('old-us-panel.txt');
  assert.equal(r.servingG, 228); assert.equal(r1(r.per100.kcal), 109.6); assert.equal(r1(r.per100.fat), 5.3);
});
test('web formats: Google nutrition card per 100 g; "Vitamin B6" never read as iron', () => {
  const r = lab('google-card.txt');
  assert.equal(r.basis, 'per100');
  assert.deepEqual([r.per100.kcal, r.per100.protein, r.per100.carbs, r.per100.fat, r.per100.potassium, r.per100.sodium], [89, 1.1, 23, 0.3, 358, 1]);
  assert.equal(r.per100.iron, undefined);
  assert.equal(r.suspicious.length, 0, 'mixed integer/decimal formatting is not flagged');
});
test('web formats: several values on one line are separated correctly', () => {
  const r = lab('compact-web.txt');
  assert.deepEqual([r.per100.kcal, r.per100.fat, r.per100.carbs, r.per100.protein, r.per100.satfat, r.per100.sodium, r.per100.fibre, r.per100.sugar], [532, 34, 38, 22, 15, 820, 6, 2]);
});

// Real Tesseract outputs (3 image widths) captured from the app's own OCR pipeline: tests/fixtures/ocr/
import { combineReads, tokenCandidates, looksClean } from '../../js/core/labelparse.js';
const ocr = (n) => [800, 1200, 2000].map((w) => fsLab.readFileSync(new URL(`../fixtures/ocr/${n}-w${w}.txt`, import.meta.url), 'utf8'));
const pick = (r, ks) => ks.map((k) => r1(r.per100[k]));

test('OCR token candidates: trailing-9 "g" and lost decimal points', () => {
  assert.deepEqual(tokenCandidates('239g').map((c) => c.v).sort((a, b) => a - b), [2.3, 23, 23.9, 239]);
  assert.ok(tokenCandidates('119').some((c) => c.v === 1.1));
  assert.ok(tokenCandidates('270g').some((c) => c.v === 27));
  assert.equal(tokenCandidates('8.5g')[0].v, 8.5);
});
test('OCR combine: Indian pack label read 3 ways → all values correct', () => {
  const r = combineReads(ocr('label'));
  assert.deepEqual(pick(r, ['kcal', 'protein', 'carbs', 'sugar', 'fibre', 'fat', 'satfat', 'sodium']), [520, 8.5, 60.2, 5, 2.1, 27, 12, 650]);
  assert.ok(r.suspicious.length > 0, 'corrected values are highlighted for the user');
  assert.equal(looksClean(combineReads([ocr('label')[1]])), false, 'a single messy read triggers more reads');
});
test('OCR combine: Google-style screenshot → all values correct, iron % not invented', () => {
  const r = combineReads(ocr('shot-google'));
  assert.deepEqual(pick(r, ['kcal', 'protein', 'carbs', 'fat', 'fibre', 'sugar', 'sodium', 'potassium']), [89, 1.1, 23, 0.3, 2.6, 12, 1, 358]);
  assert.equal(r.per100.iron, undefined);
});
test('OCR combine: dark-mode US panel, "(559)" serving read as 55 g', () => {
  const r = combineReads(ocr('shot-us-dark'));
  assert.equal(r.servingG, 55);
  assert.deepEqual(pick(r, ['kcal', 'fat', 'carbs', 'protein', 'sodium', 'fibre', 'sugar']), [418.2, 14.5, 67.3, 5.5, 290.9, 7.3, 21.8]);
  assert.equal(r.suspicious.length, 0, 'clean read, nothing flagged');
});
test('OCR combine: Indian label where fibre exceeds carbs (chia) is not "corrected"', () => {
  assert.equal(combineReads(['Per 100 g\nEnergy 486 kcal\nProtein 16.5 g\nCarbohydrate 8.0 g\nDietary Fibre 34.4 g\nTotal Fat 30.7 g']).per100.fibre, 34.4);
});
test('OCR combine: "27.09" (g read as 9) resolves to 27.0', () => {
  const r = combineReads(['Per 100 g\nEnergy 520 kcal\nProtein 8.50\nCarbohydrate 60.2\nTotal Fat 27.09\nSaturated Fat 12.09']);
  assert.equal(r.per100.fat, 27); assert.equal(r.per100.satfat, 12); assert.ok(r.suspicious.includes('fat'));
});
