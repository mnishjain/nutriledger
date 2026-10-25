# Test results

Run: 2026-10-25T15:25:07.759Z · Commit: rebuild-v3 (see git log)

**Unit (Node 22, fake-indexeddb):** 59/59 passed

**Browser end-to-end (Chromium 153.0.8010.12 (simulated iPhone 13 viewport)):** 24/24 passed

> These browser tests are SIMULATED (Chromium engine at iPhone 13 size). They are not iPhone Safari. Safari-specific checks: docs/IPHONE_ACCEPTANCE.md.

## Browser tests
| Test | Result |
|---|---|
| first run: profile setup computes targets and shows Today | pass (991 ms) |
| search & log: 2 chapatis with 1 tsp ghee each = 280 kcal | pass (2354 ms) |
| persistence: entries survive reload AND full app restart (same storage) | pass (3492 ms) |
| regression D1: Add screen always shows the target date; past-date entries are visible there | pass (2658 ms) |
| regression D6: date rolls over at midnight while the app stays open | pass (2841 ms) |
| regression D2: blank calories are refused, never saved as 0 | pass (1461 ms) |
| regression D3: saved meals keep all nutrients; editing meal never changes history | pass (4275 ms) |
| migration: old app data in localStorage is imported once, untouched, with report | pass (949 ms) |
| regression D4: corrupted old data is preserved and reported, not wiped | pass (430 ms) |
| profiles: isolation, switching and cascade delete | pass (4656 ms) |
| backup export → restore into a fresh install reproduces data | pass (5545 ms) |
| restore from OLD-app backup file (owner format) via the restore screen | pass (1689 ms) |
| offline: app shell loads with no network and local search + logging work; online search degrades | pass (5274 ms) |
| Open Food Facts: irrelevant products hidden; product saved to my foods when logged; API failure handled | pass (3107 ms) |
| barcode photo: ZXing decodes an EAN-13 image and looks it up | pass (1269 ms) |
| label photo: on-device OCR reads a nutrition panel and asks for confirmation | pass (3647 ms) |
| insights: 14 days of data → correct pattern alerts; incomplete days excluded | pass (1446 ms) |
| entries: edit amount, move meal, delete with undo | pass (3671 ms) |
| security: food names with HTML are shown as text, never executed | pass (1903 ms) |
| mobile layout: no horizontal scrolling on any screen at 320 px and 390 px; screenshots | pass (10563 ms) |
| beta path uses a separate database from production | pass (646 ms) |
| UPGRADE PATH: real v2 production app (with its service worker) → v3 keeps every entry; later update keeps data | pass (14123 ms) |
| date title is a real tappable date control (iOS native picker) | pass (1182 ms) |
| production and beta offline workers coexist without serving each other | pass (3401 ms) |

## Unit tests
| Test | Result |
|---|---|
| recipe combination: 50 g roasted chana + 20 g peanuts | pass |
| two chapatis + one bowl sabzi + curd | pass |
| history is immutable: editing a saved meal does not change logged entries | pass |
| rescale entry relative to original snapshot | pass |
| missing data: items with unknown sodium reduce coverage, never add zero | pass |
| copy entries creates new ids on the target date | pass |
| library: every food has calories, portions and a source | pass |
| IFCT values are converted to correct units (spot checks vs IFCT 2017) | pass |
| Indian portions: chapatis 1/2/3 and ghee add-on | pass |
| bowl sizes scale correctly for rice/dal/sabzi | pass |
| grams entry and custom portions | pass |
| required foods from the brief exist | pass |
| USDA library loads lazily with diet flags | pass |
| unknown is never zero: sanitize keeps blanks as null | pass |
| sumWithCoverage: calorie-weighted coverage and lower-bound totals | pass |
| sumWithCoverage on empty list | pass |
| scale keeps unknowns unknown | pass |
| plausibility catches impossible labels | pass |
| kcalFromMacros uses IFCT/FAO factors (ghee ≈ 884 kcal) | pass |
| search relevance: common Indian queries hit the right food first | pass |
| search never pads with irrelevant results | pass |
| diet filter excludes non-vegetarian foods for vegetarian profiles | pass |
| personal history boosts ranking | pass |
| external relevance filter | pass |
| label parse: two-column Indian label (per 100 g | per serve | %RDA) | pass |
| label parse: per-serving only label converts to per 100 g; kJ handled | pass |
| label parse: OCR misreads are flagged, not silently accepted | pass |
| label parse: missing fields stay missing | pass |
| OFF mapping: units converted, unknown stays unknown, serving portion created | pass |
| OFF mapping: rejects products without calories; flags implausible data | pass |
| OFF search filters irrelevant products and survives API failure | pass |
| label parse: energy checksum repairs dropped decimals and flags them | pass |
| label parse: a whole number among decimal values is flagged (lost decimal point) | pass |
| persistence: data survives closing and reopening the database | pass |
| migration: legacy v2 data is imported non-destructively, once | pass |
| migration: unreadable old data is preserved, not overwritten | pass |
| migration: no old data → nothing happens | pass |
| schema migration framework upgrades an existing v1 database without losing data | pass |
| backup → restore round trip is lossless | pass |
| restore rejects bad files and strips unsafe content | pass |
| merge import keeps newer local edits | pass |
| profile isolation: entries, meals, weights never leak; deletion cascades only that profile | pass |
| snapshots: automatic safety copy and restore after accidental deletion | pass |
| transactions are atomic: a failing write leaves no partial data | pass |
| owner real backup (local only, not in repo) migrates correctly if present | pass |
| targets: Mifflin-St Jeor and documented values for the owner profile | pass |
| targets: calorie floor and overrides | pass |
| intraday: no "below target" alarms while the day is in progress | pass |
| genuinely exceeded daily sodium limit is reported even in progress | pass |
| completed past day below protein target → "below" (not alarming) | pass |
| incomplete record cannot support a conclusion | pass |
| persistent overconsumption of calories | pass |
| persistent protein underconsumption and inadequate fibre | pass |
| potentially excessive sodium; low sodium never flagged as deficiency | pass |
| sustained calorie restriction → caution | pass |
| nutrient with poor coverage → insufficient, never a false deficiency | pass |
| micronutrient below EAR persistently → pattern-low; between EAR and RDA → below | pass |
| 7/14/21/30-day minimum day thresholds | pass |
| rapid weight loss caution | pass |

## Requirement coverage (brief section I)
| # | Required | Where |
|---|---|---|
| 1 | Nutrient calculations | nutrients.test, library-portions.test |
| 2 | Portion conversion | library-portions.test (chapati 1/2/3 + ghee, bowls, tadka, grams, custom) |
| 3 | Recipe combinations | entries-meals.test; e2e D3 |
| 4 | Search relevance | search-label-off.test (21 Indian queries, no padding, typos, diet filter) |
| 5 | Missing data | nutrients.test, entries-meals.test, e2e D2, insights coverage |
| 6 | Alert thresholds | targets-analysis.test (13 tests) ; e2e insights |
| 7 | Profile isolation | storage.test; e2e profiles |
| 8 | Storage persistence | storage.test; e2e persistence (reload + full restart) |
| 9 | Backup/restore | storage.test round trip; e2e export→restore; e2e old-app backup |
| 10 | Migration | storage.test (schema + v2); e2e migration, D4, UPGRADE PATH from real v2 app |
| 11 | Refresh/reopen | e2e persistence, UPGRADE PATH |
| 12 | API failure / offline | search-label-off.test; e2e offline, Open Food Facts |
| 13 | Mobile viewport/usability | e2e mobile layout (320/390 px, tap targets), date control |
| 14 | Regressions | e2e D1–D4, D6; storage duplicate-ID repair |
