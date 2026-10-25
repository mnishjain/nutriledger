// Local food search. Rule: EVERY query word must match the food's name, aliases or brand
// (exactly, by prefix, or with one typo). Foods that do not match all words are excluded, never padded in.

const STOP = new Set(['with', 'and', 'of', 'the', 'a', 'an', 'in', 'ka', 'ki', 'ke', 'wala', 'wali', 'plain', 'fresh']);
const SYN = { // spelling variants common in Hinglish
  roti: ['chapati', 'phulka'], chapati: ['roti'], dahi: ['curd'], curd: ['dahi', 'yogurt'], yogurt: ['curd', 'dahi'],
  chawal: ['rice'], rice: ['chawal'], daal: ['dal'], dal: ['daal'], aloo: ['potato', 'aalu'], aalu: ['aloo'], potato: ['aloo'],
  gobhi: ['gobi'], gobi: ['gobhi', 'cauliflower'], subzi: ['sabzi'], sabji: ['sabzi'], sabzi: ['sabji', 'subzi'], bhaji: ['sabzi'],
  paratha: ['parantha'], parantha: ['paratha'], channa: ['chana'], chana: ['channa', 'chickpea'], chhole: ['chole'], chole: ['chhole'],
  moong: ['mung'], mung: ['moong'], badam: ['almond'], kaju: ['cashew'], akhrot: ['walnut'], pista: ['pistachio'],
  doodh: ['milk'], milk: ['doodh'], paneer: ['cottage'], anda: ['egg'], egg: ['anda'], chai: ['tea'], tea: ['chai'],
  makhana: ['foxnut', 'fox'], peanut: ['groundnut', 'moongphali'], groundnut: ['peanut'], namkeen: ['bhujia', 'mixture'],
};

export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%.]+/g, ' ').trim();
}
const stem = (t) => (t.length > 3 && t.endsWith('es') && !t.endsWith('ses') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
export function tokens(s) {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t)).map(stem);
}

function lev1(a, b) { // true if edit distance ≤ 1
  if (a === b) return true;
  const la = a.length; const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Same words allowing one typo per word (≥5 letters). */
function fuzzyEq(a, b) {
  return a.length === b.length && a.every((t, i) => t === b[i] || (t.length >= 5 && b[i].length >= 5 && lev1(t, b[i])));
}

/** Score one query token against a list of food tokens. 0 = no match. */
function tokenScore(q, fts) {
  let best = 0;
  const qs = [q, ...(SYN[q] || [])];
  for (const qq of qs) {
    const syn = qq !== q ? 0.9 : 1;
    for (const f of fts) {
      let s = 0;
      if (f === qq) s = 3;
      else if (f.startsWith(qq) && qq.length >= 2) s = 2.2;
      else if (qq.length >= 5 && f.length >= 5 && lev1(qq, f)) s = 1.6;
      else if (qq.length >= 4 && f.includes(qq)) s = 1.2;
      s *= syn;
      if (s > best) best = s;
    }
  }
  return best;
}

/** Build a search index entry once per food. */
export function indexFood(f) {
  const nameT = tokens(f.name);
  const aliasT = (f.aliases || []).flatMap(tokens);
  const brandT = tokens(f.brand || '');
  return { f, nameT, aliasT, brandT, aliasList: (f.aliases || []).map(tokens), all: [...new Set([...nameT, ...aliasT, ...brandT])], normName: normalize(f.name), normAliases: (f.aliases || []).map(normalize) };
}

const TIER = { meal: 6, user: 5, recipe: 3.5, label: 2.5, featured: 2.5, ifct: 1, usda: 0, off: 0.5 };

/**
 * rank(queryString, indexEntries, { stats, dietOk }) → [{ f, score }] sorted desc.
 * stats: Map(foodId → { count, lastUsed }) for personal boosting.
 */
export function rank(query, index, { stats = new Map(), dietOk = () => true, limit = 40 } = {}) {
  const qt = tokens(query);
  if (!qt.length) return [];
  const qn = normalize(query);
  const out = [];
  for (const e of index) {
    if (!dietOk(e.f)) continue;
    let total = 0; let ok = true;
    for (const q of qt) {
      const s = Math.max(tokenScore(q, e.nameT) * 1.15, tokenScore(q, e.aliasT), tokenScore(q, e.brandT) * 0.9);
      if (s === 0) { ok = false; break; }
      total += s;
    }
    if (!ok) continue;
    let score = total / qt.length * 10;
    if (e.normName === qn || fuzzyEq(qt, e.nameT)) score += 12;
    else if (e.normAliases.includes(qn) || e.aliasList.some((a) => fuzzyEq(qt, a))) score += 8;
    else if (e.normName.startsWith(qn)) score += 6;
    else if (e.normAliases.some((a) => a.startsWith(qn))) score += 4;
    const tier = e.f.kind === 'meal' ? 'meal' : e.f.userFood ? 'user' : e.f.id?.startsWith('f:') ? 'featured' : e.f.src;
    score += TIER[tier] ?? 0;
    const st = stats.get(e.f.id);
    if (st?.count) score += Math.min(10, Math.log2(1 + st.count) * 3);
    // People log cooked food; raw/dry ingredients rank lower unless the query asks for them
    if (/\b(dry|raw|uncooked)\b/.test(e.normName) && !qt.some((q) => ['dry', 'raw', 'uncooked', 'flour', 'atta'].includes(q))) score -= 6;
    score -= Math.max(0, e.nameT.length - 4) * 0.25; // prefer concise names
    out.push({ f: e.f, score });
  }
  out.sort((a, b) => b.score - a.score || a.f.name.length - b.f.name.length);
  return out.slice(0, limit);
}

/** Relevance filter for external results (e.g., Open Food Facts): all query tokens must appear in name+brand. */
export function relevantExternal(query, name, brand = '') {
  const qt = tokens(query);
  const ft = [...tokens(name), ...tokens(brand)];
  if (!qt.length || !ft.length) return false;
  return qt.every((q) => tokenScore(q, ft) > 0);
}
