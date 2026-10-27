// Gemini lookup logic against simulated Google responses (shapes from ai.google.dev API reference).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickModel, explainError, readResponse, lookupNutrition, testKey, cleanKey } from '../../js/api/gemini.js';
import { parseLabel } from '../../js/core/labelparse.js';

const KEY = 'AIzaSyTEST_KEY_1234567890abcdefghijk';
const MODELS = { models: [
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.9-flash-preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
] };
const ANSWER = { candidates: [{ content: { parts: [{ text: 'Haldiram\'s Aloo Bhujia, per 100 g:\nEnergy: 536 kcal\nProtein: 6.8 g\nCarbohydrate: 52.9 g\nTotal sugars: 2.6 g\nFibre: unknown\nFat: 33.2 g\nSaturated fat: 13.6 g\nSodium: 698 mg\nPotassium: unknown\nCalcium: unknown\nIron: unknown\nSource: Haldiram\'s pack label.' }] },
  groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.haldiram.com/aloo-bhujia', title: 'haldiram.com' } }, { web: { uri: 'https://www.haldiram.com/aloo-bhujia', title: 'dup' } }, { web: { uri: 'https://www.bigbasket.com/x', title: 'bigbasket.com' } }] } }] };
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); for (const [re, h] of routes) if (re.test(url)) return h(url, init, calls); throw new Error(`unrouted ${url}`); };
  f.calls = calls; return f;
}

test('model choice: newest stable Flash; skips lite, preview, tts, embedding', () => {
  assert.equal(pickModel(MODELS.models), 'gemini-3.8-flash');
  assert.equal(pickModel([{ name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] }]), 'gemini-2.5-flash');
  assert.equal(pickModel([{ name: 'models/gemini-3.8-flash-lite' }]), null);
});

test('one-tap lookup: correct request (key, model, Google Search tool, prompt) and sources read', async () => {
  const f = fakeFetch([[/\/models\?/, () => res(200, MODELS)], [/:generateContent/, () => res(200, ANSWER)]]);
  const out = await lookupNutrition('haldiram aloo bhujia', { key: KEY }, { fetchImpl: f });
  const gen = f.calls.find((c) => c.url.includes(':generateContent'));
  assert.ok(gen.url.includes('/models/gemini-3.8-flash:generateContent'));
  assert.equal(gen.init.headers['x-goog-api-key'], KEY, 'key sent in header');
  assert.ok(!gen.url.includes(KEY), 'key not in the web address');
  assert.deepEqual(gen.body.tools, [{ google_search: {} }]);
  assert.ok(gen.body.contents[0].parts[0].text.includes('"haldiram aloo bhujia"'));
  assert.equal(gen.body.generationConfig.temperature, 0);
  assert.equal(out.model, 'gemini-3.8-flash'); assert.equal(out.searched, true);
  assert.deepEqual(out.sources.map((s) => s.title), ['haldiram.com', 'bigbasket.com'], 'duplicates removed');
  const r = parseLabel(out.text, { source: 'text' });
  assert.equal(r.per100.kcal, 536); assert.equal(r.per100.sodium, 698); assert.equal(r.per100.fibre, undefined, 'unknown stays unknown');
});

test('saved model is reused (no model listing call)', async () => {
  const f = fakeFetch([[/:generateContent/, () => res(200, ANSWER)]]);
  await lookupNutrition('x', { key: KEY, model: 'gemini-2.5-flash' }, { fetchImpl: f });
  assert.equal(f.calls.length, 1);
});

test('if web search is not available for the key/model, retries without it and says so', async () => {
  let n = 0;
  const f = fakeFetch([[/:generateContent/, (u, init) => (++n === 1 ? res(400, { error: { code: 400, message: 'Search Grounding is not supported for this model.' } }) : res(200, ANSWER))]]);
  const out = await lookupNutrition('x', { key: KEY, model: 'gemini-2.5-flash' }, { fetchImpl: f });
  assert.equal(out.searched, false);
  assert.equal(f.calls[1].body.tools, undefined, 'second call has no tools');
});

test('if the chosen model is gone (404), falls back to another', async () => {
  const f = fakeFetch([[/\/models\?/, () => res(500, {})], [/gemini-2\.5-flash:generateContent/, () => res(404, { error: { message: 'not found' } })], [/gemini-2\.0-flash:generateContent/, () => res(200, ANSWER)]]);
  const out = await lookupNutrition('x', { key: KEY }, { fetchImpl: f });
  assert.equal(out.model, 'gemini-2.0-flash');
});

test('errors are explained in plain English', async () => {
  const cases = [
    [400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }, 'key', /not valid/],
    [403, { error: { message: 'Requests from referer https://mnishjain.github.io/ are blocked.' } }, 'restricted', /mnishjain\.github\.io/],
    [403, { error: { message: 'Generative Language API has not been used in project 123 before or it is disabled.' } }, 'disabled', /not enabled/],
    [429, { error: { message: 'Resource has been exhausted' } }, 'quota', /limit/],
    [503, {}, 'server', /problem/],
  ];
  for (const [st, body, code, re] of cases) { const e = explainError(st, body); assert.equal(e.code, code); assert.match(e.message, re); }
  await assert.rejects(lookupNutrition('x', { key: KEY, model: 'm' }, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), (e) => e.code === 'network');
  await assert.rejects(lookupNutrition('x', {}, { fetchImpl: async () => res(200, ANSWER) }), (e) => e.code === 'nokey');
  assert.throws(() => readResponse({ candidates: [{ finishReason: 'SAFETY' }] }), (e) => e.code === 'empty');
});

test('Test my key: real listing call, picks model, explains bad keys', async () => {
  const ok = await testKey(KEY, { fetchImpl: fakeFetch([[/\/models\?/, () => res(200, MODELS)]]) });
  assert.equal(ok.model, 'gemini-3.8-flash');
  await assert.rejects(testKey(KEY, { fetchImpl: fakeFetch([[/\/models\?/, () => res(400, { error: { message: 'API key not valid.' } })]]) }), (e) => e.code === 'key');
  await assert.rejects(testKey(KEY, { fetchImpl: fakeFetch([[/\/models\?/, () => res(200, { models: [{ name: 'models/gemini-embedding-2' }] })]]) }), (e) => e.code === 'model');
});

const AQ = 'AQ.Ab8RN6IdX1k2YpQ_example-Key.with.dots_0123456789abcdef';

test('new "AQ." keys: accepted, spaces/line breaks removed, junk rejected', () => {
  assert.equal(cleanKey(AQ), AQ);
  assert.equal(cleanKey(` ${AQ.slice(0, 20)}\n${AQ.slice(20)} `), AQ, 'pasted with a line break');
  assert.equal(cleanKey(KEY), KEY, 'old AIza keys still accepted');
  assert.equal(cleanKey('AQ.'), null); assert.equal(cleanKey('my key is AQ.Ab8RN6!'), null);
});

test('AQ. key: if Google rejects the header method, retries with ?key= and remembers it', async () => {
  const f = fakeFetch([[/\/models/, (u, init) => (init.headers?.['x-goog-api-key'] ? res(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }] } }) : res(200, MODELS))]]);
  const r = await testKey(AQ, { fetchImpl: f });
  assert.equal(r.auth, 'query'); assert.equal(r.model, 'gemini-3.8-flash');
  assert.ok(f.calls[1].url.includes(`key=${encodeURIComponent(AQ)}`));
  const g = fakeFetch([[/:generateContent/, (u, init) => (u.includes('key=') ? res(200, ANSWER) : res(401, { error: { status: 'UNAUTHENTICATED' } }))]]);
  const out = await lookupNutrition('x', { key: AQ, model: 'gemini-3.8-flash', auth: 'query' }, { fetchImpl: g });
  assert.equal(g.calls.length, 1, 'remembered method used first'); assert.equal(out.auth, 'query');
});

test('AQ. key: header works first time (no extra call)', async () => {
  const f = fakeFetch([[/\/models/, (u, init) => (init.headers?.['x-goog-api-key'] === AQ && !u.includes('key=') ? res(200, MODELS) : res(400, {}))]]);
  const r = await testKey(AQ, { fetchImpl: f });
  assert.equal(r.auth, 'header'); assert.equal(f.calls.length, 1);
});

test('a genuinely wrong key still says "not valid" after trying both ways', async () => {
  const f = fakeFetch([[/\/models/, () => res(400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } })]]);
  await assert.rejects(testKey(AQ, { fetchImpl: f }), (e) => e.code === 'key' && /not valid/.test(e.message));
  assert.equal(f.calls.length, 2);
});

test('saved model misbehaving for this key → retries an older proven model once', async () => {
  const f = fakeFetch([[/gemini-3\.8-flash:generateContent/, () => res(400, { error: { code: 400, message: 'Request contains an invalid argument.' } })], [/gemini-2\.5-flash:generateContent/, () => res(200, ANSWER)]]);
  const changes = [];
  const out = await lookupNutrition('x', { key: AQ, model: 'gemini-3.8-flash' }, { fetchImpl: f, onModel: (m) => changes.push(m) });
  assert.equal(out.model, 'gemini-2.5-flash'); assert.deepEqual(changes, ['gemini-2.5-flash']);
});
