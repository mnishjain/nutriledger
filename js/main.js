import { h, icon, clear, toast, openSheet, $ } from './ui/dom.js';
import { app, onRefresh, loadProfiles, loadPersonal, syncToday, refresh } from './ui/state.js';
import { openDB, requestPersistence, importFromSiblingDb } from './store/db.js';
import { renderToday } from './ui/today.js';
import { renderMeals } from './ui/meals.js';
import { renderInsights } from './ui/insights.js';
import { renderMore, editProfile, exportBackup } from './ui/more.js';
import { openAdd } from './ui/add.js';
import { openBringData, copyAllData, isIOS, isStandalone } from './ui/transfer.js';
import { resumePendingLookup } from './ui/weblookup.js';
import { slotForTime, localDate } from './core/dates.js';

const root = $('#app');
const TABS = [['today', 'Today', 'today'], ['meals', 'Meals', 'meals'], ['add', 'Add', 'plus'], ['insights', 'Insights', 'chart'], ['more', 'More', 'more']];

function fatal(msg, detail = '') {
  clear(root);
  root.append(h('div.banner.danger', { style: { marginTop: '40px' } }, h('b', {}, msg), detail, h('div.actions', {}, h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Reload'))));
}

function renderTabbar() {
  const bar = $('#tabbar'); clear(bar);
  if (!app.profile) return; // nothing to navigate to until a profile exists or data is brought in
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
  const standalone = isStandalone();
  const ios = isIOS();
  // Dismissals are remembered in the app database: Safari tab for 30 days, backup reminder for 1 day
  const dismissed = (await app.store.meta('dismissed', {})) || {};
  const isOff = (k, days) => dismissed[k] && Date.now() - dismissed[k] < days * 86400000;
  const dismiss = async (k) => { dismissed[k] = Date.now(); await app.store.setMeta('dismissed', dismissed); render(); };
  const c = await app.store.counts();
  if (ios && !standalone && c.entries > 0) {
    // Safari copy with data: always offer the move (the Home Screen app starts EMPTY on iPhone)
    box.append(h('div.banner', { id: 'safari-banner' }, h('b', {}, 'You are in Safari. The Home Screen app has separate, empty storage.'),
      'To use the Home Screen icon: 1) tap Copy my data, 2) open the Home Screen icon, 3) tap “Bring my data from Safari” → Paste my data. ',
      'Staying in Safari also works, but Safari can delete this data if you don’t open it for 7 days.',
      h('div.actions', {}, h('button.btn.primary', { type: 'button', id: 'banner-copy', onclick: () => copyAllData() }, icon('copy', 18), 'Copy my data'),
        isOff('safari', 7) ? null : h('button.btn', { type: 'button', onclick: () => dismiss('safari') }, 'Hide for a week'))));
  } else if (ios && !standalone && !isOff('safari', 30)) box.append(h('div.banner', { id: 'safari-banner' }, h('b', {}, 'Tip: add NutriLedger to your Home Screen'),
    'In Safari tap ••• (bottom right) → Share → scroll down → “Add to Home Screen” → keep “Open as Web App” on → Add. Then use only the new icon. ',
    'Data in Safari and in the Home Screen app is kept separately by iPhone.',
    h('div.actions', {}, h('button.btn', { type: 'button', onclick: () => dismiss('safari') }, 'Got it'))));
  const last = await app.store.meta('lastBackupAt', null);
  const first = await app.store.meta('firstUseAt', Date.now());
  const age = Date.now() - (last || first);
  const backupDays = ios && !standalone ? 3 : 7; // a Safari tab's data is at more risk than a Home Screen app's
  if (c.entries >= 5 && age > backupDays * 86400000 && !isOff('backup', 1)) box.append(h('div.banner', { id: 'backup-banner' }, h('b', {}, last ? `Last backup ${Math.floor(age / 86400000)} days ago` : 'You have not made a backup yet'),
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

/** Empty app: never push straight into a blank profile. Offer to bring existing data in first. */
function renderWelcome() {
  clear(root); renderTabbar();
  const hsApp = isIOS() && isStandalone();
  const afterIn = async () => { await render(); app.persistence = await requestPersistence(); };
  root.append(h('div', { id: 'welcome', style: { marginTop: '24px' } },
    h('h1', {}, 'NutriLedger'),
    h('p', {}, 'Track Indian vegetarian meals without weighing food. Works offline.'),
    hsApp ? h('div.banner', { id: 'hs-empty-banner' }, h('b', {}, 'Used NutriLedger in Safari before?'),
      'This Home Screen app starts empty: iPhone keeps its storage separate from Safari. Your data is safe in Safari. Bring it here before you start.') : null,
    h('div.group', {},
      h('button.row', { type: 'button', id: 'welcome-bring', onclick: () => openBringData({ emptyApp: true, onDone: afterIn }) }, icon('copy'),
        h('div.main', {}, h('div.title', {}, hsApp ? 'Bring my data from Safari' : 'Bring my data in'), h('div.sub', { style: { whiteSpace: 'normal' } }, 'Paste copied data, or restore a backup file'))),
      h('button.row', { type: 'button', id: 'start-setup', onclick: () => editProfile(null, { firstRun: true, onDone: () => afterIn() }) }, icon('user'),
        h('div.main', {}, h('div.title', {}, 'I’m new: set up my profile'), h('div.sub', {}, 'Takes one minute'))))));
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
  let betaCopied = null;
  if (!app.isBeta) { try { betaCopied = await importFromSiblingDb(app.store, 'nutriledger-beta'); } catch (e) { console.error(e); } }
  await loadProfiles();
  await loadPersonal();
  if (betaCopied?.status === 'imported') setTimeout(() => toast(`Copied ${betaCopied.counts.entries} entries you logged in the beta`, { ms: 6000 }), 800);
  app.store.autoSnapshotIfDue().catch(() => {});
  renderTabbar();
  if (!app.profile) {
    renderWelcome();
  } else {
    await render();
    app.persistence = await requestPersistence();
    if (legacy?.status === 'imported' && !(await app.store.meta('migrationReportShown'))) showMigrationReport(legacy);
    if (legacy?.status === 'unreadable') toast('Old data could not be read. It was kept safe – see More → Backup.', { tone: 'error', ms: 9000 });
  }
  // Keep "today" correct across midnight and app resumes
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (syncToday()) render();
    resumePendingLookup().catch(() => {});
  });
  resumePendingLookup().catch(() => {}); // app was closed while the user was in Safari
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
