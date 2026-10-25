// Mapping from NutriLedger v2 (localStorage key "nl_mj_v2") to v3 records. Pure function, no I/O.
// The v2 data is never modified or deleted by the app.
import { sanitize, isNum, KEYS } from '../core/nutrients.js';
import { isDateStr } from '../core/dates.js';

export const LEGACY_KEY = 'nl_mj_v2';

// Built-in foods shipped by v2 (values were not sourced). They are replaced by the sourced v3 library,
// so they are not copied as user foods. Historical diary entries keep their original recorded values.
export const LEGACY_SEED_NAMES = new Set([
  'Chapati', 'Ghee', 'Cooked rice', 'Dal cooked', 'Sabzi mixed', 'Curd', 'Roasted chana', 'Peanuts', 'Whey protein', 'Toned milk',
  'High-protein Greek yogurt', 'Tofu firm', 'Low-fat paneer', 'Moong sprouts cooked', 'Aloo paratha', 'Apple', 'Banana', 'Orange',
  'Tea no sugar with milk', 'Rajma cooked', 'Cucumber', 'Potato boiled', 'Quinoa cooked', 'Carrot', 'Makhana', 'Walnuts (akhrot)',
  'Mushrooms', 'Spinach cooked', 'Cashew nuts (kaju)', 'Almonds (badam)', 'Pistachios (pista)', 'Sweet potato',
]);
const OLD_NUTS = { fat: 'fat', carbs: 'carbs', fiber: 'fibre', sugar: 'sugar', sodium: 'sodium', satfat: 'satfat', calcium: 'calcium', iron: 'iron', potassium: 'potassium' };
const SLOT = { Breakfast: 'Breakfast', Lunch: 'Lunch', Dinner: 'Dinner', Snack: 'Snacks', Snacks: 'Snacks' };
const str = (s, max = 120) => String(s ?? '').slice(0, max);

export function isLegacyShape(o) {
  return !!o && Array.isArray(o.profiles) && Array.isArray(o.foods) && Array.isArray(o.entries) && !o.format;
}

function nutrientsOf(o) {
  const n = Object.fromEntries(KEYS.map((k) => [k, null]));
  n.kcal = Number(o.k); n.protein = Number(o.p);
  for (const [oldK, newK] of Object.entries(OLD_NUTS)) if (o[oldK] !== undefined && o[oldK] !== null && o[oldK] !== '') n[newK] = Number(o[oldK]);
  return sanitize(n);
}

export function mapLegacy(old, { now = Date.now() } = {}) {
  if (!isLegacyShape(old)) throw new Error('Not a NutriLedger v2 backup');
  const report = { profiles: 0, entries: 0, meals: 0, weights: 0, userFoods: 0, skippedSeedFoods: 0, duplicateFoodIds: [], skippedEntries: 0, defaultGoalsDetected: [], notes: [] };
  const profiles = []; const pidMap = new Map();
  for (const p of old.profiles) {
    if (!p || !p.id) continue;
    const id = `p-${str(p.id, 40)}`; pidMap.set(p.id, id);
    const isDefault = Number(p.calorieGoal) === 1800 && Number(p.proteinGoal) === 120;
    if (isDefault) report.defaultGoalsDetected.push(str(p.name));
    const overrides = {};
    if (!isDefault) {
      if (Number(p.calorieGoal) > 0) overrides.kcal = Number(p.calorieGoal);
      if (Number(p.proteinGoal) > 0) overrides.protein = Number(p.proteinGoal);
    }
    profiles.push({
      id, name: str(p.name, 40) || 'Me', sex: p.sex === 'female' ? 'female' : 'male', age: Number(p.age) || null,
      heightCm: Number(p.height) || null, weightKg: Number(p.weight) || null, activity: 'light', goal: 'lose', rateKgWk: 0.35,
      training: true, diet: 'veg', overrides, useLatestWeight: true, createdAt: now, updatedAt: now, migratedFrom: 'v2',
    });
    report.profiles++;
  }
  if (!profiles.length) throw new Error('Backup has no profiles');
  const fallbackPid = pidMap.get(old.active) || profiles[0].id;
  const pid = (x) => pidMap.get(x) || fallbackPid;

  // Foods: detect duplicate ids (v2 bug) and keep only genuinely user-created foods
  const seenIds = new Map(); const foods = [];
  for (const f of old.foods) {
    if (!f) continue;
    if (seenIds.has(f.id)) report.duplicateFoodIds.push(`${f.id}: “${seenIds.get(f.id)}” and “${f.name}”`); else seenIds.set(f.id, f.name);
    if (LEGACY_SEED_NAMES.has(f.name)) { report.skippedSeedFoods++; continue; }
    const per100 = nutrientsOf(f);
    if (!isNum(per100.kcal)) continue;
    const grams = Number(f.grams) > 0 ? Number(f.grams) : 100;
    foods.push({
      id: `u-legacy-${foods.length}-${str(f.id, 30)}`, name: str(f.name), aliases: [], group: 'My foods', src: 'legacy', conf: 'legacy', diet: 'veg',
      per100, portions: [[str(f.unit || 'portion', 40) + ` (${grams} g)`, grams], ['100 g', 100]], dp: 0, ref: 'Created in NutriLedger v2', userFood: true, createdAt: now, updatedAt: now,
    });
    report.userFoods++;
  }

  const entries = [];
  for (const e of old.entries) {
    if (!e || !isDateStr(e.date) || !isNum(Number(e.k))) { report.skippedEntries++; continue; }
    const n = nutrientsOf(e);
    const gm = String(e.name || '').match(/\((\d+(?:\.\d+)?)\s*g\)\s*$/);
    const grams = gm ? Number(gm[1]) : null;
    const item = { name: str(e.name), grams, qty: 1, portionLabel: grams ? 'grams' : 'serving', fat: null, n, source: { src: 'legacy', conf: 'legacy', ref: 'Logged in NutriLedger v2', foodId: null } };
    entries.push({ id: `e-legacy-${str(e.id, 60)}`, profileId: pid(e.pid), date: e.date, slot: SLOT[e.slot] || 'Snacks', kind: 'food', name: item.name, items: [item], n, mult: 1, createdAt: Number(String(e.id).split('-')[0]) || now, updatedAt: now, migratedFrom: 'v2' });
    report.entries++;
  }
  const meals = [];
  for (const m of old.meals || []) {
    if (!m || !Array.isArray(m.items) || !m.items.length) continue;
    const items = m.items.map((i) => ({ name: str(i.name), grams: null, qty: 1, portionLabel: 'serving', fat: null, n: nutrientsOf(i), source: { src: 'legacy', conf: 'legacy', ref: 'Saved in NutriLedger v2', foodId: null } }));
    meals.push({ id: `m-legacy-${str(m.id, 60)}`, profileId: pid(m.pid), name: str(m.name) || 'Saved meal', items, createdAt: now, updatedAt: now, migratedFrom: 'v2' });
    report.meals++;
  }
  const weights = []; const wSeen = new Set();
  for (const w of old.weights || []) {
    if (!w || !isDateStr(w.date) || !(Number(w.kg) > 0)) continue;
    const key = `${pid(w.pid)}|${w.date}`; if (wSeen.has(key)) continue; wSeen.add(key);
    weights.push({ id: `w-${key}`, profileId: pid(w.pid), date: w.date, kg: Number(w.kg), updatedAt: now });
    report.weights++;
  }
  if (report.duplicateFoodIds.length) report.notes.push('The old app had foods sharing the same ID, so choosing one food (e.g. Walnuts) could log another (e.g. Cashews). Past entries are kept exactly as they were recorded; please review entries named Cashews, Almonds or Pistachios.');
  if (report.defaultGoalsDetected.length) report.notes.push('Calorie/protein goals were the old defaults (1800 kcal / 120 g), so personalised targets are now calculated instead. You can override them in Profile.');
  return { profiles, foods, meals, entries, weights, activeProfileId: fallbackPid, report };
}
