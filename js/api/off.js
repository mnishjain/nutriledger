// Open Food Facts client (free, no key, crowd-sourced, ODbL). Network is optional: the app works without it.
import { relevantExternal } from '../core/search.js';
import { plausibility, isNum, KEYS } from '../core/nutrients.js';

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_en,brands,quantity,serving_size,serving_quantity,nutriments,nutrition_data_per,categories_tags,labels_tags';
const TIMEOUT_MS = 9000;
const cache = new Map();

// OFF nutriment key → [our key, multiplier from OFF unit (g) to ours]
const MAP = {
  'energy-kcal': ['kcal', 1], proteins: ['protein', 1], carbohydrates: ['carbs', 1], fat: ['fat', 1], 'saturated-fat': ['satfat', 1],
  fiber: ['fibre', 1], sugars: ['sugar', 1], sodium: ['sodium', 1000], potassium: ['potassium', 1000], calcium: ['calcium', 1000],
  iron: ['iron', 1000], magnesium: ['magnesium', 1000], zinc: ['zinc', 1000], 'vitamin-c': ['vitc', 1000], 'vitamin-b9': ['folate', 1e6], 'vitamin-b12': ['b12', 1e6],
};

function n(v) { const x = typeof v === 'string' ? Number(v.replace(',', '.')) : v; return isNum(x) ? x : null; }

/** Map an OFF product to a NutriLedger food. Returns { food } or { error }. */
export function mapProduct(p) {
  if (!p) return { error: 'Product not found' };
  const name = (p.product_name_en || p.product_name || '').trim();
  if (!name) return { error: 'Product has no name in Open Food Facts' };
  const nm = p.nutriments || {};
  const per100 = Object.fromEntries(KEYS.map((k) => [k, null]));
  const servingG = n(p.serving_quantity);
  let usedServing = false;
  for (const [offKey, [key, mul]] of Object.entries(MAP)) {
    let v = n(nm[`${offKey}_100g`]);
    if (v === null && servingG > 0 && n(nm[`${offKey}_serving`]) !== null) { v = (n(nm[`${offKey}_serving`]) * 100) / servingG; usedServing = true; }
    per100[key] = v === null ? null : v * mul;
  }
  if (per100.kcal === null) {
    const kj = n(nm['energy-kj_100g']) ?? (nm.energy_unit === 'kJ' ? n(nm.energy_100g) : null);
    if (kj !== null) per100.kcal = kj / 4.184;
  }
  if (per100.sodium === null && n(nm.salt_100g) !== null) per100.sodium = (n(nm.salt_100g) / 2.5) * 1000;
  if (per100.kcal === null) return { error: 'No calorie information on Open Food Facts' };
  for (const k of KEYS) if (per100[k] !== null && per100[k] < 0) per100[k] = null;
  const issues = plausibility(per100);
  const known = KEYS.filter((k) => per100[k] !== null).length;
  const portions = [];
  if (servingG > 0 && servingG < 2000) portions.push([`1 serving (${Math.round(servingG)} g${p.serving_size ? `, “${String(p.serving_size).slice(0, 30)}”` : ''})`, servingG]);
  portions.push(['100 g', 100]);
  const brand = (p.brands || '').split(',')[0].trim();
  return {
    food: {
      id: `off:${p.code || name}`, name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name, brand, aliases: [],
      group: 'Packaged', src: 'off', conf: issues.length ? 'off-doubtful' : 'off', diet: dietFromTags(p), per100, portions, dp: 0,
      barcode: p.code || null, ref: `Open Food Facts product ${p.code || ''}`.trim(), url: p.code ? `${BASE}/product/${p.code}` : BASE,
      quality: { known, total: KEYS.length, issues, fromServing: usedServing, quantity: p.quantity || '' },
    },
  };
}

function dietFromTags(p) {
  const tags = [...(p.labels_tags || []), ...(p.categories_tags || [])].join(' ');
  if (/non-vegetarian|en:meats|en:fish|en:poultry|en:seafood/.test(tags)) return 'nonveg';
  if (/en:eggs\b/.test(tags)) return 'egg';
  return 'veg';
}

async function getJSON(url, fetchImpl) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const r = await fetchImpl(url, { signal: ctl?.signal, headers: { Accept: 'application/json' } });
    if (r.status === 429) throw new Error('Open Food Facts is rate-limiting searches. Wait a minute and try again.');
    if (!r.ok) throw new Error(`Open Food Facts returned HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Open Food Facts did not respond in time');
    if (e instanceof TypeError) throw new Error('No internet connection, or Open Food Facts is unreachable');
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}

/** Text search. Returns { items: food[], dropped: number } — irrelevant or calorie-less products are dropped. */
export async function searchProducts(query, { fetchImpl = globalThis.fetch } = {}) {
  const q = query.trim();
  if (q.length < 2) return { items: [], dropped: 0 };
  const key = `s:${q.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=50&fields=${FIELDS}&app_name=NutriLedger`;
  const data = await getJSON(url, fetchImpl);
  let dropped = 0; const items = []; const seen = new Set();
  for (const p of data.products || []) {
    const name = p.product_name_en || p.product_name || '';
    if (!relevantExternal(q, name, p.brands || '')) { dropped++; continue; }
    const m = mapProduct(p);
    if (m.error) { dropped++; continue; }
    const dedupe = `${m.food.name.toLowerCase()}|${Math.round(m.food.per100.kcal)}`;
    if (seen.has(dedupe)) { dropped++; continue; }
    seen.add(dedupe); items.push(m.food);
  }
  items.sort((a, b) => (b.quality.issues.length === 0) - (a.quality.issues.length === 0) || b.quality.known - a.quality.known);
  const res = { items: items.slice(0, 20), dropped };
  cache.set(key, res);
  return res;
}

/** Barcode lookup. Returns { food } or { error }. */
export async function lookupBarcode(code, { fetchImpl = globalThis.fetch } = {}) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length < 6 || c.length > 14) return { error: 'That does not look like a product barcode' };
  const key = `b:${c}`;
  if (cache.has(key)) return cache.get(key);
  const data = await getJSON(`${BASE}/api/v2/product/${c}.json?fields=${FIELDS}&app_name=NutriLedger`, fetchImpl);
  const res = data.status === 1 || data.product ? mapProduct({ ...data.product, code: data.product?.code || c }) : { error: 'This barcode is not in Open Food Facts yet. Photograph the label instead.' };
  cache.set(key, res);
  return res;
}
export function _clearCache() { cache.clear(); }
