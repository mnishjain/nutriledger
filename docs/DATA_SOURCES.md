# Data sources and accuracy

## Food composition
| Source | Used for | Licence / terms | Notes |
|---|---|---|---|
| IFCT 2017, ICMR–NIN, via npm `@ifct2017/compositions` 2.0.9 | ~560 Indian raw ingredients; base of all dish recipes | Package MIT; data © NIN. Used with attribution for personal, non-commercial use. **If the app is ever commercialised, obtain NIN permission.** | CSV stores everything in g/100 g → converted to mg/µg. Oils/ghee list energy 0 → recomputed (37 kJ/g fat). Vitamin D and retinol columns judged unreliable (e.g. 13 µg vitamin D in atta) → excluded. No vitamin B12 column. |
| USDA FoodData Central SR Legacy, via npm `tempo-food-db` 1.0.0 | ~5,900 international foods; curd/yogurt, tofu, besan, oats, butter, sugar etc. | USDA public domain; dataset CC-BY-4.0 (“Food nutrition data from TempoLife (tempolife.app), CC-BY-4.0”) | Only rows marked `usda_sr_legacy`. Has macros, sat fat, fibre, sugar, sodium (salt/2.5); no other minerals/vitamins. Spot-checked against known USDA values (yogurt 61 kcal, banana 89, egg 143, besan 387, lentils 116). |
| Amul Taaza toned milk label (dudhsagardairy.coop), checked 25 Oct 2026 | Toned milk, curd, chai, kadhi, lassi | Label facts | Per 100 ml ÷ 1.03 density. |
| Nutrela soya chunks label (retailer page) | Soya chunks | Label facts | Marked “Label (retailer)”. |
| Generic whey | Default whey entry | — | Marked **Estimate**; scan your own tub. |
| Open Food Facts | Packaged foods, barcodes | ODbL, crowd-sourced | Plausibility-checked; flagged “Check values” if inconsistent. |

Not included because no verified value was found: **makhana** (use barcode/label), branded namkeen, restaurant chains.

## Indian dishes (78)
Recipe estimates computed from the ingredient data above. Key assumptions (all shown in the app):
- Medium chapati = 30 g atta (cooked ≈ 40 g). Paratha = 40 g atta + fat. Aloo paratha = 40 g atta + 60 g potato + 7 g ghee/oil (adjustable).
- Rice: raw:cooked ≈ 1:3. Dal: medium katori 150 g = 30 g raw dal + 5 g tadka (adjustable) + 1 g salt. Sabzi: 150 g = 140 g veg + 7 g oil + 1 g salt.
- Roasted chana: 50 g ≈ 54 g raw (moisture loss). Moong sprouts: 100 g ≈ 40 g dry moong.
- Restaurant dishes are flagged; real values can differ by 30% or more.

**Expected accuracy:** single ingredients within a few percent of lab values; home dishes typically within ±15–25%, dominated by cooking oil (which you can set) and portion size; restaurant food worse.

## Targets
| Target | Value (owner profile) | Source |
|---|---|---|
| Calories | Mifflin–St Jeor × activity − deficit for chosen pace (default 0.35 kg/week), floor max(BMR, 1,500) | Mifflin 1990; floor is clinical convention |
| Protein | 1.6 g/kg with strength training (115 g at 72 kg); 0.83 g/kg otherwise | Morton et al., BJSM 2018 (1.62 g/kg plateau); ICMR-NIN 2020 RDA |
| Fibre | ≥ 25 g | WHO 2023 |
| Saturated fat | < 10% of calories | WHO 2023 |
| Sodium | < 2,000 mg (5 g salt) | WHO; ICMR-NIN |
| Potassium | ≥ 3,510 mg | WHO 2012 |
| Calcium, iron, magnesium, zinc, vitamin C, folate, B12 | ICMR-NIN 2020 RDA (EAR used for “persistently low”) | nin.res.in/rdabook/brief_note.pdf, Tables 3–4 |
