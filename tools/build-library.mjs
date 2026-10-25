#!/usr/bin/env node
// Builds js/data/library-core.js and js/data/library-usda.js from vendored sources.
// Usage: node tools/build-library.mjs [--report]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYS, kcalFromMacros, plausibility, fromVector, toVector } from '../js/core/nutrients.js';
import { FEATURED, LABELS, DISHES } from './sources/curated.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'tools/sources');
const OUT = path.join(ROOT, 'js/data');
const REPORT = process.argv.includes('--report');
const problems = [];

// ---------- CSV parser (RFC4180-ish) ----------
function parseCSV(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const r2 = (v, dp = 3) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(dp)));
const vecRound = (vec) => vec.map((v, i) => r2(v, KEYS[i] === 'kcal' ? 1 : 3));

// ---------- IFCT 2017 ----------
const NONVEG_GROUPS = new Set(['Animal Meat', 'Marine Fish', 'Poultry', 'Fresh Water Fish and Shellfish', 'Marine Shellfish', 'Marine Mollusks']);
const IFCT_GROUP = {
  'Cereals and Millets': 'Grains & flours', 'Grain Legumes': 'Pulses & legumes', 'Green Leafy Vegetables': 'Vegetables',
  'Other Vegetables': 'Vegetables', 'Fruits': 'Fruits', 'Roots and Tubers': 'Vegetables', 'Condiments and Spices': 'Spices',
  'Nuts and Oil Seeds': 'Nuts & seeds', 'Sugars': 'Sweeteners', 'Mushrooms': 'Vegetables', 'Miscellaneous Foods': 'Drinks',
  'Milk and Milk Products': 'Milk & dairy', 'Egg and Egg Products': 'Eggs', 'Edible Oils and Fats': 'Fats & oils',
};
const csv = parseCSV(fs.readFileSync(path.join(SRC, 'ifct2017-compositions.csv'), 'utf8'));
const header = csv[0].map((h) => h.split('; ')[1]);
const col = (r, c) => r[header.indexOf(c)];
const num = (s) => (s === undefined || s === null || String(s).trim() === '' ? null : Number(s));

const ifct = new Map();
for (const r of csv.slice(1)) {
  if (!r || r.length < 10) continue;
  const code = col(r, 'code'); const grup = col(r, 'grup');
  const g = (c, f = 1) => { const v = num(col(r, c)); return v === null || !Number.isFinite(v) ? null : v * f; };
  const o = {
    protein: g('protcnt'), carbs: g('choavldf'), fat: g('fatce'), satfat: g('fasat'), fibre: g('fibtg'), sugar: g('fsugar'),
    sodium: g('na', 1000), potassium: g('k', 1000), calcium: g('ca', 1000), iron: g('fe', 1000), magnesium: g('mg', 1000),
    zinc: g('zn', 1000), vitc: g('vitc', 1000), folate: g('folsum', 1e6), b12: null,
  };
  const kj = g('enerc');
  let kcal = kj !== null ? kj / 4.184 : null;
  let energyNote = null;
  if ((kcal === null || kcal === 0) && ((o.fat || 0) + (o.protein || 0) + (o.carbs || 0)) > 1) {
    kcal = kcalFromMacros(o); energyNote = 'Energy recomputed from macronutrients (dataset lists 0)';
  }
  o.kcal = kcal;
  // Hindi / English local names
  const lang = col(r, 'lang') || '';
  const aliases = [];
  for (const seg of lang.split(';')) {
    const m = seg.trim().match(/^([A-Za-z.,\s]+?)\.\s*(.+)$/);
    if (!m) continue;
    const tags = m[1].split(',').map((t) => t.trim());
    if (tags.includes('H') || tags.includes('E')) m[2].split(',').forEach((a) => { const t = a.trim(); if (t && t.length < 40) aliases.push(t.toLowerCase()); });
  }
  ifct.set(code, {
    id: `ifct:${code}`, name: col(r, 'name'), aliases: [...new Set(aliases)], group: IFCT_GROUP[grup] || (NONVEG_GROUPS.has(grup) ? 'Meat & fish' : grup),
    src: 'ifct', conf: 'verified', diet: NONVEG_GROUPS.has(grup) ? 'nonveg' : grup === 'Egg and Egg Products' ? 'egg' : 'veg',
    n: o, ref: `IFCT 2017 (NIN), food code ${code}`, energyNote,
  });
}

// ---------- USDA SR Legacy (via tempo-food-db, CC-BY-4.0) ----------
const USDA_GROUP = {
  'Liha ja linnuliha': 'Meat & fish', 'Köögivili': 'Vegetables', 'Leivad ja pagarittooted': 'Breads & bakery', 'Valmistoidud': 'Prepared foods',
  'Magustoidud ja küpsetised': 'Sweets', 'Puuviljad ja marjad': 'Fruits', 'Joogid': 'Drinks', 'Kaunviljad': 'Pulses & legumes',
  'Kala ja mereannid': 'Meat & fish', 'Piimatooted': 'Milk & dairy', 'Rasvad ja õlid': 'Fats & oils', 'Hommikusöögid': 'Breakfast cereals',
  'Teravili ja pasta': 'Grains & flours', 'Supid': 'Soups', 'Snäkid ja suupisted': 'Snacks', 'Pähklid ja seemned': 'Nuts & seeds',
  'Kartulid ja mugulad': 'Vegetables', 'Kastmed ja maitsed': 'Sauces', 'Vürtsid ja maitseained': 'Spices', 'Munad': 'Eggs',
};
const MEAT_RE = /\b(beef|pork|chicken|turkey|ham|bacon|lamb|veal|mutton|goat|fish|tuna|salmon|shrimp|prawn|crab|sausages?|meat|meatballs?|anchov\w*|lard|gelatin|frankfurter|bologna|pepperoni|salami|duck|goose|venison|bison|liver|oysters?|clams?|lobster|sardines?|cod|mackerel|herring|squid|octopus|scallops?|mussels?|caviar|roe|jerky|hot ?dogs?|chorizo|pastrami|corned|broth|gravy|carp|trout|tilapia|catfish|halibut|pollock|haddock|surimi|bratwurst|kielbasa|pate|rabbit|quail|pheasant|emu|ostrich|elk|moose|caribou|whale|seal|turtle|frog|snail|giblets|tripe|tongue)\b/i;
const EGG_RE = /\b(eggs?|egg\b|mayonnaise|meringue|custard|omelet)/i;
const usdaRows = JSON.parse(fs.readFileSync(path.join(SRC, 'usda-sr-legacy-via-tempo.json'), 'utf8'));
const usda = new Map();
for (const x of usdaRows) {
  const n = {
    kcal: x.kcal_per_100g, protein: x.protein_g, carbs: x.carbs_g, fat: x.fat_g, satfat: x.saturated_fat_g, fibre: x.fiber_g,
    sugar: x.sugar_g, sodium: x.salt_g === null || x.salt_g === undefined ? null : x.salt_g * 400,
    potassium: null, calcium: null, iron: null, magnesium: null, zinc: null, vitc: null, folate: null, b12: null,
  };
  const grp = USDA_GROUP[x.category] || 'Other';
  let diet = 'veg';
  if (grp === 'Meat & fish' || MEAT_RE.test(x.name)) diet = 'nonveg';
  else if (grp === 'Eggs' || EGG_RE.test(x.name)) diet = 'egg';
  const id = `usda:${x.name}`;
  if (usda.has(id)) continue; // duplicate names in source: keep first
  usda.set(id, { id, name: x.name, aliases: [], group: grp, src: 'usda', conf: 'verified', diet, n, ref: 'USDA FoodData Central, SR Legacy (via TempoLife dataset, CC-BY-4.0)' });
}

// ---------- Labels & chemistry ----------
const labels = new Map();
for (const [id, L] of Object.entries(LABELS)) {
  const base = L.per100ml ? Object.fromEntries(Object.entries(L.per100ml).map(([k, v]) => [k, v / L.density])) : L.per100;
  const n = Object.fromEntries(KEYS.map((k) => [k, base[k] ?? null]));
  labels.set(`label:${id}`, {
    id: `label:${id}`, name: L.name, aliases: L.aliases, group: L.group, src: 'label', conf: L.confidence === 'estimate' ? 'estimate' : 'label', diet: 'veg',
    n, ref: L.ref, url: L.url, portions: L.portions, dp: 0,
  });
}
const SALT = { id: 'chem:salt', name: 'Salt (sodium chloride)', n: Object.fromEntries(KEYS.map((k) => [k, k === 'sodium' ? 39340 : 0])) };

function resolve(ref) {
  if (ref === 'chem:salt') return SALT;
  const f = ref.startsWith('ifct:') ? ifct.get(ref.slice(5)) : ref.startsWith('usda:') ? usda.get(ref) : labels.get(ref);
  if (!f) { problems.push(`Unresolved reference: ${ref}`); return null; }
  return f;
}
const scaleN = (n, g) => Object.fromEntries(KEYS.map((k) => [k, n[k] === null || n[k] === undefined ? null : (n[k] * g) / 100]));
const addN = (a, b) => Object.fromEntries(KEYS.map((k) => [k, a[k] === null || b[k] === null ? null : a[k] + b[k]]));
const zeroN = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

// ---------- Assemble core library ----------
const core = [];
const usedUsda = new Set();

for (const [id, name, ref, aliases, group, portions, dp] of FEATURED) {
  const f = resolve(ref); if (!f) continue;
  if (ref.startsWith('usda:')) usedUsda.add(ref);
  core.push({
    id: `f:${id}`, name, aliases: [...new Set([...aliases, ...(f.aliases || [])])], group, src: f.src, conf: f.conf, diet: f.diet,
    v: vecRound(toVector(f.n)), portions, dp, ref: f.ref, url: f.url, base: f.id, note: f.energyNote || undefined,
  });
}
for (const L of labels.values()) core.push({ id: L.id, name: L.name, aliases: L.aliases, group: L.group, src: 'label', conf: L.conf, diet: 'veg', v: vecRound(toVector(L.n)), portions: L.portions, dp: 0, ref: L.ref, url: L.url });

for (const d of DISHES) {
  let base = zeroN(); const ingList = []; let ok = true;
  for (const [ref, g] of d.ing) {
    const f = resolve(ref); if (!f) { ok = false; break; }
    if (ref.startsWith('usda:')) usedUsda.add(ref);
    base = addN(base, scaleN(f.n, g)); ingList.push([f.name, g]);
  }
  if (!ok) continue;
  let fat = null; let withFat = base;
  if (d.fat) {
    const ff = resolve(d.fat.ref); if (!ff) continue;
    if (d.fat.ref.startsWith('usda:')) usedUsda.add(d.fat.ref);
    const perG = scaleN(ff.n, 1);
    fat = { name: ff.name, label: d.fat.label, def: d.fat.def, choices: d.fat.choices, perG: vecRound(toVector(perG).map((v) => v)) };
    withFat = addN(base, scaleN(ff.n, d.fat.def));
  }
  const per100fixed = Object.fromEntries(KEYS.map((k) => [k, withFat[k] === null ? null : (withFat[k] * 100) / d.cooked]));
  const issues = plausibility(per100fixed).filter((x) => !x.startsWith('Calories (')); // IFCT energy factors differ slightly
  if (issues.length) problems.push(`Dish ${d.id}: ${issues.join('; ')}`);
  core.push({
    id: `d:${d.id}`, name: d.name, aliases: d.aliases, group: d.group, src: 'recipe', conf: 'estimate', diet: 'veg',
    v: vecRound(toVector(per100fixed)), portions: d.portions.map(([l, m]) => [l, r2(m * d.cooked, 1)]), dp: Math.max(0, d.portions.findIndex(([, m]) => m === 1)),
    ref: 'Recipe estimate from IFCT 2017 / USDA ingredient values', note: d.note, restaurant: d.restaurant || undefined,
    recipe: { unitG: d.cooked, base: vecRound(toVector(base)), ing: ingList, fat },
  });
}

// Raw IFCT rows (everything not already featured) — searchable with dataset names
const featuredBases = new Set(core.map((f) => f.base).filter(Boolean));
for (const f of ifct.values()) {
  if (featuredBases.has(f.id)) continue;
  core.push({ id: f.id, name: f.name, aliases: f.aliases, group: f.group, src: 'ifct', conf: 'verified', diet: f.diet, v: vecRound(toVector(f.n)), portions: [['100 g', 100]], dp: 0, ref: f.ref, note: f.energyNote || undefined });
}

// Validate everything
const ids = new Set();
for (const f of core) {
  if (ids.has(f.id)) problems.push(`Duplicate id ${f.id}`); ids.add(f.id);
  const n = fromVector(f.v);
  if (n.kcal === null) problems.push(`${f.id} has no calories`);
  const iss = plausibility(n).filter((x) => !x.startsWith('Calories ('));
  if (iss.length && f.src !== 'ifct') problems.push(`${f.id}: ${iss.join('; ')}`);
  if (!f.portions?.length) problems.push(`${f.id} has no portions`);
}

const usdaOut = [];
for (const f of usda.values()) {
  if (f.n.kcal === null) continue;
  usdaOut.push([f.name, f.group, f.diet[0], vecRound(toVector(f.n)).map((x) => (x === null ? null : Number(x.toFixed(2))))]);
}

const SOURCES = {
  ifct: { label: 'IFCT 2017', long: 'Indian Food Composition Tables 2017, ICMR–National Institute of Nutrition', url: 'https://www.nin.res.in/', terms: 'Values used with attribution for personal, non-commercial use.' },
  usda: { label: 'USDA', long: 'USDA FoodData Central, SR Legacy (via TempoLife dataset, CC-BY-4.0)', url: 'https://fdc.nal.usda.gov/', terms: 'USDA data are public domain. Food nutrition data from TempoLife (tempolife.app), CC-BY-4.0.' },
  label: { label: 'Label', long: 'Manufacturer nutrition label', url: '' },
  recipe: { label: 'Recipe estimate', long: 'Computed from ingredient values using stated recipe assumptions', url: '' },
  off: { label: 'Open Food Facts', long: 'Open Food Facts (crowd-sourced, ODbL)', url: 'https://world.openfoodfacts.org/' },
  user: { label: 'You', long: 'Entered or confirmed by you', url: '' },
  legacy: { label: 'Old app', long: 'Migrated from NutriLedger v2 (values were not sourced)', url: '' },
};

const banner = '// GENERATED by tools/build-library.mjs — do not edit by hand.\n';
fs.writeFileSync(path.join(OUT, 'library-core.js'), `${banner}export const SOURCES = ${JSON.stringify(SOURCES)};\nexport const FOODS = ${JSON.stringify(core)};\n`);
// Compact rows: [name, group, dietInitial(v|e|n), vector]. Expanded by js/core/library.js
fs.writeFileSync(path.join(OUT, 'library-usda.js'), `${banner}export const ROWS = ${JSON.stringify(usdaOut)};\n`);

console.log(`core foods: ${core.length} (featured ${FEATURED.length}, labels ${labels.size}, dishes ${DISHES.length}); usda: ${usdaOut.length}`);
console.log(`sizes: core ${(fs.statSync(path.join(OUT, 'library-core.js')).size / 1024).toFixed(0)} KB, usda ${(fs.statSync(path.join(OUT, 'library-usda.js')).size / 1024).toFixed(0)} KB`);
if (REPORT) {
  const pick = (f, pi = f.dp) => { const g = f.portions[pi][1]; const n = fromVector(f.v); return `${f.portions[pi][0].padEnd(32)} ${String(Math.round(n.kcal * g / 100)).padStart(4)} kcal  P ${(n.protein * g / 100).toFixed(1).padStart(5)}  F ${(n.fat * g / 100).toFixed(1).padStart(5)}  C ${(n.carbs * g / 100).toFixed(1).padStart(5)}  Na ${n.sodium === null ? '  ?' : Math.round(n.sodium * g / 100)}`; };
  for (const f of core.filter((x) => x.src === 'recipe' || x.id.startsWith('f:') || x.src === 'label')) console.log(`${f.name.slice(0, 40).padEnd(40)} | ${pick(f)}`);
}
if (problems.length) { console.error('\nPROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('OK — no problems');
