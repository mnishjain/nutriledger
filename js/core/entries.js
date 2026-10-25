// Diary entries and saved meals. Every entry is an immutable SNAPSHOT of nutrients at log time:
// editing or deleting a food or a saved meal later never changes history.
import { nutrientsFor } from './portions.js';
import { scale, sumWithCoverage, sanitize, isNum, KEYS } from './nutrients.js';

export const uid = (p = '') => `${p}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Snapshot of where a value came from, carried by every item. */
export function sourceOf(food) {
  return { src: food.src, conf: food.conf, ref: food.ref || null, foodId: food.id, restaurant: !!food.restaurant };
}

/** One food item (used inside entries and saved meals). */
export function makeItem(food, { grams, qty = 1, portionLabel = 'grams', fatPerUnit = null }) {
  const n = nutrientsFor(food, grams, fatPerUnit);
  const fatInfo = food.recipe?.fat ? { label: food.recipe.fat.label, perUnit: fatPerUnit ?? food.recipe.fat.def } : null;
  return { name: food.name, grams, qty, portionLabel, fat: fatInfo, n, source: sourceOf(food) };
}

export function makeFoodEntry({ profileId, date, slot, item }) {
  const now = Date.now();
  return { id: uid('e-'), profileId, date, slot, kind: 'food', name: item.name, items: [item], n: item.n, mult: 1, createdAt: now, updatedAt: now };
}

/** Manual "quick add" – user-typed totals for one serving. Calories required. */
export function makeQuickEntry({ profileId, date, slot, name, nutrients }) {
  const n = sanitize(nutrients);
  if (!isNum(n.kcal)) throw new Error('Calories are required for a quick entry');
  const item = { name: name || 'Quick add', grams: null, qty: 1, portionLabel: 'serving', fat: null, n, source: { src: 'user', conf: 'user', ref: 'Quick add', foodId: null } };
  const now = Date.now();
  return { id: uid('e-'), profileId, date, slot, kind: 'quick', name: item.name, items: [item], n, mult: 1, createdAt: now, updatedAt: now };
}

/** Saved meal (combination). Items are snapshots; nothing references live foods. */
export function makeMeal({ profileId, name, items, id = null, createdAt = null }) {
  if (!name || !name.trim()) throw new Error('Name the meal');
  if (!items?.length) throw new Error('Add at least one item');
  const now = Date.now();
  return { id: id || uid('m-'), profileId, name: name.trim(), items: items.map(cloneItem), createdAt: createdAt || now, updatedAt: now };
}

export function makeMealEntry({ profileId, date, slot, meal, mult = 1 }) {
  if (!(mult > 0)) throw new RangeError('Servings must be greater than zero');
  const items = meal.items.map((it) => scaleItem(it, mult));
  const now = Date.now();
  return { id: uid('e-'), profileId, date, slot, kind: 'meal', mealId: meal.id, name: meal.name, items, n: totalOf(items), mult, createdAt: now, updatedAt: now };
}

/** Change servings of an existing entry (relative to its original snapshot). */
export function rescaleEntry(entry, newMult) {
  if (!(newMult > 0)) throw new RangeError('Servings must be greater than zero');
  const f = newMult / (entry.mult || 1);
  const items = entry.items.map((it) => scaleItem(it, f));
  return { ...entry, items, n: totalOf(items), mult: newMult, updatedAt: Date.now() };
}

export function scaleItem(it, f) {
  return { ...cloneItem(it), grams: isNum(it.grams) ? it.grams * f : it.grams, qty: isNum(it.qty) ? it.qty * f : it.qty, n: scale(it.n, f) };
}
function cloneItem(it) { return JSON.parse(JSON.stringify(it)); }

/** Display total of items: known values summed (a lower bound if some are unknown). */
export function totalOf(items) {
  return sumWithCoverage(items.map((i) => i.n)).totals;
}

/** All nutrient-bearing items of a day's entries (meal entries contribute their components). */
export function flattenItems(entries) {
  return entries.flatMap((e) => (e.items?.length ? e.items.map((i) => i.n) : [e.n]));
}

export function dayTotals(entries) {
  return sumWithCoverage(flattenItems(entries));
}

/** Copy entries to another date/slot as fresh entries (e.g., "repeat yesterday's lunch"). */
export function copyEntries(entries, { date, slot = null }) {
  const now = Date.now();
  return entries.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: uid('e-'), date, slot: slot || e.slot, createdAt: now, updatedAt: now }));
}

/** Lowest-confidence label across items, for display. */
const RANK = { verified: 0, label: 1, 'label-retailer': 1, off: 2, estimate: 3, user: 2, legacy: 4 };
export function weakestConfidence(items) {
  let worst = 'verified';
  for (const it of items) { const c = it.source?.conf || 'legacy'; if ((RANK[c] ?? 4) > (RANK[worst] ?? 0)) worst = c; }
  return worst;
}
export { KEYS };
