// Look up nutrition on the web (Google AI Mode / Google search) and paste the answer back.
// Zero cost, no API key: the phone's own browser does the search; the app only reads what you paste.
// AI answers can be wrong, so values are saved as "Estimate" and always shown for checking first.
import { h, icon, openSheet, toast, clear, field, topSheet } from './dom.js';
import { app } from './state.js';
import { parseLabel } from '../core/labelparse.js';
import { localDate } from '../core/dates.js';

const PENDING_MINUTES = 30;

/** The question sent to Google. A fixed reply format makes the answer reliable to read. */
export function aiPrompt(name) {
  return `Nutrition facts for "${name}" per 100 g (per 100 ml if it is a drink), as sold or as eaten in India. `
    + 'If it is a packaged product, use the manufacturer\'s label. Reply as a list in exactly this format, one per line, '
    + 'writing "unknown" if not reliably known: Energy: _ kcal; Protein: _ g; Carbohydrate: _ g; Total sugars: _ g; '
    + 'Fibre: _ g; Fat: _ g; Saturated fat: _ g; Sodium: _ mg; Potassium: _ mg; Calcium: _ mg; Iron: _ mg. Then name your source.';
}
export function googleAiUrl(name) { return `https://www.google.com/search?udm=50&hl=en&q=${encodeURIComponent(aiPrompt(name))}`; }
export function googleUrl(name) { return `https://www.google.com/search?hl=en&q=${encodeURIComponent(`${name} nutrition facts per 100g`)}`; }

async function setPending(p) { await app.store.setMeta('pendingLookup', p); }
export async function clearPending() { await app.store.setMeta('pendingLookup', null); }

/** If the user left to look something up and came back, reopen the paste step. */
export async function resumePendingLookup() {
  if (!app.store || !app.profile) return false;
  const p = await app.store.meta('pendingLookup');
  if (!p || Date.now() - p.at > PENDING_MINUTES * 60000) return false;
  if (topSheet()?.el?.dataset.lookup === p.name) return false; // already showing
  openWebLookup({ date: p.date || localDate(), slot: p.slot || 'Snacks', mode: 'log' }, p.name, { returning: true });
  return true;
}

export function openWebLookup(ctx, name = '', { returning = false } = {}) {
  const sheet = openSheet({ title: 'Look up on the web', onClose: () => {} });
  sheet.el.dataset.lookup = name;
  const b = sheet.body;
  const nm = h('input', { type: 'text', value: name, id: 'lookup-name', placeholder: 'e.g. Haldiram aloo bhujia', maxlength: '100' });
  const out = h('div');
  const ta = h('textarea', { id: 'lookup-text', rows: '6', placeholder: 'Touch and hold here, then tap Paste', style: { width: '100%', fontSize: '16px' } });
  const go = (kind) => {
    const n = nm.value.trim();
    if (!n) { nm.classList.add('bad'); toast('Type the food name first', { tone: 'error' }); return; }
    // Open FIRST, synchronously inside the tap: Safari blocks pages opened after any await as pop-ups
    window.open(kind === 'ai' ? googleAiUrl(n) : googleUrl(n), '_blank', 'noopener');
    sheet.el.dataset.lookup = n;
    setPending({ name: n, at: Date.now(), date: ctx.date, slot: ctx.slot, kind }).catch(() => {});
  };
  const read = async (text) => {
    clear(out);
    const r = parseLabel(text, { source: 'text' });
    if (r.found.length < 2 || !Number.isFinite(r.per100.kcal)) {
      out.append(h('div.banner', { id: 'lookup-error' }, h('b', {}, 'Could not find nutrition values in that text.'),
        'Copy the part with the numbers and units (kcal, g, mg). From Google AI, use its copy button, or select the list and tap Copy.'));
      return;
    }
    const { openFoodForm } = await import('./add.js');
    const n = nm.value.trim();
    await clearPending();
    sheet.close();
    const warnings = [...r.warnings];
    warnings.unshift('Values from the web or AI can be wrong. Compare with the product label when you can.');
    openFoodForm({ ctx, initial: { name: n, per100: r.per100, suspicious: r.suspicious, servingG: r.servingG, portions: r.servingG ? [[`1 serving (${r.servingG} g)`, r.servingG]] : [] },
      src: 'web', conf: 'estimate', refText: `Web/AI answer pasted by you on ${localDate()}, checked by you`, warnings, title: 'Check web values' });
  };
  b.append(
    returning ? h('div.banner', { id: 'lookup-welcome-back' }, h('b', {}, `Welcome back. Paste the answer for “${name}”.`)) : null,
    field('Food name', nm),
    h('div.section-title', {}, '1. Look it up'),
    h('div.btn-row', {},
      h('button.btn.primary', { type: 'button', id: 'lookup-ai', onclick: () => go('ai') }, icon('search', 18), 'Ask Google AI'),
      h('button.btn', { type: 'button', id: 'lookup-google', onclick: () => go('web') }, 'Search Google')),
    h('div.hint', {}, '“Ask Google AI” opens Google’s AI Mode (Gemini) in Safari with the question already written. “Search Google” shows normal results; open a nutrition page there.'),
    h('div.section-title', {}, '2. Copy the answer, then come back'),
    h('div.hint', {}, 'Use the copy button under Google’s AI answer, or select the nutrition list/table and tap Copy. Then switch back to NutriLedger.'),
    h('div.section-title', {}, '3. Paste it here'),
    h('button.btn.primary.block', { type: 'button', id: 'lookup-paste', onclick: async () => {
      try { const t = await navigator.clipboard.readText(); ta.value = t; await read(t); }
      catch { ta.focus(); toast('Touch and hold the box below, then tap Paste.', { ms: 6000 }); }
    } }, icon('copy', 18), 'Paste answer'),
    h('div.hint', {}, 'If the button does not work: touch and hold the box, tap Paste, then tap Read values.'),
    ta,
    h('button.btn.block', { type: 'button', id: 'lookup-read', style: { marginTop: '8px' }, onclick: () => read(ta.value) }, 'Read values'),
    out);
  if (!name) setTimeout(() => nm.focus(), 250);
  return sheet;
}
