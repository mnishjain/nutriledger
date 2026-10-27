// Optional one-tap nutrition lookup with the user's own Gemini API key (Google AI Studio).
// The key is stored only on this device (IndexedDB meta), never in backups, exports or the code.
// Answers can be wrong: results are always shown for checking and saved as "Estimate".
import { aiPrompt } from '../core/prompt.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const TIMEOUT_MS = 45000;

export class GeminiError extends Error {
  constructor(code, message, detail = '') { super(message); this.code = code; this.detail = detail; }
}

/** Turn an HTTP status + Google error body into a plain-English error. */
export function explainError(status, body) {
  const msg = body?.error?.message || '';
  const reason = JSON.stringify(body?.error?.details || '') + msg;
  if (status === 400 && /API[_ ]KEY[_ ]INVALID|API key not valid/i.test(reason)) return new GeminiError('key', 'This Gemini key is not valid. Copy it again from Google AI Studio.', msg);
  if (status === 401 || /ACCESS_TOKEN_TYPE_UNSUPPORTED|UNAUTHENTICATED/i.test(reason)) return new GeminiError('auth', 'Google did not accept the key in this form.', msg);
  if (status === 403 && /referer|referrer/i.test(reason)) return new GeminiError('restricted', 'The key is restricted to other websites. In Google AI Studio / Cloud Console, allow mnishjain.github.io/* for this key, or use a separate key.', msg);
  if (status === 403 && /(has not been used|disabled|not enabled|SERVICE_DISABLED)/i.test(reason)) return new GeminiError('disabled', 'The Gemini API is not enabled for this key’s project. Create the key in Google AI Studio, which enables it automatically.', msg);
  if (status === 403) return new GeminiError('denied', 'Google refused this key (permission denied). Check the key’s restrictions in Google AI Studio.', msg);
  if (status === 429) return new GeminiError('quota', 'The free Gemini limit for this key is used up for now (it is shared with anything else using the same key). Try later, or use “Ask Google AI”.', msg);
  if (status === 404) return new GeminiError('model', 'This Gemini model is not available to your key.', msg);
  if (status >= 500) return new GeminiError('server', 'Google’s AI service had a problem. Try again in a minute.', msg);
  return new GeminiError('http', `Gemini returned an error (HTTP ${status}).`, msg);
}

async function call(fetchImpl, url, init = {}) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  let r;
  try { r = await fetchImpl(url, { ...init, signal: ctl?.signal }); }
  catch (e) {
    if (e?.name === 'AbortError') throw new GeminiError('timeout', 'Gemini did not answer in time. Try again.');
    throw new GeminiError('network', 'No internet connection, or Google’s AI service is unreachable.');
  } finally { if (t) clearTimeout(t); }
  let body = null; try { body = await r.json(); } catch { body = null; }
  if (!r.ok) throw explainError(r.status, body);
  return body;
}

/**
 * Call with the key either in the x-goog-api-key header (Google's SDK default; needed by new "AQ." keys
 * in some setups, and keeps the key out of URLs) or as ?key= (classic). Tries the saved/preferred way first,
 * then the other way once if Google rejects the method. Returns { body, auth }.
 */
async function authed(fetchImpl, path, init, key, prefer = 'header') {
  const go = (mode) => {
    const sep = path.includes('?') ? '&' : '?';
    const url = mode === 'query' ? `${BASE}${path}${sep}key=${encodeURIComponent(key)}` : `${BASE}${path}`;
    const headers = { ...(init.headers || {}), ...(mode === 'header' ? { 'x-goog-api-key': key } : {}) };
    return call(fetchImpl, url, { ...init, headers }).then((body) => ({ body, auth: mode }));
  };
  const first = prefer === 'query' ? 'query' : 'header';
  const second = first === 'header' ? 'query' : 'header';
  try { return await go(first); }
  catch (e) {
    if (!['auth', 'key', 'network'].includes(e.code)) throw e;
    try { return await go(second); }
    catch (e2) { throw (e.code === 'key' && e2.code !== 'network') ? e2 : (e2.code === 'network' ? e : e2); }
  }
}

/** Remove spaces/line breaks people paste by accident. Returns null if it cannot be a Google key. */
export function cleanKey(raw) {
  const k = String(raw || '').replace(/\s+/g, '');
  return /^[A-Za-z0-9._-]{20,300}$/.test(k) ? k : null;
}

/** Choose the newest stable "Flash" model that supports generateContent (names change over time). */
export function pickModel(models) {
  const ok = (m) => {
    const methods = m.supportedGenerationMethods || m.supportedActions;
    return !methods || methods.includes('generateContent');
  };
  const scored = (models || []).filter(ok).map((m) => String(m.name || '').replace(/^models\//, ''))
    .map((n) => ({ n, m: n.match(/^gemini-(\d+(?:\.\d+)?)-flash$/) })) // stable flash only: no lite/preview/image/tts/live
    .filter((x) => x.m).map((x) => ({ n: x.n, v: Number(x.m[1]) }))
    .sort((a, b) => b.v - a.v);
  return scored[0]?.n || null;
}

export async function listModels(key, { fetchImpl = globalThis.fetch, auth } = {}) {
  const { body, auth: used } = await authed(fetchImpl, '/models?pageSize=1000', {}, key, auth);
  const models = body?.models || [];
  models.auth = used;
  return models;
}

/** Extract answer text and web sources from a generateContent response. */
export function readResponse(body) {
  const cand = body?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const seen = new Set(); const sources = [];
  for (const c of chunks) {
    const u = c?.web?.uri; if (!u || seen.has(u)) continue; seen.add(u);
    sources.push({ url: u, title: c.web.title || u });
  }
  if (!text) {
    const why = cand?.finishReason || body?.promptFeedback?.blockReason || 'empty';
    throw new GeminiError('empty', 'Gemini returned no answer for this food. Try a more specific name.', why);
  }
  return { text, sources };
}

const isToolError = (e) => e instanceof GeminiError && e.code === 'http' && /tool|search|google_search|grounding/i.test(e.detail || '');

/**
 * Ask Gemini (with Google Search grounding when available) for nutrition per 100 g.
 * Returns { text, sources, model, searched }.
 */
export async function lookupNutrition(name, cfg, { fetchImpl = globalThis.fetch, onModel = null } = {}) {
  if (!cfg?.key) throw new GeminiError('nokey', 'Add your Gemini key first (More → Gemini lookup).');
  let auth = cfg.auth || 'header';
  let model = cfg.model;
  if (!model) {
    try { const ms = await listModels(cfg.key, { fetchImpl, auth }); auth = ms.auth; model = pickModel(ms) || FALLBACK_MODELS[0]; }
    catch (e) { if (['key', 'auth', 'restricted', 'disabled', 'denied', 'network'].includes(e.code)) throw e; model = FALLBACK_MODELS[0]; }
    onModel?.(model, auth);
  }
  const prompt = `${aiPrompt(name)} Use Google Search to check current, reliable sources (manufacturer, IFCT/NIN, USDA).`;
  const req = async (m, withSearch) => {
    const r = await authed(fetchImpl, `/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(withSearch ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { temperature: 0 },
      }),
    }, cfg.key, auth);
    auth = r.auth; return r.body;
  };
  let body; let searched = true;
  try { body = await req(model, true); }
  catch (e) {
    if (isToolError(e)) { searched = false; body = await req(model, false); }
    else if (['model', 'server', 'http'].includes(e.code)) {
      // The chosen model may be unavailable or misbehaving for this key: try a proven older model once
      const alt = FALLBACK_MODELS.find((x) => x !== model);
      try { body = await req(alt, true); model = alt; onModel?.(model, auth); }
      catch (e2) { if (isToolError(e2)) { searched = false; body = await req(alt, false); model = alt; onModel?.(model, auth); } else throw e; }
    } else throw e;
  }
  return { ...readResponse(body), model, searched, auth };
}

/** A real, cheap call used by "Test my key": lists models and picks one. No search quota is used. */
export async function testKey(key, { fetchImpl = globalThis.fetch } = {}) {
  const models = await listModels(key, { fetchImpl });
  const model = pickModel(models);
  if (!model) throw new GeminiError('model', 'The key works, but no suitable Gemini Flash model is available to it.', models.map((m) => m.name).slice(0, 8).join(', '));
  return { model, count: models.length, auth: models.auth };
}
