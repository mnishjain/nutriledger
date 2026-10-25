import { h, icon, clear, toast, openSheet, $ } from './ui/dom.js';
import { app, onRefresh, loadProfiles, loadPersonal, syncToday, refresh } from './ui/state.js';
import { openDB, requestPersistence } from './store/db.js';
import { renderToday } from './ui/today.js';
import { renderMeals } from './ui/meals.js';
import { renderInsights } from './ui/insights.js';
import { renderMore, editProfile, exportBackup } from './ui/more.js';
import { openAdd } from './ui/add.js';
import { slotForTime, localDate } from './core/dates.js';

const root = $('#app');
const TABS = [['today', 'Today', 'today'], ['meals', 'Meals', 'meals'], ['add', 'Add', 'plus'], ['insights', 'Insights', 'chart'], ['more', 'More', 'more']];

function fatal(msg, detail = '') {
  clear(root);
  root.append(h('div.banner.danger', { style: { marginTop: '40px' } }, h('b', {}, msg), detail, h('div.actions', {}, h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Reload'))));
}

function renderTabbar() {
  const bar = $('#tabbar'); clear(bar);
  const nav = h('nav', { 'aria-label': 'Main' });
  for (const [id, label, ic] of TABS) {
    nav.append(h('button', { type: 'button', class: `${id === app.tab ? 'on' : ''} ${id === 'add' ? 'add-tab' : ''}`, id: `tab-${id}`, 'aria-current': id === app.tab ? 'page' : null, onclick: () => {
      if (id === 'add') { openAdd({ date: app.date, slot: slotForTime() }); return; }
      app.tab = id; location.hash = id; render();
    } }, id === 'add' ? h('span.circle', {}, icon('plus', 26)) : icon(ic), id === 'add' ? h('span.visually-hidden', {}, label) : label));
  }
  bar.append(nav);
}

async function banners() {
  const box = h('div', { id: 'banners' });
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let dismissed = {}; try { dismissed = JSON.parse(sessionStorage.getItem('nl-dismissed') || '{}'); } catch { /* private mode */ }
  const dismiss = (k) => { dismissed[k] = 1; try { sessionStorage.setItem('nl-dismissed', JSON.stringify(dismissed)); } catch { /* ignore */ } render(); };
  if (ios && !standalone && !dismissed.safari) box.append(h('div.banner', { id: 'safari-banner' }, h('b', {}, 'Use NutriLedger from your Home Screen'),
    'Data saved in this Safari tab is separate from the Home Screen app, and Safari can delete it if you don’t visit for 7 days. Tap Share → “Add to Home Screen”, then always open it from there.',
    h('div.actions', {}, h('button.btn', { type: 'button', onclick: () => dismiss('safari') }, 'Got it'))));
  const last = await app.store.meta('lastBackupAt', null);
  const c = await app.store.counts();
  const first = await app.store.meta('firstUseAt', Date.now());
  const age = Date.now() - (last || first);
  if (c.entries >= 5 && age > 7 * 86400000 && !dismissed.backup) box.append(h('div.banner', { id: 'backup-banner' }, h('b', {}, last ? `Last backup ${Math.floor(age / 86400000)} days ago` : 'You have not made a backup yet'),
    'Your diary is stored only on this phone. Export a copy to iCloud Drive.',
    h('div.actions', {}, h('button.btn.primary', { type: 'button', onclick: async () => { const r = await exportBackup(); if (r !== 'cancelled') render(); } }, 'Back up now'), h('button.btn', { type: 'button', onclick: () => dismiss('backup') }, 'Later'))));
  return box;
}

let rendering = false; let again = false;
async function render() {
  if (rendering) { again = true; return; }
  rendering = true;
  try {
    syncToday();
    renderTabbar();
    const view = h('div', { id: `view-${app.tab}` });
    const bx = await banners();
    if (app.tab === 'meals') renderMeals(view);
    else if (app.tab === 'insights') await renderInsights(view);
    else if (app.tab === 'more') await renderMore(view);
    else await renderToday(view);
    clear(root); root.append(bx, view);
    document.title = `NutriLedger${app.isBeta ? ' beta' : ''}`;
  } catch (e) {
    console.error(e);
    toast(e.message || 'Something went wrong', { tone: 'error', ms: 7000 });
  } finally {
    rendering = false;
    if (again) { again = false; render(); }
  }
}
onRefresh(async (what) => { if (what === 'profile' || what === 'all') await loadPersonal(); await render(); });

async function showMigrationReport(r) {
  const s = openSheet({ title: 'Welcome to the new NutriLedger' });
  s.body.append(h('div.card', {}, h('b', {}, 'Your old diary was copied safely'),
    h('p.small', {}, `${r.counts.entries} entries, ${r.counts.meals} saved meals and ${r.counts.weights} weights were brought across with their original values. The old copy was left untouched.`),
    ...(r.report?.notes || []).map((n) => h('p.small', {}, n))),
  h('div.card', {}, h('b', {}, 'What changed'), h('p.small', {}, 'Data is now stored in a proper database with daily safety snapshots. Foods come from Indian (IFCT 2017) and USDA laboratory data, with sources and confidence shown. Check your height, activity and goal in More → Profiles so your targets are right.')),
  h('button.btn.primary.block', { type: 'button', onclick: () => s.close() }, 'Continue'));
  await app.store.setMeta('migrationReportShown', true);
}

async function boot() {
  app.isBeta = /\/beta\//.test(location.pathname);
  app.dbName = app.isBeta ? 'nutriledger-beta' : 'nutriledger';
  app.tab = ['today', 'meals', 'insights', 'more'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
  try { app.store = await openDB(app.dbName); }
  catch (e) { fatal('Storage is unavailable', ` ${e.message} In Safari, turn off Private Browsing.`); return; }
  if (!(await app.store.meta('firstUseAt'))) await app.store.setMeta('firstUseAt', Date.now());
  let legacy = null;
  try { legacy = await app.store.importLegacyIfNeeded(); } catch (e) { console.error(e); toast(`Old data import failed: ${e.message}`, { tone: 'error', ms: 8000 }); }
  await loadProfiles();
  await loadPersonal();
  app.store.autoSnapshotIfDue().catch(() => {});
  renderTabbar();
  if (!app.profile) {
    clear(root);
    root.append(h('div.card', { style: { marginTop: '30px' } }, h('h1', {}, 'NutriLedger'), h('p', {}, 'Track Indian vegetarian meals without weighing food. Works offline. Your data stays on this phone.'),
      h('button.btn.primary.block', { type: 'button', id: 'start-setup', onclick: () => editProfile(null, { firstRun: true, onDone: () => render() }) }, 'Set up profile')));
    editProfile(null, { firstRun: true, onDone: () => render() });
  } else {
    await render();
    app.persistence = await requestPersistence();
    if (legacy?.status === 'imported' && !(await app.store.meta('migrationReportShown'))) showMigrationReport(legacy);
    if (legacy?.status === 'unreadable') toast('Old data could not be read. It was kept safe – see More → Backup.', { tone: 'error', ms: 9000 });
  }
  // Keep "today" correct across midnight and app resumes
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && syncToday()) render(); });
  setInterval(() => { if (syncToday()) render(); }, 60000);
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (['today', 'meals', 'insights', 'more'].includes(t) && t !== app.tab) { app.tab = t; render(); } });
  app.store.onChange(() => {});
  registerSW();
}

let updateRequested = false;
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.update().catch(() => {}); // register() alone does not re-check an existing registration
    const offer = (w) => toast('A new version is ready', { action: () => { updateRequested = true; w.postMessage('skipWaiting'); }, actionLabel: 'Update', ms: 15000 });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  // Reload only when the user asked for an update — never on first install (that would wipe a half-filled form).
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateRequested && !reloaded) { reloaded = true; location.reload(); } });
}

window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) toast(`Error: ${e.message}`, { tone: 'error', ms: 7000 }); });
window.addEventListener('unhandledrejection', (e) => { const m = e.reason?.message || String(e.reason); toast(m, { tone: 'error', ms: 7000 }); });
window.__nl = app; // for automated tests and diagnostics
boot().then(() => { window.__nlReady = true; });
export { localDate };
