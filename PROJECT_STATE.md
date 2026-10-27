# NutriLedger v3 — Project State (hand-over file)

Read this first if you are a new session / another AI picking up the work.

## Owner decisions (25 Oct 2026)
- Owner accepted all Phase-1 push-backs: no "general web search" tier; no cloud sync (export to iCloud instead); Indian dishes are recipe-based estimates.
- Owner delegated architecture decisions. Target: ~95% accuracy, zero running cost, all features, tested before hand-over. Multiple profiles required.
- Production (main branch root) must not be overwritten without explicit owner approval.

## Branch & deployment plan
- Work branch: `rebuild-v3`. Production = `main` root (GitHub Pages). Beta = `/beta/` folder, separate IndexedDB name (`nutriledger-beta`), so testing never touches real data.

## Data sources (see docs/DATA_SOURCES.md)
- IFCT 2017 (NIN) via npm `@ifct2017/compositions` 2.0.9 — raw Indian ingredients, all values in g/100 g in CSV (converted to mg/µg). Oils/ghee have energy 0 in CSV → recomputed from fat (37 kJ/g). Vitamin D and retinol columns judged unreliable → excluded.
- USDA SR Legacy values via npm `tempo-food-db` 1.0.0 (CC-BY-4.0; only rows with source=usda_sr_legacy used). Salt→sodium = salt/2.5.
- Amul Taaza toned milk label (dudhsagardairy.coop) verified 25 Oct 2026.
- Targets: ICMR-NIN 2020 RDA/EAR (nin.res.in/rdabook/brief_note.pdf), WHO 2023 fats/fibre, WHO sodium 2 g & potassium 3510 mg, Morton 2018 BJSM 1.62 g/kg protein.

## Privacy
- Owner's real backup is NOT committed (public repo). Kept outside repo at /home/claude/private/real-backup-2026-10-25.json for local tests only. Committed fixture is anonymised with the same structure (incl. duplicate-ID bug).

## Status log
- 2026-10-25: Phase 1 audit done (docs/AUDIT.md). Branch created.
- 2026-10-25: v3 built on branch `rebuild-v3`. 59 unit + 24 browser tests pass (docs/TEST_RESULTS.md), incl. upgrade from the real v2 production app.
- 2026-10-25 21:55 IST: GitHub access fixed by owner. Pushed `rebuild-v3`; PR #1 opened (https://github.com/mnishjain/nutriledger/pull/1).
- 2026-10-25: `/beta/` published on main (commit e190e63) via tools/make-beta.mjs. Live root files unchanged (still v2). Smoke-tested v2 root + v3 beta side by side.
- 2026-10-25 22:47 IST: owner APPROVED beta. Reported "Add to Home Screen" not appearing (iOS 26 hides Share behind ••• in compact tab layout) and asked about bookmarking; asked for nutrition-from-picture (web screenshots).
- 2026-10-25: added Picture/text input (camera, photo library/screenshot, pasted text), web-format parser (US FDA, Google card, compact cards), multi-read OCR correction (3 image widths, calorie checksum, physical rules), beta→live one-time data copy, iOS 26 Home Screen tip, backup reminder every 3 days in a Safari tab. 71 unit + 28 browser tests pass.
- 2026-10-25: PROMOTED v3 to main root (merge of rebuild-v3). /beta/ retired: redirect page + self-unregistering worker; live app copies IndexedDB "nutriledger-beta" once. Simulated real switch (old main → new main): beta bookmark lands on live app, 1 profile, all entries kept.
- Note: GitHub Pages lets browsers reuse pages for up to 10 minutes, so right after a deploy the old version can show briefly.
- NEXT: owner uses live app; watch for Safari-specific issues; consider cloud backup only if owner asks.

## Incident 26 Oct 2026 — "all data lost" after adding to Home Screen
- Cause: iPhone Home Screen web apps get separate, EMPTY storage; Safari's IndexedDB is not copied (only cookies, iOS 17.2+). Owner's data stayed in Safari. Not a storage failure. Process failure: told owner to add to Home Screen without migration steps.
- Second defect found: empty app showed tab bar; More crashed (no profile), so no way to restore without a dummy profile.
- Fix (deployed): welcome screen for empty app with "Bring my data from Safari" (clipboard paste or backup file) and no forced profile; tab bar hidden until data exists; Safari banner with one-tap "Copy my data" whenever Safari holds entries; Copy/Paste also in More → Backup & restore. Clipboard write uses ClipboardItem with a Promise inside the tap (Safari requires the write to start within the tap).
- New e2e test reproduces the incident with two separate storages. 71 unit + 30 browser tests pass.
- Open decision for owner: automatic cloud backup (free, needs his account) so the phone is never the only copy.

## 27 Oct 2026 — pasted text not read; web/AI lookup
- Owner report: pasting a nutrition table/text was "not reading". Reproduced: copied web tables put label and value on separate lines (1/5 values read); AI prose was mis-assigned (each value shifted to the next nutrient).
- Fix: token-based reader (js/core/labelparse.js): nutrient words + numbers in order; forward vs backward assignment chosen by unit fit + calorie checksum; units in labels ("Energy (kJ)"); basis numbers excluded ("per 100 g", "(240 g)", "8 servings"); ranges → midpoint with warning; thousands separators; bare "120 Cal"; prose serving weights. OCR-only repairs disabled for pasted text (source:'text').
- Fixtures: tests/fixtures/paste/*.txt generated with a real browser copy algorithm (Chromium selection.toString()) from 9 typical layouts.
- New: "Look up on the web" (js/ui/weblookup.js): Ask Google AI → google.com/search?udm=50&q=<fixed-format prompt> (AI Mode, Gemini; udm param undocumented, falls back to normal search); Search Google; pending lookup stored and paste step auto-reopens when owner returns from Safari (30 min); values saved as conf 'estimate', src 'web'. window.open called synchronously inside the tap (Safari pop-up rule).
- Not built (needs owner decision): one-tap Gemini API lookup (free key from Google AI Studio; free-tier prompts may be used by Google to improve products; limits).
- Tests: 85 unit + 33 browser pass.

## 27 Oct 2026 (later) — one-tap Gemini lookup with owner's own key
- Owner has a Gemini API key from another project; asked to reuse it. Advised a separate key (Google: keys share project quota/billing; separate restricted keys recommended). App accepts either.
- js/api/gemini.js: lists models (GET v1beta/models?key=) and picks newest stable "gemini-X-flash"; generateContent with tools [{google_search:{}}], temperature 0; falls back to no-search if the tool is rejected, and to another model on 404; reads candidates[].content.parts[].text and groundingMetadata.groundingChunks[].web; plain-English errors (invalid key, referrer restriction, API disabled, quota, network).
- Key stored only in IndexedDB meta 'gemini' (never in exportAll/backups/Copy my data — tested). CSP connect-src allows generativelanguage.googleapis.com.
- UI: More → Gemini lookup (Save and test key = one real listing call); "Look it up with AI" from no-match runs Gemini automatically when a key exists; result → food form, conf 'estimate', ref names model + sources.
- LIMIT: sandbox cannot reach Google's API, so the real call is verified only by the owner's "Save and test key" + first lookup. Doc ambiguity noted: newer docs show an Interactions API (v1beta/interactions, tools [{type:'google_search'}]); generateContent kept as primary (not marked deprecated).
- Tests: 92 unit + 37 browser pass.

## 27 Oct 2026 17:45 — owner's key starts with "AQ."
- Cause: app's key check only allowed [A-Za-z0-9_-] (old AIza keys); Google's new default Auth keys are "AQ.Ab…" with dots.
- Fix: cleanKey() accepts 20–300 chars of [A-Za-z0-9._-], strips pasted spaces/line breaks; key now sent in x-goog-api-key header (Google SDK default; keeps key out of URLs), with automatic retry using ?key= if Google rejects the method (401 UNAUTHENTICATED / ACCESS_TOKEN_TYPE_UNSUPPORTED) or the request fails; working method saved (meta gemini.auth). Saved model misbehaving → one retry with gemini-2.5-flash.
- Tests: 97 unit + 38 browser (1 flaky timing in a full run; 3/3 on rerun).
