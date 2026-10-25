// Portion → grams → nutrients. Pure functions.
import { scale, KEYS, isNum } from './nutrients.js';

/** Nutrients for `grams` of a food (cooked weight for dishes). fatPerUnit overrides the recipe's default cooking fat. */
export function nutrientsFor(food, grams, fatPerUnit = null) {
  if (!(grams > 0)) throw new RangeError('Quantity must be greater than zero');
  const r = food.recipe;
  if (r && r.fat && fatPerUnit !== null && fatPerUnit !== undefined && fatPerUnit !== r.fat.def) {
    const units = grams / r.unitG;
    const o = {};
    for (const k of KEYS) {
      const b = r.base[k]; const f = r.fat.perG[k];
      o[k] = isNum(b) && isNum(f) ? (b + f * fatPerUnit) * units : null;
    }
    return o;
  }
  return scale(food.per100, grams / 100);
}

/** Grams for a portion choice. */
export function gramsForPortion(food, portionIndex, qty = 1, custom = []) {
  const p = allPortions(food, custom)[portionIndex];
  if (!p) throw new RangeError('Unknown portion');
  if (!(qty > 0)) throw new RangeError('Quantity must be greater than zero');
  return p[1] * qty;
}

/** Built-in portions + user-defined custom portions (deduplicated by label). */
export function allPortions(food, custom = []) {
  const list = [...(food.portions || [])];
  for (const c of custom || []) if (c && c[1] > 0 && !list.some((p) => p[0] === c[0])) list.push(c);
  if (!list.some((p) => p[1] === 1 && /^g/.test(p[0]))) list.push(['grams', 1]);
  return list;
}

export function describeAmount({ qty, portionLabel, grams }) {
  if (portionLabel === 'grams') return `${round1(grams)} g`;
  const q = qty === 1 ? '' : `${round1(qty)} × `;
  return `${q}${portionLabel}`;
}
export const round1 = (n) => Math.round(n * 10) / 10;
