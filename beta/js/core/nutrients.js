// Nutrient definitions and null-aware arithmetic.
// RULE: null/undefined means "unknown". Unknown is never treated as zero.

export const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', dp: 0 },
  { key: 'protein', label: 'Protein', unit: 'g', dp: 1 },
  { key: 'carbs', label: 'Carbohydrates', unit: 'g', dp: 1 },
  { key: 'fat', label: 'Total fat', unit: 'g', dp: 1 },
  { key: 'satfat', label: 'Saturated fat', unit: 'g', dp: 1 },
  { key: 'fibre', label: 'Fibre', unit: 'g', dp: 1 },
  { key: 'sugar', label: 'Total sugar', unit: 'g', dp: 1 },
  { key: 'sodium', label: 'Sodium', unit: 'mg', dp: 0 },
  { key: 'potassium', label: 'Potassium', unit: 'mg', dp: 0 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', dp: 0 },
  { key: 'iron', label: 'Iron', unit: 'mg', dp: 1 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', dp: 0 },
  { key: 'zinc', label: 'Zinc', unit: 'mg', dp: 1 },
  { key: 'vitc', label: 'Vitamin C', unit: 'mg', dp: 0 },
  { key: 'folate', label: 'Folate', unit: 'µg', dp: 0 },
  { key: 'b12', label: 'Vitamin B12', unit: 'µg', dp: 1 },
];
export const KEYS = NUTRIENTS.map((n) => n.key);
export const INFO = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n]));

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Convert a library vector (array in KEYS order) to an object. */
export function fromVector(vec) {
  const o = {};
  KEYS.forEach((k, i) => { const v = vec ? vec[i] : null; o[k] = isNum(v) ? v : null; });
  return o;
}
export function toVector(obj) {
  return KEYS.map((k) => (obj && isNum(obj[k]) ? obj[k] : null));
}

/** Empty nutrient object (all unknown). */
export function unknownAll() { return fromVector(null); }

/** Clean arbitrary input into a nutrient object: numbers >= 0 kept, everything else null. */
export function sanitize(obj) {
  const o = {};
  for (const k of KEYS) {
    let v = obj ? obj[k] : null;
    if (typeof v === 'string') v = v.trim() === '' ? null : Number(v);
    o[k] = isNum(v) && v >= 0 ? v : null;
  }
  return o;
}

/** Scale a nutrient object by a factor (unknown stays unknown). */
export function scale(obj, f) {
  const o = {};
  for (const k of KEYS) o[k] = isNum(obj?.[k]) ? obj[k] * f : null;
  return o;
}

/** Add b to a: if either is unknown the result is unknown (used for a single food = parts). */
export function addStrict(a, b) {
  const o = {};
  for (const k of KEYS) o[k] = isNum(a?.[k]) && isNum(b?.[k]) ? a[k] + b[k] : null;
  return o;
}

/**
 * Sum many items (each a nutrient object) and report coverage.
 * coverage[k] = share of total calories coming from items whose value for k is known.
 * If total calories are 0/unknown, coverage falls back to share of items.
 * Returns { totals, coverage, knownItems, items }.
 * totals[k] is the sum over items where known (a lower bound when coverage < 1),
 * or null when no item has a known value.
 */
export function sumWithCoverage(items) {
  const totals = {}; const coverage = {}; const knownItems = {};
  const kcalAll = items.reduce((s, it) => s + (isNum(it?.kcal) ? it.kcal : 0), 0);
  for (const k of KEYS) {
    let sum = 0; let any = false; let kcalKnown = 0; let n = 0;
    for (const it of items) {
      if (isNum(it?.[k])) { sum += it[k]; any = true; n++; kcalKnown += isNum(it.kcal) ? it.kcal : 0; }
    }
    totals[k] = any ? sum : null;
    knownItems[k] = n;
    if (items.length === 0) coverage[k] = 0;
    else if (kcalAll > 0) coverage[k] = kcalKnown / kcalAll;
    else coverage[k] = n / items.length;
    if (coverage[k] > 1) coverage[k] = 1;
  }
  // kcal coverage is by item count (calorie share is circular)
  coverage.kcal = items.length ? knownItems.kcal / items.length : 0;
  return { totals, coverage, knownItems, items: items.length };
}

export function fmt(key, v) {
  if (!isNum(v)) return '—';
  const dp = INFO[key]?.dp ?? 1;
  const r = Number(v.toFixed(dp));
  return r.toLocaleString('en-IN', { maximumFractionDigits: dp });
}
export function fmtUnit(key, v) {
  if (!isNum(v)) return 'unknown';
  return `${fmt(key, v)} ${INFO[key].unit}`;
}

/** Energy from macros using IFCT/FAO factors (kJ): protein 17, fat 37, available carbohydrate 17, fibre 8. */
export function kcalFromMacros({ protein, fat, carbs, fibre }) {
  if (![protein, fat, carbs].every(isNum)) return null;
  const kj = 17 * protein + 37 * fat + 17 * carbs + 8 * (isNum(fibre) ? fibre : 0);
  return kj / 4.184;
}

/**
 * Plausibility check for per-100 g values. Returns list of problems (empty = plausible).
 */
export function plausibility(per100) {
  const p = [];
  const v = per100 || {};
  if (!isNum(v.kcal)) p.push('Calories missing');
  if (isNum(v.kcal) && v.kcal > 950) p.push('Calories above 950 per 100 g are impossible for food');
  // Carbohydrate may or may not include fibre depending on the source, so fibre is not added here.
  const mass = ['protein', 'carbs', 'fat'].reduce((s, k) => s + (isNum(v[k]) ? v[k] : 0), 0);
  if (mass > 105) p.push('Protein + carbs + fat exceed 100 g per 100 g');
  if (isNum(v.satfat) && isNum(v.fat) && v.satfat > v.fat + 0.5) p.push('Saturated fat exceeds total fat');
  if (isNum(v.sugar) && isNum(v.carbs) && v.sugar > v.carbs + 1) p.push('Sugar exceeds carbohydrates');
  if (isNum(v.sodium) && v.sodium > 40000) p.push('Sodium too high (above pure salt)');
  const est = kcalFromMacros(v);
  if (isNum(est) && isNum(v.kcal) && v.kcal > 40) {
    const diff = Math.abs(est - v.kcal) / v.kcal;
    if (diff > 0.3) p.push(`Calories (${Math.round(v.kcal)}) do not match macros (≈${Math.round(est)})`);
  }
  return p;
}
