// Validation + sanitisation of backup files before anything touches the database.
import { sanitize, isNum, KEYS } from '../core/nutrients.js';
import { isDateStr, SLOTS } from '../core/dates.js';
import { isLegacyShape, mapLegacy } from './legacy.js';

export const FORMAT = 'nutriledger-backup';
export const FORMAT_VERSION = 3;
const str = (s, max = 160) => (s === null || s === undefined ? '' : String(s).slice(0, max));
const idOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= 120;
const numOr = (v, d = null) => (isNum(Number(v)) && v !== null && v !== '' ? Number(v) : d);

function cleanItem(i) {
  if (!i || typeof i !== 'object') return null;
  return {
    name: str(i.name, 160) || 'Item', grams: numOr(i.grams), qty: numOr(i.qty, 1), portionLabel: str(i.portionLabel, 80) || 'serving',
    fat: i.fat && typeof i.fat === 'object' ? { label: str(i.fat.label, 40), perUnit: numOr(i.fat.perUnit, 0) } : null,
    n: sanitize(i.n),
    source: { src: str(i.source?.src, 20) || 'legacy', conf: str(i.source?.conf, 20) || 'legacy', ref: str(i.source?.ref, 200) || null, foodId: i.source?.foodId ? str(i.source.foodId, 200) : null, restaurant: !!i.source?.restaurant },
  };
}
const cleanPortions = (ps) => (Array.isArray(ps) ? ps.filter((p) => Array.isArray(p) && numOr(p[1]) > 0).slice(0, 20).map((p) => [str(p[0], 60), Number(p[1])]) : []);

const CLEAN = {
  profiles(p) {
    if (!p || !idOk(p.id)) return null;
    return { id: p.id, name: str(p.name, 40) || 'Profile', sex: p.sex === 'female' ? 'female' : 'male', age: numOr(p.age), heightCm: numOr(p.heightCm), weightKg: numOr(p.weightKg),
      activity: str(p.activity, 20) || 'light', goal: str(p.goal, 20) || 'maintain', rateKgWk: numOr(p.rateKgWk, 0.35), training: p.training !== false,
      diet: ['veg', 'egg', 'nonveg'].includes(p.diet) ? p.diet : 'veg', overrides: { kcal: numOr(p.overrides?.kcal) || undefined, protein: numOr(p.overrides?.protein) || undefined },
      useLatestWeight: p.useLatestWeight !== false, createdAt: numOr(p.createdAt, Date.now()), updatedAt: numOr(p.updatedAt, Date.now()) };
  },
  foods(f) {
    if (!f || !idOk(f.id) || !f.name) return null;
    const per100 = sanitize(f.per100);
    if (!isNum(per100.kcal)) return null;
    const portions = cleanPortions(f.portions);
    return { id: f.id, name: str(f.name), brand: str(f.brand, 80), aliases: Array.isArray(f.aliases) ? f.aliases.slice(0, 20).map((a) => str(a, 60)) : [], group: str(f.group, 40) || 'My foods',
      src: str(f.src, 20) || 'user', conf: str(f.conf, 20) || 'user', diet: ['veg', 'egg', 'nonveg'].includes(f.diet) ? f.diet : 'veg', per100,
      portions: portions.length ? portions : [['100 g', 100]], dp: Math.min(numOr(f.dp, 0), Math.max(0, portions.length - 1)), barcode: f.barcode ? str(f.barcode, 20) : null,
      ref: str(f.ref, 200), url: str(f.url, 300), note: str(f.note, 300), userFood: true, archived: !!f.archived, createdAt: numOr(f.createdAt, Date.now()), updatedAt: numOr(f.updatedAt, Date.now()) };
  },
  meals(m) {
    if (!m || !idOk(m.id) || !idOk(m.profileId) || !Array.isArray(m.items)) return null;
    const items = m.items.map(cleanItem).filter(Boolean);
    if (!items.length) return null;
    return { id: m.id, profileId: m.profileId, name: str(m.name, 80) || 'Meal', items, createdAt: numOr(m.createdAt, Date.now()), updatedAt: numOr(m.updatedAt, Date.now()) };
  },
  entries(e) {
    if (!e || !idOk(e.id) || !idOk(e.profileId) || !isDateStr(e.date)) return null;
    const items = Array.isArray(e.items) ? e.items.map(cleanItem).filter(Boolean) : [];
    if (!items.length) return null;
    return { id: e.id, profileId: e.profileId, date: e.date, slot: SLOTS.includes(e.slot) ? e.slot : 'Snacks', kind: ['food', 'meal', 'quick'].includes(e.kind) ? e.kind : 'food',
      mealId: e.mealId ? str(e.mealId, 120) : undefined, name: str(e.name) || items[0].name, items, n: sanitize(e.n), mult: numOr(e.mult, 1),
      createdAt: numOr(e.createdAt, Date.now()), updatedAt: numOr(e.updatedAt, Date.now()) };
  },
  weights(w) {
    if (!w || !idOk(w.profileId) || !isDateStr(w.date) || !(numOr(w.kg) > 0 && numOr(w.kg) < 400)) return null;
    return { id: idOk(w.id) ? w.id : `w-${w.profileId}|${w.date}`, profileId: w.profileId, date: w.date, kg: Number(w.kg), updatedAt: numOr(w.updatedAt, Date.now()) };
  },
  days(d) {
    if (!d || !idOk(d.profileId) || !isDateStr(d.date)) return null;
    return { id: `${d.profileId}|${d.date}`, profileId: d.profileId, date: d.date, complete: !!d.complete, note: str(d.note, 300), updatedAt: numOr(d.updatedAt, Date.now()) };
  },
  stats(t) {
    if (!t || !idOk(t.id) || !idOk(t.profileId) || !idOk(t.foodId)) return null;
    return { id: t.id, profileId: t.profileId, foodId: t.foodId, count: Math.max(0, Math.round(numOr(t.count, 0))), lastUsed: numOr(t.lastUsed, 0), lastPortion: numOr(t.lastPortion, 0), lastPortionLabel: str(t.lastPortionLabel, 80), lastQty: numOr(t.lastQty, null), lastFat: numOr(t.lastFat, null), updatedAt: numOr(t.updatedAt, 0) };
  },
  portions(p) {
    if (!p || !idOk(p.id)) return null;
    return { id: p.id, list: cleanPortions(p.list) };
  },
};
export const STORES_IN_BACKUP = Object.keys(CLEAN);

/**
 * Validate a parsed backup object (v3 or legacy v2).
 * Returns { ok, format, data: {store: records[]}, activeProfileId, counts, rejected, report? , error? }
 */
export function validateBackup(obj) {
  try {
    if (isLegacyShape(obj)) {
      const m = mapLegacy(obj);
      const data = { profiles: m.profiles, foods: m.foods, meals: m.meals, entries: m.entries, weights: m.weights, days: [], stats: [], portions: [] };
      return finish(data, 'legacy-v2', m.activeProfileId, m.report);
    }
    if (!obj || obj.format !== FORMAT || !obj.data || typeof obj.data !== 'object') return { ok: false, error: 'This file is not a NutriLedger backup.' };
    if (Number(obj.version) > FORMAT_VERSION) return { ok: false, error: `This backup was made by a newer version of NutriLedger (format ${obj.version}). Update the app first.` };
    const data = {}; const rejected = {};
    for (const s of STORES_IN_BACKUP) {
      const arr = Array.isArray(obj.data[s]) ? obj.data[s] : [];
      data[s] = []; rejected[s] = 0;
      const seen = new Set();
      for (const r of arr) { const c = CLEAN[s](r); if (c && !seen.has(c.id)) { seen.add(c.id); data[s].push(c); } else rejected[s]++; }
    }
    if (!data.profiles.length) return { ok: false, error: 'Backup contains no profiles.' };
    const pids = new Set(data.profiles.map((p) => p.id));
    for (const s of ['meals', 'entries', 'weights', 'days', 'stats']) {
      const before = data[s].length; data[s] = data[s].filter((r) => pids.has(r.profileId)); rejected[s] += before - data[s].length;
    }
    const active = pids.has(obj.activeProfileId) ? obj.activeProfileId : data.profiles[0].id;
    return finish(data, 'v3', active, null, rejected);
  } catch (e) {
    return { ok: false, error: e.message || 'Backup could not be read.' };
  }
}
function finish(data, format, activeProfileId, report, rejected = {}) {
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  return { ok: true, format, data, activeProfileId, counts, rejected, report };
}
export { KEYS };
