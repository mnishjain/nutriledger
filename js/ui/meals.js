import { h, icon, clear, openSheet, toast, field } from './dom.js';
import { app, loadPersonal, refresh } from './state.js';
import { makeMeal } from '../core/entries.js';
import { openAdd, openMealLog } from './add.js';
import { kcal, g1, confBadge } from './common.js';
import { describeAmount } from '../core/portions.js';
import { slotForTime } from '../core/dates.js';
import { weakestConfidence } from '../core/entries.js';

export function renderMeals(root) {
  clear(root);
  root.append(h('header.topbar', {}, h('h1', {}, 'Saved meals'), h('button.icon-btn', { type: 'button', 'aria-label': 'New meal', id: 'new-meal', onclick: () => editMeal(null) }, icon('plus'))),
    h('div.subhead', {}, 'Combinations you eat often. Log them in one tap with a servings multiplier.'));
  if (!app.meals.length) {
    root.append(h('div.card', {}, h('b', {}, 'No saved meals yet'), h('div.hint', {}, 'Example: 50 g roasted chana + 20 g peanuts, or 2 roti + 1 bowl sabzi + curd. You can also save a logged meal from the Today screen (⋯ next to the meal).'),
      h('div', { style: { marginTop: '10px' } }, h('button.btn.primary', { type: 'button', onclick: () => editMeal(null) }, 'Create a meal'))));
    return;
  }
  root.append(h('div.group', {}, app.meals.map((m) => {
    const k = m.items.reduce((s, i) => s + (i.n.kcal || 0), 0); const p = m.items.reduce((s, i) => s + (i.n.protein || 0), 0);
    return h('div.row', {},
      h('button.main', { type: 'button', style: { border: 0, background: 'none', textAlign: 'left', padding: 0, color: 'inherit' }, onclick: () => openMealLog(m, { mode: 'log', date: app.date, slot: slotForTime() }) },
        h('div.title', {}, m.name), h('div.sub', {}, m.items.map((i) => i.name).join(' + '))),
      h('div.end', {}, kcal(k), h('small', {}, `${g1(p)} g P`)),
      h('button.icon-btn', { type: 'button', 'aria-label': `Edit ${m.name}`, onclick: () => editMeal(m) }, icon('edit', 20)));
  })));
}

export function editMeal(meal) {
  const items = meal ? JSON.parse(JSON.stringify(meal.items)) : [];
  const sheet = openSheet({ title: meal ? 'Edit meal' : 'New meal' });
  const name = h('input', { type: 'text', value: meal?.name || '', placeholder: 'e.g. Evening chana-peanut bowl', maxlength: '60' });
  const list = h('div'); const total = h('div.hint');
  function draw() {
    clear(list);
    if (!items.length) list.append(h('div.empty', {}, 'No items yet.'));
    else list.append(h('div.group', {}, items.map((i, idx) => h('div.row', {},
      h('div.main', {}, h('div.title', {}, i.name), h('div.sub', {}, confBadge(weakestConfidence([i])), ' ', describeAmount(i))), h('div.end', {}, kcal(i.n.kcal)),
      h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${i.name}`, onclick: () => { items.splice(idx, 1); draw(); } }, icon('trash', 18))))));
    const k = items.reduce((s, i) => s + (i.n.kcal || 0), 0); const p = items.reduce((s, i) => s + (i.n.protein || 0), 0);
    total.textContent = items.length ? `Total: ${kcal(k)} kcal · ${g1(p)} g protein` : '';
  }
  sheet.body.append(field('Meal name', name), list, total,
    h('button.btn.block', { type: 'button', id: 'meal-add-item', style: { marginTop: '10px' }, onclick: () => openAdd({ mode: 'pick', onPick: (it) => { items.push(it); draw(); } }) }, icon('plus', 18), 'Add item'),
    h('div.hint', {}, 'Each item keeps the values it had when added. Editing this meal never changes days you already logged.'),
    h('button.btn.primary.block', { type: 'button', id: 'meal-save', style: { marginTop: '14px' }, onclick: async () => {
      try {
        const m = makeMeal({ profileId: app.profile.id, name: name.value, items, id: meal?.id, createdAt: meal?.createdAt });
        await app.store.put('meals', m); await loadPersonal(); sheet.close(); toast('Meal saved'); refresh('meals');
      } catch (e) { toast(e.message, { tone: 'error' }); }
    } }, 'Save meal'));
  if (meal) sheet.body.append(h('div', { style: { height: '10px' } }), h('button.btn.danger.block', { type: 'button', onclick: async () => {
    if (!confirm(`Delete the saved meal “${meal.name}”? Days you already logged are not affected.`)) return;
    await app.store.del('meals', meal.id); await loadPersonal(); sheet.close(); refresh('meals');
    toast('Meal deleted', { action: async () => { await app.store.put('meals', meal); await loadPersonal(); refresh('meals'); } });
  } }, 'Delete meal'));
  draw();
}
