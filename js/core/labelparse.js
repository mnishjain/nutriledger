// Parse OCR text of a nutrition panel into per-100 g values.
// The result is ALWAYS shown to the user for confirmation; nothing is saved automatically.
import { isNum } from './nutrients.js';

const FIELDS = [
  // order matters: more specific first
  ['satfat', /saturat/i],
  ['trans', /trans/i],
  ['mufa', /mono/i],
  ['pufa', /poly/i],
  ['addedsugar', /added\s*sugar/i],
  ['sugar', /sugar/i],
  ['fibre', /fib(re|er)|dietary/i],
  ['carbs', /carbo|carbs/i],
  ['protein', /prote/i],
  ['fat', /\bfat\b|total\s*fat|fats\b/i],
  ['cholesterol', /cholest/i],
  ['sodium', /sodium/i],
  ['salt', /\bsalt\b/i],
  ['potassium', /potass/i],
  ['calcium', /calcium/i],
  ['iron', /\biron\b/i],
  ['magnesium', /magnes/i],
  ['zinc', /\bzinc\b/i],
  ['vitc', /vitamin\s*c\b|ascorbic/i],
  ['kcal', /energy|calorie|kcal/i],
];
// Upper bounds per 100 g used to catch OCR mistakes such as "12g" read as "129"
const MAX = { kcal: 950, protein: 100, carbs: 100, sugar: 100, fibre: 80, fat: 100, satfat: 100, sodium: 40000, potassium: 10000, calcium: 5000, iron: 200, magnesium: 2000, zinc: 200, vitc: 5000 };
const UNIT_FOR = { sodium: 'mg', potassium: 'mg', calcium: 'mg', iron: 'mg', magnesium: 'mg', zinc: 'mg', vitc: 'mg', kcal: 'kcal' };

export function cleanOcr(text) {
  return String(text || '')
    .replace(/(\d)[oO](?=\d|\s|g|$)/g, '$10')
    .replace(/(?<=\d)[,](?=\d{1,2}\b)/g, '.') // 8,5 g → 8.5 g
    .replace(/(?<=\s|^)[oO](?=\.\d)/g, '0')
    .replace(/(?<=\d)\s+\.(?=\d)/g, '.')
    .replace(/[|]/g, ' ')
    .replace(/(\d)\s?[¢§]/g, '$1 g') // OCR reads "g" as ¢ or §
    .replace(/µg|μg|mcg/gi, 'ug');
}

const NUM_RE = /(\d+(?:\.\d+)?)\s*(kcal|kj|mg|ug|g|%)?/gi;

function numbersIn(line) {
  const out = []; let m; NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(line))) out.push({ v: Number(m[1]), unit: (m[2] || '').toLowerCase(), raw: m[0] });
  return out;
}

/** Detect column order from header lines like "Per 100 g   Per serve (30 g)   %RDA". */
function detectColumns(lines) {
  let servingG = null; let order = null;
  for (const l of lines) {
    const low = l.toLowerCase();
    const sm = low.match(/(?:per\s*serv(?:e|ing)|serving\s*size|per\s*portion)[^\d]{0,15}(\d+(?:\.\d+)?)\s*(g|ml)/);
    if (sm && !servingG) servingG = Number(sm[1]);
    const i100 = low.search(/(per\s*)?100\s*(g|ml|gm)/);
    const iServ = low.search(/per\s*serv|per\s*portion|per\s*pack/);
    if (i100 >= 0 && iServ >= 0 && !order) order = i100 < iServ ? ['p100', 'serv'] : ['serv', 'p100'];
    else if (i100 >= 0 && !order) order = ['p100'];
    else if (iServ >= 0 && !order && low.includes('per')) order = ['serv'];
  }
  return { order: order || ['p100'], servingG };
}

export function parseLabel(text) {
  const lines = cleanOcr(text).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const { order, servingG } = detectColumns(lines);
  const colIdx = order.indexOf('p100');
  const fields = {}; const warnings = [];
  for (const line of lines) {
    const field = FIELDS.find(([, re]) => re.test(line));
    if (!field) continue;
    const key = field[0];
    if (fields[key] && key !== 'kcal') continue; // first occurrence wins (kcal may refine)
    let nums = numbersIn(line).filter((x) => x.unit !== '%');
    // drop numbers that are part of the nutrient name e.g. "Vitamin B12", "Omega 3"
    if (!nums.length) continue;
    let pick; let basis = 'p100';
    if (key === 'kcal') {
      const kc = nums.filter((x) => x.unit === 'kcal');
      const kj = nums.filter((x) => x.unit === 'kj');
      const unitless = nums.filter((x) => !x.unit);
      const pool = kc.length ? kc : kj.length ? kj : unitless;
      const idx = colIdx >= 0 ? Math.min(colIdx, pool.length - 1) : 0;
      pick = pool[idx];
      if (colIdx < 0) basis = 'serv';
      if (!pick) continue;
      let v = pick.v;
      if (pick.unit === 'kj' || (!kc.length && /kj/i.test(line) && !/kcal/i.test(line))) v = v / 4.184;
      fields.kcal = { value: v, raw: line };
    } else {
      const idx = colIdx >= 0 ? Math.min(colIdx, nums.length - 1) : 0;
      if (colIdx < 0) basis = 'serv';
      pick = nums[idx];
      let v = pick.v; const unit = pick.unit;
      const want = UNIT_FOR[key] || 'g';
      if (want === 'mg' && unit === 'g') v *= 1000;
      if (want === 'mg' && unit === 'ug') v /= 1000;
      if (want === 'g' && unit === 'mg') v /= 1000;
      fields[key] = { value: v, raw: line, basis, tok: pick.raw.trim() };
    }
  }
  // Convert per-serving to per-100 g when that is the only column
  const servingOnly = order.length === 1 && order[0] === 'serv';
  const per100 = {};
  for (const [k, f] of Object.entries(fields)) {
    let v = f.value;
    if (servingOnly) {
      if (servingG > 0) v = (v * 100) / servingG;
      else { warnings.push('Values appear to be per serving but the serving size was not found. Enter values per 100 g manually.'); }
    }
    per100[k] = v;
  }
  if (!isNum(per100.sodium) && isNum(per100.salt)) per100.sodium = (per100.salt / 2.5) * 1000;
  const suspicious = [];
  for (const [k, v] of Object.entries(per100)) {
    if (MAX[k] && v > MAX[k]) suspicious.push(k);
  }
  // Formatting consistency: Indian labels print grams with one decimal ("5.0 g"). If most gram values on this
  // label have a decimal point and one does not, its decimal point was probably lost in OCR.
  const gramKeys = ['protein', 'carbs', 'sugar', 'fibre', 'fat', 'satfat'].filter((k) => fields[k]?.tok);
  const withDec = gramKeys.filter((k) => /\d\.\d/.test(fields[k].tok));
  if (withDec.length >= 3) for (const k of gramKeys) if (!withDec.includes(k) && per100[k] >= 10) suspicious.push(k);
  // Energy checksum: the label's own calories should match 4·protein + 4·carbs + 9·fat (±15%).
  // If not, try the most common OCR error (a dropped decimal point, i.e. value ×10) on each macro.
  const corrections = [];
  if ([per100.kcal, per100.protein, per100.carbs, per100.fat].every(isNum) && per100.kcal > 40) {
    const err = (p, c, f) => Math.abs(4 * p + 4 * c + 9 * f - per100.kcal) / per100.kcal;
    if (err(per100.protein, per100.carbs, per100.fat) > 0.15) {
      let best = null;
      for (const dp of [1, 10]) for (const dc of [1, 10]) for (const df of [1, 10]) {
        if (dp === 1 && dc === 1 && df === 1) continue;
        const e = err(per100.protein / dp, per100.carbs / dc, per100.fat / df);
        if (!best || e < best.e) best = { e, dp, dc, df };
      }
      if (best && best.e < 0.08) {
        for (const [k, d] of [['protein', best.dp], ['carbs', best.dc], ['fat', best.df]]) if (d === 10) { corrections.push(`${k} ${per100[k]} → ${per100[k] / 10}`); per100[k] = per100[k] / 10; suspicious.push(k); }
        if (isNum(per100.satfat) && per100.satfat > per100.fat && per100.satfat / 10 <= per100.fat) { corrections.push(`saturated fat ${per100.satfat} → ${per100.satfat / 10}`); per100.satfat /= 10; suspicious.push('satfat'); }
      } else suspicious.push('kcal');
    }
  }
  if (corrections.length) warnings.push(`A decimal point seemed to be missing, so these were corrected using the label's calories: ${corrections.join(', ')}. Please check.`);
  // Gram values with two or more decimals are unusual on Indian labels (often a misread "g")
  for (const k of ['protein', 'carbs', 'fat', 'satfat', 'fibre', 'sugar']) if (isNum(per100[k]) && /\.\d{2,}/.test(String(fields[k]?.value ?? '')) && per100[k] >= 1) suspicious.push(k);
  if (isNum(per100.satfat) && isNum(per100.fat) && per100.satfat > per100.fat) suspicious.push('satfat');
  if (isNum(per100.sugar) && isNum(per100.carbs) && per100.sugar > per100.carbs) suspicious.push('sugar');
  if (suspicious.length) warnings.push(`Check these carefully – they look misread: ${[...new Set(suspicious)].join(', ')}`);
  const found = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'satfat', 'fibre', 'sodium'].filter((k) => isNum(per100[k]));
  return { per100, fields, basis: servingOnly ? 'perServing' : 'per100', servingG, suspicious: [...new Set(suspicious)], found, warnings };
}
