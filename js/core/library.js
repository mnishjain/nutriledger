// Runtime access to the built-in food library.
import { FOODS as CORE, SOURCES } from '../data/library-core.js';
import { fromVector } from './nutrients.js';

export { SOURCES };

function expand(f) {
  return {
    id: f.id, name: f.name, aliases: f.aliases || [], group: f.group, src: f.src, conf: f.conf, diet: f.diet || 'veg',
    per100: fromVector(f.v), portions: f.portions, dp: f.dp || 0, ref: f.ref, url: f.url, note: f.note,
    restaurant: !!f.restaurant, recipe: f.recipe ? { unitG: f.recipe.unitG, base: fromVector(f.recipe.base), ing: f.recipe.ing, fat: f.recipe.fat ? { ...f.recipe.fat, perG: fromVector(f.recipe.fat.perG) } : null } : null,
    builtin: true,
  };
}

const coreFoods = CORE.map(expand);
const byId = new Map(coreFoods.map((f) => [f.id, f]));
let usdaFoods = null; let usdaPromise = null;

export function coreLibrary() { return coreFoods; }
export function getBuiltin(id) { return byId.get(id) || null; }

/** Lazily load ~6,000 USDA foods (separate file so first launch is fast). */
export function loadUsda() {
  if (usdaFoods) return Promise.resolve(usdaFoods);
  if (!usdaPromise) {
    usdaPromise = import('../data/library-usda.js').then(({ ROWS }) => {
      const dietMap = { v: 'veg', e: 'egg', n: 'nonveg' };
      usdaFoods = ROWS.filter((r) => !byId.has(`usda:${r[0]}`)).map(([name, group, d, v]) => {
        const f = { id: `usda:${name}`, name, aliases: [], group, src: 'usda', conf: 'verified', diet: dietMap[d], per100: fromVector(v), portions: [['100 g', 100]], dp: 0, ref: SOURCES.usda.long, recipe: null, builtin: true };
        byId.set(f.id, f); return f;
      });
      return usdaFoods;
    }).catch((e) => { usdaPromise = null; throw e; });
  }
  return usdaPromise;
}
export function usdaLoaded() { return usdaFoods; }

/** Which diets a profile's diet setting allows. */
export function dietAllows(profileDiet, foodDiet) {
  if (profileDiet === 'nonveg') return true;
  if (profileDiet === 'egg') return foodDiet !== 'nonveg';
  return foodDiet === 'veg' || !foodDiet; // vegetarian (dairy allowed)
}
