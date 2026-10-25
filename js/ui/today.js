import { h, icon, clear, openSheet, toast, numInput, readNum, field, segmented } from './dom.js';
import { app, refresh, entriesFor, dayRecord, setDate, loadPersonal } from './state.js';
import { analyzeDay } from '../core/analysis.js';
import { dayTotals, rescaleEntry, copyEntries, makeMeal, weakestConfidence } from '../core/entries.js';
import { SLOTS, prettyDate, addDays, localDate, slotForTime } from '../core/dates.js';
import { NUTRIENTS, fmt, isNum } from '../core/nutrients.js';
import { alertEl, confBadge, kcal, g1, valueWithCoverage, coverageNote } from './common.js';
import { openAdd } from './add.js';
import { describeAmount } from '../core/portions.js';

const SLOT_VAR = { Breakfast: '--slot1', Lunch: '--slot2', Snacks: '--slot3', Dinner: '--slot4' };

export async function renderToday(root) {
  const date = app.date; const T = app.targets;
  const [entries, day] = await Promise.all([entriesFor(date), dayRecord(date)]);
  const today = localDate();
  const res = analyzeDay({ date, today, entries, complete: !!day?.complete, targets: T });
  const { totals, coverage } = res;
  clear(root);

  // Header with date navigation
  const dateInput = h('input', { type: 'date', value: date, class: 'visually-hidden', 'aria-label': 'Choose date', onchange: (e) => { if (e.target.value) { setDate(e.target.value); refresh('date'); } } });
  root.append(h('header.topbar', {},
    h('div.date-nav', {},
      h('button.icon-btn', { type: 'button', 'aria-label': 'Previous day', onclick: () => { setDate(addDays(date, -1)); refresh('date'); } }, icon('back')),
      h('button.date-btn', { type: 'button', onclick: () => (dateInput.showPicker ? dateInput.showPicker() : dateInput.click()) }, h('h1', { id: 'day-title' }, prettyDate(date, today))),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Next day', onclick: () => { setDate(addDays(date, 1)); refresh('date'); } }, icon('fwd')), dateInput),
    h('button.avatar', { type: 'button', 'aria-label': `Profile ${app.profile.name}. Switch profile`, onclick: () => { app.tab = 'more'; refresh('tab'); } }, initials(app.profile.name))));
  if (date !== today) root.append(h('div', { style: { margin: '-4px 0 8px' } }, h('button.pill.warn', { type: 'button', id: 'back-to-today', onclick: () => { setDate(today); refresh('date'); } }, `Viewing ${prettyDate(date, today)} · back to today`)));

  // Ledger hero: calorie budget split by meal
  const target = T.kcal.value; const eaten = totals.kcal || 0;
  const left = isNum(target) ? target - eaten : null;
  const scaleMax = Math.max(target || 0, eaten) || 1;
  const bySlot = SLOTS.map((s) => ({ s, k: dayTotals(entries.filter((e) => e.slot === s)).totals.kcal || 0 }));
  const thali = h('div.thali', { role: 'img', 'aria-label': `${Math.round(eaten)} of ${target} kcal eaten` },
    bySlot.filter((x) => x.k > 0).map((x) => h('span', { style: { width: `${(x.k / scaleMax) * 100}%`, background: `var(${SLOT_VAR[x.s]})` }, title: `${x.s} ${Math.round(x.k)} kcal` })),
    eaten > target ? h('span.over-mark', { style: { left: `${(target / scaleMax) * 100}%` } }) : null);
  const pT = T.protein.value; const pE = totals.protein || 0;
  const meter = (key, cls = '') => {
    const t = T[key]; const v = totals[key];
    const pct = isNum(v) && t.value ? Math.min(100, (v / t.value) * 100) : 0;
    const over = t.kind === 'max' && isNum(v) && v > t.value;
    return h('div.meter-row', { class: key === 'protein' ? 'protein-row' : '' }, h('span', {}, key === 'protein' ? 'Protein' : NUTRIENTS.find((n) => n.key === key).label),
      h('div.bar', { class: `${t.kind === 'max' ? 'limit' : ''} ${over ? 'over' : ''} ${cls}` }, h('span', { style: { width: `${pct}%` } })),
      h('span.v', { title: coverageNote(coverage[key]) }, `${valueWithCoverage(key, v, coverage[key]).replace(' unknown', '')} / ${fmt(key, t.value)}${t.kind === 'max' ? ' max' : ''}`));
  };
  root.append(h('section.ledger', { 'aria-label': 'Today’s totals' },
    h('div.ledger-top', {},
      h('div', {}, h('div.big', { class: left < 0 ? 'over' : '', id: 'kcal-left' }, isNum(left) ? kcal(Math.abs(left)) : kcal(eaten)), h('div.big-label', {}, isNum(left) ? (left >= 0 ? 'kcal left' : 'kcal over target') : 'kcal eaten')),
      h('div.ledger-side', {}, h('b', { id: 'kcal-eaten' }, kcal(eaten)), ' eaten', h('br'), 'of ', h('b', {}, kcal(target)), ' target')),
    thali,
    h('div.thali-legend', {}, bySlot.map((x) => h('span', {}, h('i', { style: { background: `var(${SLOT_VAR[x.s]})` } }), `${x.s} ${kcal(x.k)}`))),
    h('div.meters', {}, meter('protein'), meter('fibre'), meter('sodium'), meter('satfat')),
    h('button.link-btn', { type: 'button', onclick: () => openDayDetail(date, totals, coverage) }, 'All nutrients for the day')));

  if (pE >= pT && pT) res.alerts.unshift({ level: 'info', message: `Protein target reached (${g1(pE)} g).` });
  if (res.alerts.length) root.append(h('div.alerts', {}, res.alerts.map(alertEl)));

  // Meal sections
  for (const slot of SLOTS) {
    const list = entries.filter((e) => e.slot === slot);
    const sum = dayTotals(list).totals.kcal;
    const g = h('section.group', { 'aria-label': slot },
      h('div.group-head', {}, h('h3', {}, slot), h('span.sum', {}, list.length ? `${kcal(sum)} kcal` : ''),
        h('button.icon-btn', { type: 'button', 'aria-label': `More actions for ${slot}`, onclick: () => slotMenu(slot, list, date) }, icon('more'))),
      list.map((e) => entryRow(e)),
      h('button.row.add-row', { type: 'button', 'data-slot': slot, onclick: () => openAdd({ date, slot }) }, icon('plus', 20), `Add to ${slot.toLowerCase()}`));
    root.append(g);
  }

  // Day completeness
  const complete = !!day?.complete;
  root.append(h('div.card', {}, h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
    h('div', { style: { flex: 1 } }, h('b', {}, complete ? 'Day marked complete' : 'Finished logging this day?'), h('div.hint', {}, 'Only complete days are used for trends, so partial days don’t skew your averages.')),
    h('button.btn', { type: 'button', id: 'toggle-complete', class: complete ? '' : 'primary', onclick: async () => {
      await app.store.put('days', { id: `${app.profile.id}|${date}`, profileId: app.profile.id, date, complete: !complete, updatedAt: Date.now() });
      toast(complete ? 'Marked as not complete' : 'Day marked complete'); refresh('entries');
    } }, complete ? 'Undo' : 'Mark complete'))));
}

const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function entryRow(e) {
  const it = e.items?.[0];
  const sub = e.kind === 'meal' ? `${e.mult !== 1 ? `${e.mult} × ` : ''}saved meal · ${e.items.length} items` : it ? describeAmount(it) : '';
  return h('button.row', { type: 'button', class: 'entry', onclick: () => openEntry(e) },
    h('div.main', {}, h('div.title', {}, e.name), h('div.sub', {}, confBadge(weakestConfidence(e.items || [])), ' ', sub)),
    h('div.end', {}, kcal(e.n.kcal), h('small', {}, `${g1(e.n.protein)} g P`)));
}

function openEntry(e) {
  const sheet = openSheet({ title: e.name });
  const b = sheet.body;
  const mult = numInput({ value: String(e.mult || 1), 'aria-label': 'Servings multiplier' });
  let slot = e.slot;
  const moveDate = h('input', { type: 'date', value: e.date });
  b.append(h('table.kv', {}, NUTRIENTS.map((x) => h('tr', {}, h('td', {}, x.label), h('td', {}, isNum(e.n[x.key]) ? `${fmt(x.key, e.n[x.key])} ${x.unit}` : 'unknown')))));
  if (e.items.length > 1 || e.kind === 'meal') b.append(h('div.section-title', {}, 'Items'), h('div.group', {}, e.items.map((i) => h('div.row', {}, h('div.main', {}, h('div.title', {}, i.name), h('div.sub', {}, describeAmount(i))), h('div.end', {}, kcal(i.n.kcal))))));
  const src = e.items.map((i) => i.source?.ref).filter(Boolean);
  if (src.length) b.append(h('div.source-line', {}, `Source: ${[...new Set(src)].join('; ')}. Values were saved when logged and do not change if foods are edited later.`));
  b.append(h('div.section-title', {}, 'Change amount (× of what was logged)'), mult,
    h('div.chips', { style: { margin: '8px 0' } }, [0.5, 1, 1.5, 2].map((q) => h('button.chip', { type: 'button', onclick: () => { mult.value = String(q * (e.mult || 1)); } }, `×${q}`))),
    h('div.section-title', {}, 'Meal'), segmented(SLOTS.map((s) => [s, s]), slot, (v) => { slot = v; }, { label: 'Meal' }),
    field('Date', moveDate),
    h('button.btn.primary.block', { type: 'button', id: 'entry-save', onclick: async () => {
      const m = readNum(mult);
      if (!(m > 0)) { mult.classList.add('bad'); toast('Enter an amount above zero', { tone: 'error' }); return; }
      let upd = m !== (e.mult || 1) ? rescaleEntry(e, m) : { ...e };
      upd = { ...upd, slot, date: moveDate.value || e.date, updatedAt: Date.now() };
      await app.store.put('entries', upd); sheet.close(); toast('Entry updated'); refresh('entries');
    } }, 'Save changes'),
    h('div.btn-row', {},
      h('button.btn', { type: 'button', onclick: async () => { const [c] = copyEntries([e], { date: app.date }); await app.store.addEntries([c]); sheet.close(); toast('Duplicated'); refresh('entries'); } }, icon('copy', 18), 'Duplicate'),
      h('button.btn.danger', { type: 'button', id: 'entry-delete', onclick: async () => {
        await app.store.del('entries', e.id); sheet.close(); refresh('entries');
        toast(`Deleted ${e.name}`, { action: async () => { await app.store.put('entries', e); refresh('entries'); toast('Restored'); } });
      } }, icon('trash', 18), 'Delete')));
}

function slotMenu(slot, list, date) {
  const sheet = openSheet({ title: slot });
  const b = sheet.body;
  const yesterday = addDays(date, -1);
  b.append(h('div.group', {},
    h('button.row', { type: 'button', onclick: async () => {
      const prev = (await entriesFor(yesterday)).filter((e) => e.slot === slot);
      if (!prev.length) { toast(`Nothing logged for ${slot.toLowerCase()} on ${prettyDate(yesterday)}`); return; }
      const copies = copyEntries(prev, { date, slot });
      await app.store.addEntries(copies); sheet.close(); refresh('entries');
      toast(`Copied ${copies.length} item(s) from ${prettyDate(yesterday)}`, { action: async () => { for (const c of copies) await app.store.del('entries', c.id); refresh('entries'); } });
    } }, icon('copy'), h('div.main', {}, h('div.title', {}, `Repeat ${prettyDate(yesterday).toLowerCase()}'s ${slot.toLowerCase()}`))),
    h('button.row', { type: 'button', disabled: !list.length, onclick: () => saveAsMeal(slot, list, sheet) }, icon('star'), h('div.main', {}, h('div.title', {}, 'Save these items as a meal'), h('div.sub', {}, list.length ? `${list.length} item(s)` : 'Nothing logged yet'))),
    h('button.row', { type: 'button', onclick: () => { sheet.close(); openAdd({ date, slot }); } }, icon('plus'), h('div.main', {}, h('div.title', {}, 'Add food')))));
}

async function saveAsMeal(slot, list, menuSheet) {
  const name = prompt('Name this meal', `${slot} usual`);
  if (!name || !name.trim()) return;
  const items = list.flatMap((e) => e.items);
  const meal = makeMeal({ profileId: app.profile.id, name, items });
  await app.store.put('meals', meal); await loadPersonal();
  menuSheet.close(); toast(`Saved “${meal.name}” – find it in Meals or search`);
}

function openDayDetail(date, totals, coverage) {
  const T = app.targets;
  const sheet = openSheet({ title: `Nutrients · ${prettyDate(date)}` });
  sheet.body.append(h('div.hint', { style: { marginBottom: '10px' } }, '“≥” means some foods had no data for that nutrient, so the real amount is at least this much. Unknown is never counted as zero.'),
    h('table.kv', {}, NUTRIENTS.map((x) => {
      const t = T[x.key];
      const tgt = t && isNum(t.value) ? `${t.kind === 'max' ? 'max ' : ''}${fmt(x.key, t.value)}` : '';
      return h('tr', {}, h('td', {}, x.label, h('div.hint', {}, [coverageNote(coverage[x.key]), tgt ? `target ${tgt} ${x.unit}` : ''].filter(Boolean).join(' · '))), h('td', {}, valueWithCoverage(x.key, totals[x.key], coverage[x.key])));
    })));
}

export function defaultSlot() { return slotForTime(); }
