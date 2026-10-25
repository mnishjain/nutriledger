#!/usr/bin/env node
// Copies the app into <target>/beta/ as "NutriLedger Beta". The beta uses its own IndexedDB
// ("nutriledger-beta", chosen at runtime from the /beta/ path), so testing never touches real data.
// Usage: node tools/make-beta.mjs <path-to-checkout-of-main>
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) { console.error('usage: node tools/make-beta.mjs <main-checkout-dir>'); process.exit(1); }
const out = path.join(path.resolve(target), 'beta');
fs.rmSync(out, { recursive: true, force: true });
for (const item of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons']) fs.cpSync(path.join(ROOT, item), path.join(out, item), { recursive: true });
const idx = path.join(out, 'index.html');
fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('<title>NutriLedger</title>', '<title>NutriLedger Beta</title>').replace('content="NutriLedger">', 'content="NL Beta">'));
const man = path.join(out, 'manifest.webmanifest');
const m = JSON.parse(fs.readFileSync(man, 'utf8')); m.name = 'NutriLedger Beta'; m.short_name = 'NL Beta'; fs.writeFileSync(man, JSON.stringify(m, null, 2));
fs.writeFileSync(path.join(out, 'README.md'), '# NutriLedger beta\n\nTest build of the `rebuild-v3` branch. Separate data from the real app. Delete this folder when v3 is promoted.\n');
console.log(`beta written to ${out}`);
