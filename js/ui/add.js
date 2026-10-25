// Unified food entry: one search box → portion → add. Also quick add and custom foods.
import { h, icon, openSheet, toast, field, numInput, readNum, segmented, clear } from './dom.js';
import { app, refresh, rebuildIndex, dietOk, loadPersonal } from './state.js';
import { rank } from '../core/search.js';
import { loadUsda } from '../core/library.js';
import { allPortions, nutrientsFor } from '../core/portions.js';
import { makeItem, makeFoodEntry, makeQuickEntry, makeMealEntry, uid } from '../core/entries.js';
import { NUTRIENTS, INFO, fmt, plausibility, sanitize, isNum } from '../core/nutrients.js';
import { SLOTS, prettyDate, localDate } from '../core/dates.js';
import { searchProducts } from '../api/off.js';
import { confBadge, sourceLine, kcal, g1, confExplain } from './common.js';
import { scanBarcode, chooseLabelSource } from './scan.js';

/**
 * ctx: { date, slot, mode: 'log' | 'pick', onPick(item) }
 * In 'pick' mode (building a saved meal) chosen items are returned instead of logged.
 */
export function openAdd(ctx) {
  ctx = { mode: 'log', date: app.date, slot: ctx?.slot || 'Snacks', ...ctx };
  const sheet = openSheet({ title: ctx.mode === 'pick' ? 'Add item to meal' : 'Add food', actions: [h('button.link-btn', { type: 'button', onclick: () => sheet.close() }, 'Done')] });
  if (ctx.mode === 'pick') { const orig = ctx.onPick; ctx.onPick = (item) => { orig(item); sheet.close(); }; }
  const body = sheet.body;
  const target = h('div');
  const input = h('input', { type: 'search', placeholder: 'Search roti, dal, paneer, brand…', 'aria-label': 'Search foods', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const results = h('div', { id: 'results', 'aria-live': 'polite' });
  const online = h('div', { id: 'online' });
  let timer = null; let lastQ = '';

  function renderTarget() {
    clear(target);
    if (ctx.mode !== 'log') return;
    const notToday = ctx.date !== localDate();
    target.append(h('div.chips', { style: { margin: '2px 0 10px' } },
      h('span.pill', { class: notToday ? 'warn' : '' }, `Adding to ${prettyDate(ctx.date)}`),
      ...SLOTS.map((s) => h('button.chip', { type: 'button', class: s === ctx.slot ? 'on' : '', 'aria-pressed': String(s === ctx.slot), onclick: () => { ctx.slot = s; renderTarget(); } }, s))));
  }
  renderTarget();

  const actions = h('div.quick-actions', {},
    h('button', { type: 'button', onclick: () => scanBarcode(ctx) }, icon('barcode'), 'Barcode'),
    h('button', { type: 'button', id: 'qa-picture', onclick: () => chooseLabelSource(ctx) }, icon('camera'), 'Picture / text'),
    h('button', { type: 'button', onclick: () => openQuickAdd(ctx) }, icon('bolt'), 'Quick add'),
    h('button', { type: 'button', onclick: () => openFoodForm({ ctx, initial: { name: input.value.trim() } }) }, icon('edit'), 'New food'));

  body.append(target, h('div.search-box', {}, h('span.s-ico', {}, icon('search', 20)), input), actions, results, online);

  function rowFor(f, gramsLabel = true) {
    if (f.kind === 'meal') {
      const t = f.meal.items.reduce((s, i) => s + (i.n.kcal || 0), 0);
      return h('button.row', { type: 'button', onclick: () => openMealLog(f.meal, ctx) }, h('div.main', {}, h('div.title', {}, f.name), h('div.sub', {}, `Saved meal · ${f.meal.items.length} items`)), h('div.end', {}, `${kcal(t)}`, h('small', {}, 'kcal')));
    }
    const ps = allPortions(f, app.customPortions.get(f.id));
    const p = ps[f.dp] || ps[0];
    const n = nutrientsFor(f, p[1]);
    return h('button.row', { type: 'button', onclick: () => openPortion(f, ctx) },
      h('div.main', {}, h('div.title', {}, f.name), h('div.sub', {}, confBadge(f.conf), ' ', gramsLabel ? p[0] : '', f.userFood ? ' · yours' : '')),
      h('div.end', {}, `${kcal(n.kcal)}`, h('small', {}, `${g1(n.protein)} g P`)));
  }

  function renderEmpty() {
    clear(results); clear(online);
    const recent = [...app.stats.values()].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).map((s) => findAny(s.foodId)).filter(Boolean).filter(dietOk).slice(0, 12);
    if (app.meals.length) results.append(h('div.section-title', {}, 'Saved meals'), h('div.group', {}, app.meals.slice(0, 8).map((m) => rowFor({ kind: 'meal', name: m.name, meal: m }))));
    if (recent.length) results.append(h('div.section-title', {}, 'Recent'), h('div.group', {}, recent.map((f) => rowFor(f))));
    if (!recent.length && !app.meals.length) results.append(h('div.empty', {}, 'Type a food. Try “2 roti” style names: roti, dal, rajma, paneer, curd, banana. For packaged foods, scan the barcode.'));
  }

  async function renderResults(q) {
    clear(online);
    const idx = app.usdaIndex ? [...app.index, ...app.usdaIndex] : app.index;
    const res = rank(q, idx, { stats: app.stats, dietOk, limit: 30 });
    clear(results);
    if (res.length) results.append(h('div.group', {}, res.map((r) => rowFor(r.f))));
    else results.append(h('div.card', {}, h('b', {}, `No match for “${q}” in your foods or the built-in database.`), h('div.hint', {}, 'Nothing is guessed. Search packaged foods online, scan the barcode or label, or enter it yourself.'),
      h('div.btn-row', {}, h('button.btn', { type: 'button', onclick: () => openFoodForm({ ctx, initial: { name: q } }) }, 'Create food'), h('button.btn', { type: 'button', onclick: () => openQuickAdd(ctx, q) }, 'Quick add'))));
    online.append(h('button.btn.block', { type: 'button', id: 'search-online', onclick: () => runOnline(q) }, icon('search', 18), `Search packaged foods online for “${q}”`), h('div.hint', { style: { textAlign: 'center' } }, 'Uses Open Food Facts (free, crowd-sourced). Needs internet.'));
  }

  async function runOnline(q) {
    clear(online); online.append(h('div.empty', {}, 'Searching Open Food Facts…'));
    try {
      const { items, dropped } = await searchProducts(q);
      clear(online);
      online.append(h('div.section-title', {}, `Packaged foods (Open Food Facts) — ${items.length} relevant${dropped ? `, ${dropped} irrelevant or incomplete hidden` : ''}`));
      if (!items.length) online.append(h('div.card', {}, 'No relevant products with calorie data. Scan the barcode or photograph the label instead.'));
      else online.append(h('div.group', {}, items.map((f) => h('button.row', { type: 'button', onclick: () => openPortion(f, ctx) },
        h('div.main', {}, h('div.title', {}, f.name), h('div.sub', {}, confBadge(f.conf), ` ${f.quality.known}/${f.quality.total} nutrients${f.quality.quantity ? ` · ${f.quality.quantity}` : ''}`)),
        h('div.end', {}, `${kcal(f.per100.kcal)}`, h('small', {}, 'per 100 g'))))));
    } catch (e) {
      clear(online); online.append(h('div.banner', {}, h('b', {}, 'Online search unavailable'), e.message, h('div', {}, 'Your saved foods and the built-in database still work offline.')));
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { const q = input.value.trim(); if (q === lastQ) return; lastQ = q; q ? renderResults(q) : renderEmpty(); }, 120);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  // Load the larger USDA list in the background on first use
  if (!app.usdaIndex) loadUsda().then(() => { rebuildIndex(); if (input.value.trim()) renderResults(input.value.trim()); }).catch(() => {});
  renderEmpty();
  setTimeout(() => input.focus(), 250);
  ctx.resetSearch = () => { input.value = ''; lastQ = ''; renderEmpty(); };
  return sheet;
}

function findAny(id) {
  return app.userFoods.find((f) => f.id === id) || app.index.find((e) => e.f.id === id)?.f || app.usdaIndex?.find((e) => e.f.id === id)?.f || null;
}

/** Portion picker for one food. */
export function openPortion(food, ctx) {
  const sheet = openSheet({ title: food.name });
  const b = sheet.body;
  const stat = app.stats.get(food.id);
  let portions = allPortions(food, app.customPortions.get(food.id));
  let pi = Math.min(stat?.lastPortion ?? food.dp ?? 0, portions.length - 1);
  if (portions[pi][0] === 'grams' && !stat) pi = food.dp || 0;
  let qty = stat?.lastQty && portions[pi][0] === (stat.lastPortionLabel || portions[pi][0]) ? stat.lastQty : (portions[pi][0] === 'grams' ? 100 : 1);
  let fat = food.recipe?.fat ? (stat?.lastFat ?? food.recipe.fat.def) : null;

  b.append(h('div', {}, confBadge(food.conf), food.restaurant ? h('span.badge.estimate', { style: { marginLeft: '6px' } }, 'Restaurant – varies a lot') : null),
    h('div.source-line', {}, sourceLine(food)),
    food.note ? h('div.hint', { style: { margin: '-6px 0 12px' } }, food.note) : null,
    food.quality?.issues?.length ? h('div.banner', {}, h('b', {}, 'These values look inconsistent'), food.quality.issues.join('; '), '. Compare with the pack before logging.') : null,
    food.quality?.fromServing ? h('div.hint', {}, 'Some values were converted from per-serving data.') : null);

  const chipsBox = h('div.chips');
  const qtyInput = numInput({ value: String(qty), 'aria-label': 'Quantity' });
  const stepper = h('div.stepper', {},
    h('button', { type: 'button', 'aria-label': 'Less', onclick: () => step(-1) }, '−'), qtyInput, h('button', { type: 'button', 'aria-label': 'More', onclick: () => step(1) }, '+'));
  const quick = h('div.chips', { style: { marginTop: '10px' } });
  const preview = h('div');
  const unitLabel = h('div.hint');
  function isGrams() { return portions[pi][0] === 'grams'; }
  function step(d) {
    const s = isGrams() ? 10 : 0.5;
    const v = readNum(qtyInput); const nv = Math.max(s, Math.round(((isNum(v) ? v : 0) + d * s) * 100) / 100);
    qtyInput.value = String(nv); update();
  }
  function renderChips() {
    clear(chipsBox);
    portions.forEach(([label], i) => chipsBox.append(h('button.chip', { type: 'button', class: i === pi ? 'on' : '', 'aria-pressed': String(i === pi), onclick: () => {
      const wasG = isGrams(); pi = i; if (isGrams() !== wasG) qtyInput.value = isGrams() ? String(Math.round(portions[food.dp]?.[1] || 100)) : '1';
      renderChips(); update();
    } }, label)));
    clear(quick);
    if (!isGrams()) for (const q of [0.5, 1, 1.5, 2, 3]) quick.append(h('button.chip', { type: 'button', onclick: () => { qtyInput.value = String(q); update(); } }, q === 0.5 ? '½' : q === 1.5 ? '1½' : String(q)));
  }
  function current() {
    const q = readNum(qtyInput);
    if (!(q > 0)) return null;
    const grams = portions[pi][1] * q;
    return { q, grams, n: nutrientsFor(food, grams, fat) };
  }
  const addBtn = h('button.btn.primary.block', { type: 'button', id: 'add-to-diary', onclick: () => commit() });
  function update() {
    clear(preview);
    const c = current();
    qtyInput.classList.toggle('bad', !c);
    addBtn.disabled = !c;
    unitLabel.textContent = c ? (isGrams() ? `${Math.round(c.grams)} g` : `≈ ${Math.round(c.grams)} g${food.recipe ? ' cooked weight' : ''}`) : 'Enter a quantity above zero';
    if (!c) return;
    const n = c.n;
    preview.append(h('div.nutri-grid', {},
      h('div', {}, h('b', {}, kcal(n.kcal)), h('span', {}, 'kcal')), h('div', {}, h('b', {}, g1(n.protein)), h('span', {}, 'protein g')),
      h('div', {}, h('b', {}, g1(n.carbs)), h('span', {}, 'carbs g')), h('div', {}, h('b', {}, g1(n.fat)), h('span', {}, 'fat g'))),
    h('details', {}, h('summary', { class: 'link-btn' }, 'All nutrients'), h('table.kv', {}, NUTRIENTS.slice(4).map((x) => h('tr', {}, h('td', {}, x.label), h('td', {}, isNum(n[x.key]) ? `${fmt(x.key, n[x.key])} ${x.unit}` : 'unknown'))))),
    );
    addBtn.textContent = ctx.mode === 'pick' ? 'Add to meal' : `Add to ${ctx.slot}`;
  }
  qtyInput.addEventListener('input', update);
  b.append(h('div.section-title', {}, 'Portion'), chipsBox, h('div.section-title', {}, 'How many'), stepper, unitLabel, quick);
  if (food.recipe?.fat) {
    const f = food.recipe.fat;
    b.append(h('div.section-title', {}, `${f.label[0].toUpperCase()}${f.label.slice(1)} per ${portions[food.dp]?.[0]?.split('(')[0].trim() || 'serving'}`),
      segmented(f.choices.map((c) => [c, c === 0 ? 'None' : `${c} g${f.name.startsWith('Sugar') ? '' : c === 5 ? ' (1 tsp)' : c === 2.5 ? ' (½ tsp)' : ''}`]), fat, (v) => { fat = v; update(); }, { label: f.label }),
      h('div.hint', {}, f.name.startsWith('Sugar') ? '1 tsp sugar ≈ 4 g' : '1 tsp ghee or oil ≈ 5 g'));
  }
  b.append(preview, h('div', { style: { height: '8px' } }), addBtn);
  const extra = h('div.btn-row');
  extra.append(h('button.btn', { type: 'button', onclick: () => addCustomPortion() }, 'Add a portion size'));
  if (food.userFood) extra.append(h('button.btn', { type: 'button', onclick: () => openFoodForm({ ctx, initial: food, onSaved: () => sheet.close() }) }, 'Edit food'));
  b.append(extra);
  renderChips(); update();

  function addCustomPortion() {
    const s2 = openSheet({ title: 'New portion size' });
    const lab = h('input', { type: 'text', placeholder: 'e.g. my steel katori', maxlength: '40' }); const gr = numInput({ placeholder: 'grams' });
    s2.body.append(field('Name', lab), field('Weight in grams', gr, food.recipe ? 'Cooked weight of the portion.' : ''), h('button.btn.primary.block', { type: 'button', onclick: async () => {
      const g = readNum(gr); const l = lab.value.trim();
      if (!l || !(g > 0 && g < 5000)) { toast('Enter a name and a weight between 1 and 5000 g', { tone: 'error' }); return; }
      const list = [...(app.customPortions.get(food.id) || []), [`${l} (${Math.round(g)} g)`, g]];
      await app.store.put('portions', { id: food.id, list });
      app.customPortions.set(food.id, list);
      portions = allPortions(food, list); pi = portions.findIndex((p) => p[0].startsWith(l)); qtyInput.value = '1';
      renderChips(); update(); s2.close();
    } }, 'Save portion'));
  }

  async function commit() {
    const c = current(); if (!c) return;
    let f = food;
    try {
      if (food.src === 'off' || food.src === 'off-doubtful' || (food.id.startsWith('off:') && !food.userFood)) f = await saveExternalFood(food);
      const item = makeItem(f, { grams: c.grams, qty: c.q, portionLabel: portions[pi][0], fatPerUnit: fat });
      if (ctx.mode === 'pick') { ctx.onPick(item); sheet.close(); toast(`${f.name} added to meal`); return; }
      const entry = makeFoodEntry({ profileId: app.profile.id, date: ctx.date, slot: ctx.slot, item });
      await app.store.addEntries([entry], [{ id: `${app.profile.id}|${f.id}`, profileId: app.profile.id, foodId: f.id, lastPortion: pi, lastPortionLabel: portions[pi][0], lastQty: c.q, lastFat: fat }]);
      await loadPersonal();
      sheet.close(); ctx.resetSearch?.();
      toast(`Added ${f.name} to ${ctx.slot}`, { action: async () => { await app.store.del('entries', entry.id); await refresh('entries'); toast('Removed'); } });
      await refresh('entries');
    } catch (e) { toast(e.message, { tone: 'error', ms: 6000 }); }
  }
  return sheet;
}

/** Save an online product to "my foods" so it works offline and appears first next time. */
async function saveExternalFood(food) {
  const existing = app.userFoods.find((u) => (food.barcode && u.barcode === food.barcode) || u.id === `u-${food.id}`);
  if (existing) return existing;
  const rec = { ...food, id: `u-${food.id}`, userFood: true, group: 'Packaged', createdAt: Date.now(), updatedAt: Date.now() };
  delete rec.quality;
  await app.store.put('foods', rec);
  await loadPersonal();
  return { ...rec, userFood: true };
}

/** Log a saved meal with a servings multiplier. */
export function openMealLog(meal, ctx) {
  const sheet = openSheet({ title: meal.name });
  const b = sheet.body;
  let mult = 1;
  const m = numInput({ value: '1', 'aria-label': 'Servings' });
  const total = h('div');
  const btn = h('button.btn.primary.block', { type: 'button', id: 'log-meal' });
  function upd() {
    mult = readNum(m); clear(total);
    const ok = mult > 0; btn.disabled = !ok; m.classList.toggle('bad', !ok);
    if (!ok) return;
    const t = meal.items.reduce((s, i) => ({ k: s.k + (i.n.kcal || 0) * mult, p: s.p + (i.n.protein || 0) * mult }), { k: 0, p: 0 });
    total.append(h('div.nutri-grid', {}, h('div', {}, h('b', {}, kcal(t.k)), h('span', {}, 'kcal')), h('div', {}, h('b', {}, g1(t.p)), h('span', {}, 'protein g')), h('div', {}, h('b', {}, String(meal.items.length)), h('span', {}, 'items')), h('div', {}, h('b', {}, `×${mult}`), h('span', {}, 'servings'))));
    btn.textContent = ctx.mode === 'pick' ? 'Add to meal' : `Log to ${ctx.slot}, ${prettyDate(ctx.date)}`;
  }
  b.append(h('div.group', {}, meal.items.map((i) => h('div.row', {}, h('div.main', {}, h('div.title', {}, i.name), h('div.sub', {}, i.portionLabel === 'grams' ? `${Math.round(i.grams)} g` : `${i.qty} × ${i.portionLabel}`)), h('div.end', {}, kcal(i.n.kcal), h('small', {}, `${g1(i.n.protein)} g P`))))),
    field('Servings', m, '1 = the meal exactly as saved. 0.5 = half, 2 = double.'),
    h('div.chips', {}, [0.5, 1, 1.5, 2].map((q) => h('button.chip', { type: 'button', onclick: () => { m.value = String(q); upd(); } }, String(q)))),
    total, btn);
  m.addEventListener('input', upd);
  btn.onclick = async () => {
    if (!(mult > 0)) return;
    if (ctx.mode === 'pick') { for (const it of meal.items) ctx.onPick(JSON.parse(JSON.stringify(it))); sheet.close(); return; }
    const e = makeMealEntry({ profileId: app.profile.id, date: ctx.date, slot: ctx.slot, meal, mult });
    await app.store.addEntries([e], [{ id: `${app.profile.id}|meal:${meal.id}`, profileId: app.profile.id, foodId: `meal:${meal.id}` }]);
    sheet.close(); ctx.resetSearch?.();
    toast(`Logged ${meal.name}`, { action: async () => { await app.store.del('entries', e.id); await refresh('entries'); } });
    await loadPersonal(); await refresh('entries');
  };
  upd();
}

/** Quick add: type calories (required) and any known nutrients for one serving. */
export function openQuickAdd(ctx, name = '') {
  const sheet = openSheet({ title: 'Quick add' });
  const nm = h('input', { type: 'text', value: name, placeholder: 'e.g. Office canteen thali', maxlength: '80' });
  const inputs = Object.fromEntries(['kcal', 'protein', 'carbs', 'fat', 'fibre', 'sodium'].map((k) => [k, numInput({ placeholder: k === 'kcal' ? 'required' : 'unknown' })]));
  sheet.body.append(h('div.hint', { style: { marginBottom: '12px' } }, 'Use when you know the totals (e.g. from a menu). Leave anything you don\'t know blank – blank means unknown, not zero.'),
    field('Name', nm), h('div.grid2', {}, Object.entries(inputs).map(([k, el]) => field(`${INFO[k].label} (${INFO[k].unit})`, el))),
    h('button.btn.primary.block', { type: 'button', id: 'quick-save', onclick: async () => {
      const vals = {}; let bad = false;
      for (const [k, el] of Object.entries(inputs)) { const v = readNum(el); el.classList.toggle('bad', Number.isNaN(v) || v < 0); if (Number.isNaN(v) || v < 0) bad = true; vals[k] = v; }
      if (!(vals.kcal >= 0) || vals.kcal === null) { inputs.kcal.classList.add('bad'); toast('Calories are required', { tone: 'error' }); return; }
      if (bad) { toast('Fix the highlighted values', { tone: 'error' }); return; }
      const e = makeQuickEntry({ profileId: app.profile.id, date: ctx.date, slot: ctx.slot, name: nm.value.trim() || 'Quick add', nutrients: vals });
      if (ctx.mode === 'pick') { ctx.onPick(e.items[0]); sheet.close(); return; }
      await app.store.addEntries([e]);
      sheet.close(); toast(`Added to ${ctx.slot}`); await refresh('entries');
    } }, 'Add'));
}

/**
 * Create or edit a food (values per 100 g). Used for manual entry and label photos.
 * initial may include per100, name, brand, portions, suspicious[], basisNote.
 */
export function openFoodForm({ ctx = null, initial = {}, onSaved = null, src = null, conf = null, warnings = [], photo = null, refText = null } = {}) {
  const editing = !!initial.userFood;
  const sheet = openSheet({ title: editing ? 'Edit food' : src === 'label' ? 'Check label values' : 'New food' });
  const b = sheet.body;
  const nm = h('input', { type: 'text', value: initial.name || '', placeholder: 'e.g. Haldiram Moong Dal', maxlength: '100' });
  const brand = h('input', { type: 'text', value: initial.brand || '', placeholder: 'optional', maxlength: '60' });
  let diet = initial.diet || 'veg';
  const per100 = initial.per100 || {};
  const sus = new Set(initial.suspicious || []);
  const inputs = {};
  for (const x of NUTRIENTS) {
    const v = per100[x.key];
    inputs[x.key] = numInput({ value: isNum(v) ? String(Math.round(v * 100) / 100) : '', placeholder: x.key === 'kcal' ? 'required' : 'unknown', class: sus.has(x.key) ? 'warn' : '' });
  }
  const portionRows = h('div');
  const portionList = (initial.portions || []).filter((p) => p[0] !== '100 g' && p[0] !== 'grams');
  function addPortionRow(label = '', grams = '') {
    const l = h('input', { type: 'text', value: label, placeholder: 'e.g. 1 pack', maxlength: '40' }); const g = numInput({ value: grams ? String(grams) : '', placeholder: 'grams' });
    portionRows.append(h('div.grid2', { class: 'prow' }, field('Portion name', l), field('Grams', g)));
  }
  portionList.forEach(([l, g]) => addPortionRow(l.replace(/\s*\(\d+(\.\d+)? g\)\s*$/, ''), g));
  if (!portionList.length) addPortionRow(initial.servingG ? '1 serving' : '', initial.servingG || '');

  if (photo) b.append(h('img.photo-preview', { src: photo, alt: 'Your label photo' }));
  for (const w of warnings) b.append(h('div.banner', {}, w));
  if (src === 'label') b.append(h('div.hint', { style: { marginBottom: '12px' } }, 'Values read from your picture or text. Compare every number with the label and correct anything wrong. Highlighted fields look misread. Blank = unknown.'));
  b.append(field('Name', nm), field('Brand', brand),
    h('div.section-title', {}, 'Diet'), segmented([['veg', 'Vegetarian'], ['egg', 'Contains egg'], ['nonveg', 'Non-veg']], diet, (v) => { diet = v; }, { label: 'Diet' }),
    h('div.section-title', {}, 'Nutrition per 100 g (or 100 ml)'),
    h('div.grid2', {}, NUTRIENTS.map((x) => field(`${x.label} (${x.unit})`, inputs[x.key]))),
    h('div.section-title', {}, 'Portion sizes (so you don\'t need to weigh)'), portionRows,
    h('button.link-btn', { type: 'button', onclick: () => addPortionRow() }, '+ Add another portion'),
    h('button.btn.primary.block', { type: 'button', id: 'food-save', onclick: save }, editing ? 'Save changes' : 'Save food'));
  if (editing) b.append(h('div', { style: { height: '10px' } }), h('button.btn.danger.block', { type: 'button', onclick: async () => {
    if (!confirm(`Remove “${initial.name}” from your foods? Past diary entries are not affected.`)) return;
    await app.store.put('foods', { ...stripRuntime(initial), archived: true, updatedAt: Date.now() }); await loadPersonal(); sheet.close(); onSaved?.(null); toast('Food removed');
  } }, 'Remove from my foods'));

  async function save() {
    const name = nm.value.trim();
    if (!name) { nm.classList.add('bad'); toast('Name is required', { tone: 'error' }); return; }
    const vals = {}; let bad = false;
    for (const x of NUTRIENTS) { const v = readNum(inputs[x.key]); const isBad = Number.isNaN(v) || (v !== null && v < 0); inputs[x.key].classList.toggle('bad', isBad); if (isBad) bad = true; vals[x.key] = v; }
    if (vals.kcal === null) { inputs.kcal.classList.add('bad'); toast('Calories per 100 g are required', { tone: 'error' }); return; }
    if (bad) { toast('Fix the highlighted values', { tone: 'error' }); return; }
    const n = sanitize(vals);
    const issues = plausibility(n);
    if (issues.length && !confirm(`These values look unusual:\n• ${issues.join('\n• ')}\n\nSave anyway?`)) return;
    const portions = [];
    for (const row of portionRows.querySelectorAll('.prow')) {
      const [l, g] = row.querySelectorAll('input'); const gv = readNum(g);
      if (l.value.trim() && gv > 0 && gv < 5000) portions.push([`${l.value.trim()} (${Math.round(gv * 10) / 10} g)`, gv]);
    }
    portions.push(['100 g', 100]);
    const now = Date.now();
    const rec = { ...stripRuntime(initial), id: editing ? initial.id : uid('u-'), name, brand: brand.value.trim(), aliases: initial.aliases || [], group: initial.group || (src === 'label' ? 'Packaged' : 'My foods'),
      src: src || initial.src || 'user', conf: conf || (editing ? (initial.conf === 'off' || initial.conf === 'off-doubtful' ? 'user' : initial.conf) : 'user'), diet, per100: n, portions, dp: 0,
      barcode: initial.barcode || null, ref: refText || (src === 'label' ? 'Your label photo, checked by you' : (initial.ref || 'Entered by you')), userFood: true, createdAt: initial.createdAt || now, updatedAt: now };
    if (editing && rec.conf !== 'user') rec.conf = 'user';
    await app.store.put('foods', rec);
    await loadPersonal();
    sheet.close(); toast(editing ? 'Food updated' : 'Food saved');
    const saved = app.userFoods.find((f) => f.id === rec.id);
    if (onSaved) onSaved(saved); else if (ctx) openPortion(saved, ctx);
  }
}
function stripRuntime(f) { const o = { ...f }; delete o.quality; return o; }
