// Look up nutrition on the web (Google AI Mode / Google search) and paste the answer back.
// Zero cost, no API key: the phone's own browser does the search; the app only reads what you paste.
// AI answers can be wrong, so values are saved as "Estimate" and always shown for checking first.
import { h, icon, openSheet, toast, clear, field, topSheet } from './dom.js';
import { app } from './state.js';
import { parseLabel } from '../core/labelparse.js';
import { localDate } from '../core/dates.js';
import { aiPrompt } from '../core/prompt.js';
import { lookupNutrition } from '../api/gemini.js';

const PENDING_MINUTES = 30;

export { aiPrompt };
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

export async function geminiConfig() { return (await app.store.meta('gemini')) || null; }

export async function openWebLookup(ctx, name = '', { returning = false, auto = false } = {}) {
  const gcfg = await geminiConfig();
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
  const read = async (text, { via = 'paste', sources = [], searched = true, model = '' } = {}) => {
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
    if (via === 'gemini' && !searched) warnings.unshift('Gemini answered without a web search (not available for this key/model), from its own knowledge. Treat with extra care.');
    if (via === 'gemini' && sources.length) warnings.push(`Sources Gemini used: ${sources.slice(0, 3).map((x) => x.title).join('; ')}`);
    const refText = via === 'gemini'
      ? `Gemini (${model})${searched ? ' with Google Search' : ''} on ${localDate()}${sources.length ? `; sources: ${sources.slice(0, 3).map((x) => x.title).join('; ')}` : ''}; checked by you`
      : `Web/AI answer pasted by you on ${localDate()}, checked by you`;
    openFoodForm({ ctx, initial: { name: n, per100: r.per100, suspicious: r.suspicious, servingG: r.servingG, url: sources[0]?.url || '', portions: r.servingG ? [[`1 serving (${r.servingG} g)`, r.servingG]] : [] },
      src: 'web', conf: 'estimate', refText, warnings, title: via === 'gemini' ? 'Check Gemini values' : 'Check web values' });
  };
  const gem = h('div', { id: 'gemini-box' });
  const runGemini = async () => {
    const n = nm.value.trim();
    if (!n) { nm.classList.add('bad'); toast('Type the food name first', { tone: 'error' }); return; }
    clear(gem); clear(out);
    gem.append(h('div.empty', { id: 'gemini-working' }, `Asking Gemini about “${n}”… (usually 5–15 seconds)`));
    try {
      const res = await lookupNutrition(n, gcfg, { onModel: (m, a) => { gcfg.model = m; if (a) gcfg.auth = a; app.store.setMeta('gemini', { ...gcfg }).catch(() => {}); } });
      if (res.auth && res.auth !== gcfg.auth) { gcfg.auth = res.auth; app.store.setMeta('gemini', { ...gcfg }).catch(() => {}); }
      clear(gem);
      const r = parseLabel(res.text, { source: 'text' });
      if (r.found.length < 2 || !Number.isFinite(r.per100.kcal)) {
        gem.append(h('div.banner', { id: 'gemini-nodata' }, h('b', {}, 'Gemini could not give reliable values for this food.'),
          h('div.small', { style: { whiteSpace: 'pre-wrap', marginTop: '6px' } }, res.text.slice(0, 600)),
          'Try a more specific name (brand + product), or use Ask Google AI / a label photo.'));
        return;
      }
      await read(res.text, { via: 'gemini', sources: res.sources, searched: res.searched, model: res.model });
    } catch (e) {
      clear(gem);
      gem.append(h('div.banner.danger', { id: 'gemini-error' }, h('b', {}, e.message), e.detail ? h('div.hint', {}, `Google said: ${String(e.detail).slice(0, 200)}`) : null,
        h('div.hint', {}, 'You can still use “Ask Google AI” below.')));
    }
  };
  b.append(
    returning ? h('div.banner', { id: 'lookup-welcome-back' }, h('b', {}, `Welcome back. Paste the answer for “${name}”.`)) : null,
    field('Food name', nm),
    gcfg?.key ? h('div', {},
      h('button.btn.primary.block', { type: 'button', id: 'lookup-gemini', onclick: runGemini }, icon('bolt', 18), 'Look up with Gemini (one tap)'),
      h('div.hint', {}, 'Uses your own Gemini key with Google Search. You check every value before saving.'), gem,
      h('div.section-title', { style: { marginTop: '18px' } }, 'Or do it yourself in Safari')) : h('div.hint', { id: 'gemini-tip', style: { margin: '-4px 0 8px' } }, 'Tip: add your Gemini key in More → Gemini lookup for one-tap lookups.'),
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
  else if (auto && gcfg?.key && !returning) runGemini();
  return sheet;
}
