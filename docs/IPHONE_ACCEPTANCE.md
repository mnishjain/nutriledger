# iPhone acceptance test (about 15 minutes)

Automated tests ran in Chromium at iPhone size. They cannot prove Safari-specific behaviour, so these checks are done on the real iPhone. Use the **beta** link; it has its own separate data.

**Before you start:** in your current NutriLedger, More/Backup → Export backup JSON → Save to Files (iCloud Drive).

| # | Do this | Expected |
|---|---|---|
| 1 | Open https://mnishjain.github.io/nutriledger/beta/ in Safari | Yellow banner: “Use NutriLedger from your Home Screen” |
| 2 | Share → Add to Home Screen → open **NL Beta** from the Home Screen | No banner; profile set-up appears |
| 3 | Fill profile (age, height, weight); tap Start tracking | Today shows calories left (≈1,730 for 47 y/168 cm/72 kg) |
| 4 | Tap **+**, type `roti`, tap Chapati, choose 2, ghee “5 g (1 tsp)”, Add | Diary shows Chapati, ≈280 kcal |
| 5 | Add `dal`, `curd`, `banana`; add `walnuts` 5 halves | Each appears in the right meal; totals update |
| 6 | Tap the word **Today** at the top | iPhone date wheel opens; pick yesterday, then “back to today” |
| 7 | Swipe the app closed completely, reopen it | Everything still there |
| 8 | Turn on Aeroplane mode, reopen, add `rajma` | Works offline |
| 9 | (Still offline) Add → type `maggi` → Search packaged foods online | Clear “Online search unavailable” message |
| 10 | Back online: Add → Barcode → photograph any packet barcode | Product opens (or a clear “not in database” option) |
| 11 | Add → Label photo → photograph a nutrition panel | Form with values and your photo; highlighted fields need checking |
| 12 | Meals → + → name it, add 2 items → Save; log it with 1.5 servings | Logged once, totals × 1.5 |
| 13 | More → Add a profile (e.g. family member); add a food; switch back | Your diary unaffected |
| 14 | More → Backup & restore → Export backup → Save to Files | File saved in iCloud Drive |
| 15 | More → Backup & restore → Restore → choose your OLD backup file → “Add to my data” | Old entries (25 Oct) appear |
| 16 | Next morning: open the app | It shows the new day, yesterday’s food is under Yesterday |

Report any row that fails with a screenshot. Rows 6, 10, 11 and 14 are the Safari-specific ones that Chromium tests cannot fully prove.
