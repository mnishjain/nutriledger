// Native Element.append() prints null/false as text ("null"). Make it skip empty values and flatten arrays,
// so conditional children are always safe. Applies only to this app's page.
if (typeof Element !== 'undefined' && !Element.prototype.__nlSafeAppend) {
  const native = Element.prototype.append;
  Element.prototype.append = function (...kids) { return native.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); };
  Element.prototype.__nlSafeAppend = true;
}

// Tiny DOM builder. All text goes through textContent, so user data can never inject HTML.
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// SVG icons (inline, no external requests)
const ICONS = {
  plus: 'M12 5v14M5 12h14', back: 'M15 18l-6-6 6-6', fwd: 'M9 18l6-6-6-6', close: 'M6 6l12 12M18 6L6 18',
  today: 'M4 6h16M4 12h16M4 18h10', meals: 'M4 7h16M6 7v11a2 2 0 002 2h8a2 2 0 002-2V7M9 4h6', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  more: 'M5 12h.01M12 12h.01M19 12h.01', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5', barcode: 'M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'M5 13l4 4L19 7', warn: 'M12 3l10 18H2zM12 10v5M12 18h.01', info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7h.01', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8zM4 16V4h12', star: 'M12 3l2.9 6 6.1.6-4.6 4.2 1.3 6.2L12 17l-5.7 3 1.3-6.2L3 9.6 9.1 9z', scale: 'M12 3v18M5 7h14M5 7l-3 7h6zM19 7l-3 7h6z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', down: 'M6 9l6 6 6-6', share: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
};
export function icon(name, size = 22) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name] || ''); s.appendChild(p);
  return s;
}

let toastTimer = null;
export function toast(msg, { action = null, actionLabel = 'Undo', ms = 2200, tone = 'normal' } = {}) {
  const t = $('#toast'); clear(t); t.className = `toast show ${tone}`;
  t.appendChild(h('span', {}, msg));
  if (action) t.appendChild(h('button.toast-action', { type: 'button', onclick: () => { hideToast(); action(); } }, actionLabel));
  clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, action ? Math.max(ms, 5000) : ms);
}
export function hideToast() { const t = $('#toast'); if (t) t.className = 'toast'; }

/** Full-screen sheet stack. Returns { el, body, close }. */
const stack = [];
export function openSheet({ title, onClose, actions = null, className = '' } = {}) {
  const body = h('div.sheet-body');
  const titleEl = h('h2.sheet-title', { id: `sheet-t-${stack.length}` }, title || '');
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('close'));
  const head = h('header.sheet-head', {}, closeBtn, titleEl, h('div.sheet-actions', {}, actions || []));
  const el = h('section.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleEl.id, class: className }, head, body);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  document.body.classList.add('sheet-open');
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    el.classList.remove('open');
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    setTimeout(() => el.remove(), 220);
    if (!stack.length) document.body.classList.remove('sheet-open');
    onClose?.(result);
  }
  const api = { el, body, close, setTitle: (t) => { titleEl.textContent = t; }, head };
  stack.push(api);
  return api;
}
export function closeAllSheets() { [...stack].reverse().forEach((s) => s.close()); }
export function topSheet() { return stack[stack.length - 1] || null; }

export function field(label, input, hint = null) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`; input.id = id;
  return h('div.field', {}, h('label', { for: id }, label), input, hint ? h('div.hint', {}, hint) : null);
}
export function numInput(props = {}) {
  return h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', ...props });
}
/** Parse a user-typed number. '' → null (unknown); invalid → NaN. */
export function readNum(el) {
  const s = String(el.value ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
export function segmented(options, value, onChange, { label = '', wrap: wrapRows = false } = {}) {
  const wrap = h('div.segmented', { role: 'radiogroup', 'aria-label': label, class: wrapRows || options.length > 3 ? 'wrap' : '' });
  for (const [v, text] of options) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', onclick: () => {
      wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('on'); b.setAttribute('aria-checked', 'true'); onChange(v);
    } }, text);
    wrap.appendChild(b);
  }
  return wrap;
}
export function confirmAction(msg) { return window.confirm(msg); }
