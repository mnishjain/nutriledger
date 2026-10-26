import { h, icon, clear, openSheet, toast, field, numInput, readNum, segmented } from './dom.js';
import { app, refresh, loadProfiles, loadPersonal, switchProfile, recomputeTargets, initials } from './state.js';
import { computeTargets, validateProfile, ACTIVITY, GOALS } from '../core/targets.js';
import { validateBackup } from '../store/validate.js';
import { requestPersistence, storageEstimate } from '../store/db.js';
import { localDate, prettyDate } from '../core/dates.js';
import { NUTRIENTS, fmt, isNum } from '../core/nutrients.js';
import { uid } from '../core/entries.js';
import { SOURCES } from '../core/library.js';
import { copyAllData, openBringData } from './transfer.js';

export async function renderMore(root) {
  clear(root);
  const lastBackup = await app.store.meta('lastBackupAt', null);
  const counts = await app.store.counts();
  root.append(h('header.topbar', {}, h('h1', {}, 'More')));
  root.append(h('div.section-title', {}, 'Profiles'), h('div.group', { id: 'profiles' },
    app.profiles.map((p) => h('div.row', {},
      h('button.avatar', { type: 'button', style: p.id === app.profile.id ? {} : { background: 'var(--fill)', color: 'var(--ink)' }, 'aria-label': `Switch to ${p.name}`, onclick: async () => { await switchProfile(p.id); toast(`Switched to ${p.name}`); refresh('profile'); } }, initials(p.name)),
      h('button.main', { type: 'button', style: { border: 0, background: 'none', textAlign: 'left', padding: 0, color: 'inherit' }, onclick: () => editProfile(p) },
        h('div.title', {}, p.name, p.id === app.profile.id ? ' (active)' : ''), h('div.sub', {}, `${p.sex}, ${p.age ?? '?'} y, ${p.weightKg ?? '?'} kg · ${GOALS[p.goal]?.label || ''}`)),
      h('button.icon-btn', { type: 'button', 'aria-label': `Edit ${p.name}`, onclick: () => editProfile(p) }, icon('edit', 20)))),
    h('button.row.add-row', { type: 'button', id: 'add-profile', onclick: () => editProfile(null) }, icon('plus', 20), 'Add a profile')));

  const T = app.targets;
  root.append(h('div.section-title', {}, `Daily targets for ${app.profile.name}`), h('div.card', { id: 'targets-card' },
    h('table.kv', {}, NUTRIENTS.filter((x) => isNum(T[x.key]?.value)).map((x) => h('tr', {}, h('td', {}, x.label, h('div.hint', {}, T[x.key].why)), h('td', {}, `${T[x.key].kind === 'max' ? '≤ ' : T[x.key].kind === 'target' ? '' : '≥ '}${fmt(x.key, T[x.key].value)} ${x.unit}`)))),
    T.kcal.overridden ? h('div.hint', {}, `Calorie target set by you; calculated suggestion is ${T.kcal.auto} kcal.`) : null,
    h('div.hint', {}, `Based on ${app.targetsWeight ?? '?'} kg. Targets are general guidance for healthy adults, not medical advice. If you have a medical condition, follow your doctor’s advice.`)));

  root.append(h('div.section-title', {}, 'Body weight'), h('div.group', {}, h('button.row', { type: 'button', id: 'log-weight', onclick: () => openWeight() }, icon('scale'), h('div.main', {}, h('div.title', {}, 'Log weight'), h('div.sub', {}, 'Weekly weigh-ins keep calorie targets accurate')))));

  const days = lastBackup ? Math.floor((Date.now() - lastBackup) / 86400000) : null;
  root.append(h('div.section-title', {}, 'Your data'), h('div.group', {},
    h('button.row', { type: 'button', id: 'open-backup', onclick: () => openBackup() }, icon('share'), h('div.main', {}, h('div.title', {}, 'Backup & restore'), h('div.sub', {}, lastBackup ? `Last backup ${days === 0 ? 'today' : `${days} day(s) ago`}` : 'Never backed up'))),
    h('button.row', { type: 'button', onclick: () => exportCsv() }, icon('down'), h('div.main', {}, h('div.title', {}, 'Export diary as spreadsheet (CSV)'), h('div.sub', {}, `${counts.entries} entries`))),
    h('button.row', { type: 'button', onclick: () => openSources() }, icon('info'), h('div.main', {}, h('div.title', {}, 'Data sources & accuracy')))));
  root.append(h('p.hint', { style: { textAlign: 'center', margin: '20px 0' } }, `NutriLedger ${app.version}${app.isBeta ? ' (beta – test data only)' : ''} · works offline · no account, no ads, no tracking`));
}

/** Create or edit a profile. Also used for first-run setup. */
export function editProfile(p, { firstRun = false, onDone = null } = {}) {
  const isNew = !p;
  const d = p || { name: '', sex: 'male', age: null, heightCm: null, weightKg: null, activity: 'light', goal: 'lose', rateKgWk: 0.35, training: true, diet: 'veg', overrides: {}, useLatestWeight: true };
  const sheet = openSheet({ title: firstRun ? 'Set up your profile' : isNew ? 'New profile' : `Edit ${d.name}` });
  const v = { ...d, overrides: { ...(d.overrides || {}) } };
  const name = h('input', { type: 'text', value: v.name, maxlength: '40', placeholder: 'e.g. Manish' });
  const age = numInput({ value: v.age ?? '', inputmode: 'numeric' }); const ht = numInput({ value: v.heightCm ?? '' }); const wt = numInput({ value: v.weightKg ?? '' });
  const kcalO = numInput({ value: v.overrides.kcal ?? '', placeholder: 'auto' }); const protO = numInput({ value: v.overrides.protein ?? '', placeholder: 'auto' });
  const preview = h('div.card');
  const read = () => ({ ...v, name: name.value.trim(), age: readNum(age), heightCm: readNum(ht), weightKg: readNum(wt), overrides: { kcal: readNum(kcalO) || undefined, protein: readNum(protO) || undefined } });
  function upd() {
    clear(preview); const x = read(); const errs = validateProfile(x);
    if (errs.length) { preview.append(h('div.hint', {}, errs.join(' · '))); return; }
    const t = computeTargets(x);
    preview.append(h('b', {}, `${t.kcal.value} kcal · ${t.protein.value} g protein per day`), h('div.hint', {}, t.kcal.why), h('div.hint', {}, t.protein.why));
  }
  [name, age, ht, wt, kcalO, protO].forEach((el) => el.addEventListener('input', upd));
  const b = sheet.body;
  if (firstRun) b.append(h('div.hint', { style: { marginBottom: '12px' } }, 'Used only to calculate your targets. Stored on this phone only.'));
  b.append(field('Name', name),
    h('div.section-title', {}, 'Sex (for energy equations)'), segmented([['male', 'Male'], ['female', 'Female']], v.sex, (x) => { v.sex = x; upd(); }, { label: 'Sex' }),
    h('div.grid2', { style: { marginTop: '12px' } }, field('Age (years)', age), field('Height (cm)', ht)), field('Weight (kg)', wt),
    h('div.section-title', {}, 'Activity'), segmented(Object.entries(ACTIVITY).map(([k, a]) => [k, a.label.split(' (')[0]]), v.activity, (x) => { v.activity = x; upd(); }, { label: 'Activity' }),
    h('div.hint', {}, Object.values(ACTIVITY).map((a) => a.label).join(' · ')),
    h('div.section-title', {}, 'Goal'), segmented(Object.entries(GOALS).map(([k, g]) => [k, g.label.split(/[,(]/)[0].trim()]), v.goal, (x) => { v.goal = x; upd(); }, { label: 'Goal', wrap: true }),
    h('div.section-title', {}, 'Fat-loss pace (if losing)'), segmented([[0.25, '0.25 kg/wk'], [0.35, '0.35 kg/wk'], [0.5, '0.5 kg/wk']], v.rateKgWk, (x) => { v.rateKgWk = x; upd(); }, { label: 'Pace' }),
    h('div.hint', {}, 'Slower loss (≈0.5% of body weight per week) protects muscle better.'),
    h('div.section-title', {}, 'Strength training'), segmented([[true, 'Yes, regularly'], [false, 'No']], v.training, (x) => { v.training = x; upd(); }, { label: 'Strength training' }),
    h('div.section-title', {}, 'Diet'), segmented([['veg', 'Vegetarian'], ['egg', 'Eggetarian'], ['nonveg', 'Non-veg']], v.diet, (x) => { v.diet = x; }, { label: 'Diet' }),
    h('div.hint', {}, 'Hides foods you don’t eat from search.'),
    h('details', { style: { margin: '12px 0' } }, h('summary.link-btn', {}, 'Set my own calorie/protein target'), h('div.grid2', {}, field('Calories (kcal)', kcalO), field('Protein (g)', protO)), h('div.hint', {}, 'Leave blank to use the calculated targets.')),
    h('div.section-title', {}, 'Your targets'), preview,
    h('button.btn.primary.block', { type: 'button', id: 'profile-save', onclick: save }, firstRun ? 'Start tracking' : 'Save profile'));
  if (!isNew && app.profiles.length > 1) b.append(h('div', { style: { height: '10px' } }), h('button.btn.danger.block', { type: 'button', onclick: async () => {
    const typed = prompt(`This permanently deletes ${d.name}'s diary, meals and weights from this phone (a safety snapshot is kept). Type the name to confirm:`);
    if (typed?.trim() !== d.name) { toast('Not deleted'); return; }
    await app.store.snapshot('before-profile-delete'); await app.store.deleteProfile(d.id);
    if (app.profile.id === d.id) await app.store.setMeta('activeProfileId', null);
    await loadProfiles(); await loadPersonal(); sheet.close(); toast(`Deleted ${d.name}`); refresh('profile');
  } }, 'Delete this profile'));
  upd();
  async function save() {
    const x = read(); const errs = validateProfile(x);
    if (errs.length) { toast(errs[0], { tone: 'error' }); return; }
    const now = Date.now();
    const rec = { ...x, id: d.id || uid('p-'), createdAt: d.createdAt || now, updatedAt: now };
    await app.store.put('profiles', rec);
    if (isNew) {
      await app.store.setMeta('activeProfileId', rec.id);
      await app.store.put('weights', { id: `w-${rec.id}|${localDate()}`, profileId: rec.id, date: localDate(), kg: rec.weightKg, updatedAt: now });
    }
    await loadProfiles(); await loadPersonal();
    app.persistence = await requestPersistence();
    sheet.close(); toast(isNew ? `Profile ${rec.name} ready` : 'Profile saved');
    onDone?.(rec); refresh('profile');
  }
  return sheet;
}

function openWeight() {
  const sheet = openSheet({ title: 'Weight' });
  const kg = numInput({ placeholder: 'kg' }); const date = h('input', { type: 'date', value: localDate() });
  const list = h('div');
  async function draw() {
    clear(list);
    const ws = (await app.store.byProfile('weights', app.profile.id)).sort((a, b) => b.date.localeCompare(a.date));
    if (ws.length) list.append(h('div.group', {}, ws.slice(0, 30).map((w) => h('div.row', {}, h('div.main', {}, h('div.title', {}, `${w.kg} kg`), h('div.sub', {}, prettyDate(w.date))),
      h('button.icon-btn', { type: 'button', 'aria-label': `Delete ${w.date}`, onclick: async () => { await app.store.del('weights', w.id); await recomputeTargets(); draw(); refresh('weights'); } }, icon('trash', 18))))));
  }
  sheet.body.append(h('div.grid2', {}, field('Weight (kg)', kg), field('Date', date)),
    h('button.btn.primary.block', { type: 'button', id: 'weight-save', onclick: async () => {
      const v = readNum(kg);
      if (!(v >= 30 && v <= 250) || !date.value) { kg.classList.add('bad'); toast('Enter a weight between 30 and 250 kg', { tone: 'error' }); return; }
      await app.store.put('weights', { id: `w-${app.profile.id}|${date.value}`, profileId: app.profile.id, date: date.value, kg: v, updatedAt: Date.now() });
      await recomputeTargets(); kg.value = ''; toast('Weight saved'); draw(); refresh('weights');
    } }, 'Save weight'), h('div.hint', {}, 'One weight per day; saving again replaces it. Weigh at the same time, ideally morning.'), list);
  draw();
}

export async function shareFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const file = typeof File !== 'undefined' ? new File([blob], filename, { type }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return 'shared'; }
  } catch (e) {
    if (e.name === 'AbortError') return 'cancelled';
    // iOS only allows the share sheet directly from a tap; offer a one-tap button with the file ready
    if (e.name === 'NotAllowedError') return new Promise((resolve) => {
      const s = openSheet({ title: 'Your file is ready', onClose: () => resolve('cancelled') });
      s.body.append(h('p', {}, filename), h('button.btn.primary.block', { type: 'button', onclick: async () => {
        try { await navigator.share({ files: [file], title: filename }); s.close(); resolve('shared'); } catch (err) { if (err.name === 'AbortError') { s.close(); resolve('cancelled'); } else toast(err.message, { tone: 'error' }); }
      } }, icon('share', 18), 'Share / Save to Files'));
    });
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename }); document.body.appendChild(a); a.click(); a.remove();
  return 'downloaded';
}

export async function exportBackup() {
  const data = await app.store.exportAll();
  const name = `NutriLedger-backup-${localDate()}.json`;
  const r = await shareFile(JSON.stringify(data), name, 'application/json');
  if (r !== 'cancelled') { await app.store.setMeta('lastBackupAt', Date.now()); toast(r === 'shared' ? 'Backup shared – save it to Files / iCloud Drive' : 'Backup downloaded'); }
  return r;
}

async function openBackup() {
  const sheet = openSheet({ title: 'Backup & restore' });
  const b = sheet.body;
  const est = await storageEstimate();
  const persist = await requestPersistence();
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const snaps = await app.store.listSnapshots();
  b.append(h('div.card', {}, h('h3', {}, 'Where your data lives'),
    h('p.small', {}, 'Everything is stored only on this phone, inside ', standalone ? 'the Home Screen app.' : 'this Safari tab.', ' The Home Screen app and Safari keep separate data. Deleting the app or clearing website data deletes it. There is no automatic cloud copy.'),
    h('table.kv', {}, h('tr', {}, h('td', {}, 'Protected from automatic clean-up'), h('td', {}, persist === 'granted' ? 'Yes' : persist === 'denied' ? 'Not granted' : 'Not supported')),
      est ? h('tr', {}, h('td', {}, 'Storage used'), h('td', {}, `${(est.usage / 1048576).toFixed(1)} MB`)) : null)),
    h('button.btn.primary.block', { type: 'button', id: 'export-backup', onclick: async () => { await exportBackup(); } }, icon('share', 18), 'Export backup'),
    h('div.hint', {}, 'Choose “Save to Files” → iCloud Drive. Do this weekly; the app reminds you.'),
    h('div.section-title', {}, 'Move to the Home Screen app or another phone'),
    h('div.btn-row', {},
      h('button.btn', { type: 'button', id: 'copy-data', onclick: () => copyAllData() }, icon('copy', 18), 'Copy my data'),
      h('button.btn', { type: 'button', id: 'paste-data', onclick: () => { sheet.close(); openBringData({ emptyApp: false }); } }, 'Paste my data')),
    h('div.hint', {}, 'On iPhone, Safari and the Home Screen app keep separate data. Copy in one, then Paste in the other.'),
    h('div.section-title', {}, 'Restore from a backup file'));
  const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'restore-file' });
  const out = h('div');
  file.addEventListener('change', async () => {
    clear(out); const f = file.files?.[0]; if (!f) return;
    let parsed; try { parsed = JSON.parse(await f.text()); } catch { out.append(h('div.banner.danger', {}, 'This file is not valid JSON.')); return; }
    const v = validateBackup(parsed);
    if (!v.ok) { out.append(h('div.banner.danger', {}, v.error)); return; }
    const c = v.counts;
    out.append(h('div.card', {}, h('b', {}, v.format === 'legacy-v2' ? 'Backup from the old NutriLedger' : 'NutriLedger backup'),
      h('div.small', {}, `${c.profiles} profile(s), ${c.entries} diary entries, ${c.meals} meals, ${c.foods} foods, ${c.weights} weights.`),
      v.report?.notes?.map((n) => h('div.hint', {}, n)),
      h('div.btn-row', {},
        h('button.btn', { type: 'button', id: 'restore-merge', onclick: () => doImport(v, 'merge') }, 'Add to my data'),
        h('button.btn.danger', { type: 'button', id: 'restore-replace', onclick: () => { if (confirm('Replace ALL data on this phone with this backup? A safety snapshot is taken first.')) doImport(v, 'replace'); } }, 'Replace everything'))));
  });
  async function doImport(v, mode) {
    try { await app.store.importValidated(v, mode); await loadProfiles(); await loadPersonal(); sheet.close(); toast('Backup restored'); refresh('all'); }
    catch (e) { toast(e.message, { tone: 'error', ms: 7000 }); }
  }
  b.append(file, out, h('div.section-title', {}, 'Safety snapshots on this phone'),
    h('div.hint', {}, 'Taken automatically once a day and before restores or deletions. They live in the same storage, so they do not replace a real backup.'),
    snaps.length ? h('div.group', {}, snaps.map((s) => h('div.row', {}, h('div.main', {}, h('div.title', {}, new Date(s.at).toLocaleString('en-IN')), h('div.sub', {}, `${s.reason} · ${s.counts.entries} entries`)),
      h('button.btn', { type: 'button', onclick: async () => { if (!confirm('Restore this snapshot? Current data is snapshotted first.')) return; await app.store.restoreSnapshot(s.id); await loadProfiles(); await loadPersonal(); sheet.close(); toast('Snapshot restored'); refresh('all'); } }, 'Restore')))) : h('div.empty', {}, 'No snapshots yet.'));
  const legacy = await app.store.meta('legacyImport');
  if (legacy?.status === 'unreadable') b.append(h('div.banner.danger', {}, h('b', {}, 'Old-app data could not be read automatically'), 'It has been kept safe. Download it and send it for recovery.',
    h('div.actions', {}, h('button.btn', { type: 'button', onclick: () => shareFile(legacy.raw, 'NutriLedger-old-data.txt', 'text/plain') }, 'Download old data'))));
}

async function exportCsv() {
  const all = await app.store.byProfile('entries', app.profile.id);
  all.sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  const head = ['date', 'meal', 'item', 'amount', ...NUTRIENTS.map((x) => `${x.key}_${x.unit}`), 'source', 'confidence'];
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(',')];
  for (const e of all) for (const i of e.items) {
    lines.push([e.date, e.slot, q(i.name), q(i.portionLabel === 'grams' ? `${Math.round(i.grams)} g` : `${i.qty} x ${i.portionLabel}`), ...NUTRIENTS.map((x) => (isNum(i.n[x.key]) ? Number(i.n[x.key].toFixed(2)) : '')), q(i.source?.ref || i.source?.src), i.source?.conf || ''].join(','));
  }
  await shareFile(lines.join('\n'), `NutriLedger-${app.profile.name}-${localDate()}.csv`, 'text/csv');
}

function openSources() {
  const sheet = openSheet({ title: 'Data sources & accuracy' });
  sheet.body.append(
    h('div.card', {}, h('h3', {}, 'How accurate is this?'),
      h('p.small', {}, 'Raw ingredients (atta, dals, nuts, fruits, paneer, milk) come from laboratory data, accurate to a few percent. Home dishes (roti, dal, sabzi, paratha) are estimates from typical recipes; the biggest uncertainty is cooking oil/ghee, which you can adjust when logging. Restaurant food varies widely (±30% or more). Packaged foods from Open Food Facts are usually right but are crowd-sourced; check the badge.'),
      h('p.small', {}, 'Blank or missing values are shown as unknown and never counted as zero.')),
    h('div.card', {}, h('h3', {}, 'Sources'), Object.values(SOURCES).map((s) => h('div', { style: { marginBottom: '8px' } }, h('b.small', {}, s.label), h('div.hint', {}, s.long, s.terms ? `. ${s.terms}` : '')))),
    h('div.card', {}, h('h3', {}, 'Targets'), h('p.small', {}, 'ICMR-NIN Nutrient Requirements for Indians 2020 (RDA/EAR); WHO 2023 fats & fibre guideline; WHO/ICMR salt limit; WHO 2012 potassium; Morton et al. 2018 (protein for muscle); Mifflin–St Jeor equation.')),
    h('div.card', {}, h('h3', {}, 'Software'), h('p.small', {}, 'Tesseract.js and ZXing (Apache-2.0) run on your phone for label and barcode reading.')));
}
