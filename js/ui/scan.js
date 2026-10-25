// Camera features. Libraries are vendored in js/vendor and loaded only when used.
//  • Barcode: ZXing (Apache-2.0) decodes a photo → Open Food Facts lookup.
//  • Label: Tesseract.js (Apache-2.0) OCR on-device → parseLabel → user confirms every value.
import { h, icon, openSheet, toast, clear, numInput, field } from './dom.js';
import { lookupBarcode } from '../api/off.js';
import { parseLabel, combineReads, looksClean } from '../core/labelparse.js';
import { app } from './state.js';

const base = new URL('../vendor/', import.meta.url);
const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = () => res(); s.onerror = () => { loaded.delete(src); rej(new Error('Could not load the scanner. Open the app once while online so it can be stored for offline use.')); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

function pickPhoto({ camera = true } = {}) {
  return new Promise((resolve) => {
    // With `capture` iOS opens the camera directly; without it iOS offers Photo Library / Take Photo / Choose File.
    const inp = h('input', { type: 'file', accept: 'image/*', capture: camera ? 'environment' : null, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(inp.files?.[0] || null); inp.remove(); }, { once: true });
    document.body.appendChild(inp); inp.click();
  });
}

/**
 * maxSide limits the longest side (fine for camera photos). For OCR, pass { ocr: true }: tall screenshots keep
 * their native width (target ≈2000 px wide, ≤9 MP) so small print keeps its decimal points.
 */
async function fileToCanvas(file, maxSide = 1800, { ocr = false } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that photo')); i.src = url; });
    const w0 = img.naturalWidth; const h0 = img.naturalHeight;
    const k = ocr ? Math.min(2, 2000 / w0, Math.sqrt(9e6 / (w0 * h0))) : Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * OCR preparation (measured best in tests): upscale ~2× (long side ≤ 2600 px) and Otsu black/white threshold.
 */
export function prepareForOcr(src, { keepSize = false } = {}) {
  const k = keepSize ? 1 : Math.min(2, 2000 / src.width, Math.sqrt(9e6 / (src.width * src.height)));
  const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height); const q = d.data;
  const hist = new Array(256).fill(0); const g = new Uint8Array(q.length / 4);
  for (let i = 0, j = 0; i < q.length; i += 4, j++) { g[j] = (0.299 * q[i] + 0.587 * q[i + 1] + 0.114 * q[i + 2]) | 0; hist[g[j]]++; }
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0; let wB = 0; let best = 0; let th = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = g.length - wB; if (!wF) break; sB += t * hist[t]; const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2; if (v > best) { best = v; th = t; } }
  // Dark labels with light text: invert so text is always dark on light
  const darkShare = hist.slice(0, th + 1).reduce((a, b) => a + b, 0) / g.length;
  const invert = darkShare > 0.6;
  for (let i = 0, j = 0; i < q.length; i += 4, j++) { let v = g[j] > th ? 255 : 0; if (invert) v = 255 - v; q[i] = q[i + 1] = q[i + 2] = v; }
  ctx.putImageData(d, 0, 0); return c;
}

export async function decodeBarcodeFromCanvas(canvas) {
  await loadScript(new URL('zxing/zxing.min.js', base).href);
  const Z = window.ZXing;
  const hints = new Map(); hints.set(Z.DecodeHintType.TRY_HARDER, true);
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128]);
  const reader = new Z.MultiFormatReader(); reader.setHints(hints);
  const tryDecode = (c) => {
    const lum = new Z.HTMLCanvasElementLuminanceSource(c);
    for (const bin of [new Z.HybridBinarizer(lum), new Z.GlobalHistogramBinarizer(lum)]) {
      try { return reader.decode(new Z.BinaryBitmap(bin)).getText(); } catch { /* try next */ }
    }
    return null;
  };
  let code = tryDecode(canvas);
  if (!code) { // try rotated 90° (phone held sideways)
    const r = document.createElement('canvas'); r.width = canvas.height; r.height = canvas.width;
    const ctx = r.getContext('2d'); ctx.translate(r.width / 2, r.height / 2); ctx.rotate(Math.PI / 2); ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    code = tryDecode(r);
  }
  return code;
}

export async function scanBarcode(ctx) {
  const file = await pickPhoto(); if (!file) return;
  const sheet = openSheet({ title: 'Barcode' });
  const status = h('div.empty', {}, 'Reading barcode…'); sheet.body.append(status);
  try {
    const canvas = await fileToCanvas(file, 1600);
    const code = await decodeBarcodeFromCanvas(canvas);
    if (!code) return showManual(sheet, ctx, 'No barcode found in the photo. Fill the frame with the barcode, avoid glare, or type the digits.');
    await lookupAndOpen(sheet, ctx, code);
  } catch (e) { showManual(sheet, ctx, e.message); }
}

async function lookupAndOpen(sheet, ctx, code) {
  const { openPortion, openFoodForm } = await import('./add.js');
  const local = app.userFoods.find((f) => f.barcode === code);
  if (local) { sheet.close(); openPortion(local, ctx); return; }
  clear(sheet.body); sheet.body.append(h('div.empty', {}, `Looking up ${code} on Open Food Facts…`));
  try {
    const r = await lookupBarcode(code);
    if (r.food) { sheet.close(); openPortion(r.food, ctx); return; }
    clear(sheet.body);
    sheet.body.append(h('div.banner', {}, h('b', {}, `Barcode ${code}`), r.error), h('div.btn-row', {},
      h('button.btn', { type: 'button', onclick: () => { sheet.close(); chooseLabelSource(ctx, code); } }, 'Photograph label'),
      h('button.btn', { type: 'button', onclick: () => { sheet.close(); openFoodForm({ ctx, initial: { barcode: code } }); } }, 'Enter manually')));
  } catch (e) {
    clear(sheet.body);
    sheet.body.append(h('div.banner', {}, h('b', {}, 'Lookup failed'), e.message), h('div.btn-row', {},
      h('button.btn', { type: 'button', onclick: () => { sheet.close(); chooseLabelSource(ctx, code); } }, 'Photograph label'),
      h('button.btn', { type: 'button', onclick: () => { sheet.close(); openFoodForm({ ctx, initial: { barcode: code } }); } }, 'Enter manually')));
  }
}

function showManual(sheet, ctx, msg) {
  clear(sheet.body);
  const inp = numInput({ placeholder: '8901234567890', inputmode: 'numeric' });
  sheet.body.append(h('div.banner', {}, msg), field('Barcode digits', inp), h('button.btn.primary.block', { type: 'button', onclick: () => lookupAndOpen(sheet, ctx, inp.value.replace(/\D/g, '')) }, 'Look up'));
}

let worker = null;
async function getWorker(onProgress) {
  await loadScript(new URL('tesseract/tesseract.min.js', base).href);
  if (!worker) {
    worker = await window.Tesseract.createWorker('eng', 1, {
      workerPath: new URL('tesseract/worker.min.js', base).href,
      corePath: new URL('tesseract/core/', base).href,
      langPath: new URL('tesseract/lang/', base).href,
      gzip: true, cacheMethod: 'none',
      logger: (m) => onProgress?.(m),
    });
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  }
  return worker;
}

export async function ocrImage(canvas, onProgress) {
  const w = await getWorker(onProgress);
  const { data } = await w.recognize(canvas);
  return data.text || '';
}

/** Let the user choose how to provide nutrition values: camera, a photo/screenshot, or pasted text. */
export function chooseLabelSource(ctx, barcode = null) {
  const sheet = openSheet({ title: 'Add nutrition from a picture' });
  const opt = (id, ic, title, sub, fn) => h('button.row', { type: 'button', id, onclick: fn }, icon(ic), h('div.main', {}, h('div.title', {}, title), h('div.sub', { style: { whiteSpace: 'normal' } }, sub)));
  sheet.body.append(h('div.group', {},
    opt('src-camera', 'camera', 'Take a photo of the label', 'Point the camera at the nutrition table on the pack.', () => { sheet.close(); scanLabel(ctx, barcode, { camera: true }); }),
    opt('src-library', 'down', 'Choose a photo or screenshot', 'For example a screenshot of a nutrition table from a website. Crop the screenshot to the table first for best results.', () => { sheet.close(); scanLabel(ctx, barcode, { camera: false }); }),
    opt('src-paste', 'copy', 'Paste nutrition text', 'On a web page, select the nutrition table, Copy, and paste here. Most accurate: no text recognition needed.', () => { sheet.close(); pasteText(ctx, barcode); })),
  h('div.hint', {}, 'You will see every value before anything is saved. Values from websites are only as good as the website.'));
}

function pasteText(ctx, barcode) {
  const sheet = openSheet({ title: 'Paste nutrition text' });
  const ta = h('textarea', { rows: '10', id: 'paste-text', placeholder: 'Nutrition Facts\nServing size 1 cup (228g)\nCalories 250\nTotal Fat 12g\n…', style: { width: '100%', fontSize: '16px' } });
  const msg = h('div');
  sheet.body.append(ta, msg, h('button.btn.primary.block', { type: 'button', id: 'paste-read', style: { marginTop: '12px' }, onclick: async () => {
    const r = parseLabel(ta.value);
    clear(msg);
    if (r.found.length < 2) { msg.append(h('div.banner', {}, 'Could not find nutrition values in that text. Copy the whole table, including the numbers and units (g, mg, kcal).')); return; }
    const { openFoodForm } = await import('./add.js');
    sheet.close();
    openFoodForm({ ctx, initial: labelInitial(r, barcode), src: 'label', conf: 'user', refText: 'Nutrition text you pasted, checked by you', warnings: labelWarnings(r) });
  } }, 'Read values'));
  setTimeout(() => ta.focus(), 250);
}

function labelInitial(r, barcode) {
  return { per100: r.per100, suspicious: r.suspicious, barcode, servingG: r.servingG, portions: r.servingG ? [[`1 serving (${r.servingG} g)`, r.servingG]] : [] };
}
function labelWarnings(r) {
  const w = [...r.warnings];
  if (r.found.length < 3) w.unshift('Only a few values could be read. Retake the picture closer and flatter, or type the values.');
  if (r.basis === 'perServing' && r.servingG) w.push(`Values were per serving (${r.servingG} g); they were converted to per 100 g.`);
  return w;
}

export async function scanLabel(ctx, barcode = null, { camera = true } = {}) {
  const file = await pickPhoto({ camera }); if (!file) return;
  const sheet = openSheet({ title: 'Reading label' });
  const bar = h('div.progress', {}, h('span', { style: { width: '5%' } }));
  const msg = h('div.empty', {}, 'Preparing photo…');
  sheet.body.append(msg, bar, h('div.hint', {}, 'Text recognition runs on your phone; the photo is not uploaded. First use loads about 7 MB.'));
  try {
    const original = await fileToCanvas(file, 1600, { ocr: true });
    const photo = (await fileToCanvas(file, 1200)).toDataURL('image/jpeg', 0.6);
    const at = (W) => { // resized copy W px wide (≤9 MP), then thresholded
      const k = Math.min(W / original.width, Math.sqrt(9e6 / (original.width * original.height)));
      const c = document.createElement('canvas'); c.width = Math.round(original.width * k); c.height = Math.round(original.height * k);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(original, 0, 0, c.width, c.height);
      return prepareForOcr(c, { keepSize: true });
    };
    const progress = (m) => { if (m.status && typeof m.progress === 'number') { bar.firstChild.style.width = `${Math.max(5, Math.round(m.progress * 100))}%`; } };
    msg.textContent = 'Recognising text…';
    const texts = [await ocrImage(at(1200), progress)];
    let r = combineReads(texts);
    if (!looksClean(r)) {
      // Different sizes produce different OCR mistakes; reading again and combining catches most of them
      msg.textContent = 'Double-checking the numbers (2 more reads)…';
      texts.push(await ocrImage(at(2000), progress));
      texts.push(await ocrImage(at(800), progress));
      r = combineReads(texts);
    }
    const { openFoodForm } = await import('./add.js');
    sheet.close();
    openFoodForm({ ctx, initial: labelInitial(r, barcode), src: 'label', conf: camera ? 'label' : 'user',
      refText: camera ? 'Your label photo, checked by you' : 'Your photo/screenshot, checked by you', warnings: labelWarnings(r), photo });
  } catch (e) {
    clear(sheet.body);
    sheet.body.append(h('div.banner', {}, h('b', {}, 'Could not read the label'), e.message));
    const { openFoodForm } = await import('./add.js');
    sheet.body.append(h('button.btn.primary.block', { type: 'button', onclick: () => { sheet.close(); openFoodForm({ ctx, initial: { barcode } }); } }, 'Enter values manually'));
  }
}
