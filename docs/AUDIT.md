# NutriLedger — Phase 1 Audit
Date: 25 Oct 2026 · Repo: github.com/mnishjain/nutriledger (commit 8cca078, 8 commits) · Auditor: Claude

## 0. Access & capability (verified)
| Capability | Status |
|---|---|
| Read repo | YES — public clone works |
| Write repo / branch / PR | NO — GitHub account not linked to Claude (`add_repo` refused). Needs Manish's action (see §6) |
| Run code | YES — Node 22, Python, headless Chromium (Playwright) |
| WebKit / Safari engine | NO — download blocked in sandbox. iPhone Safari behaviour must be tested on the phone |
| Reach live site mnishjain.github.io | NO — blocked by sandbox network policy |

## 1. What the app is today
- One minified file `index.html` (25 KB, ~1,100 lines when formatted), plus `sw.js` and a manifest with no icons.
- All data = one JSON blob in `localStorage["nl_mj_v2"]`. Key unchanged across all commits (so data loss is NOT from a key rename).
- 32 built-in foods, calories + protein only, no sources, no micronutrients.
- Online search: Open Food Facts, client-side filter. No OCR. No tests. No schema version.

## 2. Defects reproduced in a real browser (script: repro/repro.mjs)
| # | Defect | Evidence |
|---|---|---|
| D1 | Food is logged to whatever date was last picked on Diary; Add-food screen never shows the date. After reopening, Diary shows today → entry "disappears". | Picked yesterday → added chapati → reload → entry dated 2026-10-24, 0 items visible today |
| D2 | Blank calorie field saved as 0 kcal (`Number("") === 0`) — invents a value | Food saved with `k: 0` |
| D3 | Saved meals keep only kcal + protein; every micronutrient silently dropped | Ingredient had sodium 400 mg; logged meal entry has no sodium |
| D4 | If stored data is unreadable, app silently loads defaults and the next save overwrites the user's data permanently | 2 entries → corrupted → one save → 1 entry; originals gone |
| D5 | Blank profile goal saved as 0 → progress bar shows 100%, divide-by-zero | `calorieGoal: 0`, bar `width:100%` |

Code-inspection findings (not executed):
- D6 `date` is set once at page load and never rolls over. An app left open overnight logs breakfast to yesterday.
- D7 No `navigator.storage.persist()`; storage is a single localStorage blob (≈5 MB cap, synchronous, no transactions).
- D8 Origin is `mnishjain.github.io` — storage is shared with ANY other GitHub Pages project of yours. A future project using localStorage could collide or consume quota.
- D9 Packaged search requires every word in the product name → brand searches ("Amul paneer") fail; products always saved as "100 g" units (forces weighing).
- D10 Insights: nutrient coverage counted by item count, not calorie share; built-in foods have no sodium/fibre, so those insights can never trigger. Sodium threshold 2,300 mg is the US limit (WHO uses 2,000 mg) — to be verified/sourced in Phase 2.
- D11 Restore replaces everything with no validation of types, no pre-restore snapshot; some fields (ids, weight) rendered unescaped → a crafted backup file could inject script (low risk, real).
- D12 Entries cannot be edited; "Remove" has no undo/confirm. Foods cannot be edited or deleted.
- D13 Manifest has no icons → iOS Home Screen icon is a page screenshot.

## 3. Verified platform facts (iOS)
- Safari deletes all script-writable storage (localStorage, IndexedDB, service-worker cache) for a site not used in 7 days of Safari use. Home Screen web apps are not subject to this and keep their own, SEPARATE storage from Safari. Source: Search Engine Land summary of WebKit statements (link in chat reply).
- Practical consequence: data logged in a Safari tab and data logged in the Home Screen icon are two different databases. Using both = "missing meals".

Most likely causes of the reported "meals disappeared", in order: D1/D6 (wrong date), Safari-vs-Home-Screen separation, Safari 7-day eviction (if used in a tab), D4 (silent reset). Cannot confirm which without your backup files.

## 4. Recommended architecture (₹0/month core)
1. Keep a PWA on GitHub Pages (free). Native iOS app = better storage guarantees but needs Apple Developer ($99/yr) + Mac/Xcode — revisit later.
2. Plain ES modules, no build step (GitHub Pages serves directly): `core/` (pure nutrition math, unit-testable in Node), `storage/` (IndexedDB, versioned migrations, transactions), `search/`, `ui/`.
3. Storage: IndexedDB with schema version; non-destructive migration from `nl_mj_v2` (original left untouched + raw copy kept); unreadable data quarantined, never overwritten; `storage.persist()` requested; daily auto-snapshot inside the DB; one-tap export via iOS share sheet to Files/iCloud with "last backup N days ago" banner.
4. Entries are immutable snapshots: every logged item stores full nutrient values + source + confidence at log time. Editing a saved meal never changes history.
5. Nutrients nullable everywhere; totals carry "coverage %" by calorie share; no conclusion drawn when coverage is low.
6. Date always visible on the add screen; auto-roll to today on reopen/visibility change.
7. Food data, local-first and bundled (works offline): user foods → curated Indian portion library (sourced) → USDA FoodData Central Foundation/SR Legacy subset (public domain) → Open Food Facts live (free, no key, rate-limited) with relevance ranking on name+brand.
8. OCR: Tesseract.js on-device (Apache-2.0, free). Always shows extracted fields for confirmation. Expect imperfect reads on curved/glossy Indian packs.
9. Beta deployment uses a separate database name so testing can never touch real data.

Push-backs on the brief:
- "General web search" tier: not feasible free and reliably without a server/paid API; also high risk of invented values. Recommend dropping it.
- Indian Food Composition Tables (IFCT 2017, NIN) — redistribution licence NOT yet verified. Until verified, Indian dish values will be built from verified ingredients (USDA + labels) and marked "estimate".
- Cloud sync: not recommended now (needs account, privacy, ~₹0 on free tiers but adds failure modes). Export-to-iCloud covers backup.

## 5. Testing reality
- Can run here: Node unit tests (math, portions, recipes, alerts, missing data, migration) and Chromium browser tests (persistence, reload, offline, restore, mobile viewport).
- Cannot run here: real iPhone Safari / WebKit. Will provide a short on-phone checklist instead.

## 6. Actions needed from Manish
1. BACK UP NOW, before any change (see chat for steps).
2. Link GitHub to Claude (see chat for steps).
3. Reply "go" (or object to any push-back above).

## 7. What Claude does once linked
Create branch `rebuild-v3` → commit this audit + repro tests → build core + storage + migration with tests → UI rebuild → full test run → beta URL → on-phone checklist → merge only on your approval.
