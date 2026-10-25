# NutriLedger v3

Offline-first iPhone nutrition tracker for Indian vegetarian meals. Runs as a Home Screen web app from GitHub Pages. No account, no server, no paid AI, no running cost.

- **Live app:** https://mnishjain.github.io/nutriledger/ (after v3 is promoted)
- **Beta:** https://mnishjain.github.io/nutriledger/beta/ (separate data)

## What it does
- One search box over your foods, saved meals, 78 Indian dishes, ~560 IFCT 2017 Indian ingredients and ~5,900 USDA foods; packaged foods via Open Food Facts; barcode and nutrition-label photo (on-device OCR); quick add; custom foods.
- Indian portions without weighing: chapati sizes, katori sizes, paratha, ghee/oil per serving, nut counts and handfuls, custom portion sizes.
- 16 nutrients, with unknown kept as unknown (never zero) and coverage shown.
- Personal targets (ICMR-NIN 2020, WHO, Morton 2018), daily dashboard, 7/14/21/30-day trends with five distinct warning types.
- Multiple profiles with isolated diaries, saved meals and weights.
- IndexedDB storage, daily safety snapshots, backup/restore (also from the old app), CSV export.

## Repository layout
| Path | What |
|---|---|
| `index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`, `sw.js` | The deployed site (no build step) |
| `js/core/` | Pure logic: nutrients, portions, entries, targets, analysis, search, label parsing |
| `js/store/` | IndexedDB, migrations, backup validation, v2 migration |
| `js/ui/` | Screens |
| `js/data/` | Generated food library (do not edit by hand) |
| `js/vendor/` | Tesseract.js 7 + core 7 (OCR) and ZXing 0.23 (barcodes), Apache-2.0 |
| `tools/` | Library generator, service-worker generator, beta packager, raw data sources |
| `tests/unit/` | 59 Node tests |
| `tests/e2e/` | 24 browser tests (Chromium, iPhone viewport) |
| `docs/` | Audit, architecture, data sources, testing, iPhone acceptance checklist |

## Commands
```
npm install                      # dev only: fake-indexeddb + playwright
node tools/build-library.mjs     # regenerate js/data from tools/sources (+ --report)
node tools/build-shell.mjs       # regenerate sw.js (run after ANY app file change)
npm run test:unit
npm run test:e2e                 # needs Chromium; set CHROMIUM_PATH if not at the default
node tools/make-beta.mjs <main-checkout>   # write <main-checkout>/beta/
```

## Release procedure
1. Change code on a branch; run `node tools/build-shell.mjs`; run both test suites.
2. Publish to `/beta/` on `main` with `tools/make-beta.mjs`; test on the iPhone (docs/IPHONE_ACCEPTANCE.md).
3. With owner approval, copy the branch's site files to the `main` root and delete `/beta/`.
