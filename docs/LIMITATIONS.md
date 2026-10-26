# Known limitations (honest list)

1. **Data lives on one phone.** No automatic cloud copy. Back up weekly (the app reminds you after 7 days). Deleting the Home Screen app or clearing Safari data deletes the diary.
2. **Home Screen app and Safari tab are separate.** On iPhone the Home Screen app starts EMPTY; nothing is copied from Safari. Move data with Copy my data (Safari) → Paste my data (Home Screen app), then use only the Home Screen app. Data in a Safari tab can be removed by Safari after 7 days without use.
3. **Not tested on real iPhone Safari by me.** All automated browser tests ran in Chromium (Google's engine) with an iPhone-sized screen. Safari-specific items are in docs/IPHONE_ACCEPTANCE.md.
4. **Dish values are estimates** (recipe-based). Restaurant and festive food can be far off. Oil/ghee is the biggest unknown; set it when logging.
5. **Micronutrient coverage is partial.** USDA rows used here have no iron/calcium/potassium; IFCT has no vitamin B12; packaged foods vary. The app says “not enough data” rather than guessing.
6. **Label OCR is imperfect** on curved, glossy or small print. Values are always shown for confirmation and suspicious values are highlighted, but a plausible misread can still slip through if you don't compare with the label.
7. **Open Food Facts** is crowd-sourced; Indian coverage is partial; searches are rate-limited (≈10/minute).
8. **No general web search** for nutrition (not reliable without a paid service; risk of invented values).
9. **IFCT licence:** fine for personal use with attribution; commercial use needs NIN permission.
10. **Not medical advice.** Targets are for healthy adults. Kidney disease, diabetes, pregnancy etc. need a doctor's targets.
