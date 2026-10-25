import { h, clear, segmented } from './dom.js';
import { app } from './state.js';
import { analyzeWindow, COVERAGE_MIN } from '../core/analysis.js';
import { rangeEnding, addDays, localDate, shortDate } from '../core/dates.js';
import { NUTRIENTS, fmt, isNum, INFO } from '../core/nutrients.js';
import { alertEl } from './common.js';

let windowN = 14;
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); kids.forEach((c) => c && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)); return e; };

export async function renderInsights(root) {
  const today = localDate();
  const from = addDays(today, -60);
  const all = await app.store.entriesBetween(app.profile.id, from, today);
  const entriesByDate = {};
  for (const e of all) (entriesByDate[e.date] ||= []).push(e);
  const days = await app.store.byProfile('days', app.profile.id);
  const completeDays = new Set(days.filter((d) => d.complete).map((d) => d.date));
  const weights = await app.store.byProfile('weights', app.profile.id);
  const r = analyzeWindow({ today, n: windowN, entriesByDate, completeDays, targets: app.targets, profile: app.profile, weights });
  clear(root);
  root.append(h('header.topbar', {}, h('h1', {}, 'Insights')),
    segmented([[7, '7 days'], [14, '14 days'], [21, '21 days'], [30, '30 days']], windowN, (v) => { windowN = v; renderInsights(root); }, { label: 'Analysis period' }),
    h('div.subhead', { style: { marginTop: '10px' } }, `${r.usableDays} usable day(s) of ${windowN}, up to ${r.end === today ? 'today' : 'yesterday'}. Days marked complete, or with at least half your calorie target logged, are used.`));

  root.append(h('div.alerts', { id: 'insight-alerts' }, r.alerts.map(alertEl)));
  if (r.usableDays) root.append(calorieChart(r), averagesCard(r));
  const wChart = weightChart(weights, today);
  if (wChart) root.append(wChart);
  root.append(h('div.card', {}, h('h3', {}, 'How these are worked out'),
    h('p.small', {}, `A nutrient average is only shown when at least ${Math.round(COVERAGE_MIN * 100)}% of that day’s calories come from foods with data for it, on enough days (${r.minDays} for ${windowN} days). “Persistent” means at least 60% of usable days were beyond the threshold.`),
    h('p.small', {}, 'Vitamins and minerals are compared with the ICMR-NIN 2020 Estimated Average Requirement (EAR) for “persistently low” and with the RDA for “below target”. Sodium is only ever checked for excess. This is decision support, not medical advice or a diagnosis.')));
}

function calorieChart(r) {
  const W = 340; const H = 150; const pad = 22;
  const T = app.targets.kcal.value || 0;
  const max = Math.max(T * 1.2, ...r.days.map((d) => d.totals.kcal || 0), 1);
  const bw = (W - pad) / r.days.length;
  const y = (v) => H - 18 - (v / max) * (H - 30);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `Daily calories for ${r.days.length} days versus target ${T}` });
  r.days.forEach((d, i) => {
    const v = d.totals.kcal || 0; const x = pad + i * bw + bw * 0.15;
    if (v > 0) svg.appendChild(s('rect', { x, y: y(v), width: bw * 0.7, height: H - 18 - y(v), rx: 2, class: `bar-k ${d.usable ? '' : 'inc'}` }, s('title', {}, `${shortDate(d.date)}: ${Math.round(v)} kcal${d.usable ? '' : ' (incomplete)'}`)));
    if (r.days.length <= 14 || i % 3 === 0) svg.appendChild(s('text', { x: x + bw * 0.35, y: H - 4, 'text-anchor': 'middle' }, d.date.slice(8)));
  });
  if (T) svg.appendChild(s('line', { x1: pad, x2: W, y1: y(T), y2: y(T), class: 'tline' }));
  svg.appendChild(s('text', { x: 0, y: y(T) + 3 }, String(T)));
  return h('div.card', {}, h('h3', {}, 'Calories per day'), svg, h('div.hint', {}, 'Dashed line = your target. Pale bars = incomplete days (not used in averages). Empty days are not zero, just not logged.'));
}

function averagesCard(r) {
  const T = app.targets;
  const rows = NUTRIENTS.filter((x) => T[x.key]?.kind !== 'info').map((x) => {
    const m = r.metrics[x.key]; const t = T[x.key];
    const has = m && isNum(m.mean);
    const pct = has && t.value ? Math.min(100, (m.mean / t.value) * 100) : 0;
    let cls = t.kind === 'max' ? 'limit' : '';
    if (has && t.kind === 'max' && m.mean > t.value) cls = 'bad';
    if (has && t.kind === 'rda' && m.mean < t.ear) cls = 'low';
    if (has && t.kind === 'min' && m.mean < t.value * 0.9) cls = 'low';
    if (has && t.kind === 'target') cls = m.mean > t.value * 1.1 ? 'bad' : m.mean < t.value * 0.8 ? 'low' : '';
    return h('div.avg-row', {}, h('span', {}, x.label), h('span.v', {}, has ? `${fmt(x.key, m.mean)} ${x.unit}` : 'not enough data'),
      h('div.bar', { class: cls }, h('span', { style: { width: `${pct}%` } })),
      h('div.meta', {}, `${t.kind === 'max' ? 'Limit' : t.kind === 'target' ? 'Target' : t.kind === 'rda' ? `RDA ${fmt(x.key, t.value)} · EAR ${fmt(x.key, t.ear)}` : 'Target'} ${t.kind === 'rda' ? '' : `${fmt(x.key, t.value)} ${INFO[x.key].unit}`}${m ? ` · data on ${m.n} day(s)` : ''}`));
  });
  return h('div.card', {}, h('h3', {}, `Daily averages (${r.n} days)`), rows);
}

function weightChart(weights, today) {
  const pts = weights.filter((w) => w.date >= addDays(today, -90)).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const W = 340; const H = 140; const pad = 30;
  const lo = Math.min(...pts.map((p) => p.kg)) - 0.5; const hi = Math.max(...pts.map((p) => p.kg)) + 0.5;
  const t0 = new Date(pts[0].date).getTime(); const t1 = Math.max(new Date(pts[pts.length - 1].date).getTime(), t0 + 86400000);
  const x = (d) => pad + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - pad - 8);
  const y = (kg) => 10 + (1 - (kg - lo) / (hi - lo)) * (H - 30);
  // 7-day trailing average
  const avg = pts.map((p) => { const win = pts.filter((q) => q.date <= p.date && q.date > addDays(p.date, -7)); return { date: p.date, kg: win.reduce((a, b) => a + b.kg, 0) / win.length }; });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Weight trend' });
  for (const g of [lo + 0.5, (lo + hi) / 2, hi - 0.5]) { svg.appendChild(s('line', { x1: pad, x2: W, y1: y(g), y2: y(g), class: 'grid' })); svg.appendChild(s('text', { x: 0, y: y(g) + 3 }, g.toFixed(1))); }
  svg.appendChild(s('path', { d: avg.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' '), class: 'wline' }));
  pts.forEach((p) => svg.appendChild(s('circle', { cx: x(p.date), cy: y(p.kg), r: 2.5, class: 'wdot' }, s('title', {}, `${shortDate(p.date)}: ${p.kg} kg`))));
  svg.appendChild(s('text', { x: pad, y: H - 4 }, shortDate(pts[0].date))); svg.appendChild(s('text', { x: W - 4, y: H - 4, 'text-anchor': 'end' }, shortDate(pts[pts.length - 1].date)));
  return h('div.card', {}, h('h3', {}, 'Weight'), svg, h('div.hint', {}, 'Dots = weigh-ins; line = 7-day average. Daily weight swings of 0.5–1 kg from water and food are normal.'));
}
export { rangeEnding };
