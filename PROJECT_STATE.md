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
- BLOCKER: push to GitHub refused (Claude GitHub App not installed on mnishjain/nutriledger). Nothing is on GitHub yet; production untouched.
- NEXT: once push works → push `rebuild-v3`, open PR, publish `/beta/` on main via tools/make-beta.mjs, owner runs docs/IPHONE_ACCEPTANCE.md, then promote on approval.
