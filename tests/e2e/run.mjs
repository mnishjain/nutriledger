#!/usr/bin/env node
// End-to-end tests in headless Chromium with an iPhone-sized viewport.
// NOTE: this is SIMULATED browser testing. It is not iPhone Safari (WebKit); see docs/IPHONE_ACCEPTANCE.md.
// Usage: node tests/e2e/run.mjs [filter]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test-results'); fs.mkdirSync(OUT, { recursive: true });
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const FILTER = process.argv[2] || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm' };

// Static server that mimics GitHub Pages: site served under /nutriledger/, beta under /nutriledger/beta/
let SERVE_ROOT = ROOT; let SW_SUFFIX = '';
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const ROOT = SERVE_ROOT;
  if (!u.startsWith('/nutriledger/')) { res.writeHead(404); return res.end(); }
  u = u.replace(/^\/nutriledger\/(beta\/)?/, '/');
  let f = path.join(ROOT, u);
  if (f.endsWith('/')) f += 'index.html';
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  if (SW_SUFFIX && f.endsWith('sw.js')) return res.end(fs.readFileSync(f, 'utf8').replace(/const VERSION = '[^']+'/, `const VERSION = 'next-${SW_SUFFIX}'`));
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/nutriledger/`;
const browser = await chromium.launch({ executablePath: EXE });
const iphone = devices['iPhone 13'];

const results = []; const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (c, m) => { if (!c) throw new Error(`Assertion failed: ${m}`); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, t, m) => { if (!(Math.abs(a - b) <= t)) throw new Error(`${m}: expected ${b} ± ${t}, got ${a}`); };

async function newCtx(opts = {}) {
  const ctx = opts.userDataDir
    ? await chromium.launchPersistentContext(opts.userDataDir, { executablePath: EXE, ...iphone, serviceWorkers: opts.sw ? 'allow' : 'block', ...opts.ctx })
    : await browser.newContext({ ...iphone, serviceWorkers: opts.sw ? 'allow' : 'block', acceptDownloads: true, ...opts.ctx });
  const page = ctx.pages?.()[0] || await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept(page.nextPrompt ?? 'My meal') : d.accept());
  return { ctx, page };
}
async function open(page, url = BASE) { await page.goto(url); await page.waitForFunction(() => window.__nlReady === true, null, { timeout: 15000 }); }
async function setupProfile(page, name = 'Manish', { age = '47', height = '168', weight = '72' } = {}) {
  const s = page.locator('.sheet.open').last();
  await s.locator('#profile-save').waitFor();
  await s.getByLabel('Name', { exact: true }).fill(name);
  await s.getByLabel('Age (years)').fill(age); await s.getByLabel('Height (cm)').fill(height); await s.getByLabel('Weight (kg)').fill(weight);
  await s.locator('#profile-save').click();
  await page.waitForSelector('#kcal-left');
}
async function addFood(page, query, { pick = 0, qty = null, fat = null, portion = null } = {}) {
  await page.click('#tab-add');
  const sheet = page.locator('.sheet.open').last();
  await sheet.locator('input[type=search]').fill(query);
  await page.waitForTimeout(250);
  await sheet.locator('#results .row').nth(pick).click();
  const ps = page.locator('.sheet.open').last();
  if (portion) await ps.locator('.chip', { hasText: portion }).first().click();
  if (qty !== null) await ps.getByLabel('Quantity').fill(String(qty));
  if (fat !== null) await ps.getByRole('radio', { name: fat, exact: true }).click();
  await ps.locator('#add-to-diary').click();
  await page.waitForTimeout(300);
  await page.locator('.sheet.open').last().locator('.link-btn', { hasText: 'Done' }).click().catch(() => {});
  await page.waitForTimeout(300);
}
const appEval = (page, fn, arg) => page.evaluate(fn, arg);
const dayEntries = (page, date) => appEval(page, async (d) => { const a = window.__nl; return a.store.entriesOn(a.profile.id, d || a.date); }, date);
const kcalEaten = async (page) => Number((await page.textContent('#kcal-eaten')).replace(/,/g, ''));

// ---------------------------------------------------------------- tests
test('first run: profile setup computes targets and shows Today', async () => {
  const { ctx, page } = await newCtx();
  await open(page);
  await setupProfile(page);
  const t = await appEval(page, () => window.__nl.targets);
  eq(t.kcal.value, 1730, 'calorie target'); eq(t.protein.value, 115, 'protein target');
  eq(await page.textContent('#kcal-left'), '1,730', 'hero shows full budget');
  assert(page.errors.length === 0, `console errors: ${page.errors}`);
  await page.screenshot({ path: `${OUT}/today-empty.png` });
  await ctx.close();
});

test('search & log: 2 chapatis with 1 tsp ghee each = 280 kcal', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await addFood(page, 'roti', { qty: 2, fat: '5 g (1 tsp)' });
  const e = await dayEntries(page);
  eq(e.length, 1, 'one entry'); near(e[0].n.kcal, 2 * 96.1 + 2 * 44.2, 1.5, 'kcal'); eq(e[0].items[0].fat.perUnit, 5, 'fat recorded');
  near(await kcalEaten(page), 281, 2, 'dashboard total');
  await page.screenshot({ path: `${OUT}/today-one-entry.png` });
  assert(page.errors.length === 0, page.errors.join('\n'));
  await ctx.close();
});

test('persistence: entries survive reload AND full app restart (same storage)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-'));
  let { ctx, page } = await newCtx({ userDataDir: dir }); await open(page); await setupProfile(page);
  await addFood(page, 'banana');
  await page.reload(); await page.waitForFunction(() => window.__nlReady);
  eq((await dayEntries(page)).length, 1, 'after reload');
  await ctx.close();
  ({ ctx, page } = await newCtx({ userDataDir: dir })); await open(page);
  eq((await dayEntries(page)).length, 1, 'after restart');
  assert((await page.textContent('#app')).includes('Banana'), 'entry visible after restart');
  await ctx.close();
});

test('regression D1: Add screen always shows the target date; past-date entries are visible there', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await page.click('[aria-label="Previous day"]');
  await page.click('#tab-add');
  const pill = await page.locator('.sheet.open .pill').first().textContent();
  assert(pill.includes('Yesterday'), `pill says ${pill}`);
  await page.locator('.sheet.open .link-btn', { hasText: 'Done' }).click();
  await addFood(page, 'apple');
  const yesterday = await appEval(page, () => window.__nl.date);
  eq((await dayEntries(page, yesterday)).length, 1, 'logged to yesterday as shown');
  await page.click('#back-to-today');
  await page.waitForFunction(() => document.querySelector('#day-title')?.textContent === 'Today', null, { timeout: 5000 });
  await ctx.close();
});

test('regression D6: date rolls over at midnight while the app stays open', async () => {
  const { ctx, page } = await newCtx();
  await page.clock.install({ time: new Date('2026-10-25T23:58:00') });
  await open(page); await setupProfile(page);
  await addFood(page, 'chai');
  await page.clock.runFor(5 * 60 * 1000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(400);
  eq(await appEval(page, () => window.__nl.date), '2026-10-26', 'date advanced');
  eq((await dayEntries(page, '2026-10-25')).length, 1, 'chai stays on 25th');
  eq((await dayEntries(page, '2026-10-26')).length, 0, 'new day empty');
  await ctx.close();
});

test('regression D2: blank calories are refused, never saved as 0', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await page.click('#tab-add');
  await page.locator('.sheet.open').last().locator('.quick-actions button', { hasText: 'New food' }).click();
  const s = page.locator('.sheet.open').last();
  await s.getByLabel('Name', { exact: true }).fill('Test food'); await s.getByLabel('Protein (g)').fill('5');
  await s.locator('#food-save').click();
  await page.waitForTimeout(300);
  eq(await appEval(page, () => window.__nl.userFoods.length), 0, 'not saved');
  assert(await s.getByLabel('Calories (kcal)').evaluate((e) => e.classList.contains('bad')), 'calories highlighted');
  await ctx.close();
});

test('regression D3: saved meals keep all nutrients; editing meal never changes history', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await page.click('#tab-meals'); await page.click('#new-meal');
  let s = page.locator('.sheet.open').last();
  await s.getByLabel('Meal name').fill('Dal roti');
  await s.locator('#meal-add-item').click();
  for (const q of ['toor dal', 'roti']) {
    const add = page.locator('.sheet.open').last();
    await add.locator('input[type=search]').fill(q); await page.waitForTimeout(250);
    await add.locator('#results .row').first().click();
    await page.locator('.sheet.open').last().locator('#add-to-diary').click();
    await page.waitForTimeout(350);
    if (q === 'toor dal') await page.locator('.sheet.open').last().locator('#meal-add-item').click();
  }
  s = page.locator('.sheet.open').last();
  await s.locator('#meal-save').click(); await page.waitForTimeout(300);
  const meal = await appEval(page, () => window.__nl.meals[0]);
  eq(meal.items.length, 2, 'two items');
  assert(meal.items.every((i) => i.n.sodium !== null && i.n.iron !== null), 'micronutrients kept');
  await page.locator('.row .main', { hasText: 'Dal roti' }).click();
  await page.locator('#log-meal').click(); await page.waitForTimeout(300);
  const tab = await appEval(page, () => window.__nl.date);
  const [e] = await dayEntries(page, tab);
  near(e.n.sodium, meal.items[0].n.sodium + meal.items[1].n.sodium, 0.01, 'sodium carried');
  const before = e.n.kcal;
  await appEval(page, async () => { const a = window.__nl; const m = { ...a.meals[0], items: a.meals[0].items.slice(0, 1), updatedAt: Date.now() }; await a.store.put('meals', m); });
  const [e2] = await dayEntries(page, tab);
  eq(e2.n.kcal, before, 'history unchanged after meal edit');
  await ctx.close();
});

const fixture = fs.readFileSync(path.join(ROOT, 'tests/fixtures/legacy-v2-anonymised.json'), 'utf8');
test('migration: old app data in localStorage is imported once, untouched, with report', async () => {
  const { ctx, page } = await newCtx();
  await page.addInitScript((data) => { if (!localStorage.getItem('nl_mj_v2')) localStorage.setItem('nl_mj_v2', data); }, fixture);
  await open(page);
  await page.waitForSelector('text=Welcome to the new NutriLedger');
  await page.screenshot({ path: `${OUT}/migration-welcome.png` });
  await page.locator('.sheet.open button', { hasText: 'Continue' }).click();
  const e = await dayEntries(page, '2026-10-20');
  eq(e.length, 4, 'entries on 20 Oct');
  eq(e.reduce((s, x) => s + x.n.kcal, 0), 240 + 30 + 83 + 83, 'calories identical');
  const raw = await page.evaluate(() => localStorage.getItem('nl_mj_v2'));
  eq(raw, fixture, 'old data untouched');
  await page.reload(); await page.waitForFunction(() => window.__nlReady);
  eq((await dayEntries(page, '2026-10-20')).length, 4, 'not duplicated on reload');
  assert(!(await page.locator('text=Welcome to the new NutriLedger').count()), 'report shown only once');
  await ctx.close();
});

test('regression D4: corrupted old data is preserved and reported, not wiped', async () => {
  const { ctx, page } = await newCtx();
  await page.addInitScript(() => { if (!localStorage.getItem('nl_mj_v2')) localStorage.setItem('nl_mj_v2', '{"profiles":[{"id":"p1"'); });
  await open(page);
  const li = await appEval(page, () => window.__nl.store.meta('legacyImport'));
  eq(li.status, 'unreadable', 'status');
  eq(await page.evaluate(() => localStorage.getItem('nl_mj_v2')), '{"profiles":[{"id":"p1"', 'raw untouched');
  await ctx.close();
});

test('profiles: isolation, switching and cascade delete', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page, 'Manish');
  await addFood(page, 'paneer');
  await page.click('#tab-more'); await page.click('#add-profile');
  const s = page.locator('.sheet.open').last();
  await s.getByLabel('Name', { exact: true }).fill('Asha'); await s.locator('.segmented button', { hasText: 'Female' }).click();
  await s.getByLabel('Age (years)').fill('44'); await s.getByLabel('Height (cm)').fill('158'); await s.getByLabel('Weight (kg)').fill('60');
  await s.locator('#profile-save').click(); await page.waitForTimeout(300);
  eq(await appEval(page, () => window.__nl.profile.name), 'Asha', 'switched to new');
  eq(await appEval(page, () => window.__nl.targets.iron.value), 29, 'female iron RDA');
  await page.click('#tab-today');
  eq((await dayEntries(page)).length, 0, "Asha sees none of Manish's entries");
  await addFood(page, 'banana');
  await page.click('#tab-more'); await page.locator('[aria-label="Switch to Manish"]').click(); await page.waitForTimeout(300);
  await page.click('#tab-today');
  const e = await dayEntries(page);
  eq(e.length, 1, 'Manish still has one'); assert(e[0].name.includes('Paneer'), 'his paneer');
  await ctx.close();
});

test('backup export → restore into a fresh install reproduces data', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await addFood(page, 'rajma'); await addFood(page, 'rice');
  await page.click('#tab-more'); await page.click('#open-backup');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-backup')]);
  const file = path.join(OUT, 'backup.json'); await dl.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  eq(exported.data.entries.length, 2, 'export has entries');
  assert(await appEval(page, () => window.__nl.store.meta('lastBackupAt')), 'last backup recorded');
  const b = await newCtx(); await open(b.page); await setupProfile(b.page, 'Temp');
  await b.page.click('#tab-more'); await b.page.click('#open-backup');
  await b.page.setInputFiles('#restore-file', file);
  await b.page.locator('#restore-replace').click(); await b.page.waitForTimeout(500);
  const all = await appEval(b.page, () => window.__nl.store.all('entries'));
  eq(all.length, 2, 'entries restored');
  near(all.reduce((s, x) => s + x.n.kcal, 0), exported.data.entries.reduce((s, x) => s + x.n.kcal, 0), 0.001, 'identical calories');
  await ctx.close(); await b.ctx.close();
});
async function setupProfile2(page) { await page.click('#start-setup'); await setupProfile(page, 'Temp'); }

test('restore from OLD-app backup file (owner format) via the restore screen', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  const priv = '/home/claude/private/real-backup-2026-10-25.json';
  const file = fs.existsSync(priv) ? priv : path.join(ROOT, 'tests/fixtures/legacy-v2-anonymised.json');
  await page.click('#tab-more'); await page.click('#open-backup');
  await page.setInputFiles('#restore-file', file);
  await page.waitForSelector('text=Backup from the old NutriLedger');
  await page.locator('#restore-merge').click(); await page.waitForTimeout(500);
  const src = JSON.parse(fs.readFileSync(file, 'utf8'));
  const all = await appEval(page, () => window.__nl.store.all('entries'));
  eq(all.length, src.entries.length, 'all old entries present');
  eq(all.reduce((s, x) => s + x.n.kcal, 0), src.entries.reduce((s, x) => s + x.k, 0), 'calories identical');
  await ctx.close();
});

test('offline: app shell loads with no network and local search + logging work; online search degrades', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-sw-'));
  const { ctx, page } = await newCtx({ userDataDir: dir, sw: true });
  await open(page); await setupProfile(page);
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await page.waitForTimeout(500);
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  await page.reload(); await page.waitForFunction(() => window.__nlReady, null, { timeout: 15000 });
  await addFood(page, 'moong dal');
  eq((await dayEntries(page)).length, 1, 'logged offline');
  await page.click('#tab-add');
  const s = page.locator('.sheet.open').last();
  await s.locator('input[type=search]').fill('maggi'); await page.waitForTimeout(300);
  await s.locator('#search-online').click(); await page.waitForTimeout(800);
  assert((await s.textContent('#online')).includes('Online search unavailable'), 'graceful offline message');
  await ctx.close();
});

const OFF_PRODUCT = { code: '8901262150378', product_name: 'Malai Paneer', brands: 'Amul', serving_quantity: '50', nutriments: { 'energy-kcal_100g': 288, proteins_100g: 18.3, carbohydrates_100g: 2.6, fat_100g: 22.8, 'saturated-fat_100g': 14.5, sodium_100g: 0.02 } };
test('Open Food Facts: irrelevant products hidden; product saved to my foods when logged; API failure handled', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await page.route('https://world.openfoodfacts.org/**', (r) => r.fulfill({ json: { products: [OFF_PRODUCT, { code: '2', product_name: 'Amul Butter', brands: 'Amul', nutriments: { 'energy-kcal_100g': 720 } }] } }));
  await page.click('#tab-add');
  const s = page.locator('.sheet.open').last();
  await s.locator('input[type=search]').fill('amul paneer'); await page.waitForTimeout(250);
  await s.locator('#search-online').click(); await page.waitForSelector('#online .row');
  eq(await s.locator('#online .row').count(), 1, 'only the relevant product');
  await s.locator('#online .row').first().click();
  await page.locator('.sheet.open').last().locator('#add-to-diary').click(); await page.waitForTimeout(400);
  await page.locator('.sheet.open .link-btn', { hasText: 'Done' }).click(); await page.waitForTimeout(300);
  const foods = await appEval(page, () => window.__nl.userFoods.map((f) => f.barcode));
  assert(foods.includes('8901262150378'), 'saved for offline reuse');
  await page.unroute('https://world.openfoodfacts.org/**');
  await page.route('https://world.openfoodfacts.org/**', (r) => r.fulfill({ status: 503, body: 'down' }));
  await page.click('#tab-add');
  const s2 = page.locator('.sheet.open').last();
  await s2.locator('input[type=search]').fill('kurkure masala'); await page.waitForTimeout(250);
  await s2.locator('#search-online').click(); await page.waitForTimeout(500);
  assert((await s2.textContent('#online')).includes('HTTP 503'), 'error explained');
  await ctx.close();
});

test('barcode photo: ZXing decodes an EAN-13 image and looks it up', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await page.route('https://world.openfoodfacts.org/api/v2/product/**', (r) => r.fulfill({ json: { status: 1, product: OFF_PRODUCT } }));
  // Render a real EAN-13 barcode independently of ZXing (standard L/G/R encoding tables)
  const png = await page.evaluate((code) => {
    const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
    const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
    const G = R.map((p) => [...p].reverse().join(''));
    const PAR = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
    const d = code.split('').map(Number); let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (PAR[d[0]][i - 1] === 'L' ? L : G)[d[i]];
    bits += '01010'; for (let i = 7; i <= 12; i++) bits += R[d[i]]; bits += '101';
    const m = 4; const c = document.createElement('canvas'); c.width = bits.length * m + 80; c.height = 260; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
    [...bits].forEach((b, i) => { if (b === '1') x.fillRect(40 + i * m, 30, m, 200); });
    return c.toDataURL('image/png').split(',')[1];
  }, '8901262150378');
  fs.writeFileSync(`${OUT}/ean.png`, Buffer.from(png, 'base64'));
  await page.click('#tab-add');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.sheet.open .quick-actions button', { hasText: 'Barcode' }).click()]);
  await chooser.setFiles(`${OUT}/ean.png`);
  await page.waitForSelector('.sheet.open #add-to-diary', { timeout: 15000 }).catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} — sheet says: ${await page.locator('.sheet.open').last().textContent()}`); });
  assert((await page.locator('.sheet.open').last().textContent()).includes('Malai Paneer'), 'product opened');
  await ctx.close();
});

test('label photo: on-device OCR reads a nutrition panel and asks for confirmation', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  const lp = await browser.newPage({ viewport: { width: 520, height: 520 }, deviceScaleFactor: 2 });
  await lp.setContent(`<div style="font:22px Arial;padding:24px;width:470px;border:3px solid #000"><b style="font-size:26px">NUTRITIONAL INFORMATION</b><br>Per 100 g (approx.)<br><table style="font:22px Arial;width:100%">
    <tr><td>Energy</td><td>520 kcal</td></tr><tr><td>Protein</td><td>8.5 g</td></tr><tr><td>Carbohydrate</td><td>60.2 g</td></tr><tr><td>Total Sugars</td><td>5.0 g</td></tr>
    <tr><td>Dietary Fibre</td><td>2.1 g</td></tr><tr><td>Total Fat</td><td>27.0 g</td></tr><tr><td>Saturated Fat</td><td>12.0 g</td></tr><tr><td>Sodium</td><td>650 mg</td></tr></table></div>`);
  await lp.screenshot({ path: `${OUT}/label.png` }); await lp.close();
  await page.click('#tab-add');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.sheet.open .quick-actions button', { hasText: 'Label photo' }).click()]);
  await chooser.setFiles(`${OUT}/label.png`);
  await page.waitForSelector('#food-save', { timeout: 120000 }).catch(async (e) => { throw new Error(`OCR did not finish — sheet says: ${await page.locator('.sheet.open').last().textContent()} — errors: ${page.errors.join(' | ')}`); });
  const s = page.locator('.sheet.open').last();
  const vals = {}; for (const k of ['Calories (kcal)', 'Protein (g)', 'Carbohydrates (g)', 'Total fat (g)', 'Saturated fat (g)', 'Fibre (g)', 'Total sugar (g)', 'Sodium (mg)']) vals[k] = await s.getByLabel(k).inputValue();
  await page.screenshot({ path: `${OUT}/label-confirm.png` });
  eq(vals['Calories (kcal)'], '520', 'kcal'); eq(vals['Protein (g)'], '8.5', 'protein'); eq(vals['Total fat (g)'], '27', 'fat'); eq(vals['Sodium (mg)'], '650', 'sodium');
  eq(vals['Carbohydrates (g)'], '60.2', 'carbs'); eq(vals['Saturated fat (g)'], '12', 'satfat'); eq(vals['Fibre (g)'], '2.1', 'fibre');
  // Sugar "5.0 g" is misread by OCR in this image; the app must flag it rather than accept it silently
  if (vals['Total sugar (g)'] !== '5') assert(await s.getByLabel('Total sugar (g)').evaluate((e) => e.classList.contains('warn')), `misread sugar ${vals['Total sugar (g)']} must be highlighted`);
  await s.getByLabel('Total sugar (g)').fill('5');
  await s.getByLabel('Name', { exact: true }).fill('Test biscuits');
  await s.locator('#food-save').click();
  await page.waitForSelector('.sheet.open #add-to-diary');
  eq(await appEval(page, () => window.__nl.userFoods[0].conf), 'label', 'saved as confirmed label');
  await ctx.close();
});

test('insights: 14 days of data → correct pattern alerts; incomplete days excluded', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await appEval(page, async () => {
    const a = window.__nl; const { addDays, localDate } = await import('./js/core/dates.js');
    const t = localDate(); const recs = [];
    for (let i = 1; i <= 14; i++) {
      const d = addDays(t, -i); const n = { kcal: i === 3 ? 400 : 2150, protein: 70, carbs: 250, fat: 70, satfat: 30, fibre: 14, sugar: 40, sodium: 3100, potassium: null, calcium: null, iron: null, magnesium: null, zinc: null, vitc: null, folate: null, b12: null };
      recs.push({ id: `t${i}`, profileId: a.profile.id, date: d, slot: 'Lunch', kind: 'quick', name: 'Test day', items: [{ name: 'x', grams: null, qty: 1, portionLabel: 'serving', n, source: { src: 'user', conf: 'user' } }], n, mult: 1, createdAt: Date.now(), updatedAt: Date.now() });
    }
    await a.store.putMany('entries', recs);
  });
  await page.click('#tab-insights'); await page.waitForSelector('#insight-alerts');
  const text = await page.textContent('#insight-alerts');
  for (const s of ['Calories consistently above target', 'Protein consistently below target', 'Inadequate recorded fibre', 'Potentially excessive sodium', 'Saturated fat consistently above limit', 'Not enough nutrient data']) assert(text.includes(s), `missing "${s}"`);
  assert(!/sodium.*deficien/i.test(text.replace('not a sign of deficiency', '')), 'no sodium deficiency claim');
  assert((await page.textContent('.subhead')).includes('13 usable day'), 'incomplete day excluded');
  await page.screenshot({ path: `${OUT}/insights.png`, fullPage: true });
  await ctx.close();
});

test('entries: edit amount, move meal, delete with undo', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await addFood(page, 'almonds');
  const [e] = await dayEntries(page);
  await page.locator('.row.entry').first().click();
  const s = page.locator('.sheet.open').last();
  await s.getByLabel('Servings multiplier').fill('2'); await s.locator('.segmented button', { hasText: 'Dinner' }).click();
  await s.locator('#entry-save').click(); await page.waitForTimeout(300);
  const [e2] = await dayEntries(page);
  near(e2.n.kcal, e.n.kcal * 2, 0.001, 'doubled'); eq(e2.slot, 'Dinner', 'moved');
  await page.locator('.row.entry').first().click();
  await page.locator('.sheet.open #entry-delete').click(); await page.waitForTimeout(300);
  eq((await dayEntries(page)).length, 0, 'deleted');
  await page.locator('.toast-action').click(); await page.waitForTimeout(300);
  eq((await dayEntries(page)).length, 1, 'undo restored');
  await ctx.close();
});

test('security: food names with HTML are shown as text, never executed', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await page.evaluate(() => { window.__pwned = false; });
  await page.click('#tab-add');
  await page.locator('.sheet.open .quick-actions button', { hasText: 'Quick add' }).click();
  const s = page.locator('.sheet.open').last();
  await s.getByLabel('Name', { exact: true }).fill('<img src=x onerror="window.__pwned=true">'); await s.getByLabel('Calories (kcal)').fill('100');
  await s.locator('#quick-save').click(); await page.waitForTimeout(300);
  await page.locator('.sheet.open .link-btn', { hasText: 'Done' }).click().catch(() => {});
  await page.waitForTimeout(300);
  eq(await page.evaluate(() => window.__pwned), false, 'not executed');
  assert((await page.textContent('#app')).includes('<img src=x'), 'shown literally');
  eq(await page.locator('#app img').count(), 0, 'no img element injected');
  await ctx.close();
});

test('mobile layout: no horizontal scrolling on any screen at 320 px and 390 px; screenshots', async () => {
  for (const width of [320, 390]) {
    const { ctx, page } = await newCtx({ ctx: { viewport: { width, height: 760 } } });
    await open(page); await setupProfile(page);
    await addFood(page, 'aloo paratha');
    for (const tab of ['today', 'meals', 'insights', 'more']) {
      await page.click(`#tab-${tab}`); await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 0, `${tab} at ${width}px overflows by ${over}px`);
      await page.screenshot({ path: `${OUT}/${tab}-${width}.png`, fullPage: true });
    }
    await page.click('#tab-add');
    await page.locator('.sheet.open input[type=search]').fill('dal'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/add-search-${width}.png` });
    await page.locator('.sheet.open #results .row').first().click(); await page.waitForTimeout(300);
    const over = await page.evaluate(() => { const s = [...document.querySelectorAll('.sheet.open .sheet-body')].pop(); return s.scrollWidth - s.clientWidth; });
    assert(over <= 0, `portion sheet overflows ${over}px at ${width}`);
    await page.screenshot({ path: `${OUT}/portion-${width}.png` });
    const small = await page.evaluate(() => [...document.querySelectorAll('.sheet.open:last-of-type button, .tabbar button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 36).map((b) => b.textContent.trim()).slice(0, 5));
    assert(!small.length, `tap targets under 36 px: ${small}`);
    await ctx.close();
  }
});

test('beta path uses a separate database from production', async () => {
  const { ctx, page } = await newCtx(); await open(page, `${BASE}beta/`); await setupProfile(page);
  eq(await appEval(page, () => window.__nl.dbName), 'nutriledger-beta', 'beta db');
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  assert(!dbs.includes('nutriledger'), 'production DB not created by beta');
  await ctx.close();
});

test('UPGRADE PATH: real v2 production app (with its service worker) → v3 keeps every entry; later update keeps data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-up-'));
  SERVE_ROOT = path.join(ROOT, 'tests/fixtures/v2-production');
  let { ctx, page } = await newCtx({ userDataDir: dir, sw: true });
  try {
    await page.goto(BASE); await page.waitForSelector('[data-nav="Add food"]');
    for (let i = 0; i < 20 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await page.waitForTimeout(300);
    // Use the OLD app's own UI to log food
    await page.click('[data-nav="Add food"]');
    await page.selectOption('#food', { label: 'Peanuts' }); await page.click('#addfood');
    await page.click('[data-nav="Add food"]'); await page.selectOption('#food', { label: 'Whey protein' }); await page.fill('#portions', '2'); await page.click('#addfood');
    const old = await page.evaluate(() => JSON.parse(localStorage.getItem('nl_mj_v2')));
    eq(old.entries.length, 2, 'old app logged 2 entries');
    // GitHub Pages now serves v3 at the same URL
    SERVE_ROOT = ROOT;
    await page.reload(); await page.waitForFunction(() => window.__nlReady === true, null, { timeout: 20000 });
    await page.waitForSelector('text=Welcome to the new NutriLedger');
    const e = await dayEntries(page);
    eq(e.length, 2, 'both entries migrated');
    eq(Math.round(e.reduce((s2, x) => s2 + x.n.kcal, 0)), Math.round(old.entries.reduce((s2, x) => s2 + x.k, 0)), 'calories identical');
    await page.locator('.sheet.open button', { hasText: 'Continue' }).click();
    for (let i = 0; i < 40; i++) { const k = await page.evaluate(() => caches.keys()); if (k.some((x) => x.startsWith('nl-shell-')) && !k.includes('nutriledger-static-v1')) break; await page.waitForTimeout(500); }
    const keys = await page.evaluate(() => caches.keys());
    const st = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { a: r?.active?.state, w: r?.waiting?.state, i: r?.installing?.state, c: !!navigator.serviceWorker.controller }; });
    assert(!keys.includes('nutriledger-static-v1'), `old cache removed: ${keys} ${JSON.stringify(st)}`);
    await addFood(page, 'roti');
    eq((await dayEntries(page)).length, 3, 'logging works after upgrade');
    await ctx.close();
    // Reopen: still 3 (no re-import, no loss)
    ({ ctx, page } = await newCtx({ userDataDir: dir, sw: true })); await open(page);
    eq((await dayEntries(page)).length, 3, 'after restart');
    // A future update is published: user is offered "Update", data survives
    SW_SUFFIX = 'b';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector('.toast-action:has-text("Update")', { timeout: 15000 });
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('.toast-action')]);
    await page.waitForFunction(() => window.__nlReady === true, null, { timeout: 15000 });
    eq((await dayEntries(page)).length, 3, 'after app update');
  } finally { SERVE_ROOT = ROOT; SW_SUFFIX = ''; await ctx.close().catch(() => {}); }
});

test('date title is a real tappable date control (iOS native picker)', async () => {
  const { ctx, page } = await newCtx(); await open(page); await setupProfile(page);
  await page.waitForTimeout(300);
  const [box, title] = await page.evaluate(() => ['.date-overlay', '#day-title'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  assert(box.width >= title.width - 1 && box.height >= 30, 'overlay covers the title');
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, { x: title.x + title.width / 2, y: title.y + title.height / 2 });
  eq(hit, 'date-overlay', 'a tap on the title lands on the date input');
  await page.fill('.date-overlay', '2026-10-01'); await page.waitForTimeout(300);
  eq(await appEval(page, () => window.__nl.date), '2026-10-01', 'date changed');
  await ctx.close();
});

test('production and beta offline workers coexist without serving each other', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-pb-'));
  const { ctx, page } = await newCtx({ userDataDir: dir, sw: true });
  await open(page); await setupProfile(page, 'Prod'); await addFood(page, 'banana');
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await page.waitForTimeout(500);
  await open(page, `${BASE}beta/`);
  eq(await appEval(page, () => window.__nl.isBeta), true, 'beta page is the beta build');
  eq(await appEval(page, () => window.__nl.dbName), 'nutriledger-beta', 'beta database');
  await page.locator('.sheet.open [aria-label=Close]').click().catch(() => {});
  await open(page, BASE);
  eq(await appEval(page, () => window.__nl.isBeta), false, 'production page is production');
  eq((await dayEntries(page)).length, 1, 'production data untouched');
  await ctx.close();
});

// ---------------------------------------------------------------- runner
let failed = 0;
for (const t of tests.filter((x) => x.name.includes(FILTER))) {
  const t0 = Date.now();
  try { await t.fn(); results.push({ name: t.name, ok: true, ms: Date.now() - t0 }); console.log(`✔ ${t.name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; results.push({ name: t.name, ok: false, error: e.message }); console.log(`✘ ${t.name}\n   ${e.message.split('\n').slice(0, 6).join('\n   ')}`); }
}
fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ when: new Date().toISOString(), engine: `Chromium ${browser.version()} (simulated iPhone 13 viewport)`, results }, null, 2));
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
