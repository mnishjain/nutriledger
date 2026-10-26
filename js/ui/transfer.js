// Moving data between Safari and the Home Screen app (separate storage on iPhone), or to a new phone.
// Two zero-cost routes, both validated before anything is written:
//   1. Clipboard: "Copy my data" in one place → "Paste my data" in the other (iOS shares the clipboard).
//   2. Backup file: Export → Files/iCloud → Restore.
import { h, icon, openSheet, toast, clear } from './dom.js';
import { app, loadProfiles, loadPersonal, refresh } from './state.js';
import { validateBackup } from '../store/validate.js';

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * Copy everything to the clipboard. Must be called directly from a tap.
 * Safari only allows clipboard writes inside the tap itself, so the write is started synchronously with a
 * ClipboardItem whose content is a Promise (supported by Safari 13.1+ and Chromium); the data is gathered inside it.
 */
export function copyAllData() {
  let entries = 0;
  const textPromise = app.store.exportAll().then((d) => { entries = d.data.entries.length; return JSON.stringify(d); });
  let write;
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      write = navigator.clipboard.write([new ClipboardItem({ 'text/plain': textPromise.then((t) => new Blob([t], { type: 'text/plain' })) })]);
    } else {
      write = textPromise.then((t) => navigator.clipboard.writeText(t));
    }
  } catch (e) { write = Promise.reject(e); }
  return write.then(async () => {
    await app.store.setMeta('lastCopyAt', Date.now());
    toast(`Copied ${entries} diary entr${entries === 1 ? 'y' : 'ies'} and your profile. Now open the other app and tap “Paste my data”.`, { ms: 7000 });
    return true;
  }).catch(() => {
    toast('Copying was blocked by the phone. Use Export backup (just below) instead.', { tone: 'error', ms: 8000 });
    return false;
  });
}

/** Show what a backup contains and let the user bring it in. */
function preview(out, v, { onDone, emptyApp }) {
  clear(out);
  if (!v.ok) { out.append(h('div.banner.danger', {}, v.error)); return; }
  const c = v.counts;
  const names = v.data.profiles.map((p) => p.name).join(', ');
  const dates = v.data.entries.map((e) => e.date).sort();
  const range = dates.length ? (dates[0] === dates[dates.length - 1] ? ` on ${dates[0]}` : ` from ${dates[0]} to ${dates[dates.length - 1]}`) : '';
  const go = async (mode) => {
    try {
      await app.store.importValidated(v, mode);
      await loadProfiles(); await loadPersonal();
      toast(`Brought in ${c.entries} entries for ${names}`, { ms: 5000 });
      onDone?.();
      await refresh('all');
    } catch (e) { toast(e.message, { tone: 'error', ms: 8000 }); }
  };
  out.append(h('div.card', { id: 'transfer-preview' },
    h('b', {}, v.format === 'legacy-v2' ? 'Data from the old NutriLedger' : 'NutriLedger data found'),
    h('div.small', {}, `Profile: ${names}. ${c.entries} diary entries${range}, ${c.meals} saved meals, ${c.foods} foods, ${c.weights} weights.`),
    ...(v.report?.notes || []).map((n) => h('div.hint', {}, n)),
    emptyApp
      ? h('button.btn.primary.block', { type: 'button', id: 'transfer-go', style: { marginTop: '10px' }, onclick: () => go('replace') }, 'Bring it in')
      : h('div.btn-row', {},
        h('button.btn', { type: 'button', id: 'transfer-merge', onclick: () => go('merge') }, 'Add to my data'),
        h('button.btn.danger', { type: 'button', id: 'transfer-replace', onclick: () => { if (confirm('Replace ALL data in this app with this copy? A safety snapshot is taken first.')) go('replace'); } }, 'Replace everything'))));
}

function parseText(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: 'Nothing was pasted. Copy your data first, then paste.' };
  let obj;
  try { obj = JSON.parse(t); } catch { return { ok: false, error: 'That is not NutriLedger data. In the other app tap “Copy my data” (More → Backup & restore), then paste here.' }; }
  return validateBackup(obj);
}

/**
 * Sheet for bringing data in: paste (from Safari / another phone) or a backup file.
 * Used on first run (empty app) and from More → Backup & restore.
 */
export function openBringData({ onDone = null, emptyApp = !app.profile } = {}) {
  const sheet = openSheet({ title: 'Bring my data in' });
  const b = sheet.body;
  const out = h('div');
  const done = () => { sheet.close(); onDone?.(); };
  const ta = h('textarea', { id: 'transfer-text', rows: '4', placeholder: 'Touch and hold here, then tap Paste', style: { width: '100%', fontSize: '16px' },
    oninput: () => {
      const t = ta.value;
      if (t.trim().length > 20 && !t.startsWith('✓')) { preview(out, parseText(t), { onDone: done, emptyApp }); ta.value = `✓ Pasted (${Math.round(t.length / 1024) || 1} KB). Check the summary below.`; }
    } });
  const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'transfer-file' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; if (!f) return;
    preview(out, parseText(await f.text()), { onDone: done, emptyApp });
  });
  if (isIOS() && isStandalone()) {
    b.append(h('div.banner', {}, h('b', {}, 'Moving from Safari?'),
      'On iPhone, this Home Screen app has its own storage, separate from Safari. Your data is still in Safari:',
      h('ol', { style: { margin: '8px 0 0', paddingLeft: '20px' } },
        h('li', {}, 'Open Safari and go to mnishjain.github.io/nutriledger'),
        h('li', {}, 'Tap “Copy my data” (top of the Today screen, or More → Backup & restore)'),
        h('li', {}, 'Come back here and tap “Paste my data”'))));
  }
  b.append(
    h('div.section-title', {}, 'Paste my data'),
    h('button.btn.primary.block', { type: 'button', id: 'transfer-paste', onclick: async () => {
      try {
        const text = await navigator.clipboard.readText();
        ta.value = text.trim() ? `✓ Pasted (${Math.round(text.length / 1024) || 1} KB). Check the summary below.` : '';
        preview(out, parseText(text), { onDone: done, emptyApp });
      } catch {
        ta.focus();
        toast('Touch and hold the box below, then tap Paste.', { ms: 6000 });
      }
    } }, icon('copy', 18), 'Paste my data'),
    h('div.hint', {}, 'If the button does not work: touch and hold this box, then tap Paste.'), ta,
    out,
    h('div.section-title', {}, 'Or restore a backup file'),
    file,
    h('div.hint', {}, 'A file you saved with Export backup (for example in iCloud Drive).'));
  return sheet;
}
