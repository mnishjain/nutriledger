// Daily and multi-day analysis. Non-diagnostic decision support.
//
// Alert levels (what the user sees):
//   limit        – an upper limit (sodium, saturated fat) is already exceeded today/that day. Fact, not a guess.
//   pattern-high – persistent over-consumption across the window.
//   pattern-low  – persistent under-consumption across the window (below EAR for vitamins/minerals).
//   below        – average below the selected target (RDA) but not a persistent shortfall.
//   caution      – sustained very low calorie intake or rapid weight loss.
//   notice       – mild/one-off observations (e.g., calories above target on a day).
//   insufficient – the record cannot support a conclusion.
//   info         – context (e.g., why low sodium is never flagged).
import { dayTotals } from './entries.js';
import { isNum, INFO, fmt } from './nutrients.js';
import { rangeEnding, addDays, daysBetween } from './dates.js';

export const COVERAGE_MIN = 0.8;      // a day's nutrient total is used only if ≥80% of calories have data for it
export const PERSIST_SHARE = 0.6;     // "persistent" = at least 60% of usable days beyond threshold
export const INCOMPLETE_SHARE = 0.5;  // a past day under 50% of calorie target is treated as likely incomplete unless marked complete
export const minDaysFor = (n) => Math.max(4, Math.ceil(n * 0.5));
const ORDER = ['caution', 'pattern-high', 'pattern-low', 'limit', 'below', 'notice', 'insufficient', 'info'];
const label = (k) => INFO[k]?.label || k;
const u = (k) => INFO[k]?.unit || '';
const val = (k, v) => `${fmt(k, v)} ${u(k)}`;

/** Status of one day: empty | in-progress | complete | likely-incomplete | logged */
export function dayStatus({ date, today, entries, complete, kcalTarget }) {
  if (!entries.length) return complete ? 'complete' : 'empty';
  if (complete) return 'complete';
  if (date >= today) return 'in-progress';
  const kcal = dayTotals(entries).totals.kcal || 0;
  if (isNum(kcalTarget) && kcal < kcalTarget * INCOMPLETE_SHARE) return 'likely-incomplete';
  return 'logged';
}

/** Alerts for one day. Never warns about "below target" while the day is still in progress. */
export function analyzeDay({ date, today, entries, complete = false, targets }) {
  const { totals, coverage } = dayTotals(entries);
  const status = dayStatus({ date, today, entries, complete, kcalTarget: targets.kcal?.value });
  const alerts = [];
  if (!entries.length) return { totals, coverage, status, alerts };
  for (const k of ['sodium', 'satfat']) {
    const t = targets[k];
    if (t?.kind === 'max' && isNum(t.value) && isNum(totals[k]) && totals[k] > t.value) {
      alerts.push({ level: 'limit', nutrient: k, message: `${label(k)} limit exceeded: ${val(k, totals[k])} recorded vs limit ${val(k, t.value)}.`,
        detail: coverage[k] < 1 ? 'Some foods have no data for this nutrient, so the true amount may be higher.' : '', source: t.source });
    }
  }
  const kt = targets.kcal?.value;
  if (isNum(kt) && isNum(totals.kcal) && totals.kcal > kt * 1.05) {
    alerts.push({ level: 'notice', nutrient: 'kcal', message: `Calories ${Math.round(totals.kcal)} are above the ${kt} kcal target${status === 'in-progress' ? ' so far today' : ''}.`, detail: 'One day above target is normal; the trend is what matters.' });
  }
  if (status === 'complete' || status === 'logged') {
    for (const k of ['protein', 'fibre']) {
      const t = targets[k];
      if (!isNum(t?.value) || !isNum(totals[k])) continue;
      if (coverage[k] < COVERAGE_MIN) continue;
      if (totals[k] < t.value) alerts.push({ level: 'below', nutrient: k, message: `${label(k)} ${val(k, totals[k])} was below the ${val(k, t.value)} target.` });
    }
  }
  if (status === 'likely-incomplete') alerts.push({ level: 'insufficient', message: 'This day looks incompletely logged (under half the calorie target). Mark it complete if it really was.' });
  alerts.sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  return { totals, coverage, status, alerts };
}

function slopePerWeek(points) {
  // least-squares slope (kg/day) × 7
  const n = points.length; if (n < 2) return null;
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0; let den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? null : (num / den) * 7;
}

/**
 * Window analysis over N days ending at `today` (today counts only if marked complete).
 * entriesByDate: { 'YYYY-MM-DD': [entries] }, completeDays: Set of dates, weights: [{date, kg}]
 */
export function analyzeWindow({ today, n, entriesByDate, completeDays = new Set(), targets, profile = {}, weights = [] }) {
  const end = completeDays.has(today) ? today : addDays(today, -1);
  const dates = rangeEnding(end, n);
  const kcalT = targets.kcal?.value;
  const days = dates.map((d) => {
    const entries = entriesByDate[d] || [];
    const status = dayStatus({ date: d, today, entries, complete: completeDays.has(d), kcalTarget: kcalT });
    const { totals, coverage } = dayTotals(entries);
    return { date: d, status, totals, coverage, usable: status === 'complete' || status === 'logged' };
  });
  const usable = days.filter((d) => d.usable && (d.totals.kcal || 0) > 0);
  const minDays = minDaysFor(n);
  const alerts = []; const metrics = {};
  const logged = days.filter((d) => d.status !== 'empty').length;

  if (usable.length < minDays) {
    alerts.push({ level: 'insufficient', message: `Not enough complete days to judge a ${n}-day trend: ${usable.length} usable of ${n} (need ${minDays}).`,
      detail: logged > usable.length ? `${logged - usable.length} logged day(s) look incomplete. Mark days complete on the Today screen when you have logged everything.` : 'Log full days, then mark them complete.' });
    return { n, end, days, usableDays: usable.length, minDays, metrics, alerts };
  }

  const keys = ['kcal', 'protein', 'fibre', 'satfat', 'sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'vitc', 'folate', 'b12', 'carbs', 'fat', 'sugar'];
  const lacking = [];
  for (const k of keys) {
    const vals = usable.filter((d) => k === 'kcal' || d.coverage[k] >= COVERAGE_MIN).map((d) => d.totals[k]).filter(isNum);
    const t = targets[k];
    if (vals.length < minDays) { metrics[k] = { mean: null, n: vals.length }; if (t && t.kind !== 'info') lacking.push(k); continue; }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const m = { mean, n: vals.length, min: Math.min(...vals), max: Math.max(...vals) };
    metrics[k] = m;
    if (!t || !isNum(t.value)) continue;
    const share = (pred) => vals.filter(pred).length / vals.length;
    if (k === 'kcal') {
      m.shareAbove = share((v) => v > t.value * 1.05);
      if (mean > t.value * 1.1 && m.shareAbove >= PERSIST_SHARE) alerts.push({ level: 'pattern-high', nutrient: k, message: `Calories consistently above target: average ${Math.round(mean)} vs ${t.value} kcal on ${Math.round(m.shareAbove * 100)}% of days.`, detail: profile.goal === 'lose' ? 'At this level, fat loss is likely to stall.' : '' });
      else if (mean > t.value * 1.05) alerts.push({ level: 'notice', nutrient: k, message: `Calories averaging a little above target (${Math.round(mean)} vs ${t.value} kcal).` });
      const floor = t.floor;
      if (isNum(floor) && mean < floor && vals.length >= 7) alerts.push({ level: 'caution', nutrient: k, message: `Sustained low intake: average ${Math.round(mean)} kcal is below ${floor} kcal.`, detail: 'Eating this little for long makes it hard to meet protein and micronutrient needs and to keep muscle. If this is intentional, consider discussing it with a doctor or dietitian.', source: 'Clinical convention' });
      else if (mean < t.value * 0.8) alerts.push({ level: 'notice', nutrient: k, message: `Average logged calories (${Math.round(mean)}) are well below the ${t.value} kcal target.`, detail: 'Either intake is low or some foods are not being logged.' });
      continue;
    }
    if (t.kind === 'max') {
      m.shareAbove = share((v) => v > t.value);
      if (mean > t.value && m.shareAbove >= PERSIST_SHARE) alerts.push({ level: 'pattern-high', nutrient: k, message: `${k === 'sodium' ? 'Potentially excessive sodium' : `${label(k)} consistently above limit`}: average ${val(k, mean)} vs limit ${val(k, t.value)}.`, source: t.source });
      else if (m.shareAbove > 0) alerts.push({ level: 'notice', nutrient: k, message: `${label(k)} exceeded the ${val(k, t.value)} limit on ${Math.round(m.shareAbove * 100)}% of days.` });
      continue;
    }
    if (t.kind === 'min') {
      const thr = k === 'protein' ? t.value * 0.9 : t.value;
      m.shareBelow = share((v) => v < thr);
      if (mean < thr && m.shareBelow >= PERSIST_SHARE) alerts.push({ level: 'pattern-low', nutrient: k, message: `${k === 'fibre' ? 'Inadequate recorded fibre' : `${label(k)} consistently below target`}: average ${val(k, mean)} vs target ${val(k, t.value)}.`, detail: k === 'protein' && isNum(t.ear) && mean < t.ear ? 'This is also below the basic ICMR average requirement.' : '', source: t.source });
      else if (mean < t.value) alerts.push({ level: 'below', nutrient: k, message: `${label(k)} averaging ${val(k, mean)}, below the ${val(k, t.value)} target.` });
      continue;
    }
    if (t.kind === 'rda') {
      m.shareBelow = share((v) => v < t.ear);
      if (mean < t.ear && m.shareBelow >= PERSIST_SHARE) alerts.push({ level: 'pattern-low', nutrient: k, message: `Recorded ${label(k).toLowerCase()} persistently below the average requirement: ${val(k, mean)} vs EAR ${val(k, t.ear)} (RDA ${val(k, t.value)}).`, detail: 'Based on recorded food only; supplements and unrecorded foods are not counted. Not a diagnosis.', source: t.source });
      else if (mean < t.value) alerts.push({ level: 'below', nutrient: k, message: `${label(k)} averaging ${val(k, mean)}, below the RDA of ${val(k, t.value)}.` });
    }
  }
  if (lacking.length) alerts.push({ level: 'insufficient', message: `Not enough nutrient data to judge: ${lacking.map(label).join(', ')}.`, detail: 'These nutrients are missing for many logged foods (common for packaged and restaurant items). Missing values are never counted as zero.' });
  if (metrics.sodium?.mean !== null && metrics.sodium?.mean !== undefined && metrics.sodium.mean < 2000) {
    alerts.push({ level: 'info', nutrient: 'sodium', message: 'Low recorded sodium is not a sign of deficiency; salt added while cooking or eating is often unrecorded.' });
  }
  // Weight trend
  const recentW = weights.filter((w) => daysBetween(w.date, today) <= 28 && daysBetween(w.date, today) >= 0).sort((a, b) => a.date.localeCompare(b.date));
  if (recentW.length >= 3 && daysBetween(recentW[0].date, recentW[recentW.length - 1].date) >= 14) {
    const slope = slopePerWeek(recentW.map((w) => ({ x: daysBetween(recentW[0].date, w.date), y: w.kg })));
    const last = recentW[recentW.length - 1].kg;
    if (isNum(slope) && slope < -0.01 * last) alerts.push({ level: 'caution', message: `Weight falling about ${Math.abs(slope).toFixed(2)} kg/week (over 1% of body weight per week).`, detail: 'Faster loss increases the risk of losing muscle. Consider a smaller deficit.' });
    metrics.weightSlope = slope;
  }
  alerts.sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  return { n, end, days, usableDays: usable.length, minDays, metrics, alerts };
}
