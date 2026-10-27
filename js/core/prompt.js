// The nutrition question used for Google AI Mode and the Gemini API. A fixed reply format makes answers reliable to read.
export function aiPrompt(name) {
  return `Nutrition facts for "${name}" per 100 g (per 100 ml if it is a drink), as sold or as eaten in India. `
    + 'If it is a packaged product, use the manufacturer\'s label. Reply as a list in exactly this format, one per line, '
    + 'writing "unknown" if not reliably known: Energy: _ kcal; Protein: _ g; Carbohydrate: _ g; Total sugars: _ g; '
    + 'Fibre: _ g; Fat: _ g; Saturated fat: _ g; Sodium: _ mg; Potassium: _ mg; Calcium: _ mg; Iron: _ mg. Then name your source.';
}
