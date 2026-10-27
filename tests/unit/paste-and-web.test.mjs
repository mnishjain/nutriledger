// Pasted text (copied from web pages / AI answers) — fixtures in tests/fixtures/paste/ were produced by a real
// browser's copy algorithm (Chromium selection.toString()) from typical page layouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLabel } from '../../js/core/labelparse.js';
import { aiPrompt, googleAiUrl, googleUrl } from '../../js/ui/weblookup.js';

const P = (f) => parseLabel(fs.readFileSync(new URL(`../fixtures/paste/${f}.txt`, import.meta.url), 'utf8'), { source: 'text' });
const r1 = (v) => (v === undefined ? undefined : Math.round(v * 10) / 10);
const pick = (r, o) => Object.fromEntries(Object.keys(o).map((k) => [k, r1(r.per100[k])]));
const check = (name, exp, extra = () => {}) => test(`paste: ${name}`, () => { const r = P(name); assert.deepEqual(pick(r, exp), exp); assert.equal(r.suspicious.length, 0, `no false alarms: ${r.suspicious}`); extra(r); });

check('div-grid', { kcal: 127, protein: 8.7, carbs: 22.8, fat: 0.5, fibre: 6.4, sodium: 2, potassium: 405 }); // label and value on separate lines (the reported failure)
check('stacked-cards', { kcal: 265, protein: 18.3, fat: 20.8, carbs: 1.2, calcium: 480 }); // value BEFORE label
check('ai-prose', { kcal: 127, protein: 8.7, carbs: 22.8, fat: 0.5, fibre: 6.4, sodium: 2, potassium: 405, iron: 2.9 });
check('ai-table', { kcal: 105, protein: 7, carbs: 19.1, fat: 0.4, fibre: 7.6, sodium: 2, iron: 1.4 });
check('google-card', { kcal: 127, fat: 0.5, satfat: 0.1, sodium: 2, potassium: 405, carbs: 22.8, fibre: 6.4, sugar: 0.3, protein: 8.7, iron: undefined, calcium: undefined });
check('amazon-table', { kcal: 532, protein: 22, carbs: 38, sugar: 2, fibre: 6, fat: 34, satfat: 15, sodium: 820 }, (r) => assert.equal(r.basis, 'per100'));
check('eu-kj-kcal', { kcal: 520, fat: 27, satfat: 12, carbs: 60.2, sugar: 5, fibre: 2.1, protein: 8.5, sodium: 640 });
check('fatsecret-serving', { kcal: 115, fat: 3.6, carbs: 16.8, protein: 4.5, sodium: 234.2 }, (r) => { assert.equal(r.basis, 'perServing'); assert.equal(r.servingG, 240); });
test('paste: AI ranges use the middle value and say so', () => {
  const r = P('ai-bullets');
  assert.equal(r.per100.kcal, 293); assert.equal(r.per100.protein, 21.5); assert.equal(r.per100.satfat, 13);
  assert.ok(r.warnings.some((w) => /ranges/.test(w)));
});

test('paste: the exact reply format the app asks Google AI for, including "unknown"', () => {
  const r = parseLabel('Energy: 536 kcal\nProtein: 6.8 g\nCarbohydrate: 52.9 g\nTotal sugars: 2.6 g\nFibre: unknown\nFat: 33.2 g\nSaturated fat: 13.6 g\nSodium: 698 mg\nPotassium: unknown\nCalcium: unknown\nIron: 2.1 mg\nSource: manufacturer label (Haldiram\'s)', { source: 'text' });
  assert.deepEqual(pick(r, { kcal: 0, protein: 0, carbs: 0, sugar: 0, fat: 0, satfat: 0, sodium: 0, iron: 0 }), { kcal: 536, protein: 6.8, carbs: 52.9, sugar: 2.6, fat: 33.2, satfat: 13.6, sodium: 698, iron: 2.1 });
  assert.equal(r.per100.fibre, undefined, '"unknown" stays unknown, never 0');
  assert.equal(r.per100.potassium, undefined);
});

test('paste: other common wordings', () => {
  const cases = [
    ['Calories - 120\nProtein - 4 grams\nCarbs - 20 grams\nFat - 3 grams', { kcal: 120, protein: 4, carbs: 20, fat: 3 }],
    ['120 Cal | 4g protein | 20g carbs | 3g fat', { kcal: 120, protein: 4, carbs: 20, fat: 3 }],
    ['Per 100 g: Energy 1,674 kJ (400 kcal), protein 12 g, carbohydrate 70 g, fat 8 g, sodium 1,200 mg', { kcal: 400, protein: 12, carbs: 70, fat: 8, sodium: 1200 }],
    ['Energy (kJ)\t1674\nProtein (g)\t12\nCarbohydrate (g)\t70\nFat (g)\t8', { kcal: 400.1, protein: 12, carbs: 70, fat: 8 }],
    ['One medium banana (118 g) provides about 105 calories, 1.3 g protein, 27 g carbs and 0.4 g fat.', { kcal: 89, protein: 1.1, carbs: 22.9, fat: 0.3 }],
  ];
  for (const [t, exp] of cases) assert.deepEqual(pick(parseLabel(t, { source: 'text' }), exp), exp, t);
});

test('paste: text without nutrition values gives nothing (never invents)', () => {
  for (const t of ['Great taste! Buy now, 20% off. 500 g pack, Rs 120.', 'Add 2 tbsp oil and 1 tsp salt to 200 g dal and cook for 10 minutes.', 'Paneer is a fresh cheese common in India.', '']) {
    const r = parseLabel(t, { source: 'text' });
    assert.ok(r.found.length < 2, `${t} → ${JSON.stringify(r.per100)}`);
  }
});

test('paste: inconsistent source is flagged, not silently trusted', () => {
  const r = parseLabel('Calories: 500 kcal\nProtein: 5 g\nCarbs: 10 g\nFat: 2 g', { source: 'text' });
  assert.ok(r.suspicious.includes('kcal'));
  assert.ok(r.warnings.some((w) => /do not match/.test(w)));
});

test('web lookup: Google AI link carries the food name and the fixed reply format', () => {
  const u = new URL(googleAiUrl('Haldiram aloo bhujia'));
  assert.equal(u.hostname, 'www.google.com'); assert.equal(u.searchParams.get('udm'), '50');
  const q = u.searchParams.get('q');
  assert.ok(q.includes('"Haldiram aloo bhujia"') && q.includes('per 100 g') && q.includes('unknown') && q.includes('source'));
  assert.equal(q, aiPrompt('Haldiram aloo bhujia'));
  assert.match(new URL(googleUrl('poha')).searchParams.get('q'), /poha nutrition facts per 100g/);
});
