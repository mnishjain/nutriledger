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
    .replace(/µg|μg|mcg/gi, 'ug')
    .replace(/(?<=\s|^)[TlI|](?=\s?(?:mg|g)\b)/g, '1'); // "Tmg" → "1mg"
}

// ---------------------------------------------------------------------------------------------
// Token-based reader. Works for OCR text, tables copied from web pages (label and value on separate
// lines, tabs or pipes), bullet lists and prose answers ("127 calories, 8.7 g of protein").
// ---------------------------------------------------------------------------------------------

// Nutrient words, longest first. key null = a nutrient we do not store, but which must "own" its number
// so that number is not given to a neighbour (e.g. "Vitamin D 2 mcg", "Cholesterol 0 mg").
const KEYWORDS = [
  [/saturated\s*fat(?:ty\s*acids?)?|saturates|sat\.?\s*fat/iy, 'satfat'],
  [/trans\s*fat(?:ty\s*acids?)?|trans\s*fats?/iy, 'trans'],
  [/mono\s*-?\s*unsaturated(?:\s*fat(?:ty\s*acids?)?)?|mufa/iy, 'mufa'],
  [/poly\s*-?\s*unsaturated(?:\s*fat(?:ty\s*acids?)?)?|pufa/iy, 'pufa'],
  [/unsaturated\s*fat(?:ty\s*acids?)?/iy, null],
  [/omega\s*-?\s*\d/iy, null],
  [/added\s*sugars?|free\s*sugars?/iy, 'addedsugar'],
  [/total\s*sugars?|of\s*which\s*sugars?|sugars?/iy, 'sugar'],
  [/total\s*dietary\s*fib(?:re|er)s?|dietary\s*fib(?:re|er)s?|fib(?:re|er)s?/iy, 'fibre'],
  [/net\s*carb(?:ohydrate)?s?/iy, null],
  [/total\s*carbohydrates?|carbohydrates?|carbs?|available\s*cho/iy, 'carbs'],
  [/proteins?/iy, 'protein'],
  [/total\s*fats?|total\s*lipids?|fats?|lipids?/iy, 'fat'],
  [/cholesterol/iy, null],
  [/sodium|\bna\b/iy, 'sodium'],
  [/salt/iy, 'salt'],
  [/potassium/iy, 'potassium'],
  [/calcium/iy, 'calcium'],
  [/iron/iy, 'iron'],
  [/magnesium/iy, 'magnesium'],
  [/zinc/iy, 'zinc'],
  [/vitamin\s*c\b|ascorbic\s*acid/iy, 'vitc'],
  [/vitamin\s*[a-z]\s*\d*|folate|folic\s*acid|caffeine|water|moisture|ash/iy, null],
  [/energy|calories|calorie|kilocalories|kcal(?![a-z])/iy, 'kcal'],
];
const MG_KEYS = new Set(['sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'vitc']);

// Number followed by an optional unit. Not glued to a preceding letter/digit (so "B12", "Omega3" are skipped).
const NUM_RE = /(?<![A-Za-z\d.])(\d+(?:\.\d+)?)\s*(kilocalories|kcals?|kj|milligrams?|micrograms?|mg|ug|grams?|gms?|g(?![a-z])|cal(?![a-z])|%)?/giy;
const unitOf = (u) => {
  const x = (u || '').toLowerCase();
  if (!x) return '';
  if (x.startsWith('kilocal') || x.startsWith('kcal') || x === 'cal') return 'kcal';
  if (x === 'kj') return 'kj';
  if (x.startsWith('milligram') || x === 'mg') return 'mg';
  if (x.startsWith('microgram') || x === 'ug') return 'ug';
  if (x === '%') return '%';
  return 'g';
};

/** Split text into nutrient-word tokens and number tokens, in order. */
function tokenize(text) {
  const toks = []; let i = 0;
  const isWordChar = (c) => /[a-z]/i.test(c || '');
  while (i < text.length) {
    const ch = text[i];
    if (/\d/.test(ch)) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(text);
      if (m && m.index === i) {
        toks.push({ t: 'num', pos: i, end: i + m[0].length, v: Number(m[1]), unit: unitOf(m[2]), raw: m[0].trim() });
        i += m[0].length; continue;
      }
    }
    if (isWordChar(ch) && !isWordChar(text[i - 1])) {
      let hit = null;
      for (const [re, key] of KEYWORDS) {
        re.lastIndex = i;
        const m = re.exec(text);
        if (m && m.index === i && !isWordChar(text[i + m[0].length])) {
          hit = { t: 'kw', pos: i, end: i + m[0].length, key, word: m[0] };
          const lu = text.slice(hit.end, hit.end + 12).match(/^\s*[([]\s*(kj|kcal|cal|g|gm|mg|mcg|ug|µg)\s*[)\]]/i); // "Energy (kJ)", "Sodium (mg)"
          if (lu) { hit.labelUnit = unitOf(lu[1].replace(/mcg|µg/i, 'ug')); hit.end += lu[0].length; }
          break;
        }
      }
      if (hit) { toks.push(hit); i = hit.end; continue; }
    }
    i++;
  }
  return toks;
}

/** Can a number with this unit be the value of this nutrient? Returns 0 (no), 0.6 (unit-less) or 1 (unit fits). */
function fits(key, n) {
  if (n.unit === '%') return 0;
  if (key === 'kcal') return n.unit === 'kcal' || n.unit === 'kj' ? 1 : n.unit === '' ? 0.6 : 0;
  if (MG_KEYS.has(key)) return n.unit === 'mg' || n.unit === 'ug' ? 1 : n.unit === 'g' ? 0.5 : n.unit === '' ? 0.6 : 0;
  if (key === 'salt' || key === null) return n.unit === 'kcal' || n.unit === 'kj' ? 0 : 1;
  return n.unit === 'g' ? 1 : n.unit === 'mg' ? 0.5 : n.unit === '' ? 0.6 : 0;
}
function toStdUnit(key, n) {
  if (key === 'kcal') return n.unit === 'kj' ? n.v / 4.184 : n.v;
  if (MG_KEYS.has(key)) return n.unit === 'g' ? n.v * 1000 : n.unit === 'ug' ? n.v / 1000 : n.v;
  return n.unit === 'mg' ? n.v / 1000 : n.v;
}

/** Numbers that describe the BASIS ("per 100 g", "100 grams of", "serving size 55 g", "8 servings") are not values. */
function markBasis(text, toks) {
  const lineOf = (pos) => { const a = text.lastIndexOf('\n', pos - 1) + 1; const b = text.indexOf('\n', pos); return text.slice(a, b < 0 ? text.length : b); };
  for (let i = 0; i < toks.length; i++) {
    const n = toks[i]; if (n.t !== 'num') continue;
    const before = text.slice(Math.max(0, n.pos - 14), n.pos).toLowerCase();
    const after = text.slice(n.end, n.end + 16).toLowerCase();
    const line = lineOf(n.pos);
    const lineHasKw = toks.some((k) => k.t === 'kw' && k.key !== undefined && k.pos >= text.lastIndexOf('\n', n.pos - 1) + 1 && k.pos < n.pos + line.length && lineOf(k.pos) === line);
    const inParens = /\(\s*$/.test(before) && /^\s*\)/.test(text.slice(n.end, n.end + 3)) && (n.unit === 'g' || /^\s*ml/.test(after));
    if (/^\s*(?:servings?|serves|portions?|pieces?|per\s+container)/.test(after)) n.basis = true;
    else if (inParens && !/(protein|fat|carb|fib|sugar|sodium|salt|energy|calor)[a-z]*\s*\(\s*$/i.test(before)) n.basis = true; // "1 cup (240 g)"
    else if (n.unit !== '%' && /(?:^|[^a-z])(per|every|in|for|a|an|each)\s*$/.test(before) && (n.unit === 'g' || /^\s*-?\s*(?:ml|millilit)/.test(after) || /^\s*-?\s*(?:gram|g\b)/.test(after))) n.basis = true;
    else if ((n.unit === 'g' || /^\s*ml/.test(after)) && /^\s*(?:of\b|serving|portion|-\s*gram|-\s*g\b)/.test(after) && n.v >= 25 && !lineHasKw) n.basis = true;
    else if (n.v === 100 && (n.unit === 'g' || /^\s*ml/.test(after)) && /^\s*(?:of\b|serving|portion|edible)/.test(after)) n.basis = true;
    else if (!lineHasKw && /serving|serve\s*size|portion\s*size|per\s+(?:100|serv|pack|portion)|amount\s+per|container/i.test(line)) n.basis = true;
  }
  // "1 cup (228 g)" style: number inside brackets on a serving line
  return toks.filter((t) => !(t.t === 'num' && t.basis));
}

/**
 * Assign numbers to nutrient words in one direction.
 * forward:  "Protein 8.5 g" / "Protein\n8.5 g" / "Protein: 8.5 g | 2.6 g" (column chosen by colIdx)
 * backward: "8.7 g of protein", "127 calories"
 */
function assign(toks, dir, colIdx) {
  const out = {}; let score = 0;
  const kwIdx = toks.map((t, i) => (t.t === 'kw' ? i : -1)).filter((i) => i >= 0);
  kwIdx.forEach((ki, j) => {
    const kw = toks[ki];
    const lo = dir === 'fwd' ? ki + 1 : (j > 0 ? kwIdx[j - 1] + 1 : 0);
    const hi = dir === 'fwd' ? (j + 1 < kwIdx.length ? kwIdx[j + 1] : toks.length) : ki;
    let nums = toks.slice(lo, hi).filter((t) => t.t === 'num')
      .map((t) => (t.unit === '' && kw.labelUnit && dir === 'fwd' ? { ...t, unit: kw.labelUnit } : t))
      .filter((t) => fits(kw.key, t) > 0);
    if (dir === 'bwd') nums = nums.slice(-1);
    if (!nums.length) return;
    let pick;
    if (kw.key === 'kcal') {
      const kc = nums.filter((n) => n.unit === 'kcal'); const kj = nums.filter((n) => n.unit === 'kj');
      const pool = kc.length ? kc : kj.length ? kj : nums;
      pick = pool[colIdx > 0 ? Math.min(colIdx, pool.length - 1) : 0];
    } else pick = nums[colIdx > 0 ? Math.min(colIdx, nums.length - 1) : 0];
    if (kw.key === null) return; // ignored nutrient: it just keeps its number away from others
    if (out[kw.key] && !(kw.key === 'kcal' && out.kcal.n.unit === 'kj' && pick.unit === 'kcal')) return;
    out[kw.key] = { n: pick, kw };
    score += fits(kw.key, pick);
  });
  if (!out.kcal) {
    const used = new Set(Object.values(out).map((o) => o.n));
    const e = toks.find((t) => t.t === 'num' && !used.has(t) && t.unit === 'kcal') || toks.find((t) => t.t === 'num' && !used.has(t) && t.unit === 'kj');
    if (e) { out.kcal = { n: e, kw: { pos: e.pos } }; score += 1; }
  }
  const v = (k) => (out[k] ? toStdUnit(k, out[k].n) : null);
  if ([v('kcal'), v('protein'), v('carbs'), v('fat')].every((x) => x !== null) && v('kcal') > 20) {
    const err = Math.abs(4 * v('protein') + 4 * v('carbs') + 9 * v('fat') - v('kcal')) / v('kcal');
    if (err < 0.2) score += 3;
  }
  return { out, score };
}

/** Detect column order and serving size from headers like "Per 100 g | Per serve (30 g) | %RDA" or "Serving size 2/3 cup (55g)". */
function detectColumns(lines) {
  let servingG = null; let order = null; let any100 = false;
  lines.forEach((l, i) => {
    const low = l.toLowerCase();
    if (/serving\s*size|serve\s*size|portion\s*size|per\s*serv(?:e|ing)|per\s*portion/.test(low) && !servingG) {
      const all = [...low.matchAll(/(\d+(?:\.\d+)?)\s*(?:g|gm|ml)\b/g)];
      const par = low.match(/\((\d+(?:\.\d+)?)9\)/); // "(559)" = "(55g)" with g read as 9
      if (all.length) servingG = Number(all[all.length - 1][1]);
      else if (par) servingG = Number(par[1]);
      else if (/^serving\s*size:?$/.test(low.trim()) && lines[i + 1]) { const n = [...lines[i + 1].toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(?:g|gm|ml)\b/g)]; if (n.length) servingG = Number(n[n.length - 1][1]); }
    }
    const i100 = low.search(/(per\s*)?100\s*(g|ml|gm)/);
    if (i100 >= 0) any100 = true;
    const iServ = low.search(/per\s*serv|per\s*portion|per\s*pack/);
    if (i100 >= 0 && iServ >= 0 && !order) order = i100 < iServ ? ['p100', 'serv'] : ['serv', 'p100'];
    else if (i100 >= 0 && !order) order = ['p100'];
    else if (iServ >= 0 && !order && low.includes('per')) order = ['serv'];
  });
  if (!order && !servingG && !any100) {
    // "One medium banana (118 g) provides …", "1 cup (240 ml) of milk has …"
    for (const l of lines) {
      const m = l.match(/\((\d+(?:\.\d+)?)\s*(?:g|gm|grams?|ml)\)/i);
      if (m && !/(protein|fat|carb|fib|sugar|sodium|salt|energy|calor)[a-z]*\s*\(\s*\d/i.test(l.slice(0, m.index + 2))) { servingG = Number(m[1]); break; }
    }
  }
  if (!order && servingG && !any100) order = ['serv']; // e.g. US panel with only "Serving size … (55g)"
  return { order: order || ['p100'], servingG };
}

/** source: 'ocr' (photo; OCR-error repairs on) or 'text' (typed/pasted; no OCR repairs, only consistency checks). */
export function parseLabel(text, { source = 'ocr' } = {}) {
  const ocr = source !== 'text';
  let ranges = false;
  const cleaned = cleanOcr(text)
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2') // 1,200 mg → 1200 mg
    .replace(/(calories|energy)\s*from\s*fat\s*:?\s*\d+(\.\d+)?\s*(kcal|kj)?/gi, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)(?=\s*(?:kcal|kj|mg|g\b|grams?|milligrams?|calories|%|\s))/gi, (m, a, b) => {
      const x = Number(a); const y = Number(b);
      if (!(y > x) || y > x * 3) return m;
      ranges = true; return String(Math.round(((x + y) / 2) * 100) / 100);
    })
    .replace(/[•·▪●*_#>]/g, ' ');
  const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter((l) => l && !/^%?\s*daily\s*values?\b/i.test(l));
  const { order, servingG } = detectColumns(lines);
  const colIdx = order.indexOf('p100');
  const flat = lines.join('\n');
  const toks = markBasis(flat, tokenize(flat));
  const fwd = assign(toks, 'fwd', colIdx);
  const bwd = assign(toks, 'bwd', colIdx);
  const chosen = bwd.score > fwd.score + 0.5 ? bwd : fwd;
  const fields = {}; const warnings = [];
  if (ranges) warnings.push('Some values were given as ranges; the middle value was used.');
  const basis = colIdx < 0 ? 'serv' : 'p100';
  for (const [key, { n, kw }] of Object.entries(chosen.out)) {
    const value = toStdUnit(key, n);
    const lineStart = flat.lastIndexOf('\n', kw.pos - 1) + 1; const lineEnd = flat.indexOf('\n', kw.pos);
    fields[key] = { value, raw: flat.slice(lineStart, lineEnd < 0 ? flat.length : lineEnd), basis, tok: n.raw, num: n.v, factor: n.v ? value / n.v : 1, fromKj: key === 'kcal' && n.unit === 'kj' };
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
  if (ocr && withDec.length >= 3 && withDec.length / gramKeys.length >= 0.8) for (const k of gramKeys) if (!withDec.includes(k) && per100[k] >= 10) suspicious.push(k);
  // Energy checksum: the label's own calories should match 4·protein + 4·carbs + 9·fat (±15%).
  // If not, try the most common OCR error (a dropped decimal point, i.e. value ×10) on each macro.
  const corrections = [];
  if ([per100.kcal, per100.protein, per100.carbs, per100.fat].every(isNum) && per100.kcal > 40) {
    const err = (p, c, f) => Math.abs(4 * p + 4 * c + 9 * f - per100.kcal) / per100.kcal;
    if (!ocr && err(per100.protein, per100.carbs, per100.fat) > 0.2) {
      suspicious.push('kcal');
      warnings.push('Calories do not match protein, carbs and fat (4/4/9 kcal per gram). The source may be inconsistent; check it.');
    } else if (ocr && err(per100.protein, per100.carbs, per100.fat) > 0.15) {
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
  if (ocr) for (const k of ['protein', 'carbs', 'fat', 'satfat', 'fibre', 'sugar']) if (isNum(per100[k]) && /\.\d{2,}/.test(String(fields[k]?.value ?? '')) && per100[k] >= 1) suspicious.push(k);
  if (isNum(per100.satfat) && isNum(per100.fat) && per100.satfat > per100.fat) suspicious.push('satfat');
  if (isNum(per100.sugar) && isNum(per100.carbs) && per100.sugar > per100.carbs) suspicious.push('sugar');
  if (suspicious.length && ocr) warnings.push(`Check these carefully – they look misread: ${[...new Set(suspicious)].join(', ')}`);
  else if (suspicious.length) warnings.push(`Check the highlighted values: ${[...new Set(suspicious)].join(', ')}.`);
  const found = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'satfat', 'fibre', 'sodium'].filter((k) => isNum(per100[k]));
  return { per100, fields, basis: servingOnly ? 'perServing' : 'per100', servingG, suspicious: [...new Set(suspicious)], found, warnings, order };
}

/**
 * Likely true readings of an OCR number token, with a penalty (0 = as read).
 * Common OCR errors on labels: unit "g" read as a trailing 9 ("23 g" → "239g", "1.1 g" → "119"),
 * and a lost decimal point ("27.0" → "270").
 */
export function tokenCandidates(tok) {
  const m = String(tok).match(/^(\d+(?:\.\d+)?)\s*([a-z%]*)$/i);
  if (!m) return [];
  const num = m[1]; const unit = m[2].toLowerCase();
  const out = new Map();
  const add = (str, pen) => { const v = Number(str); if (Number.isFinite(v) && (!out.has(v) || out.get(v) > pen)) out.set(v, pen); };
  const noUnit = unit === '';
  // "27.09" with no unit: labels almost never print 2 decimals, so the trailing 9 is almost certainly the "g"
  const twoDecNine = noUnit && /\.\d+9$/.test(num);
  add(num, twoDecNine ? 0.7 : 0);
  const strip9 = num.endsWith('9') && num.replace('.', '').length >= 2 ? num.slice(0, -1).replace(/\.$/, '') : null;
  if (strip9) add(strip9, twoDecNine ? 0.2 : noUnit ? 0.5 : 1);
  const dec = (s2) => (s2 && !s2.includes('.') && s2.length >= 2 ? `${s2.slice(0, -1)}.${s2.slice(-1)}` : null);
  if (dec(num)) add(dec(num), 1);
  if (strip9 && dec(strip9)) add(dec(strip9), noUnit ? 1.2 : 1.6);
  return [...out.entries()].map(([v, pen]) => ({ v, pen }));
}

/**
 * Combine one or more OCR reads of the same label into the most consistent set of values.
 * Uses the label's own calories as a checksum for protein/carbs/fat and simple physical rules
 * (sat fat ≤ fat, sugar ≤ carbs, fibre ≤ carbs). Anything corrected or disagreed on is flagged.
 */
export function combineReads(texts) {
  const reads = texts.map((t) => parseLabel(t));
  if (reads.length === 1 && !reads[0].found.length) return reads[0];
  const keys = new Set(reads.flatMap((r) => Object.keys(r.fields)));
  const cand = {}; const readCount = {};
  for (const k of keys) {
    const m = new Map(); readCount[k] = 0;
    for (const r of reads) {
      const f = r.fields[k]; if (!f) continue; readCount[k]++;
      const list = f.tok ? tokenCandidates(f.tok) : [{ v: f.num ?? f.value, pen: 0 }];
      for (const c of list) {
        const v = Number((c.v * (f.factor ?? 1)).toFixed(4));
        const cur = m.get(v); m.set(v, cur ? { pen: Math.min(cur.pen, c.pen), votes: cur.votes + 1 } : { pen: c.pen, votes: 1 });
      }
    }
    cand[k] = [...m.entries()].map(([v, x]) => ({ v, pen: x.pen - 0.45 * (x.votes - 1), votes: x.votes })).sort((a, b) => a.pen - b.pen).slice(0, 6);
  }
  const best = (k, ok = () => true, soft = () => 0) => (cand[k] || []).filter((c) => ok(c.v)).map((c) => ({ ...c, score: c.pen + soft(c.v) }))
    .sort((a, b) => a.score - b.score || a.pen - b.pen)[0] || null;
  const chosen = {};
  const kc = best('kcal'); if (kc) chosen.kcal = kc;
  if (kc && cand.protein && cand.carbs && cand.fat) {
    let top = null;
    for (const p of cand.protein) for (const c of cand.carbs) for (const f of cand.fat) {
      if (p.v > 100 || c.v > 100 || f.v > 100 || p.v + c.v + f.v > 105) continue;
      const err = Math.abs(4 * p.v + 4 * c.v + 9 * f.v - kc.v) / Math.max(kc.v, 1);
      const score = 12 * err + p.pen + c.pen + f.pen;
      if (!top || score < top.score) top = { score, err, p, c, f };
    }
    if (top && top.err < 0.25) Object.assign(chosen, { protein: top.p, carbs: top.c, fat: top.f });
  }
  for (const k of ['protein', 'carbs', 'fat']) if (!chosen[k] && cand[k]) chosen[k] = best(k, (v) => v <= 100);
  const lim = (k) => chosen[k]?.v;
  for (const k of keys) {
    if (chosen[k]) continue;
    let ok = (v) => true; let soft = () => 0;
    if (k === 'satfat' && isNum(lim('fat'))) ok = (v) => v <= lim('fat') + 0.1;
    if (k === 'sugar' && isNum(lim('carbs'))) ok = (v) => v <= lim('carbs') + 0.5;
    // Fibre is part of carbs on US/Google-style panels; Indian labels may list it separately, so this is only a strong hint
    if (k === 'fibre' && isNum(lim('carbs'))) soft = (v) => (v > lim('carbs') + 0.5 ? 0.9 : 0);
    if (MAX[k]) { const prev = ok; ok = (v) => prev(v) && v <= MAX[k]; }
    chosen[k] = best(k, ok, soft) || best(k);
  }
  // Serving size: majority across reads
  const servs = reads.map((r) => r.servingG).filter((x) => x > 0);
  const servingG = servs.length ? servs.sort((a, b) => servs.filter((x) => x === b).length - servs.filter((x) => x === a).length)[0] : null;
  const order = reads.find((r) => r.order)?.order || ['p100'];
  const servingOnly = order.length === 1 && order[0] === 'serv';
  const warnings = []; const suspicious = [];
  const per100 = {};
  for (const [k, c] of Object.entries(chosen)) {
    if (!c) continue;
    let v = c.v;
    if (servingOnly) { if (servingG > 0) v = (v * 100) / servingG; }
    per100[k] = v;
    const unanimous = c.votes === readCount[k] && c.pen <= 0;
    if (!unanimous && ['kcal', 'protein', 'carbs', 'fat', 'satfat', 'sugar', 'fibre', 'sodium', 'potassium', 'calcium', 'iron'].includes(k)) suspicious.push(k);
  }
  if (servingOnly && !(servingG > 0)) warnings.push('Values appear to be per serving but the serving size was not found. Enter values per 100 g manually.');
  if (servingOnly && new Set(servs).size > 1) warnings.push(`Serving size was read differently in different passes; using ${servingG} g. Please check.`);
  if (!isNum(per100.sodium) && isNum(per100.salt)) per100.sodium = (per100.salt / 2.5) * 1000;
  if (suspicious.length) warnings.push(`Check the highlighted values against the picture: ${suspicious.join(', ')}.`);
  const found = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'satfat', 'fibre', 'sodium'].filter((k) => isNum(per100[k]));
  return { per100, fields: reads[0].fields, basis: servingOnly ? 'perServing' : 'per100', servingG, suspicious, found, warnings, order, passes: reads.length };
}

/** True when a single read is internally consistent enough that extra OCR passes are unnecessary. */
export function looksClean(r) {
  const v = r.per100;
  if (![v.kcal, v.protein, v.carbs, v.fat].every(isNum) || r.suspicious.length) return false;
  return Math.abs(4 * v.protein + 4 * v.carbs + 9 * v.fat - v.kcal) / Math.max(v.kcal, 1) < 0.15;
}
