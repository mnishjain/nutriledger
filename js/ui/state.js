// Application state and data-access helpers shared by all views.
import { localDate } from '../core/dates.js';
import { computeTargets } from '../core/targets.js';
import { coreLibrary, getBuiltin, dietAllows, usdaLoaded } from '../core/library.js';
import { indexFood } from '../core/search.js';

export const app = {
  store: null, profile: null, profiles: [], targets: null,
  date: localDate(), followToday: true, tab: 'today',
  userFoods: [], meals: [], stats: new Map(), customPortions: new Map(),
  index: null, usdaIndex: null, dbName: 'nutriledger', isBeta: false,
  persistence: 'unknown', listeners: new Set(), version: '3.0.0',
};

export function onRefresh(fn) { app.listeners.add(fn); }
export async function refresh(what = 'all') {
  for (const fn of app.listeners) { try { await fn(what); } catch (e) { console.error(e); } }
}

export async function loadProfiles() {
  app.profiles = (await app.store.all('profiles')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const activeId = await app.store.meta('activeProfileId');
  app.profile = app.profiles.find((p) => p.id === activeId) || app.profiles[0] || null;
  if (app.profile && app.profile.id !== activeId) await app.store.setMeta('activeProfileId', app.profile.id);
  await recomputeTargets();
}

/** Targets use the latest logged weight when the profile allows it. */
export async function recomputeTargets() {
  if (!app.profile) { app.targets = null; return; }
  let p = app.profile;
  if (p.useLatestWeight !== false) {
    const ws = (await app.store.byProfile('weights', p.id)).sort((a, b) => b.date.localeCompare(a.date));
    if (ws[0]) p = { ...p, weightKg: ws[0].kg };
  }
  app.targets = computeTargets(p);
  app.targetsWeight = p.weightKg;
}

export async function switchProfile(id) {
  await app.store.setMeta('activeProfileId', id);
  await loadProfiles(); await loadPersonal();
}

export async function loadPersonal() {
  const pid = app.profile?.id;
  app.userFoods = (await app.store.all('foods')).filter((f) => !f.archived).map((f) => ({ ...f, userFood: true }));
  app.meals = pid ? (await app.store.byProfile('meals', pid)).sort((a, b) => a.name.localeCompare(b.name)) : [];
  app.stats = new Map(pid ? (await app.store.byProfile('stats', pid)).map((s) => [s.foodId, s]) : []);
  app.customPortions = new Map((await app.store.all('portions')).map((p) => [p.id, p.list]));
  rebuildIndex();
}

let coreIndex = null; let usdaIndexCache = null;
export function rebuildIndex() {
  const mealFoods = app.meals.map((m) => ({ id: `meal:${m.id}`, kind: 'meal', name: m.name, aliases: [], group: 'Saved meal', src: 'meal', diet: 'veg', meal: m }));
  coreIndex ||= coreLibrary().map(indexFood); // built-in foods never change at runtime: index once
  app.index = [...[...mealFoods, ...app.userFoods].map(indexFood), ...coreIndex];
  const u = usdaLoaded();
  if (u && !usdaIndexCache) usdaIndexCache = u.map(indexFood);
  app.usdaIndex = usdaIndexCache;
}

export function dietOk(f) { return f.kind === 'meal' || f.userFood || dietAllows(app.profile?.diet || 'veg', f.diet); }

export function findFood(id) {
  if (!id) return null;
  return app.userFoods.find((f) => f.id === id) || getBuiltin(id) || null;
}

export async function entriesFor(date) {
  if (!app.profile) return [];
  return (await app.store.entriesOn(app.profile.id, date)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
export async function dayRecord(date) { return app.profile ? app.store.get('days', `${app.profile.id}|${date}`) : null; }
export function initials(name) { return String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); }

/** Keep "today" correct if the app stays open past midnight or is resumed the next day. */
export function syncToday() {
  const t = localDate();
  if (app.followToday && app.date !== t) { app.date = t; return true; }
  return false;
}
export function setDate(d) { app.date = d; app.followToday = d === localDate(); }
