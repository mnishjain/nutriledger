// Shared UI pieces.
import { h, icon } from './dom.js';
import { fmt, INFO, isNum } from '../core/nutrients.js';
import { SOURCES } from '../core/library.js';

export const kcal = (v) => (isNum(v) ? Math.round(v).toLocaleString('en-IN') : '—');
export const g1 = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toLocaleString('en-IN') : '—');

const CONF = {
  verified: ['verified', 'Verified data', 'Laboratory food-composition data (IFCT 2017 or USDA).'],
  label: ['label', 'Label', 'From a manufacturer label you or the app checked.'],
  'label-retailer': ['label', 'Label (retailer)', 'Label values as shown by a retailer; check your pack.'],
  estimate: ['estimate', 'Estimate', 'Calculated from a typical recipe; your cooking may differ.'],
  off: ['off', 'Open Food Facts', 'Crowd-sourced packaged-food data; usually matches the pack.'],
  'off-doubtful': ['doubt', 'Check values', 'Crowd-sourced data that failed a consistency check. Compare with the pack.'],
  user: ['user', 'Your entry', 'Values you entered.'],
  legacy: ['legacy', 'Old app', 'Logged in the previous version; values were not sourced.'],
};
export function confBadge(conf) {
  const c = CONF[conf] || CONF.user;
  return h('span.badge', { class: c[0], title: c[2] }, c[1]);
}
export function confExplain(conf) { return (CONF[conf] || CONF.user)[2]; }

export function sourceLine(food) {
  const parts = [];
  if (food.src && SOURCES[food.src]) parts.push(SOURCES[food.src].long);
  if (food.ref && !parts.includes(food.ref)) parts.push(food.ref);
  return parts.join(' · ');
}

const ALERT_ICON = { limit: 'warn', 'pattern-high': 'warn', caution: 'warn', 'pattern-low': 'warn', below: 'info', notice: 'info', insufficient: 'info', info: 'info' };
export function alertEl(a) {
  return h('div.alert', { class: a.level, role: ['limit', 'caution', 'pattern-high'].includes(a.level) ? 'alert' : 'note' },
    icon(ALERT_ICON[a.level] || 'info', 20),
    h('div', {}, h('div', {}, a.message), a.detail ? h('div.detail', {}, a.detail) : null, a.source ? h('div.detail', {}, `Source: ${a.source}`) : null));
}

/** "≥ 1,240 mg" when coverage is partial, "unknown" when none. */
export function valueWithCoverage(key, total, coverage) {
  if (!isNum(total)) return 'unknown';
  const pre = coverage < 0.999 ? '≥ ' : '';
  return `${pre}${fmt(key, total)} ${INFO[key].unit}`;
}
export function coverageNote(coverage) {
  if (coverage >= 0.999) return '';
  if (coverage <= 0) return 'no data';
  return `${Math.round(coverage * 100)}% of calories have data`;
}

export function foodSummary(food, grams, n) {
  return `${kcal(n.kcal)} kcal · ${g1(n.protein)} g protein`;
}
